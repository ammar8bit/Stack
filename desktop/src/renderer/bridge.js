// Desktop bridge - runs inside the page, only in the desktop app.
//
// index.html contains one small guarded hook: when window.stacktimeDesktop exists (it only does
// inside Electron) the page hands a few of its own functions to stacktimeDesktopAttach() below and
// calls the returned hooks. Everything desktop-specific lives here, so the website keeps a single,
// dependency-free file and behaves exactly as before in a browser.
(function () {
  const host = window.stacktimeDesktop;
  if (!host) return;

  const CALLBACK_URL = 'stacktime://auth-callback';
  const SYNC_KEY = 'stackDesktopSync';
  const byId = id => document.getElementById(id);
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
  };

  window.stacktimeDesktopAttach = function (app) {
    const today = () => app.getTodayStr();
    const state = () => app.getState();
    const syncOn = () => store.get('stackCloudSyncEnabled') === 'true';
    const userId = () => store.get('stackCloudUserId') || '';

    // ---- 1. publish the timer state to the main process (tray, mini view, hotkeys) ----
    let publishQueued = false;
    function publish() {
      if (publishQueued) return;
      publishQueued = true;
      queueMicrotask(() => {
        publishQueued = false;
        const s = state();
        host.publishState(Object.assign({}, app.buildPayload(), {
          dailyGoalHours: s.hasGoal ? app.getDailyGoalHours() : null,
          inRoom: Boolean(app.getRoomCode())
        }));
      });
    }

    // ---- 2. offline-first sync ----
    // `base` is the last point where this device and the cloud agreed. `dirty` means there are local
    // changes the cloud has not accepted yet. Together they let a reconnect add only the time studied
    // offline, and spot the case where another device changed the account in the meantime - which is
    // then put to the user instead of one side silently replacing the other.
    let meta = { dirty: false, base: null };
    try { meta = Object.assign(meta, JSON.parse(store.get(SYNC_KEY) || '{}')); } catch (e) {}
    let lastCloudCheck = 0;
    let conflict = null;
    let conflictDismissed = false;
    let flushTimer = null;

    function saveMeta() { store.set(SYNC_KEY, JSON.stringify(meta)); renderStatus(); }
    function markSynced() {
      const s = state();
      meta.dirty = false;
      meta.base = { uid: userId(), totalMs: s.totalMs, todayMs: s.todayMs, date: today(), savedAt: s.savedAt || 0 };
      saveMeta();
    }
    function offlineDelta() {
      const s = state();
      const base = meta.base;
      return {
        total: s.totalMs - base.totalMs,
        today: Math.max(0, s.todayMs - (base.date === today() ? base.todayMs : 0))
      };
    }

    function resolveConflict() {
      conflict = null;
      conflictDismissed = false;
      meta.dirty = false;
      saveMeta();
      app.closeCloudChoice();
    }

    function showConflict(remote) {
      const s = state();
      const delta = offlineDelta();
      const running = app.anyTimerRunning();
      const studied = delta.total > 0 ? app.formatHoursMinutes(delta.total) + ' of study time' : '';
      const timer = running ? 'a timer that is still running' : '';
      app.showCloudChoice({
        title: 'Keep what you did offline?',
        message: 'While this device was offline it recorded ' + [studied, timer].filter(Boolean).join(' and ')
          + '. Meanwhile another device updated your account (now ' + app.formatHoursMinutes(Number(remote.totalMs) || 0)
          + ' in total).' + (running ? ' Your timer will keep going.' : ''),
        primary: {
          label: 'Keep both — add my offline time',
          action: () => {
            const day = today();
            const merged = Object.assign({}, remote, {
              totalMs: (Number(remote.totalMs) || 0) + Math.max(0, delta.total),
              todayMs: (remote.lastStudyDate === day ? Number(remote.todayMs) || 0 : 0) + delta.today,
              lastStudyDate: day
            });
            if (running) {
              // The timer running on this device carries on untouched
              ['mode', 'countdownInitialMs', 'countdownFinished', 'sessionRunning', 'sessionStartTime', 'sessionElapsed',
                'questionRunning', 'questionStartTime', 'questionElapsed', 'countdownRunning', 'countdownStartTime',
                'paused', 'pauseStart', 'frozen', 'lastActive'].forEach(key => { merged[key] = s[key]; });
            }
            app.applyStateData(merged, true);
            resolveConflict();
            app.saveState();
          }
        },
        secondary: {
          label: "Use the other device's progress",
          action: () => { app.applyStateData(remote, true); resolveConflict(); }
        },
        tertiary: {
          label: "Keep only this device's progress",
          action: () => { resolveConflict(); app.saveState(); }
        }
      });
    }

    // Called by the page with the cloud copy before it would adopt it or overwrite it.
    // true = "do nothing yet, the user is being asked".
    function holdRemote(remote) {
      lastCloudCheck = Date.now();
      if (conflict) {
        if (remote) conflict = remote;
        if (!conflictDismissed && !byId('cloudChoiceOverlay').classList.contains('open')) showConflict(conflict);
        return true;
      }
      const base = meta.base;
      if (!remote || !meta.dirty || !base || base.uid !== userId()) return false;
      if (remote.writer === app.deviceId || Number(remote.savedAt || 0) <= base.savedAt) return false;
      if (!app.anyTimerRunning() && offlineDelta().total <= 0) return false; // nothing here to lose
      conflict = remote;
      conflictDismissed = false;
      showConflict(remote);
      renderStatus();
      return true;
    }

    // With unsynced changes, a save must first compare against the cloud copy instead of blindly
    // replacing it. syncCloud(true) does exactly that: fetch, compare (holdRemote above), then save.
    function flushSoon() {
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => { if (navigator.onLine) app.syncCloud(true); }, 400);
    }
    function interceptSave() {
      if (conflict) return true;
      if (!navigator.onLine) {
        if (!meta.dirty) { meta.dirty = true; saveMeta(); }
        return true;
      }
      if (!meta.dirty || Date.now() - lastCloudCheck < 5000) return false;
      flushSoon();
      return true;
    }

    // ---- 3. offline indicator ----
    const pill = document.createElement('div');
    pill.textContent = 'Offline — your timer still works. Changes sync when you reconnect.';
    pill.style.cssText = 'position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);z-index:2000;display:none;'
      + 'pointer-events:none;padding:0.45rem 0.95rem;border-radius:50px;font-size:0.72rem;font-weight:500;'
      + 'background:var(--bg-card);color:var(--text);border:1px solid var(--orange);box-shadow:var(--shadow);'
      + 'backdrop-filter:blur(12px);white-space:nowrap;';
    pill.setAttribute('role', 'status');
    document.body.appendChild(pill);

    const cloudStatus = byId('cloudStatus');
    let lastOverride = null;
    function statusOverride() {
      if (!syncOn()) return null;
      if (conflict) return 'Sync paused — choose which progress to keep';
      if (!navigator.onLine) return 'Offline — saved on this device, will sync when you reconnect';
      if (meta.dirty) return 'Back online — syncing your changes…';
      return null;
    }
    function renderStatus() {
      pill.style.display = navigator.onLine ? 'none' : 'block';
      const override = statusOverride();
      if (override) {
        if (cloudStatus.textContent !== override) cloudStatus.textContent = override;
      } else if (lastOverride) {
        app.updateAccountUI();
      }
      lastOverride = override;
    }
    new MutationObserver(() => {
      const override = statusOverride();
      if (override && cloudStatus.textContent !== override) cloudStatus.textContent = override;
    }).observe(cloudStatus, { childList: true, characterData: true, subtree: true });

    // ---- 4. Study Together while offline: keep typed messages and send them on reconnect ----
    const chatQueue = [];
    let lastOfflineNote = 0;
    function offlineNote(text) {
      if (Date.now() - lastOfflineNote < 4000) return;
      lastOfflineNote = Date.now();
      app.roomSys(text);
    }
    document.addEventListener('submit', (event) => {
      if (navigator.onLine || event.target.id !== 'rvChatForm') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const input = byId('rvChatInput');
      const text = input.value.trim().slice(0, 300);
      if (!text) return;
      input.value = '';
      if (chatQueue.length < 20) chatQueue.push(text);
      app.roomSys('Offline — "' + text + '" will be sent when you reconnect');
    }, true);
    document.addEventListener('click', (event) => {
      if (navigator.onLine || !event.target.closest) return;
      if (!event.target.closest('.rv-cheer, .rv-nudge')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      offlineNote('Offline — cheers and nudges need a connection');
    }, true);

    async function onOnline() {
      renderStatus();
      // An expired session could not refresh while offline; this renews it straight away
      if (app.supabase) { try { await app.supabase.auth.getSession(); } catch (e) {} }
      conflictDismissed = false;
      if (meta.dirty || conflict) app.syncCloud(true); else app.syncCloud(false);
      if (app.getRoomCode()) {
        app.roomResync();
        while (chatQueue.length) await app.roomSend('text', chatQueue.shift());
      }
    }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', () => {
      renderStatus();
      if (app.getRoomCode()) app.roomSys('You are offline. Your time keeps counting and updates when you reconnect.', true);
    });
    // Retry quietly while changes are waiting (covers a connection that is "up" but not reachable yet)
    setInterval(() => { if (meta.dirty && navigator.onLine && syncOn()) app.syncCloud(true); }, 15000);
    byId('cloudChoiceCloseBtn').addEventListener('click', () => { if (conflict) conflictDismissed = true; });

    // ---- 5. sign-in through the system browser ----
    async function oauth(provider) {
      if (!navigator.onLine) return 'You are offline. Connect to the internet to sign in.';
      const { data, error } = await app.supabase.auth.signInWithOAuth({
        provider, options: { redirectTo: CALLBACK_URL, skipBrowserRedirect: true }
      });
      if (error || !data || !data.url) return (error && error.message) || 'Could not start sign-in.';
      host.openExternal(data.url);
      return 'Finish signing in in your browser, then come back to StackTime.';
    }
    async function finishOAuth(command) {
      const message = byId('authMessage');
      if (command.error || !command.code) {
        message.textContent = command.error || 'Sign-in was cancelled.';
        return;
      }
      const { error } = await app.supabase.auth.exchangeCodeForSession(command.code);
      if (error) message.textContent = error.message;
      else byId('authOverlay').classList.remove('open');
    }

    // ---- 6. commands from the tray, mini view and global hotkeys ----
    function toggleTimer() {
      const s = state();
      // Resume if paused, pause if anything is running, otherwise start in the current mode
      if (s.paused || !app.anyTimerRunning()) byId('startBtn').click();
      else byId('pauseBtn').click();
    }
    function resync() {
      conflictDismissed = false;
      app.reconcileStale();
      app.refreshRunUI();
      app.updateDisplay();
      app.syncCloud(false);
      app.roomResync();
      publish();
    }
    host.onCommand((command) => {
      if (!command || typeof command !== 'object') return;
      if (command.type === 'toggle') toggleTimer();
      else if (command.type === 'resync') resync();
      else if (command.type === 'auth-callback') finishOAuth(command);
    });

    // A hidden window gets no animation frames, so the countdown must not rely on them to finish
    setInterval(() => {
      const s = state();
      if (s.countdownRunning && !s.paused && Date.now() >= s.countdownStartTime + s.countdownInitialMs) app.finishCountdown();
    }, 250);
    // Goal maths and the day rollover change without a save; keep the tray and mini view fresh
    setInterval(publish, 30000);
    byId('resetAllBtn').addEventListener('click', publish);

    // ---- 7. a way into the desktop settings from the page's own settings panel ----
    const row = document.createElement('div');
    row.className = 'setting-row';
    const label = document.createElement('span');
    label.className = 'setting-label';
    label.textContent = 'Desktop app';
    const button = document.createElement('button');
    button.className = 'btn-small';
    button.type = 'button';
    button.textContent = 'Hotkeys';
    button.addEventListener('click', () => host.openSettings());
    row.append(label, button);
    const resetAll = byId('resetAllBtn');
    resetAll.parentNode.insertBefore(row, resetAll);

    renderStatus();
    publish();
    host.ready();

    return {
      changed: publish,
      notify: (title, body) => host.notify(title, body),
      oauth,
      emailRedirect: 'https://stacktime.me/',
      holdRemote,
      interceptSave,
      cloudSaved: (ok) => {
        if (ok) markSynced();
        else if (!meta.dirty) { meta.dirty = true; saveMeta(); }
      },
      cloudApplied: markSynced
    };
  };
})();
