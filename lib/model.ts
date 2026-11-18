// Signal Sweep's model: one sealed snapshot in, one ranked pre-token board out.
//
// The idea in one paragraph. A protocol that records no token has no market
// price, so the board prices it the way the market already prices its peers:
// take every protocol in the same snapshot whose token does trade and whose
// market cap and TVL are both recorded, and look at the ratio of the two.
// That ratio, per category, is what a dollar of TVL has recently been worth
// as a token. A pre-token protocol's implied value is its own TVL times its
// category's ratio, then adjusted by three things the snapshot itself
// reports: how fast its TVL moved in seven days, how long DefiLlama has
// tracked it with no token, and on how many chains it runs.
//
// Nothing here is a hardcoded list of names or a hardcoded multiple. The
// multiples are recomputed from the snapshot on every run:
//
//   ratios        = mcap_usd / tvl_usd for live-token protocols, each
//                   winsorised into [RATIO_FLOOR, RATIO_CAP] so one microcap
//                   outlier cannot bend a whole category
//   globalMult    = the median of those ratios (0.169 on this snapshot, n=144)
//   categoryMult  = (n x category median + SHRINK_K x globalMult) / (n + SHRINK_K),
//                   clamped to [MULT_MIN, MULT_MAX]; a category with no live
//                   peer falls back to globalMult
//   growthMult    = 1 + clamp(change_7d, -50, 100) / 100 x GROWTH_WEIGHT
//   maturityMult  = 0.78 + 0.30 x min(age_days, 1460) / 1460
//                   (age unknown: UNKNOWN_AGE_DAYS)
//   breadthMult   = 1 + 0.03 x min(chains - 1, 6)
//   implied       = round(tvl_usd x categoryMult x growthMult
//                         x maturityMult x breadthMult), at least 1
//
// Who gets ranked. A protocol is a launch candidate when it records no
// token (market cap, CoinGecko id and symbol all null) and is not a
// derivative of a token that already trades: the snapshot's own watchlist
// rule, applied to the whole file instead of only above its floor. Wrapped,
// staked and bridged products, liquid (re)staking wrappers, centralised
// exchanges and versioned pools of another protocol are set aside, because
// their value already trades under the parent token. Every watchlist slug
// is ranked whatever the filter says, and every other rankable protocol is
// ranked too: the board is the full candidate set, not a top-N slice.

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

/** The model's constants, stated in the dashboard so a reader can re-run the maths. */
export interface ModelConstants {
  ratio_floor: number;
  ratio_cap: number;
  shrink_k: number;
  mult_min: number;
  mult_max: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_max_extra: number;
}

export const MODEL: ModelConstants = {
  ratio_floor: 0.02,
  ratio_cap: 2.5,
  shrink_k: 10,
  mult_min: 0.05,
  mult_max: 0.8,
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.78,
  maturity_range: 0.3,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_step: 0.03,
  breadth_max_extra: 6,
};

/** The model's version label, named in the dashboard and in every board row. */
export const MODEL_VERSION = 'sweep-2';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 32;

/** A farm step before it is flattened to the board's string form. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
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
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  note: string;
  model: {
    version: string;
    category_multiple: number;
    cohort_size: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one ranked row: everything the page renders, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  cohort_size: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  note: string;
  farm_steps: string[];
}

/** A protocol whose token already trades: the market's own figures, never a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  protocols_size: number;
  pre_token_size: number;
  set_aside_size: number;
  live_size: number;
  watchlist_size: number;
  board_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when a date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories that are a claim on a token that already trades, never a launch of their own. */
const DERIVATIVE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** DefiLlama's version-marker rule: a name ending in a release is another protocol's pool. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole words that mark a wrapped or staked product of an existing token. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with a centralised exchange's name are that exchange, not a launch candidate. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Why a pre-token protocol is set aside as a derivative product, or null when it is a candidate. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (VERSIONED.test(p.name)) return 'a versioned pool of another protocol';
  if (WRAPPED_WORD.test(p.name)) return 'a wrapped or staked product by name';
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return 'an exchange product by name';
  return null;
}

/** Whether the board may rank a protocol: pre-token and not a derivative of a trading token. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && setAsideReason(p) === null;
}

/** The median of a non-empty list of numbers, taken on a sorted copy. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The multiples the snapshot's own live-token cohort supports, global and per category. */
export interface Multiples {
  global: number;
  byCategory: Map<string, { multiple: number; cohort: number }>;
}

/**
 * Calibrate the multiples from the snapshot: every live-token protocol with
 * both a market cap and a TVL contributes its winsorised mcap/TVL ratio to
 * the global median and to its category's shrunk, clamped multiple.
 */
export function calibrateMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): Multiples {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, model.ratio_floor, model.ratio_cap);
    ratios.push(ratio);
    const key = p.category ?? '';
    const list = perCategory.get(key);
    if (list === undefined) perCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = ratios.length > 0 ? median(ratios) : 0.2;
  const byCategory = new Map<string, { multiple: number; cohort: number }>();
  for (const [category, list] of perCategory) {
    const shrunk = (list.length * median(list) + model.shrink_k * global) / (list.length + model.shrink_k);
    byCategory.set(category, { multiple: clamp(shrunk, model.mult_min, model.mult_max), cohort: list.length });
  }
  return { global, byCategory };
}

/** One protocol's category multiple and the size of the live cohort behind it. */
function multipleFor(p: SnapshotProtocol, multiples: Multiples, model: ModelConstants): { multiple: number; cohort: number } {
  const hit = multiples.byCategory.get(p.category ?? '');
  if (hit !== undefined) return hit;
  return { multiple: clamp(multiples.global, model.mult_min, model.mult_max), cohort: 0 };
}

/** The factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  multiples: Multiples,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; cohort: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const { multiple, cohort } = multipleFor(p, multiples, model);
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_step * Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_extra);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, multiple, cohort, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** A short, figure-carrying sentence that says why a row sits where it sits. */
function noteFor(p: SnapshotProtocol, v: ReturnType<typeof impliedValue>): string {
  const growth = p.change_7d === null ? 'no 7-day TVL change reported' : `TVL ${v.growthPct >= 0 ? '+' : ''}${v.growthPct.toFixed(1)}% over 7 days`;
  const age = v.age === null ? 'tracking start unreported, scored at a 1-year age' : `tracked ${v.age} days with no token recorded`;
  const cohort = v.cohort > 0 ? `multiple ${v.multiple.toFixed(3)} from ${v.cohort} live ${p.category ?? 'uncategorised'} peer${v.cohort === 1 ? '' : 's'}` : `multiple ${v.multiple.toFixed(3)} from the global live cohort (no live peer in its category)`;
  return `${cohort}; ${growth}; ${age}; ${p.chains.length} chain${p.chains.length === 1 ? '' : 's'}.`;
}

/** The protocols the board ranks, strongest first, ranks 1..n, every watchlist slug among them. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = calibrateMultiples(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => ({ p, v: impliedValue(p, snapshot.as_of, multiples, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watch.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    note: noteFor(s.p, s.v),
    model: {
      version: MODEL_VERSION,
      category_multiple: round4(s.v.multiple),
      cohort_size: s.v.cohort,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, kept inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and re-check the protocol's own page weekly.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A rough gas figure for one transaction on a chain, by the chain's fee class. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $10 of ETH gas';
  if (c === 'solana') return 'under $0.10 of SOL fees';
  if (['base', 'arbitrum', 'optimism', 'zksync era', 'linea', 'scroll', 'mantle', 'blast', 'mode', 'taiko'].includes(c)) return 'about $0.50 of gas';
  if (c.includes('bsc') || c.includes('bnb')) return 'about $0.30 of gas';
  if (c === 'polygon') return 'about $0.20 of gas';
  if (c === 'avalanche') return 'about $0.60 of gas';
  return 'about $2 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL tier. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 120;
  if (p.tvl_usd >= 50_000_000) return 80;
  return 50;
}

/** How long to hold, from the protocol's age: a longer record earns a shorter qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's core on-chain action, in words a first-time farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC as collateral in ${n} on ${chain}, then borrow a small amount against it and repay once, so both sides of the market see the wallet`;
  if (c.includes('dex')) return `Swap about $${Math.max(20, Math.floor(capital / 4))} on ${n} on ${chain}, then provide the remaining $${capital - Math.max(20, Math.floor(capital / 4))} as liquidity in its busiest pool and keep the position`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${n} and put the bridged funds to work in one app on the far side`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the staking receipt in the wallet`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('interest rate')) return `Deposit $${capital} of USDC as margin on ${n} and open one small hedged trade, then close it a day later`;
  if (c.includes('prediction')) return `Fund the wallet with $${capital} and take one small position in a liquid market on ${n}, holding it to settlement`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return `Deposit $${capital} into one of ${n}'s curated vaults on ${chain} and keep the vault shares untouched`;
  if (c.includes('yield')) return `Deposit $${capital} into ${n}'s main yield vault on ${chain} and leave the position compounding`;
  if (c.includes('stable') || c.includes('dual-token')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold the minted asset`;
  if (c.includes('rwa') || c.includes('anchor') || c.includes('decentralized btc')) return `Mint $${capital} of ${n}'s asset on ${chain} with the smallest mint it allows and hold the minted asset`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} for the longest term it offers and keep the policy`;
  if (c.includes('basis')) return `Open the basis position ${n} runs on ${chain} with $${capital}: the spot leg and the hedge leg together, never one leg alone`;
  if (c.includes('index')) return `Buy $${capital} of one index basket on ${n} on ${chain} and hold the basket token`;
  if (c.includes('payment') || c.includes('card')) return `Fund $${capital} on ${n}, make one real payment or card transaction, and keep a small balance on the account`;
  if (c.includes('chain')) return `Bridge $${capital} to ${n}'s chain, then make one swap and one transfer there so the wallet has native activity`;
  if (c.includes('governance')) return `Deposit $${capital} into ${n} on ${chain} and vote in the next governance round it opens`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its own app and keep the position open`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * Every figure in it comes from the protocol's own record: its category picks
 * the action, its first chain picks the gas class, its TVL picks the capital
 * tier, its age picks the hold, and a falling 7-day TVL halves the first
 * position and says so in the step itself.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const falling = typeof p.change_7d === 'number' && p.change_7d <= -10;
  const firstCapital = falling ? Math.floor(capital / 2) : capital;
  const steps: FarmStep[] = [
    {
      text: `Verify ${p.name} before any funds move: find its page on DefiLlama, follow only the website listed there, and check the app's contract or program address matches what its own documentation publishes`,
      cost: 'nothing',
      time: '10 minutes',
    },
    {
      text: `Create a fresh wallet for this farm, write its seed phrase on paper, and fund it on ${chain} with the position money plus gas`,
      cost: `${gas} to fund and make the first transaction`,
      time: '5 minutes',
    },
    {
      text: falling
        ? `${actionFor(p, firstCapital, chain)}. Start at half size: its TVL fell ${Math.abs(p.change_7d!)}% in the seven days before the snapshot, so let it stabilise before adding the rest`
        : actionFor(p, capital, chain),
      cost: `$${falling ? firstCapital : capital} of capital plus ${gas}`,
      time: '15 minutes to set up',
    },
    second !== null
      ? {
          text: `Repeat a smaller version of the same action on ${second}, the protocol's second chain, so the farm is not a single-chain footprint`,
          cost: `$${Math.floor(capital / 2)} of capital plus ${gasFor(second)}`,
          time: '10 minutes',
        }
      : {
          text: `Make a second, different qualifying action in ${p.name} a few days later (a second deposit, a vote, or a small swap), so the wallet's history is more than one transaction`,
          cost: `about $${Math.max(10, Math.floor(capital / 5))} of activity plus ${gas}`,
          time: '10 minutes',
        },
    {
      text: `Repeat one small qualifying action in ${p.name} every week while you hold: a deposit top-up, a swap, a borrow-repay cycle or a vote, whichever its app counts`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days and re-check the protocol's TVL trend once a week; if TVL falls for three straight weeks, stop adding and let the hold finish`,
      cost: `the $${capital} stays in the position for the hold`,
      time: `${hold} days`,
    },
    {
      text: `When a points, rewards or claim page appears, reach it only from ${p.name}'s own site or verified social account, never from a search ad or a direct message, and log every transaction hash in a farm diary as you go`,
      cost: 'nothing to check, and never pay anyone to claim',
      time: '10 minutes',
    },
  ];
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
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
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's form for data.js: the page renders the plan from the same strings board.json carries. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    cohort_size: row.model.cohort_size,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    note: row.note,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const multiples = calibrateMultiples(snapshot, model);
  const pre = snapshot.protocols.filter(isPreToken);
  const setAside = pre.filter((p) => setAsideReason(p) !== null).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(multiples.global),
    protocols_size: snapshot.protocols.length,
    pre_token_size: pre.length,
    set_aside_size: setAside,
    live_size: snapshot.protocols.length - pre.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    rows: board.map(radarRow),
    live: liveRows(snapshot),
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

/** Why a board is not one the gate will take, or null when it passes every board-side check. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears on the board twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
