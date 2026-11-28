import React, { useEffect, useRef, useState } from 'react';
import NumberFlow from '@number-flow/react';
import { Drawer } from 'vaul';
import { ChevronLeft, ChevronRight, Crown, X } from 'lucide-react';
import { DOW, addDays, fmtDay, fmtTime, media, money, stakesLine } from './lib.js';
import { useApp, GoalRow, CommentForm, Cell } from './ui.jsx';

function PostSheet({ post, onClose }) {
  const { S, nameOf } = useApp();
  return (
    <Drawer.Root open={!!post} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Drawer.Portal>
        <Drawer.Overlay className="dw-overlay" />
        <Drawer.Content className="dw">
          {post ? (
            <div className="dw-inner">
              <div className="dw-handle" aria-hidden="true" />
              <div className="card-head">
                <div><Drawer.Title className="dw-name">{nameOf(post.user_id)}</Drawer.Title>
                  <Drawer.Description className="muted small">{post.kind === 'gym' ? 'Gym' : 'Bonus proof'} · {fmtTime(post.created_at)}</Drawer.Description></div>
                <button className="round" onClick={onClose} aria-label="Close"><X size={15} /></button>
              </div>
              {post.mime.startsWith('video/')
                ? <video className="dw-media" src={media(post.file)} controls playsInline autoPlay />
                : <img className="dw-media" src={media(post.file)} alt="Post" />}
              {post.note ? <p>{post.note}</p> : null}
              {post.status === 'flagged' ? <div className="flagbox">Flagged. Doesn’t count until cleared.</div> : null}
              {post.status === 'rejected' ? <div className="flagbox">Rejected. Doesn’t count.</div> : null}
              {S.feed.some((x) => x.id === post.id) ? <a className="btn full" href={`#feed-${post.id}`} onClick={onClose}>Comment or react in Feed</a> : null}
            </div>
          ) : null}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export default function Board() {
  const { S, W, setViewWeek, nameOf } = useApp();
  const [openId, setOpenId] = useState(null);
  const chatRef = useRef(null);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [W]);
  if (!W) return <p className="loading">Loading…</p>;

  const r = W.rules;
  const current = W.week === S.week;
  const res = Object.fromEntries(W.projection.results.map((x) => [x.id, x]));
  const sorted = [...W.stats].sort((a, b) => (res[b.id]?.potWinner ? 1 : 0) - (res[a.id]?.potWinner ? 1 : 0) || (b.gymDays >= r.daysRequired) - (a.gymDays >= r.daysRequired) || b.points - a.points || b.gymDays - a.gymDays);
  const left = 7 - W.weekDays.indexOf(S.today);
  const moneyOn = r.stakeType !== 'favors';
  const lead = (x) => {
    if (!x?.potWinner) return null;
    const why = { points: 'on points', gymDays: 'tied on points · more gym days', first: `tied · got to ${r.daysRequired} first`, split: 'tied · splitting the pot' }[x.wonBy] || '';
    return <span className="pill warn"><Crown size={12} aria-hidden="true" />{current ? 'Leading' : 'Won'} {why}</span>;
  };
  const gymPosts = (uid, d) => W.checkins.filter((c) => c.user_id === uid && c.day === d && c.kind === 'gym');
  const go = (n) => { const next = addDays(W.week, n); setViewWeek(next === S.week ? null : next); window.scrollTo(0, 0); };

  const lines = [];
  for (const d of W.projection.money) lines.push(<p className="line" key={`m${d.from}-${d.to}`}><b>{nameOf(d.from)} → {nameOf(d.to)}</b><span className="mono">{money(d.amount)}</span></p>);
  const fav = {};
  for (const d of W.projection.favors) { const k = `${d.from}>${d.to}`; fav[k] = (fav[k] || 0) + 1; }
  for (const [k, n] of Object.entries(fav)) { const [a, b] = k.split('>').map(Number); lines.push(<p className="line" key={`f${k}`}><b>{nameOf(a)} owes {nameOf(b)}</b><span>{n} favor{n > 1 ? 's' : ''}</span></p>); }

  return (
    <>
      <p className="eyebrow date">{current ? 'This week’s competition' : 'Looking back'}</p>
      <h1>{current ? <>Who’s <span className="accent">locked in</span></> : <>Week of <span className="accent">{fmtDay(W.week)}</span></>}</h1>
      <div className="picker">
        <button className="round" onClick={() => go(-7)} disabled={W.week <= S.firstWeek} aria-label="Previous week"><ChevronLeft size={16} /></button>
        <b>{fmtDay(W.week)} – {fmtDay(W.weekDays[6])}</b>
        <button className="round" onClick={() => go(7)} disabled={current} aria-label="Next week"><ChevronRight size={16} /></button>
        <span className="muted small">{current ? `${left} day${left > 1 ? 's' : ''} left · resets Monday 12am ET` : (W.settled ? 'Final' : 'Settling shortly')} · {stakesLine(r)}</span>
      </div>

      <section className="card">
        <div className="card-head"><div><p className="eyebrow">Gym days</p><h2>The week at a glance</h2></div><span className="muted small">Tap a square</span></div>
        <div className="grid-scroll">
          <div className="wk-grid">
            <span />{W.weekDays.map((d, i) => <span key={d} className={`wk-h ${d === S.today ? 'now' : ''}`}>{DOW[i]}</span>)}
            {sorted.map((s) => (
              <React.Fragment key={s.id}>
                <div className="who">
                  <b>{s.name}{s.id === S.me.id ? <span className="pill acc">You</span> : null}</b>
                  <span className="mono muted"><NumberFlow value={s.gymDays} />/{r.daysRequired} · <NumberFlow value={s.points} /> pts</span>
                </div>
                {W.weekDays.map((d, i) => <Cell key={d} posts={gymPosts(s.id, d)} label={`${s.name} ${DOW[i]}`} extra={`${d > S.today ? 'future' : ''} ${d === S.today ? 'today' : ''}`} onOpen={setOpenId} />)}
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      <div className="people">
        {sorted.map((s) => {
          const q = s.gymDays >= r.daysRequired;
          const proofs = W.checkins.filter((c) => c.user_id === s.id && c.kind === 'proof');
          const goals = [...s.goals, ...s.challenge];
          return (
            <section className="card" key={s.id}>
              <div className="card-head">
                <h2>{s.name} {s.id === S.me.id ? <span className="pill acc">You</span> : null}</h2>
                <span className="mono big-pts"><NumberFlow value={s.points} /> pts</span>
              </div>
              <div>
                <p className="line plain"><span>Gym</span><span className="mono muted">{s.gymDays} / {r.daysRequired}</span></p>
                <div className={`bar ${q ? 'done' : ''}`}><i style={{ width: `${Math.min(100, (s.gymDays / r.daysRequired) * 100)}%` }} /></div>
              </div>
              <div className="btns">{q ? <span className="pill good">Eligible for pot</span> : <span className="pill bad">{current ? 'Not eligible yet' : 'Missed'}</span>}{lead(res[s.id])}</div>
              {goals.length ? <div className="goals">{goals.map((g) => <GoalRow key={g.id} g={g} mine={false} />)}</div> : <p className="muted small">No bonus goals this week.</p>}
              {proofs.length ? <div><p className="muted small">Proof posted</p><div className="proofs">{proofs.map((c) => <Cell key={c.id} posts={[c]} label={`${s.name} proof`} onOpen={setOpenId} />)}</div></div> : null}
            </section>
          );
        })}
      </div>

      <section className="card">
        <div><p className="eyebrow">{W.settled ? 'Settled' : 'Projection'}</p><h2>{W.settled ? 'Final result' : 'If the week ended now'}</h2></div>
        <div>
          {W.settled
            ? (W.ledger.length ? W.ledger.map((l) => (
              <p className="line" key={l.id}><b>{nameOf(l.from_id)} → {nameOf(l.to_id)}</b>
                <span>{l.kind === 'money' ? <span className="mono">{money(l.amount_cents)}</span> : `a favor${l.favor_text ? `: ${l.favor_text}` : ''}`} <span className="muted small">· {l.status === 'done' ? 'settled' : 'open'}</span></span></p>
            )) : <p className="muted">Nobody owed anything that week.</p>)
            : (lines.length ? lines : <p className="muted">Nobody owes anything yet.</p>)}
        </div>
        <p className="muted small">Miss {r.daysRequired} gym days → {moneyOn ? `${money(r.penaltyCents)} split among those who hit` : 'you owe each person who hit a favor'}. Most points among eligible → {moneyOn ? `${money(r.potCents)} from everyone else${r.potQualifiedOnly ? ' who was eligible' : ''}` : 'a favor from everyone else'}{r.stakeType === 'both' ? ' (plus favors)' : ''}. Tie-break: more gym days, then whoever got to {r.daysRequired} first.</p>
      </section>

      <section className="card" id="board-chat">
        <div><p className="eyebrow">Week chat</p><h2>Talk your talk</h2></div>
        <div className="chat" ref={chatRef}>
          {W.chat.length ? W.chat.map((x) => (
            <div key={x.id} className={`bubble ${x.user_id === S.me.id ? 'me' : ''}`}>{x.user_id !== S.me.id ? <small>{nameOf(x.user_id)}</small> : null}{x.text}</div>
          )) : <p className="muted">No messages yet.</p>}
        </div>
        {current ? <CommentForm checkinId={null} /> : null}
      </section>

      <PostSheet post={openId ? W.checkins.find((x) => x.id === openId) : null} onClose={() => setOpenId(null)} />
    </>
  );
}
