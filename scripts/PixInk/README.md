# PixInk

A free-hand brush tool for [PixInsight](https://pixinsight.com), built entirely in PJSR
(PixInsight's JavaScript Runtime), in the spirit of Photoshop's brush: color, size,
opacity, and edge softness ("Degrade"), all adjustable on the fly while you paint
directly on the active image.

PixInsight has no native brush tool comparable to Photoshop's. This script builds one:
a scrollable/zoomable canvas inside its own dialog (PJSR cannot hook mouse events on a
real ImageWindow viewport), a working-copy-first editing workflow (nothing touches the
real image until you click "Apply"), and a proper per-stroke opacity cap with a smooth
radial hardness falloff for the brush edge.

## Features

- **Color** -- a clickable swatch opens PixInsight's own color picker
  (`SimpleColorDialog`). On a mono image the picker is grayscale-only.
- **Size** -- brush diameter in image pixels, adjustable via the slider or by holding
  Ctrl + right-click-drag directly on the image.
- **Opacity** -- capped *per stroke*: overlapping dabs within one continuous stroke
  never exceed the chosen opacity, but re-painting a separate stroke darkens further
  (same behavior as Photoshop's Opacity, not Flow).
- **Degrade** -- 0% = hard edge, 100% = fully soft edge (a smoothstep falloff, i.e. the
  inverse of Photoshop's "Hardness").
- **STF auto** -- optional auto-stretch for the on-screen preview only; never touches
  the actual pixel data, on mono or color images alike.
- Multi-level undo (one entry per stroke), a one-click reset to the original image, and
  a single Ctrl+Z-undoable commit to the real view via "Apply".

## Installation

### Via PixInsight's own Update Manager (recommended)

1. In PixInsight: `Resources > Updates > Manage Repositories...` -> `Add`, and paste:
   ```
   https://raw.githubusercontent.com/Johnpetrucci28/PixInk/main/repo/
   ```
2. `Resources > Updates > Check for Updates...`, select PixInk, install.
3. The script appears under `Script > PixInk > Pinceau` (restart PixInsight, or
   `Script > Feature Scripts > Update`, if the menu doesn't refresh automatically).

### Manual install

Copy `PixInk.js` into `<PixInsight install dir>/src/scripts/PixInk/PixInk.js`, or add
this repository's folder via `Script > Feature Scripts...`.

## Why it works the way it does

Every pixel value that actually gets committed is computed by hand on plain typed
arrays (stroke rasterization, color/opacity blending) rather than through Graphics/
Bitmap's native composition modes, whose exact behavior with alpha isn't documented
well enough to trust on data that matters. Graphics/Bitmap are only ever used for the
on-screen preview (the cursor ring, the in-progress stroke) -- purely cosmetic, never
read back.

## License

No license file is included yet -- all rights reserved by default until a license is
chosen.
