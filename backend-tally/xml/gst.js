function getGSTLedgers(gstRate, isInterState) {
  if (isInterState) {
    return [{ name: `Output IGST ${gstRate}%`, pct: gstRate }];
  }
  const half = gstRate / 2;
  return [
    { name: `Output CGST ${half}%`, pct: half },
    { name: `Output SGST ${half}%`, pct: half },
  ];
}

function computeTax(amount, gstRate, isInterState) {
  return getGSTLedgers(gstRate, isInterState).map(({ name, pct }) => ({
    ledger: name,
    amount: parseFloat(((amount * pct) / 100).toFixed(2)),
  }));
}

module.exports = { getGSTLedgers, computeTax };
