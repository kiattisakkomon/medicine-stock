'use strict';
const cfg=window.APP_CONFIG||{};
const configured=cfg.supabaseUrl?.startsWith('https://') && cfg.supabaseKey && !cfg.supabaseKey.startsWith('PASTE_');
const db=configured?window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseKey):null;
let state={medicines:[],lots:[],tx:[],counts:[],page:'dashboard',user:null};
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=x=>Number(x||0).toLocaleString('th-TH',{maximumFractionDigits:2});
const date=x=>x?new Date(String(x).length===10?x+'T12:00:00':x).toLocaleDateString('th-TH'):'';
const today=()=>{let d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const daydiff=d=>Math.round((new Date(d+'T12:00:00')-new Date(today()+'T12:00:00'))/86400000);
function notify(m,error=false){$('notice').textContent=m;$('notice').style.borderColor=error?'#d33':'#1477ae'}
function err(e){notify('เกิดข้อผิดพลาด: '+(e?.message||e),true)}
async function call(q){let {data,error}=await q;if(error)throw error;return data}
async function refresh(){
  const [medicines,lots,tx,counts]=await Promise.all([
    call(db.from('medicines').select('*').order('name')),
    call(db.from('lot_stock').select('*').order('expiry_date')),
    call(db.from('transactions').select('*').order('created_at',{ascending:false}).limit(1000)),
    call(db.from('stock_counts').select('*').order('created_at',{ascending:false}).limit(500))
  ]);
  Object.assign(state,{medicines,lots,tx,counts});render();
}
const med=id=>state.medicines.find(x=>x.id===id);
const lot=id=>state.lots.find(x=>x.id===id);
const lotLabel=x=>`${med(x.medicine_id)?.name||'ไม่พบชื่อยา'} / ${x.lot_number} (คงเหลือ ${num(x.current_qty)})`;
const opts=(items,fn)=>items.map(x=>`<option value="${esc(x.id)}">${esc(fn(x))}</option>`).join('');
const table=(heads,rows)=>`<div class="tablewrap"><table><thead><tr>${heads.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${heads.length}" class="muted">ยังไม่มีข้อมูล</td></tr>`}</tbody></table></div>`;
const panel=(title,body)=>`<section class="panel"><h2>${title}</h2>${body}</section>`;
function render(){let p=state.page;document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===p));
 $('content').innerHTML=({dashboard:dashboard,medicines:medicines,lots:lots,transactions:transactions,counts:counts,expiry:expiry}[p]||dashboard)();}
function dashboard(){let qty=state.lots.reduce((s,x)=>s+Number(x.current_qty),0),exp=state.lots.filter(x=>x.current_qty>0&&daydiff(x.expiry_date)>=0&&daydiff(x.expiry_date)<=30),expired=state.lots.filter(x=>x.current_qty>0&&daydiff(x.expiry_date)<0),low=state.medicines.filter(m=>state.lots.filter(x=>x.medicine_id===m.id).reduce((s,x)=>s+Number(x.current_qty),0)<=Number(m.min_stock));
 return `<div class="grid"><div class="stat"><strong>${state.medicines.length}</strong><span>รายการยา</span></div><div class="stat"><strong>${num(qty)}</strong><span>หน่วยคงเหลือรวม (ต่างหน่วย)</span></div><div class="stat"><strong>${exp.length}</strong><span>ล็อตใกล้หมดอายุ ≤30 วัน</span></div><div class="stat"><strong>${expired.length}</strong><span>ล็อตหมดอายุแล้ว</span></div><div class="stat"><strong>${low.length}</strong><span>รายการยาที่ถึงจุดสั่งซื้อ</span></div></div>`+panel('รายการที่ต้องติดตาม',table(['ชื่อยา','ล็อต','วันหมดอายุ','จำนวน','สถานะ'],[...expired,...exp].slice(0,20).map(x=>`<tr><td>${esc(med(x.medicine_id)?.name)}</td><td>${esc(x.lot_number)}</td><td>${date(x.expiry_date)}</td><td>${num(x.current_qty)}</td><td class="${daydiff(x.expiry_date)<0?'bad':'warn'}">${daydiff(x.expiry_date)<0?'หมดอายุ':'อีก '+daydiff(x.expiry_date)+' วัน'}</td></tr>`)));
}
function medicines(){return `<div class="split">${panel('เพิ่มรายการยา',`<form id="medForm"><label>รหัสยา<input name="code" required></label><label>ชื่อยา<input name="name" required></label><label>ชื่อสามัญ<input name="generic_name"></label><label>หน่วยนับ<input name="unit" value="เม็ด" required></label><label>จุดสั่งซื้อขั้นต่ำ<input name="min_stock" type="number" min="0" step="0.01" value="0" required></label><label>หมายเหตุ<textarea name="note"></textarea></label><button>บันทึกรายการยา</button></form>`)}${panel('รายการยาทั้งหมด',table(['รหัส','ชื่อยา','หน่วย','ขั้นต่ำ','คงเหลือ'],state.medicines.map(m=>`<tr><td>${esc(m.code)}</td><td>${esc(m.name)}</td><td>${esc(m.unit)}</td><td>${num(m.min_stock)}</td><td>${num(state.lots.filter(x=>x.medicine_id===m.id).reduce((s,x)=>s+Number(x.current_qty),0))}</td></tr>`)))}</div>`}
function lots(){return `<div class="split">${panel('เพิ่มล็อตยา',`<form id="lotForm"><label>ยา<select name="medicine_id" required>${opts(state.medicines,x=>x.code+' – '+x.name)}</select></label><label>เลขล็อต<input name="lot_number" required></label><label>วันหมดอายุ<input name="expiry_date" type="date" required></label><button ${state.medicines.length?'':'disabled'}>บันทึกล็อต</button></form><p class="muted">หลังสร้างล็อต ให้ไปเมนูรับเข้า / เบิกออก เพื่อเพิ่มยอดตั้งต้น</p>`)}${panel('ล็อตทั้งหมด',table(['ยา','เลขล็อต','หมดอายุ','คงเหลือ'],state.lots.map(x=>`<tr><td>${esc(med(x.medicine_id)?.name)}</td><td>${esc(x.lot_number)}</td><td>${date(x.expiry_date)}</td><td>${num(x.current_qty)}</td></tr>`)))}</div>`}
function transactions(){return `<div class="split">${panel('บันทึกรับเข้า / เบิกออก',`<form id="txForm"><label>ล็อตยา<select name="lot_id" required>${opts(state.lots,lotLabel)}</select></label><label>ประเภท<select name="type"><option value="IN">รับเข้า (IN)</option><option value="OUT">เบิกออก (OUT)</option><option value="DISPOSE">ทำลาย / ตัดทิ้ง (DISPOSE)</option></select></label><label>จำนวน<input name="quantity" type="number" min="0.01" step="0.01" required></label><label>หมายเหตุ<input name="note"></label><button ${state.lots.length?'':'disabled'}>บันทึกธุรกรรม</button></form>`)}${panel('ประวัติธุรกรรมล่าสุด',`<div class="inline"><button id="exportTx" class="secondary" type="button">ส่งออก CSV</button><span class="muted">แสดงสูงสุด 1,000 รายการล่าสุด</span></div>`+table(['วันที่','ยา / ล็อต','ประเภท','จำนวน','หมายเหตุ'],state.tx.map(x=>`<tr><td>${date(x.created_at)}</td><td>${esc(lot(x.lot_id)?lotLabel(lot(x.lot_id)):'ล็อตไม่พบ')}</td><td>${esc(x.transaction_type)}</td><td>${num(x.quantity)}</td><td>${esc(x.note)}</td></tr>`)))}</div>`}
function counts(){return `<div class="split">${panel('ตรวจนับสต็อก',`<form id="countForm"><label>ล็อตยา<select name="lot_id" required>${opts(state.lots,lotLabel)}</select></label><label>จำนวนที่ตรวจนับจริง<input name="counted_qty" type="number" min="0" step="0.01" required></label><button ${state.lots.length?'':'disabled'}>บันทึกผลตรวจนับ</button></form><p class="muted">การอนุมัติจะปรับยอดเป็น ADJUST_IN / ADJUST_OUT อัตโนมัติ และป้องกันการอนุมัติซ้ำ</p>`)}${panel('ผลการตรวจนับ',table(['วันที่','ล็อต','ระบบ','ตรวจนับ','ส่วนต่าง','สถานะ / อนุมัติ'],state.counts.map(x=>`<tr><td>${date(x.created_at)}</td><td>${esc(lot(x.lot_id)?lotLabel(lot(x.lot_id)):'ไม่พบล็อต')}</td><td>${num(x.system_qty)}</td><td>${num(x.counted_qty)}</td><td>${num(x.counted_qty-x.system_qty)}</td><td>${x.status==='Pending'?`<button data-approve="${esc(x.id)}">อนุมัติปรับยอด</button>`:'<span class="ok">Adjusted</span>'}</td></tr>`)))}</div>`}
function expiry(){let items=state.lots.filter(x=>Number(x.current_qty)>0&&daydiff(x.expiry_date)<=30);return panel('ยาใกล้หมดอายุ / หมดอายุแล้ว',`<p>แสดงล็อตที่มีสต็อกมากกว่า 0 และหมดอายุแล้วหรือจะหมดอายุภายใน 30 วัน</p><div class="inline"><button id="exportExpiry" type="button">ส่งออก CSV</button><button id="mailExpiry" type="button" class="secondary">เปิดอีเมลเพื่อส่งรายงาน</button></div>`+table(['ชื่อยา','ล็อต','วันหมดอายุ','คงเหลือ','สถานะ'],items.map(x=>`<tr><td>${esc(med(x.medicine_id)?.name)}</td><td>${esc(x.lot_number)}</td><td>${date(x.expiry_date)}</td><td>${num(x.current_qty)}</td><td class="${daydiff(x.expiry_date)<0?'bad':'warn'}">${daydiff(x.expiry_date)<0?'หมดอายุแล้ว':daydiff(x.expiry_date)+' วัน'}</td></tr>`))+`<p class="muted">ปุ่มอีเมลเป็นการส่งด้วยตนเอง ยังไม่ใช่การแจ้งเตือนอัตโนมัติ 08:00 น.</p>`)}
function csv(rows,filename){let body='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');let u=URL.createObjectURL(new Blob([body],{type:'text/csv;charset=utf-8'}));let a=document.createElement('a');a.href=u;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
const expRows=()=>state.lots.filter(x=>x.current_qty>0&&daydiff(x.expiry_date)<=30);
function handleClick(e){let a=e.target.closest('[data-approve]');if(a){if(!confirm('ยืนยันปรับยอดตามผลตรวจนับ?'))return;execute(async()=>{await call(db.rpc('approve_stock_count',{p_count_id:a.dataset.approve}));notify('อนุมัติและปรับยอดเรียบร้อย');await refresh()});return}
 if(e.target.id==='exportTx')csv([['Date','Medicine','Lot','Type','Qty','Note'],...state.tx.map(x=>[x.created_at,med(lot(x.lot_id)?.medicine_id)?.name,lot(x.lot_id)?.lot_number,x.transaction_type,x.quantity,x.note])],'transactions.csv');
 if(e.target.id==='exportExpiry')csv([['Medicine','Lot','Expiry','Qty','Days remaining'],...expRows().map(x=>[med(x.medicine_id)?.name,x.lot_number,x.expiry_date,x.current_qty,daydiff(x.expiry_date)])],'expiry_alert.csv');
 if(e.target.id==='mailExpiry'){let body=expRows().map(x=>`${med(x.medicine_id)?.name} | Lot ${x.lot_number} | ${x.expiry_date} | คงเหลือ ${x.current_qty}`).join('\n');location.href='mailto:?subject='+encodeURIComponent('แจ้งเตือนยาใกล้หมดอายุ '+today())+'&body='+encodeURIComponent(body||'ไม่มีรายการยาใกล้หมดอายุ')}
}
async function execute(fn){try{await fn()}catch(e){err(e)}}
$('app').addEventListener('click',handleClick);
$('nav').addEventListener('click',e=>{let b=e.target.closest('[data-page]');if(b){state.page=b.dataset.page;notify('');render()}});
$('app').addEventListener('submit',e=>{e.preventDefault();let f=e.target,values=Object.fromEntries(new FormData(f));execute(async()=>{
 if(f.id==='medForm')await call(db.from('medicines').insert({code:values.code.trim(),name:values.name.trim(),generic_name:values.generic_name||null,unit:values.unit,min_stock:Number(values.min_stock),note:values.note||null}));
 if(f.id==='lotForm')await call(db.from('lots').insert(values));
 if(f.id==='txForm')await call(db.rpc('record_stock',{p_lot_id:values.lot_id,p_type:values.type,p_qty:Number(values.quantity),p_note:values.note||null}));
 if(f.id==='countForm')await call(db.rpc('create_stock_count',{p_lot_id:values.lot_id,p_counted_qty:Number(values.counted_qty)}));
 notify('บันทึกสำเร็จ');await refresh();
 })});
$('loginForm').addEventListener('submit',e=>{e.preventDefault();execute(async()=>{let {data,error}=await db.auth.signInWithPassword({email:$('email').value,password:$('password').value});if(error)throw error;await session(data.session)})});
async function session(s){state.user=s?.user||null;$('auth').hidden=!!s;$('app').hidden=!s;$('userbar').innerHTML=s?`<span>${esc(s.user.email)}</span> <button id="logout" class="secondary">ออกจากระบบ</button>`:'';if(s)await execute(refresh)}
$('userbar').addEventListener('click',e=>{if(e.target.id==='logout')execute(async()=>{await db.auth.signOut();await session(null)})});
if(!configured){$('authmsg').textContent='กรุณากรอก Project URL และ Publishable Key ใน config.js ก่อนใช้งาน';$('loginForm').querySelector('button').disabled=true}
else execute(async()=>{let {data,error}=await db.auth.getSession();if(error)throw error;await session(data.session);db.auth.onAuthStateChange((_event,s)=>{if(!s&&state.user)session(null)})});
