import { $, $$, esc, parseInches, fmtIn, fmtNum, saveForm, loadForm } from './common.js';
import { cutStock, millSizes } from './stockcalc.js';

let state;
const blankRow = () => ({ label: '', w: '', l: '', onHand: '' });

export function render(view) {
  state = loadForm('stock') || { orderW: '', orderL: '', qty: '', rows: [blankRow(), blankRow()] };
  if (!state.rows?.length) state.rows = [blankRow()];
  view.innerHTML = `
    <div class="page-head"><h1>Stock Sheet Calculator</h1><p>Type the order blank size and one or more stock sheet sizes. It shows outs, trim waste and sheets needed, best first. Width cuts to width and length to length (no turning).</p></div>
    <div class="layout wide-left">
      <div class="stack">
        <section class="card">
          <h2><span class="n">1</span>Order</h2>
          <div class="row">
            <div class="field"><label for="sOW">Blank width (in)</label><input id="sOW" data-f="orderW" type="text" inputmode="decimal" placeholder="e.g. 17 or 17 1/2"></div>
            <div class="field"><label for="sOL">Blank length (in)</label><input id="sOL" data-f="orderL" type="text" inputmode="decimal" placeholder="e.g. 33"></div>
            <div class="field"><label for="sQ">Quantity (pcs)</label><input id="sQ" data-f="qty" type="number" min="0" step="1" placeholder="1000"></div>
          </div>
          <p class="hint" style="margin:0">Fractions are fine: 33 1/2, 33-1/2, or spec style 33\`08 (sixteenths).</p>
        </section>
        <section class="card">
          <h2><span class="n">2</span>Stock sheets to compare</h2>
          <div id="stockRows"></div>
          <button class="btn small" id="addStock" type="button" style="margin-top:10px">+ Add stock size</button>
        </section>
      </div>
      <div class="stack">
        <section class="card" id="stockResult" aria-live="polite"></section>
        <section class="card" id="millBox"></section>
      </div>
    </div>`;
  $$('[data-f]', view).forEach((el) => { el.value = state[el.dataset.f]; el.addEventListener('input', () => { state[el.dataset.f] = el.value; calc(); }); });
  $('#addStock').addEventListener('click', () => { state.rows.push(blankRow()); paintRows(); calc(); });
  paintRows(); calc();
}

function paintRows() {
  $('#stockRows').innerHTML = state.rows.map((r, i) => `
    <div class="rep" data-i="${i}">
      ${state.rows.length > 1 ? `<button class="x" type="button" data-del="${i}" aria-label="Remove">×</button>` : ''}
      <div class="row">
        <div class="field"><label>Name / grade</label><input type="text" data-r="label" value="${esc(r.label)}" placeholder="Stock ${i + 1}"></div>
        <div class="field"><label>Width (in)</label><input type="text" inputmode="decimal" data-r="w" value="${esc(r.w)}" placeholder="54"></div>
        <div class="field"><label>Length (in)</label><input type="text" inputmode="decimal" data-r="l" value="${esc(r.l)}" placeholder="100"></div>
        <div class="field"><label>On hand (sheets)</label><input type="number" min="0" data-r="onHand" value="${esc(r.onHand)}" placeholder="optional"></div>
      </div>
    </div>`).join('');
  $$('#stockRows .rep').forEach((row) => {
    const i = +row.dataset.i;
    $$('[data-r]', row).forEach((inp) => inp.addEventListener('input', () => { state.rows[i][inp.dataset.r] = inp.value; calc(); }));
  });
  $$('#stockRows [data-del]').forEach((b) => b.addEventListener('click', () => { state.rows.splice(+b.dataset.del, 1); paintRows(); calc(); }));
}

function calc() {
  saveForm('stock', state);
  const oW = parseInches(state.orderW), oL = parseInches(state.orderL), qty = Math.floor(parseFloat(state.qty) || 0);
  const res = $('#stockResult'), mill = $('#millBox');
  if (!(oW > 0 && oL > 0)) {
    res.innerHTML = '<h2>Results</h2><p class="hint" style="margin:0">Enter the blank width and length.</p>';
    mill.innerHTML = '';
    return;
  }
  const rows = state.rows.map((r, i) => {
    const w = parseInches(r.w), l = parseInches(r.l);
    if (!(w > 0 && l > 0)) return null;
    return { name: r.label || `Stock ${i + 1}`, w, l, onHand: r.onHand === '' ? null : +r.onHand, ...cutStock({ stockW: w, stockL: l, orderW: oW, orderL: oL, qty }) };
  }).filter(Boolean);

  const fits = rows.filter((r) => r.fits).sort((a, b) => a.wasteIn - b.wasteIn || a.wastePct - b.wastePct);
  const nofit = rows.filter((r) => !r.fits);
  if (!rows.length) {
    res.innerHTML = '<h2>Results</h2><p class="hint" style="margin:0">Add at least one stock sheet size.</p>';
  } else {
    const best = fits[0];
    res.innerHTML = `<h2>Results · ${fmtIn(oW)} × ${fmtIn(oL)} blank</h2>
      ${best ? `<div class="big-nums" style="margin-bottom:12px">
        <div class="stat hero"><div class="v">${best.perSheet}</div><div class="l">Pieces per sheet on ${esc(best.name)}</div></div>
        ${qty ? `<div class="stat"><div class="v">${fmtNum(best.sheets)}</div><div class="l">Sheets needed for ${fmtNum(qty)}</div></div>` : ''}
        <div class="stat"><div class="v">${fmtNum(best.wastePct * 100, 1)}%</div><div class="l">Trim waste</div></div>
      </div>` : '<div class="alert err" style="margin-bottom:12px">The blank is bigger than every stock size entered.</div>'}
      ${fits.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Stock</th><th>Size</th><th>Outs W×L</th><th>Pcs/sht</th><th>Waste W / L</th><th>Waste</th>${qty ? '<th>Sheets</th>' : ''}</tr></thead><tbody>
        ${fits.map((r, i) => {
          const short = qty && r.onHand !== null && r.onHand < r.sheets;
          return `<tr class="${i === 0 ? 'best' : ''}"><td>${esc(r.name)}${i === 0 ? ' <span class="pill star">Best</span>' : ''}</td><td>${fmtIn(r.w)} × ${fmtIn(r.l)}</td><td>${r.outsW} × ${r.outsL}</td><td>${r.perSheet}</td><td>${fmtIn(r.wasteW)} / ${fmtIn(r.wasteL)}</td><td>${fmtNum(r.wastePct * 100, 1)}%</td>${qty ? `<td>${fmtNum(r.sheets)}${short ? ` <span class="pill bad">only ${fmtNum(r.onHand)}</span>` : r.onHand !== null ? ' <span class="pill ok">OK</span>' : ''}</td>` : ''}</tr>`;
        }).join('')}</tbody></table></div>` : ''}
      ${nofit.length ? `<p class="hint" style="margin:10px 0 0">Too small for this blank: ${nofit.map((r) => esc(r.name)).join(', ')}.</p>` : ''}
      ${best ? cutDiagram(best, oW, oL) : ''}`;
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
  return `<h2 style="margin:16px 0 8px">Cut layout · ${esc(r.name)}</h2>
    <svg class="topview" viewBox="0 0 ${W + pad * 2} ${H + pad * 2 + fs * 1.6}" role="img" aria-label="Cut layout">
      <rect x="${pad}" y="${pad}" width="${W}" height="${H}" fill="#e9c9c4" stroke="#8a5a52" stroke-width="${fs * 0.08}"/>
      ${cells}
      <text x="${pad + W / 2}" y="${H + pad * 2 + fs * 1.1}" font-size="${fs}" text-anchor="middle" fill="currentColor" font-family="sans-serif" opacity=".7">Length ${fmtIn(r.l)} · pink = trim</text>
    </svg>`;
}
