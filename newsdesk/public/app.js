// app.js — loads JSON editions and renders the dashboard. No build step, no deps.
const $ = sel => document.querySelector(sel);

const SECTION_ORDER = ['uk', 'sa', 'global', 'realestate'];
const SECTION_LABELS = { uk: 'UK', sa: 'SA', global: 'Global', realestate: 'Real Estate' };
const MARKET_GROUPS = { index: 'Indices', rate: 'Yields', fx: 'FX', commodity: 'Commodities', crypto: 'Crypto' };

const state = { edition: null, filter: 'all', query: '' };

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function relTime(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 90) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}
function ukStamp(iso) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch { return iso; }
}

async function boot() {
  let index;
  try {
    index = await (await fetch('/data/index.json', { cache: 'no-store' })).json();
  } catch {
    $('#lastUpdated').textContent = 'no editions yet — run ingestion';
    $('#sections').innerHTML = `<div class="empty">No editions found.<br>Run <code>npm run ingest</code> (or wait for the scheduled job), then refresh.</div>`;
    return;
  }
  // Archive picker
  const picker = $('#editionPicker');
  picker.innerHTML = index.editions.map(e =>
    `<option value="${e.file}">${e.label} · ${e.id.slice(0, 10)} (${e.story_count})</option>`).join('');
  picker.onchange = () => loadEdition(picker.value);

  // Section filter chips
  $('#sectionFilters').innerHTML =
    `<button class="chip active" data-f="all">All</button>` +
    SECTION_ORDER.map(s => `<button class="chip" data-f="${s}">${SECTION_LABELS[s]}</button>`).join('');
  $('#sectionFilters').onclick = e => {
    const b = e.target.closest('.chip'); if (!b) return;
    state.filter = b.dataset.f;
    document.querySelectorAll('#sectionFilters .chip').forEach(c => c.classList.toggle('active', c === b));
    renderSections();
  };
  $('#search').oninput = e => { state.query = e.target.value.toLowerCase().trim(); renderSections(); };

  await loadEdition(index.editions[0].file);
}

async function loadEdition(file) {
  const ed = await (await fetch(`/data/${file}`, { cache: 'no-store' })).json();
  state.edition = ed;
  $('#editionTag').textContent = `${ed.label} · ${ed.ukDate}`;
  $('#lastUpdated').textContent = `updated ${relTime(ed.created_at)} · ${ukStamp(ed.created_at)}`;
  $('#footMeta').textContent = `${ed.story_count} stories · edition ${ed.id}`;
  renderExec(ed);
  renderChanges(ed);
  renderMarkets(ed.markets || []);
  renderWMTM(ed.whatMattersToMe || {});
  renderSections();
}

function tagHtml(status) { return status ? `<span class="tag ${status}">${status}</span>` : ''; }
function flagsHtml(flags) { return (flags || []).map(f => `<span class="flag ${f.tone || 'neutral'}">${esc(f.label)}</span>`).join(''); }

function renderExec(ed) {
  const items = ed.executiveSummary || [];
  if (!items.length) return ($('#execSummary').innerHTML = '');
  $('#execSummary').innerHTML = `<div class="panel exec">
    <div class="panel-head"><span class="panel-title">Executive Summary</span>
      <span class="panel-meta">${ed.label} edition</span></div>
    <ul class="panel-body" style="margin:0;padding:0">${items.map(s => `
      <li><span class="bullet">▸</span><span>${tagHtml(s.status)} <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>
      ${flagsHtml(s.flags)} <span class="src">— ${esc(s.source || '')}</span></span></li>`).join('')}</ul></div>`;
}

function renderChanges(ed) {
  const c = ed.changes;
  if (!c) return ($('#changes').innerHTML = '');
  $('#changes').innerHTML = `<div class="panel changes">
    <div class="panel-head"><span class="panel-title">What Changed</span>
      <span class="panel-meta">vs ${esc(c.previousId)}</span></div>
    <div class="panel-body">
      <div class="ch-head">${c.addedCount} new · ${c.carriedCount} carried over</div>
      ${c.newHeadlines?.length ? `<ul>${c.newHeadlines.map(h =>
        `<li><a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a> ${flagsHtml(h.flags)}</li>`).join('')}</ul>` : '<div>No new headlines since last edition.</div>'}
    </div></div>`;
}

function cardHtml(s) {
  const tone = s.tone === 'negative' ? 'neg' : s.tone === 'positive' ? 'pos' : 'neu';
  const also = (s.also_in && s.also_in.length) ? `<span class="also">+${s.also_in.length} more (${esc(s.also_in.slice(0, 2).join(', '))})</span>` : '';
  return `<a class="card ${tone}" href="${esc(s.url)}" target="_blank" rel="noopener">
    <div class="card-top">${tagHtml(s.status)}${flagsHtml(s.flags)}</div>
    <span class="card-title">${esc(s.title)}</span>
    ${s.summary ? `<div class="card-sum">${esc(s.summary)}</div>` : ''}
    <div class="card-foot"><span class="src">${esc(s.source || '')}</span><span>·</span><span>${relTime(s.published_at)}</span>${also ? '<span>·</span>' + also : ''}</div>
  </a>`;
}

function renderSections() {
  const ed = state.edition; if (!ed) return;
  const q = state.query;
  const match = s => !q || (s.title + ' ' + (s.summary || '')).toLowerCase().includes(q);
  const wanted = state.filter === 'all' ? SECTION_ORDER : [state.filter];
  let html = '', total = 0;
  for (const key of wanted) {
    const sec = ed.sections?.[key]; if (!sec) continue;
    const stories = (sec.stories || []).filter(match);
    if (!stories.length) continue;
    total += stories.length;
    html += `<div class="section-block"><h3 class="section-head">${esc(sec.title)} · ${stories.length}</h3>
      <div class="panel"><div class="panel-body" style="padding:0">${stories.map(cardHtml).join('')}</div></div></div>`;
  }
  $('#sections').innerHTML = html;
  $('#emptyState').classList.toggle('hidden', total > 0);
}

function fmtPrice(m) {
  if (m.price == null) return '<span class="na">n/a</span>';
  const dp = m.group === 'fx' ? 4 : m.group === 'rate' ? 2 : m.price >= 1000 ? 0 : 2;
  return Number(m.price).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtChg(m) {
  if (m.pct == null) return '<span class="na">—</span>';
  const cls = m.pct > 0.001 ? 'up' : m.pct < -0.001 ? 'down' : 'flat';
  const arrow = m.pct > 0.001 ? '▲' : m.pct < -0.001 ? '▼' : '·';
  const sign = m.pct > 0 ? '+' : '';
  return `<span class="${cls}">${arrow} ${sign}${m.pct.toFixed(2)}%</span>`;
}

function renderMarkets(markets) {
  if (!markets.length) return ($('#markets').innerHTML = '');
  let rows = '', lastGroup = null;
  for (const m of markets) {
    if (m.group !== lastGroup) { rows += `<tr><td class="grp" colspan="3">${MARKET_GROUPS[m.group] || m.group}</td></tr>`; lastGroup = m.group; }
    rows += `<tr><td class="lbl">${esc(m.label)}</td><td class="px">${fmtPrice(m)}</td><td class="chg">${fmtChg(m)}</td></tr>`;
  }
  $('#markets').innerHTML = `<div class="panel"><div class="panel-head">
    <span class="panel-title">Market Dashboard</span><span class="panel-meta">vs prev close</span></div>
    <table class="mkt"><tbody>${rows}</tbody></table></div>`;
}

function renderWMTM(w) {
  const top5 = w.top5 || [], cre = w.creTop3 || [], impl = w.implications || [];
  $('#wmtm').innerHTML = `<div class="panel wmtm">
    <div class="panel-head"><span class="panel-title">What Matters To Me</span></div>
    <div class="panel-body" style="padding:0">
      <div class="blk"><h4>Top 5 developments</h4><ol>${top5.map(s =>
        `<li>${tagHtml(s.status)} <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('') || '<li>—</li>'}</ol></div>
      <div class="blk"><h4>Top 3 · CRE finance director</h4><ol>${cre.map(s =>
        `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> ${flagsHtml(s.flags)}</li>`).join('') || '<li>—</li>'}</ol></div>
      <div class="blk"><h4>Implications · UK office / debt / rates</h4>
        <ul class="impl" style="margin:0;padding-left:16px">${impl.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
        ${w.oneLiner ? `<div class="oneliner">“${esc(w.oneLiner)}”</div>` : ''}</div>
    </div></div>`;
}

boot();
