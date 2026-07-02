# Révisions Collèges

Outil personnel de suivi et de priorisation des révisions des collèges (EDN).
Interface web servie par un petit serveur local en Python ; les données sont
stockées **en dur** dans un fichier `donnees.json` (pas dans le navigateur).

## Structure du projet

```
src/            ← sources de l'interface (à éditer)
  index.html    structure de la page
  styles.css    styles
  seed.js       const SEED = données d'origine figées (813 chapitres)
  app.js        logique (rendu, priorisation, persistance)
server.py       serveur local (bibliothèque standard uniquement) + API JSON
.github/workflows/build.yml   build automatique Windows + macOS
COLLEGES.xlsx   fichier Excel d'origine (référence)
CLAUDE.md       contexte détaillé du projet
main.html       ancienne version mono-fichier (archive)
```

## Lancer en développement

```bash
python server.py
```

Ça sert `src/` sur http://127.0.0.1:8765 et ouvre le navigateur. En dev,
`donnees.json` est créé **à la racine du projet** (ignoré par git).

Tu peux modifier `src/*.css/js/html` et **rafraîchir la page** : pas besoin de
recompiler.

## Où sont stockées les données (important)

Les données vivent **hors du code**, pour survivre à une mise à jour :

| Contexte           | Emplacement de `donnees.json`                              |
|--------------------|------------------------------------------------------------|
| Développement      | racine du projet                                           |
| Windows (`.exe`)   | **à côté de l'exécutable** (même dossier, fichier visible) |
| macOS (`.app`)     | `~/Library/Application Support/RevisionsColleges/`          |
| Linux              | `~/.local/share/RevisionsColleges/`                        |

Sur Windows, `donnees.json` apparaît dans le même dossier que l'exe. Remplacer
l'exe (glisser le nouveau par-dessus l'ancien, au même endroit) laisse le
`donnees.json` intact à côté → le nouvel exe le relit. Garder l'exe et son
`donnees.json` **ensemble** (déplacer l'exe seul laisse les données derrière).
Sur macOS, un `.app` étant un dossier, les données vont dans un chemin fixe
(Application Support) pour survivre au remplacement du bundle.

`SEED` (dans `seed.js`) ne sert qu'au **premier lancement** et au bouton
**Réinit.**. Dès que `donnees.json` existe, il fait foi.

`migrate_legacy_data()` : au 1ᵉʳ lancement, si l'emplacement courant n'a pas de
`donnees.json` mais qu'un ancien existe ailleurs (ex. `%APPDATA%`), il est
**récupéré automatiquement**.

## Fabriquer les exécutables

### Option A — automatique (recommandé), via GitHub Actions

1. Pousse le code sur GitHub.
2. Onglet **Actions → Build → Run workflow** (ou pousse un tag : `git tag v1.0 && git push --tags`).
3. Récupère les artéfacts : `Revisions-Windows` (`.exe`) et `Revisions-macOS`
   (`Revisions-macOS.zip` contenant `Revisions.app`).

Aucun Mac nécessaire de ton côté : GitHub compile la version Mac sur ses serveurs.

### Option B — build local (uniquement pour ta propre plateforme)

```bash
pip install pyinstaller
# Windows :
pyinstaller --onefile --name Revisions --add-data "src;src" server.py
# macOS / Linux :
pyinstaller --onefile --windowed --name Revisions --add-data "src:src" server.py
```

Résultat dans `dist/`.

## Distribuer à un ami

1. Envoie-lui **Revisions.exe** (Windows) ou **Revisions.app** (Mac, dans le zip).
2. Au 1ᵉʳ lancement :
   - **Windows** : SmartScreen affiche « Windows a protégé votre PC » →
     *Informations complémentaires* → *Exécuter quand même*.
   - **macOS** : « app d'un développeur non identifié » → **clic droit → Ouvrir**
     (puis *Ouvrir*). À refaire une seule fois.
     - Si macOS dit plutôt « **endommagée** » ou bloque, retirer la mise en
       quarantaine via le Terminal : `xattr -cr /chemin/vers/Revisions.app`.
3. Il double-clique, ajoute ses sessions → tout est écrit dans son `donnees.json`.

> **Architecture Mac** : le `.app` est compilé en **universal2** — natif à la
> fois sur Mac **Intel (x86_64)** et **Apple Silicon (arm64)**, sans Rosetta.
> (Un `.app` arm64-only donne « n'est pas prise en charge par ce Mac » sur un
> Mac Intel — c'est pour ça qu'on build en universal2.)

### Mettre à jour sans perdre les données

Tu modifies le code → tu recompiles → tu renvoies le nouvel exécutable → l'ami
**remplace l'ancien** par le nouveau. Son `donnees.json` n'est pas touché : il
rouvre l'app avec ses données à jour et le nouveau code. ✅

## Sauvegarde / transfert manuel

Les boutons **Exporter** / **Importer** (barre du haut) permettent de sauvegarder
ou transférer les données sous forme d'un fichier JSON, indépendamment de tout ça.
