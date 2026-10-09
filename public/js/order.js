import { $, $$, esc, api, fileToPayload, setupDrop, parseInches, fmtIn, fmtNum, saveForm, loadForm } from './common.js';
import { checkAll, estimateBlank } from './ordercalc.js';

const STYLES = ['RSC', 'HSC', 'FOL', 'Die Cut', 'Sheet', 'Other'];
const FLUTES = ['E', 'B', 'C', 'BC', 'A', 'SF'];
const EMPTY = { customer: '', part: '', style: 'RSC', L: '', W: '', D: '', sheetW: '', sheetL: '', flute: 'C', grade: '', colors: '0', qty: '', up: '1', notes: '' };
let o;

export function render(view) {
  o = { ...EMPTY, ...(loadForm('order') || {}) };
  view.innerHTML = `
    <div class="page-head"><h1>New Order Checker</h1><p>Upload the customer's quote, RFQ or spec sheet. It reads the size, flute and colors, then checks each machine. Always confirm the numbers it pulled before quoting.</p></div>
    <div class="layout wide-left">
      <div class="stack">
        <section class="card">
          <h2><span class="n">1</span>Upload quote</h2>
          <label class="drop" id="oDrop">
            <input type="file" accept="application/pdf,image/*" aria-label="Upload quote">
            <div class="big">Drop a PDF or take a photo of the quote</div>
            <div class="hint">PDF up to about 3 MB, or a clear photo/screenshot</div>
          </label>
          <div id="oFile" class="preview hidden"></div>
          <div id="oAiMsg" style="margin-top:10px"></div>
        </section>
        <section class="card">
          <h2><span class="n">2</span>Order details <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:500">check these</span></h2>
          <div class="row">
            <div class="field"><label>Customer</label><input type="text" data-f="customer"></div>
            <div class="field"><label>Part / design #</label><input type="text" data-f="part"></div>
          </div>
          <div class="lbl" style="margin:2px 0 6px">Style</div>
          <div class="seg" id="oStyle" style="margin-bottom:12px">${STYLES.map((s) => `<button type="button" data-k="${s}">${s}</button>`).join('')}</div>
          <div class="row" id="oBoxRow">
            <div class="field"><label>Box L (in)</label><input type="text" inputmode="decimal" data-f="L"></div>
            <div class="field"><label>Box W (in)</label><input type="text" inputmode="decimal" data-f="W"></div>
            <div class="field"><label>Box D (in)</label><input type="text" inputmode="decimal" data-f="D"></div>
          </div>
          <div class="row">
            <div class="field"><label>Sheet / blank width (in)</label><input type="text" inputmode="decimal" data-f="sheetW" placeholder="from quote"></div>
            <div class="field"><label>Sheet / blank length (in)</label><input type="text" inputmode="decimal" data-f="sheetL" placeholder="from quote"></div>
          </div>
          <div id="oEst"></div>
          <div class="lbl" style="margin:6px 0 6px">Flute</div>
          <div class="seg" id="oFlute" style="margin-bottom:12px">${FLUTES.map((f) => `<button type="button" data-k="${f}">${f === 'SF' ? 'Single face' : f}</button>`).join('')}</div>
          <div class="row">
            <div class="field"><label>Grade</label><input type="text" data-f="grade" placeholder="e.g. 200#, 32 ECT"></div>
            <div class="field"><label>Print colors</label><select data-f="colors">${[0, 1, 2, 3, 4].map((n) => `<option value="${n}">${n === 0 ? 'No print' : n}</option>`).join('')}</select></div>
            <div class="field"><label>Number up</label><input type="number" min="1" step="1" data-f="up"></div>
            <div class="field"><label>Quantity</label><input type="number" min="0" step="1" data-f="qty"></div>
          </div>
          <div class="field"><label>Notes</label><input type="text" data-f="notes" placeholder="anything special"></div>
          <div class="btn-row" style="margin-top:12px"><button class="btn ghost" type="button" id="oReset">Start new order</button></div>
        </section>
      </div>
      <div class="stack">
        <section class="card" id="oResult" aria-live="polite"></section>
      </div>
    </div>`;

  $$('[data-f]', view).forEach((el) => { el.value = o[el.dataset.f]; el.addEventListener('input', () => { o[el.dataset.f] = el.value; run(); }); });
  $$('#oStyle button').forEach((b) => b.addEventListener('click', () => { o.style = b.dataset.k; run(); }));
  $$('#oFlute button').forEach((b) => b.addEventListener('click', () => { o.flute = b.dataset.k; run(); }));
  $('#oReset').addEventListener('click', () => { o = { ...EMPTY }; $$('[data-f]').forEach((el) => (el.value = o[el.dataset.f])); $('#oAiMsg').innerHTML = ''; $('#oFile').classList.add('hidden'); run(); });
  setupDrop($('#oDrop'), readQuote);
  run();
}

function run() {
  saveForm('order', o);
  $$('#oStyle button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === o.style)));
  $$('#oFlute button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === o.flute)));
  $('#oBoxRow').classList.toggle('hidden', o.style === 'Sheet');

  const L = parseInches(o.L), W = parseInches(o.W), D = parseInches(o.D);
  let sheetW = parseInches(o.sheetW), sheetL = parseInches(o.sheetL);
  let estimated = false;
  const est = estimateBlank({ style: o.style, L, W, D });
  if (!(sheetW > 0 && sheetL > 0) && est) { sheetW = est.sheetW; sheetL = est.sheetL; estimated = true; }
  $('#oEst').innerHTML = estimated
    ? `<div class="alert warn" style="margin-bottom:10px">No sheet size given. Using an <b>estimated</b> ${o.style} blank of ${fmtIn(sheetW)} × ${fmtIn(sheetL)} (2L + 2W + 1¼" joint by D + flaps). Get the real blank size before quoting.</div>`
    : '';

  const box = $('#oResult');
  if (!(sheetW > 0 && sheetL > 0)) {
    box.innerHTML = '<h2>Can we run it?</h2><p class="hint" style="margin:0">Upload a quote, or enter the sheet size (or box L × W × D for RSC/HSC/FOL).</p>';
    return;
  }
  const results = checkAll({ sheetW, sheetL, flute: o.flute, colors: +o.colors || 0, D: D > 0 ? D : 0, style: o.style, up: Math.max(1, parseInt(o.up, 10) || 1) });
  const pass = results.filter((r) => r.status === 'pass');
  const warn = results.filter((r) => r.status === 'warn');
  const best = pass[0] || warn[0];
  const verdict = pass.length
    ? `<div class="alert ok"><b>Yes, it can run.</b> Best fit: ${esc(pass[0].machine.name)}${pass.length > 1 ? ` (${pass.length} machines qualify)` : ''}.</div>`
    : warn.length
      ? `<div class="alert warn"><b>Maybe.</b> ${warn.length} machine${warn.length > 1 ? 's' : ''} could run it with conditions. Read the notes below.</div>`
      : '<div class="alert err"><b>No.</b> None of the six machines can run this as entered.</div>';

  box.innerHTML = `<h2>Can we run it?</h2>
    ${verdict}
    <dl class="kv" style="margin:12px 0">
      <dt>Sheet</dt><dd>${fmtIn(sheetW)} × ${fmtIn(sheetL)}${estimated ? ' <span class="pill warn">estimated</span>' : ''}</dd>
      <dt>Flute / colors</dt><dd>${esc(o.flute || '–')} · ${+o.colors ? esc(o.colors) + ' color' : 'no print'}</dd>
      ${+o.qty ? `<dt>Quantity</dt><dd>${fmtNum(+o.qty)}</dd>` : ''}
    </dl>
    ${results.map((r) => {
      const m = r.machine;
      const isBest = r === best;
      const hrs = +o.qty && m.speed ? (+o.qty / Math.max(1, parseInt(o.up, 10) || 1)) / m.speed : 0;
      return `<div class="mach ${r.status}">
        <div class="mach-head">
          <b>${esc(m.name)}</b>
          <span class="pill ${r.status === 'pass' ? 'ok' : r.status === 'warn' ? 'warn' : 'bad'}">${r.status === 'pass' ? 'Can run' : r.status === 'warn' ? 'Check' : 'Cannot run'}</span>
          ${isBest ? '<span class="pill star">Best fit</span>' : ''}
          <span class="meta">#${m.id} · crew ${esc(m.crewTxt)}${m.speed ? ` · ${fmtNum(m.speed)}/hr` : ''}${hrs ? ` · ~${fmtNum(hrs, 1)} run hrs` : ''}</span>
        </div>
        <ul>
          ${r.fails.map((t) => `<li class="bad">${esc(t)}</li>`).join('')}
          ${r.warns.map((t) => `<li class="warn">${esc(t)}</li>`).join('')}
          ${r.status !== 'fail' ? r.oks.map((t) => `<li>${esc(t)}</li>`).join('') : ''}
          ${r.status !== 'fail' ? `<li>${esc(m.notes)}</li>` : ''}
        </ul>
      </div>`;
    }).join('')}
    <p class="note" style="margin:12px 0 0">Checks sheet size, flute, print colors, depth and number-up against the machine spec sheets. It does not check die board size, rule length, tooling on hand, or schedule capacity. Run hours are at rated speed, before setup.</p>`;
}

async function readQuote(file) {
  const msg = $('#oAiMsg'), f = $('#oFile');
  f.classList.remove('hidden');
  f.innerHTML = `${file.type.startsWith('image/') ? `<img src="${URL.createObjectURL(file)}" alt="">` : ''}<div class="fname">${esc(file.name)}</div>`;
  msg.innerHTML = '<div class="alert info"><span class="spinner"></span> Reading the quote…</div>';
  try {
    const payload = await fileToPayload(file);
    const { result: r } = await api('/api/ai', { method: 'POST', body: JSON.stringify({ task: 'quote', ...payload }) });
    const num = (v) => (v === null || v === undefined || v === '' || !isFinite(+v) ? '' : String(+v));
    o = {
      ...EMPTY,
      customer: r.customer || '', part: r.part_or_design || '',
      style: STYLES.includes(r.style) ? r.style : (r.style ? 'Other' : 'RSC'),
      L: num(r.box_length_in), W: num(r.box_width_in), D: num(r.box_depth_in),
      sheetW: num(r.sheet_width_in), sheetL: num(r.sheet_length_in),
      flute: FLUTES.includes(r.flute) ? r.flute : (r.flute === 'DW' ? 'BC' : 'C'),
      grade: r.grade || '', colors: String(Math.min(4, Math.max(0, parseInt(r.colors, 10) || 0))),
      qty: num(r.quantity), up: String(Math.max(1, parseInt(r.number_up, 10) || 1)), notes: r.notes || '',
    };
    $$('[data-f]').forEach((el) => (el.value = o[el.dataset.f]));
    run();
    const missing = [];
    if (!r.flute) missing.push('flute');
    if (!(r.sheet_width_in && r.sheet_length_in)) missing.push('sheet size');
    msg.innerHTML = `<div class="alert ${missing.length ? 'warn' : 'ok'}">Read the quote.${missing.length ? ` Could not find: ${missing.join(', ')}. Fill those in below.` : ' Check the details below.'}</div>`;
  } catch (e) {
    msg.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
  }
}
