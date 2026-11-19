# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/DanuMahiru/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/DanuMahiru/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for the make.fun token-radar-01 bounty: it ranks pre-token DefiLlama protocols by what their launch would be worth, each with concrete steps to farm it.

## What it is

`main.ts` (Node 22, standard library only) reads the sealed snapshot of every protocol DefiLlama tracks, works out which ones still record no token and are not a wrapped or staked product of one that trades, and ranks them by implied launch value with the radar-6 model: implied = TVL × size-curve multiple. The multiple comes from one log-log size curve for the whole market (log mcap = 7.7881 + 0.4721 log TVL), levelled per category and shrunk toward TVL at power 0.9 — tested blind (three walk-forward cuts + leave-one-out, median log error 0.859 / 0.842 / 0.936, LOO 1.019) against the flat multiple, the category median, and radar-4's per-category slopes. Growth, tenure and breadth terms were tested and dropped: the multiple alone beats the full model on the ranking of every cut. It writes `board.json` (198 rows: the whole 40-protocol watchlist, 138 early finds below the floor, and 20 off-list protocols above the floor that pass the snapshot's own pre-token rules but are not on the house watchlist, ranked in their own labelled scope), the dashboard data, and `dossier.json` via `vendor/makefun-board.ts`.

The board's top rows: Steakhouse Financial ($100.0M), Sentora Curator ($99.8M, off-list), Gauntlet ($74.5M), Veda ($74.1M). Every row carries an implied value, its P25–P75 and P10–P90 value ranges from the model's own leave-one-out residuals (calibrated out of sample: the middle-half ranges hold 54% of new launches, the wide ranges 70%), and a 7-step farm plan with costs and times. The dashboard in `dashboard/` is a static offline page: a sortable, filterable board with a value-range column and an Off-list scope filter, a detail view for every protocol, a sandbox that recomputes the value from TVL, growth, age and chain count and shows what the dropped terms would do, and a live-token view shown separately with real market caps.

## Run it

In the grader the program reads `/input/snapshot.json` and writes to `/output`. Locally, with the kit's snapshot:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input kit/token-radar-01-kit/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=qs7ay7nf&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
