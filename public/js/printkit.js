// Shared print helpers: a print-only sheet and QR codes.
import qrcode from '../vendor/qrcode.js';

// Prints `html` on its own page (the app is hidden while printing). Printouts stay in English unless the html is bilingual.
export function openPrint(html, wait) {
  let sheet = document.getElementById('printSheet');
  if (!sheet) { sheet = document.createElement('div'); sheet.id = 'printSheet'; document.body.appendChild(sheet); }
  sheet.innerHTML = `<div data-no-i18n>${html}</div>`;
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
