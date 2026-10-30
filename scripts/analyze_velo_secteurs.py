#!/usr/bin/env python3
"""
Calcule la part modale du vélo par arrondissement de Montréal, 2018 vs 2023,
à partir des matrices de déplacements (OD) de l'ARTM — ainsi que le secteur
de pondération (intra-arrondissement) affichant la part vélo la plus élevée.

Voir scripts/od_lib.py pour la logique partagée avec
scripts/analyze_modes_secteurs.py (transport collectif, auto, marche, actif).

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
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import od_lib as lib

MODE_VELO = {"13"}


def log(msg):
    lib.log("analyze_velo_secteurs", msg)


def main():
    lib.DATA_DIR.mkdir(exist_ok=True)

    log("Downloading OD matrices (2023 and 2018)...")
    pm23_path, eod18_path = lib.ensure_matrices_cached()

    log("Reading sector name dictionary (2023 file)...")
    sector_names = lib.read_sector_names(pm23_path)

    log("Processing 2023 (Perspectives mobilité)...")
    groups23, (total_pond_23, total_obs_23) = lib.sums_by_sector_multi(pm23_path, {"velo": MODE_VELO})
    velo_pond_23, velo_obs_23 = groups23["velo"]

    log("Processing 2018 (enquête origine-destination)...")
    groups18, (total_pond_18, total_obs_18) = lib.sums_by_sector_multi(eod18_path, {"velo": MODE_VELO})
    velo_pond_18, velo_obs_18 = groups18["velo"]

    velo23, total23 = lib.aggregate_to_boroughs(velo_pond_23, total_pond_23)
    velo18, total18 = lib.aggregate_to_boroughs(velo_pond_18, total_pond_18)

    rows = lib.borough_rows(velo23, total23, velo18, total18, "part_velo_2023_pct", "part_velo_2018_pct")

    log("Finding the single highest-share sub-sector (2023 and 2018)...")

    def rekey(top):
        if top is None:
            return None
        top = dict(top)
        top["part_velo_pct"] = top.pop("part_pct")
        return top

    top23 = rekey(lib.top_sector(velo_pond_23, total_pond_23, velo_obs_23, total_obs_23, sector_names))
    top18 = rekey(lib.top_sector(velo_pond_18, total_pond_18, velo_obs_18, total_obs_18, sector_names))

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
            "scripts/od_lib.py."
        ),
        "arrondissements": rows,
        "secteur_max_velo": {
            "description": (
                f"Secteur de pondération (intra-arrondissement, échelle plus fine que l'arrondissement) "
                f"avec la part vélo la plus élevée, parmi les secteurs ayant au moins "
                f"{lib.MIN_OBS_RELIABLE} observations brutes dans l'enquête (seuil de fiabilité utilisé "
                f"par l'ARTM elle-même)."
            ),
            "2023": top23,
            "2018": top18,
        },
    }

    out_path = lib.DATA_DIR / "velo_secteurs.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    log(f"Wrote {out_path} ({out_path.stat().st_size:,} bytes)")

    for r in sorted(rows, key=lambda r: (r["part_velo_2023_pct"] or -1), reverse=True):
        log(f"  {r['arrondissement']:<45} 2018={r['part_velo_2018_pct']}%  2023={r['part_velo_2023_pct']}%")
    log(f"Top secteur 2023: {top23}")
    log(f"Top secteur 2018: {top18}")


if __name__ == "__main__":
    main()
