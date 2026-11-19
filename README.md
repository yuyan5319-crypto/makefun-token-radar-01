# makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yuyan5319-crypto/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yuyan5319-crypto/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar: a board of pre-token protocols ranked by implied token value, with a farm plan for each. The value model uses only the sealed snapshot — TVL, 7-day growth, days listed with no token, chain breadth — and names no protocol, chain or category.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

`main.ts` reads the snapshot, writes `board.json` (200 ranked rows, all 40 watchlist protocols covered), the dashboard data (`data.js`), copies `dashboard/` and `screenshots/` into the output directory, and writes `dossier.json`. Run it twice and the bytes are identical.

Open `out/dashboard/index.html` in a browser: sort the board, filter by chain or category, open any protocol for its value breakdown and farm steps, or export the board as CSV.

---

<sub>Entered on [make.fun](https://make.fun/?ref=1s6hk2as&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
