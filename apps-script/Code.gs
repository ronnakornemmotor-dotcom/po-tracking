/**
 * ระบบติดตามการสั่งซื้อ - Google Apps Script
 *
 * แท็บ "ระบบติดตามการสั่งซื้อ" (ข้อมูลอะไหล่): model | รหัสอะไหล่ | ชื่ออะไหล่ | REMARK | Status
 * แท็บ "รายการสั่งซื้อ" (1 แถวต่อ 1 PR):
 *   ID | รหัสอะไหล่ | เลข PR | เลข PO | จำนวนสั่ง | จำนวนเข้าแล้ว | กำหนดเข้า | หมายเหตุ | อัปเดตล่าสุด
 *
 * วันที่บันทึกเป็น ค.ศ. รูปแบบ dd/MM/yyyy และเวลาอัปเดตเป็น dd/MM/yyyy HH:mm (เวลาไทย)
 * ครั้งแรกหลังติดตั้ง ให้รันฟังก์ชัน migrateOrders() 1 ครั้ง เพื่อย้าย PR เดิมจากแท็บอะไหล่
 *
 * ฟังก์ชันที่หน้าเว็บเรียกใช้:
 *   getData, saveOrder, deleteOrder, bulkAddOrders, bulkUpdateOrders,
 *   importOrders (นำเข้าไฟล์ CSV), savePrBatch (คีย์ใบ PR ทั้งใบ), undoPrBatch (ย้อนกลับใบ PR ที่เพิ่งบันทึก)
 *   repairOrderIds (ตรวจ/ซ่อม ID ที่ว่างหรือซ้ำในแท็บรายการสั่งซื้อ — รันเองจากหน้า Apps Script)
 */

var SHEET_NAME = 'ระบบติดตามการสั่งซื้อ';
var ORDER_SHEET = 'รายการสั่งซื้อ';
var TZ = 'Asia/Bangkok';
var ORDER_HEADERS = ['ID', 'รหัสอะไหล่', 'เลข PR', 'เลข PO', 'จำนวนสั่ง', 'จำนวนเข้าแล้ว', 'กำหนดเข้า', 'หมายเหตุ', 'อัปเดตล่าสุด'];
var ORDER_FORMATS = ['@', '@', '@', '@', '0', '0', '@', '@', '@'];

/**
 * รหัสเวอร์ชันโค้ด — ฝังไว้ในข้อความ error ที่ไม่ใช่ของแอปเอง
 * เพื่อให้ข้อความที่ขึ้นบนเว็บบอกได้ว่ากำลังรันโค้ดตัวไหนอยู่
 *   มี [โค้ด ....]  = โค้ดตัวนี้รันอยู่
 *   ไม่มี            = เว็บยังรันโค้ดเก่า (ต้อง deploy เป็น New version ใหม่)
 */
var CODE_VER = '2026-11-25-api';

/** ข้อความ error ของแอป (ตรวจรูปแบบ/สิทธิ์) — ไม่ต้องต่อรหัสเวอร์ชัน */
function appErr(m) { var e = new Error(m); e.app = true; return e; }

/* ================= Web API (ใช้กับหน้าเว็บบน GitHub Pages) =================
 *
 * อ่าน:  GET  <URL /exec>?action=getData            (ไม่มี action = เปิดหน้าเว็บเดิมแบบ HtmlService)
 *        GET  <URL /exec>?action=ping
 * เขียน: POST <URL /exec>  body (Content-Type: text/plain) = JSON { action, args: [...], pin? }
 *
 * ตอบกลับเป็น JSON เสมอ: { ok: true, data }  หรือ  { ok: false, message, code? }
 *
 * PIN (ไม่บังคับ): ถ้าตั้ง Script Property ชื่อ WRITE_PIN (Project Settings → Script properties)
 * ทุก action ที่เขียนข้อมูลจะต้องส่ง pin ตรงกัน — ถ้าเว้นว่าง/ไม่ตั้ง = ไม่ตรวจ
 */
var READ_ACTIONS = { ping: true, getData: true };
var WRITE_ACTIONS = {
  saveOrder: true, deleteOrder: true, bulkAddOrders: true, bulkUpdateOrders: true,
  importOrders: true, savePrBatch: true, undoPrBatch: true
};

/** GET: มี ?action= → API (JSON) / ไม่มี → หน้าเว็บเดิม (ทางสำรอง) */
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action) return apiRun_(action, [], null, true);
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('ระบบติดตามการสั่งซื้อ · ' + CODE_VER)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** POST: body เป็น JSON (ส่งแบบ text/plain เพื่อเลี่ยง CORS preflight) */
function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, message: 'ข้อมูลที่ส่งมาไม่ใช่ JSON' });
  }
  return apiRun_(body.action, body.args, body.pin, false);
}

function apiRun_(action, args, pin, isGet) {
  try {
    if (isGet ? !READ_ACTIONS[action] : !(WRITE_ACTIONS[action] || READ_ACTIONS[action])) {
      return json_({ ok: false, message: 'ไม่รู้จักคำสั่ง "' + action + '"' });
    }
    if (WRITE_ACTIONS[action]) {
      var want = String(PropertiesService.getScriptProperties().getProperty('WRITE_PIN') || '').trim();
      if (want && String(pin == null ? '' : pin).trim() !== want) {
        return json_({ ok: false, code: 'PIN', message: pin ? 'PIN ไม่ถูกต้อง' : 'กรุณาใส่ PIN เพื่อบันทึกข้อมูล' });
      }
    }
    var a = Array.isArray(args) ? args : [];
    var data;
    switch (action) {
      case 'ping': data = { ver: CODE_VER }; break;
      case 'getData': data = getData(); break;
      case 'saveOrder': data = saveOrder(a[0] || {}); break;
      case 'deleteOrder': data = deleteOrder(str_(a[0])); break;
      case 'bulkAddOrders': data = bulkAddOrders(a[0] || [], a[1] || {}); break;
      case 'bulkUpdateOrders': data = bulkUpdateOrders(a[0] || [], a[1] || {}); break;
      case 'importOrders': data = importOrders(a[0] || {}); break;
      case 'savePrBatch': data = savePrBatch(a[0] || {}); break;
      case 'undoPrBatch': data = undoPrBatch(a[0] || [], a[1] || []); break;
    }
    return json_({ ok: true, data: data, ver: CODE_VER });
  } catch (err) {
    var msg = String(err && err.message != null ? err.message : err);
    if (/Lock|lock timeout|ล็อก/i.test(msg) && !(err && err.app)) {
      msg = 'มีผู้ใช้อื่นกำลังบันทึกอยู่ กรุณาลองใหม่อีกครั้ง (' + msg + ')';
    }
    console.error(action + ': ' + msg);
    return json_({ ok: false, message: msg });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** ข้อมูลทั้งหมดสำหรับหน้าเว็บ — พร้อมตรวจ/ซ่อม ID ของแถว PR ที่ว่างหรือซ้ำให้ไม่ซ้ำก่อนส่งกลับ */
function getData() {
  var values = getSheet_().getDataRange().getDisplayValues();
  var parts = [];
  if (values.length > 1) {
    var h = header_(values[0]);
    var ix = [h.indexOf('model'), h.indexOf('รหัสอะไหล่'), h.indexOf('ชื่ออะไหล่'), h.indexOf('REMARK'), h.indexOf('Status')];
    for (var i = 1; i < values.length; i++) {
      var r = values[i];
      if (!cell_(r, ix[1])) continue;
      parts.push(ix.map(function (c) { return cell_(r, c); }));
    }
  }

  var os = getOrderSheet_();
  var sc = scanOrderRows_(os.getDataRange().getDisplayValues());
  if (sc.bad.length) applyNewIds_(os, sc.bad);   // ID ว่าง/ซ้ำ → ออกให้ใหม่แล้วเขียนกลับลงชีต
  return { parts: parts, orders: sc.orders };
}

/**
 * อ่านแถวในแท็บ "รายการสั่งซื้อ" แล้วคืน { orders, bad }
 *   orders = แถวที่จะส่งให้หน้าเว็บ (ใส่ ID ที่ซ่อมแล้ว)
 *   bad    = [{ row, id }] แถวที่ต้องเขียน ID ใหม่กลับลงชีต
 *
 * ทำไมต้องซ่อม: หน้าเว็บเก็บใบสั่งซื้อไว้ใน Map ด้วย ID ถ้าในชีตมี ID ซ้ำกัน
 * แถวหลังจะทับแถวแรก → กดแถวของใบหนึ่งแล้วเปิดได้อีกใบ (อาการ "จำนวนสั่งไม่ตรงกัน")
 * แถวที่ไม่มี ID ก็จะไม่โผล่ในเว็บเลย จึงออก ID ให้ด้วย
 */
function scanOrderRows_(ov) {
  var orders = [], bad = [], seen = {};
  for (var j = 1; j < ov.length; j++) {
    var r = ov[j].slice(0, ORDER_HEADERS.length);
    while (r.length < ORDER_HEADERS.length) r.push('');
    var id = String(r[0] == null ? '' : r[0]).trim();
    var hasData = !!(String(r[1] || '').trim() || String(r[2] || '').trim() ||
      String(r[3] || '').trim() || String(r[4] || '').trim());
    if (!id && !hasData) continue;                    // แถวว่างจริง ข้าม
    if (!id || seen[id]) {                            // ไม่มี ID หรือซ้ำกับแถวก่อนหน้า
      var nid = newId_();
      while (seen[nid]) nid = newId_();
      bad.push({ row: j + 1, id: nid });
      id = nid;
    }
    seen[id] = true;
    r[0] = id;
    orders.push(r);
  }
  return { orders: orders, bad: bad };
}

/** เขียน ID ที่ออกใหม่กลับลงคอลัมน์ A ของแท็บ "รายการสั่งซื้อ" (เขียนครั้งเดียวทั้งคอลัมน์) */
function applyNewIds_(os, bad) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return; }
  try {
    var last = os.getLastRow();
    if (last < 2) return;
    var n = last - 1;
    var col = os.getRange(2, 1, n, 1).getDisplayValues();
    var k = 0;
    bad.forEach(function (b) {
      var i = b.row - 2;
      if (i < 0 || i >= n || col[i][0] === b.id) return;
      col[i][0] = b.id;
      k++;
    });
    if (k) os.getRange(2, 1, n, 1).setValues(col);
    if (k) console.warn('ออก ID ใหม่ ' + k + ' แถวในแท็บ "' + ORDER_SHEET + '"');
  } catch (e) {
    console.warn('เขียน ID ใหม่ไม่สำเร็จ: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * ตรวจ + ซ่อม ID ในแท็บ "รายการสั่งซื้อ" (รันซ้ำได้จากหน้า Apps Script)
 * คืนจำนวนแถวที่ซ่อม — ใช้เมื่ออยากซ่อมเองโดยไม่ต้องเปิดหน้าเว็บ
 */
function repairOrderIds() {
  var os = getOrderSheet_();
  var sc = scanOrderRows_(os.getDataRange().getDisplayValues());
  if (sc.bad.length) applyNewIds_(os, sc.bad);
  Logger.log('ซ่อม ID ' + sc.bad.length + ' แถวในแท็บ "' + ORDER_SHEET + '"');
  return sc.bad.length;
}

/** เพิ่มหรือแก้ไข PR 1 รายการ (ถ้ามี o.id = แก้ไข) */
function saveOrder(o) {
  return withLock_(function () {
    var sh = getOrderSheet_();
    var row = 0;
    if (o.id) {
      row = findRow_(sh, o.id);
      if (!row) throw appErr('ไม่พบรายการนี้ในชีต (อาจถูกลบไปแล้ว) กรุณารีเฟรช');
    }
    var rec = toRow_(o.id || newId_(), o);
    writeRows_(sh, row || sh.getLastRow() + 1, [rec]);
    return out_(rec);
  });
}

/** ลบ PR 1 รายการ */
function deleteOrder(id) {
  return withLock_(function () {
    var sh = getOrderSheet_();
    var row = findRow_(sh, id);
    if (row) sh.deleteRow(row);
    return { ok: true };
  });
}

/** เพิ่ม PR เดียวกันให้อะไหล่หลายรายการ */
function bulkAddOrders(codes, f) {
  if (!codes.length) return [];
  if (codes.length > 1000) {
    throw appErr('เลือกได้ไม่เกิน 1,000 รายการต่อครั้ง (ตอนนี้เลือก ' + codes.length +
      ' รายการ) กรุณากรองให้เหลือน้อยกว่านี้ก่อน');
  }
  return withLock_(function () {
    var sh = getOrderSheet_();
    var rows = codes.map(function (code) {
      return toRow_(newId_(), { code: code, pr: f.pr, po: f.po, qty: f.qty, recv: '', date: f.date, note: f.note });
    });
    writeRows_(sh, sh.getLastRow() + 1, rows);
    return rows.map(out_);
  });
}

/**
 * แก้ไขหลายแถวพร้อมกัน — f มีเฉพาะช่องที่ต้องการเปลี่ยน (ช่องที่เว้นว่างจะคงค่าเดิม)
 * รองรับ: po, date, note, qty, recv (ตัวเลข), recvFull (true = จำนวนเข้าแล้ว = จำนวนสั่ง)
 */
function bulkUpdateOrders(ids, f) {
  return withLock_(function () {
    var sh = getOrderSheet_();
    var last = sh.getLastRow();
    if (last < 2) return [];
    var range = sh.getRange(2, 1, last - 1, ORDER_HEADERS.length);
    var vals = range.getValues();
    var want = {};
    ids.forEach(function (id) { want[id] = true; });
    var now = now_(), changed = [];

    vals.forEach(function (r) {
      if (!want[String(r[0])]) return;
      if (f.qty != null && f.qty !== '') r[4] = Number(f.qty);
      if (f.po != null) r[3] = String(f.po);
      if (f.date != null) r[6] = normDate_(f.date);
      if (f.note != null) r[7] = String(f.note);
      if (f.recvFull) r[5] = r[4] === '' ? '' : Number(r[4]);
      else if (f.recv != null && f.recv !== '') r[5] = Number(f.recv);
      r[8] = now;
      changed.push(r);
    });

    if (changed.length) {
      try { range.setNumberFormats(vals.map(function () { return ORDER_FORMATS; })); }
      catch (e) { console.warn('setNumberFormats: ' + e.message); }
      range.setValues(vals);
    }
    return changed.map(out_);
  });
}

/* ================= นำเข้าข้อมูลจากไฟล์ ================= */

/** คอลัมน์ที่ยอมรับในไฟล์นำเข้า (อ่านตามชื่อหัวคอลัมน์ ไม่ต้องเรียงตามลำดับ) */
var IMPORT_COLS = [
  { key: 'code', label: 'รหัสอะไหล่', required: true, alias: ['รหัสอะไหล่', 'รหัส', 'รหัสสินค้า', 'code', 'part', 'partno', 'partnumber', 'itemcode'] },
  { key: 'pr', label: 'เลข PR', alias: ['เลขpr', 'pr', 'เลขที่pr', 'prno', 'prnumber', 'เลขพรี', 'ใบขอซื้อ', 'ใบสั่งซื้อ'] },
  { key: 'po', label: 'เลข PO', alias: ['เลขpo', 'po', 'เลขที่po', 'pono', 'ponumber'] },
  { key: 'qty', label: 'จำนวนสั่ง', alias: ['จำนวนสั่ง', 'จำนวน', 'จำนวนสั่งชิ้น', 'จำนวนสั่งชิ้น', 'qty', 'orderqty', 'quantity'] },
  { key: 'recv', label: 'จำนวนเข้าแล้ว', alias: ['จำนวนเข้าแล้ว', 'จำนวนเข้า', 'เข้าแล้ว', 'รับแล้ว', 'recv', 'received', 'receiveqty'] },
  { key: 'date', label: 'กำหนดเข้า', alias: ['กำหนดเข้า', 'กำหนด', 'วันกำหนด', 'วันกำหนดเข้า', 'due', 'duedate', 'delivery'] },
  { key: 'note', label: 'หมายเหตุ', alias: ['หมายเหตุ', 'หมายเหตุ', 'note', 'notes', 'remark', 'comment', 'comments'] }
];
var IMPORT_MAX = 5000;   // สูงสุดต่อครั้ง

/**
 * นำเข้าข้อมูล PR จากไฟล์ที่ผู้ใช้อัปโหลด — **ต่อท้าย** แท็บรายการสั่งซื้อเสมอ
 *   payload = { headers: [ชื่อคอลัมน์แถวแรก], rows: [[ค่า, ...], ...] }   (แถวแรกของ rows คือข้อมูล ยกเว้นแถวหัว)
 *   - สร้าง ID ให้เองทุกแถว
 *   - อ่านคอลัมน์ตามชื่อ (รองรับชื่อย่อ เช่น PR, PO, qty)
 *   - รหัสอะไหล่ที่ไม่มีในแท็บอะไหล่ → ข้าม แล้วรายงานกลับ ไม่สร้างอะไหล่ใหม่
 * คืนค่า { added, skippedUnknown, unknown[], noCode, blank, mapped[] }
 */
function importOrders(payload) {
  var p = payload || {};
  var headers = p.headers || [];
  var rows = p.rows || [];
  if (!rows.length) throw appErr('ไม่พบข้อมูลในไฟล์ (แถวข้อมูลว่างทั้งหมด)');
  if (rows.length > IMPORT_MAX) {
    throw appErr('นำเข้าได้ไม่เกิน ' + fmt_(IMPORT_MAX) + ' แถวต่อครั้ง (ไฟล์นี้มี ' +
      fmt_(rows.length) + ' แถว) กรุณาแบ่งไฟล์ออกเป็นส่วน ๆ');
  }

  // จับคู่ชื่อหัวคอลัมน์
  var nk = headers.map(normKey_);
  var ix = {}, mapped = [];
  IMPORT_COLS.forEach(function (c) {
    for (var i = 0; i < nk.length; i++) {
      if (nk[i] && c.alias.indexOf(nk[i]) > -1) { ix[c.key] = i; mapped.push(c.label); break; }
    }
  });
  if (ix.code == null) {
    throw appErr('ไม่พบคอลัมน์ "รหัสอะไหล่" ในไฟล์ที่อัปโหลด\nหัวคอลัมน์แถวแรกที่อ่านได้: ' +
      (headers.filter(String).join(' | ') || '(ว่าง)'));
  }

  var pick = function (row, k) { return ix[k] == null ? '' : cell_(row, ix[k]); };
  var text = function (row, k) { return emptyToBlank_(pick(row, k)); };

  return withLock_(function () {
    var known = existingCodes_(getSheet_());
    var os = getOrderSheet_();

    var clean = [], unknown = {}, nUnknown = 0, nNoCode = 0, nBlank = 0;
    rows.forEach(function (r) {
      var allEmpty = true;
      for (var i = 0; i < r.length; i++) if (String(r[i] == null ? '' : r[i]).trim()) { allEmpty = false; break; }
      if (allEmpty) { nBlank++; return; }

      var code = pick(r, 'code');
      if (!code) { nNoCode++; return; }
      if (!known[code]) { unknown[code] = true; nUnknown++; return; }

      clean.push({
        code: code, pr: text(r, 'pr'), po: text(r, 'po'),
        qty: numLoose_(pick(r, 'qty')), recv: numLoose_(pick(r, 'recv')),
        date: emptyToBlank_(pick(r, 'date')) ? normDate_(pick(r, 'date')) : '',
        note: text(r, 'note')
      });
    });

    // เขียนทีละก้อน เพื่อไม่ให้ชีตค้างนานเกินไป
    for (var i = 0; i < clean.length; i += 400) {
      var chunk = clean.slice(i, i + 400).map(function (it) { return toRow_(newId_(), it); });
      writeRows_(os, os.getLastRow() + 1, chunk);
    }

    return {
      added: clean.length,
      skippedUnknown: nUnknown,
      unknown: Object.keys(unknown).slice(0, 300),
      unknownMore: Math.max(0, nUnknown - 300),
      noCode: nNoCode,
      blank: nBlank,
      mapped: mapped
    };
  });
}

/** ปรับชื่อหัวคอลัมน์ให้เทียบกันได้: ตัดช่องว่าง ขีด จุด และพิมพ์เล็ก */
function normKey_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[\s_\-.,]/g, '');
}

/** ค่าว่างที่แปลว่า "ไม่มีข้อมูล" ให้กลายเป็นค่าว่างล้วน */
function emptyToBlank_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/^(-|--|n\/?a|ไม่มี|-|—)$/i.test(s)) return '';
  return s;
}

/** แปลงเป็นตัวเลขแบบใจกว้าง — ตัดช่องว่าง หน่วย และจุลภาคออกก่อน */
function numLoose_(v) {
  if (v == null) return '';
  var s = String(v).replace(/[^\d.\-]/g, '');
  if (!s || s === '-' || s === '.') return '';
  var n = Number(s);
  return isFinite(n) ? n : '';
}

function fmt_(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/* ================= คีย์ใบ PR (หน้าเว็บ) ================= */

/**
 * บันทึกใบ PR ทั้งใบในครั้งเดียว
 *   payload = { pr, po, date, note, items: [ { code, qty, model?, name?, status? } ] }
 * อะไหล่ที่ยังไม่มีในชีตจะถูกสร้างใหม่ก่อน แล้วจึงเพิ่มแถว PR ให้ทุกอะไหล่
 * คืนค่า { pr, parts: [แถวอะไหล่ที่สร้างใหม่], orders: [แถว PR], created: [รหัสอะไหล่ใหม่] }
 */
function savePrBatch(payload) {
  var p = payload || {};
  var pr = str_(p.pr);
  var items = p.items || [];

  if (!pr) throw appErr('กรุณากรอกเลข PR');
  if (!items.length) throw appErr('กรุณาเลือกอะไหล่อย่างน้อย 1 รายการ');
  if (items.length > 500) {
    throw appErr('บันทึกได้ไม่เกิน 500 รายการต่อครั้ง (ตอนนี้ ' + items.length + ' รายการ)');
  }

  // ตรวจทั้งใบก่อนเขียนอะไรลงชีต ถ้าผิดจะไม่ได้เขียนไปครึ่งทาง
  var clean = items.map(function (it, n) {
    var code = str_(it.code);
    if (!code) throw appErr('รายการที่ ' + (n + 1) + ' ยังไม่ได้กรอกรหัสอะไหล่');
    var q = Number(it.qty);
    if (!isFinite(q) || q < 1 || Math.floor(q) !== q) {
      throw appErr('รายการที่ ' + (n + 1) + ' (' + code + ') — จำนวนสั่งต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
    }
    return { code: code, qty: q, model: str_(it.model), name: str_(it.name), status: str_(it.status) };
  });

  return withLock_(function () {
    var ps = getSheet_();
    var known = existingCodes_(ps);

    // 1) สร้างอะไหล่ที่ยังไม่มี (รหัสที่มีอยู่แล้วข้าม กันเขียนซ้ำตอนกดบันทึกสองครั้ง)
    var fresh = [];
    clean.forEach(function (it) {
      if (known[it.code]) return;
      known[it.code] = true;
      fresh.push(it);
    });

    var newPartRows = [];
    if (fresh.length) {
      var h = header_(ps.getRange(1, 1, 1, Math.max(5, ps.getLastColumn())).getValues()[0]);
      var ix = {
        model: h.indexOf('model'), code: h.indexOf('รหัสอะไหล่'), name: h.indexOf('ชื่ออะไหล่'),
        remark: h.indexOf('REMARK'), status: h.indexOf('Status')
      };
      var width = Math.max(5, Math.max(ix.model, ix.code, ix.name, ix.remark, ix.status) + 1);
      newPartRows = fresh.map(function (it) {
        var r = [];
        for (var c = 0; c < width; c++) r.push('');
        if (ix.model >= 0) r[ix.model] = it.model || 'COMMON';
        if (ix.code >= 0) r[ix.code] = it.code;
        if (ix.name >= 0) r[ix.name] = it.name || it.code;
        if (ix.remark >= 0) r[ix.remark] = '-';
        if (ix.status >= 0) r[ix.status] = it.status || '';
        return r;
      });
      var pStart = ps.getLastRow() + 1;
      var rng = ps.getRange(pStart, 1, newPartRows.length, width);
      if (ix.code >= 0) {
        // ตั้งเป็นข้อความก่อนเขียนค่า กันรหัสถูกแปลงเป็นตัวเลข/วันที่
        // ถ้าคอลัมน์นั้นเป็นตารางชนิดมีประเภท (typed column) จะตั้งไม่ได้ → ข้ามไป ไม่ให้บันทึกล้ม
        try { ps.getRange(pStart, ix.code + 1, newPartRows.length, 1).setNumberFormat('@'); }
        catch (e) { console.warn('setNumberFormat รหัสอะไหล่: ' + e.message); }
      }
      rng.setValues(newPartRows);
    }

    // 2) เพิ่มแถว PR ทั้งใบ
    var os = getOrderSheet_();
    var rows = clean.map(function (it) {
      return toRow_(newId_(), {
        code: it.code, pr: pr, po: p.po, qty: it.qty, recv: '', date: p.date, note: p.note
      });
    });
    writeRows_(os, os.getLastRow() + 1, rows);

    return {
      pr: pr,
      parts: newPartRows.map(function (r) { return r.slice(0, 5).map(String); }),
      orders: rows.map(out_),
      created: fresh.map(function (it) { return it.code; })
    };
  });
}

/**
 * ย้อนกลับใบ PR ที่เพิ่งบันทึก — ลบแถว PR ที่ระบุ และลบอะไหล่ที่เพิ่งสร้างใหม่ถ้าไม่เหลือ PR อื่นแล้ว
 * คืนค่า { ok: true, removedOrders: n, removedParts: m }
 */
function undoPrBatch(orderIds, createdCodes) {
  return withLock_(function () {
    var os = getOrderSheet_();
    var rows = (orderIds || []).map(function (id) { return findRow_(os, id); })
      .filter(function (r) { return r > 0; })
      .sort(function (a, b) { return b - a; });          // ลบจากล่างขึ้น เลขแถวถัดไปจะไม่เพี้ยน
    rows.forEach(function (r) { os.deleteRow(r); });

    var stillUsed = {};
    var last = os.getLastRow();
    if (last > 1) {
      os.getRange(2, 2, last - 1, 1).getDisplayValues().forEach(function (r) {
        var c = String(r[0] || '').trim();
        if (c) stillUsed[c] = true;
      });
    }

    var ps = getSheet_();
    var gone = [];
    (createdCodes || []).forEach(function (code) {
      if (stillUsed[code]) return;                        // ยังมี PR อื่นของอะไหล่นี้อยู่ เก็บไว้
      var r = findPartRow_(ps, code);
      if (r > 0) { ps.deleteRow(r); gone.push(code); }
    });

    return { ok: true, removedOrders: rows.length, removedParts: gone.length };
  });
}

/* ---------- helpers ของหน้าคีย์ใบ PR ---------- */

/** ชุดรหัสอะไหล่ทั้งหมดที่มีอยู่แล้วในแท็บอะไหล่ */
function existingCodes_(ps) {
  var out = {}, last = ps.getLastRow();
  if (last < 2) return out;
  var col = codeCol_(ps);
  if (!col) return out;
  ps.getRange(2, col, last - 1, 1).getDisplayValues().forEach(function (r) {
    var c = String(r[0] || '').trim();
    if (c) out[c] = true;
  });
  return out;
}

/** หาเลขคอลัมน์ "รหัสอะไหล่" (เริ่มนับที่ 1) หรือ 0 ถ้าไม่พบ */
function codeCol_(ps) {
  var h = header_(ps.getRange(1, 1, 1, Math.max(5, ps.getLastColumn())).getValues()[0]);
  return h.indexOf('รหัสอะไหล่') + 1;
}

function findPartRow_(ps, code) {
  var last = ps.getLastRow();
  if (last < 2) return 0;
  var col = codeCol_(ps);
  if (!col) return 0;
  var vals = ps.getRange(2, col, last - 1, 1).getDisplayValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '').trim() === code) return i + 2;
  }
  return 0;
}

/**
 * รันครั้งเดียวจากหน้า Apps Script: ย้าย PR/PO/จำนวน/กำหนดเข้า เดิมจากแท็บอะไหล่
 * ไปเป็นแถวในแท็บ "รายการสั่งซื้อ" (รันซ้ำได้ แต่ถ้ามีข้อมูลในแท็บใหม่แล้วจะไม่ย้ายซ้ำ)
 *
 * รองรับทั้งไฟล์ที่แยกคอลัมน์แล้ว และไฟล์ต้นฉบับที่รวมวันที่กับจำนวนไว้ในช่องเดียว
 * รูปแบบเดิม: "18/09/26 = 35" (วันที่ = จำนวน) ซึ่งอาจอยู่ในคอลัมน์เลข PO หรือกำหนดเข้า
 */
function migrateOrders() {
  var os = getOrderSheet_();
  if (os.getLastRow() > 1) {
    throw appErr('แท็บ "' + ORDER_SHEET + '" มีข้อมูลอยู่แล้ว จึงไม่ย้ายซ้ำ');
  }

  var v = getSheet_().getDataRange().getDisplayValues();
  if (v.length < 2) throw appErr('แท็บอะไหล่ไม่มีข้อมูลให้ย้าย');
  var h = header_(v[0]);
  var c = {
    code: h.indexOf('รหัสอะไหล่'), pr: h.indexOf('เลข PR'), po: h.indexOf('เลข PO'),
    qty: h.indexOf('จำนวนสั่ง'), recv: h.indexOf('จำนวนเข้าแล้ว'), date: h.indexOf('กำหนดเข้า')
  };
  if (c.code < 0) throw appErr('ไม่พบคอลัมน์ "รหัสอะไหล่" ในแท็บอะไหล่');

  var rows = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i];
    var code = cell_(r, c.code);
    if (!code) continue;
    var pr = cell_(r, c.pr), po = cell_(r, c.po), qty = cell_(r, c.qty);
    var recv = cell_(r, c.recv), date = cell_(r, c.date);

    // แยกรูปแบบเดิม "วันที่ = จำนวน" ที่อาจอยู่ในคอลัมน์เลข PO หรือกำหนดเข้า
    var fromPo = po.indexOf('=') > -1;
    var merged = fromPo ? po : (date.indexOf('=') > -1 ? date : '');
    if (merged) {
      var p = merged.split('=');
      if (fromPo) po = ''; else date = '';
      date = p[0].trim();
      if (!qty) qty = p[1].trim();
    }

    if (pr === '-') pr = '';
    if (po === '-') po = '';
    if (!pr && !po && !qty && !date) continue;
    rows.push(toRow_(newId_(), { code: code, pr: pr, po: po, qty: qty, recv: recv, date: date, note: '' }));
  }
  if (rows.length) writeRows_(os, 2, rows);
  Logger.log('ย้ายข้อมูลแล้ว ' + rows.length + ' รายการ');
  return rows.length;
}

/* ---------- helpers ---------- */

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

function getOrderSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ORDER_SHEET);
  if (!sh) sh = ss.insertSheet(ORDER_SHEET);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function findRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return 0;
}

function toRow_(id, o) {
  return [id, str_(o.code), str_(o.pr), str_(o.po), num_(o.qty), num_(o.recv), normDate_(o.date), str_(o.note), now_()];
}

function writeRows_(sh, start, rows) {
  var range = sh.getRange(start, 1, rows.length, ORDER_HEADERS.length);
  // ตั้งรูปแบบก่อนเขียนค่า (กันเลข/วันที่ถูกแปลงชนิด) แต่ถ้าตั้งไม่ได้
  // เช่น ชีตถูกจัดรูปแบบเป็นตารางชนิดมีประเภท (typed column) ให้ข้าม แล้วเขียนข้อมูลต่อ
  try { range.setNumberFormats(rows.map(function () { return ORDER_FORMATS; })); }
  catch (e) { console.warn('setNumberFormats: ' + e.message); }
  range.setValues(rows);
}

/** แปลงแถวเป็นข้อความทั้งหมด (รูปแบบเดียวกับ getDisplayValues) */
function out_(r) {
  return r.map(function (v, i) {
    if (v instanceof Date) return Utilities.formatDate(v, TZ, i === 8 ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy');
    return v == null ? '' : String(v);
  });
}

/** ชื่อเดือนภาษาไทย (ย่อและเต็ม) — เรียงตามเดือน 1–12 */
var TH_MONTHS = [
  ['ม.ค.', 'มกราคม'], ['ก.พ.', 'กุมภาพันธ์'], ['มี.ค.', 'มีนาคม'], ['เม.ย.', 'เมษายน'],
  ['พ.ค.', 'พฤษภาคม'], ['มิ.ย.', 'มิถุนายน'], ['ก.ค.', 'กรกฎาคม'], ['ส.ค.', 'สิงหาคม'],
  ['ก.ย.', 'กันยายน'], ['ต.ค.', 'ตุลาคม'], ['พ.ย.', 'พฤศจิกายน'], ['ธ.ค.', 'ธันวาคม']
];

/** หาเลขเดือนจากชื่อเดือนไทยที่อยู่ในข้อความ — คืน 1–12 หรือ 0 ถ้าไม่พบ */
function thaiMonth_(s) {
  for (var i = 0; i < TH_MONTHS.length; i++) {
    for (var j = 0; j < TH_MONTHS[i].length; j++) {
      if (s.indexOf(TH_MONTHS[i][j]) > -1) return i + 1;
    }
  }
  return 0;
}

/** แปลงวันที่ให้เป็น dd/MM/yyyy (ค.ศ.) — รองรับ yyyy-mm-dd, dd/mm/yy, dd/mm/yyyy, เดือนไทย และปี พ.ศ. */
function normDate_(s) {
  if (s instanceof Date) return Utilities.formatDate(s, TZ, 'dd/MM/yyyy');
  s = String(s == null ? '' : s).trim();
  if (!s) return '';
  var d, mo, y, m, nums;

  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else {
      mo = thaiMonth_(s);                            // เช่น "15 ต.ค. 2569" หรือ "15 ตุลาคม 2569"
      if (!mo) return s;
      nums = s.match(/\d+/g);
      if (!nums || nums.length < 2) return s;
      d = +nums[0]; y = +nums[1];
    }
  }
  if (y < 100) y += 2000;
  if (y > 2400) y -= 543;
  if (!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12)) return s;
  return pad_(d) + '/' + pad_(mo) + '/' + y;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return fn();
  } catch (e) {
    // error ที่ไม่ใช่ของแอป (เช่น ข้อผิดพลาดจาก SpreadsheetApp) ให้ต่อรหัสเวอร์ชันต่อท้าย
    // เพื่อให้ข้อความที่ขึ้นบนเว็บบอกได้ว่ากำลังรันโค้ดตัวไหนอยู่
    try {
      if (e && !e.app) {
        e.message = String(e.message == null ? e : e.message) + ' [โค้ด ' + CODE_VER + ']';
      }
    } catch (ignore) { }
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function header_(row) { return row.map(function (x) { return String(x).trim(); }); }
function cell_(row, i) { return (i < 0 || i >= row.length || row[i] == null) ? '' : String(row[i]).trim(); }
function str_(v) { return v == null ? '' : String(v).trim(); }
function num_(v) { return (v === '' || v == null || isNaN(Number(v))) ? '' : Number(v); }
function pad_(n) { return (n < 10 ? '0' : '') + n; }
function now_() { return Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'); }
function newId_() { return 'O' + Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
