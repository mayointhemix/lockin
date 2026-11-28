import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Toaster, toast } from 'sonner';
import { Drawer } from 'vaul';
import { Command } from 'cmdk';
import { Home, Trophy, Images, HandCoins, Settings as SettingsIcon, Search, Camera, Share2, Dumbbell, ChevronsUpDown, Check, Users } from 'lucide-react';
import { api, post, lsGet, lsSet, TABS, uploadCheckin, formData } from './lib.js';
import { Ctx } from './ui.jsx';
import { CreateGroup, AuthScreen } from './Auth.jsx';
import Today from './Today.jsx';
import Board from './Board.jsx';
import Feed from './Feed.jsx';
import Ledger from './Ledger.jsx';
import Settings from './Settings.jsx';

const NAV = [
  { group: 'This week', items: [{ id: 'today', label: 'Home', icon: Home }, { id: 'board', label: 'Board', icon: Trophy }, { id: 'feed', label: 'Feed', icon: Images }] },
  { group: 'Money', items: [{ id: 'ledger', label: 'Owed', icon: HandCoins }] },
  { group: 'Setup', items: [{ id: 'settings', label: 'Settings', icon: SettingsIcon }] },
];
const FLAT_NAV = NAV.flatMap((g) => g.items);

function parseHash() {
  const hsh = window.location.hash.slice(1) || 'today';
  const tab = TABS.includes(hsh.split('-')[0]) ? hsh.split('-')[0] : 'today';
  return { tab, anchor: hsh.includes('-') ? hsh : null };
}

// A bottom sheet that replaces the browser's prompt() and confirm().
function AskSheet({ cfg, onDone }) {
  const [text, setText] = useState('');
  useEffect(() => { setText(''); }, [cfg]);
  return (
    <Drawer.Root open={!!cfg} onOpenChange={(o) => { if (!o) onDone(null); }}>
      <Drawer.Portal>
        <Drawer.Overlay className="dw-overlay" />
        <Drawer.Content className="dw">
          {cfg ? (
            <form className="dw-inner" onSubmit={(e) => { e.preventDefault(); onDone(cfg.input ? text.trim() : true); }}>
              <div className="dw-handle" aria-hidden="true" />
              <Drawer.Title className="dw-title">{cfg.title}</Drawer.Title>
              <Drawer.Description className="muted small">{cfg.description || ' '}</Drawer.Description>
              {cfg.input ? <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={cfg.placeholder || ''} maxLength={cfg.maxLength || 280} required={!!cfg.required} aria-label={cfg.title} /> : null}
              {cfg.options ? (
                <div className="options">{cfg.options.map((o) => <button type="button" className="btn" key={o.value} onClick={() => onDone(o.value)}>{o.label}</button>)}</div>
              ) : (
                <div className="btns end">
                  <button type="button" className="btn" onClick={() => onDone(null)}>Cancel</button>
                  <button className={`btn ${cfg.danger ? 'danger' : 'primary'}`}>{cfg.confirmLabel || 'OK'}</button>
                </div>
              )}
            </form>
          ) : null}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export default function App() {
  const [phase, setPhase] = useState('loading'); // loading | error | create | auth | nogroup | app
  const [authInfo, setAuthInfo] = useState(null);
  const [S, setS] = useState(null);
  const [W, setW] = useState(null);
  const [viewWeek, setViewWeek] = useState(null);
  const [route, setRoute] = useState(parseHash);
  const [view, setView] = useState(null); // member id shown on Home; null = me
  const [cmdOpen, setCmdOpen] = useState(false);
  const [askCfg, setAskCfg] = useState(null);
  const [gym, setGym] = useState(null); // { file, preview }
  const [gymNote, setGymNote] = useState('');
  const [progress, setProgress] = useState(null);
  const [accounts, setAccounts] = useState([]); // this person's groups on this device
  const [groupsOpen, setGroupsOpen] = useState(false);

  const askResolve = useRef(null);
  const busy = useRef(false);
  const stateRef = useRef({ tab: route.tab, viewWeek, S: null });
  const gymInput = useRef(null);
  const proofInput = useRef(null);
  const proofGoal = useRef(null);
  stateRef.current = { tab: route.tab, viewWeek, S };

  const ask = useCallback((cfg) => new Promise((resolve) => { askResolve.current = resolve; setAskCfg(cfg); }), []);
  const askDone = (v) => { setAskCfg(null); askResolve.current?.(v); askResolve.current = null; };

  const loadWeek = useCallback(async (wk, state) => {
    const cur = (state || stateRef.current.S)?.week;
    try { setW(await api(`/api/week/${wk || cur}`)); } catch { setViewWeek(null); if (cur) setW(await api(`/api/week/${cur}`)); }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await api('/api/state');
      setS(s);
      if (stateRef.current.tab === 'board') await loadWeek(stateRef.current.viewWeek, s);
    } catch (e) { if (e.status === 401) window.location.reload(); }
  }, [loadWeek]);

  const act = useCallback(async (fn, okMsg) => {
    try { const r = await fn(); if (okMsg) toast.success(okMsg); await refresh(); return r ?? true; } catch (e) { toast.error(e.message); return null; }
  }, [refresh]);

  const markSeen = () => {
    post('/api/seen').catch(() => {});
    try { if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {}); } catch { /* unsupported */ }
  };

  const boot = useCallback(async () => {
    const m = window.location.pathname.match(/^\/join\/([\w-]+)/);
    try {
      const s = await api('/api/state');
      api('/api/accounts').then(setAccounts).catch(() => {});
      if (m && m[1] !== s.group.invite_code) {
        // Already logged in to one group, but this link is for a different one: offer to join or log in there.
        try {
          const info = await api(`/api/invite/${encodeURIComponent(m[1])}`);
          setAuthInfo({ code: m[1], fromLink: true, info, stayIn: s.group.name });
          setPhase('auth');
          return;
        } catch (err) { toast.error(`${err.message}. Staying in ${s.group.name}.`); }
      }
      lsSet('li_code', s.group.invite_code);
      setS(s); setW(null); setViewWeek(null); setView(null); setPhase('app');
      markSeen();
      if (m) window.history.replaceState(null, '', '/' + window.location.hash);
      setRoute(parseHash());
    } catch (e) {
      if (e.status !== 401) { setPhase('error'); return; }
      if (m) lsSet('li_code', m[1]);
      const code = m ? m[1] : lsGet('li_code');
      try {
        if (code) {
          try { setAuthInfo({ code, fromLink: !!m, info: await api(`/api/invite/${encodeURIComponent(code)}`) }); }
          catch (err) { setAuthInfo({ code, fromLink: !!m, error: err.message }); }
          setPhase('auth');
          return;
        }
        const { hasGroups } = await api('/api/bootstrap');
        setPhase(hasGroups ? 'nogroup' : 'create');
      } catch { setPhase('error'); }
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);

  // live updates + refresh when the app comes back to the front
  useEffect(() => {
    if (phase !== 'app') return undefined;
    const es = new EventSource('/api/stream');
    let t;
    es.onmessage = () => { clearTimeout(t); t = setTimeout(() => { if (!busy.current) refresh(); }, 250); };
    const onVis = () => { if (document.visibilityState === 'visible') { markSeen(); refresh(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { es.close(); clearTimeout(t); document.removeEventListener('visibilitychange', onVis); };
  }, [phase, refresh]);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen((o) => !o); } };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('keydown', onKey); };
  }, []);

  const tab = route.tab;
  useEffect(() => { if (phase === 'app' && tab === 'board') loadWeek(viewWeek); }, [phase, tab, viewWeek, loadWeek]);
  useEffect(() => {
    if (phase !== 'app' || !route.anchor) return undefined;
    const t = setTimeout(() => document.getElementById(route.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    return () => clearTimeout(t);
  }, [phase, route]);

  const go = useCallback((id) => { setCmdOpen(false); window.location.hash = `#${id}`; window.scrollTo(0, 0); }, []);

  // ---- uploads ----
  const pickGym = () => gymInput.current?.click();
  const onGymFile = (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    setGym({ file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
    setGymNote(''); setProgress(null);
  };
  const closeGym = () => { if (busy.current) return; if (gym?.preview) URL.revokeObjectURL(gym.preview); setGym(null); };
  const sendGym = async () => {
    busy.current = true; setProgress(0);
    try {
      await uploadCheckin({ file: gym.file, kind: 'gym', note: gymNote, onProgress: setProgress });
      busy.current = false;
      if (gym.preview) URL.revokeObjectURL(gym.preview);
      setGym(null); setProgress(null);
      toast.success('Logged. That counts.');
      setView(null); go('today'); refresh();
    } catch (err) { busy.current = false; setProgress(null); toast.error(err.message); }
  };
  const pickProof = (g) => { proofGoal.current = g; proofInput.current?.click(); };
  const onProofFile = async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    const g = proofGoal.current;
    if (!file || !g) return;
    const note = await ask({ title: 'Add a note?', description: `Proof for “${g.title}”. The note is optional.`, input: true, placeholder: 'Optional', confirmLabel: 'Post proof' });
    if (note === null) return;
    busy.current = true;
    const id = toast.loading('Uploading proof…');
    try { await uploadCheckin({ file, kind: 'proof', goalId: g.id, note }); toast.success('Proof posted', { id }); } catch (err) { toast.error(err.message, { id }); }
    busy.current = false; refresh();
  };

  const switchGroup = async (token) => {
    try { await post('/api/accounts/switch', { token }); } catch (e) { toast.error(e.message); return; }
    setGroupsOpen(false); setCmdOpen(false);
    window.location.hash = '#today'; window.scrollTo(0, 0);
    boot();
  };
  const createGroup = async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    try {
      await post('/api/groups', formData(f));
      f.reset(); setGroupsOpen(false);
      toast.success('Group created. Send the invite from Settings.');
      window.location.hash = '#settings'; window.scrollTo(0, 0);
      boot();
    } catch (e) { toast.error(e.message); }
  };

  const shareInvite = async () => {
    const invite = `${window.location.origin}/join/${S.group.invite_code}`;
    const data = { title: `Join ${S.group.name} on Lock In`, text: `Gym ${S.rules.daysRequired}x a week or you pay. Join here:`, url: invite };
    if (navigator.share) { try { await navigator.share(data); } catch { /* cancelled */ } return; }
    try { await navigator.clipboard.writeText(invite); toast.success('Invite link copied'); } catch { toast(invite); }
  };

  const ctx = useMemo(() => {
    if (!S) return null;
    return {
      S, W, viewWeek, setViewWeek, act, refresh, ask, go, boot, pickGym, pickProof, shareInvite, openGroups: () => setGroupsOpen(true),
      nameOf: (id) => S.users.find((u) => u.id === id)?.name || 'Former member',
      userOf: (id) => S.users.find((u) => u.id === id) || {},
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S, W, viewWeek, act, refresh, ask, go, boot]);

  const toaster = <Toaster theme="dark" position="top-center" toastOptions={{ className: 'li-toast' }} />;

  if (phase !== 'app' || !S) {
    return (
      <div className="solo">
        {phase === 'loading' ? <p className="loading">Loading…</p> : null}
        {phase === 'error' ? <><h1>Lock In</h1><p className="muted">Can’t reach the server. Check your connection and reload.</p><button className="btn" onClick={() => { setPhase('loading'); boot(); }}>Try again</button></> : null}
        {phase === 'nogroup' ? <><h1>Lock In</h1><p className="muted">Ask someone in your group to send you the invite link.</p></> : null}
        {phase === 'create' ? <CreateGroup onDone={() => { window.location.hash = '#settings'; boot(); }} /> : null}
        {phase === 'auth' ? <AuthScreen {...authInfo} onDone={() => { window.history.replaceState(null, '', '/'); boot(); }} /> : null}
        {toaster}
      </div>
    );
  }

  const meId = S.me.id;
  const shown = view && S.stats.some((s) => s.id === view) ? view : meId;
  const openDebts = S.ledger.filter((l) => l.status === 'open' && l.from_id === meId).length;
  const pillValue = tab === 'today' ? String(shown) : tab === 'board' ? 'group' : '';
  const onPill = (v) => { if (v === 'group') go('board'); else { setView(Number(v) === meId ? null : Number(v)); go('today'); } };
  const initials = S.me.name.slice(0, 2).toUpperCase();

  const screen = {
    today: <Today personId={shown} />, board: <Board />, feed: <Feed />, ledger: <Ledger />, settings: <Settings />,
  }[tab];

  return (
    <Ctx.Provider value={ctx}>
      <div className="shell">
        <aside className="side">
          <button className="brand group-btn" onClick={() => setGroupsOpen(true)} aria-label={`Group: ${S.group.name}. Switch or start a group`}>
            <span className="logo">L</span><div><b>{S.group.name}</b><span>{accounts.length > 1 ? `${accounts.length} groups · switch` : 'Lock In · groups'}</span></div><ChevronsUpDown size={15} aria-hidden="true" />
          </button>
          {NAV.map((g) => (
            <nav key={g.group} aria-label={g.group}>
              <p className="eyebrow">{g.group}</p>
              {g.items.map((it) => (
                <a key={it.id} href={`#${it.id}`} className={`nav ${tab === it.id ? 'on' : ''}`} aria-current={tab === it.id ? 'page' : undefined}>
                  <it.icon size={17} aria-hidden="true" />{it.label}
                  {it.id === 'ledger' && openDebts > 0 ? <span className="badge">{openDebts}</span> : null}
                </a>
              ))}
            </nav>
          ))}
          <div className="me"><span className="avatar">{initials}</span><div><b>{S.me.name}</b><span>{S.me.is_admin ? 'Admin' : 'Member'}</span></div></div>
        </aside>

        <div className="main">
          <header className="top">
            <button className="group-chip" onClick={() => setGroupsOpen(true)} aria-label={`Group: ${S.group.name}. Switch or start a group`}><Users size={14} aria-hidden="true" /><span>{S.group.name}</span><ChevronsUpDown size={13} aria-hidden="true" /></button>
            <Tabs.Root value={pillValue} onValueChange={onPill}>
              <Tabs.List className="pills" aria-label="Whose week to show">
                <Tabs.Trigger className="pill-tab" value={String(meId)}>My view</Tabs.Trigger>
                {S.stats.filter((s) => s.id !== meId).map((s) => <Tabs.Trigger className="pill-tab" key={s.id} value={String(s.id)}>{s.name}</Tabs.Trigger>)}
                <Tabs.Trigger className="pill-tab" value="group">Group</Tabs.Trigger>
              </Tabs.List>
            </Tabs.Root>
            <button className="search" onClick={() => setCmdOpen(true)} aria-label="Search or jump to"><Search size={15} aria-hidden="true" /><span>Search or jump to</span><kbd>⌘K</kbd></button>
          </header>
          <main className="content">{screen}</main>
        </div>

        <nav className="tabbar" aria-label="Sections">
          {FLAT_NAV.map((it) => (
            <a key={it.id} href={`#${it.id}`} className={tab === it.id ? 'on' : ''} aria-current={tab === it.id ? 'page' : undefined}>
              <it.icon size={19} aria-hidden="true" />{it.id === 'ledger' && openDebts ? `Owed (${openDebts})` : it.label}
            </a>
          ))}
        </nav>

        <input ref={gymInput} type="file" accept="image/*,video/*" hidden onChange={onGymFile} />
        <input ref={proofInput} type="file" accept="image/*,video/*" hidden onChange={onProofFile} />

        <Drawer.Root open={!!gym} onOpenChange={(o) => { if (!o) closeGym(); }}>
          <Drawer.Portal>
            <Drawer.Overlay className="dw-overlay" />
            <Drawer.Content className="dw">
              <div className="dw-inner">
                <div className="dw-handle" aria-hidden="true" />
                <Drawer.Title className="dw-title">Log today’s gym</Drawer.Title>
                <Drawer.Description className="muted small">Only today counts. No backdating.</Drawer.Description>
                {gym?.preview ? <img className="dw-media" src={gym.preview} alt="Your gym photo" /> : <div className="dw-file"><Camera size={18} aria-hidden="true" />{gym?.file.name}</div>}
                <label htmlFor="gym-note">Note (optional)</label>
                <input id="gym-note" value={gymNote} onChange={(e) => setGymNote(e.target.value)} placeholder="Leg day. Hated it." maxLength={280} />
                {progress !== null ? <div className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div> : null}
                <div className="btns end">
                  <button className="btn" onClick={pickGym} disabled={progress !== null}>Choose another</button>
                  <button className="btn primary" onClick={sendGym} disabled={progress !== null}>{progress !== null ? 'Posting…' : 'Post'}</button>
                </div>
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>

        <Command.Dialog open={cmdOpen} onOpenChange={setCmdOpen} label="Command menu">
          <Command.Input placeholder="Search or jump to…" />
          <Command.List>
            <Command.Empty>Nothing matches that.</Command.Empty>
            <Command.Group heading="Do">
              <Command.Item onSelect={() => { setCmdOpen(false); pickGym(); }}><Camera size={16} />Log today’s gym</Command.Item>
              <Command.Item onSelect={() => { setCmdOpen(false); shareInvite(); }}><Share2 size={16} />Share the invite link</Command.Item>
            </Command.Group>
            {accounts.length > 1 ? (
              <Command.Group heading="Switch group">
                {accounts.filter((a) => !a.current).map((a) => <Command.Item key={a.token} value={`group ${a.group}`} onSelect={() => switchGroup(a.token)}><Users size={16} />{a.group}</Command.Item>)}
              </Command.Group>
            ) : null}
            <Command.Group heading="Go to">
              {FLAT_NAV.map((it) => <Command.Item key={it.id} onSelect={() => go(it.id)}><it.icon size={16} />{it.label}</Command.Item>)}
            </Command.Group>
            <Command.Group heading="See someone’s week">
              {S.stats.map((s) => <Command.Item key={s.id} value={`week ${s.name} ${s.id}`} onSelect={() => { setView(s.id === meId ? null : s.id); go('today'); }}><Dumbbell size={16} />{s.id === meId ? `${s.name} (you)` : s.name}</Command.Item>)}
            </Command.Group>
          </Command.List>
        </Command.Dialog>

        <Drawer.Root open={groupsOpen} onOpenChange={setGroupsOpen}>
          <Drawer.Portal>
            <Drawer.Overlay className="dw-overlay" />
            <Drawer.Content className="dw">
              <div className="dw-inner">
                <div className="dw-handle" aria-hidden="true" />
                <Drawer.Title className="dw-title">Your groups</Drawer.Title>
                <Drawer.Description className="muted small">Each group is its own competition, with its own people, rules, feed and debts.</Drawer.Description>
                <div className="options">
                  {(accounts.length ? accounts : [{ token: 'current', group: S.group.name, current: true }]).map((a) => (
                    <button key={a.token} className={`btn group-row ${a.current ? 'on' : ''}`} onClick={() => (a.current ? setGroupsOpen(false) : switchGroup(a.token))} aria-current={a.current ? 'true' : undefined}>
                      <span>{a.group}{a.name && a.name !== S.me.name ? <span className="muted small"> · as {a.name}</span> : null}</span>{a.current ? <span className="pill acc"><Check size={12} aria-hidden="true" />You’re here</span> : <span className="muted small">Switch</span>}
                    </button>
                  ))}
                </div>
                {S.me.is_admin ? (
                  <details open={accounts.length < 2}>
                    <summary>Start another group</summary>
                    <form className="stack" onSubmit={createGroup}>
                      <p className="muted small">For example one for you and one friend, or you and your partner. You’ll be the admin and keep the same name and PIN. It gets its own invite link.</p>
                      <input name="groupName" placeholder="Group name, e.g. Me vs John" aria-label="Group name" required maxLength={60} />
                      <select name="stakeType" defaultValue="money" aria-label="Stakes"><option value="money">Money</option><option value="favors">Favors (no money)</option><option value="both">Money + favors</option></select>
                      <button className="btn primary full">Create group</button>
                    </form>
                  </details>
                ) : <p className="muted small">Only a group’s admin can start another group from here. To join a different group, open its invite link.</p>}
                <p className="muted small">Groups are remembered on this device. On a new phone or browser, open each group’s invite link once and log in.</p>
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>

        <AskSheet cfg={askCfg} onDone={askDone} />
        {toaster}
      </div>
    </Ctx.Provider>
  );
}
