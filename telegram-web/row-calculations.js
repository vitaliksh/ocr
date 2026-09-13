function amount(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function round(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }

// The source amounts stay untouched on the row.  The journal amounts are the
// recognised part of the VAT-inclusive source total, split only afterwards.
export function recognisedAmounts(rawNet, rawVat, recognisedPercent = 100) {
  const sourceNet = amount(rawNet), sourceVat = amount(rawVat), sourceGross = sourceNet + sourceVat;
  const percent = Math.max(0, Math.min(100, amount(recognisedPercent))) / 100;
  const gross = round(sourceGross * percent);
  if (!sourceVat) return { gross: gross.toFixed(2), net: gross.toFixed(2), vat: "0.00" };
  if (!sourceNet) return { gross: gross.toFixed(2), net: "0.00", vat: gross.toFixed(2) };
  const net = round(gross / (1 + sourceVat / sourceNet)), vat = round(gross - net);
  return { gross: gross.toFixed(2), net: net.toFixed(2), vat: vat.toFixed(2) };
}

export function sourceAmountsFromGross(grossValue, vatPercent = 18) {
  const gross = round(amount(grossValue)), rate = Math.max(0, amount(vatPercent)) / 100;
  if (!rate) return { gross: gross.toFixed(2), net: gross.toFixed(2), vat: "0.00" };
  const net = round(gross / (1 + rate));
  return { gross: gross.toFixed(2), net: net.toFixed(2), vat: round(gross - net).toFixed(2) };
}

export function sourceAmountsFromNet(netValue, vatPercent = 18) {
  const net = round(amount(netValue)), rate = Math.max(0, amount(vatPercent)) / 100, vat = round(net * rate);
  return { gross: round(net + vat).toFixed(2), net: net.toFixed(2), vat: vat.toFixed(2) };
}
