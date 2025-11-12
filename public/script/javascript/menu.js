// Script/Javascript/menu.js — stabiele versie (geen dubbele bindingen)
(() => {
    let wired = false;

    const isNested = () => /\/HTML\//i.test(location.pathname);
    const prefixPath = (p = "") => (isNested() ? "../" : "") + p.replace(/^\.\//, "");

    function currentPage() {
        const p = location.pathname.toLowerCase();
        if (p.endsWith("/index.html") || /\/$/.test(p)) return "index";
        if (p.endsWith("/settings.html")) return "settings";
        if (p.endsWith("/notes.html") || p.endsWith("/notities.html")) return "notes";
        if (p.endsWith("/tijd.html")) return "tijd";
        if (p.endsWith("/payments.html")) return "Betalingen";
        return "index";
    }


    function setHeaderQuickLinks() {
        const el = document.getElementById("quickLinks");
        if (!el) return;
        const page = currentPage();

        const links = ({
            index: [
                { emoji: "📝", title: "Notities", path: "HTML/notes.html" },
                { emoji: "⏱️", title: "Tijdsregistratie", path: "HTML/tijd.html" },
                { emoji: "⚙️", title: "Instellingen", path: "HTML/settings.html" },
                { emoji: "💸", title: "Betalingen", path: "HTML/payments.html" }
            ],
            settings: [
                { emoji: "📌", title: "Post-its", path: "index.html" },
                { emoji: "📝", title: "Notities", path: "HTML/notes.html" },
                { emoji: "⏱️", title: "Tijdsregistratie", path: "HTML/tijd.html" },
                { emoji: "💸", title: "Betalingen", path: "HTML/payments.html" }
            ],
            notes: [
                { emoji: "📌", title: "Post-its", path: "index.html" },
                { emoji: "⏱️", title: "Tijdsregistratie", path: "HTML/tijd.html" },
                { emoji: "⚙️", title: "Instellingen", path: "HTML/settings.html" },
                { emoji: "💸", title: "Betalingen", path: "HTML/payments.html" }
            ],
            tijd: [
                { emoji: "📌", title: "Post-its", path: "index.html" },
                { emoji: "📝", title: "Notities", path: "HTML/notes.html" },
                { emoji: "⚙️", title: "Instellingen", path: "HTML/settings.html" },
                { emoji: "💸", title: "Betalingen", path: "HTML/payments.html" }
            ],
            Betalingen: [
                { emoji: "📌", title: "Post-its", path: "index.html" },
                { emoji: "📝", title: "Notities", path: "HTML/notes.html" },
                { emoji: "⚙️", title: "Instellingen", path: "HTML/settings.html" }
            ]
        })[page] || [];

        el.innerHTML = "";
        links.forEach(l => {
            const a = document.createElement("a");
            a.href = prefixPath(l.path);
            a.className = "icon-btn header-link";
            a.title = l.title;
            a.setAttribute("aria-label", l.title);
            a.textContent = l.emoji;
            el.appendChild(a);
        });
    }


    // ── Drawer control ───────────────────────────────────────────────────────────
    function ensureDrawerBase(drawer, bd) {
        // harde inline styles zodat CSS-conflicten geen kans hebben
        const S = drawer.style;
        S.setProperty("position", "fixed", "important");
        S.setProperty("top", "0", "important");
        S.setProperty("bottom", "0", "important");
        S.setProperty("left", "0", "important");
        S.setProperty("width", "300px", "important");
        S.setProperty("background", "var(--card,#fff)", "important");
        S.setProperty("color", "var(--fg,#111)", "important");
        S.setProperty("border-right", "1px solid var(--border,#e5e7eb)", "important");
        S.setProperty("overflow", "auto", "important");
        S.setProperty("z-index", "2000", "important");
        S.setProperty("will-change", "transform", "important");
        S.setProperty("transition", "transform .25s ease", "important");
        S.setProperty(
            "transform",
            (drawer.getAttribute("data-state") === "open") ? "translateX(0)" : "translateX(-105%)",
            "important"
        );
        if (bd) {
            const BS = bd.style;
            BS.setProperty("position", "fixed", "important");
            BS.setProperty("inset", "0", "important");
            BS.setProperty("background", "rgba(0,0,0,.45)", "important");
            BS.setProperty("z-index", "1999", "important");
            BS.setProperty("display", bd.hasAttribute("hidden") ? "none" : "block", "important");
        }
    }
    function openDrawer(drawer, bd, btn) {
        drawer.setAttribute("data-state", "open");
        drawer.setAttribute("aria-hidden", "false");
        drawer.style.setProperty("transform", "translateX(0)", "important");
        bd && bd.removeAttribute("hidden");
        if (bd) bd.style.setProperty("display", "block", "important");
        btn && btn.setAttribute("aria-expanded", "true");
        document.body.style.overflow = "hidden";
    }
    function closeDrawer(drawer, bd, btn) {
        drawer.setAttribute("data-state", "closed");
        drawer.setAttribute("aria-hidden", "true");
        drawer.style.setProperty("transform", "translateX(-105%)", "important");
        bd && bd.setAttribute("hidden", "");
        if (bd) bd.style.setProperty("display", "none", "important");
        btn && btn.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
    }

    function bindHamburger() {
        const btn = document.getElementById("hamburgerBtn");
        const drawer = document.getElementById("sidemenu");
        const bd = document.getElementById("sidemenu-backdrop");
        if (!btn || !drawer || !bd) return;

        ensureDrawerBase(drawer, bd);

        setupSideAccordion(drawer); // bind accordion gedrag

        // idempotent: nooit stapelen
        btn.onclick = (e) => {
            e.preventDefault();
            const isOpen = drawer.getAttribute("data-state") === "open";
            isOpen ? closeDrawer(drawer, bd, btn) : openDrawer(drawer, bd, btn);
            if (window.DEBUG) console.log("[menu] drawer", isOpen ? "CLOSE" : "OPEN");
        };
        bd.onclick = () => closeDrawer(drawer, bd, btn);
        document.onkeydown = (e) => { if (e.key === "Escape") closeDrawer(drawer, bd, btn); };

        // secties in de drawer togglen
        drawer.querySelectorAll(".sidemenu-section h4").forEach(h => {
            h.onclick = () => h.parentElement.classList.toggle("open");
        });
    }

    // ── Neon bovenmenu (ongewijzigd) ────────────────────────────────────────────
    function bindNeonMainnav() {
        const nav = document.querySelector(".mainnav");
        if (!nav) return;
        nav.querySelectorAll("li.has-submenu > a").forEach(a => {
            a.onclick = (e) => {
                if (a.getAttribute("href") !== "#") return;
                e.preventDefault();
                const li = a.parentElement;
                const open = li.classList.contains("open");
                nav.querySelectorAll("li.has-submenu.open").forEach(s => s !== li && s.classList.remove("open"));
                li.classList.toggle("open", !open);
                a.setAttribute("aria-expanded", String(!open));
            };
        });
        document.addEventListener("click", (e) => {
            if (!nav.contains(e.target)) {
                nav.querySelectorAll("li.has-submenu.open").forEach(li => li.classList.remove("open"));
            }
        });
        nav.querySelectorAll('a[data-newtab]').forEach(a => {
            a.target = "_blank"; a.rel = "noopener noreferrer";
        });
    }

    function initMenu() {
        if (wired) return;           // ← voorkomt dubbele bindingen
        wired = true;
        setHeaderQuickLinks();
        bindHamburger();
        bindNeonMainnav();
        if (window.DEBUG) console.log("[menu] wired");
    }

    // Belangrijk: ALLEEN binden na partials (header) is geladen
    document.addEventListener("partials:loaded", initMenu);

    // Debug helper
    window.MenuDebug = () => {
        const d = document.getElementById("sidemenu");
        if (!d) return {};
        const cs = getComputedStyle(d);
        return {
            state: d.getAttribute("data-state"),
            left: cs.left, transform: cs.transform, display: cs.display, position: cs.position,
            rect: d.getBoundingClientRect()
        };
    };
})();


function setupSideAccordion(drawer) {
    const sections = drawer.querySelectorAll(".sidemenu-section");
    sections.forEach(sec => {
        sec.classList.remove("open"); // standaard dicht
        const h = sec.querySelector("h4");
        if (!h) return;
        h.setAttribute("role", "button");
        h.setAttribute("tabindex", "0");
        h.setAttribute("aria-expanded", "false");

        const toggle = () => {
            const willOpen = !sec.classList.contains("open");
            // sluit alle andere
            sections.forEach(s => {
                if (s !== sec) {
                    s.classList.remove("open");
                    const hh = s.querySelector("h4");
                    hh && hh.setAttribute("aria-expanded", "false");
                }
            });
            // toggle huidige
            sec.classList.toggle("open", willOpen);
            h.setAttribute("aria-expanded", String(willOpen));
        };

        h.onclick = toggle;
        h.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
        };
    });
}
