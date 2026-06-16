// PWA wiring check: the app is installable on a phone only if all the pieces
// line up — a valid web manifest, real PNG icons it points at, the <head> links
// + service-worker registration in index.html, a service worker with a fetch
// handler, and a deploy that actually publishes those files (and re-stamps the
// SW so caches refresh). This test guards every one of those joints, since a
// single dropped file (e.g. forgetting manifest.webmanifest in deploy.yml)
// silently breaks "Add to Home Screen". Run with: node test/pwa_check.js
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let fail = 0;
function bad(msg) { console.log('FAIL', msg); fail++; }
function ok(rel) { return fs.existsSync(path.join(root, rel)); }

// ---- the manifest itself ----------------------------------------------------
let mf = null;
try { mf = JSON.parse(read('manifest.webmanifest')); }
catch (e) { bad('manifest.webmanifest is not valid JSON: ' + e.message); }

if (mf) {
  for (const f of ['name', 'short_name', 'start_url', 'display', 'icons']) {
    if (!mf[f]) bad(`manifest missing required field: ${f}`);
  }
  if (mf.short_name && mf.short_name.length > 12) {
    bad(`manifest short_name "${mf.short_name}" > 12 chars (launchers truncate it)`);
  }
  // a landscape-only game (there's a "rotate to landscape" prompt) should say so
  if (mf.orientation !== 'landscape') bad('manifest orientation should be "landscape"');

  // Installability needs PNG icons at 192 and 512 that exist on disk and decode.
  const icons = Array.isArray(mf.icons) ? mf.icons : [];
  for (const size of ['192x192', '512x512']) {
    const icon = icons.find((i) => i.type === 'image/png' && (i.sizes || '').split(' ').includes(size));
    if (!icon) { bad(`manifest has no PNG icon at ${size}`); continue; }
    if (!ok(icon.src)) { bad(`manifest icon missing on disk: ${icon.src}`); continue; }
    const [w] = size.split('x').map(Number);
    const png = fs.readFileSync(path.join(root, icon.src));
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!png.subarray(0, 8).equals(sig)) bad(`${icon.src} is not a PNG`);
    else if (png.readUInt32BE(16) !== w) bad(`${icon.src} width is not ${w}px`);
  }
  // every icon the manifest names must resolve
  for (const i of icons) if (!ok(i.src)) bad(`manifest icon not found: ${i.src}`);
}

// ---- iOS Add-to-Home-Screen needs a PNG apple-touch-icon --------------------
if (!ok('assets/apple-touch-icon.png')) bad('assets/apple-touch-icon.png is missing (iOS home-screen icon)');

// ---- index.html plumbing ----------------------------------------------------
const html = read('index.html');
if (!/<link[^>]+rel="manifest"[^>]+href="manifest\.webmanifest"/.test(html)) {
  bad('index.html does not <link rel="manifest" href="manifest.webmanifest">');
}
if (!/rel="apple-touch-icon"/.test(html)) bad('index.html missing apple-touch-icon link');
if (!/<meta[^>]+name="theme-color"/.test(html)) bad('index.html missing theme-color meta');
if (!/serviceWorker/.test(html) || !/register\(\s*['"]sw\.js['"]/.test(html)) {
  bad('index.html does not register sw.js');
}

// ---- the service worker -----------------------------------------------------
const sw = read('sw.js');
if (!/addEventListener\(\s*['"]fetch['"]/.test(sw)) {
  bad('sw.js has no fetch handler (Chrome needs one to treat the app as offline-capable)');
}
if (!/addEventListener\(\s*['"]install['"]/.test(sw)) bad('sw.js has no install handler');
if (!/addEventListener\(\s*['"]activate['"]/.test(sw)) bad('sw.js has no activate handler');
// the deploy stamps this exact line; if it's renamed, stamping silently no-ops
if (!/const BUILD = '[^']*';/.test(sw)) bad("sw.js missing the `const BUILD = '...'` line stamp-version rewrites");

// the SW precache list shouldn't point at files that don't exist
const shell = (sw.match(/'\.\/[^']*'/g) || []).map((s) => s.slice(3, -1)).filter(Boolean);
for (const rel of shell) if (rel && !ok(rel)) bad(`sw.js precaches a missing file: ${rel}`);

// ---- stamp-version rewrites the SW too --------------------------------------
const stamp = read('tools/stamp-version.js');
if (!/sw\.js/.test(stamp) || !/const BUILD/.test(stamp)) {
  bad('tools/stamp-version.js does not stamp sw.js BUILD (deploys would reuse a stale SW/cache)');
}

// ---- the deploy actually ships the new files --------------------------------
const deploy = read('.github/workflows/deploy.yml');
for (const f of ['manifest.webmanifest', 'sw.js', 'favicon.svg']) {
  if (!deploy.includes(f)) bad(`deploy.yml does not copy ${f} into the published site`);
}

console.log(fail ? 'FAILED (' + fail + ')' : 'OK');
process.exit(fail ? 1 : 0);
