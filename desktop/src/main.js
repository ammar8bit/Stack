// StackTime desktop - main process.
//
// The window shows the same site as stacktime.me, bundled locally. The page keeps running the timer
// logic (one implementation, shared with the website) and publishes a timestamp-based snapshot here
// on every change. This process is the hub: it holds that snapshot, derives what the tray and mini
// view show from it, and routes start/pause from the tray, mini view and global hotkeys to the page.
const { app, Menu, ipcMain, shell, Notification, powerMonitor, session, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { registerScheme, handleAppProtocol, isAppUrl, ORIGIN } = require('./protocol');
const { createConfig } = require('./config');
const { createWindows } = require('./windows');
const { createTray } = require('./tray');
const { createHotkeys } = require('./hotkeys');
const { sanitizeSnapshot, computeView } = require('./timer');
const { initUpdater } = require('./updater');

const APP_ID = 'me.stacktime.desktop'; // must match build.appId so Windows ties notifications to the shortcut
const PROTOCOL = 'stacktime';
const isDev = !app.isPackaged;

// A development run keeps its own data so it never fights the installed app for the instance lock
if (isDev) app.setPath('userData', process.env.STACKTIME_USER_DATA || path.join(app.getPath('appData'), 'StackTime (dev)'));

const logFile = path.join(app.getPath('userData'), 'main.log');
function log(message) {
  const line = new Date().toISOString() + ' ' + message + '\n';
  if (isDev) process.stdout.write(line);
  try { fs.appendFileSync(logFile, line); } catch (error) {}
}
try {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  if (fs.statSync(logFile).size > 512 * 1024) fs.unlinkSync(logFile);
} catch (error) {}

registerScheme();

function findProtocolUrl(argv) {
  return argv.find(arg => typeof arg === 'string' && arg.toLowerCase().startsWith(PROTOCOL + '://')) || '';
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start() {
  const ctx = {
    isDev, log,
    config: createConfig(app.getPath('userData'), log),
    icon: nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.ico')),
    quitting: false,
    rendererReady: false,
    snapshot: null,
    pendingCommands: [],
    notifications: new Set()
  };
  let lastMiniKey = '';

  // ---- shared timer state ----
  function currentView() { return computeView(ctx.snapshot, Date.now()); }

  function pushMini(force) {
    const mini = ctx.windows.mini;
    if (!mini || !mini.isVisible()) return;
    const view = currentView();
    const key = view.time + view.status + view.label + view.sub + view.theme + view.finished;
    if (!force && key === lastMiniKey) return;
    lastMiniKey = key;
    mini.webContents.send('mini:view', {
      time: view.time, label: view.label, status: view.status, sub: view.sub, theme: view.theme, finished: view.finished
    });
  }

  function refresh() {
    if (ctx.tray) ctx.tray.update(currentView());
    pushMini(false);
  }

  function sendCommand(command) {
    const main = ctx.windows.main;
    if (!main || !ctx.rendererReady) {
      if (ctx.pendingCommands.length < 20) ctx.pendingCommands.push(command);
      return;
    }
    main.webContents.send('desktop:command', command);
  }

  // ---- launch on startup ----
  const loginArgs = ['--hidden'];
  ctx.startup = {
    get() {
      // Registering a development run would point Windows at electron.exe
      if (isDev) return { enabled: false, available: false };
      return { enabled: app.getLoginItemSettings({ args: loginArgs }).openAtLogin, available: true };
    },
    set(enabled) {
      if (isDev) return;
      app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: loginArgs });
      log('Launch on startup ' + (enabled ? 'enabled' : 'disabled'));
      if (ctx.tray) ctx.tray.refreshMenu();
      refresh();
      broadcastSettings();
    }
  };

  // ---- notifications ----
  function notify(title, body) {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: String(title || 'StackTime').slice(0, 120),
      body: String(body || '').slice(0, 240),
      icon: ctx.icon
    });
    // Hold a reference until it goes away, otherwise the click handler can be garbage collected
    ctx.notifications.add(notification);
    const release = () => ctx.notifications.delete(notification);
    notification.on('click', () => { release(); ctx.windows.showMain(); });
    notification.on('close', release);
    notification.on('failed', (event, error) => { release(); log('Notification failed: ' + error); });
    notification.show();
    ctx.lastNotification = { title: notification.title, body: notification.body, at: Date.now() };
    setTimeout(release, 5 * 60 * 1000);
  }

  // ---- sign-in callback (stacktime://auth-callback?code=...) ----
  function handleProtocolUrl(raw) {
    let url;
    try { url = new URL(raw); } catch (error) { return; }
    if (url.protocol !== PROTOCOL + ':' || url.hostname !== 'auth-callback') {
      log('Ignored unknown ' + PROTOCOL + ':// link');
      return;
    }
    const pick = name => (url.searchParams.get(name) || '').slice(0, 2000);
    sendCommand({ type: 'auth-callback', code: pick('code'), error: pick('error_description') || pick('error') });
    ctx.windows.showMain();
  }

  function openExternal(raw) {
    let url;
    try { url = new URL(raw); } catch (error) { return; }
    if (url.protocol === 'https:' || url.protocol === 'mailto:') shell.openExternal(url.toString());
  }

  ctx.actions = {
    toggleTimer: () => sendCommand({ type: 'toggle' }),
    quit: () => { ctx.quitting = true; app.quit(); }
  };
  ctx.pushMini = pushMini;
  // Tells the page whether anyone is looking, so it can stop painting while it sits in the tray
  ctx.onMainPresence = (hint) => {
    const main = ctx.windows.main;
    if (!main) return;
    const visible = hint && hint.visible !== undefined ? hint.visible : main.isVisible() && !main.isMinimized();
    const focused = hint && hint.focused !== undefined ? hint.focused : main.isFocused();
    sendCommand({ type: 'presence', visible, focused: visible && focused });
  };
  ctx.onMainShown = () => { ctx.onMainPresence(); sendCommand({ type: 'resync' }); };
  ctx.onMiniChanged = () => { lastMiniKey = ''; if (ctx.tray) ctx.tray.refreshMenu(); refresh(); };
  ctx.onMainHidden = () => {
    if (ctx.config.get('trayHintShown')) return;
    ctx.config.set('trayHintShown', true);
    ctx.tray.balloon('StackTime is still running', 'Your timer keeps going in the tray. Right-click the icon to quit.');
  };
  ctx.windows = createWindows(ctx);
  ctx.hotkeys = createHotkeys(ctx, {
    toggleTimer: () => ctx.actions.toggleTimer(),
    toggleMini: () => ctx.windows.toggleMini(),
    toggleMain: () => ctx.windows.toggleMain()
  });

  function settingsPayload() {
    const startup = ctx.startup.get();
    return {
      version: app.getVersion(),
      hotkeys: ctx.hotkeys.list(),
      launchAtStartup: startup.enabled,
      canLaunchAtStartup: startup.available
    };
  }
  function broadcastSettings() {
    const settings = ctx.windows.settings;
    if (settings) settings.webContents.send('settings:changed', settingsPayload());
  }

  // ---- IPC (every handler checks which window is calling) ----
  const from = (event, name) => {
    const win = ctx.windows[name];
    return Boolean(win && event.sender === win.webContents && isAppUrl(event.senderFrame && event.senderFrame.url));
  };
  ipcMain.on('desktop:ready', (event) => {
    if (!from(event, 'main')) return;
    ctx.rendererReady = true;
    ctx.onMainPresence();
    ctx.pendingCommands.splice(0).forEach(sendCommand);
  });
  ipcMain.on('desktop:state', (event, snapshot) => {
    if (!from(event, 'main')) return;
    ctx.snapshot = sanitizeSnapshot(snapshot);
    refresh();
  });
  ipcMain.on('desktop:notify', (event, title, body) => { if (from(event, 'main')) notify(title, body); });
  ipcMain.on('desktop:open-external', (event, url) => { if (from(event, 'main')) openExternal(url); });
  ipcMain.on('desktop:open-settings', (event) => { if (from(event, 'main')) ctx.windows.openSettings(); });
  ipcMain.on('mini:toggle', (event) => { if (from(event, 'mini')) ctx.actions.toggleTimer(); });
  ipcMain.on('mini:open-main', (event) => { if (from(event, 'mini')) ctx.windows.showMain(); });
  ipcMain.on('mini:hide', (event) => { if (from(event, 'mini')) ctx.windows.setMiniVisible(false); });
  ipcMain.handle('settings:get', (event) => (from(event, 'settings') ? settingsPayload() : null));
  ipcMain.handle('settings:set-hotkey', (event, action, accelerator) => {
    if (!from(event, 'settings')) return null;
    const result = ctx.hotkeys.set(String(action), typeof accelerator === 'string' ? accelerator : '');
    ctx.tray.refreshMenu();
    refresh();
    return Object.assign(result, settingsPayload());
  });
  ipcMain.handle('settings:reset-hotkey', (event, action) => {
    if (!from(event, 'settings')) return null;
    const result = ctx.hotkeys.reset(String(action));
    ctx.tray.refreshMenu();
    refresh();
    return Object.assign(result, settingsPayload());
  });
  ipcMain.handle('settings:set-startup', (event, enabled) => {
    if (!from(event, 'settings')) return null;
    ctx.startup.set(Boolean(enabled));
    return settingsPayload();
  });

  // ---- security: nothing but the bundled site may load, and it may not open windows ----
  app.on('web-contents-created', (event, contents) => {
    const block = (navEvent, url) => {
      if (isAppUrl(url)) return;
      navEvent.preventDefault();
      log('Blocked navigation to ' + String(url).slice(0, 120));
      openExternal(url);
    };
    contents.on('will-navigate', block);
    contents.on('will-redirect', block);
    contents.on('will-attach-webview', attachEvent => attachEvent.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: 'deny' };
    });
  });

  app.on('second-instance', (event, argv) => {
    const url = findProtocolUrl(argv);
    if (url) handleProtocolUrl(url);
    else ctx.windows.showMain();
  });
  app.on('before-quit', () => { ctx.quitting = true; });
  app.on('will-quit', () => {
    ctx.hotkeys.unregisterAll();
    ctx.config.flush();
  });
  // Closing every window never quits: the app lives in the tray until "Quit" is chosen
  app.on('window-all-closed', () => {});

  app.whenReady().then(() => {
    // In development Windows only shows toasts for a known executable; installed builds use the app id
    app.setAppUserModelId(isDev ? process.execPath : APP_ID);
    Menu.setApplicationMenu(null);
    if (isDev) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] || '.')]);
    else app.setAsDefaultProtocolClient(PROTOCOL);

    const allowed = ['notifications', 'clipboard-sanitized-write'];
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(isAppUrl(contents.getURL()) && allowed.includes(permission));
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin) => {
      return isAppUrl(origin) && allowed.includes(permission);
    });

    handleAppProtocol(path.join(__dirname, '..', 'site'), path.join(__dirname, 'renderer'));

    ctx.tray = createTray(ctx);
    ctx.hotkeys.registerAll();
    const startHidden = process.argv.includes('--hidden');
    ctx.windows.createMain(startHidden);
    if (ctx.config.get('miniVisible')) ctx.windows.setMiniVisible(true);
    refresh();

    // One cheap tick: recompute from timestamps and only touch the tray / mini view when the text changes
    setInterval(refresh, 250);

    // After sleep or unlocking, have the page re-check its timestamps and catch up with the cloud
    powerMonitor.on('resume', () => { log('System resumed'); sendCommand({ type: 'resync' }); refresh(); });
    powerMonitor.on('unlock-screen', () => { sendCommand({ type: 'resync' }); refresh(); });

    const firstUrl = findProtocolUrl(process.argv);
    if (firstUrl) handleProtocolUrl(firstUrl);

    const updater = initUpdater(log);
    log('StackTime ' + app.getVersion() + ' started' + (startHidden ? ' hidden' : '') + '; updates '
      + (updater.enabled ? 'on' : 'off (' + updater.reason + ')'));

    if (isDev && process.env.STACKTIME_TEST_PORT) {
      require('../test/harness')(ctx, { handleProtocolUrl, currentView, notify });
    }
  });
}
