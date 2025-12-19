import { getCurrentUser, watchUser } from "../../services/auth.js";
import { 
    subscribeToSettings, subscribeToCategories, subscribeToTodos, 
    addTask, updateTask, deleteTask, updateSettings 
} from "../../services/db.js";
import { showToast } from "../../components/toast.js";

// State
let currentUser = null;
let categories = [];
let todos = [];
let settings = { modeSlots: { werk: [], prive: [] }, preferredMode: "werk" };
let currentMode = "werk";
let editingTaskId = null;
let searchDebounceTimer = null;

// UI Helpers
const Utils = {
    tsToDate: (x) => (!x ? null : (x.seconds ? new Date(x.seconds * 1000) : new Date(x))),
    formatDate: (v) => { const d = Utils.tsToDate(v); return d ? d.toLocaleDateString("nl-BE", {day:'2-digit', month:'2-digit'}) : "-"; },
    formatDateInput: (v) => { const d = Utils.tsToDate(v); return d ? d.toISOString().split('T')[0] : ""; },
    getContrast: (hex) => (parseInt(hex.replace('#',''), 16) > 0xffffff/2 ? "#000" : "#fff"),
    escape: (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    prioColor: (p) => ({ 1: "#ef4444", 2: "#f59e0b", 3: "#22c55e" }[p] || "#cbd5e1"),
    // Kleuren voor de post-its als er geen kleur is ingesteld
    fixedColors: ["#FFEB3B", "#F44336", "#4CAF50", "#2196F3", "#E91E63", "#9C27B0"]
};

// DOM Elementen
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

/* ================= INIT ================= */
async function init() {
    // Check Auth
    watchUser((user) => {
        if (!user) {
            // AANGEPAST: Ga 3 niveaus omhoog terug naar de root landingspagina
            window.location.href = "../../../index.html"; 
            return;
        }
        currentUser = user;
        
        // Nu pas tonen we de content veilig (optioneel, als je display:none liet staan)
        const app = document.getElementById("app");
        if(app) app.style.display = "block";

        startDataSync();
    });
}

function startDataSync() {
    console.log("🚀 Start Sync voor:", currentUser.email);

    // 1. Settings ophalen
    subscribeToSettings(currentUser.uid, (data) => {
        settings = data || { modeSlots: { werk: [], prive: [] } };
        
        // Mode switch updaten als die server-side anders staat
        const serverMode = settings.preferredMode || "werk";
        if (currentMode !== serverMode) {
            currentMode = serverMode;
            if (els.modeSwitch) els.modeSwitch.checked = (currentMode === "prive");
        }
        renderAll();
    });

    // 2. Categorieën
    subscribeToCategories((data) => {
        categories = data;
        renderAll();
    });

    // 3. Taken
    subscribeToTodos(currentUser.uid, (data) => {
        todos = data;
        renderAll();
    });

    setupEventListeners();
}

/* ================= RENDERING ================= */
function renderAll() {
    renderPostits();
    if (els.allTasksPanel && !els.allTasksPanel.hidden) renderTable();
    renderUncategorized();
}

function renderPostits() {
    if (!els.postits) return;
    els.postits.innerHTML = "";

    const slots = (settings.modeSlots?.[currentMode] || Array(6).fill({})).slice(0, 6);
    
    // Sorteer taken per categorie
    const tasksByCat = {};
    todos.forEach(t => {
        if (!t.done) {
            const cid = t.categoryId || "_none";
            if (!tasksByCat[cid]) tasksByCat[cid] = [];
            tasksByCat[cid].push(t);
        }
    });

    slots.forEach((slot, index) => {
        if (!slot.categoryId) return;
        const cat = categories.find(c => c.id === slot.categoryId);
        if (!cat || (cat.type && cat.type !== currentMode)) return;

        const color = (cat.color || Utils.fixedColors[index % Utils.fixedColors.length]).toUpperCase();
        const contrast = Utils.getContrast(color);
        const tasks = tasksByCat[cat.id] || [];

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

function renderTable() {
    if (!els.allTasksTable) return;
    // ... (Tabel logica is identiek aan oud bestand, ingekort voor leesbaarheid)
    // Zorg dat de onclick handlers werken
    els.allTasksTable.innerHTML = `<thead><tr><th>Prio</th><th>Taak</th><th>Datum</th><th>Status</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    
    const term = (els.searchInput?.value || "").toLowerCase();
    const filtered = todos.filter(t => {
         const cat = categories.find(c => c.id === t.categoryId);
         if (cat && cat.type !== currentMode) return false;
         return !term || t.title.toLowerCase().includes(term);
    }).sort((a,b) => (a.done === b.done) ? 0 : a.done ? 1 : -1);

    filtered.forEach(t => {
        const tr = document.createElement("tr");
        tr.className = "task-tr";
        if(t.done) tr.style.opacity = "0.5";
        tr.innerHTML = `
            <td><span class="prio-dot" style="--dot:${Utils.prioColor(t.priority)}"></span></td>
            <td>${Utils.escape(t.title)}</td>
            <td>${Utils.formatDate(t.endDate)}</td>
            <td>${t.done ? "✅" : "Open"}</td>
        `;
        tr.onclick = () => openTaskModal("edit", t);
        tbody.appendChild(tr);
    });
    els.allTasksTable.appendChild(tbody);
}

function renderUncategorized() {
    if(!els.uncategorizedList) return;
    els.uncategorizedList.innerHTML = "";
    const activeCatIds = categories.map(c => c.id);
    const orphans = todos.filter(t => !t.done && (!t.categoryId || !activeCatIds.includes(t.categoryId)));
    
    if(!orphans.length) { els.uncategorizedList.innerHTML = "<small class='text-muted'>Geen overige taken</small>"; return; }

    orphans.forEach(t => {
        const div = document.createElement("div");
        div.className = "task-row";
        div.innerHTML = `<span class="task-dot" style="--dot:${Utils.prioColor(t.priority)}"></span> ${Utils.escape(t.title)}`;
        div.onclick = () => openTaskModal("edit", t);
        els.uncategorizedList.appendChild(div);
    });
}

/* ================= EVENT LISTENERS ================= */
function setupEventListeners() {
    // 1. Mode Switch (Werk/Privé)
    if (els.modeSwitch) {
        els.modeSwitch.onchange = async () => {
            currentMode = els.modeSwitch.checked ? "prive" : "werk";
            renderAll(); 
            await updateSettings(currentUser.uid, { preferredMode: currentMode });
            // Geen toast nodig hier, visuele switch is duidelijk genoeg
        };
    }
    
    // 2. Nieuwe taak knop
    if (els.newTaskBtn) els.newTaskBtn.onclick = () => openTaskModal("create");
    
    // 3. Toggle Tabel/Lijst
    if (els.toggleAllTasksBtn) {
        els.toggleAllTasksBtn.onclick = () => {
            els.allTasksPanel.hidden = !els.allTasksPanel.hidden;
            if (els.searchInput) els.searchInput.style.display = els.allTasksPanel.hidden ? "none" : "inline-block";
            if (!els.allTasksPanel.hidden) renderTable();
        };
    }

    // 4. Zoekbalk
    if (els.searchInput) {
        els.searchInput.oninput = () => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(renderTable, 300);
        };
    }

    // --- MODAL KNOPPEN ---

    // Opslaan
    const saveBtn = document.getElementById("task-save");
    if(saveBtn) saveBtn.onclick = handleTaskSave;

    // Verwijderen
    const delBtn = document.getElementById("task-delete");
    if(delBtn) delBtn.onclick = async () => {
        if(editingTaskId && confirm("Verwijderen?")) {
            await deleteTask(editingTaskId);
            showToast("Taak verwijderd", "success"); // <--- TOAST SUCCES
            if(window.Modal) window.Modal.close();
        }
    };
    
    // Voltooien / Heropenen
    const doneBtn = document.getElementById("task-toggle-done");
    if(doneBtn) doneBtn.onclick = async () => {
        const t = todos.find(x => x.id === editingTaskId);
        if(t) {
            const newStatus = !t.done;
            await updateTask(editingTaskId, { done: newStatus });
            
            // Slimme toast: tekst past zich aan
            if (newStatus) {
                showToast("Taak voltooid! 🎉", "success"); 
            } else {
                showToast("Taak heropend", "info");
            }

            if(window.Modal) window.Modal.close();
        }
    };

    // Link Openen
    const openLinkBtn = document.getElementById("task-link-open"); 
    if (openLinkBtn) {
        openLinkBtn.onclick = (e) => {
            e.preventDefault();
            let url = document.getElementById("task-link").value.trim();
            if (!url) {
                showToast("Geen link ingevuld", "error"); // <--- TOAST ERROR
                return;
            }
            if (!/^https?:\/\//i.test(url)) {
                url = 'https://' + url;
            }
            window.open(url, '_blank');
        };
    }
}

/* ================= MODAL LOGIC ================= */
function openTaskModal(mode, task = null) {
    editingTaskId = (mode === "edit" && task) ? task.id : null;
    const isEdit = !!editingTaskId;

    const setVal = (id, v) => { const e = document.getElementById(id); if(e) e.value = v || ""; };
    
    // Velden vullen
    setVal("task-title", isEdit ? task.title : "");
    setVal("task-desc", isEdit ? task.description : "");
    setVal("task-priority", isEdit ? task.priority : "0");
    setVal("task-start", isEdit ? Utils.formatDateInput(task.startDate) : "");
    setVal("task-end", isEdit ? Utils.formatDateInput(task.endDate) : "");
    
    // FIX: Link veld correct vullen (of leegmaken bij nieuw)
    setVal("task-link", (isEdit && task.link) ? task.link : ""); 
    
    // Categorie lijst vullen
    const dataList = document.getElementById("task-category-list");
    if(dataList) {
        dataList.innerHTML = "";
        categories.forEach(c => {
            if(c.type === currentMode) {
                const opt = document.createElement("option");
                opt.value = c.name;
                dataList.appendChild(opt);
            }
        });
    }
    
    // Categorie input vullen
    const catInput = document.getElementById("task-category-input");
    if(catInput) {
        if(isEdit && task.categoryId) {
            const c = categories.find(x => x.id === task.categoryId);
            catInput.value = c ? c.name : "";
        } else {
            catInput.value = "";
        }
    }

    // Knoppen state (Delete / Done)
    const delBtn = document.getElementById("task-delete");
    const doneBtn = document.getElementById("task-toggle-done");
    if(delBtn) delBtn.style.display = isEdit ? "inline-flex" : "none";
    if(doneBtn) {
        doneBtn.style.display = isEdit ? "inline-flex" : "none";
        doneBtn.textContent = (isEdit && task.done) ? "Heropenen" : "Voltooien";
    }

    if(window.Modal) window.Modal.open("modal-task");
}

async function handleTaskSave() {
    const title = document.getElementById("task-title").value.trim();
    
    // Validatie Check
    if (!title) {
        showToast("Titel is verplicht", "error"); // <--- TOAST ERROR
        return; 
    }

    const catName = document.getElementById("task-category-input").value.trim();
    const cat = categories.find(c => c.name.toLowerCase() === catName.toLowerCase() && c.type === currentMode);
    
    // Link ophalen
    const linkVal = document.getElementById("task-link") ? document.getElementById("task-link").value.trim() : "";

    const payload = {
        title,
        description: document.getElementById("task-desc").value.trim(),
        priority: parseInt(document.getElementById("task-priority").value || "0"),
        startDate: document.getElementById("task-start").value ? new Date(document.getElementById("task-start").value) : null,
        endDate: document.getElementById("task-end").value ? new Date(document.getElementById("task-end").value) : null,
        link: linkVal,
        categoryId: cat ? cat.id : null,
        updatedAt: new Date()
    };

    try {
        if (editingTaskId) {
            // Bestaande taak updaten
            await updateTask(editingTaskId, payload);
            showToast("Taak succesvol bijgewerkt", "success"); // <--- TOAST SUCCES
        } else {
            // Nieuwe taak aanmaken
            payload.uid = currentUser.uid;
            payload.done = false;
            payload.createdAt = new Date();
            await addTask(payload);
            showToast("Nieuwe taak aangemaakt", "success"); // <--- TOAST SUCCES
        }
        if (window.Modal) window.Modal.close();
    } catch (e) {
        console.error("Save error:", e);
        showToast("Opslaan mislukt", "error"); // <--- TOAST ERROR
    }
}

// Global Bridge voor HTML onclicks (Nodig omdat we type="module" gebruiken)
window.App = window.App || {};
window.App.editTask = (id) => {
    const t = todos.find(x => x.id === id);
    if(t) openTaskModal("edit", t);
};
window.App.showPostit = (catId) => {
    // Simpele weergave voor nu, later uitbreiden
    console.log("Toon postit details voor", catId);
};

// Start
init();