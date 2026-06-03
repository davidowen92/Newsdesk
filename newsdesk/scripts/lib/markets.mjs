// scripts/lib/markets.mjs
// Pulls last price + previous close from Yahoo Finance's public chart endpoint.
// No API key. Each symbol fails independently so one bad ticker won't break the row.

async function fetchSymbol(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsdeskBot/1.0)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  const meta = r?.meta;
  if (!meta) throw new Error('no meta');
  const price = meta.regularMarketPrice ?? null;
  let prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
  // Fallback: use the last two valid closes from the candle series.
  if ((price == null || prev == null) && r?.indicators?.quote?.[0]?.close) {
    const closes = r.indicators.quote[0].close.filter(v => v != null);
    if (closes.length >= 2) { prev = closes[closes.length - 2]; }
  }
  if (price == null) throw new Error('no price');
  const change = prev != null ? price - prev : null;
  const pct = prev ? (change / prev) * 100 : null;
  return {
    price,
    prevClose: prev,
    change,
    pct: pct != null ? Math.round(pct * 100) / 100 : null,
    currency: meta.currency || null,
    asof: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null
  };
}

export async function fetchMarkets(tickers) {
  const out = [];
  for (const t of tickers) {
    try {
      const d = await fetchSymbol(t.symbol);
      out.push({ ...t, ...d, ok: true });
    } catch (err) {
      out.push({ ...t, ok: false, error: String(err?.message || err), price: null, pct: null });
    }
    await new Promise(r => setTimeout(r, 120)); // be gentle
  }
  return out;
}
