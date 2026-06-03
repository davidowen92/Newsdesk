// scripts/lib/rss.mjs
import Parser from 'rss-parser';
import { createHash } from 'node:crypto';

const parser = new Parser({
  timeout: 20000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsdeskBot/1.0; personal dashboard)' }
});

function googleNewsUrl(query) {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=en-GB&gl=GB&ceid=GB:en`;
}

// Google News wraps the real publisher in the item title as "Headline - Publisher".
function splitGoogleTitle(title = '') {
  const idx = title.lastIndexOf(' - ');
  if (idx > 0 && title.length - idx < 40) {
    return { title: title.slice(0, idx).trim(), source: title.slice(idx + 3).trim() };
  }
  return { title: title.trim(), source: null };
}

function canonicalUrl(url = '') {
  try {
    const u = new URL(url);
    u.hash = '';
    // strip tracking params
    [...u.searchParams.keys()].forEach(k => {
      if (/^(utm_|fbclid|gclid|cmp|ito|ns_)/i.test(k)) u.searchParams.delete(k);
    });
    return u.toString();
  } catch { return url; }
}

function hashId(...parts) {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

export async function fetchFeed(feed) {
  const url = feed.kind === 'googlenews' ? googleNewsUrl(feed.query) : feed.url;
  const parsed = await parser.parseURL(url);
  const out = [];
  for (const item of parsed.items || []) {
    let title = (item.title || '').trim();
    let source = feed.name;
    if (feed.kind === 'googlenews') {
      const split = splitGoogleTitle(title);
      title = split.title;
      if (split.source) source = split.source;
    }
    if (!title) continue;
    const link = canonicalUrl(item.link || item.guid || '');
    const published = item.isoDate || item.pubDate || null;
    const snippet = (item.contentSnippet || item.content || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    out.push({
      id: hashId(link || title),
      title,
      url: link,
      source,
      section: feed.section,
      subsection: feed.subsection || null,
      geo: feed.geo,
      feedWeight: feed.weight ?? 4,
      published_at: published ? new Date(published).toISOString() : null,
      snippet
    });
  }
  return out;
}

// Fetch all feeds with bounded concurrency; never let one bad feed kill the run.
export async function fetchAll(feeds, concurrency = 6) {
  const results = [];
  const errors = [];
  let i = 0;
  async function worker() {
    while (i < feeds.length) {
      const feed = feeds[i++];
      try {
        const items = await fetchFeed(feed);
        results.push(...items);
      } catch (err) {
        errors.push({ feed: feed.id, error: String(err?.message || err) });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { results, errors };
}
