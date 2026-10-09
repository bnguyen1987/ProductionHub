import { $, $$, esc, api, MACHINES_7, SUPERVISORS, saveForm, loadForm } from './common.js';

const STATUSES = ['Running', 'Issue', 'Down', 'Idle'];
let draft, entries = [];

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function guessShift() {
  const d = new Date(), m = d.getHours() * 60 + d.getMinutes();
  return m >= 14 * 60 + 30 || m < 4 * 60 ? '2nd' : '1st';
}
function newDraft() {
  return {
    date: today(), shift: guessShift(), supervisor: '', supervisorOther: '',
    machines: MACHINES_7.map((machine) => ({ machine, status: 'Running', note: '' })),
    jobs: [], quality: '', safety: '', maintenance: [], general: '',
  };
}

export function render(view) {
  draft = loadForm('handoff_draft') || newDraft();
  // keep machine list current even if an old draft is loaded
  draft.machines = MACHINES_7.map((machine) => draft.machines?.find((m) => m.machine === machine) || { machine, status: 'Running', note: '' });

  view.innerHTML = `
    <div class="page-head"><h1>Shift Handoff Log</h1><p>Fill this out at the end of the shift so the next supervisor knows what's running, what's open, and what needs attention. Everyone with the access code sees the same log.</p></div>
    <div class="btn-row no-print" style="margin-bottom:14px">
      <button class="btn primary" id="hNewBtn" type="button">New handoff</button>
      <button class="btn" id="hListBtn" type="button">Recent handoffs</button>
    </div>
    <div id="hForm"></div>
    <div id="hList" class="hidden"></div>`;
  $('#hNewBtn').addEventListener('click', () => showTab('form'));
  $('#hListBtn').addEventListener('click', () => showTab('list'));
  paintForm();
  showTab(sessionStorageGet('handoff_tab') || 'form');
}

function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch {} }

function showTab(t) {
  sessionStorageSet('handoff_tab', t);
  $('#hForm').classList.toggle('hidden', t !== 'form');
  $('#hList').classList.toggle('hidden', t !== 'list');
  $('#hNewBtn').classList.toggle('primary', t === 'form');
  $('#hListBtn').classList.toggle('primary', t === 'list');
  if (t === 'list') loadList();
}

const persist = () => saveForm('handoff_draft', draft);

function paintForm() {
  const supOpts = [...SUPERVISORS, 'Other'];
  $('#hForm').innerHTML = `
    <div class="layout two">
      <div class="stack">
        <section class="card">
          <h2><span class="n">1</span>Shift</h2>
          <div class="row">
            <div class="field"><label for="hDate">Date</label><input id="hDate" type="date" value="${esc(draft.date)}"></div>
            <div class="field"><label>Shift</label><div class="seg" id="hShift">${['1st', '2nd'].map((s) => `<button type="button" data-v="${s}" aria-pressed="${draft.shift === s}">${s}</button>`).join('')}</div></div>
          </div>
          <div class="row">
            <div class="field"><label for="hSup">Supervisor</label><select id="hSup"><option value="">Select…</option>${supOpts.map((s) => `<option ${draft.supervisor === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
            <div class="field ${draft.supervisor === 'Other' ? '' : 'hidden'}" id="hSupOtherWrap"><label for="hSupOther">Name</label><input id="hSupOther" type="text" value="${esc(draft.supervisorOther)}"></div>
          </div>
        </section>
        <section class="card">
          <h2><span class="n">2</span>Machine status</h2>
          <div id="hMachines">${draft.machines.map((m, i) => `
            <div class="mstat" data-i="${i}">
              <div class="mname">${esc(m.machine)}</div>
              <div>
                <div class="seg">${STATUSES.map((s) => `<button type="button" data-v="${s}" aria-pressed="${m.status === s}">${s}</button>`).join('')}</div>
                <input type="text" placeholder="${m.status === 'Running' ? 'Note (optional)' : 'What is wrong / when back?'}" value="${esc(m.note)}" class="${m.status === 'Running' && !m.note ? 'opt' : ''}">
              </div>
            </div>`).join('')}</div>
        </section>
      </div>
      <div class="stack">
        <section class="card">
          <h2><span class="n">3</span>Jobs in progress</h2>
          <div id="hJobs"></div>
          <button class="btn small" type="button" id="hAddJob" style="margin-top:8px">+ Add job</button>
        </section>
        <section class="card">
          <h2><span class="n">4</span>Quality &amp; safety</h2>
          <div class="field" style="margin-bottom:10px"><label for="hQual">Quality (QF120 issues, waste, holds)</label><textarea id="hQual" placeholder="e.g. Job 48213 on McKinley: scoring cracking on C flute, 3 bundles on hold">${esc(draft.quality)}</textarea></div>
          <div class="field"><label for="hSafe">Safety (near misses, injuries, hazards)</label><textarea id="hSafe" placeholder="None, or what happened and what was done">${esc(draft.safety)}</textarea></div>
        </section>
        <section class="card">
          <h2><span class="n">5</span>Maintenance requests for Jess</h2>
          <div id="hMaint"></div>
          <button class="btn small" type="button" id="hAddMaint" style="margin-top:8px">+ Add request</button>
        </section>
        <section class="card">
          <h2><span class="n">6</span>Anything else</h2>
          <textarea id="hGen" placeholder="Staffing, material shortages, priorities for next shift…">${esc(draft.general)}</textarea>
        </section>
        <div id="hMsg"></div>
        <div class="btn-row">
          <button class="btn primary" id="hSave" type="button">Save handoff</button>
          <button class="btn ghost danger" id="hClear" type="button">Clear form</button>
        </div>
      </div>
    </div>`;

  $('#hDate').addEventListener('input', (e) => { draft.date = e.target.value; persist(); });
  $$('#hShift button').forEach((b) => b.addEventListener('click', () => { draft.shift = b.dataset.v; $$('#hShift button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); persist(); }));
  $('#hSup').addEventListener('change', (e) => { draft.supervisor = e.target.value; $('#hSupOtherWrap').classList.toggle('hidden', draft.supervisor !== 'Other'); persist(); });
  $('#hSupOther').addEventListener('input', (e) => { draft.supervisorOther = e.target.value; persist(); });
  $$('#hMachines .mstat').forEach((row) => {
    const m = draft.machines[+row.dataset.i];
    $$('button', row).forEach((b) => b.addEventListener('click', () => {
      m.status = b.dataset.v;
      $$('button', row).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('input', row).placeholder = m.status === 'Running' ? 'Note (optional)' : 'What is wrong / when back?';
      persist();
    }));
    $('input', row).addEventListener('input', (e) => { m.note = e.target.value; persist(); });
  });
  $('#hQual').addEventListener('input', (e) => { draft.quality = e.target.value; persist(); });
  $('#hSafe').addEventListener('input', (e) => { draft.safety = e.target.value; persist(); });
  $('#hGen').addEventListener('input', (e) => { draft.general = e.target.value; persist(); });
  $('#hAddJob').addEventListener('click', () => { draft.jobs.push({ machine: '', job: '', customer: '', done: '', left: '', note: '' }); paintJobs(); persist(); });
  $('#hAddMaint').addEventListener('click', () => { draft.maintenance.push({ machine: '', issue: '', priority: 'Normal' }); paintMaint(); persist(); });
  $('#hSave').addEventListener('click', save);
  $('#hClear').addEventListener('click', () => { if (confirm('Clear this handoff form?')) { draft = newDraft(); persist(); paintForm(); } });
  paintJobs(); paintMaint();
}

const machineSelect = (val, attr) => `<select ${attr}><option value="">Machine…</option>${MACHINES_7.map((m) => `<option ${val === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`;

function paintJobs() {
  const box = $('#hJobs');
  box.innerHTML = draft.jobs.length ? draft.jobs.map((j, i) => `
    <div class="rep" data-i="${i}">
      <button class="x" type="button" data-del aria-label="Remove job">×</button>
      <div class="row">
        <div class="field"><label>Machine</label>${machineSelect(j.machine, 'data-k="machine"')}</div>
        <div class="field"><label>Job #</label><input type="text" data-k="job" value="${esc(j.job)}"></div>
        <div class="field"><label>Customer</label><input type="text" data-k="customer" value="${esc(j.customer)}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Qty done</label><input type="text" inputmode="numeric" data-k="done" value="${esc(j.done)}"></div>
        <div class="field"><label>Qty left</label><input type="text" inputmode="numeric" data-k="left" value="${esc(j.left)}"></div>
        <div class="field" style="grid-column:span 2"><label>Notes for next shift</label><input type="text" data-k="note" value="${esc(j.note)}"></div>
      </div>
    </div>`).join('') : '<p class="hint" style="margin:0">No open jobs added.</p>';
  $$('.rep', box).forEach((row) => {
    const i = +row.dataset.i;
    $$('[data-k]', row).forEach((el) => el.addEventListener('input', () => { draft.jobs[i][el.dataset.k] = el.value; persist(); }));
    $('[data-del]', row).addEventListener('click', () => { draft.jobs.splice(i, 1); paintJobs(); persist(); });
  });
}

function paintMaint() {
  const box = $('#hMaint');
  box.innerHTML = draft.maintenance.length ? draft.maintenance.map((m, i) => `
    <div class="rep" data-i="${i}">
      <button class="x" type="button" data-del aria-label="Remove request">×</button>
      <div class="row">
        <div class="field"><label>Machine</label>${machineSelect(m.machine, 'data-k="machine"')}</div>
        <div class="field"><label>Priority</label><select data-k="priority">${['Urgent', 'Normal', 'When possible'].map((p) => `<option ${m.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>What needs fixing</label><input type="text" data-k="issue" value="${esc(m.issue)}"></div>
    </div>`).join('') : '<p class="hint" style="margin:0">No maintenance requests.</p>';
  $$('.rep', box).forEach((row) => {
    const i = +row.dataset.i;
    $$('[data-k]', row).forEach((el) => el.addEventListener('input', () => { draft.maintenance[i][el.dataset.k] = el.value; persist(); }));
    $('[data-del]', row).addEventListener('click', () => { draft.maintenance.splice(i, 1); paintMaint(); persist(); });
  });
}

async function save() {
  const msg = $('#hMsg');
  const supervisor = draft.supervisor === 'Other' ? draft.supervisorOther.trim() : draft.supervisor;
  const problems = [];
  if (!draft.date) problems.push('date');
  if (!supervisor) problems.push('supervisor');
  const noNote = draft.machines.filter((m) => (m.status === 'Down' || m.status === 'Issue') && !m.note.trim());
  if (problems.length) { msg.innerHTML = `<div class="alert err">Please fill in: ${problems.join(', ')}.</div>`; return; }
  if (noNote.length && !confirm(`${noNote.map((m) => m.machine).join(', ')} marked ${noNote.length > 1 ? 'Down/Issue' : noNote[0].status} with no note. Save anyway?`)) return;

  const btn = $('#hSave');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving…';
  const payload = {
    date: draft.date, shift: draft.shift, supervisor,
    machines: draft.machines,
    jobs: draft.jobs.filter((j) => j.job || j.customer || j.note || j.machine),
    quality: draft.quality.trim(), safety: draft.safety.trim(),
    maintenance: draft.maintenance.filter((m) => m.issue.trim()),
    general: draft.general.trim(),
  };
  try {
    await api('/api/handoff', { method: 'POST', body: JSON.stringify(payload) });
    // carry machine status forward (that's usually still true next shift); clear the rest
    const carry = draft.machines.map((m) => ({ ...m }));
    draft = newDraft(); draft.machines = carry; persist();
    paintForm();
    $('#hMsg').innerHTML = '<div class="alert ok">Saved. The next shift will see it under Recent handoffs and on the home page.</div>';
  } catch (e) {
    msg.innerHTML = `<div class="alert err">${esc(e.message)}. Your entry is still here. Try again.</div>`;
    btn.disabled = false; btn.textContent = 'Save handoff';
  }
}

// ---------- list ----------
async function loadList() {
  const box = $('#hList');
  box.innerHTML = '<div class="hint"><span class="spinner"></span> Loading handoffs…</div>';
  try {
    ({ entries } = await api('/api/handoff?limit=60'));
    paintList();
  } catch (e) {
    box.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
  }
}

function paintList(filter = '') {
  const box = $('#hList');
  const f = filter.trim().toLowerCase();
  const shown = f ? entries.filter((e) => JSON.stringify(e).toLowerCase().includes(f)) : entries;
  box.innerHTML = `
    <div class="btn-row no-print" style="margin-bottom:12px">
      <input type="text" id="hSearch" placeholder="Search: machine, job #, customer, name…" value="${esc(filter)}" style="flex:1;min-width:200px">
      <button class="btn" type="button" id="hPrint">Print</button>
    </div>
    ${shown.length ? shown.map((e, i) => entryHtml(e, i === 0 && !f)).join('') : '<p class="hint">No handoffs found.</p>'}`;
  const s = $('#hSearch');
  s.addEventListener('input', () => { const pos = s.selectionStart; paintList(s.value); const n = $('#hSearch'); n.focus(); n.setSelectionRange(pos, pos); });
  $('#hPrint').addEventListener('click', () => { $$('#hList details').forEach((d) => (d.open = true)); print(); });
  $$('#hList [data-delete]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this handoff for everyone? This cannot be undone.')) return;
    b.disabled = true;
    try { await api('/api/handoff?id=' + encodeURIComponent(b.dataset.delete), { method: 'DELETE' }); entries = entries.filter((x) => x.id !== b.dataset.delete); paintList($('#hSearch').value); }
    catch (err) { alert(err.message); b.disabled = false; }
  }));
}

function entryHtml(e, open) {
  const flagged = (e.machines || []).filter((m) => m.status !== 'Running');
  const notes = (e.machines || []).filter((m) => m.status === 'Running' && m.note);
  const date = new Date(e.date + 'T12:00:00');
  const dateTxt = isNaN(date) ? e.date : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const savedTxt = e.savedAt ? new Date(e.savedAt).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const pillCls = { Down: 'bad', Issue: 'warn', Idle: 'info' };
  return `<details class="entry" ${open ? 'open' : ''}>
    <summary><span class="when">${esc(dateTxt)} · ${esc(e.shift)} shift</span><span class="who">${esc(e.supervisor)}</span>
      <span class="chips">${flagged.map((m) => `<span class="pill ${pillCls[m.status] || 'info'}">${esc(m.machine)}: ${esc(m.status)}</span>`).join('') || '<span class="pill ok">All running</span>'}
      ${(e.maintenance || []).length ? `<span class="pill warn">${e.maintenance.length} for maintenance</span>` : ''}
      ${e.safety ? '<span class="pill bad">Safety note</span>' : ''}</span>
    </summary>
    <div class="body">
      ${flagged.length || notes.length ? `<h4>Machines</h4><div class="tbl-wrap"><table class="tbl"><tbody>${[...flagged, ...notes].map((m) => `<tr><td>${esc(m.machine)}</td><td><span class="pill ${pillCls[m.status] || 'ok'}">${esc(m.status)}</span></td><td>${esc(m.note)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${(e.jobs || []).length ? `<h4>Jobs in progress</h4><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Machine</th><th>Job</th><th>Customer</th><th>Done</th><th>Left</th><th>Notes</th></tr></thead><tbody>${e.jobs.map((j) => `<tr><td>${esc(j.machine)}</td><td>${esc(j.job)}</td><td>${esc(j.customer)}</td><td>${esc(j.done)}</td><td>${esc(j.left)}</td><td>${esc(j.note)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${e.quality ? `<h4>Quality</h4><p>${esc(e.quality)}</p>` : ''}
      ${e.safety ? `<h4>Safety</h4><p>${esc(e.safety)}</p>` : ''}
      ${(e.maintenance || []).length ? `<h4>Maintenance requests</h4><div class="tbl-wrap"><table class="tbl"><tbody>${e.maintenance.map((m) => `<tr><td>${esc(m.machine || '—')}</td><td><span class="pill ${m.priority === 'Urgent' ? 'bad' : m.priority === 'Normal' ? 'warn' : 'info'}">${esc(m.priority)}</span></td><td>${esc(m.issue)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${e.general ? `<h4>Other notes</h4><p>${esc(e.general)}</p>` : ''}
      <div class="btn-row no-print" style="margin-top:12px;justify-content:space-between"><span class="hint">Saved ${esc(savedTxt)}</span><button class="btn small ghost danger" type="button" data-delete="${esc(e.id)}">Delete</button></div>
    </div>
  </details>`;
}
