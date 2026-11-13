// Client for the dev test harness:  node test/ctl.js <cmd> [json-args | @file-with-json-args]
const fs = require('fs');
const [cmd, raw] = process.argv.slice(2);
const args = !raw ? {} : JSON.parse(raw.startsWith('@') ? fs.readFileSync(raw.slice(1), 'utf8') : raw);
fetch('http://127.0.0.1:' + (process.env.STACKTIME_TEST_PORT || 47821), {
  method: 'POST',
  body: JSON.stringify({ cmd, args })
}).then(response => response.json()).then(out => {
  console.log(JSON.stringify(out.ok ? out.result : out, null, 1));
  if (!out.ok) process.exit(1);
}).catch(error => {
  console.error('harness unreachable: ' + error.message);
  process.exit(2);
});
