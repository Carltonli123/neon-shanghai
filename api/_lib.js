// Shared code for the Vercel functions. Events are aggregated into Upstash Redis through its
// REST API (plain fetch, no npm packages). Files starting with "_" are not exposed as routes.
'use strict';

const K = 'nh:';
const DAY_TTL = 120 * 86400;

function sanitize(raw, ua) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.type !== 'string' || !/^[a-z_]{1,32}$/.test(raw.type)) return null;
  const out = {}; let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (n++ > 24 || !/^[a-zA-Z_]{1,32}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' && isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  out.sid = String(out.sid || 'anon').slice(0, 64);
  out.srv = Date.now();
  if (out.type === 'session_start') out.ua = String(ua || '').slice(0, 200);
  return out;
}
function refDomain(ref) { if (!ref) return '(direct)'; try { return new URL(ref).hostname || '(other)'; } catch (_) { return '(other)'; } }
const day = ms => new Date(ms).toISOString().slice(0, 10);

// Turns a batch of events into one Redis pipeline, merging repeated counters.
function commandsFor(events) {
  const cmds = [], counters = new Map(), floats = new Map(), expire = new Set();
  const inc = (map, key, field, n) => { const k = key + '\u0000' + field; map.set(k, (map.get(k) || 0) + n); };
  let playSecs = 0;
  for (const e of events) {
    const d = day(e.srv);
    inc(counters, K + 'types', e.type, 1);
    if (e.type === 'session_start') {
      cmds.push(['PFADD', K + 'visitors', e.sid], ['PFADD', K + 'visitors:' + d, e.sid]); expire.add(K + 'visitors:' + d);
      inc(counters, K + 'refs', refDomain(e.ref), 1);
      inc(counters, K + 'devices', e.touch ? 'touch' : 'desktop', 1);
      inc(counters, K + 'tiers', String(e.tier || 'unknown'), 1);
    } else if (e.type === 'heartbeat') {
      // a "player" is someone who stayed at least 30 seconds
      cmds.push(['PFADD', K + 'players', e.sid], ['PFADD', K + 'players:' + d, e.sid]); expire.add(K + 'players:' + d);
      playSecs += 30;
    } else if (e.type === 'impression') {
      inc(counters, K + 'imp_slot', String(e.slot || '?'), 1);
      inc(counters, K + 'imp_brand', String(e.brand || '?'), 1);
      inc(counters, K + 'imp_day', d, 1);
    } else if (e.type === 'view_end') {
      inc(floats, K + 'dwell_secs', String(e.brand || '?'), Number(e.secs) || 0);
      inc(counters, K + 'dwell_n', String(e.brand || '?'), 1);
    }
  }
  for (const [k, n] of counters) { const [key, field] = k.split('\u0000'); cmds.push(['HINCRBY', key, field, String(n)]); }
  for (const [k, n] of floats) { const [key, field] = k.split('\u0000'); cmds.push(['HINCRBYFLOAT', key, field, String(n)]); }
  cmds.push(['INCRBY', K + 'events', String(events.length)]);
  if (playSecs) cmds.push(['INCRBY', K + 'playsecs', String(playSecs)]);
  const recent = events.slice(-10).map(e => { const { ua, ...rest } = e; return JSON.stringify(rest); });
  if (recent.length) cmds.push(['LPUSH', K + 'recent', ...recent], ['LTRIM', K + 'recent', '0', '39']);
  for (const key of expire) cmds.push(['EXPIRE', key, String(DAY_TTL)]);
  return cmds;
}

// Finds the Upstash REST address and token whatever prefix Vercel gave them
// (e.g. KV_REST_API_URL, UPSTASH_REDIS_REST_URL, STORAGE_KV_REST_API_URL).
function dbConfig() {
  const env = process.env;
  for (const name of Object.keys(env)) {
    const m = name.match(/^(.*?)(KV_REST_API|UPSTASH_REDIS_REST|REDIS_REST_API|REDIS_REST)_URL$/);
    if (!m) continue;
    const token = env[m[1] + m[2] + '_TOKEN'];
    if (token && /^https:\/\//.test(env[name])) return { url: env[name].replace(/\/$/, ''), token };
  }
  return null;
}
async function redis(cmds) {
  const db = dbConfig(); if (!db) return null;
  const r = await fetch(db.url + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + db.token, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('Upstash responded ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const out = await r.json();
  return out.map(x => { if (x && x.error) throw new Error(x.error); return x ? x.result : null; });
}

const hash = arr => { const o = {}; if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = Number(arr[i + 1]); return o; };
const sorted = o => Object.entries(o).sort((a, b) => b[1] - a[1]);

async function readStats() {
  const days = []; for (let i = 13; i >= 0; i--) days.push(day(Date.now() - i * 86400000));
  const cmds = [
    ['GET', K + 'events'], ['PFCOUNT', K + 'visitors'], ['PFCOUNT', K + 'players'], ['GET', K + 'playsecs'],
    ['HGETALL', K + 'types'], ['HGETALL', K + 'imp_slot'], ['HGETALL', K + 'imp_brand'], ['HGETALL', K + 'dwell_secs'], ['HGETALL', K + 'dwell_n'],
    ['HGETALL', K + 'refs'], ['HGETALL', K + 'devices'], ['HGETALL', K + 'tiers'], ['HGETALL', K + 'imp_day'], ['LRANGE', K + 'recent', '0', '39']
  ];
  for (const d of days) cmds.push(['PFCOUNT', K + 'visitors:' + d], ['PFCOUNT', K + 'players:' + d]);
  const r = await redis(cmds); if (r === null) return null;
  const [events, visitors, players, playsecs, types, slots, brands, dsecs, dn, refs, devices, tiers, impDay, recent] = r;
  const T = hash(types), B = hash(brands), DS = hash(dsecs), DN = hash(dn), ID = hash(impDay);
  return {
    sessions: Number(visitors) || 0,
    players: Number(players) || 0,
    avgSessionSecs: players ? (Number(playsecs) || 0) / players : 0,
    events: Number(events) || 0,
    impressions: T.impression || 0,
    byType: sorted(T), impBySlot: sorted(hash(slots)),
    impByBrand: sorted(B).map(([brand, n]) => ({ brand, impressions: n, avgDwellSecs: DN[brand] ? DS[brand] / DN[brand] : null })),
    referrers: sorted(hash(refs)), devices: sorted(hash(devices)), tiers: sorted(hash(tiers)),
    daily: days.map((d, i) => ({ day: d, visitors: Number(r[14 + i * 2]) || 0, players: Number(r[15 + i * 2]) || 0, impressions: ID[d] || 0 })),
    recent: (recent || []).map(s => { try { return JSON.parse(s); } catch (_) { return null; } }).filter(Boolean),
    storage: 'upstash'
  };
}

function parseBody(req) {
  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = null; } }
  return Array.isArray(b) ? b : (b && Array.isArray(b.events) ? b.events : []);
}
function keyOk(req) {
  const need = process.env.STATS_KEY; if (!need) return true;
  const url = new URL(req.url, 'http://x'); return url.searchParams.get('key') === need;
}

module.exports = { sanitize, commandsFor, redis, readStats, parseBody, keyOk, dbConfig, refDomain, day };
