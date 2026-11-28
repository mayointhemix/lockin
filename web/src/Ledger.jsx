import React from 'react';
import { toast } from 'sonner';
import { Check, Send, Dices, Lock } from 'lucide-react';
import { del, fmtDay, money, post } from './lib.js';
import { useApp, Money } from './ui.jsx';

function PayButtons({ l }) {
  const { userOf } = useApp();
  const to = userOf(l.to_id);
  const amt = (l.amount_cents / 100).toFixed(2);
  const note = encodeURIComponent(`Lock In — week of ${fmtDay(l.week)}`);
  const copy = async () => { try { await navigator.clipboard.writeText(to.zelle); toast.success('Copied. Open your bank app.'); } catch { toast(to.zelle); } };
  if (!to.cashapp && !to.venmo && !to.zelle) return <p className="muted small">{to.name || 'They'} hasn’t added a payment handle yet.</p>;
  return (
    <div className="btns">
      {to.cashapp ? <a className="btn cashapp" href={`https://cash.app/$${encodeURIComponent(to.cashapp)}/${amt}`} target="_blank" rel="noopener noreferrer">Cash App</a> : null}
      {to.venmo ? <a className="btn venmo" href={`https://venmo.com/${encodeURIComponent(to.venmo)}?txn=pay&amount=${amt}&note=${note}`} target="_blank" rel="noopener noreferrer">Venmo</a> : null}
      {to.zelle ? <button className="btn" onClick={copy}>Zelle: copy {to.zelle}</button> : null}
    </div>
  );
}

function Desc({ l }) {
  if (l.kind === 'money') return <span className="money"><Money cents={l.amount_cents} /></span>;
  return <div><b>{l.reason === 'pot' ? 'Bonus favor' : 'Favor'}</b>{l.favor_text ? <div className="favcard">{l.favor_text}</div> : <p className="muted small">Not chosen yet</p>}</div>;
}

function FavorDeck() {
  const { S, act, nameOf } = useApp();
  const submit = (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget; const d = new FormData(f);
    act(() => post('/api/favors', { text: d.get('text'), secret: !!d.get('secret') }), 'Added to deck').then((ok) => { if (ok) f.reset(); });
  };
  return (
    <section className="card">
      <div><p className="eyebrow">Favor deck</p><h2>What the loser has to do</h2></div>
      <p className="muted small">Only people in this group can see this. Secret cards stay hidden until they’re drawn.</p>
      <form className="stack" onSubmit={submit}>
        <input name="text" maxLength={200} placeholder="e.g. 30-minute massage, winner’s choice" aria-label="New favor card" required />
        <div className="card-head"><label className="check"><input type="checkbox" name="secret" /> Secret card</label><button className="btn primary">Add</button></div>
      </form>
      <div>
        {S.favors.length ? S.favors.map((f) => (
          <p className="line" key={f.id}>
            <span>{f.text ? f.text : <><Lock size={13} aria-hidden="true" /> Secret card by {nameOf(f.author_id)}</>}{f.secret && f.text ? <span className="pill">secret</span> : null}</span>
            {f.author_id === S.me.id ? <button className="btn ghost small danger" onClick={() => act(() => del(`/api/favors/${f.id}`))}>Remove</button> : null}
          </p>
        )) : <p className="muted">Deck is empty.</p>}
      </div>
    </section>
  );
}

export default function Ledger() {
  const { S, act, ask, nameOf, userOf } = useApp();
  const meId = S.me.id;
  const mine = S.ledger.filter((l) => l.from_id === meId || l.to_id === meId);
  const open = mine.filter((l) => l.status === 'open');
  const iOwe = open.filter((l) => l.from_id === meId);
  const owedMe = open.filter((l) => l.to_id === meId);
  const others = S.ledger.filter((l) => l.status === 'open' && l.from_id !== meId && l.to_id !== meId);
  const done = mine.filter((l) => l.status === 'done').slice(0, 20);
  const favorsOn = S.rules.stakeType !== 'money' || S.group.rules.stakeType !== 'money' || S.ledger.some((l) => l.kind === 'favor');

  const settle = async (l) => {
    if (await ask({ title: 'Mark this as settled?', description: l.kind === 'money' ? `${money(l.amount_cents)} from ${nameOf(l.from_id)}.` : `Favor from ${nameOf(l.from_id)}.`, confirmLabel: l.kind === 'money' ? 'Received' : 'Redeemed' })) act(() => post(`/api/ledger/${l.id}/done`), 'Settled');
  };
  const custom = async (l) => {
    const t = await ask({ title: 'What do they owe you?', input: true, required: true, maxLength: 200, placeholder: 'e.g. Wash my car', confirmLabel: 'Set favor' });
    if (t) act(() => post(`/api/ledger/${l.id}/favor`, { custom: t }), 'Set');
  };
  const pick = async (l) => {
    const visible = S.favors.filter((f) => f.text);
    if (!visible.length) { toast('No visible cards. Draw random or write one.'); return; }
    const id = await ask({ title: 'Pick a card', description: `For ${nameOf(l.from_id)} to do.`, options: visible.map((f) => ({ label: f.text, value: f.id })) });
    if (id) act(() => post(`/api/ledger/${l.id}/favor`, { favorId: id }), 'Picked');
  };

  return (
    <>
      <p className="eyebrow date">Settle up</p>
      <h1>Who owes <span className="accent">who</span></h1>
      <p className="muted lede">Weeks settle Monday 12:05am ET. Debts are netted so there are as few payments as possible.</p>

      {!iOwe.length && !owedMe.length ? <section className="card"><p>All square.</p></section> : null}
      <div className="two">
        {iOwe.length ? (
          <section className="card">
            <p className="eyebrow">You owe</p>
            {iOwe.map((l) => (
              <div className="debt" key={l.id}>
                <p className="muted small">Week of {fmtDay(l.week)} · to {nameOf(l.to_id)}</p>
                <Desc l={l} />
                {l.kind === 'money' ? <><PayButtons l={l} /><p className="muted small">After you pay, they tap “Received.”</p></> : <p className="muted small">They mark it redeemed once you deliver.</p>}
              </div>
            ))}
          </section>
        ) : null}
        {owedMe.length ? (
          <section className="card">
            <p className="eyebrow">Owed to you</p>
            {owedMe.map((l) => {
              const from = userOf(l.from_id);
              return (
                <div className="debt" key={l.id}>
                  <p className="muted small">Week of {fmtDay(l.week)} · from {nameOf(l.from_id)}</p>
                  <Desc l={l} />
                  {l.kind === 'favor' && !l.favor_text ? (
                    <div className="btns">
                      <button className="btn primary" onClick={() => act(() => post(`/api/ledger/${l.id}/favor`), 'Drawn')}><Dices size={15} aria-hidden="true" />Draw random</button>
                      <button className="btn" onClick={() => pick(l)}>Pick a card</button>
                      <button className="btn" onClick={() => custom(l)}>Write one</button>
                    </div>
                  ) : null}
                  <div className="btns">
                    {l.kind === 'money' && from.venmo ? <a className="btn venmo" href={`https://venmo.com/${encodeURIComponent(from.venmo)}?txn=charge&amount=${(l.amount_cents / 100).toFixed(2)}&note=${encodeURIComponent(`Lock In — week of ${fmtDay(l.week)}`)}`} target="_blank" rel="noopener noreferrer">Request on Venmo</a> : null}
                    <button className="btn good" onClick={() => settle(l)}><Check size={15} aria-hidden="true" />{l.kind === 'money' ? 'Received' : 'Redeemed'}</button>
                    <button className="btn" onClick={() => act(() => post(`/api/ledger/${l.id}/nudge`), 'Nudged')}><Send size={14} aria-hidden="true" />Nudge</button>
                  </div>
                </div>
              );
            })}
          </section>
        ) : null}
      </div>

      {others.length ? (
        <section className="card">
          <p className="eyebrow">Rest of the group</p>
          <div>{others.map((l) => <p className="line" key={l.id}><b>{nameOf(l.from_id)} → {nameOf(l.to_id)}</b><span className="mono">{l.kind === 'money' ? money(l.amount_cents) : 'a favor'}</span></p>)}</div>
        </section>
      ) : null}

      {favorsOn ? <FavorDeck /> : null}

      {done.length ? (
        <section className="card">
          <p className="eyebrow">Settled</p>
          <div>{done.map((l) => <p className="line settled" key={l.id}><b>{nameOf(l.from_id)} → {nameOf(l.to_id)}</b><span className="mono">{fmtDay(l.week)} · {l.kind === 'money' ? money(l.amount_cents) : `favor${l.favor_text ? `: ${l.favor_text}` : ''}`}</span></p>)}</div>
        </section>
      ) : null}
    </>
  );
}
