// The three windows: the main one (the bundled site), the mini view and the hotkey settings.
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { ORIGIN } = require('./protocol');

const MINI_SIZE = { width: 300, height: 96 };
const DEFAULT_TITLE = 'StackTime';

function onScreen(bounds) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return false;
  return screen.getAllDisplays().some(display => {
    const area = display.workArea;
    const overlapX = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapY = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return overlapX >= 80 && overlapY >= 40;
  });
}

function debounce(fn, ms) {
  let timer = null;
  return () => { clearTimeout(timer); timer = setTimeout(fn, ms); };
}

function createWindows(ctx) {
  const { config, icon } = ctx;
  const preload = name => path.join(__dirname, 'preload', name);
  const webPreferences = name => ({
    preload: preload(name),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    spellcheck: false,
    devTools: ctx.isDev,
    // Keep timers and the page alive while the window is hidden in the tray or minimised
    backgroundThrottling: false
  });

  let main = null;
  let mini = null;
  let settings = null;

  function createMain(startHidden) {
    const saved = config.get('windowBounds');
    const bounds = onScreen(saved) ? saved : { width: 1100, height: 780 };
    main = new BrowserWindow(Object.assign({
      minWidth: 420,
      minHeight: 560,
      show: false,
      title: DEFAULT_TITLE,
      icon,
      backgroundColor: '#1a0a0a',
      autoHideMenuBar: true,
      webPreferences: webPreferences('main.js')
    }, bounds));
    if (config.get('windowMaximized')) main.maximize();

    const saveBounds = debounce(() => {
      if (!main || main.isDestroyed()) return;
      config.set('windowMaximized', main.isMaximized());
      if (!main.isMaximized() && !main.isMinimized()) config.set('windowBounds', main.getNormalBounds());
    }, 400);
    main.on('resize', saveBounds);
    main.on('move', saveBounds);
    main.on('maximize', saveBounds);
    main.on('unmaximize', saveBounds);

    // The page title is long SEO text; show the app name, but keep alerts such as "Time is up"
    main.on('page-title-updated', (event, title) => {
      event.preventDefault();
      const alert = /^(Time is up|\(\d+\))/.test(title);
      main.setTitle(alert ? title.replace(/ — .*$/, '') + ' — ' + DEFAULT_TITLE : DEFAULT_TITLE);
    });

    main.on('close', (event) => {
      if (ctx.quitting) return;
      // Closing the window keeps the timer running in the tray
      event.preventDefault();
      main.hide();
      ctx.onMainHidden();
    });
    main.on('show', () => ctx.onMainShown());
    main.on('restore', () => ctx.onMainShown());
    main.on('closed', () => { main = null; });
    main.webContents.on('render-process-gone', (event, details) => {
      ctx.log('Main renderer gone (' + details.reason + '), reloading');
      ctx.rendererReady = false;
      if (!ctx.quitting && main && !main.isDestroyed()) main.reload();
    });
    main.once('ready-to-show', () => { if (!startHidden) main.show(); });
    main.loadURL(ORIGIN + '/index.html');
    return main;
  }

  function showMain() {
    if (!main || main.isDestroyed()) return;
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
  }

  function toggleMain() {
    if (!main || main.isDestroyed()) return;
    if (main.isVisible() && !main.isMinimized() && main.isFocused()) main.hide();
    else showMain();
  }

  function defaultMiniBounds() {
    const area = screen.getPrimaryDisplay().workArea;
    return {
      x: area.x + area.width - MINI_SIZE.width - 24,
      y: area.y + area.height - MINI_SIZE.height - 24
    };
  }

  function createMini() {
    const saved = config.get('miniBounds');
    const position = saved && onScreen(Object.assign({}, MINI_SIZE, saved)) ? saved : defaultMiniBounds();
    mini = new BrowserWindow(Object.assign({
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      title: 'StackTime mini view',
      icon,
      webPreferences: webPreferences('mini.js')
    }, MINI_SIZE, { x: position.x, y: position.y }));
    mini.setAlwaysOnTop(true, 'floating');
    mini.on('moved', debounce(() => {
      if (!mini || mini.isDestroyed()) return;
      const [x, y] = mini.getPosition();
      config.set('miniBounds', { x, y });
    }, 300));
    mini.on('close', (event) => {
      if (ctx.quitting) return;
      event.preventDefault();
      setMiniVisible(false);
    });
    mini.on('closed', () => { mini = null; });
    mini.webContents.on('did-finish-load', () => ctx.pushMini(true));
    mini.loadURL(ORIGIN + '/__desktop/mini.html');
    return mini;
  }

  function setMiniVisible(visible) {
    if (visible) {
      if (!mini || mini.isDestroyed()) createMini();
      // showInactive: popping up the mini view must not steal focus from what the user is doing
      if (mini.webContents.isLoading()) mini.webContents.once('did-finish-load', () => mini && mini.showInactive());
      else mini.showInactive();
    } else if (mini && !mini.isDestroyed()) {
      mini.hide();
    }
    config.set('miniVisible', Boolean(visible));
    ctx.onMiniChanged();
  }

  function miniVisible() {
    return Boolean(mini && !mini.isDestroyed() && mini.isVisible());
  }

  function openSettings() {
    if (settings && !settings.isDestroyed()) {
      settings.show();
      settings.focus();
      return;
    }
    settings = new BrowserWindow({
      width: 480,
      height: 600,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      show: false,
      title: 'StackTime — Desktop settings',
      icon,
      backgroundColor: '#1a0a0a',
      autoHideMenuBar: true,
      webPreferences: webPreferences('settings.js')
    });
    settings.once('ready-to-show', () => settings.show());
    settings.on('closed', () => { settings = null; });
    settings.loadURL(ORIGIN + '/__desktop/settings.html');
  }

  return {
    createMain, showMain, toggleMain, setMiniVisible, miniVisible, openSettings,
    toggleMini: () => setMiniVisible(!miniVisible()),
    get main() { return main && !main.isDestroyed() ? main : null; },
    get mini() { return mini && !mini.isDestroyed() ? mini : null; },
    get settings() { return settings && !settings.isDestroyed() ? settings : null; }
  };
}

module.exports = { createWindows };
