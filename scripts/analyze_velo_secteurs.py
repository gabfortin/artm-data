#!/usr/bin/env python3
"""
Calcule la part modale du vélo par arrondissement de Montréal, 2018 vs 2023,
à partir des matrices de déplacements (OD) de l'ARTM — ainsi que le secteur
de pondération (intra-arrondissement) affichant la part vélo la plus élevée.

Contrairement à scripts/update_data.py, ce script N'EST PAS exécuté chaque
semaine : les enquêtes de mobilité ne paraissent que tous les ~5 ans, les
fichiers sources pèsent ~13 Mo chacun et nécessitent openpyxl (dépendance non
présente dans le pipeline hebdomadaire, stdlib-only). On le relance à la main
quand l'ARTM publie une nouvelle édition de l'enquête métropolitaine.

Les deux éditions utilisent le même découpage « secteurs de pondération
SP23 » (l'ARTM a reharmonisé les données 2018 sur les limites 2023), ce qui
rend la comparaison 2018->2023 par secteur authentiquement comparable.

Sources :
  PM23 (2023) : https://donnees.artm.quebec/catalogue/dataset/enquete-metropolitaine-2023-perspectives-mobilite
  EOD18 (2018): https://donnees.artm.quebec/catalogue/dataset/enquete-origine-destination-2018
"""
import json
import urllib.request
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
UA = "ARTM-Mobility-Dashboard/1.0 (open data research; contact: gabriel.fortin97@gmail.com)"

PM23_URL = "https://donnees.artm.quebec/catalogue/dataset/1a48f8c5-b8f4-4224-84c2-fc33987ff262/resource/7acec5e0-ae2c-4c7d-8ba5-e18fd766bd89/download/pm23_matrice_2b4.xlsx"
EOD18_URL = "https://donnees.artm.quebec/catalogue/dataset/4d5e7905-d3d6-4825-8b75-82ff40687157/resource/c624a36c-d099-4201-bad4-cf00babc5f78/download/eod18_matrice_2b5b.xlsx"

MODE_VELO = "13"
MODE_TOUS = "100"
MOTIF_TOUS = "1"
PERIODE_24H = "1"

# En dessous de ce nombre d'observations brutes (non pondérées) cumulées sur
# un secteur, l'ARTM elle-même considère la cellule peu fiable (voir l'onglet
# "Documentation" des fichiers matrices : "volumes... en rouge... inférieur à
# 30 observations"). On applique le même seuil pour exclure les secteurs trop
# petits de la recherche du "secteur avec la plus haute part vélo", pour ne
# pas remonter un artefact d'échantillonnage.
MIN_OBS_RELIABLE = 30

# Mapping secteur de pondération (SP23) -> arrondissement officiel de la
# Ville de Montréal. Construit à la main à partir du dictionnaire des 68
# secteurs montréalais de l'enquête (voir onglet "Dictionnaire" des fichiers
# matrices). Quelques secteurs chevauchent deux limites administratives
# (ex. 1098 Sud-Ouest/Ville-Marie, 4126 Lachine/Montréal-Ouest, 4135
# Pierrefonds/Île-Bizard) : ils sont assignés à l'arrondissement principal
# nommé dans la description du secteur, pas additionnés deux fois.
SECTOR_TO_BOROUGH = {
    "2039": "Ahuntsic-Cartierville", "2056": "Ahuntsic-Cartierville",
    "2092": "Ahuntsic-Cartierville", "2108": "Ahuntsic-Cartierville", "2060": "Ahuntsic-Cartierville",
    "3071": "Anjou", "3116": "Anjou",
    "2035": "Côte-des-Neiges–Notre-Dame-de-Grâce", "2104": "Côte-des-Neiges–Notre-Dame-de-Grâce",
    "2043": "Côte-des-Neiges–Notre-Dame-de-Grâce", "2057": "Côte-des-Neiges–Notre-Dame-de-Grâce",
    "2105": "Côte-des-Neiges–Notre-Dame-de-Grâce",
    "4126": "Lachine", "4129": "Lachine", "4139": "Lachine",
    "4125": "LaSalle", "4127": "LaSalle", "4128": "LaSalle",
    "2045": "Le Plateau-Mont-Royal", "2046": "Le Plateau-Mont-Royal",
    "2050": "Le Plateau-Mont-Royal", "2106": "Le Plateau-Mont-Royal",
    "2070": "Le Sud-Ouest", "2093": "Le Sud-Ouest", "2094": "Le Sud-Ouest", "2103": "Le Sud-Ouest",
    "4134": "L'Île-Bizard–Sainte-Geneviève",
    "2022": "Mercier–Hochelaga-Maisonneuve", "2047": "Mercier–Hochelaga-Maisonneuve",
    "2048": "Mercier–Hochelaga-Maisonneuve", "2112": "Mercier–Hochelaga-Maisonneuve",
    "2111": "Mercier–Hochelaga-Maisonneuve",
    "3026": "Montréal-Nord", "3118": "Montréal-Nord",
    "2121": "Outremont",
    "4135": "Pierrefonds-Roxboro", "4136": "Pierrefonds-Roxboro", "4153": "Pierrefonds-Roxboro",
    "3113": "Rivière-des-Prairies–Pointe-aux-Trembles", "3151": "Rivière-des-Prairies–Pointe-aux-Trembles",
    "3114": "Rivière-des-Prairies–Pointe-aux-Trembles", "3115": "Rivière-des-Prairies–Pointe-aux-Trembles",
    "2041": "Rosemont–La Petite-Patrie", "2036": "Rosemont–La Petite-Patrie",
    "2055": "Rosemont–La Petite-Patrie", "2110": "Rosemont–La Petite-Patrie",
    "4023": "Saint-Laurent", "4038": "Saint-Laurent", "4089": "Saint-Laurent", "4119": "Saint-Laurent",
    "3037": "Saint-Léonard", "3117": "Saint-Léonard",
    "2142": "Verdun", "2143": "Verdun", "2145": "Verdun",
    "1027": "Ville-Marie", "1091": "Ville-Marie", "1096": "Ville-Marie", "1097": "Ville-Marie",
    "1098": "Ville-Marie", "1101": "Ville-Marie", "1102": "Ville-Marie", "2090": "Ville-Marie",
    "2053": "Villeray–Saint-Michel–Parc-Extension", "2107": "Villeray–Saint-Michel–Parc-Extension",
    "2049": "Villeray–Saint-Michel–Parc-Extension", "2109": "Villeray–Saint-Michel–Parc-Extension",
    "2095": "Villeray–Saint-Michel–Parc-Extension",
}


def log(msg):
    print(f"[analyze_velo_secteurs] {msg}", flush=True)


def download(url, dest):
    if dest.exists():
        log(f"  using cached {dest.name}")
        return
    log(f"  downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as resp, open(dest, "wb") as f:
        f.write(resp.read())


def read_sector_names(xlsx_path):
    """Lit l'onglet Dictionnaire pour obtenir {code SP23: nom descriptif du secteur}."""
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb["Dictionnaire"]
    names = {}
    started = False
    for row in ws.iter_rows(values_only=True):
        if row[1] == "RA 2023":
            started = True
            continue
        if not started:
            continue
        if row[3] is None:
            break
        names[str(row[3])] = row[4]
    wb.close()
    return names


def velo_sums_by_sector(xlsx_path):
    """Retourne (velo_pond, total_pond, velo_obs, total_obs), chacun un dict
    {code secteur origine: somme}, pour motif=tous les motifs, période=24h."""
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb["donnees_matrices_plates"]
    rows = ws.iter_rows(values_only=True)
    next(rows)  # header: id, obs, pond

    velo_pond, total_pond, velo_obs, total_obs = {}, {}, {}, {}
    for r in rows:
        rid, obs, pond = r[0], r[1], r[2]
        if rid is None or pond is None:
            continue
        origine, _destination, mode, motif, periode = rid.split("_")
        if motif != MOTIF_TOUS or periode != PERIODE_24H:
            continue
        if mode not in (MODE_VELO, MODE_TOUS):
            continue
        is_velo = mode == MODE_VELO
        (velo_pond if is_velo else total_pond)[origine] = (velo_pond if is_velo else total_pond).get(origine, 0) + pond
        (velo_obs if is_velo else total_obs)[origine] = (velo_obs if is_velo else total_obs).get(origine, 0) + (obs or 0)

    wb.close()
    return velo_pond, total_pond, velo_obs, total_obs


def aggregate_to_boroughs(velo_pond, total_pond):
    velo, total = {}, {}
    for code, v in velo_pond.items():
        b = SECTOR_TO_BOROUGH.get(code)
        if b is None:
            continue
        velo[b] = velo.get(b, 0) + v
    for code, t in total_pond.items():
        b = SECTOR_TO_BOROUGH.get(code)
        if b is None:
            continue
        total[b] = total.get(b, 0) + t
    return velo, total


def top_sector(velo_pond, total_pond, velo_obs, total_obs, sector_names):
    """Secteur montréalais (SP23) avec la plus haute part vélo, en excluant
    les secteurs sous le seuil de fiabilité (voir MIN_OBS_RELIABLE)."""
    best = None
    for code in SECTOR_TO_BOROUGH:  # restreint aux secteurs de la Ville de Montréal
        t = total_pond.get(code)
        v = velo_pond.get(code, 0)
        obs_total = total_obs.get(code, 0)
        if not t:
            continue
        if obs_total < MIN_OBS_RELIABLE:
            continue
        pct = 100 * v / t
        if best is None or pct > best["part_velo_pct"]:
            best = {
                "code_secteur": code,
                "nom_secteur": sector_names.get(code, code),
                "arrondissement": SECTOR_TO_BOROUGH[code],
                "part_velo_pct": round(pct, 2),
                "deplacements_total": round(t),
                "observations_brutes": obs_total,
            }
    return best


def main():
    DATA_DIR.mkdir(exist_ok=True)
    scratch = ROOT / ".scratch_od"
    scratch.mkdir(exist_ok=True)
    pm23_path = scratch / "pm23_matrice.xlsx"
    eod18_path = scratch / "eod18_matrice.xlsx"

    log("Downloading OD matrices (2023 and 2018)...")
    download(PM23_URL, pm23_path)
    download(EOD18_URL, eod18_path)

    log("Reading sector name dictionary (2023 file)...")
    sector_names = read_sector_names(pm23_path)

    log("Processing 2023 (Perspectives mobilité)...")
    velo_pond_23, total_pond_23, velo_obs_23, total_obs_23 = velo_sums_by_sector(pm23_path)
    log("Processing 2018 (enquête origine-destination)...")
    velo_pond_18, total_pond_18, velo_obs_18, total_obs_18 = velo_sums_by_sector(eod18_path)

    velo23, total23 = aggregate_to_boroughs(velo_pond_23, total_pond_23)
    velo18, total18 = aggregate_to_boroughs(velo_pond_18, total_pond_18)

    boroughs = sorted(set(SECTOR_TO_BOROUGH.values()))
    rows = []
    for b in boroughs:
        t23, v23 = total23.get(b), velo23.get(b)
        t18, v18 = total18.get(b), velo18.get(b)
        pct23 = (100 * v23 / t23) if t23 else None
        pct18 = (100 * v18 / t18) if t18 else None
        rows.append({
            "arrondissement": b,
            "part_velo_2018_pct": round(pct18, 2) if pct18 is not None else None,
            "part_velo_2023_pct": round(pct23, 2) if pct23 is not None else None,
            "deplacements_total_2023": round(t23) if t23 else None,
            "deplacements_total_2018": round(t18) if t18 else None,
        })

    log("Finding the single highest-share sub-sector (2023 and 2018)...")
    top23 = top_sector(velo_pond_23, total_pond_23, velo_obs_23, total_obs_23, sector_names)
    top18 = top_sector(velo_pond_18, total_pond_18, velo_obs_18, total_obs_18, sector_names)

    out = {
        "description": (
            "Part modale du vélo (mode exclusif, incluant vélo électrique et BIXI) parmi tous les "
            "déplacements (24h, tous motifs) des résident·e·s de chaque arrondissement de Montréal, "
            "calculée à partir des matrices de déplacements par secteur de pondération (origine) de "
            "l'ARTM. 2018 et 2023 utilisent le même découpage de secteurs (SP23), ce qui rend la "
            "comparaison directement comparable d'une édition à l'autre."
        ),
        "source_2023": "https://donnees.artm.quebec/catalogue/dataset/enquete-metropolitaine-2023-perspectives-mobilite",
        "source_2018": "https://donnees.artm.quebec/catalogue/dataset/enquete-origine-destination-2018",
        "methode": (
            "Pour chaque arrondissement, somme pondérée (champ 'pond') des déplacements en mode "
            "Vélo exclusif (incluant vélo électrique et BIXI) ayant leur origine dans un des secteurs "
            "de l'arrondissement, divisée par la somme des déplacements tous modes ayant la même "
            "origine, toutes destinations confondues. Quelques secteurs chevauchent deux "
            "arrondissements (ex. 1098 Sud-Ouest/Ville-Marie) ; ils sont assignés une seule fois, à "
            "l'arrondissement principal cité dans leur description — voir SECTOR_TO_BOROUGH dans "
            "scripts/analyze_velo_secteurs.py."
        ),
        "arrondissements": rows,
        "secteur_max_velo": {
            "description": (
                f"Secteur de pondération (intra-arrondissement, échelle plus fine que l'arrondissement) "
                f"avec la part vélo la plus élevée, parmi les secteurs ayant au moins "
                f"{MIN_OBS_RELIABLE} observations brutes dans l'enquête (seuil de fiabilité utilisé par "
                f"l'ARTM elle-même)."
            ),
            "2023": top23,
            "2018": top18,
        },
    }

    out_path = DATA_DIR / "velo_secteurs.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    log(f"Wrote {out_path} ({out_path.stat().st_size:,} bytes)")

    for r in sorted(rows, key=lambda r: (r["part_velo_2023_pct"] or -1), reverse=True):
        log(f"  {r['arrondissement']:<45} 2018={r['part_velo_2018_pct']}%  2023={r['part_velo_2023_pct']}%")
    log(f"Top secteur 2023: {top23}")
    log(f"Top secteur 2018: {top18}")


if __name__ == "__main__":
    main()
