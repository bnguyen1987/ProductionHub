import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { $, $$, esc, api, setupDrop, parseInches, fmtIn, fmtNum, saveForm, loadForm } from './common.js';
import { readDieline } from './dieline.js';
import { perTrailer, TRAILER, CALIPER, FOLD_ALLOWANCE, GRADES_BY_FLUTE, boardSpec, DEFAULT_PALLET_PRICES, palletCatalog, flatPiece, loadFor, loadTwo, palletsNeeded, recommend } from './palletcalc.js';

let PALLET_H = 5; // wood pallet height (in), set from the form
let state, three = null, last = null;
// Pallet price list (shared upload, else the built-in 7/1/26 list) and the per-size catalog built from it.
let prices = { items: DEFAULT_PALLET_PRICES, fileName: 'Pallet Costs and Sizes (7/1/26 list)', uploadedAt: null };
let catalog = palletCatalog(prices.items);
const priceOf = (w, l) => catalog.find((c) => c.w === Math.min(w, l) && c.l === Math.max(w, l)) || null;
const money = (x) => (x === null || x === undefined || !isFinite(x) ? '–' : '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const DEFAULTS = { htOnly: false, two: '1', pattern: 'auto', customer: '', job: '', notes: '', style: 'RSC', L: '', W: '', D: '', sheetW: '', sheetL: '', flute: 'C', grade: '200C', caliper: String(boardSpec('C', '200C').caliper), lbsMsf: String(boardSpec('C', '200C').lbsMsf), bundle: '25', qty: '', maxTotal: '52', palletH: '5', foldPct: String(FOLD_ALLOWANCE), thick: '', fullBundles: false, overhang: '0', pallet: 'auto', customW: '', customL: '', show: 'full', board: 'kraft' };

export function render(view) {
  state = { ...DEFAULTS, ...(loadForm('pallet') || {}) };
  // these settings are hidden on screen, so always use the standard values
  state.foldPct = DEFAULTS.foldPct; state.thick = ''; state.palletH = DEFAULTS.palletH;
  state.lbsMsf = String(boardSpec(state.flute, state.grade).lbsMsf);
  view.innerHTML = `
    <div class="page-head"><h1>Pallet Calculator</h1><p>How many pieces fit on a pallet, how many pallets the order needs, and what the load will look like. Boxes are figured glued and folded flat.</p></div>
    <div class="layout wide-left">
      <div class="stack">
        <section class="card">
          <h2><span class="n">1</span>Piece</h2>
          <div class="seg" id="styleSeg" style="margin-bottom:12px">
            ${[['RSC', 'RSC'], ['HSC', 'HSC'], ['FOL', 'FOL'], ['SHEET', 'Sheet / blank']].map(([k, t]) => `<button type="button" data-k="${k}">${t}</button>`).join('')}
          </div>
          <div class="row" id="boxDims">
            <div class="field"><label for="pL">Length (in)</label><input id="pL" data-f="L" type="text" inputmode="decimal" placeholder="16"></div>
            <div class="field"><label for="pW">Width (in)</label><input id="pW" data-f="W" type="text" inputmode="decimal" placeholder="12"></div>
            <div class="field"><label for="pD">Depth (in)</label><input id="pD" data-f="D" type="text" inputmode="decimal" placeholder="10"></div>
          </div>
          <div id="dlWrap">
            <label class="drop" id="dlDrop" style="display:block;padding:12px;margin-bottom:10px"><input type="file" accept=".pdf,.dxf,image/*" hidden>
              <b>Upload die line</b><br><span class="hint">PDF, DXF or a photo of the drawing. Fills in the sheet size and board.</span></label>
            <div id="dlInfo"></div>
          </div>
          <div class="row" id="sheetDims">
            <div class="field"><label for="pSW">Sheet width (in)</label><input id="pSW" data-f="sheetW" type="text" inputmode="decimal" placeholder="33"></div>
            <div class="field"><label for="pSL">Sheet length (in)</label><input id="pSL" data-f="sheetL" type="text" inputmode="decimal" placeholder="52"></div>
          </div>
          <div class="lbl" style="margin:4px 0 6px">Flute</div>
          <div class="seg" id="fluteSeg">${Object.keys(CALIPER).map((k) => `<button type="button" data-k="${k}">${k}</button>`).join('')}</div>
          <div class="field" style="margin-top:10px;max-width:280px"><label for="pGrade">Board grade (mill standard)</label><select id="pGrade"></select><span class="hint" id="pGradeInfo"></span></div>
          <div class="row" style="margin-top:10px">
            <div class="field"><label for="pBundle">Pieces per bundle</label><input id="pBundle" data-f="bundle" type="number" min="0" step="1"><span class="hint">0 = loose stacked</span></div>
            <div class="field"><label for="pCal">Caliper per sheet (in)</label><input id="pCal" data-f="caliper" type="number" step="0.001" min="0"><span class="hint">Mill max caliper for the grade (QF-582). Edit if needed</span></div>
            <div class="field hidden"><label for="pWt">Board weight (lb/MSF)</label><input id="pWt" data-f="lbsMsf" type="number" step="1" min="0"></div>
          </div>
          <div class="row hidden">
            <div class="field"><label for="pFold">Fold allowance (%)</label><input id="pFold" data-f="foldPct" type="number" min="0" step="1"><span class="hint">Folded box = 2 × caliper + this %. ${FOLD_ALLOWANCE}% matched the floor test</span></div>
            <div class="field"><label for="pThick">Measured thickness per piece (in)</label><input id="pThick" data-f="thick" type="number" min="0" step="0.001" placeholder="optional"><span class="hint">Bundle height ÷ pcs. Overrides the line to the left</span></div>
          </div>
        </section>
        <section class="card">
          <h2><span class="n">2</span>Order &amp; pallet</h2>
          <div class="row">
            <div class="field"><label for="pQty">Order quantity</label><input id="pQty" data-f="qty" type="number" min="0" step="1" placeholder="5000"></div>
            <div class="field"><label for="pMax">Max height incl. pallet (in)</label><input id="pMax" data-f="maxTotal" type="number" min="1" step="0.5"><span class="hint">Floor to top of the load</span></div>
            <div class="field hidden"><label for="pPH">Pallet height (in)</label><input id="pPH" data-f="palletH" type="number" min="0" step="0.25"></div>
            <div class="field"><label for="pOver">Overhang allowed</label><select id="pOver" data-f="overhang">${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}" per side</option>`).join('')}</select></div>
          </div>
          <div class="row">
            <div class="field"><label for="pPal">Pallet size (W × L)</label>
              <select id="pPal" data-f="pallet"></select></div>
            <div class="field" id="customWrap"><label>Custom W × L (in)</label><div style="display:flex;gap:6px"><input data-f="customW" id="pCW" type="text" inputmode="decimal" placeholder="W"><input data-f="customL" id="pCL" type="text" inputmode="decimal" placeholder="L"></div></div>
          </div>
          <label style="display:flex;gap:8px;align-items:center;margin:0 0 8px;font-size:14.5px"><input type="checkbox" id="pFull" style="width:18px;height:18px"> Only count full bundles (no partial bundle on top)</label>
          <label style="display:flex;gap:8px;align-items:center;margin:0 0 12px;font-size:14.5px"><input type="checkbox" id="pHT" style="width:18px;height:18px"> Heat-treated (HT) pallets only</label>
          <div class="rep" style="margin-bottom:12px">
            <div class="lbl" style="margin-bottom:4px">Pallet prices</div>
            <div id="pPriceStatus" class="hint"></div>
            <label class="btn small" style="margin-top:6px;position:relative;overflow:hidden">Update prices (.xlsx)<input type="file" id="pPriceFile" accept=".xlsx,.xls,.csv" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label>
          </div>
          <div class="lbl" style="margin:2px 0 6px">Pallets under each load</div>
          <div class="seg" id="twoSeg" style="margin-bottom:12px">
            <button type="button" data-k="1">1 pallet</button>
            <button type="button" data-k="2">2 side by side<small>same size, pushed together</small></button>
          </div>
          <div class="lbl" style="margin:2px 0 6px">Stacking pattern</div>
          <div class="seg" id="patSeg">
            <button type="button" data-k="auto">Most pieces<small>picks the best</small></button>
            <button type="button" data-k="straight">Straight columns</button>
            <button type="button" data-k="chimney">Chimney<small>pinwheel, open center</small></button>
          </div>
        </section>
        <section class="card no-print">
          <h2><span class="n">3</span>Print load sheet</h2>
          <div class="row">
            <div class="field"><label for="pCust">Customer</label><input id="pCust" data-f="customer" type="text" placeholder="optional"></div>
            <div class="field"><label for="pJob">Job / order #</label><input id="pJob" data-f="job" type="text" placeholder="optional"></div>
          </div>
          <div class="field" style="margin-bottom:10px"><label for="pNotes">Notes for the floor</label><input id="pNotes" data-f="notes" type="text" placeholder="e.g. stretch wrap, corner boards, label 2 sides"></div>
          <button class="btn primary" type="button" id="palPrint">Print load sheet</button>
          <p class="hint" style="margin:8px 0 0">Prints one page with the specs, results, 3D picture and layer pattern. Choose "Save as PDF" in the print window to email it.</p>
        </section>
      </div>
      <div class="stack">
        <section class="card" id="palResult" aria-live="polite"></section>
        <section class="card" id="palRecs"></section>
        <section class="card">
          <div class="btn-row" style="margin-bottom:10px;justify-content:space-between">
            <h2 style="margin:0">3D view</h2>
            <div class="seg" id="showSeg"><button type="button" data-k="full">Full pallet</button><button type="button" data-k="last">Last pallet</button></div>
          </div>
          <div class="viewer" id="viewer"><div class="vbtns"><button type="button" data-cam="iso">3D</button><button type="button" data-cam="top">Top</button><button type="button" data-cam="side">Side</button><button type="button" id="boardBtn">Kraft/White</button></div><span class="vhint">Drag to turn · pinch or scroll to zoom</span></div>
          <h2 style="margin:16px 0 8px">Layer pattern (top view)</h2>
          <div id="topView"></div>
        </section>
      </div>
    </div>`;

  $$('[data-f]', view).forEach((el) => {
    el.value = state[el.dataset.f];
    el.addEventListener('input', () => { state[el.dataset.f] = el.value; update(); });
  });
  $$('#styleSeg button').forEach((b) => b.addEventListener('click', () => { state.style = b.dataset.k; update(); }));
  const fillGrades = () => {
    const spec = boardSpec(state.flute, state.grade);
    state.grade = spec.grade;
    $('#pGrade').innerHTML = GRADES_BY_FLUTE[state.flute].map((g) => `<option ${g === state.grade ? 'selected' : ''}>${g}</option>`).join('');
    $('#pGradeInfo').textContent = `${spec.components} · mill max caliper ${spec.caliper}"`;
  };
  const applyBoard = () => { fillGrades(); const b = boardSpec(state.flute, state.grade); state.caliper = String(b.caliper); state.lbsMsf = String(b.lbsMsf); $('#pCal').value = state.caliper; $('#pWt').value = state.lbsMsf; update(); };
  $$('#fluteSeg button').forEach((b) => b.addEventListener('click', () => { state.flute = b.dataset.k; state.grade = state.grade.replace(/(BC|B|C|E|D)$/, ''); applyBoard(); }));
  $('#pGrade').addEventListener('change', (e) => { state.grade = e.target.value; applyBoard(); });
  // first load: older saved settings used short grades and estimated calipers; move them onto the mill table
  if (!/[A-Z]$/.test(String(state.grade))) applyBoard(); else fillGrades();
  $$('#patSeg button').forEach((b) => b.addEventListener('click', () => { state.pattern = b.dataset.k; update(); }));
  $$('#twoSeg button').forEach((b) => b.addEventListener('click', () => { state.two = b.dataset.k; update(); }));
  $('#pHT').checked = !!state.htOnly;
  $('#pHT').addEventListener('change', (e) => { state.htOnly = e.target.checked; rebuildCatalog(); update(); });
  $('#pPriceFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) uploadPrices(f); });
  try { const c = JSON.parse(localStorage.getItem('gwprod_pallet_prices') || 'null'); if (c && Array.isArray(c.items) && c.items.length) prices = c; } catch {}
  rebuildCatalog();
  api('/api/pallets').then((d) => {
    if (d && Array.isArray(d.items) && d.items.length && (d.uploadedAt || '') >= (prices.uploadedAt || '')) {
      prices = d; try { localStorage.setItem('gwprod_pallet_prices', JSON.stringify(d)); } catch {}
      rebuildCatalog(); update();
    }
  }).catch(() => {});
  $('#pFull').checked = !!state.fullBundles;
  $('#pFull').addEventListener('change', (e) => { state.fullBundles = e.target.checked; update(); });
  $$('#showSeg button').forEach((b) => b.addEventListener('click', () => { state.show = b.dataset.k; update(); }));
  $$('#viewer [data-cam]').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam)));
  $('#boardBtn').addEventListener('click', () => { state.board = state.board === 'kraft' ? 'white' : 'kraft'; update(); });

  $('#palPrint').addEventListener('click', printSheet);

  // ---- die line upload (Sheet / blank) ----
  const setField = (k, v) => { state[k] = v; const el = $(`[data-f="${k}"]`, view); if (el) el.value = v; };
  const applyDlMode = () => {
    const d = state.dl;
    if (!d) return;
    if (d.mode === 'piece' && d.pieceW && d.pieceL) { setField('sheetW', String(d.pieceW)); setField('sheetL', String(d.pieceL)); }
    else if (d.sheetW && d.sheetL) { setField('sheetW', String(d.sheetW)); setField('sheetL', String(d.sheetL)); }
  };
  const paintDl = (msg = '') => {
    const box = $('#dlInfo', view), d = state.dl;
    if (!box) return;
    if (!d) { box.innerHTML = msg; return; }
    const multi = d.out > 1;
    box.innerHTML = `${msg}<div class="alert ${d.warn ? 'warn' : 'ok'}" style="margin-bottom:10px"><b>${esc(d.file || 'Die line')}</b>
      ${[d.customer, d.design, d.board].filter(Boolean).map(esc).join(' · ')}<br>
      Blank ${fmtIn(d.sheetW)} × ${fmtIn(d.sheetL)}${multi ? ` · ${d.out} out` : ''}${d.rule ? ` · ${fmtNum(d.rule, 2)}" of rule` : ''}${d.source === 'dxf' ? ` · read from DXF (${esc(d.units)})` : ''}
      ${d.warn ? `<br>${esc(d.warn)}` : '<br><span class="hint">Check the numbers below before using them.</span>'}</div>
      ${multi ? `<div class="lbl" style="margin:0 0 6px">Palletize</div><div class="seg" id="dlMode" style="margin-bottom:10px">
        <button type="button" data-k="sheet" aria-pressed="${d.mode !== 'piece'}">Full sheets<small>${fmtIn(d.sheetW)} × ${fmtIn(d.sheetL)}</small></button>
        <button type="button" data-k="piece" aria-pressed="${d.mode === 'piece'}">Separated pieces<small>${d.out} out${d.pieceW && d.pieceL ? `, ${fmtIn(d.pieceW)} × ${fmtIn(d.pieceL)}` : ''}</small></button></div>
        ${d.mode === 'piece' && !(d.pieceW && d.pieceL) ? '<div class="alert warn" style="margin-bottom:10px">The piece size wasn\'t on the drawing. Type one piece\'s width and length below.</div>' : ''}
        <p class="hint" style="margin:-4px 0 10px">${d.mode === 'piece' ? `Order quantity = pieces. One sheet makes ${d.out}.` : `Order quantity = sheets. One sheet makes ${d.out} pieces.`}</p>` : ''}`;
    $$('#dlMode button', box).forEach((b) => b.addEventListener('click', () => { d.mode = b.dataset.k; applyDlMode(); paintDl(); update(); }));
  };
  const dlDrop = $('#dlDrop', view), dlIn = dlDrop.querySelector('input');
  dlIn.addEventListener('change', async () => {
    const f = dlIn.files[0]; dlIn.value = '';
    if (!f) return;
    paintDl('<div class="alert info" style="margin-bottom:10px"><span class="spinner"></span> Reading the die line…</div>');
    try {
      const r = await readDieline(f);
      if (!(r.sheetW > 0 && r.sheetL > 0)) throw new Error('Could not find the blank size on that drawing. Type it in below.');
      const warn = r.source === 'ai' && !r.flute ? 'Board grade not found on the drawing. Pick the flute and grade below.' : '';
      state.dl = { ...r, file: f.name, mode: 'sheet', warn };
      if (r.flute) { state.flute = r.flute; if (r.grade) state.grade = r.grade; else state.grade = state.grade.replace(/(BC|B|C|E|D)$/, ''); applyBoard(); }
      if (r.color === 'WHITE' && state.board !== 'white') state.board = 'white';
      if (r.customer && !state.customer) setField('customer', r.customer);
      if (r.design && !state.job) setField('job', r.design);
      applyDlMode(); paintDl(); update();
    } catch (e) {
      paintDl(`<div class="alert err" style="margin-bottom:10px">${esc(e.message)}</div>`);
    }
  });
  paintDl();

  initThree($('#viewer'));
  update();
}

export function destroy() {
  if (!three) return;
  cancelAnimationFrame(three.raf);
  three.ro.disconnect();
  three.controls.dispose();
  disposeGroup(three.group);
  three.renderer.dispose();
  three = null;
}

function compute() {
  const caliper = parseFloat(state.caliper);
  const bundle = Math.max(0, Math.floor(parseFloat(state.bundle) || 0));
  const qty = Math.floor(parseFloat(state.qty) || 0);
  PALLET_H = parseFloat(state.palletH);
  if (!(PALLET_H >= 0)) PALLET_H = 5;
  const maxStack = parseFloat(state.maxTotal) - PALLET_H; // product height available above the pallet
  const overhang = parseFloat(state.overhang) || 0;
  const dims = state.style === 'SHEET'
    ? { sheetW: parseInches(state.sheetW), sheetL: parseInches(state.sheetL) }
    : { L: parseInches(state.L), W: parseInches(state.W), D: parseInches(state.D) };
  const need = [];
  if (state.style === 'SHEET') { if (!(dims.sheetW > 0)) need.push('sheet width'); if (!(dims.sheetL > 0)) need.push('sheet length'); }
  else { if (!(dims.L > 0)) need.push('length'); if (!(dims.W > 0)) need.push('width'); if (!(dims.D > 0)) need.push('depth'); }
  if (!(caliper > 0)) need.push('caliper');
  if (!(maxStack > 0)) need.push('max height (must be taller than the pallet)');
  if (need.length) return { need };

  const piece = flatPiece({ style: state.style, ...dims, caliper, foldPct: parseFloat(state.foldPct) || 0, thickness: parseFloat(state.thick) || 0 });
  const fullBundles = !!state.fullBundles;
  const two = state.two === '2';
  const recs = recommend({ piece, qty, overhang, maxStack, bundle, mode: state.pattern, two, fullBundles, sizes: catalog.map((c) => [c.w, c.l]) });
  let pallet, load;
  if (state.pallet === 'auto') {
    if (!recs.length) return { piece, recs, qty, noFit: true };
    // Best fit = lowest pallet cost (pallets × price; per piece if no quantity), fewer pallets as the tiebreaker.
    // Loads that fit within the allowed overhang always beat oversize ones. Falls back to fewest pallets with no prices.
    const cost = (p) => { const pr = priceOf(p.w, p.l); if (!pr || pr.cost === null) return null; const per = pr.cost * (two ? 2 : 1); return qty > 0 ? pr.cost * p.pallets : per / p.perPallet; };
    const priced = recs.filter((p) => cost(p) !== null);
    const pick = priced.length ? [...priced].sort((p, q) => (p.oversize - q.oversize) || (p.oversize && q.oversize ? Math.max(p.overhangX, p.overhangY) - Math.max(q.overhangX, q.overhangY) : 0) || cost(p) - cost(q) || p.pallets - q.pallets)[0] : recs[0];
    pallet = { w: pick.w, l: pick.l };
  } else if (state.pallet === 'custom') {
    const w = parseInches(state.customW), l = parseInches(state.customL);
    if (!(w > 0 && l > 0)) return { need: ['custom pallet size'] };
    pallet = { w, l };
  } else {
    const [w, l] = state.pallet.split('x').map(Number);
    pallet = { w, l };
  }
  let base = { ...pallet, join: null };
  if (two) { const t = loadTwo({ piece, pallet, overhang, maxStack, bundle, mode: state.pattern, fullBundles }); load = t.load; base = { ...t.base, join: t.join }; }
  else load = loadFor({ piece, pallet, overhang, maxStack, bundle, mode: state.pattern, fullBundles });
  const pn = palletsNeeded(qty, load.perPallet); // per load (one or two pallets)
  return { piece, recs, pallet, base, two, load, qty, bundle, overhang, maxStack, fullBundles, loads: pn.pallets, lastPallet: pn.lastPallet, pallets: two ? pn.pallets * 2 : pn.pallets };
}

function update() {
  saveForm('pallet', state);
  $$('#styleSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === state.style)));
  $$('#fluteSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === state.flute)));
  $$('#patSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === state.pattern)));
  $$('#twoSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === state.two)));
  $$('#showSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === state.show)));
  $('#boxDims').classList.toggle('hidden', state.style === 'SHEET');
  $('#sheetDims').classList.toggle('hidden', state.style !== 'SHEET');
  $('#dlWrap').classList.toggle('hidden', state.style !== 'SHEET');
  $('#customWrap').classList.toggle('hidden', state.pallet !== 'custom');

  const r = compute();
  last = r;
  const res = $('#palResult'), recBox = $('#palRecs');
  if (r.need) {
    res.innerHTML = `<h2>Result</h2><p class="hint" style="margin:0">Still need: ${r.need.join(', ')}.</p>`;
    recBox.innerHTML = '<h2>Pallet options</h2><p class="hint" style="margin:0">Enter the piece size to compare pallets.</p>';
    drawScene(null); $('#topView').innerHTML = '';
    return;
  }
  const flat = `${fmtIn(r.piece.b)} × ${fmtIn(r.piece.a)}`;
  if (r.noFit || !r.load.perPallet) {
    res.innerHTML = `<h2>Result</h2><div class="alert err">The piece (${flat} flat) does not fit ${r.noFit ? 'any standard pallet' : 'this pallet'} at this height and overhang. Try a bigger pallet, more overhang, ${state.two === '2' ? '' : '<b>2 side by side</b>, '}or fewer pieces per bundle.${state.pattern === 'chimney' ? ' A chimney needs room for four pieces turning around the center, so it also helps to try Straight columns.' : ''}</div>`;
    recBox.innerHTML = '';
    drawScene(null); $('#topView').innerHTML = '';
    return;
  }
  const { load, pallet } = r;
  const totalH = PALLET_H + load.stackHeight;
  const wt = weights(r);
  const showLast = state.show === 'last' && r.qty > 0;
  const shownPieces = showLast ? r.lastPallet : load.perPallet;

  res.innerHTML = `
    <h2>Result · ${palletLabel(r)}</h2>
    ${load.oversize ? `<div class="alert warn" style="margin-bottom:10px"><b>Oversize:</b> the ${flat} piece is bigger than this pallet. ${overhangText(r)}${state.pallet === 'auto' ? ' Best fit picked the pallet with the least overhang.' : ''}${state.two === '2' ? '' : ' Two pallets side by side may avoid it.'}</div>` : ''}
    <div class="big-nums">
      ${r.qty ? `<div class="stat hero"><div class="v">${fmtNum(r.pallets)}</div><div class="l">Pallet${r.pallets === 1 ? '' : 's'} for ${fmtNum(r.qty)} pcs</div></div>` : ''}
      <div class="stat ${r.qty ? '' : 'hero'}"><div class="v">${fmtNum(load.perPallet)}</div><div class="l">${r.two ? 'Pieces per load (2 pallets)' : 'Pieces per full pallet'}</div></div>
      <div class="stat"><div class="v">${fmtIn(totalH)}</div><div class="l">Load height incl. pallet</div></div>
    </div>
    <dl class="kv" style="margin-top:12px">
      ${(() => { const pr = priceOf(pallet.w, pallet.l); if (!pr) return ''; const n = r.two ? 2 : 1; return pr.cost === null ? `<dt>Pallet price</dt><dd>no price on list</dd>` : `<dt>Pallet price</dt><dd>${money(pr.cost)} each${r.qty ? ` · <b>${money(pr.cost * r.pallets)}</b> for ${fmtNum(r.pallets)} pallets` : n > 1 ? ` · ${money(pr.cost * 2)} per load` : ''}<br><span class="hint">${esc(pr.type)}</span></dd>`; })()}
      <dt>Board</dt><dd>${esc(state.grade)} · ${esc(state.caliper)}" caliper</dd>
      <dt>Flat piece size</dt><dd>${flat}</dd>
      <dt>Stacking pattern</dt><dd>${patternText(load)}</dd>
      <dt>Stacks per layer</dt><dd>${load.cols}</dd>
      <dt>Thickness per piece</dt><dd>${fmtNum(r.piece.h, 3)}"${parseFloat(state.thick) > 0 ? ' (measured)' : ''}</dd>
      <dt>Pieces per stack</dt><dd>${fmtNum(load.perStack)}</dd>
      ${r.bundle ? `<dt>Bundles high</dt><dd>${bundleText(load, r.bundle)}</dd>` : ''}
      ${r.two ? `<dt>Loads</dt><dd>${r.qty ? `${fmtNum(r.loads)} × 2 pallets` : '2 pallets each'}</dd>` : ''}
      <dt>Bundles per ${r.two ? 'load' : 'pallet'}</dt><dd>${r.bundle ? fmtNum(load.bundlesPerPallet) : '–'}</dd>
      ${r.bundle && load.rawPerPallet !== load.perPallet ? `<dt>Fits by height</dt><dd>${fmtNum(load.rawPerPallet)} pcs, rounded ${load.perPallet > load.rawPerPallet ? 'up' : 'down'} to ${fmtNum(load.perPallet)} (whole bundles)</dd>` : ''}
      <dt>Footprint used</dt><dd>${fmtNum(load.footprintUse * 100)}%</dd>
      ${wt ? `<dt>Weight per full ${r.two ? 'load' : 'pallet'} (est.)</dt><dd>≈ ${fmtNum(wt.pallet)} lb</dd><dt>Weight per piece (est.)</dt><dd>${fmtNum(wt.piece, 2)} lb</dd>` : ''}
      <dt>Overhang</dt><dd>${load.overhangX > 0.01 || load.overhangY > 0.01 ? overhangText(r, true) : 'None'}</dd>
      ${r.qty && r.loads > 1 ? `<dt>Last ${r.two ? 'load' : 'pallet'}</dt><dd>${fmtNum(r.lastPallet)} pcs</dd>` : ''}
    </dl>
    ${load.footprintUse < 0.7 ? '<p class="note" style="margin:12px 0 0">Less than 70% of the deck is covered. Check another pallet size, or confirm the customer is OK with this pattern.</p>' : ''}`;

  // two short lists: fewest pallets, and best deck coverage (most product per trailer)
  const withTrailer = r.recs.map((p) => {
    const base = p.base || { w: p.w, l: p.l };
    const loadsPerTruck = perTrailer({ footW: base.w + 2 * p.overhangY, footL: base.l + 2 * p.overhangX, loadH: PALLET_H + p.stackHeight });
    const pr = priceOf(p.w, p.l);
    const each = pr ? pr.cost : null;
    const perLoad = each !== null ? each * (r.two ? 2 : 1) : null;
    const total = each !== null && r.qty ? each * p.pallets : null;
    const perPc = perLoad !== null ? perLoad / p.perPallet : null;
    // Trailer view: as built, or shortened so two loads stack under the roof, whichever ships more per truck.
    let truck = { perPallet: p.perPallet, loadsPerTruck, pcsPerTruck: loadsPerTruck * p.perPallet, shortH: null, pallets: p.pallets };
    const dblH = Math.floor(TRAILER.h / 2); // tallest load that still double stacks
    if (PALLET_H + p.stackHeight > dblH && dblH - PALLET_H > r.piece.h) {
      const args = { piece: r.piece, overhang: r.overhang, maxStack: dblH - PALLET_H, bundle: r.bundle, mode: state.pattern, fullBundles: r.fullBundles };
      const ld = r.two ? loadTwo({ ...args, pallet: { w: p.w, l: p.l } }).load : loadFor({ ...args, pallet: { w: p.w, l: p.l } });
      if (ld.perPallet > 0) {
        const lpt = perTrailer({ footW: base.w + 2 * ld.overhangY, footL: base.l + 2 * ld.overhangX, loadH: PALLET_H + ld.stackHeight });
        if (lpt * ld.perPallet > truck.pcsPerTruck) {
          const units = r.qty ? Math.ceil(r.qty / ld.perPallet) : 0;
          truck = { perPallet: ld.perPallet, loadsPerTruck: lpt, pcsPerTruck: lpt * ld.perPallet, shortH: PALLET_H + ld.stackHeight, pallets: r.two ? units * 2 : units };
        }
      }
    }
    truck.trucks = r.qty && truck.pcsPerTruck ? r.qty / truck.pcsPerTruck : null;
    return { ...p, loadsPerTruck, pcsPerTruck: loadsPerTruck * p.perPallet, trucks: r.qty && loadsPerTruck ? r.qty / (loadsPerTruck * p.perPallet) : null, each, total, perPc, truck };
  });
  const fewest = withTrailer.slice(0, 3);
  // Best trailer use: most pieces per truck (floor fit side by side + double stacking), then cheaper pallets.
  const trailerBest = [...withTrailer].sort((p, q) => (p.oversize - q.oversize) || q.truck.pcsPerTruck - p.truck.pcsPerTruck || (p.each ?? 1e9) - (q.each ?? 1e9)).slice(0, 3)
    .map((p) => ({ ...p, perPallet: p.truck.perPallet, pallets: p.truck.pallets, loadsPerTruck: p.truck.loadsPerTruck, pcsPerTruck: p.truck.pcsPerTruck, shortH: p.truck.shortH, trucks: p.truck.trucks,
      total: p.each !== null && r.qty ? p.each * p.truck.pallets : null }));
  const costKey = (p) => (r.qty ? p.total : p.perPc);
  const cheapest = withTrailer.filter((p) => costKey(p) !== null)
    .sort((p, q) => (p.oversize - q.oversize) || costKey(p) - costKey(q) || p.pallets - q.pallets).slice(0, 3);
  const table = (rows, title, hint) => `
    <h3 style="margin:14px 0 4px;font-size:15px">${title}</h3><p class="hint" style="margin:0 0 6px">${hint}</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Pallet</th><th>${r.two ? 'Pcs/load' : 'Pcs/pallet'}</th>${r.qty ? '<th>Pallets</th>' : ''}<th>Coverage</th><th>Per trailer</th><th>${r.qty ? 'Pallet cost' : '$/pallet'}</th><th></th></tr></thead><tbody>
    ${rows.map((p, i) => {
      const sel = pallet.w === p.w && pallet.l === p.l;
      return `<tr class="${sel ? 'best' : ''}"><td style="white-space:nowrap">${r.two ? '2 × ' : ''}${p.w} × ${p.l}${i === 0 ? ' <span class="pill star">Best</span>' : ''}${r.two && p.base ? `<br><span class="hint">${p.base.w} × ${p.base.l} base</span>` : ''}${p.oversize ? '<br><span class="pill warn">overhang</span>' : ''}</td><td>${fmtNum(p.perPallet)}</td>${r.qty ? `<td>${p.pallets}</td>` : ''}<td>${fmtNum(p.footprintUse * 100)}%</td><td style="white-space:nowrap">${fmtNum(p.pcsPerTruck)} pcs<br><span class="hint">${p.loadsPerTruck} ${r.two ? 'loads' : 'pallets'}${p.trucks ? ` · ${fmtNum(p.trucks, 2)} truck${p.trucks > 1 ? 's' : ''}` : ''}</span>${p.shortH ? `<br><span class="pill info">${fmtIn(p.shortH)} tall, double stacked</span>` : ''}</td><td style="white-space:nowrap">${p.each === null ? '<span class="hint">no price</span>' : r.qty ? `<b>${money(p.total)}</b><br><span class="hint">${money(p.each)} ea</span>` : money(p.each)}</td><td><button class="btn small" type="button" data-pick="${p.w}x${p.l}" ${sel ? 'disabled' : ''}>Use</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  recBox.innerHTML = `<h2>Pallet options</h2>
    ${cheapest.length ? table(cheapest, 'Lowest pallet cost', r.qty ? `Cheapest total pallet cost for ${fmtNum(r.qty)} pcs (pallets needed × price).` : 'Lowest pallet cost per piece. Enter an order quantity to see the total.') : ''}
    ${table(trailerBest, 'Best trailer use', 'Most pieces per truck: pallets that fit side by side across the trailer and double stack. A load may be built shorter so two stack under the roof. Pallet count not considered.')}
    ${table(fewest, 'Fewest pallets', r.qty ? `Least pallets for ${fmtNum(r.qty)} pcs, then the smallest pallet.` : 'Enter an order quantity to rank by pallet count.')}
    <p class="hint" style="margin:8px 0 0">Per trailer = 53' van: 96" usable width, 630" long, 108" high inside; double stacked when two fit under the roof.</p>`;
  $$('#palRecs [data-pick]').forEach((b) => b.addEventListener('click', () => { state.pallet = b.dataset.pick; $('#pPal').value = state.pallet; update(); }));

  $('#topView').innerHTML = topViewSvg(r.base, load);
  drawScene({ pallet: r.base, load, piece: r.piece, pieces: shownPieces, board: state.board });
}

// ---------- top view ----------
function topViewSvg(pallet, load) {
  const pad = 6;
  const minX = Math.min(0, ...load.rects.map((r) => r.x)), minY = Math.min(0, ...load.rects.map((r) => r.y));
  const maxX = Math.max(pallet.l, ...load.rects.map((r) => r.x + r.w)), maxY = Math.max(pallet.w, ...load.rects.map((r) => r.y + r.l));
  const W = maxX - minX + pad * 2, H = maxY - minY + pad * 2;
  const tx = (x) => x - minX + pad, ty = (y) => y - minY + pad;
  const fs = Math.max(1.6, Math.min(W, H) / 22);
  return `<svg class="topview" viewBox="0 0 ${W} ${H}" role="img" aria-label="Top view of one layer">
    <rect x="${tx(0)}" y="${ty(0)}" width="${pallet.l}" height="${pallet.w}" fill="#a57c4c" opacity=".35" stroke="#7a5a33" stroke-width=".4"/>
    ${pallet.join === 'width' ? `<line x1="${tx(0)}" y1="${ty(pallet.w / 2)}" x2="${tx(pallet.l)}" y2="${ty(pallet.w / 2)}" stroke="#7a5a33" stroke-width=".6" stroke-dasharray="2 1"/>` : ''}
    ${pallet.join === 'length' ? `<line x1="${tx(pallet.l / 2)}" y1="${ty(0)}" x2="${tx(pallet.l / 2)}" y2="${ty(pallet.w)}" stroke="#7a5a33" stroke-width=".6" stroke-dasharray="2 1"/>` : ''}
    ${load.rects.map((r, i) => `<rect x="${tx(r.x) + 0.15}" y="${ty(r.y) + 0.15}" width="${r.w - 0.3}" height="${r.l - 0.3}" fill="#d9b88a" stroke="#6b4e2c" stroke-width=".35"/>
      <text x="${tx(r.x + r.w / 2)}" y="${ty(r.y + r.l / 2) + fs * 0.35}" font-size="${fs}" text-anchor="middle" fill="#4a3519" font-family="sans-serif">${i + 1}</text>`).join('')}
    ${load.chimney && load.chimney.w > 0.01 && load.chimney.l > 0.01 ? `<rect x="${tx(load.chimney.x)}" y="${ty(load.chimney.y)}" width="${load.chimney.w}" height="${load.chimney.l}" fill="none" stroke="#00694b" stroke-width=".5" stroke-dasharray="1.2 .8"/>` : ''}
    ${load.oversize || load.overhangX > 0.01 || load.overhangY > 0.01 ? `<rect x="${tx(0)}" y="${ty(0)}" width="${pallet.l}" height="${pallet.w}" fill="none" stroke="#b3261e" stroke-width=".6" stroke-dasharray="2 1.2"/><text x="${tx(pallet.l / 2)}" y="${ty(0) - 1}" font-size="${fs * 0.8}" text-anchor="middle" fill="#b3261e" font-family="sans-serif">pallet edge</text>` : ''}
    <text x="${tx(pallet.l / 2)}" y="${H - 1}" font-size="${fs * 0.9}" text-anchor="middle" fill="currentColor" font-family="sans-serif" opacity=".7">${fmtNum(pallet.l, pallet.l % 1 ? 2 : 0)}" length</text>
  </svg>`;
}

// ---------- 3D ----------
function initThree(el) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  el.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 4 / 3, 1, 5000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(80, 140, 60); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-90, 40, -70); scene.add(fill);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495;
  const group = new THREE.Group(); scene.add(group);
  three = { renderer, scene, camera, controls, group, el, size: 60, raf: 0 };
  const resize = () => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  three.ro = new ResizeObserver(resize); three.ro.observe(el); resize();
  const loop = () => { three.raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
  loop();
}

function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
  g.clear();
}

function setCam(kind) {
  if (!three) return;
  const s = three.size, c = three.camera, t = three.controls.target;
  if (kind === 'top') c.position.set(t.x, t.y + s * 2.3, t.z + 0.01);
  else if (kind === 'side') c.position.set(t.x, t.y + s * 0.1, t.z + s * 2.3);
  else c.position.set(t.x + s * 1.5, t.y + s * 1.05, t.z + s * 1.6);
  c.lookAt(t);
}

function box(w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function drawScene(data) {
  if (!three) return;
  disposeGroup(three.group);
  if (!data) return;
  const { pallet, load, piece, pieces, board } = data; // pallet = the base under the load (one or two pallets)
  const g = three.group;
  const L = pallet.l, W = pallet.w;

  // Pallet(s): 3 stringers, top deck boards, bottom boards. Two pallets are drawn pushed together.
  const wood = new THREE.MeshStandardMaterial({ color: 0xb48a57, roughness: 0.9 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x8f6a3e, roughness: 0.9 });
  const deckT = 0.75, runnerH = PALLET_H - deckT * 2;
  const one = (pl, pw, cx, cz) => {
    for (const zf of [-0.5, 0, 0.5]) g.add(box(pl, runnerH, 3.5, cx, deckT + runnerH / 2, cz + zf * (pw - 3.5), woodDark));
    const nTop = Math.max(5, Math.round(pl / 6.5));
    for (let i = 0; i < nTop; i++) g.add(box(5.5, deckT, pw, cx - pl / 2 + 2.75 + i * ((pl - 5.5) / (nTop - 1)), PALLET_H - deckT / 2, cz, wood));
    for (const xf of [-0.5, 0, 0.5]) g.add(box(5.5, deckT, pw, cx + xf * (pl - 5.5), deckT / 2, cz, wood));
  };
  if (pallet.join === 'width') { one(L, W / 2 - 0.15, 0, -W / 4); one(L, W / 2 - 0.15, 0, W / 4); }
  else if (pallet.join === 'length') { one(L / 2 - 0.15, W, -L / 4, 0); one(L / 2 - 0.15, W, L / 4, 0); }
  else one(L, W, 0, 0);

  // Product: fill tier by tier, stack by stack, up to "pieces".
  const slots = [];
  let remain = pieces;
  // per-stack cap; rounding up to a whole bundle can add a few pieces above the height-fit count
  const colCap = Math.max(load.perStack, Math.ceil(pieces / Math.max(1, load.rects.length)));
  const tierMax = load.tierPieces > 0 ? Math.ceil(colCap / load.tierPieces) : 0;
  for (let t = 0; t < tierMax && remain > 0; t++) {
    for (let c = 0; c < load.rects.length && remain > 0; c++) {
      const n = Math.min(load.tierPieces, colCap - t * load.tierPieces, remain);
      if (n <= 0) continue;
      slots.push({ t, c, n }); remain -= n;
    }
  }
  const colors = board === 'white' ? [0xf1efe9, 0xe4e1d8] : [0xc9a06d, 0xb98f5c];
  const mats = colors.map((col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 }));
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const meshes = mats.map((m, i) => new THREE.InstancedMesh(geo, m, slots.filter((s) => s.t % 2 === i).length || 1));
  const counters = [0, 0];
  const edgePts = [];
  const mtx = new THREE.Matrix4();
  const gap = 0.12;
  for (const s of slots) {
    const r = load.rects[s.c];
    const h = s.n * piece.h;
    const y0 = PALLET_H + s.t * load.tierHeight;
    const cx = r.x + r.w / 2 - L / 2, cz = r.y + r.l / 2 - W / 2;
    const sx = r.w - gap, sz = r.l - gap, sy = Math.max(h - gap * 0.5, 0.05);
    mtx.compose(new THREE.Vector3(cx, y0 + h / 2, cz), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    const k = s.t % 2;
    meshes[k].setMatrixAt(counters[k]++, mtx);
    // edges of this block
    const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2, ya = y0, yb = y0 + sy;
    const P = [[x0, ya, z0], [x1, ya, z0], [x1, ya, z1], [x0, ya, z1], [x0, yb, z0], [x1, yb, z0], [x1, yb, z1], [x0, yb, z1]];
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) edgePts.push(...P[a], ...P[b]);
  }
  meshes.forEach((m, i) => { m.count = counters[i]; m.instanceMatrix.needsUpdate = true; g.add(m); });
  if (edgePts.length) {
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3));
    g.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: board === 'white' ? 0x8c8778 : 0x5e4426, transparent: true, opacity: 0.55 })));
  }

  // frame camera on first draw / size change
  const height = PALLET_H + load.stackHeight;
  const spanX = Math.max(L, ...load.rects.map((r) => Math.max(r.x + r.w, L) - Math.min(r.x, 0)));
  const spanZ = Math.max(W, ...load.rects.map((r) => Math.max(r.y + r.l, W) - Math.min(r.y, 0)));
  const size = Math.max(spanX, spanZ, height);
  const target = new THREE.Vector3(0, height / 2, 0);
  const changed = Math.abs(size - three.size) > 0.5 || !three.framed;
  three.controls.target.copy(target);
  three.size = size;
  if (changed) { setCam('iso'); three.framed = true; }
}


// ---------- print ----------
function snapshot3D() {
  if (!three) return '';
  const c = three.camera, t = three.controls.target;
  const saved = c.position.clone();
  setCam('iso');
  three.renderer.render(three.scene, c);
  const url = three.renderer.domElement.toDataURL('image/png');
  c.position.copy(saved); c.lookAt(t); three.controls.update();
  return url;
}

function printSheet() {
  const r = last;
  if (!r || r.need || r.noFit || !r.load || !r.load.perPallet) { alert('Fill in the piece size first so there is a load to print.'); return; }
  const { load, pallet, piece } = r;
  const img = snapshot3D();
  const styleName = { RSC: 'RSC', HSC: 'HSC', FOL: 'FOL', SHEET: 'Sheet / blank' }[state.style];
  const dims = state.style === 'SHEET' ? `${fmtIn(parseInches(state.sheetW))} × ${fmtIn(parseInches(state.sheetL))} sheet` : `${fmtIn(parseInches(state.L))} × ${fmtIn(parseInches(state.W))} × ${fmtIn(parseInches(state.D))} (L × W × D)`;
  const showLast = state.show === 'last' && r.qty > 0;
  const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  let sheet = document.getElementById('printSheet');
  if (!sheet) { sheet = document.createElement('div'); sheet.id = 'printSheet'; document.body.appendChild(sheet); }
  sheet.innerHTML = `
    <div class="ps-head"><div><h1>Pallet Load Sheet</h1><div class="ps-sub">GoldenWest Packaging · Ontario</div></div><div class="ps-date">${esc(now)}</div></div>
    <table class="ps-kv ps-top">${row('Customer', esc(state.customer) || '&nbsp;')}${row('Job / order #', esc(state.job) || '&nbsp;')}</table>
    <div class="ps-grid">
      <table class="ps-kv">
        <caption>Piece</caption>
        ${row('Style', esc(styleName))}
        ${row('Size', dims)}
        ${row('Flat size on pallet', `${fmtIn(piece.b)} × ${fmtIn(piece.a)}`)}
        ${row('Board grade', `${esc(state.grade)} (${esc(state.flute)} flute)`)}
        ${row('Caliper', `${esc(state.caliper)}"`)}
        ${row('Thickness per piece', `${fmtNum(piece.h, 3)}"`)}
        ${row('Pieces per bundle', r.bundle ? fmtNum(r.bundle) : 'Loose')}
      </table>
      <table class="ps-kv">
        <caption>Pallet</caption>
        ${row('Stacking pattern', patternText(load))}
        ${row('Pallet size (W × L)', palletLabel(r))}
        ${(() => { const pr = priceOf(pallet.w, pallet.l); return pr && pr.cost !== null ? row('Pallet cost', `${money(pr.cost)} each${r.qty ? ` · ${money(pr.cost * r.pallets)} for ${fmtNum(r.pallets)}` : ''}`) : ''; })()}
        ${row('Overhang', load.overhangX > 0.01 || load.overhangY > 0.01 ? overhangText(r, true) : 'None')}
        ${row('Max height incl. pallet', `${esc(state.maxTotal)}" (${esc(state.palletH)}" pallet)`)}
        ${row('Load height incl. pallet', fmtIn(PALLET_H + load.stackHeight))}
        ${row('Footprint used', `${fmtNum(load.footprintUse * 100)}%`)}
        ${weights(r) ? row(r.two ? 'Weight per full load' : 'Weight per full pallet', `≈ ${fmtNum(weights(r).pallet)} lb (estimate)`) : ''}
      </table>
    </div>
    <div class="ps-big">
      <div><b>${fmtNum(load.perPallet)}</b><span>pcs per full ${r.two ? 'load (2 pallets)' : 'pallet'}</span></div>
      <div><b>${load.cols}</b><span>stacks per layer</span></div>
      <div><b>${fmtNum(load.perStack)}</b><span>pcs per stack${r.bundle ? ` (${bundleText(load, r.bundle)})` : ''}</span></div>
      ${r.qty ? `<div><b>${fmtNum(r.pallets)}</b><span>pallets for ${fmtNum(r.qty)} pcs</span></div>` : ''}
      ${r.qty && r.loads > 1 ? `<div><b>${fmtNum(r.lastPallet)}</b><span>pcs on last ${r.two ? 'load' : 'pallet'}</span></div>` : ''}
    </div>
    <div class="ps-pics">
      ${img ? `<figure><img src="${img}" alt="3D view of the load"><figcaption>${showLast ? 'Last pallet' : 'Full pallet'}</figcaption></figure>` : ''}
      <figure>${topViewSvg(r.base, load)}<figcaption>Layer pattern (top view), ${load.cols} stacks, ${load.kind === 'chimney' ? 'chimney' : 'straight'}</figcaption></figure>
    </div>
    ${state.notes ? `<div class="ps-notes"><b>Notes:</b> ${esc(state.notes)}</div>` : ''}
    <div class="ps-sign"><span>Built by: ______________________</span><span>Checked by: ______________________</span></div>`;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  // let the image decode before the print dialog opens
  const im = sheet.querySelector('img');
  const go = () => setTimeout(() => window.print(), 50);
  if (im && !im.complete) { im.onload = go; im.onerror = go; } else go();
}

// Estimated weights: board area × lb/MSF, plus a typical ~45 lb wood pallet.
function weights(r) {
  const lbs = parseFloat(state.lbsMsf);
  if (!(lbs > 0) || !r.piece || !r.load) return null;
  const piece = (r.piece.areaSqIn / 144) * (lbs / 1000);
  return { piece, pallet: piece * r.load.perPallet + (r.two ? 90 : 45) };
}

function patternText(load) {
  if (load.kind !== 'chimney') return 'Straight columns';
  const h = load.chimney;
  return h && h.w > 0.01 && h.l > 0.01 ? `Chimney (${fmtIn(h.w)} × ${fmtIn(h.l)} open center)` : 'Chimney (pinwheel)';
}

function palletLabel(r) {
  const n = (x) => fmtNum(x, x % 1 ? 2 : 0);
  if (!r.two) return `${n(r.pallet.w)} × ${n(r.pallet.l)} pallet`;
  const how = r.base.join === 'width' ? 'side by side' : 'end to end';
  return `2 × ${n(r.pallet.w)} × ${n(r.pallet.l)} pallets ${how} (${n(r.base.w)} × ${n(r.base.l)} base)`;
}

function bundleText(load, bundle) {
  return `${load.fullTiers} × ${bundle}${load.loose ? ` + ${load.loose} loose on top` : ''}`;
}

// "Hangs over 9" each side on the 72" sides and 7 1/2" each side on the 60" sides"
function overhangText(r, short = false) {
  const { load, base } = r;
  const parts = [];
  if (load.overhangX > 0.01) parts.push(`${fmtIn(load.overhangX)} each end of the ${fmtNum(base.l, base.l % 1 ? 2 : 0)}" length`);
  if (load.overhangY > 0.01) parts.push(`${fmtIn(load.overhangY)} each side of the ${fmtNum(base.w, base.w % 1 ? 2 : 0)}" width`);
  if (!parts.length) return short ? 'None' : 'No overhang.';
  return short ? parts.join(', ') : `It hangs over ${parts.join(' and ')}.`;
}


// ---------- pallet price list ----------
function rebuildCatalog() {
  catalog = palletCatalog(prices.items, !!state.htOnly);
  const sel = $('#pPal');
  if (!sel) return;
  const keep = state.pallet;
  sel.innerHTML = `<option value="auto">Best fit (lowest pallet cost)</option>${catalog.map((c) => `<option value="${c.w}x${c.l}">${c.w} × ${c.l}${c.cost !== null ? ` · ${money(c.cost)}` : ' · no price'}</option>`).join('')}<option value="custom">Custom size…</option>`;
  if (keep !== 'auto' && keep !== 'custom' && !catalog.some((c) => `${c.w}x${c.l}` === keep)) state.pallet = 'auto';
  sel.value = state.pallet;
  const when = prices.uploadedAt ? new Date(prices.uploadedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const st = $('#pPriceStatus');
  if (st) st.textContent = `${catalog.length} sizes${state.htOnly ? ' (HT only)' : ''} from ${prices.fileName || 'price list'}${when ? `, uploaded ${when}` : ''}. Cheapest type per size is used.`;
}

async function uploadPrices(file) {
  const st = $('#pPriceStatus');
  st.innerHTML = '<span class="spinner"></span> Reading the price list…';
  try {
    if (!window.XLSX) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/xlsx.full.min.js'; sc.onload = res; sc.onerror = () => rej(new Error('Could not load the Excel reader')); document.head.appendChild(sc); });
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
    const items = parsePriceRows(rows);
    if (!items.length) throw new Error('No pallet sizes found. The file needs "Pallet Type", "Pallet Size" and "Cost" columns.');
    prices = { items, fileName: file.name, uploadedAt: new Date().toISOString() };
    try { localStorage.setItem('gwprod_pallet_prices', JSON.stringify(prices)); } catch {}
    rebuildCatalog(); update();
    try { prices = await api('/api/pallets', { method: 'PUT', body: JSON.stringify({ items, fileName: file.name }) }); localStorage.setItem('gwprod_pallet_prices', JSON.stringify(prices)); rebuildCatalog(); st.textContent += ' Shared with everyone.'; }
    catch (e) { st.textContent += ` (Saved on this device only: ${e.message})`; }
  } catch (e) {
    st.innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`;
  }
}

export function parsePriceRows(rows) {
  const norm = (v) => String(v ?? '').toLowerCase().trim();
  let h = -1, cT = -1, cS = -1, cC = -1;
  for (let r = 0; r < Math.min(rows.length, 15) && h < 0; r++) {
    const cells = (rows[r] || []).map(norm);
    const s = cells.findIndex((c) => c.includes('size'));
    const c = cells.findIndex((x) => x.includes('cost') || x.includes('price'));
    if (s >= 0 && c >= 0) { h = r; cS = s; cC = c; cT = cells.findIndex((x) => x.includes('type') || x.includes('description')); }
  }
  if (h < 0) return [];
  const out = [];
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const m = String(row[cS] ?? '').match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/);
    if (!m) continue;
    const a = +m[1], b = +m[2];
    const cost = row[cC] === '' || row[cC] === null || !isFinite(+String(row[cC]).replace(/[$,]/g, '')) ? null : +String(row[cC]).replace(/[$,]/g, '');
    out.push({ type: String(cT >= 0 ? row[cT] : row[cS]).trim(), w: Math.min(a, b), l: Math.max(a, b), cost: cost > 0 ? cost : null });
  }
  return out;
}
