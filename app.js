// === Naatak Vote Rally — front-end ===
// Paste your Apps Script web-app URL here after deploying. Leave as '' to disable
// the community counter and email signup (the rest of the page still works).
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyfzsieefFi6LYnsKHR85GSejxCP6sEd0pseC2wIiGqv0eVXFMONBEQ9mHQk3AJFNuN/exec';

const VOTE_URL = 'https://www.sfgate.com/best/vote/#/gallery/527870149';
// May 5, 2026 00:00 Pacific = May 5, 2026 07:00 UTC (PDT, UTC-7)
const CONTEST_END = new Date('2026-05-05T07:00:00Z');

const STORAGE_KEY = 'naatak.votes.v1';

// ---------- Personal tracker (localStorage) ----------
function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { total: 0, byDay: {} };
    const parsed = JSON.parse(raw);
    return {
      total: parsed.total || 0,
      byDay: parsed.byDay || {},
    };
  } catch {
    return { total: 0, byDay: {} };
  }
}

function writeState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function recordPersonalClick() {
  const state = readState();
  const today = new Date().toISOString().slice(0, 10);
  state.total += 1;
  state.byDay[today] = (state.byDay[today] || 0) + 1;
  writeState(state);
  renderPersonalStats();
}

function renderPersonalStats() {
  const state = readState();
  const days = Object.keys(state.byDay).length;
  document.getElementById('personal-total').textContent = state.total;
  document.getElementById('personal-detail').textContent =
    days === 0 ? 'no votes yet' :
    days === 1 ? 'across 1 day' :
    `across ${days} days`;
}

// ---------- Countdown ----------
function tickCountdown() {
  const now = new Date();
  const diff = CONTEST_END - now;

  if (diff <= 0) {
    document.body.classList.add('ended');
    setUnit('days', '0');
    setUnit('hours', '0');
    setUnit('minutes', '0');
    setUnit('seconds', '0');
    document.querySelector('.countdown-label').textContent = 'Voting closed';
    const btn = document.getElementById('vote-btn');
    btn.disabled = true;
    btn.querySelector('.vote-btn-label').textContent = 'VOTING CLOSED';
    btn.querySelector('.vote-btn-sub').textContent = 'thank you!';
    return false;
  }

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  setUnit('days', days);
  setUnit('hours', String(hours).padStart(2, '0'));
  setUnit('minutes', String(minutes).padStart(2, '0'));
  setUnit('seconds', String(seconds).padStart(2, '0'));
  return true;
}

function setUnit(unit, value) {
  document.querySelector(`[data-unit="${unit}"]`).textContent = value;
}

// ---------- Vote button ----------
document.getElementById('vote-btn').addEventListener('click', () => {
  if (document.body.classList.contains('ended')) return;

  // Open SFGate first (must happen synchronously inside click for popup blockers)
  window.open(VOTE_URL, '_blank', 'noopener');

  // Record locally
  recordPersonalClick();

  // Record to community counter (best-effort, fire-and-forget)
  postToScript({ action: 'click' })
    .then(data => {
      console.log('click response:', data);
      if (data && typeof data.count === 'number') updateCommunityCount(data.count);
      else console.warn('click: unexpected response shape', data);
    })
    .catch(err => console.error('click counter failed:', err));
});

// ---------- Community counter ----------
const COMMUNITY_CACHE_KEY = 'naatak.lastCommunityCount';

function updateCommunityCount(n) {
  const el = document.getElementById('community-total');
  el.textContent = n.toLocaleString();
  try { localStorage.setItem(COMMUNITY_CACHE_KEY, String(n)); } catch {}
}

function showCachedCommunityCount() {
  const cached = localStorage.getItem(COMMUNITY_CACHE_KEY);
  const el = document.getElementById('community-total');
  if (cached !== null) el.textContent = Number(cached).toLocaleString();
  else el.textContent = '—';
}

async function loadCommunityCount() {
  showCachedCommunityCount();
  if (!APPS_SCRIPT_URL) return;
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=count`, { method: 'GET' });
    const data = await res.json();
    if (typeof data.count === 'number') updateCommunityCount(data.count);
  } catch (err) {
    console.warn('community count fetch failed:', err);
  }
}

// ---------- Subscribe form ----------
document.getElementById('reminder-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('reminder-status');
  const btn = document.getElementById('subscribe-btn');
  const email = document.getElementById('email').value.trim();
  const firstName = document.getElementById('firstName').value.trim();

  status.className = 'reminder-status';
  status.textContent = '';

  if (!email || !email.includes('@')) {
    status.classList.add('error');
    status.textContent = 'Please enter a valid email.';
    return;
  }

  if (!APPS_SCRIPT_URL) {
    status.classList.add('error');
    status.textContent = 'Reminder service not configured yet.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Signing up…';

  try {
    const data = await postToScript({ action: 'subscribe', email, firstName });
    if (data && data.ok) {
      status.classList.add('success');
      status.textContent = data.dedup
        ? "You're already on the list — see you tomorrow!"
        : `Done! Daily reminder coming to ${email}.`;
      e.target.reset();
    } else {
      throw new Error((data && data.error) || 'Unknown error');
    }
  } catch (err) {
    console.error('subscribe failed:', err);
    status.classList.add('error');
    status.textContent = `Sign-up failed: ${err && err.message ? err.message : err}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Remind me daily';
  }
});

// ---------- Apps Script POST helper ----------
// Use text/plain to avoid CORS preflight; the script parses JSON from the body.
async function postToScript(payload) {
  if (!APPS_SCRIPT_URL) throw new Error('Apps Script URL not configured');
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// ---------- Boot ----------
renderPersonalStats();
const live = tickCountdown();
if (live) setInterval(tickCountdown, 1000);
loadCommunityCount();
