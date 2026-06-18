// Touch-controls check: loads the full script stack under a stubbed DOM
// (no matchMedia, so touch activates on the first synthetic touch), then
// drives the whole game with taps and held fingers: boot, menus, the
// touch-specific hint text, riding on a held gas button until the crash
// screen, tap-retry, pause/resume, the corner back button, and a slider
// drag on the audio screen. Run with: node test/touch_check.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fail = 0;
function bad(msg) { console.log('FAIL', msg); fail++; }

// ---- canvas stub: any method works, fillText is captured ----
const hudTexts = [];
function makeCtx() {
  const obj = {
    fillText: t => { hudTexts.push(String(t)); },
    strokeText: () => {},
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({ setTransform() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
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
  return {
    width: 0, height: 0,
    style: {},
    getContext: () => makeCtx(),
    addEventListener(type, fn) { (canvasHandlers[type] = canvasHandlers[type] || []).push(fn); },
  };
}
const canvasHandlers = {};
const windowHandlers = {};
const gameCanvas = makeCanvas();

// ---- stub AudioContext (engine sound, blips must not throw) ----
function param() {
  return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}, setTargetAtTime() {} };
}
function audioNode() {
  return { type: '', gain: param(), frequency: param(), Q: param(),
    connect() {}, disconnect() {}, start() {}, stop() {}, buffer: null };
}
function FakeAudioContext() {
  return {
    currentTime: clock.t, state: 'running',
    get sampleRate() { return 8000; },
    destination: {},
    resume() {},
    createGain: audioNode, createOscillator: audioNode,
    createBiquadFilter: audioNode, createBufferSource: audioNode,
    createBuffer: (c, len) => ({ getChannelData: () => new Float32Array(len) }),
  };
}
const clock = { t: 0 };

global.window = {
  innerWidth: 800, innerHeight: 600,
  AudioContext: function () { const ac = FakeAudioContext(); lastAC = ac; return ac; },
  addEventListener(type, fn) { (windowHandlers[type] = windowHandlers[type] || []).push(fn); },
};
let lastAC = null;
global.document = {
  getElementById: () => gameCanvas,
  createElement: () => makeCanvas(),
};
global.localStorage = { getItem: () => null, setItem() {} };
global.performance = { now: () => clock.t * 1000 };
const rafQueue = [];
global.requestAnimationFrame = fn => { rafQueue.push(fn); };
global.Image = function () { const img = {}; setImmediate(() => img.onload && img.onload()); return img; };
global.DOMMatrix = function (m) { this.m = m; };
global.setTimeout = setTimeout;

function pumpFrames(n, dt) {
  for (let i = 0; i < n; i++) {
    clock.t += dt;
    if (lastAC) lastAC.currentTime = clock.t;
    const q = rafQueue.splice(0);
    for (const fn of q) fn(clock.t * 1000);
  }
}

// ---- touch event dispatch with real touches/changedTouches semantics ----
const fingers = new Map(); // id -> {clientX, clientY}
function fire(type, changed) {
  const ev = {
    preventDefault() {},
    touches: [...fingers.values()],
    changedTouches: changed,
  };
  for (const fn of canvasHandlers[type] || []) fn(ev);
}
function touchDown(id, x, y) {
  fingers.set(id, { clientX: x, clientY: y });
  fire('touchstart', [fingers.get(id)]);
}
function touchMove(id, x, y) {
  const f = fingers.get(id);
  f.clientX = x;
  f.clientY = y;
  fire('touchmove', [f]);
}
function touchUp(id) {
  const f = fingers.get(id);
  fingers.delete(id);
  fire('touchend', [f]);
}
function tap(x, y) {
  touchDown('tap', x, y);
  touchUp('tap');
}
function lastFrameTexts() {
  hudTexts.length = 0;
  pumpFrames(1, 1 / 60);
  return hudTexts.slice();
}
function pumpUntilText(maxFrames, needle) {
  for (let i = 0; i < maxFrames; i += 30) {
    hudTexts.length = 0;
    pumpFrames(30, 1 / 60);
    if (hudTexts.some(t => t.includes(needle))) return true;
  }
  return false;
}

const code = ['js/assets.js', 'js/levels.js', 'js/physics.js', 'js/render.js',
  'js/music.js', 'js/replay.js', 'js/touch.js', 'js/editor.js', 'js/game.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') + `
(async () => {
  await new Promise(r => setImmediate(r));   // let loadAssets settle
  pumpFrames(5, 1 / 60);

  // no matchMedia in this stub: touch must self-activate on first contact
  if (TOUCH.active) bad('TOUCH should start inactive under the stub DOM');
  tap(400, 300);                             // loading -> intro
  if (!TOUCH.active) bad('first touch should activate TOUCH');
  if (!lastAC) bad('AudioContext was not created on first touch');
  pumpFrames(3, 1 / 60);
  tap(400, 300);                             // skip intro -> menu
  pumpFrames(12, 1 / 60);                    // let menuT pass the hover gate
  if (!lastFrameTexts().some(t => t === 'PLAY')) bad('menu did not appear after taps');

  // tap the PLAY hero (mainMenuRects: 800x600, the wide top slab spans y~336-398)
  tap(400, 376);
  pumpFrames(12, 1 / 60);
  let texts = lastFrameTexts();
  if (!texts.some(t => t.includes('CHOOSE DIFFICULTY'))) bad('tap on Play missed');
  if (texts.some(t => t.includes('Esc to go back'))) {
    bad('difficulty screen shows the Esc hint on touch');
  }

  // corner BACK button returns to the menu, then go forward again
  tap(64, 35);
  pumpFrames(12, 1 / 60);
  if (!lastFrameTexts().some(t => t === 'PLAY')) bad('corner back button did not return to menu');
  tap(400, 376);                             // Play
  pumpFrames(12, 1 / 60);
  tap(400, 230);                             // Beginner (difficulty rows start at y=204)
  pumpFrames(3, 1 / 60);
  texts = lastFrameTexts();
  if (!texts.some(t => t.includes('GET READY!'))) bad('tap on Beginner missed');
  if (!texts.some(t => t.includes('Tap anywhere to ride'))) {
    bad('ready screen is not showing the touch hint');
  }

  // hold the gas button: layout(800,600) puts it at (684.8..780.8, 484.8..580.8)
  tap(400, 300);                             // ready -> playing
  touchDown('gas', 732, 532);
  if (!TOUCH.input.up) bad('held finger on the gas button is not throttling');
  if (!pumpUntilText(1500, 'You crashed!')) {
    bad('full throttle never reached the crash screen');
  }
  touchUp('gas');
  if (TOUCH.input.up) bad('lifting the gas finger did not release the throttle');
  if (!lastFrameTexts().some(t => t.includes('Tap to try again'))) {
    bad('crash screen is not showing the touch retry hint');
  }

  // mash-tap right after the crash is shielded, a settled tap retries
  tap(400, 300);
  pumpFrames(1, 1 / 60);
  if (!lastFrameTexts().some(t => t.includes('You crashed!'))) {
    bad('tap guard did not shield the crash screen');
  }
  pumpFrames(45, 1 / 60);                    // ride out the 600 ms guard
  tap(400, 300);
  pumpFrames(1, 1 / 60);
  if (lastFrameTexts().some(t => t.includes('You crashed!'))) {
    bad('tap after the guard did not restart the run');
  }

  // the in-game restart button is gone: a tap where it used to sit (right of
  // the pause button) must not reset the run, so the clock keeps climbing
  pumpFrames(60, 1 / 60);                     // let the timer pass a second
  const before = lastFrameTexts().find(t => /^time /.test(t));
  tap(434, 36);                              // old restart-button location
  const after = lastFrameTexts().find(t => /^time /.test(t));
  if (before && after && !/00:00,0/.test(before) && /00:00,0/.test(after)) {
    bad('tapping the old restart location reset the run');
  }

  // pause button (the lone top-centre control; no restart button in-game)
  tap(366, 36);
  pumpFrames(3, 1 / 60);
  if (!lastFrameTexts().some(t => t.includes('PAUSED'))) bad('pause button missed');
  tap(400, 304);                             // Continue (pause rows start at y=276)
  pumpFrames(3, 1 / 60);
  if (lastFrameTexts().some(t => t.includes('PAUSED'))) bad('Continue did not resume');

  // audio screen: drag the master slider by touch
  tap(366, 36);                              // pause again
  pumpFrames(3, 1 / 60);
  tap(400, 378);                             // Audio row of the pause menu
  pumpFrames(12, 1 / 60);                    // let audioT pass the hover gate
  touchDown('slider', 400, 214);             // master row: bar spans x 164..636
  touchMove('slider', 164 + 236, 214);       // mid-track
  touchUp('slider');
  pumpFrames(1, 1 / 60);
  if (!lastFrameTexts().some(t => t === '50%')) bad('slider drag did not land on 50%');
  tap(64, 35);                               // corner Back -> pause menu
  pumpFrames(3, 1 / 60);
  if (!lastFrameTexts().some(t => t.includes('PAUSED'))) bad('audio Back did not return to pause');

  console.log(fail ? 'FAILED (' + fail + ')' : 'OK');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL exception:', e); process.exit(1); });
`;
eval(code);
