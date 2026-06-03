# Newsdesk — automated personal news & markets dashboard

A private, bookmarkable dashboard that refreshes itself three times a day (06:00 / 12:00 /
18:00 UK) with UK, South Africa and global news, financial markets, and UK/SA real-estate
intelligence. It fetches, deduplicates, ranks, tags and summarises stories, keeps an archive
of every edition, and shows what changed since the last one.

You never run a prompt. A scheduled job builds each edition and commits it; you just open the page.

---

## How it works (architecture)

```
GitHub Actions (cron 3x/day)
        │
        ▼
  scripts/ingest.mjs ──► RSS + Google News feeds      (config/sources.json)
        │           └──► Yahoo Finance market data     (config/markets.json)
        │
        ├─ rank + flag + tone   (config/keywords.json)
        ├─ deduplicate into stories
        ├─ tag NEW / UPDATED / ONGOING   (via SQLite archive: data/news.db)
        ├─ summarise              (Claude API, or extractive fallback)
        └─ write edition JSON     ──► public/data/editions/<id>.json
                                       public/data/index.json   (archive list)
        │
        ▼
  git commit + push  ──►  host redeploys static files
        │
        ▼
  public/ (index.html + app.js + styles.css) — the dashboard you bookmark
```

- **Backend / scheduler:** Node scripts run by GitHub Actions. Nothing to keep alive.
- **Database:** SQLite (`data/news.db`) holds the full article archive and powers the
  NEW/UPDATED/ONGOING tagging and dedup memory across editions. Edition *snapshots* are
  plain JSON the frontend reads.
- **Frontend:** zero-build static site (vanilla ES modules). Deploys anywhere static.
- **Summaries:** Claude API if `ANTHROPIC_API_KEY` is set; otherwise a clean extractive
  one-liner so the pipeline never fails.

---

## Quick start (local)

```bash
npm install                 # installs rss-parser + better-sqlite3 (needs build tools; see notes)
npm run seed                # OPTIONAL: writes sample demo data so you can preview the UI offline
npm run serve               # open http://localhost:5173
```

To build a real edition locally (needs internet):

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # optional; omit for extractive summaries
npm run ingest
npm run serve
```

> `npm run seed` writes **illustrative fixtures, not real news** — just to preview the layout.
> Replace it with `npm run ingest` (or the scheduled job) for live content.

---

## Deploy (recommended: GitHub + Vercel)

1. **Push this folder to a new GitHub repo.**
2. **Add your Claude key (optional but recommended):**
   repo → *Settings → Secrets and variables → Actions* → **New repository secret**
   - Name: `ANTHROPIC_API_KEY`  Value: your key
   - (Optional) add a *Variable* `ANTHROPIC_MODEL` to pin a model.
3. **Enable the schedule:** the workflow in `.github/workflows/ingest.yml` runs automatically.
   To test now: *Actions → ingest → Run workflow*. It will fetch, build an edition, and
   commit it back to the repo.
4. **Connect the repo to Vercel** (or Netlify / Cloudflare Pages / GitHub Pages):
   - Framework preset: **Other / None**
   - Build command: *(none)*
   - Output directory: **public**
   - `vercel.json` already sets this and disables caching on `/data/*` so new editions show
     immediately.
5. **Bookmark the Vercel URL.** Each scheduled commit triggers a redeploy with the latest edition.

> **GitHub Pages alternative:** set Pages to deploy `/public`, or move `public/*` to the repo
> root. Everything is static.

### Why GitHub Actions instead of Vercel Cron / Supabase?
For a 3×/day personal job, Actions is free, simple, and writes a real archive into your repo
(your editions become version-controlled history). The scheduler can't silently die the way a
long-running server can. If you prefer Vercel Cron or Supabase scheduled functions, the
ingestion script is self-contained — point any scheduler at `node scripts/ingest.mjs`.

---

## Maintaining sources & keys

**Sources — `config/sources.json`.** Each feed is one line. Two kinds:
- `"kind": "rss"` — a direct RSS/Atom URL.
- `"kind": "googlenews"` — a search `query` turned into a Google News feed. Used as a robust
  catch-all for paywalled / no-RSS sources (FT, The Times, Telegraph premium, CoStar, Green
  Street, Estates Gazette, Property Week, Bisnow) and for topical coverage. Use Google's
  operators, e.g. `site:propertyweek.com`, `when:2d`, quotes for phrases.

Add a source by copying a line and setting `name`, `url`/`query`, `section`, `subsection`,
`geo`, `weight` (higher = more trusted/important).

> **JSE SENS** has no free RSS. The `gn-sa-listed-prop` Google News query tracks the named
> REITs (Growthpoint, Redefine, Hyprop, etc.). For raw SENS, plug a provider feed in as a new
> `rss` source.

**Ranking — `config/keywords.json`.** `boost`/`penalty` are substring→score. `flags.rules`
are regexes that add a visible chip + score (deals >£20m, lettings >10k sq ft, refinancing,
planning, distress, REIT updates). Tune freely.

**Markets — `config/markets.json`.** Yahoo Finance symbols (no key). Swap a symbol if one
stops resolving. **Yields** (UK gilt / US 10y) are the least reliable on Yahoo; if you need
them rock-solid, sign up for a keyed provider (Alpha Vantage, Twelve Data, FRED) and replace
the body of `fetchSymbol` in `scripts/lib/markets.mjs`.

**Claude key.** Local: `.env` (see `.env.example`) or `export ANTHROPIC_API_KEY=...`.
Production: the GitHub Actions secret above. Without a key, summaries are extractive — the
app still works fully. Check <https://docs.claude.com> for current model names if you set
`ANTHROPIC_MODEL`.

---

## What you get on the page

- **Executive summary**, then sections: **UK**, **South Africa**, **Global**,
  **Real Estate Intelligence** (UK transactions/leasing/development/debt, SA listed & CRE).
- **Market dashboard** table (indices, yields, FX, commodities, crypto) with green/red moves.
- **What Matters To Me:** top 5 developments, top 3 for a UK CRE finance director, and an
  implications brief (office values, debt availability, rates, refinancing, London demand).
- **What changed** vs the previous edition; **NEW/UPDATED/ONGOING** tags on every story.
- **Search bar**, **section filters**, and an **archive picker** for past editions.
- Dark, dense, mobile-friendly terminal layout.

---

## Files

```
config/        sources.json · markets.json · keywords.json   ← you edit these
scripts/
  ingest.mjs   orchestrator (run by the scheduler)
  serve.mjs    local static preview server
  seed-demo.mjs optional offline sample data
  lib/         rss · markets · rank · dedupe · summarise · db · edition
public/        index.html · app.js · styles.css   ← the dashboard
  data/        editions/*.json · index.json · health.json   (generated)
data/news.db   SQLite archive   (generated, committed by the job)
.github/workflows/ingest.yml   the schedule
```

`public/data/health.json` is written each run (feed errors, counts, summariser mode) — handy
if a feed goes quiet.

---

## Notes & troubleshooting

- **`better-sqlite3` install fails locally:** it's a native module. On most machines
  `npm install` pulls a prebuilt binary; if it tries to compile, install build tools
  (macOS: `xcode-select --install`; Debian/Ubuntu: `sudo apt-get install -y python3 make g++`).
  GitHub Actions (Ubuntu) handles this automatically.
- **A feed returns nothing:** check `health.json` → `feed_errors`. Some publishers change RSS
  URLs; swap to a `googlenews` query as a fallback.
- **Times shown** use Europe/London. The cron runs in UTC with paired times so editions land
  at the right UK hour in both GMT and BST.
- **Costs:** Yahoo + RSS are free. Claude summarisation is the only paid piece and is batched
  (one call per edition) using a small model by default — pennies per edition. Omit the key to
  pay nothing.

---

*Personal use. Respect each publisher's terms; this tool links out to original articles and
stores only headlines/short summaries for your own dashboard.*
