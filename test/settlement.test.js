const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../server/settlement');

const rules = { daysRequired: 5, penaltyCents: 15000, potCents: 2500, potQualifiedOnly: false };
const total = (debts, from, to) => debts.filter((d) => d.from === from && d.to === to).reduce((a, d) => a + d.amount, 0);

test('2 people, both hit: higher points takes $25 pot, no penalty', () => {
  const { debts, results } = s.settleWeek([{ id: 1, gymDays: 5, points: 40 }, { id: 2, gymDays: 6, points: 30 }], rules);
  assert.deepEqual(debts, [{ from: 2, to: 1, amount: 2500, reason: 'pot' }]);
  assert.equal(results[0].potWinner, true);
});

test('2 people, one misses: pays $150 penalty + $25 pot = $175', () => {
  const { debts } = s.settleWeek([{ id: 1, gymDays: 5, points: 0 }, { id: 2, gymDays: 4, points: 99 }], rules);
  assert.equal(total(debts, 2, 1), 17500);
  assert.deepEqual(s.netDebts(debts), [{ from: 2, to: 1, amount: 17500 }]);
});

test('2 people, one misses, pot limited to qualifiers: only $150', () => {
  const { debts } = s.settleWeek([{ id: 1, gymDays: 5, points: 0 }, { id: 2, gymDays: 4, points: 9 }], { ...rules, potQualifiedOnly: true });
  assert.equal(total(debts, 2, 1), 15000);
});

test('2 people, both miss: nobody owes', () => {
  const { debts } = s.settleWeek([{ id: 1, gymDays: 4, points: 50 }, { id: 2, gymDays: 0, points: 0 }], rules);
  assert.deepEqual(debts, []);
});

test('3 people, one misses: penalty split $75/$75', () => {
  const { debts } = s.settleWeek([
    { id: 1, gymDays: 5, points: 10 }, { id: 2, gymDays: 5, points: 20 }, { id: 3, gymDays: 2, points: 0 },
  ], rules);
  const pen = debts.filter((d) => d.reason === 'penalty');
  assert.deepEqual(pen.map((d) => [d.from, d.to, d.amount]), [[3, 1, 7500], [3, 2, 7500]]);
  // pot: 1 and 3 each pay 2 $25
  const pot = debts.filter((d) => d.reason === 'pot');
  assert.deepEqual(pot.map((d) => [d.from, d.to, d.amount]), [[1, 2, 2500], [3, 2, 2500]]);
  // net: 3 pays $175 total; 1 nets +$50; 2 nets +$125 -> two transfers from 3
  assert.deepEqual(s.netDebts(debts), [{ from: 3, to: 2, amount: 12500 }, { from: 3, to: 1, amount: 5000 }]);
});

test('points tie splits the pot', () => {
  const { debts } = s.settleWeek([
    { id: 1, gymDays: 5, points: 30 }, { id: 2, gymDays: 5, points: 30 }, { id: 3, gymDays: 5, points: 10 },
  ], rules);
  assert.deepEqual(debts.map((d) => [d.from, d.to, d.amount]), [[3, 1, 1250], [3, 2, 1250]]);
});

test('everyone hits and ties: no pot at all', () => {
  const { debts, results } = s.settleWeek([{ id: 1, gymDays: 5, points: 0 }, { id: 2, gymDays: 7, points: 0 }], rules);
  assert.deepEqual(debts, []);
  assert.ok(results.every((r) => !r.potWinner));
});

test('odd-cent penalty split stays exact', () => {
  assert.deepEqual(s.split(15000, 3), [5000, 5000, 5000]);
  assert.deepEqual(s.split(20000, 3), [6667, 6667, 6666]);
});

test('same day uploaded twice counts once; flagged posts do not count', () => {
  const m = s.gymDaysByUser([
    { user_id: 1, day: '2026-11-23', kind: 'gym', status: 'ok' },
    { user_id: 1, day: '2026-11-23', kind: 'gym', status: 'ok' },
    { user_id: 1, day: '2026-11-24', kind: 'gym', status: 'flagged' },
    { user_id: 1, day: '2026-11-25', kind: 'proof', status: 'ok' },
  ]);
  assert.equal(m.get(1).size, 1);
});

test('ET day + week boundaries across DST end (Nov 1 2026)', () => {
  // 04:30Z Nov 2 = 11:30pm EST Sunday Nov 1
  assert.equal(s.etDay(Date.parse('2026-11-02T04:30:00Z')), '2026-11-01');
  assert.equal(s.weekStartOf('2026-11-01'), '2026-10-26');
  // 05:30Z Nov 2 = 12:30am EST Monday Nov 2 -> new week
  assert.equal(s.etDay(Date.parse('2026-11-02T05:30:00Z')), '2026-11-02');
  assert.equal(s.weekStartOf('2026-11-02'), '2026-11-02');
  // DST start: Mar 8 2026, 03:30Z Mar 9 = 11:30pm EDT Sunday
  assert.equal(s.etDay(Date.parse('2026-03-09T03:30:00Z')), '2026-03-08');
  assert.equal(s.weekDays('2026-11-23').at(-1), '2026-11-29');
});

test('points: goal counts only when target reached', () => {
  const goals = [{ id: 1, target: 21, points: 30 }, { id: 2, target: 1, points: 10 }];
  assert.equal(s.pointsFor(goals, { 1: 20, 2: 1 }), 10);
  assert.equal(s.pointsFor(goals, { 1: 21, 2: 3 }), 40);
});
