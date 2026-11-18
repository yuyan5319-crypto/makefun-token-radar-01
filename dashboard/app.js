// Signal Sweep dashboard: renders window.RADAR (written beside this page by
// main.ts) as a sortable, filterable board of pre-token protocols, a detail
// view per protocol with its model breakdown and farm plan, and a Live view
// of protocols whose token already trades. No network, no framework.
'use strict';

const R = window.RADAR;
const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const state = {
  tab: params.get('view') === 'live' ? 'live' : 'board',
  q: params.get('q') || '',
  category: params.get('category') || '',
  chain: params.get('chain') || '',
  watchlist: params.get('watchlist') === '1',
  minTvl: Number(params.get('mintvl') || 0),
  sort: params.get('sort') || 'rank',
  protocol: params.get('protocol') || '',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function money(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}
function pct(n) {
  if (n === null || n === undefined) return '<span class="flat">—</span>';
  const cls = n > 0.05 ? 'pos' : n < -0.05 ? 'neg' : 'flat';
  return `<span class="${cls}">${n >= 0 ? '+' : ''}${n.toFixed(1)}%</span>`;
}
const ageText = (d) => (d === null || d === undefined ? '—' : d >= 730 ? `${(d / 365).toFixed(1)}y` : `${d}d`);

function renderStats() {
  const el = document.getElementById('stats');
  const cells = [
    [R.protocols_size, 'protocols scanned'],
    [R.pre_token_size, 'record no token'],
    [R.set_aside_size, 'derivatives set aside'],
    [R.board_size, 'ranked on the board'],
    [R.watchlist_size, 'watchlist covered'],
    [R.global_multiple.toFixed(3), 'global live multiple'],
  ];
  el.innerHTML = cells.map(([v, l]) => `<div class="stat"><b>${v}</b><i>${l}</i></div>`).join('');
  document.getElementById('model-line').textContent =
    `Model ${R.model_version}: implied = TVL x category multiple (calibrated live from this snapshot's trading tokens, global median ${R.global_multiple}) x growth x maturity x breadth. Snapshot as of ${R.as_of}, ${R.source}.`;
}

function categories() {
  return [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
}
function chains() {
  const set = new Set();
  for (const r of R.rows) for (const c of r.chains) set.add(c);
  return [...set].sort();
}

function filteredRows() {
  let rows = R.rows.filter((r) => {
    if (state.watchlist && !r.watchlist) return false;
    if (state.category && r.category !== state.category) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.minTvl && r.tvl_usd < state.minTvl) return false;
    if (state.q) {
      const q = state.q.toLowerCase();
      if (!`${r.name} ${r.slug} ${r.category || ''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const key = {
    rank: (r) => r.rank,
    implied: (r) => -r.implied_value_usd,
    tvl: (r) => -r.tvl_usd,
    change: (r) => -(r.change_7d ?? -9999),
    age: (r) => -(r.age_days ?? -1),
    multiple: (r) => -r.category_multiple,
  }[state.sort] || ((r) => r.rank);
  rows = [...rows].sort((a, b) => key(a) - key(b));
  return rows;
}

function controlsHtml(count) {
  const catOpts = ['<option value="">All categories</option>', ...categories().map((c) => `<option ${c === state.category ? 'selected' : ''}>${esc(c)}</option>`)].join('');
  const chainOpts = ['<option value="">All chains</option>', ...chains().map((c) => `<option ${c === state.chain ? 'selected' : ''}>${esc(c)}</option>`)].join('');
  const tvlOpts = [[0, 'Any TVL'], [5e6, 'TVL $5M+'], [5e7, 'TVL $50M+'], [2.5e8, 'TVL $250M+'], [1e9, 'TVL $1B+']]
    .map(([v, l]) => `<option value="${v}" ${Number(state.minTvl) === v ? 'selected' : ''}>${l}</option>`).join('');
  return `<div class="controls">
    <input type="search" id="f-q" placeholder="Search name or category" value="${esc(state.q)}">
    <select id="f-cat">${catOpts}</select>
    <select id="f-chain">${chainOpts}</select>
    <select id="f-tvl">${tvlOpts}</select>
    <label class="check"><input type="checkbox" id="f-watch" ${state.watchlist ? 'checked' : ''}> Watchlist only</label>
    <span class="count">${count} shown</span>
  </div>`;
}

function tabsHtml() {
  return `<div class="tabs">
    <button data-tab="board" class="${state.tab === 'board' ? 'on' : ''}">Pre-token board</button>
    <button data-tab="live" class="${state.tab === 'live' ? 'on' : ''}">Live tokens (market's own values)</button>
  </div>`;
}

function boardHtml() {
  const rows = filteredRows();
  const head = `<tr>
    <th data-sort="rank">#</th><th>Protocol</th><th class="hide">Category</th><th class="hide">Chains</th>
    <th class="num" data-sort="tvl">TVL</th><th class="num" data-sort="change">7d</th>
    <th class="num hide" data-sort="age">Age</th><th class="num" data-sort="multiple">Mult</th>
    <th class="num" data-sort="implied">Implied value</th></tr>`;
  const body = rows.map((r) => `<tr data-slug="${esc(r.slug)}">
    <td class="rank">${r.rank}</td>
    <td><span class="pname">${esc(r.name)}</span>${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}</td>
    <td class="cat hide">${esc(r.category || '—')}</td>
    <td class="chains hide">${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
    <td class="num">${money(r.tvl_usd)}</td>
    <td class="num">${pct(r.change_7d)}</td>
    <td class="num hide">${ageText(r.age_days)}</td>
    <td class="num mult">${r.category_multiple.toFixed(3)}</td>
    <td class="num implied">${money(r.implied_value_usd)}</td></tr>`).join('');
  const table = rows.length ? `<table><thead>${head}</thead><tbody>${body}</tbody></table>` : '<div class="empty">No protocol matches this filter. Loosen it: the board itself holds every candidate.</div>';
  return `${tabsHtml()}${controlsHtml(rows.length)}${table}`;
}

function liveHtml() {
  const head = `<tr><th>Protocol</th><th class="hide">Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">7d</th><th class="num">Mcap / TVL</th></tr>`;
  const body = R.live.map((r) => `<tr>
    <td><span class="pname">${esc(r.name)}</span></td>
    <td class="cat hide">${esc(r.category || '—')}</td>
    <td class="num">${money(r.tvl_usd)}</td>
    <td class="num">${money(r.mcap_usd)}</td>
    <td class="num">${pct(r.change_7d)}</td>
    <td class="num mult">${r.mcap_tvl === null ? '—' : r.mcap_tvl.toFixed(3)}</td></tr>`).join('');
  return `${tabsHtml()}<div class="controls"><span class="count">These tokens already trade, so the board shows the market's own cap, never a model value. Their mcap/TVL ratios are what calibrate the board's multiples.</span></div><table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function detailHtml(r) {
  const kv = [
    [money(r.implied_value_usd), 'implied value'],
    [`#${r.rank} of ${R.board_size}`, 'board rank'],
    [money(r.tvl_usd), 'TVL'],
    [r.change_7d === null ? '—' : `${r.change_7d >= 0 ? '+' : ''}${r.change_7d}%`, 'TVL change, 7d'],
    [ageText(r.age_days), 'tracked, no token'],
    [r.watchlist ? 'Yes' : 'Below the floor', 'on the house watchlist'],
  ].map(([v, l]) => `<div><b>${v}</b><i>${l}</i></div>`).join('');
  const factors = [
    ['TVL (snapshot)', money(r.tvl_usd)],
    [`Category multiple (${esc(r.category || 'global cohort')})`, `${r.category_multiple.toFixed(4)} — from ${r.cohort_size > 0 ? `${r.cohort_size} live peer${r.cohort_size === 1 ? '' : 's'}` : 'the global cohort'}`],
    ['Growth multiplier (7d TVL)', r.growth_multiplier.toFixed(4)],
    ['Maturity multiplier (age)', r.maturity_multiplier.toFixed(4)],
    ['Breadth multiplier (chains)', r.breadth_multiplier.toFixed(4)],
    ['Implied value', money(r.implied_value_usd)],
  ].map(([k, v]) => `<tr><td>${k}</td><td class="num">${v}</td></tr>`).join('');
  const plan = r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('');
  return `<div class="detail">
    <button class="back" id="d-back">&larr; Back to the board</button>
    <h1>${esc(r.name)}${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}</h1>
    <p class="note">${esc(r.category || 'Uncategorised')} · ${esc(r.chains.join(', ') || 'no chains recorded')} · records no token in the snapshot${r.listed_at ? ` · tracked since ${esc(r.listed_at)}` : ''}</p>
    <div class="kv">${kv}</div>
    <p class="note">Why it ranks here: ${esc(r.note)}</p>
    <h2>How the implied value is built</h2>
    <table class="mini"><tbody>${factors}</tbody></table>
    <h2>Farm plan</h2>
    <ol class="plan">${plan}</ol>
  </div>`;
}

function render() {
  renderStats();
  if (state.protocol) {
    const r = R.rows.find((x) => x.slug === state.protocol);
    app.innerHTML = r ? detailHtml(r) : boardHtml();
  } else {
    app.innerHTML = state.tab === 'live' ? liveHtml() : boardHtml();
  }
  app.setAttribute('aria-busy', 'false');
  bind();
}

function bind() {
  for (const b of app.querySelectorAll('[data-tab]')) b.addEventListener('click', () => { state.tab = b.dataset.tab; state.protocol = ''; render(); });
  for (const th of app.querySelectorAll('th[data-sort]')) th.addEventListener('click', () => { state.sort = th.dataset.sort; render(); });
  for (const tr of app.querySelectorAll('tbody tr[data-slug]')) tr.addEventListener('click', () => { state.protocol = tr.dataset.slug; render(); window.scrollTo(0, 0); });
  const back = document.getElementById('d-back');
  if (back) back.addEventListener('click', () => { state.protocol = ''; render(); });
  const q = document.getElementById('f-q');
  if (q) q.addEventListener('input', () => { state.q = q.value; const pos = q.selectionStart; render(); const nq = document.getElementById('f-q'); nq.focus(); nq.setSelectionRange(pos, pos); });
  const cat = document.getElementById('f-cat');
  if (cat) cat.addEventListener('change', () => { state.category = cat.value; render(); });
  const ch = document.getElementById('f-chain');
  if (ch) ch.addEventListener('change', () => { state.chain = ch.value; render(); });
  const tv = document.getElementById('f-tvl');
  if (tv) tv.addEventListener('change', () => { state.minTvl = Number(tv.value); render(); });
  const w = document.getElementById('f-watch');
  if (w) w.addEventListener('change', () => { state.watchlist = w.checked; render(); });
}

render();
