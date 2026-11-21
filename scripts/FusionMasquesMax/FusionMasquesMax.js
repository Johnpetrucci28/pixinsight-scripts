// ----------------------------------------------------------------------------
// FusionMasquesMax.js  —  PixInsight (PJSR)
//
// Fusionne 2 ou 3 masques N&B en gardant, pour chaque pixel, la valeur
// la plus claire :  résultat = max(M1, M2, M3)   (et non min).
// Puis, en option :
//   1. dilatation des zones blanches de X pixels (bords élargis, disque)
//   2. lissage gaussien de sigma réglable
//
// Installation : Script > Feature Scripts... > Add (dossier du fichier)
//                ou simplement Script > Execute Script File...
// ----------------------------------------------------------------------------

#feature-id    Utilities > FusionMasquesMax
#feature-info  Fusionne 2 ou 3 masques niveaux de gris par maximum pixel à pixel, \
               avec dilatation et lissage gaussien optionnels.

#include <pjsr/Sizer.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/NumericControl.jsh>

#define TITLE "Fusion de masques (max)"
#define MAX_RAYON_MT 12   // MorphologicalTransformation : taille max 25 = 2*12+1

function FusionDialog()
{
   this.__base__ = Dialog;
   this.__base__();

   this.views = [null, null, null];
   this.dilatation = 0;   // pixels
   this.sigma = 0;        // pixels
   let self = this;
   const labelWidth = 150;

   function makeRow(index, optional)
   {
      let label = new Label(self);
      label.text = "Masque " + (index + 1) + (optional ? " (optionnel) :" : " :");
      label.minWidth = labelWidth;

      let list = new ViewList(self);
      list.getMainViews();
      list.minWidth = 260;
      list.onViewSelected = function(view)
      {
         self.views[index] = (view && !view.isNull) ? view : null;
      };

      let sizer = new HorizontalSizer;
      sizer.spacing = 6;
      sizer.add(label);
      sizer.add(list, 100);
      return sizer;
   }

   // --- Dilatation (bords blancs) ---
   this.dilLabel = new Label(this);
   this.dilLabel.text = "Élargir le blanc (px) :";
   this.dilLabel.minWidth = labelWidth;
   this.dilSpin = new SpinBox(this);
   this.dilSpin.minValue = 0;
   this.dilSpin.maxValue = 200;
   this.dilSpin.value = this.dilatation;
   this.dilSpin.toolTip = "Dilate les zones blanches de X pixels (élément circulaire). 0 = désactivé.";
   this.dilSpin.onValueUpdated = function(v) { self.dilatation = v; };
   this.dilSizer = new HorizontalSizer;
   this.dilSizer.spacing = 6;
   this.dilSizer.add(this.dilLabel);
   this.dilSizer.add(this.dilSpin);
   this.dilSizer.addStretch();

   // --- Lissage gaussien ---
   this.sigmaControl = new NumericControl(this);
   this.sigmaControl.label.text = "Lissage gaussien σ (px) :";
   this.sigmaControl.label.minWidth = labelWidth;
   this.sigmaControl.setRange(0, 50);
   this.sigmaControl.slider.setRange(0, 500);
   this.sigmaControl.setPrecision(1);
   this.sigmaControl.setValue(this.sigma);
   this.sigmaControl.toolTip = "Écart-type du flou gaussien appliqué en dernier. 0 = désactivé.";
   this.sigmaControl.onValueUpdated = function(v) { self.sigma = v; };

   // --- Nom du résultat ---
   this.idLabel = new Label(this);
   this.idLabel.text = "Nom du résultat :";
   this.idLabel.minWidth = labelWidth;
   this.idEdit = new Edit(this);
   this.idEdit.text = "Masque_max";
   this.idSizer = new HorizontalSizer;
   this.idSizer.spacing = 6;
   this.idSizer.add(this.idLabel);
   this.idSizer.add(this.idEdit, 100);

   this.okButton = new PushButton(this);
   this.okButton.text = "Fusionner";
   this.okButton.onClick = function() { self.ok(); };
   this.cancelButton = new PushButton(this);
   this.cancelButton.text = "Annuler";
   this.cancelButton.onClick = function() { self.cancel(); };
   this.buttons = new HorizontalSizer;
   this.buttons.spacing = 6;
   this.buttons.addStretch();
   this.buttons.add(this.okButton);
   this.buttons.add(this.cancelButton);

   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 6;
   this.sizer.add(makeRow(0, false));
   this.sizer.add(makeRow(1, false));
   this.sizer.add(makeRow(2, true));
   this.sizer.addSpacing(4);
   this.sizer.add(this.dilSizer);
   this.sizer.add(this.sigmaControl);
   this.sizer.addSpacing(4);
   this.sizer.add(this.idSizer);
   this.sizer.addSpacing(4);
   this.sizer.add(this.buttons);

   this.windowTitle = TITLE;
   this.adjustToContents();
}
FusionDialog.prototype = new Dialog;

function erreur(msg)
{
   (new MessageBox(msg, TITLE, StdIcon_Error, StdButton_Ok)).execute();
}

// Élément structurant circulaire (disque) de rayon r, taille 2r+1.
function disque(r)
{
   let n = 2*r + 1;
   let way = [];
   for (let y = -r; y <= r; ++y)
      for (let x = -r; x <= r; ++x)
         way.push((x*x + y*y <= r*r + r) ? 1 : 0);   // +r : disque discret plus rond
   return { size: n, table: [way] };
}

// Dilate le blanc de "px" pixels. Au-delà de 12 px, on itère des disques
// plus petits : une somme de disques de rayons r1+r2+... ≈ disque de rayon total.
function dilater(view, px)
{
   let iterations = Math.ceil(px / MAX_RAYON_MT);
   let r = Math.ceil(px / iterations);
   let s = disque(r);

   let M = new MorphologicalTransformation;
   M.operator = MorphologicalTransformation.prototype.Dilation;
   M.interlacingDistance = 1;
   M.lowThreshold = 0.0;
   M.highThreshold = 0.0;
   M.numberOfIterations = iterations;
   M.amount = 1.0;
   M.selectionPoint = 0.5;
   M.structureName = "";
   M.structureSize = s.size;
   M.structureWayTable = [s.table];

   console.writeln("Dilatation : " + iterations + " × disque r=" + r + " px (≈ " + (iterations*r) + " px)");
   M.executeOn(view, false);
}

function lisser(view, sigma)
{
   let C = new Convolution;
   C.mode = Convolution.prototype.Parametric;
   C.sigma = sigma;
   C.shape = 2;           // gaussienne
   C.aspectRatio = 1;
   C.rotationAngle = 0;
   C.rescaleHighPass = false;

   console.writeln("Lissage gaussien : σ = " + sigma.toFixed(1) + " px");
   C.executeOn(view, false);
}

function fusionner(views, newId, dilatation, sigma)
{
   let ref = views[0].image;
   for (let i = 0; i < views.length; ++i)
   {
      let img = views[i].image;
      if (img.isColor)
      {
         erreur("« " + views[i].id + " » est en couleur : les masques doivent être N&B.");
         return;
      }
      if (img.width != ref.width || img.height != ref.height)
      {
         erreur("« " + views[i].id + " » n'a pas les mêmes dimensions que « " + views[0].id + " ».");
         return;
      }
   }

   let ids = views.map(function(v) { return v.id; });

   // Image résultat créée d'abord : on garde ainsi la main dessus
   // (PixInsight renomme l'id s'il existe déjà).
   let win = new ImageWindow(ref.width, ref.height, 1, 32, true, false, newId);
   let out = win.mainView;

   let P = new PixelMath;
   P.expression = "max(" + ids.join(", ") + ")";
   P.useSingleExpression = true;
   P.rescale = false;
   P.truncate = true;
   P.truncateLower = 0;
   P.truncateUpper = 1;
   P.createNewImage = false;

   console.writeln("<b>" + TITLE + "</b> : " + P.expression + "  ->  " + out.id);
   P.executeOn(out, false);

   if (dilatation > 0)
      dilater(out, dilatation);
   if (sigma > 0)
      lisser(out, sigma);

   win.show();
   win.zoomToFit();
}

function main()
{
   console.show();
   let dlg = new FusionDialog;
   if (!dlg.execute())
      return;

   if (dlg.views[0] == null || dlg.views[1] == null)
   {
      erreur("Choisis au moins les masques 1 et 2.");
      return;
   }

   let views = dlg.views.filter(function(v) { return v != null; });
   let ids = views.map(function(v) { return v.id; });
   for (let i = 0; i < ids.length; ++i)
      if (ids.indexOf(ids[i]) != i)
      {
         erreur("Le même masque est sélectionné deux fois.");
         return;
      }

   let newId = dlg.idEdit.text.trim();
   if (newId.length == 0)
      newId = "Masque_max";

   fusionner(views, newId, dlg.dilatation, dlg.sigma);
}

main();
