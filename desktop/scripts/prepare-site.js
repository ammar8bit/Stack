// Copies the website (the single source of truth, one level up) into desktop/site and makes that
// copy work with no internet: the CDN scripts and Google Fonts are swapped for files vendored from
// node_modules. The website itself is never modified by this script.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const desktop = path.resolve(__dirname, '..');
const out = path.join(desktop, 'site');
const modules = path.join(desktop, 'node_modules');

// Only what the timer page actually loads; marketing pages, PDFs and videos stay on the website.
const ASSETS = [
  'favicon.ico', 'favicon-16.png', 'favicon-32.png', 'favicon-48.png',
  'apple-touch-icon.png', 'logo-192.png', 'logo-512.png', 'site.webmanifest'
];
const INTER_WEIGHTS = [200, 300, 400, 500, 600];
// Same unicode ranges Google Fonts serves for these two subsets
const RANGES = {
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'
};

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function replaceOnce(html, pattern, replacement, what) {
  const matches = html.match(new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g')) || [];
  if (matches.length !== 1) {
    throw new Error('prepare-site: expected exactly one ' + what + ' in index.html, found ' + matches.length
      + '. The website changed; update desktop/scripts/prepare-site.js.');
  }
  return html.replace(pattern, replacement);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'vendor', 'fonts'), { recursive: true });

ASSETS.forEach(name => copy(path.join(root, 'assets', name), path.join(out, 'assets', name)));
copy(path.join(modules, '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'), path.join(out, 'vendor', 'supabase.js'));
copy(path.join(modules, 'motion', 'dist', 'motion.js'), path.join(out, 'vendor', 'motion.js'));

let css = '';
function addFont(pkg, family, weight) {
  Object.keys(RANGES).forEach(subset => {
    const file = pkg + '-' + subset + '-' + weight + '-normal.woff2';
    copy(path.join(modules, '@fontsource', pkg, 'files', file), path.join(out, 'vendor', 'fonts', file));
    css += "@font-face{font-family:'" + family + "';font-style:normal;font-weight:" + weight
      + ";font-display:swap;src:url(fonts/" + file + ") format('woff2');unicode-range:" + RANGES[subset] + '}\n';
  });
}
addFont('anton', 'Anton', 400);
INTER_WEIGHTS.forEach(weight => addFont('inter', 'Inter', weight));
fs.writeFileSync(path.join(out, 'vendor', 'fonts.css'), css);

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = replaceOnce(html, /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\r?\n/, '', 'Google Fonts preconnect');
html = replaceOnce(html, /<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\r?\n/, '', 'gstatic preconnect');
html = replaceOnce(html, /<link href="https:\/\/fonts\.googleapis\.com\/css2[^"]*" rel="stylesheet">/,
  '<link href="vendor/fonts.css" rel="stylesheet">', 'Google Fonts stylesheet');
html = replaceOnce(html, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/,
  '<script src="vendor/supabase.js"></script>', 'Supabase script tag');
// The desktop bridge must load before the page's own script so the page can attach to it
html = replaceOnce(html, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/motion@13\.1\.1\/dist\/motion\.js"><\/script>/,
  '<script src="vendor/motion.js"></script>\n<script src="__desktop/bridge.js"></script>', 'Motion script tag');
if (/https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)/.test(html)) {
  throw new Error('prepare-site: index.html still loads something from a CDN; vendor it in prepare-site.js.');
}
if (!html.includes('window.stacktimeDesktop')) {
  throw new Error('prepare-site: index.html has no window.stacktimeDesktop bridge; the desktop app needs it.');
}
fs.writeFileSync(path.join(out, 'index.html'), html);

console.log('Site prepared in ' + path.relative(process.cwd(), out));
