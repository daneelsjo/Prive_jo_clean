// Script/Javascript/modal.js

(() => {
    if (window.Modal && window.__modalInited) return;
    window.__modalInited = true;

    const $ = (id) => document.getElementById(id);
    const allModals = () => Array.from(document.querySelectorAll('.modal-card'));
    const backdrop = () => $('modal-backdrop');

    let openId = null;
    let lastFocus = null;

    function ensureBackdrop() {
        if (!backdrop()) {
            const bd = document.createElement('div');
            bd.id = 'modal-backdrop';
            bd.className = 'modal-backdrop';
            bd.setAttribute('aria-hidden', 'true');
            document.body.appendChild(bd);
        }
    }

    function show(el) { el.hidden = false; el.setAttribute('aria-hidden', 'false'); }
    function hide(el) { el.hidden = true; el.setAttribute('aria-hidden', 'true'); }

    function hideAllModals() { allModals().forEach(hide); }
    function lockBody(lock) { document.body.style.overflow = lock ? 'hidden' : ''; }

    function trapFocus(modal, e) {
        const focusables = modal.querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }

    function onKeydown(e) {
        if (!openId) return;
        const modal = document.getElementById(openId);
        if (!modal) return;
        if (e.key === 'Escape') Modal.close();
        else if (e.key === 'Tab') trapFocus(modal, e);
    }

    const Modal = {
        open(id) {
            ensureBackdrop();
            hideAllModals();
            const m = document.getElementById(id);
            if (!m) return;
            show(backdrop()); show(m);
            lockBody(true);
            openId = id;
            lastFocus = document.activeElement;
            document.addEventListener('keydown', onKeydown, true);
            setTimeout(() => {
                const first = m.querySelector('input,textarea,button,[tabindex]:not([tabindex="-1"])');
                (first || m).focus();
            }, 0);
        },
        close() {
            hideAllModals();
            if (backdrop()) backdrop().setAttribute('aria-hidden', 'true');
            lockBody(false);
            document.removeEventListener('keydown', onKeydown, true);
            openId = null;
            if (lastFocus) { try { lastFocus.focus(); } catch (_) { } }
        },
        alert({ title = "Melding", html = "", okText = "OK", onOk = null } = {}) {
            ensureBackdrop();
            const titleEl = document.getElementById('modal-alert-title');
            const bodyEl = document.getElementById('modal-alert-body');
            const okBtn = document.getElementById('modal-alert-ok');
            if (!titleEl || !bodyEl || !okBtn) return;
            titleEl.textContent = title;
            bodyEl.innerHTML = html;
            okBtn.textContent = okText;
            okBtn.onclick = () => { if (onOk) onOk(); Modal.close(); };
            Modal.open('modal-alert');
        },
        isOpen(id) { return openId === id; }
    };

    document.addEventListener('click', (e) => {
        const bd = backdrop();
        if (!bd) return;
        if (e.target === bd) { Modal.close(); return; }
        const closer = e.target.closest('[data-modal-close]');
        if (closer) Modal.close();
    }, true);

    window.Modal = Modal;
    document.addEventListener('DOMContentLoaded', ensureBackdrop);
})();

// in Script/Javascript/modal.js (eenmalig)
document.addEventListener('keydown', e => { if (e.key === 'Escape') Modal.close(); });
document.addEventListener('click', e => {
    const m = e.target.closest('.modal');
    if (m && e.target === m) Modal.close(); // klik buiten modal-card
});
