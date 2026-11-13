// Global hotkeys: work while another app is focused. Registration can fail when another program
// already owns the combination, so every hotkey carries a status the settings window can show.
const { globalShortcut } = require('electron');
const { DEFAULT_HOTKEYS } = require('./config');

const ACTIONS = {
  toggleTimer: 'Start / pause the timer',
  toggleMini: 'Show / hide the mini view',
  toggleMain: 'Show / hide the main window'
};
const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Super'];
const KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|[`\-=\[\]\\;',./])$/;

// Accepts only "Mod+Mod+Key" built from known parts, returned in a canonical order
function normalizeAccelerator(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const parts = value.split('+').map(part => part.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key || !KEY.test(key)) return null;
  const mods = MODIFIERS.filter(mod => parts.includes(mod));
  if (mods.length !== parts.length || new Set(parts).size !== parts.length) return null;
  const functionKey = /^F\d+$/.test(key);
  // A bare letter (or Shift+letter) as a global hotkey would swallow normal typing everywhere
  if (!functionKey && !mods.some(mod => mod !== 'Shift')) return null;
  return mods.concat(key).join('+');
}

function createHotkeys(ctx, handlers) {
  const stored = ctx.config.get('hotkeys');
  const state = {};
  Object.keys(ACTIONS).forEach(action => {
    const raw = stored[action];
    const accelerator = raw === '' ? '' : (normalizeAccelerator(raw) || DEFAULT_HOTKEYS[action]);
    state[action] = { accelerator, registered: false };
  });

  function register(action) {
    const entry = state[action];
    entry.registered = false;
    if (!entry.accelerator) return true;
    try {
      entry.registered = globalShortcut.register(entry.accelerator, () => handlers[action]());
    } catch (error) {
      ctx.log('Hotkey ' + entry.accelerator + ' rejected: ' + error.message);
    }
    if (!entry.registered) ctx.log('Hotkey ' + entry.accelerator + ' (' + action + ') is unavailable, probably used by another app');
    return entry.registered;
  }

  function unregister(action) {
    const entry = state[action];
    if (entry.registered) globalShortcut.unregister(entry.accelerator);
    entry.registered = false;
  }

  function save() {
    const out = {};
    Object.keys(state).forEach(action => { out[action] = state[action].accelerator; });
    ctx.config.set('hotkeys', out);
  }

  function set(action, value) {
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) return { ok: false, error: 'Unknown action.' };
    const accelerator = value === '' ? '' : normalizeAccelerator(value);
    if (accelerator === null) return { ok: false, error: 'Use Ctrl, Alt or the Windows key together with a letter, number or function key.' };
    const clash = accelerator && Object.keys(state).find(other => other !== action && state[other].accelerator === accelerator);
    if (clash) return { ok: false, error: 'Already used for "' + ACTIONS[clash] + '".' };

    const previous = state[action].accelerator;
    unregister(action);
    state[action].accelerator = accelerator;
    if (!register(action)) {
      // Keep the working hotkey rather than leaving the action with none
      state[action].accelerator = previous;
      register(action);
      return { ok: false, error: accelerator + ' is already in use by another app. Try a different combination.' };
    }
    save();
    return { ok: true };
  }

  return {
    registerAll() { Object.keys(state).forEach(register); },
    unregisterAll() { globalShortcut.unregisterAll(); Object.keys(state).forEach(action => { state[action].registered = false; }); },
    set,
    reset(action) { return set(action, DEFAULT_HOTKEYS[action]); },
    list() {
      return Object.keys(ACTIONS).map(action => ({
        action, label: ACTIONS[action], accelerator: state[action].accelerator,
        registered: state[action].registered, isDefault: state[action].accelerator === DEFAULT_HOTKEYS[action]
      }));
    },
    acceleratorFor(action) { return state[action].registered ? state[action].accelerator : undefined; }
  };
}

module.exports = { createHotkeys };
