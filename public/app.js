/* Lock In — client */
const $app = document.getElementById('app');
const $tabs = document.getElementById('tabs');
let S = null; // server state
let tab = 'today';
let es = null;
let busy = false;
let W = null; // one week's overview data (Board tab)
let viewWeek = null; // null = current week

// ---------- utils ----------
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const nameOf = (id) => S.users.find((u) => u.id === id)?.name || 'Former member';
const userOf = (id) => S.users.find((u) => u.id === id) || {};
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmtDay = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };
const fmtTime = (ts) => new Date(ts).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const addDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const media = (f) => `/media/${encodeURIComponent(f)}`;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2800);
}

async function api(path, opts = {}) {
  const o = { method: 'GET', headers: {}, ...opts };
  if (o.body && !(o.body instanceof FormData)) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
  const r = await fetch(path, o);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || `Error ${r.status}`); e.status = r.status; throw e; }
  return data;
}
const post = (p, body) => api(p, { method: 'POST', body: body || {} });

async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); document.activeElement?.blur?.(); await refresh(); return r; } catch (e) { toast(e.message); return null; }
}

// ---------- boot ----------
async function boot() {
  const m = location.pathname.match(/^\/join\/([\w-]+)/);
  if (m) lsSet('li_code', m[1]);
  try {
    S = await api('/api/state');
    lsSet('li_code', S.group.invite_code);
    markSeen();
    if (m) history.replaceState(null, '', '/');
    startStream();
    route();
  } catch (e) {
    if (e.status !== 401) { $app.innerHTML = `<p class="loading">Can't reach the server. Pull to refresh.</p>`; return; }
    const { hasGroups } = await api('/api/bootstrap');
    const code = lsGet('li_code');
    if (m || code) return renderAuth(m ? m[1] : code, !!m);
    if (!hasGroups) return renderCreate();
    $app.innerHTML = `<h1>Lock In</h1><p class="muted">Ask someone in your group to send you the invite link.</p>`;
  }
}

async function refresh() {
  try { S = await api('/api/state'); if (tab === 'board') await loadWeek(); render(); } catch (e) { if (e.status === 401) location.reload(); }
}

async function loadWeek() {
  try { W = await api(`/api/week/${viewWeek || S.week}`); } catch { viewWeek = null; W = await api(`/api/week/${S.week}`); }
}

// App is open: clear the red badge on the home-screen icon.
function markSeen() {
  post('/api/seen').catch(() => {});
  try { if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {}); } catch { /* unsupported */ }
}

function startStream() {
  if (es) es.close();
  es = new EventSource('/api/stream');
  let t;
  es.onmessage = () => { clearTimeout(t); t = setTimeout(() => { if (!busy) refresh(); }, 250); };
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S) { markSeen(); refresh(); } });

function route() {
  const hsh = location.hash.slice(1) || 'today';
  tab = hsh.split('-')[0];
  if (!['today', 'board', 'feed', 'ledger', 'settings'].includes(tab)) tab = 'today';
  const after = () => {
    render();
    if (hsh.includes('-')) setTimeout(() => document.getElementById(hsh)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  };
  if (tab === 'board') loadWeek().then(after); else after();
}
window.addEventListener('hashchange', () => { if (S) route(); });

// ---------- auth screens ----------
function renderCreate() {
  $app.innerHTML = `
    <p class="eyebrow">Set up</p>
    <h1>Start your group</h1>
    <p class="muted">You'll be the admin. After this you'll get an invite link to send your people.</p>
    <form id="f">
      <label>Group name</label><input name="groupName" placeholder="e.g. The Lock In" required maxlength="60">
      <label>Your name</label><input name="name" required maxlength="30" autocomplete="name">
      <label>Pick a 4-digit PIN</label><input name="pin" class="pin" inputmode="numeric" pattern="\\d{4}" maxlength="4" required autocomplete="new-password">
      <label>Stakes</label>
      <select name="stakeType"><option value="money">Money</option><option value="favors">Favors (no money)</option><option value="both">Money + favors</option></select>
      <button class="primary cta">Create group</button>
    </form>`;
  document.getElementById('f').onsubmit = async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    try { const r = await post('/api/groups', d); lsSet('li_code', r.code); location.hash = '#settings'; boot(); } catch (e) { toast(e.message); }
  };
}

async function renderAuth(code, fromLink) {
  let info;
  try { info = await api(`/api/invite/${encodeURIComponent(code)}`); } catch (e) {
    $app.innerHTML = `<h1>Lock In</h1><p class="muted">${h(e.message)}. Ask for a fresh invite link.</p>`; return;
  }
  let mode = fromLink && !info.names.length ? 'join' : (fromLink ? 'join' : 'login');
  const draw = () => {
    $app.innerHTML = `
      <p class="eyebrow">${h(info.groupName)}</p>
      <h1>${mode === 'join' ? 'Join the group' : 'Welcome back'}</h1>
      <p class="muted">Show up. Post proof. Don't pay.</p>
      <form id="f">
        ${mode === 'login'
          ? `<label>Who are you?</label><select name="name" required>${info.names.map((n) => `<option>${h(n)}</option>`).join('')}</select>`
          : `<label>Your name</label><input name="name" required maxlength="30" autocomplete="name">`}
        <label>${mode === 'join' ? 'Pick a 4-digit PIN' : 'PIN'}</label>
        <input name="pin" class="pin" inputmode="numeric" pattern="\\d{4}" maxlength="4" required autocomplete="${mode === 'join' ? 'new-password' : 'current-password'}">
        <button class="primary cta">${mode === 'join' ? 'Join' : 'Log in'}</button>
      </form>
      ${info.names.length ? `<p style="text-align:center;margin-top:16px"><button class="ghost" id="sw">${mode === 'join' ? 'Already in the group? Log in' : 'New here? Join'}</button></p>` : ''}
      ${info.names.length ? `<p class="muted small" style="text-align:center">Members: ${info.names.map(h).join(', ')}</p>` : ''}`;
    document.getElementById('sw')?.addEventListener('click', () => { mode = mode === 'join' ? 'login' : 'join'; draw(); });
    document.getElementById('f').onsubmit = async (ev) => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(ev.target));
      try { await post(mode === 'join' ? '/api/join' : '/api/login', { ...d, code }); history.replaceState(null, '', '/'); boot(); } catch (e) { toast(e.message); }
    };
  };
  draw();
}

// ---------- render ----------
function render() {
  $tabs.hidden = false;
  $tabs.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  const ledgerBadge = S.ledger.filter((l) => l.status === 'open' && l.from_id === S.me.id).length;
  $tabs.querySelector('[data-tab=ledger]').innerHTML = `<span>💸</span>${ledgerBadge ? `Owed (${ledgerBadge})` : 'Owed'}`;
  const scrollY = window.scrollY;
  const active = document.activeElement;
  if (active && active.closest('#app') && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) && active.value) return; // don't clobber typing
  ({ today: renderToday, board: renderBoard, feed: renderFeed, ledger: renderLedger, settings: renderSettings })[tab]();
  window.scrollTo(0, scrollY);
}

const me = () => S.stats.find((s) => s.id === S.me.id) || { gymDays: 0, days: [], goals: [], challenge: [], points: 0 };
const stakesLine = (r) => {
  const parts = [];
  if (r.stakeType !== 'favors') parts.push(`miss = ${money(r.penaltyCents)}`, `pot ${money(r.potCents)}`);
  if (r.stakeType !== 'money') parts.push('loser owes a favor');
  return parts.join(' · ');
};

function daysStrip(days) {
  return `<div class="days">${S.weekDays.map((d, i) => {
    const cls = [days.includes(d) ? 'hit' : '', d === S.today ? 'today' : '', d > S.today ? 'future' : ''].join(' ');
    return `<div class="day ${cls}"><b>${days.includes(d) ? '✓' : ''}</b>${DOW[i]}</div>`;
  }).join('')}</div>`;
}

function goalRow(g, mine) {
  const pct = Math.min(100, (g.count / g.target) * 100);
  const done = g.count >= g.target;
  return `<div class="goal">
    <div class="row between"><div class="grow">${h(g.title)} ${done ? '<span class="pill good">+' + g.points + '</span>' : `<span class="muted small">${g.points} pts</span>`}</div>
      <div class="count">${g.count} / ${g.target}</div></div>
    <div class="bar ${done ? 'done' : ''}"><i style="width:${pct}%"></i></div>
    ${mine ? `<div class="row between" style="margin-top:6px">
      <button class="ghost small" data-proof="${g.id}">📸 Add proof</button>
      <div class="row"><button class="round" data-inc="${g.id}" data-d="-1" aria-label="minus">−</button><button class="round primary" data-inc="${g.id}" data-d="1" aria-label="plus">+</button></div>
    </div>` : ''}
  </div>`;
}

function resultCard() {
  const w = S.history[0];
  if (!w || lsGet(`li_result_${S.group.id}`) === w.week) return '';
  const winners = w.results.filter((x) => x.potWinner).map((x) => nameOf(x.id));
  const mine = S.ledger.filter((l) => l.week === w.week && l.status === 'open' && (l.from_id === S.me.id || l.to_id === S.me.id));
  const what = (l) => (l.kind === 'money' ? `<b class="mono">${money(l.amount_cents)}</b>` : 'a favor');
  return `<div class="card result">
    <p class="eyebrow">Week of ${fmtDay(w.week)} · final</p>
    <h3>${winners.length ? `👑 ${winners.map(h).join(' & ')} won the pot` : 'No pot winner this week'}</h3>
    ${w.results.map((x) => `<div class="row between small"><span>${h(nameOf(x.id))}</span><span class="mono">${x.gymDays} gym · ${x.points} pts ${x.qualified ? '✅' : '❌'}</span></div>`).join('')}
    <hr>
    ${mine.length ? mine.map((l) => `<p>${l.from_id === S.me.id ? `You owe ${h(nameOf(l.to_id))} ${what(l)}` : `${h(nameOf(l.from_id))} owes you ${what(l)}`}</p>`).join('') : '<p>You’re all square.</p>'}
    <div class="paybtns">${mine.length ? '<a class="btn primary" href="#ledger" data-dismiss-result="' + w.week + '">Settle up</a>' : ''}<button data-dismiss-result="${w.week}">Got it</button></div>
  </div>`;
}

function newGoalForm(isChallenge) {
  return `<form class="newGoal" data-challenge="${isChallenge ? 1 : ''}">
    <input name="title" placeholder="${isChallenge ? 'e.g. 10k steps a day' : 'e.g. Film short-form reels'}" aria-label="Goal name" maxlength="60" required>
    <div class="grid2" style="margin-top:6px"><div><label style="margin-top:0">Target this week</label><input name="target" type="number" min="1" value="1" inputmode="numeric"></div>
    <div><label style="margin-top:0">Points when hit</label><input name="points" type="number" min="0" value="10" inputmode="numeric"></div></div>
    <button class="primary full" style="margin-top:10px">Add</button>
  </form>`;
}

function wireNewGoal() {
  document.querySelectorAll('.newGoal').forEach((f) => {
    f.onsubmit = (ev) => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(f)); d.challenge = !!f.dataset.challenge;
      f.reset();
      act(() => post('/api/goals', d), S.edit.isNext ? 'Added — starts next week' : 'Added');
    };
  });
}

function renderToday() {
  const m = me();
  const r = S.rules;
  const loggedToday = m.days.includes(S.today);
  const left = 7 - S.weekDays.indexOf(S.today);
  const need = Math.max(0, r.daysRequired - m.gymDays);
  const status = need === 0 ? '<span class="pill good">Locked in ✅</span>'
    : need > left ? '<span class="pill bad">Can’t make it this week</span>'
      : need === left ? '<span class="pill warn">No days to spare</span>' : `<span class="pill">${need} to go · ${left} days left</span>`;
  $app.innerHTML = `
    <div class="topbar"><div><p class="eyebrow">${h(S.group.name)}</p><h1>Hey, <span class="accent">${h(S.me.name)}</span></h1></div></div>
    <p class="muted">Week of ${fmtDay(S.week)} · ${stakesLine(r)}</p>
    ${resultCard()}
    <div class="card">
      <div class="row between"><h3 class="label">Gym this week</h3>${status}</div>
      <div><span class="big">${m.gymDays}</span> <span class="of">/ ${r.daysRequired} days</span></div>
      ${daysStrip(m.days)}
      ${loggedToday ? '<p class="muted small">✅ Today counts. Extra posts are welcome but count once.</p>' : '<p class="muted small">Post a photo or video at the gym. Only today counts — no backdating.</p>'}
      <button class="primary cta" id="gymBtn">📷 ${loggedToday ? 'Post another' : 'Log today’s gym'}</button>
      <input type="file" id="gymFile" accept="image/*,video/*" hidden>
      <div id="gymExtra" hidden>
        <label>Note (optional)</label><input id="gymNote" maxlength="280" placeholder="Leg day. Hated it.">
        <button class="primary full" id="gymSend" style="margin-top:10px">Post</button>
        <div class="progress" hidden><i></i></div>
      </div>
    </div>
    <h2>Bonus points <span class="mono muted" style="font-size:16px">${m.points} pts</span></h2>
    ${r.stakeType !== 'favors' ? `<p class="muted small">Hit ${r.daysRequired} gym days to be eligible. Most points wins the ${money(r.potCents)} pot.</p>` : '<p class="muted small">Hit your gym days to be eligible. Most points wins.</p>'}
    <div class="card">
      ${m.goals.length ? m.goals.map((g) => goalRow(g, true)).join('') : '<p class="muted">No bonus goals yet. Add your own below — each one earns points when you hit its target.</p>'}
      <details ${m.goals.length ? '' : 'open'} style="margin-top:8px"><summary>+ Add a bonus goal</summary>
        ${newGoalForm(false)}
        <p class="muted small">${S.edit.isNext ? 'This week’s goals are locked, so a new goal starts next Monday.' : 'You can add or change this week’s goals until Tuesday 12am ET.'} Edit or remove goals in <a href="#settings">Settings</a>.</p>
      </details>
    </div>
    ${m.challenge.length ? `<h2>Group challenge</h2><div class="card">${m.challenge.map((g) => goalRow(g, true)).join('')}</div>` : ''}
    <input type="file" id="proofFile" accept="image/*,video/*" hidden>`;

  const file = document.getElementById('gymFile');
  document.getElementById('gymBtn').onclick = () => file.click();
  file.onchange = () => { if (file.files[0]) { document.getElementById('gymExtra').hidden = false; document.getElementById('gymBtn').textContent = `📎 ${file.files[0].name.slice(0, 28)} — change`; document.getElementById('gymNote').focus(); } };
  document.getElementById('gymSend').onclick = () => uploadCheckin(file.files[0], 'gym', null, document.getElementById('gymNote').value);
  document.querySelectorAll('[data-dismiss-result]').forEach((b) => { b.addEventListener('click', () => { lsSet(`li_result_${S.group.id}`, b.dataset.dismissResult); if (b.tagName === 'BUTTON') render(); }); });
  wireGoals();
  wireNewGoal();
}

function wireGoals() {
  document.querySelectorAll('[data-inc]').forEach((b) => { b.onclick = () => act(() => post(`/api/counters/${b.dataset.inc}`, { delta: Number(b.dataset.d) })); });
  const pf = document.getElementById('proofFile');
  document.querySelectorAll('[data-proof]').forEach((b) => {
    b.onclick = () => { pf.dataset.goal = b.dataset.proof; pf.click(); };
  });
  if (pf) pf.onchange = () => { if (pf.files[0]) uploadCheckin(pf.files[0], 'proof', pf.dataset.goal, prompt('Add a note (optional)') || ''); };
}

function uploadCheckin(f, kind, goalId, note) {
  if (!f) return toast('Pick a photo or video first');
  if (f.size > 100 * 1024 * 1024) return toast('That file is over 100MB');
  const fd = new FormData();
  fd.append('kind', kind); if (goalId) fd.append('goal_id', goalId); fd.append('note', note || ''); fd.append('file', f);
  const xhr = new XMLHttpRequest();
  const prog = document.querySelector('.progress');
  busy = true;
  if (prog) prog.hidden = false;
  const btn = document.getElementById('gymSend'); if (btn) btn.disabled = true;
  xhr.upload.onprogress = (e) => { if (prog && e.lengthComputable) prog.firstElementChild.style.width = `${(e.loaded / e.total) * 100}%`; };
  xhr.onload = () => {
    busy = false;
    let d = {}; try { d = JSON.parse(xhr.responseText); } catch { /* ignore */ }
    if (xhr.status === 200) { toast(kind === 'gym' ? 'Logged. That counts 💪' : 'Proof posted'); location.hash = '#today'; refresh(); } else { toast(d.error || 'Upload failed'); if (btn) btn.disabled = false; }
  };
  xhr.onerror = () => { busy = false; toast('Upload failed — check your connection'); if (btn) btn.disabled = false; };
  xhr.open('POST', '/api/checkins'); xhr.send(fd);
}

function projectionLines(p) {
  const lines = [];
  for (const d of p.money) lines.push(`${h(nameOf(d.from))} → ${h(nameOf(d.to))}: <b class="mono">${money(d.amount)}</b>`);
  const fav = {};
  for (const d of p.favors) { const k = `${d.from}>${d.to}`; fav[k] = (fav[k] || 0) + 1; }
  for (const [k, n] of Object.entries(fav)) { const [a, b] = k.split('>').map(Number); lines.push(`${h(nameOf(a))} owes ${h(nameOf(b))} <b>${n} favor${n > 1 ? 's' : ''}</b>`); }
  return lines;
}

function cmtForm(checkinId) {
  return `<form class="cmtform" data-checkin="${checkinId || ''}"><input name="text" maxlength="500" placeholder="${checkinId ? 'Add a comment…' : 'Message the group…'}" aria-label="${checkinId ? 'Comment' : 'Group message'}" autocomplete="off" required><button class="primary">Send</button></form>`;
}
function wireComments() {
  document.querySelectorAll('.cmtform').forEach((f) => {
    f.onsubmit = (ev) => {
      ev.preventDefault();
      const inp = f.querySelector('input'); const text = inp.value.trim();
      if (!text) return;
      inp.value = '';
      act(() => post('/api/comments', { text, checkin_id: f.dataset.checkin ? Number(f.dataset.checkin) : null }));
    };
  });
  document.querySelectorAll('[data-delcmt]').forEach((b) => { b.onclick = () => act(() => api(`/api/comments/${b.dataset.delcmt}`, { method: 'DELETE' })); });
}
function chatCard(list, canPost) {
  return `<h2 id="board-chat">Week chat</h2><div class="card"><div class="chat">${list.length
    ? list.map((x) => `<div class="bubble ${x.user_id === S.me.id ? 'me' : ''}">${x.user_id !== S.me.id ? `<small>${h(nameOf(x.user_id))}</small>` : ''}${h(x.text)}</div>`).join('')
    : '<p class="muted">No messages yet. Talk your talk.</p>'}</div>${canPost ? cmtForm(null) : ''}</div>`;
}

// One square in the week grid / proof strip.
function cellHtml(posts, label, extra = '') {
  if (!posts.length) return `<div class="cell ${extra}" aria-label="${h(label)}: nothing"></div>`;
  const c = posts.find((x) => x.status === 'ok') || posts[0];
  const vid = c.mime.startsWith('video/');
  const flagged = c.status !== 'ok';
  return `<button class="cell ${flagged ? 'flag' : 'hit'} ${extra}" data-open="${c.id}" aria-label="${h(label)}: open post" ${c.thumb ? `style="background-image:url('${media(c.thumb)}')"` : ''}>${vid ? '▶' : (c.thumb ? '' : '✓')}${flagged ? '<em>🚩</em>' : (posts.length > 1 ? `<em>×${posts.length}</em>` : '')}</button>`;
}

function openPost(id) {
  const c = W.checkins.find((x) => x.id === id); if (!c) return;
  const vid = c.mime.startsWith('video/');
  const el = document.createElement('div'); el.className = 'scrim';
  el.innerHTML = `<div class="sheet" role="dialog" aria-label="Post">
    <div class="row between" style="margin-bottom:10px"><div><b>${h(nameOf(c.user_id))}</b> <span class="muted small">${c.kind === 'gym' ? '🏋️ gym' : '📸 proof'} · ${fmtTime(c.created_at)}</span></div><button class="round" data-close aria-label="Close">✕</button></div>
    ${vid ? `<video src="${media(c.file)}" controls playsinline autoplay></video>` : `<img src="${media(c.file)}" alt="post">`}
    ${c.note ? `<p>${h(c.note)}</p>` : ''}
    ${c.status === 'flagged' ? '<div class="flagbox">🚩 Flagged — doesn’t count until cleared.</div>' : ''}${c.status === 'rejected' ? '<div class="flagbox">❌ Rejected — doesn’t count.</div>' : ''}
    ${S.feed.some((x) => x.id === c.id) ? `<a class="btn full" style="margin-top:12px" href="#feed-${c.id}" data-close>Comment or react in Feed</a>` : ''}
  </div>`;
  el.addEventListener('click', (ev) => { if (ev.target === el || ev.target.closest('[data-close]')) el.remove(); });
  document.body.appendChild(el);
}

function renderBoard() {
  if (!W) { $app.innerHTML = '<div class="loading">Loading…</div>'; return; }
  const r = W.rules;
  const current = W.week === S.week;
  const res = Object.fromEntries(W.projection.results.map((x) => [x.id, x]));
  const sorted = [...W.stats].sort((a, b) => (res[b.id]?.potWinner ? 1 : 0) - (res[a.id]?.potWinner ? 1 : 0) || (b.gymDays >= r.daysRequired) - (a.gymDays >= r.daysRequired) || b.points - a.points || b.gymDays - a.gymDays);
  const left = 7 - W.weekDays.indexOf(S.today);
  const lead = (x) => {
    if (!x?.potWinner) return '';
    const why = { points: 'on points', gymDays: 'tied on points · more gym days', first: `tied · got to ${r.daysRequired} first`, split: 'tied · splitting the pot' }[x.wonBy] || '';
    return `<span class="pill warn">👑 ${current ? 'Leading' : 'Won'} ${why}</span>`;
  };
  const gymPosts = (uid, d) => W.checkins.filter((c) => c.user_id === uid && c.day === d && c.kind === 'gym');
  const final = W.ledger.map((l) => `<p>${l.status === 'done' ? '✓' : '•'} ${h(nameOf(l.from_id))} → ${h(nameOf(l.to_id))}: ${l.kind === 'money' ? `<b class="mono">${money(l.amount_cents)}</b>` : `a favor${l.favor_text ? ` — ${h(l.favor_text)}` : ''}`} <span class="muted small">${l.status === 'done' ? 'settled' : 'open'}</span></p>`);
  const lines = projectionLines(W.projection);

  $app.innerHTML = `
    <p class="eyebrow">${current ? 'This week’s competition' : 'Looking back'}</p><h1>${current ? 'Who’s locked in' : `Week of ${fmtDay(W.week)}`}</h1>
    <div class="picker"><button class="round" id="wkPrev" aria-label="Previous week" ${W.week <= S.firstWeek ? 'disabled' : ''}>‹</button>
      <b>${fmtDay(W.week)} – ${fmtDay(W.weekDays[6])}</b>
      <button class="round" id="wkNext" aria-label="Next week" ${current ? 'disabled' : ''}>›</button></div>
    <p class="muted small">${current ? `${left} day${left > 1 ? 's' : ''} left · resets Monday 12am ET` : (W.settled ? 'Final' : 'Settling shortly')} · ${stakesLine(r)}</p>

    <div class="card">
      <div class="row between" style="margin-bottom:10px"><h3 class="label">The week at a glance</h3><span class="muted small">tap a square</span></div>
      <div class="wk head">${W.weekDays.map((d, i) => `<span class="${d === S.today ? 'now' : ''}">${DOW[i]}</span>`).join('')}</div>
      ${sorted.map((s) => `<div class="wkrow">
        <div class="who"><b>${h(s.name)}${s.id === S.me.id ? ' <span class="pill acc">You</span>' : ''}</b><span class="mono muted">${s.gymDays}/${r.daysRequired} · ${s.points} pts</span></div>
        <div class="wk">${W.weekDays.map((d, i) => cellHtml(gymPosts(s.id, d), `${s.name} ${DOW[i]}`, `${d > S.today ? 'future' : ''} ${d === S.today ? 'today' : ''}`)).join('')}</div>
      </div>`).join('')}
    </div>

    ${sorted.map((s) => {
      const q = s.gymDays >= r.daysRequired;
      const proofs = W.checkins.filter((c) => c.user_id === s.id && c.kind === 'proof');
      const goals = [...s.goals, ...s.challenge];
      return `<div class="card">
        <div class="row between"><div class="row"><h3 style="margin:0">${h(s.name)}</h3>${s.id === S.me.id ? '<span class="pill acc">You</span>' : ''}</div>
          <div><span class="big" style="font-size:30px">${s.points}</span> <span class="of">pts</span></div></div>
        <div class="row between" style="margin-top:10px"><span>Gym</span><span class="count">${s.gymDays} / ${r.daysRequired}</span></div>
        <div class="bar ${q ? 'done' : ''}"><i style="width:${Math.min(100, (s.gymDays / r.daysRequired) * 100)}%"></i></div>
        <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${q ? '<span class="pill good">Eligible for pot</span>' : `<span class="pill bad">${current ? 'Not eligible yet' : 'Missed'}</span>`}${lead(res[s.id])}</div>
        ${goals.length ? `<div style="margin-top:10px">${goals.map((g) => goalRow(g, false)).join('')}</div>` : '<p class="muted small" style="margin-top:10px">No bonus goals this week.</p>'}
        ${proofs.length ? `<p class="muted small" style="margin-top:8px">Proof posted</p><div class="proofs">${proofs.map((c) => cellHtml([c], `${s.name} proof`)).join('')}</div>` : ''}
      </div>`;
    }).join('')}

    <h2>${W.settled ? 'Final result' : 'If the week ended now'}</h2>
    <div class="card">${W.settled
      ? (final.length ? final.join('') : '<p class="muted">Nobody owed anything that week.</p>')
      : (lines.length ? lines.map((l) => `<p>${l}</p>`).join('') : '<p class="muted">Nobody owes anything yet.</p>')}
      <p class="muted small" style="margin-top:10px">Miss ${r.daysRequired} gym days → ${r.stakeType !== 'favors' ? `${money(r.penaltyCents)} split among those who hit` : 'you owe each person who hit a favor'}. Most points among eligible → ${r.stakeType !== 'favors' ? `${money(r.potCents)} from everyone else${r.potQualifiedOnly ? ' who was eligible' : ''}` : 'a favor from everyone else'}${r.stakeType === 'both' ? ' (plus favors)' : ''}. Tie-break: more gym days, then whoever got to ${r.daysRequired} first.</p>
    </div>
    ${chatCard(W.chat, current)}`;

  const go = (n) => { const next = addDays(W.week, n); viewWeek = next === S.week ? null : next; loadWeek().then(() => { render(); window.scrollTo(0, 0); }); };
  document.getElementById('wkPrev').onclick = () => go(-7);
  document.getElementById('wkNext').onclick = () => go(7);
  document.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => openPost(Number(b.dataset.open)); });
  const chat = document.querySelector('.chat'); if (chat) chat.scrollTop = chat.scrollHeight;
  wireComments();
}

function renderFeed() {
  $app.innerHTML = `<p class="eyebrow">Feed</p><h1>Proof</h1>
    ${S.feed.length ? S.feed.map(postCard).join('') : '<p class="muted">Nothing yet. Be first.</p>'}`;
  document.querySelectorAll('[data-react]').forEach((b) => { b.onclick = () => act(() => post(`/api/checkins/${b.dataset.react}/react`, { emoji: b.dataset.e })); });
  document.querySelectorAll('[data-flag]').forEach((b) => {
    b.onclick = () => { const reason = prompt('Why doesn’t this count? (they’ll see this)'); if (reason !== null) act(() => post(`/api/checkins/${b.dataset.flag}/flag`, { reason }), 'Flagged'); };
  });
  document.querySelectorAll('[data-resolve]').forEach((b) => { b.onclick = () => act(() => post(`/api/checkins/${b.dataset.resolve}/resolve`, { action: b.dataset.a }), 'Done'); });
  wireComments();
  document.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { if (confirm('Delete this post?')) act(() => api(`/api/checkins/${b.dataset.del}`, { method: 'DELETE' }), 'Deleted'); }; });
}

function postCard(c) {
  const isVid = c.mime.startsWith('video/');
  const goal = c.kind === 'proof' ? [...S.stats.flatMap((s) => [...s.goals, ...s.challenge])].find((g) => g.id === c.goal_id) : null;
  const counts = {};
  for (const r of c.reactions) counts[r.emoji] = (counts[r.emoji] || []).concat(r.user_id);
  const cmts = S.comments.filter((x) => x.checkin_id === c.id);
  const canResolve = c.status === 'flagged' && (c.flagged_by === S.me.id || (S.me.is_admin && c.user_id !== S.me.id));
  return `<div class="card post" id="feed-${c.id}">
    <div class="row between"><div><b>${h(nameOf(c.user_id))}</b> <span class="muted small">${c.kind === 'gym' ? '🏋️ gym' : `📸 ${h(goal?.title || 'bonus proof')}`}</span></div>
      <span class="muted small">${fmtTime(c.created_at)}</span></div>
    <div class="media">${isVid ? `<video src="${media(c.file)}" controls playsinline preload="metadata"></video>`
      : `<a href="${media(c.file)}" target="_blank"><img src="${media(c.thumb || c.file)}" loading="lazy" alt="check-in photo"></a>`}</div>
    ${c.note ? `<p>${h(c.note)}</p>` : ''}
    ${c.status === 'flagged' ? `<div class="flagbox">🚩 Flagged by ${h(nameOf(c.flagged_by))}${c.flag_reason ? `: “${h(c.flag_reason)}”` : ''}. Doesn't count until cleared.
      ${canResolve ? `<div class="row" style="margin-top:8px"><button class="small" data-resolve="${c.id}" data-a="clear">Clear it</button>${S.me.is_admin ? `<button class="small danger" data-resolve="${c.id}" data-a="reject">Reject</button>` : ''}</div>` : ''}</div>` : ''}
    ${c.status === 'rejected' ? '<div class="flagbox">❌ Rejected — doesn’t count.</div>' : ''}
    <div class="reacts">${['🔥', '💪', '👏', '😂', '🤨'].map((e) => `<button data-react="${c.id}" data-e="${e}" class="${(counts[e] || []).includes(S.me.id) ? 'on' : ''}">${e}${counts[e] ? ` ${counts[e].length}` : ''}</button>`).join('')}</div>
    <div class="row" style="margin-top:6px">
      ${c.user_id !== S.me.id && c.status === 'ok' && c.kind === 'gym' ? `<button class="ghost small danger" data-flag="${c.id}">🚩 Doesn’t count</button>` : ''}
      ${c.user_id === S.me.id && c.day === S.today ? `<button class="ghost small" data-del="${c.id}">Delete</button>` : ''}
    </div>
    ${cmts.length ? `<hr style="margin:10px 0 4px">${cmts.map((x) => `<div class="cmt"><b>${h(nameOf(x.user_id))}</b><span class="grow">${h(x.text)}</span><time>${fmtTime(x.created_at)}</time>${x.user_id === S.me.id ? `<button class="ghost small" data-delcmt="${x.id}" aria-label="Delete comment">✕</button>` : ''}</div>`).join('')}` : ''}
    ${cmtForm(c.id)}
  </div>`;
}

function payButtons(l) {
  const to = userOf(l.to_id);
  const amt = (l.amount_cents / 100).toFixed(2);
  const note = encodeURIComponent(`Lock In — week of ${fmtDay(l.week)}`);
  const b = [];
  if (to.cashapp) b.push(`<a class="btn cashapp" href="https://cash.app/$${encodeURIComponent(to.cashapp)}/${amt}" target="_blank" rel="noopener">Cash App</a>`);
  if (to.venmo) b.push(`<a class="btn venmo" href="https://venmo.com/${encodeURIComponent(to.venmo)}?txn=pay&amount=${amt}&note=${note}" target="_blank" rel="noopener">Venmo</a>`);
  if (to.zelle) b.push(`<button data-copy="${h(to.zelle)}">Zelle: copy ${h(to.zelle)}</button>`);
  return b.length ? `<div class="paybtns">${b.join('')}</div>` : `<p class="muted small">${h(to.name || 'They')} hasn’t added a payment handle yet.</p>`;
}

function renderLedger() {
  const mine = S.ledger.filter((l) => l.from_id === S.me.id || l.to_id === S.me.id);
  const open = mine.filter((l) => l.status === 'open');
  const iOwe = open.filter((l) => l.from_id === S.me.id);
  const owedMe = open.filter((l) => l.to_id === S.me.id);
  const others = S.ledger.filter((l) => l.status === 'open' && l.from_id !== S.me.id && l.to_id !== S.me.id);
  const done = mine.filter((l) => l.status === 'done').slice(0, 20);
  const favorsOn = S.rules.stakeType !== 'money' || S.group.rules.stakeType !== 'money' || S.ledger.some((l) => l.kind === 'favor');
  const desc = (l) => (l.kind === 'money' ? `<span class="mono big" style="font-size:28px">${money(l.amount_cents)}</span>`
    : `<b>${l.reason === 'pot' ? 'Bonus favor' : 'Favor'}</b>${l.favor_text ? `<div class="favcard">${h(l.favor_text)}</div>` : '<p class="muted small">Not chosen yet</p>'}`);
  $app.innerHTML = `<p class="eyebrow">Settle up</p><h1>Who owes who</h1>
    <p class="muted small">Weeks settle Monday 12:05am ET. Debts are netted so there are as few payments as possible.</p>
    ${iOwe.length ? '<h2>You owe</h2>' : ''}
    ${iOwe.map((l) => `<div class="card owe"><p class="muted small">Week of ${fmtDay(l.week)} · to ${h(nameOf(l.to_id))}</p>${desc(l)}
      ${l.kind === 'money' ? payButtons(l) + '<p class="muted small">After you pay, they tap “Received.”</p>' : '<p class="muted small">They mark it redeemed once you deliver.</p>'}</div>`).join('')}
    ${owedMe.length ? '<h2>Owed to you</h2>' : ''}
    ${owedMe.map((l) => {
      const from = userOf(l.from_id);
      const req = l.kind === 'money' && from.venmo ? `<a class="btn venmo" href="https://venmo.com/${encodeURIComponent(from.venmo)}?txn=charge&amount=${(l.amount_cents / 100).toFixed(2)}&note=${encodeURIComponent('Lock In — week of ' + fmtDay(l.week))}" target="_blank" rel="noopener">Request on Venmo</a>` : '';
      const pick = l.kind === 'favor' && !l.favor_text ? `<div class="paybtns"><button class="primary" data-draw="${l.id}">🎲 Draw random</button><button data-pick="${l.id}">Pick a card</button><button data-custom="${l.id}">Write one</button></div>` : '';
      return `<div class="card owed"><p class="muted small">Week of ${fmtDay(l.week)} · from ${h(nameOf(l.from_id))}</p>${desc(l)}${pick}
        <div class="paybtns">${req}<button class="good" data-done="${l.id}">${l.kind === 'money' ? 'Received ✓' : 'Redeemed ✓'}</button><button data-nudge="${l.id}">Nudge 👀</button></div></div>`;
    }).join('')}
    ${!iOwe.length && !owedMe.length ? '<div class="card"><p>All square. 🧘</p></div>' : ''}
    ${others.length ? `<h2>Rest of the group</h2><div class="card">${others.map((l) => `<p>${h(nameOf(l.from_id))} → ${h(nameOf(l.to_id))}: ${l.kind === 'money' ? `<b class="mono">${money(l.amount_cents)}</b>` : 'a favor'}</p>`).join('')}</div>` : ''}
    ${favorsOn ? favorDeck() : ''}
    ${done.length ? `<h2>Settled</h2><div class="card">${done.map((l) => `<p class="small">✓ ${fmtDay(l.week)}: ${h(nameOf(l.from_id))} → ${h(nameOf(l.to_id))} ${l.kind === 'money' ? money(l.amount_cents) : `favor${l.favor_text ? ` — ${h(l.favor_text)}` : ''}`}</p>`).join('')}</div>` : ''}`;
  document.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast('Copied — open your bank app'); }; });
  document.querySelectorAll('[data-done]').forEach((b) => { b.onclick = () => { if (confirm('Mark this as settled?')) act(() => post(`/api/ledger/${b.dataset.done}/done`), 'Settled ✓'); }; });
  document.querySelectorAll('[data-nudge]').forEach((b) => { b.onclick = () => act(() => post(`/api/ledger/${b.dataset.nudge}/nudge`), 'Nudged'); });
  document.querySelectorAll('[data-draw]').forEach((b) => { b.onclick = () => act(() => post(`/api/ledger/${b.dataset.draw}/favor`), 'Drawn 🎲'); });
  document.querySelectorAll('[data-custom]').forEach((b) => { b.onclick = () => { const t = prompt('What do they owe you?'); if (t) act(() => post(`/api/ledger/${b.dataset.custom}/favor`, { custom: t }), 'Set'); }; });
  document.querySelectorAll('[data-pick]').forEach((b) => {
    b.onclick = () => {
      const visible = S.favors.filter((f) => f.text);
      if (!visible.length) return toast('No visible cards — draw random or write one');
      const n = prompt(`Pick a number:\n${visible.map((f, i) => `${i + 1}. ${f.text}`).join('\n')}`);
      const f = visible[Number(n) - 1];
      if (f) act(() => post(`/api/ledger/${b.dataset.pick}/favor`, { favorId: f.id }), 'Picked');
    };
  });
  wireDeck();
}

function favorDeck() {
  return `<h2>Favor deck</h2>
    <p class="muted small">Write the favors the loser has to do. Only people in this group can see this. Secret cards stay hidden until they’re drawn.</p>
    <div class="card">
      <form id="favForm"><input name="text" maxlength="200" placeholder="e.g. 30-minute massage, winner’s choice" required>
        <div class="row between" style="margin-top:8px"><label class="check" style="margin:0"><input type="checkbox" name="secret"> Secret card</label><button class="primary">Add</button></div></form>
      <hr>
      ${S.favors.length ? S.favors.map((f) => `<div class="member"><span class="grow">${f.text ? h(f.text) : `🔒 Secret card by ${h(nameOf(f.author_id))}`}${f.secret && f.text ? ' <span class="pill">secret</span>' : ''}</span>
        ${f.author_id === S.me.id ? `<button class="ghost small danger" data-unfav="${f.id}">Remove</button>` : ''}</div>`).join('') : '<p class="muted">Deck is empty.</p>'}
    </div>`;
}
function wireDeck() {
  const f = document.getElementById('favForm');
  if (f) f.onsubmit = (ev) => { ev.preventDefault(); const d = new FormData(f); act(() => post('/api/favors', { text: d.get('text'), secret: !!d.get('secret') }), 'Added to deck').then(() => f.reset()); };
  document.querySelectorAll('[data-unfav]').forEach((b) => { b.onclick = () => act(() => api(`/api/favors/${b.dataset.unfav}`, { method: 'DELETE' })); });
}

// ---------- settings ----------
function goalEditor(list, isChallenge) {
  return `${list.map((g) => `<div class="goal"><form class="goalForm" data-id="${g.id}">
      <input name="title" value="${h(g.title)}" maxlength="60" required>
      <div class="grid2" style="margin-top:6px"><div><label style="margin-top:0">Target</label><input name="target" type="number" min="1" value="${g.target}" inputmode="numeric"></div>
      <div><label style="margin-top:0">Points</label><input name="points" type="number" min="0" value="${g.points}" inputmode="numeric"></div></div>
      <div class="row between" style="margin-top:6px"><button class="ghost small danger" type="button" data-delgoal="${g.id}">Remove</button><button class="small">Save</button></div>
    </form></div>`).join('')}
    <details ${list.length ? '' : 'open'}><summary>+ Add ${isChallenge ? 'challenge' : 'goal'}</summary>${newGoalForm(isChallenge)}</details>`;
}

function renderSettings() {
  const r = S.group.rules;
  const E = S.edit;
  const invite = `${location.origin}/join/${S.group.invite_code}`;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  $app.innerHTML = `<p class="eyebrow">${h(S.group.name)}</p><h1>Settings</h1>
    <div id="accounts"></div>

    <h2>Notifications</h2>
    <div class="card" id="pushCard">${isIOS && !standalone
      ? '<p>On iPhone, first add this to your Home Screen: tap <b>Share</b> → <b>Add to Home Screen</b>, then open Lock In from there and come back here.</p>'
      : `<p class="muted small">Get pinged when someone posts, when you’re flagged, daily 7pm reminders if you haven’t gone, and Monday results.</p>
         <button class="primary full" id="pushBtn">Turn on notifications</button><button class="ghost small" id="pushTest">Send me a test</button>
         <details><summary>Not getting notifications?</summary><p class="small">On iPhone: open the <b>Settings</b> app → <b>Notifications</b> → <b>Lock In</b>. Turn on <b>Allow Notifications</b>, tick <b>Lock Screen</b>, <b>Notification Centre</b> and <b>Banners</b>, and switch on <b>Sounds</b> and <b>Badges</b>. Set Banner Style to <b>Persistent</b> if you want them to stay on screen.</p><p class="small">Also check that a <b>Focus</b> mode (Do Not Disturb, Sleep, Work) isn’t silencing Lock In, and that you opened the app from the Home Screen icon, not Safari. Then tap “Turn on notifications” again and send a test.</p></details>`}</div>

    <h2>My bonus goals</h2>
    ${E.isNext ? `<div class="notice">This week’s goals are locked (they lock Tuesday 12am ET). Changes below start <b>next week (${fmtDay(E.week)})</b>.</div>` : '<p class="muted small">You can edit this week’s goals until Tuesday 12am ET. After that, edits apply to next week.</p>'}
    <div class="card">${goalEditor(E.goals, false)}</div>

    <h2>How I get paid</h2>
    <form class="card" id="payForm">
      <label style="margin-top:0">Cash App $cashtag</label><input name="cashapp" value="${h(S.me.cashapp)}" placeholder="yourtag" autocapitalize="off">
      <label>Venmo username</label><input name="venmo" value="${h(S.me.venmo)}" placeholder="your-handle" autocapitalize="off">
      <label>Zelle phone or email</label><input name="zelle" value="${h(S.me.zelle)}" autocapitalize="off">
      <button class="primary full" style="margin-top:14px">Save</button>
      ${S.me.cashapp || S.me.venmo ? `<p class="muted small">Test your link: ${S.me.cashapp ? `<a href="https://cash.app/$${encodeURIComponent(S.me.cashapp)}/1" target="_blank">Cash App $1</a> ` : ''}${S.me.venmo ? `<a href="https://venmo.com/${encodeURIComponent(S.me.venmo)}?txn=pay&amount=1" target="_blank">Venmo $1</a>` : ''} (don’t send it)</p>` : ''}
    </form>

    <h2>Change PIN</h2>
    <form class="card" id="pinForm"><div class="grid2"><input name="oldPin" class="pin" inputmode="numeric" maxlength="4" placeholder="old"><input name="newPin" class="pin" inputmode="numeric" maxlength="4" placeholder="new"></div>
      <button class="full" style="margin-top:10px">Update PIN</button></form>

    <h2>Invite</h2>
    <div class="card"><p class="small mono" style="word-break:break-all">${h(invite)}</p>
      <div class="paybtns"><button class="primary" id="share">Share invite</button>${S.me.is_admin ? '<button id="regen">New link</button>' : ''}</div>
      <p class="muted small">Anyone with this link can join and log in with their own PIN.</p></div>

    <h2>Rules</h2>
    ${S.me.is_admin ? `<form class="card" id="rulesForm">
      <label style="margin-top:0">Group name</label><input name="name" value="${h(S.group.name)}" maxlength="60">
      <label>Gym days required per week</label><input name="daysRequired" type="number" min="1" max="7" value="${r.daysRequired}">
      <label>Stakes</label><select name="stakeType">${[['money', 'Money'], ['favors', 'Favors (no money)'], ['both', 'Money + favors']].map(([v, t]) => `<option value="${v}" ${r.stakeType === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <div class="grid2"><div><label>Miss penalty ($)</label><input name="penalty" type="number" min="0" step="1" value="${r.penaltyCents / 100}"></div>
      <div><label>Weekly pot ($)</label><input name="pot" type="number" min="0" step="1" value="${r.potCents / 100}"></div></div>
      <label class="check"><input type="checkbox" name="potQualifiedOnly" ${r.potQualifiedOnly ? 'checked' : ''}> Only gym-qualified people pay into the pot</label>
      <button class="primary full" style="margin-top:14px">Save rules</button>
      <p class="muted small">Changes start next Monday (or right away during your group’s first week).</p>
    </form>
    <h2>Group challenge</h2><p class="muted small">Same for everyone. Each person earns the points when they hit it.</p>
    <div class="card">${goalEditor(E.challenge, true)}</div>
    <h2>Members</h2><div class="card">${S.users.map((u) => `<div class="member"><span>${h(u.name)} ${u.is_admin ? '<span class="pill">admin</span>' : ''}</span>${u.id !== S.me.id ? `<button class="ghost small danger" data-kick="${u.id}">Remove</button>` : ''}</div>`).join('')}</div>
    <h2>Start another group</h2><form class="card" id="newGroup"><p class="muted small">E.g. a separate one for you and your partner with favor stakes. You'll use the same name and PIN there; switch groups at the top of Settings.</p>
      <input name="groupName" placeholder="Group name" required maxlength="60">
      <select name="stakeType" style="margin-top:8px"><option value="favors">Favors</option><option value="money">Money</option><option value="both">Money + favors</option></select>
      <button class="full" style="margin-top:10px">Create group</button></form>`
    : `<div class="card"><p>${r.daysRequired} gym days a week. ${stakesLine({ ...r })}${r.potQualifiedOnly ? ' (pot only between qualifiers)' : ''}.</p></div>`}
    <p style="text-align:center;margin-top:24px"><button class="ghost danger" id="logout">Log out</button></p>`;

  // accounts switcher
  api('/api/accounts').then((acc) => {
    if (acc.length < 2) return;
    document.getElementById('accounts').innerHTML = `<div class="card tight"><p class="muted small">Your groups on this phone</p><div class="paybtns">${acc.map((a) => `<button class="${a.current ? 'primary' : ''}" data-acct="${h(a.token)}">${h(a.group)}</button>`).join('')}</div></div>`;
    document.querySelectorAll('[data-acct]').forEach((b) => { b.onclick = async () => { await post('/api/accounts/switch', { token: b.dataset.acct }); location.hash = '#today'; boot(); }; });
  }).catch(() => {});

  const pushBtn = document.getElementById('pushBtn');
  if (pushBtn) { pushBtn.onclick = enablePush; document.getElementById('pushTest').onclick = () => act(() => post('/api/push/test'), 'Sent — check your notifications'); }
  document.getElementById('payForm').onsubmit = (ev) => { ev.preventDefault(); act(() => api('/api/me', { method: 'PUT', body: Object.fromEntries(new FormData(ev.target)) }), 'Saved'); };
  document.getElementById('pinForm').onsubmit = (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); act(() => api('/api/me', { method: 'PUT', body: { ...d, cashapp: S.me.cashapp, venmo: S.me.venmo, zelle: S.me.zelle } }), 'PIN updated').then(() => ev.target.reset()); };
  document.getElementById('share').onclick = async () => {
    const data = { title: `Join ${S.group.name} on Lock In`, text: 'Gym 5x a week or you pay. Join here:', url: invite };
    if (navigator.share) { try { await navigator.share(data); } catch { /* cancelled */ } } else { navigator.clipboard?.writeText(invite); toast('Link copied'); }
  };
  document.getElementById('regen')?.addEventListener('click', () => { if (confirm('Old invite link will stop working. Continue?')) act(() => post('/api/group/invite'), 'New link made'); });
  document.getElementById('rulesForm')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target)); d.potQualifiedOnly = !!d.potQualifiedOnly;
    act(async () => { const r2 = await api('/api/group', { method: 'PUT', body: d }); toast(r2.appliesNow ? 'Saved — applies this week' : 'Saved — starts next Monday'); });
  });
  document.getElementById('newGroup')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { const r2 = await post('/api/groups', Object.fromEntries(new FormData(ev.target))); lsSet('li_code', r2.code); location.hash = '#settings'; toast('Group created — send the invite'); boot(); } catch (e) { toast(e.message); }
  });
  document.querySelectorAll('[data-kick]').forEach((b) => { b.onclick = () => { if (confirm('Remove this person from the group?')) act(() => api(`/api/members/${b.dataset.kick}`, { method: 'DELETE' }), 'Removed'); }; });
  document.querySelectorAll('.goalForm').forEach((f) => { f.onsubmit = (ev) => { ev.preventDefault(); act(() => api(`/api/goals/${f.dataset.id}`, { method: 'PUT', body: Object.fromEntries(new FormData(f)) }), 'Saved'); }; });
  wireNewGoal();
  document.querySelectorAll('[data-delgoal]').forEach((b) => { b.onclick = () => { if (confirm('Remove this goal?')) act(() => api(`/api/goals/${b.dataset.delgoal}`, { method: 'DELETE' }), 'Removed'); }; });
  document.getElementById('logout').onclick = async () => { await post('/api/logout'); location.reload(); };
}

// ---------- push ----------
function urlB64(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('This browser can’t do push notifications');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return toast('Notifications are blocked — allow them in your phone settings');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(S.pushKey) });
  await post('/api/push/subscribe', sub.toJSON());
  toast('Notifications on ✅');
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
