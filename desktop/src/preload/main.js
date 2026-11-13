// Preload for the main window. This is the whole surface the page can reach: a handful of
// one-way messages. No Node, no file access, no generic IPC.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stacktimeDesktop', {
  ready: () => ipcRenderer.send('desktop:ready'),
  publishState: (snapshot) => ipcRenderer.send('desktop:state', snapshot),
  notify: (title, body) => ipcRenderer.send('desktop:notify', String(title), String(body)),
  openExternal: (url) => ipcRenderer.send('desktop:open-external', String(url)),
  openSettings: () => ipcRenderer.send('desktop:open-settings'),
  onCommand: (callback) => {
    ipcRenderer.on('desktop:command', (event, command) => callback(command));
  }
});
