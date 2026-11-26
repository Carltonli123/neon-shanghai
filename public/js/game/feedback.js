// In-game feedback form: star rating, comment, optional contact. Sends to /api/feedback.
import { G, $ } from '../state.js';
import { track } from './analytics.js';

const started = Date.now();
let rating = 0, sending = false;

function setRating(n) {
  rating = n;
  document.querySelectorAll('#fbStars button').forEach((b, i) => { b.classList.toggle('on', i < n); b.setAttribute('aria-checked', String(i + 1 === n)); });
  $('#fbRateLabel').textContent = ['Tap a star', 'Not for me', 'Could be better', 'It\'s OK', 'I like it', 'Love it'][n];
}
function msg(text, kind) { const m = $('#fbMsg'); m.textContent = text; m.className = 'fb-msg ' + (kind || ''); }

export function openFeedback() {
  if (document.pointerLockElement) document.exitPointerLock();
  for (const k in G.keys) G.keys[k] = 0;
  G.uiOpen = true;
  $('#fb').hidden = false; $('#fbForm').hidden = false; $('#fbDone').hidden = true; msg('');
  setTimeout(() => $('#fbText').focus(), 30);
  track('feedback_open');
}
export function closeFeedback() {
  G.uiOpen = false; $('#fb').hidden = true;
  $('#game').focus({ preventScroll: true });
}

async function send(e) {
  e.preventDefault(); if (sending) return;
  const text = $('#fbText').value.trim();
  if (!text && !rating) { msg('Add a rating or a comment first.', 'err'); return; }
  sending = true; $('#fbSend').disabled = true; msg('Sending…');
  const body = {
    rating, text, contact: $('#fbContact').value.trim(), website: $('#fbWebsite').value,
    sid: G.sid || '', loc: G.district, tier: G.q ? G.q.key : '', mins: Math.round((Date.now() - started) / 60000),
    touch: document.body.classList.contains('is-touch')
  };
  try {
    const r = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { msg(j.error || 'Could not send right now. Please try again.', 'err'); return; }
    track('feedback_sent', { rating, chars: text.length });
    $('#fbForm').hidden = true; $('#fbDone').hidden = false;
    $('#fbText').value = ''; $('#fbContact').value = ''; setRating(0);
    setTimeout(() => { if (!$('#fb').hidden && !$('#fbDone').hidden) closeFeedback(); }, 2500);
  } catch (_) { msg('No connection. Please try again.', 'err'); }
  finally { sending = false; $('#fbSend').disabled = false; }
}

export function initFeedback() {
  document.querySelectorAll('#fbStars button').forEach((b, i) => b.addEventListener('click', () => setRating(rating === i + 1 ? 0 : i + 1)));
  $('#fbText').addEventListener('input', () => { $('#fbCount').textContent = $('#fbText').value.length + ' / 1000'; });
  $('#fbForm').addEventListener('submit', send);
  $('#fbCancel').addEventListener('click', closeFeedback);
  $('#fbClose').addEventListener('click', closeFeedback);
  $('#fb').addEventListener('pointerdown', e => { if (e.target.id === 'fb') closeFeedback(); });
  $('#btnFb').addEventListener('click', e => { e.currentTarget.blur(); $('#fb').hidden ? openFeedback() : closeFeedback(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#fb').hidden) closeFeedback(); });
  setRating(0);
}
