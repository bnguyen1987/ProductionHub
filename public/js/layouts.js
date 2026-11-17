// Print Layouts: upload an old print layout / spec sheet, the AI reads it, and the page redraws it as a clean new spec sheet.
// Draft stays in this browser (localStorage). Saved layouts go to /api/layouts so anyone can open and reprint them.
import { $, $$, esc, api, fileToPayload, parseInches, fmtIn, saveForm, loadForm, getCode } from './common.js';
import { openPrint } from './printkit.js';
import { pageCanvas } from './dieline.js';

const today = () => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`; };
const EMPTY = () => ({
  id: '', customer: '', shipTo: '', fileNo: '', specNo: '', design: '', ident: '', style: '', size: '', board: '',
  joint: '', plateSizes: '', blankW: '', blankL: '', print: '', routing: '', view: 'Outside', widthPanels: '', lengthPanels: '',
  printPanels: [], plates: [], notes: '', changes: '', detailTexts: [], details: [], detailLogos: true, origDate: '', revDate: today(), sales: '', designer: '', approved: '', orig: null,
});
const INFO = [
  ['customer', 'Customer'], ['shipTo', 'Ship to'], ['fileNo', 'File #'], ['specNo', 'Spec #'],
  ['style', 'Style'], ['size', 'Size (L × W × D)'],
  ['board', 'Board / flute'], ['print', 'Print / ink'], ['routing', 'Routing'], ['revDate', 'Revision date'],
];
// Fields compared by "Add my edits"
const TRACK = [['style', 'Style'], ['size', 'Size'], ['board', 'Board'], ['blankW', 'Blank width'], ['blankL', 'Blank length'], ['print', 'Print'], ['routing', 'Routing'], ['widthPanels', 'Panel scores'], ['lengthPanels', 'Length scores']];

let L, view, saved = [], ro = null, sel = -1, undo = null, dragged = false;
let origFiles = []; // the scan(s) just read, kept in memory until the layout is saved (then stored with it)
// Undo history: a snapshot after each change (quick changes in a row, like typing, count as one step).
let hist = [], histLock = false, histT = 0, histTyping = false;
// Pictures are kept once in a pool and the history holds a short tag for each, so 40 undo steps stay small.
const imgPool = [];
const slim = (o) => JSON.stringify(o, (k, v) => {
  if (typeof v !== 'string' || v.length < 500 || !v.startsWith('data:image/')) return v;
  let i = imgPool.indexOf(v);
  if (i < 0) i = imgPool.push(v) - 1;
  return '\u0001img' + i;
});
const fat = (j) => JSON.parse(j, (k, v) => (typeof v === 'string' && v.startsWith('\u0001img') ? imgPool[+v.slice(4)] || '' : v));
// Draft save: right away for a plain sheet; a sheet with pictures (a few hundred KB) is saved once typing pauses.
let draftT = 0;
function flushDraft() { if (draftT) { clearTimeout(draftT); draftT = 0; saveForm('layout', L); } }
function saveDraft() {
  const heavy = L.plates.some((p) => p.img) || (L.details || []).length;
  if (!heavy) { if (draftT) { clearTimeout(draftT); draftT = 0; } saveForm('layout', L); return; }
  clearTimeout(draftT);
  draftT = setTimeout(() => { draftT = 0; saveForm('layout', L); }, 250);
}
const onHide = () => flushDraft();
function snap() {
  if (histLock) return;
  const j = slim({ ...L, orig: undefined });
  if (hist.length && hist[hist.length - 1] === j) return;
  const now = Date.now();
  // typing in a box: keystrokes close together count as one step. Button presses and drags are always their own step.
  if (histTyping && hist.length > 1 && now - histT < 700) hist[hist.length - 1] = j; else hist.push(j);
  histT = histTyping ? now : 0;
  histTyping = false;
  if (hist.length > 40) hist.shift();
  const b = $('#lUndoAll'); if (b) b.disabled = hist.length < 2;
}
function undoLast() {
  if (hist.length < 2) return;
  hist.pop();
  const prev = fat(hist[hist.length - 1]);
  histLock = true;
  L = { ...EMPTY(), ...prev, orig: L.orig };
  sel = -1; undo = null;
  fill();
  histLock = false;
  histT = 0;
  const b = $('#lUndoAll'); if (b) b.disabled = hist.length < 2;
}

// ---- inches ----
const pin = (s) => parseInches(String(s ?? '').replace(/["”]/g, '').trim());
const f = (x) => fmtIn(x, '');
// Plant style: inches:sixteenths (10:05 = 10 5/16"). Used on the sheet unless "fractions" is picked.
const c16 = (x) => { if (!isFinite(x)) return '–'; let w = Math.floor(x + 1e-9), n = Math.round((x - w) * 16); if (n === 16) { w++; n = 0; } return `${w}:${String(n).padStart(2, '0')}`; };
const fmtFor = (d) => (d && d.units === 'frac' ? { f: (x) => fmtIn(x, ''), q: (x) => fmtIn(x, '"') } : { f: c16, q: c16 });
const fx = (x) => (Math.abs(x * 16 - Math.round(x * 16)) < 0.02 ? f(x) : String(+x.toFixed(3)));
const show = (s) => { const v = pin(s); return isFinite(v) ? f(v) : String(s ?? '').trim(); };
const list = (s) => String(s || '').split(/[,|;]/).map((x) => x.trim()).filter(Boolean);
const nums = (s) => list(s).map(pin).filter((v) => isFinite(v) && v > 0);
const sum = (a) => a.reduce((t, v) => t + v, 0);
const near = (a, b) => Math.abs(a - b) < 1 / 32;
const SIZE_PX = { XS: 6, S: 8, M: 11, L: 15 };
const clampFs = (v) => Math.max(4, Math.min(40, Math.round(+v * 2) / 2));
// font size of a text item: typed size wins, else the old Small/Medium/Large preset
const textFs = (p) => (+p.fsz > 0 ? clampFs(p.fsz) : SIZE_PX[p.size] || 11);
const autoFs = {}; // last auto-fit size of each plate, so A+/A- can start from it
// Which way the copy runs: 0 upright, 90 sideways reading top to bottom, 180 upside down, 270 sideways reading bottom to top.
// Older saves only have "flip" (= upside down).
// AI answer → turn (falls back to the older upside_down flag)
const turnOf = (x) => ([90, 180, 270].includes(+x?.turn) ? { turn: +x.turn, flip: false } : { turn: 0, flip: !!x?.upside_down });
// Height ÷ width of each logo picture (loaded once, then the sheet is redrawn so plates can size to it)
const imgRatio = new Map();
function ratioOf(src) {
  if (!src) return 0;
  if (imgRatio.has(src)) return imgRatio.get(src);
  imgRatio.set(src, 0);
  const im = new Image();
  im.onload = () => { imgRatio.set(src, im.naturalWidth ? im.naturalHeight / im.naturalWidth : 0); const el = document.getElementById('lSheet'); if (el && el.isConnected) el.innerHTML = sheetHtml(L, sel); };
  im.src = src;
  return 0;
}
// Width and Length both typed = the real plate size, so the logo fills it (unless "Keep logo shape" is on)
const fillLogo = (p) => !!p.img && !p.keepShape && pin(p.width) > 0 && pin(p.plen) > 0;
// How the manufacturer's joint is closed: glue (default), stitch or tape
const jointName = (d) => (d.joint === 'stitch' ? 'STITCH' : d.joint === 'tape' ? 'TAPE' : 'GLUE');
// Height of each item as a share of its panel's height (from the last drawing), for the Top / Bottom spaces
const itemHs = {};
// Inches typed in the space boxes: 3:05 (plant style), 3 5/16, 3.31
const inOf = (v) => { const t = String(v ?? '').trim(), c = t.match(/^(\d+):(\d{1,2})$/); return c ? +c[1] + +c[2] / 16 : pin(t); };
// Space around the selected item, in inches: left / right to the scores of its length panel, top / bottom to its width panel's scores
function spaces(p) {
  const g = geom(), sp = span(p, g), rowIn = g.rows[p.panel - 1], out = {};
  if (sp) {
    let k = g.scores.findIndex((x, j) => j < g.scores.length - 1 && sp[0] >= x - 1e-6 && sp[0] < g.scores[j + 1] - 1e-6);
    if (k < 0) k = sp[0] < 0 ? 0 : g.scores.length - 2;
    if (k >= 0 && g.scores.length > 1) { out.k = k; out.left = sp[0] - g.scores[k]; out.right = g.scores[k + 1] - sp[1]; out.w = sp[1] - sp[0]; }
  }
  const hs = itemHs[sel];
  if (rowIn > 0 && hs >= 0) { const dy = Math.max(-0.45, Math.min(0.45, +p.dy || 0)); out.rowIn = rowIn; out.hs = hs; out.top = (0.5 + dy - hs / 2) * rowIn; out.bottom = (0.5 - dy - hs / 2) * rowIn; }
  return out;
}
function setSpace(p, side, v) {
  const sp = spaces(p), g = geom();
  if (!isFinite(v) || v < 0) return false;
  if ((side === 'left' || side === 'right') && sp.k != null) {
    const st = side === 'left' ? g.scores[sp.k] + v : g.scores[sp.k + 1] - v - sp.w;
    p.start = f(Math.round(Math.max(0, st) * 16) / 16);
  } else if ((side === 'top' || side === 'bottom') && sp.rowIn > 0) {
    const dy = side === 'top' ? v / sp.rowIn + sp.hs / 2 - 0.5 : 0.5 - v / sp.rowIn - sp.hs / 2;
    p.dy = Math.round(Math.max(-0.45, Math.min(0.45, dy)) * 10000) / 10000;
  } else return false;
  return true;
}


const angleOf = (p) => (((+p.turn || 0) + (p.flip ? 180 : 0)) % 360 + 360) % 360;
function setAngle(p, a) { p.turn = ((+a % 360) + 360) % 360; p.flip = false; }
const TURNS = [[0, 'Upright'], [90, 'Sideways ↓'], [180, 'Upside down'], [270, 'Sideways ↑']];
// Size of a text item along the sheet, in drawing px (sideways text takes its line stack along the sheet)
function textAlongPx(p) {
  const ls = String(p.text || 'TEXT').split('\n').map((x) => x.trim()).filter(Boolean), fs = textFs(p);
  const n = Math.max(1, ls.length), longest = Math.max(1, ...ls.map((x) => x.length));
  return angleOf(p) % 180 === 90 ? n * fs * 1.2 + fs * 0.3 : longest * fs * 0.6 + 6;
}

// Box Maker's Certificate (BMC) values from the freight rules (NMFC Item 222 / UFC Rule 41).
// [max gross wt lbs, size limit in (L+W+D), min combined facings lbs/MSF (Mullen only)]. Confirm against the plant's stamp.
const BMC = {
  single: { ECT: { 23: [20, 40], 26: [35, 50], 29: [50, 60], 32: [65, 75], 40: [80, 80], 44: [95, 85], 55: [120, 95] },
    Mullen: { 125: [20, 40, 52], 150: [35, 50, 66], 175: [50, 60, 75], 200: [65, 75, 84], 250: [80, 80, 111], 275: [95, 85, 138], 350: [120, 95, 180] } },
  double: { ECT: { 42: [80, 85], 48: [100, 95], 51: [120, 105], 61: [140, 110], 71: [160, 115], 82: [180, 120] },
    Mullen: { 200: [80, 85, 92], 275: [100, 95, 110], 350: [120, 105, 126], 400: [140, 110, 180], 500: [160, 115, 222], 600: [180, 120, 270] } },
};
const bmcOf = (p) => { const w = p.wall === 'double' ? 'double' : 'single', tst = p.test === 'Mullen' ? 'Mullen' : 'ECT'; return { w, tst, v: String(p.rating || ''), row: BMC[w][tst][p.rating] }; };
const bmcLabel = (p) => { const b = bmcOf(p); return `${b.v || '?'} ${b.tst === 'ECT' ? 'ECT' : 'lb Mullen'}, ${b.w} wall`; };
// Default BMC from the board field: "ECT 32 C" → ECT 32; "200# C Kraft" → Mullen 200; BC / DW → double wall.
function bmcFromBoard(board) {
  const b = String(board || ''), dbl = /\b(BC|EB|DW|double)\b/i.test(b);
  const n = (b.match(/(\d{2,3})/) || [])[1];
  const ect = /ECT/i.test(b) || (n && +n < 100);
  return { test: ect ? 'ECT' : 'Mullen', wall: dbl ? 'double' : 'single', rating: n || (ect ? '32' : '200') };
}

export function render(v) {
  view = v;
  L = { ...EMPTY(), ...(loadForm('layout') || {}) };
  view.innerHTML = `
    <div class="page-head"><h1>Print Layouts</h1><p>Upload an old print layout or spec sheet. It reads the panels, print placement and notes, and draws a clean new spec sheet. Check every number before it goes to the floor.</p></div>
    <div class="stack lay-page">
      <div class="layout two">
        <section class="card">
          <h2><span class="n">1</span>Upload old layout</h2>
          <label class="drop" id="lDrop">
            <input type="file" accept="application/pdf,image/*" multiple aria-label="Upload old layout">
            <div class="big">Drop the box measurements and the print layout</div>
            <div class="hint">Pick both files at once: 1st the box measurements, 2nd the print layout (or one PDF with both pages). Handwritten changes are picked up too.</div>
          </label>
          <div id="lAiMsg" style="margin-top:10px"></div>
          <div id="lOrig" class="lay-orig"></div>
        </section>
        <section class="card">
          <h2>Saved layouts</h2>
          <input type="search" id="lFind" placeholder="Search customer, file #, design" aria-label="Search saved layouts">
          <div id="lList" style="margin-top:10px"><div class="hint"><span class="spinner"></span> Loading…</div></div>
        </section>
      </div>
        <section class="card lay-preview">
          <h2>New spec sheet <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:500">updates as you edit below</span></h2>
          <div class="lsheet-wrap" id="lWrap"><div id="lSheet" data-no-i18n></div></div>
          <div id="lWarn"></div>
          <div id="lSelBar" class="sel-bar"></div>
          <div class="btn-row" style="margin-top:12px">
            <button type="button" class="btn primary" id="lPrint">Print / save PDF</button>
            <input type="text" id="lName" placeholder="Your name" aria-label="Your name" style="max-width:170px">
            <button type="button" class="btn" id="lSave">Save</button>
            <button type="button" class="btn" id="lUndoAll" disabled title="Undo the last change (Ctrl+Z)">↶ Undo</button>
            <button type="button" class="btn ghost" id="lNew">Start over</button>
            <button type="button" class="btn ghost" id="lVerBtn" style="display:none">Versions</button>
          </div>
          <div id="lSaveMsg" style="margin-top:8px"></div>
          <div id="lVers"></div>
        </section>
      <div class="layout two">
        <div class="stack">
        <section class="card">
          <h2><span class="n">2</span>Sheet details</h2>
          <div class="row">${INFO.map(([k, t]) => `<div class="field"><label>${t}</label><input type="text" data-l="${k}"></div>`).join('')}</div>
          <div class="row">
            <div class="field"><label>Blank width (in)</label><input type="text" inputmode="decimal" data-l="blankW" placeholder="e.g. 34 1/16"></div>
            <div class="field"><label>Blank length (in)</label><input type="text" inputmode="decimal" data-l="blankL" placeholder="e.g. 133 1/16"></div>
            <div class="field"><label>View</label><select data-l="view"><option value="Outside">Outside</option><option value="Inside">Inside</option></select></div>
          </div>
        </section>
        <section class="card">
          <h2><span class="n">4</span>Notes and changes</h2>
          <div class="field"><label>Print and production notes (one per line)</label><textarea data-l="notes" rows="5"></textarea></div>
          <div class="lbl" style="margin:12px 0 6px">Print detail box <span class="hint" style="font-weight:500">close-ups of the logo / print for the operator</span></div>
          <label class="chk" style="margin-bottom:6px"><input type="checkbox" id="lDetLogos"> Show the plate logos zoomed in</label>
          <div id="lDetPics" class="det-pics"></div>
          <label class="btn small" style="margin:6px 0">+ Add close-up picture<input type="file" accept="image/*" hidden id="lDetAdd"></label>
          <div class="lbl" style="margin:8px 0 6px">Text boxes in the detail box (up to 4, side by side)</div>
          <div id="lDetTexts" class="det-texts"></div>
          <button type="button" class="btn small" id="lDetTextAdd" style="margin-top:6px">+ Add text box</button>
        </section>
        </div>
        <div class="stack">
        <section class="card">
          <h2><span class="n">3</span>Panels and print</h2>
          <div class="field"><label>Panel scores across the width, top to bottom</label><input type="text" data-l="widthPanels" placeholder="4 7/8, 9 11/16, 4 15/16, 9 11/16, 4 7/8"></div>
          <div id="lWChk" class="hint" style="margin:4px 0 10px"></div>
          <div class="field"><label>Scores along the length, left to right</label><input type="text" data-l="lengthPanels" placeholder="4 3/4, 123 1/16, 4 3/4"></div>
          <div id="lLChk" class="hint" style="margin:4px 0 10px"></div>
          <div class="field" style="max-width:260px;margin-bottom:10px"><label>Measurements on the sheet</label><select data-l="units"><option value="">10:05 (inches:sixteenths)</option><option value="frac">10 5/16 (fractions)</option></select></div>
          <div class="field" style="max-width:260px;margin-bottom:10px"><label>Glue tab and slots</label><select data-l="glueTab"><option value="">Auto (RSC-type: small 1st length panel)</option><option value="on">Show</option><option value="off">Don't show</option></select></div>
          <div class="field" style="max-width:200px;margin-bottom:10px"><label>Joint</label><select data-l="joint"><option value="">Glue</option><option value="stitch">Stitch</option><option value="tape">Tape</option></select></div>
          <div class="field" style="max-width:200px;margin-bottom:10px"><label>Plate size measurements</label><select data-l="plateSizes"><option value="">Show</option><option value="off">Hide on all plates</option></select></div>
          <div class="lbl" style="margin:4px 0 6px">Printed panels <span class="hint" style="font-weight:500">only the panels with a plate, BMC or text get shaded; a row picked here with nothing on it is shaded whole</span></div>
          <div class="seg" id="lPP"></div>
          <div class="lbl" style="margin:14px 0 6px">Print, BMC and text on the sheet <span class="hint" style="font-weight:500">start = inches from the left edge of the blank</span></div>
          <div id="lPlates"></div>
          <div class="btn-row" style="margin-top:8px"><button type="button" class="btn small" id="lAddPlate">+ Add plate</button><button type="button" class="btn small" id="lAddBmc">+ Add BMC</button><button type="button" class="btn small" id="lAddText">+ Add text</button></div>
        </section>
        </div>
      </div>
    </div>`;

  const drop = $('#lDrop'), inp = drop.querySelector('input');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files.length) readLayout([...e.dataTransfer.files]); });
  inp.addEventListener('change', () => { if (inp.files.length) readLayout([...inp.files]); inp.value = ''; });
  view.addEventListener('input', onInput);
  view.addEventListener('change', onInput);
  const mid = () => { const lp = nums(L.lengthPanels), tl = lp.length ? sum(lp) : pin(L.blankL); return isFinite(tl) && tl > 0 ? fx(Math.max(0, tl / 2 - 3)) : '10'; };
  const addItem = (it) => { L.plates.push(it); sel = L.plates.length - 1; undo = null; paintPlates(); update(); };
  $('#lAddPlate').onclick = () => addItem({ kind: 'plate', panel: L.printPanels[0] || 1, start: '', width: '', text: '', flip: false });
  $('#lAddBmc').onclick = () => addItem({ kind: 'bmc', panel: L.printPanels[0] || 1, start: mid(), ...bmcFromBoard(L.board), flip: false });
  $('#lAddText').onclick = () => addItem({ kind: 'text', panel: 1, start: mid(), text: '', size: 'M', flip: false });
  $('#lDetTextAdd').onclick = () => { if (L.detailTexts.length >= 4) return alert('The detail box holds up to 4 text boxes.'); L.detailTexts.push(''); paintDetails(); update(); const t = $$('#lDetTexts textarea').pop(); if (t) t.focus(); };
  $('#lDetLogos').onchange = (e) => { L.detailLogos = e.target.checked; update(); };
  $('#lDetAdd').onchange = (e) => { const f0 = e.target.files[0]; e.target.value = ''; if (f0) addDetail(f0); };
  $('#lPrint').onclick = printSheet;
  $('#lSave').onclick = save;
  $('#lUndoAll').onclick = undoLast;
  hist = []; histT = 0; imgPool.length = 0;
  window.addEventListener('pagehide', onHide); document.addEventListener('visibilitychange', onHide);
  $('#lVerBtn').onclick = showVersions;
  $('#lNew').onclick = () => { if (!confirm('Clear this layout and start over?')) return; L = EMPTY(); sel = -1; undo = null; origFiles = []; $('#lVers').innerHTML = ''; fill(); $('#lAiMsg').innerHTML = ''; $('#lSaveMsg').innerHTML = ''; };
  $('#lFind').oninput = paintList;
  $('#lSheet').addEventListener('click', (e) => {
    if (dragged) { dragged = false; return; }
    const px = e.target.closest('[data-picx]');
    if (px) {
      const k = px.dataset.picx, n = +k.slice(1);
      if (k[0] === 'l' && L.plates[n]) { const img = L.plates[n].img; L.plates.forEach((p) => { if (p.img === img) p.nodetail = true; }); }
      else if (k[0] === 'd') { L.details.splice(n, 1); paintDetails(); }
      update(); return;
    }
    if (e.target.closest('[data-picshow]')) { L.plates.forEach((p) => { delete p.nodetail; }); update(); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) { openEditor(ed.dataset.edit, ed); return; }
    const g = e.target.closest('[data-pi]');
    const pi = g ? +g.dataset.pi : -1;
    if (pi >= 0 && pi === sel && L.plates[pi] && L.plates[pi].kind !== 'bmc') { openEditor('item:' + pi, g); return; } // tap a selected item again to change its words
    closeEditor();
    select(pi);
  });
  $('#lSheet').addEventListener('dblclick', (e) => {
    const g = e.target.closest('[data-pi]');
    const p = g && L.plates[+g.dataset.pi];
    if (p && p.kind !== 'bmc') openEditor('item:' + g.dataset.pi, g);
  });
  $('#lSheet').addEventListener('pointerdown', startDrag);
  $('#lPlates').addEventListener('focusin', (e) => { const r = e.target.closest('[data-plate]'); if (r && +r.dataset.plate !== sel) select(+r.dataset.plate, false); });
  document.addEventListener('keydown', onKey);
  $('#lName').value = loadForm('layout_name') || '';
  ro = new ResizeObserver(fit);
  ro.observe($('#lWrap'));
  fill();
  loadList();
}

export function destroy() {
  flushDraft();
  window.removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onHide);
  if (ro) ro.disconnect(); ro = null; document.removeEventListener('keydown', onKey); sel = -1; undo = null; hist = []; imgPool.length = 0;
}

// ---- select / highlight / delete a print on the sheet ----
function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !e.target.closest('input,textarea,select,[contenteditable]')) { e.preventDefault(); undoLast(); return; }
  if (sel < 0 || e.target.closest('input,textarea,select,[contenteditable]')) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delPlate(sel); }
  else if (e.key === 'Escape') select(-1);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); nudge((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / 16)); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); movePanel(e.key === 'ArrowUp' ? -1 : 1); }
}
// Move the selected item: along the length (inches) or to another width panel.
function nudge(dIn) {
  const p = L.plates[sel]; if (!p) return;
  const lp = nums(L.lengthPanels), tl = lp.length ? sum(lp) : pin(L.blankL);
  const w = p.kind === 'plate' && isFinite(pin(p.width)) ? pin(p.width) : p.kind === 'bmc' ? 1 : 0;
  let st = (isFinite(pin(p.start)) ? pin(p.start) : 0) + dIn;
  st = Math.max(0, isFinite(tl) ? Math.min(tl - w, st) : st);
  p.start = f(Math.round(st * 16) / 16);
  paintPlates(); update();
}
// Up/down: step 0.15 of the panel height; past the edge it moves onto the next panel.
function movePanel(d) {
  const p = L.plates[sel]; if (!p) return;
  const n = Math.max(1, nums(L.widthPanels).length);
  const rowIn = nums(L.widthPanels)[p.panel - 1];
  let dy = (+p.dy || 0) + d * (rowIn > 0 ? 0.25 / rowIn : 0.15); // 1/4" a step when the panel size is known
  if (dy < -0.451 && p.panel > 1) { p.panel--; dy = 0.45; }
  else if (dy > 0.451 && p.panel < n) { p.panel++; dy = -0.45; }
  p.dy = Math.round(Math.max(-0.45, Math.min(0.45, dy)) * 10000) / 10000;
  paintPlates(); update();
}
function select(i, repaintRows = true) {
  sel = i >= 0 && i < L.plates.length ? i : -1;
  if (sel >= 0) undo = null;
  if (repaintRows) paintPlates(); else markRows();
  update();
}
function delPlate(i) {
  if (i < 0 || i >= L.plates.length) return;
  undo = { p: L.plates[i], i };
  L.plates.splice(i, 1);
  sel = -1;
  paintPlates(); update();
}
function markRows() { $$('.plate-row', view).forEach((r) => r.classList.toggle('sel', +r.dataset.plate === sel)); }
function paintSelBar() {
  const bar = $('#lSelBar');
  if (!bar) return;
  const p = L.plates[sel];
  if (p) {
    const what = p.kind === 'bmc' ? `<b>Selected BMC:</b> P${p.panel} · ${esc(bmcLabel(p))}` : `<b>${p.kind === 'text' ? 'Selected text:' : 'Selected print:'}</b> P${p.panel}${p.text ? ' · ' + esc(String(p.text).replace(/\s+/g, ' ').slice(0, 70)) + (String(p.text).length > 70 ? '…' : '') : ''}`;
    const nP = Math.max(1, nums(L.widthPanels).length, p.panel);
    // Same rows and the same buttons for every item: a button that does not apply is greyed out, never removed,
    // so nothing jumps around when you click from a plate to a BMC or text.
    const isB = p.kind === 'bmc', isT = p.kind === 'text', isP = p.kind === 'plate';
    const dis = (off) => (off ? ' disabled' : '');
    const ta = p.ta || (isT ? 'left' : 'center');
    const keepOk = isP && p.img && pin(p.width) > 0 && pin(p.plen) > 0;
    bar.innerHTML = `<div class="sb-title">${what}</div>
      <div class="sb-row sel-move"><span class="sb-lab">Move</span>
        <select id="lMvP" aria-label="Panel">${Array.from({ length: nP }, (_, k) => `<option value="${k + 1}" ${p.panel === k + 1 ? 'selected' : ''}>P${k + 1}</option>`).join('')}</select>
        <button type="button" class="btn small" id="lMvL" aria-label="Move left">◀</button>
        <input type="text" id="lMvS" value="${esc(show(p.start))}" aria-label="Start in inches from the left edge" title="Inches from the left edge of the blank">
        <button type="button" class="btn small" id="lMvR" aria-label="Move right">▶</button>
        <button type="button" class="btn small" id="lMvU" aria-label="Move up">▲</button><button type="button" class="btn small" id="lMvD" aria-label="Move down">▼</button>
        <button type="button" class="btn small" id="lCtrH" title="Center left-right in its panel">Center ↔</button><button type="button" class="btn small" id="lCtrV" title="Center top-to-bottom in its panel">Center ↕</button></div>
      <div class="sb-row sel-space"><span class="sb-lab">Space (in)</span>${[['left', 'Left', '#c0392b'], ['right', 'Right', '#c0392b'], ['top', 'Top', '#1565c0'], ['bottom', 'Bottom', '#1565c0']].map(([k, n, c]) => `<label style="color:${c}">${n} <input type="text" data-space="${k}" aria-label="${n} space in inches" title="Type the inches (3:05, 3 5/16 or 3.31) and press Enter"></label>`).join('')}</div>
      <div class="sb-row"><span class="sb-lab">Text</span>
        <button type="button" class="btn small" id="lFsDn" aria-label="Smaller text"${dis(isB)}>A−</button><span class="fs-val">${isB ? '–' : isT ? textFs(p) : +p.fsz > 0 ? p.fsz : 'Auto'}</span><button type="button" class="btn small" id="lFsUp" aria-label="Bigger text"${dis(isB)}>A+</button><button type="button" class="btn small ghost" id="lFsAuto"${dis(!(isP && +p.fsz > 0))}>Auto</button>
        <span class="sb-gap"></span>${['left', 'center', 'right'].map((a) => `<button type="button" class="btn small" data-ta="${a}" aria-pressed="${!isB && ta === a}"${dis(isB)}>${a === 'left' ? 'Left' : a === 'center' ? 'Center' : 'Right'}</button>`).join('')}
        <span class="sb-gap"></span><button type="button" class="btn small" id="lEditSel"${dis(isB)}>Edit text</button></div>
      <div class="sb-row"><span class="sb-lab">Turn</span>
        <button type="button" class="btn small sb-turn" id="lTurn" title="Turn the copy a quarter turn (upright → sideways ↓ → upside down → sideways ↑)">Turn 90° <span class="hint">(${TURNS.find(([a]) => a === angleOf(p))[1]})</span></button>
        <button type="button" class="btn small" id="lFlip" aria-pressed="${angleOf(p) === 180}">Upside down</button></div>
      <div class="sb-row"><span class="sb-lab">Plate</span>
        <button type="button" class="btn small sb-w1" id="lDims"${dis(isT)}>${p.nodim ? 'Show distances' : 'Hide distances'}</button>
        <button type="button" class="btn small sb-w1" id="lSize"${dis(!isP)}>${p.nosize ? 'Show plate size' : 'Hide plate size'}</button>
        <button type="button" class="btn small sb-w1" id="lHl">${p.hl ? 'Remove highlight' : 'Highlight'}</button>
        <label class="btn small sb-w2${isP ? '' : ' is-off'}">${p.img ? 'Change image' : 'Add image'}<input type="file" accept="image/*" hidden id="lSelImg"${dis(!isP)}></label>
        <button type="button" class="btn small" id="lKeep" aria-pressed="${!!p.keepShape}"${dis(!keepOk)} title="Off: the logo fills the plate Width × Length. On: the logo keeps its own shape inside the box.">Keep logo shape</button></div>
      <div class="sb-row sb-end"><button type="button" class="btn small" id="lDup">Duplicate</button><button type="button" class="btn small danger" id="lDelSel">Delete</button><button type="button" class="btn small ghost" id="lDone">Done</button></div>`;
    $('#lHl').onclick = () => { p.hl = !p.hl; paintPlates(); update(); };
    $('#lMvP').onchange = (e) => { p.panel = +e.target.value; p.dy = 0; paintPlates(); update(); };
    $('#lMvL').onclick = () => nudge(-0.5);
    $('#lMvR').onclick = () => nudge(0.5);
    $('#lMvU').onclick = () => movePanel(-1);
    $('#lCtrH').onclick = () => centerItem(sel);
    const stepFs = (d) => { const cur = p.kind === 'text' ? textFs(p) : +p.fsz > 0 ? +p.fsz : autoFs[sel] || 8; p.fsz = clampFs(cur + d); paintPlates(); update(); };
    if ($('#lFsDn')) { $('#lFsDn').onclick = () => stepFs(-1); $('#lFsUp').onclick = () => stepFs(1); }
    if ($('#lFsAuto')) $('#lFsAuto').onclick = () => { p.fsz = ''; paintPlates(); update(); };
    $$('[data-ta]', bar).forEach((b) => b.onclick = () => { p.ta = b.dataset.ta; paintPlates(); update(); });
    $('#lCtrV').onclick = () => { p.dy = 0; paintPlates(); update(); };
    $('#lMvD').onclick = () => movePanel(1);
    $('#lMvS').onchange = (e) => { const v = pin(e.target.value); if (isFinite(v)) { p.start = e.target.value.trim(); nudge(0); } };
    $('#lSize').onclick = () => { p.nosize = !p.nosize; paintPlates(); update(); };
    if ($('#lDims')) $('#lDims').onclick = () => { p.nodim = !p.nodim; paintPlates(); update(); };
    if ($('#lEditSel')) $('#lEditSel').onclick = () => { const g = $(`#lSheet [data-pi="${sel}"]`); openEditor('item:' + sel, g || $('#lSheet')); };
    // fill the space boxes after the sheet is drawn (heights come from the drawing)
    const fillSpaces = () => { const sp = spaces(p), q = fmtFor(L).q; $$('[data-space]', bar).forEach((i) => { if (document.activeElement !== i) i.value = isFinite(sp[i.dataset.space]) ? q(Math.max(0, sp[i.dataset.space])) : ''; }); };
    requestAnimationFrame(fillSpaces);
    $$('[data-space]', bar).forEach((i) => {
      i.onchange = () => { if (setSpace(p, i.dataset.space, inOf(i.value))) { paintPlates(); update(); } else fillSpaces(); };
      i.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } e.stopPropagation(); };
    });
    $('#lDelSel').onclick = () => delPlate(sel);
    $('#lDup').onclick = () => duplicate(sel);
    $('#lFlip').onclick = () => { setAngle(p, angleOf(p) === 180 ? 0 : 180); paintPlates(); update(); };
    $('#lTurn').onclick = () => { setAngle(p, angleOf(p) + 90); paintPlates(); update(); };
    if ($('#lKeep')) $('#lKeep').onclick = () => { p.keepShape = !p.keepShape; paintPlates(); update(); };
    if ($('#lSelImg')) $('#lSelImg').onchange = (e) => { const f0 = e.target.files[0]; if (f0) addImage(sel, f0); };
    $('#lDone').onclick = () => select(-1);
  } else if (undo) {
    bar.innerHTML = `<span>Deleted.</span><span class="btn-row"><button type="button" class="btn small" id="lUndo">Undo</button></span>`;
    $('#lUndo').onclick = () => { L.plates.splice(Math.min(undo.i, L.plates.length), 0, undo.p); const i = undo.i; undo = null; select(i); };
  } else bar.innerHTML = L.plates.length ? '<span class="hint">Drag a print, BMC or text to move it, or tap it and use the arrow keys / Move controls. Tap any words on the sheet to change them.</span>' : '';
}

function fill() {
  setTimeout(paintOrig, 0);
  $$('[data-l]', view).forEach((el) => { el.value = L[el.dataset.l] ?? ''; });
  if (!Array.isArray(L.details)) L.details = [];
  if (!Array.isArray(L.detailTexts)) L.detailTexts = L.detailText ? [L.detailText] : []; // older drafts had one text
  delete L.detailText;
  if (L.detailLogos === undefined) L.detailLogos = true;
  $('#lDetLogos').checked = !!L.detailLogos;
  paintDetails();
  paintPlates();
  update();
}

function onInput(e) {
  const t = e.target;
  const typed = t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['checkbox', 'file', 'radio'].includes(t.type));
  // Typed boxes are handled as you type ("input"); dropdowns and checkboxes when picked ("change"). Handling both would
  // redraw the sheet a second time when a box loses focus, right under the mouse, and swallow the click on the sheet.
  if (typed ? e.type !== 'input' : e.type !== 'change') return;
  histTyping = typed;
  if (t.dataset.img !== undefined) { if (e.type === 'change' && t.files[0]) addImage(+t.dataset.img, t.files[0]); return; }
  if (t.dataset.l) { L[t.dataset.l] = t.value; if (t.dataset.l === 'widthPanels') paintPP(); update(); return; }
  const row = t.closest('[data-plate]');
  if (row) {
    const p = L.plates[+row.dataset.plate];
    const k = t.dataset.p;
    if (!p || !k) return;
    if (k === 'dims') { p.nodim = !t.checked; update(); return; }
    if (k === 'size') { p.nosize = !t.checked; update(); return; }
    if (k === 'turn') { setAngle(p, +t.value); update(); return; }
    if (k === 'fsz') { p.fsz = t.value === '' ? '' : clampFs(t.value); update(); return; }
    p[k] = k === 'flip' || k === 'hl' ? t.checked : k === 'panel' ? +t.value : t.value;
    if (k === 'test' || k === 'wall') { const r = BMC[p.wall === 'double' ? 'double' : 'single'][p.test === 'Mullen' ? 'Mullen' : 'ECT']; if (!r[p.rating]) p.rating = p.test === 'Mullen' ? (p.wall === 'double' ? '275' : '200') : (p.wall === 'double' ? '48' : '32'); }
    if (k === 'test' || k === 'wall' || k === 'rating') { paintPlates(); }
    update();
  }
}

function update() {
  saveDraft();
  snap();
  const wp = nums(L.widthPanels), lp = nums(L.lengthPanels), bw = pin(L.blankW), bl = pin(L.blankL);
  const chk = (a, b, what) => !a.length ? '' : `Adds up to <b>${f(sum(a))}"</b>${isFinite(b) ? (near(sum(a), b) ? ` <span class="pill ok">matches the blank ${what}</span>` : ` <span class="pill warn">blank ${what} is ${f(b)}"</span>`) : ''}`;
  $('#lWChk').innerHTML = chk(wp, bw, 'width');
  $('#lLChk').innerHTML = lp.length ? chk(lp, bl, 'length').replace(/<span class="pill warn">blank length is ([^<]+)<\/span>/, (m, x) => `<span class="hint">scored length · blank is ${x}</span>`) : '';
  paintPP();
  $('#lSheet').innerHTML = sheetHtml(L, sel);
  paintWarn();
  paintSelBar();
  fit();
}

// ---- sheet geometry in inches (same rules as the drawing) ----
function geom(d = L) {
  const wp = nums(d.widthPanels), lp = nums(d.lengthPanels), bl = pin(d.blankL), bw = pin(d.blankW);
  const rows = wp.length ? wp : [isFinite(bw) && bw > 0 ? bw : 1];
  const totL = lp.length ? sum(lp) : (isFinite(bl) && bl > 0 ? bl : 100);
  const scores = [0]; lp.forEach((v) => scores.push(scores[scores.length - 1] + v));
  const tab = rows.length >= 2 && lp.length >= 4 && (d.glueTab === 'on' || (d.glueTab !== 'off' && lp[0] > 0 && lp[0] <= 2.5));
  const flap = new Set(!tab ? [] : rows.length >= 3 ? [0, rows.length - 1] : [rows[0] <= rows[1] ? 0 : 1]);
  const pxIn = 786 / totL; // drawing scale (x1 - x0 = 786)
  return { wp, lp, rows, totL, scores, tab, flap, pxIn };
}
// Inches an item covers along the length: [start, end]
function span(p, g) {
  const s = pin(p.start);
  if (!isFinite(s)) return null;
  let w;
  if (p.kind === 'bmc') w = 1;
  else if (p.kind === 'text') w = textAlongPx(p) / g.pxIn;
  else w = isFinite(pin(p.width)) && pin(p.width) > 0 ? pin(p.width) : g.totL * 0.1;
  return [s, s + w];
}
const itemName = (p) => (p.kind === 'bmc' ? 'BMC' : p.kind === 'text' ? `Text "${String(p.text || '').split('\n')[0].slice(0, 22)}"` : `Plate${p.text ? ` "${String(p.text).split('\n')[0].slice(0, 22)}"` : ''}`);

// ---- placement warnings: crossing a score, off the blank, on the glue tab, overlapping, no width ----
function placementWarnings() {
  const g = geom(), out = [], tol = 1 / 32;
  const items = L.plates.map((p, i) => ({ p, i, sp: span(p, g) }));
  items.forEach(({ p, i, sp }) => {
    if (!sp) return;
    const [a, b] = sp, who = `${itemName(p)} on P${p.panel}`;
    if (p.kind === 'plate' && !(isFinite(pin(p.width)) && pin(p.width) > 0)) out.push({ i, msg: `${who} has no width. Fill in Width so the distances are right.` });
    if (a < -tol || b > g.totL + tol) out.push({ i, msg: `${who} runs off the end of the blank.` });
    if (g.tab && g.flap.has(p.panel - 1) && a < g.lp[0] - tol) out.push({ i, msg: `${who} is beside the ${jointName(L).toLowerCase()} tab, where there is no flap.` });
    else if (g.tab && a < g.lp[0] - tol && p.kind !== 'text') out.push({ i, msg: `${who} sits on the ${jointName(L).toLowerCase()} tab.` });
    const sc = g.scores.slice(1, -1).find((x) => x > a + tol && x < b - tol);
    if (sc !== undefined && !(g.tab && sc === g.lp[0] && a < g.lp[0] - tol)) out.push({ i, msg: `${who} crosses the ${g.flap.has(p.panel - 1) ? 'slot' : 'score'} at ${f(sc)}".` });
  });
  for (let x = 0; x < items.length; x++) for (let y = x + 1; y < items.length; y++) {
    const A = items[x], B = items[y];
    if (!A.sp || !B.sp || A.p.panel !== B.p.panel || A.p.kind === 'text' && B.p.kind === 'text') continue;
    const ov = Math.min(A.sp[1], B.sp[1]) - Math.max(A.sp[0], B.sp[0]);
    if (ov > 1 / 16 && Math.abs((+A.p.dy || 0) - (+B.p.dy || 0)) < 0.3) out.push({ i: B.i, msg: `${itemName(A.p)} and ${itemName(B.p)} overlap on P${A.p.panel}.` });
  }
  return out;
}
function paintWarn() {
  const box = $('#lWarn');
  if (!box) return;
  const w = placementWarnings();
  box.innerHTML = w.length ? `<div class="alert warn lay-warn"><b>Check placement</b> <span class="hint">(not printed)</span><ul>${w.slice(0, 8).map((x) => `<li><a href="#" data-wsel="${x.i}">${esc(x.msg)}</a></li>`).join('')}</ul></div>` : '';
  $$('[data-wsel]', box).forEach((a) => a.onclick = (e) => { e.preventDefault(); select(+a.dataset.wsel); });
}

// ---- duplicate: copy an item onto the next panel of the same size, same spot within it ----
// Center an item left-right inside the length panel it sits in (the panel under its middle).
function centerItem(i) {
  const p = L.plates[i];
  if (!p) return;
  const g = geom(), sp = span(p, g);
  if (!sp) return;
  const w = sp[1] - sp[0], mid = (sp[0] + sp[1]) / 2;
  let a = 0, b = g.totL;
  if (g.lp.length) { const k = Math.max(0, g.scores.findIndex((x, j) => j < g.lp.length && mid >= x - 1e-6 && mid < g.scores[j + 1] + 1e-6)); a = g.scores[k]; b = g.scores[k + 1]; }
  p.start = f(Math.round(Math.max(a, a + (b - a - w) / 2) * 16) / 16);
  paintPlates(); update();
}

function duplicate(i) {
  const p = L.plates[i];
  if (!p) return;
  const g = geom(), c = JSON.parse(JSON.stringify(p));
  const s = pin(p.start), sp = span(p, g);
  if (isFinite(s) && g.lp.length) {
    const k = g.scores.findIndex((x, j) => j < g.lp.length && s >= x - 1e-6 && s < g.scores[j + 1] - 1e-6);
    const len = g.lp[k], off = s - g.scores[k];
    const same = g.lp.map((v, j) => j).filter((j) => j !== k && Math.abs(g.lp[j] - len) <= 0.13);
    const taken = (j) => L.plates.some((q) => q !== p && q.panel === p.panel && (q.kind || 'plate') === (p.kind || 'plate') && isFinite(pin(q.start)) && pin(q.start) >= g.scores[j] - 1e-6 && pin(q.start) < g.scores[j + 1] - 1e-6);
    const j = same.find((x) => x > k && !taken(x)) ?? same.find((x) => !taken(x));
    if (j !== undefined) c.start = f(Math.round((g.scores[j] + Math.min(off, g.lp[j] - (sp ? sp[1] - sp[0] : 0))) * 16) / 16);
    else if (sp) c.start = f(Math.min(g.totL - (sp[1] - sp[0]), sp[1] + 1));
  } else if (sp) c.start = f(sp[1] + 1);
  L.plates.splice(i + 1, 0, c);
  sel = i + 1; undo = null;
  paintPlates(); update();
}

function paintPP() {
  const n = Math.max(nums(L.widthPanels).length, 1);
  L.printPanels = L.printPanels.filter((p) => p <= n);
  const box = $('#lPP');
  const html = Array.from({ length: n }, (_, i) => `<button type="button" data-pp="${i + 1}" aria-pressed="${L.printPanels.includes(i + 1)}">P${i + 1}</button>`).join('');
  if (box.innerHTML !== html) {
    box.innerHTML = html;
    $$('[data-pp]', box).forEach((b) => b.onclick = () => {
      const k = +b.dataset.pp;
      L.printPanels = L.printPanels.includes(k) ? L.printPanels.filter((x) => x !== k) : [...L.printPanels, k].sort((a, c) => a - c);
      update();
    });
  }
}

function paintPlates() {
  const n = Math.max(nums(L.widthPanels).length, 1);
  const opt = (v, cur, label = v) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
  $('#lPlates').innerHTML = L.plates.length ? L.plates.map((p, i) => {
    const kind = p.kind || 'plate';
    const head = `<div class="field"><label>${kind === 'bmc' ? 'BMC on' : kind === 'text' ? 'Text on' : 'Panel'}</label><select data-p="panel">${Array.from({ length: Math.max(n, p.panel) }, (_, k) => opt(k + 1, p.panel, 'P' + (k + 1))).join('')}</select></div>
      <div class="field"><label>Start (in)</label><input type="text" inputmode="decimal" data-p="start" value="${esc(p.start)}"></div>`;
    // Each row: fields across the top, then the copy box, picture buttons and the options line.
    let top = '', body = '';
    if (kind === 'bmc') {
      const b = bmcOf(p), ratings = Object.keys(BMC[b.w][b.tst]);
      if (b.v && !ratings.includes(b.v)) ratings.unshift(b.v);
      top = `<div class="field"><label>Test</label><select data-p="test">${opt('ECT', b.tst)}${opt('Mullen', b.tst, 'Mullen (burst)')}</select></div>
        <div class="field"><label>Wall</label><select data-p="wall">${opt('single', b.w, 'Single')}${opt('double', b.w, 'Double')}</select></div>
        <div class="field"><label>Rating</label><select data-p="rating">${ratings.map((r) => opt(r, b.v, b.tst === 'ECT' ? r + ' ECT' : r + ' lb')).join('')}</select></div>`;
      body = `<div class="hint bmc-vals">${b.row ? `Size limit ${b.row[1]}" · Gross wt ${b.row[0]} lbs${b.row[2] ? ` · Facings ${b.row[2]} lbs/MSF` : ''}` : 'Not a standard rating. Check the values on the stamp.'}</div>`;
    } else if (kind === 'text') {
      top = `<div class="field"><label>Font size</label><input type="number" min="4" max="40" step="0.5" data-p="fsz" value="${textFs(p)}"></div><div class="field"><label>Text align</label><select data-p="ta">${opt('left', p.ta || 'left', 'Left')}${opt('center', p.ta || 'left', 'Center')}${opt('right', p.ta || 'left', 'Right')}</select></div>`;
      body = `<div class="field"><label>Text</label><textarea data-p="text" rows="2" placeholder="Type anything (Enter = new line)">${esc(p.text)}</textarea></div>`;
    } else {
      top = `<div class="field"><label>Width (in)</label><input type="text" inputmode="decimal" data-p="width" value="${esc(p.width)}"></div><div class="field"><label>Length (in)</label><input type="text" inputmode="decimal" data-p="plen" value="${esc(p.plen || '')}" placeholder="Auto" title="Plate size top to bottom (across the panel). Blank = fit the copy."></div><div class="field"><label>Font size</label><input type="number" min="4" max="40" step="0.5" data-p="fsz" value="${+p.fsz > 0 ? p.fsz : ''}" placeholder="Auto"></div><div class="field"><label>Text align</label><select data-p="ta">${opt('left', p.ta || 'center', 'Left')}${opt('center', p.ta || 'center', 'Center')}${opt('right', p.ta || 'center', 'Right')}</select></div>`;
      body = `<div class="field"><label>Copy on the plate</label><textarea data-p="text" rows="2">${esc(p.text)}</textarea></div>
        <div class="plate-img">${p.img ? `<img src="${p.img}" alt="Logo">` : ''}<label class="btn small">${p.img ? 'Change image' : 'Add image'}<input type="file" accept="image/*" hidden data-img="${i}"></label>${p.img ? `<button type="button" class="btn small ghost" data-noimg="${i}">Remove image</button>` : ''}</div>`;
    }
    return `
    <div class="plate-row k-${kind}${i === sel ? ' sel' : ''}" data-plate="${i}">
      <div class="pr-top">${head}${top}</div>
      ${body}
      <div class="pr-opts">
        <label class="chk">Turn <select data-p="turn">${TURNS.map(([a, n]) => `<option value="${a}" ${angleOf(p) === a ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" data-p="hl" ${p.hl ? 'checked' : ''}> Highlight</label>
        ${kind !== 'text' ? `<label class="chk"><input type="checkbox" data-p="dims" ${p.nodim ? '' : 'checked'}> Distances</label>` : ''}
        ${kind === 'plate' ? `<label class="chk"><input type="checkbox" data-p="size" ${p.nosize ? '' : 'checked'}> Plate size</label>` : ''}
        <button type="button" class="btn small ghost" data-dup="${i}">Duplicate</button>
        <button type="button" class="btn small ghost danger" data-del="${i}" aria-label="Remove">✕</button>
      </div>
    </div>`; }).join('') : '<p class="hint" style="margin:0">Nothing on the sheet yet.</p>';
  $$('[data-del]', $('#lPlates')).forEach((b) => b.onclick = () => delPlate(+b.dataset.del));
  $$('[data-dup]', $('#lPlates')).forEach((b) => b.onclick = () => duplicate(+b.dataset.dup));
  $$('[data-noimg]', $('#lPlates')).forEach((b) => b.onclick = () => { const p = L.plates[+b.dataset.noimg]; if (p) { p.img = ''; paintPlates(); update(); } });
}

function fit() {
  const wrap = $('#lWrap'), sh = wrap && wrap.firstElementChild && wrap.querySelector('.lsheet');
  if (!sh) return;
  const k = Math.min(1, wrap.clientWidth / 1000);
  sh.style.transform = `scale(${k})`;
  wrap.style.height = Math.ceil(sh.offsetHeight * k) + 'px';
}

// ---- logo images on plates ----
// Shrink a canvas region to a small JPEG data URL (max 520 px wide), trimming white margins; rotate 180° when asked.
function toLogo(src, sx, sy, sw, sh, flip = false, stripLines = false, rot = 0) {
  sx = Math.max(0, Math.round(sx)); sy = Math.max(0, Math.round(sy));
  sw = Math.min(src.width - sx, Math.round(sw)); sh = Math.min(src.height - sy, Math.round(sh));
  if (sw < 4 || sh < 4) return '';
  if (stripLines) {
    // drop straight drawing lines (old plate borders / score lines) that run along the edges of a cut-out
    const px = src.getContext('2d').getImageData(sx, sy, sw, sh).data;
    const dark = (x, y) => { const i = (y * sw + x) * 4; return px[i] + px[i + 1] + px[i + 2] < 520; };
    // a 3-pixel strip, so slightly wavy hand-drawn lines count too
    const colLine = (x) => { let n = 0; for (let y = 0; y < sh; y++) if (dark(x, y) || (x > 0 && dark(x - 1, y)) || (x < sw - 1 && dark(x + 1, y))) n++; return n > sh * 0.5; };
    const rowLine = (y) => { let n = 0; for (let x = 0; x < sw; x++) if (dark(x, y) || (y > 0 && dark(x, y - 1)) || (y < sh - 1 && dark(x, y + 1))) n++; return n > sw * 0.5; };
    let l = 0, r = sw - 1, t = 0, b = sh - 1;
    for (let x = 0; x < sw * 0.22; x++) if (colLine(x)) l = x + 1;
    for (let x = sw - 1; x > sw * 0.78; x--) if (colLine(x)) r = x - 1;
    for (let y = 0; y < sh * 0.18; y++) if (rowLine(y)) t = y + 1;
    for (let y = sh - 1; y > sh * 0.82; y--) if (rowLine(y)) b = y - 1;
    if (r - l > 8 && b - t > 8) { sx += l; sy += t; sw = r - l + 1; sh = b - t + 1; }
  }
  // trim near-white margins
  const d = src.getContext('2d').getImageData(sx, sy, sw, sh).data;
  let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = (y * sw + x) * 4;
    if (d[i] + d[i + 1] + d[i + 2] < 600) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 > x0 && y1 > y0) { const m = 3; sx += Math.max(0, x0 - m); sy += Math.max(0, y0 - m); sw = Math.min(x1 - x0 + 2 * m, src.width - sx); sh = Math.min(y1 - y0 + 2 * m, src.height - sy); }
  // turn the cut-out upright (pages scanned sideways), plus 180° for plates printed upside down
  const turn = ((Math.round((+rot || 0) / 90) * 90) + (flip ? 180 : 0)) % 360;
  const side = turn === 90 || turn === 270;
  const k = Math.min(1, 520 / (side ? sh : sw));
  const dw = Math.max(1, Math.round(sw * k)), dh = Math.max(1, Math.round(sh * k));
  const c = document.createElement('canvas');
  c.width = side ? dh : dw; c.height = side ? dw : dh;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2); g.rotate((turn * Math.PI) / 180); g.translate(-dw / 2, -dh / 2);
  g.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
  return c.toDataURL('image/jpeg', 0.85);
}
function paintDetails() {
  const tb = $('#lDetTexts');
  if (tb) {
    tb.innerHTML = L.detailTexts.map((x, i) => `<div class="det-text"><textarea rows="3" data-dtx="${i}" placeholder="e.g. Fabri-Cote address, Black ink only">${esc(x)}</textarea><button type="button" class="btn small ghost danger" data-dtrm="${i}" aria-label="Remove text box">✕</button></div>`).join('');
    $$('[data-dtx]', tb).forEach((ta) => ta.oninput = () => { L.detailTexts[+ta.dataset.dtx] = ta.value; histTyping = true; update(); });
    $$('[data-dtrm]', tb).forEach((b) => b.onclick = () => { L.detailTexts.splice(+b.dataset.dtrm, 1); paintDetails(); update(); });
    const add = $('#lDetTextAdd'); if (add) add.disabled = L.detailTexts.length >= 4;
  }
  const box = $('#lDetPics');
  if (!box) return;
  box.innerHTML = L.details.map((d, i) => `<div class="det-pic"><img src="${d.img}" alt="Close-up"><input type="text" data-dcap="${i}" value="${esc(d.caption || '')}" placeholder="Caption (optional)"><button type="button" class="btn small ghost danger" data-drm="${i}" aria-label="Remove picture">✕</button></div>`).join('');
  $$('[data-drm]', box).forEach((b) => b.onclick = () => { L.details.splice(+b.dataset.drm, 1); paintDetails(); update(); });
  $$('[data-dcap]', box).forEach((inp) => inp.oninput = () => { L.details[+inp.dataset.dcap].caption = inp.value; histTyping = true; update(); });
}
async function addDetail(file) {
  try {
    if (!file.type.startsWith('image/')) throw new Error('Pick a picture (JPG or PNG) of the logo.');
    if (L.details.length >= 3) throw new Error('The detail box holds up to 3 pictures. Remove one first.');
    const c = await pageCanvas(file, 1, 1400);
    L.details.push({ img: toLogo(c, 0, 0, c.width, c.height, false), caption: '' });
    paintDetails(); update();
  } catch (e) { alert(e.message); }
}

async function addImage(i, file) {
  const p = L.plates[i];
  if (!p) return;
  try {
    if (!file.type.startsWith('image/')) throw new Error('Pick a picture (JPG or PNG) of the logo.');
    const c = await pageCanvas(file, 1, 1200);
    p.img = toLogo(c, 0, 0, c.width, c.height, false);
    paintPlates(); update();
  } catch (e) { alert(e.message); }
}
// After a read: cut each plate's logo out of the uploaded pages, using the box the AI gave.
async function cutLogos(files, aiPlates) {
  const pages = {};
  let n = 0;
  for (let i = 0; i < aiPlates.length; i++) {
    const src = aiPlates[i] && aiPlates[i].source, p = L.plates.find((x) => x._ai === i);
    const b = src && Array.isArray(src.box) && src.box.map(Number);
    if (!p || !b || b.length !== 4 || b.some((v) => !isFinite(v)) || b[2] <= b[0] || b[3] <= b[1]) continue;
    const fi = Math.max(1, Math.min(files.length, parseInt(src.file, 10) || 1)) - 1, pg = Math.max(1, parseInt(src.page, 10) || 1);
    const key = fi + ':' + pg;
    try {
      if (!pages[key]) pages[key] = await pageCanvas(files[fi], pg, 2400);
      const c = pages[key], W = c.width, H = c.height;
      const padX = (b[2] - b[0]) * 0.06 * W, padY = (b[3] - b[1]) * 0.08 * H;
      const url = toLogo(c, b[0] * W - padX, b[1] * H - padY, (b[2] - b[0]) * W + 2 * padX, (b[3] - b[1]) * H + 2 * padY, !!p.flip, true, +src.rotation || 0);
      if (url) { p.img = url; n++; }
    } catch (e) { console.warn('logo cut', e); }
  }
  L.plates.forEach((p) => delete p._ai);
  return n;
}

// ---- edit text right on the sheet ----
const LABELS = { customer: 'Customer', shipTo: 'Ship to', fileNo: 'File #', design: 'Design no.', ident: 'Ident', style: 'Style', size: 'Size (L × W × D)', board: 'Board / flute',
  blank: 'Blank size (width x length)',  print: 'Print / ink', routing: 'Routing', view: 'View', origDate: 'Original date', revDate: 'Revision date', sales: 'Sales', designer: 'Designer', approved: 'Approved by' };
function editValue(key) {
  if (key === 'blank') return L.blankW || L.blankL ? `${show(L.blankW)} x ${show(L.blankL)}` : '';
  const [k, i] = key.split(':');
  if (k === 'notes' || k === 'changes') return i === 'new' ? '' : L[k].split('\n').map((x) => x.trim()).filter(Boolean)[+i] || '';
  if (k === 'item') return (L.plates[+i] || {}).text || '';
  if (k === 'dtext') return i === 'new' ? '' : L.detailTexts[+i] || '';
  return L[key] ?? '';
}
function setValue(key, v) {
  v = v.trim();
  if (key === 'blank') { const m = v.split(/\s*[x×X]\s*/); L.blankW = m[0] || ''; L.blankL = m[1] || ''; return; }
  const [k, i] = key.split(':');
  if (k === 'notes' || k === 'changes') {
    const arr = L[k].split('\n').map((x) => x.trim()).filter(Boolean);
    if (i === 'new') { if (v) arr.push(v); } else if (v) arr[+i] = v; else arr.splice(+i, 1);
    L[k] = arr.join('\n'); return;
  }
  if (k === 'dtext') { const lines = v.split('\n').map((x) => x.trimEnd()).join('\n').trim(); if (i === 'new') { if (lines && L.detailTexts.length < 4) L.detailTexts.push(lines); } else if (lines) L.detailTexts[+i] = lines; else L.detailTexts.splice(+i, 1); return; }
  if (k === 'item') { if (L.plates[+i]) L.plates[+i].text = v.split('\n').map((x) => x.trim()).filter(Boolean).join('\n'); return; }
  L[key] = key === 'view' ? (/^in/i.test(v) ? 'Inside' : 'Outside') : v;
}
function openEditor(key, anchor) {
  closeEditor();
  const card = $('.lay-preview'), cr = card.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
  const [k, i] = key.split(':');
  const label = k === 'dtext' ? (i === 'new' ? 'New text box' : 'Text box ' + (+i + 1)) : k === 'notes' ? (i === 'new' ? 'New note' : 'Note ' + (+i + 1)) : k === 'changes' ? (i === 'new' ? 'New change' : 'Change line') : k === 'item' ? ((L.plates[+i] || {}).kind === 'text' ? 'Text' : 'Copy on the plate') : LABELS[key] || key;
  const multi = k === 'item' || k === 'dtext'; // text items and plate copy can have several lines
  const long = multi || k === 'notes' || k === 'changes' || key === 'customer' || key === 'shipTo';
  const box = document.createElement('div');
  box.className = 'sheet-editor';
  box.innerHTML = `<div class="lbl">${esc(label)}</div>${long ? '<textarea rows="3"></textarea>' : '<input type="text">'}${multi ? '<div class="hint">Enter = new line. Save when done.</div>' : ''}
    <div class="btn-row"><button type="button" class="btn small primary" data-ok>Save</button><button type="button" class="btn small ghost" data-x>Cancel</button>${(k === 'notes' || k === 'changes') && i !== 'new' ? '<button type="button" class="btn small ghost danger" data-rm>Delete line</button>' : ''}</div>`;
  card.appendChild(box);
  const w = Math.min(380, cr.width - 16);
  box.style.width = w + 'px';
  box.style.left = Math.max(8, Math.min(ar.left - cr.left, cr.width - w - 8)) + 'px';
  box.style.top = (ar.bottom - cr.top + 4) + 'px';
  const f = box.querySelector('input,textarea');
  f.value = editValue(key);
  f.focus(); f.select();
  const ok = () => { setValue(key, f.value); closeEditor(); fill(); };
  box.querySelector('[data-ok]').onclick = ok;
  box.querySelector('[data-x]').onclick = closeEditor;
  const rm = box.querySelector('[data-rm]'); if (rm) rm.onclick = () => { setValue(key, ''); closeEditor(); fill(); };
  f.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (!multi && !e.shiftKey))) { e.preventDefault(); ok(); }
    else if (e.key === 'Escape') closeEditor();
  });
}
function closeEditor() { $$('.sheet-editor').forEach((b) => b.remove()); }

// ---- resize a plate with its handles ----
function startResize(e) {
  const hd = e.target.closest('[data-hpi]'), svg = hd.ownerSVGElement, p = L.plates[+hd.dataset.hpi];
  if (!svg || !p) return;
  e.preventDefault(); e.stopPropagation();
  // the drawing is redrawn while dragging, so convert with whichever <svg> is on screen now
  const toSvg = (ev) => { const cur = $('#lSheet svg') || svg, pt = cur.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; return pt.matrixTransform(cur.getScreenCTM().inverse()); };
  const a = toSvg(e), pxIn = (+svg.dataset.x1 - +svg.dataset.x0) / +svg.dataset.totl;
  const rows = svg.dataset.rows.split(';').map((r) => r.split(',').map(Number)), rh = (rows[p.panel - 1] || rows[0])[1];
  const rowIn = (svg.dataset.rowsin || '').split(',').map(Number)[p.panel - 1]; // panel size in inches, to turn the dragged height into inches
  const box = svg.querySelector(`[data-pi="${hd.dataset.hpi}"] .ls-pbox`);
  const w0 = isFinite(pin(p.width)) && pin(p.width) > 0 ? pin(p.width) : (box ? +box.getAttribute('width') / pxIn : 10);
  const h0 = box ? +box.getAttribute('height') : rh * 0.6;
  const kind = hd.dataset.handle;
  let raf = 0;
  hd.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const b = toSvg(ev);
    if (kind === 'w') p.width = f(Math.max(1, Math.round((w0 + (b.x - a.x) / pxIn) * 16) / 16));
    else {
      const share = Math.max(0.1, Math.min(0.98, (h0 + 2 * (b.y - a.y)) / rh));
      if (rowIn > 0) { p.plen = f(Math.max(0.5, Math.round(share * rowIn * 16) / 16)); p.hgt = 0; } else p.hgt = Math.round(share * 100) / 100;
    }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; $('#lSheet').innerHTML = sheetHtml(L, sel); }); // at most one redraw per screen frame
  };
  const up = () => {
    hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up);
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    dragged = true; setTimeout(() => (dragged = false), 60);
    paintPlates(); update();
  };
  // the handle is redrawn while dragging, so listen on the document
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}

// ---- drag items on the sheet ----
function startDrag(e) {
  if (e.target.closest('[data-hpi]')) return startResize(e);
  const g = e.target.closest('[data-pi]');
  if (!g || e.button > 0) return;
  const svg = g.ownerSVGElement, p = L.plates[+g.dataset.pi];
  if (!svg || !p) return;
  const toSvg = (ev) => { const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
  const a = toSvg(e), x0 = +svg.dataset.x0, x1 = +svg.dataset.x1, totL = +svg.dataset.totl;
  const rows = svg.dataset.rows.split(';').map((r) => r.split(',').map(Number));
  const pxIn = (x1 - x0) / totL;
  let moved = false, dx = 0, dy = 0;
  g.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const b = toSvg(ev); dx = b.x - a.x; dy = b.y - a.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    if (!moved) { moved = true; svg.classList.add('dragging'); closeEditor(); }
    g.setAttribute('transform', `translate(${dx.toFixed(1)} ${dy.toFixed(1)})`);
  };
  const up = () => {
    g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
    svg.classList.remove('dragging');
    if (!moved) return;
    dragged = true; setTimeout(() => (dragged = false), 60);
    const r0 = rows[p.panel - 1] || rows[0];
    const y = r0[0] + r0[1] / 2 + (+p.dy || 0) * r0[1] + dy;
    let k = rows.findIndex(([ry, rh]) => y >= ry && y < ry + rh);
    if (k < 0) k = y < rows[0][0] ? 0 : rows.length - 1;
    const rk = rows[k];
    p.dy = Math.round(Math.max(-0.45, Math.min(0.45, (y - (rk[0] + rk[1] / 2)) / rk[1])) * 100) / 100;
    const w = p.kind === 'plate' && isFinite(pin(p.width)) ? pin(p.width) : 0;
    let s = (isFinite(pin(p.start)) ? pin(p.start) : 0) + dx / pxIn;
    s = Math.max(0, Math.min(totL - w, Math.round(s * 16) / 16));
    p.start = f(s); p.panel = k + 1;
    sel = +g.dataset.pi; undo = null;
    paintPlates(); update();
  };
  g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
}

// ---- AI read ----
// Layout reads take 20–90 s, longer than a normal request may run, so they go through a background job and the page checks back.
async function aiJob(body) {
  const { id } = await api('/api/aijob', { method: 'POST', body: JSON.stringify(body) });
  const t0 = Date.now();
  while (Date.now() - t0 < 4 * 60 * 1000) {
    await new Promise((z) => setTimeout(z, 3000));
    let j;
    try { j = await api('/api/aijob?id=' + encodeURIComponent(id)); } catch (e) { if (/not found|Bad id/i.test(e.message)) throw e; continue; }
    if (j.status === 'done') return j.result;
    if (j.status === 'error') throw new Error(j.error || 'AI request failed. Try again, or enter values by hand.');
  }
  throw new Error('The AI took too long. Try again.');
}
// Place an item from the AI by panel + alignment (hand-drawn layouts are not to scale).
// Returns the start in inches from the left edge of the blank, or null to use the AI's start_in.
function placeStart(src, wIn, lp) {
  const lpN = parseInt(src && src.length_panel, 10);
  if (!lp.length || !(lpN >= 1 && lpN <= lp.length)) return null;
  const left = sum(lp.slice(0, lpN - 1)), len = lp[lpN - 1], right = left + len;
  const w = Math.min(wIn, len);
  const off = src.offset_in !== null && src.offset_in !== undefined && isFinite(+src.offset_in) ? +src.offset_in : null;
  const m = Math.min(1.5, len * 0.08);
  let s;
  if (src.align === 'right') s = right - w - (off ?? m);
  else if (src.align === 'center') s = left + (len - w) / 2;
  else s = left + (off ?? m);
  return Math.round(Math.max(left, Math.min(right - w, s)) * 16) / 16;
}

async function readLayout(input) {
  const files = (Array.isArray(input) ? input : [input]).slice(0, 4);
  const msg = $('#lAiMsg');
  msg.innerHTML = `<div class="alert info"><span class="spinner"></span> Reading ${files.length > 1 ? `${files.length} files` : esc(files[0].name)}… this can take up to a minute.</div>${files.length > 1 ? `<ol class="hint lay-files">${files.map((f, i) => `<li>${esc(f.name)}${i === 0 ? ' <b>(box measurements)</b>' : i === 1 ? ' <b>(print layout)</b>' : ''}</li>`).join('')}</ol>` : ''}`;
  try {
    const list = [];
    for (const f of files) list.push({ ...(await fileToPayload(f)), name: f.name });
    origFiles = files.slice();
    const size = list.reduce((t, x) => t + x.data.length, 0);
    if (size > 5_200_000) throw new Error('Those files are too large together (max about 4 MB). Upload just the print layout, or use photos/screenshots instead of PDFs.');
    const r = await aiJob({ task: 'layout', files: list });
    const str = (x) => (x === null || x === undefined ? '' : String(x).trim());
    const arr = (x) => (Array.isArray(x) ? x : []);
    const n = arr(r.width_panels).length;
    const lp = arr(r.length_panels).map(pin).filter((v) => isFinite(v) && v > 0);
    const totL = lp.length ? sum(lp) : pin(r.blank_length);
    const pxIn = isFinite(totL) && totL > 0 ? 786 / totL : 6; // drawing scale (x1 - x0 = 786)
    const textIn = (txt, fs = 11) => (Math.max(1, ...String(txt || 'TEXT').split('\n').map((x) => x.trim().length)) * fs * 0.6 + 6) / pxIn;
    const startOf = (src, wIn) => { const ps = placeStart(src, wIn, lp); return ps !== null ? fx(ps) : src && src.start_in !== null && src.start_in !== undefined && isFinite(+src.start_in) ? fx(+src.start_in) : ''; };
    const plates = arr(r.plates).map((p, k) => {
      const lpN = parseInt(p.length_panel, 10), seg = lpN >= 1 && lpN <= lp.length ? lp[lpN - 1] : 0;
      const wIn = isFinite(+p.width_in) && +p.width_in > 0 ? +p.width_in : seg ? Math.min(seg * 0.6, 12) : 0;
      return {
        panel: Math.max(1, parseInt(p.panel, 10) || 1), start: startOf(p, wIn || 10),
        width: wIn ? fx(wIn) : '', plen: isFinite(+p.height_in) && +p.height_in > 0 ? fx(+p.height_in) : '', text: str(p.text), ...turnOf(p), kind: 'plate', _ai: k,
      };
    });
    const texts = arr(r.texts).filter((x) => x && str(x.text)).map((x) => ({ kind: 'text', panel: Math.max(1, parseInt(x.panel, 10) || 1), start: startOf(x, [90, 270].includes(+x.turn) ? (Math.max(1, str(x.text).split('\n').filter((y) => y.trim()).length) * 11 * 1.2 + 3.3) / pxIn : textIn(x.text)), text: str(x.text).split('\n').map((y) => y.trim()).filter(Boolean).join('\n'), size: 'M', ...turnOf(x) })).filter((x) => x.start !== '');
    let pp = arr(r.printed_panels).map((x) => parseInt(x, 10)).filter((x) => x >= 1 && (!n || x <= n));
    if (!pp.length) pp = [...new Set(plates.map((p) => p.panel))].sort((a, b) => a - b);
    L = {
      ...EMPTY(),
      customer: str(r.customer), shipTo: str(r.ship_to), fileNo: str(r.file_no), specNo: str(r.spec_no), design: str(r.design_no),
      ident: str(r.ident), style: str(r.style), size: str(r.size), board: str(r.board),
      joint: ['stitch', 'tape'].includes(String(r.joint || '').toLowerCase()) ? String(r.joint).toLowerCase() : '', blankW: show(r.blank_width), blankL: show(r.blank_length), print: str(r.print), routing: str(r.routing),
      view: r.view === 'Inside' ? 'Inside' : 'Outside',
      widthPanels: arr(r.width_panels).map(show).join(', '), lengthPanels: arr(r.length_panels).map(show).join(', '),
      printPanels: pp, plates: [...plates, ...texts], notes: arr(r.notes).map(str).filter(Boolean).join('\n'), changes: arr(r.changes).map(str).filter(Boolean).join('\n'),
      origDate: str(r.original_date), sales: str(r.sales), designer: str(r.designer),
    };
    let bmcMsg = '';
    const bm = r.bmc;
    if (bm && bm.present) {
      const def = bmcFromBoard(L.board);
      const tst = /mullen|burst/i.test(bm.test || '') ? 'Mullen' : /ect/i.test(bm.test || '') ? 'ECT' : def.test;
      const wall = /double/i.test(bm.wall || '') ? 'double' : /single/i.test(bm.wall || '') ? 'single' : def.wall;
      const tl = lp.length ? sum(lp) : pin(L.blankL);
      const bmcIn = 1; // a BMC is 1" round
      const ps = placeStart(bm, bmcIn, lp);
      const hasPos = ps !== null || (bm.start_in !== null && bm.start_in !== undefined && isFinite(+bm.start_in));
      const bp = parseInt(bm.panel, 10);
      const panel = bp >= 1 && (!n || bp <= n) ? bp : (Array.from({ length: n || 1 }, (_, k) => k + 1).find((k) => !pp.includes(k)) || 1);
      const bStart = ps !== null ? ps : hasPos ? +bm.start_in : Math.max(0, (isFinite(tl) ? tl : 60) / 2 - 3);
      const extra = str(bm.extra_text);
      L.plates.push({ kind: 'bmc', panel, start: fx(bStart), test: tst, wall, rating: String(parseInt(bm.value, 10) || def.rating), flip: !!bm.upside_down, nodim: !!extra, dy: extra ? (bm.upside_down ? 0.2 : -0.2) : 0 });
      // size text written with the BMC goes centered under the stamp (above it when upside down)
      if (extra) L.plates.push({ kind: 'text', panel, start: fx(Math.round(Math.max(lp.reduce((a, v) => (a + v <= bStart + 1e-6 ? a + v : a), 0) + 0.25, bStart + 0.5 - textIn(extra) / 2) * 16) / 16), text: extra, size: 'M', flip: !!bm.upside_down, dy: bm.upside_down ? -0.24 : 0.24 });
      const line = `Handwritten BMC note converted to a BMC stamp${bm.written ? ` (old sheet: "${str(bm.written)}")` : ''}.`;
      L.changes = (L.changes ? L.changes + '\n' : '') + line;
      bmcMsg = ` <br>Found a BMC note and made a stamp (${esc(bmcLabel(L.plates.find((x) => x.kind === 'bmc')))}).${hasPos && bm.panel ? '' : ' Its spot was not on the sheet, so it is in the middle of a panel. Move it if needed.'}`;
    }
    L.orig = Object.fromEntries(TRACK.map(([k]) => [k, L[k]]));
    fill();
    const miss = [];
    if (!L.widthPanels) miss.push('panel scores');
    if (!(L.blankW && L.blankL)) miss.push('blank size');
    const low = r.confidence === 'low';
    const done = (logos) => `<div class="alert ${miss.length || low ? 'warn' : 'ok'}">Read the layout.${miss.length ? ` Could not find: ${miss.join(', ')}. Fill those in below.` : ' Check every number against the old sheet.'}${bmcMsg}${logos}${r.unclear ? ` <br><b>Hard to read:</b> ${esc(r.unclear)}` : ''}</div>`;
    msg.innerHTML = done(plates.some((p, k) => r.plates[k] && r.plates[k].source) ? ' <br><span class="spinner"></span> Cutting the logos out of the layout…' : '');
    const got = await cutLogos(files, arr(r.plates));
    if (got) { paintPlates(); update(); }
    msg.innerHTML = done(got ? ` <br>Copied ${got} logo${got > 1 ? 's' : ''} from the layout. If one looks wrong, use Change image or Remove image on that plate.` : plates.length ? ' <br>Logos were not copied. Use Add image on a plate to put the real logo in.' : '');
  } catch (e) {
    msg.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
  }
}


// ---- the sheet ----
function sheetHtml(d, selIdx = -1, opt = {}) {
  const cell = (t, v, k, span = 1) => `<div class="ls-cell" data-edit="${k}"${span > 1 ? ` style="grid-column:span ${span}"` : ''}><span>${t}</span><b>${esc(v) || '&nbsp;'}</b></div>`;
  const F = fmtFor(d).f, sh = (v) => { const x = pin(v); return isFinite(x) ? F(x) : String(v ?? '').trim(); };
  const blank = d.blankW || d.blankL ? `${sh(d.blankW) || '?'} x ${sh(d.blankL) || '?'}` : '';
  const notes = d.notes.split('\n').map((x) => x.trim()).filter(Boolean);
  // close-ups: plate logos (once each) + pictures added for the detail box, at most 3
  const seen = new Set(), pics = [];
  // logos hidden with the × on the sheet: the plate keeps its logo, it just isn't zoomed in
  const hiddenLogos = new Set((d.plates || []).filter((p) => p.kind === 'plate' && p.img && p.nodetail).map((p) => p.img));
  if (d.detailLogos !== false) (d.plates || []).forEach((p, i) => { if (p.kind === 'plate' && p.img && !seen.has(p.img) && !hiddenLogos.has(p.img)) { seen.add(p.img); pics.push({ img: p.img, caption: '', x: 'l' + i }); /* no automatic caption: the logo speaks for itself */ } });
  (d.details || []).forEach((x, k) => x && x.img && pics.push({ img: x.img, caption: x.caption || '', x: 'd' + k }));
  pics.splice(3);
  const allT = Array.isArray(d.detailTexts) ? d.detailTexts : d.detailText ? [d.detailText] : [];
  const dtexts = allT.map((x, k) => ({ x: String(x || ''), k })).filter((o) => o.x.trim()).slice(0, 4);
  const changes = d.changes.split('\n').map((x) => x.trim().replace(/^[-•]\s*/, '')).filter(Boolean);
  const head2 = [d.specNo && `Spec # ${esc(d.specNo)}`, d.fileNo && `File # ${esc(d.fileNo)}`, `<span data-edit="revDate">Revised ${esc(d.revDate) || '—'}</span>`].filter(Boolean).join('&nbsp; | &nbsp;');
  return `<div class="lsheet${opt.print ? ' ls-print' : ''}">
    <div class="ls-top"><div class="ls-title">PRINT LAYOUT SHEET</div><div class="ls-co">GoldenWest Packaging Group&nbsp; | &nbsp;Ontario, CA${head2 ? `<br>${head2}` : ''}</div></div>
    <div class="ls-grid">
      ${cell('CUSTOMER', d.customer, 'customer', 2)}${cell('SHIP TO', d.shipTo, 'shipTo', 3)}${cell('FILE #', d.fileNo, 'fileNo')}${cell('STYLE', d.style, 'style')}${cell('VIEW', d.view, 'view')}
      ${cell('SIZE (L X W X D)', d.size, 'size', 2)}${cell('BOARD / FLUTE', d.board, 'board')}${cell('BLANK SIZE', blank, 'blank', 2)}${cell('PRINT', d.print, 'print', 2)}${cell('ROUTING', d.routing, 'routing')}
    </div>
    <div class="ls-h">BOX LAYOUT &amp; PRINT PLACEMENT <i>${esc(d.view)} view - not to scale (height exaggerated for readability). Dimensions in inches.</i></div>
    ${drawing(d, selIdx, opt.H)}
    <div class="ls-boxes"${opt.boxesH ? ` style="min-height:${opt.boxesH}px"` : ''}>
      <div class="ls-box"><div class="ls-bh">PRINT &amp; PRODUCTION NOTES</div><ol>${notes.map((x, k) => `<li data-edit="notes:${k}">${esc(x)}</li>`).join('')}<li class="ls-add" data-edit="notes:new">+ add note</li></ol></div>
      <div class="ls-box ls-detail"><div class="ls-bh">PRINT DETAIL (ZOOMED IN)</div>
        ${pics.length ? `<div class="ls-pics">${pics.map((x) => `<figure>${opt.print ? '' : `<button type="button" class="ls-picx" data-picx="${x.x}" title="Take this picture off the sheet" aria-label="Remove picture">×</button>`}<img src="${x.img}" alt="">${x.caption ? `<figcaption>${esc(x.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : '<div class="ls-empty ls-nopic">No close-up yet. Add one under "Print detail box", or add a logo to a plate.</div>'}
        ${!opt.print && d.detailLogos !== false && hiddenLogos.size ? `<div class="ls-picshow"><button type="button" class="linklike" data-picshow="1">Show ${hiddenLogos.size} hidden logo${hiddenLogos.size > 1 ? 's' : ''}</button></div>` : ''}
        <div class="ls-dtexts">${dtexts.map((o) => `<div class="ls-dtext" data-edit="dtext:${o.k}">${esc(o.x).replace(/\n/g, '<br>')}</div>`).join('')}${allT.length < 4 ? '<div class="ls-dtext ls-dnew" data-edit="dtext:new"><span class="ls-add">+ add text box</span></div>' : ''}</div></div>
    </div>
  </div>`;
}

// SVG of the blank: width panels as rows (height exaggerated), length scores as columns, plates and the gaps between them.
let mkSeq = 0;
function drawing(d, selIdx = -1, drawH = 270) {
  const { f, q } = fmtFor(d); // q = with inch mark in fractions mode
  const uid = 'm' + (++mkSeq) + '-'; // own arrowhead ids per copy (the hidden preview's ids would not print)
  const x0 = 64, x1 = 850, y0 = 30, H = drawH || 270;
  const wp = nums(d.widthPanels), lp = nums(d.lengthPanels);
  const bw = pin(d.blankW), bl = pin(d.blankL);
  const rows = wp.length ? wp : [isFinite(bw) && bw > 0 ? bw : 1];
  const totW = sum(rows);
  const totL = lp.length ? sum(lp) : (isFinite(bl) && bl > 0 ? bl : 100);
  const X = (i) => x0 + (Math.max(0, Math.min(totL, i)) / totL) * (x1 - x0);
  const wts = rows.map((r) => Math.max(r, totW * 0.17));
  const ws = sum(wts);
  let yy = y0;
  const R = rows.map((r, i) => { const h = (wts[i] / ws) * H; const o = { y: yy, h, m: yy + h / 2 }; yy += h; return o; });
  const scores = [0]; lp.forEach((v) => scores.push(scores[scores.length - 1] + v));
  const pp = new Set(d.printPanels || []);
  const o = [];
  const RED = '#c0392b', BLUE = '#1565c0', INK = '#222', DASH = 'stroke-dasharray="6 4"';
  const t = (x, y, s, a = {}) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${a.size || 10}" fill="${a.fill || INK}" text-anchor="${a.anchor || 'middle'}"${a.weight ? ` font-weight="${a.weight}"` : ''}${a.tr ? ` transform="${a.tr}"` : ''}>${esc(s)}</text>`;
  const arrow = (xa, xb, y, c) => `<line x1="${xa.toFixed(1)}" y1="${y.toFixed(1)}" x2="${xb.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${c}" stroke-width="1" marker-start="url(#${uid}la${c === RED ? 'r' : 'k'})" marker-end="url(#${uid}la${c === RED ? 'r' : 'k'})"/>`;

  // printed rows, outline, scores
  // RSC-type blank: the 1st length panel is a glue tab (no flaps above/below it, tapered ends) and the flap rows are slotted at each score.
  const tab = rows.length >= 2 && lp.length >= 4 && (d.glueTab === 'on' || (d.glueTab !== 'off' && lp[0] > 0 && lp[0] <= 2.5));
  const flap = new Set(!tab ? [] : rows.length >= 3 ? [0, rows.length - 1] : [rows[0] <= rows[1] ? 0 : 1]);
  const body = R.filter((r, i) => !flap.has(i));
  const yE = y0 + H, xg = tab ? X(lp[0]) : x0;
  const bT = body.length ? body[0].y : y0, bB = body.length ? body[body.length - 1].y + body[body.length - 1].h : yE;
  const tp = Math.min(10, (bB - bT) * 0.2);
  // Shade only the panels/flaps that carry print: each cell (row × length panel) that a plate, BMC or text sits in.
  // A row marked printed with nothing placed on it yet is shaded whole.
  const segs = lp.length ? lp.map((v, j) => [scores[j], scores[j + 1]]) : [[0, totL]];
  const items = (d.plates || []).map((p) => {
    const st = pin(p.start); if (!isFinite(st) || p.panel < 1 || p.panel > R.length) return null;
    const w = p.kind === 'plate' && isFinite(pin(p.width)) && pin(p.width) > 0 ? pin(p.width) : p.kind === 'bmc' ? 1 : textAlongPx(p) / ((x1 - x0) / totL);
    return { row: p.panel - 1, a: st, b: st + w };
  }).filter(Boolean);
  const shadedRows = new Set();
  R.forEach((r, i) => {
    const mine = items.filter((it) => it.row === i);
    const cells = mine.length ? segs.map((sg, j) => (mine.some((it) => it.a < sg[1] - 1e-6 && it.b > sg[0] + 1e-6) ? j : -1)).filter((j) => j >= 0) : pp.has(i + 1) ? segs.map((_, j) => j) : [];
    cells.forEach((j) => {
      if (tab && j === 0 && flap.has(i)) return; // no flap beside the glue tab
      const xa = j === 0 && tab && !flap.has(i) ? x0 : X(segs[j][0]), xb = X(segs[j][1]);
      o.push(`<rect x="${xa.toFixed(1)}" y="${r.y.toFixed(1)}" width="${(xb - xa).toFixed(1)}" height="${r.h.toFixed(1)}" fill="#e6eef7"/>`);
      shadedRows.add(i);
    });
  });
  if (tab) {
    o.push(`<path d="M${xg.toFixed(1)} ${y0}H${x1}V${yE}H${xg.toFixed(1)}V${bB.toFixed(1)}L${x0} ${(bB - tp).toFixed(1)}V${(bT + tp).toFixed(1)}L${xg.toFixed(1)} ${bT.toFixed(1)}Z" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`);
    if (xg - x0 >= 9 && bB - bT > 40) o.push(t((x0 + xg) / 2 + 2.5, (bT + bB) / 2, jointName(d) + ' TAB', { size: 6.5, weight: 700, fill: '#555', tr: `rotate(-90 ${((x0 + xg) / 2 + 2.5).toFixed(1)} ${((bT + bB) / 2).toFixed(1)})` }));
  } else o.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${H}" fill="none" stroke="${INK}" stroke-width="1.6"/>`);
  R.slice(1).forEach((r) => o.push(`<line x1="${xg.toFixed(1)}" y1="${r.y.toFixed(1)}" x2="${x1}" y2="${r.y.toFixed(1)}" stroke="${INK}" ${DASH}/>`));
  scores.slice(1, -1).forEach((sc) => {
    const x = X(sc).toFixed(1);
    if (!tab) { o.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${yE}" stroke="${INK}" ${DASH}/>`); return; }
    R.forEach((r, i) => o.push(flap.has(i)
      ? `<line x1="${x}" y1="${r.y.toFixed(1)}" x2="${x}" y2="${(r.y + r.h).toFixed(1)}" stroke="${INK}" stroke-width="1.4"/>` // slot (cut)
      : `<line x1="${x}" y1="${r.y.toFixed(1)}" x2="${x}" y2="${(r.y + r.h).toFixed(1)}" stroke="${INK}" ${DASH}/>`));
  });

  // Measurements like the plant's measurement sheet:
  // left = each width panel, right = running total down the side, top = each length panel, bottom = running total at each score.
  let cumW = 0;
  R.forEach((r, i) => {
    cumW += rows[i];
    if (wp.length) {
      o.push(t(x0 - 14, r.m + 3.5, f(rows[i]), { anchor: 'end', size: 10, weight: 700 }));
      o.push(`<line x1="${x0 - 7}" y1="${(r.y + 1.5).toFixed(1)}" x2="${x0 - 7}" y2="${(r.y + r.h - 1.5).toFixed(1)}" stroke="${INK}" stroke-width=".8" marker-start="url(#${uid}lak)" marker-end="url(#${uid}lak)"/>`);
      o.push(`<line x1="${x0 - 11}" y1="${r.y.toFixed(1)}" x2="${x0 - 3}" y2="${r.y.toFixed(1)}" stroke="${INK}" stroke-width=".8"/>`);
    }
    o.push(`<line x1="${x1 + 4}" y1="${r.y.toFixed(1)}" x2="${x1 + 14}" y2="${r.y.toFixed(1)}" stroke="${INK}"/>`);
    if (wp.length) {
      o.push(`<line x1="${x1 + 9}" y1="${(r.y + 1.5).toFixed(1)}" x2="${x1 + 9}" y2="${(r.y + r.h - 1.5).toFixed(1)}" stroke="${INK}" stroke-width=".8" marker-start="url(#${uid}lak)" marker-end="url(#${uid}lak)"/>`);
      o.push(t(x1 + 48, r.m + 3.5, f(cumW), { size: 10.5, weight: 700 }));
    }
  });
  o.push(`<line x1="${x1 + 4}" y1="${y0 + H}" x2="${x1 + 14}" y2="${y0 + H}" stroke="${INK}"/>`);
  // overall width down the right side
  const W = wp.length ? totW : bw;
  if (isFinite(W) && W > 0) {
    o.push(`<line x1="${x1 + 84}" y1="${y0}" x2="${x1 + 84}" y2="${y0 + H}" stroke="${INK}" marker-start="url(#${uid}lak)" marker-end="url(#${uid}lak)"/>`);
    o.push(`<line x1="${x1 + 78}" y1="${y0}" x2="${x1 + 90}" y2="${y0}" stroke="${INK}" stroke-width=".8"/><line x1="${x1 + 78}" y1="${y0 + H}" x2="${x1 + 90}" y2="${y0 + H}" stroke="${INK}" stroke-width=".8"/>`);
    o.push(t(x1 + 100, y0 + H / 2, f(W), { size: 11, weight: 700, tr: `rotate(90 ${x1 + 100} ${y0 + H / 2})` }));
  }

  const yb = y0 + H + 18;
  if (lp.length) {
    // top: size of each length panel
    const dimRow = (yl, label) => lp.forEach((v, i) => {
      const a = X(scores[i]), b = X(scores[i + 1]), lab = label(i), w = lab.length * 6.2 + 6, narrow = b - a < w + 4;
      o.push(arrow(a + 0.5, b - 0.5, yl, INK));
      if (narrow) o.push(t(i === 0 ? a - 3 : b + 3, yl + 3.5, lab, { size: 10, weight: 700, anchor: i === 0 ? 'end' : 'start' }));
      else o.push(`<rect x="${((a + b) / 2 - w / 2).toFixed(1)}" y="${(yl - 7).toFixed(1)}" width="${w.toFixed(1)}" height="13" fill="#fff"/>` + t((a + b) / 2, yl + 3.5, lab, { size: 10, weight: 700 }));
    });
    scores.forEach((sc) => o.push(`<line x1="${X(sc).toFixed(1)}" y1="${y0 - 18}" x2="${X(sc).toFixed(1)}" y2="${y0 - 3}" stroke="${INK}" stroke-width=".8"/>`));
    dimRow(y0 - 10, (i) => f(lp[i]));
    // bottom: running total at the end of each panel, centered under that panel (same layout as the top row)
    scores.forEach((sc) => o.push(`<line x1="${X(sc).toFixed(1)}" y1="${y0 + H + 3}" x2="${X(sc).toFixed(1)}" y2="${y0 + H + 18}" stroke="${INK}" stroke-width=".8"/>`));
    dimRow(y0 + H + 11, (i) => f(scores[i + 1]));
  }
  const blankNote = isFinite(bl) && bl > 0 && lp.length && !near(bl, totL) ? ` (blank ${f(bl)})` : '';
  o.push(t((x0 + x1) / 2, yb + 24, lp.length ? `${f(totL)} scored length${blankNote}` : isFinite(bl) && bl > 0 ? `${f(bl)} blank length` : '', { size: 10.5, weight: 600 }));

  // plates
  const plates = (d.plates || []).map((p, i) => ({ ...p, i, s: pin(p.start), w: pin(p.width) })).filter((p) => isFinite(p.s) && p.panel >= 1 && p.panel <= R.length);
  const pxIn = (x1 - x0) / totL;
  plates.forEach((p) => {
    const r = R[p.panel - 1];
    const m = r.m + Math.max(-0.45, Math.min(0.45, +p.dy || 0)) * r.h; // up/down inside the panel
    p.cy = m;
    const selBox = (x, y, w, h) => { itemHs[p.i] = h / r.h; if (p.i === selIdx) o.push(`<rect x="${(x - 4).toFixed(1)}" y="${(y - 4).toFixed(1)}" width="${(w + 8).toFixed(1)}" height="${(h + 8).toFixed(1)}" rx="3" fill="none" stroke="#1a73e8" stroke-width="2.5" stroke-dasharray="5 3" pointer-events="none"/>`); };
    const ang = angleOf(p), side = ang % 180 === 90;
    const rot = (cx) => (ang ? ` transform="rotate(${ang} ${cx.toFixed(1)} ${m.toFixed(1)})"` : '');
    if (p.kind === 'text') {
      const fs = textFs(p);
      let ls = String(p.text || '').split('\n').map((x) => x.trim()).filter(Boolean);
      if (!ls.length) ls = ['TEXT'];
      const lh = fs * 1.2, hh = ls.length * lh + fs * 0.3;
      const w = Math.max(...ls.map((x) => x.length)) * fs * 0.6 + 6, xa = X(p.s) - (side ? (w - hh) / 2 : 0), y = m - hh / 2;
      const base = m - ((ls.length - 1) * lh) / 2 + fs * 0.35;
      o.push(`<g class="ls-plate" data-pi="${p.i}"><g${rot(xa + w / 2)}><rect x="${xa.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" fill="${p.hl ? '#ffeb3b' : '#fff'}" fill-opacity="${p.hl ? 1 : 0}"/>${ls.map((x, k) => t(p.ta === 'center' ? xa + w / 2 : p.ta === 'right' ? xa + w - 3 : xa + 3, base + k * lh, x, { size: fs, weight: 700, anchor: p.ta === 'center' ? 'middle' : p.ta === 'right' ? 'end' : 'start' })).join('')}</g></g>`);
      if (side) selBox(xa + w / 2 - hh / 2, m - w / 2, hh, w); else selBox(xa, y, w, hh);
      p.skip = true;
      return;
    }
    if (p.kind === 'bmc') {
      // A BMC is 1" round. Drawn to scale when that is big enough to read, never smaller than 22 px; measured as 1".
      const D = 1, rr = Math.min(r.h * 0.45, Math.max(11, (D * pxIn) / 2)), cx = X(p.s + D / 2), xa = cx - rr;
      const b = bmcOf(p), big = rr >= 15;
      o.push(`<g class="ls-plate" data-pi="${p.i}"><g${rot(cx)}><circle cx="${cx.toFixed(1)}" cy="${m.toFixed(1)}" r="${rr.toFixed(1)}" fill="${p.hl ? '#ffeb3b' : '#fff'}" stroke="${INK}" stroke-width="1.2"/><circle cx="${cx.toFixed(1)}" cy="${m.toFixed(1)}" r="${(rr - 2).toFixed(1)}" fill="none" stroke="${INK}" stroke-width=".5"/>${big ? t(cx, m - 1, 'BMC', { size: 7.5, weight: 700 }) + t(cx, m + 7, `${b.v} ${b.tst === 'ECT' ? 'ECT' : 'LB'}`, { size: 6 }) : t(cx, m + 2.2, 'BMC', { size: 6, weight: 700 })}</g></g>`);
      selBox(xa, m - rr, rr * 2, rr * 2);
      p.xa = Math.min(xa, X(p.s)); p.xb = Math.max(cx + rr, X(p.s + D)); p.e = p.s + D;
      return;
    }
    const w = isFinite(p.w) && p.w > 0 ? p.w : totL * 0.1;
    const xa = X(p.s), xb = Math.max(X(p.s + w), xa + 24);
    // Fit all of the copy: shrink the type (9 → 5 px) and let the box grow up to ~90% of the panel height.
    // plate size top to bottom: Length in inches (drawn at the panel's scale), else an older dragged share of the panel
    const plIn = pin(p.plen), rowIn = rows[p.panel - 1];
    const setH = isFinite(plIn) && plIn > 0 && rowIn > 0 ? Math.max(6, Math.min(0.98, plIn / rowIn) * r.h)
      : +p.hgt > 0 ? Math.max(0.15, Math.min(0.98, +p.hgt)) * r.h : 0;
    const cx = (xa + xb) / 2, hMax = setH || r.h * 0.9, base = setH || Math.min(r.h * 0.8, 52), bw = xb - xa;
    // a sideways plate runs its lines top to bottom: a line gets the box height, the stack of lines the box width
    const alongMax = side ? hMax : bw, acrossMax = side ? bw : hMax;
    const raw = String(p.text || '').split('\n').map((x) => x.trim()).filter(Boolean);
    let fs = 9, lines = [];
    if (+p.fsz > 0) { // size typed by hand: keep it, just wrap
      fs = clampFs(p.fsz);
      lines = raw.flatMap((x) => wrapHard(x, Math.max(3, Math.floor((alongMax - 6) / (fs * 0.58)))));
    } else {
      for (; fs >= 5; fs -= 0.5) {
        const per = Math.max(3, Math.floor((alongMax - 6) / (fs * 0.58)));
        lines = raw.flatMap((x) => wrapHard(x, per));
        const splitsWord = raw.some((x) => x.split(/\s+/).some((w) => w.length > per));
        if (lines.length * fs * 1.18 + 6 <= acrossMax && (!splitsWord || fs <= 6)) break; // shrink a little more rather than break a word
      }
      fs = Math.max(5, fs);
      autoFs[p.i] = fs;
    }
    const lh = fs * 1.18;
    const maxL = Math.max(1, Math.floor((acrossMax - 6) / lh));
    if (lines.length > maxL) { lines = lines.slice(0, maxL); lines[maxL - 1] += '…'; }
    // a logo with no Length typed takes its own shape: the box grows taller as the plate gets wider
    const ir = p.img ? ratioOf(p.img) : 0;
    const h = p.img && !setH && ir ? Math.max(12, Math.min(hMax, (side ? bw / ir : bw * ir) + 4))
      : p.img || setH ? base
      : side ? Math.max(base, Math.min(hMax, Math.max(1, ...lines.map((l) => l.length)) * fs * 0.58 + 10))
        : Math.max(base, Math.min(hMax, lines.length * lh + 8));
    const y = m - h / 2;
    // the copy / logo is laid out upright in a box the turned way round (vw × vh), centred on the plate, then turned
    const vw = side ? h : bw, vh = side ? bw : h, vxa = cx - vw / 2, vxb = cx + vw / 2, vya = m - vh / 2;
    const y1 = m - ((lines.length - 1) * lh) / 2 + fs * 0.35;
    const txt = p.img
      ? `<image href="${p.img}" x="${(vxa + 2).toFixed(1)}" y="${(vya + 2).toFixed(1)}" width="${Math.max(1, vw - 4).toFixed(1)}" height="${Math.max(1, vh - 4).toFixed(1)}" preserveAspectRatio="${fillLogo(p) ? 'none' : 'xMidYMid meet'}" style="mix-blend-mode:multiply"/>`
      : lines.map((ln, k) => t(p.ta === 'left' ? vxa + 4 : p.ta === 'right' ? vxb - 4 : cx, y1 + k * lh, ln, { size: fs, weight: 600, anchor: p.ta === 'left' ? 'start' : p.ta === 'right' ? 'end' : 'middle' })).join('');
    o.push(`<g class="ls-plate" data-pi="${p.i}"><rect class="ls-pbox" x="${xa.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${p.hl ? '#ffeb3b' : '#fff'}" fill-opacity="${p.hl ? 1 : 0}" stroke="#8a96a3" stroke-width=".8" stroke-dasharray="3 3"/><g${rot(cx)}>${txt}</g></g>`);
    selBox(xa, y, xb - xa, h);
    // plate length (its width along the sheet): arrow across the plate, under it (or over it when there is no room)
    const pw = pin(p.width);
    let wLab = 0; // width of the plate-size number in the middle, so the blue arrows can sit just beside it
    if (!p.nodim && !p.nosize && d.plateSizes !== 'off' && isFinite(pw) && pw > 0 && xb - xa >= 14) {
      const below = y + h + 13 <= r.y + r.h - 2, yd = below ? y + h + 7 : y - 7;
      const lab = q(pw), lw = lab.length * 5.4 + 8, ccx = (xa + xb) / 2;
      o.push(`<line x1="${xa.toFixed(1)}" y1="${(below ? y + h + 2 : y - 2).toFixed(1)}" x2="${xa.toFixed(1)}" y2="${(yd + (below ? 3 : -3)).toFixed(1)}" stroke="${INK}" stroke-width=".6"/>`);
      o.push(`<line x1="${xb.toFixed(1)}" y1="${(below ? y + h + 2 : y - 2).toFixed(1)}" x2="${xb.toFixed(1)}" y2="${(yd + (below ? 3 : -3)).toFixed(1)}" stroke="${INK}" stroke-width=".6"/>`);
      o.push(arrow(xa + 0.5, xb - 0.5, yd, INK));
      if (xb - xa >= lw + 10) wLab = lw;
      if (xb - xa >= lw + 10) o.push(`<rect x="${(ccx - lw / 2).toFixed(1)}" y="${(yd - 5.5).toFixed(1)}" width="${lw.toFixed(1)}" height="11" fill="#fff"/>` + t(ccx, yd + 3.2, lab, { size: 9, weight: 700 }));
      else o.push(t(xb + 3, yd + 3.2, lab, { size: 9, weight: 700, anchor: 'start' })); // narrow plate: number beside the arrow
    }
    // plate length top to bottom: arrow on the right side of the plate (gap arrows on that side start past it)
    if (!p.nodim && !p.nosize && d.plateSizes !== 'off' && isFinite(plIn) && plIn > 0 && h >= 12) {
      const xd = xb + 6;
      o.push(`<line x1="${(xb + 1).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(xd + 3).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${INK}" stroke-width=".6"/><line x1="${(xb + 1).toFixed(1)}" y1="${(y + h).toFixed(1)}" x2="${(xd + 3).toFixed(1)}" y2="${(y + h).toFixed(1)}" stroke="${INK}" stroke-width=".6"/>`);
      o.push(`<line x1="${xd.toFixed(1)}" y1="${(y + 0.5).toFixed(1)}" x2="${xd.toFixed(1)}" y2="${(y + h - 0.5).toFixed(1)}" stroke="${INK}" stroke-width="1" marker-start="url(#${uid}lak)" marker-end="url(#${uid}lak)"/>`);
      const lab = q(plIn);
      o.push(`<rect x="${(xd - 6).toFixed(1)}" y="${(m - lab.length * 2.7 - 4).toFixed(1)}" width="12" height="${(lab.length * 5.4 + 8).toFixed(1)}" fill="#fff"/>` + t(xd + 3.2, m, lab, { size: 9, weight: 700, tr: `rotate(-90 ${(xd + 3.2).toFixed(1)} ${m.toFixed(1)})` }));
      p.dimR = 14;
    }
    // blue distances from the plate up to the panel's top score and down to its bottom score (left of the plate, clear of the other arrows).
    // They belong to "distances", not to the plate size, so hiding the plate size keeps them.
    if (!p.nodim && isFinite(plIn) && plIn > 0 && h >= 12) {
      // in the middle of the plate (just right of the plate-size number when it is shown)
      const pxPerIn = r.h / rowIn, xv = (xa + xb) / 2 + (wLab ? wLab / 2 + 6 : 0);
      [[r.y, y], [y + h, r.y + r.h]].forEach(([ya, yb2]) => {
        const gIn = (yb2 - ya) / pxPerIn;
        if (gIn < 1 / 32 || yb2 - ya < 6) return;
        o.push(`<line x1="${xv.toFixed(1)}" y1="${(ya + 0.5).toFixed(1)}" x2="${xv.toFixed(1)}" y2="${(yb2 - 0.5).toFixed(1)}" stroke="${BLUE}" stroke-width="1" marker-start="url(#${uid}lab)" marker-end="url(#${uid}lab)"/>`);
        const lab = q(gIn), lw = lab.length * 5.4 + 8, ly = (ya + yb2) / 2;
        // number to the right of the arrow
        o.push(`<rect x="${(xv + 3).toFixed(1)}" y="${(ly - 6).toFixed(1)}" width="${lw.toFixed(1)}" height="12" fill="#fff" fill-opacity=".9"/>` + t(xv + 3 + lw / 2, ly + 3.4, lab, { size: 9.5, fill: BLUE, weight: 700 }));
      });
    }
    if (p.i === selIdx) { // resize handles: right edge = width, bottom edge = height
      o.push(`<rect class="ls-handle" data-handle="w" data-hpi="${p.i}" x="${(xb + 1).toFixed(1)}" y="${(m - 7).toFixed(1)}" width="9" height="14" rx="2" fill="#1a73e8" stroke="#fff" stroke-width="1.5"/>`);
      o.push(`<rect class="ls-handle" data-handle="h" data-hpi="${p.i}" x="${(cx - 7).toFixed(1)}" y="${(y + h + 1).toFixed(1)}" width="14" height="9" rx="2" fill="#1a73e8" stroke="#fff" stroke-width="1.5"/>`);
    }
    p.xa = xa; p.xb = xb + (p.dimR || 0); p.e = p.s + w;
  });
  // gaps: from the nearest score (or plate) on the left of each plate, and from the last plate to the next score
  for (let i = 1; i <= R.length; i++) {
    const row = plates.filter((p) => p.panel === i && !p.skip && !p.nodim).sort((a, b) => a.s - b.s);
    if (!row.length) continue;
    let prevEnd = null, prevDim = 0;
    const placed = [], botY = R[i - 1].y + R[i - 1].h - 3;
    row.forEach((p, k) => {
      const sc = scores.filter((s) => s <= p.s + 1e-6).pop() ?? 0;
      const fromPlate = prevEnd !== null && prevEnd >= sc - 1e-6;
      const a = fromPlate ? prevEnd : sc;
      const gap = p.s - a;
      const y = p.cy, topY = R[i - 1].y + 10;
      // start past the previous plate's Length dimension when there is room, else at the plate edge itself
      const xs = X(a) + (fromPlate && p.xa - (X(a) + prevDim) >= 8 ? prevDim : 0);
      if (gap > 0.01) gapMark(o, xs, p.xa, y, q(gap), RED, t, arrow, topY, p.vdim ? p.xa - 12 : null, placed, botY);
      prevEnd = Math.max(prevEnd ?? -Infinity, p.e); prevDim = p.dimR || 0;
      // gap to the next score, when that score comes before the next plate
      const next = row[k + 1], scR = scores.find((s) => s >= p.e - 1e-6) ?? totL;
      if ((!next || scR <= next.s + 1e-6) && scR - p.e > 0.01) { gapMark(o, X(scR) - p.xb >= 8 ? p.xb : p.xb - (p.dimR || 0), X(scR), y, q(scR - p.e), RED, t, arrow, topY, null, placed, botY); prevEnd = scR; prevDim = 0; }
    });
  }

  const mk = (id, c) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L10 5L0 9z" fill="${c}"/></marker>`;
  return `<svg class="ls-svg" data-x0="${x0}" data-x1="${x1}" data-totl="${totL}" data-rowsin="${rows.join(',')}" data-rows="${R.map((r) => r.y.toFixed(1) + ',' + r.h.toFixed(1)).join(';')}" viewBox="0 0 1000 ${yb + 36}" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif"><defs>${mk(uid + 'lak', INK)}${mk(uid + 'lar', RED)}${mk(uid + 'lab', BLUE)}</defs>${o.join('')}</svg>`;
}

// maxRight: the label must end left of this x (keeps it off the blue top/bottom number beside the plate)
// placed: labels already put at the top / bottom of this panel row, so a new one never lands on another (it moves to the bottom)
function gapMark(o, xa, xb, y, label, c, t, arrow, topY = null, maxRight = null, placed = null, botY = null) {
  if (xb - xa < 1.5) return;
  const w = label.length * 5.4 + 8, cx = (xa + xb) / 2;
  if (xb - xa >= 8) o.push(arrow(xa + 1, xb - 1, y, c));
  else o.push(`<line x1="${xa.toFixed(1)}" y1="${y.toFixed(1)}" x2="${xb.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${c}" stroke-width="2"/>`); // too tight for arrowheads
  if (xb - xa < w + 24) { // short gap: label goes at the top of the panel (clear of the plate) so the arrow stays visible
    let ly = topY !== null ? Math.min(topY, y - 8) : y - 8;
    const lx = maxRight != null && cx + w / 2 > maxRight ? maxRight - w / 2 : cx;
    const hits = (yy) => placed && placed.some((b) => Math.abs(b.y - yy) < 11 && lx - w / 2 < b.x2 + 2 && lx + w / 2 > b.x1 - 2);
    if (hits(ly) && botY !== null && !hits(botY)) ly = botY;
    if (placed) placed.push({ x1: lx - w / 2, x2: lx + w / 2, y: ly });
    o.push(`<rect x="${(lx - w / 2).toFixed(1)}" y="${(ly - 9).toFixed(1)}" width="${w.toFixed(1)}" height="11" fill="#fff" fill-opacity=".85"/>`);
    o.push(t(lx, ly, label, { size: 9, fill: c, weight: 700 }));
    const below = ly > y;
    if (Math.abs(y - ly) > 14 || lx !== cx) o.push(`<line x1="${lx.toFixed(1)}" y1="${(below ? ly - 10 : ly + 2).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(below ? y + 2 : y - 2).toFixed(1)}" stroke="${c}" stroke-width=".6" stroke-dasharray="2 2"/>`);
    return;
  }
  o.push(`<rect x="${(cx - w / 2).toFixed(1)}" y="${(y - 6.5).toFixed(1)}" width="${w.toFixed(1)}" height="13" fill="#fff"/>`);
  o.push(t(cx, y + 3.5, label, { size: 9.5, fill: c, weight: 700 }));
}

// Word wrap that splits words longer than a line instead of cutting them off.
function wrapHard(s, n) {
  const out = []; let cur = '';
  for (let w of String(s).split(/\s+/).filter(Boolean)) {
    while (w.length > n) { if (cur) { out.push(cur); cur = ''; } out.push(w.slice(0, n)); w = w.slice(n); }
    if (!w) continue;
    if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}
function wrap(s, n) {
  const out = []; let cur = '';
  for (const w of String(s).split(/\s+/).filter(Boolean)) {
    if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out.map((x) => (x.length > n ? x.slice(0, n - 1) + '…' : x));
}

// Fill one landscape letter page (about 998 × 758 px printable at 0.3" margins):
// measure the sheet as it prints, then give the spare height to the drawing (and the rest to the bottom boxes).
// A sheet that is too tall is scaled down instead.
function printSheet() {
  const AVAIL = 740;
  const measure = (o) => {
    const m = document.createElement('div');
    m.style.cssText = 'position:absolute;left:-10000px;top:0;width:1000px;visibility:hidden;font-size:12.5px;line-height:1.35;color:#000;background:#fff';
    m.innerHTML = sheetHtml(L, -1, { print: true, ...o });
    document.body.appendChild(m);
    const r = { h: m.firstElementChild.offsetHeight, boxes: (m.querySelector('.ls-boxes') || {}).offsetHeight || 0 };
    m.remove();
    return r;
  };
  let o = { H: 270 }, k = 0.998;
  const m0 = measure(o);
  if (m0.h < AVAIL) {
    // spare height: first make the notes / detail boxes at least ~250 px (room for a readable print detail), then grow the drawing, then the boxes again
    let extra = AVAIL - m0.h;
    const box = Math.min(extra, Math.max(0, 250 - m0.boxes));
    extra -= box;
    const add = Math.min(extra, 260);
    extra -= add;
    o = { H: 270 + add, boxesH: box + extra > 4 ? m0.boxes + box + extra : 0 };
  } else {
    // too tall: make the drawing shorter first (its height is exaggerated anyway), then shrink only what is left over
    const H = Math.max(150, 270 - (m0.h - AVAIL));
    o = { H };
    const m1 = measure(o);
    if (m1.h > AVAIL) k = Math.min(0.998, AVAIL / m1.h);
  }
  // the browser uses the page title as the PDF file name: "668565 Fabri-Cote"
  const oldTitle = document.title;
  const fname = [L.fileNo && String(L.fileNo).trim(), String(L.customer || '').split(/[,\n]/)[0].trim()].filter(Boolean).join(' ').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (fname) {
    document.title = fname;
    const back = () => { document.title = oldTitle; window.removeEventListener('afterprint', back); };
    window.addEventListener('afterprint', back);
    setTimeout(back, 60000); // in case the browser never reports the print as done
  }
  openPrint(`<style>@page{size:letter landscape;margin:0.3in}</style><div class="lsheet-print" style="zoom:${k.toFixed(3)}">${sheetHtml(L, -1, { print: true, ...o })}</div>`);
}

// ---- original scan(s) ----
// The file exactly as uploaded, as base64 (no shrinking), for keeping with the saved layout.
function rawBase64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(file); });
}
function paintOrig() {
  const box = $('#lOrig');
  if (!box) return;
  const vb = $('#lVerBtn'); if (vb) vb.style.display = L.id ? '' : 'none';
  if (origFiles.length) {
    box.innerHTML = `<div class="hint">Original scan: ${origFiles.map((f) => esc(f.name)).join(', ')}. It is kept with the layout when you press Save.</div>`;
    return;
  }
  const list = (L.originals || []).map((o, i) => (o ? { ...o, i } : null)).filter(Boolean);
  box.innerHTML = list.length && L.id ? `<div class="btn-row"><span class="hint">Original scan:</span>${list.map((o) => `<button type="button" class="btn small" data-orig="${o.i}">View ${esc(o.name)}</button>`).join('')}</div>` : '';
  $$('[data-orig]', box).forEach((b) => b.onclick = () => viewOriginal(+b.dataset.orig));
}
async function viewOriginal(i) {
  const w = window.open('', '_blank'); // open now (a click), fill in when the file arrives, so pop-up blockers allow it
  try {
    const res = await fetch('/api/layouts?id=' + encodeURIComponent(L.id) + '&original=' + i, { headers: { 'x-access-code': getCode() } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not open the original');
    const url = URL.createObjectURL(await res.blob());
    if (w) w.location = url; else location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) { if (w) w.close(); alert(e.message); }
}

// ---- versions ----
async function showVersions() {
  const box = $('#lVers');
  if (!L.id) return;
  if (box.innerHTML) { box.innerHTML = ''; return; } // second press hides the list
  box.innerHTML = '<div class="hint"><span class="spinner"></span> Loading versions…</div>';
  try {
    const { versions } = await api('/api/layouts?id=' + encodeURIComponent(L.id) + '&versions=1');
    const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '?');
    box.innerHTML = versions.length
      ? `<div class="lay-vers"><div class="hint">Earlier saves of this layout (newest first, last ${versions.length}). Opening one does not change anything until you press Save.</div>
        ${versions.map((v) => `<div class="lay-item"><div><b>${esc(when(v.updatedAt))}</b><div class="hint">Saved by ${esc(v.updatedBy || '?')}</div></div><button type="button" class="btn small" data-ver="${esc(v.ts)}">Open</button></div>`).join('')}</div>`
      : '<div class="hint">No earlier versions yet. Each time this layout is saved, the one before it is kept here.</div>';
    $$('[data-ver]', box).forEach((b) => b.onclick = async () => {
      try {
        const { layout } = await api('/api/layouts?id=' + encodeURIComponent(L.id) + '&version=' + b.dataset.ver);
        const keepId = L.id, keepOrig = L.originals;
        L = { ...EMPTY(), ...layout, id: keepId, originals: keepOrig, orig: null };
        sel = -1; undo = null; origFiles = [];
        fill();
        box.innerHTML = '';
        $('#lSaveMsg').innerHTML = `<div class="alert info">Showing the version saved ${esc(when(layout.updatedAt))} by ${esc(layout.updatedBy || '?')}. Press Save to make it the current one, or Undo to go back.</div>`;
      } catch (e) { $('#lSaveMsg').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
    });
  } catch (e) { box.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
}

// ---- saved layouts ----
async function save() {
  const name = $('#lName').value.trim();
  const msg = $('#lSaveMsg');
  if (!name) { msg.innerHTML = '<div class="alert warn">Type your name to save.</div>'; $('#lName').focus(); return; }
  if (!L.customer && !L.fileNo && !L.design) { msg.innerHTML = '<div class="alert warn">Add a customer, file # or design no. first.</div>'; return; }
  saveForm('layout_name', name);
  if (!L.id) L.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const btn = $('#lSave'); btn.disabled = true;
  try {
    const { orig, originals, ...body } = L;
    const pending = origFiles.slice();
    const r = await api('/api/layouts?id=' + encodeURIComponent(L.id), { method: 'PUT', body: JSON.stringify({ ...body, newOriginals: pending.length > 0, updatedBy: name }) });
    L.originals = r.layout.originals || [];
    // store the original scan(s) with it, one file per request
    let kept = 0, skipped = [];
    for (let i = 0; i < pending.length; i++) {
      const f = pending[i];
      if (f.size > 4_200_000) { skipped.push(f.name); continue; }
      msg.innerHTML = `<div class="alert info"><span class="spinner"></span> Saving the original scan (${i + 1} of ${pending.length})…</div>`;
      const data = await rawBase64(f);
      const u = await api('/api/layouts?id=' + encodeURIComponent(L.id) + '&original=' + i, { method: 'PUT', body: JSON.stringify({ name: f.name, mediaType: f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : 'image/jpeg'), data }) });
      L.originals = u.originals || L.originals;
      kept++;
    }
    origFiles = [];
    saveForm('layout', L);
    paintOrig();
    msg.innerHTML = `<div class="alert ok">Saved. Anyone can open it from Saved layouts.${kept ? ` The original scan is kept with it.` : ''}${skipped.length ? ` <br>Too big to keep the original: ${skipped.map(esc).join(', ')} (over 4 MB).` : ''}</div>`;
    $('#lVers').innerHTML = '';
    loadList();
  } catch (e) { msg.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  finally { btn.disabled = false; }
}

async function loadList() {
  try { const r = await api('/api/layouts'); saved = r.layouts || []; paintList(); }
  catch { const b = $('#lList'); if (b) b.innerHTML = '<p class="hint">Could not load saved layouts right now.</p>'; }
}

function paintList() {
  const box = $('#lList');
  if (!box) return;
  const q = $('#lFind').value.trim().toLowerCase();
  const rows = saved.filter((x) => !q || [x.customer, x.fileNo, x.specNo, x.design, x.style].join(' ').toLowerCase().includes(q));
  if (!saved.length) { box.innerHTML = '<p class="hint" style="margin:0">No saved layouts yet.</p>'; return; }
  if (!rows.length) { box.innerHTML = '<p class="hint" style="margin:0">No match.</p>'; return; }
  box.innerHTML = rows.slice(0, 100).map((x) => `
    <div class="lay-item">
      <div><b>${esc(x.customer || 'No customer')}</b><div class="hint">${[x.fileNo && 'File # ' + x.fileNo, x.design, x.style].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="hint">${esc(x.updatedBy || '')}${x.updatedAt ? ' · ' + new Date(x.updatedAt).toLocaleDateString() : ''}</div></div>
      <div class="btn-row"><button type="button" class="btn small" data-open="${esc(x.id)}">Open</button><button type="button" class="btn small ghost danger" data-rm="${esc(x.id)}" aria-label="Delete">✕</button></div>
    </div>`).join('');
  $$('[data-open]', box).forEach((b) => b.onclick = async () => {
    try {
      const { layout } = await api('/api/layouts?id=' + encodeURIComponent(b.dataset.open));
      L = { ...EMPTY(), ...layout, orig: null };
      origFiles = []; $('#lVers').innerHTML = '';
      fill();
      $('#lSaveMsg').innerHTML = `<div class="alert info">Opened ${esc(layout.customer || 'layout')}. Save again to update it.</div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { $('#lSaveMsg').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  });
  $$('[data-rm]', box).forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this saved layout?')) return;
    try { await api('/api/layouts?id=' + encodeURIComponent(b.dataset.rm), { method: 'DELETE' }); if (L.id === b.dataset.rm) L.id = ''; loadList(); }
    catch (e) { alert(e.message); }
  });
}
