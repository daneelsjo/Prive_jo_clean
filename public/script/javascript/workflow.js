// workflow.js - V0.4.1 (Tag Color Picker Update)

import {
  getFirebaseApp, getFirestore, collection, addDoc, doc, updateDoc, deleteDoc,
  serverTimestamp, query, where, getDocs
} from "./firebase-config.js"

// --- Config & Constants ---
const app = getFirebaseApp();
const db = window.App?.db || getFirestore(app);

const COLLECTIONS = {
  BOARDS: "workflowBoards",
  COLUMNS: "workflowColumns",
  CARDS: "workflowCards",
  TAGS: "workflowTags"
}

const DEFAULT_COLUMNS = [
  { key: "backlog", title: "Backlog", order: 1 },
  { key: "to-discuss", title: "Te bespreken", order: 2 },
  { key: "in-progress", title: "In progress", order: 3 },
  { key: "done", title: "Afgewerkt", order: 4 }
]

const PRIORITY_TAGS = [
  { key: "priority-low", name: "Low", color: "#16a34a" },
  { key: "priority-normal", name: "Normal", color: "#2563eb" },
  { key: "priority-high", name: "High", color: "#f97316" },
  { key: "priority-critical", name: "Critical", color: "#dc2626" }
]

// Nieuw: Kleurenpalet voor eigen tags
const TAG_PALETTE = [
  "#64748b", "#ef4444", "#f97316", "#f59e0b", "#84cc16", 
  "#10b981", "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1", 
  "#8b5cf6", "#d946ef", "#f43f5e", "#881337"
];

const PRIORITY_VALS = {
  "priority-critical": 4, "priority-high": 3, "priority-normal": 2, "priority-low": 1
}

// --- State ---
const state = {
  uid: null, boardId: null,
  columns: [], cardsById: new Map(),
  tags: [], tagsById: new Map(),
  backlogColumnId: null,
  allCardsSorted: [], 
  filter: { keyword: "", tags: new Set() },
  dragState: { cardId: null },
  form: { mode: "create", cardId: null, workingTags: new Set(), activeTab: "details" },
  newTagState: { color: TAG_PALETTE[0] }, // Nieuwe state voor tag creatie
  dom: {} 
}

// --- DOM Helpers ---
const $ = (id) => document.getElementById(id)
const qs = (sel, parent = document) => parent.querySelector(sel)
const createEl = (tag, className, text = "") => {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (text) el.textContent = text
  return el
}

function setBoardMessage(msg, isError = false) {
  const boardEl = $("workflow-board")
  if (boardEl) {
    const color = isError ? "#ef4444" : "inherit";
    boardEl.innerHTML = `<p style="padding:1rem; opacity:0.8; color:${color}">${msg}</p>`
  }
}

function showToast(message) {
  let toast = qs(".wf-toast");
  if (!toast) { toast = createEl("div", "wf-toast"); document.body.appendChild(toast); }
  toast.textContent = message; toast.classList.add("visible");
  setTimeout(() => { toast.classList.remove("visible"); }, 3500);
}

function handleActionError(action, error, context = {}, userMessage = "Er is een fout opgetreden.") {
  console.error(`[Workflow Error] ${action}:`, error);
  showToast(userMessage);
}

// --- Date Helpers ---
const formatDateForInput = (timestamp) => {
  if (!timestamp) return "";
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
  if (isNaN(date)) return "";
  return date.toISOString().split('T')[0];
}
const parseDateFromInput = (val) => {
  if (!val) return null;
  return new Date(val);
}

function getUrgency(dueDate) {
  if (!dueDate) return { isUrgent: false, isOverdue: false, diffDays: 999 };
  const d = typeof dueDate.toDate === 'function' ? dueDate.toDate() : new Date(dueDate);
  const now = new Date();
  d.setHours(23,59,59,999); now.setHours(0,0,0,0);
  const diffTime = d - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return { isOverdue: diffDays < 0, isUrgent: diffDays >= 0 && diffDays <= 7, diffDays, dateObj: d };
}

// --- Sorting Logic ---
function getCardPriorityValue(card) {
  if (!card.tags || !card.tags.length) return 0;
  let maxPrio = 0;
  card.tags.forEach(tagId => {
    const tag = state.tagsById.get(tagId);
    if (tag && tag.builtin && tag.builtinKey) {
      let val = PRIORITY_VALS[tag.builtinKey] || 0;
      if (val === 0) {
         const found = PRIORITY_TAGS.find(p => p.name === tag.name);
         if (found) val = PRIORITY_VALS[found.key];
      }
      if (val > maxPrio) maxPrio = val;
    }
  });
  return maxPrio;
}

function sortCardsLogic(a, b) {
  const prioA = getCardPriorityValue(a); const prioB = getCardPriorityValue(b);
  if (prioA !== prioB) return prioB - prioA;
  const dateA = a.dueDate ? (a.dueDate.toDate ? a.dueDate.toDate() : new Date(a.dueDate)) : null;
  const dateB = b.dueDate ? (b.dueDate.toDate ? b.dueDate.toDate() : new Date(b.dueDate)) : null;
  if (dateA && dateB) { if (dateA.getTime() !== dateB.getTime()) return dateA.getTime() - dateB.getTime(); }
  else if (dateA && !dateB) return -1; else if (!dateA && dateB) return 1; 
  return (a.title || "").localeCompare(b.title || "");
}

// --- Data Operations ---
async function getOrCreateBoard(uid) {
  const boardsRef = collection(db, COLLECTIONS.BOARDS);
  const q = query(boardsRef, where("uid", "==", uid));
  const snap = await getDocs(q);
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  const newBoard = { uid, name: "Mijn Workflow", isDefault: true, createdAt: serverTimestamp() };
  const ref = await addDoc(boardsRef, newBoard);
  return { id: ref.id, ...newBoard };
}

async function fetchColumns(boardId, uid) {
  const colRef = collection(db, COLLECTIONS.COLUMNS);
  const q = query(colRef, where("boardId", "==", boardId), where("uid", "==", uid));
  let snap = await getDocs(q);
  if (snap.empty) {
    const batch = DEFAULT_COLUMNS.map(def => addDoc(colRef, { boardId, uid, title: def.title, order: def.order, createdAt: serverTimestamp() }));
    await Promise.all(batch); snap = await getDocs(q);
  }
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.order||0) - (b.order||0));
}

async function fetchCards(boardId, uid) {
  const q = query(collection(db, COLLECTIONS.CARDS), where("boardId","==",boardId), where("uid","==",uid));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fetchAndSyncTags(boardId, uid) {
  const tagsRef = collection(db, COLLECTIONS.TAGS);
  const q = query(tagsRef, where("boardId","==",boardId), where("uid","==",uid));
  const snap = await getDocs(q);
  let loadedTags = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const existing = new Set(loadedTags.map(t => t.name));
  const missing = PRIORITY_TAGS.filter(p => !existing.has(p.name));
  if(missing.length > 0) {
    const newTags = await Promise.all(missing.map(p => addDoc(tagsRef, { 
      boardId, uid, name: p.name, color: p.color, active: true, builtin: true, builtinKey: p.key, createdAt: serverTimestamp() 
    }).then(ref => ({ id: ref.id, boardId, uid, ...p, active: true, builtin: true }))));
    loadedTags = [...loadedTags, ...newTags];
  }
  return loadedTags.sort((a,b) => a.name.localeCompare(b.name));
}

// --- Render ---
function renderBoard() {
  const root = state.dom.board; root.innerHTML = "";
  if (!state.columns.length) { setBoardMessage("Geen kolommen."); return; }

  state.allCardsSorted = Array.from(state.cardsById.values()).sort((a,b) => {
     const tA = a.createdAt ? (a.createdAt.toMillis ? a.createdAt.toMillis() : 0) : 0;
     const tB = b.createdAt ? (b.createdAt.toMillis ? b.createdAt.toMillis() : 0) : 0;
     return tA - tB;
  });
  state.allCardsSorted.forEach((card, index) => { card.visualId = index + 1; });

  const keyword = state.filter.keyword.toLowerCase().trim();
  const filterTags = state.filter.tags;

  const filtered = state.allCardsSorted.filter(card => {
    const matchText = !keyword || (card.title||"").toLowerCase().includes(keyword) || (card.visualId && String(card.visualId).includes(keyword));
    let matchTags = true;
    if(filterTags.size > 0) matchTags = (card.tags||[]).some(id => filterTags.has(id));
    return matchText && matchTags;
  });

  filtered.sort(sortCardsLogic);

  const byCol = {}; state.columns.forEach(c => byCol[c.id] = []);
  filtered.forEach(c => { if(byCol[c.columnId]) byCol[c.columnId].push(c) });

  state.columns.forEach(col => {
    const colEl = createEl("div", "wf-column");
    const header = createEl("header", "wf-column-header");
    header.appendChild(createEl("h2", "wf-column-title", col.title));
    
    const count = byCol[col.id].length;
    const total = Array.from(state.cardsById.values()).filter(c => c.columnId === col.id).length;
    header.appendChild(createEl("span", "wf-column-count", count !== total ? `${count} / ${total}` : count.toString()));
    colEl.appendChild(header);

    const listEl = createEl("div", "wf-column-cards"); listEl.dataset.columnId = col.id;
    byCol[col.id].forEach(c => listEl.appendChild(createCardElement(c)));
    colEl.appendChild(listEl); root.appendChild(colEl);
  });
}

function createCardElement(card) {
  const el = createEl("article", "wf-card"); el.dataset.cardId = card.id; el.draggable = true;
  const header = createEl("div", "wf-card-header");
  const titleGroup = createEl("div", "wf-card-title-group");
  const idSpan = createEl("span", "wf-card-id", `#${card.visualId}`);
  titleGroup.appendChild(idSpan);
  titleGroup.appendChild(document.createTextNode(card.title || "Naamloos"));
  header.appendChild(titleGroup);

  if (card.dueDate) {
    const urgency = getUrgency(card.dueDate);
    const dateStr = urgency.dateObj.toLocaleDateString('nl-NL', { day:'numeric', month:'short' });
    const dateEl = createEl("div", "wf-card-date", dateStr);
    if(urgency.isUrgent || urgency.isOverdue) {
       dateEl.classList.add("urgent");
       dateEl.title = urgency.isOverdue ? "Vervallen!" : "Vervalt bijna!";
    }
    header.appendChild(dateEl);
  }
  el.appendChild(header);

  if (card.tags && card.tags.length > 0) {
    const chips = createEl("div", "wf-card-tags-chips");
    card.tags.forEach(tagId => {
      const tag = state.tagsById.get(tagId);
      if (tag && tag.active !== false) {
        const chip = createEl("span", "wf-tag-chip", tag.name);
        chip.style.backgroundColor = tag.color;
        chips.appendChild(chip);
      }
    });
    if (chips.children.length > 0) el.appendChild(chips);
  }
  return el;
}

// --- Urgent Popup ---
function checkUrgencyAndShowPopup() {
  const todayStr = new Date().toDateString();
  const dismissed = localStorage.getItem("workflow_popup_dismissed_" + todayStr);
  if (dismissed) return;

  const overdueItems = [];
  const urgentItems = [];

  state.allCardsSorted.forEach(card => {
    const col = state.columnsById.get(card.columnId);
    if(col && col.title.toLowerCase() === "afgewerkt") return; 
    const u = getUrgency(card.dueDate);
    if (u.isOverdue) overdueItems.push(card); else if (u.isUrgent) urgentItems.push(card);
  });

  if (overdueItems.length === 0 && urgentItems.length === 0) return;
  const list = qs("#urgent-popup-list"); list.innerHTML = "";
  const addItem = (card, label, cls) => {
    const row = createEl("div", `wf-urgent-item ${cls}`);
    const dStr = getUrgency(card.dueDate).dateObj.toLocaleDateString('nl-NL', {day:'numeric', month:'short'});
    row.innerHTML = `<span><strong>#${card.visualId}</strong> ${card.title}</span> <span>${dStr} (${label})</span>`;
    list.appendChild(row);
  };
  overdueItems.forEach(c => addItem(c, "Vervallen", "overdue"));
  urgentItems.forEach(c => addItem(c, "Binnenkort", "near"));
  const modal = qs("#modal-urgent"); modal.classList.remove("wf-card-form--hidden");
}

function closeUrgentPopup() {
  const modal = qs("#modal-urgent");
  const checkbox = qs("#urgent-popup-check");
  if (checkbox.checked) localStorage.setItem("workflow_popup_dismissed_" + new Date().toDateString(), "true");
  modal.classList.add("wf-card-form--hidden");
}

// --- Modal & Tags UI ---
function switchModalTab(tabName) {
  state.form.activeTab = tabName;
  qs("[data-tab='details']").classList.toggle("active", tabName === 'details');
  qs("[data-tab='timeline']").classList.toggle("active", tabName === 'timeline');
  qs("#tab-content-details").classList.toggle("active", tabName === 'details');
  qs("#tab-content-timeline").classList.toggle("active", tabName === 'timeline');
}

function renderFormTagSelector() {
  const { chipsContainer, tagsListContainer } = state.dom.formTags;
  chipsContainer.innerHTML = "";
  if (state.form.workingTags.size === 0) {
    const ph = createEl("span", "", "Geen tags geselecteerd"); ph.style.opacity = "0.6"; ph.style.fontSize = "0.8rem";
    chipsContainer.appendChild(ph);
  } else {
    state.form.workingTags.forEach(tagId => {
      const tag = state.tagsById.get(tagId); if (!tag) return;
      const chip = createEl("span", "wf-tag-chip", tag.name); chip.style.backgroundColor = tag.color;
      chipsContainer.appendChild(chip);
    });
  }
  tagsListContainer.innerHTML = "";
  const allTags = state.tags.filter(t => t.active !== false);
  const selectedTags = allTags.filter(t => state.form.workingTags.has(t.id));
  const availableTags = allTags.filter(t => !state.form.workingTags.has(t.id));

  const createTagButton = (tag, isSelected) => {
    const btn = createEl("div", "wf-tag-pill" + (isSelected ? " selected" : ""));
    btn.textContent = tag.name; btn.style.backgroundColor = tag.color;
    btn.addEventListener("click", () => {
      if (isSelected) state.form.workingTags.delete(tag.id); else state.form.workingTags.add(tag.id);
      renderFormTagSelector();
    });
    return btn;
  };
  if (selectedTags.length > 0) {
    tagsListContainer.appendChild(createEl("div", "wf-tags-section-title", "Huidige tags"));
    const row = createEl("div", "wf-tags-columns");
    selectedTags.forEach(t => row.appendChild(createTagButton(t, true)));
    tagsListContainer.appendChild(row);
  }
  if (availableTags.length > 0) {
    const title = createEl("div", "wf-tags-section-title", "Toevoegen");
    if(selectedTags.length > 0) title.style.marginTop = "1rem";
    tagsListContainer.appendChild(title);
    const row = createEl("div", "wf-tags-columns");
    availableTags.forEach(t => row.appendChild(createTagButton(t, false)));
    tagsListContainer.appendChild(row);
  }
}

function renderManageTagsList() {
  const c = state.dom.manageTagsList; c.innerHTML=""; c.className="wf-tags-list-board";
  const systemTags = state.tags.filter(t => t.builtin);
  const customTags = state.tags.filter(t => !t.builtin);

  const renderSection = (title, tags, allowDelete) => {
    if(tags.length === 0) return;
    const header = createEl("div", "wf-tags-section-title", title); header.style.marginTop = "0.5rem"; c.appendChild(header);
    tags.forEach(t => {
      const r = createEl("div", "wf-tag-row");
      const left = createEl("div", "", ""); left.style.display="flex"; left.style.alignItems="center"; left.style.gap="0.5rem";
      const p = createEl("span", "wf-tag-chip", t.name); p.style.backgroundColor=t.color; left.appendChild(p); r.appendChild(left);
      const right = createEl("div", "wf-tag-row-actions");
      const l = createEl("label", "wf-switch");
      const i = createEl("input"); i.type="checkbox"; i.checked=t.active!==false; i.disabled=!!t.builtin;
      if(!t.builtin) { i.addEventListener("change", async()=>{ try{ await updateDoc(doc(db,COLLECTIONS.TAGS,t.id),{active:i.checked}); reloadData(); } catch(e){handleActionError("toggleTag",e); i.checked = !i.checked; } }); }
      l.appendChild(i); l.appendChild(createEl("span","wf-slider")); right.appendChild(l);
      if (allowDelete) {
        const delBtn = createEl("button", "btn-icon-small", "🗑️"); delBtn.title = "Tag verwijderen";
        delBtn.addEventListener("click", async () => { if(confirm(`Tag "${t.name}" definitief verwijderen?`)) { try { await deleteDoc(doc(db, COLLECTIONS.TAGS, t.id)); reloadData(); renderManageTagsList(); } catch(e) { handleActionError("delTag", e); } } });
        right.appendChild(delBtn);
      }
      r.appendChild(right); c.appendChild(r);
    });
  }
  renderSection("Standaard Tags", systemTags, false);
  renderSection("Eigen Tags", customTags, true);
}

// --- Logs & Links ---
function renderCardLogs(card) {
  const list = qs(".wf-log-list"); list.innerHTML = "";
  const logs = card.logs || [];
  if (logs.length === 0) { list.innerHTML = `<div style="opacity:0.6; font-size:0.85rem; text-align:center; padding:0.5rem;">Nog geen logs.</div>`; return; }
  logs.map((l, idx) => ({ ...l, _idx: idx })).forEach(log => {
    const item = createEl("div", "wf-log-item");
    const dateStr = new Date(log.timestamp).toLocaleString('nl-NL', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    const contentGroup = createEl("div", "wf-log-content-group");
    contentGroup.innerHTML = `<span class="wf-log-date">${dateStr}</span><span class="wf-log-content">${log.content}</span>`;
    item.appendChild(contentGroup);
    const actions = createEl("div", "wf-log-actions");
    const editBtn = createEl("button", "btn-icon-small", "✏️"); editBtn.addEventListener("click", () => editLogEntry(log._idx, log.content)); actions.appendChild(editBtn);
    const delBtn = createEl("button", "btn-icon-small", "🗑️"); delBtn.addEventListener("click", () => deleteLogEntry(log._idx)); actions.appendChild(delBtn);
    item.appendChild(actions); list.appendChild(item);
  });
}

function renderCardLinks(card) {
  const list = qs(".wf-link-list"); list.innerHTML = "";
  const links = card.links || [];
  if (links.length === 0) { list.innerHTML = `<div style="opacity:0.6; font-size:0.85rem; text-align:center;">Geen documenten.</div>`; return; }
  links.forEach(link => {
    let safeUrl = link.url; if (!safeUrl.match(/^https?:\/\//i)) safeUrl = "http://" + safeUrl;
    const item = createEl("div", "wf-link-item");
    item.innerHTML = `<a href="${safeUrl}" target="_blank">🔗 ${link.name || link.url}</a><button class="wf-btn-icon-small btn-remove-link">🗑️</button>`;
    item.querySelector(".btn-remove-link").addEventListener("click", () => deleteLinkEntry(link.id));
    list.appendChild(item);
  });
}

// --- Actions Implementation ---
async function reloadData() {
  if (!state.uid || !state.boardId) return;
  try {
    const [cols, cards, tags] = await Promise.all([
      fetchColumns(state.boardId, state.uid), fetchCards(state.boardId, state.uid), fetchAndSyncTags(state.boardId, state.uid)
    ]);
    state.columns = cols; state.columnsById = new Map(cols.map(c=>[c.id,c]));
    state.tags = tags; state.tagsById = new Map(tags.map(t=>[t.id,t]));
    state.cardsById = new Map(cards.map(c=>[c.id,c]));
    const backlog = cols.find(c => c.title === "Backlog") || cols[0];
    state.backlogColumnId = backlog ? backlog.id : null;
    if (state.form.mode==='edit' && state.form.cardId) {
      const cur = state.cardsById.get(state.form.cardId);
      if(cur) { renderCardLogs(cur); renderCardLinks(cur); }
    }
    renderBoard(); checkUrgencyAndShowPopup();
  } catch (err) { handleActionError("reloadData", err); }
}

function openCardForm(cardId = null) {
  state.form.mode = cardId ? "edit" : "create";
  state.form.cardId = cardId;
  state.form.workingTags = new Set();
  switchModalTab('details');
  
  const { title, desc, deadline } = state.dom.inputs;
  const timelineTabBtn = qs("[data-tab='timeline']");
  const timelineOverlay = qs("#timeline-new-card-overlay");

  if (cardId) {
    const card = state.cardsById.get(cardId); if(!card) return;
    title.value = card.title; desc.value = card.description || "";
    deadline.value = formatDateForInput(card.dueDate);
    if(card.tags) card.tags.forEach(t => state.form.workingTags.add(t));
    
    state.dom.btnDelete.style.display = "block"; 
    timelineTabBtn.style.display = "block"; timelineOverlay.style.display = "none";
    renderCardLogs(card); renderCardLinks(card);
  } else {
    title.value = ""; desc.value = ""; deadline.value = "";
    state.dom.btnDelete.style.display = "none"; 
    timelineTabBtn.style.opacity = "0.5"; timelineOverlay.style.display = "flex";
  }
  
  state.dom.formTags.panel.classList.add("wf-form-tags-panel--hidden");
  renderFormTagSelector();
  state.dom.modals.card.classList.remove("wf-card-form--hidden");
  title.focus();
}

async function saveCard(e) {
  e.preventDefault(); if (!state.uid) return;
  const title = state.dom.inputs.title.value.trim(); if(!title) return showToast("Titel is verplicht");
  const btn = qs("button[type='submit']", state.dom.modals.card);
  const orig = btn.textContent; btn.disabled=true; btn.textContent="Bezig...";
  const data = {
    title, description: state.dom.inputs.desc.value.trim(),
    dueDate: parseDateFromInput(state.dom.inputs.deadline.value),
    tags: Array.from(state.form.workingTags), updatedAt: serverTimestamp()
  };
  try {
    if (state.form.mode === "edit") await updateDoc(doc(db, COLLECTIONS.CARDS, state.form.cardId), data);
    else {
      if(!state.backlogColumnId) throw new Error("No Backlog");
      Object.assign(data, { boardId: state.boardId, uid: state.uid, columnId: state.backlogColumnId, status: "Backlog", sort: Date.now(), createdAt: serverTimestamp(), logs:[], links:[] });
      await addDoc(collection(db, COLLECTIONS.CARDS), data);
    }
    state.dom.modals.card.classList.add("wf-card-form--hidden"); reloadData();
  } catch(e) { handleActionError("saveCard", e); } 
  finally { btn.disabled=false; btn.textContent=orig; }
}

async function deleteCard() {
  if(!confirm("Weet je het zeker?")) return;
  try { await deleteDoc(doc(db, COLLECTIONS.CARDS, state.form.cardId)); state.dom.modals.card.classList.add("wf-card-form--hidden"); reloadData(); } 
  catch(e) { handleActionError("deleteCard", e); }
}

async function addLogEntry() {
  const input = qs("#input-log-entry"); const text = input.value.trim(); if(!text) return;
  const card = state.cardsById.get(state.form.cardId); const logs = [ {content:text, timestamp:new Date().toISOString()}, ...(card.logs||[]) ];
  try { await updateDoc(doc(db, COLLECTIONS.CARDS, state.form.cardId), {logs}); input.value=""; card.logs=logs; renderCardLogs(card); } 
  catch(e){ handleActionError("addLog",e); }
}
async function deleteLogEntry(index) {
  if(!confirm("Log verwijderen?")) return;
  const card = state.cardsById.get(state.form.cardId); const logs = [...(card.logs || [])]; logs.splice(index, 1);
  try { await updateDoc(doc(db, COLLECTIONS.CARDS, state.form.cardId), {logs}); card.logs=logs; renderCardLogs(card); } 
  catch(e){ handleActionError("delLog",e); }
}
async function editLogEntry(index, oldContent) {
  const newText = prompt("Wijzig log:", oldContent); if (newText === null || newText.trim() === "") return;
  const card = state.cardsById.get(state.form.cardId); const logs = [...(card.logs || [])];
  if(logs[index]) { logs[index] = { ...logs[index], content: newText.trim() }; }
  try { await updateDoc(doc(db, COLLECTIONS.CARDS, state.form.cardId), {logs}); card.logs=logs; renderCardLogs(card); } 
  catch(e){ handleActionError("editLog",e); }
}
async function addLinkEntry() {
  const nInput = qs("#input-link-name"), uInput = qs("#input-link-url");
  const url = uInput.value.trim(); if(!url) return;
  const card = state.cardsById.get(state.form.cardId);
  const links = [ ...(card.links||[]), { id: Date.now().toString(), name: nInput.value.trim()||url, url } ];
  try { await updateDoc(doc(db, COLLECTIONS.CARDS, state.form.cardId), {links}); nInput.value=""; uInput.value=""; card.links=links; renderCardLinks(card); } 
  catch(e){ handleActionError("addLink",e); }
}
async function deleteLinkEntry(id) {
  if(!confirm("Link verwijderen?")) return;
  const card = state.cardsById.get(state.form.cardId); const links = (card.links||[]).filter(l=>l.id!==id);
  try { await updateDoc(doc(db, COLLECTIONS.CARDS, state.form.cardId), {links}); card.links=links; renderCardLinks(card); } 
  catch(e){ handleActionError("deleteLink",e); }
}

// --- NEW TAG LOGIC (MODAL) ---
function createNewTag() {
  // Reset fields
  qs("#new-tag-name").value = "";
  state.newTagState.color = TAG_PALETTE[0];
  renderNewTagColorPicker();
  
  // Show Modal
  state.dom.modals.newTag.classList.remove("wf-card-form--hidden");
  qs("#new-tag-name").focus();
}

function renderNewTagColorPicker() {
  const container = qs("#new-tag-colors");
  container.innerHTML = "";
  TAG_PALETTE.forEach(color => {
    const circle = createEl("div", "", "");
    circle.style.width = "24px"; circle.style.height = "24px";
    circle.style.borderRadius = "50%"; circle.style.backgroundColor = color;
    circle.style.cursor = "pointer";
    circle.style.border = (state.newTagState.color === color) ? "2px solid #fff" : "2px solid transparent";
    if (state.newTagState.color === color) circle.style.boxShadow = "0 0 0 2px #2563eb"; // Highlight
    
    circle.onclick = () => {
      state.newTagState.color = color;
      renderNewTagColorPicker();
    };
    container.appendChild(circle);
  });
}

async function saveNewTag() {
  const nameInput = qs("#new-tag-name");
  const name = nameInput.value.trim();
  if(!name) return showToast("Naam verplicht");
  
  try {
    await addDoc(collection(db, COLLECTIONS.TAGS), {
      boardId: state.boardId,
      uid: state.uid,
      name: name,
      color: state.newTagState.color,
      active: true,
      builtin: false,
      createdAt: serverTimestamp()
    });
    
    // Reset & Close
    state.dom.modals.newTag.classList.add("wf-card-form--hidden");
    reloadData();
    renderManageTagsList(); // Refresh list if open
  } catch (e) {
    handleActionError("saveNewTag", e);
  }
}

// --- Drag Drop ---
function setupDragDrop() {
  const r = state.dom.board;
  r.addEventListener("dragstart", e => { const c=e.target.closest(".wf-card"); if(c){ state.dragState.cardId=c.dataset.cardId; e.dataTransfer.effectAllowed="move"; c.style.opacity="0.5"; }});
  r.addEventListener("dragend", e => { if(e.target)e.target.style.opacity="1"; state.dragState.cardId=null; document.querySelectorAll(".wf-drop-target").forEach(e=>e.classList.remove("wf-drop-target")); });
  r.addEventListener("dragover", e => { e.preventDefault(); const l=e.target.closest(".wf-column-cards"); if(l) l.classList.add("wf-drop-target"); });
  r.addEventListener("dragleave", e => { const l=e.target.closest(".wf-column-cards"); if(l) l.classList.remove("wf-drop-target"); });
  r.addEventListener("drop", async e => {
    e.preventDefault(); const l=e.target.closest(".wf-column-cards"); if(!l||!state.dragState.cardId)return;
    l.classList.remove("wf-drop-target"); const newCol=l.dataset.columnId;
    const c = state.cardsById.get(state.dragState.cardId); if(c.columnId===newCol)return;
    try { await updateDoc(doc(db,COLLECTIONS.CARDS,c.id),{columnId:newCol, updatedAt:serverTimestamp()}); reloadData(); } catch(e){ handleActionError("move",e); reloadData(); }
  });
}

function renderFilterPopover() {
  const grid = state.dom.filterTagsGrid; grid.innerHTML = "";
  state.tags.filter(t => t.active !== false).forEach(tag => {
    const pill = createEl("span", "wf-tag-chip wf-filter-tag", tag.name); pill.style.backgroundColor = tag.color;
    if (state.filter.tags.has(tag.id)) pill.classList.add("selected");
    pill.addEventListener("click", () => {
      if (state.filter.tags.has(tag.id)) state.filter.tags.delete(tag.id); else state.filter.tags.add(tag.id);
      renderFilterPopover(); renderBoard();
      const btn = qs(".wf-btn-filter"); if (state.filter.tags.size > 0) btn.classList.add("active"); else btn.classList.remove("active");
    });
    grid.appendChild(pill);
  });
}

function bindUI() {
  state.dom.board = $("workflow-board");
  const content = qs(".page-workflow .content");
  const board = $("workflow-board");

  const tb = createEl("section", "wf-toolbar");
  tb.innerHTML = `
    <button class="wf-btn wf-btn-primary btn-new-card">+ Nieuwe kaart</button>
    <div class="wf-search-wrapper"><span class="wf-search-icon">🔍</span><input type="text" class="wf-search-input" placeholder="Zoeken..."></div>
    <div style="position:relative;"><button class="wf-btn wf-btn-secondary wf-btn-filter" title="Filter">Filter</button><div class="wf-filter-popover"><div class="wf-filter-section-title">Filter op tags</div><div class="wf-filter-tags-grid"></div></div></div>
    <div style="margin-left:auto; display:flex; gap:0.5rem; position:relative;"><button class="wf-btn wf-btn-secondary btn-manage-tags">🏷️ Tags</button><button class="wf-btn wf-btn-secondary btn-help">❓</button><div class="wf-help-popover"><h4>Hoe werkt het bord?</h4><ul><li><strong>Kolommen:</strong> De status van je taak. Sleep kaarten van links naar rechts.</li><li><strong>Kaarten:</strong> Klik op een kaart om details te bewerken of te verwijderen.</li><li><strong>Tags:</strong> Gebruik tags voor prioriteit (Critical/High) of categorieën.</li><li><strong>Filters:</strong> Gebruik het zoekveld of de filterknop om specifieke taken te vinden.</li><li><strong>Sortering:</strong> Taken met de hoogste prioriteit en dichtste deadline staan automatisch bovenaan.</li></ul></div></div>
  `;
  content.insertBefore(tb, board);

  const cm = createEl("section", "wf-card-form wf-card-form--hidden");
  cm.innerHTML = `
    <form class="wf-card-form-inner" onsubmit="return false;">
      <div class="wf-tab-nav">
        <button type="button" class="wf-tab-btn active" data-tab="details">Details</button>
        <button type="button" class="wf-tab-btn" data-tab="timeline">Tijdlijn & Links</button>
      </div>
      <div id="tab-content-details" class="wf-tab-content active">
        <div class="wf-form-group"><label>Titel</label><input type="text" name="title" required placeholder="Taak naam..."></div>
        <div class="wf-form-group"><label>Deadline</label><input type="date" name="deadline"></div>
        <div class="wf-form-group"><label>Omschrijving</label><textarea name="description" rows="3"></textarea></div>
        <div class="wf-form-group wf-form-group-tags">
          <div class="wf-form-tags-header"><span>Tags</span><button type="button" class="wf-btn wf-btn-small wf-btn-secondary btn-toggle-tags-panel">Wijzigen</button></div>
          <div class="wf-form-tags-chips"></div>
          <div class="wf-form-tags-panel wf-form-tags-panel--hidden"><div class="wf-form-tags-list"></div></div>
        </div>
        <div class="wf-card-form-actions">
          <button type="button" class="wf-btn wf-btn-danger btn-delete-card">Verwijderen</button>
          <div class="wf-card-form-actions-right">
            <button type="button" class="wf-btn wf-btn-secondary btn-cancel-card">Annuleren</button>
            <button type="submit" class="wf-btn wf-btn-primary">Opslaan</button>
          </div>
        </div>
      </div>
      <div id="tab-content-timeline" class="wf-tab-content">
        <div id="timeline-new-card-overlay" style="display:none; text-align:center; padding:2rem; opacity:0.7;"><p>Sla de kaart eerst op.</p></div>
        <div class="wf-log-wrapper">
          <h4 style="font-size:0.9rem; margin-bottom:0.5rem;">Logs</h4>
          <div class="wf-log-input-group"><input type="text" id="input-log-entry" placeholder="Typ notitie..." autocomplete="off"><button type="button" class="wf-btn wf-btn-primary wf-btn-small" id="btn-add-log">Toevoegen</button></div>
          <div class="wf-log-list"></div>
        </div>
        <div class="wf-links-wrapper">
          <h4 style="font-size:0.9rem; margin-bottom:0.5rem;">Links</h4>
          <div class="wf-link-input-group"><input type="text" id="input-link-name" placeholder="Naam"><input type="text" id="input-link-url" placeholder="URL"><button type="button" class="wf-btn wf-btn-primary wf-btn-small" id="btn-add-link">Toevoegen</button></div>
          <div class="wf-link-list"></div>
        </div>
        <div class="wf-card-form-actions"><button type="button" class="wf-btn wf-btn-secondary btn-cancel-card" style="margin-left:auto;">Sluiten</button></div>
      </div>
    </form>
  `;
  content.appendChild(cm);

  const tm = createEl("section", "wf-card-form wf-card-form--hidden"); tm.id = "modal-tags";
  tm.innerHTML = `<div class="wf-card-form-inner"><h2>Tags Beheren</h2><div class="wf-tags-list-board"></div><div class="wf-card-form-actions"><button class="wf-btn wf-btn-primary btn-new-tag">Nieuwe Tag</button><button class="wf-btn wf-btn-secondary btn-close-tags">Sluiten</button></div></div>`;
  content.appendChild(tm);
  
  // NEW: Create Tag Modal (Color Picker)
  const ntm = createEl("section", "wf-card-form wf-card-form--hidden"); ntm.id = "modal-new-tag";
  ntm.innerHTML = `
    <div class="wf-card-form-inner" style="max-width:350px;">
      <h3>Nieuwe Tag</h3>
      <div class="wf-form-group">
        <label>Naam</label>
        <input type="text" id="new-tag-name" placeholder="Naam van tag..." autocomplete="off">
      </div>
      <div class="wf-form-group">
        <label>Kleur</label>
        <div id="new-tag-colors" style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.2rem;"></div>
      </div>
      <div class="wf-card-form-actions">
        <button class="wf-btn wf-btn-secondary btn-cancel-new-tag">Annuleren</button>
        <button class="wf-btn wf-btn-primary btn-save-new-tag">Opslaan</button>
      </div>
    </div>
  `;
  content.appendChild(ntm);

  const um = createEl("section", "wf-card-form wf-card-form--hidden"); um.id = "modal-urgent";
  um.innerHTML = `
    <div class="wf-card-form-inner" style="max-width:450px;">
      <h2 style="color:#ef4444;">⚠️ Aandacht vereist</h2>
      <p style="font-size:0.9rem;">De volgende taken zijn vervallen of vervallen bijna:</p>
      <div id="urgent-popup-list" class="wf-urgent-list"></div>
      <div style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; margin-top:0.5rem;"><input type="checkbox" id="urgent-popup-check"> <label for="urgent-popup-check">Niet meer tonen vandaag</label></div>
      <div class="wf-card-form-actions"><button class="wf-btn wf-btn-primary btn-close-urgent" style="width:100%">Begrepen</button></div>
    </div>
  `;
  content.appendChild(um);

  state.dom.inputs = { title: qs("input[name='title']"), deadline: qs("input[name='deadline']"), desc: qs("textarea[name='description']") };
  state.dom.modals = { card: cm, tags: tm, newTag: ntm };
  state.dom.formTags = { chipsContainer: qs(".wf-form-tags-chips", cm), panel: qs(".wf-form-tags-panel", cm), tagsListContainer: qs(".wf-form-tags-list", cm) };
  state.dom.manageTagsList = qs(".wf-tags-list-board", tm);
  state.dom.btnDelete = qs(".btn-delete-card", cm);
  state.dom.filterTagsGrid = qs(".wf-filter-tags-grid", tb);

  qs(".btn-new-card").addEventListener("click", () => openCardForm());
  qs(".btn-manage-tags").addEventListener("click", () => { state.dom.modals.tags.classList.remove("wf-card-form--hidden"); renderManageTagsList(); });
  qs(".wf-card-form form").addEventListener("submit", saveCard);
  document.querySelectorAll(".btn-cancel-card").forEach(b => b.addEventListener("click", () => state.dom.modals.card.classList.add("wf-card-form--hidden")));
  state.dom.btnDelete.addEventListener("click", deleteCard);
  qs(".btn-toggle-tags-panel").addEventListener("click", () => state.dom.formTags.panel.classList.toggle("wf-form-tags-panel--hidden"));
  qs(".btn-close-tags").addEventListener("click", () => state.dom.modals.tags.classList.add("wf-card-form--hidden"));
  
  // New Tag Listeners
  qs(".btn-new-tag").addEventListener("click", createNewTag);
  qs(".btn-cancel-new-tag").addEventListener("click", () => state.dom.modals.newTag.classList.add("wf-card-form--hidden"));
  qs(".btn-save-new-tag").addEventListener("click", saveNewTag);

  qs(".btn-close-urgent").addEventListener("click", closeUrgentPopup);
  state.dom.board.addEventListener("click", e => { const c = e.target.closest(".wf-card"); if (c) openCardForm(c.dataset.cardId); });
  
  qs("[data-tab='details']").addEventListener("click", () => switchModalTab('details'));
  qs("[data-tab='timeline']").addEventListener("click", () => switchModalTab('timeline'));
  qs("#btn-add-log").addEventListener("click", addLogEntry);
  qs("#input-log-entry").addEventListener("keypress", e => { if(e.key==='Enter'){e.preventDefault(); addLogEntry();} });
  qs("#btn-add-link").addEventListener("click", addLinkEntry);

  qs(".wf-search-input").addEventListener("input", e => { state.filter.keyword = e.target.value; renderBoard(); });
  const fBtn = qs(".wf-btn-filter"), fPop = qs(".wf-filter-popover"), hBtn = qs(".btn-help"), hPop = qs(".wf-help-popover");
  fBtn.addEventListener("click", e => { e.stopPropagation(); hPop.classList.remove("visible"); fPop.classList.toggle("visible"); renderFilterPopover(); });
  hBtn.addEventListener("click", e => { e.stopPropagation(); fPop.classList.remove("visible"); hPop.classList.toggle("visible"); });
  document.addEventListener("click", e => {
    if(!fPop.contains(e.target) && e.target!==fBtn) fPop.classList.remove("visible");
    if(!hPop.contains(e.target) && e.target!==hBtn) hPop.classList.remove("visible");
  });

  setupDragDrop();
}

// --- Bootstrap (AANGEPAST) ---
document.addEventListener("DOMContentLoaded", () => {
  bindUI();
  
  document.addEventListener("app:auth_changed", (e) => {
    const user = e.detail.user;
    if (user) { 
      state.uid = user.uid; 
      getOrCreateBoard(user.uid).then(b => { state.boardId = b.id; reloadData(); }); 
    } else {
      setBoardMessage("Log in a.u.b.");
    }
  });

  if (window.App && window.App.currentUser) {
      const user = window.App.currentUser;
      state.uid = user.uid;
      getOrCreateBoard(user.uid).then(b => { state.boardId = b.id; reloadData(); });
  }
});