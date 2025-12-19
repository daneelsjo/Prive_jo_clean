// Script/Javascript/payments.js
import {
  getFirebaseApp,
  // Auth
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged,
  // Firestore
  getFirestore, collection, addDoc, onSnapshot, doc, setDoc, getDoc, updateDoc, serverTimestamp, query, where, orderBy
} from "../../../script/javascript/firebase-config.js";
import { getDocs } from "https://www.gstatic.com/firebasejs/10.5.2/firebase-firestore.js";

const app = getFirebaseApp();
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

/* ──────────────────────────────────────────────────────────────
   State & DOM
   ────────────────────────────────────────────────────────────── */
let currentUser = null;

let bills = [];
let incomes = [];
let fixedCosts = [];

let selectedBillId = null;
let selectedPartIndex = null;
let selectedMonth = (new Date()).toISOString().slice(0, 7); // YYYY-MM

// Multi-select basket (Map<key, item>)
let selected = new Map();

// Firestore listener voor selectie
let selUnsub = null;

// DOM
const loginBtn = document.getElementById("login-btn");
const authDiv = document.getElementById("auth");
const appDiv = document.getElementById("app");

const billsBody = document.getElementById("billsBody");
const newBillBtn = document.getElementById("newBillBtn");
const addIncomeBtn = document.getElementById("addIncomeBtn");
const fixedCostsBtn = document.getElementById("fixedCostsBtn");

const monthPicker = document.getElementById("monthPicker");
const incomeList = document.getElementById("incomeList");
const fixedList = document.getElementById("fixedList");
const incomeTotal = document.getElementById("incomeTotal");
const fixedTotal = document.getElementById("fixedTotal");
const selectedPaymentBox = document.getElementById("selectedPaymentBox");
const selectedList = document.getElementById("selectedList");
const selTotal = document.getElementById("selTotal");
const payReviewBtn = document.getElementById("payReviewBtn");
const clearSelectedBtn = document.getElementById("clearSelectedBtn");

const sumIncome = document.getElementById("sumIncome");
const sumFixed = document.getElementById("sumFixed");
const sumToPay = document.getElementById("sumToPay");
const sumDiff = document.getElementById("sumDiff");
const openTotal = document.getElementById("openTotal");

// Extra knoppen
const fixedOverviewBtn = document.getElementById("fixedOverviewBtn");
const closedHistoryBtn = document.getElementById("closedHistoryBtn");

/* ──────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────── */
const fmt = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
function euro(n) { return fmt.format(Number(n || 0)); }
function clamp2(n) { return Math.round(Number(n || 0) * 100) / 100; }
function monthKey(d) {
  if (typeof d === "string" && /^\d{4}-\d{2}$/.test(d)) return d;
  const dt = (d instanceof Date) ? d : new Date();
  return dt.toISOString().slice(0, 7);
}
function addMonths(ym, delta) {
  const [y, m] = String(ym).split("-").map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function prevMonth(ym) { return addMonths(ym, -1); }
function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.seconds ? new Date(ts.seconds * 1000) : (ts instanceof Date ? ts : new Date(ts));
  return d.toLocaleDateString("nl-BE");
}
function toDateFromYMD(ymd) { return new Date(`${ymd}T12:00:00`); }

function debounce(fn, wait = 500) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

function serializeSelected(map) {
  return Object.fromEntries(map.entries());
}
function deserializeSelected(obj) {
  const m = new Map();
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) m.set(k, v);
  }
  return m;
}

function renderAll() { renderBills(); renderSidebar(); }

function updateOpenTotal() {
  if (!openTotal) return;
  const tot = bills.reduce((s, b) => {
    const rem = Number(b.amountTotal || 0) - Number(b.paidAmount || 0);
    return s + (rem > 0 ? rem : 0);
  }, 0);
  openTotal.textContent = euro(clamp2(tot));
}

function clearSelectionUI() {
  selected.clear();
  billsBody && billsBody.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  renderSelectedList();
  sumToPay && (sumToPay.textContent = euro(0));
  recalcDiff();
}

/* ──────────────────────────────────────────────────────────────
   Selectie ↔ Firestore (blijft staan na refresh)
   ────────────────────────────────────────────────────────────── */
async function saveSelectionNow() {
  if (!currentUser) return;
  const ref = doc(db, `users/${currentUser.uid}/selections/${selectedMonth}`);
  await setDoc(ref, {
    month: selectedMonth,
    items: serializeSelected(selected),
    updatedAt: serverTimestamp()
  }, { merge: true });
}
const saveSelectionDebounced = debounce(saveSelectionNow, 600);

function selectChanged() {
  renderSelectedList();
  sumToPay.textContent = euro(totalSelected());
  recalcDiff();
  saveSelectionDebounced();
}

async function attachSelectionListener(month) {
  if (!currentUser) return;
  if (selUnsub) { try { selUnsub(); } catch { } selUnsub = null; }
  const ref = doc(db, `users/${currentUser.uid}/selections/${month}`);
  selUnsub = onSnapshot(ref, (snap) => {
    // als geen doc: lege selectie
    const data = snap.exists() ? snap.data() : { items: {} };
    selected = deserializeSelected(data.items);
    // UI sync
    renderSelectedList();
    sumToPay.textContent = euro(totalSelected());
    recalcDiff();
    renderBills(); // vinkjes in tabel laten aansluiten
  });
}

/* ──────────────────────────────────────────────────────────────
   Auth + live streams
   ────────────────────────────────────────────────────────────── */
loginBtn && (loginBtn.onclick = () => signInWithPopup(auth, provider));

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    appDiv && (appDiv.style.display = "none");
    authDiv && (authDiv.style.display = "block");
    return;
  }
  currentUser = user;
  authDiv && (authDiv.style.display = "none");
  appDiv && (appDiv.style.display = "block");

  // Bills
  onSnapshot(query(collection(db, "bills"), orderBy("createdAt", "desc")), snap => {
    bills = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBills();
  });

  // Incomes (soft delete filter + maand)
  onSnapshot(query(collection(db, "incomes")), snap => {
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    incomes = all.filter(x => !x.deleted && x.month === selectedMonth);
    renderSidebar();
  });

  // Fixed costs
  onSnapshot(query(collection(db, "fixedCosts")), snap => {
    fixedCosts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSidebar();
  });

  monthPicker.value = selectedMonth;

  // Laad selectie voor de huidige maand
  attachSelectionListener(selectedMonth);
});

/* ──────────────────────────────────────────────────────────────
   Bills table
   ────────────────────────────────────────────────────────────── */
function renderBills() {
  if (!billsBody) return;
  billsBody.innerHTML = "";

  const open = bills.filter(b => (Number(b.amountTotal || 0) - Number(b.paidAmount || 0)) > 0);

  if (openTotal) {
    const tot = open.reduce((s, b) => s + (Number(b.amountTotal || 0) - Number(b.paidAmount || 0)), 0);
    openTotal.textContent = euro(clamp2(tot));
  }

  if (!open.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "Geen openstaande betalingen.";
    tr.appendChild(td);
    billsBody.appendChild(tr);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  for (const b of open) {
    const tr = document.createElement("tr");
    tr.dataset.id = b.id;

    const tdName = document.createElement("td");
    tdName.textContent = b.beneficiary || "(zonder naam)";

    const initial = Number(b.amountTotal || 0);
    const remaining = clamp2(initial - Number(b.paidAmount || 0));

    // Te betalen = initieel bedrag
    const tdToPay = document.createElement("td");
    tdToPay.textContent = euro(initial);

    const tdPaid = document.createElement("td");
    tdPaid.textContent = euro(Number(b.paidAmount || 0));

    const tdDue = document.createElement("td");
    if (b.dueDate) {
      const overdue = b.dueDate < today && remaining > 0;
      tdDue.textContent = b.dueDate;
      if (overdue) tdDue.classList.add("date-overdue");
    } else {
      tdDue.textContent = "—";
    }

    const tdAct = document.createElement("td");
    const btnPaid = document.createElement("button");
    btnPaid.className = "ghost";
    btnPaid.title = "Markeer volledig als betaald";
    btnPaid.textContent = "V";
    btnPaid.onclick = (e) => { e.stopPropagation(); settleAsFull(b.id); };
    const btnEdit = document.createElement("button");
    btnEdit.className = "ghost";
    btnEdit.title = "Wijzig rekening";
    btnEdit.textContent = "✎";
    btnEdit.style.marginLeft = ".35rem";
    btnEdit.onclick = (e) => { e.stopPropagation(); openBillModal(b.id); };
    tdAct.append(btnPaid, btnEdit);

    const tdSel = document.createElement("td");
    tdSel.style.textAlign = "center";
    if (b.inParts) {
      const caret = document.createElement("button");
      caret.className = "caret-btn";
      caret.title = "Toon delen";
      caret.textContent = "▸";
      caret.onclick = (e) => {
        e.stopPropagation();
        toggleExpander(b.id);
        caret.textContent = (caret.textContent === "▸" ? "▾" : "▸");
      };
      tdSel.appendChild(caret);
    } else {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      const key = `${b.id}::FULL`;
      cb.checked = selected.has(key);
      cb.onchange = () => {
        if (cb.checked) {
          selected.set(key, { type: "full", billId: b.id, instalmentId: null, amount: remaining, label: `${b.beneficiary}`, iban: b.iban || "", note: "" });
        } else {
          selected.delete(key);
        }
        selectChanged();
      };
      tdSel.appendChild(cb);
    }

    tr.append(tdName, tdToPay, tdPaid, tdDue, tdAct, tdSel);
    billsBody.appendChild(tr);

    // Expander
    if (b.inParts) {
      const expTr = document.createElement("tr");
      expTr.className = "expander-row";
      const td = document.createElement("td");
      td.colSpan = 6;
      const exp = document.createElement("div");
      exp.className = "expander";
      exp.id = `exp-${b.id}`;
      exp.innerHTML = `<div class="muted">Laden…</div>`;
      td.appendChild(exp);
      expTr.appendChild(td);
      billsBody.appendChild(expTr);

      tdName.style.cursor = "pointer";
      tdName.onclick = (e) => { e.stopPropagation(); toggleExpander(b.id); };
    }
  }
}

/* ──────────────────────────────────────────────────────────────
   Right side summary
   ────────────────────────────────────────────────────────────── */
function renderSidebar() {
  const month = selectedMonth;

  // inkomsten lijst (klikbaar)
  const inc = incomes.filter(x => x.month === month);
  incomeList.innerHTML = inc.map(x =>
    `<div class="row income-item" data-id="${x.id}">
       <span>${escapeHtml(x.source === "Andere" ? (x.note || "Andere") : x.source)}</span>
       <strong>${euro(x.amount)}</strong>
     </div>`
  ).join("") || `<div class="muted">Geen inkomsten voor deze maand.</div>`;

  incomeList.querySelectorAll(".income-item").forEach(el => {
    el.addEventListener("click", () => openIncomeEdit(el.dataset.id));
  });

  const fixedRows = fixedCosts
    .filter(x => x.startMonth <= month && (!x.endMonth || x.endMonth >= month))
    .map(x => row(x.name, x.amount));
  fixedList.innerHTML = fixedRows.join("") || `<div class="muted">Geen vaste kosten voor deze maand.</div>`;

  const incSum = clamp2(inc.reduce((s, x) => s + Number(x.amount || 0), 0));
  const fixSum = clamp2(fixedCosts
    .filter(x => x.startMonth <= month && (!x.endMonth || x.endMonth >= month))
    .reduce((s, x) => s + Number(x.amount || 0), 0));

  incomeTotal.textContent = euro(incSum);
  fixedTotal.textContent = euro(fixSum);
  sumIncome.textContent = euro(incSum);
  sumFixed.textContent = euro(fixSum);

  renderSelectedBox();
}

function row(label, amount) {
  return `<div class="row"><span>${escapeHtml(String(label || ""))}</span><strong>${euro(amount)}</strong></div>`;
}

function renderSelectedBox() {
  if (!selectedPaymentBox) return;
  if (!selectedBillId) { selectedPaymentBox.innerHTML = `<p class="muted">Selecteer een rekening in de tabel.</p>`; sumToPay.textContent = euro(0); recalcDiff(); return; }
  const b = bills.find(x => x.id === selectedBillId);
  if (!b) { selectedPaymentBox.innerHTML = `<p class="muted">Rekening niet gevonden.</p>`; sumToPay.textContent = euro(0); recalcDiff(); return; }

  const remaining = clamp2(Number(b.amountTotal || 0) - Number(b.paidAmount || 0));
  const next = b.inParts ? clamp2(b.partAmount || 0) : remaining;
  const lastPart = b.inParts ? clamp2(b.lastPartAmount || 0) : null;
  const hint = (b.inParts && lastPart && remaining <= lastPart) ? ` (laatste deel: ${euro(lastPart)})` : "";

  selectedPartIndex = null;
  selectedPaymentBox.innerHTML = `
    <div><strong>${escapeHtml(b.beneficiary || "(zonder naam)")}</strong></div>
    <div class="hint">Openstaand: ${euro(remaining)}</div>
    <div style="margin-top:.4rem;display:grid;gap:.35rem;">
      <button class="primary" id="selectedPayBtn">Betalen…</button>
      <div class="muted">Standaard wordt ${b.inParts ? "één deel" : "het restbedrag"} voorgesteld.${hint}</div>
    </div>
  `;
  document.getElementById("selectedPayBtn").onclick = () => openPayModal(b.id);
  sumToPay.textContent = euro(b.inParts ? Math.min(remaining, next) : remaining);
  recalcDiff();
}

function recalcDiff() {
  const inc = parseEuro(sumIncome.textContent);
  const fix = parseEuro(sumFixed.textContent);
  const pay = parseEuro(sumToPay.textContent);
  const diff = clamp2(inc - fix - pay);
  sumDiff.textContent = euro(diff);
}
function parseEuro(s) {
  const n = String(s).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return Number(n || 0);
}

/* ──────────────────────────────────────────────────────────────
   Multi-select
   ────────────────────────────────────────────────────────────── */
function totalSelected() {
  let s = 0;
  for (const it of selected.values()) s += Number(it.amount || 0);
  return clamp2(s);
}

function renderSelectedList() {
  if (!selectedList) return;
  if (selected.size === 0) {
    selectedList.innerHTML = `<div class="selectedList-empty">Nog geen geselecteerde betalingen. Vink items aan in de tabel of vink delen aan in de expander.</div>`;
  } else {
    selectedList.innerHTML = "";
    for (const [key, it] of selected.entries()) {
      const row = document.createElement("div");
      row.className = "row";
      const left = document.createElement("div");
      left.textContent = it.label;
      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.alignItems = "center";
      right.style.gap = ".4rem";
      const amt = document.createElement("strong");
      amt.textContent = euro(it.amount);
      const x = document.createElement("button");
      x.className = "ghost";
      x.textContent = "✕";
      x.title = "Verwijder uit selectie";
      x.onclick = () => {
        selected.delete(key);
        const cb = billsBody.querySelector(`tr[data-id="${it.billId}"] input[type="checkbox"]`);
        if (cb) cb.checked = false;
        selectChanged();
      };
      right.append(amt, x);
      row.append(left, right);
      selectedList.appendChild(row);
    }
  }
  selTotal && (selTotal.textContent = euro(totalSelected()));
}

/* ──────────────────────────────────────────────────────────────
   Expander (delen)
   ────────────────────────────────────────────────────────────── */
async function fetchOpenInstalments(billId) {
  const snap = await getDocs(query(collection(db, `bills/${billId}/instalments`), where("status", "==", "open"), orderBy("index", "asc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function toggleExpander(billId, forceOpen) {
  const exp = document.getElementById(`exp-${billId}`);
  if (!exp) return;
  const isOpen = exp.classList.contains("open");
  if (forceOpen === true && isOpen) { /* no-op */ }
  else if (forceOpen === false && !isOpen) { /* no-op */ }
  else { exp.classList.toggle("open"); }
  if (!exp.classList.contains("open")) return;

  exp.innerHTML = `<div class="muted">Laden…</div>`;
  const items = await fetchOpenInstalments(billId);
  if (!items.length) { exp.innerHTML = `<div class="muted">Geen openstaande delen.</div>`; return; }

  const list = document.createElement("div");
  list.className = "list";
  items.forEach(it => {
    const key = `${billId}::${it.id}`;
    const row = document.createElement("div");
    row.className = "row";

    const left = document.createElement("div");
    left.innerHTML = `<label style="display:inline-flex;align-items:center;gap:.5rem;">
      <input type="checkbox" value="${it.id}" ${selected.has(key) ? 'checked' : ''}> Deel ${it.index}
    </label>`;

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = ".4rem";
    right.style.alignItems = "center";

    const amt = document.createElement("strong");
    amt.textContent = euro(it.amount);

    const edit = document.createElement("button");
    edit.className = "ghost";
    edit.title = "Bedrag van dit deel aanpassen";
    edit.textContent = "✎";
    edit.onclick = async () => {
      const val = prompt(`Nieuw bedrag voor deel ${it.index} (huidig ${euro(it.amount)})`, String(it.amount));
      if (val === null || val === "") return;
      const newAmt = clamp2(val);
      try { await rebalanceAfterPartEdit(billId, it.id, newAmt); amt.textContent = euro(newAmt); }
      catch { Modal.alert && Modal.alert({ title: "Oeps", html: "Kon de bedragen niet herrekenen." }); }
    };

    right.append(amt, edit);
    row.append(left, right);
    list.appendChild(row);
  });

  list.addEventListener("change", (e) => {
    const input = e.target.closest('input[type="checkbox"]');
    if (!input) return;
    const partId = input.value;
    const it = items.find(x => x.id === partId);
    const b = bills.find(x => x.id === billId);
    const key = `${billId}::${partId}`;
    if (input.checked) {
      selected.set(key, { type: "part", billId, instalmentId: partId, amount: clamp2(it.amount), label: `${b?.beneficiary || ""} – deel ${it.index}`, iban: b?.iban || "", note: "" });
    } else {
      selected.delete(key);
    }
    selectChanged();
  });

  exp.innerHTML = "";
  exp.appendChild(list);
}

async function rebalanceAfterPartEdit(billId, editedPartId, newAmt) {
  if (Number.isNaN(Number(newAmt)) || Number(newAmt) < 0) throw new Error("Invalid amount");

  const bSnap = await getDoc(doc(db, "bills", billId));
  if (!bSnap.exists()) throw new Error("Bill not found");
  const bill = { id: billId, ...bSnap.data() };

  const snap = await getDocs(collection(db, `bills/${billId}/instalments`));
  const parts = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.index || 0) - (b.index || 0));
  const paid = parts.filter(p => p.status === "paid");
  const open = parts.filter(p => p.status !== "paid");

  const edited = open.find(p => p.id === editedPartId);
  if (!edited) throw new Error("Edited part not open/not found");

  const paidSum = paid.reduce((s, p) => s + Number(p.amount || 0), 0);
  const remainingBudget = clamp2(Number(bill.amountTotal || 0) - paidSum - Number(newAmt || 0));
  const others = open.filter(p => p.id !== editedPartId);
  if (remainingBudget < 0) throw new Error("New amount exceeds remaining total");

  const n = others.length;
  const even = n ? clamp2(remainingBudget / n) : 0;

  await updateDoc(doc(db, `bills/${billId}/instalments/${editedPartId}`), { amount: clamp2(newAmt) });
  for (let i = 0; i < n; i++) {
    const p = others[i];
    const amt = (i === n - 1) ? clamp2(remainingBudget - even * (n - 1)) : even;
    await updateDoc(doc(db, `bills/${billId}/instalments/${p.id}`), { amount: amt });
  }
}

/* ──────────────────────────────────────────────────────────────
   Month picker
   ────────────────────────────────────────────────────────────── */
monthPicker && (monthPicker.onchange = async () => {
  const newM = monthKey(monthPicker.value);
  if (newM === selectedMonth) return;
  await saveSelectionNow();       // bewaar vorige maand
  selectedMonth = newM;
  attachSelectionListener(selectedMonth); // laad nieuwe maand
  onMonthChanged();
});
function onMonthChanged() { renderSidebar(); }

/* ──────────────────────────────────────────────────────────────
   Modals: Nieuwe rekening (ook bewerken)
   ────────────────────────────────────────────────────────────── */
newBillBtn && (newBillBtn.onclick = () => openBillModal());

function openBillModal(billId = null) {
  const iban = document.getElementById("bill-iban");
  const ben = document.getElementById("bill-beneficiary");
  const comm = document.getElementById("bill-comm");
  const desc = document.getElementById("bill-desc");
  const amount = document.getElementById("bill-amount");
  const due = document.getElementById("bill-due");
  const inparts = document.getElementById("bill-inparts");
  const parts = document.getElementById("bill-parts");
  const partsWrap = document.getElementById("partsCountWrap");
  const info = document.getElementById("partsInfo");
  const perPart = document.getElementById("perPart");
  const lastHint = document.getElementById("lastPartHint");

  [iban, ben, comm, desc, amount, due].forEach(el => el && (el.value = ""));
  inparts.checked = false; parts.value = 2; partsWrap.hidden = true;
  info.style.display = "none"; perPart.textContent = euro(0); lastHint.textContent = "";

  let editId = billId;
  if (editId) {
    const b = bills.find(x => x.id === editId);
    if (b) {
      iban.value = b.iban || "";
      ben.value = b.beneficiary || "";
      comm.value = b.communication || "";
      desc.value = b.description || "";
      amount.value = Number(b.amountTotal || 0);
      due.value = b.dueDate || "";
      inparts.checked = !!b.inParts;
      parts.value = Math.max(2, parseInt(b.partsCount || 2, 10));
      partsWrap.hidden = !inparts.checked;
    }
  }

  function recalc() {
    const tot = clamp2(amount.value);
    if (!inparts.checked || !tot || !Number(parts.value)) { info.style.display = "none"; return; }
    const n = Math.max(2, parseInt(parts.value, 10) || 2);
    const raw = clamp2(tot / n);
    const last = clamp2(tot - raw * (n - 1));
    perPart.textContent = euro(raw);
    lastHint.textContent = last !== raw ? ` (laatste betaling: ${euro(last)})` : "";
    info.style.display = "block";
  }
  inparts.onchange = () => { partsWrap.hidden = !inparts.checked; recalc(); };
  amount.oninput = recalc; parts.oninput = recalc;

  document.getElementById("bill-save").onclick = async () => {
    const payload = {
      uid: currentUser?.uid || null,
      iban: (iban.value || "").trim(),
      beneficiary: (ben.value || "").trim(),
      communication: (comm.value || "").trim(),
      description: (desc.value || "").trim(),
      amountTotal: clamp2(amount.value),
      dueDate: (due.value || null),
      inParts: !!inparts.checked,
      partsCount: inparts.checked ? Math.max(2, parseInt(parts.value, 10) || 2) : 1,
      createdAt: serverTimestamp(),
      paidAmount: bills.find(x => x.id === editId)?.paidAmount || 0
    };
    if (!payload.beneficiary || !payload.amountTotal) {
      Modal.alert({ title: "Ontbrekende velden", html: "Vul minstens begunstigde en bedrag in." });
      return;
    }
    if (payload.inParts) {
      const per = clamp2(payload.amountTotal / payload.partsCount);
      const last = clamp2(payload.amountTotal - per * (payload.partsCount - 1));
      payload.partAmount = per; payload.lastPartAmount = last;
    }

    try {
      if (editId) {
        await updateDoc(doc(db, "bills", editId), payload);
        // herverdeel OPEN delen
        const psnap = await getDocs(collection(db, `bills/${editId}/instalments`));
        const all = psnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const paid = all.filter(x => x.status === "paid");
        const open = all.filter(x => x.status !== "paid").sort((a, b) => (a.index || 0) - (b.index || 0));
        const remainingTotal = clamp2(Number(payload.amountTotal || 0) - paid.reduce((s, x) => s + Number(x.amount || 0), 0));
        if (open.length) {
          const even = clamp2(remainingTotal / open.length);
          for (let i = 0; i < open.length; i++) {
            const amt = (i === open.length - 1) ? clamp2(remainingTotal - even * (open.length - 1)) : even;
            await updateDoc(doc(db, `bills/${editId}/instalments/${open[i].id}`), { amount: amt });
          }
        }
        Modal.close("modal-bill");
      } else {
        const ref = await addDoc(collection(db, "bills"), payload);
        const count = payload.partsCount || 1;
        const per = payload.inParts ? (payload.partAmount || 0) : payload.amountTotal;
        for (let i = 1; i <= count; i++) {
          const amt = payload.inParts ? (i === count ? payload.lastPartAmount : per) : per;
          await addDoc(collection(db, `bills/${ref.id}/instalments`), {
            index: i, amount: amt, status: "open", paidAt: null, createdAt: serverTimestamp()
          });
        }
        Modal.close("modal-bill");
      }
    } catch (e) {
      console.error(e);
      Modal.alert({ title: "Opslaan mislukt", html: "Kon de rekening niet opslaan." });
    }
  };

  Modal.open("modal-bill");
}

/* ──────────────────────────────────────────────────────────────
   Inkomsten (add + edit + soft delete)
   ────────────────────────────────────────────────────────────── */
addIncomeBtn && (addIncomeBtn.onclick = () => openIncomeEdit(null));

function openIncomeEdit(incomeId = null) {
  const src = document.getElementById("income-source");
  const noteWrap = document.getElementById("income-note-wrap");
  const note = document.getElementById("income-note");
  const amt = document.getElementById("income-amount");
  const mon = document.getElementById("income-month");

  noteWrap.hidden = true;
  src.value = "Jo"; note.value = ""; amt.value = ""; mon.value = selectedMonth;

  if (incomeId) {
    const it = incomes.find(x => x.id === incomeId) || null;
    if (it) {
      src.value = it.source || "Andere";
      note.value = it.note || "";
      amt.value = Number(it.amount || 0);
      mon.value = it.month || selectedMonth;
      noteWrap.hidden = (src.value !== "Andere");
    }
  }

  src.onchange = () => { noteWrap.hidden = (src.value !== "Andere"); };

  document.getElementById("income-save").onclick = async () => {
    const payload = {
      uid: currentUser?.uid || null,
      source: src.value,
      note: (note.value || "").trim(),
      amount: clamp2(amt.value),
      month: monthKey(mon.value),
      updatedAt: serverTimestamp()
    };
    if (!payload.amount || !payload.month) {
      Modal.alert({ title: "Ontbrekende velden", html: "Vul minstens bedrag en maand in." });
      return;
    }
    if (incomeId) {
      await updateDoc(doc(db, "incomes", incomeId), payload);
    } else {
      await addDoc(collection(db, "incomes"), { ...payload, createdAt: serverTimestamp(), deleted: false });
    }
    Modal.close("modal-income");
  };

  // Verwijderen
  let del = document.getElementById("income-delete");
  if (!del) {
    del = document.createElement("button");
    del.id = "income-delete";
    del.className = "danger";
    del.textContent = "Verwijderen";
    const saveBtn = document.getElementById("income-save");
    saveBtn && saveBtn.parentElement && saveBtn.parentElement.appendChild(del);
  }
  del.onclick = async () => {
    if (!incomeId) return;
    if (!confirm("Deze inkomstenlijn verwijderen?")) return;
    await updateDoc(doc(db, "incomes", incomeId), { deleted: true, deletedAt: serverTimestamp() });
    Modal.close("modal-income");
  };

  Modal.open("modal-income");
}

/* ──────────────────────────────────────────────────────────────
   Vaste kosten (overzicht + snel toevoegen)
   ────────────────────────────────────────────────────────────── */
fixedCostsBtn && (fixedCostsBtn.onclick = () => openFixedModal({ stayOpen: false }));
fixedOverviewBtn && (fixedOverviewBtn.onclick = () => openFixedModal({ stayOpen: true }));

async function openFixedModal(opts = { stayOpen: false }) {
  const list = document.getElementById("fixedListModal");

  function renderList() {
    list.innerHTML = (fixedCosts.length ? "" : `<div class="muted">Nog geen vaste kosten.</div>`);
    fixedCosts
      .slice()
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .forEach(f => {
        const row = document.createElement("div");
        row.className = "row";
        const range = `${f.startMonth || "?"} ${f.endMonth ? "→ " + f.endMonth : "→ …"}`;
        row.innerHTML =
          `<span>${escapeHtml(f.name || "")} <span class="muted" style="margin-left:.5rem;">${range}</span></span>
           <strong>${euro(f.amount)}</strong>`;
        const actions = document.createElement("div");
        actions.style.display = "flex"; actions.style.gap = ".35rem"; actions.style.marginLeft = ".5rem";

        const edit = document.createElement("button");
        edit.className = "ghost"; edit.title = "Wijzig bedrag (vanaf maand)"; edit.textContent = "✎";
        edit.onclick = async () => {
          const newAmtStr = prompt(`Nieuw bedrag voor ${f.name}`, String(f.amount));
          if (newAmtStr == null || newAmtStr === "") return;
          const eff = prompt("Vanaf welke maand (YYYY-MM)?", selectedMonth);
          if (!eff) return;
          const newAmt = clamp2(newAmtStr);
          await updateDoc(doc(db, "fixedCosts", f.id), { endMonth: prevMonth(monthKey(eff)) });
          await addDoc(collection(db, "fixedCosts"), {
            uid: currentUser?.uid || null, name: f.name, amount: newAmt,
            startMonth: monthKey(eff), endMonth: null, createdAt: serverTimestamp()
          });
        };

        const stop = document.createElement("button");
        stop.className = "ghost"; stop.title = "Stoppen vanaf maand"; stop.textContent = "⛔";
        stop.onclick = async () => {
          const eff = prompt("Stoppen vanaf maand (YYYY-MM)?", selectedMonth);
          if (!eff) return;
          await updateDoc(doc(db, "fixedCosts", f.id), { endMonth: prevMonth(monthKey(eff)) });
        };

        actions.append(edit, stop);
        row.appendChild(actions);
        list.appendChild(row);
      });
  }

  renderList();

  // leeg formulier
  document.getElementById("fixed-name").value = "";
  document.getElementById("fixed-amount").value = "";
  document.getElementById("fixed-start").value = selectedMonth;
  document.getElementById("fixed-end").value = "";

  const saveBtn = document.getElementById("fixed-save");
  saveBtn.textContent = opts.stayOpen ? "Toevoegen" : "Opslaan";

  saveBtn.onclick = async () => {
    const name = (document.getElementById("fixed-name").value || "").trim();
    const amount = clamp2(document.getElementById("fixed-amount").value);
    const start = monthKey(document.getElementById("fixed-start").value);
    const endRaw = document.getElementById("fixed-end").value;
    const end = endRaw ? monthKey(endRaw) : null;
    if (!name || !amount || !start) {
      Modal.alert({ title: "Ontbrekende velden", html: "Vul naam, bedrag en startmaand in." });
      return;
    }
    await addDoc(collection(db, "fixedCosts"), { uid: currentUser?.uid || null, name, amount, startMonth: start, endMonth: end, createdAt: serverTimestamp() });

    if (opts.stayOpen) {
      // velden resetten en lijst verversen, modal open laten
      document.getElementById("fixed-name").value = "";
      document.getElementById("fixed-amount").value = "";
      document.getElementById("fixed-start").value = selectedMonth;
      document.getElementById("fixed-end").value = "";
      // kleine delay zodat onSnapshot fixedCosts kan updaten
      setTimeout(() => renderList(), 250);
    } else {
      Modal.close("modal-fixed");
    }
  };

  Modal.open("modal-fixed");
}

/* ──────────────────────────────────────────────────────────────
   Betalen
   ────────────────────────────────────────────────────────────── */
async function openPayModal(billId) {
  const b = bills.find(x => x.id === billId);
  if (!b) return;
  selectedBillId = billId;
  selectedPartIndex = null;

  const ctx = document.getElementById("payContext");
  ctx.innerHTML = `<div><strong>${escapeHtml(b.beneficiary || "")}</strong></div>
    <div>Openstaand: ${euro(clamp2(Number(b.amountTotal) - Number(b.paidAmount || 0)))}</div>`;

  const wrap = document.getElementById("payPartsWrap");
  wrap.innerHTML = "";

  if (b.inParts) {
    const snap = await getDocs(query(collection(db, `bills/${billId}/instalments`), where("status", "==", "open"), orderBy("index", "asc")));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!items.length) {
      wrap.innerHTML = `<div class="muted">Geen openstaande delen.</div>`;
    } else {
      const list = document.createElement("div");
      list.className = "list";
      items.forEach(it => {
        const row = document.createElement("label");
        row.className = "row";
        row.innerHTML = `<div><input type="radio" name="part" value="${it.id}" style="margin-right:.5rem;">Deel ${it.index}</div><strong>${euro(it.amount)}</strong>`;
        list.appendChild(row);
      });
      wrap.appendChild(list);
      const firstRadio = list.querySelector('input[type="radio"]');
      if (firstRadio) { firstRadio.checked = true; selectedPartIndex = firstRadio.value; }
      list.addEventListener("change", (e) => {
        const r = e.target.closest('input[type="radio"]');
        if (r) selectedPartIndex = r.value;
      });
    }
  } else {
    wrap.innerHTML = `<div class="muted">Enkelvoudige betaling. Dit zal het volledige resterende bedrag markeren als betaald.</div>`;
  }

  document.getElementById("pay-confirm").onclick = async () => {
    try {
      if (b.inParts) {
        if (!selectedPartIndex) { Modal.alert({ title: "Kies een deel", html: "Selecteer het deel dat je wil markeren als betaald." }); return; }
        const partRef = doc(db, `bills/${billId}/instalments/${selectedPartIndex}`);
        const partSnap = await getDoc(partRef);
        if (!partSnap.exists()) { Modal.alert({ title: "Niet gevonden", html: "Het gekozen deel bestaat niet meer." }); return; }
        const part = partSnap.data();
        await updateDoc(partRef, { status: "paid", paidAt: serverTimestamp() });
        const newPaid = clamp2(Number(b.paidAmount || 0) + Number(part.amount || 0));
        await updateDoc(doc(db, "bills", billId), { paidAmount: newPaid });
        await addDoc(collection(db, "transactions"), { uid: currentUser?.uid || null, billId, instalmentId: selectedPartIndex, amount: part.amount, at: serverTimestamp() });
        const remaining = clamp2(Number(b.amountTotal || 0) - newPaid);
        if (remaining <= 0) await updateDoc(doc(db, "bills", billId), { closedAt: serverTimestamp() });
      } else {
        const remaining = clamp2(Number(b.amountTotal || 0) - Number(b.paidAmount || 0));
        if (remaining <= 0) { Modal.close("modal-pay"); return; }
        const billRef = doc(db, "bills", billId);
        await updateDoc(billRef, { paidAmount: clamp2(Number(b.paidAmount || 0) + remaining) });
        const partsSnap = await getDocs(collection(db, `bills/${billId}/instalments`));
        const open = partsSnap.docs.find(d => (d.data().status === "open"));
        if (open) await updateDoc(doc(db, `bills/${billId}/instalments/${open.id}`), { status: "paid", paidAt: serverTimestamp() });
        await addDoc(collection(db, "transactions"), { uid: currentUser?.uid || null, billId, instalmentId: open ? open.id : null, amount: remaining, at: serverTimestamp() });
        await updateDoc(billRef, { closedAt: serverTimestamp() });
      }
      Modal.close("modal-pay");
    } catch (e) {
      console.error(e);
      Modal.alert({ title: "Mislukt", html: "Markeren als betaald is niet gelukt." });
    }
  };

  Modal.open("modal-pay");
}

/* ──────────────────────────────────────────────────────────────
   Historiek (transactions) – bestaande
   ────────────────────────────────────────────────────────────── */
const historyBtn = document.getElementById("historyBtn");
historyBtn && (historyBtn.onclick = async () => {
  const body = document.getElementById("historyBody");
  body.innerHTML = "";
  const snap = await getDocs(query(collection(db, "transactions"), orderBy("at", "desc")));
  const txs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  for (const tx of txs.slice(0, 200)) {
    let name = "", idx = "";
    try {
      const b = await getDoc(doc(db, "bills", tx.billId));
      name = b.exists() ? (b.data().beneficiary || "") : "(onbekend)";
      if (tx.instalmentId) {
        const p = await getDoc(doc(db, `bills/${tx.billId}/instalments/${tx.instalmentId}`));
        idx = p.exists() ? String(p.data().index || "") : "";
      }
    } catch { }
    const tr = document.createElement("tr");
    const dt = tx.at?.seconds ? new Date(tx.at.seconds * 1000) : new Date();
    const dateStr = dt.toLocaleString("nl-BE");
    tr.innerHTML = `<td>${escapeHtml(dateStr)}</td><td>${escapeHtml(name)}</td><td>${escapeHtml(idx)}</td><td>${euro(tx.amount)}</td>`;
    body.appendChild(tr);
  }
  Modal.open("modal-history");
});

/* ──────────────────────────────────────────────────────────────
   Afsluiten / volwaardig betalen (quick)
   ────────────────────────────────────────────────────────────── */
async function settleAsFull(billId) {
  const b = bills.find(x => x.id === billId);
  if (!b) return;
  const remaining = clamp2(Number(b.amountTotal || 0) - Number(b.paidAmount || 0));
  if (remaining <= 0) return;

  const ctx = document.getElementById("payContext");
  const wrap = document.getElementById("payPartsWrap");
  if (ctx && wrap) {
    ctx.innerHTML = `<div><strong>${escapeHtml(b.beneficiary || "")}</strong></div>
      <div>Openstaand: ${euro(remaining)}</div>`;
    wrap.innerHTML = `<div class="muted">Dit markeert het volledige resterende bedrag als betaald.</div>`;
    document.getElementById("pay-confirm").onclick = async () => {
      try {
        await updateDoc(doc(db, "bills", billId), { paidAmount: clamp2(Number(b.paidAmount || 0) + remaining) });
        const partsSnap = await getDocs(collection(db, `bills/${billId}/instalments`));
        for (const d of partsSnap.docs) {
          if (d.data().status === "open") {
            await updateDoc(doc(db, `bills/${billId}/instalments/${d.id}`), { status: "paid", paidAt: serverTimestamp() });
          }
        }
        await addDoc(collection(db, "transactions"), { uid: currentUser?.uid || null, billId, instalmentId: null, amount: remaining, at: serverTimestamp() });
        await updateDoc(doc(db, "bills", billId), { closedAt: serverTimestamp() });
        Modal.close("modal-pay");
      } catch (e) {
        console.error(e);
        Modal.alert({ title: "Mislukt", html: "Markeren als betaald is niet gelukt." });
      }
    };
    Modal.open("modal-pay");
  }
}

/* ──────────────────────────────────────────────────────────────
   Betaaloverzicht (review modal)
   ────────────────────────────────────────────────────────────── */
clearSelectedBtn && (clearSelectedBtn.onclick = () => {
  selected.clear();
  billsBody.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  selectChanged();
});

payReviewBtn && (payReviewBtn.onclick = () => {
  const body = document.getElementById("reviewBody");
  body.innerHTML = "";
  for (const [key, it] of selected.entries()) {
    const tr = document.createElement("tr");
    const ben = document.createElement("td"); ben.textContent = it.label.split(" – ")[0] || "";
    const iban = document.createElement("td"); { const b = bills.find(x => x.id === it.billId); iban.textContent = (b && b.iban) ? b.iban : (it.iban || ""); }
    const amt = document.createElement("td"); amt.textContent = euro(it.amount);
    const commTd = document.createElement("td");
    const b = bills.find(x => x.id === it.billId);
    commTd.textContent = (b && (b.communication || b.description || "")) || "";
    const paidTd = document.createElement("td");
    const chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = true;
    paidTd.appendChild(chk);

    tr.dataset.key = key;
    tr.append(ben, iban, amt, commTd, paidTd);
    body.appendChild(tr);
  }
  Modal.open("modal-review");
});

document.getElementById("review-confirm") && (document.getElementById("review-confirm").onclick = async () => {
  const rows = Array.from(document.querySelectorAll("#reviewBody tr"));
  if (!rows.length) { Modal.alert({ title: "Geen selectie", html: "Er staan geen items in het overzicht." }); return; }

  try {
    for (const tr of rows) {
      const key = tr.dataset.key;
      const paidChk = tr.querySelector('input[type="checkbox"]');
      const paid = paidChk ? paidChk.checked : false;
      if (!paid) continue;

      const it = selected.get(key);
      if (!it) continue;

      const b = bills.find(x => x.id === it.billId);
      if (!b) continue;

      const noteCell = tr.children[3];
      const noteFromCell = noteCell ? (noteCell.textContent || "").trim() : "";
      const note = noteFromCell || b.communication || b.description || "";

      if (it.type === "part") {
        const partRef = doc(db, `bills/${it.billId}/instalments/${it.instalmentId}`);
        await updateDoc(partRef, { status: "paid", paidAt: serverTimestamp() });
        const newPaid = clamp2(Number(b.paidAmount || 0) + Number(it.amount || 0));
        await updateDoc(doc(db, "bills", it.billId), { paidAmount: newPaid });
        await addDoc(collection(db, "transactions"), { uid: currentUser?.uid || null, billId: it.billId, instalmentId: it.instalmentId, amount: it.amount, note, at: serverTimestamp() });
        const remaining = clamp2(Number(b.amountTotal || 0) - newPaid);
        if (remaining <= 0) await updateDoc(doc(db, "bills", it.billId), { closedAt: serverTimestamp() });
      } else {
        const remaining = clamp2(Number(b.amountTotal || 0) - Number(b.paidAmount || 0));
        if (remaining > 0) {
          await updateDoc(doc(db, "bills", it.billId), { paidAmount: clamp2(Number(b.paidAmount || 0) + remaining) });
          const partsSnap = await getDocs(collection(db, `bills/${it.billId}/instalments`));
          for (const d of partsSnap.docs) {
            if (d.data().status === "open") {
              await updateDoc(doc(db, `bills/${it.billId}/instalments/${d.id}`), { status: "paid", paidAt: serverTimestamp() });
            }
          }
          await addDoc(collection(db, "transactions"), { uid: currentUser?.uid || null, billId: it.billId, instalmentId: null, amount: remaining, note, at: serverTimestamp() });
          await updateDoc(doc(db, "bills", it.billId), { closedAt: serverTimestamp() });
        }
      }
    }

    Modal.close("modal-review");
    Modal.toast && Modal.toast({ html: "Aangevinkte betalingen zijn gemarkeerd als betaald." });
  } catch (e) {
    console.error(e);
    Modal.alert({ title: "Mislukt", html: "Niet alle betalingen konden gemarkeerd worden." });
  }
});

/* ──────────────────────────────────────────────────────────────
   Utils
   ────────────────────────────────────────────────────────────── */
function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
