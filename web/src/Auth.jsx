import React, { useState } from 'react';
import { toast } from 'sonner';
import { post, lsSet, formData, isIOS, isStandalone } from './lib.js';
import { HelpVideo } from './ui.jsx';

export function CreateGroup({ onDone }) {
  const submit = async (ev) => {
    ev.preventDefault();
    try { const r = await post('/api/groups', formData(ev.currentTarget)); lsSet('li_code', r.code); onDone(); } catch (e) { toast.error(e.message); }
  };
  return (
    <>
      <p className="eyebrow">Set up</p>
      <h1>Start your <span className="accent">group</span></h1>
      <p className="muted">You’ll be the admin. After this you’ll get an invite link to send your people.</p>
      <form className="card stack" onSubmit={submit}>
        <label>Group name<input name="groupName" placeholder="e.g. The Lock In" required maxLength={60} /></label>
        <label>Your name<input name="name" required maxLength={30} autoComplete="name" /></label>
        <label>Pick a 4-digit PIN<input name="pin" className="pin" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="new-password" /></label>
        <label>Stakes
          <select name="stakeType" defaultValue="money"><option value="money">Money</option><option value="favors">Favors (no money)</option><option value="both">Money + favors</option></select>
        </label>
        <button className="btn primary full">Create group</button>
      </form>
    </>
  );
}

export function AuthScreen({ code, fromLink, info, error, stayIn, onDone }) {
  const [mode, setMode] = useState(fromLink ? 'join' : 'login');
  if (error) return <><h1>Lock In</h1><p className="muted">{error}. Ask for a fresh invite link.</p></>;
  const join = mode === 'join' || !info.names.length;
  const submit = async (ev) => {
    ev.preventDefault();
    try { await post(join ? '/api/join' : '/api/login', { ...formData(ev.currentTarget), code }); onDone(); } catch (e) { toast.error(e.message); }
  };
  return (
    <>
      <p className="eyebrow">{info.groupName}</p>
      <h1>{join ? <>Join the <span className="accent">group</span></> : <>Welcome <span className="accent">back</span></>}</h1>
      <p className="muted">{stayIn ? `You’re also in ${stayIn}. Joining here adds this group next to it, and you can switch between them any time.` : 'Show up. Post proof. Don’t pay.'}</p>
      <form className="card stack" onSubmit={submit} key={join ? 'join' : 'login'}>
        {join
          ? <label>Your name<input name="name" required maxLength={30} autoComplete="name" /></label>
          : <label>Who are you?<select name="name" required>{info.names.map((n) => <option key={n}>{n}</option>)}</select></label>}
        <label>{join ? 'Pick a 4-digit PIN' : 'PIN'}
          <input name="pin" className="pin" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete={join ? 'new-password' : 'current-password'} />
        </label>
        <button className="btn primary full">{join ? 'Join' : 'Log in'}</button>
      </form>
      {info.names.length ? (
        <>
          <button className="btn ghost" onClick={() => setMode(join ? 'login' : 'join')}>{join ? 'Already in the group? Log in' : 'New here? Join'}</button>
          <p className="muted small">Members: {info.names.join(', ')}</p>
        </>
      ) : null}
      {stayIn ? <button className="btn ghost" onClick={onDone}>Not now. Back to {stayIn}</button> : null}
      {info.helpVideo && isIOS() && !isStandalone() ? (
        <section className="card">
          <div><p className="eyebrow">On iPhone</p><h2>Add Lock In to your Home Screen</h2></div>
          <p className="muted small">Do this after you join so you get notified when your group posts. This short video shows how.</p>
          <HelpVideo v={info.helpVideo} />
        </section>
      ) : null}
    </>
  );
}
