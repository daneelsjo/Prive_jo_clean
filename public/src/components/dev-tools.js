// src/components/dev-tools.js
import { IS_DEV } from "../services/config.js";

export function initDevTools() {
    // Alleen uitvoeren in DEV mode
    if (!IS_DEV) return;

    console.log("🛠️ Dev Tools Geactiveerd");
    document.body.classList.add("env-dev"); // Voor je CSS styling

    // Maak het zwevende paneel
    const panel = document.createElement("div");
    Object.assign(panel.style, {
        position: "fixed", left: "10px", bottom: "10px",
        padding: "6px 10px", fontSize: "12px", fontWeight: "bold",
        backgroundColor: "#b91c1c", color: "#ffffff",
        borderRadius: "6px", zIndex: "99999", pointerEvents: "none",
        fontFamily: "monospace", boxShadow: "0 2px 10px rgba(0,0,0,0.3)"
    });
    panel.textContent = "DEV MODE | Laden...";
    document.body.appendChild(panel);

    // Update paneel info functie
    window.updateDevPanel = (user) => {
        const uid = user ? `${user.uid.substring(0, 5)}...` : "Niet ingelogd";
        panel.textContent = `🛠️ DEV | ${user?.email || "Gast"} (${uid})`;
    };
}