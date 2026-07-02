# CLAUDE.md — Projet « Révisions Collèges »

Contexte de projet pour toute session future. Ce document contient tout le
nécessaire pour comprendre, reprendre et modifier l'application sans repartir
de zéro.

---

## 1. Objectif

Outil personnel (un seul utilisateur, étudiant en médecine) pour organiser la
révision des **collèges** (ouvrages de référence de l'EDN). Il remplace un
fichier Excel colorié à la main. Deux besoins centraux :

1. **Voir** l'état des révisions, classé par semestre → collège → chapitre.
2. **Savoir quoi réviser ensuite**, via une liste priorisée qui se met à jour
   automatiquement quand on enregistre une nouvelle session.

Ce n'est **pas** un produit distribué : usage perso, hors-ligne, données locales.

---

## 2. Livrable

- Application web **servie par un petit serveur local Python** (`server.py`,
  bibliothèque standard uniquement, aucune dépendance). Vanilla JS + CSS.
- Sources modulaires dans **`src/`** : `index.html`, `styles.css`, `seed.js`
  (constante `SEED`), `app.js`.
- **Persistance = fichier `donnees.json` sur le disque** (plus de `localStorage`
  en usage normal). Le JS parle au serveur via `GET/POST /api/data` ; le serveur
  écrit `donnees.json` en **écriture atomique**. Fallback `localStorage`
  seulement si le HTML est ouvert sans serveur (`file://`).
- **Distribution** : PyInstaller produit un `.exe` (Windows) et un `.app`
  (macOS) via GitHub Actions (`.github/workflows/build.yml`). Le CODE est
  embarqué dans l'exécutable ; les DONNÉES restent externes (voir §8) → on peut
  remplacer l'exécutable par une nouvelle version **sans perdre les données**.
- Boutons : **Exporter** (JSON de sauvegarde), **Importer** (recharge un JSON),
  **Réinit.** (restaure `SEED`).
- `main.html` = ancienne version mono-fichier (localStorage), conservée en archive.

### Source de données
- Fichier d'origine : `COLLEGES.xlsx`, feuille **« Feuille 1 »**.
  (Il existe aussi une feuille « Cours importants », **non utilisée** : c'est un
  extrait redondant de la Feuille 1.)
- Les données parsées sont **figées dans le HTML** (constante `SEED`). Le fichier
  Excel n'est plus nécessaire à l'exécution.

---

## 3. Deux systèmes de couleurs (à ne jamais confondre)

### a) Importance du chapitre (couleur de fond de la cellule *titre* du chapitre)
Ordre décroissant d'importance : **bleu > cyan > gris > blanc**.

| Importance | Sens | Couleur Excel | Clé interne |
|---|---|---|---|
| Référence | chapitre de référence, prioritaire | `#4A86E8` (bleu) | `reference` |
| Cyan | important | `#00FFFF` | `cyan` |
| Gris | secondaire | `#CCCCCC` / `#B7B7B7` / `#D9D9D9` | `gris` |
| Blanc | mineur | aucun fond | `blanc` |

### b) Difficulté d'une session (couleur de fond de la cellule *date*)
5 familles, du **mieux su** au **moins su**. Chaque couleur Excel est rattachée
à l'une des 5 familles (par correspondance exacte, sinon plus proche en RGB).

| Niveau | Famille | Sens | Couleur d'affichage appli |
|---|---|---|---|
| 1 | Vert | maîtrisé | `#6AA84F` |
| 2 | Jaune | à consolider | `#F1C232` (jaune) |
| 3 | Jaune-orange | intermédiaire | `#E8912D` |
| 4 | Orange | difficile | `#F0663B` |
| 5 | Rouge | mal su | `#D64545` |

Couleurs Excel rattachées à chaque niveau (voir `FAM` dans le parseur) :
- **1 Vert** : `93C47D 6AA84F 38761D B6D7A8 D9EAD3 00FF00 274E13` **+ `00FFFF` (cyan)**
- **2 Jaune** : `FFFF00 FFD966 FFE599 F9CB9C`
- **3 Jaune-orange** : `F1C232 BF9000 F6B26B E69138`
- **4 Orange** : `FF9900 B45F06 7F6000`
- **5 Rouge** : `FF0000 E06666 990000`

**Décisions validées par l'utilisateur :**
- La session **cyan `#00FFFF`** (1 occurrence) → rattachée au **Vert** (niveau 1).
- Session **blanche / sans couleur** → session **non terminée** (`enCours`).
- Gris très clair `#EFEFEF` = simple ombrage de colonne dans l'Excel → **ignoré**.

---

## 4. Modèle de données

```
state = {
  generated: "YYYY-MM-DD",
  chapters: [ Chapter ],
  settings: { intervals: { "1":45, "2":25, "3":15, "4":8, "5":4 } }  // §6
}

Chapter = {
  id:          "cN",                       // identifiant unique
  semestre:    "SEMESTRE 1".."SEMESTRE 4",
  college:     "PEDIATRIE" | ...,          // 34 collèges
  collegeColor:"741B47" | null,            // couleur du collège (décoratif)
  titre:       string,                     // VERBATIM (numéros, parenthèses,
                                           //   et remarques éventuelles inclus)
  importance:  "reference"|"cyan"|"gris"|"blanc",
  sessions:    [ Session ]
}

Session = {
  date:     "YYYY-MM-DD" | null,           // null = entrée sans date (ex. "PRIO")
  niveau:   1..5 | null,                   // null = pas de niveau / non terminée
  remarque: string,                        // "" si vide
  enCours:  bool                           // true = commencée / non terminée
}
```

Chiffres actuels du seed : **813 chapitres**, **923 sessions** (doublons de
fusion inclus, voir §5), **34 collèges**. Importance : reference 396, blanc 350,
cyan 57, gris 10.

---

## 5. Règles de parsing de l'Excel (cas particuliers — IMPORTANT)

Disposition : la feuille contient **4 blocs de colonnes**, un par semestre.
Dans chaque bloc : `collège | chapitre | sessions…`. Colonnes (1-indexées) :

| Bloc | Collège | Chapitre | Sessions |
|---|---|---|---|
| SEMESTRE 4 | 1 (A) | 2 (B) | 3–6 (C–F) |
| SEMESTRE 3 | 7 (G) | 8 (H) | 9–13 (I–M) |
| SEMESTRE 2 | 14 (N) | 15 (O) | 16–20 (P–T) |
| SEMESTRE 1 | 21 (U) | 22 (V) | 23–26 (W–Z) |

Le nom du collège n'apparaît que sur la 1re ligne de ses chapitres → on le
**reporte vers le bas** jusqu'au collège suivant.

### Cellules fusionnées (53 au total)
- **49 fusions verticales** (multi-lignes) dans les colonnes de session. Une
  session fusionnée sur plusieurs lignes = **une même session partagée par
  TOUS les chapitres qu'elle recouvre** (même date, même niveau, même remarque).
  Ex. `P9:P11` couvre « chapitre 7 (95) / (96) / (97) » → les 3 reçoivent la
  session. **Décision validée.** C'est pourquoi 923 sessions > nb de cellules.
- **4 fusions horizontales** = uniquement les titres de semestre (ligne 1) →
  sans impact.

### Contenu des cellules de session
- Cellule **date** (type datetime) → session `{date, niveau=couleur}`.
- Cellule **texte commençant par une date** (`jj/mm/aa[aa]`) → on extrait la
  date → session `{date, niveau=couleur, remarque=reste du texte}`.
  Ex. `24/11/25 (voir fiche compar.)`.
- Cellule **texte sans date en tête** → entrée `{date:null, remarque=texte}`.
  Ex. `revoir`, `pas fait chez l'enfant`, `PRIO`.

### Remarques
- Le champ **remarque est au niveau du chapitre** à l'affichage, mais stocké
  **par session** (chaque session a sa `remarque`). Affichage (voir §7) :
  dernière remarque visible + badge `＊N` dépliable listant toutes les remarques.
- **`PRIO`** (31 cellules, semestre 1) → traité comme **simple texte de remarque**
  (décision validée). Pas de comportement spécial de priorisation.
- Cas limites connus dans l'Excel d'origine :
  - **J47** `19/11/25 (col) 22/11/25 (endometre)` : deux dates dans une seule
    cellule. Gardé en une session (date 19/11/25) + texte complet en remarque.
  - **J61 « a » / J62 « faire »** : « a faire » coupé sur deux lignes (deux
    chapitres). Gardé verbatim tel quel.
  - **C189** : vide → ignoré. **C190** : date seule (pas une remarque) → session.
  - **R11** `96!! 97!!` : remarque (le fond `#EFEFEF` est ignoré).

### Titres de chapitres
- **Conservés exactement tels quels** : numéros, numéros entre parenthèses ET
  remarques éventuellement présentes dans le titre restent dans le titre.
  Ne jamais découper ni déplacer vers le champ remarque.

---

## 6. Algorithme de la liste « À réviser » (onglet 2)

Ordre des sections (validé) :
1. **Sessions non finies** — chapitres ayant au moins une session `enCours`.
2. **Chapitres jamais vus** — aucune session datée.
3. **Reste, trié par score décroissant.**

**Score** = `jours_écoulés_depuis_dernière_session_datée / intervalle_cible`.
Le niveau de la **dernière** session datée détermine l'intervalle cible :

| Niveau dernière session | Intervalle cible (jours) |
|---|---|
| 1 Vert (maîtrisé) | 45 |
| 2 Jaune (à consolider) | 25 |
| 3 Jaune-orange (intermédiaire) | 15 |
| 4 Orange (difficile) | 8 |
| 5 Rouge (mal su) | 4 |

- Score ≥ 1 → « en retard » (affiché en rouge). Plus le score est grand, plus
  c'est urgent. Ajouter une session remet `jours_écoulés` à 0 et recalcule le
  niveau → le chapitre redescend (ou reste haut si mal su) automatiquement.
- Ces intervalles sont **éditables par l'utilisateur** (bloc « ⚙ Intervalles
  cibles » dans la sidebar) et **stockés dans `state.settings.intervals`** →
  ils sont exportés/importés et conservés lors d'une mise à jour du code.
  Défauts dans `DEFAULT_INTERVALS`, lecture via `getInterval(n)`, bouton
  « valeurs par défaut » pour réinitialiser.

**Filtre d'importance** : par **défaut on n'affiche que les chapitres
`reference`** (bleu). Case à cocher « Inclure cyan / gris / blanc » pour les
ajouter. **Décision validée.**

**Objectif du jour** : champ numérique N qui **surligne les N premières
priorités** (hors sessions non finies).

---

## 7. Fonctionnalités par onglet

Deux onglets : **« Révisions »** (tableau + à réviser fusionnés) et **« Stats »**.

- **Révisions** — vue en deux colonnes (`.workspace`) :
  - *Gauche (`.tablecol`, large)* — le **tableau** : groupé semestre → collège →
    chapitre. Par chapitre : pastille d'importance, titre verbatim, **frise de
    sessions** (carrés colorés, survol = date/niveau/remarque), dernière session,
    remarque (dernière + `＊N` dépliable). Clic sur un chapitre → panneau
    d'édition : ajouter/modifier/supprimer des sessions, marquer « en cours »,
    éditer titre/importance/collège/semestre, supprimer le chapitre.
  - *Droite (`.reviseside`, sidebar ~390px, repliable)* — **à réviser** : les 3
    sections de §6 + case d'inclusion + objectif du jour + bloc réglable des
    intervalles cibles. Bouton **Réviser** = ajoute une session du jour (demande
    le niveau). La sidebar se replie via ⟨ (bouton `sideHide`) et se réaffiche
    via « À réviser ⟩ » (`sideToggle`). Sous 1200px, elle passe sous le tableau.
- **Stats** : compteurs (chapitres, révisés, réf. en retard, réf. jamais vus)
  + une barre empilée par collège montrant la répartition des niveaux actuels
  (dernier niveau de chaque chapitre) + les jamais-vus, pour repérer les
  collèges faibles.

Recherche globale (titre / collège / remarques) dans la barre du haut.

---

## 8. Architecture technique de l'appli

- **Sources modulaires** dans `src/` : `index.html` (structure), `styles.css`,
  `seed.js` (`const SEED`), `app.js` (logique). `server.py` sert `src/` +
  l'API. Chargement des scripts : `seed.js` puis `app.js` (portée globale de
  script classique partagée → `SEED` visible dans `app.js`).
- **Persistance** (`app.js`) :
  - `load()` *async* : tente `GET /api/data` (→ `serverMode=true`) ; si vide →
    `SEED` ; sinon fallback `localStorage`, sinon `SEED`.
  - `save()` : en `serverMode`, `POST /api/data` **débounce 250ms** + flush
    `sendBeacon` sur `beforeunload` ; sinon `localStorage`. `persistOK` pilote
    le bandeau d'avertissement.
  - `migrate(st)` garantit `settings.intervals` (défauts `DEFAULT_INTERVALS`).
- **Emplacement de `donnees.json`** (fonction `data_dir()` dans `server.py`) :
  dev → racine projet ; Windows (exe) → **à côté de l'exécutable** (fichier
  visible dans le même dossier ; remplacer l'exe le laisse intact à côté) ;
  macOS (.app) → `~/Library/Application Support/RevisionsColleges/` (un `.app`
  est un dossier : y ranger les données les effacerait au remplacement) ; Linux →
  `~/.local/share/RevisionsColleges/`. `migrate_legacy_data()` récupère au 1ᵉʳ
  lancement d'éventuelles données d'un ancien emplacement (ex. `%APPDATA%`).
- Fonctions clés JS : `lastDated`, `score` (via `getInterval`), `remarks`,
  `neverSeen`, `hasUnfinished`, `renderTable`, `renderRevise`, `renderSettings`,
  `renderStats`, `openDetail` (édition). `commit()` = `save()` + rerender de la
  sidebar. Onglets : `curTab ∈ {'work','stats'}`, `render()` rend tableau +
  sidebar en mode `work`.
- Serveur : `ThreadingHTTPServer` sur `127.0.0.1`, port 8765 (suivant libre si
  occupé), écriture atomique (`.tmp` + `os.replace`), validation JSON avant
  écriture, anti path-traversal sur le statique. Aucune lib externe.

### Fabriquer / distribuer
Voir `README.md` : build local PyInstaller ou GitHub Actions (Win + Mac),
distribution à un ami, et mise à jour sans perte de données.

### Régénérer les données depuis l'Excel
Le seed a été produit par deux scripts Python (openpyxl) :
1. **parseur** : lit `COLLEGES.xlsx`, applique les règles §3/§5, produit un JSON
   (`{generated, chapters:[…]}`).
2. **générateur** : injecte ce JSON dans le gabarit HTML à la place de `__SEED__`.

Si l'utilisateur repart d'un nouvel Excel, refaire tourner ces deux étapes.
(Ces scripts ne sont pas livrés avec le HTML ; les redemander si besoin.)

---

## 9. Décisions validées (récapitulatif)

- Importance : **bleu > cyan > gris > blanc** (cyan = 4e niveau à part entière).
- Session cyan → **famille verte**.
- Couleurs de session isolées → rattachées à la **famille la plus proche**.
- Sessions fusionnées → comptent **pour tous les chapitres recouverts**.
- Champ remarque : **par chapitre**, montre la **dernière** remarque, `＊N`
  dépliable pour toutes les remarques des sessions.
- **PRIO** → simple texte de remarque.
- Liste à réviser : **non finies → jamais vus → score**.
- Exclusion par défaut de **cyan/gris/blanc**, case pour les inclure.
- Titres de chapitres conservés **verbatim**.

---

## 10. Pistes ouvertes / à confirmer

- **Calibrage des intervalles** 45/25/15/8/4 j (à ajuster à l'usage).
- **Intervalles croissants** : allonger l'intervalle à chaque vert consécutif
  (type SM-2 léger) — non implémenté.
- **Proximité de l'EDN** : resserrer les intervalles à l'approche de l'examen —
  non implémenté (pas de date d'échéance saisie pour l'instant).
- Découpage éventuel de **J47** en deux sessions distinctes.
- Ergonomie de la **saisie rapide** d'une session (le bouton « Réviser » passe
  aujourd'hui par un `prompt` pour le niveau — pourrait devenir un mini-menu).
