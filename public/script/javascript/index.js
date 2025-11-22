// Script/Javascript/index.js
import {
    getFirebaseApp,
    getAuth,
    getFirestore, collection, addDoc, onSnapshot, doc, setDoc, updateDoc, deleteDoc,
    query, where, getDocs
} from "./firebase-config.js";

// Haal de globals op (die straks in main.js worden gezet) of initialiseer opnieuw
const app = getFirebaseApp();
const db = getFirestore(app);
const auth = getAuth(app);

// ────────────────────────────────────────────────────────────────────────────
// 1. DOM Elementen (Alleen voor Index pagina)
// ────────────────────────────────────────────────────────────────────────────
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

let editingTaskId = null;
let currentUser = null;
let categories = [];
let todos = [];
let settings = {
    modeSlots: { werk: Array(6).fill({}), prive: Array(6).fill({}) },
    preferredMode: "werk",
};
let currentMode = "werk";
const fixedColors = [
    "#FFEB3B", "#F44336", "#4CAF50", "#2196F3", "#E91E63",
    "#9C27B0", "#673AB7", "#3F51B5", "#00BCD4", "#009688",
    "#8BC34A", "#CDDC39", "#FFC107", "#FF9800", "#795548"
];

// ────────────────────────────────────────────────────────────────────────────
// 2. Helpers
// ────────────────────────────────────────────────────────────────────────────
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
    if (x.seconds) return new Date(x.seconds * 1000);
    return null;
}
function dateVal(x) { const d = tsToDate(x); return d ? d.getTime() : Number.POSITIVE_INFINITY; }
function formatDate(v) { const d = tsToDate(v); return d ? d.toLocaleDateString("nl-BE") : ""; }
function escapeHtml(s = "") {
    return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function getContrast(hex) {
    const r = parseInt(hex.substr(1, 2), 16);
    const g = parseInt(hex.substr(3, 2), 16);
    const b = parseInt(hex.substr(5, 2), 16);
    return ((r * 299 + g * 587 + b * 114) / 1000) >= 128 ? "#000" : "#fff";
}
function prioColor(p = 0) {
    const map = { 0: "#ffffff", 1: "#ef4444", 2: "#f59e0b", 3: "#22c55e" };
    return map[p] ?? map[0];
}
function prioRank(p) {
    const map = { 1: 3, 2: 2, 3: 1, 0: 0 };
    return map[p] ?? 0;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Modal Helpers & Form
// ────────────────────────────────────────────────────────────────────────────
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
    fill(document.getElementById("categoryList"));
    fill(document.getElementById("task-category-list"));
}

function parseCategory(txt) {
    const m = txt.match(/^\s*(.+?)\s*\((werk|prive)\)\s*$/i);
    if (!m) return null;
    return { name: m[1].toLowerCase(), type: m[2].toLowerCase() };
}

function openTaskModal(mode = "create", task = null) {
    const isEdit = mode === "edit" && task;
    document.getElementById("task-title").value = isEdit ? (task.title || "") : "";
    document.getElementById("task-start").value = isEdit && task.startDate ? formatDateForInput(task.startDate) : "";
    document.getElementById("task-end").value = isEdit && task.endDate ? formatDateForInput(task.endDate) : "";
    document.getElementById("task-priority").value = isEdit ? String(task.priority ?? 0) : "0";
    
    // Categorie invullen
    let catVal = "";
    if(isEdit && task.categoryId) {
        const c = categories.find(x => x.id === task.categoryId);
        if(c) catVal = `${c.name} (${c.type})`;
    }
    document.getElementById("task-category-input").value = catVal;
    
    document.getElementById("task-desc").value = isEdit ? (task.description || "") : "";
    document.getElementById("task-link").value = isEdit ? (task.link || "") : "";

    const delBtn = document.getElementById("task-delete");
    const doneBtn = document.getElementById("task-toggle-done");
    if (delBtn) delBtn.style.display = isEdit ? "inline-flex" : "none";
    if (doneBtn) {
        doneBtn.style.display = isEdit ? "inline-flex" : "none";
        if (isEdit) doneBtn.textContent = task.done ? "Heropenen" : "Voltooien";
    }

    editingTaskId = isEdit ? task.id : null;
    if(window.Modal) window.Modal.open("modal-task");
}

function formatDateForInput(v) {
    const d = tsToDate(v);
    return d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : "";
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Rendering Logica
// ────────────────────────────────────────────────────────────────────────────
function renderAll() {
    renderPostits();
    renderAllTasksTable();
}

function renderPostits() {
    if (!postitsEl) return;
    postitsEl.innerHTML = "";

    const slots = (settings.modeSlots?.[currentMode] || Array(6).fill({})).slice(0, 6);
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

    const unc = document.getElementById("uncategorized-list");
    if (unc) {
        unc.innerHTML = "";
        (byCat["_none"] || []).forEach(todo => unc.appendChild(buildTaskRow(todo)));
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

    let tbody = document.createElement("tbody");
    table.appendChild(tbody);

    const q = (document.getElementById("allTasksSearch")?.value || "").toLowerCase();
    const catById = Object.fromEntries(categories.map(c => [c.id, c]));

    const filtered = todos.filter(t => {
        const cat = catById[t.categoryId];
        if (!cat || cat.type !== currentMode) return false;
        const hay = ((t.title || "") + " " + (t.description || "")).toLowerCase();
        return q ? hay.includes(q) : true;
    });

    // Groeperen
    const groups = new Map();
    for (const t of filtered) {
        const name = catById[t.categoryId]?.name || "— Geen categorie —";
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(t);
    }

    [...groups.keys()].sort().forEach(g => {
        const trGroup = document.createElement("tr");
        trGroup.className = "group-row";
        trGroup.innerHTML = `<td colspan="5">${g}</td>`;
        tbody.appendChild(trGroup);

        const items = groups.get(g).sort((a, b) => prioRank(b.priority) - prioRank(a.priority) || dateVal(a.endDate) - dateVal(b.endDate));

        items.forEach(t => {
            const tr = document.createElement("tr");
            tr.className = "task-tr";
            tr.innerHTML = `
                <td class="prio-cell"><span class="prio-dot" style="--dot:${prioColor(t.priority)}"></span></td>
                <td>${escapeHtml(t.title)}</td>
                <td>${t.startDate ? formatDate(t.startDate) : ""}</td>
                <td>${t.endDate ? formatDate(t.endDate) : ""}</td>
                <td>${t.done ? (t.completedAt ? formatDate(t.completedAt) : "✓") : ""}</td>
            `;
            tr.addEventListener("click", () => openTaskModal("edit", t));
            tbody.appendChild(tr);
        });
    });
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Window Helpers (Modal Post-it)
// ────────────────────────────────────────────────────────────────────────────
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
    if(window.Modal) window.Modal.open("modal-postit");
};

// ────────────────────────────────────────────────────────────────────────────
// 6. Start Logica (Na Auth)
// ────────────────────────────────────────────────────────────────────────────
function initIndexPage(user) {
    currentUser = user;
    
    // Settings luisteren
    onSnapshot(doc(db, "settings", user.uid), (snap) => {
        settings = snap.exists() ? (snap.data() || {}) : {};
        if (!settings.modeSlots) settings.modeSlots = { werk: Array(6).fill({}), prive: Array(6).fill({}) };
        currentMode = settings.preferredMode || "werk";
        if (modeSwitch) modeSwitch.checked = (currentMode === "prive");
        renderAll();
    });

    // Categorieën luisteren
    onSnapshot(collection(db, "categories"), (snap) => {
        categories = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.active !== false);
        fillBothCategoryLists();
        renderAll();
    });

    // Taken luisteren
    const qTodos = query(collection(db, "todos"), where("uid", "==", user.uid));
    onSnapshot(qTodos, (snap) => {
        todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        todos.sort((a, b) => (a.createdAt ? dateVal(a.createdAt) : 0) - (b.createdAt ? dateVal(b.createdAt) : 0));
        renderAll();
    });

    // UI Events binden
    if (modeSwitch) {
        modeSwitch.onchange = async () => {
            currentMode = modeSwitch.checked ? "prive" : "werk";
            await setDoc(doc(db, "settings", user.uid), { preferredMode: currentMode }, { merge: true });
            renderAll();
        };
    }
    
    if (toggleAllTasks) {
        toggleAllTasks.onclick = () => {
            const open = allTasksPanel.hidden;
            allTasksPanel.hidden = !open;
            allTasksSearch.style.display = open ? "inline-block" : "none";
            if (open) renderAllTasksTable();
        };
    }
    
    if (allTasksSearch) allTasksSearch.oninput = () => renderAllTasksTable();

    // Modal logica (op nieuw, save, delete etc)
    wireTaskModal();
}


// Functie om Modal events te binden
function wireTaskModal() {
    const btnNew = document.getElementById("newTaskBtn");
    if (btnNew) {
        bindOnce(btnNew, "click", (e) => {
            e.preventDefault();
            openTaskModal();
        });
    }

    const btnSave = document.getElementById("task-save");
    bindOnce(btnSave, "click", async () => {
        const title = (document.getElementById("task-title").value || "").trim();
        if (!title) { alert("Geef een taaknaam op."); return; }
        if (!currentUser) return;
        
        // ... (rest van save logica gelijk aan origineel, ingekort voor overzicht)
        const start = document.getElementById("task-start").value;
        const end = document.getElementById("task-end").value;
        const prio = parseInt(document.getElementById("task-priority").value || "0", 10);
        const catTxt = (document.getElementById("task-category-input").value || "").trim();
        const desc = (document.getElementById("task-desc").value || "").trim();
        const link = (document.getElementById("task-link").value || "").trim();
        
        const catMatch = parseCategory(catTxt);
        const catDoc = catMatch ? categories.find(c => c.name.toLowerCase() === catMatch.name && c.type === catMatch.type) : null;
        
        const data = {
            title, description: desc, link,
            startDate: start ? new Date(start) : null,
            endDate: end ? new Date(end) : null,
            priority: prio,
            categoryId: catDoc?.id || null,
            updatedAt: new Date(),
        };

        try {
            if (editingTaskId) {
                await updateDoc(doc(db, "todos", editingTaskId), data);
            } else {
                data.uid = currentUser.uid;
                data.createdAt = new Date();
                data.done = false;
                await addDoc(collection(db, "todos"), data);
            }
            if(window.Modal) window.Modal.close("modal-task");
            editingTaskId = null;
        } catch(e) { console.error(e); alert("Opslaan mislukt"); }
    });
    
    // Delete & Toggle (verkort)
    const btnDel = document.getElementById("task-delete");
    bindOnce(btnDel, "click", async () => {
        if(editingTaskId && confirm("Verwijderen?")) {
            await deleteDoc(doc(db, "todos", editingTaskId));
            window.Modal.close("modal-task");
        }
    });
    
    const btnDone = document.getElementById("task-toggle-done");
    bindOnce(btnDone, "click", async () => {
        if(editingTaskId) {
            const t = todos.find(x => x.id === editingTaskId);
            await updateDoc(doc(db, "todos", editingTaskId), { done: !t.done });
            window.Modal.close("modal-task");
        }
    });
}

// Luister naar het globale Auth event vanuit main.js
document.addEventListener("app:auth_changed", (e) => {
    const user = e.detail.user;
    if (user) initIndexPage(user);
});

// Fallback: als we al ingelogd zijn voordat dit script laadt
auth.onAuthStateChanged(user => {
    if(user && !currentUser) initIndexPage(user);
});