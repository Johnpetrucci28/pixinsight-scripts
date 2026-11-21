
#engine v8

/*
 * Mix Ha + Luminance — aperçu actualisable
 * PixInsight PJSR / moteur V8
 *
 * Mode 1 : addition pondérée
 * Mode 2 : Screen
 * Mode 3 : Screen + LHE
 */

class MixHaLDialog extends Dialog
{
   constructor()
   {
      super();

      this.windowTitle = "Mix Ha + Luminance";
      this.setMinWidth( 450 );

      this.previewWindow = null;

      this.lCombo = new ComboBox( this );
      this.haCombo = new ComboBox( this );

      this.populateViews();

      this.modeCombo = new ComboBox( this );
      this.modeCombo.addItem( "1 - Addition ponderee" );
      this.modeCombo.addItem( "2 - Screen" );
      this.modeCombo.addItem( "3 - Screen + LHE" );

      this.haWeight = new NumericControl( this );
      this.haWeight.label.text = "Poids Ha";
      this.haWeight.setRange( 0, 1 );
      this.haWeight.slider.setRange( 0, 100 );
      this.haWeight.setPrecision( 2 );
      this.haWeight.setValue( 0.30 );

      this.lheAmount = new NumericControl( this );
      this.lheAmount.label.text = "Intensite du LHE";
      this.lheAmount.setRange( 0, 1 );
      this.lheAmount.slider.setRange( 0, 100 );
      this.lheAmount.setPrecision( 2 );
      this.lheAmount.setValue( 0.25 );

      this.lheKernel = new NumericControl( this );
      this.lheKernel.label.text = "Taille du noyau LHE";
      this.lheKernel.setRange( 2, 500 );
      this.lheKernel.slider.setRange( 2, 500 );
      this.lheKernel.setPrecision( 0 );
      this.lheKernel.setValue( 40 );

      this.lheLimit = new NumericControl( this );
      this.lheLimit.label.text = "Limite de contraste LHE";
      this.lheLimit.setRange( 1, 4 );
      this.lheLimit.slider.setRange( 10, 40 );
      this.lheLimit.setPrecision( 1 );
      this.lheLimit.setValue( 1.3 );

      this.circular = new CheckBox( this );
      this.circular.text = "Noyau circulaire";
      this.circular.checked = true;

      this.info = new Label( this );
      this.info.wordWrapping = true;
      this.info.text =
         "Selectionne deux images monochromes alignees et de memes dimensions. " +
         "L'aperçu s'ouvre dans une fenetre separee. " +
         "Les images sources ne sont pas modifiees.";

      this.previewButton = new PushButton( this );
      this.previewButton.text = "Actualiser l'apercu";
      this.previewButton.onClick = () =>
      {
         try
         {
            this.updatePreview();
         }
         catch ( e )
         {
            new MessageBox(
               e.message,
               "Erreur d'apercu",
               StdIcon_Error
            ).execute();
         }
      };

      this.createButton = new PushButton( this );
      this.createButton.text = "Creer l'image finale";
      this.createButton.onClick = () =>
      {
         try
         {
            this.createFinal();
         }
         catch ( e )
         {
            new MessageBox(
               e.message,
               "Erreur",
               StdIcon_Error
            ).execute();
         }
      };

      this.closeButton = new PushButton( this );
      this.closeButton.text = "Fermer";
      this.closeButton.onClick = () => this.cancel();

      this.sizer = new VerticalSizer;
      this.sizer.margin = 12;
      this.sizer.spacing = 8;

      this.sizer.add( this.row( "Luminance (L)", this.lCombo ) );
      this.sizer.add( this.row( "H-alpha (Ha)", this.haCombo ) );
      this.sizer.add( this.row( "Mode de fusion", this.modeCombo ) );
      this.sizer.add( this.haWeight );
      this.sizer.add( this.lheAmount );
      this.sizer.add( this.lheKernel );
      this.sizer.add( this.lheLimit );
      this.sizer.add( this.circular );
      this.sizer.add( this.info );

      let buttons = new HorizontalSizer;
      buttons.spacing = 8;
      buttons.add( this.previewButton );
      buttons.add( this.createButton );
      buttons.add( this.closeButton );

      this.sizer.add( buttons );
      this.adjustToContents();
   }

   row( labelText, control )
   {
      let s = new HorizontalSizer;
      s.spacing = 8;

      let label = new Label( this );
      label.text = labelText;
      label.minWidth = 125;

      s.add( label );
      s.add( control, 100 );
      return s;
   }

   populateViews()
   {
      let windows = ImageWindow.windows;

      for ( let i = 0; i < windows.length; ++i )
      {
         let win = windows[i];
         if ( win.isNull )
            continue;

         let view = win.mainView;
         if ( view.isNull )
            continue;

         this.lCombo.addItem( view.id );
         this.haCombo.addItem( view.id );
      }

      if ( this.lCombo.numberOfItems > 1 )
         this.haCombo.currentItem = 1;
   }

   getSources()
   {
      if ( this.lCombo.currentItem < 0 ||
           this.haCombo.currentItem < 0 )
         throw new Error( "Selectionne les images L et Ha." );

      let lId = this.lCombo.itemText( this.lCombo.currentItem );
      let hId = this.haCombo.itemText( this.haCombo.currentItem );

      if ( lId == hId )
         throw new Error( "L et Ha doivent etre deux images differentes." );

      let lv = View.viewById( lId );
      let hv = View.viewById( hId );

      if ( lv == null || hv == null || lv.isNull || hv.isNull )
         throw new Error( "Une image selectionnee est introuvable." );

      if ( lv.image.width != hv.image.width ||
           lv.image.height != hv.image.height )
         throw new Error( "L et Ha doivent avoir les memes dimensions." );

      if ( lv.image.numberOfChannels != 1 ||
           hv.image.numberOfChannels != 1 )
         throw new Error( "Les deux images doivent etre monochromes." );

      if ( !/^[A-Za-z_][A-Za-z0-9_]*$/.test( lId ) ||
           !/^[A-Za-z_][A-Za-z0-9_]*$/.test( hId ) )
         throw new Error(
            "Renomme les vues source sans espaces ni tirets."
         );

      return { l: lv, ha: hv, lId: lId, hId: hId };
   }

   makeExpression( src )
   {
      let w = this.haWeight.value;

      if ( this.modeCombo.currentItem == 0 )
         return src.lId + " + " + w.toFixed( 5 ) + "*" + src.hId;

      return "1 - (1 - " + src.lId + ")*(1 - " +
             w.toFixed( 5 ) + "*" + src.hId + ")";
   }

   applyMix( target, src )
   {
      let pm = new PixelMath;
      pm.expression = this.makeExpression( src );
      pm.useSingleExpression = true;
      pm.createNewImage = false;
      pm.rescale = false;
      pm.truncate = true;
      pm.truncateLower = 0;
      pm.truncateUpper = 1;

      if ( !pm.executeOn( target ) )
         throw new Error( "Echec du calcul PixelMath." );

      if ( this.modeCombo.currentItem == 2 )
      {
         let lhe = new LocalHistogramEqualization;
         lhe.kernelSize = Math.round( this.lheKernel.value );
         lhe.contrastLimit = this.lheLimit.value;
         lhe.amount = this.lheAmount.value;
         lhe.histogramResolution = 10;
         lhe.circularKernel = this.circular.checked;

         if ( !lhe.executeOn( target ) )
            throw new Error( "Echec du traitement LHE." );
      }
   }

   createOutput( src, id )
   {
      let out = new ImageWindow(
         src.l.image.width,
         src.l.image.height,
         1,
         32,
         true,
         false,
         id
      );

      out.mainView.beginProcess( UndoFlag.NoSwapFile );
      out.mainView.image.fill( 0 );
      out.mainView.endProcess();

      try
      {
         this.applyMix( out.mainView, src );
      }
      catch ( e )
      {
         out.forceClose();
         throw e;
      }

      out.show();
      out.zoomToOptimalFit();
      return out;
   }

   updatePreview()
   {
      let src = this.getSources();

      if ( this.previewWindow != null &&
           !this.previewWindow.isNull )
      {
         this.previewWindow.forceClose();
         this.previewWindow = null;
      }

      this.previewWindow = this.createOutput( src, "Preview_MixHaL" );
      console.writeln( "Apercu actualise." );
   }

   createFinal()
   {
      let src = this.getSources();

      let id = ( "MixHaL_" + src.lId )
         .replace( /[^A-Za-z0-9_]/g, "_" );

      let out = this.createOutput( src, id );
      console.writeln( "Image finale creee : " + out.mainView.id );
   }
}

function main()
{
   let dialog = new MixHaLDialog();
   dialog.execute();
}

main();
