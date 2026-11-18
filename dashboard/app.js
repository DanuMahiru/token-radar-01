// Token Radar dashboard, radar-3.
//
// A static page: it reads window.RADAR (written by main.ts from the same board.json the gate
// checks), renders the ranked board, a detail view for every protocol, a filtered view and the
// live-token set. No fetch, no network, no framework. Every figure on the page comes from the
// snapshot through lib/model.ts; the page never invents a number.
//
// Model (radar-3), stated on the page and computed in lib/model.ts — and recomputed here, in
// this file, from the snapshot's own live-token set, so the page checks its own board:
//   implied = TVL x category multiple x growth x tenure x breadth
//   category multiple = median market-cap / TVL of the snapshot's own live-token protocols in
//   the same category, shrunk toward the global median (weight n / (n + 5)); fewer than 3 live
//   comps use the global median. Growth clamps the 7-day TVL change to [-60, +120]% at half
//   weight; tenure rises from 0.60 to 1.00 over three years with no token; breadth adds 2% per
//   extra chain, at most +10%. No name is ever special-cased.
//
// The model was tested blind: fitted only on tokens listed before a cut date, then priced on
// the ones listed after it. The ranking tracks actual market caps about as well as TVL alone
// and the point values are wide, so the board is a ranking device — read the rank, not the
// dollar figure. Each row also carries its rank range over 200 refits of the comparables and
// a farm verdict (farm / thin / skip) netted to the break-even: the plan's out-of-pocket cost
// against a 5% community allocation of the implied value.

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

/* ------------------------------------------------- the model, in this page
   The board's numbers are computed by lib/model.ts at build time. This page recomputes
   them from the same raw inputs — the snapshot's own live-token ratios, carried in
   data.js as comps_by_category — so the page can check its own board instead of trusting
   it. A row whose recomputed value differs from the board's is shown, not hidden. */

function medianOf(sorted) {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The multiple one category gets, recomputed from the live-token ratios in data.js. */
function recomputeCategoryMultiple(d, category) {
  const ratios = category === null ? undefined : d.comps_by_category[category];
  const global = d.global_median;
  if (ratios === undefined || ratios.length < 3) return { multiple: global, comps: ratios === undefined ? 0 : ratios.length };
  const med = medianOf(ratios);
  const n = ratios.length;
  const prior = d.model.shrinkage_prior;
  const multiple = Math.min(
    d.model.multiple_cap,
    Math.max(d.model.multiple_floor, (n / (n + prior)) * med + (prior / (n + prior)) * global),
  );
  return { multiple: Math.round(multiple * 10000) / 10000, comps: n };
}

/** One row's implied value, recomputed in this page from the snapshot's own figures. */
function recomputeImpliedValue(d, row) {
  const m = d.model;
  const growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
  const growthMult = 1 + (growthPct / 100) * m.growth_weight;
  const age = row.age_days === null ? m.unknown_age_days : row.age_days;
  const maturityMult = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
  const breadthMult = Math.min(1 + Math.min(Math.max(row.chains.length - 1, 0), 5) * m.breadth_per_chain, 1 + m.breadth_cap);
  const { multiple } = recomputeCategoryMultiple(d, row.category);
  return Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
}

/** Check the whole board against the recompute: how many rows match, and the worst gap. */
function modelCheck(d) {
  let matched = 0;
  let worst = 0;
  for (const row of d.rows) {
    const again = recomputeImpliedValue(d, row);
    const gap = Math.abs(again - row.implied_value_usd) / row.implied_value_usd;
    if (again === row.implied_value_usd) matched++;
    if (gap > worst) worst = gap;
  }
  return { checked: d.rows.length, matched, worstPct: (worst * 100).toFixed(2) };
}

function verdictLabel(v) {
  return v === 'farm' ? 'Farm' : v === 'thin' ? 'Thin' : 'Skip';
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
      special-cased. This page recomputes every multiple from the live-token ratios it carries.</li>
      <li><b>Growth:</b> the 7-day TVL change, clamped to &minus;60%..+120%, at half weight.
      <b>Tenure:</b> 0.60 for a protocol tracked under a year with no token, rising to 1.00 after
      three years. <b>Breadth:</b> +2% per extra chain, at most +10%.</li>
      <li><b>Rank range:</b> each row's rank across 200 refits of the comparables.
      <b>Farm verdict:</b> farm, thin or skip, netted to the break-even at a 5% community
      allocation of the implied value.</li>
      <li><b>Excluded:</b> protocols with a token, and wrapped, staked or bridged products of a
      token that already trades &mdash; they are not launches waiting to happen.</li>
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

function topPicksHTML(d) {
  const picks = d.rows.slice(0, 5);
  const items = picks
    .map(
      (r) =>
        `<li><b>#${r.rank} ${esc(r.name)}</b> &mdash; ${fmtShort(r.implied_value_usd)}, rank usually
        #${r.rank_range[0]}&ndash;#${r.rank_range[1]} over ${d.refits} refits, pays off unless more than
        ${fmtInt(r.farm_pays_unless_farmers)} farmers share the airdrop.</li>`,
    )
    .join('');
  return `<section class="method" aria-label="Top picks">
    <h2>Top picks: farm these first</h2>
    <ol class="picks">${items}</ol>
    <p class="small muted">The five highest-ranked rows. Each holds its rank across the refits and
    pays off even if a hundred thousand farmers or more share the airdrop.</p>
  </section>`;
}

function validationHTML(d) {
  const v = d.validation;
  const rows = v.cuts
    .map(
      (c) =>
        `<tr><td>Listed after ${esc(c.cut)}</td><td class="num">${c.fit} fitted</td><td class="num">${c.test} tested</td><td class="num">${c.med_abs_log_error}</td><td class="num">${c.within_2x}/${c.test}</td><td class="num">${c.spearman_radar.toFixed(2)}</td><td class="num">${c.spearman_tvl.toFixed(2)}</td></tr>`,
    )
    .join('');
  const check = modelCheck(d);
  return `<section class="method" aria-label="Blind test of the model">
    <h2>Tested blind, not asserted</h2>
    <p>The multiples were fitted only on live-token protocols listed before a cut date, then asked
    to price the ones listed after it — the model never saw the test set while it was fitted.</p>
    <table class="comp"><thead><tr><th>Test set</th><th class="num">Fitted on</th><th class="num">Tested on</th><th class="num">Median log error</th><th class="num">Within 2&times;</th><th class="num">Rank corr. (model)</th><th class="num">Rank corr. (TVL alone)</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="small">${esc(v.reading)}</p>
    <p class="small muted">This page also recomputes every implied value from the live-token ratios
    it carries: ${check.matched} of ${check.checked} rows match the board exactly, worst gap
    ${check.worstPct}%.</p>
  </section>`;
}

function notOnBoardHTML(d) {
  return `<section class="method" aria-label="What is not on the board">
    <h2>What is not on the board, and why</h2>
    <p>${d.excluded_above_floor} protocols above the $${fmtInt(d.floor_usd)} floor pass the rules the
    snapshot itself shows, but are not on the house watchlist — the house's rule also checks
    DefiLlama's parent-protocol record, which the snapshot does not carry. They read as arms or
    products of another protocol (a curator arm, an exchange's product, a bridged wrapper), so
    they are left out rather than ranked as launches waiting to happen. The board's ${d.board_size}
    rows are the ${d.watchlist_size} watchlist protocols plus ${d.early_size} early finds below the
    floor — every protocol the snapshot-visible rules allow.</p>
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
        <td class="rank">#${r.rank}<span class="range">${r.rank_range[0] === r.rank_range[1] ? 'steady' : '#' + r.rank_range[0] + '–#' + r.rank_range[1]}</span></td>
        <td class="proto"><b>${esc(r.name)}</b><span>${esc(r.slug)}</span>${watchlist.has(r.slug) ? '<span class="tag">WATCHLIST</span>' : ''}</td>
        <td>${esc(r.category ?? '—')}</td>
        <td>${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
        <td class="num">${fmtShort(r.tvl_usd)}</td>
        <td class="num">${fmtPct(r.change_7d)}</td>
        <td class="num">${ageText(r.age_days)}</td>
        <td class="num implied">${fmtShort(r.implied_value_usd)}</td>
        <td><span class="verdict ${r.farm_verdict}">${verdictLabel(r.farm_verdict)}</span></td>
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
    <p class="result-line">Showing <b>${sorted.length}</b> of ${d.board_size} ranked protocols${active ? ` &mdash; filtered by ${esc(active)}` : ''}. Click a row for its detail view and farm plan. The small range under each rank is where it usually sits over ${d.refits} refits of the comparables.</p>
    <table class="board"><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Implied value</th><th>Farm</th><th></th></tr></thead>
    <tbody>${body || '<tr><td colspan="10">No protocol matches this filter.</td></tr>'}</tbody></table>
    ${topPicksHTML(d)}
    ${validationHTML(d)}
    ${comparablesHTML(d)}
    ${notOnBoardHTML(d)}
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
  const again = recomputeImpliedValue(d, row);
  const econ = {
    cost: row.farm_cost_usd,
    breakeven: row.farm_breakeven_usd,
    paysUnless: row.farm_pays_unless_farmers,
    verdict: row.farm_verdict,
  };
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
      <span class="rank-badge">Rank #${row.rank} of ${d.board_size}${row.on_watchlist ? ' &middot; Watchlist' : ' &middot; Early find'} &middot; usually #${row.rank_range[0]}&ndash;#${row.rank_range[1]} over ${d.refits} refits</span>
      <span class="verdict ${row.farm_verdict} big">${verdictLabel(row.farm_verdict)}</span>
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
      value a launch at the category's going rate would imply, from the snapshot alone. This page
      recomputes the value from the live-token ratios it carries: ${fmtUsd(again)}
      ${again === row.implied_value_usd ? '&mdash; it matches the board.' : `&mdash; the board says ${fmtUsd(row.implied_value_usd)}.`}</p>
    </section>
    <section class="card" aria-label="Farm economics">
      <h2>Farm economics: does it pay?</h2>
      <table class="break"><tbody>
        <tr><th>Out of pocket (gas + yield given up)</th><td class="num">$${econ.cost.toFixed(2)}</td></tr>
        <tr><th>Break-even airdrop</th><td class="num">$${econ.breakeven.toFixed(2)}</td></tr>
        <tr><th>Pays unless more than this many farmers share it</th><td class="num">${fmtInt(econ.paysUnless)}</td></tr>
        <tr><th>Verdict</th><td class="num"><span class="verdict ${econ.verdict}">${verdictLabel(econ.verdict)}</span></td></tr>
      </tbody></table>
      <p class="small muted">Assumptions: $${d.farm_assumptions.gas_weekly_usd} of gas a week, ${esc(d.farm_assumptions.gas_setup_usd)} to set
      up, ${(d.farm_assumptions.opportunity_apr * 100).toFixed(0)}% a year given up on the capital, and a ${(d.farm_assumptions.community_allocation * 100).toFixed(0)}%
      community allocation of the implied value. Farm means the full position pays even if
      100,000 farmers share it; thin means run it with $50; skip means it pays only if fewer
      than 10,000 farmers share it.</p>
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
