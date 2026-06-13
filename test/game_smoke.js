// Whole-game smoke test: loads the full script stack (assets, levels,
// physics, render, music, game) under a stubbed DOM, then drives the
// state machine with key events and frames, asserting the right song is
// playing on each screen. Catches integration breaks a unit check can't.
// Run with: node test/game_smoke.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fail = 0;
function bad(msg) { console.log('FAIL', msg); fail++; }

// ---- universal canvas-ish stub: any method works, any property sticks ----
function makeCtx() {
  const obj = {
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

// ---- track what MUSIC is asked to do via a stub AudioContext ----
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

// ---- DOM globals the scripts touch ----
global.window = {
  innerWidth: 800, innerHeight: 600,
  AudioContext: function () { const ac = FakeAudioContext(); ac.__real = true; lastAC = ac; return ac; },
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
function key(k) {
  for (const fn of windowHandlers.keydown || []) {
    fn({ key: k, preventDefault() {}, repeat: false });
  }
}
function keyUp(k) {
  for (const fn of windowHandlers.keyup || []) {
    fn({ key: k, preventDefault() {}, repeat: false });
  }
}

const code = ['js/assets.js', 'js/levels.js', 'js/physics.js', 'js/render.js',
  'js/music.js', 'js/replay.js', 'js/touch.js', 'js/editor.js', 'js/game.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') + `
// MUSIC.play is private state; observe through the module's public songs
// table by wrapping play
let playedNow = null;
const origPlay = MUSIC.play;
MUSIC.play = name => { playedNow = MUSIC.songs[name] ? name : null; origPlay(name); };

(async () => {
  await new Promise(r => setImmediate(r));   // let loadAssets settle
  pumpFrames(5, 1 / 60);                     // loading screen frames
  key('Enter');                              // loading -> intro (also creates audio)
  if (!lastAC) bad('AudioContext was not created on first keypress');
  pumpFrames(5, 1 / 60);
  if (playedNow !== null) bad('intro should be silent, got ' + playedNow);
  key('Enter');                              // skip intro -> menu
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'menu') bad('menu should play menu, got ' + playedNow);
  key('ArrowUp');                            // wrap to Audio (last menu item)
  key('Enter');                              // -> audio settings
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'menu') bad('audio screen should keep menu song, got ' + playedNow);
  key('ArrowRight');                         // master nudge: must not throw
  key('ArrowDown'); key('ArrowLeft');        // music down a notch
  key('Escape');                             // back to the menu
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'menu') bad('back from audio should keep menu, got ' + playedNow);
  key('Enter');                              // Play -> difficulty
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'menu') bad('difficulty should keep menu, got ' + playedNow);
  key('Enter');                              // Beginner -> ready (Burger Hill, meadow)
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'meadow') bad('ready should play meadow, got ' + playedNow);
  key('ArrowUp');                            // ready -> playing, throttle held
  pumpFrames(30, 1 / 60);
  if (playedNow !== 'meadow') bad('playing should keep meadow, got ' + playedNow);
  // ride blind full throttle into three loop-out crashes; Enter retries
  // after each death, and the third one lands on the continue screen
  let tries = 0;
  while (playedNow !== 'continue' && tries < 12) {
    pumpFrames(900, 1 / 60);                 // up to 15s of doomed riding
    if (playedNow !== 'continue') key('Enter');
    tries++;
  }
  keyUp('ArrowUp');
  if (playedNow !== 'continue') {
    bad('never reached the continue screen (after ' + tries + ' runs), song: ' + playedNow);
  }
  pumpFrames(3, 1 / 60);
  key('Enter');                              // spend a continue -> ready (meadow)
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'meadow') bad('after using a continue should be meadow, got ' + playedNow);
  key('s'); key('k'); key('i'); key('p');    // open the skip-cheat level picker
  pumpFrames(3, 1 / 60);
  key('ArrowUp');                            // wrap up to the last Beginner map (volcano)
  key('Enter');                              // jump to the picked map
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'volcano') bad('last Beginner map should play volcano, got ' + playedNow);
  key('ArrowUp');                            // ready -> playing
  pumpFrames(3, 1 / 60);
  keyUp('ArrowUp');
  key(' ');                                  // flip: whoosh must not throw
  pumpFrames(3, 1 / 60);
  key('Escape');                             // pause keeps the song (ducked)
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'volcano') bad('paused should keep volcano, got ' + playedNow);
  key('m');                                  // mute must not throw mid-song
  key('m');
  key('ArrowDown');                          // pause -> Audio
  key('Enter');                              // audio settings over the pause
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'volcano') bad('audio (from pause) should keep volcano, got ' + playedNow);
  key('ArrowLeft');                          // master nudge: must not throw
  key('Escape');                             // back to the pause menu
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'volcano') bad('back at pause should keep volcano, got ' + playedNow);
  key('ArrowDown');                          // selection was on Audio -> Return to Menu
  key('Enter');
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'menu') bad('back at menu should play menu, got ' + playedNow);
  console.log(fail ? 'FAILED (' + fail + ')' : 'OK');
  process.exit(fail ? 1 : 0);                // the song scheduler keeps node alive
})().catch(e => { console.log('FAIL exception:', e); process.exit(1); });
`;
eval(code);
