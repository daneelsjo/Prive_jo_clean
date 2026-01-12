import { getCurrentUser, watchUser } from "../../services/auth.js";
import { 
  updateSettings, subscribeToSettings, 
  db, collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot, query, orderBy 
} from "../../services/db.js";
import { showToast } from "../../components/toast.js";

const $ = id => document.getElementById(id);

let currentUser = null;
let currentSettings = {};
let globalLinks = [];

// --- INIT ---
async function init() {
  watchUser((user) => {
    if (!user) { window.location.href = "../../../index.html"; return; }
    currentUser = user;
    $('app').style.display = 'block';

    // 1. Laad Settings (Sticknotes, Agenda, Admin)
    subscribeToSettings(user.uid, (data) => {
      currentSettings = data || {};
      renderSticknotesSettings();
      renderAgendaSettings();
      renderAdminSettings(); // <--- Nieuw: Thema zit nu hier
    });

    // 2. Laad Global Links (CMS)
    subscribeToGlobalLinks(); // <--- Nieuw
    
    // 3. Start Events
    setupTabs(); // <--- Nieuw
    setupSticknotesEvents();
    setupAgendaEvents();
    setupLinksEvents(); // <--- Nieuw
    setupAdminEvents(); // <--- Nieuw
  });
}

// --- TABS LOGICA ---
function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const targetId = btn.dataset.tab;
            $(targetId).classList.add('active');
        });
    });
}

// --- MODULE 1: STICKNOTES ---
function renderSticknotesSettings() {
  // A. Categorieën renderen
  const list = $('catList');
  if (list) {
      list.innerHTML = '';
      const cats = currentSettings.categories || [];
      
      cats.forEach((cat, index) => {
        const div = document.createElement('div');
        div.className = 'chip';
        div.style.backgroundColor = cat.type === 'werk' ? '#bfdbfe' : '#bbf7d0'; 
        div.style.color = '#1e293b';
        div.style.padding = '5px 10px'; div.style.borderRadius = '15px'; div.style.display='inline-flex'; div.style.gap='8px'; div.style.alignItems='center'; div.style.margin='4px';
        div.innerHTML = `
          <span>${cat.name} <small style="opacity:0.6">(${cat.type})</small></span>
          <span style="cursor:pointer; font-weight:bold; color:#ef4444;" onclick="window.removeCat(${index})">×</span>
        `;
        list.appendChild(div);
      });
  }

  // B. Modus Switch renderen
  const switchEl = $('modeSwitchSettings');
  if(switchEl) {
      // Als currentSettings.mode 'work' is, staat vinkje AAN (of juist andersom, afhankelijk van je CSS)
      // Check even in sticknotes.js hoe je dit gebruikt. Vaak is checked = work.
      switchEl.checked = (currentSettings.mode === 'work');
  }
}

function renderAdminSettings() {
    const theme = currentSettings.theme || 'system';
    const radio = document.querySelector(`input[name="theme"][value="${theme}"]`);
    if(radio) radio.checked = true;
}

function setupAdminEvents() {
    const btn = $('saveTheme');
    if(btn) {
        btn.onclick = async () => {
            const theme = document.querySelector('input[name="theme"]:checked').value;
            await updateSettings(currentUser.uid, { theme });
            localStorage.setItem('theme_pref', theme);
            location.reload(); 
        };
    }
}

function setupSticknotesEvents() {
    // 1. Categorie verwijderen
    window.removeCat = async (index) => {
        if(!confirm("Categorie verwijderen?")) return;
        const newCats = [...(currentSettings.categories || [])];
        newCats.splice(index, 1);
        await updateSettings(currentUser.uid, { categories: newCats });
    };

    // 2. Categorie toevoegen
    const btnAdd = $('addCat');
    if(btnAdd) {
        btnAdd.onclick = async () => {
            const name = $('catName').value.trim();
            const type = $('catType').value;
            if(!name) return;
            const newCats = [...(currentSettings.categories || []), { name, type }];
            await updateSettings(currentUser.uid, { categories: newCats });
            $('catName').value = '';
        };
    }

    // 3. Modus Switch (Direct opslaan bij klikken)
    const switchEl = $('modeSwitchSettings');
    if(switchEl) {
        switchEl.onchange = async () => {
            const newMode = switchEl.checked ? 'work' : 'prive';
            await updateSettings(currentUser.uid, { mode: newMode });
            showToast(`Modus gewijzigd naar: ${newMode}`, "success");
        };
    }

    // 4. Opslaan knop (voor extra zekerheid of slots)
    const btnMode = $('saveModeSlots');
    if(btnMode) {
        btnMode.onclick = () => showToast("Instellingen opgeslagen", "success");
    }
}

// --- MODULE 2: AGENDA (Webhook) ---
function renderAgendaSettings() {
    if($('cfg-webhook')) $('cfg-webhook').value = currentSettings.webhookUrl || "";
    if($('cfg-token')) $('cfg-token').value = currentSettings.token || "";
}

function setupAgendaEvents() {
    $('btnSaveAgenda').onclick = async () => {
        const url = $('cfg-webhook').value.trim();
        const token = $('cfg-token').value.trim();
        
        await updateSettings(currentUser.uid, { 
            webhookUrl: url,
            token: token
        });
        showToast("Agenda connectie opgeslagen!", "success");
    };
}


// --- MODULE 3: LINKS CMS (Nieuw) ---

// --- LINKS LOGICA ---

function subscribeToGlobalLinks() {
    const q = query(collection(db, "globalLinks"), orderBy("order", "asc"));
    onSnapshot(q, (snapshot) => {
        globalLinks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderLinksTable();
        updateCategoryDropdown(); // <--- Dropdown vullen bij laden
    });
}

function renderLinksTable() {
    const tbody = document.querySelector('#linksTable tbody');
    if(!tbody) return;
    tbody.innerHTML = "";

    if(globalLinks.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Geen links. Klik op "Nieuwe Link".</td></tr>`;
        return;
    }

    globalLinks.forEach(link => {
        const tr = document.createElement('tr');
        
        let badges = "";
        if(link.locations?.landing) badges += "🏠 ";
        if(link.locations?.sidebar) badges += "📂 ";
        if(link.locations?.navbar) badges += "🔝 ";

        tr.innerHTML = `
            <td><strong>${link.title}</strong><br><small class="text-muted">${link.url}</small></td>
            <td>${badges}</td>
            <td><span class="chip">${link.category || '-'}</span></td>
            <td>
                <button class="ghost small" onclick="window.editLink('${link.id}')">✏️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function setupLinksEvents() {
    
    // 1. WEDERZIJDSE UITSLUITING (Sidebar <-> Mainbar)
    const sb = $('show-sidebar');
    const nb = $('show-navbar');
    
    const handleToggle = (source) => {
        // Als Sidebar de trigger is en AAN gaat -> Mainbar UIT en DISABLE
        if (source === 'sidebar' && sb.checked) {
            nb.checked = false;
            nb.disabled = true;
        } 
        // Als Mainbar de trigger is en AAN gaat -> Sidebar UIT en DISABLE
        else if (source === 'navbar' && nb.checked) {
            sb.checked = false;
            sb.disabled = true;
        }
        // Als een van beide UIT gaat -> Check of de ander weer vrijgegeven mag worden
        else {
            if (!sb.checked) nb.disabled = false;
            if (!nb.checked) sb.disabled = false;
        }
        
        // Visuele feedback (optioneel, voor labels)
        $('label-navbar').style.opacity = nb.disabled ? "0.5" : "1";
        // Zoek de parent van sidebar checkbox voor label styling als je wilt
        sb.parentElement.nextElementSibling.style.opacity = sb.disabled ? "0.5" : "1";
    };

    sb.onchange = () => handleToggle('sidebar');
    nb.onchange = () => handleToggle('navbar');

    // 2. CATEGORIE WISSELAAR (Select vs Input)
    $('btn-toggle-cat-input').onclick = () => {
        const select = $('link-cat-select');
        const input = $('link-cat-input');
        
        if (input.style.display === 'none') {
            // Overschakelen naar typen
            input.style.display = 'block';
            select.style.display = 'none';
            input.focus();
            input.value = select.value; // Neem huidige keuze over
        } else {
            // Terug naar selecteren
            input.style.display = 'none';
            select.style.display = 'block';
            updateCategoryDropdown(); // Ververs lijstje voor zekerheid
        }
    };

    // 3. NIEUWE LINK
    $('btnNewLink').onclick = () => {
        resetLinkForm();
        handleToggle(); // Reset de toggles naar correcte staat
        window.Modal.open('modal-link-edit');
    };

    // 4. BEWERKEN
    window.editLink = (id) => {
        const link = globalLinks.find(l => l.id === id);
        if(!link) return;

        $('link-id').value = link.id;
        $('link-title').value = link.title;
        $('link-url').value = link.url;
        $('link-target').value = link.target || "_blank";
        $('link-order').value = link.order || 10;
        
        // Categorie logica: bestaat hij in de lijst?
        const currentCat = link.category || "";
        const select = $('link-cat-select');
        const input = $('link-cat-input');
        
        // Check of categorie in de dropdown opties zit
        let found = false;
        for(let i=0; i<select.options.length; i++) {
            if(select.options[i].value === currentCat) {
                select.selectedIndex = i;
                found = true;
                break;
            }
        }

        if (found || currentCat === "") {
            // Bestaande categorie -> Toon Select
            select.style.display = 'block';
            input.style.display = 'none';
            if(currentCat === "") select.value = "";
        } else {
            // Nieuwe/Unieke categorie -> Toon Input
            select.style.display = 'none';
            input.style.display = 'block';
            input.value = currentCat;
        }
        
        // Locaties
        $('show-landing').checked = link.locations?.landing || false;
        $('show-sidebar').checked = link.locations?.sidebar || false;
        $('show-navbar').checked = link.locations?.navbar || false;

        // Reset disabled states correct op basis van de ingeladen data
        if ($('show-sidebar').checked) {
            $('show-navbar').disabled = true;
        } else if ($('show-navbar').checked) {
            $('show-sidebar').disabled = true;
        } else {
            $('show-navbar').disabled = false;
            $('show-sidebar').disabled = false;
        }

        $('btnDeleteLink').style.display = 'inline-block';
        window.Modal.open('modal-link-edit');
    };

    // 5. OPSLAAN
    $('btnSaveLink').onclick = async () => {
        const id = $('link-id').value;
        
        // Welke categorie waarde gebruiken we?
        const select = $('link-cat-select');
        const input = $('link-cat-input');
        const finalCat = (input.style.display !== 'none') ? input.value : select.value;

        const data = {
            title: $('link-title').value,
            url: $('link-url').value,
            target: $('link-target').value,
            order: Number($('link-order').value),
            category: finalCat,
            locations: {
                landing: $('show-landing').checked,
                sidebar: $('show-sidebar').checked,
                navbar: $('show-navbar').checked 
            }
        };

        if(!data.title || !data.url) return showToast("Titel/URL verplicht", "error");

        try {
            if(id) await updateDoc(doc(db, "globalLinks", id), data);
            else await addDoc(collection(db, "globalLinks"), data);
            
            window.Modal.close();
            showToast("Link opgeslagen", "success");
        } catch(e) { console.error(e); showToast("Fout bij opslaan", "error"); }
    };

    // 6. VERWIJDEREN
    $('btnDeleteLink').onclick = async () => {
        const id = $('link-id').value;
        if(id && confirm("Verwijderen?")) {
            await deleteDoc(doc(db, "globalLinks", id));
            window.Modal.close();
        }
    };
}

// Helper: Vult de dropdown met unieke categorieën uit de database
function updateCategoryDropdown() {
    const uniqueCats = [...new Set(globalLinks.map(l => l.category).filter(Boolean))];
    uniqueCats.sort();
    
    const select = $('link-cat-select');
    if(!select) return;

    // Bewaar huidige selectie indien mogelijk
    const currentVal = select.value;

    select.innerHTML = '<option value="">- Geen categorie -</option>';
    uniqueCats.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        select.appendChild(option);
    });

    // Probeer oude waarde te herstellen
    select.value = currentVal;
}
// Helpers voor Links
function updateCategorySuggestions() {
    const uniqueCats = [...new Set(globalLinks.map(l => l.category).filter(Boolean))];
    uniqueCats.sort();
    const datalist = document.getElementById('cat-suggestions');
    if(datalist) {
        datalist.innerHTML = "";
        uniqueCats.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            datalist.appendChild(option);
        });
    }
}

function resetLinkForm() {
    $('link-id').value = "";
    $('link-title').value = "";
    $('link-url').value = "";
    $('link-target').value = "_blank";
    $('link-order').value = 10;
    
    // Reset naar select modus
    $('link-cat-select').value = "";
    $('link-cat-select').style.display = 'block';
    $('link-cat-input').style.display = 'none';
    $('link-cat-input').value = "";

    $('show-landing').checked = true;
    $('show-sidebar').checked = false;
    $('show-navbar').checked = false;
    
    // Reset disabled states
    $('show-sidebar').disabled = false;
    $('show-navbar').disabled = false;
    $('label-navbar').style.opacity = "1";

    $('btnDeleteLink').style.display = 'none';
    $('btnSaveLink').disabled = false;
}

init();