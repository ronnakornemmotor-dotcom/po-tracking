/**
 * เชื่อมหน้าเว็บกับ Apps Script ผ่าน fetch() — ใช้แทน google.script.run
 *
 *   api('getData').then(data => ...).catch(err => err.message)
 *   gsr().withSuccessHandler(fn).withFailureHandler(fn).saveOrder(req)   ← รูปแบบเดียวกับ google.script.run เดิม
 *
 * - GET  สำหรับอ่าน (?action=...)
 * - POST สำหรับเขียน ส่ง body เป็น text/plain → ไม่เกิด CORS preflight (Apps Script ไม่รองรับ OPTIONS)
 * - มี timeout และแปลง error เป็นข้อความภาษาไทย
 * - ถ้าเซิร์ฟเวอร์เปิดใช้ PIN (Script Property WRITE_PIN) จะถาม PIN แล้วลองใหม่ให้เอง
 */
(function () {
  var CFG = window.APP_CONFIG || {};
  var READ = { ping: true, getData: true };
  var PIN_KEY = 'po-tracking-pin';

  function getPin() { try { return sessionStorage.getItem(PIN_KEY) || ''; } catch (e) { return ''; } }
  function setPin(v) { try { v ? sessionStorage.setItem(PIN_KEY, v) : sessionStorage.removeItem(PIN_KEY); } catch (e) { } }

  function fail(message, code) { var e = new Error(message); e.code = code || ''; return e; }

  function request(action, args, pin) {
    if (!CFG.API_URL || /ใส่ URL/.test(CFG.API_URL)) {
      return Promise.reject(fail('ยังไม่ได้ตั้งค่า API_URL ในไฟล์ config.js', 'CONFIG'));
    }
    var isRead = !!READ[action];
    var ms = isRead ? (CFG.TIMEOUT_READ_MS || 60000) : (CFG.TIMEOUT_WRITE_MS || 90000);
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);

    var url = CFG.API_URL, opt = { method: 'GET', redirect: 'follow', signal: ctrl ? ctrl.signal : undefined };
    if (isRead) {
      url += (url.indexOf('?') > -1 ? '&' : '?') + 'action=' + encodeURIComponent(action) + '&_=' + Date.now();
    } else {
      opt.method = 'POST';
      opt.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
      opt.body = JSON.stringify({ action: action, args: args || [], pin: pin || undefined });
    }

    return fetch(url, opt).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw fail('เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ' + res.status + ') กรุณาลองใหม่', 'HTTP');
      return res.text();
    }, function (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        throw fail(isRead
          ? 'โหลดข้อมูลนานเกินไป (เกิน ' + Math.round(ms / 1000) + ' วินาที) กรุณาลองใหม่'
          : 'เซิร์ฟเวอร์ตอบช้าเกินไป — ข้อมูลอาจบันทึกไปแล้ว กรุณากดรีเฟรช ↻ ตรวจก่อนบันทึกซ้ำ', 'TIMEOUT');
      }
      throw fail(navigator.onLine === false
        ? 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต กรุณาตรวจสัญญาณแล้วลองใหม่'
        : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่', 'NETWORK');
    }).then(function (text) {
      var out;
      try { out = JSON.parse(text); }
      catch (e) {
        throw fail('เซิร์ฟเวอร์ไม่ได้ตอบเป็นข้อมูล (อาจยังไม่ได้ deploy โค้ดเวอร์ชัน API หรือไม่ได้ตั้งสิทธิ์เป็น Anyone)', 'BADJSON');
      }
      if (!out || out.ok !== true) throw fail((out && out.message) || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ', out && out.code);
      return out.data;
    });
  }

  /** เรียก API — ถ้าเซิร์ฟเวอร์ขอ PIN จะถามผู้ใช้แล้วลองใหม่ (สูงสุด 3 ครั้ง) */
  function api(action, args, tries) {
    tries = tries || 0;
    return request(action, args, getPin()).catch(function (err) {
      if (err.code === 'PIN' && tries < 3) {
        setPin('');
        var p = window.prompt(err.message + '\n\nใส่ PIN สำหรับบันทึกข้อมูล:');
        if (p == null || !String(p).trim()) throw fail('ยกเลิก — ยังไม่ได้บันทึก', 'PIN');
        setPin(String(p).trim());
        return api(action, args, tries + 1);
      }
      throw err;
    });
  }

  /** ตัวแทน google.script.run — โค้ดหน้าเว็บเดิมใช้ต่อได้โดยเปลี่ยนแค่ google.script.run → gsr() */
  function gsr() {
    var ok = function () { }, bad = function (e) { console.error(e); };
    var runner = {
      withSuccessHandler: function (fn) { ok = fn; return runner; },
      withFailureHandler: function (fn) { bad = fn; return runner; }
    };
    ['getData', 'saveOrder', 'deleteOrder', 'bulkAddOrders', 'bulkUpdateOrders',
      'importOrders', 'savePrBatch', 'undoPrBatch'].forEach(function (name) {
        runner[name] = function () {
          var args = Array.prototype.slice.call(arguments);
          api(name, args).then(function (d) { ok(d); }, function (e) { bad(e); });
        };
      });
    return runner;
  }

  window.api = api;
  window.gsr = gsr;
})();
