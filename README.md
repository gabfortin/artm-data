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

## Structure

```
index.html              page unique, sections ancrées
css/style.css            palette, mise en page
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
  incitatifs, zones tarifaires.
- **Sourcé manuellement** (`data/parts_modales.json`) : les parts modales
  2003–2023, qui viennent des enquêtes origine-destination / Perspectives
  mobilité de l'ARTM, publiées tous les ~5 ans seulement. Ce fichier n'est
  pas touché par le robot — il se met à jour "à la main" lorsque l'ARTM publie
  une nouvelle édition de l'enquête (prochaine attendue vers 2028).
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
