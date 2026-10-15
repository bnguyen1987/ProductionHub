// Bi-weekly machine clean-up. Board of all machines (due / overdue), and a sign-off checklist per machine.
// Each machine has its own QR code that opens #cleanup/<machine id> straight to its checklist.
import { $, $$, esc, api, SUPERVISORS, saveForm, loadForm, getLang } from './common.js';
import { CLEANUP_MACHINES, TASK_ES, CYCLE_DAYS, DUE_SOON_DAYS, isSafetyTask, machineLabel } from './cleanupdata.js';
import { openPrint, qrSvg } from './printkit.js';

let view, entries = [], loaded = false, machineId = null, histFilter = '';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const guessShift = () => { const d = new Date(), m = d.getHours() * 60 + d.getMinutes(); return m >= 14 * 60 + 30 || m < 4 * 60 ? '2nd' : '1st'; };
const dayNum = (ymd) => Math.round(new Date(ymd + 'T12:00:00').getTime() / 86400000);
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDay = (ymd) => { if (!ymd) return '–'; const d = new Date(ymd + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const fmtWhen = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const minutes = (a, b) => { if (!a || !b) return 0; const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); let d = h2 * 60 + m2 - (h1 * 60 + m1); if (d < 0) d += 1440; return d; };
const byId = (id) => CLEANUP_MACHINES.find((m) => m.id === id);
const taskText = (t) => (getLang() === 'es' && TASK_ES[t] ? TASK_ES[t] : t);

// Last clean-up per machine and where it stands against the 14-day cycle.
function machineStatus(m) {
  const mine = entries.filter((e) => e.machine === m.id).sort((a, b) => (b.date + b.savedAt).localeCompare(a.date + a.savedAt));
  const last = mine[0];
  if (!last) return { key: 'none', label: 'Not logged', cls: 'info', last: null };
  const next = addDays(last.date, CYCLE_DAYS);
  const left = dayNum(next) - dayNum(today());
  const s = left < 0 ? { key: 'over', label: 'Overdue', cls: 'bad' } : left <= DUE_SOON_DAYS ? { key: 'soon', label: 'Due soon', cls: 'warn' } : { key: 'ok', label: 'On track', cls: 'ok' };
  return { ...s, last, next, left, pending: mine.filter((e) => e.status === 'Pending') };
}

export function render(el, sub) {
  view = el;
  machineId = sub && byId(decodeURIComponent(sub)) ? decodeURIComponent(sub) : null;
  if (machineId) renderMachine(); else renderBoard();
  load();
}
export function onLang() { if (machineId) paintTasks(); }

async function load() {
  try {
    const r = await api('/api/cleanup');
    entries = r.entries || []; loaded = true;
    if (machineId) paintMachineHead(); else paintBoard();
  } catch (e) {
    const box = $('#clBoard') || $('#clHead');
    if (box) box.insertAdjacentHTML('afterbegin', `<div class="alert err">${esc(e.message)}</div>`);
  }
}

// ---------- board ----------
function renderBoard() {
  view.innerHTML = `
    <div class="page-head"><h1>Machine Clean-Up</h1><p>Bi-weekly clean-up for every machine. Scan the QR code on the machine to open its checklist, mark each task, and sign. The supervisor verifies and accepts.</p></div>
    <div class="btn-row no-print" style="margin-bottom:14px">
      <button class="btn" type="button" id="clQrAll">Print QR codes (all machines)</button>
    </div>
    <section class="card" id="clBoard"><div class="hint"><span class="spinner"></span> Loading…</div></section>
    <section class="card" id="clHist" style="margin-top:16px"></section>`;
  $('#clQrAll').addEventListener('click', () => printQr(CLEANUP_MACHINES));
}

function paintBoard() {
  const box = $('#clBoard');
  if (!box) return;
  const rows = CLEANUP_MACHINES.map((m) => ({ m, st: machineStatus(m) }));
  const count = (k) => rows.filter((r) => r.st.key === k).length;
  const pend = rows.reduce((a, r) => a + (r.st.pending ? r.st.pending.length : 0), 0);
  box.innerHTML = `
    <h2>Status board <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:500">every ${CYCLE_DAYS} days</span></h2>
    <div class="chips" style="margin-bottom:12px">
      <span class="pill bad">${count('over')} overdue</span><span class="pill warn">${count('soon')} due soon</span>
      <span class="pill ok">${count('ok')} on track</span><span class="pill info">${count('none')} not logged</span>
      ${pend ? `<span class="pill star">${pend} waiting for supervisor</span>` : ''}
    </div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Machine</th><th>Status</th><th>Last clean-up</th><th>Next due</th><th>Supervisor</th><th></th></tr></thead><tbody>
    ${rows.map(({ m, st }) => `<tr>
      <td style="white-space:nowrap"><b>${esc(machineLabel(m))}</b><br><span class="hint">${esc(m.type)} · ${m.tasks.length} tasks</span></td>
      <td><span class="pill ${st.cls}">${st.label}</span>${st.pending && st.pending.length ? '<br><span class="pill star" style="margin-top:4px">Needs supervisor</span>' : ''}</td>
      <td style="white-space:nowrap">${st.last ? `${fmtDay(st.last.date)}<br><span class="hint">${esc(st.last.shift)} shift</span>` : '–'}</td>
      <td style="white-space:nowrap">${st.next ? `${fmtDay(st.next)}<br><span class="hint">${st.left < 0 ? `${-st.left} days late` : st.left === 0 ? 'today' : `in ${st.left} days`}</span>` : '–'}</td>
      <td>${st.last && st.last.supervisor ? esc(st.last.supervisor) : '–'}</td>
      <td style="white-space:nowrap"><a class="btn small primary" href="#cleanup/${encodeURIComponent(m.id)}">Checklist</a> <button class="btn small" type="button" data-qr="${esc(m.id)}">QR</button></td>
    </tr>`).join('')}
    </tbody></table></div>`;
  $$('[data-qr]', box).forEach((b) => b.addEventListener('click', () => printQr([byId(b.dataset.qr)])));
  paintHistory();
}

function paintHistory() {
  const box = $('#clHist');
  if (!box) return;
  const q = histFilter.trim().toLowerCase();
  const shown = entries.filter((e) => !q || [e.machine, e.machineName, e.supervisor, e.repairNo, ...(e.crew || [])].join(' ').toLowerCase().includes(q)).slice(0, 60);
  box.innerHTML = `<h2>Recent clean-ups</h2>
    <input type="search" id="clSearch" placeholder="Search machine, name, RepairTracker #…" value="${esc(histFilter)}" style="margin-bottom:10px">
    ${shown.length ? shown.map(entryHtml).join('') : '<p class="hint">No clean-ups logged yet.</p>'}`;
  const s = $('#clSearch', box);
  s.addEventListener('input', () => { const pos = s.selectionStart; histFilter = s.value; paintHistory(); const s2 = $('#clSearch'); s2.focus(); s2.setSelectionRange(pos, pos); });
  $$('[data-print]', box).forEach((b) => b.addEventListener('click', () => printEntry(entries.find((e) => e.id === b.dataset.print))));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', () => delEntry(b.dataset.del)));
}

function entryHtml(e) {
  const done = (e.tasks || []).filter((t) => t.status === 'done').length, na = (e.tasks || []).filter((t) => t.status === 'na').length;
  const mins = minutes(e.start, e.end);
  return `<details class="entry">
    <summary><span class="when">${esc(e.machineName || e.machine)} · ${fmtDay(e.date)}</span><span class="who">${esc(e.shift)} shift · ${esc((e.crew || []).join(', '))}</span>
      <span class="pill ${e.status === 'Verified' ? 'ok' : 'star'}">${e.status === 'Verified' ? 'Verified' : 'Needs supervisor'}</span>
      ${e.issuesFound === 'Y' ? '<span class="pill bad">Issues found</span>' : ''}${e.taggedOut === 'Y' ? '<span class="pill bad">Tagged out</span>' : ''}</summary>
    <div class="body">
      <p>${done} done${na ? `, ${na} N/A` : ''} of ${(e.tasks || []).length} tasks${mins ? ` · ${mins} min` : ''}${e.start ? ` (${esc(e.start)}–${esc(e.end || '?')})` : ''}</p>
      ${e.issuesFound === 'Y' ? `<h4>Issues</h4><p>${esc(e.issues || '')}${e.repairNo ? ` · RepairTracker #${esc(e.repairNo)}` : ''}${e.maintNotified === 'Y' ? ' · Maintenance notified' : e.maintNotified === 'N' ? ' · <b>Maintenance not notified</b>' : ''}</p>` : ''}
      ${e.supervisor ? `<h4>Supervisor</h4><p>${esc(e.supervisor)} · ${esc(fmtWhen(e.verifiedAt))}${e.supNote ? ` · ${esc(e.supNote)}` : ''}</p>` : ''}
      <div class="btn-row no-print" style="margin-top:10px;justify-content:space-between"><span class="hint">Submitted ${esc(fmtWhen(e.savedAt))}</span>
        <span class="btn-row"><button class="btn small" type="button" data-print="${esc(e.id)}">Print</button><button class="btn small ghost danger" type="button" data-del="${esc(e.id)}">Delete</button></span></div>
    </div></details>`;
}

async function delEntry(id) {
  const e = entries.find((x) => x.id === id);
  if (!e || !confirm(`Delete the ${e.machineName || e.machine} clean-up from ${fmtDay(e.date)} for everyone? This cannot be undone.`)) return;
  try { await api('/api/cleanup?id=' + encodeURIComponent(id), { method: 'DELETE' }); entries = entries.filter((x) => x.id !== id); paintBoard(); }
  catch (err) { alert(err.message); }
}

// ---------- one machine: sign-off checklist ----------
let draft;
const draftKey = () => 'cleanup_' + machineId;
function newDraft(m) {
  return { date: today(), shift: guessShift(), start: '', end: '', status: m.tasks.map(() => ''), crew: ['', ''], issuesFound: '', taggedOut: '', maintNotified: '', repairNo: '', issues: '' };
}

function renderMachine() {
  const m = byId(machineId);
  const saved = loadForm(draftKey());
  draft = saved && Array.isArray(saved.status) && saved.status.length === m.tasks.length ? saved : newDraft(m);
  if (draft.date !== today() && !draft.status.some(Boolean)) draft.date = today();
  view.innerHTML = `
    <div class="no-print" style="margin-bottom:8px"><a href="#cleanup" class="hint">← All machines</a></div>
    <div class="page-head"><h1>Clean-Up: ${esc(machineLabel(m))}</h1><p>Bi-weekly clean-up checklist · ${esc(m.type)}. Mark each task when it is done (or N/A), then sign at the bottom.</p></div>
    <div id="clHead"></div>
    <div class="layout two">
      <div class="stack">
        <section class="card">
          <h2><span class="n">1</span>Clean-up</h2>
          <div class="row">
            <div class="field"><label for="clDate">Date</label><input type="date" id="clDate" data-d="date"></div>
            <div class="field"><label>Shift</label><div class="seg" id="clShift"><button type="button" data-v="1st">1st</button><button type="button" data-v="2nd">2nd</button></div></div>
          </div>
          <div class="row">
            <div class="field"><label for="clStart">Start</label><input type="time" id="clStart" data-d="start"></div>
            <div class="field"><label for="clEnd">End</label><input type="time" id="clEnd" data-d="end"></div>
          </div>
        </section>
        <section class="card">
          <h2><span class="n">2</span>Tasks <span class="hint" id="clCount" style="text-transform:none;letter-spacing:0;font-weight:600"></span></h2>
          <div id="clTasks"></div>
        </section>
      </div>
      <div class="stack">
        <section class="card">
          <h2><span class="n">3</span>Issues found</h2>
          ${ynRow('issuesFound', 'Damage, leaks, worn parts or other problems found?')}
          <div id="clIssueBox">
            ${ynRow('taggedOut', 'Machine tagged "Out of Service"?')}
            ${ynRow('maintNotified', 'Maintenance notified? (Jess Goodrich)')}
            <div class="field"><label for="clRT">RepairTracker #</label><input type="text" id="clRT" data-d="repairNo" autocomplete="off"></div>
            <div class="field"><label for="clIss">Describe</label><textarea id="clIss" data-d="issues" rows="3" placeholder="What is wrong, where on the machine"></textarea></div>
          </div>
        </section>
        <section class="card">
          <h2><span class="n">4</span>Crew sign-off</h2>
          <div id="clCrew"></div>
          <button class="btn small" type="button" id="clAddCrew" style="margin-top:4px">+ Add name</button>
          <p class="hint" style="margin:10px 0 0">By sending, the crew confirms the tasks above were done.</p>
          <button class="btn primary" type="button" id="clSend" style="width:100%;margin-top:10px">Send clean-up for supervisor sign-off</button>
          <div id="clMsg" aria-live="polite" style="margin-top:10px"></div>
        </section>
      </div>
    </div>`;
  $$('[data-d]', view).forEach((el) => { el.value = draft[el.dataset.d] || ''; el.addEventListener('input', () => { draft[el.dataset.d] = el.value; persist(); }); });
  $$('#clShift button', view).forEach((b) => b.addEventListener('click', () => { draft.shift = b.dataset.v; persist(); paintShift(); }));
  $$('[data-yn]', view).forEach((b) => b.addEventListener('click', () => { draft[b.dataset.yn] = b.dataset.v; persist(); paintYN(); }));
  $('#clAddCrew', view).addEventListener('click', () => { if (draft.crew.length < 8) { draft.crew.push(''); persist(); paintCrew(); } });
  $('#clSend', view).addEventListener('click', send);
  paintShift(); paintYN(); paintTasks(); paintCrew();
}

function ynRow(key, label) {
  return `<div class="field"><label>${label}</label><div class="seg"><button type="button" data-yn="${key}" data-v="Y">Yes</button><button type="button" data-yn="${key}" data-v="N">No</button></div></div>`;
}
const persist = () => { saveForm(draftKey(), draft); const m = $('#clMsg'); if (m && m.querySelector('.err')) m.innerHTML = ''; };
function paintShift() { $$('#clShift button', view).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === draft.shift))); }
function paintYN() {
  $$('[data-yn]', view).forEach((b) => b.setAttribute('aria-pressed', String(draft[b.dataset.yn] === b.dataset.v)));
  $('#clIssueBox', view).classList.toggle('hidden', draft.issuesFound !== 'Y');
}

function paintTasks() {
  const m = byId(machineId);
  const box = $('#clTasks', view);
  if (!box) return;
  box.innerHTML = m.tasks.map((t, i) => `
    <div class="cl-task${isSafetyTask(t) ? ' safety' : ''}${draft.status[i] ? ' marked' : ''}" data-i="${i}">
      <span class="cl-n">${i + 1}</span>
      <span class="cl-t" data-no-i18n>${esc(taskText(t))}</span>
      <span class="seg cl-seg"><button type="button" data-s="done" aria-pressed="${draft.status[i] === 'done'}">✓ Done</button>${isSafetyTask(t) ? '' : `<button type="button" data-s="na" aria-pressed="${draft.status[i] === 'na'}">N/A</button>`}</span>
    </div>`).join('');
  $$('.cl-task', box).forEach((row) => {
    const i = +row.dataset.i;
    $$('button', row).forEach((b) => b.addEventListener('click', () => {
      draft.status[i] = draft.status[i] === b.dataset.s ? '' : b.dataset.s;
      persist(); paintTasks();
    }));
  });
  const n = draft.status.filter(Boolean).length;
  $('#clCount', view).textContent = `${n} / ${m.tasks.length}`;
}

function paintCrew() {
  const box = $('#clCrew', view);
  box.innerHTML = draft.crew.map((c, i) => `<div class="field"><label>Name ${i + 1}${i === 0 ? ' *' : ''}</label><input type="text" data-c="${i}" value="${esc(c)}" autocomplete="name" placeholder="Print name"></div>`).join('');
  $$('[data-c]', box).forEach((el) => el.addEventListener('input', () => { draft.crew[+el.dataset.c] = el.value; persist(); }));
}

function paintMachineHead() {
  const m = byId(machineId), box = $('#clHead', view);
  if (!box || !m) return;
  const st = machineStatus(m);
  const pend = st.pending || [];
  box.innerHTML = `
    <div class="alert ${st.key === 'over' ? 'err' : st.key === 'soon' ? 'warn' : st.key === 'ok' ? 'ok' : 'info'}" style="margin-bottom:14px">
      ${st.last ? `<b>${st.label}.</b> Last clean-up ${fmtDay(st.last.date)} (${esc(st.last.shift)} shift). Next due ${fmtDay(st.next)}.` : '<b>Not logged.</b> No clean-up recorded for this machine yet.'}
    </div>
    ${pend.map((e) => `<section class="card" style="margin-bottom:14px;border-color:var(--accent)">
      <h2>Supervisor sign-off needed</h2>
      <p style="margin:0 0 10px">Clean-up from <b>${fmtDay(e.date)}</b> (${esc(e.shift)} shift) by ${esc((e.crew || []).join(', '))}: ${(e.tasks || []).filter((t) => t.status === 'done').length} done, ${(e.tasks || []).filter((t) => t.status === 'na').length} N/A.
        ${e.issuesFound === 'Y' ? `<br><span class="pill bad">Issues found</span> ${esc(e.issues || '')}${e.repairNo ? ` · RepairTracker #${esc(e.repairNo)}` : ''}` : ''}</p>
      <div class="row">
        <div class="field"><label>Supervisor</label><select data-sup="${esc(e.id)}"><option value="">Select…</option>${[...SUPERVISORS, 'Israel Sanchez', 'Other'].map((s) => `<option>${esc(s)}</option>`).join('')}</select></div>
        <div class="field hidden" data-supo-wrap="${esc(e.id)}"><label>Name</label><input type="text" data-supo="${esc(e.id)}"></div>
      </div>
      <div class="field"><label>Note (optional)</label><input type="text" data-supn="${esc(e.id)}" placeholder="e.g. Anilox rolls need a second pass next time"></div>
      <button class="btn primary" type="button" data-verify="${esc(e.id)}">Machine inspected and accepted</button>
      <div data-vmsg="${esc(e.id)}" aria-live="polite" style="margin-top:8px"></div>
    </section>`).join('')}`;
  const pick = (attr, id) => $$(`[${attr}]`, box).find((el) => el.getAttribute(attr) === id);
  $$('[data-sup]', box).forEach((sel) => sel.addEventListener('change', () => pick('data-supo-wrap', sel.dataset.sup).classList.toggle('hidden', sel.value !== 'Other')));
  $$('[data-verify]', box).forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.verify, msg = pick('data-vmsg', id);
    const sel = pick('data-sup', id).value, name = sel === 'Other' ? pick('data-supo', id).value.trim() : sel;
    if (!name) { msg.innerHTML = '<div class="alert err">Pick the supervisor name.</div>'; return; }
    b.disabled = true;
    try {
      const upd = await api('/api/cleanup?id=' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ supervisor: name, supNote: pick('data-supn', id).value }) });
      entries = entries.map((x) => (x.id === id ? upd : x));
      paintMachineHead();
      $('#clHead', view).insertAdjacentHTML('afterbegin', `<div class="alert ok" style="margin-bottom:14px">Verified by ${esc(name)}. Clean-up complete.</div>`);
    } catch (e) { b.disabled = false; msg.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  }));
}

async function send() {
  const m = byId(machineId), msg = $('#clMsg', view), btn = $('#clSend', view);
  const open = draft.status.map((s, i) => (s ? 0 : i + 1)).filter(Boolean);
  const crew = draft.crew.map((c) => c.trim()).filter(Boolean);
  const problems = [];
  if (open.length) problems.push(`mark task${open.length > 1 ? 's' : ''} ${open.join(', ')} Done or N/A`);
  if (!draft.date) problems.push('the date');
  if (!crew.length) problems.push('at least one crew name');
  if (!draft.issuesFound) problems.push('Issues found Yes or No');
  if (problems.length) { msg.innerHTML = `<div class="alert err">Please ${problems.join('; ')}.</div>`; return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
  const issues = draft.issuesFound === 'Y';
  try {
    await api('/api/cleanup', { method: 'POST', body: JSON.stringify({
      machine: m.id, machineName: machineLabel(m), date: draft.date, shift: draft.shift, start: draft.start, end: draft.end,
      tasks: m.tasks.map((t, i) => ({ task: t, status: draft.status[i] })), crew,
      issuesFound: draft.issuesFound, taggedOut: issues ? draft.taggedOut : 'N', maintNotified: issues ? draft.maintNotified : '',
      repairNo: issues ? draft.repairNo : '', issues: issues ? draft.issues : '', lang: getLang(),
    }) });
    const keepCrew = crew.length ? [...crew, ''] : ['', ''];
    draft = newDraft(m); draft.crew = keepCrew.slice(0, 8);
    persist();
    await load();
    renderMachine(); paintMachineHead();
    $('#clMsg', view).innerHTML = '<div class="alert ok">Sent. Ask your supervisor to verify it at the top of this page.</div>';
    window.scrollTo(0, 0);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Send clean-up for supervisor sign-off';
    msg.innerHTML = `<div class="alert err">${esc(e.message)}. Your entry is still here. Try again.</div>`;
  }
}

// ---------- printing ----------
function printQr(list) {
  const base = `${location.origin}${location.pathname}#cleanup/`;
  openPrint(list.map((m, i) => `
    <div class="qr-poster" style="${i ? 'page-break-before:always;break-before:page' : ''}">
      <div class="ps-head"><div><h1>Machine Clean-Up · Limpieza de Máquina</h1><div class="ps-sub">GoldenWest Packaging · Ontario · every ${CYCLE_DAYS} days / cada ${CYCLE_DAYS} días</div></div></div>
      <p class="qr-lead" style="font-size:40px;margin:14px 0 6px"><b>${esc(machineLabel(m))}</b></p>
      <p class="qr-lead" style="margin:4px 0 10px">Scan to sign off the clean-up<br>Escanee para firmar la limpieza</p>
      <div class="qr-code">${qrSvg(base + encodeURIComponent(m.id))}</div>
      <ol class="qr-steps">
        <li>Lock out the machine (LOTO) / Bloquee la máquina (LOTO)</li>
        <li>Mark each task Done or N/A / Marque cada tarea Hecho o N/A</li>
        <li>Enter crew names and send / Escriba los nombres y envíe</li>
        <li>Supervisor verifies on the same page / El supervisor verifica en la misma página</li>
      </ol>
      <p class="ps-sub" style="text-align:center;margin-top:14px">${esc(base + m.id)} · Tap ES at the top for Spanish / Toque ES arriba para español</p>
    </div>`).join(''));
}

function printEntry(e) {
  if (!e) return;
  const mins = minutes(e.start, e.end);
  openPrint(`
    <div class="ps-head"><div><h1>Bi-Weekly Machine Clean-Up</h1><div class="ps-sub">GoldenWest Packaging · Ontario</div></div><div class="ps-date">Submitted ${esc(fmtWhen(e.savedAt))}</div></div>
    <table class="ps-kv ps-top"><tr><th>Machine</th><td>${esc(e.machineName || e.machine)}</td></tr><tr><th>Date / shift</th><td>${esc(fmtDay(e.date))} · ${esc(e.shift)} shift</td></tr>
      <tr><th>Start / end</th><td>${esc(e.start || '–')} – ${esc(e.end || '–')}${mins ? ` (${mins} min)` : ''}</td></tr><tr><th>Crew</th><td>${esc((e.crew || []).join(', '))}</td></tr></table>
    <table class="ps-kv ps-top"><caption>Tasks</caption>${(e.tasks || []).map((t, i) => `<tr><th style="width:8%">${i + 1}</th><td>${esc(t.task)}</td><td style="width:12%;text-align:center"><b>${t.status === 'done' ? '✓' : 'N/A'}</b></td></tr>`).join('')}</table>
    <table class="ps-kv ps-top"><caption>Issues</caption><tr><th>Issues found</th><td>${e.issuesFound === 'Y' ? 'Yes' : 'No'}</td></tr>
      ${e.issuesFound === 'Y' ? `<tr><th>Tagged out of service</th><td>${e.taggedOut === 'Y' ? 'Yes' : 'No'}</td></tr><tr><th>Maintenance notified</th><td>${e.maintNotified === 'Y' ? 'Yes' : 'No'}</td></tr><tr><th>RepairTracker #</th><td>${esc(e.repairNo || '')}</td></tr><tr><th>Describe</th><td>${esc(e.issues || '')}</td></tr>` : ''}</table>
    <table class="ps-kv ps-top"><caption>Supervisor verification</caption><tr><th>Supervisor</th><td>${esc(e.supervisor || 'Not verified yet')}</td></tr><tr><th>Verified</th><td>${esc(e.verifiedAt ? fmtWhen(e.verifiedAt) : '')}</td></tr>${e.supNote ? `<tr><th>Note</th><td>${esc(e.supNote)}</td></tr>` : ''}</table>`);
}
