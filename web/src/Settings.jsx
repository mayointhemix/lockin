import React from 'react';
import { toast } from 'sonner';
import { del, fmtDay, formData, post, put, stakesLine, urlB64 } from './lib.js';
import { useApp, NewGoalForm } from './ui.jsx';

function GoalEditor({ list, isChallenge }) {
  const { act, ask } = useApp();
  const remove = async (g) => { if (await ask({ title: 'Remove this goal?', description: g.title, confirmLabel: 'Remove', danger: true })) act(() => del(`/api/goals/${g.id}`), 'Removed'); };
  return (
    <>
      {list.map((g) => (
        <form className="stack edit" key={`${g.id}-${g.title}-${g.target}-${g.points}`} onSubmit={(ev) => { ev.preventDefault(); act(() => put(`/api/goals/${g.id}`, formData(ev.currentTarget)), 'Saved'); }}>
          <input name="title" defaultValue={g.title} maxLength={60} aria-label="Goal name" required />
          <div className="grid2">
            <label>Target<input name="target" type="number" min="1" defaultValue={g.target} inputMode="numeric" /></label>
            <label>Points<input name="points" type="number" min="0" defaultValue={g.points} inputMode="numeric" /></label>
          </div>
          <div className="card-head"><button type="button" className="btn ghost small danger" onClick={() => remove(g)}>Remove</button><button className="btn small">Save</button></div>
        </form>
      ))}
      <details open={!list.length}><summary>Add {isChallenge ? 'a challenge' : 'a goal'}</summary><NewGoalForm isChallenge={isChallenge} /></details>
    </>
  );
}

export default function Settings() {
  const { S, act, ask, shareInvite, openGroups } = useApp();
  const r = S.group.rules;
  const E = S.edit;
  const invite = `${window.location.origin}/join/${S.group.invite_code}`;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

  const enablePush = async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) { toast.error('This browser can’t do push notifications'); return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast.error('Notifications are blocked. Allow them in your phone settings.'); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(S.pushKey) });
      await post('/api/push/subscribe', sub.toJSON());
      toast.success('Notifications on');
    } catch (e) { toast.error(e.message || 'Couldn’t turn on notifications'); }
  };
  const savePay = (ev) => { ev.preventDefault(); act(() => put('/api/me', formData(ev.currentTarget)), 'Saved'); };
  const savePin = (ev) => {
    ev.preventDefault(); const f = ev.currentTarget;
    act(() => put('/api/me', { ...formData(f), cashapp: S.me.cashapp, venmo: S.me.venmo, zelle: S.me.zelle }), 'PIN updated').then((ok) => { if (ok) f.reset(); });
  };
  const regen = async () => { if (await ask({ title: 'Make a new invite link?', description: 'The old link will stop working.', confirmLabel: 'New link', danger: true })) act(() => post('/api/group/invite'), 'New link made'); };
  const saveRules = (ev) => {
    ev.preventDefault();
    const d = formData(ev.currentTarget); d.potQualifiedOnly = !!d.potQualifiedOnly;
    act(async () => { const r2 = await put('/api/group', d); toast.success(r2.appliesNow ? 'Saved. Applies this week.' : 'Saved. Starts next Monday.'); });
  };
  const kick = async (u) => { if (await ask({ title: `Remove ${u.name}?`, description: 'They lose access to this group.', confirmLabel: 'Remove', danger: true })) act(() => del(`/api/members/${u.id}`), 'Removed'); };
  const logout = async () => { await post('/api/logout'); window.location.reload(); };

  return (
    <>
      <p className="eyebrow date">{S.group.name}</p>
      <h1>Your <span className="accent">settings</span></h1>
      <section className="card">
        <div className="card-head"><div><p className="eyebrow">Groups</p><h2>You’re in {S.group.name}</h2></div><button className="btn" onClick={openGroups}>Switch or start a group</button></div>
      </section>

      <div className="two">
        <section className="card">
          <div><p className="eyebrow">Notifications</p><h2>Stay in the loop</h2></div>
          {isIOS && !standalone
            ? <p>On iPhone, first add this to your Home Screen: tap <b>Share</b> → <b>Add to Home Screen</b>, then open Lock In from there and come back here.</p>
            : (
              <>
                <p className="muted small">Get pinged when someone posts, when you’re flagged, daily 7pm reminders if you haven’t gone, and Monday results.</p>
                <div className="btns"><button className="btn primary" onClick={enablePush}>Turn on notifications</button><button className="btn" onClick={() => act(() => post('/api/push/test'), 'Sent. Check your notifications.')}>Send me a test</button></div>
                <details><summary>Not getting notifications?</summary>
                  <p className="small">On iPhone: open the <b>Settings</b> app → <b>Notifications</b> → <b>Lock In</b>. Turn on <b>Allow Notifications</b>, tick <b>Lock Screen</b>, <b>Notification Centre</b> and <b>Banners</b>, and switch on <b>Sounds</b> and <b>Badges</b>. Set Banner Style to <b>Persistent</b> if you want them to stay on screen.</p>
                  <p className="small">Also check that a <b>Focus</b> mode (Do Not Disturb, Sleep, Work) isn’t silencing Lock In, and that you opened the app from the Home Screen icon, not Safari. Then tap “Turn on notifications” again and send a test.</p>
                </details>
              </>
            )}
        </section>

        <section className="card">
          <div><p className="eyebrow">Invite</p><h2>Bring your people</h2></div>
          <p className="small mono wrap">{invite}</p>
          <div className="btns"><button className="btn primary" onClick={shareInvite}>Share invite</button>{S.me.is_admin ? <button className="btn" onClick={regen}>New link</button> : null}</div>
          <p className="muted small">Anyone with this link can join and log in with their own PIN.</p>
        </section>
      </div>

      <section className="card">
        <div><p className="eyebrow">My bonus goals</p><h2>What earns you points</h2></div>
        {E.isNext
          ? <div className="notice">This week’s goals are locked (they lock Tuesday 12am ET). Changes below start <b>next week ({fmtDay(E.week)})</b>.</div>
          : <p className="muted small">You can edit this week’s goals until Tuesday 12am ET. After that, edits apply to next week.</p>}
        <GoalEditor list={E.goals} isChallenge={false} />
      </section>

      <div className="two">
        <form className="card stack" onSubmit={savePay} key={`${S.me.cashapp}|${S.me.venmo}|${S.me.zelle}`}>
          <div><p className="eyebrow">How I get paid</p><h2>Payment handles</h2></div>
          <label>Cash App $cashtag<input name="cashapp" defaultValue={S.me.cashapp || ''} placeholder="yourtag" autoCapitalize="off" /></label>
          <label>Venmo username<input name="venmo" defaultValue={S.me.venmo || ''} placeholder="your-handle" autoCapitalize="off" /></label>
          <label>Zelle phone or email<input name="zelle" defaultValue={S.me.zelle || ''} autoCapitalize="off" /></label>
          <button className="btn primary full">Save</button>
          {S.me.cashapp || S.me.venmo ? (
            <p className="muted small">Test your link: {S.me.cashapp ? <a href={`https://cash.app/$${encodeURIComponent(S.me.cashapp)}/1`} target="_blank" rel="noopener noreferrer">Cash App $1</a> : null} {S.me.venmo ? <a href={`https://venmo.com/${encodeURIComponent(S.me.venmo)}?txn=pay&amount=1`} target="_blank" rel="noopener noreferrer">Venmo $1</a> : null} (don’t send it)</p>
          ) : null}
        </form>

        <form className="card stack" onSubmit={savePin}>
          <div><p className="eyebrow">Security</p><h2>Change PIN</h2></div>
          <div className="grid2">
            <label>Old PIN<input name="oldPin" className="pin" inputMode="numeric" maxLength={4} autoComplete="current-password" /></label>
            <label>New PIN<input name="newPin" className="pin" inputMode="numeric" maxLength={4} autoComplete="new-password" /></label>
          </div>
          <button className="btn full">Update PIN</button>
        </form>
      </div>

      {S.me.is_admin ? (
        <>
          <form className="card stack" onSubmit={saveRules} key={JSON.stringify([S.group.name, r])}>
            <div><p className="eyebrow">Rules</p><h2>How the group plays</h2></div>
            <label>Group name<input name="name" defaultValue={S.group.name} maxLength={60} /></label>
            <label>Gym days required per week<input name="daysRequired" type="number" min="1" max="7" defaultValue={r.daysRequired} /></label>
            <label>Stakes
              <select name="stakeType" defaultValue={r.stakeType}><option value="money">Money</option><option value="favors">Favors (no money)</option><option value="both">Money + favors</option></select>
            </label>
            <div className="grid2">
              <label>Miss penalty ($)<input name="penalty" type="number" min="0" step="1" defaultValue={r.penaltyCents / 100} /></label>
              <label>Weekly pot ($)<input name="pot" type="number" min="0" step="1" defaultValue={r.potCents / 100} /></label>
            </div>
            <label className="check"><input type="checkbox" name="potQualifiedOnly" defaultChecked={!!r.potQualifiedOnly} /> Only gym-qualified people pay into the pot</label>
            <button className="btn primary full">Save rules</button>
            <p className="muted small">Changes start next Monday (or right away during your group’s first week).</p>
          </form>

          <section className="card">
            <div><p className="eyebrow">Group challenge</p><h2>Same for everyone</h2></div>
            <p className="muted small">Each person earns the points when they hit it.</p>
            <GoalEditor list={E.challenge} isChallenge />
          </section>

          <div className="two">
            <section className="card">
              <p className="eyebrow">Members</p>
              <div>{S.users.map((u) => (
                <p className="line" key={u.id}><span>{u.name} {u.is_admin ? <span className="pill">admin</span> : null}</span>
                  {u.id !== S.me.id ? <button className="btn ghost small danger" onClick={() => kick(u)}>Remove</button> : null}</p>
              ))}</div>
            </section>
          </div>
        </>
      ) : (
        <section className="card"><p className="eyebrow">Rules</p><p>{r.daysRequired} gym days a week. {stakesLine(r)}{r.potQualifiedOnly ? ' (pot only between qualifiers)' : ''}.</p></section>
      )}

      <button className="btn ghost danger logout" onClick={logout}>Log out</button>
    </>
  );
}
