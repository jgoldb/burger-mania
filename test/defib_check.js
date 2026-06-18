// Defibrillator check: loads the full game stack under a stubbed DOM, injects a
// defibrillator at the rider's spawn on the first Beginner map, then rides into
// it and verifies the runtime contract: a real run BANKS a life (the HUD's life
// count ticks up and the new head's pop-in animation arms), and the cosmetic
// effects fire — the electrocution overlay and the distinct "+1 LIFE" combat
// text are both drawn. A map with no defibs is unaffected (the field is optional
// and inert when absent), which the rest of the suite already rides over.
//
// It also pins the once-per-CONTINUE rule: a defib already grabbed must stay gone
// after a death + respawn (a nut planted ahead forces the crash), so the one-up
// can't be farmed by dying on purpose — but spending a continue (after running out
// of lives) IS the reset point and re-floats it. Map-editor test rides and replays
// are deliberately excluded — they always start with every defib present.
// Run with: node test/defib_check.js
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
  location: { hostname: 'localhost', search: '' },
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
function key(k) {
  for (const fn of windowHandlers.keydown || []) {
    fn({ key: k, preventDefault() {}, repeat: false });
  }
}

const code = ['js/assets.js', 'js/levels.js', 'js/physics.js', 'js/render.js',
  'js/music.js', 'js/replay.js', 'js/touch.js', 'js/editor.js', 'js/game.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') + `
// spy on the render entry points the defibrillator drives, capturing what the
// HUD was last handed so we can read the live life count + pop-in animation
let zapDraws = 0, lifeToastDraws = 0;
let lastHudLives = null, lastHudLifeAnim = null, sawPlaying = false;
// once a respawn is armed, flip this if the HUD ever shows the life count climb
// back to 4 — the only way that happens is an already-grabbed defib re-floating
let watchRefloat = false, refloated = false;
// flips true the first time the continue screen draws, so the test can tell when
// running out of lives has landed us on it
let sawContinue = false;
const _origEl = drawElectrocution;
drawElectrocution = (...a) => { zapDraws++; return _origEl(...a); };
const _origLP = drawLifePopup;
drawLifePopup = (...a) => { lifeToastDraws++; return _origLP(...a); };
const _origDC = drawContinue;
drawContinue = (...a) => { sawContinue = true; return _origDC(...a); };
const _origHUD = drawHUD;
drawHUD = (ctx, W, H, o) => {
  if (o.lives != null) {
    sawPlaying = true; lastHudLives = o.lives; lastHudLifeAnim = o.lifeAnim;
    if (watchRefloat && o.lives >= 4) refloated = true;
  }
  return _origHUD(ctx, W, H, o);
};

(async () => {
  await new Promise(r => setImmediate(r));   // let loadAssets settle
  pumpFrames(5, 1 / 60);                     // loading screen
  key('Enter');                              // loading -> intro (creates audio)
  pumpFrames(5, 1 / 60);
  key('Enter');                              // intro -> menu
  pumpFrames(3, 1 / 60);

  // drop a defibrillator right on the spawn of the first Beginner map, BEFORE we
  // enter it (enterLevel reads the cached level, and reset() builds the run's
  // defib list from level.defibs). Shipped maps carry no defibs, so this is the
  // only one in play.
  const lvl0 = TRACKS[0].levels[0];
  if (!lvl0) { bad('Beginner map 1 did not load from disk'); }
  else {
    lvl0.defibs = [[lvl0.start.x, lvl0.start.y]];
    // a lethal nut a few metres ahead on the spawn-flat (the floor runs flat at
    // y=8 from x=0 to x=8) so the test can force a crash + respawn and prove the
    // grabbed defib does NOT come back — it's once per track, not once per map
    lvl0.nuts = [[6, 7.6]];
  }

  key('Enter');                              // Play -> difficulty
  pumpFrames(3, 1 / 60);
  key('Enter');                              // Beginner -> ready
  pumpFrames(3, 1 / 60);
  key('ArrowUp');                            // ready -> playing
  pumpFrames(20, 1 / 60);                    // ride a beat: collect + animate

  if (!sawPlaying) bad('never reached a live playing HUD (navigation drifted)');
  // the life was banked: lives started at 3, the defib makes it 4
  if (lastHudLives !== 4) bad('collecting a defibrillator should add a life (3 -> 4), got ' + lastHudLives);
  // the new head is mid pop-in shortly after the grab (< 1 = still animating)
  if (!(lastHudLifeAnim != null && lastHudLifeAnim < 1)) {
    bad('a freshly-won life should arm the head pop-in (lifeAnim < 1), got ' + lastHudLifeAnim);
  }
  // the cosmetic effects fired
  if (zapDraws === 0) bad('the electrocution overlay never drew after a defib pickup');
  if (lifeToastDraws === 0) bad('the "+1 LIFE" combat text never drew after a defib pickup');

  // ride on a beat: the zap + toast age out and the banked life holds (still 4,
  // and short of the nut waiting ahead)
  pumpFrames(40, 1 / 60);
  if (lastHudLives !== 4) bad('the banked life should persist, got ' + lastHudLives);

  // --- a respawn does NOT re-float (once per continue, not once per map) ---
  // keep riding into the nut ahead: it crashes the rider and the banked life is
  // spent (lives 4 -> 3, the dead screen)
  let died = false;
  for (let i = 0; i < 600 && !died; i++) {
    pumpFrames(1, 1 / 60);
    if (lastHudLives != null && lastHudLives < 4) died = true;
  }
  if (!died) bad('expected the rider to crash into the nut ahead and drop from 4 lives to 3');

  // respawn from the crash and verify the defib grabbed at spawn stays consumed:
  // a once-per-MAP defib would re-float right under the respawned rider and bump
  // the count straight back to 4. Within a continue, it must not.
  watchRefloat = true; refloated = false;
  key('Enter');                              // dead -> reset() + playing (lives 3 > 0)
  pumpFrames(6, 1 / 60);                      // a re-floated defib re-collects at spawn at once
  if (lastHudLives !== 3) bad('a defib already grabbed since the last continue must stay gone after a respawn (lives 3), got ' + lastHudLives);
  pumpFrames(60, 1 / 60);                     // and it must never re-float later in this continue either
  if (refloated) bad('respawning re-floated an already-grabbed defibrillator (lives climbed back to 4) — defibs are once per continue, not once per map');

  // --- but spending a CONTINUE does re-float (once per continue, not per track) ---
  // keep crashing into the nut until the lives run out and we land on the continue
  // screen (Enter is harmless while playing, respawns on the dead screen, and tips
  // us into the continue screen on the last death). Break before pressing Enter
  // again so we don't spend the continue inside the loop.
  watchRefloat = false; refloated = false;
  for (let i = 0; i < 2000 && !sawContinue; i++) {
    pumpFrames(1, 1 / 60);
    if (sawContinue) break;
    key('Enter');
  }
  if (!sawContinue) bad('never reached the continue screen after burning through every life');
  watchRefloat = true;                       // from here, lives climbing to 4 means the defib re-floated
  key('Enter');                              // continue screen -> Continue (contSel 0) -> useContinue
  pumpFrames(3, 1 / 60);                      // settle on the checkpoint's 'ready' screen
  key('ArrowUp');                            // ready -> playing (throttle is still held)
  pumpFrames(20, 1 / 60);                     // the re-floated defib re-collects at spawn
  if (!refloated || lastHudLives !== 4) {
    bad('spending a continue should re-float the defib and re-collect it (lives 3 -> 4), got ' + lastHudLives);
  }

  console.log(fail ? 'FAILED (' + fail + ')'
    : 'OK  defibrillator: banks a life + FX; once per continue — a respawn keeps it gone, a continue re-floats it');
  process.exit(fail ? 1 : 0);                // the song scheduler keeps node alive
})().catch(e => { console.log('FAIL exception:', e); process.exit(1); });
`;
eval(code);
