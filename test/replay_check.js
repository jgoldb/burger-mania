// Replay system check: unit-tests the tape encoding, then runs the whole
// stack under a stubbed DOM with stubbed File System Access pickers —
// ride until a crash, save the replay with S, browse to it through the
// Replays screen, play it back, and require the HUD to show the exact
// same crash time (the sim is deterministic, so playback must be too).
// Run with: node test/replay_check.js
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

// ---- stub File System Access API: an in-memory "folder" of replays ----
const savedFiles = {}; // name -> text
const fakeDir = {
  name: 'fake-replays', kind: 'directory',
  queryPermission: async () => 'granted',
  requestPermission: async () => 'granted',
  async *values() {
    let i = 0;
    for (const [name, text] of Object.entries(savedFiles)) {
      const mtime = ++i; // later insertions read as newer
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
    createWritable: async () => ({
      async write(text) { savedFiles[opts.suggestedName] = text; },
      async close() {},
    }),
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
function keyUp(k) {
  for (const fn of windowHandlers.keyup || []) {
    fn({ key: k, preventDefault() {}, repeat: false });
  }
}
// drain the microtask/immediate queues so async UI work settles
function settle() {
  let p = Promise.resolve();
  for (let i = 0; i < 8; i++) p = p.then(() => new Promise(r => setImmediate(r)));
  return p;
}
// pump in chunks until some HUD text contains the needle
function pumpUntilText(maxFrames, needle) {
  for (let i = 0; i < maxFrames; i += 30) {
    hudTexts.length = 0;
    pumpFrames(30, 1 / 60);
    if (hudTexts.some(t => t.includes(needle))) return true;
  }
  return false;
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
  // ---- tape encoding round trip on a deterministic pseudo-random stream ----
  REPLAY.begin();
  const masks = [], flips = [];
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 500; i++) {
    const m = Math.floor(rnd() * 16);
    const fl = rnd() < 0.05;
    masks.push(m); flips.push(fl);
    REPLAY.record(m, fl);
  }
  const rt = REPLAY.parse(REPLAY.serialize({
    level: LEVELS[0], label: 'rt', outcome: 'crashed', time: 1,
    trackId: 'beginner', levelIndex: 0,
  }));
  if (rt.frames !== 500) bad('round trip frame count: ' + rt.frames);
  const cur = REPLAY.cursor(rt);
  for (let i = 0; i < 500; i++) {
    const f = cur.next();
    if (f.mask !== masks[i] || f.flip !== flips[i]) {
      bad('cursor mismatch at frame ' + i);
      break;
    }
  }
  if (!cur.done()) bad('cursor not done after all frames');
  let threw = false;
  try { REPLAY.parse('{"format":"nope"}'); } catch (e) { threw = true; }
  if (!threw) bad('parse accepted a non-replay');
  threw = false;
  try {
    const broken = JSON.parse(REPLAY.serialize({
      level: LEVELS[0], label: 'x', outcome: 'crashed', time: 1,
      trackId: 'beginner', levelIndex: 0 }));
    broken.frames += 7;
    REPLAY.parse(JSON.stringify(broken));
  } catch (e) { threw = true; }
  if (!threw) bad('parse accepted a frame-count mismatch');
  // a replay from an older game version is rejected cleanly and FLAGGED, so
  // the folder browser can explain it apart from a corrupt file
  let flagged = false;
  try {
    const old = JSON.parse(REPLAY.serialize({
      level: LEVELS[0], label: 'old', outcome: 'crashed', time: 1,
      trackId: 'beginner', levelIndex: 0 }));
    old.version = 0; // any version that isn't the current one
    REPLAY.parse(JSON.stringify(old));
  } catch (e) { flagged = e.versionMismatch === true; }
  if (!flagged) bad('parse did not flag an outdated replay version');
  // style metadata: round-trips when present, null (shown as N/A) when not
  const styled = REPLAY.parse(REPLAY.serialize({
    level: LEVELS[0], label: 'st', outcome: 'finished', time: 2,
    trackId: 'beginner', levelIndex: 0, style: 350,
  }));
  if (styled.style !== 350) bad('style total did not round trip: ' + styled.style);
  if (rt.style !== null) bad('absent style should parse as null, got ' + rt.style);

  // ---- whole-stack: record a doomed run, save it, watch it back ----
  await new Promise(r => setImmediate(r));   // let loadAssets settle
  pumpFrames(5, 1 / 60);
  key('Enter');                              // loading -> intro
  key('Enter');                              // intro -> menu
  pumpFrames(3, 1 / 60);
  key('Enter');                              // Play -> difficulty
  pumpFrames(3, 1 / 60);
  key('Enter');                              // Beginner -> ready (Burger Hill)
  pumpFrames(3, 1 / 60);
  key('ArrowUp');                            // ride: full throttle, doomed
  if (!pumpUntilText(2400, 'You crashed!')) {
    bad('blind full-throttle run never crashed');
  }
  keyUp('ArrowUp');
  const deadTexts = lastFrameTexts();
  const liveTime = deadTexts.find(t => t.startsWith('time'));
  const liveBurgers = deadTexts.find(t => t.startsWith('burgers'));
  const liveStyle = deadTexts.find(t => t.startsWith('style'));
  if (!liveStyle) bad('HUD does not show a style row');
  if (!deadTexts.some(t => t.includes('S: save replay'))) {
    bad('crash screen does not offer S: save replay');
  }

  key('s');                                  // save the replay
  await settle();
  const names = Object.keys(savedFiles);
  if (names.length !== 1) {
    bad('expected 1 saved replay file, got ' + names.length);
  } else {
    const d = JSON.parse(savedFiles[names[0]]);
    if (d.format !== 'burger-mania-replay') bad('saved file has wrong format field');
    if (d.outcome !== 'crashed') bad('saved outcome should be crashed, got ' + d.outcome);
    if (!(d.frames > 0)) bad('saved replay has no frames');
    if (d.level.name !== 'Burger Hill') bad('saved level should be Burger Hill, got ' + d.level.name);
    if (!Number.isFinite(d.style) || d.style < 0) {
      bad('saved replay is missing its style total: ' + d.style);
    }
  }
  if (!lastFrameTexts().some(t => t.startsWith('Saved '))) {
    bad('save confirmation not shown on the crash screen');
  }

  key('Escape');                             // dead -> pause
  pumpFrames(2, 1 / 60);
  key('ArrowUp');                            // wrap to Return to Menu (last item)
  key('Enter');
  pumpFrames(3, 1 / 60);
  key('ArrowDown');                          // menu: Play -> Map Editor
  key('ArrowDown');                          // menu: Map Editor -> Replays
  key('Enter');                              // -> replays screen
  await settle();
  if (!lastFrameTexts().some(t => t.includes('Choose Replays Folder'))) {
    bad('replays screen does not offer to choose a folder');
  }
  // drop an outdated (older-version) replay into the folder: it must be
  // hidden from the list and the gap explained, not silently mis-played
  savedFiles['ancient.bmr'] = JSON.stringify({
    format: 'burger-mania-replay', version: 1,
    savedAt: '2026-01-01T00:00:00.000Z',
    label: 'Ancient Run', outcome: 'finished', time: 1,
    trackId: null, levelIndex: 0,
    level: {
      name: 'Old Map', theme: 'meadow',
      polygons: [[[-5, -8], [20, -8], [20, 8], [-5, 8]]],
      start: { x: 2, y: 7.25 }, burgers: [], goal: [2.5, 7.5],
    },
    frames: 60, inputs: [0, 60], flips: [],
  });
  key('Enter');                              // choose folder (stub grants)
  await settle();
  const listTexts = lastFrameTexts();
  if (!listTexts.some(t => t.includes('Burger Hill'))) {
    bad('replay list does not show the saved Burger Hill run');
  }
  if (!listTexts.some(t => / - style \\d+$/.test(t))) {
    bad('replay list does not show the saved run style total');
  }
  if (listTexts.some(t => t.includes('Ancient Run'))) {
    bad('replay list shows an outdated-version replay it cannot play');
  }
  if (!listTexts.some(t => t.includes('older version'))) {
    bad('replays screen does not explain the hidden outdated replay');
  }
  key('Enter');                              // play the newest replay
  pumpFrames(2, 1 / 60);
  if (!lastFrameTexts().some(t => t.startsWith('REPLAY'))) {
    bad('playback does not show the REPLAY banner');
  }
  if (!pumpUntilText(2400, 'The rider crashed!')) {
    bad('replay playback never reached the recorded crash');
  } else {
    const endTexts = lastFrameTexts();
    const repTime = endTexts.find(t => t.startsWith('time'));
    const repBurgers = endTexts.find(t => t.startsWith('burgers'));
    const repStyle = endTexts.find(t => t.startsWith('style'));
    if (repTime !== liveTime) {
      bad('replay time differs from the live run: ' + repTime + ' vs ' + liveTime);
    }
    if (repBurgers !== liveBurgers) {
      bad('replay burgers differ from the live run: ' + repBurgers + ' vs ' + liveBurgers);
    }
    if (repStyle !== liveStyle) {
      bad('replay style differs from the live run: ' + repStyle + ' vs ' + liveStyle);
    }
  }
  // ---- a synthetic instant-win replay covers the finished path ----
  savedFiles['synthetic-win.bmr'] = JSON.stringify({
    format: 'burger-mania-replay', version: 8,
    savedAt: '2026-06-11T00:00:00.000Z',
    label: 'Synthetic Win', outcome: 'finished', time: 0.02,
    trackId: null, levelIndex: 0,
    level: {
      name: 'Win Box', theme: 'meadow',
      polygons: [[[-5, -8], [20, -8], [20, 8], [-5, 8]]],
      start: { x: 2, y: 7.25 },
      burgers: [],
      goal: [2.5, 7.5],
    },
    frames: 120, inputs: [0, 120], flips: [],
  });
  key('Enter');                              // back to the replays list
  await settle();
  if (!lastFrameTexts().some(t => t.includes('REPLAYS'))) {
    bad('Enter after playback should land on the replays screen');
  }
  if (!lastFrameTexts().some(t => t.includes('Synthetic Win'))) {
    bad('replay list does not show the synthetic win replay');
  }
  // the synthetic file predates style points (no field): the list says N/A
  if (!lastFrameTexts().some(t => t.includes('style N/A'))) {
    bad('replay without style data should list style N/A');
  }
  storageWrites.count = 0;
  key('Enter');                              // newest first: play Win Box
  if (!pumpUntilText(180, 'Course completed!')) {
    bad('synthetic win replay never finished');
  }
  if (storageWrites.count !== 0) {
    bad('watching a replay wrote a best time (' + storageWrites.count + ' writes)');
  }
  key('Escape');                             // and Esc also returns
  await settle();
  if (!lastFrameTexts().some(t => t.includes('REPLAYS'))) {
    bad('Escape after a finished replay should land on the replays screen');
  }

  console.log(fail ? 'FAILED (' + fail + ')' : 'OK');
  process.exit(fail ? 1 : 0);                // the song scheduler keeps node alive
})().catch(e => { console.log('FAIL exception:', e); process.exit(1); });
`;
eval(code);
