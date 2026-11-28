const test = require('node:test');
const assert = require('node:assert/strict');
const { debtReminders, daysOpen } = require('../server/reminders');

const names = { 1: 'Mayo', 2: 'Tasha', 3: 'Jay' };
const nameOf = (id) => names[id];
const row = (o) => ({ kind: 'money', amount_cents: 2500, week: '2026-11-16', paid_at: null, ...o });

test('daysOpen counts from the Monday after the week', () => {
  assert.equal(daysOpen('2026-11-16', '2026-11-23'), 0);
  assert.equal(daysOpen('2026-11-16', '2026-11-26'), 3);
});

test('no reminder on settlement Monday itself', () => {
  assert.deepEqual(debtReminders([row({ from_id: 1, to_id: 2 })], nameOf, '2026-11-23'), []);
});

test('one message per payer, listing everything they owe', () => {
  const out = debtReminders([row({ from_id: 1, to_id: 2 }), row({ from_id: 1, to_id: 3, kind: 'favor', amount_cents: 0 })], nameOf, '2026-11-24');
  assert.equal(out.length, 1);
  assert.equal(out[0].userId, 1);
  assert.equal(out[0].title, 'Time to settle up');
  assert.match(out[0].body, /You owe Tasha \$25 and Jay a favor\./);
});

test('title changes once a debt is 3 days old', () => {
  const out = debtReminders([row({ from_id: 1, to_id: 2 })], nameOf, '2026-11-26');
  assert.equal(out[0].title, 'Still unpaid ⏳');
});

test('after "I paid", the payer is left alone and the receiver is asked to confirm', () => {
  const out = debtReminders([row({ from_id: 3, to_id: 1, amount_cents: 1050, paid_at: 123 })], nameOf, '2026-11-26');
  assert.equal(out.length, 1);
  assert.equal(out[0].userId, 1);
  assert.equal(out[0].title, 'Confirm a payment');
  assert.match(out[0].body, /Jay says they paid you \$10\.50\./);
});
