// Script/Javascript/notes.js
window.DEBUG = true;
const log = (...a) => window.DEBUG && console.log(...a);

import {
    getFirebaseApp,
    // Auth
    getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged,
    // Firestore
    getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc,
    query, where, orderBy
} from "./firebase-config.js";

/* ────────────────────────────────────────────────────────────────────────────
   Firebase
   ──────────────────────────────────────────────────────────────────────────── */
const app = getFirebaseApp();
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

/* ────────────────────────────────────────────────────────────────────────────
   State & DOM refs
   ──────────────────────────────────────────────────────────────────────────── */
let currentUser = null;
let notes = [];            // {id, title, body, when, type: "werk"|"prive", link, uid, ...}
let currentMode = "werk";  // "werk" | "prive"

const loginBtn = document.getElementById("login-btn");
const authDiv = document.getElementById("auth");
const appDiv = document.getElementById("app");
const modeSwitch = document.getElementById("modeSwitch");

const newNoteBtn = document.getElementById("newNoteBtn");
const notesBody = document.getElementById("notesBody");

/* ────────────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────────────── */
function tsToDate(x) {
    if (!x) return null;
    if (x instanceof Date) return x;
    if (typeof x === "string") return new Date(x);
    if (typeof x === "number") return new Date(x);
    if (x.seconds) return new Date(x.seconds * 1000);
    return null;
}
function toInputLocal(d) {
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 16);
}
function formatLocalDatetime(ts) {
    const d = tsToDate(ts);
    return d ? d.toLocaleString("nl-BE") : "";
}
function escapeHtml(s = "") {
    return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ────────────────────────────────────────────────────────────────────────────
   Auth
   ──────────────────────────────────────────────────────────────────────────── */
if (loginBtn) loginBtn.onclick = () => signInWithPopup(auth, provider);

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        currentUser = null;
        if (appDiv) appDiv.style.display = "none";
        if (authDiv) authDiv.style.display = "block";
        return;
    }

    currentUser = user;
    if (authDiv) authDiv.style.display = "none";
    if (appDiv) appDiv.style.display = "block";

    // Settings (thema + preferredMode)
    onSnapshot(doc(db, "settings", currentUser.uid), (snap) => {
        const s = snap.exists() ? (snap.data() || {}) : {};
        // Theme (globaal via helper uit menu.js)
        window.Theme?.set(s.theme || "system");
        // Mode
        currentMode = s.preferredMode || "werk";
        if (modeSwitch) modeSwitch.checked = (currentMode === "prive");
        renderNotes(); // herteken bij wijziging
    });

    // Notes stream — filter minimaal op uid (server-side); type filteren we client-side
    const qNotes = query(collection(db, "notes"), where("uid", "==", currentUser.uid));
    onSnapshot(qNotes, (snap) => {
        notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderNotes(); // in renderNotes sorteren we al op 'when' desc
    });

});

/* ────────────────────────────────────────────────────────────────────────────
   UI: mode switch & nieuw
   ──────────────────────────────────────────────────────────────────────────── */
if (modeSwitch) {
    modeSwitch.onchange = async () => {
        currentMode = modeSwitch.checked ? "prive" : "werk";
        if (currentUser) {
            await updateDoc(doc(db, "settings", currentUser.uid), { preferredMode: currentMode });
        }
        renderNotes();
    };
}

if (newNoteBtn) {
    newNoteBtn.onclick = () => openNoteModal(null);
}

/* ────────────────────────────────────────────────────────────────────────────
   Render
   ──────────────────────────────────────────────────────────────────────────── */
function renderNotes() {
    if (!notesBody) return;

    // filter op huidige modus; oude notities zonder 'type' behandelen als 'werk'
    const list = notes
        .filter(n => (n.type || "werk") === currentMode)
        .slice()
        .sort((a, b) => {
            const ta = tsToDate(a.when)?.getTime() || 0;
            const tb = tsToDate(b.when)?.getTime() || 0;
            return tb - ta; // desc
        });

    notesBody.innerHTML = list.map(n => {
        const when = formatLocalDatetime(n.when);
        return `
      <tr data-id="${n.id}">
        <td>${escapeHtml(when)}</td>
        <td>${escapeHtml(n.title || "(zonder titel)")}</td>
      </tr>
    `;
    }).join("");

    // rij-klik = bewerken
    notesBody.querySelectorAll("tr").forEach(tr => {
        tr.onclick = () => {
            const id = tr.getAttribute("data-id");
            const note = notes.find(x => x.id === id);
            if (note) openNoteModal(note);
        };
    });
}

/* ────────────────────────────────────────────────────────────────────────────
   Modal (nieuw/bewerken)
   ──────────────────────────────────────────────────────────────────────────── */
function bindOnce(el, ev, fn) {
    if (!el) return;
    const key = `__bound_${ev}`;
    if (el[key]) return;
    el.addEventListener(ev, fn);
    el[key] = true;
}

function openNoteModal(note = null) {
    const titleEl = document.getElementById('modal-note-title');
    const t = document.getElementById('note-title');
    const ty = document.getElementById('note-type');   // "werk" | "prive"
    const w = document.getElementById('note-when');   // datetime-local
    const b = document.getElementById('note-body');   // textarea
    const link = document.getElementById('note-link');   // url
    const open = document.getElementById('note-link-open');
    const save = document.getElementById('note-save');
    const del = document.getElementById('note-delete');
    const cancel = document.getElementById('note-cancel');

    if (!t || !ty || !w || !b || !link || !open || !save) {
        console.error("Modal-note velden niet gevonden; controleer partials/modals.html");
        return;
    }

    if (note) {
        titleEl.textContent = "Notitie bewerken";
        t.value = note.title || "";
        ty.value = (note.type || "werk");
        b.value = note.body || "";
        link.value = note.link || "";
        if (note.when) {
            const d = tsToDate(note.when);
            w.value = d ? toInputLocal(d) : "";
        } else {
            w.value = "";
        }
        del.style.display = ""; // tonen
    } else {
        titleEl.textContent = "Nieuwe notitie";
        t.value = ""; b.value = ""; link.value = "";
        ty.value = currentMode; // vooraf vullen met huidige modus
        w.value = "";
        if (del) del.style.display = "none";
    }

    // Open link
    bindOnce(open, "click", () => {
        const raw = (link.value || "").trim();
        if (!raw) return;
        const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        window.open(url, "_blank", "noopener");
    });

    // Opslaan
    save.onclick = async () => {
        const payload = {
            title: (t.value || "").trim(),
            type: ty.value === "prive" ? "prive" : "werk",
            body: (b.value || "").trim(),
            link: (link.value || "").trim(),
            when: w.value ? new Date(w.value) : null
        };
        if (!payload.title) {
            Modal.alert({ title: "Titel vereist", html: "Vul een titel in." });
            return;
        }
        try {
            if (note) {
                await updateDoc(doc(db, "notes", note.id), { ...payload, updatedAt: new Date() });
            } else {
                await addDoc(collection(db, "notes"), { ...payload, uid: currentUser?.uid || null, createdAt: new Date() });
            }
            Modal.close("modal-note");
        } catch (err) {
            console.error(err);
            Modal.alert({ title: "Opslaan mislukt", html: "Kon de notitie niet opslaan." });
        }
    };

    // Verwijderen
    if (del) {
        del.onclick = async () => {
            if (!note) return;
            if (!confirm("Notitie verwijderen?")) return;
            await deleteDoc(doc(db, "notes", note.id));
            Modal.close("modal-note");
        };
    }

    // Annuleren → sluit zonder opslaan
    if (cancel) {
        cancel.onclick = () => Modal.close("modal-note");
    }

    Modal.open('modal-note');
}

// expose (optioneel)
window.openNoteModal = openNoteModal;
