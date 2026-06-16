#!/usr/bin/env node
'use strict';

// Tiny zero-dependency static file server for local development.
//
//   node tools/serve.js          # serve the repo at http://localhost:8080
//   PORT=3000 node tools/serve.js
//   npm start                    # same thing
//
// The game reads its levels from levels/*.bmm with fetch(), and browsers block
// fetch() of file:// URLs (CORS), so the game has to be served over http during
// development. This serves the repo root with no caching (so edits — including
// re-saved .bmm maps — show on a plain reload) and the right content types
// (notably application/json for .bmm). The deployed site is GitHub Pages, which
// serves the same files over https, so this is a dev convenience only.

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const root = path.join(__dirname, '..');
const port = parseInt(process.env.PORT || '8080', 10);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bmm': 'application/json; charset=utf-8',   // Burger Mania maps are JSON
  '.bmr': 'application/octet-stream',          // replay tapes
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(url.parse(req.url).pathname);
  } catch (e) {
    res.writeHead(400); res.end('bad request'); return;
  }
  if (pathname === '/') pathname = '/index.html';

  // resolve under root and refuse anything that escapes it (path traversal)
  const filePath = path.join(root, pathname);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.writeHead(403); res.end('forbidden'); return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 not found: ' + pathname);
      return;
    }
    const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, () => {
  console.log('Burger Mania dev server: http://localhost:' + port + '/');
  console.log('(serving ' + root + ' — Ctrl+C to stop)');
});
