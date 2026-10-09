// Machine specs transcribed from the six St. Worth Container machine spec sheets
// (same data as the earlier New Orders Checker). Sheet W = width, L = length, inches.
export const MACHINES = [
  { id: 147, name: '42" Emba FFG', model: 'EMBA 245 QS Ultima', type: 'FFG', crew: 3, crewTxt: '3', speed: 3000, maxColor: 2,
    minW: 11.0, minL: 23.65, maxW: 41.35, maxL: 94.5, skipFeedMaxW: 55.15,
    notes: 'Hand feed and hand stack. Skip-feed extends max sheet width to 55.15" if the job qualifies. Anilox 280 (1st) / 260 (2nd).' },
  { id: 144, name: '66" McKinley FFG', model: 'EMBA 245 QS Ultima', type: 'FFG', crew: 3, crewTxt: '3 (up to 5)', speed: 1300, maxColor: 2,
    minW: 16.0, minL: 25.5, maxW: 66.0, maxL: 118.0, maxUpOk: 3,
    notes: 'Cold glue. Extended glue tab recommended for depth 3" or less. Anilox 250 both stations.' },
  { id: 132, name: '66" Shanghai RDC Slotter', model: 'Shanghai Juer JPS-1-1636', type: 'PRESS', crew: 2, crewTxt: '2 (up to 3)', speed: 900, maxColor: 2,
    minW: 16.0, minL: 22.0, maxW: 66.0, maxL: 139.0, maxUpOk: 2,
    notes: 'Hand feed, rotary die cutting. Standard slot 3/8". Min set panel 14", min W panel 2-3/16". Max rule 1000". Anilox 220 (1st) / 250 (2nd).' },
  { id: 126, name: '86" Jumbo Press', model: 'Corrugated Components Inc.', type: 'PRESS', crew: 2, crewTxt: '2', speed: 250, maxColor: 1,
    minW: 24.0, minL: 24.0, maxW: 86.0, maxL: 205.0, minDepth: 5, maxUpOk: 2,
    notes: 'Hand feed, one color only. Min box depth 5". Min W panel 3-13/16", min length panel 7-3/4".' },
  { id: 137, name: 'Large Marumatsu FBDC', model: 'Marumatsu Diamond CM-1712VII', type: 'FLATBED', crew: 2, crewTxt: '2', speed: 0, maxColor: 0,
    minW: 15.75, minL: 23.5625, maxW: 47.1875, maxL: 66.125,
    notes: 'Flat die cutter, hand feed/stack. Max rule 800" (over needs supervisor OK). Max die cut 46-7/16" × 65-5/16". Confirm die board fits.' },
  { id: 138, name: 'Small Marumatsu FBDC', model: 'Marumatsu SM1410', type: 'FLATBED', crew: 2, crewTxt: '2', speed: 0, maxColor: 0,
    minW: 11.85, minL: 21.65, maxW: 40.15, maxL: 55.1,
    notes: 'Flat die cutter, hand feed/stack. Max rule 800" (over needs supervisor OK). Max die cut 54.30" × 39.35" (55.50" × 40.15" with stripping knife).' },
];

export const RUN_FLUTES = ['E', 'B', 'C', 'BC'];

// Estimated blank (sheet) size for a folding carton style from inside L×W×D.
export function estimateBlank({ style, L, W, D }) {
  if (!(L > 0 && W > 0 && D > 0)) return null;
  const joint = 1.25;
  const flaps = style === 'HSC' ? W / 2 : style === 'FOL' ? 2 * W : W;
  if (!['RSC', 'HSC', 'FOL'].includes(style)) return null;
  return { sheetL: 2 * L + 2 * W + joint, sheetW: D + flaps };
}

const inRange = (v, lo, hi) => v >= lo - 1e-9 && v <= hi + 1e-9;

export function checkMachine(m, o) {
  const fails = [], warns = [], oks = [];
  const { sheetW: w, sheetL: l } = o;
  const fmt = (x) => `${Math.round(x * 100) / 100}"`;

  // Size
  const wOk = inRange(w, m.minW, m.maxW), lOk = inRange(l, m.minL, m.maxL);
  if (wOk && lOk) oks.push(`Sheet ${fmt(w)} × ${fmt(l)} fits (${fmt(m.minW)}–${fmt(m.maxW)} × ${fmt(m.minL)}–${fmt(m.maxL)})`);
  else if (lOk && m.skipFeedMaxW && inRange(w, m.minW, m.skipFeedMaxW)) warns.push(`Width ${fmt(w)} is over ${fmt(m.maxW)}. Only runs with skip-feed (up to ${fmt(m.skipFeedMaxW)})`);
  else {
    if (!wOk) fails.push(`Sheet width ${fmt(w)} is outside ${fmt(m.minW)}–${fmt(m.maxW)}`);
    if (!lOk) fails.push(`Sheet length ${fmt(l)} is outside ${fmt(m.minL)}–${fmt(m.maxL)}`);
    if (inRange(l, m.minW, m.maxW) && inRange(w, m.minL, m.maxL)) warns.push('Would fit if the sheet is turned 90°. Confirm feed direction with the supervisor');
  }

  // Flute
  if (o.flute && !RUN_FLUTES.includes(o.flute)) fails.push(o.flute === 'SF' ? 'We do not run single face' : `We do not run ${o.flute} flute`);

  // Print
  const colors = o.colors || 0;
  if (m.type === 'FLATBED') {
    if (colors > 0) warns.push('No print units. Sheets must be printed on another machine first');
  } else if (colors > m.maxColor) fails.push(`${colors} colors; this machine prints ${m.maxColor} max`);
  else if (colors > 0) oks.push(`${colors} color${colors > 1 ? 's' : ''} OK (max ${m.maxColor})`);

  // Depth
  if (m.minDepth && o.D > 0 && o.D < m.minDepth) fails.push(`Box depth ${fmt(o.D)} is under the ${m.minDepth}" minimum`);

  // Style
  const style = o.style;
  if (['RSC', 'HSC', 'FOL'].includes(style)) {
    if (m.type === 'PRESS') warns.push('No folder-gluer. Joint must be glued or stitched separately');
    if (m.type === 'FLATBED') warns.push('Flatbed die cutter. Not the usual route for a slotted box');
  }
  if (style === 'Die Cut' && m.type === 'FFG') warns.push('Die-cut style. Confirm this job can be done on a folder-gluer');

  // Number up
  if (o.up > 1 && m.maxUpOk && o.up > m.maxUpOk) warns.push(`${o.up}-up needs supervisor sign-off on this machine (over ${m.maxUpOk}-up)`);

  const status = fails.length ? 'fail' : warns.length ? 'warn' : 'pass';
  return { machine: m, status, fails, warns, oks };
}

// Pass first, then warn, then fail. Within a group: faster, then smaller crew.
export function checkAll(order) {
  const rank = { pass: 0, warn: 1, fail: 2 };
  return MACHINES.map((m) => checkMachine(m, order))
    .sort((a, b) => rank[a.status] - rank[b.status] || b.machine.speed - a.machine.speed || a.machine.crew - b.machine.crew);
}
