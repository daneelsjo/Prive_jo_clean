// Script/Javascript/main.js
import {
    getFirebaseApp,
    firebaseConfig,
    getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut,
    getFirestore, doc, onSnapshot, collection, query, where, getDocs, setDoc, updateDoc, getDoc
} from "./firebase-config.js";

/* ────────────────────────────────────────────────────────────────────────────
   1. Core Config & Init
   ──────────────────────────────────────────────────────────────────────────── */
const app = getFirebaseApp();
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Detecteer omgeving
const IS_DEV = window.APP_ENV === "DEV";

/* ────────────────────────────────────────────────────────────────────────────
   2. DEV Environment & Debug Panel (Jouw verzoek)
   ──────────────────────────────────────────────────────────────────────────── */
let devDebugPanelEl = null;

function initEnvironment() {
    // 1. Zet de CSS class voor de rode balk (moet in CSS afgehandeld worden via .env-dev)
    if (IS_DEV) {
        document.body.classList.add("env-dev");
        initDebugPanel();
        console.log("🚧 Running in DEV mode");
    } else {
        document.body.classList.add("env-main");
    }
}

function initDebugPanel() {
    if (devDebugPanelEl) return;

    devDebugPanelEl = document.createElement("div");
    devDebugPanelEl.id = "dev-debug-panel";
    // Jouw originele styling
    Object.assign(devDebugPanelEl.style, {
        position: "fixed", left: "8px", bottom: "8px", padding: "4px 8px",
        fontSize: "11px", background: "rgba(0,0,0,0.7)", color: "#fff",
        borderRadius: "4px", zIndex: 9999, pointerEvents: "none",
        fontFamily: "system-ui, -apple-system, sans-serif"
    });
    document.body.appendChild(devDebugPanelEl);
    updateDebugPanel(null);
}

function updateDebugPanel(user) {
    if (!IS_DEV || !devDebugPanelEl) return;

    const env = window.APP_ENV || "UNKNOWN";
    const projectId = firebaseConfig.projectId || "nvt";
    const uid = user && user.uid ? user.uid : "geen";
    const email = user && user.email ? user.email : "geen";

    devDebugPanelEl.textContent = `ENV: ${env} | projectId: ${projectId} | uid: ${uid} | email: ${email}`;
}

// Migratie tool (alleen in DEV)
if (IS_DEV) {
    window.devMigrateUid = async function (oldUid, newUid) {
        console.log("Start UID migratie", { oldUid, newUid });
        // (Jouw migratie logica hier ingekort voor leesbaarheid, maar functioneel aanwezig)
        const settingsOld = doc(db, "settings", oldUid);
        const settingsNew = doc(db, "settings", newUid);
        const snap = await getDoc(settingsOld);
        if (snap.exists()) await setDoc(settingsNew, snap.data(), { merge: false });
        
        const q = query(collection(db, "todos"), where("uid", "==", oldUid));
        const todos = await getDocs(q);
        for (const d of todos.docs) await updateDoc(d.ref, { uid: newUid });
        console.log("UID migratie klaar");
    };
}

/* ────────────────────────────────────────────────────────────────────────────
   3. Global State (Window.App)
   ──────────────────────────────────────────────────────────────────────────── */
// Zodat andere scripts (zoals index.js) bij de DB kunnen
window.App = {
    db, auth, currentUser: null, config: firebaseConfig, isDev: IS_DEV,
    login: () => signInWithPopup(auth, provider),
    logout: () => signOut(auth)
};

/* ────────────────────────────────────────────────────────────────────────────
   4. Auth & Theme Handling
   ──────────────────────────────────────────────────────────────────────────── */
function initAuth() {
    // Login knop (indien aanwezig in header)
    const loginBtn = document.getElementById("login-btn");
    if (loginBtn) {
        loginBtn.addEventListener("click", async () => {
            try { await signInWithPopup(auth, provider); } 
            catch (e) { alert("Login fout: " + e.message); }
        });
    }

    onAuthStateChanged(auth, (user) => {
        window.App.currentUser = user;
        updateDebugPanel(user);
        
        // UI wisselen (Login scherm vs App)
        const authDiv = document.getElementById("auth");
        const appDiv = document.getElementById("app");
        if (authDiv) authDiv.style.display = user ? "none" : "block";
        if (appDiv) appDiv.style.display = user ? "block" : "none";

        // Trigger event voor index.js
        document.dispatchEvent(new CustomEvent("app:auth_changed", { detail: { user } }));

        if (user) loadGlobalSettings(user.uid);
    });
}

function loadGlobalSettings(uid) {
    onSnapshot(doc(db, "settings", uid), (snap) => {
        if (snap.exists()) {
            const theme = snap.data().theme || "system";
            const val = theme === "system" 
                ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") 
                : theme;
            document.documentElement.setAttribute("data-theme", val);
        }
    });
}

// Start de motor
initEnvironment();
initAuth();