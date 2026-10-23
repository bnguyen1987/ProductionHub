// Machine Specs: one card per machine. Core numbers come from the machine spec sheets (same data the
// Order Check uses, in ordercalc.js). Extra lines and notes can be added on the site (saved in /api/specs),
// e.g. for the gluers and stitcher, which are not on the spec sheets.
import { $, $$, esc, api, fmtNum } from './common.js';
import { MACHINES, SLITTERS, SPEC_REV, SMALL_ORDER_SQFT } from './ordercalc.js';
import { qrSvg, openPrint } from './printkit.js';

const inch = (x) => `${Math.round(x * 100) / 100}"`;
const TYPE = { FFG: 'Flexo folder-gluer', PRESS: 'Flexo printer / slotter', FLATBED: 'Flatbed die cutter' };
const DIE = { none: 'No (print only)', rotary: 'Rotary die only', partial: 'Partial cuts only (hand holes, vents)', flat: 'Flat die cut' };

// Every machine on the tab, in floor order. `base` = rows from the spec sheets.
export const LIST = [
  ...MACHINES.map((m) => ({
    id: String(m.id), name: m.name, group: m.type === 'FLATBED' ? 'Die cutters' : 'Printing & converting', type: TYPE[m.type] || m.type, notes: m.notes,
    base: [
      ['Sheet width', `${inch(m.minW)} to ${inch(m.maxW)}`],
      ['Sheet length', `${inch(m.minL)} to ${inch(m.maxL)}`],
      ...(m.skipFeedMaxW ? [['Skip-feed width', `up to ${inch(m.skipFeedMaxW)}`]] : []),
      ['Print colors', m.type === 'FLATBED' ? 'No print' : `${m.maxColor} max`],
      ['Die cut', DIE[m.dieCut] || '–'],
      ...(m.maxRule ? [['Max inches of rule', `${fmtNum(m.maxRule)}"`]] : []),
      ...(m.maxUpOk ? [['Number up', `${m.maxUpOk}-up (more needs supervisor OK)`]] : []),
      ...(m.twoPanel ? [['Two-panel rule', 'L + W 11 13/16" to 47 1/4", single panel 4 15/16" min']] : []),
      ['Flutes', 'E, B, C, BC'],
      ['Crew', m.crewTxt],
      ['Standard speed', `${fmtNum(m.speed)}/hr`],
      ['Setup', `${m.setup} min`],
      ['Minimum order', `${fmtNum(m.minQty)} ${m.qtyUnit || 'pcs'}`],
    ],
  })),
  ...SLITTERS.map((s) => ({
    id: String(s.id), name: s.name, group: 'Slitters', type: 'Slitter',
    notes: `Orders under ${fmtNum(SMALL_ORDER_SQFT)} sq ft run on the slitter from stock sheets. Anything under 12" goes to the bandsaw.`,
    base: [['Sheet width', `${inch(s.minW)} to ${inch(s.maxW)}`], ['Sheet length', `${inch(s.minL)} to ${inch(s.maxL)}`]],
  })),
  // On the floor but not in the Order Check (earlier spec sheet data)
  { id: '149', name: 'Shanghai Juer Mini FFG', group: 'Printing & converting', type: 'Flexo folder-gluer', notConfirmed: true,
    notes: 'Hand feed and hand stack. Top print, cold glue, max glue tab 1.75", slot 0.275". Printable area 37.4" × 78.74". Max bundle 25 SW / 15 DW, 12" high. Speed is an estimate; anilox to be confirmed.',
    base: [['Sheet width', '11.81" to 39.37"'], ['Sheet length', '23.62" to 78.74"'], ['Print colors', '2 max'], ['Min panel', 'L 7.5", W 4.8"'], ['Crew', '3'], ['Standard speed', '2,000/hr (est.)'], ['Setup', '30 min'], ['Order Check', 'Not included']] },
  { id: '130', name: 'Isowa Rotary Die Cut', group: 'Die cutters', type: 'Rotary die cutter', notConfirmed: true,
    notes: 'Plain rotary die cut, hand feed and hand stack. 66" cylinder. Max rule 500" (more needs production OK). Sheet size limits are not confirmed yet.',
    base: [['Print colors', 'No print'], ['Die cut', 'Rotary die only'], ['Max inches of rule', '500"'], ['Crew', '2–4'], ['Standard speed', '770/hr'], ['Setup', '40 min'], ['Minimum order', '100 pcs'], ['Order Check', 'Not included']] },
  ...['150', '151', '152'].map((id) => ({ id, name: `${id} Gluer`, group: 'Finishing', type: 'Gluer', notes: '', base: [] })),
  { id: '155', name: '155 Stitcher', group: 'Finishing', type: 'Stitcher', notes: '', base: [] },
  { id: '112', name: '112 Band Saw', group: 'Other equipment', type: 'Band saw', notes: 'Cuts pieces under 12" that are too small for the slitter.', base: [] },
  { id: '113', name: '113 Eccentric', group: 'Other equipment', type: 'Eccentric', notes: '', base: [] },
  { id: 'Strapper', name: 'Strapper', group: 'Other equipment', type: 'Strapper', notes: '', base: [] },
  { id: 'Baler', name: 'Baler', group: 'Other equipment', type: 'Baler', notes: '', base: [] },
];
export const GROUPS = ['Printing & converting', 'Die cutters', 'Slitters', 'Finishing', 'Other equipment'];
export { SPEC_REV };

let saved = {}, editing = null, query = '', group = '', focusId = '', scrolled = false;
const NAME_KEY = 'gwprod_specs_name';
const myName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const base = () => `${location.origin}${location.pathname}#specs/`;

export function render(view, sub) {
  focusId = sub ? decodeURIComponent(sub) : '';
  editing = null; query = ''; group = ''; scrolled = false;
  view.innerHTML = `
    <div class="page-head"><h1>Machine Specs</h1><p>Sizes, colors, die cut limits, crew and speed for each machine. From the machine spec sheets (${esc(SPEC_REV)}).</p></div>
    <div class="card specs-bar">
      <input type="search" id="spQ" placeholder="Search a machine or spec (e.g. rule, Matsu, 151)" aria-label="Search">
      <div class="seg" id="spGroup" role="group" aria-label="Machine group">
        <button type="button" data-g="">All</button>${GROUPS.map((g) => `<button type="button" data-g="${esc(g)}">${esc(g)}</button>`).join('')}
      </div>
      <button class="btn" type="button" id="spPrintAll">Print all</button>
    </div>
    <div id="spMsg"></div>
    <div id="spList"></div>
    <p class="note" style="margin:14px 0 0">Spec sheet numbers are also used by the Order Check. To change one of them, update the spec sheet and the hub together. Lines added here (<b>Added on site</b>) are for reference only.</p>`;
  $('#spQ', view).addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); draw(); });
  $$('#spGroup button', view).forEach((b) => b.addEventListener('click', () => { group = b.dataset.g; draw(); }));
  $('#spPrintAll', view).addEventListener('click', () => printSpecs(shown()));
  draw();
  api('/api/specs').then((d) => { saved = d.machines || {}; draw(); })
    .catch((e) => { $('#spMsg').innerHTML = `<div class="alert warn">Could not load the added spec lines (${esc(e.message)}). Spec sheet numbers are still shown.</div>`; });
}

export const rowsOf = (m, saved) => [...m.base, ...((saved[m.id] && saved[m.id].extra) || []).map((r) => [r.label, r.value, true])];
function shown() {
  return LIST.filter((m) => (!group || m.group === group)
    && (!query || [m.id, m.name, m.type, m.notes, saved[m.id]?.notes || '', ...rowsOf(m, saved).flat()].join(' ').toLowerCase().includes(query)));
}

function draw() {
  const box = $('#spList');
  if (!box) return;
  $$('#spGroup button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.g === group)));
  const list = shown();
  if (!list.length) { box.innerHTML = '<p class="hint">No machine matches that search.</p>'; return; }
  box.innerHTML = GROUPS.filter((g) => list.some((m) => m.group === g)).map((g) => `
    <h2 class="spec-group">${esc(g)}</h2>
    <div class="spec-grid">${list.filter((m) => m.group === g).map(card).join('')}</div>`).join('');
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => { editing = b.dataset.edit; draw(); }));
  $$('[data-print]', box).forEach((b) => b.addEventListener('click', () => printSpecs([LIST.find((m) => m.id === b.dataset.print)])));
  if (editing) wireEditor();
  // the machine opened from a QR code (or just saved) stays highlighted; scroll to it once
  if (focusId) {
    const el = $(`.spec-card[data-id="${CSS.escape(focusId)}"]`, box);
    if (el) { el.classList.add('focus'); if (!scrolled) { el.scrollIntoView({ block: 'start' }); scrolled = true; } }
  }
}

function card(m) {
  const s = saved[m.id] || {};
  const rows = rowsOf(m, saved);
  if (editing === m.id) return editorCard(m, s);
  return `<div class="card spec-card" data-id="${esc(m.id)}">
    <div class="spec-head"><div><h3>${esc(m.name)}</h3><span class="hint">#${esc(m.id)} · ${esc(m.type)}</span> <a class="hint spec-floor" href="#floor/${encodeURIComponent(m.id)}">On the floor</a></div>
      <div class="btn-row"><button class="btn small" type="button" data-edit="${esc(m.id)}">Edit</button><button class="btn small" type="button" data-print="${esc(m.id)}">Print</button></div></div>
    ${rows.length ? `<dl class="kv spec-kv">${rows.map(([k, v, added]) => `<dt${added ? ' data-no-i18n' : ''}>${esc(k)}</dt><dd${added ? ' data-no-i18n' : ''}>${esc(v)}</dd>`).join('')}</dl>`
      : '<p class="hint" style="margin:6px 0">Not on the spec sheets yet. Tap Edit to add the specs for this machine.</p>'}
    ${m.notes ? `<p class="spec-notes">${esc(m.notes)}</p>` : ''}
    ${s.notes ? `<p class="spec-notes" data-no-i18n>${esc(s.notes)}</p>` : ''}
    ${(s.extra && s.extra.length) || s.notes ? `<p class="hint" style="margin:6px 0 0"><span class="pill info">Added on site</span> by <span data-no-i18n>${esc(s.updatedBy || '')}</span> · ${esc(new Date(s.updatedAt).toLocaleDateString('en-US'))}</p>` : ''}
  </div>`;
}

function editorCard(m, s) {
  const extra = s.extra && s.extra.length ? s.extra : [{ label: '', value: '' }];
  return `<div class="card spec-card editing" data-id="${esc(m.id)}">
    <div class="spec-head"><div><h3>${esc(m.name)}</h3><span class="hint">#${esc(m.id)} · Edit added lines</span></div></div>
    ${m.base.length ? `<p class="hint" style="margin:0 0 8px">The spec sheet lines (sizes, colors, rule, speed) stay as they are. Add other specs below, like glue type, max box size or bundle count.</p>` : ''}
    <div id="spRows">${extra.map(rowHtml).join('')}</div>
    <button class="btn small" type="button" id="spAddRow" style="margin:6px 0 12px">+ Add a line</button>
    <div class="field"><label for="spNotes">Notes</label><textarea id="spNotes" rows="3">${esc(s.notes || '')}</textarea></div>
    <div class="field"><label for="spName">Your name</label><input type="text" id="spName" autocomplete="name" value="${esc(myName())}"></div>
    <div class="btn-row"><button class="btn primary" type="button" id="spSave">Save</button><button class="btn" type="button" id="spCancel">Cancel</button></div>
    <div id="spEditMsg"></div>
  </div>`;
}
const rowHtml = (r) => `<div class="spec-row"><input type="text" data-r="label" placeholder="Spec (e.g. Max blank length)" value="${esc(r.label)}"><input type="text" data-r="value" placeholder="Value" value="${esc(r.value)}"><button class="btn small" type="button" data-del aria-label="Remove line">✕</button></div>`;

function wireEditor() {
  const rows = $('#spRows');
  const wireDel = () => $$('[data-del]', rows).forEach((b) => (b.onclick = () => { b.closest('.spec-row').remove(); }));
  wireDel();
  $('#spAddRow').onclick = () => { rows.insertAdjacentHTML('beforeend', rowHtml({ label: '', value: '' })); wireDel(); rows.lastElementChild.querySelector('input').focus(); };
  $('#spCancel').onclick = () => { editing = null; draw(); };
  $('#spSave').onclick = async () => {
    const msg = $('#spEditMsg'), btn = $('#spSave');
    const updatedBy = $('#spName').value.trim();
    if (!updatedBy) { msg.innerHTML = '<div class="alert err">Enter your name.</div>'; return; }
    try { localStorage.setItem(NAME_KEY, updatedBy); } catch {}
    const extra = $$('.spec-row', rows).map((r) => ({ label: r.querySelector('[data-r=label]').value.trim(), value: r.querySelector('[data-r=value]').value.trim() })).filter((r) => r.label || r.value);
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const id = editing;
      saved[id] = await api('/api/specs?id=' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ extra, notes: $('#spNotes').value, updatedBy }) });
      editing = null; focusId = id; scrolled = false; draw();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Save';
      msg.innerHTML = `<div class="alert err">Could not save: ${esc(e.message)}</div>`;
    }
  };
}

// One page per machine, to post on the machine. QR opens this machine's card.
function printSpecs(list) {
  list = list.filter(Boolean);
  if (!list.length) return;
  openPrint(list.map((m, i) => {
    const s = saved[m.id] || {};
    const rows = rowsOf(m, saved);
    return `<div style="${i ? 'page-break-before:always;break-before:page' : ''}">
      <div class="ps-head"><div><h1>${esc(m.name)}</h1><div class="ps-sub">Machine Specs · #${esc(m.id)} · ${esc(m.type)} · GoldenWest Packaging · Ontario</div></div><div class="ps-date">${esc(SPEC_REV)}</div></div>
      <div style="display:flex;gap:24px;align-items:flex-start">
        <table class="ps-kv" style="flex:1">${rows.length ? rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('') : '<tr><td>Not on the spec sheets yet.</td></tr>'}</table>
        <div style="width:140px;text-align:center"><div class="qr-code" style="width:140px">${qrSvg(base() + encodeURIComponent(m.id))}</div><div class="ps-sub">Scan for the latest specs</div></div>
      </div>
      ${m.notes ? `<p style="margin:14px 0 0">${esc(m.notes)}</p>` : ''}
      ${s.notes ? `<p style="margin:8px 0 0">${esc(s.notes)}</p>` : ''}
      <p class="ps-sub" style="margin-top:14px">Printed ${esc(new Date().toLocaleDateString('en-US'))}. Check the Production Hub for the latest version.</p>
    </div>`;
  }).join(''));
}
