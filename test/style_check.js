// Style points check: plays back a synthetic "drop lab" replay — a long
// free fall with a mid-air turn-around (space) at frame 30 and a held lean
// key volt-spinning the bike — and requires the sim to re-earn the points:
// +100 for the airborne flip, +250 per full rotation, the floating
// "+N" toasts on screen, a climbing HUD style row, and no best-score
// banking from merely watching. Run with: node test/style_check.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fail = 0;
function bad(msg) { console.log('FAIL', msg); fail++; }

// ---- canvas stub that records what the HUD writes ----
const hudTexts = [];
function makeCtx() {
  const obj = {
    fillText: t => { hudTexts.push(String(t)); },
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

// ---- stub AudioContext (same shape as game_smoke) ----
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

// ---- stub File System Access API: one pre-seeded replay ----
// A tall closed box: the bike spawns ~47 m above the floor and free-falls
// for ~3.7 s. The tape coasts 10 frames, turns around at frame 30, and
// holds left the rest of the way so stacked volts wind up full rotations.
const dropLab = JSON.stringify({
  format: 'burger-mania-replay', version: 15,
  savedAt: '2026-06-12T00:00:00.000Z',
  label: 'Drop Lab', outcome: 'crashed', time: 4,
  style: 350,
  trackId: null, levelIndex: 0,
  level: {
    name: 'Drop Lab', theme: 'meadow',
    polygons: [[[-60, -45], [60, -45], [60, 12], [-60, 12]]],
    start: { x: 0, y: -35 },
    burgers: [],
    goal: [50, 11],
  },
  frames: 240,
  inputs: [0, 10, 4, 230],
  flips: [30],
});
const savedFiles = { 'drop-lab.bmr': dropLab };
const fakeDir = {
  name: 'fake-replays', kind: 'directory',
  queryPermission: async () => 'granted',
  requestPermission: async () => 'granted',
  async *values() {
    let i = 0;
    for (const [name, text] of Object.entries(savedFiles)) {
      const mtime = ++i;
      yield {
        kind: 'file', name,
        getFile: async () => ({ lastModified: mtime, text: async () => text }),
      };
    }
  },
};

// ---- DOM globals ----
global.window = {
  innerWidth: 800, innerHeight: 600,
  AudioContext: function () { const ac = FakeAudioContext(); lastAC = ac; return ac; },
  addEventListener(type, fn) { (windowHandlers[type] = windowHandlers[type] || []).push(fn); },
  showSaveFilePicker: async opts => ({
    name: opts.suggestedName,
    createWritable: async () => ({ async write() {}, async close() {} }),
  }),
  showDirectoryPicker: async () => fakeDir,
};
let lastAC = null;
global.document = {
  getElementById: () => gameCanvas,
  createElement: () => makeCanvas(),
};
const storageWrites = { count: 0 };
global.localStorage = { getItem: () => null, setItem() { storageWrites.count++; } };
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
// drain the microtask/immediate queues so async UI work settles
function settle() {
  let p = Promise.resolve();
  for (let i = 0; i < 8; i++) p = p.then(() => new Promise(r => setImmediate(r)));
  return p;
}
function lastFrameTexts() {
  hudTexts.length = 0;
  pumpFrames(1, 1 / 60);
  return hudTexts.slice();
}

const code = ['js/assets.js', 'js/levels.js', 'js/physics.js', 'js/render.js',
  'js/music.js', 'js/replay.js', 'js/touch.js', 'js/editor.js', 'js/game.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') + `
(async () => {
  await new Promise(r => setImmediate(r));   // let loadAssets settle
  pumpFrames(5, 1 / 60);
  key('Enter');                              // loading -> intro
  key('Enter');                              // intro -> menu
  pumpFrames(3, 1 / 60);
  key('ArrowDown');                          // menu: Play -> Records
  key('ArrowDown');                          // menu: Records -> Replays
  key('Enter');                              // -> replays screen
  await settle();
  key('Enter');                              // choose folder (stub grants)
  await settle();
  const listTexts = lastFrameTexts();
  if (!listTexts.some(t => t.includes('Drop Lab'))) {
    bad('replay list does not show the drop lab replay');
  }
  if (!listTexts.some(t => t.includes('style 350'))) {
    bad('replay list does not show the stored style total');
  }

  storageWrites.count = 0;
  key('Enter');                              // watch the drop lab tape
  let sawFlip = false, sawSpin = false, maxStyle = -1, ended = false;
  for (let i = 0; i < 600 && !ended; i += 10) {
    hudTexts.length = 0;
    pumpFrames(10, 1 / 60);
    for (const t of hudTexts) {
      if (t === '+100') sawFlip = true;
      if (t === '+250') sawSpin = true;
      const m = /^style\\s+(\\d+)/.exec(t);
      if (m) maxStyle = Math.max(maxStyle, +m[1]);
      if (t.includes('The rider crashed!') || t.includes('End of the tape!')) {
        ended = true;
      }
    }
  }
  if (!ended) bad('drop lab playback never reached an ending');
  if (!sawFlip) bad('mid-air turn-around never showed a +100 toast');
  if (!sawSpin) bad('full rotation never showed a +250 toast');
  if (maxStyle < 350) {
    bad('HUD style row never reached 350 (flip + one rotation), saw ' + maxStyle);
  }
  if (storageWrites.count !== 0) {
    bad('watching a replay banked a best (' + storageWrites.count + ' writes)');
  }

  console.log(fail ? 'FAILED (' + fail + ')' : 'OK');
  process.exit(fail ? 1 : 0);                // the song scheduler keeps node alive
})().catch(e => { console.log('FAIL exception:', e); process.exit(1); });
`;
eval(code);
