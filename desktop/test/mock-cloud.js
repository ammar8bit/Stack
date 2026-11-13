// Development-only fake of the Supabase endpoints StackTime uses (auth + the user_progress table).
// Enabled with STACKTIME_TEST_MOCK=1 next to the test harness, so sign-in, cloud sync, offline
// queueing and "another device changed my account" can be tested end to end without touching the
// real project or creating real accounts. Never loaded in a packaged build.
const { protocol, net, session } = require('electron');

module.exports = function startMockCloud(log) {
  const state = {
    offline: false,
    user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'tester@example.test', app_metadata: {}, user_metadata: {} },
    rows: {},          // user_id -> { data, updated_at }
    requests: [],      // "METHOD /path" log for assertions
    writes: 0
  };

  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  function sessionBody() {
    const now = Math.floor(Date.now() / 1000);
    const token = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: state.user.id, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now }) + '.mock';
    return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'mock-refresh', user: state.user };
  }
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-expose-headers': '*'
  };
  const json = (body, status) => new Response(body === null ? null : JSON.stringify(body), {
    status: status || 200, headers: Object.assign({ 'content-type': 'application/json' }, cors)
  });

  protocol.handle('https', async (request) => {
    const url = new URL(request.url);
    if (!url.hostname.endsWith('.supabase.co')) return net.fetch(request, { bypassCustomProtocolHandlers: true });
    if (state.offline) return Response.error();
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    state.requests.push(request.method + ' ' + url.pathname + (url.searchParams.get('grant_type') ? '?grant_type=' + url.searchParams.get('grant_type') : ''));
    if (state.requests.length > 200) state.requests.shift();

    if (url.pathname === '/auth/v1/token') {
      const body = await request.json().catch(() => ({}));
      const grant = url.searchParams.get('grant_type');
      if (grant === 'pkce' && (!body.auth_code || !body.code_verifier)) return json({ error: 'invalid_grant', error_description: 'missing code or verifier' }, 400);
      if (grant === 'pkce') state.lastPkce = { code: body.auth_code, verifierLength: String(body.code_verifier).length };
      return json(sessionBody());
    }
    if (url.pathname === '/auth/v1/user') return json(state.user);
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/rest/v1/user_progress') {
      if (request.method === 'GET') {
        const row = state.rows[state.user.id];
        const single = (request.headers.get('accept') || '').includes('vnd.pgrst.object');
        if (single) return row ? json(row) : json({ code: 'PGRST116', message: 'no rows' }, 406);
        return json(row ? [row] : []);
      }
      const body = await request.json();
      const record = Array.isArray(body) ? body[0] : body;
      state.rows[record.user_id] = { data: record.data, updated_at: record.updated_at };
      state.writes++;
      return new Response(null, { status: 201, headers: cors });
    }
    return json({ message: 'mock: not implemented ' + url.pathname }, 404);
  });
  log('Mock cloud active: Supabase requests are answered locally');

  return {
    setOffline(on) {
      state.offline = Boolean(on);
      // Also flips navigator.onLine and fires the page's online/offline events
      session.defaultSession.enableNetworkEmulation({ offline: state.offline });
    },
    get() { return { row: state.rows[state.user.id] || null, writes: state.writes, requests: state.requests.slice(-25), lastPkce: state.lastPkce || null }; },
    // Simulates another device saving to the same account
    setRow(data) { state.rows[state.user.id] = { data, updated_at: new Date().toISOString() }; return true; }
  };
};
