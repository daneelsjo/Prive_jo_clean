// Workflow board met Firestore (CRUD kaarten, drag & drop,
// tagbeheer per board + per kaart via detail-modal)

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

// Firestore setup
const app = getFirebaseApp()
const db = getFirestore(app)
const auth = getAuth(app)

// Collectie namen
const COL_BOARDS = "workflowBoards"
const COL_COLUMNS = "workflowColumns"
const COL_CARDS = "workflowCards"
const COL_TAGS = "workflowTags"

// Vaste kolommen
const DEFAULT_COLUMNS = [
  { key: "backlog",     title: "Backlog",     order: 1 },
  { key: "to-discuss",  title: "Te bespreken", order: 2 },
  { key: "in-progress", title: "In progress", order: 3 },
  { key: "done",        title: "Afgewerkt",   order: 4 }
]

// Vaste prioriteitstags
const PRIORITY_TAGS = [
  { key: "priority-low",      name: "Low",      color: "#16a34a" },
  { key: "priority-normal",   name: "Normal",   color: "#2563eb" },
  { key: "priority-high",     name: "High",     color: "#f97316" },
  { key: "priority-critical", name: "Critical", color: "#dc2626" }
]

// State
const state = {
  uid: null,
  boardId: null,
  columns: [],
  columnsById: new Map(),
  cardsById: new Map(),
  backlogColumnId: null,

  // Tags
  tags: [],
  tagsById: new Map(),

  // Kaartformulier (detail)
  formSectionEl: null,
  formEl: null,
  mode: "create",
  editingCardId: null,
  inputTitle: null,
  inputDeadline: null,
  inputDescription: null,
  btnDelete: null,

  // Tag UI in formulier
  formTagsChipsEl: null,
  formTagsPanelEl: null,
  formTagsListEl: null,
  cardTagsWorkingSet: null,

  // Tagbeheer (board)
  tagsModalEl: null,
  tagsListEl: null,

  // Drag
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

// Tags ophalen en vaste prioriteiten garanderen
async function fetchAndEnsureTags(boardId, uid) {
  const tagsRef = collection(db, COL_TAGS)
  const baseQuery = query(
    tagsRef,
    where("boardId", "==", boardId),
    where("uid", "==", uid)
  )

  let snap = await getDocs(baseQuery)
  let tags = snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }))

  const existingNames = new Set(tags.map(t => String(t.name || "")))

  const writes = []
  for (const p of PRIORITY_TAGS) {
    if (!existingNames.has(p.name)) {
      writes.push(
        addDoc(tagsRef, {
          boardId,
          uid,
          name: p.name,
          color: p.color,
          active: true,
          builtin: true,
          builtinKey: p.key,
          note: "",
          createdAt: serverTimestamp()
        })
      )
    }
  }

  if (writes.length > 0) {
    await Promise.all(writes)
    snap = await getDocs(baseQuery)
    tags = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }))
  }

  tags.sort((a, b) => {
    const aName = String(a.name || "").toLowerCase()
    const bName = String(b.name || "").toLowerCase()
    if (aName < bName) return -1
    if (aName > bName) return 1
    return 0
  })

  return tags
}

// Kolommen en kaarten samenvoegen
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

// Tag chip helper
function buildTagChip(tag) {
  const chip = document.createElement("span")
  chip.className = "wf-tag-chip"

  const dot = document.createElement("span")
  dot.className = "wf-tag-chip-color wf-tag-color"
  dot.style.backgroundColor = tag.color || "#64748b"

  const label = document.createElement("span")
  label.className = "wf-tag-chip-label"
  label.textContent = tag.name || ""

  chip.appendChild(dot)
  chip.appendChild(label)
  return chip
}

// Board renderen
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

      const cardTags = Array.isArray(card.tags) ? card.tags : []
      if (cardTags.length > 0 && state.tagsById && state.tagsById.size > 0) {
        const chipsRow = document.createElement("div")
        chipsRow.className = "wf-card-tags-chips"
        cardTags.forEach(tagId => {
          const tag = state.tagsById.get(tagId)
          if (!tag) return
          chipsRow.appendChild(buildTagChip(tag))
        })
        if (chipsRow.childNodes.length > 0) {
          cardEl.appendChild(chipsRow)
        }
      }

      listEl.appendChild(cardEl)
    })

    colEl.appendChild(listEl)
    root.appendChild(colEl)
  })
}

// Datum helpers
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
  return year + "-" + month + "-" + day
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

// Toolbar en modals opbouwen
function buildToolbarAndModals() {
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

  const tagsBtn = document.createElement("button")
  tagsBtn.type = "button"
  tagsBtn.className = "wf-btn wf-btn-secondary"
  tagsBtn.textContent = "Tags beheren"
  tagsBtn.addEventListener("click", () => {
    openTagsModal()
  })

  toolbar.appendChild(newBtn)
  toolbar.appendChild(tagsBtn)

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

  const tagsGroup = document.createElement("div")
  tagsGroup.className = "wf-form-group wf-form-group-tags"

  const tagsHeader = document.createElement("div")
  tagsHeader.className = "wf-form-tags-header"

  const tagsLabel = document.createElement("span")
  tagsLabel.textContent = "Tags"

  const tagsToggleBtn = document.createElement("button")
  tagsToggleBtn.type = "button"
  tagsToggleBtn.className = "wf-btn wf-btn-small"
  tagsToggleBtn.textContent = "🏷️ Tags wijzigen"

  const tagsChips = document.createElement("div")
  tagsChips.className = "wf-form-tags-chips"

  const tagsPanel = document.createElement("div")
  tagsPanel.className = "wf-form-tags-panel wf-form-tags-panel--hidden"

  const tagsList = document.createElement("div")
  tagsList.className = "wf-form-tags-list"

  tagsPanel.appendChild(tagsList)

  tagsHeader.appendChild(tagsLabel)
  tagsHeader.appendChild(tagsToggleBtn)

  tagsGroup.appendChild(tagsHeader)
  tagsGroup.appendChild(tagsChips)
  tagsGroup.appendChild(tagsPanel)

  tagsToggleBtn.addEventListener("click", () => {
    tagsPanel.classList.toggle("wf-form-tags-panel--hidden")
  })

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
  form.appendChild(tagsGroup)
  form.appendChild(actions)

  formSection.appendChild(form)

  form.addEventListener("submit", handleFormSubmit)
  cancelBtn.addEventListener("click", () => {
    closeForm()
  })
  deleteBtn.addEventListener("click", handleDeleteCard)

  const tagsSection = document.createElement("section")
  tagsSection.className = "wf-card-form wf-card-form--hidden"

  const tagsInner = document.createElement("div")
  tagsInner.className = "wf-card-form-inner"

  const tagsTitle = document.createElement("h2")
  tagsTitle.textContent = "Tags beheren"

  const tagsInfo = document.createElement("p")
  tagsInfo.textContent =
    "Vaste prioriteitstags kunnen niet uitgezet worden. Je kunt extra tags aanmaken en tags actief of inactief zetten."

  const tagsListBoard = document.createElement("div")
  tagsListBoard.className = "wf-tags-list"

  const tagsActions = document.createElement("div")
  tagsActions.className = "wf-card-form-actions"

  const newTagBtn = document.createElement("button")
  newTagBtn.type = "button"
  newTagBtn.className = "wf-btn wf-btn-primary"
  newTagBtn.textContent = "Nieuwe tag"
  newTagBtn.addEventListener("click", () => {
    handleNewTag()
  })

  const tagsCloseBtn = document.createElement("button")
  tagsCloseBtn.type = "button"
  tagsCloseBtn.className = "wf-btn wf-btn-secondary"
  tagsCloseBtn.textContent = "Sluiten"
  tagsCloseBtn.addEventListener("click", () => {
    closeTagsModal()
  })

  tagsActions.appendChild(newTagBtn)
  tagsActions.appendChild(tagsCloseBtn)

  tagsInner.appendChild(tagsTitle)
  tagsInner.appendChild(tagsInfo)
  tagsInner.appendChild(tagsListBoard)
  tagsInner.appendChild(tagsActions)
  tagsSection.appendChild(tagsInner)

  tagsSection.addEventListener("click", event => {
    if (event.target === tagsSection) {
      closeTagsModal()
    }
  })

  content.insertBefore(toolbar, boardSection)
  content.insertBefore(formSection, boardSection)
  content.insertBefore(tagsSection, boardSection)

  state.formSectionEl = formSection
  state.formEl = form
  state.inputTitle = inputTitle
  state.inputDeadline = inputDeadline
  state.inputDescription = inputDescription
  state.btnDelete = deleteBtn

  state.formTagsChipsEl = tagsChips
  state.formTagsPanelEl = tagsPanel
  state.formTagsListEl = tagsList

  state.tagsModalEl = tagsSection
  state.tagsListEl = tagsListBoard
}

// Tags in formulier renderen
function renderFormTagsArea() {
  const chipsEl = state.formTagsChipsEl
  const listEl = state.formTagsListEl
  if (!chipsEl || !listEl) return

  chipsEl.innerHTML = ""
  listEl.innerHTML = ""

  const working = state.cardTagsWorkingSet || new Set()
  const tags = state.tags || []

  if (working.size === 0) {
    const span = document.createElement("span")
    span.textContent = "Geen tags gekoppeld."
    span.style.opacity = "0.8"
    chipsEl.appendChild(span)
  } else {
    working.forEach(tagId => {
      const tag = state.tagsById.get(tagId)
      if (!tag) return
      chipsEl.appendChild(buildTagChip(tag))
    })
  }

  if (!tags.length) {
    const p = document.createElement("p")
    p.textContent = "Nog geen tags beschikbaar."
    p.style.opacity = "0.8"
    listEl.appendChild(p)
    return
  }

  tags.forEach(tag => {
    const row = document.createElement("label")
    row.className = "wf-card-tag-option"

    const input = document.createElement("input")
    input.type = "checkbox"
    input.checked = working.has(tag.id)

    const colorDot = document.createElement("span")
    colorDot.className = "wf-tag-color"
    colorDot.style.backgroundColor = tag.color || "#64748b"

    const nameSpan = document.createElement("span")
    nameSpan.className = "wf-tag-name"
    nameSpan.textContent = tag.name || ""
    if (tag.note) {
      nameSpan.title = tag.note
    }

    input.addEventListener("change", () => {
      if (!state.cardTagsWorkingSet) {
        state.cardTagsWorkingSet = new Set()
      }
      if (input.checked) {
        state.cardTagsWorkingSet.add(tag.id)
      } else {
        state.cardTagsWorkingSet.delete(tag.id)
      }
      updateFormTagsChipsOnly()
    })

    row.appendChild(input)
    row.appendChild(colorDot)
    row.appendChild(nameSpan)

    listEl.appendChild(row)
  })
}

function updateFormTagsChipsOnly() {
  const chipsEl = state.formTagsChipsEl
  if (!chipsEl) return

  chipsEl.innerHTML = ""
  const working = state.cardTagsWorkingSet || new Set()
  if (working.size === 0) {
    const span = document.createElement("span")
    span.textContent = "Geen tags gekoppeld."
    span.style.opacity = "0.8"
    chipsEl.appendChild(span)
    return
  }

  working.forEach(tagId => {
    const tag = state.tagsById.get(tagId)
    if (!tag) return
    chipsEl.appendChild(buildTagChip(tag))
  })
}

// Kaartformulier open/dicht
function openCreateForm() {
  if (!state.formSectionEl) return
  closeTagsModal()

  state.mode = "create"
  state.editingCardId = null
  state.inputTitle.value = ""
  state.inputDeadline.value = ""
  state.inputDescription.value = ""
  state.btnDelete.style.display = "none"
  state.cardTagsWorkingSet = new Set()

  if (state.formTagsPanelEl) {
    state.formTagsPanelEl.classList.add("wf-form-tags-panel--hidden")
  }

  renderFormTagsArea()
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

  closeTagsModal()

  state.mode = "edit"
  state.editingCardId = cardId

  state.inputTitle.value = card.title || ""
  state.inputDeadline.value = toDateInputValue(card.dueDate)
  state.inputDescription.value = card.description || ""
  state.btnDelete.style.display = "inline-block"

  const currentTags = Array.isArray(card.tags) ? card.tags : []
  state.cardTagsWorkingSet = new Set(currentTags)

  if (state.formTagsPanelEl) {
    state.formTagsPanelEl.classList.add("wf-form-tags-panel--hidden")
  }

  renderFormTagsArea()
  state.formSectionEl.classList.remove("wf-card-form--hidden")
  state.inputTitle.focus()
}

function closeForm() {
  if (!state.formSectionEl) return
  state.formSectionEl.classList.add("wf-card-form--hidden")
  state.mode = "create"
  state.editingCardId = null
  state.cardTagsWorkingSet = null
}

// Tagbeheer (board)
function openTagsModal() {
  if (!state.tagsModalEl) return
  closeForm()
  state.tagsModalEl.classList.remove("wf-card-form--hidden")
  reloadTags().catch(err => {
    console.error("Fout bij laden tags", err)
  })
}

function closeTagsModal() {
  if (!state.tagsModalEl) return
  state.tagsModalEl.classList.add("wf-card-form--hidden")
}

// Tags lijst in board tagbeheer
function renderTagsList() {
  if (!state.tagsListEl) return

  const container = state.tagsListEl
  container.innerHTML = ""

  if (!state.tags || state.tags.length === 0) {
    const p = document.createElement("p")
    p.textContent = "Geen tags gevonden."
    p.style.opacity = "0.8"
    container.appendChild(p)
    return
  }

  state.tags.forEach(tag => {
    const row = document.createElement("div")
    row.className = "wf-tag-row"
    row.dataset.tagId = tag.id

    const noteText = tag.note ? String(tag.note) : ""

    const colorSwatch = document.createElement("span")
    colorSwatch.className = "wf-tag-color"
    colorSwatch.style.backgroundColor = tag.color || "#64748b"
    if (noteText) {
      colorSwatch.title = noteText
    }

    const nameEl = document.createElement("span")
    nameEl.className = "wf-tag-name"
    nameEl.textContent = tag.name || ""
    if (noteText) {
      nameEl.title = noteText
    }

    const toggleLabel = document.createElement("label")
    toggleLabel.className = "wf-tag-toggle"

    const toggleInput = document.createElement("input")
    toggleInput.type = "checkbox"
    toggleInput.className = "wf-tag-toggle-input"

    const toggleSlider = document.createElement("span")
    toggleSlider.className = "wf-tag-toggle-slider"

    const isBuiltin = !!tag.builtin

    if (isBuiltin) {
      toggleInput.checked = true
      toggleInput.disabled = true
      toggleLabel.classList.add("wf-tag-toggle-disabled")
    } else {
      toggleInput.checked = !!tag.active
      toggleInput.addEventListener("change", () => {
        handleTagActiveChange(tag.id, toggleInput.checked)
      })
    }

    toggleLabel.appendChild(toggleInput)
    toggleLabel.appendChild(toggleSlider)

    row.appendChild(colorSwatch)
    row.appendChild(nameEl)
    row.appendChild(toggleLabel)

    container.appendChild(row)
  })
}

// Nieuwe tag in board tagbeheer
async function handleNewTag() {
  if (!state.uid || !state.boardId) {
    window.alert("Geen board geladen.")
    return
  }

  const name = window.prompt("Naam van de nieuwe tag")
  if (name === null) return
  const trimmedName = name.trim()
  if (!trimmedName) {
    window.alert("Naam is verplicht.")
    return
  }

  const defaultColor = "#64748b"
  let color = window.prompt(
    "Kleur in hex formaat, bijvoorbeeld #64748b",
    defaultColor
  )
  if (color === null) return
  color = color.trim()
  if (!color) {
    color = defaultColor
  }

  const note = window.prompt("Korte opmerking (optioneel)", "") || ""

  try {
    const tagsRef = collection(db, COL_TAGS)
    await addDoc(tagsRef, {
      boardId: state.boardId,
      uid: state.uid,
      name: trimmedName,
      color,
      active: true,
      builtin: false,
      builtinKey: null,
      note,
      createdAt: serverTimestamp()
    })
    await reloadTags()
  } catch (err) {
    console.error("Fout bij aanmaken tag", err)
    window.alert("Er ging iets mis bij het aanmaken van de tag.")
  }
}

// Toggle actief in board tagbeheer
async function handleTagActiveChange(tagId, newActive) {
  const tag = state.tagsById.get(tagId)
  if (!tag) return

  if (tag.builtin) {
    const input = findToggleInputForTag(tagId)
    if (input) {
      input.checked = true
    }
    return
  }

  if (!newActive) {
    const ok = window.confirm(
      'Tag "' +
        tag.name +
        '" inactief zetten? Bestaande kaarten houden deze tag, maar voor nieuw gebruik is ze dan uit.'
    )
    if (!ok) {
      const input = findToggleInputForTag(tagId)
      if (input) {
        input.checked = true
      }
      return
    }
  }

  try {
    const tagRef = doc(db, COL_TAGS, tagId)
    await updateDoc(tagRef, {
      active: newActive
    })
    await reloadTags()
  } catch (err) {
    console.error("Fout bij aanpassen tag active", err)
    window.alert("Er ging iets mis bij het aanpassen van de tag.")
  }
}

function findToggleInputForTag(tagId) {
  if (!state.tagsListEl) return null
  const selector = '.wf-tag-row[data-tag-id="' + tagId + '"]'
  const row = state.tagsListEl.querySelector(selector)
  if (!row) return null
  return row.querySelector(".wf-tag-toggle-input")
}

// Sort helpers
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

// Kaart opslaan
async function handleFormSubmit(event) {
  event.preventDefault()
  if (!state.uid || !state.boardId) {
    window.alert("Geen board geladen.")
    return
  }

  const title = state.inputTitle.value.trim()
  const description = state.inputDescription.value.trim()
  const dueDate = fromDateInputValue(state.inputDeadline.value)
  const workingTags = state.cardTagsWorkingSet || new Set()
  const tagsArray = Array.from(workingTags)

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
        tags: tagsArray,
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
        tags: tagsArray,
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

// Kaart verwijderen
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

// Board en tags herladen
async function reloadBoard() {
  if (!state.uid || !state.boardId) return

  setBoardMessage("Board wordt geladen...")

  const [columns, cards, tags] = await Promise.all([
    fetchColumnsOrCreateDefaults(state.boardId, state.uid),
    fetchCards(state.boardId, state.uid),
    fetchAndEnsureTags(state.boardId, state.uid)
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

  state.tags = tags
  state.tagsById = new Map()
  tags.forEach(tag => {
    state.tagsById.set(tag.id, tag)
  })

  const backlogCol =
    columns.find(c => c.title === "Backlog") || columns[0] || null
  state.backlogColumnId = backlogCol ? backlogCol.id : null

  const merged = mergeColumnsAndCards(columns, cards)
  renderBoard(merged)
  renderTagsList()

  if (
    state.formSectionEl &&
    !state.formSectionEl.classList.contains("wf-card-form--hidden")
  ) {
    renderFormTagsArea()
  }
}

async function reloadTags() {
  if (!state.uid || !state.boardId) return
  const tags = await fetchAndEnsureTags(state.boardId, state.uid)
  state.tags = tags
  state.tagsById = new Map()
  tags.forEach(tag => {
    state.tagsById.set(tag.id, tag)
  })
  renderTagsList()

  if (
    state.formSectionEl &&
    !state.formSectionEl.classList.contains("wf-card-form--hidden")
  ) {
    renderFormTagsArea()
  }
}

// Drag & drop
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

// Klik op kaart => detail openen
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

  buildToolbarAndModals()
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
