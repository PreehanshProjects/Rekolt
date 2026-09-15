# Rekolt

Premium editorial landing page for Rekolt, a Mauritius produce grower and supplier. Static HTML, CSS and JavaScript; no build step or runtime dependencies.

## Preview

Run `python -m http.server 4173 --bind 127.0.0.1` from this folder, then open `http://127.0.0.1:4173`.

## Files

- `index.html`: page and all 45 products (43 produce items plus two fresh pastas), with published prices or “On request”. Includes all 40 items from the owner's 15 September 2026 handwritten inventory; 27 were added; the duplicate Micro Green entry was merged into Barquette Herbes at its existing Rs 2,000 per barquette rate.
- `styles.css`: responsive forest-green and ivory design, self-hosted Bodoni Moda and Archivo.
- `enhancements.css`: catalogue search, selection feedback and responsive order panel.
- `app.js`: English/French ingredient search, category filtering, herb weight units, persistent order list, quantities, optional business details and notes, accessible order panel, and clipboard/WhatsApp handoff.
- `assets/logo/`: supplied Rekolt identity. The header and footer display the original PNG in an inline SVG viewport that removes surrounding empty space without changing the artwork.
- `assets/editorial/`: optimized WebP editorial imagery and generation provenance.
- `DESIGN.md`: design decisions and verification notes.

The previous Blender images and generation scripts remain in `assets/produce/` and `render/` for reference; the website no longer uses them.

## Before launch

WhatsApp ordering is configured for **+230 5756 3134** (`23057563134` in `app.js`). The order button opens a message containing the selected products, quantities and estimated total; the footer offers direct contact. WhatsApp links also work without JavaScript. Email remains optional and hidden until supplied in `CONFIG`.

The 27 new products, ravioli and lasagne remain **On request** and are excluded from estimates. Orders containing only unpriced items display “On request”; mixed orders show a subtotal plus a quote. Set both the visible price and its matching `data-price` attribute when a rate is supplied, remove `data-onrequest="1"`, and replace the `.ask` markup with the same Rs/number markup used by priced rows. Do not invent rates, fillings, delivery days, minimums or contact information.

Photo units are preserved: `pc` means piece and `BQ` means barquette. Herb trays and sachets use their named packaging. New items without a supplied unit use `data-unit-label="pending"` and display “Unit to confirm”; their order quantities do not imply a weight or pack size. Confirm the unit alongside the price before publishing a rate. Garlic and ginger now appear under vegetables as in the inventory, retaining their existing 500 g / 1 kg pricing. Strawberries appear under fruits.

Produce prices are stored in each `.line` element, alongside the visible price. Herbs use `data-price500` and `data-pricekg`. Update both displayed and data values together.

Editorial imagery was created with the built-in image generation tool, optimized to WebP and saved locally. It is disclosed in the footer; it does not document Rekolt's stock. Replace it with commissioned photography when available. Prompts are recorded in `assets/editorial/PROVENANCE.md`.

## Verification

The site has no runtime dependencies. Install the development-only browser test tools and run:

```sh
npm ci
npx playwright install chromium
npm test
```

The test runner starts and stops its own local server. `tests/site.cjs` checks ingredient searches in English/French, categories, selection, weight units, quantities, quoted pasta exclusion, clipboard output, persistence and clearing. It verifies the WhatsApp destination and exact message, including optional notes, without sending a message. It checks the order panel, keyboard focus, returning to the catalogue, eight viewport widths from 320 to 1920 pixels, asset loading and the no-JavaScript fallback. Screenshots are saved to `tmp/preview/`.

## Deployment

Deploy this directory as a static site. `vercel.json` contains routing and headers. `.vercelignore` excludes local verification files, design notes and the retired Blender assets from deployment.
