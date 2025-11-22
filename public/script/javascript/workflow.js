// workflow.js
// Workflow board: Firestore CRUD, Drag & Drop, Tag Management
// Geoptimaliseerde versie V0.3

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
  columns: [], // Array van kolom objecten
  columnsById: new Map(),
  cardsById: new Map(),
  tags: [], // Array van alle tags
  tagsById: new Map(),
  backlogColumnId: null,

  // UI State
  dragState: {
    cardId: null,
    sourceColId: null
  },

  // Formulier State
  form: {
    mode: "create", // 'create' | 'edit'
    cardId: null,
    workingTags: new Set() // Set van tag IDs
  },

  // Element References (worden gevuld bij init)
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

// --- Date Helpers ---
const formatDateForInput = (timestamp) => {
  if (!timestamp) return ""
  // Firestore timestamp naar Date
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp)
  if (isNaN(date)) return ""
  return date.toISOString().split('T')[0]
}

const parseDateFromInput = (val) => {
  if (!val) return null
  return new Date(val) // Browser regelt parsing van YYYY-MM-DD
}

// --- Firestore Data Operations ---

async function getOrCreateBoard(uid) {
  const boardsRef = collection(db, COLLECTIONS.BOARDS)
  // Check voor default board
  const q = query(boardsRef, where("uid", "==", uid))
  const snap = await getDocs(q)
  
  if (!snap.empty) {
    const docSnap = snap.docs[0]
    return { id: docSnap.id, ...docSnap.data() }
  }

  // Maak nieuw board
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
  const q = query(colRef, where("boardId", "==", boardId))
  let snap = await getDocs(q)

  if (snap.empty) {
    // Initialiseer defaults
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

async function fetchCards(boardId) {
  const cardsRef = collection(db, COLLECTIONS.CARDS)
  const q = query(cardsRef, where("boardId", "==", boardId))
  const snap = await getDocs(q)
  
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
}

async function fetchAndSyncTags(boardId, uid) {
  const tagsRef = collection(db, COLLECTIONS.TAGS)
  const q = query(tagsRef, where("boardId", "==", boardId))
  const snap = await getDocs(q)
  
  let loadedTags = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  
  // Check op verplichte prioriteitstags
  const existingNames = new Set(loadedTags.map(t => t.name))
  const missing = PRIORITY_TAGS.filter(p => !existingNames.has(p.name))
  
  if (missing.length > 0) {
    const newTagsPromises = missing.map(p => 
      addDoc(tagsRef, {
        boardId, uid, 
        name: p.name, color: p.color, 
        active: true, builtin: true, 
        createdAt: serverTimestamp()
      }).then(ref => ({
        id: ref.id,
        boardId, uid, name: p.name, color: p.color, active: true, builtin: true
      }))
    )
    
    // Voeg direct toe aan lokale lijst (Performance: bespaart een fetch)
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

  // Map kaarten aan kolommen
  const cardsByCol = {}
  state.columns.forEach(c => cardsByCol[c.id] = [])
  state.cardsById.forEach(card => {
    if (cardsByCol[card.columnId]) cardsByCol[card.columnId].push(card)
  })

  // Render kolommen
  state.columns.forEach(col => {
    const colEl = createEl("div", "wf-column")
    
    // Header
    const header = createEl("header", "wf-column-header")
    header.appendChild(createEl("h2", "wf-column-title", col.title))
    const count = cardsByCol[col.id].length
    header.appendChild(createEl("span", "wf-column-count", count.toString()))
    colEl.appendChild(header)

    // Kaarten container
    const listEl = createEl("div", "wf-column-cards")
    listEl.dataset.columnId = col.id
    
    // Render Cards
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

  // Tags rendering (alleen de chips)
  if (card.tags && card.tags.length > 0) {
    const chipsContainer = createEl("div", "wf-card-tags-chips")
    card.tags.forEach(tagId => {
      const tag = state.tagsById.get(tagId)
      if (tag && tag.active !== false) { // Toon alleen als tag bestaat en actief is
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

function renderFormTagSelector() {
  const { chipsContainer, tagsListContainer, panel } = state.dom.formTags
  
  // 1. Render Chips bovenaan (in de input balk)
  chipsContainer.innerHTML = ""
  if (state.form.workingTags.size === 0) {
    const ph = createEl("span", "", "Geen tags")
    ph.style.opacity = "0.6"
    ph.style.fontSize = "0.8rem"
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

  // 2. Render Selectie Panel (Geselecteerd vs Beschikbaar)
  tagsListContainer.innerHTML = ""
  
  const allTags = state.tags.filter(t => t.active !== false)
  const selected = allTags.filter(t => state.form.workingTags.has(t.id))
  const unselected = allTags.filter(t => !state.form.workingTags.has(t.id))

  const createTagGroup = (title, tags) => {
    if (tags.length === 0) return null
    const group = createEl("div", "wf-tags-group")
    group.appendChild(createEl("div", "wf-tags-group-title", title))
    
    const grid = createEl("div", "wf-tags-columns")
    tags.forEach(tag => {
      const label = createEl("label", "wf-card-tag-option")
      const input = createEl("input")
      input.type = "checkbox"
      input.checked = state.form.workingTags.has(tag.id)
      
      const pill = createEl("span", "wf-tag-pill", tag.name)
      pill.style.backgroundColor = tag.color
      
      // Event: Toggle Tag
      input.addEventListener("change", () => {
        if (input.checked) state.form.workingTags.add(tag.id)
        else state.form.workingTags.delete(tag.id)
        renderFormTagSelector() // Re-render om groepen te updaten
      })

      label.appendChild(input)
      label.appendChild(pill)
      grid.appendChild(label)
    })
    group.appendChild(grid)
    return group
  }

  const groupSel = createTagGroup("Geselecteerd", selected)
  const groupAvail = createTagGroup("Beschikbaar", unselected)

  if (groupSel) tagsListContainer.appendChild(groupSel)
  if (groupAvail) tagsListContainer.appendChild(groupAvail)
  
  if (!groupSel && !groupAvail) {
    tagsListContainer.appendChild(createEl("p", "", "Geen actieve tags gevonden."))
  }
}

function renderManageTagsList() {
  const container = state.dom.manageTagsList
  container.innerHTML = ""
  container.className = "wf-tags-list-board"

  state.tags.forEach(tag => {
    const row = createEl("div", "wf-tag-row")
    
    // Kleur & Naam
    const info = createEl("div", "", "")
    info.style.display = "flex"; info.style.alignItems = "center"; info.style.gap = "0.5rem"
    
    const dot = createEl("span", "wf-tag-chip-color")
    dot.style.backgroundColor = tag.color
    dot.style.width = "16px"; dot.style.height = "16px"
    
    info.appendChild(dot)
    info.appendChild(createEl("span", "", tag.name))
    row.appendChild(info)

    // Toggle
    const label = createEl("label", "wf-tag-toggle")
    const input = createEl("input")
    input.type = "checkbox"
    input.checked = tag.active !== false
    input.disabled = !!tag.builtin
    
    const slider = createEl("span", "wf-tag-toggle-slider")
    
    if (!tag.builtin) {
      input.addEventListener("change", () => toggleTagActive(tag.id, input.checked))
    } else {
      label.title = "Standaard tags kunnen niet uitgezet worden"
      label.style.opacity = "0.6"
    }

    label.appendChild(input)
    label.appendChild(slider)
    row.appendChild(label)

    container.appendChild(row)
  })
}

// --- Actions & Handlers ---

async function reloadData() {
  if (!state.uid || !state.boardId) return
  
  try {
    const [cols, cards, tags] = await Promise.all([
      fetchColumns(state.boardId, state.uid),
      fetchCards(state.boardId),
      fetchAndSyncTags(state.boardId, state.uid)
    ])

    state.columns = cols
    state.columnsById = new Map(cols.map(c => [c.id, c]))
    
    state.tags = tags
    state.tagsById = new Map(tags.map(t => [t.id, t]))
    
    state.cardsById = new Map(cards.map(c => [c.id, c]))
    
    // Zoek backlog ID
    const backlog = cols.find(c => c.title === "Backlog") || cols[0]
    state.backlogColumnId = backlog ? backlog.id : null

    renderBoard()
  } catch (err) {
    console.error(err)
    setBoardMessage("Fout bij laden data.")
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

  // Reset UI
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
      data.sort = Date.now() // Simpele sort hack
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
    // Herlaad tags (en update UI)
    const tags = await fetchAndSyncTags(state.boardId, state.uid)
    state.tags = tags
    state.tagsById = new Map(tags.map(t => [t.id, t]))
    renderManageTagsList()
  } catch (e) { console.error(e) }
}

async function toggleTagActive(tagId, isActive) {
  try {
    await updateDoc(doc(db, COLLECTIONS.TAGS, tagId), { active: isActive })
    // Update local state zonder refresh
    const tag = state.tagsById.get(tagId)
    if(tag) tag.active = isActive
    reloadData() // Refresh bord om kaarten te updaten
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
    if (list) {
      list.classList.add("wf-drop-target")
    }
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
    
    // Update UI optimistic
    const card = state.cardsById.get(state.dragState.cardId)
    if (card.columnId === newColId) return // Geen verandering
    
    try {
      // DB Update
      await updateDoc(doc(db, COLLECTIONS.CARDS, card.id), {
        columnId: newColId,
        updatedAt: serverTimestamp()
      })
      reloadData()
    } catch (err) {
      console.error(err)
      alert("Verplaatsen mislukt")
    }
  })
}

// --- Init & Bindings ---

function bindUI() {
  // Selecteer elementen 1x
  state.dom.board = $("workflow-board")
  
  // Maak Modal Structuren in JS als ze nog niet in HTML staan? 
  // Nee, we gaan ervan uit dat buildToolbarAndModals de DOM opbouwt zoals in origineel script,
  // maar voor Clean Code is het beter als deze elementen gewoon in de HTML staan.
  // Ik zal hier de 'build' functie aanroepen die de DOM injecteert.
  buildDOMStructure()

  // Bindings
  state.dom.inputs = {
    title: qs("input[name='title']"),
    deadline: qs("input[name='deadline']"),
    desc: qs("textarea[name='description']")
  }
  
  state.dom.modals = {
    card: qs(".wf-card-form"), 
    tags: qs("#modal-tags") // ID toegevoegd in builder
  }

  state.dom.formTags = {
    chipsContainer: qs(".wf-form-tags-chips"),
    panel: qs(".wf-form-tags-panel"),
    tagsListContainer: qs(".wf-form-tags-list")
  }
  
  state.dom.manageTagsList = qs(".wf-tags-list-board")
  state.dom.btnDelete = qs(".btn-delete-card")

  // Event Listeners
  qs(".btn-new-card").addEventListener("click", () => openCardForm())
  qs(".btn-manage-tags").addEventListener("click", () => {
    state.dom.modals.tags.classList.remove("wf-card-form--hidden")
    renderManageTagsList()
  })
  
  qs(".wf-card-form form").addEventListener("submit", saveCard)
  qs(".btn-cancel-card").addEventListener("click", () => state.dom.modals.card.classList.add("wf-card-form--hidden"))
  state.dom.btnDelete.addEventListener("click", deleteCard)

  qs(".btn-toggle-tags-panel").addEventListener("click", () => {
    state.dom.formTags.panel.classList.toggle("wf-form-tags-panel--hidden")
  })

  // Tag Manager Modal Events
  qs(".btn-close-tags").addEventListener("click", () => state.dom.modals.tags.classList.add("wf-card-form--hidden"))
  qs(".btn-new-tag").addEventListener("click", createNewTag)

  // Klik op board (delegate) voor edit
  state.dom.board.addEventListener("click", e => {
    const cardEl = e.target.closest(".wf-card")
    if (cardEl) openCardForm(cardEl.dataset.cardId)
  })

  setupDragDrop()
}

// Helper om de UI injectie te doen (zodat HTML schoon blijft)
function buildDOMStructure() {
  const content = qs(".page-workflow .content")
  const board = $("workflow-board")

  // Toolbar
  const tb = createEl("section", "wf-toolbar")
  tb.innerHTML = `
    <button class="wf-btn wf-btn-primary btn-new-card">+ Nieuwe kaart</button>
    <button class="wf-btn wf-btn-secondary btn-manage-tags">🏷️ Tags</button>
  `
  content.insertBefore(tb, board)

  // Card Modal
  const cm = createEl("section", "wf-card-form wf-card-form--hidden")
  cm.innerHTML = `
    <form class="wf-card-form-inner">
      <div class="wf-form-group">
        <label>Titel</label>
        <input type="text" name="title" required placeholder="Taak naam...">
      </div>
      <div class="wf-form-group">
        <label>Deadline</label>
        <input type="date" name="deadline">
      </div>
      <div class="wf-form-group">
        <label>Omschrijving</label>
        <textarea name="description" rows="3"></textarea>
      </div>
      <div class="wf-form-group wf-form-group-tags">
        <div class="wf-form-tags-header">
          <span>Tags</span>
          <button type="button" class="wf-btn wf-btn-small wf-btn-secondary btn-toggle-tags-panel">Wijzigen</button>
        </div>
        <div class="wf-form-tags-chips"></div>
        <div class="wf-form-tags-panel wf-form-tags-panel--hidden">
          <div class="wf-form-tags-list"></div>
        </div>
      </div>
      <div class="wf-card-form-actions">
        <button type="button" class="wf-btn wf-btn-danger btn-delete-card">Verwijderen</button>
        <button type="button" class="wf-btn wf-btn-secondary btn-cancel-card">Annuleren</button>
        <button type="submit" class="wf-btn wf-btn-primary">Opslaan</button>
      </div>
    </form>
  `
  content.appendChild(cm)

  // Tags Modal
  const tm = createEl("section", "wf-card-form wf-card-form--hidden")
  tm.id = "modal-tags"
  tm.innerHTML = `
    <div class="wf-card-form-inner">
      <h2>Tags Beheren</h2>
      <p style="font-size:0.85rem; opacity:0.7;">Beheer hier de beschikbare tags voor je bord.</p>
      <div class="wf-tags-list-board"></div>
      <div class="wf-card-form-actions">
        <button class="wf-btn wf-btn-primary btn-new-tag">Nieuwe Tag</button>
        <button class="wf-btn wf-btn-secondary btn-close-tags">Sluiten</button>
      </div>
    </div>
  `
  content.appendChild(tm)
}

// Start
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