[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yuyan5319-crypto/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yuyan5319-crypto/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Signal Sweep — Token Launch Radar

A token launch radar for make.fun's **token-radar-01** ("Build the best token
launch radar"). It reads the sealed DefiLlama snapshot, finds the protocols
that record no token yet, and ranks them by an implied value with a concrete
farm plan for each.

## The model (sweep-2)

No hardcoded names and no hardcoded multiple. On every run the model
calibrates itself from the snapshot's own live-token cohort:

- For each category, take the live protocols' market-cap / TVL ratios
  (winsorised to [0.02, 2.5]), shrink the category median toward the global
  median (0.169 on this snapshot, from 144 live peers), and clamp to [0.05, 0.80].
- Implied value = TVL × category multiple × growth multiplier (7-day TVL
  change, clamped) × maturity multiplier (days tracked with no token) ×
  breadth multiplier (chains it runs on).
- Candidates are pre-token protocols that are not derivatives of a token
  that already trades: wrapped, staked and bridged products, liquid
  (re)staking wrappers, centralised exchanges and versioned pools are set
  aside and counted on the dashboard. Every watchlist protocol is ranked,
  plus every other candidate in the snapshot — 197 rows on this snapshot.

## Layout

- `main.ts` — the hand-in program (Node 22, standard library only): reads
  `/input/snapshot.json`, writes `/output/board.json` and `/output/data.js`,
  copies `dashboard/` and `screenshots/`, writes `/output/dossier.json`.
- `lib/model.ts` — the radar itself: snapshot parsing, multiple calibration,
  candidate filtering, implied values, farm plans, gate self-checks.
- `dashboard/` — the static page: a sortable, filterable board, a detail
  view per protocol with its model breakdown and farm plan, and a Live view
  of tokens that already trade. Renders fully offline.
- `screenshots/` — three captures of the dashboard: the board, one
  protocol's detail view, and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored unchanged.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Then open `out/dashboard/index.html` in a browser.
