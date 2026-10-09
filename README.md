# Production Hub — GoldenWest Ontario

One site for the floor: Ink Calculator, Pallet Calculator (3D), Stock Sheet Calculator, Shift Handoff Log, New Order Checker.

- Access code: `gwprod-727` (change it by adding a `PROD_ACCESS_CODE` environment variable in Netlify, then redeploy)
- Handoff entries are stored in Netlify Blobs (store `shift-handoffs`)
- Photo / quote reading uses Netlify AI Gateway (no API key needed; billed in Netlify credits)

## Files
- `public/` — the website (index.html, app.css, js/)
- Ink math is in `public/js/ink.js`; pallet math in `palletcalc.js`; stock math in `stockcalc.js`; machine specs in `ordercalc.js`
- `netlify/functions/ai.mts` — reads sample photos and quotes
- `netlify/functions/handoff.mts` — saves and lists shift handoffs

## Deploy
Netlify project: `gwpg-production`. Connect this repo (build settings come from `netlify.toml`).
