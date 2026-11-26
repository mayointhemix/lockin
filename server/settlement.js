// Pure functions: dates, gym days, points, penalties, pot, debt netting.
// All money is in integer cents.

const DEFAULT_TZ = 'America/New_York';

function etDay(ts = Date.now(), tz = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ts));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function etHour(ts = Date.now(), tz = DEFAULT_TZ) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(ts)));
}

function parseDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function addDays(day, n) {
  return new Date(parseDay(day) + n * 86400000).toISOString().slice(0, 10);
}

function dayOfWeek(day) { // 0 = Monday ... 6 = Sunday
  return (new Date(parseDay(day)).getUTCDay() + 6) % 7;
}

function weekStartOf(day) { return addDays(day, -dayOfWeek(day)); }

function weekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

// checkins: [{user_id, day, kind, status}] -> Map(user_id -> Set(day))
function gymDaysByUser(checkins) {
  const map = new Map();
  for (const c of checkins) {
    if (c.kind !== 'gym' || c.status !== 'ok') continue;
    if (!map.has(c.user_id)) map.set(c.user_id, new Set());
    map.get(c.user_id).add(c.day);
  }
  return map;
}

// goals: [{id, target, points}], counts: {goal_id: n}
function pointsFor(goals, counts) {
  let pts = 0;
  for (const g of goals) if ((counts[g.id] || 0) >= g.target) pts += g.points;
  return pts;
}

// Split `total` cents into `n` near-equal integer parts.
function split(total, n) {
  const base = Math.floor(total / n);
  let rem = total - base * n;
  return Array.from({ length: n }, () => base + (rem-- > 0 ? 1 : 0));
}

/**
 * members: [{id, gymDays: number, points: number}]
 * rules: {daysRequired, penaltyCents, potCents, potQualifiedOnly}
 * returns {results: [{id, gymDays, points, qualified, potWinner}], debts: [{from,to,amount,reason}]}
 */
function settleWeek(members, rules) {
  const { daysRequired, penaltyCents, potCents, potQualifiedOnly } = rules;
  const results = members.map((m) => ({ ...m, qualified: m.gymDays >= daysRequired, potWinner: false }));
  const hitters = results.filter((r) => r.qualified);
  const missers = results.filter((r) => !r.qualified);
  const debts = [];

  // Penalty: each misser pays the penalty, split among hitters. Nobody hits -> nobody pays.
  if (hitters.length && penaltyCents > 0) {
    for (const m of missers) {
      split(penaltyCents, hitters.length).forEach((amt, i) => {
        if (amt > 0) debts.push({ from: m.id, to: hitters[i].id, amount: amt, reason: 'penalty' });
      });
    }
  }

  // Pot: only qualifiers can win; highest points wins; ties split; non-winners pay.
  if (hitters.length && potCents > 0) {
    const top = Math.max(...hitters.map((h) => h.points));
    const winners = hitters.filter((h) => h.points === top);
    winners.forEach((w) => { w.potWinner = true; });
    const payers = results.filter((r) => !r.potWinner && (!potQualifiedOnly || r.qualified));
    if (payers.length) {
      for (const p of payers) {
        split(potCents, winners.length).forEach((amt, i) => {
          if (amt > 0) debts.push({ from: p.id, to: winners[i].id, amount: amt, reason: 'pot' });
        });
      }
    } else {
      winners.forEach((w) => { w.potWinner = false; }); // nobody to collect from = no pot
    }
  }

  return { results, debts };
}

// Collapse debts into the fewest transfers.
function netDebts(debts) {
  const bal = new Map();
  for (const d of debts) {
    bal.set(d.from, (bal.get(d.from) || 0) - d.amount);
    bal.set(d.to, (bal.get(d.to) || 0) + d.amount);
  }
  const owers = [...bal].filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v);
  const owed = [...bal].filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0; let j = 0;
  while (i < owers.length && j < owed.length) {
    const amt = Math.min(owers[i].v, owed[j].v);
    out.push({ from: owers[i].id, to: owed[j].id, amount: amt });
    owers[i].v -= amt; owed[j].v -= amt;
    if (!owers[i].v) i++;
    if (!owed[j].v) j++;
  }
  return out;
}

module.exports = {
  DEFAULT_TZ, etDay, etHour, addDays, dayOfWeek, weekStartOf, weekDays,
  gymDaysByUser, pointsFor, split, settleWeek, netDebts,
};
