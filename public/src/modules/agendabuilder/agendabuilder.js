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

const CONTEXT = window.AGENDA_CONTEXT || 'main';
const $ = id => document.getElementById(id);

// --- INIT ---
async function init() {
    watchUser((user) => {
        if (!user) { window.location.href = "../../../index.html"; return; }
        currentUser = user;
        document.getElementById("app").style.display = "block";
        
        loadConfig();
        setupUI();
        
        if($('date')) $('date').value = new Date().toISOString().split('T')[0];
        if($('tz') && $('tz').type !== 'hidden') $('tz').value = Intl.DateTimeFormat().resolvedOptions().timeZone;
        
        if (CONTEXT === 'partner') {
            if($('advanced-sc-options')) $('advanced-sc-options').style.display = 'none';
        }
    });
}

function loadConfig() {
    // HAAL CONFIG OP UIT CENTRALE SETTINGS
    subscribeToSettings(currentUser.uid, (data) => {
        if(data) {
            apiConfig.webhookUrl = data.webhookUrl || "";
            apiConfig.token = data.token || "";
        }
    });

    const sub = (type, cb) => subscribeToAgendaItems(currentUser.uid, type, cb);

    // HIER ZAT DE FOUT: De 'renderConfigList' aanroepen ontbraken voor de gewone items.
    
    sub('calendar', (data) => { 
        calendars = data; 
        if(CONTEXT==='main') {
            renderCalendars(); 
            renderConfigList('calendar', calendars, 'list-calendars'); // <--- Toegevoegd
        }
        fillSelect('sc-cal', calendars); 
    });

    sub('label', (data) => { 
        labels = data; 
        if(CONTEXT==='main') {
            renderChips('label', labels, 'container-labels'); 
            renderConfigList('label', labels, 'list-labels'); // <--- Toegevoegd
        }
    });

    sub('title', (data) => { 
        titles = data; 
        if(CONTEXT==='main') {
            renderChips('title', titles, 'container-titles'); 
            renderConfigList('title', titles, 'list-titles'); // <--- Toegevoegd
        }
    });

    sub('location', (data) => { 
        locations = data; 
        if(CONTEXT==='main') {
            renderChips('location', locations, 'container-locations'); 
            renderConfigList('location', locations, 'list-locations'); // <--- Toegevoegd
        }
    });

    sub('shortcut', (data) => {
        shortcuts = data;
        renderShortcutsMain();
        renderConfigList('shortcut', shortcuts, 'list-shortcuts');
    });
}

// --- RENDERING ---

function renderCalendars() {
    const container = $('container-calendars');
    if(!container) return;
    container.innerHTML = "";
    if(calendars.length === 0) { container.innerHTML = '<span class="tiny muted">Nog geen agenda\'s. Voeg toe via Beheer.</span>'; return; }

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
    if(!container) return;
    container.innerHTML = "";
    items.forEach(item => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = item.value;
        chip.onclick = () => {
            if($(type)) $(type).value = item.value;
        };
        container.appendChild(chip);
    });
}

function renderShortcutsMain() {
    const container = $('container-shortcuts');
    container.innerHTML = "";

    const filteredShortcuts = shortcuts.filter(sc => {
        const itemCtx = (sc.extra && sc.extra.context) ? sc.extra.context : 'main';
        return itemCtx === CONTEXT;
    });

    if(filteredShortcuts.length === 0) { container.innerHTML = '<span class="tiny muted">Geen snelkoppelingen.</span>'; return; }

    filteredShortcuts.forEach(sc => {
        let data = sc.extra || {};
        const btn = document.createElement("div");
        btn.className = "shortcut-btn";
        
        let subText = "";
        if (CONTEXT === 'partner') {
            subText = `${data.start || '?'} - ${data.end || '?'}`;
        } else {
            subText = `${data.calendar || '-'} • ${data.label || ''} ${data.title || ''}`;
        }

        btn.innerHTML = `<strong>⚡ ${sc.value}</strong><small>${subText}</small>`;
        
        btn.onclick = () => {
            if(data.calendar && $('calendarId')) {
                $('calendarId').value = data.calendar;
                if(document.querySelectorAll('.cal-btn').length > 0) {
                    document.querySelectorAll('.cal-btn').forEach(b => b.classList.toggle('active', b.textContent === data.calendar));
                }
            }
            if(data.label && $('label')) $('label').value = data.label;
            if(data.title && $('title')) $('title').value = data.title;
            if(data.start && $('start')) $('start').value = data.start;
            if(data.end && $('end')) $('end').value = data.end;

            showToast(`"${sc.value}" toegepast`, "success");
        };
        container.appendChild(btn);
    });
}

// --- CONFIG MODAL ---

function renderConfigList(type, items, listId) {
    const list = $(listId);
    if(!list) return;
    list.innerHTML = "";

    let itemsToShow = items;
    if (type === 'shortcut') {
        itemsToShow = items.filter(sc => {
            const itemCtx = (sc.extra && sc.extra.context) ? sc.extra.context : 'main';
            return itemCtx === CONTEXT;
        });
    }
    
    itemsToShow.forEach(item => {
        const row = document.createElement("div");
        
        if(type === 'shortcut') {
            row.className = "config-item shortcut-item";
            const data = item.extra || {};

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

            const detailsDiv = document.createElement("div");
            detailsDiv.className = "shortcut-details";

            if (CONTEXT === 'main') {
                const calSel = createSelect(calendars, data.calendar, "Agenda");
                calSel.onchange = () => updateExtra(item, 'calendar', calSel.value);
                detailsDiv.appendChild(calSel);

                const labSel = createSelect(labels, data.label, "Label");
                labSel.onchange = () => updateExtra(item, 'label', labSel.value);
                detailsDiv.appendChild(labSel);

                const titSel = createSelect(titles, data.title, "Titel");
                titSel.onchange = () => updateExtra(item, 'title', titSel.value);
                detailsDiv.appendChild(titSel);
            } else {
                const startInp = document.createElement("input"); 
                startInp.type="time"; startInp.value=data.start||""; startInp.title="Starttijd";
                startInp.onchange = () => updateExtra(item, 'start', startInp.value);
                
                const endInp = document.createElement("input"); 
                endInp.type="time"; endInp.value=data.end||""; endInp.title="Eindtijd";
                endInp.onchange = () => updateExtra(item, 'end', endInp.value);

                detailsDiv.style.gridTemplateColumns = "1fr 1fr";
                detailsDiv.appendChild(startInp);
                detailsDiv.appendChild(endInp);
            }

            row.appendChild(detailsDiv);

        } else {
            if(CONTEXT !== 'main') return; 

            row.className = "config-item";
            if(type === 'calendar') {
                const colorInput = document.createElement("input");
                colorInput.type = "color";
                colorInput.className = "color-swatch"; 
                colorInput.value = item.color || "#3b82f6";
                colorInput.onchange = () => updateAgendaItem(item.id, { color: colorInput.value });
                row.appendChild(colorInput);
            }
            const input = document.createElement("input");
            input.value = item.value;
            input.style.flex = "1";
            input.onchange = () => updateAgendaItem(item.id, { value: input.value });
            row.appendChild(input);
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
    if($('btnReset')) $('btnReset').onclick = () => {
        ['calendarId','label','title','start','end','durH','durM','location','description'].forEach(id => { if($(id)) $(id).value = ""; });
        document.querySelectorAll('.cal-btn').forEach(b => b.classList.remove("active"));
        showToast("Reset uitgevoerd", "info");
    };

    $('btnConfig').onclick = () => window.Modal.open("modal-config");

    // OUDE btnSaveApi is WEG, dus die onclick is niet meer nodig.

    const add = (id, type, extra={}) => {
        const el = $(id);
        if(!el) return;
        const val = el.value.trim();
        if(val) { 
            addAgendaItem({ uid: currentUser.uid, type, value: val, visible: true, ...extra }); 
            el.value = ""; 
        }
    };

    if($('btnAddCal')) $('btnAddCal').onclick = () => add('new-cal-name', 'calendar', { color: $('new-cal-color').value });
    if($('btnAddLabel')) $('btnAddLabel').onclick = () => add('new-label-name', 'label');
    if($('btnAddTitle')) $('btnAddTitle').onclick = () => add('new-title-name', 'title');
    if($('btnAddLocation')) $('btnAddLocation').onclick = () => add('new-location-name', 'location');

    $('btnAddShortcut').onclick = async () => {
        const name = $('sc-name').value.trim();
        if(!name) return showToast("Naam is verplicht", "error");
        
        let extra = { context: CONTEXT };
        
        if (CONTEXT === 'main') {
            extra.calendar = $('sc-cal').value;
            extra.label = $('sc-label').value;
            extra.title = $('sc-title').value;
        } else {
            extra.start = $('sc-start').value;
            extra.end = $('sc-end').value;
        }
        
        await addAgendaItem({
            uid: currentUser.uid,
            type: 'shortcut',
            value: name,
            extra: extra
        });
        $('sc-name').value = "";
        showToast("Snelkoppeling aangemaakt", "success");
    };

    if($('btnTogglePayload')) $('btnTogglePayload').onclick = () => {
        $('payloadArea').classList.toggle("open");
        if($('payloadArea').classList.contains("open")) buildPreview();
    };

    $('btnSend').onclick = sendPost;
}

// --- LOGIC ---

function buildPayload() {
    const calId = $('calendarId') ? $('calendarId').value : "prive";
    const lab = $('label') ? $('label').value : "";
    const tit = $('title') ? $('title').value : "Afspraak";
    const desc = $('description') ? $('description').value : "";
    const loc = $('location') ? $('location').value : "";
    const timezone = $('tz') ? $('tz').value : "Europe/Brussels";
    
    // VALIDATIE OP TOKEN
    if(!apiConfig.token) throw new Error("⚠️ Geen Token gevonden. Stel dit in via Instellingen.");
    if(!apiConfig.webhookUrl) throw new Error("⚠️ Geen Webhook URL. Stel dit in via Instellingen.");
    
    const p = {
        token: apiConfig.token,
        calendarId: calId,
        title: [lab, tit].filter(Boolean).join(" - "),
        start: "", end: "",
        description: desc,
        location: loc,
        tz: timezone
    };

    const date = $('date').value;
    const startT = $('start').value;
    const endT = $('end').value;

    if(!date || !startT) throw new Error("Datum/Start ontbreekt");

    p.start = `${date}T${startT}:00`;

    if(endT) {
        p.end = `${date}T${endT}:00`;
    } else {
        const dH = $('durH') ? Number($('durH').value||0) : 0;
        const dM = $('durM') ? Number($('durM').value||0) : 0;
        
        if(dH === 0 && dM === 0) throw new Error("Geen eindtijd of duur ingevuld");
        
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
        if($('resultJson')) $('resultJson').textContent = JSON.stringify(payload, null, 2);
    } catch (e) {
        if($('resultJson')) $('resultJson').textContent = "⚠️ " + e.message;
    }
}

async function sendPost() {
    try {
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

init();