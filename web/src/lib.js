// Shared helpers: API calls, formatting, local storage.
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const TABS = ['today', 'board', 'feed', 'ledger', 'settings'];

export async function api(path, opts = {}) {
  const o = { method: 'GET', headers: {}, ...opts };
  if (o.body && !(o.body instanceof FormData)) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
  const r = await fetch(path, o);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || `Error ${r.status}`); e.status = r.status; throw e; }
  return data;
}
export const post = (p, body) => api(p, { method: 'POST', body: body || {} });
export const put = (p, body) => api(p, { method: 'PUT', body: body || {} });
export const del = (p) => api(p, { method: 'DELETE' });

export const money = (c) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
export const fmtDay = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };
export const fmtTime = (ts) => new Date(ts).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
export const addDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
export const media = (f) => `/media/${encodeURIComponent(f)}`;
export const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
export const formData = (form) => Object.fromEntries(new FormData(form));

// A week's debts are created the Monday after it. Days since then (0 on that Monday).
const dayNum = (d) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) / 864e5; };
export const daysOpen = (week, today) => dayNum(today) - (dayNum(week) + 7);
export const OVERDUE_DAYS = 3;
export const isOverdue = (l, today) => l.status === 'open' && !l.paid_at && daysOpen(l.week, today) >= OVERDUE_DAYS;

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function stakesLine(r) {
  const parts = [];
  if (r.stakeType !== 'favors') parts.push(`miss = ${money(r.penaltyCents)}`, `pot ${money(r.potCents)}`);
  if (r.stakeType !== 'money') parts.push('loser owes a favor');
  return parts.join(' · ');
}

// Upload a check-in with progress. Resolves with the server's JSON, rejects with an Error.
export function uploadCheckin({ file, kind, goalId, note, onProgress }) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Pick a photo or video first'));
    if (file.size > 100 * 1024 * 1024) return reject(new Error('That file is over 100MB'));
    const fd = new FormData();
    fd.append('kind', kind); if (goalId) fd.append('goal_id', goalId); fd.append('note', note || ''); fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let d = {}; try { d = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status === 200) resolve(d); else reject(new Error(d.error || 'Upload failed'));
    };
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection.'));
    xhr.open('POST', '/api/checkins'); xhr.send(fd);
  });
}

// ---- phone setup: Home Screen + notifications ----
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// Android and desktop Chrome hand us an "install" event we can trigger from a button. iOS has no such thing.
let installEvent = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; window.dispatchEvent(new Event('li-install-ready')); });
  window.addEventListener('appinstalled', () => { installEvent = null; });
}
export const canInstall = () => !!installEvent;
export async function promptInstall() {
  if (!installEvent) return false;
  installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  return outcome === 'accepted';
}

// Is this device already signed up for notifications?
export async function pushIsOn() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 2500))]);
    return !!(reg && await reg.pushManager.getSubscription());
  } catch { return false; }
}

// Must be called from a tap: the phone only shows its permission question in response to one.
export async function enablePush(pushKey) {
  if (!pushSupported()) throw new Error('This browser can’t do push notifications');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them for Lock In in your phone’s settings.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(pushKey) });
  await post('/api/push/subscribe', sub.toJSON());
}

export function urlB64(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
