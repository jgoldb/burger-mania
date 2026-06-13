#!/usr/bin/env node
// Stamp a cache-busting version token onto the <script src="js/*.js"> tags in
// index.html, so a freshly deployed build never serves stale cached JS.
//
//   node tools/stamp-version.js          # token = short git SHA of HEAD
//   node tools/stamp-version.js 1.4.0    # token = an explicit string
//
// The Pages deploy workflow (.github/workflows/deploy.yml) runs this on every
// push to main and publishes the stamped copy, so you normally never run it by
// hand — committed source stays query-free. Run it manually only to preview a
// stamped build locally. Browsers cache JS by URL, so changing ?v=… forces a
// refetch; GitHub Pages serves index.html itself with a short TTL + ETag, so
// returning visitors revalidate the HTML within minutes and then pull the new
// JS URLs. See the "Deploying" section of README.md.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'index.html');

function token() {
  if (process.argv[2]) return process.argv[2];
  try {
    return execSync('git rev-parse --short=10 HEAD', { cwd: root })
      .toString().trim();
  } catch (e) {
    // No git (or no commits yet) — fall back to a UTC timestamp so the token
    // still changes every run.
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
         + `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  }
}

const v = token();
const html = fs.readFileSync(htmlPath, 'utf8');

let count = 0;
const out = html.replace(
  /(src="js\/[\w.-]+\.js)(\?v=[^"]*)?"/g,
  (_, base) => { count++; return `${base}?v=${v}"`; }
);

if (!count) {
  console.error('stamp-version: no <script src="js/*.js"> tags found in index.html');
  process.exit(1);
}

fs.writeFileSync(htmlPath, out);
console.log(`stamp-version: set ?v=${v} on ${count} script tag(s) in index.html`);
