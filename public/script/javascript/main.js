// Script/Javascript/main.js
import {
  getFirebaseApp,
  // Auth
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged,
  // Firestore
  getFirestore, collection, addDoc, onSnapshot, doc, setDoc, updateDoc, deleteDoc,
  query, where
} from "./firebase-config.js";

/* ────────────────────────────────────────────────────────────────────────────
   Firebase init
   ──────────────────────────────────────────────────────────────────────────── */
const app = getFirebaseApp();
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Omgevingsklasse op body zetten: env-dev of env-main
if (window.APP_ENV === "DEV") {
  document.body.classList.add("env-dev");
} else {
  document.body.classList.add("env-main");
}

/* ────────────────────────────────────────────────────────────────────────────
   DOM refs
   ──────────────────────────────────────────────────────────────────────────── */
const loginBtn = document.getElementById("login-btn");
const authDiv = document.getElementById("auth");
const appDiv = document.getElementById("app");

const postitsEl = document.getElementById("postits");
const modeSwitch = document.getElementById("modeSwitch");

const newTaskBtn = document.getElementById("newTaskBtn");
const formContainer = document.getElementById("formContainer");
const addTodoBtn = document.getElementById("addTodo");

const toggleAllTasks = document.getElementById("toggleAllTasks");
const allTasksPanel = document.getElementById("allTasksPanel");
const allTasksSearch = document.getElementById("allTasksSearch");
const allTasksTable = document.getElementById("allTasksTable");

const categoryInput = document.getElementById("category");
let editingTaskId = null; // huidige bewerk-id (null = nieuwe taak)

/* ────────────────────────────────────────────────────────────────────────────
   Thema modus
   ──────────────────────────────────────────────────────────────────────────── */
function resolveTheme(mode) {
  if (!mode || mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}
function applyTheme(mode) {
  const final = resolveTheme(mode);
  document.documentElement.setAttribute("data-theme", final);
}

/* ────────────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────────────── */
function bindOnce(el, ev, fn) {
  if (!el) return;
  const key = `__bound_${ev}`;
  if (el[key]) return;
  el.addEventListener(ev, fn);
  el[key] = true;
}

function tsToDate(x) {
  if (!x) return null;
  if (x instanceof Date) return x;
  if (typeof x === "string") return new Date(x);
  if (typeof x === "number") return new Date(x);
  if (x.seconds) return new Date(x.seconds * 1000); // Firestore Timestamp
  return null;
}
function dateVal(x) { const d = tsToDate(x); return d ? d.getTime() : Number.POSITIVE_INFINITY; }
function formatDate(v) { const d = tsToDate(v); return d ? d.toLocaleDateString("nl-BE") : ""; }

function getContrast(hex) {
  const r = parseInt(hex.substr(1, 2), 16);
  const g = parseInt(hex.substr(3, 2), 16);
  const b = parseInt(hex.substr(5, 2), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "#000" : "#fff";
}
function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// 0 = GEEN, 1 = HOOG, 2 = GEMIDDELD, 3 = LAAG
function prioColor(p = 0) {
  const map = {
    0: "#ffffff", // geen prio (wit)
    1: "#ef4444", // hoog (rood)
    2: "#f59e0b", // gemiddeld (oranje)
    3: "#22c55e"  // laag (groen)
  };
  return map[p] ?? map[0];
}

// Klein getal = hogere prio → geef HOOG de hoogste 'rank' om aflopend te sorteren
function prioRank(p) {
  // HOOG (1) → 3, GEM (2) → 2, LAAG (3) → 1, GEEN (0/overig) → 0
  const map = { 1: 3, 2: 2, 3: 1, 0: 0 };
  return map[p] ?? 0;
}



/* ────────────────────────────────────────────────────────────────────────────
   Data (runtime state)
   ──────────────────────────────────────────────────────────────────────────── */
let currentUser = null;

let settings = {
  modeSlots: { werk: Array(6).fill({}), prive: Array(6).fill({}) },
  preferredMode: "werk",
};
let currentMode = "werk";

let categories = []; // {id,name,type,color,active}
let todos = []; // {id,title,done,categoryId,uid,createdAt,...}

const fixedColors = [
  "#FFEB3B", "#F44336", "#4CAF50", "#2196F3", "#E91E63",
  "#9C27B0", "#673AB7", "#3F51B5", "#00BCD4", "#009688",
  "#8BC34A", "#CDDC39", "#FFC107", "#FF9800", "#795548"
];

/* ────────────────────────────────────────────────────────────────────────────
   Modal helpers
   ──────────────────────────────────────────────────────────────────────────── */
function fillBothCategoryLists() {
  const fill = (el) => {
    if (!el) return;
    el.innerHTML = "";
    categories.forEach(c => {
      const opt = document.createElement("option");
      opt.value = `${c.name} (${c.type})`;
      el.appendChild(opt);
    });
  };
  fill(document.getElementById("categoryList"));        // (oude formulier; mag ontbreken)
  fill(document.getElementById("task-category-list"));  // modal datalist
}

function parseCategory(txt) {
  // verwacht "Naam (werk)" of "Naam (prive)"
  const m = txt.match(/^\s*(.+?)\s*\((werk|prive)\)\s*$/i);
  if (!m) return null;
  return { name: m[1].toLowerCase(), type: m[2].toLowerCase() };
}

// Open de taakmodal (create of edit)
function openTaskModal(mode = "create", task = null) {
  const isEdit = mode === "edit" && task;

  // velden vullen
  document.getElementById("task-title").value = isEdit ? (task.title || "") : "";
  document.getElementById("task-start").value = isEdit && task.startDate ? formatDateForInput(task.startDate) : "";
  document.getElementById("task-end").value = isEdit && task.endDate ? formatDateForInput(task.endDate) : "";
  document.getElementById("task-priority").value = isEdit ? String(task.priority ?? 0) : "0";
  document.getElementById("task-category-input").value = isEdit && task.categoryId
    ? (() => { const c = categories.find(x => x.id === task.categoryId); return c ? `${c.name} (${c.type})` : ""; })()
    : "";
  document.getElementById("task-desc").value = isEdit ? (task.description || "") : "";
  document.getElementById("task-link").value = isEdit ? (task.link || "") : "";

  // knoppen tonen/verbergen
  const delBtn = document.getElementById("task-delete");
  const doneBtn = document.getElementById("task-toggle-done");
  if (delBtn) delBtn.style.display = isEdit ? "inline-flex" : "none";
  if (doneBtn) {
    doneBtn.style.display = isEdit ? "inline-flex" : "none";
    if (isEdit) doneBtn.textContent = task.done ? "Heropenen" : "Voltooien";
  }

  editingTaskId = isEdit ? task.id : null;
  Modal.open("modal-task");
}
function formatDateForInput(v) {
  const d = tsToDate(v);
  return d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : "";
}

/* ────────────────────────────────────────────────────────────────────────────
   Auth
   ──────────────────────────────────────────────────────────────────────────── */
if (loginBtn) {
loginBtn.addEventListener("click", async () => {
try {
const res = await signInWithPopup(auth, provider);
console.log("Signed in:", res.user?.uid);
} catch (e) {
console.error("Auth error:", e);
alert("Login fout: " + (e.code || e.message));
}
});
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const ownerUid = "KNjbJuZV1MZMEUQKsViehVhW3832"; // <-- jouw UID

  // ✔ Iedereen die niet de eigenaar is, blijft op plan.html
  if (user.uid !== ownerUid && !location.pathname.endsWith("/plan.html")) {
    location.replace("../HTML/plan.html");
    return;
  }


  currentUser = user;
  if (authDiv) authDiv.style.display = "none";
  if (appDiv) appDiv.style.display = "block";

  // settings
  onSnapshot(doc(db, "settings", currentUser.uid), (snap) => {
    settings = snap.exists() ? (snap.data() || {}) : {};

    // thema toepassen + cachen
    const themePref = settings.theme || "system";
    applyTheme(themePref);
    try { localStorage.setItem("theme_pref", themePref); } catch { }

    if (!settings.modeSlots) {
      settings.modeSlots = { werk: Array(6).fill({}), prive: Array(6).fill({}) };
    }
    currentMode = settings.preferredMode || "werk";
    if (modeSwitch) modeSwitch.checked = (currentMode === "prive");
    renderAll();
  });


  // categories
  onSnapshot(collection(db, "categories"), (snap) => {
    categories = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.active !== false);
    fillBothCategoryLists();
    renderAll();
  });

  // todos (alleen eigen items)
  const qTodos = query(collection(db, "todos"), where("uid", "==", currentUser.uid));
  onSnapshot(qTodos, (snap) => {
    todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // sorteer op createdAt
    todos.sort((a, b) => {
      const ta = a.createdAt ? dateVal(a.createdAt) : 0;
      const tb = b.createdAt ? dateVal(b.createdAt) : 0;
      return ta - tb;
    });
    renderAll();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   UI handlers
   ──────────────────────────────────────────────────────────────────────────── */
if (modeSwitch) {
  modeSwitch.onchange = async () => {
    currentMode = modeSwitch.checked ? "prive" : "werk";
    if (currentUser) {
      await setDoc(doc(db, "settings", currentUser.uid), { preferredMode: currentMode }, { merge: true });
    }
    renderAll();
  };
}

// rechterpaneel togglen
if (toggleAllTasks) {
  toggleAllTasks.onclick = () => {
    const open = allTasksPanel.hidden;          // was verborgen? dan openen
    allTasksPanel.hidden = !open;
    allTasksSearch.style.display = open ? "inline-block" : "none";
    if (open) renderAllTasksTable();            // veilig, bouwt thead/tbody zelf
  };
}

if (allTasksSearch) {
  allTasksSearch.oninput = () => renderAllTasksTable();
}

/* Oud formulier (optioneel) intact laten */
if (addTodoBtn) {
  addTodoBtn.onclick = async () => {
    const title = (document.getElementById("name").value || "").trim();
    const start = document.getElementById("start").value;
    const end = document.getElementById("end").value;
    const prio = parseInt(document.getElementById("priority").value || "0", 10);
    const catTxt = (categoryInput?.value || "").trim();
    const desc = (document.getElementById("description").value || "").trim();
    const link = (document.getElementById("link").value || "").trim();

    if (!title) { Modal.alert({ title: "Taak", html: "Geef een taaknaam op." }); return; }

    const catMatch = parseCategory(catTxt);
    const catDoc = catMatch
      ? categories.find(c => c.name.toLowerCase() === catMatch.name && c.type === catMatch.type)
      : null;

    await addDoc(collection(db, "todos"), {
      title, description: desc, link,
      startDate: start ? new Date(start) : null,
      endDate: end ? new Date(end) : null,
      priority: prio,
      categoryId: catDoc?.id || null,
      uid: currentUser?.uid || null,
      createdAt: new Date(),
      done: false
    });

    // reset
    document.getElementById("name").value = "";
    document.getElementById("start").value = "";
    document.getElementById("end").value = "";
    document.getElementById("priority").value = "0";
    if (categoryInput) categoryInput.value = "";
    document.getElementById("description").value = "";
    document.getElementById("link").value = "";
    if (formContainer) formContainer.style.display = "none";
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   Rendering
   ──────────────────────────────────────────────────────────────────────────── */
function renderAll() {
  renderPostits();
  renderAllTasksTable();
}

function renderPostits() {
  if (!postitsEl) return;
  postitsEl.innerHTML = "";

  const slots = (settings.modeSlots?.[currentMode] || Array(6).fill({})).slice(0, 6);

  // groepeer todos per categorie, voltooid overslaan
  const byCat = {};
  todos.forEach(t => {
    if (t.done) return;
    const cid = t.categoryId || "_none";
    (byCat[cid] ||= []).push(t);
  });

  for (let i = 0; i < 6; i++) {
    const slot = slots[i] || {};
    if (!slot.categoryId) continue;

    const cat = categories.find(c => c.id === slot.categoryId && c.type === currentMode);
    if (!cat) continue;

    const color = String((cat.color || fixedColors[i % fixedColors.length])).toUpperCase();
    const box = document.createElement("div");
    box.className = "postit";
    box.style.background = color;
    box.style.color = getContrast(color);
    box.innerHTML = `<div class="postit-head"><strong>${escapeHtml(cat.name)}</strong></div>`;

    (byCat[slot.categoryId] || []).forEach(todo => {
      box.appendChild(buildTaskRow(todo));
    });

    box.addEventListener("click", () => showPostit(cat, byCat[slot.categoryId] || []));
    postitsEl.appendChild(box);
  }

  // overige taken
  const unc = document.getElementById("uncategorized-list");
  if (unc) {
    unc.innerHTML = "";
    (byCat["_none"] || []).forEach(todo => {
      unc.appendChild(buildTaskRow(todo));
    });
  }
}

function buildTaskRow(todo) {
  const row = document.createElement("div");
  row.className = "task-row";
  row.innerHTML = `
    <span class="task-dot" style="--dot:${prioColor(todo.priority)}"></span>
    <div class="task-texts">
      <div class="task-title">${escapeHtml(todo.title || "(zonder titel)")}</div>
      ${todo.endDate ? `<div class="task-deadline">Deadline: ${formatDate(todo.endDate)}</div>` : ""}
    </div>
  `;
  row.onclick = (e) => {
    e.stopPropagation();
    openTaskModal("edit", todo);
  };
  return row;
}

function renderAllTasksTable() {
  const table = document.getElementById("allTasksTable");
  if (!table) return;

  // schoon leegmaken en altijd echte thead/tbody opbouwen
  while (table.firstChild) table.removeChild(table.firstChild);

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  ["Prio", "Taak", "Start", "Deadline", "Voltooid"].forEach(txt => {
    const th = document.createElement("th");
    if (txt === "Prio") th.className = "prio-cell";
    th.textContent = txt;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  let tbody = table.tBodies?.[0] || table.querySelector("tbody");
  if (!tbody) {
    tbody = document.createElement("tbody");
    table.appendChild(tbody);
  }

  const q = (document.getElementById("allTasksSearch")?.value || "").toLowerCase();

  // quick lookup op categorie
  const catById = Object.fromEntries(categories.map(c => [c.id, c]));

  // ✅ toon alleen taken waarvan de categorie bij de huidige modus hoort
  //    (tasks zonder categorie vallen buiten de tabel)
  const filtered = todos.filter(t => {
    const cat = catById[t.categoryId];
    if (!cat || cat.type !== currentMode) return false;
    const hay = ((t.title || "") + " " + (t.description || "")).toLowerCase();
    return q ? hay.includes(q) : true;
  });

  // groepeer per categorienaam
  const groups = new Map();
  for (const t of filtered) {
    const name = catById[t.categoryId]?.name || "— Geen categorie —";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(t);
  }

  const groupNames = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const g of groupNames) {
    const trGroup = document.createElement("tr");
    trGroup.className = "group-row";
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = g;
    trGroup.appendChild(td);
    tbody.appendChild(trGroup);

    const items = groups.get(g)
      .slice()
  // eerst HOOG(1) → GEM(2) → LAAG(3) → GEEN(0), daarna op vroegste deadline
  .sort((a, b) => prioRank(b.priority) - prioRank(a.priority) || dateVal(a.endDate) - dateVal(b.endDate));
    for (const t of items) {
      const tr = document.createElement("tr");
      tr.className = "task-tr";
      tr.dataset.id = t.id;

      const tdPrio = document.createElement("td");
      tdPrio.className = "prio-cell";
      tdPrio.innerHTML = `<span class="prio-dot" style="--dot:${prioColor(t.priority)}"></span>`;

      const tdTitle = document.createElement("td");
      tdTitle.textContent = t.title || "(zonder titel)";

      const tdStart = document.createElement("td");
      tdStart.textContent = t.startDate ? formatDate(t.startDate) : "";

      const tdEnd = document.createElement("td");
      tdEnd.textContent = t.endDate ? formatDate(t.endDate) : "";

      const tdDone = document.createElement("td");
      tdDone.textContent = t.done
        ? (t.completedAt ? formatDate(t.completedAt) : "✓")
        : "";

      tr.append(tdPrio, tdTitle, tdStart, tdEnd, tdDone);
      tr.addEventListener("click", () => {
        const todo = todos.find(x => x.id === t.id);
        if (todo) openTaskModal("edit", todo);
      });
      tbody.appendChild(tr);
    }
  }
}



/* ────────────────────────────────────────────────────────────────────────────
   Window helpers
   ──────────────────────────────────────────────────────────────────────────── */
window.showPostit = function (category, items) {
  document.getElementById("modal-postit-title").textContent = category.name || "Post-it";
  const body = document.getElementById("modal-postit-body");
  const color = String((category.color || "#FFEB3B")).toUpperCase();
  body.innerHTML = `
    <div style="background:${color};color:${getContrast(color)};padding:1rem;border-radius:10px;">
      <strong>${escapeHtml(category.name)}</strong>
    </div>
    <div style="margin-top:.6rem;display:grid;gap:.4rem;">
      ${items && items.length
      ? items.map(t => `<div class="task-row"><span>${escapeHtml(t.title || "")}</span></div>`).join("")
      : "<em>Geen items</em>"
    }
    </div>
  `;
  Modal.open("modal-postit");
};

/* ────────────────────────────────────────────────────────────────────────────
   Modal binds (nieuw, opslaan, verwijderen, voltooien)
   ──────────────────────────────────────────────────────────────────────────── */
function bindNewTaskButton() {
  const btn = document.getElementById("newTaskBtn");
  bindOnce(btn, "click", (e) => {
    e.preventDefault();
    if (!document.getElementById("modal-task")) {
      document.addEventListener("partials:loaded", () => openTaskModal(), { once: true });
      return;
    }
    openTaskModal();
  });
}

function bindTaskDocOpen() {
  const btn = document.getElementById("task-link-open");
  bindOnce(btn, "click", () => {
    const raw = (document.getElementById("task-link").value || "").trim();
    if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    window.open(url, "_blank", "noopener");
  });
}

function bindTaskSave() {
  const save = document.getElementById("task-save");
  bindOnce(save, "click", async () => {
    const title = (document.getElementById("task-title").value || "").trim();
    const start = document.getElementById("task-start").value;
    const end = document.getElementById("task-end").value;
    const prio = parseInt(document.getElementById("task-priority").value || "0", 10);
    const catTxt = (document.getElementById("task-category-input").value || "").trim();
    const desc = (document.getElementById("task-desc").value || "").trim();
    const link = (document.getElementById("task-link").value || "").trim();

    if (!title) { Modal.alert({ title: "Taak", html: "Geef een taaknaam op." }); return; }
    if (!currentUser) { Modal.alert({ title: "Login vereist", html: "Meld je aan om taken op te slaan." }); return; }

    const catMatch = parseCategory(catTxt);
    const catDoc = catMatch
      ? categories.find(c => c.name.toLowerCase() === catMatch.name && c.type === catMatch.type)
      : null;

    try {
      save.disabled = true;

      if (editingTaskId) {
        await updateDoc(doc(db, "todos", editingTaskId), {
          title, description: desc, link,
          startDate: start ? new Date(start) : null,
          endDate: end ? new Date(end) : null,
          priority: prio,
          categoryId: catDoc?.id || null,
          updatedAt: new Date(),
        });
      } else {
        await addDoc(collection(db, "todos"), {
          title, description: desc, link,
          startDate: start ? new Date(start) : null,
          endDate: end ? new Date(end) : null,
          priority: prio,
          categoryId: catDoc?.id || null,
          uid: currentUser?.uid || null,
          createdAt: new Date(),
          done: false
        });
      }

      Modal.close("modal-task");
      editingTaskId = null;
    } catch (err) {
      console.error(err);
      Modal.alert({ title: "Opslaan mislukt", html: "Kon de taak niet opslaan. Probeer opnieuw." });
    } finally {
      save.disabled = false;
    }
  });
}

function bindTaskDelete() {
  const del = document.getElementById("task-delete");
  bindOnce(del, "click", async () => {
    if (!editingTaskId) return;
    if (!confirm("Taak verwijderen?")) return;
    await deleteDoc(doc(db, "todos", editingTaskId));
    Modal.close("modal-task");
    editingTaskId = null;
  });
}

function bindTaskToggleDone() {
  const btn = document.getElementById("task-toggle-done");
  bindOnce(btn, "click", async () => {
    if (!editingTaskId) return;
    const t = todos.find(x => x.id === editingTaskId);
    const newVal = !(t?.done);
    await updateDoc(doc(db, "todos", editingTaskId), {
      done: newVal,
      completedAt: newVal ? new Date() : null,
      updatedAt: new Date()
    });
    btn.textContent = newVal ? "Heropenen" : "Voltooien";
    Modal.close("modal-task");
    editingTaskId = null;
  });
}

function wireTaskModal() {
  if (typeof fillBothCategoryLists === "function") fillBothCategoryLists();
  bindNewTaskButton();
  bindTaskDocOpen();
  bindTaskSave();
  bindTaskDelete();
  bindTaskToggleDone();
}
document.addEventListener("DOMContentLoaded", wireTaskModal);
document.addEventListener("partials:loaded", wireTaskModal);


// RUN-ONCE: zet oude prioriteiten om naar nieuwe betekenis.
// Roep window.remapOldPriorities() één keer aan vanuit de DevTools console.
window.remapOldPriorities = async function() {
  if (!currentUser) { console.warn("Nog niet ingelogd."); return; }
  const map = { 0: 0, 1: 3, 2: 2, 3: 1 };
  const q = query(collection(db, "todos"), where("uid", "==", currentUser.uid));
  const snap = await getDocs(q);
  let count = 0;
  for (const d of snap.docs) {
    const p = d.data().priority;
    if (p in map) {
      await updateDoc(doc(db, "todos", d.id), { priority: map[p] });
      count++;
    }
  }
  console.log("Remapped priorities:", count);
};
