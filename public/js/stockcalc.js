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
