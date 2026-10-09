// Pure pallet math (no DOM) so it can be tested on its own.

// Typical board caliper per piece, inches. Placeholder values — edit on screen if your board runs different.
export const CALIPER = { E: 0.0625, B: 0.125, C: 0.156, BC: 0.281 };

// Pallet sizes written Width x Length (inches), the way they're ordered.
export const STANDARD_PALLETS = [
  [30, 30], [36, 36], [40, 40], [42, 42], [44, 44], [48, 48],
  [36, 48], [40, 48], [42, 48], [44, 48], [48, 52], [48, 60], [48, 72], [48, 84], [48, 96], [54, 72], [60, 72],
];

// Flat (folded/glued) size of one piece on the pallet.
// RSC/HSC/FOL ship glued and folded flat: length = L + W, width = D + flaps.
// Each folded box is 2 layers of board thick; a sheet/blank is 1 layer.
export function flatPiece({ style, L, W, D, sheetW, sheetL, caliper }) {
  if (style === 'SHEET') return { a: sheetL, b: sheetW, h: caliper, layers: 1 };
  const flaps = style === 'HSC' ? W / 2 : style === 'FOL' ? 2 * W : W; // RSC: two half-width flaps
  return { a: L + W, b: D + flaps, h: caliper * 2, layers: 2 };
}

const fit = (space, size) => (size > 0 ? Math.floor((space + 1e-9) / size) : 0);

function grid(x0, y0, w, l, a, b) {
  const nx = fit(w, a), ny = fit(l, b);
  const rects = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) rects.push({ x: x0 + i * a, y: y0 + j * b, w: a, l: b });
  return rects;
}

// Best single-layer pattern of a×b pieces in an X×Y area: straight grid, rotated grid,
// or a two-block pattern (part straight, part turned 90°). Rotation allowed for all styles.
export function bestPattern(X, Y, a, b) {
  const cands = [];
  for (const [p, q] of [[a, b], [b, a]]) {
    cands.push(grid(0, 0, X, Y, p, q));
    // split along X: first block p×q, remainder q×p
    for (let i = 1; i < fit(X, p); i++) cands.push([...grid(0, 0, i * p, Y, p, q), ...grid(i * p, 0, X - i * p, Y, q, p)]);
    // split along Y
    for (let j = 1; j < fit(Y, q); j++) cands.push([...grid(0, 0, X, j * q, p, q), ...grid(0, j * q, X, Y - j * q, q, p)]);
  }
  let best = cands[0];
  for (const c of cands) if (c.length > best.length) best = c;
  if (!best.length) return { rects: [], count: 0, usedX: 0, usedY: 0 };
  const usedX = Math.max(...best.map((r) => r.x + r.w)), usedY = Math.max(...best.map((r) => r.y + r.l));
  return { rects: best, count: best.length, usedX, usedY };
}

// Full load for one pallet size.
// pallet: { w, l } (inches), overhang per side, maxStack = product height limit (no pallet).
export function loadFor({ piece, pallet, overhang = 0, maxStack, bundle }) {
  const X = pallet.l + 2 * overhang, Y = pallet.w + 2 * overhang;
  const pat = bestPattern(X, Y, piece.a, piece.b);
  // center the pattern on the pallet (x along pallet length, y along width; origin = pallet corner)
  const offX = (pallet.l - pat.usedX) / 2, offY = (pallet.w - pat.usedY) / 2;
  const rects = pat.rects.map((r) => ({ ...r, x: r.x + offX, y: r.y + offY }));
  const perStackMax = Math.floor((maxStack + 1e-9) / piece.h);
  let tierPieces, tiers;
  if (bundle > 0) { tierPieces = bundle; tiers = Math.floor(perStackMax / bundle); }
  else { tierPieces = perStackMax; tiers = perStackMax > 0 ? 1 : 0; }
  const perStack = tierPieces * tiers;
  const perPallet = pat.count * perStack;
  return {
    rects, cols: pat.count, tiers, tierPieces, perStack, perPallet,
    tierHeight: tierPieces * piece.h,
    stackHeight: perStack * piece.h,
    footprintUse: pat.count ? (pat.count * piece.a * piece.b) / (pallet.l * pallet.w) : 0,
    overhangX: Math.max(0, (pat.usedX - pallet.l) / 2), overhangY: Math.max(0, (pat.usedY - pallet.w) / 2),
  };
}

export function palletsNeeded(qty, perPallet) {
  if (!(perPallet > 0) || !(qty > 0)) return { pallets: 0, lastPallet: 0 };
  const pallets = Math.ceil(qty / perPallet);
  return { pallets, lastPallet: qty - (pallets - 1) * perPallet };
}

// Rank standard sizes: fewest pallets, then smallest pallet (less wood, less overhang risk), then best footprint use.
export function recommend({ piece, qty, overhang, maxStack, bundle, sizes = STANDARD_PALLETS }) {
  const rows = [];
  for (const [w, l] of sizes) {
    const ld = loadFor({ piece, pallet: { w, l }, overhang, maxStack, bundle });
    if (!ld.perPallet) continue;
    const { pallets } = palletsNeeded(qty || ld.perPallet, ld.perPallet);
    rows.push({ w, l, ...ld, pallets });
  }
  if (qty > 0) rows.sort((p, q) => p.pallets - q.pallets || p.w * p.l - q.w * q.l || q.footprintUse - p.footprintUse);
  else rows.sort((p, q) => q.footprintUse - p.footprintUse || q.perPallet - p.perPallet);
  return rows;
}
