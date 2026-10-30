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
