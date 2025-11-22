// workflow.js
// Workflow board V0.3-07: Filtering & Sorting
// Features: Text search, Tag filtering, Multi-level sorting (Prio > Date > Alpha)

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

// Mapping voor sortering
const PRIORITY_VALS = {
  "priority-critical": 4,
  "priority-high": 3,
  "priority-normal": 2,
  "priority-low": 1
}

const PRIORITY_TAGS = [
  { key: "priority-low", name: "Low", color: "#16a34a" },
  { key: "priority-normal", name: "Normal", color: "#2563eb" },
  { key: "priority-high", name: "High", color: "#f97316" },
  { key: "priority-critical", name: "Critical", color: "#dc2626" }
]

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

  // Filter State
  filter: {
    keyword: "",
    tags: new Set() // Set van tag IDs die aan moeten staan
  },

  // UI State
  dragState: {
    cardId: null,
    sourceColId: null
  },

  form: {
    mode: "create",
    cardId: null,
    workingTags: new Set()
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

function setBoardMessage(msg) {
  const boardEl = $("workflow-board")
  if (boardEl) boardEl.innerHTML = `<p style="padding:1rem; opacity:0.7;">${msg}</p>`
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

// Haal numerieke prioriteit op van een kaart
function getCardPriorityValue(card) {
  if (!card.tags || !card.tags.length) return 0;
  let maxPrio = 0;
  
  card.tags.forEach(tagId => {
    const tag = state.tagsById.get(tagId);
    if (tag && tag.builtin && tag.builtinKey) { // Gebruik builtinKey (bijv 'priority-high')
      // Zoek sleutel op basis van de naam als key niet bestaat (legacy support), 
      // maar voorkeur is builtinKey zoals opgeslagen in PRIORITY_TAGS
      let val = PRIORITY_VALS[tag.builtinKey] || 0;
      
      // Fallback: zoek op naam als key mist
      if (val === 0) {
         const found = PRIORITY_TAGS.find(p => p.name === tag.name);
         if (found) val = PRIORITY_VALS[found.key];
      }

      if (val > maxPrio) maxPrio = val;
    }
  });
  return maxPrio;
}

// Hoofd sorteer functie
function sortCardsLogic(a, b) {
  // 1. Prioriteit (Hoog naar Laag)
  const prioA = getCardPriorityValue(a);
  const prioB = getCardPriorityValue(b);
  if (prioA !== prioB) return prioB - prioA;

  // 2. Deadline (Dichtbij naar Ver, null achteraan)
  const dateA = a.dueDate ? (a.dueDate.toDate ? a.dueDate.toDate() : new Date(a.dueDate)) : null;
  const dateB = b.dueDate ? (b.dueDate.toDate ? b.dueDate.toDate() : new Date(b.dueDate)) : null;

  if (dateA && dateB) {
    if (dateA.getTime() !== dateB.getTime()) return dateA.getTime() - dateB.getTime();
  } else if (dateA && !dateB) {
    return -1; // A heeft datum, B niet -> A komt eerst
  } else if (!dateA && dateB) {
    return 1; // B heeft datum, A niet -> B komt eerst
  }

  // 3. Alfabetisch (Titel)
  const titleA = (a.title || "").toLowerCase();
  const titleB = (b.title || "").toLowerCase();
  return titleA.localeCompare(titleB);
}

// --- Firestore Data Operations ---
// (Identiek aan V0.3 met permission fix)

async function getOrCreateBoard(uid) {
  const boardsRef = collection(db, COLLECTIONS.BOARDS)
  const q = query(boardsRef, where("uid", "==", uid))
  const snap = await getDocs(q)
  
  if (!snap.empty) {
    const docSnap = snap.docs[0]
    return { id: docSnap.id, ...docSnap.data() }
  }

  const newBoard = {
    uid,
    name: "Mijn Workflow",
    isDefault: true,
    createdAt: serverTimestamp()
  }
  const ref = await addDoc(boardsRef, newBoard)
  return { id: ref.id, ...newBoard }
}

async function fetchColumns(boardId, uid) {
  const colRef = collection(db, COLLECTIONS.COLUMNS)
  const q = query(colRef, where("boardId", "==", boardId), where("uid", "==", uid))
  let snap = await getDocs(q)

  if (snap.empty) {
    const batchPromises = DEFAULT_COLUMNS.map(def => 
      addDoc(colRef, {
        boardId, uid, title: def.title, order: def.order, createdAt: serverTimestamp()
      })
    )
    await Promise.all(batchPromises)
    snap = await getDocs(q)
  }

  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.order || 0) - (b.order || 0))
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
        boardId, uid, 
        name: p.name, color: p.color, 
        active: true, builtin: true, builtinKey: p.key, // Belangrijk voor sortering
        createdAt: serverTimestamp()
      }).then(ref => ({
        id: ref.id,
        boardId, uid, name: p.name, color: p.color, active: true, builtin: true, builtinKey: p.key
      }))
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

  if (!state.columns.length) {
    setBoardMessage("Geen kolommen.")
    return
  }

  // 1. Filter de kaarten
  const keyword = state.filter.keyword.toLowerCase().trim()
  const filterTags = state.filter.tags

  const filteredCards = Array.from(state.cardsById.values()).filter(card => {
    // Tekst filter
    const matchText = !keyword || (card.title && card.title.toLowerCase().includes(keyword));
    
    // Tag filter (als er tags geselecteerd zijn, moet de kaart minstens 1 hebben)
    let matchTags = true;
    if (filterTags.size > 0) {
      if (!card.tags || !card.tags.length) {
        matchTags = false;
      } else {
        // Controleren of minstens één van de kaart-tags in het filter zit
        matchTags = card.tags.some(tagId => filterTags.has(tagId));
      }
    }
    return matchText && matchTags;
  });

  // 2. Sorteer de gefilterde kaarten
  filteredCards.sort(sortCardsLogic);

  // 3. Groepeer per kolom
  const cardsByCol = {}
  state.columns.forEach(c => cardsByCol[c.id] = [])
  
  filteredCards.forEach(card => {
    if (cardsByCol[card.columnId]) {
      cardsByCol[card.columnId].push(card);
    }
  })

  // 4. Render DOM
  state.columns.forEach(col => {
    const colEl = createEl("div", "wf-column")
    
    const header = createEl("header", "wf-column-header")
    header.appendChild(createEl("h2", "wf-column-title", col.title))
    const count = cardsByCol[col.id].length
    
    // Toon count (eventueel met totaal als filter aanstaat)
    const totalInCol = Array.from(state.cardsById.values()).filter(c => c.columnId === col.id).length
    let countText = count.toString();
    if (count !== totalInCol) {
      countText = `${count} / ${totalInCol}` // Visualiseer dat er gefilterd wordt
    }
    
    header.appendChild(createEl("span", "wf-column-count", countText))
    colEl.appendChild(header)

    const listEl = createEl("div", "wf-column-cards")
    listEl.dataset.columnId = col.id
    
    cardsByCol[col.id].forEach(card => {
      listEl.appendChild(createCardElement(card))
    })

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

  // Datum tonen indien aanwezig
  if (card.dueDate) {
    const d = typeof card.dueDate.toDate === 'function' ? card.dueDate.toDate() : new Date(card.dueDate);
    const dateSpan = createEl("div", "", "📅 " + d.toLocaleDateString('nl-NL', {day:'numeric', month:'short'}));
    dateSpan.style.fontSize = "0.75rem";
    dateSpan.style.opacity = "0.7";
    dateSpan.style.marginTop = "0.25rem";
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
    if (chipsContainer.children.length > 0) {
      el.appendChild(chipsContainer)
    }
  }

  return el
}

// --- UI: Filter Popover Render ---
function renderFilterPopover() {
  const grid = state.dom.filterTagsGrid;
  grid.innerHTML = "";

  state.tags.filter(t => t.active !== false).forEach(tag => {
    const pill = createEl("span", "wf-tag-chip wf-filter-tag", tag.name);
    const dot = createEl("span", "wf-tag-chip-color");
    dot.style.backgroundColor = tag.color;
    pill.prepend(dot);

    if (state.filter.tags.has(tag.id)) {
      pill.classList.add("selected");
    }

    pill.addEventListener("click", () => {
      if (state.filter.tags.has(tag.id)) {
        state.filter.tags.delete(tag.id);
        pill.classList.remove("selected");
      } else {
        state.filter.tags.add(tag.id);
        pill.classList.add("selected");
      }
      updateFilterBtnState();
      renderBoard(); // Live update
    });

    grid.appendChild(pill);
  });
}

function updateFilterBtnState() {
  const hasFilter = state.filter.tags.size > 0;
  const btn = qs(".wf-btn-filter");
  if (hasFilter) {
    btn.classList.add("active");
    btn.innerHTML = `🔍 Tags (${state.filter.tags.size})`;
  } else {
    btn.classList.remove("active");
    btn.innerHTML = `🔍 Filter`;
  }
}

// ... (RenderFormTagSelector en RenderManageTagsList blijven hetzelfde als V0.3, hier weggelaten voor beknoptheid. 
// Neem ze over uit de vorige versie of vraag ze indien nodig, ze zijn niet gewijzigd behalve context) ...

function renderFormTagSelector() {
    // Zelfde als V0.3 (standaard)
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

function renderManageTagsList() {
    // Zelfde als V0.3
    const container = state.dom.manageTagsList
    container.innerHTML = ""; container.className = "wf-tags-list-board"
    state.tags.forEach(tag => {
        const row = createEl("div", "wf-tag-row")
        const info = createEl("div", "", ""); info.style.display="flex"; info.style.gap="0.5rem"; info.style.alignItems="center"
        const dot = createEl("span", "wf-tag-chip-color"); dot.style.backgroundColor=tag.color; dot.style.width="16px"; dot.style.height="16px"
        info.appendChild(dot); info.appendChild(createEl("span", "", tag.name))
        row.appendChild(info)
        
        const label = createEl("label", "wf-tag-toggle")
        const input = createEl("input"); input.type="checkbox"; input.checked = tag.active !== false; input.disabled=!!tag.builtin
        const slider = createEl("span", "wf-tag-toggle-slider")
        if(!tag.builtin) input.addEventListener("change", ()=>toggleTagActive(tag.id, input.checked))
        label.appendChild(input); label.appendChild(slider)
        row.appendChild(label); container.appendChild(row)
    })
}

// --- Actions & Handlers ---

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

    renderFilterPopover(); // Update filter tags indien tags gewijzigd
    renderBoard();
  } catch (err) {
    console.error(err)
    setBoardMessage("Fout bij laden data: " + err.message)
  }
}

function openCardForm(cardId = null) {
  state.form.mode = cardId ? "edit" : "create"
  state.form.cardId = cardId
  state.form.workingTags = new Set()

  const { title, desc, deadline } = state.dom.inputs
  
  if (cardId) {
    const card = state.cardsById.get(cardId)
    if (!card) return
    title.value = card.title
    desc.value = card.description || ""
    deadline.value = formatDateForInput(card.dueDate)
    if (card.tags) card.tags.forEach(t => state.form.workingTags.add(t))
    state.dom.btnDelete.style.display = "block"
  } else {
    title.value = ""
    desc.value = ""
    deadline.value = ""
    state.dom.btnDelete.style.display = "none"
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
      data.boardId = state.boardId
      data.uid = state.uid
      data.columnId = state.backlogColumnId
      data.status = "Backlog"
      data.sort = Date.now()
      data.createdAt = serverTimestamp()
      await addDoc(collection(db, COLLECTIONS.CARDS), data)
    }
    state.dom.modals.card.classList.add("wf-card-form--hidden")
    reloadData()
  } catch (err) {
    console.error(err)
    alert("Opslaan mislukt")
  }
}

async function deleteCard() {
  if (!confirm("Weet je het zeker?")) return
  try {
    await deleteDoc(doc(db, COLLECTIONS.CARDS, state.form.cardId))
    state.dom.modals.card.classList.add("wf-card-form--hidden")
    reloadData()
  } catch(e) { console.error(e) }
}

async function createNewTag() {
  const name = prompt("Tag naam:")
  if (!name) return
  const color = prompt("Kleur (hex):", "#6366f1") || "#6366f1"
  try {
    await addDoc(collection(db, COLLECTIONS.TAGS), {
      boardId: state.boardId, uid: state.uid,
      name, color, active: true, builtin: false, createdAt: serverTimestamp()
    })
    reloadData()
  } catch (e) { console.error(e) }
}

async function toggleTagActive(tagId, isActive) {
  try {
    await updateDoc(doc(db, COLLECTIONS.TAGS, tagId), { active: isActive })
    reloadData()
  } catch(e) { console.error(e) }
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
    e.preventDefault()
    const list = e.target.closest(".wf-column-cards")
    if (list) list.classList.add("wf-drop-target")
  })
  root.addEventListener("dragleave", e => {
    const list = e.target.closest(".wf-column-cards")
    if (list) list.classList.remove("wf-drop-target")
  })
  root.addEventListener("drop", async e => {
    e.preventDefault()
    const list = e.target.closest(".wf-column-cards")
    if (!list || !state.dragState.cardId) return
    list.classList.remove("wf-drop-target")
    const newColId = list.dataset.columnId
    const card = state.cardsById.get(state.dragState.cardId)
    if (card.columnId === newColId) return 
    try {
      await updateDoc(doc(db, COLLECTIONS.CARDS, card.id), { columnId: newColId, updatedAt: serverTimestamp() })
      reloadData()
    } catch (err) { console.error(err); alert("Verplaatsen mislukt") }
  })
}

// --- Init & Bindings ---

function bindUI() {
  state.dom.board = $("workflow-board")
  
  // 1. Bouw DOM (nu met Filter controls)
  const content = qs(".page-workflow .content")
  const board = $("workflow-board")

  // Toolbar met Search & Filter
  const tb = createEl("section", "wf-toolbar")
  tb.innerHTML = `
    <button class="wf-btn wf-btn-primary btn-new-card">+ Nieuwe kaart</button>
    
    <div class="wf-search-wrapper">
      <span class="wf-search-icon">🔍</span>
      <input type="text" class="wf-search-input" placeholder="Zoeken...">
    </div>

    <div style="position:relative;">
      <button class="wf-btn wf-btn-secondary wf-btn-filter">Filter</button>
      <div class="wf-filter-popover">
        <div class="wf-filter-section-title">Filter op tags</div>
        <div class="wf-filter-tags-grid"></div>
      </div>
    </div>

    <button class="wf-btn wf-btn-secondary btn-manage-tags" style="margin-left:auto;">🏷️ Tags Beheren</button>
  `
  content.insertBefore(tb, board)

  // (Hergebruik modal HTML uit vorige versie)
  const cm = createEl("section", "wf-card-form wf-card-form--hidden")
  cm.innerHTML = `<form class="wf-card-form-inner"><div class="wf-form-group"><label>Titel</label><input type="text" name="title" required placeholder="Taak naam..."></div><div class="wf-form-group"><label>Deadline</label><input type="date" name="deadline"></div><div class="wf-form-group"><label>Omschrijving</label><textarea name="description" rows="3"></textarea></div><div class="wf-form-group wf-form-group-tags"><div class="wf-form-tags-header"><span>Tags</span><button type="button" class="wf-btn wf-btn-small wf-btn-secondary btn-toggle-tags-panel">Wijzigen</button></div><div class="wf-form-tags-chips"></div><div class="wf-form-tags-panel wf-form-tags-panel--hidden"><div class="wf-form-tags-list"></div></div></div><div class="wf-card-form-actions"><button type="button" class="wf-btn wf-btn-danger btn-delete-card">Verwijderen</button><button type="button" class="wf-btn wf-btn-secondary btn-cancel-card">Annuleren</button><button type="submit" class="wf-btn wf-btn-primary">Opslaan</button></div></form>`
  content.appendChild(cm)

  const tm = createEl("section", "wf-card-form wf-card-form--hidden"); tm.id = "modal-tags"
  tm.innerHTML = `<div class="wf-card-form-inner"><h2>Tags Beheren</h2><p style="font-size:0.85rem; opacity:0.7;">Beheer hier de beschikbare tags voor je bord.</p><div class="wf-tags-list-board"></div><div class="wf-card-form-actions"><button class="wf-btn wf-btn-primary btn-new-tag">Nieuwe Tag</button><button class="wf-btn wf-btn-secondary btn-close-tags">Sluiten</button></div></div>`
  content.appendChild(tm)

  // Bindings
  state.dom.inputs = {
    title: qs("input[name='title']"),
    deadline: qs("input[name='deadline']"),
    desc: qs("textarea[name='description']")
  }
  state.dom.modals = { card: cm, tags: tm }
  state.dom.formTags = {
    chipsContainer: qs(".wf-form-tags-chips", cm),
    panel: qs(".wf-form-tags-panel", cm),
    tagsListContainer: qs(".wf-form-tags-list", cm)
  }
  state.dom.manageTagsList = qs(".wf-tags-list-board", tm)
  state.dom.btnDelete = qs(".btn-delete-card", cm)
  state.dom.filterTagsGrid = qs(".wf-filter-tags-grid", tb)

  // Event Listeners Main
  qs(".btn-new-card").addEventListener("click", () => openCardForm())
  qs(".btn-manage-tags").addEventListener("click", () => {
    state.dom.modals.tags.classList.remove("wf-card-form--hidden")
    renderManageTagsList()
  })
  qs(".wf-card-form form").addEventListener("submit", saveCard)
  qs(".btn-cancel-card").addEventListener("click", () => state.dom.modals.card.classList.add("wf-card-form--hidden"))
  state.dom.btnDelete.addEventListener("click", deleteCard)
  qs(".btn-toggle-tags-panel").addEventListener("click", () => state.dom.formTags.panel.classList.toggle("wf-form-tags-panel--hidden"))
  qs(".btn-close-tags").addEventListener("click", () => state.dom.modals.tags.classList.add("wf-card-form--hidden"))
  qs(".btn-new-tag").addEventListener("click", createNewTag)
  
  state.dom.board.addEventListener("click", e => {
    const cardEl = e.target.closest(".wf-card")
    if (cardEl) openCardForm(cardEl.dataset.cardId)
  })

  // Filter & Search Events
  const searchInput = qs(".wf-search-input");
  searchInput.addEventListener("input", (e) => {
    state.filter.keyword = e.target.value;
    renderBoard();
  });

  const filterBtn = qs(".wf-btn-filter");
  const filterPopover = qs(".wf-filter-popover");
  
  filterBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    filterPopover.classList.toggle("visible");
  });

  // Sluit popover als je ernaast klikt
  document.addEventListener("click", (e) => {
    if (!filterPopover.contains(e.target) && e.target !== filterBtn) {
      filterPopover.classList.remove("visible");
    }
  });

  setupDragDrop()
}

document.addEventListener("DOMContentLoaded", () => {
  bindUI()
  onAuthStateChanged(auth, user => {
    if (user) {
      state.uid = user.uid
      getOrCreateBoard(user.uid).then(board => {
        state.boardId = board.id
        reloadData()
      })
    } else {
      setBoardMessage("Log in om je bord te zien.")
    }
  })
})