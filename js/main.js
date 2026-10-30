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
        labels: ["Part des déplacements", "Part des distances parcourues"],
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

function computeVeloCentralAggregate(d) {
  const byName = new Map(d.arrondissements.map((r) => [r.arrondissement, r]));
  let velo18 = 0, tot18 = 0, velo23 = 0, tot23 = 0;
  for (const name of BOROUGHS_CENTRAUX) {
    const r = byName.get(name);
    if (!r || r.deplacements_total_2018 == null || r.deplacements_total_2023 == null) continue;
    velo18 += (r.part_velo_2018_pct / 100) * r.deplacements_total_2018;
    tot18 += r.deplacements_total_2018;
    velo23 += (r.part_velo_2023_pct / 100) * r.deplacements_total_2023;
    tot23 += r.deplacements_total_2023;
  }
  const p18 = (100 * velo18) / tot18;
  const p23 = (100 * velo23) / tot23;
  return { p18, p23, ptsDelta: p23 - p18, relGrowthPct: (100 * (p23 - p18)) / p18 };
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

  const rows = [...d.arrondissements].sort(
    (a, b) => (b.part_velo_2023_pct ?? -1) - (a.part_velo_2023_pct ?? -1)
  );
  const labels = rows.map((r) => r.arrondissement);

  const ctx = document.getElementById("chart-velo-secteurs");
  let chart;
  const build = () => {
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
  };
  build();
  registerRedraw(build);

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

  const rows = [...block.arrondissements].sort(
    (a, b) => (b.part_2023_pct ?? -1) - (a.part_2023_pct ?? -1)
  );
  const labels = rows.map((r) => r.arrondissement);

  const ctx = document.getElementById(`chart-${key}-secteurs`);
  let chart;
  const build = () => {
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
  };
  build();
  registerRedraw(build);

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
  }, { collapsed: false }).addTo(map);

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
      x: { ticks: { color: cssVar("--text-muted"), maxRotation: 0, autoSkip: true, font: { size: 11 } }, grid: { display: false }, border: { color: cssVar("--baseline") } },
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
      [categoryKey]: { stacked: !!stacked, ticks: { color: cssVar("--text-muted"), font: { size: 11 } }, grid: { display: false }, border: { color: cssVar("--baseline") } },
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
