// Settings: QR codes for the floor (change requests and each machine's clean-up checklist).
import { $, $$, esc } from './common.js';
import { qrSvg } from './printkit.js';
import { CLEANUP_MACHINES, machineLabel } from './cleanupdata.js';

const base = () => `${location.origin}${location.pathname}#`;

export function render(view) {
  view.innerHTML = `
    <div class="page-head"><h1>Settings</h1><p>QR codes for the floor. Print a poster and post it where people will scan it. Each code opens the page straight away (the access code is needed the first time on each phone).</p></div>
    <section class="card">
      <h2>Change requests</h2>
      <div class="qr-set">
        <div class="qr-tile" data-no-i18n>${qrSvg(base() + 'requests')}</div>
        <div>
          <p style="margin:0 0 8px">One poster for the whole floor: employees suggest a change to a job, or report a plate or die that needs repair.</p>
          <p class="hint" style="margin:0 0 10px">${esc(base() + 'requests')}</p>
          <button class="btn primary" type="button" id="qrReq">Print poster</button>
        </div>
      </div>
    </section>
    <section class="card" style="margin-top:16px">
      <h2>Machine clean-up</h2>
      <p style="margin:0 0 10px">One poster per machine. Scanning it opens that machine's bi-weekly clean-up checklist.</p>
      <button class="btn primary" type="button" id="qrAll" style="margin-bottom:14px">Print all machines (${CLEANUP_MACHINES.length} pages)</button>
      <div class="qr-grid">
        ${CLEANUP_MACHINES.map((m) => `<div class="qr-card">
          <div class="qr-tile small" data-no-i18n>${qrSvg(base() + 'cleanup/' + encodeURIComponent(m.id))}</div>
          <b>${esc(machineLabel(m))}</b>
          <button class="btn small" type="button" data-qr="${esc(m.id)}">Print</button>
        </div>`).join('')}
      </div>
    </section>`;
  $('#qrReq', view).addEventListener('click', async () => (await import('./requests.js')).printQr());
  const cl = () => import('./cleanup.js');
  $('#qrAll', view).addEventListener('click', async () => (await cl()).printQr(CLEANUP_MACHINES));
  $$('[data-qr]', view).forEach((b) => b.addEventListener('click', async () => (await cl()).printQr([CLEANUP_MACHINES.find((m) => m.id === b.dataset.qr)])));
}
