import { getCurrentUser, watchUser } from "../../services/auth.js";
import { 
    subscribeToSettings, subscribeToCategories, updateSettings, 
    addCategory, updateCategory, deleteCategory 
} from "../../services/db.js";

import { showToast } from "../../components/toast.js";

// State
let currentUser = null;
let settings = { modeSlots: { werk: [], prive: [] }, theme: "system" };
let categories = [];

const fixedColors = [
  "#FFEB3B", "#F44336", "#4CAF50", "#2196F3", "#E91E63",
  "#9C27B0", "#673AB7", "#3F51B5", "#00BCD4", "#009688",
  "#8BC34A", "#CDDC39", "#FFC107", "#FF9800", "#795548"
];

// DOM Elements
const els = {
    app: document.getElementById("app"),
    catName: document.getElementById("catName"),
    catType: document.getElementById("catType"),
    addCatBtn: document.getElementById("addCat"),
    catList: document.getElementById("catList"),
    modeSwitch: document.getElementById("modeSwitchSettings"),
    modeSlotsRoot: document.getElementById("modeSlots"),
    saveModeSlotsBtn: document.getElementById("saveModeSlots"),
    saveThemeBtn: document.getElementById("saveTheme")
};

/* ================= INIT ================= */
async function init() {
    watchUser((user) => {
        if (!user) {
            window.location.href = "../../../index.html";
            return;
        }
        currentUser = user;
        if(els.app) els.app.style.display = "block";
        startDataSync();
    });
}

function startDataSync() {
    // 1. Settings (Thema & Slots)
    subscribeToSettings(currentUser.uid, (data) => {
        settings = data || {};
        if (!settings.modeSlots) settings.modeSlots = { werk: Array(6).fill({}), prive: Array(6).fill({}) };
        
        // Thema
        const themePref = settings.theme || "system";
        document.querySelectorAll('input[name="theme"]').forEach(r => r.checked = (r.value === themePref));
        applyTheme(themePref);

        // Mode Switch
        const preferredMode = settings.preferredMode || "werk";
        if(els.modeSwitch) els.modeSwitch.checked = (preferredMode === "prive");
        
        renderModeSlots();
    });

    // 2. Categorieën
    subscribeToCategories((data) => {
        categories = data;
        renderCategories();
        renderModeSlots(); // Opnieuw renderen omdat dropdowns afhangen van categories
    });

    setupEventListeners();
}

/* ================= THEMA ================= */
function applyTheme(mode) {
    const final = (mode === "system") 
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") 
        : mode;
    document.documentElement.setAttribute("data-theme", final);
    localStorage.setItem("theme_pref", mode); // Voor snellere laadtijd volgende keer
}

/* ================= RENDERING ================= */
function renderCategories() {
    if (!els.catList) return;
    els.catList.innerHTML = "";

    const groups = { werk: [], prive: [] };
    categories.forEach(c => { 
        // Valback voor legacy data zonder type
        const t = c.type || "werk"; 
        if(!groups[t]) groups[t] = [];
        groups[t].push(c); 
    });

    ["werk", "prive"].forEach(type => {
        const wrap = document.createElement("div");
        wrap.className = "cat-group card";
        wrap.innerHTML = `<h3 class="cat-group-title">${type.toUpperCase()}</h3><div class="cat-items"></div>`;
        const items = wrap.querySelector(".cat-items");

        (groups[type] || []).forEach(c => {
            const color = (c.color || "#FFEB3B").toUpperCase();
            const row = document.createElement("div");
            row.className = "cat-row";
            row.dataset.id = c.id;
            row.innerHTML = `
                <button class="color-swatch" data-color="${color}" aria-label="Wijzig kleur" style="--swatch:${color}"></button>
                <span class="cat-name">${escapeHtml(c.name)}</span>
                <div class="cat-actions">
                  <button class="icon-btn" data-edit title="Hernoemen">✏️</button>
                  <button class="icon-btn danger" data-del title="Verwijderen">🗑️</button>
                </div>
            `;
            items.appendChild(row);
        });
        els.catList.appendChild(wrap);
    });
}

function renderModeSlots() {
    if (!els.modeSlotsRoot) return;
    const currentMode = els.modeSwitch && els.modeSwitch.checked ? "prive" : "werk";
    
    // Zorg dat we een array van 6 hebben
    let slots = settings.modeSlots?.[currentMode];
    if(!Array.isArray(slots)) slots = Array(6).fill({});
    slots = slots.slice(0, 6);

    els.modeSlotsRoot.innerHTML = `
        <div class="modeslots-grid">
        ${slots.map((s, i) => {
            const cat = categories.find(c => c.id === s.categoryId);
            // Alleen tonen als cat bestaat EN type matcht (of toon rood als mismatch?)
            // Hier tonen we dropdowns gefilterd op type
            const color = cat?.color || "#e5e7eb";
            return `
                <label class="modeslot">
                    <span class="slot-index">${i + 1}</span>
                    <span class="slot-color" style="--swatch:${color}"></span>
                    <select data-slot="${i}">
                        <option value="">— Geen —</option>
                        ${categories.filter(c => c.type === currentMode).map(c =>
                            `<option value="${c.id}" ${s.categoryId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`
                        ).join("")}
                    </select>
                </label>
            `;
        }).join("")}
        </div>
    `;
}

/* ================= EVENT LISTENERS ================= */
function setupEventListeners() {
    // 1. Thema Opslaan
    if (els.saveThemeBtn) {
        els.saveThemeBtn.onclick = async () => {
            const sel = document.querySelector('input[name="theme"]:checked');
            const val = sel ? sel.value : "system";
            
            await updateSettings(currentUser.uid, { theme: val });
            applyTheme(val);
            
            showToast("Thema instellingen opgeslagen", "success"); // <--- TOAST
        };
    }

    // 2. Categorie Toevoegen
    if (els.addCatBtn) {
        els.addCatBtn.onclick = async () => {
            const name = els.catName.value.trim();
            const type = els.catType.value;
            
            if (!name) {
                showToast("Vul een naam in voor de categorie", "error"); // <--- TOAST ERROR
                return;
            }
            
            await addCategory({
                name, 
                type, 
                active: true, 
                color: fixedColors[Math.floor(Math.random() * fixedColors.length)]
            });
            
            els.catName.value = "";
            showToast(`Categorie "${name}" toegevoegd`, "success"); // <--- TOAST
        };
    }

    // 3. Mode Switch (Werk/Privé toggle)
    // Hier doen we GEEN toast, omdat dit een navigatie-actie is die direct visueel resultaat geeft.
    if (els.modeSwitch) {
        els.modeSwitch.onchange = async () => {
            const mode = els.modeSwitch.checked ? "prive" : "werk";
            await updateSettings(currentUser.uid, { preferredMode: mode });
        };
    }

    // 4. Post-it Indeling Opslaan
    if (els.saveModeSlotsBtn) {
        els.saveModeSlotsBtn.onclick = async () => {
            const mode = els.modeSwitch.checked ? "prive" : "werk";
            const selects = els.modeSlotsRoot.querySelectorAll("select[data-slot]");
            
            const newSlots = Array.from(selects).map(sel => {
                return sel.value ? { categoryId: sel.value } : {};
            });

            const updatedModeSlots = { ...settings.modeSlots };
            updatedModeSlots[mode] = newSlots;

            await updateSettings(currentUser.uid, { modeSlots: updatedModeSlots });
            showToast("Post-it indeling opgeslagen", "success"); // <--- TOAST
        };
    }

    // Luisteraar voor de lijst acties (Hernoemen/Verwijderen/Kleur)
    document.addEventListener("click", handleCategoryActions);
}

async function handleCategoryActions(e) {
    // 1. Kleur Kiezen (via de popover)
    const sw = e.target.closest(".color-swatch");
    if (sw) {
        const row = sw.closest(".cat-row");
        if (!row) return;
        
        openColorPopper(sw, sw.dataset.color, async (chosen) => {
            await updateCategory(row.dataset.id, { color: chosen });
            showToast("Kleur aangepast", "success"); // <--- TOAST
        });
        return;
    }

    // 2. Hernoemen (Potloodje)
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) {
        const row = editBtn.closest(".cat-row");
        const c = categories.find(x => x.id === row.dataset.id);
        if(!c) return;
        
        const newName = prompt("Nieuwe naam:", c.name);
        
        if (newName && newName.trim() !== c.name) {
            await updateCategory(row.dataset.id, { name: newName.trim() });
            showToast("Categorie hernoemd", "success"); // <--- TOAST
        }
        return;
    }

    // 3. Verwijderen (Vuilbakje)
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) {
        const row = delBtn.closest(".cat-row");
        
        if(confirm("Categorie verwijderen? Dit kan invloed hebben op bestaande taken.")) {
            await deleteCategory(row.dataset.id);
            showToast("Categorie verwijderd", "success"); // <--- TOAST
        }
    }
}

/* ================= COLOR POPPER ================= */
let colorPopper = null;
let colorPopperOnPick = null;

function ensureColorPopper() {
    if (colorPopper) return colorPopper;
    colorPopper = document.createElement("div");
    colorPopper.className = "color-popover";
    colorPopper.innerHTML = `<div class="color-grid">${fixedColors.map(c => `<button class="color-opt" data-val="${c}" style="--c:${c}"></button>`).join("")}</div>`;
    document.body.appendChild(colorPopper);
    
    colorPopper.addEventListener("click", (e) => {
        const btn = e.target.closest(".color-opt");
        if(btn) {
            if(colorPopperOnPick) colorPopperOnPick(btn.dataset.val);
            closeColorPopper();
        }
    });

    // Close on click outside
    document.addEventListener("mousedown", (e) => {
        if(colorPopper.style.display === "block" && !colorPopper.contains(e.target) && !e.target.closest(".color-swatch")) {
            closeColorPopper();
        }
    });
    return colorPopper;
}

function openColorPopper(anchor, current, onPick) {
    const pop = ensureColorPopper();
    colorPopperOnPick = onPick;
    pop.style.display = "block";
    const rect = anchor.getBoundingClientRect();
    pop.style.top = (window.scrollY + rect.bottom + 5) + "px";
    pop.style.left = (window.scrollX + rect.left) + "px";
}

function closeColorPopper() {
    if(colorPopper) colorPopper.style.display = "none";
}

// Utils
function escapeHtml(s) { return (s||"").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// Start
init();