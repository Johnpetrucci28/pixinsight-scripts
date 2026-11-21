#engine v8
// ============================================================================
// BatchSaveWorkspace.js — Script PixInsight (PJSR, moteur V8)
//
// Enregistre en une fois les images ouvertes dans l'espace de travail.
//   - liste des fenêtres ouvertes, à cocher / décocher
//   - dossier de sortie, format (XISF, FITS, TIFF, PNG, JPEG)
//   - préfixe / suffixe facultatifs, nom = identifiant de la fenêtre
//   - écrase ou non les fichiers existants
//
// Utilisation : Script > Execute Script File…
// ============================================================================

#feature-id    Utilities > BatchSaveWorkspace
#feature-info  Enregistre en lot les images ouvertes dans l'espace de travail.

#include <pjsr/DataType.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/TextAlign.jsh>

var FORMATS = [
   { name: "XISF (.xisf)",  ext: ".xisf" },
   { name: "FITS (.fits)",  ext: ".fits" },
   { name: "TIFF (.tif)",   ext: ".tif"  },
   { name: "PNG (.png)",    ext: ".png"  },
   { name: "JPEG (.jpg)",   ext: ".jpg"  }
];

var CFG = {
   outDir    : "",
   format    : 0,
   prefix    : "",
   suffix    : "",
   overwrite : false,
   closeAfter: false
};

// Réglages mémorisés d'une exécution à l'autre
var SETTINGS_KEY = "BatchSaveWorkspace/";
function loadSettings()
{
   function get( key, type, def )
   {
      var v = Settings.read( SETTINGS_KEY + key, type );
      return Settings.lastReadOK ? v : def;
   }
   CFG.outDir     = get( "outDir",     DataType_String,  CFG.outDir );
   CFG.format     = get( "format",     DataType_Int32,   CFG.format );
   CFG.prefix     = get( "prefix",     DataType_String,  CFG.prefix );
   CFG.suffix     = get( "suffix",     DataType_String,  CFG.suffix );
   CFG.overwrite  = get( "overwrite",  DataType_Boolean, CFG.overwrite );
   CFG.closeAfter = get( "closeAfter", DataType_Boolean, CFG.closeAfter );
   if ( CFG.format < 0 || CFG.format >= FORMATS.length )
      CFG.format = 0;
}
function saveSettings()
{
   Settings.write( SETTINGS_KEY + "outDir",     DataType_String,  CFG.outDir );
   Settings.write( SETTINGS_KEY + "format",     DataType_Int32,   CFG.format );
   Settings.write( SETTINGS_KEY + "prefix",     DataType_String,  CFG.prefix );
   Settings.write( SETTINGS_KEY + "suffix",     DataType_String,  CFG.suffix );
   Settings.write( SETTINGS_KEY + "overwrite",  DataType_Boolean, CFG.overwrite );
   Settings.write( SETTINGS_KEY + "closeAfter", DataType_Boolean, CFG.closeAfter );
}

function safeFileName( s )
{
   return s.replace( /[\\\/:*?"<>|]/g, "_" );
}

var BatchSaveDialog = class extends Dialog
{
constructor( windows )
{
   super();
   var self = this;
   this.windows = windows;
   var labelWidth = this.font.width( "Dossier de sortie :" ) + 8;

   function rowLabel( text )
   {
      var l = new Label( self );
      l.text = text;
      l.textAlignment = TextAlign_Right | TextAlign_VertCenter;
      l.setFixedWidth( labelWidth );
      return l;
   }

   // --- Liste des images ouvertes ---
   this.tree = new TreeBox( this );
   this.tree.numberOfColumns = 3;
   this.tree.headerVisible = true;
   this.tree.setHeaderText( 0, "Image" );
   this.tree.setHeaderText( 1, "Taille" );
   this.tree.setHeaderText( 2, "Fichier actuel" );
   this.tree.rootDecoration = false;
   this.tree.alternateRowColor = true;
   this.tree.setScaledMinSize( 560, 220 );
   for ( var i = 0; i < windows.length; ++i )
   {
      var w = windows[i];
      var img = w.mainView.image;
      var node = new TreeBoxNode( this.tree );
      node.checkable = true;
      node.checked = true;
      node.setText( 0, w.mainView.id );
      node.setText( 1, img.width + " x " + img.height + (img.isColor ? " RVB" : " N&B") );
      node.setText( 2, w.filePath != "" ? w.filePath : "(jamais enregistrée)" );
   }
   this.tree.adjustColumnWidthToContents( 0 );
   this.tree.adjustColumnWidthToContents( 1 );

   this.allButton = new PushButton( this );
   this.allButton.text = "Tout cocher";
   this.allButton.onClick = function() { self.checkAll( true ); };
   this.noneButton = new PushButton( this );
   this.noneButton.text = "Tout décocher";
   this.noneButton.onClick = function() { self.checkAll( false ); };
   this.selSizer = new HorizontalSizer;
   this.selSizer.spacing = 4;
   this.selSizer.add( this.allButton );
   this.selSizer.add( this.noneButton );
   this.selSizer.addStretch();

   // --- Dossier ---
   this.dirEdit = new Edit( this );
   this.dirEdit.text = CFG.outDir;
   this.dirEdit.onTextUpdated = function( t ) { CFG.outDir = t.trim(); };
   this.dirButton = new PushButton( this );
   this.dirButton.text = "Parcourir…";
   this.dirButton.onClick = function()
   {
      var gdd = new GetDirectoryDialog;
      gdd.caption = "Dossier de sortie";
      if ( CFG.outDir != "" )
         gdd.initialPath = CFG.outDir;
      if ( gdd.execute() )
      {
         CFG.outDir = gdd.directory;
         self.dirEdit.text = CFG.outDir;
      }
   };
   this.dirSizer = new HorizontalSizer;
   this.dirSizer.spacing = 4;
   this.dirSizer.add( rowLabel( "Dossier de sortie :" ) );
   this.dirSizer.add( this.dirEdit, 100 );
   this.dirSizer.add( this.dirButton );

   // --- Format ---
   this.formatCombo = new ComboBox( this );
   for ( var i = 0; i < FORMATS.length; ++i )
      this.formatCombo.addItem( FORMATS[i].name );
   this.formatCombo.currentItem = CFG.format;
   this.formatCombo.onItemSelected = function( i ) { CFG.format = i; };
   this.formatSizer = new HorizontalSizer;
   this.formatSizer.spacing = 4;
   this.formatSizer.add( rowLabel( "Format :" ) );
   this.formatSizer.add( this.formatCombo );
   this.formatSizer.addStretch();

   // --- Préfixe / suffixe ---
   this.prefixEdit = new Edit( this );
   this.prefixEdit.text = CFG.prefix;
   this.prefixEdit.onTextUpdated = function( t ) { CFG.prefix = t; };
   this.suffixEdit = new Edit( this );
   this.suffixEdit.text = CFG.suffix;
   this.suffixEdit.onTextUpdated = function( t ) { CFG.suffix = t; };
   this.nameSizer = new HorizontalSizer;
   this.nameSizer.spacing = 4;
   this.nameSizer.add( rowLabel( "Préfixe :" ) );
   this.nameSizer.add( this.prefixEdit, 50 );
   this.nameSizer.addSpacing( 8 );
   var sl = new Label( this );
   sl.text = "Suffixe :";
   sl.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   this.nameSizer.add( sl );
   this.nameSizer.add( this.suffixEdit, 50 );

   this.nameHint = new Label( this );
   this.nameHint.text = "Nom du fichier = préfixe + identifiant de la fenêtre + suffixe + extension";

   // --- Options ---
   this.overwriteCheck = new CheckBox( this );
   this.overwriteCheck.text = "Écraser les fichiers existants";
   this.overwriteCheck.checked = CFG.overwrite;
   this.overwriteCheck.onCheck = function( on ) { CFG.overwrite = on; };
   this.closeCheck = new CheckBox( this );
   this.closeCheck.text = "Fermer les images après enregistrement";
   this.closeCheck.checked = CFG.closeAfter;
   this.closeCheck.onCheck = function( on ) { CFG.closeAfter = on; };

   // --- Boutons ---
   this.okButton = new PushButton( this );
   this.okButton.text = "Enregistrer";
   this.okButton.onClick = function()
   {
      if ( CFG.outDir == "" || !File.directoryExists( CFG.outDir ) )
      {
         new MessageBox( "Choisissez un dossier de sortie existant.", "BatchSaveWorkspace",
                         StdIcon_Error, StdButton_Ok ).execute();
         return;
      }
      if ( self.selected().length == 0 )
      {
         new MessageBox( "Aucune image cochée.", "BatchSaveWorkspace",
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
   this.sizer.add( this.tree, 100 );
   this.sizer.add( this.selSizer );
   this.sizer.addSpacing( 4 );
   this.sizer.add( this.dirSizer );
   this.sizer.add( this.formatSizer );
   this.sizer.add( this.nameSizer );
   this.sizer.add( this.nameHint );
   this.sizer.add( this.overwriteCheck );
   this.sizer.add( this.closeCheck );
   this.sizer.addSpacing( 8 );
   this.sizer.add( this.buttons );

   this.windowTitle = "Enregistrer les images de l'espace de travail";
   this.adjustToContents();
}

checkAll( on )
{
   for ( var i = 0; i < this.tree.numberOfChildren; ++i )
      this.tree.child( i ).checked = on;
}

selected()
{
   var out = [];
   for ( var i = 0; i < this.tree.numberOfChildren; ++i )
      if ( this.tree.child( i ).checked )
         out.push( this.windows[i] );
   return out;
}
};

function main()
{
   var windows = ImageWindow.windows;
   if ( windows.length == 0 )
   {
      new MessageBox( "Aucune image ouverte.", "BatchSaveWorkspace",
                      StdIcon_Information, StdButton_Ok ).execute();
      return;
   }

   loadSettings();
   var dlg = new BatchSaveDialog( windows );
   if ( !dlg.execute() )
      return;
   saveSettings();

   var list = dlg.selected();
   var dir = CFG.outDir.replace( /\\/g, "/" );
   if ( dir.length > 0 && dir[dir.length - 1] == "/" )
      dir = dir.substring( 0, dir.length - 1 );
   var ext = FORMATS[CFG.format].ext;

   console.show();
   console.writeln( "<end><cbr><br><b>BatchSaveWorkspace</b> — " + list.length + " image(s) vers " + dir );

   var saved = 0, skipped = 0, failed = 0;
   for ( var i = 0; i < list.length; ++i )
   {
      var w = list[i];
      var path = dir + "/" + safeFileName( CFG.prefix + w.mainView.id + CFG.suffix ) + ext;
      if ( File.exists( path ) && !CFG.overwrite )
      {
         console.warningln( "Existe déjà, ignoré : " + path );
         ++skipped;
         continue;
      }
      try
      {
         // saveAs( chemin, queryOptions, allowMessages, strict, verifyOverwrite )
         if ( w.saveAs( path, false, false, false, false ) )
         {
            console.writeln( "Enregistré : " + path );
            ++saved;
            if ( CFG.closeAfter )
               w.forceClose();
         }
         else
         {
            console.criticalln( "Échec : " + path );
            ++failed;
         }
      }
      catch ( e )
      {
         console.criticalln( "Échec : " + path + " — " + ((e && e.message) ? e.message : String( e )) );
         ++failed;
      }
      processEvents();
   }

   console.noteln( "Terminé : " + saved + " enregistrée(s), " + skipped + " ignorée(s), " + failed + " échec(s)." );
}

main();
