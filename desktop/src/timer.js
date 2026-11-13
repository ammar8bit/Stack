// The main process holds the latest timer snapshot published by the page and derives everything the
// tray and mini view show from its timestamps. Nothing here counts ticks, so the numbers cannot
// drift: after sleep, a busy CPU or an hour in the tray they are still "now minus start time".
// The maths mirrors liveSessionMs()/updateDisplay() in index.html.

const num = value => (typeof value === 'number' && isFinite(value) ? value : 0);
const flag = value => value === true;

function sanitizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const frozen = raw.frozen && typeof raw.frozen === 'object' ? raw.frozen : null;
  const frozenValue = key => (frozen && typeof frozen[key] === 'number' && isFinite(frozen[key]) && frozen[key] >= 0 ? frozen[key] : null);
  return {
    mode: ['session', 'question', 'countdown'].includes(raw.mode) ? raw.mode : 'session',
    theme: raw.theme === 'light' ? 'light' : 'dark',
    sessionRunning: flag(raw.sessionRunning), sessionStartTime: num(raw.sessionStartTime), sessionElapsed: num(raw.sessionElapsed),
    questionRunning: flag(raw.questionRunning), questionStartTime: num(raw.questionStartTime), questionElapsed: num(raw.questionElapsed),
    countdownRunning: flag(raw.countdownRunning), countdownStartTime: num(raw.countdownStartTime),
    countdownInitialMs: num(raw.countdownInitialMs), countdownFinished: flag(raw.countdownFinished),
    paused: flag(raw.paused), pauseStart: num(raw.pauseStart),
    frozen: frozen ? { session: frozenValue('session'), question: frozenValue('question'), countdown: frozenValue('countdown') } : null,
    totalMs: num(raw.totalMs), todayMs: num(raw.todayMs),
    lastStudyDate: typeof raw.lastStudyDate === 'string' ? raw.lastStudyDate.slice(0, 10) : '',
    hasGoal: flag(raw.hasGoal),
    dailyGoalHours: typeof raw.dailyGoalHours === 'number' && isFinite(raw.dailyGoalHours) ? raw.dailyGoalHours : null
  };
}

function clock(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const pad = n => String(n).padStart(2, '0');
  return pad(Math.floor(total / 3600)) + ':' + pad(Math.floor((total % 3600) / 60)) + ':' + pad(total % 60);
}

function todayString(now) {
  const d = new Date(now);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const MODE_LABEL = { session: 'Session', question: 'Practice', countdown: 'Timer' };

function computeView(s, now) {
  if (!s) {
    return { mode: 'session', label: 'Session', status: 'idle', time: '00:00:00', sub: '', tooltip: 'StackTime', action: 'Start', theme: 'dark', finished: false };
  }
  const at = s.paused && s.pauseStart ? s.pauseStart : now;
  const frozen = (key, running) => (s.paused && running && s.frozen && s.frozen[key] !== null ? s.frozen[key] : null);
  const live = (key, running, elapsed, start) => {
    const value = frozen(key, running);
    return value !== null ? value : (running ? elapsed + (at - start) : elapsed);
  };
  const sessionMs = live('session', s.sessionRunning, s.sessionElapsed, s.sessionStartTime);
  const questionMs = live('question', s.questionRunning, s.questionElapsed, s.questionStartTime);
  let countdownMs = s.countdownFinished ? 0 : s.countdownInitialMs;
  if (s.countdownRunning) {
    const value = frozen('countdown', true);
    countdownMs = value !== null ? value : Math.max(0, s.countdownInitialMs - (at - s.countdownStartTime));
  }

  const anyRunning = s.sessionRunning || s.questionRunning || s.countdownRunning;
  const status = anyRunning ? (s.paused ? 'paused' : 'running') : 'idle';
  const primary = s.mode === 'question' ? questionMs : s.mode === 'countdown' ? countdownMs : sessionMs;
  const time = clock(primary);
  const label = MODE_LABEL[s.mode];

  const todayMs = (s.lastStudyDate === todayString(now) ? s.todayMs : 0) + sessionMs;
  const todayHours = (todayMs / 3600000).toFixed(1);
  const sub = s.hasGoal && s.dailyGoalHours !== null
    ? 'Today ' + todayHours + ' / ' + s.dailyGoalHours.toFixed(1) + 'h'
    : 'Today ' + todayHours + 'h';

  const finished = s.mode === 'countdown' && s.countdownFinished && !s.countdownRunning;
  const stateWord = finished ? 'time is up' : status === 'running' ? 'running' : status === 'paused' ? 'paused' : 'not running';
  return {
    mode: s.mode, label, status, time, sub, finished, theme: s.theme,
    tooltip: 'StackTime — ' + label + ' ' + time + ' (' + stateWord + ')\n' + sub,
    action: status === 'running' ? 'Pause' : status === 'paused' ? 'Resume' : 'Start'
  };
}

module.exports = { sanitizeSnapshot, computeView };
