// Small JSON settings store in the app's userData folder (no dependency needed for this).
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  windowBounds: null,
  windowMaximized: false,
  miniBounds: null,
  miniVisible: false,
  hotkeys: { toggleTimer: 'Ctrl+Alt+S', toggleMini: 'Ctrl+Alt+V', toggleMain: 'Ctrl+Alt+T' },
  trayHintShown: false
};

function createConfig(dir, log) {
  const file = path.join(dir, 'config.json');
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
  } catch (error) {
    if (error.code !== 'ENOENT') log('Config unreadable, using defaults: ' + error.message);
  }
  data.hotkeys = Object.assign({}, DEFAULTS.hotkeys, data.hotkeys && typeof data.hotkeys === 'object' ? data.hotkeys : {});

  let timer = null;
  function flush() {
    clearTimeout(timer);
    timer = null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const temp = file + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(data, null, 2));
      fs.renameSync(temp, file);
    } catch (error) { log('Config save failed: ' + error.message); }
  }

  return {
    get(key) { return data[key] !== undefined ? data[key] : DEFAULTS[key]; },
    set(key, value) {
      data[key] = value;
      if (!timer) timer = setTimeout(flush, 300);
    },
    flush() { if (timer) flush(); }
  };
}

module.exports = { createConfig, DEFAULT_HOTKEYS: DEFAULTS.hotkeys };
