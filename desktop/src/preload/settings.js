// Preload for the desktop settings window (hotkeys and launch on startup).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stacktimeSettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  setHotkey: (action, accelerator) => ipcRenderer.invoke('settings:set-hotkey', String(action), String(accelerator)),
  resetHotkey: (action) => ipcRenderer.invoke('settings:reset-hotkey', String(action)),
  setStartup: (enabled) => ipcRenderer.invoke('settings:set-startup', Boolean(enabled)),
  onChanged: (callback) => { ipcRenderer.on('settings:changed', (event, payload) => callback(payload)); }
});
