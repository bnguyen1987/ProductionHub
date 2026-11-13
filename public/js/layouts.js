// Print Layouts: upload an old print layout / spec sheet, the AI reads it, and the page redraws it as a clean new spec sheet.
// Draft stays in this browser (localStorage). Saved layouts go to /api/layouts so anyone can open and reprint them.
import { $, $$, esc, api, fileToPayload, setupDrop, parseInches, fmtIn, saveForm, loadForm } from './common.js';
import { openPrint } from './printkit.js';

const today = () => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`; };
const EMPTY = () => ({
  id: '', customer: '', shipTo: '', fileNo: '', specNo: '', design: '', ident: '', style: '', size: '', board: '',
  blankW: '', blankL: '', print: '', routing: '', view: 'Outside', widthPanels: '', lengthPanels: '',
  printPanels: [], plates: [], notes: '', changes: '', origDate: '', revDate: today(), sales: '', designer: '', approved: '', orig: null,
});
const INFO = [
  ['customer', 'Customer'], ['shipTo', 'Ship to'], ['fileNo', 'File #'], ['specNo', 'Spec #'],
  ['design', 'Design no.'], ['ident', 'Ident'], ['style', 'Style'], ['size', 'Size (L × W × D)'],
  ['board', 'Board / flute'], ['print', 'Print / ink'], ['routing', 'Routing'],
];
// Fields compared by "Add my edits"
const TRACK = [['style', 'Style'], ['size', 'Size'], ['board', 'Board'], ['blankW', 'Blank width'], ['blankL', 'Blank length'], ['print', 'Print'], ['routing', 'Routing'], ['widthPanels', 'Panel scores'], ['lengthPanels', 'Length scores']];

let L, view, saved = [], ro = null;

// ---- inches ----
const pin = (s) => parseInches(String(s ?? '').replace(/["”]/g, '').trim());
const f = (x) => fmtIn(x, '');
const fx = (x) => (Math.abs(x * 16 - Math.round(x * 16)) < 0.02 ? f(x) : String(+x.toFixed(3)));
const show = (s) => { const v = pin(s); return isFinite(v) ? f(v) : String(s ?? '').trim(); };
const list = (s) => String(s || '').split(/[,|;]/).map((x) => x.trim()).filter(Boolean);
const nums = (s) => list(s).map(pin).filter((v) => isFinite(v) && v > 0);
const sum = (a) => a.reduce((t, v) => t + v, 0);
const near = (a, b) => Math.abs(a - b) < 1 / 32;

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
            <input type="file" accept="application/pdf,image/*" aria-label="Upload old layout">
            <div class="big">Drop a PDF or take a photo of the old layout</div>
            <div class="hint">Handwritten changes on the sheet are picked up too</div>
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
          <div class="field" style="margin-top:10px"><label>Changes from the old sheet (one per line)</label><textarea data-l="changes" rows="4"></textarea></div>
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
          <div class="lbl" style="margin:4px 0 6px">Printed panels</div>
          <div class="seg" id="lPP"></div>
          <div class="lbl" style="margin:14px 0 6px">Print plates <span class="hint" style="font-weight:500">start = inches from the left edge of the blank</span></div>
          <div id="lPlates"></div>
          <button type="button" class="btn small" id="lAddPlate" style="margin-top:8px">+ Add plate</button>
        </section>
        </div>
      </div>
    </div>`;

  setupDrop($('#lDrop'), readLayout);
  view.addEventListener('input', onInput);
  view.addEventListener('change', onInput);
  $('#lAddPlate').onclick = () => { L.plates.push({ panel: L.printPanels[0] || 1, start: '', width: '', text: '', flip: false }); paintPlates(); update(); };
  $('#lEdits').onclick = addEdits;
  $('#lPrint').onclick = printSheet;
  $('#lSave').onclick = save;
  $('#lNew').onclick = () => { if (!confirm('Clear this layout and start over?')) return; L = EMPTY(); fill(); $('#lAiMsg').innerHTML = ''; $('#lSaveMsg').innerHTML = ''; };
  $('#lFind').oninput = paintList;
  $('#lName').value = loadForm('layout_name') || '';
  ro = new ResizeObserver(fit);
  ro.observe($('#lWrap'));
  fill();
  loadList();
}

export function destroy() { if (ro) ro.disconnect(); ro = null; }

function fill() {
  $$('[data-l]', view).forEach((el) => { el.value = L[el.dataset.l] ?? ''; });
  paintPlates();
  update();
}

function onInput(e) {
  const t = e.target;
  if (t.dataset.l) { L[t.dataset.l] = t.value; if (t.dataset.l === 'widthPanels') paintPP(); update(); return; }
  const row = t.closest('[data-plate]');
  if (row) {
    const p = L.plates[+row.dataset.plate];
    const k = t.dataset.p;
    if (!p || !k) return;
    p[k] = k === 'flip' ? t.checked : k === 'panel' ? +t.value : t.value;
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
  $('#lSheet').innerHTML = sheetHtml(L);
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
  $('#lPlates').innerHTML = L.plates.length ? L.plates.map((p, i) => `
    <div class="plate-row" data-plate="${i}">
      <div class="field"><label>Panel</label><select data-p="panel">${Array.from({ length: Math.max(n, p.panel) }, (_, k) => `<option value="${k + 1}" ${p.panel === k + 1 ? 'selected' : ''}>P${k + 1}</option>`).join('')}</select></div>
      <div class="field"><label>Start (in)</label><input type="text" inputmode="decimal" data-p="start" value="${esc(p.start)}"></div>
      <div class="field"><label>Width (in)</label><input type="text" inputmode="decimal" data-p="width" value="${esc(p.width)}"></div>
      <div class="field grow"><label>Copy on the plate</label><input type="text" data-p="text" value="${esc(p.text)}"></div>
      <label class="chk"><input type="checkbox" data-p="flip" ${p.flip ? 'checked' : ''}> Upside down</label>
      <button type="button" class="btn small ghost danger" data-del="${i}" aria-label="Remove plate">✕</button>
    </div>`).join('') : '<p class="hint" style="margin:0">No plates yet.</p>';
  $$('[data-del]', $('#lPlates')).forEach((b) => b.onclick = () => { L.plates.splice(+b.dataset.del, 1); paintPlates(); update(); });
}

function fit() {
  const wrap = $('#lWrap'), sh = wrap && wrap.firstElementChild && wrap.querySelector('.lsheet');
  if (!sh) return;
  const k = Math.min(1, wrap.clientWidth / 1000);
  sh.style.transform = `scale(${k})`;
  wrap.style.height = Math.ceil(sh.offsetHeight * k) + 'px';
}

// ---- AI read ----
async function readLayout(file) {
  const msg = $('#lAiMsg');
  msg.innerHTML = `<div class="alert info"><span class="spinner"></span> Reading ${esc(file.name)}… this can take 20–40 seconds.</div>`;
  try {
    const payload = await fileToPayload(file);
    const { result: r } = await api('/api/ai', { method: 'POST', body: JSON.stringify({ task: 'layout', ...payload }) });
    const str = (x) => (x === null || x === undefined ? '' : String(x).trim());
    const arr = (x) => (Array.isArray(x) ? x : []);
    const n = arr(r.width_panels).length;
    const plates = arr(r.plates).map((p) => ({
      panel: Math.max(1, parseInt(p.panel, 10) || 1), start: isFinite(+p.start_in) && p.start_in !== null ? fx(+p.start_in) : '',
      width: isFinite(+p.width_in) && p.width_in ? fx(+p.width_in) : '', text: str(p.text), flip: !!p.upside_down,
    }));
    let pp = arr(r.printed_panels).map((x) => parseInt(x, 10)).filter((x) => x >= 1 && (!n || x <= n));
    if (!pp.length) pp = [...new Set(plates.map((p) => p.panel))].sort((a, b) => a - b);
    L = {
      ...EMPTY(),
      customer: str(r.customer), shipTo: str(r.ship_to), fileNo: str(r.file_no), specNo: str(r.spec_no), design: str(r.design_no),
      ident: str(r.ident), style: str(r.style), size: str(r.size), board: str(r.board),
      blankW: show(r.blank_width), blankL: show(r.blank_length), print: str(r.print), routing: str(r.routing),
      view: r.view === 'Inside' ? 'Inside' : 'Outside',
      widthPanels: arr(r.width_panels).map(show).join(', '), lengthPanels: arr(r.length_panels).map(show).join(', '),
      printPanels: pp, plates, notes: arr(r.notes).map(str).filter(Boolean).join('\n'), changes: arr(r.changes).map(str).filter(Boolean).join('\n'),
      origDate: str(r.original_date), sales: str(r.sales), designer: str(r.designer),
    };
    L.orig = Object.fromEntries(TRACK.map(([k]) => [k, L[k]]));
    fill();
    const miss = [];
    if (!L.widthPanels) miss.push('panel scores');
    if (!(L.blankW && L.blankL)) miss.push('blank size');
    const low = r.confidence === 'low';
    msg.innerHTML = `<div class="alert ${miss.length || low ? 'warn' : 'ok'}">Read the layout.${miss.length ? ` Could not find: ${miss.join(', ')}. Fill those in below.` : ' Check every number against the old sheet.'}${r.unclear ? ` <br><b>Hard to read:</b> ${esc(r.unclear)}` : ''}</div>`;
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
function sheetHtml(d) {
  const cell = (t, v) => `<div class="ls-cell"><span>${t}</span><b>${esc(v) || '&nbsp;'}</b></div>`;
  const blank = d.blankW || d.blankL ? `${show(d.blankW) || '?'} x ${show(d.blankL) || '?'}` : '';
  const notes = d.notes.split('\n').map((x) => x.trim()).filter(Boolean);
  const changes = d.changes.split('\n').map((x) => x.trim().replace(/^[-•]\s*/, '')).filter(Boolean);
  const head2 = [d.specNo && `Spec # ${esc(d.specNo)}`, d.fileNo && `File # ${esc(d.fileNo)}`].filter(Boolean).join('&nbsp; | &nbsp;');
  return `<div class="lsheet">
    <div class="ls-top"><div class="ls-title">SPECIFICATION SHEET</div><div class="ls-co">GoldenWest Packaging Group&nbsp; | &nbsp;Ontario, CA${head2 ? `<br>${head2}` : ''}</div></div>
    <div class="ls-grid">
      ${cell('CUSTOMER', d.customer)}${cell('SHIP TO', d.shipTo)}${cell('FILE #', d.fileNo)}
      ${cell('DESIGN NO.', d.design)}${cell('IDENT', d.ident)}${cell('STYLE', d.style)}
      ${cell('SIZE (L X W X D)', d.size)}${cell('BOARD / FLUTE', d.board)}${cell('BLANK SIZE', blank)}
      ${cell('PRINT', d.print)}${cell('ROUTING', d.routing)}${cell('VIEW', d.view)}
    </div>
    <div class="ls-h">BLANK LAYOUT &amp; PRINT PLACEMENT <i>${esc(d.view)} view - not to scale (height exaggerated for readability). Dimensions in inches.</i></div>
    ${drawing(d)}
    <div class="ls-boxes">
      <div class="ls-box"><div class="ls-bh">PRINT &amp; PRODUCTION NOTES</div><ol>${notes.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="ls-empty">No notes</li>'}</ol></div>
      <div class="ls-box"><div class="ls-bh">REVISION - CHANGES${d.origDate ? ` FROM ${esc(d.origDate)} SHEET` : ''}</div><ul>${changes.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="ls-empty">No changes listed</li>'}</ul></div>
    </div>
    <div class="ls-foot">${[['ORIGINAL DATE', d.origDate], ['REVISED', d.revDate], ['SALES', d.sales], ['DESIGNER', d.designer], ['APPROVED BY', d.approved]].map(([t, v]) => `<div><span>${t}</span><b>${esc(v) || '&nbsp;'}</b></div>`).join('')}</div>
  </div>`;
}

// SVG of the blank: width panels as rows (height exaggerated), length scores as columns, plates and the gaps between them.
function drawing(d) {
  const x0 = 64, x1 = 850, y0 = 14, H = 270;
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
  const arrow = (xa, xb, y, c) => `<line x1="${xa.toFixed(1)}" y1="${y.toFixed(1)}" x2="${xb.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${c}" stroke-width="1" marker-start="url(#la${c === RED ? 'r' : 'k'})" marker-end="url(#la${c === RED ? 'r' : 'k'})"/>`;

  // printed rows, outline, scores
  R.forEach((r, i) => { if (pp.has(i + 1)) o.push(`<rect x="${x0}" y="${r.y.toFixed(1)}" width="${x1 - x0}" height="${r.h.toFixed(1)}" fill="#e6eef7"/>`); });
  o.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${H}" fill="none" stroke="${INK}" stroke-width="1.6"/>`);
  R.slice(1).forEach((r) => o.push(`<line x1="${x0}" y1="${r.y.toFixed(1)}" x2="${x1}" y2="${r.y.toFixed(1)}" stroke="${INK}" ${DASH}/>`));
  scores.slice(1, -1).forEach((s) => o.push(`<line x1="${X(s).toFixed(1)}" y1="${y0}" x2="${X(s).toFixed(1)}" y2="${y0 + H}" stroke="${INK}" ${DASH}/>`));

  // panel names (left) and sizes (right)
  R.forEach((r, i) => {
    const pr = pp.has(i + 1);
    o.push(t(x0 - 14, r.m + 3.5, `P${i + 1}${pr ? ' *' : ''}`, { anchor: 'end', fill: pr ? RED : '#888', size: 10 }));
    o.push(`<line x1="${x1 + 4}" y1="${r.y.toFixed(1)}" x2="${x1 + 14}" y2="${r.y.toFixed(1)}" stroke="${INK}"/>`);
    if (wp.length) o.push(t(x1 + 40, r.m + 3.5, f(rows[i]), { size: 10, weight: 600 }));
  });
  o.push(`<line x1="${x1 + 4}" y1="${y0 + H}" x2="${x1 + 14}" y2="${y0 + H}" stroke="${INK}"/>`);
  o.push(`<line x1="${x1 + 84}" y1="${y0}" x2="${x1 + 84}" y2="${y0 + H}" stroke="${INK}" marker-start="url(#lak)" marker-end="url(#lak)"/>`);
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
  const plates = (d.plates || []).map((p) => ({ ...p, s: pin(p.start), w: pin(p.width) })).filter((p) => isFinite(p.s) && p.panel >= 1 && p.panel <= R.length);
  plates.forEach((p) => {
    const r = R[p.panel - 1];
    const w = isFinite(p.w) && p.w > 0 ? p.w : totL * 0.1;
    const xa = X(p.s), xb = Math.max(X(p.s + w), xa + 24);
    const h = Math.min(r.h * 0.8, 52), y = r.m - h / 2;
    const cx = (xa + xb) / 2;
    const fs = h < 26 ? 7 : 8.5;
    const per = Math.max(4, Math.floor((xb - xa - 8) / (fs * 0.64)));
    const maxL = Math.max(1, Math.floor((h - 4) / (fs + 1.5)));
    const lines = wrap(p.text.toUpperCase(), per).slice(0, maxL);
    const y1 = r.m - ((lines.length - 1) * (fs + 1.5)) / 2 + fs * 0.35;
    const txt = lines.map((ln, k) => t(cx, y1 + k * (fs + 1.5), ln, { size: fs, weight: 600 })).join('');
    o.push(`<g${p.flip ? ` transform="rotate(180 ${cx.toFixed(1)} ${r.m.toFixed(1)})"` : ''}><rect x="${xa.toFixed(1)}" y="${y.toFixed(1)}" width="${(xb - xa).toFixed(1)}" height="${h.toFixed(1)}" fill="#fff" stroke="${INK}" stroke-width="1.3"/>${txt}</g>`);
    p.xa = xa; p.xb = xb; p.e = p.s + w;
  });
  // gaps: from the nearest score (or plate) on the left of each plate, and from the last plate to the next score
  for (let i = 1; i <= R.length; i++) {
    const row = plates.filter((p) => p.panel === i).sort((a, b) => a.s - b.s);
    if (!row.length) continue;
    const y = R[i - 1].m;
    let prevEnd = null;
    row.forEach((p, k) => {
      const sc = scores.filter((s) => s <= p.s + 1e-6).pop() ?? 0;
      const fromPlate = prevEnd !== null && prevEnd >= sc - 1e-6;
      const a = fromPlate ? prevEnd : sc;
      const gap = p.s - a;
      if (gap > 0.01) gapMark(o, X(a), p.xa, y, fromPlate ? `${f(gap)}" between plates` : `${f(gap)}"`, RED, t, arrow);
      prevEnd = Math.max(prevEnd ?? -Infinity, p.e);
      // gap to the next score, when that score comes before the next plate
      const next = row[k + 1], scR = scores.find((s) => s >= p.e - 1e-6) ?? totL;
      if ((!next || scR <= next.s + 1e-6) && scR - p.e > 0.01) { gapMark(o, p.xb, X(scR), y, `${f(scR - p.e)}"`, RED, t, arrow); prevEnd = scR; }
    });
  }

  const mk = (id, c) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L10 5L0 9z" fill="${c}"/></marker>`;
  return `<svg class="ls-svg" viewBox="0 0 1000 ${yb + 34}" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif"><defs>${mk('lak', INK)}${mk('lar', RED)}</defs>${o.join('')}</svg>`;
}

function gapMark(o, xa, xb, y, label, c, t, arrow) {
  if (xb - xa < 8) return;
  o.push(arrow(xa + 1, xb - 1, y, c));
  const w = label.length * 5.4 + 8, cx = (xa + xb) / 2;
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

function printSheet() {
  openPrint(`<style>@page{size:letter landscape;margin:0.3in}</style><div class="lsheet-print">${sheetHtml(L)}</div>`);
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
