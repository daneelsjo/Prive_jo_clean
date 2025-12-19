// src/components/navigation.js

console.log("🚦 Navigation.js bestand geladen");

// --- STATE ---
let listenersInitialized = false; // Voorkomt dubbele klik-events

const REPORT_ISSUE_URL = "https://us-central1-prive-jo.cloudfunctions.net/reportIssue";

/**
 * 1. PADEN FIXEN (DOM Modificatie)
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
        if (href && !href.startsWith("http") && !href.startsWith("#") && !href.startsWith("mailto")) {
            if (!href.startsWith(prefix)) {
                link.setAttribute("href", prefix + href);
            }
        }
    });

    document.querySelectorAll("img[data-fix-path]").forEach(img => {
        const src = img.getAttribute("src");
        if (src && !src.startsWith("http")) {
            if (!src.startsWith(prefix)) {
                img.setAttribute("src", prefix + src);
            }
        }
    });
}

/**
 * 2. KLIK AFHANDELING (Global Listeners)
 */
function initGlobalListeners() {
    if (listenersInitialized) return;
    listenersInitialized = true;

    console.log("👂 Global Listeners geactiveerd");

    document.addEventListener("click", (e) => {
        // A. HAMBURGER
        const btn = e.target.closest("#hamburgerBtn");
        if (btn) {
            e.preventDefault(); e.stopPropagation();
            toggleSidebar();
            return;
        }

        // B. BACKDROP
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
            header.parentElement.classList.toggle("open");
            return;
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") toggleSidebar(false);
    });
}

function toggleSidebar(forceState = null) {
    const sidemenu = document.getElementById("sidemenu");
    const backdrop = document.getElementById("sidemenu-backdrop");
    const hamburger = document.getElementById("hamburgerBtn");

    if (!sidemenu) return;

    const currentState = sidemenu.getAttribute("data-state") === "open";
    const newState = forceState !== null ? forceState : !currentState;

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
 * 3. UI INITIALISATIE
 */
function initUIComponents() {
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
        { icon: "🔀", title: "Workflow",   href: "src/modules/Workflow/workflow.html" }
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

// --- ISSUE REPORTING LOGICA (Toegevoegd) ---

function gatherIssueContext() {
    return {
        env: window.APP_ENV || "UNKNOWN",
        url: window.location.href,
        title: document.title || "",
        userAgent: navigator.userAgent || "",
        screen: `${window.innerWidth}x${window.innerHeight}`
    };
}

async function sendIssueToBackend(payload) {
    if (!REPORT_ISSUE_URL || REPORT_ISSUE_URL.includes("REGIO-PROJECT")) {
        console.warn("Backend URL nog niet geconfigureerd.");
        return;
    }

    const res = await fetch(REPORT_ISSUE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error("Backend error " + res.status);
    return await res.json();
}

function initIssueReportModal() {
    // 1. Luister naar openen
    document.addEventListener("click", (e) => {
        if(e.target.closest("#report-issue-btn") && window.Modal) {
            const infoEl = document.getElementById("report-page-info");
            if (infoEl) infoEl.textContent = window.location.pathname;
            window.Modal.open("modal-report-issue");
        }
    });

    // 2. Luister naar VERSTUREN (Deze ontbrak!)
    // We gebruiken delegation op document level voor het geval de modal pas later in de DOM komt
    document.addEventListener("click", async (e) => {
        if(e.target && e.target.id === "report-submit") {
            const btn = e.target;
            const titleEl = document.getElementById("report-title");
            const descEl = document.getElementById("report-description");
            const typeEl = document.getElementById("report-type");
            const techEl = document.getElementById("report-include-tech");

            if (!titleEl || !descEl || !titleEl.value || !descEl.value) {
                alert("Vul een titel en omschrijving in.");
                return;
            }

            btn.disabled = true;
            btn.textContent = "Verzenden...";

            try {
                const context = (techEl && techEl.checked) ? gatherIssueContext() : null;
                const payload = {
                    type: typeEl ? typeEl.value : "bug",
                    title: titleEl.value,
                    description: descEl.value,
                    context
                };

                await sendIssueToBackend(payload);
                
                alert("Melding verzonden! Bedankt.");
                if (window.Modal) window.Modal.close();
                titleEl.value = "";
                descEl.value = "";

            } catch (err) {
                console.error(err);
                alert("Fout bij verzenden: " + err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = "Versturen";
            }
        }
    });
}

/**
 * HOOFD START FUNCTIE
 */
function bootstrapNavigation() {
    // 1. Start de luisteraars (maar 1 keer!)
    initGlobalListeners();
    initIssueReportModal(); 

    // 2. Fix de DOM
    fixPaths();
    renderQuickLinks();
    initUIComponents();
}

document.addEventListener("partials:loaded", bootstrapNavigation);
document.addEventListener("DOMContentLoaded", bootstrapNavigation);