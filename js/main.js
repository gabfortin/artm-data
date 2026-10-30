"use strict";

/* ===========================================================================
   Utilitaires généraux
   =========================================================================== */

const fmtInt = new Intl.NumberFormat("fr-CA");
const fmtDec1 = new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const fmtMoney = new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" });

async function fetchJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function monthKey(annee, mois) {
  return `${annee}-${String(mois).padStart(2, "0")}`;
}

const narrowQuery = window.matchMedia("(max-width: 600px)");
function isNarrow() { return narrowQuery.matches; }

// Sur mobile, les noms d'arrondissements (ex. « Villeray–Saint-Michel–Parc-Extension »)
// sont coupés sur plusieurs lignes plutôt que tronqués par l'axe du graphique.
function boroughLabel(name, maxLen = 22) {
  if (!isNarrow()) return name;
  const parts = name.split(/(?<=–)|(?<= )/);
  const lines = [];
  for (const part of parts) {
    const last = lines[lines.length - 1];
    if (last != null && (last + part).length <= maxLen) lines[lines.length - 1] = last + part;
    else lines.push(part);
  }
  return lines.map((l) => l.trim());
}

/* ===========================================================================
   Thème clair/sombre — sélectionné, pas un simple miroir du système
   =========================================================================== */

const redrawCallbacks = [];
function registerRedraw(fn) { redrawCallbacks.push(fn); }

function initTheme() {
  const btn = document.getElementById("theme-toggle");
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch (e) { /* storage blocked — ignore */ }
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
  btn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) { /* ignore */ }
    for (const fn of redrawCallbacks) fn();
  });
  // Les étiquettes et graduations dépendent de la largeur : on redessine au
  // passage du seuil mobile (rotation d'un téléphone, redimensionnement).
  narrowQuery.addEventListener("change", () => { for (const fn of redrawCallbacks) fn(); });
}

/* ===========================================================================
   Tableaux accessibles (repli pour chaque graphique)
   =========================================================================== */

function renderTable(containerId, headers, rows) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = "";
  const table = el("table", { class: "data-table" });
  const thead = el("thead", {}, el("tr", {}, headers.map((h) => el("th", {}, h))));
  const tbody = el("tbody", {}, rows.map((r) => el("tr", {}, r.map((cell) => el("td", {}, String(cell))))));
  table.appendChild(thead);
  table.appendChild(tbody);
  wrap.appendChild(table);
}

function wireTableToggles() {
  document.querySelectorAll(".table-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.tableTarget);
      const open = target.classList.toggle("open");
      btn.textContent = open ? "Masquer les données" : "Voir les données en tableau";
    });
  });
}

/* ===========================================================================
   1) Parts modales
   =========================================================================== */

async function initPartsModales(d) {
  const rows = d.pointe_matin_territoire_artm;

  const labels = rows.map((r) => String(r.annee));
  const pct = (num, total) => (100 * num) / total;
  const series = {
    auto: rows.map((r) => pct(r.auto, r.deplacements_total)),
    tc: rows.map((r) => pct(r.tc, r.deplacements_total)),
    actif: rows.map((r) => pct(r.actif, r.deplacements_total)),
    scolaire: rows.map((r) => pct(r.scolaire, r.deplacements_total)),
    autre: rows.map((r) => pct(r.autre, r.deplacements_total)),
  };

  const ctx = document.getElementById("chart-parts-modales");
  let chart;
  const build = () => {
    if (chart) chart.destroy();
    const lineDataset = (label, data, colorVar) => ({
      label,
      data,
      borderColor: cssVar(colorVar),
      backgroundColor: cssVar(colorVar),
      borderWidth: 2,
      pointRadius: 4,
      pointHoverRadius: 6,
      tension: 0.15,
      fill: false,
    });
    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          lineDataset("Auto", series.auto, "--series-auto"),
          lineDataset("Transport collectif", series.tc, "--series-tc"),
          lineDataset("Actif (marche, vélo)", series.actif, "--series-actif"),
          lineDataset("Scolaire", series.scolaire, "--series-scolaire"),
          lineDataset("Autre", series.autre, "--series-autre"),
        ],
      },
      options: baseLineOptions({
        yTitle: "% des déplacements",
        beginAtZero: true,
        tooltipSuffix: " %",
        tooltipDecimals: 1,
      }),
    });
  };
  build();
  registerRedraw(build);

  const headers = ["Année", "Auto %", "TC %", "Actif %", "Scolaire %", "Autre %", "Déplacements (pointe AM)"];
  const tableRows = rows.map((r, i) => [
    r.annee,
    series.auto[i].toFixed(1),
    series.tc[i].toFixed(1),
    series.actif[i].toFixed(1),
    series.scolaire[i].toFixed(1),
    series.autre[i].toFixed(1),
    fmtInt.format(r.deplacements_total),
  ]);
  renderTable("table-parts-modales", headers, tableRows);

  const deltaStrip = document.getElementById("stat-parts-modales-delta");
  deltaStrip.innerHTML = "";
  const firstYear = labels[0], lastYear = labels[labels.length - 1];
  const modeDeltas = [
    ["Auto", series.auto, "--series-auto"],
    ["Transport collectif", series.tc, "--series-tc"],
    ["Actif (marche, vélo)", series.actif, "--series-actif"],
    ["Scolaire", series.scolaire, "--series-scolaire"],
    ["Autre", series.autre, "--series-autre"],
  ];
  for (const [label, arr, colorVar] of modeDeltas) {
    const delta = arr[arr.length - 1] - arr[0];
    deltaStrip.appendChild(el("div", { class: "stat", style: `border-left-color:${cssVar(colorVar)}` }, [
      el("div", { class: "stat-value" }, `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts`),
      el("div", { class: "stat-label" }, `${label} (${firstYear} → ${lastYear})`),
    ]));
  }

  // Trips vs distance (2023, 24h)
  const dTrips = d.parts_24h_par_nombre_deplacements["2023"];
  const dDist = d.parts_24h_par_distance_parcourue["2023"];
  const ctx2 = document.getElementById("chart-trips-vs-distance");
  let chart2;
  const build2 = () => {
    if (chart2) chart2.destroy();
    chart2 = new Chart(ctx2, {
      type: "bar",
      data: {
        labels: ["Déplacements", "Distance parcourue"],
        datasets: [
          { label: "Auto", data: [dTrips.auto, dDist.auto], backgroundColor: cssVar("--series-auto"), stack: "s" },
          { label: "Transport collectif", data: [dTrips.tc, dDist.tc], backgroundColor: cssVar("--series-tc"), stack: "s" },
          { label: "Actif", data: [dTrips.actif, dDist.actif], backgroundColor: cssVar("--series-actif"), stack: "s" },
          { label: "Scolaire", data: [dTrips.scolaire, dDist.scolaire], backgroundColor: cssVar("--series-scolaire"), stack: "s" },
          { label: "Autre", data: [dTrips.autre, dDist.autre], backgroundColor: cssVar("--series-autre"), stack: "s" },
        ],
      },
      options: baseBarOptions({ yTitle: "%", yMax: 100, stacked: true, tooltipSuffix: " %", indexAxis: "y" }),
    });
  };
  build2();
  registerRedraw(build2);

  // Faits saillants strip
  const fs = d.faits_saillants_2023;
  const strip = document.getElementById("faits-saillants-2023");
  strip.innerHTML = "";
  const items = [
    [fmtInt.format(fs.deplacements_24h_territoire_enquete), "déplacements / jour moyen de semaine (2023)"],
    [`${fs.variation_deplacements_24h_vs_2018_pct} %`, "variation du nombre total de déplacements depuis 2018"],
    [`${fs.teletravail_temps_plein_pct} %`, "des personnes à temps plein en télétravail le jour enquêté"],
    [`${fs.parc_automobile_croissance_saaq_2017_2022_pct} %`, "croissance du parc automobile, SAAQ 2017→2022"],
  ];
  for (const [value, label] of items) {
    strip.appendChild(el("div", { class: "stat" }, [
      el("div", { class: "stat-value" }, value),
      el("div", { class: "stat-label" }, label),
    ]));
  }
}

// Arrondissements centraux cités dans la lecture du graphique — c'est là que
// la progression du vélo est la plus forte depuis 2018.
const BOROUGHS_CENTRAUX = [
  "Le Plateau-Mont-Royal",
  "Rosemont–La Petite-Patrie",
  "Villeray–Saint-Michel–Parc-Extension",
  "Ville-Marie",
];

// Moyenne pondérée (par le volume réel de déplacements de chaque
// arrondissement, pas une simple moyenne des %) pour le sous-ensemble des
// arrondissements centraux — plus juste qu'une moyenne simple puisque les
// arrondissements n'ont pas tous le même poids démographique.
function computeCentralAggregate(rows, key18, key23) {
  const byName = new Map(rows.map((r) => [r.arrondissement, r]));
  let num18 = 0, tot18 = 0, num23 = 0, tot23 = 0;
  for (const name of BOROUGHS_CENTRAUX) {
    const r = byName.get(name);
    if (!r || r.deplacements_total_2018 == null || r.deplacements_total_2023 == null) continue;
    num18 += (r[key18] / 100) * r.deplacements_total_2018;
    tot18 += r.deplacements_total_2018;
    num23 += (r[key23] / 100) * r.deplacements_total_2023;
    tot23 += r.deplacements_total_2023;
  }
  const p18 = (100 * num18) / tot18;
  const p23 = (100 * num23) / tot23;
  return { p18, p23, ptsDelta: p23 - p18, relGrowthPct: (100 * (p23 - p18)) / p18 };
}

function computeVeloCentralAggregate(d) {
  return computeCentralAggregate(d.arrondissements, "part_velo_2018_pct", "part_velo_2023_pct");
}

function renderCentralAggregateStat(containerId, agg, modeLabel) {
  const stat = document.getElementById(containerId);
  if (!stat) return;
  stat.innerHTML = "";
  stat.appendChild(el("div", { class: "stat" }, [
    el("div", { class: "stat-value" }, `${agg.p18.toFixed(2)} % → ${agg.p23.toFixed(2)} %`),
    el("div", { class: "stat-label" }, `Moyenne pondérée, arrondissements centraux (Plateau, Rosemont–La Petite-Patrie, Villeray–Saint-Michel–Parc-Extension, Ville-Marie) — ${modeLabel}, 2018→2023`),
  ]));
  stat.appendChild(el("div", { class: "stat" }, [
    el("div", { class: "stat-value" }, `${agg.ptsDelta >= 0 ? "+" : ""}${agg.ptsDelta.toFixed(2)} pts`),
    el("div", { class: "stat-label" }, "points de pourcentage gagnés sur cette base"),
  ]));
  stat.appendChild(el("div", { class: "stat" }, [
    el("div", { class: "stat-value" }, `${agg.relGrowthPct >= 0 ? "+" : ""}${agg.relGrowthPct.toFixed(0)} %`),
    el("div", { class: "stat-label" }, "croissance relative"),
  ]));
}

async function initVeloSecteurs(d) {
  const agg = computeVeloCentralAggregate(d);

  const byName = new Map(d.arrondissements.map((r) => [r.arrondissement, r]));
  const plateau = byName.get("Le Plateau-Mont-Royal");
  const top23 = d.secteur_max_velo && d.secteur_max_velo["2023"];

  const highlights = document.getElementById("stat-velo-highlights");
  highlights.innerHTML = "";
  if (plateau && plateau.part_velo_2023_pct != null) {
    highlights.appendChild(el("div", { class: "stat" }, [
      el("div", { class: "stat-value" }, `${plateau.part_velo_2023_pct.toFixed(2)}\u00a0%`),
      el("div", { class: "stat-label" }, `Le Plateau-Mont-Royal, 2023 \u2014 la part v\u00e9lo y a presque doubl\u00e9 depuis 2018 (${plateau.part_velo_2018_pct.toFixed(2)}\u00a0%), pour approcher 15\u00a0% de tous les d\u00e9placements`),
    ]));
  }
  if (top23) {
    const shortName = (top23.nom_secteur || "").replace(/^Montr\u00e9al\s*:\s*/, "");
    highlights.appendChild(el("div", { class: "stat" }, [
      el("div", { class: "stat-value" }, `${top23.part_velo_pct.toFixed(2)}\u00a0%`),
      el("div", { class: "stat-label" }, `Secteur avec la part v\u00e9lo la plus \u00e9lev\u00e9e de Montr\u00e9al, 2023 \u2014 ${shortName} (${fmtInt.format(top23.observations_brutes)} observations, seuil de fiabilit\u00e9 ARTM largement d\u00e9pass\u00e9)`),
    ]));
  }

  const stat = document.getElementById("stat-velo-centraux");
  stat.innerHTML = "";
  stat.appendChild(el("div", { class: "stat" }, [
    el("div", { class: "stat-value" }, `+${agg.relGrowthPct.toFixed(0)} %`),
    el("div", { class: "stat-label" }, "croissance relative de la part vélo, 4 arrondissements centraux, 2018→2023"),
  ]));
  stat.appendChild(el("div", { class: "stat" }, [
    el("div", { class: "stat-value" }, `${agg.p18.toFixed(2)} % → ${agg.p23.toFixed(2)} %`),
    el("div", { class: "stat-label" }, "part vélo agrégée (pondérée par les déplacements), Plateau + Rosemont–La Petite-Patrie + Villeray–Saint-Michel–Parc-Extension + Ville-Marie"),
  ]));
  stat.appendChild(el("div", { class: "stat" }, [
    el("div", { class: "stat-value" }, `+${agg.ptsDelta.toFixed(2)} pts`),
    el("div", { class: "stat-label" }, "points de pourcentage gagnés sur la même base"),
  ]));

  const ctx = document.getElementById("chart-velo-secteurs");
  let chart;
  let lastRows = d.arrondissements;

  const renderRows = (rowsIn) => {
    lastRows = rowsIn;
    const rows = [...rowsIn].sort((a, b) => (b.part_velo_2023_pct ?? -1) - (a.part_velo_2023_pct ?? -1));
    const labels = rows.map((r) => boroughLabel(r.arrondissement));

    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "2018", data: rows.map((r) => r.part_velo_2018_pct), backgroundColor: cssVar("--series-autre") },
          { label: "2023", data: rows.map((r) => r.part_velo_2023_pct), backgroundColor: cssVar("--series-actif") },
        ],
      },
      options: baseBarOptions({ yTitle: "% des déplacements faits à vélo (24 h)", indexAxis: "y", tooltipSuffix: " %", tooltipDecimals: 2 }),
    });

    renderTable(
      "table-velo-secteurs",
      ["Arrondissement", "Part vélo 2018", "Part vélo 2023", "Variation (pts)"],
      rows.map((r) => [
        r.arrondissement,
        r.part_velo_2018_pct != null ? `${r.part_velo_2018_pct.toFixed(2)} %` : "—",
        r.part_velo_2023_pct != null ? `${r.part_velo_2023_pct.toFixed(2)} %` : "—",
        r.part_velo_2018_pct != null && r.part_velo_2023_pct != null
          ? `${(r.part_velo_2023_pct - r.part_velo_2018_pct >= 0 ? "+" : "")}${(r.part_velo_2023_pct - r.part_velo_2018_pct).toFixed(2)}`
          : "—",
      ])
    );
  };

  renderRows(d.arrondissements);
  registerRedraw(() => renderRows(lastRows));

  document.getElementById("toggle-central-velo").addEventListener("change", (e) => {
    renderRows(e.target.checked ? d.arrondissements.filter((r) => BOROUGHS_CENTRAUX.includes(r.arrondissement)) : d.arrondissements);
  });
}

// Rendu générique pour les cartes "part modale par arrondissement" (TC, auto,
// marche, actif) — même traitement que le vélo ci-dessus, sans dupliquer le
// code 4 fois. `block` est un des sous-objets de data/modes_secteurs.json
// (ex. d.tc, d.auto), avec la même forme que data/velo_secteurs.json.
function initModeSecteurs(key, block, { colorVar, unitLabel }) {
  const statTop = document.getElementById(`stat-${key}-top`);
  const top23 = block.secteur_max && block.secteur_max["2023"];
  statTop.innerHTML = "";
  if (top23) {
    const shortName = (top23.nom_secteur || "").replace(/^Montréal\s*:\s*/, "");
    statTop.appendChild(el("div", { class: "stat" }, [
      el("div", { class: "stat-value" }, `${top23.part_pct.toFixed(2)} %`),
      el("div", { class: "stat-label" }, `Secteur le plus élevé, 2023 — ${shortName} (${fmtInt.format(top23.observations_brutes)} observations)`),
    ]));
  }

  const centralAgg = computeCentralAggregate(block.arrondissements, "part_2018_pct", "part_2023_pct");
  renderCentralAggregateStat(`stat-${key}-centraux`, centralAgg, unitLabel);

  const ctx = document.getElementById(`chart-${key}-secteurs`);
  let chart;
  let lastRows = block.arrondissements;

  const renderRows = (rowsIn) => {
    lastRows = rowsIn;
    const rows = [...rowsIn].sort((a, b) => (b.part_2023_pct ?? -1) - (a.part_2023_pct ?? -1));
    const labels = rows.map((r) => boroughLabel(r.arrondissement));

    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "2018", data: rows.map((r) => r.part_2018_pct), backgroundColor: cssVar("--series-autre") },
          { label: "2023", data: rows.map((r) => r.part_2023_pct), backgroundColor: cssVar(colorVar) },
        ],
      },
      options: baseBarOptions({ yTitle: `% des déplacements — ${unitLabel} (24 h)`, indexAxis: "y", tooltipSuffix: " %", tooltipDecimals: 2 }),
    });

    renderTable(
      `table-${key}-secteurs`,
      ["Arrondissement", "Part 2018", "Part 2023", "Variation (pts)"],
      rows.map((r) => [
        r.arrondissement,
        r.part_2018_pct != null ? `${r.part_2018_pct.toFixed(2)} %` : "—",
        r.part_2023_pct != null ? `${r.part_2023_pct.toFixed(2)} %` : "—",
        r.part_2018_pct != null && r.part_2023_pct != null
          ? `${(r.part_2023_pct - r.part_2018_pct >= 0 ? "+" : "")}${(r.part_2023_pct - r.part_2018_pct).toFixed(2)}`
          : "—",
      ])
    );
  };

  renderRows(block.arrondissements);
  registerRedraw(() => renderRows(lastRows));

  document.getElementById(`toggle-central-${key}`).addEventListener("change", (e) => {
    renderRows(e.target.checked ? block.arrondissements.filter((r) => BOROUGHS_CENTRAUX.includes(r.arrondissement)) : block.arrondissements);
  });
}

/* ===========================================================================
   2) Achalandage (achalandage.json)
   =========================================================================== */

function totalByAgencyMonth(rows) {
  // STM publie Bus / Métro / Métro-Bus (total) — ne garder que le total pour
  // éviter de compter le bus et le métro deux fois. Les autres agences n'ont
  // pas de ligne de total séparée : leurs sous-catégories (détail) s'additionnent.
  const map = new Map(); // agence -> Map(monthKey -> value)
  for (const r of rows) {
    if (r.agence === "STM" && r.mode !== "Métro-Bus") continue;
    if (!map.has(r.agence)) map.set(r.agence, new Map());
    const m = map.get(r.agence);
    const k = monthKey(r.annee, r.mois);
    m.set(k, (m.get(k) || 0) + r.achalandage);
  }
  return map;
}

async function initAchalandage(achalandage, meta) {
  const rows = achalandage.rows;
  const byAgency = totalByAgencyMonth(rows);

  const updatedTag = document.getElementById("achalandage-updated");
  const src = meta.sources.find((s) => s.label === "achalandage-ARTM (régional)");
  if (src) updatedTag.innerHTML = `Source : ARTM, STM, RTL, STL, exo · rafraîchi le ${new Date(src.fetched_at).toLocaleDateString("fr-CA")}`;

  // --- regional monthly chart with 2019 reference line ---
  const regional = byAgency.get("ARTM (régional)");
  const months = [...regional.keys()].sort();
  const values = months.map((k) => regional.get(k));
  const avg2019 = (() => {
    const v2019 = months.filter((k) => k.startsWith("2019")).map((k) => regional.get(k));
    return v2019.reduce((a, b) => a + b, 0) / v2019.length;
  })();

  const ctxReg = document.getElementById("chart-achalandage-regional");
  let chartReg;
  const buildReg = () => {
    if (chartReg) chartReg.destroy();
    chartReg = new Chart(ctxReg, {
      type: "line",
      data: {
        labels: months,
        datasets: [
          {
            label: "Achalandage mensuel (ARTM, région)",
            data: values,
            borderColor: cssVar("--series-tc"),
            backgroundColor: cssVar("--series-tc"),
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.15,
            fill: false,
          },
          {
            label: "Moyenne mensuelle 2019 (référence pré-pandémie)",
            data: months.map(() => avg2019),
            borderColor: cssVar("--text-muted"),
            borderDash: [5, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: baseLineOptions({ yTitle: "Déplacements / mois", tooltipIsInt: true }),
    });
  };
  buildReg();
  registerRedraw(buildReg);

  renderTable("table-achalandage-regional", ["Mois", "Achalandage"], months.map((k, i) => [k, fmtInt.format(values[i])]));

  // --- by-operator multi-line chart ---
  const operatorOrder = ["STM", "RTL", "STL", "exo", "Navettes fluviales"];
  const operatorColors = ["--series-tc", "--series-auto", "--series-actif", "--series-scolaire", "--series-7"];
  const allMonths = [...new Set(rows.map((r) => monthKey(r.annee, r.mois)))].sort();

  const ctxOp = document.getElementById("chart-achalandage-operateurs");
  let chartOp;
  const buildOp = () => {
    if (chartOp) chartOp.destroy();
    chartOp = new Chart(ctxOp, {
      type: "line",
      data: {
        labels: allMonths,
        datasets: operatorOrder.map((agence, i) => ({
          label: agence,
          data: allMonths.map((k) => byAgency.get(agence)?.get(k) ?? null),
          borderColor: cssVar(operatorColors[i]),
          backgroundColor: cssVar(operatorColors[i]),
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.15,
          spanGaps: true,
        })),
      },
      options: baseLineOptions({ yTitle: "Déplacements / mois", tooltipIsInt: true }),
    });
  };
  buildOp();
  registerRedraw(buildOp);

  // --- recovery vs 2019 (indexed to 100) ---
  const recoveryAgencies = ["STM", "RTL", "STL", "exo"]; // navettes fluviales n'existaient pas en 2019
  const recoveryData = recoveryAgencies.map((agence) => {
    const m = byAgency.get(agence);
    if (!m) return null;
    const v2019 = allMonths.filter((k) => k.startsWith("2019")).map((k) => m.get(k)).filter((v) => v != null);
    const avg19 = v2019.reduce((a, b) => a + b, 0) / v2019.length;
    const years = [...new Set([...m.keys()].map((k) => k.slice(0, 4)))].sort();
    const lastFullYear = years.filter((y) => allMonths.filter((k) => k.startsWith(y) && m.has(k)).length === 12).pop();
    if (!lastFullYear) return null;
    const vLast = allMonths.filter((k) => k.startsWith(lastFullYear)).map((k) => m.get(k)).filter((v) => v != null);
    const avgLast = vLast.reduce((a, b) => a + b, 0) / vLast.length;
    return { agence, index: (100 * avgLast) / avg19, lastFullYear };
  }).filter(Boolean);

  const ctxRec = document.getElementById("chart-recovery");
  let chartRec;
  const buildRec = () => {
    if (chartRec) chartRec.destroy();
    chartRec = new Chart(ctxRec, {
      type: "bar",
      data: {
        labels: recoveryData.map((r) => `${r.agence} (${r.lastFullYear})`),
        datasets: [{
          label: "Indice (2019 = 100)",
          data: recoveryData.map((r) => r.index),
          backgroundColor: recoveryData.map((r) => (r.index >= 100 ? cssVar("--status-good") : cssVar("--series-auto"))),
          borderRadius: 4,
        }],
      },
      options: {
        ...baseBarOptions({ yTitle: "Indice (2019 = 100)", tooltipSuffix: "", tooltipDecimals: 0 }),
        plugins: { ...baseBarOptions({}).plugins, legend: { display: false } },
        scales: {
          x: baseBarOptions({}).scales.x,
          y: { ...baseBarOptions({}).scales.y, suggestedMin: 0 },
        },
      },
    });
  };
  buildRec();
  registerRedraw(buildRec);

  return { byAgency, allMonths, avg2019, regional, regionalValues: values, regionalMonths: months };
}

/* ===========================================================================
   2b) Réseau : métro STM (km réels, incidents), REM (GTFS), ventes de titres
   =========================================================================== */

const MOIS_COURTS = ["jan", "fév", "mars", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];
// Abréviation avec point seulement quand le mot est réellement abrégé (« sept. », mais « juin »).
function moisAbr(m) {
  const full = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"][m - 1];
  const abr = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."][m - 1];
  return abr.length < full.length ? abr : full;
}
const METRO_LINES = [
  ["Ligne verte", "Verte", "--line-verte"],
  ["Ligne orange", "Orange", "--line-orange"],
  ["Ligne jaune", "Jaune", "--line-jaune"],
  ["Ligne bleue", "Bleue", "--line-bleue"],
];
const CAUSE_LABELS = {
  "Méfait volontaire": "Méfait volontaire",
  "Blessée ou malade": "Personne blessée ou malade",
  "Service de la voie": "Voie (équipements fixes)",
  "Service aux trains": "Équipements de service aux trains",
  "Matériel roulant — MR-73": "Panne de train MR-73",
  "Matériel roulant — MPM-10": "Panne de train Azur",
};

// "2026-06" -> "2026 (jan–juin)" quand l'année n'est pas complète.
function partialYearLabel(year, lastMonth) {
  if (lastMonth.slice(0, 4) !== year || lastMonth.slice(5) === "12") return year;
  return `${year} (jan–${MOIS_COURTS[parseInt(lastMonth.slice(5), 10) - 1]})`;
}

function stat(value, label, colorVar) {
  return el("div", { class: "stat", style: colorVar ? `border-left-color:${cssVar(colorVar)}` : "" }, [
    el("div", { class: "stat-value" }, value),
    el("div", { class: "stat-label" }, label),
  ]);
}

function fillStrip(id, stats) {
  const strip = document.getElementById(id);
  strip.innerHTML = "";
  stats.filter(Boolean).forEach((s) => strip.appendChild(s));
}

function initReseau(metro, rem, ventes, meta) {
  const src = meta.sources.find((s) => s.label === "metro-km");
  if (src) document.getElementById("reseau-updated").textContent = `Sources : STM, REM, ARTM · rafraîchi le ${new Date(src.fetched_at).toLocaleDateString("fr-CA")}`;

  const months = Object.keys(metro.km_voiture_par_mois).sort();
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  const fullYears = years.filter((y) => months.filter((m) => m.startsWith(y)).length === 12);
  const lastFull = fullYears[fullYears.length - 1];
  const kmMonth = metro.km_voiture_par_mois;
  const kmLines = metro.km_voiture_par_ligne_annee;
  const kmMat = metro.km_voiture_par_materiel_annee;
  const M = (v) => v / 1e6;

  // --- bandeau de tête ---
  const ytd = metro.km_voiture_cumul_meme_periode;
  const curYear = metro.km_dernier_mois.slice(0, 4);
  const prevYear = String(parseInt(curYear, 10) - 1);
  const ytdDelta = (100 * (ytd.par_annee[curYear] - ytd.par_annee[prevYear])) / ytd.par_annee[prevYear];
  const totalLast = METRO_LINES.reduce((a, [k]) => a + kmLines[k][lastFull], 0);
  const orangeShare = (100 * kmLines["Ligne orange"][lastFull]) / totalLast;
  const topTrain = metro.train_azur_le_plus_roule[lastFull];
  fillStrip("stat-reseau-top", [
    stat(`${fmtDec1.format(M(totalLast))} M km`, `parcourus par les voitures de métro en ${lastFull} (${fmtInt.format(Math.round(totalLast / 9))} km-train)`, "--line-orange"),
    stat(`${ytdDelta >= 0 ? "+" : ""}${fmtDec1.format(ytdDelta)} %`, `km-voiture de janvier à ${moisAbr(parseInt(ytd.jusqu_au_mois, 10))} ${curYear} vs même période ${prevYear}`, "--line-verte"),
    topTrain && stat(`${fmtInt.format(topTrain.km_train)} km`, `roulés en ${lastFull} par le train Azur le plus sollicité (rame ${topTrain.composition.slice(0, 3)}), soit ${fmtDec1.format(topTrain.km_train / 40075)} fois le tour de la Terre`, "--line-bleue"),
    stat(`${fmtInt.format(metro.km_train_par_jour_semaine[lastFull])} km`, `parcourus chaque jour de semaine par l'ensemble des trains du métro (moyenne ${lastFull})`, "--line-jaune"),
  ]);

  // --- km par ligne et par année ---
  const ctxLines = document.getElementById("chart-metro-km-lignes");
  let chartLines;
  const buildLines = () => {
    if (chartLines) chartLines.destroy();
    chartLines = new Chart(ctxLines, {
      type: "bar",
      data: {
        labels: fullYears,
        datasets: METRO_LINES.map(([key, label, colorVar]) => ({
          label: `Ligne ${label.toLowerCase()}`,
          data: fullYears.map((y) => M(kmLines[key][y])),
          backgroundColor: cssVar(colorVar),
          stack: "s",
        })),
      },
      options: baseBarOptions({ yTitle: "Millions de km-voiture", stacked: true, tooltipSuffix: " M km", tooltipDecimals: 2 }),
    });
  };
  buildLines();
  registerRedraw(buildLines);
  renderTable(
    "table-metro-km-lignes",
    ["Année", ...METRO_LINES.map(([, l]) => l), "Total"],
    years.map((y) => {
      const vals = METRO_LINES.map(([k]) => kmLines[k][y] || 0);
      return [partialYearLabel(y, metro.km_dernier_mois), ...vals.map(fmtInt.format), fmtInt.format(vals.reduce((a, b) => a + b, 0))];
    })
  );

  // --- km par mois ---
  const recentMonths = months.filter((m) => m >= "2023-01");
  const ctxMonths = document.getElementById("chart-metro-km-mois");
  let chartMonths;
  const buildMonths = () => {
    if (chartMonths) chartMonths.destroy();
    chartMonths = new Chart(ctxMonths, {
      type: "line",
      data: {
        labels: recentMonths,
        datasets: [{
          label: "Km-voiture par jour (moyenne du mois)",
          // Ramené par jour pour neutraliser la longueur des mois (février).
          data: recentMonths.map((m) => kmMonth[m] / new Date(+m.slice(0, 4), +m.slice(5), 0).getDate() / 1000),
          borderColor: cssVar("--line-orange"),
          backgroundColor: cssVar("--line-orange"),
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.15,
        }],
      },
      options: {
        ...baseLineOptions({ yTitle: "Milliers de km-voiture / jour", tooltipSuffix: " k km", tooltipDecimals: 1 }),
        plugins: { ...baseLineOptions({}).plugins, legend: { display: false } },
      },
    });
  };
  buildMonths();
  registerRedraw(buildMonths);

  // --- MR-73 vs Azur ---
  const pannes = metro.pannes_materiel_roulant_par_million_km_voiture;
  const panneYears = Object.keys(pannes["MR-73"]).sort();
  const ctxPannes = document.getElementById("chart-metro-pannes");
  let chartPannes;
  const buildPannes = () => {
    if (chartPannes) chartPannes.destroy();
    const ds = (label, colorVar) => ({
      label,
      data: panneYears.map((y) => pannes[label][y]),
      borderColor: cssVar(colorVar),
      backgroundColor: cssVar(colorVar),
      borderWidth: 2,
      pointRadius: 3,
      tension: 0.15,
    });
    chartPannes = new Chart(ctxPannes, {
      type: "line",
      data: {
        labels: panneYears.map((y) => partialYearLabel(y, metro.incidents_dernier_mois)),
        datasets: [ds("MR-73", "--series-auto"), ds("Azur (MPM-10)", "--series-tc")],
      },
      options: baseLineOptions({ yTitle: "Pannes / million de km-voiture", beginAtZero: true, tooltipDecimals: 1 }),
    });
  };
  buildPannes();
  registerRedraw(buildPannes);

  const lastIncFull = panneYears.filter((y) => y < metro.incidents_dernier_mois.slice(0, 4) || metro.incidents_dernier_mois.endsWith("-12")).pop();
  const ratio = pannes["MR-73"][lastIncFull] / pannes["Azur (MPM-10)"][lastIncFull];
  const firstYear = fullYears[0];
  const mr73Share = (y) => (100 * kmMat["MR-73"][y]) / (kmMat["MR-73"][y] + kmMat["Azur (MPM-10)"][y]);
  fillStrip("stat-metro-materiel", [
    stat(`× ${fmtDec1.format(ratio)}`, `incidents de matériel roulant par km : un MR-73 en cause ${fmtDec1.format(ratio)} fois plus qu’un Azur (${lastIncFull})`, "--series-auto"),
    stat(`${Math.round(mr73Share(firstYear))} % → ${Math.round(mr73Share(lastFull))} %`, `part des km du métro roulés par des MR-73, ${firstYear} → ${lastFull} : les trains de 1976 sont relégués aux lignes bleue et jaune et à une partie de la verte`, "--series-auto"),
    stat(`${fmtDec1.format(M(kmMat["MR-73"][lastFull]))} M km`, `encore roulés par les MR-73 en ${lastFull} — environ ${fmtInt.format(Math.round(kmMat["MR-73"][lastFull] / 9 / 365))} km-train par jour`, "--series-autre"),
  ]);

  // --- incidents ≥ 5 min par ligne ---
  const incLong = metro.incidents_5min_plus_par_ligne;
  const incYears = Object.keys(metro.incidents_30min_plus).sort();
  const shownIncYears = incYears.filter((y) => y === "2019" || y >= "2022");
  const ctxInc = document.getElementById("chart-metro-incidents");
  let chartInc;
  const buildInc = () => {
    if (chartInc) chartInc.destroy();
    chartInc = new Chart(ctxInc, {
      type: "bar",
      data: {
        labels: shownIncYears.map((y) => (isNarrow() ? y : partialYearLabel(y, metro.incidents_dernier_mois))),
        datasets: METRO_LINES.map(([key, label, colorVar]) => ({
          label,
          data: shownIncYears.map((y) => incLong[key][y] ?? 0),
          backgroundColor: cssVar(colorVar),
        })),
      },
      options: baseBarOptions({ yTitle: "Incidents de 5 min et plus", tooltipDecimals: 0 }),
    });
  };
  buildInc();
  registerRedraw(buildInc);

  // --- causes ---
  const causes = metro.causes_5min_plus;
  const totalCauses = causes.rows.reduce((a, r) => a + r.n, 0);
  const topCauses = causes.rows.slice(0, 7);
  document.getElementById("caption-metro-causes").textContent =
    `Causes des ${fmtInt.format(totalCauses)} incidents de 5 minutes et plus survenus de ${causes.annees[0]} à ${causes.annees[causes.annees.length - 1]}, en % du total.`;
  const ctxCauses = document.getElementById("chart-metro-causes");
  let chartCauses;
  const buildCauses = () => {
    if (chartCauses) chartCauses.destroy();
    chartCauses = new Chart(ctxCauses, {
      type: "bar",
      data: {
        labels: topCauses.map((r) => {
          const label = CAUSE_LABELS[r.cause] || r.cause;
          return isNarrow() ? boroughLabel(label, 16) : label;
        }),
        datasets: [{
          label: "Part des incidents",
          data: topCauses.map((r) => (100 * r.n) / totalCauses),
          backgroundColor: topCauses.map((r) => cssVar(r.cause.startsWith("Matériel roulant") ? "--series-auto" : "--series-7")),
          borderRadius: 3,
        }],
      },
      options: {
        ...baseBarOptions({ indexAxis: "y", tooltipSuffix: " %", tooltipDecimals: 1 }),
        plugins: { ...baseBarOptions({}).plugins, legend: { display: false } },
      },
    });
  };
  buildCauses();
  registerRedraw(buildCauses);

  const mefait = causes.rows.find((r) => r.cause === "Méfait volontaire");
  fillStrip("stat-metro-incidents", [
    mefait && stat(`${Math.round((100 * mefait.n) / totalCauses)} %`, `des arrêts de 5 min et plus (${causes.annees[0]}–${causes.annees[causes.annees.length - 1]}) viennent d'un méfait volontaire — première cause, devant toutes les pannes techniques`, "--series-7"),
    stat(fmtInt.format(metro.incidents_30min_plus[lastIncFull]), `interruptions de 30 minutes et plus en ${lastIncFull} (${fmtInt.format(metro.incidents_30min_plus[String(parseInt(lastIncFull, 10) - 1)])} l'année précédente)`, "--series-8"),
    stat(fmtInt.format(metro.evacuations[lastIncFull]), `évacuations de train ou de station en ${lastIncFull}, soit environ ${Math.round(metro.evacuations[lastIncFull] / 52)} par semaine`, "--series-8"),
    stat(fmtInt.format(metro.urgences_metro[lastIncFull]), `déclenchements du bouton d'urgence métro en ${lastIncFull}`, "--series-autre"),
  ]);

  // --- REM ---
  const gtfsDate = rem.gtfs_debut ? `${rem.gtfs_debut.slice(0, 4)}-${rem.gtfs_debut.slice(4, 6)}-${rem.gtfs_debut.slice(6)}` : null;
  if (gtfsDate) document.getElementById("caption-rem").textContent =
    `Offre planifiée pour un jour de semaine type, calculée à partir du GTFS publié par le REM (horaire en vigueur depuis le ${gtfsDate}).`;
  const longest = [...rem.services].sort((a, b) => b.longueur_km - a.longueur_km)[0];
  fillStrip("stat-rem", [
    stat(fmtInt.format(rem.stations), "stations en service", "--series-actif"),
    stat(fmtInt.format(rem.departs_jour_semaine), "départs de train par jour de semaine", "--series-actif"),
    stat(`${fmtInt.format(rem.km_train_jour_semaine)} km`, "km-train planifiés par jour de semaine", "--series-actif"),
    longest && stat(`${fmtDec1.format(longest.longueur_km)} km`, `trajet le plus long sans correspondance : ${longest.nom.replace(/^A\d - /, "").replace(" / A1 - ", " ↔ ")}`, "--series-actif"),
  ]);
  const metroTrainKm = metro.km_train_par_jour_semaine[lastFull];
  document.getElementById("callout-rem").innerHTML =
    `<strong>Mise en perspective :</strong> l'ensemble du métro roule environ ${fmtInt.format(metroTrainKm)} km-train par jour de semaine (${lastFull}). ` +
    `Le REM en planifie déjà ${fmtInt.format(rem.km_train_jour_semaine)}, soit ${Math.round((100 * rem.km_train_jour_semaine) / metroTrainKm)} % du kilométrage-train du métro — ` +
    `avec des trains beaucoup plus courts (2 ou 4 voitures, contre 9 au métro). Le REM ne publie toujours pas son achalandage dans le catalogue ouvert : ` +
    `on connaît précisément l'offre, pas l'usage.`;

  // --- ventes de titres ---
  const vYears = Object.keys(ventes.quantite.Mensuel).sort();
  const vLast = vYears[vYears.length - 1];
  const vPrev = String(parseInt(vLast, 10) - 1);
  const [, mm, dd] = ventes.derniere_date.split("-");
  const periodLabel = `1er janv.–${parseInt(dd, 10)} ${moisAbr(parseInt(mm, 10))}`;
  document.getElementById("caption-ventes").textContent =
    `Ventes nettes de titres ARTM, en millions de titres, du 1er janvier au ${parseInt(dd, 10)} ${moisAbr(parseInt(mm, 10))} de chaque année (comparaison à période égale).`;
  const q = ventes.quantite;
  const pct = (a, b) => (100 * (a - b)) / b;
  const totalMontant = (y) => Object.values(ventes.montant).reduce((a, s) => a + (s[y] || 0), 0);
  const signed = (v) => `${v >= 0 ? "+" : ""}${Math.round(v)} %`;
  fillStrip("stat-ventes", [
    stat(signed(pct(q.Mensuel[vLast], q.Mensuel["2019"])), `passes mensuelles vendues, ${vLast} vs 2019 (${periodLabel})`, "--series-tc"),
    stat(signed(pct(q["Billet unitaire"][vLast], q["Billet unitaire"]["2019"])), `billets unitaires vendus, ${vLast} vs 2019`, "--series-auto"),
    stat(`${fmtInt.format(Math.round(totalMontant(vLast) / 1e6))} M$`, `de ventes nettes en ${vLast} (${periodLabel}), contre ${fmtInt.format(Math.round(totalMontant("2019") / 1e6))} M$ en 2019 — en dollars courants`, "--series-actif"),
  ]);
  const vTypes = ["Billet unitaire", "Mensuel", "Horaire/Journalier/Hebdo", "Multi-passages", "Abonnement"];
  const vShown = ["2019", vPrev, vLast];
  const vColors = ["--series-autre", "--series-7", "--series-tc"];
  const ctxVentes = document.getElementById("chart-ventes");
  let chartVentes;
  const buildVentes = () => {
    if (chartVentes) chartVentes.destroy();
    chartVentes = new Chart(ctxVentes, {
      type: "bar",
      data: {
        labels: vTypes.map((t) => (isNarrow() ? boroughLabel(t.replace(/\//g, " / "), 14) : t)),
        datasets: vShown.map((y, i) => ({ label: y, data: vTypes.map((t) => M(q[t][y] || 0)), backgroundColor: cssVar(vColors[i]) })),
      },
      options: baseBarOptions({ indexAxis: "y", yTitle: "Millions de titres vendus", tooltipSuffix: " M", tooltipDecimals: 2 }),
    });
  };
  buildVentes();
  registerRedraw(buildVentes);
  renderTable(
    "table-ventes",
    ["Type de titre", ...vYears],
    Object.keys(q).map((t) => [t, ...vYears.map((y) => fmtInt.format(q[t][y] || 0))])
  );
}

/* ===========================================================================
   2c) Vélo terrain : compteurs permanents (Ville de Montréal) + historique BIXI
   =========================================================================== */

const MOIS_LABELS = MOIS_COURTS.map((m) => m.charAt(0).toUpperCase() + m.slice(1));

function initCompteurs(d, meta) {
  const src = meta.sources.find((s) => s.label === "compteurs-velo");
  if (src) document.getElementById("velo-updated").textContent = `Sources : Ville de Montréal, BIXI · rafraîchi le ${new Date(src.fetched_at).toLocaleDateString("fr-CA")}`;

  const ref = d.annee_reference;
  const top = d.top_sites[0];
  const rec = d.record_jour;
  const [, rm, rd] = rec.date.split("-");
  fillStrip("stat-compteurs", [
    stat(fmtInt.format(top.moyenne_jour), `vélos par jour en moyenne en ${ref} au compteur le plus achalandé de Montréal : ${top.nom}`, "--series-actif"),
    stat(fmtInt.format(rec.passages), `vélos en une seule journée (${parseInt(rd, 10)} ${moisAbr(parseInt(rm, 10))} ${rec.date.slice(0, 4)}), au même compteur — le record de l'année`, "--series-actif"),
    stat(`${fmtDec1.format(d.part_hiver_pct)} %`, `des passages de l'année ont lieu de décembre à mars (${ref}) : le vélo d'hiver existe, mais reste marginal`, "--series-tc"),
  ]);

  document.getElementById("caption-compteurs-top").textContent =
    `Passages en ${ref} aux ${d.top_sites.length} compteurs les plus fréquentés, parmi les ${d.compteurs_actifs_reference} actifs toute l'année. Certains axes ont un compteur par sens.`;
  const ctxTop = document.getElementById("chart-compteurs-top");
  let chartTop;
  const buildTop = () => {
    if (chartTop) chartTop.destroy();
    chartTop = new Chart(ctxTop, {
      type: "bar",
      data: {
        labels: d.top_sites.map((s) => {
          if (!isNarrow()) return s.nom;
          const court = s.nom.replace(/ dir nord$/, " (N)").replace(/ dir sud$/, " (S)").replace(/ SB$/, " (S)").replace(/^Eco-Display - /, "");
          return boroughLabel(court, 20);
        }),
        datasets: [{
          label: "Passages par jour (moyenne)",
          data: d.top_sites.map((s) => s.moyenne_jour),
          backgroundColor: d.top_sites.map((s) => cssVar(s.nom.startsWith("REV") ? "--series-actif" : "--series-autre")),
          borderRadius: 3,
        }],
      },
      options: {
        ...baseBarOptions({ indexAxis: "y", yTitle: `Vélos par jour, moyenne ${ref}`, tooltipDecimals: 0 }),
        plugins: { ...baseBarOptions({}).plugins, legend: { display: false } },
      },
    });
  };
  buildTop();
  registerRedraw(buildTop);

  document.getElementById("caption-compteurs-saison").textContent =
    `Passages mensuels en ${ref}, somme des ${d.compteurs_actifs_reference} compteurs actifs toute l'année.`;
  const months = Object.keys(d.saisonnalite).sort();
  const ctxSaison = document.getElementById("chart-compteurs-saison");
  let chartSaison;
  const buildSaison = () => {
    if (chartSaison) chartSaison.destroy();
    chartSaison = new Chart(ctxSaison, {
      type: "bar",
      data: {
        labels: months.map((m) => MOIS_LABELS[parseInt(m, 10) - 1]),
        datasets: [{
          label: "Passages",
          data: months.map((m) => d.saisonnalite[m] / 1e6),
          backgroundColor: months.map((m) => cssVar(["12", "01", "02", "03"].includes(m) ? "--series-tc" : "--series-actif")),
          borderRadius: 3,
        }],
      },
      options: {
        ...baseBarOptions({ yTitle: "Millions de passages", tooltipSuffix: " M", tooltipDecimals: 2 }),
        plugins: { ...baseBarOptions({}).plugins, legend: { display: false } },
      },
    });
  };
  buildSaison();
  registerRedraw(buildSaison);

  // Comparaisons à compteurs identiques : on affiche chaque variation avec
  // le nombre de compteurs sur lequel elle repose, pour juger de sa solidité.
  const parts = d.comparaisons.filter((c) => c.variation_pct != null).map((c) => {
    const periode = c.mois[0] === 1 && c.mois[1] === 12 ? "année complète" : `janv.–${moisAbr(c.mois[1])}`;
    return `<strong>${c.variation_pct >= 0 ? "+" : ""}${fmtDec1.format(c.variation_pct)} %</strong> de ${c.de} à ${c.a} (${periode}, ${c.compteurs} compteurs)`;
  });
  document.getElementById("callout-compteurs").innerHTML =
    `<strong>Évolution à compteurs identiques :</strong> ${parts.join(" ; ")}. ` +
    `Seuls les compteurs ayant des données au moins 90 % des jours sur les deux périodes sont comparés, et ceux qui varient de plus de ` +
    `${d.seuil_exclusion_pct} % sont écartés (compteur déplacé, en panne ou piste réaménagée). Ces comptages restent très sensibles à la météo ` +
    `et aux chantiers : une baisse d'une année à l'autre ne signifie pas forcément moins de cyclistes dans toute la ville.`;
}

function initBixiHistorique(d) {
  const years = Object.keys(d.par_annee).sort();
  const lastYear = years[years.length - 1];
  const [dy, dm] = d.dernier_mois.split("-");
  const full = years.filter((y) => y !== dy || dm === "12");
  const ref = full[full.length - 1];
  const r = d.par_annee[ref];
  const cumul = d.cumul_meme_periode.par_annee;
  const prev = String(parseInt(dy, 10) - 1);
  const ytdDelta = cumul[prev] ? (100 * (cumul[dy] - cumul[prev])) / cumul[prev] : null;
  const vs2019 = d.par_annee["2019"] ? (100 * (r.trajets - d.par_annee["2019"].trajets)) / d.par_annee["2019"].trajets : null;

  document.getElementById("intro-bixi-hist").textContent =
    `Historique ouvert des déplacements BIXI (${years[0]}–${lastYear}, jusqu'en ${moisAbr(parseInt(dm, 10))} ${dy}), calculé par ce site trajet par trajet. Les distances sont mesurées en ligne droite entre stations : c'est un minimum, le trajet réel est plus long.`;
  const [, recM, recD] = r.jour_record.date.split("-");
  fillStrip("stat-bixi-hist", [
    stat(`${fmtDec1.format(r.trajets / 1e6)} M`, `trajets BIXI en ${ref}${vs2019 != null ? `, soit ${vs2019 >= 0 ? "+" : ""}${Math.round(vs2019)} % par rapport à 2019 (saison avril–octobre seulement à l\'époque)` : ""}`, "--series-actif"),
    ytdDelta != null && stat(`${ytdDelta >= 0 ? "+" : ""}${fmtDec1.format(ytdDelta)} %`, `trajets de janvier à ${moisAbr(parseInt(dm, 10))} ${dy} vs même période ${prev}`, "--series-actif"),
    stat(`${fmtDec1.format(r.km_vol_oiseau / 1e6)} M km`, `parcourus au minimum en ${ref} (ligne droite entre stations) — environ ${fmtInt.format(Math.round(r.km_vol_oiseau / 40075))} fois le tour de la Terre`, "--series-tc"),
    stat(`${r.duree_mediane_min} min`, `durée médiane d'un trajet en ${ref}`, "--series-tc"),
    stat(fmtInt.format(r.jour_record.trajets), `trajets le ${parseInt(recD, 10)} ${moisAbr(parseInt(recM, 10))} ${ref}, journée record de l'année (moyenne : ${fmtInt.format(r.moyenne_jour_semaine)} en semaine, ${fmtInt.format(r.moyenne_jour_fin_semaine)} la fin de semaine)`, "--series-scolaire"),
  ]);

  // --- trajets par mois, une ligne par année ---
  const colors = { "2019": "--series-autre", "2023": "--series-scolaire", "2024": "--series-7", "2025": "--series-actif", "2026": "--series-tc" };
  const ctxM = document.getElementById("chart-bixi-mois");
  let chartM;
  const buildM = () => {
    if (chartM) chartM.destroy();
    chartM = new Chart(ctxM, {
      type: "line",
      data: {
        labels: MOIS_LABELS,
        datasets: years.map((y) => ({
          label: y,
          data: MOIS_LABELS.map((_, i) => {
            const v = d.par_annee[y].par_mois[String(i + 1).padStart(2, "0")];
            return v != null ? v / 1e6 : null;
          }),
          borderColor: cssVar(colors[y] || "--series-8"),
          backgroundColor: cssVar(colors[y] || "--series-8"),
          borderWidth: y === lastYear ? 2.5 : 1.5,
          pointRadius: 2,
          tension: 0.2,
        })),
      },
      options: baseLineOptions({ yTitle: "Millions de trajets", beginAtZero: true, tooltipSuffix: " M", tooltipDecimals: 2 }),
    });
  };
  buildM();
  registerRedraw(buildM);
  renderTable(
    "table-bixi-mois",
    ["Mois", ...years],
    MOIS_LABELS.map((label, i) => [label, ...years.map((y) => {
      const v = d.par_annee[y].par_mois[String(i + 1).padStart(2, "0")];
      return v != null ? fmtInt.format(v) : "—";
    })])
  );

  // --- heures ---
  document.getElementById("caption-bixi-heures").textContent = `Part des trajets selon l'heure de départ, ${ref}. Deux pointes, comme le transport collectif — mais celle du soir domine.`;
  const totalH = r.par_heure.reduce((a, b) => a + b, 0);
  const ctxH = document.getElementById("chart-bixi-heures");
  let chartH;
  const buildH = () => {
    if (chartH) chartH.destroy();
    chartH = new Chart(ctxH, {
      type: "bar",
      data: {
        labels: r.par_heure.map((_, h) => `${h} h`),
        datasets: [{ label: "Part des trajets", data: r.par_heure.map((n) => (100 * n) / totalH), backgroundColor: cssVar("--series-actif"), borderRadius: 2 }],
      },
      options: {
        ...baseBarOptions({ yTitle: "% des trajets", tooltipSuffix: " %", tooltipDecimals: 1 }),
        plugins: { ...baseBarOptions({}).plugins, legend: { display: false } },
      },
    });
  };
  buildH();
  registerRedraw(buildH);

  // --- stations ---
  const st = r.top_stations_depart.slice(0, 8);
  document.getElementById("caption-bixi-stations").textContent = `Trajets au départ de chaque station, ${ref}.`;
  const ctxS = document.getElementById("chart-bixi-stations");
  let chartS;
  const buildS = () => {
    if (chartS) chartS.destroy();
    chartS = new Chart(ctxS, {
      type: "bar",
      data: {
        labels: st.map((s) => {
          const nom = isNarrow() ? s.nom.replace(/\s*\(.*\)$/, "") : s.nom;
          return isNarrow() ? boroughLabel(nom, 18) : nom;
        }),
        datasets: [{ label: "Trajets", data: st.map((s) => s.trajets), backgroundColor: cssVar("--series-actif"), borderRadius: 3 }],
      },
      options: {
        ...baseBarOptions({ indexAxis: "y", yTitle: "Trajets au départ", tooltipDecimals: 0 }),
        plugins: { ...baseBarOptions({}).plugins, legend: { display: false } },
      },
    });
  };
  buildS();
  registerRedraw(buildS);
}

function initCampus(d) {
  const e = d.etudiants, p = d.employes;
  document.getElementById("caption-campus").textContent =
    `Volet distinct de Perspectives mobilité, mené en ${d.periode_collecte} auprès des étudiant·e·s et employé·e·s de ${d.institutions.join(", ")} ` +
    `(${fmtInt.format(d.reponses_completes)} réponses complètes, résultats pondérés). Une journée de navettage typique, domicile → campus.`;
  fillStrip("stat-campus-etudiants", [
    stat(`${e.part_tc_pct} %`, "viennent principalement en transport collectif", "--series-tc"),
    stat(`${fmtDec1.format(e.jours_campus_par_semaine)} j`, "au campus par semaine, en moyenne", "--series-autre"),
    stat(`${fmtDec1.format(e.distance_mediane_km)} km`, "distance médiane domicile–campus (sur le réseau)", "--series-autre"),
  ]);
  fillStrip("stat-campus-employes", [
    stat(`${p.part_tc_pct} %`, `en transport collectif, et ${p.part_auto_pct} % en voiture`, "--series-tc"),
    stat(`${fmtDec1.format(p.jours_campus_par_semaine)} j`, `au campus par semaine ; ${p.temps_plein_jours_en_teletravail_pct} % des jours travaillés à temps plein le sont en télétravail`, "--series-autre"),
    stat(`${fmtDec1.format(p.distance_mediane_km)} km`, "distance médiane domicile–campus (sur le réseau)", "--series-autre"),
  ]);
  const c = d.conducteurs_ouverts_a_un_mode_durable;
  document.getElementById("callout-campus").innerHTML =
    `<strong>Auto solo :</strong> parmi les personnes qui vont au campus en voiture, ${fmtDec1.format(e.part_auto_solo_parmi_auto_pct)} % des étudiant·e·s ` +
    `et ${fmtDec1.format(p.part_auto_solo_parmi_auto_pct)} % des employé·e·s conduisent seul·e·s. Interrogé·e·s, environ ` +
    `<strong>${Math.round((100 * c.ouverts_ponderes) / c.conducteurs_ponderes)} %</strong> des conducteur·rice·s se disent prêt·e·s à envisager un mode durable. ` +
    `Source : <a href="${d.rapport_pdf}" target="_blank" rel="noopener">rapport global ARTM, juin 2026 (PDF)</a> — chiffres reportés à la main.`;
}

/* ===========================================================================
   3) Tarifs
   =========================================================================== */

async function initTarifs(meta) {
  const d = await fetchJSON("data/tarifs.json");
  const updatedTag = document.getElementById("tarifs-updated");
  const src = meta.sources.find((s) => s.label === "tarifs");
  if (src) updatedTag.textContent = `Source : ARTM · rafraîchi le ${new Date(src.fetched_at).toLocaleDateString("fr-CA")}`;

  const names = Object.keys(d.series);
  const allDates = [...new Set(names.flatMap((n) => d.series[n].map((p) => p.date)))].sort();
  const colors = ["--series-tc", "--series-auto", "--series-actif", "--series-scolaire"];

  const ctx = document.getElementById("chart-tarifs");
  let chart;
  const build = () => {
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: allDates,
        datasets: names.map((name, i) => {
          const byDate = new Map(d.series[name].map((p) => [p.date, p.montant]));
          // forward-fill so the line is continuous between price changes
          let last = null;
          const data = allDates.map((date) => {
            if (byDate.has(date)) last = byDate.get(date);
            return last;
          });
          return {
            label: name,
            data,
            borderColor: cssVar(colors[i % colors.length]),
            backgroundColor: cssVar(colors[i % colors.length]),
            borderWidth: 2,
            pointRadius: 0,
            stepped: "before",
          };
        }),
      },
      options: baseLineOptions({ yTitle: "Prix mensuel ($ courants)", tooltipPrefix: "$", tooltipDecimals: 2 }),
    });
  };
  build();
  registerRedraw(build);

  const headers = ["Date d'entrée en vigueur", ...names];
  const rows = allDates.map((date) => {
    const cells = names.map((name) => {
      const point = d.series[name].find((p) => p.date === date);
      return point ? fmtMoney.format(point.montant) : "—";
    });
    return [date, ...cells];
  });
  renderTable("table-tarifs", headers, rows);

  return d;
}

function renderParcAuto(partsModales, achalandageSummary) {
  const fs = partsModales.faits_saillants_2023;
  const container = document.getElementById("parc-auto-stats");
  container.innerHTML = "";

  let tcTrendCard;
  if (achalandageSummary) {
    const { regionalMonths, regionalValues } = achalandageSummary;
    const years = [...new Set(regionalMonths.map((m) => m.slice(0, 4)))];
    const fullYears = years.filter((y) => regionalMonths.filter((m) => m.startsWith(y)).length === 12);
    if (fullYears.length >= 2) {
      const first = fullYears[0], last = fullYears[fullYears.length - 1];
      const sum = (y) => regionalMonths.reduce((acc, m, i) => (m.startsWith(y) ? acc + regionalValues[i] : acc), 0);
      const pctChange = (100 * (sum(last) - sum(first))) / sum(first);
      tcTrendCard = el("div", { class: "card" }, [
        el("h3", {}, `Achalandage régional TC, ${first}→${last}`),
        el("div", { class: "stat" }, [
          el("div", { class: "stat-value" }, `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)} %`),
          el("div", { class: "stat-label" }, `déplacements annuels, total ARTM`),
        ]),
      ]);
    }
  }

  const cards = [
    el("div", { class: "card" }, [
      el("h3", {}, "Parc automobile"),
      el("div", { class: "stat" }, [
        el("div", { class: "stat-value" }, fmtInt.format(fs.parc_automobile_enquete_2023)),
        el("div", { class: "stat-label" }, "véhicules, territoire de l'enquête 2023 (ARTM)"),
      ]),
    ]),
    el("div", { class: "card" }, [
      el("h3", {}, "Croissance du parc, SAAQ"),
      el("div", { class: "stat" }, [
        el("div", { class: "stat-value" }, `+${fs.parc_automobile_croissance_saaq_2017_2022_pct} %`),
        el("div", { class: "stat-label" }, "nombre de véhicules immatriculés, 2017→2022"),
      ]),
    ]),
    tcTrendCard,
  ].filter(Boolean);
  cards.forEach((c) => container.appendChild(c));
}

/* ===========================================================================
   4) Infrastructures (mesures bus, REV, réseau cyclable Montréal)
   =========================================================================== */

async function initInfrastructure(meta, mesuresBus, rev) {
  const veloMtl = await fetchJSON("data/velo_mtl.json");

  const infraUpdated = document.getElementById("infra-updated");
  const src = meta.sources.find((s) => s.label === "mesures-bus");
  if (src) infraUpdated.textContent = `Rafraîchi le ${new Date(src.fetched_at).toLocaleDateString("fr-CA")}`;

  // mesures bus stat strip
  const statBus = document.getElementById("stat-mesures-bus");
  statBus.innerHTML = "";
  statBus.appendChild(el("div", { class: "stat" }, [
    el("div", { class: "stat-value" }, `${fmtDec1.format(mesuresBus.total_km)} km`),
    el("div", { class: "stat-label" }, "longueur totale, tous types"),
  ]));
  Object.entries(mesuresBus.par_type_km).slice(0, 3).forEach(([type, km]) => {
    statBus.appendChild(el("div", { class: "stat" }, [
      el("div", { class: "stat-value" }, `${fmtDec1.format(km)} km`),
      el("div", { class: "stat-label" }, type),
    ]));
  });

  // REV progress
  const pct = Math.min(100, (100 * rev.total_km_realise) / rev.cible_km);
  const revBox = document.getElementById("rev-progress");
  revBox.innerHTML = "";
  revBox.appendChild(el("div", { class: "stat" }, [
    el("div", { class: "stat-value" }, `${fmtDec1.format(rev.total_km_realise)} / ${rev.cible_km} km`),
    el("div", { class: "stat-label" }, `${pct.toFixed(0)} % de la cible du projet réalisée`),
  ]));
  const track = el("div", { class: "progress-track" }, el("div", { class: "progress-fill", style: `width:${pct}%` }));
  revBox.appendChild(track);

  // vélo Montréal stat strip
  const statVelo = document.getElementById("stat-velo-mtl");
  statVelo.innerHTML = "";
  statVelo.appendChild(el("div", { class: "stat" }, [
    el("div", { class: "stat-value" }, `${fmtDec1.format(veloMtl.total_km)} km`),
    el("div", { class: "stat-label" }, "réseau cyclable total"),
  ]));
  statVelo.appendChild(el("div", { class: "stat" }, [
    el("div", { class: "stat-value" }, `${fmtDec1.format(veloMtl.quatre_saisons_km)} km`),
    el("div", { class: "stat-label" }, "accessible 4 saisons"),
  ]));
  statVelo.appendChild(el("div", { class: "stat" }, [
    el("div", { class: "stat-value" }, `${fmtDec1.format(veloMtl.protege_4_saisons_km)} km`),
    el("div", { class: "stat-label" }, "protégé et 4 saisons"),
  ]));

  // cumulative bus lanes by year
  const entries = Object.entries(mesuresBus.cumul_par_annee_km)
    .filter(([y]) => y !== "inconnue")
    .map(([y, km]) => [parseInt(y, 10), km])
    .sort((a, b) => a[0] - b[0]);
  let running = 0;
  const cumLabels = entries.map(([y]) => String(y));
  const cumValues = entries.map(([, km]) => (running += km));

  const ctx = document.getElementById("chart-bus-lanes-cumul");
  let chart;
  const build = () => {
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: cumLabels,
        datasets: [{
          label: "Km cumulés de mesures préférentielles pour autobus",
          data: cumValues,
          borderColor: cssVar("--series-tc"),
          backgroundColor: cssVar("--series-tc"),
          borderWidth: 2,
          pointRadius: 2,
          fill: false,
          stepped: "before",
        }],
      },
      options: baseLineOptions({ yTitle: "Km cumulés", tooltipDecimals: 1 }),
    });
  };
  build();
  registerRedraw(build);
}

/* ===========================================================================
   5) Carte Leaflet
   =========================================================================== */

async function initMap() {
  const map = L.map("map", { scrollWheelZoom: false }).setView([45.55, -73.65], 10);
  // Tuiles OpenStreetMap standard — aucune clé requise, contrairement aux
  // tuiles CARTO (basemaps.cartocdn.com) qui exigent désormais un compte.
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  const typeColor = {
    "Voie réservée": cssVar("--series-tc"),
    "Service rapide par bus": cssVar("--series-7"),
    "Usage autorisé aux autobus": cssVar("--series-scolaire"),
    "Voie exclusive pour autobus": cssVar("--series-auto"),
    "Signal transport en commun": cssVar("--series-autre"),
  };
  const typeLabels = {
    VR: "Voie réservée", SRB: "Service rapide par bus", UAB: "Usage autorisé aux autobus",
    VEFA: "Voie exclusive pour autobus", STB: "Signal transport en commun",
  };

  const [mesuresBus, rev, terminus, stationnements, zones] = await Promise.all([
    fetchJSON("data/mesures_bus.geojson"),
    fetchJSON("data/rev.geojson"),
    fetchJSON("data/terminus.geojson"),
    fetchJSON("data/stationnements.geojson"),
    fetchJSON("data/zones_tarifaires.geojson"),
  ]);

  const busLayer = L.geoJSON(mesuresBus, {
    style: (f) => ({ color: typeColor[typeLabels[f.properties.type]] || cssVar("--series-autre"), weight: 3, opacity: 0.85 }),
    onEachFeature: (f, layer) => {
      const p = f.properties;
      layer.bindPopup(`<strong>${p.nom || "Mesure préférentielle"}</strong><br>${typeLabels[p.type] || p.type}<br>${fmtDec1.format(p.longueur_km)} km${p.annee ? ` · depuis ${p.annee}` : ""}`);
    },
  }).addTo(map);

  const revLayer = L.geoJSON(rev, {
    style: () => ({ color: cssVar("--series-actif"), weight: 4, opacity: 0.9 }),
    onEachFeature: (f, layer) => {
      const p = f.properties;
      layer.bindPopup(`<strong>REV — ${p.projet || ""}</strong><br>${p.arrondissement || ""}<br>${fmtDec1.format(p.longueur_km)} km`);
    },
  }).addTo(map);

  const dotIcon = (color) => L.divIcon({
    className: "", html: `<div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></div>`,
    iconSize: [12, 12], iconAnchor: [6, 6],
  });

  const terminusLayer = L.geoJSON(terminus, {
    pointToLayer: (f, latlng) => L.marker(latlng, { icon: dotIcon(cssVar("--series-tc")) }),
    onEachFeature: (f, layer) => layer.bindPopup(`<strong>${f.properties.a_groupnom}</strong><br>${f.properties.a_type}<br>Géré par ${f.properties.a_gestionn}`),
  }).addTo(map);

  const parkLayer = L.geoJSON(stationnements, {
    pointToLayer: (f, latlng) => L.marker(latlng, { icon: dotIcon(cssVar("--series-scolaire")) }),
    onEachFeature: (f, layer) => layer.bindPopup(`<strong>${f.properties.a_groupnom}</strong><br>Stationnement incitatif<br>Géré par ${f.properties.a_gestionn}`),
  }).addTo(map);

  const zoneColors = [cssVar("--series-tc"), cssVar("--series-actif"), cssVar("--series-scolaire"), cssVar("--series-auto"), cssVar("--series-7")];
  const zonesLayer = L.geoJSON(zones, {
    style: (f) => {
      const idx = ["A", "B", "C", "D"].indexOf((f.properties.a_zt || "").charAt(0)) % zoneColors.length;
      return { color: zoneColors[idx] || cssVar("--series-autre"), weight: 1, fillOpacity: 0.08 };
    },
    onEachFeature: (f, layer) => layer.bindPopup(`<strong>Zone ${f.properties.a_zt}</strong><br>${f.properties.a_nomzt || ""}`),
  });

  L.control.layers(null, {
    "Mesures préférentielles pour autobus": busLayer,
    "Réseau express vélo (REV)": revLayer,
    "Terminus métropolitains": terminusLayer,
    "Stationnements incitatifs": parkLayer,
    "Zones tarifaires": zonesLayer,
  }, { collapsed: isNarrow() }).addTo(map);

  const legend = document.getElementById("map-legend");
  legend.innerHTML = "";
  const legendItems = [
    [cssVar("--series-tc"), "Voie réservée / terminus"],
    [cssVar("--series-actif"), "REV"],
    [cssVar("--series-scolaire"), "Usage autorisé bus / stationnement incitatif"],
    [cssVar("--series-auto"), "Voie exclusive pour autobus"],
    [cssVar("--series-7"), "Service rapide par bus (SRB)"],
  ];
  legendItems.forEach(([color, label]) => {
    legend.appendChild(el("span", {}, [el("span", { class: "dot", style: `background:${color}` }), label]));
  });
}

/* ===========================================================================
   6) BIXI — flux GBFS en direct
   =========================================================================== */

async function initBixi() {
  const container = document.getElementById("bixi-stats");
  try {
    const feeds = await fetchJSON("https://gbfs.velobixi.com/gbfs/gbfs.json");
    const lang = feeds.data.fr || feeds.data.en || Object.values(feeds.data)[0];
    const feedUrl = (name) => lang.feeds.find((f) => f.name === name)?.url;

    const [info, status] = await Promise.all([
      fetchJSON(feedUrl("station_information")),
      fetchJSON(feedUrl("station_status")),
    ]);

    const statusById = new Map(status.data.stations.map((s) => [s.station_id, s]));
    const stations = info.data.stations;
    const active = stations.filter((s) => statusById.get(s.station_id)?.is_renting);
    const bikesAvail = status.data.stations.reduce((a, s) => a + (s.num_bikes_available || 0), 0);
    const docksAvail = status.data.stations.reduce((a, s) => a + (s.num_docks_available || 0), 0);
    const ebikesAvail = status.data.stations.reduce((a, s) => a + (s.num_ebikes_available || 0), 0);

    container.innerHTML = "";
    const cards = [
      [fmtInt.format(stations.length), "stations BIXI au total"],
      [fmtInt.format(active.length), "stations actives en ce moment"],
      [fmtInt.format(bikesAvail), "vélos disponibles en ce moment"],
      [fmtInt.format(ebikesAvail), "vélos électriques disponibles en ce moment"],
      [fmtInt.format(docksAvail), "places libres en ce moment"],
    ];
    cards.forEach(([value, label]) => {
      container.appendChild(el("div", { class: "card" }, [
        el("div", { class: "kpi-value" }, value),
        el("div", { class: "kpi-label" }, label),
      ]));
    });

    const updated = new Date(status.last_updated * 1000);
    document.getElementById("bixi-live-pill").innerHTML =
      `<span class="dotpulse"></span>lu à ${updated.toLocaleTimeString("fr-CA")}`;
  } catch (e) {
    container.innerHTML = "";
    container.appendChild(el("div", { class: "card" }, [
      el("h3", {}, "Flux BIXI indisponible"),
      el("p", { class: "chart-caption" }, "Le flux GBFS public de BIXI n'a pas pu être lu depuis votre navigateur en ce moment. Réessayez plus tard."),
    ]));
    document.getElementById("bixi-live-pill").style.display = "none";
    console.warn("BIXI GBFS fetch failed:", e);
  }
}

/* ===========================================================================
   7) Méthodologie / sources + hero KPIs + meta
   =========================================================================== */

function renderSources(meta) {
  const list = document.getElementById("source-list");
  list.innerHTML = "";
  const seen = new Set();
  for (const s of meta.sources) {
    if (seen.has(s.dataset)) continue;
    seen.add(s.dataset);
    list.appendChild(el("div", { class: "src-item" }, [
      el("span", { class: "src-name" }, el("a", { href: s.url, target: "_blank", rel: "noopener" }, s.dataset)),
      el("span", { class: "src-meta" }, `rafraîchi le ${new Date(s.fetched_at).toLocaleString("fr-CA")}`),
    ]));
  }
  document.getElementById("meta-updated-at").textContent = new Date(meta.updated_at).toLocaleString("fr-CA");
}

function renderHeroKPIs(achalandageSummary, mesuresBusTotal, revTotal, veloCentralAgg) {
  const grid = document.getElementById("kpi-grid");
  grid.innerHTML = "";
  const { regionalMonths, regionalValues, regional } = achalandageSummary;
  const lastIdx = regionalValues.length - 1;
  const lastMonth = regionalMonths[lastIdx];
  const lastValue = regionalValues[lastIdx];
  // Comparer au même mois civil de 2019 (et non à la moyenne annuelle 2019)
  // pour ne pas comparer un mois potentiellement plus creux (ex. août) à une
  // moyenne qui inclut des mois plus achalandés (ex. septembre-octobre).
  const sameMonth2019Key = `2019-${lastMonth.slice(5)}`;
  const sameMonth2019Value = regional.get(sameMonth2019Key);
  const deltaYoY = sameMonth2019Value != null ? (100 * (lastValue - sameMonth2019Value)) / sameMonth2019Value : null;

  const cards = [
    {
      value: fmtInt.format(lastValue),
      delta: deltaYoY != null ? `${deltaYoY >= 0 ? "+" : ""}${deltaYoY.toFixed(0)} % vs ${sameMonth2019Key} (même mois, 2019)` : null,
      up: deltaYoY != null && deltaYoY >= 0,
      label: `Déplacements TC, région ARTM — ${lastMonth}`,
    },
    {
      value: `${fmtDec1.format(mesuresBusTotal)} km`,
      label: "de voies/mesures préférentielles pour autobus, territoire ARTM",
    },
    {
      value: `${fmtDec1.format(revTotal)} / 184 km`,
      label: "Réseau express vélo réalisé (Montréal)",
    },
    {
      value: `+${veloCentralAgg.relGrowthPct.toFixed(0)} %`,
      label: "part vélo, 4 arrondissements centraux de Montréal, 2018→2023 (Plateau, Rosemont–La Petite-Patrie, Villeray–Saint-Michel–Parc-Extension, Ville-Marie)",
    },
  ];

  cards.forEach((c) => {
    grid.appendChild(el("div", { class: "kpi-card" }, [
      el("div", { class: "kpi-value" }, [
        c.value,
        c.delta ? el("span", { class: `kpi-delta ${c.up ? "up" : "down"}` }, c.delta) : null,
      ]),
      el("div", { class: "kpi-label" }, c.label),
    ]));
  });
}

/* ===========================================================================
   Chart.js option builders (styles alignés sur la palette du site)
   =========================================================================== */

function baseLineOptions({ yTitle, yMax, beginAtZero, tooltipIsInt, tooltipPrefix = "", tooltipSuffix = "", tooltipDecimals = 0 } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "bottom", labels: { color: cssVar("--text-secondary"), boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11.5 } } },
      tooltip: {
        backgroundColor: cssVar("--surface-1"),
        titleColor: cssVar("--text-primary"),
        bodyColor: cssVar("--text-secondary"),
        borderColor: cssVar("--border-strong"),
        borderWidth: 1,
        padding: 10,
        callbacks: tooltipIsInt ? { label: (c) => `${c.dataset.label}: ${fmtInt.format(c.parsed.y)}` } :
          { label: (c) => `${c.dataset.label}: ${tooltipPrefix}${c.parsed.y.toFixed(tooltipDecimals)}${tooltipSuffix}` },
      },
    },
    scales: {
      x: { ticks: { color: cssVar("--text-muted"), maxRotation: 0, autoSkip: true, autoSkipPadding: 12, maxTicksLimit: isNarrow() ? 5 : undefined, font: { size: 11 } }, grid: { display: false }, border: { color: cssVar("--baseline") } },
      y: { max: yMax, beginAtZero: !!beginAtZero, title: { display: !!yTitle, text: yTitle, color: cssVar("--text-muted"), font: { size: 11.5 } }, ticks: { color: cssVar("--text-muted"), font: { size: 11 } }, grid: { color: cssVar("--gridline") }, border: { display: false } },
    },
  };
}

function baseBarOptions({ yTitle, yMax, stacked, tooltipSuffix = "", tooltipDecimals = 0, indexAxis = "x" } = {}) {
  // When indexAxis is "y" (horizontal bars), the *value* scale is "x" and the
  // category scale is "y" — yTitle/yMax/stacked must follow the value scale,
  // not the literal "y" key, or they silently apply to the wrong axis.
  const valueKey = indexAxis === "y" ? "x" : "y";
  const categoryKey = indexAxis === "y" ? "y" : "x";
  return {
    indexAxis,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom", labels: { color: cssVar("--text-secondary"), boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11.5 } } },
      tooltip: {
        backgroundColor: cssVar("--surface-1"),
        titleColor: cssVar("--text-primary"),
        bodyColor: cssVar("--text-secondary"),
        borderColor: cssVar("--border-strong"),
        borderWidth: 1,
        padding: 10,
        callbacks: {
          label: (c) => {
            const v = c.chart.options.indexAxis === "y" ? c.parsed.x : c.parsed.y;
            return `${c.dataset.label}: ${v.toFixed(tooltipDecimals)}${tooltipSuffix}`;
          },
        },
      },
    },
    scales: {
      [categoryKey]: { stacked: !!stacked, ticks: { color: cssVar("--text-muted"), autoSkip: indexAxis !== "y", font: { size: isNarrow() ? 10 : 11 } }, grid: { display: false }, border: { color: cssVar("--baseline") } },
      [valueKey]: { stacked: !!stacked, max: yMax, title: { display: !!yTitle, text: yTitle, color: cssVar("--text-muted"), font: { size: 11.5 } }, ticks: { color: cssVar("--text-muted"), font: { size: 11 } }, grid: { color: cssVar("--gridline") }, border: { display: false } },
    },
  };
}

/* ===========================================================================
   Boot
   =========================================================================== */

async function boot() {
  initTheme();
  wireTableToggles();

  const meta = await fetchJSON("data/meta.json");
  renderSources(meta);

  const [partsModales, achalandage, veloSecteurs, modesSecteurs] = await Promise.all([
    fetchJSON("data/parts_modales.json"),
    fetchJSON("data/achalandage.json"),
    fetchJSON("data/velo_secteurs.json"),
    fetchJSON("data/modes_secteurs.json"),
  ]);

  await initPartsModales(partsModales);
  await initVeloSecteurs(veloSecteurs);
  initModeSecteurs("tc", modesSecteurs.tc, { colorVar: "--series-tc", unitLabel: "transport collectif" });
  initModeSecteurs("auto", modesSecteurs.auto, { colorVar: "--series-auto", unitLabel: "auto" });
  initModeSecteurs("marche", modesSecteurs.marche, { colorVar: "--series-5", unitLabel: "marche" });
  initModeSecteurs("actif", modesSecteurs.actif, { colorVar: "--series-actif", unitLabel: "transport actif" });
  const achalandageSummary = await initAchalandage(achalandage, meta);
  try {
    const [metro, rem, ventes] = await Promise.all([
      fetchJSON("data/metro_stm.json"),
      fetchJSON("data/rem.json"),
      fetchJSON("data/ventes_titres.json"),
    ]);
    initReseau(metro, rem, ventes, meta);
  } catch (e) {
    // Section facultative : une source manquante ne doit pas bloquer le reste du tableau de bord.
    console.warn("Section réseau indisponible:", e);
  }
  // Sections facultatives, chacune indépendante : une source manquante ne bloque pas les autres.
  const optional = [
    ["data/enseignement_superieur_2025.json", initCampus],
    ["data/compteurs_velo.json", (d) => initCompteurs(d, meta)],
    ["data/bixi_historique.json", initBixiHistorique],
  ];
  await Promise.all(optional.map(([path, fn]) =>
    fetchJSON(path).then(fn).catch((e) => console.warn(`${path} indisponible:`, e))));
  await initTarifs(meta);
  renderParcAuto(partsModales, achalandageSummary);

  const [mesuresBus, rev] = await Promise.all([fetchJSON("data/mesures_bus.json"), fetchJSON("data/rev.json")]);
  const veloCentralAgg = computeVeloCentralAggregate(veloSecteurs);
  renderHeroKPIs(achalandageSummary, mesuresBus.total_km, rev.total_km_realise, veloCentralAgg);

  await initInfrastructure(meta, mesuresBus, rev);
  initMap();
  initBixi();
}

document.addEventListener("DOMContentLoaded", () => {
  boot().catch((err) => {
    console.error("Erreur au chargement du tableau de bord:", err);
    const grid = document.getElementById("kpi-grid");
    if (grid) grid.innerHTML = '<div class="kpi-card"><div class="kpi-label">Une erreur est survenue pendant le chargement des données. Voir la console pour le détail.</div></div>';
  });
});
