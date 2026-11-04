# Mobilité Montréal — tableau de bord des données ARTM

Site statique (HTML/CSS/JS, aucun build nécessaire) qui met en forme les
[données ouvertes du Pôle de données en mobilité de l'ARTM](https://donnees.artm.quebec)
pour suivre, de façon sourcée et vérifiable : l'achalandage du transport
collectif, les parts modales des déplacements, l'évolution des tarifs, les
voies réservées pour autobus et le réseau cyclable dans la région
métropolitaine de Montréal.

Construit pour être hébergé gratuitement sur **GitHub Pages**, avec les
données rafraîchies automatiquement **chaque semaine** par une GitHub Action.

## Mise en route

1. Pousser ce dépôt sur GitHub.
2. Dans **Settings → Pages**, choisir *Deploy from a branch*, branche `main`,
   dossier `/ (root)`.
3. Dans **Settings → Actions → General**, sous *Workflow permissions*,
   s'assurer que "Read and write permissions" est activé (nécessaire pour que
   la mise à jour hebdomadaire puisse commiter les nouvelles données).
4. C'est tout — le site est en ligne, et `update-data.yml` tourne chaque lundi
   (et peut être lancé manuellement depuis l'onglet *Actions* → *Run workflow*).

### Domaine personnalisé : artm.gabfortin.com

Le fichier `CNAME` à la racine est déjà en place. Il reste deux choses à
faire côté DNS et GitHub :

1. Chez le fournisseur DNS de `gabfortin.com`, ajouter un enregistrement
   **CNAME** : `artm` → `<ton-compte-ou-organisation>.github.io.`
   (le point final est optionnel selon le fournisseur ; certains, comme
   Cloudflare, proposent aussi un enregistrement ALIAS/CNAME-flattening à la
   racine si un jour tu veux `gabfortin.com` directement — pas nécessaire ici
   puisqu'il s'agit d'un sous-domaine).
2. Dans **Settings → Pages** du dépôt GitHub, le champ *Custom domain*
   devrait détecter `artm.gabfortin.com` automatiquement (lu depuis le
   fichier `CNAME`) ; cocher **Enforce HTTPS** une fois le certificat généré
   (peut prendre jusqu'à 24 h après la propagation DNS).

Si le dépôt est repoussé plus tard sans ce fichier `CNAME`, GitHub Pages le
retire automatiquement — le remettre suffit à relier le domaine de nouveau.

## Structure

```
index.html              page unique, sections ancrées
css/style.css            mise en page, composants, couleurs des séries
css/hybride.css          habillage « dashboard détaillé » (Inter, accent vert, verre léger, mode sombre)
confidentialite.html      politique de confidentialité
js/main.js                tout le rendu (graphiques Chart.js, carte Leaflet, BIXI en direct)
data/*.json, *.geojson    données générées par le robot (committées dans le dépôt)
scripts/update_data.py    pipeline de mise à jour — aucune dépendance externe (stdlib Python uniquement)
.github/workflows/        robot hebdomadaire
```

## Mettre à jour les données manuellement

```bash
python3 scripts/update_data.py
git add data/ && git commit -m "data: mise à jour manuelle" && git push
```

## Ce qui est automatisé vs sourcé à la main

- **Automatisé chaque semaine** : achalandage par société de transport,
  tarifs, voies/mesures préférentielles pour autobus, réseau express vélo,
  réseau cyclable de Montréal (statistiques), terminus et stationnements
  incitatifs, zones tarifaires, kilométrage réel et incidents du métro (STM),
  offre planifiée du REM (GTFS), ventes de titres ARTM et compteurs vélo
  permanents de Montréal (seule l'année en cours est retéléchargée ; les
  années terminées sont gardées dans `data/compteurs_velo_cache.json`).
- **Sourcé manuellement** (`data/parts_modales.json`) : les parts modales
  2003–2023, qui viennent des enquêtes origine-destination / Perspectives
  mobilité de l'ARTM, publiées tous les ~5 ans seulement. Ce fichier n'est
  pas touché par le robot — il se met à jour "à la main" lorsque l'ARTM publie
  une nouvelle édition de l'enquête (prochaine attendue vers 2028).
- **Sourcé manuellement** (`data/velo_secteurs.json`) : part modale du vélo
  par arrondissement de Montréal, 2018 vs 2023, calculée directement à partir
  des matrices de déplacements (fichiers OD, ~13 Mo chacun) avec
  `scripts/analyze_velo_secteurs.py`. Nécessite `openpyxl` (`pip install
  openpyxl`) — volontairement **pas** dans le pipeline hebdomadaire stdlib-only.
  À relancer à la main à la prochaine édition de l'enquête :
  ```bash
  pip install openpyxl
  python3 scripts/analyze_velo_secteurs.py
  ```
- **Sourcé manuellement** (`data/bixi_historique.json`) : statistiques des
  trajets BIXI (2019, 2023 → année en cours) calculées depuis les archives
  ouvertes de BIXI avec `scripts/analyze_bixi.py` (stdlib, mais ~1,6 Go
  d'archives mises en cache dans `.scratch_bixi/`). À relancer quand BIXI
  publie une nouvelle archive :
  ```bash
  python3 scripts/analyze_bixi.py
  ```
- **Sourcé manuellement** (`data/enseignement_superieur_2025.json`) : chiffres
  clés du rapport PDF de l'enquête 2025 Enseignement supérieur de l'ARTM.
- **En direct, côté navigateur** : le flux [GBFS public de BIXI](https://gbfs.velobixi.com/gbfs/gbfs.json)
  est lu directement par le navigateur de chaque visiteur (pas de donnée
  stockée côté site).

## Limites connues

Voir la section « Méthodologie, sources et limites » du site, qui liste
notamment : l'achalandage du REM n'est pas publié publiquement par l'ARTM
(jeu de données existant mais retournant une erreur d'autorisation) ; le
réseau cyclable détaillé ne couvre que l'agglomération de Montréal ; les
validations de titres quotidiennes ne sont pas distribuées en fichier
téléchargeable.

## Confidentialité

Aucun cookie ni compte. Les visites sont comptées de façon anonyme avec
[GoatCounter](https://www.goatcounter.com) ; rien n'est enregistré dans le
navigateur (le thème clair/sombre suit simplement l'appareil). Détails :
[confidentialite.html](confidentialite.html), à mettre à jour (avec sa date)
si un service externe est ajouté.
