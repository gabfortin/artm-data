/* ═══════════════════════════════════════════════════════════════════════════
   Animation d'attente « over the top » — base commune
   Modèle unique : ~/Developer/outils/communs/chargement.js (+ chargement.css).
   Ne pas modifier la copie d'un site : changer le modèle, puis lancer
   python3 ~/Developer/outils/recopier_communs.py --appliquer
   Recette et règles : ~/Developer/DESIGN-PAGES.md, « Attente et arrivée
   d'un résultat ». Référence : le radar d'outils-cabinet.

   La base fournit le cadre (verre, reflet), le texte réel (role="status"),
   la barre (indéterminée ou vraie progression), l'apparition retardée (pas
   de clignotement si les données sont déjà là), la sortie et l'arrivée du
   résultat. Chaque site fournit SA scène : une métaphore de ses données
   (balisage passé dans `scene`, CSS dans la feuille du site).

     const ch = Chargement.creer({
       scene: '<span class="velo-roue"></span>…',  // HTML décoratif (aria-hidden)
       titre: "Chargement des compteurs…",
       detail: "12 derniers mois",           // facultatif
       mode: "voile",                          // "voile" (plein écran), "flottant"
                                              // (carte au centre, sans voile) ou
                                              // "dans" (dans `cible`)
       cible: element,                         // pour le mode "dans"
       progres: true,                          // barre de vraie progression
       classe: "ch-compteur",                  // classe de la scène (thème)
     });
     ch.progres(0.4);   ch.titre("…");   ch.detail("…");
     await ch.fermer();                        // ou ch.erreur("Données indisponibles.")
     Chargement.arrivee(elementResultat);      // le résultat monte en sortant d'un flou

   Écran déjà écrit dans le HTML (class="ch ch-voile …", visible avant tout
   script) : Chargement.fermer(ecran, resultat) ou Chargement.erreur(ecran, titre, detail).

   Aucun délai artificiel : l'animation dure le temps réel de l'attente.
   Pas de style en ligne (compatible avec une CSP stricte).
   =========================================================================== */
(function () {
  "use strict";

  const mouvementReduit = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function noeud(tag, classe, texte) {
    const n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texte != null) n.textContent = texte;
    return n;
  }

  function creer(options) {
    const o = Object.assign({ mode: "voile", delai: 150, titre: "Chargement…" }, options || {});
    const racine = noeud("div", "ch ch-" + o.mode + (o.classe ? " " + o.classe : ""));
    racine.setAttribute("role", "status");
    racine.setAttribute("aria-live", "polite");

    const carte = noeud("div", "ch-carte");
    const scene = noeud("div", "ch-scene");
    scene.setAttribute("aria-hidden", "true");
    if (o.scene) scene.innerHTML = o.scene;            // balisage décoratif fourni par le site
    const texte = noeud("div", "ch-texte");
    const titre = noeud("p", "ch-titre", o.titre);
    const detail = noeud("p", "ch-detail" + (o.curseur ? " ch-curseur" : ""), o.detail || "");
    if (!o.detail) detail.hidden = true;
    const barre = noeud("span", "ch-barre" + (o.progres ? " ch-barre-progres" : ""));
    barre.setAttribute("aria-hidden", "true");
    barre.appendChild(noeud("i"));
    const pourcent = noeud("span", "ch-pourcent");
    texte.append(titre, detail, barre);
    if (o.progres) texte.appendChild(pourcent);
    carte.append(scene, texte);
    racine.appendChild(carte);

    let insere = false, ferme = false;
    const parent = o.mode === "dans" ? o.cible : document.body;
    const minuterie = setTimeout(() => {
      if (ferme || !parent) return;
      parent.appendChild(racine);
      insere = true;
    }, Math.max(0, o.delai));

    const ctrl = {
      element: racine,
      titre(t) { titre.textContent = t; return ctrl; },
      detail(t) { detail.textContent = t || ""; detail.hidden = !t; return ctrl; },
      progres(p) {
        const v = Math.max(0, Math.min(1, Number(p) || 0));
        racine.style.setProperty("--ch-p", v.toFixed(3));
        pourcent.textContent = Math.round(v * 100) + " %";
        return ctrl;
      },
      erreur(message) {
        racine.classList.add("ch-erreur");
        titre.textContent = message || "Données indisponibles. Rechargez la page.";
        if (!insere && !ferme && parent) { clearTimeout(minuterie); parent.appendChild(racine); insere = true; }
        return ctrl;
      },
      fermer() {
        if (ferme) return Promise.resolve();
        ferme = true;
        clearTimeout(minuterie);
        if (!insere) return Promise.resolve();
        if (mouvementReduit()) { racine.remove(); return Promise.resolve(); }
        racine.classList.add("ch-sortie");
        return new Promise((ok) => setTimeout(() => { racine.remove(); ok(); }, 260));
      },
    };
    if (o.progres) ctrl.progres(0);
    return ctrl;
  }

  /* Arrivée du résultat : l'élément monte en sortant d'un flou, puis ses
     enfants directs (ou `selecteur`) apparaissent un à un. */
  function arrivee(element, selecteur) {
    if (!element || mouvementReduit()) return;
    element.classList.remove("ch-arrivee");
    void element.offsetWidth;                         // relancer l'animation
    element.classList.add("ch-arrivee");
    const blocs = selecteur ? element.querySelectorAll(selecteur) : element.children;
    Array.from(blocs).slice(0, 12).forEach((b, i) => {
      b.classList.remove("ch-bloc");
      void b.offsetWidth;
      b.classList.add("ch-bloc", "ch-bloc-" + (i + 1));
    });
    setTimeout(() => {
      element.classList.remove("ch-arrivee");
      Array.from(blocs).forEach((b) => b.classList.remove("ch-bloc", ...Array.from({ length: 12 }, (_, i) => "ch-bloc-" + (i + 1))));
    }, 1400);
  }

  /* Écran d'attente écrit directement dans le HTML (visible dès la première
     image, avant tout script) : le fermer, ou y afficher une erreur. */
  function fermer(ecran, resultat) {
    if (!ecran) return Promise.resolve();
    if (resultat) arrivee(resultat);
    if (mouvementReduit()) { ecran.remove(); return Promise.resolve(); }
    ecran.classList.add("ch-sortie");
    return new Promise((ok) => setTimeout(() => { ecran.remove(); ok(); }, 260));
  }
  function erreur(ecran, titre, detail) {
    if (!ecran) return;
    ecran.classList.add("ch-erreur");
    const t = ecran.querySelector(".ch-titre"), d = ecran.querySelector(".ch-detail");
    if (t) t.textContent = titre || "Données indisponibles. Rechargez la page.";
    if (d) { d.textContent = detail || ""; d.hidden = !detail; }
  }

  window.Chargement = { creer, arrivee, fermer, erreur };
})();
