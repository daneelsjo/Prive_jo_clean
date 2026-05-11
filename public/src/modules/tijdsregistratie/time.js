import { getCurrentUser, watchUser, login } from "../../services/auth.js";
import {
    subscribeToSegments, addSegment, updateSegment, deleteSegment
} from "../../services/db.js";
import { showToast } from "../../components/toast.js";

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

function copyDialog(defaultDate) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999';
        const box = document.createElement('div');
        box.style.cssText = 'background:var(--card,#1e293b);border:1px solid var(--border,#334155);border-radius:12px;padding:24px;max-width:320px;width:90%;display:flex;flex-direction:column;gap:16px';
        const input = document.createElement('input');
        input.type = 'date';
        input.value = defaultDate;
        input.style.cssText = 'padding:0.5rem;border:1px solid var(--border,#334155);border-radius:8px;background:var(--card);color:var(--fg);width:100%;box-sizing:border-box';
        const label = document.createElement('p');
        label.textContent = 'Kopieer naar datum';
        label.style.cssText = 'margin:0;font-size:0.95rem;font-weight:600';
        const btns = document.createElement('div');
        btns.style.cssText = 'display:flex;justify-content:flex-end;gap:10px';
        const no = document.createElement('button');
        no.textContent = 'Annuleren';
        no.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid var(--border,#334155);background:transparent;cursor:pointer;color:inherit';
        const yes = document.createElement('button');
        yes.textContent = 'Kopiëren';
        yes.style.cssText = 'padding:6px 14px;border-radius:6px;border:none;background:var(--brand,#3b82f6);color:#fff;cursor:pointer';
        btns.append(no, yes);
        box.append(label, input, btns);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        const cleanup = result => { overlay.remove(); resolve(result); };
        yes.onclick = () => cleanup(input.value || null);
        no.onclick = () => cleanup(null);
        overlay.onclick = e => { if (e.target === overlay) cleanup(null); };
    });
}

// State
let currentUser = null;
let monthSegments = [];
let firstLoad = true;
let filterType = null;
let viewMode = 'month';
let monthPicker = document.getElementById("monthPicker");
const timeTable = document.getElementById("timeTable")?.querySelector("tbody");
let lastMonthStats = { diff: 0, over: 0, verlof: 0, recup: 0, optout: 0 };

// Constanten
const DAILY_EXPECTED_MIN = 7 * 60 + 36; // 7u36
const WIN_START = 7 * 60;   // 07:00
const WIN_END = 18 * 60;    // 18:00

const TYPE_LABELS = {
    standard: 'Standaard', overleg: 'Overleg', sport: 'Sport',
    feestdag: 'Feestdag', verlof: 'Verlof', recup: 'Recup',
    interventie: 'Interventie', oefening: 'Oefening', andere: 'Andere'
};

// --- HELPER FUNCTIES (Datum/Tijd) ---
const pad2 = (n) => String(n).padStart(2, "0");
const fmtDateISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const nowHM = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const hmToMin = (hm) => { if (!hm) return null; const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
const minToHM = (min) => { const sign = min < 0 ? "-" : ""; const v = Math.abs(min); const h = Math.floor(v / 60), m = v % 60; return `${sign}${pad2(h)}:${pad2(m)}`; };
const minToDecimalComma = (min, digits = 1) => (Math.abs(min) / 60).toFixed(digits).replace(".", ",");
const weekdayShort = (d) => new Intl.DateTimeFormat("nl-BE", { weekday: "short" }).format(d).replace(".", "");

function isoWeek(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = (date.getUTCDay() || 7);
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

// --- BEREKENINGEN ---
function computeMinutes(entry) {
    let s = hmToMin(entry?.start), e = hmToMin(entry?.end);
    // Feestdagen auto-fill logic
    if (entry?.type === "feestdag" && (!s || !e)) { s = hmToMin("08:00"); e = hmToMin("15:36"); }
    if (s == null || e == null) return 0;
    
    let total = e - s;
    const bs = hmToMin(entry?.beginbreak), be = hmToMin(entry?.endbreak);
    if (bs != null && be != null) total -= Math.max(0, be - bs);
    return Math.max(0, total);
}

function computeTimeSplit(entry) {
    // Splitsen: binnen werkvenster (7-18) vs erbuiten
    const s = hmToMin(entry?.start), e = hmToMin(entry?.end);
    if (s == null || e == null || e <= s) return { inside: 0, outside: 0 };
    
    // Houd rekening met eventuele pauzes
    let intervals = [[s, e]];
    const bs = hmToMin(entry?.beginbreak), be = hmToMin(entry?.endbreak);
    if (bs != null && be != null && s <= bs && bs < be && be <= e) {
        intervals = [[s, bs], [be, e]];
    }

    const overlapMinutes = ([a, b], wStart, wEnd) => {
        const lo = Math.max(a, wStart), hi = Math.min(b, wEnd);
        return Math.max(0, hi - lo);
    };

    const total = intervals.reduce((sum, iv) => sum + (iv[1] - iv[0]), 0);
    // HIER ZAT DE FOUT: 'iv' werd niet meegegeven aan overlapMinutes
    const inside = intervals.reduce((sum, iv) => sum + overlapMinutes(iv, WIN_START, WIN_END), 0);
    const outside = Math.max(0, total - inside);
    
    return { inside, outside };
}


function computeInterventionSplit(entry) {
    // Interventie splitsen: binnen werkvenster vs erbuiten (opt-out)
    const s = hmToMin(entry?.start), e = hmToMin(entry?.end);
    if (s == null || e == null || e <= s) return { inside: 0, optout: 0 };
    
    // Check pauzes
    let intervals = [[s, e]];
    const bs = hmToMin(entry?.beginbreak), be = hmToMin(entry?.endbreak);
    if (bs != null && be != null && s <= bs && bs < be && be <= e) {
        intervals = [[s, bs], [be, e]];
    }

    const overlapMinutes = ([a, b], wStart, wEnd) => {
        const lo = Math.max(a, wStart), hi = Math.min(b, wEnd);
        return Math.max(0, hi - lo);
    };

    const total = intervals.reduce((sum, iv) => sum + (iv[1] - iv[0]), 0);
    const inside = intervals.reduce((sum, iv) => sum + overlapMinutes(iv, WIN_START, WIN_END), 0);
    const optout = Math.max(0, total - inside);
    return { inside, optout };
}

// --- INIT ---
async function init() {
    watchUser((user) => {
        if (!user) { window.location.href = "../../../index.html"; return; }
        currentUser = user;
        document.getElementById("app").style.display = "block";
        
        // Start Data Stream
        subscribeToSegments(currentUser.uid, (data) => {
            monthSegments = data;
            renderTable();
            if (firstLoad) { firstLoad = false; checkPreviousDayMissing(); }
        });

        setupUI();
    });
}

function setupUI() {
    // Datum picker
    const d = new Date();
    if (monthPicker) {
        monthPicker.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
        monthPicker.onchange = renderTable;
    }
    
    // PDF Export
    document.getElementById("btnExportPdf")?.addEventListener("click", exportMonthPdf);

    // Quick Actions
    document.querySelectorAll(".qa[data-type]").forEach(btn => {
        btn.addEventListener("click", () => openTimeModal({ type: btn.getAttribute("data-type") }));
    });

    // Modal Knoppen
    document.getElementById("tr-save")?.addEventListener("click", saveSegmentFromModal);
    document.getElementById("tr-delete")?.addEventListener("click", deleteSegmentFromModal);

    // Type change effect in modal
    document.getElementById("tr-type")?.addEventListener("change", applyTypeEffects);

    // Real-time duurberekening in modal
    ['tr-start', 'tr-end', 'tr-beginbreak', 'tr-endbreak'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateModalPreview);
    });

    // Jaaroverzicht toggle
    document.getElementById('btnYearView')?.addEventListener('click', () => {
        viewMode = viewMode === 'year' ? 'month' : 'year';
        const yearEl = document.getElementById('yearView');
        const monthEl = document.getElementById('monthView');
        const btn = document.getElementById('btnYearView');
        const isYear = viewMode === 'year';
        if (yearEl) yearEl.hidden = !isYear;
        if (monthEl) monthEl.hidden = isYear;
        btn.classList.toggle('active', isYear);
        if (isYear) renderYearView();
    });
}

// --- MODAL LIVE PREVIEW ---
function updateModalPreview() {
    const preview = document.getElementById('tr-duration-preview');
    if (!preview) return;
    const start = document.getElementById('tr-start').value;
    const end   = document.getElementById('tr-end').value;
    const bb    = document.getElementById('tr-beginbreak').value;
    const be    = document.getElementById('tr-endbreak').value;
    if (!start || !end) { preview.hidden = true; return; }
    const mins = computeMinutes({ start, end, beginbreak: bb || null, endbreak: be || null });
    if (mins <= 0) { preview.hidden = true; return; }
    const diff    = mins - DAILY_EXPECTED_MIN;
    const diffStr = diff >= 0
        ? `<span class="pos">+${minToHM(Math.abs(diff))}</span>`
        : `<span class="neg">-${minToHM(Math.abs(diff))}</span>`;
    preview.hidden = false;
    preview.innerHTML = `⏱ <strong>${minToHM(mins)}</strong>&nbsp;&nbsp;(${diffStr} t.o.v. ${minToHM(DAILY_EXPECTED_MIN)})`;
}

// --- VORIGE WERKDAG CONTROLE ---
function getPreviousWorkday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
    return fmtDateISO(d);
}

function checkPreviousDayMissing() {
    const prevISO = getPreviousWorkday();
    const suppressKey = `time_prevday_suppress_${currentUser.uid}_${prevISO}`;
    if (localStorage.getItem(suppressKey)) return;

    const hasEntry = monthSegments.some(s =>
        s.uid === currentUser.uid &&
        s.date === prevISO &&
        ['standard', 'verlof', 'recup', 'feestdag', 'interventie'].includes(s.type)
    );
    if (hasEntry) return;

    // Open modal direct — de globale nav-banner heeft de gebruiker al hierheen gestuurd
    openTimeModal({ date: prevISO });
}

// --- RENDERING (Tabel & Chips) ---
function renderTable() {
    if (!timeTable || !monthPicker.value) return;
    const [Y, M] = monthPicker.value.split("-").map(Number);

    // Onthoud welke weken ingeklapt zijn voor na de herrender
    const collapsedWeeks = new Set(
        [...timeTable.querySelectorAll('tr[data-week].week-collapsed')].map(r => r.dataset.week)
    );

    timeTable.innerHTML = "";
    
    // Filter & Sorteer Data
    const byDate = new Map();
    monthSegments.forEach(s => {
        if(!s.date) return;
        const d = new Date(s.date);
        if(d.getFullYear() === Y && (d.getMonth() + 1) === M) {
            if(!byDate.has(s.date)) byDate.set(s.date, []);
            byDate.get(s.date).push(s);
        }
    });

    // Variabelen voor totalen
    let runningWeek = null, weekSum = 0, weekWorkdays = 0, weekOptOut = 0;
    let monthDiffTotal = 0, overOtherTotal = 0, verlofTotal = 0, recupTotal = 0, optOutExcessTotal = 0;

    // Loop alle dagen van de maand
    const lastDay = new Date(Y, M, 0).getDate();
    for (let day = 1; day <= lastDay; day++) {
        const d = new Date(Y, M - 1, day);
        const dateISO = fmtDateISO(d);
        const segs = (byDate.get(dateISO) || []).sort((a,b) => (hmToMin(a.start)||0) - (hmToMin(b.start)||0));
        
        const dow = d.getDay(); 
        const isWorkday = (dow >= 1 && dow <= 5);
        const w = isoWeek(d);

        // Weekwissel? Totalen schrijven
        if (runningWeek !== null && w !== runningWeek) {
            renderWeekRow(runningWeek, weekSum, weekWorkdays, weekOptOut);
            // Update maand totalen
            const expected = weekWorkdays * DAILY_EXPECTED_MIN;
            monthDiffTotal += (weekSum - expected);
            optOutExcessTotal += Math.max(0, weekOptOut - (10 * 60));
            // Reset week
            weekSum = 0; weekWorkdays = 0; weekOptOut = 0;
        }
        runningWeek = w;

        // Dagtotaal berekenen
// Dagtotaal berekenen
        let dayMinutes = 0;
        segs.forEach(s => {
            const t = (s.type || "").toLowerCase();
            const mins = computeMinutes(s);
            const { inside, outside } = computeTimeSplit(s);
            
            if (t === "verlof") { verlofTotal += mins; dayMinutes += mins; }
            else if (t === "recup") { recupTotal += mins; dayMinutes += mins; }
            else if (t === "feestdag") { dayMinutes += mins; }
            else if (t === "sport") { /* doet niets voor werktijd */ }
            else if (["overleg", "oefening", "andere"].includes(t)) {
                dayMinutes += inside;       // Binnen 7-18 = glijtijd
                overOtherTotal += outside;  // Buiten 7-18 = overuren
            } else {
                // standaard, interventie
                dayMinutes += inside;       // Binnen 7-18 = glijtijd
                weekOptOut += outside;      // Buiten 7-18 = opt-out
            }
        });
        
        weekSum += dayMinutes;
        if(isWorkday) weekWorkdays++;

        // Render Dag Header
        renderDayHeader(d, dayMinutes, dateISO, w);

        // Render Segmenten
        segs.forEach(seg => renderSegmentRow(seg, dateISO, w));
    }
    
    // Laatste week afsluiten
    if(runningWeek !== null) {
        renderWeekRow(runningWeek, weekSum, weekWorkdays, weekOptOut);
        const expected = weekWorkdays * DAILY_EXPECTED_MIN;
        monthDiffTotal += (weekSum - expected);
        optOutExcessTotal += Math.max(0, weekOptOut - (10 * 60));
    }

    // Herstel ingeklapte weken
    if (collapsedWeeks.size > 0) {
        collapsedWeeks.forEach(weekNo => {
            timeTable.querySelectorAll(`tr[data-week="${weekNo}"]`).forEach(r => r.classList.add('week-collapsed'));
            const header = timeTable.querySelector(`tr[data-week-header="${weekNo}"]`);
            if (header) header.querySelector('.week-chevron').textContent = '▶';
        });
    }

    // Update Chips bovenaan
    updateMonthMeta(monthDiffTotal, overOtherTotal, verlofTotal, recupTotal, optOutExcessTotal);
}

function renderDayHeader(date, minutes, dateISO, weekNo) {
    const tr = document.createElement("tr");
    const dow = date.getDay();
    const isToday   = dateISO === fmtDateISO(new Date());
    const isWeekend = dow === 0 || dow === 6;
    tr.className = `date-header${isToday ? ' date-today' : ''}${isWeekend ? ' date-weekend' : ''}`;
    tr.dataset.week = weekNo;
    tr.innerHTML = `
        <td colspan="7">
            <div class="datebar">
                <div class="left">${weekdayShort(date)} ${date.getDate()}${isToday ? ' <span class="today-dot">●</span>' : ''}</div>
                <div class="right">
                    <span class="muted">${minutes ? minToHM(minutes) : ""}</span>
                    <button class="icon-xs toggle" data-date="${dateISO}">▼</button>
                    <button class="icon-xs add" data-date="${dateISO}">+</button>
                </div>
            </div>
        </td>`;
    
    // Events
    const toggle = tr.querySelector(".toggle");
    toggle.onclick = () => {
        const rows = timeTable.querySelectorAll(`.seg-row[data-date="${dateISO}"]`);
        const isHidden = rows[0]?.style.display === "none";
        rows.forEach(r => r.style.display = isHidden ? "" : "none");
        toggle.textContent = isHidden ? "▼" : "▶";
    };
    
    tr.querySelector(".add").onclick = () => openTimeModal({ date: dateISO });
    timeTable.appendChild(tr);
}

function renderSegmentRow(seg, dateISO, weekNo) {
    const tr = document.createElement("tr");
    tr.className = `seg-row type-${seg.type}`;
    tr.dataset.date = dateISO;
    tr.dataset.week = weekNo;
    tr.innerHTML = `
        <td class="seg-copy-cell"><button class="seg-copy-btn" title="Kopieer naar andere datum">⧉</button></td>
        <td>${seg.start || ""}</td>
        <td>${seg.beginbreak || ""}</td>
        <td>${seg.endbreak || ""}</td>
        <td>${seg.end || ""}</td>
        <td>${minToHM(computeMinutes(seg))}</td>
        <td><span class="badge badge-${seg.type}">${TYPE_LABELS[seg.type] || seg.type}</span> ${escapeHtml(seg.remark)}</td>
    `;
    tr.querySelector('.seg-copy-btn').onclick = async (e) => {
        e.stopPropagation();
        const targetDate = await copyDialog(fmtDateISO(new Date()));
        if (!targetDate) return;
        try {
            await addSegment({
                uid: currentUser.uid,
                date: targetDate,
                type: seg.type,
                start: seg.start || null,
                beginbreak: seg.beginbreak || null,
                endbreak: seg.endbreak || null,
                end: seg.end || null,
                remark: seg.remark || null,
                minutes: seg.minutes || 0,
                createdAt: Date.now()
            });
            showToast("Registratie gekopieerd", "success");
        } catch (err) {
            showToast("Kopiëren mislukt", "error");
        }
    };
    tr.onclick = () => openTimeModal({ id: seg.id });
    timeTable.appendChild(tr);
}

function renderWeekRow(weekNo, worked, days, optOut) {
    const expected = days * DAILY_EXPECTED_MIN;
    const diff = worked - expected;
    const cls = diff >= 0 ? "diff pos" : "diff neg";

    const tr = document.createElement("tr");
    tr.className = "week-total";
    tr.dataset.weekHeader = weekNo;
    tr.innerHTML = `
        <td colspan="7">
            <div class="week-bar">
                <span class="week-chevron">▼</span>
                <span>Week ${weekNo}: <strong>${minToHM(worked)}</strong> / ${minToHM(expected)}
                    <span class="${cls}">(${diff >= 0 ? "+" : ""}${minToHM(diff)})</span>
                </span>
                <span class="week-optout">Opt-out: ${minToHM(optOut)}</span>
            </div>
        </td>
    `;
    tr.onclick = () => {
        const rows = timeTable.querySelectorAll(`tr[data-week="${weekNo}"]`);
        const collapsed = rows[0]?.classList.contains('week-collapsed');
        rows.forEach(r => r.classList.toggle('week-collapsed', !collapsed));
        tr.querySelector('.week-chevron').textContent = collapsed ? '▼' : '▶';
    };
    timeTable.appendChild(tr);
}

// --- MAAND STATS BIJHOUDEN ---
function updateMonthMeta(diff, over, verlof, recup, optout) {
    lastMonthStats = { diff, over, verlof, recup, optout };
    document.getElementById("monthMeta")?.remove();
    renderFilterBar();
    renderRightCol();
    if (viewMode === 'year') renderYearView();
}

// --- TYPE FILTER ---
function renderFilterBar() {
    const bar = document.getElementById('filterBar');
    if (!bar || !monthPicker.value) return;
    const [Y, M] = monthPicker.value.split('-').map(Number);

    const typesInMonth = new Set(
        monthSegments
            .filter(s => { const d = new Date(s.date); return d.getFullYear() === Y && (d.getMonth() + 1) === M; })
            .map(s => s.type)
            .filter(Boolean)
    );

    if (typesInMonth.size === 0) { bar.innerHTML = ''; return; }

    bar.innerHTML = '';
    const makeBtn = (label, type) => {
        const btn = document.createElement('button');
        btn.className = `filter-btn${filterType === type ? ' active' : ''}`;
        btn.textContent = label;
        btn.onclick = () => applyFilter(filterType === type ? null : type);
        bar.appendChild(btn);
    };
    makeBtn('Alles', null);
    typesInMonth.forEach(t => makeBtn(TYPE_LABELS[t] || t, t));
}

function applyFilter(type) {
    filterType = type;
    renderFilterBar();

    timeTable.querySelectorAll('.seg-row').forEach(r => {
        r.style.display = (!type || r.classList.contains(`type-${type}`)) ? '' : 'none';
    });
    timeTable.querySelectorAll('.date-header').forEach(header => {
        if (!type) { header.style.display = ''; return; }
        const date = header.querySelector('[data-date]')?.dataset.date;
        const hasMatch = date && [...timeTable.querySelectorAll(`.seg-row[data-date="${date}"]`)]
            .some(r => r.classList.contains(`type-${type}`));
        header.style.display = hasMatch ? '' : 'none';
    });
}

// --- JAAROVERZICHT ---
function computeMonthStats(year, month) {
    const segs = monthSegments.filter(s => {
        if (!s.date) return false;
        const d = new Date(s.date);
        return d.getFullYear() === year && (d.getMonth() + 1) === month;
    });
    const byDate = new Map();
    segs.forEach(s => { if (!byDate.has(s.date)) byDate.set(s.date, []); byDate.get(s.date).push(s); });

    let worked = 0, verlof = 0, recup = 0, overOther = 0;
    let runWeek = null, weekDays = 0, weekOptOut = 0, totalExpected = 0, totalOptout = 0;

    const lastDay = new Date(year, month, 0).getDate();
    for (let day = 1; day <= lastDay; day++) {
        const d = new Date(year, month - 1, day);
        const dow = d.getDay();
        const w = isoWeek(d);
        if (runWeek !== null && w !== runWeek) {
            totalExpected += weekDays * DAILY_EXPECTED_MIN;
            totalOptout += Math.max(0, weekOptOut - 10 * 60);
            weekDays = 0; weekOptOut = 0;
        }
        runWeek = w;
        (byDate.get(fmtDateISO(d)) || []).forEach(s => {
            const t = (s.type || '').toLowerCase();
            const mins = computeMinutes(s);
            const { inside, outside } = computeTimeSplit(s);
            if (t === 'verlof')      { verlof += mins; worked += mins; }
            else if (t === 'recup') { recup += mins; worked += mins; }
            else if (t === 'feestdag') { worked += mins; }
            else if (t === 'sport') { /* niets */ }
            else if (['overleg', 'oefening', 'andere'].includes(t)) { worked += inside; overOther += outside; }
            else { worked += inside; weekOptOut += outside; }
        });
        if (dow >= 1 && dow <= 5) weekDays++;
    }
    if (runWeek !== null) {
        totalExpected += weekDays * DAILY_EXPECTED_MIN;
        totalOptout += Math.max(0, weekOptOut - 10 * 60);
    }
    return { worked, expected: totalExpected, diff: worked - totalExpected, verlof, recup, optout: totalOptout };
}

function renderYearView() {
    const el = document.getElementById('yearView');
    if (!el) return;
    const year = monthPicker.value ? Number(monthPicker.value.split('-')[0]) : new Date().getFullYear();
    const nowMonth = new Date().getFullYear() === year ? new Date().getMonth() + 1 : 12;

    const monthNames = Array.from({ length: 12 }, (_, i) =>
        new Date(year, i, 1).toLocaleDateString('nl-BE', { month: 'long' })
    );

    let totalDiff = 0;
    const rows = monthNames.map((name, i) => {
        const m = i + 1;
        const isFuture = m > nowMonth;
        const isCurrent = m === nowMonth;
        const s = computeMonthStats(year, m);
        if (!isFuture) totalDiff += s.diff;
        const diffStr = isFuture ? '—'
            : `<span class="${s.diff >= 0 ? 'pos' : 'neg'}">${s.diff >= 0 ? '+' : ''}${minToHM(s.diff)}</span>`;
        return `<tr class="${isCurrent ? 'year-current' : ''}${isFuture ? ' year-future' : ''}">
            <td><strong>${name}</strong></td>
            <td>${isFuture ? '—' : minToHM(s.worked)}</td>
            <td>${isFuture ? '—' : minToHM(s.expected)}</td>
            <td>${diffStr}</td>
            <td>${s.verlof > 0 ? minToHM(s.verlof) : '—'}</td>
            <td>${s.recup > 0 ? minToHM(s.recup) : '—'}</td>
            <td>${s.optout > 0 ? minToHM(s.optout) : '—'}</td>
        </tr>`;
    }).join('');

    el.innerHTML = `
        <div class="year-header">
            <span>📊 Jaaroverzicht ${year}</span>
            <span class="year-total ${totalDiff >= 0 ? 'pos' : 'neg'}">Totaal glijtijd: ${totalDiff >= 0 ? '+' : ''}${minToHM(totalDiff)}</span>
        </div>
        <div class="table-wrap">
        <table class="time-table year-table">
            <thead><tr>
                <th>Maand</th><th>Gewerkt</th><th>Verwacht</th><th>Glijtijd</th><th>Verlof</th><th>Recup</th><th>Opt-out</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
        </div>
    `;
}

// --- RECHTERKOLOM ---
function renderRightCol() {
    const rc = document.querySelector('.rightcol');
    if (!rc || !currentUser) return;
    const { diff, over, verlof, recup, optout } = lastMonthStats;

    rc.innerHTML = `
        <div class="rc-card">
            <div class="rc-title">📊 Maand samenvatting</div>
            <div class="rc-month-rows">
                <div class="rc-month-row">
                    <span>Glijtijd saldo</span>
                    <strong class="${diff >= 0 ? 'pos' : 'neg'}">${diff >= 0 ? '+' : ''}${minToHM(diff)}</strong>
                </div>
                ${over   > 0 ? `<div class="rc-month-row"><span>Overuren/Oef/Andere</span><strong>${minToHM(over)}</strong></div>`   : ''}
                ${verlof > 0 ? `<div class="rc-month-row"><span>Verlof</span><strong>${minToHM(verlof)}</strong></div>` : ''}
                ${recup  > 0 ? `<div class="rc-month-row"><span>Recup</span><strong>${minToHM(recup)}</strong></div>`  : ''}
                ${optout > 0 ? `<div class="rc-month-row"><span>Opt-out teveel</span><strong class="neg">${minToHM(optout)}</strong></div>` : ''}
            </div>
        </div>
    `;
}

// --- MODAL ---
function openTimeModal(opts = {}) {
    let seg = null;
    if (opts.id) seg = monthSegments.find(s => s.id === opts.id);

    const get = id => document.getElementById(id);
    get("tr-date").value = seg?.date || opts.date || fmtDateISO(new Date());
    get("tr-type").value = seg?.type || opts.type || "standard";
    get("tr-start").value = seg?.start || "";
    get("tr-beginbreak").value = seg?.beginbreak || "";
    get("tr-endbreak").value = seg?.endbreak || "";
    get("tr-end").value = seg?.end || "";
    get("tr-remark").value = seg?.remark || "";
    
    // Knoppen ID
    const save = get("tr-save");
    const del = get("tr-delete");
    save.dataset.id = seg?.id || "";
    del.dataset.id = seg?.id || "";
    del.style.display = seg ? "inline-flex" : "none";

    applyTypeEffects();
    updateModalPreview();
    if(window.Modal) window.Modal.open("modal-time");
}

function applyTypeEffects() {
    const type = document.getElementById("tr-type").value;
    const isStd = (type === "standard");
    const bb = document.getElementById("tr-beginbreak").closest("label");
    const be = document.getElementById("tr-endbreak").closest("label");
    if(bb) bb.style.display = isStd ? "" : "none";
    if(be) be.style.display = isStd ? "" : "none";

    // Auto-fill tijden bij feestdag
    if (type === "feestdag") {
        const start = document.getElementById("tr-start");
        const end   = document.getElementById("tr-end");
        if (!start.value) start.value = "08:00";
        if (!end.value)   end.value   = "15:36";
        updateModalPreview();
    }
}

async function saveSegmentFromModal() {
    const get = id => document.getElementById(id);
    const id = get("tr-save").dataset.id;
    
    const payload = {
        uid: currentUser.uid,
        date: get("tr-date").value,
        type: get("tr-type").value,
        start: get("tr-start").value || null,
        beginbreak: get("tr-beginbreak").value || null,
        endbreak: get("tr-endbreak").value || null,
        end: get("tr-end").value || null,
        remark: get("tr-remark").value.trim() || null,
        updatedAt: Date.now()
    };
    
    // Auto-fill feestdag (fallback als modal tijden nog leeg zijn)
    if(payload.type === "feestdag" && !payload.start) {
        payload.start = "08:00"; payload.end = "15:36";
    }
    payload.minutes = computeMinutes(payload);

    try {
        if(id) {
            await updateSegment(id, payload);
            showToast("Registratie bijgewerkt", "success");
        } else {
            payload.createdAt = Date.now();
            await addSegment(payload);
            showToast("Nieuwe registratie toegevoegd", "success");
        }
        window.Modal.close();
    } catch(e) {
        console.error(e);
        showToast("Opslaan mislukt", "error");
    }
}

async function deleteSegmentFromModal() {
    const id = document.getElementById("tr-delete").dataset.id;
    if(id && await confirmDialog("Registratie verwijderen?")) {
        try {
            await deleteSegment(id);
            showToast("Registratie verwijderd", "success");
            window.Modal.close();
        } catch(e) {
            showToast("Verwijderen mislukt", "error");
        }
    }
}

// --- PDF EXPORT ---
async function exportMonthPdf() {
    // 1. Check of bibliotheken geladen zijn
    const JSPDF = window.jspdf?.jsPDF;
    if (!JSPDF) return showToast("Fout: PDF bibliotheek niet geladen.", "error");
    if (typeof window.jspdf?.jsPDF?.API?.autoTable !== "function") return showToast("Fout: AutoTable plugin niet geladen.", "error");

    showToast("PDF wordt gegenereerd...", "info");

    const doc = new JSPDF({ unit: "pt", format: "a4", compress: true });

    // 2. Huidige maand ophalen
    if (!monthPicker.value) return showToast("Selecteer eerst een maand.", "error");
    const [Y, M] = monthPicker.value.split("-").map(Number);

    // 3. Data voorbereiden
    const last = new Date(Y, M, 0);
    const byDate = new Map();
    
    // Filter segmenten voor deze maand
    monthSegments.forEach(s => {
        if (!s.date) return;
        const dt = new Date(s.date);
        if (dt.getFullYear() === Y && (dt.getMonth() + 1) === M) {
            if (!byDate.has(s.date)) byDate.set(s.date, []);
            byDate.get(s.date).push(s);
        }
    });

    // 4. Totalen berekenen (voor header tekst)
    let monthDiffTotal = 0;
    let overOtherTotal = 0;
    let verlofTotal = 0;
    let recupTotal = 0;
    let optOutExcessTotal = 0;

    let tempWeekSum = 0;
    let tempWeekDays = 0;
    let tempWeekOptOut = 0;
    let currentWeek = null;

    for (let day = 1; day <= last.getDate(); day++) {
        const d = new Date(Y, M - 1, day);
        const dateISO = fmtDateISO(d);
        const segs = (byDate.get(dateISO) || []);
        const w = isoWeek(d);
        const dow = d.getDay();
        const isWorkday = (dow >= 1 && dow <= 5);

        // Week wissel
        if (currentWeek !== null && w !== currentWeek) {
            const exp = tempWeekDays * DAILY_EXPECTED_MIN;
            monthDiffTotal += (tempWeekSum - exp);
            optOutExcessTotal += Math.max(0, tempWeekOptOut - (10 * 60));
            tempWeekSum = 0; tempWeekDays = 0; tempWeekOptOut = 0;
        }
        currentWeek = w;

        // Dagtotaal LOOP 1
        let dayMinutes = 0;
        segs.forEach(s => {
            const t = (s.type || "").toLowerCase();
            const mins = computeMinutes(s);
            const { inside, outside } = computeTimeSplit(s);

            if (t === "verlof") { verlofTotal += mins; dayMinutes += mins; }
            else if (t === "recup") { recupTotal += mins; dayMinutes += mins; }
            else if (t === "feestdag") { dayMinutes += mins; }
            else if (t === "sport") { /* niets */ }
            else if (["overleg", "oefening", "andere"].includes(t)) {
                dayMinutes += inside;
                overOtherTotal += outside;
            } else {
                // standaard, interventie
                dayMinutes += inside;
                tempWeekOptOut += outside; 
            }
        });
        if(isWorkday) tempWeekDays++;
        tempWeekSum += dayMinutes;
    }
    // Laatste week
    if(currentWeek !== null) {
        const exp = tempWeekDays * DAILY_EXPECTED_MIN;
        monthDiffTotal += (tempWeekSum - exp);
        optOutExcessTotal += Math.max(0, tempWeekOptOut - (10 * 60));
    }

    // 5. Tabel Opbouwen
    const head = [["Datum", "Type", "Start", "Pauze start", "Pauze eind", "Eind", "Min", "Opmerking"]];
    const body = [];
    const dayFmt = new Intl.DateTimeFormat("nl-BE", { weekday: "short" });
    
    // Reset loop vars voor de tabel vulling
    tempWeekSum = 0; tempWeekDays = 0; tempWeekOptOut = 0; currentWeek = null;

    for (let day = 1; day <= last.getDate(); day++) {
        const d = new Date(Y, M - 1, day);
        const dateISO = fmtDateISO(d);
        const segs = (byDate.get(dateISO) || []).sort((a,b) => (hmToMin(a.start)||0) - (hmToMin(b.start)||0));
        
        const w = isoWeek(d);
        const dow = d.getDay();
        const isWorkday = (dow >= 1 && dow <= 5);

        // Weekrij toevoegen
        if (currentWeek !== null && w !== currentWeek) {
            const exp = tempWeekDays * DAILY_EXPECTED_MIN;
            const diff = tempWeekSum - exp;
            body.push([{
                content: `Week ${currentWeek} totaal: ${minToHM(tempWeekSum)} / ${minToHM(exp)}  (${diff>=0?"+":""}${minToHM(diff)})  |  opt-out: ${minToHM(tempWeekOptOut)}`,
                colSpan: 8,
                styles: { halign: "center", fillColor: [240, 248, 255], fontStyle: "bold" }
            }]);
            tempWeekSum = 0; tempWeekDays = 0; tempWeekOptOut = 0;
        }
        currentWeek = w;

        // Dagtotaal LOOP 2 (Voor in de tabel Header)
        let dayMinutes = 0;
        segs.forEach(s => {
            const t = (s.type || "").toLowerCase();
            const mins = computeMinutes(s);
            const { inside, outside } = computeTimeSplit(s);

            if (t === "verlof" || t === "recup" || t === "feestdag") {
                dayMinutes += mins;
            } else if (t === "sport") {
                // niets
            } else if (["overleg", "oefening", "andere"].includes(t)) {
                dayMinutes += inside;
            } else {
                // standaard, interventie
                dayMinutes += inside;
                tempWeekOptOut += outside; 
            }
        });
        if(isWorkday) tempWeekDays++;
        tempWeekSum += dayMinutes;

        // Als er segmenten zijn, voeg toe
        if (segs.length > 0) {
            // Dag Header Rij
            body.push([{
                content: `${dayFmt.format(d)} ${day} — ${dayMinutes ? minToHM(dayMinutes) : "00:00"}`,
                colSpan: 8,
                styles: { fillColor: [245, 245, 245], fontStyle: "bold" }
            }]);

            // Segment Rij
            segs.forEach(seg => {
                const mins = computeMinutes(seg);
                body.push([
                    "", // Datum kolom leeg laten
                    (seg.type || "standard"),
                    seg.start || "",
                    seg.beginbreak || "",
                    seg.endbreak || "",
                    seg.end || "",
                    mins ? minToHM(mins) : "",
                    seg.remark || ""
                ]);
            });
        }
    }
    // Laatste weekrij
    if (currentWeek !== null) {
        const exp = tempWeekDays * DAILY_EXPECTED_MIN;
        const diff = tempWeekSum - exp;
        body.push([{
            content: `Week ${currentWeek} totaal: ${minToHM(tempWeekSum)} / ${minToHM(exp)}  (${diff>=0?"+":""}${minToHM(diff)})  |  opt-out: ${minToHM(tempWeekOptOut)}`,
            colSpan: 8,
            styles: { halign: "center", fillColor: [240, 248, 255], fontStyle: "bold" }
        }]);
    }

    // 6. Header Informatie Schrijven
    const monthName = new Intl.DateTimeFormat("nl-BE", { month: "long", year: "numeric" }).format(new Date(Y, M - 1, 1));
    
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text(`Tijdsregistraties — ${monthName}`, 40, 40);

    doc.setFont("helvetica", "normal"); doc.setFontSize(11);
    let yPos = 65;

    // Glijtijd tekst
    const glideTxt = monthDiffTotal >= 0 
        ? `Glijtijd saldo: +${minToHM(monthDiffTotal)}` 
        : `Glijtijd saldo: ${minToHM(monthDiffTotal)}`; // Negatief teken zit al in minToHM
    doc.text(glideTxt, 40, yPos); yPos += 14;

    if(overOtherTotal > 0) { doc.text(`Overuren (incl. Oefening/Overleg): ${minToHM(overOtherTotal)}`, 40, yPos); yPos += 14; }
    if(verlofTotal > 0) { doc.text(`Verlof: ${minToHM(verlofTotal)}`, 40, yPos); yPos += 14; }
    if(recupTotal > 0) { doc.text(`Recup: ${minToHM(recupTotal)}`, 40, yPos); yPos += 14; }
    if(optOutExcessTotal > 0) { 
        doc.setTextColor(200, 0, 0); // Rood
        doc.text(`Te veel aan opt-out (> 10u): ${minToHM(optOutExcessTotal)}`, 40, yPos); 
        doc.setTextColor(0); // Reset zwart
        yPos += 14; 
    }

    // 7. Tabel Genereren
    doc.autoTable({
        head,
        body,
        startY: yPos + 10,
        theme: "grid",
        styles: { font: "helvetica", fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [230, 230, 230], textColor: 20 },
        columnStyles: { 0: { cellWidth: 80 }, 7: { cellWidth: "auto" } }
    });

    // 8. Downloaden
    const filename = `${Y}-${pad2(M)}_tijdsregistraties.pdf`;
    doc.save(filename);
    showToast("PDF succesvol gedownload", "success");
}
function escapeHtml(s) { return (s||"").replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

// Start
init();