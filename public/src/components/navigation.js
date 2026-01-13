// src/components/navigation.js
import { db, collection, query, orderBy, onSnapshot } from "../services/db.js";
import { getCurrentUser, watchUser } from "../services/auth.js";

console.log("🚦 Navigation.js met CMS geladen");

// --- STATE ---
let globalLinks = [];
let listenersInitialized = false;

// HULPFUNCTIE: Zorgt dat links altijd werken (voegt https:// toe indien nodig)
function ensureAbsoluteUrl(url) {
    if (!url) return "#";
    // Check of het al een geldig protocol, anchor of lokaal pad heeft
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:") || url.startsWith("#") || url.startsWith("/")) {
        return url;
    }
    // Zo niet, plakken we er https:// voor
    return "https://" + url;
}

// --- 1. START & DATA OPHALEN ---
function initNavigation() {
    watchUser((user) => {
        if(user) {
            // Haal CMS links op
            const q = query(collection(db, "globalLinks"), orderBy("order", "asc"));
            onSnapshot(q, (snapshot) => {
                globalLinks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                
                // Bouw de menu's op
                buildDynamicNavbar();  
                buildDynamicSidebar(); 
            });
        }
    });

    // Start ook de standaard functies
    bootstrapNavigation();
}

// --- 2. NAVBAR BOUWEN (Bovenbalk) ---
function buildDynamicNavbar() {
    // We zoeken de UL in de mainnav (uit jouw header.html)
    const navbarUl = document.querySelector('.mainnav > ul');
    if(!navbarUl) return;

    // 1. Verwijder oude CMS items (zodat we niet dubbel toevoegen bij updates)
    navbarUl.querySelectorAll('.cms-item').forEach(e => e.remove());

    // 2. Filter items voor Navbar
    const navItems = globalLinks.filter(l => l.locations && l.locations.navbar);
    
    // 3. Bouw boomstructuur
    const tree = buildTree(navItems);

    // 4. Render items en voeg toe achteraan
    Object.keys(tree).forEach(rootKey => {
        const item = tree[rootKey];
        const el = createMenuItem(rootKey, item);
        el.classList.add('cms-item'); // Markeer als dynamisch
        navbarUl.appendChild(el);
    });

    // Her-activeer hover events
    initUIComponents();
}

function createMenuItem(label, data) {
    const li = document.createElement('li');
    
    // Attribute Helper (AANGEPAST)
    const getAttrs = (link) => {
        const safeUrl = ensureAbsoluteUrl(link.url); // <--- HIER GEBRUIKEN WE DE FUNCTIE
        const t = link.target || "_blank";
        
        if (t === 'popup') {
            return `href="#" onclick="event.preventDefault(); window.open('${safeUrl}', 'popup', 'width=1200,height=800');"`;
        } else if (t === '_self') {
            return `href="${safeUrl}"`; 
        } else {
            return `href="${safeUrl}" target="${t}"`;
        }
    };

    const isLeaf = Array.isArray(data);
    const hasSubMenu = !isLeaf && Object.keys(data).length > 0;

    if (hasSubMenu) {
        li.className = "has-submenu cms-item";
        li.innerHTML = `<a class="menu-link" href="#" aria-haspopup="true"><span class="label">${label}</span></a>`;
        
        const ul = document.createElement('ul');
        ul.className = "submenu";
        
        Object.keys(data).forEach(key => {
            if(key === '_links') {
                data['_links'].forEach(link => {
                    const subLi = document.createElement('li');
                    subLi.innerHTML = `<a ${getAttrs(link)}>${link.icon || ''} ${link.title}</a>`;
                    ul.appendChild(subLi);
                });
            } else {
                const subLi = document.createElement('li');
                subLi.className = "has-submenu";
                subLi.innerHTML = `<a href="#" aria-haspopup="true">${key}</a>`;
                const subUl = document.createElement('ul');
                subUl.className = "submenu";

                if(Array.isArray(data[key])) {
                    data[key].forEach(link => {
                        const deepLi = document.createElement('li');
                        deepLi.innerHTML = `<a ${getAttrs(link)}>${link.icon || ''} ${link.title}</a>`;
                        subUl.appendChild(deepLi);
                    });
                }
                subLi.appendChild(subUl);
                ul.appendChild(subLi);
            }
        });
        li.appendChild(ul);
        
    } else if (isLeaf) {
        li.className = "cms-item";
        data.forEach(link => {
             li.innerHTML = `<a class="menu-link" ${getAttrs(link)}><span class="label">${link.icon || ''} ${link.title}</span></a>`;
        });
    }
    return li;
}

function initExternalLinks() {
    document.querySelectorAll("a[data-newtab]").forEach(link => {
        link.setAttribute("target", "_blank");
        // Veiligheid: voorkomt dat de nieuwe pagina toegang heeft tot de oude
        link.setAttribute("rel", "noopener noreferrer"); 
    });
}

// --- 3. SIDEBAR BOUWEN (Zijbalk) ---
function buildDynamicSidebar() {
    const sidebar = document.getElementById('sidemenu');
    if(!sidebar) return;
    
    // Zoek of maak een sectie voor dynamische links
    let dynSection = document.getElementById('dyn-sidebar-section');
    if(!dynSection) {
        dynSection = document.createElement('nav');
        dynSection.className = "sidemenu-section cms-section";
        dynSection.id = "dyn-sidebar-section";
        dynSection.innerHTML = "<h4>Mijn Snelkoppelingen</h4><ul></ul>";
        sidebar.appendChild(dynSection);
    }

    const ul = dynSection.querySelector('ul');
    ul.innerHTML = ""; // Leegmaken

    const sideItems = globalLinks.filter(l => l.locations && l.locations.sidebar);
    
    if (sideItems.length === 0) {
        dynSection.style.display = 'none';
        return;
    }
    dynSection.style.display = 'block';
    
    // Zorg dat de hoofdsectie "Mijn Snelkoppelingen" open staat, 
    // maar de sub-categorieën daarbinnen zullen standaard dicht zijn.
    if(!dynSection.classList.contains('open')) dynSection.classList.add('open');

    // Groepeer op Hoofdcategorie
    const groups = {};
    sideItems.forEach(link => {
        const rootCat = (link.category || "Overige").split('>')[0].trim();
        if(!groups[rootCat]) groups[rootCat] = [];
        groups[rootCat].push(link);
    });

    Object.keys(groups).sort().forEach(cat => {
        if(cat !== "Overige") {
            // --- CATEGORIE (SUBMENU) ---
            const groupLi = document.createElement('li');
            
            // De titel van de categorie (Klikbaar om te openen/sluiten)
            const titleLink = document.createElement('a');
            titleLink.href = "#";
            titleLink.innerHTML = `<span style="flex:1;">${cat}</span> <span style="font-size:0.8em; opacity:0.5;">▼</span>`;
            titleLink.style.fontWeight = "bold";
            titleLink.style.color = "var(--muted)";
            titleLink.style.textTransform = "uppercase";
            titleLink.style.display = "flex";
            titleLink.style.justifyContent = "space-between";
            titleLink.style.cursor = "pointer";

            // Het lijstje met links (Standaard VERBORGEN)
            const subUl = document.createElement('ul');
            subUl.style.display = "none"; 
            subUl.style.paddingLeft = "15px"; // Beetje inspringen
            subUl.style.marginTop = "5px";
            subUl.style.marginBottom = "10px";
            subUl.style.listStyle = "none";

            // Klik event om open/dicht te klappen
            titleLink.onclick = (e) => {
                e.preventDefault();
                const isOpen = subUl.style.display === "block";
                subUl.style.display = isOpen ? "none" : "block";
                // Pijltje draaien (optioneel, visueel extraatje)
                titleLink.querySelector('span:last-child').style.transform = isOpen ? "rotate(0deg)" : "rotate(180deg)";
            };

            groupLi.appendChild(titleLink);

            // Links toevoegen aan de sublijst
            groups[cat].forEach(link => {
                const li = document.createElement('li');
                const safeUrl = ensureAbsoluteUrl(link.url);
                const t = link.target || "_blank";
                
                let attr = `href="${safeUrl}" target="${t}"`;
                if (t === 'popup') attr = `href="#" onclick="event.preventDefault(); window.open('${safeUrl}', 'popup', 'width=1200,height=800');"`;
                
                // GEEN ICOON MEER, ALLEEN TITEL
                li.innerHTML = `<a ${attr}>${link.title}</a>`;
                subUl.appendChild(li);
            });

            groupLi.appendChild(subUl);
            ul.appendChild(groupLi);

        } else {
            // --- OVERIGE (LOSSE LINKS) ---
            groups[cat].forEach(link => {
                const li = document.createElement('li');
                const safeUrl = ensureAbsoluteUrl(link.url);
                const t = link.target || "_blank";
                
                let attr = `href="${safeUrl}" target="${t}"`;
                if (t === 'popup') attr = `href="#" onclick="event.preventDefault(); window.open('${safeUrl}', 'popup', 'width=1200,height=800');"`;

                // GEEN ICOON MEER, ALLEEN TITEL
                li.innerHTML = `<a ${attr}>${link.title}</a>`;
                ul.appendChild(li);
            });
        }
    });
}

// --- 4. HELPERS ---
function buildTree(items) {
    const tree = {};
    items.forEach(link => {
        const parts = (link.category || "Overige").split('>').map(s => s.trim());
        let currentLevel = tree;
        
        parts.forEach((part, index) => {
            if (!currentLevel[part]) {
                currentLevel[part] = (index === parts.length - 1 && parts.length > 1) ? [] : {}; 
            }
            currentLevel = currentLevel[part];
        });
        
        if(Array.isArray(currentLevel)) {
             currentLevel.push(link);
        } else {
             if(!currentLevel['_links']) currentLevel['_links'] = [];
             currentLevel['_links'].push(link);
        }
    });
    return tree;
}

// --- 5. BESTAANDE FUNCTIES (Behouden uit jouw origineel) ---

function getPathPrefix() {
    const path = window.location.pathname;
    if (path.includes("/src/modules/") || path.includes("/HTML/")) return "../../../";
    return "";
}

function fixPaths() {
    const prefix = getPathPrefix();
    if (!prefix) return;
    document.querySelectorAll("a[data-internal]").forEach(link => {
        const href = link.getAttribute("href");
        if (href && !href.startsWith("http") && !href.startsWith("#") && !href.startsWith(prefix)) {
            link.setAttribute("href", prefix + href);
        }
    });
}

function initGlobalListeners() {
    if (listenersInitialized) return;
    listenersInitialized = true;

    document.addEventListener("click", (e) => {
        // 1. Hamburger
        if (e.target.closest("#hamburgerBtn")) {
            e.preventDefault(); e.stopPropagation(); toggleSidebar(); return;
        }
        // 2. Backdrop
        if (e.target.closest("#sidemenu-backdrop")) {
            toggleSidebar(false); return;
        }
        // 3. Logo
        if (e.target.closest("#brandLogo")) {
            window.location.href = getPathPrefix() + "index.html"; return;
        }
        
        // 4. SIDEBAR ACCORDEON (Hersteld!)
        // Dit zorgt dat zowel vaste als nieuwe menu's open/dicht kunnen
        const header = e.target.closest(".sidemenu-section h4");
        if (header) {
            header.parentElement.classList.toggle("open");
        }
    });

    document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleSidebar(false); });
}

function toggleSidebar(forceState = null) {
    const sidemenu = document.getElementById("sidemenu");
    const backdrop = document.getElementById("sidemenu-backdrop");
    if (!sidemenu) return;
    const currentState = sidemenu.getAttribute("data-state") === "open";
    const newState = forceState !== null ? forceState : !currentState;
    sidemenu.setAttribute("data-state", newState ? "open" : "closed");
    if (backdrop) backdrop.style.display = newState ? "block" : "none";
}

function initUIComponents() {
    const dropdowns = document.querySelectorAll(".mainnav .has-submenu");
    dropdowns.forEach(item => {
        // Verwijder oude listeners om dubbelingen te voorkomen bij re-render
        const clone = item.cloneNode(true);
        item.parentNode.replaceChild(clone, item);
        
        let closeTimer;
        clone.addEventListener("mouseenter", () => {
            clearTimeout(closeTimer);
            document.querySelectorAll(".mainnav .has-submenu").forEach(o => o !== clone && o.classList.remove("open"));
            clone.classList.add("open");
        });
        clone.addEventListener("mouseleave", () => {
            closeTimer = setTimeout(() => clone.classList.remove("open"), 300);
        });
    });
}

// VASTE LINKS (Header Icons)
function renderQuickLinks() {
    const container = document.getElementById("quickLinks");
    if (!container) return;

    const prefix = getPathPrefix();
    const definitions = [
        { icon: "📝", title: "Sticknotes", href: "src/modules/sticknotes/sticknotes.html" },
        { icon: "⏱️", title: "Tijd",       href: "src/modules/tijdsregistratie/time.html" },
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
    
    // Issue knop
    const btn = document.createElement("button");
    btn.id = "report-issue-btn";
    btn.textContent = "🐞";
    btn.className = "icon-btn header-link";
    btn.style.marginLeft = "10px"; btn.style.background = "transparent"; btn.style.border = "none"; btn.style.fontSize = "1.2rem"; btn.style.cursor="pointer";
    container.appendChild(btn);
}

function bootstrapNavigation() {
    initGlobalListeners();
    fixPaths();
    initExternalLinks();
    renderQuickLinks();
    initUIComponents();
}

// --- START DE APPLICATIE ---

// 1. Start de logica zodra de pagina begint te laden (voor Auth & Database)
document.addEventListener("DOMContentLoaded", initNavigation);

// 2. Her-teken de navigatiebalk zodra header.html is ingeladen
// (Dit is nodig omdat de knoppen in de header zitten die later pas verschijnt)
document.addEventListener("partials:loaded", () => {
    bootstrapNavigation();
});