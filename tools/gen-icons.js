#!/usr/bin/env node
// Generate the PWA / home-screen icons from scratch — no image libraries, just
// Node's built-in zlib for the PNG encoder. We draw the same triple
// cheeseburger as favicon.svg (sesame bun, two cheese-dripped patties, bottom
// bun) onto a warm full-bleed background, supersampled for clean edges.
//
//   node tools/gen-icons.js
//
// Writes:
//   assets/icon-192.png        192x192  (manifest, purpose "any maskable")
//   assets/icon-512.png        512x512  (manifest, purpose "any maskable")
//   assets/apple-touch-icon.png 180x180 (iOS Add-to-Home-Screen)
//
// The burger sits inside the central ~72% of the square so it survives Android's
// maskable crop; the background bleeds to every edge so masked icons show no
// transparent corners. Re-run this whenever favicon.svg's look changes.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');

// ---- minimal PNG encoder (RGBA, 8-bit) --------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  // 10,11,12 = compression/filter/interlace = 0
  // raw image: one filter byte (0 = None) per scanline
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- colour helpers ---------------------------------------------------------
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16),
                    parseInt(s.slice(5, 7), 16)];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
                           a[2] + (b[2] - a[2]) * t];
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

const C = {
  domeTop: hex('#ffd98f'), domeBot: hex('#c4863c'), domeLine: hex('#9a6526'),
  cheeseTop: hex('#ffe066'), cheeseBot: hex('#e8bf2e'),
  pattyTop: hex('#7a4423'), pattyBot: hex('#4f2c14'),
  bunTop: hex('#f0bd6b'), bunBot: hex('#b9802f'), bunGloss: hex('#ffebbe'),
  seed: hex('#fdf3d3'),
  bgTop: hex('#2b1809'), bgBot: hex('#140b03'),
};

// ---- shape tests, all in favicon 64-unit space ------------------------------
function rrect(x, y, X, Y, w, h, r) {
  if (x < X || x > X + w || y < Y || y > Y + h) return false;
  const dx = Math.min(x - X, X + w - x), dy = Math.min(y - Y, Y + h - y);
  if (dx >= r || dy >= r) return true;            // along the straight edges
  return (r - dx) * (r - dx) + (r - dy) * (r - dy) <= r * r; // rounded corner
}
const ellipse = (x, y, cx, cy, rx, ry) => {
  const a = (x - cx) / rx, b = (y - cy) / ry; return a * a + b * b <= 1;
};
function dome(x, y) {                              // upper half of a circle
  if (y > 31) return false;
  return ellipse(x, y, 32, 31, 24, 24);
}
function cheese(x, y, bandY) {                     // 3-tall band + hanging drips
  if (rrect(x, y, 6, bandY, 52, 3, 1.2)) return true;
  for (const cx of [12, 22, 32, 42, 52]) if (ellipse(x, y, cx, bandY + 3, 2.3, 2.3)) return true;
  return false;
}
const SEEDS = [[22, 22, 2.2, 1.2], [32, 16, 2.2, 1.2], [43, 21, 2.2, 1.2],
               [27, 27, 2, 1.1], [38, 27, 2, 1.1], [32, 24, 2, 1.1]];

// Front-to-back: first hit wins (so it reads as the painter's stack). Returns
// an [r,g,b] colour, or null to let the background show through.
function colorAt(x, y) {
  for (const [cx, cy, rx, ry] of SEEDS) if (ellipse(x, y, cx, cy, rx, ry)) return C.seed;
  if (rrect(x, y, 8, 29.5, 48, 2.5, 0)) return C.domeLine;
  if (dome(x, y)) return lerp(C.domeTop, C.domeBot, clamp01((y - 7) / 24));
  if (cheese(x, y, 30)) return lerp(C.cheeseTop, C.cheeseBot, clamp01((y - 30) / 5));
  if (rrect(x, y, 5, 32, 54, 8, 3.5)) return lerp(C.pattyTop, C.pattyBot, clamp01((y - 32) / 8));
  if (cheese(x, y, 38)) return lerp(C.cheeseTop, C.cheeseBot, clamp01((y - 38) / 5));
  if (rrect(x, y, 5, 40, 54, 8, 3.5)) return lerp(C.pattyTop, C.pattyBot, clamp01((y - 40) / 8));
  if (ellipse(x, y, 32, 48.5, 22, 1.7)) return C.bunGloss;
  if (rrect(x, y, 7, 46, 50, 13, 6)) return lerp(C.bunTop, C.bunBot, clamp01((y - 46) / 13));
  return null;
}

// ---- rasterise --------------------------------------------------------------
function render(N, fill) {
  const SS = 4;                                   // supersample for anti-aliasing
  const s = (fill * N) / 54;                       // 54 fav-units of width -> fill*N px
  const rgba = Buffer.alloc(N * N * 4);
  for (let Y = 0; Y < N; Y++) {
    const bg = lerp(C.bgTop, C.bgBot, Y / (N - 1));
    for (let X = 0; X < N; X++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
        const sx = X + (i + 0.5) / SS, sy = Y + (j + 0.5) / SS;
        const fx = (sx - N / 2) / s + 32, fy = (sy - N / 2) / s + 33;
        const c = colorAt(fx, fy) || bg;
        r += c[0]; g += c[1]; b += c[2];
      }
      const n = SS * SS, o = (Y * N + X) * 4;
      rgba[o] = Math.round(r / n); rgba[o + 1] = Math.round(g / n);
      rgba[o + 2] = Math.round(b / n); rgba[o + 3] = 255;
    }
  }
  return encodePNG(N, N, rgba);
}

const outputs = [
  ['assets/icon-192.png', 192, 0.72],
  ['assets/icon-512.png', 512, 0.72],
  ['assets/apple-touch-icon.png', 180, 0.80],
];
for (const [rel, N, fill] of outputs) {
  const p = path.join(root, rel);
  fs.writeFileSync(p, render(N, fill));
  console.log(`gen-icons: wrote ${rel} (${N}x${N})`);
}
