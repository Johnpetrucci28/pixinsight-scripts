#engine v8
// ============================================================================
// DrizzleStack.js — Script PixInsight (PJSR)
//
// Empile des images déjà alignées (StarAlignment) provenant de plusieurs
// sessions, puis produit un drizzle.
//
//   1. Cherche récursivement, dans un dossier racine, les images alignées
//      (*_r.xisf / *_r.fit / *_r.fits) et leurs fichiers drizzle (.xdrz).
//   2. Demande le chemin de l'image témoin de cadrage.
//      Fenêtre de réglages : titre, témoin (modifiable), paramètres drizzle.
//   3. ImageIntegration (avec mise à jour des .xdrz = données de rejet).
//   4. DrizzleIntegration.
//   5. Propose un plate solve (ImageSolver) sur l'empilement puis sur le
//      drizzle (ce dernier guidé par la solution de l'empilement).
//   6. Sauvegarde dans le dossier racine.
//
// Prérequis : StarAlignment exécuté avec « Generate drizzle data » coché.
// Si des fichiers .xnml (LocalNormalization) existent avec le même nom de base,
// ils sont proposés (recommandé pour du multi-sessions).
//
// Testé contre ImageSolver 6.6.0 (PixInsight 1.9.6+).
// Utilisation : Script > Execute Script File… (ou Script Editor puis F9).
// ============================================================================

#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/TextAlign.jsh>

// Bibliothèque ImageSolver de PixInsight (résolution astrométrique).
// Adapter le chemin si PixInsight n'est pas installé à l'emplacement par défaut.
#define SETTINGS_MODULE "DrizzleStack"
#define USE_SOLVER_LIBRARY true
#include "C:/Program Files/PixInsight/src/scripts/ImageSolver/ImageSolver.js"

// ----------------------------- Réglages ------------------------------------
// Valeurs par défaut proposées dans la boîte de dialogue.
var CONFIG = {
   title         : "",         // titre des images (ex. "M42") ; vide = noms par défaut
   suffix        : "_r",       // suffixe ajouté par StarAlignment
   extensions    : [".xisf", ".fit", ".fits", ".fts"],
   drizzleScale  : 2,          // 2 = x2 ; 1 = drizzle sans agrandissement
   dropShrink    : 0.90,       // "pixfrac" (0.7–1.0 typique)
   kernel        : 0,          // index dans KERNELS ci-dessous
   isCFA         : false,      // true si drizzle CFA (images OSC non débayerisées)
   enableRejection      : true,
   enableImageWeighting : true,
   enableSurfaceSplines : true,
   useLN         : true,       // utilisé seulement si les .xnml existent
   sigmaLow      : 4.0,
   sigmaHigh     : 3.0,
   closeWindows  : false       // fermer les fenêtres après sauvegarde
};
// ---------------------------------------------------------------------------

var KERNELS = [
   { name: "Square (carré)",        key: "Kernel_Square" },
   { name: "Circular (circulaire)", key: "Kernel_Circular" },
   { name: "Gaussian",              key: "Kernel_Gaussian" }
];

// Image témoin de cadrage : fenêtre ouverte (cachée sauf si affichée)
var TEMOIN = { path: "", win: null, shown: false, solved: false, width: 0, height: 0 };

// ---------------------------------------------------------------------------

function searchFiles( dir, out )
{
   var ff = new FileFind;
   if ( ff.begin( dir + "/*" ) )
      do
      {
         if ( ff.name == "." || ff.name == ".." )
            continue;
         var p = dir + "/" + ff.name;
         if ( ff.isDirectory )
            searchFiles( p, out );
         else
            out.push( p );
      }
      while ( ff.next() );
}

function endsWith( s, t )
{
   return s.length >= t.length && s.substring( s.length - t.length ) == t;
}

function pickRejection( n )
{
   var II = ImageIntegration;
   if ( n < 8 )  return { alg: II.PercentileClip,        name: "Percentile Clipping" };
   if ( n < 15 ) return { alg: II.SigmaClip,             name: "Sigma Clipping" };
   if ( n < 25 ) return { alg: II.WinsorizedSigmaClip,   name: "Winsorized Sigma Clipping" };
   return               { alg: II.LinearFit,             name: "Linear Fit Clipping" };
}

// Règle un paramètre de process en nommant le paramètre fautif en cas d'erreur.
// optional = true : paramètre absent de cette version -> simple avertissement.
function setParam( proc, key, value, optional )
{
   if ( value === undefined )
   {
      if ( optional )
      {
         console.warningln( "Paramètre " + key + " : valeur indisponible, ignoré." );
         return;
      }
      throw new Error( "Paramètre " + key + " : valeur indisponible dans cette version de PixInsight." );
   }
   try
   {
      proc[key] = value;
   }
   catch ( e )
   {
      var msg = "Paramètre " + key + " refusé : " + ((e && e.message) ? e.message : String( e ));
      if ( optional )
         console.warningln( msg );
      else
         throw new Error( msg );
   }
}

function isAlive( w )
{
   return w != null && !w.isNull && w.isWindow;
}

function hasSolution( w )
{
   return isAlive( w ) && w.hasAstrometricSolution;
}

// ----------------------------- Témoin --------------------------------------

function closeTemoin()
{
   if ( isAlive( TEMOIN.win ) && !TEMOIN.shown )
      TEMOIN.win.forceClose();
   TEMOIN.win = null;
   TEMOIN.shown = false;
}

// Ouvre (sans l'afficher) l'image témoin et lit sa géométrie et son astrométrie
function loadTemoin( path )
{
   if ( path == TEMOIN.path && isAlive( TEMOIN.win ) )
      return true;
   closeTemoin();
   TEMOIN.path = path;
   TEMOIN.solved = false;
   TEMOIN.width = TEMOIN.height = 0;
   var ws = ImageWindow.open( path, "", "non-interactive" );
   if ( !ws || ws.length == 0 || !isAlive( ws[0] ) )
      return false;
   for ( var i = 1; i < ws.length; ++i )
      ws[i].forceClose();
   TEMOIN.win = ws[0];
   TEMOIN.solved = TEMOIN.win.hasAstrometricSolution;
   TEMOIN.width = TEMOIN.win.mainView.image.width;
   TEMOIN.height = TEMOIN.win.mainView.image.height;
   return true;
}

// Demande le chemin de l'image témoin ; renvoie null si annulé
function askTemoinPath( initialDir )
{
   var ofd = new OpenFileDialog;
   ofd.caption = "Chemin de l'image témoin de cadrage";
   ofd.filters = [ [ "Images", "*.xisf", "*.fit", "*.fits", "*.fts" ], [ "Tous les fichiers", "*" ] ];
   if ( initialDir && initialDir != "" )
      ofd.initialPath = initialDir;
   return ofd.execute() ? ofd.fileName : null;
}

// Affiche le témoin avec un étirement automatique (STF) pour juger le cadrage
function showTemoin()
{
   if ( !loadTemoin( TEMOIN.path ) )
      return;
   var v = TEMOIN.win.mainView;
   var img = v.image;
   var med = img.median();
   var mad = img.MAD() * 1.4826;
   var c0 = Math.max( 0, med - 2.8 * mad );
   var m = Math.mtf( 0.25, med - c0 );
   var ch = [ m, c0, 1, 0, 1 ];
   v.stf = [ ch, ch, ch, [ 0.5, 0, 1, 0, 1 ] ];
   TEMOIN.shown = true;
   TEMOIN.win.show();
   TEMOIN.win.zoomToFit();
   TEMOIN.win.bringToFront();
}

// ----------------------------- Astrométrie ---------------------------------

// Résout la fenêtre avec ImageSolver. hints : valeurs initiales facultatives
// (ra, dec, focal, xpixsz, resolution) pour guider la recherche.
function solveWindow( win, hints )
{
   var solver = new ImageSolver;
   solver.interactive = true;
   try
   {
      solver.initialize( win, false/*prioritizeSettings*/ );
   }
   catch ( e )
   {
      console.warningln( "ImageSolver : initialisation impossible : " + e );
      return false;
   }
   solver.metadata.width = win.mainView.image.width;
   solver.metadata.height = win.mainView.image.height;
   if ( hints )
   {
      for ( var k in hints )
         if ( hints[k] !== undefined && hints[k] !== null && !isNaN( hints[k] ) )
            solver.metadata[k] = hints[k];
      solver.userSeed = { coordinates: true, scale: true };
   }

   for ( ;; )
   {
      win.show();
      win.bringToFront();
      var dlg = new ImageSolverDialog( solver.solverCfg, solver.metadata, false/*showTargetImage*/ );
      if ( !dlg.execute() )
      {
         console.warningln( "ImageSolver annulé pour " + win.mainView.id );
         return false;
      }
      solver.solverCfg = dlg.solverCfg;
      solver.metadata = dlg.metadata;
      solver.userSeed = { coordinates: solver.userSeed.coordinates || dlg.coordsEdited,
                          scale: solver.userSeed.scale || dlg.scaleEdited };
      solver.solverCfg.SaveSettings();
      solver.metadata.SaveSettings();
      try
      {
         solver.metadata.SaveParameters();
         solver.solverCfg.SaveParameters();
         solver.solveImage( win );        // lève une exception en cas d'échec
         console.noteln( "Solution astrométrique calculée :" );
         console.writeln( win.astrometricSolutionSummary().trim() );
         return true;
      }
      catch ( e )
      {
         console.warningln( "ImageSolver a échoué : " + e );
         if ( new MessageBox( "La résolution astrométrique a échoué :\n" + e +
                              "\n\nRéessayer avec d'autres réglages ?",
                              "DrizzleStack", StdIcon_Warning, StdButton_Yes, StdButton_No ).execute() != StdButton_Yes )
            return false;
      }
   }
}

// Lit centre et échelle d'une image résolue (pour guider la résolution du drizzle)
function solutionHints( win, scale )
{
   try
   {
      var s = new ImageSolver;
      s.interactive = false;
      s.initialize( win, false );
      var m = s.metadata;
      return { ra: m.ra, dec: m.dec, focal: m.focal,
               xpixsz: m.xpixsz / scale, resolution: m.resolution / scale };
   }
   catch ( e )
   {
      return null;
   }
}

// Propose un plate solve (ImageSolver) sur un résultat. La solution éventuellement
// héritée des images n'est pas jugée fiable : on demande toujours.
// hints : centre et échelle pour guider ImageSolver (ou null).
function askPlateSolve( win, label, hints, hintSource )
{
   win.show();
   win.bringToFront();
   var had = hasSolution( win );
   var msg = label + " terminé.\n\n" +
             (had ? "Il porte une solution astrométrique héritée des images, qui peut être fausse.\n\n"
                  : "Il n'a pas de solution astrométrique.\n\n") +
             "Lancer un plate solve (ImageSolver) ?" +
             (hints ? "\n(centre et échelle pré-remplis depuis " + hintSource + ")" : "");
   if ( new MessageBox( msg, "DrizzleStack — plate solve", StdIcon_Question,
                        StdButton_Yes, StdButton_No ).execute() != StdButton_Yes )
   {
      console.warningln( label + " : plate solve refusé" +
                         (had ? " (solution héritée conservée)." : " (pas de solution astrométrique).") );
      return false;
   }
   // Une solution réussie remplace la solution héritée ; en cas d'échec ou
   // d'annulation, l'image reste telle quelle.
   console.writeln( label + " : plate solve…" );
   return solveWindow( win, hints );
}

// --------------------- Boîte de dialogue des paramètres --------------------
var DrizzleDialog = class extends Dialog
{
constructor( frames, root, rejName, hasLN )
{
   super();
   var self = this;
   var labelWidth = this.font.width( "Drop shrink (pixfrac) :" ) + 8;

   function rowLabel( text )
   {
      var l = new Label( self );
      l.text = text;
      l.textAlignment = TextAlign_Right | TextAlign_VertCenter;
      l.setFixedWidth( labelWidth );
      return l;
   }

   this.info = new Label( this );
   this.info.useRichText = true;
   this.info.text = "<b>" + frames.length + "</b> images trouvées — rejet : <b>" + rejName + "</b>";

   // --- Titre ---
   this.titleEdit = new Edit( this );
   this.titleEdit.text = CONFIG.title;
   this.titleEdit.toolTip = "Nom donné aux images produites (fichiers et fenêtres), ex. « M42 ».\n" +
                            "Résultat : M42_integration.xisf, M42_drizzle_x2_drop90.xisf";
   this.titleEdit.onTextUpdated = function( t ) { CONFIG.title = t.trim(); };
   this.titleSizer = new HorizontalSizer;
   this.titleSizer.spacing = 4;
   this.titleSizer.add( rowLabel( "Titre :" ) );
   this.titleSizer.add( this.titleEdit, 100 );

   // --- Témoin de cadrage (chemin demandé au lancement, modifiable ici) ---
   this.temoinEdit = new Edit( this );
   this.temoinEdit.readOnly = true;
   this.temoinEdit.toolTip = "Image de référence pour le cadrage. Si elle fait partie des images alignées, " +
                             "elle est placée en tête de l'empilement (référence de normalisation et des métadonnées).";

   this.temoinStatus = new Label( this );
   this.temoinStatus.useRichText = true;

   function selectTemoin( path )
   {
      self.temoinEdit.text = path;
      self.temoinStatus.text = "Ouverture…";
      processEvents();
      var ok = loadTemoin( path );
      self.temoinStatus.text = !ok ? "<span style='color:#c00'>Impossible d'ouvrir l'image.</span>" :
         TEMOIN.width + " x " + TEMOIN.height + " px — solution astrométrique : " +
         (TEMOIN.solved ? "oui" : "non");
   }

   this.browseButton = new PushButton( this );
   this.browseButton.text = "Changer…";
   this.browseButton.toolTip = "Choisir une autre image témoin. Elle doit avoir les mêmes dimensions " +
                               "que les images alignées.";
   this.browseButton.onClick = function()
   {
      var p = askTemoinPath( File.extractDrive( TEMOIN.path ) + File.extractDirectory( TEMOIN.path ) );
      if ( p != null )
         selectTemoin( p );
   };

   this.showButton = new PushButton( this );
   this.showButton.text = "Afficher";
   this.showButton.toolTip = "Ouvre le témoin (étirement automatique) pour vérifier le cadrage.";
   this.showButton.onClick = function() { showTemoin(); };

   this.temoinButtons = new HorizontalSizer;
   this.temoinButtons.spacing = 4;
   this.temoinButtons.add( this.browseButton );
   this.temoinButtons.add( this.showButton );
   this.temoinButtons.addStretch();

   this.astroNote = new Label( this );
   this.astroNote.wordWrapping = true;
   this.astroNote.text = "Un plate solve (ImageSolver) sera proposé sur l'empilement puis sur le drizzle.";

   this.temoinGroup = new GroupBox( this );
   this.temoinGroup.title = "Témoin de cadrage et astrométrie";
   this.temoinGroup.sizer = new VerticalSizer;
   this.temoinGroup.sizer.margin = 6;
   this.temoinGroup.sizer.spacing = 4;
   this.temoinGroup.sizer.add( this.temoinEdit );
   this.temoinGroup.sizer.add( this.temoinButtons );
   this.temoinGroup.sizer.add( this.temoinStatus );
   this.temoinGroup.sizer.add( this.astroNote );

   // --- Drizzle ---
   this.scaleCtl = new NumericControl( this );
   this.scaleCtl.label.text = "Échelle :";
   this.scaleCtl.label.setFixedWidth( labelWidth );
   this.scaleCtl.setRange( 1, 4 );
   this.scaleCtl.slider.setRange( 0, 30 );
   this.scaleCtl.setPrecision( 1 );
   this.scaleCtl.setValue( CONFIG.drizzleScale );
   this.scaleCtl.toolTip = "Facteur d'agrandissement (2 = x2). 1 = drizzle à la résolution d'origine.";
   this.scaleCtl.onValueUpdated = function( v ) { CONFIG.drizzleScale = v; };

   this.shrinkCtl = new NumericControl( this );
   this.shrinkCtl.label.text = "Drop shrink (pixfrac) :";
   this.shrinkCtl.label.setFixedWidth( labelWidth );
   this.shrinkCtl.setRange( 0.1, 1.0 );
   this.shrinkCtl.slider.setRange( 0, 90 );
   this.shrinkCtl.setPrecision( 2 );
   this.shrinkCtl.setValue( CONFIG.dropShrink );
   this.shrinkCtl.toolTip = "Taille des gouttes. Plus petit = plus net mais plus bruité / trous possibles. " +
                            "Il faut beaucoup d'images bien ditherées pour descendre sous 0.7.";
   this.shrinkCtl.onValueUpdated = function( v ) { CONFIG.dropShrink = v; };

   this.kernelCombo = new ComboBox( this );
   for ( var i = 0; i < KERNELS.length; ++i )
      this.kernelCombo.addItem( KERNELS[i].name );
   this.kernelCombo.currentItem = CONFIG.kernel;
   this.kernelCombo.onItemSelected = function( i ) { CONFIG.kernel = i; };
   this.kernelSizer = new HorizontalSizer;
   this.kernelSizer.spacing = 4;
   this.kernelSizer.add( rowLabel( "Noyau :" ) );
   this.kernelSizer.add( this.kernelCombo, 100 );

   function check( text, key, tip, enabled )
   {
      var c = new CheckBox( self );
      c.text = text;
      c.checked = CONFIG[key];
      c.toolTip = tip;
      c.enabled = enabled;
      c.onCheck = function( on ) { CONFIG[key] = on; };
      return c;
   }
   this.cfaCheck = check( "Drizzle CFA (images OSC non débayerisées)", "isCFA",
                          "À cocher seulement si les images alignées sont des CFA brutes.", true );
   this.rejCheck = check( "Appliquer le rejet de pixels", "enableRejection",
                          "Utilise les données de rejet écrites par ImageIntegration.", true );
   this.wCheck   = check( "Pondération des images", "enableImageWeighting",
                          "Utilise les poids calculés par ImageIntegration.", true );
   this.splCheck = check( "Surface splines (distorsions)", "enableSurfaceSplines",
                          "Utilise les modèles de distorsion de StarAlignment s'ils existent.", true );
   if ( !hasLN )
      CONFIG.useLN = false;
   this.lnCheck  = check( "Local normalization" + (hasLN ? "" : " (aucun .xnml trouvé)"), "useLN",
                          "Utilise les fichiers .xnml (recommandé en multi-sessions).", hasLN );

   this.drizzleGroup = new GroupBox( this );
   this.drizzleGroup.title = "Drizzle";
   this.drizzleGroup.sizer = new VerticalSizer;
   this.drizzleGroup.sizer.margin = 6;
   this.drizzleGroup.sizer.spacing = 4;
   this.drizzleGroup.sizer.add( this.scaleCtl );
   this.drizzleGroup.sizer.add( this.shrinkCtl );
   this.drizzleGroup.sizer.add( this.kernelSizer );
   this.drizzleGroup.sizer.add( this.cfaCheck );
   this.drizzleGroup.sizer.add( this.rejCheck );
   this.drizzleGroup.sizer.add( this.wCheck );
   this.drizzleGroup.sizer.add( this.splCheck );
   this.drizzleGroup.sizer.add( this.lnCheck );

   // --- Boutons ---
   this.okButton = new PushButton( this );
   this.okButton.text = "Lancer";
   this.okButton.onClick = function()
   {
      if ( !isAlive( TEMOIN.win ) && !loadTemoin( TEMOIN.path ) )
      {
         new MessageBox( "Impossible d'ouvrir l'image témoin.", "DrizzleStack",
                         StdIcon_Error, StdButton_Ok ).execute();
         return;
      }
      self.ok();
   };
   this.cancelButton = new PushButton( this );
   this.cancelButton.text = "Annuler";
   this.cancelButton.onClick = function() { self.cancel(); };
   this.buttons = new HorizontalSizer;
   this.buttons.spacing = 6;
   this.buttons.addStretch();
   this.buttons.add( this.okButton );
   this.buttons.add( this.cancelButton );

   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 6;
   this.sizer.add( this.info );
   this.sizer.add( this.titleSizer );
   this.sizer.add( this.temoinGroup );
   this.sizer.add( this.drizzleGroup );
   this.sizer.addSpacing( 4 );
   this.sizer.add( this.buttons );

   this.windowTitle = "DrizzleStack — paramètres";
   this.setMinWidth( 520 );
   selectTemoin( TEMOIN.path );
   this.adjustToContents();
}
};

// ----------------------------- Sauvegarde ----------------------------------

// Nom de fichier : retire les caractères interdits sous Windows
function safeFileName( s )
{
   return s.replace( /[\\\/:*?"<>|]/g, "_" ).replace( /\s+/g, "_" );
}

// Identifiant de fenêtre PixInsight : lettres, chiffres, _ ; pas de chiffre en tête
function safeId( s )
{
   var id = s.replace( /[^A-Za-z0-9_]/g, "_" );
   if ( id.length == 0 || /^[0-9]/.test( id ) )
      id = "_" + id;
   return id;
}

// Préfixe "Titre_" si un titre a été donné
function titled( base )
{
   return CONFIG.title != "" ? safeFileName( CONFIG.title ) + "_" + base : base;
}

function renameWindow( w, path )
{
   if ( CONFIG.title != "" )
      try { w.mainView.id = safeId( File.extractName( path ) ); }
      catch ( e ) { /* identifiant déjà pris (fenêtre d'un run précédent) : on garde l'id auto */ }
}

function saveWindow( w, path )
{
   w.saveAs( path, false, false, false, false );
   console.writeln( "<b>Sauvegardé :</b> " + path +
                    (hasSolution( w ) ? " (avec solution astrométrique)" : " (sans solution astrométrique)") );
   w.show();
}

function windowOrThrow( id )
{
   var w = ImageWindow.windowById( id );
   if ( w.isNull )
      throw new Error( "Fenêtre introuvable : " + id );
   return w;
}

// ------------------------------- Main --------------------------------------

function main()
{
   console.show();

   // --- Dossier racine contenant toutes les sessions ---
   var gdd = new GetDirectoryDialog;
   gdd.caption = "Dossier racine contenant les images alignées (toutes sessions)";
   if ( !gdd.execute() )
      return;
   var root = gdd.directory;
   if ( endsWith( root, "/" ) )
      root = root.substring( 0, root.length - 1 );

   console.writeln( "<end><cbr><br><b>DrizzleStack</b> — recherche dans " + root );
   var all = [];
   searchFiles( root, all );

   // Index des .xnml par nom de base
   var xnml = {};
   for ( var i = 0; i < all.length; ++i )
      if ( File.extractExtension( all[i] ).toLowerCase() == ".xnml" )
         xnml[File.extractName( all[i] )] = all[i];

   // Images alignées + .xdrz associés
   var frames = [], missing = [];
   for ( var i = 0; i < all.length; ++i )
   {
      var f = all[i];
      var ext = File.extractExtension( f ).toLowerCase();
      var name = File.extractName( f );
      if ( CONFIG.extensions.indexOf( ext ) < 0 || !endsWith( name, CONFIG.suffix ) )
         continue;
      var drz = File.extractDrive( f ) + File.extractDirectory( f ) + "/" + name + ".xdrz";
      if ( !File.exists( drz ) )
      {
         missing.push( f );
         continue;
      }
      frames.push( { image: f, drizzle: drz, lnorm: xnml[name] || "" } );
   }

   console.writeln( frames.length + " image(s) avec données drizzle trouvée(s)." );
   if ( missing.length > 0 )
   {
      console.warningln( missing.length + " image(s) sans fichier .xdrz (ignorées) :" );
      for ( var i = 0; i < missing.length; ++i )
         console.warningln( "  " + missing[i] );
   }
   if ( frames.length < 3 )
   {
      new MessageBox( "Pas assez d'images avec fichier .xdrz (" + frames.length + ").\n\n" +
                      "Relancez StarAlignment avec « Generate drizzle data » coché.",
                      "DrizzleStack", StdIcon_Error, StdButton_Ok ).execute();
      return;
   }

   var hasLN = true;
   for ( var i = 0; i < frames.length; ++i )
      if ( frames[i].lnorm == "" ) { hasLN = false; break; }

   // --- Chemin de l'image témoin de cadrage ---
   var temoinPath = askTemoinPath( root );
   if ( temoinPath == null )
   {
      console.warningln( "Aucune image témoin choisie : arrêt." );
      return;
   }
   TEMOIN.path = temoinPath;

   var rej = pickRejection( frames.length );
   if ( !(new DrizzleDialog( frames, root, rej.name, hasLN )).execute() )
   {
      closeTemoin();
      return;
   }
   var useLN = hasLN && CONFIG.useLN;

   // Le témoin, s'il fait partie des images, passe en tête : il devient la
   // référence d'ImageIntegration (normalisation, métadonnées, astrométrie).
   function normPath( p ) { return p.replace( /\\/g, "/" ).toLowerCase(); }
   for ( var i = 0; i < frames.length; ++i )
      if ( normPath( frames[i].image ) == normPath( TEMOIN.path ) )
      {
         if ( i > 0 )
            frames.unshift( frames.splice( i, 1 )[0] );
         break;
      }

   console.writeln( "Témoin de cadrage : " + TEMOIN.path +
                    (TEMOIN.solved ? " (résolu)" : " (non résolu)") );
   console.writeln( "Local normalization : " + (useLN ? "oui" : "non") );
   console.writeln( "Drizzle : échelle " + CONFIG.drizzleScale.toFixed( 1 ) +
                    ", drop shrink " + CONFIG.dropShrink.toFixed( 2 ) +
                    ", noyau " + KERNELS[CONFIG.kernel].name +
                    (CONFIG.isCFA ? ", CFA" : "") );

   // ------------------------- 1. ImageIntegration -------------------------
   console.writeln( "<br><b>1/2 — ImageIntegration</b>" );
   var II = new ImageIntegration;
   var IIp = ImageIntegration;
   var list = [];
   for ( var i = 0; i < frames.length; ++i )
      list.push( [ true, frames[i].image, frames[i].drizzle, useLN ? frames[i].lnorm : "" ] );
   setParam( II, "images", list );
   setParam( II, "combination", IIp.Average );
   setParam( II, "weightMode", IIp.PSFSignalWeight );
   if ( useLN )
   {
      setParam( II, "normalization", IIp.LocalNormalization );
      setParam( II, "rejectionNormalization", IIp.LocalRejectionNormalization );
   }
   else
   {
      setParam( II, "normalization", IIp.AdditiveWithScaling );
      setParam( II, "rejectionNormalization", IIp.Scale );
   }
   setParam( II, "rejection", rej.alg );
   setParam( II, "sigmaLow", CONFIG.sigmaLow );
   setParam( II, "sigmaHigh", CONFIG.sigmaHigh );
   setParam( II, "linearFitLow", 5.0, true );
   setParam( II, "linearFitHigh", 4.0, true );
   setParam( II, "clipLow", true, true );
   setParam( II, "clipHigh", true, true );
   setParam( II, "generateRejectionMaps", true, true );
   setParam( II, "generateDrizzleData", true );   // écrit le rejet dans les .xdrz (indispensable)
   setParam( II, "generate64BitResult", false, true );
   if ( !II.executeGlobal() )
      throw new Error( "ImageIntegration a échoué." );

   [ II.lowRejectionMapImageId, II.highRejectionMapImageId, II.slopeMapImageId ].forEach( function( id ) {
      if ( id && id != "" ) { var w = ImageWindow.windowById( id ); if ( !w.isNull ) w.forceClose(); }
   } );

   var intPath = root + "/" + titled( "integration" ) + ".xisf";
   var intWin = windowOrThrow( II.integrationImageId );
   renameWindow( intWin, intPath );
   var intSolved = askPlateSolve( intWin, "Empilement", null, "" );
   saveWindow( intWin, intPath );

   // ------------------------ 2. DrizzleIntegration ------------------------
   console.writeln( "<br><b>2/2 — DrizzleIntegration</b>" );
   var DI = new DrizzleIntegration;
   var dlist = [];
   for ( var i = 0; i < frames.length; ++i )
      dlist.push( [ true, frames[i].drizzle, useLN ? frames[i].lnorm : "" ] );
   setParam( DI, "inputData", dlist );
   setParam( DI, "scale", CONFIG.drizzleScale );
   setParam( DI, "dropShrink", CONFIG.dropShrink );
   var kf = DrizzleIntegration[KERNELS[CONFIG.kernel].key];
   if ( kf === undefined )
   {
      console.warningln( "Noyau " + KERNELS[CONFIG.kernel].name + " indisponible dans cette version, Square utilisé." );
      kf = DrizzleIntegration.Kernel_Square;
   }
   setParam( DI, "kernelFunction", kf );
   setParam( DI, "enableCFA", CONFIG.isCFA );
   setParam( DI, "enableRejection", CONFIG.enableRejection, true );
   setParam( DI, "enableImageWeighting", CONFIG.enableImageWeighting, true );
   setParam( DI, "enableSurfaceSplines", CONFIG.enableSurfaceSplines, true );
   setParam( DI, "enableLocalNormalization", useLN, true );
   setParam( DI, "useROI", false, true );
   setParam( DI, "closePreviousImages", false, true );
   if ( DrizzleIntegration.Continue !== undefined )
      setParam( DI, "onError", DrizzleIntegration.Continue, true );
   if ( !DI.executeGlobal() )
      throw new Error( "DrizzleIntegration a échoué." );

   if ( DI.weightImageId && DI.weightImageId != "" )
   {
      var ww = ImageWindow.windowById( DI.weightImageId );
      if ( !ww.isNull ) ww.forceClose();
   }

   var scaleTag = (Math.round( CONFIG.drizzleScale * 10 ) / 10).toString().replace( ".", "p" );
   var dropTag = Math.round( CONFIG.dropShrink * 100 ).toString();
   var drzPath = root + "/" + titled( "drizzle_x" + scaleTag + "_drop" + dropTag ) + ".xisf";
   var drzWin = windowOrThrow( DI.integrationImageId );
   renameWindow( drzWin, drzPath );
   // Le drizzle a une autre échelle : si l'empilement vient d'être résolu, on
   // reprend son centre et son échelle (divisée par le facteur drizzle).
   var hints = intSolved ? solutionHints( intWin, CONFIG.drizzleScale ) : null;
   askPlateSolve( drzWin, "Drizzle", hints, "l'empilement résolu" );
   saveWindow( drzWin, drzPath );

   if ( CONFIG.closeWindows )
   {
      intWin.forceClose();
      drzWin.forceClose();
   }
   closeTemoin();
   console.writeln( "<br><b>Terminé.</b>" );
}

try
{
   main();
}
catch ( e )
{
   closeTemoin();
   var msg = (e && e.message) ? e.message : String( e );
   console.criticalln( "Erreur : " + msg );
   new MessageBox( msg, "DrizzleStack", StdIcon_Error, StdButton_Ok ).execute();
}
