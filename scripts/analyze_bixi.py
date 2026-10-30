#!/usr/bin/env python3
"""
Statistiques détaillées des déplacements BIXI (historique ouvert publié par
BIXI Montréal) : nombre de trajets par mois, durée médiane, distance à vol
d'oiseau, heures de pointe, stations et arrondissements les plus actifs.

Comme scripts/analyze_velo_secteurs.py, ce script N'EST PAS exécuté chaque
semaine : les archives annuelles pèsent 300 à 500 Mo compressées (près de
3 Go de CSV pour 2025) et BIXI ne les publie que quelques fois par année.
On le relance à la main quand une nouvelle archive paraît :

    python3 scripts/analyze_bixi.py

Les archives sont mises en cache dans .scratch_bixi/ (ignoré par git) et lues
en flux, sans jamais charger un CSV complet en mémoire. Stdlib uniquement.

Source : https://bixi.com/fr/donnees-ouvertes/ (référencé dans le catalogue
ARTM : https://donnees.artm.quebec/catalogue/dataset/bixi-historique-des-deplacements)
"""
import csv
import io
import json
import math
import re
import shutil
import sys
import urllib.request
import zipfile
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CACHE = ROOT / ".scratch_bixi"
UA = "ARTM-Mobility-Dashboard/1.0 (open data research; contact: gabriel.fortin97@gmail.com)"
PAGE = "https://bixi.com/fr/donnees-ouvertes/"
TZ = ZoneInfo("America/Montreal")

# 2019 sert de référence pré-pandémie ; le détail fin (arrondissements,
# distances fiables) n'existe que dans le nouveau format, depuis 2023.
YEARS = ["2019", "2023", "2024", "2025", "2026"]
MAX_MIN = 180  # histogramme des durées, au pas d'une minute


def log(msg):
    print(f"[analyze_bixi] {msg}", flush=True)


def http(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=300)


def archive_urls():
    html = http(PAGE).read().decode("utf-8", "replace")
    urls = {}
    for url in sorted(set(re.findall(r"https?://[^\"' ]+\.zip", html))):
        m = re.search(r"(?:BIXI-|Ouvertes?)(\d{4})", url)
        if m and m.group(1) in YEARS:
            urls[m.group(1)] = url  # le tri garde la publication la plus récente pour l'année
    return urls


def ensure_cached(url):
    CACHE.mkdir(exist_ok=True)
    dest = CACHE / url.rsplit("/", 1)[1]
    if not dest.exists():
        log(f"  downloading {url}")
        tmp = dest.with_suffix(".part")
        with http(url) as resp, open(tmp, "wb") as f:
            shutil.copyfileobj(resp, f, 1 << 20)
        tmp.rename(dest)
    return dest


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1.0, math.sqrt(a)))


class Acc:
    def __init__(self):
        self.trajets = 0
        self.sans_fin = 0
        self.par_mois = {}
        self.par_heure = [0] * 24
        self.jours = {}            # date -> trajets
        self.durees = [0] * (MAX_MIN + 1)
        self.km = 0.0
        self.boucles = 0
        self.stations = {}
        self.arrondissements = {}
        self.membres = None

    def add(self, start, end, depart=None, arrivee=None, arr=None, coords=None):
        self.trajets += 1
        mois = start.strftime("%m")
        self.par_mois[mois] = self.par_mois.get(mois, 0) + 1
        self.par_heure[start.hour] += 1
        d = start.date().isoformat()
        self.jours[d] = self.jours.get(d, 0) + 1
        minutes = int((end - start).total_seconds() // 60)
        self.durees[max(0, min(MAX_MIN, minutes))] += 1
        if depart:
            self.stations[depart] = self.stations.get(depart, 0) + 1
            if depart == arrivee:
                self.boucles += 1
        if arr:
            self.arrondissements[arr] = self.arrondissements.get(arr, 0) + 1
        # Quelques lignes ont des coordonnées nulles ou aberrantes (stations
        # temporaires, ateliers) : on ignore tout ce qui sort de la région ou
        # donne une distance impossible pour un trajet BIXI.
        if coords and all(45.0 < la < 46.0 and -74.5 < lo < -73.0 for la, lo in (coords[:2], coords[2:])):
            km = haversine_km(*coords)
            if km < 40:
                self.km += km

    def result(self):
        cum, mediane = 0, None
        for m, n in enumerate(self.durees):
            cum += n
            if cum >= self.trajets / 2:
                mediane = m
                break
        jour_max = max(self.jours.items(), key=lambda kv: kv[1]) if self.jours else (None, 0)
        sem = [n for d, n in self.jours.items() if datetime.fromisoformat(d).weekday() < 5]
        we = [n for d, n in self.jours.items() if datetime.fromisoformat(d).weekday() >= 5]
        top = lambda d, k: [{"nom": n, "trajets": v} for n, v in sorted(d.items(), key=lambda kv: -kv[1])[:k]]
        out = {
            "trajets": self.trajets,
            "trajets_sans_station_arrivee": self.sans_fin,
            "par_mois": dict(sorted(self.par_mois.items())),
            "par_heure": self.par_heure,
            "duree_mediane_min": mediane,
            "km_vol_oiseau": round(self.km),
            "part_boucles_pct": round(100 * self.boucles / self.trajets, 1) if self.stations else None,
            "jour_record": {"date": jour_max[0], "trajets": jour_max[1]},
            "moyenne_jour_semaine": round(sum(sem) / len(sem)) if sem else None,
            "moyenne_jour_fin_semaine": round(sum(we) / len(we)) if we else None,
            "top_stations_depart": top(self.stations, 10),
            "top_arrondissements_depart": top(self.arrondissements, 10),
        }
        if self.membres is not None:
            out["part_membres_pct"] = round(100 * self.membres / self.trajets, 1)
        return out


def process_2019(path):
    acc = Acc()
    acc.membres = 0
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        stations = {}
        for r in csv.DictReader(io.TextIOWrapper(zf.open(next(n for n in names if "Stations" in n)), "utf-8-sig")):
            stations[r.get("code") or r["Code"]] = (r["name"], float(r["latitude"]), float(r["longitude"]))
        for name in sorted(n for n in names if n.startswith("OD_")):
            for r in csv.DictReader(io.TextIOWrapper(zf.open(name), "utf-8-sig")):
                s, e = stations.get(r["start_station_code"]), stations.get(r["end_station_code"])
                start = datetime.fromisoformat(r["start_date"])
                end = datetime.fromisoformat(r["end_date"])
                acc.add(start, end, s and s[0], e and e[0],
                        coords=(s[1], s[2], e[1], e[2]) if s and e else None)
                acc.membres += r["is_member"] == "1"
    return acc.result()


def process_new(path):
    acc = Acc()
    with zipfile.ZipFile(path) as zf:
        name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        for r in csv.DictReader(io.TextIOWrapper(zf.open(name), "utf-8-sig")):
            if not r["STARTTIMEMS"]:
                continue
            if not r["ENDTIMEMS"] or not r["ENDSTATIONNAME"]:
                acc.sans_fin += 1
                continue
            start = datetime.fromtimestamp(int(r["STARTTIMEMS"]) / 1000, timezone.utc).astimezone(TZ)
            end = datetime.fromtimestamp(int(r["ENDTIMEMS"]) / 1000, timezone.utc).astimezone(TZ)
            try:
                coords = (float(r["STARTSTATIONLATITUDE"]), float(r["STARTSTATIONLONGITUDE"]),
                          float(r["ENDSTATIONLATITUDE"]), float(r["ENDSTATIONLONGITUDE"]))
            except ValueError:
                coords = None
            acc.add(start, end, r["STARTSTATIONNAME"], r["ENDSTATIONNAME"], r["STARTSTATIONARRONDISSEMENT"] or None, coords)
    return acc.result()


def process(item):
    year, path = item
    log(f"Processing {year} ({path.name})...")
    res = process_2019(path) if year == "2019" else process_new(path)
    log(f"  {year}: {res['trajets']:,} trajets")
    return year, res


def main():
    DATA_DIR.mkdir(exist_ok=True)
    log("Listing archives on bixi.com...")
    urls = archive_urls()
    missing = [y for y in YEARS if y not in urls]
    if missing:
        log(f"  no archive found for {missing}")
    items = [(y, ensure_cached(urls[y])) for y in YEARS if y in urls]
    with ProcessPoolExecutor() as pool:
        par_annee = dict(pool.map(process, items))

    # Dernier mois couvert par l'année la plus récente, pour comparer à période égale.
    last_year = max(par_annee)
    last_month = max(par_annee[last_year]["par_mois"])
    out = {
        "description": "Déplacements BIXI par année, calculés depuis l'historique ouvert de BIXI Montréal. "
                       "Distance = ligne droite entre stations de départ et d'arrivée (minimum réel).",
        "source": PAGE,
        "archives": {y: urls[y] for y, _ in items},
        "dernier_mois": f"{last_year}-{last_month}",
        "cumul_meme_periode": {
            "jusqu_au_mois": last_month,
            "par_annee": {y: sum(n for m, n in r["par_mois"].items() if m <= last_month) for y, r in par_annee.items()},
        },
        "par_annee": par_annee,
    }
    path = DATA_DIR / "bixi_historique.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    log(f"Wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
