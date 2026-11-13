// End-to-end checks against a running development app (see README, "Testing").
// Start the app with STACKTIME_TEST_PORT=47821 STACKTIME_TEST_MOCK=1 and a throwaway
// STACKTIME_USER_DATA, then:  node test/e2e.js <scenario>
const PORT = process.env.STACKTIME_TEST_PORT || 47821;
const call = (cmd, args) => fetch('http://127.0.0.1:' + PORT, { method: 'POST', body: JSON.stringify({ cmd, args: args || {} }) })
  .then(r => r.json()).then(o => { if (!o.ok) throw new Error(cmd + ': ' + o.error); return o.result; });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = js => call('eval', { js });
const click = id => page(`document.getElementById(${JSON.stringify(id)}).click(); true`);
const saved = () => page(`JSON.parse(localStorage.getItem('stackTimerState') || 'null')`);
const ui = () => page(`({
  status: document.getElementById('cloudStatus').textContent,
  account: document.getElementById('accountBtn').textContent,
  pill: [...document.querySelectorAll('[role=status]')].some(e => e.style.display !== 'none' && /Offline/.test(e.textContent)),
  choiceOpen: document.getElementById('cloudChoiceOverlay').classList.contains('open'),
  choiceTitle: document.getElementById('cloudChoiceTitle').textContent,
  choiceMessage: document.getElementById('cloudChoiceMessage').textContent,
  authMessage: document.getElementById('authMessage').textContent,
  authOpen: document.getElementById('authOverlay').classList.contains('open'),
  onLine: navigator.onLine,
  sync: JSON.parse(localStorage.getItem('stackDesktopSync') || 'null'),
  timer: document.getElementById('timerDisplay').textContent
})`);

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
async function until(fn, ms) {
  const end = Date.now() + (ms || 8000);
  let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(250); }
  return last;
}

const scenarios = {
  // Sign in with email + password, then check that changes reach the cloud
  async signin() {
    if (await page(`document.getElementById('welcomeOverlay').classList.contains('open')`)) await click('setupSkipBtn');
    await click('accountBtn');
    await click('authModeBtn');
    await page(`document.getElementById('authEmail').value = 'tester@example.test'; document.getElementById('authPassword').value = 'mock-password-not-real'; document.getElementById('authForm').requestSubmit(); true`);
    const signedIn = await until(async () => (await ui()).account === 'Account');
    check('signed in with email/password', Boolean(signedIn), (await ui()).status);
    const first = await until(async () => (await call('cloud')).writes >= 1 && (await call('cloud')));
    check('first sync uploaded to cloud', Boolean(first), first && { writes: first.writes });
    check('sync baseline recorded', Boolean((await ui()).sync && (await ui()).sync.base), (await ui()).sync);
  },

  // Offline: timer keeps working, UI says Offline, nothing is lost, and it syncs on reconnect
  async offline() {
    const before = await call('cloud');
    await call('offline', { on: true });
    await click('startBtn');
    await sleep(3200);
    const running = await saved();
    check('timer runs offline', running.sessionRunning === true);
    let u = await ui();
    check('offline pill visible', u.pill === true);
    check('cloud status says Offline', /^Offline/.test(u.status), u.status);
    await call('shot', { file: (process.env.SHOT_DIR || '.') + '/offline.png' });
    await click('startBtn'); // stop: banks the session into the totals
    await sleep(1500);
    const stopped = await saved();
    check('offline session banked locally', stopped.totalMs >= 3000 && stopped.sessionRunning === false, { totalMs: stopped.totalMs });
    const during = await call('cloud');
    check('nothing reached the cloud while offline', during.writes === before.writes, { writes: during.writes });
    check('changes queued (dirty)', (await ui()).sync.dirty === true);
    await call('offline', { on: false });
    const synced = await until(async () => { const c = await call('cloud'); return c.writes > before.writes && c.row.data.totalMs === stopped.totalMs && c; }, 12000);
    check('auto-synced after reconnect', Boolean(synced), synced && { cloudTotalMs: synced.row.data.totalMs });
    u = await until(async () => { const x = await ui(); return !x.pill && !x.sync.dirty && !/Offline|syncing/i.test(x.status) && x; }, 8000);
    check('offline state cleared', Boolean(u), u ? u.status : await ui());
  },

  // Another device changed the account while this one studied offline with a timer running
  async conflict() {
    await call('offline', { on: true });
    await sleep(500);
    const base = await saved();
    await click('startBtn');
    await sleep(2500);
    await click('startBtn'); // bank ~2.5s offline
    await sleep(400);
    await click('startBtn'); // and leave a timer running
    await sleep(1200);
    const local = await saved();
    const offlineDelta = local.totalMs - base.totalMs;
    const otherDevice = Object.assign({}, base, {
      totalMs: base.totalMs + 3600000, todayMs: base.todayMs + 3600000, sessionRunning: false,
      savedAt: Date.now() + 1000, writer: 'another-device', lastActive: Date.now()
    });
    await call('cloudSet', { data: otherDevice });
    const writesBefore = (await call('cloud')).writes;
    await call('offline', { on: false });
    const asked = await until(async () => { const u = await ui(); return u.choiceOpen && u; }, 12000);
    check('conflict popup shown instead of overwriting', Boolean(asked) && /offline/i.test(asked.choiceTitle), asked && asked.choiceTitle + ' | ' + asked.choiceMessage);
    await sleep(1500);
    const held = await saved();
    check('running timer untouched while asking', held.sessionRunning === true && held.sessionStartTime === local.sessionStartTime && held.totalMs === local.totalMs);
    check('cloud copy untouched while asking', (await call('cloud')).writes === writesBefore && (await call('cloud')).row.data.writer === 'another-device');
    check('status says sync is paused', /Sync paused/.test((await ui()).status), (await ui()).status);
    await call('shot', { file: (process.env.SHOT_DIR || '.') + '/conflict.png' });
    await click('cloudPrimaryBtn'); // Keep both
    const merged = await until(async () => { const c = await call('cloud'); return c.writes > writesBefore && c.row.data; }, 8000);
    check('keep both: totals are cloud + offline time', Boolean(merged) && merged.totalMs === otherDevice.totalMs + offlineDelta,
      merged && { cloud: merged.totalMs, expected: otherDevice.totalMs + offlineDelta });
    check('keep both: timer still running from the same start', Boolean(merged) && merged.sessionRunning === true && merged.sessionStartTime === local.sessionStartTime);
    check('popup closed and sync resumed', !(await ui()).choiceOpen && (await ui()).sync.dirty === false);
    await click('startBtn');
  },

  // A newer cloud copy from another device still syncs in normally when nothing local is pending
  async remote() {
    await sleep(2500); // let any queued save from the previous scenario land first
    const mine = await saved();
    const other = Object.assign({}, mine, { totalMs: mine.totalMs + 120000, savedAt: Date.now() + 500, writer: 'another-device' });
    await call('cloudSet', { data: other });
    const got = await until(async () => { const s = await saved(); return s.totalMs === other.totalMs && s; }, 14000);
    check('newer cloud copy adopted when nothing is pending', Boolean(got), (await ui()).status);
    check('no popup for a plain sync', (await ui()).choiceOpen === false);
  },

  // Google sign-in: system browser + stacktime:// callback + PKCE code exchange
  async oauth() {
    await click('accountBtn');
    await page(`document.getElementById('accountSignOutBtn') && (window.confirm = () => true); true`);
    if ((await ui()).account === 'Account') { await click('accountSignOutBtn'); await until(async () => (await ui()).account !== 'Account'); await click('accountBtn'); }
    await click('googleAuthBtn');
    const opened = await until(async () => (await call('cloud')).opened.slice(-1)[0], 5000);
    const url = opened ? new URL(opened) : null;
    check('browser opened on the Supabase authorize page', Boolean(url) && url.pathname === '/auth/v1/authorize' && url.searchParams.get('provider') === 'google');
    check('redirects back to stacktime://auth-callback', Boolean(url) && url.searchParams.get('redirect_to') === 'stacktime://auth-callback');
    check('uses PKCE (code challenge, no token in URL)', Boolean(url) && Boolean(url.searchParams.get('code_challenge')) && url.searchParams.get('code_challenge_method') === 's256');
    check('page tells the user to continue in the browser', /browser/.test((await ui()).authMessage), (await ui()).authMessage);
    await call('protocol', { url: 'stacktime://auth-callback?code=test-auth-code' });
    const done = await until(async () => (await ui()).account === 'Account' && (await call('cloud')).lastPkce, 8000);
    check('callback code exchanged for a session', Boolean(done) && done.code === 'test-auth-code' && done.verifierLength > 40, done);
    check('auth dialog closed', (await ui()).authOpen === false);
    await call('protocol', { url: 'stacktime://evil/?code=x' });
    await call('protocol', { url: 'stacktime://auth-callback?error=access_denied&error_description=User+cancelled' });
    await sleep(500);
    check('callback error is shown, not crashed', /cancelled/.test((await ui()).authMessage), (await ui()).authMessage);
  },

  // Countdown finishing while the window is hidden raises a native notification; clicking focuses the app
  async notify() {
    await page(`document.querySelector('.mode-btn[data-mode="countdown"]').click(); const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); }; set('cdH', 0); set('cdM', 0); set('cdS', 3); true`);
    await click('startBtn');
    await call('window', { op: 'hide' });
    const t0 = Date.now();
    const note = await until(async () => { const s = await call('status'); return s.lastNotification && s.lastNotification.at >= t0 && s; }, 9000);
    check('native notification fired while hidden', Boolean(note) && note.lastNotification.title === 'StackTime timer finished', note && { afterMs: note.lastNotification.at - t0, tooltip: note.tooltip.split('\n')[0] });
    check('window still hidden before the click', note && note.main.visible === false);
    await call('clickNotification');
    await sleep(700);
    const after = await call('status');
    check('clicking the notification shows and focuses the app', after.main.visible === true && after.main.focused === true, after.main);
    await click('dismissTimerAlertBtn');
    await page(`document.querySelector('.mode-btn[data-mode="session"]').click(); true`);
  },

  // Sleep: the page was "away" (no heartbeats). Short naps keep counting; >3h pauses at the last heartbeat.
  async sleep() {
    // Stop everything first: a running timer saves a heartbeat on unload and would undo the edit below
    await page(`document.querySelector('.mode-btn[data-mode="session"]').click(); true`);
    await click('resetBtn');
    await sleep(1500);
    const now = Date.now();
    const base = await saved();
    const write = data => page(`localStorage.setItem('stackTimerState', ${JSON.stringify(JSON.stringify(data))}); location.reload(); true`);
    await write(Object.assign({}, base, { mode: 'session', sessionRunning: true, sessionStartTime: now - 20 * 60000, sessionElapsed: 0, paused: false, pauseStart: 0, frozen: null, lastActive: now - 10 * 60000, savedAt: now + 5000 }));
    await sleep(2500);
    let view = (await call('status')).view;
    check('10 min asleep: still running, wall-clock time kept', view.status === 'running' && /^00:20:0/.test(view.time), view.time);
    await call('resume');
    await sleep(800);
    view = (await call('status')).view;
    check('resume event handled, timer continuous', view.status === 'running' && /^00:20:0/.test(view.time), view.time);
    await click('resetBtn');
    await sleep(1500);
    await write(Object.assign({}, base, { mode: 'session', sessionRunning: true, sessionStartTime: now - 5 * 3600000, sessionElapsed: 0, paused: false, pauseStart: 0, frozen: null, lastActive: now - 4 * 3600000, savedAt: Date.now() + 60000 }));
    await sleep(2500);
    view = (await call('status')).view;
    check('4 h asleep: paused at the last moment the app was alive', view.status === 'paused' && view.time === '01:00:00', view.time);
    await click('resetBtn');
  },

  // Painting follows the window: none while hidden, slow while unfocused, full speed when focused.
  // The timer itself must not notice any of this.
  async presence() {
    const frames = () => page(`new Promise(done => {
      let n = 0, live = true;
      const tick = () => { if (!live) return; n++; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      setTimeout(() => { live = false; done(n); }, 1000);
    })`);
    const classes = () => page(`document.documentElement.className`);
    await page(`document.querySelector('.mode-btn[data-mode="session"]').click(); true`);
    await click('startBtn');
    await call('window', { op: 'show' });
    await call('window', { op: 'focus' });
    await sleep(500);
    const focusedFrames = await frames();
    check('focused: full frame rate', focusedFrames >= 30, focusedFrames);

    await call('window', { op: 'hide' });
    await sleep(500);
    check('hidden: page marked hidden', /stacktime-hidden/.test(await classes()), await classes());
    const hiddenFrames = await frames();
    check('hidden: no frames painted', hiddenFrames === 0, hiddenFrames);
    const tooltipA = (await call('status')).view.time;
    await sleep(2200);
    const hiddenView = (await call('status')).view;
    check('hidden: timer keeps counting', hiddenView.status === 'running' && hiddenView.time !== tooltipA, [tooltipA, hiddenView.time]);

    await call('window', { op: 'show' });
    await call('window', { op: 'focus' });
    await sleep(600);
    check('shown again: hidden mark cleared', !/stacktime-(hidden|unfocused)/.test(await classes()), await classes());
    const shown = await page(`document.getElementById('timerDisplay').textContent`);
    const tray = (await call('status')).view.time;
    const secs = t => t.split(':').reduce((a, b) => a * 60 + Number(b), 0);
    check('shown again: display caught up with the tray', Math.abs(secs(shown) - secs(tray)) <= 1, [shown, tray]);
    const backFrames = await frames();
    check('shown again: full frame rate', backFrames >= 30, backFrames);

    await call('window', { op: 'minimize' });
    await sleep(500);
    check('minimised: page marked hidden', /stacktime-hidden/.test(await classes()), await classes());
    await call('window', { op: 'restore' });
    await call('window', { op: 'focus' });
    await sleep(500);
    check('restored: hidden mark cleared', !/stacktime-hidden/.test(await classes()), await classes());

    await click('resetBtn');
  }
};

(async () => {
  const names = process.argv.slice(2);
  for (const name of names) {
    console.log('--- ' + name);
    await scenarios[name]();
  }
  console.log(failures ? failures + ' check(s) FAILED' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch(error => { console.error('ERROR', error.message); process.exit(1); });
