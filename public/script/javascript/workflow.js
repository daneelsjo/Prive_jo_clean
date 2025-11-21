import {
getFirebaseApp,
getFirestore,
collection,
query,
where,
getDocs,
getAuth,
onAuthStateChanged
} from "./firebase-config.js";

// App, DB en Auth initialiseren (pakt automatisch DEV of MAIN)
const app = getFirebaseApp();
const db = getFirestore(app);
const auth = getAuth(app);

// Collectie namen
const COL_BOARDS = "workflowBoards";
const COL_COLUMNS = "workflowColumns";
const COL_CARDS = "workflowCards";

// Helpers voor DOM

function getBoardRoot() {
return document.getElementById("workflow-board");
}

function setBoardMessage(text) {
const root = getBoardRoot();
if (!root) return;

root.innerHTML = "";

const p = document.createElement("p");
p.textContent = text;
p.style.opacity = "0.8";
p.style.padding = "0.5rem 0";

root.appendChild(p);
}

// Render functies

function renderBoard(columns) {
const root = getBoardRoot();
if (!root) return;

root.innerHTML = "";

if (!columns || !columns.length) {
setBoardMessage("Geen kolommen gevonden voor dit board.");
return;
}

columns.forEach(col => {
const colEl = document.createElement("div");
colEl.className = "wf-column";
const header = document.createElement("header");
header.className = "wf-column-header";

const titleEl = document.createElement("h2");
titleEl.className = "wf-column-title";
titleEl.textContent = col.title || "(zonder titel)";

const countEl = document.createElement("span");
countEl.className = "wf-column-count";
const cards = col.cards || [];
countEl.textContent = String(cards.length);

header.appendChild(titleEl);
header.appendChild(countEl);
colEl.appendChild(header);

const listEl = document.createElement("div");
listEl.className = "wf-column-cards";

cards.forEach(card => {
  const cardEl = document.createElement("article");
  cardEl.className = "wf-card";
  cardEl.setAttribute("data-card-id", card.id);
  cardEl.textContent = card.title || "(zonder titel)";
  listEl.appendChild(cardEl);
});

colEl.appendChild(listEl);
root.appendChild(colEl);
});
}

// Firestore helpers

async function fetchDefaultBoard(uid) {
const boardsRef = collection(db, COL_BOARDS);

// Eerst zoeken naar isDefault == true
const qDefault = query(
boardsRef,
where("uid", "==", uid),
where("isDefault", "==", true)
);

const snapDefault = await getDocs(qDefault);
if (!snapDefault.empty) {
const doc = snapDefault.docs[0];
return { id: doc.id, ...doc.data() };
}

// Zo niet, pak eerste board van deze user
const qFirst = query(
boardsRef,
where("uid", "==", uid)
);

const snapFirst = await getDocs(qFirst);
if (!snapFirst.empty) {
const doc = snapFirst.docs[0];
return { id: doc.id, ...doc.data() };
}

return null;
}

async function fetchColumns(boardId) {
const columnsRef = collection(db, COL_COLUMNS);
const qCols = query(
columnsRef,
where("boardId", "==", boardId)
);

const snap = await getDocs(qCols);

const cols = snap.docs.map(doc => ({
id: doc.id,
...doc.data()
}));

// Sorteren op veld "order" uit het model
cols.sort((a, b) => {
const aOrder = typeof a.order === "number" ? a.order : 0;
const bOrder = typeof b.order === "number" ? b.order : 0;
return aOrder - bOrder;
});

return cols;
}

async function fetchCards(boardId) {
const cardsRef = collection(db, COL_CARDS);
const qCards = query(
cardsRef,
where("boardId", "==", boardId)
);

const snap = await getDocs(qCards);

const cards = snap.docs.map(doc => ({
id: doc.id,
...doc.data()
}));

// Sorteren op veld "sort" uit het model
cards.sort((a, b) => {
const aSort = typeof a.sort === "number" ? a.sort : 0;
const bSort = typeof b.sort === "number" ? b.sort : 0;
return aSort - bSort;
});

return cards;
}

function mergeColumnsAndCards(columns, cards) {
const byColumnId = {};

columns.forEach(col => {
byColumnId[col.id] = [];
});

cards.forEach(card => {
const colId = card.columnId;
if (!colId) return;
if (!byColumnId[colId]) {
  byColumnId[colId] = [];
}

byColumnId[colId].push(card);
});

return columns.map(col => ({
id: col.id,
title: col.title,
cards: byColumnId[col.id] || []
}));
}

async function loadAndRenderBoardForUser(uid) {
setBoardMessage("Board wordt geladen...");

const board = await fetchDefaultBoard(uid);
if (!board) {
setBoardMessage("Nog geen workflow board gevonden voor deze gebruiker.");
return;
}

const [columns, cards] = await Promise.all([
fetchColumns(board.id),
fetchCards(board.id)
]);

const merged = mergeColumnsAndCards(columns, cards);
renderBoard(merged);
}

// Initialisatie

function initWorkflowBoard() {
const root = getBoardRoot();
if (!root) {
console.warn("workflow-board element niet gevonden in DOM");
return;
}

setBoardMessage("Board wordt geladen...");

onAuthStateChanged(auth, user => {
if (!user) {
setBoardMessage("Meld je aan om het workflow board te zien.");
return;
}
loadAndRenderBoardForUser(user.uid).catch(err => {
  console.error("Fout bij laden workflow board", err);
  setBoardMessage("Er ging iets mis bij het laden van het board.");
});
});
}

document.addEventListener("DOMContentLoaded", initWorkflowBoard); 