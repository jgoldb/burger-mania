// Drives the "skip" cheat's level-select overlay black-box: opens it from
// the menu, observes the captured fillText headings and the song the music
// module plays to check it scrolls, dismisses on Escape, and jumps to the
// picked map. Complements game_smoke.js (which opens it mid-game).
// Run with: node test/skip_check.js
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
  // the skip cheat is gated behind ?skip=true in the URL; this test drives it
  location: { search: '?skip=true' },
  AudioContext: function () { const ac = FakeAudioContext(); ac.__real = true; lastAC = ac; return ac; },
  addEventListener(type, fn) { (windowHandlers[type] = windowHandlers[type] || []).push(fn); },
};
let lastAC = null;
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
// clear the heading log, render a few frames, return the texts drawn
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

(async () => {
  await new Promise(r => setImmediate(r));
  pumpFrames(5, 1 / 60);
  key('Enter');           // loading -> intro
  pumpFrames(3, 1 / 60);
  key('Enter');           // intro -> menu
  let texts = frameTexts(3);
  if (!texts.includes('Play')) bad('menu should show Play button, got: ' + texts.join('|'));
  if (texts.includes('SKIP TO MAP')) bad('skip overlay should not be up at the menu');

  // open the picker from the menu (no track active yet)
  key('s'); key('k'); key('i'); key('p');
  texts = frameTexts(3);
  if (!texts.includes('SKIP TO MAP')) bad('skip overlay heading missing after cheat');
  if (playedNow !== 'menu') bad('skip from menu should play menu song, got ' + playedNow);

  // navigate down past the visible window (10 maps, 6 visible -> scrolls),
  // then back up; must not throw and overlay stays up
  for (let i = 0; i < 7; i++) key('ArrowDown');
  for (let i = 0; i < 2; i++) key('ArrowUp');
  texts = frameTexts(3);
  if (!texts.includes('SKIP TO MAP')) bad('overlay should stay up while navigating');
  if (!texts.includes('- more -')) bad('a 10-map list scrolled down should show a -more- marker');

  // Escape dismisses the overlay back to the menu it came from
  key('Escape');
  texts = frameTexts(3);
  if (texts.includes('SKIP TO MAP')) bad('Escape should close the skip overlay');
  if (!texts.includes('Play')) bad('Escape from skip(menu) should return to the menu');
  if (playedNow !== 'menu') bad('after Escape should still play menu, got ' + playedNow);

  // re-open and pick map 6 (index 5 = first volcano map)
  key('s'); key('k'); key('i'); key('p');
  frameTexts(3);
  for (let i = 0; i < 5; i++) key('ArrowDown');
  key('Enter');
  texts = frameTexts(3);
  if (texts.includes('SKIP TO MAP')) bad('selecting a map should close the overlay');
  if (playedNow !== 'volcano') bad('map 6 (Habanero Heights) should play volcano, got ' + playedNow);

  console.log(fail ? 'FAILED (' + fail + ')' : 'OK');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL exception:', e); process.exit(1); });
`;
eval(code);
