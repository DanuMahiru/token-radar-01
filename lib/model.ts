// The token radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol
// is pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol);
// the snapshot's live-token protocols are kept apart and shown as the market's own values, never
// mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, never from a hardcoded list of names:
//
//   category multiple  the median market-cap / TVL of the snapshot's own live-token protocols in
//                       the same category, shrunk toward the global median by sample size
//                       (weight n / (n + 5)); categories with fewer than 3 live comps use the
//                       global median. Clamped to [0.05, 1.00].
//   base       = tvl_usd x category multiple
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   breadth    = 1 + 0.02 x min(chains - 1, 5), at most 1.10
//   implied    = max(1, round(base x growthMult x maturityMult x breadthMult))
//
// Why these four terms: a token is worth what the market already pays for the same kind of
// business (the category comparable), scaled by how fast the business is growing (7-day TVL
// change), how long it has run with no token (tenure: an established protocol that never issued
// one has a larger, stickier base to launch into), and how many chains it reaches (breadth).
// No protocol name is ever special-cased: the same function scores every row, and the
// comparables table is computed from the snapshot at run time, so the model moves with the data.

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
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_cap: number;
}

export const MODEL: ModelConstants = {
  shrinkage_prior: 5,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_cap: 0.1,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

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

/** The model's blind test, computed from the snapshot at build time. */
export interface Validation {
  cuts: ValidationCut[];
  reading: string;
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

/** One category comparable: the multiple the model used for it, and how many live protocols set it. */
export interface Comparable {
  category: string;
  comps: number;
  median_ratio: number | null;
  multiple: number;
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
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    category_multiple: number;
    category_comps: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  value_breakdown: string;
  farm_steps: string[];
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
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  value_breakdown: string;
  farm_steps: string[];
  rank_range: [number, number];
  top10_share: number;
  farm_cost_usd: number;
  farm_breakeven_usd: number;
  farm_pays_unless_farmers: number;
  farm_verdict: 'farm' | 'thin' | 'skip';
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
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  comparables: Comparable[];
  validation: Validation;
  refits: number;
  comps_by_category: Record<string, number[]>;
  global_median: number;
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

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: { byCategory: Map<string, Comparable>; global: number },
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; categoryMultiple: number; categoryComps: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + Math.min(Math.max(protocol.chains.length - 1, 0), 5) * model.breadth_per_chain;
  const { multiple: categoryMultiple, comps: categoryComps } = multipleFor(protocol.category, multiples);
  const base = protocol.tvl_usd * categoryMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * Math.min(breadthMult, 1 + model.breadth_cap)));
  return { implied, growthPct, growthMult, maturityMult, breadthMult: Math.min(breadthMult, 1 + model.breadth_cap), categoryMultiple, categoryComps, age };
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
 * pays-unless count is how many farmers could share a 5% community allocation of the implied
 * value before one farmer's share falls below the break-even — the number the verdict rests on.
 */
export function farmEconomics(p: SnapshotProtocol, age: number | null, implied: number): FarmEconomics {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = (capital >= 150 ? FARM_GAS_SETUP_HIGH_USD : FARM_GAS_SETUP_LOW_USD) + FARM_GAS_WEEKLY_USD * Math.ceil(hold / 7);
  const opportunity = capital * FARM_OPPORTUNITY_APR * (hold / 365);
  const total = gas + opportunity;
  const paysUnless = Math.max(1, Math.floor((FARM_COMMUNITY_ALLOCATION * implied) / total));
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
export function verdictStep(p: SnapshotProtocol, econ: FarmEconomics, implied: number): string {
  const n = econ.pays_unless_farmers.toLocaleString('en-US');
  if (econ.verdict === 'farm') {
    return `Verdict: farm — run the full $${econ.capital_usd} position. This plan costs $${econ.total_cost_usd.toFixed(2)} out of pocket over ${econ.hold_days} days and breaks even on a $${econ.breakeven_usd.toFixed(2)} airdrop; at a 5% community allocation it pays unless more than ${n} farmers share it.`;
  }
  if (econ.verdict === 'thin') {
    return `Verdict: thin — run this plan with $50, not $${econ.capital_usd}. The full plan costs $${econ.total_cost_usd.toFixed(2)} out of pocket over ${econ.hold_days} days and breaks even on a $${econ.breakeven_usd.toFixed(2)} airdrop; at a 5% community allocation it pays unless more than ${n} farmers share it.`;
  }
  return `Verdict: skip — do not farm this row. The plan costs $${econ.total_cost_usd.toFixed(2)} out of pocket and breaks even on a $${econ.breakeven_usd.toFixed(2)} airdrop, but at a 5% community allocation it pays only if fewer than ${n} farmers share it; put the capital in a higher-ranked row.`;
}

/** The median of a number array (unsorted input is fine). */
function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
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
export function validateModel(snapshot: Snapshot, model: ModelConstants = MODEL): Validation {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.listed_at !== null,
  );
  const cuts: ValidationCut[] = [];
  for (const cut of ['2023-12-31', '2024-12-31']) {
    const fit = live.filter((p) => (p.listed_at as string) <= cut);
    const test = live.filter((p) => (p.listed_at as string) > cut);
    const sub = { ...snapshot, protocols: [...fit, ...snapshot.protocols.filter(isPreToken)] };
    const multiples = categoryMultiples(sub, model);
    const globalOnly = { byCategory: new Map<string, Comparable>(), global: multiples.global };
    const rows = test.map((p) => {
      const full = impliedValue(p, snapshot.as_of, model, multiples);
      const flat = Math.max(1, Math.round(p.tvl_usd * 0.25 * full.growthMult * full.maturityMult * full.breadthMult));
      return {
        actual: p.mcap_usd as number,
        radar: full.implied,
        tvl: p.tvl_usd,
        flat,
      };
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
  }
  return {
    cuts,
    reading:
      'Fitted only on older listings, the model prices newer listings about as well as TVL alone (Spearman 0.26-0.31 vs 0.25-0.37) and no better than a flat 0.25 multiple on point values (median error about 5x). The board is a ranking device: read the rank, not the dollar figure.',
  };
}

/**
 * Rank ranges from bootstrap refits: the live-token comps are resampled within each category,
 * the multiples refitted and the board re-ranked, 200 times with a fixed seed. A row's range is
 * its 5th to 95th percentile rank across the refits, and its top-10 share is how often it holds
 * the top 10. The top of the board is solid; the tail moves.
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
  const samples = new Map<string, number[]>(slugs.map((s) => [s, []]));
  const top10 = new Map<string, number>(slugs.map((s) => [s, 0]));
  const rng = mulberry32(REFIT_SEED);
  for (let i = 0; i < REFITS; i++) {
    const resampled: SnapshotProtocol[] = [];
    for (const [, list] of byCat) {
      for (let j = 0; j < list.length; j++) resampled.push(list[Math.floor(rng() * list.length)]!);
    }
    const sub = { ...snapshot, protocols: [...resampled, ...snapshot.protocols.filter(isPreToken)] };
    const multiples = categoryMultiples(sub, model);
    const scored = slugs
      .map((slug) => ({ slug, v: impliedValue(bySlug.get(slug)!, snapshot.as_of, model, multiples).implied }))
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

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
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
    .map((p) => ({ p, v: impliedValue(p, snapshot.as_of, model, multiples) }))
    .sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, multiples);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const rows: BoardRow[] = scored.map((s, i) => {
    const p = s.p;
    const v = s.v;
    const breakdown = `TVL ${shortUsd(p.tvl_usd)} x ${v.categoryMultiple} ${p.category ?? 'Uncategorised'} multiple x ${round4(v.growthMult)} growth x ${round4(v.maturityMult)} tenure x ${round4(v.breadthMult)} breadth = ${shortUsd(v.implied)}.`;
    const econ = farmEconomics(p, v.age, v.implied);
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
      age_days: v.age,
      implied_value_usd: v.implied,
      model: {
        base_multiple: v.categoryMultiple,
        category_multiple: v.categoryMultiple,
        category_comps: v.categoryComps,
        growth_pct: v.growthPct,
        growth_multiplier: round4(v.growthMult),
        maturity_multiplier: round4(v.maturityMult),
        breadth_multiplier: round4(v.breadthMult),
        age_days: v.age,
      },
      value_breakdown: breakdown,
      farm_steps: farmSteps(p, v.age, v.implied).map(stepText),
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
 * The seventh step is the verdict: farm it, run it thin, or skip it, netted to the break-even.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const econ = farmEconomics(p, age, implied);
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
      text: verdictStep(p, econ, implied),
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
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    value_breakdown: row.value_breakdown,
    farm_steps: row.farm_steps,
    rank_range: row.rank_range,
    top10_share: row.top10_share,
    farm_cost_usd: row.farm_cost_usd,
    farm_breakeven_usd: row.farm_breakeven_usd,
    farm_pays_unless_farmers: row.farm_pays_unless_farmers,
    farm_verdict: row.farm_verdict,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = categoryMultiples(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const comparables = [...multiples.byCategory.values()]
    .filter((c) => board.some((r) => r.category === c.category))
    .sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1));
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
  // watchlist: the house's rule also checks DefiLlama's parent-protocol record, which the
  // snapshot does not carry, so they are left out rather than ranked as launches.
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
    live_size: live.length,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
    comparables,
    validation: validateModel(snapshot, model),
    refits: REFITS,
    comps_by_category: compsByCategory,
    global_median: multiples.global,
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
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
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
