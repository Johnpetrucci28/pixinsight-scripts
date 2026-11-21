/* Affiche le catalogue (data.js), les filtres et la fiche détaillée de chaque script. */
(function () {
  var GALAXY = '<svg viewBox="-50 -50 100 100" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true">' +
    '<g transform="rotate(-28)"><path d="M-23 0H23" stroke-width="6"/><path d="M23 0C43 -1 45 -34 8 -43" stroke-width="5.5"/>' +
    '<path d="M8 -43C-23 -49 -47 -25 -45 4" stroke-width="3"/><path d="M-23 0C-43 1 -45 34 -8 43" stroke-width="5.5"/>' +
    '<path d="M-8 43C23 49 47 25 45 -4" stroke-width="3"/><circle r="11" fill="currentColor" stroke="none"/></g></svg>';

  document.querySelectorAll("[data-galaxy]").forEach(function (el) { el.innerHTML = GALAXY; });
  document.querySelectorAll(".galaxy-sep").forEach(function (el) {
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = '<span></span><i class="galaxy">' + GALAXY + "</i><span></span>";
  });

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function catLabel(id) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i].label;
    return id;
  }
  var repoUrl = "https://github.com/" + GH_USER + "/" + GH_REPO;

  // Filtres
  var chips = document.getElementById("chips");
  var grid = document.getElementById("grid");
  var current = "all";
  CATEGORIES.forEach(function (c) {
    var b = document.createElement("button");
    b.className = "chip"; b.type = "button"; b.textContent = c.label;
    b.setAttribute("aria-pressed", c.id === current ? "true" : "false");
    b.addEventListener("click", function () {
      current = c.id;
      chips.querySelectorAll(".chip").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      render();
    });
    chips.appendChild(b);
  });

  function badge(s) {
    if (s.soon) return '<span class="badge soon">Bientôt</span>';
    if (/^Fork/.test(s.origin)) return '<span class="badge fork">Fork</span>';
    return '<span class="badge">v' + esc(s.version) + "</span>";
  }

  function render() {
    var list = SCRIPTS.filter(function (s) { return current === "all" || s.category === current; });
    grid.innerHTML = list.length ? "" : '<p class="empty">Aucun script dans cette catégorie pour l\'instant.</p>';
    list.forEach(function (s) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "card" + (s.soon ? " is-soon" : "");
      card.innerHTML =
        '<div class="card-top"><span class="cat">' + esc(catLabel(s.category)) + "</span>" + badge(s) + "</div>" +
        "<h3>" + esc(s.name) + "</h3><p>" + esc(s.tagline) + "</p>" +
        '<div class="card-meta"><span>' + esc(s.soon ? "En préparation" : s.license === "MIT" || s.license === "GPL v3" ? s.license : s.origin) + '</span><span class="more">Détails <i>→</i></span></div>';
      card.addEventListener("click", function () { open(s); });
      grid.appendChild(card);
    });
  }

  // Fiche détaillée
  var sheet = document.getElementById("sheet");
  var overlay = document.getElementById("sheet-overlay");
  var body = document.getElementById("sheet-body");
  var lastFocus = null;

  function open(s) {
    lastFocus = document.activeElement;
    var actions = "";
    if (!s.soon) {
      actions += '<a class="btn btn-gold" href="downloads/' + esc(s.id) + '.zip" download>Télécharger (.zip)</a>';
      actions += '<a class="btn btn-ghost" href="' + repoUrl + "/tree/main/scripts/" + esc(s.id) + '" target="_blank" rel="noopener">Code source</a>';
    }
    if (s.repo) actions += '<a class="btn btn-ghost" href="' + esc(s.repo) + '" target="_blank" rel="noopener">Dépôt dédié</a>';

    body.innerHTML =
      '<span class="eyebrow astro">' + esc(catLabel(s.category)) + "</span>" +
      '<h2 id="sheet-title">' + esc(s.name) + "</h2>" +
      '<p class="tagline">' + esc(s.tagline) + "</p>" +
      '<p class="summary">' + esc(s.summary) + "</p>" +
      "<h3>Fonctions</h3><ul class=\"features\">" + s.features.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>" +
      "<h3>Fiche</h3><dl class=\"facts\">" +
        "<dt>Menu</dt><dd>" + esc(s.menu) + "</dd>" +
        "<dt>Requis</dt><dd>" + esc(s.requires) + "</dd>" +
        "<dt>Version</dt><dd>" + esc(s.version) + "</dd>" +
        "<dt>Origine</dt><dd>" + esc(s.origin) + "</dd>" +
        "<dt>Licence</dt><dd>" + esc(s.license) + "</dd>" +
      "</dl>" +
      (s.soon ? '<p class="note">Ce script est encore en développement : il sera publié ici dès qu\'il sera prêt.</p>' : "") +
      '<div class="sheet-actions">' + actions + "</div>";

    sheet.classList.add("open"); overlay.classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
    history.replaceState(null, "", "#" + s.id);
    sheet.querySelector(".sheet-close").focus();
  }
  function close() {
    sheet.classList.remove("open"); overlay.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
    history.replaceState(null, "", location.pathname + location.search);
    if (lastFocus) lastFocus.focus();
  }
  overlay.addEventListener("click", close);
  sheet.querySelector(".sheet-close").addEventListener("click", close);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && sheet.classList.contains("open")) close(); });

  render();
  document.getElementById("count").textContent = SCRIPTS.filter(function (s) { return !s.soon; }).length;

  // Lien direct vers une fiche : …/#SpectralStarMix
  var hash = decodeURIComponent(location.hash.slice(1));
  SCRIPTS.forEach(function (s) { if (s.id === hash) open(s); });

  // En-tête opaque au défilement
  var header = document.querySelector(".site-header");
  function onScroll() { header.classList.toggle("scrolled", window.scrollY > 40); }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  document.getElementById("year").textContent = new Date().getFullYear();
})();
