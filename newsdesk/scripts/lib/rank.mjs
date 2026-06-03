// scripts/lib/rank.mjs
import { createHash } from 'node:crypto';

export function contentHash(a) {
  return createHash('sha1').update(`${a.title}|${a.snippet || ''}`).digest('hex').slice(0, 16);
}

function hoursSince(iso, now) {
  if (!iso) return 48;
  const h = (now - new Date(iso).getTime()) / 36e5;
  return Number.isFinite(h) ? Math.max(0, h) : 48;
}

// Smooth recency decay: ~full credit < 3h, gentle taper, floored so older-but-important
// stories aren't buried purely on age.
function recencyScore(hrs) {
  if (hrs <= 3) return 10;
  if (hrs >= 48) return 1;
  return Math.max(1, 10 * Math.exp(-hrs / 18));
}

export function scoreArticle(a, cfg, now = Date.now()) {
  const text = `${a.title} ${a.snippet || ''}`.toLowerCase();
  let score = (a.feedWeight ?? 4);
  score += recencyScore(hoursSince(a.published_at, now));

  for (const [kw, w] of Object.entries(cfg.boost)) if (text.includes(kw)) score += w;
  for (const [kw, w] of Object.entries(cfg.penalty)) if (text.includes(kw)) score += w;

  // Flags
  const flags = [];
  let tone = 'neutral';
  for (const rule of cfg.flags.rules) {
    if (new RegExp(rule.regex, 'i').test(text)) {
      flags.push({ id: rule.id, label: rule.label, tone: rule.tone });
      score += rule.score;
      if (rule.tone === 'negative') tone = 'negative';
    }
  }

  // Tone (only overrides neutral)
  if (tone === 'neutral') {
    const neg = cfg.sentiment.negative.some(w => text.includes(w));
    const pos = cfg.sentiment.positive.some(w => text.includes(w));
    if (neg && !pos) tone = 'negative';
    else if (pos && !neg) tone = 'positive';
  }

  a.score = Math.round(score * 10) / 10;
  a.flags = flags;
  a.tone = tone;
  a.content_hash = contentHash(a);
  return a;
}

export function rankAll(articles, cfg, now = Date.now()) {
  articles.forEach(a => scoreArticle(a, cfg, now));
  // Drop clear noise (heavily penalised below zero)
  return articles.filter(a => a.score > 0).sort((x, y) => y.score - x.score);
}
