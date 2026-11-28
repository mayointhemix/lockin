#!/usr/bin/env node
// Fill a LOCAL Lock In with example data, so you can see every screen without real members.
//
//   Terminal 1:  DATA_DIR=./data npm start
//   Terminal 2:  npm run seed
//
// It talks to the running app the same way the frontend does, then adds a few past-week
// debts straight into the local database (debts normally only appear after a week settles).
// It refuses to run against anything that isn't on this computer, or that already has groups.
const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.SEED_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const PIN = '1234'; // example PIN for every example member; local use only
const IMAGE = path.join(__dirname, '..', 'web', 'public', 'icon-512.png');

const host = new URL(BASE).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
  console.error(`Refusing to seed ${BASE}: this only runs against an app on this computer.`);
  process.exit(1);
}

function client() {
  let cookie = '';
  const call = async (method, url, body, isForm) => {
    const headers = { cookie };
    if (body && !isForm) headers['content-type'] = 'application/json';
    const r = await fetch(BASE + url, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const set = r.headers.getSetCookie?.() || [];
    if (set.length) {
      const jar = new Map(cookie.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c]));
      for (const c of set) { const kv = c.split(';')[0]; jar.set(kv.split('=')[0], kv); }
      cookie = [...jar.values()].join('; ');
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${url}: ${data.error || r.status}`);
    return data;
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), form: (u, f) => call('POST', u, f, true) };
}

async function postPhoto(c, fields) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  f.append('file', new Blob([fs.readFileSync(IMAGE)], { type: 'image/png' }), 'example.png');
  return c.form('/api/checkins', f);
}

(async () => {
  const probe = client();
  let boot;
  try { boot = await probe.get('/api/bootstrap'); } catch (e) {
    console.error(`Can't reach ${BASE}. Start the app first:  DATA_DIR=${path.relative(process.cwd(), DATA_DIR) || '.'} npm start`); process.exit(1);
  }
  if (boot.hasGroups) { console.error('This app already has groups. Seed only an empty local app (delete the local data folder to start over).'); process.exit(1); }

  const mayo = client(); const tasha = client(); const jay = client();
  const { code } = await mayo.post('/api/groups', { groupName: 'Example Crew', name: 'Mayo', pin: PIN, stakeType: 'both' });
  await tasha.post('/api/join', { name: 'Tasha', pin: PIN, code });
  await jay.post('/api/join', { name: 'Jay', pin: PIN, code });

  await mayo.post('/api/goals', { title: 'Cold plunge', target: 2, points: 25 });
  await mayo.post('/api/goals', { title: 'Read 20 pages', target: 5, points: 10 });
  await tasha.post('/api/goals', { title: 'Run 10 miles', target: 1, points: 30 });
  await mayo.post('/api/goals', { title: '10k steps a day', target: 5, points: 20, challenge: true });

  let state = await tasha.get('/api/state');
  const idOf = (name) => state.users.find((u) => u.name === name).id;
  const tashaGoal = state.stats.find((s) => s.name === 'Tasha').goals[0];
  await tasha.post(`/api/counters/${tashaGoal.id}`, { delta: 1 });

  const first = await postPhoto(tasha, { kind: 'gym', note: 'Legs. Stairs are a problem now.' });
  await postPhoto(jay, { kind: 'gym', note: '' });
  await postPhoto(tasha, { kind: 'proof', goal_id: tashaGoal.id, note: 'Ten done' });

  await jay.post('/api/comments', { text: 'Who is skipping Friday?' });
  await jay.post('/api/comments', { text: 'Strong', checkin_id: first.id });
  await jay.post(`/api/checkins/${first.id}/react`, { emoji: '🔥' });
  await tasha.post('/api/favors', { text: 'Wash my car', secret: false });
  await jay.post('/api/favors', { text: 'A surprise', secret: true });

  // Past-week debts, written directly: Mayo owes Tasha, Jay owes Mayo a favor, Jay owes Tasha, one settled.
  const Database = require('better-sqlite3');
  const db = new Database(path.join(DATA_DIR, 'lockin.db'));
  const [y, m, d] = state.week.split('-').map(Number);
  const wk = (weeksAgo) => new Date(Date.UTC(y, m - 1, d - 7 * weeksAgo)).toISOString().slice(0, 10);
  const gid = state.group.id;
  const add = db.prepare('INSERT INTO ledger(group_id,week,from_id,to_id,kind,amount_cents,reason,status) VALUES (?,?,?,?,?,?,?,?)');
  add.run(gid, wk(1), idOf('Mayo'), idOf('Tasha'), 'money', 2500, 'penalty', 'open');
  add.run(gid, wk(1), idOf('Jay'), idOf('Mayo'), 'favor', 0, 'pot', 'open');
  add.run(gid, wk(1), idOf('Jay'), idOf('Tasha'), 'money', 2500, 'penalty', 'open');
  add.run(gid, wk(2), idOf('Tasha'), idOf('Mayo'), 'money', 500, 'penalty', 'done');
  db.prepare("UPDATE users SET venmo='tasha-example', cashapp='tashaexample', zelle='tasha@example.com' WHERE id=?").run(idOf('Tasha'));
  db.close();

  console.log('Seeded "Example Crew": Mayo (admin), Tasha, Jay. Posts, comments, goals, a favor deck and debts.');
  console.log(`Open ${BASE}/join/${code} and log in as any of them with PIN ${PIN}.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
