// workflow.js
// Workflow board V0.3-11: Logs & Documents (Tabs)
// Features: Tabbed Modal, Card Logs (Timeline), Document Links, Error Handling, Drag & Drop

import {
  getFirebaseApp,
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  getAuth,
  onAuthStateChanged
} from "./firebase-config.js"

// --- MOCK LOGGING ---
function logEntry(data) {
  // console.log("[SYSTEM LOG]", data); 
}

// --- Config & Constanten ---
const app = getFirebaseApp()
const db = getFirestore(app)
const auth = getAuth(app)

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

const PRIORITY_VALS = {
  "priority-critical": 4,
  "priority-high": 3,
  "priority-normal": 2,
  "priority-low": 1
}

// --- State Management ---
const state = {
  uid: null,
  boardId: null,
  columns: [], 
  columnsById: new Map(),
  cardsById: new Map(),
  tags: [], 
  tagsById: new Map(),
  backlogColumnId: null,

  filter: {
    keyword: "",
    tags: new Set()
  },

  dragState: {
    cardId: null
  },

  form: {
    mode: "create",
    cardId: null,
    workingTags: new Set(),
    activeTab: "details" // 'details' | 'timeline'
  },

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

// --- Error & Notification Handler ---
function showToast(message) {
  let toast = qs(".wf-toast");
  if (!toast) {
    toast = createEl("div", "wf-toast");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  setTimeout(() => { toast.classList.remove("visible"); }, 3500);
}

function handleActionError(action, error, context = {}, userMessage = "Er is een fout opgetreden.") {
  logEntry({
    level: "error", page: "workflow", action, message: error.message,
    boardId: state.boardId, uid: state.uid, ...context
  });
  console.error(`[Workflow Error] ${action}:`, error);
  showToast(userMessage);
}

// --- Date & Sort Helpers ---
const formatDateForInput = (timestamp) => {
  if (!timestamp) return ""
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp)
  if (isNaN(date)) return ""
  return date.toISOString().split('T')[0]
}

const parseDateFromInput = (val) => {
  if (!val) return null
  return new Date(val)
}

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
  const prioA = getCardPriorityValue(a);
  const prioB = getCardPriorityValue(b);
  if (prioA !== prioB) return prioB - prioA;

  const dateA = a.dueDate ? (a.dueDate.toDate ? a.dueDate.toDate() : new Date(a.dueDate)) : null;
  const dateB = b.dueDate ? (b.dueDate.toDate ? b.dueDate.toDate() : new Date(b.dueDate)) : null;

  if (dateA && dateB) {
    if (dateA.getTime() !== dateB.getTime()) return dateA.getTime() - dateB.getTime();
  } else if (dateA && !dateB) return -1; 
  else if (!dateA && dateB) return 1; 

  const titleA = (a.title || "").toLowerCase();
  const titleB = (b.title || "").toLowerCase();
  return titleA.localeCompare(titleB);
}

// --- Firestore Operations ---
async function getOrCreateBoard(uid) {
  try {
    const boardsRef = collection(db, COLLECTIONS.BOARDS)
    const q = query(boardsRef, where("uid", "==", uid))
    const snap = await getDocs(q)
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() }

    const newBoard = { uid, name: "Mijn Workflow", isDefault: true, createdAt: serverTimestamp() }
    const ref = await addDoc(boardsRef, newBoard)
    return { id: ref.id, ...newBoard }
  } catch (err) {
    handleActionError("getOrCreateBoard", err, {}, "Kon bord niet laden.");
    throw err;
  }
}

async function fetchColumns(boardId, uid) {
  const colRef = collection(db, COLLECTIONS.COLUMNS)
  const q = query(colRef, where("boardId", "==", boardId), where("uid", "==", uid))
  let snap = await getDocs(q)
  if (snap.empty) {
    const batchPromises = DEFAULT_COLUMNS.map(def => 
      addDoc(colRef, { boardId, uid, title: def.title, order: def.order, createdAt: serverTimestamp() })
    )
    await Promise.all(batchPromises)
    snap = await getDocs(q)
  }
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0))
}

async function fetchCards(boardId, uid) {
  const cardsRef = collection(db, COLLECTIONS.CARDS)
  const q = query(cardsRef, where("boardId", "==", boardId), where("uid", "==", uid))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

async function fetchAndSyncTags(boardId, uid) {
  const tagsRef = collection(db, COLLECTIONS.TAGS)
  const q = query(tagsRef, where("boardId", "==", boardId), where("uid", "==", uid))
  const snap = await getDocs(q)
  let loadedTags = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  const existingNames = new Set(loadedTags.map(t => t.name))
  const missing = PRIORITY_TAGS.filter(p => !existingNames.has(p.name))
  
  if (missing.length > 0) {
    const newTagsPromises = missing.map(p => 
      addDoc(tagsRef, {
        boardId, uid, name: p.name, color: p.color, active: true, builtin: true, builtinKey: p.key, createdAt: serverTimestamp()
      }).then(ref => ({ id: ref.id, boardId, uid, name: p.name, color: p.color, active: true, builtin: true, builtinKey: p.key }))
    )
    const newTags = await Promise.all(newTagsPromises)
    loadedTags = [...loadedTags, ...newTags]
  }
  return loadedTags.sort((a, b) => a.name.localeCompare(b.name))
}

// --- Render Logic ---
function renderBoard() {
  const root = state.dom.board
  root.innerHTML = ""
  if (!state.columns.length) { setBoardMessage("Geen kolommen."); return; }

  const keyword = state.filter.keyword.toLowerCase().trim()
  const filterTags = state.filter.tags

  const filteredCards = Array.from(state.cardsById.values()).filter(card => {
    const matchText = !keyword || (card.title && card.title.toLowerCase().includes(keyword));
    let matchTags = true;
    if (filterTags.size > 0) {
      if (!card.tags || !card.tags.length) matchTags = false;
      else matchTags = card.tags.some(tagId => filterTags.has(tagId));
    }
    return matchText && matchTags;
  });

  filteredCards.sort(sortCardsLogic);

  const cardsByCol = {}
  state.columns.forEach(c => cardsByCol[c.id] = [])
  filteredCards.forEach(card => {
    if (cardsByCol[card.columnId]) cardsByCol[card.columnId].push(card);
  })

  state.columns.forEach(col => {
    const colEl = createEl("div", "wf-column")
    const header = createEl("header", "wf-column-header")
    header.appendChild(createEl("h2", "wf-column-title", col.title))
    
    const count = cardsByCol[col.id].length
    const totalInCol = Array.from(state.cardsById.values()).filter(c => c.columnId === col.id).length
    let countText = count.toString();
    if (count !== totalInCol) countText = `${count} / ${totalInCol}`;
    
    header.appendChild(createEl("span", "wf-column-count", countText))
    colEl.appendChild(header)

    const listEl = createEl("div", "wf-column-cards")
    listEl.dataset.columnId = col.id
    
    cardsByCol[col.id].forEach(card => listEl.appendChild(createCardElement(card)))
    colEl.appendChild(listEl)
    root.appendChild(colEl)
  })
}

function createCardElement(card) {
  const el = createEl("article", "wf-card")
  el.dataset.cardId = card.id
  el.draggable = true
  
  const title = createEl("div", "wf-card-title", card.title)
  el.appendChild(title)

  if (card.dueDate) {
    const d = typeof card.dueDate.toDate === 'function' ? card.dueDate.toDate() : new Date(card.dueDate);
    const dateSpan = createEl("div", "", "📅 " + d.toLocaleDateString('nl-NL', {day:'numeric', month:'short'}));
    dateSpan.style.fontSize = "0.75rem"; dateSpan.style.opacity = "0.7"; dateSpan.style.marginTop = "0.25rem";
    el.appendChild(dateSpan);
  }

  if (card.tags && card.tags.length > 0) {
    const chipsContainer = createEl("div", "wf-card-tags-chips")
    card.tags.forEach(tagId => {
      const tag = state.tagsById.get(tagId)
      if (tag && tag.active !== false) { 
        const chip = createEl("span", "wf-tag-chip")
        const colorDot = createEl("span", "wf-tag-chip-color")
        colorDot.style.backgroundColor = tag.color
        chip.appendChild(colorDot)
        chip.appendChild(document.createTextNode(tag.name))
        chipsContainer.appendChild(chip)
      }
    })
    if (chipsContainer.children.length > 0) el.appendChild(chipsContainer);
  }
  return el
}

// --- Modal UI & Tabs ---
function switchModalTab(tabName) {
  state.form.activeTab = tabName;
  
  // Knoppen
  qs("[data-tab='details']").classList.toggle("active", tabName === 'details');
  qs("[data-tab='timeline']").classList.toggle("active", tabName === 'timeline');

  // Content
  qs("#tab-content-details").classList.toggle("active", tabName === 'details');
  qs("#tab-content-timeline").classList.toggle("active", tabName === 'timeline');
}

function renderFormTagSelector() {
    const { chipsContainer, tagsListContainer } = state.dom.formTags
    chipsContainer.innerHTML = ""
    if (state.form.workingTags.size === 0) {
      const ph = createEl("span", "", "Geen tags")
      ph.style.opacity = "0.6"; ph.style.fontSize = "0.8rem"
      chipsContainer.appendChild(ph)
    } else {
      state.form.workingTags.forEach(tagId => {
        const tag = state.tagsById.get(tagId)
        if (!tag) return
        const chip = createEl("span", "wf-tag-chip")
        const dot = createEl("span", "wf-tag-chip-color")
        dot.style.backgroundColor = tag.color
        chip.appendChild(dot)
        chip.appendChild(document.createTextNode(tag.name))
        chipsContainer.appendChild(chip)
      })
    }
    tagsListContainer.innerHTML = ""
    const allTags = state.tags.filter(t => t.active !== false)
    const createTagRow = (tag) => {
        const label = createEl("label", "wf-card-tag-option")
        const input = createEl("input"); input.type = "checkbox"
        input.checked = state.form.workingTags.has(tag.id)
        const pill = createEl("span", "wf-tag-pill", tag.name)
        pill.style.backgroundColor = tag.color
        input.addEventListener("change", () => {
            if (input.checked) state.form.workingTags.add(tag.id)
            else state.form.workingTags.delete(tag.id)
            renderFormTagSelector()
        })
        label.appendChild(input); label.appendChild(pill)
        return label
    }
    const grid = createEl("div", "wf-tags-columns")
    allTags.forEach(tag => grid.appendChild(createTagRow(tag)))
    tagsListContainer.appendChild(grid)
}

// --- LOGS & LINKS RENDER ---
function renderCardLogs(card) {
  const list = qs(".wf-log-list");
  list.innerHTML = "";
  
  const logs = card.logs || [];
  if (logs.length === 0) {
    list.innerHTML = `<div style="opacity:0.6; font-size:0.85rem; text-align:center; padding:1rem;">Nog geen logs.</div>`;
    return;
  }

  logs.forEach(log => {
    const item = createEl("div", "wf-log-item");
    const dateStr = new Date(log.timestamp).toLocaleString('nl-NL', { 
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' 
    });
    
    item.innerHTML = `<span class="wf-log-date">${dateStr}</span><span class="wf-log-content">${log.content}</span>`;
    list.appendChild(item);
  });
}

function renderCardLinks(card) {
  const list = qs(".wf-link-list");
  list.innerHTML = "";

  const links = card.links || [];
  if (links.length === 0) {
    list.innerHTML = `<div style="opacity:0.6; font-size:0.85rem; text-align:center;">Geen documenten gekoppeld.</div>`;
    return;
  }

  links.forEach(link => {
    const item = createEl("div", "wf-link-item");
    
    // Veiligheid: check of url met http begint
    let safeUrl = link.url;
    if (!safeUrl.match(/^https?:\/\//i)) {
      safeUrl = "http://" + safeUrl;
    }

    item.innerHTML = `
      <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">🔗 ${link.name || link.url}</a>
      <button class="wf-btn-icon-small btn-remove-link" data-link-id="${link.id}">🗑️</button>
    `;
    
    item.querySelector(".btn-remove-link").addEventListener("click", () => deleteLinkEntry(link.id));
    list.appendChild(item);
  });
}

// --- Actions (Card) ---

async function reloadData() {
  if (!state.uid || !state.boardId) return
  try {
    const [cols, cards, tags] = await Promise.all([
      fetchColumns(state.boardId, state.uid),
      fetchCards(state.boardId, state.uid),
      fetchAndSyncTags(state.boardId, state.uid)
    ])

    state.columns = cols
    state.columnsById = new Map(cols.map(c => [c.id, c]))
    state.tags = tags
    state.tagsById = new Map(tags.map(t => [t.id, t]))
    state.cardsById = new Map(cards.map(c => [c.id, c]))
    
    const backlog = cols.find(c => c.title === "Backlog") || cols[0]
    state.backlogColumnId = backlog ? backlog.id : null

    // Als er een kaart open staat in 'edit' mode, ververs dan ook de logs/links in de modal
    if (state.form.mode === 'edit' && state.form.cardId) {
      const currentCard = state.cardsById.get(state.form.cardId);
      if (currentCard) {
        renderCardLogs(currentCard);
        renderCardLinks(currentCard);
      }
    }

    renderBoard();
  } catch (err) {
    handleActionError("reloadData", err, {}, "Fout bij laden van data.");
    setBoardMessage("Er ging iets mis bij het laden.", true);
  }
}

function openCardForm(cardId = null) {
  state.form.mode = cardId ? "edit" : "create"
  state.form.cardId = cardId
  state.form.workingTags = new Set()
  
  // Reset tabs naar default
  switchModalTab('details');

  const { title, desc, deadline } = state.dom.inputs
  
  // Tab Timeline disablen bij Create
  const timelineTabBtn = qs("[data-tab='timeline']");
  const timelineOverlay = qs("#timeline-new-card-overlay");
  
  if (cardId) {
    // EDIT MODE
    const card = state.cardsById.get(cardId)
    if (!card) return
    title.value = card.title
    desc.value = card.description || ""
    deadline.value = formatDateForInput(card.dueDate)
    if (card.tags) card.tags.forEach(t => state.form.workingTags.add(t))
    
    state.dom.btnDelete.style.display = "block"
    
    // Enable logs
    timelineTabBtn.style.display = "block";
    timelineOverlay.style.display = "none";
    renderCardLogs(card);
    renderCardLinks(card);

  } else {
    // CREATE MODE
    title.value = ""
    desc.value = ""
    deadline.value = ""
    state.dom.btnDelete.style.display = "none"
    
    // Disable logs
    timelineTabBtn.style.opacity = "0.5";
    timelineOverlay.style.display = "flex";
  }

  state.dom.formTags.panel.classList.add("wf-form-tags-panel--hidden")
  renderFormTagSelector()
  state.dom.modals.card.classList.remove("wf-card-form--hidden")
  title.focus()
}

async function saveCard(e) {
  e.preventDefault()
  if (!state.uid) return

  const title = state.dom.inputs.title.value.trim()
  if (!title) return alert("Titel verplicht")

  const btn = e.submitter || qs("button[type='submit']", state.dom.modals.card);
  const originalText = btn.textContent;
  btn.disabled = true; btn.textContent = "Bezig...";

  const data = {
    title,
    description: state.dom.inputs.desc.value.trim(),
    dueDate: parseDateFromInput(state.dom.inputs.deadline.value),
    tags: Array.from(state.form.workingTags),
    updatedAt: serverTimestamp()
  }

  try {
    if (state.form.mode === "edit") {
      await updateDoc(doc(db, COLLECTIONS.CARDS, state.form.cardId), data)
    } else {
      if (!state.backlogColumnId) throw new Error("Geen backlog kolom")
      data.boardId = state.boardId; data.uid = state.uid; data.columnId = state.backlogColumnId
      data.status = "Backlog"; data.sort = Date.now(); data.createdAt = serverTimestamp()
      // Init logs & links empty
      data.logs = []; data.links = [];
      await addDoc(collection(db, COLLECTIONS.CARDS), data)
    }
    state.dom.modals.card.classList.add("wf-card-form--hidden")
    reloadData() 
  } catch (err) {
    handleActionError("saveCard", err, { cardData: data });
  } finally {
    btn.disabled = false; btn.textContent = originalText;
  }
}

async function deleteCard() {
  if (!confirm("Weet je het zeker?")) return
  const btn = state.dom.btnDelete; btn.disabled = true;
  try {
    await deleteDoc(doc(db, COLLECTIONS.CARDS, state.form.cardId))
    state.dom.modals.card.classList.add("wf-card-form--hidden")
    reloadData()
  } catch(err) { handleActionError("deleteCard", err); } 
  finally { btn.disabled = false; }
}

// --- Actions (Logs & Links) ---
async function addLogEntry() {
  if (!state.form.cardId) return;
  const input = qs("#input-log-entry");
  const text = input.value.trim();
  if (!text) return;

  const card = state.cardsById.get(state.form.cardId);
  const currentLogs = card.logs || [];
  const newLog = { content: text, timestamp: new Date().toISOString() };
  
  // Nieuwste bovenaan
  const updatedLogs = [newLog, ...currentLogs];

  const btn = qs("#btn-add-log"); btn.disabled = true;
  try {
    await updateDoc(doc(db, COLLECTIONS.CARDS, state.form.cardId), { logs: updatedLogs });
    input.value = "";
    // Local update voor snelle UI
    card.logs = updatedLogs;
    renderCardLogs(card);
  } catch(err) {
    handleActionError("addLog", err);
  } finally {
    btn.disabled = false;
  }
}

async function addLinkEntry() {
  if (!state.form.cardId) return;
  const nameInput = qs("#input-link-name");
  const urlInput = qs("#input-link-url");
  
  const name = nameInput.value.trim();
  const url = urlInput.value.trim();
  if (!url) return;

  const card = state.cardsById.get(state.form.cardId);
  const currentLinks = card.links || [];
  const newLink = { id: Date.now().toString(), name: name || url, url: url };
  
  const updatedLinks = [...currentLinks, newLink];

  const btn = qs("#btn-add-link"); btn.disabled = true;
  try {
    await updateDoc(doc(db, COLLECTIONS.CARDS, state.form.cardId), { links: updatedLinks });
    nameInput.value = ""; urlInput.value = "";
    card.links = updatedLinks;
    renderCardLinks(card);
  } catch(err) {
    handleActionError("addLink", err);
  } finally {
    btn.disabled = false;
  }
}

async function deleteLinkEntry(linkId) {
  if (!confirm("Link verwijderen?") || !state.form.cardId) return;
  
  const card = state.cardsById.get(state.form.cardId);
  const currentLinks = card.links || [];
  const updatedLinks = currentLinks.filter(l => l.id !== linkId);
  
  try {
    await updateDoc(doc(db, COLLECTIONS.CARDS, state.form.cardId), { links: updatedLinks });
    card.links = updatedLinks;
    renderCardLinks(card);
  } catch(err) { handleActionError("deleteLink", err); }
}

// --- Tags (General) ---
async function createNewTag() {
  const name = prompt("Tag naam:")
  if (!name) return
  const color = prompt("Kleur (hex):", "#6366f1") || "#6366f1"
  try {
    await addDoc(collection(db, COLLECTIONS.TAGS), {
      boardId: state.boardId, uid: state.uid, name, color, active: true, builtin: false, createdAt: serverTimestamp()
    })
    reloadData()
  } catch (err) { handleActionError("createNewTag", err); }
}

async function toggleTagActive(tagId, isActive) {
  try {
    await updateDoc(doc(db, COLLECTIONS.TAGS, tagId), { active: isActive })
    reloadData()
  } catch(err) { handleActionError("toggleTagActive", err); renderManageTagsList(); }
}

// --- Drag & Drop ---
function setupDragDrop() {
  const root = state.dom.board
  root.addEventListener("dragstart", e => {
    const cardEl = e.target.closest(".wf-card")
    if (cardEl) {
      state.dragState.cardId = cardEl.dataset.cardId
      e.dataTransfer.effectAllowed = "move"
      cardEl.style.opacity = "0.5"
    }
  })
  root.addEventListener("dragend", e => {
    if(e.target) e.target.style.opacity = "1"
    state.dragState.cardId = null
    document.querySelectorAll(".wf-drop-target").forEach(el => el.classList.remove("wf-drop-target"))
  })
  root.addEventListener("dragover", e => {
    e.preventDefault(); const list = e.target.closest(".wf-column-cards"); if (list) list.classList.add("wf-drop-target")
  })
  root.addEventListener("dragleave", e => {
    const list = e.target.closest(".wf-column-cards"); if (list) list.classList.remove("wf-drop-target")
  })
  root.addEventListener("drop", async e => {
    e.preventDefault(); const list = e.target.closest(".wf-column-cards"); 
    if (!list || !state.dragState.cardId) return;
    list.classList.remove("wf-drop-target"); const newColId = list.dataset.columnId;
    const card = state.cardsById.get(state.dragState.cardId);
    if (card.columnId === newColId) return;
    try {
      await updateDoc(doc(db, COLLECTIONS.CARDS, card.id), { columnId: newColId, updatedAt: serverTimestamp() })
      reloadData()
    } catch (err) { handleActionError("moveCard", err); reloadData(); }
  })
}

// --- Init & Bindings ---
function bindUI() {
  state.dom.board = $("workflow-board")
  const content = qs(".page-workflow .content")
  const board = $("workflow-board")

  // Toolbar (Help + Filters)
  const tb = createEl("section", "wf-toolbar")
  tb.innerHTML = `
    <button class="wf-btn wf-btn-primary btn-new-card">+ Nieuwe kaart</button>
    <div class="wf-search-wrapper"><span class="wf-search-icon">🔍</span><input type="text" class="wf-search-input" placeholder="Zoeken..."></div>
    <div style="position:relative;"><button class="wf-btn wf-btn-secondary wf-btn-filter" title="Filter">Filter</button><div class="wf-filter-popover"><div class="wf-filter-section-title">Filter op tags</div><div class="wf-filter-tags-grid"></div></div></div>
    <div style="margin-left:auto; display:flex; gap:0.5rem; position:relative;"><button class="wf-btn wf-btn-secondary btn-manage-tags">🏷️ Tags Beheren</button><button class="wf-btn wf-btn-secondary btn-help" aria-label="Help">❓</button><div class="wf-help-popover"><h4>Hoe werkt het?</h4><ul><li><strong>Kolommen:</strong> Sleep kaarten.</li><li><strong>Logs:</strong> Open een kaart om notities toe te voegen.</li><li><strong>Docs:</strong> Koppel URL's aan je kaarten.</li></ul></div></div>
  `
  content.insertBefore(tb, board)

  // --- Modal met TABS (Updated HTML) ---
  const cm = createEl("section", "wf-card-form wf-card-form--hidden")
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
          <button type="button" class="wf-btn wf-btn-secondary btn-cancel-card">Annuleren</button>
          <button type="submit" class="wf-btn wf-btn-primary">Opslaan</button>
        </div>
      </div>

      <div id="tab-content-timeline" class="wf-tab-content">
        <div id="timeline-new-card-overlay" style="display:none; flex-direction:column; align-items:center; justify-content:center; height:200px; opacity:0.7; text-align:center;">
          <p>Sla de kaart eerst op om logs en documenten toe te voegen.</p>
        </div>

        <div class="wf-log-wrapper">
          <h4 style="font-size:0.9rem; margin:0 0 0.5rem 0;">Logs & Notities</h4>
          <div class="wf-log-input-group">
            <input type="text" id="input-log-entry" placeholder="Typ een notitie..." autocomplete="off">
            <button type="button" class="wf-btn wf-btn-primary wf-btn-small" id="btn-add-log">Toevoegen</button>
          </div>
          <div class="wf-log-list"></div>
        </div>

        <div class="wf-links-wrapper">
          <h4 style="font-size:0.9rem; margin:0 0 0.5rem 0;">Documenten & Links</h4>
          <div class="wf-link-input-group">
            <input type="text" id="input-link-name" placeholder="Naam (optioneel)">
            <input type="text" id="input-link-url" placeholder="URL (https://...)">
            <button type="button" class="wf-btn wf-btn-primary wf-btn-small" id="btn-add-link">+</button>
          </div>
          <div class="wf-link-list"></div>
        </div>
        
        <div class="wf-card-form-actions">
           <button type="button" class="wf-btn wf-btn-secondary btn-cancel-card">Sluiten</button>
        </div>
      </div>
    </form>
  `
  content.appendChild(cm)

  // Tags Modal (ongewijzigd)
  const tm = createEl("section", "wf-card-form wf-card-form--hidden"); tm.id = "modal-tags"
  tm.innerHTML = `<div class="wf-card-form-inner"><h2>Tags Beheren</h2><div class="wf-tags-list-board"></div><div class="wf-card-form-actions"><button class="wf-btn wf-btn-primary btn-new-tag">Nieuwe Tag</button><button class="wf-btn wf-btn-secondary btn-close-tags">Sluiten</button></div></div>`
  content.appendChild(tm)

  // Bindings
  state.dom.inputs = {
    title: qs("input[name='title']"), deadline: qs("input[name='deadline']"), desc: qs("textarea[name='description']")
  }
  state.dom.modals = { card: cm, tags: tm }
  state.dom.formTags = {
    chipsContainer: qs(".wf-form-tags-chips", cm), panel: qs(".wf-form-tags-panel", cm), tagsListContainer: qs(".wf-form-tags-list", cm)
  }
  state.dom.manageTagsList = qs(".wf-tags-list-board", tm)
  state.dom.btnDelete = qs(".btn-delete-card", cm)
  state.dom.filterTagsGrid = qs(".wf-filter-tags-grid", tb)

  // Event Listeners
  qs(".btn-new-card").addEventListener("click", () => openCardForm())
  qs(".btn-manage-tags").addEventListener("click", () => { state.dom.modals.tags.classList.remove("wf-card-form--hidden"); renderManageTagsList() })
  qs(".wf-card-form form").addEventListener("submit", saveCard)
  qs(".btn-cancel-card").addEventListener("click", () => state.dom.modals.card.classList.add("wf-card-form--hidden")) // Works for both buttons
  state.dom.btnDelete.addEventListener("click", deleteCard)
  
  qs(".btn-toggle-tags-panel").addEventListener("click", () => state.dom.formTags.panel.classList.toggle("wf-form-tags-panel--hidden"))
  qs(".btn-close-tags").addEventListener("click", () => state.dom.modals.tags.classList.add("wf-card-form--hidden"))
  qs(".btn-new-tag").addEventListener("click", createNewTag)
  
  state.dom.board.addEventListener("click", e => {
    const cardEl = e.target.closest(".wf-card"); if (cardEl) openCardForm(cardEl.dataset.cardId)
  })

  // Tab Switching
  qs("[data-tab='details']").addEventListener("click", () => switchModalTab('details'));
  qs("[data-tab='timeline']").addEventListener("click", () => switchModalTab('timeline'));

  // Log & Link Events
  qs("#btn-add-log").addEventListener("click", addLogEntry);
  qs("#input-log-entry").addEventListener("keypress", (e) => { if(e.key === 'Enter'){ e.preventDefault(); addLogEntry(); }});
  qs("#btn-add-link").addEventListener("click", addLinkEntry);

  // Popovers (Filter & Help)
  const searchInput = qs(".wf-search-input"); searchInput.addEventListener("input", (e) => { state.filter.keyword = e.target.value; renderBoard(); });
  const filterBtn = qs(".wf-btn-filter"); const filterPopover = qs(".wf-filter-popover");
  filterBtn.addEventListener("click", (e) => { e.stopPropagation(); qs(".wf-help-popover").classList.remove("visible"); filterPopover.classList.toggle("visible"); });
  const helpBtn = qs(".btn-help"); const helpPopover = qs(".wf-help-popover");
  helpBtn.addEventListener("click", (e) => { e.stopPropagation(); qs(".wf-filter-popover").classList.remove("visible"); helpPopover.classList.toggle("visible"); });

  document.addEventListener("click", (e) => {
    if (!filterPopover.contains(e.target) && e.target !== filterBtn) filterPopover.classList.remove("visible");
    if (!helpPopover.contains(e.target) && e.target !== helpBtn) helpPopover.classList.remove("visible");
  });

  setupDragDrop()
}

document.addEventListener("DOMContentLoaded", () => {
  bindUI()
  onAuthStateChanged(auth, user => {
    if (user) { state.uid = user.uid; getOrCreateBoard(user.uid).then(board => { state.boardId = board.id; reloadData() }).catch(console.error) }
    else setBoardMessage("Log in om je bord te zien.")
  })
})