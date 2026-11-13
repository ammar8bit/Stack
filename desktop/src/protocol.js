// Serves the bundled site from app://stacktime/ so it has one stable, secure origin (localStorage
// and the Supabase session persist across restarts) and never depends on the network to load.
const { protocol } = require('electron');
const fs = require('fs');
const path = require('path');

const SCHEME = 'app';
const HOST = 'stacktime';
const ORIGIN = SCHEME + '://' + HOST;
const DESKTOP_PREFIX = '/__desktop/';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json'
};

function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ]);
}

// The page may only talk to its own Supabase project. Read from the bundled page so it can never
// drift from the website.
function readSupabaseHost(siteDir) {
  try {
    const html = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
    const match = /SUPABASE_URL\s*=\s*'https:\/\/([a-z0-9.-]+)'/.exec(html);
    if (match) return match[1];
  } catch (error) {}
  return '';
}

function buildCsp(siteDir) {
  const host = readSupabaseHost(siteDir);
  const connect = host ? "'self' https://" + host + ' wss://' + host : "'self'";
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // the site is a single HTML file with inline script and styles
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    'connect-src ' + connect,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
}

function handleAppProtocol(siteDir, rendererDir) {
  const csp = buildCsp(siteDir);
  const notFound = () => new Response('Not found', { status: 404 });

  protocol.handle(SCHEME, async (request) => {
    let url;
    try { url = new URL(request.url); } catch (error) { return notFound(); }
    if (url.host !== HOST || request.method !== 'GET') return notFound();

    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch (error) { return notFound(); }
    let base = siteDir;
    if (pathname.startsWith(DESKTOP_PREFIX)) {
      base = rendererDir;
      pathname = pathname.slice(DESKTOP_PREFIX.length - 1);
    }
    if (pathname === '/') pathname = '/index.html';

    const file = path.normalize(path.join(base, pathname));
    const type = MIME[path.extname(file).toLowerCase()];
    if (!file.startsWith(base + path.sep) || !type) return notFound();
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, {
        headers: {
          'content-type': type,
          'content-security-policy': csp,
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-cache'
        }
      });
    } catch (error) {
      return notFound();
    }
  });
}

function isAppUrl(url) {
  return typeof url === 'string' && (url === ORIGIN || url.startsWith(ORIGIN + '/'));
}

module.exports = { registerScheme, handleAppProtocol, isAppUrl, ORIGIN };
