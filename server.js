// Neon Huangpu dev server: serves the game client from ./public and collects
// gameplay + ad-viewability events at POST /api/events (stored in ./data/events.ndjson).
// No dependencies; works on Node 16+.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = Number(process.env.PORT) || 3100;
const HOST = process.env.HOST || '127.0.0.1'; // set HOST=0.0.0.0 to test from a phone on your Wi-Fi
const PUB = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
const LOG = path.join(DATA, 'events.ndjson');
fs.mkdirSync(DATA, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg'
};

/* ---------- in-memory aggregates ---------- */
const { refDomain, day, cleanFeedback, clientHash } = require('./api/_lib');
const FB_LOG = path.join(DATA, 'feedback.ndjson'), feedback = [], fbRate = new Map();
try { for (const line of fs.readFileSync(FB_LOG, 'utf8').split('\n')) { if (line) try { feedback.unshift(JSON.parse(line)); } catch (_) { /* skip bad line */ } } } catch (_) { /* no feedback yet */ }
const agg = { events: 0, sessions: new Map(), players: new Set(), playSecs: 0, daily: new Map(), devices: {}, tiers: {}, byType: {}, impBySlot: {}, impByBrand: {}, dwell: {}, refs: {}, recent: [] };
const dayAgg = d => { if (!agg.daily.has(d)) agg.daily.set(d, { v: new Set(), p: new Set(), i: 0 }); return agg.daily.get(d); };
const inc = (o, k) => { k = k == null ? '(none)' : String(k); o[k] = (o[k] || 0) + 1; };
function ingest(e) {
  agg.events++;
  inc(agg.byType, e.type);
  let s = agg.sessions.get(e.sid);
  if (!s) { s = { first: e.srv, last: e.srv, events: 0 }; agg.sessions.set(e.sid, s); }
  s.first = Math.min(s.first, e.srv); s.last = Math.max(s.last, e.srv); s.events++;
  const D = dayAgg(day(e.srv));
  if (e.type === 'heartbeat') { agg.players.add(e.sid); D.p.add(e.sid); agg.playSecs += 30; }
  if (e.type === 'impression') { inc(agg.impBySlot, e.slot); inc(agg.impByBrand, e.brand); D.i++; }
  if (e.type === 'view_end') {
    const d = agg.dwell[e.brand] || (agg.dwell[e.brand] = { n: 0, secs: 0 });
    d.n++; d.secs += Number(e.secs) || 0;
  }
  if (e.type === 'session_start') { inc(agg.refs, refDomain(e.ref)); inc(agg.devices, e.touch ? 'touch' : 'desktop'); inc(agg.tiers, e.tier || 'unknown'); D.v.add(e.sid); }
  agg.recent.push(e); if (agg.recent.length > 40) agg.recent.shift();
}
try {
  for (const line of fs.readFileSync(LOG, 'utf8').split('\n')) {
    if (!line) continue;
    try { ingest(JSON.parse(line)); } catch (_) { /* skip bad line */ }
  }
} catch (_) { /* no log yet */ }

/* ---------- helpers ---------- */
function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function sanitize(raw, req) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.type !== 'string' || !/^[a-z_]{1,32}$/.test(raw.type)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (n++ > 24 || !/^[a-zA-Z_]{1,32}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' && isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  out.sid = String(out.sid || 'anon').slice(0, 64);
  out.srv = Date.now();
  if (out.type === 'session_start') out.ua = String(req.headers['user-agent'] || '').slice(0, 200);
  return out;
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function stats() {
  const sorted = o => Object.entries(o).sort((a, b) => b[1] - a[1]);
  const days = []; for (let i = 13; i >= 0; i--) days.push(day(Date.now() - i * 86400000));
  return {
    sessions: agg.sessions.size,
    players: agg.players.size,
    avgSessionSecs: agg.players.size ? agg.playSecs / agg.players.size : 0,
    daily: days.map(d => { const x = agg.daily.get(d); return { day: d, visitors: x ? x.v.size : 0, players: x ? x.p.size : 0, impressions: x ? x.i : 0 }; }),
    devices: sorted(agg.devices), tiers: sorted(agg.tiers), storage: 'local file',
    events: agg.events,
    impressions: agg.byType.impression || 0,
    byType: sorted(agg.byType),
    impBySlot: sorted(agg.impBySlot),
    impByBrand: sorted(agg.impByBrand).map(([brand, n]) => {
      const d = agg.dwell[brand];
      return { brand, impressions: n, avgDwellSecs: d && d.n ? d.secs / d.n : null };
    }),
    referrers: sorted(agg.refs),
    recent: agg.recent.slice().reverse()
  };
}
// Text assets are gzipped once and kept in memory until the file changes.
const GZIP_TYPES = new Set(['.html', '.js', '.css', '.json', '.svg']);
const gzCache = new Map();
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/stats') pathname = '/stats.html';
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (_) { return send(res, 400, 'Bad request'); }
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': rel.startsWith('/vendor/') ? 'public, max-age=604800' : 'no-cache',
      'Vary': 'Accept-Encoding'
    };
    const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && GZIP_TYPES.has(ext) && st.size > 1024;
    if (!wantsGzip) { res.writeHead(200, headers); return fs.createReadStream(file).pipe(res); }
    const cached = gzCache.get(file);
    if (cached && cached.mtime === st.mtimeMs) { res.writeHead(200, Object.assign(headers, { 'Content-Encoding': 'gzip', 'Content-Length': cached.buf.length })); return res.end(cached.buf); }
    fs.readFile(file, (e2, raw) => {
      if (e2) return send(res, 500, 'Read error');
      zlib.gzip(raw, { level: 6 }, (e3, buf) => {
        if (e3) { res.writeHead(200, headers); return res.end(raw); }
        gzCache.set(file, { mtime: st.mtimeMs, buf });
        res.writeHead(200, Object.assign(headers, { 'Content-Encoding': 'gzip', 'Content-Length': buf.length }));
        res.end(buf);
      });
    });
  });
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname === '/api/events' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 256 * 1024));
      const list = Array.isArray(body) ? body : Array.isArray(body.events) ? body.events : [];
      const clean = list.slice(0, 500).map(e => sanitize(e, req)).filter(Boolean);
      if (clean.length) {
        clean.forEach(ingest);
        fs.appendFile(LOG, clean.map(e => JSON.stringify(e)).join('\n') + '\n', err => { if (err) console.error('log write failed', err); });
      }
      return send(res, 204, '');
    }
    if (pathname === '/api/stats' && req.method === 'GET') {
      if (process.env.STATS_KEY && new URL(req.url, 'http://x').searchParams.get('key') !== process.env.STATS_KEY) return send(res, 401, JSON.stringify({ error: 'This dashboard needs ?key= in the address.' }), MIME['.json']);
      return send(res, 200, JSON.stringify(stats()), MIME['.json']);
    }
    if (pathname === '/api/health') return send(res, 200, JSON.stringify({ ok: true }), MIME['.json']);
    if (pathname === '/api/feedback') {
      if (req.method === 'POST') {
        let raw = null; try { raw = JSON.parse(await readBody(req, 16 * 1024)); } catch (_) { /* invalid JSON */ }
        if (raw && raw.website) return send(res, 200, JSON.stringify({ ok: true }), MIME['.json']);
        const fb = cleanFeedback(raw, req.headers['user-agent']);
        if (!fb) return send(res, 400, JSON.stringify({ error: 'Add a rating or a comment first.' }), MIME['.json']);
        const who = clientHash(req), hour = Math.floor(Date.now() / 3600000), rk = who + ':' + hour;
        fbRate.set(rk, (fbRate.get(rk) || 0) + 1);
        if (fbRate.get(rk) > 5) return send(res, 429, JSON.stringify({ error: 'Thanks! You have sent a lot of feedback this hour. Please try again later.' }), MIME['.json']);
        feedback.unshift(fb); if (feedback.length > 1000) feedback.length = 1000;
        fs.appendFile(FB_LOG, JSON.stringify(fb) + '\n', err => { if (err) console.error('feedback write failed', err); });
        return send(res, 200, JSON.stringify({ ok: true }), MIME['.json']);
      }
      if (process.env.STATS_KEY && new URL(req.url, 'http://x').searchParams.get('key') !== process.env.STATS_KEY) return send(res, 401, JSON.stringify({ error: 'This dashboard needs ?key= in the address.' }), MIME['.json']);
      const ratings = {}; for (const f of feedback) if (f.rating) ratings[f.rating] = (ratings[f.rating] || 0) + 1;
      return send(res, 200, JSON.stringify({ total: feedback.length, ratings, items: feedback.slice(0, 200) }), MIME['.json']);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    serveStatic(req, res, pathname);
  } catch (err) {
    send(res, 400, 'Bad request: ' + err.message);
  }
});
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Another copy of the server is probably running.`);
    console.error(`Open http://localhost:${PORT} to use it, stop it first, or pick another port: PORT=3200 npm start`);
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, HOST, () => {
  console.log(`Neon Huangpu running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Ad + gameplay stats at  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/stats`);
});
