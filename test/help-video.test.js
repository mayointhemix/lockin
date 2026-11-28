// The setup video: only an admin can set or remove it, and anyone can watch it (it shows before login).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lockin-test-'));
const { app } = require('../server/index');

let server; let base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const headers = { cookie };
    const isForm = body instanceof FormData;
    if (body && !isForm) headers['content-type'] = 'application/json';
    const r = await fetch(base + url, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const set = r.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const type = r.headers.get('content-type') || '';
    return { status: r.status, type, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
}
const video = (bytes, name = 'howto.mov', type = 'video/quicktime') => { const f = new FormData(); f.append('file', new Blob([bytes], { type }), name); return f; };

test('setup video: admin only to change, public to watch', async () => {
  const admin = client(); const member = client(); const stranger = client();
  const { data: g } = await admin('POST', '/api/groups', { groupName: 'T', name: 'Admin', pin: '1234' });
  await member('POST', '/api/join', { name: 'Member', pin: '1234', code: g.code });

  assert.equal((await stranger('GET', '/api/bootstrap')).data.helpVideo, 0);
  assert.equal((await stranger('GET', '/help-video')).status, 404);

  assert.equal((await stranger('POST', '/api/help-video', video('x'))).status, 401);
  assert.equal((await member('POST', '/api/help-video', video('x'))).status, 403);
  assert.equal((await admin('POST', '/api/help-video', video('x', 'pic.png', 'image/png'))).status, 400);

  const up = await admin('POST', '/api/help-video', video('first-video'));
  assert.equal(up.status, 200);
  assert.ok(up.data.helpVideo > 0);

  const watch = await stranger('GET', '/help-video');
  assert.equal(watch.status, 200);
  assert.match(watch.type, /^video\/quicktime/);
  assert.equal(watch.data.toString(), 'first-video');
  assert.ok((await stranger('GET', `/api/invite/${g.code}`)).data.helpVideo > 0);
  assert.ok((await member('GET', '/api/state')).data.helpVideo > 0);

  // Replacing removes the old file and serves the new one.
  await new Promise((r) => setTimeout(r, 5));
  const up2 = await admin('POST', '/api/help-video', video('second-video', 'new.mp4', 'video/mp4'));
  assert.ok(up2.data.helpVideo > up.data.helpVideo);
  assert.equal((await stranger('GET', '/help-video')).data.toString(), 'second-video');
  await new Promise((r) => setTimeout(r, 50));
  const left = fs.readdirSync(path.join(process.env.DATA_DIR, 'uploads')).filter((f) => f.startsWith('help-'));
  assert.equal(left.length, 1);

  assert.equal((await member('DELETE', '/api/help-video')).status, 403);
  assert.equal((await admin('DELETE', '/api/help-video')).status, 200);
  assert.equal((await stranger('GET', '/help-video')).status, 404);
  assert.equal((await stranger('GET', '/api/bootstrap')).data.helpVideo, 0);
});

test('other uploads still need a login', async () => {
  const stranger = client();
  assert.equal((await stranger('GET', '/media/anything.jpg')).status, 401);
});
