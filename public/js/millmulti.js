// "Mill size for multiple blanks" tab: one sheet size to order that gives the least total trim across several blanks.
import { $, $$, esc, parseInches, fmtIn, fmtNum, saveForm, loadForm } from './common.js';
import { bestMillSizes } from './stockcalc.js';

const STEPS = [['1', '1"'], ['0.5', '1/2"'], ['0.25', '1/4"'], ['0.125', '1/8"']];
const blank = () => ({ label: '', w: '', l: '', qty: '' });
let st, box, timer, results = [], picked = 0;

export function renderMulti(el) {
  box = el;
  st = { rows: [blank(), blank(), blank()], minW: '50', maxW: '75', minL: '50', maxL: '100', step: '1', ...(loadForm('millmulti') || {}) };
  if (!Array.isArray(st.rows) || !st.rows.length) st.rows = [blank(), blank()];
  box.innerHTML = `
    <div class="layout stock-layout">
      <div class="stack">
        <section class="card">
          <h2><span class="n">1</span>Blanks to cut</h2>
          <div id="mmRows"></div>
          <button class="btn small" type="button" id="mmAdd" style="margin-top:8px">+ Add blank</button>
          <p class="hint" style="margin:10px 0 0">All blanks should be the same grade, flute and color, since they'll come off one mill order. Quantity is optional (blanks, not boxes).</p>
        </section>
        <section class="card">
          <h2><span class="n">2</span>Sheet size range</h2>
          <div class="row">
            <div class="field"><label>Width from</label><input type="text" inputmode="decimal" data-m="minW"></div>
            <div class="field"><label>Width to</label><input type="text" inputmode="decimal" data-m="maxW"></div>
          </div>
          <div class="row">
            <div class="field"><label>Length from</label><input type="text" inputmode="decimal" data-m="minL"></div>
            <div class="field"><label>Length to</label><input type="text" inputmode="decimal" data-m="maxL"></div>
          </div>
          <div class="field"><label>Try sizes every</label><div class="seg" id="mmStep">${STEPS.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join('')}</div></div>
          <p class="hint" style="margin:8px 0 0">Default range is the mill limit used before: 50 × 50 up to 75 × 100.</p>
        </section>
      </div>
      <div class="stack">
        <section class="card" id="mmResult" aria-live="polite"></section>
        <section class="card hidden" id="mmDetail"></section>
      </div>
    </div>`;
  $$('[data-m]', box).forEach((el) => { el.value = st[el.dataset.m]; el.addEventListener('input', () => { st[el.dataset.m] = el.value; schedule(); }); });
  $$('#mmStep button', box).forEach((b) => b.addEventListener('click', () => { st.step = b.dataset.v; schedule(); }));
  $('#mmAdd', box).addEventListener('click', () => { if (st.rows.length < 10) { st.rows.push(blank()); paintRows(); schedule(); } });
  paintRows();
  run();
}

function paintRows() {
  $('#mmRows', box).innerHTML = st.rows.map((r, i) => `
    <div class="rep" data-i="${i}">
      ${st.rows.length > 1 ? `<button class="x" type="button" data-del aria-label="Remove blank">×</button>` : ''}
      <div class="lbl" style="margin-bottom:6px">Blank ${i + 1}</div>
      <div class="row">
        <div class="field"><label>Width (in)</label><input type="text" inputmode="decimal" data-r="w" value="${esc(r.w)}" placeholder="22"></div>
        <div class="field"><label>Length (in)</label><input type="text" inputmode="decimal" data-r="l" value="${esc(r.l)}" placeholder="11"></div>
        <div class="field"><label>Qty (blanks)</label><input type="number" min="0" step="1" data-r="qty" value="${esc(r.qty)}" placeholder="optional"></div>
      </div>
    </div>`).join('');
  $$('#mmRows .rep', box).forEach((row) => {
    const i = +row.dataset.i;
    $$('[data-r]', row).forEach((el) => el.addEventListener('input', () => { st.rows[i][el.dataset.r] = el.value; schedule(); }));
    const del = $('[data-del]', row);
    if (del) del.addEventListener('click', () => { st.rows.splice(i, 1); paintRows(); schedule(); });
  });
  $('#mmAdd', box).disabled = st.rows.length >= 10;
}

function schedule() { clearTimeout(timer); timer = setTimeout(run, 150); }

function run() {
  saveForm('millmulti', st);
  $$('#mmStep button', box).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === st.step)));
  const orders = st.rows.map((r, i) => ({ name: `Blank ${i + 1}`, w: parseInches(r.w), l: parseInches(r.l), qty: Math.floor(parseFloat(r.qty) || 0) }))
    .filter((o) => o.w > 0 && o.l > 0);
  const minW = parseInches(st.minW), maxW = parseInches(st.maxW), minL = parseInches(st.minL), maxL = parseInches(st.maxL);
  const res = $('#mmResult', box), det = $('#mmDetail', box);
  if (orders.length < 1) {
    res.innerHTML = '<h2>Best sheet size</h2><p class="hint" style="margin:0">Enter at least one blank width and length. Add more blanks to find one sheet that works for all of them.</p>';
    det.classList.add('hidden'); return;
  }
  if (!(minW > 0 && maxW >= minW && minL > 0 && maxL >= minL)) {
    res.innerHTML = '<h2>Best sheet size</h2><div class="alert err">Check the size range: each "from" must be smaller than its "to".</div>';
    det.classList.add('hidden'); return;
  }
  results = bestMillSizes({ orders, minW, maxW, minL, maxL, step: +st.step, top: 10 });
  picked = 0;
  if (!results.length) {
    const tooBig = orders.filter((o) => o.w > maxW || o.l > maxL).map((o) => esc(o.name));
    res.innerHTML = `<h2>Best sheet size</h2><div class="alert err">No sheet size in this range fits every blank.${tooBig.length ? ` Too big for the range: ${tooBig.join(', ')}.` : ''}</div>`;
    det.classList.add('hidden'); return;
  }
  const best = results[0];
  const hasQty = orders.some((o) => o.qty > 0);
  const totalSheets = (c) => c.per.reduce((a, p) => a + p.sheets, 0);
  res.innerHTML = `<h2>Best sheet size · ${orders.length} blank${orders.length > 1 ? 's' : ''}</h2>
    <div class="big-nums" style="margin-bottom:12px">
      <div class="stat hero"><div class="v">${fmtIn(best.w)} × ${fmtIn(best.l)}</div><div class="l">Sheet to order (W × L)</div></div>
      <div class="stat"><div class="v">${fmtIn(best.totalWaste)}</div><div class="l">Total trim, all blanks</div></div>
      ${hasQty ? `<div class="stat"><div class="v">${fmtNum(totalSheets(best))}</div><div class="l">Sheets to order</div></div>` : `<div class="stat"><div class="v">${fmtNum(best.avgPct * 100, 1)}%</div><div class="l">Average waste</div></div>`}
    </div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Sheet W × L</th><th>Total trim</th><th>Avg waste</th>${hasQty ? '<th>Sheets</th>' : ''}<th></th></tr></thead><tbody>
      ${results.map((c, i) => `<tr data-pick="${i}" class="${i === 0 ? 'best' : ''}" style="cursor:pointer">
        <td>${i + 1}</td><td style="white-space:nowrap"><b>${fmtIn(c.w)} × ${fmtIn(c.l)}</b></td><td>${fmtIn(c.totalWaste)}</td><td>${fmtNum(c.avgPct * 100, 1)}%</td>
        ${hasQty ? `<td>${fmtNum(totalSheets(c))}</td>` : ''}<td><button class="btn small" type="button">Details</button></td></tr>`).join('')}
    </tbody></table></div>
    <p class="hint" style="margin:8px 0 0">Ranked by total inches of trim (width trim + length trim for each blank), then lowest waste %. Ties are common; pick the size your mill stocks.</p>`;
  $$('#mmResult [data-pick]', box).forEach((tr) => tr.addEventListener('click', () => { picked = +tr.dataset.pick; $$('#mmResult [data-pick]', box).forEach((x) => x.classList.toggle('best', x === tr)); paintDetail(orders); }));
  paintDetail(orders);
}

function paintDetail(orders) {
  const c = results[picked], det = $('#mmDetail', box);
  if (!c) { det.classList.add('hidden'); return; }
  det.classList.remove('hidden');
  const hasQty = orders.some((o) => o.qty > 0);
  det.innerHTML = `<h2>${fmtIn(c.w)} × ${fmtIn(c.l)} · per blank</h2>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Blank</th><th>Size</th><th>Pcs/sht</th><th>Trim W / L</th><th>Waste</th>${hasQty ? '<th>Sheets</th>' : ''}</tr></thead><tbody>
      ${orders.map((o, i) => { const p = c.per[i]; return `<tr><td>${esc(o.name)}</td><td style="white-space:nowrap">${fmtIn(o.w)} × ${fmtIn(o.l)}</td><td><b>${p.perSheet}</b><br><span class="hint">${p.outsW}×${p.outsL}</span></td><td style="white-space:nowrap">${fmtIn(p.wasteW)} / ${fmtIn(p.wasteL)}</td><td>${fmtNum(p.wastePct * 100, 1)}%</td>${hasQty ? `<td>${o.qty ? fmtNum(p.sheets) : '–'}</td>` : ''}</tr>`; }).join('')}
    </tbody></table></div>
    <div class="mm-diagrams" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:12px">
      ${orders.map((o, i) => diagram(c, o, c.per[i])).join('')}
    </div>`;
}

function diagram(c, o, p) {
  const W = c.l, H = c.w, sw = Math.max(W, H) / 200;
  let cells = '';
  for (let i = 0; i < p.outsL; i++) for (let j = 0; j < p.outsW; j++) cells += `<rect x="${i * o.l + sw}" y="${j * o.w + sw}" width="${o.l - 2 * sw}" height="${o.w - 2 * sw}" fill="#d9b88a" stroke="#6b4e2c" stroke-width="${sw}"/>`;
  return `<figure style="margin:0"><svg class="topview" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cut layout for ${esc(o.name)}"><rect width="${W}" height="${H}" fill="#e9c9c4" stroke="#8a5a52" stroke-width="${sw * 2}"/>${cells}</svg>
    <figcaption class="hint" style="text-align:center">${esc(o.name)} · ${p.perSheet} up</figcaption></figure>`;
}
