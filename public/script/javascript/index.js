// Script/Javascript/index.js
import {
    getFirestore, collection, addDoc, onSnapshot, doc, setDoc, updateDoc, deleteDoc,
    query, where
} from "./firebase-config.js";

// Haal globals op via window.App (ingesteld in main.js)
const db = window.App?.db || getFirestore();
// Auth wordt dynamisch gecheckt bij init

/* ────────────────────────────────────────────────────────────────────────────
   1. State & Config
   ──────────────────────────────────────────────────────────────────────────── */
let currentUser = null;
let categories = [];
let todos = [];
let settings = { modeSlots: { werk: [], prive: [] }, preferredMode: "werk" };
let currentMode = "werk";
let editingTaskId = null; // ID van taak die we bewerken
let searchDebounceTimer = null; // Voor performance zoekbalk

const FIXED_COLORS = [
    "#FFEB3B", "#F44336", "#4CAF50", "#2196F3", "#E91E63", 
    "#9C27B0", "#673AB7", "#3F51B5", "#00BCD4", "#009688", 
    "#8BC34A", "#CDDC39", "#FFC107", "#FF9800", "#795548"
];

/* ────────────────────────────────────────────────────────────────────────────
   2. DOM Elementen (Veilige selectie)
   ──────────────────────────────────────────────────────────────────────────── */
const els = {
    postits: document.getElementById("postits"),
    modeSwitch: document.getElementById("modeSwitch"),
    allTasksTable: document.getElementById("allTasksTable"),
    allTasksPanel: document.getElementById("allTasksPanel"),
    toggleAllTasksBtn: document.getElementById("toggleAllTasks"),
    searchInput: document.getElementById("allTasksSearch"),
    newTaskBtn: document.getElementById("newTaskBtn"),
    uncategorizedList: document.getElementById("uncategorized-list")
};

/* ────────────────────────────────────────────────────────────────────────────
   3. Helper Functies (DRY)
   ──────────────────────────────────────────────────────────────────────────── */
const Utils = {
    tsToDate: (x) => (!x ? null : (x.seconds ? new Date(x.seconds * 1000) : new Date(x))),
    dateVal: (x) => (Utils.tsToDate(x) ? Utils.tsToDate(x).getTime() : Infinity), // Voor sorteren
    formatDate: (v) => {
        const d = Utils.tsToDate(v);
        return d ? d.toLocaleDateString("nl-BE", { day: '2-digit', month: '2-digit' }) : "-";
    },
    formatDateInput: (v) => {
        const d = Utils.tsToDate(v);
        return d ? d.toISOString().split('T')[0] : "";
    },
    getContrast: (hex) => (parseInt(hex.replace('#',''), 16) > 0xffffff / 2 ? "#000" : "#fff"),
    escape: (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    prioColor: (p) => ({ 1: "#ef4444", 2: "#f59e0b", 3: "#22c55e" }[p] || "#cbd5e1"),
    prioSort: (p) => ({ 1: 3, 2: 2, 3: 1 }[p] || 0)
};

/* ────────────────────────────────────────────────────────────────────────────
   4. Init Logica (Startpunt)
   ──────────────────────────────────────────────────────────────────────────── */
function initIndexPage(user) {
    console.log("🚀 Index Page Init voor:", user.email);
    currentUser = user;

    // 1. Settings luisteren (Realtime)
    onSnapshot(doc(db, "settings", user.uid), (snap) => {
        settings = snap.exists() ? snap.data() : {};
        if (!settings.modeSlots) settings.modeSlots = { werk: [], prive: [] };
        
        // Zet de switch goed op basis van voorkeur
        const serverMode = settings.preferredMode || "werk";
        if (currentMode !== serverMode) {
            currentMode = serverMode;
            if (els.modeSwitch) els.modeSwitch.checked = (currentMode === "prive");
        }
        renderAll();
    });

    // 2. Categorieën luisteren
    onSnapshot(collection(db, "categories"), (snap) => {
        categories = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.active !== false);
        renderAll();
    });

    // 3. Taken luisteren (Alleen van deze user)
    const q = query(collection(db, "todos"), where("uid", "==", user.uid));
    onSnapshot(q, (snap) => {
        todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
    });

    setupEventListeners(user);
}

/* ────────────────────────────────────────────────────────────────────────────
   5. Event Listeners
   ──────────────────────────────────────────────────────────────────────────── */
function setupEventListeners(user) {
    // Mode Switch (Werk/Prive)
    if (els.modeSwitch) {
        els.modeSwitch.onchange = async () => {
            currentMode = els.modeSwitch.checked ? "prive" : "werk";
            renderAll(); // Direct UI update voor snelheid
            await setDoc(doc(db, "settings", user.uid), { preferredMode: currentMode }, { merge: true });
        };
    }

    // Toggle Tabel weergave
    if (els.toggleAllTasksBtn) {
        els.toggleAllTasksBtn.onclick = () => {
            const isHidden = els.allTasksPanel.hidden;
            els.allTasksPanel.hidden = !isHidden;
            if (els.searchInput) els.searchInput.style.display = isHidden ? "inline-block" : "none";
            if (isHidden) renderTable(); // Render pas als we openen (Performance)
        };
    }

    // Zoeken met Debounce (Performance)
    if (els.searchInput) {
        els.searchInput.oninput = () => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => renderTable(), 300);
        };
    }

    // Nieuwe Taak Knop
    if (els.newTaskBtn) {
        els.newTaskBtn.onclick = () => openTaskModal("create");
    }

    // Modal Events (Opslaan knop)
    const saveBtn = document.getElementById("task-save");
    // Voorkom dubbele listeners met een vlaggetje
    if (saveBtn && !saveBtn._wired) {
        saveBtn._wired = true;
        saveBtn.onclick = handleTaskSave;
    }
    
    // Delete en Done knoppen
    const delBtn = document.getElementById("task-delete");
    if(delBtn && !delBtn._wired) {
        delBtn._wired = true;
        delBtn.onclick = async () => {
            if(editingTaskId && confirm("Zeker weten?")) {
                await deleteDoc(doc(db, "todos", editingTaskId));
                if(window.Modal) window.Modal.close();
            }
        };
    }
    
    const doneBtn = document.getElementById("task-toggle-done");
    if(doneBtn && !doneBtn._wired) {
        doneBtn._wired = true;
        doneBtn.onclick = async () => {
             if(editingTaskId) {
                const t = todos.find(x => x.id === editingTaskId);
                if(t) await updateDoc(doc(db, "todos", editingTaskId), { done: !t.done });
                if(window.Modal) window.Modal.close();
             }
        };
    }
}

/* ────────────────────────────────────────────────────────────────────────────
   6. Rendering (Post-its & Tabel)
   ──────────────────────────────────────────────────────────────────────────── */
function renderAll() {
    renderPostits();
    // Render tabel alleen als hij zichtbaar is (Performance)
    if (els.allTasksPanel && !els.allTasksPanel.hidden) {
        renderTable();
    }
    renderUncategorized();
}

function renderPostits() {
    if (!els.postits) return;
    els.postits.innerHTML = "";

    const slots = (settings.modeSlots?.[currentMode] || Array(6).fill({})).slice(0, 6);
    
    // Groepeer onvoltooide taken per categorie
    const tasksByCat = {};
    todos.forEach(t => {
        if (!t.done) {
            const cid = t.categoryId || "_none";
            if (!tasksByCat[cid]) tasksByCat[cid] = [];
            tasksByCat[cid].push(t);
        }
    });

    // Loop door de 6 slots
    slots.forEach((slot, index) => {
        if (!slot.categoryId) return; // Leeg slot overslaan

        const cat = categories.find(c => c.id === slot.categoryId);
        // Check of categorie bestaat én bij de huidige modus hoort
        if (!cat || (cat.type && cat.type !== currentMode)) return;

        const color = (cat.color || FIXED_COLORS[index % FIXED_COLORS.length]).toUpperCase();
        const contrast = Utils.getContrast(color);
        const tasks = tasksByCat[cat.id] || [];

        // Bouw HTML string (sneller dan lossen elementen maken)
        const taskRows = tasks.map(t => `
            <div class="task-row" onclick="window.App.editTask('${t.id}')">
                <span class="task-dot" style="--dot:${Utils.prioColor(t.priority)}"></span>
                <span>${Utils.escape(t.title)}</span>
            </div>
        `).join("");

        const box = document.createElement("div");
        box.className = "postit";
        box.style.background = color;
        box.style.color = contrast;
        box.innerHTML = `
            <div class="postit-head" onclick="window.App.showPostit('${cat.id}')" style="cursor:pointer">
                ${Utils.escape(cat.name)}
            </div>
            <div class="postit-body">${taskRows}</div>
        `;
        
        els.postits.appendChild(box);
    });
}

function renderUncategorized() {
    if(!els.uncategorizedList) return;
    els.uncategorizedList.innerHTML = "";
    
    // Zoek taken zonder categorie of met verwijderde categorie
    const activeCatIds = categories.map(c => c.id);
    const orphanTasks = todos.filter(t => !t.done && (!t.categoryId || !activeCatIds.includes(t.categoryId)));

    if(orphanTasks.length === 0) {
        els.uncategorizedList.innerHTML = "<small class='text-muted'>Geen overige taken</small>";
        return;
    }

    orphanTasks.forEach(t => {
        const div = document.createElement("div");
        div.className = "task-row";
        div.innerHTML = `<span class="task-dot" style="--dot:${Utils.prioColor(t.priority)}"></span> ${Utils.escape(t.title)}`;
        div.onclick = () => openTaskModal("edit", t);
        els.uncategorizedList.appendChild(div);
    });
}

function renderTable() {
    if (!els.allTasksTable) return;
    
    // 1. Headers
    els.allTasksTable.innerHTML = `
        <thead>
            <tr>
                <th width="40">Prio</th>
                <th>Taak</th>
                <th width="100">Deadline</th>
                <th width="100">Status</th>
            </tr>
        </thead>
    `;

    const tbody = document.createElement("tbody");
    els.allTasksTable.appendChild(tbody);

    // 2. Filteren (Zoekterm + Huidige Modus)
    const searchTerm = (els.searchInput?.value || "").toLowerCase();
    
    const filtered = todos.filter(t => {
        // Filter op categorie type (werk/prive)
        const cat = categories.find(c => c.id === t.categoryId);
        // Als taak geen categorie heeft, tonen we hem in beide modi of 'overige'
        if (cat && cat.type !== currentMode) return false;

        // Filter op zoekterm
        if (searchTerm) {
            const text = `${t.title} ${t.description || ""}`.toLowerCase();
            return text.includes(searchTerm);
        }
        return true;
    });

    // 3. Sorteren: Prio hoog > Datum dichtbij > Titel
    filtered.sort((a, b) => {
        // Eerst voltooide taken onderaan
        if (a.done !== b.done) return a.done ? 1 : -1;
        // Dan Prioriteit
        const pA = Utils.prioSort(a.priority);
        const pB = Utils.prioSort(b.priority);
        if (pA !== pB) return pB - pA; // Hoogste eerst
        // Dan Datum
        return Utils.dateVal(a.endDate) - Utils.dateVal(b.endDate);
    });

    // 4. Render Rijen
    filtered.forEach(t => {
        const tr = document.createElement("tr");
        tr.className = "task-tr";
        if (t.done) tr.style.opacity = "0.5";
        
        tr.innerHTML = `
            <td class="prio-cell">
                <span class="prio-dot" style="--dot:${Utils.prioColor(t.priority)}"></span>
            </td>
            <td>${Utils.escape(t.title)}</td>
            <td>${Utils.formatDate(t.endDate)}</td>
            <td>${t.done ? "✅" : "Open"}</td>
        `;
        
        tr.onclick = () => openTaskModal("edit", t);
        tbody.appendChild(tr);
    });
}

/* ────────────────────────────────────────────────────────────────────────────
   7. Modal Logica (Opslaan/Openen)
   ──────────────────────────────────────────────────────────────────────────── */
function openTaskModal(mode, task = null) {
    editingTaskId = (mode === "edit" && task) ? task.id : null;
    const isEdit = !!editingTaskId;

    // Vul velden
    const setValue = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ""; };
    
    setValue("task-title", isEdit ? task.title : "");
    setValue("task-desc", isEdit ? task.description : "");
    setValue("task-link", isEdit ? task.link : "");
    setValue("task-start", isEdit ? Utils.formatDateInput(task.startDate) : "");
    setValue("task-end", isEdit ? Utils.formatDateInput(task.endDate) : "");
    setValue("task-priority", isEdit ? task.priority : "0");
    
    // Categorie input slim vullen
    const catInput = document.getElementById("task-category-input");
    const dataList = document.getElementById("task-category-list");
    
    // Vul datalist
    dataList.innerHTML = "";
    categories.forEach(c => {
        if(c.type === currentMode) { // Toon alleen relevante categorieën
            const opt = document.createElement("option");
            opt.value = c.name;
            dataList.appendChild(opt);
        }
    });

    if (catInput) {
        if (isEdit && task.categoryId) {
            const c = categories.find(x => x.id === task.categoryId);
            catInput.value = c ? c.name : "";
        } else {
            catInput.value = "";
        }
    }

    // Knoppen tonen/verbergen
    const delBtn = document.getElementById("task-delete");
    const doneBtn = document.getElementById("task-toggle-done");
    if(delBtn) delBtn.style.display = isEdit ? "inline-flex" : "none";
    if(doneBtn) {
        doneBtn.style.display = isEdit ? "inline-flex" : "none";
        doneBtn.textContent = isEdit && task.done ? "Heropenen" : "Voltooien";
    }

    if (window.Modal) window.Modal.open("modal-task");
}

async function handleTaskSave() {
    const title = document.getElementById("task-title").value.trim();
    if (!title) return alert("Vul een titel in");

    // Haal waardes op
    const start = document.getElementById("task-start").value;
    const end = document.getElementById("task-end").value;
    const prio = parseInt(document.getElementById("task-priority").value || "0");
    const desc = document.getElementById("task-desc").value.trim();
    const link = document.getElementById("task-link").value.trim();
    
    // Categorie resolven op naam
    const catName = document.getElementById("task-category-input").value.trim();
    let catId = null;
    if (catName) {
        // Zoek exact in huidige modus
        const c = categories.find(cat => cat.name.toLowerCase() === catName.toLowerCase() && cat.type === currentMode);
        if (c) catId = c.id;
        else {
            // Bestaat niet? Vraag om aan te maken? Voor nu: negeer of maak default?
            // Simpele optie: alert of null laten
        }
    }

    const payload = {
        title, 
        description: desc, 
        link,
        priority: prio,
        categoryId: catId,
        startDate: start ? new Date(start) : null,
        endDate: end ? new Date(end) : null,
        updatedAt: new Date()
    };

    try {
        if (editingTaskId) {
            await updateDoc(doc(db, "todos", editingTaskId), payload);
        } else {
            payload.uid = currentUser.uid;
            payload.done = false;
            payload.createdAt = new Date();
            await addDoc(collection(db, "todos"), payload);
        }
        if (window.Modal) window.Modal.close();
    } catch (err) {
        console.error("Fout bij opslaan taak:", err);
        alert("Kon taak niet opslaan.");
    }
}

/* ────────────────────────────────────────────────────────────────────────────
   8. Global Expose (Voor onclick in HTML string)
   ──────────────────────────────────────────────────────────────────────────── */
// We moeten functies aan window hangen als we `onclick="..."` gebruiken in HTML strings
window.App = window.App || {};
window.App.editTask = (id) => {
    const t = todos.find(x => x.id === id);
    if(t) openTaskModal("edit", t);
};
window.App.showPostit = (catId) => {
    const cat = categories.find(c => c.id === catId);
    const tasks = todos.filter(t => t.categoryId === catId && !t.done);
    if(window.showPostit && cat) window.showPostit(cat, tasks); // Call naar originele helper in modal.js of hier implementeren
    else if (window.Modal) {
        // Fallback als modal.js helper niet bestaat
        const body = document.getElementById("modal-postit-body");
        if(body) {
             body.innerHTML = tasks.map(t => `<div>- ${Utils.escape(t.title)}</div>`).join("");
             window.Modal.open("modal-postit");
        }
    }
};

/* ────────────────────────────────────────────────────────────────────────────
   9. Bootstrap
   ──────────────────────────────────────────────────────────────────────────── */
// Luister naar het event dat main.js afvuurt zodra Auth klaar is
document.addEventListener("app:auth_changed", (e) => {
    if (e.detail.user) {
        initIndexPage(e.detail.user);
    }
});

// Fallback: Check of auth misschien al geladen was voordat wij luisterden
if (window.App?.currentUser) {
    initIndexPage(window.App.currentUser);
}