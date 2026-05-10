import { getCurrentUser, watchUser } from "../../services/auth.js";
import {
    subscribeToSubjects, addSubject, updateSubject, deleteSubject,
    subscribeToBacklog, addBacklogItem, updateBacklogItem, deleteBacklogItem,
    subscribeToPlans, addPlan, updatePlan, deletePlan
} from "../../services/db.js";

/* ───────────────────────── State & Config ───────────────────────── */
let currentUser = null;
let subjects = [];
let backlog = [];
let plans = [];
let weekStart = startOfWeek(new Date());
let viewMode = 'week'; 
let dayDate = new Date();
let dragData = null;
let touchDragPlan = null; // touch drag-drop state
let plansUnsub = null;
let listenersReady = false;
let timerInterval = null;
let timerSeconds = 0;
let nowInterval = null;
let createState = null;
let pendingSelEl = null;
let modalDate = null;
let selectedBacklogItemId = null;
let planFreeColor = '#2196F3';
let planFreeType = 'afspraak';
let editingPlanId = null;
let planRecurType = 'none';
let planRecurDays = [];
let planRecurInterval = 1;
let planRecurUnit = 'day';
let activeTooltip = null;
let replanMode = null;
let replanPlan = null;
let backlogSearchQuery = '';
let undoToastTimer = null;
let renderCalendarRaf = null;
let renderBacklogRaf = null;
const FREE_SYMBOLS = { afspraak: '📅', hobby: '🎯', andere: '📌' };

const SYMBOLS = { taak: "📝", toets: "🧪", examen: "🎓", andere: "📚" };
const SHARED_ID = "shared-planner";
const HOUR_HEIGHT = 60; // matches --hour-h in CSS
const PALETTE = [
    '#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5',
    '#2196F3', '#03A9F4', '#00BCD4', '#009688', '#4CAF50',
    '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107', '#FF9800',
    '#FF5722', '#795548', '#9E9E9E', '#607D8B', '#f87171',
    '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#2dd4bf'
];

const els = {
    calRoot: document.getElementById("calendar"),
    backlogRoot: document.getElementById("backlogGroups"),
    weekTitle: document.getElementById("weekTitle"),
    prevBtn: document.getElementById("prevWeek"),
    nextBtn: document.getElementById("nextWeek"),
    viewWeekBtn: document.getElementById("viewWeek"),
    viewDayBtn: document.getElementById("viewDay"),
    modalBacklog: document.getElementById("modal-backlog"),
    formBacklog: document.getElementById("bl-form"),
    newBacklogBtn: document.getElementById("newBacklogBtn"),
    manageSubjectsBtn: document.getElementById("manageSubjectsBtn"),
    subjectsTable: document.getElementById("subjectsTable"),
    todayBtn: document.getElementById("todayBtn")
};

const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function confirmDialog(message) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999';
        const box = document.createElement('div');
        box.style.cssText = 'background:var(--card,#1e293b);border:1px solid var(--border,#334155);border-radius:12px;padding:24px;max-width:360px;width:90%;display:flex;flex-direction:column;gap:16px';
        const msg = document.createElement('p');
        msg.textContent = message;
        msg.style.cssText = 'margin:0;font-size:0.95rem';
        const btns = document.createElement('div');
        btns.style.cssText = 'display:flex;justify-content:flex-end;gap:10px';
        const no = document.createElement('button');
        no.textContent = 'Annuleren';
        no.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid var(--border,#334155);background:transparent;cursor:pointer;color:inherit';
        const yes = document.createElement('button');
        yes.textContent = 'Verwijderen';
        yes.style.cssText = 'padding:6px 14px;border-radius:6px;border:none;background:#ef4444;color:#fff;cursor:pointer';
        btns.append(no, yes);
        box.append(msg, btns);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        const cleanup = result => { overlay.remove(); resolve(result); };
        yes.onclick = () => cleanup(true);
        no.onclick = () => cleanup(false);
        overlay.onclick = e => { if(e.target === overlay) cleanup(false); };
    });
}

/* ───────────────────────── Helpers & Logica ───────────────────────── */
function startOfWeek(d) {
    const x = new Date(d);
    const day = x.getDay(), diff = x.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(x.setDate(diff));
    monday.setHours(0,0,0,0);
    return monday;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addHours(d, h) { const x = new Date(d); x.setTime(x.getTime() + (h * 60 * 60 * 1000)); return x; }
function sym(type) { return SYMBOLS[type] || "📌"; }

function showNotesTooltip(anchorEl, notes) {
    removeNotesTooltip();
    const tip = document.createElement('div');
    tip.className = 'evt-tooltip';
    tip.textContent = notes;
    tip.style.visibility = 'hidden';
    document.body.appendChild(tip);
    const r = anchorEl.getBoundingClientRect();
    const h = tip.offsetHeight, w = tip.offsetWidth;
    let top = r.top - h - 8;
    if (top < 4) top = r.bottom + 8;
    let left = r.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 8) left = 8;
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
    tip.style.visibility = '';
    activeTooltip = tip;
}

function removeNotesTooltip() {
    if (activeTooltip) { activeTooltip.remove(); activeTooltip = null; }
}

function showUndoToast(message, undoFn) {
    document.querySelectorAll('.undo-toast').forEach(t => t.remove());
    if (undoToastTimer) { clearTimeout(undoToastTimer); undoToastTimer = null; }
    const toast = document.createElement('div');
    toast.className = 'undo-toast';
    toast.innerHTML = `<span>${message}</span><button class="undo-toast-btn">Ongedaan maken</button>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('is-visible'), 10);
    undoToastTimer = setTimeout(() => { toast.remove(); undoToastTimer = null; }, 5000);
    toast.querySelector('.undo-toast-btn').onclick = () => {
        clearTimeout(undoToastTimer);
        undoToastTimer = null;
        toast.remove();
        undoFn();
    };
}

function openDayNotePopover(date, anchor) {
    document.querySelectorAll('.day-note-popover').forEach(p => p.remove());
    const y = date.getFullYear(), mo = String(date.getMonth()+1).padStart(2,'0'), d = String(date.getDate()).padStart(2,'0');
    const key = `planner_day_note_${y}-${mo}-${d}`;
    const current = localStorage.getItem(key) || '';
    const pop = document.createElement('div');
    pop.className = 'day-note-popover';
    pop.innerHTML = `
        <textarea class="day-note-textarea" placeholder="Dagnotitie..."></textarea>
        <div class="day-note-actions">
            <button class="btn-ghost day-note-cancel">Annuleren</button>
            <button class="btn-primary day-note-save">Opslaan</button>
        </div>
    `;
    const rect = anchor.getBoundingClientRect();
    let left = rect.left;
    if (left + 224 > window.innerWidth - 8) left = window.innerWidth - 232;
    pop.style.top = `${rect.bottom + 4}px`;
    pop.style.left = `${Math.max(8, left)}px`;
    document.body.appendChild(pop);
    pop.querySelector('textarea').value = current;
    pop.querySelector('textarea').focus();
    pop.querySelector('.day-note-save').onclick = () => {
        const val = pop.querySelector('textarea').value.trim();
        if (val) localStorage.setItem(key, val); else localStorage.removeItem(key);
        pop.remove();
        renderCalendar();
    };
    pop.querySelector('.day-note-cancel').onclick = () => pop.remove();
    setTimeout(() => document.addEventListener('click', (ev) => {
        if (!pop.contains(ev.target)) pop.remove();
    }, { once: true }), 50);
}

function yToTime(y) {
    const totalMins = Math.max(0, y / HOUR_HEIGHT * 60);
    const snapped = Math.round(totalMins / 15) * 15;
    const h = Math.floor(snapped / 60) + 7;
    const m = snapped % 60;
    if (h < 7) return { h: 7, m: 0 };
    if (h > 22 || (h === 22 && m > 45)) return { h: 22, m: 45 };
    return { h, m };
}

function addMinutes(t, mins) {
    const total = t.h * 60 + t.m + mins;
    const clamped = Math.min(total, 23 * 60);
    return { h: Math.floor(clamped / 60), m: clamped % 60 };
}

function updateSelEl(el, t1, t2) {
    let start = t1, end = t2;
    if (t1.h * 60 + t1.m > t2.h * 60 + t2.m) { start = t2; end = t1; }
    const minEnd = addMinutes(start, 15);
    if (end.h * 60 + end.m < minEnd.h * 60 + minEnd.m) end = minEnd;
    const top = (start.h - 7) * HOUR_HEIGHT + (start.m / 60) * HOUR_HEIGHT;
    const height = Math.max(HOUR_HEIGHT / 4, ((end.h - 7) * HOUR_HEIGHT + (end.m / 60) * HOUR_HEIGHT) - top);
    el.style.top = `${top}px`;
    el.style.height = `${height}px`;
    const fmt = t => `${String(t.h).padStart(2,'0')}:${String(t.m).padStart(2,'0')}`;
    el.textContent = `${fmt(start)} – ${fmt(end)}`;
    return { start, end };
}

function cleanupCreateGesture() {
    if (pendingSelEl) { pendingSelEl.remove(); pendingSelEl = null; }
    createState = null;
    modalDate = null;
}

function getContrast(hex) {
    if(!hex) return "#000";
    const r = parseInt(hex.substr(1,2),16), g = parseInt(hex.substr(3,2),16), b = parseInt(hex.substr(5,2),16);
    return ((r*299 + g*587 + b*114)/1000) >= 128 ? '#000' : '#fff';
}

function isSameDay(d1, d2) { 
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate(); 
}

function computeLayout(dayPlans) {
    if (dayPlans.length === 0) return {};
    const events = dayPlans.map(p => {
        const start = p.start instanceof Date ? p.start : new Date(p.start);
        return { id: p.id, startMs: start.getTime(), endMs: start.getTime() + (p.durationHours || 1) * 3600000 };
    }).sort((a, b) => a.startMs - b.startMs);

    const cols = [];
    const assignments = {};
    for (const ev of events) {
        let placed = false;
        for (let i = 0; i < cols.length; i++) {
            if (ev.startMs >= cols[i]) { cols[i] = ev.endMs; assignments[ev.id] = i; placed = true; break; }
        }
        if (!placed) { assignments[ev.id] = cols.length; cols.push(ev.endMs); }
    }

    const result = {};
    for (const ev of events) {
        const overlapping = events.filter(o => o.id !== ev.id && o.startMs < ev.endMs && o.endMs > ev.startMs);
        if (overlapping.length === 0) {
            result[ev.id] = { col: assignments[ev.id], totalCols: 1 };
        } else {
            const maxCol = Math.max(assignments[ev.id], ...overlapping.map(o => assignments[o.id]));
            result[ev.id] = { col: assignments[ev.id], totalCols: maxCol + 1 };
        }
    }
    return result;
}

function scheduleRenderCalendar() {
    if (renderCalendarRaf) cancelAnimationFrame(renderCalendarRaf);
    renderCalendarRaf = requestAnimationFrame(() => { renderCalendarRaf = null; renderCalendar(); });
}
function scheduleRenderBacklog() {
    if (renderBacklogRaf) cancelAnimationFrame(renderBacklogRaf);
    renderBacklogRaf = requestAnimationFrame(() => { renderBacklogRaf = null; renderBacklog(); });
}
function getPlanCounts() {
    const counts = {};
    plans.forEach(p => { if (p.itemId) counts[p.itemId] = (counts[p.itemId] || 0) + 1; });
    return counts;
}
function showDropIndicator(col, t) {
    let ind = col.querySelector('.drop-indicator');
    if (!ind) { ind = document.createElement('div'); ind.className = 'drop-indicator'; col.appendChild(ind); }
    ind.style.top = `${(t.h - 7) * HOUR_HEIGHT + (t.m / 60) * HOUR_HEIGHT}px`;
    ind.dataset.time = `${String(t.h).padStart(2,'0')}:${String(t.m).padStart(2,'0')}`;
}
function removeDropIndicator(col) {
    col.querySelector('.drop-indicator')?.remove();
}

/* ───────────────────────── Init & Streams ───────────────────────── */
function updateBellIcon() {
    const btn = document.getElementById('notifBtn');
    if (!btn) return;
    const granted = 'Notification' in window && Notification.permission === 'granted';
    const enabled = localStorage.getItem('planner_notif_enabled') !== 'false';
    btn.classList.toggle('notif-active', granted && enabled);
    btn.title = granted && enabled ? 'Herinneringen aan' : 'Herinneringen instellen';
}

function checkDeadlineNotifications() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (localStorage.getItem('planner_notif_enabled') === 'false') return;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    const sentKey = 'planner_notif_sent';
    const sent = JSON.parse(localStorage.getItem(sentKey) || '{}');
    for (const k of Object.keys(sent)) { if (!k.endsWith(todayStr)) delete sent[k]; }

    backlog.filter(i => !i.done && i.dueDate).forEach(item => {
        const due = item.dueDate.toDate ? item.dueDate.toDate() : new Date(item.dueDate);
        const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
        const diff = Math.round((dueDay - today) / 86400000);
        if (diff < 0 || diff > 7) return;
        const key = `${item.id}_${todayStr}`;
        if (sent[key]) return;
        const title = diff === 0 ? '⚠️ Deadline vandaag!' : diff === 1 ? '📅 Deadline morgen' : `📅 Deadline over ${diff} dagen`;
        new Notification(title, { body: `${item.title}${item.subjectName ? ' — ' + item.subjectName : ''}`, tag: item.id });
        sent[key] = true;
    });
    localStorage.setItem(sentKey, JSON.stringify(sent));
}

async function init() {
    if (window.innerWidth < 640) {
        viewMode = 'day';
        els.viewDayBtn?.classList.add("is-active");
        els.viewWeekBtn?.classList.remove("is-active");
    }
    updateBellIcon();
    watchUser((user) => {
        currentUser = user;
        if (user) {
            startStreams();
            if (!listenersReady) {
                setupEventListeners();
                listenersReady = true;
            }
        } else {
            window.location.href = "../../../index.html";
        }
    });
}

function startStreams() {
    subscribeToSubjects(SHARED_ID, (data) => {
        subjects = data;
        renderSubjectsManager();
        scheduleRenderBacklog();
    });

    subscribeToBacklog(SHARED_ID, (data) => {
        backlog = data;
        scheduleRenderBacklog();
        updateExamenCountdown();
        checkDeadlineNotifications();
    });

    loadPlans();
    startNowInterval();
}

function startNowInterval() {
    if (nowInterval) clearInterval(nowInterval);
    nowInterval = setInterval(() => {
        const m = new Date().getMinutes();
        if (m % 15 === 0) {
            renderCalendar();
        } else {
            updateNowIndicators();
        }
    }, 60_000);
}

function loadPlans() {
    const start = (viewMode === 'day') ? dayDate : weekStart;
    const end = (viewMode === 'day') ? addDays(dayDate, 1) : addDays(weekStart, 7);
    
    if (plansUnsub) plansUnsub();

    plansUnsub = subscribeToPlans(SHARED_ID, start, end, (data) => {
        plans = data;
        scheduleRenderCalendar();
        scheduleRenderBacklog();
    });
    
    const fmt = d => d.toLocaleDateString('nl-BE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    if(els.weekTitle) {
        els.weekTitle.textContent = (viewMode === 'day')
            ? `Dag – ${fmt(start)}`
            : `Week ${fmt(start)} t/m ${fmt(addDays(start, 6))}`;
    }
    scheduleRenderBacklog();
}

/* ───────────────────────── Rendering ───────────────────────── */
function renderCalendar() {
    if (!els.calRoot) return;
    els.calRoot.innerHTML = "";
    const daysToShow = (viewMode === 'day') ? 1 : 7;
    const startDate = (viewMode === 'day') ? dayDate : weekStart;

    els.calRoot.appendChild(document.createElement("div")); 
    
    for(let i=0; i<daysToShow; i++) {
        const d = addDays(startDate, i);
        const colHead = document.createElement("div");
        colHead.className = "col-head";
        if (isSameDay(d, new Date())) colHead.classList.add("is-today");
        const topRow = document.createElement('div');
        topRow.className = 'col-head-top';
        const dateLabel = document.createElement('span');
        dateLabel.textContent = d.toLocaleDateString('nl-BE', { weekday: 'short', day: '2-digit' });
        topRow.appendChild(dateLabel);
        const noteKeyHead = `planner_day_note_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const noteTextHead = localStorage.getItem(noteKeyHead) || '';
        const noteBtn = document.createElement('button');
        noteBtn.className = `day-note-btn${noteTextHead ? ' has-note' : ''}`;
        noteBtn.innerHTML = '📝';
        noteBtn.title = noteTextHead || 'Dagnotitie toevoegen';
        noteBtn.onclick = (e) => { e.stopPropagation(); openDayNotePopover(d, noteBtn); };
        topRow.appendChild(noteBtn);
        colHead.appendChild(topRow);
        const dlItems = backlog.filter(i => !i.done && i.dueDate && isSameDay(
            i.dueDate.toDate ? i.dueDate.toDate() : new Date(i.dueDate), d
        ));
        if (dlItems.length > 0) {
            const markers = document.createElement('div');
            markers.className = 'dl-markers';
            dlItems.forEach(item => {
                const dot = document.createElement('span');
                dot.className = 'dl-marker-dot';
                dot.style.background = item.color || '#607d8b';
                dot.title = `📅 ${item.title}`;
                markers.appendChild(dot);
            });
            colHead.appendChild(markers);
        }
        els.calRoot.appendChild(colHead);
    }

    const timeCol = document.createElement("div");
    timeCol.className = "time-col";
    for(let h=7; h<23; h++) {
        const hour = document.createElement("div");
        hour.className = "time-slot";
        hour.textContent = `${String(h).padStart(2,'0')}:00`;
        timeCol.appendChild(hour);
        for (const [m, cls] of [[15,'time-quarter'],[30,'time-half'],[45,'time-quarter']]) {
            const sub = document.createElement("div");
            sub.className = cls;
            if (m === 30) sub.textContent = `${String(h).padStart(2,'0')}:30`;
            timeCol.appendChild(sub);
        }
    }
    const todayInView = Array.from({ length: daysToShow }, (_, i) => addDays(startDate, i))
        .some(d => isSameDay(d, new Date()));
    if (todayInView) {
        const now = new Date();
        const h = now.getHours(), m = now.getMinutes();
        if (h >= 7 && h < 23) {
            const label = document.createElement('div');
            label.className = 'now-time-label';
            label.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
            label.style.top = `${(h - 7) * HOUR_HEIGHT + (m / 60) * HOUR_HEIGHT}px`;
            timeCol.appendChild(label);
        }
    }
    els.calRoot.appendChild(timeCol);

    for(let i=0; i<daysToShow; i++) {
        const currentDay = addDays(startDate, i);
        const col = document.createElement("div");
        col.className = "day-col";
        col.dataset.date = currentDay.toISOString();

        col.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!dragData) return;
            showDropIndicator(col, yToTime(e.clientY - col.getBoundingClientRect().top));
        });
        col.addEventListener('dragleave', (e) => {
            if (!e.relatedTarget || !col.contains(e.relatedTarget)) removeDropIndicator(col);
        });
        col.addEventListener('drop', async (e) => {
            e.preventDefault();
            removeDropIndicator(col);
            document.body.classList.remove("is-dragging-backlog");
            if (!dragData) return;
            const t = yToTime(e.clientY - col.getBoundingClientRect().top);
            const newStart = new Date(currentDay);
            newStart.setHours(t.h, t.m, 0, 0);
            if (dragData.kind === "backlog") {
                const item = backlog.find(x => x.id === dragData.id);
                if (item) {
                    await addPlan({
                        itemId: item.id, title: item.title, type: item.type,
                        subjectId: item.subjectId, subjectName: item.subjectName,
                        color: item.color, symbol: sym(item.type),
                        start: newStart, durationHours: item.durationHours || 1, uid: SHARED_ID
                    });
                }
            } else if (dragData.kind === "move") {
                await updatePlan(dragData.id, { start: newStart });
            }
            dragData = null;
        });
        
        const dayPlans = plans.filter(p => {
            const pDate = p.start.toDate ? p.start.toDate() : new Date(p.start);
            return isSameDay(pDate, currentDay);
        });
        const layout = computeLayout(dayPlans);
        dayPlans.forEach(p => renderEventBlock(col, p, layout[p.id] || { col: 0, totalCols: 1 }));

        // Huidige tijdlijn op de dag van vandaag
        if (isSameDay(currentDay, new Date())) {
            const now = new Date();
            const h = now.getHours(), m = now.getMinutes();
            if (h >= 7 && h < 23) {
                const nowLine = document.createElement('div');
                nowLine.className = 'now-line';
                nowLine.style.top = `${(h - 7) * HOUR_HEIGHT + (m / 60) * HOUR_HEIGHT}px`;
                col.appendChild(nowLine);
            }
        }

        els.calRoot.appendChild(col);
    }
    els.calRoot.style.gridTemplateColumns = `80px repeat(${daysToShow}, 1fr)`;
    scrollToCurrentTime();
}


function renderEventBlock(col, p, layout) {
    const pDate = p.start.toDate ? p.start.toDate() : new Date(p.start);
    const startH = pDate.getHours(), startM = pDate.getMinutes();
    const duration = p.durationHours || 1;

    const startOffset = (startH - 7) * HOUR_HEIGHT + (startM / 60) * HOUR_HEIGHT;
    const height = duration * HOUR_HEIGHT;
    const { col: evCol, totalCols } = layout;

    const el = document.createElement("div");
    const isPast = !p.done && pDate < new Date();
    el.className = `event type-${p.type} ${totalCols > 1 ? 'has-conflict' : ''} ${p.done ? 'is-done' : ''} ${isPast ? 'is-missed' : ''}`.trim();
    el.style.top = `${startOffset}px`;
    el.style.height = `${height}px`;
    el.style.backgroundColor = p.color || "var(--primary)";
    el.style.color = getContrast(p.color);
    el.draggable = !p.done;

    const PAD = 4;
    if (totalCols === 1) {
        el.style.left = `${PAD}px`;
        el.style.width = `calc(100% - ${PAD * 2}px)`;
    } else {
        const pct = 100 / totalCols;
        el.style.left = `calc(${evCol * pct}% + ${PAD}px)`;
        el.style.width = `calc(${pct}% - ${PAD * 2}px)`;
    }

    el.innerHTML = `
        <button class="evt-menu-btn" title="Opties">⋮</button>
        <div class="evt-header">
            <span class="evt-sym">${p.symbol || sym(p.type)}</span>
            <div class="title">${escHtml(p.title)}</div>
            ${p.notes ? '<span class="evt-notes-icon">📝</span>' : ''}
        </div>
        <div class="meta">${escHtml(p.subjectName || '')}</div>
        ${!p.done ? '<div class="evt-resize-handle"></div>' : ''}
    `;
    if (p.notes) {
        el.addEventListener('mouseenter', () => showNotesTooltip(el, p.notes));
        el.addEventListener('mouseleave', removeNotesTooltip);
    }

    el.addEventListener("click", e => e.stopPropagation());
    el.addEventListener("dragstart", () => {
        dragData = { kind: "move", id: p.id };
        el.style.opacity = "0.5";
    });
    el.addEventListener("dragend", () => { el.style.opacity = "1"; });

    // Touch drag voor kalender events verplaatsen
    if (!p.done) {
        el.addEventListener('touchstart', (e) => {
            if (e.target.closest('.evt-resize-handle') || e.target.closest('.evt-menu-btn')) return;
            const touch = e.touches[0];
            touchDragPlan = {
                kind: 'move',
                id: p.id,
                el,
                startX: touch.clientX,
                startY: touch.clientY,
                moved: false,
                ghost: null,
                activeCol: null
            };
        }, { passive: true });
    }

    if (!p.done) {
        el.querySelector('.evt-resize-handle').addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            el.draggable = false;

            const startY = e.clientY;
            const startDuration = p.durationHours || 1;

            const onMouseMove = (mv) => {
                const deltaY = mv.clientY - startY;
                const quarters = Math.round(deltaY / (HOUR_HEIGHT / 4));
                const newDuration = Math.max(0.25, startDuration + quarters * 0.25);
                el.style.height = `${newDuration * HOUR_HEIGHT}px`;
            };

            const onMouseUp = async () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                el.draggable = true;

                const newDuration = Math.max(0.25, Math.round(parseFloat(el.style.height) / HOUR_HEIGHT * 4) / 4);
                if (newDuration !== startDuration) {
                    await updatePlan(p.id, { durationHours: newDuration });
                }
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    el.querySelector('.evt-menu-btn').onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.evt-dropdown-portal').forEach(d => d.remove());

        const rect = e.currentTarget.getBoundingClientRect();
        const menu = document.createElement('div');
        menu.className = 'evt-dropdown-portal';

        const menuItems = [];
        if (p.done) {
            menuItems.push({ label: '↩ Ongedaan maken', cls: 'undo', action: () => updatePlan(p.id, { done: false }) });
        } else {
            menuItems.push({ label: '✓ Markeer als klaar', cls: 'done', action: () => updatePlan(p.id, { done: true }) });
        }
        menuItems.push({ label: '✏️ Bewerken', cls: 'edit', action: () => openEditPlanModal(p) });
        menuItems.push({ label: '📋 Dupliceren', cls: 'copy', action: () => openReplanModal(p, 'duplicate') });
        menuItems.push({ label: '🗓 Andere dag', cls: 'move-day', action: () => openReplanModal(p, 'move') });
        menuItems.push({ label: '⏱️ Start Timer', cls: 'timer', action: () => startStudyTimer(p.title) });
        menuItems.push({ label: '🗑 Verwijderen', cls: 'del', action: () => {
            const { id: _id, ...planData } = p;
            deletePlan(p.id);
            showUndoToast('Blok verwijderd', () => addPlan(planData));
        }});

        menuItems.forEach(({ label, cls, action }) => {
            const btn = document.createElement('button');
            btn.textContent = label;
            btn.className = `evt-drop-item evt-drop-${cls}`;
            btn.onclick = (ev) => { ev.stopPropagation(); menu.remove(); action(); };
            menu.appendChild(btn);
        });

        const menuWidth = 170;
        const left = Math.max(4, rect.right - menuWidth);
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.left = `${left}px`;
        document.body.appendChild(menu);
    };

    col.appendChild(el);
}

function generateRecurDates(newStart, endDate) {
    const dates = [];
    if (planRecurType === 'daily') {
        let cur = new Date(newStart); let n = 0;
        while (cur <= endDate && n++ < 365) { dates.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
    } else if (planRecurType === 'weekly' || planRecurType === 'biweekly') {
        const step = planRecurType === 'biweekly' ? 14 : 7;
        const days = planRecurDays.length > 0 ? planRecurDays : [newStart.getDay()];
        days.forEach(targetDay => {
            let cur = new Date(newStart);
            const diff = (targetDay - cur.getDay() + 7) % 7;
            cur.setDate(cur.getDate() + diff);
            cur.setHours(newStart.getHours(), newStart.getMinutes(), 0, 0);
            let n = 0;
            while (cur <= endDate && n++ < 365) { dates.push(new Date(cur)); cur.setDate(cur.getDate() + step); }
        });
    } else if (planRecurType === 'monthly') {
        let cur = new Date(newStart); let n = 0;
        while (cur <= endDate && n++ < 60) { dates.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1); }
    } else if (planRecurType === 'custom') {
        let cur = new Date(newStart); let n = 0;
        while (cur <= endDate && n++ < 365) {
            dates.push(new Date(cur));
            if (planRecurUnit === 'day')   cur.setDate(cur.getDate() + planRecurInterval);
            else if (planRecurUnit === 'week')  cur.setDate(cur.getDate() + planRecurInterval * 7);
            else if (planRecurUnit === 'month') cur.setMonth(cur.getMonth() + planRecurInterval);
        }
    }
    return dates.sort((a, b) => a - b);
}

function openEditPlanModal(plan) {
    editingPlanId = plan.id;
    const pDate = plan.start instanceof Date ? plan.start : new Date(plan.start);
    const subtitle = document.getElementById('edit-plan-subtitle');
    if (subtitle) subtitle.textContent = plan.title;
    const dateInput = document.getElementById('edit-plan-date');
    if (dateInput) {
        const y = pDate.getFullYear(), mo = String(pDate.getMonth()+1).padStart(2,'0'), d = String(pDate.getDate()).padStart(2,'0');
        dateInput.value = `${y}-${mo}-${d}`;
    }
    const timeInput = document.getElementById('edit-plan-time');
    if (timeInput) timeInput.value = `${String(pDate.getHours()).padStart(2,'0')}:${String(pDate.getMinutes()).padStart(2,'0')}`;
    const notesEl = document.getElementById('edit-plan-notes');
    if (notesEl) notesEl.value = plan.notes || '';

    const palEl = document.getElementById('edit-plan-palette');
    if (palEl) {
        const currentColor = plan.color || '#2196F3';
        palEl.innerHTML = PALETTE.map(c =>
            `<button type="button" class="swatch ${c === currentColor ? 'is-selected' : ''}" style="background:${c}" data-color="${c}"></button>`
        ).join('');
        palEl.onclick = (e) => {
            const sw = e.target.closest('.swatch');
            if (!sw) return;
            palEl.querySelectorAll('.swatch').forEach(s => s.classList.toggle('is-selected', s === sw));
        };
    }

    document.getElementById('modal-edit-plan').classList.add('is-active');
}

function openReplanModal(plan, mode) {
    replanPlan = plan;
    replanMode = mode;
    const pDate = plan.start instanceof Date ? plan.start : new Date(plan.start);
    const target = mode === 'duplicate' ? addDays(pDate, 1) : new Date(pDate);
    document.getElementById('replan-subtitle').textContent = plan.title;
    document.getElementById('replan-title').textContent = mode === 'duplicate' ? 'Dupliceren naar' : 'Verplaatsen naar';
    document.getElementById('replan-save').textContent = mode === 'duplicate' ? 'Dupliceren' : 'Verplaatsen';
    const y = target.getFullYear(), mo = String(target.getMonth()+1).padStart(2,'0'), d = String(target.getDate()).padStart(2,'0');
    document.getElementById('replan-date').value = `${y}-${mo}-${d}`;
    document.getElementById('replan-time').value = `${String(pDate.getHours()).padStart(2,'0')}:${String(pDate.getMinutes()).padStart(2,'0')}`;
    document.getElementById('modal-replan').classList.add('is-active');
}

const EXAM_SUB_SYM = { Samenvatting: '📖', Leren: '🧠', Herhalen: '🔄', Oefeningen: '✏️' };
function examSubSym(title) {
    const prefix = title.split(':')[0].trim();
    return EXAM_SUB_SYM[prefix] || '📌';
}

function deadlineBadge(dueDate) {
    if (!dueDate) return '';
    const due = dueDate.toDate ? dueDate.toDate() : new Date(dueDate);
    const days = Math.ceil((due - new Date()) / 864e5);
    let cls, text;
    if (days < 0)      { cls = 'dl-overdue'; text = 'te laat'; }
    else if (days === 0) { cls = 'dl-urgent';  text = 'vandaag'; }
    else if (days <= 3)  { cls = 'dl-urgent';  text = `${days}d`; }
    else if (days <= 7)  { cls = 'dl-soon';    text = `${days}d`; }
    else                 { cls = 'dl-ok';      text = due.toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit' }); }
    return `<span class="bl-deadline ${cls}">${text}</span>`;
}

function renderBacklog() {
    if (!els.backlogRoot) return;
    els.backlogRoot.innerHTML = "";

    // 1. Groeperen op vak
    const groupedBySubject = {};
    const now = new Date();
    const planCounts = getPlanCounts();
    const activeItems = backlog.filter(i => {
        if (i.done) return false;
        if (backlogSearchQuery) {
            const q = backlogSearchQuery.toLowerCase();
            if (!i.title.toLowerCase().includes(q) && !(i.subjectName || '').toLowerCase().includes(q)) return false;
        }
        if (!i.dueDate) return true;
        const due = i.dueDate.toDate ? i.dueDate.toDate() : new Date(i.dueDate);
        const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
        const viewStart = new Date(viewMode === 'day' ? dayDate : weekStart);
        viewStart.setHours(0, 0, 0, 0);
        return dueDay >= viewStart;
    });

    activeItems.forEach(item => {
        const subId = item.subjectId || "other";
        if (!groupedBySubject[subId]) {
            groupedBySubject[subId] = { name: item.subjectName || "Overig", color: item.color || "#607D8B", exams: {} };
        }
        
        const gId = item.groupId || 'standaard';
        if (!groupedBySubject[subId].exams[gId]) {
            groupedBySubject[subId].exams[gId] = { items: [] };
        }
        groupedBySubject[subId].exams[gId].items.push(item);
    });

    // Vaste sorteervolgorde voor de voorvoegsels
    const PREFIX_ORDER = ["Samenvatting", "Leren", "Herhalen", "Oefeningen"];
    const PRIORITY_ORDER = { hoog: 0, normaal: 1, laag: 2 };

    // 2. Renderen van de groepen
    for (const subId in groupedBySubject) {
        const sub = groupedBySubject[subId];
        const subContainer = document.createElement("div");
        subContainer.className = "bl-group is-collapsed";
        
        const itemCount = Object.values(sub.exams).reduce((sum, eg) => sum + eg.items.length, 0);
        subContainer.innerHTML = `
            <div class="bl-title" style="border-left-color:${sub.color}">
                <span class="bl-title-dot" style="background:${sub.color}"></span>
                <span class="bl-title-name">${escHtml(sub.name)}</span>
                <span class="bl-count">${itemCount}</span>
                <span class="toggle-icon">▼</span>
            </div>
            <div class="bl-list"></div>
        `;

        subContainer.querySelector(".bl-title").onclick = () => subContainer.classList.toggle("is-collapsed");
        const listEl = subContainer.querySelector(".bl-list");

        for (const gId in sub.exams) {
            const examGroup = sub.exams[gId];
            
            // SORTEREN: 1. Examen bovenaan, 2. Prioriteit, 3. Voorvoegsel, 4. Alfabetisch
            examGroup.items.sort((a, b) => {
                if (a.type === 'examen') return -1;
                if (b.type === 'examen') return 1;

                const priA = PRIORITY_ORDER[a.priority || 'normaal'];
                const priB = PRIORITY_ORDER[b.priority || 'normaal'];
                if (priA !== priB) return priA - priB;

                const prefixA = a.title.split(':')[0].trim();
                const prefixB = b.title.split(':')[0].trim();
                let idxA = PREFIX_ORDER.indexOf(prefixA);
                let idxB = PREFIX_ORDER.indexOf(prefixB);
                if (idxA === -1) idxA = 99;
                if (idxB === -1) idxB = 99;
                if (idxA !== idxB) return idxA - idxB;
                return a.title.localeCompare(b.title);
            });

            const isExamenGroup = gId !== 'standaard' && examGroup.items.some(i => i.type === 'examen');
            const groupWrapper = isExamenGroup ? document.createElement("div") : listEl;
            
            if (isExamenGroup) {
                groupWrapper.className = "examen-wrapper is-collapsed";
                listEl.appendChild(groupWrapper);
            }

            let subTasksContainer = null;
            if (isExamenGroup) {
                subTasksContainer = document.createElement("div");
                subTasksContainer.className = "examen-subtasks";
            }

            examGroup.items.forEach(item => {
                const itemEl = document.createElement("div");
                const isMainExamen = item.type === 'examen';
                itemEl.className = `bl-item type-${item.type} ${isMainExamen ? 'is-main-examen' : ''}`;
                itemEl.draggable = true;
                
                // Voeg een inklap-pijltje toe aan het hoofd-examen
                let toggleHtml = isMainExamen && isExamenGroup ? `<div class="exam-toggle">▼</div>` : ``;

                const itemSym = isMainExamen
                    ? ''
                    : `<div class="bl-sym">${isExamenGroup ? examSubSym(item.title) : sym(item.type)}</div>`;

                const priBadge = item.priority === 'hoog' ? '<span class="bl-pri bl-pri-hoog">↑</span>'
                    : item.priority === 'laag' ? '<span class="bl-pri bl-pri-laag">↓</span>' : '';
                itemEl.innerHTML = `
                    ${itemSym}
                    <div class="bl-main">
                        <div class="t">${escHtml(item.title)}</div>
                    </div>
                    ${priBadge}
                    ${toggleHtml}
                    ${deadlineBadge(item.dueDate)}
                    ${planCounts[item.id] ? `<span class="bl-plan-count" title="Ingepland">${planCounts[item.id]}×</span>` : ''}
                    <div class="bl-actions">
                        <button class="btn-icon sm neutral check-btn" title="Afvinken">✓</button>
                        <button class="btn-icon sm neutral edit-btn" title="Bewerken">✏️</button>
                        <button class="btn-icon sm danger del-btn" title="Verwijderen">🗑</button>
                    </div>
                `;

                itemEl.addEventListener("dragstart", () => {
                    dragData = { kind: "backlog", id: item.id };
                    document.body.classList.add("is-dragging-backlog");
                    setTimeout(() => itemEl.classList.add("is-dragging"), 0);
                });
                itemEl.addEventListener("dragend", () => {
                    document.body.classList.remove("is-dragging-backlog");
                    itemEl.classList.remove("is-dragging");
                });

                // Touch drag
                itemEl.addEventListener('touchstart', (e) => {
                    const touch = e.touches[0];
                    touchDragPlan = {
                        kind: 'backlog',
                        id: item.id,
                        item,
                        el: itemEl,
                        startX: touch.clientX,
                        startY: touch.clientY,
                        moved: false,
                        ghost: null,
                        activeCol: null
                    };
                }, { passive: true });
                itemEl.querySelector(".check-btn").onclick = async (e) => {
                    e.stopPropagation();
                    const doneAt = new Date();
                    await updateBacklogItem(item.id, { done: true, doneAt });
                    if (item.type === 'examen' && item.groupId) {
                        const siblings = backlog.filter(i => i.groupId === item.groupId && i.id !== item.id);
                        await Promise.all(siblings.map(s => updateBacklogItem(s.id, { done: true, doneAt })));
                    }
                };
                itemEl.querySelector(".del-btn").onclick = (e) => {
                    e.stopPropagation();
                    const { id: _id, ...itemData } = item;
                    deleteBacklogItem(item.id);
                    showUndoToast('Item verwijderd', () => addBacklogItem(itemData));
                };
                itemEl.querySelector(".edit-btn").onclick = (e) => { e.stopPropagation(); openEditBacklog(item); };
                
                if (isExamenGroup) {
                    if (isMainExamen) {
                        groupWrapper.appendChild(itemEl);
                        groupWrapper.appendChild(subTasksContainer);
                        
                        // Klik logica op het Examen-blokje om de deeltaken te verbergen
                        itemEl.style.cursor = "pointer";
                        itemEl.onclick = (e) => {
                            if (!e.target.closest('button')) {
                                groupWrapper.classList.toggle("is-collapsed");
                            }
                        };
                    } else {
                        subTasksContainer.appendChild(itemEl);
                    }
                } else {
                    groupWrapper.appendChild(itemEl);
                }
            });
        }
        els.backlogRoot.appendChild(subContainer);
    }

    if (activeItems.length === 0) {
        els.backlogRoot.innerHTML = `
            <div class="bl-empty">
                <div class="bl-empty-icon">📭</div>
                <p>Geen items in de backlog</p>
                <span>Voeg een item toe via "+ Nieuw item"</span>
            </div>
        `;
    }

    // Afgeronde items onderaan (verdwijnen 14 dagen na doneAt)
    const doneItems = backlog.filter(i => {
        if (!i.done) return false;
        if (!i.doneAt) return true;
        const dAt = i.doneAt.toDate ? i.doneAt.toDate() : new Date(i.doneAt);
        return addDays(dAt, 14) >= now;
    });
    if (doneItems.length > 0) {
        const doneSection = document.createElement('div');
        doneSection.className = 'bl-done-section is-collapsed';
        doneSection.innerHTML = `
            <div class="bl-done-header">
                <span class="toggle-icon">▼</span>
                <span>Afgerond</span>
                <span class="bl-count">${doneItems.length}</span>
            </div>
            <div class="bl-done-list"></div>
        `;
        doneSection.querySelector('.bl-done-header').onclick = () => doneSection.classList.toggle('is-collapsed');
        const doneList = doneSection.querySelector('.bl-done-list');
        doneItems.forEach(item => {
            const el = document.createElement('div');
            el.className = 'bl-item bl-item--done';
            el.innerHTML = `
                <div class="bl-sym">${sym(item.type)}</div>
                <div class="bl-main"><div class="t">${item.title}</div></div>
                <div class="bl-actions" style="opacity:1">
                    <button class="btn-icon sm neutral undo-btn" title="Terugdraaien">↩</button>
                    <button class="btn-icon sm danger del-btn" title="Verwijderen">🗑</button>
                </div>
            `;
            el.querySelector('.undo-btn').onclick = () => updateBacklogItem(item.id, { done: false, doneAt: null });
            el.querySelector('.del-btn').onclick = () => {
                const { id: _id, ...itemData } = item;
                deleteBacklogItem(item.id);
                showUndoToast('Item verwijderd', () => addBacklogItem(itemData));
            };
            doneList.appendChild(el);
        });
        els.backlogRoot.appendChild(doneSection);
    }
}

function updateExamenCountdown() {
    const examens = backlog.filter(i => i.type === 'examen' && !i.done && i.dueDate);
    const header = document.querySelector('.planner-toolbar');
    let timerEl = document.getElementById('examen-timer');

    if (examens.length === 0) { if(timerEl) timerEl.remove(); return; }

    if (!timerEl) {
        timerEl = document.createElement('div');
        timerEl.id = 'examen-timer';
        header.prepend(timerEl);
    }

    const next = [...examens].sort((a,b) => {
        const da = a.dueDate.toDate ? a.dueDate.toDate() : new Date(a.dueDate);
        const db = b.dueDate.toDate ? b.dueDate.toDate() : new Date(b.dueDate);
        return da - db;
    })[0];

    const dDate = next.dueDate.toDate ? next.dueDate.toDate() : new Date(next.dueDate);
    const diff = Math.ceil((dDate - new Date()) / (1000 * 60 * 60 * 24));
    timerEl.textContent = `🎓 Volgend examen: ${next.title} over ${diff} dagen`;
}

function updateNowIndicators() {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    const topPx = (h >= 7 && h < 23) ? (h - 7) * HOUR_HEIGHT + (m / 60) * HOUR_HEIGHT : null;

    const nowLine = document.querySelector('.now-line');
    if (nowLine && topPx !== null) nowLine.style.top = `${topPx}px`;

    const label = document.querySelector('.now-time-label');
    if (label && topPx !== null) {
        label.style.top = `${topPx}px`;
        label.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    }
}

function scrollToCurrentTime() {
    const nowLine = document.querySelector('.now-line');
    if (!nowLine) return;
    const rect = nowLine.getBoundingClientRect();
    const target = window.scrollY + rect.top - window.innerHeight * 0.3;
    window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

function updateTimerDisplay() {
    const el = document.getElementById('pomo-time');
    if (!el) return;
    const m = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
    const s = String(timerSeconds % 60).padStart(2, '0');
    el.textContent = `${m}:${s}`;
}

function startStudyTimer(title) {
    const panel = document.getElementById('pomodoro-panel');
    if (!panel) return;
    clearInterval(timerInterval);
    timerSeconds = 25 * 60;
    document.getElementById('pomo-title').textContent = title;
    document.getElementById('pomo-pause').textContent = '⏸ Pauze';
    updateTimerDisplay();
    panel.classList.add('is-active');
    timerInterval = setInterval(() => {
        timerSeconds--;
        updateTimerDisplay();
        if (timerSeconds <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            document.getElementById('pomo-time').textContent = 'Klaar! 🎉';
        }
    }, 1000);
}

/* ───────────────────────── Events & Modals ───────────────────────── */
/* ───────────────────── Nieuw plan modal ───────────────────── */
function openNewPlanModal(date, startTime, endTime, selEl) {
    if (!date) return;
    modalDate = date;

    const dateStr = date.toLocaleDateString('nl-BE', { weekday: 'long', day: '2-digit', month: 'long' });
    document.getElementById('new-plan-time-label').textContent = dateStr;

    // Set date/time inputs in footer
    const y = date.getFullYear(), mo = String(date.getMonth()+1).padStart(2,'0'), d = String(date.getDate()).padStart(2,'0');
    document.getElementById('plan-start-date').value = `${y}-${mo}-${d}`;
    document.getElementById('plan-start-time').value = `${String(startTime.h).padStart(2,'0')}:${String(startTime.m).padStart(2,'0')}`;
    document.getElementById('plan-end-time').value = `${String(endTime.h).padStart(2,'0')}:${String(endTime.m).padStart(2,'0')}`;

    if (pendingSelEl && pendingSelEl !== selEl) pendingSelEl.remove();
    pendingSelEl = selEl || null;

    selectedBacklogItemId = null;
    planFreeType = 'afspraak';
    planFreeColor = '#2196F3';
    planRecurType = 'none';
    planRecurDays = [];
    planRecurInterval = 1;
    planRecurUnit = 'day';
    document.getElementById('plan-free-title').value = '';
    document.querySelectorAll('#plan-free-type-ctrl .seg').forEach(b => b.classList.toggle('is-active', b.dataset.ftype === 'afspraak'));
    const recurTypeEl = document.getElementById('plan-recur-type');
    if (recurTypeEl) recurTypeEl.value = 'none';
    const recurIntervalEl = document.getElementById('plan-recur-interval');
    if (recurIntervalEl) recurIntervalEl.value = '1';
    const recurUnitEl = document.getElementById('plan-recur-unit');
    if (recurUnitEl) recurUnitEl.value = 'day';
    document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('is-active'));
    ['plan-recur-end-field', 'plan-recur-days', 'plan-recur-custom'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const palEl = document.getElementById('plan-free-palette');
    if (palEl) {
        palEl.innerHTML = PALETTE.map(c =>
            `<button type="button" class="swatch ${c === planFreeColor ? 'is-selected' : ''}" style="background:${c}" data-color="${c}"></button>`
        ).join('');
        palEl.onclick = (e) => {
            const sw = e.target.closest('.swatch');
            if (!sw) return;
            planFreeColor = sw.dataset.color;
            palEl.querySelectorAll('.swatch').forEach(s => s.classList.toggle('is-selected', s.dataset.color === planFreeColor));
        };
    }

    switchPlanTab('backlog');
    populatePlanBacklogList('');
    document.getElementById('modal-new-plan').classList.add('is-active');
}

function switchPlanTab(tab) {
    document.querySelectorAll('.plan-tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
    document.getElementById('plan-tab-backlog').style.display = tab === 'backlog' ? '' : 'none';
    document.getElementById('plan-tab-free').style.display   = tab === 'free'    ? '' : 'none';
}

function populatePlanBacklogList(filter) {
    const planCounts = getPlanCounts();
    const list = document.getElementById('plan-bl-list');
    if (!list) return;
    list.innerHTML = '';

    const items = backlog.filter(i => {
        if (i.done) return false;
        if (!filter) return true;
        const q = filter.toLowerCase();
        return i.title.toLowerCase().includes(q) || (i.subjectName || '').toLowerCase().includes(q);
    });

    if (items.length === 0) {
        list.innerHTML = '<div class="plan-bl-empty">Geen items gevonden</div>';
        return;
    }

    const PREFIX_ORDER = ["Samenvatting", "Leren", "Herhalen", "Oefeningen"];
    const PRIORITY_ORDER = { hoog: 0, normaal: 1, laag: 2 };

    const groupedBySubject = {};
    items.forEach(item => {
        const subId = item.subjectId || "other";
        if (!groupedBySubject[subId]) {
            groupedBySubject[subId] = { name: item.subjectName || "Overig", color: item.color || "#607D8B", exams: {} };
        }
        const gId = item.groupId || 'standaard';
        if (!groupedBySubject[subId].exams[gId]) groupedBySubject[subId].exams[gId] = { items: [] };
        groupedBySubject[subId].exams[gId].items.push(item);
    });

    for (const subId in groupedBySubject) {
        const sub = groupedBySubject[subId];
        const itemCount = Object.values(sub.exams).reduce((sum, eg) => sum + eg.items.length, 0);

        const subContainer = document.createElement('div');
        subContainer.className = 'bl-group is-collapsed';
        subContainer.innerHTML = `
            <div class="bl-title" style="border-left-color:${sub.color}">
                <span class="bl-title-dot" style="background:${sub.color}"></span>
                <span class="bl-title-name">${escHtml(sub.name)}</span>
                <span class="bl-count">${itemCount}</span>
                <span class="toggle-icon">▼</span>
            </div>
            <div class="bl-list"></div>
        `;
        subContainer.querySelector('.bl-title').onclick = () => subContainer.classList.toggle('is-collapsed');
        const listEl = subContainer.querySelector('.bl-list');

        for (const gId in sub.exams) {
            const examGroup = sub.exams[gId];
            examGroup.items.sort((a, b) => {
                if (a.type === 'examen') return -1;
                if (b.type === 'examen') return 1;
                const priA = PRIORITY_ORDER[a.priority || 'normaal'];
                const priB = PRIORITY_ORDER[b.priority || 'normaal'];
                if (priA !== priB) return priA - priB;
                const prefA = a.title.split(':')[0].trim(), prefB = b.title.split(':')[0].trim();
                let iA = PREFIX_ORDER.indexOf(prefA), iB = PREFIX_ORDER.indexOf(prefB);
                if (iA === -1) iA = 99; if (iB === -1) iB = 99;
                if (iA !== iB) return iA - iB;
                return a.title.localeCompare(b.title);
            });

            const isExamenGroup = gId !== 'standaard' && examGroup.items.some(i => i.type === 'examen');
            if (isExamenGroup) {
                const examWrapper = document.createElement('div');
                examWrapper.className = 'examen-wrapper';
                const subTasksEl = document.createElement('div');
                subTasksEl.className = 'examen-subtasks';
                examGroup.items.forEach(item => {
                    const isMain = item.type === 'examen';
                    const el = makePlanModalItem(item, planCounts, isExamenGroup, isMain);
                    if (isMain) {
                        examWrapper.appendChild(el);
                        examWrapper.appendChild(subTasksEl);
                        el.addEventListener('click', () => examWrapper.classList.toggle('is-collapsed'));
                    } else {
                        subTasksEl.appendChild(el);
                    }
                });
                listEl.appendChild(examWrapper);
            } else {
                examGroup.items.forEach(item => listEl.appendChild(makePlanModalItem(item, planCounts, false, false)));
            }
        }
        list.appendChild(subContainer);
    }

    list.onclick = (e) => {
        const row = e.target.closest('.plan-bl-item');
        if (!row || row.classList.contains('is-main-examen')) return;
        selectedBacklogItemId = row.dataset.id;
        list.querySelectorAll('.plan-bl-item').forEach(i => i.classList.toggle('is-selected', i.dataset.id === selectedBacklogItemId));
    };
}

function makePlanModalItem(item, planCounts, isExamenGroup, isMainExamen) {
    const el = document.createElement('div');
    el.className = `plan-bl-item${isMainExamen ? ' is-main-examen' : ''}`;
    el.dataset.id = item.id;
    if (selectedBacklogItemId === item.id) el.classList.add('is-selected');
    const icon = isMainExamen ? '' : (isExamenGroup ? examSubSym(item.title) : sym(item.type));
    const count = planCounts[item.id] ? `<span class="plan-bl-count">${planCounts[item.id]}×</span>` : '';
    const priBadge = item.priority === 'hoog' ? '<span class="bl-pri bl-pri-hoog">↑</span>'
        : item.priority === 'laag' ? '<span class="bl-pri bl-pri-laag">↓</span>' : '';
    el.innerHTML = `
        ${icon ? `<span class="plan-bl-sym">${icon}</span>` : ''}
        <div class="plan-bl-info"><div class="plan-bl-title">${escHtml(item.title)}</div></div>
        ${priBadge}
        ${isMainExamen ? '<span class="exam-toggle">▼</span>' : ''}
        ${count}
        ${!isMainExamen ? `<span class="plan-bl-dot" style="background:${item.color || '#607d8b'}"></span>` : ''}
    `;
    return el;
}

function setupEventListeners() {
    document.addEventListener('click', () => {
        document.querySelectorAll('.evt-dropdown-portal').forEach(d => d.remove());
    });

    // ── Google Calendar-style drag-to-create ──
    els.calRoot.addEventListener('mousedown', (e) => {
        const dayCol = e.target.closest('.day-col');
        if (!dayCol) return;
        if (e.target.closest('.event') || e.target.closest('.evt-resize-handle') || e.target.closest('.evt-menu-btn')) return;
        if (dragData) return;
        e.preventDefault();

        const date = new Date(dayCol.dataset.date);
        const rect = dayCol.getBoundingClientRect();
        const relY = e.clientY - rect.top;
        const startTime = yToTime(relY);
        const endTime = addMinutes(startTime, 60);

        const selEl = document.createElement('div');
        selEl.className = 'cal-selection';
        dayCol.appendChild(selEl);
        const times = updateSelEl(selEl, startTime, endTime);

        createState = { active: true, date, startTime: times.start, endTime: times.end, selEl, dayCol };
    });

    document.addEventListener('mousemove', (e) => {
        if (!createState || !createState.active) return;
        const rect = createState.dayCol.getBoundingClientRect();
        const relY = e.clientY - rect.top;
        const endTime = yToTime(relY);
        const times = updateSelEl(createState.selEl, createState.startTime, endTime);
        createState.endTime = times.end;
    });

    document.addEventListener('mouseup', (e) => {
        if (!createState || !createState.active) return;
        e.preventDefault();
        const { date, startTime, endTime, selEl } = createState;
        createState.active = false;
        createState = null;
        openNewPlanModal(date, startTime, endTime, selEl);
    });

    // ── Touch drag-drop voor backlog → kalender en event verplaatsen ──
    document.addEventListener('touchmove', (e) => {
        if (!touchDragPlan) return;
        const touch = e.touches[0];
        const dx = touch.clientX - touchDragPlan.startX;
        const dy = touch.clientY - touchDragPlan.startY;

        if (!touchDragPlan.moved && Math.hypot(dx, dy) < 10) return;

        if (!touchDragPlan.moved) {
            touchDragPlan.moved = true;
            const src = touchDragPlan.el;
            const ghost = src.cloneNode(true);
            const w = Math.min(src.offsetWidth, 200);
            ghost.style.cssText = `position:fixed;opacity:0.8;pointer-events:none;z-index:9999;width:${w}px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.5);transform:rotate(2deg);transition:none;font-size:0.8rem;padding:6px 10px;background:#1e293b;color:#e2e8f0;border:1px solid rgba(255,255,255,0.15);overflow:hidden;`;
            document.body.appendChild(ghost);
            touchDragPlan.ghost = ghost;
            src.style.opacity = '0.4';
            if (touchDragPlan.kind === 'backlog') document.body.classList.add('is-dragging-backlog');
        }

        e.preventDefault();

        const ghost = touchDragPlan.ghost;
        ghost.style.left = `${touch.clientX - ghost.offsetWidth / 2}px`;
        ghost.style.top  = `${touch.clientY - 20}px`;

        // Dag-kolom onder de vinger oplichten
        ghost.style.visibility = 'hidden';
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        ghost.style.visibility = '';

        const newDayCol = target?.closest('.day-col');
        if (newDayCol !== touchDragPlan.activeCol) {
            if (touchDragPlan.activeCol) removeDropIndicator(touchDragPlan.activeCol);
            touchDragPlan.activeCol = newDayCol || null;
        }
        if (newDayCol) {
            showDropIndicator(newDayCol, yToTime(touch.clientY - newDayCol.getBoundingClientRect().top));
        }
    }, { passive: false });

    document.addEventListener('touchend', async (e) => {
        if (!touchDragPlan) return;

        const { kind, id, item, el, ghost, activeCol, moved } = touchDragPlan;
        touchDragPlan = null;

        el.style.opacity = '1';
        ghost?.remove();
        document.body.classList.remove('is-dragging-backlog');
        if (activeCol) removeDropIndicator(activeCol);

        if (!moved || !activeCol) return;

        const touch = e.changedTouches[0];
        const t = yToTime(touch.clientY - activeCol.getBoundingClientRect().top);
        const newStart = new Date(activeCol.dataset.date);
        newStart.setHours(t.h, t.m, 0, 0);

        if (kind === 'backlog' && item) {
            await addPlan({
                itemId: item.id, title: item.title, type: item.type,
                subjectId: item.subjectId, subjectName: item.subjectName,
                color: item.color, symbol: sym(item.type),
                start: newStart, durationHours: item.durationHours || 1, uid: SHARED_ID
            });
        } else if (kind === 'move') {
            await updatePlan(id, { start: newStart });
        }
    });

    document.addEventListener('touchcancel', () => {
        if (!touchDragPlan) return;
        touchDragPlan.el.style.opacity = '1';
        touchDragPlan.ghost?.remove();
        document.body.classList.remove('is-dragging-backlog');
        if (touchDragPlan.activeCol) removeDropIndicator(touchDragPlan.activeCol);
        touchDragPlan = null;
    });

    // ── Touch tap op lege kalenderruimte → nieuw plan modal ──
    els.calRoot.addEventListener('touchend', (e) => {
        if (touchDragPlan) return; // al afgehandeld hierboven
        const touch = e.changedTouches[0];
        const dayCol = e.target.closest('.day-col');
        if (!dayCol) return;
        if (e.target.closest('.event') || e.target.closest('.evt-menu-btn')) return;
        const rect = dayCol.getBoundingClientRect();
        const t = yToTime(touch.clientY - rect.top);
        const date = new Date(dayCol.dataset.date);
        openNewPlanModal(date, t, addMinutes(t, 60), null);
    });

    els.prevBtn.onclick = () => { if(viewMode==='day') dayDate=addDays(dayDate,-1); else weekStart=addDays(weekStart,-7); loadPlans(); };
    els.nextBtn.onclick = () => { if(viewMode==='day') dayDate=addDays(dayDate,1); else weekStart=addDays(weekStart,7); loadPlans(); };
    els.todayBtn.onclick = () => { weekStart = startOfWeek(new Date()); dayDate = new Date(); loadPlans(); };
    
    els.viewWeekBtn.onclick = () => { viewMode='week'; els.viewWeekBtn.classList.add("is-active"); els.viewDayBtn.classList.remove("is-active"); loadPlans(); };
    els.viewDayBtn.onclick = () => { viewMode='day'; els.viewDayBtn.classList.add("is-active"); els.viewWeekBtn.classList.remove("is-active"); loadPlans(); };

    // ===== MODALS OPENEN ZONDER MODAL.JS =====
    els.newBacklogBtn.onclick = () => openNewBacklog();

    // === NIEUW PLAN MODAL ===
    document.querySelectorAll('.plan-tab').forEach(btn => {
        btn.onclick = () => {
            switchPlanTab(btn.dataset.tab);
            if (btn.dataset.tab === 'backlog') populatePlanBacklogList(document.getElementById('plan-bl-search').value);
        };
    });

    document.getElementById('plan-bl-search').oninput = (e) => populatePlanBacklogList(e.target.value);

    document.querySelectorAll('#plan-free-type-ctrl .seg').forEach(btn => {
        btn.onclick = () => {
            planFreeType = btn.dataset.ftype;
            document.querySelectorAll('#plan-free-type-ctrl .seg').forEach(b => b.classList.toggle('is-active', b === btn));
        };
    });

    // Herhaling — select
    const recurTypeSelect = document.getElementById('plan-recur-type');
    if (recurTypeSelect) {
        recurTypeSelect.onchange = () => {
            planRecurType = recurTypeSelect.value;
            const showDays    = planRecurType === 'weekly' || planRecurType === 'biweekly';
            const showCustom  = planRecurType === 'custom';
            const showEnd     = planRecurType !== 'none';
            document.getElementById('plan-recur-days').style.display    = showDays   ? '' : 'none';
            document.getElementById('plan-recur-custom').style.display  = showCustom ? '' : 'none';
            document.getElementById('plan-recur-end-field').style.display = showEnd  ? '' : 'none';
            if (showDays && planRecurDays.length === 0) {
                const autoDay = modalDate ? modalDate.getDay() : new Date().getDay();
                planRecurDays = [autoDay];
                document.querySelectorAll('.day-btn').forEach(b => b.classList.toggle('is-active', Number(b.dataset.day) === autoDay));
            }
        };
    }

    // Dag-knoppen
    document.querySelectorAll('.day-btn').forEach(btn => {
        btn.onclick = () => {
            const day = Number(btn.dataset.day);
            if (planRecurDays.includes(day)) {
                planRecurDays = planRecurDays.filter(d => d !== day);
                btn.classList.remove('is-active');
            } else {
                planRecurDays.push(day);
                btn.classList.add('is-active');
            }
        };
    });

    // Aangepast interval
    const recurIntervalInput = document.getElementById('plan-recur-interval');
    if (recurIntervalInput) recurIntervalInput.oninput = () => { planRecurInterval = Math.max(1, parseInt(recurIntervalInput.value) || 1); };
    const recurUnitSelect = document.getElementById('plan-recur-unit');
    if (recurUnitSelect) recurUnitSelect.onchange = () => { planRecurUnit = recurUnitSelect.value; };

    // Blok bewerken opslaan
    const editPlanSaveBtn = document.getElementById('edit-plan-save');
    if (editPlanSaveBtn) {
        editPlanSaveBtn.onclick = async () => {
            if (!editingPlanId) return;
            const notes    = document.getElementById('edit-plan-notes').value.trim();
            const dateVal  = document.getElementById('edit-plan-date').value;
            const timeVal  = document.getElementById('edit-plan-time').value;
            const selSwatch = document.querySelector('#edit-plan-palette .swatch.is-selected');
            const updates  = { notes: notes || null };
            if (selSwatch) updates.color = selSwatch.dataset.color;
            if (dateVal && timeVal) {
                const [y, mo, d] = dateVal.split('-').map(Number);
                const [hh, mm]   = timeVal.split(':').map(Number);
                updates.start = new Date(y, mo - 1, d, hh, mm, 0, 0);
            }
            try {
                await updatePlan(editingPlanId, updates);
                document.getElementById('modal-edit-plan').classList.remove('is-active');
                editingPlanId = null;
            } catch (err) {
                alert('Fout: ' + err.message);
            }
        };
    }

    const replanSaveBtn = document.getElementById('replan-save');
    if (replanSaveBtn) {
        replanSaveBtn.onclick = async () => {
            if (!replanPlan) return;
            const dateVal = document.getElementById('replan-date').value;
            const timeVal = document.getElementById('replan-time').value;
            if (!dateVal || !timeVal) return;
            const [y, mo, d] = dateVal.split('-').map(Number);
            const [h, m] = timeVal.split(':').map(Number);
            const newStart = new Date(y, mo - 1, d, h, m, 0, 0);
            try {
                if (replanMode === 'duplicate') {
                    const { id, ...planData } = replanPlan;
                    await addPlan({ ...planData, start: newStart });
                } else {
                    await updatePlan(replanPlan.id, { start: newStart });
                    const newWeekStart = startOfWeek(newStart);
                    if (viewMode === 'week' && newWeekStart.getTime() !== weekStart.getTime()) {
                        weekStart = newWeekStart;
                        loadPlans();
                    } else if (viewMode === 'day' && !isSameDay(dayDate, newStart)) {
                        dayDate = newStart;
                        loadPlans();
                    }
                }
                document.getElementById('modal-replan').classList.remove('is-active');
                replanPlan = null;
            } catch (err) { alert('Fout: ' + err.message); }
        };
    }

    document.getElementById('plan-save-btn').onclick = async () => {
        const dateVal  = document.getElementById('plan-start-date').value;
        const startVal = document.getElementById('plan-start-time').value;
        const endVal   = document.getElementById('plan-end-time').value;

        if (!dateVal || !startVal || !endVal) { alert('Vul datum en tijden in.'); return; }

        const [y, mo, d] = dateVal.split('-').map(Number);
        const [sh, sm]   = startVal.split(':').map(Number);
        const [eh, em]   = endVal.split(':').map(Number);
        const newStart   = new Date(y, mo - 1, d, sh, sm, 0, 0);
        const newEnd     = new Date(y, mo - 1, d, eh, em, 0, 0);
        let duration     = (newEnd - newStart) / 3600000;
        if (duration <= 0) duration = 0.25;

        const isFreeTab = document.getElementById('plan-tab-free').style.display !== 'none';

        try {
            if (!isFreeTab) {
                if (!selectedBacklogItemId) { alert('Selecteer een backlog-item.'); return; }
                const item = backlog.find(i => i.id === selectedBacklogItemId);
                if (!item) return;
                await addPlan({
                    itemId: item.id, title: item.title, type: item.type,
                    subjectId: item.subjectId, subjectName: item.subjectName,
                    color: item.color, symbol: item.type === 'examen' ? '🎓' : (item.groupId && item.groupId !== 'standaard' ? examSubSym(item.title) : sym(item.type)),
                    start: newStart, durationHours: duration, uid: SHARED_ID
                });
            } else {
                const title = document.getElementById('plan-free-title').value.trim();
                if (!title) { alert('Geef een titel in.'); return; }
                const typeLabels = { afspraak: 'Afspraak', hobby: 'Hobby', andere: 'Andere' };
                const baseFreePlan = {
                    title, type: planFreeType, subjectName: typeLabels[planFreeType] || planFreeType,
                    color: planFreeColor, symbol: FREE_SYMBOLS[planFreeType] || '📌',
                    durationHours: duration, uid: SHARED_ID
                };
                if (planRecurType !== 'none') {
                    const recurEndVal = document.getElementById('plan-recur-end').value;
                    if (!recurEndVal) { alert('Kies een einddatum voor de herhaling.'); return; }
                    const recurEndDate = new Date(recurEndVal);
                    recurEndDate.setHours(23, 59, 59);
                    const recurGroupId = Date.now().toString();
                    const dates = generateRecurDates(newStart, recurEndDate);
                    if (dates.length === 0) { alert('Geen herhalingen gevonden in de geselecteerde periode.'); return; }
                    await Promise.all(dates.map(dt => addPlan({ ...baseFreePlan, start: dt, recurGroupId })));
                } else {
                    await addPlan({ ...baseFreePlan, start: newStart });
                }
            }

            document.getElementById('modal-new-plan').classList.remove('is-active');
            cleanupCreateGesture();
            selectedBacklogItemId = null;
        } catch (err) {
            alert('Fout bij opslaan: ' + err.message);
        }
    };

    function openNewBacklog() {
        els.formBacklog.removeAttribute("data-edit-id");
        document.querySelector("#modal-backlog h3").textContent = "Nieuw item toevoegen";
        const sel = document.getElementById("bl-subject");
        sel.innerHTML = '<option value="">Kies vak...</option>' + subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
        document.getElementById("bl-type").value = "taak";
        document.getElementById("bl-priority").value = "normaal";
        document.querySelectorAll(".seg[data-type]").forEach(b => b.classList.remove("is-active"));
        document.querySelector('.seg[data-type="taak"]').classList.add("is-active");
        document.querySelectorAll(".seg-pri").forEach(b => b.classList.toggle("is-active", b.dataset.priority === "normaal"));
        const exFields = document.getElementById("examen-fields");
        if (exFields) exFields.style.display = "none";
        els.formBacklog.reset();
        document.getElementById("modal-backlog").classList.add("is-active");
    }

    window.openEditBacklog = function(item) {
        els.formBacklog.dataset.editId = item.id;
        document.querySelector("#modal-backlog h3").textContent = "Item bewerken";

        const sel = document.getElementById("bl-subject");
        sel.innerHTML = '<option value="">Kies vak...</option>' + subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
        sel.value = item.subjectId || "";

        document.getElementById("bl-title").value = item.title || "";

        const dueDate = item.dueDate?.toDate ? item.dueDate.toDate() : (item.dueDate ? new Date(item.dueDate) : null);
        if (dueDate) {
            document.getElementById("bl-due").value = dueDate.toISOString().slice(0, 10);
        }

        const type = item.type || "taak";
        document.getElementById("bl-type").value = type;
        document.querySelectorAll(".seg[data-type]").forEach(b => b.classList.toggle("is-active", b.dataset.type === type));
        const priority = item.priority || "normaal";
        document.getElementById("bl-priority").value = priority;
        document.querySelectorAll(".seg-pri").forEach(b => b.classList.toggle("is-active", b.dataset.priority === priority));
        const exFields = document.getElementById("examen-fields");
        if (exFields) exFields.style.display = "none";

        document.getElementById("modal-backlog").classList.add("is-active");
    };

    document.getElementById('printBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.print-dropdown').forEach(p => p.remove());
        const btn = document.getElementById('printBtn');
        const rect = btn.getBoundingClientRect();
        const dd = document.createElement('div');
        dd.className = 'print-dropdown evt-dropdown-portal';
        dd.innerHTML = `
            <button class="evt-drop-item" id="print-cal-btn">📅 Kalenderweergave</button>
            <button class="evt-drop-item" id="print-list-btn">📋 Lijstweergave</button>
        `;
        dd.style.top  = `${rect.bottom + 4}px`;
        dd.style.left = 'auto';
        dd.style.right = `${window.innerWidth - rect.right}px`;
        document.body.appendChild(dd);

        dd.querySelector('#print-cal-btn').onclick = () => { dd.remove(); window.print(); };
        dd.querySelector('#print-list-btn').onclick = () => { dd.remove(); printListView(); };
        setTimeout(() => document.addEventListener('click', () => dd.remove(), { once: true }), 50);
    });

    function printListView() {
        const daysToShow = viewMode === 'day' ? 1 : 7;
        const startDate  = viewMode === 'day' ? dayDate : weekStart;
        const weekTitle  = els.weekTitle?.textContent || '';
        let body = `<h2 style="font-size:1rem;font-weight:700;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:20px;">${weekTitle}</h2>`;

        for (let i = 0; i < daysToShow; i++) {
            const d = addDays(startDate, i);
            const dayPlans = plans.filter(p => isSameDay(p.start instanceof Date ? p.start : new Date(p.start), d))
                .sort((a, b) => (a.start instanceof Date ? a.start : new Date(a.start)) - (b.start instanceof Date ? b.start : new Date(b.start)));

            const dayStr = d.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
            body += `<div style="margin-bottom:20px;">`;
            body += `<div style="font-size:0.88rem;font-weight:700;text-transform:capitalize;border-bottom:1px solid #ccc;padding-bottom:4px;margin-bottom:6px;">${dayStr}</div>`;

            if (dayPlans.length === 0) {
                body += `<div style="font-size:0.78rem;color:#aaa;padding:2px 4px;">—</div>`;
            } else {
                dayPlans.forEach(p => {
                    const s = p.start instanceof Date ? p.start : new Date(p.start);
                    const e = new Date(s.getTime() + (p.durationHours || 1) * 3600000);
                    const fmt = t => `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
                    const clr = p.color || '#607d8b';
                    const sub  = p.subjectName ? ` <span style="color:#777;font-weight:400;">(${p.subjectName})</span>` : '';
                    const note = p.notes ? `<div style="font-size:0.71rem;color:#888;font-style:italic;margin-top:2px;">${p.notes}</div>` : '';
                    const done = p.done ? 'text-decoration:line-through;color:#bbb;' : '';
                    body += `<div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid #f0f0f0;">
                        <div style="width:3px;background:${clr};border-radius:2px;align-self:stretch;min-height:18px;flex-shrink:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
                        <div style="width:88px;flex-shrink:0;font-size:0.73rem;color:#666;padding-top:1px;">${fmt(s)} – ${fmt(e)}</div>
                        <div style="flex:1;"><div style="font-size:0.82rem;font-weight:500;${done}">${p.symbol || ''} ${p.title}${sub}</div>${note}</div>
                    </div>`;
                });
            }
            body += `</div>`;
        }

        const win = window.open('', '_blank', 'width=720,height=850');
        if (!win) { alert('Pop-up geblokkeerd — sta pop-ups toe voor deze pagina.'); return; }
        win.document.write(`<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8">
            <title>Overzicht – ${weekTitle}</title>
            <style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:28px 32px;color:#000;background:#fff;max-width:720px;}
            @media print{body{padding:0;}}</style>
            </head><body>${body}<script>window.onload=()=>window.print();<\/script></body></html>`);
        win.document.close();
    }

    document.getElementById('notifBtn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        document.querySelectorAll('.notif-panel').forEach(p => p.remove());

        if (!('Notification' in window)) { alert('Je browser ondersteunt geen notificaties.'); return; }
        if (Notification.permission === 'default') await Notification.requestPermission();
        updateBellIcon();

        const btn = document.getElementById('notifBtn');
        const rect = btn.getBoundingClientRect();
        const granted = Notification.permission === 'granted';
        const enabled = localStorage.getItem('planner_notif_enabled') !== 'false';

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const upcoming = backlog.filter(i => !i.done && i.dueDate).map(i => {
            const due = i.dueDate.toDate ? i.dueDate.toDate() : new Date(i.dueDate);
            const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
            return { ...i, diff: Math.round((dueDay - today) / 86400000) };
        }).filter(i => i.diff >= 0 && i.diff <= 7).sort((a, b) => a.diff - b.diff);

        const panel = document.createElement('div');
        panel.className = 'notif-panel';
        panel.innerHTML = `
            <div class="notif-header">
                <span>🔔 Herinneringen</span>
                <label class="notif-toggle-label">
                    <input type="checkbox" id="notif-toggle" ${granted && enabled ? 'checked' : ''} ${!granted ? 'disabled' : ''}>
                    Aan
                </label>
            </div>
            ${!granted ? '<div class="notif-msg">Toestemming geweigerd — sta notificaties toe in je browserinstellingen.</div>' : ''}
            ${upcoming.length === 0
                ? '<div class="notif-empty">Geen deadlines de komende 7 dagen.</div>'
                : upcoming.map(i => `
                    <div class="notif-item">
                        <span class="notif-dot" style="background:${i.color || '#607d8b'}"></span>
                        <div class="notif-info">
                            <div class="notif-title">${i.title}</div>
                            <div class="notif-sub">${i.diff === 0 ? 'Vandaag' : i.diff === 1 ? 'Morgen' : 'Over ' + i.diff + ' dagen'}</div>
                        </div>
                    </div>`).join('')
            }
        `;
        panel.style.top = `${rect.bottom + 6}px`;
        panel.style.right = `${window.innerWidth - rect.right}px`;
        document.body.appendChild(panel);

        document.getElementById('notif-toggle')?.addEventListener('change', (ev) => {
            localStorage.setItem('planner_notif_enabled', ev.target.checked ? 'true' : 'false');
            updateBellIcon();
        });
        setTimeout(() => document.addEventListener('click', () => panel.remove(), { once: true }), 50);
    });

    els.manageSubjectsBtn.onclick = () => {
        document.getElementById("modal-subjects").classList.add("is-active");
    };

    // ===== MODALS SLUITEN ZONDER MODAL.JS =====
    document.querySelectorAll('[data-modal-close]').forEach(btn => {
        btn.onclick = () => {
            const modalId = btn.getAttribute('data-modal-close');
            document.getElementById(modalId).classList.remove('is-active');
            if (modalId === 'modal-new-plan') cleanupCreateGesture();
        };
    });

    els.formBacklog.onsubmit = async (e) => {
        e.preventDefault();
        try {
            const editId = els.formBacklog.dataset.editId;
            const subId = document.getElementById("bl-subject").value;
            const subj = subjects.find(s => s.id === subId);
            if (!subId || !subj) throw new Error("Selecteer eerst een vak.");
            const type = document.getElementById("bl-type").value || "taak";
            const priority = document.getElementById("bl-priority").value || "normaal";
            const baseTitle = document.getElementById("bl-title").value;
            const dueDate = new Date(document.getElementById("bl-due").value);
            if (editId) {
                await updateBacklogItem(editId, {
                    title: baseTitle,
                    subjectId: subId,
                    subjectName: subj.name,
                    color: subj.color,
                    type,
                    priority,
                    dueDate,
                    deleteAt: addDays(dueDate, 14),
                });
            } else {
                const groupId = Date.now().toString();
                const baseItem = {
                    uid: SHARED_ID,
                    subjectId: subId,
                    subjectName: subj.name,
                    color: subj.color,
                    type,
                    priority,
                    durationHours: 1,
                    dueDate,
                    deleteAt: addDays(dueDate, 14),
                    done: false
                };

                if (type === 'examen') {
                    const chapters = document.getElementById("bl-chapters").value.split(',').map(c => c.trim()).filter(c => c);
                    const prefixes = Array.from(document.querySelectorAll('.ex-prefix:checked')).map(cb => cb.value);
                    await addBacklogItem({ ...baseItem, title: `🎓 EXAMEN: ${baseTitle}`, groupId });
                    for (const chapter of chapters) {
                        for (const prefix of prefixes) {
                            await addBacklogItem({ ...baseItem, type: 'taak', title: `${prefix}: ${chapter}`, parentExam: baseTitle, groupId });
                        }
                    }
                } else {
                    await addBacklogItem({ ...baseItem, title: baseTitle });
                }
            }

            document.getElementById("modal-backlog").classList.remove("is-active");
            els.formBacklog.removeAttribute("data-edit-id");
            els.formBacklog.reset();
        } catch (err) { alert("Fout: " + err.message); }
    };
    
    // --- PALET LOGICA ---
    let selectedColor = '#F44336';

    const paletteContainer = document.getElementById("sub-palette");
    const preview = document.getElementById("sub-color-preview");

    if (paletteContainer) {
        paletteContainer.innerHTML = PALETTE.map(c => 
            `<button type="button" class="swatch" style="background-color: ${c};" data-color="${c}"></button>`
        ).join("");

        const swatches = paletteContainer.querySelectorAll(".swatch");
        swatches[0].classList.add("is-selected");
        preview.style.backgroundColor = selectedColor;

        swatches.forEach(swatch => {
            swatch.onclick = () => {
                swatches.forEach(s => s.classList.remove("is-selected"));
                swatch.classList.add("is-selected");
                selectedColor = swatch.getAttribute("data-color");
                preview.style.backgroundColor = selectedColor;
            };
        });
    }

    // --- VAK OPSLAAN KNOP ---
    document.getElementById("sub-save").onclick = async () => {
        const name = document.getElementById("sub-name").value;
        if(name) { 
            try {
                await addSubject({ uid: SHARED_ID, name, color: selectedColor });
                document.getElementById("sub-name").value = "";
            } catch (error) {
                console.error("FOUT BIJ OPSLAAN VAK:", error);
                alert("Database weigert opslaan vak: " + error.message);
            }
        }
    };
    
    document.querySelectorAll(".seg[data-type]").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".seg[data-type]").forEach(b => b.classList.remove("is-active"));
            btn.classList.add("is-active");
            const type = btn.dataset.type;
            document.getElementById("bl-type").value = type;

            const exFields = document.getElementById("examen-fields");
            if (exFields) exFields.style.display = (type === 'examen') ? 'block' : 'none';
        };
    });

    // --- PRIORITEIT KNOPPEN ---
    document.querySelectorAll(".seg-pri").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".seg-pri").forEach(b => b.classList.remove("is-active"));
            btn.classList.add("is-active");
            document.getElementById("bl-priority").value = btn.dataset.priority;
        };
    });

    // --- BACKLOG ZOEKEN ---
    const backlogSearch = document.getElementById('backlog-search');
    if (backlogSearch) {
        backlogSearch.oninput = (e) => { backlogSearchQuery = e.target.value; renderBacklog(); };
    }

    // --- SWIPE NAVIGATIE (MOBIEL) ---
    let touchStartX = 0, touchStartY = 0;
    els.calRoot.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });
    els.calRoot.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 55) {
            if (dx < 0) { if (viewMode === 'day') dayDate = addDays(dayDate, 1); else weekStart = addDays(weekStart, 7); }
            else         { if (viewMode === 'day') dayDate = addDays(dayDate, -1); else weekStart = addDays(weekStart, -7); }
            loadPlans();
        }
    }, { passive: true });

    // --- POMODORO TIMER CONTROLS ---
    const pomoPause = document.getElementById('pomo-pause');
    const pomoStop = document.getElementById('pomo-stop');
    const pomoClose = document.getElementById('pomo-close');

    if (pomoClose) pomoClose.onclick = () => {
        clearInterval(timerInterval);
        timerInterval = null;
        document.getElementById('pomodoro-panel').classList.remove('is-active');
    };
    if (pomoPause) pomoPause.onclick = () => {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
            pomoPause.textContent = '▶ Hervat';
        } else {
            pomoPause.textContent = '⏸ Pauze';
            timerInterval = setInterval(() => {
                timerSeconds--;
                updateTimerDisplay();
                if (timerSeconds <= 0) { clearInterval(timerInterval); timerInterval = null; }
            }, 1000);
        }
    };
    if (pomoStop) pomoStop.onclick = () => {
        clearInterval(timerInterval);
        timerInterval = null;
        timerSeconds = 25 * 60;
        updateTimerDisplay();
        document.getElementById('pomodoro-panel').classList.remove('is-active');
    };
}

function renderSubjectsManager() {
    if (!els.subjectsTable) return;

    els.subjectsTable.innerHTML = subjects.map(s => `
        <tr data-id="${s.id}">
            <td class="sub-td-name">${escHtml(s.name)}</td>
            <td class="sub-td-color"><span class="dot" style="background:${s.color}"></span></td>
            <td class="sub-td-actions">
                <button class="btn-icon sm neutral edit-subject-btn" data-id="${s.id}">✏️</button>
                <button class="btn-icon sm danger del-subject-btn" data-id="${s.id}">🗑</button>
            </td>
        </tr>
    `).join("");

    els.subjectsTable.onclick = (e) => {
        const delBtn = e.target.closest('.del-subject-btn');
        if (delBtn) { confirmDialog("Vak verwijderen?").then(ok => { if(ok) deleteSubject(delBtn.dataset.id); }); return; }

        const editBtn = e.target.closest('.edit-subject-btn');
        if (editBtn) openSubjectEditRow(editBtn.dataset.id);
    };
}

function openSubjectEditRow(id) {
    const subj = subjects.find(s => s.id === id);
    if (!subj) return;
    const tr = els.subjectsTable.querySelector(`tr[data-id="${id}"]`);
    if (!tr) return;

    const swatchHtml = PALETTE.map(c =>
        `<button type="button" class="swatch sub-swatch ${c === subj.color ? 'is-selected' : ''}" style="background:${c}" data-color="${c}"></button>`
    ).join('');

    tr.innerHTML = `
        <td colspan="2" class="sub-edit-cell">
            <input class="sub-edit-name" type="text" value="${escHtml(subj.name)}">
            <div class="sub-edit-palette">${swatchHtml}</div>
        </td>
        <td class="sub-td-actions">
            <button class="btn-icon sm neutral sub-save-btn" data-id="${id}">✓</button>
            <button class="btn-icon sm sub-cancel-btn">✕</button>
        </td>
    `;

    tr.querySelectorAll('.sub-swatch').forEach(sw => {
        sw.onclick = () => {
            tr.querySelectorAll('.sub-swatch').forEach(s => s.classList.remove('is-selected'));
            sw.classList.add('is-selected');
        };
    });

    tr.querySelector('.sub-save-btn').onclick = async () => {
        const name = tr.querySelector('.sub-edit-name').value.trim();
        const color = tr.querySelector('.sub-swatch.is-selected')?.dataset.color || subj.color;
        if (!name) return;
        await updateSubject(id, { name, color });
    };

    tr.querySelector('.sub-cancel-btn').onclick = () => renderSubjectsManager();

    tr.querySelector('.sub-edit-name').focus();
}

// INITIALISATIE
init();