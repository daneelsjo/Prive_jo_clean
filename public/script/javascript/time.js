// Script/Javascript/time.js
window.DEBUG = true;
const log = (...a) => window.DEBUG && console.log("[time]", ...a);

import {
    getFirebaseApp,
    getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged,
    getFirestore, collection, doc, setDoc, updateDoc, deleteDoc,
    onSnapshot, query, where
} from "./firebase-config.js";

/* ──────────────────────────────────────────────────────────────
   Firebase
   ────────────────────────────────────────────────────────────── */
const app = getFirebaseApp();
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const SEG_COL = "timelogSegments";

/* ──────────────────────────────────────────────────────────────
   DOM refs
   ────────────────────────────────────────────────────────────── */
const loginBtn = document.getElementById("login-btn");
const authDiv = document.getElementById("auth");
const appDiv = document.getElementById("app");
const root = document.getElementById("timeRoot");
const monthPicker = document.getElementById("monthPicker");
const timeTable = document.getElementById("timeTable")?.querySelector("tbody");

/* ──────────────────────────────────────────────────────────────
   State
   ────────────────────────────────────────────────────────────── */
let currentUser = null;
let monthSegments = [];
let unsubSeg = null;

const EXCLUDED_TYPES_FOR_TOTALS = new Set(["sport", "oefening", "andere"]);
const DAILY_EXPECTED_MIN = 7 * 60 + 36;
function minToDecimalComma(min, digits = 1) {
    const val = Math.abs(min) / 60;
    return val.toFixed(digits).replace(".", ",");
}
const WIN_START = 7 * 60;   // 07:00
const WIN_END = 18 * 60;  // 18:00

/* ──────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────── */
const pad2 = (n) => String(n).padStart(2, "0");
const fmtDateISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function nowHM() { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function hmToMin(hm) { if (!hm) return null; const [h, m] = hm.split(":").map(Number); return h * 60 + m; }
function minToHM(min) { const sign = min < 0 ? "-" : ""; const v = Math.abs(min); const h = Math.floor(v / 60), m = v % 60; return `${sign}${pad2(h)}:${pad2(m)}`; }
function weekdayShort(d) { return new Intl.DateTimeFormat("nl-BE", { weekday: "short" }).format(d).replace(".", ""); }
function isoWeek(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = (date.getUTCDay() || 7);
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}
function escapeHtml(s = "") { return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function splitWorkIntervals(entry) {
    // maakt 1 of 2 werkintervallen: [start, breakStart] en/of [breakEnd, end]
    const s = hmToMin(entry?.start);
    const e = hmToMin(entry?.end);
    if (s == null || e == null || e <= s) return [];
    const bs = hmToMin(entry?.beginbreak);
    const be = hmToMin(entry?.endbreak);
    if (bs != null && be != null && s <= bs && bs < be && be <= e) {
        return [[s, bs], [be, e]];
    }
    return [[s, e]];
}

function overlapMinutes([a, b], wStart, wEnd) {
    const lo = Math.max(a, wStart);
    const hi = Math.min(b, wEnd);
    return Math.max(0, hi - lo);
}

function computeInterventionSplit(entry) {
    // netto minuten uitsplitsen: binnen 07:00–18:00 vs opt-out erbuiten
    const intervals = splitWorkIntervals(entry);
    if (!intervals.length) return { inside: 0, optout: 0 };
    const total = intervals.reduce((sum, iv) => sum + (iv[1] - iv[0]), 0);
    const inside = intervals.reduce((sum, iv) => sum + overlapMinutes(iv, WIN_START, WIN_END), 0);
    const optout = Math.max(0, total - inside);
    return { inside, optout };
}

function rowClassByType(t) {
    const v = (t || "").toLowerCase();
    const map = {
        feestdag: "type-feestdag", sport: "type-sport", recup: "type-recup",
        verlof: "type-verlof", oefening: "type-oefening", andere: "type-andere", interventie: "type-interventie"
    };
    return map[v] || "";
}
function computeMinutes(entry) {
    // netto minuten binnen segment (pauze aftrekken indien beide waarden)
    let s = hmToMin(entry?.start), e = hmToMin(entry?.end);
    if (entry?.type === "feestdag" && (!s || !e)) { s = hmToMin("07:00"); e = hmToMin("15:36"); }
    if (s == null || e == null) return 0;
    let total = e - s;
    const bs = hmToMin(entry?.beginbreak), be = hmToMin(entry?.endbreak);
    if (bs != null && be != null) total -= Math.max(0, be - bs);
    return Math.max(0, total);
}
function ensureMonthMetaUI() {
    if (!monthPicker) return;
    let meta = document.getElementById("monthMeta");
    if (!meta) {
        meta = document.createElement("div");
        meta.id = "monthMeta";
        meta.className = "month-meta";
        monthPicker.insertAdjacentElement("afterend", meta);
    }
    // Zorg dat alle chips bestaan
    const ensureChip = (id) => {
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement("span");
            el.id = id;
            el.className = "pill";
            el.style.display = "none";
            meta.appendChild(el);
        }
        return el;
    };
    ensureChip("glideChip"); // glijtijd +/-
    ensureChip("ovChip");    // Overuren & Andere (& Oefening)
    ensureChip("vlChip");    // Verlof
    ensureChip("rcChip");    // Recup
    ensureChip("optoutChip"); // Opt-out
}

function updateMonthMeta(diffMin, overOtherMin, verlofMin, recupMin, optOutExcessMin) {
    const chip = document.getElementById("glideChip");
    const ov = document.getElementById("ovChip");
    const vl = document.getElementById("vlChip");
    const rc = document.getElementById("rcChip");
    const oo = document.getElementById("optoutChip");

    // Glijtijd
    if (chip) {
        const sign = diffMin >= 0 ? "pos" : "neg";
        chip.className = `pill ${sign}`;
        chip.style.display = "";
        const absHM = minToHM(Math.abs(diffMin));
        const absDec = minToDecimalComma(diffMin, 1);
        chip.textContent = diffMin >= 0
            ? `te veel aan glijtijd: ${absHM} (${absDec})`
            : `te weinig aan glijtijd: ${absHM} (${absDec})`;
    }

    // Overuren & Andere & Oefening (alleen tonen als >0)
    if (ov) {
        if (overOtherMin > 0) {
            ov.style.display = "";
            ov.className = "pill info";
            ov.textContent = `Overuren & Andere & Oefening: ${minToHM(overOtherMin)} (${minToDecimalComma(overOtherMin, 1)})`;
        } else {
            ov.style.display = "none";
        }
    }

    // Verlof
    if (vl) {
        if (verlofMin > 0) {
            vl.style.display = "";
            vl.className = "pill verlof";
            vl.textContent = `Verlof: ${minToHM(verlofMin)} (${minToDecimalComma(verlofMin, 1)})`;
        } else vl.style.display = "none";
    }

    // Recup
    if (rc) {
        if (recupMin > 0) {
            rc.style.display = "";
            rc.className = "pill recup";
            rc.textContent = `Recup: ${minToHM(recupMin)} (${minToDecimalComma(recupMin, 1)})`;
        } else rc.style.display = "none";
    }

    // Te veel aan Opt-out (som van excess per week)
    if (oo) {
        if (optOutExcessMin > 0) {
            oo.style.display = "";
            oo.className = "pill warn";
            oo.textContent = `te veel aan opt-out: ${minToHM(optOutExcessMin)} (${minToDecimalComma(optOutExcessMin, 1)})`;
        } else {
            oo.style.display = "none";
        }
    }
}



/* ──────────────────────────────────────────────────────────────
   Header-knop (site-breed)
   ────────────────────────────────────────────────────────────── */
function ensureHeaderButton() {
    const host = document.getElementById("quickLinks");
    if (!host) return;
    let btn = document.getElementById("workTimerBtn");
    if (!btn) {
        btn = document.createElement("button");
        btn.id = "workTimerBtn";
        btn.className = "primary";
        btn.textContent = "Start werktijd";
        btn.style.whiteSpace = "nowrap";
        host.prepend(btn);
    }
    btn.onclick = onWorkButtonClick; // altijd opnieuw koppelen
}

function setWorkButtonLabelFromSegments() {
    const btn = document.getElementById("workTimerBtn");
    if (!btn) return;
    const todayISO = fmtDateISO(new Date());
    const seg = monthSegments.find(s => s.uid === currentUser?.uid && s.date === todayISO && s.type === "standard" && !s.end);
    if (!seg) { btn.textContent = "Start werktijd"; return; }
    if (seg.start && !seg.beginbreak) { btn.textContent = "Neem pauze"; return; }
    if (seg.beginbreak && !seg.endbreak) { btn.textContent = "Einde pauze"; return; }
    btn.textContent = "Einde werkdag";
}

async function getOpenSegmentToday() {
    const todayISO = fmtDateISO(new Date());
    const open = monthSegments
        .filter(s => s.uid === currentUser?.uid && s.date === todayISO && s.type === "standard" && !s.end)
        .sort((a, b) => (hmToMin(b.start || "00:00") || 0) - (hmToMin(a.start || "00:00") || 0));
    return open[0] || null;
}

async function onWorkButtonClick() {
    if (!currentUser) { try { await signInWithPopup(auth, provider); } catch { return; } }

    const todayISO = fmtDateISO(new Date());
    let seg = await getOpenSegmentToday();

    if (!seg) {
        const ref = doc(collection(db, SEG_COL));
        await setDoc(ref, {
            uid: currentUser.uid, date: todayISO, type: "standard",
            start: nowHM(), beginbreak: null, endbreak: null, end: null,
            remark: null, minutes: 0, createdAt: Date.now(), updatedAt: Date.now()
        });
        return;
    }
    if (!seg.beginbreak && !seg.end) {
        await updateDoc(doc(db, SEG_COL, seg.id), { beginbreak: nowHM(), updatedAt: Date.now() }); return;
    }
    if (seg.beginbreak && !seg.endbreak && !seg.end) {
        await updateDoc(doc(db, SEG_COL, seg.id), { endbreak: nowHM(), updatedAt: Date.now() }); return;
    }
    if (!seg.end) {
        const end = nowHM();
        const mins = computeMinutes({ ...seg, end });
        await updateDoc(doc(db, SEG_COL, seg.id), { end, minutes: mins, updatedAt: Date.now() });
    }
}

/* ──────────────────────────────────────────────────────────────
   Auth + streams
   ────────────────────────────────────────────────────────────── */
loginBtn && (loginBtn.onclick = () => signInWithPopup(auth, provider));

function startSegmentsStream() {
    if (!currentUser) return;
    if (unsubSeg) { unsubSeg(); unsubSeg = null; }
    const qSeg = query(collection(db, SEG_COL), where("uid", "==", currentUser.uid));
    unsubSeg = onSnapshot(qSeg, (snap) => {
        monthSegments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setWorkButtonLabelFromSegments();
        if (root) renderTable();
    });
}

onAuthStateChanged(auth, (user) => {
    if (!user) {
        if (unsubSeg) { unsubSeg(); unsubSeg = null; }
        currentUser = null;
        monthSegments = [];
        authDiv && (authDiv.style.display = "block");
        appDiv && (appDiv.style.display = "none");
        setWorkButtonLabelFromSegments();
        return;
    }
    currentUser = user;
    authDiv && (authDiv.style.display = "none");
    appDiv && (appDiv.style.display = "block");
    startSegmentsStream();
    if (root) initTimePage();
});

/* ──────────────────────────────────────────────────────────────
   Tijdspagina (maandoverzicht + modal)
   ────────────────────────────────────────────────────────────── */
function initTimePage() {
    const d = new Date();
    if (monthPicker) monthPicker.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    ensureMonthMetaUI();
    monthPicker && (monthPicker.onchange = renderTable);

    // ⬇️ PDF export knop
    document.getElementById("btnExportPdf")?.addEventListener("click", exportMonthPdf);

    // QA-knoppen blijven zoals je al had...
    document.querySelectorAll(".qa[data-type]").forEach(btn => {
        btn.addEventListener("click", () => openTimeModal({ type: btn.getAttribute("data-type") }));
    });

    renderTable();
}


function renderTable() {
    if (!timeTable) return;
    const [Y, M] = (monthPicker.value || "").split("-").map(Number);
    if (!Y || !M) return;

    timeTable.innerHTML = "";
    const last = new Date(Y, M, 0);

    // groepeer per datum binnen de maand
    const byDate = new Map();
    monthSegments.forEach(s => {
        if (!s.date) return;
        const dt = new Date(s.date);
        if (dt.getFullYear() !== Y || (dt.getMonth() + 1) !== M) return;
        if (!byDate.has(s.date)) byDate.set(s.date, []);
        byDate.get(s.date).push(s);
    });

    let runningWeek = null, weekSum = 0, weekWorkdays = 0;
    let monthDiffTotal = 0;

    // totals voor chips
    let overOtherTotal = 0; // overuren + andere + oefening
    let verlofTotal = 0;
    let recupTotal = 0;
    let weekOptOut = 0;    // opt-out per week
    let optOutExcessTotal = 0; // som van max(0, weekOptOut - 10:00)

    monthSegments.forEach(s => {
        const dt = s.date ? new Date(s.date) : null;
        if (!dt || dt.getFullYear() !== Y || (dt.getMonth() + 1) !== M) return;
        const t = (s.type || "").toLowerCase();
        const mins = computeMinutes(s);
        if (t === "verlof") verlofTotal += mins;
        if (t === "recup") recupTotal += mins;
        if (t === "overuren" || t === "andere" || t === "oefening") overOtherTotal += mins;
    });

    for (let day = 1; day <= last.getDate(); day++) {
        const d = new Date(Y, M - 1, day);
        const dateISO = fmtDateISO(d);
        const segs = (byDate.get(dateISO) || [])
            .sort((a, b) => (hmToMin(a.start || "00:00") || 0) - (hmToMin(b.start || "00:00") || 0));

        const dow = d.getDay(); // 0=zo..6=za
        const isWorkday = dow >= 1 && dow <= 5;

        const w = isoWeek(d);
        if (runningWeek !== null && w !== runningWeek) {
            // sluit vorige week af
            const expected = weekWorkdays * DAILY_EXPECTED_MIN;
            const diff = weekSum - expected;
            addWeekRow(runningWeek, weekSum, expected, diff, weekOptOut);
            monthDiffTotal += diff;
            optOutExcessTotal += Math.max(0, weekOptOut - (10 * 60)); // 10u per week toegestaan
            // reset
            weekSum = 0; weekWorkdays = 0; weekOptOut = 0;
        }
        runningWeek = w;

        // dagtotaal: tel alles EXCL sport/oefening/andere,
        // en voor interventie: alleen de binnen-venster minuten meerekenen
        let dayMinutes = 0;
        segs.forEach(s => {
            const t = (s.type || "").toLowerCase();
            if (t === "sport" || t === "oefening" || t === "andere") return;
            if (t === "interventie") {
                const { inside, optout } = computeInterventionSplit(s);
                dayMinutes += inside;
                weekOptOut += optout;
            } else {
                dayMinutes += computeMinutes(s);
            }
        });
        weekSum += dayMinutes;
        if (isWorkday) weekWorkdays++;

        // datum header (altijd dicht) + knoppen
        const hdr = document.createElement("tr");
        hdr.className = "date-header";
        hdr.innerHTML = `
      <td colspan="7">
        <div class="datebar">
          <div class="left">${weekdayShort(d)} ${day}</div>
          <div class="right">
            <span class="muted">${dayMinutes ? minToHM(dayMinutes) : ""}</span>
            <button class="icon-xs toggle" data-date="${dateISO}" aria-expanded="false" title="In-/uitklappen">▶</button>
            <button class="icon-xs add" data-date="${dateISO}" title="Nieuw segment">+</button>
          </div>
        </div>
      </td>`;
        timeTable.appendChild(hdr);

        const toggleBtn = hdr.querySelector(".toggle");
        const addBtn = hdr.querySelector(".add");
        let collapsed = true; // standaard dicht
        const setToggleUI = (btn, col) => {
            btn.textContent = col ? "▶" : "▼";
            btn.setAttribute("aria-expanded", String(!col));
        };
        setToggleUI(toggleBtn, collapsed);

        toggleBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            collapsed = !collapsed;
            setToggleUI(toggleBtn, collapsed);
            timeTable.querySelectorAll(`tr.seg-row[data-date="${dateISO}"]`).forEach(tr => {
                tr.style.display = collapsed ? "none" : "";
            });
        });
        addBtn.addEventListener("click", (e) => { e.stopPropagation(); openTimeModal({ date: dateISO }); });

        // segment-rijen
        segs.forEach(seg => {
            const tr = document.createElement("tr");
            tr.dataset.date = dateISO;
            tr.classList.add("seg-row");
            const cls = rowClassByType(seg.type);
            if (cls) tr.classList.add(cls);
            tr.style.display = "none"; // start dicht

            tr.innerHTML = `
        <td></td>
        <td>${seg.start || ""}</td>
        <td>${seg.beginbreak || ""}</td>
        <td>${seg.endbreak || ""}</td>
        <td>${seg.end || ""}</td>
        <td>${computeMinutes(seg) ? minToHM(computeMinutes(seg)) : ""}</td>
        <td><span class="badge">${(seg.type || "standard")[0].toUpperCase() + (seg.type || "standard").slice(1)}</span> ${seg.remark ? escapeHtml(seg.remark) : ""}</td>
      `;
            tr.addEventListener("click", (ev) => { ev.stopPropagation(); openTimeModal({ id: seg.id }); });
            timeTable.appendChild(tr);
        });
    }

    // laatste week afsluiten
    if (runningWeek !== null) {
        const expected = weekWorkdays * DAILY_EXPECTED_MIN;
        const diff = weekSum - expected;
        addWeekRow(runningWeek, weekSum, expected, diff, weekOptOut);
        monthDiffTotal += diff;
        optOutExcessTotal += Math.max(0, weekOptOut - (10 * 60));
    }

    // update alle chips (incl. te veel aan opt-out)
    updateMonthMeta(monthDiffTotal, overOtherTotal, verlofTotal, recupTotal, optOutExcessTotal);

    function addWeekRow(weekNo, workedMin, expectedMin, diffMin, optOutMin) {
        const tr = document.createElement("tr");
        tr.className = "week-total";
        const diffClass = diffMin >= 0 ? "diff pos" : "diff neg";
        const diffText = (diffMin === 0) ? "00:00" : minToHM(Math.abs(diffMin));
        tr.innerHTML = `
      <td colspan="7">
        Week ${weekNo} totaal: ${minToHM(workedMin)} / ${minToHM(expectedMin)}
        <span class="${diffClass}">(${diffMin >= 0 ? "+" : "-"}${diffText})</span>
        | opt-out: ${minToHM(optOutMin)} (${minToDecimalComma(optOutMin, 1)})
      </td>`;
        timeTable.appendChild(tr);
    }
}

async function exportMonthPdf() {
    const JSPDF = window.jspdf?.jsPDF || window.jsPDF;
    if (!JSPDF) { alert("jsPDF niet geladen. Controleer de <script> tags."); return; }

    // Plugin aanwezig? (op prototype)
    const hasAutoTable = typeof window.jspdf?.jsPDF?.API?.autoTable === "function";
    if (!hasAutoTable) { alert("AutoTable plugin niet geladen. Controleer het plugin script."); return; }


    const doc = new JSPDF({ unit: "pt", format: "a4", compress: true });

    // Huidige selectie
    const [Y, M] = (monthPicker.value || "").split("-").map(Number);
    if (!Y || !M) { alert("Kies eerst een maand."); return; }

    // Verzamel data zoals in renderTable()
    const last = new Date(Y, M, 0);
    const byDate = new Map();
    monthSegments.forEach(s => {
        if (!s.date) return;
        const dt = new Date(s.date);
        if (dt.getFullYear() !== Y || (dt.getMonth() + 1) !== M) return;
        if (!byDate.has(s.date)) byDate.set(s.date, []);
        byDate.get(s.date).push(s);
    });

    // Maandtotalen voor header-chips
    let monthDiffTotal = 0;
    let overOtherTotal = 0;
    let verlofTotal = 0;
    let recupTotal = 0;
    let optOutExcessTotal = 0;

    monthSegments.forEach(s => {
        const dt = s.date ? new Date(s.date) : null;
        if (!dt || dt.getFullYear() !== Y || (dt.getMonth() + 1) !== M) return;
        const t = (s.type || "").toLowerCase();
        const mins = computeMinutes(s);
        if (t === "verlof") verlofTotal += mins;
        if (t === "recup") recupTotal += mins;
        if (t === "overuren" || t === "andere" || t === "oefening") overOtherTotal += mins;
    });

    // Tabel opbouwen
    const head = [[
        "Datum", "Type", "Start", "Start pauze", "Einde pauze", "Einde", "Min", "Opmerking"
    ]];
    const body = [];

    const dayFmt = new Intl.DateTimeFormat("nl-BE", { weekday: "short" });

    let runningWeek = null, weekSum = 0, weekWorkdays = 0, weekOptOut = 0;

    for (let day = 1; day <= last.getDate(); day++) {
        const d = new Date(Y, M - 1, day);
        const dateISO = fmtDateISO(d);
        const segs = (byDate.get(dateISO) || [])
            .sort((a, b) => (hmToMin(a.start || "00:00") || 0) - (hmToMin(b.start || "00:00") || 0));

        const dow = d.getDay(); // 0..6
        const isWorkday = dow >= 1 && dow <= 5;

        const w = isoWeek(d);
        if (runningWeek !== null && w !== runningWeek) {
            // sluit vorige week en voeg week-totalen
            const expected = weekWorkdays * DAILY_EXPECTED_MIN;
            const diff = weekSum - expected;
            monthDiffTotal += diff;
            optOutExcessTotal += Math.max(0, weekOptOut - (10 * 60));

            body.push([{
                content: `Week ${runningWeek} totaal: ${minToHM(weekSum)} / ${minToHM(expected)}  (${diff >= 0 ? "+" : "-"}${minToHM(Math.abs(diff))})  |  opt-out: ${minToHM(weekOptOut)} (${minToDecimalComma(weekOptOut, 1)})`,
                colSpan: 8,
                styles: { halign: "center", fillColor: [240, 248, 255], fontStyle: "bold" }
            }]);

            weekSum = 0; weekWorkdays = 0; weekOptOut = 0;
        }
        runningWeek = w;

        // dagtotaal (zoals in renderTable)
        let dayMinutes = 0;
        segs.forEach(s => {
            const t = (s.type || "").toLowerCase();
            if (t === "sport" || t === "oefening" || t === "andere") return;
            if (t === "interventie") {
                const { inside, optout } = computeInterventionSplit(s);
                dayMinutes += inside;
                weekOptOut += optout;
            } else {
                dayMinutes += computeMinutes(s);
            }
        });
        if (isWorkday) weekWorkdays++;

        if (segs.length) {
            // dag-header rij
            body.push([{
                content: `${dayFmt.format(d)} ${day} — ${dayMinutes ? minToHM(dayMinutes) : "00:00"}`,
                colSpan: 8,
                styles: { fillColor: [245, 245, 245], fontStyle: "bold" }
            }]);

            // segment-rijen
            segs.forEach(seg => {
                const mins = computeMinutes(seg);
                body.push([
                    "", // datum leeg bij segment
                    (seg.type || "standard").slice(0, 1).toUpperCase() + (seg.type || "standard").slice(1),
                    seg.start || "",
                    seg.beginbreak || "",
                    seg.endbreak || "",
                    seg.end || "",
                    mins ? minToHM(mins) : "",
                    seg.remark || ""
                ]);
            });

            weekSum += dayMinutes;
        }
    }

    if (runningWeek !== null) {
        const expected = weekWorkdays * DAILY_EXPECTED_MIN;
        const diff = weekSum - expected;
        monthDiffTotal += diff;
        optOutExcessTotal += Math.max(0, weekOptOut - (10 * 60));

        body.push([{
            content: `Week ${runningWeek} totaal: ${minToHM(weekSum)} / ${minToHM(expected)}  (${diff >= 0 ? "+" : "-"}${minToHM(Math.abs(diff))})  |  opt-out: ${minToHM(weekOptOut)} (${minToDecimalComma(weekOptOut, 1)})`,
            colSpan: 8,
            styles: { halign: "center", fillColor: [240, 248, 255], fontStyle: "bold" }
        }]);
    }

    // Titel & maand-samenvatting
    const monthName = new Intl.DateTimeFormat("nl-BE", { month: "long", year: "numeric" })
        .format(new Date(Y, M - 1, 1));
    const topY = 40;
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text(`Tijdsregistraties — ${monthName}`, 40, topY);

    doc.setFont("helvetica", "normal"); doc.setFontSize(11);
    let y = topY + 20;

    const glideAbs = minToHM(Math.abs(monthDiffTotal));
    const glideDec = minToDecimalComma(monthDiffTotal, 1);
    const glideTxt = monthDiffTotal >= 0
        ? `Te veel aan glijtijd: ${glideAbs} (${glideDec})`
        : `Te weinig aan glijtijd: ${glideAbs} (${glideDec})`;

    const lines = [
        glideTxt,
        overOtherTotal > 0 ? `Overuren & Andere & Oefening: ${minToHM(overOtherTotal)} (${minToDecimalComma(overOtherTotal, 1)})` : null,
        verlofTotal > 0 ? `Verlof: ${minToHM(verlofTotal)} (${minToDecimalComma(verlofTotal, 1)})` : null,
        recupTotal > 0 ? `Recup: ${minToHM(recupTotal)} (${minToDecimalComma(recupTotal, 1)})` : null,
        optOutExcessTotal > 0 ? `Te veel aan opt-out: ${minToHM(optOutExcessTotal)} (${minToDecimalComma(optOutExcessTotal, 1)})` : null
    ].filter(Boolean);

    lines.forEach((t, i) => {
        doc.text(t, 40, y + i * 14);
    });

    // AutoTable
    doc.autoTable({
        head,
        body,
        startY: y + (lines.length ? lines.length * 14 + 10 : 10),
        theme: "grid",
        styles: { font: "helvetica", fontSize: 9, cellPadding: 4, overflow: "linebreak" },
        headStyles: { fillColor: [230, 230, 230], textColor: 20 },
        columnStyles: {
            0: { cellWidth: 80 },  // Datum (alleen op de dagheader-rij)
            1: { cellWidth: 90 },  // Type
            2: { cellWidth: 55 },  // Start
            3: { cellWidth: 80 },  // Start pauze
            4: { cellWidth: 85 },  // Einde pauze
            5: { cellWidth: 55 },  // Einde
            6: { cellWidth: 50 },  // Min
            7: { cellWidth: "auto" } // Opmerking
        },
        didDrawPage: (data) => {
            // paginanummer
            const pageSize = doc.internal.pageSize;
            const pageHeight = pageSize.getHeight();
            const pageWidth = pageSize.getWidth();
            const str = `Pagina ${doc.getNumberOfPages()}`;
            doc.setFontSize(9);
            doc.setTextColor(120);
            doc.text(str, pageWidth - 40, pageHeight - 20, { align: "right" });
        }
    });

    const filename = `${Y}-${pad2(M)}_tijdsregistraties.pdf`;
    doc.save(filename);
}



/* ──────────────────────────────────────────────────────────────
   Modal (gebruikt inputs met id: tr-date, tr-type, tr-start, tr-beginbreak, tr-endbreak, tr-end, tr-remark)
   ────────────────────────────────────────────────────────────── */
function isStandardType(v) {
    const t = (v || "").toLowerCase();
    return t === "standard" || t === "standaard";
}

function applyTypeEffects() {
    const typeSel = document.getElementById("tr-type");
    const showPause = isStandardType(typeSel.value);
    const elBB = document.getElementById("tr-beginbreak")?.closest("label");
    const elBE = document.getElementById("tr-endbreak")?.closest("label");
    if (elBB) elBB.style.display = showPause ? "" : "none";
    if (elBE) elBE.style.display = showPause ? "" : "none";
    if (!showPause) {
        const bb = document.getElementById("tr-beginbreak");
        const be = document.getElementById("tr-endbreak");
        if (bb) bb.value = "";
        if (be) be.value = "";
    }
}

function openTimeModal(opts = {}) {
    const get = id => document.getElementById(id);
    let seg = null;
    if (opts.id) seg = monthSegments.find(s => s.id === opts.id) || null;

    const dISO = seg?.date || opts.date || fmtDateISO(new Date());
    get("tr-date").value = dISO;
    get("tr-type").value = (opts.type || seg?.type || "standard");
    get("tr-start").value = seg?.start || "";
    get("tr-beginbreak").value = seg?.beginbreak || "";
    get("tr-endbreak").value = seg?.endbreak || "";
    get("tr-end").value = seg?.end || "";
    get("tr-remark").value = seg?.remark || "";

    // knoppen (id doorgeven via dataset)
    const saveBtn = get("tr-save");
    const delBtn = get("tr-delete");
    saveBtn.dataset.editingId = seg?.id || "";
    delBtn.dataset.editingId = seg?.id || "";
    delBtn.style.display = seg ? "" : "none";

    applyTypeEffects();
    get("tr-type").onchange = applyTypeEffects;

    Modal.open("modal-time");
}

async function saveSegmentFromModal() {
    if (!currentUser) { try { await signInWithPopup(auth, provider); } catch { return; } }

    const get = id => document.getElementById(id);
    const id = get("tr-save")?.dataset?.editingId || null;

    const payload = {
        uid: currentUser.uid,
        date: get("tr-date").value,
        type: (get("tr-type").value || "standard").toLowerCase(),
        start: get("tr-start").value || null,
        beginbreak: get("tr-beginbreak").value || null,
        endbreak: get("tr-endbreak").value || null,
        end: get("tr-end").value || null,
        remark: (get("tr-remark").value || "").trim() || null
    };
    if (payload.type === "feestdag" && !payload.start && !payload.end) { payload.start = "07:00"; payload.end = "15:36"; }
    payload.minutes = computeMinutes(payload);

    if (id) await updateDoc(doc(db, SEG_COL, id), { ...payload, updatedAt: Date.now() });
    else await setDoc(doc(collection(db, SEG_COL)), { ...payload, createdAt: Date.now(), updatedAt: Date.now() });

    Modal.close("modal-time");
}

async function deleteSegmentFromModal() {
    const btn = document.getElementById("tr-delete");
    const id = btn?.dataset?.editingId;
    if (!id) return;
    if (!confirm("Dit segment verwijderen?")) return;
    await deleteDoc(doc(db, SEG_COL, id));
    Modal.close("modal-time");
}

/* ──────────────────────────────────────────────────────────────
   Bootstrapping
   ────────────────────────────────────────────────────────────── */
document.addEventListener("partials:loaded", ensureHeaderButton);
document.addEventListener("DOMContentLoaded", ensureHeaderButton);

// modal knoppen (1x koppelen)
document.getElementById("tr-save")?.addEventListener("click", saveSegmentFromModal);
document.getElementById("tr-delete")?.addEventListener("click", deleteSegmentFromModal);

// Exporteer voor rij-clicks / plus-knop
window.openTimeModal = openTimeModal;
