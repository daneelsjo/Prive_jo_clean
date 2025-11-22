// Script/Javascript/workflow.js
// V0.4 Refactor - Uses Global Core (main.js)

import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc,
  serverTimestamp, query, where, getDocs
} from "./firebase-config.js";

// Haal DB op uit de global scope (gezet door main.js) of fallback
const db = window.App?.db || getFirestore();

// --- Constants ---
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

const PRIORITY_VALS = { "priority-critical": 4, "priority-high": 3, "priority-normal": 2, "priority-low": 1 }

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
  dom: {} 
}

// --- DOM Helpers ---
const $ = (id) => document.getElementById(id);
const qs = (sel, parent = document) => parent.querySelector(sel);
const createEl = (tag, className, text = "") => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function showToast(message) {
  let toast = qs(".wf-toast");
  if (!toast) { toast = createEl("div", "wf-toast"); document.body.appendChild(toast); }
  toast.textContent = message; toast.classList.add("visible");
  setTimeout(() => { toast.classList.remove("visible"); }, 3500);
}

function handleActionError(action, error) {
  console.error(`[Workflow Error] ${action}:`, error);
  showToast("Er is een fout opgetreden.");
}

// --- Date Helpers ---
const formatDateForInput = (ts) => {
    if (!ts) return "";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return isNaN(date) ? "" : date.toISOString().split('T')[0];
}
const parseDateFromInput = (val) => val ? new Date(val) : null;

function getUrgency(dueDate) {
  if (!dueDate) return { isUrgent: false, isOverdue: false, diffDays: 999 };
  const d = dueDate.toDate ? dueDate.toDate() : new Date(dueDate);
  const now = new Date();
  d.setHours(23,59,59,999); now.setHours(0,0,0,0);
  const diffDays = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
  return { isOverdue: diffDays < 0, isUrgent: diffDays >= 0 && diffDays <= 7, diffDays, dateObj: d };
}

// --- Sorting Logic ---
function getCardPriorityValue(card) {
  if (!card.tags || !card.tags.length) return 0;
  let maxPrio = 0;
  card.tags.forEach(tagId => {
    const tag = state.tagsById.get(tagId);
    if (tag?.builtinKey) {
      let val = PRIORITY_VALS[tag.builtinKey] || 0;
      if (val > maxPrio) maxPrio = val;
    }
  });
  return maxPrio;
}

function sortCardsLogic(a, b) {
  const prioA = getCardPriorityValue(a); const prioB = getCardPriorityValue(b);
  if (prioA !== prioB) return prioB - prioA;
  const dateA = a.dueDate ? (a.dueDate.toDate ? a.dueDate.toDate() : new Date(a.dueDate)).getTime() : 0;
  const dateB = b.dueDate ? (b.dueDate.toDate ? b.dueDate.toDate() : new Date(b.dueDate)).getTime() : 0;
  if (dateA && dateB && dateA !== dateB) return dateA - dateB;
  if (dateA && !dateB) return -1;
  if (!dateA && dateB) return 1;
  return (a.title || "").localeCompare(b.title || "");
}

// --- Data Operations ---
async function getOrCreateBoard(uid) {
  const q = query(collection(db, COLLECTIONS.BOARDS), where("uid", "==", uid));
  const snap = await getDocs(q);
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  const ref = await addDoc(collection(db, COLLECTIONS.BOARDS), { uid, name: "Mijn Workflow", isDefault: true, createdAt: serverTimestamp() });
  return { id: ref.id, uid };
}

async function fetchColumns(boardId, uid) {
  const colRef = collection(db, COLLECTIONS.COLUMNS);
  const q = query(colRef, where("boardId", "==", boardId));
  let snap = await getDocs(q);
  if (snap.empty) {
    await Promise.all(DEFAULT_COLUMNS.map(def => addDoc(colRef, { boardId, uid, title: def.title, order: def.order, createdAt: serverTimestamp() })));
    snap = await getDocs(q);
  }
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.order||0) - (b.order||0));
}

async function fetchAndSyncTags(boardId, uid) {
  const tagsRef = collection(db, COLLECTIONS.TAGS);
  const q = query(tagsRef, where("boardId","==",boardId));
  const snap = await getDocs(q);
  let loadedTags = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  
  const existingNames = new Set(loadedTags.map(t => t.name));
  const missing = PRIORITY_TAGS.filter(p => !existingNames.has(p.name));
  
  if(missing.length > 0) {
    const newTags = await Promise.all(missing.map(p => addDoc(tagsRef, { 
      boardId, uid, name: p.name, color: p.color, active: true, builtin: true, builtinKey: p.key, createdAt: serverTimestamp() 
    }).then(ref => ({ id: ref.id, ...p, active: true, builtin: true }))));
    loadedTags = [...loadedTags, ...newTags];
  }
  return loadedTags.sort((a,b) => a.name.localeCompare(b.name));
}

// --- Actions (Load, Save, Delete) ---
async function reloadData() {
  if (!state.uid || !state.boardId) return;
  try {
    const [cols, cardsSnap, tags] = await Promise.all([
      fetchColumns(state.boardId, state.uid),
      getDocs(query(collection(db, COLLECTIONS.CARDS), where("boardId","==",state.boardId))),
      fetchAndSyncTags(state.boardId, state.uid)
    ]);
    
    state.columns = cols;
    state.columnsById = new Map(cols.map(c=>[c.id,c]));
    state.tags = tags;
    state.tagsById = new Map(tags.map(t=>[t.id,t]));
    state.cardsById = new Map(cardsSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    
    const backlog = cols.find(c => c.title === "Backlog") || cols[0];
    state.backlogColumnId = backlog ? backlog.id : null;
    
    renderBoard();
    checkUrgencyAndShowPopup();
  } catch (err) { handleActionError("reloadData", err); }
}

async function saveCard(e) {
  e.preventDefault();
  const title = state.dom.inputs.title.value.trim();
  if(!title) return showToast("Titel verplicht");
  
  const btn = qs("button[type='submit']", state.dom.modals.card);
  btn.textContent = "Bezig..."; btn.disabled = true;

  const data = {
    title, description: state.dom.inputs.desc.value.trim(),
    dueDate: parseDateFromInput(state.dom.inputs.deadline.value),
    tags: Array.from(state.form.workingTags), updatedAt: serverTimestamp()
  };

  try {
    if (state.form.mode === "edit") {
      await updateDoc(doc(db, COLLECTIONS.CARDS, state.form.cardId), data);
    } else {
      Object.assign(data, { boardId: state.boardId, uid: state.uid, columnId: state.backlogColumnId, createdAt: serverTimestamp(), logs:[], links:[] });
      await addDoc(collection(db, COLLECTIONS.CARDS), data);
    }
    state.dom.modals.card.classList.add("wf-card-form--hidden");
    reloadData();
  } catch(err) { handleActionError("saveCard", err); }
  finally { btn.textContent = "Opslaan"; btn.disabled = false; }
}

async function deleteCard() {
  if(!confirm("Kaart definitief verwijderen?")) return;
  try {
    await deleteDoc(doc(db, COLLECTIONS.CARDS, state.form.cardId));
    state.dom.modals.card.classList.add("wf-card-form--hidden");
    reloadData();
  } catch(e) { handleActionError("deleteCard", e); }
}

// --- Rendering ---
function renderBoard() {
  const root = state.dom.board; root.innerHTML = "";
  if (!state.columns.length) { root.innerHTML = "<p style='padding:1rem'>Geen kolommen.</p>"; return; }

  // 1. Prepare numbering
  state.allCardsSorted = Array.from(state.cardsById.values()).sort((a,b) => {
     const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
     const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
     return tA - tB;
  });
  state.allCardsSorted.forEach((c, i) => c.visualId = i + 1);

  // 2. Filter & Sort
  const kw = state.filter.keyword.toLowerCase().trim();
  const filtered = state.allCardsSorted.filter(c => {
    const matchText = !kw || (c.title||"").toLowerCase().includes(kw) || String(c.visualId).includes(kw);
    const matchTags = state.filter.tags.size === 0 || (c.tags||[]).some(id => state.filter.tags.has(id));
    return matchText && matchTags;
  }).sort(sortCardsLogic);

  // 3. Render Columns
  const byCol = {}; state.columns.forEach(c => byCol[c.id] = []);
  filtered.forEach(c => { if(byCol[c.columnId]) byCol[c.columnId].push(c); });

  state.columns.forEach(col => {
    const colEl = createEl("div", "wf-column");
    
    const header = createEl("header", "wf-column-header");
    header.appendChild(createEl("h2", "wf-column-title", col.title));
    const count = byCol[col.id].length;
    const total = Array.from(state.cardsById.values()).filter(c => c.columnId === col.id).length;
    header.appendChild(createEl("span", "wf-column-count", count !== total ? `${count} / ${total}` : count));
    colEl.appendChild(header);

    const listEl = createEl("div", "wf-column-cards"); listEl.dataset.columnId = col.id;
    byCol[col.id].forEach(c => listEl.appendChild(createCardElement(c)));
    colEl.appendChild(listEl);
    root.appendChild(colEl);
  });
}

function createCardElement(card) {
  const el = createEl("article", "wf-card"); el.dataset.cardId = card.id; el.draggable = true;

  const header = createEl("div", "wf-card-header");
  const titleGroup = createEl("div", "wf-card-title-group");
  titleGroup.innerHTML = `<span class="wf-card-id">#${card.visualId}</span> ${card.title}`;
  header.appendChild(titleGroup);

  if (card.dueDate) {
    const u = getUrgency(card.dueDate);
    const dateEl = createEl("div", "wf-card-date", u.dateObj.toLocaleDateString('nl-NL',{day:'numeric',month:'short'}));
    if(u.isUrgent || u.isOverdue) { dateEl.classList.add("urgent"); dateEl.title = u.isOverdue ? "Vervallen" : "Bijna vervallen"; }
    header.appendChild(dateEl);
  }
  el.appendChild(header);

  if (card.tags?.length) {
    const chips = createEl("div", "wf-card-tags-chips");
    card.tags.forEach(tid => {
      const t = state.tagsById.get(tid);
      if(t && t.active!==false) {
        const c = createEl("span", "wf-tag-chip", t.name); c.style.backgroundColor=t.color; chips.appendChild(c);
      }
    });
    if(chips.children.length) el.appendChild(chips);
  }
  return el;
}

// --- Interaction / Modals ---
function openCardForm(cardId = null) {
  state.form.mode = cardId ? "edit" : "create";
  state.form.cardId = cardId;
  state.form.workingTags = new Set();
  
  const { title, desc, deadline } = state.dom.inputs;
  
  if (cardId) {
    const c = state.cardsById.get(cardId);
    title.value = c.title; desc.value = c.description || "";
    deadline.value = formatDateForInput(c.dueDate);
    c.tags?.forEach(t => state.form.workingTags.add(t));
    state.dom.btnDelete.style.display = "block";
  } else {
    title.value = ""; desc.value = ""; deadline.value = "";
    state.dom.btnDelete.style.display = "none";
  }
  
  renderFormTags();
  state.dom.modals.card.classList.remove("wf-card-form--hidden");
  title.focus();
}

function renderFormTags() {
  const { chips, list } = state.dom.formTags;
  chips.innerHTML = ""; list.innerHTML = "";
  
  // Selected chips
  if (state.form.workingTags.size === 0) chips.innerHTML = "<small style='opacity:0.5'>Geen tags</small>";
  state.form.workingTags.forEach(tid => {
    const t = state.tagsById.get(tid); if(!t) return;
    const s = createEl("span", "wf-tag-chip", t.name); s.style.backgroundColor=t.color; chips.appendChild(s);
  });

  // Selection list
  state.tags.filter(t => t.active!==false).forEach(t => {
    const sel = state.form.workingTags.has(t.id);
    const btn = createEl("div", `wf-tag-pill ${sel ? 'selected' : ''}`, t.name);
    btn.style.backgroundColor = t.color;
    btn.onclick = () => {
      sel ? state.form.workingTags.delete(t.id) : state.form.workingTags.add(t.id);
      renderFormTags();
    };
    list.appendChild(btn);
  });
}

// --- Drag & Drop ---
function setupDragDrop() {
  const b = state.dom.board;
  b.addEventListener("dragstart", e => { 
    const c = e.target.closest(".wf-card"); 
    if(c){ state.dragState.cardId = c.dataset.cardId; c.style.opacity = "0.5"; }
  });
  b.addEventListener("dragend", e => { 
    if(e.target) e.target.style.opacity = "1";
    document.querySelectorAll(".wf-drop-target").forEach(el => el.classList.remove("wf-drop-target"));
  });
  b.addEventListener("dragover", e => {
    e.preventDefault();
    const col = e.target.closest(".wf-column-cards");
    if(col) col.classList.add("wf-drop-target");
  });
  b.addEventListener("dragleave", e => {
    const col = e.target.closest(".wf-column-cards");
    if(col) col.classList.remove("wf-drop-target");
  });
  b.addEventListener("drop", async e => {
    e.preventDefault();
    const col = e.target.closest(".wf-column-cards");
    if(!col || !state.dragState.cardId) return;
    col.classList.remove("wf-drop-target");
    
    const newColId = col.dataset.columnId;
    const card = state.cardsById.get(state.dragState.cardId);
    if(card && card.columnId !== newColId) {
       try { await updateDoc(doc(db, COLLECTIONS.CARDS, card.id), { columnId: newColId }); reloadData(); }
       catch(err) { handleActionError("move", err); reloadData(); }
    }
  });
}

// --- Popups ---
function checkUrgencyAndShowPopup() {
  const dismissed = localStorage.getItem("wf_popup_" + new Date().toDateString());
  if (dismissed) return;

  const items = state.allCardsSorted.filter(c => {
    const u = getUrgency(c.dueDate);
    return (u.isOverdue || u.isUrgent) && state.columnsById.get(c.columnId)?.title !== "Afgewerkt";
  });

  if (items.length > 0) {
    const list = qs("#urgent-popup-list"); list.innerHTML = "";
    items.forEach(c => {
      const u = getUrgency(c.dueDate);
      const row = createEl("div", `wf-urgent-item ${u.isOverdue?'overdue':'near'}`);
      row.innerHTML = `<span>#${c.visualId} ${c.title}</span> <small>${u.dateObj.toLocaleDateString()}</small>`;
      list.appendChild(row);
    });
    qs("#modal-urgent").classList.remove("wf-card-form--hidden");
  }
}

// --- Init ---
function initWorkflowPage(user) {
  state.uid = user.uid;
  console.log("🚀 Workflow Init voor:", user.email);

  // Cache DOM
  state.dom.board = $("workflow-board");
  state.dom.modals = { card: qs(".wf-card-form"), tags: qs("#modal-tags") };
  state.dom.inputs = { 
    title: qs("input[name='title']"), 
    deadline: qs("input[name='deadline']"), 
    desc: qs("textarea[name='description']") 
  };
  state.dom.formTags = { 
    chips: qs(".wf-form-tags-chips"), 
    list: qs(".wf-form-tags-list"), 
    panel: qs(".wf-form-tags-panel") 
  };
  state.dom.btnDelete = qs(".btn-delete-card");

  // Load Data
  getOrCreateBoard(user.uid).then(b => {
    state.boardId = b.id;
    reloadData();
  });

  // Bind Events
  qs(".btn-new-card").addEventListener("click", () => openCardForm());
  qs("form").addEventListener("submit", saveCard);
  qs(".btn-cancel-card").addEventListener("click", () => state.dom.modals.card.classList.add("wf-card-form--hidden"));
  state.dom.btnDelete.addEventListener("click", deleteCard);
  qs(".btn-toggle-tags-panel").addEventListener("click", () => state.dom.formTags.panel.classList.toggle("wf-form-tags-panel--hidden"));
  
  state.dom.board.addEventListener("click", e => {
     const c = e.target.closest(".wf-card");
     if(c) openCardForm(c.dataset.cardId);
  });
  
  qs(".wf-search-input").addEventListener("input", e => { 
      state.filter.keyword = e.target.value; renderBoard(); 
  });
  
  qs(".btn-close-urgent").addEventListener("click", () => {
    if(qs("#urgent-popup-check").checked) localStorage.setItem("wf_popup_" + new Date().toDateString(), "true");
    qs("#modal-urgent").classList.add("wf-card-form--hidden");
  });

  setupDragDrop();
}

// --- Bootstrap ---
// Wacht op signaal vanuit main.js
document.addEventListener("app:auth_changed", (e) => {
  if (e.detail.user) initWorkflowPage(e.detail.user);
});
// Fallback
if (window.App?.currentUser) initWorkflowPage(window.App.currentUser);