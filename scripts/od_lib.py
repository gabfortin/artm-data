"""
Fonctions partagées pour analyser les matrices de déplacements (OD) ARTM par
secteur de pondération / arrondissement de Montréal.

Utilisé par analyze_velo_secteurs.py et analyze_modes_secteurs.py. Pas de
dépendance stdlib-only ici : requiert openpyxl (voir README, section "sourcé
manuellement").
"""
import urllib.request
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
UA = "ARTM-Mobility-Dashboard/1.0 (open data research; contact: gabriel.fortin97@gmail.com)"

PM23_URL = "https://donnees.artm.quebec/catalogue/dataset/1a48f8c5-b8f4-4224-84c2-fc33987ff262/resource/7acec5e0-ae2c-4c7d-8ba5-e18fd766bd89/download/pm23_matrice_2b4.xlsx"
EOD18_URL = "https://donnees.artm.quebec/catalogue/dataset/4d5e7905-d3d6-4825-8b75-82ff40687157/resource/c624a36c-d099-4201-bad4-cf00babc5f78/download/eod18_matrice_2b5b.xlsx"

MODE_TOUS = "100"
MOTIF_TOUS = "1"
PERIODE_24H = "1"

# En dessous de ce nombre d'observations brutes (non pondérées) cumulées sur
# un secteur, l'ARTM elle-même considère la cellule peu fiable (voir l'onglet
# "Documentation" des fichiers matrices : "volumes... en rouge... inférieur à
# 30 observations"). Même seuil utilisé ici pour exclure les secteurs trop
# petits de la recherche du "secteur le plus élevé".
MIN_OBS_RELIABLE = 30

# Mapping secteur de pondération (SP23) -> arrondissement officiel de la
# Ville de Montréal. Construit à la main à partir du dictionnaire des 68
# secteurs montréalais de l'enquête (onglet "Dictionnaire" des fichiers
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


def log(prefix, msg):
    print(f"[{prefix}] {msg}", flush=True)


def download(url, dest):
    if dest.exists():
        return
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as resp, open(dest, "wb") as f:
        f.write(resp.read())


def ensure_matrices_cached():
    """Télécharge (ou réutilise le cache) les deux fichiers matrices OD et
    retourne leurs chemins locaux (2023, 2018)."""
    scratch = ROOT / ".scratch_od"
    scratch.mkdir(exist_ok=True)
    pm23_path = scratch / "pm23_matrice.xlsx"
    eod18_path = scratch / "eod18_matrice.xlsx"
    download(PM23_URL, pm23_path)
    download(EOD18_URL, eod18_path)
    return pm23_path, eod18_path


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


def sums_by_sector_multi(xlsx_path, mode_groups):
    """Un seul passage sur la feuille `donnees_matrices_plates` pour calculer,
    par secteur d'origine (SP23), la somme pondérée ('pond') et le nombre
    d'observations brutes ('obs') pour chaque groupe de modes demandé, ainsi
    que pour le total tous modes (mode 100). Motif = tous les motifs,
    période = 24h.

    mode_groups: {nom_groupe: {codes de mode à additionner}}
      ex. {"auto": {"10", "11"}, "tc": {"20", "30"}}

    Retourne: ({nom_groupe: (pond_par_secteur, obs_par_secteur)}, (total_pond_par_secteur, total_obs_par_secteur))
    """
    code_to_group = {}
    for name, codes in mode_groups.items():
        for c in codes:
            code_to_group.setdefault(c, []).append(name)

    group_pond = {name: {} for name in mode_groups}
    group_obs = {name: {} for name in mode_groups}
    total_pond, total_obs = {}, {}

    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb["donnees_matrices_plates"]
    rows = ws.iter_rows(values_only=True)
    next(rows)  # header: id, obs, pond

    for r in rows:
        rid, obs, pond = r[0], r[1], r[2]
        if rid is None or pond is None:
            continue
        origine, _destination, mode, motif, periode = rid.split("_")
        if motif != MOTIF_TOUS or periode != PERIODE_24H:
            continue
        if mode == MODE_TOUS:
            total_pond[origine] = total_pond.get(origine, 0) + pond
            total_obs[origine] = total_obs.get(origine, 0) + (obs or 0)
            continue
        for group_name in code_to_group.get(mode, []):
            group_pond[group_name][origine] = group_pond[group_name].get(origine, 0) + pond
            group_obs[group_name][origine] = group_obs[group_name].get(origine, 0) + (obs or 0)

    wb.close()
    return ({name: (group_pond[name], group_obs[name]) for name in mode_groups}, (total_pond, total_obs))


def aggregate_to_boroughs(num_pond, total_pond):
    num, total = {}, {}
    for code, v in num_pond.items():
        b = SECTOR_TO_BOROUGH.get(code)
        if b is None:
            continue
        num[b] = num.get(b, 0) + v
    for code, t in total_pond.items():
        b = SECTOR_TO_BOROUGH.get(code)
        if b is None:
            continue
        total[b] = total.get(b, 0) + t
    return num, total


def top_sector(num_pond, total_pond, num_obs, total_obs, sector_names):
    """Secteur montréalais (SP23) avec la plus haute part pour ce groupe de
    modes, en excluant les secteurs sous le seuil de fiabilité."""
    best = None
    for code in SECTOR_TO_BOROUGH:  # restreint aux secteurs de la Ville de Montréal
        t = total_pond.get(code)
        v = num_pond.get(code, 0)
        obs_total = total_obs.get(code, 0)
        if not t or obs_total < MIN_OBS_RELIABLE:
            continue
        pct = 100 * v / t
        if best is None or pct > best["part_pct"]:
            best = {
                "code_secteur": code,
                "nom_secteur": sector_names.get(code, code),
                "arrondissement": SECTOR_TO_BOROUGH[code],
                "part_pct": round(pct, 2),
                "deplacements_total": round(t),
                "observations_brutes": obs_total,
            }
    return best


def borough_rows(num23, total23, num18, total18, pct_key_2023, pct_key_2018):
    boroughs = sorted(set(SECTOR_TO_BOROUGH.values()))
    rows = []
    for b in boroughs:
        t23, v23 = total23.get(b), num23.get(b)
        t18, v18 = total18.get(b), num18.get(b)
        pct23 = (100 * v23 / t23) if t23 else None
        pct18 = (100 * v18 / t18) if t18 else None
        rows.append({
            "arrondissement": b,
            pct_key_2018: round(pct18, 2) if pct18 is not None else None,
            pct_key_2023: round(pct23, 2) if pct23 is not None else None,
            "deplacements_total_2023": round(t23) if t23 else None,
            "deplacements_total_2018": round(t18) if t18 else None,
        })
    return rows
