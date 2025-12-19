import { getCurrentUser, watchUser } from "../../services/auth.js";
import { 
    subscribeToSubjects, addSubject, updateSubject, deleteSubject,
    subscribeToBacklog, addBacklogItem, updateBacklogItem, deleteBacklogItem,
    subscribeToPlans, addPlan, updatePlan, deletePlan
} from "../../services/db.js";
import { showToast } from "../../components/toast.js";

/* ───────────────────────── State & Config ───────────────────────── */
let currentUser = null;
let subjects = [];
let backlog = [];
let plans = [];
let weekStart = startOfWeek(new Date());
let viewMode = 'week'; // 'week' of 'day'
let dayDate = new Date();
let dragData = null; // Voor drag & drop data transfer

// Constanten
const SYMBOLS = { taak: "📝", toets: "🧪", examen: "🎓", andere: "📚" };
const PALETTE = [
  "#2196F3","#3F51B5","#00BCD4","#4CAF50","#8BC34A",
  "#FFC107","#FF9800","#FF5722","#E91E63","#9C27B0",
  "#795548","#607D8B","#009688","#673AB7","#F44336"
];

// DOM Elementen
const els = {
    calRoot: document.getElementById("calendar"),
    backlogRoot: document.getElementById("backlogGroups"),
    weekTitle: document.getElementById("weekTitle"),
    prevBtn: document.getElementById("prevWeek"),
    nextBtn: document.getElementById("nextWeek"),
    viewWeekBtn: document.getElementById("viewWeek"),
    viewDayBtn: document.getElementById("viewDay"),
    printBtn: document.getElementById("printList"),
    
    // Modal Backlog
    modalBacklog: document.getElementById("modal-backlog"),
    formBacklog: document.getElementById("bl-form"),
    newBacklogBtn: document.getElementById("newBacklogBtn"),
    
    // Modal Subjects
    manageSubjectsBtn: document.getElementById("manageSubjectsBtn"),
    subjectsTable: document.getElementById("subjectsTable")
};

/* ───────────────────────── Helpers ───────────────────────── */
function startOfWeek(d) {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7; // Maandag start (0=Ma, 6=Zo) -> Pas aan naar jouw voorkeur (Zat start?)
    // Jouw originele code deed: (getDay() + 1) % 7 voor Zaterdag start. Laten we dat aanhouden.
    const dayOffset = (x.getDay() + 1) % 7; 
    x.setDate(x.getDate() - dayOffset);
    x.setHours(0,0,0,0);
    return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function sym(type) { return SYMBOLS[type] || "📌"; }
function getContrast(hex) {
    /* Simpele contrast check */
    if(!hex) return "#000";
    const r = parseInt(hex.substr(1,2),16), g = parseInt(hex.substr(3,2),16), b = parseInt(hex.substr(5,2),16);
    return ((r*299 + g*587 + b*114)/1000) >= 128 ? '#000' : '#fff';
}

/* ───────────────────────── Init & Auth ───────────────────────── */
async function init() {
    watchUser((user) => {
        if (!user) { window.location.href = "../../../index.html"; return; }
        currentUser = user;
        document.getElementById("app").style.display = "block";
        
        startStreams();
        setupEventListeners();
        renderCalendar();
    });
}

function startStreams() {
    // 1. Vakken
    subscribeToSubjects(currentUser.uid, (data) => {
        subjects = data;
        renderSubjectsManager(); // Update tabel in modal
        renderBacklog(); // Backlog kan afhangen van vakken
    });

    // 2. Backlog
    subscribeToBacklog(currentUser.uid, (data) => {
        backlog = data;
        renderBacklog();
    });

    // 3. Plannen (Reactive op datum change)
    loadPlans(); 
}

function loadPlans() {
    // Bepaal start/eind datum voor query
    const start = (viewMode === 'day') ? dayDate : weekStart;
    const end = (viewMode === 'day') ? addDays(dayDate, 1) : addDays(weekStart, 7);
    
    // Stop vorige listener als die er is (om lekken te voorkomen)
    if (window._plansUnsub) window._plansUnsub();
    
    window._plansUnsub = subscribeToPlans(currentUser.uid, start, end, (data) => {
        plans = data;
        renderCalendar();
    });
    
    // Update Header Titel
    const fmt = d => d.toLocaleDateString('nl-BE', { weekday: 'long', day: '2-digit', month: '2-digit' });
    if(els.weekTitle) {
        els.weekTitle.textContent = (viewMode === 'day') 
            ? `Dag – ${fmt(start)}` 
            : `Week ${fmt(start)} – ${fmt(addDays(start, 6))}`;
    }
}

/* ───────────────────────── Rendering: Kalender ───────────────────────── */
function renderCalendar() {
    if (!els.calRoot) return;
    els.calRoot.innerHTML = "";
    
    const daysToShow = (viewMode === 'day') ? 1 : 7;
    const startDate = (viewMode === 'day') ? dayDate : weekStart;

    // 1. Headers (Dagen)
    const headerRow = document.createElement("div"); // Placeholder voor layout
    els.calRoot.appendChild(document.createElement("div")); // Lege hoek linksboven
    
    for(let i=0; i<daysToShow; i++) {
        const d = addDays(startDate, i);
        const colHead = document.createElement("div");
        colHead.className = "col-head";
        colHead.textContent = d.toLocaleDateString('nl-BE', { weekday: 'long', day: '2-digit' });
        els.calRoot.appendChild(colHead);
    }

    // 2. Tijd Kolom
    const timeCol = document.createElement("div");
    timeCol.className = "time-col";
    for(let h=7; h<22; h++) {
        const slot = document.createElement("div");
        slot.className = "time-slot";
        slot.textContent = `${String(h).padStart(2,'0')}:00`;
        timeCol.appendChild(slot);
    }
    els.calRoot.appendChild(timeCol);

    // 3. Dag Kolommen
    for(let i=0; i<daysToShow; i++) {
        const currentDay = addDays(startDate, i);
        const col = document.createElement("div");
        col.className = "day-col";
        col.dataset.date = currentDay.toISOString(); // Voor drop detectie

        // Dropzones per half uur
        for(let h=7; h<22; h++) {
            createDropZone(col, h, 0, currentDay);
            createDropZone(col, h, 30, currentDay);
        }
        
        // Plaats Events
        const dayPlans = plans.filter(p => isSameDay(p.start, currentDay));
        dayPlans.forEach(p => renderEventBlock(col, p));

        els.calRoot.appendChild(col);
    }
    
    // Grid styling aanpassen op aantal dagen
    els.calRoot.style.gridTemplateColumns = `80px repeat(${daysToShow}, 1fr)`;
}

function createDropZone(col, h, m, date) {
    const zone = document.createElement("div");
    zone.className = "dropzone";
    zone.dataset.hour = h;
    zone.dataset.min = m;
    
    // Drag Events
    zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag-hover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-hover"));
    zone.addEventListener("drop", async (e) => {
        e.preventDefault();
        zone.classList.remove("drag-hover");
        
        if (!dragData) return;
        
        const newStart = new Date(date);
        newStart.setHours(h, m, 0, 0);

        try {
            if (dragData.kind === "backlog") {
                // Nieuw item van backlog
                const item = backlog.find(x => x.id === dragData.id);
                if (item) {
                    await addPlan({
                        itemId: item.id,
                        title: item.title,
                        type: item.type,
                        subjectId: item.subjectId,
                        subjectName: item.subjectName,
                        color: item.color,
                        symbol: sym(item.type),
                        start: newStart,
                        durationHours: item.durationHours || 1,
                        uid: currentUser.uid,
                        createdAt: new Date()
                    });
                    showToast("Ingepland", "success");
                }
            } else if (dragData.kind === "move") {
                // Verplaats bestaand blok
                await updatePlan(dragData.id, { start: newStart });
                showToast("Verplaatst", "success");
            }
        } catch (err) {
            console.error(err);
            showToast("Fout bij plannen", "error");
        }
        dragData = null; // Reset
    });
    
    col.appendChild(zone);
}

function renderEventBlock(col, p) {
    const startH = p.start.getHours();
    const startM = p.start.getMinutes();
    const duration = p.durationHours || 1;
    
    // Positie berekenen (startuur 7u = 0px)
    const slotHeight = 28; // Moet matchen met CSS var(--slot-h)
    const startOffset = ((startH - 7) * 60 + startM) / 30 * slotHeight;
    const height = (duration * 60) / 30 * slotHeight;

    const el = document.createElement("div");
    el.className = `event type-${p.type}`;
    el.style.top = `${startOffset}px`;
    el.style.height = `${height}px`;
    el.style.backgroundColor = p.color || "#2196F3";
    el.style.color = getContrast(p.color || "#2196F3");
    el.draggable = true;
    
    el.innerHTML = `
        <div class="evt-actions">
            <button class="evt-del" title="Verwijderen">🗑</button>
        </div>
        <div class="title">${p.symbol || ""} ${p.title}</div>
        <div class="meta">${p.subjectName || ""} (${duration}u)</div>
    `;

    // Drag start
    el.addEventListener("dragstart", (e) => {
        dragData = { kind: "move", id: p.id };
        e.dataTransfer.setData("text/plain", p.id);
        el.style.opacity = "0.5";
    });
    el.addEventListener("dragend", () => {
        el.style.opacity = "1";
        dragData = null;
    });

    // Delete
    el.querySelector(".evt-del").addEventListener("click", async (e) => {
        e.stopPropagation();
        if(confirm("Verwijderen uit planning?")) {
            await deletePlan(p.id);
            showToast("Verwijderd", "success");
        }
    });

    col.appendChild(el);
}

/* ───────────────────────── Rendering: Backlog ───────────────────────── */
function renderBacklog() {
    if (!els.backlogRoot) return;
    els.backlogRoot.innerHTML = "";

    // Filteren op nog niet gedaan (optioneel)
    const activeItems = backlog.filter(i => !i.done);

    // Groeperen per vak
    const groups = {};
    activeItems.forEach(item => {
        const key = item.subjectId || "other";
        if (!groups[key]) groups[key] = { name: item.subjectName, color: item.color, items: [] };
        groups[key].items.push(item);
    });

    for (const key in groups) {
        const g = groups[key];
        const groupEl = document.createElement("div");
        groupEl.className = "bl-group";
        
        const contrast = getContrast(g.color || "#ccc");
        groupEl.innerHTML = `
            <div class="bl-title" style="background:${g.color || '#ccc'}; color:${contrast}">
                <span>${g.name || "Onbekend vak"}</span>
            </div>
            <div class="bl-list"></div>
        `;
        
        const listEl = groupEl.querySelector(".bl-list");
        g.items.forEach(item => {
            const itemEl = document.createElement("div");
            itemEl.className = `bl-item type-${item.type}`;
            itemEl.draggable = true;
            itemEl.innerHTML = `
                <div class="bl-sym">${sym(item.type)}</div>
                <div class="bl-main">
                    <div class="t">${item.title}</div>
                    <div class="sub">${item.durationHours}u • ${item.dueDate ? new Date(item.dueDate.seconds*1000).toLocaleDateString() : ""}</div>
                </div>
                <div class="bl-actions">
                    <button class="btn-icon sm neutral check-btn">✓</button>
                    <button class="btn-icon sm danger del-btn">🗑</button>
                </div>
            `;

            // Drag Start
            itemEl.addEventListener("dragstart", (e) => {
                dragData = { kind: "backlog", id: item.id };
                e.dataTransfer.setData("text/plain", item.id);
            });

            // Acties
            itemEl.querySelector(".check-btn").onclick = async () => {
                await updateBacklogItem(item.id, { done: true });
                showToast("Afgevinkt!", "success");
            };
            itemEl.querySelector(".del-btn").onclick = async () => {
                if(confirm("Verwijderen?")) {
                    await deleteBacklogItem(item.id);
                    showToast("Verwijderd", "success");
                }
            };

            listEl.appendChild(itemEl);
        });

        els.backlogRoot.appendChild(groupEl);
    }
}

/* ───────────────────────── Rendering: Vakken (Modal) ───────────────────────── */
function renderSubjectsManager() {
    if (!els.subjectsTable) return;
    if (subjects.length === 0) {
        els.subjectsTable.innerHTML = `<tr><td colspan="3" class="muted">Nog geen vakken...</td></tr>`;
        return;
    }
    
    els.subjectsTable.innerHTML = subjects.map(s => `
        <tr data-id="${s.id}">
            <td><input class="s-name" value="${s.name}" /></td>
            <td>
                <span class="dot" style="background:${s.color}; width:16px; height:16px; display:inline-block; border-radius:50%;"></span>
                ${s.color}
            </td>
            <td>
                <button class="subj-update primary sm">Save</button>
                <button class="subj-del danger sm">Del</button>
            </td>
        </tr>
    `).join("");

    // Listeners toevoegen aan knoppen in de tabel
    els.subjectsTable.querySelectorAll("tr").forEach(tr => {
        const id = tr.dataset.id;
        tr.querySelector(".subj-update").onclick = async () => {
            const name = tr.querySelector(".s-name").value;
            await updateSubject(id, { name });
            showToast("Vak bijgewerkt", "success");
        };
        tr.querySelector(".subj-del").onclick = async () => {
            if(confirm("Vak verwijderen?")) {
                await deleteSubject(id);
                showToast("Vak verwijderd", "success");
            }
        };
    });
}

/* ───────────────────────── Event Listeners ───────────────────────── */
function setupEventListeners() {
    // Navigatie
    els.prevBtn.onclick = () => { 
        if (viewMode === 'day') dayDate = addDays(dayDate, -1);
        else weekStart = addDays(weekStart, -7); 
        loadPlans(); 
    };
    els.nextBtn.onclick = () => { 
        if (viewMode === 'day') dayDate = addDays(dayDate, 1);
        else weekStart = addDays(weekStart, 7); 
        loadPlans(); 
    };
    
    els.viewWeekBtn.onclick = () => {
        viewMode = 'week';
        els.viewWeekBtn.classList.add("is-active");
        els.viewDayBtn.classList.remove("is-active");
        loadPlans();
    };
    els.viewDayBtn.onclick = () => {
        viewMode = 'day';
        els.viewDayBtn.classList.add("is-active");
        els.viewWeekBtn.classList.remove("is-active");
        loadPlans();
    };

    // Modal: Nieuw Item
    els.newBacklogBtn.onclick = () => {
        // Vul dropdown met vakken
        const sel = document.getElementById("bl-subject");
        sel.innerHTML = `<option value="">Kies een vak...</option>` + 
            subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
        
        window.Modal.open("modal-backlog");
    };

    // Opslaan Item
    els.formBacklog.onsubmit = async (e) => {
        e.preventDefault();
        const subjectId = document.getElementById("bl-subject").value;
        const type = document.getElementById("bl-type").value || "taak"; // Je moet dit input field nog regelen met knoppen
        const title = document.getElementById("bl-title").value;
        const dur = parseFloat(document.getElementById("bl-duration").value) || 1;
        const due = document.getElementById("bl-due").value;

        if(!subjectId || !title) { showToast("Vak en titel zijn verplicht", "error"); return; }

        const subj = subjects.find(s => s.id === subjectId);
        
        await addBacklogItem({
            uid: currentUser.uid,
            subjectId,
            subjectName: subj.name,
            color: subj.color,
            type,
            title,
            durationHours: dur,
            dueDate: due ? new Date(due) : null,
            done: false,
            createdAt: new Date()
        });
        
        showToast("Item toegevoegd aan backlog", "success");
        window.Modal.close();
        els.formBacklog.reset();
    };

    // Modal: Vakken Beheren
    els.manageSubjectsBtn.onclick = () => window.Modal.open("modal-subjects");
    
    // Vak Toevoegen
    document.getElementById("sub-save").onclick = async () => {
        const name = document.getElementById("sub-name").value;
        const color = document.getElementById("sub-color-text").innerText; // Hier moet je palette picker logica voor bouwen of vereenvoudigen
        
        if(name) {
            await addSubject({ uid: currentUser.uid, name, color });
            showToast("Vak toegevoegd", "success");
            document.getElementById("sub-name").value = "";
        }
    };
    
    // Palette Picker (vereenvoudigd)
    const paletteDiv = document.getElementById("sub-palette");
    if(paletteDiv) {
        paletteDiv.innerHTML = PALETTE.map(c => 
            `<button class="swatch" style="background:${c}" onclick="document.getElementById('sub-color-text').innerText='${c}'; document.querySelector('#sub-color-preview .dot').style.background='${c}'"></button>`
        ).join("");
    }
    
    // Type Knoppen in Modal (Segmented)
    document.querySelectorAll(".seg[data-type]").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".seg[data-type]").forEach(b => b.classList.remove("is-active"));
            btn.classList.add("is-active");
            document.getElementById("bl-type").value = btn.dataset.type;
        };
    });
}

function isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

// Start
init();