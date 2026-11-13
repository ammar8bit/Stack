// Mini view: shows what the main process sends and forwards three clicks. No timer logic here.
(function () {
  const api = window.stacktimeMini;
  const card = document.getElementById('card');
  const play = document.getElementById('play');
  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'
  };
  const ACTION = { running: 'Pause', paused: 'Resume', idle: 'Start' };
  let shape = '';

  function render(view) {
    document.documentElement.setAttribute('data-theme', view.theme === 'light' ? 'light' : 'dark');
    card.className = 'card ' + view.status + (view.finished ? ' finished' : '');
    document.getElementById('label').textContent = view.label
      + (view.status === 'paused' ? ' · paused' : view.finished ? ' · time is up' : '');
    document.getElementById('time').textContent = view.time;
    document.getElementById('sub').textContent = view.sub || ' ';
    const next = view.status === 'running' ? 'pause' : 'play';
    if (next !== shape) { shape = next; play.innerHTML = ICON[next]; }
    play.title = ACTION[view.status] || 'Start';
    play.setAttribute('aria-label', play.title);
  }

  render({ theme: 'dark', status: 'idle', label: 'Session', time: '00:00:00', sub: '', finished: false });
  api.onView(render);
  play.addEventListener('click', () => api.toggle());
  document.getElementById('open').addEventListener('click', () => api.openMain());
  document.getElementById('hide').addEventListener('click', () => api.hide());
})();
