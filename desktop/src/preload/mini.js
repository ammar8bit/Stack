// Preload for the mini view: receives the display the main process computed, sends three intents.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stacktimeMini', {
  onView: (callback) => { ipcRenderer.on('mini:view', (event, view) => callback(view)); },
  toggle: () => ipcRenderer.send('mini:toggle'),
  openMain: () => ipcRenderer.send('mini:open-main'),
  hide: () => ipcRenderer.send('mini:hide')
});
