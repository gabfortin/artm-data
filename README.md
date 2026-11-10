# Mobilité Montréal — tableau de bord des données ARTM

Les [données ouvertes du Pôle de données en mobilité de l'ARTM](https://donnees.artm.quebec)
mises en forme pour suivre, de façon sourcée et vérifiable, l'achalandage du
transport collectif, les parts modales, les tarifs, les voies réservées pour
autobus et le réseau cyclable de la région métropolitaine de Montréal. Pour
qui veut creuser : comparer des séries, lire les tableaux, vérifier les sources.

**En ligne :** [artm.gabfortin.com](https://artm.gabfortin.com)

## Contenu

| Section | Ce qu'elle montre |
|---|---|
| **Parts modales** | Qui prend quoi en période de pointe du matin (enquêtes origine-destination) |
| **Achalandage du transport collectif** | Déplacements par société de transport, année après année |
| **Sous le capot** | Ce que le métro et le REM font vraiment : kilométrage, incidents, offre planifiée |
| **Tarifs** | Le prix d'une passe mensuelle, de 2018 à aujourd'hui |
| **L'espace donné aux autobus et au vélo** | Voies réservées, réseau express vélo, réseau cyclable |
| **Carte des infrastructures** | Où se trouvent ces infrastructures (Leaflet) |
| **Le vélo, compté passage par passage** | Compteurs vélo permanents de Montréal |
| **BIXI, en ce moment** | Disponibilité en direct (flux GBFS) et historique des trajets |
| **Méthodologie, sources et limites** | Source de chaque série et ses limites |

## Données

### Sources

| Source | Producteur, licence | Utilisée pour |
|---|---|---|
| [Pôle de données en mobilité](https://donnees.artm.quebec) | ARTM, licences ouvertes | Achalandage, tarifs, voies réservées, réseau express vélo, terminus, stationnements incitatifs, zones tarifaires, ventes de titres, offre du REM (GTFS), enquêtes origine-destination |
| Données Québec, Données Montréal | Ville de Montréal et autres, CC BY 4.0 | Réseau cyclable de Montréal, compteurs vélo permanents |
| Données ouvertes de la STM | STM | Kilométrage réel et incidents du métro |
| [Flux GBFS de BIXI](https://gbfs.velobixi.com/gbfs/gbfs.json) et archives ouvertes de BIXI | BIXI | Disponibilité en direct, historique des trajets |

### Mise à jour

**Automatique**, chaque lundi à 9 h (UTC), par
[`.github/workflows/update-data.yml`](.github/workflows/update-data.yml) :

1. lance [`scripts/update_data.py`](scripts/update_data.py) (bibliothèque
   standard Python seulement) : achalandage, tarifs, voies et mesures
   préférentielles pour autobus, réseau express vélo, réseau cyclable de
   Montréal, terminus, stationnements incitatifs, zones tarifaires,
   kilométrage et incidents du métro, offre planifiée du REM, ventes de
   titres, compteurs vélo (seule l'année en cours est retéléchargée ; les
   années terminées restent dans `data/compteurs_velo_cache.json`) ;
2. si `data/` a changé : ajoute 1 à z de la version (`version.txt` et pages),
   commite (`data: mise à jour hebdomadaire (AAAA-MM-JJ, vX.Y.Z)`) et publie.

**À la main** (le robot n'y touche pas) :

| Fichier | Contenu | Comment le mettre à jour |
|---|---|---|
| `data/parts_modales.json` | Parts modales 2003–2023 (enquêtes OD, publiées environ tous les 5 ans) | À la main, à la prochaine édition de l'enquête (attendue vers 2028) |
| `data/velo_secteurs.json` | Part modale du vélo par arrondissement, 2018 vs 2023 | `python3 scripts/analyze_velo_secteurs.py` (matrices OD d'environ 13 Mo, `pip install openpyxl`) |
| `data/modes_secteurs.json` | Parts du transport collectif, de l'auto, de la marche et du transport actif par arrondissement, 2018 vs 2023 | `python3 scripts/analyze_modes_secteurs.py` (même méthode, `scripts/od_lib.py`) |
| `data/bixi_historique.json` | Statistiques des trajets BIXI (2019, 2023 → année en cours) | `python3 scripts/analyze_bixi.py` (environ 1,6 Go d'archives en cache dans `.scratch_bixi/`), quand BIXI publie une archive |
| `data/enseignement_superieur_2025.json` | Chiffres clés de l'enquête 2025 Enseignement supérieur | À la main, depuis le rapport PDF de l'ARTM |

`openpyxl` n'est volontairement **pas** dans le robot, qui reste sans
dépendance. Relancer tout le pipeline à la main : `python3 scripts/update_data.py`.

**En direct, dans le navigateur** : le flux GBFS de BIXI est lu par le
navigateur de chaque visiteur ; rien n'est stocké par le site.

### Mises en garde

Détail dans la section « Méthodologie, sources et limites » du site, dont :

- l'achalandage du REM n'est pas publié par l'ARTM (le jeu de données existe
  mais renvoie une erreur d'autorisation) ;
- le réseau cyclable détaillé ne couvre que l'agglomération de Montréal ;
- les validations de titres quotidiennes ne sont pas distribuées en fichier
  téléchargeable.
- Initiative indépendante : ni produite ni approuvée par l'ARTM, la Ville de
  Montréal ni BIXI.

## Utilisation locale

```bash
python3 -m http.server 8000   # http://localhost:8000
```

Un serveur est nécessaire : la page charge `data/` par requête réseau.

## Architecture

```
sources ARTM, Ville, STM → scripts/update_data.py → data/*.json, *.geojson → index.html + css/ + js/ (statiques)
```

| Fichier | Rôle |
|---|---|
| `index.html` | Page unique, sections ancrées |
| `confidentialite.html` | Politique de confidentialité |
| `css/style.css` | Mise en page, composants, couleurs des séries |
| `css/hybride.css` | Habillage du style D (Inter, accent vert, verre léger, mode sombre) et blocs communs |
| `js/main.js` | Tout le rendu : graphiques Chart.js, carte Leaflet, BIXI en direct |
| `js/apropos.js`, `js/titre-barre.js` | Composants communs (bouton « i », titre dans la barre) |
| `data/` | Données générées par le robot ou les scripts à la main : ne pas modifier sans eux |
| `scripts/update_data.py` | Pipeline hebdomadaire (bibliothèque standard seulement) |
| `scripts/analyze_*.py`, `scripts/od_lib.py` | Analyses lancées à la main (voir « Mise à jour ») |

**Style D de référence** de [DESIGN-PAGES.md](../DESIGN-PAGES.md). Composants
communs : `.communs.json`.

## Publication

GitHub Pages, branche `main`, dossier racine, domaine dans `CNAME`. Version
x.y.z et `?v=` écrits par le hook de commit (`version.txt`, `.version.json`).
Le robot a besoin de *Settings → Actions → General → Workflow permissions →
Read and write permissions* ; on peut aussi le lancer depuis l'onglet
*Actions* → *Run workflow*.

## Confidentialité

Aucun cookie ni compte, rien d'enregistré dans le navigateur (le thème suit
l'appareil).

| Quand | Ce qui est envoyé | À qui |
|---|---|---|
| Chaque visite | Page, site d'origine, appareil, pays | GoatCounter (mesure d'audience anonyme) |
| Section BIXI | Requête du flux public | BIXI (GBFS) |
| Carte | Requêtes de tuiles de la zone affichée | OpenStreetMap |

Détails : [confidentialite.html](confidentialite.html), à mettre à jour (avec
sa date) si un service externe est ajouté.

## Crédits

- [Chart.js](https://www.chartjs.org) 4.4.4 (MIT), chargé depuis jsDelivr
- [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2-Clause), chargé depuis cdnjs
- Fond de carte © les contributeurs d'[OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL)
- Données © ARTM, Ville de Montréal, STM et BIXI, sous leurs licences ouvertes respectives

## Auteur

Développé par [Gabriel Fortin](https://gabfortin.com).
