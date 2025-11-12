README – Kernsamenvatting huidig project
Projectnaam
Firebase To-Do & Notes Webapp

Hoofdfuncties
- Login via Google (Firebase Auth)
- Post-it weergave met maximaal 6 vaste categorie-slots
- Ongecategoriseerde taken aan de rechter kant van het scherm

Takenbeheer

- Toevoegen, bewerken, verwijderen
- Start- en einddatum
- Prioriteit (kleurcode)
- Omschrijving & link
- Categorie kiezen of nieuw aanmaken

Voltooide taken

- Alleen zichtbaar in "Alle taken" lijst
-Automatisch verwijderen na 90 dagen

Alle taken paneel

- Uitklapbaar
- Groeperen per categorie
- Zoekfunctie (naam, datum, prio, omschrijving)

Modi: Werk / Privé

- Toggle bovenaan pagina
- Filtert post-its en alle taken

Extra pagina's

settings.html → categorieën instellen

notes.html → notities van vergaderingen maken en bewerken

Mappenstructuur

project-root/
│ index.html
│
├── HTML/
│   ├── settings.html
│   ├── notes.html
│   └── header.html (inclusief navigatieknoppen)
│
├── partials/
│   └── header.html
│
├── CSS/
│   ├── main.css
│   ├── page-settings.css
│   ├── page-notes.css
│   ├── page-index.css
│   ├── components-menu.css
│   └── components-sidemenu.css
│
├── IMG/
│   ├── JD_Web_Solutions.ico
│   └── JD_Web_Solutions.jpg
│
└── Script/
    ├── Javascript/
    │   ├── main.js  (hoofd functionaliteit: takenbeheer)
    │   ├── settings.js (categoriebeheer)
    │   ├── notes.js (notities beheren)
    │   ├── include-partials.js 
    │   └── menu.js  (navigatieknoppen logica)



Belangrijke afspraken in code
- Maximaal 6 categorieën per module (werk/prive)
→ Bij overschrijding melding tonen en aanmaken blokkeren.

- Post-its tonen alleen openstaande taken voor gekozen modus.

Voltooide taken:

- Niet meer tonen op post-its
- Wel zichtbaar in "Alle taken" lijst

Alle taken lijst:

- Filtert mee op modus (werk/prive)
- Kolommen: Prio-bolletje, taaknaam, start, eind, voltooid-datum

Zoekfunctie:

- Alleen zichtbaar als "Alle taken" open staat
- Zoekt in naam, data, omschrijving, prio, categorie

- De header wordt als partial geladen uit /partials/header.html en triggert exact één keer het event 'partials:loaded'.
- Instellingenpagina gebruikt 6 slots per modus; HTML-ID voor de modus-toggle is 'modeSwitchSettings'.
