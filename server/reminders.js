// Who to remind about open debts, and what to say. Pure functions so they can be tested.
const money = (c) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const dayNum = (d) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) / 864e5; };

// A week's debts are created the Monday after it. Days since then (0 on that Monday).
const daysOpen = (week, today) => dayNum(today) - (dayNum(week) + 7);
const OVERDUE_DAYS = 3;

const join = (parts) => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/**
 * rows: open ledger rows {from_id, to_id, kind, amount_cents, week, paid_at}
 * nameOf: (userId) => name
 * today: 'YYYY-MM-DD'
 * Returns at most one message per person per role: [{ userId, title, body }]
 */
function debtReminders(rows, nameOf, today) {
  const out = [];
  const owing = new Map();
  const confirming = new Map();
  for (const l of rows) {
    if (l.paid_at) {
      if (!confirming.has(l.to_id)) confirming.set(l.to_id, []);
      confirming.get(l.to_id).push(l);
    } else if (daysOpen(l.week, today) >= 1) { // Monday already had the results notification
      if (!owing.has(l.from_id)) owing.set(l.from_id, []);
      owing.get(l.from_id).push(l);
    }
  }
  for (const [userId, list] of owing) {
    const parts = list.map((l) => (l.kind === 'money' ? `${nameOf(l.to_id)} ${money(l.amount_cents)}` : `${nameOf(l.to_id)} a favor`));
    const overdue = list.some((l) => daysOpen(l.week, today) >= OVERDUE_DAYS);
    out.push({ userId, title: overdue ? 'Still unpaid ⏳' : 'Time to settle up', body: `You owe ${join(parts)}. Pay, then tap “I paid.”` });
  }
  for (const [userId, list] of confirming) {
    const parts = list.map((l) => (l.kind === 'money' ? `${nameOf(l.from_id)} says they paid you ${money(l.amount_cents)}` : `${nameOf(l.from_id)} says the favor is done`));
    out.push({ userId, title: 'Confirm a payment', body: `${join(parts)}. Tap Received if it’s true.` });
  }
  return out;
}

const hasPayDetails = (u) => !!(u && (u.cashapp || u.venmo || u.zelle));

/**
 * People who are owed money but have not said how to pay them.
 * rows: open ledger rows; usersById: { id: {name, cashapp, venmo, zelle} }
 * Returns [{ userId, title, body }], one per person.
 */
function payDetailReminders(rows, usersById) {
  const waiting = new Map();
  for (const l of rows) {
    if (l.kind !== 'money' || l.paid_at) continue;
    if (hasPayDetails(usersById[l.to_id])) continue;
    if (!waiting.has(l.to_id)) waiting.set(l.to_id, new Set());
    waiting.get(l.to_id).add(usersById[l.from_id]?.name || 'Someone');
  }
  const out = [];
  for (const [userId, names] of waiting) {
    const who = join([...names]);
    out.push({ userId, title: 'Add how you get paid', body: `${who} ${names.size > 1 ? 'owe' : 'owes'} you money but can’t pay you in the app yet. Add your Cash App, Venmo or Zelle in Settings.` });
  }
  return out;
}

module.exports = { debtReminders, payDetailReminders, hasPayDetails, daysOpen, OVERDUE_DAYS, money };
