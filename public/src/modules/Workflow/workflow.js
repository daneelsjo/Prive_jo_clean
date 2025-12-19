import { getCurrentUser, watchUser } from "../../services/auth.js";
import { showToast } from "../../components/toast.js";
import { 
    subscribeToColumns, addColumn, updateColumn, deleteColumn,
    subscribeToTags, addTag, updateTag, deleteTag,
    subscribeToChecklistTemplates, addChecklistTemplate, deleteChecklistTemplate,
    getFirebaseApp, getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, 
    getDoc, getDocs, serverTimestamp, query, where, onSnapshot 
} from "../../services/db.js";


const app = getFirebaseApp();
const db = getFirestore(app);

// State
let currentUser = null;
let boardId = null;
let columns = [];
let cards = [];
let tags = [];
let checklistTemplates = []; 
let activeFilters = {
    priorities: [], // IDs van prioriteit tags
    tags: []        // IDs van standaard tags
};

// Temp state voor modals
let currentCardId = null;
let currentChecklist = [];
let currentLinks = [];
let currentLogs = [];
let tempTemplateItems = []; // Voor de admin editor

let apiSettings = { webhookUrl: "", token: "" };

const $ = id => document.getElementById(id);
const TAG_COLORS = ["#3b82f6", "#ef4444", "#f97316", "#eab308", "#84cc16", "#10b981", "#06b6d4", "#6366f1", "#8b5cf6", "#d946ef"];

// --- INIT ---
async function init() {
    watchUser((user) => {
        if (!user) { window.location.href = "../../../index.html"; return; }
        currentUser = user;
        document.getElementById("app").style.display = "block";
        fetchApiSettings(user.uid);
        ensureBoard(user.uid).then(bid => {
            boardId = bid;
            startStreams();
        });
        setupUI();
    });
}

async function fetchApiSettings(uid) {
    try {
        const snap = await getDoc(doc(db, "settings", uid));
        if (snap.exists()) apiSettings = snap.data();
    } catch (e) { console.warn(e); }
}

async function ensureBoard(uid) {
    const q = query(collection(db, "workflowBoards"), where("uid", "==", uid));
    const snap = await getDocs(q);
    if (!snap.empty) return snap.docs[0].id;
    const ref = await addDoc(collection(db, "workflowBoards"), { uid, title: "Mijn Board", createdAt: serverTimestamp() });
    const colRef = collection(db, "workflowColumns");
    await addDoc(colRef, { uid, boardId: ref.id, title: "Backlog", order: 1 });
    await addDoc(colRef, { uid, boardId: ref.id, title: "Te bespreken", order: 2 });
    await addDoc(colRef, { uid, boardId: ref.id, title: "In progress", order: 3 });
    await addDoc(colRef, { uid, boardId: ref.id, title: "Afgewerkt", order: 4 });
    await ensureStandardTags(uid);
    return ref.id;
}

async function ensureStandardTags(uid) {
    const q = query(collection(db, "workflowTags"), where("uid", "==", uid));
    const snap = await getDocs(q);
    if (snap.empty) {
        // Prioriteiten
        await addTag({ uid, name: "Critical", color: "#ef4444", builtin: true, active: true, category: "priority" });
        await addTag({ uid, name: "High", color: "#f97316", builtin: true, active: true, category: "priority" });
        await addTag({ uid, name: "Normal", color: "#3b82f6", builtin: true, active: true, category: "priority" });
        await addTag({ uid, name: "Low", color: "#10b981", builtin: true, active: true, category: "priority" });
        // Voorbeeld standaard tag
        await addTag({ uid, name: "Info", color: "#64748b", builtin: false, active: true, category: "standard" });
    }
}

function startStreams() {
    subscribeToColumns(currentUser.uid, boardId, (data) => { columns = data; renderBoard(); renderColConfig(); });
    
    subscribeToTags(currentUser.uid, (data) => { 
        tags = data; 
        renderBoard(); 
        renderTagConfig();
        if(cards.length > 0) checkUrgentItems(); 
    });

    // --- VOEG DEZE REGEL TOE ---
    subscribeToChecklistTemplates(currentUser.uid, (data) => {
        checklistTemplates = data;
        renderTemplateConfig();     // Update de lijst in Instellingen
        populateTemplateSelect();   // Update de dropdown in de Kaart
    });
    // ---------------------------
    
    const q = query(collection(db, "workflowCards"), where("boardId", "==", boardId), where("uid", "==", currentUser.uid));
    onSnapshot(q, (snap) => { 
        cards = snap.docs.map(d => ({ id: d.id, ...d.data() })); 
        renderBoard();
        checkUrgentItems();
    }, (err) => console.error(err));
}

// --- URGENTIE LOGICA ---
function checkUrgentItems() {
    // 1. Check of we het vandaag al genegeerd hebben
    const todayStr = new Date().toISOString().split('T')[0];
    if (localStorage.getItem(`wf_urgent_dismissed_${currentUser.uid}`) === todayStr) return;

    const urgentItems = [];
    const today = new Date(); 
    today.setHours(0,0,0,0);

    cards.forEach(card => {
        // Tag Logic: Zoek namen bij ID's
        const cardTagNames = (card.tags || []).map(id => {
            const t = tags.find(tag => tag.id === id);
            return t ? t.name.toLowerCase() : "";
        });

        // Datum Logic
        let diffDays = null;
        if (card.dueDate) {
            let d = card.dueDate.toDate ? card.dueDate.toDate() : new Date(card.dueDate);
            if(!isNaN(d.getTime())) {
                d.setHours(0,0,0,0);
                const diffTime = d - today;
                diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            }
        }

        // --- REGELS ---
        let reason = null;
        let type = ""; // critical, overdue, soon

        // Regel 1: Tag "Critical"
        if (cardTagNames.includes("critical")) {
            reason = "CRITICAL Tag";
            type = "critical";
        }
        // Regel 2: Over tijd (Rood)
        else if (diffDays !== null && diffDays < 0) {
            reason = "Vervallen";
            type = "overdue";
        }
        // Regel 3: Tag "High" en <= 2 dagen
        else if (cardTagNames.includes("high") && diffDays !== null && diffDays <= 2) {
            reason = "High Priority (< 2d)";
            type = "soon";
        }
        // Regel 4: Tag "Normal" en <= 1 dag (Vandaag of Morgen)
        else if (cardTagNames.includes("normal") && diffDays !== null && diffDays <= 1) {
            reason = "Normal Priority (< 1d)";
            type = "soon";
        }

        // Als er een reden is, voeg toe
        if (reason) {
            urgentItems.push({ title: card.title, reason, type, date: card.dueDate });
        }
    });

    if (urgentItems.length > 0) {
        renderUrgentModal(urgentItems);
    }
}

function renderUrgentModal(items) {
    const list = $('urgent-list');
    list.innerHTML = "";
    
    items.forEach(item => {
        const row = document.createElement("div");
        row.className = "wf-urgent-item";
        
        // Datum formateren
        let dateStr = "";
        if(item.date) {
            let d = item.date.toDate ? item.date.toDate() : new Date(item.date);
            dateStr = d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
        }

        row.innerHTML = `
            <div>
                <strong># ${item.title}</strong>
                <span style="font-size:0.8rem; color:#94a3b8; margin-left:8px;">${dateStr}</span>
            </div>
            <div class="wf-urgent-reason reason-${item.type}">
                ${item.reason}
            </div>
        `;
        list.appendChild(row);
    });

    $('modal-urgent').hidden = false;
}
function getPriorityWeight(prioId) {
    if(!prioId) return 99; // Geen prio = onderaan
    const tag = tags.find(t => t.id === prioId);
    if(!tag) return 99;
    
    const name = tag.name.toLowerCase();
    if(name.includes('critical')) return 0;
    if(name.includes('high')) return 1;
    if(name.includes('normal')) return 2;
    if(name.includes('low')) return 3;
    return 50; // Andere prio namen
}

// --- RENDERING BOARD ---
function renderBoard() {
    const board = $('workflow-board');
    board.innerHTML = "";
    
    // 1. Zoek de ID van de 'Afgewerkt' kolom (om deze kaartjes niet mee te tellen bij quick filters)
    // Pas de string "afgewerkt" aan als je kolom anders heet in je database
    const doneColumn = columns.find(c => c.title.toLowerCase() === "afgewerkt");
    const doneColId = doneColumn ? doneColumn.id : null;

    // --- A. Update Quick Filter Buttons (Status & Tellers) ---
    const updateQuickBtn = (btnId, tagName, icon) => {
        const btn = $(btnId);
        const tag = tags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
        
        if (btn && tag) {
            // Check of filter actief is
            if (activeFilters.tags.includes(tag.id)) {
                btn.classList.add('active-quick-filter');
            } else {
                btn.classList.remove('active-quick-filter');
            }

            // Tel de actieve taken (die deze tag hebben EN niet in 'Afgewerkt' staan)
            const count = cards.filter(c => {
                const hasTag = (c.tags || []).includes(tag.id);
                const isNotDone = c.columnId !== doneColId;
                return hasTag && isNotDone;
            }).length;

            // Update de tekst (Icoon + Teller)
            if (count > 0) {
                // Teller iets kleiner weergeven
                btn.innerHTML = `${icon} <span style="font-size:0.8em; font-weight:bold; margin-left:4px;">${count}</span>`;
            } else {
                btn.innerHTML = icon; // Alleen icoon als er geen taken zijn
                btn.style.opacity = "0.7"; 
            }
            btn.style.opacity = "1";
        }
    };
    
    // Update de 3 specifieke knoppen
    updateQuickBtn('btnQuickMail', 'Mail', '📧');
    updateQuickBtn('btnQuickTicket', 'Ticketing', '🎫');
    updateQuickBtn('btnQuickDev', 'WEB - GITHUB', '🐙'); // Of 'GitHub' als je tag zo heet

    // --- B. Update Algemene Filter Knop Tekst ---
    const hasFilters = activeFilters.priorities.length > 0 || activeFilters.tags.length > 0;
    const btnFilter = $('btnFilterTags');
    if(btnFilter) {
        if(hasFilters) {
            btnFilter.classList.add('active-filter');
            btnFilter.innerHTML = `🏷️ Filter (${activeFilters.priorities.length + activeFilters.tags.length})`;
        } else {
            btnFilter.classList.remove('active-filter');
            btnFilter.innerHTML = `🏷️ Filter`;
        }
    }

    // --- C. Kolommen Renderen ---
    columns.sort((a,b) => a.order - b.order);
    
    columns.forEach(col => {
        const colEl = document.createElement("div");
        colEl.className = "wf-column";
        
        // 1. Basis set kaarten voor deze kolom
        let colCards = cards.filter(c => c.columnId === col.id);

        // 2. SPECIAAL: 14 Dagen Filter voor 'Afgewerkt' kolom
        // Zodat het bord niet volloopt, maar ze wel in het Archief blijven
        if (col.title.toLowerCase() === "afgewerkt") {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 14); // 14 dagen geleden

            colCards = colCards.filter(card => {
                // Kaartjes zonder datum (oude data) laten we staan, of filteren we ook weg (hier: laten staan)
                if (!card.finishedAt) return true; 

                // Firestore Timestamp omzetten naar JS Date
                const fDate = card.finishedAt.toDate ? card.finishedAt.toDate() : new Date(card.finishedAt);
                return fDate >= cutoffDate; // Toon alleen als datum recenter is dan cutoff
            });
        }
        
        // 3. Toepassen Zoekbalk Filter
        colCards = colCards.filter(c => shouldShowCard(c));
        
        // 4. Toepassen Actieve Filters (Prioriteit & Tags)
        if (hasFilters) {
            colCards = colCards.filter(c => {
                // Prio Filter
                if (activeFilters.priorities.length > 0) {
                    if (!c.priorityId) return false;
                    if (!activeFilters.priorities.includes(c.priorityId)) return false;
                }
                // Tag Filter
                if (activeFilters.tags.length > 0) {
                    if (!c.tags || c.tags.length === 0) return false;
                    const hasMatch = c.tags.some(tagId => activeFilters.tags.includes(tagId));
                    if (!hasMatch) return false;
                }
                return true;
            });
        }

        // 5. Sorteren op Prioriteit (Critical > High > Normal > Low > Geen)
        colCards.sort((a,b) => {
            const weightA = getPriorityWeight(a.priorityId);
            const weightB = getPriorityWeight(b.priorityId);
            return weightA - weightB;
        });

        // 6. HTML Opbouw
        const count = colCards.length;
        colEl.innerHTML = `<div class="wf-column-header"><span>${col.title}</span><span class="wf-count-badge">${count}</span></div>`;
        
        const cardsCont = document.createElement("div");
        cardsCont.className = "wf-column-cards";
        
        colCards.forEach(card => { 
            cardsCont.appendChild(createCardEl(card)); 
        });
        
        // Drag & Drop events koppelen
        cardsCont.addEventListener("dragover", e => { e.preventDefault(); cardsCont.classList.add("wf-drop-target"); });
        cardsCont.addEventListener("dragleave", () => cardsCont.classList.remove("wf-drop-target"));
        cardsCont.addEventListener("drop", e => handleDrop(e, col.id));
        
        colEl.appendChild(cardsCont);
        board.appendChild(colEl);
    });
}

function shouldShowCard(card) {
    const term = $('searchInput').value.toLowerCase();
    if(!term) return true;
    const cardTags = (card.tags || []).map(id => tags.find(t => t.id === id)?.name.toLowerCase()).join(" ");
    return card.title.toLowerCase().includes(term) || cardTags.includes(term);
}

function createCardEl(card) {
    const el = document.createElement("div");
    el.className = "wf-card";
    el.draggable = true;
    el.dataset.id = card.id;
    
    let tagsHtml = "";

    // 1. RENDER PRIORITEIT (Indien aanwezig)
    if (card.priorityId) {
        const prioObj = tags.find(t => t.id === card.priorityId);
        if (prioObj && prioObj.active !== false) {
            // Iets groter of vetter eventueel, hier zelfde stijl
            tagsHtml += `<span class="wf-badge" style="background-color:${prioObj.color}; border:1px solid rgba(255,255,255,0.2);">${prioObj.name}</span>`;
        }
    }

    // 2. RENDER OVERIGE TAGS
    (card.tags || []).forEach(tagId => {
        const tagObj = tags.find(t => t.id === tagId);
        if(tagObj && tagObj.active !== false && tagObj.category !== 'priority') {
            tagsHtml += `<span class="wf-badge" style="background-color:${tagObj.color}">${tagObj.name}</span>`;
        }
    });

    // Datum Logic
    let dateHtml = "";
    if (card.dueDate) {
        let d = card.dueDate.toDate ? card.dueDate.toDate() : new Date(card.dueDate);
        if (!isNaN(d.getTime())) {
            const isOverdue = d < new Date().setHours(0,0,0,0);
            const day = String(d.getDate()).padStart(2,'0'); const month = String(d.getMonth()+1).padStart(2,'0');
            dateHtml = `<span class="wf-card-date" style="${isOverdue?'color:#ef4444;font-weight:800;':''} margin-left:auto;">📅 ${day}/${month}</span>`;
        }
    }

    // Progress Logic
    let progressHtml = "";
    if(card.checklist && card.checklist.length > 0) {
        const total = card.checklist.length;
        const done = card.checklist.filter(i => i.done).length;
        const pct = Math.round((done/total)*100);
        progressHtml = `<div class="wf-progress-container"><div class="wf-progress-bar" style="width:${pct}%"></div></div>`;
    }

    el.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
            <div class="wf-card-title" style="margin:0;">${card.title}</div>
            ${dateHtml}
        </div>
        <div class="wf-tags" style="margin-top:0;">${tagsHtml}</div>
        ${progressHtml}
    `;
    el.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", card.id); el.style.opacity = "0.5"; });
    el.addEventListener("click", () => openCardModal(card));
    return el;
}

async function handleDrop(e, colId) {
    e.preventDefault();
    
    // Verwijder de visuele 'drop target' styling
    document.querySelectorAll(".wf-drop-target").forEach(el => el.classList.remove("wf-drop-target"));
    
    const cardId = e.dataTransfer.getData("text/plain");
    
    if(cardId) {
        // Zoek de doel-kolom op om te checken of het "Afgewerkt" is
        const targetCol = columns.find(c => c.id === colId);
        
        // Het object met updates dat we naar Firestore sturen
        const updateData = { columnId: colId };

        if (targetCol && targetCol.title.toLowerCase() === "afgewerkt") {
            // A. Verplaatst NAAR Afgewerkt
            
            // 1. Timestamp voor het Archief (sortering)
            updateData.finishedAt = serverTimestamp(); 
            
            // 2. Datum voor de TTL (Auto-delete) -> Vandaag + 1 Jaar
            const deleteDate = new Date();
            deleteDate.setFullYear(deleteDate.getFullYear() + 1);
            updateData.deleteAt = deleteDate; 
            
        } else {
            // B. Verplaatst UIT Afgewerkt (terug naar backlog/progress)
            
            // Reset de datums, anders wordt hij straks per ongeluk verwijderd of getoond in archief
            updateData.finishedAt = null; 
            updateData.deleteAt = null;
        }

        // Update uitvoeren in database
        try {
            await updateDoc(doc(db, "workflowCards", cardId), updateData);
        } catch (error) {
            console.error("Fout bij verplaatsen kaart:", error);
            showToast("Kon kaart niet verplaatsen", "error");
        }
    }
}

// --- ADMIN RENDERERS ---
function renderTagConfig() {
    const stdList = $('list-tags-standard'); 
    const customList = $('list-tags-custom');
    
    stdList.innerHTML = ""; 
    customList.innerHTML = "";
    
    const sortedTags = [...tags].sort((a,b) => a.name.localeCompare(b.name));
    
    sortedTags.forEach(tag => {
        const row = document.createElement("div"); 
        row.className = "tag-manage-row";
        
        // Icoontje bepalen
        const typeIcon = tag.category === 'priority' ? '⚡' : '🏷️';
        
        // De Tag Preview
        const preview = document.createElement("span"); 
        preview.className = "tag-preview"; 
        preview.style.backgroundColor = tag.color; 
        preview.innerHTML = `${typeIcon} ${tag.name}`;
        
        // Actie knoppen container
        const actions = document.createElement("div"); 
        actions.style.display="flex"; 
        actions.style.alignItems="center"; 
        actions.style.gap="8px";
        
        // CHECK: Is dit een vaste systeem-tag?
        if (tag.builtin) {
            // JA: Toon alleen een slotje en de active-toggle (optioneel, of zelfs die niet)
            // Laten we de toggle wel tonen, zodat je ze eventueel kan 'verbergen' in de lijst, 
            // maar niet verwijderen/wijzigen.
            
            const label = document.createElement("label"); 
            label.className="wf-toggle";
            label.title = "Zichtbaar in selectielijst";
            const chk = document.createElement("input"); 
            chk.type="checkbox"; 
            chk.checked=tag.active!==false;
            chk.onchange = () => updateTag(tag.id, {active:chk.checked});
            label.append(chk, document.createElement("span")); 
            label.querySelector("span").className="wf-slider";
            actions.appendChild(label);

            // Het slotje
            const lockInfo = document.createElement("span");
            lockInfo.innerHTML = "🔒 Systeem";
            lockInfo.style.fontSize = "0.75rem";
            lockInfo.style.color = "var(--muted)";
            lockInfo.style.opacity = "0.7";
            actions.appendChild(lockInfo);
            
        } else {
            // NEE: Gewone tag, toon alle knoppen
            
            // 1. Toggle Active
            const label = document.createElement("label"); 
            label.className="wf-toggle";
            const chk = document.createElement("input"); 
            chk.type="checkbox"; 
            chk.checked=tag.active!==false;
            chk.onchange = () => updateTag(tag.id, {active:chk.checked});
            label.append(chk, document.createElement("span")); 
            label.querySelector("span").className="wf-slider";
            actions.appendChild(label);

            // 2. Edit Knop
            const editBtn = document.createElement("button"); 
            editBtn.innerHTML="✏️"; 
            editBtn.className="del-icon-btn"; 
            editBtn.title = "Bewerken";
            editBtn.onclick = () => openEditTagModal(tag);
            actions.appendChild(editBtn);
            
            // 3. Delete Knop
            const delBtn = document.createElement("button"); 
            delBtn.innerHTML="🗑️"; 
            delBtn.className="del-icon-btn"; 
            delBtn.title = "Verwijderen";
            delBtn.onclick = () => { if(confirm("Verwijderen?")) deleteTag(tag.id); };
            actions.appendChild(delBtn);
        }
        
        row.append(preview, actions);
        
        if(tag.category === 'priority') stdList.appendChild(row);
        else customList.appendChild(row);
    });

    document.querySelector('#set-tab-tags h4:nth-of-type(1)').textContent = "Prioriteiten (Vast)";
    document.querySelector('#set-tab-tags h4:nth-of-type(2)').textContent = "Labels";
}

function renderColConfig() {
    const list = $('col-list');
    list.innerHTML = "";
    
    // Zorg dat ze gesorteerd zijn op 'order' voordat we ze renderen
    const sortedCols = [...columns].sort((a,b) => a.order - b.order);

    sortedCols.forEach((col, idx) => {
        const row = document.createElement("div");
        row.className = "col-config-row";
        row.style.display = "flex";
        row.style.gap = "8px";
        row.style.alignItems = "center";
        row.style.marginBottom = "8px";
        row.style.padding = "8px";
        row.style.backgroundColor = "var(--bg)";
        row.style.border = "1px solid var(--border)";
        row.style.borderRadius = "6px";

        // Input veld voor Naam
        const input = document.createElement("input");
        input.value = col.title;
        input.style.flex = "1";
        input.placeholder = "Kolom naam...";
        // Bij verlaten van veld -> Opslaan
        input.onchange = () => {
            updateColumn(col.id, { title: input.value });
            showToast("Kolom naam gewijzigd", "success");
        };

        // Actie knoppen container
        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "4px";

        // Omhoog (Links op bord)
        const upBtn = document.createElement("button");
        upBtn.innerHTML = "⬆️";
        upBtn.className = "del-icon-btn";
        upBtn.title = "Naar links verplaatsen";
        if (idx === 0) upBtn.style.opacity = "0.2"; // Disable als eerste
        else upBtn.onclick = () => moveCol(idx, -1, sortedCols);

        // Omlaag (Rechts op bord)
        const downBtn = document.createElement("button");
        downBtn.innerHTML = "⬇️";
        downBtn.className = "del-icon-btn";
        downBtn.title = "Naar rechts verplaatsen";
        if (idx === sortedCols.length - 1) downBtn.style.opacity = "0.2"; // Disable als laatste
        else downBtn.onclick = () => moveCol(idx, 1, sortedCols);

        // Verwijderen
        const delBtn = document.createElement("button");
        delBtn.innerHTML = "🗑️";
        delBtn.className = "del-icon-btn";
        delBtn.title = "Verwijderen (Let op: kaarten blijven bestaan maar onzichtbaar)";
        delBtn.style.color = "#ef4444";
        delBtn.onclick = () => { 
            if(confirm(`Kolom "${col.title}" verwijderen? Kaarten in deze kolom worden onzichtbaar totdat je ze verplaatst.`)) {
                deleteColumn(col.id); 
            }
        };

        actions.appendChild(upBtn);
        actions.appendChild(downBtn);
        actions.appendChild(delBtn);

        row.appendChild(input);
        row.appendChild(actions);
        list.appendChild(row);
    });
}

// Hulpfunctie voor sorteren (Swappen van order)
async function moveCol(idx, dir, sortedCols) {
    if (idx + dir < 0 || idx + dir >= sortedCols.length) return;
    
    const colA = sortedCols[idx];
    const colB = sortedCols[idx + dir];
    
    // Wissel order
    const orderA = colA.order;
    const orderB = colB.order;
    
    // Update in DB (Parallel voor snelheid)
    await Promise.all([
        updateColumn(colA.id, { order: orderB }),
        updateColumn(colB.id, { order: orderA })
    ]);
}

function renderTemplateConfig() {
    const list = $('list-templates'); list.innerHTML = "";
    checklistTemplates.forEach(tpl => {
        const row = document.createElement("div"); row.className = "template-row";
        const itemCount = tpl.items ? tpl.items.length : 0;
        row.innerHTML = `<div><strong>${tpl.name}</strong><div class="template-items-preview">${itemCount} items</div></div>`;
        const delBtn = document.createElement("button"); delBtn.innerHTML = "🗑️"; delBtn.className = "del-icon-btn";
        delBtn.onclick = () => { if(confirm("Template verwijderen?")) deleteChecklistTemplate(tpl.id); };
        row.appendChild(delBtn); list.appendChild(row);
    });
}

function renderTemplateEditorItems() {
    const cont = $('tpl-items-container'); cont.innerHTML = "";
    tempTemplateItems.forEach((item, idx) => {
        const div = document.createElement("div"); div.className="temp-item-row";
        div.innerHTML = `<span>• ${item.text}</span>`;
        const del = document.createElement("button"); del.innerHTML="✕"; del.className="del-icon-btn"; del.style.fontSize="0.8rem";
        del.onclick = () => { tempTemplateItems.splice(idx, 1); renderTemplateEditorItems(); };
        div.appendChild(del); cont.appendChild(div);
    });
}

// --- MODAL & LOGIC ---
function openCardModal(card = null) {
    currentCardId = card ? card.id : null;
    // Zorg dat we altijd arrays hebben, ook al is de data corrupt of leeg
    currentChecklist = (card && Array.isArray(card.checklist)) ? [...card.checklist] : [];
    currentLinks = (card && Array.isArray(card.links)) ? [...card.links] : [];
    currentLogs = (card && Array.isArray(card.logs)) ? [...card.logs] : [];
    
    $('inpTitle').value = card ? card.title : "";
    $('inpDesc').value = card ? card.description || "" : "";
    
    if(card && card.dueDate) {
        let d = card.dueDate.toDate ? card.dueDate.toDate() : new Date(card.dueDate);
        $('inpDate').value = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : "";
    } else $('inpDate').value = "";

    // --- Render Prioriteit als Pills (Gesorteerd) ---
    const prioCont = $('prio-tags-list');
    prioCont.innerHTML = "";
    
    let currentPrioId = card ? (card.priorityId || null) : null;
    prioCont.dataset.selected = currentPrioId || "";

    // 1. Filter
    const prioTags = tags.filter(t => t.category === 'priority' && t.active !== false);
    
    // 2. Sorteer (Critical > High > Normal > Low)
    prioTags.sort((a, b) => {
        const nameA = a.name.toLowerCase();
        const nameB = b.name.toLowerCase();
        // Definieer de gewenste volgorde
        const order = ['critical', 'high', 'normal', 'low'];
        
        let idxA = order.findIndex(k => nameA.includes(k));
        let idxB = order.findIndex(k => nameB.includes(k));
        
        // Als niet gevonden (eigen naam), zet achteraan
        if (idxA === -1) idxA = 99;
        if (idxB === -1) idxB = 99;
        
        return idxA - idxB;
    });

    // 3. Render
    prioTags.forEach(t => {
        const chip = document.createElement("div");
        chip.textContent = t.name;
        chip.className = "wf-tag-option"; 
        
        const updateState = () => {
            if (currentPrioId === t.id) {
                chip.classList.add('selected');
                chip.style.backgroundColor = t.color;
                chip.style.borderColor = t.color;
                chip.style.color = "white";
            } else {
                chip.classList.remove('selected');
                chip.style.backgroundColor = "transparent";
                chip.style.borderColor = "var(--border)";
                chip.style.color = "var(--muted)";
            }
        };
        updateState();

        chip.onclick = () => {
            if (currentPrioId === t.id) currentPrioId = null;
            else currentPrioId = t.id;
            
            prioCont.dataset.selected = currentPrioId || "";
            
            // Refresh visuals (simpel via loopje over de net gesorteerde array)
            const allChips = prioCont.querySelectorAll('.wf-tag-option');
            prioTags.forEach((pt, idx) => {
                const c = allChips[idx];
                if (currentPrioId === pt.id) {
                    c.classList.add('selected');
                    c.style.backgroundColor = pt.color;
                    c.style.borderColor = pt.color;
                    c.style.color = "white";
                } else {
                    c.classList.remove('selected');
                    c.style.backgroundColor = "transparent";
                    c.style.borderColor = "var(--border)";
                    c.style.color = "var(--muted)";
                }
            });
        };
        prioCont.appendChild(chip);
    });

    renderCardTagsSelector(card ? (card.tags || []) : []);
    renderChecklist();
    renderLinks();
    renderLogs();
    populateTemplateSelect();
    
    document.querySelectorAll('.wf-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.wf-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="details"]').classList.add('active');
    document.getElementById('tab-details').classList.add('active');

    const btnPlan = $('btnQuickPlan');
    if(!card) { btnPlan.disabled=true; btnPlan.textContent="Eerst opslaan"; }
    else { 
        btnPlan.disabled=false; btnPlan.textContent="⚡ Snel Plannen in Agenda"; 
        btnPlan.onclick = () => { $('qp-date').value = $('inpDate').value || new Date().toISOString().split('T')[0]; $('modal-quick-plan').hidden=false; };
    }
    window.Modal.open("modal-card");
}

function openFilterModal() {
    const prioCont = $('filter-prio-list');
    const tagCont = $('filter-tag-list');
    prioCont.innerHTML = "";
    tagCont.innerHTML = "";

    // 1. Render Prioriteiten Opties
    const priorities = tags.filter(t => t.category === 'priority' && t.active !== false);
    priorities.forEach(p => {
        const chip = document.createElement("div");
        chip.textContent = p.name;
        const isSelected = activeFilters.priorities.includes(p.id);
        chip.className = `filter-chip ${isSelected ? 'selected' : ''}`;
        if(isSelected) chip.style.backgroundColor = p.color;
        
        chip.onclick = () => {
            if(activeFilters.priorities.includes(p.id)) {
                activeFilters.priorities = activeFilters.priorities.filter(id => id !== p.id);
            } else {
                activeFilters.priorities.push(p.id);
            }
            renderBoard(); // Direct updaten op achtergrond
            openFilterModal(); // Re-render modal voor visuele update
        };
        prioCont.appendChild(chip);
    });

    // 2. Render Tags Opties
    const labels = tags.filter(t => t.category !== 'priority' && t.active !== false).sort((a,b)=>a.name.localeCompare(b.name));
    labels.forEach(t => {
        const chip = document.createElement("div");
        chip.textContent = t.name;
        const isSelected = activeFilters.tags.includes(t.id);
        chip.className = `filter-chip ${isSelected ? 'selected' : ''}`;
        if(isSelected) chip.style.backgroundColor = t.color;
        
        chip.onclick = () => {
            if(activeFilters.tags.includes(t.id)) {
                activeFilters.tags = activeFilters.tags.filter(id => id !== t.id);
            } else {
                activeFilters.tags.push(t.id);
            }
            renderBoard();
            openFilterModal();
        };
        tagCont.appendChild(chip);
    });

    window.Modal.open('modal-filter');
}

function renderChecklist() {
    const cont = $('checklist-container');
    cont.innerHTML = "";
    $('cl-count').textContent = currentChecklist.length;

    currentChecklist.forEach((item, idx) => {
        const row = document.createElement("div");
        row.className = `check-row ${item.done ? 'done' : ''}`;
        
        // 1. De Schuiver (Toggle)
        const label = document.createElement("label");
        label.className = "cl-switch";
        
        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = item.done;
        chk.onchange = () => {
            currentChecklist[idx].done = chk.checked;
            renderChecklist();
        };
        
        const slider = document.createElement("span");
        slider.className = "cl-slider";
        
        label.appendChild(chk);
        label.appendChild(slider);

        // 2. Het Tekstveld
        const txt = document.createElement("input");
        txt.type = "text";
        txt.value = item.text || ""; // Fallback als tekst leeg is
        txt.placeholder = "Omschrijving...";
        txt.onchange = () => { currentChecklist[idx].text = txt.value; };

        // 3. Verwijder knop
        const del = document.createElement("button");
        del.innerHTML = "✕"; // Mooier kruisje
        del.className = "del-icon-btn";
        del.style.fontSize = "0.9rem";
        del.onclick = () => {
            currentChecklist.splice(idx, 1);
            renderChecklist();
        };

        row.appendChild(label);
        row.appendChild(txt);
        row.appendChild(del);
        cont.appendChild(row);
    });
}

// Helpers

// --- ARCHIEF FUNCTIES ---

function openArchiveModal() {
    const tbody = $('archive-table-body');
    tbody.innerHTML = "";

    // 1. Zoek 'Afgewerkt' kaarten
    const doneCol = columns.find(c => c.title.toLowerCase() === "afgewerkt");
    if (!doneCol) return showToast("Geen 'Afgewerkt' kolom gevonden", "error");

    // 2. Filter en Sorteer (Nieuwste bovenaan)
    const archiveCards = cards.filter(c => c.columnId === doneCol.id).sort((a,b) => {
        const dateA = a.finishedAt ? (a.finishedAt.toDate ? a.finishedAt.toDate() : new Date(a.finishedAt)) : new Date(0);
        const dateB = b.finishedAt ? (b.finishedAt.toDate ? b.finishedAt.toDate() : new Date(b.finishedAt)) : new Date(0);
        return dateB - dateA;
    });

    // 3. Render Tabel
    archiveCards.forEach(card => {
        const tr = document.createElement("tr");
        
        // Prio Label
        let prioHtml = '<span class="muted">-</span>';
        if (card.priorityId) {
            const p = tags.find(t => t.id === card.priorityId);
            if(p) prioHtml = `<span class="wf-badge" style="background:${p.color}">${p.name}</span>`;
        }

        // Tags Labels
        let tagsHtml = "";
        (card.tags || []).forEach(tid => {
            const t = tags.find(x => x.id === tid);
            if(t) tagsHtml += `<span class="wf-badge" style="background:${t.color}; margin-right:4px;">${t.name}</span>`;
        });

        // Datum
        let dateStr = "-";
        if(card.finishedAt) {
            const d = card.finishedAt.toDate ? card.finishedAt.toDate() : new Date(card.finishedAt);
            dateStr = d.toLocaleDateString('nl-BE', {day:'2-digit', month:'2-digit', year:'numeric'});
        }

        tr.innerHTML = `
            <td><strong>${card.title}</strong></td>
            <td>${prioHtml}</td>
            <td>${tagsHtml}</td>
            <td style="text-align:right; font-family:monospace;">${dateStr}</td>
        `;
        
        // Klikken opent details in READ-ONLY mode
        tr.onclick = () => openCardModal(card, true);
        tbody.appendChild(tr);
    });

    window.Modal.open('modal-archive');
}

// --- UPDATE OPEN CARD MODAL (Voor Read-Only support) ---
// Pas je bestaande openCardModal functie aan: verander de eerste regel naar:
// function openCardModal(card = null, readOnly = false) { 

// En voeg dit stukje toe HELEMAAL ONDERAAN die functie (net voor window.Modal.open):
/*
    const modalEl = document.getElementById('modal-card');
    if (readOnly) {
        modalEl.classList.add('read-only');
        $('modal-card-title').textContent = "Archief Detail (Alleen lezen)";
        // Zorg dat inputs disabled zijn voor zekerheid
        modalEl.querySelectorAll('input, textarea').forEach(i => i.disabled = true);
    } else {
        modalEl.classList.remove('read-only');
        $('modal-card-title').textContent = card ? "Taak Bewerken" : "Nieuwe Taak";
        modalEl.querySelectorAll('input, textarea').forEach(i => i.disabled = false);
    }
*/

// --- QUICK FILTER HELPER ---
function toggleQuickTag(tagName) {
    // 1. Zoek de ID van de tag op basis van de naam
    const tag = tags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
    
    if (!tag) {
        showToast(`Tag '${tagName}' niet gevonden`, "error");
        return;
    }

    // 2. Check of hij al aan staat
    const idx = activeFilters.tags.indexOf(tag.id);

    if (idx > -1) {
        // Staat aan -> Zet uit
        activeFilters.tags.splice(idx, 1);
    } else {
        // Staat uit -> Zet aan
        activeFilters.tags.push(tag.id);
    }

    // 3. Herlaad het bord (dit update ook de knop-stijlen)
    renderBoard();
}
function populateTemplateSelect() {
    const sel = $('selTemplate');
    sel.innerHTML = '<option value="">-- Kies een standaard lijst --</option>';
    checklistTemplates.forEach(tpl => {
        const opt = document.createElement("option");
        opt.value = tpl.id;
        opt.textContent = tpl.name;
        sel.appendChild(opt);
    });
}

function renderLinks() {
    const cont = $('links-container'); cont.innerHTML = "";
    $('link-count').textContent = currentLinks.length;
    if(currentLinks.length === 0) cont.innerHTML = '<span class="muted small" style="font-style:italic;">Geen links.</span>';
    currentLinks.forEach((link, idx) => {
        const row = document.createElement("div"); row.className = "wf-link-item";
        row.innerHTML = `<a href="${link.url}" target="_blank">🔗 ${link.title}</a>`;
        const del = document.createElement("button"); del.innerHTML="🗑️"; del.className="del-icon-btn";
        del.onclick = () => { currentLinks.splice(idx, 1); renderLinks(); };
        row.appendChild(del); cont.appendChild(row);
    });
}

function renderLogs() {
    const cont = $('logs-container'); cont.innerHTML = "";
    if(currentLogs.length === 0) cont.innerHTML = '<span class="muted small">Nog geen logs.</span>';
    [...currentLogs].reverse().forEach(log => {
        const div = document.createElement("div"); div.className = "wf-log-item";
        const dateStr = new Date(log.timestamp).toLocaleString('nl', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
        div.innerHTML = `<div class="wf-log-meta"><span>${dateStr}</span></div><div class="wf-log-content">${log.content}</div>`;
        cont.appendChild(div);
    });
}

function renderCardTagsSelector(selectedIds = []) {
    const container = $('card-tags-list'); container.innerHTML = "";
    
    // Filter: Toon GEEN Priorities in deze lijst (die zitten in de dropdown)
    const standardTags = tags.filter(t => t.active !== false && t.category !== 'priority');
    
    standardTags.sort((a,b) => a.name.localeCompare(b.name));

    standardTags.forEach(tag => {
        const isSelected = selectedIds.includes(tag.id);
        const chip = document.createElement("div"); chip.textContent = tag.name;
        chip.className = `wf-tag-option ${isSelected?'selected':''}`;
        if(isSelected) chip.style.backgroundColor = tag.color;
        
        chip.onclick = () => {
            if(selectedIds.includes(tag.id)) selectedIds.splice(selectedIds.indexOf(tag.id), 1);
            else selectedIds.push(tag.id);
            renderCardTagsSelector(selectedIds);
            container.dataset.selected = JSON.stringify(selectedIds);
        };
        container.appendChild(chip);
    });
    container.dataset.selected = JSON.stringify(selectedIds);
}

// --- SETUP EVENTS ---
function setupUI() {
    $('searchInput').addEventListener('input', renderBoard);
    $('btnNewCard').onclick = () => openCardModal();
    $('btnSettings').onclick = () => { renderTagConfig(); renderColConfig(); renderTemplateConfig(); window.Modal.open("modal-settings"); };
    $('btnAddCol').onclick = async () => {
        const title = prompt("Naam kolom:"); if(title) {
            const maxOrder = columns.reduce((max, c) => Math.max(max, c.order), 0);
            await addColumn({ uid: currentUser.uid, boardId, title, order: maxOrder + 1 });
        }
    };
    $('btnOpenArchive').onclick = () => openArchiveModal();
    $('btnFilterTags').onclick = () => openFilterModal();
    // QUICK FILTERS
    $('btnQuickMail').onclick = () => toggleQuickTag('MAIL');
    $('btnQuickTicket').onclick = () => toggleQuickTag('Ticketing');
    
    // Pas de naam 'Dev' aan naar 'GitHub' als je tag zo heet in je systeem!
    $('btnQuickDev').onclick = () => toggleQuickTag('WEB - GITHUB');
    
    $('btnClearFilters').onclick = () => { 
        activeFilters = { priorities:[], tags:[] }; 
        renderBoard(); 
        openFilterModal(); // Refresh modal view
    };

    $('btnAddCheckitem').onclick = () => {
        const txt = $('new-check-text').value.trim();
        if(txt) { currentChecklist.push({text: txt, done: false}); $('new-check-text').value=""; renderChecklist(); }
    };
    
    // TEMPLATE LOAD LOGIC
    $('btnLoadTemplate').onclick = () => {
        const tplId = $('selTemplate').value;
        if(!tplId) return showToast("Kies eerst een lijst", "error");
        const tpl = checklistTemplates.find(t => t.id === tplId);
        if(tpl && tpl.items) {
            // Append items
            tpl.items.forEach(i => {
                currentChecklist.push({ text: i.text, done: false });
            });
            renderChecklist();
            showToast("Lijst toegevoegd", "success");
        }
    };

    // TEMPLATE ADMIN LOGIC
    $('btnNewTemplateToggle').onclick = () => {
        $('template-editor').style.display = "block";
        $('btnNewTemplateToggle').style.display = "none";
        $('tpl-name').value = "";
        tempTemplateItems = [];
        renderTemplateEditorItems();
    };
    
    $('btnTplAddItem').onclick = () => {
        const val = $('tpl-new-item').value.trim();
        if(val) { tempTemplateItems.push({text: val}); $('tpl-new-item').value=""; renderTemplateEditorItems(); }
    };
    
    $('btnCancelTpl').onclick = () => {
        $('template-editor').style.display = "none";
        $('btnNewTemplateToggle').style.display = "block";
    };
    
    $('btnSaveTpl').onclick = async () => {
        const name = $('tpl-name').value.trim();
        if(!name) return showToast("Naam verplicht", "error");
        if(tempTemplateItems.length === 0) return showToast("Voeg items toe", "error");
        
        await addChecklistTemplate({ uid: currentUser.uid, name, items: tempTemplateItems });
        $('template-editor').style.display = "none";
        $('btnNewTemplateToggle').style.display = "block";
        showToast("Template opgeslagen", "success");
    };
    $('btn-close-urgent').onclick = () => {
        if ($('chk-urgent-today').checked) {
            const todayStr = new Date().toISOString().split('T')[0];
            localStorage.setItem(`wf_urgent_dismissed_${currentUser.uid}`, todayStr);
        }
        $('modal-urgent').hidden = true;
    };

    $('btnAddLink').onclick = () => {
        const t = $('new-link-title').value.trim(); const u = $('new-link-url').value.trim();
        if(t && u) { currentLinks.push({title: t, url: u}); $('new-link-title').value=""; $('new-link-url').value=""; renderLinks(); }
    };

    $('btnAddLog').onclick = () => {
        const t = $('new-log-text').value.trim();
        if(t) { currentLogs.push({content: t, timestamp: new Date().toISOString()}); $('new-log-text').value=""; renderLogs(); }
    };

    // New Tag Logic
    let editingTagId = null;
    $('btnOpenNewTag').onclick = () => {
        editingTagId = null; $('new-tag-name').value=""; $('new-tag-color-val').value=TAG_COLORS[0];
        const colorsCont = $('new-tag-colors'); colorsCont.innerHTML="";
        TAG_COLORS.forEach((c, idx) => {
            const circle = document.createElement("div"); circle.className = `color-circle ${idx===0?'selected':''}`; circle.style.backgroundColor=c;
            circle.onclick=()=>{ document.querySelectorAll('.color-circle').forEach(e=>e.classList.remove('selected')); circle.classList.add('selected'); $('new-tag-color-val').value=c; };
            colorsCont.appendChild(circle);
        });
        window.Modal.open("modal-new-tag");
    };
    
    window.openEditTagModal = (tag) => {
        editingTagId = tag.id; $('new-tag-name').value=tag.name; $('new-tag-color-val').value=tag.color;
        const colorsCont = $('new-tag-colors'); colorsCont.innerHTML="";
        TAG_COLORS.forEach(c => {
            const circle = document.createElement("div"); circle.className = `color-circle ${c===tag.color?'selected':''}`; circle.style.backgroundColor=c;
            circle.onclick=()=>{ document.querySelectorAll('.color-circle').forEach(e=>e.classList.remove('selected')); circle.classList.add('selected'); $('new-tag-color-val').value=c; };
            colorsCont.appendChild(circle);
        });
        window.Modal.open("modal-new-tag");
    };

    // ... in setupUI ...

    // Nieuwe Tag aanmaken
    $('btnSaveNewTag').onclick = async () => {
        const name=$('new-tag-name').value; const color=$('new-tag-color-val').value;
        // Haal type op uit radio buttons
        const category = document.querySelector('input[name="tagType"]:checked').value;
        
        if(!name) return showToast("Naam verplicht", "error");
        
        if(editingTagId) {
            // Bij editen, behoud bestaande category tenzij we dat ook willen aanpassen (nu niet in UI voor edit)
            await updateTag(editingTagId, {name, color, category}); 
        } else {
            await addTag({uid:currentUser.uid, name, color, builtin:false, active:true, category: category});
        }
        window.Modal.close();
    };

    // Opslaan Kaart
    $('btnSaveCard').onclick = async () => {
        const title = $('inpTitle').value; 
        if(!title) return showToast("Titel verplicht", "error");
        
        // 1. Tags
        const tagIds = JSON.parse($('card-tags-list').dataset.selected || "[]");
        
        // 2. Prioriteit (NIEUW: Haal uit dataset ipv value)
        const priorityId = $('prio-tags-list').dataset.selected || null;

        let dueTimestamp = null;
        if ($('inpDate').value) {
            const d = new Date($('inpDate').value); 
            d.setHours(12, 0, 0, 0); 
            dueTimestamp = d;
        }

        const data = {
            uid: currentUser.uid, 
            boardId, 
            title,
            description: $('inpDesc').value,
            dueDate: dueTimestamp,
            priorityId: priorityId, 
            tags: tagIds,
            checklist: currentChecklist,
            links: currentLinks,
            logs: currentLogs
        };

        if(currentCardId) { 
            await updateDoc(doc(db, "workflowCards", currentCardId), data); 
            showToast("Opgeslagen", "success"); 
        } else {
            const firstCol = columns[0] ? columns[0].id : null;
            if(!firstCol) return showToast("Geen kolom", "error");
            data.columnId = firstCol; 
            data.createdAt = serverTimestamp();
            await addDoc(collection(db, "workflowCards"), data); 
            showToast("Aangemaakt", "success");
        }
        window.Modal.close();
    };
    
    // Helper voor edit tag modal invullen (moet ook radio button zetten)
    window.openEditTagModal = (tag) => {
        editingTagId = tag.id; 
        $('new-tag-name').value=tag.name; 
        $('new-tag-color-val').value=tag.color;
        
        // Zet radio button juist
        const radios = document.getElementsByName('tagType');
        for(let r of radios) { r.checked = (r.value === (tag.category || 'standard')); }

        const colorsCont = $('new-tag-colors'); colorsCont.innerHTML="";
        TAG_COLORS.forEach(c => {
            const circle = document.createElement("div"); circle.className = `color-circle ${c===tag.color?'selected':''}`; circle.style.backgroundColor=c;
            circle.onclick=()=>{ document.querySelectorAll('.color-circle').forEach(e=>e.classList.remove('selected')); circle.classList.add('selected'); $('new-tag-color-val').value=c; };
            colorsCont.appendChild(circle);
        });
        window.Modal.open("modal-new-tag");
    };

    $('btnDeleteCard').onclick = async () => { if(confirm("Verwijderen?")) { if(currentCardId) await deleteDoc(doc(db, "workflowCards", currentCardId)); window.Modal.close(); } };
    $('btnCloseQuick').onclick = () => $('modal-quick-plan').hidden = true;
    $('btnConfirmPlan').onclick = sendToAgenda;

    // Tabs
    document.querySelectorAll('#modal-card .wf-tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('#modal-card .wf-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('#modal-card .wf-tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        };
    });
    
    // Settings Tabs
    window.switchSettingsTab = (tabName) => {
        document.querySelectorAll('#modal-settings .wf-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('#modal-settings .wf-settings-content').forEach(c => c.classList.remove('active'));
        if(tabName==='tags') { document.querySelector('#modal-settings .wf-tab-btn:nth-child(1)').classList.add('active'); $('set-tab-tags').classList.add('active'); }
        else if(tabName==='cols') { document.querySelector('#modal-settings .wf-tab-btn:nth-child(2)').classList.add('active'); $('set-tab-cols').classList.add('active'); }
        else { document.querySelector('#modal-settings .wf-tab-btn:nth-child(3)').classList.add('active'); $('set-tab-lists').classList.add('active'); }
    };
    
    async function sendToAgenda() {
    if(!apiSettings.webhookUrl) return showToast("Geen API settings", "error");
    const date = $('qp-date').value; const time = $('qp-time').value;
    if(!date || !time) return showToast("Datum/tijd verplicht", "error");
    
    showToast("Verzenden...", "info");
    const startIso = `${date}T${time}:00`;
    const sDate = new Date(startIso); sDate.setHours(sDate.getHours() + 2);
    const offset = sDate.getTimezoneOffset() * 60000;
    const endIso = (new Date(sDate - offset)).toISOString().slice(0, -1).split('.')[0];

    const payload = {
        token: apiSettings.token, calendarId: "werk", title: "Focus - " + $('inpTitle').value,
        start: startIso, end: endIso, description: $('inpDesc').value, location: "Kantoor", tz: "Europe/Brussels"
    };

    try {
        const res = await fetch(apiSettings.webhookUrl, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
        if(res.ok) { showToast("Ingepland!", "success"); $('modal-quick-plan').hidden=true; }
        else showToast("Fout", "error");
    } catch(e) { showToast("Netwerkfout", "error"); }
}
}

init();