// Development-only test harness. main.js loads it only when the app is NOT packaged and
// STACKTIME_TEST_PORT is set, and it is not shipped in the installer (see build.files). It lets a
// script do what a person would do by hand: click tray menu items, hide windows, go offline.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { session, powerMonitor, globalShortcut, app, shell } = require('electron');

module.exports = function startHarness(ctx, extra) {
  const win = name => ctx.windows[name];
  const mock = process.env.STACKTIME_TEST_MOCK ? require('./mock-cloud')(ctx.log) : null;
  const opened = [];
  const external = []; // every request that is not served from the app bundle
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (!details.url.startsWith('app://') && !details.url.startsWith('devtools://')) external.push(details.method + ' ' + details.url.split('?')[0]);
    callback({});
  });
  if (mock && process.env.STACKTIME_TEST_OFFLINE) mock.setOffline(true);
  if (mock) shell.openExternal = async (url) => { opened.push(url); }; // do not pop real browser tabs during tests
  const commands = {
    status() {
      const main = win('main');
      const mini = win('mini');
      return {
        main: main && { visible: main.isVisible(), minimized: main.isMinimized(), focused: main.isFocused(), title: main.getTitle(), bounds: main.getBounds() },
        mini: mini && { visible: mini.isVisible(), bounds: mini.getBounds(), onTop: mini.isAlwaysOnTop() },
        settingsOpen: Boolean(win('settings')),
        tooltip: ctx.tray.tooltip,
        menu: (ctx.trayMenuTemplate || []).filter(i => i.id).map(i => ({ id: i.id, label: i.label, checked: i.checked, enabled: i.enabled, accelerator: i.accelerator })),
        hotkeys: ctx.hotkeys.list().map(h => Object.assign({ osRegistered: h.accelerator ? globalShortcut.isRegistered(h.accelerator) : false }, h)),
        view: extra.currentView(),
        snapshot: ctx.snapshot,
        lastNotification: ctx.lastNotification || null,
        rendererReady: ctx.rendererReady,
        protocolClient: app.isDefaultProtocolClient('stacktime', process.execPath, [path.resolve(process.argv[1] || '.')])
      };
    },
    tray({ id }) {
      const item = (ctx.trayMenuTemplate || []).find(i => i.id === id);
      if (!item) throw new Error('no tray item ' + id);
      item.click({ checked: !item.checked });
      return true;
    },
    async eval({ target, js }) { return win(target || 'main').webContents.executeJavaScript(js, true); },
    async shot({ target, file }) {
      const image = await win(target || 'main').webContents.capturePage();
      fs.writeFileSync(file, image.toPNG());
      return image.getSize();
    },
    offline({ on }) {
      if (mock) mock.setOffline(on); else session.defaultSession.enableNetworkEmulation({ offline: Boolean(on) });
      return Boolean(on);
    },
    cloud() { return Object.assign({ opened }, mock.get()); },
    external() { return external.slice(-40); },
    cloudSet({ data }) { return mock.setRow(data); },
    window({ target, op }) { win(target || 'main')[op](); return true; },
    resume() { powerMonitor.emit('resume'); return true; },
    protocol({ url }) { extra.handleProtocolUrl(url); return true; },
    notify({ title, body }) { extra.notify(title, body); return true; },
    clickNotification() {
      const last = Array.from(ctx.notifications).pop();
      if (!last) throw new Error('no notification is showing');
      last.emit('click');
      return true;
    },
    openSettings() { ctx.windows.openSettings(); return true; },
    key({ target, keyCode, modifiers }) {
      const contents = win(target || 'main').webContents;
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: modifiers || [] });
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: modifiers || [] });
      return true;
    },
    quit() { setTimeout(() => ctx.actions.quit(), 50); return true; }
  };

  http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let out;
      try {
        const { cmd, args } = JSON.parse(body || '{}');
        if (!commands[cmd]) throw new Error('unknown command ' + cmd);
        out = { ok: true, result: await commands[cmd](args || {}) };
      } catch (error) {
        out = { ok: false, error: String((error && error.message) || error) };
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(out));
    });
  }).listen(Number(process.env.STACKTIME_TEST_PORT), '127.0.0.1', () => {
    ctx.log('Test harness listening on 127.0.0.1:' + process.env.STACKTIME_TEST_PORT);
  });
};
