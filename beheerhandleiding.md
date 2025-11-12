# Beheerhandleiding – Website Jo
_Laatst bijgewerkt: 15-08-2025 18:57_

Deze handleiding bundelt **alles** om de website te beheren, te onderhouden en uit te breiden.  
Ze bevat: structuur, technische toelichting per bestandstype, hosting & backups, inhoudsbeheer, changelog én kant‑en‑klare templates (HTML/CSS/JS) voor nieuwe pagina’s.

## 1. Inleiding & doel
- **Doel**: één centraal document voor beheer en ontwikkeling.
- **Bereik**: front‑end (HTML/CSS/JS), Firebase (Auth/Firestore), statische hosting (GitHub Pages).
- **Niet in dit document**: API‑sleutels/privéconfiguratie.

## 2. Bestandsstructuur
```
index.html
/CSS
  main.css
  components-menu.css
  components-sidemenu.css
  page-index.css
  page-notes.css
  page-settings.css

/Script/Javascript
  main.js
  notes.js
  settings.js
  menu.js
  modal.js
  include-partials.js
  firebase-config.js

/HTML
  notes.html
  settings.html

/partials
  modals.html
  header.html
```

## 3. Technische toelichting per bestandstype
### CSS
- main.css – basisstijl, thema’s
- components-menu.css – menu styling
- components-sidemenu.css – zijmenu styling
- page-* – paginaspecifieke stijlen

### JavaScript
- include-partials.js – laadt gedeelde HTML-componenten
- menu.js – navigatie en menu logica
- modal.js – modals functionaliteit
- main.js, notes.js, settings.js – pagina scripts
- firebase-config.js – Firebase instellingen

### HTML
- index.html – startpagina + post-its + takenbeheer
- notes.html – notities
- settings.html – instellingen
- modals.html – modals
- header.html – header en menu

## 4. Hosting & backups
- Hosting op GitHub Pages
- Backups via Git-tags en ZIP-export
- Firestore Rules & Auth configuratie

## 5. Inhoudsbeheer
- Taken: toevoegen, bewerken, voltooien
- Categorieën: naam, kleur, archiveren
- Post-its per modus (werk/privé)
- Notities: tabel, toevoegen, bewerken

## 6. Gegevens FireStore
**Rules:**
  '''
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {

    // alleen deze 2 mails
    function allowed() {
      return request.auth != null &&
        (request.auth.token.email == "jonathan.daneels@brandweer.zonerand.be" ||
         request.auth.token.email == "daneelsjo88@gmail.com");
    }

    match /settings/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }

    match /categories/{id} {
      allow read, write: if allowed();
    }

    match /todos/{id} {
      allow read, write: if allowed();
    }

    match /notes/{id} {
      allow read, write: if allowed();
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
  '''

  
  **Datastructuur:**
  - ***Categories:***
    - active (boolean)
    - color (string)
    - name (string)
    - type (string)
  - ***notes:***
    - body (string)
    - createdAt (string)
    - link (string)
    - time (string)
    - title (string)
    - type (string)
    - uid (string)
    - updateAt (timestamp)
    - when (timestamp)
  - ***Settings***
    - modeSlots (map)
      - prive (array)
        - 0 - 5 (map)
          - categoryId (string)
      - werk (array)
        - 0 - 5 (map)
          - categoryId (string)
    - preferredMode (string)
    - theme (string)
  - ***todos***
    - category (string)
    - categoryId (string)
    - description (string)
    - done (boolean)
    - endDate (timestamp)
    - link (string)
    - priority (number)
    - startDate (timestamp)
    - title (string)
    - uid (string)
    - updatedAt (timestamp)


## 7. Volledige HTML-template nieuwe pagina
**HTML**
```html
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" href="../IMG/JD_Web_Solutions.ico">
  <title>Paginatitel</title>
 <script>
        (function () {
            try {
                var pref = localStorage.getItem('app.theme') || 'system';
                var final = pref === 'system'
                    ? (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
                    : pref;
                document.documentElement.setAttribute('data-theme', final);
            } catch (e) { }
        })();
    </script>
  <!-- Gedeelde CSS -->
  <link rel="stylesheet" href="../CSS/main.css" />
  <link rel="stylesheet" href="../CSS/components-menu.css" />
  <link rel="stylesheet" href="../CSS/components-sidemenu.css" />

  <!-- Paginaspecifieke CSS (optioneel) -->
  <link rel="stylesheet" href="../CSS/page-[naam].css" />
</head>
<body class="page-[naam]">

  <!-- Auth (indien nodig) -->
  <div id="auth"><button id="login-btn">🔐 Inloggen met Google</button></div>

  <!-- Gedeelde header -->
  <div data-include="../partials/header.html"></div>

  <!-- Pagina-inhoud -->
  <div id="app" style="display:none;">
    <div class="page">
      <main class="content">
        <!-- Paginaspecifieke content -->
      </main>
      <aside class="rightcol">
        <!-- Optioneel zijpaneel -->
      </aside>
    </div>
  </div>

  <!-- Gedeelde modals -->
  <div data-include="../partials/modals.html"></div>

  <!-- Gedeelde scripts -->
   <script type="module" src="../Script/Javascript/modal.js"></script>
  <script src="../Script/Javascript/include-partials.js"></script>
  <script src="../Script/Javascript/menu.js"></script>
  

  <!-- Paginaspecifiek script -->
  <script type="module" src="../Script/Javascript/[naam].js"></script>
</body>
</html>

```
**HTML voor modal**
``` 
<!-- Extra modal alleen voor deze pagina -->
<div id="modal-custom" class="modal-card" role="dialog" aria-modal="true" hidden>
  <div class="modal-header">
    <h3>Mijn modal</h3>
    <button class="modal-close" data-modal-close="modal-custom" aria-label="Sluiten">✕</button>
  </div>
  <div class="modal-body">
    Inhoud…
  </div>
  <div class="modal-footer">
    <button class="primary" data-modal-close="modal-custom">OK</button>
  </div>
</div>

<script type="module">
  document.addEventListener("partials:loaded", () => {
    // Voorbeeld: open modal via knop
    const btn = document.getElementById("openCustomModal");
    if (btn) btn.addEventListener("click", () => Modal.open("modal-custom"));
  });
</script>

```


## 8. Changelog
```
[15-08-2025] v1.0.0 – Eerste volledige beheershandleiding
```