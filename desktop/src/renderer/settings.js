// Desktop settings window: record global hotkeys and toggle launch on startup.
(function () {
  const api = window.stacktimeSettings;
  const list = document.getElementById('hotkeys');
  const startup = document.getElementById('startup');
  let recording = null; // action currently waiting for a key press
  let notes = {};       // action -> { text, bad } shown under its row until the next change
  let settings = null;

  const SPECIAL = {
    ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete'
  };
  const PUNCTUATION = '`-=[]\\;\',./';

  function acceleratorFrom(event) {
    let key = '';
    if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
    else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) key = event.key;
    else if (SPECIAL[event.key]) key = SPECIAL[event.key];
    else if (event.key.length === 1 && PUNCTUATION.includes(event.key)) key = event.key;
    if (!key) return '';
    const mods = [];
    if (event.ctrlKey) mods.push('Ctrl');
    if (event.altKey) mods.push('Alt');
    if (event.shiftKey) mods.push('Shift');
    if (event.metaKey) mods.push('Super');
    return mods.concat(key).join('+');
  }

  const pretty = accelerator => accelerator.replace('Super', 'Win').split('+').join(' + ');

  function render() {
    list.textContent = '';
    settings.hotkeys.forEach(hotkey => {
      const row = document.createElement('div');
      row.className = 'row';
      const top = document.createElement('div');
      top.className = 'row-top';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = hotkey.label;
      const keys = document.createElement('div');
      keys.className = 'keys';
      const combo = document.createElement('button');
      combo.type = 'button';
      combo.dataset.action = hotkey.action;
      combo.className = 'combo' + (recording === hotkey.action ? ' recording' : '');
      combo.textContent = recording === hotkey.action ? 'Press keys…' : (hotkey.accelerator ? pretty(hotkey.accelerator) : 'Not set');
      combo.title = 'Click, then press the new key combination. Esc cancels, Backspace clears.';
      combo.addEventListener('click', () => {
        recording = recording === hotkey.action ? null : hotkey.action;
        notes = {};
        render();
      });
      keys.append(combo);
      if (!hotkey.isDefault) {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'link';
        reset.textContent = 'Reset';
        reset.addEventListener('click', async () => {
          recording = null;
          apply(hotkey.action, await api.resetHotkey(hotkey.action));
        });
        keys.append(reset);
      }
      top.append(name, keys);
      const note = document.createElement('div');
      const custom = notes[hotkey.action];
      if (custom) {
        note.className = 'note ' + (custom.bad ? 'bad' : 'good');
        note.textContent = custom.text;
      } else if (hotkey.accelerator && !hotkey.registered) {
        note.className = 'note bad';
        note.textContent = 'Not working: another app is using this combination. Pick a different one.';
      } else {
        note.className = 'note';
        note.textContent = hotkey.accelerator ? '' : 'No hotkey set for this action.';
      }
      row.append(top, note);
      list.append(row);
    });
    startup.checked = settings.launchAtStartup;
    startup.disabled = !settings.canLaunchAtStartup;
    document.getElementById('startupNote').textContent = settings.canLaunchAtStartup
      ? 'Starts quietly in the tray.'
      : 'Available in the installed app (not in a development run).';
    document.getElementById('version').textContent = 'StackTime for Windows ' + settings.version;
  }

  function apply(action, result) {
    if (!result) return;
    settings = result;
    notes = {};
    notes[action] = result.ok ? { text: 'Saved.', bad: false } : { text: result.error, bad: true };
    render();
  }

  window.addEventListener('keydown', async (event) => {
    if (!recording) return;
    event.preventDefault();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return; // still holding modifiers
    const action = recording;
    recording = null;
    if (event.key === 'Escape') { render(); return; }
    const clearing = event.key === 'Backspace';
    const accelerator = clearing ? '' : acceleratorFrom(event);
    if (!accelerator && !clearing) {
      notes = {};
      notes[action] = { text: 'That key cannot be used as a hotkey.', bad: true };
      render();
      return;
    }
    apply(action, await api.setHotkey(action, accelerator));
  });

  startup.addEventListener('change', async () => {
    settings = await api.setStartup(startup.checked);
    render();
  });
  api.onChanged(payload => { settings = payload; render(); });
  api.get().then(payload => { settings = payload; render(); });
})();
