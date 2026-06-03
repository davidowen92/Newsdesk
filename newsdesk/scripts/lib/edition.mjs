// scripts/lib/edition.mjs
import { analyseImplications } from './summarise.mjs';

// Edition label + id from a Date in UK time.
export function editionMeta(now = new Date()) {
  // Determine UK hour (Europe/London) without extra deps.
  const ukHour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', hour12: false
  }).format(now));
  const ukDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now); // YYYY-MM-DD
  let label = 'Morning';
  if (ukHour >= 17) label = 'Evening';
  else if (ukHour >= 11) label = 'Midday';
  const id = `${ukDate}-${label.toLowerCase()}`;
  return { id, label, ukDate, ukHour, created_at: now.toISOString() };
}

const SECTION_TREE = {
  uk:        { title: 'United Kingdom', subs: ['politics', 'economy', 'business', 'commercial-real-estate'] },
  sa:        { title: 'South Africa',   subs: ['politics', 'economy', 'business', 'property'] },
  global:    { title: 'Global News',    subs: ['us', 'europe', 'china', 'middleeast', 'geopolitics'] },
  realestate:{ title: 'Real Estate Intelligence', subs: ['uk-transactions','uk-leasing','uk-development','uk-debt','sa-listed','sa-cre'] }
};

function groupBySection(stories) {
  const out = {};
  for (const key of Object.keys(SECTION_TREE)) {
    out[key] = { title: SECTION_TREE[key].title, stories: [] };
  }
  for (const s of stories) {
    if (out[s.section]) out[s.section].stories.push(s);
  }
  for (const key of Object.keys(out)) {
    out[key].stories.sort((a, b) => b.score - a.score);
  }
  return out;
}

export async function buildEdition({ meta, stories, markets, prevEdition, statuses }) {
  // Attach NEW/UPDATED/ONGOING status (from db) to each story.
  for (const s of stories) {
    const st = statuses[s.id];
    s.status = st?.status || 'NEW';
    if (st?.firstSeen) s.first_seen = st.firstSeen;
  }

  const sections = groupBySection(stories);

  // What Matters To Me
  const topStories = stories.slice(0, 5);
  const creStories = stories.filter(s => s.section === 'realestate'
    || (s.flags || []).some(f => ['big-deal', 'big-let', 'refi', 'distress', 'planning', 'reit'].includes(f.id))
    || /interest rate|gilt|debt|refinanc|office/i.test(s.title));
  const creTop3 = creStories.slice(0, 3);
  const analysis = await analyseImplications({ topStories, creStories, markets });

  // Executive summary: the 4-6 highest-signal headlines as a quick scan.
  const execSummary = stories.slice(0, 6).map(s => ({
    title: s.title, source: s.source, tone: s.tone, flags: s.flags, status: s.status, url: s.url
  }));

  // Diff vs previous edition
  let changes = null;
  if (prevEdition) {
    const prevIds = new Set((prevEdition.allStoryIds || []));
    const added = stories.filter(s => !prevIds.has(s.id));
    const carried = stories.filter(s => prevIds.has(s.id));
    changes = {
      previousId: prevEdition.id,
      addedCount: added.length,
      carriedCount: carried.length,
      newHeadlines: added.slice(0, 8).map(s => ({ title: s.title, source: s.source, url: s.url, flags: s.flags }))
    };
  }

  return {
    id: meta.id,
    label: meta.label,
    created_at: meta.created_at,
    ukDate: meta.ukDate,
    story_count: stories.length,
    executiveSummary: execSummary,
    sections,
    markets,
    whatMattersToMe: {
      top5: topStories.map(slim),
      creTop3: creTop3.map(slim),
      implications: analysis.implications,
      oneLiner: analysis.oneLiner
    },
    changes,
    allStoryIds: stories.map(s => s.id)
  };
}

function slim(s) {
  return {
    title: s.title, summary: s.summary, source: s.source, url: s.url,
    tone: s.tone, flags: s.flags, status: s.status, section: s.section,
    published_at: s.published_at, score: s.score, also_in: s.also_in || []
  };
}
