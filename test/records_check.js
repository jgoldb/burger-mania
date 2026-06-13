// Best Records flow test: seeds a couple of per-map best-time/best-style
// localStorage keys, then drives menu -> Records -> track picker -> scorecard,
// asserting the scorecard reads those stored bests (formatted time, style,
// dashes for unplayed maps), shows no total/stars on a partly-cleared track,
// and that Escape walks back picker -> menu. Guards the menu-index navigation
// and the localStorage wiring behind the screen. Run with: node test/records_check.js
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

const code = ['js/assets.js', 'js/levels.js', 'js/physics.js', 'js/render.js',
  'js/music.js', 'js/replay.js', 'js/touch.js', 'js/editor.js', 'js/game.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') + `
(async () => {
  await new Promise(r => setImmediate(r));
  // seed bests for the first two Beginner maps; leave the rest blank
  const beginner = TRACKS[0].levels;
  store['burger-mania-best-' + beginner[0].name] = '83.45';
  store['burger-mania-style-' + beginner[0].name] = '1200';
  store['burger-mania-best-' + beginner[1].name] = '90.10'; // no style key: should read 0

  pumpFrames(5, 1 / 60);
  key('Enter');            // loading -> intro
  pumpFrames(3, 1 / 60);
  key('Enter');            // intro -> menu
  pumpFrames(3, 1 / 60);
  let texts = frameTexts(3);
  if (!texts.includes('Records')) bad('menu missing the Records option: ' + texts.join('|'));

  key('ArrowDown'); key('ArrowDown'); key('ArrowDown'); // Play -> ... -> Records
  key('Enter');            // -> recordsDiff (track picker)
  pumpFrames(6, 1 / 60);
  texts = frameTexts(3);
  if (!texts.includes('BEST RECORDS')) bad('records track picker missing heading: ' + texts.join('|'));
  if (!texts.includes('Beginner')) bad('records picker should list Beginner');
  if (!texts.includes('Coming soon')) bad('disabled tracks should read Coming soon');

  key('Enter');            // Beginner -> records scorecard
  pumpFrames(6, 1 / 60);
  texts = frameTexts(3);
  if (!texts.includes('BEST RECORDS')) bad('scorecard missing heading');
  if (!texts.some(t => t.includes('Beginner track'))) bad('scorecard missing track subtitle');
  if (!texts.some(t => t.includes(beginner[0].name))) bad('scorecard should list map 1: ' + beginner[0].name);
  if (!texts.includes('Back')) bad('scorecard should offer a Back button');
  if (!texts.includes('01:23,45')) bad('map 1 best time not shown, got: ' + texts.join('|'));
  if (!texts.includes('1200')) bad('map 1 best style not shown');
  if (!texts.includes('01:30,10')) bad('map 2 best time not shown');
  if (!texts.includes('--:--,--')) bad('unplayed maps should show time dashes');
  if (!texts.includes('---')) bad('unplayed maps should show style dashes');
  if (texts.includes('total')) bad('a partly-cleared track should not show a total row');
  if (texts.some(t => t.includes('\\u2605'))) bad('records screen should never star anything');

  key('Escape');           // back to the track picker
  pumpFrames(3, 1 / 60);
  texts = frameTexts(3);
  if (!texts.includes('Beginner')) bad('Escape from scorecard should return to the picker');
  key('Escape');           // back to the menu
  pumpFrames(3, 1 / 60);
  texts = frameTexts(3);
  if (!texts.includes('Play')) bad('Escape from picker should return to the menu');

  console.log(fail ? 'FAILED (' + fail + ')' : 'OK');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL exception:', e); process.exit(1); });
`;
eval(code);
