// Stock sheet math. Orientation is fixed (width to width, length to length), same rule as the SQFT / LeastWaste sheets.

export function cutStock({ stockW, stockL, orderW, orderL, qty = 0 }) {
  const outsW = Math.floor((stockW + 1e-9) / orderW);
  const outsL = Math.floor((stockL + 1e-9) / orderL);
  const perSheet = outsW * outsL;
  const wasteW = stockW - outsW * orderW;
  const wasteL = stockL - outsL * orderL;
  const usedArea = perSheet * orderW * orderL;
  const wastePct = perSheet ? 1 - usedArea / (stockW * stockL) : 1;
  const sheets = perSheet && qty > 0 ? Math.ceil(qty / perSheet) : 0;
  return { outsW, outsL, perSheet, wasteW, wasteL, wasteIn: wasteW + wasteL, wastePct, sheets, fits: perSheet > 0 };
}

// Zero-waste mill sizes: exact multiples of the order, between 50×50 and 75×100 (inclusive).
export function millSizes({ orderW, orderL, minW = 50, maxW = 75, minL = 50, maxL = 100 }) {
  const ws = [], ls = [];
  for (let n = 1; n * orderW <= maxW + 1e-9; n++) if (n * orderW >= minW - 1e-9) ws.push(n);
  for (let n = 1; n * orderL <= maxL + 1e-9; n++) if (n * orderL >= minL - 1e-9) ls.push(n);
  const out = [];
  for (const a of ws) for (const b of ls) out.push({ w: a * orderW, l: b * orderL, outsW: a, outsL: b, perSheet: a * b });
  return out.sort((p, q) => q.perSheet - p.perSheet);
}

// ---------- Export.xlsx parsing ----------

// Export sizes use sixteenths after the dot: "29.14" = 29 14/16, "48.10" = 48 10/16, "75.02" = 75 2/16.
export function exportDim(s) {
  const m = String(s).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return NaN;
  const whole = +m[1];
  if (!m[2]) return whole;
  const n = +m[2];
  return n < 16 ? whole + n / 16 : parseFloat(s); // fall back to a plain decimal if it can't be sixteenths
}

export const normFlute = (f) => { f = String(f || '').toUpperCase().trim(); return f === 'DW' ? 'BC' : f; };
export const normColor = (c) => { c = String(c || '').toUpperCase().trim(); return c === 'KARFT' || c === 'KRAFT' ? 'KRAFT' : c === 'WHITE' ? 'MW' : c; };

// "ON SS 275 BC KARFT - 81.08 X 119.12" → { grade:'275', flute:'BC', color:'KRAFT', w:81.5, l:119.75 }
export function parseDescription(desc) {
  const m = String(desc || '').toUpperCase().match(/\bSS\s+(\S+)\s+(\S+)\s+([A-Z]+)\s*-?\s*(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const w = exportDim(m[4]), l = exportDim(m[5]);
  if (!(w > 0 && l > 0)) return null;
  return { grade: m[1], flute: normFlute(m[2]), color: normColor(m[3]), w, l };
}

// rows: array of arrays (first sheet). Finds the header row, then reads every item line.
export function parseExportRows(rows) {
  const norm = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  let h = -1, col = {};
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = (rows[r] || []).map(norm);
    const d = cells.findIndex((c) => c === 'item description' || c === 'description');
    if (d >= 0) {
      h = r;
      col = {
        desc: d,
        itemNo: cells.findIndex((c) => c === 'item no' || c === 'item no.' || c === 'item number' || c === 'item'),
        avail: cells.findIndex((c) => c.startsWith('available')),
        onHand: cells.findIndex((c) => c.startsWith('onhand') || c.startsWith('on hand')),
      };
      break;
    }
  }
  if (h < 0) throw new Error('Could not find an "Item Description" column. Upload the stock Export file.');
  const items = [], skipped = [];
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const desc = row[col.desc];
    if (desc === undefined || desc === null || String(desc).trim() === '') continue;
    const p = parseDescription(desc);
    if (!p) { skipped.push(String(desc)); continue; }
    const n = (i) => (i >= 0 && row[i] !== '' && row[i] !== null && isFinite(+row[i]) ? +row[i] : null);
    const onHand = n(col.onHand), availRaw = n(col.avail);
    items.push({ desc: String(desc).trim(), itemNo: col.itemNo >= 0 ? String(row[col.itemNo] ?? '') : '', ...p, avail: availRaw ?? onHand, onHand });
  }
  return { items, skipped };
}

// Rank stock items for an order.
// Exact = same grade, flute and color. Substitute = same flute and color, different grade
// (shown only when it saves at least `subSave` inches of waste over the best exact match, or when no exact match fits).
// Without grade/flute/color, every item is compared.
export function rankStock({ items, orderW, orderL, qty = 0, grade = '', flute = '', color = '', subSave = 5 }) {
  const g = String(grade).trim().toUpperCase(), f = normFlute(flute), c = normColor(color);
  const rows = [];
  for (const it of items) {
    if (!it.manual && f && it.flute !== f) continue;
    if (!it.manual && c && it.color !== c) continue;
    const cut = cutStock({ stockW: it.w, stockL: it.l, orderW, orderL, qty });
    if (!cut.fits) continue;
    const match = it.manual ? 'MANUAL' : !g ? 'ANY' : String(it.grade).toUpperCase() === g ? 'EXACT' : 'SUB';
    rows.push({ ...it, ...cut, match });
  }
  rows.sort((a, b) => a.wasteIn - b.wasteIn || a.wastePct - b.wastePct);
  const exact = rows.filter((r) => r.match !== 'SUB');
  const bestExact = exact.length ? exact[0].wasteIn : Infinity;
  const subs = rows.filter((r) => r.match === 'SUB' && (r.wasteIn <= bestExact - subSave || !exact.length));
  const list = [...exact, ...subs].sort((a, b) => a.wasteIn - b.wasteIn || (a.match === 'SUB') - (b.match === 'SUB'));

  // Combined fulfillment: walk the ranked list, best waste first, until the quantity is covered.
  let need = qty > 0 ? qty : 0;
  for (const r of list) {
    r.useSheets = 0;
    if (need > 0 && r.perSheet > 0) {
      const have = Math.max(0, r.avail ?? 0);
      const sheetsNeeded = Math.ceil(need / r.perSheet);
      r.useSheets = Math.min(have, sheetsNeeded);
      need = Math.max(0, need - r.useSheets * r.perSheet);
    }
    r.enough = qty > 0 && r.avail !== null && r.avail !== undefined ? r.avail >= r.sheets : null;
  }
  return { list, exactCount: exact.length, subCount: subs.length, hiddenSubs: rows.filter((r) => r.match === 'SUB').length - subs.length, shortAfterAll: need };
}
