// Change Requests: anyone on the floor can suggest a change to a job (pallet size, count, pattern,
// plate or die repair...). A posted QR code opens this page straight to the form. Managers review in the list.
// English / Spanish toggle: only the screen text changes; saved values (type, status, repair/replace) stay in English.
import { $, $$, esc, api, MACHINES_7, saveForm, loadForm, fileToPayload, getLang } from './common.js';
import { openPrint, qrSvg } from './printkit.js';

export const TYPES = [
  'Pallet size',
  'Pieces per pallet / bundle count',
  'Stacking pattern',
  'Max load height',
  'Box spec / dimensions',
  'Print / ink',
  'Print plate: repair / replace',
  'Cutting die: repair / replace',
  'Other',
];
export const isTool = (t) => /^(Print plate|Cutting die)/.test(t || '');
const isPlate = (t) => /^Print plate/.test(t || '');
const STATUSES = ['New', 'Approved', 'Rejected', 'Done'];
const ACTIONS = ['Repair', 'Replace', 'Not sure'];
const PILL = { New: 'info', Approved: 'ok', Rejected: 'bad', Done: 'star' };

// ---------- words ----------
const TXT = {
  en: {
    title: 'Change Requests',
    intro: 'See a better way to run a job, like a different pallet size or count? Plate or die needs repair before the next run? Send it here. Management reviews every request.',
    newBtn: 'New request', listBtn: 'Review requests', nNew: (n) => `${n} new`,
    job: 'Job', customer: 'Customer name *', spec: 'Spec # *', order: 'Order #', machine: 'Machine (optional)',
    theChange: 'The change', whatChange: 'What should change?',
    plateNo: 'Plate #', dieNo: 'Die #', toolNoPh: 'if marked on it', repairOr: 'Repair or replace?', nextRun: 'Next run date (if known)',
    current: 'How it is now', currentPh: 'e.g. 40 × 48 pallet, 375 per pallet',
    changeTo: 'Change it to *', changeToPh: 'e.g. 48 × 48 pallet, 450 per pallet',
    wrong: "What's wrong with it? *",
    wrongPlatePh: 'e.g. plate is worn on the logo, print is light / filling in, plate is lifting',
    wrongDiePh: 'e.g. rule is dull and not cutting through, rubber is worn, scores cracking',
    why: 'Why?', whyPh: 'e.g. boxes hang over the edge, load leans, fewer pallets per order',
    else: 'Anything else? (optional)', elsePh: 'e.g. had to slow the machine down, extra waste, which station / color',
    photo: 'Photo (optional)', tapPhoto: 'Tap to take or add a photo', tapChange: 'Tap to change the photo',
    loadingPhoto: 'Loading photo…', removePhoto: 'Remove photo', notPhoto: 'That is not a photo.',
    you: 'Your info', name: 'Your name *', shift: 'Shift', shifts: { '1st': '1st', '2nd': '2nd' },
    send: 'Send request', sending: 'Sending…',
    fillIn: (list) => `Please fill in ${list.join(', ')}.`,
    need: { name: 'your name', customer: 'customer name', spec: 'spec #', change: 'the change', wrong: "what's wrong with it" },
    sent: (first, cust, spec) => `Thanks, ${first}. Your request for ${cust} (spec ${spec}) was sent.`,
    sendFail: (m) => `${m}. Your entry is still here. Try again.`,
    types: Object.fromEntries(TYPES.map((t) => [t, t])),
    actions: { Repair: 'Repair', Replace: 'Replace', 'Not sure': 'Not sure' },
    statuses: { New: 'New', Approved: 'Approved', Rejected: 'Rejected', Done: 'Done' },
    // review list
    loadingList: 'Loading requests…', platesDies: 'Plates & dies', all: 'All',
    search: 'Search customer, spec #, order #, name…', qr: 'Print QR poster', qrTitle: 'Print a poster with the QR code for the floor',
    none: (what, q) => `No ${what}requests${q ? ' match that search' : ''}.`, noneOpenTool: 'open plate or die ',
    specWord: 'Spec', orderWord: 'Order', plate: 'Plate', die: 'Die', runs: 'runs', nextRunW: 'next run',
    machineH: 'Machine', currentH: 'How it is now', changeH: 'Change it to', wrongH: "What's wrong", whyH: 'Why', notesH: 'Notes',
    photoTag: 'Photo', photoFail: 'Could not load the photo.',
    reviewed: (when, by) => `Last reviewed ${when}${by ? ` by ${by}` : ''}`,
    status: 'Status', reviewedBy: 'Reviewed by', yourName: 'Your name',
    note: 'Note back to the floor', notePh: 'e.g. Approved. Spec updated to 48 × 48 starting next run.',
    save: 'Save review', print: 'Print', del: 'Delete', savedAs: (s) => `Saved as ${s}.`,
    confirmDel: (c, s) => `Delete the request for ${c} (spec ${s})? This can't be undone.`,
  },
  es: {
    title: 'Solicitudes de cambio',
    intro: '¿Ve una mejor manera de correr un trabajo, como otro tamaño de tarima o cantidad? ¿Una placa o suaje necesita reparación antes de la próxima corrida? Envíelo aquí. La gerencia revisa cada solicitud.',
    newBtn: 'Nueva solicitud', listBtn: 'Revisar solicitudes', nNew: (n) => `${n} nueva${n > 1 ? 's' : ''}`,
    job: 'Trabajo', customer: 'Nombre del cliente *', spec: '# de spec *', order: '# de orden', machine: 'Máquina (opcional)',
    theChange: 'El cambio', whatChange: '¿Qué se debe cambiar?',
    plateNo: '# de placa', dieNo: '# de suaje', toolNoPh: 'si está marcado', repairOr: '¿Reparar o reemplazar?', nextRun: 'Fecha de la próxima corrida (si la sabe)',
    current: 'Cómo está ahora', currentPh: 'ej. tarima 40 × 48, 375 por tarima',
    changeTo: 'Cambiarlo a *', changeToPh: 'ej. tarima 48 × 48, 450 por tarima',
    wrong: '¿Qué problema tiene? *',
    wrongPlatePh: 'ej. la placa está gastada en el logo, la impresión sale clara / se llena, la placa se levanta',
    wrongDiePh: 'ej. la cuchilla está desafilada y no corta, el hule está gastado, los dobleces se rajan',
    why: '¿Por qué?', whyPh: 'ej. las cajas se salen de la orilla, la carga se ladea, menos tarimas por orden',
    else: '¿Algo más? (opcional)', elsePh: 'ej. tuvimos que bajar la velocidad, más desperdicio, qué estación / color',
    photo: 'Foto (opcional)', tapPhoto: 'Toque para tomar o agregar una foto', tapChange: 'Toque para cambiar la foto',
    loadingPhoto: 'Cargando foto…', removePhoto: 'Quitar foto', notPhoto: 'Eso no es una foto.',
    you: 'Sus datos', name: 'Su nombre *', shift: 'Turno', shifts: { '1st': '1er', '2nd': '2do' },
    send: 'Enviar solicitud', sending: 'Enviando…',
    fillIn: (list) => `Por favor llene: ${list.join(', ')}.`,
    need: { name: 'su nombre', customer: 'nombre del cliente', spec: '# de spec', change: 'el cambio', wrong: 'qué problema tiene' },
    sent: (first, cust, spec) => `Gracias, ${first}. Su solicitud para ${cust} (spec ${spec}) fue enviada.`,
    sendFail: (m) => `${m}. Su información sigue aquí. Intente otra vez.`,
    types: {
      'Pallet size': 'Tamaño de tarima',
      'Pieces per pallet / bundle count': 'Piezas por tarima / por bulto',
      'Stacking pattern': 'Patrón de estiba',
      'Max load height': 'Altura máxima de la carga',
      'Box spec / dimensions': 'Especificación / medidas de la caja',
      'Print / ink': 'Impresión / tinta',
      'Print plate: repair / replace': 'Placa de impresión: reparar / reemplazar',
      'Cutting die: repair / replace': 'Suaje (troquel): reparar / reemplazar',
      Other: 'Otro',
    },
    actions: { Repair: 'Reparar', Replace: 'Reemplazar', 'Not sure': 'No estoy seguro' },
    statuses: { New: 'Nueva', Approved: 'Aprobada', Rejected: 'Rechazada', Done: 'Terminada' },
    loadingList: 'Cargando solicitudes…', platesDies: 'Placas y suajes', all: 'Todas',
    search: 'Buscar cliente, # de spec, # de orden, nombre…', qr: 'Imprimir póster QR', qrTitle: 'Imprimir un póster con el código QR para la planta',
    none: (what, q) => `No hay solicitudes ${what}${q ? 'que coincidan con la búsqueda' : ''}.`, noneOpenTool: 'abiertas de placas o suajes ',
    specWord: 'Spec', orderWord: 'Orden', plate: 'Placa', die: 'Suaje', runs: 'corre', nextRunW: 'próxima corrida',
    machineH: 'Máquina', currentH: 'Cómo está ahora', changeH: 'Cambiarlo a', wrongH: 'Problema', whyH: 'Por qué', notesH: 'Notas',
    photoTag: 'Foto', photoFail: 'No se pudo cargar la foto.',
    reviewed: (when, by) => `Revisada ${when}${by ? ` por ${by}` : ''}`,
    status: 'Estado', reviewedBy: 'Revisada por', yourName: 'Su nombre',
    note: 'Nota para la planta', notePh: 'ej. Aprobada. Spec cambiada a 48 × 48 desde la próxima corrida.',
    save: 'Guardar revisión', print: 'Imprimir', del: 'Borrar', savedAs: (s) => `Guardada como ${s}.`,
    confirmDel: (c, s) => `¿Borrar la solicitud de ${c} (spec ${s})? No se puede deshacer.`,
  },
};
let T = TXT[getLang()];
const locale = () => (getLang() === 'es' ? 'es-MX' : 'en-US');

let view, list = [], filter = 'New', photo = null, draft = null;

const blankForm = () => ({ name: '', shift: '', customer: '', spec: '', order: '', machine: '', type: TYPES[0], current: '', change: '', reason: '', toolNo: '', toolAction: 'Repair', nextRun: '' });
function guessShift() { const d = new Date(), m = d.getHours() * 60 + d.getMinutes(); return m >= 14 * 60 + 30 || m < 4 * 60 ? '2nd' : '1st'; }
function ssGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch {} }
const fmtDay = (ymd) => { const d = new Date(ymd + 'T12:00:00'); return isNaN(d) ? ymd : d.toLocaleDateString(locale(), { month: 'short', day: 'numeric' }); };
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const tType = (t) => T.types[t] || t;
const tStatus = (s) => T.statuses[s] || s;
const tAction = (a) => T.actions[a] || a;
const toolWord = (t) => (isPlate(t) ? T.plate : T.die);

export function render(el) {
  view = el;
  T = TXT[getLang()];
  // this page has its own English/Spanish wording, so the site-wide translator leaves it alone
  view.innerHTML = `<div data-no-i18n>
    <div class="page-head"><h1>${T.title}</h1><p>${T.intro}</p></div>
    <div class="btn-row no-print" style="margin-bottom:14px">
      <button class="btn primary" id="rqNewBtn" type="button">${T.newBtn}</button>
      <button class="btn" id="rqListBtn" type="button">${T.listBtn} <span id="rqNewCount"></span></button>
    </div>
    <div id="rqForm"></div>
    <div id="rqList" class="hidden"></div></div>`;
  $('#rqNewBtn', view).addEventListener('click', () => showTab('form'));
  $('#rqListBtn', view).addEventListener('click', () => showTab('list'));
  paintForm(true);
  showTab(ssGet('requests_tab') || 'form');
  if (list.length) paintCount();
  refreshCount();
}

// called by the top-bar language switch; the draft and any photo are kept
export function onLang() { render(view); }

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
  if (c) c.innerHTML = n ? `<span class="pill info" style="margin-left:4px">${T.nNew(n)}</span>` : '';
}

// ---------- form ----------
function paintForm(keepPhoto = false) {
  const f = draft = { ...blankForm(), shift: guessShift(), ...(loadForm('request_draft') || {}) };
  if (!keepPhoto) photo = null;
  $('#rqForm', view).innerHTML = `
    <div class="layout two">
      <div class="stack">
        <section class="card">
          <h2><span class="n">1</span>${T.job}</h2>
          <div class="row">
            <div class="field"><label for="rq_customer">${T.customer}</label><input type="text" id="rq_customer" data-f="customer" autocomplete="off" required></div>
            <div class="field"><label for="rq_spec">${T.spec}</label><input type="text" id="rq_spec" data-f="spec" autocomplete="off" required></div>
          </div>
          <div class="row">
            <div class="field"><label for="rq_order">${T.order}</label><input type="text" id="rq_order" data-f="order" autocomplete="off"></div>
            <div class="field"><label for="rq_machine">${T.machine}</label>
              <select id="rq_machine" data-f="machine"><option value="">—</option>${MACHINES_7.map((m) => `<option>${esc(m)}</option>`).join('')}</select></div>
          </div>
        </section>
        <section class="card">
          <h2><span class="n">2</span>${T.theChange}</h2>
          <div class="field"><label for="rq_type">${T.whatChange}</label>
            <select id="rq_type" data-f="type">${TYPES.map((t) => `<option value="${esc(t)}">${esc(tType(t))}</option>`).join('')}</select></div>
          <div id="rqTool" class="hidden">
            <div class="row">
              <div class="field"><label for="rq_toolNo" id="rqToolNoLbl">${T.dieNo}</label><input type="text" id="rq_toolNo" data-f="toolNo" autocomplete="off" placeholder="${T.toolNoPh}"></div>
              <div class="field"><label for="rq_toolAction">${T.repairOr}</label><select id="rq_toolAction" data-f="toolAction">${ACTIONS.map((a) => `<option value="${a}">${tAction(a)}</option>`).join('')}</select></div>
            </div>
            <div class="field"><label for="rq_nextRun">${T.nextRun}</label><input type="date" id="rq_nextRun" data-f="nextRun" lang="${getLang()}"></div>
          </div>
          <div class="field" id="rqCurField"><label for="rq_current">${T.current}</label><input type="text" id="rq_current" data-f="current" placeholder="${T.currentPh}"></div>
          <div class="field"><label for="rq_change" id="rqChangeLbl">${T.changeTo}</label><textarea id="rq_change" data-f="change" rows="2" required></textarea></div>
          <div class="field"><label for="rq_reason" id="rqReasonLbl">${T.why}</label><textarea id="rq_reason" data-f="reason" rows="3"></textarea></div>
          <div class="field"><label>${T.photo}</label>
            <label class="drop" id="rqDrop" style="display:block"><input type="file" accept="image/*" capture="environment" hidden>
              <span id="rqDropTxt">${T.tapPhoto}</span></label>
            <div id="rqPrev"></div></div>
        </section>
      </div>
      <div class="stack">
        <section class="card">
          <h2><span class="n">3</span>${T.you}</h2>
          <div class="row">
            <div class="field"><label for="rq_name">${T.name}</label><input type="text" id="rq_name" data-f="name" autocomplete="name" required></div>
            <div class="field"><label for="rq_shift">${T.shift}</label><select id="rq_shift" data-f="shift"><option value="1st">${T.shifts['1st']}</option><option value="2nd">${T.shifts['2nd']}</option></select></div>
          </div>
          <button class="btn primary" id="rqSubmit" type="button" style="width:100%;margin-top:6px">${T.send}</button>
          <div id="rqMsg" aria-live="polite" style="margin-top:10px"></div>
        </section>
      </div>
    </div>`;
  $$('[data-f]', view).forEach((el) => {
    el.value = f[el.dataset.f] ?? '';
    const upd = () => { f[el.dataset.f] = el.value; saveForm('request_draft', f); const m = $('#rqMsg', view); if (m && m.innerHTML) m.innerHTML = ''; };
    el.addEventListener('input', upd);
    el.addEventListener('change', upd);
  });
  const applyType = () => {
    const tool = isTool(f.type);
    $('#rqTool', view).classList.toggle('hidden', !tool);
    $('#rqCurField', view).classList.toggle('hidden', tool);
    $('#rqToolNoLbl', view).textContent = isPlate(f.type) ? T.plateNo : T.dieNo;
    $('#rqChangeLbl', view).textContent = tool ? T.wrong : T.changeTo;
    $('#rq_change', view).placeholder = tool ? (isPlate(f.type) ? T.wrongPlatePh : T.wrongDiePh) : T.changeToPh;
    $('#rqReasonLbl', view).textContent = tool ? T.else : T.why;
    $('#rq_reason', view).placeholder = tool ? T.elsePh : T.whyPh;
  };
  $('#rq_type', view).addEventListener('change', applyType);
  applyType();
  const drop = $('#rqDrop', view), input = drop.querySelector('input');
  input.addEventListener('change', () => input.files[0] && takePhoto(input.files[0]));
  $('#rqSubmit', view).addEventListener('click', () => submit(f));
  if (photo) showPhoto();
}

function showPhoto() {
  const prev = $('#rqPrev', view);
  prev.innerHTML = `<div style="display:flex;gap:10px;align-items:center;margin-top:8px"><img src="data:image/jpeg;base64,${photo.data}" alt="" style="max-width:140px;max-height:110px;border-radius:8px;border:1px solid var(--line)"><button class="btn small ghost" type="button" id="rqNoPhoto">${T.removePhoto}</button></div>`;
  $('#rqDropTxt', view).textContent = T.tapChange;
  $('#rqNoPhoto', view).addEventListener('click', () => { photo = null; prev.innerHTML = ''; $('#rqDropTxt', view).textContent = T.tapPhoto; });
}

async function takePhoto(file) {
  const prev = $('#rqPrev', view);
  prev.innerHTML = `<div class="hint"><span class="spinner"></span> ${T.loadingPhoto}</div>`;
  try {
    if (!file.type.startsWith('image/')) throw new Error(T.notPhoto);
    photo = await fileToPayload(file);
    showPhoto();
  } catch (e) { photo = null; prev.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
}

async function submit(f) {
  const msg = $('#rqMsg', view), btn = $('#rqSubmit', view);
  const missing = ['name', 'customer', 'spec', 'change'].filter((k) => !String(f[k] || '').trim())
    .map((k) => (k === 'change' && isTool(f.type) ? T.need.wrong : T.need[k]));
  if (missing.length) { msg.innerHTML = `<div class="alert err">${esc(T.fillIn(missing))}</div>`; return; }
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${T.sending}`;
  try {
    const body = isTool(f.type) ? { ...f, current: '' } : { ...f, toolNo: '', toolAction: '', nextRun: '' };
    await api('/api/requests', { method: 'POST', body: JSON.stringify({ ...body, lang: getLang(), photo }) });
    // keep the person's name and shift for next time, clear the rest
    saveForm('request_draft', { ...blankForm(), name: f.name, shift: f.shift });
    paintForm();
    $('#rqMsg', view).innerHTML = `<div class="alert ok">${esc(T.sent(f.name.trim().split(' ')[0], f.customer, f.spec))}</div>`;
    refreshCount();
  } catch (e) {
    btn.disabled = false; btn.textContent = T.send;
    msg.innerHTML = `<div class="alert err">${esc(T.sendFail(e.message))}</div>`;
  }
}

// ---------- review list ----------
async function loadList() {
  const box = $('#rqList', view);
  box.innerHTML = `<div class="hint"><span class="spinner"></span> ${T.loadingList}</div>`;
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
  const openTool = (r) => isTool(r.type) && (r.status === 'New' || r.status === 'Approved');
  const inFilter = (r) => filter === 'All' || (filter === 'Tooling' ? openTool(r) : r.status === filter);
  const counts = Object.fromEntries(['All', 'Tooling', ...STATUSES].map((s) => [s, s === 'All' ? list.length : s === 'Tooling' ? list.filter(openTool).length : list.filter((r) => r.status === s).length]));
  const label = (s) => (s === 'Tooling' ? T.platesDies : s === 'All' ? T.all : tStatus(s));
  const needle = q.trim().toLowerCase();
  const shown = list.filter((r) => inFilter(r) &&
    (!needle || [r.customer, r.spec, r.order, r.name, r.type, tType(r.type), r.change, r.current, r.reason, r.machine, r.toolNo].join(' ').toLowerCase().includes(needle)));
  const noneWhat = filter === 'All' ? '' : filter === 'Tooling' ? T.noneOpenTool : (getLang() === 'es' ? tStatus(filter).toLowerCase() + 's ' : filter.toLowerCase() + ' ');
  box.innerHTML = `
    <div class="btn-row no-print" style="margin-bottom:12px;align-items:center">
      <div class="seg" id="rqFilter">${['New', 'Approved', 'Done', 'Rejected', 'Tooling', 'All'].map((s) => `<button type="button" data-s="${s}" aria-pressed="${s === filter}">${label(s)} (${counts[s]})</button>`).join('')}</div>
      <input id="rqSearch" type="search" placeholder="${T.search}" value="${esc(q)}" style="flex:1;min-width:180px">
    </div>
    ${shown.length ? shown.map(itemHtml).join('') : `<p class="hint">${esc(T.none(noneWhat, needle))}</p>`}`;
  $$('#rqFilter button', box).forEach((b) => b.addEventListener('click', () => { filter = b.dataset.s; paintList($('#rqSearch', view).value); }));
  const search = $('#rqSearch', box);
  search.addEventListener('input', () => { const pos = search.selectionStart; paintList(search.value); const s2 = $('#rqSearch', view); s2.focus(); s2.setSelectionRange(pos, pos); });
  $$('details.entry', box).forEach((d) => d.addEventListener('toggle', () => { if (d.open) loadPhoto(d); }));
  $$('[data-save]', box).forEach((b) => b.addEventListener('click', () => saveReview(b.dataset.save)));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', () => del(b.dataset.del)));
  $$('[data-print]', box).forEach((b) => b.addEventListener('click', () => printOne(b.dataset.print)));
}

function itemHtml(r) {
  const k = esc(r.id), tool = isTool(r.type);
  const shift = r.shift ? ` (${esc(T.shifts[r.shift] || r.shift)})` : '';
  return `<details class="entry" data-id="${k}">
    <summary><span class="pill ${PILL[r.status] || 'info'}">${esc(tStatus(r.status))}</span>
      <span class="when">${esc(r.customer)} · ${T.specWord} ${esc(r.spec)}${r.order ? ` · ${T.orderWord} ${esc(r.order)}` : ''}</span>
      <span class="who">${esc(tType(r.type))} · ${esc(r.name)}${shift} · ${esc(fmtDate(r.savedAt))}</span>
      ${tool ? `<span class="pill warn">${toolWord(r.type)}: ${esc(tAction(r.toolAction || 'Repair').toLowerCase())}${r.nextRun ? ` · ${T.runs} ${esc(fmtDay(r.nextRun))}` : ''}</span>` : ''}
      ${r.hasPhoto ? `<span class="pill">${T.photoTag}</span>` : ''}</summary>
    <div class="body">
      ${r.machine ? `<h4>${T.machineH}</h4><p>${esc(r.machine)}</p>` : ''}
      ${r.current ? `<h4>${T.currentH}</h4><p>${esc(r.current)}</p>` : ''}
      ${tool ? `<h4>${toolWord(r.type)}</h4><p>${r.toolNo ? `#${esc(r.toolNo)} · ` : ''}<b>${esc(tAction(r.toolAction || 'Repair'))}</b>${r.nextRun ? ` · ${T.nextRunW} ${esc(fmtDay(r.nextRun))}` : ''}</p>` : ''}
      <h4>${tool ? T.wrongH : T.changeH}</h4><p><b>${esc(r.change)}</b></p>
      ${r.reason ? `<h4>${tool ? T.notesH : T.whyH}</h4><p>${esc(r.reason)}</p>` : ''}
      ${r.hasPhoto ? `<div class="rq-photo" style="margin-top:10px"><span class="hint"><span class="spinner"></span> ${T.loadingPhoto}</span></div>` : ''}
      ${r.reviewedAt ? `<p class="hint" style="margin-top:10px">${esc(T.reviewed(fmtDate(r.reviewedAt), r.reviewedBy))}</p>` : ''}
      <div class="no-print" style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
        <div class="row">
          <div class="field"><label>${T.status}</label><select data-rs="${k}">${STATUSES.map((s) => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${tStatus(s)}</option>`).join('')}</select></div>
          <div class="field"><label>${T.reviewedBy}</label><input type="text" data-rb="${k}" value="${esc(r.reviewedBy || '')}" placeholder="${T.yourName}"></div>
        </div>
        <div class="field"><label>${T.note}</label><textarea data-rn="${k}" rows="2" placeholder="${T.notePh}">${esc(r.reviewNote || '')}</textarea></div>
        <div class="btn-row" style="justify-content:space-between">
          <div class="btn-row"><button class="btn small primary" type="button" data-save="${k}">${T.save}</button><button class="btn small" type="button" data-print="${k}">${T.print}</button></div>
          <button class="btn small ghost danger" type="button" data-del="${k}">${T.del}</button>
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
    slot.innerHTML = `<img src="data:${p.mediaType};base64,${p.data}" alt="" style="max-width:100%;max-height:320px;border-radius:8px;border:1px solid var(--line)">`;
  } catch { slot.innerHTML = `<span class="hint">${T.photoFail}</span>`; }
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
    msg.innerHTML = `<div class="alert ok" style="margin-top:8px">${esc(T.savedAs(tStatus(upd.status)))}</div>`;
    setTimeout(() => paintList(), 900); // moves it to the right filter
  } catch (e) {
    msg.innerHTML = `<div class="alert err" style="margin-top:8px">${esc(e.message)}</div>`;
  } finally { btn.disabled = false; }
}

async function del(id) {
  const r = byId(id);
  if (!r || !confirm(T.confirmDel(r.customer, r.spec))) return;
  try {
    await api('/api/requests?id=' + encodeURIComponent(id), { method: 'DELETE' });
    list = list.filter((x) => x.id !== id);
    paintCount(); paintList();
  } catch (e) { alert(e.message); }
}

// ---------- printing (always English + Spanish poster; request printout in English for the office) ----------
export function printQr() {
  const url = `${location.origin}${location.pathname}#requests`;
  openPrint(`
    <div class="qr-poster">
      <div class="ps-head"><div><h1>Production Change Request</h1><div class="ps-sub">GoldenWest Packaging · Ontario</div></div></div>
      <p class="qr-lead">Better way to run a job? Plate or die needs repair?<br><b>Scan to send a request.</b></p>
      <div class="qr-code">${qrSvg(url)}</div>
      <p class="qr-lead" style="font-size:20px">¿Mejor manera de correr un trabajo? ¿Placa o suaje necesita reparación? <b>Escanee para enviar una solicitud.</b></p>
      <ol class="qr-steps">
        <li>Scan with your phone camera / Escanee con la cámara de su teléfono</li>
        <li>Tap ES at the top for Spanish / Toque ES arriba para español</li>
        <li>Enter the customer name and spec # / Escriba el cliente y el # de spec</li>
        <li>Tell us what to change and why / Diga qué cambiar y por qué</li>
      </ol>
      <p class="ps-sub" style="text-align:center;margin-top:18px">${esc(url)}<br>Needs the Production Hub access code the first time on each phone. / Necesita el código de acceso la primera vez en cada teléfono.</p>
    </div>`);
}

function printOne(id) {
  const r = byId(id);
  if (!r) return;
  const tool = isTool(r.type), word = isPlate(r.type) ? 'Plate' : 'Die';
  const row = (k, v) => (v ? `<tr><th>${k}</th><td>${esc(v)}</td></tr>` : '');
  const day = (ymd) => { const d = new Date(ymd + 'T12:00:00'); return isNaN(d) ? ymd : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  const build = (img) => `
    <div class="ps-head"><div><h1>Change Request</h1><div class="ps-sub">GoldenWest Packaging · Ontario</div></div><div class="ps-date">Submitted ${esc(when(r.savedAt))}</div></div>
    <table class="ps-kv ps-top"><caption>Job</caption>${row('Customer', r.customer)}${row('Spec #', r.spec)}${row('Order #', r.order)}${row('Machine', r.machine)}</table>
    <table class="ps-kv ps-top"><caption>Request</caption>${row('What to change', r.type)}${tool ? row(word + ' #', r.toolNo) + row('Repair or replace', r.toolAction) + row('Next run', r.nextRun ? day(r.nextRun) : '') : ''}${row('How it is now', r.current)}${row(tool ? "What's wrong" : 'Change it to', r.change)}${row(tool ? 'Notes' : 'Why', r.reason)}${row('Requested by', `${r.name}${r.shift ? ` (${r.shift} shift)` : ''}`)}${r.lang === 'es' ? row('Written in', 'Spanish') : ''}</table>
    <table class="ps-kv ps-top"><caption>Review</caption><tr><th>Status</th><td>${esc(r.status)}</td></tr><tr><th>Reviewed by</th><td>${esc(r.reviewedBy || '')}</td></tr><tr><th>Note</th><td style="height:44px">${esc(r.reviewNote || '')}</td></tr></table>
    ${img ? `<figure><img src="${img}" alt="Photo"><figcaption>Photo from the floor</figcaption></figure>` : ''}
    <div class="ps-sign"><span>Approved by: ______________________</span><span>Date: ____________</span></div>`;
  if (!r.hasPhoto) return openPrint(build(''));
  getPhoto(id).then((p) => openPrint(build(`data:${p.mediaType};base64,${p.data}`), true)).catch(() => openPrint(build('')));
}
