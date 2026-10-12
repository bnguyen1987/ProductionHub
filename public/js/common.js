// Shared helpers used by every tool page.

export const MACHINES_7 = [
  '142" Slitter',
  '86" Jumbo Press',
  '66" Shanghai RDC Slotter',
  'Large Marumatsu FBDC',
  'Small Marumatsu FBDC',
  '66" McKinley FFG',
  '42" Emba FFG',
];

export const SUPERVISORS = ['Tony Sanchez', 'Conrado Sotelo', 'Miguel Villalvazo'];

export const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  ink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M9 15a3 3 0 0 0 3 3"/></svg>',
  pallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v8l-8 4-8-4V6z"/><path d="M4 6l8 4 8-4M12 10v8"/><path d="M3 20h18M5 20v2M12 20v2M19 20v2"/></svg>',
  stock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16M15 4v16M3 12h18"/></svg>',
  handoff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v2h6V3M9 10h6M9 14h6M9 18h3"/></svg>',
  order: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/><path d="M9 14l2 2 4-4"/></svg>',
  requests: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M12 8v3M12 13.5v.01"/></svg>',
  logo: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 8l8-4 8 4v9l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v9"/></svg>',
};

// ---- access code ----
const CODE_KEY = 'gwprod_code';
export function getCode() { try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; } }
export function setCode(c) { try { localStorage.setItem(CODE_KEY, c); } catch {} }
export function clearCode() { try { localStorage.removeItem(CODE_KEY); } catch {} }

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-access-code': getCode(), ...(opts.headers || {}) },
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401) {
    clearCode();
    location.reload();
    throw new Error('Access code expired');
  }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

// ---- DOM ----
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- numbers & inches ----
// Accepts 33.5, "33 1/2", "33-1/2", "33-8" or "33`08" (sixteenths, spec-sheet style), "1/2".
export function parseInches(v) {
  if (v === null || v === undefined) return NaN;
  let s = String(v).trim().replace(/["”″]/g, '').replace(/\s+/g, ' ');
  if (!s) return NaN;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*[- ]\s*(\d+)\/(\d+)$/); // 33 1/2, 33-1/2
  if (m) return +m[1] + (+m[3] ? +m[2] / +m[3] : 0);
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return +m[2] ? +m[1] / +m[2] : NaN;
  m = s.match(/^(\d+)\s*[`'-]\s*(\d{1,2})$/); // 33`08 or 33-8 → sixteenths
  if (m && +m[2] < 16) return +m[1] + +m[2] / 16;
  m = s.match(/^\d*\.?\d+$/);
  if (m) return parseFloat(s);
  return NaN;
}

// Format inches to nearest 1/16 as a fraction: 33.5 → 33 1/2
export function fmtIn(x, unit = '"') {
  if (!isFinite(x)) return '–';
  const neg = x < 0; x = Math.abs(x);
  let whole = Math.floor(x);
  let six = Math.round((x - whole) * 16);
  if (six === 16) { whole += 1; six = 0; }
  let frac = '';
  if (six) { let n = six, d = 16; while (n % 2 === 0) { n /= 2; d /= 2; } frac = `${n}/${d}`; }
  const body = whole && frac ? `${whole} ${frac}` : frac || `${whole}`;
  return (neg ? '-' : '') + body + unit;
}

export const fmtNum = (x, d = 0) => isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';

// ---- files → base64 (images downscaled to stay under the function payload limit) ----
export async function fileToPayload(file) {
  if (file.type === 'application/pdf') {
    if (file.size > 3.2 * 1024 * 1024) throw new Error('PDF is too large (max about 3 MB). Try a photo or screenshot of the page instead.');
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('Could not read file')); r.readAsDataURL(file); });
    return { data, mediaType: 'application/pdf' };
  }
  if (!file.type.startsWith('image/')) throw new Error('Upload a photo (JPG/PNG) or a PDF.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not open that image. If it is an iPhone HEIC photo, take a screenshot of it and upload that.')); i.src = url; });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', 0.85).split(',')[1];
    return { data, mediaType: 'image/jpeg' };
  } finally { URL.revokeObjectURL(url); }
}

// Wire up a drop zone: returns a getter for the current file.
export function setupDrop(zone, onFile) {
  const input = zone.querySelector('input[type=file]');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drag'); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); input.value = ''; });
}

// Persist simple form values per tool so a refresh doesn't wipe work.
export function saveForm(key, obj) { try { localStorage.setItem('gwprod_' + key, JSON.stringify(obj)); } catch {} }
export function loadForm(key) { try { return JSON.parse(localStorage.getItem('gwprod_' + key) || 'null'); } catch { return null; } }

// ---- fraction <-> decimal helper under inch fields ----
// Typed a fraction (15 1/8, 15-1/8, 15`02) -> shows "= 15.125"". Typed a decimal (15.125) -> shows "= 15 1/8"".
export function inchConversion(raw, sixteenths = false) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const v = parseInches(s);
  if (!isFinite(v)) return '';
  const isFraction = /[\/`]/.test(s) || /^\d+\s*-\s*\d{1,2}$/.test(s) || /\d\s+\d/.test(s);
  if (isFraction) return `= ${(+v.toFixed(4)).toString()}"`;
  if (/\./.test(s)) {
    const exact = Math.abs(v * 16 - Math.round(v * 16)) < 1e-6;
    return `${exact ? '=' : '≈'} ${sixteenths ? fmtIn16(v) : fmtIn(v)}${exact ? '' : ' (nearest 1/16)'}`;
  }
  return '';
}

function updateInchHint(input) {
  let hint = input.nextElementSibling;
  if (!hint || !hint.classList.contains('inch-conv')) {
    hint = document.createElement('span');
    hint.className = 'hint inch-conv';
    input.insertAdjacentElement('afterend', hint);
  }
  const t = inchConversion(input.value, !!input.closest('[data-sixteenths]'));
  if (hint.textContent !== t) hint.textContent = t; // only touch the DOM on change (avoids observer loops)
  const disp = t ? '' : 'none';
  if (hint.style.display !== disp) hint.style.display = disp;
}

const INCH_SEL = 'input[type="text"][inputmode="decimal"]';
export function refreshInchHints(root = document) { root.querySelectorAll(INCH_SEL).forEach(updateInchHint); }
document.addEventListener('input', (e) => { if (e.target.matches && e.target.matches(INCH_SEL)) updateInchHint(e.target); });

// Same as fmtIn but always in sixteenths, not reduced (73.75 -> 73 12/16"), the stock-sheet convention.
export function fmtIn16(x, unit = '"') {
  if (!isFinite(x)) return '–';
  const neg = x < 0; x = Math.abs(x);
  let whole = Math.floor(x), six = Math.round((x - whole) * 16);
  if (six === 16) { whole += 1; six = 0; }
  const body = six ? (whole ? `${whole} ${six}/16` : `${six}/16`) : `${whole}`;
  return (neg ? '-' : '') + body + unit;
}
