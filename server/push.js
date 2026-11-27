const webpush = require('web-push');
const { db, getSetting, setSetting } = require('./db');

let keys = getSetting('vapid');
if (!keys) {
  keys = JSON.stringify(webpush.generateVAPIDKeys());
  setSetting('vapid', keys);
}
keys = JSON.parse(keys);
webpush.setVapidDetails(process.env.PUSH_CONTACT || 'mailto:admin@localhost', keys.publicKey, keys.privateKey);

const publicKey = keys.publicKey;

function subscribe(userId, sub) {
  db.prepare('INSERT INTO push_subs(endpoint,user_id,json) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, json=excluded.json')
    .run(sub.endpoint, userId, JSON.stringify(sub));
}

function unsubscribe(endpoint) {
  db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(endpoint);
}

async function sendToUsers(userIds, payload) {
  if (!userIds.length) return;
  const marks = userIds.map(() => '?').join(',');
  db.prepare(`UPDATE users SET unseen = unseen + 1 WHERE id IN (${marks})`).run(...userIds);
  const unseen = Object.fromEntries(db.prepare(`SELECT id, unseen FROM users WHERE id IN (${marks})`).all(...userIds).map((u) => [u.id, u.unseen]));
  const subs = db.prepare(`SELECT * FROM push_subs WHERE user_id IN (${marks})`).all(...userIds);
  await Promise.all(subs.map(async (s) => {
    try {
      const body = JSON.stringify({ ...payload, badge: unseen[s.user_id] || 1 });
      await webpush.sendNotification(JSON.parse(s.json), body, { TTL: 60 * 60 * 12, urgency: 'high' });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) unsubscribe(s.endpoint);
      else console.error('push failed', e.statusCode || e.message);
    }
  }));
}

module.exports = { publicKey, subscribe, unsubscribe, sendToUsers };
