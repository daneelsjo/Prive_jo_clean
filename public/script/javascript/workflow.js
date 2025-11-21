// public/script/javascript/workflow.js
// Workflow board met Firestore (read + CRUD voor kaarten + drag & drop)
// Kolommen: 4 vaste kolommen (Backlog, Te bespreken, In progress, Afgewerkt)

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

// Firestore setup (pakt automatisch DEV of MAIN op basis van hostname)
const app = getFirebaseApp()
const db = getFirestore(app)
const auth = getAuth(app)

// Collectie namen
const COL_BOARDS = "workflowBoards"
const COL_COLUMNS = "workflowColumns"
const COL_CARDS = "workflowCards"

// Default kolommen (vast)
const DEFAULT_COLUMNS = [
  { key: "backlog", title: "Backlog", order: 1 },
  { key: "to-discuss", title: "Te bespreken", order: 2 },
  { key: "in-progress", title: "In progress", order: 3 },
  { key: "done", title: "Afgewerkt", order: 4 }
]

// Eenvoudige app state
const state = {
  uid: null,
  boardId: null,
  columns: [],
  columnsById: new Map(),
  cardsById: new Map(),
  backlogColumnId: null,

  // Form / UI referenties
  formSectionEl: null,
  formEl: null,
  mode: "create", // "create" of "edit"
  editingCardId: null,
  inputTitle: null,
  inputDeadline: null,
  inputDescription: null,
  btnDelete: null,

  // Drag & drop
  draggingCardId: null
}

// DOM helpers
function getBoardRoot() {
  return document.getElementById("workflow-board")
}

function setBoardMessage(text) {
  const root = getBoardRoot()
  if (!root) return
  root.innerHTML = ""
  const p = document.createElement("p")
  p.textContent = text
  p.style.opacity = "0.8"
  p.style.padding = "0.5rem 0"
  root.appendChild(p)
}

// Firestore helpers

async function getOrCreateDefaultBoard(uid) {
  const boardsRef = collection(db, COL_BOARDS)

  const qDefault = query(
    boardsRef,
    where("uid", "==", uid),
    where("isDefault", "==", true)
  )
  let snap = await getDocs(qDefault)
  if (!snap.empty) {
    const docSnap = snap.docs[0]
    return { id: docSnap.id, ...docSnap.data() }
  }

  const qAny = query(boardsRef, where("uid", "==", uid))
  snap = await getDocs(qAny)
  if (!snap.empty) {
    const docSnap = snap.docs[0]
    return { id: docSnap.id, ...docSnap.data() }
  }

  const boardDoc = await addDoc(boardsRef, {
    uid,
    name: "Workflow board",
    isDefault: true,
    createdAt: serverTimestamp()
  })

  return {
    id: boardDoc.id,
    uid,
    name: "Workflow board",
    isDefault: true
  }
}

async function fetchColumnsOrCreateDefaults(boardId, uid) {
  const colsRef = collection(db, COL_COLUMNS)
  const qCols = query(
    colsRef,
    where("boardId", "==", boardId),
    where("uid", "==", uid)
  )

  let snap = await getDocs(qCols)

  if (snap.empty) {
    for (const def of DEFAULT_COLUMNS) {
      await addDoc(colsRef, {
        boardId,
        uid,
        title: def.title,
        order: def.order,
        createdAt: serverTimestamp()
      })
    }
    snap = await getDocs(qCols)
  }

  const cols = snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }))

  cols.sort((a, b) => {
    const aOrder = typeof a.order === "number" ? a.order : 0
    const bOrder = typeof b.order === "number" ? b.order : 0
    if (aOrder < bOrder) return -1
    if (aOrder > bOrder) return 1
    return 0
  })

  return cols
}

async function fetchCards(boardId, uid) {
  const cardsRef = collection(db, COL_CARDS)
  const qCards = query(
    cardsRef,
    where("boardId", "==", boardId),
    where("uid", "==", uid)
  )

  const snap = await getDocs(qCards)
  const cards = snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }))

  cards.sort((a, b) => {
    const aSort = typeof a.sort === "number" ? a.sort : 0
    const bSort = typeof b.sort === "number" ? b.sort : 0
    if (aSort < bSort) return -1
    if (aSort > bSort) return 1
    return 0
  })

  return cards
}

function mergeColumnsAndCards(columns, cards) {
  const byColumnId = {}
  columns.forEach(col => {
    byColumnId[col.id] = []
  })

  cards.forEach(card => {
    const colId = card.columnId
    if (!colId) return
    if (!byColumnId[colId]) {
      byColumnId[colId] = []
    }
    byColumnId[colId].push(card)
  })

  return columns.map(col => ({
    id: col.id,
    title: col.title,
    cards: byColumnId[col.id] || []
  }))
}

function renderBoard(columns) {
  const root = getBoardRoot()
  if (!root) return

  root.innerHTML = ""

  if (!columns || !columns.length) {
    setBoardMessage("Geen kolommen gevonden voor dit board.")
    return
  }

  columns.forEach(col => {
    const colEl = document.createElement("div")
    colEl.className = "wf-column"

    const header = document.createElement("header")
    header.className = "wf-column-header"

    const titleEl = document.createElement("h2")
    titleEl.className = "wf-column-title"
    titleEl.textContent = col.title || "(zonder titel)"

    const countEl = document.createElement("span")
    countEl.className = "wf-column-count"
    const cards = col.cards || []
    countEl.textContent = String(cards.length)

    header.appendChild(titleEl)
    header.appendChild(countEl)
    colEl.appendChild(header)

    const listEl = document.createElement("div")
    listEl.className = "wf-column-cards"
    listEl.dataset.columnId = col.id

    cards.forEach(card => {
      const cardEl = document.createElement("article")
      cardEl.className = "wf-card"
      cardEl.setAttribute("data-card-id", card.id)
      cardEl.draggable = true

      const titleSpan = document.createElement("div")
      titleSpan.className = "wf-card-title"
      titleSpan.textContent = card.title || "(zonder titel)"

      cardEl.appendChild(titleSpan)
      listEl.appendChild(cardEl)
    })

    colEl.appendChild(listEl)
    root.appendChild(colEl)
  })
}

// Helpers voor datum

function toDateInputValue(dueDate) {
  if (!dueDate) return ""
  let d = dueDate
  if (typeof dueDate.toDate === "function") {
    d = dueDate.toDate()
  }
  if (!(d instanceof Date)) {
    return ""
  }
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function fromDateInputValue(value) {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parts = trimmed.split("-")
  if (parts.length !== 3) return null
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }
  return new Date(year, month - 1, day)
}

// UI: toolbar + formulier

function buildToolbarAndForm() {
  const content = document.querySelector(".page-workflow .content")
  const boardSection = getBoardRoot()
  if (!content || !boardSection) return

  const toolbar = document.createElement("section")
  toolbar.className = "wf-toolbar"

  const newBtn = document.createElement("button")
  newBtn.type = "button"
  newBtn.className = "wf-btn wf-btn-primary"
  newBtn.textContent = "Nieuwe kaart"
  newBtn.addEventListener("click", () => {
    openCreateForm()
  })

  toolbar.appendChild(newBtn)

  const formSection = document.createElement("section")
  formSection.className = "wf-card-form wf-card-form--hidden"

  const form = document.createElement("form")
  form.className = "wf-card-form-inner"

  const titleGroup = document.createElement("div")
  titleGroup.className = "wf-form-group"
  const titleLabel = document.createElement("label")
  titleLabel.textContent = "Titel"
  const inputTitle = document.createElement("input")
  inputTitle.type = "text"
  inputTitle.required = true
  inputTitle.name = "title"
  titleGroup.appendChild(titleLabel)
  titleGroup.appendChild(inputTitle)

  const deadlineGroup = document.createElement("div")
  deadlineGroup.className = "wf-form-group"
  const deadlineLabel = document.createElement("label")
  deadlineLabel.textContent = "Deadline"
  const inputDeadline = document.createElement("input")
  inputDeadline.type = "date"
  inputDeadline.name = "deadline"
  deadlineGroup.appendChild(deadlineLabel)
  deadlineGroup.appendChild(inputDeadline)

  const descGroup = document.createElement("div")
  descGroup.className = "wf-form-group"
  const descLabel = document.createElement("label")
  descLabel.textContent = "Omschrijving"
  const inputDescription = document.createElement("textarea")
  inputDescription.name = "description"
  inputDescription.rows = 3
  descGroup.appendChild(descLabel)
  descGroup.appendChild(inputDescription)

  const actions = document.createElement("div")
  actions.className = "wf-card-form-actions"

  const saveBtn = document.createElement("button")
  saveBtn.type = "submit"
  saveBtn.className = "wf-btn wf-btn-primary"
  saveBtn.textContent = "Opslaan"

  const cancelBtn = document.createElement("button")
  cancelBtn.type = "button"
  cancelBtn.className = "wf-btn wf-btn-secondary"
  cancelBtn.textContent = "Annuleren"

  const deleteBtn = document.createElement("button")
  deleteBtn.type = "button"
  deleteBtn.className = "wf-btn wf-btn-danger"
  deleteBtn.textContent = "Verwijderen"

  actions.appendChild(saveBtn)
  actions.appendChild(cancelBtn)
  actions.appendChild(deleteBtn)

  form.appendChild(titleGroup)
  form.appendChild(deadlineGroup)
  form.appendChild(descGroup)
  form.appendChild(actions)

  formSection.appendChild(form)

  content.insertBefore(toolbar, boardSection)
  content.insertBefore(formSection, boardSection)

  form.addEventListener("submit", handleFormSubmit)
  cancelBtn.addEventListener("click", () => {
    closeForm()
  })
  deleteBtn.addEventListener("click", handleDeleteCard)

  state.formSectionEl = formSection
  state.formEl = form
  state.inputTitle = inputTitle
  state.inputDeadline = inputDeadline
  state.inputDescription = inputDescription
  state.btnDelete = deleteBtn
}

function openCreateForm() {
  if (!state.formSectionEl) return
  state.mode = "create"
  state.editingCardId = null
  state.inputTitle.value = ""
  state.inputDeadline.value = ""
  state.inputDescription.value = ""
  state.btnDelete.style.display = "none"
  state.formSectionEl.classList.remove("wf-card-form--hidden")
  state.inputTitle.focus()
}

function openEditForm(cardId) {
  if (!state.formSectionEl) return
  const card = state.cardsById.get(cardId)
  if (!card) {
    console.warn("Kaart niet gevonden voor edit", cardId)
    return
  }

  state.mode = "edit"
  state.editingCardId = cardId

  state.inputTitle.value = card.title || ""
  state.inputDeadline.value = toDateInputValue(card.dueDate)
  state.inputDescription.value = card.description || ""
  state.btnDelete.style.display = "inline-block"

  state.formSectionEl.classList.remove("wf-card-form--hidden")
  state.inputTitle.focus()
}

function closeForm() {
  if (!state.formSectionEl) return
  state.formSectionEl.classList.add("wf-card-form--hidden")
  state.mode = "create"
  state.editingCardId = null
}

// CRUD kaart acties

function getNextSortValueForColumn(columnId) {
  let maxSort = 0
  state.cardsById.forEach(card => {
    if (card.columnId === columnId) {
      const val = typeof card.sort === "number" ? card.sort : 0
      if (val > maxSort) {
        maxSort = val
      }
    }
  })
  return maxSort + 10
}

function getNextSortValueForBacklog() {
  if (!state.backlogColumnId) return 10
  return getNextSortValueForColumn(state.backlogColumnId)
}

async function handleFormSubmit(event) {
  event.preventDefault()
  if (!state.uid || !state.boardId) {
    window.alert("Geen board geladen.")
    return
  }

  const title = state.inputTitle.value.trim()
  const description = state.inputDescription.value.trim()
  const dueDate = fromDateInputValue(state.inputDeadline.value)

  if (!title) {
    window.alert("Titel is verplicht.")
    return
  }

  try {
    if (state.mode === "edit" && state.editingCardId) {
      const cardId = state.editingCardId
      const cardRef = doc(db, COL_CARDS, cardId)
      const updateData = {
        title,
        description,
        updatedAt: serverTimestamp()
      }
      if (dueDate) {
        updateData.dueDate = dueDate
      } else {
        updateData.dueDate = null
      }
      await updateDoc(cardRef, updateData)
    } else {
      if (!state.backlogColumnId) {
        window.alert("Geen Backlog kolom gevonden.")
        return
      }
      const cardsRef = collection(db, COL_CARDS)
      const sortValue = getNextSortValueForBacklog()
      const newCard = {
        boardId: state.boardId,
        columnId: state.backlogColumnId,
        uid: state.uid,
        title,
        description,
        tags: [],
        sort: sortValue,
        status: "Backlog",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        dueDate: dueDate || null
      }
      await addDoc(cardsRef, newCard)
    }

    await reloadBoard()
    closeForm()
  } catch (err) {
    console.error("Fout bij opslaan kaart", err)
    window.alert("Er ging iets mis bij het opslaan van de kaart.")
  }
}

async function handleDeleteCard() {
  if (state.mode !== "edit" || !state.editingCardId) {
    return
  }
  const ok = window.confirm("Kaart verwijderen?")
  if (!ok) return

  try {
    const cardRef = doc(db, COL_CARDS, state.editingCardId)
    await deleteDoc(cardRef)
    await reloadBoard()
    closeForm()
  } catch (err) {
    console.error("Fout bij verwijderen kaart", err)
    window.alert("Er ging iets mis bij het verwijderen van de kaart.")
  }
}

// Board laden

async function reloadBoard() {
  if (!state.uid || !state.boardId) return

  setBoardMessage("Board wordt geladen...")

  const [columns, cards] = await Promise.all([
    fetchColumnsOrCreateDefaults(state.boardId, state.uid),
    fetchCards(state.boardId, state.uid)
  ])

  state.columns = columns
  state.columnsById = new Map()
  columns.forEach(col => {
    state.columnsById.set(col.id, col)
  })

  state.cardsById = new Map()
  cards.forEach(card => {
    state.cardsById.set(card.id, card)
  })

  const backlogCol =
    columns.find(c => c.title === "Backlog") || columns[0] || null
  state.backlogColumnId = backlogCol ? backlogCol.id : null

  const merged = mergeColumnsAndCards(columns, cards)
  renderBoard(merged)
}

// Drag & drop helpers

function clearDropHighlights() {
  const roots = document.querySelectorAll(".wf-column-cards.wf-drop-target")
  roots.forEach(el => el.classList.remove("wf-drop-target"))
}

function highlightDropTarget(columnCardsEl) {
  clearDropHighlights()
  if (columnCardsEl) {
    columnCardsEl.classList.add("wf-drop-target")
  }
}

async function moveCardToColumn(cardId, newColumnId) {
  if (!state.cardsById.has(cardId)) return
  const card = state.cardsById.get(cardId)
  if (card.columnId === newColumnId) return

  const sortValue = getNextSortValueForColumn(newColumnId)
  const col = state.columnsById.get(newColumnId)
  const newStatus = col ? col.title || null : null

  try {
    const cardRef = doc(db, COL_CARDS, cardId)
    const updateData = {
      columnId: newColumnId,
      sort: sortValue,
      updatedAt: serverTimestamp()
    }
    if (newStatus) {
      updateData.status = newStatus
    }
    await updateDoc(cardRef, updateData)
    await reloadBoard()
  } catch (err) {
    console.error("Fout bij verplaatsen kaart", err)
    window.alert("Er ging iets mis bij het verplaatsen van de kaart.")
  }
}

function onDragStart(event) {
  const cardEl = event.target.closest(".wf-card")
  if (!cardEl) return
  const cardId = cardEl.getAttribute("data-card-id")
  if (!cardId) return

  state.draggingCardId = cardId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", cardId)
  }
}

function onDragEnd() {
  state.draggingCardId = null
  clearDropHighlights()
}

function onDragOver(event) {
  if (!state.draggingCardId) return

  const container = event.target.closest(".wf-column-cards, .wf-column")
  if (!container) return

  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move"
  }

  let columnCardsEl = container
  if (columnCardsEl.classList.contains("wf-column")) {
    columnCardsEl = columnCardsEl.querySelector(".wf-column-cards")
  }
  if (!columnCardsEl) return

  highlightDropTarget(columnCardsEl)
}

function onDrop(event) {
  if (!state.draggingCardId) return

  const container = event.target.closest(".wf-column-cards, .wf-column")
  if (!container) return

  event.preventDefault()

  let columnCardsEl = container
  if (columnCardsEl.classList.contains("wf-column")) {
    columnCardsEl = columnCardsEl.querySelector(".wf-column-cards")
  }
  if (!columnCardsEl) return

  const newColumnId = columnCardsEl.dataset.columnId
  const cardId = state.draggingCardId

  state.draggingCardId = null
  clearDropHighlights()

  if (!newColumnId || !cardId) return

  moveCardToColumn(cardId, newColumnId)
}

function setupDragAndDropHandlers() {
  const root = getBoardRoot()
  if (!root) return

  root.addEventListener("dragstart", onDragStart)
  root.addEventListener("dragend", onDragEnd)
  root.addEventListener("dragover", onDragOver)
  root.addEventListener("drop", onDrop)
}

// Kaart klik handler

function setupCardClickHandler() {
  const root = getBoardRoot()
  if (!root) return

  root.addEventListener("click", event => {
    const cardEl = event.target.closest(".wf-card")
    if (!cardEl) return
    const cardId = cardEl.getAttribute("data-card-id")
    if (!cardId) return
    openEditForm(cardId)
  })
}

// Init

function initWorkflowBoard() {
  const root = getBoardRoot()
  if (!root) {
    console.warn("workflow-board element niet gevonden in DOM")
    return
  }

  buildToolbarAndForm()
  setupCardClickHandler()
  setupDragAndDropHandlers()

  setBoardMessage("Board wordt geladen...")

  onAuthStateChanged(auth, user => {
    if (!user) {
      setBoardMessage("Meld je aan om het workflow board te zien.")
      return
    }

    state.uid = user.uid

    loadAndRenderBoardForUser(user.uid).catch(err => {
      console.error("Fout bij laden workflow board", err)
      setBoardMessage("Er ging iets mis bij het laden van het board.")
    })
  })
}

async function loadAndRenderBoardForUser(uid) {
  setBoardMessage("Board wordt geladen...")

  const board = await getOrCreateDefaultBoard(uid)
  if (!board) {
    setBoardMessage("Nog geen workflow board gevonden.")
    return
  }

  state.boardId = board.id
  await reloadBoard()
}

document.addEventListener("DOMContentLoaded", initWorkflowBoard)
