// Auto-update via electron-updater. It only switches on in an installed build that was packaged
// with a release feed: electron-builder writes resources/app-update.yml when package.json has a
// "publish" entry. Until then (see README, "Releasing") this does nothing at all - no network
// requests, no errors.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function initUpdater(log) {
  if (!app.isPackaged) return { enabled: false, reason: 'development run' };
  if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
    return { enabled: false, reason: 'no release feed configured' };
  }
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
    autoUpdater.on('error', error => log('Update error: ' + (error && error.message)));
    // Downloads in the background and installs on the next quit; never interrupts a study session
    autoUpdater.checkForUpdatesAndNotify().catch(error => log('Update check failed: ' + error.message));
    return { enabled: true };
  } catch (error) {
    log('Updater unavailable: ' + error.message);
    return { enabled: false, reason: error.message };
  }
}

module.exports = { initUpdater };
