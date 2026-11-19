// Token Radar dashboard, radar-4.
//
// A static page: it reads window.RADAR (written by main.ts from the same board.json the gate
// checks), renders the ranked board, a detail view for every protocol, a filtered view and the
// live-token set. No fetch, no network, no framework. Every figure on the page comes from the
// snapshot through lib/model.ts; the page never invents a number.
//
// Model (radar-4), stated on the page and computed in lib/model.ts — and recomputed here, in
// this file, from the snapshot's own live-token set, so the page checks its own board:
//   implied = TVL x size-curve multiple x growth x tenure x breadth
//   size-curve multiple = exp(a + b log TVL) / TVL, clamped to [0.02, 1.50], where
//   log(mcap) = a + b log(TVL) is fitted by least squares on the snapshot's own live-token
//   protocols in the same category. A category's slope is shrunk toward the global slope
//   (weight n / (n + 40)) and the line re-centred on the category's centroid; categories with
//   fewer than 5 live comps use the global curve. Growth clamps the 7-day TVL change to
//   [-60, +120]% at half weight; tenure rises from 0.60 to 1.00 over three years with no
//   token; breadth adds 2% per extra chain, at most +10%. No name is ever special-cased.
//
//   The market pays less per TVL as a protocol gets bigger (the global slope is about 0.47),
//   which is why a flat multiple overprices the giants and a median ratio misses the size
//   effect. The curve was tested blind: fitted only on tokens listed before a cut date, then
//   priced on the ones listed after it, against five other multiple estimators on three cuts
//   and leave-one-out. The ranking tracks actual market caps about as well as TVL alone and
//   the point values are wide, so the board is a ranking device — read the rank, not the
//   dollar figure. Each row also carries its rank range over 200 refits of the curves and a
//   farm verdict (farm / thin / skip) netted to the break-even: the plan's out-of-pocket cost
//   against a 5% community allocation of the implied value.

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
   The board's numbers are computed by lib/model.ts at build time. This page refits the size
   curves from the sufficient statistics data.js carries (n, and the sums of log TVL, log
   mcap, their product and log TVL squared, per category and global) — least squares needs
   nothing else — and recomputes every multiple and implied value from its own refit, so the
   page can check its own board instead of trusting it. A row whose recomputed value differs
   from the board's is shown, not hidden. */

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/** One size curve refitted from sufficient statistics: slope, intercept, centroid. */
function refitCurve(stats) {
  const n = stats.n;
  const mx = stats.sx / n;
  const my = stats.sy / n;
  const sxx = stats.sxx - (stats.sx * stats.sx) / n;
  const sxy = stats.sxy - (stats.sx * stats.sy) / n;
  const slope = sxx === 0 ? 1 : sxy / sxx;
  return { slope, intercept: my - slope * mx, mx, my };
}

/** The curve one category gets, refitted here: its own shrunk slope, or the global curve. */
function recomputeCurve(d, category) {
  const globalStats = d.global_fit_stats;
  const global = refitCurve(globalStats);
  const gSlope = round4(global.slope);
  const gIntercept = round4(global.intercept);
  const stats = (d.curve_fit_stats || []).find((s) => s.category === category);
  if (!stats || stats.n < d.model.loglog_min_comps) return { slope: gSlope, intercept: gIntercept, comps: stats ? stats.n : 0, global: true };
  const fit = refitCurve(stats);
  const prior = d.model.loglog_slope_prior;
  const slope = round4((stats.n / (stats.n + prior)) * fit.slope + (prior / (stats.n + prior)) * global.slope);
  const intercept = round4(fit.my - slope * fit.mx);
  return { slope, intercept, comps: stats.n, global: false };
}

/** The multiple one row gets, recomputed from the refitted curve at its own TVL. */
function recomputeCurveMultiple(d, row) {
  const curve = recomputeCurve(d, row.category);
  const raw = Math.exp(curve.intercept + curve.slope * Math.log(row.tvl_usd)) / row.tvl_usd;
  const multiple = Math.min(d.model.multiple_cap, Math.max(d.model.multiple_floor, raw));
  return { multiple: round4(multiple), comps: curve.comps, slope: curve.slope, intercept: curve.intercept };
}

/** One row's implied value, recomputed in this page from the snapshot's own figures. */
function recomputeImpliedValue(d, row) {
  const m = d.model;
  const growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
  const growthMult = 1 + (growthPct / 100) * m.growth_weight;
  const age = row.age_days === null ? m.unknown_age_days : row.age_days;
  const maturityMult = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
  const breadthMult = Math.min(1 + Math.min(Math.max(row.chains.length - 1, 0), 5) * m.breadth_per_chain, 1 + m.breadth_cap);
  const { multiple } = recomputeCurveMultiple(d, row);
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

/** Check the stored curves against this page's own refit: how many agree to 4 decimals. */
function curveCheck(d) {
  let matched = 0;
  let total = 0;
  for (const c of d.size_curves || []) {
    total++;
    const again = recomputeCurve(d, c.category);
    if (again.slope === c.slope && again.intercept === c.intercept) matched++;
  }
  return { total, matched };
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

function kpiHTML(d) {
  const k = d.kpis;
  return `<section class="kpis" aria-label="Headline numbers">
    <div class="stat"><div class="k">Ranked</div><div class="v">${k.ranked}</div><div class="d">${k.watchlist} watchlist + ${k.early} early</div></div>
    <div class="stat"><div class="k">Live tokens in snapshot</div><div class="v">${k.live_total}</div><div class="d">of ${d.inventory.total} protocols seen</div></div>
    <div class="stat"><div class="k">Top implied value</div><div class="v">${fmtShort(k.top_implied_usd)}</div><div class="d">median curve multiple ${k.median_curve_multiple}</div></div>
    <div class="stat"><div class="k">Farm verdicts</div><div class="v">${k.farm} / ${k.thin} / ${k.skip}</div><div class="d">farm / thin / skip</div></div>
    <div class="stat"><div class="k">Blind-test median error</div><div class="v">${k.blind_med_err}</div><div class="d">log error, latest cut &middot; ${k.refits} refits</div></div>
  </section>`;
}

function methodHTML(d) {
  return `<section class="method" aria-label="How the value is computed">
    <h2>How the implied value is computed</h2>
    <div class="formula">implied value = TVL &times; size-curve multiple &times; growth &times; tenure &times; breadth</div>
    <ul>
      <li><b>Size-curve multiple:</b> the market pays less per TVL as a protocol gets bigger, so
      the multiple is not a flat ratio but a curve: log(mcap) = a + b &times; log(TVL), fitted by
      least squares on the snapshot's own live-token protocols in the same category. A
      category's slope is shrunk toward the global slope (weight n / (n + ${d.model.loglog_slope_prior}))
      and the line re-centred on the category's centroid; categories with fewer than
      ${d.model.loglog_min_comps} live comps use the global curve (slope ${d.global_curve.slope}).
      The multiple is then exp(a + b log TVL) / TVL at the protocol's own TVL, clamped to
      ${d.model.multiple_floor}&ndash;${d.model.multiple_cap}. No protocol name is ever special-cased.
      This page refits every curve from the sufficient statistics it carries and recomputes
      every multiple from its own refit.</li>
      <li><b>Growth:</b> the 7-day TVL change, clamped to &minus;60%..+120%, at half weight.
      <b>Tenure:</b> 0.60 for a protocol tracked under a year with no token, rising to 1.00 after
      three years. <b>Breadth:</b> +2% per extra chain, at most +10%.</li>
      <li><b>Rank range:</b> each row's rank across ${d.refits} refits of the curves.
      <b>Farm verdict:</b> farm, thin or skip, netted to the break-even at a 5% community
      allocation of the implied value.</li>
      <li><b>Excluded:</b> protocols with a token, and wrapped, staked or bridged products of a
      token that already trades &mdash; they are not launches waiting to happen. The Coverage
      view accounts for all ${d.inventory.total} protocols in the snapshot.</li>
    </ul>
    <p class="small muted">Implied value is this entry's claim from the snapshot, not a prediction
    that a token will launch or what it will trade at. Not financial advice.</p>
  </section>`;
}

function comparablesHTML(d) {
  const rows = d.comparables
    .map((c) => {
      const at100m = Math.min(
        d.model.multiple_cap,
        Math.max(d.model.multiple_floor, Math.exp(c.curve_intercept + c.curve_slope * Math.log(100_000_000)) / 100_000_000),
      );
      return `<tr><td>${esc(c.category)}</td><td class="num">${c.comps}</td><td class="num">${c.median_ratio === null ? 'n/a' : c.median_ratio.toFixed(3)}</td><td class="num">${c.curve_slope.toFixed(4)}</td><td class="num">log mcap = ${c.curve_intercept} + ${c.curve_slope} log TVL</td><td class="num">${at100m.toFixed(3)}</td></tr>`;
    })
    .join('');
  return `<section class="method" aria-label="Category comparables">
    <h2>Category comparables (from the snapshot's live-token protocols)</h2>
    <table class="comp"><thead><tr><th>Category</th><th class="num">Live comps</th><th class="num">Median mcap / TVL</th><th class="num">Curve slope</th><th>Size curve</th><th class="num">Multiple at $100M TVL</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="small muted">The slope is the size curve's: how fast market cap grows with TVL in
    that category. A slope under 1 means the market pays less per TVL as protocols get bigger.
    The last column is what the curve pays at a $100M TVL — each row's own multiple comes from
    its curve at its own TVL, so a giant and a minnow in the same category get different
    multiples. Categories with fewer than ${d.model.loglog_min_comps} live comps use the global
    curve (slope ${d.global_curve.slope}).</p>
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
    <p class="small muted">The five highest-ranked rows. The top three hold their rank across the
    refits and pay off even if more than 100,000 farmers share the airdrop; the next two are
    close behind on both counts — Bittensor dTAO's rank swings widely because its category's
    size curve is steep.</p>
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
  const raceRows = v.horse_race
    .map((h) => {
      const cells = h.cuts.map((c) => `<td class="num">${c.med_abs_log_error} (${c.spearman.toFixed(2)})</td>`).join('');
      return `<tr><td>${esc(h.estimator.replaceAll('_', ' '))}</td>${cells}<td class="num">${h.loo_med_abs_log_error} (${h.loo_spearman.toFixed(2)})</td></tr>`;
    })
    .join('');
  const ablRows = v.ablation
    .map((a) => {
      const cells = a.cuts.map((c) => `<td class="num">${c.med_abs_log_error} (${c.spearman.toFixed(2)})</td>`).join('');
      return `<tr><td>${esc(a.variant.replaceAll('_', ' '))}</td>${cells}</tr>`;
    })
    .join('');
  const check = modelCheck(d);
  const cc = curveCheck(d);
  return `<section class="method" aria-label="Blind test of the model">
    <h2>Tested blind, not asserted</h2>
    <p>The curves were fitted only on live-token protocols listed before a cut date, then asked
    to price the ones listed after it — the model never saw the test set while it was fitted.</p>
    <table class="comp"><thead><tr><th>Test set</th><th class="num">Fitted on</th><th class="num">Tested on</th><th class="num">Median log error</th><th class="num">Within 2&times;</th><th class="num">Rank corr. (model)</th><th class="num">Rank corr. (TVL alone)</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="small">${esc(v.reading)}</p>
    <h3>Horse race: six ways to turn TVL into a multiple, same test sets</h3>
    <table class="comp"><thead><tr><th>Estimator</th><th class="num">2022 cut (error / rank corr.)</th><th class="num">2023 cut</th><th class="num">2024 cut</th><th class="num">Leave-one-out</th></tr></thead>
    <tbody>${raceRows}</tbody></table>
    <p class="small">Every estimator gets the same growth, tenure and breadth terms, so the
    comparison isolates the multiple. The size curve wins on point values on every cut and on
    leave-one-out; the ranking tracks actual market caps about as well as TVL alone for all
    of them.</p>
    <h3>Leave-one-out</h3>
    <p class="small">Fitted on all ${v.loo.n} dated live-token protocols but one, asked to price
    the held-out one: median log error ${v.loo.med_abs_log_error}, ${v.loo.within_2x} of ${v.loo.n}
    within 2&times;, rank correlation ${v.loo.spearman_radar.toFixed(2)} (TVL alone
    ${v.loo.spearman_tvl.toFixed(2)}, flat 0.25 ${v.loo.spearman_flat.toFixed(2)}).</p>
    <h3>Ablation: what the growth, tenure and breadth terms add</h3>
    <table class="comp"><thead><tr><th>Variant</th><th class="num">2022 cut</th><th class="num">2023 cut</th><th class="num">2024 cut</th></tr></thead>
    <tbody>${ablRows}</tbody></table>
    <p class="small">The three terms are near-neutral on the blind test — within noise of the
    multiple alone on every cut. They stay in the model because they are economically motivated
    (a growing, older, wider protocol is worth more at the same TVL), not because they win the
    horse race.</p>
    <p class="small muted">This page also refits every size curve from the sufficient statistics
    it carries and recomputes every implied value from its own refit: ${check.matched} of
    ${check.checked} rows match the board exactly, worst gap ${check.worstPct}%; ${cc.matched} of
    ${cc.total} stored curves match the page's refit to 4 decimals.</p>
  </section>`;
}

function notOnBoardHTML(d) {
  const inv = d.inventory;
  return `<section class="method" aria-label="What is not on the board">
    <h2>What is not on the board, and why</h2>
    <p>The board's ${d.board_size} rows are the ${d.watchlist_size} watchlist protocols plus
    ${d.early_size} early finds below the floor — every protocol the snapshot-visible rules
    allow. The Coverage view accounts for all ${inv.total} protocols in the snapshot:
    ${inv.ranked} ranked, ${inv.live} already live with a token, and the rest left out by
    reason. ${d.excluded_above_floor} protocols above the $${fmtInt(d.floor_usd)} floor pass
    the rules the snapshot itself shows but are not on the house watchlist — the house's rule
    also checks DefiLlama's parent-protocol record, which the snapshot does not carry, so
    they are left out rather than ranked as launches waiting to happen.</p>
  </section>`;
}

/* ------------------------------------------------------------------ coverage */

function coverageView(d) {
  const inv = d.inventory;
  const rows = inv.dispositions
    .map(
      (x) =>
        `<tr><td>${esc(x.reason)}</td><td class="num">${x.count}</td><td><details><summary>${x.count} slug${x.count === 1 ? '' : 's'}</summary><span class="sluglist">${x.slugs.map(esc).join(', ')}</span></details></td></tr>`,
    )
    .join('');
  main.innerHTML = `<div class="wrap">${headerHTML(d)}
    ${tabsHTML(d, 'coverage')}
    <section class="method" aria-label="Coverage of the snapshot">
      <h2>Coverage: all ${inv.total} protocols in the snapshot, accounted for</h2>
      <p>Nothing is dropped silently. Every protocol in the snapshot is either ranked, already
      live with a token, or left out for a stated reason. The rows below sum to ${inv.total}.</p>
      <table class="comp"><thead><tr><th>Disposition</th><th class="num">Count</th><th>Protocols</th></tr></thead>
      <tbody>
        <tr><td><b>Ranked on the board</b></td><td class="num"><b>${inv.ranked}</b></td><td>${d.watchlist_size} watchlist + ${d.early_size} early finds</td></tr>
        ${rows}
      </tbody></table>
      <p class="small muted">Live-token protocols are the comparables: their market-cap / TVL
      ratios fit the size curves the board is priced on. CEX rows are exchanges, not DeFi
      protocols. "Not rankable" means the snapshot carries no usable TVL for them.</p>
    </section>
    <footer class="foot">Snapshot ${esc(d.as_of)} &middot; ${inv.total} protocols &middot;
    source: ${esc(d.source)}.</footer>
  </div>`;
  wireTabs(d);
}

/* ------------------------------------------------------------------ sandbox */

function sandboxView(d) {
  const p = params();
  const slug = p.get('slug') || d.rows[0].slug;
  const row = d.rows.find((r) => r.slug === slug) || d.rows[0];
  const growth = Number(p.get('growth') ?? row.change_7d ?? 0);
  const tvlFactor = Number(p.get('tvlx') ?? 1);
  const age = Number(p.get('age') ?? row.age_days ?? d.model.unknown_age_days);
  const chains = Number(p.get('chains') ?? row.chains.length);
  const m = d.model;
  const growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, growth));
  const growthMult = 1 + (growthPct / 100) * m.growth_weight;
  const maturityMult = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
  const breadthMult = Math.min(1 + Math.min(Math.max(chains - 1, 0), 5) * m.breadth_per_chain, 1 + m.breadth_cap);
  const tvl = Math.max(1, Math.round(row.tvl_usd * tvlFactor));
  const { multiple, slope, intercept } = recomputeCurveMultiple(d, { ...row, tvl_usd: tvl });
  const implied = Math.max(1, Math.round(tvl * multiple * growthMult * maturityMult * breadthMult));
  const rank = d.rows.filter((r) => r.implied_value_usd > implied).length + 1;
  const options = d.rows.map((r) => opt(r.slug, row.slug, `#${r.rank} ${r.name}`)).join('');
  main.innerHTML = `<div class="wrap">${headerHTML(d)}
    ${tabsHTML(d, 'sandbox')}
    <section class="method" aria-label="Sandbox">
      <h2>Sandbox: what if this protocol changes?</h2>
      <p>Take a ranked protocol and change its inputs. The value is recomputed with the same
      size curve and the same growth, tenure and breadth terms as the board — the curve does
      not move, only the protocol does.</p>
      <form class="controls" id="sandbox">
        <label>Protocol <select name="slug">${options}</select></label>
        <label>TVL &times; <input type="number" name="tvlx" step="0.1" min="0.1" max="10" value="${tvlFactor}"></label>
        <label>7-day growth % <input type="number" name="growth" step="1" min="-60" max="120" value="${growth}"></label>
        <label>Age, days <input type="number" name="age" step="30" min="0" max="3650" value="${age}"></label>
        <label>Chains <input type="number" name="chains" step="1" min="1" max="12" value="${chains}"></label>
        <button class="btn" type="submit">Recompute</button>
      </form>
      <table class="break"><tbody>
        <tr><th>TVL used</th><td class="num">${fmtUsd(tvl)}</td></tr>
        <tr><th>Size curve (${esc(row.category ?? 'Uncategorised')})</th><td class="num">log mcap = ${intercept} + ${slope} log TVL</td></tr>
        <tr><th>Multiple at that TVL</th><td class="num">&times; ${multiple.toFixed(4)}</td></tr>
        <tr><th>Growth &times; tenure &times; breadth</th><td class="num">&times; ${growthMult.toFixed(4)} &times; ${maturityMult.toFixed(4)} &times; ${breadthMult.toFixed(4)}</td></tr>
        <tr><th>Implied value</th><td class="num">${fmtUsd(implied)}</td></tr>
        <tr><th>Where that would rank</th><td class="num">#${rank} of ${d.board_size} (board value ${fmtShort(row.implied_value_usd)}, rank #${row.rank})</td></tr>
      </tbody></table>
      <p class="small muted">A protocol that doubles its TVL does not double its implied value:
      the size curve pays less per TVL as it grows. The sandbox shows the curve's bite.</p>
    </section>
    <footer class="foot">Sandbox recomputes with model ${esc(d.model_version)} from the same
    ${esc(d.as_of)} snapshot. Not financial advice.</footer>
  </div>`;
  wireTabs(d);
  document.getElementById('sandbox').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const next = new URLSearchParams({ view: 'sandbox' });
    for (const [k, v] of f.entries()) if (v !== '') next.set(k, v);
    go('?' + next.toString());
  });
}

/* ------------------------------------------------------------------ compare */

function compareView(d) {
  const p = params();
  const picked = (p.get('slugs') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);
  const chosen = picked.length > 0 ? picked : d.rows.slice(0, 3).map((r) => r.slug);
  const rows = chosen.map((s) => d.rows.find((r) => r.slug === s)).filter(Boolean);
  const options = d.rows.map((r) => `<option value="${esc(r.slug)}" ${chosen.includes(r.slug) ? 'selected' : ''}>#${r.rank} ${esc(r.name)}</option>`).join('');
  const head = rows.map((r) => `<th class="num">#${r.rank} ${esc(r.name)}</th>`).join('');
  const line = (label, fn) => `<tr><th>${label}</th>${rows.map((r) => `<td class="num">${fn(r)}</td>`).join('')}</tr>`;
  main.innerHTML = `<div class="wrap">${headerHTML(d)}
    ${tabsHTML(d, 'compare')}
    <section class="method" aria-label="Compare protocols">
      <h2>Compare up to four protocols, side by side</h2>
      <form class="controls" id="compare">
        <label>Protocols <select name="slugs" multiple size="4">${options}</select></label>
        <button class="btn" type="submit">Compare</button>
      </form>
      <table class="comp"><thead><tr><th></th>${head}</tr></thead><tbody>
        ${line('Implied value', (r) => fmtShort(r.implied_value_usd))}
        ${line('TVL', (r) => fmtShort(r.tvl_usd))}
        ${line('Size-curve multiple', (r) => '&times; ' + r.category_multiple.toFixed(4))}
        ${line('Curve', (r) => `log mcap = ${r.curve_intercept} + ${r.curve_slope} log TVL`)}
        ${line('7-day growth', (r) => (r.change_7d === null ? 'n/a' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'))}
        ${line('Age', (r) => ageText(r.age_days))}
        ${line('Chains', (r) => String(r.chains.length))}
        ${line('Rank range over refits', (r) => '#' + r.rank_range[0] + '–#' + r.rank_range[1])}
        ${line('Farm verdict', (r) => verdictLabel(r.farm_verdict))}
        ${line('Farm cost', (r) => '$' + r.farm_cost_usd.toFixed(2))}
        ${line('Break-even airdrop', (r) => '$' + r.farm_breakeven_usd.toFixed(2))}
        ${line('Pays unless more than', (r) => fmtInt(r.farm_pays_unless_farmers) + ' farmers')}
      </tbody></table>
      <p class="small muted">Hold Ctrl (or Cmd on a Mac) to pick more than one protocol in the
      list. The same row can look cheap on TVL and dear on its curve — that is the size effect.</p>
    </section>
    <footer class="foot">Model ${esc(d.model_version)} &middot; snapshot ${esc(d.as_of)}.</footer>
  </div>`;
  wireTabs(d);
  document.getElementById('compare').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const sel = f.getAll('slugs');
    const next = new URLSearchParams({ view: 'compare' });
    if (sel.length > 0) next.set('slugs', sel.join(','));
    go('?' + next.toString());
  });
}

/* ------------------------------------------------------------------ export */

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportCSV(d) {
  const head = 'rank,slug,name,category,chains,tvl_usd,change_7d,age_days,implied_value_usd,curve_multiple,farm_verdict,farm_cost_usd,farm_breakeven_usd';
  const lines = d.rows.map((r) =>
    [r.rank, r.slug, '"' + r.name.replaceAll('"', '""') + '"', '"' + (r.category ?? '').replaceAll('"', '""') + '"', '"' + r.chains.join(';') + '"', r.tvl_usd, r.change_7d ?? '', r.age_days ?? '', r.implied_value_usd, r.category_multiple, r.farm_verdict, r.farm_cost_usd, r.farm_breakeven_usd].join(','),
  );
  download('token-radar-board.csv', head + '\n' + lines.join('\n') + '\n', 'text/csv');
}

function exportJSON(d) {
  download('token-radar-board.json', JSON.stringify({ as_of: d.as_of, model_version: d.model_version, rows: d.rows }, null, 2) + '\n', 'application/json');
}

/* ------------------------------------------------------------------ tabs */

function tabsHTML(d, active) {
  const tab = (view, label) => `<button class="tab" aria-selected="${active === view}" data-tab="${view}">${label}</button>`;
  return `<div class="tabs" role="tablist">
    ${tab('board', 'Ranked board')}
    ${tab('live', `Live tokens (${d.live_size})`)}
    ${tab('coverage', `Coverage (${d.inventory.total})`)}
    ${tab('sandbox', 'Sandbox')}
    ${tab('compare', 'Compare')}
  </div>`;
}

function wireTabs(d) {
  document.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => go('?view=' + b.dataset.tab)),
  );
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

  main.innerHTML = `<div class="wrap">${headerHTML(d)}${kpiHTML(d)}${methodHTML(d)}
    ${tabsHTML(d, 'board')}
    <form class="controls" id="controls">
      <label>Search <input type="search" name="q" value="${esc(p.get('q') || '')}" placeholder="Name or slug"></label>
      <label>Category <select name="category"><option value="">All categories</option>${categories.map((c) => opt(c, cat, c)).join('')}</select></label>
      <label>Chain <select name="chain"><option value="">All chains</option>${chains.map((c) => opt(c, chain, c)).join('')}</select></label>
      <label>Scope <select name="scope">${opt('all', scope, 'All rows')}${opt('watchlist', scope, 'Watchlist only')}${opt('early', scope, 'Early finds only')}</select></label>
      <label>Sort by <select name="sort">${opt('value', sort, 'Implied value')}${opt('tvl', sort, 'TVL')}${opt('growth', sort, '7-day growth')}${opt('age', sort, 'Age')}${opt('name', sort, 'Name')}</select></label>
      <button class="btn" type="submit">Apply</button>
    </form>
    <p class="result-line">Showing <b>${sorted.length}</b> of ${d.board_size} ranked protocols${active ? ` &mdash; filtered by ${esc(active)}` : ''}. Click a row for its detail view and farm plan. The small range under each rank is where it usually sits over ${d.refits} refits of the size curves.</p>
    <table class="board"><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Implied value</th><th>Farm</th><th></th></tr></thead>
    <tbody>${body || '<tr><td colspan="10">No protocol matches this filter.</td></tr>'}</tbody></table>
    <p class="export-row"><button class="btn ghost" id="export-csv">Download board as CSV</button>
    <button class="btn ghost" id="export-json">Download board as JSON</button></p>
    ${topPicksHTML(d)}
    ${validationHTML(d)}
    ${comparablesHTML(d)}
    ${notOnBoardHTML(d)}
    <footer class="foot">Source: ${esc(d.source)}. Snapshot frozen 2026-11-14; the board reads only
    that snapshot. Model ${esc(d.model_version)}: implied = TVL &times; size-curve multiple &times; growth
    &times; tenure &times; breadth.</footer>
  </div>`;

  wireTabs(d);
  document.getElementById('export-csv').addEventListener('click', () => exportCSV(d));
  document.getElementById('export-json').addEventListener('click', () => exportJSON(d));
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
        <tr><th>Size-curve multiple (${esc(row.category ?? 'Uncategorised')})</th><td class="num">&times; ${row.category_multiple.toFixed(4)}</td></tr>
        <tr><th>Size curve</th><td class="num">log mcap = ${row.curve_intercept} + ${row.curve_slope} log TVL</td></tr>
        <tr><th>Growth multiplier (7d ${row.change_7d === null ? 'n/a' : (row.change_7d > 0 ? '+' : '') + row.change_7d.toFixed(1) + '%'})</th><td class="num">&times; ${row.growth_multiplier.toFixed(4)}</td></tr>
        <tr><th>Tenure multiplier (${row.age_days === null ? 'age unknown' : row.age_days + ' days, no token'})</th><td class="num">&times; ${row.maturity_multiplier.toFixed(4)}</td></tr>
        <tr><th>Breadth multiplier (${row.chains.length} chain${row.chains.length === 1 ? '' : 's'})</th><td class="num">&times; ${row.breadth_multiplier.toFixed(4)}</td></tr>
        <tr><th>Implied value</th><td class="num">${fmtUsd(row.implied_value_usd)}</td></tr>
      </tbody></table>
      <p class="small muted">The multiple comes from the category's size curve at this protocol's
      own TVL: the market pays less per TVL as protocols get bigger, so a giant and a minnow in
      the same category get different multiples. The token does not exist yet: this is the value
      a launch at the category's going rate would imply, from the snapshot alone. This page
      refits the curve from the sufficient statistics it carries and recomputes the value:
      ${fmtUsd(again)}
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
    <section class="card" aria-label="Farm timeline">
      <h2>Farm timeline</h2>
      <table class="break"><tbody>
        <tr><th>Start</th><td class="num">${esc(row.farm_timeline.start)}</td></tr>
        <tr><th>First weekly action</th><td class="num">${esc(row.farm_timeline.first_weekly_action)}</td></tr>
        <tr><th>Hold until</th><td class="num">${esc(row.farm_timeline.hold_until)}</td></tr>
        <tr><th>Claim from</th><td class="num">${esc(row.farm_timeline.claim_from)}</td></tr>
        <tr><th>Hold</th><td class="num">${row.farm_timeline.hold_days} days</td></tr>
      </tbody></table>
      <p class="small muted">The dates are anchored to the snapshot (${esc(d.as_of)}), not to today,
      so the plan is the same whenever the page is opened. Younger protocols get a longer
      qualifying window.</p>
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
    ${tabsHTML(d, 'live')}
    <section class="method" aria-label="Why these are separate">
      <h2>Already trading &mdash; shown, not ranked</h2>
      <p>These protocols already have a token that trades, so the market has priced them: the
      table shows their actual market cap, not a model. They are kept apart from the ranked board
      on purpose &mdash; a launch radar ranks what does not exist yet. Their market caps and TVLs
      are also the data the ranked board's size curves are fitted on.</p>
    </section>
    <table class="board"><thead><tr><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">7d</th></tr></thead>
    <tbody>${body}</tbody></table>
    <footer class="foot">Top ${d.live_size} live-token protocols by market cap, from the same
    ${esc(d.as_of)} snapshot. Source: ${esc(d.source)}.</footer>
  </div>`;
  wireTabs(d);
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
  else if (view === 'coverage') coverageView(d);
  else if (view === 'sandbox') sandboxView(d);
  else if (view === 'compare') compareView(d);
  else boardView(d);
})();
