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

const gradeNum = (g) => { const n = parseFloat(String(g).replace(/[^\d.]/g, '')); return isFinite(n) ? n : NaN; };

// Rank stock items for an order. qty here = blanks needed.
// Exact = same grade, flute and color.
// Substitute = same flute and color, HIGHER grade only (never downgrade). A substitute is offered when:
//   no exact grade sheet fits, the exact grade sheets can't cover the quantity, or it saves at least `subSave` inches of waste.
// Without a grade, every item matching flute/color is compared.
export function rankStock({ items, orderW, orderL, qty = 0, grade = '', flute = '', color = '', subSave = 5 }) {
  const g = String(grade).trim().toUpperCase(), f = normFlute(flute), c = normColor(color);
  const gN = gradeNum(g);
  const rows = [];
  let lowerSkipped = 0;
  for (const it of items) {
    if (!it.manual && f && it.flute !== f) continue;
    if (!it.manual && c && it.color !== c) continue;
    const cut = cutStock({ stockW: it.w, stockL: it.l, orderW, orderL, qty });
    if (!cut.fits) continue;
    let match = it.manual ? 'MANUAL' : !g ? 'ANY' : String(it.grade).toUpperCase() === g ? 'EXACT' : 'SUB';
    if (match === 'SUB') {
      const iN = gradeNum(it.grade);
      if (!(isFinite(iN) && isFinite(gN) && iN > gN)) { lowerSkipped++; continue; } // higher grade only
    }
    rows.push({ ...it, ...cut, match });
  }
  const byWaste = (a, b) => a.wasteIn - b.wasteIn || a.wastePct - b.wastePct;
  const exact = rows.filter((r) => r.match !== 'SUB').sort(byWaste);
  const allSubs = rows.filter((r) => r.match === 'SUB').sort((a, b) => gradeNum(a.grade) - gradeNum(b.grade) || byWaste(a, b));

  // How much of the order can the exact grade cover from available stock?
  let exactCover = 0;
  if (qty > 0) {
    let need = qty;
    for (const r of exact) { if (r.avail > 0 && need > 0) { const use = Math.min(r.avail, Math.ceil(need / r.perSheet)); exactCover += use * r.perSheet; need -= use * r.perSheet; } }
    exactCover = Math.min(exactCover, qty);
  }
  const exactShort = qty > 0 && exact.length > 0 && exactCover < qty && exact.every((r) => r.avail !== null && r.avail !== undefined);
  const bestExact = exact.length ? exact[0].wasteIn : Infinity;
  const subs = allSubs.filter((r) => !exact.length || exactShort || r.wasteIn <= bestExact - subSave);

  // Combined fulfillment: exact grade first (least waste first), then the lowest higher grade.
  const cascade = [...exact, ...subs];
  let need = qty > 0 ? qty : 0;
  for (const r of cascade) {
    r.useSheets = 0;
    if (need > 0 && r.perSheet > 0) {
      const have = Math.max(0, r.avail ?? 0);
      r.useSheets = Math.min(have, Math.ceil(need / r.perSheet));
      need = Math.max(0, need - r.useSheets * r.perSheet);
    }
    r.enough = qty > 0 && r.avail !== null && r.avail !== undefined ? r.avail >= r.sheets : null;
  }
  const list = [...cascade].sort(byWaste);

  // Grade recommendation (plain words for the floor)
  let rec = null;
  if (g && (f || c)) {
    const pick = subs.find((r) => qty <= 0 || (r.avail ?? 0) > 0) || subs[0];
    const label = (r) => `${r.grade} ${r.flute} ${r.color}`;
    if (!exact.length && pick) rec = { kind: 'none-exact', sub: pick, text: `No ${g} sheet fits this blank. Recommended upgrade: ${label(pick)}` };
    else if (!exact.length) rec = { kind: 'nothing', text: `No ${g} or higher grade sheet fits this blank. Order from the mill.` };
    else if (exactShort && subs.length) rec = { kind: 'short', sub: pick, covered: exactCover, text: `${g} on hand covers ${exactCover} of ${qty} blanks. Make up the rest with ${label(pick)}` };
    else if (exactShort) rec = { kind: 'short-none', covered: exactCover, text: `${g} on hand covers ${exactCover} of ${qty} blanks, and no higher grade sheet fits. Order the rest from the mill.` };
    else if (subs.length) { const s = [...subs].sort(byWaste)[0]; rec = { kind: 'saves', sub: s, text: `Optional upgrade: ${label(s)} cuts ${(bestExact - s.wasteIn).toFixed(2).replace(/\.?0+$/, '')}" less waste than the best ${g} sheet` }; }
  }
  return { list, exactCount: exact.length, subCount: subs.length, hiddenSubs: allSubs.length - subs.length, lowerSkipped, shortAfterAll: need, rec, exactShort };
}

// ---------- One mill sheet size for several blanks ----------
// Try every sheet size in the range (in `step` increments) and rank by the total inches of trim
// across all blanks (width trim + length trim for each blank), same method as the MULTI-ORDER MILL SIZE tab.
// A size only counts if every blank fits on it. No turning: width to width, length to length.
export function bestMillSizes({ orders, minW = 50, maxW = 75, minL = 50, maxL = 100, step = 1, top = 10 }) {
  const valid = orders.filter((o) => o.w > 0 && o.l > 0);
  if (!valid.length || !(step > 0) || maxW < minW || maxL < minL) return [];
  const best = [];
  const nW = Math.round((maxW - minW) / step), nL = Math.round((maxL - minL) / step);
  for (let i = 0; i <= nW; i++) {
    const W = minW + i * step;
    for (let j = 0; j <= nL; j++) {
      const L = minL + j * step;
      let total = 0, pctSum = 0, ok = true;
      const per = [];
      for (const o of valid) {
        const c = cutStock({ stockW: W, stockL: L, orderW: o.w, orderL: o.l, qty: o.qty || 0 });
        if (!c.fits) { ok = false; break; }
        total += c.wasteIn; pctSum += c.wastePct;
        per.push(c);
      }
      if (!ok) continue;
      const cand = { w: W, l: L, totalWaste: Math.round(total * 1e6) / 1e6, avgPct: pctSum / valid.length, per };
      // keep the best `top` (small list, simple insert)
      let k = best.length;
      while (k > 0 && better(cand, best[k - 1])) k--;
      if (k < top) { best.splice(k, 0, cand); if (best.length > top) best.pop(); }
    }
  }
  return best;
}
function better(a, b) {
  if (a.totalWaste !== b.totalWaste) return a.totalWaste < b.totalWaste;
  if (Math.abs(a.avgPct - b.avgPct) > 1e-9) return a.avgPct < b.avgPct;
  return a.w * a.l < b.w * b.l;
}
