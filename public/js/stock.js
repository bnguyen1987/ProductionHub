import { $, $$, esc, api, setupDrop, parseInches, fmtIn, fmtNum, saveForm, loadForm } from './common.js';
import { cutStock, millSizes, parseExportRows, rankStock } from './stockcalc.js';

const DEFAULT_GRADES = ['200', '250', '275', '350', '600'];
const FLUTES = ['E', 'B', 'C', 'BC'];
const COLORS = [['KRAFT', 'Kraft'], ['MW', 'Mottled white']];
const SUB_SAVE = 5; // a substitute grade must save at least this many inches of waste (same rule as LeastWaste.xlsx)

let state, stock = { items: [], fileName: null, uploadedAt: null }, skipped = [];
const blankRow = () => ({ label: '', w: '', l: '', onHand: '' });

export function render(view) {
  state = { orderW: '', orderL: '', qty: '', outs: '1', grade: '', flute: '', color: '', rows: [], ...(loadForm('stock') || {}) };
  if (!Array.isArray(state.rows)) state.rows = [];
  try { const c = JSON.parse(localStorage.getItem('gwprod_stock_cache') || 'null'); if (c && c.items) stock = c; } catch {}

  view.innerHTML = `
    <div class="page-head"><h1>Stock Sheet Calculator</h1><p>Enter the order, upload the stock Export file, and it ranks the stock sheets you have by least trim waste. Width cuts to width and length to length (no turning).</p></div>
    <div class="layout stock-layout">
      <div class="stack">
        <section class="card">
          <h2><span class="n">1</span>Order</h2>
          <div class="row">
            <div class="field"><label for="sGrade">Grade</label><input id="sGrade" data-f="grade" type="text" list="gradeList" placeholder="e.g. 275" autocomplete="off"><datalist id="gradeList"></datalist></div>
            <div class="field"><label>Flute</label><div class="seg" id="sFlute">${FLUTES.map((f) => `<button type="button" data-k="${f}">${f}</button>`).join('')}</div></div>
          </div>
          <div class="field" style="margin-bottom:10px"><label>Color</label><div class="seg" id="sColor">${COLORS.map(([k, t]) => `<button type="button" data-k="${k}">${t}</button>`).join('')}</div></div>
          <div class="row">
            <div class="field"><label for="sOW">Blank width (in)</label><input id="sOW" data-f="orderW" type="text" inputmode="decimal" placeholder="e.g. 17 or 17 1/2"></div>
            <div class="field"><label for="sOL">Blank length (in)</label><input id="sOL" data-f="orderL" type="text" inputmode="decimal" placeholder="e.g. 33"></div>
          </div>
          <div class="row">
            <div class="field"><label for="sQ">Quantity (boxes)</label><input id="sQ" data-f="qty" type="number" min="0" step="1" placeholder="1000"></div>
            <div class="field"><label for="sOuts">Outs per blank</label><input id="sOuts" data-f="outs" type="number" min="1" step="1" placeholder="1"></div>
            <div class="field"><label>Blanks needed</label><div id="sBlanks" class="stat" style="padding:8px 10px;min-height:42px;display:flex;align-items:center;font-weight:700">–</div></div>
          </div>
          <p class="hint" style="margin:0">Fractions are fine: 33 1/2, 33-1/2, or 33\`08 (sixteenths). Other grades: only a <b>higher</b> grade with the same flute and color is suggested, when your grade isn't in stock, is short, or the upgrade saves ${SUB_SAVE}"+ of waste.</p>
        </section>
        <section class="card">
          <h2><span class="n">2</span>Stock sheets</h2>
          <label class="drop" id="sDrop">
            <input type="file" accept=".xlsx,.xls,.xlsm,.csv" aria-label="Upload stock export">
            <div class="big">Upload the stock Export (.xlsx)</div>
            <div class="hint">Same file as Export.xlsx: Item Description, Item No, Available Quantity. Everyone sees the latest upload.</div>
          </label>
          <div id="sStockStatus" style="margin-top:10px"></div>
          <details style="margin-top:12px" ${state.rows.length ? 'open' : ''}>
            <summary class="lbl" style="cursor:pointer">Add other sizes by hand (optional)</summary>
            <div id="stockRows" style="margin-top:10px"></div>
            <button class="btn small" id="addStock" type="button" style="margin-top:8px">+ Add size</button>
          </details>
        </section>
      </div>
      <div class="stack">
        <section class="card" id="stockResult" aria-live="polite"></section>
        <section class="card" id="millBox"></section>
      </div>
    </div>`;
  $$('[data-f]', view).forEach((el) => { el.value = state[el.dataset.f]; el.addEventListener('input', () => { state[el.dataset.f] = el.value; calc(); }); });
  $$('#sFlute button').forEach((b) => b.addEventListener('click', () => { state.flute = state.flute === b.dataset.k ? '' : b.dataset.k; calc(); }));
  $$('#sColor button').forEach((b) => b.addEventListener('click', () => { state.color = state.color === b.dataset.k ? '' : b.dataset.k; calc(); }));
  $('#addStock').addEventListener('click', () => { state.rows.push(blankRow()); paintRows(); calc(); });
  setupDrop($('#sDrop'), uploadExport);
  paintRows(); paintStatus(); calc();

  // pull the shared list (someone else may have uploaded a newer one)
  api('/api/stock').then((d) => {
    if (d && Array.isArray(d.items) && (d.uploadedAt || '') >= (stock.uploadedAt || '')) { stock = d; cacheStock(); paintStatus(); calc(); }
  }).catch(() => {});
}

function cacheStock() { try { localStorage.setItem('gwprod_stock_cache', JSON.stringify(stock)); } catch {} }

function paintStatus(msg = '') {
  const box = $('#sStockStatus');
  if (!box) return;
  const grades = [...new Set([...DEFAULT_GRADES, ...stock.items.map((i) => i.grade)])].sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0));
  $('#gradeList').innerHTML = grades.map((g) => `<option value="${esc(g)}">`).join('');
  const when = stock.uploadedAt ? new Date(stock.uploadedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  box.innerHTML = `${msg}${stock.items.length
    ? `<div class="alert info"><b>${stock.items.length} stock items</b> loaded${stock.fileName ? ` from ${esc(stock.fileName)}` : ''}${when ? ` · ${esc(when)}` : ''}.</div>`
    : '<p class="hint" style="margin:0">No stock file loaded yet.</p>'}
    ${skipped.length ? `<p class="hint" style="margin:8px 0 0">Skipped ${skipped.length} line${skipped.length > 1 ? 's' : ''} that didn't look like a stock sheet: ${skipped.slice(0, 4).map(esc).join('; ')}${skipped.length > 4 ? '…' : ''}</p>` : ''}`;
}

async function loadXlsx() {
  if (window.XLSX) return window.XLSX;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the Excel reader')); document.head.appendChild(s); });
  return window.XLSX;
}

async function uploadExport(file) {
  paintStatus('<div class="alert info" style="margin-bottom:8px"><span class="spinner"></span> Reading the file…</div>');
  try {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
    const parsed = parseExportRows(rows);
    skipped = parsed.skipped;
    if (!parsed.items.length) throw new Error('No stock sheets found in that file.');
    stock = { items: parsed.items, fileName: file.name, uploadedAt: new Date().toISOString() };
    cacheStock(); calc();
    try {
      stock = await api('/api/stock', { method: 'PUT', body: JSON.stringify({ items: parsed.items, fileName: file.name }) });
      cacheStock();
      paintStatus('<div class="alert ok" style="margin-bottom:8px">Stock list updated for everyone.</div>');
    } catch (e) {
      paintStatus(`<div class="alert warn" style="margin-bottom:8px">Loaded on this device, but could not share it: ${esc(e.message)}</div>`);
    }
  } catch (e) {
    paintStatus(`<div class="alert err" style="margin-bottom:8px">${esc(e.message)}</div>`);
  }
}

function paintRows() {
  $('#stockRows').innerHTML = state.rows.length ? state.rows.map((r, i) => `
    <div class="rep" data-i="${i}">
      <button class="x" type="button" data-del="${i}" aria-label="Remove">×</button>
      <div class="row">
        <div class="field"><label>Name</label><input type="text" data-r="label" value="${esc(r.label)}" placeholder="Size ${i + 1}"></div>
        <div class="field"><label>Width (in)</label><input type="text" inputmode="decimal" data-r="w" value="${esc(r.w)}" placeholder="54"></div>
        <div class="field"><label>Length (in)</label><input type="text" inputmode="decimal" data-r="l" value="${esc(r.l)}" placeholder="100"></div>
        <div class="field"><label>On hand</label><input type="number" min="0" data-r="onHand" value="${esc(r.onHand)}" placeholder="optional"></div>
      </div>
    </div>`).join('') : '<p class="hint" style="margin:0">Useful for sizes that aren\'t in the export yet.</p>';
  $$('#stockRows .rep').forEach((row) => {
    const i = +row.dataset.i;
    $$('[data-r]', row).forEach((inp) => inp.addEventListener('input', () => { state.rows[i][inp.dataset.r] = inp.value; calc(); }));
  });
  $$('#stockRows [data-del]').forEach((b) => b.addEventListener('click', () => { state.rows.splice(+b.dataset.del, 1); paintRows(); calc(); }));
}

const MATCH_PILL = { EXACT: '<span class="pill ok">Exact</span>', SUB: '<span class="pill warn">Upgrade</span>', MANUAL: '<span class="pill info">Typed in</span>', ANY: '' };

function calc() {
  saveForm('stock', state);
  $$('#sFlute button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === state.flute)));
  $$('#sColor button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === state.color)));
  const oW = parseInches(state.orderW), oL = parseInches(state.orderL), boxes = Math.floor(parseFloat(state.qty) || 0);
  const outs = Math.max(1, Math.floor(parseFloat(state.outs) || 1));
  const qty = boxes ? Math.ceil(boxes / outs) : 0; // blanks to cut
  const qtyTxt = boxes ? (outs > 1 ? `${fmtNum(boxes)} boxes (${fmtNum(qty)} blanks)` : `${fmtNum(qty)} blanks`) : '';
  $('#sBlanks').textContent = boxes ? fmtNum(qty) : '–';
  const res = $('#stockResult'), mill = $('#millBox');
  if (!(oW > 0 && oL > 0)) {
    res.innerHTML = '<h2>Results</h2><p class="hint" style="margin:0">Enter the blank width and length.</p>';
    mill.innerHTML = '';
    return;
  }

  const manual = state.rows.map((r, i) => ({ manual: true, desc: r.label || `Size ${i + 1}`, itemNo: '', grade: '', flute: '', color: '', w: parseInches(r.w), l: parseInches(r.l), avail: r.onHand === '' ? null : +r.onHand }))
    .filter((r) => r.w > 0 && r.l > 0);
  const items = [...stock.items, ...manual];
  const spec = [state.grade, state.flute, COLORS.find((c) => c[0] === state.color)?.[1]].filter(Boolean).join(' ');

  if (!items.length) {
    res.innerHTML = '<h2>Results</h2><p class="hint" style="margin:0">Upload the stock Export file, or add a size by hand.</p>';
  } else {
    const r = rankStock({ items, orderW: oW, orderL: oL, qty, grade: state.grade, flute: state.flute, color: state.color, subSave: SUB_SAVE });
    const best = r.list[0];
    const needSpec = !state.flute || !state.color || !state.grade.trim();
    const shown = r.list.slice(0, 15);
    res.innerHTML = `<h2>Results · ${spec ? esc(spec) + ' · ' : ''}${fmtIn(oW)} × ${fmtIn(oL)}</h2>
      ${recHtml(r, qty)}
      ${needSpec ? `<div class="alert warn" style="margin-bottom:10px">Pick the ${[!state.grade.trim() && 'grade', !state.flute && 'flute', !state.color && 'color'].filter(Boolean).join(', ')} to only see sheets that match the order.</div>` : ''}
      ${best ? `<div class="big-nums" style="margin-bottom:12px">
          <div class="stat hero"><div class="v">${best.perSheet}</div><div class="l">Pcs/sheet on ${esc(best.itemNo ? '#' + best.itemNo : best.desc)}</div></div>
          ${qty ? `<div class="stat"><div class="v">${fmtNum(best.sheets)}</div><div class="l">Sheets needed for ${qtyTxt}</div></div>` : ''}
          <div class="stat"><div class="v">${fmtIn(best.wasteIn)}</div><div class="l">Trim waste (${fmtNum(best.wastePct * 100, 1)}%)</div></div>
        </div>
        ${qty && best.enough === false ? (r.shortAfterAll > 0
          ? `<div class="alert err" style="margin-bottom:10px">Not enough stock on hand. Even using every sheet below you are short about ${fmtNum(r.shortAfterAll)} blanks. Check the mill sizes.</div>`
          : `<div class="alert warn" style="margin-bottom:10px">The best sheet doesn't have enough on hand. The <b>Pull</b> column shows how many sheets of each to pull to cover ${qtyTxt}.</div>`) : ''}
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th>Sheet</th><th>Pcs/sht</th><th>Waste</th>${qty ? '<th>Need</th>' : ''}<th>Avail</th>${qty ? '<th>Pull</th>' : ''}</tr></thead><tbody>
          ${shown.map((x, i) => `<tr class="${i === 0 ? 'best' : ''}">
            <td style="white-space:nowrap">${x.itemNo ? `<b>#${esc(x.itemNo)}</b> ` : ''}${MATCH_PILL[x.match] || ''}<br><span class="hint">${esc(x.manual ? x.desc : `${x.grade} ${x.flute} ${x.color}`)}</span></td>
            <td style="white-space:nowrap">${fmtIn(x.w)} × ${fmtIn(x.l)}</td>
            <td><b>${x.perSheet}</b><br><span class="hint">${x.outsW}×${x.outsL}</span></td>
            <td style="white-space:nowrap">${fmtIn(x.wasteIn)}<br><span class="hint">${fmtNum(x.wastePct * 100, 1)}%</span></td>
            ${qty ? `<td>${fmtNum(x.sheets)}</td>` : ''}
            <td>${x.avail === null || x.avail === undefined ? '–' : `<span style="font-weight:700;color:${x.enough === false ? 'var(--bad)' : x.enough ? 'var(--good)' : 'inherit'}" title="${x.enough === false ? 'Not enough for the whole order' : ''}">${fmtNum(x.avail)}</span>`}</td>
            ${qty ? `<td>${x.useSheets ? `<b>${fmtNum(x.useSheets)}</b>` : ''}</td>` : ''}
          </tr>`).join('')}
        </tbody></table></div>
        ${qty ? '<p class="hint" style="margin:8px 0 0">Avail in red = not enough of that sheet for the whole order on its own. <b>Pull</b> = sheets to use, exact grade first.</p>' : ''}
        ${r.list.length > shown.length ? `<p class="hint" style="margin:8px 0 0">Showing the best ${shown.length} of ${r.list.length}.</p>` : ''}
        ${r.hiddenSubs ? `<p class="hint" style="margin:8px 0 0">${r.hiddenSubs} higher-grade sheet${r.hiddenSubs > 1 ? 's' : ''} not shown: your grade has enough and the upgrade doesn't save ${SUB_SAVE}"+ of waste.</p>` : ''}
        ${cutDiagram(best, oW, oL)}`
      : `<div class="alert err">No ${spec ? esc(spec) + ' ' : ''}stock sheet is big enough for a ${fmtIn(oW)} × ${fmtIn(oL)} blank. See the mill sizes below.</div>`}`;
  }

  const sizes = millSizes({ orderW: oW, orderL: oL });
  mill.innerHTML = `<h2>Zero-waste mill sizes</h2>
    ${sizes.length ? `<p class="hint" style="margin:0 0 8px">Exact multiples of the blank, between 50 × 50 and 75 × 100.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mill size W × L</th><th>Outs W×L</th><th>Pcs/sht</th>${qty ? '<th>Sheets</th>' : ''}</tr></thead><tbody>
      ${sizes.slice(0, 9).map((s) => `<tr><td>${fmtIn(s.w)} × ${fmtIn(s.l)}</td><td>${s.outsW} × ${s.outsL}</td><td>${s.perSheet}</td>${qty ? `<td>${fmtNum(Math.ceil(qty / s.perSheet))}</td>` : ''}</tr>`).join('')}
      </tbody></table></div>` : '<p class="hint" style="margin:0">No exact multiple of this blank falls between 50 × 50 and 75 × 100. Size a mill order by hand.</p>'}`;
}

function cutDiagram(r, oW, oL) {
  // x = length, y = width
  const W = r.l, H = r.w, pad = Math.max(W, H) * 0.02;
  const fs = Math.max(W, H) / 30;
  let cells = '';
  for (let i = 0; i < r.outsL; i++) for (let j = 0; j < r.outsW; j++) {
    cells += `<rect x="${pad + i * oL + 0.2}" y="${pad + j * oW + 0.2}" width="${oL - 0.4}" height="${oW - 0.4}" fill="#d9b88a" stroke="#6b4e2c" stroke-width="${fs * 0.06}"/>`;
  }
  return `<h2 style="margin:16px 0 8px">Cut layout · ${esc(r.itemNo ? '#' + r.itemNo : r.desc)}</h2>
    <svg class="topview cutview" viewBox="0 0 ${W + pad * 2} ${H + pad * 2 + fs * 1.6}" role="img" aria-label="Cut layout">
      <rect x="${pad}" y="${pad}" width="${W}" height="${H}" fill="#e9c9c4" stroke="#8a5a52" stroke-width="${fs * 0.08}"/>
      ${cells}
      <text x="${pad + W / 2}" y="${H + pad * 2 + fs * 1.1}" font-size="${fs}" text-anchor="middle" fill="currentColor" font-family="sans-serif" opacity=".7">${fmtIn(r.w)} wide × ${fmtIn(r.l)} long · pink = trim</text>
    </svg>`;
}

function recHtml(r, qty) {
  const rec = r.rec;
  if (!rec) return '';
  const cls = { 'none-exact': 'warn', nothing: 'err', short: 'warn', 'short-none': 'err', saves: 'info' }[rec.kind] || 'info';
  const sub = rec.sub;
  const detail = sub ? ` <b>#${esc(sub.itemNo || sub.desc)}</b> (${fmtIn(sub.w)} × ${fmtIn(sub.l)}, ${sub.perSheet} per sheet, ${fmtIn(sub.wasteIn)} waste${sub.avail !== null && sub.avail !== undefined ? `, ${fmtNum(sub.avail)} available` : ''}${qty && sub.useSheets ? `; pull ${fmtNum(sub.useSheets)} sheets` : ''}).` : '';
  return `<div class="alert ${cls}" style="margin-bottom:10px"><b>Grade recommendation:</b> ${esc(rec.text)}${sub ? '' : ''}${detail}${sub ? ' Confirm the upgrade with the customer/CSR if needed.' : ''}</div>`;
}
