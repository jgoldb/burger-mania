// End-to-end victory-flow test: swaps the Beginner track for two trivial maps
// (goal on the start pad, no burgers) so each finishes on its first sim
// frame, then drives menu -> map 1 -> finished -> map 2 -> victoryFade ->
// victory -> menu, asserting the music handoff (world song -> silence ->
// victory tune -> menu), the scorecard contents (map rows, record stars,
// Back to Menu) and that best times were banked for both maps.
// Run with: node test/victory_check.js
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

function param() {
  return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}, setTargetAtTime() {} };
}
function audioNode() {
  return { type: '', gain: param(), frequency: param(), Q: param(),
    connect() {}, disconnect() {}, start() {}, stop() {}, buffer: null };
}
function FakeAudioContext() {
  return { currentTime: clock.t, state: 'running', get sampleRate() { return 8000; },
    destination: {}, resume() {}, createGain: audioNode, createOscillator: audioNode,
    createBiquadFilter: audioNode, createBufferSource: audioNode,
    createBuffer: (c, len) => ({ getChannelData: () => new Float32Array(len) }) };
}
const clock = { t: 0 };
global.window = {
  innerWidth: 800, innerHeight: 600,
  AudioContext: function () { const ac = FakeAudioContext(); ac.__real = true; lastAC = ac; return ac; },
  addEventListener(type, fn) { (windowHandlers[type] = windowHandlers[type] || []).push(fn); },
};
let lastAC = null;
global.document = { getElementById: () => gameCanvas, createElement: () => makeCanvas() };
// a recording localStorage so banked best times can be asserted
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
global.performance = { now: () => clock.t * 1000 };
const rafQueue = [];
global.requestAnimationFrame = fn => { rafQueue.push(fn); };
global.Image = function () { const img = {}; setImmediate(() => img.onload && img.onload()); return img; };
global.DOMMatrix = function (m) { this.m = m; };
global.matchMedia = () => ({ matches: false });
global.setTimeout = setTimeout;

function pumpFrames(n, dt) {
  for (let i = 0; i < n; i++) {
    clock.t += dt;
    if (lastAC) lastAC.currentTime = clock.t;
    const q = rafQueue.splice(0);
    for (const fn of q) fn(clock.t * 1000);
  }
}
function key(k) {
  for (const fn of windowHandlers.keydown || []) fn({ key: k, preventDefault() {}, repeat: false });
}
function keyUp(k) {
  for (const fn of windowHandlers.keyup || []) fn({ key: k, preventDefault() {}, repeat: false });
}
// clear the lettering log, render a few frames, return the texts drawn
function frameTexts(n) {
  textLog.length = 0;
  pumpFrames(n || 3, 1 / 60);
  return textLog.slice();
}

const code = ['js/assets.js', 'js/levels.js', 'js/physics.js', 'js/render.js',
  'js/music.js', 'js/replay.js', 'js/touch.js', 'js/editor.js', 'js/game.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') + `
let playedNow = null;
const origPlay = MUSIC.play;
MUSIC.play = name => { playedNow = MUSIC.songs[name] ? name : null; origPlay(name); };

// a map the spawn pose immediately finishes: no burgers, goal on the pad
const tiny = name => ({
  name, theme: 'meadow',
  polygons: [[[-5, 0], [40, 0], [40, 9.2], [-5, 9.2]]],
  start: { x: 4, y: 8.3 },
  burgers: [],
  goal: [4, 8.6],
});
TRACKS[0].levels = [tiny('Test A'), tiny('Test B')];
TRACKS[0].length = 2;

(async () => {
  await new Promise(r => setImmediate(r));
  pumpFrames(5, 1 / 60);
  key('Enter');            // loading -> intro
  pumpFrames(3, 1 / 60);
  key('Enter');            // intro -> menu
  pumpFrames(3, 1 / 60);
  key('Enter');            // Play -> difficulty
  pumpFrames(3, 1 / 60);
  key('Enter');            // Beginner -> ready (Test A)
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'meadow') bad('ready should play meadow, got ' + playedNow);

  key('ArrowUp');          // ride: the spawn pose finishes on frame one
  pumpFrames(5, 1 / 60);
  keyUp('ArrowUp');
  if (playedNow !== 'meadow') bad('mid-track finish should keep meadow, got ' + playedNow);
  let texts = frameTexts(3);
  if (!texts.includes('Course completed!')) {
    bad('map 1 should land on the plain finished screen, got: ' + texts.join('|'));
  }
  if (texts.includes('VICTORY!')) bad('no victory screen after a mid-track map');

  key('Enter');            // -> ready (Test B, the last map)
  pumpFrames(3, 1 / 60);
  key('ArrowUp');          // ride: finishes instantly -> victoryFade
  pumpFrames(5, 1 / 60);
  keyUp('ArrowUp');
  pumpFrames(10, 1 / 60);  // a beat into the hold
  if (playedNow !== null) {
    bad('the dissolve should dip the music to silence, got ' + playedNow);
  }
  texts = frameTexts(3);
  if (texts.includes('Course completed!')) {
    bad('the last map must skip the finished screen for the dissolve');
  }
  if (texts.includes('VICTORY!')) {
    bad('mid-dissolve the feast should still be on the buffer, not the screen');
  }

  pumpFrames(340, 1 / 60); // ride out the hold + dissolve (~5.6s)
  texts = frameTexts(3);
  if (!texts.includes('VICTORY!')) bad('victory heading missing, got: ' + texts.join('|'));
  if (!texts.some(t => t.includes('Test A'))) bad('scorecard should list Test A');
  if (!texts.some(t => t.includes('Test B'))) bad('scorecard should list Test B');
  if (!texts.includes('Back to Menu')) bad('victory screen should offer Back to Menu');
  if (!texts.some(t => t.includes('\\u2605'))) bad('fresh records should be starred');
  if (playedNow !== 'victory') bad('victory screen should play victory, got ' + playedNow);
  for (const name of ['Test A', 'Test B']) {
    if (store['burger-mania-best-' + name] == null) {
      bad('best time for ' + name + ' was never banked');
    }
  }

  key('Enter');            // Back to Menu
  texts = frameTexts(3);
  if (playedNow !== 'menu') bad('back at the menu should play menu, got ' + playedNow);
  if (!texts.includes('Play')) bad('should be back on the menu, got: ' + texts.join('|'));

  console.log(fail ? 'FAILED (' + fail + ')' : 'OK');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL exception:', e); process.exit(1); });
`;
eval(code);
