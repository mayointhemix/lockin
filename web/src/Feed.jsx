import React from 'react';
import NumberFlow from '@number-flow/react';
import { Flag, Trash2, X } from 'lucide-react';
import { del, fmtTime, media, post } from './lib.js';
import { useApp, CommentForm } from './ui.jsx';

const EMOJI = ['🔥', '💪', '👏', '😂', '🤨'];

function PostCard({ c }) {
  const { S, act, ask, nameOf } = useApp();
  const isVid = c.mime.startsWith('video/');
  const goal = c.kind === 'proof' ? S.stats.flatMap((s) => [...s.goals, ...s.challenge]).find((g) => g.id === c.goal_id) : null;
  const counts = {};
  for (const r of c.reactions) counts[r.emoji] = (counts[r.emoji] || []).concat(r.user_id);
  const cmts = S.comments.filter((x) => x.checkin_id === c.id);
  const canResolve = c.status === 'flagged' && (c.flagged_by === S.me.id || (S.me.is_admin && c.user_id !== S.me.id));

  const flag = async () => {
    const reason = await ask({ title: 'Why doesn’t this count?', description: `${nameOf(c.user_id)} will see this.`, input: true, placeholder: 'e.g. That’s your living room', confirmLabel: 'Flag it', danger: true });
    if (reason !== null) act(() => post(`/api/checkins/${c.id}/flag`, { reason }), 'Flagged');
  };
  const remove = async () => {
    if (await ask({ title: 'Delete this post?', description: 'It stops counting for today.', confirmLabel: 'Delete', danger: true })) act(() => del(`/api/checkins/${c.id}`), 'Deleted');
  };
  const resolve = (action) => act(() => post(`/api/checkins/${c.id}/resolve`, { action }), 'Done');

  return (
    <article className="card post" id={`feed-${c.id}`}>
      <div className="post-head"><b>{nameOf(c.user_id)}</b><span className="pill">{c.kind === 'gym' ? 'Gym' : (goal?.title || 'Bonus proof')}</span><span className="muted small when">{fmtTime(c.created_at)}</span></div>
      <div className="media">
        {isVid
          ? <video src={media(c.file)} controls playsInline preload="metadata" />
          : <a href={media(c.file)} target="_blank" rel="noreferrer"><img src={media(c.thumb || c.file)} loading="lazy" alt="Check-in" /></a>}
      </div>
      {c.note ? <p>{c.note}</p> : null}
      {c.status === 'flagged' ? (
        <div className="flagbox">Flagged by {nameOf(c.flagged_by)}{c.flag_reason ? `: “${c.flag_reason}”` : ''}. Doesn’t count until cleared.
          {canResolve ? <div className="btns"><button className="btn small" onClick={() => resolve('clear')}>Clear it</button>{S.me.is_admin ? <button className="btn small danger" onClick={() => resolve('reject')}>Reject</button> : null}</div> : null}
        </div>
      ) : null}
      {c.status === 'rejected' ? <div className="flagbox">Rejected. Doesn’t count.</div> : null}
      <div className="reacts">
        {EMOJI.map((e) => (
          <button key={e} className={(counts[e] || []).includes(S.me.id) ? 'on' : ''} onClick={() => act(() => post(`/api/checkins/${c.id}/react`, { emoji: e }))} aria-label={`React ${e}`}>
            {e}{counts[e] ? <NumberFlow value={counts[e].length} /> : null}
          </button>
        ))}
        {c.user_id !== S.me.id && c.status === 'ok' && c.kind === 'gym' ? <button className="quiet" onClick={flag}><Flag size={13} aria-hidden="true" />Doesn’t count</button> : null}
        {c.user_id === S.me.id && c.day === S.today ? <button className="quiet" onClick={remove}><Trash2 size={13} aria-hidden="true" />Delete</button> : null}
      </div>
      {cmts.length ? (
        <div className="cmts">
          {cmts.map((x) => (
            <div className="cmt" key={x.id}><b>{nameOf(x.user_id)}</b><span>{x.text}</span><time>{fmtTime(x.created_at)}</time>
              {x.user_id === S.me.id ? <button className="quiet-x" onClick={() => act(() => del(`/api/comments/${x.id}`))} aria-label="Delete comment"><X size={13} /></button> : null}</div>
          ))}
        </div>
      ) : null}
      <CommentForm checkinId={c.id} />
    </article>
  );
}

export default function Feed() {
  const { S } = useApp();
  return (
    <>
      <p className="eyebrow date">Feed</p>
      <h1>The <span className="accent">proof</span></h1>
      {S.feed.length ? <div className="feed">{S.feed.map((c) => <PostCard key={c.id} c={c} />)}</div> : <section className="card"><p className="muted">Nothing yet. Be first.</p></section>}
    </>
  );
}
