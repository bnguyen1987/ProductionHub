// Pure pallet math (no DOM) so it can be tested on its own.

// Typical board caliper per piece, inches. Placeholder values — edit on screen if your board runs different.
export const CALIPER = { E: 0.0625, B: 0.125, C: 0.156, BC: 0.281 };

// Generated from QF-582 Board Calipers Rev. 2 (mill combined board caliper standard). Caliper = MAXIMUM column.
// Weight (lb/MSF) is an ESTIMATE from the paper components: liners + medium × flute take-up (B 1.35, C 1.44, E 1.24) + starch.
// [grade, max caliper (in), est. lb/MSF, paper components]
export const MILL_BOARD = {"E": [["150E",0.079,105,"35HP/23M/35HP"],["175E",0.08,112,"42K/23M/35HP"],["200E",0.081,119,"42K/23M/42K"],["250E",0.089,146,"42K/23M/69K"],["32ECTE",0.079,105,"35HP/23M/35HP"]],"B": [["125B",0.122,98,"35HP/23M/26K"],["150B",0.124,107,"35HP/23M/35HP"],["175B",0.125,114,"42K/23M/35HP"],["200B",0.126,121,"42K/23M/42K"],["250B",0.134,148,"42K/23M/69K"],["275B",0.142,175,"69K/23M/69K"],["32ECTB",0.124,107,"35HP/23M/35HP"],["HL32ECTB",0.123,102,"35HP/23M/30HP"],["40ECTB",0.128,135,"42K/33M/42K"],["44ECTB",0.13,144,"42K/40M/42K"],["S30B",0.122,95,"35HP/23M/23M"],["S33B",0.125,114,"42K/23M/35HP"],["SP15B",0.138,162,"69K/23M/56HP"]],"C": [["125C",0.164,100,"35HP/23M/26K"],["150C",0.165,109,"35HP/23M/35HP"],["175C",0.166,116,"42K/23M/35HP"],["200C",0.167,123,"42K/23M/42K"],["250C",0.175,150,"42K/23M/69K"],["275C",0.183,177,"69K/23M/69K"],["32ECTC",0.165,109,"35HP/23M/35HP"],["HL32ECTC",0.164,104,"35HP/23M/30HP"],["40ECTC",0.169,138,"42K/33M/42K"],["44ECTC",0.171,148,"42K/40M/42K"],["S30C",0.164,97,"35HP/23M/23M"],["S33C",0.166,116,"42K/23M/35HP"],["SP15C",0.179,164,"69K/23M/56HP"]],"BC": [["200D",0.269,176,"42K/23M/26K/23M/35HP"],["275D",0.27,183,"42K/23M/26K/23M/42K"],["350D",0.272,199,"42K/23M/42K/23M/42K"],["48ECTD",0.2668,169,"35HP/23M/26K/23M/35HP"],["51ECTD",0.27,178,"35HP/23M/35HP/23M/35HP"],["61ECTD",0.279,220,"56HP/23M/35HP/23M/56HP"],["SD45",0.267,164,"42K/23M/23M/23M/26K"],["SD43",0.269,173,"42K/23M/23M/23M/35HP"],["SD47",0.27,180,"42K/23M/23M/23M/42K"],["SD49",0.271,192,"42K/23M/35HP/23M/42K"],["SP45D",0.268,166,"35HP/23M/23M/23M/35HP"],["450D",0.295,280,"69K/23M/69K/23M/69K"]]};

export const GRADES_BY_FLUTE = Object.fromEntries(Object.entries(MILL_BOARD).map(([f, rows]) => [f, rows.map((r) => r[0])]));
export const DEFAULT_GRADE = { E: '200E', B: '200B', C: '200C', BC: '275D' };

// Caliper (mill MAXIMUM) and estimated weight for a flute + grade. Accepts old short grades like "200" too.
export function boardSpec(flute, grade) {
  const rows = MILL_BOARD[flute] || MILL_BOARD.C;
  const g = String(grade || '').toUpperCase();
  const row = rows.find((r) => r[0] === g) || rows.find((r) => g && r[0].startsWith(g)) || rows.find((r) => r[0] === DEFAULT_GRADE[flute]) || rows[0];
  return { grade: row[0], caliper: row[1], lbsMsf: row[2], components: row[3] };
}

// Pallet sizes written Width x Length (inches), the way they're ordered.
export const STANDARD_PALLETS = [
  [30, 30], [36, 36], [40, 40], [42, 42], [44, 44], [48, 48],
  [36, 48], [40, 48], [42, 48], [44, 48], [48, 52], [48, 60], [48, 72], [48, 84], [48, 96], [54, 72], [60, 72],
];

// Flat (folded/glued) size of one piece on the pallet.
// RSC/HSC/FOL ship glued and folded flat: length = L + W, width = D + flaps.
// Each folded box is 2 layers of board thick; a sheet/blank is 1 layer.
export function flatPiece({ style, L, W, D, sheetW, sheetL, caliper }) {
  if (style === 'SHEET') return { a: sheetL, b: sheetW, h: caliper, layers: 1, areaSqIn: sheetL * sheetW };
  const flaps = style === 'HSC' ? W / 2 : style === 'FOL' ? 2 * W : W; // RSC: two half-width flaps
  // board area ≈ the unfolded blank: (2L + 2W + 1.25" joint) × (D + flaps)
  return { a: L + W, b: D + flaps, h: caliper * 2, layers: 2, areaSqIn: (2 * L + 2 * W + 1.25) * (D + flaps) };
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
// Chimney (pinwheel) pattern: four blocks turning around an open center "chimney".
//   A (top-left, a×b)  | B (right, turned)
//   D (left, turned)   | C (bottom-right, a×b)
// Each block can hold more than one piece. Tries both spin directions and every block size.
export function chimneyPattern(X, Y, a, b) {
  let best = null;
  for (const [p, q] of [[a, b], [b, a]]) {
    const maxAx = fit(X, p), maxAy = fit(Y, q), maxBy = fit(Y, p), maxDx = fit(X, q);
    for (let nAx = 1; nAx <= maxAx; nAx++) for (let nAy = 1; nAy <= maxAy; nAy++) {
      const xA = nAx * p, yA = nAy * q;
      const nBx = fit(X - xA, q), nDy = fit(Y - yA, p);
      if (!nBx || !nDy) continue;
      for (let nBy = 1; nBy <= maxBy; nBy++) {
        const yB = nBy * p;
        for (let nDx = 1; nDx <= maxDx; nDx++) {
          const xD = nDx * q;
          // blocks must not collide: the pinwheel has to spin one way or the other
          if (!((xD <= xA + 1e-9 && yB >= yA - 1e-9) || (xD >= xA - 1e-9 && yB <= yA + 1e-9))) continue;
          const nCx = fit(X - xD, p), nCy = fit(Y - yB, q);
          if (!nCx || !nCy) continue;
          const count = nAx * nAy + nBx * nBy + nDx * nDy + nCx * nCy;
          if (!best || count > best.count) best = { count, p, q, nAx, nAy, nBx, nBy, nDx, nDy, nCx, nCy, xA, yA, yB, xD };
        }
      }
    }
  }
  if (!best) return { rects: [], count: 0, usedX: 0, usedY: 0, chimney: null };
  const { p, q, xA, yA, yB, xD } = best;
  const rects = [
    ...grid(0, 0, xA, yA, p, q),                       // A
    ...grid(xA, 0, best.nBx * q, yB, q, p),            // B
    ...grid(0, yA, xD, best.nDy * p, q, p),            // D
    ...grid(xD, yB, best.nCx * p, best.nCy * q, p, q), // C
  ];
  const usedX = Math.max(...rects.map((r) => r.x + r.w)), usedY = Math.max(...rects.map((r) => r.y + r.l));
  const hole = { x: Math.min(xA, xD), y: Math.min(yA, yB), w: Math.abs(xA - xD), l: Math.abs(yB - yA) };
  return { rects, count: rects.length, usedX, usedY, chimney: hole };
}

// mode: 'auto' (most pieces of any pattern), 'straight' (straight / two-block columns), 'chimney'
export function patternFor(X, Y, a, b, mode = 'auto') {
  if (mode === 'chimney') return { ...chimneyPattern(X, Y, a, b), kind: 'chimney' };
  const straight = { ...bestPattern(X, Y, a, b), kind: 'straight' };
  if (mode === 'straight') return straight;
  const ch = chimneyPattern(X, Y, a, b);
  return ch.count > straight.count ? { ...ch, kind: 'chimney' } : straight;
}

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
export function loadFor({ piece, pallet, overhang = 0, maxStack, bundle, mode = 'auto' }) {
  const X = pallet.l + 2 * overhang, Y = pallet.w + 2 * overhang;
  const pat = patternFor(X, Y, piece.a, piece.b, mode);
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
    rects, cols: pat.count, kind: pat.kind, chimney: pat.chimney ? { ...pat.chimney, x: pat.chimney.x + offX, y: pat.chimney.y + offY } : null, tiers, tierPieces, perStack, perPallet,
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

// Two of the same pallet pushed together. join 'width' = side by side across the width (2W × L),
// join 'length' = end to end (W × 2L). Returns the better of the two joins (more pieces, then less overhang).
export function loadTwo({ piece, pallet, overhang = 0, maxStack, bundle, mode = 'auto' }) {
  const opts = [
    { join: 'width', base: { w: pallet.w * 2, l: pallet.l } },
    { join: 'length', base: { w: pallet.w, l: pallet.l * 2 } },
  ].map((o) => ({ ...o, load: loadFor({ piece, pallet: o.base, overhang, maxStack, bundle, mode }) }));
  opts.sort((x, y) => y.load.perPallet - x.load.perPallet || y.load.footprintUse - x.load.footprintUse);
  return opts[0];
}

// Rank standard sizes: fewest pallets, then smallest pallet (less wood, less overhang risk), then best footprint use.
export function recommend({ piece, qty, overhang, maxStack, bundle, mode = 'auto', two = false, sizes = STANDARD_PALLETS }) {
  const rows = [];
  for (const [w, l] of sizes) {
    let ld, extra = {};
    if (two) { const t = loadTwo({ piece, pallet: { w, l }, overhang, maxStack, bundle, mode }); ld = t.load; extra = { join: t.join, base: t.base }; }
    else ld = loadFor({ piece, pallet: { w, l }, overhang, maxStack, bundle, mode });
    if (!ld.perPallet) continue;
    const { pallets: units } = palletsNeeded(qty || ld.perPallet, ld.perPallet);
    rows.push({ w, l, ...ld, ...extra, units, pallets: two ? units * 2 : units });
  }
  if (qty > 0) rows.sort((p, q) => p.pallets - q.pallets || p.w * p.l - q.w * q.l || q.footprintUse - p.footprintUse);
  else rows.sort((p, q) => q.footprintUse - p.footprintUse || q.perPallet - p.perPallet);
  return rows;
}
