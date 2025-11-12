To-Do & Notes Jo

Een lichte, modulair opgebouwde webapp om post-its/taken, notities en snelkoppelingen te beheren. Pure HTML/CSS/JS aan de voorkant met Firebase (Auth + Firestore) als backend.

Inhoudsopgave

Architectuur & mapstructuur

Belangrijkste features

Getting Started

Pagina’s

Data-model (Firestore)

Modals

Navigatie (neon menu, quick links & zijmenu)

Styling & thema

Veelvoorkomende aanpassingen

Troubleshooting

Changelog – recente fixes/verbeteringen

Architectuur & mapstructuur
index.html                 → Post-its / taken
notes.html                 → Notities
settings.html              → Categorieën, kleuren, thema, slots (Werk/Privé)

partials/
  header.html              → Topbar, neon hoofdmenu, hamburger + zijmenu
  modals.html              → Alle modals (task, note, alert)

CSS/
  main.css                 → Basisthema (licht/donker), knoppen, modals, topbar/sidemenu
  components-menu.css      → Neon hoofdmenu + submenu’s
  components-sidemenu.css  → Zijmenu/drawer
  page-index.css           → Lay-out index (post-its, “Alle taken”)
  page-settings.css        → Lay-out settings
  page-notes.css           → Lay-out notes

Script/Javascript/
  include-partials.js      → Laadt partials en vuurt 'partials:loaded'
  menu.js                  → Neon menu, quick links, hamburger/zijmenu (incl. accordion)
  modal.js                 → Herbruikbare modals (open/close/alert, ESC, backdrop, focustrap)
  firebase-config.js       → Firebase bootstrap + exports
  main.js                  → Post-its/taken, modus-schakelaar, “Alle taken” tabel
  settings.js              → Categoriebeheer (kleuren), modus-slots, thema
  notes.js                 → Notities CRUD + modal


Scripts volgorde (belangrijk):
include-partials.js → menu.js → pagina-specifiek script (main.js/settings.js/notes.js).

Belangrijkste features

Google sign-in met Firebase Auth.

Thema’s: licht, donker of systeem (instelbaar in Settings; onthouden in Firestore).

Categorieën met vast kleurenpalet (15 kleuren). Hernoemen/archiveren via eigen modals.

Post-its per modus (Werk/Privé): 6 slots; elke post-it is 1 categorie.
Taken tonen prio-bolletje en optionele deadline. Klikken = bewerken in modal (niet auto-complete).

“Alle taken”: brede tabel over de volle grid-breedte, gegroepeerd per categorie, prio-dot als eerste kolom, Voltooid (✓ of datum). Zoeken via veld.

Notities: lijst + modal (nieuw/bewerken).

Topbar met neon hoofdmenu en quick links (wisselen per pagina).

Hamburger/zijmenu met accordion (één sectie tegelijk open), backdrop, ESC-close en scroll-lock.

Getting Started
1) Vereisten

Een Firebase project met Authentication en Cloud Firestore.

In Auth → Sign-in method: Google inschakelen.

Firestore in Production mode (met passende security rules).

2) Configuratie

Open Script/Javascript/firebase-config.js en vul jouw Firebase config (apiKey, projectId, enz.).
Tip: beperk de API key in Google Cloud Console (API-restricties & HTTP-referers).

3) Lokaal draaien

Gebruik een statische server (modules werken niet via file://):

# optie A: npx serve
npx serve .

# optie B: Python
python -m http.server 8080


Surf dan naar http://localhost:3000 (serve) of http://localhost:8080 (Python).

4) Deploy

GitHub Pages: publiceer de root als static site.

Firebase Hosting: firebase init hosting → build is niet nodig (statisch) → firebase deploy.

Pagina’s
index.html — Post-its & taken

Modus-schakelaar (Werk/Privé).

Post-its (max. 2 rijen, autom. kolommen). Titel gecentreerd en onderlijnd.

Klik op taak = taak-modal (bewerken, voltooien/heropenen, verwijderen).

Rechterkolom: + NIEUW (open modal) en Overige taken (zonder post-it).

“Alle taken”
De knop 📁 ALLE TAKEN (rechts) opent onderaan de grid een paneel over de volle breedte met de tabel. Sluiten brengt je terug naar de standaard layout.

settings.html — Categorieën & thema

Nieuwe categorie toevoegen (type: Werk/Privé).

Kleur kiezen uit vast palet (geen hex).

Hernoemen via modal; archiveren i.p.v. verwijderen.

Post-its per modus: 6 slots met categorie-keuze.

Thema: licht/donker/systeem (opgeslagen in user-settings).

notes.html — Notities

Lijstweergave met datum.

Nieuw/bewerken via modal (titel, tekst, datum/tijd).

Data-model (Firestore)

Collecties

todos
title, description, link, startDate, endDate, priority (0–3), categoryId, uid, createdAt, done, completedAt

categories
name, type ("werk"|"prive"), color, active

settings/{uid}
preferredMode, theme, modeSlots: { werk: [6×{categoryId}], prive: [6×{categoryId}] }

notes
title, body, when, uid, createdAt

Security rule tip (indicatief)

match /databases/{db}/documents {
  function isOwner(uid) { return request.auth != null && request.auth.uid == uid; }

  match /todos/{id} {
    allow read, write: if isOwner(resource.data.uid);
  }
  match /notes/{id} {
    allow read, write: if isOwner(resource.data.uid);
  }
  match /settings/{uid} {
    allow read, write: if isOwner(uid);
  }
  match /categories/{id} {
    // openbaar lezen mag; schrijf-acties beperken indien nodig
    allow read: if true;
    allow write: if false; // of rol-gebaseerd
  }
}

Modals

Gedeeld Modal-object (modal.js):

Modal.open(id) / Modal.close()

Modal.alert({ title, html })

Backdrop, klik-buiten, ESC, focus trap en focus restore.

Alle markup staat in partials/modals.html.

Navigatie (neon menu, quick links & zijmenu)

Neon hoofdmenu (top): pure text-glow; subtiele hover-pulse.

Quick links rechtsboven (pictogrammen):

Index: Notities & Instellingen

Settings: Post-its & Notities

Notes: Post-its & Instellingen

Zijmenu (hamburger):

Accordion: secties starten dicht; één open tegelijk.

Drawer met translateX, backdrop, ESC, scroll-lock.

Links openen standaard in een nieuw tabblad (via data-newtab).

Aanpassingen:

Neon menu & zijmenu-links → partials/header.html

Quick links logica → Script/Javascript/menu.js

Styling & thema

Basisthema in CSS/main.css (CSS custom properties).

Pagina-specifieke layout in page-*.css.

Donker/licht wissel via data-theme op <html>; instelling in Firestore.

Veelvoorkomende aanpassingen

Quick links wijzigen → menu.js (setHeaderQuickLinks()).

Neon menu items/submenu’s → partials/header.html + components-menu.css.

Zijmenu secties/links → partials/header.html (accordion werkt automatisch).

Kleurenpalet categorieën → settings.js (fixedColors).

Post-its layout (2 rijen) → page-index.css (#postits.postits-row).

Tabel styling (kolombreedtes, groepstitel centreren) → page-index.css.

Troubleshooting

Partials niet zichtbaar / scripts breken
Zorg dat include-partials.js vóór menu.js en vóór het pagina-script staat. Wacht bij binden desnoods op het event partials:loaded.

“Alle taken” paneel is niet breed
#allTasksPanel moet direct child van .page zijn (sibling van <main> en <aside>).
#allTasksTable is een <table> (geen <div>).

Zijmenu schuift niet in beeld
Controleer of er geen conflicterende CSS is; de drawer gebruikt inline-styles (transform, left, display). Zet menu.js als laatste algemene script.

Datumvelden/donkere modus icoontjes onleesbaar
In page-index.css staat een filter op de date-picker indicator voor dark-mode.

Niets gebeurt bij “+ NIEUW”
Modals moeten geladen zijn (partial modals.html) vóór modal.js en het pagina-script.

Changelog – recente fixes/verbeteringen

Robuuste zijmenu-drawer (inline styles, backdrop, ESC, body-lock) en accordion (één open).

Quick links per pagina in de topbar.

Neon hoofdmenu herwerkt (geen draaiende frames, wel glow/hover-pulse).

Modal-systeem herschreven (open/close/alert, focustrap, backdrop, ESC).

Taak-modal: nieuw/bewerken, link openen, Voltooien/Heropenen, verwijderen.

Post-its: klik = bewerken (niet auto-complete), titel gecentreerd/onderlijnd, 2-rijen grid.

“Alle taken”: full-width paneel; prio-dot vooraan; groeperen per categorie; Voltooid toont ✓ of datum; zoeken.

Settings: kleurkeuze uit vast palet; hernoemen via modal; 6 slots/ modus; thema-instelling.

Partials-loader + idempotente binding om dubbele events te voorkomen.

Diverse bugfixes (imports, where, event-binding, DOM-selecties, layout).