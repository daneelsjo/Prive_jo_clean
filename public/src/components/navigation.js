// src/components/navigation.js
import { db, collection, query, orderBy, onSnapshot, getDocs, where, doc, setDoc, serverTimestamp } from "../services/db.js";
import { getCurrentUser, watchUser } from "../services/auth.js";

// ── Service Worker + Update-detectie ─────────────────────────────────────────
let swRegistration = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

      // Staat er al een nieuwe SW klaar?
      if (swRegistration.waiting) showUpdateBar(swRegistration.waiting);

      // Nieuwe SW die begint te installeren
      swRegistration.addEventListener('updatefound', () => {
        const installing = swRegistration.installing;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBar(installing);
          }
        });
      });

      // Pagina herladen zodra nieuwe SW de controle overneemt
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) { refreshing = true; window.location.reload(); }
      });

    } catch (err) {
      console.warn('SW registratie mislukt:', err);
    }
  });
}

// ── Update-balk (onderaan scherm) ─────────────────────────────────────────────
function showUpdateBar(sw) {
  if (document.getElementById('pwa-update-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'pwa-update-bar';
  bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1d4ed8;color:#fff;display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 16px;z-index:9998;font-size:0.9rem;font-weight:500;';
  bar.innerHTML = `<span>🔄 Nieuwe versie beschikbaar</span><button id="btn-do-update" style="background:#fff;color:#1d4ed8;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:600;">Vernieuwen</button><button id="btn-dismiss-update" style="background:transparent;color:#bfdbfe;border:none;cursor:pointer;font-size:1.2rem;line-height:1;">✕</button>`;
  document.body.appendChild(bar);
  document.getElementById('btn-do-update').addEventListener('click', () => sw.postMessage({ type: 'SKIP_WAITING' }));
  document.getElementById('btn-dismiss-update').addEventListener('click', () => bar.remove());
}

// ── Install-knop (📲 in header) ────────────────────────────────────────────────
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  addInstallButton();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  document.getElementById('btn-install-pwa')?.remove();
});

function addInstallButton() {
  const doAdd = () => {
    if (document.getElementById('btn-install-pwa')) return;
    const container = document.getElementById('quickLinks');
    if (!container) return;
    const btn = document.createElement('button');
    btn.id = 'btn-install-pwa';
    btn.className = 'icon-btn header-link';
    btn.textContent = '📲';
    btn.title = 'App installeren';
    btn.style.cssText = 'margin-left:10px;background:transparent;border:none;font-size:1.2rem;cursor:pointer;';
    btn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') { deferredInstallPrompt = null; btn.remove(); }
    });
    container.insertBefore(btn, container.firstChild);
  };
  if (document.getElementById('quickLinks')) doAdd();
  else document.addEventListener('partials:loaded', doAdd, { once: true });
}

// ── Push notificaties (FCM) ───────────────────────────────────────────────────
// Haal de VAPID key op via Firebase Console → Project Settings →
// Cloud Messaging → Web Push certificates → "Sleutelpaar genereren"
const FCM_VAPID_KEY = '';

async function initPushNotifications(uid) {
  if (!FCM_VAPID_KEY || !('Notification' in window) || Notification.permission === 'denied') return;
  try {
    const { getMessaging, getToken, onMessage } = await import('https://www.gstatic.com/firebasejs/10.5.2/firebase-messaging.js');
    const { app } = await import('../services/config.js');
    const messaging = getMessaging(app);

    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (permission !== 'granted') return;

    const swReg = await navigator.serviceWorker.ready;
    const token = await getToken(messaging, { vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: swReg });

    if (token) {
      await setDoc(doc(db, 'fcmTokens', uid), { token, updatedAt: serverTimestamp(), ua: navigator.userAgent.slice(0, 120) });
    }

    // Toon push-berichten als de app wél open staat
    onMessage(messaging, (payload) => {
      const n = payload.notification || {};
      showToastNotification(n.title || 'JD Portaal', n.body || '');
    });

  } catch (err) {
    console.warn('Push notificaties setup mislukt:', err);
  }
}

function showToastNotification(title, body) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;top:70px;right:16px;background:#1e293b;color:#f1f5f9;padding:12px 16px;border-radius:10px;border-left:4px solid #3b82f6;box-shadow:0 4px 16px rgba(0,0,0,.4);z-index:9997;max-width:320px;font-size:0.9rem;cursor:pointer;';
  t.innerHTML = `<strong>${title}</strong>${body ? `<div style="opacity:.8;margin-top:4px;">${body}</div>` : ''}`;
  document.body.appendChild(t);
  t.addEventListener('click', () => t.remove());
  setTimeout(() => t.remove(), 8000);
}

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

            // Controleer vorige werkdag
            checkPrevdayReminder(user);

            // Push notificaties initialiseren
            initPushNotifications(user.uid);
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

// --- VORIGE WERKDAG HERINNERING ---
function getPreviousWorkday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function checkPrevdayReminder(user) {
    // Op de tijdspagina zelf opent time.js de modal direct — geen dubbele banner nodig
    if (window.location.pathname.includes('time.html')) return;

    const prevISO = getPreviousWorkday();
    const suppressKey = `time_prevday_suppress_${user.uid}_${prevISO}`;
    if (localStorage.getItem(suppressKey)) return;

    try {
        const q = query(
            collection(db, 'timelogSegments'),
            where('uid', '==', user.uid),
            where('date', '==', prevISO)
        );
        const snap = await getDocs(q);
        const hasEntry = snap.docs.some(d =>
            ['standard', 'verlof', 'recup', 'feestdag', 'interventie'].includes(d.data().type)
        );
        if (!hasEntry) showPrevdayBanner(user.uid, prevISO, suppressKey);
    } catch (e) {
        console.warn('Prevday check mislukt', e);
    }
}

function showPrevdayBanner(uid, prevISO, suppressKey) {
    const doShow = () => {
        if (document.getElementById('prevday-global-banner')) return;

        const [y, m, day] = prevISO.split('-');
        const d = new Date(Number(y), Number(m) - 1, Number(day));
        const label = d.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });

        const banner = document.createElement('div');
        banner.id = 'prevday-global-banner';
        banner.className = 'prevday-global-banner';
        banner.innerHTML = `
            <span class="prevday-icon">⏰</span>
            <div class="prevday-text">
                <strong>Geen registratie voor ${label}</strong>
                <span class="prevday-sub">Wil je de uren van die dag invullen?</span>
            </div>
            <div class="prevday-actions">
                <a id="prevday-fill" href="${getPathPrefix()}src/modules/tijdsregistratie/time.html" class="btn primary small">Invullen</a>
                <button id="prevday-dismiss" class="ghost small">Niet nu</button>
            </div>
        `;

        const topbar = document.querySelector('.topbar');
        if (topbar) topbar.insertAdjacentElement('afterend', banner);
        else document.body.prepend(banner);

        document.getElementById('prevday-dismiss').onclick = () => {
            banner.remove();
            localStorage.setItem(suppressKey, '1');
        };
        // "Invullen" navigeert naar time.html — suppress key NIET zetten zodat time.js de modal opent
    };

    if (document.querySelector('.topbar')) doShow();
    else document.addEventListener('partials:loaded', doShow, { once: true });
}

// --- START DE APPLICATIE ---

// 1. Start de logica zodra de pagina begint te laden (voor Auth & Database)
document.addEventListener("DOMContentLoaded", initNavigation);

// 2. Her-teken de navigatiebalk zodra header.html is ingeladen
// (Dit is nodig omdat de knoppen in de header zitten die later pas verschijnt)
document.addEventListener("partials:loaded", () => {
    bootstrapNavigation();
});