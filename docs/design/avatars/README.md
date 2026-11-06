# Sun and planet avatars

Open [index.html](index.html) to compare the avatars on light and dark surfaces at 24, 32, 48, and 64 pixels. This is a separate character study; the two client mockups are unchanged.

| Role          | Asset                                  | Character                              |
| ------------- | -------------------------------------- | -------------------------------------- |
| Chief         | [chief-sun.png](chief-sun.png)         | Golden sun, rounded rays, smiling face |
| Manager Atlas | [manager-atlas.png](manager-atlas.png) | Mint Earth, round glasses              |
| Manager Juno  | [manager-juno.png](manager-juno.png)   | Peach Saturn, cream ring               |
| Manager Vega  | [manager-vega.png](manager-vega.png)   | Lavender planet, plum beret            |

Each asset is a 512 × 512 RGBA PNG with a transparent background. [preview.png](preview.png) compares both backgrounds. [source-sheet.jpg](source-sheet.jpg) preserves the generated sheet before cropping and background removal.

The characters use matte surfaces, simple dark eyes, small smiles, and gentle shading to suggest volume. They have no outer glow, bloom, or background shadow. These are raster images with a 3D appearance, not editable 3D meshes.

Generated with `antigravity/gemini-3.1-flash-image` through the configured image service, using the user's supplied icon as a style reference. The prompt requested a matching four-character sheet on white with no text, low-contrast ambient shading, clear silhouettes, and the character details listed above. The sheet was split with Pillow, the connected white background removed, and each character fitted onto a transparent square.
