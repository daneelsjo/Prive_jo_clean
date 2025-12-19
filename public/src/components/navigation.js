// src/components/navigation.js

console.log("🚦 Navigation.js bestand geladen");

// --- STATE ---
let listenersInitialized = false; // Voorkomt dubbele klik-events

const REPORT_ISSUE_URL = "https://us-central1-prive-jo.cloudfunctions.net/reportIssue";

/**
 * 1. PADEN FIXEN (DOM Modificatie)
 * Deze mag/moet draaien zodra de HTML er is.
 */
function getPathPrefix() {
    const path = window.location.pathname;
    // Check diepte. src/modules/map/file.html = 3 mappen diep = ../../../
    if (path.includes("/src/modules/") || path.includes("/HTML/")) {
        return "../../../";
    }
    return "";
}

function fixPaths() {
    const prefix = getPathPrefix();
    if (!prefix) return; // Geen correctie nodig in root

    // Fix links (voorkom dubbele prefix via check)
    document.querySelectorAll("a[data-internal]").forEach(link => {
        const href = link.getAttribute("href");
        if (href && !href.startsWith("http") && !href.startsWith("#") && !href.startsWith("mailto")) {
            // Alleen toevoegen als het er nog niet staat
            if (!href.startsWith(prefix)) {
                link.setAttribute("href", prefix + href);
            }
        }
    });

    // Fix images
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
 * Deze mag maar 1 KEER draaien, anders krijg je dubbele open/dicht acties.
 */
function initGlobalListeners() {
    if (listenersInitialized) return; // Stop als we al luisteren
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

    // Escape toets
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") toggleSidebar(false);
    });
}

/**
 * HELPER: Sidebar Toggle
 */
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
 * 3. UI INITIALISATIE (Menu's & Icons)
 * Draait zodra de HTML er is.
 */
function initUIComponents() {
    // Dropdowns
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

    // New Tabs force
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
 * 4. QUICK LINKS
 */
function renderQuickLinks() {
    const container = document.getElementById("quickLinks");
    if (!container) return; // Kan gebeuren als header er nog niet is

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

    // Bug Knop
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
    // 1. Luister naar openen (Bug knop)
    document.addEventListener("click", (e) => {
        if(e.target.closest("#report-issue-btn") && window.Modal) {
            // Vul technische info in (optioneel, als je een element hebt in je modal)
            const infoEl = document.getElementById("report-page-info");
            if (infoEl) infoEl.textContent = window.location.pathname;
            
            window.Modal.open("modal-report-issue");
        }
    });

    // 2. Luister naar VERSTUREN (De ontbrekende stap)
    const submitBtn = document.getElementById("report-submit");
    if (submitBtn) {
        // We clonen de knop om oude event listeners te verwijderen (veiligheid tegen dubbele kliks)
        const newBtn = submitBtn.cloneNode(true);
        submitBtn.parentNode.replaceChild(newBtn, submitBtn);

        newBtn.addEventListener("click", async () => {
            const titleEl = document.getElementById("report-title");
            const descEl = document.getElementById("report-description");
            const typeEl = document.getElementById("report-type");
            const techEl = document.getElementById("report-include-tech");

            // Validatie
            if (!titleEl || !descEl || !titleEl.value || !descEl.value) {
                alert("Vul een titel en omschrijving in.");
                return;
            }

            // UI Feedback
            newBtn.disabled = true;
            newBtn.textContent = "Verzenden...";

            try {
                // Data verzamelen
                const context = (techEl && techEl.checked) ? {
                    url: window.location.href,
                    userAgent: navigator.userAgent,
                    screen: `${window.innerWidth}x${window.innerHeight}`,
                    env: window.APP_ENV || "UNKNOWN"
                } : null;

                const payload = {
                    type: typeEl ? typeEl.value : "bug",
                    title: titleEl.value,
                    description: descEl.value,
                    context
                };

                // Versturen
                await sendIssueToBackend(payload);
                
                alert("Melding succesvol verzonden! Bedankt.");
                if (window.Modal) window.Modal.close();
                
                // Reset velden
                titleEl.value = "";
                descEl.value = "";

            } catch (err) {
                console.error(err);
                alert("Fout bij verzenden: " + err.message);
            } finally {
                newBtn.disabled = false;
                newBtn.textContent = "Versturen";
            }
        });
    }
}

/**
 * HOOFD START FUNCTIE
 * Wordt aangeroepen als de pagina laadt OF als de partials (header) klaar zijn.
 */
function bootstrapNavigation() {
    console.log("🚀 Navigation Bootstrap...");
    
    // 1. Start de luisteraars (maar 1 keer!)
    initGlobalListeners();
    initIssueReportModal(); // Mag ook bij global listeners

    // 2. Fix de DOM (Paden, Iconen, Menu's)
    // Dit mag vaker draaien (bv. als header later wordt ingevoegd)
    fixPaths();
    renderQuickLinks();
    initUIComponents();
}

// TRIGGER 1: Als de partials (header) geladen zijn (De belangrijkste!)
document.addEventListener("partials:loaded", bootstrapNavigation);

// TRIGGER 2: Fallback voor als DOM geladen is (Start alvast de listeners)
document.addEventListener("DOMContentLoaded", bootstrapNavigation);