// POST /api/feedback — a player's rating and comment.  GET /api/feedback — the list, for /stats.
'use strict';
const { redis, keyOk, cleanFeedback, clientHash } = require('./_lib');
const K = 'nh:';

function body(req) {
  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = null; } }
  return b;
}
function json(res, code, obj) { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); }

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      const raw = body(req);
      if (raw && raw.website) return json(res, 200, { ok: true }); // decoy field filled: pretend success
      const fb = cleanFeedback(raw, req.headers['user-agent']);
      if (!fb) return json(res, 400, { error: 'Add a rating or a comment first.' });
      const rl = K + 'fbrl:' + clientHash(req);
      const first = await redis([['INCR', rl], ['EXPIRE', rl, '3600']]);
      if (first === null) return json(res, 503, { error: 'Feedback is not set up yet. Please try again later.' });
      if (Number(first[0]) > 5) return json(res, 429, { error: 'Thanks! You have sent a lot of feedback this hour. Please try again later.' });
      const cmds = [['LPUSH', K + 'feedback', JSON.stringify(fb)], ['LTRIM', K + 'feedback', '0', '999'], ['INCR', K + 'fb_count']];
      if (fb.rating) cmds.push(['HINCRBY', K + 'fb_rating', String(fb.rating), '1']);
      await redis(cmds);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET') {
      if (!keyOk(req)) return json(res, 401, { error: 'This dashboard needs ?key= in the address.' });
      const r = await redis([['LRANGE', K + 'feedback', '0', '199'], ['GET', K + 'fb_count'], ['HGETALL', K + 'fb_rating']]);
      if (r === null) return json(res, 503, { error: 'No database connected.' });
      const ratings = {}; const h = r[2] || []; for (let i = 0; i < h.length; i += 2) ratings[h[i]] = Number(h[i + 1]);
      const items = (r[0] || []).map(s => { try { return JSON.parse(s); } catch (_) { return null; } }).filter(Boolean);
      return json(res, 200, { total: Number(r[1]) || 0, ratings, items });
    }
    res.statusCode = 405; res.end('Method not allowed');
  } catch (e) { json(res, 500, { error: 'Could not save feedback right now.' }); console.error('feedback:', e.message); }
};
