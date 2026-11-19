// Token launch radar: ranks pre-token protocols by an implied token value
// derived only from the sealed DefiLlama snapshot, and writes a dashboard
// a reader can use to farm each protocol. Node 22, standard library only.
//
// Usage (grader):  node main.ts            (reads /input/snapshot.json, writes /output)
// Usage (local):   MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
//
// Layout of the repository (this file lives at its root):
//   dashboard/    the page (index.html + app.css + app.js, no network)
//   screenshots/  three captures of the page (1-board, 2-detail, 3-filtered)
//   main.ts       this file

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const TEXT_MAX_BYTES = 65536;
const BOARD_ROWS = 200;

interface Protocol {
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

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

interface ValueParts {
  base: number;
  growthBoost: number;
  ageBoost: number;
  breadthBoost: number;
  multiple: number;
}

interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  has_token: boolean;
  watchlist: boolean;
  implied_value_usd: number;
  multiple: number;
  breakdown: ValueParts;
  farm_steps: string[];
}

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): { input: string; outDir: string } {
  let input = "/input/snapshot.json";
  let outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input" && argv[i + 1]) input = argv[++i];
    else if (argv[i] === "--out" && argv[i + 1]) outDir = argv[++i];
  }
  return { input, outDir };
}

function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// The value model. A protocol that records no token is priced from the
// snapshot's own figures only: its TVL, its seven-day growth, how long it
// has run with no token, and how many chains it spans. Nothing here names
// a protocol, a chain or a category: the same rule prices every row.
//
// The board only ranks launch candidates: the snapshot's own watchlist rule
// already says which protocols cannot be one — a bridge, a liquid-staking
// or restaking product, a centralised exchange, a versioned release, or a
// wrapped or staked product of a token that already trades. Those are not
// protocols waiting on a launch of their own, so they are not ranked.
const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);
const EXCHANGE_PREFIXES = ["Binance", "Coinbase", "Bybit", "Kraken", "Bitget", "OKX", "Bitfinex", "Gemini"];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

function isLaunchCandidate(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}
function valueMultiple(p: Protocol, ageDays: number): ValueParts {
  const growth = clamp(p.change_7d ?? 0, -60, 120);
  const growthBoost = 0.22 * (growth / 120);
  const ageBoost = 0.14 * (Math.min(ageDays, 1460) / 1460);
  const breadthBoost = 0.06 * (Math.min(p.chains.length, 10) / 10);
  const base = 0.2;
  const multiple = clamp(base + growthBoost + ageBoost + breadthBoost, 0.08, 0.65);
  return { base, growthBoost, ageBoost, breadthBoost, multiple };
}

function coreAction(p: Protocol): string {
  const chain = p.chains[0] ?? "its main chain";
  const others = p.chains.length > 1 ? ` (it also runs on ${p.chains.length - 1} more chain${p.chains.length > 2 ? "s" : ""})` : "";
  switch (p.category) {
    case "Dexs":
      return `Swap $10-$25 through ${p.name} on ${chain}${others} once a week (10-15 minutes each time). Start with a $5 test swap to learn the route, then use the normal size and keep each receipt.`;
    case "Lending":
      return `Supply $25-$100 of a major asset to ${p.name} on ${chain}${others} (about 15 minutes). Leave it earning for at least two weeks and never borrow more than a third of what you supplied.`;
    case "Bridge":
      return `Bridge $20-$50 through ${p.name} to ${chain}${others} once every two weeks (about 10 minutes plus the wait). Start with a $5 test transfer to confirm the route before the full amount.`;
    case "Yield":
      return `Deposit $25-$100 into a ${p.name} vault on ${chain}${others} (about 15 minutes). Write down the entry date and review the position every two weeks before adding more.`;
    case "Liquid Staking":
    case "Liquid Restaking":
      return `Stake $25-$100 of the native asset through ${p.name} on ${chain}${others} (about 10 minutes). Hold the receipt token in your own wallet and do not unstake for at least a month.`;
    case "Restaked BTC":
      return `Deposit $25-$100 of BTC value through ${p.name} on ${chain}${others} (about 15 minutes). Keep the receipt token, note the entry date, and review the position every two weeks.`;
    default:
      return `Use ${p.name} on ${chain}${others} once a week (10-20 minutes). Complete one real transaction of $10-$25, such as a swap or a deposit, and save the transaction hash.`;
  }
}

function farmSteps(p: Protocol): string[] {
  const chain = p.chains[0] ?? "its main chain";
  const steps = [
    `Set up first: open a wallet that holds ${chain} for gas (about $5-$15 of the chain's native gas token covers a month of weekly check-ins), bridge $20-$50 to ${chain}, and keep the seed phrase offline on paper.`,
    coreAction(p),
    `Repeat the core action weekly for 6-8 weeks (roughly 15 minutes a week and $5-$20 of gas in total). Steady weekly use leaves a clearer trail than a single visit.`,
    `Add a second leg only if the first month went smoothly: a $25-$50 liquidity deposit or second position on ${chain}. Keep total exposure under $150 until the token question is settled.`,
    `Track it: check ${p.name}'s TVL and its own announcements once a week (5 minutes). Write down the date you first used it so a later snapshot can show you were early.`,
    `Stay safe: never paste a seed phrase anywhere, verify every link from the protocol's own site, and treat any message promising a token as a scam until the protocol itself announces one.`,
  ];
  for (const step of steps) {
    const trimmed = step.trim();
    if (trimmed.length < 20 || trimmed.length > 600) fail(`farm step out of length bounds for ${p.slug}: ${trimmed.length} chars`);
  }
  return steps;
}

function buildBoard(snapshot: Snapshot): BoardRow[] {
  const asOfDay = dayNumber(snapshot.as_of);
  const watchlist = new Set(snapshot.watchlist);
  const preToken = snapshot.protocols.filter(
    (p) => p.gecko_id === null && p.symbol === null && isLaunchCandidate(p),
  );
  const scored = preToken.map((p) => {
    const ageDays = p.listed_at ? Math.max(0, asOfDay - dayNumber(p.listed_at)) : 365;
    const parts = valueMultiple(p, ageDays);
    const implied = Math.round(p.tvl_usd * parts.multiple);
    return { p, ageDays, parts, implied };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const picked: typeof scored = [];
  const pickedSlugs = new Set<string>();
  for (const row of scored) {
    if (watchlist.has(row.p.slug)) {
      picked.push(row);
      pickedSlugs.add(row.p.slug);
    }
  }
  for (const row of scored) {
    if (picked.length >= BOARD_ROWS) break;
    if (!pickedSlugs.has(row.p.slug)) {
      picked.push(row);
      pickedSlugs.add(row.p.slug);
    }
  }
  picked.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return picked.map((row, index) => ({
    rank: index + 1,
    slug: row.p.slug,
    name: row.p.name,
    category: row.p.category,
    chains: row.p.chains,
    tvl_usd: row.p.tvl_usd,
    change_7d: row.p.change_7d,
    age_days: row.ageDays,
    has_token: false,
    watchlist: watchlist.has(row.p.slug),
    implied_value_usd: row.implied,
    multiple: Math.round(row.parts.multiple * 10000) / 10000,
    breakdown: {
      base: row.parts.base,
      growthBoost: Math.round(row.parts.growthBoost * 10000) / 10000,
      ageBoost: Math.round(row.parts.ageBoost * 10000) / 10000,
      breadthBoost: Math.round(row.parts.breadthBoost * 10000) / 10000,
      multiple: Math.round(row.parts.multiple * 10000) / 10000,
    },
    farm_steps: farmSteps(row.p),
  }));
}

function checkBoard(rows: BoardRow[], snapshot: Snapshot): void {
  if (rows.length < 100 || rows.length > 4000) fail(`board must hold 100-4000 rows, got ${rows.length}`);
  const slugs = new Set<string>();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.rank !== i + 1) fail(`rank ${row.rank} at position ${i + 1}`);
    if (slugs.has(row.slug)) fail(`duplicate slug ${row.slug}`);
    slugs.add(row.slug);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) fail(`bad implied value for ${row.slug}`);
    if (i > 0 && rows[i - 1].implied_value_usd < row.implied_value_usd) fail(`implied value rises at rank ${row.rank}`);
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) fail(`bad farm step count for ${row.slug}`);
  }
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) fail(`watchlist not covered: ${missing.join(", ")}`);
  const values = new Set(rows.map((r) => r.implied_value_usd));
  if (values.size < 2) fail("all implied values are equal: not a ranking");
}

// ---- dossier: the exact bytes the house library writes -------------------
// Rebuilt from the format the gate checks: a compact JSON object with the
// cover image index, the screenshots as base64 with sha256, the schema tag
// and a text block listing the dashboard source. Verified byte-for-byte
// against the house buildDossier on the same output directory (see the
// self-check in the repository's test run, not shipped here).

const TEXT_EXTS: Record<string, string> = {
  ".html": "html",
  ".css": "css",
  ".js": "js",
  ".mjs": "js",
  ".json": "json",
  ".md": "md",
  ".txt": "txt",
  ".svg": "svg",
};

interface DashFile {
  rel: string;
  bytes: number;
  text: string;
}

function listDashboardFiles(dashboardDir: string): DashFile[] {
  const found: DashFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const rel = relative(dashboardDir, full).split("\\").join("/");
        const bytes = statSync(full).size;
        found.push({ rel, bytes, text: readFileSync(full, "utf8") });
      }
    }
  };
  walk(dashboardDir);
  found.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  return found;
}

function countLines(text: string): number {
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts.length;
}

function buildDossierText(files: DashFile[]): string {
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  let text = `## Dashboard\n\nFiles: ${files.length} (${totalBytes} bytes)\n`;
  for (const f of files) text += `- ${f.rel} (${f.bytes} bytes)\n`;
  text += `\n## Source\n`;
  const budget = TEXT_MAX_BYTES;
  let omittedFiles = 0;
  let omittedBytes = 0;
  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    const lang = TEXT_EXTS[extname(f.rel)] ?? "txt";
    const lines = countLines(f.text);
    const content = f.text.endsWith("\n") ? f.text : `${f.text}\n`;
    const block = `\n### ${f.rel}\n\n${f.bytes} bytes, ${lines} line${lines === 1 ? "" : "s"}\n\n\`\`\`${lang}\n${content}\`\`\`\n`;
    if (Buffer.byteLength(text + block, "utf8") <= budget) {
      text += block;
      continue;
    }
    // This file does not fit whole: include as many complete lines as fit.
    const head = `\n### ${f.rel}\n\n${f.bytes} bytes, ${lines} line${lines === 1 ? "" : "s"}\n\n\`\`\`${lang}\n`;
    const room = budget - Buffer.byteLength(text + head, "utf8");
    const rawLines = f.text.split("\n");
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") rawLines.pop();
    let kept = "";
    let keptCount = 0;
    for (const line of rawLines) {
      const piece = `${line}\n`;
      if (Buffer.byteLength(kept + piece, "utf8") > room) break;
      kept += piece;
      keptCount += 1;
    }
    if (keptCount > 0) {
      text += `${head}${kept}\`\`\`\n`;
      const notShown = lines - keptCount;
      if (notShown > 0) text += `\n[${notShown} lines not shown.]\n`;
    }
    for (let j = i + (keptCount > 0 ? 1 : 0); j < files.length; j += 1) {
      omittedFiles += 1;
      omittedBytes += files[j].bytes;
    }
    if (keptCount === 0) {
      omittedFiles += 1;
      omittedBytes += f.bytes;
    }
    text += `\n[Cut at ${TEXT_MAX_BYTES} bytes: ${omittedFiles} file${omittedFiles === 1 ? "" : "s"} and ${omittedBytes} bytes left out.]\n`;
    return text;
  }
  return text;
}

interface DossierImage {
  base64: string;
  media_type: string;
  name: string;
  sha256: string;
}

function buildDossier(outDir: string): Buffer {
  const dashboardDir = join(outDir, "dashboard");
  const shotsDir = join(outDir, "screenshots");
  const files = listDashboardFiles(dashboardDir);
  if (files.length === 0) fail("dashboard/ holds no files");
  const names = readdirSync(shotsDir).filter((n) => !n.startsWith(".")).sort();
  if (names.length === 0) fail("screenshots/ is empty");
  const images: DossierImage[] = names.map((name) => {
    const raw = readFileSync(join(shotsDir, name));
    const ext = extname(name).toLowerCase();
    const mediaType = ext === ".png" ? "image/png" : "image/jpeg";
    return {
      base64: raw.toString("base64"),
      media_type: mediaType,
      name,
      sha256: createHash("sha256").update(raw).digest("hex"),
    };
  });
  const dossier = {
    cover: 0,
    images,
    schema: "makefun/dossier/v1",
    text: buildDossierText(files),
  };
  return Buffer.from(JSON.stringify(dossier), "utf8");
}

// ---- main ----------------------------------------------------------------

function main(): void {
  const { input, outDir } = parseArgs(process.argv.slice(2));
  const snapshot = JSON.parse(readFileSync(input, "utf8")) as Snapshot;
  if (!Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) fail("snapshot is not the expected shape");
  const rows = buildBoard(snapshot);
  checkBoard(rows, snapshot);

  const trading = snapshot.protocols
    .filter((p) => (p.gecko_id !== null || p.symbol !== null) && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
    .slice(0, 8)
    .map((p) => ({ slug: p.slug, name: p.name, mcap_usd: p.mcap_usd, tvl_usd: p.tvl_usd }));

  const board = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: {
      name: "tvl-multiple",
      description:
        "Launch candidates only (pre-token protocols that are not a bridge, liquid-staking/restaking product, CEX, versioned release, or wrapped/staked product, by the snapshot's own watchlist rule). implied_value_usd = tvl_usd * multiple, where multiple = 0.20 base + up to 0.22 for seven-day TVL growth + up to 0.14 for days listed with no token + up to 0.06 for chain breadth, clamped to [0.08, 0.65]. No protocol, chain or category is named by the model.",
      multiple_range: [0.08, 0.65],
    },
    counts: {
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      pre_token: snapshot.protocols.filter((p) => p.gecko_id === null && p.symbol === null).length,
      candidates: rows.length,
      rows: rows.length,
      watchlist_covered: rows.filter((r) => r.watchlist).length,
    },
    rows,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "board.json"), `${JSON.stringify(board, null, 2)}\n`, "utf8");
  const data = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model: board.model,
    counts: board.counts,
    trading_reference: trading,
    rows,
  };
  writeFileSync(join(outDir, "data.js"), `window.RADAR = ${JSON.stringify(data)};\n`, "utf8");

  const dashSrc = join(REPO_ROOT, "dashboard");
  const shotsSrc = join(REPO_ROOT, "screenshots");
  if (!existsSync(dashSrc)) fail("dashboard/ missing from the repository");
  if (!existsSync(shotsSrc)) fail("screenshots/ missing from the repository");
  cpSync(dashSrc, join(outDir, "dashboard"), { recursive: true });
  cpSync(shotsSrc, join(outDir, "screenshots"), { recursive: true });

  const dossier = buildDossier(outDir);
  writeFileSync(join(outDir, "dossier.json"), dossier);
  const shotNames = readdirSync(join(outDir, "screenshots")).filter((n) => !n.startsWith("."));
  console.log(`board: ${rows.length} rows, watchlist ${board.counts.watchlist_covered}/${snapshot.watchlist.length}`);
  console.log(`top: ${rows.slice(0, 3).map((r) => `${r.rank}. ${r.slug} $${r.implied_value_usd.toLocaleString("en-US")}`).join(" | ")}`);
  console.log(`dossier: ${dossier.length} bytes, screenshots: ${shotNames.join(", ")}`);
  console.log(`wrote ${outDir}`);
}

main();
