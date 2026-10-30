#!/usr/bin/env python3
"""
Met à jour les données du portail à partir du Pôle de données en mobilité de l'ARTM
(https://donnees.artm.quebec), de Données Québec, de Données Montréal, de la SAAQ
et du flux GBFS de BIXI.

Ce script ne touche jamais data/parts_modales.json : ce fichier contient des
chiffres sourcés manuellement dans les rapports officiels d'enquête de l'ARTM
(publiés tous les ~5 ans), pas des données rafraîchies automatiquement.
"""
import csv
import io
import json
import math
import re
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

ARTM_API = "https://donnees.artm.quebec/catalogue/api/3/action"
UA = "ARTM-Mobility-Dashboard/1.0 (open data research; +https://github.com/; contact: gabriel.fortin97@gmail.com)"

SOURCES = []  # collects {name, dataset_url, fetched_at} for data/meta.json


def log(msg):
    print(f"[update_data] {msg}", flush=True)


def http_get(url, retries=3, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    last_err = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
            log(f"  retry {attempt+1}/{retries} for {url}: {e}")
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {url}: {last_err}")


def ckan_package_show(package_id):
    url = f"{ARTM_API}/package_show?id={package_id}"
    data = json.loads(http_get(url))
    if not data.get("success"):
        raise RuntimeError(f"CKAN error for {package_id}: {data.get('error')}")
    return data["result"]


def find_resource(pkg, name_contains=None, fmt=None):
    """Return the first resource whose name contains name_contains (case-insens.)
    and/or whose format matches fmt. Raises if none found."""
    for res in pkg.get("resources", []):
        name = (res.get("name") or "").lower()
        rfmt = (res.get("format") or "").lower()
        if name_contains and name_contains.lower() not in name:
            continue
        if fmt and rfmt != fmt.lower():
            continue
        return res
    raise RuntimeError(
        f"No resource matching name~={name_contains!r} format={fmt!r} in dataset {pkg.get('name')}"
    )


def fetch_csv_rows(url):
    raw = http_get(url)
    text = raw.decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def record_source(label, dataset_name, dataset_url):
    SOURCES.append({
        "label": label,
        "dataset": dataset_name,
        "url": dataset_url,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    })


def write_json(name, obj):
    path = DATA_DIR / name
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    log(f"  wrote {path.relative_to(ROOT)} ({path.stat().st_size:,} bytes)")


# ---------------------------------------------------------------------------
# 1. Achalandage (ridership) — STM, RTL, STL, exo, navettes fluviales, régional
# ---------------------------------------------------------------------------

RIDERSHIP_DATASETS = [
    # (ckan package id, agency label, csv resource name fragment, kind)
    ("achalandage-regional-lie-de-la-region-metropolitaine-de-montreal", "ARTM (régional)", "mensuel", "lié"),
    ("achalandage-lie-du-reseau-regulier-de-la-societe-de-transport-de-montreal", "STM", "mensuel", "lié"),
    ("achalandage-lie-des-services-de-transport-en-commun-du-rtl", "RTL", "mensuel", "lié"),
    ("achalandage-lie-des-services-de-transport-regulier-de-la-societe-de-transport-de-laval", "STL", "mensuel", "lié"),
    ("achalandage-non-lie-par-mode-pour-les-services-reguliers-d-autobus-et-train-d-exo", "exo", "mensuel", "non lié"),
    ("achalandage-non-lie-du-reseau-des-navettes-fluviales", "Navettes fluviales", "mensuel", "non lié"),
]

MONTHS_FR = {
    "Janvier": 1, "Février": 2, "Mars": 3, "Avril": 4, "Mai": 5, "Juin": 6,
    "Juillet": 7, "Aout": 8, "Août": 8, "Septembre": 9, "Octobre": 10,
    "Novembre": 11, "Décembre": 12,
}


def build_achalandage():
    log("Fetching ridership (achalandage) datasets...")
    rows_out = []
    for pkg_id, label, name_fragment, kind in RIDERSHIP_DATASETS:
        try:
            pkg = ckan_package_show(pkg_id)
            res = find_resource(pkg, name_contains=name_fragment, fmt="csv")
            csv_rows = fetch_csv_rows(res["url"])
            record_source(f"achalandage-{label}", pkg["title"], f"https://donnees.artm.quebec/catalogue/dataset/{pkg_id}")
        except Exception as e:
            log(f"  WARN: skipping {pkg_id}: {e}")
            continue

        for r in csv_rows:
            try:
                annee = int(r["Annee"])
                no_mois = int(r["No_mois"])
            except (KeyError, ValueError):
                continue
            mode = r.get("Mode_de_transport") or ""
            detail = r.get("Detail") or ""
            try:
                val = float(r["Achalandage"])
            except (KeyError, ValueError):
                continue
            rows_out.append({
                "annee": annee,
                "mois": no_mois,
                "agence": label,
                "mode": mode,
                "detail": detail,
                "type": kind,
                "achalandage": val,
            })

    rows_out.sort(key=lambda r: (r["agence"], r["annee"], r["mois"]))
    write_json("achalandage.json", {
        "description": (
            "Achalandage mensuel par agence. 'type'='lié' (STM, RTL, STL, ARTM régional) "
            "compte les déplacements complets, correspondances incluses une seule fois ; "
            "'type'='non lié' (exo, navettes fluviales) compte les validations/montées — "
            "les deux ne sont pas directement comparables en valeur absolue."
        ),
        "rows": rows_out,
    })
    return rows_out


# ---------------------------------------------------------------------------
# 2. Titres de transport — évolution des tarifs
#
# Le jeu de données brut compte >1000 produits tarifaires (combinaisons de
# zones CIT historiques). On ne garde que les passes mensuelles "grand public"
# (tarif ordinaire), en chaînant les anciens titres TRAM1-4 (jusqu'à la
# refonte tarifaire de 2021-2022) avec leurs équivalents actuels Zone A/AB/
# ABC/ABCD, pour obtenir une série continue 2018 -> aujourd'hui.
# ---------------------------------------------------------------------------

FARE_CHAINS = {
    "Zone A (centre / ancien TRAM1)": ["TRAM1-Mensuel-O", "Zone A-Mensuel-O"],
    "Zone AB (ancien TRAM2)": ["TRAM2-Mensuel-O", "Zone AB-Mensuel-O"],
    "Zone ABC (ancien TRAM3)": ["TRAM3-Mensuel-O", "Zone ABC-Mensuel-O"],
    "Zone ABCD (ancien TRAM4)": ["TRAM4-Mensuel-O", "Zone ABCD-Mensuel-O"],
}


def build_tarifs():
    log("Fetching fare history (titres de transport)...")
    pkg = ckan_package_show("titres-de-transport-actuels-et-historiques-de-l-artm")
    res = find_resource(pkg, fmt="csv")
    rows = fetch_csv_rows(res["url"])
    record_source("tarifs", pkg["title"], "https://donnees.artm.quebec/catalogue/dataset/titres-de-transport-actuels-et-historiques-de-l-artm")

    series = {}
    for display_name, product_names in FARE_CHAINS.items():
        by_date = {}
        for product in product_names:
            for r in rows:
                if r.get("TitreNom") != product:
                    continue
                try:
                    montant = float(r["TarifMontant"])
                except (KeyError, ValueError):
                    continue
                date = r.get("DateDebutValidite")
                if not date:
                    continue
                by_date[date] = montant  # later product name in the list wins on same date
        series[display_name] = [
            {"date": d, "montant": by_date[d]} for d in sorted(by_date)
        ]

    write_json("tarifs.json", {
        "description": (
            "Prix de la passe mensuelle ordinaire (tarif adulte régulier) par zone tarifaire, 2018 à "
            "aujourd'hui, en dollars courants (non ajustés pour l'inflation). Les anciens titres TRAM1-4 "
            "(avant la refonte tarifaire de 2021-2022) sont chaînés avec leurs équivalents actuels "
            "Zone A/AB/ABC/ABCD pour obtenir une série continue."
        ),
        "series": series,
    })
    return series


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def haversine_m(p1, p2):
    lon1, lat1 = p1[0], p1[1]
    lon2, lat2 = p2[0], p2[1]
    r = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(min(1, math.sqrt(a)))


def line_length_m(coords):
    return sum(haversine_m(coords[i], coords[i + 1]) for i in range(len(coords) - 1))


def geom_length_m(geom):
    t = geom.get("type")
    if t == "LineString":
        return line_length_m(geom["coordinates"])
    if t == "MultiLineString":
        return sum(line_length_m(part) for part in geom["coordinates"])
    return 0.0


def round_coords(obj, ndigits=5):
    if isinstance(obj, list):
        if obj and isinstance(obj[0], (int, float)):
            return [round(v, ndigits) for v in obj]
        return [round_coords(x, ndigits) for x in obj]
    return obj


# ---------------------------------------------------------------------------
# 3. Mesures préférentielles pour autobus (voies réservées, SRB, ...)
# ---------------------------------------------------------------------------

TYPE_LABELS = {
    "VR": "Voie réservée",
    "SRB": "Service rapide par bus",
    "UAB": "Usage autorisé aux autobus",
    "VEFA": "Voie exclusive pour autobus",
    "STB": "Signal transport en commun",
}


def build_mesures_bus():
    log("Fetching bus priority measures (mesures préférentielles pour autobus)...")
    pkg = ckan_package_show("mesures-preferentielles-pour-autobus")
    res = find_resource(pkg, fmt="geojson")
    gj = json.loads(http_get(res["url"]))
    record_source("mesures-bus", pkg["title"], "https://donnees.artm.quebec/catalogue/dataset/mesures-preferentielles-pour-autobus")

    by_type_km = {}
    by_year_km = {}
    features_out = []
    total_km = 0.0
    for feat in gj.get("features", []):
        props = feat.get("properties", {})
        length_km = geom_length_m(feat["geometry"]) / 1000.0
        total_km += length_km
        t = props.get("type") or "Autre"
        by_type_km[t] = by_type_km.get(t, 0.0) + length_km
        annee = props.get("annee") or 0
        year_key = str(annee) if annee else "inconnue"
        by_year_km[year_key] = by_year_km.get(year_key, 0.0) + length_km

        features_out.append({
            "type": "Feature",
            "properties": {
                "nom": props.get("nom"),
                "type": t,
                "direction": props.get("direction"),
                "annee": annee,
                "utilisateur": props.get("utilisateur"),
                "gestionnaire": props.get("gestionnaire"),
                "longueur_km": round(length_km, 3),
            },
            "geometry": {
                "type": feat["geometry"]["type"],
                "coordinates": round_coords(feat["geometry"]["coordinates"]),
            },
        })

    write_json("mesures_bus.geojson", {"type": "FeatureCollection", "features": features_out})
    write_json("mesures_bus.json", {
        "description": "Mesures préférentielles pour autobus sur le territoire de l'ARTM (voies réservées, SRB, etc.). Longueurs calculées par géométrie (grand cercle).",
        "total_km": round(total_km, 1),
        "par_type_km": {TYPE_LABELS.get(k, k): round(v, 1) for k, v in sorted(by_type_km.items(), key=lambda kv: -kv[1])},
        "cumul_par_annee_km": by_year_km,
    })
    return total_km


# ---------------------------------------------------------------------------
# 4. Réseau express vélo (REV) — Montréal
# ---------------------------------------------------------------------------

def build_rev():
    log("Fetching Réseau express vélo (REV)...")
    pkg = ckan_package_show("reseau-express-velo")
    res = find_resource(pkg, fmt="geojson")
    gj = json.loads(http_get(res["url"]))
    record_source("rev", pkg["title"], "https://donnees.artm.quebec/catalogue/dataset/reseau-express-velo")

    total_km = 0.0
    features_out = []
    for feat in gj.get("features", []):
        length_km = geom_length_m(feat["geometry"]) / 1000.0
        total_km += length_km
        props = feat.get("properties", {})
        features_out.append({
            "type": "Feature",
            "properties": {
                "projet": props.get("PROJET_NOM"),
                "arrondissement": (props.get("NOM_ARR_VI") or "").strip(),
                "saisons4": props.get("SAISONS4"),
                "protege": props.get("PROTEGE_4S"),
                "longueur_km": round(length_km, 3),
            },
            "geometry": {
                "type": feat["geometry"]["type"],
                "coordinates": round_coords(feat["geometry"]["coordinates"]),
            },
        })

    write_json("rev.geojson", {"type": "FeatureCollection", "features": features_out})
    write_json("rev.json", {
        "description": "Réseau express vélo (REV) réalisé, agglomération de Montréal. Cible du projet : 184 km.",
        "total_km_realise": round(total_km, 1),
        "cible_km": 184,
    })
    return total_km


# ---------------------------------------------------------------------------
# 5. Réseau cyclable de l'agglomération de Montréal — stats agrégées seulement
#    (le GeoJSON complet est trop volumineux pour être servi tel quel ; on ne
#    garde que les totaux calculés.)
# ---------------------------------------------------------------------------

def build_velo_mtl_stats():
    log("Fetching Montreal bike network (stats only, full geometry not shipped)...")
    pkg = ckan_package_show("pistes-cyclables")
    res = find_resource(pkg, fmt="geojson")
    gj = json.loads(http_get(res["url"]))
    record_source("velo-mtl", pkg["title"], "https://donnees.artm.quebec/catalogue/dataset/pistes-cyclables")

    total_km = 0.0
    existant_km = 0.0
    quatre_saisons_km = 0.0
    protege_km = 0.0
    by_type_km = {}
    for feat in gj.get("features", []):
        props = feat.get("properties", {})
        length_m = props.get("LONGUEUR")
        if length_m is None:
            length_m = geom_length_m(feat["geometry"])
        length_km = float(length_m) / 1000.0
        total_km += length_km
        if (props.get("AVANCEMENT_CODE") or "").upper() == "E":
            existant_km += length_km
        if (props.get("SAISONS4") or "").lower() == "oui":
            quatre_saisons_km += length_km
        if (props.get("PROTEGE_4S") or "").lower() == "oui":
            protege_km += length_km
        t = props.get("TYPE_VOIE_DESC") or "Autre"
        by_type_km[t] = by_type_km.get(t, 0.0) + length_km

    write_json("velo_mtl.json", {
        "description": "Réseau cyclable de l'agglomération de Montréal uniquement (ne couvre pas Laval, Longueuil, ni les couronnes). Longueurs en km, telles que fournies par Montréal (champ LONGUEUR).",
        "total_km": round(total_km, 1),
        "existant_km": round(existant_km, 1),
        "quatre_saisons_km": round(quatre_saisons_km, 1),
        "protege_4_saisons_km": round(protege_km, 1),
        "par_type_km": {k: round(v, 1) for k, v in sorted(by_type_km.items(), key=lambda kv: -kv[1])},
    })
    return total_km


# ---------------------------------------------------------------------------
# 6. Terminus métropolitains, stationnements incitatifs, zones tarifaires
# ---------------------------------------------------------------------------

def simplify_geojson(gj, keep_props):
    out = []
    for feat in gj.get("features", []):
        props = feat.get("properties", {})
        out.append({
            "type": "Feature",
            "properties": {k: props.get(k) for k in keep_props},
            "geometry": {
                "type": feat["geometry"]["type"],
                "coordinates": round_coords(feat["geometry"]["coordinates"]),
            },
        })
    return {"type": "FeatureCollection", "features": out}


def build_terminus_stationnements():
    log("Fetching terminus métropolitains & stationnements incitatifs...")
    pkg = ckan_package_show("terminus-metropolitains-et-stationnements-incitatifs")
    record_source("terminus-stationnements", pkg["title"], "https://donnees.artm.quebec/catalogue/dataset/terminus-metropolitains-et-stationnements-incitatifs")

    res_terminus = find_resource(pkg, name_contains="Terminus", fmt="geojson")
    gj_terminus = json.loads(http_get(res_terminus["url"]))
    simplified = simplify_geojson(gj_terminus, ["a_groupnom", "a_type", "a_gestionn", "a_service"])
    write_json("terminus.geojson", simplified)

    res_park = find_resource(pkg, name_contains="Stationnements incitatifs", fmt="geojson")
    gj_park = json.loads(http_get(res_park["url"]))
    simplified_park = simplify_geojson(gj_park, ["a_groupnom", "a_type", "a_gestionn", "a_service"])
    write_json("stationnements.geojson", simplified_park)

    return len(gj_terminus.get("features", [])), len(gj_park.get("features", []))


def build_zones_tarifaires():
    log("Fetching zones tarifaires...")
    pkg = ckan_package_show("zones-tarifaires-du-transport-en-commun-pour-la-region-metropolitaine-de-montreal")
    res = find_resource(pkg, fmt="geojson")
    gj = json.loads(http_get(res["url"]))
    record_source("zones-tarifaires", pkg["title"], "https://donnees.artm.quebec/catalogue/dataset/zones-tarifaires-du-transport-en-commun-pour-la-region-metropolitaine-de-montreal")
    simplified = simplify_geojson(gj, ["a_zt", "a_nomzt"])
    write_json("zones_tarifaires.geojson", simplified)


# ---------------------------------------------------------------------------
# 7. Parc automobile — PAS récupéré automatiquement.
#
# Le jeu de données SAAQ "Véhicules en circulation" publié sur le Pôle ARTM
# n'existe qu'en fichiers province-entière par année (un par immatriculation,
# plusieurs centaines de Mo chacun) : inadapté à un robot hebdomadaire. Les
# chiffres de parc automobile affichés sur le site viennent plutôt de
# data/parts_modales.json (faits_saillants_2023), sourcés directement du
# rapport de l'ARTM, qui cite déjà la SAAQ pour sa propre comparaison.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# 8. Métro STM — kilométrage réel des voitures et incidents
#
# Fichiers CSV de la STM (séparateur ";", décimales à virgule, milliers avec
# espace insécable) référencés dans le catalogue ARTM. Le kilométrage est en
# km-voiture : un train de métro STM compte toujours 9 voitures (MR-73 en
# 3 éléments de 3, Azur en rame fixe de 9), d'où km-train = km-voiture / 9.
# ---------------------------------------------------------------------------

METRO_LINES = ["Ligne verte", "Ligne orange", "Ligne jaune", "Ligne bleue"]
MATERIEL = {"10": "Azur (MPM-10)", "73": "MR-73"}
INCIDENT_LONG = {"05 à 09 min", "10 à 14 min", "15 à 19 min", "20 à 24 min", "25 à 29 min", "30 min et plus"}


def stm_num(s):
    s = (s or "").strip()
    if s in ("", "#"):
        return 0.0
    return float("".join(s.split()).replace(" ", "").replace(",", "."))


def stm_csv_rows(raw, header_marker=None):
    text = raw.decode("utf-8-sig")
    if header_marker:
        # Le CSV des incidents commence par une ligne de note avant l'en-tête.
        text = text[text.index(header_marker):]
    return csv.DictReader(io.StringIO(text), delimiter=";")


def build_metro_stm():
    log("Fetching STM metro mileage + incidents...")
    pkg_km = ckan_package_show("stm-kilometrage-realise-par-les-voitures-de-metro-de-la-stm")
    pkg_inc = ckan_package_show("incidents-du-reseau-du-metro")
    km_raw = http_get(find_resource(pkg_km, fmt="csv")["url"], timeout=180)
    inc_raw = http_get(find_resource(pkg_inc, fmt="csv")["url"], timeout=180)
    record_source("metro-km", pkg_km["title"], "https://donnees.artm.quebec/catalogue/dataset/stm-kilometrage-realise-par-les-voitures-de-metro-de-la-stm")
    record_source("metro-incidents", pkg_inc["title"], "https://donnees.artm.quebec/catalogue/dataset/incidents-du-reseau-du-metro")

    km_line_year = {}       # (ligne, année) -> km-voiture
    km_mat_month = {}       # (matériel, "AAAA-MM") -> km-voiture
    km_month = {}           # "AAAA-MM" -> km-voiture
    km_compo_year = {}      # (composition, matériel, année) -> km-voiture
    weekday_km = {}         # année -> km-voiture en jour de semaine
    weekday_dates = {}      # année -> set(dates "Semaine")
    for r in stm_csv_rows(km_raw):
        km = stm_num(r["Km voiture"])
        y, ym, ligne, mat = r["Année"], r["Année/mois"], r["Ligne"], r["Type matériel"]
        km_month[ym] = km_month.get(ym, 0) + km
        if ligne in METRO_LINES:
            km_line_year[(ligne, y)] = km_line_year.get((ligne, y), 0) + km
        if mat in MATERIEL:
            km_mat_month[(mat, ym)] = km_mat_month.get((mat, ym), 0) + km
            k = (r["Composition du train"], mat, y)
            km_compo_year[k] = km_compo_year.get(k, 0) + km
        if r["Type de jour"] == "Semaine":
            weekday_km[y] = weekday_km.get(y, 0) + km
            weekday_dates.setdefault(y, set()).add(r["Date"])

    months = sorted(km_month)
    last_month = months[-1]
    years = sorted({ym[:4] for ym in months})
    full_years = [y for y in years if sum(1 for m in months if m.startswith(y)) == 12]
    # Comparaison à période égale (janvier → dernier mois publié) pour l'année en cours.
    ytd_suffix = last_month[5:]
    km_ytd = {y: sum(v for m, v in km_month.items() if m.startswith(y) and m[5:] <= ytd_suffix) for y in years}

    top_trains = {}
    for y in full_years:
        best = max(((c, mat, v) for (c, mat, yy), v in km_compo_year.items() if yy == y and mat == "10"),
                   key=lambda t: t[2], default=None)
        if best:
            top_trains[y] = {"composition": best[0], "materiel": MATERIEL[best[1]], "km_train": round(best[2] / 9)}

    # --- incidents ---
    incidents = list(stm_csv_rows(inc_raw, header_marker="Numero d'incident"))
    inc_last_month = max(r["Année civile/mois"] for r in incidents)
    inc_years = sorted({r["Année civile"] for r in incidents})

    def count(pred):
        out = {}
        for r in incidents:
            if pred(r):
                out[r["Année civile"]] = out.get(r["Année civile"], 0) + 1
        return dict(sorted(out.items()))

    long_by_line = {L: count(lambda r, L=L: r["Ligne"] == L and r["Incident en minutes"] in INCIDENT_LONG) for L in METRO_LINES}
    over30 = count(lambda r: r["Incident en minutes"] == "30 min et plus")
    evacuations = count(lambda r: r["Évacuation"] not in ("", "#"))
    urgences = count(lambda r: r["Urgence métro"] == "1")

    # Pannes attribuées au matériel roulant, rapportées au km parcouru sur la
    # même période (les incidents peuvent être publiés avec un décalage).
    pannes_par_mkm = {}
    for mat, label in MATERIEL.items():
        series = {}
        for y in inc_years:
            months_y = {r["Année civile/mois"] for r in incidents if r["Année civile"] == y}
            n = sum(1 for r in incidents if r["Année civile"] == y and r["Cause primaire"] == "Matériel roulant" and r["Type de matériel"] == mat)
            km = sum(km_mat_month.get((mat, m), 0) for m in months_y)
            if km > 0:
                series[y] = round(n / (km / 1e6), 2)
        pannes_par_mkm[label] = series

    # Causes des incidents de 5 min et plus, sur les 3 dernières années complètes.
    cause_years = [y for y in inc_years if y < inc_last_month[:4]][-3:]
    causes = {}
    for r in incidents:
        if r["Année civile"] in cause_years and r["Incident en minutes"] in INCIDENT_LONG:
            sec = r["Cause secondaire"]
            if r["Cause primaire"] == "Matériel roulant":
                label = f"Matériel roulant — {sec}"
            elif r["Cause primaire"] == "Exploitation trains":
                label = "Exploitation des trains"
            elif r["Cause primaire"] == "#N/A":
                label = "Non précisée"
            else:
                label = sec
            causes[label] = causes.get(label, 0) + 1
    causes_sorted = sorted(causes.items(), key=lambda kv: -kv[1])

    write_json("metro_stm.json", {
        "description": "Kilométrage réel des voitures de métro (km-voiture) et incidents du réseau du métro, STM. Un train = 9 voitures.",
        "km_dernier_mois": last_month,
        "incidents_dernier_mois": inc_last_month,
        "km_voiture_par_ligne_annee": {L: {y: round(km_line_year.get((L, y), 0)) for y in years} for L in METRO_LINES},
        "km_voiture_cumul_meme_periode": {"jusqu_au_mois": ytd_suffix, "par_annee": {y: round(v) for y, v in km_ytd.items()}},
        "km_voiture_par_mois": {m: round(km_month[m]) for m in months},
        "km_voiture_par_materiel_annee": {
            label: {y: round(sum(v for (mm, ym), v in km_mat_month.items() if mm == mat and ym.startswith(y))) for y in years}
            for mat, label in MATERIEL.items()
        },
        "km_train_par_jour_semaine": {y: round(weekday_km[y] / 9 / len(weekday_dates[y])) for y in full_years if weekday_dates.get(y)},
        "train_azur_le_plus_roule": top_trains,
        "incidents_5min_plus_par_ligne": long_by_line,
        "incidents_30min_plus": over30,
        "evacuations": evacuations,
        "urgences_metro": urgences,
        "pannes_materiel_roulant_par_million_km_voiture": pannes_par_mkm,
        "causes_5min_plus": {"annees": cause_years, "rows": [{"cause": c, "n": n} for c, n in causes_sorted]},
    })


# ---------------------------------------------------------------------------
# 9. REM — offre planifiée (GTFS)
# ---------------------------------------------------------------------------

def build_rem():
    import zipfile
    log("Fetching REM GTFS...")
    pkg = ckan_package_show("offres-de-service-planifie-du-reseau-express-metropolitain")
    res = find_resource(pkg, name_contains="récente")
    zf = zipfile.ZipFile(io.BytesIO(http_get(res["url"], timeout=180)))
    record_source("rem-gtfs", pkg["title"], "https://donnees.artm.quebec/catalogue/dataset/offres-de-service-planifie-du-reseau-express-metropolitain")

    def rows(name):
        return list(csv.DictReader(io.StringIO(zf.read(name).decode("utf-8-sig"))))

    routes = rows("routes.txt")
    trips = rows("trips.txt")
    stops = rows("stops.txt")
    feed = rows("feed_info.txt")[0]
    weekday_services = {c["service_id"] for c in rows("calendar.txt") if c["wednesday"] == "1"}

    pts = {}
    for p in rows("shapes.txt"):
        pts.setdefault(p["shape_id"], []).append((int(p["shape_pt_sequence"]), float(p["shape_pt_lon"]), float(p["shape_pt_lat"])))
    shape_km = {k: line_length_m([(lon, lat) for _, lon, lat in sorted(v)]) / 1000 for k, v in pts.items()}

    wk = [t for t in trips if t["service_id"] in weekday_services]
    per_route = []
    for r in routes:
        rt = [t for t in wk if t["route_id"] == r["route_id"]]
        if not rt:
            continue
        per_route.append({
            "nom": r["route_long_name"],
            "departs_jour_semaine": len(rt),
            "longueur_km": round(max(shape_km[t["shape_id"]] for t in rt), 1),
        })

    write_json("rem.json", {
        "description": "Offre planifiée du REM pour un jour de semaine type, calculée à partir du GTFS publié.",
        "gtfs_version": feed.get("feed_version"),
        "gtfs_debut": feed.get("feed_start_date"),
        "stations": sum(1 for s in stops if s.get("location_type") == "1"),
        "departs_jour_semaine": len(wk),
        "km_train_jour_semaine": round(sum(shape_km[t["shape_id"]] for t in wk)),
        "services": per_route,
    })


# ---------------------------------------------------------------------------
# 10. Ventes de titres ARTM (quantités et montants nets, quotidiens)
# ---------------------------------------------------------------------------

def build_ventes_titres():
    log("Fetching ventes de titres...")
    pkg = ckan_package_show("ventes-et-remboursements-des-titres-de-l-artm")
    res = find_resource(pkg, name_contains="ventes et remboursements")
    record_source("ventes-titres", pkg["title"], "https://donnees.artm.quebec/catalogue/dataset/ventes-et-remboursements-des-titres-de-l-artm")
    rows = fetch_csv_rows(res["url"])
    last_date = max(r["DateTransaction"] for r in rows)
    cutoff = last_date[5:]  # même période (1er janvier → dernier jour publié) chaque année
    qte, montant = {}, {}
    for r in rows:
        d = r["DateTransaction"]
        if d[5:] > cutoff:
            continue
        k = (r["TypeTitre"], d[:4])
        qte[k] = qte.get(k, 0) + float(r["QuantiteNette"] or 0)
        montant[k] = montant.get(k, 0) + float(r["MontantNet"] or 0)
    types = sorted({t for t, _ in qte})
    years = sorted({y for _, y in qte})
    write_json("ventes_titres.json", {
        "description": "Ventes nettes de titres ARTM, cumul du 1er janvier au même jour chaque année (comparaison à période égale).",
        "derniere_date": last_date,
        "quantite": {t: {y: round(qte.get((t, y), 0)) for y in years} for t in types},
        "montant": {t: {y: round(montant.get((t, y), 0)) for y in years} for t in types},
    })


# ---------------------------------------------------------------------------
# 11. Compteurs vélo permanents (Eco-Compteur, Ville de Montréal)
#
# Fichiers annuels au pas de 15 minutes (~80 Mo chacun). Pour ne pas tout
# retélécharger chaque semaine, les agrégats mensuels par compteur des années
# terminées sont gardés dans data/compteurs_velo_cache.json ; seule l'année
# en cours (et toute année absente du cache) est recalculée.
# ---------------------------------------------------------------------------

VELO_COMPTEUR_YEARS_FROM = 2019
VELO_COMPTEUR_SKIP = {2020, 2021, 2022}  # années pandémiques : pas utiles aux comparaisons affichées
VELO_MAX_VARIATION = 60  # % — au-delà, rupture probable (compteur déplacé, en panne, piste refaite)


def _compteurs_year(url):
    """Agrège un fichier annuel en {compteur: {"mois": {MM: n}, "jours": {MM: nb jours avec données}, "record": [date, n]}}."""
    daily = {}
    for r in csv.DictReader(io.StringIO(http_get(url, timeout=300).decode("utf-8-sig"))):
        v = r.get("nb_passages")
        if v in (None, "", "NA"):
            continue
        d = daily.setdefault(r["id_compteur"], {})
        d[r["date"]] = d.get(r["date"], 0) + int(float(v))
    out = {}
    for c, days in daily.items():
        mois, jours = {}, {}
        for date, n in days.items():
            m = date[5:7]
            mois[m] = mois.get(m, 0) + n
            jours[m] = jours.get(m, 0) + 1
        rec = max(days.items(), key=lambda kv: kv[1])
        out[c] = {"mois": mois, "jours": jours, "record": list(rec), "dernier_jour": max(days)}
    return out


def build_compteurs_velo():
    import calendar
    log("Fetching bike counters (compteurs vélo)...")
    pkg = ckan_package_show("cyclistes")
    record_source("compteurs-velo", pkg["title"], "https://donnees.artm.quebec/catalogue/dataset/cyclistes")
    noms = {}
    for r in csv.DictReader(io.StringIO(http_get(find_resource(pkg, name_contains="localisation")["url"]).decode("utf-8-sig")), delimiter=";"):
        noms[r["instance"]] = r["Nom Rue Global"]

    cache_path = DATA_DIR / "compteurs_velo_cache.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    this_year = datetime.now(timezone.utc).year
    for res in pkg["resources"]:
        m = re.match(r"Velos - Comptage (\d{4}) - Eco-Compteur", res.get("name") or "")
        if not m:
            continue
        y = int(m.group(1))
        if y < VELO_COMPTEUR_YEARS_FROM or y in VELO_COMPTEUR_SKIP:
            continue
        if str(y) in cache and y < this_year:
            continue
        log(f"  {y}...")
        cache[str(y)] = _compteurs_year(res["url"])
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, separators=(",", ":"))

    years = sorted(cache)
    cur = years[-1]
    dernier_jour = max(c["dernier_jour"] for c in cache[cur].values())
    full_years = [y for y in years if y != cur or dernier_jour.endswith("12-31")]
    ref = full_years[-1]
    # Dernier mois complet de l'année en cours (pour comparer à période égale).
    last_full_month = int(dernier_jour[5:7]) - (0 if dernier_jour[8:] == f"{calendar.monthrange(int(cur), int(dernier_jour[5:7]))[1]:02d}" else 1)

    def mois_complets(y, c, months):
        """Vrai si le compteur a des données ≥ 90 % des jours de chacun des mois."""
        d = cache[y].get(c)
        return d is not None and all(d["jours"].get(f"{m:02d}", 0) >= 0.9 * calendar.monthrange(int(y), m)[1] for m in months)

    def total(y, c, months):
        return sum(cache[y][c]["mois"].get(f"{m:02d}", 0) for m in months)

    def compare(a, b, months):
        kept, exclus, ta, tb = 0, 0, 0, 0
        for c in cache[b]:
            if not (mois_complets(a, c, months) and mois_complets(b, c, months)):
                continue
            va, vb = total(a, c, months), total(b, c, months)
            if va == 0 or abs(100 * (vb - va) / va) > VELO_MAX_VARIATION:
                exclus += 1
                continue
            kept += 1
            ta += va
            tb += vb
        return {"de": a, "a": b, "mois": [months[0], months[-1]], "compteurs": kept, "compteurs_exclus": exclus,
                "passages_de": ta, "passages_a": tb, "variation_pct": round(100 * (tb - ta) / ta, 1) if ta else None}

    all_months = list(range(1, 13))
    comparaisons = []
    if "2019" in cache and ref != "2019":
        comparaisons.append(compare("2019", ref, all_months))
    if str(int(ref) - 1) in cache:
        comparaisons.append(compare(str(int(ref) - 1), ref, all_months))
    if cur != ref and last_full_month >= 1:
        comparaisons.append(compare(ref, cur, list(range(1, last_full_month + 1))))

    complets = [c for c in cache[ref] if mois_complets(ref, c, all_months)]
    tops = sorted(complets, key=lambda c: -total(ref, c, all_months))[:12]
    saison = {f"{m:02d}": sum(cache[ref][c]["mois"].get(f"{m:02d}", 0) for c in complets) for m in all_months}
    total_ref = sum(saison.values())
    hiver = sum(saison[m] for m in ("12", "01", "02", "03"))
    rec_c = max(complets, key=lambda c: cache[ref][c]["record"][1])
    jours_ref = 366 if calendar.isleap(int(ref)) else 365

    write_json("compteurs_velo.json", {
        "description": "Passages de vélos aux compteurs permanents de la Ville de Montréal (Eco-Compteur).",
        "annee_reference": ref,
        "annee_courante": cur,
        "dernier_jour": dernier_jour,
        "compteurs_actifs_reference": len(complets),
        "top_sites": [{"nom": noms.get(c, c), "passages": total(ref, c, all_months),
                       "moyenne_jour": round(total(ref, c, all_months) / jours_ref)} for c in tops],
        "record_jour": {"nom": noms.get(rec_c, rec_c), "date": cache[ref][rec_c]["record"][0], "passages": cache[ref][rec_c]["record"][1]},
        "saisonnalite": saison,
        "part_hiver_pct": round(100 * hiver / total_ref, 1) if total_ref else None,
        "comparaisons": comparaisons,
        "seuil_exclusion_pct": VELO_MAX_VARIATION,
    })


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    results = {}
    steps = [
        ("achalandage", build_achalandage),
        ("tarifs", build_tarifs),
        ("mesures_bus", build_mesures_bus),
        ("rev", build_rev),
        ("velo_mtl", build_velo_mtl_stats),
        ("terminus_stationnements", build_terminus_stationnements),
        ("zones_tarifaires", build_zones_tarifaires),
        ("metro_stm", build_metro_stm),
        ("rem", build_rem),
        ("ventes_titres", build_ventes_titres),
        ("compteurs_velo", build_compteurs_velo),
    ]
    errors = []
    for name, fn in steps:
        try:
            results[name] = fn()
        except Exception as e:
            log(f"ERROR in {name}: {e}")
            errors.append(f"{name}: {e}")

    write_json("meta.json", {
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": SOURCES,
        "errors": errors,
    })

    if errors:
        log(f"Completed with {len(errors)} error(s): {errors}")
        # Don't fail the whole run for partial data — keep whatever succeeded.
    else:
        log("Completed successfully.")


if __name__ == "__main__":
    main()
