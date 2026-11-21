/*
   SpectralStarMix.js
   ------------------
   Script PixInsight (PJSR) : recompose une image d'etoiles couleur a partir de 1 a 7
   couches monochromes "etoiles seules" LRVBSHO (Luminance, Rouge, Vert, Bleu,
   SII, Halpha, OIII) issues de la session en cours.

   Regle de melange
   -----------------
   1) Poids couleur par couche : les etoiles ont un spectre quasi continu (corps
      noir), contrairement aux nebuleuses. On modelise donc la bande passante de
      chaque couche par une gaussienne (centree sur la longueur d'onde renseignee,
      largeur = FWHM renseignee), on la moyenne (pas integrale brute, pour rester
      independant de la largeur de bande) contre les fonctions colorimetriques CIE
      1931 (approximation analytique multi-lobes de Wyman, Sloan & Shirley, "Simple
      Analytic Approximations to the CIE XYZ Color Matching Functions", JCGT 2(2)
      2013, code de reference MIT - https://jcgt.org/published/0002/02/01/), puis on
      convertit le XYZ moyen en RVB lineaire (matrice sRGB/D65 standard).

   2) Egalisation de niveaux : une couche etroite (Ha/OIII/SII) et une couche large
      (L/R/V/B) n'ont typiquement pas le meme "niveau" de signal (temps de pose,
      gain, largeur de bande physique...). Sans correction, la couche la plus forte
      dominerait la teinte finale independamment de son poids physique CIE. On
      recale donc chaque couche (hors reference) sur l'echelle d'une couche de
      reference via une regression lineaire robuste (equivalent maison de
      PixInsight LinearFit : cible' = a*cible + b, avec un passage de sigma-clipping
      pour ecarter les valeurs aberrantes), calculee par echantillonnage direct des
      pixels (pas de modification des images source : le recalage n'existe que dans
      l'expression PixelMath).

   3) Contribution artistique : un curseur par couche multiplie son poids (deja
      normalise physiquement) - 1 = poids naturel, 0 = couche exclue du melange,
      >1 = accentuation volontaire.

   4) Le compositage final est une combinaison lineaire par canal, executee via
      PixelMath (rapide, natif). L'image generee reste lineaire (non etiree) : elle
      est destinee a etre reinjectee telle quelle dans votre pipeline habituel.

   5) Saturation / vibrance : appliquees au RVB deja melange, avant l'etirement
      GHS eventuel. Saturation = gain constant (1 = inchange). Vibrance = gain
      adaptatif, plus fort sur les pixels deja peu satures (protege les etoiles
      deja tres colorees d'une sursaturation), 0 = inchange.

   6) Apercu : au lieu d'un auto-STF, l'apercu applique un etirement hyperbolique
      generalise (GHS, cf. David Payne / Mike Cranfield) a deux parametres
      seulement - "Amount" (= stretch factor, D = e^Amount - 1) et "Local intensity"
      (b, qui selectionne la famille de courbe : b=-1 logarithmique -> f(x) =
      ln(1+Dx)/ln(1+D), b=0 exponentielle, b=1 harmonique, b>0 hyperbolique, b<0
      integrale). Point de symetrie et zones de protection ne sont pas exposes ici
      (non demandes) : l'etirement part du point noir. Par defaut, l'image generee
      reste lineaire (non etiree) ; une case a cocher permet toutefois de cuire le
      meme etirement GHS dans l'image generee, si vous voulez une sortie deja
      prete a l'affichage/export plutot que lineaire.

   Limites connues : la justesse du rendu depend des (lambda, largeur) renseignes
   pour vos filtres reels ; l'apercu et l'egalisation de niveaux recalculent
   integralement le melange a chaque clic (pas de version basse-resolution) - donc
   potentiellement pas instantane sur de tres grandes images, d'autant plus si
   plusieurs couches doivent etre recalees (echantillonnage pixel par pixel).
*/

#feature-id    Utilities > SpectralStarMix

#feature-info  Melange 1 a 7 couches d'etoiles seules (L,R,V,B,SII,Ha,OIII) en une \
   image RVB, en ponderant chaque couche par son recouvrement spectral avec les \
   fonctions colorimetriques CIE 1931, avec egalisation de niveaux, contribution \
   par couche et apercu par etirement hyperbolique generalise (GHS).

#include <pjsr/Sizer.jsh>
#include <pjsr/FrameStyle.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/ColorSpace.jsh>
#include <pjsr/NumericControl.jsh>

// ---------------------------------------------------------------------------
// Couleur / spectre
// ---------------------------------------------------------------------------

// Approximation multi-lobes (Wyman, Sloan & Shirley 2013) des fonctions
// colorimetriques CIE 1931 2 degres. lambda en nanometres.
function cieXbar( lambda ) {
   var p1 = (lambda - 442.0) * ((lambda < 442.0) ? 0.0624 : 0.0374);
   var p2 = (lambda - 599.8) * ((lambda < 599.8) ? 0.0264 : 0.0323);
   var p3 = (lambda - 501.1) * ((lambda < 501.1) ? 0.0490 : 0.0382);
   return 0.362*Math.exp( -0.5*p1*p1 ) + 1.056*Math.exp( -0.5*p2*p2 ) - 0.065*Math.exp( -0.5*p3*p3 );
}

function cieYbar( lambda ) {
   var p1 = (lambda - 568.8) * ((lambda < 568.8) ? 0.0213 : 0.0247);
   var p2 = (lambda - 530.9) * ((lambda < 530.9) ? 0.0613 : 0.0322);
   return 0.821*Math.exp( -0.5*p1*p1 ) + 0.286*Math.exp( -0.5*p2*p2 );
}

function cieZbar( lambda ) {
   var p1 = (lambda - 437.0) * ((lambda < 437.0) ? 0.0845 : 0.0278);
   var p2 = (lambda - 459.0) * ((lambda < 459.0) ? 0.0385 : 0.0725);
   return 1.217*Math.exp( -0.5*p1*p1 ) + 0.681*Math.exp( -0.5*p2*p2 );
}

// Moyenne (ponderee par une gaussienne de largeur FWHM donnee) des fonctions
// colorimetriques sur la bande passante du filtre : le poids couleur d'un filtre
// est ainsi independant de sa largeur de bande.
function integrateBandXYZ( lambda0, fwhm ) {
   var sigma = Math.max( fwhm, 0.5 ) / 2.35482; // FWHM -> ecart-type gaussien
   var X = 0, Y = 0, Z = 0, Wsum = 0;
   for ( var wl = 380; wl <= 780; wl += 1 ) {
      var d = (wl - lambda0) / sigma;
      var T = Math.exp( -0.5*d*d );
      X += T * cieXbar( wl );
      Y += T * cieYbar( wl );
      Z += T * cieZbar( wl );
      Wsum += T;
   }
   if ( Wsum <= 1.0e-9 )
      Wsum = 1;
   return [ X/Wsum, Y/Wsum, Z/Wsum ];
}

// XYZ (D65) -> RVB lineaire sRGB, matrice standard IEC 61966-2-1.
function xyzToLinearSRGB( xyz ) {
   var X = xyz[0], Y = xyz[1], Z = xyz[2];
   return [
       3.2406*X - 1.5372*Y - 0.4986*Z,
      -0.9689*X + 1.8758*Y + 0.0415*Z,
       0.0557*X - 0.2040*Y + 1.0570*Z
   ];
}

// ---------------------------------------------------------------------------
// Egalisation de niveaux (equivalent maison de LinearFit)
// cible' = a*cible + b, cale sur l'echelle de la vue de reference, avec un
// passage de sigma-clipping pour ecarter les valeurs aberrantes (etoiles trop
// brillantes/saturees dans un seul canal, artefacts...).
// ---------------------------------------------------------------------------
function robustLinearFit( refView, targetView ) {
   if ( targetView.fullId == refView.fullId )
      return { a: 1, b: 0 };

   var refImg = refView.image, tgtImg = targetView.image;
   var w = refImg.width, h = refImg.height;
   var total = w*h;
   var nMax = 20000;
   var step = Math.max( 1, Math.floor( total/nMax ) );

   function collect( fit0 ) {
      var Sx = 0, Sy = 0, Sxx = 0, Sxy = 0, n = 0;
      for ( var idx = 0; idx < total; idx += step ) {
         var x = idx % w, y = Math.floor( idx/w );
         var rx = refImg.sample( x, y, 0 );
         var ty = tgtImg.sample( x, y, 0 );
         if ( fit0 ) {
            var res = ty - (fit0.a*rx + fit0.b);
            if ( Math.abs( res ) > fit0.threshold )
               continue;
         }
         Sx += rx; Sy += ty; Sxx += rx*rx; Sxy += rx*ty; ++n;
      }
      return { Sx: Sx, Sy: Sy, Sxx: Sxx, Sxy: Sxy, n: n };
   }

   function solve( s ) {
      var denom = s.n*s.Sxx - s.Sx*s.Sx;
      if ( s.n < 10 || Math.abs( denom ) < 1.0e-12 )
         return null;
      var a = (s.n*s.Sxy - s.Sx*s.Sy) / denom;
      var b = (s.Sy - a*s.Sx) / s.n;
      return { a: a, b: b };
   }

   var s1 = collect( null );
   var fit1 = solve( s1 );
   if ( !fit1 )
      return { a: 1, b: 0 };

   // estimation grossiere de l'ecart-type des residus, pour le sigma-clipping
   var sumSq = 0, n2 = 0;
   for ( var idx = 0; idx < total; idx += step ) {
      var x = idx % w, y = Math.floor( idx/w );
      var res = tgtImg.sample( x, y, 0 ) - (fit1.a*refImg.sample( x, y, 0 ) + fit1.b);
      sumSq += res*res; ++n2;
   }
   var sigma = Math.sqrt( sumSq / Math.max( 1, n2 ) );
   fit1.threshold = 3*sigma;

   var s2 = collect( fit1 );
   var fit2 = solve( s2 );
   return fit2 || fit1;
}

// ---------------------------------------------------------------------------
// Poids de melange
// ---------------------------------------------------------------------------
function buildWeights( channels, opts ) {
   var active = [];
   for ( var i = 0; i < channels.length; ++i )
      if ( channels[i].view && !channels[i].view.isNull )
         active.push( channels[i] );
   if ( active.length == 0 )
      return null;

   var refChannel = null;
   if ( opts.equalize ) {
      for ( var i = 0; i < active.length; ++i )
         if ( active[i].key == opts.referenceKey ) { refChannel = active[i]; break; }
      if ( !refChannel )
         refChannel = active[0];
   }

   var weights = [];
   var Ysum = 0;
   for ( var i = 0; i < active.length; ++i ) {
      var ch = active[i];
      var xyz = integrateBandXYZ( ch.lambda, ch.fwhm );
      var rgb = xyzToLinearSRGB( xyz );
      var fit = { a: 1, b: 0 };
      if ( opts.equalize && ch !== refChannel )
         fit = robustLinearFit( refChannel.view, ch.view );
      weights.push( { key: ch.key, id: ch.view.fullId, view: ch.view,
                      R: rgb[0], G: rgb[1], B: rgb[2], Y: xyz[1],
                      fitA: fit.a, fitB: fit.b, contribution: ch.contribution } );
      Ysum += xyz[1];
   }
   if ( Ysum <= 1.0e-9 )
      Ysum = 1;
   for ( var i = 0; i < weights.length; ++i ) {
      weights[i].R = weights[i].R / Ysum * weights[i].contribution;
      weights[i].G = weights[i].G / Ysum * weights[i].contribution;
      weights[i].B = weights[i].B / Ysum * weights[i].contribution;
   }
   return weights;
}

function buildExpr( weights, component ) {
   var terms = [];
   for ( var i = 0; i < weights.length; ++i ) {
      var w = weights[i][component];
      if ( Math.abs( w ) < 1.0e-6 )
         continue;
      var a = weights[i].fitA, b = weights[i].fitB, id = weights[i].id;
      var inner = (Math.abs( a - 1 ) < 1.0e-9 && Math.abs( b ) < 1.0e-9) ?
         id :
         "(" + a.toFixed( 6 ) + "*" + id + (b >= 0 ? " + " + b.toFixed( 6 ) : " - " + Math.abs( b ).toFixed( 6 )) + ")";
      terms.push( (w >= 0 ? "+ " : "- ") + Math.abs( w ).toFixed( 6 ) + "*" + inner );
   }
   return (terms.length == 0) ? "0" : terms.join( " " );
}

// ---------------------------------------------------------------------------
// SCNR (Subtractive Chromatic Noise Reduction), methode "moyenne neutre" :
// ecrete le vert a la moyenne rouge/bleu, m = min(G, (R+B)/2), puis mixe avec
// le vert d'origine selon la quantite (amount). amount=0 : inchange,
// amount=1 : correction complete. Ne touche que le canal vert (R et B
// inchanges) - utile si le melange spectral produit une dominante verte.
// ---------------------------------------------------------------------------
function buildSCNRExpr( exprR, exprG, exprB, amount ) {
   if ( amount < 1.0e-6 )
      return [ exprR, exprG, exprB ];

   var R0 = "(" + exprR + ")";
   var G0 = "(" + exprG + ")";
   var B0 = "(" + exprB + ")";
   var m = "min( " + G0 + ", 0.5*(" + R0 + " + " + B0 + ") )";
   var newG = G0 + " + " + amount.toFixed( 6 ) + "*(" + m + " - " + G0 + ")";

   return [ exprR, newG, exprB ];
}

// ---------------------------------------------------------------------------
// Saturation / vibrance, appliquees au melange RVB deja calcule (avant
// l'etirement GHS eventuel). L0 est la luminance (coefficients Rec.709,
// coherents avec la matrice sRGB deja utilisee pour les poids CIE).
// - saturation (sat) : gain constant, 1 = inchange, 0 = niveaux de gris.
// - vibrance (vib) : gain adaptatif, plus fort sur les pixels deja peu satures
//   (protege les etoiles deja tres colorees d'une sursaturation), 0 = inchange.
// ---------------------------------------------------------------------------
function buildColorAdjustExprs( exprR, exprG, exprB, sat, vib ) {
   if ( Math.abs( sat - 1 ) < 1.0e-6 && Math.abs( vib ) < 1.0e-6 )
      return [ exprR, exprG, exprB ];

   var R0 = "(" + exprR + ")";
   var G0 = "(" + exprG + ")";
   var B0 = "(" + exprB + ")";
   var L0 = "(0.212600*" + R0 + " + 0.715200*" + G0 + " + 0.072200*" + B0 + ")";
   var maxC = "max( max( " + R0 + ", " + G0 + " ), " + B0 + " )";
   var minC = "min( min( " + R0 + ", " + G0 + " ), " + B0 + " )";
   var curSat = "((" + maxC + " - " + minC + ")/max( " + maxC + ", 1.0e-06 ))";
   var factor = "(" + sat.toFixed( 6 ) + "*(1 + " + vib.toFixed( 6 ) + "*(1 - " + curSat + ")))";

   return [
      L0 + " + " + factor + "*(" + R0 + " - " + L0 + ")",
      L0 + " + " + factor + "*(" + G0 + " - " + L0 + ")",
      L0 + " + " + factor + "*(" + B0 + " - " + L0 + ")"
   ];
}

// ---------------------------------------------------------------------------
// Etirement hyperbolique generalise (GHS), pour l'apercu uniquement.
// SP=0 (point de symetrie ancre au noir), pas de zones de protection.
// ---------------------------------------------------------------------------
function ghsScalarT( x, D, b ) {
   if ( Math.abs( b ) < 1.0e-6 )
      return 1 - Math.exp( -D*x );
   if ( Math.abs( b + 1 ) < 1.0e-6 )
      return Math.log( 1 + D*x );
   if ( Math.abs( b - 1 ) < 1.0e-6 )
      return 1 - 1/(1 + D*x);
   if ( b < 0 )
      return (1 - Math.pow( 1 - b*D*x, (b + 1)/b )) / (D*(b + 1));
   return 1 - Math.pow( 1 + b*D*x, -1/b );
}

function ghsExprWrap( innerExpr, amount, b ) {
   var D = Math.exp( amount ) - 1;
   var cx = "max( 0, min( 1, (" + innerExpr + ") ) )";
   if ( D < 1.0e-6 )
      return cx; // amount ~ 0 : pas d'etirement, passage lineaire

   var denom = ghsScalarT( 1, D, b );
   if ( Math.abs( denom ) < 1.0e-9 )
      denom = 1;
   var Ds = D.toFixed( 8 ), ds = denom.toFixed( 8 );

   if ( Math.abs( b ) < 1.0e-6 )
      return "(1 - exp(-" + Ds + "*" + cx + "))/" + ds;
   if ( Math.abs( b + 1 ) < 1.0e-6 )
      return "ln(1 + " + Ds + "*" + cx + ")/" + ds;
   if ( Math.abs( b - 1 ) < 1.0e-6 )
      return "(1 - 1/(1 + " + Ds + "*" + cx + "))/" + ds;
   if ( b < 0 )
      return "(1 - (1 - (" + b.toFixed( 8 ) + ")*" + Ds + "*" + cx + ")^(" +
         ((b + 1)/b).toFixed( 8 ) + "))/(" + (D*(b + 1)).toFixed( 8 ) + ")/" + ds;
   return "(1 - (1 + (" + b.toFixed( 8 ) + ")*" + Ds + "*" + cx + ")^(" +
      (-1/b).toFixed( 8 ) + "))/" + ds;
}

// ---------------------------------------------------------------------------
// Calcul + execution PixelMath
// ---------------------------------------------------------------------------
var PREVIEW_ID = "SpectralStarMix_preview";

function computeAndRun( channels, targetId, opts, previewOpts, colorOpts ) {
   var weights = buildWeights( channels, opts );
   if ( !weights )
      throw new Error( "Selectionnez au moins une image dans une des 7 couches." );

   var refView = null, w0 = -1, h0 = -1;
   for ( var i = 0; i < weights.length; ++i ) {
      var v = weights[i].view;
      if ( refView == null ) {
         refView = v; w0 = v.image.width; h0 = v.image.height;
      } else if ( v.image.width != w0 || v.image.height != h0 ) {
         throw new Error( "Les couches selectionnees n'ont pas toutes les memes dimensions (" +
            v.fullId + " : " + v.image.width + "x" + v.image.height +
            ", attendu " + w0 + "x" + h0 + ")." );
      }
   }

   var existing = ImageWindow.windowById( targetId );
   if ( existing && !existing.isNull )
      existing.forceClose();

   var exprR = buildExpr( weights, "R" );
   var exprG = buildExpr( weights, "G" );
   var exprB = buildExpr( weights, "B" );

   if ( colorOpts ) {
      if ( colorOpts.scnrAmount ) {
         var scnr = buildSCNRExpr( exprR, exprG, exprB, colorOpts.scnrAmount );
         exprR = scnr[0]; exprG = scnr[1]; exprB = scnr[2];
      }
      var adjusted = buildColorAdjustExprs( exprR, exprG, exprB, colorOpts.sat, colorOpts.vib );
      exprR = adjusted[0]; exprG = adjusted[1]; exprB = adjusted[2];
   }

   if ( previewOpts ) {
      exprR = ghsExprWrap( exprR, previewOpts.amount, previewOpts.b );
      exprG = ghsExprWrap( exprG, previewOpts.amount, previewOpts.b );
      exprB = ghsExprWrap( exprB, previewOpts.amount, previewOpts.b );
   }

   var P = new PixelMath;
   P.expression = exprR;
   P.expression1 = exprG;
   P.expression2 = exprB;
   P.useSingleExpression = false;
   P.createNewImage = true;
   P.showNewImage = true;
   P.newImageId = targetId;
   P.newImageWidth = 0;
   P.newImageHeight = 0;
   P.newImageAlpha = false;
   P.newImageColorSpace = ColorSpace_RGB;
   P.rescale = false;
   P.truncate = true;
   P.truncateLower = 0;
   P.truncateUpper = 1;

   if ( !P.executeOn( refView ) )
      throw new Error( "Echec de l'execution de PixelMath." );

   var win = ImageWindow.windowById( targetId );
   if ( !win || win.isNull )
      throw new Error( "Fenetre de resultat introuvable apres execution de PixelMath." );

   win.zoomToFit();

   return { window: win, weights: weights };
}

// ---------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------
var CHANNELS = [
   { key: "L", label: "L  (Luminance)", lambda: 550, fwhm: 300 },
   { key: "R", label: "R  (Rouge)",     lambda: 620, fwhm: 100 },
   { key: "V", label: "V  (Vert)",      lambda: 540, fwhm: 100 },
   { key: "B", label: "B  (Bleu)",      lambda: 460, fwhm: 100 },
   { key: "S", label: "S  (SII)",       lambda: 672, fwhm:   4 },
   { key: "H", label: "H  (Halpha)",    lambda: 656, fwhm:   4 },
   { key: "O", label: "O  (OIII)",      lambda: 501, fwhm:   4 }
];

function StarMixDialog() {
   this.__base__ = Dialog;
   this.__base__();

   this.rows = [];

   this.windowTitle = "Spectral Star Mix -- melange spectral d'etoiles LRVBSHO";
   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 6;

   var help = new Label( this );
   help.frameStyle = FrameStyle_Box;
   help.wordWrapping = true;
   help.minHeight = 70;
   help.text =
      "Renseignez, pour tout ou partie des 7 couches, l'image \"etoiles seules\" issue " +
      "de la session en cours, sa longueur d'onde centrale, sa largeur de bande (FWHM) " +
      "et sa contribution (1 = poids naturel CIE, 0 = exclue). L'egalisation de niveaux " +
      "recale chaque couche sur l'echelle de la couche de reference avant melange. " +
      "L'apercu utilise un etirement hyperbolique (GHS) - l'image generee reste lineaire.";
   this.sizer.add( help );

   for ( var i = 0; i < CHANNELS.length; ++i ) {
      var ch = CHANNELS[i];

      var row = new HorizontalSizer;
      row.spacing = 6;

      var chLabel = new Label( this );
      chLabel.text = ch.label;
      chLabel.minWidth = 110;
      chLabel.textAlignment = TextAlign_Right|TextAlign_VertCenter;

      var vl = new ViewList( this );
      vl.getMainViews();
      vl.minWidth = 200;
      vl.toolTip = "Image etoiles seules pour la couche " + ch.key;

      var lam = new NumericEdit( this );
      lam.real = true;
      lam.setRange( 300, 1100 );
      lam.setPrecision( 1 );
      lam.setValue( ch.lambda );
      lam.label.text = "lambda(nm)";
      lam.edit.setFixedWidth( 55 );
      lam.toolTip = "Longueur d'onde centrale du filtre, en nanometres";

      var fw = new NumericEdit( this );
      fw.real = true;
      fw.setRange( 0.5, 400 );
      fw.setPrecision( 1 );
      fw.setValue( ch.fwhm );
      fw.label.text = "largeur(nm)";
      fw.edit.setFixedWidth( 55 );
      fw.toolTip = "Largeur de bande (FWHM) du filtre, en nanometres";

      var contrib = new NumericControl( this );
      contrib.setRange( 0, 2 );
      contrib.setPrecision( 2 );
      contrib.setValue( 1.0 );
      contrib.label.text = "contribution";
      contrib.edit.setFixedWidth( 45 );
      contrib.toolTip = "Multiplicateur artistique par-dessus le poids physique CIE (1 = naturel, 0 = exclue)";

      row.add( chLabel );
      row.add( vl, 60 );
      row.add( lam );
      row.add( fw );
      row.add( contrib, 40 );

      this.sizer.add( row );
      this.rows.push( { key: ch.key, viewList: vl, lambdaEdit: lam, fwhmEdit: fw,
                         contributionEdit: contrib, defLambda: ch.lambda, defFWHM: ch.fwhm } );
   }

   // --- Egalisation de niveaux ---
   var levelRow = new HorizontalSizer;
   levelRow.spacing = 6;

   this.equalizeCheck = new CheckBox( this );
   this.equalizeCheck.text = "Egaliser les niveaux avant melange (type LinearFit)";
   this.equalizeCheck.checked = true;

   var refLabel = new Label( this );
   refLabel.text = "Canal de reference :";
   refLabel.textAlignment = TextAlign_Right|TextAlign_VertCenter;

   this.refCombo = new ComboBox( this );
   for ( var i = 0; i < CHANNELS.length; ++i )
      this.refCombo.addItem( CHANNELS[i].label );
   this.refCombo.currentItem = 0;

   levelRow.add( this.equalizeCheck );
   levelRow.addStretch();
   levelRow.add( refLabel );
   levelRow.add( this.refCombo );
   this.sizer.add( levelRow );

   // --- Apercu GHS ---
   var ghsRow = new HorizontalSizer;
   ghsRow.spacing = 6;

   this.amountCtrl = new NumericControl( this );
   this.amountCtrl.setRange( 0, 20 );
   this.amountCtrl.setPrecision( 2 );
   this.amountCtrl.setValue( 4 );
   this.amountCtrl.label.text = "Amount (apercu)";
   this.amountCtrl.toolTip = "Facteur d'etirement de l'apercu (GHS) : amount = ln(D+1). 0 = pas d'etirement. N'affecte pas l'image generee.";

   this.localIntensityCtrl = new NumericControl( this );
   this.localIntensityCtrl.setRange( -10, 15 );
   this.localIntensityCtrl.setPrecision( 2 );
   this.localIntensityCtrl.setValue( -1 );
   this.localIntensityCtrl.label.text = "Local intensity b (apercu)";
   this.localIntensityCtrl.toolTip = "Parametre b du GHS (b=-1 log, b=0 exponentiel, b=1 harmonique, b>0 hyperbolique, b<0 integrale). N'affecte pas l'image generee.";

   ghsRow.add( this.amountCtrl );
   ghsRow.add( this.localIntensityCtrl );
   this.sizer.add( ghsRow );

   this.applyGHSToOutputCheck = new CheckBox( this );
   this.applyGHSToOutputCheck.text = "Appliquer ce GHS a l'image generee (sinon : sortie lineaire)";
   this.applyGHSToOutputCheck.checked = false;
   ghsRow.add( this.applyGHSToOutputCheck );

   // --- SCNR (reduction du vert, moyenne neutre) ---
   var scnrRow = new HorizontalSizer;
   scnrRow.spacing = 6;

   this.scnrCtrl = new NumericControl( this );
   this.scnrCtrl.setRange( 0, 1 );
   this.scnrCtrl.setPrecision( 2 );
   this.scnrCtrl.setValue( 0.0 );
   this.scnrCtrl.label.text = "SCNR vert (quantite)";
   this.scnrCtrl.toolTip = "Reduction du vert methode 'moyenne neutre' (SCNR) : ecrete le vert a la moyenne rouge/bleu. 0 = inchange, 1 = correction complete.";

   scnrRow.add( this.scnrCtrl );
   this.sizer.add( scnrRow );

   // --- Saturation / vibrance ---
   var colorRow = new HorizontalSizer;
   colorRow.spacing = 6;

   this.saturationCtrl = new NumericControl( this );
   this.saturationCtrl.setRange( 0, 2 );
   this.saturationCtrl.setPrecision( 2 );
   this.saturationCtrl.setValue( 1.0 );
   this.saturationCtrl.label.text = "Saturation";
   this.saturationCtrl.toolTip = "Gain de saturation constant applique au melange RVB. 1 = inchange, 0 = niveaux de gris.";

   this.vibranceCtrl = new NumericControl( this );
   this.vibranceCtrl.setRange( -1, 1 );
   this.vibranceCtrl.setPrecision( 2 );
   this.vibranceCtrl.setValue( 0.0 );
   this.vibranceCtrl.label.text = "Vibrance";
   this.vibranceCtrl.toolTip = "Gain de saturation adaptatif : plus fort sur les pixels deja peu satures, protege les etoiles deja tres colorees. 0 = inchange.";

   colorRow.add( this.saturationCtrl );
   colorRow.add( this.vibranceCtrl );
   this.sizer.add( colorRow );

   this.infoLabel = new Label( this );
   this.infoLabel.text = "Poids effectifs (recalcules a chaque apercu/generation) :";
   this.sizer.add( this.infoLabel );

   this.infoBox = new TextBox( this );
   this.infoBox.readOnly = true;
   this.infoBox.minHeight = 100;
   this.sizer.add( this.infoBox );

   this.resetButton = new PushButton( this );
   this.resetButton.text = "Reinitialiser lambda/largeur";
   this.resetButton.onClick = function() {
      var d = this.dialog;
      for ( var i = 0; i < d.rows.length; ++i ) {
         d.rows[i].lambdaEdit.setValue( d.rows[i].defLambda );
         d.rows[i].fwhmEdit.setValue( d.rows[i].defFWHM );
         d.rows[i].contributionEdit.setValue( 1.0 );
      }
      d.saturationCtrl.setValue( 1.0 );
      d.vibranceCtrl.setValue( 0.0 );
      d.scnrCtrl.setValue( 0.0 );
   };

   this.previewButton = new PushButton( this );
   this.previewButton.text = "Rafraichir l'apercu";
   this.previewButton.onClick = function() {
      var d = this.dialog;
      d.doRun( PREVIEW_ID, { amount: d.amountCtrl.value, b: d.localIntensityCtrl.value } );
   };

   this.outputLabel = new Label( this );
   this.outputLabel.text = "Nom image finale :";
   this.outputLabel.textAlignment = TextAlign_Right|TextAlign_VertCenter;

   this.outputIdEdit = new Edit( this );
   this.outputIdEdit.text = "StarMix_RVBSHO";
   this.outputIdEdit.minWidth = 140;

   this.generateButton = new PushButton( this );
   this.generateButton.text = "Generer (pleine resolution)";
   this.generateButton.onClick = function() {
      var d = this.dialog;
      var id = d.outputIdEdit.text.trim();
      if ( id.length == 0 )
         id = "StarMix_RVBSHO";
      var ghsForOutput = d.applyGHSToOutputCheck.checked ?
         { amount: d.amountCtrl.value, b: d.localIntensityCtrl.value } : null;
      d.doRun( id, ghsForOutput );
      // L'image finale remplace l'apercu : on ferme l'apercu devenu inutile.
      var prev = ImageWindow.windowById( PREVIEW_ID );
      if ( prev && !prev.isNull )
         prev.forceClose();
   };

   this.closeButton = new PushButton( this );
   this.closeButton.text = "Fermer";
   this.closeButton.onClick = function() {
      this.dialog.ok();
   };

   var btnRow = new HorizontalSizer;
   btnRow.spacing = 6;
   btnRow.add( this.resetButton );
   btnRow.addStretch();
   btnRow.add( this.previewButton );
   btnRow.add( this.outputLabel );
   btnRow.add( this.outputIdEdit );
   btnRow.add( this.generateButton );
   btnRow.add( this.closeButton );
   this.sizer.add( btnRow );

   this.adjustToContents();
   this.userResizable = true;
}
StarMixDialog.prototype = new Dialog;

StarMixDialog.prototype.getChannelsState = function() {
   var out = [];
   for ( var i = 0; i < this.rows.length; ++i ) {
      var r = this.rows[i];
      out.push( { key: r.key, view: r.viewList.currentView,
                  lambda: r.lambdaEdit.value, fwhm: r.fwhmEdit.value,
                  contribution: r.contributionEdit.value } );
   }
   return out;
};

StarMixDialog.prototype.updateInfo = function( weights ) {
   var lines = [];
   for ( var i = 0; i < weights.length; ++i ) {
      var w = weights[i];
      lines.push( w.key + "  (" + w.id + ")   a=" + w.fitA.toFixed( 4 ) +
                  " b=" + w.fitB.toFixed( 4 ) + "   x" + w.contribution.toFixed( 2 ) +
                  "   ->  R:" + w.R.toFixed( 3 ) + "  G:" + w.G.toFixed( 3 ) + "  B:" + w.B.toFixed( 3 ) );
   }
   this.infoBox.text = lines.join( "\n" );
};

StarMixDialog.prototype.doRun = function( targetId, previewOpts ) {
   try {
      var opts = {
         equalize: this.equalizeCheck.checked,
         referenceKey: CHANNELS[ this.refCombo.currentItem ].key
      };
      var colorOpts = { sat: this.saturationCtrl.value, vib: this.vibranceCtrl.value,
                        scnrAmount: this.scnrCtrl.value };
      var result = computeAndRun( this.getChannelsState(), targetId, opts, previewOpts, colorOpts );
      this.updateInfo( result.weights );
   } catch ( e ) {
      Console.criticalln( e.toString() );
      (new MessageBox( "Erreur : " + e.message, "SpectralStarMix",
                        StdIcon_Error, StdButton_Ok )).execute();
   }
};

function main() {
   if ( ImageWindow.windows.length == 0 )
      (new MessageBox(
         "Aucune image ouverte dans PixInsight. Ouvrez d'abord vos couches " +
         "\"etoiles seules\" LRVBSHO avant de lancer ce script.",
         "SpectralStarMix", StdIcon_Warning, StdButton_Ok )).execute();

   var dlg = new StarMixDialog();
   dlg.execute();

   // Filet de securite : quelle que soit la facon dont la boite de dialogue
   // s'est fermee, on ne laisse pas trainer la fenetre d'apercu.
   var prev = ImageWindow.windowById( PREVIEW_ID );
   if ( prev && !prev.isNull )
      prev.forceClose();
}

main();
