// Script/Javascript/settings.js
import {
  getFirebaseApp,
  // Auth
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged,
  // Firestore
  getFirestore, collection, addDoc, onSnapshot, doc, setDoc, updateDoc, deleteDoc
} from "./firebase-config.js";

const app = getFirebaseApp();
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

let currentUser = null;
let settings = { modeSlots: { werk: Array(6).fill({}), prive: Array(6).fill({}) } };
let categories = []; // {id,name,type,color,active}

const fixedColors = [
  "#FFEB3B", "#F44336", "#4CAF50", "#2196F3", "#E91E63",
  "#9C27B0", "#673AB7", "#3F51B5", "#00BCD4", "#009688",
  "#8BC34A", "#CDDC39", "#FFC107", "#FF9800", "#795548"
];

// ────────────────────────────────────────────────────────────────
// Thema toepassen (zelfde gedrag als andere pagina's)
// ────────────────────────────────────────────────────────────────
function resolveTheme(mode) {
  if (!mode || mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}
function applyTheme(mode) {
  document.documentElement.setAttribute("data-theme", resolveTheme(mode));
}

// ────────────────────────────────────────────────────────────────
// DOM
// ────────────────────────────────────────────────────────────────
const loginBtn = document.getElementById("login-btn");
const authDiv = document.getElementById("auth");
const appDiv = document.getElementById("app");

// Categorieën
const catName = document.getElementById("catName");
const catType = document.getElementById("catType");
const addCatBtn = document.getElementById("addCat");
const catList = document.getElementById("catList");

// Mode-slots (post-its per modus)
const modeSwitchSettings = document.getElementById("modeSwitchSettings");
const modeSlotsRoot = document.getElementById("modeSlots");
const saveModeSlotsBtn = document.getElementById("saveModeSlots");

// Thema opslaan
const saveThemeBtn = document.getElementById("saveTheme");

// Auth
loginBtn && (loginBtn.onclick = () => signInWithPopup(auth, provider));

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  currentUser = user;
  authDiv && (authDiv.style.display = "none");
  appDiv && (appDiv.style.display = "block");

  // settings (thema + post-it slots)
  onSnapshot(doc(db, "settings", user.uid), (snap) => {
    settings = snap.exists() ? (snap.data() || {}) : {};
    if (!settings.modeSlots) settings.modeSlots = { werk: Array(6).fill({}), prive: Array(6).fill({}) };

    // Thema radiobuttons zetten
    const themePref = settings.theme || "system";
    document.querySelectorAll('input[name="theme"]').forEach(r => {
      r.checked = (r.value === themePref);
    });
    applyTheme(themePref);
    try { localStorage.setItem("app.theme", themePref); } catch { }

    // Mode-switch
    const preferredMode = settings.preferredMode || "werk";
    modeSwitchSettings && (modeSwitchSettings.checked = (preferredMode === "prive"));

    renderModeSlots();
  });

  // categorieën
  onSnapshot(collection(db, "categories"), (snap) => {
    categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // alleen actieve tonen (of geen active-veld = actief)
    categories = categories.filter(c => c.active !== false);
    renderCategories();
  });
});

// ────────────────────────────────────────────────────────────────
// Thema opslaan
// ────────────────────────────────────────────────────────────────
saveThemeBtn && (saveThemeBtn.onclick = async () => {
  const sel = document.querySelector('input[name="theme"]:checked');
  const value = sel ? sel.value : "system";
  await setDoc(doc(db, "settings", currentUser.uid), { theme: value }, { merge: true });
  applyTheme(value);
  try { localStorage.setItem("app.theme", value); } catch { }
});

// ────────────────────────────────────────────────────────────────
// Categorieën: render + acties
// ────────────────────────────────────────────────────────────────
function renderCategories() {
  if (!catList) return;
  catList.innerHTML = "";

  const groups = { werk: [], prive: [] };
  categories.forEach(c => { (groups[c.type] || (groups[c.type] = [])).push(c); });

  ["werk", "prive"].forEach(type => {
    const wrap = document.createElement("div");
    wrap.className = "cat-group card";
    wrap.innerHTML = `
      <h3 class="cat-group-title">${type.toUpperCase()}</h3>
      <div class="cat-items"></div>
    `;
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

    catList.appendChild(wrap);
  });
}

// Kleurpopper (één instance die we verplaatsen)
let colorPopper = null;
let colorPopperOnPick = null;

function ensureColorPopper() {
  if (colorPopper) return colorPopper;
  const pop = document.createElement("div");
  pop.className = "color-popover";
  pop.innerHTML = `
    <div class="color-grid">
      ${fixedColors.map(c => `<button class="color-opt" data-val="${c}" style="--c:${c}" aria-label="${c}"></button>`).join("")}
    </div>
  `;
  document.body.appendChild(pop);

  // kleur kiezen
  pop.addEventListener("click", (e) => {
    const btn = e.target.closest(".color-opt");
    if (!btn) return;
    const val = btn.getAttribute("data-val");
    if (colorPopperOnPick) colorPopperOnPick(val);
    closeColorPopper();
  });

  // buiten klikken → sluiten
  document.addEventListener("mousedown", (e) => {
    if (!colorPopper) return;
    if (colorPopper.contains(e.target)) return;
    if (e.target.closest(".color-swatch")) return; // laat eigen click door
    closeColorPopper();
  });

  // esc → sluiten
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeColorPopper();
  });

  colorPopper = pop;
  return colorPopper;
}

function openColorPopper(anchorEl, current, onPick) {
  ensureColorPopper();
  colorPopperOnPick = onPick;
  colorPopper.style.display = "block";

  // positieberekening
  const r = anchorEl.getBoundingClientRect();
  const top = window.scrollY + r.bottom + 6;
  const left = window.scrollX + r.left - 6;
  colorPopper.style.top = `${top}px`;
  colorPopper.style.left = `${left}px`;

  // active markeren (optioneel)
  colorPopper.querySelectorAll(".color-opt").forEach(b => {
    const v = b.getAttribute("data-val");
    b.classList.toggle("active", (v.toUpperCase() === String(current).toUpperCase()));
  });
}

function closeColorPopper() {
  if (colorPopper) colorPopper.style.display = "none";
  colorPopperOnPick = null;
}

// event delegation voor categorie-acties
document.addEventListener("click", async (e) => {
  // kleur wijzigen (klik op swatch)
  const sw = e.target.closest(".color-swatch");
  if (sw) {
    const row = sw.closest(".cat-row");
    const id = row?.dataset?.id;
    if (!id) return;
    const current = sw.getAttribute("data-color") || "#FFEB3B";
    openColorPopper(sw, current, async (chosen) => {
      await updateDoc(doc(db, "categories", id), { color: chosen });
      // UI bijwerken
      sw.style.setProperty("--swatch", chosen);
      sw.setAttribute("data-color", chosen);
    });
    return;
  }

  // hernoemen
  const ed = e.target.closest('[data-edit]');
  if (ed) {
    const row = ed.closest(".cat-row");
    const id = row?.dataset?.id;
    const c = categories.find(x => x.id === id);
    if (!c) return;
    // hergebruik algemene modal-rename als die er is
    const input = document.getElementById("rename-input");
    const save = document.getElementById("rename-save");
    const title = document.getElementById("modal-rename-title");
    if (title) title.textContent = `Categorie hernoemen`;
    if (input) input.value = c.name;
    if (window.Modal) {
      Modal.open("modal-rename");
      const handler = async () => {
        const val = (input.value || "").trim();
        if (!val) return;
        await updateDoc(doc(db, "categories", id), { name: val });
        Modal.close("modal-rename");
        save.removeEventListener("click", handler);
      };
      save.addEventListener("click", handler, { once: true });
    } else {
      const val = prompt("Nieuwe naam:", c.name);
      if (val && val.trim()) await updateDoc(doc(db, "categories", id), { name: val.trim() });
    }
    return;
  }

  // verwijderen
  const del = e.target.closest('[data-del]');
  if (del) {
    const row = del.closest(".cat-row");
    const id = row?.dataset?.id;
    if (!id) return;
    if (!confirm("Categorie verwijderen?")) return;
    await deleteDoc(doc(db, "categories", id));
    return;
  }
});

// nieuwe categorie
addCatBtn && (addCatBtn.onclick = async () => {
  const name = (catName.value || "").trim();
  const type = catType.value || "werk";
  if (!name) { Modal?.alert?.({ title: "Categorie niet aangemaakt", html: "Vul een categorienaam in." }) || alert("Vul een categorienaam in."); return; }
  await addDoc(collection(db, "categories"), {
    name, type, active: true, color: fixedColors[0]
  });
  catName.value = "";
});

// ────────────────────────────────────────────────────────────────
/** Post-its per modus (ongewijzigde flow, maar met render) */
// ────────────────────────────────────────────────────────────────
function renderModeSlots() {
  if (!modeSlotsRoot) return;
  const currentMode = modeSwitchSettings && modeSwitchSettings.checked ? "prive" : "werk";
  const slots = (settings.modeSlots?.[currentMode] || Array(6).fill({})).slice(0, 6);

  // eenvoudige grid met 6 plaatsen
  modeSlotsRoot.innerHTML = `
    <div class="modeslots-grid">
      ${slots.map((s, i) => {
    const cat = categories.find(c => c.id === s.categoryId && c.type === currentMode);
    const label = cat ? cat.name : "— Geen —";
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

  // opslaan preferredMode als toggle wijzigt
  modeSwitchSettings && (modeSwitchSettings.onchange = async () => {
    const mode = modeSwitchSettings.checked ? "prive" : "werk";
    await setDoc(doc(db, "settings", currentUser.uid), { preferredMode: mode }, { merge: true });
    renderModeSlots();
  });

  saveModeSlotsBtn && (saveModeSlotsBtn.onclick = async () => {
    const mode = modeSwitchSettings.checked ? "prive" : "werk";
    const selects = modeSlotsRoot.querySelectorAll("select[data-slot]");
    const payload = Array(6).fill({}).map((_, i) => {
      const sel = modeSlotsRoot.querySelector(`select[data-slot="${i}"]`);
      const v = sel?.value || "";
      return v ? { categoryId: v } : {};
    });
    await setDoc(doc(db, "settings", currentUser.uid), {
      modeSlots: { ...(settings.modeSlots || {}), [mode]: payload }
    }, { merge: true });
    Modal?.alert?.({ title: "Opgeslagen", html: "Post-it indeling bewaard." });
  });
}

// ────────────────────────────────────────────────────────────────
// Utils
// ────────────────────────────────────────────────────────────────
function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
