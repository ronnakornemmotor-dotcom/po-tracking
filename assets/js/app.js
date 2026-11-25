/* ================= state ================= */
var PARTS = [], FILTERED = [], BYCODE = {}, BYID = {};
var F = { q:'', status:'', model:'', pr:'', prMonth:'', prState:'', date:'', dateFrom:'', dateTo:'', remain:'' };
var SORT = '', VIEW = 'list', PAGE = 40, SHOWN = 0;
var SEL = {}, SELMODE = false;
var chartsDirty = true, charts = {};
var curPart = null, editing = null, bulkMode = 'add', STACK = [], PARTORDER = [];
var SYS_UPD = '', SYS_UPD_KEY = 0;
var TODAY = new Date(); TODAY.setHours(0,0,0,0);
var mqDesk = window.matchMedia('(min-width: 960px)');
var MON = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
var $ = function(id){ return document.getElementById(id); };

/* ================= helpers ================= */
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function num(v){ var n = parseFloat(String(v==null?'':v).replace(/[^\d.-]/g,'')); return isNaN(n)?0:n; }
function fmt(n){ n = Number(n||0); var neg = n<0; n = Math.abs(n); var s = String(Math.round(n)), out = '';
  while(s.length>3){ out = ','+s.slice(-3)+out; s = s.slice(0,-3); } return (neg?'-':'')+s+out; }
function icon(id, cls){ return '<svg class="i'+(cls?' '+cls:'')+'"><use href="#i-'+id+'"/></svg>'; }
function pad2(n){ return (n<10?'0':'')+n; }
function hasPr(o){ return !!(o && o.pr && o.pr !== '-'); }
function statusCls(s){ return s==='NON MOVE'?'non':s==='SLOW MOVE'?'slow':s==='FAST MOVE'?'fast':''; }
function statusBadge(s){ return s ? '<span class="status '+statusCls(s)+'">'+esc(s)+'</span>' : ''; }
function fmtDateShort(d){ return d ? d.getDate()+' '+MON[d.getMonth()]+' '+pad2((d.getFullYear()+543)%100) : ''; }
function clockNow(){ var d = new Date(); return pad2(d.getHours())+':'+pad2(d.getMinutes()); }

function parseDate(s){
  s = String(s==null?'':s).trim(); if(!s) return null;
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m) return new Date(+m[1], +m[2]-1, +m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if(!m) return null;
  var y = +m[3]; if(y < 100) y += 2000; if(y > 2400) y -= 543;
  var d = new Date(y, +m[2]-1, +m[1]);
  return isNaN(d.getTime()) ? null : d;
}
function toISO(d){ return d ? d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()) : ''; }
function toTh(d){ return d ? pad2(d.getDate())+'/'+pad2(d.getMonth()+1)+'/'+d.getFullYear() : ''; }

/** "04/10/2026 14:35" -> ตัวเลขเรียงเวียา */
function stampKey(s){
  var m = String(s||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(!m) return 0;
  return (+m[3])*1000000 + (+m[2])*10000 + (+m[1])*100 + ((+m[4]||0)*60 + (+m[5]||0));
}

/** PR26080115 -> {key:'2608', label:'ส.ค. 2569'} */
function prMonth(pr){
  var s = String(pr||'').toUpperCase();
  var m = s.match(/^PR[^0-9]*(\d{2})(\d{2})/);
  if(!m) m = s.match(/(\d{4})(\d{2})/);
  if(!m) return null;
  var yy = +m[1], mm = +m[2];
  if(mm < 1 || mm > 12) return null;
  return { key: pad2(yy)+pad2(mm), label: MON[mm-1]+' '+(yy+543) };
}

function dateTag(p){
  if(!p.dateObj) return '';
  return '<span class="tag'+(p.late?' late':'')+'">'+icon(p.late?'alert':'cal')+fmtDateShort(p.dateObj)+'</span>';
}
function remainCls(p){ return p.remain > 0 ? 'remain-pos' : (p.qty > 0 ? 'remain-done' : ''); }
function prListHTML(p){
  if(!p.prs.length) return '<span class="muted">ยังไม่มี PR</span>';
  var first = esc(p.prs[0]);
  return first + (p.prs.length > 1 ? ' <span class="tag more">+'+(p.prs.length-1)+'</span>' : '');
}
/** ข้อความเลข PO — ถ้าค่าขึ้นต้นด้วย PO อยู่แล้วก็ไม่ต้องเติมคำว่า PO ซ้ำ (PO-1111 ไม่ใช่ PO PO-1111) */
function poText(po){
  var v = String(po == null ? '' : po).trim();
  if(!v) return '';
  return /^P\.?\s*O/i.test(v) ? v : ('PO ' + v);
}
/** บรรทัดเลข PO ใต้เลข PR — ไม่มี PO ก็ไม่แสดงบรรทัดนี้ (ชี้เมาส์ดูเลขครบได้จาก title) */
function poListHTML(p){
  if(!p.pos.length) return '';
  return '<span class="po-line" title="'+esc(p.pos.map(poText).join(', '))+'">' + esc(poText(p.pos[0])) +
    (p.pos.length > 1 ? ' <span class="tag more">+'+(p.pos.length-1)+'</span>' : '') + '</span>';
}

/* ================= data ================= */
function loadData(){
  var btn = $('btnRefresh'); btn.classList.add('spin'); btn.disabled = true;
  if(!PARTS.length){
    $('list').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    $('tbody').innerHTML = '<tr><td colspan="12" class="loading">กำลังโหลดข้อมูล…</td></tr>';
  }
  gsr()
    .withSuccessHandler(function(res){
      btn.classList.remove('spin'); btn.disabled = false;
      build(res);
    })
    .withFailureHandler(function(e){
      btn.classList.remove('spin'); btn.disabled = false;
      var retry = '<br><button type="button" class="btn primary retry-load" style="flex:0 0 auto;margin-top:12px">ลองใหม่</button>';
      $('list').innerHTML = '<div class="empty">โหลดข้อมูลไม่สำเร็จ<br><small>'+esc(e.message)+'</small>'+retry+'</div>';
      $('tbody').innerHTML = '<tr><td colspan="12" class="empty">โหลดข้อมูลไม่สำเร็จ<br><small>'+esc(e.message)+'</small>'+retry+'</td></tr>';
      document.querySelectorAll('.retry-load').forEach(function(b){ b.onclick = loadData; });
      toast('โหลดข้อมูลไม่สำเร็จ', true);
    })
    .getData();
}

function build(res){
  PARTS = []; BYCODE = {}; BYID = {}; SEL = {}; SYS_UPD = ''; SYS_UPD_KEY = 0;

  var byCode = {};
  (res.parts || []).forEach(function(r){
    var code = String(r[1]||'').trim();
    if(!code) return;
    var p = { model:r[0], code:code, name:r[2], remark:(r[3]==='-'?'':r[3]), status:r[4], orders:[], _i:PARTS.length };
    PARTS.push(p);
    if(!BYCODE[code]) BYCODE[code] = p;
    (byCode[code] = byCode[code] || []).push(p);
  });

  (res.orders || []).forEach(function(r){
    var o = {
      id:String(r[0]), code:String(r[1]||'').trim(),
      pr:(r[2]==='-'?'':String(r[2]||'').trim()),
      po:(r[3]==='-'?'':String(r[3]||'').trim()),
      qty:num(r[4]), recv:num(r[5]),
      date:String(r[6]||''), note:(r[7]==='-'?'':String(r[7]||'')),
      updated:String(r[8]||'')
    };
    if(!o.id) return;
    BYID[o.id] = o;
    (byCode[o.code] || []).forEach(function(p){ p.orders.push(o); });
    var k = stampKey(o.updated);
    if(k > SYS_UPD_KEY){ SYS_UPD_KEY = k; SYS_UPD = o.updated; }
  });

  PARTS.forEach(recompute);
  buildSelects();
  fillKeyModels();          // รายการ Model ให้เลือกตอนเพิ่มอะไหล่ใหม่ (พร้อมพิมพ์เองได้)
  setSelMode(false);

  var nOrd = 0; PARTS.forEach(function(p){ nOrd += p.orders.length; });
  var subTxt = fmt(PARTS.length)+' อะไหล่ · '+fmt(nOrd)+' ใบสั่งซื้อ' +
    (SYS_UPD ? ' · อัปเดตล่าสุด '+SYS_UPD : '');
  var i = $('subtitle').children;
  i[0].textContent = subTxt;
  i[1].textContent = fmt(PARTS.length)+' อะไหล่ · '+fmt(nOrd)+' ใบ';
  apply();
}

function recompute(p){
  var pend = [], all = [], prSeen = {}, poSeen = {};
  p.qty = 0; p.recv = 0; p.remain = 0; p.late = false;
  p.prs = []; p.pos = []; p.dates = []; p.months = {}; p.lastUpdate = ''; var lu = 0;
  p.orders.forEach(function(o){
    o.remain = Math.max(0, o.qty - o.recv);
    o.dateObj = parseDate(o.date);
    o.late = !!(o.dateObj && o.dateObj < TODAY && o.remain > 0);
    if(o.dateObj) all.push(o.dateObj);
    if(o.dateObj && o.remain > 0) pend.push(o.dateObj);
    if(o.late) p.late = true;
    if(hasPr(o) && !prSeen[o.pr]){ prSeen[o.pr] = 1; p.prs.push(o.pr); }
    if(o.po && !poSeen[o.po]){ poSeen[o.po] = 1; p.pos.push(o.po); }   // เลข PO ไม่ซ้ำ ใช้โชว์ในหน้ารวม
    var mo = prMonth(o.pr); if(mo) p.months[mo.key] = 1;
    p.qty += o.qty; p.recv += o.recv; p.remain += o.remain;
    var k = stampKey(o.updated);
    if(k > lu){ lu = k; p.lastUpdate = o.updated; }
  });
  p.dates = all;
  p.hasDate = all.length > 0;
  var src = pend.length ? pend : all;
  p.dateObj = src.length ? new Date(Math.min.apply(null, src.map(function(d){ return d.getTime(); }))) : null;
  p.hay = (p.code+' '+p.name+' '+p.model+' '+p.orders.map(function(o){ return o.pr+' '+o.po+' '+o.note; }).join(' ')).toLowerCase();
}

/* ================= select boxes ================= */
function buildSelects(){
  var models = {}, prs = {}, months = {};
  PARTS.forEach(function(p){
    if(p.model) models[p.model] = 1;
    p.prs.forEach(function(x){ prs[x] = 1; });
    for(var k in p.months) months[k] = 1;
  });
  fill('fModel', Object.keys(models).sort(function(a,b){ return a.localeCompare(b,'th'); }));
  fill('fPr', Object.keys(prs).sort());
  fill('fPrMonth', Object.keys(months).sort().reverse().map(function(k){
    return { v:k, t:MON[+k.slice(2)-1]+' '+(+k.slice(0,2)+543) };
  }));
}
function fill(id, arr){
  var s = $(id), cur = s.value;
  var opts = arr.map(function(x){
    var v = (typeof x === 'object') ? x.v : x, t = (typeof x === 'object') ? x.t : x;
    return '<option value="'+esc(v)+'">'+esc(t)+'</option>';
  }).join('');
  s.innerHTML = '<option value="">ทั้งหมด</option>' + opts;
  s.value = cur;
}

/* ================= filter & sort ================= */
function matchBase(p){
  if(F.q && p.hay.indexOf(F.q) < 0) return false;
  if(F.model && p.model !== F.model) return false;
  if(F.pr && p.prs.indexOf(F.pr) < 0) return false;
  if(F.prMonth && !p.months[F.prMonth]) return false;
  if(F.prState==='has' && !p.prs.length) return false;
  if(F.prState==='none' && p.prs.length) return false;
  if(F.date==='has' && !p.hasDate) return false;
  if(F.date==='none' && p.hasDate) return false;
  if(F.date==='late' && !p.late) return false;
  if(F.dateFrom || F.dateTo){
    var f = F.dateFrom ? parseDate(F.dateFrom) : null;
    var t = F.dateTo ? parseDate(F.dateTo) : null;
    if(t) t.setHours(23,59,59,999);
    if(!p.dates.some(function(d){ return (!f || d>=f) && (!t || d<=t); })) return false;
  }
  if(F.remain==='pending' && !(p.remain > 0)) return false;
  if(F.remain==='done' && !(p.qty > 0 && p.remain === 0)) return false;
  return true;
}

function apply(){
  var base = PARTS.filter(matchBase);
  var counts = { '':base.length, 'NON MOVE':0, 'SLOW MOVE':0, 'FAST MOVE':0 };
  base.forEach(function(p){ if(counts[p.status] != null) counts[p.status]++; });
  document.querySelectorAll('[data-c]').forEach(function(el){ el.textContent = fmt(counts[el.dataset.c]); });

  FILTERED = F.status ? base.filter(function(p){ return p.status === F.status; }) : base;
  sortRows();

  var n = ['model','pr','prMonth','prState','date','dateFrom','dateTo','remain']
    .filter(function(k){ return F[k]; }).length;
  document.querySelectorAll('[data-fcount]').forEach(function(el){ el.textContent = n; el.hidden = !n; });

  var nOrd = 0; FILTERED.forEach(function(p){ nOrd += p.orders.length; });
  $('resultCount').textContent = 'พบ ' + fmt(FILTERED.length) + ' อะไหล่ · ' + fmt(nOrd) + ' ใบสั่งซื้อ';
  $('fApply').textContent = 'ดูผลลัพธ์ (' + fmt(FILTERED.length) + ')';

  renderStats();
  chartsDirty = true;
  if(VIEW === 'summary') renderCharts();
  renderList(true);
}

function sortRows(){
  var cmp = {
    remain:function(a,b){ return b.remain - a.remain; },
    date:function(a,b){ var x=a.dateObj,y=b.dateObj; if(!x&&!y) return 0; if(!x) return 1; if(!y) return -1; return x-y; },
    code:function(a,b){ return a.code.localeCompare(b.code); },
    name:function(a,b){ return a.name.localeCompare(b.name,'th'); },
    model:function(a,b){ return a.model.localeCompare(b.model,'th'); },
    upd:function(a,b){ return stampKey(b.lastUpdate) - stampKey(a.lastUpdate); }
  }[SORT];
  if(cmp) FILTERED.sort(cmp);
  else FILTERED.sort(function(a,b){ return a._i - b._i; });
}

/* ================= render ================= */
function renderStats(){
  var s = { ord:0, pend:0, late:0, qty:0, recv:0, remain:0 };
  FILTERED.forEach(function(p){
    s.ord += p.orders.length;
    if(p.remain > 0) s.pend++;
    if(p.late) s.late++;
    s.qty += p.qty; s.recv += p.recv; s.remain += p.remain;
  });
  $('stats').innerHTML =
    stat(FILTERED.length, 'อะไหล่') +
    stat(s.ord, 'ใบสั่งซื้อ') +
    stat(s.pend, 'อะไหล่ที่ค้าง', 'warn') +
    stat(s.late, 'เลยกำหนด', s.late ? 'danger' : '') +
    stat(s.qty, 'สั่งรวม (ชิ้น)') +
    stat(s.recv, 'เข้าแล้ว (ชิ้น)', 'ok') +
    stat(s.remain, 'ค้างรวม (ชิ้น)', 'warn');
}
function stat(v,l,cls){ return '<div class="stat '+(cls||'')+'"><div class="v num">'+fmt(v)+'</div><div class="l">'+l+'</div></div>'; }

function cardHTML(p){
  var meta = [];
  if(p.model) meta.push('<span>'+esc(p.model)+'</span>');
  if(p.prs.length){
    meta.push('<span>PR '+esc(p.prs[0])+(p.prs.length>1?' +'+(p.prs.length-1):'')+'</span>');
  }
  if(p.pos.length){
    meta.push('<span>'+esc(poText(p.pos[0]))+(p.pos.length>1?' +'+(p.pos.length-1):'')+'</span>');
  }
  var foot = p.orders.length
    ? '<span class="item-foot">' +
        '<span class="kv"><span class="k">สั่ง</span><span class="v num">'+fmt(p.qty)+'</span></span>' +
        '<span class="kv"><span class="k">เข้าแล้ว</span><span class="v num">'+fmt(p.recv)+'</span></span>' +
        '<span class="kv"><span class="k">ค้างเข้า</span><span class="v num '+remainCls(p)+'">'+fmt(p.remain)+'</span></span>' +
        '<span>'+dateTag(p)+'</span>' +
      '</span>'
    : '<span class="item-none"><span>ยังไม่มีข้อมูลการสั่งซื้อ</span><span class="add">'+icon('edit')+'เพิ่ม PR</span></span>';
  return '<button class="item'+(SEL[p._i]?' sel-on':'')+'" data-key="'+p._i+'" aria-label="'+esc(p.code)+' '+esc(p.name)+'">' +
    '<span class="item-top">' +
      '<span class="pick">'+icon('check')+'</span>' +
      '<span class="code">'+esc(p.code)+'</span>' + statusBadge(p.status) +
    '</span>' +
    '<span class="item-name">'+esc(p.name)+'</span>' +
    (meta.length ? '<span class="item-meta">'+meta.join('')+'</span>' : '') +
    (p.remark ? '<span class="item-remark">'+esc(p.remark)+'</span>' : '') +
    foot +
    (p.lastUpdate ? '<span class="item-upd num">'+icon('clock','i')+' อัปเดต '+esc(p.lastUpdate)+'</span>' : '') +
  '</button>';
}

function rowHTML(p){
  return '<tr data-key="'+p._i+'" tabindex="0" class="'+(SEL[p._i]?'sel-on':'')+'">' +
    '<td class="pick-cell"><span class="pick">'+icon('check')+'</span></td>' +
    '<td>'+esc(p.model)+'</td>' +
    '<td><strong>'+esc(p.code)+'</strong></td>' +
    '<td>'+esc(p.name)+(p.remark?'<span class="sub">'+esc(p.remark)+'</span>':'')+'</td>' +
    '<td>'+statusBadge(p.status)+'</td>' +
    '<td>'+prListHTML(p)+poListHTML(p)+'</td>' +
    '<td class="r num">'+fmt(p.qty)+'</td><td class="r num">'+fmt(p.recv)+'</td>' +
    '<td class="r num"><strong class="'+remainCls(p)+'">'+fmt(p.remain)+'</strong></td>' +
    '<td>'+dateTag(p)+'</td>' +
    '<td class="upd num">'+(p.lastUpdate?esc(p.lastUpdate):'—')+'</td>' +
    '<td>'+icon('edit')+'</td></tr>';
}

function renderList(reset){
  var desk = mqDesk.matches;
  var target = desk ? $('tbody') : $('list');
  if(reset){
    SHOWN = 0;
    target.innerHTML = '';
    (desk ? $('list') : $('tbody')).innerHTML = '';
    if(!FILTERED.length){
      target.innerHTML = desk
        ? '<tr><td colspan="12" class="empty">ไม่พบรายการที่ตรงกับเงื่อนไข</td></tr>'
        : '<div class="empty">ไม่พบรายการที่ตรงกับเงื่อนไข</div>';
      return;
    }
  }
  var next = FILTERED.slice(SHOWN, SHOWN + PAGE);
  if(!next.length) return;
  target.insertAdjacentHTML('beforeend', next.map(desk ? rowHTML : cardHTML).join(''));
  SHOWN += next.length;
}

new IntersectionObserver(function(en){
  if(en[0].isIntersecting && VIEW === 'list' && SHOWN < FILTERED.length) renderList(false);
}, { rootMargin:'600px' }).observe($('sentinel'));

$('tableWrap').addEventListener('scroll', function(){
  var el = this;
  if(el.scrollTop + el.clientHeight > el.scrollHeight - 400 && SHOWN < FILTERED.length) renderList(false);
});
mqDesk.addEventListener('change', function(){ renderList(true); });

/* ================= charts ================= */
Chart.defaults.font.family = "'IBM Plex Sans Thai', system-ui, sans-serif";
Chart.defaults.color = '#4C655C';

function renderCharts(){
  if(!chartsDirty) return; chartsDirty = false;

  var st = { 'NON MOVE':0, 'SLOW MOVE':0, 'FAST MOVE':0 };
  var flow = { 'ยังไม่มี PR':0, 'ยังค้างเข้า':0, 'เลยกำหนด':0, 'เข้าครบแล้ว':0 };
  var months = {}, models = {}, qs = { 'NON MOVE':[0,0,0], 'SLOW MOVE':[0,0,0], 'FAST MOVE':[0,0,0] };

  FILTERED.forEach(function(p){
    if(st[p.status] != null) st[p.status]++;
    if(!p.prs.length) flow['ยังไม่มี PR']++;
    else if(p.qty > 0 && p.remain === 0) flow['เข้าครบแล้ว']++;
    else if(p.late) flow['เลยกำหนด']++;
    else flow['ยังค้างเข้า']++;
    for(var k in p.months) months[k] = (months[k]||0) + 1;
    var m = p.model || '(ไม่ระบุ)';
    models[m] = (models[m]||0) + p.remain;
    if(qs[p.status]){ qs[p.status][0] += p.qty; qs[p.status][1] += p.recv; qs[p.status][2] += p.remain; }
  });

  var top = function(o,n){ return Object.keys(o).map(function(k){ return [k,o[k]]; }).sort(function(a,b){ return b[1]-a[1]; }).slice(0,n); };

  draw('chStatus', 'doughnut', Object.keys(st), [{ label:'อะไหล่', data:Object.values(st), color:['#DC2626','#D97706','#0FA36B'] }], {});
  draw('chFlow', 'doughnut', Object.keys(flow), [{ label:'อะไหล่', data:Object.values(flow), color:['#A9BDB4','#B45309','#DC2626','#0FA36B'] }], {});

  var mk = Object.keys(months).sort();
  draw('chMonth', 'bar', mk.map(function(k){ return MON[+k.slice(2)-1]+' '+(+k.slice(0,2)+543); }),
    [{ label:'จำนวนอะไหล่', data:mk.map(function(k){ return months[k]; }), color:'#12735A' }], { horizontal:true });

  var md = top(models, 15);
  draw('chModel', 'bar', md.map(function(x){ return x[0]; }),
    [{ label:'ชิ้นค้างเข้า', data:md.map(function(x){ return x[1]; }), color:'#B45309' }], { horizontal:true });

  var sk = Object.keys(qs);
  draw('chQty', 'bar', sk, [
    { label:'สั่ง', data:sk.map(function(k){ return qs[k][0]; }), color:'#12735A' },
    { label:'เข้าแล้ว', data:sk.map(function(k){ return qs[k][1]; }), color:'#0FA36B' },
    { label:'ค้างเข้า', data:sk.map(function(k){ return qs[k][2]; }), color:'#D97706' }
  ], { stack:true });
}

function draw(id, type, labels, ds, opt){
  opt = opt || {};
  if(charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), {
    type: type,
    data: {
      labels: labels,
      datasets: ds.map(function(d){
        var o = { label:d.label, data:d.data, backgroundColor:d.color };
        if(type === 'doughnut'){ o.borderWidth = 2; o.borderColor = '#fff'; }
        else { o.borderRadius = 5; o.maxBarThickness = 26; o.stack = opt.stack ? 's' : undefined; }
        return o;
      })
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      indexAxis: opt.horizontal ? 'y' : 'x',
      cutout: type === 'doughnut' ? '62%' : undefined,
      plugins: {
        legend:{ display:true, position: type==='doughnut' ? 'bottom' : 'top', labels:{ boxWidth:12, padding:12 } },
        tooltip:{ callbacks:{ label:function(c){
          return ' ' + c.dataset.label + ': ' + fmt(c.parsed.x != null ? c.parsed.x : (c.parsed.y != null ? c.parsed.y : c.parsed)) + ' ชิ้น';
        } } }
      },
      scales: type === 'bar' ? {
        x:{ stacked:!!opt.stack, beginAtZero:true, grid:{ color:'#EAF2EE' }, ticks:{ precision:0 } },
        y:{ stacked:!!opt.stack, grid:{ display:false }, ticks:{ precision:0 } }
      } : undefined
    }
  });
}

/* ================= views ================= */
/** เปลี่ยนหน้า — ถ้าออกจากหน้าคีย์ใบ PR ตอนที่ยังมีรายการค้าง จะถามก่อน */
function setView(v){
  if(VIEW === 'key' && v !== 'key' && KEY.items.length){
    if(!confirm('ยังมีรายการ ' + fmt(KEY.items.length) + ' รายการในใบ PR ที่ยังไม่ได้บันทึก\nออกจากหน้านี้หรือไม่?')) return;
  }
  if(v === 'key' && SELMODE){ SELMODE = false; SEL = {}; }
  VIEW = v;
  $('viewList').hidden = v !== 'list';
  $('viewKey').hidden = v !== 'key';
  $('viewSummary').hidden = v !== 'summary';
  $('chipsBar').style.display = v === 'list' ? '' : 'none';
  $('searchBox').hidden = v !== 'list';
  document.querySelectorAll('[role="tab"][data-view]').forEach(function(b){ b.setAttribute('aria-selected', b.dataset.view === v); });
  if(v === 'summary') renderCharts();
  if(v === 'key') renderKey();
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-view]').forEach(function(b){
  b.addEventListener('click', function(){ setView(b.dataset.view); });
});

/* ================= sheets ================= */
var lastFocus = null;
function openSheet(el){
  lastFocus = document.activeElement;
  if(STACK.indexOf(el) < 0) STACK.push(el);
  $('backdrop').classList.add('open');
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(function(){
    var f = el.querySelector('input:not([type=hidden]),select,textarea');
    if(f && !('ontouchstart' in window)) f.focus();
    else el.querySelector('.close').focus();
  }, 60);
}
function closeSheet(el){
  el = el || STACK[STACK.length-1];
  if(!el) return;
  el.classList.remove('open');
  STACK = STACK.filter(function(x){ return x !== el; });
  if(!STACK.length){
    $('backdrop').classList.remove('open');
    document.body.style.overflow = '';
    curPart = null;
    setSelMode(false);
  }
  if(lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
}
$('backdrop').addEventListener('click', function(){ while(STACK.length) closeSheet(); });
document.querySelectorAll('[data-close]').forEach(function(b){
  b.addEventListener('click', function(){ closeSheet(b.closest('.sheet')); });
});
document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && STACK.length) closeSheet(); });
document.querySelectorAll('[data-open-filter]').forEach(function(b){
  b.addEventListener('click', function(){ openSheet($('filterSheet')); });
});

/* ================= toast ================= */
var toastTimer;
function toast(msg, err){
  var t = $('toast');
  t.innerHTML = icon(err?'alert':'check')+'<span>'+esc(msg)+'</span>';
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.className = 'toast' + (err ? ' err' : ''); }, err ? 4500 : 2400);
}
function busy(btn, on, label){
  btn.disabled = on;
  btn.classList.toggle('loading', on);
  var t = btn.querySelector('.t');
  if(t) t.textContent = on ? (label || 'กำลังบันทึก…') : (btn.dataset.label || 'บันทึก');
}

/* ================= filter controls ================= */
var qTimer;
$('q').addEventListener('input', function(){
  var v = this.value;
  $('searchBox').classList.toggle('has-value', !!v);
  clearTimeout(qTimer);
  qTimer = setTimeout(function(){ F.q = v.trim().toLowerCase(); apply(); }, 180);
});
$('qClear').addEventListener('click', function(){
  $('q').value = ''; $('searchBox').classList.remove('has-value'); F.q = ''; apply(); $('q').focus();
});
$('statusChips').addEventListener('click', function(e){
  var b = e.target.closest('[data-status]'); if(!b) return;
  F.status = b.dataset.status;
  this.querySelectorAll('[data-status]').forEach(function(x){ x.setAttribute('aria-pressed', x === b); });
  apply();
});
$('fModel').addEventListener('change', function(){ F.model = this.value; apply(); });
$('fPr').addEventListener('change', function(){ F.pr = this.value; apply(); });
$('fPrMonth').addEventListener('change', function(){ F.prMonth = this.value; apply(); });
$('fFrom').addEventListener('change', function(){ F.dateFrom = this.value; apply(); });
$('fTo').addEventListener('change', function(){ F.dateTo = this.value; apply(); });
document.querySelectorAll('.seg[data-group]').forEach(function(g){
  g.addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    F[g.dataset.group] = b.dataset.val;
    g.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed', x === b); });
    if(g.dataset.group === 'recvMode') $('fldBRecv').hidden = b.dataset.val !== 'set';
    apply();
  });
});
$('fReset').addEventListener('click', function(){
  F.model = F.pr = F.prMonth = F.prState = F.date = F.dateFrom = F.dateTo = F.remain = '';
  $('fModel').value = ''; $('fPr').value = ''; $('fPrMonth').value = ''; $('fFrom').value = ''; $('fTo').value = '';
  document.querySelectorAll('.seg[data-group=prState] button, .seg[data-group=date] button, .seg[data-group=remain] button')
    .forEach(function(x){ x.setAttribute('aria-pressed', x.dataset.val === ''); });
  apply();
});
$('sort').addEventListener('change', function(){ SORT = this.value; sortRows(); renderList(true); });

/* ================= selection mode ================= */
/** รายการที่เลือก (คีย์คือลำดับแถว ไม่ใช่รหัสอะไหล่ เพราะรหัสอาจซ้ำได้) */
function selParts(){ return Object.keys(SEL).map(function(k){ return PARTS[+k]; }).filter(Boolean); }
function selCodes(){ var seen = {}, out = []; selParts().forEach(function(p){ if(!seen[p.code]){ seen[p.code] = 1; out.push(p.code); } }); return out; }

function setSelMode(on){
  SELMODE = on;
  document.body.classList.toggle('selmode', on);
  $('btnSelect').setAttribute('aria-pressed', on);
  if(!on) SEL = {};
  updateSelUI();
}
function toggleSel(key){
  if(SEL[key]) delete SEL[key]; else SEL[key] = true;
  updateSelUI();
}
function updateSelUI(){
  var n = Object.keys(SEL).length;
  $('selCount').textContent = 'เลือก ' + fmt(n);
  $('selbar').classList.toggle('open', SELMODE && n > 0);
  $('bulkAdd').disabled = !n;
  $('bulkUpd').disabled = !n;
  document.querySelectorAll('[data-key]').forEach(function(el){
    el.classList.toggle('sel-on', !!SEL[el.dataset.key]);
  });
  var nc = selCodes().length;
  $('bAddPrev').innerHTML = 'จะเพิ่ม <b>' + fmt(nc) + '</b> รายการให้อะไหล่ <b>' + fmt(nc) + '</b> รหัสที่เลือกไว้';
}
$('btnSelect').addEventListener('click', function(){ setSelMode(!SELMODE); });
$('selOff').addEventListener('click', function(){ setSelMode(false); });
$('selAll').addEventListener('click', function(){
  if(Object.keys(SEL).length === FILTERED.length) SEL = {};
  else FILTERED.forEach(function(p){ SEL[p._i] = true; });
  updateSelUI();
});
$('bulkAdd').addEventListener('click', function(){ openBulk('add'); });
$('bulkUpd').addEventListener('click', function(){ openBulk('upd'); });

/* ================= row click ================= */
function onRowClick(e){
  var el = e.target.closest('[data-key]'); if(!el) return;
  var p = PARTS[+el.dataset.key];
  if(!p) return;
  if(SELMODE){ toggleSel(p._i); return; }
  openPart(p);
}
$('list').addEventListener('click', onRowClick);
$('tbody').addEventListener('click', onRowClick);
$('tbody').addEventListener('keydown', function(e){ if(e.key === 'Enter') onRowClick(e); });

/* ================= part detail ================= */
function openPart(p){
  if(!p) return;
  curPart = p;
  $('pTitle').innerHTML = esc(p.code) + '<small>' + esc(p.name) + '</small>';
  renderPartSheet();
  openSheet($('partSheet'));
}
function renderPartSheet(){
  var p = curPart; if(!p) return;
  $('pInfo').innerHTML = statusBadge(p.status) +
    (p.model ? '<span class="tag">'+esc(p.model)+'</span>' : '') +
    (p.remark ? '<span class="tag" style="background:#FDF3E0;color:#8A4B08">'+esc(p.remark)+'</span>' : '');
  $('pSum').textContent = 'สั่ง '+fmt(p.qty)+' · เข้าแล้ว '+fmt(p.recv)+' · ค้าง '+fmt(p.remain);

  if(!p.orders.length){
    $('pList').innerHTML = '<div class="empty-sm">ยังไม่มีรายการสั่งซื้อ<br>กดปุ่ม "+ เพิ่ม PR" ด้านล่างเพื่อเพิ่ม</div>';
    return;
  }
  PARTORDER = p.orders.slice().sort(function(a,b){
    return (b.dateObj?b.dateObj.getTime():0) - (a.dateObj?a.dateObj.getTime():0);
  });
  $('pList').innerHTML = PARTORDER.map(function(o, oi){
    return '<button class="orow" data-oi="'+oi+'">' +
      '<span class="o-top">' +
        '<span class="o-pr'+(hasPr(o)?'':' none')+'">'+(hasPr(o)?esc(o.pr):'ยังไม่ใส่เลข PR')+'</span>' +
        (o.dateObj ? '<span class="tag'+(o.late?' late':'')+'">'+icon(o.late?'alert':'cal')+fmtDateShort(o.dateObj)+'</span>' : '') +
      '</span>' +
      (o.po ? '<span class="o-meta">'+esc(poText(o.po))+'</span>' : '') +
      (o.note ? '<span class="o-note">'+esc(o.note)+'</span>' : '') +
      '<span class="o-foot">' +
        '<span>สั่ง <b class="num">'+fmt(o.qty)+'</b></span>' +
        '<span>เข้าแล้ว <b class="num">'+fmt(o.recv)+'</b></span>' +
        '<span class="'+(o.remain>0?'warn':(o.qty>0?'done':''))+'">ค้าง <b class="num">'+fmt(o.remain)+'</b></span>' +
        (o.updated ? '<span class="upd">อัปเดต '+esc(o.updated)+'</span>' : '') +
      '</span>' +
    '</button>';
  }).join('');
}
$('pList').addEventListener('click', function(e){
  var el = e.target.closest('[data-oi]'); if(!el) return;
  // เปิดใบที่แสดงอยู่จริงในลิสต์ — ไม่อ้าง Map ด้วย ID เพราะถ้าในชีตมี ID ซ้ำจะเปิดผิดใบ
  var o = PARTORDER[+el.dataset.oi];
  if(o) openOrder(o);
});
$('pAdd').addEventListener('click', function(){ if(curPart) openOrder(null); });

/* ================= order edit ================= */
function openOrder(o){
  editing = o;
  var p = curPart;
  $('oTitle').textContent = o ? (hasPr(o) ? o.pr : 'แก้ไข PR') : 'เพิ่ม PR ใหม่';
  $('oPr').value = o ? o.pr : '';
  $('oPo').value = o ? o.po : '';
  $('oQty').value = o ? o.qty : '';
  $('oRecv').value = o ? o.recv : '';
  $('oDate').value = o && o.dateObj ? toISO(o.dateObj) : '';
  $('oNote').value = o ? o.note : '';
  var del = $('oDel');
  del.hidden = !o;
  del.classList.remove('armed');
  del.innerHTML = icon('trash') + 'ลบ';
  validateOrder();
  openSheet($('orderSheet'));
}
function validateOrder(){
  var q = $('oQty').value, rc = $('oRecv').value;
  var qn = q===''?0:Number(q), rn = rc===''?0:Number(rc);
  var badQ = q!=='' && (isNaN(qn) || qn < 0);
  var badR = rc!=='' && (isNaN(rn) || rn < 0 || rn > qn);
  $('fldQty').classList.toggle('invalid', badQ);
  $('fldRecv').classList.toggle('invalid', badR);
  $('oRemain').textContent = fmt(Math.max(0, qn - rn));
  $('oSave').disabled = badQ || badR;
  return !(badQ || badR);
}
['oQty','oRecv'].forEach(function(id){ $(id).addEventListener('input', validateOrder); });

$('oSave').addEventListener('click', function(){
  if(!validateOrder()) return;
  var btn = this, p = curPart;
  var v = {
    pr: $('oPr').value.trim(), po: $('oPo').value.trim(),
    qty: $('oQty').value, recv: $('oRecv').value,
    date: $('oDate').value ? toTh(parseDate($('oDate').value)) : '',
    note: $('oNote').value.trim()
  };
  busy(btn, true);
  var req = { code: p.code, pr:v.pr, po:v.po, qty:v.qty, recv:v.recv, date:v.date, note:v.note };
  if(editing) req.id = editing.id;
  gsr()
    .withSuccessHandler(function(rec){
      busy(btn, false);
      attachOrder(rec);
      closeSheet($('orderSheet'));
      renderPartSheet(); apply();
      toast((editing ? 'แก้ไข ' : 'เพิ่ม ') + (v.pr || p.code) + (editing ? ' แล้ว' : ' เรียบร้อย'));
    })
    .withFailureHandler(function(e){
      busy(btn, false);
      validateOrder();
      toast('บันทึกไม่สำเร็จ: ' + e.message, true);
    })
    .saveOrder(req);
});

$('oDel').addEventListener('click', function(){
  var btn = this;
  if(!btn.classList.contains('armed')){
    btn.classList.add('armed');
    btn.innerHTML = icon('alert') + 'ยืนยันลบ';
    setTimeout(function(){ if(btn.classList.contains('armed')){ btn.classList.remove('armed'); btn.innerHTML = icon('trash') + 'ลบ'; } }, 4000);
    return;
  }
  var o = editing;
  if(!o) return;
  busy(btn, true, 'กำลังลบ…');
  gsr()
    .withSuccessHandler(function(){
      removeOrder(o.id);
      closeSheet($('orderSheet'));
      renderPartSheet(); apply();
      toast('ลบ ' + (hasPr(o) ? o.pr : o.code) + ' แล้ว');
    })
    .withFailureHandler(function(e){ busy(btn, false); toast('ลบไม่สำเร็จ: ' + e.message, true); })
    .deleteOrder(o.id);
});

/** ผูกแถวที่บันทึกกลับมาเข้ากับอะไหล่ แล้วคำนวณใหม่ */
function attachOrder(rec){
  if(!rec) return;
  var o = BYID[rec[0]];
  if(o){
    o.pr = rec[2]; o.po = rec[3]; o.qty = num(rec[4]); o.recv = num(rec[5]);
    o.date = rec[6]; o.note = rec[7]; o.updated = rec[8];
  } else {
    o = { id:rec[0], code:rec[1], pr:rec[2], po:rec[3], qty:num(rec[4]), recv:num(rec[5]),
          date:rec[6], note:rec[7], updated:rec[8] };
    BYID[o.id] = o;
    var p = BYCODE[o.code];
    if(p) p.orders.push(o);
  }
  var k = stampKey(o.updated);
  if(k > SYS_UPD_KEY){ SYS_UPD_KEY = k; SYS_UPD = o.updated; }
  refreshSubsystem();
}
function removeOrder(id){
  var o = BYID[id]; if(!o) return;
  delete BYID[id];
  PARTS.forEach(function(p){
    var i = p.orders.indexOf(o);
    if(i > -1) p.orders.splice(i, 1);
  });
  refreshSubsystem();
}
function refreshSubsystem(){
  PARTS.forEach(recompute);
  buildSelects();
  if(SELMODE) updateSelUI();
}

/* ================= คีย์ใบ PR ================= */
/* ใบ PR = ข้อมูลใบเดียว (เลข PR/PO/กำหนดเข้า/หมายเหตุ) + รายการอะไหล่ที่มีจำนวนสั่งของตัวเอง */
var KEY = { pr:'', po:'', date:'', note:'', qtyDef:'', items:[] };
var KEYUNDO = null;            // ย้อนกลับได้ 1 ขั้น: { orders:[id], created:[code], snap:{...} }
var kSeq = 0, kTimer = null, lastQtyDef = '';

function keyByCode(code){ for(var i=0;i<KEY.items.length;i++) if(KEY.items[i].code === code) return KEY.items[i]; return null; }
function keyByKey(k){ for(var i=0;i<KEY.items.length;i++) if(KEY.items[i].key === k) return KEY.items[i]; return null; }

/** ดึงค่าจากช่องกรอกกลับเข้า KEY (วันที่เก็บเป็น ค.ศ. ตามที่บันทึกลงชีต) */
function keyRead(){
  KEY.pr = $('kPr').value.trim().toUpperCase();
  KEY.po = $('kPo').value.trim();
  KEY.date = $('kDate').value ? toTh(parseDate($('kDate').value)) : '';
  KEY.note = $('kNote').value.trim();
  KEY.qtyDef = $('kQtyDef').value.trim();
}
function keyWrite(){
  $('kPr').value = KEY.pr;
  $('kPo').value = KEY.po;
  $('kDate').value = KEY.date ? toISO(parseDate(KEY.date)) : '';
  $('kNote').value = KEY.note;
  $('kQtyDef').value = KEY.qtyDef;
  lastQtyDef = KEY.qtyDef;
}
function keyClear(){
  KEY = { pr:'', po:'', date:'', note:'', qtyDef:'', items:[] };
  keyWrite();
  $('kQ').value = '';
  $('kSearchBox').classList.remove('has-value');
  renderKey();
}
/** เลข PR ถัดไปของเดือนนี้ = PR + ปี 2 หลัก + เดือน 2 หลัก + ลำดับ 4 หลัก (นับเฉพาะเดือนนี้) */
function nextPrNo(){
  var now = new Date();
  var ym = pad2(now.getFullYear() % 100) + pad2(now.getMonth() + 1);
  var max = 0, seen = {};
  PARTS.forEach(function(p){
    p.prs.forEach(function(pr){
      if(seen[pr]) return;
      seen[pr] = 1;
      var m = prMonth(pr);
      if(!m || m.key !== ym) return;
      var seq = parseInt(String(pr).replace(/^PR\d{4}/, ''), 10);   // ตัด "PRyy" ออก เหลือเลขลำดับ 4 หลัก
      if(isFinite(seq) && seq > max) max = seq;
    });
  });
  var s = String(max + 1);
  while(s.length < 4) s = '0' + s;
  return 'PR' + ym + s;
}

/* ---------- ค้นหาและเลือกอะไหล่ ---------- */
function keySearch(q){
  var s = String(q || '').trim().toLowerCase();
  if(!s) return [];
  var seen = {}, out = [];
  for(var i=0;i<PARTS.length;i++){
    var p = PARTS[i];
    if(p.hay.indexOf(s) < 0) continue;
    var g = seen[p.code];
    if(g){                                  // รหัสซ้ำในชีต (คนละ model) — แสดงแถวเดียว แต่รวม model ให้ครบ
      if(p.model && g.models.indexOf(p.model) < 0) g.models.push(p.model);
      continue;
    }
    p.models = p.model ? [p.model] : [];
    seen[p.code] = p;
    out.push(p);
  }
  out.sort(function(a, b){
    var d = (b.remain > 0 ? 1 : 0) - (a.remain > 0 ? 1 : 0);   // อะไหล่ที่ยังค้างเข้าขึ้นก่อน
    if(d) return d;
    return a.code < b.code ? -1 : (a.code > b.code ? 1 : 0);
  });
  return out.slice(0, 30);
}
/** ป้าย PR ค้างของอะไหล่ เพื่อกันเพิ่มรหัสซ้ำโดยไม่ตั้งใจ */
function keyPrLine(p){
  var open = 0;
  p.orders.forEach(function(o){ if(hasPr(o) && o.remain > 0) open++; });
  var t = open ? ('ค้าง ' + fmt(open) + ' ใบ · ' + p.prs.join(', '))
        : p.prs.length ? ('เข้าครบแล้ว ' + fmt(p.prs.length) + ' ใบ · ' + p.prs.join(', '))
        : 'ยังไม่มี PR';
  return '<span class="kres-pr' + (p.late ? ' late' : '') + '">' + esc(t) + '</span>';
}
function renderKeyResults(){
  var box = $('kResults');
  var q = $('kQ').value.trim();
  if(!q){
    box.innerHTML = '<div class="empty-sm">พิมพ์รหัสหรือชื่ออะไหล่ที่ต้องการเพิ่ม แล้วกดที่รายการนั้น</div>';
    return;
  }
  var list = keySearch(q), html = '';
  var exact = null;
  for(var i=0;i<list.length;i++) if(list[i].code.toLowerCase() === q.toLowerCase()){ exact = list[i]; break; }

  html += list.map(function(p){
    var picked = !!keyByCode(p.code);
    var md = (p.models && p.models.length) ? p.models.join(' / ') : p.model;
    return '<button type="button" class="kres' + (picked ? ' picked' : '') + '" data-key-add="' + esc(p.code) + '" aria-pressed="' + (picked ? 'true' : 'false') + '">' +
      '<span class="kbox">' + icon('check') + '</span>' +
      '<span class="kres-main"><span class="kres-code">' + esc(p.code) + '</span>' +
      '<span class="kres-name">' + esc(p.name || '—') + (md ? ' · ' + esc(md) : '') + '</span></span>' +
      '<span class="kres-side">' + statusBadge(p.status) + keyPrLine(p) + '</span></button>';
  }).join('');

  if(!exact){   // ไม่มีในระบบ — ให้เพิ่มอะไหล่ใหม่ได้เลย
    html += '<div class="knew"><div class="knew-txt">ไม่พบ “' + esc(q) + '” ในระบบ</div>' +
      '<button type="button" class="btn" data-key-new="' + esc(q) + '">+ เพิ่มรหัสใหม่ลงระบบ</button></div>';
  }
  box.innerHTML = html;
}

/* ---------- รายการในใบ PR ---------- */
function keyStatusOptions(){
  var seen = {}, out = [];
  ['NON MOVE', 'SLOW MOVE', 'FAST MOVE'].forEach(function(s){ seen[s] = 1; out.push(s); });
  PARTS.forEach(function(p){ if(p.status && !seen[p.status]){ seen[p.status] = 1; out.push(p.status); } });
  return out;
}
function qtyBad(v){
  if(v === '' || v == null) return true;
  var n = Number(v);
  return !isFinite(n) || n < 1 || Math.floor(n) !== n;
}
function renderKeyItems(){
  var box = $('kItems');
  $('kCount').textContent = fmt(KEY.items.length) + ' รายการ';
  if(!KEY.items.length){
    box.innerHTML = '<div class="empty-sm">ยังไม่ได้เพิ่มอะไหล่ — ค้นหาจากช่องด้านบนแล้วกดที่รายการที่ต้องการ</div>';
    return;
  }
  var sts = keyStatusOptions();
  box.innerHTML = KEY.items.map(function(it){
    var bad = qtyBad(it.qty);
    var head = '<div class="kitem-top">' +
      '<div class="kitem-main"><div class="kitem-code">' + esc(it.code) +
        (it.isNew ? ' <span class="tag new-tag">ใหม่</span>' : '') + '</div>' +
      '<span class="kitem-name">' + esc(it.name || it.code) + (it.model ? ' · ' + esc(it.model) : '') + '</span></div>' +
      '<div class="qtybox"><label class="sr-only" for="kq_' + esc(it.key) + '">จำนวนสั่ง ' + esc(it.code) + '</label>' +
      '<input id="kq_' + esc(it.key) + '" type="number" inputmode="numeric" min="1" step="1" placeholder="0" value="' + esc(it.qty) + '"' +
      (bad ? ' class="bad"' : '') + ' data-kqty="' + esc(it.key) + '"></div>' +
      '<button type="button" class="kitem-del" data-kdel="' + esc(it.key) + '" aria-label="เอา ' + esc(it.code) + ' ออกจากใบ PR">' + icon('trash') + '</button>' +
      '</div>';

    var nw = '';
    if(it.isNew){
      nw = '<div class="kitem-new">' +
        '<div class="field"><label for="kn_' + esc(it.key) + '_n">ชื่ออะไหล่</label>' +
          '<input id="kn_' + esc(it.key) + '_n" list="kModels" data-kfield="name" data-ki="' + esc(it.key) + '" value="' + esc(it.name) + '" placeholder="ถ้าว่างจะใช้รหัสแทน"></div>' +
        '<div class="row2">' +
          '<div class="field"><label for="kn_' + esc(it.key) + '_m">Model</label>' +
            '<input id="kn_' + esc(it.key) + '_m" list="kModels" data-kfield="model" data-ki="' + esc(it.key) + '" value="' + esc(it.model) + '" placeholder="COMMON"></div>' +
          '<div class="field"><label for="kn_' + esc(it.key) + '_s">Status</label>' +
            '<select id="kn_' + esc(it.key) + '_s" data-kfield="status" data-ki="' + esc(it.key) + '">' +
            '<option value="">- ไม่ระบุ -</option>' +
            sts.map(function(s){ return '<option value="' + esc(s) + '"' + (it.status === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
            '</select></div>' +
        '</div></div>';
    }
    return '<div class="kitem' + (it.isNew ? ' new' : '') + '">' + head + nw + '</div>';
  }).join('');
}

function renderKeySum(){
  var n = KEY.items.length, total = 0, missing = 0;
  KEY.items.forEach(function(it){
    if(qtyBad(it.qty)) missing++;
    else total += Number(it.qty);
  });
  $('kSum').innerHTML = n
    ? 'บันทึก <b>' + fmt(n) + '</b> รายการ · สั่งรวม <b>' + fmt(total) + '</b> ชิ้น' +
      (missing ? ' <span class="miss">· ยังขาดจำนวนสั่ง ' + fmt(missing) + ' รายการ</span>' : '')
    : 'ยังไม่มีรายการ';
  $('kSave').disabled = n === 0 || missing > 0;
  $('kUndo').disabled = !KEYUNDO;
}
function fillKeyModels(){
  var seen = {}, out = [];
  PARTS.forEach(function(p){ if(p.model && !seen[p.model]){ seen[p.model] = 1; out.push(p.model); } });
  out.sort();
  $('kModels').innerHTML = out.map(function(m){ return '<option value="' + esc(m) + '"></option>'; }).join('');
}
function renderKey(){
  renderKeyResults();
  renderKeyItems();
  renderKeySum();
}

function keyAdd(code, isNew){
  if(keyByCode(code)){ toast(code + ' อยู่ในใบ PR นี้แล้ว', true); return; }
  var it = { key:'k' + (++kSeq), code:code, qty:KEY.qtyDef || '', touched:false, isNew:!!isNew, model:'', name:'', status:'' };
  if(isNew){
    it.name = '';
  } else {
    var p = BYCODE[code];
    if(p){ it.model = p.model; it.name = p.name; it.status = p.status; }
  }
  KEY.items.push(it);
  renderKeyItems();
  renderKeySum();
  renderKeyResults();
  var inp = document.getElementById('kq_' + it.key);
  if(inp) inp.scrollIntoView({ block:'nearest' });
}
function keyRemove(k){
  KEY.items = KEY.items.filter(function(it){ return it.key !== k; });
  renderKeyItems();
  renderKeySum();
  renderKeyResults();
}

/* ---------- บันทึก / ย้อนกลับ ---------- */
/** ลงอะไหล่ใหม่ที่เพิ่งสร้างเข้า PARTS ทันที เพื่อให้แถว PR ที่บันทึกกลับมาผูกได้ */
function addPartRow(r){
  var code = String(r[1] || '').trim();
  if(!code || BYCODE[code]) return;
  var p = { model:r[0], code:code, name:r[2], remark:(r[3] === '-' ? '' : r[3]), status:r[4], orders:[], _i:PARTS.length };
  PARTS.push(p);
  BYCODE[code] = p;
  recompute(p);
}
/** จัดลำดับ index (data-key) ของอะไหล่ใหม่ทั้งชุด — ใช้หลังลบอะไหล่ออกจาก PARTS */
function reindexParts(){
  PARTS.forEach(function(p, i){ p._i = i; });
  var keep = {};
  Object.keys(SEL).forEach(function(k){ if(PARTS[+k]) keep[k] = true; });
  SEL = keep;
}
/** คำนวณเวลา "อัปเดตล่าสุด" ใหม่ทั้งระบบ (ใช้หลังย้อนกลับ) */
function restamp(){
  var best = 0, txt = '';
  for(var id in BYID){
    var k = stampKey(BYID[id].updated);
    if(k > best){ best = k; txt = BYID[id].updated; }
  }
  SYS_UPD_KEY = best;
  SYS_UPD = txt;
}

$('kSave').addEventListener('click', function(){
  var btn = this;
  keyRead();
  if(!KEY.pr){ toast('กรุณากรอกเลข PR', true); $('kPr').focus(); return; }
  if(!KEY.items.length){ toast('ยังไม่ได้เพิ่มอะไหล่', true); return; }
  var bad = null;
  for(var i=0;i<KEY.items.length;i++) if(qtyBad(KEY.items[i].qty)){ bad = KEY.items[i]; break; }
  if(bad){
    toast('ยังไม่ได้ใส่จำนวนสั่งของ ' + bad.code, true);
    var inp = document.getElementById('kq_' + bad.key);
    if(inp){ inp.focus(); inp.scrollIntoView({ block:'center' }); }
    return;
  }
  var snap = { pr:KEY.pr, po:KEY.po, date:KEY.date, note:KEY.note, qtyDef:KEY.qtyDef,
               items:KEY.items.map(function(it){ var c = {}; for(var k in it) c[k] = it[k]; return c; }) };
  var payload = {
    pr:KEY.pr, po:KEY.po, date:KEY.date, note:KEY.note,
    items:KEY.items.map(function(it){
      return { code:it.code, qty:Number(it.qty), model:it.model, name:it.name, status:it.status };
    })
  };
  var prTxt = KEY.pr, n = KEY.items.length;

  busy(btn, true);
  gsr()
    .withSuccessHandler(function(res){
      busy(btn, false);
      (res.parts || []).forEach(addPartRow);
      (res.orders || []).forEach(attachOrder);
      var nc = (res.created || []).length;
      KEYUNDO = { orders:(res.orders || []).map(function(r){ return r[0]; }), created:res.created || [], snap:snap };
      keyClear();
      apply();
      toast('บันทึก ' + prTxt + ' ให้ ' + fmt(n) + ' รายการ' + (nc ? ' · อะไหล่ใหม่ ' + fmt(nc) + ' รหัส' : ''));
      renderKeySum();
    })
    .withFailureHandler(function(e){ busy(btn, false); toast('บันทึกไม่สำเร็จ: ' + e.message, true); })
    .savePrBatch(payload);
});

$('kUndo').addEventListener('click', function(){
  var btn = this, u = KEYUNDO;
  if(!u) return;
  busy(btn, true, 'กำลังย้อนกลับ…');
  gsr()
    .withSuccessHandler(function(res){
      busy(btn, false);
      (u.orders || []).forEach(removeOrder);
      var removed = false;
      (u.created || []).forEach(function(code){
        var p = BYCODE[code];
        if(!p || p.orders.length) return;              // ยังมี PR อื่นของอะไหล่นี้อยู่ เก็บไว้
        PARTS = PARTS.filter(function(x){ return x !== p; });
        delete BYCODE[code];
        removed = true;
      });
      if(removed) reindexParts();                      // ลบแล้วจัด index ใหม่ ไม่ให้ data-key เพี้ยน
      restamp();
      KEY = u.snap;
      keyWrite();
      KEYUNDO = null;
      apply();
      renderKey();
      toast('ย้อนกลับแล้ว ลบ ' + fmt(res && res.removedOrders != null ? res.removedOrders : u.orders.length) + ' รายการ');
    })
    .withFailureHandler(function(e){ busy(btn, false); toast('ย้อนกลับไม่สำเร็จ: ' + e.message, true); })
    .undoPrBatch(u.orders, u.created);
});

$('kClear').addEventListener('click', function(){
  if(KEY.items.length && !confirm('ล้างรายการที่เพิ่มในใบ PR นี้ทั้งหมดใช่หรือไม่?')) return;
  keyClear();
});

$('kPrSuggest').addEventListener('click', function(){
  $('kPr').value = nextPrNo();
  keyRead();
  renderKeySum();
  $('kPr').focus();
});

/* ---------- ช่องกรอก ---------- */
function keySyncForm(){
  keyRead();
  if(KEY.qtyDef !== lastQtyDef){                       // ค่าเริ่มต้นเปลี่ยน → ดันไปให้แถวที่ยังไม่แก้เอง
    lastQtyDef = KEY.qtyDef;
    KEY.items.forEach(function(it){ if(!it.touched) it.qty = KEY.qtyDef; });
    renderKeyItems();
  }
  renderKeySum();
}
['kPr', 'kPo', 'kDate', 'kQtyDef', 'kNote'].forEach(function(id){
  $(id).addEventListener('input', keySyncForm);
});

$('kQ').addEventListener('input', function(){
  $('kSearchBox').classList.toggle('has-value', !!this.value);
  clearTimeout(kTimer);
  kTimer = setTimeout(renderKeyResults, 160);
});
$('kQ').addEventListener('keydown', function(e){
  if(e.key !== 'Enter') return;
  e.preventDefault();
  var list = keySearch(this.value.trim());
  if(!list.length) return;
  var target = list[0];
  for(var i=0;i<list.length;i++) if(list[i].code.toLowerCase() === this.value.trim().toLowerCase()){ target = list[i]; break; }
  keyAdd(target.code, false);
});
$('kQClear').addEventListener('click', function(){
  $('kQ').value = '';
  $('kSearchBox').classList.remove('has-value');
  $('kQ').focus();
  renderKeyResults();
});

/* ---------- คลิกในรายการผลค้นหา ---------- */
$('kResults').addEventListener('click', function(e){
  var add = e.target.closest('[data-key-add]');
  if(add){
    var code = add.dataset.keyAdd;
    var it = keyByCode(code);
    if(it) keyRemove(it.key); else keyAdd(code, false);
    return;
  }
  var nw = e.target.closest('[data-key-new]');
  if(nw){
    var nc = nw.dataset.keyNew.trim().toUpperCase();
    $('kQ').value = '';
    $('kSearchBox').classList.remove('has-value');
    renderKeyResults();
    keyAdd(nc, true);
    var f = document.querySelector('.kitem.new input[data-kfield="name"]');
    if(f) f.focus();
  }
});

/* ---------- แถวรายการในใบ PR ---------- */
$('kItems').addEventListener('click', function(e){
  var d = e.target.closest('[data-kdel]');
  if(d) keyRemove(d.dataset.kdel);
});
$('kItems').addEventListener('input', function(e){
  var t = e.target;
  if(t.dataset.kqty){                                   // จำนวนสั่ง — ไม่วาดใหม่ กรอกต่อได้
    var it = keyByKey(t.dataset.kqty);
    if(!it) return;
    it.qty = t.value.trim();
    it.touched = true;
    t.classList.toggle('bad', qtyBad(it.qty));
    renderKeySum();
    return;
  }
  if(t.dataset.kfield){                                 // ข้อมูลอะไหล่ใหม่ — เก็บลง state เฉยๆ
    var it2 = keyByKey(t.dataset.ki);
    if(it2) it2[t.dataset.kfield] = t.value.trim();
  }
});

/* ================= bulk edit ================= */
function openBulk(mode){
  var parts = selParts();
  if(!parts.length){ toast('ยังไม่ได้เลือกรายการ', true); return; }
  bulkMode = mode;
  $('bulkTabs').querySelectorAll('button').forEach(function(b){ b.setAttribute('aria-selected', b.dataset.bulk === mode); });
  $('bulkAddPane').hidden = mode !== 'add';
  $('bulkUpdPane').hidden = mode !== 'upd';
  $('bTitle').textContent = mode === 'add' ? 'เพิ่ม PR ให้รายการที่เลือก' : 'อัปเดต PR ของรายการที่เลือก';

  if(mode === 'upd'){
    var prs = {}, seen = {};
    parts.forEach(function(p){
      p.orders.forEach(function(o){ if(hasPr(o) && !seen[o.id]){ seen[o.id] = 1; prs[o.pr] = (prs[o.pr]||0)+1; } });
    });
    var list = Object.keys(prs).sort();
    $('bSelPr').innerHTML = '<option value="">ทุก PR ของรายการที่เลือก</option>' +
      list.map(function(x){ return '<option value="'+esc(x)+'">'+esc(x)+' ('+fmt(prs[x])+' รายการ)</option>'; }).join('');
  }
  updateBulkPrev();
  openSheet($('bulkSheet'));
}
function bulkIds(){
  var ids = [], seen = {};
  var want = $('bSelPr').value;
  selParts().forEach(function(p){
    p.orders.forEach(function(o){
      if(seen[o.id]) return;
      if(!want || o.pr === want){ seen[o.id] = 1; ids.push(o.id); }
    });
  });
  return ids;
}
function updateBulkPrev(){
  var n = selCodes().length;
  if(bulkMode === 'add'){
    $('bAddPrev').innerHTML = 'จะเพิ่ม <b>' + fmt(n) + '</b> รายการให้อะไหล่ <b>' + fmt(n) + '</b> รหัสที่เลือกไว้';
    return;
  }
  var ids = bulkIds();
  $('bUpdPrev').innerHTML = 'จะอัปเดต <b>' + fmt(ids.length) + '</b> รายการ' +
    (n ? ' จากอะไหล่ <b>' + fmt(n) + '</b> รหัส' : '');
}
$('bulkTabs').addEventListener('click', function(e){
  var b = e.target.closest('button'); if(!b) return;
  openBulk(b.dataset.bulk);
});
$('bSelPr').addEventListener('change', updateBulkPrev);
$('bQtyOn').addEventListener('change', function(){ $('fldBQty').hidden = !this.checked; });

$('bSave').addEventListener('click', function(){
  var btn = this, codes = selCodes();
  if(!codes.length){ toast('ยังไม่ได้เลือกรายการ', true); return; }
  busy(btn, true);

  if(bulkMode === 'add'){
    var f = {
      pr: $('bPr').value.trim(), po: $('bPo').value.trim(),
      qty: $('bQtyOn').checked ? $('bQty').value : '',
      recv: '', date: $('bDate').value ? toTh(parseDate($('bDate').value)) : '',
      note: $('bNote').value.trim()
    };
    if(!f.pr && !f.po && !f.date && !f.note && !f.qty){ busy(btn, false); toast('กรุณากรอกอย่างน้อย 1 ช่อง', true); return; }
    gsr()
      .withSuccessHandler(function(recs){
        busy(btn, false);
        (recs||[]).forEach(attachOrder);
        closeSheet($('bulkSheet'));
        setSelMode(false);
        apply();
        toast('เพิ่ม ' + fmt(recs ? recs.length : 0) + ' รายการเรียบร้อย');
      })
      .withFailureHandler(function(e){ busy(btn, false); toast('เพิ่มไม่สำเร็จ: ' + e.message, true); })
      .bulkAddOrders(codes, f);
    return;
  }

  var ids = bulkIds();
  if(!ids.length){ busy(btn, false); toast('ไม่พบรายการที่จะอัปเดต', true); return; }
  var f2 = {};
  var po = $('bUPo').value.trim();   if(po) f2.po = po;
  var du = $('bUDate').value;        if(du) f2.date = toTh(parseDate(du));
  var nt = $('bUNote').value.trim();  if(nt) f2.note = nt;
  var rm = document.querySelector('.seg[data-group=recvMode] button[aria-pressed="true"]').dataset.val;
  if(rm === 'full') f2.recvFull = true;
  else if(rm === 'set'){
    var rv = $('bRecv').value;
    if(rv === ''){ busy(btn, false); toast('กรุณากรอกจำนวนเข้าแล้ว', true); return; }
    f2.recv = rv;
  }
  if(!Object.keys(f2).length){ busy(btn, false); toast('กรุณาเลือกอย่างน้อย 1 ช่องที่จะแก้', true); return; }

  gsr()
    .withSuccessHandler(function(recs){
      busy(btn, false);
      (recs||[]).forEach(attachOrder);
      closeSheet($('bulkSheet'));
      setSelMode(false);
      apply();
      toast('อัปเดต ' + fmt(recs ? recs.length : 0) + ' รายการเรียบร้อย');
    })
    .withFailureHandler(function(e){ busy(btn, false); toast('อัปเดตไม่สำเร็จ: ' + e.message, true); })
    .bulkUpdateOrders(ids, f2);
});

/* ================= นำเข้าข้อมูลจากไฟล์ ================= */
/** คอลัมน์ที่อ่านได้ — ต้องตรงกับ IMPORT_COLS ใน Code.gs */
var IM_COLS = [
  { key:'code', label:'รหัสอะไหล่',   alias:['รหัสอะไหล่','รหัส','รหัสสินค้า','code','part','partno','partnumber','itemcode'] },
  { key:'pr',   label:'เลข PR',       alias:['เลขpr','pr','เลขที่pr','prno','prnumber','เลขพรี','ใบขอซื้อ','ใบสั่งซื้อ'] },
  { key:'po',   label:'เลข PO',       alias:['เลขpo','po','เลขที่po','pono','ponumber'] },
  { key:'qty',  label:'จำนวนสั่ง',     alias:['จำนวนสั่ง','จำนวน','จำนวนสั่งชิ้น','จำนวนสั่งชิ้น','qty','orderqty','quantity'] },
  { key:'recv', label:'จำนวนเข้าแล้ว', alias:['จำนวนเข้าแล้ว','จำนวนเข้า','เข้าแล้ว','รับแล้ว','recv','received','receiveqty'] },
  { key:'date', label:'กำหนดเข้า',    alias:['กำหนดเข้า','กำหนด','วันกำหนด','วันกำหนดเข้า','due','duedate','delivery'] },
  { key:'note', label:'หมายเหตุ',     alias:['หมายเหตุ','หมายเหตุ','note','notes','remark','comment','comments'] }
];
var IM_MAX = 5000;
var IM = { name:'', headers:[], rows:[], ix:{}, counts:null };

function imKey(s){ return String(s==null?'':s).toLowerCase().replace(/[\s_\-.,]/g,''); }
function imCell(v){ return String(v==null?'':v).trim(); }

/** จับคู่ชื่อหัวคอลัมน์กับคอลัมน์ที่ระบบรู้จัก */
function imMapHeaders(headers){
  var nk = headers.map(imKey), ix = {};
  IM_COLS.forEach(function(c){
    for(var i=0;i<nk.length;i++){ if(nk[i] && c.alias.indexOf(nk[i]) > -1){ ix[c.key] = i; return; } }
  });
  return ix;
}

/** เดาตัวคั่นจากแถวหัวคอลัมน์ — รองรับทั้ง , ; tab และ | */
function imPickDelim(text){
  var line = (text.split(/\r?\n/).filter(function(l){ return l.trim(); })[0]) || '';
  var best = ',', n = 0;
  [',',';','\t','|'].forEach(function(d){
    var c = 0, q = false;
    for(var i=0;i<line.length;i++){
      var ch = line[i];
      if(ch === '"') q = !q;
      else if(ch === d && !q) c++;
    }
    if(c > n){ n = c; best = d; }
  });
  return best;
}

/** แปลง CSV เป็นตาราง — รองรับ BOM, เครื่องหมายคำพูด, ช่องที่มีลูกน้ำ/ขึ้นบรรทัดใหม่ และ CRLF */
function imParseCsv(text){
  if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  var d = imPickDelim(text);
  var rows = [], row = [], f = '', i = 0, q = false;
  while(i < text.length){
    var ch = text[i];
    if(q){
      if(ch === '"'){
        if(text[i+1] === '"'){ f += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      f += ch; i++; continue;
    }
    if(ch === '"'){ q = true; i++; continue; }
    if(ch === d){ row.push(f); f = ''; i++; continue; }
    if(ch === '\r' || ch === '\n'){
      if(ch === '\r' && text[i+1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = ''; i++; continue;
    }
    f += ch; i++;
  }
  if(f !== '' || row.length){ row.push(f); rows.push(row); }
  return rows;
}

/** อ่านไฟล์เป็นข้อความ — ถ้าไม่ใช่ UTF-8 (ไฟล์จาก Excel ภาษาไทย) ใช้ TIS-620/windows-874 แทน */
function imRead(file){
  return new Promise(function(resolve, reject){
    var fr = new FileReader();
    fr.onerror = function(){ reject(new Error('เปิดไฟล์ไม่สำเร็จ')); };
    fr.onload = function(){
      var buf = fr.result, text = '';
      try { text = new TextDecoder('utf-8', { fatal:true }).decode(buf); }
      catch(e){
        try { text = new TextDecoder('windows-874').decode(buf); }
        catch(e2){ text = new TextDecoder('utf-8').decode(buf); }
      }
      resolve(text);
    };
    fr.readAsArrayBuffer(file);
  });
}

/** นับว่าจะเข้าได้กี่แถว / ข้ามกี่แถว โดยเช็ครหัสอะไหล่กับข้อมูลที่โหลดมาแล้ว */
function imCount(){
  var ix = IM.ix;
  var c = { added:0, unknown:0, noCode:0, blank:0, unknownList:[] };
  var unk = {};
  IM.rows.forEach(function(r){
    var any = false;
    for(var i=0;i<r.length;i++) if(imCell(r[i])){ any = true; break; }
    if(!any){ c.blank++; return; }
    var code = imCell(r[ix.code]);
    if(!code){ c.noCode++; return; }
    if(!BYCODE[code]){ c.unknown++; unk[code] = true; return; }
    c.added++;
  });
  c.unknownList = Object.keys(unk);
  return c;
}

function imRender(){
  var box = $('imPreview'), foot = $('imGo');
  box.hidden = false;
  foot.hidden = false;

  var h = '<div class="im-name"><b>' + esc(IM.name) + '</b><span class="muted">หัวคอลัมน์ ' +
    fmt(IM.headers.length) + ' ช่อง · ข้อมูล ' + fmt(IM.rows.length) + ' แถว</span></div>';

  h += '<div class="im-cols">' + IM_COLS.map(function(c){
    var on = IM.ix[c.key] != null;
    return '<b class="' + (on ? 'on' : 'off') + '">' + (on ? icon('check') : '') + esc(c.label) + '</b>';
  }).join('') + '</div>';

  if(IM.ix.code == null){
    box.innerHTML = h + '<div class="preview">ไม่พบคอลัมน์ <b>รหัสอะไหล่</b> ในไฟล์นี้<br><small>หัวคอลัมน์ที่อ่านได้: ' +
      esc(IM.headers.filter(String).join(' | ')) + '</small></div>';
    foot.hidden = true;
    return;
  }

  var c = IM.counts;
  h += '<div class="im-stat">'
     + '<div class="good"><b class="num">' + fmt(c.added) + '</b><span>จะนำเข้า</span></div>'
     + (c.unknown ? '<div class="bad"><b class="num">' + fmt(c.unknown) + '</b><span>ข้าม · รหัสไม่มีในระบบ</span></div>' : '')
     + (c.noCode ? '<div class="bad"><b class="num">' + fmt(c.noCode) + '</b><span>ข้าม · ไม่มีรหัสอะไหล่</span></div>' : '')
     + '</div>';

  var cols = IM_COLS.filter(function(c2){ return IM.ix[c2.key] != null; });
  h += '<div class="im-tblwrap"><table class="im-tbl"><thead><tr><th>นำเข้า?</th>' +
       cols.map(function(c2){ return '<th>' + esc(c2.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
  IM.rows.slice(0, 5).forEach(function(r){
    var code = imCell(r[IM.ix.code]);
    var good = code && !!BYCODE[code];
    h += '<tr' + (good ? '' : ' class="skip"') + '><td>' + (good ? '✓ นำเข้า' : '✕ ข้าม') + '</td>' +
         cols.map(function(c2){ return '<td>' + esc(imCell(r[IM.ix[c2.key]]) || '—') + '</td>'; }).join('') + '</tr>';
  });
  h += '</tbody></table></div>';
  if(IM.rows.length > 5) h += '<div class="help">แสดง 5 แถวแรก จากทั้งหมด ' + fmt(IM.rows.length) + ' แถว</div>';

  h += '<div class="remain-box" style="margin:var(--s3) 0 0"><span>ข้อมูลเดิมในชีต</span>' +
       '<span class="v" style="font-size:15px">ยังอยู่ครบ · ต่อท้ายท้ายสุด</span></div>';
  if(c.unknownList.length){
    h += '<div class="help" style="margin-top:var(--s2)">รหัสที่จะถูกข้าม: ' +
         esc(c.unknownList.slice(0, 12).join(', ')) + (c.unknownList.length > 12 ? ' …' : '') +
         ' — เพิ่มในระบบก่อนแล้วนำเข้าใหม่ได้</div>';
  }

  box.innerHTML = h;
  foot.hidden = c.added === 0;
  foot.dataset.label = 'นำเข้า ' + fmt(c.added) + ' แถว';
  foot.querySelector('.t').textContent = foot.dataset.label;
}

function imReset(){
  IM = { name:'', headers:[], rows:[], ix:{}, counts:null };
  $('imPick').hidden = false;
  $('imPreview').hidden = true;
  $('imPreview').innerHTML = '';
  $('imDone').hidden = true;
  $('imDone').innerHTML = '';
  $('imFile').value = '';
  busy($('imGo'), false);
  $('imGo').hidden = true;
  $('imDrop').classList.remove('over');
}

function imLoad(file){
  var n = (file.name || '').toLowerCase();
  if(!/\.(csv|tsv|txt)$/.test(n) && !/csv|tab-separated/.test(file.type || '')){
    toast('รองรับเฉพาะไฟล์ .csv — ถ้าเป็นไฟล์ Excel ให้บันทึกเป็น "CSV UTF-8" ก่อน', true);
    return;
  }
  if(file.size > 8 * 1024 * 1024){ toast('ไฟล์ใหญ่เกินไป (สูงสุด 8 MB)', true); return; }

  imRead(file).then(function(text){
    var all = imParseCsv(text);
    if(all.length < 2){ toast('ข้อมูลในไฟล์น้อยเกินไป (ต้องมีแถวหัวคอลัมน์ + อย่างน้อย 1 แถวข้อมูล)', true); return; }
    if(all.length - 1 > IM_MAX){
      toast('ไฟล์นี้มี ' + fmt(all.length - 1) + ' แถว · นำเข้าได้ไม่เกิน ' + fmt(IM_MAX) + ' แถวต่อครั้ง', true);
      return;
    }
    IM.name = file.name;
    IM.headers = all[0].map(imCell);
    IM.rows = all.slice(1);
    IM.ix = imMapHeaders(IM.headers);
    IM.counts = (IM.ix.code != null) ? imCount() : null;
    imRender();
  }).catch(function(e){ toast('อ่านไฟล์ไม่สำเร็จ: ' + e.message, true); });
}

$('imFile').addEventListener('change', function(){ if(this.files && this.files[0]) imLoad(this.files[0]); });
['dragenter','dragover'].forEach(function(ev){
  $('imDrop').addEventListener(ev, function(e){ e.preventDefault(); e.stopPropagation(); this.classList.add('over'); });
});
['dragleave','dragleaveend'].forEach(function(ev){
  $('imDrop').addEventListener(ev, function(e){ e.preventDefault(); e.stopPropagation(); this.classList.remove('over'); });
});
$('imDrop').addEventListener('drop', function(e){
  e.preventDefault(); e.stopPropagation();
  this.classList.remove('over');
  var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if(f) imLoad(f);
});

document.querySelectorAll('[data-open-import]').forEach(function(b){
  b.addEventListener('click', function(){ imReset(); openSheet($('importSheet')); });
});

$('imTpl').addEventListener('click', function(){
  downloadCsv('ตัวอย่าง_รายการสั่งซื้อ.csv', [
    ['รหัสอะไหล่','เลข PR','เลข PO','จำนวนสั่ง','จำนวนเข้าแล้ว','กำหนดเข้า','หมายเหตุ'],
    ['93481620020','PR26100001','PO-1234','10','0','2026-11-15','ตัวอย่าง — ลบแถวนี้ก่อนนำเข้า'],
    ['MD110002','PR26100001','PO-1234','5','0','15/11/2026','']
  ]);
  toast('ดาวน์โหลดไฟล์ตัวอย่างแล้ว');
});

$('imGo').addEventListener('click', function(){
  var btn = this;
  if(!IM.counts || !IM.counts.added) return;
  var head = IM.headers, data = IM.rows;
  busy(btn, true, 'กำลังนำเข้า…');
  gsr()
    .withSuccessHandler(function(res){
      busy(btn, false);
      $('imPick').hidden = true;
      $('imPreview').hidden = true;
      btn.hidden = true;

      var h = '<div class="im-done-head">' + icon('check') + 'นำเข้าสำเร็จ ' + fmt(res.added) + ' แถว</div>';
      h += '<div class="help" style="margin-bottom:var(--s3)">เพิ่มต่อท้ายข้อมูลเดิม · ระบบสร้าง ID ให้ทุกแถวเอง</div>';
      if(res.skippedUnknown){
        h += '<div class="im-stat"><div class="bad"><b class="num">' + fmt(res.skippedUnknown) +
             '</b><span>ข้าม · รหัสอะไหล่ไม่มีในระบบ</span></div></div>';
        h += '<div class="help">รหัสที่ข้าม (เพิ่มเข้าระบบก่อน แล้วนำเข้าใหม่ได้):</div>';
        h += '<div class="im-codes">' + esc(res.unknown.join(' · ')) +
             (res.unknownMore ? ' · …อีก ' + fmt(res.unknownMore) + ' รหัส' : '') + '</div>';
      }
      if(res.noCode){
        h += '<div class="im-stat"><div class="bad"><b class="num">' + fmt(res.noCode) +
             '</b><span>ข้าม · แถวที่ไม่มีรหัสอะไหล่</span></div></div>';
      }
      $('imDone').innerHTML = h;
      $('imDone').hidden = false;
      toast('นำเข้าสำเร็จ ' + fmt(res.added) + ' แถว');
      loadData();
    })
    .withFailureHandler(function(e){
      busy(btn, false);
      toast('นำเข้าไม่สำเร็จ: ' + e.message, true);
    })
    .importOrders({ headers: head, rows: data });
});

/* ================= export ================= */
function downloadCsv(name, lines){
  var q = function(v){ return '"' + String(v==null?'':v).replace(/"/g,'""') + '"'; };
  var text = '\ufeff' + lines.map(function(r){ return r.map(q).join(','); }).join('\r\n');
  var a = document.createElement('a');
  a.download = name;
  a.rel = 'noopener';
  var href = '';
  try { href = URL.createObjectURL(new Blob([text], { type:'text/csv;charset=utf-8' })); } catch(e){}
  // บางเบราว์เซอร์บล็อก blob URL — สำรองด้วย data: URL
  if(!href) href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(text);
  a.href = href;
  document.body.appendChild(a); a.click(); a.remove();
  if(href.slice(0,5) === 'blob:') setTimeout(function(){ URL.revokeObjectURL(href); }, 4000);
}

$('btnExport').addEventListener('click', function(){
  var head = ['model','รหัสอะไหล่','ชื่ออะไหล่','REMARK','Status','เลข PR','เลข PO','จำนวนสั่ง','จำนวนเข้าแล้ว','ค้างเข้า','กำหนดเข้า','หมายเหตุ','อัปเดตล่าสุด'];
  var lines = [head];
  FILTERED.forEach(function(p){
    if(!p.orders.length){
      lines.push([p.model,p.code,p.name,p.remark,p.status,'','','','','','','','']);
      return;
    }
    p.orders.forEach(function(o){
      lines.push([p.model,p.code,p.name,p.remark,p.status,o.pr,o.po,o.qty,o.recv,o.remain,o.date,o.note,o.updated]);
    });
  });
  downloadCsv('รายการสั่งซื้อ_' + toISO(new Date()) + '.csv', lines);
  toast('ส่งออก ' + fmt(lines.length-1) + ' แถว');
});
$('btnRefresh').addEventListener('click', loadData);

/* ================= sticky offset ================= */
function syncSticky(){ document.documentElement.style.setProperty('--chips-top', $('appbar').offsetHeight + 'px'); }
window.addEventListener('resize', syncSticky); syncSticky();

build({ parts:[], orders:[] });
loadData();
