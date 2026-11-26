# Neon Huangpu

A free open-world browser game set in a rainy, neon-lit Shanghai. Walk or drive through Lujiazui and People's Square, rebuilt from real OpenStreetMap data, with in-game billboards that log ad impressions and viewability.

## Run locally

Needs Node 16 or newer. No `npm install` is required.

```bash
npm start
```

Open http://localhost:3100 for the game and http://localhost:3100/stats for the dashboard. Use `PORT=3200 npm start` to change the port.

## Deploy to Vercel

1. Import this repo in Vercel (Add New → Project). No build settings are needed; `vercel.json` serves `public/` and the functions in `api/`.
2. In the project, open **Storage** and connect **Upstash for Redis** so `/api/events` can save gameplay and ad events.
3. Open **Analytics** and enable Web Analytics.
4. Optional: set `STATS_KEY` under Environment Variables, then open the dashboard as `/stats?key=<value>`.
5. Check `/api/health`: it should report `"database":"connected"`.

## Project layout

- `public/` – the game (ES modules in `public/js`, self-hosted three.js r170 in `public/vendor`, city data in `public/data`)
- `api/` – Vercel functions for events and stats
- `server.js` – local server with the same API, storing events in `data/events.ndjson`
- `tools/` – scripts that download OpenStreetMap data and convert it into `public/data`

## Credits

Map data © OpenStreetMap contributors, available under the Open Database License. three.js is MIT licensed (see `public/vendor/three/LICENSE`).
