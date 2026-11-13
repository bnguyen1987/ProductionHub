// Print Layouts: upload an old print layout / spec sheet, the AI reads it, and the page redraws it as a clean new spec sheet.
// Draft stays in this browser (localStorage). Saved layouts go to /api/layouts so anyone can open and reprint them.
import { $, $$, esc, api, fileToPayload, parseInches, fmtIn, saveForm, loadForm } from './common.js';
import { openPrint } from './printkit.js';
import { pageCanvas } from './dieline.js';

const today = () => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`; };
const EMPTY = () => ({
  id: '', customer: '', shipTo: '', fileNo: '', specNo: '', design: '', ident: '', style: '', size: '', board: '',
  blankW: '', blankL: '', print: '', routing: '', view: 'Outside', widthPanels: '', lengthPanels: '',
  printPanels: [], plates: [], notes: '', changes: '', detailTexts: [], details: [], detailLogos: true, origDate: '', revDate: today(), sales: '', designer: '', approved: '', orig: null,
});
const INFO = [
  ['customer', 'Customer'], ['shipTo', 'Ship to'], ['fileNo', 'File #'], ['specNo', 'Spec #'],
  ['design', 'Design no.'], ['ident', 'Ident'], ['style', 'Style'], ['size', 'Size (L × W × D)'],
  ['board', 'Board / flute'], ['print', 'Print / ink'], ['routing', 'Routing'],
];
// Fields compared by "Add my edits"
const TRACK = [['style', 'Style'], ['size', 'Size'], ['board', 'Board'], ['blankW', 'Blank width'], ['blankL', 'Blank length'], ['print', 'Print'], ['routing', 'Routing'], ['widthPanels', 'Panel scores'], ['lengthPanels', 'Length scores']];

let L, view, saved = [], ro = null, sel = -1, undo = null, dragged = false;

// ---- inches ----
const pin = (s) => parseInches(String(s ?? '').replace(/["”]/g, '').trim());
const f = (x) => fmtIn(x, '');
const fx = (x) => (Math.abs(x * 16 - Math.round(x * 16)) < 0.02 ? f(x) : String(+x.toFixed(3)));
const show = (s) => { const v = pin(s); return isFinite(v) ? f(v) : String(s ?? '').trim(); };
const list = (s) => String(s || '').split(/[,|;]/).map((x) => x.trim()).filter(Boolean);
const nums = (s) => list(s).map(pin).filter((v) => isFinite(v) && v > 0);
const sum = (a) => a.reduce((t, v) => t + v, 0);
const near = (a, b) => Math.abs(a - b) < 1 / 32;

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
          <div id="lSelBar" class="sel-bar"></div>
          <div class="btn-row" style="margin-top:12px">
            <button type="button" class="btn primary" id="lPrint">Print / save PDF</button>
            <input type="text" id="lName" placeholder="Your name" aria-label="Your name" style="max-width:170px">
            <button type="button" class="btn" id="lSave">Save</button>
            <button type="button" class="btn ghost" id="lNew">Start over</button>
          </div>
          <div id="lSaveMsg" style="margin-top:8px"></div>
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
          <div class="field" style="margin-top:10px"><label>Changes from the old sheet (one per line, kept with the layout, not printed)</label><textarea data-l="changes" rows="4"></textarea></div>
          <div class="btn-row" style="margin-top:8px"><button type="button" class="btn small" id="lEdits">Add my edits to the changes</button><span class="hint" id="lEditsMsg"></span></div>
          <div class="row" style="margin-top:12px">
            <div class="field"><label>Original date</label><input type="text" data-l="origDate"></div>
            <div class="field"><label>Revised</label><input type="text" data-l="revDate"></div>
            <div class="field"><label>Sales</label><input type="text" data-l="sales"></div>
            <div class="field"><label>Designer</label><input type="text" data-l="designer"></div>
            <div class="field"><label>Approved by</label><input type="text" data-l="approved"></div>
          </div>
        </section>
        </div>
        <div class="stack">
        <section class="card">
          <h2><span class="n">3</span>Panels and print</h2>
          <div class="field"><label>Panel scores across the width, top to bottom</label><input type="text" data-l="widthPanels" placeholder="4 7/8, 9 11/16, 4 15/16, 9 11/16, 4 7/8"></div>
          <div id="lWChk" class="hint" style="margin:4px 0 10px"></div>
          <div class="field"><label>Scores along the length, left to right</label><input type="text" data-l="lengthPanels" placeholder="4 3/4, 123 1/16, 4 3/4"></div>
          <div id="lLChk" class="hint" style="margin:4px 0 10px"></div>
          <div class="field" style="max-width:260px;margin-bottom:10px"><label>Glue tab and slots</label><select data-l="glueTab"><option value="">Auto (RSC-type: small 1st length panel)</option><option value="on">Show</option><option value="off">Don't show</option></select></div>
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
  $('#lEdits').onclick = addEdits;
  $('#lDetTextAdd').onclick = () => { if (L.detailTexts.length >= 4) return alert('The detail box holds up to 4 text boxes.'); L.detailTexts.push(''); paintDetails(); update(); const t = $$('#lDetTexts textarea').pop(); if (t) t.focus(); };
  $('#lDetLogos').onchange = (e) => { L.detailLogos = e.target.checked; update(); };
  $('#lDetAdd').onchange = (e) => { const f0 = e.target.files[0]; e.target.value = ''; if (f0) addDetail(f0); };
  $('#lPrint').onclick = printSheet;
  $('#lSave').onclick = save;
  $('#lNew').onclick = () => { if (!confirm('Clear this layout and start over?')) return; L = EMPTY(); sel = -1; undo = null; fill(); $('#lAiMsg').innerHTML = ''; $('#lSaveMsg').innerHTML = ''; };
  $('#lFind').oninput = paintList;
  $('#lSheet').addEventListener('click', (e) => {
    if (dragged) { dragged = false; return; }
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

export function destroy() { if (ro) ro.disconnect(); ro = null; document.removeEventListener('keydown', onKey); sel = -1; undo = null; }

// ---- select / highlight / delete a print on the sheet ----
function onKey(e) {
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
  let dy = (+p.dy || 0) + d * 0.15;
  if (dy < -0.451 && p.panel > 1) { p.panel--; dy = 0.45; }
  else if (dy > 0.451 && p.panel < n) { p.panel++; dy = -0.45; }
  p.dy = Math.round(Math.max(-0.45, Math.min(0.45, dy)) * 100) / 100;
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
    const what = p.kind === 'bmc' ? `<b>Selected BMC:</b> P${p.panel} · ${esc(bmcLabel(p))}` : `<b>${p.kind === 'text' ? 'Selected text:' : 'Selected print:'}</b> P${p.panel}${p.text ? ' · ' + esc(p.text) : ''}`;
    const nP = Math.max(1, nums(L.widthPanels).length, p.panel);
    bar.innerHTML = `<span>${what}</span>
      <span class="btn-row sel-move"><span class="hint">Move:</span>
        <select id="lMvP" aria-label="Panel">${Array.from({ length: nP }, (_, k) => `<option value="${k + 1}" ${p.panel === k + 1 ? 'selected' : ''}>P${k + 1}</option>`).join('')}</select>
        <button type="button" class="btn small" id="lMvL" aria-label="Move left">◀</button>
        <input type="text" id="lMvS" value="${esc(show(p.start))}" aria-label="Start in inches from the left edge" title="Inches from the left edge of the blank">
        <button type="button" class="btn small" id="lMvR" aria-label="Move right">▶</button>
        <button type="button" class="btn small" id="lMvU" aria-label="Move up">▲</button><button type="button" class="btn small" id="lMvD" aria-label="Move down">▼</button></span>
      <span class="btn-row">${p.kind !== 'bmc' ? '<button type="button" class="btn small" id="lEditSel">Edit text</button>' : ''}${p.kind !== 'text' ? `<button type="button" class="btn small" id="lDims">${p.nodim ? 'Show distances' : 'Hide distances'}</button>` : ''}<button type="button" class="btn small" id="lHl">${p.hl ? 'Remove highlight' : 'Highlight'}</button>
      <button type="button" class="btn small danger" id="lDelSel">Delete</button><button type="button" class="btn small ghost" id="lDone">Done</button></span>`;
    $('#lHl').onclick = () => { p.hl = !p.hl; paintPlates(); update(); };
    $('#lMvP').onchange = (e) => { p.panel = +e.target.value; p.dy = 0; paintPlates(); update(); };
    $('#lMvL').onclick = () => nudge(-0.5);
    $('#lMvR').onclick = () => nudge(0.5);
    $('#lMvU').onclick = () => movePanel(-1);
    $('#lMvD').onclick = () => movePanel(1);
    $('#lMvS').onchange = (e) => { const v = pin(e.target.value); if (isFinite(v)) { p.start = e.target.value.trim(); nudge(0); } };
    if ($('#lDims')) $('#lDims').onclick = () => { p.nodim = !p.nodim; paintPlates(); update(); };
    if ($('#lEditSel')) $('#lEditSel').onclick = () => { const g = $(`#lSheet [data-pi="${sel}"]`); openEditor('item:' + sel, g || $('#lSheet')); };
    $('#lDelSel').onclick = () => delPlate(sel);
    $('#lDone').onclick = () => select(-1);
  } else if (undo) {
    bar.innerHTML = `<span>Deleted.</span><span class="btn-row"><button type="button" class="btn small" id="lUndo">Undo</button></span>`;
    $('#lUndo').onclick = () => { L.plates.splice(Math.min(undo.i, L.plates.length), 0, undo.p); const i = undo.i; undo = null; select(i); };
  } else bar.innerHTML = L.plates.length ? '<span class="hint">Drag a print, BMC or text to move it, or tap it and use the arrow keys / Move controls. Tap any words on the sheet to change them.</span>' : '';
}

function fill() {
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
  if (t.dataset.img !== undefined) { if (e.type === 'change' && t.files[0]) addImage(+t.dataset.img, t.files[0]); return; }
  if (t.dataset.l) { L[t.dataset.l] = t.value; if (t.dataset.l === 'widthPanels') paintPP(); update(); return; }
  const row = t.closest('[data-plate]');
  if (row) {
    const p = L.plates[+row.dataset.plate];
    const k = t.dataset.p;
    if (!p || !k) return;
    if (k === 'dims') { p.nodim = !t.checked; update(); return; }
    p[k] = k === 'flip' || k === 'hl' ? t.checked : k === 'panel' ? +t.value : t.value;
    if (k === 'test' || k === 'wall') { const r = BMC[p.wall === 'double' ? 'double' : 'single'][p.test === 'Mullen' ? 'Mullen' : 'ECT']; if (!r[p.rating]) p.rating = p.test === 'Mullen' ? (p.wall === 'double' ? '275' : '200') : (p.wall === 'double' ? '48' : '32'); }
    if (k === 'test' || k === 'wall' || k === 'rating') { paintPlates(); }
    update();
  }
}

function update() {
  saveForm('layout', L);
  const wp = nums(L.widthPanels), lp = nums(L.lengthPanels), bw = pin(L.blankW), bl = pin(L.blankL);
  const chk = (a, b, what) => !a.length ? '' : `Adds up to <b>${f(sum(a))}"</b>${isFinite(b) ? (near(sum(a), b) ? ` <span class="pill ok">matches the blank ${what}</span>` : ` <span class="pill warn">blank ${what} is ${f(b)}"</span>`) : ''}`;
  $('#lWChk').innerHTML = chk(wp, bw, 'width');
  $('#lLChk').innerHTML = lp.length ? chk(lp, bl, 'length').replace(/<span class="pill warn">blank length is ([^<]+)<\/span>/, (m, x) => `<span class="hint">scored length · blank is ${x}</span>`) : '';
  paintPP();
  $('#lSheet').innerHTML = sheetHtml(L, sel);
  paintSelBar();
  fit();
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
    let mid;
    if (kind === 'bmc') {
      const b = bmcOf(p), ratings = Object.keys(BMC[b.w][b.tst]);
      if (b.v && !ratings.includes(b.v)) ratings.unshift(b.v);
      mid = `<div class="field"><label>Test</label><select data-p="test">${opt('ECT', b.tst)}${opt('Mullen', b.tst, 'Mullen (burst)')}</select></div>
      <div class="field"><label>Wall</label><select data-p="wall">${opt('single', b.w, 'Single')}${opt('double', b.w, 'Double')}</select></div>
      <div class="field"><label>Rating</label><select data-p="rating">${ratings.map((r) => opt(r, b.v, b.tst === 'ECT' ? r + ' ECT' : r + ' lb')).join('')}</select></div>
      <div class="hint bmc-vals">${b.row ? `Size limit ${b.row[1]}" · Gross wt ${b.row[0]} lbs${b.row[2] ? ` · Facings ${b.row[2]} lbs/MSF` : ''}` : 'Not a standard rating. Check the values on the stamp.'}</div>`;
    } else if (kind === 'text') {
      mid = `<div class="field"><label>Size</label><select data-p="size">${opt('XS', p.size, 'Extra small')}${opt('S', p.size, 'Small')}${opt('M', p.size || 'M', 'Medium')}${opt('L', p.size, 'Large')}</select></div>
      <div class="field grow"><label>Text</label><textarea data-p="text" rows="2" placeholder="Type anything (Enter = new line)">${esc(p.text)}</textarea></div>`;
    } else {
      mid = `<div class="field"><label>Width (in)</label><input type="text" inputmode="decimal" data-p="width" value="${esc(p.width)}"></div>
      <div class="field grow"><label>Copy on the plate</label><textarea data-p="text" rows="2">${esc(p.text)}</textarea></div>
      <div class="plate-img">${p.img ? `<img src="${p.img}" alt="Logo">` : ''}<label class="btn small">${p.img ? 'Change image' : 'Add image'}<input type="file" accept="image/*" hidden data-img="${i}"></label>${p.img ? `<button type="button" class="btn small ghost" data-noimg="${i}">Remove image</button>` : ''}</div>`;
    }
    return `
    <div class="plate-row k-${kind}${i === sel ? ' sel' : ''}" data-plate="${i}">
      ${head}
      ${mid}
      <label class="chk"><input type="checkbox" data-p="flip" ${p.flip ? 'checked' : ''}> Upside down</label>
      <label class="chk"><input type="checkbox" data-p="hl" ${p.hl ? 'checked' : ''}> Highlight</label>
      ${kind !== 'text' ? `<label class="chk"><input type="checkbox" data-p="dims" ${p.nodim ? '' : 'checked'}> Distances</label>` : ''}
      <button type="button" class="btn small ghost danger" data-del="${i}" aria-label="Remove">✕</button>
    </div>`; }).join('') : '<p class="hint" style="margin:0">Nothing on the sheet yet.</p>';
  $$('[data-del]', $('#lPlates')).forEach((b) => b.onclick = () => delPlate(+b.dataset.del));
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
function toLogo(src, sx, sy, sw, sh, flip = false) {
  sx = Math.max(0, Math.round(sx)); sy = Math.max(0, Math.round(sy));
  sw = Math.min(src.width - sx, Math.round(sw)); sh = Math.min(src.height - sy, Math.round(sh));
  if (sw < 4 || sh < 4) return '';
  // trim near-white margins
  const d = src.getContext('2d').getImageData(sx, sy, sw, sh).data;
  let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = (y * sw + x) * 4;
    if (d[i] + d[i + 1] + d[i + 2] < 600) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 > x0 && y1 > y0) { const m = 3; sx += Math.max(0, x0 - m); sy += Math.max(0, y0 - m); sw = Math.min(x1 - x0 + 2 * m, src.width - sx); sh = Math.min(y1 - y0 + 2 * m, src.height - sy); }
  const k = Math.min(1, 520 / sw);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  if (flip) { g.translate(c.width, c.height); g.rotate(Math.PI); }
  g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}
function paintDetails() {
  const tb = $('#lDetTexts');
  if (tb) {
    tb.innerHTML = L.detailTexts.map((x, i) => `<div class="det-text"><textarea rows="3" data-dtx="${i}" placeholder="e.g. Fabri-Cote address, Black ink only">${esc(x)}</textarea><button type="button" class="btn small ghost danger" data-dtrm="${i}" aria-label="Remove text box">✕</button></div>`).join('');
    $$('[data-dtx]', tb).forEach((ta) => ta.oninput = () => { L.detailTexts[+ta.dataset.dtx] = ta.value; update(); });
    $$('[data-dtrm]', tb).forEach((b) => b.onclick = () => { L.detailTexts.splice(+b.dataset.dtrm, 1); paintDetails(); update(); });
    const add = $('#lDetTextAdd'); if (add) add.disabled = L.detailTexts.length >= 4;
  }
  const box = $('#lDetPics');
  if (!box) return;
  box.innerHTML = L.details.map((d, i) => `<div class="det-pic"><img src="${d.img}" alt="Close-up"><input type="text" data-dcap="${i}" value="${esc(d.caption || '')}" placeholder="Caption (optional)"><button type="button" class="btn small ghost danger" data-drm="${i}" aria-label="Remove picture">✕</button></div>`).join('');
  $$('[data-drm]', box).forEach((b) => b.onclick = () => { L.details.splice(+b.dataset.drm, 1); paintDetails(); update(); });
  $$('[data-dcap]', box).forEach((inp) => inp.oninput = () => { L.details[+inp.dataset.dcap].caption = inp.value; update(); });
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
      const url = toLogo(c, b[0] * W - padX, b[1] * H - padY, (b[2] - b[0]) * W + 2 * padX, (b[3] - b[1]) * H + 2 * padY, !!p.flip);
      if (url) { p.img = url; n++; }
    } catch (e) { console.warn('logo cut', e); }
  }
  L.plates.forEach((p) => delete p._ai);
  return n;
}

// ---- edit text right on the sheet ----
const LABELS = { customer: 'Customer', shipTo: 'Ship to', fileNo: 'File #', design: 'Design no.', ident: 'Ident', style: 'Style', size: 'Size (L × W × D)', board: 'Board / flute',
  blank: 'Blank size (width x length)',  print: 'Print / ink', routing: 'Routing', view: 'View', origDate: 'Original date', revDate: 'Revised', sales: 'Sales', designer: 'Designer', approved: 'Approved by' };
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

// ---- drag items on the sheet ----
function startDrag(e) {
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
        width: wIn ? fx(wIn) : '', text: str(p.text), flip: !!p.upside_down, kind: 'plate', _ai: k,
      };
    });
    const texts = arr(r.texts).filter((x) => x && str(x.text)).map((x) => ({ kind: 'text', panel: Math.max(1, parseInt(x.panel, 10) || 1), start: startOf(x, textIn(x.text)), text: str(x.text).split('\n').map((y) => y.trim()).filter(Boolean).join('\n'), size: 'M', flip: !!x.upside_down })).filter((x) => x.start !== '');
    let pp = arr(r.printed_panels).map((x) => parseInt(x, 10)).filter((x) => x >= 1 && (!n || x <= n));
    if (!pp.length) pp = [...new Set(plates.map((p) => p.panel))].sort((a, b) => a - b);
    L = {
      ...EMPTY(),
      customer: str(r.customer), shipTo: str(r.ship_to), fileNo: str(r.file_no), specNo: str(r.spec_no), design: str(r.design_no),
      ident: str(r.ident), style: str(r.style), size: str(r.size), board: str(r.board),
      blankW: show(r.blank_width), blankL: show(r.blank_length), print: str(r.print), routing: str(r.routing),
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

function addEdits() {
  const o = L.orig;
  const out = $('#lEditsMsg');
  if (!o) { out.textContent = 'Upload an old layout first. Edits are compared to what was read from it.'; return; }
  const have = list(L.changes.replace(/\n/g, ';'));
  const lines = [];
  for (const [k, t] of TRACK) {
    const a = String(o[k] || '').trim(), b = String(L[k] || '').trim();
    if (a === b) continue;
    const pretty = (s) => (k.endsWith('Panels') ? list(s).map(show).join(' | ') : s) || 'blank';
    const line = k.endsWith('Panels') ? `${t} updated to ${pretty(b)} (old sheet: ${pretty(a)})` : `${t} updated: ${pretty(a)} -> ${pretty(b)}`;
    if (!L.changes.includes(line)) lines.push(line);
  }
  if (!lines.length) { out.textContent = have.length ? 'No new edits to add.' : 'Nothing changed from the old sheet yet.'; return; }
  L.changes = (L.changes.trim() ? L.changes.trim() + '\n' : '') + lines.join('\n');
  $('[data-l="changes"]').value = L.changes;
  out.textContent = `Added ${lines.length} line${lines.length > 1 ? 's' : ''}.`;
  update();
}

// ---- the sheet ----
function sheetHtml(d, selIdx = -1, opt = {}) {
  const cell = (t, v, k) => `<div class="ls-cell" data-edit="${k}"><span>${t}</span><b>${esc(v) || '&nbsp;'}</b></div>`;
  const blank = d.blankW || d.blankL ? `${show(d.blankW) || '?'} x ${show(d.blankL) || '?'}` : '';
  const notes = d.notes.split('\n').map((x) => x.trim()).filter(Boolean);
  // close-ups: plate logos (once each) + pictures added for the detail box, at most 3
  const seen = new Set(), pics = [];
  if (d.detailLogos !== false) (d.plates || []).forEach((p) => { if (p.kind === 'plate' && p.img && !seen.has(p.img)) { seen.add(p.img); pics.push({ img: p.img, caption: `P${p.panel}${p.text ? ' · ' + String(p.text).split('\n')[0] : ''}` }); } });
  (d.details || []).forEach((x) => x && x.img && pics.push({ img: x.img, caption: x.caption || '' }));
  pics.splice(3);
  const allT = Array.isArray(d.detailTexts) ? d.detailTexts : d.detailText ? [d.detailText] : [];
  const dtexts = allT.map((x, k) => ({ x: String(x || ''), k })).filter((o) => o.x.trim()).slice(0, 4);
  const changes = d.changes.split('\n').map((x) => x.trim().replace(/^[-•]\s*/, '')).filter(Boolean);
  const head2 = [d.specNo && `Spec # ${esc(d.specNo)}`, d.fileNo && `File # ${esc(d.fileNo)}`].filter(Boolean).join('&nbsp; | &nbsp;');
  return `<div class="lsheet${opt.print ? ' ls-print' : ''}">
    <div class="ls-top"><div class="ls-title">PRINT LAYOUT SHEET</div><div class="ls-co">GoldenWest Packaging Group&nbsp; | &nbsp;Ontario, CA${head2 ? `<br>${head2}` : ''}</div></div>
    <div class="ls-grid">
      ${cell('CUSTOMER', d.customer, 'customer')}${cell('SHIP TO', d.shipTo, 'shipTo')}${cell('FILE #', d.fileNo, 'fileNo')}
      ${cell('DESIGN NO.', d.design, 'design')}${cell('IDENT', d.ident, 'ident')}${cell('STYLE', d.style, 'style')}
      ${cell('SIZE (L X W X D)', d.size, 'size')}${cell('BOARD / FLUTE', d.board, 'board')}${cell('BLANK SIZE', blank, 'blank')}
      ${cell('PRINT', d.print, 'print')}${cell('ROUTING', d.routing, 'routing')}${cell('VIEW', d.view, 'view')}
    </div>
    <div class="ls-h">BLANK LAYOUT &amp; PRINT PLACEMENT <i>${esc(d.view)} view - not to scale (height exaggerated for readability). Dimensions in inches.</i></div>
    ${drawing(d, selIdx, opt.H)}
    <div class="ls-boxes"${opt.boxesH ? ` style="min-height:${opt.boxesH}px"` : ''}>
      <div class="ls-box"><div class="ls-bh">PRINT &amp; PRODUCTION NOTES</div><ol>${notes.map((x, k) => `<li data-edit="notes:${k}">${esc(x)}</li>`).join('')}<li class="ls-add" data-edit="notes:new">+ add note</li></ol></div>
      <div class="ls-box ls-detail"><div class="ls-bh">PRINT DETAIL (ZOOMED IN)</div>
        ${pics.length ? `<div class="ls-pics">${pics.map((x) => `<figure><img src="${x.img}" alt=""><figcaption>${esc(x.caption)}</figcaption></figure>`).join('')}</div>` : '<div class="ls-empty ls-nopic">No close-up yet. Add one under "Print detail box", or add a logo to a plate.</div>'}
        <div class="ls-dtexts">${dtexts.map((o) => `<div class="ls-dtext" data-edit="dtext:${o.k}">${esc(o.x).replace(/\n/g, '<br>')}</div>`).join('')}${allT.length < 4 ? '<div class="ls-dtext ls-dnew" data-edit="dtext:new"><span class="ls-add">+ add text box</span></div>' : ''}</div></div>
    </div>
    <div class="ls-foot">${[['ORIGINAL DATE', d.origDate, 'origDate'], ['REVISED', d.revDate, 'revDate'], ['SALES', d.sales, 'sales'], ['DESIGNER', d.designer, 'designer'], ['APPROVED BY', d.approved, 'approved']].map(([t, v, k]) => `<div data-edit="${k}"><span>${t}</span><b>${esc(v) || '&nbsp;'}</b></div>`).join('')}</div>
  </div>`;
}

// SVG of the blank: width panels as rows (height exaggerated), length scores as columns, plates and the gaps between them.
let mkSeq = 0;
function drawing(d, selIdx = -1, drawH = 270) {
  const uid = 'm' + (++mkSeq) + '-'; // own arrowhead ids per copy (the hidden preview's ids would not print)
  const x0 = 64, x1 = 850, y0 = 14, H = drawH || 270;
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
  const RED = '#c0392b', INK = '#222', DASH = 'stroke-dasharray="6 4"';
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
    const w = p.kind === 'plate' && isFinite(pin(p.width)) && pin(p.width) > 0 ? pin(p.width) : p.kind === 'bmc' ? 1 : (Math.max(...String(p.text || 'TEXT').split('\n').map((x) => x.trim().length)) * ({ XS: 6, S: 8, M: 11, L: 15 }[p.size] || 11) * 0.6 + 6) / ((x1 - x0) / totL);
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
    if (xg - x0 >= 9 && bB - bT > 40) o.push(t((x0 + xg) / 2 + 2.5, (bT + bB) / 2, 'GLUE TAB', { size: 6.5, weight: 700, fill: '#555', tr: `rotate(-90 ${((x0 + xg) / 2 + 2.5).toFixed(1)} ${((bT + bB) / 2).toFixed(1)})` }));
  } else o.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${H}" fill="none" stroke="${INK}" stroke-width="1.6"/>`);
  R.slice(1).forEach((r) => o.push(`<line x1="${xg.toFixed(1)}" y1="${r.y.toFixed(1)}" x2="${x1}" y2="${r.y.toFixed(1)}" stroke="${INK}" ${DASH}/>`));
  scores.slice(1, -1).forEach((sc) => {
    const x = X(sc).toFixed(1);
    if (!tab) { o.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${yE}" stroke="${INK}" ${DASH}/>`); return; }
    R.forEach((r, i) => o.push(flap.has(i)
      ? `<line x1="${x}" y1="${r.y.toFixed(1)}" x2="${x}" y2="${(r.y + r.h).toFixed(1)}" stroke="${INK}" stroke-width="1.4"/>` // slot (cut)
      : `<line x1="${x}" y1="${r.y.toFixed(1)}" x2="${x}" y2="${(r.y + r.h).toFixed(1)}" stroke="${INK}" ${DASH}/>`));
  });

  // panel names (left) and sizes (right)
  R.forEach((r, i) => {
    const pr = shadedRows.has(i);
    o.push(t(x0 - 14, r.m + 3.5, `P${i + 1}${pr ? ' *' : ''}`, { anchor: 'end', fill: pr ? RED : '#888', size: 10 }));
    o.push(`<line x1="${x1 + 4}" y1="${r.y.toFixed(1)}" x2="${x1 + 14}" y2="${r.y.toFixed(1)}" stroke="${INK}"/>`);
    if (wp.length) o.push(t(x1 + 40, r.m + 3.5, f(rows[i]), { size: 10, weight: 600 }));
  });
  o.push(`<line x1="${x1 + 4}" y1="${y0 + H}" x2="${x1 + 14}" y2="${y0 + H}" stroke="${INK}"/>`);
  o.push(`<line x1="${x1 + 84}" y1="${y0}" x2="${x1 + 84}" y2="${y0 + H}" stroke="${INK}" marker-start="url(#${uid}lak)" marker-end="url(#${uid}lak)"/>`);
  o.push(t(x1 + 100, y0 + H / 2, f(wp.length ? totW : bw) || '', { size: 11, weight: 700, tr: `rotate(90 ${x1 + 100} ${y0 + H / 2})` }));

  // length dims
  const yb = y0 + H + 18;
  if (lp.length) {
    lp.forEach((v, i) => { o.push(arrow(X(scores[i]) + 1, X(scores[i + 1]) - 1, yb, INK)); const a = X(scores[i]), b = X(scores[i + 1]), lab = f(v), narrow = b - a < lab.length * 6 + 6;
      o.push(narrow ? t(i === 0 ? a - 4 : b + 4, yb + 3.5, lab, { size: 10, weight: 600, anchor: i === 0 ? 'end' : 'start' }) : t((a + b) / 2, yb - 4, lab, { size: 10, weight: 600 })); });
    scores.forEach((s) => o.push(`<line x1="${X(s).toFixed(1)}" y1="${y0 + H + 4}" x2="${X(s).toFixed(1)}" y2="${yb + 6}" stroke="${INK}"/>`));
  }
  const blankNote = isFinite(bl) && bl > 0 && lp.length && !near(bl, totL) ? ` (blank ${f(bl)})` : '';
  o.push(t((x0 + x1) / 2, yb + 22, lp.length ? `${f(totL)} scored length${blankNote}` : isFinite(bl) && bl > 0 ? `${f(bl)} blank length` : '', { size: 10.5, weight: 600 }));

  // plates
  const plates = (d.plates || []).map((p, i) => ({ ...p, i, s: pin(p.start), w: pin(p.width) })).filter((p) => isFinite(p.s) && p.panel >= 1 && p.panel <= R.length);
  const pxIn = (x1 - x0) / totL;
  plates.forEach((p) => {
    const r = R[p.panel - 1];
    const m = r.m + Math.max(-0.45, Math.min(0.45, +p.dy || 0)) * r.h; // up/down inside the panel
    p.cy = m;
    const selBox = (x, y, w, h) => { if (p.i === selIdx) o.push(`<rect x="${(x - 4).toFixed(1)}" y="${(y - 4).toFixed(1)}" width="${(w + 8).toFixed(1)}" height="${(h + 8).toFixed(1)}" rx="3" fill="none" stroke="#1a73e8" stroke-width="2.5" stroke-dasharray="5 3" pointer-events="none"/>`); };
    const rot = (cx) => (p.flip ? ` transform="rotate(180 ${cx.toFixed(1)} ${m.toFixed(1)})"` : '');
    if (p.kind === 'text') {
      const fs = { XS: 6, S: 8, M: 11, L: 15 }[p.size] || 11;
      let ls = String(p.text || '').split('\n').map((x) => x.trim()).filter(Boolean);
      if (!ls.length) ls = ['TEXT'];
      const lh = fs * 1.2, hh = ls.length * lh + fs * 0.3;
      const w = Math.max(...ls.map((x) => x.length)) * fs * 0.6 + 6, xa = X(p.s), y = m - hh / 2;
      const base = m - ((ls.length - 1) * lh) / 2 + fs * 0.35;
      o.push(`<g class="ls-plate" data-pi="${p.i}"><g${rot(xa + w / 2)}><rect x="${xa.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" fill="${p.hl ? '#ffeb3b' : '#fff'}" fill-opacity="${p.hl ? 1 : 0}"/>${ls.map((x, k) => t(xa + 3, base + k * lh, x, { size: fs, weight: 700, anchor: 'start' })).join('')}</g></g>`);
      selBox(xa, y, w, hh);
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
    const h = Math.min(r.h * 0.8, 52), y = m - h / 2;
    const cx = (xa + xb) / 2;
    const fs = h < 26 ? 7 : 8.5;
    const per = Math.max(4, Math.floor((xb - xa - 8) / (fs * 0.64)));
    const maxL = Math.max(1, Math.floor((h - 4) / (fs + 1.5)));
    const lines = String(p.text || '').toUpperCase().split('\n').flatMap((x) => wrap(x, per)).slice(0, maxL);
    const y1 = m - ((lines.length - 1) * (fs + 1.5)) / 2 + fs * 0.35;
    const txt = p.img
      ? `<image href="${p.img}" x="${(xa + 2).toFixed(1)}" y="${(y + 2).toFixed(1)}" width="${(xb - xa - 4).toFixed(1)}" height="${(h - 4).toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>`
      : lines.map((ln, k) => t(cx, y1 + k * (fs + 1.5), ln, { size: fs, weight: 600 })).join('');
    o.push(`<g class="ls-plate" data-pi="${p.i}"><g${p.flip ? ` transform="rotate(180 ${cx.toFixed(1)} ${m.toFixed(1)})"` : ''}><rect x="${xa.toFixed(1)}" y="${y.toFixed(1)}" width="${(xb - xa).toFixed(1)}" height="${h.toFixed(1)}" fill="${p.hl ? '#ffeb3b' : '#fff'}" stroke="${INK}" stroke-width="1.3"/>${txt}</g></g>`);
    selBox(xa, y, xb - xa, h);
    p.xa = xa; p.xb = xb; p.e = p.s + w;
  });
  // gaps: from the nearest score (or plate) on the left of each plate, and from the last plate to the next score
  for (let i = 1; i <= R.length; i++) {
    const row = plates.filter((p) => p.panel === i && !p.skip && !p.nodim).sort((a, b) => a.s - b.s);
    if (!row.length) continue;
    let prevEnd = null, prevKind = '';
    row.forEach((p, k) => {
      const sc = scores.filter((s) => s <= p.s + 1e-6).pop() ?? 0;
      const fromPlate = prevEnd !== null && prevEnd >= sc - 1e-6;
      const a = fromPlate ? prevEnd : sc;
      const gap = p.s - a;
      const y = p.cy;
      if (gap > 0.01) gapMark(o, X(a), p.xa, y, fromPlate && prevKind !== 'bmc' && p.kind !== 'bmc' ? `${f(gap)}" between plates` : `${f(gap)}"`, RED, t, arrow);
      prevEnd = Math.max(prevEnd ?? -Infinity, p.e); prevKind = p.kind;
      // gap to the next score, when that score comes before the next plate
      const next = row[k + 1], scR = scores.find((s) => s >= p.e - 1e-6) ?? totL;
      if ((!next || scR <= next.s + 1e-6) && scR - p.e > 0.01) { gapMark(o, p.xb, X(scR), y, `${f(scR - p.e)}"`, RED, t, arrow); prevEnd = scR; }
    });
  }

  const mk = (id, c) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L10 5L0 9z" fill="${c}"/></marker>`;
  return `<svg class="ls-svg" data-x0="${x0}" data-x1="${x1}" data-totl="${totL}" data-rows="${R.map((r) => r.y.toFixed(1) + ',' + r.h.toFixed(1)).join(';')}" viewBox="0 0 1000 ${yb + 34}" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif"><defs>${mk(uid + 'lak', INK)}${mk(uid + 'lar', RED)}</defs>${o.join('')}</svg>`;
}

function gapMark(o, xa, xb, y, label, c, t, arrow) {
  if (xb - xa < 8) return;
  o.push(arrow(xa + 1, xb - 1, y, c));
  const w = label.length * 5.4 + 8, cx = (xa + xb) / 2;
  if (xb - xa < w + 24) { // short gap: label sits above the arrow so the arrow stays visible
    o.push(`<rect x="${(cx - w / 2).toFixed(1)}" y="${(y - 17).toFixed(1)}" width="${w.toFixed(1)}" height="11" fill="#fff" fill-opacity=".85"/>`);
    o.push(t(cx, y - 8, label, { size: 9, fill: c, weight: 700 }));
    return;
  }
  o.push(`<rect x="${(cx - w / 2).toFixed(1)}" y="${(y - 6.5).toFixed(1)}" width="${w.toFixed(1)}" height="13" fill="#fff"/>`);
  o.push(t(cx, y + 3.5, label, { size: 9.5, fill: c, weight: 700 }));
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
  const AVAIL = 736;
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
    const extra = AVAIL - m0.h, add = Math.min(extra, 260);
    o = { H: 270 + add, boxesH: extra - add > 4 ? m0.boxes + (extra - add) : 0 };
  } else {
    // too tall: make the drawing shorter first (its height is exaggerated anyway), then shrink only what is left over
    const H = Math.max(150, 270 - (m0.h - AVAIL));
    o = { H };
    const m1 = measure(o);
    if (m1.h > AVAIL) k = Math.min(0.998, AVAIL / m1.h);
  }
  openPrint(`<style>@page{size:letter landscape;margin:0.3in}</style><div class="lsheet-print" style="zoom:${k.toFixed(3)}">${sheetHtml(L, -1, { print: true, ...o })}</div>`);
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
    const { orig, ...body } = L;
    await api('/api/layouts?id=' + encodeURIComponent(L.id), { method: 'PUT', body: JSON.stringify({ ...body, updatedBy: name }) });
    saveForm('layout', L);
    msg.innerHTML = '<div class="alert ok">Saved. Anyone can open it from Saved layouts.</div>';
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
