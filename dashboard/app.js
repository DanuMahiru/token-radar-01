// Token Radar dashboard, radar-2.
//
// A static page: it reads window.RADAR (written by main.ts from the same board.json the gate
// checks), renders the ranked board, a detail view for every protocol, a filtered view and the
// live-token set. No fetch, no network, no framework. Every figure on the page comes from the
// snapshot through lib/model.ts; the page never invents a number.
//
// Model (radar-2), stated on the page and computed in lib/model.ts:
//   implied = TVL x category multiple x growth x tenure x breadth
//   category multiple = median market-cap / TVL of the snapshot's own live-token protocols in
//   the same category, shrunk toward the global median (weight n / (n + 5)); fewer than 3 live
//   comps use the global median. Growth clamps the 7-day TVL change to [-60, +120]% at half
//   weight; tenure rises from 0.60 to 1.00 over three years with no token; breadth adds 2% per
//   extra chain, at most +10%. No name is ever special-cased.

/* ------------------------------------------------------------------ helpers */

const main = document.getElementById('board');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtInt(n) {
  return Number(n).toLocaleString('en-US');
}

function fmtUsd(n) {
  return '$' + fmtInt(n);
}

function fmtShort(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + fmtInt(n);
}

function fmtPct(n) {
  if (n === null || n === undefined) return 'n/a';
  const s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  return `<span class="${n > 0 ? 'pos' : n < 0 ? 'neg' : ''}">${s}</span>`;
}

function ageText(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days < 30) return days + 'd';
  if (days < 365) return Math.round(days / 30) + 'mo';
  return (days / 365).toFixed(1) + 'y';
}

function params() {
  return new URLSearchParams(location.search);
}

function go(search) {
  location.search = search;
}

function opt(value, current, label) {
  return `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
}

/* ------------------------------------------------------------------ header */

function headerHTML(d) {
  return `<header class="hero">
    <div class="kicker">Token Radar &middot; model ${esc(d.model_version)}</div>
    <h1>Pre-token protocols, ranked by what a launch would be worth</h1>
    <p class="sub">Every protocol DefiLlama tracks that records no token yet, ranked by an implied
    value computed from the snapshot's own figures: TVL, seven-day growth, how long it has run
    with no token, and how many chains it reaches. Each row carries the steps to farm it.</p>
    <div class="chips">
      <span class="chip"><b>${d.board_size}</b> protocols ranked</span>
      <span class="chip"><b>${d.watchlist_size}</b> on the watchlist</span>
      <span class="chip"><b>${d.early_size}</b> early finds below the floor</span>
      <span class="chip"><b>${d.live_size}</b> live tokens set aside</span>
      <span class="chip">Snapshot <b>${esc(d.as_of)}</b></span>
      <span class="chip">Watchlist floor <b>${fmtShort(d.floor_usd)}</b> TVL</span>
    </div>
  </header>`;
}

function methodHTML(d) {
  return `<section class="method" aria-label="How the value is computed">
    <h2>How the implied value is computed</h2>
    <div class="formula">implied value = TVL &times; category multiple &times; growth &times; tenure &times; breadth</div>
    <ul>
      <li><b>Category multiple:</b> the median market-cap / TVL of the snapshot's own live-token
      protocols in the same category, shrunk toward the global median (weight n / (n + 5)).
      Categories with fewer than 3 live comps use the global median. No protocol name is ever
      special-cased.</li>
      <li><b>Growth:</b> the 7-day TVL change, clamped to &minus;60%..+120%, at half weight.
      <b>Tenure:</b> 0.60 for a protocol tracked under a year with no token, rising to 1.00 after
      three years. <b>Breadth:</b> +2% per extra chain, at most +10%.</li>
      <li><b>Excluded:</b> protocols with a token, and wrapped, staked or bridged products of a
      token that already trades &mdash; they are not launches waiting to happen. The full
      comparables table is below the board.</li>
    </ul>
    <p class="small muted">Implied value is this entry's claim from the snapshot, not a prediction
    that a token will launch or what it will trade at. Not financial advice.</p>
  </section>`;
}

function comparablesHTML(d) {
  const rows = d.comparables
    .map(
      (c) =>
        `<tr><td>${esc(c.category)}</td><td class="num">${c.comps}</td><td class="num">${c.median_ratio === null ? 'n/a' : c.median_ratio.toFixed(3)}</td><td class="num">${c.multiple.toFixed(3)}</td></tr>`,
    )
    .join('');
  return `<section class="method" aria-label="Category comparables">
    <h2>Category comparables (from the snapshot's live-token protocols)</h2>
    <table class="comp"><thead><tr><th>Category</th><th class="num">Live comps</th><th class="num">Median mcap / TVL</th><th class="num">Multiple used</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="small muted">Categories with fewer than 3 live comps use the global median multiple.
    The multiple is what the market already pays for the same kind of business.</p>
  </section>`;
}

/* ------------------------------------------------------------------ board */

function boardView(d) {
  const p = params();
  const q = (p.get('q') || '').toLowerCase();
  const cat = p.get('category') || '';
  const chain = p.get('chain') || '';
  const scope = p.get('scope') || 'all';
  const sort = p.get('sort') || 'value';
  const watchlist = new Set(d.rows.filter((r) => r.on_watchlist).map((r) => r.slug));

  let rows = d.rows.filter((r) => {
    if (scope === 'watchlist' && !watchlist.has(r.slug)) return false;
    if (scope === 'early' && watchlist.has(r.slug)) return false;
    if (cat && r.category !== cat) return false;
    if (chain && !r.chains.includes(chain)) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
    return true;
  });
  const sorted = [...rows];
  if (sort === 'tvl') sorted.sort((a, b) => b.tvl_usd - a.tvl_usd);
  else if (sort === 'growth') sorted.sort((a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9));
  else if (sort === 'age') sorted.sort((a, b) => (b.age_days ?? -1) - (a.age_days ?? -1));
  else if (sort === 'name') sorted.sort((a, b) => (a.name < b.name ? -1 : 1));
  else sorted.sort((a, b) => a.rank - b.rank);

  const categories = [...new Set(d.rows.map((r) => r.category).filter(Boolean))].sort();
  const chains = [...new Set(d.rows.flatMap((r) => r.chains))].sort();

  const body = sorted
    .map(
      (r) => `<tr data-slug="${esc(r.slug)}" class="${watchlist.has(r.slug) ? 'watch' : ''}">
        <td class="rank">#${r.rank}</td>
        <td class="proto"><b>${esc(r.name)}</b><span>${esc(r.slug)}</span>${watchlist.has(r.slug) ? '<span class="tag">WATCHLIST</span>' : ''}</td>
        <td>${esc(r.category ?? '—')}</td>
        <td>${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
        <td class="num">${fmtShort(r.tvl_usd)}</td>
        <td class="num">${fmtPct(r.change_7d)}</td>
        <td class="num">${ageText(r.age_days)}</td>
        <td class="num implied">${fmtShort(r.implied_value_usd)}</td>
        <td><span class="plan-link">Farm plan &rsaquo;</span></td>
      </tr>`,
    )
    .join('');

  const active = [cat && `category ${cat}`, chain && `chain ${chain}`, q && `“${q}”`, scope !== 'all' && (scope === 'watchlist' ? 'watchlist only' : 'early finds only')]
    .filter(Boolean)
    .join(' · ');

  main.innerHTML = `<div class="wrap">${headerHTML(d)}${methodHTML(d)}
    <div class="tabs" role="tablist">
      <button class="tab" aria-selected="true">Ranked board</button>
      <button class="tab" aria-selected="false" data-tab="live">Live tokens (${d.live_size})</button>
    </div>
    <form class="controls" id="controls">
      <label>Search <input type="search" name="q" value="${esc(p.get('q') || '')}" placeholder="Name or slug"></label>
      <label>Category <select name="category"><option value="">All categories</option>${categories.map((c) => opt(c, cat, c)).join('')}</select></label>
      <label>Chain <select name="chain"><option value="">All chains</option>${chains.map((c) => opt(c, chain, c)).join('')}</select></label>
      <label>Scope <select name="scope">${opt('all', scope, 'All rows')}${opt('watchlist', scope, 'Watchlist only')}${opt('early', scope, 'Early finds only')}</select></label>
      <label>Sort by <select name="sort">${opt('value', sort, 'Implied value')}${opt('tvl', sort, 'TVL')}${opt('growth', sort, '7-day growth')}${opt('age', sort, 'Age')}${opt('name', sort, 'Name')}</select></label>
      <button class="btn" type="submit">Apply</button>
    </form>
    <p class="result-line">Showing <b>${sorted.length}</b> of ${d.board_size} ranked protocols${active ? ` &mdash; filtered by ${esc(active)}` : ''}. Click a row for its detail view and farm plan.</p>
    <table class="board"><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Implied value</th><th></th></tr></thead>
    <tbody>${body || '<tr><td colspan="9">No protocol matches this filter.</td></tr>'}</tbody></table>
    ${comparablesHTML(d)}
    <footer class="foot">Source: ${esc(d.source)}. Snapshot frozen 2026-11-14; the board reads only
    that snapshot. Model ${esc(d.model_version)}: implied = TVL &times; category multiple &times; growth
    &times; tenure &times; breadth.</footer>
  </div>`;

  document.querySelector('[data-tab="live"]').addEventListener('click', () => go('?view=live'));
  document.getElementById('controls').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const next = new URLSearchParams();
    for (const [k, v] of f.entries()) if (v) next.set(k, v);
    go('?' + next.toString());
  });
  main.querySelectorAll('tr[data-slug]').forEach((tr) =>
    tr.addEventListener('click', () => go('?view=detail&slug=' + encodeURIComponent(tr.dataset.slug))),
  );
}

/* ------------------------------------------------------------------ detail */

function detailView(d) {
  const slug = params().get('slug') || '';
  const row = d.rows.find((r) => r.slug === slug);
  if (!row) {
    main.innerHTML = `<div class="wrap"><div class="error"><h2>Protocol not found</h2>
      <p>No ranked protocol has the slug “${esc(slug)}”.</p></div>
      <p><button class="btn" data-back>Back to the board</button></p></div>`;
    document.querySelector('[data-back]').addEventListener('click', () => go('?view=board'));
    return;
  }
  const prev = d.rows.find((r) => r.rank === row.rank - 1);
  const next = d.rows.find((r) => r.rank === row.rank + 1);
  const steps = row.farm_steps
    .map((s, i) => {
      const at = s.lastIndexOf(' Cost: ');
      const head = at > 0 ? s.slice(0, at) : s;
      const tail = at > 0 ? s.slice(at + 1) : '';
      return `<li><b>Step ${i + 1}.</b> ${esc(head)}<br><span class="cost">${esc(tail)}</span></li>`;
    })
    .join('');

  main.innerHTML = `<div class="wrap">
    <div class="detail-head">
      <span class="rank-badge">Rank #${row.rank} of ${d.board_size}${row.on_watchlist ? ' &middot; Watchlist' : ' &middot; Early find'}</span>
      <h1>${esc(row.name)}</h1>
      <p class="muted">${esc(row.slug)} &middot; ${esc(row.category ?? 'Uncategorised')} &middot; ${esc(row.chains.join(', '))}</p>
    </div>
    <div class="grid">
      <div class="stat"><div class="k">Implied value</div><div class="v" style="color:var(--amber)">${fmtShort(row.implied_value_usd)}</div><div class="d">${fmtUsd(row.implied_value_usd)}</div></div>
      <div class="stat"><div class="k">TVL</div><div class="v">${fmtShort(row.tvl_usd)}</div><div class="d">${fmtUsd(row.tvl_usd)} locked</div></div>
      <div class="stat"><div class="k">7-day change</div><div class="v">${fmtPct(row.change_7d)}</div><div class="d">TVL growth, 7 days</div></div>
      <div class="stat"><div class="k">Age with no token</div><div class="v">${ageText(row.age_days)}</div><div class="d">${row.listed_at ? 'tracked since ' + esc(row.listed_at) : 'listing date unknown'}</div></div>
    </div>
    <section class="card" aria-label="Why this value">
      <h2>Why this value</h2>
      <table class="break"><tbody>
        <tr><th>TVL</th><td class="num">${fmtUsd(row.tvl_usd)}</td></tr>
        <tr><th>Category multiple (${esc(row.category ?? 'Uncategorised')})</th><td class="num">&times; ${row.category_multiple.toFixed(3)}</td></tr>
        <tr><th>Growth multiplier (7d ${row.change_7d === null ? 'n/a' : (row.change_7d > 0 ? '+' : '') + row.change_7d.toFixed(1) + '%'})</th><td class="num">&times; ${row.growth_multiplier.toFixed(4)}</td></tr>
        <tr><th>Tenure multiplier (${row.age_days === null ? 'age unknown' : row.age_days + ' days, no token'})</th><td class="num">&times; ${row.maturity_multiplier.toFixed(4)}</td></tr>
        <tr><th>Breadth multiplier (${row.chains.length} chain${row.chains.length === 1 ? '' : 's'})</th><td class="num">&times; ${row.breadth_multiplier.toFixed(4)}</td></tr>
        <tr><th>Implied value</th><td class="num">${fmtUsd(row.implied_value_usd)}</td></tr>
      </tbody></table>
      <p class="small muted">The multiple is the median market-cap / TVL of live-token protocols in
      this category, shrunk toward the global median. The token does not exist yet: this is the
      value a launch at the category's going rate would imply, from the snapshot alone.</p>
    </section>
    <section class="card" aria-label="Farm plan">
      <h2>Farm plan: ${esc(row.name)}</h2>
      <ol class="steps">${steps}</ol>
    </section>
    <div class="navrow">
      <span>${prev ? `<button class="btn ghost" data-prev>&larr; #${prev.rank} ${esc(prev.name)}</button>` : ''}</span>
      <span><button class="btn ghost" data-back>Back to the board</button></span>
      <span>${next ? `<button class="btn ghost" data-next>#${next.rank} ${esc(next.name)} &rarr;</button>` : ''}</span>
    </div>
    <footer class="foot">Model ${esc(d.model_version)} &middot; snapshot ${esc(d.as_of)} &middot;
    implied value is this entry's claim, not a prediction of a launch. Not financial advice.</footer>
  </div>`;

  document.querySelector('[data-back]').addEventListener('click', () => go('?view=board'));
  const pv = document.querySelector('[data-prev]');
  if (pv) pv.addEventListener('click', () => go('?view=detail&slug=' + encodeURIComponent(prev.slug)));
  const nx = document.querySelector('[data-next]');
  if (nx) nx.addEventListener('click', () => go('?view=detail&slug=' + encodeURIComponent(next.slug)));
}

/* ------------------------------------------------------------------ live */

function liveView(d) {
  const body = d.live
    .map(
      (r) => `<tr>
        <td class="proto"><b>${esc(r.name)}</b><span>${esc(r.slug)}</span></td>
        <td>${esc(r.category ?? '—')}</td>
        <td>${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
        <td class="num">${fmtShort(r.tvl_usd)}</td>
        <td class="num"><b>${r.mcap_usd === null ? 'n/a' : fmtShort(r.mcap_usd)}</b></td>
        <td class="num">${fmtPct(r.change_7d)}</td>
      </tr>`,
    )
    .join('');
  main.innerHTML = `<div class="wrap">${headerHTML(d)}
    <div class="tabs" role="tablist">
      <button class="tab" aria-selected="false" data-tab="board">Ranked board</button>
      <button class="tab" aria-selected="true">Live tokens (${d.live_size})</button>
    </div>
    <section class="method" aria-label="Why these are separate">
      <h2>Already trading &mdash; shown, not ranked</h2>
      <p>These protocols already have a token that trades, so the market has priced them: the
      table shows their actual market cap, not a model. They are kept apart from the ranked board
      on purpose &mdash; a launch radar ranks what does not exist yet. Their market-cap / TVL ratios
      are also the comparables the ranked board's category multiples are computed from.</p>
    </section>
    <table class="board"><thead><tr><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">7d</th></tr></thead>
    <tbody>${body}</tbody></table>
    <footer class="foot">Top ${d.live_size} live-token protocols by market cap, from the same
    ${esc(d.as_of)} snapshot. Source: ${esc(d.source)}.</footer>
  </div>`;
  document.querySelector('[data-tab="board"]').addEventListener('click', () => go('?view=board'));
}

/* ------------------------------------------------------------------ boot */

(function boot() {
  const d = window.RADAR;
  if (!d || !Array.isArray(d.rows)) {
    main.innerHTML = `<div class="wrap"><div class="error"><h2>No data</h2>
      <p>The dashboard could not load its data. The program writes data.js beside this page.</p></div></div>`;
    return;
  }
  main.removeAttribute('aria-busy');
  const view = params().get('view') || 'board';
  if (view === 'detail') detailView(d);
  else if (view === 'live') liveView(d);
  else boardView(d);
})();
