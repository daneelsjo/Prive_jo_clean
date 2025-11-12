// Script/Javascript/planner.js
// Weekplanner met backlog (vakken + taken/toetsen) en Firestore-opslag.
// - Backlog: gegroepeerd per vak (kleur per vak, symbool per type)
// - Drag & drop: backlog → weekrooster (zelfde item mag meermaals gepland worden)
// - Afdruk als lijst (van–tot)
// - UI toont grid ook zonder login; Firestore-acties vragen login

import {
  getFirebaseApp,
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged,
  getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc,
  query, where, orderBy,getDocs
} from "./firebase-config.js";

/* ───────────────────────── Helpers ───────────────────────── */
const SYMBOL_BY_TYPE = { taak: "📝", toets: "🧪", examen: "🎓", andere: "📚" };
const sym  = (t)=> SYMBOL_BY_TYPE[t] || "📌";
const pad  = (n)=> String(n).padStart(2,"0");
const div  = (cls)=>{ const el=document.createElement("div"); if(cls) el.className=cls; return el; };
const esc  = (s="")=> s.replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const safeParse = (s)=> { try{ return JSON.parse(s); } catch{ return null; } };


// ==== VIEW STATE & HELPERS (bovenaan zetten) ====
let viewMode = 'week';          // 'week' | 'day'
let dayDate  = new Date();      // actieve dag in day-view
let weekTitleEl = null;
let calRootEl   = null;
let backlogFilter = { text:'', subjectId:'', type:'', from:null, to:null };
function addMinutes(d, m){ const x = new Date(d); x.setMinutes(x.getMinutes()+m); return x; }
function fmtTime(d){ return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }

// Wie is de eigenaar waarvan we de planner tonen?
const OWNER_UID = "KNjbJuZV1MZMEUQKsViehVhW3832"; // ← jouw uid
let ownerUid = null;   // effectief gebruikte eigenaar in queries
let canWrite = true;   // mag de ingelogde user ook bewerken?

const AUTO_FILTER_BACKLOG = true;

// We onthouden wat de laatste gerenderde periode was
let lastPeriodStart = null;
let lastPeriodEnd   = null;
function applyAutoBacklogFilterForPeriod(){
  if (!AUTO_FILTER_BACKLOG || !lastPeriodStart) return;

  // Filter: toon enkel deadlines vanaf begin van de huidige periode
  backlogFilter.from = startOfDay(lastPeriodStart);
  backlogFilter.to   = null;

  // Knop visueel actief
  const fb = document.getElementById('filterBtn');
  if (fb) fb.classList.add('is-active');

  // Hertekenen – roep de versie aan die door DOMContentLoaded is “geëxporteerd”
  if (typeof window.renderBacklog === 'function') {
    window.renderBacklog();
  }
}




function startOfDay(d){
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x;
}

function getPeriodRange(){
  if (viewMode === 'day') {
    const s = startOfDay(dayDate);
    const e = new Date(s); e.setDate(e.getDate()+1);
    return { start: s, end: e, days: 1 };
  }
  // week (za–vr)
  const s = startOfWeek(weekStart);
  const e = new Date(s); e.setDate(e.getDate()+7);
  return { start: s, end: e, days: 7 };
}


function placeEvent(p){
    const start = toDate(p.start);
  const { start: periodStart, days: dayCount } = getPeriodRange();
  const d = clamp(Math.floor((start - periodStart)/86400000), 0, dayCount-1);

  const hStart = 7, hEnd = 22;
  const totalRows = (hEnd - hStart) * 2;
  const slotH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--slot-h')) || 28;

  const hour = start.getHours();
  const mins = start.getMinutes();
  const rowsFromTop = ((hour - hStart) * 2) + (mins >= 30 ? 1 : 0);
  const heightRows  = Math.max(1, Math.round((p.durationHours||1) * 2));

  const cols = calRootEl.querySelectorAll('.day-col');
  const col = cols[d]; if(!col) return;
  const block = div('event');
  block.classList.add(`type-${(p.type||'').toLowerCase()}`);

  const bg = p.color || '#2196F3';
  block.style.background = bg;
  block.style.color = getContrast(bg);
  block.style.top   = `${rowsFromTop * slotH}px`;
  block.style.height= `${heightRows * slotH - 4}px`;
block.innerHTML = `
  <div class="evt-actions"><button class="evt-del" title="Verwijderen">🗑</button></div>
  <div class="title">${p.symbol||sym(p.type)} ${esc(p.title||'')}</div>
  <div class="meta">${(p.subjectName||'')} • ${pad(start.getHours())}:${pad(start.getMinutes())} • ${p.durationHours}u</div>
  <div class="resize-h" title="Sleep om duur aan te passen"></div>
`;


  // --- Tooltip ---
 block.addEventListener('mouseenter', (ev)=>{
  const tip = document.getElementById('evt-tip'); if(!tip) return;
  const dueSrc = p.dueDate || backlog.find(b=> b.id===p.itemId)?.dueDate || null;
  const due    = dueSrc ? toDate(dueSrc).toLocaleDateString('nl-BE') : '—';
  const end    = addMinutes(start, Math.round((p.durationHours||1)*60));
  let tipHtml = `<div class="t">${esc(p.title||'')}</div>
    <div class="m">${esc(p.subjectName||'')} • ${p.type}</div>
    <div class="m">${fmtTime(start)}–${fmtTime(end)}</div>
    <div class="m">Tegen: ${due}</div>`;
  if (p.note && String(p.note).trim()) tipHtml += `<div class="m">Opmerking: ${esc(p.note)}</div>`;
  tip.innerHTML = tipHtml;
  tip.style.display = 'block';
  tip.style.left = (ev.clientX+12)+'px';
  tip.style.top  = (ev.clientY+12)+'px';
});
block.addEventListener('mousemove', (ev)=>{
  const tip = document.getElementById('evt-tip'); if(!tip || tip.style.display!=='block') return;
  tip.style.left = (ev.clientX+12)+'px';
  tip.style.top  = (ev.clientY+12)+'px';
});
block.addEventListener('mouseleave', ()=>{
  const tip = document.getElementById('evt-tip'); if(tip) tip.style.display = 'none';
});

  block.addEventListener('mousemove', (ev)=>{
    const tip = document.getElementById('evt-tip'); if(!tip || tip.style.display!=='block') return;
    tip.style.left = (ev.clientX+12)+'px';
    tip.style.top  = (ev.clientY+12)+'px';
  });
  block.addEventListener('mouseleave', ()=>{
    const tip = document.getElementById('evt-tip'); if(tip) tip.style.display = 'none';
  });

  // --- Klik = verwijderen ---
 // --- Klik = selecteren; Alt+Klik = verwijderen ---
block.addEventListener('click', async (e)=>{
  // selecteer visueel
  selectedPlanId = p.id;
  document.querySelectorAll('.event.is-selected').forEach(el=> el.classList.remove('is-selected'));
  block.classList.add('is-selected');

  // alleen verwijderen als Alt (Option) is ingedrukt
  if (!e.altKey) return;
  if(!currentUser){ alert('Log eerst in.'); return; }
  if(!confirm('Deze planning verwijderen?')) return;
  await deleteDoc(doc(db,'plans', p.id));
});

const delBtn = block.querySelector('.evt-del');
delBtn.addEventListener('click', async (e)=>{
  e.preventDefault(); e.stopPropagation();
  if(!currentUser){ alert('Log eerst in.'); return; }
  if(!confirm('Deze planning verwijderen?')) return;
  await deleteDoc(doc(db,'plans', p.id));
});



  // --- Drag to move ---
  block.setAttribute('draggable', 'true');
  block.addEventListener('dragstart', (e)=>{
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({kind:'planmove', id: p.id}));
    e.dataTransfer.setData('text/plain',       JSON.stringify({kind:'planmove', id: p.id}));
    document.body.classList.add('dragging-event');
  });
  block.addEventListener('dragend', ()=>{
    document.body.classList.remove('dragging-event');
  });

  // --- Resize (onderrand) ---
  const handle = block.querySelector('.resize-h');
  handle.addEventListener('dragstart', e=> e.preventDefault());
  handle.addEventListener('mousedown', (e)=>{
    e.stopPropagation(); e.preventDefault();
    document.body.classList.add('resizing-event');
    block.classList.add('resizing');

    const startY = e.clientY;
    const startPx = block.offsetHeight;
    const maxRows = Math.max(1, totalRows - rowsFromTop);

    function onMove(ev){
      const dy = ev.clientY - startY;
      let rows = Math.round((startPx + dy) / slotH);
      rows = clamp(rows, 1, maxRows);
      block.style.height = `${rows * slotH - 4}px`;
      const newDur = Math.max(0.5, rows / 2);
      const meta = block.querySelector('.meta');
      if (meta) meta.textContent = `${(p.subjectName||'')} • ${pad(start.getHours())}:${pad(start.getMinutes())} • ${newDur}u`;
    }
    function onUp(){
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing-event');
      block.classList.remove('resizing');
      const finalRows = Math.round((block.offsetHeight + 4) / slotH);
      const newDur = Math.max(0.5, finalRows / 2);
      updateDoc(doc(db,'plans', p.id), { durationHours: newDur }).catch(err=>{
        console.error('resize save error:', err);
        alert('Kon nieuwe duur niet bewaren: ' + (err?.message||err));
      });
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // --- Opmerking (dblclick) + indicator ---
  if (p.note && String(p.note).trim()) block.classList.add('has-note');
  block.addEventListener('dblclick', ()=>{
  if(!currentUser){ alert('Log eerst in.'); return; }
  const idEl = document.getElementById('plan-note-id');
  const ta   = document.getElementById('plan-note-text');
  if (idEl) idEl.value = p.id;
  if (ta)   ta.value = p.note ? String(p.note) : '';
  if (window.Modal?.open) Modal.open('modal-plan-note');
  else document.getElementById('modal-plan-note')?.removeAttribute('hidden');
});


  col.appendChild(block);
}

function renderCalendar(){
  if(!calRootEl) return;

  // periode bijhouden → nodig voor auto-filter backlog
  const { start: periodStart, end: periodEnd, days: dayCount } = getPeriodRange();
  lastPeriodStart = periodStart;
  lastPeriodEnd   = periodEnd;

  calRootEl.innerHTML = '';

  // hoekje linksboven + dagkoppen
  const headTime = div('col-head'); headTime.textContent = '';
  calRootEl.appendChild(headTime);
  for(let d=0; d<dayCount; d++){
    const day = addDays(periodStart, d);
    const h = div('col-head');
    h.textContent = day.toLocaleDateString('nl-BE',{weekday:'long', day:'2-digit', month:'2-digit'});
    calRootEl.appendChild(h);
  }

  const hStart = 7, hEnd = 22;

  // tijdkolom
  const tc = div('time-col');
  for(let h=hStart; h<hEnd; h++){
    const slot = div('time-slot'); slot.textContent = `${pad(h)}:00`;
    tc.appendChild(slot);
  }
  calRootEl.appendChild(tc);

  // dagkolommen + dropzones (30 min)
  for(let d=0; d<dayCount; d++){
    const col = div('day-col');
    col.dataset.day = String(d);

    // fallback drop (bovenaan kolom)
    col.ondragover = (e)=>{ e.preventDefault(); };
    col.ondrop = async (e)=>{
      e.preventDefault();
      if(!currentUser){ alert('Log in om te plannen.'); return; }
      const data = safeParse(e.dataTransfer.getData('application/json')) || safeParse(e.dataTransfer.getData('text/plain'));
      if(!data) return;

      if(data.kind==='backlog'){
        const item = backlog.find(x=>x.id===data.id); if(!item) return;
        const start = addDays(periodStart, d); start.setHours(hStart,0,0,0);
        try{
          await addDoc(collection(db,'plans'),{
            itemId:item.id,title:item.title,type:item.type,subjectId:item.subjectId,subjectName:item.subjectName,
            color:item.color,symbol:item.symbol,start,durationHours:item.durationHours||1,dueDate:item.dueDate||null,note:null,
            uid:ownerUid,createdAt:new Date()
          });
        }catch(err){ console.error(err); alert('Kon niet plannen: '+(err?.message||err)); }
      }else if(data.kind==='planmove'){
        const start = addDays(periodStart, d); start.setHours(hStart,0,0,0);
        try{ await updateDoc(doc(db,'plans', data.id), { start }); }
        catch(err){ console.error(err); alert('Kon niet verplaatsen: '+(err?.message||err)); }
      }
    };

    for(let h=hStart; h<hEnd; h++){
      for(let m of [0,30]){
        const z = div('dropzone');
        z.dataset.hour = String(h);
        z.dataset.min  = String(m);
        z.ondragover = (e)=>{ e.preventDefault(); z.setAttribute('aria-dropeffect','move'); };
        z.ondragleave = ()=> z.removeAttribute('aria-dropeffect');
        z.ondrop = async (e)=>{
          e.preventDefault(); e.stopPropagation();
          z.removeAttribute('aria-dropeffect');
          if(!currentUser){ alert('Log in om te plannen.'); return; }
          const data = safeParse(e.dataTransfer.getData('application/json')) || safeParse(e.dataTransfer.getData('text/plain'));
          if(!data) return;

          const start = addDays(periodStart, d);
          start.setHours(parseInt(z.dataset.hour,10), parseInt(z.dataset.min,10), 0, 0);

          try{
            if(data.kind==='backlog'){
              const item = backlog.find(x=>x.id===data.id); if(!item) return;
              await addDoc(collection(db,'plans'),{
                itemId:item.id,title:item.title,type:item.type,subjectId:item.subjectId,subjectName:item.subjectName,
                color:item.color,symbol:item.symbol,start,durationHours:item.durationHours||1,dueDate:item.dueDate||null,note:null,
                uid:ownerUid,createdAt:new Date()
              });
            }else if(data.kind==='planmove'){
              await updateDoc(doc(db,'plans', data.id), { start });
            }
          }catch(err){
            console.error('drop error:', err);
            alert('Kon niet plannen/verplaatsen: ' + (err?.message||err));
          }
        };
        col.appendChild(z);
      }
    }

    calRootEl.appendChild(col);
  }

  // geplande events tekenen
  if (Array.isArray(plans) && plans.length){
    plans.forEach(p=> placeEvent(p));
  }
}




function renderView(){
  const { start } = getPeriodRange();

  if (viewMode === 'day') {
    const t = start.toLocaleDateString('nl-BE', { weekday:'long', day:'2-digit', month:'2-digit' });
    if (weekTitleEl) weekTitleEl.textContent = `Dag – ${t}`;
  } else {
    const t1 = start.toLocaleDateString('nl-BE', { weekday:'long', day:'2-digit', month:'2-digit' });
    const t2 = addDays(start,6).toLocaleDateString('nl-BE', { weekday:'long', day:'2-digit', month:'2-digit' });
    if (weekTitleEl) weekTitleEl.textContent = `Week ${t1} – ${t2}`;
  }

  renderCalendar();
  applyAutoBacklogFilterForPeriod(); 
}



function toDate(maybeTs){
  if (maybeTs instanceof Date) return maybeTs;
  if (maybeTs && typeof maybeTs.seconds === "number") return new Date(maybeTs.seconds*1000);
  if (typeof maybeTs === "string") return new Date(maybeTs);
  return new Date(maybeTs || Date.now());
}
function startOfWeek(d){
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // JS: getDay() => 0=zo, 1=ma, …, 6=za
  // We willen: 0=za, 1=zo, …, 6=vr  → offset = (getDay()+1) % 7
  const day = (x.getDay() + 1) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
async function cleanupExpiredBacklog(){
  if(!currentUser) return;
  try{
    const cutoff = startOfDay(new Date()); // 00:00 vandaag → alles met dueDate < vandaag is “dag na deadline”
    const qExp = query(
      collection(db,'backlog'),
      where('uid','==', ownerUid),
      where('dueDate','<', cutoff)       // items zonder dueDate worden niet gematcht
    );
    const snap = await getDocs(qExp);
    if (!snap.empty){
      await Promise.all(snap.docs.map(d => deleteDoc(doc(db,'backlog', d.id))));
    }
  }catch(err){
    console.error('cleanupExpiredBacklog error', err);
  }
}


function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function fmtDate(d){ return d.toLocaleDateString('nl-BE',{weekday:'short', day:'2-digit', month:'2-digit'}); }
function toISODate(dt){
  const d = (typeof toDate === 'function') ? toDate(dt) : new Date(dt);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const da = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
}



/* ───────── Backlog-modal helpers (globaal) ───────── */
function showError(id, msg){
  const f = document.getElementById(id);
  const e = document.querySelector(`.error[data-for="${id}"]`);
  if (f) f.classList.toggle('is-invalid', !!msg);
  if (e) e.textContent = msg || '';
}

function validateBacklog(){
  let ok = true;
  const subj = document.getElementById('bl-subject')?.value || '';
  const type = document.getElementById('bl-type')?.value || '';
  const title= (document.getElementById('bl-title')?.value || '').trim();
  const due  = document.getElementById('bl-due')?.value || '';

  if (!subj){ showError('bl-subject','Kies een vak.'); ok = false; } else showError('bl-subject','');
  if (!type){ showError('bl-type','Kies een type.');   ok = false; } else showError('bl-type','');
  if (!title){showError('bl-title','Geef een titel.'); ok = false; } else showError('bl-title','');
  if (!due){  showError('bl-due','Kies een deadline.');ok = false; } else showError('bl-due','');

  return ok;
}

/* type-segmenten actief zetten + hidden waarde schrijven */
function setTypeButtons(type){
  const hidden = document.getElementById('bl-type');
  if (hidden) hidden.value = type || '';
  document.querySelectorAll('#modal-backlog .segmented .seg').forEach(b=>{
    const active = b.dataset.type === (type||'');
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

/* vakken in de select vullen + kleur tonen (opties gekleurd) */
function fillSubjectSelect(selectedId){
  const sel = document.getElementById('bl-subject');
  const sw  = document.getElementById('bl-swatch');
  if (!sel) return;

  // Placeholder
  let html = `<option value="">Kies een vak…</option>`;

  // Elke optie krijgt zijn eigen achtergrond + contrasterende tekstkleur
  html += subjects.map(s => {
    const color = s.color || '#607D8B';
    const fg    = getContrast(color);
    return `<option value="${s.id}" data-color="${color}" style="background:${color};color:${fg};">
              ${esc(s.name || '')}
            </option>`;
  }).join('');

  sel.innerHTML = html;
  sel.value = selectedId || '';

  // Swatch naast de select laten meekleuren
  const updateSwatch = ()=>{
    const opt = sel.selectedOptions[0];
    const c = opt ? (opt.dataset.color || '') : '';
    if (sw) sw.style.background = c || 'transparent';
  };
  sel.removeEventListener('change', updateSwatch);
  sel.addEventListener('change', updateSwatch);
  updateSwatch();
}



function clearBacklogErrors(){
  ['bl-subject','bl-type','bl-title','bl-due'].forEach(id => showError(id,''));
}

function clamp(v,min,max){ return Math.max(min, Math.min(max,v)); }
function getContrast(hex){
  if(!/^#?[0-9a-f]{6}$/i.test(hex||"")) return "#000";
  const h = hex.startsWith('#')?hex.slice(1):hex;
  const r=parseInt(h.substr(0,2),16), g=parseInt(h.substr(2,2),16), b=parseInt(h.substr(4,2),16);
  const yiq=(r*299+g*587+b*114)/1000;
  return yiq>=128?'#000':'#fff';
}

function setSubjectChip(name, color){
  const chip = document.getElementById("bl-subject-chip");
  if(!chip) return;
  if(!name){ chip.hidden = true; return; }
  const dot = chip.querySelector(".dot");
  const txt = chip.querySelector(".txt");
  if(dot) dot.style.background = color || "#ccc";
  if(txt) txt.textContent = name;
  chip.hidden = false;
}

function renderSubjectMenu(filterText=""){
  const menu = document.getElementById("bl-subject-menu");
  if(!menu) return;
  const f = (filterText||"").trim().toLowerCase();

  const list = subjects
    .slice()
    .filter(s => !f || (s.name||"").toLowerCase().includes(f));

  if(list.length === 0){
    menu.innerHTML = `<div class="subj-opt" style="justify-content:center;opacity:.7">Geen resultaten</div>`;
    return;
  }

  menu.innerHTML = list.map(s=>{
    const fg = getContrast(s.color||"#ccc");
    return `
      <div class="subj-opt" data-id="${s.id}" style="background:${s.color||"#ccc"};color:${fg};">
        <span class="name">${esc(s.name||"")}</span>
        <span class="hex">${esc(s.color||"")}</span>
      </div>
    `;
  }).join("");
}

function openSubjectMenu(){
  const menu = document.getElementById("bl-subject-menu");
  if(!menu) return;
  renderSubjectMenu(""); // altijd de volledige lijst tonen bij openen
  menu.hidden = false;
}

function closeSubjectMenu(){
  const menu = document.getElementById("bl-subject-menu");
  if(!menu) return;
  menu.hidden = true;
}

function openBacklogModalNew(){
  clearBacklogErrors();
  const h = document.getElementById('bl-titlebar'); if (h) h.textContent = 'Nieuw item';
  document.getElementById('bl-id').value = '';
  fillSubjectSelect('');
  setTypeButtons('taak');
  document.getElementById('bl-title').value = '';
  document.getElementById('bl-duration').value = '1';
  document.getElementById('bl-due').value = '';
  if (window.Modal?.open) Modal.open('modal-backlog');
  else document.getElementById('modal-backlog')?.removeAttribute('hidden');
}

function openBacklogModalEdit(item){
  if (!item) return;
  clearBacklogErrors();
  const h = document.getElementById('bl-titlebar'); if (h) h.textContent = 'Item bewerken';
  document.getElementById('bl-id').value = item.id;
  fillSubjectSelect(item.subjectId || '');
  setTypeButtons(item.type || '');
  document.getElementById('bl-title').value     = item.title || '';
  document.getElementById('bl-duration').value  = String(item.durationHours || 1);
  document.getElementById('bl-due').value       = item.dueDate ? toISODate(item.dueDate) : '';
  if (window.Modal?.open) Modal.open('modal-backlog');
  else document.getElementById('modal-backlog')?.removeAttribute('hidden');
}


// Veilige event-binding (logt waarschuwing i.p.v. crash)
function bind(selectorOrEl, event, handler){
  const el = typeof selectorOrEl === "string" ? document.querySelector(selectorOrEl) : selectorOrEl;
  if(!el){ console.warn("[planner] element not found for", selectorOrEl); return; }
  el.addEventListener(event, handler);
}

/* ───────────────────────── Firebase init ───────────────────────── */
const app  = getFirebaseApp();
const db   = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

/* ───────────────────────── State ───────────────────────── */
let currentUser = null;
let subjects = []; // {id,name,color,uid}
let backlog  = []; // {id,subjectId,subjectName,type,title,durationHours,dueDate,color,symbol,uid,done}
let plans    = []; // {id,itemId,start,durationHours,uid}
let weekStart = startOfWeek(new Date());
let selectedPlanId = null;


/* ───────────────────────── DOM na load ───────────────────────── */
window.addEventListener("DOMContentLoaded", () => {
  const authDiv   = document.getElementById("auth");
  const appDiv    = document.getElementById("app");
weekTitleEl = document.getElementById("weekTitle");
calRootEl   = document.getElementById("calendar");
  const blSubjects= document.getElementById("bl-subjects");
  // Subject input: altijd volledige lijst tonen bij focus/klik
document.addEventListener("focusin", (ev)=>{
  const input = ev.target.closest("#bl-subject");
  if(!input) return;
  openSubjectMenu();
});
// Opmerking bewaren
document.addEventListener('click', async (e)=>{
  if(!e.target.closest('#plan-note-save')) return;
  if(!currentUser){ alert('Log eerst in.'); return; }
  const id  = document.getElementById('plan-note-id')?.value || '';
  const txt = document.getElementById('plan-note-text')?.value || '';
  if(!id) return;
  try{
    await updateDoc(doc(db,'plans', id), { note: txt.trim() || null });
  }catch(err){
    console.error('note save error', err);
    alert('Kon opmerking niet bewaren: ' + (err?.message||err));
  }
  window.Modal?.close ? Modal.close('modal-plan-note') : document.getElementById('modal-plan-note')?.setAttribute('hidden','');
});


// Typen = filteren; lege input = volledige lijst
document.addEventListener("input", (ev)=>{
  const input = ev.target.closest("#bl-subject");
  if(!input) return;
  const val = input.value || "";
  renderSubjectMenu(val);              // filter
  if(val === "") openSubjectMenu();    // leeg => toon alles
});

// Weergave wisselen
document.addEventListener('click', (e)=>{
  if (e.target.closest('#viewWeek')) {
    viewMode = 'week';
    document.getElementById('viewWeek')?.classList.add('is-active');
    document.getElementById('viewDay') ?.classList.remove('is-active');
    document.getElementById('dayPicker').style.display = 'none';
    renderView();
    if(currentUser) refreshPlans();
  }
  if (e.target.closest('#viewDay')) {
    viewMode = 'day';
    document.getElementById('viewDay') ?.classList.add('is-active');
    document.getElementById('viewWeek')?.classList.remove('is-active');
    // dagpicker default op vandaag
    const dp = document.getElementById('dayPicker');
    if (dp){
      dp.style.display = '';
      dp.value = startOfDay(dayDate).toISOString().slice(0,10);
    }
    renderView();
    if(currentUser) refreshPlans();
  }
});

// Dag kiezen
document.addEventListener('input', (e)=>{
  const dp = e.target.closest('#dayPicker');
  if (!dp) return;
  dayDate = new Date(dp.value);
  renderView();
  if(currentUser) refreshPlans();
});

// Navigatieknoppen: vorige/volgende
document.getElementById('prevWeek')?.addEventListener('click', ()=>{
  if (viewMode === 'day') { dayDate.setDate(dayDate.getDate()-1); }
  else { weekStart = addDays(weekStart,-7); }
  renderView();
  applyAutoBacklogFilterForPeriod();
  if(currentUser) refreshPlans();
});
document.getElementById('nextWeek')?.addEventListener('click', ()=>{
  if (viewMode === 'day') { dayDate.setDate(dayDate.getDate()+1); }
  else { weekStart = addDays(weekStart, 7); }
  renderView();
  applyAutoBacklogFilterForPeriod();
  if(currentUser) refreshPlans();
});


// Optie aanklikken
document.addEventListener("click", (ev)=>{
  const opt = ev.target.closest(".subj-opt");
  if(!opt) return;
  const id = opt.dataset.id;
  const s = subjects.find(x=>x.id===id);
  const input = document.getElementById("bl-subject");
  if(s && input){
    input.value = s.name || "";
    setSubjectChip(s.name, s.color);
  }
  closeSubjectMenu();
});

// Type-knoppen: zet actieve knop + schrijf waarde naar hidden input #bl-type
document.addEventListener("click", (ev)=>{
  const btn = ev.target.closest(".type-btn");
  if (!btn) return;
  const group = btn.closest(".type-group");
  group?.querySelectorAll(".type-btn").forEach(b=> b.classList.remove("is-active"));
  btn.classList.add("is-active");
  const hidden = document.getElementById("bl-type");
  if (hidden) hidden.value = btn.dataset.type || "taak";
});

// Buiten klikken => sluiten
document.addEventListener("click", (ev)=>{
  const wrap = ev.target.closest(".subj-wrap");
  if(wrap) return;
  closeSubjectMenu();
});

// Escape sluit menu
document.addEventListener("keydown", (ev)=>{
  if(ev.key === "Escape") closeSubjectMenu();
});

// Bij openen van de backlog-modal chip initialiseren (op basis van ingevoerde tekst)
document.addEventListener("click", (ev)=>{
  const btn = ev.target.closest("#newBacklogBtn,[data-modal-open='modal-backlog']");
  if(!btn) return;
  // wacht een tikje tot modal zichtbaar is
  setTimeout(()=>{
    const input = document.getElementById("bl-subject");
    if(!input) return;
    const s = subjects.find(x=> (x.name||"").toLowerCase() === (input.value||"").toLowerCase());
    setSubjectChip(s?.name || "", s?.color || "");
    // bij openen meteen volledige lijst
    openSubjectMenu();
  }, 0);
});



  // 15 vaste kleuren
const PALETTE = [
  "#2196F3","#3F51B5","#00BCD4","#4CAF50","#8BC34A",
  "#FFC107","#FF9800","#FF5722","#E91E63","#9C27B0",
  "#795548","#607D8B","#009688","#673AB7","#F44336"
];


  // UI zichtbaar houden (ook zonder login)
  if (authDiv) authDiv.style.display = "block";
  if (appDiv)  appDiv.style.display  = "block";

  /* ── UI wiring ── */
  bind("#login-btn", "click", () => signInWithPopup(auth, provider));
  bind("#prevWeek", "click", () => { weekStart = addDays(weekStart,-7); renderView(); if(currentUser) refreshPlans(); });
  bind("#nextWeek", "click", () => { weekStart = addDays(weekStart, 7); renderView(); if(currentUser) refreshPlans(); });
  
  // Type kiezen in backlog-modal (werkt met segmented .seg knoppen)
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('#modal-backlog .segmented .seg');
  if (!btn) return;
  setTypeButtons(btn.dataset.type);     // zet hidden #bl-type en active class
});



  // Filter-klik: open modal + vul vakkenlijst
document.addEventListener('click', (e)=>{
  if(!e.target.closest('#filterBtn')) return;
  // subjects in select
  const sel = document.getElementById('f-subject');
  if (sel){
    const v = backlogFilter.subjectId || '';
    sel.innerHTML = `<option value="">(alle vakken)</option>` + subjects.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
    sel.value = v;
  }
  // overige velden
  const fTxt = document.getElementById('f-text'); if (fTxt) fTxt.value = backlogFilter.text || '';
  const fType= document.getElementById('f-type'); if (fType) fType.value = backlogFilter.type || '';
  document.querySelectorAll('#modal-filter .type-btn').forEach(b=>{
    b.classList.toggle('is-active', b.dataset.type === (backlogFilter.type||''));
  });
  const fFrom= document.getElementById('f-from'); fFrom && (fFrom.value = backlogFilter.from ? toISODate(backlogFilter.from) : '');
  const fTo  = document.getElementById('f-to');   fTo   && (fTo.value   = backlogFilter.to   ? toISODate(backlogFilter.to)   : '');

  window.Modal?.open ? Modal.open('modal-filter') : document.getElementById('modal-filter')?.removeAttribute('hidden');
});

// filter type-knoppen
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('#modal-filter .type-btn'); if(!btn) return;
  const group = btn.closest('.type-group');
  group.querySelectorAll('.type-btn').forEach(b=> b.classList.remove('is-active'));
  btn.classList.add('is-active');
  const hidden = document.getElementById('f-type'); if (hidden) hidden.value = btn.dataset.type || '';
});

// toepassen
document.addEventListener('click', (e)=>{
  if(!e.target.closest('#f-apply')) return;
  backlogFilter.text = (document.getElementById('f-text')?.value || '').trim().toLowerCase();
  backlogFilter.subjectId = document.getElementById('f-subject')?.value || '';
  backlogFilter.type = document.getElementById('f-type')?.value || '';
  const from = document.getElementById('f-from')?.value || '';
  const to   = document.getElementById('f-to')?.value   || '';
  backlogFilter.from = from ? new Date(from) : null;
  backlogFilter.to   = to   ? new Date(to)   : null;

  // knopkleur
  const active = !!(backlogFilter.text || backlogFilter.subjectId || backlogFilter.type || backlogFilter.from || backlogFilter.to);
  document.getElementById('filterBtn')?.classList.toggle('is-active', active);

  // sluiten + render
  window.Modal?.close ? Modal.close('modal-filter') : document.getElementById('modal-filter')?.setAttribute('hidden','');
  renderBacklog();
});

// wissen
document.addEventListener('click', (e)=>{
  if(!e.target.closest('#f-clear')) return;
  backlogFilter = { text:'', subjectId:'', type:'', from:null, to:null };
  document.getElementById('filterBtn')?.classList.remove('is-active');
  window.Modal?.close ? Modal.close('modal-filter') : document.getElementById('modal-filter')?.setAttribute('hidden','');
  renderBacklog();
});


  document.addEventListener('keydown', async (e)=>{
  if(e.key !== 'Delete' || !selectedPlanId) return;
  if(!currentUser){ alert('Log eerst in.'); return; }
  const el = document.querySelector('.event.is-selected');
  if(!confirm('Geselecteerde planning verwijderen?')) return;
  await deleteDoc(doc(db,'plans', selectedPlanId));
  selectedPlanId = null;
  if (el) el.classList.remove('is-selected');
});

  // open snel-plannen
document.addEventListener("click",(e)=>{
  if(!e.target.closest("#quickPlanBtn")) return;
  if(!currentUser){ alert('Log eerst in.'); return; }
  // defaults
  document.getElementById("qp-title").value = "";
  document.getElementById("qp-type").value = "andere";
  document.querySelectorAll("#modal-quick .type-btn").forEach(b=> b.classList.toggle("is-active", b.dataset.type==="andere"));
  const today = new Date(); const iso = (d)=>d.toISOString().slice(0,10);
  document.getElementById("qp-start").value = iso(today);
  document.getElementById("qp-end").value   = iso(today);
  if(window.Modal?.open) Modal.open("modal-quick"); else document.getElementById("modal-quick").hidden=false;
});

// type-knoppen in quick modal
document.addEventListener("click",(e)=>{
  const b = e.target.closest("#modal-quick .type-btn"); if(!b) return;
  const group = b.closest(".type-group");
  group.querySelectorAll(".type-btn").forEach(x=> x.classList.remove("is-active"));
  b.classList.add("is-active");
  document.getElementById("qp-type").value = b.dataset.type;
});

// save snel-plannen
document.addEventListener("click", async (e)=>{
  if(!e.target.closest("#qp-save")) return;
  if(!currentUser){ alert('Log eerst in.'); return; }

  const title = (document.getElementById("qp-title").value||"").trim();
  const type  = document.getElementById("qp-type").value || "andere";
  const ds    = document.getElementById("qp-start").value;
  const de    = document.getElementById("qp-end").value;
  const time  = document.getElementById("qp-time").value || "18:00";
  const dur   = parseFloat(document.getElementById("qp-dur").value)||1;
  const dows  = [...document.querySelectorAll(".qp-dow:checked")].map(x=> parseInt(x.value,10));

  if(!title){ alert("Titel is verplicht."); return; }
  if(!ds || !de){ alert("Van en tot datum verplicht."); return; }
  if(dows.length===0){ alert("Kies minstens één weekdag."); return; }

  const [hh,mm] = time.split(":").map(n=> parseInt(n,10));
  const startDate = new Date(ds); startDate.setHours(0,0,0,0);
  const endDate   = new Date(de); endDate.setHours(23,59,59,999);

  const batchDays = [];
  for(let d=new Date(startDate); d<=endDate; d.setDate(d.getDate()+1)){
    if(dows.includes(d.getDay())){
      const s = new Date(d); s.setHours(hh,mm,0,0);
      batchDays.push(s);
    }
  }

  // plannen aanmaken (los van vak/subject)
  for(const s of batchDays){
    await addDoc(collection(db,'plans'),{
      itemId: null,
      title,
      type,
      subjectId: null,
      subjectName: '',         // vrij event
      color: '#607D8B',        // neutrale kleur (pas aan naar smaak)
      symbol: sym(type),
      start: s,
      durationHours: dur,
      dueDate: null,
        note: null,

      uid: ownerUid,
      createdAt: new Date()
    });
  }

  window.Modal?.close ? Modal.close("modal-quick") : (document.getElementById("modal-quick").hidden=true);
});


// Open "Vakken beheren" en render tabel
document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("#manageSubjectsBtn");
  if (!btn) return;
  if (!currentUser) { alert("Log eerst in."); return; }
  renderSubjectsManager();
  if (window.Modal?.open) Modal.open("modal-subjects");
  else document.getElementById("modal-subjects")?.removeAttribute("hidden");
});


// Toevoegen of bijwerken (boven het tabelletje)
document.addEventListener("click", async (ev) => {
  const save = ev.target.closest("#sub-save");
  if (!save) return;
  if (!currentUser){ alert("Log eerst in."); return; }

  const nameEl = document.getElementById("sub-name");
  const colorText = document.getElementById("sub-color-text");
  const name  = (nameEl?.value || "").trim();
  const color = colorText?.textContent || "#2196F3";
  if (!name){ alert("Geef een vaknaam."); return; }

  let subj = subjects.find(s => (s.name||"").toLowerCase() === name.toLowerCase());
  if (!subj){
    await addDoc(collection(db, "subjects"), { name, color, uid: ownerUid });
  } else {
    // update naam/kleur indien gewijzigd
    const updates = {};
    if (subj.name !== name)  updates.name  = name;
    if (subj.color !== color) updates.color = color;
    if (Object.keys(updates).length) await updateDoc(doc(db, "subjects", subj.id), updates);
  }
  // reset naamveld, preview laat ik staan op laatst gekozen kleur
  if (nameEl) nameEl.value = "";

  // Direct hertekenen (naast de live stream)
  renderSubjectsManager();
});


// Rij opslaan (update)
document.addEventListener("click", async (ev) => {
  const btn = ev.target.closest(".subj-update");
  if (!btn) return;
  if (!currentUser){ alert("Log eerst in."); return; }
  const tr = btn.closest("tr[data-id]");
  if (!tr) return;
  const id = tr.dataset.id;
  const name  = tr.querySelector(".s-name")?.value?.trim() || "";
  if (!name){ alert("Naam mag niet leeg zijn."); return; }
  await updateDoc(doc(db, "subjects", id), { name }); // kleur wijzig je via het palet bovenaan
  renderSubjectsManager();
});

// Verwijderen
document.addEventListener("click", async (ev) => {
  const btn = ev.target.closest(".subj-del");
  if (!btn) return;
  if (!currentUser){ alert("Log eerst in."); return; }
  const tr = btn.closest("tr[data-id]");
  if (!tr) return;
  const id = tr.dataset.id;
  if (!confirm("Dit vak verwijderen? (Backlog-items behouden hun oude vaknaam/kleur)")) return;
  await deleteDoc(doc(db, "subjects", id));
  renderSubjectsManager();
});

// Backlog item opslaan (nieuw/bewerken)
document.addEventListener("click", async (ev) => {
  const saveBtn = ev.target.closest("#bl-save");
  if (!saveBtn) return;

  if (!currentUser) { alert("Log eerst in."); return; }
  if (!validateBacklog()) return;

  const idEl       = document.getElementById("bl-id");
  const blSubject  = document.getElementById("bl-subject");
  const blType     = document.getElementById("bl-type");
  const blTitle    = document.getElementById("bl-title");
  const blDuration = document.getElementById("bl-duration");
  const blDue      = document.getElementById("bl-due");
  const propagate  = !!document.getElementById("bl-propagate")?.checked;

  // 🟢 NU: werken met subjectId
  const subjectId = blSubject?.value || "";
  const subj = subjects.find(s => s.id === subjectId);
  if (!subj){ alert("Kies een geldig vak."); return; }

  const editingId = idEl?.value || "";          // leeg = nieuw
  const typeVal   = blType?.value || "taak";
  const titleVal  = (blTitle?.value || "").trim();
  const durVal    = parseFloat(blDuration?.value) || 1;
  const dueVal    = blDue?.value ? new Date(blDue.value) : null;

  const payload = {
    uid: ownerUid,
    subjectId: subj.id,
    subjectName: subj.name,
    color: subj.color,
    type: typeVal,
    title: titleVal,
    durationHours: durVal,
    dueDate: dueVal,
    symbol: sym(typeVal),
    done: false,
    updatedAt: new Date()
  };

  try{
    if (!editingId) {
      payload.createdAt = new Date();
      await addDoc(collection(db,"backlog"), payload);
    } else {
      await updateDoc(doc(db,"backlog", editingId), payload);

      // Optioneel: geplande blokken die naar dit item verwijzen ook bijwerken
      if (propagate){
        const q = query(
          collection(db,'plans'),
          where('uid','==', ownerUid),
          where('itemId','==', editingId)
        );
        const snap = await getDocs(q);
        await Promise.all(snap.docs.map(d =>
          updateDoc(doc(db,'plans', d.id), {
            title: titleVal,
            type: typeVal,
            subjectId: subj.id,
            subjectName: subj.name,
            color: subj.color,
            symbol: sym(typeVal),
            dueDate: dueVal || null
          })
        ));
      }
    }

    // Sluit modal
    window.Modal?.close ? Modal.close("modal-backlog")
                        : document.getElementById("modal-backlog")?.setAttribute("hidden","");
    if (idEl) idEl.value = "";

  }catch(err){
    console.error('save backlog error', err);
    alert('Kon item niet bewaren: ' + (err?.message||err));
  }
});


document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("#newBacklogBtn,[data-modal-open='modal-backlog']");
  if (!btn) return;

  if (!currentUser) { alert("Log eerst in om items te bewaren."); return; }

  // reset velden per klik (modal kan later geladen zijn)
  const blSubject  = document.getElementById("bl-subject");
  const blTitle    = document.getElementById("bl-title");
  const blType     = document.getElementById("bl-type");
  const blDuration = document.getElementById("bl-duration");
  const blDue      = document.getElementById("bl-due");
  const blColor    = document.getElementById("bl-color");

  if (blSubject)  blSubject.value  = "";
  if (blTitle)    blTitle.value    = "";
  if (blType)     blType.value     = "taak";
  if (blDuration) blDuration.value = "1";
  if (blDue)      blDue.value      = "";
  if (blColor)    blColor.value    = "#2196F3";

  // open modal – gebruik Modal util als die geladen is, anders fallback
  if (window.Modal?.open) Modal.open("modal-backlog");
  else document.getElementById("modal-backlog")?.removeAttribute("hidden");
});


  bind("#printList", "click", () => {
    const sEl = document.getElementById("printStart");
    const eEl = document.getElementById("printEnd");
    const s = sEl?.value ? new Date(sEl.value) : addDays(new Date(), -7);
    const e = eEl?.value ? new Date(eEl.value) : addDays(new Date(), 7);

    const list = plans
      .filter(p=> p.start>=s && p.start< addDays(e,1))
      .slice()
      .sort((a,b)=> a.start - b.start);

    const tpl = document.getElementById('print-template');
    const win = window.open('', '_blank');
    win.document.write('<!DOCTYPE html><html><head><title>Afdruk – Lijst</title></head><body></body></html>');

    const frag = tpl.content.cloneNode(true);
    const root = frag.getElementById('print-root');

    let curDayKey = '';
    list.forEach(p=>{
      const d = toDate(p.start);
      const key = toISODate(d);
      if(key!==curDayKey){
        curDayKey = key;
        const h = win.document.createElement('div'); h.className='day';
        h.innerHTML = `<strong>${d.toLocaleDateString('nl-BE',{weekday:'long', day:'2-digit', month:'2-digit'})}</strong>`;
        root.appendChild(h);
      }
      const li = win.document.createElement('div'); li.className='item';
const symb = p.symbol || sym(p.type);
const typeLabel = (p.type||'').toUpperCase();
const start = toDate(p.start);
const end   = addMinutes(start, Math.round((p.durationHours||1)*60));
const dueSrc = p.dueDate || backlog.find(b => b.id === p.itemId)?.dueDate || null;
const dueStr = dueSrc ? toDate(dueSrc).toLocaleDateString('nl-BE') : '—';
const noteStr = p.note && String(p.note).trim() ? ` • opm: ${p.note}` : '';

li.textContent =
  `${symb} [${typeLabel}] ${fmtTime(start)}–${fmtTime(end)} • `
+ `${p.title} – ${p.subjectName} • tegen ${dueStr}${noteStr}`;


      root.appendChild(li);
    });

    win.document.body.appendChild(frag);
    win.document.close();
    win.focus();
  });

  /* ── Eerste render: grid altijd zichtbaar ── */
renderView();

  /* ── Auth stream ── */
onAuthStateChanged(auth, async (user)=>{
  if (!user) {
    currentUser = null;
    ownerUid = null;
    canWrite = false;
    renderView();
    return;
  }

  currentUser = user;

  // ✔ Toon ALTIJD de planner van de eigenaar
  ownerUid = "KNjbJuZV1MZMEUQKsViehVhW3832";   // <-- jouw UID
  // ✔ Alleen de eigenaar mag schrijven
  canWrite = (user.uid === ownerUid);

  // UI vergrendelen bij read-only
document.getElementById('newBacklogBtn')?.addEventListener('click', ()=>{
  if (!canWrite){ alert('Lezen is toegestaan, wijzigen niet.'); return; }
  openBacklogModalNew();
});
  document.getElementById("manageSubjectsBtn")?.toggleAttribute("disabled", !canWrite);

  bindStreams();
  cleanupExpiredBacklog();
  if (window._backlogCleanupTimer) clearInterval(window._backlogCleanupTimer);
  window._backlogCleanupTimer = setInterval(cleanupExpiredBacklog, 6*60*60*1000);

  renderView();
});

  /* ───────────────────── Renderers & Data ───────────────────── */
// Weergave wisselen
document.addEventListener('click', (e)=>{
  if (e.target.closest('#viewWeek')) {
    viewMode = 'week';
    document.getElementById('viewWeek')?.classList.add('is-active');
    document.getElementById('viewDay') ?.classList.remove('is-active');
    document.getElementById('dayPicker').style.display = 'none';
    renderView();
    if(currentUser) refreshPlans();
  }
  if (e.target.closest('#viewDay')) {
    viewMode = 'day';
    document.getElementById('viewDay') ?.classList.add('is-active');
    document.getElementById('viewWeek')?.classList.remove('is-active');
    // dagpicker default op vandaag
    const dp = document.getElementById('dayPicker');
    if (dp){
      dp.style.display = '';
      dp.value = startOfDay(dayDate).toISOString().slice(0,10);
    }
    renderView();
    if(currentUser) refreshPlans();
  }
});

// Dag kiezen
document.addEventListener('input', (e)=>{
  const dp = e.target.closest('#dayPicker');
  if (!dp) return;
  dayDate = new Date(dp.value);
  renderView();
  if(currentUser) refreshPlans();
});

// Navigatieknoppen: vorige/volgende
document.getElementById('prevWeek')?.addEventListener('click', ()=>{
  if (viewMode === 'day') { dayDate.setDate(dayDate.getDate()-1); }
  else { weekStart = addDays(weekStart,-7); }
  renderView(); if(currentUser) refreshPlans();
});
document.getElementById('nextWeek')?.addEventListener('click', ()=>{
  if (viewMode === 'day') { dayDate.setDate(dayDate.getDate()+1); }
  else { weekStart = addDays(weekStart, 7); }
  renderView(); if(currentUser) refreshPlans();
});


  function renderSubjectsDatalist(){
    if(!blSubjects) return;
    blSubjects.innerHTML = subjects.map(s=>`<option value="${esc(s.name)}"></option>`).join('');
  }

function renderSubjectsManager(){
  const tbody = document.getElementById("subjectsTable");
  if (!tbody) return;

  if (!Array.isArray(subjects) || subjects.length === 0){
    tbody.innerHTML = `<tr><td colspan="3" class="muted">Nog geen vakken…</td></tr>`;
  } else {
    tbody.innerHTML = subjects.map(s => `
      <tr data-id="${s.id}">
        <td><input class="s-name" value="${esc(s.name||'')}" /></td>
        <td>
          <div style="display:flex;align-items:center;gap:.5rem;">
            <span class="dot" style="width:16px;height:16px;border-radius:50%;display:inline-block;background:${esc(s.color||'#2196F3')};border:1px solid #0001"></span>
            <code>${esc(s.color||'#2196F3')}</code>
          </div>
        </td>
        <td style="display:flex; gap:.4rem;">
          <button class="subj-update">Opslaan</button>
          <button class="subj-del danger">Verwijder</button>
        </td>
      </tr>
    `).join("");
  }

  // (Re)render palette + preview elke keer dat modal open of subjects wijzigen
  const palRoot = document.getElementById("sub-palette");
  const previewDot  = document.querySelector("#sub-color-preview .dot");
  const previewText = document.getElementById("sub-color-text");

  if (palRoot && previewDot && previewText){
    palRoot.innerHTML = "";
    const current = previewText.textContent || "#2196F3";
    PALETTE.forEach(hex=>{
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.style.cssText = `width:22px;height:22px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #0002;background:${hex};cursor:pointer;`;
      if (hex.toLowerCase() === current.toLowerCase()){
        b.style.outline = "2px solid #0005";
      }
      b.addEventListener("click", ()=>{
        previewDot.style.background = hex;
        previewText.textContent = hex;
        // mark active
        palRoot.querySelectorAll(".swatch").forEach(s=> s.style.outline="");
        b.style.outline = "2px solid #0005";
      });
      palRoot.appendChild(b);
    });
  }
}

function applyBacklogFilter(list){
  return list.filter(it=>{
    // tekst
    if (backlogFilter.text){
      const t = `${it.title||''} ${it.subjectName||''}`.toLowerCase();
      if (!t.includes(backlogFilter.text)) return false;
    }
    // vak
    if (backlogFilter.subjectId && it.subjectId !== backlogFilter.subjectId) return false;
    // type
    if (backlogFilter.type && it.type !== backlogFilter.type) return false;
    // deadlines
    if (backlogFilter.from && (!it.dueDate || toDate(it.dueDate) < startOfDay(backlogFilter.from))) return false;
    if (backlogFilter.to){
      const endDay = new Date(startOfDay(backlogFilter.to)); endDay.setDate(endDay.getDate()+1); // t/m
      if (!it.dueDate || toDate(it.dueDate) >= endDay) return false;
    }
    return true;
  });
}

function renderBacklog(){
  const container = document.getElementById("backlogGroups");
  if(!container) return;

  // 👉 enkel de backlog filteren (niet de kalender/plans)
  const source = applyBacklogFilter(backlog.filter(x => !x.done));

  // groepen per vak opbouwen, maar alleen met items die door de filter komen
  const groups = new Map();
  source.forEach(item=>{
    const key = item.subjectId || '_none';
    if(!groups.has(key)){
      groups.set(key, {
        subjectName: item.subjectName || '—',
        color: item.color || '#ccc',
        items: []
      });
    }
    groups.get(key).items.push(item);
  });

  container.innerHTML = '';

  if (source.length === 0){
    container.innerHTML = `<div class="muted" style="padding:.75rem;">Geen items voor deze filter…</div>`;
    return;
  }

  for (const [,grp] of groups){
    // sla lege groepen (door filter) over
    if (!grp.items.length) continue;

    const wrap = document.createElement('div');
    wrap.className = 'bl-group';
    const fg = getContrast(grp.color);
    wrap.innerHTML = `
      <div class="bl-title" style="background:${grp.color};color:${fg};">
        <span>${esc(grp.subjectName)}</span>
      </div>
      <div class="bl-list"></div>
    `;
    const list = wrap.querySelector('.bl-list');
    grp.items.forEach(it => list.appendChild(renderBacklogItem(it)));
    container.appendChild(wrap);
  }
}
window.renderBacklog = renderBacklog;


function renderBacklogItem(it){
  const row = document.createElement('div');
 row.className = `bl-item type-${(it.type||'').toLowerCase()}`;

  row.draggable = true;
  row.dataset.id = it.id;
  row.innerHTML = `
    <div class="bl-sym">${it.symbol||sym(it.type)}</div>
    <div class="bl-main">
      <div class="t">${esc(it.title||'(zonder titel)')}</div>
      <div class="sub">${it.type} • ${it.durationHours||1}u${it.dueDate?` • tegen ${toDate(it.dueDate).toLocaleDateString('nl-BE')}`:''}</div>
    </div>
    <div class="bl-actions">
      <button class="btn-icon sm edit"    title="Bewerken"       aria-label="Bewerken">✏️</button>
      <button class="btn-icon sm neutral" title="Markeer klaar"  aria-label="Markeer klaar">✓</button>
      <button class="btn-icon sm danger"  title="Verwijderen"    aria-label="Verwijderen">🗑️</button>
    </div>
  `;

  // drag voor plannen
  row.addEventListener('dragstart', (e)=>{
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/json', JSON.stringify({kind:'backlog', id: it.id}));
    e.dataTransfer.setData('text/plain',       JSON.stringify({kind:'backlog', id: it.id}));
    document.body.classList.add('dragging-backlog');
  });
  row.addEventListener('dragend', ()=> document.body.classList.remove('dragging-backlog'));

  // klaar
  row.querySelector('.neutral').onclick = async ()=>{
    if(!currentUser){ alert('Log eerst in.'); return; }
    await updateDoc(doc(db,'backlog', it.id), { done: true, doneAt: new Date() });
  };

  // verwijderen
  row.querySelector('.danger').onclick = async ()=>{
    if(!currentUser){ alert('Log eerst in.'); return; }
    if(!confirm('Item verwijderen?')) return;
    await deleteDoc(doc(db,'backlog', it.id));
  };

  // ✏️ bewerken
  // ✏️ bewerken (gebruik de centrale open-functie)
row.querySelector('.edit').onclick = ()=>{
  if(!currentUser){ alert('Log eerst in.'); return; }
  openBacklogModalEdit(it);
};


  return row;
}


  /* ───────────────────── Firestore streams ───────────────────── */
  function bindStreams(){
    
    onSnapshot(
      query(collection(db,'subjects'), where('uid','==', ownerUid), orderBy('name','asc')),
      (snap)=>{
        subjects = snap.docs.map(d=>({id:d.id, ...d.data()}));
renderSubjectsDatalist();
renderBacklog();
renderCalendar();

// ▼ Extra UI: herteken manager / subject-menu als modals open zijn
const subjModalOpen = !document.getElementById("modal-subjects")?.hasAttribute("hidden");
if (subjModalOpen) renderSubjectsManager();

const subjInputVisible = !!document.getElementById("bl-subject") && !document.getElementById("modal-backlog")?.hasAttribute("hidden");
if (subjInputVisible){
  const input = document.getElementById("bl-subject");
  renderSubjectMenu(input?.value || "");
}

      },
      (err)=> console.error("subjects stream error", err)
    );

    onSnapshot(
      query(collection(db,'backlog'), where('uid','==', ownerUid), orderBy('subjectName','asc')),
      (snap)=>{
        backlog = snap.docs.map(d=>({id:d.id, ...d.data()}));
        renderBacklog();
      },
      (err)=> console.error("backlog stream error", err)
    );

  
    refreshPlans();



  }

function refreshPlans(){
  const { start, end } = getPeriodRange();
  if (window._plansUnsub) { window._plansUnsub(); window._plansUnsub = null; }
  window._plansUnsub = onSnapshot(
    query(
      collection(db,'plans'),
      where('uid','==', ownerUid),
      where('start','>=', start),
      where('start','<',  end)
    ),
    (snap)=>{
      plans = snap.docs.map(d=>({id:d.id, ...d.data(), start: toDate(d.data().start)}));
      renderCalendar();
    },
    (err)=> console.error("plans stream error", err)
  );
}


});
