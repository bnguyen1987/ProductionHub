// Settings: clean-up schedule for the year, and QR codes for the floor (change requests and each machine's clean-up checklist).
import { $, $$, esc, api } from './common.js';
import { qrSvg, openPrint } from './printkit.js';
import { CLEANUP_MACHINES, machineLabel, addDays, todayYmd } from './cleanupdata.js';

const base = () => `${location.origin}${location.pathname}#`;

export function render(view) {
  view.innerHTML = `
    <div class="page-head"><h1>Settings</h1><p>Plan the machine clean-up schedule, and print QR codes for the floor.</p></div>
    <div class="btn-row" style="margin-bottom:10px"><button class="btn small" type="button" id="foldOpen">Expand all</button><button class="btn small" type="button" id="foldClose">Collapse all</button></div>
    <details class="card fold" data-fold="schedule">
      <summary><h2>Clean-up schedule</h2><span class="hint" id="schedSum"></span></summary>
      <div id="schedCard"><div class="hint"><span class="spinner"></span> Loading…</div></div>
    </details>
    <details class="card fold" data-fold="qrReq">
      <summary><h2>QR code · Change requests</h2></summary>
      <p class="hint" style="margin:0 0 12px">Print a poster and post it where people will scan it. Each code opens the page straight away (the access code is needed the first time on each phone).</p>
      <div class="qr-set">
        <div class="qr-tile" data-no-i18n>${qrSvg(base() + 'requests')}</div>
        <div>
          <p style="margin:0 0 8px">One poster for the whole floor: employees suggest a change to a job, or report a plate or die that needs repair.</p>
          <p class="hint" style="margin:0 0 10px">${esc(base() + 'requests')}</p>
          <button class="btn primary" type="button" id="qrReq">Print poster</button>
        </div>
      </div>
    </details>
    <details class="card fold" data-fold="qrClean">
      <summary><h2>QR codes · Machine clean-up</h2><span class="hint">${CLEANUP_MACHINES.length} machines</span></summary>
      <p style="margin:0 0 10px">One poster per machine. Scanning it opens that machine's bi-weekly clean-up checklist.</p>
      <button class="btn primary" type="button" id="qrAll" style="margin-bottom:14px">Print all machines (${CLEANUP_MACHINES.length} pages)</button>
      <div class="qr-grid">
        ${CLEANUP_MACHINES.map((m) => `<div class="qr-card">
          <div class="qr-tile small" data-no-i18n>${qrSvg(base() + 'cleanup/' + encodeURIComponent(m.id))}</div>
          <b>${esc(machineLabel(m))}</b>
          <button class="btn small" type="button" data-qr="${esc(m.id)}">Print</button>
        </div>`).join('')}
      </div>
    </details>`;
  // open/closed state is remembered on this device
  let folds = {}; try { folds = JSON.parse(localStorage.getItem('gwprod_settings_folds') || '{}'); } catch {}
  const folders = $$('details.fold', view);
  folders.forEach((d) => {
    d.open = folds[d.dataset.fold] ?? d.dataset.fold === 'schedule';
    d.addEventListener('toggle', () => { folds[d.dataset.fold] = d.open; try { localStorage.setItem('gwprod_settings_folds', JSON.stringify(folds)); } catch {} });
  });
  $('#foldOpen', view).addEventListener('click', () => folders.forEach((d) => (d.open = true)));
  $('#foldClose', view).addEventListener('click', () => folders.forEach((d) => (d.open = false)));
  loadSchedule();
  $('#qrReq', view).addEventListener('click', async () => (await import('./requests.js')).printQr());
  const cl = () => import('./cleanup.js');
  $('#qrAll', view).addEventListener('click', async () => (await cl()).printQr(CLEANUP_MACHINES));
  $$('[data-qr]', view).forEach((b) => b.addEventListener('click', async () => (await cl()).printQr([CLEANUP_MACHINES.find((m) => m.id === b.dataset.qr)])));
}

// ---------- clean-up schedule ----------
let plan = [], updatedAt = null, saveT = null, showPast = false;
const gen = { start: todayYmd(), repeat: '14', through: addDays(todayYmd(), 364), shift: '1st', all: true, picked: [] };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayName = (ymd) => DAYS[new Date(ymd + 'T12:00:00').getDay()];
const fmtD = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const monthOf = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const machinesText = (ms) => (ms === 'all' ? 'All machines' : ms.map((id) => machineLabel(CLEANUP_MACHINES.find((m) => m.id === id) || { id, name: id })).join(', '));
const sameSet = (a, b) => (a === 'all' || b === 'all' ? a === b : a.length === b.length && a.every((x) => b.includes(x)));

async function loadSchedule() {
  try { const r = await api('/api/cleanup?schedule'); plan = r.plan || []; updatedAt = r.updatedAt; }
  catch (e) { const c = $('#schedCard'); if (c) c.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return; }
  paintSchedule();
}

function save() {
  clearTimeout(saveT);
  const st = $('#schedSaved'); if (st) st.textContent = 'Saving…';
  saveT = setTimeout(async () => {
    try {
      const r = await api('/api/cleanup?schedule', { method: 'PUT', body: JSON.stringify({ plan }) });
      plan = r.plan; updatedAt = r.updatedAt;
      const s2 = $('#schedSaved'); if (s2) s2.textContent = `Saved for everyone · ${new Date(updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    } catch (e) { const s2 = $('#schedSaved'); if (s2) s2.innerHTML = `<span style="color:var(--bad)">Not saved: ${esc(e.message)}</span>`; }
  }, 500);
}

function paintSchedule() {
  const box = $('#schedCard');
  if (!box) return;
  const today = todayYmd();
  const rows = plan.map((p, i) => ({ p, i })).filter(({ p }) => showPast || p.date >= today);
  const past = plan.filter((p) => p.date < today).length;
  let month = '';
  const nx = plan.find((p) => p.date >= today), sum = $('#schedSum');
  if (sum) sum.textContent = nx ? `Next: ${dayName(nx.date)} ${fmtD(nx.date)}, ${nx.shift} shift · ${plan.filter((p) => p.date >= today).length} upcoming` : 'Nothing scheduled';
  box.innerHTML = `
    <p style="margin:0 0 12px">Plan the clean-up days and the shift responsible. The Clean-Up board and each machine's page show the next scheduled day, and a scheduled day that passes with no clean-up logged shows as overdue.</p>
    <div class="sched-gen">
      <div class="row">
        <div class="field"><label for="sgStart">First clean-up day</label><input type="date" id="sgStart" value="${gen.start}"></div>
        <div class="field"><label for="sgRepeat">Repeat</label><select id="sgRepeat">${[['0', 'Just this day'], ['7', 'Every week'], ['14', 'Every 2 weeks'], ['28', 'Every 4 weeks']].map(([v, t]) => `<option value="${v}" ${gen.repeat === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field ${gen.repeat === '0' ? 'hidden' : ''}" id="sgThroughF"><label for="sgThrough">Through</label><input type="date" id="sgThrough" value="${gen.through}"></div>
      </div>
      <div class="field"><label>Shift responsible</label><div class="seg" id="sgShift">${[['1st', '1st'], ['2nd', '2nd'], ['alt', 'Alternate 1st / 2nd']].map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${gen.shift === v}">${t}</button>`).join('')}</div></div>
      <div class="field"><label><input type="checkbox" id="sgAll" ${gen.all ? 'checked' : ''}> All machines</label>
        <div class="sched-machines ${gen.all ? 'hidden' : ''}" id="sgPick">${CLEANUP_MACHINES.map((m) => `<label><input type="checkbox" data-m="${esc(m.id)}" ${gen.picked.includes(m.id) ? 'checked' : ''}> ${esc(machineLabel(m))}</label>`).join('')}</div></div>
      <div class="btn-row"><button class="btn primary" type="button" id="sgAdd">Add to schedule</button><span class="hint" id="sgMsg"></span></div>
    </div>
    <div class="btn-row" style="margin:16px 0 8px;align-items:center;justify-content:space-between">
      <label class="hint"><input type="checkbox" id="schedPast" ${showPast ? 'checked' : ''}> Show past days${past ? ` (${past})` : ''}</label>
      <span class="btn-row"><button class="btn small" type="button" id="schedPrint" ${plan.length ? '' : 'disabled'}>Print schedule</button><button class="btn small ghost danger" type="button" id="schedClear" ${plan.some((p) => p.date >= today) ? '' : 'disabled'}>Clear upcoming days</button></span>
    </div>
    ${rows.length ? `<div class="tbl-wrap"><table class="tbl sched-tbl"><thead><tr><th>Date</th><th>Shift</th><th>Machines</th><th>Note</th><th></th></tr></thead><tbody>
      ${rows.map(({ p, i }) => { const m = monthOf(p.date), head = m !== month ? `<tr class="sched-month"><td colspan="5">${m}</td></tr>` : ''; month = m;
        return `${head}<tr class="${p.date < today ? 'past' : p.date === today ? 'best' : ''}">
          <td style="white-space:nowrap"><b>${dayName(p.date)} ${fmtD(p.date)}</b></td>
          <td><select data-i="${i}" data-k="shift"><option value="1st" ${p.shift === '1st' ? 'selected' : ''}>1st</option><option value="2nd" ${p.shift === '2nd' ? 'selected' : ''}>2nd</option></select></td>
          <td>${esc(machinesText(p.machines))}</td>
          <td><input type="text" data-i="${i}" data-k="note" value="${esc(p.note || '')}" placeholder="optional"></td>
          <td><button class="btn small ghost danger" type="button" data-del="${i}" aria-label="Remove day">×</button></td></tr>`; }).join('')}
    </tbody></table></div>` : `<p class="hint">${plan.length ? 'No upcoming days. Turn on "Show past days" to see the rest.' : 'Nothing scheduled yet. Pick the first day, how often, and the shift, then Add to schedule.'}</p>`}
    <p class="hint" id="schedSaved" style="margin:8px 0 0">${updatedAt ? `Saved for everyone · ${new Date(updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</p>`;

  $('#sgStart', box).addEventListener('input', (e) => { gen.start = e.target.value; });
  $('#sgThrough', box).addEventListener('input', (e) => { gen.through = e.target.value; });
  $('#sgRepeat', box).addEventListener('change', (e) => { gen.repeat = e.target.value; $('#sgThroughF', box).classList.toggle('hidden', gen.repeat === '0'); });
  $$('#sgShift button', box).forEach((b) => b.addEventListener('click', () => { gen.shift = b.dataset.v; $$('#sgShift button', box).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
  $('#sgAll', box).addEventListener('change', (e) => { gen.all = e.target.checked; $('#sgPick', box).classList.toggle('hidden', gen.all); });
  $$('[data-m]', box).forEach((c) => c.addEventListener('change', () => { gen.picked = $$('[data-m]', box).filter((x) => x.checked).map((x) => x.dataset.m); }));
  $('#sgAdd', box).addEventListener('click', addDays_);
  $('#schedPast', box).addEventListener('change', (e) => { showPast = e.target.checked; paintSchedule(); });
  $('#schedPrint', box).addEventListener('click', printSchedule);
  $('#schedClear', box).addEventListener('click', () => {
    if (!confirm('Remove every upcoming clean-up day from the schedule? Past days are kept.')) return;
    plan = plan.filter((p) => p.date < todayYmd()); save(); paintSchedule();
  });
  $$('[data-k]', box).forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { plan[+el.dataset.i][el.dataset.k] = el.value; save(); }));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', () => { plan.splice(+b.dataset.del, 1); save(); paintSchedule(); }));
}

function addDays_() {
  const msg = $('#sgMsg');
  const machines = gen.all ? 'all' : gen.picked.slice();
  if (!gen.start) { msg.textContent = 'Pick the first clean-up day.'; return; }
  if (machines !== 'all' && !machines.length) { msg.textContent = 'Pick at least one machine.'; return; }
  const step = +gen.repeat, dates = [];
  if (!step) dates.push(gen.start);
  else {
    if (!gen.through || gen.through < gen.start) { msg.textContent = '"Through" must be after the first day.'; return; }
    for (let d = gen.start; d <= gen.through && dates.length < 400; d = addDays(d, step)) dates.push(d);
  }
  let added = 0;
  dates.forEach((date, k) => {
    const shift = gen.shift === 'alt' ? (k % 2 ? '2nd' : '1st') : gen.shift;
    plan = plan.filter((p) => !(p.date === date && sameSet(p.machines, machines))); // same day, same machines: replace
    plan.push({ date, shift, machines, note: '' });
    added++;
  });
  plan.sort((a, b) => a.date.localeCompare(b.date));
  save(); paintSchedule();
  const m2 = $('#sgMsg'); if (m2) m2.textContent = `Added ${added} day${added > 1 ? 's' : ''}.`;
}

function printSchedule() {
  const today = todayYmd();
  const rows = plan.filter((p) => showPast || p.date >= today);
  let month = '';
  openPrint(`
    <div class="ps-head"><div><h1>Machine Clean-Up Schedule</h1><div class="ps-sub">GoldenWest Packaging · Ontario · Programa de limpieza de máquinas</div></div><div class="ps-date">Printed ${esc(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}</div></div>
    <table class="ps-kv"><tr><th style="width:22%">Date / Fecha</th><th style="width:14%">Shift / Turno</th><th>Machines / Máquinas</th><th style="width:26%">Note / Nota</th></tr>
    ${rows.map((p) => { const m = monthOf(p.date), head = m !== month ? `<tr><td colspan="4" style="background:#f3f1ec;font-weight:700">${m}</td></tr>` : ''; month = m;
      return `${head}<tr><td>${dayName(p.date)} ${fmtD(p.date)}</td><td>${p.shift}</td><td>${esc(machinesText(p.machines))}</td><td>${esc(p.note || '')}</td></tr>`; }).join('')}
    </table>`);
}
