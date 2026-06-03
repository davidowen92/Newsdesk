// scripts/lib/dedupe.mjs
import { createHash } from 'node:crypto';

const STOP = new Set(('a an the of to in on for and or but with from by at as is are was were be '
  + 'this that these those it its their his her our your my we you they he she i over after before '
  + 'amid says say said new latest update updates report reports').split(' '));

export function normaliseTitle(t = '') {
  return t.toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(t) {
  return new Set(normaliseTitle(t).split(' ').filter(w => w.length > 2 && !STOP.has(w)));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

function clusterId(title) {
  return createHash('sha1').update(normaliseTitle(title)).digest('hex').slice(0, 12);
}

// Greedy clustering. Items sharing >= threshold token overlap collapse into one story,
// keeping the highest-scored representative and listing the other sources.
export function clusterArticles(articles, threshold = 0.5) {
  const withTokens = articles.map(a => ({ a, tok: tokens(a.title) }));
  const clusters = [];

  for (const cur of withTokens) {
    let best = null, bestSim = 0;
    for (const c of clusters) {
      const sim = jaccard(cur.tok, c.tok);
      if (sim > bestSim) { bestSim = sim; best = c; }
    }
    if (best && bestSim >= threshold) {
      best.members.push(cur.a);
      // grow the cluster token set so chains still match
      for (const w of cur.tok) best.tok.add(w);
    } else {
      clusters.push({ tok: new Set(cur.tok), members: [cur.a] });
    }
  }

  return clusters.map(c => {
    const members = c.members.slice().sort((x, y) => (y.score ?? 0) - (x.score ?? 0));
    const rep = members[0];
    const cid = clusterId(rep.title);
    members.forEach(m => { m.cluster_id = cid; });
    const otherSources = [...new Set(members.slice(1).map(m => m.source).filter(Boolean))];
    return {
      ...rep,
      cluster_id: cid,
      duplicate_count: members.length,
      also_in: otherSources,
      all_links: members.map(m => ({ source: m.source, url: m.url }))
    };
  });
}
