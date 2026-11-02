# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and
a morning digest of what ran overnight.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

Open `/digest/YYYY-MM-DD` for a night's jobs, event counts, and skipped bad lines. Retries of
three or more and any failure are marked, including jobs that later recovered. Missing nights
return 404; empty nights say "nothing ran". Pages are self-contained HTML with no client scripts.

Working on it with an agent: start at [AGENTS.md](AGENTS.md).

The status board at `/` lists nights in `runs/` newest first, linking each to
`/digest/:night`. Counts beside each link are valid **events** (ok / retry / fail), not
jobs' final statuses; malformed lines do not contribute to them.
