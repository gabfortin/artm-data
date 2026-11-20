"use strict";

/* ===========================================================================
   Style D « dashboard détaillé » — utilitaires communs
   Modèle unique : ~/Developer/outils/communs/style-d.js (DESIGN-PAGES.md).
   Ne pas modifier la copie d'un site : changer le modèle, puis lancer
   python3 ~/Developer/outils/recopier_communs.py --appliquer

   Script classique (pas un module) : les fonctions sont globales. Le charger
   avant le script du site (js/main.js, js/app.js…).
   =========================================================================== */

/* Nombres à la française : virgule décimale, espace insécable pour les
   milliers, vrai signe moins « − » (U+2212) plutôt que le trait d'union. */
function minus(str) {
  return String(str).replace(/(^|[\s(  →])-(?=\d)/g, "$1−");
}

/* Remplace n.toFixed(d) pour l'affichage : « 14,78 » et non « 14.78 ». */
function fr(n, d = 0) {
  return minus(Number(n).toLocaleString("fr-CA", { minimumFractionDigits: d, maximumFractionDigits: d }));
}

/* fetchJSON.apresChaque (facultatif) : appelée après chaque fichier reçu, pour
   faire avancer une animation d'attente (Chargement.progres). */
async function fetchJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const donnees = await res.json();
  if (typeof fetchJSON.apresChaque === "function") fetchJSON.apresChaque(path);
  return donnees;
}

/* Valeur d'un jeton CSS (couleurs des graphiques, qui changent en sombre). */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* Crée un élément. Le texte passe par textNode (jamais innerHTML) : on peut y
   mettre des données venues de l'extérieur sans risque. */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(minus(c)) : c);
  }
  return node;
}

/* Menu qui suit la lecture (nav.main-nav, liens #section) + bouton « # » qui
   copie le lien de chaque section (section.panel[id] .section-head h2).
   Le menu est court (5 liens au plus) : une section sans lien propre allume
   le lien de la section qui la précède. */
function initNavEnhancements() {
  const links = new Map();
  document.querySelectorAll('nav.main-nav a[href^="#"]').forEach((a) => links.set(a.getAttribute("href").slice(1), a));
  const lienDe = new Map();
  let courant = null;
  document.querySelectorAll("section.panel[id]").forEach((sec) => {
    courant = links.get(sec.id) || courant;
    if (courant) lienDe.set(sec, courant);
  });
  const sections = [...lienDe.keys()];
  if ("IntersectionObserver" in window && sections.length) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        links.forEach((a) => a.removeAttribute("aria-current"));
        lienDe.get(e.target).setAttribute("aria-current", "location");
      }
    }, { rootMargin: "-40% 0px -55% 0px" });
    sections.forEach((sec) => io.observe(sec));
  }

  const live = el("p", { class: "sr-only", "aria-live": "polite" });
  document.body.appendChild(live);
  document.querySelectorAll("section.panel[id] .section-head h2").forEach((h2) => {
    const id = h2.closest("section.panel").id;
    const btn = el("button", { type: "button", class: "anchor-link", title: "Copier le lien vers cette section", "aria-label": `Copier le lien vers la section « ${h2.textContent.trim()} »` }, "#");
    btn.addEventListener("click", () => {
      const url = `${location.origin}${location.pathname}#${id}`;
      history.replaceState(null, "", `#${id}`);
      const done = () => {
        btn.textContent = "Lien copié";
        btn.classList.add("copied");
        live.textContent = "Lien copié";
        setTimeout(() => { btn.textContent = "#"; btn.classList.remove("copied"); live.textContent = ""; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
      else done();
    });
    h2.appendChild(btn);
  });
}
