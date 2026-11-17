# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/DanuMahiru/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/DanuMahiru/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for the make.fun token-radar-01 bounty: it ranks pre-token DefiLlama protocols by what their launch would be worth, each with concrete steps to farm it.

## What it is

`main.ts` (Node 22, standard library only) reads the sealed snapshot of every protocol DefiLlama tracks, works out which ones still record no token and are not a wrapped or staked product of one that trades, and ranks them by implied launch value with the radar-2 model: implied = TVL × category multiple × growth × tenure × breadth. The category multiple is the median market-cap/TVL of the snapshot's own live-token protocols in that category, shrunk toward the global median (0.246). It writes `board.json` (178 rows, the whole 40-protocol watchlist covered), the dashboard data, and `dossier.json` via `vendor/makefun-board.ts`.

The board's top rows: Steakhouse Financial ($588M), Gauntlet ($350M), Veda ($337M). Every row carries an implied value and a 6-step farm plan with costs and times. The dashboard in `dashboard/` is a static offline page: a sortable, filterable board, a detail view for every protocol, and a live-token view shown separately with real market caps.

## Run it

In the grader the program reads `/input/snapshot.json` and writes to `/output`. Locally, with the kit's snapshot:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input kit/token-radar-01-kit/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=qs7ay7nf&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
