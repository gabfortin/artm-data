#!/usr/bin/env python3
"""
Calcule la part modale du transport collectif, de l'auto, de la marche et du
transport actif (vélo + marche) par arrondissement de Montréal, 2018 vs 2023
— même méthode que scripts/analyze_velo_secteurs.py (voir scripts/od_lib.py
pour la logique partagée).

Ne tourne pas dans le pipeline hebdomadaire (voir analyze_velo_secteurs.py
pour les raisons) : à relancer à la main à la prochaine édition de l'enquête.

Définition des groupes de modes (codes du dictionnaire ARTM) :
  - Transport collectif : Transport en commun (20) + TC et autre mode (30)
    — même regroupement que celui utilisé par l'ARTM dans ses propres
    tableaux de parts modales ("TC et TC+autres").
  - Auto : Auto-conducteur (10) + Auto-passager (11).
  - Marche : Marche (14), seule.
  - Actif : Vélo (13) + Marche (14).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import od_lib as lib

MODE_GROUPS = {
    "tc": {"20", "30"},
    "auto": {"10", "11"},
    "marche": {"14"},
    "actif": {"13", "14"},
}

LABELS = {
    "tc": "transport collectif (TC seul + TC et autre mode)",
    "auto": "auto (conducteur ou passager)",
    "marche": "marche exclusive",
    "actif": "transport actif (vélo + marche)",
}


def log(msg):
    lib.log("analyze_modes_secteurs", msg)


def build_mode_block(name, num23_data, total23, num18_data, total18, sector_names):
    num_pond_23, num_obs_23 = num23_data
    num_pond_18, num_obs_18 = num18_data
    total_pond_23, total_obs_23 = total23
    total_pond_18, total_obs_18 = total18

    agg23, tot_agg23 = lib.aggregate_to_boroughs(num_pond_23, total_pond_23)
    agg18, tot_agg18 = lib.aggregate_to_boroughs(num_pond_18, total_pond_18)

    rows = lib.borough_rows(agg23, tot_agg23, agg18, tot_agg18, "part_2023_pct", "part_2018_pct")

    top23 = lib.top_sector(num_pond_23, total_pond_23, num_obs_23, total_obs_23, sector_names)
    top18 = lib.top_sector(num_pond_18, total_pond_18, num_obs_18, total_obs_18, sector_names)

    return {
        "description": (
            f"Part modale de la catégorie « {LABELS[name]} » parmi tous les déplacements (24h, tous "
            "motifs) des résident·e·s de chaque arrondissement de Montréal, calculée à partir des "
            "matrices de déplacements par secteur de pondération (origine) de l'ARTM. 2018 et 2023 "
            "utilisent le même découpage de secteurs (SP23), ce qui rend la comparaison directement "
            "comparable d'une édition à l'autre."
        ),
        "methode": (
            f"Pour chaque arrondissement, somme pondérée (champ 'pond') des déplacements en mode "
            f"{LABELS[name]} ayant leur origine dans un des secteurs de l'arrondissement, divisée par "
            "la somme des déplacements tous modes ayant la même origine, toutes destinations "
            "confondues. Quelques secteurs chevauchent deux arrondissements (ex. 1098 Sud-Ouest/"
            "Ville-Marie) ; ils sont assignés une seule fois, à l'arrondissement principal cité dans "
            "leur description — voir SECTOR_TO_BOROUGH dans scripts/od_lib.py."
        ),
        "arrondissements": rows,
        "secteur_max": {
            "description": (
                "Secteur de pondération (intra-arrondissement, échelle plus fine que l'arrondissement) "
                f"avec la part « {LABELS[name]} » la plus élevée, parmi les secteurs ayant au moins "
                f"{lib.MIN_OBS_RELIABLE} observations brutes dans l'enquête (seuil de fiabilité utilisé "
                "par l'ARTM elle-même)."
            ),
            "2023": top23,
            "2018": top18,
        },
    }


def main():
    lib.DATA_DIR.mkdir(exist_ok=True)

    log("Downloading OD matrices (2023 and 2018)...")
    pm23_path, eod18_path = lib.ensure_matrices_cached()

    log("Reading sector name dictionary (2023 file)...")
    sector_names = lib.read_sector_names(pm23_path)

    log("Processing 2023 (Perspectives mobilité) — single pass for all mode groups...")
    groups23, total23 = lib.sums_by_sector_multi(pm23_path, MODE_GROUPS)

    log("Processing 2018 (enquête origine-destination) — single pass for all mode groups...")
    groups18, total18 = lib.sums_by_sector_multi(eod18_path, MODE_GROUPS)

    out = {
        "source_2023": "https://donnees.artm.quebec/catalogue/dataset/enquete-metropolitaine-2023-perspectives-mobilite",
        "source_2018": "https://donnees.artm.quebec/catalogue/dataset/enquete-origine-destination-2018",
    }
    for name in MODE_GROUPS:
        log(f"Building block: {name}...")
        out[name] = build_mode_block(name, groups23[name], total23, groups18[name], total18, sector_names)

    out_path = lib.DATA_DIR / "modes_secteurs.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    log(f"Wrote {out_path} ({out_path.stat().st_size:,} bytes)")

    for name in MODE_GROUPS:
        log(f"--- {name} ---")
        for r in sorted(out[name]["arrondissements"], key=lambda r: (r["part_2023_pct"] or -1), reverse=True)[:5]:
            log(f"  {r['arrondissement']:<45} 2018={r['part_2018_pct']}%  2023={r['part_2023_pct']}%")
        log(f"  top secteur 2023: {out[name]['secteur_max']['2023']}")


if __name__ == "__main__":
    main()
