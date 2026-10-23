// Plant Floor: the Ontario floor layout in 3D. Every machine can be clicked to see its specs.
// Positions are measured from the Plant Floor Layout drawing (pixels), then scaled into the world:
// 10 px on the drawing = 1 unit (about 0.7 m). The drawing's x runs west→east, y runs north→south.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { $, $$, esc, api } from './common.js';
import { LIST, rowsOf, printSpecs } from './specs.js';

// ---------- drawing → world ----------
const SC = 0.1, OX = 556, OY = 388;
const X = (px) => (px - OX) * SC;
const Z = (py) => (py - OY) * SC;
const V = (px, py, y = 0) => new THREE.Vector3(X(px), y, Z(py));

// ---------- palette (from the drawing) ----------
const C = {
  bg: 0xe8edf4, slab: 0xf8f9fb, grid: 0xe3e7ee, wall: 0xffffff, line: 0x2e333d,
  blue: 0x2b45d6, blueSoft: 0x6f82ea, navy: 0x1d2a66,
  body: 0xeef1f6, body2: 0xdfe4ec, frame: 0x3a404b, roller: 0x6a717e,
  red: 0xe0383a, amber: 0xf4a522, yellow: 0xffc93c, green: 0x2fc28a,
  kraft: 0xc9a06b, kraft2: 0xb88d58, plate: 0x8f9bb3, wood: 0xb98a55,
};

// ---------- shared geometry ----------
const gcache = new Map();
function rbox(w, h, d, r = 0.14) {
  const key = `${w.toFixed(2)}|${h.toFixed(2)}|${d.toFixed(2)}|${r}`;
  if (gcache.has(key)) return gcache.get(key);
  const b = Math.max(0.01, Math.min(r, w / 2 - 0.02, h / 2 - 0.02, d / 2 - 0.02));
  const iw = w - 2 * b, id = d - 2 * b;
  const rr = Math.max(0, Math.min(b * 0.8, iw / 2 - 0.005, id / 2 - 0.005));
  const s = new THREE.Shape();
  const x0 = -iw / 2, y0 = -id / 2;
  if (rr > 0.01) {
    s.moveTo(x0 + rr, y0); s.lineTo(x0 + iw - rr, y0); s.quadraticCurveTo(x0 + iw, y0, x0 + iw, y0 + rr);
    s.lineTo(x0 + iw, y0 + id - rr); s.quadraticCurveTo(x0 + iw, y0 + id, x0 + iw - rr, y0 + id);
    s.lineTo(x0 + rr, y0 + id); s.quadraticCurveTo(x0, y0 + id, x0, y0 + id - rr);
    s.lineTo(x0, y0 + rr); s.quadraticCurveTo(x0, y0, x0 + rr, y0);
  } else { s.moveTo(x0, y0); s.lineTo(x0 + iw, y0); s.lineTo(x0 + iw, y0 + id); s.lineTo(x0, y0 + id); s.lineTo(x0, y0); }
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, h - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 2 });
  g.rotateX(-Math.PI / 2);
  g.center();
  gcache.set(key, g);
  return g;
}
function cylG(r, h, seg = 14) {
  const key = `c${r}|${h}|${seg}`;
  if (!gcache.has(key)) gcache.set(key, new THREE.CylinderGeometry(r, r, h, seg));
  return gcache.get(key);
}
const mcache = new Map();
function smat(color, extra = {}) { // shared (scenery) material
  const key = color + JSON.stringify(extra);
  if (!mcache.has(key)) mcache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.04, ...extra }));
  return mcache.get(key);
}
function mesh(geo, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

// conveyor top: dark rollers stripe, scrolled to look like it is running
let stripeTex = null, beltTex = null;
function stripes() {
  if (stripeTex) return stripeTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 8;
  const x = c.getContext('2d');
  x.fillStyle = '#9aa0ab'; x.fillRect(0, 0, 64, 8);
  x.fillStyle = '#4a505b'; for (let i = 0; i < 64; i += 16) x.fillRect(i, 0, 7, 8);
  stripeTex = new THREE.CanvasTexture(c); stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping; stripeTex.colorSpace = THREE.SRGBColorSpace;
  return stripeTex;
}
function belt() {
  if (beltTex) return beltTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 8;
  const x = c.getContext('2d');
  x.fillStyle = '#3d434e'; x.fillRect(0, 0, 64, 8);
  x.fillStyle = '#5c6370'; for (let i = 0; i < 64; i += 8) x.fillRect(i, 0, 2, 8);
  beltTex = new THREE.CanvasTexture(c); beltTex.wrapS = beltTex.wrapT = THREE.RepeatWrapping; beltTex.colorSpace = THREE.SRGBColorSpace;
  return beltTex;
}
const D = (o) => { o.userData.dyn = true; return o; }; // marks a part that moves (never merged)
// Bake every still mesh under `root` into as few meshes as possible (one draw call per material group).
// Plain-colored parts share one vertex-colored mesh; textured / glowing / see-through parts merge by material.
function bake(root, extraMats) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const dynUp = (o) => { for (let p = o; p && p !== root; p = p.parent) if (p.userData.dyn) return true; return false; };
  const dynDown = (o) => { let d = false; o.traverse((c) => { if (c.userData.dyn) d = true; }); return d; };
  const buckets = new Map(), victims = [];
  root.traverse((o) => {
    if (!o.isMesh || o === root || dynUp(o) || o.children.some(dynDown)) return;
    const m = o.material;
    if (Array.isArray(m)) return;
    const plain = !m.map && !m.transparent && !(m.emissiveIntensity > 0 && m.emissive && m.emissive.getHex());
    const key = plain ? 'plain' : m.uuid;
    if (!buckets.has(key)) buckets.set(key, { mat: m, plain, parts: [] });
    buckets.get(key).parts.push(o); victims.push(o);
  });
  const rel = new THREE.Matrix4();
  for (const { mat, plain, parts } of buckets.values()) {
    if (parts.length < 2 && !plain) { continue; }
    const pos = [], nor = [], uvs = [], col = [];
    for (const o of parts) {
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      rel.multiplyMatrices(inv, o.matrixWorld); g.applyMatrix4(rel);
      const n = g.attributes.position.count;
      pos.push(g.attributes.position.array); nor.push(g.attributes.normal.array);
      uvs.push(g.attributes.uv ? g.attributes.uv.array : new Float32Array(n * 2));
      if (plain) {
        if (g.attributes.color) col.push(g.attributes.color.array); // already baked (e.g. a person)
        else { const c = o.material.color, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } col.push(a); }
      }
      g.dispose();
    }
    const cat = (arrs) => { const out = new Float32Array(arrs.reduce((a, b) => a + b.length, 0)); let k = 0; for (const a of arrs) { out.set(a, k); k += a.length; } return out; };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(cat(pos), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(cat(nor), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(cat(uvs), 2));
    let material = mat;
    if (plain) { geo.setAttribute('color', new THREE.BufferAttribute(cat(col), 3)); material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.05 }); if (extraMats) extraMats.push(material); }
    const merged = new THREE.Mesh(geo, material);
    merged.castShadow = parts.some((p) => p.castShadow); merged.receiveShadow = true; merged.userData.merged = true;
    root.add(merged);
    parts.forEach((o) => { o.userData.gone = true; });
  }
  victims.forEach((o) => { if (o.userData.gone && o.parent) o.parent.remove(o); });
}

const stripMats = new Map();
function stripPlane(len, w, tex, period = 0.5) {
  const g = new THREE.PlaneGeometry(len, w);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (len / period), uv.getY(i));
  if (!stripMats.has(tex)) stripMats.set(tex, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
  return new THREE.Mesh(g, stripMats.get(tex));
}

// rounded open/closed path through drawing points (corners rounded with radius r in world units)
function roundedPath(ptsPx, r = 1.2, closed = false) {
  const p = ptsPx.map(([a, b]) => V(a, b));
  const path = new THREE.CurvePath();
  const n = p.length;
  const corner = (i) => {
    const prev = p[(i - 1 + n) % n], cur = p[i], next = p[(i + 1) % n];
    const a = cur.clone().sub(prev), b = next.clone().sub(cur);
    const rr = Math.min(r, a.length() / 2, b.length() / 2);
    return { inP: cur.clone().sub(a.normalize().multiplyScalar(rr)), outP: cur.clone().add(b.normalize().multiplyScalar(rr)), cur };
  };
  if (closed) {
    const cs = p.map((_, i) => corner(i));
    for (let i = 0; i < n; i++) {
      const c0 = cs[i], c1 = cs[(i + 1) % n];
      path.add(new THREE.QuadraticBezierCurve3(c0.inP, c0.cur, c0.outP));
      path.add(new THREE.LineCurve3(c0.outP, c1.inP));
    }
  } else {
    let start = p[0];
    for (let i = 1; i < n - 1; i++) {
      const c = corner(i);
      path.add(new THREE.LineCurve3(start, c.inP));
      path.add(new THREE.QuadraticBezierCurve3(c.inP, c.cur, c.outP));
      start = c.outP;
    }
    path.add(new THREE.LineCurve3(start, p[n - 1]));
  }
  return path;
}

// ---------- labels ----------
function label(text, sub = '', scale = 1) {
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  const f1 = 'bold 44px Inter, system-ui, sans-serif', f2 = '600 28px Inter, system-ui, sans-serif';
  x.font = f1; const w1 = x.measureText(text).width;
  x.font = f2; const w2 = sub ? x.measureText(sub).width : 0;
  const W = Math.ceil(Math.max(w1, w2) + 48), H = sub ? 104 : 72;
  c.width = W; c.height = H;
  x.fillStyle = 'rgba(255,255,255,0.92)';
  const r = 18; x.beginPath(); x.moveTo(r, 0); x.arcTo(W, 0, W, H, r); x.arcTo(W, H, 0, H, r); x.arcTo(0, H, 0, 0, r); x.arcTo(0, 0, W, 0, r); x.fill();
  x.strokeStyle = 'rgba(43,69,214,0.35)'; x.lineWidth = 3; x.stroke();
  x.fillStyle = '#2b45d6'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = f1; x.fillText(text, W / 2, sub ? 38 : H / 2 + 2);
  if (sub) { x.font = f2; x.fillStyle = '#5a6478'; x.fillText(sub, W / 2, 78); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  const h = (sub ? 2.0 : 1.4) * scale;
  sp.scale.set(h * W / H, h, 1);
  sp.renderOrder = 10;
  return sp;
}

// ---------- state ----------
let three = null;

export function render(view, sub) {
  view.innerHTML = `
    <div class="page-head"><h1>Plant Floor</h1><p>The Ontario plant floor in 3D. Tap a machine to see its specs.</p></div>
    <div class="floor-wrap" id="flWrap">
      <div class="floor-tools">
        <span class="floor-hint">Drag to turn · scroll or pinch to zoom · tap a machine</span>
        <button class="btn small" type="button" id="flReset">Reset view</button>
      </div>
      <div class="floor-card hidden" id="flCard" role="dialog" aria-live="polite"></div>
      <div class="floor-loading" id="flLoad"><span class="spinner"></span> Building the floor…</div>
    </div>
    <p class="note" style="margin:12px 0 0">Laid out from the Plant Floor Layout drawing. Positions are close, not surveyed. Walking and forklift routes are for show only.</p>`;
  setTimeout(() => build($('#flWrap'), sub ? decodeURIComponent(sub) : ''), 20);
}

export function destroy() {
  if (!three) return;
  cancelAnimationFrame(three.raf);
  three.ro.disconnect();
  three.controls.dispose();
  three.cleanup.forEach((f) => f());
  three.scene.traverse((o) => {
    if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); }
    if (o.geometry && !gcacheHas(o.geometry)) o.geometry.dispose();
  });
  three.renderer.dispose();
  three.renderer.domElement.remove();
  three = null;
  mcache.clear(); stripMats.clear(); stripeTex = null; beltTex = null;
}
const gcacheHas = (g) => { for (const v of gcache.values()) if (v === g) return true; return false; };

function build(wrap, focusId) {
  if (!wrap || !wrap.isConnected) return;
  destroy();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  wrap.prepend(renderer.domElement);
  renderer.domElement.classList.add('floor-canvas');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.bg);
  scene.fog = new THREE.Fog(C.bg, 220, 420);

  // soft light: sky fill + one sun with soft shadows
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d2e3, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-38, 70, 46);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -64, right: 64, top: 58, bottom: -58, near: 10, far: 220 });
  sun.shadow.radius = 4; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  scene.add(sun);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minZoom = 0.45; controls.maxZoom = 7;
  controls.minPolarAngle = 0.15; controls.maxPolarAngle = 1.3;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;

  const anims = [];          // (t, dt) => void
  const machines = new Map(); // id -> record
  const pickables = [];

  buildPlant(scene, anims);
  buildMachines(scene, anims, machines, pickables);
  buildPeople(scene, anims, machines);
  const fleet = buildForklifts(scene, anims);
  buildTrucks(scene, anims);

  three = { renderer, scene, camera, controls, raf: 0, ro: null, cleanup: [], machines };
  three.anims = anims; three.fleet = fleet;
  if (/[?&]debug\b/.test(location.search)) window.__floor = three; // for testing only
  // name tags keep about the same size on screen at any zoom
  const tags = [];
  scene.traverse((o) => { if (o.isSprite) { o.userData.base = o.scale.clone(); tags.push(o); } });
  let tagZoom = -1;
  const sizeTags = () => {
    if (camera.zoom === tagZoom) return;
    tagZoom = camera.zoom;
    const k = 1.1 / Math.pow(camera.zoom, 0.92);
    tags.forEach((o) => o.scale.copy(o.userData.base).multiplyScalar(k));
  };

  // ---------- camera fit: isometric-style view of the whole building ----------
  let baseHalf = 40;
  const HOME = { az: THREE.MathUtils.degToRad(18), polar: THREE.MathUtils.degToRad(50) };
  function fit() {
    const w = wrap.clientWidth, h = wrap.clientHeight, aspect = w / Math.max(1, h);
    const dist = 200;
    // tall screens (phones): turn the long building to run up the screen and look down a little more
    const tall = aspect < 0.9;
    const az = tall ? Math.PI / 2 : HOME.az, polar = tall ? THREE.MathUtils.degToRad(42) : HOME.polar;
    const zTop = tall ? Z(78) : YARD.far - 3; // phones frame the building only; the yard is a zoom-out away
    controls.target.set((X(35) + X(1078)) / 2, 0, (zTop + Z(698)) / 2);
    camera.position.set(Math.sin(polar) * Math.sin(az) * dist, Math.cos(polar) * dist, Math.sin(polar) * Math.cos(az) * dist).add(controls.target);
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
    const inv = camera.matrixWorldInverse;
    let mx = 0, my = 0;
    for (const x of [X(35), X(1078)]) for (const z of [zTop, Z(698)]) for (const y of [0, 2.5]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(inv);
      mx = Math.max(mx, Math.abs(p.x)); my = Math.max(my, Math.abs(p.y - 0));
    }
    baseHalf = Math.max(my, mx / aspect) * 1.02;
    camera.zoom = 1;
    size();
    controls.update();
  }
  function size() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    renderer.setSize(w, h, false);
    const aspect = w / Math.max(1, h);
    camera.top = baseHalf; camera.bottom = -baseHalf; camera.left = -baseHalf * aspect; camera.right = baseHalf * aspect;
    camera.updateProjectionMatrix();
  }
  fit();
  let lastW = wrap.clientWidth;
  const ro = new ResizeObserver(() => { if (Math.abs(wrap.clientWidth - lastW) > 40) { lastW = wrap.clientWidth; fit(); } else size(); });
  // (a big width change, like turning a phone, re-frames the whole plant)
  ro.observe(wrap); three.ro = ro;
  $('#flReset').addEventListener('click', () => { fit(); });

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let hovered = null, selected = null, down = null;
  const el = renderer.domElement;
  function pick(e) {
    const r = el.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    return hit ? machines.get(hit.object.userData.mid) : null;
  }
  const onMove = (e) => {
    if (e.pointerType === 'touch') return;
    const m = pick(e);
    if (m !== hovered) { hovered = m; el.style.cursor = m ? 'pointer' : ''; }
  };
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
  const onUp = (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6) return; // that was a drag
    const m = pick(e);
    select(m && m !== selected ? m : null);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointerleave', () => { hovered = null; el.style.cursor = ''; });

  let saved = {};
  api('/api/specs').then((d) => { saved = d.machines || {}; if (selected) fillCard(selected); }).catch(() => {});

  const card = $('#flCard');
  function select(m) {
    selected = m;
    if (!m) { card.classList.add('hidden'); card.innerHTML = ''; return; }
    fillCard(m);
    card.classList.remove('hidden');
    placeCard();
  }
  function fillCard(m) {
    const spec = LIST.find((s) => s.id === m.id);
    const rows = spec ? rowsOf(spec, saved) : [];
    const s = saved[m.id] || {};
    card.innerHTML = `
      <button class="floor-card-x" type="button" aria-label="Close">×</button>
      <div class="floor-card-kicker">#${esc(m.id)} · ${esc(spec ? spec.type : m.type)}</div>
      <h3>${esc(spec ? spec.name : m.name)}</h3>
      ${rows.length ? `<dl class="floor-kv">${rows.map(([k, v, added]) => `<dt${added ? ' data-no-i18n' : ''}>${esc(k)}</dt><dd${added ? ' data-no-i18n' : ''}>${esc(v)}</dd>`).join('')}</dl>`
        : '<p class="floor-card-empty">No specs on file yet. Tap Edit to add them.</p>'}
      ${spec && spec.notes ? `<p class="floor-card-notes">${esc(spec.notes)}</p>` : ''}
      ${s.notes ? `<p class="floor-card-notes" data-no-i18n>${esc(s.notes)}</p>` : ''}
      ${s.updatedBy ? `<p class="floor-card-by">Added on site by <span data-no-i18n>${esc(s.updatedBy)}</span> · ${esc(new Date(s.updatedAt).toLocaleDateString('en-US'))}</p>` : ''}
      <div class="floor-card-btns"><button class="btn small" type="button" data-fc="edit">Edit</button><button class="btn small" type="button" data-fc="print">Print</button></div>`;
    card.querySelector('.floor-card-x').onclick = () => select(null);
    card.querySelector('[data-fc=edit]').onclick = () => editCard(m);
    card.querySelector('[data-fc=print]').onclick = () => spec && printSpecs([spec], saved);
  }
  // add or change the extra spec lines and notes (the spec sheet lines stay as they are)
  const NAME_KEY = 'gwprod_specs_name';
  const rowHtml = (r) => `<div class="fc-row"><input type="text" data-r="label" placeholder="Spec (e.g. Max blank length)" value="${esc(r.label)}"><input type="text" data-r="value" placeholder="Value" value="${esc(r.value)}"><button class="btn small" type="button" data-del aria-label="Remove line">✕</button></div>`;
  function editCard(m) {
    const spec = LIST.find((x) => x.id === m.id);
    const s = saved[m.id] || {};
    let name = ''; try { name = localStorage.getItem(NAME_KEY) || ''; } catch {}
    const extra = s.extra && s.extra.length ? s.extra : [{ label: '', value: '' }];
    card.innerHTML = `
      <button class="floor-card-x" type="button" aria-label="Close">×</button>
      <div class="floor-card-kicker">#${esc(m.id)} · ${esc(spec ? spec.type : m.type)}</div>
      <h3>${esc(spec ? spec.name : m.name)}</h3>
      ${spec && spec.base.length ? '<p class="floor-card-notes" style="margin:0 0 8px">The spec sheet lines (sizes, colors, rule, speed) stay as they are. Add other specs below, like glue type, max box size or bundle count.</p>' : ''}
      <div class="fc-rows">${extra.map(rowHtml).join('')}</div>
      <button class="btn small" type="button" data-fc="add" style="margin:4px 0 10px">+ Add a line</button>
      <label class="fc-label">Notes<textarea data-fc="notes" rows="3">${esc(s.notes || '')}</textarea></label>
      <label class="fc-label">Your name<input type="text" data-fc="name" autocomplete="name" value="${esc(name)}"></label>
      <div class="floor-card-btns"><button class="btn small primary" type="button" data-fc="save">Save</button><button class="btn small" type="button" data-fc="cancel">Cancel</button></div>
      <div data-fc="msg"></div>`;
    const rows = card.querySelector('.fc-rows');
    const wireDel = () => $$('[data-del]', rows).forEach((b) => (b.onclick = () => b.closest('.fc-row').remove()));
    wireDel();
    card.querySelector('.floor-card-x').onclick = () => select(null);
    card.querySelector('[data-fc=add]').onclick = () => { rows.insertAdjacentHTML('beforeend', rowHtml({ label: '', value: '' })); wireDel(); rows.lastElementChild.querySelector('input').focus(); };
    card.querySelector('[data-fc=cancel]').onclick = () => fillCard(m);
    card.querySelector('[data-fc=save]').onclick = async (e) => {
      const msg = card.querySelector('[data-fc=msg]'), btn = e.currentTarget;
      const updatedBy = card.querySelector('[data-fc=name]').value.trim();
      if (!updatedBy) { msg.innerHTML = '<div class="alert err" style="margin-top:8px">Enter your name.</div>'; return; }
      try { localStorage.setItem(NAME_KEY, updatedBy); } catch {}
      const lines = $$('.fc-row', rows).map((r) => ({ label: r.querySelector('[data-r=label]').value.trim(), value: r.querySelector('[data-r=value]').value.trim() })).filter((r) => r.label || r.value);
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try {
        saved[m.id] = await api('/api/specs?id=' + encodeURIComponent(m.id), { method: 'PUT', body: JSON.stringify({ extra: lines, notes: card.querySelector('[data-fc=notes]').value, updatedBy }) });
        if (selected === m) fillCard(m);
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Save';
        msg.innerHTML = `<div class="alert err" style="margin-top:8px">Could not save: ${esc(err.message)}</div>`;
      }
    };
  }
  const tmp = new THREE.Vector3();
  function placeCard() {
    if (!selected || card.classList.contains('hidden')) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (W < 640) { card.classList.add('sheet'); card.style.left = ''; card.style.top = ''; return; }
    card.classList.remove('sheet');
    tmp.copy(selected.anchor).project(camera);
    const sx = (tmp.x * 0.5 + 0.5) * W, sy = (-tmp.y * 0.5 + 0.5) * H;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let left = sx + 28;
    if (left + cw > W - 10) left = sx - 28 - cw;
    left = Math.max(10, Math.min(W - cw - 10, left));
    const top = Math.max(54, Math.min(H - ch - 10, sy - ch / 2));
    card.style.left = left + 'px'; card.style.top = top + 'px';
  }

  if (focusId && machines.get(focusId)) select(machines.get(focusId));

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let t = 0;
  const glowCol = new THREE.Color(0x3a63ff), hoverCol = new THREE.Color(0x24357a), none = new THREE.Color(0);
  function frame() {
    three.raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    t += dt;
    for (const f of anims) f(t, dt);
    stripes().offset.x -= dt * 1.6;
    belt().offset.x -= dt * 2.2;
    // hover tint + pulsing glow on the selected machine
    for (const m of machines.values()) {
      const target = m === selected ? glowCol : m === hovered ? hoverCol : none;
      const k = m === selected ? 0.55 + 0.3 * Math.sin(t * 4) : m === hovered ? 0.35 : 0;
      for (const mt of m.mats) { mt.emissive.copy(target); mt.emissiveIntensity = k; }
      m.halo.visible = m === selected || m === hovered;
      m.halo.material.opacity = m === selected ? 0.55 + 0.25 * Math.sin(t * 4) : 0.28;
    }
    controls.update();
    sizeTags();
    renderer.render(scene, camera);
    placeCard();
  }
  $('#flLoad')?.remove();
  frame();
}

// =====================================================================
// Building, rooms, racks, columns, doors, exits, extinguishers
// =====================================================================
function buildPlant(scene, anims) {
  const g = new THREE.Group(); scene.add(g);
  // ground and floor slab
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0xdfe5ee, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.31; ground.receiveShadow = true; g.add(ground);
  const W = X(1078) - X(35), D = Z(698) - Z(78);
  const slab = mesh(rbox(W + 1, 0.3, D + 1, 0.25), smat(C.slab), (X(35) + X(1078)) / 2, -0.15, (Z(78) + Z(698)) / 2, false);
  g.add(slab);
  // faint grid like drafting paper
  const gc = document.createElement('canvas'); gc.width = gc.height = 64;
  const gx = gc.getContext('2d'); gx.fillStyle = '#f8f9fb'; gx.fillRect(0, 0, 64, 64); gx.fillStyle = '#e6e9f0'; gx.fillRect(0, 0, 64, 2); gx.fillRect(0, 0, 2, 64);
  const gt = new THREE.CanvasTexture(gc); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(W / 4, D / 4); gt.colorSpace = THREE.SRGBColorSpace;
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: gt, roughness: 0.95 }));
  grid.rotation.x = -Math.PI / 2; grid.position.set((X(35) + X(1078)) / 2, 0.005, (Z(78) + Z(698)) / 2); grid.receiveShadow = true; g.add(grid);

  // outer walls (low, so the floor stays in view) with a dark cap like the drawing's linework
  const wall = (x1, y1, x2, y2, h = 2.2, t = 0.5, color = C.wall) => {
    const a = V(x1, y1), b = V(x2, y2), len = a.distanceTo(b);
    const m = mesh(rbox(len + t, h, t, 0.12), smat(color), (a.x + b.x) / 2, h / 2, (a.z + b.z) / 2);
    m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    const cap = mesh(rbox(len + t, 0.12, t + 0.06, 0.04), smat(C.line), 0, h / 2 + 0.03, 0, false);
    m.add(cap);
    g.add(m);
  };
  wall(35, 100, 145, 100); wall(145, 100, 145, 78);
  { let x = 145; for (const k of [...OPEN_DOORS].sort((a, b) => b - a)) { const dx = 186 + ((12 - k) * (620 - 186)) / 11; wall(x, 78, dx - 16, 78); x = dx + 16; } wall(x, 78, 1078, 78); }
  wall(1078, 78, 1078, 698); wall(1078, 698, 35, 698); wall(35, 698, 35, 100);
  // inside rooms: offices, design, maintenance, lunch, hallway
  const room = (x1, y1, x2, y2, h = 2.4, open = []) => {
    const sides = [[x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]];
    sides.forEach((s, i) => { if (!open.includes(i)) wall(...s, h, 0.3, 0xf3f5f9); });
  };
  room(745, 92, 845, 150, 2.4, [0]);
  // offices block (drawing outline): L-shaped, restrooms off the hall, lunch room between offices and design
  const iw = (pts, h = 2.4) => { for (let i = 0; i < pts.length - 1; i++) wall(...pts[i], ...pts[i + 1], h, 0.3, 0xf3f5f9); };
  iw([[845, 125], [882, 125], [882, 264], [928, 264], [928, 227], [912, 227], [912, 212], [990, 212], [990, 187], [1004, 187], [1004, 227], [967, 227], [967, 270], [980, 270]]);
  iw([[1004, 201], [1078, 201]]);
  iw([[905, 212], [905, 264]]); // between the two restrooms
  // front room with the curved wall (top of the offices)
  iw([[940, 78], [940, 127], [967, 127], [967, 110]]);
  { const a = V(967, 110), c = V(1022, 90), b = V(1078, 107), arc = new THREE.QuadraticBezierCurve3(a, c, b); const ps = arc.getPoints(8);
    for (let i = 0; i < ps.length - 1; i++) { const p0 = ps[i], p1 = ps[i + 1], len = p0.distanceTo(p1); const m = mesh(rbox(len + 0.3, 2.4, 0.3, 0.1), smat(0xdfe8fb, { transparent: true, opacity: 0.85 }), (p0.x + p1.x) / 2, 1.2, (p0.z + p1.z) / 2); m.rotation.y = -Math.atan2(p1.z - p0.z, p1.x - p0.x); g.add(m); } }
  room(980, 270, 1078, 450, 2.4, [1]);
  room(1032, 452, 1078, 515, 1.6, [1]);
  // room floors tinted, and their names
  const tint = (x1, y1, x2, y2, col) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(X(x2) - X(x1), Z(y2) - Z(y1)), smat(col)); p.rotation.x = -Math.PI / 2; p.position.set((X(x1) + X(x2)) / 2, 0.012, (Z(y1) + Z(y2)) / 2); p.receiveShadow = true; g.add(p); };
  tint(745, 92, 845, 150, 0xe9edf6); tint(882, 80, 1078, 201, 0xeef1fb); tint(882, 212, 928, 264, 0xe6eef7); tint(967, 201, 1078, 270, 0xf6efe2); tint(980, 270, 1078, 450, 0xeef1fb); tint(700, 85, 745, 150, 0xf4efe6); tint(1032, 452, 1078, 515, 0xf3ece2);
  const tag = (txt, px, py, s = 0.75) => { const l = label(txt, '', s); l.position.copy(V(px, py, 3.2)); g.add(l); };

  // maintenance: workbench, red toolbox, parts shelf
  g.add(mesh(rbox(5, 1.1, 1.4), smat(C.wood), X(780), 0.55, Z(140)));
  g.add(mesh(rbox(1.4, 1.6, 0.9), smat(C.red), X(830), 0.8, Z(140)));
  g.add(mesh(rbox(5.5, 2, 0.8), smat(C.body2), X(800), 1, Z(97)));
  // lunch tables
  for (const py of [100, 118, 136]) { g.add(mesh(rbox(2.4, 0.9, 1.1), smat(0xffffff), X(726), 0.45, Z(py))); g.add(mesh(rbox(2.4, 0.5, 0.35), smat(C.blueSoft), X(726), 0.25, Z(py) - 0.9)); }
  // offices: desks with screens; design room drawing tables
  const desk = (px, py) => { g.add(mesh(rbox(2.2, 0.9, 1.1), smat(0xffffff), X(px), 0.45, Z(py))); const s = mesh(rbox(0.9, 0.6, 0.08), smat(C.navy, { emissive: 0x2b45d6, emissiveIntensity: 0.35 }), X(px), 1.25, Z(py) - 0.3); g.add(s); };
  [[900, 140], [935, 140], [900, 165], [935, 165], [990, 140], [1030, 140], [1060, 140], [1000, 300], [1045, 300], [1000, 360], [1045, 360], [1000, 420], [1045, 420]].forEach(([a, b]) => desk(a, b));
  // front room: conference table
  g.add(mesh(rbox(6, 0.85, 1.8, 0.4), smat(C.wood), X(1022), 0.42, Z(100)));
  // restrooms: stalls
  for (const [a, b] of [[893, 250], [917, 250]]) { g.add(mesh(rbox(1.2, 1.9, 1.2, 0.08), smat(0xd9e1ef), X(a), 0.95, Z(b))); g.add(mesh(rbox(0.6, 0.45, 0.4, 0.15), smat(0xffffff), X(a), 0.22, Z(b) - 1)); }
  // lunch room: tables with benches, fridge, first-aid cross on the wall
  for (const [a, b] of [[1020, 240], [1055, 240], [1020, 260], [1055, 260]]) { g.add(mesh(rbox(2.2, 0.85, 1.0, 0.12), smat(0xffffff), X(a), 0.42, Z(b))); g.add(mesh(rbox(2.2, 0.45, 0.3, 0.1), smat(C.blueSoft), X(a), 0.22, Z(b) - 0.8)); g.add(mesh(rbox(2.2, 0.45, 0.3, 0.1), smat(C.blueSoft), X(a), 0.22, Z(b) + 0.8)); }
  g.add(mesh(rbox(1.0, 2.1, 0.9, 0.12), smat(0xe9edf3), X(1072), 1.05, Z(215)));
  { const fa = new THREE.Group(); fa.position.set(X(1035), 1.7, Z(201) + 0.2); fa.add(mesh(rbox(0.75, 0.75, 0.06, 0.04), smat(0xffffff), 0, 0, 0, false)); fa.add(mesh(rbox(0.5, 0.15, 0.08, 0.02), smat(C.red), 0, 0, 0.01, false)); fa.add(mesh(rbox(0.15, 0.5, 0.08, 0.02), smat(C.red), 0, 0, 0.01, false)); g.add(fa); }
  // die cutting materials: rolls of rule and rubber
  for (let i = 0; i < 4; i++) { const r = mesh(cylG(0.55, 1.8, 12), smat(i % 2 ? C.frame : C.red), X(1045 + (i % 2) * 18), 0.55, Z(462 + Math.floor(i / 2) * 28)); r.rotation.z = Math.PI / 2; g.add(r); }

  // silos / tanks (top-left circles)
  [[55, 92], [86, 92]].forEach(([a, b]) => { g.add(mesh(cylG(1.25, 3.4, 20), smat(C.body2), X(a), 1.7, Z(b))); g.add(mesh(cylG(1.3, 0.2, 20), smat(C.line), X(a), 3.45, Z(b))); });

  // columns (black circles on the drawing), with a yellow safety band
  [[145, 188], [310, 180], [484, 180], [661, 180], [791, 178], [141, 320], [310, 323], [484, 330], [661, 330], [791, 330],
    [140, 464], [310, 465], [478, 464], [661, 453], [791, 455], [140, 570], [310, 570], [484, 570], [676, 575], [791, 570]]
    .forEach(([a, b]) => { g.add(mesh(cylG(0.42, 5, 10), smat(0xd5dae3), X(a), 2.5, Z(b))); g.add(mesh(cylG(0.46, 0.9, 10), smat(C.yellow), X(a), 0.45, Z(b))); });

  // cutting die rack: long steel rack with dies standing in it
  const rackG = new THREE.Group(); rackG.position.set(X(402), 0, Z(101)); g.add(rackG);
  const RL = X(515) - X(288);
  for (const y of [0.1, 1.4, 2.7]) rackG.add(mesh(rbox(RL, 0.12, 1.7, 0.04), smat(C.blue), 0, y, 0));
  for (let i = 0; i <= 8; i++) rackG.add(mesh(rbox(0.16, 3.2, 1.8, 0.05), smat(C.frame), -RL / 2 + (i * RL) / 8, 1.6, 0));
  for (let s = 0; s < 2; s++) for (let i = 0; i < 46; i++) {
    const h = 0.8 + ((i * 37) % 5) * 0.08;
    rackG.add(mesh(rbox(0.12, h, 1.4, 0.03), smat([C.wood, C.kraft, C.kraft2][i % 3]), -RL / 2 + 0.4 + i * (RL - 0.8) / 46, 0.16 + s * 1.3 + h / 2, 0, false));
  }
  // printing plate racks: slatted, plates hanging
  const plateRack = (x1, y1, x2, y2) => {
    const r = new THREE.Group(); r.position.set((X(x1) + X(x2)) / 2, 0, (Z(y1) + Z(y2)) / 2); g.add(r);
    const L = X(x2) - X(x1), Dd = Z(y2) - Z(y1);
    r.add(mesh(rbox(L, 0.25, Dd, 0.06), smat(C.frame), 0, 0.12, 0));
    r.add(mesh(rbox(L, 0.15, 0.25, 0.05), smat(C.blue), 0, 2.6, 0));
    const n = Math.round(L / 0.45);
    for (let i = 0; i < n; i++) r.add(mesh(rbox(0.06, 2.2, Dd * 0.82, 0.02), smat(i % 4 === 0 ? C.blueSoft : C.plate), -L / 2 + 0.25 + i * (L - 0.5) / (n - 1), 1.35, 0, false));
  };
  plateRack(452, 213, 500, 245); plateRack(508, 213, 556, 245); plateRack(538, 574, 655, 588);

  // dock doors 12 → 1 along the north wall, each with a blinking light
  const lights = [];
  for (let i = 0; i < 12; i++) {
    const px = 186 + (i * (620 - 186)) / 11;
    const d = mesh(rbox(3, 2.6, 0.2, 0.06), smat(0xcfd6e2), X(px), 1.3, Z(78) + 0.35); g.add(d);
    if (OPEN_DOORS.includes(12 - i)) { d.scale.y = 0.18; d.position.y = 2.45; } // rolled up: a trailer is being loaded
    for (let k = 0; k < 4; k++) d.add(mesh(rbox(2.9, 0.05, 0.22, 0.01), smat(0xb3bccb), 0, -0.9 + k * 0.6, 0, false));
    const lm = new THREE.MeshStandardMaterial({ color: C.amber, emissive: C.amber, emissiveIntensity: 1 });
    const l = mesh(cylG(0.18, 0.18, 10), lm, X(px), 2.85, Z(78) + 0.4, false); g.add(l); lights.push({ lm, ph: i * 0.7 });
  }
  // ramp by door 1
  const ramp = mesh(rbox(6, 0.3, 1.6, 0.06), smat(0xd5dbe5), X(675), 0.15, Z(84)); ramp.rotation.z = 0.06; g.add(ramp);
  anims.push((t) => lights.forEach((l) => (l.lm.emissiveIntensity = 0.3 + 0.9 * Math.max(0, Math.sin(t * 2.4 + l.ph)))));

  // exit arrows (yellow on the drawing), pulsing
  const arrowShape = new THREE.Shape(); arrowShape.moveTo(0, 1.1); arrowShape.lineTo(0.75, 0.25); arrowShape.lineTo(0.28, 0.25); arrowShape.lineTo(0.28, -1); arrowShape.lineTo(-0.28, -1); arrowShape.lineTo(-0.28, 0.25); arrowShape.lineTo(-0.75, 0.25); arrowShape.lineTo(0, 1.1);
  const arrowGeo = new THREE.ShapeGeometry(arrowShape); arrowGeo.rotateX(-Math.PI / 2);
  const arrowMat = new THREE.MeshStandardMaterial({ color: C.amber, emissive: C.amber, emissiveIntensity: 0.4, transparent: true });
  const arrows = [];
  [[160, 115, 'n'], [655, 115, 'n'], [682, 115, 'n'], [62, 196, 'w'], [62, 238, 'w'], [62, 638, 'w'], [62, 664, 'w'], [1048, 563, 'e']].forEach(([a, b, dir]) => {
    const m = new THREE.Mesh(arrowGeo, arrowMat); m.position.set(X(a), 0.03, Z(b));
    m.rotation.y = { n: 0, w: Math.PI / 2, e: -Math.PI / 2, s: Math.PI }[dir];
    m.scale.setScalar(1.3); g.add(m); arrows.push(m);
  });
  anims.push((t) => { arrowMat.emissiveIntensity = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3)); arrows.forEach((a, i) => a.position.y = 0.03 + 0.0 * i); });

  // fire extinguishers (red on the drawing)
  [[180, 92], [295, 113], [510, 113], [322, 180], [667, 180], [768, 90], [715, 90], [48, 172], [155, 320], [495, 330], [808, 330], [320, 463], [680, 453], [320, 568], [495, 568], [805, 568], [48, 610], [665, 682], [960, 262], [990, 370], [1070, 460], [1012, 222], [1068, 540]]
    .forEach(([a, b]) => {
      const e = new THREE.Group(); e.position.set(X(a), 0, Z(b)); g.add(e);
      e.add(mesh(cylG(0.2, 0.75, 10), smat(C.red), 0, 0.38, 0));
      e.add(mesh(cylG(0.08, 0.16, 8), smat(C.line), 0, 0.82, 0, false));
      e.add(mesh(rbox(0.5, 0.7, 0.05, 0.02), smat(C.red), 0, 1.7, 0, false));
    });
  bake(g);
}

// =====================================================================
// Machines
// =====================================================================
function buildMachines(scene, anims, machines, pickables) {
  // haloTex: soft blue glow under a selected machine
  const hc = document.createElement('canvas'); hc.width = hc.height = 128;
  const hx = hc.getContext('2d'); const grd = hx.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, 'rgba(70,110,255,0.9)'); grd.addColorStop(0.6, 'rgba(70,110,255,0.35)'); grd.addColorStop(1, 'rgba(70,110,255,0)');
  hx.fillStyle = grd; hx.fillRect(0, 0, 128, 128);
  const haloTex = new THREE.CanvasTexture(hc);

  function machine(id, name, type, fn, labelAt) {
    const group = new THREE.Group(); scene.add(group);
    const mats = [];
    const mm = new Map();
    const ctx = {
      g: group, anims,
      m(color, extra) { const k = color + JSON.stringify(extra || {}); if (!mm.has(k)) { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.06, ...(extra || {}) }); mm.set(k, m); mats.push(m); } return mm.get(k); },
      box(w, h, d, color, x, y, z, r = 0.14, parent = group) { const o = mesh(rbox(w, h, d, r), this.m(color), x, y + h / 2, z); parent.add(o); return o; },
      cyl(rad, h, color, x, y, z, seg = 14, parent = group) { const o = mesh(cylG(rad, h, seg), this.m(color), x, y, z); parent.add(o); return o; },
      light(x, y, z, parent = group) { // status tower light, pulsing
        const lm = new THREE.MeshStandardMaterial({ color: C.green, emissive: C.green, emissiveIntensity: 1 });
        const pole = mesh(cylG(0.06, 1.1, 8), this.m(C.frame), x, y + 0.55, z, false); parent.add(pole);
        const a = mesh(cylG(0.16, 0.28, 10), lm, x, y + 1.2, z, false); parent.add(a);
        const b = mesh(cylG(0.16, 0.28, 10), new THREE.MeshStandardMaterial({ color: C.amber, emissive: C.amber, emissiveIntensity: 0.15 }), x, y + 1.5, z, false); parent.add(b);
        const ph = Math.random() * 6;
        anims.push((t) => { lm.emissiveIntensity = 0.5 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2 + ph)); });
      },
    };
    fn(ctx);
    bake(group, mats);
    // pick targets, bounds, halo
    const bb = new THREE.Box3().setFromObject(group);
    const center = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    group.traverse((o) => { if (o.isMesh) { o.userData.mid = id; pickables.push(o); } });
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(sz.x + 4, sz.z + 4), new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.rotation.x = -Math.PI / 2; halo.position.set(center.x, 0.03, center.z); halo.visible = false; scene.add(halo);
    machines.set(id, { id, name, type, group, mats, halo, anchor: new THREE.Vector3(center.x, bb.max.y, center.z) });
  }

  // ---- line machine: units laid along the x axis from the feed end ----
  // flow +1 = feed on the west end, -1 = feed on the east end
  function lineMachine(ctx, { x0, x1, yc, wpx, flow, units }) {
    const L = (x1 - x0) * SC, W = wpx * SC, zc = Z(yc);
    const total = units.reduce((a, u) => a + u.len, 0);
    let cur = flow > 0 ? X(x0) : X(x1);
    let first = true;
    for (const u of units) {
      const len = (u.len / total) * L;
      unit(ctx, u.t, cur + (flow * len) / 2, zc, len, W, flow, first);
      cur += flow * len; first = false;
    }
  }
  function unit(ctx, t, cx, cz, len, W, flow, first) {
    const g = new THREE.Group(); g.position.set(cx, 0, cz); ctx.g.add(g);
    const sideZ = W / 2 + 0.06;
    if (t === 'feeder') {
      ctx.box(len * 0.94, 3.1, W, C.body, 0, 0, 0, 0.22, g);
      ctx.box(len * 0.96, 0.32, W + 0.08, C.blue, 0, 2.55, 0, 0.1, g);
      ctx.box(0.7, 1.1, 0.5, C.body2, -flow * len * 0.2, 3.1, sideZ - 0.4, 0.1, g); // control panel
      ctx.cyl(0.12, 0.12, C.red, -flow * len * 0.2, 4.25, sideZ - 0.4, 10, g);
      ctx.light(flow * len * 0.3, 3.1, -W / 2 + 0.4, g);
      if (first) { // sheet stack waiting to feed, going down then refilled
        const st = D(ctx.box(Math.min(2.2, len * 0.8), 1, W * 0.8, C.kraft, -flow * (len / 2 + 1.3), 0, 0, 0.05, g));
        const ph = Math.random() * 10;
        ctx.anims.push((tt) => { const k = 1 - ((tt * 0.07 + ph) % 1); st.scale.y = 0.25 + k * 1.15; st.position.y = (0.25 + k * 1.15) / 2; });
      }
    } else if (t === 'print' || t === 'slot' || t === 'die') {
      const h = t === 'print' ? 2.8 : 2.4;
      ctx.box(len * 0.9, h, W, t === 'die' ? C.body2 : C.body, 0, 0, 0, 0.2, g);
      ctx.box(len * 0.3, h * 0.7, 0.12, t === 'print' ? C.blue : C.blueSoft, 0, 0.3, sideZ, 0.04, g);
      ctx.box(len * 0.3, h * 0.7, 0.12, t === 'print' ? C.blue : C.blueSoft, 0, 0.3, -sideZ, 0.04, g);
      // cylinder across the machine, spinning (with a plate band so the turn shows)
      const r = t === 'die' ? 0.75 : 0.5;
      const holder = new THREE.Group(); holder.position.set(0, h + 0.25, 0); holder.rotation.x = Math.PI / 2; g.add(holder);
      const cy = D(ctx.cyl(r, W * 1.04, t === 'die' ? C.kraft2 : C.frame, 0, 0, 0, 12, holder));
      const band = ctx.box(0.22, W * 1.06, 0.18, t === 'print' ? C.red : C.blue, 0, -W * 0.53, r - 0.05, 0.03, cy);
      band.castShadow = false;
      const sp = (t === 'die' ? 2.2 : 3.2) * flow;
      ctx.anims.push((tt, dt) => { cy.rotation.y -= dt * sp; });
      if (t === 'print') { const ink = ctx.cyl(0.32, 0.7, C.blue, len * 0.25, 0.35, W / 2 + 0.6, 12, g); ctx.cyl(0.33, 0.06, C.line, len * 0.25, 0.72, W / 2 + 0.6, 12, g); ink.castShadow = true; }
    } else if (t === 'folder') {
      ctx.box(len * 0.98, 1.3, W * 0.86, C.body2, 0, 0, 0, 0.14, g);
      for (const s of [-1, 1]) { const b = stripPlane(len * 0.96, W * 0.22, belt(), 0.4); b.position.set(0, 1.32, s * W * 0.22); if (flow < 0) b.rotation.y = Math.PI; g.add(b); }
      // folded boxes riding the belts
      const n = Math.max(2, Math.round(len / 3));
      const items = [];
      for (let i = 0; i < n; i++) items.push(D(ctx.box(1.1, 0.14, W * 0.62, C.kraft, 0, 1.35, 0, 0.03, g)));
      const ph = Math.random();
      ctx.anims.push((tt) => items.forEach((it, i) => { const u = ((tt * 0.25 + ph + i / n) % 1); it.position.x = flow * (-len / 2 + 0.6 + u * (len - 1.2)); }));
    } else if (t === 'stack') {
      ctx.box(len * 0.9, 2.7, W, C.body, 0, 0, 0, 0.22, g);
      ctx.box(len * 0.92, 0.3, W + 0.06, C.blue, 0, 2.1, 0, 0.1, g);
      const b = D(ctx.box(1.5, 1.0, W * 0.6, C.kraft2, flow * (len / 2 + 0.4), 0.1, 0, 0.05, g));
      const ph = Math.random() * 3;
      ctx.anims.push((tt) => { const u = (tt * 0.35 + ph) % 1; b.position.x = flow * (len / 2 - 0.4 + u * 1.6); b.scale.y = 0.4 + u * 0.8; b.position.y = 0.1 + (0.4 + u * 0.8) / 2; });
    } else if (t === 'platen') {
      ctx.box(len * 0.9, 2.2, W, C.body, 0, 0, 0, 0.22, g);
      ctx.box(len * 0.94, 0.3, W + 0.08, C.blue, 0, 1.9, 0, 0.1, g);
      const top = D(ctx.box(len * 0.82, 0.9, W * 0.92, C.body2, 0, 2.6, 0, 0.18, g));
      ctx.box(len * 0.5, 0.25, W * 0.5, C.frame, 0, 0.45, 0, 0.06, top);
      const ph = Math.random() * 3;
      ctx.anims.push((tt) => { const k = Math.abs(Math.sin(tt * 2.6 + ph)); top.position.y = 2.6 + 0.45 + k * 0.6; });
      ctx.light(len * 0.35, 2.2, -W / 2 + 0.35, g);
    } else if (t === 'table') {
      ctx.box(len * 0.96, 1.05, W * 0.9, C.body2, 0, 0, 0, 0.1, g);
      const st = D(ctx.box(Math.min(2.2, len * 0.7), 0.6, W * 0.7, C.kraft, 0, 1.05, 0, 0.04, g));
      const ph = Math.random() * 5;
      ctx.anims.push((tt) => { const k = (tt * 0.12 + ph) % 1; const h = 0.15 + (first ? 1 - k : k) * 0.9; st.scale.y = h / 0.6; st.position.y = 1.05 + h / 2; });
    }
  }

  // ---- roller conveyor along drawing points, with bundles riding it ----
  function conveyor(ctx, pts, wpx, { items = true, h = 0.85, speed = 2.2, r = 1.6, color = C.frame } = {}) {
    const path = roundedPath(pts, r);
    const L = path.getLength(), W = wpx * SC;
    const n = Math.max(1, Math.ceil(L / (pts.length > 2 ? 0.8 : 1.4)));
    for (let i = 0; i < n; i++) {
      const a = path.getPointAt(i / n), b = path.getPointAt((i + 1) / n);
      const len = a.distanceTo(b) + 0.06, ang = -Math.atan2(b.z - a.z, b.x - a.x);
      const piece = mesh(rbox(len, h, W, 0.06), ctx.m(color), (a.x + b.x) / 2, h / 2, (a.z + b.z) / 2);
      piece.rotation.y = ang; ctx.g.add(piece);
      const top = stripPlane(len, W * 0.86, stripes(), 0.42); top.position.set(0, h / 2 + 0.01, 0); top.receiveShadow = true; piece.add(top);
    }
    if (!items) return;
    const k = Math.max(1, Math.floor(L / 4.5));
    const list = [];
    for (let i = 0; i < k; i++) list.push(D(ctx.box(Math.min(1.5, W * 0.9), 0.7, W * 0.75, i % 2 ? C.kraft : C.kraft2, 0, h, 0, 0.06)));
    const ph = Math.random();
    const tan = new THREE.Vector3();
    ctx.anims.push((tt) => list.forEach((it, i) => {
      const u = ((tt * speed) / L + ph + i / k) % 1;
      const p = path.getPointAt(u); path.getTangentAt(u, tan);
      it.position.set(p.x, h + 0.35, p.z); it.rotation.y = -Math.atan2(tan.z, tan.x);
    }));
  }

  // ---------------- the machines (positions from the drawing) ----------------
  machine('147', '42" EMBA FFG', 'FFG', (c) => {
    lineMachine(c, { x0: 322, x1: 585, yc: 291, wpx: 29, flow: -1, units: [{ t: 'feeder', len: 3 }, { t: 'print', len: 2 }, { t: 'print', len: 2 }, { t: 'slot', len: 2 }, { t: 'folder', len: 9 }, { t: 'stack', len: 2.5 }] });
    conveyor(c, [[642, 292], [588, 292]], 20);
    conveyor(c, [[320, 292], [296, 293], [291, 318], [312, 333], [398, 333]], 14);
    c.box(3.4, 2.3, 2.3, C.body2, X(572), 0, Z(262), 0.18); // pre-feeder / ink station
    for (const [a, b] of [[540, 258], [552, 262], [546, 270]]) c.cyl(0.42, 1.1, C.blue, X(a), 0.55, Z(b), 12);
  }, [450, 291]);
  machine('144', '66" McKinley FFG', 'FFG', (c) => {
    lineMachine(c, { x0: 377, x1: 570, yc: 430, wpx: 36, flow: -1, units: [{ t: 'feeder', len: 3 }, { t: 'print', len: 2 }, { t: 'print', len: 2 }, { t: 'slot', len: 2 }, { t: 'folder', len: 7 }, { t: 'stack', len: 2.5 }] });
    conveyor(c, [[642, 433], [572, 433]], 28);
    conveyor(c, [[375, 430], [345, 428], [331, 448], [342, 468], [368, 472]], 15);
  }, [470, 430]);
  machine('138', 'Small Marumatsu FBDC', 'FLATBED', (c) => {
    lineMachine(c, { x0: 505, x1: 632, yc: 361, wpx: 22, flow: -1, units: [{ t: 'table', len: 2 }, { t: 'platen', len: 3 }, { t: 'table', len: 2 }] });
    c.box(1.4, 1.5, 1.0, C.body2, X(560), 0, Z(399), 0.12);
    c.cyl(0.12, 0.12, C.red, X(560), 1.56, Z(399), 10);
  });
  machine('126', '86" Jumbo Press', 'PRESS', (c) => {
    lineMachine(c, { x0: 485, x1: 635, yc: 520, wpx: 56, flow: -1, units: [{ t: 'feeder', len: 3 }, { t: 'print', len: 3 }, { t: 'slot', len: 3 }, { t: 'stack', len: 2 }, { t: 'table', len: 1.2 }] });
    conveyor(c, [[678, 520], [637, 520]], 40);
  }, [560, 520]);
  machine('132', '66" Shanghai RDC Slotter', 'PRESS', (c) => {
    lineMachine(c, { x0: 485, x1: 657, yc: 650, wpx: 50, flow: -1, units: [{ t: 'feeder', len: 3 }, { t: 'print', len: 2.5 }, { t: 'print', len: 2.5 }, { t: 'die', len: 3 }, { t: 'stack', len: 2 }, { t: 'table', len: 1.2 }] });
    conveyor(c, [[714, 648], [659, 648]], 34);
    conveyor(c, [[642, 686], [572, 686]], 9, { h: 0.5, speed: 1.4 });
  }, [575, 650]);
  machine('149', 'Shanghai Juer Mini FFG', 'FFG', (c) => {
    lineMachine(c, { x0: 160, x1: 360, yc: 621, wpx: 40, flow: -1, units: [{ t: 'feeder', len: 3 }, { t: 'print', len: 2 }, { t: 'print', len: 2 }, { t: 'slot', len: 2 }, { t: 'folder', len: 7 }, { t: 'stack', len: 2.5 }] });
    conveyor(c, [[394, 622], [362, 622]], 20);
    conveyor(c, [[158, 612], [136, 618], [130, 648], [142, 672], [172, 678], [232, 678]], 14);
  }, [260, 621]);
  machine('137', 'Large Marumatsu FBDC', 'FLATBED', (c) => {
    lineMachine(c, { x0: 878, x1: 990, yc: 580, wpx: 24, flow: -1, units: [{ t: 'table', len: 2 }, { t: 'platen', len: 3.4 }, { t: 'table', len: 2 }] });
    conveyor(c, [[1027, 580], [992, 580]], 18);
    c.box(3.6, 1.4, 1.6, C.body2, X(953), 0, Z(603), 0.14);
    c.cyl(0.12, 0.12, C.red, X(940), 1.46, Z(603), 10);
  });
  machine('130', 'Isowa Rotary Die Cut', 'RDC', (c) => {
    lineMachine(c, { x0: 960, x1: 1036, yc: 662, wpx: 42, flow: 1, units: [{ t: 'feeder', len: 2 }, { t: 'die', len: 2.4 }, { t: 'stack', len: 1.6 }] });
    conveyor(c, [[1049, 692], [1049, 576]], 17);
  });
  // two slitters side by side, running east: feed table → slitter head → outfeed conveyor toward the Design room
  const slitter = (id, name, yc) => machine(id, name, 'Slitter', (c) => {
    const z = Z(yc);
    c.box(1.2, 1.4, 1.0, C.body2, X(862), 0, z - 0.9, 0.1);                 // control panel at the feed end
    c.cyl(0.12, 0.12, C.red, X(862), 1.46, z - 0.9, 10);
    c.box(2.4, 1.1, 2.9, C.body2, X(878), 0, z, 0.12);                       // feed table
    c.box(2.6, 2.0, 3.2, C.body, X(903), 0, z, 0.2);                         // slitter head
    c.box(2.7, 0.3, 3.3, C.blue, X(903), 1.7, z, 0.08);
    const blades = [];
    for (let i = 0; i < 5; i++) { const h = new THREE.Group(); h.position.set(X(903), 2.3, z - 1.1 + i * 0.55); h.rotation.x = Math.PI / 2; c.g.add(h); blades.push(D(c.cyl(0.55, 0.06, 0xc7ccd6, 0, 0, 0, 16, h))); }
    c.anims.push((t, dt) => blades.forEach((b) => (b.rotation.y += dt * 9)));
    const sheet = D(c.box(2.0, 0.05, 2.4, C.kraft, X(870), 1.1, z, 0.02));
    const ph = Math.random();
    c.anims.push((t) => { const u = (t * 0.35 + ph) % 1; sheet.position.x = X(912) - u * 4.4; }); // right to left: head → table
    conveyor(c, [[944, yc], [917, yc]], 22, { speed: 1.6 });
    c.light(X(903) + 0.9, 2.0, z - 1.4);
  });
  slitter('110', '142" Slitter', 418);
  slitter('111', '120" Slitter', 458);
  machine('112', 'Band Saw', 'Band saw', (c) => {
    c.box(1.4, 1.0, 1.6, C.body, X(803), 0, Z(588), 0.12);
    c.box(0.7, 2.6, 0.7, C.blue, X(803), 1.0, Z(584), 0.12);
    const h = new THREE.Group(); h.position.set(X(803), 3.1, Z(590)); c.g.add(h);
    const wheel = D(c.cyl(0.55, 0.16, C.frame, 0, 0, 0, 14, h)); wheel.rotation.x = Math.PI / 2;
    c.box(0.3, 0.06, 0.3, C.red, 0, 0.55, 0.12, 0.02, wheel);
    c.anims.push((t, dt) => { wheel.rotation.y += dt * 8; });
  });
  machine('113', 'Eccentric', 'Eccentric', (c) => {
    c.box(3.0, 1.6, 2.0, C.body, X(744), 0, Z(679), 0.18);
    c.box(1.2, 1.4, 1.4, C.body2, X(744), 1.6, Z(679), 0.14);
    const fw = new THREE.Group(); fw.position.set(X(744) + 1.2, 2.4, Z(679)); fw.rotation.z = Math.PI / 2; c.g.add(fw);
    const wheel = D(c.cyl(0.8, 0.22, C.blue, 0, 0, 0, 14, fw));
    c.box(0.2, 0.25, 0.9, C.red, 0, 0.13, 0.4, 0.03, wheel);
    const ram = D(c.box(0.6, 0.7, 0.6, C.frame, X(744), 1.0, Z(679) + 1.2, 0.08));
    c.anims.push((t, dt) => { wheel.rotation.y += dt * 5; ram.position.y = 1.0 + 0.35 + Math.abs(Math.sin(t * 2.5)) * 0.5; });
  });
  const gluer = (id, x0, x1, yc, wpx, along = 'x') => machine(id, `${id} Gluer`, 'Gluer', (c) => {
    const L = (x1 - x0) * SC, W = wpx * SC;
    const grp = new THREE.Group(); grp.position.set(along === 'x' ? X((x0 + x1) / 2) : X(yc), 0, along === 'x' ? Z(yc) : Z((x0 + x1) / 2)); if (along === 'z') grp.rotation.y = -Math.PI / 2; c.g.add(grp);
    c.box(L, 1.2, W, C.body, 0, 0, 0, 0.16, grp);
    c.box(L * 0.25, 1.4, W * 1.05, C.blue, L * 0.32, 1.2, 0, 0.14, grp);
    const pot = D(c.cyl(0.3, 0.6, C.yellow, L * 0.05, 1.5, W / 2 + 0.1, 12, grp));
    const b = stripPlane(L * 0.9, W * 0.5, belt(), 0.4); b.position.set(0, 1.22, 0); b.rotation.y = Math.PI; grp.add(b);
    const items = [0, 1, 2].map(() => D(c.box(1.0, 0.12, W * 0.55, C.kraft, 0, 1.25, 0, 0.03, grp)));
    const ph = Math.random();
    c.anims.push((t) => { items.forEach((it, i) => { const u = (t * 0.3 + ph + i / 3) % 1; it.position.x = L / 2 - 0.5 - u * (L - 1); }); pot.scale.y = 1 + 0.05 * Math.sin(t * 6); });
    c.light(-L * 0.38, 1.2, -W / 2 + 0.25, grp);
  });
  gluer('150', 350, 405, 567, 28);
  gluer('151', 220, 262, 572, 19);
  gluer('152', 490, 535, 100, 22, 'z');
  machine('155', 'Stitcher', 'Stitcher', (c) => {
    c.box(4.2, 1.1, 1.6, C.body, X(62), 0, Z(506), 0.16);
    c.box(0.9, 1.7, 1.0, C.blue, X(62), 1.1, Z(506), 0.12);
    const head = D(c.box(0.5, 0.5, 0.5, C.frame, X(62), 2.8, Z(506) + 0.55, 0.06));
    c.anims.push((t) => { head.position.y = 2.8 + 0.25 - Math.abs(Math.sin(t * 6)) * 0.55; });
  });
  machine('Strapper', 'Strapper', 'Strapper', (c) => {
    conveyor(c, [[452, 491], [261, 491], [261, 238]], 20, { r: 2 });
    conveyor(c, [[295, 412], [295, 478]], 18);
    // strapping arch with the head going up and down
    const ax = X(261), az = Z(361);
    c.box(0.4, 3.6, 0.6, C.blue, ax - 1.5, 0, az, 0.1); c.box(0.4, 3.6, 0.6, C.blue, ax + 1.5, 0, az, 0.1);
    c.box(3.4, 0.5, 0.7, C.blue, ax, 3.4, az, 0.12);
    const head = D(c.box(1.2, 0.4, 0.6, C.frame, ax, 2.8, az, 0.08));
    c.anims.push((t) => { head.position.y = 2.6 + 0.2 + Math.abs(Math.sin(t * 1.8)) * 0.7; });
    c.light(ax + 1.5, 3.6, az + 0.4);
  }, [261, 361]);
  machine('Baler', 'Baler', 'Baler', (c) => {
    c.box(2.6, 2.2, 2.0, C.body, X(478), 0, Z(362), 0.2);
    c.box(2.7, 0.3, 2.1, C.blue, X(478), 1.8, Z(362), 0.1);
    const hop = mesh(new THREE.ConeGeometry(1.1, 1.6, 8), c.m(C.body2), X(458), 1.5, Z(362)); hop.rotation.z = Math.PI / 2; c.g.add(hop);
    const ram = D(c.box(0.5, 1.2, 1.4, C.frame, X(478) + 1.1, 0.4, Z(362), 0.08));
    const bale = D(c.box(1.2, 1.0, 1.2, C.kraft2, X(478) + 2.2, 0, Z(362), 0.08));
    c.anims.push((t) => { const k = 0.5 + 0.5 * Math.sin(t * 1.4); ram.position.x = X(478) + 1.1 - k * 1.6; bale.scale.y = 0.6 + 0.4 * k; bale.position.y = (0.6 + 0.4 * k) * 0.5; });
  });
}

// =====================================================================
// People: walkers on aisle loops, and operators working at machines
// =====================================================================
function person(scene, { vest = C.amber, hat = C.blue, skin = 0xe0b48a } = {}) {
  const g = new THREE.Group(); scene.add(g);
  const pants = smat(C.navy), vestM = smat(vest), skinM = smat(skin), hatM = smat(hat);
  const leg = (s) => { const p = D(new THREE.Group()); p.position.set(0, 1.0, s * 0.17); g.add(p); p.add(mesh(rbox(0.26, 1.0, 0.26, 0.1), pants, 0, -0.5, 0)); return p; };
  const arm = (s) => { const p = D(new THREE.Group()); p.position.set(0, 1.85, s * 0.42); g.add(p); p.add(mesh(rbox(0.2, 0.85, 0.2, 0.09), skinM, 0, -0.42, 0)); return p; };
  const legL = leg(1), legR = leg(-1), armL = arm(1), armR = arm(-1);
  g.add(mesh(rbox(0.46, 0.95, 0.68, 0.18), vestM, 0, 1.45, 0));
  g.add(mesh(new THREE.SphereGeometry(0.26, 12, 10), skinM, 0, 2.18, 0));
  const hh = mesh(new THREE.SphereGeometry(0.29, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatM, 0, 2.24, 0); g.add(hh);
  g.add(mesh(cylG(0.34, 0.04, 12), hatM, 0.04, 2.24, 0, false));
  bake(g);
  return { g, legL, legR, armL, armR };
}
const SKINS = [0xe0b48a, 0xc68e5e, 0x8d5a3b, 0xf0c9a0, 0xa8714a];
function buildPeople(scene, anims) {
  // walking loops through the aisles (drawing coordinates)
  const loops = [
    { pts: [[195, 226], [442, 226], [442, 233], [195, 233]], speed: 1.5 },
    { pts: [[885, 296], [965, 296], [965, 312], [885, 312]], speed: 1.4 },
    { pts: [[130, 525], [340, 525], [340, 532], [130, 532]], speed: 1.3 },
    { pts: [[420, 594], [705, 594], [705, 600], [420, 600]], speed: 1.6 },
    { pts: [[415, 556], [470, 556], [470, 564], [415, 564]], speed: 1.2 },
    { pts: [[60, 128], [125, 128], [125, 168], [60, 168]], speed: 1.5 },
    { pts: [[890, 500], [965, 500], [965, 512], [890, 512]], speed: 1.25 },
    { pts: [[1010, 180], [1065, 180], [1065, 192], [1010, 192]], speed: 1.1 },
    { pts: [[975, 235], [995, 235], [995, 262], [975, 262]], speed: 0.9 },
  ];
  loops.forEach((lp, i) => {
    const path = roundedPath(lp.pts, 0.6, true), L = path.getLength();
    for (let k = 0; k < (i < 4 ? 2 : 1); k++) {
      const p = person(scene, { skin: SKINS[(i + k) % SKINS.length], hat: (i + k) % 3 ? C.blue : 0xffffff, vest: (i + k) % 4 === 3 ? 0xc6e03a : C.amber });
      let s = (k * 0.5 + i * 0.13) * L;
      const tan = new THREE.Vector3();
      anims.push((t, dt) => {
        s += lp.speed * dt * (0.85 + 0.15 * Math.sin(t * 0.3 + i));
        const u = (s / L) % 1, pt = path.getPointAt(u); path.getTangentAt(u, tan);
        p.g.position.set(pt.x, Math.abs(Math.sin(s * 3)) * 0.05, pt.z);
        p.g.rotation.y = -Math.atan2(tan.z, tan.x);
        const sw = Math.sin(s * 3) * 0.55;
        p.legL.rotation.z = sw; p.legR.rotation.z = -sw; p.armL.rotation.z = -sw * 0.8; p.armR.rotation.z = sw * 0.8;
      });
    }
  });
  // operators: standing at a machine, reaching and stepping side to side
  [[600, 274, 'z', 1], [590, 412, 'z', 1], [520, 478, 'z', 1], [520, 614, 'z', 1], [380, 318, 'z', 1], [570, 342, 'z', 1], [300, 586, 'z', 1],
    [930, 560, 'z', 1], [990, 634, 'z', 1], [856, 432, 'x', 1], [856, 472, 'x', 1], [245, 361, 'x', 1], [72, 520, 'z', -1], [378, 545, 'z', 1], [240, 555, 'z', 1], [118, 512, 'x', -1], [492, 380, 'z', -1], [767, 676, 'x', -1]]
    .forEach(([a, b, axis, face], i) => {
      const p = person(scene, { skin: SKINS[i % SKINS.length], hat: i % 2 ? C.blue : 0xffffff, vest: i % 5 === 2 ? 0xc6e03a : C.amber });
      const base = V(a, b);
      p.g.position.copy(base);
      // face the machine
      p.g.rotation.y = axis === 'z' ? (face > 0 ? -Math.PI / 2 : Math.PI / 2) : (face > 0 ? 0 : Math.PI);
      const ph = i * 1.3;
      anims.push((t) => {
        const step = Math.sin(t * 0.5 + ph) * 0.7;
        if (axis === 'z') p.g.position.x = base.x + step; else p.g.position.z = base.z + step;
        const r = Math.sin(t * 2.2 + ph);
        p.armL.rotation.z = -0.6 - 0.5 * Math.max(0, r); p.armR.rotation.z = -0.6 - 0.5 * Math.max(0, -r);
        p.legL.rotation.z = Math.cos(t * 0.5 + ph) * 0.15; p.legR.rotation.z = -Math.cos(t * 0.5 + ph) * 0.15;
        p.g.position.y = Math.abs(Math.sin(t * 2.2 + ph)) * 0.03;
      });
    });
}

// =====================================================================
// Forklifts: drive their routes, stop to lift and set down loads
// =====================================================================
function forklift(scene) {
  const g = new THREE.Group(); scene.add(g);
  const amber = smat(C.amber), dark = smat(C.frame), steel = smat(0x9aa2af);
  g.add(mesh(rbox(2.3, 0.9, 1.5, 0.22), amber, -0.2, 0.75, 0));
  g.add(mesh(rbox(0.7, 1.2, 1.5, 0.22), dark, -1.25, 0.9, 0));
  for (const [x, z] of [[0.7, 0.62], [0.7, -0.62], [-1.0, 0.62], [-1.0, -0.62]]) {
    const w = D(mesh(cylG(0.38, 0.28, 12), dark, x, 0.38, z)); w.rotation.x = Math.PI / 2; g.add(w); w.userData.wheel = true;
  }
  // overhead guard
  for (const [x, z] of [[0.45, 0.62], [0.45, -0.62], [-0.85, 0.62], [-0.85, -0.62]]) g.add(mesh(rbox(0.1, 1.9, 0.1, 0.04), dark, x, 2.1, z, false));
  g.add(mesh(rbox(1.5, 0.1, 1.4, 0.04), dark, -0.2, 3.05, 0));
  const beaconM = new THREE.MeshStandardMaterial({ color: C.amber, emissive: 0xff8a00, emissiveIntensity: 1 });
  g.add(mesh(cylG(0.13, 0.2, 10), beaconM, -0.2, 3.2, 0, false));
  // driver
  const d = person(scene); g.add(d.g); d.g.position.set(-0.35, 0.25, 0); d.legL.rotation.z = d.legR.rotation.z = 1.4; d.armL.rotation.z = d.armR.rotation.z = 1.1;
  // mast + carriage with forks
  g.add(mesh(rbox(0.14, 3.0, 0.14, 0.04), steel, 1.12, 1.6, 0.42)); g.add(mesh(rbox(0.14, 3.0, 0.14, 0.04), steel, 1.12, 1.6, -0.42));
  const car = D(new THREE.Group()); car.position.set(1.25, 0.25, 0); g.add(car);
  car.add(mesh(rbox(0.12, 0.9, 1.1, 0.03), dark, 0, 0.45, 0));
  car.add(mesh(rbox(1.5, 0.07, 0.16, 0.02), steel, 0.75, 0.04, 0.35)); car.add(mesh(rbox(1.5, 0.07, 0.16, 0.02), steel, 0.75, 0.04, -0.35));
  const load = new THREE.Group(); load.position.set(0.85, 0.1, 0); car.add(load);
  load.add(mesh(rbox(1.5, 0.2, 1.4, 0.03), smat(C.wood), 0, 0.1, 0));
  load.add(mesh(rbox(1.4, 1.1, 1.3, 0.08), smat(C.kraft), 0, 0.75, 0));
  const wheels = g.children.filter((c) => c.userData.wheel);
  d.legL.userData.dyn = d.legR.userData.dyn = d.armL.userData.dyn = d.armR.userData.dyn = false; // seated driver doesn't move
  bake(g);
  return { g, car, load, beaconM, wheels };
}
// Pallet staging areas (the circled spots on the floor). Each slot holds one full pallet.
// face = the way a forklift points when it picks from the slot.
const OPEN_DOORS = [12, 11, 2]; // trailers parked here are loaded by the forklifts
const FACE = { w: [-1, 0], e: [1, 0], n: [0, -1], s: [0, 1] };
const REACH = 21, BACK = 45; // drawing px from the pallet center to the forklift center, and to its approach point
function spot(cx, cy, face) {
  const [dx, dy] = FACE[face];
  return { p: [cx, cy], face, at: [cx - dx * REACH, cy - dy * REACH], approach: [cx - dx * BACK, cy - dy * BACK] };
}
function palletObj(parent, h = 1.1) {
  const g = new THREE.Group(); parent.add(g);
  g.add(mesh(rbox(1.5, 0.2, 1.4, 0.03), smat(C.wood), 0, 0.1, 0));
  const load = mesh(rbox(1.4, h, 1.3, 0.08), smat(C.kraft), 0, 0.2 + h / 2, 0); g.add(load);
  g.add(mesh(rbox(1.42, 0.07, 1.32, 0.02), smat(C.blue), 0, 0.2 + h * 0.72, 0, false));
  g.userData.load = load;
  return g;
}
function buildForklifts(scene, anims) {
  // ---- staging areas ----
  const decor = new THREE.Group(); scene.add(decor);
  const empties = (px, py, n = 6) => { for (let i = 0; i < n; i++) decor.add(mesh(rbox(1.5, 0.2, 1.4, 0.03), smat(i % 2 ? C.wood : 0xa77a48), X(px), 0.1 + i * 0.21, Z(py))); };
  const full = (px, py, two = false) => { const a = palletObj(decor); a.position.set(X(px), 0, Z(py)); if (two) { const b = palletObj(decor); b.position.set(X(px), 1.32, Z(py)); } };
  const AREAS = {
    A: [290, 350, 380, 410, 440].map((y) => spot(128, y, 'w')),     // west wall
    B: [735, 760, 785, 810, 835].map((x) => spot(x, 205, 'n')),     // by maintenance
    C: [345, 370, 395, 420].map((y) => spot(830, y, 'e')),           // east aisle, by the slitter
  };
  [290, 350, 380, 410, 440].forEach((y, i) => full(100, y, i % 2 === 0));
  empties(72, 300); empties(72, 360, 5); empties(72, 420, 7);
  [735, 760, 810, 835].forEach((x, i) => full(x, 184, i % 2 === 1));
  empties(852, 230, 5); empties(805, 448, 6); empties(830, 448, 4);
  bake(decor);
  for (const slots of Object.values(AREAS)) for (const sl of slots) {
    sl.obj = palletObj(scene); sl.obj.position.set(X(sl.p[0]), 0, Z(sl.p[1]));
    sl.full = true; sl.reserved = false; sl.restockAt = 0;
  }
  // ---- where the pallets go ----
  const trailer = (k) => spot(186 + ((12 - k) * (620 - 186)) / 11, 50, 'n');
  const DEST = {
    T12: { ...trailer(12), truck: true }, T11: { ...trailer(11), truck: true }, T2: { ...trailer(2), truck: true },
    EMBA: spot(645, 292, 'w'), McKinley: spot(645, 433, 'w'), Jumbo: spot(681, 520, 'w'),
    Shanghai: spot(717, 648, 'w'), LargeMatsu: spot(1012, 578, 's'),
  };
  // dropped pallets at a machine get used up, then disappear
  const dropped = [];
  anims.push((t, dt) => {
    for (let i = dropped.length - 1; i >= 0; i--) {
      const d = dropped[i]; d.life -= dt;
      const k = Math.max(0.05, d.life / d.total);
      d.obj.userData.load.scale.y = k; d.obj.userData.load.position.y = 0.2 + (1.1 * k) / 2;
      if (d.life <= 0) { d.obj.parent.remove(d.obj); dropped.splice(i, 1); }
    }
    for (const slots of Object.values(AREAS)) for (const sl of slots) if (!sl.full && !sl.reserved && t > sl.restockAt) { sl.full = true; sl.obj.visible = true; }
  });

  // ---- three forklifts, each with its own trunk aisle ----
  const crews = [
    { area: 'A', dests: ['T12', 'T11'], start: [172, 330],
      lane: (p) => (p[1] < 150 ? [[p[0], 145], [172, 145]] : []) },
    { area: 'B', dests: ['EMBA', 'T2', 'McKinley'], start: [708, 330],
      lane: (p) => (p[1] < 150 ? [[p[0], 160], [708, 160]] : [[708, p[1]]]) },
    { area: 'C', dests: ['Jumbo', 'Shanghai', 'LargeMatsu'], start: [760, 470],
      lane: (p) => [[760, p[1]]] },
  ];
  const yawOf = (dx, dz) => -Math.atan2(dz, dx);
  const fleet = [];
  crews.forEach((crew, ci) => {
    const f = forklift(scene);
    f.load.visible = false;
    const pos = V(...crew.start);
    let yaw = -Math.PI / 2, fh = 0.5, steps = [], di = 0;
    f.g.position.copy(pos);
    const route = (a, b) => {
      const pts = [a, ...crew.lane(a), ...crew.lane(b).slice().reverse(), b];
      return pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) > 1);
    };
    const move = (pts, v, rev = false) => {
      const curve = pts.length > 2 ? roundedPath(pts, 1.4) : new THREE.LineCurve3(V(...pts[0]), V(...pts[1]));
      return { kind: 'move', curve, len: curve.getLength(), v, rev, s: 0, turned: false };
    };
    const plan = () => {
      const slot = AREAS[crew.area].find((sl) => sl.full && !sl.reserved);
      if (!slot) { steps.push({ kind: 'wait', left: 2 }); return; }
      slot.reserved = true;
      const dest = DEST[crew.dests[di++ % crew.dests.length]];
      const here = [Math.round(pos.x / SC + OX), Math.round(pos.z / SC + OY)];
      steps.push(
        move(route(here, slot.approach), 3.4),
        move([slot.approach, slot.at], 1.3),
        { kind: 'act', what: 'pick', slot, time: 0, dur: 1.8 },
        move([slot.at, slot.approach], 1.3, true),
        move(route(slot.approach, dest.approach), 3.4),
        move([dest.approach, dest.at], 1.3),
        { kind: 'act', what: 'drop', dest, time: 0, dur: 1.8 },
        move([dest.at, dest.approach], 1.3, true),
      );
    };
    const tan = new THREE.Vector3(), wp = new THREE.Vector3();
    fleet.push({ f, steps, pos, get carrying() { return f.load.visible; } });
    anims.push((t, dt) => {
      if (!steps.length) plan();
      const st = steps[0];
      let moving = false;
      if (st.kind === 'wait') { st.left -= dt; if (st.left <= 0) steps.shift(); }
      else if (st.kind === 'move') {
        if (!st.turned) { // turn on the spot to face the way it will drive (backwards when reversing)
          st.curve.getTangentAt(0, tan);
          let want = yawOf(tan.x, tan.z) + (st.rev ? Math.PI : 0);
          let d = ((want - yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
          const stepA = 2.4 * dt;
          if (Math.abs(d) <= stepA) { yaw = want; st.turned = true; } else yaw += Math.sign(d) * stepA;
          moving = true;
        } else {
          st.s += st.v * dt;
          const u = Math.min(1, st.s / st.len);
          pos.copy(st.curve.getPointAt(u)); st.curve.getTangentAt(u, tan);
          yaw = yawOf(tan.x, tan.z) + (st.rev ? Math.PI : 0);
          f.wheels.forEach((w) => (w.rotation.y += (st.rev ? -1 : 1) * dt * st.v * 2.5));
          moving = true;
          if (u >= 1) steps.shift();
        }
      } else if (st.kind === 'act') {
        st.time += dt;
        const k = st.time / st.dur;
        fh = k < 0.5 ? 0.5 * (1 - k / 0.5) : 0.5 * Math.min(1, (k - 0.5) / 0.5); // forks down, then back up
        if (!st.done && k >= 0.5) {
          st.done = true;
          if (st.what === 'pick') { st.slot.full = false; st.slot.reserved = false; st.slot.obj.visible = false; st.slot.restockAt = t + 28; f.load.visible = true; }
          else {
            f.load.visible = false;
            if (!st.dest.truck) { // set it on the machine's infeed; it gets used up
              f.load.getWorldPosition(wp);
              const o = palletObj(scene); o.position.set(wp.x, 0.05, wp.z); o.rotation.y = yaw;
              dropped.push({ obj: o, life: 16, total: 16 });
            }
          }
        }
        if (st.time >= st.dur) { fh = 0.5; steps.shift(); }
      }
      if (steps.length && steps[0].kind === 'act' && !steps[0].log) { steps[0].log = true; f.log = (f.log || []).slice(-30).concat(`${t.toFixed(0)}s ${steps[0].what} ${steps[0].what === 'pick' ? crew.area : Object.keys(DEST).find((k) => DEST[k] === steps[0].dest)}`); }
      f.g.position.set(pos.x, 0, pos.z);
      f.g.rotation.y = yaw;
      f.car.position.y = 0.2 + fh;
      f.beaconM.emissiveIntensity = moving ? 0.3 + 1.2 * Math.max(0, Math.sin(t * 8 + ci)) : 0.25;
    });
  });
  return fleet;
}

// =====================================================================
// Semi-trucks: back into a dock door, wait while loading, pull out and leave
// =====================================================================
// Truck yard north of the dock wall. Door k (1–12) sits at drawing x = 186 + (12 − k) × 39.45.
const YARD = { wall: Z(78), near: Z(78) - 22, far: Z(78) - 26.5 };
const doorX = (k) => X(186 + ((12 - k) * (620 - 186)) / 11);
const TRAILER = 14, CAB = 3.4;

function truck(scene, cabColor, withCab = true) {
  const g = new THREE.Group(); scene.add(g);
  // origin = middle of the trailer; the cab points along +x
  const white = smat(0xf7f8fb), dark = smat(C.frame), cab = smat(cabColor), blue = smat(C.blue), glass = smat(0x8fb0d9, { roughness: 0.3 });
  g.add(mesh(rbox(TRAILER, 3.3, 2.6, 0.18), white, 0, 1.0 + 1.65, 0));
  g.add(mesh(rbox(TRAILER * 0.96, 0.32, 2.64, 0.06), blue, 0, 2.0, 0, false));
  g.add(mesh(rbox(TRAILER, 0.25, 1.2, 0.05), dark, 0, 0.88, 0));
  if (withCab) {
  // cab with windshield
  g.add(mesh(rbox(CAB, 2.6, 2.5, 0.35), cab, TRAILER / 2 + CAB / 2 + 0.3, 0.6 + 1.3, 0));
  g.add(mesh(rbox(0.12, 1.0, 2.1, 0.04), glass, TRAILER / 2 + CAB + 0.32, 2.4, 0, false));
  g.add(mesh(rbox(1.6, 0.9, 2.3, 0.25), cab, TRAILER / 2 + 0.8, 3.2, 0)); // sleeper roof fairing
  g.add(mesh(rbox(TRAILER / 2 + CAB, 0.3, 1.0, 0.05), dark, TRAILER / 4 + CAB / 2, 0.75, 0));
  } else {
    // dropped trailer: landing legs instead of a tractor
    g.add(mesh(rbox(0.25, 1.0, 2.2, 0.05), dark, TRAILER / 2 - 2.5, 0.5, 0));
  }
  const wheels = [];
  for (const x of (withCab ? [-TRAILER / 2 + 1.0, -TRAILER / 2 + 2.3, TRAILER / 2 - 0.2, TRAILER / 2 + 1.0, TRAILER / 2 + CAB - 0.4] : [-TRAILER / 2 + 1.0, -TRAILER / 2 + 2.3])) for (const z of [1.05, -1.05]) {
    const w = D(mesh(cylG(0.5, 0.45, 12), dark, x, 0.5, z)); w.rotation.x = Math.PI / 2; g.add(w); wheels.push(w);
  }
  // running lights
  const lm = new THREE.MeshStandardMaterial({ color: C.amber, emissive: 0xff8a00, emissiveIntensity: 1 });
  if (withCab) for (const z of [1.2, -1.2]) g.add(mesh(cylG(0.1, 0.12, 8), lm, TRAILER / 2 + CAB + 0.35, 1.2, z, false));
  bake(g);
  return { g, wheels, lm };
}

function buildTrucks(scene, anims) {
  // asphalt yard, lane lines, dock stripes
  const yard = new THREE.Group(); scene.add(yard);
  const x0 = X(35) - 5, x1 = X(1078) + 32, z0 = YARD.far - 3.5, z1 = YARD.wall;
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), smat(0x6d7482, { roughness: 0.95 }));
  asphalt.rotation.x = -Math.PI / 2; asphalt.position.set((x0 + x1) / 2, -0.28, (z0 + z1) / 2); asphalt.receiveShadow = true; yard.add(asphalt);
  // dead end on the left: curb and bollards
  yard.add(mesh(rbox(0.6, 0.35, z1 - z0, 0.08), smat(0xc9ced8), x0 + 0.3, -0.1, (z0 + z1) / 2));
  for (let z = z0 + 1.5; z < z1 - 1; z += 3.5) { yard.add(mesh(cylG(0.22, 1.1, 10), smat(C.yellow), x0 + 1.2, 0.27, z)); }
  for (let x = x0 + 6; x < x1 - 2; x += 4) { const d = mesh(rbox(2, 0.02, 0.18, 0.01), smat(0xffd257), x + 1, -0.26, (YARD.near + YARD.far) / 2, false); d.receiveShadow = true; yard.add(d); }
  for (let k = 1; k <= 13; k++) { const px = 186 + ((12 - k) * (620 - 186)) / 11 + (620 - 186) / 22; const st = mesh(rbox(0.16, 0.02, TRAILER + 1, 0.01), smat(0xffffff), X(px), -0.26, YARD.wall - (TRAILER + 1) / 2, false); yard.add(st); }
  bake(yard);

  // trailers already at the docks (no tractor)
  for (const k of [12, 11, 2]) {
    const t = truck(scene, C.red, false);
    t.g.position.set(doorX(k), 0, YARD.wall - 0.35 - TRAILER / 2);
    t.g.rotation.y = Math.PI / 2;
  }
  // two trucks taking turns at the free doors
  const agents = [
    { doors: [8, 4, 10, 6], color: C.blue, delay: 0 },
    { doors: [3, 9, 5, 7], color: C.red, delay: 30 },
  ];
  agents.forEach((a) => {
    const tk = truck(scene, a.color);
    tk.g.visible = false;
    let segs = [], si = 0, s = 0, di = 0, hold = a.delay;
    const tan = new THREE.Vector3();
    const line = (ax, az, bx, bz) => new THREE.LineCurve3(new THREE.Vector3(ax, 0, az), new THREE.Vector3(bx, 0, bz));
    const plan = () => {
      const xd = doorX(a.doors[di % a.doors.length]); di++;
      const dock = YARD.wall - 0.35 - TRAILER / 2, turnX = xd - 15;
      const startX = X(1078) + 30;
      segs = [
        { c: line(startX, YARD.far, turnX, YARD.far), v: 7 },                                       // drive in along the far lane (heading west)
        { wait: 1.0 },
        { c: new THREE.QuadraticBezierCurve3(new THREE.Vector3(turnX, 0, YARD.far), new THREE.Vector3(xd, 0, YARD.far), new THREE.Vector3(xd, 0, dock)), v: 2.6, rev: true }, // back into the door
        { wait: 12, docked: true },                                                                   // loading
        { c: new THREE.QuadraticBezierCurve3(new THREE.Vector3(xd, 0, dock), new THREE.Vector3(xd, 0, YARD.near), new THREE.Vector3(xd + 15, 0, YARD.near)), v: 3.2 }, // pull out, turn east
        { c: line(xd + 15, YARD.near, startX, YARD.near), v: 7 },                                  // leave the way it came (the yard is a dead end on the left)
        { wait: 4, hidden: true },
      ];
      segs.forEach((g) => { if (g.c) g.len = g.c.getLength(); });
      si = 0; s = 0;
    };
    plan();
    anims.push((t, dt) => {
      if (hold > 0) { hold -= dt; return; }
      let g = segs[si];
      if (g.wait !== undefined) {
        tk.g.visible = !g.hidden;
        s += dt;
        if (s >= g.wait) { si++; s = 0; if (si >= segs.length) plan(); }
        tk.lm.emissiveIntensity = g.docked ? 0.2 : 0.6 + 0.6 * Math.max(0, Math.sin(t * 6));
        return;
      }
      tk.g.visible = true;
      s += g.v * dt;
      const u = Math.min(1, s / g.len);
      const p = g.c.getPointAt(u); g.c.getTangentAt(u, tan);
      if (g.rev) tan.multiplyScalar(-1);
      tk.g.position.set(p.x, 0, p.z);
      tk.g.rotation.y = -Math.atan2(tan.z, tan.x);
      tk.wheels.forEach((w) => (w.rotation.y += (g.rev ? -1 : 1) * dt * g.v * 2));
      tk.lm.emissiveIntensity = g.rev ? 0.6 + 0.6 * Math.max(0, Math.sin(t * 9)) : 0.8;
      if (u >= 1) { si++; s = 0; if (si >= segs.length) plan(); }
    });
  });
}
