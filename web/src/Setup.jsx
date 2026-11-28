// "Finish setup" card on Home: walks each person through adding Lock In to their
// Home Screen and turning on notifications, and keeps coming back until it's done.
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bell, Share, SquarePlus, Smartphone, Download } from 'lucide-react';
import { canInstall, enablePush, isIOS, isStandalone, lsGet, lsSet, promptInstall, pushIsOn, pushSupported } from './lib.js';
import { useApp, HelpVideo } from './ui.jsx';

const SNOOZE_KEY = 'li_setup_snooze';
const SNOOZE_DAYS = 2;

export default function SetupCard() {
  const { S, refresh } = useApp();
  const [on, setOn] = useState(null); // null = still checking
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);

  useEffect(() => {
    let live = true;
    pushIsOn().then((v) => { if (live) setOn(v); });
    const again = () => bump((n) => n + 1);
    window.addEventListener('li-install-ready', again);
    return () => { live = false; window.removeEventListener('li-install-ready', again); };
  }, []);

  if (on === null || on) return null;
  const ios = isIOS();
  const standalone = isStandalone();
  const needHomeScreen = ios && !standalone; // iPhone only allows notifications from the Home Screen app
  if (!needHomeScreen && !pushSupported()) return null; // nothing this browser can do
  if (Number(lsGet(SNOOZE_KEY) || 0) > Date.now()) return null;

  const snooze = () => { lsSet(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 864e5)); bump((n) => n + 1); };
  const turnOn = async () => {
    setBusy(true);
    try { await enablePush(S.pushKey); setOn(true); toast.success('Notifications are on'); refresh(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const install = async () => { if (await promptInstall()) toast.success('Installed. Open Lock In from your Home Screen.'); bump((n) => n + 1); };
  const blocked = pushSupported() && Notification.permission === 'denied';

  return (
    <section className="card setup">
      <div className="card-head">
        <div><p className="eyebrow">Finish setup</p><h2>{needHomeScreen ? 'Add Lock In to your Home Screen' : 'Turn on notifications'}</h2></div>
        <Bell size={20} aria-hidden="true" />
      </div>
      <p className="muted small">So you know when someone posts, comments, flags you, or when results and payments are due. Without this you’ll only find out when you open the app.</p>

      {needHomeScreen ? (
        <>
          {S.helpVideo ? <><p className="small"><b>Watch how:</b></p><HelpVideo v={S.helpVideo} /></> : null}
          <ol className="steps">
            <li><Share size={16} aria-hidden="true" /><span>Tap the <b>Share</b> button in your browser’s toolbar.</span></li>
            <li><SquarePlus size={16} aria-hidden="true" /><span>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</span></li>
            <li><Smartphone size={16} aria-hidden="true" /><span>Open <b>Lock In</b> from the new icon, log in, and tap <b>Turn on notifications</b>.</span></li>
          </ol>
          <p className="muted small">iPhone only allows notifications from the Home Screen app, not from a browser tab. If you don’t see Add to Home Screen, open this page in Safari first.</p>
        </>
      ) : blocked ? (
        <p className="notice">Notifications are blocked for Lock In on this device. Open your phone’s Settings, find Lock In under Notifications, allow them, then come back and tap the button.</p>
      ) : null}

      <div className="btns">
        {!needHomeScreen ? <button className="btn primary" onClick={turnOn} disabled={busy}><Bell size={15} aria-hidden="true" />{busy ? 'Turning on…' : 'Turn on notifications'}</button> : null}
        {!standalone && canInstall() ? <button className="btn" onClick={install}><Download size={15} aria-hidden="true" />Install the app</button> : null}
        <button className="btn ghost" onClick={snooze}>Not now</button>
      </div>
    </section>
  );
}
