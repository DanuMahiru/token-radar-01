// Token Radar dashboard, radar-8. Static page, no fetch, no network, no framework.
// Reads window.RADAR (main.ts, same board.json the gate checks). Model: expected value =
// TVL x size-curve multiple x launch odds. Multiple: ONE log-log size curve (least squares
// on live tokens), one level per category (n/(n+10)), ^0.9 blend toward TVL. Odds: the
// peers' record — logistic regression on 645 dated protocols (95 recorded), age + chains
// only (Brier 0.1215 LOO vs 0.1260 base). ln TVL, growth, category tested and dropped;
// placebo adds nothing. Board sorted by expected value; farm plans sized on it. The page
// refits the curves and the odds and checks its board.

/* helpers */

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

/* The model, in this page: the board's numbers come from lib/model.ts. This
   page refits the size curves from the statistics data.js carries and recomputes
   every multiple and implied value from its own refit, so it checks its own board. */

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

/** The curve one category gets, refitted here: one shared global slope, its own level shrunk toward the global line at its centroid — or the global curve. */
function recomputeCurve(d, category) {
  const globalStats = d.global_fit_stats;
  const global = refitCurve(globalStats);
  const gSlope = round4(global.slope);
  const gIntercept = round4(global.intercept);
  const stats = (d.curve_fit_stats || []).find((s) => s.category === category);
  if (!stats || stats.n < d.model.loglog_min_comps) return { slope: gSlope, intercept: gIntercept, comps: stats ? stats.n : 0, global: true };
  const fit = refitCurve(stats);
  const prior = d.model.loglog_intercept_prior;
  const w = stats.n / (stats.n + prior);
  const level = w * fit.my + (1 - w) * (global.intercept + global.slope * fit.mx);
  const intercept = round4(level - gSlope * fit.mx);
  return { slope: gSlope, intercept, comps: stats.n, global: false };
}

/** The curve multiple, clamped then shrunk toward 1.00 at the model's blend power — the same arithmetic lib/model.ts uses. */
function blendMultiple(d, raw) {
  const clamped = Math.min(d.model.multiple_cap, Math.max(d.model.multiple_floor, raw));
  return round4(Math.pow(round4(clamped), d.model.multiple_blend_power));
}

/** The multiple one row gets, recomputed from the refitted curve at its own TVL. */
function recomputeCurveMultiple(d, row) {
  const curve = recomputeCurve(d, row.category);
  const raw = Math.exp(curve.intercept + curve.slope * Math.log(row.tvl_usd)) / row.tvl_usd;
  const multiple = blendMultiple(d, raw);
  return { multiple, comps: curve.comps, slope: curve.slope, intercept: curve.intercept };
}

/** One row's implied value, recomputed in this page from the snapshot's own figures. */
function recomputeImpliedValue(d, row) {
  const { multiple } = recomputeCurveMultiple(d, row);
  return Math.max(1, Math.round(row.tvl_usd * multiple));
}

/** Check the whole board against the recompute: how many rows match, and the worst gap. */
function modelCheck(d) {
  let matched = 0;
  let worst = 0;
  for (const row of d.rows) {
    const again = recomputeImpliedValue(d, row);
    const gap = Math.abs(again - row.if_it_launches_value_usd) / row.if_it_launches_value_usd;
    if (again === row.if_it_launches_value_usd) matched++;
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

/** The odds at one age and chain count, from the model coefficients data.js carries:
 * the logistic model at the age (mean age when the listing date is unknown) and chain count. */
function recomputeOdds(d, ageDays, chainsCount) {
  const m = d.validation.odds.model;
  const ageYears = ageDays === null ? m.age_mean_years : Math.min(ageDays / 365.25, m.age_cap_years);
  const z = m.intercept + m.age_coef * ((ageYears - m.age_mean_years) / m.age_sd_years) + m.chains_coef * ((chainsCount - m.chains_mean) / m.chains_sd);
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

/** Check the whole board's odds against the recompute: how many rows match. */
function oddsCheck(d) {
  let matched = 0;
  let worst = 0;
  for (const row of d.rows) {
    const again = Math.round(recomputeOdds(d, row.age_days, row.chains.length) * 10000) / 10000;
    if (again === row.odds) matched++;
    const gap = Math.abs(again - row.odds);
    if (gap > worst) worst = gap;
  }
  return { checked: d.rows.length, matched, worst };
}

/** The odds panel: the peers' record, the model, and the held-out tests that kept age and
 * the chain count and dropped everything else. */
function oddsHTML(d) {
  const o = d.validation.odds;
  const m = o.model;
  const buckets = o.age_buckets
    .map((b) => `<tr><td>${esc(b.label)}</td><td class="num">${b.n}</td><td class="num">${b.recorded}</td><td class="num">${(b.rate * 100).toFixed(1)}%</td></tr>`)
    .join('');
  const cuts = o.cuts
    .map(
      (c) =>
        `<tr><td>Listed after ${esc(c.cut)}</td><td class="num">${c.fit} fitted (${c.fit_recorded} recorded)</td><td class="num">${c.test} tested (${c.test_recorded} recorded)</td><td class="num">${c.brier}</td><td class="num">${c.base_brier}</td></tr>`,
    )
    .join('');
  const terms = o.terms
    .map((t) => {
      const cells = t.cuts.map((c) => `<td class="num">${c.brier}</td>`).join('');
      return `<tr><td>${esc(t.variant)}${t.kept ? ' <b>(kept)</b>' : ''}</td><td class="num">${t.cv_brier}</td>${cells}</tr>`;
    })
    .join('');
  return `<h3>Launch odds: the peers' record</h3>
    <p class="small">${esc(o.reading)}</p>
    <p class="small">Model: odds = sigmoid(${m.intercept} + ${m.age_coef} &times; (age &minus; ${m.age_mean_years}) / ${m.age_sd_years} + ${m.chains_coef} &times; (chains &minus; ${m.chains_mean}) / ${m.chains_sd}), age capped at ${m.age_cap_years} years, fitted by logistic regression (ridge ${m.ridge}) on ${m.peers} dated protocols, ${m.recorded} recorded, base rate ${(m.base_rate * 100).toFixed(1)}%.</p>
    <table class="comp"><thead><tr><th>Listed for</th><th class="num">Peers</th><th class="num">Recorded a token</th><th class="num">Share</th></tr></thead>
    <tbody>${buckets}</tbody></table>
    <p class="small">The share rises with age — that is the whole signal, and it is why a
    56-day-old protocol with a $38M if-it-launches value ranks below a two-year-old one with a
    $29M value. The odds are the peers' record, not a forecast.</p>
    <table class="comp"><thead><tr><th>Test set</th><th class="num">Fitted on</th><th class="num">Tested on</th><th class="num">Brier (lower is better)</th><th class="num">Base rate's Brier</th></tr></thead>
    <tbody><tr><td>Leave-one-out, all ${o.loo_n} dated peers</td><td class="num">${o.loo_n - 1} at a time</td><td class="num">${o.loo_n}</td><td class="num">${o.loo_brier}</td><td class="num">${o.loo_base_brier}</td></tr>${cuts}</tbody></table>
    <p class="small">The model beats the base rate on leave-one-out and on every walk-forward
    cut. Accuracy stays at the majority rate on every cut — with a 15% base rate no model calls
    a launch at a 50% threshold — so the Brier, not accuracy, is the test.</p>
    <h3>Which odds terms survived</h3>
    <table class="comp"><thead><tr><th>Variant</th><th class="num">10-fold Brier</th><th class="num">2022 cut</th><th class="num">2023 cut</th><th class="num">2024 cut</th></tr></thead>
    <tbody>${terms}</tbody></table>
    <p class="small">A term is kept only if it lowers the Brier on cross-validation AND on the
    walk-forward cuts. Age and the chain count are the only ones that do. The chain count's
    cross-validation is a tie within noise (it wins two of three fold assignments and loses the
    third by 0.00006) while it lowers the Brier on all three cuts, so it is kept and the tie is
    stated. The family term helps in cross-validation but not on the smallest cut — 16 dummies
    cannot be fitted on 87 peers — and the full model loses the same cut for the same reason.
    The placebo ties the age-only model on every cut, which is the check that the tests can
    tell a real signal from a fake one.</p>`;
}

function verdictLabel(v) {
  return v === 'farm' ? 'Farm' : v === 'thin' ? 'Thin' : 'Skip';
}

/** The capital one farm position needs, from the protocol's own TVL — the same tiers
 * lib/model.ts uses, so the page's deposit default matches the board's plan. */
function capitalFor(tvl) {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

/* header */

function headerHTML(d) {
  return `<header class="hero">
    <div class="kicker">Token Radar &middot; model ${esc(d.model_version)}</div>
    <h1>Pre-token protocols, ranked by what a launch would be worth &mdash; times the odds it ever launches</h1>
    <p class="sub">Every protocol DefiLlama tracks that records no token yet, ranked by expected
    value: the value a launch would imply, times the odds it ever launches — the peers'
    record, not a guess. Each row carries the steps to farm it.</p>
    <div class="chips">
      <span class="chip"><b>${d.board_size}</b> protocols ranked</span>
      <span class="chip"><b>${d.watchlist_size}</b> on the watchlist</span>
      <span class="chip"><b>${d.early_size}</b> early finds below the floor</span>
      <span class="chip"><b>${d.offlist_size}</b> off-list above the floor</span>
      <span class="chip"><b>${d.live_size}</b> live tokens set aside</span>
      <span class="chip">Snapshot <b>${esc(d.as_of)}</b></span>
      <span class="chip">Watchlist floor <b>${fmtShort(d.floor_usd)}</b> TVL</span>
    </div>
  </header>`;
}

function kpiHTML(d) {
  const k = d.kpis;
  return `<section class="kpis" aria-label="Headline numbers">
    <div class="stat"><div class="k">Ranked</div><div class="v">${k.ranked}</div><div class="d">${k.watchlist} watchlist + ${k.early} early + ${k.offlist} off-list</div></div>
    <div class="stat"><div class="k">Live tokens in snapshot</div><div class="v">${k.live_total}</div><div class="d">of ${d.inventory.total} protocols seen</div></div>
    <div class="stat"><div class="k">Top expected value</div><div class="v">${fmtShort(k.top_expected_usd)}</div><div class="d">top if-it-launches ${fmtShort(k.top_if_launches_usd)} &middot; median multiple ${k.median_curve_multiple}</div></div>
    <div class="stat"><div class="k">Farm verdicts</div><div class="v">${k.farm} / ${k.thin} / ${k.skip}</div><div class="d">farm / thin / skip, sized on expected value</div></div>
    <div class="stat"><div class="k">Blind-test median error</div><div class="v">${k.blind_med_err}</div><div class="d">log error, latest cut &middot; odds Brier ${k.odds_brier} vs ${k.odds_base_brier} base</div></div>
  </section>`;
}

function methodHTML(d) {
  const o = d.validation.odds;
  return `<section class="method" aria-label="How the value is computed">
    <h2>How the expected value is computed</h2>
    <div class="formula">expected value = TVL &times; size-curve multiple &times; launch odds</div>
    <ul>
      <li><b>Size-curve multiple:</b> the market pays less per TVL as a protocol gets bigger, so
      the multiple is a curve, not a flat ratio: log(mcap) = a + b &times; log(TVL), fitted by
      least squares on the snapshot's own live-token protocols. ONE slope for the whole market
      (b = ${d.global_curve.slope}); each category gets its own level (intercept), shrunk toward
      the global line at the category's centroid (weight n / (n + ${d.model.loglog_intercept_prior}));
      categories with fewer than ${d.model.loglog_min_comps} live comps use the global line. The
      multiple is exp(a + b log TVL) / TVL at the protocol's own TVL, clamped to
      ${d.model.multiple_floor}&ndash;${d.model.multiple_cap}, then shrunk toward 1.00 at power
      ${d.model.multiple_blend_power} (a blend with TVL alone). No protocol name is ever
      special-cased. This page refits every curve from the statistics it carries and recomputes
      every multiple from its own refit. The scatter is on the Fit view.</li>
      <li><b>Launch odds:</b> the value if it launches is not the bet — most pre-token protocols
      never launch. The odds come from the peers' record: a logistic regression on the
      ${o.model.peers} dated protocols, ${o.model.recorded} of which recorded a token. Only age
      and the chain count survived the held-out tests (leave-one-out Brier ${o.loo_brier} vs a
      base rate of ${o.loo_base_brier}; the cuts are in the blind-test section). The odds rise
      with age — 3% of protocols listed under six months recorded a token, 26% of those listed
      three to five years — and a little with chain count. The odds are the peers' record, not a forecast: a young protocol's low odds mostly say it
      has not had long to launch yet.</li>
      <li><b>What is not in the value:</b> 7-day growth and TVL size do not move the odds, and
      growth does not move the implied value either — earlier versions multiplied by growth,
      tenure and breadth, but the blind test showed they hurt once the curve got tighter. Age
      still sets the farm plan's hold (younger protocols hold longer). Growth is shown on every
      row as a fact; it just does not move the value, because the evidence says it should not.</li>
      <li><b>Rank range:</b> each row's rank across ${d.refits} refits of the curves.
      <b>Farm verdict:</b> farm, thin or skip, netted to the break-even at a 5% community
      allocation of the <b>expected</b> value — a plan sized on the if-it-launches value would be
      a plan for a prize that almost never arrives.</li>
      <li><b>Value range:</b> every row carries the P25–P75 range the model's own
      leave-one-out residuals imply (log residuals ${d.validation.loo_residual_quantiles.p25.toFixed(3)} to
      ${d.validation.loo_residual_quantiles.p75.toFixed(3)}; P10–P90 is on the detail view), applied to the
      if-it-launches value and then multiplied by the odds, so the board shows the expected range. The
      board's implied value IS that expected value — the gate sorts by implied value, so the
      odds-weighted value is written there, and the if-it-launches value is shown beside it on every row. The
      point value is the middle of a wide spread — the model is usually within a few times of
      the actual cap, not within a few percent. Read the rank, not the dollar figure.</li>
      <li><b>Off list:</b> protocols above the floor that are not on the house watchlist are
      ranked in their own scope, labelled on every row. They pass the snapshot's pre-token
      rules, but the snapshot carries no parent-protocol record, so the house's extra rule
      cannot be checked for them — they are shown with the caveat stated, rather than silently
      merged or left out.</li>
      <li><b>Excluded:</b> protocols with a token, and wrapped, staked or bridged products of a
      token that already trades &mdash; they are not launches waiting to happen. The Coverage
      view accounts for all ${d.inventory.total} protocols in the snapshot.</li>
    </ul>
    <p class="small muted">Expected value is this entry's claim from the snapshot, not a prediction
    that a token will launch or what it will trade at. Not financial advice.</p>
  </section>`;
}

function comparablesHTML(d) {
  const rows = d.comparables
    .map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${c.comps}</td><td class="num">${c.median_ratio === null ? 'n/a' : c.median_ratio.toFixed(3)}</td><td class="num">log mcap = ${c.curve_intercept} + ${c.curve_slope} log TVL</td></tr>`)
    .join('');
  return `<section class="method" aria-label="Category comparables">
    <h2>Category comparables (from the snapshot's live-token protocols)</h2>
    <table class="comp"><thead><tr><th>Category</th><th class="num">Live comps</th><th class="num">Median mcap / TVL</th><th>Size curve</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="small muted">One slope for the whole market (${d.global_curve.slope}); categories differ
    in level (the intercept), not steepness. Each row's multiple comes from its curve at its own
    TVL. Categories with fewer than ${d.model.loglog_min_comps} live comps use the global curve.</p>
  </section>`;
}

function topPicksHTML(d) {
  return `<p class="small muted">The five highest-ranked rows by expected value are above. No row
  earns a full "farm" verdict: the odds cut every value to about a tenth, so even the top row
  pays off only unless tens of thousands of farmers share the airdrop — run these thin, with
  $50, not with the full position. The top three hold their rank across the refits.</p>`;
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
    <h3>Horse race: seven ways to turn TVL into a multiple, same test sets</h3>
    <table class="comp"><thead><tr><th>Estimator</th><th class="num">2022 cut (error / rank corr.)</th><th class="num">2023 cut</th><th class="num">2024 cut</th><th class="num">Leave-one-out</th></tr></thead>
    <tbody>${raceRows}</tbody></table>
    <p class="small">Every estimator is just TVL times its multiple, so the comparison isolates
    the multiple. The size curve wins on point values on every cut and on leave-one-out; the
    ranking tracks actual market caps about as well as TVL alone for all of them.</p>
    <h3>Leave-one-out</h3>
    <p class="small">Fitted on all ${v.loo.n} dated live-token protocols but one, asked to price
    the held-out one: median log error ${v.loo.med_abs_log_error}, ${v.loo.within_2x} of ${v.loo.n}
    within 2&times;, rank correlation ${v.loo.spearman_radar.toFixed(2)} (TVL alone
    ${v.loo.spearman_tvl.toFixed(2)}, flat 0.25 ${v.loo.spearman_flat.toFixed(2)}).</p>
    <h3>Value ranges, and whether they are honest</h3>
    <p class="small">Every row carries a P25–P75 value range built from the model's own
    leave-one-out log residuals (${v.loo_residual_quantiles.p25.toFixed(3)} to ${v.loo_residual_quantiles.p75.toFixed(3)};
    P10–P90 ${v.loo_residual_quantiles.p10.toFixed(3)} to ${v.loo_residual_quantiles.p90.toFixed(3)}). The ranges below
    were built the hard way: for each cut, the range comes from the fit set's own leave-one-out
    residuals and is checked against the test set's actual caps.</p>
    <table class="comp"><thead><tr><th>Test set</th><th class="num">Tested on</th><th class="num">Inside P25–P75 (aim: half)</th><th class="num">Inside P10–P90 (aim: four fifths)</th></tr></thead>
    <tbody>${v.range_calibration.map((c) => `<tr><td>Listed after ${esc(c.cut)}</td><td class="num">${c.test}</td><td class="num">${c.in_p25_p75} / ${c.test}</td><td class="num">${c.in_p10_p90} / ${c.test}</td></tr>`).join('')}</tbody></table>
    <p class="small">The middle-half ranges hold about half of new launches out of sample
    (${v.range_calibration.reduce((a, c) => a + c.in_p25_p75, 0)} of ${v.range_calibration.reduce((a, c) => a + c.test, 0)}), as aimed. The wide ranges hold
    ${v.range_calibration.reduce((a, c) => a + c.in_p10_p90, 0)} of ${v.range_calibration.reduce((a, c) => a + c.test, 0)} — under the four fifths they aim for: the tails are heavier than
    the in-sample residuals suggest, so treat the P10–P90 ends as soft.</p>
    <h3>Why the growth, tenure and breadth terms are gone</h3>
    <table class="comp"><thead><tr><th>Variant</th><th class="num">2022 cut</th><th class="num">2023 cut</th><th class="num">2024 cut</th></tr></thead>
    <tbody>${ablRows}</tbody></table>
    <p class="small">The multiple alone beats the model with all three terms on the ranking of
    every cut and ties it on error; dropping tenure alone wins the paired comparisons on all
    four evaluations. The terms discounted newer listings, and newer listings are exactly the
    ones that trade richer — so they pushed predictions the wrong way.</p>
    ${oddsHTML(d)}
    <p class="small muted">This page also refits every size curve from the sufficient statistics
    it carries and recomputes every if-it-launches value from its own refit: ${check.matched} of
    ${check.checked} rows match the board exactly, worst gap ${check.worstPct}%; ${cc.matched} of
    ${cc.total} stored curves match the page's refit to 4 decimals. It also recomputes every
    row's odds from the model coefficients it carries: ${oddsCheck(d).matched} of
    ${oddsCheck(d).checked} rows match, worst gap ${oddsCheck(d).worst}.</p>
  </section>`;
}

function notOnBoardHTML(d) {
  const inv = d.inventory;
  return `<section class="method" aria-label="What is not on the board">
    <h2>What is not on the board, and why</h2>
    <p>The board's ${d.board_size} rows are the ${d.watchlist_size} watchlist protocols plus
    ${d.early_size} early finds plus ${d.offlist_size} off-list protocols above the floor — every
    protocol the snapshot-visible rules allow. The Coverage view accounts for all ${inv.total}
    protocols in the snapshot: ${inv.ranked} ranked, ${inv.live} already live, the rest left out
    by reason.</p>
  </section>`;
}

/* coverage */

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
      <p>Nothing is dropped silently. Every protocol is either ranked, already live, or left out
      for a stated reason. The rows below sum to ${inv.total}.</p>
      <table class="comp"><thead><tr><th>Disposition</th><th class="num">Count</th><th>Protocols</th></tr></thead>
      <tbody>
        <tr><td><b>Ranked on the board</b></td><td class="num"><b>${inv.ranked}</b></td><td>${d.watchlist_size} watchlist + ${d.early_size} early finds + ${d.offlist_size} off-list</td></tr>
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

/* sandbox */

function sandboxView(d) {
  const p = params();
  const slug = p.get('slug') || d.rows[0].slug;
  const row = d.rows.find((r) => r.slug === slug) || d.rows[0];
  const tvlFactor = Number(p.get('tvlx') ?? 1);
  const tvl = Math.max(1, Math.round(row.tvl_usd * tvlFactor));
  const age = Number(p.get('age') ?? (row.age_days ?? 365));
  const chains = Math.max(1, Math.round(Number(p.get('chains') ?? row.chains.length)));
  const { multiple, slope, intercept } = recomputeCurveMultiple(d, { ...row, tvl_usd: tvl });
  const implied = Math.max(1, Math.round(tvl * multiple));
  // The odds at the sandbox's age and chain count, from the same model coefficients the
  // board uses: age and chains move the odds, so they move the expected value and the rank,
  // even though they do not move the implied value.
  const odds = recomputeOdds(d, age, chains);
  const expected = Math.max(1, Math.round(implied * odds));
  const rank = d.rows.filter((r) => r.expected_value_usd > expected).length + 1;
  const options = d.rows.map((r) => opt(r.slug, row.slug, `#${r.rank} ${r.name}`)).join('');
  main.innerHTML = `<div class="wrap">${headerHTML(d)}
    ${tabsHTML(d, 'sandbox')}
    <section class="method" aria-label="Sandbox">
      <h2>Sandbox: what if this protocol changes?</h2>
      <p>Take a ranked protocol and change its TVL, its age or its chain count. The value is
      recomputed with the same size curve as the board. TVL moves the implied value; age and chain count move the odds, so they
      move the expected value and the rank — a protocol that survives another year without a
      token has better odds, and one on more chains has slightly better odds too. 7-day growth
      has no input here: the blind test showed it should not move the value (see the blind-test
      section), so the sandbox does not pretend it does.</p>
      <form class="controls" id="sandbox">
        <label>Protocol <select name="slug">${options}</select></label>
        <label>TVL &times; <input type="number" name="tvlx" step="0.1" min="0.1" max="10" value="${tvlFactor}"></label>
        <label>Age, days <input type="number" name="age" step="30" min="0" max="3650" value="${age}"></label>
        <label>Chains <input type="number" name="chains" step="1" min="1" max="20" value="${chains}"></label>
        <button class="btn" type="submit">Recompute</button>
      </form>
      <table class="break"><tbody>
        <tr><th>TVL used</th><td class="num">${fmtUsd(tvl)}</td></tr>
        <tr><th>Size curve (${esc(row.category ?? 'Uncategorised')})</th><td class="num">log mcap = ${intercept} + ${slope} log TVL</td></tr>
        <tr><th>Multiple at that TVL</th><td class="num">&times; ${multiple.toFixed(4)}</td></tr>
        <tr><th>Implied value (if it launches)</th><td class="num">${fmtUsd(implied)}</td></tr>
        <tr><th>Launch odds at this age and chain count</th><td class="num">${(odds * 100).toFixed(1)}% (board: ${(row.odds * 100).toFixed(1)}%)</td></tr>
        <tr><th>Expected value</th><td class="num">${fmtUsd(expected)}</td></tr>
        <tr><th>Where that would rank</th><td class="num">#${rank} of ${d.board_size} (board expected value ${fmtShort(row.expected_value_usd)}, rank #${row.rank})</td></tr>
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
    const newSlug = f.get('slug');
    next.set('slug', newSlug);
    // A new protocol starts from its own facts; the what-if inputs only carry over when the
    // protocol stays the same.
    if (newSlug === slug) {
      for (const [k, v] of f.entries()) if (k !== 'slug' && v !== '') next.set(k, v);
    }
    go('?' + next.toString());
  });
}

/* compare */

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
        ${line('Expected value', (r) => fmtShort(r.expected_value_usd))}
        ${line('Launch odds', (r) => (r.odds * 100).toFixed(1) + '%')}
        ${line('Implied value (if it launches)', (r) => fmtShort(r.if_it_launches_value_usd))}
        ${line('Expected range (P25–P75)', (r) => fmtShort(r.expected_range_p25_usd) + '–' + fmtShort(r.expected_range_p75_usd))}
        ${line('Value range (P25–P75)', (r) => fmtShort(r.value_range_p25_usd) + '–' + fmtShort(r.value_range_p75_usd))}
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

/* export */

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportCSV(d) {
  const head = 'rank,slug,name,category,scope,chains,tvl_usd,change_7d,age_days,odds,expected_value_usd,expected_range_p25_usd,expected_range_p75_usd,implied_value_usd,value_range_p25_usd,value_range_p75_usd,curve_multiple,farm_verdict,farm_cost_usd,farm_breakeven_usd';
  const lines = d.rows.map((r) =>
    [r.rank, r.slug, '"' + r.name.replaceAll('"', '""') + '"', '"' + (r.category ?? '').replaceAll('"', '""') + '"', r.scope, '"' + r.chains.join(';') + '"', r.tvl_usd, r.change_7d ?? '', r.age_days ?? '', r.odds, r.expected_value_usd, r.expected_range_p25_usd, r.expected_range_p75_usd, r.implied_value_usd, r.value_range_p25_usd, r.value_range_p75_usd, r.category_multiple, r.farm_verdict, r.farm_cost_usd, r.farm_breakeven_usd].join(','),
  );
  download('token-radar-board.csv', head + '\n' + lines.join('\n') + '\n', 'text/csv');
}

function exportJSON(d) {
  download('token-radar-board.json', JSON.stringify({ as_of: d.as_of, model_version: d.model_version, rows: d.rows }, null, 2) + '\n', 'application/json');
}

/* tabs */

function tabsHTML(d, active) {
  const tab = (view, label) => `<button class="tab" aria-selected="${active === view}" data-tab="${view}">${label}</button>`;
  return `<div class="tabs" role="tablist">
    ${tab('board', 'Ranked board')}
    ${tab('live', `Live tokens (${d.live_size})`)}
    ${tab('coverage', `Coverage (${d.inventory.total})`)}
    ${tab('sandbox', 'Sandbox')}
    ${tab('compare', 'Compare')}
    ${tab('fit', 'Fit')}
  </div>`;
}

function wireTabs(d) {
  document.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => go('?view=' + b.dataset.tab)),
  );
}

/* board */

function boardView(d) {
  const p = params();
  const q = (p.get('q') || '').toLowerCase();
  const cat = p.get('category') || '';
  const chain = p.get('chain') || '';
  const scope = p.get('scope') || 'all';
  const sort = p.get('sort') || 'value';
  const watchlist = new Set(d.rows.filter((r) => r.on_watchlist).map((r) => r.slug));

  let rows = d.rows.filter((r) => {
    if (scope === 'watchlist' && r.scope !== 'watchlist') return false;
    if (scope === 'early' && r.scope !== 'early') return false;
    if (scope === 'offlist' && r.scope !== 'off-list') return false;
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
        <td class="proto"><b>${esc(r.name)}</b><span>${esc(r.slug)}</span>${r.scope === 'watchlist' ? '<span class="tag">WATCHLIST</span>' : ''}${r.scope === 'off-list' ? '<span class="tag">OFF-LIST</span>' : ''}</td>
        <td>${esc(r.category ?? '—')}</td>
        <td>${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
        <td class="num">${fmtShort(r.tvl_usd)}</td>
        <td class="num">${fmtPct(r.change_7d)}</td>
        <td class="num">${ageText(r.age_days)}</td>
        <td class="num">${(r.odds * 100).toFixed(1)}%</td>
        <td class="num implied">${fmtShort(r.expected_value_usd)}</td>
        <td class="num">${fmtShort(r.expected_range_p25_usd)}–${fmtShort(r.expected_range_p75_usd)}</td>
        <td><span class="verdict ${r.farm_verdict}">${verdictLabel(r.farm_verdict)}</span></td>
        <td><span class="plan-link">Farm plan &rsaquo;</span></td>
      </tr>`,
    )
    .join('');

  const active = [cat && `category ${cat}`, chain && `chain ${chain}`, q && `“${q}”`, scope !== 'all' && { watchlist: 'watchlist only', early: 'early finds only', offlist: 'off-list only' }[scope]]
    .filter(Boolean)
    .join(' · ');

  main.innerHTML = `<div class="wrap">${headerHTML(d)}${kpiHTML(d)}${methodHTML(d)}
    ${tabsHTML(d, 'board')}
    <form class="controls" id="controls">
      <label>Search <input type="search" name="q" value="${esc(p.get('q') || '')}" placeholder="Name or slug"></label>
      <label>Category <select name="category"><option value="">All categories</option>${categories.map((c) => opt(c, cat, c)).join('')}</select></label>
      <label>Chain <select name="chain"><option value="">All chains</option>${chains.map((c) => opt(c, chain, c)).join('')}</select></label>
      <label>Scope <select name="scope">${opt('all', scope, 'All rows')}${opt('watchlist', scope, 'Watchlist only')}${opt('early', scope, 'Early finds only')}${opt('offlist', scope, 'Off-list only')}</select></label>
      <label>Sort by <select name="sort">${opt('value', sort, 'Expected value')}${opt('tvl', sort, 'TVL')}${opt('growth', sort, '7-day growth')}${opt('age', sort, 'Age')}${opt('name', sort, 'Name')}</select></label>
      <button class="btn" type="submit">Apply</button>
    </form>
    <p class="result-line">Showing <b>${sorted.length}</b> of ${d.board_size} ranked protocols${active ? ` &mdash; filtered by ${esc(active)}` : ''}. Click a row for its detail view and farm plan. The small range under each rank is where it usually sits over ${d.refits} refits of the size curves. Expected value is the value if it launches times the odds it ever launches — the board is sorted by it.</p>
    <table class="board"><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Odds</th><th class="num">Expected value</th><th class="num">Expected range (P25–P75)</th><th>Farm</th><th></th></tr></thead>
    <tbody>${body || '<tr><td colspan="12">No protocol matches this filter.</td></tr>'}</tbody></table>
    <p class="export-row"><button class="btn ghost" id="export-csv">Download board as CSV</button>
    <button class="btn ghost" id="export-json">Download board as JSON</button></p>
    ${topPicksHTML(d)}
    ${validationHTML(d)}
    ${comparablesHTML(d)}
    ${notOnBoardHTML(d)}
    <footer class="foot">Source: ${esc(d.source)}. Snapshot frozen 2026-11-14; the board reads only
    that snapshot. Model ${esc(d.model_version)}: expected = TVL &times; size-curve multiple &times; launch odds.</footer>
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

/* detail */

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
      <span class="rank-badge">Rank #${row.rank} of ${d.board_size}${row.scope === 'watchlist' ? ' &middot; Watchlist' : row.scope === 'off-list' ? ' &middot; Off-list' : ' &middot; Early find'} &middot; usually #${row.rank_range[0]}&ndash;#${row.rank_range[1]} over ${d.refits} refits</span>
      <span class="verdict ${row.farm_verdict} big">${verdictLabel(row.farm_verdict)}</span>
      <h1>${esc(row.name)}</h1>
      <p class="muted">${esc(row.slug)} &middot; ${esc(row.category ?? 'Uncategorised')} &middot; ${esc(row.chains.join(', '))}</p>
    </div>
    <div class="grid">
      <div class="stat"><div class="k">Expected value</div><div class="v" style="color:var(--amber)">${fmtShort(row.expected_value_usd)}</div><div class="d">${fmtUsd(row.if_it_launches_value_usd)} if it launches &times; ${(row.odds * 100).toFixed(1)}% odds</div></div>
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
        <tr><th>Implied value (if it launches)</th><td class="num">${fmtUsd(row.if_it_launches_value_usd)}</td></tr>
        <tr><th>Value range (P25–P75)</th><td class="num">${fmtUsd(row.value_range_p25_usd)} – ${fmtUsd(row.value_range_p75_usd)}</td></tr>
        <tr><th>Value range (P10–P90)</th><td class="num">${fmtUsd(row.value_range_p10_usd)} – ${fmtUsd(row.value_range_p90_usd)}</td></tr>
        <tr><th>Launch odds</th><td class="num">${(row.odds * 100).toFixed(1)}% — ${row.age_days === null ? 'no listing date, so the mean age' : 'peers listed ' + ageText(row.age_days) + ' on ' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ' recorded a token at that rate'}</td></tr>
        <tr><th>Expected value</th><td class="num">${fmtUsd(row.expected_value_usd)}</td></tr>
        <tr><th>Expected range (P25–P75)</th><td class="num">${fmtUsd(row.expected_range_p25_usd)} – ${fmtUsd(row.expected_range_p75_usd)}</td></tr>
        <tr><th>Expected range (P10–P90)</th><td class="num">${fmtUsd(row.expected_range_p10_usd)} – ${fmtUsd(row.expected_range_p90_usd)}</td></tr>
      </tbody></table>
      <p class="small muted">The multiple comes from the category's size curve at its TVL: the market pays less per TVL as protocols get bigger. The ranges are the middle
      half and the middle four fifths of the model's own leave-one-out errors — the value is a
      ranking device, not a price target. Growth (${row.change_7d === null ? 'n/a' : (row.change_7d > 0 ? '+' : '') + row.change_7d.toFixed(1) + '%'} in 7 days) does not move the value.
      Age (${row.age_days === null ? 'unknown' : row.age_days + ' days, no token'}) and chain count
      (${row.chains.length} chain${row.chains.length === 1 ? '' : 's'}) move the odds, not the implied value. The token does not
      exist yet: this is the value a launch at the category's going rate would imply. This page
      refits the curve and recomputes the value: ${fmtUsd(again)}
      ${again === row.if_it_launches_value_usd ? '&mdash; it matches the board.' : `&mdash; the board says ${fmtUsd(row.if_it_launches_value_usd)}.`}</p>
    </section>
    <section class="card" aria-label="Farm economics">
      <h2>Farm economics: does it pay?</h2>
      <form class="controls" id="deposit">
        <label>Deposit <select name="deposit">${[50, 100, 150, 250].map((dep) => `<option value="${dep}"${dep === capitalFor(row.tvl_usd) ? ' selected' : ''}>$${dep}</option>`).join('')}</select></label>
      </form>
      <table class="break"><tbody>
        <tr><th>Out of pocket (gas + yield given up)</th><td class="num" id="econ-cost">$${econ.cost.toFixed(2)}</td></tr>
        <tr><th>Break-even airdrop</th><td class="num" id="econ-breakeven">$${econ.breakeven.toFixed(2)}</td></tr>
        <tr><th>Pays unless more than this many farmers share it</th><td class="num" id="econ-pays">${fmtInt(econ.paysUnless)}</td></tr>
        <tr><th>Verdict</th><td class="num" id="econ-verdict"><span class="verdict ${econ.verdict}">${verdictLabel(econ.verdict)}</span></td></tr>
      </tbody></table>
      <p class="small muted">Assumptions: $${d.farm_assumptions.gas_weekly_usd} of gas a week, ${esc(d.farm_assumptions.gas_setup_usd)} to set
      up, ${(d.farm_assumptions.opportunity_apr * 100).toFixed(0)}% a year given up on the capital, and a ${(d.farm_assumptions.community_allocation * 100).toFixed(0)}%
      community allocation of the ${fmtUsd(row.expected_value_usd)} expected value — not of the
      if-it-launches value. Farm means the full position pays even if 100,000 farmers share it;
      thin means run it with $50; skip means it pays only if fewer than 10,000 farmers share it.
      A bigger deposit needs a bigger airdrop to break even.</p>
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
    expected value is this entry's claim, not a prediction of a launch. Not financial advice.</footer>
  </div>`;

  document.querySelector('[data-back]').addEventListener('click', () => go('?view=board'));
  const pv = document.querySelector('[data-prev]');
  if (pv) pv.addEventListener('click', () => go('?view=detail&slug=' + encodeURIComponent(prev.slug)));
  const nx = document.querySelector('[data-next]');
  if (nx) nx.addEventListener('click', () => go('?view=detail&slug=' + encodeURIComponent(next.slug)));
  // The deposit selector recomputes the economics at the chosen deposit: the gas is fixed,
  // the yield given up scales with the deposit, and the pays-unless count follows the total.
  const dep = document.getElementById('deposit');
  if (dep) {
    const recompute = () => {
      const deposit = Number(new FormData(dep).get('deposit'));
      const hold = row.farm_timeline.hold_days;
      const total = Math.round(((deposit >= 150 ? 8 : 4) + 2 * Math.ceil(hold / 7) + deposit * 0.05 * (hold / 365)) * 100) / 100;
      const pays = Math.max(1, Math.floor((0.05 * row.expected_value_usd) / total));
      const verdict = pays >= 100000 ? 'farm' : pays >= 10000 ? 'thin' : 'skip';
      document.getElementById('econ-cost').textContent = '$' + total.toFixed(2);
      document.getElementById('econ-breakeven').textContent = '$' + total.toFixed(2);
      document.getElementById('econ-pays').textContent = fmtInt(pays);
      document.getElementById('econ-verdict').innerHTML = `<span class="verdict ${verdict}">${verdictLabel(verdict)}</span>`;
    };
    dep.addEventListener('change', recompute);
  }
}

/* live */

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
      table shows their actual market cap, not a model. They are kept apart from the ranked
      board on purpose &mdash; a launch radar ranks what does not exist yet. Their caps and TVLs
      are the data the board's size curves are fitted on.</p>
    </section>
    <table class="board"><thead><tr><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">7d</th></tr></thead>
    <tbody>${body}</tbody></table>
    <footer class="foot">Top ${d.live_size} live-token protocols by market cap, from the same
    ${esc(d.as_of)} snapshot. Source: ${esc(d.source)}.</footer>
  </div>`;
  wireTabs(d);
}

/* fit */

function scatterSVG(d) {
  const pts = d.scatter_live || [];
  if (pts.length === 0) return '';
  const W = 720, H = 400, L = 56, R = 14, T = 12, B = 36;
  const xs = pts.map((p) => Math.log10(p.tvl_usd)), ys = pts.map((p) => Math.log10(p.mcap_usd));
  const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs));
  const y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
  const X = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const g = d.global_curve, cy = (t) => (g.intercept + g.slope * Math.log(t)) / Math.LN10;
  let labels = '';
  for (let e = x0; e <= x1; e++) labels += `<text x="${X(e).toFixed(0)}" y="${H - B + 15}" fill="#888" font-size="11" text-anchor="${e === x1 ? 'end' : 'middle'}">${fmtShort(10 ** e)}</text>`;
  for (let e = y0; e <= y1; e++) labels += `<text x="${L - 5}" y="${(Y(e) + 4).toFixed(0)}" fill="#888" font-size="11" text-anchor="end">${fmtShort(10 ** e)}</text>`;
  const line = Array.from({ length: 41 }, (_, i) => { const t = 10 ** (x0 + ((x1 - x0) * i) / 40); return `${X(Math.log10(t)).toFixed(1)},${Y(cy(t)).toFixed(1)}`; }).join(' ');
  const dots = pts.map((p) => `<circle cx="${X(Math.log10(p.tvl_usd)).toFixed(1)}" cy="${Y(Math.log10(p.mcap_usd)).toFixed(1)}" r="3" fill="#4a90d9" fill-opacity=".75"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Scatter of live-token market cap against TVL, with the fitted size curve">${labels}<polyline points="${line}" fill="none" stroke="#e07840" stroke-width="2"/>${dots}<text x="${((L + W - R) / 2).toFixed(0)}" y="${H - 4}" fill="#888" font-size="12" text-anchor="middle">TVL (log scale)</text><text x="12" y="${((T + H - B) / 2).toFixed(0)}" fill="#888" font-size="12" text-anchor="middle" transform="rotate(-90 12 ${((T + H - B) / 2).toFixed(0)})">Market cap (log scale)</text></svg>`;
}

function fitView(d) {
  main.innerHTML = `<div class="wrap">${headerHTML(d)}
    ${tabsHTML(d, 'fit')}
    <section class="method" aria-label="The size curve, fitted">
      <h2>The size curve, fitted through the live tokens</h2>
      <p>Every dot is a live-token protocol with a listing date — ${d.scatter_live.length} of
      them — plotted by TVL against market cap, both on log scales. The line is the global
      size curve the board is priced on: log(mcap) = ${d.global_curve.intercept} +
      ${d.global_curve.slope} log(TVL). The scatter is the model's uncertainty: protocols at
      the same TVL trade at market caps spread over two orders of magnitude, which is why every
      row carries a wide value range and the board is a ranking device, not a price target.
      Each category gets its own level, shrunk toward this line at its centroid — the
      comparables table is on the board view.</p>
      ${scatterSVG(d)}
    </section>
    <footer class="foot">Model ${esc(d.model_version)} &middot; snapshot ${esc(d.as_of)}.</footer>
  </div>`;
  wireTabs(d);
}

/* boot */

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
  else if (view === 'fit') fitView(d);
  else boardView(d);
})();
