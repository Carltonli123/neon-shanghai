// POST /api/events — gameplay and ad-viewability events from the client, batched.
'use strict';
const { sanitize, commandsFor, redis, parseBody } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method not allowed'); }
  const clean = parseBody(req).slice(0, 200).map(e => sanitize(e, req.headers['user-agent'])).filter(Boolean);
  if (clean.length) {
    try {
      const r = await redis(commandsFor(clean));
      if (r === null) console.warn('No database connected: events were dropped. Add Upstash Redis under Storage in Vercel.');
    } catch (e) { console.error('Saving events failed:', e.message); }
  }
  res.statusCode = 204; res.end();
};
