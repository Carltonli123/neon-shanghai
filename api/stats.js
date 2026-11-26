// GET /api/stats — aggregated numbers for the /stats dashboard.
// If the STATS_KEY environment variable is set, the dashboard must be opened as /stats?key=<value>.
'use strict';
const { readStats, keyOk } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!keyOk(req)) { res.statusCode = 401; return res.end(JSON.stringify({ error: 'This dashboard needs ?key= in the address.' })); }
  try {
    const s = await readStats();
    if (s === null) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'No database connected. In Vercel, open Storage and add Upstash Redis to this project.' })); }
    res.end(JSON.stringify(s));
  } catch (e) {
    res.statusCode = 500; res.end(JSON.stringify({ error: 'Could not read stats: ' + e.message }));
  }
};
