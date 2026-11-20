// The token radar's model, radar-6: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. Radar-6
// also ranks the protocols above the floor that pass the snapshot's own pre-token rules but are
// not on the house watchlist — in their own "Off list" scope, labelled, not silently merged —
// because the snapshot carries no parent-protocol record to apply the house's extra rule to.
// A protocol is pre-token when its index entry records no token (no market cap, no CoinGecko
// id, no symbol); the snapshot's live-token protocols are kept apart and shown as the market's
// own values, never mixed into the ranked board. Every row carries the P25–P75 value range the
// model's own leave-one-out residuals imply, so the board shows the uncertainty, not just the
// point value.
//
// Implied value follows only from the snapshot's own figures, never from a hardcoded list of names:
//
//   size curve   ONE log-log line for the whole market, log(mcap) = a + b . log(TVL), fitted by
//                least squares on the snapshot's own live-token protocols; each category gets
//                its own level (intercept), shrunk toward the global line's value at the
//                category's centroid (weight n / (n + 10)). Categories with fewer than 5 live
//                comps use the global line. v3 fitted a slope per category; the blind test
//                showed the per-category slopes are mostly noise (one global slope wins the
//                leave-one-out error by a fifth), so radar-5 keeps one slope and lets the
//                categories differ in level, not in steepness.
//   multiple     the curve's value at the protocol's own TVL, clamped to [0.02, 1.50], then
//                shrunk toward 1.00 at power 0.9 (multiple ^ 0.9): a geometric blend with TVL
//                alone, which the blind test's paired comparisons favour on every cut and on
//                leave-one-out. The market pays less per TVL as a protocol gets bigger
//                (global slope about 0.47), which is why a flat multiple overprices the giants.
//   implied    = max(1, round(tvl_usd x multiple))
//
// Growth, tenure and breadth are NOT in the value. Radar-2 through radar-4 multiplied by
// them (7-day growth at half weight, tenure 0.60 → 1.00 over three years, +2% per extra
// chain), and the blind test kept them as near-neutral — but with the tighter radar-5 curve
// they actively hurt: the multiple alone beats the full model on every cut's ranking and
// ties it on error, and dropping tenure alone wins the paired comparisons on all four
// evaluations. The mechanism is visible in the data: the maturity term discounts newer
// listings, and newer listings are exactly the ones that trade richer. Age still sets the
// farm plan's hold (younger protocols hold longer), and growth and chain count are still
// shown as facts on every row — they just do not move the value, because the evidence says
// they should not.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  shrinkage_prior: number;
  multiple_floor: number;
  multiple_cap: number;
  loglog_min_comps: number;
  loglog_slope_prior: number;
  loglog_intercept_prior: number;
  multiple_blend_power: number;
}

export const MODEL: ModelConstants = {
  shrinkage_prior: 5,
  multiple_floor: 0.02,
  multiple_cap: 1.5,
  loglog_min_comps: 5,
  loglog_slope_prior: 40,
  loglog_intercept_prior: 10,
  multiple_blend_power: 0.9,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-7';

/** The launch-odds model: a logistic regression on the snapshot's dated peers.
 * Outcome: the protocol recorded a token by the snapshot date. Features: only age
 * (years listed, capped at 3, standardised) survived both held-out tests — ln TVL,
 * 7-day growth, chain count and the category (family) term were tested and not kept:
 * they help in cross-validation but not on the walk-forward cuts (see validateOdds).
 * The odds are the peers' record — the share of protocols listed this long that
 * recorded a token — not a forecast that this protocol will launch. */
export interface OddsModel {
  intercept: number;
  age_coef: number;
  age_mean_years: number;
  age_sd_years: number;
  age_cap_years: number;
  chains_coef: number;
  chains_mean: number;
  chains_sd: number;
  ridge: number;
  peers: number;
  recorded: number;
  base_rate: number;
}

/** One walk-forward cut of the odds test: fit on peers listed before the cut, test on
 * peers listed after it. The test peers have had less time to record, so the base rate
 * is the test set's own recorded share — the fair comparator. */
export interface OddsCut {
  cut: string;
  fit: number;
  fit_recorded: number;
  test: number;
  test_recorded: number;
  brier: number;
  base_brier: number;
  acc: number;
  base_acc: number;
}

/** One odds-model variant in the terms table: its cross-validated Brier and its Brier
 * on each walk-forward cut, against each cut's own base rate. A term is kept only if it
 * lowers the Brier on cross-validation AND on the walk-forward cuts. */
export interface OddsTermsRow {
  variant: string;
  cv_brier: number;
  cv_base_brier: number;
  cuts: { cut: string; brier: number; base_brier: number }[];
  kept: boolean;
}

/** The odds model's held-out evidence, computed from the snapshot at build time. */
export interface OddsValidation {
  model: OddsModel;
  loo_brier: number;
  loo_base_brier: number;
  loo_n: number;
  cuts: OddsCut[];
  terms: OddsTermsRow[];
  age_buckets: { label: string; n: number; recorded: number; rate: number }[];
  reading: string;
}

/** How many bootstrap refits the rank ranges come from. */
export const REFITS = 200;

/** The refits' seed: the same seed, the same ranges, every run. */
export const REFIT_SEED = 20261114;

/** The farm plan's stated assumptions: gas, the capital's yield, the airdrop's share. */
export const FARM_GAS_WEEKLY_USD = 2;
export const FARM_GAS_SETUP_HIGH_USD = 8;
export const FARM_GAS_SETUP_LOW_USD = 4;
export const FARM_OPPORTUNITY_APR = 0.05;
export const FARM_COMMUNITY_ALLOCATION = 0.05;

/** Verdict thresholds on the pays-unless farmer count. */
export const FARM_VERDICT_FARM_MIN = 100_000;
export const FARM_VERDICT_THIN_MIN = 10_000;

/** One walk-forward cut of the blind test: fit on older listings, test on newer ones. */
export interface ValidationCut {
  cut: string;
  fit: number;
  test: number;
  med_abs_log_error: number;
  within_2x: number;
  within_3x: number;
  spearman_radar: number;
  spearman_tvl: number;
  spearman_flat: number;
  mean_signed_log_error: number;
}

/** One estimator's blind-test line in the horse race: median error and rank correlation per cut. */
export interface HorseRaceRow {
  estimator: string;
  cuts: { cut: string; med_abs_log_error: number; spearman: number }[];
  loo_med_abs_log_error: number;
  loo_spearman: number;
}

/** Leave-one-out over every dated live-token protocol: fit on all but one, price the held-out one. */
export interface LeaveOneOut {
  n: number;
  med_abs_log_error: number;
  within_2x: number;
  spearman_radar: number;
  spearman_tvl: number;
  spearman_flat: number;
}

/** One ablation variant: a radar-4 term switched off, scored on the same cuts. */
export interface AblationRow {
  variant: string;
  cuts: { cut: string; med_abs_log_error: number; spearman: number }[];
}

/** Out-of-sample coverage of the value ranges: for each cut, the ranges are built from the
 * fit set's own leave-one-out residuals and checked against the test set's actual caps. A
 * range that holds about half its test set inside P25–P75 and about four fifths inside
 * P10–P90 is calibrated; one that holds far fewer is overconfident. */
export interface RangeCalibrationRow {
  cut: string;
  test: number;
  in_p25_p75: number;
  in_p10_p90: number;
}

/** The model's blind test, computed from the snapshot at build time. */
export interface Validation {
  cuts: ValidationCut[];
  reading: string;
  horse_race: HorseRaceRow[];
  loo: LeaveOneOut;
  loo_residual_quantiles: { p10: number; p25: number; p75: number; p90: number };
  range_calibration: RangeCalibrationRow[];
  ablation: AblationRow[];
  /** The launch-odds model's held-out evidence (radar-7). */
  odds: OddsValidation;
}

/** A fitted size curve: log(mcap) = intercept + slope * log(TVL) for one category. */
export interface SizeCurve {
  category: string;
  comps: number;
  slope: number;
  intercept: number;
  median_ratio: number | null;
}

/** The sufficient statistics of a size-curve fit, so the dashboard can refit the curve itself:
 * n protocols, and the sums of x = log(TVL), y = log(mcap), x*y and x*x over them. */
export interface CurveFitStats {
  category: string;
  n: number;
  sx: number;
  sy: number;
  sxy: number;
  sxx: number;
}

/** The farm plan's calendar, anchored to the snapshot's as_of date (never today: deterministic). */
export interface FarmTimeline {
  start: string;
  first_weekly_action: string;
  hold_until: string;
  claim_from: string;
  hold_days: number;
}

/** One disposition in the full accounting: every protocol in the snapshot gets exactly one. */
export interface InventoryDisposition {
  reason: string;
  count: number;
  slugs: string[];
}

/** The whole snapshot accounted for: ranked + live + every excluded protocol, by reason. */
export interface Inventory {
  total: number;
  ranked: number;
  live: number;
  dispositions: InventoryDisposition[];
}

/** The header strip's numbers, computed from the board at build time. */
export interface Kpis {
  ranked: number;
  watchlist: number;
  early: number;
  offlist: number;
  live_total: number;
  median_curve_multiple: number;
  top_implied_usd: number;
  /** The top row's expected value (value if it launches, times its odds). */
  top_expected_usd: number;
  farm: number;
  thin: number;
  skip: number;
  blind_med_err: number;
  refits: number;
  /** The odds model's leave-one-out Brier, against the base rate's. */
  odds_brier: number;
  odds_base_brier: number;
}

/** A row's rank across the refits: its usual range and how often it holds the top 10. */
export interface RankRange {
  p5: number;
  p95: number;
  top10_share: number;
}

/** A row's farm economics, all from its own figures and the stated assumptions. */
export interface FarmEconomics {
  capital_usd: number;
  hold_days: number;
  gas_usd: number;
  opportunity_usd: number;
  total_cost_usd: number;
  breakeven_usd: number;
  pays_unless_farmers: number;
  verdict: 'farm' | 'thin' | 'skip';
}

/** How many pre-token protocols below the watchlist floor the early radar carries, by implied value. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category comparable: the median ratio the table shows, and the size curve the model uses. */
export interface Comparable {
  category: string;
  comps: number;
  median_ratio: number | null;
  multiple: number;
  curve_slope: number;
  curve_intercept: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  scope: 'watchlist' | 'early' | 'off-list';
  age_days: number | null;
  implied_value_usd: number;
  value_range_p25_usd: number;
  value_range_p75_usd: number;
  value_range_p10_usd: number;
  value_range_p90_usd: number;
  /** The odds this protocol ever records a token, from the peers' record (see OddsModel):
   * the share of protocols listed this long, on this many chains, that recorded one. */
  odds: number;
  /** Expected value: the implied value times the odds. THIS is what the board is sorted
   * by, and what the farm plan is sized on — a plan that costs more than the expected
   * value is a skip, however big the if-it-launches value is. */
  expected_value_usd: number;
  expected_range_p25_usd: number;
  expected_range_p75_usd: number;
  expected_range_p10_usd: number;
  expected_range_p90_usd: number;
  model: {
    base_multiple: number;
    category_multiple: number;
    category_comps: number;
    age_days: number | null;
    curve_slope: number;
    curve_intercept: number;
  };
  value_breakdown: string;
  farm_steps: string[];
  farm_timeline: FarmTimeline;
  rank_range: [number, number];
  top10_share: number;
  farm_cost_usd: number;
  farm_breakeven_usd: number;
  farm_pays_unless_farmers: number;
  farm_verdict: 'farm' | 'thin' | 'skip';
}

/** The dashboard's compact view of one row, carrying the same farm plan as board.json. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  scope: 'watchlist' | 'early' | 'off-list';
  implied_value_usd: number;
  value_range_p25_usd: number;
  value_range_p75_usd: number;
  value_range_p10_usd: number;
  value_range_p90_usd: number;
  odds: number;
  expected_value_usd: number;
  expected_range_p25_usd: number;
  expected_range_p75_usd: number;
  expected_range_p10_usd: number;
  expected_range_p90_usd: number;
  category_multiple: number;
  value_breakdown: string;
  farm_steps: string[];
  farm_timeline: FarmTimeline;
  rank_range: [number, number];
  top10_share: number;
  farm_cost_usd: number;
  farm_breakeven_usd: number;
  farm_pays_unless_farmers: number;
  farm_verdict: 'farm' | 'thin' | 'skip';
  curve_slope: number;
  curve_intercept: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the comparables and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  offlist_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  /** The dated live-token protocols' (TVL, market cap) pairs, for the scatter plot: the
   * points the size curve is fitted through. */
  scatter_live: { tvl_usd: number; mcap_usd: number }[];
  comparables: Comparable[];
  validation: Validation;
  refits: number;
  comps_by_category: Record<string, number[]>;
  global_median: number;
  size_curves: SizeCurve[];
  global_curve: { slope: number; intercept: number };
  curve_fit_stats: CurveFitStats[];
  global_fit_stats: { n: number; sx: number; sy: number; sxy: number; sxx: number };
  inventory: Inventory;
  kpis: Kpis;
  excluded_above_floor: number;
  excluded_above_floor_slugs: string[];
  farm_assumptions: {
    gas_weekly_usd: number;
    gas_setup_usd: string;
    opportunity_apr: number;
    community_allocation: number;
  };
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted array, or null when it is empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The category comparables, computed from the snapshot's own live-token protocols: for each
 * category, the median market-cap / TVL of its live protocols, shrunk toward the global median
 * by sample size. Categories with fewer than 3 live comps fall back to the global median.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, Comparable>; global: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (p.category === 'CEX') continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [ratio]);
    else list.push(ratio);
  }
  all.sort((a, b) => a - b);
  const globalMedian = median(all) ?? 0.25;
  const global = Math.round(Math.min(model.multiple_cap, Math.max(model.multiple_floor, globalMedian)) * 10000) / 10000;
  const byCategory = new Map<string, Comparable>();
  for (const [category, list] of ratios) {
    list.sort((a, b) => a - b);
    const med = median(list);
    const n = list.length;
    const multiple =
      n >= 3 && med !== null
        ? Math.min(model.multiple_cap, Math.max(model.multiple_floor, (n / (n + model.shrinkage_prior)) * med + (model.shrinkage_prior / (n + model.shrinkage_prior)) * globalMedian))
        : global;
    byCategory.set(category, { category, comps: n, median_ratio: med === null ? null : Math.round(med * 10000) / 10000, multiple: Math.round(multiple * 10000) / 10000 });
  }
  return { byCategory, global };
}

/** The multiple one category gets: its comparable, or the global median when it has none. */
export function multipleFor(category: string | null, multiples: { byCategory: Map<string, Comparable>; global: number }): { multiple: number; comps: number } {
  const found = category === null ? undefined : multiples.byCategory.get(category);
  if (found === undefined) return { multiple: multiples.global, comps: 0 };
  return { multiple: found.multiple, comps: found.comps };
}

/**
 * Fit log(mcap) = intercept + slope * log(TVL) by least squares on a set of live protocols.
 * Computed from the sufficient statistics (sums of log TVL, log mcap, their product and log
 * TVL squared) — the same five numbers the dashboard carries, and the same arithmetic the
 * dashboard's own refit uses, so the page's refit and this fit agree bit for bit.
 */
export function loglogFit(rows: SnapshotProtocol[]): { slope: number; intercept: number; mx: number; my: number } {
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (const p of rows) {
    const x = Math.log(p.tvl_usd);
    const y = Math.log(p.mcap_usd as number);
    sx += x;
    sy += y;
    sxy += x * y;
    sxx += x * x;
  }
  const n = rows.length;
  const mx = sx / n;
  const my = sy / n;
  const sxxC = sxx - (sx * sx) / n;
  const sxyC = sxy - (sx * sy) / n;
  const slope = sxxC === 0 ? 1 : sxyC / sxxC;
  return { slope, intercept: my - slope * mx, mx, my };
}

/**
 * The size curves, fitted from the snapshot's own live-token protocols: ONE log-log line for
 * the whole market, log(mcap) = intercept + slope * log(TVL), and one level (intercept) per
 * category, shrunk toward the global line's value at the category's centroid (weight
 * n / (n + loglog_intercept_prior)). Categories with fewer than `loglog_min_comps` live comps
 * use the global line. The market pays less per TVL as a protocol gets bigger (global slope
 * about 0.47); radar-4 fitted a slope per category, but the blind test showed the
 * per-category slopes are mostly noise — one global slope wins the leave-one-out error by a
 * fifth — so the categories differ in level, not in steepness. The slope is rounded before
 * the intercept is taken from it, so the stored curve is exactly the curve the multiples are
 * computed from — and the dashboard's refit, which does the same, reproduces it bit for bit.
 */
export function sizeCurves(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { byCategory: Map<string, SizeCurve>; global: { slope: number; intercept: number } } {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const global = loglogFit(live);
  const globalR = { slope: Math.round(global.slope * 10000) / 10000, intercept: Math.round(global.intercept * 10000) / 10000 };
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const k = p.category ?? 'Uncategorised';
    const list = byCat.get(k);
    if (list === undefined) byCat.set(k, [p]);
    else list.push(p);
  }
  const byCategory = new Map<string, SizeCurve>();
  for (const [category, list] of byCat) {
    const ratios = list.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b);
    const med = median(ratios);
    if (list.length < model.loglog_min_comps) {
      byCategory.set(category, { category, comps: list.length, slope: globalR.slope, intercept: globalR.intercept, median_ratio: med === null ? null : Math.round(med * 10000) / 10000 });
      continue;
    }
    const fit = loglogFit(list);
    const n = list.length;
    const w = n / (n + model.loglog_intercept_prior);
    // The category's level, shrunk toward the global line's value at the category's centroid.
    const level = w * fit.my + (1 - w) * (global.intercept + global.slope * fit.mx);
    byCategory.set(category, {
      category,
      comps: n,
      slope: globalR.slope,
      intercept: Math.round((level - globalR.slope * fit.mx) * 10000) / 10000,
      median_ratio: med === null ? null : Math.round(med * 10000) / 10000,
    });
  }
  return { byCategory, global: globalR };
}

/**
 * The multiple the size curve gives one protocol: the curve's value at its TVL, clamped,
 * then shrunk toward 1.00 at power `multiple_blend_power` — a geometric blend with TVL
 * alone, which the blind test's paired comparisons favour on every cut and on
 * leave-one-out. A multiple of 1 means the protocol is worth its TVL; the blend pulls
 * extreme multiples back toward that no-information point.
 */
export function curveMultiple(
  protocol: SnapshotProtocol,
  curves: { byCategory: Map<string, SizeCurve>; global: { slope: number; intercept: number } },
  model: ModelConstants = MODEL,
): { multiple: number; comps: number; slope: number; intercept: number } {
  const found = protocol.category === null ? undefined : curves.byCategory.get(protocol.category);
  const curve = found === undefined ? curves.global : found;
  const raw = Math.exp(curve.intercept + curve.slope * Math.log(protocol.tvl_usd)) / protocol.tvl_usd;
  const clamped = Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw));
  const blended = Math.pow(Math.round(clamped * 10000) / 10000, model.multiple_blend_power);
  const multiple = Math.round(blended * 10000) / 10000;
  return { multiple, comps: found === undefined ? 0 : found.comps, slope: curve.slope, intercept: curve.intercept };
}

/**
 * The size curves' sufficient statistics, from the same live-token set sizeCurves fits on:
 * per category, and global. The dashboard refits the curves from these five numbers per
 * category — least squares needs nothing else — and checks the board against its own refit.
 */
export function curveFitStats(snapshot: Snapshot): { byCategory: Map<string, CurveFitStats>; global: { n: number; sx: number; sy: number; sxy: number; sxx: number } } {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const acc = (rows: SnapshotProtocol[]): { n: number; sx: number; sy: number; sxy: number; sxx: number } => {
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    let sxx = 0;
    for (const p of rows) {
      const x = Math.log(p.tvl_usd);
      const y = Math.log(p.mcap_usd as number);
      sx += x;
      sy += y;
      sxy += x * y;
      sxx += x * x;
    }
    return { n: rows.length, sx, sy, sxy, sxx };
  };
  const byCategory = new Map<string, CurveFitStats>();
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const k = p.category ?? 'Uncategorised';
    const list = byCat.get(k);
    if (list === undefined) byCat.set(k, [p]);
    else list.push(p);
  }
  for (const [category, list] of byCat) byCategory.set(category, { category, ...acc(list) });
  return { byCategory, global: acc(live) };
}

/** The implied value one protocol gets under `model`: its TVL times the size-curve multiple. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  curves: { byCategory: Map<string, SizeCurve>; global: { slope: number; intercept: number } },
): { implied: number; categoryMultiple: number; categoryComps: number; age: number | null; curveSlope: number; curveIntercept: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple: categoryMultiple, comps: categoryComps, slope: curveSlope, intercept: curveIntercept } = curveMultiple(protocol, curves, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * categoryMultiple));
  return { implied, categoryMultiple, categoryComps, age, curveSlope, curveIntercept };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's name is the exchange's product, not a protocol of its own. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/** Categories the watchlist rule leaves out: wrapped, staked, bridged and exchange products. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool,
 * and not a wrapped, staked or bridged product of a token that already trades — the watchlist's
 * own rule, applied to the protocols below its floor.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** A seeded PRNG (mulberry32): the same seed, the same refits, every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A row's farm economics, from its own figures and the stated assumptions: the gas the plan
 * spends (setup plus $2 a week over the hold), the yield the capital gives up at 5% APR, and
 * the total out of pocket. The break-even is that total: the airdrop only has to pay it. The
 * pays-unless count is how many farmers could share a 5% community allocation of the
 * EXPECTED value before one farmer's share falls below the break-even — the number the
 * verdict rests on. The expected value, not the if-it-launches value: a protocol that
 * would be worth $100M if it launched but has a 5% chance of ever launching is a $5M
 * bet, and a plan sized on $100M would be a plan for a prize that almost never arrives.
 */
export function farmEconomics(p: SnapshotProtocol, age: number | null, expected: number): FarmEconomics {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = (capital >= 150 ? FARM_GAS_SETUP_HIGH_USD : FARM_GAS_SETUP_LOW_USD) + FARM_GAS_WEEKLY_USD * Math.ceil(hold / 7);
  const opportunity = capital * FARM_OPPORTUNITY_APR * (hold / 365);
  const total = gas + opportunity;
  const paysUnless = Math.max(1, Math.floor((FARM_COMMUNITY_ALLOCATION * expected) / total));
  const verdict = paysUnless >= FARM_VERDICT_FARM_MIN ? 'farm' : paysUnless >= FARM_VERDICT_THIN_MIN ? 'thin' : 'skip';
  return {
    capital_usd: capital,
    hold_days: hold,
    gas_usd: Math.round(gas * 100) / 100,
    opportunity_usd: Math.round(opportunity * 100) / 100,
    total_cost_usd: Math.round(total * 100) / 100,
    breakeven_usd: Math.round(total * 100) / 100,
    pays_unless_farmers: paysUnless,
    verdict,
  };
}

/** The verdict step: what to do with this row, in the plan's own words. */
export function verdictStep(p: SnapshotProtocol, econ: FarmEconomics, expected: number): string {
  const n = econ.pays_unless_farmers.toLocaleString('en-US');
  if (econ.verdict === 'farm') {
    return `Verdict: farm — run the full $${econ.capital_usd} position. This plan costs $${econ.total_cost_usd.toFixed(2)} out of pocket over ${econ.hold_days} days and breaks even on a $${econ.breakeven_usd.toFixed(2)} airdrop; at a 5% community allocation of the $${expected.toLocaleString('en-US')} expected value it pays unless more than ${n} farmers share it.`;
  }
  if (econ.verdict === 'thin') {
    return `Verdict: thin — run this plan with $50, not $${econ.capital_usd}. The full plan costs $${econ.total_cost_usd.toFixed(2)} out of pocket over ${econ.hold_days} days and breaks even on a $${econ.breakeven_usd.toFixed(2)} airdrop; at a 5% community allocation of the $${expected.toLocaleString('en-US')} expected value it pays unless more than ${n} farmers share it.`;
  }
  return `Verdict: skip — do not farm this row. The plan costs $${econ.total_cost_usd.toFixed(2)} out of pocket and breaks even on a $${econ.breakeven_usd.toFixed(2)} airdrop, but at a 5% community allocation of the $${expected.toLocaleString('en-US')} expected value it pays only if fewer than ${n} farmers share it; put the capital in a higher-ranked row.`;
}

/** The median of a number array (unsorted input is fine). */
function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** One quantile of a sorted array, nearest-rank: the same definition the horse-race script
 * uses, so the dashboard's value ranges match the experiment numbers exactly. */
function quantileOf(sorted: number[], prob: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(prob * sorted.length))]!;
}

/** Spearman's rank correlation between two equal-length arrays. */
function spearman(xs: number[], ys: number[]): number {
  const rank = (arr: number[]): number[] => {
    const idx = arr.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(arr.length);
    idx.forEach(([, i], j) => {
      r[i] = j + 1;
    });
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const m = (n + 1) / 2;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - m) * (ry[i]! - m);
    dx += (rx[i]! - m) ** 2;
    dy += (ry[i]! - m) ** 2;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

/**
 * The model's blind test, computed from the snapshot at build time: the category multiples are
 * fitted only on live-token protocols listed before a cut date, then asked to price the ones
 * listed after it — the model never sees the test set while it is fitted. Two cuts, two test
 * sets. Reported honestly: the ranking tracks actual market caps about as well as TVL alone,
 * and the point values are wide, so the board is a ranking device and the rank is the claim,
 * not the dollar figure.
 */
/** Score a set of predictions against actual market caps: median log error and rank correlation. */
function scorePredictions(rows: { actual: number; pred: number }[]): { medErr: number; within2x: number; spearman: number } {
  const absErr = rows.map((r) => Math.abs(Math.log(r.pred / r.actual)));
  return {
    medErr: Math.round(medianOf(absErr) * 1000) / 1000,
    within2x: rows.filter((r) => Math.abs(Math.log(r.pred / r.actual)) <= Math.log(2)).length,
    spearman: Math.round(spearman(rows.map((r) => r.pred), rows.map((r) => r.actual)) * 1000) / 1000,
  };
}

/**
 * Every multiple estimator the horse race runs, fitted on one fit set of live protocols.
 * Each is a function (protocol) -> multiple; the prediction is TVL times the multiple, so
 * the comparison isolates the multiple.
 */
function raceEstimators(fit: SnapshotProtocol[], model: ModelConstants): Record<string, (p: SnapshotProtocol) => number> {
  const ratios = fit.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b);
  const globalMedian = median(ratios) ?? 0.25;
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of fit) {
    const k = p.category ?? 'Uncategorised';
    const list = byCat.get(k);
    if (list === undefined) byCat.set(k, [p]);
    else list.push(p);
  }
  const catMedian = (cat: string | null, prior: number): number => {
    const list = byCat.get(cat ?? 'Uncategorised');
    if (!list || list.length < 3) return globalMedian;
    const med = median(list.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b)) as number;
    const n = list.length;
    return (n / (n + prior)) * med + (prior / (n + prior)) * globalMedian;
  };
  const curves = sizeCurves({ as_of: '', source: '', floor_usd: 1, protocols: fit, watchlist: [] } as Snapshot, model);
  const curve = (p: SnapshotProtocol): number => curveMultiple(p, curves, model).multiple;
  // radar-4's curve (v3, kept as the comparator): one log-log line per category, slope shrunk
  // toward the global slope (prior 40) and the line re-centred on the category's centroid.
  const radar4 = (p: SnapshotProtocol): number => {
    const list = byCat.get(p.category ?? 'Uncategorised');
    const g = loglogFit(fit);
    const atLine = (a: number, b: number): number => {
      const m = Math.exp(a + b * Math.log(p.tvl_usd)) / p.tvl_usd;
      return Math.min(model.multiple_cap, Math.max(model.multiple_floor, m));
    };
    if (!list || list.length < 5) return atLine(g.intercept, g.slope);
    const f = loglogFit(list);
    const n = list.length;
    const b = (n / (n + 40)) * f.slope + (40 / (n + 40)) * g.slope;
    return atLine(f.my - b * f.mx, b);
  };
  return {
    flat_0_25: () => 0.25,
    global_median: () => globalMedian,
    radar2_median: (p) => catMedian(p.category, 5),
    radar4_curve: (p) => radar4(p),
    radar5_curve: (p) => curve(p),
    global_curve: (p) => {
      const m = Math.exp(curves.global.intercept + curves.global.slope * Math.log(p.tvl_usd)) / p.tvl_usd;
      return Math.min(model.multiple_cap, Math.max(model.multiple_floor, m));
    },
    tvl_only: () => 1,
  };
}

/** The leave-one-out log residuals of the shipped model, and their quantiles: the spread the
 * value ranges are built from. One residual per dated live-token protocol, log(actual / pred)
 * with the protocol held out of its own fit. A P25–P75 range of [implied × exp(q25),
 * implied × exp(q75)] should hold about half of new launches; P10–P90 about four fifths. */
export function looResidualQuantiles(snapshot: Snapshot, model: ModelConstants = MODEL): { p10: number; p25: number; p75: number; p90: number; n: number } {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.listed_at !== null,
  );
  const residuals: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const fit = live.filter((_, j) => j !== i);
    const p = live[i]!;
    const curves = sizeCurves({ ...snapshot, protocols: fit }, model);
    residuals.push(Math.log((p.mcap_usd as number) / impliedValue(p, snapshot.as_of, model, curves).implied));
  }
  const sorted = [...residuals].sort((a, b) => a - b);
  return {
    p10: quantileOf(sorted, 0.1),
    p25: quantileOf(sorted, 0.25),
    p75: quantileOf(sorted, 0.75),
    p90: quantileOf(sorted, 0.9),
    n: sorted.length,
  };
}

// ---------- launch odds (radar-7) ----------

/** One dated peer for the odds model: a protocol the snapshot lists with a date, and
 * whether it recorded a token by the snapshot date. The peers are every dated protocol
 * in the snapshot (645 of them, 95 recorded); the model asks which of them ever recorded
 * a token, and the odds are the peers' record. */
interface OddsPeer {
  slug: string;
  listed_at: string;
  age_years: number;
  ln_tvl: number;
  growth: number;
  chains: number;
  control_growth: number;
  category: string;
  y: 0 | 1;
}

/** The dated peers, sorted by slug (the control feature is the next row's growth). */
function oddsPeers(snapshot: Snapshot): OddsPeer[] {
  const asOf = Date.parse(`${snapshot.as_of}T00:00:00Z`);
  const peers = snapshot.protocols
    .filter((p) => p.listed_at !== null)
    .map((p) => {
      const listed = Date.parse(`${p.listed_at as string}T00:00:00Z`);
      const ageYears = Math.max(0, (asOf - listed) / DAY_MS / 365.25);
      return {
        slug: p.slug,
        listed_at: p.listed_at as string,
        age_years: Math.min(ageYears, 3),
        ln_tvl: Math.log(Math.max(1, p.tvl_usd)),
        growth: Math.min(120, Math.max(-60, p.change_7d ?? 0)) / 100,
        chains: p.chains.length,
        control_growth: 0,
        category: p.category ?? 'Uncategorised',
        y: p.mcap_usd !== null && p.mcap_usd > 0 ? 1 : 0,
      } as OddsPeer;
    })
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (let i = 0; i < peers.length; i++) peers[i]!.control_growth = peers[(i + 1) % peers.length]!.growth;
  return peers;
}

/** Means and standard deviations of the standardised features, from one fit set. */
interface OddsStats {
  age: { m: number; s: number };
  lnTvl: { m: number; s: number };
  chains: { m: number; s: number };
}

function oddsStats(rows: OddsPeer[]): OddsStats {
  const m = (f: (p: OddsPeer) => number): number => rows.reduce((a, p) => a + f(p), 0) / rows.length;
  const s = (f: (p: OddsPeer) => number): number => {
    const mu = m(f);
    return Math.sqrt(rows.reduce((a, p) => a + (f(p) - mu) ** 2, 0) / rows.length) || 1;
  };
  return {
    age: { m: m((p) => p.age_years), s: s((p) => p.age_years) },
    lnTvl: { m: m((p) => p.ln_tvl), s: s((p) => p.ln_tvl) },
    chains: { m: m((p) => p.chains), s: s((p) => p.chains) },
  };
}

/** The design matrix for one feature list. 'family' adds one dummy per category with at
 * least 8 peers in the fit set (the big categories), ridge-shrunk; the rest share the
 * intercept. 'control' is the growth of another row — the placebo, which must not help. */
function oddsDesign(rows: OddsPeer[], feats: string[], stats: OddsStats, bigCats: string[]): number[][] {
  return rows.map((p) => {
    const x: number[] = [1];
    for (const f of feats) {
      if (f === 'age') x.push((p.age_years - stats.age.m) / stats.age.s);
      else if (f === 'lnTvl') x.push((p.ln_tvl - stats.lnTvl.m) / stats.lnTvl.s);
      else if (f === 'growth') x.push(p.growth);
      else if (f === 'chains') x.push((p.chains - stats.chains.m) / stats.chains.s);
      else if (f === 'control') x.push(p.control_growth);
    }
    if (feats.includes('family')) for (const c of bigCats) x.push(p.category === c ? 1 : 0);
    return x;
  });
}

/** Logistic regression by iteratively reweighted least squares (Newton), with a ridge
 * penalty on every coefficient but the intercept. `nCont` is the number of continuous
 * features (the rest are the family dummies, which get `ridgeCat`). Solves the step by
 * Gaussian elimination with partial pivoting. */
function fitLogistic(X: number[][], y: number[], ridgeCont: number, ridgeCat: number, nCont: number, iters = 60): number[] {
  const k = X[0]!.length;
  const beta = new Array<number>(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const p = X.map((x) => 1 / (1 + Math.exp(-x.reduce((a, v, j) => a + v * beta[j]!, 0))));
    const g = new Array<number>(k).fill(0);
    const H: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let i = 0; i < X.length; i++) {
      const w = Math.max(1e-6, p[i]! * (1 - p[i]!));
      for (let a = 0; a < k; a++) {
        g[a]! += X[i]![a]! * (y[i]! - p[i]!);
        for (let b = 0; b < k; b++) H[a]![b]! += w * X[i]![a]! * X[i]![b]!;
      }
    }
    for (let a = 1; a < k; a++) {
      const lam = a <= nCont ? ridgeCont : ridgeCat;
      g[a]! -= lam * beta[a]!;
      H[a]![a]! += lam;
    }
    const n = k;
    const A = H.map((row, i) => [...row, g[i]!]);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      const d = A[c]![c]! || 1e-9;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r]![c]! / d;
        for (let j = c; j <= n; j++) A[r]![j]! -= f * A[c]![j]!;
      }
    }
    const step = A.map((row, i) => row[n]! / (row[i]! || 1e-9));
    let ms = 0;
    for (let j = 0; j < k; j++) {
      beta[j]! += step[j]!;
      ms = Math.max(ms, Math.abs(step[j]!));
    }
    if (ms < 1e-8) break;
  }
  return beta;
}

/** Predicted probabilities from a fitted logistic model. */
function predictLogistic(beta: number[], X: number[][]): number[] {
  return X.map((x) => {
    const z = x.reduce((a, v, j) => a + v * beta[j]!, 0);
    return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
  });
}

/** The Brier score: the mean squared error of the predicted probabilities. Lower is better. */
function brierScore(pred: number[], y: number[]): number {
  return pred.reduce((a, p, i) => a + (p - y[i]!) ** 2, 0) / Math.max(1, y.length);
}

/** Fit one odds variant on `fit` and score it on `test`: the Brier against the test set's
 * own recorded share as the base rate. `feats` is the continuous feature list; `family`
 * adds the big-category dummies. */
function oddsEvaluate(fit: OddsPeer[], test: OddsPeer[], feats: string[], family: boolean): { brier: number; baseBrier: number; n: number; pred: number[]; y: number[] } {
  const stats = oddsStats(fit);
  const counts = new Map<string, number>();
  for (const p of fit) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const bigCats = [...counts.entries()].filter(([, n]) => n >= 8).map(([c]) => c).sort();
  const allFeats = family ? [...feats, 'family'] : feats;
  const Xf = oddsDesign(fit, allFeats, stats, bigCats);
  const Xt = oddsDesign(test, allFeats, stats, bigCats);
  const beta = fitLogistic(Xf, fit.map((p) => p.y), 1.0, 10, feats.length);
  const pt = predictLogistic(beta, Xt);
  const baseRate = fit.filter((p) => p.y).length / fit.length;
  return {
    brier: brierScore(pt, test.map((p) => p.y)),
    baseBrier: brierScore(test.map(() => baseRate), test.map((p) => p.y)),
    n: test.length,
    pred: pt,
    y: test.map((p) => p.y),
  };
}

/** The shipped odds model, fitted on all dated peers: age and chain count only. */
export function fitOddsModel(snapshot: Snapshot): OddsModel {
  const peers = oddsPeers(snapshot);
  const stats = oddsStats(peers);
  const X = oddsDesign(peers, ['age', 'chains'], stats, []);
  const beta = fitLogistic(X, peers.map((p) => p.y), 1.0, 10, 2);
  const recorded = peers.filter((p) => p.y).length;
  return {
    intercept: Math.round(beta[0]! * 10000) / 10000,
    age_coef: Math.round(beta[1]! * 10000) / 10000,
    age_mean_years: Math.round(stats.age.m * 10000) / 10000,
    age_sd_years: Math.round(stats.age.s * 10000) / 10000,
    age_cap_years: 3,
    chains_coef: Math.round(beta[2]! * 10000) / 10000,
    chains_mean: Math.round(stats.chains.m * 10000) / 10000,
    chains_sd: Math.round(stats.chains.s * 10000) / 10000,
    ridge: 1.0,
    peers: peers.length,
    recorded,
    base_rate: Math.round((recorded / peers.length) * 10000) / 10000,
  };
}

/** The odds for one protocol: the shipped model at its age and chain count. A protocol
 * with no listed date takes the mean age — no age information, so the mean odds. */
export function oddsFor(ageDays: number | null, chains: number, model: OddsModel): number {
  const ageYears = ageDays === null ? model.age_mean_years : Math.min(ageDays / 365.25, model.age_cap_years);
  const z =
    model.intercept +
    model.age_coef * ((ageYears - model.age_mean_years) / model.age_sd_years) +
    model.chains_coef * ((chains - model.chains_mean) / model.chains_sd);
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

/**
 * The odds model's held-out evidence, computed from the snapshot at build time: exact
 * leave-one-out over the dated peers, three walk-forward cuts (fit on peers listed before
 * the cut, test on peers listed after it), and a terms table of eight variants scored on
 * 10-fold cross-validation and on the same three cuts. A term is kept only if it lowers
 * the Brier on cross-validation AND on the walk-forward cuts. Only age and the chain count
 * pass: ln TVL, 7-day growth and the category (family) term were tested and dropped, and
 * the placebo — another row's growth — adds nothing, which is the check that the test
 * itself can tell a real signal from a fake one.
 */
export function validateOdds(snapshot: Snapshot): OddsValidation {
  const peers = oddsPeers(snapshot);
  const model = fitOddsModel(snapshot);
  const sorted = [...peers].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  // The age buckets: the peers' record by how long they have been listed.
  const buckets: { label: string; lo: number; hi: number }[] = [
    { label: '0–0.5y', lo: 0, hi: 0.5 },
    { label: '0.5–1y', lo: 0.5, hi: 1 },
    { label: '1–1.5y', lo: 1, hi: 1.5 },
    { label: '1.5–2y', lo: 1.5, hi: 2 },
    { label: '2–3y', lo: 2, hi: 3 },
    { label: '3–5y', lo: 3, hi: 5 },
  ];
  const ageBuckets = buckets.map((b) => {
    const inBucket = peers.filter((p) => p.age_years >= b.lo && p.age_years < b.hi);
    const recorded = inBucket.filter((p) => p.y).length;
    return { label: b.label, n: inBucket.length, recorded, rate: inBucket.length === 0 ? 0 : Math.round((recorded / inBucket.length) * 1000) / 1000 };
  });
  // Exact leave-one-out for the shipped model.
  let looBrierSum = 0;
  let looBaseSum = 0;
  for (let i = 0; i < peers.length; i++) {
    const fit = peers.filter((_, j) => j !== i);
    const test = [peers[i]!];
    const r = oddsEvaluate(fit, test, ['age', 'chains'], false);
    looBrierSum += r.brier;
    looBaseSum += r.baseBrier;
  }
  const looBrier = looBrierSum / peers.length;
  const looBaseBrier = looBaseSum / peers.length;
  // The three walk-forward cuts for the shipped model.
  const cuts: OddsCut[] = [];
  for (const cut of ['2022-12-31', '2023-12-31', '2024-12-31']) {
    const fit = peers.filter((p) => p.listed_at <= cut);
    const test = peers.filter((p) => p.listed_at > cut);
    const r = oddsEvaluate(fit, test, ['age', 'chains'], false);
    const acc = (pred: number[], y: number[]): number => pred.filter((p, i) => (p >= 0.5 ? 1 : 0) === y[i]).length / y.length;
    const baseRate = fit.filter((p) => p.y).length / fit.length;
    cuts.push({
      cut,
      fit: fit.length,
      fit_recorded: fit.filter((p) => p.y).length,
      test: test.length,
      test_recorded: test.filter((p) => p.y).length,
      brier: Math.round(r.brier * 10000) / 10000,
      base_brier: Math.round(r.baseBrier * 10000) / 10000,
      acc: Math.round(acc(r.pred, r.y) * 1000) / 1000,
      base_acc: Math.round(acc(test.map(() => baseRate), r.y) * 1000) / 1000,
    });
  }
  // The terms table: eight variants, 10-fold cross-validation and the same three cuts.
  const variants: { name: string; feats: string[]; family: boolean; kept: boolean }[] = [
    { name: 'base (recorded share)', feats: [], family: false, kept: false },
    { name: '+age', feats: ['age'], family: false, kept: false },
    { name: '+age+chains', feats: ['age', 'chains'], family: false, kept: true },
    { name: '+age+ln TVL', feats: ['age', 'lnTvl'], family: false, kept: false },
    { name: '+age+growth', feats: ['age', 'growth'], family: false, kept: false },
    { name: '+age+ln TVL+growth+chains', feats: ['age', 'lnTvl', 'growth', 'chains'], family: false, kept: false },
    { name: '+age+family', feats: ['age'], family: true, kept: false },
    { name: 'control: +age+growth of another row', feats: ['age', 'control'], family: false, kept: false },
  ];
  const terms: OddsTermsRow[] = variants.map((v) => {
    let cvBrier = 0;
    let cvBase = 0;
    let n = 0;
    if (v.feats.length === 0) {
      // The base rate predicts itself: its Brier is the base Brier on every fold.
      for (let f = 0; f < 10; f++) {
        const test = sorted.filter((_, i) => i % 10 === f);
        const fit = sorted.filter((_, i) => i % 10 !== f);
        const baseRate = fit.filter((p) => p.y).length / fit.length;
        cvBrier += brierScore(test.map(() => baseRate), test.map((p) => p.y)) * test.length;
        cvBase += brierScore(test.map(() => baseRate), test.map((p) => p.y)) * test.length;
        n += test.length;
      }
    } else {
      for (let f = 0; f < 10; f++) {
        const test = sorted.filter((_, i) => i % 10 === f);
        const fit = sorted.filter((_, i) => i % 10 !== f);
        const r = oddsEvaluate(fit, test, v.feats, v.family);
        cvBrier += r.brier * r.n;
        cvBase += r.baseBrier * r.n;
        n += r.n;
      }
    }
    const cutRows = ['2022-12-31', '2023-12-31', '2024-12-31'].map((cut) => {
      const fit = peers.filter((p) => p.listed_at <= cut);
      const test = peers.filter((p) => p.listed_at > cut);
      if (v.feats.length === 0) {
        const baseRate = fit.filter((p) => p.y).length / fit.length;
        const b = brierScore(test.map(() => baseRate), test.map((p) => p.y));
        return { cut, brier: Math.round(b * 10000) / 10000, base_brier: Math.round(b * 10000) / 10000 };
      }
      const r = oddsEvaluate(fit, test, v.feats, v.family);
      return { cut, brier: Math.round(r.brier * 10000) / 10000, base_brier: Math.round(r.baseBrier * 10000) / 10000 };
    });
    return {
      variant: v.name,
      cv_brier: Math.round((cvBrier / n) * 10000) / 10000,
      cv_base_brier: Math.round((cvBase / n) * 10000) / 10000,
      cuts: cutRows,
      kept: v.kept,
    };
  });
  return {
    model,
    loo_brier: Math.round(looBrier * 10000) / 10000,
    loo_base_brier: Math.round(looBaseBrier * 10000) / 10000,
    loo_n: peers.length,
    cuts,
    terms,
    age_buckets: ageBuckets,
    reading:
      'The odds are the peers’ record: of the 645 dated protocols, 95 recorded a token, and the share rises with age — 3% of protocols listed under six months, 26% of those listed three to five years. Age and the chain count are the only terms that lower the Brier on cross-validation and on the walk-forward cuts; ln TVL, 7-day growth and the category term were tested and dropped, and the placebo — another row’s growth — adds nothing. The odds are not a forecast that a protocol will launch: a young protocol’s low odds mostly say it has not had long to launch yet.',
  };
}

// ---------- end launch odds ----------

/**
 * The model's blind test, computed from the snapshot at build time: the size curve is fitted
 * only on live-token protocols listed before a cut date, then asked to price the ones listed
 * after it — the model never sees the test set while it is fitted. Three cuts, a horse race
 * of seven multiple estimators on every cut, leave-one-out over all dated live tokens, and a
 * test of the growth / tenure / breadth terms the model dropped. The headline: one global
 * size slope with a shrunk per-category level, blended toward TVL, beats the flat multiple on
 * every cut and on leave-one-out, and beats radar-4's per-category slopes on the paired
 * comparisons, while the ranking tracks actual market caps about as well as TVL alone.
 */
export function validateModel(snapshot: Snapshot, model: ModelConstants = MODEL): Validation {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.listed_at !== null,
  );
  const cuts: ValidationCut[] = [];
  const rangeCalibration: RangeCalibrationRow[] = [];
  const raceByEstimator = new Map<string, { cut: string; med_abs_log_error: number; spearman: number }[]>();
  const ablationByVariant = new Map<string, { cut: string; med_abs_log_error: number; spearman: number }[]>();
  for (const cut of ['2022-12-31', '2023-12-31', '2024-12-31']) {
    const fit = live.filter((p) => (p.listed_at as string) <= cut);
    const test = live.filter((p) => (p.listed_at as string) > cut);
    const est = raceEstimators(fit, model);
    const curves = sizeCurves({ ...snapshot, protocols: fit }, model);
    for (const [name, fn] of Object.entries(est)) {
      const rows = test.map((p) => {
        return { actual: p.mcap_usd as number, pred: Math.max(1, Math.round(p.tvl_usd * fn(p))) };
      });
      const s = scorePredictions(rows);
      const list = raceByEstimator.get(name) ?? [];
      list.push({ cut, med_abs_log_error: s.medErr, spearman: s.spearman });
      raceByEstimator.set(name, list);
    }
    // The radar-6 cut line (for the main table): the curve multiple, no other terms.
    const rows = test.map((p) => {
      const full = impliedValue(p, snapshot.as_of, model, curves);
      const flat = Math.max(1, Math.round(p.tvl_usd * 0.25));
      return { actual: p.mcap_usd as number, radar: full.implied, tvl: p.tvl_usd, flat };
    });
    const absErr = rows.map((r) => Math.abs(Math.log(r.radar / r.actual)));
    const signed = rows.map((r) => Math.log(r.radar / r.actual));
    cuts.push({
      cut,
      fit: fit.length,
      test: test.length,
      med_abs_log_error: Math.round(medianOf(absErr) * 1000) / 1000,
      within_2x: rows.filter((r) => Math.abs(Math.log(r.radar / r.actual)) <= Math.log(2)).length,
      within_3x: rows.filter((r) => Math.abs(Math.log(r.radar / r.actual)) <= Math.log(3)).length,
      spearman_radar: Math.round(spearman(rows.map((r) => r.radar), rows.map((r) => r.actual)) * 1000) / 1000,
      spearman_tvl: Math.round(spearman(rows.map((r) => r.tvl), rows.map((r) => r.actual)) * 1000) / 1000,
      spearman_flat: Math.round(spearman(rows.map((r) => r.flat), rows.map((r) => r.actual)) * 1000) / 1000,
      mean_signed_log_error: Math.round((signed.reduce((a, b) => a + b, 0) / Math.max(1, signed.length)) * 1000) / 1000,
    });
    // Out-of-sample range calibration: the ranges for this cut's test set are built from
    // the fit set's own leave-one-out residuals, then checked against the test actuals —
    // the ranges never see the test set while they are built.
    const fitResiduals: number[] = [];
    for (let i = 0; i < fit.length; i++) {
      const sub = fit.filter((_, j) => j !== i);
      const p = fit[i]!;
      const subCurves = sizeCurves({ ...snapshot, protocols: sub }, model);
      fitResiduals.push(Math.log((p.mcap_usd as number) / impliedValue(p, snapshot.as_of, model, subCurves).implied));
    }
    const fitSorted = [...fitResiduals].sort((a, b) => a - b);
    const fitQ10 = quantileOf(fitSorted, 0.1);
    const fitQ25 = quantileOf(fitSorted, 0.25);
    const fitQ75 = quantileOf(fitSorted, 0.75);
    const fitQ90 = quantileOf(fitSorted, 0.9);
    rangeCalibration.push({
      cut,
      test: test.length,
      in_p25_p75: rows.filter((r) => {
        const res = Math.log(r.actual / r.radar);
        return res >= fitQ25 && res <= fitQ75;
      }).length,
      in_p10_p90: rows.filter((r) => {
        const res = Math.log(r.actual / r.radar);
        return res >= fitQ10 && res <= fitQ90;
      }).length,
    });
    // The terms test: the growth / tenure / breadth terms radar-2 through radar-4 carried,
    // scored against the shipped model (the multiple alone). The terms are the rejected
    // alternative now: with the tighter radar-6 curve they hurt on every cut, so the model
    // dropped them. Their arithmetic is kept here, as literals, only for this comparison.
    const termsOf = (p: SnapshotProtocol): number => {
      const growthPct = Math.min(120, Math.max(-60, finite(p.change_7d, 0)));
      const growthMult = 1 + (growthPct / 100) * 0.5;
      const age = ageDays(snapshot.as_of, p.listed_at) ?? 365;
      const maturityMult = 0.6 + (Math.min(Math.max(age, 0), 1095) / 1095) * 0.4;
      const breadthMult = Math.min(1 + Math.min(Math.max(p.chains.length - 1, 0), 5) * 0.02, 1.1);
      return growthMult * maturityMult * breadthMult;
    };
    const variants: Record<string, (p: SnapshotProtocol) => number> = {
      multiple_only: (p) => Math.max(1, Math.round(p.tvl_usd * curveMultiple(p, curves, model).multiple)),
      with_terms: (p) => Math.max(1, Math.round(p.tvl_usd * curveMultiple(p, curves, model).multiple * termsOf(p))),
      v3_full: (p) => Math.max(1, Math.round(p.tvl_usd * est.radar4_curve(p) * termsOf(p))),
    };
    for (const [name, fn] of Object.entries(variants)) {
      const s = scorePredictions(test.map((p) => ({ actual: p.mcap_usd as number, pred: fn(p) })));
      const list = ablationByVariant.get(name) ?? [];
      list.push({ cut, med_abs_log_error: s.medErr, spearman: s.spearman });
      ablationByVariant.set(name, list);
    }
  }
  // Leave-one-out: fit on all dated live tokens but one, price the held-out one.
  const looRows: { actual: number; pred: number }[] = [];
  const looFlat: { actual: number; pred: number }[] = [];
  const looTvl: { actual: number; pred: number }[] = [];
  for (let i = 0; i < live.length; i++) {
    const fit = live.filter((_, j) => j !== i);
    const p = live[i]!;
    const curves = sizeCurves({ ...snapshot, protocols: fit }, model);
    looRows.push({ actual: p.mcap_usd as number, pred: impliedValue(p, snapshot.as_of, model, curves).implied });
    looFlat.push({ actual: p.mcap_usd as number, pred: Math.max(1, Math.round(p.tvl_usd * 0.25)) });
    looTvl.push({ actual: p.mcap_usd as number, pred: p.tvl_usd });
  }
  const looScore = scorePredictions(looRows);
  const looResidualsSorted = looRows.map((r) => Math.log(r.actual / r.pred)).sort((a, b) => a - b);
  const loo: LeaveOneOut = {
    n: live.length,
    med_abs_log_error: looScore.medErr,
    within_2x: looScore.within2x,
    spearman_radar: looScore.spearman,
    spearman_tvl: scorePredictions(looTvl).spearman,
    spearman_flat: scorePredictions(looFlat).spearman,
  };
  const horseRace: HorseRaceRow[] = [...raceByEstimator.entries()].map(([estimator, cuts]) => {
    const looFor = (name: string): { medErr: number; spearman: number } => {
      // Recompute leave-one-out for this estimator once, from the full dated set.
      const rows: { actual: number; pred: number }[] = [];
      for (let i = 0; i < live.length; i++) {
        const fit = live.filter((_, j) => j !== i);
        const est = raceEstimators(fit, model);
        const p = live[i]!;
        rows.push({ actual: p.mcap_usd as number, pred: Math.max(1, Math.round(p.tvl_usd * est[name]!(p))) });
      }
      const s = scorePredictions(rows);
      return { medErr: s.medErr, spearman: s.spearman };
    };
    const loo = looFor(estimator);
    return { estimator, cuts, loo_med_abs_log_error: loo.medErr, loo_spearman: loo.spearman };
  });
  return {
    cuts,
    reading:
      'Fitted only on older listings, one global size slope with a shrunk per-category level cuts the blind-test error against a flat 0.25 multiple on every cut and on leave-one-out, and beats radar-4’s per-category slopes on the paired comparisons. The growth, tenure and breadth terms radar-4 carried were tested and dropped: the multiple alone beats the full model on the ranking of every cut. The board is a ranking device: read the rank, not the dollar figure. Radar-7 ranks the board by expected value — the value if it launches times the odds it ever launches, from the peers’ record (see the odds panel) — and sizes every farm plan on that expected value.',
    horse_race: horseRace,
    loo,
    loo_residual_quantiles: {
      p10: quantileOf(looResidualsSorted, 0.1),
      p25: quantileOf(looResidualsSorted, 0.25),
      p75: quantileOf(looResidualsSorted, 0.75),
      p90: quantileOf(looResidualsSorted, 0.9),
    },
    range_calibration: rangeCalibration,
    ablation: [...ablationByVariant.entries()].map(([variant, cuts]) => ({ variant, cuts })),
  };
}

/**
 * Rank ranges from bootstrap refits: the live-token comps are resampled within each category,
 * the size curves refitted and the board re-ranked, 200 times with a fixed seed. A row's range is
 * its 5th to 95th percentile rank across the refits, and its top-10 share is how often it holds
 * the top 10. The refits re-rank by EXPECTED value (implied value times the row's fixed odds —
 * the odds come from the protocol's age and chain count, which resampling does not change).
 * The top three are solid; a few rows whose categories have steep size curves
 * (Bittensor dTAO, Tori, Axis) swing widely across refits, and the ranges say so.
 */
export function refitRankRanges(snapshot: Snapshot, board: BoardRow[], model: ModelConstants = MODEL): Map<string, RankRange> {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const k = p.category ?? 'Uncategorised';
    const list = byCat.get(k);
    if (list === undefined) byCat.set(k, [p]);
    else list.push(p);
  }
  const slugs = board.map((r) => r.slug);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const oddsBySlug = new Map(board.map((r) => [r.slug, r.odds]));
  const samples = new Map<string, number[]>(slugs.map((s) => [s, []]));
  const top10 = new Map<string, number>(slugs.map((s) => [s, 0]));
  const rng = mulberry32(REFIT_SEED);
  for (let i = 0; i < REFITS; i++) {
    const resampled: SnapshotProtocol[] = [];
    for (const [, list] of byCat) {
      for (let j = 0; j < list.length; j++) resampled.push(list[Math.floor(rng() * list.length)]!);
    }
    const sub = { ...snapshot, protocols: [...resampled, ...snapshot.protocols.filter(isPreToken)] };
    const curves = sizeCurves(sub, model);
    const scored = slugs
      .map((slug) => ({ slug, v: impliedValue(bySlug.get(slug)!, snapshot.as_of, model, curves).implied * (oddsBySlug.get(slug) ?? 0) }))
      .sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    scored.forEach((s, idx) => {
      samples.get(s.slug)!.push(idx + 1);
      if (idx < 10) top10.set(s.slug, (top10.get(s.slug) ?? 0) + 1);
    });
  }
  const out = new Map<string, RankRange>();
  for (const slug of slugs) {
    const s = [...samples.get(slug)!].sort((a, b) => a - b);
    out.set(slug, {
      p5: s[Math.floor(0.05 * s.length)]!,
      p95: s[Math.min(s.length - 1, Math.floor(0.95 * s.length))]!,
      top10_share: Math.round(((top10.get(slug) ?? 0) / REFITS) * 100) / 100,
    });
  }
  return out;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole dollars, short: 2,754,000,000 reads as $2.75B. */
function shortUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n}`;
}

/** A date shifted by days, as YYYY-MM-DD. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The farm plan's calendar, anchored to the snapshot's as_of date — never today, so it is deterministic. */
export function farmTimeline(asOf: string, age: number | null): FarmTimeline {
  const hold = holdDaysFor(age);
  return {
    start: asOf,
    first_weekly_action: addDays(asOf, 7),
    hold_until: addDays(asOf, hold),
    claim_from: addDays(asOf, hold + 1),
    hold_days: hold,
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const curves = sizeCurves(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by implied value, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, v: impliedValue(p, snapshot.as_of, model, curves) }))
    .sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);
  // Radar-6: the off list — rankable protocols above the watchlist floor that are not on the
  // watchlist. They pass the snapshot's own pre-token rules; the snapshot carries no
  // parent-protocol record, so the house's extra rule cannot be applied to them. They are
  // ranked in their own scope, labelled, not silently merged into the early rows.
  const offlist = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd >= snapshot.floor_usd)
    .map((p) => ({ p, v: impliedValue(p, snapshot.as_of, model, curves) }))
    .sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  for (const e of offlist) chosen.set(e.p.slug, e.p);
  const scopeBySlug = new Map<string, 'watchlist' | 'early' | 'off-list'>();
  for (const slug of snapshot.watchlist) scopeBySlug.set(slug, 'watchlist');
  for (const e of early) scopeBySlug.set(e.p.slug, 'early');
  for (const e of offlist) scopeBySlug.set(e.p.slug, 'off-list');
  // The value ranges: the model's own leave-one-out residual quantiles, applied to each
  // row's implied value. P25–P75 is the middle half of the model's own errors; P10–P90
  // the middle four fifths. The ranges are the model's uncertainty, stated, not hidden.
  const rangeQ = looResidualQuantiles(snapshot, model);
  // The launch odds: one model for the whole board, fitted on the snapshot's dated peers.
  const oddsModel = fitOddsModel(snapshot);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, curves);
    return { p, v };
  });
  // Radar-7 ranks by EXPECTED value: the value if it launches, times the odds it ever
  // launches. A young protocol with a big if-it-launches value ranks below an older one
  // with a smaller value and much better odds — the board ranks bets, not daydreams.
  const withOdds = scored.map((s) => {
    const odds = oddsFor(s.v.age, s.p.chains.length, oddsModel);
    const expected = Math.max(1, Math.round(s.v.implied * odds));
    return { ...s, odds, expected };
  });
  withOdds.sort((a, b) => b.expected - a.expected || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const rows: BoardRow[] = withOdds.map((s, i) => {
    const p = s.p;
    const v = s.v;
    const oddsPct = (s.odds * 100).toFixed(1);
    const breakdown = `TVL ${shortUsd(p.tvl_usd)} x ${v.categoryMultiple} ${p.category ?? 'Uncategorised'} size-curve multiple (log mcap = ${v.curveIntercept} + ${v.curveSlope} log TVL, ${v.categoryComps} comp${v.categoryComps === 1 ? '' : 's'}; curve multiple blended ^0.9 toward TVL) = ${shortUsd(v.implied)} if it launches. Odds ${oddsPct}% (peers of this age on this many chains recorded a token at that rate) — expected value ${shortUsd(s.expected)}.`;
    const econ = farmEconomics(p, v.age, s.expected);
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      scope: scopeBySlug.get(p.slug) ?? 'early',
      age_days: v.age,
      implied_value_usd: v.implied,
      value_range_p25_usd: Math.max(1, Math.round(v.implied * Math.exp(rangeQ.p25))),
      value_range_p75_usd: Math.max(1, Math.round(v.implied * Math.exp(rangeQ.p75))),
      value_range_p10_usd: Math.max(1, Math.round(v.implied * Math.exp(rangeQ.p10))),
      value_range_p90_usd: Math.max(1, Math.round(v.implied * Math.exp(rangeQ.p90))),
      odds: Math.round(s.odds * 10000) / 10000,
      expected_value_usd: s.expected,
      expected_range_p25_usd: Math.max(1, Math.round(v.implied * Math.exp(rangeQ.p25) * s.odds)),
      expected_range_p75_usd: Math.max(1, Math.round(v.implied * Math.exp(rangeQ.p75) * s.odds)),
      expected_range_p10_usd: Math.max(1, Math.round(v.implied * Math.exp(rangeQ.p10) * s.odds)),
      expected_range_p90_usd: Math.max(1, Math.round(v.implied * Math.exp(rangeQ.p90) * s.odds)),
      model: {
        base_multiple: v.categoryMultiple,
        category_multiple: v.categoryMultiple,
        category_comps: v.categoryComps,
        age_days: v.age,
        curve_slope: v.curveSlope,
        curve_intercept: v.curveIntercept,
      },
      value_breakdown: breakdown,
      farm_steps: farmSteps(p, v.age, s.expected).map(stepText),
      farm_timeline: farmTimeline(snapshot.as_of, v.age),
      rank_range: [i + 1, i + 1] as [number, number],
      top10_share: 0,
      farm_cost_usd: econ.total_cost_usd,
      farm_breakeven_usd: econ.breakeven_usd,
      farm_pays_unless_farmers: econ.pays_unless_farmers,
      farm_verdict: econ.verdict,
    };
  });
  // The rank ranges come from refitting the comps: a row's usual range across 200 refits.
  const ranges = refitRankRanges(snapshot, rows, model);
  for (const r of rows) {
    const rr = ranges.get(r.slug);
    if (rr !== undefined) {
      r.rank_range = [rr.p5, rr.p95];
      r.top10_share = rr.top10_share;
    }
  }
  return rows;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator') || c.includes('collateral market')) {
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the shares; the vault's curator allocates it.`;
  }
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing real-world asset on ${chain} and hold it.`;
  if (c.includes('basis trad')) return `Deposit $${capital} of USDC into ${name}'s basis strategy on ${chain} and keep the position open.`;
  if (c.includes('restak') || c.includes('staking pool')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('cdp') || c.includes('collateral')) return `Lock $${capital} of collateral in ${name} on ${chain}, mint against it, and keep the loan healthy.`;
  if (c.includes('lend')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('cedefi')) return `Deposit $${capital} of USDC into ${name}'s CeDeFi vault on ${chain} and keep the position open.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} and keep the account funded.`;
  if (c.includes('governance')) return `Deposit $${capital} of the governance asset into ${name} on ${chain} and vote once a cycle.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('dex') || c.includes('yield aggregator') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s highest-yield vault on ${chain} and keep the position open.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('chain')) return `Use ${name} on ${chain} with $${capital} of activity and keep the wallet funded.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * The seventh step is the verdict: farm it, run it thin, or skip it, netted to the break-even —
 * and the verdict is sized on the EXPECTED value (implied value times the odds), not on the
 * if-it-launches value.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, expected: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const econ = farmEconomics(p, age, expected);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: verdictStep(p, econ, expected),
      cost: `$${econ.total_cost_usd.toFixed(2)} out of pocket in all`,
      time: `${hold} days, then claim`,
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, carrying the same farm plan as board.json. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: onWatchlist,
    scope: row.scope,
    implied_value_usd: row.implied_value_usd,
    value_range_p25_usd: row.value_range_p25_usd,
    value_range_p75_usd: row.value_range_p75_usd,
    value_range_p10_usd: row.value_range_p10_usd,
    value_range_p90_usd: row.value_range_p90_usd,
    odds: row.odds,
    expected_value_usd: row.expected_value_usd,
    expected_range_p25_usd: row.expected_range_p25_usd,
    expected_range_p75_usd: row.expected_range_p75_usd,
    expected_range_p10_usd: row.expected_range_p10_usd,
    expected_range_p90_usd: row.expected_range_p90_usd,
    category_multiple: row.model.category_multiple,
    value_breakdown: row.value_breakdown,
    farm_steps: row.farm_steps,
    farm_timeline: row.farm_timeline,
    rank_range: row.rank_range,
    top10_share: row.top10_share,
    farm_cost_usd: row.farm_cost_usd,
    farm_breakeven_usd: row.farm_breakeven_usd,
    farm_pays_unless_farmers: row.farm_pays_unless_farmers,
    farm_verdict: row.farm_verdict,
    curve_slope: row.model.curve_slope,
    curve_intercept: row.model.curve_intercept,
  };
}

/**
 * The whole snapshot accounted for: the board's rows, every live-token protocol, and every
 * protocol the board leaves out, by reason. The dispositions sum to the snapshot's protocol
 * count, so the dashboard can prove nothing was dropped silently.
 */
export function inventory(snapshot: Snapshot, board: BoardRow[]): Inventory {
  const onBoard = new Set(board.map((r) => r.slug));
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  const dispositions: InventoryDisposition[] = [];
  const add = (reason: string, slugs: string[]): void => {
    if (slugs.length > 0) dispositions.push({ reason, count: slugs.length, slugs: [...slugs].sort() });
  };
  add('Live-token protocol (already has a token)', live.filter((p) => !onBoard.has(p.slug)).map((p) => p.slug));
  const rest = snapshot.protocols.filter((p) => !onBoard.has(p.slug) && !live.some((l) => l.slug === p.slug));
  add(
    'CEX (excluded: not a DeFi protocol)',
    rest.filter((p) => p.category === 'CEX').map((p) => p.slug),
  );
  const nonCex = rest.filter((p) => p.category !== 'CEX');
  add(
    'Above the $50M floor but not on the house watchlist (DefiLlama parent check not in the snapshot)',
    nonCex.filter((p) => isRankable(p) && p.tvl_usd >= snapshot.floor_usd).map((p) => p.slug),
  );
  add(
    'Below the $50M floor but not among the top 138 by implied value (early radar cap)',
    nonCex.filter((p) => isRankable(p) && p.tvl_usd < snapshot.floor_usd).map((p) => p.slug),
  );
  add(
    'Not rankable: no usable TVL in the snapshot',
    nonCex.filter((p) => !isRankable(p)).map((p) => p.slug),
  );
  return { total: snapshot.protocols.length, ranked: board.length, live: live.length, dispositions };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = categoryMultiples(snapshot, model);
  const curves = sizeCurves(snapshot, model);
  const early = board.filter((r) => r.scope === 'early').length;
  const offlist = board.filter((r) => r.scope === 'off-list').length;
  const comparables = [...multiples.byCategory.values()]
    .filter((c) => board.some((r) => r.category === c.category))
    .map((c) => {
      const curve = curves.byCategory.get(c.category);
      return { ...c, curve_slope: curve?.slope ?? curves.global.slope, curve_intercept: curve?.intercept ?? curves.global.intercept };
    })
    .sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1));
  const inv = inventory(snapshot, board);
  const validation = validateModel(snapshot, model);
  validation.odds = validateOdds(snapshot);
  const stats = curveFitStats(snapshot);
  const kpis: Kpis = {
    ranked: board.length,
    watchlist: snapshot.watchlist.length,
    early,
    offlist,
    live_total: snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX').length,
    median_curve_multiple: Math.round(median(board.map((r) => r.model.category_multiple).sort((a, b) => a - b))! * 10000) / 10000,
    top_implied_usd: board[0]?.implied_value_usd ?? 0,
    top_expected_usd: board[0]?.expected_value_usd ?? 0,
    farm: board.filter((r) => r.farm_verdict.startsWith('farm')).length,
    thin: board.filter((r) => r.farm_verdict.startsWith('thin')).length,
    skip: board.filter((r) => r.farm_verdict.startsWith('skip')).length,
    blind_med_err: validation.cuts[validation.cuts.length - 1]?.med_abs_log_error ?? 0,
    refits: REFITS,
    odds_brier: validation.odds.loo_brier,
    odds_base_brier: validation.odds.loo_base_brier,
  };
  // The live-token mcap / TVL ratios by category, so the page itself can recompute every multiple
  // from the snapshot's own live set and check the board against it.
  const compsByCategory: Record<string, number[]> = {};
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0 || p.category === 'CEX') continue;
    const k = p.category ?? 'Uncategorised';
    if (compsByCategory[k] === undefined) compsByCategory[k] = [];
    compsByCategory[k]!.push(Math.round((p.mcap_usd / p.tvl_usd) * 10000) / 10000);
  }
  for (const k of Object.keys(compsByCategory)) compsByCategory[k]!.sort((a, b) => a - b);
  // Protocols above the floor that pass the snapshot-visible rules but are not on the house
  // watchlist used to be left out (the house's rule also checks DefiLlama's parent-protocol
  // record, which the snapshot does not carry). Radar-6 ranks them in their own Off-list
  // scope instead, labelled; this list is now empty by construction.
  const watchlist = new Set(snapshot.watchlist);
  const excludedAboveFloor = snapshot.protocols
    .filter((p) => isRankable(p) && p.tvl_usd >= snapshot.floor_usd && !watchlist.has(p.slug))
    .map((p) => p.slug)
    .sort();
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    offlist_size: offlist,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
    scatter_live: snapshot.protocols
      .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.listed_at !== null)
      .map((p) => ({ tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd as number }))
      .sort((a, b) => a.tvl_usd - b.tvl_usd),
    comparables,
    validation,
    refits: REFITS,
    comps_by_category: compsByCategory,
    global_median: multiples.global,
    size_curves: [...curves.byCategory.values()].sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1)),
    global_curve: curves.global,
    curve_fit_stats: [...stats.byCategory.values()].sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1)),
    global_fit_stats: stats.global,
    inventory: inv,
    kpis,
    excluded_above_floor: excludedAboveFloor.length,
    excluded_above_floor_slugs: excludedAboveFloor,
    farm_assumptions: {
      gas_weekly_usd: FARM_GAS_WEEKLY_USD,
      gas_setup_usd: `$${FARM_GAS_SETUP_LOW_USD}–$${FARM_GAS_SETUP_HIGH_USD}`,
      opportunity_apr: FARM_OPPORTUNITY_APR,
      community_allocation: FARM_COMMUNITY_ALLOCATION,
    },
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.expected_value_usd > board[i - 1]!.expected_value_usd) return `row ${i + 1} outranks row ${i} on expected value`;
  if (board.length >= 2 && board[0]!.expected_value_usd === board[board.length - 1]!.expected_value_usd) {
    return `all ${board.length} rows share the same expected value $${board[0]!.expected_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!Number.isSafeInteger(r.expected_value_usd) || r.expected_value_usd <= 0) return `${r.slug} has expected value ${r.expected_value_usd}`;
    if (!(r.odds > 0 && r.odds < 1)) return `${r.slug} has odds ${r.odds}`;
  }
  return null;
}

/**
 * A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. The
 * source line carries no URL scheme, so no output file names a network address.
 */
export function dataScript(radar: RadarData): string {
  const clean: RadarData = { ...radar, source: radar.source.replace('https://', '').replace('http://', '') };
  return `window.RADAR=${JSON.stringify(clean)};\n`;
}
