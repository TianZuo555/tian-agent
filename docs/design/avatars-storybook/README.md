# Storybook avatar study

A separate, static visual study of the existing four Tian identities. Open [index.html](index.html) for the illustrated sheet, individual downloads, and small-size previews.

- [storybook-sheet.svg](storybook-sheet.svg): 1400 × 900 illustrated sheet with a quiet farm landscape.
- [chief-sun.svg](chief-sun.svg): golden sun, detached petal rays, freckles and happy eyes.
- [manager-atlas.svg](manager-atlas.svg): sage Earth with round brown glasses.
- [manager-juno.svg](manager-juno.svg): apricot Saturn with a cream ring.
- [manager-vega.svg](manager-vega.svg): lavender planet with a dusty-rose beret.

Each portrait has a 320 × 320 viewBox and a transparent background. The art uses editable SVG paths, gradients, colour washes, pencil hatching, and seeded SVG turbulence filters for pigment and grain. No bitmap images, scripts, external fonts, or network dependencies are embedded in the SVGs. Texture rendering can vary between SVG viewers; use a modern browser for reference. The sheet uses the local Georgia serif font, with a serif fallback.

This study does not replace the current client avatars or their 25 animated states. It has no animation or runtime-state mapping. The countryside setting belongs to the presentation sheet; the separate portraits remain usable on other backgrounds.

To regenerate the five SVG files from the source:

```sh
mise exec -- node docs/design/avatars-storybook/build-assets.mjs
```

Validation: all five SVGs parse as XML. Check the preview in a browser after changing the generator, including the 40–80 px samples.
