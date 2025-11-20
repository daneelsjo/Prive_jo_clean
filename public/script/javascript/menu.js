// Script/Javascript/menu.js — nette routes met absolute paden
(() => {
    let wired = false;

    // p dat met "/" start laten we ongemoeid, anders relativeren tussen root en /HTML/
    const isNested = () => /\/HTML\//i.test(location.pathname);
    const prefixPath = (p = "") => {
        if (p.startsWith("/")) return p;                  // absolute pad, niets prefixen
        return (isNested() ? "../" : "") + p.replace(/^\.\//, "");
    };

    // herkent zowel /plan, /plan.html als /HTML/plan.html
    function currentPage() {
        const p = location.pathname.toLowerCase().replace(/\/+$/, "");
        if (p === "" || p === "/" || p.endsWith("/index.html")) return "index";
        if (p.endsWith("/settings") || p.endsWith("/settings.html") || p.endsWith("/html/settings.html")) return "settings";
        if (p.endsWith("/notes")    || p.endsWith("/notes.html")    || p.endsWith("/notities.html") || p.endsWith("/html/notes.html")) return "notes";
        if (p.endsWith("/tijd")     || p.endsWith("/tijd.html")     || p.endsWith("/html/tijd.html")) return "tijd";
        if (p.endsWith("/plan")     || p.endsWith("/plan.html")     || p.endsWith("/html/plan.html")) return "plan";
        return "index";
    }

    function setHeaderQuickLinks() {
        const el = document.getElementById("quickLinks");
        if (!el) return;
        const page = currentPage();

        const links = ({
            index: [
                { emoji: "📝", title: "Notities",        path: "/notes" },
                { emoji: "⏱️", title: "Tijdsregistratie", path: "/tijd" },
                { emoji: "⚙️", title: "Instellingen",     path: "/settings" },
                { emoji: "🗓️", title: "Plan",            path: "/plan" }
            ],
            settings: [
                { emoji: "📌", title: "Post-its",         path: "/" },
                { emoji: "📝", title: "Notities",         path: "/notes" },
                { emoji: "⏱️", title: "Tijdsregistratie", path: "/tijd" },
                { emoji: "🗓️", title: "Plan",            path: "/plan" }
            ],
            notes: [
                { emoji: "📌", title: "Post-its",         path: "/" },
                { emoji: "⏱️", title: "Tijdsregistratie", path: "/tijd" },
                { emoji: "⚙️", title: "Instellingen",     path: "/settings" },
                { emoji: "🗓️", title: "Plan",            path: "/plan" }
            ],
            tijd: [
                { emoji: "📌", title: "Post-its",         path: "/" },
                { emoji: "📝", title: "Notities",         path: "/notes" },
                { emoji: "⚙️", title: "Instellingen",     path: "/settings" },
                { emoji: "🗓️", title: "Plan",            path: "/plan" }
            ],
            plan: [
                { emoji: "📌", title: "Post-its",         path: "/" },
                { emoji: "📝", title: "Notities",         path: "/notes" },
                { emoji: "⚙️", title: "Instellingen",     path: "/settings" }
            ]
        })[page] || [];

        el.innerHTML = "";
        links.forEach(l => {
            const a = document.createElement("a");
            a.href = prefixPath(l.path); // absolute pad blijft absoluut
            a.className = "icon-btn header-link";
            a.title = l.title;
            a.setAttribute("aria-label", l.title);
            a.textContent = l.emoji;
            el.appendChild(a);
        });
    }

    function ensureDrawerBase(drawer, bd) {
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
        S.setProperty("transform", (drawer.getAttribute("data-state") === "open") ? "translateX(0)" : "translateX(-105%)", "important");
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
        setupSideAccordion(drawer);

        btn.onclick = (e) => {
            e.preventDefault();
            const isOpen = drawer.getAttribute("data-state") === "open";
            isOpen ? closeDrawer(drawer, bd, btn) : openDrawer(drawer, bd, btn);
            if (window.DEBUG) console.log("[menu] drawer", isOpen ? "CLOSE" : "OPEN");
        };
        bd.onclick = () => closeDrawer(drawer, bd, btn);
        document.onkeydown = (e) => { if (e.key === "Escape") closeDrawer(drawer, bd, btn); };

        drawer.querySelectorAll(".sidemenu-section h4").forEach(h => {
            h.onclick = () => h.parentElement.classList.toggle("open");
        });
    }

function bindNeonMainnav() {
  const nav = document.querySelector(".mainnav");
  if (!nav) return;

  // Toggle open/close op top-level items
  nav.querySelectorAll("li.has-submenu > a").forEach(a => {
    a.onclick = e => {
      if (a.getAttribute("href") !== "#") return;
      e.preventDefault();
      const li = a.parentElement;
      const wasOpen = li.classList.contains("open");
      nav.querySelectorAll("li.has-submenu.open").forEach(s => s !== li && s.classList.remove("open"));
      li.classList.toggle("open", !wasOpen);
      a.setAttribute("aria-expanded", String(!wasOpen));
    };
  });

  // Klik buiten het menu sluit alles
  document.addEventListener("click", e => {
    if (!nav.contains(e.target)) {
      nav.querySelectorAll("li.has-submenu.open").forEach(li => li.classList.remove("open"));
    }
  });

  // Klik op een link in een submenu sluit de open states
  nav.querySelectorAll(".submenu a").forEach(a => {
    a.addEventListener("click", () => {
      setTimeout(() => {
        nav.querySelectorAll("li.has-submenu.open").forEach(li => li.classList.remove("open"));
      }, 0);
    });
  });

  // new tab ondersteuning via data-newtab
  nav.querySelectorAll('a[data-newtab]').forEach(a => {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });
}

    const REPORT_ISSUE_URL = "https://REGIO-PROJECT.cloudfunctions.net/reportIssue"; // TODO: straks invullen

    function gatherIssueContext(extra) {
        const env = window.APP_ENV || "UNKNOWN";
        const pageId = typeof currentPage === "function" ? currentPage() : "unknown";
        const url = location.href;
        const title = document.title || "";
        const userAgent = navigator.userAgent || "";

        const base = {
            env,
            pageId,
            url,
            title,
            userAgent
        };

        if (extra && typeof extra === "object") {
            for (const k in extra) base[k] = extra[k];
        }
        return base;
    }

    async function sendIssueToBackend(payload) {
        // Placeholder als backend nog niet klaar is
        if (!REPORT_ISSUE_URL || REPORT_ISSUE_URL.indexOf("REGIO-PROJECT") !== -1) {
            console.log("[report-issue] payload (backend nog niet geconfigureerd):", payload);
            return;
        }

        const res = await fetch(REPORT_ISSUE_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const text = await res.text();
            console.error("[report-issue] backend error", res.status, text);
            throw new Error("Backend error " + res.status);
        }

        const json = await res.json();
        console.log("[report-issue] issue aangemaakt:", json);
        return json;
    }

    function initIssueReportModal() {
        const modal = document.getElementById("modal-report-issue");
        if (!modal) return;

        const typeEl = document.getElementById("report-type");
        const titleEl = document.getElementById("report-title");
        const descEl = document.getElementById("report-description");
        const techEl = document.getElementById("report-include-tech");
        const pageInfoEl = document.getElementById("report-page-info");
        const submitBtn = document.getElementById("report-submit");
        const cancelBtn = document.getElementById("report-cancel");

        if (!typeEl || !titleEl || !descEl || !techEl || !submitBtn) return;

        const updatePageInfo = () => {
            if (!pageInfoEl) return;
            const pageId = typeof currentPage === "function" ? currentPage() : "unknown";
            pageInfoEl.textContent = pageId + " — " + location.href;
        };

        // Wanneer de modal opengaat, info updaten
        document.addEventListener("click", (e) => {
            const btn = e.target.closest("#report-issue-btn");
            if (!btn) return;
            updatePageInfo();
            if (window.Modal) {
                window.Modal.open("modal-report-issue");
            }
        });

        cancelBtn && (cancelBtn.onclick = () => {
            if (window.Modal) window.Modal.close();
        });

        submitBtn.onclick = async () => {
            const type = typeEl.value;
            const title = titleEl.value.trim();
            const description = descEl.value.trim();
            const includeTech = techEl.checked;

            if (!title || !description) {
                alert("Vul een titel en beschrijving in.");
                return;
            }

            const context = includeTech ? gatherIssueContext() : null;

            const payload = {
                type,
                title,
                description,
                context
            };

            try {
                await sendIssueToBackend(payload);
                alert("Probleemmelding verzonden. Bedankt.");
                if (window.Modal) window.Modal.close();
                titleEl.value = "";
                descEl.value = "";
            } catch (err) {
                console.error("[report-issue] verzenden mislukt", err);
                alert("Verzenden mislukt. Kijk in de console voor details.");
            }
        };
    }

    function insertReportIssueButton() {
        const el = document.getElementById("quickLinks");
        if (!el) return;
        if (el.querySelector("#report-issue-btn")) return;

        const btn = document.createElement("button");
        btn.id = "report-issue-btn";
        btn.type = "button";
        btn.className = "icon-btn header-link";
        btn.title = "Probleem melden";
        btn.setAttribute("aria-label", "Probleem melden");
        btn.textContent = "🐞";

        el.appendChild(btn);
    }


    function initMenu() {
        if (wired) return;
        wired = true;
        setHeaderQuickLinks();
        insertReportIssueButton();
        initIssueReportModal();
        bindHamburger();
        bindNeonMainnav();
        if (window.DEBUG) console.log("[menu] wired");
    }


    document.addEventListener("partials:loaded", initMenu);

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
        sec.classList.remove("open");
        const h = sec.querySelector("h4");
        if (!h) return;
        h.setAttribute("role", "button");
        h.setAttribute("tabindex", "0");
        h.setAttribute("aria-expanded", "false");

        const toggle = () => {
            const willOpen = !sec.classList.contains("open");
            sections.forEach(s => {
                if (s !== sec) {
                    s.classList.remove("open");
                    const hh = s.querySelector("h4");
                    hh && hh.setAttribute("aria-expanded", "false");
                }
            });
            sec.classList.toggle("open", willOpen);
            h.setAttribute("aria-expanded", String(willOpen));
        };

        h.onclick = toggle;
        h.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
        };
    });
}
