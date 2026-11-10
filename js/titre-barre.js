// Titre dans la barre du haut (style D) : caché tant que le grand titre de la
// page (.hero h1) est visible, il apparaît dès que celui-ci passe sous la barre.
// Chargé juste après le <header>, sans defer : la classe est posée avant le
// premier affichage, donc le titre ne clignote pas au chargement. À ce moment,
// le grand titre n'est pas encore lu : on le cherche au DOMContentLoaded.
(function () {
  const entete = document.querySelector("header.site-header");
  if (!entete || !("IntersectionObserver" in window)) return;

  // Au chargement, on est en haut de page : le grand titre est visible.
  entete.classList.add("titre-en-vue");

  document.addEventListener("DOMContentLoaded", () => {
    const titre = document.querySelector(".hero h1");
    if (!titre) {
      entete.classList.remove("titre-en-vue");
      return;
    }

    let observateur;
    const observer = () => {
      observateur?.disconnect();
      // La zone observée commence sous la barre : le titre « sort » quand il passe dessous.
      observateur = new IntersectionObserver(([e]) => {
        entete.classList.toggle("titre-en-vue", e.isIntersecting);
      }, { rootMargin: `-${entete.offsetHeight}px 0px 0px 0px` });
      observateur.observe(titre);
    };
    observer();
    // La hauteur de la barre change entre mobile et ordinateur.
    window.matchMedia("(max-width: 760px)").addEventListener("change", observer);

    // Les transitions ne s'activent qu'après le premier calcul, pour ne rien animer au chargement.
    requestAnimationFrame(() => requestAnimationFrame(() => entete.classList.add("titre-anime")));
  });
})();
