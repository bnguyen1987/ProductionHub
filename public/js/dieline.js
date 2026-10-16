// Read a die line for the pallet calculator.
// DXF: read in the browser (outer size of the cut/crease lines). PDF or photo: read by the AI (/api/ai task "dieline").
import { api, fileToPayload } from './common.js';
import { GRADES_BY_FLUTE } from './palletcalc.js';

const SKIP_LAYER = /dim|text|anno|title|border|frame|note|logo|print|graphic/i;

// Overall size of a DXF drawing in inches: { w, l, units, entities }
export function dxfSize(text) {
  const lines = String(text).split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  let insunits = 0, extmin = null, extmax = null;
  // header variables
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c !== 9) continue;
    const num = (k) => { const p = pairs.slice(i + 1, i + 5).find((x) => x[0] === k); return p ? parseFloat(p[1]) : NaN; };
    if (v === '$INSUNITS') insunits = parseInt(pairs[i + 1][1], 10) || 0;
    if (v === '$EXTMIN') extmin = [num(10), num(20)];
    if (v === '$EXTMAX') extmax = [num(10), num(20)];
  }
  // entities section
  let s = pairs.findIndex((p, i) => p[0] === 2 && p[1] === 'ENTITIES' && pairs[i - 1] && pairs[i - 1][1] === 'SECTION');
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
  const add = (x, y) => { if (!isFinite(x) || !isFinite(y)) return; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  if (s >= 0) {
    let ent = null;
    const flush = () => {
      if (!ent || SKIP_LAYER.test(ent.layer || '')) { ent = null; return; }
      const g = ent.g;
      const all = (k) => g.filter((p) => p[0] === k).map((p) => parseFloat(p[1]));
      const one = (k) => { const p = g.find((x) => x[0] === k); return p ? parseFloat(p[1]) : NaN; };
      if (ent.type === 'LINE') { add(one(10), one(20)); add(one(11), one(21)); count++; }
      else if (ent.type === 'LWPOLYLINE' || ent.type === 'VERTEX' || ent.type === 'SPLINE' || ent.type === 'POINT') {
        const xs = all(10), ys = all(20); xs.forEach((x, i) => add(x, ys[i])); if (xs.length) count++;
      } else if (ent.type === 'CIRCLE') { const r = one(40); add(one(10) - r, one(20) - r); add(one(10) + r, one(20) + r); count++; }
      else if (ent.type === 'ARC') {
        const cx = one(10), cy = one(20), r = one(40); let a0 = one(50), a1 = one(51);
        if (a1 < a0) a1 += 360;
        const pts = [a0, a1]; for (let a = Math.ceil(a0 / 90) * 90; a <= a1; a += 90) pts.push(a);
        pts.forEach((a) => add(cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180))); count++;
      }
      ent = null;
    };
    for (let i = s + 1; i < pairs.length; i++) {
      const [c, v] = pairs[i];
      if (c === 0) { flush(); if (v === 'ENDSEC') break; ent = { type: v, layer: '', g: [] }; continue; }
      if (!ent) continue;
      if (c === 8) ent.layer = v; else ent.g.push([c, v]);
    }
    flush();
  }
  let w, l;
  if (count && isFinite(minX)) { w = maxX - minX; l = maxY - minY; }
  else if (extmin && extmax) { w = extmax[0] - extmin[0]; l = extmax[1] - extmin[1]; }
  else throw new Error('Could not find any cut lines in that DXF.');
  // units: 1 = inches, 4 = mm, 5 = cm; unknown → guess mm when the drawing is huge
  let scale = 1, units = 'in';
  if (insunits === 4 || (!insunits && Math.max(w, l) > 200)) { scale = 1 / 25.4; units = 'mm'; }
  else if (insunits === 5) { scale = 1 / 2.54; units = 'cm'; }
  w *= scale; l *= scale;
  const r = (x) => Math.round(x * 1000) / 1000;
  return { w: r(Math.min(w, l)), l: r(Math.max(w, l)), units, entities: count };
}

// "200 C Kraft" → grade "200C" on the mill table for that flute
export function gradeFor(flute, num, ect) {
  if (!flute || !num) return null;
  const list = GRADES_BY_FLUTE[flute] || [];
  const want = `${num}${ect ? 'ECT' : ''}${flute}`;
  return list.includes(want) ? want : null;
}

// Read any die line file. Returns { source, sheetW, sheetL, out, pieceW, pieceL, flute, grade, board, customer, design, description, rule, notes }
export async function readDieline(file) {
  const name = file.name || '';
  if (/\.dxf$/i.test(name)) {
    const d = dxfSize(await file.text());
    return { source: 'dxf', sheetW: d.w, sheetL: d.l, units: d.units, design: name.replace(/\.dxf$/i, ''), out: null };
  }
  if (/\.(ard|ai|dwg|cf2|mfg)$/i.test(name)) throw new Error('That CAD format can\'t be read here. Export a PDF or DXF from ArtiosCAD (or your CAD program) and upload that.');
  const payload = await fileToPayload(file);
  const { result: r } = await api('/api/ai', { method: 'POST', body: JSON.stringify({ task: 'dieline', ...payload }) });
  const n = (v) => (v === null || v === undefined || v === '' || !isFinite(+v) || +v <= 0 ? null : +v);
  const flute = ['E', 'B', 'C', 'BC'].includes(r.flute) ? r.flute : null;
  const bw = n(r.blank_width_in), bl = n(r.blank_length_in);
  return {
    source: 'ai',
    sheetW: bw && bl ? Math.min(bw, bl) : bw, sheetL: bw && bl ? Math.max(bw, bl) : bl,
    out: n(r.pieces_out) ? Math.round(n(r.pieces_out)) : null,
    pieceW: n(r.piece_width_in), pieceL: n(r.piece_length_in),
    flute, grade: gradeFor(flute, n(r.grade_number), !!r.grade_ect), color: r.color || null,
    board: r.board || '', customer: r.customer || '', design: String(r.design || '').replace(/\.(ard|dxf|pdf|dwg|cf2)$/i, ''), description: r.description || '',
    rule: n(r.rule_in), notes: r.notes || '',
  };
}
