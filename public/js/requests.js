// Change Requests: anyone on the floor can suggest a change to a job (pallet size, count, pattern...).
// A posted QR code opens this page straight to the form. Managers review in the list.
import { $, $$, esc, api, MACHINES_7, saveForm, loadForm, fileToPayload } from './common.js';
import qrcode from '../vendor/qrcode.js';

export const TYPES = [
  'Pallet size',
  'Pieces per pallet / bundle count',
  'Stacking pattern',
  'Max load height',
  'Box spec / dimensions',
  'Print / ink',
  'Other',
];
const STATUSES = ['New', 'Approved', 'Rejected', 'Done'];
const PILL = { New: 'info', Approved: 'ok', Rejected: 'bad', Done: 'star' };

let view, list = [], filter = 'New', photo = null;

const blankForm = () => ({ name: '', shift: '', customer: '', spec: '', machine: '', type: TYPES[0], current: '', change: '', reason: '' });
function guessShift() { const d = new Date(), m = d.getHours() * 60 + d.getMinutes(); return m >= 14 * 60 + 30 || m < 4 * 60 ? '2nd' : '1st'; }
function ssGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch {} }
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

export function render(el) {
  view = el;
  view.innerHTML = `
    <div class="page-head"><h1>Change Requests</h1><p>See a better way to run a job, like a different pallet size or count? Send it here. Management reviews every request.</p></div>
    <div class="btn-row no-print" style="margin-bottom:14px">
      <button class="btn primary" id="rqNewBtn" type="button">New request</button>
      <button class="btn" id="rqListBtn" type="button">Review requests <span id="rqNewCount"></span></button>
    </div>
    <div id="rqForm"></div>
    <div id="rqList" class="hidden"></div>`;
  $('#rqNewBtn').addEventListener('click', () => showTab('form'));
  $('#rqListBtn').addEventListener('click', () => showTab('list'));
  paintForm();
  showTab(ssGet('requests_tab') || 'form');
  refreshCount();
}

function showTab(t) {
  ssSet('requests_tab', t);
  $('#rqForm', view).classList.toggle('hidden', t !== 'form');
  $('#rqList', view).classList.toggle('hidden', t !== 'list');
  $('#rqNewBtn', view).classList.toggle('primary', t === 'form');
  $('#rqListBtn', view).classList.toggle('primary', t === 'list');
  if (t === 'list') loadList();
}

async function refreshCount() {
  try {
    const { requests } = await api('/api/requests');
    list = requests || [];
    paintCount();
  } catch {}
}
function paintCount() {
  const n = list.filter((r) => r.status === 'New').length;
  const c = $('#rqNewCount', view);
  if (c) c.innerHTML = n ? `<span class="pill info" style="margin-left:4px">${n} new</span>` : '';
}

// ---------- form ----------
function paintForm() {
  const f = { ...blankForm(), shift: guessShift(), ...(loadForm('request_draft') || {}) };
  photo = null;
  $('#rqForm', view).innerHTML = `
    <div class="layout two">
      <div class="stack">
        <section class="card">
          <h2><span class="n">1</span>Job</h2>
          <div class="row">
            <div class="field"><label for="rq_customer">Customer name *</label><input type="text" id="rq_customer" data-f="customer" autocomplete="off" required></div>
            <div class="field"><label for="rq_spec">Spec # *</label><input type="text" id="rq_spec" data-f="spec" autocomplete="off" required></div>
          </div>
          <div class="field"><label for="rq_machine">Machine (optional)</label>
            <select id="rq_machine" data-f="machine"><option value="">—</option>${MACHINES_7.map((m) => `<option>${esc(m)}</option>`).join('')}</select></div>
        </section>
        <section class="card">
          <h2><span class="n">2</span>The change</h2>
          <div class="field"><label for="rq_type">What should change?</label>
            <select id="rq_type" data-f="type">${TYPES.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>
          <div class="field"><label for="rq_current">How it is now</label><input type="text" id="rq_current" data-f="current" placeholder="e.g. 40 × 48 pallet, 375 per pallet"></div>
          <div class="field"><label for="rq_change">Change it to *</label><textarea id="rq_change" data-f="change" rows="2" placeholder="e.g. 48 × 48 pallet, 450 per pallet" required></textarea></div>
          <div class="field"><label for="rq_reason">Why?</label><textarea id="rq_reason" data-f="reason" rows="3" placeholder="e.g. boxes hang over the edge, load leans, fewer pallets per order"></textarea></div>
          <div class="field"><label>Photo (optional)</label>
            <label class="drop" id="rqDrop" style="display:block"><input type="file" accept="image/*" capture="environment" hidden>
              <span id="rqDropTxt">Tap to take or add a photo</span></label>
            <div id="rqPrev"></div></div>
        </section>
      </div>
      <div class="stack">
        <section class="card">
          <h2><span class="n">3</span>Your info</h2>
          <div class="row">
            <div class="field"><label for="rq_name">Your name *</label><input type="text" id="rq_name" data-f="name" autocomplete="name" required></div>
            <div class="field"><label for="rq_shift">Shift</label><select id="rq_shift" data-f="shift"><option>1st</option><option>2nd</option></select></div>
          </div>
          <button class="btn primary" id="rqSubmit" type="button" style="width:100%;margin-top:6px">Send request</button>
          <div id="rqMsg" aria-live="polite" style="margin-top:10px"></div>
        </section>
      </div>
    </div>`;
  $$('[data-f]', view).forEach((el) => {
    el.value = f[el.dataset.f] ?? '';
    const upd = () => { f[el.dataset.f] = el.value; saveForm('request_draft', f); const m = $('#rqMsg', view); if (m && m.querySelector('.err')) m.innerHTML = ''; };
    el.addEventListener('input', upd);
    el.addEventListener('change', upd);
  });
  const drop = $('#rqDrop', view), input = drop.querySelector('input');
  input.addEventListener('change', () => input.files[0] && takePhoto(input.files[0]));
  $('#rqSubmit', view).addEventListener('click', () => submit(f));
}

async function takePhoto(file) {
  const prev = $('#rqPrev', view);
  prev.innerHTML = '<div class="hint"><span class="spinner"></span> Loading photo…</div>';
  try {
    if (!file.type.startsWith('image/')) throw new Error('That is not a photo.');
    photo = await fileToPayload(file);
    prev.innerHTML = `<div style="display:flex;gap:10px;align-items:center;margin-top:8px"><img src="data:image/jpeg;base64,${photo.data}" alt="Photo to send" style="max-width:140px;max-height:110px;border-radius:8px;border:1px solid var(--line)"><button class="btn small ghost" type="button" id="rqNoPhoto">Remove photo</button></div>`;
    $('#rqDropTxt', view).textContent = 'Tap to change the photo';
    $('#rqNoPhoto', view).addEventListener('click', () => { photo = null; prev.innerHTML = ''; $('#rqDropTxt', view).textContent = 'Tap to take or add a photo'; });
  } catch (e) { photo = null; prev.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
}

async function submit(f) {
  const msg = $('#rqMsg', view), btn = $('#rqSubmit', view);
  const missing = [['name', 'your name'], ['customer', 'customer name'], ['spec', 'spec #'], ['change', 'the change']].filter(([k]) => !String(f[k] || '').trim()).map(([, t]) => t);
  if (missing.length) { msg.innerHTML = `<div class="alert err">Please fill in ${missing.join(', ')}.</div>`; return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
  try {
    await api('/api/requests', { method: 'POST', body: JSON.stringify({ ...f, photo }) });
    // keep the person's name and shift for next time, clear the rest
    saveForm('request_draft', { ...blankForm(), name: f.name, shift: f.shift });
    paintForm();
    $('#rqMsg', view).innerHTML = `<div class="alert ok">Thanks, ${esc(f.name.split(' ')[0])}. Your request for ${esc(f.customer)} (spec ${esc(f.spec)}) was sent.</div>`;
    refreshCount();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Send request';
    msg.innerHTML = `<div class="alert err">${esc(e.message)}. Your entry is still here. Try again.</div>`;
  }
}

// ---------- review list ----------
async function loadList() {
  const box = $('#rqList', view);
  box.innerHTML = '<div class="hint"><span class="spinner"></span> Loading requests…</div>';
  try {
    const { requests } = await api('/api/requests');
    list = requests || [];
    paintCount();
    paintList();
  } catch (e) {
    box.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
  }
}

function paintList(q = ($('#rqSearch', view) || {}).value || '') {
  const box = $('#rqList', view);
  const counts = Object.fromEntries(['All', ...STATUSES].map((s) => [s, s === 'All' ? list.length : list.filter((r) => r.status === s).length]));
  const needle = q.trim().toLowerCase();
  const shown = list.filter((r) => (filter === 'All' || r.status === filter) &&
    (!needle || [r.customer, r.spec, r.name, r.type, r.change, r.current, r.reason, r.machine].join(' ').toLowerCase().includes(needle)));
  box.innerHTML = `
    <div class="btn-row no-print" style="margin-bottom:12px;align-items:center">
      <div class="seg" id="rqFilter">${['New', 'Approved', 'Done', 'Rejected', 'All'].map((s) => `<button type="button" data-s="${s}" aria-pressed="${s === filter}">${s} (${counts[s]})</button>`).join('')}</div>
      <input id="rqSearch" type="search" placeholder="Search customer, spec #, name…" value="${esc(q)}" style="flex:1;min-width:180px">
      <button class="btn ghost" id="rqQrBtn" type="button" title="Print a poster with the QR code for the floor">Print QR poster</button>
    </div>
    ${shown.length ? shown.map(itemHtml).join('') : `<p class="hint">No ${filter === 'All' ? '' : filter.toLowerCase() + ' '}requests${needle ? ' match that search' : ''}.</p>`}`;
  $('#rqQrBtn', box).addEventListener('click', printQr);
  $$('#rqFilter button', box).forEach((b) => b.addEventListener('click', () => { filter = b.dataset.s; paintList($('#rqSearch', view).value); }));
  const search = $('#rqSearch', box);
  search.addEventListener('input', () => { const pos = search.selectionStart; paintList(search.value); const s2 = $('#rqSearch', view); s2.focus(); s2.setSelectionRange(pos, pos); });
  $$('details.entry', box).forEach((d) => d.addEventListener('toggle', () => { if (d.open) loadPhoto(d); }));
  $$('[data-save]', box).forEach((b) => b.addEventListener('click', () => saveReview(b.dataset.save)));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', () => del(b.dataset.del)));
  $$('[data-print]', box).forEach((b) => b.addEventListener('click', () => printOne(b.dataset.print)));
}

function itemHtml(r) {
  const k = esc(r.id);
  return `<details class="entry" data-id="${k}">
    <summary><span class="pill ${PILL[r.status] || 'info'}">${esc(r.status)}</span>
      <span class="when">${esc(r.customer)} · Spec ${esc(r.spec)}</span>
      <span class="who">${esc(r.type)} · ${esc(r.name)}${r.shift ? ` (${esc(r.shift)})` : ''} · ${esc(fmtDate(r.savedAt))}</span>
      ${r.hasPhoto ? '<span class="pill">Photo</span>' : ''}</summary>
    <div class="body">
      ${r.machine ? `<h4>Machine</h4><p>${esc(r.machine)}</p>` : ''}
      ${r.current ? `<h4>How it is now</h4><p>${esc(r.current)}</p>` : ''}
      <h4>Change it to</h4><p><b>${esc(r.change)}</b></p>
      ${r.reason ? `<h4>Why</h4><p>${esc(r.reason)}</p>` : ''}
      ${r.hasPhoto ? `<div class="rq-photo" style="margin-top:10px"><span class="hint"><span class="spinner"></span> Loading photo…</span></div>` : ''}
      ${r.reviewedAt ? `<p class="hint" style="margin-top:10px">Last reviewed ${esc(fmtDate(r.reviewedAt))}${r.reviewedBy ? ` by ${esc(r.reviewedBy)}` : ''}</p>` : ''}
      <div class="no-print" style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
        <div class="row">
          <div class="field"><label>Status</label><select data-rs="${k}">${STATUSES.map((s) => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
          <div class="field"><label>Reviewed by</label><input type="text" data-rb="${k}" value="${esc(r.reviewedBy || '')}" placeholder="Your name"></div>
        </div>
        <div class="field"><label>Note back to the floor</label><textarea data-rn="${k}" rows="2" placeholder="e.g. Approved. Spec updated to 48 × 48 starting next run.">${esc(r.reviewNote || '')}</textarea></div>
        <div class="btn-row" style="justify-content:space-between">
          <div class="btn-row"><button class="btn small primary" type="button" data-save="${k}">Save review</button><button class="btn small" type="button" data-print="${k}">Print</button></div>
          <button class="btn small ghost danger" type="button" data-del="${k}">Delete</button>
        </div>
        <div data-rmsg="${k}" aria-live="polite"></div>
      </div>
    </div>
  </details>`;
}

const photoCache = {};
async function getPhoto(id) {
  if (!photoCache[id]) photoCache[id] = api('/api/requests?photo=' + encodeURIComponent(id)).catch((e) => { delete photoCache[id]; throw e; });
  return photoCache[id];
}
async function loadPhoto(d) {
  const slot = $('.rq-photo', d);
  if (!slot || slot.dataset.done) return;
  try {
    const p = await getPhoto(d.dataset.id);
    slot.dataset.done = '1';
    slot.innerHTML = `<img src="data:${p.mediaType};base64,${p.data}" alt="Photo from the floor" style="max-width:100%;max-height:320px;border-radius:8px;border:1px solid var(--line)">`;
  } catch { slot.innerHTML = '<span class="hint">Could not load the photo.</span>'; }
}

const byId = (id) => list.find((r) => r.id === id);
const sel = (attr, id) => $$(`[${attr}]`, view).find((el) => el.getAttribute(attr) === id);

async function saveReview(id) {
  const msg = sel('data-rmsg', id), btn = sel('data-save', id);
  btn.disabled = true;
  try {
    const upd = await api('/api/requests?id=' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status: sel('data-rs', id).value, reviewedBy: sel('data-rb', id).value, reviewNote: sel('data-rn', id).value }) });
    const i = list.findIndex((r) => r.id === id);
    if (i >= 0) list[i] = upd;
    paintCount();
    msg.innerHTML = `<div class="alert ok" style="margin-top:8px">Saved as ${esc(upd.status)}.</div>`;
    setTimeout(() => paintList(), 900); // moves it to the right filter
  } catch (e) {
    msg.innerHTML = `<div class="alert err" style="margin-top:8px">${esc(e.message)}</div>`;
  } finally { btn.disabled = false; }
}

async function del(id) {
  const r = byId(id);
  if (!r || !confirm(`Delete the request for ${r.customer} (spec ${r.spec})? This can't be undone.`)) return;
  try {
    await api('/api/requests?id=' + encodeURIComponent(id), { method: 'DELETE' });
    list = list.filter((x) => x.id !== id);
    paintCount(); paintList();
  } catch (e) { alert(e.message); }
}

// ---------- printing ----------
function openPrint(html, wait) {
  let sheet = document.getElementById('printSheet');
  if (!sheet) { sheet = document.createElement('div'); sheet.id = 'printSheet'; document.body.appendChild(sheet); }
  sheet.innerHTML = html;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  const im = wait && sheet.querySelector('img');
  const go = () => setTimeout(() => window.print(), 50);
  if (im && !im.complete) { im.onload = go; im.onerror = go; } else go();
}

export function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
}

function printQr() {
  const url = `${location.origin}${location.pathname}#requests`;
  openPrint(`
    <div class="qr-poster">
      <div class="ps-head"><div><h1>Production Change Request</h1><div class="ps-sub">GoldenWest Packaging · Ontario</div></div></div>
      <p class="qr-lead">See a better way to run a job?<br><b>Scan to send a change request.</b></p>
      <div class="qr-code">${qrSvg(url)}</div>
      <p class="qr-lead" style="font-size:20px">¿Ve una mejor manera de correr un trabajo? <b>Escanee para enviar una solicitud de cambio.</b></p>
      <ol class="qr-steps">
        <li>Scan with your phone camera / Escanee con la cámara de su teléfono</li>
        <li>Enter the customer name and spec # / Escriba el cliente y el # de spec</li>
        <li>Tell us what to change and why / Diga qué cambiar y por qué</li>
      </ol>
      <p class="ps-sub" style="text-align:center;margin-top:18px">${esc(url)}<br>Needs the Production Hub access code the first time on each phone.</p>
    </div>`);
}

function printOne(id) {
  const r = byId(id);
  if (!r) return;
  const row = (k, v) => (v ? `<tr><th>${k}</th><td>${esc(v)}</td></tr>` : '');
  const build = (img) => `
    <div class="ps-head"><div><h1>Change Request</h1><div class="ps-sub">GoldenWest Packaging · Ontario</div></div><div class="ps-date">Submitted ${esc(fmtDate(r.savedAt))}</div></div>
    <table class="ps-kv ps-top"><caption>Job</caption>${row('Customer', r.customer)}${row('Spec #', r.spec)}${row('Machine', r.machine)}</table>
    <table class="ps-kv ps-top"><caption>Request</caption>${row('What to change', r.type)}${row('How it is now', r.current)}${row('Change it to', r.change)}${row('Why', r.reason)}${row('Requested by', `${r.name}${r.shift ? ` (${r.shift} shift)` : ''}`)}</table>
    <table class="ps-kv ps-top"><caption>Review</caption><tr><th>Status</th><td>${esc(r.status)}</td></tr><tr><th>Reviewed by</th><td>${esc(r.reviewedBy || '')}</td></tr><tr><th>Note</th><td style="height:44px">${esc(r.reviewNote || '')}</td></tr></table>
    ${img ? `<figure><img src="${img}" alt="Photo"><figcaption>Photo from the floor</figcaption></figure>` : ''}
    <div class="ps-sign"><span>Approved by: ______________________</span><span>Date: ____________</span></div>`;
  if (!r.hasPhoto) return openPrint(build(''));
  getPhoto(id).then((p) => openPrint(build(`data:${p.mediaType};base64,${p.data}`), true)).catch(() => openPrint(build('')));
}
