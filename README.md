# Production Hub — GoldenWest Ontario

One site for the floor: Ink Calculator, Pallet Calculator (3D), Stock Sheet Calculator, Shift Handoff Log, New Order Checker.

- Access code: set in Netlify as the secret environment variable `PROD_ACCESS_CODE` (not stored in this repo). Change it there, then redeploy.
- Handoff entries are stored in Netlify Blobs (store `shift-handoffs`); the uploaded stock Export list in store `stock-sheets`
- Photo / quote reading uses Netlify AI Gateway (no API key needed; billed in Netlify credits)

## Files
- `public/` — the website (index.html, app.css, js/)
- Ink math is in `public/js/ink.js`; pallet math in `palletcalc.js`; stock math in `stockcalc.js`; machine specs in `ordercalc.js`
- `netlify/functions/ai.mts` — reads sample photos and quotes
- `netlify/functions/handoff.mts` — saves and lists shift handoffs
- `netlify/functions/stock.mts` — shares the latest uploaded stock Export list
- `netlify/functions/pallets.mts` — shares the latest uploaded pallet price list (store `pallet-prices`); built-in default is the 7/1/26 list

## Deploy
Netlify project: `gwpg-production`. Connect this repo (build settings come from `netlify.toml`).
