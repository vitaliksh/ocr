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
