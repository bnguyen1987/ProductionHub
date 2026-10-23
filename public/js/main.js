import { ICONS, $, esc, getCode, setCode, clearCode, api, refreshInchHints, getLang, setLang, langToggle } from './common.js';
import { applyLang, prune } from './i18n.js';

const PAGES = [
  { id: 'ink', title: 'Ink Calculator', short: 'Ink', desc: 'Snap a photo of the printed sample and get buckets to order.', load: () => import('./ink.js') },
  { id: 'pallet', title: 'Pallet Calculator', short: 'Pallet', desc: 'Pieces per pallet, best pallet size, and a 3D view of the load.', load: () => import('./pallet.js') },
  { id: 'stock', title: 'Stock Sheet Calculator', short: 'Stock Sheet', desc: 'Outs, trim waste and sheets needed for a stock size.', load: () => import('./stock.js') },
  { id: 'handoff', title: 'Shift Handoff Log', short: 'Handoff', desc: 'Machine status, open jobs, quality/safety and maintenance notes for the next shift.', load: () => import('./handoff.js') },
  { id: 'order', title: 'New Order Checker', short: 'Order Check', desc: 'Upload a quote and see which machines can run it.', load: () => import('./order.js') },
  { id: 'specs', title: 'Machine Specs', short: 'Specs', desc: 'Sheet sizes, colors, die cut limits, crew and speed for each machine.', load: () => import('./specs.js') },
  { id: 'cleanup', title: 'Machine Clean-Up', short: 'Clean-Up', desc: 'Bi-weekly clean-up sign-off for each machine. Scan the QR code on the machine.', load: () => import('./cleanup.js') },
  { id: 'requests', title: 'Change Requests', short: 'Requests', desc: 'Suggest a change to a job, like a better pallet size. Scan the QR code on the floor.', load: () => import('./requests.js') },
  { id: 'settings', title: 'Settings', short: 'Settings', desc: 'QR codes to print for change requests and machine clean-up.', load: () => import('./settings.js') },
];

const app = $('#app');
let current = null;

function themeToggle() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('gwprod_theme', root.dataset.theme); } catch {}
}
try { const t = localStorage.getItem('gwprod_theme'); if (t) document.documentElement.dataset.theme = t; } catch {}

const LOGIN_TXT = {
  en: { code: 'Access code', open: 'Open', wrong: 'That code is not right.', notSet: 'The access code is not set up on the server yet.' },
  es: { code: 'Código de acceso', open: 'Entrar', wrong: 'Ese código no es correcto.', notSet: 'El código de acceso todavía no está configurado en el servidor.' },
};
function renderLogin(msgKey = '') {
  const T = LOGIN_TXT[getLang()];
  app.innerHTML = `
    <div class="login">
      <div class="brand-mark">${ICONS.logo}</div>
      <h1>Production Hub</h1>
      <p>GoldenWest Packaging · Ontario</p>
      <form id="loginForm">
        <input type="password" id="code" placeholder="${T.code}" autocomplete="current-password" aria-label="${T.code}" required>
        <button class="btn primary" type="submit">${T.open}</button>
        <div id="loginMsg" class="${msgKey ? 'alert err' : ''}">${msgKey ? esc(T[msgKey]) : ''}</div>
      </form>
      <div style="display:flex;justify-content:center;margin-top:14px">${langToggle('loginLang')}</div>
    </div>`;
  document.querySelectorAll('#loginLang [data-lang]').forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang); applyLang(); renderLogin(msgKey); }));
  $('#code').focus();
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    setCode($('#code').value.trim());
    try {
      const r = await fetch('/api/handoff?limit=1', { headers: { 'x-access-code': getCode() } });
      if (r.status === 401) { clearCode(); renderLogin('wrong'); return; }
      if (r.status === 503) { clearCode(); renderLogin('notSet'); return; }
      renderShell();
    } catch {
      renderShell(); // offline: let calculators work anyway
    }
  });
}

function renderShell() {
  app.innerHTML = `
    <header class="topbar no-print">
      <div class="topbar-inner">
        <a class="brand" href="#home"><span class="brand-mark">${ICONS.logo}</span>
          <span class="brand-text">Production Hub<small>GoldenWest · Ontario</small></span></a>
        <span class="spacer"></span>
        <div class="seg lang-toggle top-lang" id="topLang" role="group" aria-label="Language / Idioma"><button type="button" data-lang="en">EN</button><button type="button" data-lang="es">ES</button></div>
        <button class="icon-btn" id="themeBtn" title="Light / dark" aria-label="Switch light or dark"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg></button>
        <button class="icon-btn" id="logoutBtn" title="Sign out">Sign out</button>
      </div>
      <nav class="tabs" aria-label="Tools">
        <a class="tab" href="#home" data-id="home">${ICONS.home}Home</a>
        ${PAGES.map((p) => `<a class="tab" href="#${p.id}" data-id="${p.id}">${ICONS[p.id]}${p.short}</a>`).join('')}
      </nav>
    </header>
    <main id="view"></main>`;
  $('#themeBtn').onclick = themeToggle;
  const paintLang = () => document.querySelectorAll('#topLang [data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));
  document.querySelectorAll('#topLang [data-lang]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.lang === getLang()) return;
    setLang(b.dataset.lang);
    paintLang();
    applyLang();
    if (current && current.onLang) current.onLang(); // pages with their own wording (Change Requests)
  }));
  paintLang();
  $('#logoutBtn').onclick = () => { clearCode(); location.hash = ''; renderLogin(); };
  route();
}

async function route() {
  const view = $('#view');
  if (!view) return;
  const [id, sub] = (location.hash || '#home').slice(1).split('/');
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-current', t.dataset.id === id ? 'page' : 'false'));
  if (current && current.destroy) { try { current.destroy(); } catch {} }
  current = null;
  window.scrollTo(0, 0);

  const page = PAGES.find((p) => p.id === id);
  if (!page) { renderHome(view); document.title = 'GWPG Production Hub'; return; }
  document.title = `GWPG Production Hub · ${page.title}`;
  view.innerHTML = '<div class="hint"><span class="spinner"></span> Loading…</div>';
  try {
    const mod = await page.load();
    if ((location.hash || '#home').slice(1).split('/')[0] !== id) return; // user navigated away while loading
    view.innerHTML = '';
    current = mod;
    mod.render(view, sub);
    prune();
    refreshInchHints(view);
    // rows added later (stock sizes, blanks) get hints too
    if (!view._inchObs) { view._inchObs = new MutationObserver(() => { clearTimeout(view._inchT); view._inchT = setTimeout(() => refreshInchHints(view), 50); }); view._inchObs.observe(view, { childList: true, subtree: true }); }
  } catch (e) {
    view.innerHTML = `<div class="alert err">Could not load this tool. Check your connection and refresh.</div>`;
    console.error(e);
  }
}

function renderHome(view) {
  view.innerHTML = `
    <div class="page-head"><h1>Production tools</h1><p>Everything for the floor in one place. Pick a tool to get started.</p></div>
    <div class="home-grid">
      ${PAGES.map((p) => `<a class="home-card" href="#${p.id}"><span class="ic">${ICONS[p.id]}</span><h3>${p.title}</h3><p>${p.desc}</p></a>`).join('')}
    </div>
    <div id="newRequests"></div><div id="cleanupDue"></div>
    <div class="latest card" id="latestHandoff"><h2>Latest shift handoff</h2><div class="hint"><span class="spinner"></span> Loading…</div></div>`;
  Promise.all([api('/api/cleanup'), api('/api/cleanup?schedule').catch(() => ({ plan: [] })), import('./cleanupdata.js')]).then(([{ entries }, { plan }, d]) => {
    const st = d.CLEANUP_MACHINES.map((m) => ({ m, s: d.machineStatus(m, entries, plan) }));
    const over = st.filter((x) => x.s.key === 'over').length;
    const pend = st.reduce((a, x) => a + x.s.pending.length, 0);
    const today = d.todayYmd(), tmw = d.addDays(today, 1);
    const soon = (plan || []).filter((p) => p.date === today || p.date === tmw);
    const what = (p) => `${p.date === today ? 'Today' : 'Tomorrow'}: ${p.shift} shift, ${p.machines === 'all' ? 'all machines' : p.machines.join(', ')}`;
    const box = $('#cleanupDue');
    if (box && (over || pend || soon.length)) box.innerHTML = `<div class="alert ${over ? 'warn' : 'info'}" style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><span>${soon.map((p) => `<b>Clean-up ${esc(what(p))}.</b> `).join('')}${over ? `<b>${over} machine clean-up${over > 1 ? 's' : ''} overdue.</b> ` : ''}${pend ? `${pend} clean-up${pend > 1 ? 's' : ''} waiting for supervisor sign-off.` : ''}</span><a class="btn small" href="#cleanup">Open clean-up</a></div>`;
  }).catch(() => {});
  api('/api/requests').then(({ requests }) => {
    const n = (requests || []).filter((r) => r.status === 'New').length;
    const box = $('#newRequests');
    if (box && n) box.innerHTML = `<div class="alert info" style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><span><b>${n} new change request${n > 1 ? 's' : ''}</b> waiting for review.</span><a class="btn small" href="#requests" onclick="try{sessionStorage.setItem('requests_tab','list')}catch(e){}">Review</a></div>`;
  }).catch(() => {});
  api('/api/handoff?limit=1').then(({ entries }) => {
    const box = $('#latestHandoff');
    if (!box) return;
    const e = entries && entries[0];
    if (!e) { box.innerHTML = '<h2>Latest shift handoff</h2><p class="hint">No handoffs logged yet.</p><a class="btn small" href="#handoff">Start one</a>'; return; }
    const down = (e.machines || []).filter((m) => m.status === 'Down' || m.status === 'Issue');
    box.innerHTML = `<h2>Latest shift handoff</h2>
      <p style="margin:0 0 8px"><b>${esc(e.date)} · ${esc(e.shift)} shift</b> <span class="hint">by ${esc(e.supervisor)}</span></p>
      <div class="chips" style="margin-bottom:10px">
        ${down.length ? down.map((m) => `<span class="pill ${m.status === 'Down' ? 'bad' : 'warn'}">${esc(m.machine)}: ${esc(m.status)}</span>`).join('') : '<span class="pill ok">All machines OK</span>'}
        ${(e.jobs || []).length ? `<span class="pill info">${e.jobs.length} job${e.jobs.length > 1 ? 's' : ''} in progress</span>` : ''}
        ${(e.maintenance || []).length ? `<span class="pill warn">${e.maintenance.length} maintenance request${e.maintenance.length > 1 ? 's' : ''}</span>` : ''}
      </div>
      <a class="btn small" href="#handoff">Open handoff log</a>`;
  }).catch(() => {
    const box = $('#latestHandoff');
    if (box) box.innerHTML = '<h2>Latest shift handoff</h2><p class="hint">Could not load right now.</p>';
  });
}

window.addEventListener('hashchange', route);
applyLang();
if (getCode()) renderShell(); else renderLogin();
