import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { $, $$, esc, parseInches, fmtIn, fmtNum, saveForm, loadForm } from './common.js';
import { CALIPER, STANDARD_PALLETS, flatPiece, loadFor, palletsNeeded, recommend } from './palletcalc.js';

const PALLET_H = 5; // typical wood pallet height, inches
let state, three = null;

const DEFAULTS = { style: 'RSC', L: '', W: '', D: '', sheetW: '', sheetL: '', flute: 'C', caliper: String(CALIPER.C), bundle: '25', qty: '', maxStack: '48', overhang: '0', pallet: 'auto', customW: '', customL: '', show: 'full', board: 'kraft' };

export function render(view) {
  state = { ...DEFAULTS, ...(loadForm('pallet') || {}) };
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
          <div class="row" id="sheetDims">
            <div class="field"><label for="pSW">Sheet width (in)</label><input id="pSW" data-f="sheetW" type="text" inputmode="decimal" placeholder="33"></div>
            <div class="field"><label for="pSL">Sheet length (in)</label><input id="pSL" data-f="sheetL" type="text" inputmode="decimal" placeholder="52"></div>
          </div>
          <div class="lbl" style="margin:4px 0 6px">Flute</div>
          <div class="seg" id="fluteSeg">${Object.keys(CALIPER).map((k) => `<button type="button" data-k="${k}">${k}</button>`).join('')}</div>
          <div class="row" style="margin-top:10px">
            <div class="field"><label for="pCal">Caliper per sheet (in)</label><input id="pCal" data-f="caliper" type="number" step="0.001" min="0"><span class="hint">Typical value, edit if needed</span></div>
            <div class="field"><label for="pBundle">Pieces per bundle</label><input id="pBundle" data-f="bundle" type="number" min="0" step="1"><span class="hint">0 = loose stacked</span></div>
          </div>
        </section>
        <section class="card">
          <h2><span class="n">2</span>Order &amp; pallet</h2>
          <div class="row">
            <div class="field"><label for="pQty">Order quantity</label><input id="pQty" data-f="qty" type="number" min="0" step="1" placeholder="5000"></div>
            <div class="field"><label for="pMax">Max product height (in)</label><input id="pMax" data-f="maxStack" type="number" min="1" step="1"><span class="hint">Not counting the ${PALLET_H}" pallet</span></div>
            <div class="field"><label for="pOver">Overhang allowed</label><select id="pOver" data-f="overhang">${[0, 1, 2, 3].map((n) => `<option value="${n}">${n}" per side</option>`).join('')}</select></div>
          </div>
          <div class="row">
            <div class="field"><label for="pPal">Pallet size (W × L)</label>
              <select id="pPal" data-f="pallet"><option value="auto">Best fit (recommended)</option>${STANDARD_PALLETS.map(([w, l]) => `<option value="${w}x${l}">${w} × ${l}</option>`).join('')}<option value="custom">Custom size…</option></select></div>
            <div class="field" id="customWrap"><label>Custom W × L (in)</label><div style="display:flex;gap:6px"><input data-f="customW" id="pCW" type="text" inputmode="decimal" placeholder="W"><input data-f="customL" id="pCL" type="text" inputmode="decimal" placeholder="L"></div></div>
          </div>
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
  $$('#fluteSeg button').forEach((b) => b.addEventListener('click', () => { state.flute = b.dataset.k; state.caliper = String(CALIPER[b.dataset.k]); $('#pCal').value = state.caliper; update(); }));
  $$('#showSeg button').forEach((b) => b.addEventListener('click', () => { state.show = b.dataset.k; update(); }));
  $$('#viewer [data-cam]').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam)));
  $('#boardBtn').addEventListener('click', () => { state.board = state.board === 'kraft' ? 'white' : 'kraft'; update(); });

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
  const maxStack = parseFloat(state.maxStack);
  const overhang = parseFloat(state.overhang) || 0;
  const dims = state.style === 'SHEET'
    ? { sheetW: parseInches(state.sheetW), sheetL: parseInches(state.sheetL) }
    : { L: parseInches(state.L), W: parseInches(state.W), D: parseInches(state.D) };
  const need = [];
  if (state.style === 'SHEET') { if (!(dims.sheetW > 0)) need.push('sheet width'); if (!(dims.sheetL > 0)) need.push('sheet length'); }
  else { if (!(dims.L > 0)) need.push('length'); if (!(dims.W > 0)) need.push('width'); if (!(dims.D > 0)) need.push('depth'); }
  if (!(caliper > 0)) need.push('caliper');
  if (!(maxStack > 0)) need.push('max height');
  if (need.length) return { need };

  const piece = flatPiece({ style: state.style, ...dims, caliper });
  const recs = recommend({ piece, qty, overhang, maxStack, bundle });
  let pallet, load;
  if (state.pallet === 'auto') {
    if (!recs.length) return { piece, recs, qty, noFit: true };
    pallet = { w: recs[0].w, l: recs[0].l };
  } else if (state.pallet === 'custom') {
    const w = parseInches(state.customW), l = parseInches(state.customL);
    if (!(w > 0 && l > 0)) return { need: ['custom pallet size'] };
    pallet = { w, l };
  } else {
    const [w, l] = state.pallet.split('x').map(Number);
    pallet = { w, l };
  }
  load = loadFor({ piece, pallet, overhang, maxStack, bundle });
  const pn = palletsNeeded(qty, load.perPallet);
  return { piece, recs, pallet, load, qty, bundle, overhang, ...pn };
}

function update() {
  saveForm('pallet', state);
  $$('#styleSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === state.style)));
  $$('#fluteSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === state.flute)));
  $$('#showSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === state.show)));
  $('#boxDims').classList.toggle('hidden', state.style === 'SHEET');
  $('#sheetDims').classList.toggle('hidden', state.style !== 'SHEET');
  $('#customWrap').classList.toggle('hidden', state.pallet !== 'custom');

  const r = compute();
  const res = $('#palResult'), recBox = $('#palRecs');
  if (r.need) {
    res.innerHTML = `<h2>Result</h2><p class="hint" style="margin:0">Still need: ${r.need.join(', ')}.</p>`;
    recBox.innerHTML = '<h2>Pallet options</h2><p class="hint" style="margin:0">Enter the piece size to compare pallets.</p>';
    drawScene(null); $('#topView').innerHTML = '';
    return;
  }
  const flat = `${fmtIn(r.piece.b)} × ${fmtIn(r.piece.a)}`;
  if (r.noFit || !r.load.perPallet) {
    res.innerHTML = `<h2>Result</h2><div class="alert err">The piece (${flat} flat) does not fit ${r.noFit ? 'any standard pallet' : 'this pallet'} at this height and overhang. Try a bigger pallet, more overhang, or fewer pieces per bundle.</div>`;
    recBox.innerHTML = '';
    drawScene(null); $('#topView').innerHTML = '';
    return;
  }
  const { load, pallet } = r;
  const totalH = PALLET_H + load.stackHeight;
  const showLast = state.show === 'last' && r.qty > 0;
  const shownPieces = showLast ? r.lastPallet : load.perPallet;

  res.innerHTML = `
    <h2>Result · ${fmtNum(pallet.w, pallet.w % 1 ? 2 : 0)} × ${fmtNum(pallet.l, pallet.l % 1 ? 2 : 0)} pallet</h2>
    <div class="big-nums">
      ${r.qty ? `<div class="stat hero"><div class="v">${fmtNum(r.pallets)}</div><div class="l">Pallet${r.pallets === 1 ? '' : 's'} for ${fmtNum(r.qty)} pcs</div></div>` : ''}
      <div class="stat ${r.qty ? '' : 'hero'}"><div class="v">${fmtNum(load.perPallet)}</div><div class="l">Pieces per full pallet</div></div>
      <div class="stat"><div class="v">${fmtIn(totalH)}</div><div class="l">Load height incl. pallet</div></div>
    </div>
    <dl class="kv" style="margin-top:12px">
      <dt>Flat piece size</dt><dd>${flat}</dd>
      <dt>Stacks per layer</dt><dd>${load.cols}</dd>
      ${r.bundle ? `<dt>Bundles high</dt><dd>${load.tiers} × ${r.bundle} pcs (${fmtIn(load.tierHeight)} each)</dd>` : `<dt>Pieces per stack</dt><dd>${fmtNum(load.perStack)}</dd>`}
      <dt>Bundles per pallet</dt><dd>${r.bundle ? fmtNum(load.cols * load.tiers) : '–'}</dd>
      <dt>Footprint used</dt><dd>${fmtNum(load.footprintUse * 100)}%</dd>
      ${load.overhangX || load.overhangY ? `<dt>Overhang</dt><dd>${fmtIn(Math.max(load.overhangX, load.overhangY))} per side</dd>` : ''}
      ${r.qty && r.pallets > 1 ? `<dt>Last pallet</dt><dd>${fmtNum(r.lastPallet)} pcs</dd>` : ''}
    </dl>
    ${load.footprintUse < 0.7 ? '<p class="note" style="margin:12px 0 0">Less than 70% of the deck is covered. Check another pallet size, or confirm the customer is OK with this pattern.</p>' : ''}`;

  recBox.innerHTML = `<h2>Pallet options ${r.qty ? '· fewest pallets first' : '· best coverage first'}</h2>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Pallet</th><th>Pcs/pallet</th>${r.qty ? '<th>Pallets</th>' : ''}<th>Coverage</th><th></th></tr></thead><tbody>
    ${r.recs.slice(0, 6).map((p, i) => {
      const sel = pallet.w === p.w && pallet.l === p.l;
      return `<tr class="${sel ? 'best' : ''}"><td style="white-space:nowrap">${p.w} × ${p.l}${i === 0 ? ' <span class="pill star">Best</span>' : ''}</td><td>${fmtNum(p.perPallet)}</td>${r.qty ? `<td>${p.pallets}</td>` : ''}<td>${fmtNum(p.footprintUse * 100)}%</td><td><button class="btn small" type="button" data-pick="${p.w}x${p.l}" ${sel ? 'disabled' : ''}>Use</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  $$('#palRecs [data-pick]').forEach((b) => b.addEventListener('click', () => { state.pallet = b.dataset.pick; $('#pPal').value = state.pallet; update(); }));

  $('#topView').innerHTML = topViewSvg(pallet, load);
  drawScene({ pallet, load, piece: r.piece, pieces: shownPieces, board: state.board });
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
    ${load.rects.map((r, i) => `<rect x="${tx(r.x) + 0.15}" y="${ty(r.y) + 0.15}" width="${r.w - 0.3}" height="${r.l - 0.3}" fill="#d9b88a" stroke="#6b4e2c" stroke-width=".35"/>
      <text x="${tx(r.x + r.w / 2)}" y="${ty(r.y + r.l / 2) + fs * 0.35}" font-size="${fs}" text-anchor="middle" fill="#4a3519" font-family="sans-serif">${i + 1}</text>`).join('')}
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
  const { pallet, load, piece, pieces, board } = data;
  const g = three.group;
  const L = pallet.l, W = pallet.w;

  // Pallet: 3 runners, top deck boards, bottom boards.
  const wood = new THREE.MeshStandardMaterial({ color: 0xb48a57, roughness: 0.9 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x8f6a3e, roughness: 0.9 });
  const deckT = 0.75, runnerH = PALLET_H - deckT * 2;
  for (const zf of [-0.5, 0, 0.5]) g.add(box(L, runnerH, 3.5, 0, deckT + runnerH / 2, zf * (W - 3.5), woodDark));
  // stringers run the length; deck boards run across the width
  const nTop = Math.max(5, Math.round(L / 6.5));
  for (let i = 0; i < nTop; i++) g.add(box(5.5, deckT, W, -L / 2 + 2.75 + i * ((L - 5.5) / (nTop - 1)), PALLET_H - deckT / 2, 0, wood));
  for (const xf of [-0.5, 0, 0.5]) g.add(box(5.5, deckT, W, xf * (L - 5.5), deckT / 2, 0, wood));

  // Product: fill tier by tier, stack by stack, up to "pieces".
  const slots = [];
  let remain = pieces;
  for (let t = 0; t < load.tiers && remain > 0; t++) {
    for (let c = 0; c < load.rects.length && remain > 0; c++) {
      const n = Math.min(load.tierPieces, remain);
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
  const size = Math.max(L, W, height);
  const target = new THREE.Vector3(0, height / 2, 0);
  const changed = Math.abs(size - three.size) > 0.5 || !three.framed;
  three.controls.target.copy(target);
  three.size = size;
  if (changed) { setCam('iso'); three.framed = true; }
}
