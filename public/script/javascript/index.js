// Script/Javascript/index.js
import {
    getFirestore, collection, addDoc, onSnapshot, doc, setDoc, updateDoc, deleteDoc,
    query, where
} from "./firebase-config.js";

// Haal db en auth op uit de window.App die we in main.js hebben gemaakt
// (Of initialiseer opnieuw als fallback, maar via window.App is netter)
const db = window.App?.db || getFirestore(); 
const auth = window.App?.auth; 

/* ────────────────────────────────────────────────────────────────────────────
   Variabelen & Helpers
   ──────────────────────────────────────────────────────────────────────────── */
let currentUser = null;
let categories = [];
let todos = [];
let settings = { modeSlots: { werk: [], prive: [] }, preferredMode: "werk" };
let currentMode = "werk";
let editingTaskId = null;

const fixedColors = ["#FFEB3B", "#F44336", "#4CAF50", "#2196F3", "#E91E63", "#9C27B0", "#673AB7", "#3F51B5", "#00BCD4", "#009688", "#8BC34A", "#CDDC39", "#FFC107", "#FF9800", "#795548"];

// DOM Elementen
const postitsEl = document.getElementById("postits");
const modeSwitch = document.getElementById("modeSwitch");
const allTasksTable = document.getElementById("allTasksTable");

// Helper functies
function tsToDate(x) { if (!x) return null; return x.seconds ? new Date(x.seconds * 1000) : new Date(x); }
function dateVal(x) { const d = tsToDate(x); return d ? d.getTime() : Infinity; }
function formatDate(v) { const d = tsToDate(v); return d ? d.toLocaleDateString("nl-BE") : ""; }
function getContrast(hex) { /* Simpele check */ return parseInt(hex.slice(1), 16) > 0xffffff / 2 ? "#000" : "#fff"; }
function escapeHtml(s) { return (s||"").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function prioColor(p) { return {1:"#ef4444", 2:"#f59e0b", 3:"#22c55e"}[p] || "#ffffff"; }
function prioRank(p) { return {1:3, 2:2, 3:1}[p] || 0; }

/* ────────────────────────────────────────────────────────────────────────────
   Logica & Rendering
   ──────────────────────────────────────────────────────────────────────────── */

// 1. Start Logica (Wordt aangeroepen als Auth er is)
function initIndexPage(user) {
    currentUser = user;
    
    // Settings laden
    onSnapshot(doc(db, "settings", user.uid), (snap) => {
        settings = snap.exists() ? snap.data() : {};
        if (!settings.modeSlots) settings.modeSlots = { werk: [], prive: [] };
        currentMode = settings.preferredMode || "werk";
        if (modeSwitch) modeSwitch.checked = (currentMode === "prive");
        renderAll();
    });

    // Categorieën
    onSnapshot(collection(db, "categories"), (snap) => {
        categories = snap.docs.map(d => ({id: d.id, ...d.data()})).filter(c => c.active !== false);
        renderAll();
    });

    // Todos
    const q = query(collection(db, "todos"), where("uid", "==", user.uid));
    onSnapshot(q, (snap) => {
        todos = snap.docs.map(d => ({id: d.id, ...d.data()}));
        renderAll();
    });

    // Switch Event
    if (modeSwitch) modeSwitch.onchange = async () => {
        currentMode = modeSwitch.checked ? "prive" : "werk";
        await setDoc(doc(db, "settings", user.uid), { preferredMode: currentMode }, { merge: true });
    };
    
    // Wire Modals
    wireTaskModal();
}

function renderAll() {
    renderPostits();
    renderAllTasksTable();
}

function renderPostits() {
    if (!postitsEl) return;
    postitsEl.innerHTML = "";
    
    const slots = (settings.modeSlots?.[currentMode] || Array(6).fill({})).slice(0, 6);
    
    // Groepeer todos
    const byCat = {};
    todos.forEach(t => { if(!t.done) { const cid = t.categoryId || "_none"; (byCat[cid] ||= []).push(t); }});

    for (let i = 0; i < 6; i++) {
        const slot = slots[i] || {};
        if (!slot.categoryId) continue;
        const cat = categories.find(c => c.id === slot.categoryId && c.type === currentMode);
        if (!cat) continue;

        const color = (cat.color || fixedColors[i]).toUpperCase();
        const box = document.createElement("div");
        box.className = "postit";
        box.style.background = color;
        box.style.color = getContrast(color);
        box.innerHTML = `<div class="postit-head"><strong>${escapeHtml(cat.name)}</strong></div>`;
        
        (byCat[slot.categoryId] || []).forEach(t => {
            const row = document.createElement("div");
            row.className = "task-row";
            row.innerHTML = `<span>${escapeHtml(t.title)}</span>`;
            row.onclick = (e) => { e.stopPropagation(); openTaskModal("edit", t); };
            box.appendChild(row);
        });
        
        box.onclick = () => window.showPostit(cat, byCat[slot.categoryId]);
        postitsEl.appendChild(box);
    }
}

function renderAllTasksTable() {
    if (!allTasksTable) return;
    // (Hier jouw tabel logica overnemen, ingekort voor overzicht)
    const tbody = document.createElement("tbody");
    allTasksTable.innerHTML = ""; // clear
    // ... headers bouwen ...
    allTasksTable.appendChild(tbody);
    
    // Filter op mode
    const filtered = todos.filter(t => {
        const cat = categories.find(c => c.id === t.categoryId);
        return cat && cat.type === currentMode;
    });
    
    // Render rijen...
    filtered.forEach(t => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${escapeHtml(t.title)}</td>`; // etc
        tr.onclick = () => openTaskModal("edit", t);
        tbody.appendChild(tr);
    });
}

/* ────────────────────────────────────────────────────────────────────────────
   Modal & Edit Logica (De essentie)
   ──────────────────────────────────────────────────────────────────────────── */
function openTaskModal(mode, task) {
    editingTaskId = mode === "edit" ? task.id : null;
    // Vul velden...
    document.getElementById("task-title").value = task?.title || "";
    // ... overige velden vullen ...
    if(window.Modal) window.Modal.open("modal-task");
}

function wireTaskModal() {
    const saveBtn = document.getElementById("task-save");
    if(saveBtn && !saveBtn._wired) {
        saveBtn._wired = true;
        saveBtn.onclick = async () => {
            const title = document.getElementById("task-title").value;
            if(!title) return alert("Titel verplicht");
            
            const data = { 
                title, 
                uid: currentUser.uid,
                updatedAt: new Date() 
                // ... overige data ...
            };

            if(editingTaskId) {
                await updateDoc(doc(db, "todos", editingTaskId), data);
            } else {
                data.createdAt = new Date();
                data.done = false;
                await addDoc(collection(db, "todos"), data);
            }
            window.Modal.close("modal-task");
        };
    }
    
    // Nieuwe taak knop
    const newBtn = document.getElementById("newTaskBtn");
    if(newBtn) newBtn.onclick = (e) => { e.preventDefault(); openTaskModal("create"); };
}

// Window Helper voor Post-it klik
window.showPostit = function(cat, items) {
    // ... jouw postit modal logica ...
    if(window.Modal) window.Modal.open("modal-postit");
}

// Luister naar init
document.addEventListener("app:auth_changed", (e) => {
    if (e.detail.user) initIndexPage(e.detail.user);
});