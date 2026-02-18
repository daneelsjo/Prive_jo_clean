import { getCurrentUser, watchUser, login } from "../../services/auth.js";
import { 
    subscribeToSegments, addSegment, updateSegment, deleteSegment 
} from "../../services/db.js";
import { showToast } from "../../components/toast.js";

// State
let currentUser = null;
let monthSegments = [];
let monthPicker = document.getElementById("monthPicker");
const timeTable = document.getElementById("timeTable")?.querySelector("tbody");

// Constanten
const DAILY_EXPECTED_MIN = 7 * 60 + 36; // 7u36
const WIN_START = 7 * 60;   // 07:00
const WIN_END = 18 * 60;    // 18:00

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
    if (entry?.type === "feestdag" && (!s || !e)) { s = hmToMin("07:00"); e = hmToMin("15:36"); }
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
            setWorkButtonLabel();
            renderTable();
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
    
    // Header knop (Start/Stop)
    ensureHeaderButton();
    
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
}

// --- HEADER KNOP (START/STOP) ---
function ensureHeaderButton() {
    const host = document.getElementById("quickLinks"); // Zorg dat dit ID bestaat in header.html of gebruik een andere plek
    if (!host) return; // Als partial nog niet geladen is, faalt dit.
    
    // Check of knop al bestaat
    if(document.getElementById("workTimerBtn")) return;

    const btn = document.createElement("button");
    btn.id = "workTimerBtn";
    btn.className = "primary";
    btn.textContent = "Laden...";
    btn.style.whiteSpace = "nowrap";
    btn.onclick = onWorkButtonClick;
    host.prepend(btn);
}

function setWorkButtonLabel() {
    const btn = document.getElementById("workTimerBtn");
    if (!btn) return;
    
    const todayISO = fmtDateISO(new Date());
    const seg = monthSegments.find(s => s.uid === currentUser?.uid && s.date === todayISO && s.type === "standard" && !s.end);
    
    if (!seg) { btn.textContent = "Start werktijd"; return; }
    if (seg.start && !seg.beginbreak) { btn.textContent = "Neem pauze"; return; }
    if (seg.beginbreak && !seg.endbreak) { btn.textContent = "Einde pauze"; return; }
    btn.textContent = "Einde werkdag";
}

async function onWorkButtonClick() {
    const todayISO = fmtDateISO(new Date());
    // Zoek open segment
    const seg = monthSegments
        .filter(s => s.uid === currentUser?.uid && s.date === todayISO && s.type === "standard" && !s.end)
        .sort((a, b) => (hmToMin(b.start || "00:00") || 0) - (hmToMin(a.start || "00:00") || 0))[0];

    try {
        if (!seg) {
            // Start Nieuw
            await addSegment({
                uid: currentUser.uid, date: todayISO, type: "standard",
                start: nowHM(), beginbreak: null, endbreak: null, end: null,
                remark: null, minutes: 0, createdAt: Date.now()
            });
            showToast("Werktijd gestart", "success");
        } else if (!seg.beginbreak && !seg.end) {
            // Pauze Start
            await updateSegment(seg.id, { beginbreak: nowHM(), updatedAt: Date.now() });
            showToast("Pauze gestart", "info");
        } else if (seg.beginbreak && !seg.endbreak && !seg.end) {
            // Pauze Einde
            await updateSegment(seg.id, { endbreak: nowHM(), updatedAt: Date.now() });
            showToast("Pauze beëindigd", "info");
        } else if (!seg.end) {
            // Stop
            const end = nowHM();
            const mins = computeMinutes({ ...seg, end });
            await updateSegment(seg.id, { end, minutes: mins, updatedAt: Date.now() });
            showToast("Werkdag beëindigd", "success");
        }
    } catch(e) {
        console.error(e);
        showToast("Er ging iets mis", "error");
    }
}

// --- RENDERING (Tabel & Chips) ---
function renderTable() {
    if (!timeTable || !monthPicker.value) return;
    const [Y, M] = monthPicker.value.split("-").map(Number);
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
        renderDayHeader(d, dayMinutes, dateISO, segs.length > 0);
        
        // Render Segmenten
        segs.forEach(seg => renderSegmentRow(seg, dateISO));
    }
    
    // Laatste week afsluiten
    if(runningWeek !== null) {
        renderWeekRow(runningWeek, weekSum, weekWorkdays, weekOptOut);
        const expected = weekWorkdays * DAILY_EXPECTED_MIN;
        monthDiffTotal += (weekSum - expected);
        optOutExcessTotal += Math.max(0, weekOptOut - (10 * 60));
    }

    // Update Chips bovenaan
    updateMonthMeta(monthDiffTotal, overOtherTotal, verlofTotal, recupTotal, optOutExcessTotal);
}

function renderDayHeader(date, minutes, dateISO, hasSegs) {
    const tr = document.createElement("tr");
    tr.className = "date-header";
    tr.innerHTML = `
        <td colspan="7">
            <div class="datebar">
                <div class="left">${weekdayShort(date)} ${date.getDate()}</div>
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

function renderSegmentRow(seg, dateISO) {
    const tr = document.createElement("tr");
    tr.className = `seg-row type-${seg.type}`;
    tr.dataset.date = dateISO;
    // Standaard openen
    tr.innerHTML = `
        <td></td>
        <td>${seg.start || ""}</td>
        <td>${seg.beginbreak || ""}</td>
        <td>${seg.endbreak || ""}</td>
        <td>${seg.end || ""}</td>
        <td>${minToHM(computeMinutes(seg))}</td>
        <td><span class="badge">${seg.type}</span> ${escapeHtml(seg.remark)}</td>
    `;
    tr.onclick = () => openTimeModal({ id: seg.id });
    timeTable.appendChild(tr);
}

function renderWeekRow(weekNo, worked, days, optOut) {
    const expected = days * DAILY_EXPECTED_MIN;
    const diff = worked - expected;
    const cls = diff >= 0 ? "diff pos" : "diff neg";
    
    const tr = document.createElement("tr");
    tr.className = "week-total";
    tr.innerHTML = `
        <td colspan="7" style="text-align:center; padding-top:10px;">
            Week ${weekNo}: ${minToHM(worked)} / ${minToHM(expected)} 
            <span class="${cls}">(${diff>=0?"+":""}${minToHM(diff)})</span>
            | Opt-out: ${minToHM(optOut)}
        </td>
    `;
    timeTable.appendChild(tr);
}

// --- META CHIPS (Boven de tabel) ---
function updateMonthMeta(diff, over, verlof, recup, optout) {
    // Zoek of maak container
    let meta = document.getElementById("monthMeta");
    if(!meta) {
        meta = document.createElement("div");
        meta.id = "monthMeta";
        meta.className = "month-meta";
        monthPicker.insertAdjacentElement("afterend", meta);
    }
    meta.innerHTML = ""; // Clear

    const addPill = (text, type) => {
        const sp = document.createElement("span");
        sp.className = `pill ${type}`;
        sp.textContent = text;
        meta.appendChild(sp);
    };

    // Glijtijd
    addPill(`Glijtijd: ${minToHM(diff)}`, diff >= 0 ? "pos" : "neg");
    
    if(over > 0) addPill(`Over/Oef/Andere: ${minToHM(over)}`, "info");
    if(verlof > 0) addPill(`Verlof: ${minToHM(verlof)}`, "verlof");
    if(recup > 0) addPill(`Recup: ${minToHM(recup)}`, "recup");
    if(optout > 0) addPill(`Opt-out teveel: ${minToHM(optout)}`, "warn");
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
    if(window.Modal) window.Modal.open("modal-time");
}

function applyTypeEffects() {
    const type = document.getElementById("tr-type").value;
    const isStd = (type === "standard");
    // Verberg pauze velden als het geen standaard werk is
    const bb = document.getElementById("tr-beginbreak").closest("label");
    const be = document.getElementById("tr-endbreak").closest("label");
    if(bb) bb.style.display = isStd ? "" : "none";
    if(be) be.style.display = isStd ? "" : "none";
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
    
    // Auto-fill feestdag
    if(payload.type === "feestdag" && !payload.start) {
        payload.start = "07:00"; payload.end = "15:36";
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
    if(id && confirm("Zeker weten?")) {
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