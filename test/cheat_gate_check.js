// The skip cheat is dev-only: it surfaces as a "Skip" main-menu item only on a
// local dev host. This drives the game on a NON-dev host (no hostname) and
// asserts the menu has no "Skip" item, so the level-select overlay can't be
// opened. (The positive case — a dev host, opened from the menu — is skip_check.js.)
// Run with: node test/cheat_gate_check.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fail = 0;
function bad(msg) { console.log('FAIL', msg); fail++; }

const textLog = [];
function makeCtx() {
  const obj = {
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({ setTransform() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    fillText: (t) => { textLog.push(String(t)); },
    canvas: { width: 800, height: 600 },
  };
  return new Proxy(obj, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined;
      return t[p] = () => {};
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}
function makeCanvas() {
  return { width: 0, height: 0, style: {}, getContext: () => makeCtx(),
    addEventListener(type, fn) { (canvasHandlers[type] = canvasHandlers[type] || []).push(fn); } };
}
const canvasHandlers = {};
const windowHandlers = {};
const gameCanvas = makeCanvas();
const clock = { t: 0 };
global.window = {
  innerWidth: 800, innerHeight: 600,
  // a non-dev host (no hostname) — the cheat must stay locked
  location: { search: '' },
  AudioContext: function () { return { currentTime: clock.t, state: 'running',
    get sampleRate() { return 8000; }, destination: {}, resume() {},
    createGain: node, createOscillator: node, createBiquadFilter: node,
    createBufferSource: node, createBuffer: (c, len) => ({ getChannelData: () => new Float32Array(len) }) }; },
  addEventListener(type, fn) { (windowHandlers[type] = windowHandlers[type] || []).push(fn); },
};
function p() { return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {}, setTargetAtTime() {} }; }
function node() { return { type: '', gain: p(), frequency: p(), Q: p(),
  connect() {}, disconnect() {}, start() {}, stop() {}, buffer: null }; }
global.document = { getElementById: () => gameCanvas, createElement: () => makeCanvas() };
global.localStorage = { getItem: () => null, setItem() {} };
global.performance = { now: () => clock.t * 1000 };
const rafQueue = [];
global.requestAnimationFrame = fn => { rafQueue.push(fn); };
global.Image = function () { const img = {}; setImmediate(() => img.onload && img.onload()); return img; };
global.DOMMatrix = function (m) { this.m = m; };
global.matchMedia = () => ({ matches: false });
global.setTimeout = setTimeout;

function pumpFrames(n, dt) {
  for (let i = 0; i < n; i++) { clock.t += dt; const q = rafQueue.splice(0); for (const fn of q) fn(clock.t * 1000); }
}
function key(k) {
  for (const fn of windowHandlers.keydown || []) fn({ key: k, preventDefault() {}, repeat: false });
}
function frameTexts(n) { textLog.length = 0; pumpFrames(n || 3, 1 / 60); return textLog.slice(); }

const code = ['js/assets.js', 'js/levels.js', 'js/physics.js', 'js/render.js',
  'js/music.js', 'js/replay.js', 'js/touch.js', 'js/editor.js', 'js/game.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') + `
(async () => {
  await new Promise(r => setImmediate(r));
  pumpFrames(5, 1 / 60);
  key('Enter');           // loading -> intro
  pumpFrames(3, 1 / 60);
  key('Enter');           // intro -> menu
  let texts = frameTexts(3);
  if (!texts.includes('PLAY')) bad('menu should show PLAY, got: ' + texts.join('|'));
  // on a non-dev host the dev-only "Skip" item must not be in the menu
  if (texts.includes('Skip')) bad('the "Skip" menu item showed on a non-dev host');

  // typing the old s-k-i-p combo must be inert (there is no key combo anymore)
  key('s'); key('k'); key('i'); key('p');
  texts = frameTexts(3);
  if (texts.includes('SKIP TO MAP')) bad('skip overlay opened on a non-dev host');
  if (!texts.includes('PLAY')) bad('menu should still be up after the dud keys');

  // and the menu still works: Enter activates Play -> difficulty
  key('Enter');
  texts = frameTexts(3);
  if (!texts.includes('CHOOSE DIFFICULTY')) {
    bad('menu navigation broke after typing the old cheat keys, got: ' + texts.join('|'));
  }

  console.log(fail ? 'FAILED (' + fail + ')' : 'OK  skip cheat stays locked off a dev host');
  process.exit(fail ? 1 : 0);              // the song scheduler keeps node alive
})().catch(e => { console.log('FAIL exception:', e); process.exit(1); });
`;
eval(code);
