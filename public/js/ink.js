import { $, $$, esc, api, fileToPayload, setupDrop, parseInches, fmtNum, saveForm, loadForm } from './common.js';

// Anilox line counts per press station (from the ink calculator built earlier).
export const PRESSES = {
  EMBA: { label: 'EMBA', stations: [['1st', 280], ['2nd', 260]] },
  MCKINLEY: { label: 'McKinley', stations: [['1st', 250], ['2nd', 250]] },
  SHANGHAI: { label: 'Shanghai', stations: [['1st', 220], ['2nd', 250]] },
  JUMBO: { label: '86" Jumbo', stations: [['1st', 220]] },
};
export const LBS_PER_BUCKET = 45;

// GoldenWest ink formula: total sq ft × coverage ÷ anilox line × 0.01 = buckets.
export function inkForColor({ lengthIn, widthIn, sheets, coveragePct, anilox, extraPct = 0 }) {
  const sqftSheet = (lengthIn * widthIn) / 144;
  const totalSqft = sqftSheet * sheets;
  const covered = totalSqft * (coveragePct / 100);
  const raw = (covered / anilox) * 0.01 * (1 + extraPct / 100);
  return {
    sqftSheet, totalSqft, covered,
    rawBuckets: raw,
    rawLbs: raw * LBS_PER_BUCKET,
    quarterBuckets: Math.ceil(raw * 4 - 1e-9) / 4,
    lbsOrder: Math.ceil(raw * LBS_PER_BUCKET / 5 - 1e-9) * 5,
    bucketsToBuy: Math.max(raw > 0 ? 1 : 0, Math.ceil(raw - 1e-9)),
  };
}

let state;

export function render(view) {
  state = loadForm('ink') || { length: '', width: '', sheets: '', press: 'MCKINLEY', extra: '0', colors: [{ name: 'Color 1', coverage: '', station: 0 }] };
  if (!PRESSES[state.press]) state.press = 'MCKINLEY';

  view.innerHTML = `
    <div class="page-head"><h1>Ink Calculator</h1><p>Enter the sheet and run, pick the press, then upload a photo of the printed sample. It estimates coverage for each color and tells you how many 45 lb buckets to buy.</p></div>
    <div class="layout wide-left">
      <div class="stack">
        <section class="card">
          <h2><span class="n">1</span>Sheet &amp; run</h2>
          <div class="row">
            <div class="field"><label for="inkL">Sheet length (in)</label><input id="inkL" type="text" inputmode="decimal" placeholder="e.g. 52 or 52 1/2"></div>
            <div class="field"><label for="inkW">Sheet width (in)</label><input id="inkW" type="text" inputmode="decimal" placeholder="e.g. 33"></div>
            <div class="field"><label for="inkS">Sheets to print</label><input id="inkS" type="number" inputmode="numeric" min="0" placeholder="6000"></div>
          </div>
        </section>
        <section class="card">
          <h2><span class="n">2</span>Press</h2>
          <div class="seg" id="pressSeg">
            ${Object.entries(PRESSES).map(([k, p]) => `<button type="button" data-k="${k}">${esc(p.label)}<small>${p.stations.map((s) => s[1]).join(' / ')} line</small></button>`).join('')}
          </div>
        </section>
        <section class="card">
          <h2><span class="n">3</span>Printed sample photo</h2>
          <label class="drop" id="inkDrop">
            <input type="file" accept="image/*,application/pdf" capture="environment" aria-label="Upload sample photo">
            <div class="big">Take or upload a photo of the printed sheet</div>
            <div class="hint">Shoot straight down, whole sheet in frame, good light</div>
          </label>
          <div id="inkPreview" class="preview hidden"></div>
          <div id="inkAiMsg" style="margin-top:10px"></div>
        </section>
        <section class="card">
          <h2><span class="n">4</span>Ink colors &amp; coverage</h2>
          <div id="colorRows"></div>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn small" id="addColor" type="button">+ Add color</button>
            <span class="spacer" style="flex:1"></span>
            <div class="field" style="max-width:170px"><label for="inkExtra">Extra for setup/waste %</label><input id="inkExtra" type="number" min="0" max="100" step="1"></div>
          </div>
          <p class="hint" style="margin:8px 0 0">Coverage is the share of the whole sheet the ink covers. 100 = solid flood coat. Most line copy and logos are 5–20%.</p>
        </section>
      </div>
      <div class="stack">
        <section class="card" id="inkResults" aria-live="polite"></section>
      </div>
    </div>`;

  $('#inkL').value = state.length; $('#inkW').value = state.width; $('#inkS').value = state.sheets; $('#inkExtra').value = state.extra;
  ['inkL', 'inkW', 'inkS', 'inkExtra'].forEach((id) => $('#' + id).addEventListener('input', readInputs));
  $$('#pressSeg button').forEach((b) => b.addEventListener('click', () => { state.press = b.dataset.k; normalizeStations(); paint(); }));
  $('#addColor').addEventListener('click', () => { state.colors.push({ name: `Color ${state.colors.length + 1}`, coverage: '', station: Math.min(state.colors.length, PRESSES[state.press].stations.length - 1) }); paint(); });
  setupDrop($('#inkDrop'), analyzePhoto);
  paint();
}

function normalizeStations() {
  const n = PRESSES[state.press].stations.length;
  state.colors.forEach((c, i) => { if (c.station >= n) c.station = Math.min(i, n - 1); });
}

function readInputs() {
  state.length = $('#inkL').value; state.width = $('#inkW').value; state.sheets = $('#inkS').value; state.extra = $('#inkExtra').value;
  saveForm('ink', state);
  paintResults();
}

function paint() {
  $$('#pressSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === state.press)));
  const press = PRESSES[state.press];
  $('#colorRows').innerHTML = state.colors.map((c, i) => `
    <div class="rep" data-i="${i}">
      ${state.colors.length > 1 ? `<button class="x" type="button" data-del="${i}" aria-label="Remove color">×</button>` : ''}
      <div class="row">
        <div class="field"><label>Color</label><input type="text" data-f="name" value="${esc(c.name)}"></div>
        <div class="field"><label>Coverage %</label><input type="number" inputmode="decimal" min="0" max="100" step="0.5" data-f="coverage" value="${esc(c.coverage)}" placeholder="e.g. 15"></div>
        <div class="field"><label>Station</label><select data-f="station">${press.stations.map((s, si) => `<option value="${si}" ${si === c.station ? 'selected' : ''}>${s[0]} · ${s[1]} line</option>`).join('')}</select></div>
      </div>
    </div>`).join('');
  $$('#colorRows .rep').forEach((row) => {
    const i = +row.dataset.i;
    $$('[data-f]', row).forEach((inp) => inp.addEventListener('input', () => {
      const f = inp.dataset.f;
      state.colors[i][f] = f === 'station' ? +inp.value : inp.value;
      saveForm('ink', state); paintResults();
    }));
  });
  $$('#colorRows [data-del]').forEach((b) => b.addEventListener('click', () => { state.colors.splice(+b.dataset.del, 1); paint(); }));
  saveForm('ink', state);
  paintResults();
}

function paintResults() {
  const box = $('#inkResults');
  if (!box) return;
  const L = parseInches(state.length), W = parseInches(state.width), S = parseFloat(state.sheets), extra = parseFloat(state.extra) || 0;
  const press = PRESSES[state.press];
  const missing = [];
  if (!(L > 0)) missing.push('sheet length');
  if (!(W > 0)) missing.push('sheet width');
  if (!(S > 0)) missing.push('sheets to print');
  const colors = state.colors.map((c) => ({ ...c, cov: parseFloat(c.coverage), anilox: press.stations[c.station]?.[1] }));
  if (!colors.some((c) => c.cov > 0)) missing.push('coverage % (or upload a photo)');

  if (missing.length) {
    box.innerHTML = `<h2>Result</h2><p class="hint" style="margin:0">Still need: ${missing.join(', ')}.</p>`;
    return;
  }
  const rows = colors.filter((c) => c.cov > 0).map((c) => ({ ...c, r: inkForColor({ lengthIn: L, widthIn: W, sheets: S, coveragePct: c.cov, anilox: c.anilox, extraPct: extra }) }));
  const totalBuy = rows.reduce((a, c) => a + c.r.bucketsToBuy, 0);
  const totalLbs = rows.reduce((a, c) => a + c.r.lbsOrder, 0);
  const sq = rows[0].r;
  const tooMany = colors.filter((c) => c.cov > 0).length > press.stations.length;

  box.innerHTML = `
    <h2>Result</h2>
    <div class="big-nums">
      <div class="stat hero"><div class="v">${fmtNum(totalBuy)}</div><div class="l">Bucket${totalBuy === 1 ? '' : 's'} to buy (45 lb)</div></div>
      <div class="stat"><div class="v">${fmtNum(totalLbs)}</div><div class="l">Pounds needed (to 5 lb)</div></div>
    </div>
    ${tooMany ? `<div class="alert warn" style="margin-top:10px">${esc(press.label)} only has ${press.stations.length} print station${press.stations.length > 1 ? 's' : ''}. Check the colors.</div>` : ''}
    <div class="tbl-wrap" style="margin-top:12px"><table class="tbl">
      <thead><tr><th>Color</th><th>Cov.</th><th>Line</th><th>Buckets</th><th>Buy</th></tr></thead>
      <tbody>${rows.map((c) => `<tr><td>${esc(c.name)}</td><td>${fmtNum(c.cov, c.cov % 1 ? 1 : 0)}%</td><td>${c.anilox}</td><td>${fmtNum(c.r.rawBuckets, 2)}</td><td><b>${c.r.bucketsToBuy}</b></td></tr>`).join('')}</tbody>
    </table></div>
    <dl class="kv" style="margin-top:12px">
      <dt>Sq ft per sheet</dt><dd>${fmtNum(sq.sqftSheet, 2)}</dd>
      <dt>Total sq ft (${fmtNum(S)} sheets)</dt><dd>${fmtNum(sq.totalSqft)}</dd>
      ${extra ? `<dt>Extra added</dt><dd>${fmtNum(extra)}%</dd>` : ''}
    </dl>
    <p class="note" style="margin:12px 0 0">Formula: total sq ft × coverage ÷ anilox line × 0.01 = buckets. Board holdout, plate condition and running procedures can move actual usage. Check what's already on the shelf before ordering.</p>`;
}

async function analyzePhoto(file) {
  const msg = $('#inkAiMsg');
  const prev = $('#inkPreview');
  prev.classList.remove('hidden');
  const thumb = file.type.startsWith('image/') ? `<img src="${URL.createObjectURL(file)}" alt="Sample">` : '';
  prev.innerHTML = `${thumb}<div class="fname">${esc(file.name)}</div>`;
  msg.innerHTML = '<div class="alert info"><span class="spinner"></span> Looking at the sample…</div>';
  try {
    const payload = await fileToPayload(file);
    const { result } = await api('/api/ai', { method: 'POST', body: JSON.stringify({ task: 'ink', ...payload }) });
    const found = (result.colors || []).filter((c) => isFinite(+c.coverage_pct)).slice(0, 4);
    if (!found.length) throw new Error('No ink colors found. Enter coverage by hand.');
    const n = PRESSES[state.press].stations.length;
    state.colors = found.map((c, i) => ({ name: c.name || `Color ${i + 1}`, coverage: String(Math.round(+c.coverage_pct * 2) / 2), station: Math.min(i, n - 1) }));
    paint();
    const conf = result.confidence || 'medium';
    msg.innerHTML = `<div class="alert ${conf === 'low' ? 'warn' : 'ok'}">Found ${found.length} color${found.length > 1 ? 's' : ''} (${esc(conf)} confidence). ${esc(result.notes || '')} Adjust the % below if it looks off.</div>`;
  } catch (e) {
    msg.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
  }
}
