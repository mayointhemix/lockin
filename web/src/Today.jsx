import React, { useState } from 'react';
import NumberFlow from '@number-flow/react';
import { Camera, Dumbbell, Target, Trophy, Wallet, Crown } from 'lucide-react';
import { fmtDay, greeting, isOverdue, lsGet, lsSet, money, stakesLine } from './lib.js';
import { useApp, Stat, DayStrip, GoalRow, NewGoalForm, Money } from './ui.jsx';

function ResultCard() {
  const { S, nameOf } = useApp();
  const [, bump] = useState(0);
  const w = S.history[0];
  const key = `li_result_${S.group.id}`;
  if (!w || lsGet(key) === w.week) return null;
  const dismiss = () => { lsSet(key, w.week); bump((n) => n + 1); };
  const winners = w.results.filter((x) => x.potWinner).map((x) => nameOf(x.id));
  const mine = S.ledger.filter((l) => l.week === w.week && l.status === 'open' && (l.from_id === S.me.id || l.to_id === S.me.id));
  const what = (l) => (l.kind === 'money' ? <b className="mono">{money(l.amount_cents)}</b> : 'a favor');
  return (
    <section className="card result">
      <div><p className="eyebrow">Week of {fmtDay(w.week)} · final</p>
        <h2>{winners.length ? <><Crown size={17} className="crown" aria-hidden="true" /> {winners.join(' & ')} won the pot</> : 'No pot winner this week'}</h2></div>
      <div>{w.results.map((x) => <p className="line" key={x.id}><b>{nameOf(x.id)}</b><span className="mono">{x.gymDays} gym · {x.points} pts · {x.qualified ? 'hit' : 'missed'}</span></p>)}</div>
      {mine.length ? mine.map((l) => <p key={l.id}>{l.from_id === S.me.id ? <>You owe {nameOf(l.to_id)} {what(l)}</> : <>{nameOf(l.from_id)} owes you {what(l)}</>}</p>) : <p>You’re all square.</p>}
      <div className="btns">{mine.length ? <a className="btn primary" href="#ledger" onClick={dismiss}>Settle up</a> : null}<button className="btn" onClick={dismiss}>Got it</button></div>
    </section>
  );
}

// Things about money that need you: debts you haven't paid, and payments waiting for your confirmation.
function MoneyPrompts() {
  const { S, nameOf } = useApp();
  const open = S.ledger.filter((l) => l.status === 'open');
  const iOwe = open.filter((l) => l.from_id === S.me.id && !l.paid_at);
  const toConfirm = open.filter((l) => l.to_id === S.me.id && l.paid_at);
  if (!iOwe.length && !toConfirm.length) return null;
  const what = (l) => (l.kind === 'money' ? money(l.amount_cents) : 'a favor');
  const late = iOwe.some((l) => isOverdue(l, S.today));
  return (
    <section className={`card prompt ${late ? 'late' : ''}`}>
      {iOwe.length ? (
        <div className="card-head">
          <div><p className="eyebrow">{late ? 'Overdue' : 'Settle up'}</p><h2>You owe {iOwe.map((l) => `${nameOf(l.to_id)} ${what(l)}`).join(', ')}</h2></div>
          <a className="btn primary" href="#ledger">Pay now</a>
        </div>
      ) : null}
      {toConfirm.length ? (
        <div className="card-head">
          <div><p className="eyebrow">Confirm</p><h2>{toConfirm.map((l) => `${nameOf(l.from_id)} says they ${l.kind === 'money' ? `paid you ${what(l)}` : 'did the favor'}`).join(', ')}</h2></div>
          <a className="btn" href="#ledger">Check it</a>
        </div>
      ) : null}
    </section>
  );
}

export default function Today({ personId }) {
  const { S, pickGym, pickProof } = useApp();
  const r = S.rules;
  const isMe = personId === S.me.id;
  const m = S.stats.find((s) => s.id === personId) || { name: S.me.name, gymDays: 0, days: [], goals: [], challenge: [], points: 0 };
  const loggedToday = m.days.includes(S.today);
  const left = 7 - S.weekDays.indexOf(S.today);
  const need = Math.max(0, r.daysRequired - m.gymDays);
  const status = need === 0 ? ['good', 'Locked in'] : need > left ? ['bad', 'Can’t make it this week'] : need === left ? ['warn', 'No days to spare'] : ['', `${need} to go · ${left} days left`];
  const leader = [...S.stats].sort((a, b) => b.points - a.points)[0];
  const moneyOn = r.stakeType !== 'favors';
  const debts = S.ledger.filter((l) => l.status === 'open' && l.from_id === personId);
  const oweCents = debts.filter((l) => l.kind === 'money').reduce((s, l) => s + l.amount_cents, 0);
  const favors = debts.filter((l) => l.kind === 'favor').length;

  return (
    <>
      <p className="eyebrow date">{S.group.name} · week of {fmtDay(S.week)}</p>
      <h1>{isMe ? `${greeting()}, ` : 'This week, '}<span className="accent">{m.name}</span></h1>
      <p className="muted lede">{stakesLine(r)}</p>

      <div className="stats">
        <Stat label="Gym this week" icon={Dumbbell} sub={`Goal ${r.daysRequired} days`}>
          <NumberFlow value={m.gymDays} /><span className="of"> / {r.daysRequired}</span>
          <div className="meter"><i style={{ width: `${Math.min(100, (m.gymDays / r.daysRequired) * 100)}%` }} /></div>
        </Stat>
        <Stat label="Bonus points" icon={Target} sub={!leader || leader.points === 0 ? 'Nobody has scored yet' : leader.id === personId ? 'Top score so far' : `${leader.name} leads with ${leader.points}`}><NumberFlow value={m.points} /></Stat>
        {moneyOn
          ? <Stat label="Weekly pot" icon={Trophy} sub={`Fall short and pay ${money(r.penaltyCents)}`}><Money cents={r.potCents} /></Stat>
          : <Stat label="Stakes" icon={Trophy} sub="Loser owes a favor">Favors</Stat>}
        <Stat label={isMe ? 'You owe' : 'Owes'} icon={Wallet} sub={favors ? `plus ${favors} favor${favors > 1 ? 's' : ''}` : debts.length ? 'Open from past weeks' : 'All square'}><Money cents={oweCents} /></Stat>
      </div>

      {isMe ? <MoneyPrompts /> : null}
      {isMe ? <ResultCard /> : null}

      <section className="card hero-card">
        <div className="card-head">
          <div><p className="eyebrow">Today</p><h2>{loggedToday ? 'Today counts' : isMe ? 'You haven’t logged today' : `${m.name} hasn’t logged today`}</h2></div>
          <span className={`pill ${status[0]}`}>{status[1]}</span>
        </div>
        <DayStrip days={m.days} />
        {isMe ? (
          <div className="cta-row">
            <button className="btn primary" onClick={pickGym}><Camera size={17} aria-hidden="true" />{loggedToday ? 'Post another' : 'Log today’s gym'}</button>
            <span className="muted small">{loggedToday ? 'Extra posts are welcome but count once.' : 'Post a photo or video at the gym. Only today counts.'}</span>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="card-head">
          <div><p className="eyebrow">Bonus goals</p><h2>{isMe ? 'Your points this week' : `${m.name}’s points`}</h2></div>
          <span className="mono big-pts"><NumberFlow value={m.points} /> pts</span>
        </div>
        <p className="muted small">{moneyOn ? `Hit ${r.daysRequired} gym days to be eligible. Most points wins the ${money(r.potCents)} pot.` : 'Hit your gym days to be eligible. Most points wins.'}</p>
        {m.goals.length
          ? <div className="goals">{m.goals.map((g) => <GoalRow key={g.id} g={g} mine={isMe} onProof={pickProof} />)}</div>
          : <p className="muted">{isMe ? 'No bonus goals yet. Add your own below. Each one earns points when you hit its target.' : 'No bonus goals this week.'}</p>}
        {isMe ? (
          <details open={!m.goals.length}>
            <summary>Add a bonus goal</summary>
            <NewGoalForm isChallenge={false} />
            <p className="muted small">{S.edit.isNext ? 'This week’s goals are locked, so a new goal starts next Monday.' : 'You can add or change this week’s goals until Tuesday 12am ET.'} Edit or remove goals in <a href="#settings">Settings</a>.</p>
          </details>
        ) : null}
      </section>

      {m.challenge.length ? (
        <section className="card">
          <div><p className="eyebrow">Group challenge</p><h2>Same for everyone</h2></div>
          <div className="goals">{m.challenge.map((g) => <GoalRow key={g.id} g={g} mine={isMe} onProof={pickProof} />)}</div>
        </section>
      ) : null}
    </>
  );
}
