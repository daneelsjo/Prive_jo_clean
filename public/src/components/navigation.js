// src/components/navigation.js

console.log("🚦 Navigation.js bestand geladen");

// --- GLOBAL STATE ---
// Deze variabele voorkomt dat het script 2x start (en dus 2x klikt)
let navigationInitialized = false;

const REPORT_ISSUE_URL = "https://us-central1-prive-jo.cloudfunctions.net/reportIssue";

/**
 * 1. PADEN FIXEN
 */
function getPathPrefix() {
    const path = window.location.pathname;
    if (path.includes("/src/modules/") || path.includes("/HTML/")) {
        return "../../../";
    }
    return "";
}

function fixPaths() {
    const prefix = getPathPrefix();
    if (!prefix) return;

    document.querySelectorAll("a[data-internal]").forEach(link => {
        const href = link.getAttribute("href");
        if (href && !href.startsWith("http") && !href.startsWith(prefix) && !href.startsWith("#") && !href.startsWith("mailto")) {
            link.setAttribute("href", prefix + href);
        }
    });

    document.querySelectorAll("img[data-fix-path]").forEach(img => {
        const src = img.getAttribute("src");
        if (src && !src.startsWith("http") && !src.startsWith(prefix)) {
            img.setAttribute("src", prefix + src);
        }
    });
}

/**
 * 2. KLIK AFHANDELING
 */
function initGlobalClicks() {
    // Verwijder eerst eventuele oude listeners om zeker te zijn (hoewel de flag dit ook al doet)
    // Maar document.removeEventListener werkt lastig met anonieme functies, dus we vertrouwen op de 'navigationInitialized' flag.

    document.addEventListener("click", (e) => {
        
        // A. HAMBURGER (Sidebar openen)
        const btn = e.target.closest("#hamburgerBtn");
        if (btn) {
            e.preventDefault(); 
            e.stopPropagation();
            toggleSidebar();
            return;
        }

        // B. BACKDROP (Sidebar sluiten)
        const bd = e.target.closest("#sidemenu-backdrop");
        if (bd) {
            toggleSidebar(false);
            return;
        }

        // C. LOGO
        const brand = e.target.closest("#brandLogo");
        if (brand) {
            const prefix = getPathPrefix();
            window.location.href = prefix + "index.html"; 
            return;
        }

        // D. SIDEBAR ACCORDEON
        const header = e.target.closest(".sidemenu-section h4");
        if (header) {
            const section = header.parentElement;
            section.classList.toggle("open");
            return;
        }
    });

    // Escape toets
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") toggleSidebar(false);
    });
}

/**
 * HELPER: Toggle
 */
function toggleSidebar(forceState = null) {
    const sidemenu = document.getElementById("sidemenu");
    const backdrop = document.getElementById("sidemenu-backdrop");
    const hamburger = document.getElementById("hamburgerBtn");

    if (!sidemenu) return;

    const currentState = sidemenu.getAttribute("data-state") === "open";
    const newState = forceState !== null ? forceState : !currentState;

    console.log("👉 Toggle Sidebar actie:", newState ? "OPEN" : "DICHT");

    sidemenu.setAttribute("data-state", newState ? "open" : "closed");
    sidemenu.setAttribute("aria-hidden", String(!newState));
    
    if (hamburger) hamburger.setAttribute("aria-expanded", String(newState));
    
    if (backdrop) {
        backdrop.hidden = !newState;
        backdrop.style.display = newState ? "block" : "none";
    }

    document.body.style.overflow = newState ? "hidden" : "";
}

/**
 * 3. DROPDOWN MENU
 */
function initTopMenu() {
    setTimeout(() => {
        const dropdowns = document.querySelectorAll(".mainnav .has-submenu");
        dropdowns.forEach(item => {
            let closeTimer;
            item.addEventListener("mouseenter", () => {
                clearTimeout(closeTimer);
                dropdowns.forEach(o => o !== item && o.classList.remove("open"));
                item.classList.add("open");
            });
            item.addEventListener("mouseleave", () => {
                closeTimer = setTimeout(() => item.classList.remove("open"), 300);
            });
        });
    }, 200);
}

/**
 * 4. NEW TABS
 */
function enforceNewTabs() {
    const links = document.querySelectorAll(".mainnav a, .sidemenu-section a");
    links.forEach(link => {
        const href = link.getAttribute("href");
        if (!href) return;
        if (link.hasAttribute("data-newtab") || (href.startsWith("http") && !href.includes(window.location.hostname))) {
            link.setAttribute("target", "_blank");
            link.setAttribute("rel", "noopener noreferrer");
        }
    });
}

/**
 * 5. QUICK LINKS
 */
function renderQuickLinks() {
    const container = document.getElementById("quickLinks");
    if (!container) return;

    const prefix = getPathPrefix();
    const definitions = [
        { icon: "📝", title: "Sticknotes", href: "src/modules/sticknotes/sticknotes.html" },
        { icon: "⏱️", title: "Tijd",       href: "src/modules/time/time.html" },
        { icon: "⚙️",  title: "Settings",   href: "src/modules/settings/settings.html" },
        { icon: "🗓️", title: "Planner",    href: "src/modules/planner/plan.html" },
        { icon: "📬", title: "Agenda",     href: "src/modules/agendabuilder/agendabuilder.html" },
        { icon: "🔀", title: "Workflow",   href: "src/modules/workflow/workflow.html" }
    ];

    container.innerHTML = "";
    definitions.forEach(def => {
        const a = document.createElement("a");
        a.href = prefix + def.href; 
        a.className = "icon-btn header-link";
        a.textContent = def.icon;
        a.title = def.title;
        a.style.textDecoration = "none";
        a.style.fontSize = "1.2rem";
        a.style.marginLeft = "10px";
        container.appendChild(a);
    });

    const btn = document.createElement("button");
    btn.id = "report-issue-btn";
    btn.className = "icon-btn header-link";
    btn.textContent = "🐞";
    btn.title = "Probleem melden";
    btn.style.marginLeft = "10px";
    btn.style.background = "transparent"; btn.style.border = "none"; btn.style.fontSize = "1.2rem"; btn.style.cursor = "pointer";
    container.appendChild(btn);
}

function initIssueReportModal() {
    document.addEventListener("click", (e) => {
        if(e.target.closest("#report-issue-btn") && window.Modal) {
            window.Modal.open("modal-report-issue");
        }
    });
}

/**
 * HOOFD START FUNCTIE (Met beveiliging!)
 */
function bootstrapNavigation() {
    // BEVEILIGING: Als we al gestart zijn, stop direct!
    if (navigationInitialized) {
        console.log("⚠️ Navigation reeds gestart, overslaan...");
        return;
    }
    navigationInitialized = true; // Markeer als gestart

    console.log("🚀 Navigation Bootstrap start...");
    fixPaths();
    initGlobalClicks();
    initTopMenu();
    renderQuickLinks();
    initIssueReportModal();
    enforceNewTabs();
}

// 1. Luister naar het event
document.addEventListener("partials:loaded", bootstrapNavigation);

// 2. Fallback timer
if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(bootstrapNavigation, 100);
} else {
    document.addEventListener("DOMContentLoaded", bootstrapNavigation);
}