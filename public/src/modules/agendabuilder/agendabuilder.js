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
let timeslots = [];

const CONTEXT = window.AGENDA_CONTEXT || 'main';
const $ = id => document.getElementById(id);
const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function confirmDialog(message) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999';
        const box = document.createElement('div');
        box.style.cssText = 'background:var(--card,#1e293b);border:1px solid var(--border,#334155);border-radius:12px;padding:24px;max-width:360px;width:90%;display:flex;flex-direction:column;gap:16px';
        const msg = document.createElement('p');
        msg.textContent = message;
        msg.style.cssText = 'margin:0;font-size:0.95rem';
        const btns = document.createElement('div');
        btns.style.cssText = 'display:flex;justify-content:flex-end;gap:10px';
        const no = document.createElement('button');
        no.textContent = 'Annuleren';
        no.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid var(--border,#334155);background:transparent;cursor:pointer;color:inherit';
        const yes = document.createElement('button');
        yes.textContent = 'Verwijderen';
        yes.style.cssText = 'padding:6px 14px;border-radius:6px;border:none;background:#ef4444;color:#fff;cursor:pointer';
        btns.append(no, yes);
        box.append(msg, btns);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        const cleanup = result => { overlay.remove(); resolve(result); };
        yes.onclick = () => cleanup(true);
        no.onclick = () => cleanup(false);
        overlay.onclick = e => { if(e.target === overlay) cleanup(false); };
    });
}

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

    sub('calendar', (data) => {
        calendars = data;
        if(CONTEXT==='main') {
            renderCalendars();
            renderConfigList('calendar', calendars, 'list-calendars');
        }
        fillSelect('sc-cal', calendars);
    });

    sub('label', (data) => {
        labels = data;
        if(CONTEXT==='main') {
            renderChips('label', labels, 'container-labels');
            renderConfigList('label', labels, 'list-labels');
        }
        fillSelect('sc-label', labels);
    });

    sub('title', (data) => {
        titles = data;
        if(CONTEXT==='main') {
            renderChips('title', titles, 'container-titles');
            renderConfigList('title', titles, 'list-titles');
        }
        fillSelect('sc-title', titles);
    });

    sub('location', (data) => {
        locations = data;
        if(CONTEXT==='main') {
            renderChips('location', locations, 'container-locations');
            renderConfigList('location', locations, 'list-locations');
        }
    });

    sub('shortcut', (data) => {
        shortcuts = data;
        renderShortcutsMain();
        renderConfigList('shortcut', shortcuts, 'list-shortcuts');
    });

    sub('timeslot', (data) => {
        timeslots = data;
        if(CONTEXT === 'main') {
            renderTimeslotChips();
            renderConfigList('timeslot', timeslots, 'list-timeslots');
        }
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
            container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        };
        container.appendChild(chip);
    });
}

function renderShortcutsMain() {
    const container = $('container-shortcuts');
    if(!container) return;
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
            subText = `${escHtml(data.start || '?')} - ${escHtml(data.end || '?')}`;
        } else {
            subText = `${escHtml(data.calendar || '-')} • ${escHtml(data.label || '')} ${escHtml(data.title || '')}`;
        }

        btn.innerHTML = `<strong>⚡ ${escHtml(sc.value)}</strong><small>${subText}</small>`;
        
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

function renderTimeslotChips() {
    const container = $('container-timeslots');
    if(!container) return;
    container.innerHTML = '';
    if(timeslots.length === 0) return;
    timeslots.forEach(item => {
        const parts = item.value.split('-');
        const startVal = parts[0];
        const endVal = parts[1];
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = item.value;
        chip.onclick = () => {
            if($('start')) $('start').value = startVal;
            if($('end')) $('end').value = endVal;
            if($('durH')) $('durH').value = '';
            if($('durM')) $('durM').value = '';
            container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        };
        container.appendChild(chip);
    });
}

function markError(id) {
    const el = $(id);
    if(!el) return;
    el.classList.add('input-error');
    const clear = () => el.classList.remove('input-error');
    el.addEventListener('input', clear, { once: true });
    el.addEventListener('change', clear, { once: true });
}

function clearErrors() {
    document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
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
            delBtn.onclick = async () => { if(await confirmDialog("Item verwijderen?")) deleteAgendaItem(item.id); };

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
            delBtn.onclick = async () => { if(await confirmDialog("Item verwijderen?")) deleteAgendaItem(item.id); };
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
        if($('repeatDays')) $('repeatDays').value = '1';
        document.querySelectorAll('.cal-btn, .chip').forEach(b => b.classList.remove("active"));
        clearErrors();
        showToast("Reset uitgevoerd", "info");
    };

    $('btnConfig').onclick = () => window.Modal.open("modal-config");

    const add = (id, type, extra={}) => {
        const el = $(id);
        if(!el) return;
        const val = el.value.trim();
        if(val) { 
            addAgendaItem({ uid: currentUser.uid, type, value: val, visible: true, ...extra }); 
            el.value = ""; 
        }
    };

    const setDate = (offsetDays) => {
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        if($('date')) $('date').value = d.toISOString().split('T')[0];
    };
    if($('btnToday')) $('btnToday').onclick = () => setDate(0);
    if($('btnTomorrow')) $('btnTomorrow').onclick = () => setDate(1);
    if($('btnNextWeek')) $('btnNextWeek').onclick = () => setDate(7);

    if($('btnAddCal')) $('btnAddCal').onclick = () => add('new-cal-name', 'calendar', { color: $('new-cal-color').value });
    if($('btnAddLabel')) $('btnAddLabel').onclick = () => add('new-label-name', 'label');
    if($('btnAddTitle')) $('btnAddTitle').onclick = () => add('new-title-name', 'title');
    if($('btnAddLocation')) $('btnAddLocation').onclick = () => add('new-location-name', 'location');

    if($('btnAddTimeslot')) $('btnAddTimeslot').onclick = () => {
        const start = $('new-ts-start')?.value;
        const end = $('new-ts-end')?.value;
        if(!start || !end) return showToast("Start en einde zijn verplicht", "error");
        addAgendaItem({ uid: currentUser.uid, type: 'timeslot', value: `${start}-${end}`, visible: true });
        $('new-ts-start').value = '';
        $('new-ts-end').value = '';
    };

    const bindEnter = (inputId, btnId) => {
        const el = $(inputId);
        if(el) el.addEventListener('keydown', e => { if(e.key === 'Enter') $(btnId)?.click(); });
    };
    bindEnter('new-cal-name', 'btnAddCal');
    bindEnter('new-label-name', 'btnAddLabel');
    bindEnter('new-title-name', 'btnAddTitle');
    bindEnter('new-location-name', 'btnAddLocation');
    bindEnter('sc-name', 'btnAddShortcut');

    if($('end')) $('end').addEventListener('input', () => {
        if($('end').value) {
            if($('durH')) $('durH').value = '';
            if($('durM')) $('durM').value = '';
        }
    });
    ['durH', 'durM'].forEach(id => {
        if($(id)) $(id).addEventListener('input', () => {
            if($(id).value && $('end')) $('end').value = '';
        });
    });

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
    const lab = $('label') ? $('label').value.trim() : "";
    const tit = $('title') ? $('title').value.trim() : "";
    const desc = $('description') ? $('description').value : "";
    const loc = $('location') ? $('location').value : "";
    const timezone = $('tz') ? $('tz').value : "Europe/Brussels";

    if(!apiConfig.token) throw new Error("⚠️ Geen Token gevonden. Stel dit in via Instellingen.");
    if(!apiConfig.webhookUrl) throw new Error("⚠️ Geen Webhook URL. Stel dit in via Instellingen.");

    if(!tit) { markError('title'); throw new Error("Titel is verplicht"); }

    const date = $('date').value;
    const startT = $('start').value;
    const endT = $('end').value;

    if(!date) { markError('date'); throw new Error("Datum ontbreekt"); }
    if(!startT) { markError('start'); throw new Error("Starttijd ontbreekt"); }

    const p = {
        token: apiConfig.token,
        calendarId: calId,
        title: [lab, tit].filter(Boolean).join(" - "),
        start: `${date}T${startT}:00`,
        end: "",
        description: desc,
        location: loc,
        tz: timezone
    };

    if(endT) {
        p.end = `${date}T${endT}:00`;
    } else {
        const dH = $('durH') ? Number($('durH').value||0) : 0;
        const dM = $('durM') ? Number($('durM').value||0) : 0;

        if(dH === 0 && dM === 0) {
            markError('durH');
            markError('durM');
            throw new Error("Geen eindtijd of duur ingevuld");
        }

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

function addDaysToDateStr(isoStr, days) {
    const [datePart, timePart] = isoStr.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    const date = new Date(y, m - 1, d + days);
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${timePart}`;
}

async function sendPost() {
    try {
        clearErrors();
        const payload = buildPayload();
        const repeatDays = Math.max(1, parseInt($('repeatDays')?.value || '1') || 1);

        showToast(repeatDays > 1 ? `${repeatDays} events verzenden...` : "Verzenden...", "info");

        let success = 0;
        let errors = 0;

        for(let i = 0; i < repeatDays; i++) {
            const dayPayload = i === 0 ? payload : {
                ...payload,
                start: addDaysToDateStr(payload.start, i),
                end: addDaysToDateStr(payload.end, i)
            };
            const res = await fetch(apiConfig.webhookUrl, {
                method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(dayPayload)
            });
            if(res.ok) success++;
            else errors++;
        }

        if(errors === 0) showToast(success > 1 ? `${success} events verzonden!` : "Verzonden!", "success");
        else showToast(`${success} verzonden, ${errors} mislukt`, "error");
    } catch(e) {
        showToast(e.message, "error");
    }
}

init();