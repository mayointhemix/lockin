const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const { db, UPLOAD_DIR } = require('./db');
const S = require('./settlement');
const push = require('./push');

let sharp = null;
try { sharp = require('sharp'); } catch { /* optional */ }

const PORT = Number(process.env.PORT || 3000);
const TZ = process.env.TZ_NAME || S.DEFAULT_TZ;
const OFFSET = Number(process.env.TIME_OFFSET_MS || 0); // testing only
const now = () => Date.now() + OFFSET;
const today = () => S.etDay(now(), TZ);
const currentWeek = () => S.weekStartOf(today());

const DEFAULT_RULES = {
  daysRequired: 5,
  stakeType: 'money', // money | favors | both
  penaltyCents: 15000,
  potCents: 2500,
  potQualifiedOnly: false,
};

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ---------- helpers ----------
const clean = (v, max = 80) => String(v ?? '').trim().slice(0, max);
const validPin = (p) => /^\d{4}$/.test(String(p || ''));
const newCode = () => crypto.randomBytes(5).toString('base64url');
const fail = (res, code, msg) => res.status(code).json({ error: msg });

function groupRules(groupId) {
  return { ...DEFAULT_RULES, ...JSON.parse(db.prepare('SELECT rules_json FROM groups WHERE id=?').get(groupId).rules_json) };
}

function ensureWeek(groupId, week) {
  let row = db.prepare('SELECT * FROM weeks WHERE group_id=? AND week=?').get(groupId, week);
  if (!row) {
    db.prepare('INSERT INTO weeks(group_id,week,rules_json) VALUES(?,?,?)').run(groupId, week, JSON.stringify(groupRules(groupId)));
    row = db.prepare('SELECT * FROM weeks WHERE group_id=? AND week=?').get(groupId, week);
  }
  return { ...row, rules: { ...DEFAULT_RULES, ...JSON.parse(row.rules_json) } };
}

// Goals for (group, owner, week); lazily copied from the latest earlier week.
function goalsFor(groupId, ownerId, week) {
  const q = 'SELECT * FROM goals WHERE group_id=? AND user_id=? AND week=? ORDER BY sort, id';
  let rows = db.prepare(q).all(groupId, ownerId, week);
  if (rows.length) return rows;
  const prev = db.prepare('SELECT MAX(week) w FROM goals WHERE group_id=? AND user_id=? AND week<?').get(groupId, ownerId, week).w;
  if (!prev) return [];
  const ins = db.prepare('INSERT INTO goals(group_id,user_id,week,title,target,points,sort) VALUES(?,?,?,?,?,?,?)');
  db.transaction(() => {
    for (const g of db.prepare(q).all(groupId, ownerId, prev)) ins.run(groupId, ownerId, week, g.title, g.target, g.points, g.sort);
  })();
  rows = db.prepare(q).all(groupId, ownerId, week);
  return rows;
}

// Which week a goal edit applies to: current week until Tuesday 12am ET (or a brand-new user / group), else next week.
function editWeekFor(user) {
  const wk = currentWeek();
  const group = db.prepare('SELECT created_week FROM groups WHERE id=?').get(user.group_id);
  const open = S.dayOfWeek(today()) === 0 || user.created_week === wk || group.created_week === wk;
  return open ? wk : S.addDays(wk, 7);
}

function members(groupId, week) {
  return db.prepare('SELECT * FROM users WHERE group_id=? AND active=1 AND created_week<=? ORDER BY id').all(groupId, week);
}

function weekStats(groupId, week) {
  const wk = ensureWeek(groupId, week);
  const users = members(groupId, week);
  const checkins = db.prepare('SELECT user_id, day, kind, status FROM checkins WHERE group_id=? AND week=?').all(groupId, week);
  const gym = S.gymDaysByUser(checkins);
  const challenge = goalsFor(groupId, 0, week);
  const stats = users.map((u) => {
    const own = goalsFor(groupId, u.id, week);
    const all = [...own, ...challenge];
    const counts = {};
    if (all.length) {
      for (const r of db.prepare(`SELECT goal_id, count FROM counters WHERE user_id=? AND goal_id IN (${all.map(() => '?').join(',')})`).all(u.id, ...all.map((g) => g.id))) counts[r.goal_id] = r.count;
    }
    const days = [...(gym.get(u.id) || [])].sort();
    return {
      id: u.id, name: u.name, gymDays: days.length, days,
      goals: own.map((g) => ({ ...g, count: counts[g.id] || 0 })),
      challenge: challenge.map((g) => ({ ...g, count: counts[g.id] || 0 })),
      points: S.pointsFor(all, counts),
    };
  });
  return { rules: wk.rules, stats, settled: !!wk.settled_at };
}

// In favor mode, each debt line becomes one favor; use big amounts so splits never round to zero.
function computeSettlement(stats, rules) {
  const input = stats.map((s) => ({ id: s.id, gymDays: s.gymDays, points: s.points }));
  const money = rules.stakeType !== 'favors' ? S.settleWeek(input, rules) : null;
  const favors = rules.stakeType !== 'money'
    ? S.settleWeek(input, { ...rules, penaltyCents: 1e6, potCents: 1e6 }) : null;
  const results = (money || favors).results;
  return {
    results,
    money: money ? S.netDebts(money.debts) : [],
    favors: favors ? favors.debts.map((d) => ({ from: d.from, to: d.to, reason: d.reason })) : [],
  };
}

function settleWeekIfDue(groupId, week) {
  const wk = ensureWeek(groupId, week);
  if (wk.settled_at) return null;
  const { stats, rules } = weekStats(groupId, week);
  const out = computeSettlement(stats, rules);
  const ins = db.prepare('INSERT INTO ledger(group_id,week,from_id,to_id,kind,amount_cents,reason) VALUES(?,?,?,?,?,?,?)');
  db.transaction(() => {
    for (const d of out.money) ins.run(groupId, week, d.from, d.to, 'money', d.amount, 'week');
    for (const f of out.favors) ins.run(groupId, week, f.from, f.to, 'favor', 0, f.reason);
    db.prepare('UPDATE weeks SET settled_at=?, results_json=? WHERE group_id=? AND week=?')
      .run(now(), JSON.stringify({ stats: stats.map(({ id, name, gymDays, points }) => ({ id, name, gymDays, points })), results: out.results }), groupId, week);
  })();
  return { stats, out };
}

function runSettlements() {
  const wk = currentWeek();
  for (const g of db.prepare('SELECT id, created_week FROM groups').all()) {
    // Every week since the group started must exist, so a week nobody opened the app still settles.
    for (let w = g.created_week; w <= wk; w = S.addDays(w, 7)) ensureWeek(g.id, w);
    const due = db.prepare('SELECT week FROM weeks WHERE group_id=? AND week<? AND settled_at IS NULL ORDER BY week').all(g.id, wk);
    for (const { week } of due) {
      const r = settleWeekIfDue(g.id, week);
      if (!r) continue;
      broadcast(g.id, 'settled');
      const names = Object.fromEntries(r.stats.map((s) => [s.id, s.name]));
      for (const s of r.stats) {
        const res = r.out.results.find((x) => x.id === s.id);
        const owes = r.out.money.filter((d) => d.from === s.id).reduce((a, d) => a + d.amount, 0);
        const favs = r.out.favors.filter((d) => d.from === s.id).length;
        const gets = r.out.favors.filter((d) => d.to === s.id).length;
        let body = `${s.gymDays} gym days, ${s.points} pts. `;
        if (res.potWinner) body += 'You won the pot! ';
        if (owes) body += `You owe $${(owes / 100).toFixed(2)}${favs ? ' + ' : '.'}`;
        if (favs) body += `You owe ${favs} favor${favs > 1 ? 's' : ''}.`;
        if (!owes && !favs && gets) body += `You've got ${gets} favor${gets > 1 ? 's' : ''} coming.`;
        if (!owes && !favs && !res.potWinner && !gets) body += res.qualified ? 'You held the line.' : 'Nobody hit, nobody pays.';
        push.sendToUsers([s.id], { title: 'Week results are in', body, url: '/#ledger' }).catch(() => {});
      }
      void names;
    }
  }
}

// ---------- realtime ----------
const streams = new Map(); // groupId -> Set(res)
function broadcast(groupId, type) {
  for (const res of streams.get(groupId) || []) res.write(`data: ${JSON.stringify({ type })}\n\n`);
}

// ---------- auth ----------
const attempts = new Map();
function locked(key) {
  const a = attempts.get(key);
  return a && a.count >= 5 && now() - a.first < 15 * 60 * 1000;
}
function recordFail(key) {
  const a = attempts.get(key);
  if (!a || now() - a.first > 15 * 60 * 1000) attempts.set(key, { count: 1, first: now() });
  else a.count++;
}

function startSession(res, userId) {
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(token, userId, now());
  const cookies = JSON.parse(res.req.cookies.li_accounts || '[]').filter((t) => db.prepare('SELECT 1 FROM sessions WHERE token=?').get(t));
  cookies.push(token);
  const opts = { httpOnly: true, sameSite: 'lax', secure: res.req.secure, maxAge: 90 * 864e5 };
  res.cookie('li_session', token, opts);
  res.cookie('li_accounts', JSON.stringify(cookies.slice(-5)), opts);
}

function auth(req, res, next) {
  const t = req.cookies.li_session;
  const row = t && db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.created_at>? AND u.active=1').get(t, now() - 90 * 864e5);
  if (!row) return fail(res, 401, 'Not logged in');
  req.user = row;
  next();
}
const admin = (req, res, next) => (req.user.is_admin ? next() : fail(res, 403, 'Admins only'));

function createGroup(name, rules = {}) {
  const wk = currentWeek();
  const info = db.prepare('INSERT INTO groups(name,invite_code,rules_json,created_at,created_week) VALUES(?,?,?,?,?)')
    .run(name, newCode(), JSON.stringify({ ...DEFAULT_RULES, ...rules }), now(), wk);
  return info.lastInsertRowid;
}
function createUser(groupId, name, pin, isAdmin = 0) {
  return db.prepare('INSERT INTO users(group_id,name,pin_hash,is_admin,created_at,created_week) VALUES(?,?,?,?,?,?)')
    .run(groupId, name, bcrypt.hashSync(String(pin), 10), isAdmin, now(), currentWeek()).lastInsertRowid;
}

// ---------- routes: onboarding ----------
app.get('/api/bootstrap', (req, res) => {
  const hasGroups = !!db.prepare('SELECT 1 FROM groups LIMIT 1').get();
  res.json({ hasGroups });
});

// First group can be created by anyone (fresh install). After that, only a logged-in admin.
app.post('/api/groups', (req, res) => {
  const hasGroups = !!db.prepare('SELECT 1 FROM groups LIMIT 1').get();
  let creator = null;
  if (hasGroups) {
    const t = req.cookies.li_session;
    creator = t && db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(t);
    if (!creator?.is_admin) return fail(res, 403, 'Only an admin can start another group');
  }
  const groupName = clean(req.body.groupName, 60) || 'Lock In';
  const name = clean(req.body.name || creator?.name, 30);
  const pin = req.body.pin;
  if (!name) return fail(res, 400, 'Name required');
  if (!creator && !validPin(pin)) return fail(res, 400, 'PIN must be 4 digits');
  const stakeType = ['money', 'favors', 'both'].includes(req.body.stakeType) ? req.body.stakeType : 'money';
  const gid = createGroup(groupName, { stakeType });
  let uid;
  if (creator && !validPin(pin)) {
    uid = db.prepare('INSERT INTO users(group_id,name,pin_hash,is_admin,created_at,created_week) VALUES(?,?,?,?,?,?)')
      .run(gid, name, creator.pin_hash, 1, now(), currentWeek()).lastInsertRowid;
  } else uid = createUser(gid, name, pin, 1);
  startSession(res, uid);
  res.json({ ok: true, code: db.prepare('SELECT invite_code FROM groups WHERE id=?').get(gid).invite_code });
});

app.get('/api/invite/:code', (req, res) => {
  const g = db.prepare('SELECT id,name FROM groups WHERE invite_code=?').get(req.params.code);
  if (!g) return fail(res, 404, 'That invite link is not valid anymore');
  const names = db.prepare('SELECT name FROM users WHERE group_id=? AND active=1 ORDER BY id').all(g.id).map((u) => u.name);
  res.json({ groupName: g.name, names });
});

app.post('/api/join', (req, res) => {
  const g = db.prepare('SELECT id FROM groups WHERE invite_code=?').get(req.body.code);
  if (!g) return fail(res, 404, 'Invalid invite');
  const name = clean(req.body.name, 30);
  if (!name) return fail(res, 400, 'Name required');
  if (!validPin(req.body.pin)) return fail(res, 400, 'PIN must be 4 digits');
  if (db.prepare('SELECT 1 FROM users WHERE group_id=? AND name=? COLLATE NOCASE').get(g.id, name)) return fail(res, 409, 'That name is taken. Log in instead.');
  const uid = createUser(g.id, name, req.body.pin);
  startSession(res, uid);
  broadcast(g.id, 'members');
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const g = db.prepare('SELECT id FROM groups WHERE invite_code=?').get(req.body.code);
  if (!g) return fail(res, 404, 'Invalid invite');
  const key = `${g.id}:${clean(req.body.name).toLowerCase()}`;
  if (locked(key)) return fail(res, 429, 'Too many wrong PINs. Try again in 15 minutes.');
  const u = db.prepare('SELECT * FROM users WHERE group_id=? AND name=? COLLATE NOCASE AND active=1').get(g.id, clean(req.body.name));
  if (!u || !bcrypt.compareSync(String(req.body.pin || ''), u.pin_hash)) { recordFail(key); return fail(res, 401, 'Wrong name or PIN'); }
  attempts.delete(key);
  startSession(res, u.id);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token=?').run(req.cookies.li_session || '');
  res.clearCookie('li_session');
  res.json({ ok: true });
});

// Accounts on this phone (one per group) for the group switcher.
app.get('/api/accounts', (req, res) => {
  const tokens = JSON.parse(req.cookies.li_accounts || '[]');
  const out = [];
  for (const t of tokens) {
    const r = db.prepare('SELECT u.id, u.name, g.name gname, g.id gid FROM sessions s JOIN users u ON u.id=s.user_id JOIN groups g ON g.id=u.group_id WHERE s.token=? AND u.active=1').get(t);
    if (r) out.push({ token: t, name: r.name, group: r.gname, current: t === req.cookies.li_session });
  }
  res.json(out);
});
app.post('/api/accounts/switch', (req, res) => {
  const tokens = JSON.parse(req.cookies.li_accounts || '[]');
  if (!tokens.includes(req.body.token)) return fail(res, 400, 'Unknown account');
  res.cookie('li_session', req.body.token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 90 * 864e5 });
  res.json({ ok: true });
});

// ---------- state ----------
app.get('/api/state', auth, (req, res) => {
  const u = req.user;
  const gid = u.group_id;
  const group = db.prepare('SELECT * FROM groups WHERE id=?').get(gid);
  const week = currentWeek();
  const { rules, stats } = weekStats(gid, week);
  const projection = computeSettlement(stats, rules);
  const users = db.prepare('SELECT id,name,is_admin,cashapp,venmo,zelle FROM users WHERE group_id=? AND active=1 ORDER BY id').all(gid);

  const feed = db.prepare('SELECT * FROM checkins WHERE group_id=? ORDER BY id DESC LIMIT 60').all(gid).map((c) => ({
    ...c,
    reactions: db.prepare('SELECT emoji, user_id FROM reactions WHERE checkin_id=?').all(c.id),
  }));
  const ledger = db.prepare('SELECT * FROM ledger WHERE group_id=? ORDER BY week DESC, id DESC LIMIT 200').all(gid);
  const favors = db.prepare('SELECT * FROM favors WHERE group_id=? AND used=0 ORDER BY id DESC').all(gid)
    .map((f) => (f.secret && f.author_id !== u.id ? { ...f, text: null } : f));
  const history = db.prepare('SELECT week, results_json FROM weeks WHERE group_id=? AND settled_at IS NOT NULL ORDER BY week DESC LIMIT 12').all(gid)
    .map((w) => ({ week: w.week, ...JSON.parse(w.results_json) }));
  const editWeek = editWeekFor(u);

  res.json({
    me: { id: u.id, name: u.name, is_admin: !!u.is_admin, cashapp: u.cashapp, venmo: u.venmo, zelle: u.zelle },
    group: { id: gid, name: group.name, invite_code: u.is_admin ? group.invite_code : group.invite_code, rules: groupRules(gid) },
    today: today(), week, weekDays: S.weekDays(week), rules, stats, projection, users, feed, ledger, favors, history,
    edit: { week: editWeek, isNext: editWeek !== week, goals: goalsFor(gid, u.id, editWeek), challenge: goalsFor(gid, 0, editWeek) },
    pushKey: push.publicKey,
  });
});

app.get('/api/stream', auth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const gid = req.user.group_id;
  if (!streams.has(gid)) streams.set(gid, new Set());
  streams.get(gid).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); streams.get(gid).delete(res); });
});

// ---------- check-ins ----------
const upload = multer({
  dest: path.join(UPLOAD_DIR, 'tmp'),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(image|video)\//.test(file.mimetype)),
});

app.post('/api/checkins', auth, upload.single('file'), async (req, res) => {
  const f = req.file;
  if (!f) return fail(res, 400, 'Add a photo or video');
  const u = req.user;
  const kind = req.body.kind === 'proof' ? 'proof' : 'gym';
  let goalId = null;
  if (kind === 'proof') {
    const g = db.prepare('SELECT * FROM goals WHERE id=? AND group_id=?').get(req.body.goal_id, u.group_id);
    if (!g) { fs.unlink(f.path, () => {}); return fail(res, 400, 'Unknown goal'); }
    goalId = g.id;
  }
  const base = crypto.randomBytes(12).toString('hex');
  let file; let thumb = null; let mime = f.mimetype;
  try {
    if (mime.startsWith('image/') && sharp) {
      try {
        file = `${base}.jpg`; thumb = `${base}_t.jpg`;
        await sharp(f.path).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(path.join(UPLOAD_DIR, file));
        await sharp(f.path).rotate().resize(500, 500, { fit: 'cover' }).jpeg({ quality: 70 }).toFile(path.join(UPLOAD_DIR, thumb));
        mime = 'image/jpeg';
        fs.unlinkSync(f.path);
      } catch {
        // e.g. HEIC without codec support: keep original
        thumb = null;
        file = `${base}${path.extname(f.originalname || '') || '.img'}`;
        fs.renameSync(f.path, path.join(UPLOAD_DIR, file));
      }
    } else {
      file = `${base}${path.extname(f.originalname || '').toLowerCase() || '.mp4'}`;
      fs.renameSync(f.path, path.join(UPLOAD_DIR, file));
    }
  } catch (e) {
    console.error(e);
    return fail(res, 500, 'Could not save that file');
  }
  const day = today();
  const week = S.weekStartOf(day);
  const hadGymToday = !!db.prepare("SELECT 1 FROM checkins WHERE user_id=? AND day=? AND kind='gym' AND status='ok'").get(u.id, day);
  const id = db.prepare('INSERT INTO checkins(group_id,user_id,week,day,kind,goal_id,file,thumb,mime,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(u.group_id, u.id, week, day, kind, goalId, file, thumb, mime, clean(req.body.note, 280), now()).lastInsertRowid;
  broadcast(u.group_id, 'feed');
  const others = members(u.group_id, week).filter((m) => m.id !== u.id).map((m) => m.id);
  if (kind === 'gym') {
    const { stats, rules } = weekStats(u.group_id, week);
    const mine = stats.find((s) => s.id === u.id);
    push.sendToUsers(others, {
      title: `${u.name} hit the gym 💪`,
      body: `${mine.gymDays}/${rules.daysRequired} this week${hadGymToday ? ' (extra post today)' : ''}${req.body.note ? ` — "${clean(req.body.note, 80)}"` : ''}`,
      url: `/#feed-${id}`, image: thumb ? `/media/${thumb}` : undefined,
    }).catch(() => {});
  } else {
    push.sendToUsers(others, { title: `${u.name} posted proof`, body: clean(req.body.note, 100) || 'New bonus-goal proof', url: `/#feed-${id}` }).catch(() => {});
  }
  res.json({ ok: true, id });
});

function ownCheckin(req, res) {
  const c = db.prepare('SELECT * FROM checkins WHERE id=? AND group_id=?').get(req.params.id, req.user.group_id);
  if (!c) fail(res, 404, 'Not found');
  return c;
}

app.post('/api/checkins/:id/flag', auth, (req, res) => {
  const c = ownCheckin(req, res); if (!c) return;
  if (c.user_id === req.user.id) return fail(res, 400, "You can't flag your own post");
  if (c.status !== 'ok') return fail(res, 400, 'Already flagged');
  db.prepare("UPDATE checkins SET status='flagged', flagged_by=?, flag_reason=? WHERE id=?").run(req.user.id, clean(req.body.reason, 200), c.id);
  broadcast(c.group_id, 'feed');
  push.sendToUsers([c.user_id], { title: `${req.user.name} flagged your post`, body: clean(req.body.reason, 100) || 'It won’t count until it’s cleared. Post another or ask them to clear it.', url: `/#feed-${c.id}` }).catch(() => {});
  res.json({ ok: true });
});

// clear: flagger or admin (not the owner) restores it. reject: admin makes it permanent.
app.post('/api/checkins/:id/resolve', auth, (req, res) => {
  const c = ownCheckin(req, res); if (!c) return;
  const canClear = req.user.id === c.flagged_by || (req.user.is_admin && req.user.id !== c.user_id);
  if (!canClear) return fail(res, 403, 'Only the person who flagged it (or an admin) can resolve this');
  const status = req.body.action === 'reject' ? 'rejected' : 'ok';
  db.prepare('UPDATE checkins SET status=? WHERE id=?').run(status, c.id);
  broadcast(c.group_id, 'feed');
  push.sendToUsers([c.user_id], { title: status === 'ok' ? 'Your post was cleared ✅' : 'Your post was rejected', body: 'Check the feed', url: `/#feed-${c.id}` }).catch(() => {});
  res.json({ ok: true });
});

app.delete('/api/checkins/:id', auth, (req, res) => {
  const c = ownCheckin(req, res); if (!c) return;
  if (c.user_id !== req.user.id) return fail(res, 403, 'Not yours');
  if (c.day !== today()) return fail(res, 400, 'You can only delete today’s posts');
  db.prepare('DELETE FROM checkins WHERE id=?').run(c.id);
  db.prepare('DELETE FROM reactions WHERE checkin_id=?').run(c.id);
  for (const f of [c.file, c.thumb]) if (f) fs.unlink(path.join(UPLOAD_DIR, f), () => {});
  broadcast(c.group_id, 'feed');
  res.json({ ok: true });
});

app.post('/api/checkins/:id/react', auth, (req, res) => {
  const c = ownCheckin(req, res); if (!c) return;
  const emoji = ['🔥', '💪', '👏', '😂', '🤨'].includes(req.body.emoji) ? req.body.emoji : null;
  if (!emoji) return fail(res, 400, 'Bad emoji');
  const exists = db.prepare('SELECT 1 FROM reactions WHERE checkin_id=? AND user_id=? AND emoji=?').get(c.id, req.user.id, emoji);
  if (exists) db.prepare('DELETE FROM reactions WHERE checkin_id=? AND user_id=? AND emoji=?').run(c.id, req.user.id, emoji);
  else db.prepare('INSERT INTO reactions VALUES(?,?,?)').run(c.id, req.user.id, emoji);
  broadcast(c.group_id, 'feed');
  res.json({ ok: true });
});

app.get('/media/:file', auth, (req, res) => {
  const name = path.basename(req.params.file);
  const c = db.prepare('SELECT group_id, mime FROM checkins WHERE file=? OR thumb=?').get(name, name);
  if (!c || c.group_id !== req.user.group_id) return res.sendStatus(404);
  res.set('Cache-Control', 'private, max-age=604800');
  res.sendFile(path.join(UPLOAD_DIR, name));
});

// ---------- goals & counters ----------
app.post('/api/counters/:goalId', auth, (req, res) => {
  const u = req.user;
  const g = db.prepare('SELECT * FROM goals WHERE id=? AND group_id=?').get(req.params.goalId, u.group_id);
  if (!g || (g.user_id !== u.id && g.user_id !== 0)) return fail(res, 404, 'Goal not found');
  if (g.week !== currentWeek()) return fail(res, 400, 'That week is over');
  const delta = Math.max(-1, Math.min(1, Number(req.body.delta) || 0));
  db.prepare('INSERT INTO counters(user_id,goal_id,count) VALUES(?,?,MAX(0,?)) ON CONFLICT(user_id,goal_id) DO UPDATE SET count=MAX(0,count+?)').run(u.id, g.id, delta, delta);
  broadcast(u.group_id, 'counters');
  res.json({ ok: true });
});

function goalInput(body) {
  const title = clean(body.title, 60);
  const target = Math.max(1, Math.min(10000, parseInt(body.target, 10) || 1));
  const points = Math.max(0, Math.min(1000, parseInt(body.points, 10) || 0));
  return title ? { title, target, points } : null;
}

app.post('/api/goals', auth, (req, res) => {
  const u = req.user;
  const g = goalInput(req.body);
  if (!g) return fail(res, 400, 'Goal needs a name');
  const isChallenge = !!req.body.challenge;
  if (isChallenge && !u.is_admin) return fail(res, 403, 'Only admins set the group challenge');
  const owner = isChallenge ? 0 : u.id;
  const week = editWeekFor(u);
  goalsFor(u.group_id, owner, week); // materialize copy first
  db.prepare('INSERT INTO goals(group_id,user_id,week,title,target,points,sort) VALUES(?,?,?,?,?,?,?)').run(u.group_id, owner, week, g.title, g.target, g.points, now());
  broadcast(u.group_id, 'goals');
  res.json({ ok: true });
});

function editableGoal(req, res) {
  const u = req.user;
  const g = db.prepare('SELECT * FROM goals WHERE id=? AND group_id=?').get(req.params.id, u.group_id);
  if (!g || !(g.user_id === u.id || (g.user_id === 0 && u.is_admin))) { fail(res, 404, 'Goal not found'); return null; }
  if (g.week !== editWeekFor(u)) { fail(res, 400, 'Goals are locked for this week'); return null; }
  return g;
}

app.put('/api/goals/:id', auth, (req, res) => {
  const g = editableGoal(req, res); if (!g) return;
  const v = goalInput(req.body);
  if (!v) return fail(res, 400, 'Goal needs a name');
  db.prepare('UPDATE goals SET title=?, target=?, points=? WHERE id=?').run(v.title, v.target, v.points, g.id);
  broadcast(g.group_id, 'goals');
  res.json({ ok: true });
});

app.delete('/api/goals/:id', auth, (req, res) => {
  const g = editableGoal(req, res); if (!g) return;
  db.prepare('DELETE FROM goals WHERE id=?').run(g.id);
  db.prepare('DELETE FROM counters WHERE goal_id=?').run(g.id);
  broadcast(g.group_id, 'goals');
  res.json({ ok: true });
});

// ---------- profile & group admin ----------
app.put('/api/me', auth, (req, res) => {
  const u = req.user;
  const cashapp = clean(req.body.cashapp, 40).replace(/^\$/, '');
  const venmo = clean(req.body.venmo, 40).replace(/^@/, '');
  const zelle = clean(req.body.zelle, 60);
  db.prepare('UPDATE users SET cashapp=?, venmo=?, zelle=? WHERE id=?').run(cashapp, venmo, zelle, u.id);
  if (req.body.newPin) {
    if (!validPin(req.body.newPin)) return fail(res, 400, 'PIN must be 4 digits');
    if (!bcrypt.compareSync(String(req.body.oldPin || ''), u.pin_hash)) return fail(res, 401, 'Current PIN is wrong');
    db.prepare('UPDATE users SET pin_hash=? WHERE id=?').run(bcrypt.hashSync(String(req.body.newPin), 10), u.id);
  }
  broadcast(u.group_id, 'members');
  res.json({ ok: true });
});

app.put('/api/group', auth, admin, (req, res) => {
  const b = req.body;
  const gid = req.user.group_id;
  const cur = groupRules(gid);
  const dollars = (v, d) => (v === undefined ? d : Math.max(0, Math.min(100000, Math.round(Number(v) * 100) || 0)));
  const rules = {
    daysRequired: Math.max(1, Math.min(7, parseInt(b.daysRequired ?? cur.daysRequired, 10))),
    stakeType: ['money', 'favors', 'both'].includes(b.stakeType) ? b.stakeType : cur.stakeType,
    penaltyCents: dollars(b.penalty, cur.penaltyCents),
    potCents: dollars(b.pot, cur.potCents),
    potQualifiedOnly: b.potQualifiedOnly === undefined ? cur.potQualifiedOnly : !!b.potQualifiedOnly,
  };
  db.prepare('UPDATE groups SET rules_json=?, name=? WHERE id=?').run(JSON.stringify(rules), clean(b.name, 60) || db.prepare('SELECT name FROM groups WHERE id=?').get(gid).name, gid);
  // A brand-new group can tune this week's stakes; otherwise changes start next week.
  const g = db.prepare('SELECT created_week FROM groups WHERE id=?').get(gid);
  const wk = currentWeek();
  const appliesNow = g.created_week === wk;
  if (appliesNow) db.prepare('UPDATE weeks SET rules_json=? WHERE group_id=? AND week=?').run(JSON.stringify(rules), gid, wk);
  broadcast(gid, 'group');
  const members = db.prepare('SELECT id FROM users WHERE group_id=? AND active=1 AND id<>?').all(gid, req.user.id).map((m) => m.id);
  push.sendToUsers(members, { title: 'Stakes updated', body: appliesNow ? 'New rules apply this week.' : 'New rules start next Monday.', url: '/#settings' }).catch(() => {});
  res.json({ ok: true, appliesNow });
});

app.post('/api/group/invite', auth, admin, (req, res) => {
  db.prepare('UPDATE groups SET invite_code=? WHERE id=?').run(newCode(), req.user.group_id);
  res.json({ ok: true });
});

app.delete('/api/members/:id', auth, admin, (req, res) => {
  if (Number(req.params.id) === req.user.id) return fail(res, 400, "You can't remove yourself");
  db.prepare('UPDATE users SET active=0 WHERE id=? AND group_id=?').run(req.params.id, req.user.group_id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.params.id);
  broadcast(req.user.group_id, 'members');
  res.json({ ok: true });
});

// ---------- ledger ----------
function ledgerRow(req, res) {
  const l = db.prepare('SELECT * FROM ledger WHERE id=? AND group_id=?').get(req.params.id, req.user.group_id);
  if (!l) { fail(res, 404, 'Not found'); return null; }
  return l;
}

app.post('/api/ledger/:id/done', auth, (req, res) => {
  const l = ledgerRow(req, res); if (!l) return;
  if (l.to_id !== req.user.id) return fail(res, 403, 'Only the person being paid can mark this');
  db.prepare("UPDATE ledger SET status='done', done_at=? WHERE id=?").run(now(), l.id);
  broadcast(l.group_id, 'ledger');
  res.json({ ok: true });
});

app.post('/api/ledger/:id/nudge', auth, (req, res) => {
  const l = ledgerRow(req, res); if (!l) return;
  if (l.to_id !== req.user.id) return fail(res, 403, 'Not yours to nudge');
  if (l.last_nudge && now() - l.last_nudge < 6 * 3600e3) return fail(res, 429, 'You already nudged in the last 6 hours');
  db.prepare('UPDATE ledger SET last_nudge=? WHERE id=?').run(now(), l.id);
  const body = l.kind === 'money' ? `You owe ${req.user.name} $${(l.amount_cents / 100).toFixed(2)}` : `You owe ${req.user.name} a favor${l.favor_text ? `: ${l.favor_text}` : ''}`;
  push.sendToUsers([l.from_id], { title: 'Pay up 👀', body, url: '/#ledger' }).catch(() => {});
  res.json({ ok: true });
});

// Winner picks which favor they're collecting: a specific card, a random card, or a custom one.
app.post('/api/ledger/:id/favor', auth, (req, res) => {
  const l = ledgerRow(req, res); if (!l) return;
  if (l.kind !== 'favor' || l.to_id !== req.user.id) return fail(res, 403, 'Not yours');
  if (l.favor_text) return fail(res, 400, 'Already chosen');
  let f = null; let text;
  if (req.body.custom) {
    text = clean(req.body.custom, 200);
  } else if (req.body.favorId) {
    f = db.prepare('SELECT * FROM favors WHERE id=? AND group_id=? AND used=0').get(req.body.favorId, l.group_id);
    if (!f) return fail(res, 404, 'Card not available');
  } else {
    f = db.prepare('SELECT * FROM favors WHERE group_id=? AND used=0 ORDER BY RANDOM() LIMIT 1').get(l.group_id);
    if (!f) return fail(res, 400, 'The deck is empty. Add some cards first.');
  }
  if (f) { text = f.text; db.prepare('UPDATE favors SET used=1 WHERE id=?').run(f.id); }
  if (!text) return fail(res, 400, 'Write the favor');
  db.prepare('UPDATE ledger SET favor_id=?, favor_text=? WHERE id=?').run(f?.id || null, text, l.id);
  broadcast(l.group_id, 'ledger');
  push.sendToUsers([l.from_id], { title: `${req.user.name} is collecting 😏`, body: text, url: '/#ledger' }).catch(() => {});
  res.json({ ok: true, text });
});

// ---------- favor deck ----------
app.post('/api/favors', auth, (req, res) => {
  const text = clean(req.body.text, 200);
  if (!text) return fail(res, 400, 'Write something');
  db.prepare('INSERT INTO favors(group_id,author_id,text,secret,created_at) VALUES(?,?,?,?,?)').run(req.user.group_id, req.user.id, text, req.body.secret ? 1 : 0, now());
  broadcast(req.user.group_id, 'favors');
  res.json({ ok: true });
});
app.delete('/api/favors/:id', auth, (req, res) => {
  db.prepare('DELETE FROM favors WHERE id=? AND author_id=? AND used=0').run(req.params.id, req.user.id);
  broadcast(req.user.group_id, 'favors');
  res.json({ ok: true });
});

// ---------- push ----------
app.post('/api/push/subscribe', auth, (req, res) => {
  if (!req.body?.endpoint) return fail(res, 400, 'Bad subscription');
  push.subscribe(req.user.id, req.body);
  res.json({ ok: true });
});
app.post('/api/push/unsubscribe', auth, (req, res) => { push.unsubscribe(req.body?.endpoint || ''); res.json({ ok: true }); });
app.post('/api/push/test', auth, async (req, res) => {
  await push.sendToUsers([req.user.id], { title: 'Notifications are on ✅', body: 'You’ll hear about gym posts, flags and results.', url: '/' });
  res.json({ ok: true });
});

// ---------- static ----------
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: 0 }));
app.get(/^\/(join\/.*)?$/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'File is over 100MB' : err.message);
  console.error(err);
  fail(res, 500, 'Something went wrong');
  void next;
});

// ---------- schedules ----------
function remind(title, bodyFn) {
  const wk = currentWeek();
  const d = today();
  for (const g of db.prepare('SELECT id FROM groups').all()) {
    const { stats, rules } = weekStats(g.id, wk);
    for (const s of stats) {
      if (s.gymDays >= rules.daysRequired || s.days.includes(d)) continue;
      const daysLeft = 7 - S.dayOfWeek(d); // includes today
      const need = rules.daysRequired - s.gymDays;
      push.sendToUsers([s.id], { title, body: bodyFn(s, need, daysLeft, rules), url: '/' }).catch(() => {});
    }
  }
}

if (require.main === module) {
  runSettlements();
  cron.schedule('*/5 * * * *', runSettlements, { timezone: TZ });
  cron.schedule('0 19 * * *', () => remind('No gym yet today', (s, need, left) => (need > left
    ? `You're at ${s.gymDays} — the math says you can't make it this week. Go anyway.`
    : `You're at ${s.gymDays}. Need ${need} more with ${left} day${left > 1 ? 's' : ''} left (counting today).`)), { timezone: TZ });
  cron.schedule('0 12 * * 0', () => remind('Last day of the week ⏳', (s, need, left, r) => `You're at ${s.gymDays}/${r.daysRequired}. ${need <= left ? 'Today counts — go.' : 'Week is lost, but log it anyway.'}`), { timezone: TZ });
  app.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`Lock In running on :${PORT}`));
}

module.exports = { app, runSettlements, settleWeekIfDue };
