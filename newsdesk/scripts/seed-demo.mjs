// scripts/seed-demo.mjs
// OPTIONAL: generate sample data to preview the dashboard offline (no network, no DB).
// The stories below are illustrative fixtures, NOT real news. Run: `npm run seed`.
// Real content comes from `npm run ingest` (or the scheduled job).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { rankAll } from './lib/rank.mjs';
import { clusterArticles } from './lib/dedupe.mjs';
import { summariseBatch } from './lib/summarise.mjs';
import { buildEdition, editionMeta } from './lib/edition.mjs';

const ROOT = process.cwd();
const DATA = join(ROOT, 'public', 'data');
const kw = JSON.parse(readFileSync(join(ROOT, 'config', 'keywords.json'), 'utf8'));

const now = Date.now();
const ago = h => new Date(now - h * 36e5).toISOString();

const fixtures = [
  ['Bank of England holds rates as inflation cools to 2.4%', 'Reuters', 'uk', 'economy', 'uk', 8, 1, 'The MPC voted 7-2 to hold Bank Rate, citing easing services inflation.'],
  ['Chancellor signals Budget tax changes for commercial property', 'Financial Times', 'uk', 'politics', 'uk', 8, 2, 'Treasury weighs business rates reform that could affect office occupiers.'],
  ['Blackstone buys City of London office tower for £480m', 'Property Week', 'realestate', 'uk-transactions', 'uk', 8, 3, 'The 320,000 sq ft tower was sold at a yield reflecting repriced values.'],
  ['Blackstone acquires London office tower in £480m deal', 'CoStar', 'realestate', 'uk-transactions', 'uk', 7, 4, 'A landmark City asset changes hands as investment volumes recover.'],
  ['Law firm signs 85,000 sq ft prelet at Canary Wharf scheme', 'Estates Gazette', 'realestate', 'uk-leasing', 'uk', 7, 5, 'One of the largest West End-to-Docklands relocations this year.'],
  ['British Land refinances £350m facility amid tighter debt market', 'Bloomberg', 'realestate', 'uk-debt', 'uk', 8, 6, 'The REIT extended maturities as lenders stay cautious on offices.'],
  ['Distressed regional office portfolio falls into administration', 'Financial Times', 'realestate', 'uk-debt', 'uk', 8, 7, 'A covenant breach triggered receivers across a 12-asset portfolio.'],
  ['Planning approval granted for major Shoreditch office scheme', 'Bisnow', 'realestate', 'uk-development', 'uk', 6, 9, 'Council approved a 250,000 sq ft mixed-use commercial development.'],
  ['Growthpoint reports resilient office occupancy in interim results', 'Moneyweb', 'realestate', 'sa-listed', 'sa', 8, 4, 'The SA REIT held distributions steady despite a soft Joburg market.'],
  ['Redefine sells Cape Town retail asset to fund debt reduction', 'Business Day', 'realestate', 'sa-listed', 'sa', 7, 8, 'Proceeds will cut gearing as the group manages refinancing risk.'],
  ['SARB keeps repo rate unchanged as rand steadies', 'News24', 'sa', 'economy', 'sa', 6, 3, 'The Reserve Bank cited sticky inflation expectations.'],
  ['South Africa coalition tensions rise over budget framework', 'Daily Maverick', 'sa', 'politics', 'sa', 6, 5, 'Negotiations stall ahead of the medium-term statement.'],
  ['Fed officials signal patience on rate cuts as data stays firm', 'Reuters', 'global', 'us', 'us', 7, 2, 'Treasury yields ticked higher after the remarks.'],
  ['ECB trims forecasts as euro-area growth disappoints', 'Bloomberg', 'global', 'europe', 'europe', 6, 6, 'Policymakers flagged downside risks to the periphery.'],
  ['China unveils fresh stimulus to support property sector', 'Reuters', 'global', 'china', 'china', 6, 7, 'Measures aim to stabilise developer financing.'],
  ['Middle East tensions lift Brent crude above recent range', 'Sky News', 'global', 'middleeast', 'middleeast', 5, 4, 'Energy markets priced in a modest risk premium.'],
  ['Celebrity chef opens new London restaurant to rave reviews', 'Lifestyle Wire', 'uk', 'business', 'uk', 3, 2, 'A glitzy opening drew a celebrity crowd.'], // should be filtered out
  ['Premier League weekend roundup: all the goals', 'Sport Desk', 'uk', 'business', 'uk', 3, 1, 'Match highlights and reaction.'] // should be filtered out
];

const articles = fixtures.map(([title, source, section, subsection, geo, feedWeight, h, snippet], i) => ({
  id: `demo${i}`, title, url: `https://example.com/${i}`, source, section, subsection, geo,
  feedWeight, published_at: ago(h), snippet
}));

const mockMarkets = JSON.parse(readFileSync(join(ROOT, 'config', 'markets.json'), 'utf8')).tickers.map((t, i) => {
  const pct = [(+( [0.4,-0.2,0.8,1.1,0.3,-0.6][i%6])).toFixed(2)][0];
  const base = { index: 8000, rate: 4.2, fx: 1.27, commodity: 82, crypto: 67000 }[t.group] || 100;
  const price = +(base * (1 + i * 0.013)).toFixed(t.group === 'fx' ? 4 : 2);
  return { ...t, ok: true, price, prevClose: price / (1 + pct / 100), pct: +pct, change: 0, currency: 'GBP', asof: new Date().toISOString() };
});

const main = async () => {
  process.env.DRY_RUN = '1'; // force extractive summaries
  mkdirSync(join(DATA, 'editions'), { recursive: true });
  const ranked = rankAll(articles, kw);
  console.log(`Ranked ${ranked.length}/${articles.length} (noise filtered).`);
  const stories = clusterArticles(ranked).sort((a, b) => b.score - a.score);
  console.log(`Clustered into ${stories.length} stories.`);
  const sums = await summariseBatch(stories);
  stories.forEach(s => { s.summary = sums[s.id]; });
  const statuses = {}; stories.forEach((s, i) => { statuses[s.id] = { status: ['NEW', 'UPDATED', 'ONGOING'][i % 3] }; });
  const meta = editionMeta(new Date());
  const ed = await buildEdition({ meta, stories, markets: mockMarkets, prevEdition: null, statuses });
  writeFileSync(join(DATA, 'editions', `${meta.id}.json`), JSON.stringify(ed, null, 2));
  writeFileSync(join(DATA, 'index.json'), JSON.stringify({
    latest: meta.id, generated_at: new Date().toISOString(),
    editions: [{ id: meta.id, label: meta.label, created_at: meta.created_at, story_count: ed.story_count, file: `editions/${meta.id}.json` }]
  }, null, 2));
  console.log(`Demo edition ${meta.id} written. Run \`npm run serve\` then open http://localhost:5173`);
};
main();
