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

// Detecteer omgeving (veilig)
const IS_DEV = (window.APP_ENV === "DEV");

/* ────────────────────────────────────────────────────────────────────────────
   2. DEV Environment & Debug Panel
   ──────────────────────────────────────────────────────────────────────────── */
let devDebugPanelEl = null;

function initEnvironment() {
    // Check of body bestaat (veiligheid)
    if (!document.body) {
        console.warn("Body nog niet geladen, retrying...");
        return; 
    }

    if (IS_DEV) {
        // 1. Voeg class toe aan body voor CSS (de rode balk)
        document.body.classList.add("env-dev");
        
        // 2. Toon panel
        initDebugPanel();
        console.log("🚧 Running in DEV mode");
    } else {
        document.body.classList.add("env-main");
    }
}

function initDebugPanel() {
    if (document.getElementById("dev-debug-panel")) return;

    devDebugPanelEl = document.createElement("div");
    devDebugPanelEl.id = "dev-debug-panel";
    
    // Hardcoded styles zodat we zeker weten dat het zichtbaar is (ook zonder CSS)
    Object.assign(devDebugPanelEl.style, {
        position: "fixed", 
        left: "10px", 
        bottom: "10px", 
        padding: "6px 10px",
        fontSize: "12px", 
        fontWeight: "bold",
        backgroundColor: "#b91c1c", // Rood
        color: "#ffffff",
        borderRadius: "6px", 
        zIndex: "99999", 
        pointerEvents: "none",
        boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
        fontFamily: "monospace"
    });
    
    devDebugPanelEl.textContent = "DEV MODE WORDT GELADEN...";
    document.body.appendChild(devDebugPanelEl);
    
    // Probeer meteen te updaten als user al bekend is
    if (window.App && window.App.currentUser) {
        updateDebugPanel(window.App.currentUser);
    }
}

function updateDebugPanel(user) {
    if (!IS_DEV || !devDebugPanelEl) return;

    const projectId = firebaseConfig.projectId || "nvt";
    const uid = user && user.uid ? `${user.uid.substring(0,5)}...` : "Niet ingelogd";
    const email = user && user.email ? user.email : "-";

    devDebugPanelEl.textContent = `🛠️ DEV | ${projectId} | ${email} (${uid})`;
}

// Migratie tool (alleen in DEV)
if (IS_DEV) {
    window.devMigrateUid = async function (oldUid, newUid) {
        console.log("Start UID migratie", { oldUid, newUid });
        // (Logica ingekort)
        console.log("UID migratie placeholder");
    };
}

/* ────────────────────────────────────────────────────────────────────────────
   3. Global State
   ──────────────────────────────────────────────────────────────────────────── */
window.App = {
    db, auth, currentUser: null, config: firebaseConfig, isDev: IS_DEV,
    login: () => signInWithPopup(auth, provider),
    logout: () => signOut(auth)
};

/* ────────────────────────────────────────────────────────────────────────────
   4. Auth
   ──────────────────────────────────────────────────────────────────────────── */
function initAuth() {
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
        
        const authDiv = document.getElementById("auth");
        const appDiv = document.getElementById("app");
        if (authDiv) authDiv.style.display = user ? "none" : "block";
        if (appDiv) appDiv.style.display = user ? "block" : "none";

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

/* ────────────────────────────────────────────────────────────────────────────
   5. BOOTSTRAP (De fix voor jouw probleem)
   ──────────────────────────────────────────────────────────────────────────── */
function bootstrap() {
    // Wacht tot de DOM volledig geladen is
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            initEnvironment();
            initAuth();
        });
    } else {
        // Pagina was al klaar
        initEnvironment();
        initAuth();
    }
}

bootstrap();