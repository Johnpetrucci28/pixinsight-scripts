#engine v8

#feature-id    PixInk : PixInk > Pinceau
#feature-info  Un pinceau libre a la Photoshop pour PixInsight -- couleur, taille, opacite, degrade (durete du bord).

#include <pjsr/controls/SimpleColorDialog.js>

/*
 * PixInk -- pinceau libre pour PixInsight.
 *
 * PixInsight n'a pas d'outil pinceau natif au sens Photoshop (couleur/
 * taille/opacite/degrade reglables a la volee, trace a main levee). Ce
 * script le construit entierement en PJSR.
 *
 * NOTE sur la portee (meme finding que IA Stamp's own IAStamp.js -- pas
 * redecouvert ici, cite directement): PJSR n'a aucun moyen d'accrocher des
 * evenements souris sur le viewport reel d'une ImageWindow/View -- confirme
 * contre la doc locale (aucun onMouse* documente sur ces classes) et contre
 * les scripts communautaires livres avec PixInsight. Un vrai outil interactif
 * au niveau de CloneStamp est un module PCL compile en C++, pas un .js. Ce
 * script trace donc sur le canvas de sa PROPRE boite de dialogue, exactement
 * comme IAStamp.js et HaloRemoverPI.js le font deja.
 *
 * Workflow "copie de travail" -- meme garde-fou que les deux autres scripts
 * de ce depot: chaque trait de pinceau est ecrit dans une ImageWindow interne
 * (jamais la vue reelle) jusqu'a "Appliquer a l'image", qui commite toute la
 * session en un seul geste annulable (Ctrl+Z dans PixInsight, via
 * View.beginProcess(UndoFlag.PixelData)/endProcess() + Image.assign() --
 * ne touche ni le format du fichier, ni les FITS keywords, ni la solution
 * astrometrique).
 *
 * Degrade (parametre demande explicitement): un trait de pinceau est une
 * union de "dabs" circulaires le long du trace. Chaque dab a une alpha qui
 * vaut 1 jusqu'a un rayon interieur, puis retombe vers 0 en suivant une
 * smoothstep (3t^2-2t^3) jusqu'au rayon plein -- exactement la notion de
 * "Hardness" de Photoshop, mais exposee ici comme "Degrade" (0% = bord net,
 * donc equivalent a Hardness=100%; 100% = degrade maximal / pinceau tres
 * doux, equivalent a Hardness=0%) pour coller au mot choisi par
 * l'utilisateur plutot qu'a la convention anglaise.
 *
 * Opacite plafonnee PAR TRAIT, pas par dab: a l'interieur d'un seul trait
 * continu (appui -> relachement), l'alpha de chaque pixel est le MAX de
 * tous les dabs qui le recouvrent (pas une somme) -- deux dabs qui se
 * chevauchent dans le meme trait ne foncent donc jamais plus que l'opacite
 * choisie, exactement le comportement du curseur "Opacity" de Photoshop
 * (par opposition a "Flow", qu'on ne cherche pas a reproduire ici). Deux
 * traits SEPARES (deux appuis differents), eux, s'accumulent normalement --
 * repasser plusieurs fois fonce le trait, comme dans Photoshop.
 *
 * Tout le calcul qui touche reellement les pixels commis (rasterisation du
 * trait + mix couleur/opacite) est fait a la main sur des Float64Array
 * (meme technique que applyBlend() de HaloRemoverPI.js et
 * iastampRasterizeMask() de IAStamp.js) -- PAS via les modes de composition
 * natifs de Graphics/Bitmap, dont le comportement exact en presence d'alpha
 * non pre-multiplie n'est pas assez documente pour qu'on lui fasse confiance
 * sur des donnees qui comptent. Graphics/Bitmap ne servent qu'a l'AFFICHAGE
 * (l'anneau de curseur, l'apercu du trait en cours) -- purement cosmetique,
 * jamais commite tel quel.
 *
 * Couleur: via SimpleColorDialog (fourni par PixInsight, pjsr/controls/
 * SimpleColorDialog.js -- verifie directement dans son propre code source
 * avant usage). Sur une image mono, le dialogue est force en mode
 * "grayscale" (une seule valeur R=G=B) pour eviter toute conversion
 * luminance implicite et surprenante.
 *
 * Pas de gomme dans cette premiere version -- non demande, et une gomme
 * "propre" demanderait une copie pristine separee de l'image (pour savoir
 * vers quoi revenir) qui n'a pas de raison d'exister tant que ce n'est pas
 * demande. "Reinitialiser" (retour a l'image d'origine, tout court) couvre
 * le cas "je me suis loupe", et "Annuler le dernier trait" est un
 * historique multi-niveaux (contrairement au simple "un seul niveau" de
 * HaloRemoverPI/IAStamp -- chaque trait ne coute qu'un petit tampon limite
 * a sa boite englobante, donc empiler tout l'historique de la session est
 * bon marche).
 */

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

#define SETTINGS_PREFIX "PixInk/"
#define VIEWPORT_W       900
#define VIEWPORT_H       620
#define MIN_SCALE        0.02
#define MAX_SCALE        8
#define ZOOM_STEP        1.25
#define MIN_SIZE_PX      2
#define MAX_SIZE_PX      800
#define DEFAULT_SIZE_PX  40
#define DEFAULT_OPACITY  100
#define DEFAULT_DEGRADE  35
#define DEFAULT_COLOR    0xffffffff
#define STF_SHADOWS_CLIP -1.25
#define STF_TARGET_BKG    0.25

// ============================================================================
// Persisted settings (brush defaults only -- same helper pattern as
// hrpiLoadSetting/hrpiSaveSetting in HaloRemoverPI.js, generalized to numeric
// types via Settings.lastReadOK instead of the string-length check that only
// worked for strings).
// ============================================================================

function pinkLoadSetting( key, dataType, defaultValue )
{
   var v = Settings.read( SETTINGS_PREFIX + key, dataType );
   return Settings.lastReadOK ? v : defaultValue;
}

function pinkSaveSetting( key, dataType, value )
{
   Settings.write( SETTINGS_PREFIX + key, dataType, value );
}

// ============================================================================
// Stroke rasterization -- image-space {x,y} points (a whole click-to-release
// drag), one fixed radius/hardness per stroke -> a Float64Array alpha buffer
// over the stroke's own bounding box. See top-of-file note: this is the ONLY
// math that matters for the committed pixels, done by hand on purpose.
// ============================================================================

function pinkStrokeBBox( points, radius, imgW, imgH )
{
   var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
   for ( var i = 0; i < points.length; ++i )
   {
      var p = points[i];
      minX = Math.min( minX, p.x - radius ); maxX = Math.max( maxX, p.x + radius );
      minY = Math.min( minY, p.y - radius ); maxY = Math.max( maxY, p.y + radius );
   }
   var x0 = Math.max( 0, Math.floor( minX ) ), y0 = Math.max( 0, Math.floor( minY ) );
   var x1 = Math.min( imgW, Math.ceil( maxX ) + 1 ), y1 = Math.min( imgH, Math.ceil( maxY ) + 1 );
   return new Rect( x0, y0, x1, y1 );
}

// hardness in [0,1]: 1 = bord net (disque plein), 0 = degrade complet sur
// tout le rayon. Smoothstep entre le rayon interieur et le rayon plein --
// continue et sans anneau dur, comme le pinceau rond doux de Photoshop.
function pinkRasterizeStrokeAlpha( points, radius, hardness, rect )
{
   var w = rect.width, h = rect.height;
   var alpha = new Float64Array( w * h );
   var innerR = hardness * radius;
   var span = radius - innerR;

   for ( var i = 0; i < points.length; ++i )
   {
      var p = points[i];
      var lx = p.x - rect.x0, ly = p.y - rect.y0;
      var xMin = Math.max( 0, Math.floor( lx - radius ) ), xMax = Math.min( w - 1, Math.ceil( lx + radius ) );
      var yMin = Math.max( 0, Math.floor( ly - radius ) ), yMax = Math.min( h - 1, Math.ceil( ly + radius ) );

      for ( var y = yMin; y <= yMax; ++y )
      {
         var dy = y - ly, row = y * w;
         for ( var x = xMin; x <= xMax; ++x )
         {
            var dx = x - lx;
            var dist = Math.sqrt( dx * dx + dy * dy );
            if ( dist > radius ) continue;

            var a;
            if ( dist <= innerR )
               a = 1;
            else if ( span < 1.0e-6 )
               a = 1; // hardness ~1 with radius==innerR -- disque plein jusqu'au bord
            else
            {
               var t = ( dist - innerR ) / span;
               a = 1 - ( 3 * t * t - 2 * t * t * t );
            }

            var idx = row + x;
            if ( a > alpha[idx] ) alpha[idx] = a; // MAX, pas somme -- voir note opacite plafonnee
         }
      }
   }
   return alpha;
}

// ============================================================================
// Auto STF -- for DISPLAY ONLY (never touches the working copy's real
// samples). Ported from the same already-verified AutoStretch.js algorithm
// HaloRemoverPI.js's hrpiCalculateStretch()/hrpiFindMidtonesBalance() use
// (itself ported faithfully from PixInsight's own bundled AutoStretch.js,
// see that script's own top-of-file note for the debugging history behind
// picking this exact formula) -- not re-derived here, generalized to take
// an explicit channel index so it also works per-channel on color images
// (HaloRemoverPI.js only ever needed channel 0, mono-only by design).
// ============================================================================

function pinkFindMidtonesBalance( v0, v1, eps )
{
   if ( v1 <= 0 ) return 0;
   if ( v1 >= 1 ) return 1;
   v0 = Math.range( v0, 0.0, 1.0 );
   eps = eps ? Math.max( 1.0e-15, eps ) : 5.0e-05;

   var m0, m1;
   if ( v1 < v0 ) { m0 = 0; m1 = 0.5; }
   else { m0 = 0.5; m1 = 1; }

   for ( ;; )
   {
      var m = ( m0 + m1 ) / 2;
      var v = Math.mtf( m, v1 );
      if ( Math.abs( v - v0 ) < eps ) return m;
      if ( v < v0 ) m1 = m; else m0 = m;
   }
}

function pinkCalculateStretch( image, channel )
{
   image.resetSelections();
   image.selectedChannel = channel;
   var median = image.median();
   var avgDev = image.avgDev();
   image.resetSelections();
   var c0 = Math.range( median + STF_SHADOWS_CLIP * avgDev, 0.0, 1.0 );
   var m = pinkFindMidtonesBalance( STF_TARGET_BKG, median - c0 );
   return { m: m, c0: c0, c1: 1 };
}

// Unlinked per-channel stretch on color images (each of R/G/B gets its own
// row -- rows 0,1,2 of HistogramTransformation.H), a single stretch on the
// RGB/K row (index 3) for mono -- same convention HaloRemoverPI.js verified
// against PixInsight's own AutoStretch.js: R/G/B rows apply independently,
// THEN the RGB/K row applies to all channels together, so leaving RGB/K at
// identity when R/G/B already carry the real stretch composes correctly.
function pinkRebuildPreview( dialog )
{
   var src = dialog.workingWindow.mainView.image;
   if ( !dialog.previewWindow )
      dialog.previewWindow = new ImageWindow( src.width, src.height, dialog.channelsCount, 32, true, dialog.isColorImage, "pixink_preview" );

   var v = dialog.previewWindow.mainView;
   v.beginProcess( UndoFlag.NoSwapFile );
   v.image.assign( src );
   v.endProcess();

   if ( dialog.stfEnabled )
   {
      var identityRow = [0, 0.5, 1, 0, 1];
      var rowR = identityRow, rowG = identityRow, rowB = identityRow, rowK = identityRow;
      var changed = false;

      if ( dialog.isColorImage )
      {
         var rows = [];
         for ( var c = 0; c < 3; ++c )
         {
            var s = null;
            try { s = pinkCalculateStretch( src, c ); } catch ( e ) { s = null; }
            if ( s && ( s.c0 > 0 || s.m != 0.5 || s.c1 != 1 ) ) { rows.push( [s.c0, s.m, s.c1, 0, 1] ); changed = true; }
            else rows.push( identityRow );
         }
         rowR = rows[0]; rowG = rows[1]; rowB = rows[2];
      }
      else
      {
         var s2 = null;
         try { s2 = pinkCalculateStretch( src, 0 ); } catch ( e ) { s2 = null; }
         if ( s2 && ( s2.c0 > 0 || s2.m != 0.5 || s2.c1 != 1 ) ) { rowK = [s2.c0, s2.m, s2.c1, 0, 1]; changed = true; }
      }

      if ( changed )
      {
         var HT = new HistogramTransformation;
         HT.H = [ rowR, rowG, rowB, rowK, identityRow ];
         HT.executeOn( v, false );
      }
   }

   return dialog.previewWindow.mainView.image;
}

// ============================================================================
// Color swatch: a small clickable control showing the current brush color,
// opening SimpleColorDialog on click. Same onPaint idiom as
// SimpleColorDialog.js's own sample_Control (read directly from that file
// before writing this).
// ============================================================================

var PinkColorSwatch = class extends Control
{
   constructor( parent, dialog )
   {
      super( parent );
      this.ownerDialog = dialog;
      this.setFixedSize( 28, 28 );
      this.cursor = new Cursor( StdCursor.PointingHand );
      this.toolTip = "Couleur du pinceau -- clique pour changer.";

      this.onPaint = () =>
      {
         var g = new Graphics( this );
         g.pen = new Pen( 0xff808080 );
         g.brush = new Brush( this.ownerDialog.brushColor | 0xff000000 );
         g.drawRect( 0, 0, this.width - 1, this.height - 1 );
         g.end();
      };

      this.onMousePress = () =>
      {
         var d = new SimpleColorDialog( this.ownerDialog.brushColor, this.ownerDialog );
         d.alphaEnabled = false;
         d.grayscale = !this.ownerDialog.isColorImage;
         d.windowTitle = "Couleur du pinceau";
         if ( d.execute() )
         {
            this.ownerDialog.brushColor = d.color | 0xff000000;
            pinkSaveSetting( "brushColor", DataType.Uint32, this.ownerDialog.brushColor );
            this.update();
         }
      };
   }
};

// ============================================================================
// Paint viewport: scrollable/zoomable canvas showing the working image's
// current rendered pixels. Left-drag paints; mouse wheel zooms on the
// cursor; Ctrl+right-click-drag live-resizes the brush -- same mechanics as
// IAStamp.js's own StampViewport, generalized (continuous alpha instead of
// a binary mask, plus a live per-dab preview during the drag).
// ============================================================================

var PixInkViewport = class extends ScrollBox
{
   constructor( parent, dialog )
   {
      super( parent );
      this.ownerDialog = dialog;
      this.autoScroll = true;
      this.tracking = true;
      this.image = null;
      this.imgW = 0; this.imgH = 0;
      this.scale = 1;
      this.painting = false;
      this.currentStrokePoints = [];
      this.currentStrokeSnapshot = null;
      this.resizingBrush = false;
      this.resizeStartX = 0;
      this.resizeStartSize = 0;
      this.hovering = false;
      this.hoverX = 0; this.hoverY = 0;
      this._cachedBitmap = null;
      this.scrollPosition = new Point( 0, 0 );

      this.setFixedSize( VIEWPORT_W, VIEWPORT_H );
      this.viewport.cursor = new Cursor( StdCursor.Cross );
      this.viewport.mouseTracking = true;

      this.viewport.onResize = () => { this.updateScrollRange(); };
      this.onHorizontalScrollPosUpdated = () => { this.viewport.update(); };
      this.onVerticalScrollPosUpdated   = () => { this.viewport.update(); };

      this.viewport.onMousePress = ( x, y, button, buttons, modifiers ) =>
      {
         if ( button === 2 && ( modifiers & 4 ) ) // Ctrl + right button
         {
            this.resizingBrush = true;
            this.resizeStartX = x;
            this.resizeStartSize = this.ownerDialog.sizeControl.value;
            return;
         }
         if ( button !== 1 ) return; // left button only
         this.painting = true;
         this.currentStrokePoints = [];
         this.currentStrokeSnapshot = this.ownerDialog.currentBrushSnapshot();
         this.addStrokePoint( x, y );
      };

      this.viewport.onMouseMove = ( x, y, buttons, modifiers ) =>
      {
         this.hovering = true;
         this.hoverX = x; this.hoverY = y;
         if ( this.resizingBrush )
         {
            var delta = ( x - this.resizeStartX ) / this.scale;
            var newSize = Math.max( MIN_SIZE_PX, Math.min( MAX_SIZE_PX, Math.round( this.resizeStartSize + delta ) ) );
            this.ownerDialog.sizeControl.setValue( newSize );
            this.viewport.update();
            return;
         }
         if ( this.painting )
            this.addStrokePoint( x, y );
         else
            this.viewport.update();
      };

      this.viewport.onMouseRelease = ( x, y, button, buttons, modifiers ) =>
      {
         if ( button === 2 ) { this.resizingBrush = false; return; }
         if ( button !== 1 ) return;
         if ( this.painting )
         {
            this.painting = false;
            this.ownerDialog.commitStroke( this.currentStrokePoints, this.currentStrokeSnapshot );
            this.currentStrokePoints = [];
            this.currentStrokeSnapshot = null;
         }
      };

      this.viewport.onEnter = () => { this.hovering = true; };
      this.viewport.onLeave = () => { this.hovering = false; this.viewport.update(); };

      this.viewport.onMouseWheel = ( x, y, delta, buttons, modifiers ) =>
      {
         var factor = ( delta > 0 ) ? 1 / ZOOM_STEP : ZOOM_STEP;
         this.setScale( this.scale * factor, new Point( x, y ) );
      };

      this.viewport.onPaint = ( x0, y0, x1, y1 ) =>
      {
         var g = new Graphics( this.viewport );
         g.fillRect( x0, y0, x1, y1, new Brush( 0xff202020 ) );
         if ( this.image )
         {
            if ( !this._cachedBitmap )
               this._cachedBitmap = this.image.render( 1, false );

            g.scaleTransformation( this.scale );
            g.translateTransformation( -this.scrollPosition.x / this.scale, -this.scrollPosition.y / this.scale );
            g.drawBitmap( 0, 0, this._cachedBitmap );
            g.resetTransformation();

            this.drawOverlay( g );
         }
         g.end();
      };
   }

   screenToImage( sx, sy )
   {
      return { x: (sx + this.scrollPosition.x) / this.scale, y: (sy + this.scrollPosition.y) / this.scale };
   }

   // Purely cosmetic: the current in-progress stroke (translucent dabs at
   // the chosen color/opacity) and a hollow ring at the current brush size
   // when just hovering. Never read back for the actual pixel commit.
   drawOverlay( g )
   {
      var painting = this.painting && this.currentStrokePoints.length > 0;
      var showHoverRing = this.hovering && !this.painting && !this.resizingBrush;
      if ( !painting && !showHoverRing ) return;

      if ( painting )
      {
         var snap = this.currentStrokeSnapshot;
         var previewAlpha = Math.round( Math.max( 0.08, snap.opacity ) * 255 );
         var previewColor = ( snap.color & 0x00ffffff ) | ( previewAlpha << 24 );

         var maskBmp = new Bitmap( this.viewport.width, this.viewport.height );
         maskBmp.fill( 0x00000000 );
         var mg = new Graphics( maskBmp );
         mg.antialiasing = true;
         mg.pen = new Pen( 0x00000000 );
         mg.brush = new Brush( previewColor );
         mg.scaleTransformation( this.scale );
         mg.translateTransformation( -this.scrollPosition.x / this.scale, -this.scrollPosition.y / this.scale );
         for ( var i = 0; i < this.currentStrokePoints.length; ++i )
         {
            var p = this.currentStrokePoints[i];
            mg.fillCircle( p.x, p.y, snap.radius );
         }
         mg.end();
         g.drawBitmap( 0, 0, maskBmp );
      }

      if ( showHoverRing )
      {
         var radius = this.ownerDialog.sizeControl.value / 2;
         var hardness = 1 - this.ownerDialog.degradeControl.value / 100;
         var p = this.screenToImage( this.hoverX, this.hoverY );
         g.antialiasing = true;
         g.scaleTransformation( this.scale );
         g.translateTransformation( -this.scrollPosition.x / this.scale, -this.scrollPosition.y / this.scale );
         g.pen = new Pen( 0xffffe040, 1 );
         g.drawCircle( p.x, p.y, radius );
         if ( hardness > 0.02 && hardness < 0.98 )
         {
            g.pen = new Pen( 0x90ffe040, 1 );
            g.drawCircle( p.x, p.y, radius * hardness );
         }
         g.resetTransformation();
      }
   }

   addStrokePoint( screenX, screenY )
   {
      var p = this.screenToImage( screenX, screenY );
      var radius = this.currentStrokeSnapshot.radius;
      var last = this.currentStrokePoints[this.currentStrokePoints.length - 1];
      if ( last )
      {
         var dx = p.x - last.x, dy = p.y - last.y;
         if ( dx * dx + dy * dy < ( radius * 0.25 ) * ( radius * 0.25 ) )
            return; // throttle -- avoid thousands of near-identical points on a slow drag
      }
      this.currentStrokePoints.push( { x: p.x, y: p.y } );
      this.viewport.update();
   }

   updateScrollRange()
   {
      var contentW = this.imgW * this.scale, contentH = this.imgH * this.scale;
      var maxX = Math.max( 0, Math.round( contentW - this.viewport.width ) );
      var maxY = Math.max( 0, Math.round( contentH - this.viewport.height ) );
      this.setHorizontalScrollRange( 0, maxX );
      this.setVerticalScrollRange( 0, maxY );
      this.scrollPosition = new Point(
         Math.max( 0, Math.min( this.scrollPosition.x, maxX ) ),
         Math.max( 0, Math.min( this.scrollPosition.y, maxY ) )
      );
   }

   setScale( newScale, refPoint )
   {
      newScale = Math.max( MIN_SCALE, Math.min( MAX_SCALE, newScale ) );
      if ( Math.abs( newScale - this.scale ) < 1e-6 ) return;
      if ( !refPoint ) refPoint = new Point( this.viewport.width / 2, this.viewport.height / 2 );
      var anchor = this.screenToImage( refPoint.x, refPoint.y );
      this.scale = newScale;
      this.updateScrollRange();
      this.scrollPosition = new Point( anchor.x * this.scale - refPoint.x, anchor.y * this.scale - refPoint.y );
      this.updateScrollRange();
      this.viewport.update();
   }

   zoomIn()  { this.setScale( this.scale * ZOOM_STEP ); }
   zoomOut() { this.setScale( this.scale / ZOOM_STEP ); }
   zoomToFit() { this.setScale( Math.min( 1, VIEWPORT_W / this.imgW, VIEWPORT_H / this.imgH ) ); }

   refreshBitmap()
   {
      this._cachedBitmap = null;
      this.viewport.update();
   }

   setImage( image, imgW, imgH )
   {
      this.image = image;
      this.imgW = imgW; this.imgH = imgH;
      this._cachedBitmap = null;
      this.scrollPosition = new Point( 0, 0 );
      this.zoomToFit();
   }
};

// ============================================================================
// Main dialog
// ============================================================================

var PixInkDialog = class extends Dialog
{
   constructor()
   {
      super();
      this.windowTitle = "PixInk -- Pinceau";

      var window = ImageWindow.activeWindow;
      if ( window.isNull )
         throw new Error( "Aucune image active. Ouvre une image dans PixInsight d'abord." );
      this.view = ( window.currentView && !window.currentView.isNull ) ? window.currentView : window.mainView;
      var img = this.view.image;

      this.isColorImage = img.isColor;
      this.channelsCount = this.isColorImage ? 3 : 1;

      // Working copy -- every stroke lands here only, never the real view,
      // until "Appliquer a l'image" (see top-of-file note).
      this.workingWindow = new ImageWindow( img.width, img.height, this.channelsCount, 32, true, this.isColorImage, "pixink_working" );
      this.workingWindow.mainView.beginProcess( UndoFlag.NoSwapFile );
      this.workingWindow.mainView.image.assign( img );
      this.workingWindow.mainView.endProcess();

      this.undoStack = []; // [{ rect, channels: [Float64Array,...] }, ...] -- pre-stroke snapshots, one entry per stroke
      this.previewWindow = null; // lazily created by pinkRebuildPreview() -- display only, never the committed data

      this.brushColor   = pinkLoadSetting( "brushColor",   DataType.Uint32, DEFAULT_COLOR );
      this.brushSize    = pinkLoadSetting( "brushSize",    DataType.Double, DEFAULT_SIZE_PX );
      this.brushOpacity = pinkLoadSetting( "brushOpacity", DataType.Double, DEFAULT_OPACITY );
      this.brushDegrade = pinkLoadSetting( "brushDegrade", DataType.Double, DEFAULT_DEGRADE );
      this.stfEnabled   = pinkLoadSetting( "stfEnabled",   DataType.Boolean, true );

      // -- new-instance / execute icons -- same standard icons and bottom-left
      // placement as PixInsight's own bundled scripts (e.g. Toolbox/
      // GraXpertDenoise.js's newInstanceButton/ok_Button) and as
      // HaloRemoverPI.js's own configSizer.
      this.newInstanceButton = new ToolButton( this );
      this.newInstanceButton.icon = this.scaledResource( ":/process-interface/new-instance.png" );
      this.newInstanceButton.setScaledFixedSize( 24, 24 );
      this.newInstanceButton.toolTip = "Glisser vers l'espace de travail pour creer une icone de processus (memorise les reglages du pinceau).";
      this.newInstanceButton.onMousePress = () =>
      {
         this.exportParameters();
         this.newInstance();
      };

      this.executeButton = new ToolButton( this );
      this.executeButton.icon = this.scaledResource( ":/process-interface/execute.png" );
      this.executeButton.setScaledFixedSize( 24, 24 );
      this.executeButton.enabled = false;
      this.executeButton.toolTip = "Appliquer a l'image (identique au bouton \"Appliquer a l'image\").";
      this.executeButton.onClick = () => { this.applyToImage(); };

      // -- brush controls row -------------------------------------------------
      this.colorSwatch = new PinkColorSwatch( this, this );

      this.sizeControl = new NumericControl( this );
      this.sizeControl.label.text = "Taille (diam. px):";
      this.sizeControl.setRange( MIN_SIZE_PX, MAX_SIZE_PX );
      this.sizeControl.slider.setRange( MIN_SIZE_PX, MAX_SIZE_PX );
      this.sizeControl.setPrecision( 0 );
      this.sizeControl.setValue( this.brushSize );
      this.sizeControl.toolTip = "Diametre du pinceau, en pixels image. Ctrl + clic droit + glisser sur l'image: reglage rapide.";
      this.sizeControl.onValueUpdated = ( value ) => { this.brushSize = value; pinkSaveSetting( "brushSize", DataType.Double, value ); this.viewport.viewport.update(); };

      this.opacityControl = new NumericControl( this );
      this.opacityControl.label.text = "Opacite (%):";
      this.opacityControl.setRange( 1, 100 );
      this.opacityControl.slider.setRange( 1, 100 );
      this.opacityControl.setPrecision( 0 );
      this.opacityControl.setValue( this.brushOpacity );
      this.opacityControl.toolTip = "Opacite maximale d'UN trait continu -- repasser sur un trait deja leve fonce a nouveau (comme Photoshop).";
      this.opacityControl.onValueUpdated = ( value ) => { this.brushOpacity = value; pinkSaveSetting( "brushOpacity", DataType.Double, value ); };

      this.degradeControl = new NumericControl( this );
      this.degradeControl.label.text = "Degrade (%):";
      this.degradeControl.setRange( 0, 100 );
      this.degradeControl.slider.setRange( 0, 100 );
      this.degradeControl.setPrecision( 0 );
      this.degradeControl.setValue( this.brushDegrade );
      this.degradeControl.toolTip = "0% = bord net, 100% = degrade maximal sur tout le rayon (equivalent a l'inverse de \"Hardness\" dans Photoshop).";
      this.degradeControl.onValueUpdated = ( value ) => { this.brushDegrade = value; pinkSaveSetting( "brushDegrade", DataType.Double, value ); this.viewport.viewport.update(); };

      this.zoomOutButton = new ToolButton( this );
      this.zoomOutButton.text = "-";
      this.zoomOutButton.toolTip = "Zoom arriere (ou molette)";
      this.zoomOutButton.onClick = () => { this.viewport.zoomOut(); };

      this.zoomFitButton = new ToolButton( this );
      this.zoomFitButton.text = "Ajuster";
      this.zoomFitButton.onClick = () => { this.viewport.zoomToFit(); };

      this.zoomInButton = new ToolButton( this );
      this.zoomInButton.text = "+";
      this.zoomInButton.toolTip = "Zoom avant (ou molette)";
      this.zoomInButton.onClick = () => { this.viewport.zoomIn(); };

      this.stfCheckBox = new CheckBox( this );
      this.stfCheckBox.text = "STF auto";
      this.stfCheckBox.checked = this.stfEnabled;
      this.stfCheckBox.toolTip = "Auto-stretch pour l'affichage seulement -- ne change aucune donnee reelle, meme une fois \"Appliquer a l'image\" utilise.";
      this.stfCheckBox.onCheck = ( checked ) =>
      {
         this.stfEnabled = checked;
         pinkSaveSetting( "stfEnabled", DataType.Boolean, checked );
         this.refreshPreview();
      };

      var toolsSizer = new HorizontalSizer;
      toolsSizer.spacing = 8;
      toolsSizer.add( this.colorSwatch );
      toolsSizer.addSpacing( 4 );
      toolsSizer.add( this.sizeControl, 100 );
      toolsSizer.addSpacing( 8 );
      toolsSizer.add( this.opacityControl, 100 );
      toolsSizer.addSpacing( 8 );
      toolsSizer.add( this.degradeControl, 100 );
      toolsSizer.addSpacing( 12 );
      toolsSizer.add( this.stfCheckBox );
      toolsSizer.addSpacing( 12 );
      toolsSizer.add( this.zoomOutButton );
      toolsSizer.add( this.zoomFitButton );
      toolsSizer.add( this.zoomInButton );

      // -- viewport ------------------------------------------------------------
      this.viewport = new PixInkViewport( this, this );
      this.viewport.setImage( pinkRebuildPreview( this ), img.width, img.height );

      var helpLabel = new Label( this );
      helpLabel.text = "Glisser (bouton gauche) pour peindre -- molette: zoom -- Ctrl + clic droit + glisser: taille du pinceau.";
      helpLabel.styleSheet = "color: #a0a0a0;";

      // -- status + action buttons ----------------------------------------------
      this.statusLabel = new Label( this );
      this.statusLabel.text = this.isColorImage ?
         "Image couleur -- le pinceau peint en RVB." :
         "Image mono -- le pinceau peint en niveaux de gris.";
      this.statusLabel.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;
      this.statusLabel.wordWrapping = true;

      this.undoButton = new PushButton( this );
      this.undoButton.text = "Annuler le dernier trait";
      this.undoButton.enabled = false;
      this.undoButton.onClick = () => { this.undoLastStroke(); };

      this.resetButton = new PushButton( this );
      this.resetButton.text = "Reinitialiser";
      this.resetButton.enabled = false;
      this.resetButton.toolTip = "Revient a l'image d'origine -- efface tous les traits de cette session (rien n'est encore applique de toute facon).";
      this.resetButton.onClick = () => { this.resetWorkingCopy(); };

      this.applyButton = new PushButton( this );
      this.applyButton.text = "Appliquer a l'image";
      this.applyButton.enabled = false;
      this.applyButton.toolTip = "Valide tous les traits de cette session sur l'image reelle, en un seul geste annulable (Ctrl+Z dans PixInsight).";
      this.applyButton.onClick = () => { this.applyToImage(); };

      this.closeButton = new PushButton( this );
      this.closeButton.text = "Fermer";
      this.closeButton.onClick = () => { this.closeDialog(); };

      var actionSizer = new HorizontalSizer;
      actionSizer.spacing = 4;
      actionSizer.add( this.newInstanceButton );
      actionSizer.add( this.executeButton );

      var bottomSizer = new HorizontalSizer;
      bottomSizer.spacing = 6;
      bottomSizer.add( actionSizer );
      bottomSizer.addSpacing( 12 );
      bottomSizer.add( this.statusLabel, 100 );
      bottomSizer.add( this.undoButton );
      bottomSizer.add( this.resetButton );
      bottomSizer.add( this.applyButton );
      bottomSizer.add( this.closeButton );

      this.sizer = new VerticalSizer;
      this.sizer.margin = 8;
      this.sizer.spacing = 6;
      this.sizer.add( toolsSizer );
      this.sizer.add( this.viewport );
      this.sizer.add( helpLabel );
      this.sizer.add( bottomSizer );

      this.importParameters();
      this.adjustToContents();
   }

   exportParameters()
   {
      Parameters.set( "brushColor", this.brushColor );
      Parameters.set( "brushSize", this.brushSize );
      Parameters.set( "brushOpacity", this.brushOpacity );
      Parameters.set( "brushDegrade", this.brushDegrade );
      Parameters.set( "stfEnabled", this.stfEnabled );
   }

   importParameters()
   {
      if ( Parameters.has( "brushColor" ) ) { this.brushColor = Parameters.getUInt( "brushColor" ) | 0xff000000; this.colorSwatch.update(); }
      if ( Parameters.has( "brushSize" ) ) this.sizeControl.setValue( Parameters.getReal( "brushSize" ) );
      if ( Parameters.has( "brushOpacity" ) ) this.opacityControl.setValue( Parameters.getReal( "brushOpacity" ) );
      if ( Parameters.has( "stfEnabled" ) )
      {
         var imported = Parameters.getBoolean( "stfEnabled" );
         if ( imported !== this.stfEnabled )
         {
            this.stfEnabled = imported;
            this.refreshPreview();
         }
         this.stfCheckBox.checked = this.stfEnabled;
      }
      if ( Parameters.has( "brushDegrade" ) ) this.degradeControl.setValue( Parameters.getReal( "brushDegrade" ) );
   }

   // Frozen at stroke start (mouse press), same value used for every dab of
   // that stroke and for its final commit -- changing a slider mid-drag
   // (not really reachable from the UI anyway) never retroactively changes
   // an in-progress stroke, matching how a real brush tool behaves.
   currentBrushSnapshot()
   {
      var color = this.brushColor;
      return {
         color: color,
         colorComponents: this.isColorImage
            ? [ Color.red( color ) / 255, Color.green( color ) / 255, Color.blue( color ) / 255 ]
            : [ Color.red( color ) / 255 ],
         radius: this.sizeControl.value / 2,
         hardness: 1 - this.degradeControl.value / 100,
         opacity: this.opacityControl.value / 100
      };
   }

   commitStroke( points, snapshot )
   {
      if ( !points || points.length === 0 ) return;
      var image = this.workingWindow.mainView.image;
      var rect = pinkStrokeBBox( points, snapshot.radius, image.width, image.height );
      if ( rect.width <= 0 || rect.height <= 0 ) return;

      var alpha = pinkRasterizeStrokeAlpha( points, snapshot.radius, snapshot.hardness, rect );
      var opacity = snapshot.opacity;
      var n = rect.width * rect.height;
      var preChannels = [];

      this.workingWindow.mainView.beginProcess( UndoFlag.NoSwapFile );
      try
      {
         for ( var c = 0; c < this.channelsCount; ++c )
         {
            var dst = new Float64Array( n );
            image.getSamples( dst, rect, c );
            preChannels.push( dst.slice() ); // pre-stroke snapshot, for undo

            var comp = snapshot.colorComponents[c];
            var out = new Float64Array( n );
            for ( var i = 0; i < n; ++i )
            {
               var a = alpha[i] * opacity;
               out[i] = comp * a + dst[i] * ( 1 - a );
            }
            image.setSamples( out, rect, c );
         }
      }
      finally { this.workingWindow.mainView.endProcess(); }

      this.undoStack.push( { rect: rect, channels: preChannels } );
      this.statusLabel.text = "Traits: " + this.undoStack.length + ". \"Appliquer a l'image\" quand c'est bon.";
      this.updateActionButtons();
      this.refreshPreview();
   }

   undoLastStroke()
   {
      var entry = this.undoStack.pop();
      if ( !entry ) return;
      var image = this.workingWindow.mainView.image;
      this.workingWindow.mainView.beginProcess( UndoFlag.NoSwapFile );
      try
      {
         for ( var c = 0; c < this.channelsCount; ++c )
            image.setSamples( entry.channels[c], entry.rect, c );
      }
      finally { this.workingWindow.mainView.endProcess(); }

      this.statusLabel.text = "Dernier trait annule. Traits restants: " + this.undoStack.length + ".";
      this.updateActionButtons();
      this.refreshPreview();
   }

   resetWorkingCopy()
   {
      this.workingWindow.mainView.beginProcess( UndoFlag.NoSwapFile );
      try { this.workingWindow.mainView.image.assign( this.view.image ); }
      finally { this.workingWindow.mainView.endProcess(); }

      this.undoStack = [];
      this.statusLabel.text = "Reinitialise a l'image d'origine.";
      this.updateActionButtons();
      this.refreshPreview();
   }

   applyToImage()
   {
      this.view.beginProcess( UndoFlag.PixelData );
      try { this.view.image.assign( this.workingWindow.mainView.image ); }
      finally { this.view.endProcess(); }

      this.undoStack = [];
      this.statusLabel.text = "Applique a l'image (Ctrl+Z dans PixInsight pour tout annuler d'un coup).";
      this.updateActionButtons();
   }

   updateActionButtons()
   {
      var has = this.undoStack.length > 0;
      this.undoButton.enabled = has;
      this.resetButton.enabled = has;
      this.applyButton.enabled = has;
      this.executeButton.enabled = has;
   }

   // STF is display-only (see pinkRebuildPreview()'s own note) -- rebuilds
   // the preview window's stretched pixels from the working copy's current
   // (real, unstretched) data and points the viewport at it.
   refreshPreview()
   {
      this.viewport.image = pinkRebuildPreview( this );
      this.viewport.refreshBitmap();
   }

   closeDialog()
   {
      if ( this.applyButton.enabled )
      {
         var mb = new MessageBox(
            "Des traits n'ont pas ete appliques a l'image. Fermer quand meme et les perdre ?",
            "PixInk", StdIcon.Warning, StdButton.Yes, StdButton.No
         );
         if ( mb.execute() !== StdButton.Yes )
            return;
      }
      this.workingWindow.forceClose();
      if ( this.previewWindow ) this.previewWindow.forceClose();
      this.ok();
   }
};

function pinkMain()
{
   try
   {
      var dialog = new PixInkDialog;
      dialog.execute();
   }
   catch ( e )
   {
      new MessageBox( String( e.message || e ), "PixInk", StdIcon.Error, StdButton.Ok ).execute();
   }
}

pinkMain();
