// Mobile replay-library check: runs the whole stack under a stubbed DOM that
// has NO File System Access API (so REPLAY.fsSupported is false, the iOS Safari
// case) and an in-memory IndexedDB. Rides until a crash, saves with S (which
// must land in IndexedDB, not a download), browses the in-app Replays list,
// plays the run back and requires the same crash time (deterministic sim), then
// deletes it through delete-mode and requires the library to end up empty.
// Run with: node test/replay_mobile_check.js
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

// ---- in-memory IndexedDB stub (enough for idb()/dbSave/dbList/dbDelete) ----
// Persists across open() calls in this module-level map, like a real DB would.
const idbStores = {}; // name -> { keyPath, rows: Map }
function osWrap(meta) {
  return {
    put(value, key) { meta.rows.set(meta.keyPath ? value[meta.keyPath] : key, value); },
    delete(key) { meta.rows.delete(key); },
    get(key) {
      const rq = { result: meta.rows.get(key) };
      setImmediate(() => rq.onsuccess && rq.onsuccess());
      return rq;
    },
    getAll() {
      const rq = { result: [...meta.rows.values()] };
      setImmediate(() => rq.onsuccess && rq.onsuccess());
      return rq;
    },
  };
}
const fakeDb = {
  objectStoreNames: { contains: n => n in idbStores },
  createObjectStore(name, opts) {
    idbStores[name] = { keyPath: opts && opts.keyPath, rows: new Map() };
    return osWrap(idbStores[name]);
  },
  transaction(name) {
    const tx = { objectStore: n => osWrap(idbStores[n]) };
    setImmediate(() => tx.oncomplete && tx.oncomplete());
    return tx;
  },
};
global.indexedDB = {
  open() {
    const rq = { result: fakeDb };
    setImmediate(() => {
      // first open creates the stores (the v2 upgrade); later opens skip it
      if (!('replays' in idbStores)) rq.onupgradeneeded && rq.onupgradeneeded();
      rq.onsuccess && rq.onsuccess();
    });
    return rq;
  },
};

// ---- DOM globals: NO showSaveFilePicker / showDirectoryPicker -> fsSupported false ----
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
// drain the microtask/immediate queues so async UI work (idb reads) settles
function settle() {
  let p = Promise.resolve();
  for (let i = 0; i < 12; i++) p = p.then(() => new Promise(r => setImmediate(r)));
  return p;
}
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
  if (REPLAY.fsSupported) bad('fsSupported should be false without the File System Access API');

  // ---- record a doomed run, save it (must go to IndexedDB), watch it back ----
  await new Promise(r => setImmediate(r));   // let loadAssets settle
  pumpFrames(5, 1 / 60);
  key('Enter');                              // loading -> intro
  key('Enter');                              // intro -> menu
  pumpFrames(3, 1 / 60);
  key('Enter');                              // Play -> difficulty
  pumpFrames(3, 1 / 60);
  key('Enter');                              // Easy -> ready (Burger Hill)
  pumpFrames(3, 1 / 60);
  key('ArrowUp');                            // ride: full throttle, doomed
  if (!pumpUntilText(2400, 'You crashed!')) bad('blind full-throttle run never crashed');
  keyUp('ArrowUp');
  const deadTexts = lastFrameTexts();
  const liveTime = deadTexts.find(t => t.startsWith('time'));
  const liveStyle = deadTexts.find(t => t.startsWith('style'));

  key('s');                                  // save the replay
  await settle();
  const rows = idbStores.replays ? idbStores.replays.rows : null;
  if (!rows || rows.size !== 1) {
    bad('expected 1 replay in IndexedDB, got ' + (rows ? rows.size : 'no store'));
  } else {
    const rec = [...rows.values()][0];
    const d = JSON.parse(rec.text);
    if (d.format !== 'burger-mania-replay') bad('stored replay has wrong format field');
    if (d.outcome !== 'crashed') bad('stored outcome should be crashed, got ' + d.outcome);
    if (d.level.name !== 'Burger Hill') bad('stored level should be Burger Hill, got ' + d.level.name);
  }
  if (!lastFrameTexts().some(t => t.includes('See the Replays screen'))) {
    bad('mobile save confirmation should point at the Replays screen');
  }

  // ---- browse the in-app list (no folder picker on this browser) ----
  key('Escape');                             // dead -> pause
  pumpFrames(2, 1 / 60);
  key('ArrowUp');                            // wrap to Return to Menu (last item)
  key('Enter');
  pumpFrames(3, 1 / 60);
  key('ArrowDown');                          // menu: Play -> Map Editor
  key('ArrowDown');                          // menu: Map Editor -> Replays
  key('Enter');                              // -> replays screen
  await settle();
  const listTexts = lastFrameTexts();
  if (listTexts.some(t => t.includes('Choose Replays Folder'))) {
    bad('mobile replays screen should not offer a folder picker');
  }
  if (!listTexts.some(t => t.includes('Burger Hill'))) {
    bad('mobile replay list does not show the saved Burger Hill run');
  }
  if (!listTexts.some(t => t.includes('Delete a Replay'))) {
    bad('mobile replay list does not offer a delete affordance');
  }

  key('Enter');                              // play the (only, newest) replay
  pumpFrames(2, 1 / 60);
  if (!lastFrameTexts().some(t => t.startsWith('REPLAY'))) {
    bad('playback does not show the REPLAY banner');
  }
  if (!pumpUntilText(2400, 'The rider crashed!')) {
    bad('replay playback never reached the recorded crash');
  } else {
    const endTexts = lastFrameTexts();
    const repTime = endTexts.find(t => t.startsWith('time'));
    const repStyle = endTexts.find(t => t.startsWith('style'));
    if (repTime !== liveTime) bad('replay time differs from the live run: ' + repTime + ' vs ' + liveTime);
    if (repStyle !== liveStyle) bad('replay style differs from the live run: ' + repStyle + ' vs ' + liveStyle);
  }

  key('Enter');                              // back to the replays list
  await settle();
  if (!lastFrameTexts().some(t => t.includes('REPLAYS'))) {
    bad('Enter after playback should land on the replays screen');
  }

  // ---- delete-mode: prune the run, library ends up empty ----
  key('ArrowDown');                          // select 'Delete a Replay...'
  key('Enter');                              // enter delete mode
  await settle();
  const delTexts = lastFrameTexts();
  if (!delTexts.some(t => t.startsWith('Delete:') && t.includes('Burger Hill'))) {
    bad('delete mode should relabel the Burger Hill row as "Delete: ..."');
  }
  if (!delTexts.some(t => t.includes('Pick a replay to delete'))) {
    bad('delete mode should explain itself in the note');
  }
  key('Enter');                              // delete the selected run (row 0)
  await settle();
  if (idbStores.replays.rows.size !== 0) {
    bad('replay was not removed from IndexedDB: ' + idbStores.replays.rows.size + ' left');
  }
  const goneTexts = lastFrameTexts();
  if (goneTexts.some(t => t.includes('Burger Hill'))) {
    bad('deleted replay still shows in the list');
  }
  if (!goneTexts.some(t => t.includes('No replays saved yet'))) {
    bad('emptied library should say there are no replays yet');
  }

  console.log(fail ? 'FAILED (' + fail + ')' : 'OK');
  process.exit(fail ? 1 : 0);                // the song scheduler keeps node alive
})().catch(e => { console.log('FAIL exception:', e); process.exit(1); });
`;
eval(code);
