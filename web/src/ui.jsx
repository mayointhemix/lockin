// Small shared pieces used by every screen.
import React, { createContext, useContext } from 'react';
import NumberFlow from '@number-flow/react';
import { Check, Minus, Plus, Camera, Play, Flag } from 'lucide-react';
import { DOW, post, formData, media } from './lib.js';

export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// The admin's how-to video. `v` is the upload's version number (0 = none uploaded).
export function HelpVideo({ v }) {
  if (!v) return null;
  return <video className="help-video" src={`/help-video?v=${v}`} controls playsInline preload="metadata" aria-label="How to add Lock In to your Home Screen" />;
}

export function Money({ cents }) {
  return <NumberFlow value={cents / 100} format={{ style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }} />;
}

export function Stat({ label, icon: Icon, children, sub }) {
  return (
    <div className="stat">
      <div className="stat-top"><span className="eyebrow">{label}</span><Icon size={16} aria-hidden="true" /></div>
      <div className="stat-num">{children}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export function DayStrip({ days }) {
  const { S } = useApp();
  return (
    <div className="days">
      {S.weekDays.map((d, i) => (
        <div key={d} className={`day ${days.includes(d) ? 'hit' : ''} ${d === S.today ? 'today' : ''} ${d > S.today ? 'future' : ''}`}>
          <b>{days.includes(d) ? <Check size={15} aria-label="done" /> : null}</b>{DOW[i]}
        </div>
      ))}
    </div>
  );
}

export function GoalRow({ g, mine, onProof }) {
  const { act } = useApp();
  const done = g.count >= g.target;
  const inc = (delta) => act(() => post(`/api/counters/${g.id}`, { delta }));
  return (
    <div className="goal">
      <div className="goal-head">
        <span className="goal-title">{g.title}</span>
        {done ? <span className="pill good">+{g.points}</span> : <span className="muted small">{g.points} pts</span>}
        <span className="mono count"><NumberFlow value={g.count} /> / {g.target}</span>
      </div>
      <div className={`bar ${done ? 'done' : ''}`}><i style={{ width: `${Math.min(100, (g.count / g.target) * 100)}%` }} /></div>
      {mine ? (
        <div className="goal-actions">
          <button className="btn ghost small" onClick={() => onProof(g)}><Camera size={14} aria-hidden="true" />Add proof</button>
          <button className="round" onClick={() => inc(-1)} aria-label={`One less: ${g.title}`}><Minus size={15} /></button>
          <button className="round primary" onClick={() => inc(1)} aria-label={`One more: ${g.title}`}><Plus size={15} /></button>
        </div>
      ) : null}
    </div>
  );
}

export function NewGoalForm({ isChallenge }) {
  const { S, act } = useApp();
  const submit = (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const d = { ...formData(f), challenge: !!isChallenge };
    f.reset();
    act(() => post('/api/goals', d), S.edit.isNext ? 'Added. Starts next week.' : 'Added');
  };
  return (
    <form className="stack" onSubmit={submit}>
      <input name="title" placeholder={isChallenge ? 'e.g. 10k steps a day' : 'e.g. Film short-form reels'} aria-label="Goal name" maxLength={60} required />
      <div className="grid2">
        <label>Target this week<input name="target" type="number" min="1" defaultValue="1" inputMode="numeric" /></label>
        <label>Points when hit<input name="points" type="number" min="0" defaultValue="10" inputMode="numeric" /></label>
      </div>
      <button className="btn primary full">Add</button>
    </form>
  );
}

export function CommentForm({ checkinId }) {
  const { act } = useApp();
  const submit = (ev) => {
    ev.preventDefault();
    const inp = ev.currentTarget.elements.text;
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    act(() => post('/api/comments', { text, checkin_id: checkinId || null }));
  };
  return (
    <form className="cmtform" onSubmit={submit}>
      <input name="text" maxLength={500} placeholder={checkinId ? 'Add a comment…' : 'Message the group…'} aria-label={checkinId ? 'Comment' : 'Group message'} autoComplete="off" required />
      <button className="btn primary">Send</button>
    </form>
  );
}

// One square in the week grid or proof strip.
export function Cell({ posts, label, extra = '', onOpen }) {
  if (!posts.length) return <div className={`cell ${extra}`} aria-label={`${label}: nothing`} />;
  const c = posts.find((x) => x.status === 'ok') || posts[0];
  const vid = c.mime.startsWith('video/');
  const flagged = c.status !== 'ok';
  return (
    <button className={`cell ${flagged ? 'flag' : 'hit'} ${extra}`} onClick={() => onOpen(c.id)} aria-label={`${label}: open post`} style={c.thumb ? { backgroundImage: `url('${media(c.thumb)}')` } : undefined}>
      {vid ? <Play size={14} /> : (c.thumb ? null : <Check size={14} />)}
      {flagged ? <em><Flag size={10} /></em> : (posts.length > 1 ? <em>×{posts.length}</em> : null)}
    </button>
  );
}
