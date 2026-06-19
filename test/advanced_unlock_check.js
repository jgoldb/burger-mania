// Advanced-track unlock gate: drives menu -> Choose Difficulty and asserts the
// Advanced track reads as LOCKED (a "Clear Beginner to unlock" line, NOT "Coming
// soon") while Beginner is uncleared, then — after banking Beginner's cleared
// flag (the same flag a track win sets) — re-enters the screen and asserts
// Advanced is now playable ("20 maps", no lock line). Expert stays "Coming soon"
// throughout (no maps yet, even though it's gated behind Advanced).
// Run with: node test/advanced_unlock_check.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fail = 0;
function bad(msg) { console.log('FAIL', msg); fail++; }

const textLog = [];
function makeCtx() {
  const obj = { measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({ setTransform() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    fillText: (t) => { textLog.push(String(t)); },
    canvas: { width: 800, height: 600 } };
  return new Proxy(obj, { get(t, p) { if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined; return t[p] = () => {}; },
    set(t, p, v) { t[p] = v; return true; } });
}
function makeCanvas() {
  return { width: 0, height: 0, style: {}, getContext: () => makeCtx(),
    addEventListener(type, fn) { (canvasHandlers[type] = canvasHandlers[type] || []).push(fn); } };
}
const canvasHandlers = {};
const windowHandlers = {};
const gameCanvas = makeCanvas();
function param() { return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {}, setTargetAtTime() {} }; }
function audioNode() { return { type: '', gain: param(), frequency: param(), Q: param(),
  connect() {}, disconnect() {}, start() {}, stop() {}, buffer: null }; }
function FakeAudioContext() { return { currentTime: clock.t, state: 'running',
  get sampleRate() { return 8000; }, destination: {}, resume() {}, createGain: audioNode,
  createOscillator: audioNode, createBiquadFilter: audioNode, createBufferSource: audioNode,
  createBuffer: (c, len) => ({ getChannelData: () => new Float32Array(len) }) }; }
const clock = { t: 0 };
global.window = { innerWidth: 800, innerHeight: 600,
  AudioContext: function () { const ac = FakeAudioContext(); lastAC = ac; return ac; },
  addEventListener(type, fn) { (windowHandlers[type] = windowHandlers[type] || []).push(fn); } };
let lastAC = null;
global.document = { getElementById: () => gameCanvas, createElement: () => makeCanvas() };
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); } };
global.performance = { now: () => clock.t * 1000 };
const rafQueue = [];
global.requestAnimationFrame = fn => { rafQueue.push(fn); };
global.Image = function () { const img = {}; setImmediate(() => img.onload && img.onload()); return img; };
global.DOMMatrix = function (m) { this.m = m; };
global.matchMedia = () => ({ matches: false });
global.setTimeout = setTimeout;

function pumpFrames(n, dt) {
  for (let i = 0; i < n; i++) { clock.t += dt; if (lastAC) lastAC.currentTime = clock.t;
    const q = rafQueue.splice(0); for (const fn of q) fn(clock.t * 1000); }
}
function key(k) { for (const fn of windowHandlers.keydown || []) fn({ key: k, preventDefault() {}, repeat: false }); }
function frameTexts(n) { textLog.length = 0; pumpFrames(n || 3, 1 / 60); return textLog.slice(); }
function count(arr, s) { return arr.filter(t => t === s).length; }

const code = ['js/assets.js', 'js/levels.js', 'js/physics.js', 'js/render.js',
  'js/music.js', 'js/replay.js', 'js/touch.js', 'js/editor.js', 'js/game.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') + `
(async () => {
  await new Promise(r => setImmediate(r));
  pumpFrames(5, 1 / 60);
  key('Enter');            // loading -> intro
  pumpFrames(3, 1 / 60);
  key('Enter');            // intro -> menu
  pumpFrames(3, 1 / 60);

  // --- Beginner NOT cleared: Advanced is locked, not coming-soon ---
  key('Enter');            // Play (the hero, menuSel 0) -> Choose Difficulty
  pumpFrames(4, 1 / 60);
  let texts = frameTexts(1);
  if (!texts.includes('CHOOSE DIFFICULTY')) bad('difficulty screen missing title: ' + texts.join('|'));
  if (!texts.includes('Beginner')) bad('Beginner track missing from the difficulty screen');
  if (!texts.includes('10 maps')) bad('Beginner should read "10 maps"');
  if (!texts.includes('Advanced')) bad('Advanced track missing from the difficulty screen');
  if (!texts.includes('Clear Beginner to unlock')) {
    bad('locked Advanced should prompt to clear Beginner, got: ' + texts.join('|'));
  }
  if (texts.includes('20 maps')) bad('a LOCKED Advanced must not advertise its map count');
  if (!texts.includes('Expert')) bad('Expert track missing from the difficulty screen');
  // exactly one "Coming soon" — Expert. Advanced must NOT be coming-soon.
  if (count(texts, 'Coming soon') !== 1) {
    bad('expected exactly one "Coming soon" (Expert), got ' + count(texts, 'Coming soon') + ': ' + texts.join('|'));
  }

  key('Escape');           // back to the menu
  pumpFrames(3, 1 / 60);

  // --- bank Beginner's cleared flag (what a track win sets) and re-enter ---
  store['burger-mania-cleared-beginner'] = '1';
  key('Enter');            // Play -> Choose Difficulty again
  pumpFrames(4, 1 / 60);
  texts = frameTexts(1);
  if (!texts.includes('Advanced')) bad('Advanced track vanished after the unlock');
  if (!texts.includes('20 maps')) bad('cleared-Beginner should unlock Advanced as "20 maps", got: ' + texts.join('|'));
  if (texts.includes('Clear Beginner to unlock')) bad('unlocked Advanced should drop the lock prompt');
  // Expert is still mapless, so it stays coming-soon even though Advanced unlocked
  if (!texts.includes('Coming soon')) bad('Expert should still read "Coming soon"');
  if (texts.includes('Clear Advanced to unlock')) bad('mapless Expert should show "Coming soon", not its lock line');

  console.log(fail ? 'FAILED (' + fail + ')' : 'OK');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL exception:', e); process.exit(1); });
`;
eval(code);
