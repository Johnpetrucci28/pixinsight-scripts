/* Catalogue des scripts. Pour en ajouter un : copier un bloc, remplir les champs,
   déposer le dossier dans scripts/<id>/ puis relancer tools/build-zips.ps1. */
var GH_USER = "Johnpetrucci28";
var GH_REPO = "pixinsight-scripts";

var CATEGORIES = [
  { id: "all", label: "Tous" },
  { id: "couleur", label: "Couleur" },
  { id: "masques", label: "Masques" },
  { id: "empilement", label: "Empilement" },
  { id: "retouche", label: "Retouche" },
  { id: "correction", label: "Correction" },
  { id: "utilitaires", label: "Utilitaires" }
];

var SCRIPTS = [
  {
    id: "SpectralStarMix",
    name: "SpectralStarMix",
    category: "couleur",
    tagline: "Des étoiles aux couleurs physiques, à partir de vos couches LRVBSHO.",
    summary: "Recompose une image d'étoiles couleur à partir de 1 à 7 couches « étoiles seules » (L, R, V, B, SII, Hα, OIII). Chaque filtre est pondéré par son recouvrement spectral avec la vision humaine : un Hα donne un rouge juste, un OIII un bleu-vert juste, sans réglage à l'œil.",
    features: [
      "Poids couleur calculés depuis la longueur d'onde et la largeur de bande de chaque filtre (fonctions CIE 1931)",
      "Égalisation automatique des niveaux entre bandes larges et bandes étroites (régression robuste)",
      "Un curseur de contribution artistique par couche",
      "Saturation, vibrance et aperçu par étirement hyperbolique (GHS)",
      "Sortie linéaire par défaut, prête à réinjecter dans votre traitement"
    ],
    menu: "Script › Utilities › SpectralStarMix",
    requires: "PixInsight 1.8.9+",
    version: "1.0",
    license: "Tous droits réservés (licence à venir)",
    origin: "Création"
  },
  {
    id: "MixHaL",
    name: "Mix Hα + Luminance",
    category: "couleur",
    tagline: "Injecter le Hα dans la luminance, avec aperçu en direct.",
    summary: "Mélange une couche Hα à la luminance pour révéler les nébuleuses sans écraser le reste de l'image. Trois modes de fusion, un aperçu actualisable pour comparer avant de valider.",
    features: [
      "Mode 1 : addition pondérée",
      "Mode 2 : Screen",
      "Mode 3 : Screen + égalisation locale (LHE)",
      "Aperçu actualisable dans une fenêtre dédiée"
    ],
    menu: "Script › Execute Script File…",
    requires: "PixInsight 1.9+ (moteur V8)",
    version: "1.0",
    license: "Tous droits réservés (licence à venir)",
    origin: "Création"
  },
  {
    id: "FusionMasquesMax",
    name: "Fusion de masques (max)",
    category: "masques",
    tagline: "Fusionner 2 ou 3 masques en gardant le plus clair, pixel par pixel.",
    summary: "Combine deux ou trois masques en niveaux de gris par maximum (et non minimum) : chaque zone protégée par l'un des masques le reste dans le résultat. Dilatation et lissage optionnels pour adoucir les transitions.",
    features: [
      "Résultat = max(M1, M2, M3)",
      "Dilatation des zones blanches de X pixels (élément circulaire)",
      "Lissage gaussien de sigma réglable",
      "Fonctionne avec 2 ou 3 masques ouverts"
    ],
    menu: "Script › Utilities › FusionMasquesMax",
    requires: "PixInsight 1.8.9+",
    version: "1.0",
    license: "Tous droits réservés (licence à venir)",
    origin: "Création"
  },
  {
    id: "DrizzleStack",
    name: "DrizzleStack",
    category: "empilement",
    tagline: "Empiler plusieurs sessions déjà alignées, puis drizzler, en un seul passage.",
    summary: "Retrouve dans un dossier racine toutes les images alignées (*_r.xisf / *_r.fits) et leurs fichiers drizzle, intègre, drizzle, puis propose une résolution astrométrique. Idéal pour ajouter une nouvelle nuit à un projet existant sans relancer tout le prétraitement.",
    features: [
      "Recherche récursive des images alignées et des fichiers .xdrz",
      "Normalisation locale (.xnml) proposée automatiquement si présente",
      "ImageIntegration puis DrizzleIntegration enchaînés",
      "Résolution astrométrique de l'empilement, puis du drizzle",
      "Tout est enregistré dans le dossier racine"
    ],
    menu: "Script › Execute Script File…",
    requires: "PixInsight 1.9.6+, StarAlignment avec « Generate drizzle data »",
    version: "1.0",
    license: "Tous droits réservés (licence à venir)",
    origin: "Création"
  },
  {
    id: "BatchSaveWorkspace",
    name: "BatchSaveWorkspace",
    category: "utilitaires",
    tagline: "Enregistrer d'un coup toutes les images ouvertes.",
    summary: "Fini les « Enregistrer sous… » à la chaîne : cochez les fenêtres voulues, choisissez un dossier et un format, c'est fait.",
    features: [
      "Liste des fenêtres ouvertes, à cocher / décocher",
      "Formats XISF, FITS, TIFF, PNG et JPEG",
      "Préfixe et suffixe facultatifs",
      "Écrasement des fichiers existants au choix"
    ],
    menu: "Script › Utilities › BatchSaveWorkspace",
    requires: "PixInsight 1.9+ (moteur V8)",
    version: "1.0",
    license: "Tous droits réservés (licence à venir)",
    origin: "Création"
  },
  {
    id: "PixInk",
    name: "PixInk",
    category: "retouche",
    tagline: "Le pinceau qui manquait à PixInsight.",
    summary: "Un pinceau à main levée façon Photoshop : couleur, taille, opacité et dureté du bord réglables à la volée. On peint sur une copie de travail ; rien ne touche l'image tant qu'on n'a pas cliqué « Appliquer ».",
    features: [
      "Couleur via le sélecteur de PixInsight (niveaux de gris sur image mono)",
      "Taille au curseur ou par Ctrl + clic droit glissé",
      "Opacité plafonnée par trait, comme dans Photoshop",
      "Dégradé du bord de 0 à 100 %",
      "Annulation trait par trait, puis validation en une seule étape annulable"
    ],
    menu: "Script › PixInk › Pinceau",
    requires: "PixInsight 1.9+ (moteur V8)",
    version: "1.0.0",
    license: "Tous droits réservés (licence à venir)",
    origin: "Création",
    repo: "https://github.com/Johnpetrucci28/PixInk"
  },
  {
    id: "IAStamp",
    name: "IA Stamp",
    category: "retouche",
    tagline: "Un tampon génératif : peignez un défaut, il disparaît.",
    summary: "Peignez un halo résiduel, une traînée de satellite ou un pixel chaud, cliquez « Tamponner » : la zone est régénérée par un modèle d'inpainting (LaMa) ou par un algorithme classique, directement sur les données linéaires.",
    features: [
      "Inpainting génératif LaMa (Apache 2.0) ou repli OpenCV sans réseau de neurones",
      "Travaille en données linéaires, aperçu STF pendant qu'on peint",
      "Copie de travail : l'image n'est modifiée qu'à la validation",
      "En-têtes FITS et solution astrométrique conservés"
    ],
    menu: "Script › IA stamp › Generative Stamp",
    requires: "PixInsight 1.9.4+, Python 3 (voir INSTALLATION_PYTHON.md)",
    version: "1.0",
    license: "MIT",
    origin: "Création",
    repo: "https://github.com/Johnpetrucci28/Generative_stamp_for_pixinsight"
  },
  {
    id: "ForaxxPaletteV2",
    name: "Foraxx Palette V2",
    category: "couleur",
    tagline: "La palette Foraxx, avec aperçu en direct et réglages fins.",
    summary: "Version enrichie du script Foraxx Palette de Paul Hancock. Produit la palette Foraxx à partir d'images Hα / OIII / SII étirées et sans étoiles, avec un aperçu en direct et des réglages de poids, saturation et teinte.",
    features: [
      "Aperçu en direct",
      "Poids Hα / OIII / SII réglables",
      "Saturation et teinte réglables",
      "Version étoiles optionnelle (Foraxx_stars)"
    ],
    menu: "Script › Utilities › ForaxxPaletteV2",
    requires: "PixInsight 1.8.9+",
    version: "2.0",
    license: "Selon la licence du script d'origine",
    origin: "Fork — d'après Paul Hancock (2023)"
  },
  {
    id: "CanonBandingReduction",
    name: "Canon Banding Reduction 0.9.4",
    category: "correction",
    tagline: "Le classique anti-bandes des reflex Canon, horizontal et vertical.",
    summary: "Version modifiée du script de Georg Viehoever. Ajoute la correction des bandes verticales, un aperçu zoomable et une bascule avant / après.",
    features: [
      "Correction des bandes verticales (médianes de colonnes) en plus des horizontales",
      "Zoom avant / arrière / 1:1 et molette dans l'aperçu",
      "Case « Corrected View » pour comparer avant / après"
    ],
    menu: "Script › Utilities › CanonBandingReduction",
    requires: "PixInsight 1.8.9+",
    version: "0.9.4",
    license: "GPL v3",
    origin: "Fork — d'après Georg Viehoever (2009-2013)"
  },
  {
    id: "SuperWBPP",
    name: "SuperWBPP",
    category: "empilement",
    tagline: "WBPP, capable de marier caméras couleur et monochromes.",
    summary: "Une évolution de WeightedBatchPreprocessing qui fusionne les canaux R/V/B d'une caméra couleur avec les groupes de filtres d'une caméra monochrome, puis génère une super-luminance.",
    features: [
      "Fusion des canaux OSC avec les groupes mono",
      "Super-luminance synthétique à partir des couches choisies"
    ],
    menu: "Script › Batch Processing › SuperWBPP",
    requires: "PixInsight 1.9+",
    version: "—",
    license: "Selon la licence de WBPP (Pleiades Astrophoto)",
    origin: "Fork — d'après WBPP",
    soon: true
  }
];
