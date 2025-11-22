// Script/Javascript/main.js
import {
    getFirebaseApp,
    firebaseConfig,
    getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut,
    getFirestore, doc, onSnapshot
} from "./firebase-config.js";

/* ────────────────────────────────────────────────────────────────────────────
   1. Core Setup
   ──────────────────────────────────────────────────────────────────────────── */
const app = getFirebaseApp();
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const IS_DEV = window.APP_ENV === "DEV";

// Maak globals beschikbaar voor debuggen en andere scripts
window.App = {
    db, auth, currentUser: null, config: firebaseConfig, isDev: IS_DEV,
    login: () => signInWithPopup(auth, provider),
    logout: () => signOut(auth)
};

/* ────────────────────────────────────────────────────────────────────────────
   2. DEV Environment & Debug Panel (De Rode Balk & Info)
   ──────────────────────────────────────────────────────────────────────────── */
function initEnvironment() {
    document.body.classList.add(IS_DEV ? "env-dev" : "env-main");
    if (IS_DEV) {
        initDebugPanel();
        console.log("🚧 Running in DEV mode");
    }
}

let devPanelEl = null;
function initDebugPanel() {
    if (document.getElementById("dev-debug-panel")) return;
    
    devPanelEl = document.createElement("div");
    devPanelEl.id = "dev-debug-panel";
    // Inline styles voor zekerheid, mag ook in CSS
    Object.assign(devPanelEl.style, {
        position: "fixed", left: "8px", bottom: "8px", padding: "4px 8px",
        fontSize: "11px", background: "rgba(0,0,0,0.7)", color: "#fff",
        borderRadius: "4px", zIndex: 9999, fontFamily: "sans-serif", pointerEvents: "none"
    });
    document.body.appendChild(devPanelEl);
    updateDebugPanel(null);
}

function updateDebugPanel(user) {
    if (!devPanelEl) return;
    const uid = user ? user.uid : "geen";
    const email = user ? user.email : "-";
    devPanelEl.textContent = `ENV: ${window.APP_ENV || "PROD"} | Proj: ${firebaseConfig.projectId} | UID: ${uid.substring(0,6)}... | User: ${email}`;
}

/* ────────────────────────────────────────────────────────────────────────────
   3. Auth & Global UI
   ──────────────────────────────────────────────────────────────────────────── */
function initAuth() {
    // Login knop (indien aanwezig op pagina)
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
        
        // Event voor specifieke pagina scripts (zoals index.js)
        document.dispatchEvent(new CustomEvent("app:auth_changed", { detail: { user } }));

        handleAuthUI(user);
        
        if (user) {
            // Redirect check (behalve op DEV)
            const ownerUids = ["KNjbJuZV1MZMEUQKsViehVhW3832", "RraloFcyZoSGHNRwY9pmBBoszCR2"];
            const isOwner = ownerUids.includes(user.uid);
            if (!IS_DEV && !isOwner && !location.pathname.endsWith("/plan.html")) {
                // Uncomment als je redirect weer aan wilt
                // location.replace("../HTML/plan.html"); 
            }
            loadGlobalSettings(user.uid);
        }
    });
}

function handleAuthUI(user) {
    const authDiv = document.getElementById("auth");
    const appDiv = document.getElementById("app");
    if (authDiv) authDiv.style.display = user ? "none" : "block";
    if (appDiv) appDiv.style.display = user ? "block" : "none";
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

// Start alles
initEnvironment();
initAuth();