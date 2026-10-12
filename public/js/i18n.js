// Site-wide English / Spanish switch.
// The tools are written in English. When Spanish is on, this swaps the text on screen
// (labels, buttons, results, messages, placeholders) using the word list in i18n-es.js.
// Anything a person typed (inputs, notes, saved handoffs) is never touched, and switching
// back to English restores the original text without reloading the page or losing work.
import { getLang } from './common.js';
import { ES, PATTERNS, FRAGMENTS } from './i18n-es.js';

const ATTRS = ['placeholder', 'title', 'aria-label'];
const SKIP = 'script,style,textarea,[data-no-i18n]';
const done = new Map(); // node -> { text } or { attrs }
let obs = null;

const norm = (s) => s.replace(/\s+/g, ' ').trim();

export function tr(s) {
  if (s == null) return s;
  const raw = String(s);
  const key = norm(raw);
  if (!key || !/[A-Za-z]/.test(key)) return raw;
  let out = ES[key];
  if (out === undefined) {
    for (const [re, rep] of PATTERNS) {
      if (re.test(key)) { out = key.replace(re, rep); break; }
    }
  }
  if (out === undefined) {
    let x = key;
    for (const [re, rep] of FRAGMENTS) x = x.replace(re, rep);
    if (x !== key) out = x;
  }
  if (out === undefined) return raw;
  const lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0];
  return lead + out + trail;
}

function skip(el) { return !el || el.closest(SKIP); }

function doText(n) {
  const p = n.parentElement;
  if (!p || skip(p)) return;
  const prev = done.get(n);
  if (prev && n.nodeValue === prev.out) return; // already ours
  const t = tr(n.nodeValue);
  if (t === n.nodeValue) return;
  // an <option> with no value uses its text as the value; keep the English value so saved data doesn't change
  if (p.tagName === 'OPTION' && !p.hasAttribute('value')) p.setAttribute('value', n.nodeValue.trim());
  done.set(n, { orig: n.nodeValue, out: t });
  n.nodeValue = t;
}
function doAttrs(el) {
  if (skip(el) && !(el.matches && el.matches('input,textarea,select'))) return;
  if (el.closest && el.closest('[data-no-i18n]')) return;
  for (const a of ATTRS) {
    const v = el.getAttribute && el.getAttribute(a);
    if (!v) continue;
    const rec = done.get(el) || {};
    if (rec[a] && rec[a].out === v) continue;
    const t = tr(v);
    if (t !== v) { rec[a] = { orig: v, out: t }; done.set(el, rec); el.setAttribute(a, t); }
  }
}
function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1) return;
  doAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = w.nextNode())) n.nodeType === 3 ? doText(n) : doAttrs(n);
}

function start() {
  if (obs) return;
  walk(document.body);
  obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttrs(m.target);
      else m.addedNodes.forEach(walk);
    }
  });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
function stop() {
  if (obs) { obs.disconnect(); obs = null; }
  for (const [n, rec] of done) {
    if (!n.isConnected) continue;
    if (n.nodeType === 3) { if (n.nodeValue === rec.out) n.nodeValue = rec.orig; }
    else for (const a of ATTRS) if (rec[a] && n.getAttribute(a) === rec[a].out) n.setAttribute(a, rec[a].orig);
  }
  done.clear();
}

// pop-up messages (confirm / alert) too
const _alert = window.alert.bind(window), _confirm = window.confirm.bind(window);
window.alert = (m) => _alert(getLang() === 'es' ? tr(m) : m);
window.confirm = (m) => _confirm(getLang() === 'es' ? tr(m) : m);

export function applyLang() {
  document.documentElement.lang = getLang();
  if (getLang() === 'es') start(); else stop();
}
// forget nodes that are gone (called on page change)
export function prune() { for (const n of done.keys()) if (!n.isConnected) done.delete(n); }
