// src/components/toast.js

// 1. Automatisch CSS injecteren (zodat je geen losse CSS hoeft te linken)
const styleId = "toast-styles";
if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.innerHTML = `
        .toast-container {
            position: fixed;
            bottom: 20px;
            right: 20px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 9999;
            pointer-events: none; /* Klik erdoorheen als er niets staat */
        }
        .toast {
            min-width: 250px;
            max-width: 350px;
            background: #fff;
            color: #333;
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 14px;
            font-weight: 500;
            opacity: 0;
            transform: translateX(100%);
            animation: slideIn 0.3s forwards;
            pointer-events: auto;
            border-left: 5px solid #ccc;
        }
        
        /* Dark mode support als de body class of data-theme heeft */
        :root[data-theme="dark"] .toast {
            background: #1e293b;
            color: #f1f5f9;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        }

        .toast.success { border-left-color: #22c55e; }
        .toast.success .toast-icon { color: #22c55e; }
        
        .toast.error { border-left-color: #ef4444; }
        .toast.error .toast-icon { color: #ef4444; }
        
        .toast.info { border-left-color: #3b82f6; }
        .toast.info .toast-icon { color: #3b82f6; }

        .toast.hiding {
            animation: fadeOut 0.3s forwards;
        }

        @keyframes slideIn {
            to { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeOut {
            to { opacity: 0; transform: translateY(10px); }
        }
    `;
    document.head.appendChild(style);
}

// 2. Container maken (als die er nog niet is)
function ensureContainer() {
    let container = document.querySelector(".toast-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
    }
    return container;
}

// 3. De Export Functie
export function showToast(message, type = "success", duration = 3000) {
    const container = ensureContainer();
    
    // Icoon bepalen
    let icon = "ℹ️";
    if (type === "success") icon = "✅";
    if (type === "error") icon = "⚠️";

    // Element maken
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Automatisch verwijderen
    setTimeout(() => {
        toast.classList.add("hiding");
        toast.addEventListener("animationend", () => {
            toast.remove();
        });
    }, duration);
}