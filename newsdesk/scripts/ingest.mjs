// scripts/ingest.mjs
// Run by GitHub Actions 3x/day (or `npm run ingest` locally). Produces a new edition.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, upsertArticle, recordEdition, listEditions } from './lib/db.mjs';
import { fetchAll } from './lib/rss.mjs';
import { rankAll } from './lib/rank.mjs';
import { clusterArticles } from './lib/dedupe.mjs';
import { summariseBatch } from './lib/summarise.mjs';
import { fetchMarkets } from './lib/markets.mjs';
import { buildEdition, editionMeta } from './lib/edition.mjs';

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, 'public', 'data');
const EDITIONS_DIR = join(DATA_DIR, 'editions');
const MAX_STORIES = Number(process.env.MAX_STORIES || 90);

function loadJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }

async function main() {
  const t0 = Date.now();
  mkdirSync(EDITIONS_DIR, { recursive: true });
  const db = openDb(join(ROOT, 'data', 'news.db'));

  const sources = loadJson(join(ROOT, 'config', 'sources.json'));
  const marketsCfg = loadJson(join(ROOT, 'config', 'markets.json'));
  const kw = loadJson(join(ROOT, 'config', 'keywords.json'));
  const meta = editionMeta(new Date());
  console.log(`\n=== Building edition ${meta.id} (${meta.label}) ===`);

  // 1) Fetch
  const { results, errors } = await fetchAll(sources.feeds);
  console.log(`Fetched ${results.length} items from ${sources.feeds.length} feeds (${errors.length} feed errors).`);

  // 2) Rank (also flags + tone + content hash); drop noise
  const ranked = rankAll(results, kw);

  // 3) Dedupe into stories, re-sort, cap
  let stories = clusterArticles(ranked).sort((a, b) => b.score - a.score).slice(0, MAX_STORIES);

  // 4) Status (NEW/UPDATED/ONGOING) relative to archive, BEFORE summaries
  const statuses = {};
  for (const s of stories) {
    const row = {
      id: s.id, cluster_id: s.cluster_id, title: s.title, url: s.url, source: s.source,
      section: s.section, subsection: s.subsection, geo: s.geo, published_at: s.published_at,
      summary: null, score: s.score, flags: JSON.stringify(s.flags || []), tone: s.tone,
      first_seen: meta.created_at, last_seen: meta.created_at, content_hash: s.content_hash
    };
    statuses[s.id] = upsertArticle(db, row);
  }

  // 5) Summarise (batched; Claude API or extractive fallback)
  const summaryMap = await summariseBatch(stories);
  for (const s of stories) {
    s.summary = summaryMap[s.id];
    db.prepare('UPDATE articles SET summary=? WHERE id=?').run(s.summary, s.id);
  }

  // 6) Markets
  const markets = await fetchMarkets(marketsCfg.tickers);
  const mktOk = markets.filter(m => m.ok).length;
  console.log(`Markets: ${mktOk}/${markets.length} symbols resolved.`);

  // 7) Previous edition (for diff)
  let prevEdition = null;
  const prior = listEditions(db, 5).find(e => e.id !== meta.id);
  if (prior && existsSync(join(ROOT, prior.path))) {
    try { prevEdition = loadJson(join(ROOT, prior.path)); } catch { /* ignore */ }
  }

  // 8) Build + write edition
  const edition = await buildEdition({ meta, stories, markets, prevEdition, statuses });
  const relPath = join('public', 'data', 'editions', `${meta.id}.json`);
  writeFileSync(join(ROOT, relPath), JSON.stringify(edition, null, 2));

  recordEdition(db, {
    id: meta.id, label: meta.label, created_at: meta.created_at,
    story_count: edition.story_count, path: relPath
  });

  // 9) Index of editions (for the archive picker) + latest pointer
  const index = listEditions(db, 60).map(e => ({
    id: e.id, label: e.label, created_at: e.created_at, story_count: e.story_count,
    file: `editions/${e.id}.json`
  }));
  writeFileSync(join(DATA_DIR, 'index.json'), JSON.stringify({
    latest: index[0]?.id || meta.id,
    generated_at: new Date().toISOString(),
    editions: index
  }, null, 2));

  // 10) Health log
  writeFileSync(join(DATA_DIR, 'health.json'), JSON.stringify({
    edition: meta.id, generated_at: new Date().toISOString(),
    feeds: sources.feeds.length, items: results.length, stories: stories.length,
    markets_ok: mktOk, markets_total: markets.length, feed_errors: errors,
    summariser: process.env.ANTHROPIC_API_KEY ? 'claude' : 'extractive',
    duration_ms: Date.now() - t0
  }, null, 2));

  console.log(`Wrote ${relPath} with ${stories.length} stories in ${Date.now() - t0}ms.`);
  db.close();
}

main().catch(err => { console.error(err); process.exit(1); });
