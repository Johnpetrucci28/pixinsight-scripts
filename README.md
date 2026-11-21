# AstrOlivier — Scripts PixInsight

Scripts PixInsight gratuits d'AstrOlivier, et le site qui les présente :
**https://johnpetrucci28.github.io/pixinsight-scripts/**

| Script | Catégorie | Menu PixInsight |
|---|---|---|
| SpectralStarMix | Couleur | Script › Utilities › SpectralStarMix |
| Mix Hα + Luminance | Couleur | Script › Execute Script File… |
| Fusion de masques (max) | Masques | Script › Utilities › FusionMasquesMax |
| DrizzleStack | Empilement | Script › Execute Script File… |
| BatchSaveWorkspace | Utilitaires | Script › Utilities › BatchSaveWorkspace |
| PixInk | Retouche | Script › PixInk › Pinceau |
| IA Stamp | Retouche | Script › IA stamp › Generative Stamp |
| Canon Banding Reduction 0.9.4 (fork) | Correction | Script › Utilities › CanonBandingReduction |

## Installation

1. Télécharger le zip du script depuis le site (ou cloner ce dépôt).
2. PixInsight : `Script › Feature Scripts…` › **Add** › choisir le dossier › **Done**.

## Organisation du dépôt

```
index.html, assets/   le site (GitHub Pages, aucune compilation)
assets/js/data.js     le catalogue : une entrée par script
scripts/<Nom>/        le code de chaque script
downloads/<Nom>.zip   archives générées par tools/build-zips.ps1
```

Ajouter un script : créer `scripts/<Nom>/`, ajouter son entrée dans `assets/js/data.js`,
lancer `tools/build-zips.ps1`, puis commit et push.

## Licences

Mes propres scripts sont sous **licence MIT** (fichier `LICENSE` dans chaque dossier).
Les forks gardent la licence et le copyright de leur auteur d'origine :
Canon Banding Reduction (Georg Viehoever, GPL v3).

PixInsight est une marque de Pleiades Astrophoto S.L.
