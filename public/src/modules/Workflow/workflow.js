import { getCurrentUser, watchUser } from "../../services/auth.js";
import { showToast } from "../../components/toast.js";
import {
    subscribeToColumns, addColumn, updateColumn, deleteColumn,
    subscribeToTags, addTag, updateTag, deleteTag,
    subscribeToChecklistTemplates, addChecklistTemplate, deleteChecklistTemplate,
    subscribeToCardTypes, addCardType, updateCardType, deleteCardType,
    getFirebaseApp, getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, setDoc,
    getDoc, getDocs, serverTimestamp, query, where, onSnapshot
} from "../../services/db.js";


/**
 * @typedef {{ id: string, uid: string, boardId: string, title: string, order: number }} Column
 * @typedef {{ id: string, uid: string, name: string, color: string, builtin: boolean, active: boolean, category: 'priority'|'standard' }} Tag
 * @typedef {{ text: string, done: boolean }} ChecklistItem
 * @typedef {{ title: string, url: string }} Link
 * @typedef {{ content: string, timestamp: string }} Log
 * @typedef {{ id: string, uid: string, boardId: string, columnId: string, title: string, description?: string, dueDate?: object, priorityId?: string, tags: string[], checklist: ChecklistItem[], links: Link[], logs: Log[], createdAt?: object, finishedAt?: object, deleteAt?: object }} Card
 * @typedef {{ id: string, uid: string, name: string, items: ChecklistItem[] }} ChecklistTemplate
 * @typedef {{ webhookUrl: string, token: string }} ApiSettings
 */

const app = getFirebaseApp();
const db = getFirestore(app);

// State
let currentUser = null;
/** @type {string|null} */ let boardId = null;
/** @type {Column[]} */    let columns = [];
/** @type {Card[]} */      let cards = [];
/** @type {Tag[]} */       let tags = [];
/** @type {ChecklistTemplate[]} */ let checklistTemplates = [];
/** @type {Array} */             let cardTypes = [];
let activeFilters = {
    /** @type {string[]} */ priorities: [],
    /** @type {string[]} */ tags: [],
    /** @type {string[]} */ types: [],
    showNewOnly: false
};

// Multi-board state
let activeBoardType = localStorage.getItem('wf_active_board') || 'workflow';
let boardIds = {};
let quickFilterConfig = { workflow: [], websites: [] };
let activeStreamUnsubscribers = [];

// Temp state voor modals
/** @type {string|null} */       let currentCardId = null;
/** @type {ChecklistItem[]} */   let currentChecklist = [];
/** @type {ChecklistItem[]} */   let currentSubtasks = [];
/** @type {Link[]} */            let currentLinks = [];
/** @type {Log[]} */             let currentLogs = [];
/** @type {ChecklistItem[]} */   let tempTemplateItems = [];
/** @type {Array} */             let cardTemplates = [];

let cardModalSnapshot = null;
let tagModalSnapshot  = null;
let currentTagPages   = [];   // temp state tag modal pages
let currentCardPage   = null; // selected page in card modal
let currentTypeId     = null; // selected type in card modal
let editingTypeId     = null; // type being edited in settings
let viewMode = 'kanban'; // 'kanban' | 'list'
let selectedCards = new Set();
let bulkMode = false;
let touchDrag = null; // touch drag-drop state

/** @type {ApiSettings} */ let apiSettings = { webhookUrl: "", token: "" };

const $ = id => document.getElementById(id);
const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/**
 * @param {string} message
 * @returns {Promise<boolean>}
 */
function confirmDialog(message) {
    return new Promise(resolve => {
        $('confirm-message').textContent = message;
        $('modal-confirm').hidden = false;
        const cleanup = result => { $('modal-confirm').hidden = true; resolve(result); };
        $('btnConfirmYes').onclick = () => cleanup(true);
        $('btnConfirmNo').onclick  = () => cleanup(false);
    });
}

function inputDialog(label, placeholder = "", defaultValue = "") {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999';
        const box = document.createElement('div');
        box.style.cssText = 'background:var(--card,#1e293b);border:1px solid var(--border,#334155);border-radius:12px;padding:24px;max-width:380px;width:90%;display:flex;flex-direction:column;gap:14px';
        const lbl = document.createElement('p');
        lbl.textContent = label;
        lbl.style.cssText = 'margin:0;font-size:0.95rem;font-weight:600';
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = placeholder;
        inp.value = defaultValue;
        inp.style.cssText = 'padding:10px 12px;border-radius:8px;border:1px solid var(--border,#334155);background:var(--bg,#0f172a);color:var(--fg,#e2e8f0);font-size:0.95rem;width:100%;box-sizing:border-box';
        const btns = document.createElement('div');
        btns.style.cssText = 'display:flex;justify-content:flex-end;gap:10px';
        const no = document.createElement('button');
        no.textContent = 'Annuleren';
        no.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid var(--border,#334155);background:transparent;cursor:pointer;color:inherit';
        const yes = document.createElement('button');
        yes.textContent = 'OK';
        yes.style.cssText = 'padding:6px 14px;border-radius:6px;border:none;background:var(--brand,#3b82f6);color:#fff;cursor:pointer';
        btns.append(no, yes);
        box.append(lbl, inp, btns);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        inp.focus();
        const cleanup = result => { overlay.remove(); resolve(result); };
        yes.onclick = () => cleanup(inp.value.trim() || null);
        no.onclick = () => cleanup(null);
        overlay.onclick = e => { if(e.target === overlay) cleanup(null); };
        inp.addEventListener('keydown', e => {
            if(e.key === 'Enter') cleanup(inp.value.trim() || null);
            if(e.key === 'Escape') cleanup(null);
        });
    });
}

function captureCardState() {
    return JSON.stringify({
        title:    $('inpTitle').value,
        desc:     $('inpDesc').value,
        date:     $('inpDate').value,
        prio:     $('prio-tags-list').dataset.selected || "",
        tags:     $('card-tags-list').dataset.selected || "[]",
        color:    $('card-color-list')?.dataset.selected || "",
        page:     currentCardPage || "",
        typeId:   currentTypeId || "",
        checklist: currentChecklist,
        subtasks:  currentSubtasks,
        links:     currentLinks,
        logs:      currentLogs
    });
}
function isCardDirty() { return cardModalSnapshot !== null && cardModalSnapshot !== captureCardState(); }

function captureTagState() {
    const checked = document.querySelector('input[name="tagType"]:checked');
    return JSON.stringify({
        name:  $('new-tag-name').value,
        color: $('new-tag-color-val').value,
        type:  checked ? checked.value : 'standard',
        pages: [...currentTagPages]
    });
}
function isTagDirty() { return tagModalSnapshot !== null && tagModalSnapshot !== captureTagState(); }

function unsavedChangesDialog() {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:10000';
        const box = document.createElement('div');
        box.style.cssText = 'background:var(--card,#1e293b);border:1px solid var(--border,#334155);border-radius:12px;padding:24px;max-width:400px;width:90%;display:flex;flex-direction:column;gap:12px';
        const title = document.createElement('p');
        title.textContent = 'Niet-opgeslagen wijzigingen';
        title.style.cssText = 'margin:0;font-size:1rem;font-weight:700';
        const msg = document.createElement('p');
        msg.textContent = 'Je hebt wijzigingen die nog niet zijn opgeslagen. Wat wil je doen?';
        msg.style.cssText = 'margin:0;font-size:0.875rem;opacity:0.75';
        const btns = document.createElement('div');
        btns.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:4px';
        const mk = (text, css) => { const b = document.createElement('button'); b.textContent = text; b.style.cssText = css + ';padding:10px 14px;border-radius:8px;cursor:pointer;font-size:0.9rem;text-align:left'; return b; };
        const saveBtn    = mk('💾 Opslaan & Sluiten', 'border:none;background:var(--brand,#3b82f6);color:#fff');
        const discardBtn = mk('🗑️ Verwerpen & Sluiten', 'border:1px solid #ef4444;background:transparent;color:#ef4444');
        const stayBtn    = mk('Blijven (niet sluiten)', 'border:1px solid var(--border,#334155);background:transparent;color:inherit');
        btns.append(saveBtn, discardBtn, stayBtn);
        box.append(title, msg, btns);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        const cleanup = r => { overlay.remove(); resolve(r); };
        saveBtn.onclick    = () => cleanup('save');
        discardBtn.onclick = () => cleanup('discard');
        stayBtn.onclick    = () => cleanup('stay');
        overlay.onclick    = e => { if(e.target === overlay) cleanup('stay'); };
    });
}

const TAG_COLORS  = ["#3b82f6","#ef4444","#f97316","#eab308","#84cc16","#10b981","#06b6d4","#6366f1","#8b5cf6","#d946ef"];
const CARD_COLORS = [null, "#3b82f6","#ef4444","#f97316","#eab308","#10b981","#8b5cf6","#ec4899","#64748b"];

// --- MARKDOWN ---
function applyInlineMarkdown(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code class="wf-md-code">$1</code>');
}
function renderMarkdown(text) {
    if (!text) return '<span style="opacity:0.5;font-style:italic;">Geen omschrijving.</span>';
    const lines = escHtml(text).split('\n');
    const out = []; let inList = false;
    for (const line of lines) {
        const li = line.match(/^[-*]\s+(.+)$/);
        if (li) {
            if (!inList) { out.push('<ul class="wf-md-list">'); inList = true; }
            out.push(`<li>${applyInlineMarkdown(li[1])}</li>`);
        } else {
            if (inList) { out.push('</ul>'); inList = false; }
            out.push(line.trim() === ''
                ? '<div style="height:0.4rem"></div>'
                : `<p style="margin:0 0 2px">${applyInlineMarkdown(line)}</p>`);
        }
    }
    if (inList) out.push('</ul>');
    return out.join('');
}

// --- CARD COLOR PICKER ---
function renderCardColorPicker(selectedColor) {
    const cont = $('card-color-list');
    if (!cont) return;
    cont.innerHTML = '';
    CARD_COLORS.forEach(color => {
        const sw = document.createElement('div');
        sw.className = 'wf-card-color-swatch' + (selectedColor === color ? ' selected' : '');
        if (color) { sw.style.backgroundColor = color; }
        else       { sw.classList.add('none'); sw.textContent = '✕'; }
        sw.title = color || 'Geen kleur';
        sw.onclick = () => { cont.dataset.selected = color || ''; renderCardColorPicker(color); };
        cont.appendChild(sw);
    });
    cont.dataset.selected = selectedColor || '';
}

// --- PAGE SELECTOR (Websites bord) ---
function renderPageSelector(selectedTagIds) {
    const wrap = $('page-selector-wrap');
    const cont = $('card-page-selector');
    if (!wrap || !cont) return;

    if (activeBoardType !== 'websites') { wrap.style.display = 'none'; return; }

    const allPages = new Set();
    selectedTagIds.forEach(tagId => {
        const tag = tags.find(t => t.id === tagId);
        if (tag && tag.pages && tag.pages.length > 0) tag.pages.forEach(p => allPages.add(p));
    });

    if (allPages.size === 0) { wrap.style.display = 'none'; currentCardPage = null; return; }

    // Reset selection if chosen page no longer available
    if (currentCardPage && !allPages.has(currentCardPage)) currentCardPage = null;

    wrap.style.display = '';
    cont.innerHTML = '';

    // "Geen" chip
    const noneChip = document.createElement('div');
    noneChip.className = `wf-page-chip ${!currentCardPage ? 'selected' : ''}`;
    noneChip.textContent = '— Geen';
    noneChip.onclick = () => { currentCardPage = null; renderPageSelector(selectedTagIds); };
    cont.appendChild(noneChip);

    [...allPages].sort().forEach(page => {
        const chip = document.createElement('div');
        chip.className = `wf-page-chip ${currentCardPage === page ? 'selected' : ''}`;
        chip.textContent = page;
        // Find color from the tag that owns this page
        const ownerTag = tags.find(t => t.id && selectedTagIds.includes(t.id) && t.pages && t.pages.includes(page));
        if (ownerTag && currentCardPage === page) {
            chip.style.backgroundColor = ownerTag.color;
            chip.style.borderColor = ownerTag.color;
        }
        chip.onclick = () => { currentCardPage = page; renderPageSelector(selectedTagIds); };
        cont.appendChild(chip);
    });
}

function renderCardTypeSelector() {
    const cont = $('card-type-selector');
    if (!cont) return;
    cont.innerHTML = '';

    // "Geen type" chip
    const noneChip = document.createElement('div');
    noneChip.className = `wf-type-chip ${!currentTypeId ? 'selected none' : 'none'}`;
    noneChip.textContent = '— Geen';
    noneChip.onclick = () => { currentTypeId = null; renderCardTypeSelector(); };
    cont.appendChild(noneChip);

    cardTypes.forEach(type => {
        const isSelected = currentTypeId === type.id;
        const chip = document.createElement('div');
        chip.className = `wf-type-chip ${isSelected ? 'selected' : ''}`;
        chip.innerHTML = `<span class="wf-type-icon">${escHtml(type.icon)}</span><span>${escHtml(type.name)}</span>`;
        if (isSelected) {
            chip.style.backgroundColor = type.color;
            chip.style.borderColor = type.color;
            chip.style.color = '#fff';
        } else {
            chip.style.borderColor = type.color + '60';
            chip.style.color = type.color;
        }
        chip.onclick = () => { currentTypeId = type.id; renderCardTypeSelector(); };
        cont.appendChild(chip);
    });
}

function renderTagPagesList() {
    const cont = $('tag-pages-list');
    if (!cont) return;
    cont.innerHTML = '';
    if (currentTagPages.length === 0) {
        cont.innerHTML = '<span class="tag-pages-empty">Nog geen pagina\'s. Voeg er een toe hieronder.</span>';
        return;
    }
    currentTagPages.forEach((page, idx) => {
        const row = document.createElement('div');
        row.className = 'tag-page-row';
        const name = document.createElement('span');
        name.className = 'tag-page-name';
        name.textContent = page;
        const del = document.createElement('button');
        del.type = 'button';
        del.innerHTML = '✕';
        del.className = 'del-icon-btn';
        del.style.fontSize = '0.85rem';
        del.onclick = () => { currentTagPages.splice(idx, 1); renderTagPagesList(); };
        row.append(name, del);
        cont.appendChild(row);
    });
}

function updateTagPagesVisibility() {
    const websitesChecked = document.querySelector('input[name="tagBoard"][value="websites"]')?.checked;
    const section = $('tag-pages-section');
    if (section) section.style.display = websitesChecked ? '' : 'none';
}

// --- STATISTIEKEN ---
function openStatsModal() {
    const doneCol   = columns.find(c => c.title.toLowerCase() === 'afgewerkt');
    const doneColId = doneCol ? doneCol.id : null;
    const now       = new Date();
    const weekAgo   = new Date(now - 7  * 864e5);
    const monthAgo  = new Date(now - 30 * 864e5);
    const today     = new Date(now); today.setHours(0,0,0,0);

    const active = cards.filter(c => c.columnId !== doneColId);
    const done   = cards.filter(c => c.columnId === doneColId);
    const toDate = x => x?.toDate ? x.toDate() : (x ? new Date(x) : null);

    const doneWeek  = done.filter(c => { const d = toDate(c.finishedAt); return d && d >= weekAgo; });
    const doneMonth = done.filter(c => { const d = toDate(c.finishedAt); return d && d >= monthAgo; });
    const overdue   = active.filter(c => { const d = toDate(c.dueDate); return d && d < today; });

    const withBoth  = done.filter(c => c.createdAt && c.finishedAt);
    let avgDays = '-';
    if (withBoth.length) {
        const total = withBoth.reduce((s, c) => s + (toDate(c.finishedAt) - toDate(c.createdAt)), 0);
        avgDays = Math.round(total / withBoth.length / 864e5) + 'd';
    }

    const colBreakdown = columns.filter(c => c.id !== doneColId)
        .sort((a, b) => a.order - b.order)
        .map(col => ({
            title: col.title,
            count: cards.filter(c => c.columnId === col.id).length,
            limit: col.wipLimit || 0
        }));

    $('stats-body').innerHTML = `
        <div class="wf-stats-grid">
            <div class="wf-stat-tile"><div class="wf-stat-value">${active.length}</div><div class="wf-stat-label">Actieve kaarten</div></div>
            <div class="wf-stat-tile ok"><div class="wf-stat-value">${doneWeek.length}</div><div class="wf-stat-label">Afgewerkt deze week</div></div>
            <div class="wf-stat-tile ok"><div class="wf-stat-value">${doneMonth.length}</div><div class="wf-stat-label">Afgewerkt deze maand</div></div>
            <div class="wf-stat-tile ${overdue.length ? 'danger' : ''}"><div class="wf-stat-value">${overdue.length}</div><div class="wf-stat-label">Verlopen deadlines</div></div>
            <div class="wf-stat-tile"><div class="wf-stat-value">${avgDays}</div><div class="wf-stat-label">Gem. doorlooptijd</div></div>
        </div>
        <div class="wf-stats-cols">
            <h4>Kaarten per kolom</h4>
            ${colBreakdown.map(c => `
                <div class="wf-stats-col-row">
                    <span>${escHtml(c.title)}</span>
                    <div class="wf-stats-col-bar-wrap">
                        <div class="wf-stats-col-bar" style="width:${active.length ? Math.round(c.count/active.length*100) : 0}%"></div>
                    </div>
                    <span class="wf-stats-col-count ${c.limit && c.count > c.limit ? 'over-limit' : ''}">${c.count}${c.limit ? '/' + c.limit : ''}</span>
                </div>`).join('')}
        </div>`;
    window.Modal.open('modal-stats');
}

// --- HERORDENEN BINNEN KOLOM ---
async function reorderCardsInColumn(draggedId, targetId, colId, insertBefore) {
    let colCards = cards
        .filter(c => c.columnId === colId)
        .sort((a, b) => (a.cardOrder ?? 999999) - (b.cardOrder ?? 999999));
    const draggedIdx = colCards.findIndex(c => c.id === draggedId);
    if (draggedIdx === -1) return;
    const [dragged] = colCards.splice(draggedIdx, 1);
    const newTargetIdx = colCards.findIndex(c => c.id === targetId);
    if (newTargetIdx === -1) return;
    colCards.splice(insertBefore ? newTargetIdx : newTargetIdx + 1, 0, dragged);
    try {
        await Promise.all(colCards.map((card, idx) =>
            updateDoc(doc(db, "workflowCards", card.id), { cardOrder: idx * 100 })
        ));
    } catch(err) { console.error(err); showToast("Volgorde opslaan mislukt", "error"); }
}

// --- INIT ---
async function init() {
    watchUser((user) => {
        if (!user) { window.location.href = "../../../index.html"; return; }
        currentUser = user;
        document.getElementById("app").style.display = "block";
        fetchApiSettings(user.uid);
        Promise.all([
            ensureBoardByType(user.uid, 'workflow'),
            ensureBoardByType(user.uid, 'websites')
        ]).then(([wfId, webId]) => {
            boardIds = { workflow: wfId, websites: webId };
            boardId = boardIds[activeBoardType];
            setupBoardTabs();
            startStreams();
        });
        setupUI();
    });
}

async function fetchApiSettings(uid) {
    try {
        const snap = await getDoc(doc(db, "settings", uid));
        if (snap.exists()) {
            const data = snap.data();
            apiSettings = data;
            if (data.quickFilters) {
                quickFilterConfig = { workflow: [], websites: [], ...data.quickFilters };
            }
        }
    } catch (e) { console.warn(e); }
}

async function ensureBoardByType(uid, type) {
    // Zoek bestaand board van dit type
    const q = query(collection(db, "workflowBoards"), where("uid", "==", uid), where("type", "==", type));
    const snap = await getDocs(q);
    if (!snap.empty) return snap.docs[0].id;

    // Migratie: oud workflow-board zonder type-veld toewijzen aan 'workflow'
    if (type === 'workflow') {
        const oldQ = query(collection(db, "workflowBoards"), where("uid", "==", uid));
        const oldSnap = await getDocs(oldQ);
        const legacy = oldSnap.docs.find(d => !d.data().type);
        if (legacy) {
            await updateDoc(doc(db, "workflowBoards", legacy.id), { type: 'workflow' });
            return legacy.id;
        }
    }

    // Nieuw board aanmaken
    const defaultCols = type === 'websites'
        ? ["Idee", "In ontwikkeling", "Review", "Live"]
        : ["Backlog", "Te bespreken", "In progress", "Afgewerkt"];

    const ref = await addDoc(collection(db, "workflowBoards"), {
        uid,
        title: type === 'websites' ? "Websites Board" : "Mijn Board",
        type,
        createdAt: serverTimestamp()
    });
    for (let i = 0; i < defaultCols.length; i++) {
        await addDoc(collection(db, "workflowColumns"), { uid, boardId: ref.id, title: defaultCols[i], order: i + 1 });
    }
    if (type === 'workflow') {
        await ensureStandardTags(uid);
        await ensureStandardCardTypes(uid);
    }
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

async function ensureStandardCardTypes(uid) {
    const q = query(collection(db, "workflowCardTypes"), where("uid", "==", uid));
    const snap = await getDocs(q);
    if (snap.empty) {
        const defaults = [
            { name: 'Taak',        icon: '📋', color: '#64748b', order: 1 },
            { name: 'Bug',         icon: '🐛', color: '#ef4444', order: 2 },
            { name: 'Feature',     icon: '✨', color: '#3b82f6', order: 3 },
            { name: 'Verbetering', icon: '🔧', color: '#f97316', order: 4 },
            { name: 'Onderzoek',   icon: '🔍', color: '#8b5cf6', order: 5 },
        ];
        for (const d of defaults) await addCardType({ uid, ...d });
    }
}

function startStreams() {
    activeStreamUnsubscribers.forEach(fn => fn());
    activeStreamUnsubscribers = [];

    let initRender;
    const scheduleRender = () => { clearTimeout(initRender); initRender = setTimeout(renderBoard, 50); };

    const u1 = subscribeToColumns(currentUser.uid, boardId, (data) => {
        columns = data;
        scheduleRender();
        if (!$('modal-settings').hidden) renderColConfig();
    });
    const u2 = subscribeToTags(currentUser.uid, (data) => {
        tags = data;
        scheduleRender();
        if (!$('modal-settings').hidden) renderTagConfig();
        renderQuickFilterButtons();
        renderQuickFilterConfig();
        if (cards.length > 0) checkUrgentItems();
    });
    const u3 = subscribeToChecklistTemplates(currentUser.uid, (data) => {
        checklistTemplates = data;
        if (!$('modal-settings').hidden) renderTemplateConfig();
        populateTemplateSelect();
    });
    const u6 = subscribeToCardTypes(currentUser.uid, (data) => {
        cardTypes = data;
        scheduleRender();
        if (!$('modal-settings').hidden) renderTypeConfig();
    });
    const qtpl = query(collection(db, "workflowCardTemplates"), where("uid", "==", currentUser.uid));
    const u5 = onSnapshot(qtpl, snap => {
        cardTemplates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        populateCardTemplateSelect();
        if (!$('modal-settings').hidden) renderCardTemplateConfig();
    });

    const q = query(collection(db, "workflowCards"), where("boardId", "==", boardId), where("uid", "==", currentUser.uid));
    const u4 = onSnapshot(q, (snap) => {
        cards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderBoard();
        checkUrgentItems();
        checkDeadlineNotifications();
    }, (err) => console.error(err));

    activeStreamUnsubscribers = [u1, u2, u3, u4, u5, u6];
}

// --- BOARD SWITCHER ---
function setupBoardTabs() {
    document.querySelectorAll('.wf-board-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.board === activeBoardType);
        tab.onclick = () => switchBoard(tab.dataset.board);
    });
}

async function switchBoard(type) {
    if (type === activeBoardType || !boardIds[type]) return;
    activeBoardType = type;
    localStorage.setItem('wf_active_board', type);
    boardId = boardIds[type];
    activeFilters = { priorities: [], tags: [], types: [], showNewOnly: false };
    columns = [];
    cards = [];
    setupBoardTabs();
    startStreams();
}

// Helper: welke borden heeft een tag? Standaard 'workflow' voor oude tags zonder boards-veld.
function getTagBoards(tag) {
    return (tag.boards && tag.boards.length > 0) ? tag.boards : ['workflow'];
}

async function saveQuickFilterConfig() {
    if (!currentUser) return;
    try {
        await setDoc(doc(db, "settings", currentUser.uid), { quickFilters: quickFilterConfig }, { merge: true });
    } catch (e) { console.warn('saveQuickFilterConfig:', e); }
}

// --- QUICK FILTER BUTTONS (toolbar) ---
function renderQuickFilterButtons() {
    const container = $('quick-filter-btns');
    if (!container) return;
    container.innerHTML = '';

    const doneCol = columns.find(c => ['afgewerkt', 'live'].includes(c.title.toLowerCase()));
    const doneColId = doneCol ? doneCol.id : null;
    const configuredIds = quickFilterConfig[activeBoardType] || [];

    configuredIds.forEach(tagId => {
        const tag = tags.find(t => t.id === tagId);
        if (!tag || tag.active === false) return;

        const count = cards.filter(c => {
            const hasTag = (c.tags || []).includes(tagId) || c.priorityId === tagId;
            return hasTag && c.columnId !== doneColId;
        }).length;

        const isActive = activeFilters.tags.includes(tagId) || activeFilters.priorities.includes(tagId);

        const btn = document.createElement('button');
        btn.className = `wf-btn icon-only wf-quick-filter-btn${isActive ? ' active-quick-filter' : ''}`;
        btn.title = `Filter: ${tag.name}`;
        btn.innerHTML = `<span class="qf-dot" style="background:${tag.color}"></span>${tag.name}${count > 0 ? ` <span class="qf-count">${count}</span>` : ''}`;

        btn.onclick = () => {
            if (tag.category === 'priority') {
                const i = activeFilters.priorities.indexOf(tagId);
                i > -1 ? activeFilters.priorities.splice(i, 1) : activeFilters.priorities.push(tagId);
            } else {
                const i = activeFilters.tags.indexOf(tagId);
                i > -1 ? activeFilters.tags.splice(i, 1) : activeFilters.tags.push(tagId);
            }
            renderBoard();
        };

        container.appendChild(btn);
    });
}

// --- QUICK FILTER CONFIG (instellingen) ---
function renderQuickFilterConfig() {
    ['workflow', 'websites'].forEach(boardType => {
        const list = $(`qf-list-${boardType}`);
        const countEl = $(`qf-count-${boardType}`);
        if (!list) return;
        list.innerHTML = '';

        const boardTags = tags.filter(t => t.active !== false && getTagBoards(t).includes(boardType));
        const selected = quickFilterConfig[boardType] || [];

        if (countEl) countEl.textContent = `${selected.length}/4 geselecteerd`;

        if (boardTags.length === 0) {
            list.innerHTML = '<span style="color:var(--muted); font-size:0.85rem; font-style:italic;">Geen tags beschikbaar voor dit bord.</span>';
            return;
        }

        boardTags.sort((a, b) => {
            if (a.category === 'priority' && b.category !== 'priority') return -1;
            if (b.category === 'priority' && a.category !== 'priority') return 1;
            return a.name.localeCompare(b.name);
        }).forEach(tag => {
            const isPinned = selected.includes(tag.id);
            const atMax = selected.length >= 4 && !isPinned;

            const row = document.createElement('div');
            row.className = `qf-row${isPinned ? ' pinned' : ''}`;

            const preview = document.createElement('span');
            preview.className = 'tag-preview';
            preview.style.backgroundColor = tag.color;
            preview.textContent = `${tag.category === 'priority' ? '⚡' : '🏷️'} ${tag.name}`;

            const btn = document.createElement('button');
            btn.className = `wf-btn small${isPinned ? ' wf-btn-primary' : ''}`;
            btn.textContent = isPinned ? '✓ Vastgezet' : '+ Vastzetten';
            btn.disabled = atMax;
            btn.title = atMax ? 'Maximum 4 snelle filters bereikt' : '';

            btn.onclick = async () => {
                const cfg = quickFilterConfig[boardType] || [];
                if (isPinned) {
                    quickFilterConfig[boardType] = cfg.filter(id => id !== tag.id);
                } else if (cfg.length < 4) {
                    quickFilterConfig[boardType] = [...cfg, tag.id];
                }
                await saveQuickFilterConfig();
                renderQuickFilterConfig();
                renderQuickFilterButtons();
            };

            row.appendChild(preview);
            row.appendChild(btn);
            list.appendChild(row);
        });
    });
}

// --- URGENTIE LOGICA ---
function checkUrgentItems() {
    // 1. Check of we het vandaag al genegeerd hebben
    const todayStr = new Date().toISOString().split('T')[0];
    if (localStorage.getItem(`wf_urgent_dismissed_${currentUser.uid}`) === todayStr) return;

    // 2. Zoek de ID van de 'Afgewerkt' kolom om deze uit te sluiten
    const doneColumn = columns.find(c => c.title.toLowerCase() === "afgewerkt");
    const doneColId = doneColumn ? doneColumn.id : null;

    const urgentItems = [];
    const today = new Date(); 
    today.setHours(0,0,0,0);

    cards.forEach(card => {
        // BELANGRIJK: Als kaart in 'Afgewerkt' staat -> Overslaan!
        if (doneColId && card.columnId === doneColId) return;

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

        // Regel 1: Tag "Critical" (Altijd tonen, ongeacht datum)
        if (cardTagNames.includes("critical")) {
            reason = "CRITICAL Tag";
            type = "critical";
        }
        // Regel 2: Over tijd (Rood)
        else if (diffDays !== null && diffDays < 0) {
            reason = `Vervallen (${Math.abs(diffDays)} dagen)`;
            type = "overdue";
        }
        // Regel 3: Tag "High" en <= 3 dagen (Aangepast)
        else if (cardTagNames.includes("high") && diffDays !== null && diffDays <= 3) {
            reason = "High Priority (< 3d)";
            type = "soon";
        }
        // Regel 4: Tag "Normal" en <= 2 dagen (Aangepast)
        else if (cardTagNames.includes("normal") && diffDays !== null && diffDays <= 2) {
            reason = "Normal Priority (< 2d)";
            type = "soon";
        }
        // Regel 5: Tag "Low" en <= 1 dag (Nieuw)
        else if (cardTagNames.includes("low") && diffDays !== null && diffDays <= 1) {
            reason = "Low Priority (< 1d)";
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

/**
 * @param {Array<{title: string, reason: string, type: string, date: object|null}>} items
 */
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
                <strong># ${escHtml(item.title)}</strong>
                <span style="font-size:0.8rem; color:#94a3b8; margin-left:8px;">${dateStr}</span>
            </div>
            <div class="wf-urgent-reason reason-${escHtml(item.type)}">
                ${escHtml(item.reason)}
            </div>
        `;
        list.appendChild(row);
    });

    $('modal-urgent').hidden = false;
}
// --- BROWSER NOTIFICATIES ---
function updateNotifBtn() {
    const btn = $('btnNotifToggle');
    if (!btn || !('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        btn.textContent = '🔔'; btn.title = 'Meldingen aan (klik om uit te schakelen)';
        btn.classList.add('active-quick-filter');
    } else {
        btn.textContent = '🔕'; btn.title = 'Deadline meldingen inschakelen';
        btn.classList.remove('active-quick-filter');
    }
}

function checkDeadlineNotifications() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const todayStr = new Date().toISOString().split('T')[0];
    const storageKey = `wf_notif_${currentUser.uid}_${todayStr}`;
    const notified = new Set(JSON.parse(localStorage.getItem(storageKey) || '[]'));

    const doneCol = columns.find(c => c.title.toLowerCase() === 'afgewerkt');
    const doneColId = doneCol?.id;
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    let changed = false;
    cards.forEach(card => {
        if (card.columnId === doneColId || notified.has(card.id) || !card.dueDate) return;
        let d = card.dueDate.toDate ? card.dueDate.toDate() : new Date(card.dueDate);
        d.setHours(0,0,0,0);
        let msg = null;
        if (d < today) msg = `Vervallen deadline (${d.toLocaleDateString('nl-BE')})`;
        else if (d.getTime() === today.getTime()) msg = 'Deadline is vandaag!';
        else if (d.getTime() === tomorrow.getTime()) msg = 'Deadline is morgen';
        if (msg) {
            new Notification(`⚡ ${card.title}`, { body: msg, icon: '/IMG/JD_Web_Solutions.ico' });
            notified.add(card.id); changed = true;
        }
    });
    if (changed) localStorage.setItem(storageKey, JSON.stringify([...notified]));
}

/**
 * @param {string|null} prioId
 * @returns {number}
 */
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

// --- LIJST VIEW ---
function renderListView() {
    const board = $('workflow-board');
    board.innerHTML = "";

    const doneCol   = columns.find(c => c.title.toLowerCase() === 'afgewerkt');
    const doneColId = doneCol?.id;
    const today     = new Date(); today.setHours(0,0,0,0);

    let listCards = cards
        .filter(c => c.columnId !== doneColId && shouldShowCard(c))
        .sort((a, b) => {
            const da = a.dueDate ? (a.dueDate.toDate ? a.dueDate.toDate() : new Date(a.dueDate)) : null;
            const db2 = b.dueDate ? (b.dueDate.toDate ? b.dueDate.toDate() : new Date(b.dueDate)) : null;
            if (da && db2) return da - db2;
            if (da) return -1; if (db2) return 1;
            return getPriorityWeight(a.priorityId) - getPriorityWeight(b.priorityId);
        });

    const table = document.createElement('table');
    table.className = 'wf-list-table';
    table.innerHTML = `<thead><tr>
        <th>Type</th><th>Prioriteit</th><th>Titel</th><th>Kolom</th><th>Labels</th><th>Deadline</th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');

    listCards.forEach(card => {
        const col = columns.find(c => c.id === card.columnId);
        let prioHtml = '<span class="muted">—</span>';
        if (card.priorityId) {
            const p = tags.find(t => t.id === card.priorityId);
            if (p) prioHtml = `<span class="wf-badge" style="background:${p.color}">${escHtml(p.name)}</span>`;
        }
        let labelsHtml = (card.tags || []).map(tid => {
            const t = tags.find(x => x.id === tid);
            return t ? `<span class="wf-badge" style="background:${t.color}">${escHtml(t.name)}</span>` : '';
        }).join('');

        let dateHtml = '<span class="muted">—</span>';
        if (card.dueDate) {
            let d = card.dueDate.toDate ? card.dueDate.toDate() : new Date(card.dueDate);
            d.setHours(0,0,0,0);
            const isToday   = d.getTime() === today.getTime();
            const isOverdue = d < today;
            const fmt = d.toLocaleDateString('nl-BE', {day:'2-digit', month:'2-digit'});
            const style = isOverdue ? 'color:#ef4444;font-weight:700' : isToday ? 'color:#f97316;font-weight:700' : '';
            dateHtml = `<span style="${style}">📅 ${fmt}${isToday ? ' ⚡' : ''}</span>`;
        }

        const colorBar = card.cardColor ? `style="border-left:4px solid ${card.cardColor}; padding-left:8px;"` : '';
        let listPagePrefix = '';
        if (card.cardPage && activeBoardType === 'websites') {
            const ownerTag = tags.find(t => (card.tags || []).includes(t.id) && t.pages && t.pages.includes(card.cardPage));
            const col2 = ownerTag ? `border-color:${ownerTag.color};color:${ownerTag.color};` : '';
            listPagePrefix = `<span class="wf-page-prefix" style="${col2} margin-right:6px;">${escHtml(card.cardPage)}</span>`;
        }
        let typeHtml = '<span class="muted">—</span>';
        if (card.typeId) {
            const typeObj = cardTypes.find(t => t.id === card.typeId);
            if (typeObj) typeHtml = `<span class="wf-card-type-badge" style="background:${typeObj.color}20; color:${typeObj.color}; border-color:${typeObj.color}40;">${escHtml(typeObj.icon)} ${escHtml(typeObj.name)}</span>`;
        }
        const tr = document.createElement('tr');
        tr.className = 'wf-list-row';
        tr.innerHTML = `
            <td>${typeHtml}</td>
            <td>${prioHtml}</td>
            <td ${colorBar}>${listPagePrefix}<strong>${escHtml(card.title)}</strong></td>
            <td><span class="wf-list-col-badge">${escHtml(col?.title || '—')}</span></td>
            <td>${labelsHtml || '<span class="muted">—</span>'}</td>
            <td>${dateHtml}</td>
        `;
        tr.onclick = () => openCardModal(card);
        tbody.appendChild(tr);
    });

    if (!listCards.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;opacity:0.5;padding:2rem;">Geen actieve kaarten</td></tr>';
    }

    table.appendChild(tbody);
    board.appendChild(table);
}

// --- HOVER PREVIEW ---
function showCardPreview(card, anchorEl) {
    const tooltip = $('card-preview-tooltip');
    if (!tooltip) return;

    const prio = card.priorityId ? tags.find(t => t.id === card.priorityId) : null;
    const cardTagObjs = (card.tags || []).map(id => tags.find(t => t.id === id)).filter(Boolean);

    let dateStr = '';
    if (card.dueDate) {
        const d = card.dueDate.toDate ? card.dueDate.toDate() : new Date(card.dueDate);
        const today = new Date(); today.setHours(0,0,0,0);
        d.setHours(0,0,0,0);
        const isOverdue = d < today;
        const isToday = d.getTime() === today.getTime();
        const fmt = d.toLocaleDateString('nl-BE', {day:'2-digit', month:'2-digit', year:'numeric'});
        dateStr = `<div class="wf-preview-meta" style="${isOverdue ? 'color:#ef4444' : isToday ? 'color:#f97316' : ''}">📅 ${fmt}${isToday ? ' ⚡' : ''}</div>`;
    }

    const desc = card.description ? escHtml(card.description.substring(0, 180)) + (card.description.length > 180 ? '…' : '') : '';
    const checkDone  = (card.checklist || []).filter(i => i.done).length;
    const checkTotal = (card.checklist || []).length;
    const subDone    = (card.subtasks  || []).filter(i => i.done).length;
    const subTotal   = (card.subtasks  || []).length;
    const logCount   = (card.logs      || []).length;

    const typeObj = card.typeId ? cardTypes.find(t => t.id === card.typeId) : null;
    tooltip.innerHTML = `
        <div class="wf-preview-title">${escHtml(card.title)}</div>
        ${typeObj ? `<div style="margin-bottom:6px"><span class="wf-card-type-badge" style="background:${typeObj.color}20;color:${typeObj.color};border-color:${typeObj.color}40;">${escHtml(typeObj.icon)} ${escHtml(typeObj.name)}</span></div>` : ''}
        ${prio ? `<div style="margin-bottom:4px"><span class="wf-badge" style="background:${prio.color}">${escHtml(prio.name)}</span></div>` : ''}
        ${cardTagObjs.length ? `<div class="wf-preview-tags">${cardTagObjs.map(t => `<span class="wf-badge" style="background:${t.color}">${escHtml(t.name)}</span>`).join('')}</div>` : ''}
        ${dateStr}
        ${desc ? `<div class="wf-preview-desc">${desc}</div>` : ''}
        ${checkTotal ? `<div class="wf-preview-meta">✅ ${checkDone}/${checkTotal} checklist</div>` : ''}
        ${subTotal   ? `<div class="wf-preview-meta">📋 ${subDone}/${subTotal} sub-taken</div>`   : ''}
        ${logCount   ? `<div class="wf-preview-meta">💬 ${logCount} log${logCount !== 1 ? 's' : ''}</div>` : ''}
    `;

    tooltip.hidden = false;
    const rect = anchorEl.getBoundingClientRect();
    const tipW = 270;
    const spaceRight = window.innerWidth - rect.right;
    tooltip.style.top  = `${rect.top + window.scrollY}px`;
    tooltip.style.left = spaceRight >= tipW + 16
        ? `${rect.right + window.scrollX + 8}px`
        : `${rect.left  + window.scrollX - tipW - 8}px`;
}

function hideCardPreview() {
    const t = $('card-preview-tooltip');
    if (t) t.hidden = true;
}

// --- RENDERING BOARD ---
function renderBoard() {
    if (viewMode === 'list') { renderListView(); return; }
    const board = $('workflow-board');
    board.innerHTML = "";
    
    // --- HELPER: Is een kaart nieuwer dan 24u? ---
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    
    const isNew = (card) => {
        if(!card.createdAt) return false;
        const d = card.createdAt.toDate ? card.createdAt.toDate() : new Date(card.createdAt);
        return d > oneDayAgo;
    };

    // --- 1. TELLERS & TOOLBAR UPDATES ---
    
    // Zoek de 'Afgewerkt' kolom ID (om deze niet mee te tellen in badges)
    const doneColumn = columns.find(c => c.title.toLowerCase() === "afgewerkt");
    const doneColId = doneColumn ? doneColumn.id : null;

    // A. Update de "Nieuw" Teller (Belletje)
    // We tellen alleen kaarten die NIET in afgewerkt staan
    const newCardsCount = cards.filter(c => isNew(c) && c.columnId !== doneColId).length;
    
    const btnNew = $('btnShowNew');
    const badgeNew = $('badge-new-count');
    
    if(btnNew && badgeNew) {
        badgeNew.textContent = newCardsCount;
        
        // Toon knop alleen als er nieuwe items zijn OF als de filter actief is
        if (newCardsCount > 0 || activeFilters.showNewOnly) {
            btnNew.style.display = "inline-flex";
        } else {
            btnNew.style.display = "none";
        }

        // Active state styling
        if (activeFilters.showNewOnly) {
            btnNew.classList.add('active-quick-filter');
        } else {
            btnNew.classList.remove('active-quick-filter');
        }
    }

    // B. Update Quick Filter Buttons (dynamisch op basis van configuratie)
    renderQuickFilterButtons();

    // C. Update Algemene Filter Knop Tekst
    const hasFilters = activeFilters.priorities.length > 0 || activeFilters.tags.length > 0 || activeFilters.types.length > 0;
    const btnFilter = $('btnFilterTags');
    if(btnFilter) {
        if(hasFilters) {
            btnFilter.classList.add('active-filter');
            btnFilter.innerHTML = `🏷️ Filter (${activeFilters.types.length + activeFilters.priorities.length + activeFilters.tags.length})`;
        } else {
            btnFilter.classList.remove('active-filter');
            btnFilter.innerHTML = `🏷️ Filter`;
        }
    }

    // --- 2. KOLOMMEN RENDEREN ---
    columns.sort((a,b) => a.order - b.order);
    
    columns.forEach(col => {
        const colEl = document.createElement("div");
        colEl.className = "wf-column";
        colEl.dataset.colId = col.id;
        
        // Basis set kaarten voor deze kolom
        let colCards = cards.filter(c => c.columnId === col.id);

        // Speciaal: 14 Dagen Filter voor 'Afgewerkt' kolom (Performance/Opruiming)
        if (col.title.toLowerCase() === "afgewerkt") {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 14); 

            colCards = colCards.filter(card => {
                if (!card.finishedAt) return true; 
                const fDate = card.finishedAt.toDate ? card.finishedAt.toDate() : new Date(card.finishedAt);
                return fDate >= cutoffDate; 
            });
        }
        
        // A. Zoekbalk Filter
        colCards = colCards.filter(c => shouldShowCard(c));
        
        // B. Actieve Filters (Prioriteit & Tags)
        if (hasFilters) {
            colCards = colCards.filter(c => {
                if (activeFilters.types.length > 0) {
                    if (!activeFilters.types.includes(c.typeId)) return false;
                }
                if (activeFilters.priorities.length > 0) {
                    if (!c.priorityId) return false;
                    if (!activeFilters.priorities.includes(c.priorityId)) return false;
                }
                if (activeFilters.tags.length > 0) {
                    if (!c.tags || c.tags.length === 0) return false;
                    const hasMatch = c.tags.some(tagId => activeFilters.tags.includes(tagId));
                    if (!hasMatch) return false;
                }
                return true;
            });
        }

        // C. NIEUW FILTER: "Toon alleen nieuwe"
        if (activeFilters.showNewOnly) {
            colCards = colCards.filter(c => isNew(c));
        }

        // D. Sorteren: handmatige volgorde primair, daarna prioriteit
        colCards.sort((a, b) => {
            const oa = a.cardOrder ?? 999999, ob = b.cardOrder ?? 999999;
            if (oa !== ob) return oa - ob;
            return getPriorityWeight(a.priorityId) - getPriorityWeight(b.priorityId);
        });

        // HTML Opbouw
        const count     = colCards.length;
        const wipLimit  = col.wipLimit && col.wipLimit > 0 ? col.wipLimit : 0;
        const overWip   = wipLimit > 0 && count > wipLimit;
        const badgeHtml = wipLimit
            ? `<span class="wf-count-badge${overWip ? ' over-wip' : ''}">${count}/${wipLimit}</span>`
            : `<span class="wf-count-badge">${count}</span>`;
        colEl.innerHTML = `<div class="wf-column-header${overWip ? ' wf-col-over-wip' : ''}"><span>${escHtml(col.title)}</span>${badgeHtml}</div>`;
        
        const cardsCont = document.createElement("div");
        cardsCont.className = "wf-column-cards";
        
        if(colCards.length === 0) {
            const empty = document.createElement("div");
            empty.className = "wf-empty-col";
            empty.textContent = "Sleep een kaart hier naartoe";
            cardsCont.appendChild(empty);
        } else {
            colCards.forEach(card => { cardsCont.appendChild(createCardEl(card)); });
        }
        
        // Drag & Drop events
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
    return card.title.toLowerCase().includes(term)
        || cardTags.includes(term)
        || (card.description || '').toLowerCase().includes(term)
        || (card.cardPage || '').toLowerCase().includes(term)
        || (card.logs || []).some(l => (l.content || '').toLowerCase().includes(term));
}

/**
 * @param {Card} card
 * @returns {HTMLElement}
 */
function createCardEl(card) {
    const el = document.createElement("div");
    el.className = "wf-card";
    el.draggable = true;
    el.dataset.id = card.id;
    
    let tagsHtml = "";

    // 1. RENDER PRIORITEIT
    if (card.priorityId) {
        const prioObj = tags.find(t => t.id === card.priorityId);
        if (prioObj && prioObj.active !== false) {
            tagsHtml += `<span class="wf-badge" style="background-color:${prioObj.color}; border:1px solid rgba(255,255,255,0.2);">${escHtml(prioObj.name)}</span>`;
        }
    }

    // 2. RENDER OVERIGE TAGS
    (card.tags || []).forEach(tagId => {
        const tagObj = tags.find(t => t.id === tagId);
        if(tagObj && tagObj.active !== false && tagObj.category !== 'priority') {
            tagsHtml += `<span class="wf-badge" style="background-color:${tagObj.color}">${escHtml(tagObj.name)}</span>`;
        }
    });

    // 3. DATUM LOGIC
    let dateHtml = "";
    if (card.dueDate) {
        let d = card.dueDate.toDate ? card.dueDate.toDate() : new Date(card.dueDate);
        if (!isNaN(d.getTime())) {
            d.setHours(0,0,0,0);
            const todayMid = new Date(); todayMid.setHours(0,0,0,0);
            const isToday   = d.getTime() === todayMid.getTime();
            const isOverdue = d < todayMid;
            const day   = String(d.getDate()).padStart(2,'0');
            const month = String(d.getMonth()+1).padStart(2,'0');
            const style = isOverdue ? 'color:#ef4444;font-weight:800;'
                        : isToday   ? 'color:#f97316;font-weight:700;'
                        : '';
            dateHtml = `<span class="wf-card-date" style="${style}">📅 ${day}/${month}${isToday ? ' ⚡' : ''}</span>`;
        }
    }

    // 4. PROGRESS LOGIC
    let progressHtml = "";
    if(card.checklist && card.checklist.length > 0) {
        const total = card.checklist.length;
        const done = card.checklist.filter(i => i.done).length;
        const pct = Math.round((done/total)*100);
        progressHtml = `<div class="wf-progress-container"><div class="wf-progress-bar" style="width:${pct}%"></div></div>`;
    }

    // 4b. SUBTASK COUNTER
    let subtaskHtml = "";
    if(card.subtasks && card.subtasks.length > 0) {
        const total = card.subtasks.length;
        const done = card.subtasks.filter(i => i.done).length;
        const allDone = done === total;
        subtaskHtml = `<span class="wf-subtask-count ${allDone ? 'done' : ''}">📋 ${done}/${total}</span>`;
    }

    // 4c. VEROUDERING (aging)
    let agingHtml = "";
    if (!card.finishedAt) {
        const lastAct = card.updatedAt || card.createdAt;
        if (lastAct) {
            const actDate = lastAct.toDate ? lastAct.toDate() : new Date(lastAct);
            const daysDiff = Math.floor((Date.now() - actDate) / 864e5);
            if (daysDiff >= 14) agingHtml = `<span class="wf-aging-badge danger" title="${daysDiff}d niet bijgewerkt">⏱ ${daysDiff}d</span>`;
            else if (daysDiff >= 7) agingHtml = `<span class="wf-aging-badge warning" title="${daysDiff}d niet bijgewerkt">⏱ ${daysDiff}d</span>`;
        }
    }

    // 5. NIEUW LABEL LOGIC
    let newBadgeHtml = "";
    if (card.createdAt) {
        const d = card.createdAt.toDate ? card.createdAt.toDate() : new Date(card.createdAt);
        const oneDayAgo = new Date(new Date().getTime() - (24 * 60 * 60 * 1000));
        // Als kaart jonger is dan 24u
        if (d > oneDayAgo) {
            newBadgeHtml = `<span class="wf-new-badge">NIEUW</span>`;
        }
    }

    // Type badge
    let typeBadgeHtml = '';
    if (card.typeId) {
        const typeObj = cardTypes.find(t => t.id === card.typeId);
        if (typeObj) {
            typeBadgeHtml = `<span class="wf-card-type-badge" style="background:${typeObj.color}20; color:${typeObj.color}; border-color:${typeObj.color}40;">${escHtml(typeObj.icon)} ${escHtml(typeObj.name)}</span>`;
        }
    }

    // Page prefix (alleen op Websites bord)
    let pagePrefixHtml = '';
    if (card.cardPage && activeBoardType === 'websites') {
        const ownerTag = tags.find(t => (card.tags || []).includes(t.id) && t.pages && t.pages.includes(card.cardPage));
        const prefixStyle = ownerTag ? `style="border-color:${ownerTag.color}; color:${ownerTag.color};"` : '';
        pagePrefixHtml = `<span class="wf-page-prefix" ${prefixStyle}>${escHtml(card.cardPage)}</span>`;
    }

    // Bovenste balk: type (links) + aging + datum (rechts)
    const topRowLeft  = typeBadgeHtml || pagePrefixHtml
        ? `<div class="wf-card-meta-left">${typeBadgeHtml}${pagePrefixHtml}</div>`
        : '<div></div>';
    const topRowRight = `<div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">${agingHtml}${dateHtml}</div>`;

    el.innerHTML = `
        <div class="wf-card-top-row">${topRowLeft}${topRowRight}</div>
        <div class="wf-card-title">${newBadgeHtml} ${escHtml(card.title)}</div>
        <div class="wf-tags" style="margin-top:4px;">${tagsHtml}</div>
        ${progressHtml}
        ${subtaskHtml}
    `;

    // Kaartkleur als linker accent-balk
    if (card.cardColor) el.style.borderLeft = `4px solid ${card.cardColor}`;

    // Events
    el.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", card.id); el.style.opacity = "0.5"; });
    el.addEventListener("dragend", () => {
        el.style.opacity = "1";
        document.querySelectorAll('.drop-above,.drop-below').forEach(c => c.classList.remove('drop-above','drop-below'));
    });
    el.addEventListener("dragover", e => {
        e.preventDefault(); e.stopPropagation();
        document.querySelectorAll('.drop-above,.drop-below').forEach(c => c.classList.remove('drop-above','drop-below'));
        const mid = el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2;
        el.classList.toggle('drop-above', e.clientY < mid);
        el.classList.toggle('drop-below', e.clientY >= mid);
    });
    el.addEventListener("dragleave", e => {
        if (!el.contains(e.relatedTarget)) el.classList.remove('drop-above','drop-below');
    });

    // Touch drag-drop
    el.addEventListener('touchstart', (e) => {
        if (bulkMode) return;
        const touch = e.touches[0];
        touchDrag = {
            cardId: card.id,
            el,
            startX: touch.clientX,
            startY: touch.clientY,
            moved: false,
            ghost: null,
            activeCol: null
        };
    }, { passive: true });

    el.addEventListener("click", () => {
        if (!bulkMode) { openCardModal(card); return; }
        if (selectedCards.has(card.id)) { selectedCards.delete(card.id); el.classList.remove('bulk-selected'); }
        else { selectedCards.add(card.id); el.classList.add('bulk-selected'); }
        const chk = el.querySelector('.wf-bulk-checkbox');
        if (chk) chk.checked = selectedCards.has(card.id);
        updateBulkBar();
    });
    el.addEventListener("contextmenu", (e) => showContextMenu(e, card));

    // Hover preview
    let hoverTimer;
    el.addEventListener('mouseenter', () => { hoverTimer = setTimeout(() => showCardPreview(card, el), 650); });
    el.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); hideCardPreview(); });

    // Bulk selectie: checkbox links, kaartinhoud schuift rechts
    if (bulkMode) {
        el.classList.toggle('bulk-selected', selectedCards.has(card.id));
        el.classList.add('wf-in-bulk');
        const overlay = document.createElement('div');
        overlay.className = 'wf-bulk-overlay';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.className = 'wf-bulk-checkbox';
        chk.checked = selectedCards.has(card.id);
        overlay.appendChild(chk);
        el.appendChild(overlay);
    }

    return el;
}

async function performDrop(cardId, colId, targetCardEl = null, insertBefore = false) {
    document.querySelectorAll(".wf-drop-target").forEach(el => el.classList.remove("wf-drop-target"));
    document.querySelectorAll('.drop-above,.drop-below').forEach(el => el.classList.remove('drop-above','drop-below'));

    const currentCard = cards.find(c => c.id === cardId);
    if (!currentCard) return;

    const targetCardId = targetCardEl?.dataset.id;

    // === HERORDENEN BINNEN ZELFDE KOLOM ===
    if (currentCard.columnId === colId && targetCardId && targetCardId !== cardId) {
        await reorderCardsInColumn(cardId, targetCardId, colId, insertBefore);
        return;
    }

    // === VERPLAATSEN NAAR ANDERE KOLOM ===
    if (currentCard.columnId === colId) return;

    const targetCol  = columns.find(c => c.id === colId);
    const ticketTag  = tags.find(t => t.name.toUpperCase() === "TICKETING");
    const isTicket   = ticketTag && (currentCard.tags || []).includes(ticketTag.id);
    const fromColName = columns.find(c => c.id === currentCard.columnId)?.title || '?';
    const histLog = { content: `[Systeem] Verplaatst van "${fromColName}" naar "${targetCol?.title || '?'}"`, timestamp: new Date().toISOString(), system: true };
    const updateData = { columnId: colId, logs: [...(currentCard.logs || []), histLog] };

    if (targetCol && targetCol.title.trim().toLowerCase() === "afgewerkt") {
        updateData.finishedAt = new Date();
        const deleteDate = new Date(); deleteDate.setFullYear(deleteDate.getFullYear() + 1);
        updateData.deleteAt = deleteDate;
    } else {
        updateData.finishedAt = null; updateData.deleteAt = null;
    }

    try {
        await updateDoc(doc(db, "workflowCards", cardId), updateData);
        if (apiSettings.webhookUrl && isTicket) {
            fetch(apiSettings.webhookUrl, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ trigger: "cardMoved", ticketId: cardId, columnId: colId })
            }).catch(err => console.error("Webhook fail", err));
        }
    } catch (error) {
        console.error("Fout bij verplaatsen kaart:", error);
        showToast("Kon kaart niet verplaatsen", "error");
    }
}

async function handleDrop(e, colId) {
    e.preventDefault();
    const cardId = e.dataTransfer.getData("text/plain");
    if (!cardId) return;
    const targetCardEl = e.target.closest('.wf-card');
    const insertBefore = targetCardEl?.classList.contains('drop-above');
    await performDrop(cardId, colId, targetCardEl, insertBefore);
}

// --- TOUCH DRAG-DROP ---
function setupTouchDragDrop() {
    document.addEventListener('touchmove', (e) => {
        if (!touchDrag) return;
        const touch = e.touches[0];
        const dx = touch.clientX - touchDrag.startX;
        const dy = touch.clientY - touchDrag.startY;

        if (!touchDrag.moved && Math.hypot(dx, dy) < 8) return;

        if (!touchDrag.moved) {
            touchDrag.moved = true;
            const ghost = touchDrag.el.cloneNode(true);
            const w = touchDrag.el.offsetWidth;
            ghost.style.cssText = `position:fixed;opacity:0.75;pointer-events:none;z-index:9999;width:${w}px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.4);transform:rotate(2deg);transition:none;`;
            document.body.appendChild(ghost);
            touchDrag.ghost = ghost;
            touchDrag.el.style.opacity = '0.4';
        }

        e.preventDefault();

        touchDrag.ghost.style.left = `${touch.clientX - touchDrag.ghost.offsetWidth / 2}px`;
        touchDrag.ghost.style.top  = `${touch.clientY - 30}px`;

        // Kolom onder de vinger bepalen
        touchDrag.ghost.style.visibility = 'hidden';
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        touchDrag.ghost.style.visibility = '';

        const newCol = target?.closest('.wf-column-cards');
        if (newCol !== touchDrag.activeCol) {
            touchDrag.activeCol?.classList.remove('wf-drop-target');
            newCol?.classList.add('wf-drop-target');
            touchDrag.activeCol = newCol || null;
        }
    }, { passive: false });

    document.addEventListener('touchend', async (e) => {
        if (!touchDrag) return;

        const { cardId, el, ghost, activeCol, moved } = touchDrag;
        touchDrag = null;

        el.style.opacity = '1';
        ghost?.remove();
        activeCol?.classList.remove('wf-drop-target');

        if (!moved || !activeCol) return;

        const colId = activeCol.closest('.wf-column')?.dataset.colId;
        if (!colId) return;

        const touch = e.changedTouches[0];
        const targetCardEl = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.wf-card');
        const insertBefore = targetCardEl
            ? touch.clientY < targetCardEl.getBoundingClientRect().top + targetCardEl.offsetHeight / 2
            : false;

        await performDrop(cardId, colId, targetCardEl, insertBefore);
    });

    document.addEventListener('touchcancel', () => {
        if (!touchDrag) return;
        touchDrag.el.style.opacity = '1';
        touchDrag.ghost?.remove();
        touchDrag.activeCol?.classList.remove('wf-drop-target');
        touchDrag = null;
    });
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
        preview.innerHTML = `${typeIcon} ${escHtml(tag.name)}`;
        
        // Board-toewijzing: kleine checkboxes naast de preview
        const boardsCol = document.createElement("div");
        boardsCol.className = "tag-boards-col";
        const tagBoards = getTagBoards(tag);
        [['workflow', '⚙️'], ['websites', '🌐']].forEach(([bType, icon]) => {
            const lbl = document.createElement("label");
            lbl.className = "tag-board-check";
            lbl.title = bType;
            const chk = document.createElement("input");
            chk.type = "checkbox";
            chk.checked = tagBoards.includes(bType);
            chk.onchange = () => {
                const current = getTagBoards(tag);
                const updated = chk.checked ? [...current, bType] : current.filter(b => b !== bType);
                if (updated.length === 0) { chk.checked = true; return; } // minimaal 1 bord
                updateTag(tag.id, { boards: updated });
            };
            lbl.appendChild(chk);
            lbl.insertAdjacentHTML('beforeend', ` ${icon}`);
            boardsCol.appendChild(lbl);
        });

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
            delBtn.onclick = async () => { if(await confirmDialog("Tag verwijderen?")) deleteTag(tag.id); };
            actions.appendChild(delBtn);
        }
        
        row.append(preview, boardsCol, actions);

        if (tag.category === 'priority') stdList.appendChild(row);
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

        // Input veld voor Naam
        const input = document.createElement("input");
        input.value = col.title;
        input.placeholder = "Kolom naam...";
        input.onchange = () => { updateColumn(col.id, { title: input.value }); showToast("Kolom naam gewijzigd", "success"); };

        // WIP-limiet input
        const wipInput = document.createElement("input");
        wipInput.type = "number"; wipInput.min = "0"; wipInput.max = "99";
        wipInput.value = col.wipLimit || "";
        wipInput.placeholder = "Max";
        wipInput.title = "WIP-limiet (0 of leeg = geen limiet)";
        wipInput.style.cssText = "width:54px; text-align:center; flex-shrink:0;";
        wipInput.onchange = () => updateColumn(col.id, { wipLimit: parseInt(wipInput.value) || 0 });

        // Actie knoppen container
        const actions = document.createElement("div");
        actions.className = "col-config-actions";

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
        delBtn.onclick = async () => {
            if(await confirmDialog(`Kolom "${col.title}" verwijderen? Kaarten in deze kolom worden onzichtbaar totdat je ze verplaatst.`)) {
                deleteColumn(col.id);
            }
        };

        actions.appendChild(upBtn);
        actions.appendChild(downBtn);
        actions.appendChild(delBtn);

        row.appendChild(input);
        row.appendChild(wipInput);
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
        row.innerHTML = `<div><strong>${escHtml(tpl.name)}</strong><div class="template-items-preview">${itemCount} items</div></div>`;
        const delBtn = document.createElement("button"); delBtn.innerHTML = "🗑️"; delBtn.className = "del-icon-btn";
        delBtn.onclick = async () => { if(await confirmDialog("Template verwijderen?")) deleteChecklistTemplate(tpl.id); };
        row.appendChild(delBtn); list.appendChild(row);
    });
}

const TYPE_ICON_PRESETS = ['📋','🐛','✨','🔧','🔍','🚀','💡','🔒','📱','🌐','🎯','⚡','🛠️','📝','🔄','⚠️','📌','🧪','🆕','✅'];

function renderTypeConfig() {
    const list = $('list-card-types');
    if (!list) return;
    list.innerHTML = '';

    if (!cardTypes.length) {
        list.innerHTML = '<p style="color:var(--muted);font-size:0.85rem;font-style:italic;">Nog geen types aangemaakt.</p>';
        return;
    }

    cardTypes.forEach(type => {
        const row = document.createElement('div');
        row.className = 'type-manage-row';

        const badge = document.createElement('span');
        badge.className = 'wf-card-type-badge';
        badge.style.cssText = `background:${type.color}20; color:${type.color}; border-color:${type.color}40; font-size:0.9rem;`;
        badge.textContent = `${type.icon} ${type.name}`;

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex; gap:8px; align-items:center;';

        const editBtn = document.createElement('button');
        editBtn.innerHTML = '✏️'; editBtn.className = 'del-icon-btn'; editBtn.title = 'Bewerken';
        editBtn.onclick = () => openTypeEditor(type);

        const delBtn = document.createElement('button');
        delBtn.innerHTML = '🗑️'; delBtn.className = 'del-icon-btn'; delBtn.title = 'Verwijderen';
        delBtn.onclick = async () => {
            if (await confirmDialog(`Type "${type.name}" verwijderen? Kaarten behouden het type-ID maar het badge verdwijnt.`)) {
                await deleteCardType(type.id);
            }
        };

        actions.append(editBtn, delBtn);
        row.append(badge, actions);
        list.appendChild(row);
    });
}

function openTypeEditor(type = null) {
    editingTypeId = type ? type.id : null;
    $('type-name-inp').value = type ? type.name : '';
    $('type-icon-inp').value = type ? type.icon : '📋';
    $('type-color-val').value = type ? type.color : TAG_COLORS[0];
    $('type-editor').style.display = '';
    $('btnOpenNewType').style.display = 'none';

    // Icon presets
    const presetsCont = $('type-icon-presets');
    presetsCont.innerHTML = '';
    TYPE_ICON_PRESETS.forEach(icon => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'type-icon-preset-btn';
        btn.textContent = icon;
        btn.onclick = () => { $('type-icon-inp').value = icon; };
        presetsCont.appendChild(btn);
    });

    // Color picker
    const colorsCont = $('type-colors-cont');
    colorsCont.innerHTML = '';
    TAG_COLORS.forEach(c => {
        const circle = document.createElement('div');
        circle.className = `color-circle ${c === (type?.color || TAG_COLORS[0]) ? 'selected' : ''}`;
        circle.style.backgroundColor = c;
        circle.onclick = () => {
            colorsCont.querySelectorAll('.color-circle').forEach(e => e.classList.remove('selected'));
            circle.classList.add('selected');
            $('type-color-val').value = c;
        };
        colorsCont.appendChild(circle);
    });
}

function renderTemplateEditorItems() {
    const cont = $('tpl-items-container'); cont.innerHTML = "";
    tempTemplateItems.forEach((item, idx) => {
        const div = document.createElement("div"); div.className="temp-item-row";
        div.innerHTML = `<span>• ${escHtml(item.text)}</span>`;
        const del = document.createElement("button"); del.innerHTML="✕"; del.className="del-icon-btn"; del.style.fontSize="0.8rem";
        del.onclick = () => { tempTemplateItems.splice(idx, 1); renderTemplateEditorItems(); };
        div.appendChild(del); cont.appendChild(div);
    });
}

// --- MODAL & LOGIC ---
/**
 * @param {Card|null} card
 * @param {boolean} readOnly
 * @param {(() => void)|null} afterOpen
 */
function openCardModal(card = null, readOnly = false, afterOpen = null) {
    currentCardId = card ? card.id : null;
    currentChecklist = (card && Array.isArray(card.checklist)) ? [...card.checklist] : [];
    currentSubtasks  = (card && Array.isArray(card.subtasks))  ? [...card.subtasks]  : [];
    currentLinks = (card && Array.isArray(card.links)) ? [...card.links] : [];
    currentLogs = (card && Array.isArray(card.logs)) ? [...card.logs] : [];
    
    currentCardPage = card ? (card.cardPage || null) : null;
    currentTypeId   = card ? (card.typeId  || null) : null;
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

    // 1. Filter (op actief bord)
    const prioTags = tags.filter(t => t.category === 'priority' && t.active !== false && getTagBoards(t).includes(activeBoardType));
    
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
    const prioUpdaters = [];
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
        prioUpdaters.push(updateState);
        updateState();

        chip.onclick = () => {
            currentPrioId = currentPrioId === t.id ? null : t.id;
            prioCont.dataset.selected = currentPrioId || "";
            prioUpdaters.forEach(fn => fn());
        };
        prioCont.appendChild(chip);
    });

    renderCardTypeSelector();
    renderCardTagsSelector(card ? (card.tags || []) : []);
    renderCardColorPicker(card ? (card.cardColor || null) : null);
    // Reset markdown view naar edit mode
    const mdView = $('inpDescMarkdown'); const mdBtn = $('btnToggleMarkdown');
    if (mdView && mdBtn) { mdView.hidden = true; $('inpDesc').style.display = ''; mdBtn.textContent = '👁️ Bekijken'; }
    renderSubtasks();
    renderChecklist();
    renderLinks();
    renderLogs();
    populateTemplateSelect();
    populateCardTemplateSelect();
    // Template loader: alleen tonen voor nieuwe kaarten
    const templateLoader = $('card-template-loader');
    if (templateLoader) templateLoader.style.display = card ? 'none' : 'flex';
    
    document.querySelectorAll('.wf-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.wf-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="details"]').classList.add('active');
    document.getElementById('tab-details').classList.add('active');

    const btnPlan = $('btnQuickPlan');
    const btnMove = $('btnMoveCard');
    const btnDup  = $('btnDuplicateCard');
    const moveSelect = $('move-col-select');

    const btnSaveAsTpl = $('btnSaveAsTemplate');
    if(!card) {
        btnPlan.disabled = true; btnPlan.textContent = "Eerst opslaan";
        btnMove.disabled = true;
        btnDup.disabled  = true;
        moveSelect.innerHTML = '<option>—</option>';
        if (btnSaveAsTpl) btnSaveAsTpl.disabled = true;
    } else {
        if (btnSaveAsTpl) btnSaveAsTpl.disabled = false;
        btnPlan.disabled = false; btnPlan.textContent = "⚡ Snel Plannen in Agenda";
        btnPlan.onclick = () => { $('qp-date').value = $('inpDate').value || new Date().toISOString().split('T')[0]; $('modal-quick-plan').hidden=false; };

        moveSelect.innerHTML = "";
        columns.sort((a,b) => a.order - b.order).forEach(col => {
            const opt = document.createElement("option");
            opt.value = col.id;
            opt.textContent = col.title;
            if(col.id === card.columnId) opt.selected = true;
            moveSelect.appendChild(opt);
        });
        btnMove.disabled = false;

        btnDup.disabled = false;
        btnDup.onclick = () => { duplicateCard(card); window.Modal.close(); };
    }
    const modalEl = document.getElementById('modal-card');
    if (readOnly) {
        modalEl.classList.add('read-only');
        $('modal-title').textContent = "Archief Detail (Alleen lezen)";
        modalEl.querySelectorAll('input, textarea').forEach(i => i.disabled = true);
    } else {
        modalEl.classList.remove('read-only');
        $('modal-title').textContent = card ? "Taak Bewerken" : "Nieuwe Taak";
        modalEl.querySelectorAll('input, textarea').forEach(i => i.disabled = false);
    }
    window.Modal.open("modal-card");
    cardModalSnapshot = captureCardState();
    if (afterOpen) afterOpen();
}

function openFilterModal() {
    const typeCont = $('filter-type-list');
    const prioCont = $('filter-prio-list');
    const tagCont  = $('filter-tag-list');
    typeCont.innerHTML = "";
    prioCont.innerHTML = "";
    tagCont.innerHTML  = "";

    // 0. Render Type Opties
    cardTypes.forEach(type => {
        const chip = document.createElement('div');
        const isSelected = activeFilters.types.includes(type.id);
        chip.className = `filter-chip ${isSelected ? 'selected' : ''}`;
        chip.innerHTML = `${escHtml(type.icon)} ${escHtml(type.name)}`;
        if (isSelected) { chip.style.backgroundColor = type.color; chip.style.borderColor = type.color; }
        chip.onclick = () => {
            const i = activeFilters.types.indexOf(type.id);
            i > -1 ? activeFilters.types.splice(i, 1) : activeFilters.types.push(type.id);
            renderBoard(); openFilterModal();
        };
        typeCont.appendChild(chip);
    });

    const doneCol = columns.find(c => c.title.toLowerCase() === 'afgewerkt');
    const doneColId = doneCol?.id;

    // 1. Render Prioriteiten Opties (gefilterd op actief bord)
    const priorities = tags.filter(t => t.category === 'priority' && t.active !== false && getTagBoards(t).includes(activeBoardType));
    priorities.forEach(p => {
        const count = cards.filter(c => c.priorityId === p.id && c.columnId !== doneColId).length;
        const chip = document.createElement("div");
        chip.innerHTML = `${escHtml(p.name)}${count ? `<span class="wf-filter-count">${count}</span>` : ''}`;
        const isSelected = activeFilters.priorities.includes(p.id);
        chip.className = `filter-chip ${isSelected ? 'selected' : ''}`;
        if(isSelected) chip.style.backgroundColor = p.color;

        chip.onclick = () => {
            if(activeFilters.priorities.includes(p.id)) {
                activeFilters.priorities = activeFilters.priorities.filter(id => id !== p.id);
            } else {
                activeFilters.priorities.push(p.id);
            }
            renderBoard();
            openFilterModal();
        };
        prioCont.appendChild(chip);
    });

    // 2. Render Tags Opties (gefilterd op actief bord)
    const labels = tags.filter(t => t.category !== 'priority' && t.active !== false && getTagBoards(t).includes(activeBoardType)).sort((a,b)=>a.name.localeCompare(b.name));
    labels.forEach(t => {
        const count = cards.filter(c => (c.tags||[]).includes(t.id) && c.columnId !== doneColId).length;
        const chip = document.createElement("div");
        chip.innerHTML = `${escHtml(t.name)}${count ? `<span class="wf-filter-count">${count}</span>` : ''}`;
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

function renderSubtasks() {
    const cont = $('subtasks-container');
    cont.innerHTML = "";
    $('st-count').textContent = currentSubtasks.length;

    if (currentSubtasks.length === 0) {
        cont.innerHTML = '<span class="muted small" style="font-style:italic; opacity:0.6;">Geen sub-taken. Voeg er een toe hieronder.</span>';
    }

    currentSubtasks.forEach((item, idx) => {
        const row = document.createElement("div");
        row.className = `check-row ${item.done ? 'done' : ''}`;

        const label = document.createElement("label");
        label.className = "cl-switch";
        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = item.done;
        chk.onchange = () => { currentSubtasks[idx].done = chk.checked; renderSubtasks(); };
        const slider = document.createElement("span");
        slider.className = "cl-slider";
        label.appendChild(chk);
        label.appendChild(slider);

        const txt = document.createElement("input");
        txt.type = "text";
        txt.value = item.text || "";
        txt.placeholder = "Sub-taak omschrijving...";
        txt.onchange = () => { currentSubtasks[idx].text = txt.value; };

        const del = document.createElement("button");
        del.innerHTML = "✕";
        del.className = "del-icon-btn";
        del.style.fontSize = "0.9rem";
        del.onclick = () => { currentSubtasks.splice(idx, 1); renderSubtasks(); };

        row.appendChild(label);
        row.appendChild(txt);
        row.appendChild(del);
        cont.appendChild(row);
    });
}

// Helpers

// --- ARCHIEF FUNCTIES ---

function restoreColDialog() {
    return new Promise(resolve => {
        const doneCol = columns.find(c => c.title.toLowerCase() === 'afgewerkt');
        const activeCols = columns.filter(c => c.id !== doneCol?.id).sort((a,b) => a.order - b.order);
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:10000';
        const box = document.createElement('div');
        box.style.cssText = 'background:var(--card,#1e293b);border:1px solid var(--border,#334155);border-radius:12px;padding:24px;max-width:340px;width:90%;display:flex;flex-direction:column;gap:14px';
        const lbl = document.createElement('p'); lbl.textContent = 'Terugzetten naar kolom:';
        lbl.style.cssText = 'margin:0;font-weight:700;font-size:0.95rem';
        const sel = document.createElement('select');
        sel.style.cssText = 'width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border,#334155);background:var(--bg,#0f172a);color:var(--fg,#e2e8f0)';
        activeCols.forEach(col => {
            const opt = document.createElement('option'); opt.value = col.id; opt.textContent = col.title; sel.appendChild(opt);
        });
        const btns = document.createElement('div'); btns.style.cssText = 'display:flex;justify-content:flex-end;gap:10px';
        const cancelBtn = document.createElement('button'); cancelBtn.textContent = 'Annuleren';
        cancelBtn.style.cssText = 'padding:7px 14px;border-radius:7px;border:1px solid var(--border,#334155);background:transparent;cursor:pointer;color:inherit';
        const okBtn = document.createElement('button'); okBtn.textContent = '↩ Terugzetten';
        okBtn.style.cssText = 'padding:7px 14px;border-radius:7px;border:none;background:var(--brand,#3b82f6);color:#fff;cursor:pointer';
        btns.append(cancelBtn, okBtn);
        box.append(lbl, sel, btns);
        overlay.appendChild(box); document.body.appendChild(overlay);
        const cleanup = r => { overlay.remove(); resolve(r); };
        okBtn.onclick = () => cleanup(sel.value);
        cancelBtn.onclick = () => cleanup(null);
        overlay.onclick = e => { if(e.target === overlay) cleanup(null); };
    });
}

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
            if(p) prioHtml = `<span class="wf-badge" style="background:${p.color}">${escHtml(p.name)}</span>`;
        }

        // Tags Labels
        let tagsHtml = "";
        (card.tags || []).forEach(tid => {
            const t = tags.find(x => x.id === tid);
            if(t) tagsHtml += `<span class="wf-badge" style="background:${t.color}; margin-right:4px;">${escHtml(t.name)}</span>`;
        });

        // Datum
        let dateStr = "-";
        if(card.finishedAt) {
            const d = card.finishedAt.toDate ? card.finishedAt.toDate() : new Date(card.finishedAt);
            dateStr = d.toLocaleDateString('nl-BE', {day:'2-digit', month:'2-digit', year:'numeric'});
        }

        // Terugzetten knop
        const restoreBtn = document.createElement('button');
        restoreBtn.textContent = '↩ Terugzetten';
        restoreBtn.className = 'wf-btn small';
        restoreBtn.style.cssText = 'white-space:nowrap; font-size:0.75rem;';
        restoreBtn.onclick = async (e) => {
            e.stopPropagation();
            const targetColId = await restoreColDialog();
            if (!targetColId) return;
            try {
                await updateDoc(doc(db, "workflowCards", card.id), {
                    columnId: targetColId, finishedAt: null, deleteAt: null
                });
                showToast("Kaart teruggezet", "success");
                openArchiveModal(); // refresh
            } catch(err) { console.error(err); showToast("Mislukt", "error"); }
        };

        tr.innerHTML = `
            <td><strong>${escHtml(card.title)}</strong></td>
            <td>${prioHtml}</td>
            <td>${tagsHtml}</td>
            <td style="text-align:right; font-family:monospace;">${dateStr}</td>
            <td></td>
        `;
        tr.lastElementChild.appendChild(restoreBtn);
        tr.onclick = () => openCardModal(card, true);
        tbody.appendChild(tr);
    });

    window.Modal.open('modal-archive');
}

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
// --- KAART TEMPLATES ---
function populateCardTemplateSelect() {
    const sel = $('selCardTemplate');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Kies een template —</option>';
    cardTemplates.forEach(tpl => {
        const opt = document.createElement('option'); opt.value = tpl.id; opt.textContent = tpl.name; sel.appendChild(opt);
    });
}

function renderCardTemplateConfig() {
    const list = $('list-card-templates');
    if (!list) return;
    list.innerHTML = '';
    if (!cardTemplates.length) { list.innerHTML = '<small style="opacity:0.5;">Geen templates. Maak een kaart aan en sla op als template via de Acties tab.</small>'; return; }
    cardTemplates.forEach(tpl => {
        const row = document.createElement('div'); row.className = 'template-row';
        row.innerHTML = `<div><strong>${escHtml(tpl.name)}</strong><div class="template-items-preview">${(tpl.checklist||[]).length} checklist items</div></div>`;
        const del = document.createElement('button'); del.innerHTML = '🗑️'; del.className = 'del-icon-btn';
        del.onclick = async () => { if(await confirmDialog('Template verwijderen?')) await deleteDoc(doc(db, 'workflowCardTemplates', tpl.id)); };
        row.appendChild(del); list.appendChild(row);
    });
}

function applyCardTemplate(tplId) {
    const tpl = cardTemplates.find(t => t.id === tplId);
    if (!tpl) return;
    if (tpl.description) $('inpDesc').value = tpl.description;
    // Prioriteit
    if (tpl.priorityName) {
        const prioTag = tags.find(t => t.category === 'priority' && t.name.toLowerCase() === tpl.priorityName.toLowerCase());
        if (prioTag) {
            const prioCont = $('prio-tags-list');
            prioCont.dataset.selected = prioTag.id;
            prioCont.querySelectorAll('.wf-tag-option').forEach(chip => {
                const isSelected = chip.textContent.trim().toLowerCase() === tpl.priorityName.toLowerCase();
                chip.classList.toggle('selected', isSelected);
                chip.style.backgroundColor = isSelected ? prioTag.color : 'transparent';
                chip.style.borderColor = isSelected ? prioTag.color : 'var(--border)';
                chip.style.color = isSelected ? 'white' : 'var(--muted)';
            });
        }
    }
    // Tags
    if (tpl.tagNames?.length) {
        const selectedIds = [];
        tpl.tagNames.forEach(name => {
            const tag = tags.find(t => t.category !== 'priority' && t.name.toLowerCase() === name.toLowerCase());
            if (tag) selectedIds.push(tag.id);
        });
        renderCardTagsSelector(selectedIds);
    }
    // Checklist
    if (tpl.checklist?.length) {
        currentChecklist = [...currentChecklist, ...tpl.checklist.map(i => ({ text: i.text, done: false }))];
        renderChecklist();
    }
    // Subtaken
    if (tpl.subtasks?.length) {
        currentSubtasks = [...currentSubtasks, ...tpl.subtasks.map(i => ({ text: i.text, done: false }))];
        renderSubtasks();
    }
    showToast('Template geladen', 'success');
}

async function saveCardAsTemplate(card) {
    const name = await inputDialog('Template naam', 'bv. Nieuwe Website Klant', card.title ? `Template: ${card.title}` : '');
    if (!name) return;
    const prioTag  = card.priorityId ? tags.find(t => t.id === card.priorityId) : null;
    const tagNames = (card.tags || []).map(id => tags.find(t => t.id === id)?.name).filter(Boolean);
    try {
        await addDoc(collection(db, 'workflowCardTemplates'), {
            uid: currentUser.uid,
            name,
            description: card.description || '',
            priorityName: prioTag?.name || null,
            tagNames,
            checklist: (card.checklist || []).map(i => ({ text: i.text })),
            subtasks:  (card.subtasks  || []).map(i => ({ text: i.text }))
        });
        showToast('Template opgeslagen', 'success');
    } catch(err) { console.error(err); showToast('Opslaan mislukt', 'error'); }
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
        row.innerHTML = `<a href="${escHtml(link.url)}" target="_blank">🔗 ${escHtml(link.title)}</a>`;
        const del = document.createElement("button"); del.innerHTML="🗑️"; del.className="del-icon-btn";
        del.onclick = () => { currentLinks.splice(idx, 1); renderLinks(); };
        row.appendChild(del); cont.appendChild(row);
    });
}

function renderLogs() {
    const cont = $('logs-container'); cont.innerHTML = "";
    if(currentLogs.length === 0) cont.innerHTML = '<span class="muted small">Nog geen logs.</span>';
    [...currentLogs].reverse().forEach(log => {
        const div = document.createElement("div");
        div.className = log.system ? "wf-log-item wf-log-system" : "wf-log-item";
        const dateStr = new Date(log.timestamp).toLocaleString('nl', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
        div.innerHTML = `<div class="wf-log-meta"><span>${dateStr}</span></div><div class="wf-log-content">${escHtml(log.content)}</div>`;
        cont.appendChild(div);
    });
}

function renderCardTagsSelector(selectedIds = []) {
    const container = $('card-tags-list'); container.innerHTML = "";

    // Filter: geen priorities, alleen tags van actief bord
    const standardTags = tags.filter(t => t.active !== false && t.category !== 'priority' && getTagBoards(t).includes(activeBoardType));

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
    renderPageSelector(selectedIds);
}

// --- BULK ACTIES ---
function updateBulkBar() {
    const bar = $('bulk-action-bar');
    const countEl = $('bulk-count');
    if (!bar) return;
    const n = selectedCards.size;
    bar.hidden = !bulkMode || n === 0;
    if (countEl) countEl.textContent = `${n} kaart${n !== 1 ? 'en' : ''} geselecteerd`;
    const sel = $('bulk-move-select');
    if (sel) {
        sel.innerHTML = '';
        columns.sort((a,b) => a.order - b.order).forEach(col => {
            const opt = document.createElement('option');
            opt.value = col.id; opt.textContent = col.title; sel.appendChild(opt);
        });
    }
}

// --- SETUP EVENTS ---
function setupUI() {
    setupTouchDragDrop();

    let searchDebounce;
    $('searchInput').addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(renderBoard, 200);
    });
    $('btnNewCard').onclick = () => openCardModal();
    $('btnSettings').onclick = () => { renderTagConfig(); renderColConfig(); renderTemplateConfig(); renderCardTemplateConfig(); renderQuickFilterConfig(); renderTypeConfig(); window.Modal.open("modal-settings"); };
    $('btnAddCol').onclick = () => {
        $('add-col-form').style.display = 'block';
        $('btnAddCol').style.display = 'none';
        $('new-col-name').value = '';
        $('new-col-name').focus();
    };
    $('btnConfirmAddCol').onclick = async () => {
        const btn = $('btnConfirmAddCol');
        if (btn.disabled) return;
        const title = $('new-col-name').value.trim();
        if (!title) return;
        btn.disabled = true;
        try {
            const maxOrder = columns.reduce((max, c) => Math.max(max, c.order), 0);
            await addColumn({ uid: currentUser.uid, boardId, title, order: maxOrder + 1 });
            $('add-col-form').style.display = 'none';
            $('btnAddCol').style.display = '';
        } finally {
            btn.disabled = false;
        }
    };
    $('btnCancelAddCol').onclick = () => {
        $('add-col-form').style.display = 'none';
        $('btnAddCol').style.display = '';
    };
    $('new-col-name').addEventListener('keydown', e => {
        if (e.key === 'Enter') $('btnConfirmAddCol').click();
        if (e.key === 'Escape') $('btnCancelAddCol').click();
    });
    $('btnOpenArchive').onclick = () => openArchiveModal();
    $('btnStats').onclick = () => openStatsModal();
    $('btnToggleView').onclick = () => {
        viewMode = viewMode === 'kanban' ? 'list' : 'kanban';
        $('btnToggleView').textContent = viewMode === 'list' ? '⊞' : '☰';
        $('btnToggleView').title = viewMode === 'list' ? 'Kanban bord' : 'Lijst weergave';
        renderBoard();
    };
    $('btnFilterTags').onclick = () => openFilterModal();
    // Board tabs worden opgezet vanuit setupBoardTabs() na het laden van boardIds
    const btnNew = $('btnShowNew');
    if(btnNew) {
        btnNew.onclick = () => {
            activeFilters.showNewOnly = !activeFilters.showNewOnly;
            renderBoard();};
    }
    
    $('btnClearFilters').onclick = () => {
        activeFilters = { priorities:[], tags:[], types:[], showNewOnly: false };
        renderBoard(); 
        openFilterModal(); // Refresh modal view
    };

    // Markdown toggle (bekijken ↔ bewerken)
    $('btnToggleMarkdown').onclick = () => {
        const textarea = $('inpDesc');
        const view     = $('inpDescMarkdown');
        const btn      = $('btnToggleMarkdown');
        if (textarea.style.display === 'none') {
            // Terug naar bewerken
            view.hidden = true; textarea.style.display = ''; btn.textContent = '👁️ Bekijken';
        } else {
            // Naar bekijken
            view.innerHTML = renderMarkdown(textarea.value);
            view.hidden = false; textarea.style.display = 'none'; btn.textContent = '✏️ Bewerken';
        }
    };

    $('btnAddSubtask').onclick = () => {
        const txt = $('new-subtask-text').value.trim();
        if(txt) { currentSubtasks.push({text: txt, done: false}); $('new-subtask-text').value=""; renderSubtasks(); }
    };
    $('new-subtask-text').addEventListener('keydown', e => { if(e.key === 'Enter') $('btnAddSubtask').click(); });

    $('btnAddCheckitem').onclick = () => {
        const txt = $('new-check-text').value.trim();
        if(txt) { currentChecklist.push({text: txt, done: false}); $('new-check-text').value=""; renderChecklist(); }
    };
    $('new-check-text').addEventListener('keydown', e => { if(e.key === 'Enter') $('btnAddCheckitem').click(); });
    
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

    // KAART TEMPLATE LOADER
    $('btnLoadCardTemplate').onclick = () => {
        const tplId = $('selCardTemplate').value;
        if (!tplId) return showToast('Kies eerst een template', 'error');
        applyCardTemplate(tplId);
    };

    // KAART OPSLAAN ALS TEMPLATE
    $('btnSaveAsTemplate').onclick = () => {
        if (!currentCardId) return showToast('Sla de kaart eerst op', 'error');
        const card = cards.find(c => c.id === currentCardId);
        if (card) saveCardAsTemplate(card);
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
    $('tpl-new-item').addEventListener('keydown', e => { if(e.key === 'Enter') $('btnTplAddItem').click(); });
    
    $('btnCancelTpl').onclick = () => {
        $('template-editor').style.display = "none";
        $('btnNewTemplateToggle').style.display = "block";
    };
    
    $('btnSaveTpl').onclick = async () => {
        const btn = $('btnSaveTpl');
        if(btn.disabled) return;
        const name = $('tpl-name').value.trim();
        if(!name) return showToast("Naam verplicht", "error");
        if(tempTemplateItems.length === 0) return showToast("Voeg items toe", "error");
        btn.disabled = true;
        try {
            await addChecklistTemplate({ uid: currentUser.uid, name, items: tempTemplateItems });
            $('template-editor').style.display = "none";
            $('btnNewTemplateToggle').style.display = "block";
            showToast("Template opgeslagen", "success");
        } finally {
            btn.disabled = false;
        }
    };
    $('btn-close-urgent').onclick = () => {
        if ($('chk-urgent-today').checked) {
            const todayStr = new Date().toISOString().split('T')[0];
            localStorage.setItem(`wf_urgent_dismissed_${currentUser.uid}`, todayStr);
        }
        $('modal-urgent').hidden = true;
    };

    $('btnAddLink').onclick = () => {
        const t = $('new-link-title').value.trim();
        let u = $('new-link-url').value.trim();
        if (!t || !u) return;
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
        currentLinks.push({ title: t, url: u });
        $('new-link-title').value = '';
        $('new-link-url').value = '';
        renderLinks();
    };

    $('btnAddLog').onclick = () => {
        const t = $('new-log-text').value.trim();
        if(t) { currentLogs.push({content: t, timestamp: new Date().toISOString()}); $('new-log-text').value=""; renderLogs(); }
    };
    $('new-log-text').addEventListener('keydown', e => { if(e.key === 'Enter') $('btnAddLog').click(); });

    // New Tag Logic
    let editingTagId = null;
    $('btnOpenNewTag').onclick = () => {
        editingTagId = null; $('new-tag-name').value=""; $('new-tag-color-val').value=TAG_COLORS[0];
        currentTagPages = [];
        renderTagPagesList();
        // Reset board checkboxes (default: workflow)
        document.querySelectorAll('input[name="tagBoard"]').forEach(chk => { chk.checked = chk.value === 'workflow'; });
        updateTagPagesVisibility();
        const colorsCont = $('new-tag-colors'); colorsCont.innerHTML="";
        TAG_COLORS.forEach((c, idx) => {
            const circle = document.createElement("div"); circle.className = `color-circle ${idx===0?'selected':''}`; circle.style.backgroundColor=c;
            circle.onclick=()=>{ document.querySelectorAll('.color-circle').forEach(e=>e.classList.remove('selected')); circle.classList.add('selected'); $('new-tag-color-val').value=c; };
            colorsCont.appendChild(circle);
        });
        window.Modal.open("modal-new-tag");
        tagModalSnapshot = captureTagState();
    };

    // Nieuwe Tag aanmaken / bewerken
    $('btnSaveNewTag').onclick = async () => {
        const btn = $('btnSaveNewTag');
        if (btn.disabled) return;
        const name = $('new-tag-name').value;
        const color = $('new-tag-color-val').value;
        const category = document.querySelector('input[name="tagType"]:checked').value;
        const boards = [...document.querySelectorAll('input[name="tagBoard"]:checked')].map(c => c.value);
        if (!name) return showToast("Naam verplicht", "error");
        if (boards.length === 0) return showToast("Kies minstens 1 bord", "error");
        btn.disabled = true;
        try {
            const pages = [...currentTagPages];
            if (editingTagId) {
                await updateTag(editingTagId, { name, color, category, boards, pages });
            } else {
                await addTag({ uid: currentUser.uid, name, color, builtin: false, active: true, category, boards, pages });
            }
            tagModalSnapshot = null;
            window.Modal.close();
        } finally {
            btn.disabled = false;
        }
    };

    // Opslaan Kaart
    $('btnSaveCard').onclick = async () => {
        const btn = $('btnSaveCard');
        if (btn.disabled) return;
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

        // Auto-log bij prioriteitswijziging (alleen bij bestaande kaart)
        if (currentCardId) {
            const oldCard = cards.find(c => c.id === currentCardId);
            if (oldCard && oldCard.priorityId !== priorityId) {
                const oldName = oldCard.priorityId ? (tags.find(t => t.id === oldCard.priorityId)?.name || '?') : 'Geen';
                const newName = priorityId ? (tags.find(t => t.id === priorityId)?.name || '?') : 'Geen';
                currentLogs.push({ content: `[Systeem] Prioriteit: ${oldName} → ${newName}`, timestamp: new Date().toISOString(), system: true });
            }
        }

        const data = {
            uid: currentUser.uid,
            boardId,
            title,
            description: $('inpDesc').value,
            dueDate: dueTimestamp,
            priorityId: priorityId,
            tags: tagIds,
            cardColor: $('card-color-list')?.dataset.selected || null,
            cardPage:  currentCardPage || null,
            typeId:    currentTypeId   || null,
            subtasks: currentSubtasks,
            checklist: currentChecklist,
            links: currentLinks,
            logs: currentLogs,
            updatedAt: serverTimestamp()
        };

        btn.disabled = true;
        try {
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
            cardModalSnapshot = null;
            window.Modal.close();
        } finally {
            btn.disabled = false;
        }
    };
    
    // Helper voor edit tag modal invullen
    window.openEditTagModal = (tag) => {
        editingTagId = tag.id;
        $('new-tag-name').value = tag.name;
        $('new-tag-color-val').value = tag.color;

        // Radio: type
        const radios = document.getElementsByName('tagType');
        for (let r of radios) { r.checked = (r.value === (tag.category || 'standard')); }

        // Checkboxes: boards
        const tagBoards = getTagBoards(tag);
        document.querySelectorAll('input[name="tagBoard"]').forEach(chk => {
            chk.checked = tagBoards.includes(chk.value);
        });
        currentTagPages = [...(tag.pages || [])];
        renderTagPagesList();
        updateTagPagesVisibility();

        const colorsCont = $('new-tag-colors');
        colorsCont.innerHTML = "";
        TAG_COLORS.forEach(c => {
            const circle = document.createElement("div");
            circle.className = `color-circle ${c === tag.color ? 'selected' : ''}`;
            circle.style.backgroundColor = c;
            circle.onclick = () => {
                document.querySelectorAll('.color-circle').forEach(e => e.classList.remove('selected'));
                circle.classList.add('selected');
                $('new-tag-color-val').value = c;
            };
            colorsCont.appendChild(circle);
        });
        window.Modal.open("modal-new-tag");
        tagModalSnapshot = captureTagState();
    };

    $('btnMoveCard').onclick = async () => {
        const targetColId = $('move-col-select').value;
        if(!currentCardId || !targetColId) return;
        const currentCard = cards.find(c => c.id === currentCardId);
        if(currentCard && currentCard.columnId === targetColId) return showToast("Kaart staat al in deze kolom", "error");
        try {
            const targetCol = columns.find(c => c.id === targetColId);
            const fromColName = columns.find(c => c.id === currentCard?.columnId)?.title || '?';
            const moveLog = { content: `[Systeem] Verplaatst van "${fromColName}" naar "${targetCol?.title || '?'}"`, timestamp: new Date().toISOString(), system: true };
            const updateData = { columnId: targetColId, logs: [...(currentCard?.logs || []), moveLog] };
            if(targetCol && targetCol.title.trim().toLowerCase() === "afgewerkt") {
                updateData.finishedAt = new Date();
                const deleteDate = new Date();
                deleteDate.setFullYear(deleteDate.getFullYear() + 1);
                updateData.deleteAt = deleteDate;
            } else {
                updateData.finishedAt = null;
                updateData.deleteAt = null;
            }
            await updateDoc(doc(db, "workflowCards", currentCardId), updateData);
            showToast("Kaart verplaatst", "success");
            window.Modal.close();
        } catch(err) { console.error(err); showToast("Verplaatsen mislukt", "error"); }
    };

    $('btnDeleteCard').onclick = async () => { if(await confirmDialog("Kaart verwijderen?")) { if(currentCardId) await deleteDoc(doc(db, "workflowCards", currentCardId)); window.Modal.close(); } };
    $('btnCloseQuick').onclick = () => $('modal-quick-plan').hidden = true;
    $('btnCloseQuickCancel').onclick = () => $('modal-quick-plan').hidden = true;
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

    // Settings Tabs (tags=1, cols=2, lists=3, card-templates=4, quickfilters=5)
    window.switchSettingsTab = (tabName) => {
        document.querySelectorAll('#modal-settings .wf-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('#modal-settings .wf-settings-content').forEach(c => c.classList.remove('active'));
        const map = {
            tags:            [1, 'set-tab-tags'],
            types:           [2, 'set-tab-types'],
            cols:            [3, 'set-tab-cols'],
            lists:           [4, 'set-tab-lists'],
            'card-templates':[5, 'set-tab-card-templates'],
            quickfilters:    [6, 'set-tab-quickfilters']
        };
        const [nth, id] = map[tabName] || map.tags;
        document.querySelector(`#modal-settings .wf-tab-btn:nth-child(${nth})`).classList.add('active');
        $(id).classList.add('active');
        if (tabName === 'quickfilters') renderQuickFilterConfig();
        if (tabName === 'types') renderTypeConfig();
    };

    // Onopgeslagen wijzigingen – Kaart modal (X & Annuleren)
    const handleCardClose = async () => {
        if (isCardDirty()) {
            const choice = await unsavedChangesDialog();
            if (choice === 'save')    { $('btnSaveCard').click(); }
            else if (choice === 'discard') { cardModalSnapshot = null; window.Modal.close(); }
        } else {
            window.Modal.close();
        }
    };
    $('btnCloseCard').onclick  = handleCardClose;
    $('btnCancelCard').onclick = handleCardClose;

    // Onopgeslagen wijzigingen – Tag modal (X & Annuleren)
    const handleTagClose = async () => {
        if (isTagDirty()) {
            const choice = await unsavedChangesDialog();
            if (choice === 'save')    { $('btnSaveNewTag').click(); }
            else if (choice === 'discard') { tagModalSnapshot = null; window.Modal.close(); }
        } else {
            window.Modal.close();
        }
    };
    $('btnCloseTag').onclick  = handleTagClose;
    $('btnCancelTag').onclick = handleTagClose;

    // --- TYPE EDITOR ---
    $('btnOpenNewType').onclick = () => openTypeEditor(null);
    $('btnCancelType').onclick = () => {
        $('type-editor').style.display = 'none';
        $('btnOpenNewType').style.display = '';
    };
    $('btnSaveType').onclick = async () => {
        const btn = $('btnSaveType');
        if (btn.disabled) return;
        const name  = $('type-name-inp').value.trim();
        const icon  = $('type-icon-inp').value.trim() || '📋';
        const color = $('type-color-val').value || TAG_COLORS[0];
        if (!name) return showToast('Naam verplicht', 'error');
        btn.disabled = true;
        try {
            const isEdit = !!editingTypeId;
            if (editingTypeId) {
                await updateCardType(editingTypeId, { name, icon, color });
            } else {
                const maxOrder = cardTypes.reduce((m, t) => Math.max(m, t.order || 0), 0);
                await addCardType({ uid: currentUser.uid, name, icon, color, order: maxOrder + 1 });
            }
            $('type-editor').style.display = 'none';
            $('btnOpenNewType').style.display = '';
            editingTypeId = null;
            showToast(isEdit ? 'Type bijgewerkt' : 'Type aangemaakt', 'success');
        } catch(e) { console.error(e); showToast('Opslaan mislukt', 'error'); }
        finally { btn.disabled = false; }
    };

    // --- PAGINA BEHEER IN TAG MODAL ---
    document.querySelectorAll('input[name="tagBoard"]').forEach(chk => {
        chk.addEventListener('change', updateTagPagesVisibility);
    });
    $('btnAddTagPage').onclick = () => {
        const val = $('new-page-name').value.trim();
        if (!val) return;
        if (!currentTagPages.includes(val)) {
            currentTagPages.push(val);
            renderTagPagesList();
        }
        $('new-page-name').value = '';
    };
    $('new-page-name').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); $('btnAddTagPage').click(); }
    });

    // --- BULK MODUS ---
    $('btnBulkMode').onclick = () => {
        bulkMode = !bulkMode;
        selectedCards.clear();
        $('btnBulkMode').classList.toggle('active-quick-filter', bulkMode);
        $('btnBulkMode').title = bulkMode ? 'Stop selectie modus' : 'Selectie modus';
        $('bulk-action-bar').hidden = true;
        renderBoard();
    };
    $('btnBulkCancel').onclick = () => {
        bulkMode = false; selectedCards.clear();
        $('btnBulkMode').classList.remove('active-quick-filter');
        $('bulk-action-bar').hidden = true;
        renderBoard();
    };
    $('btnBulkMove').onclick = async () => {
        if (!selectedCards.size) return;
        const targetColId = $('bulk-move-select').value;
        if (!targetColId) return;
        const targetCol = columns.find(c => c.id === targetColId);
        const upd = { columnId: targetColId };
        if (targetCol?.title.toLowerCase() === 'afgewerkt') {
            upd.finishedAt = new Date();
            const del = new Date(); del.setFullYear(del.getFullYear() + 1); upd.deleteAt = del;
        } else { upd.finishedAt = null; upd.deleteAt = null; }
        try {
            await Promise.all([...selectedCards].map(id => updateDoc(doc(db, 'workflowCards', id), upd)));
            showToast(`${selectedCards.size} kaarten verplaatst`, 'success');
            selectedCards.clear(); $('bulk-action-bar').hidden = true; renderBoard();
        } catch(err) { console.error(err); showToast('Verplaatsen mislukt', 'error'); }
    };
    $('btnBulkDelete').onclick = async () => {
        if (!selectedCards.size) return;
        if (!await confirmDialog(`${selectedCards.size} kaarten definitief verwijderen?`)) return;
        try {
            await Promise.all([...selectedCards].map(id => deleteDoc(doc(db, 'workflowCards', id))));
            showToast(`${selectedCards.size} kaarten verwijderd`, 'success');
            selectedCards.clear(); $('bulk-action-bar').hidden = true; renderBoard();
        } catch(err) { console.error(err); showToast('Verwijderen mislukt', 'error'); }
    };

    // --- NOTIFICATIES TOGGLE ---
    updateNotifBtn();
    $('btnNotifToggle').onclick = async () => {
        if (!('Notification' in window)) return showToast('Browser ondersteunt geen meldingen', 'error');
        if (Notification.permission === 'granted') {
            showToast('Meldingen staan aan. Schakel uit via browserinstellingen.', 'info');
        } else if (Notification.permission === 'denied') {
            showToast('Meldingen geblokkeerd. Sta ze toe via de adresbalk.', 'error');
        } else {
            const perm = await Notification.requestPermission();
            updateNotifBtn();
            if (perm === 'granted') { showToast('Deadline meldingen ingeschakeld 🔔', 'success'); checkDeadlineNotifications(); }
            else showToast('Meldingen geweigerd', 'error');
        }
    };

    // Escape-toets onderscheppen bij niet-opgeslagen wijzigingen
    document.addEventListener('keydown', async (e) => {
        if (e.key !== 'Escape') return;
        if (window.Modal.isOpen('modal-card') && isCardDirty()) {
            e.stopImmediatePropagation();
            await handleCardClose();
        } else if (window.Modal.isOpen('modal-new-tag') && isTagDirty()) {
            e.stopImmediatePropagation();
            await handleTagClose();
        }
    }, true);
}

function showContextMenu(e, card) {
    e.preventDefault(); // Voorkom standaard browser menu
    
    // Verwijder eventueel bestaand menu
    closeContextMenu();

    // Maak het menu element
    const menu = document.createElement("div");
    menu.className = "wf-context-menu";
    menu.id = "active-context-menu";
    
    // Positioneer het menu bij de muis
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    // --- MENU ITEMS ---

    // 1. Snel Plannen
    menu.appendChild(createMenuItem("📅 Inplannen", () => {
        openCardModal(card, false, () => $('btnQuickPlan').click());
    }));

    // 2. Link Toevoegen
    menu.appendChild(createMenuItem("🔗 Link toevoegen", async () => {
        const url = await inputDialog("URL van de link", "https://...");
        if(!url) return;
        const title = await inputDialog("Naam van de link (optioneel)", "Link") || "Link";
        const newLinks = [...(card.links || []), { title, url }];
        try {
            await updateDoc(doc(db, "workflowCards", card.id), { links: newLinks });
            showToast("Link toegevoegd", "success");
        } catch(err) { console.error(err); showToast("Fout bij opslaan", "error"); }
    }));

    // 3. Log Toevoegen
    menu.appendChild(createMenuItem("💬 Log toevoegen", async () => {
        const text = await inputDialog("Notitie toevoegen", "Typ hier...");
        if(!text) return;
        const newLogs = [...(card.logs || []), { content: text, timestamp: new Date().toISOString() }];
        try {
            await updateDoc(doc(db, "workflowCards", card.id), { logs: newLogs });
            showToast("Log toegevoegd", "success");
        } catch(err) { console.error(err); showToast("Fout bij opslaan", "error"); }
    }));

    // 4. Dupliceren
    menu.appendChild(createMenuItem("📋 Dupliceren", () => duplicateCard(card)));

    // Scheidingslijn
    const div = document.createElement("div"); div.className = "wf-context-divider";
    menu.appendChild(div);

    // 5. Verwijderen
    const delItem = createMenuItem("🗑️ Verwijderen", async () => {
        if(await confirmDialog(`"${card.title}" verwijderen?`)) {
            await deleteDoc(doc(db, "workflowCards", card.id));
        }
    });
    delItem.style.color = "#ef4444";
    menu.appendChild(delItem);

    document.body.appendChild(menu);

    // Klik buiten menu om te sluiten
    setTimeout(() => {
        document.addEventListener("click", closeContextMenu, { once: true });
    }, 10);
}

function createMenuItem(text, onClick) {
    const item = document.createElement("div");
    item.className = "wf-context-item";
    item.textContent = text;
    item.onclick = () => {
        onClick();
        closeContextMenu();
    };
    return item;
}

async function duplicateCard(card) {
    try {
        const copy = {
            uid: card.uid,
            boardId: card.boardId,
            columnId: card.columnId,
            title: `Kopie van ${card.title}`,
            description: card.description || "",
            dueDate: card.dueDate || null,
            priorityId: card.priorityId || null,
            cardColor: card.cardColor || null,
            tags: [...(card.tags || [])],
            subtasks: (card.subtasks || []).map(s => ({ text: s.text, done: false })),
            checklist: (card.checklist || []).map(i => ({ text: i.text, done: false })),
            links: [...(card.links || [])],
            logs: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
        await addDoc(collection(db, "workflowCards"), copy);
        showToast("Kaart gedupliceerd", "success");
    } catch(err) {
        console.error(err);
        showToast("Dupliceren mislukt", "error");
    }
}

function closeContextMenu() {
    const existing = document.getElementById("active-context-menu");
    if(existing) existing.remove();
}
    
async function sendToAgenda() {
    if(!apiSettings.webhookUrl) return showToast("Geen API settings", "error");
    
    const date = $('qp-date').value; 
    const time = $('qp-time').value;
    const duration = $('qp-duration').value; // Formaat HH:MM (bv. 02:30)

    if(!date || !time || !duration) return showToast("Datum, tijd en duur verplicht", "error");
    
    showToast("Verzenden...", "info");

    // 1. Bereken Start Datumobject
    const startIso = `${date}T${time}:00`;
    const startDate = new Date(startIso);

    // 2. Bereken Eind Datumobject (Start + Duur)
    const [hours, minutes] = duration.split(':').map(Number);
    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + hours);
    endDate.setMinutes(endDate.getMinutes() + minutes);

    // 3. Formatteer naar ISO strings voor Google Calendar
    // We gebruiken een simpele truc om lokale tijd te behouden in ISO formaat (zonder timezone conversie issues)
    const formatLocalISO = (d) => {
        const offset = d.getTimezoneOffset() * 60000;
        return (new Date(d - offset)).toISOString().slice(0, -1).split('.')[0]; // Verwijdert 'Z' en ms
    };

    const finalStart = formatLocalISO(startDate);
    const finalEnd = formatLocalISO(endDate);

    const payload = {
        token: apiSettings.token, 
        calendarId: "werk", // Pas aan indien nodig
        title: "Focus - " + $('inpTitle').value,
        start: finalStart, 
        end: finalEnd, 
        description: "Zie workflow kaart", 
        location: "Kantoor", 
        tz: "Europe/Brussels"
    };

    try {
        const res = await fetch(apiSettings.webhookUrl, { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify(payload) 
        });

        if(res.ok) {
            showToast("Ingepland!", "success");
            $('modal-quick-plan').hidden = true;

            const logMsg = `📅 Ingepland in agenda op ${date} om ${time} (${hours}u${minutes}m)`;
            currentLogs.push({ content: logMsg, timestamp: new Date().toISOString() });
            renderLogs();

            if(currentCardId) {
                updateDoc(doc(db, "workflowCards", currentCardId), { logs: currentLogs })
                    .catch(err => console.error("Log auto-save mislukt", err));
            }

        } else {
            showToast("Fout bij agenda server", "error");
        }
    } catch(e) { 
        console.error(e);
        showToast("Netwerkfout", "error"); 
    }
}


init();