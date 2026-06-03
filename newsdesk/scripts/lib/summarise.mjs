// scripts/lib/summarise.mjs
// Plain-English one-line summaries. Uses the Claude API if ANTHROPIC_API_KEY is set,
// otherwise falls back to a clean extractive summary so the pipeline never hard-fails.

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';

function extractive(a) {
  const base = (a.snippet || a.title || '').replace(/\s+/g, ' ').trim();
  if (!base) return a.title;
  // First sentence, capped.
  const firstSentence = base.split(/(?<=[.!?])\s/)[0];
  const s = (firstSentence.length > 40 ? firstSentence : base).slice(0, 220);
  return s.endsWith('.') ? s : s + '…';
}

async function callClaude(system, user, maxTokens = 1200) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

// Summarise a batch of articles in one call (cheap). Returns map id -> summary.
export async function summariseBatch(articles) {
  if (!process.env.ANTHROPIC_API_KEY || process.env.DRY_RUN) {
    const map = {};
    for (const a of articles) map[a.id] = extractive(a);
    return map;
  }
  const system = 'You are a financial news editor for a UK commercial real estate finance director. '
    + 'Summarise each item in ONE plain-English sentence (max 30 words), factual, no hype, no preamble. '
    + 'Return STRICT JSON: an object mapping id -> summary. No markdown, no commentary.';
  const payload = articles.map(a => ({ id: a.id, title: a.title, snippet: (a.snippet || '').slice(0, 300) }));
  try {
    const raw = await callClaude(system, JSON.stringify(payload), 2000);
    const clean = raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const obj = JSON.parse(clean);
    const map = {};
    for (const a of articles) map[a.id] = (obj[a.id] || extractive(a)).trim();
    return map;
  } catch (err) {
    console.warn('summariseBatch fell back to extractive:', err.message);
    const map = {};
    for (const a of articles) map[a.id] = extractive(a);
    return map;
  }
}

// The "What Matters To Me" analysis block (implications for UK CRE finance).
export async function analyseImplications({ topStories, creStories, markets }) {
  if (!process.env.ANTHROPIC_API_KEY || process.env.DRY_RUN) {
    return heuristicImplications({ topStories, creStories, markets });
  }
  const system = 'You are a senior analyst briefing a UK commercial real estate finance director/investor. '
    + 'Given today\'s top stories, real-estate items and market moves, write a tight implications brief. '
    + 'Return STRICT JSON with keys: "implications" (array of 3-5 short bullet strings covering UK office values, '
    + 'debt availability, interest rates, refinancing risk and London office demand) and "oneLiner" (a single sentence takeaway). '
    + 'No markdown, no preamble.';
  const ctx = {
    markets: markets.filter(m => m.ok).map(m => ({ label: m.label, pct: m.pct, price: m.price })),
    topStories: topStories.slice(0, 8).map(s => s.title),
    creStories: creStories.slice(0, 8).map(s => s.title)
  };
  try {
    const raw = await callClaude(system, JSON.stringify(ctx), 1000);
    const clean = raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.warn('analyseImplications fell back to heuristic:', err.message);
    return heuristicImplications({ topStories, creStories, markets });
  }
}

function heuristicImplications({ creStories, markets }) {
  const m = Object.fromEntries(markets.map(x => [x.key, x]));
  const bullets = [];
  const gilt = m.gilt10, ust = m.ust10, ftse = m.ftse100, gbpusd = m.gbpusd;
  if (gilt?.ok) bullets.push(`UK 10y gilt at ${gilt.price}${gilt.pct != null ? ` (${gilt.pct >= 0 ? '+' : ''}${gilt.pct}%)` : ''} — a key reference for property debt pricing and refinancing costs.`);
  if (ust?.ok) bullets.push(`US 10y treasury at ${ust.price} sets the global rate backdrop influencing cross-border capital into London offices.`);
  const refi = creStories.filter(s => (s.flags || []).some(f => f.id === 'refi' || f.id === 'distress'));
  if (refi.length) bullets.push(`${refi.length} refinancing/distress item(s) flagged today — watch for read-across to debt availability and office valuations.`);
  const deals = creStories.filter(s => (s.flags || []).some(f => f.id === 'big-deal'));
  if (deals.length) bullets.push(`${deals.length} sizeable transaction(s) flagged (£20m+) — pricing evidence for the investment market.`);
  if (ftse?.ok) bullets.push(`FTSE 100 ${ftse.pct >= 0 ? 'up' : 'down'} ${Math.abs(ftse.pct ?? 0)}% — broad risk sentiment proxy for listed property.`);
  if (gbpusd?.ok) bullets.push(`GBP/USD at ${gbpusd.price} affects overseas-buyer appetite for London assets.`);
  while (bullets.length < 3) bullets.push('Insufficient flagged real-estate items this edition; monitor the next update.');
  return { implications: bullets.slice(0, 5), oneLiner: 'Rates and refinancing remain the dominant swing factors for UK office values and debt availability.' };
}
