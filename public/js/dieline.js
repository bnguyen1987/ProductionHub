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
  const segs = []; // [{ crease, pts: [[x, y], ...] }] for the picture
  const CREASE = /crease|score|fold|bend|perf/i;
  const add = (x, y) => { if (!isFinite(x) || !isFinite(y)) return; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  if (s >= 0) {
    let ent = null;
    const flush = () => {
      if (!ent || SKIP_LAYER.test(ent.layer || '')) { ent = null; return; }
      const g = ent.g;
      const all = (k) => g.filter((p) => p[0] === k).map((p) => parseFloat(p[1]));
      const one = (k) => { const p = g.find((x) => x[0] === k); return p ? parseFloat(p[1]) : NaN; };
      const crease = CREASE.test(ent.layer || '');
      if (ent.type === 'LINE') { add(one(10), one(20)); add(one(11), one(21)); count++; segs.push({ crease, pts: [[one(10), one(20)], [one(11), one(21)]] }); }
      else if (ent.type === 'LWPOLYLINE' || ent.type === 'VERTEX' || ent.type === 'SPLINE' || ent.type === 'POINT') {
        const xs = all(10), ys = all(20); xs.forEach((x, i) => add(x, ys[i])); if (xs.length) count++;
        if (xs.length > 1 && ent.type !== 'VERTEX') { const pts = xs.map((x, i) => [x, ys[i]]); const fl = g.find((x) => x[0] === 70); if (fl && (+fl[1] & 1)) pts.push(pts[0]); segs.push({ crease, pts }); }
      } else if (ent.type === 'CIRCLE') { const r = one(40); add(one(10) - r, one(20) - r); add(one(10) + r, one(20) + r); count++;
        segs.push({ crease, pts: Array.from({ length: 33 }, (_, i) => [one(10) + r * Math.cos(i * Math.PI / 16), one(20) + r * Math.sin(i * Math.PI / 16)]) }); }
      else if (ent.type === 'ARC') {
        const cx = one(10), cy = one(20), r = one(40); let a0 = one(50), a1 = one(51);
        if (a1 < a0) a1 += 360;
        const pts = [a0, a1]; for (let a = Math.ceil(a0 / 90) * 90; a <= a1; a += 90) pts.push(a);
        pts.forEach((a) => add(cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180))); count++;
        const n = Math.max(4, Math.ceil((a1 - a0) / 10));
        segs.push({ crease, pts: Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }) });
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
  // drawing kept in its own orientation (inches from the lower-left corner) for the picture on the pallet
  const draw = count ? { w: (maxX - minX) * scale, h: (maxY - minY) * scale, segs: segs.map((sg) => ({ crease: sg.crease, pts: sg.pts.map(([x, y]) => [(x - minX) * scale, (y - minY) * scale]) })) } : null;
  return { w: r(Math.min(w, l)), l: r(Math.max(w, l)), units, entities: count, draw };
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
    return { source: 'dxf', sheetW: d.w, sheetL: d.l, units: d.units, design: name.replace(/\.dxf$/i, ''), out: null, draw: d.draw };
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
    box: Array.isArray(r.drawing_box) && r.drawing_box.length === 4 && r.drawing_box.every((v) => isFinite(+v) && +v >= 0 && +v <= 1) && +r.drawing_box[2] > +r.drawing_box[0] && +r.drawing_box[3] > +r.drawing_box[1] ? r.drawing_box.map(Number) : null,
  };
}

// ---------- picture of the die line (shown on top of each stack) ----------
const MAX_PX = 1024;

// DXF drawing → PNG (red cut lines, dashed blue creases), y flipped so it reads like the CAD screen
export function renderDxf(draw) {
  const k = MAX_PX / Math.max(draw.w, draw.h), pad = 4;
  const c = document.createElement('canvas');
  c.width = Math.round(draw.w * k) + pad * 2; c.height = Math.round(draw.h * k) + pad * 2;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.lineWidth = Math.max(2, MAX_PX / 400); g.lineJoin = g.lineCap = 'round';
  for (const crease of [true, false]) for (const sg of draw.segs.filter((x) => x.crease === crease)) {
    g.strokeStyle = crease ? '#2463b5' : '#c0262d'; g.setLineDash(crease ? [10, 7] : []);
    g.beginPath(); sg.pts.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, pad + x * k, pad + (draw.h - y) * k)); g.stroke();
  }
  return { url: c.toDataURL('image/png'), w: c.width, h: c.height };
}

let pdfjsP = null;
function loadPdfjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsP) pdfjsP = new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = 'vendor/pdf.min.js';
    sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; res(window.pdfjsLib); };
    sc.onerror = () => { pdfjsP = null; rej(new Error('Could not load the PDF reader')); };
    document.head.appendChild(sc);
  });
  return pdfjsP;
}

// First page of a PDF, or a photo, as a canvas (about 1800 px on the long side)
export async function pageCanvas(file) {
  const c = document.createElement('canvas');
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
    const lib = await loadPdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const page = await doc.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 1800 / Math.max(v1.width, v1.height) });
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return c;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not open that picture.')); i.src = url; });
    const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

// First guess at the blank on the page: the red cut/crease lines, widened to the blank's proportions (w:l)
export function guessBox(canvas, aspect) {
  const { width: W, height: H } = canvas;
  const d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 150 && g < 110 && b < 110) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return [0.15, 0.25, 0.85, 0.95]; // no red lines: rough middle of the page
  let w = x1 - x0, h = y1 - y0;
  if (aspect > 0) { // grow the short way so the box matches the blank
    if (w / h > aspect) { const nh = w / aspect; y0 -= (nh - h) / 2; h = nh; } else { const nw = h * aspect; x0 -= (nw - w) / 2; w = nw; }
  }
  const pad = 0.01;
  return [Math.max(0, x0 / W - pad), Math.max(0, y0 / H - pad), Math.min(1, (x0 + w) / W + pad), Math.min(1, (y0 + h) / H + pad)];
}

// Cut the box out of the page → PNG
export function cropImage(canvas, box) {
  const [a, b, c2, d] = box, W = canvas.width, H = canvas.height;
  const sx = a * W, sy = b * H, sw = Math.max(4, (c2 - a) * W), sh = Math.max(4, (d - b) * H);
  const k = Math.min(1, MAX_PX / Math.max(sw, sh));
  const c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  c.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return { url: c.toDataURL('image/png'), w: c.width, h: c.height };
}

// One piece of a multi-out blank: the picture split into a grid that matches the piece size, top-left cell
export async function pieceImage(img, sheet, piece, out) {
  const imgLong = img.w >= img.h, sL = Math.max(sheet.w, sheet.l), sS = Math.min(sheet.w, sheet.l);
  const along = imgLong ? [sL, sS] : [sS, sL]; // inches along image x, y
  let best = null;
  for (const [px, py] of [[piece.w, piece.l], [piece.l, piece.w]]) {
    const nx = Math.max(1, Math.round(along[0] / px)), ny = Math.max(1, Math.round(along[1] / py));
    const err = Math.abs(nx * px - along[0]) / along[0] + Math.abs(ny * py - along[1]) / along[1] + (out && nx * ny !== out ? 1 : 0);
    if (!best || err < best.err) best = { nx, ny, err };
  }
  const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = img.url; });
  const cw = img.w / best.nx, ch = img.h / best.ny;
  const c = document.createElement('canvas'); c.width = Math.round(cw); c.height = Math.round(ch);
  c.getContext('2d').drawImage(im, 0, 0, cw, ch, 0, 0, c.width, c.height);
  return { url: c.toDataURL('image/png'), w: c.width, h: c.height };
}
