const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'lockin.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, invite_code TEXT UNIQUE NOT NULL,
  rules_json TEXT NOT NULL, created_at INTEGER NOT NULL, created_week TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id),
  name TEXT NOT NULL, pin_hash TEXT NOT NULL, is_admin INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
  cashapp TEXT DEFAULT '', venmo TEXT DEFAULT '', zelle TEXT DEFAULT '',
  created_at INTEGER NOT NULL, created_week TEXT NOT NULL,
  UNIQUE (group_id, name COLLATE NOCASE)
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS weeks (
  group_id INTEGER NOT NULL, week TEXT NOT NULL, rules_json TEXT NOT NULL,
  settled_at INTEGER, results_json TEXT, PRIMARY KEY (group_id, week)
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL, user_id INTEGER NOT NULL, -- user_id 0 = group challenge
  week TEXT NOT NULL, title TEXT NOT NULL, target INTEGER NOT NULL, points INTEGER NOT NULL, sort INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS goals_wk ON goals(group_id, week);
CREATE TABLE IF NOT EXISTS counters (user_id INTEGER NOT NULL, goal_id INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, goal_id));
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL, user_id INTEGER NOT NULL, week TEXT NOT NULL, day TEXT NOT NULL,
  kind TEXT NOT NULL, goal_id INTEGER, file TEXT NOT NULL, thumb TEXT, mime TEXT NOT NULL, note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ok', flagged_by INTEGER, flag_reason TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS checkins_wk ON checkins(group_id, week);
CREATE TABLE IF NOT EXISTS reactions (checkin_id INTEGER NOT NULL, user_id INTEGER NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY (checkin_id, user_id, emoji));
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL, week TEXT NOT NULL, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL,
  kind TEXT NOT NULL, amount_cents INTEGER DEFAULT 0, reason TEXT, favor_id INTEGER, favor_text TEXT,
  status TEXT NOT NULL DEFAULT 'open', done_at INTEGER, last_nudge INTEGER
);
CREATE TABLE IF NOT EXISTS favors (
  id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL, author_id INTEGER NOT NULL, text TEXT NOT NULL,
  secret INTEGER DEFAULT 0, used INTEGER DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL, json TEXT NOT NULL);
`);

const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
const setSetting = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);

module.exports = { db, DATA_DIR, UPLOAD_DIR, getSetting, setSetting };
