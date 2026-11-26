// Sends gameplay and ad-viewability events to the Node server (POST /api/events).
import { G } from '../state.js';

const SID = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
const queue = [];
export function track(type, data) { queue.push(Object.assign({ type, sid: SID, t: Date.now(), loc: G.district, tier: G.q ? G.q.key : '' }, data || {})); }
function flush(beacon) {
  if (!queue.length || location.protocol === 'file:') return;
  const body = JSON.stringify({ events: queue.splice(0, 200) });
  if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' })); return; }
  fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
}
setInterval(flush, 4000);
addEventListener('pagehide', () => flush(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
