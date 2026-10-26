// Die cut: EMBA and McKinley cannot die cut; Shanghai rotary die only; 86" Jumbo partial die cuts only (hand holes).
// Machine specs from "Machine Specification Sheets", Ontario plant, Rev. 10/7/2026.
// Sheet W = width, L = length, inches. speed = Daily Production Report standard speed (Sept 2026),
// setup = standard setup minutes (EST on the spec sheets). minQty = machine minimum order quantity.
export const SPEC_REV = 'Rev. 10/7/2026';

export const MACHINES = [
  { id: 147, dieCut: 'none', name: '42" Emba FFG', type: 'FFG', crew: 3, crewTxt: '3', speed: 3316, setup: 30, maxColor: 2, minQty: 50,
    minW: 11.0, minL: 23.65, maxW: 41.35, maxL: 94.5, skipFeedMaxW: 55.15, twoPanel: true,
    notes: 'Hand feed and hand stack. Top print, cold glue, slot 0.25". Skip-feed takes sheets up to 55.15" wide. Max bundle 25 SW / 15 DW, 12" high. Anilox 280 (1st) / 260 (2nd).' },
  { id: 144, dieCut: 'none', name: '66" McKinley FFG', type: 'FFG', crew: 3, crewTxt: '3 (up to 5)', speed: 793, setup: 45, maxColor: 2, minQty: 100,
    minW: 16.0, minL: 25.5, maxW: 66.0, maxL: 116.0, maxUpOk: 3,
    notes: 'Hand feed and hand stack. Bottom print, cold glue, glue tab 1.5", slot 0.375". Max bundle 25 SW / 15 DW, 12" high. Anilox 250 both stations.' },
  { id: 132, dieCut: 'rotary', name: '66" Shanghai RDC Slotter', type: 'PRESS', crew: 2, crewTxt: '2 (up to 3)', speed: 1266, setup: 45, maxColor: 2, minQty: 100,
    minW: 16.0, minL: 22.0, maxW: 66.0, maxL: 139.0, maxUpOk: 2, maxRule: 1000,
    notes: 'Hand feed. Top print, rotary die cutting, slot 0.375". Max rule 1,000" (more needs production OK). Rotary die boards over 10 ft are cut in half. OPF orders over 1,000 pcs need a rotary die board. Anilox 220 (1st) / 250 (2nd).' },
  { id: 126, dieCut: 'partial', name: '86" Jumbo Press', type: 'PRESS', crew: 2, crewTxt: '2', speed: 407, setup: 60, maxColor: 1, minQty: 100,
    minW: 24.0, minL: 24.0, maxW: 86.0, maxL: 205.0, maxUpOk: 2,
    notes: 'Hand feed. One color, top print, attachments, slot 0.375". Printable area 86" × 200". Anything over 86" needs production approval. Anilox 220.' },
  { id: 137, dieCut: 'flat', name: 'Large Marumatsu FBDC', type: 'FLATBED', crew: 2, crewTxt: '2', speed: 600, setup: 45, maxColor: 0, minQty: 100, qtyUnit: 'sheets',
    minW: 15.75, minL: 23.5625, maxW: 47.1875, maxL: 66.125, maxRule: 800,
    notes: 'Flat die cutter, hand feed/stack. Max die cut 46 7/16" × 65 5/16". Die board 20 13/16" × 24 3/8" up to 48 3/8" × 72 7/16". Max rule 800" (more needs production OK). Hand stripping and bundling available.' },
  { id: 138, dieCut: 'flat', name: 'Small Marumatsu FBDC', type: 'FLATBED', crew: 2, crewTxt: '2', speed: 553, setup: 40, maxColor: 0, minQty: 100, qtyUnit: 'sheets',
    minW: 11.85, minL: 21.65, maxW: 40.15, maxL: 55.1, maxRule: 500,
    notes: 'Flat die cutter, hand feed/stack. Max die cut 54.30" × 39.35" (55.50" × 40.15" with stripping knife). Die board 21.65" × 18.15" up to 61.40" × 41.30". Max rule 500" (more needs production OK). Hand stripping and bundling available.' },
];

// Slitters: any order under 2,000 sq ft runs on the slitter from stock sheets.
export const SLITTERS = [
  { id: 110, name: '142" Slitter', minW: 12, minL: 12, maxW: 80, maxL: 142 },
  { id: 111, name: '120" Slitter', minW: 12, minL: 12, maxW: 80, maxL: 119 },
];
export const SMALL_ORDER_SQFT = 2000;

export const RUN_FLUTES = ['E', 'B', 'C', 'BC'];

// EMBA two-panel rule: panels 1+2 and 3+4 (L + W for an RSC) between 11 13/16" and 47 1/4"; any single panel at least 4 15/16".
const EMBA_PAIR_MIN = 11.8125, EMBA_PAIR_MAX = 47.25, EMBA_PANEL_MIN = 4.9375;

// Estimated blank (sheet) size for a folding carton style from inside L×W×D.
export function estimateBlank({ style, L, W, D }) {
  if (!(L > 0 && W > 0 && D > 0)) return null;
  const joint = 1.25;
  const flaps = style === 'HSC' ? W / 2 : style === 'FOL' ? 2 * W : W;
  if (!['RSC', 'HSC', 'FOL'].includes(style)) return null;
  return { sheetL: 2 * L + 2 * W + joint, sheetW: D + flaps };
}

const inRange = (v, lo, hi) => v >= lo - 1e-9 && v <= hi + 1e-9;
const fmtRule = (x) => (Math.round(x * 100) / 100).toLocaleString('en-US');
const fmt = (x) => `${Math.round(x * 100) / 100}"`;

// Order square footage (sheets × sheet area). qty is boxes; number-up boxes come off one sheet.
export function orderSqft({ sheetW, sheetL, qty, up = 1 }) {
  if (!(sheetW > 0 && sheetL > 0 && qty > 0)) return 0;
  return Math.ceil(qty / Math.max(1, up)) * (sheetW * sheetL) / 144;
}

export function checkMachine(m, o) {
  const fails = [], warns = [], oks = [];
  const { sheetW: w, sheetL: l } = o;
  const slotted = ['RSC', 'HSC', 'FOL'].includes(o.style);
  const glued = slotted || o.style === 'DST' || o.style === 'Tube'; // styles that need a folder-gluer

  // Size
  {
    const wOk = inRange(w, m.minW, m.maxW), lOk = inRange(l, m.minL, m.maxL);
    if (wOk && lOk) oks.push(`Sheet ${fmt(w)} × ${fmt(l)} fits (${fmt(m.minW)}–${fmt(m.maxW)} × ${fmt(m.minL)}–${fmt(m.maxL)})`);
    else if (lOk && m.skipFeedMaxW && inRange(w, m.minW, m.skipFeedMaxW)) warns.push(`Width ${fmt(w)} is over ${fmt(m.maxW)}. Only runs with skip-feed (up to ${fmt(m.skipFeedMaxW)})`);
    else if (inRange(l, m.minW, m.maxW) && inRange(w, m.minL, m.maxL)) {
      // fits only when turned: a "Check", since turning changes the grain (flute) direction through the machine
      warns.push(`Fits only if the sheet is turned 90° (${fmt(l)} × ${fmt(w)}). This changes the grain direction. Confirm with the supervisor`);
    } else {
      if (!wOk) fails.push(`Sheet width ${fmt(w)} is outside ${fmt(m.minW)}–${fmt(m.maxW)}`);
      if (!lOk) fails.push(`Sheet length ${fmt(l)} is outside ${fmt(m.minL)}–${fmt(m.maxL)}`);
    }
  }

  // Flute
  if (o.flute && !RUN_FLUTES.includes(o.flute)) fails.push(o.flute === 'SF' ? 'We do not run single face' : `We do not run ${o.flute} flute`);

  // Print
  const colors = o.colors || 0;
  if (m.type === 'FLATBED') {
    if (colors > 0) warns.push('No print units. Sheets must be printed on another machine first');
  } else if (colors > m.maxColor) fails.push(`${colors} colors; this machine prints ${m.maxColor} max`);
  else if (colors > 0) oks.push(`${colors} color${colors > 1 ? 's' : ''} OK (max ${m.maxColor})`);

  // Style / routing
  // EMBA / McKinley (FFG) run only RSC, HSC, FOL, DST (size permitting) and scored tubes; no die cutting, no hand holes
  let printOnly = false;
  if (m.type === 'FFG') {
    if (o.handholes) fails.push('Cannot do hand holes');
    if (o.style === 'DST') warns.push('DST runs depending on the size. Confirm with production');
    else if (o.style === 'Tube') oks.push('Scored tube OK');
    else if (o.style === 'Other') fails.push('Not a style this machine runs. It only runs RSC, HSC, FOL, DST and scored tubes');
    else if (o.style === 'Sheet') {
      if (colors > 0) { warns.push('Print only (depending on the size). Sheets go on to the next step after printing'); printOnly = true; }
      else fails.push('Only runs RSC, HSC, FOL, DST and scored tubes. Nothing to print on this sheet');
    }
  }
  if (glued && !slotted && m.type !== 'FFG') {
    if (m.type === 'PRESS') warns.push('No folder-gluer. Joint must be glued or stitched separately');
    if (m.type === 'FLATBED') warns.push('Die cutter. Not the usual route for this style');
  }
  if (slotted) {
    if (m.type === 'PRESS') warns.push('No folder-gluer. Joint must be glued or stitched separately');
    if (m.type === 'FLATBED') warns.push('Die cutter. Not the usual route for a slotted box');
  }
  // Die cutting: EMBA/McKinley can't die cut (print only); Shanghai = rotary die only; Jumbo = partial cuts only (hand holes)
  if (o.style === 'Die Cut') {
    if (m.dieCut === 'none') {
      if (colors > 0) { warns.push('Cannot die cut. Can only print the sheets (depending on the size), then die cut on the Shanghai (rotary) or a Marumatsu'); printOnly = true; }
      else fails.push('Cannot die cut, and there is no print for it to do');
    } else if (m.dieCut === 'partial') warns.push('Partial die cuts only (hand holes, vents). Cannot do a full die cut');
    else if (m.dieCut === 'rotary') oks.push('Die cut must be a rotary die (rotary die board)');
    else if (m.dieCut === 'flat') oks.push('Flat die cut');
  }

  // Panel rules (slotted boxes with L and W known)
  if (slotted && m.type === 'FFG' && o.L > 0 && o.W > 0) {
    if (m.twoPanel) {
      const pair = o.L + o.W, small = Math.min(o.L, o.W);
      if (pair < EMBA_PAIR_MIN) fails.push(`L + W is ${fmt(pair)}; two panels together must be at least 11 13/16"`);
      else if (pair > EMBA_PAIR_MAX) fails.push(`L + W is ${fmt(pair)}; two panels together can't be over 47 1/4"`);
      else if (small < EMBA_PANEL_MIN) fails.push(`Smallest panel is ${fmt(small)}; minimum single panel is 4 15/16"`);
      else oks.push(`Panels OK (L + W ${fmt(pair)}, within 11 13/16"–47 1/4")`);
    }
    if (o.D > 0 && o.D <= 3) oks.push('Depth 3" or less: extended glue tab recommended');
  }

  // Inches of rule on the cutting die (die cutters only)
  if (o.rule > 0 && m.maxRule && (m.dieCut === 'flat' || m.dieCut === 'rotary')) {
    // Over the max is a "Check", not a hard stop: production can sometimes run a little over
    if (o.rule > m.maxRule + 1e-9) warns.push(`Die has ${fmtRule(o.rule)}" of rule; max on this machine is ${fmtRule(m.maxRule)}". See the production department`);
    else oks.push(`Rule ${fmtRule(o.rule)}" OK (max ${fmtRule(m.maxRule)}")`);
  }

  // Number up
  if (o.up > 1 && m.maxUpOk && o.up > m.maxUpOk) warns.push(`${o.up}-up needs supervisor sign-off on this machine (over ${m.maxUpOk}-up)`);

  // Minimum quantity (die cutters count sheets)
  if (o.qty > 0 && m.minQty) {
    const n = m.qtyUnit === 'sheets' ? Math.ceil(o.qty / Math.max(1, o.up || 1)) : o.qty;
    if (n < m.minQty) warns.push(`Under the machine minimum of ${m.minQty} ${m.qtyUnit || 'pcs'} (${n} ${m.qtyUnit || 'pcs'})`);
  }

  const status = fails.length ? 'fail' : warns.length ? 'warn' : 'pass';
  return { machine: m, status, fails, warns, oks, printOnly: printOnly && !fails.length };
}

// Pass first, then warn, then fail. Within a group: faster, then smaller crew.
// Ways to lay out N pieces on one sheet: [across the width, along the length]
export function layoutsFor(up) { const r = []; for (let a = 1; a <= up; a++) if (up % a === 0) r.push([a, up / a]); return r; }

// order.upMode === 'piece' with up > 1: the size entered is one piece, so each machine tries every layout of the
// pieces on a sheet and keeps the one that suits it best (no trim allowance between pieces is added).
export function checkAll(order) {
  const rank = { pass: 0, warn: 1, fail: 2 };
  const multi = order.upMode === 'piece' && order.up > 1 && order.sheetW > 0 && order.sheetL > 0;
  return MACHINES.map((m) => {
    if (!multi) return checkMachine(m, order);
    let best = null;
    for (const [nx, ny] of layoutsFor(order.up)) {
      const w = order.sheetW * nx, l = order.sheetL * ny;
      const r = checkMachine(m, { ...order, sheetW: w, sheetL: l });
      const score = rank[r.status] * 1000 + r.fails.length * 100 + r.warns.length * 10 + Math.abs(w - l) / 100;
      if (!best || score < best.score) best = { ...r, score, layout: { nx, ny, w, l } };
    }
    best.oks.unshift(`${order.up}-up laid out ${best.layout.nx} across × ${best.layout.ny} along: sheet ${fmt(best.layout.w)} × ${fmt(best.layout.l)}`);
    return best;
  })
    .sort((a, b) => rank[a.status] - rank[b.status] || b.machine.speed - a.machine.speed || a.machine.crew - b.machine.crew);
}

// Run hours at the DPR standard speed, plus standard setup.
export function runHours(m, qty, up = 1) {
  if (!(qty > 0) || !m.speed) return 0;
  const units = m.qtyUnit === 'sheets' ? Math.ceil(qty / Math.max(1, up)) : qty / Math.max(1, up);
  return units / m.speed + (m.setup || 0) / 60;
}

// Small-order policy: under 2,000 sq ft → slitter from stock sheets.
export function slitterCheck(o) {
  const sqft = orderSqft(o);
  if (!sqft || sqft >= SMALL_ORDER_SQFT) return null;
  const fits = SLITTERS.filter((s) => (inRange(o.sheetW, s.minW, s.maxW) && inRange(o.sheetL, s.minL, s.maxL)) || (inRange(o.sheetL, s.minW, s.maxW) && inRange(o.sheetW, s.minL, s.maxL)));
  return { sqft, fits, under12: o.sheetW < 12 || o.sheetL < 12 };
}
