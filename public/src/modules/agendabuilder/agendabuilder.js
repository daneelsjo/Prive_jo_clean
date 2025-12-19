import { getCurrentUser, watchUser } from "../../services/auth.js";
import { showToast } from "../../components/toast.js";
import { 
    updateSettings, subscribeToSettings,
    subscribeToAgendaItems, addAgendaItem, updateAgendaItem, deleteAgendaItem 
} from "../../services/db.js";

// State
let currentUser = null;
let apiConfig = { webhookUrl: "", token: "" };
let calendars = [];
let labels = [];
let titles = [];
let locations = [];
let shortcuts = [];

const $ = id => document.getElementById(id);

// --- INIT ---
async function init() {
    watchUser((user) => {
        if (!user) { window.location.href = "../../../index.html"; return; }
        currentUser = user;
        document.getElementById("app").style.display = "block";
        
        loadConfig();
        setupUI();
        
        // Defaults
        $('date').value = new Date().toISOString().split('T')[0];
        $('tz').value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    });
}

function loadConfig() {
    subscribeToSettings(currentUser.uid, (data) => {
        if(data) {
            apiConfig.webhookUrl = data.webhookUrl || "";
            apiConfig.token = data.token || "";
            $('cfg-webhook').value = apiConfig.webhookUrl;
            $('cfg-token').value = apiConfig.token;
        }
    });

    const sub = (type, cb) => subscribeToAgendaItems(currentUser.uid, type, cb);

    sub('calendar', (data) => {
        calendars = data;
        renderCalendars();
        renderConfigList('calendar', calendars, 'list-calendars');
        fillSelect('sc-cal', calendars); 
    });

    sub('label', (data) => {
        labels = data;
        renderChips('label', labels, 'container-labels');
        renderConfigList('label', labels, 'list-labels');
        fillSelect('sc-label', labels);
    });

    sub('title', (data) => {
        titles = data;
        renderChips('title', titles, 'container-titles');
        renderConfigList('title', titles, 'list-titles');
        fillSelect('sc-title', titles); // Nieuw: dropdown voor titels vullen
    });

    sub('location', (data) => {
        locations = data;
        renderChips('location', locations, 'container-locations');
        renderConfigList('location', locations, 'list-locations');
    });

    sub('shortcut', (data) => {
        shortcuts = data;
        renderShortcutsMain();
        renderConfigList('shortcut', shortcuts, 'list-shortcuts');
    });
}

// --- RENDERING MAIN UI ---

function renderCalendars() {
    const container = $('container-calendars');
    container.innerHTML = "";
    if(calendars.length === 0) { container.innerHTML = '<span class="tiny muted">Nog geen agenda\'s.</span>'; return; }

    calendars.forEach(cal => {
        const btn = document.createElement("button");
        btn.className = "chip cal-btn";
        btn.textContent = cal.value;
        btn.style.backgroundColor = cal.color || "#3b82f6";
        btn.onclick = () => {
            $('calendarId').value = cal.value;
            container.querySelectorAll('.cal-btn').forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
        };
        container.appendChild(btn);
    });
}

function renderChips(type, items, containerId) {
    const container = $(containerId);
    container.innerHTML = "";
    items.forEach(item => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = item.value;
        chip.onclick = () => {
            const targetMap = { label: 'label', title: 'title', location: 'location' };
            $(targetMap[type]).value = item.value;
        };
        container.appendChild(chip);
    });
}

function renderShortcutsMain() {
    const container = $('container-shortcuts');
    container.innerHTML = "";
    if(shortcuts.length === 0) { container.innerHTML = '<span class="tiny muted">Nog geen snelkoppelingen.</span>'; return; }

    shortcuts.forEach(sc => {
        let data = sc.extra || {};
        const btn = document.createElement("div");
        btn.className = "shortcut-btn";
        btn.innerHTML = `
            <strong>⚡ ${sc.value}</strong>
            <small>${data.calendar || '-'} • ${data.label || ''} ${data.title || ''}</small>
        `;
        btn.onclick = () => {
            if(data.calendar) {
                $('calendarId').value = data.calendar;
                document.querySelectorAll('.cal-btn').forEach(b => b.classList.toggle('active', b.textContent === data.calendar));
            }
            if(data.label) $('label').value = data.label;
            if(data.title) $('title').value = data.title;
            showToast(`Snelkoppeling "${sc.value}" toegepast`, "success");
        };
        container.appendChild(btn);
    });
}

// --- RENDERING CONFIG (CRUCIAAL VOOR BEWERKEN) ---

function renderConfigList(type, items, listId) {
    const list = $(listId);
    list.innerHTML = "";
    
    items.forEach(item => {
        const row = document.createElement("div");
        
        if(type === 'shortcut') {
            // --- SNELKOPPELING EDIT MODUS (MET DROPDOWNS) ---
            row.className = "config-item shortcut-item";
            const data = item.extra || {};

            // Header: Naam + Delete
            const headerDiv = document.createElement("div");
            headerDiv.style.display = "flex"; headerDiv.style.gap = "10px"; headerDiv.style.gridColumn = "1/-1";
            
            const nameInput = document.createElement("input");
            nameInput.value = item.value;
            nameInput.style.flex = "1";
            nameInput.onchange = () => updateAgendaItem(item.id, { value: nameInput.value });

            const delBtn = document.createElement("button");
            delBtn.className = "del-btn";
            delBtn.textContent = "🗑️";
            delBtn.onclick = () => { if(confirm("Verwijderen?")) deleteAgendaItem(item.id); };

            headerDiv.appendChild(nameInput);
            headerDiv.appendChild(delBtn);
            row.appendChild(headerDiv);

            // Details: Dropdowns
            const detailsDiv = document.createElement("div");
            detailsDiv.className = "shortcut-details";

            // Agenda Kieser
            const calSel = createSelect(calendars, data.calendar, "Agenda");
            calSel.onchange = () => updateExtra(item, 'calendar', calSel.value);
            detailsDiv.appendChild(calSel);

            // Label Kieser
            const labSel = createSelect(labels, data.label, "Label");
            labSel.onchange = () => updateExtra(item, 'label', labSel.value);
            detailsDiv.appendChild(labSel);

            // Titel Kieser (of tekst)
            // We gebruiken de lijst van titels om een dropdown te maken
            const titSel = createSelect(titles, data.title, "Titel");
            titSel.onchange = () => updateExtra(item, 'title', titSel.value);
            detailsDiv.appendChild(titSel);

            row.appendChild(detailsDiv);

        } else {
            // --- STANDAARD ITEM (AGENDA, LABEL, TITEL) ---
            row.className = "config-item";
            
            // Kleur (Alleen Agenda)
            if(type === 'calendar') {
                const colorInput = document.createElement("input");
                colorInput.type = "color";
                colorInput.className = "color-swatch"; 
                colorInput.value = item.color || "#3b82f6";
                colorInput.onchange = () => updateAgendaItem(item.id, { color: colorInput.value });
                row.appendChild(colorInput);
            }

            // Naam Input
            const input = document.createElement("input");
            input.value = item.value;
            input.style.flex = "1";
            input.onchange = () => updateAgendaItem(item.id, { value: input.value });
            row.appendChild(input);

            // Delete
            const delBtn = document.createElement("button");
            delBtn.className = "del-btn";
            delBtn.textContent = "🗑️";
            delBtn.onclick = () => { if(confirm("Verwijderen?")) deleteAgendaItem(item.id); };
            row.appendChild(delBtn);
        }

        list.appendChild(row);
    });
}

function createSelect(options, currentVal, placeholder) {
    const sel = document.createElement("select");
    const empty = document.createElement("option");
    empty.value = ""; empty.textContent = `(geen ${placeholder})`;
    sel.appendChild(empty);
    
    options.forEach(opt => {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.value;
        if(opt.value === currentVal) o.selected = true;
        sel.appendChild(o);
    });
    return sel;
}

async function updateExtra(item, field, val) {
    const newExtra = { ...item.extra, [field]: val };
    await updateAgendaItem(item.id, { extra: newExtra });
}

function fillSelect(id, items) {
    const sel = $(id);
    if(!sel) return;
    sel.innerHTML = '<option value="">- Kies -</option>';
    items.forEach(i => {
        const opt = document.createElement("option");
        opt.value = i.value;
        opt.textContent = i.value;
        sel.appendChild(opt);
    });
}

// --- UI EVENTS ---

function setupUI() {
    $('btnReset').onclick = () => {
        ['calendarId','label','title','start','end','durH','durM','location','description'].forEach(id => $(id).value = "");
        document.querySelectorAll('.cal-btn').forEach(b => b.classList.remove("active"));
        showToast("Reset uitgevoerd", "info");
    };

    $('btnConfig').onclick = () => window.Modal.open("modal-config");

    $('btnSaveApi').onclick = async () => {
        await updateSettings(currentUser.uid, { webhookUrl: $('cfg-webhook').value.trim(), token: $('cfg-token').value.trim() });
        showToast("Opgeslagen", "success");
    };

    const add = (id, type, extra={}) => {
        const val = $(id).value.trim();
        if(val) { 
            addAgendaItem({ uid: currentUser.uid, type, value: val, visible: true, ...extra }); 
            $(id).value = ""; 
        }
    };

    $('btnAddCal').onclick = () => add('new-cal-name', 'calendar', { color: $('new-cal-color').value });
    $('btnAddLabel').onclick = () => add('new-label-name', 'label');
    $('btnAddTitle').onclick = () => add('new-title-name', 'title');
    $('btnAddLocation').onclick = () => add('new-location-name', 'location');

    $('btnAddShortcut').onclick = async () => {
        const name = $('sc-name').value.trim();
        if(!name) return showToast("Naam is verplicht", "error");
        
        await addAgendaItem({
            uid: currentUser.uid,
            type: 'shortcut',
            value: name,
            extra: { 
                calendar: $('sc-cal').value, 
                label: $('sc-label').value, 
                title: $('sc-title').value 
            }
        });
        $('sc-name').value = "";
        showToast("Snelkoppeling aangemaakt", "success");
    };

    $('btnTogglePayload').onclick = () => {
        $('payloadArea').classList.toggle("open");
        if($('payloadArea').classList.contains("open")) buildPreview();
    };

    $('btnSend').onclick = sendPost;
}

// --- LOGIC ---

function buildPayload() {
    const p = {
        token: apiConfig.token,
        calendarId: $('calendarId').value || "prive",
        title: [$('label').value, $('title').value].filter(Boolean).join(" - "),
        start: "", end: "",
        description: $('description').value,
        location: $('location').value,
        tz: $('tz').value
    };

    if(!p.token) throw new Error("Geen Token");
    if(!p.title) throw new Error("Titel is leeg");
    if(!$('date').value || !$('start').value) throw new Error("Datum/Start ontbreekt");

    const date = $('date').value;
    const startT = $('start').value;
    const endT = $('end').value;
    
    p.start = `${date}T${startT}:00`;

    if(endT) {
        p.end = `${date}T${endT}:00`;
    } else {
        const dH = Number($('durH').value||0);
        const dM = Number($('durM').value||0);
        if(dH === 0 && dM === 0) throw new Error("Geen eindtijd/duur");
        
        const sDate = new Date(p.start);
        sDate.setHours(sDate.getHours() + dH);
        sDate.setMinutes(sDate.getMinutes() + dM);
        const offset = sDate.getTimezoneOffset() * 60000;
        p.end = (new Date(sDate - offset)).toISOString().slice(0, -1).split('.')[0];
    }
    return p;
}

function buildPreview() {
    try {
        const payload = buildPayload();
        $('resultJson').textContent = JSON.stringify(payload, null, 2);
        const url = new URL(apiConfig.webhookUrl);
        Object.keys(payload).forEach(key => url.searchParams.append(key, payload[key]));
        $('resultUrl').textContent = url.toString();
    } catch (e) {
        $('resultJson').textContent = "⚠️ " + e.message;
    }
}

async function sendPost() {
    try {
        if(!apiConfig.webhookUrl) throw new Error("Geen Webhook URL");
        const payload = buildPayload();
        showToast("Verzenden...", "info");

        const res = await fetch(apiConfig.webhookUrl, {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
        });
        
        if(res.ok) showToast("Verzonden! 🎉", "success");
        else showToast("Fout: " + res.status, "error");
    } catch(e) {
        showToast(e.message, "error");
    }
}

// Start
init();