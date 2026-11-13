// Tray icon: live timer tooltip plus the quick-control menu.
const { Tray, Menu } = require('electron');

function createTray(ctx) {
  const tray = new Tray(ctx.icon);
  let menuKey = '';
  let tooltip = '';

  function build(view) {
    const startup = ctx.startup.get();
    const key = [view.action, ctx.windows.miniVisible(), startup.enabled, startup.available,
      ctx.hotkeys.list().map(h => h.accelerator + h.registered).join()].join('|');
    if (key === menuKey) return;
    menuKey = key;
    const template = [
      { id: 'toggleTimer', label: view.action, accelerator: ctx.hotkeys.acceleratorFor('toggleTimer'), click: () => ctx.actions.toggleTimer() },
      { id: 'open', label: 'Open StackTime', accelerator: ctx.hotkeys.acceleratorFor('toggleMain'), click: () => ctx.windows.showMain() },
      { id: 'toggleMini', label: ctx.windows.miniVisible() ? 'Hide Mini View' : 'Show Mini View',
        accelerator: ctx.hotkeys.acceleratorFor('toggleMini'), click: () => ctx.windows.toggleMini() },
      { type: 'separator' },
      { id: 'startup', label: 'Launch on startup', type: 'checkbox', checked: startup.enabled, enabled: startup.available,
        click: item => ctx.startup.set(item.checked) },
      { id: 'settings', label: 'Hotkeys…', click: () => ctx.windows.openSettings() },
      { type: 'separator' },
      { id: 'quit', label: 'Quit StackTime', click: () => ctx.actions.quit() }
    ];
    tray.setContextMenu(Menu.buildFromTemplate(template));
    ctx.trayMenuTemplate = template; // read by the dev test harness
  }

  tray.on('click', () => ctx.windows.showMain());
  tray.on('double-click', () => ctx.windows.showMain());

  return {
    update(view) {
      if (tray.isDestroyed()) return;
      if (view.tooltip !== tooltip) {
        tooltip = view.tooltip;
        tray.setToolTip(tooltip);
      }
      build(view);
    },
    refreshMenu() { menuKey = ''; },
    balloon(title, content) {
      try { tray.displayBalloon({ title, content, iconType: 'info' }); } catch (error) {}
    },
    get tooltip() { return tooltip; },
    destroy() { if (!tray.isDestroyed()) tray.destroy(); }
  };
}

module.exports = { createTray };
