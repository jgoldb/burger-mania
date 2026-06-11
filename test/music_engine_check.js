// Headless music-engine test: drives MUSIC with a stubbed AudioContext
// through two full loops of every song plus a crossfade, mute/duck, and a
// background-tab stall, validating every scheduled value and time.
// Run with: node test/music_engine_check.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fail = 0;
function bad(msg) { console.log('FAIL', msg); fail++; }

// ---- stub Web Audio ----
function param(name, init) {
  const v = {
    value: init,
    setValueAtTime(x, t) { v.check(x, t); },
    linearRampToValueAtTime(x, t) { v.check(x, t); },
    exponentialRampToValueAtTime(x, t) {
      v.check(x, t);
      if (x === 0) bad(name + ': exponential ramp to 0 (throws in browsers)');
    },
    setTargetAtTime(x, t, tc) {
      v.check(x, t);
      if (!isFinite(tc) || tc <= 0) bad(name + ': bad time constant ' + tc);
    },
    check(x, t) {
      if (!isFinite(x)) bad(name + ': non-finite value ' + x);
      if (!isFinite(t) || t < 0) bad(name + ': bad time ' + t);
      // the engine allows itself 20ms of slack; browsers clamp that to now
      if (t < ac.currentTime - 0.025) bad(name + ': scheduled in the past ' + t + ' < ' + ac.currentTime);
    },
  };
  return v;
}
let oscCount = 0, drumCount = 0;
function node(kind) {
  return {
    kind,
    type: 'sine',
    gain: param(kind + '.gain', 1),
    frequency: param(kind + '.frequency', 440),
    Q: param(kind + '.Q', 1),
    connect() {}, disconnect() {},
    started: null,
    start(t, off, dur) {
      if (t !== undefined && (!isFinite(t) || t < ac.currentTime - 0.025)) {
        bad(kind + '.start in the past: ' + t + ' < ' + ac.currentTime);
      }
      this.started = t;
      if (kind === 'osc') oscCount++; else drumCount++;
    },
    stop(t) {
      if (this.started !== null && t <= this.started) bad(kind + ': stop <= start');
    },
  };
}
const ac = {
  currentTime: 0,
  sampleRate: 48000,
  destination: { connect() {} },
  createGain: () => node('gain'),
  createOscillator: () => node('osc'),
  createBiquadFilter: () => node('filter'),
  createBufferSource: () => node('noise'),
  createBuffer: (ch, len, sr) => ({ getChannelData: () => new Float32Array(len) }),
};

// capture MUSIC's scheduler timer so we can pump it manually
let tickFn = null;
const realSetInterval = global.setInterval;
global.setInterval = (fn, ms) => { tickFn = fn; return 1; };
global.clearInterval = () => { tickFn = null; };

// the harness rides inside the eval so it can see `const MUSIC` (strict
// mode keeps eval-declared bindings scoped to the eval'd code)
const code = fs.readFileSync(path.join(root, 'js/music.js'), 'utf8') + `
MUSIC.init(ac);

// walk every song through two full loops
for (const name of Object.keys(MUSIC.songs)) {
  oscCount = 0; drumCount = 0;
  MUSIC.play(name);
  const song = MUSIC.songs[name];
  const loopDur = song.steps * 60 / song.bpm / 2;
  const t0 = ac.currentTime; // real AudioContext clocks never rewind
  for (let t = t0; t < t0 + 2 * loopDur; t += 0.04) {
    ac.currentTime = t;
    if (tickFn) tickFn();
  }
  console.log('PLAYED  %s: %d notes, %d drum hits over 2 loops (%ss)',
    name, oscCount, drumCount, (2 * loopDur).toFixed(1));
  if (oscCount === 0) bad(name + ': no notes scheduled');
  MUSIC.play(null);
  ac.currentTime += 2;
  if (tickFn) tickFn();
}

// crossfade mid-song, then mute/duck while playing
MUSIC.play('meadow');
ac.currentTime += 1.7; if (tickFn) tickFn();
MUSIC.play('volcano');
ac.currentTime += 0.3; if (tickFn) tickFn();
MUSIC.duck(true);
MUSIC.setMuted(true);
ac.currentTime += 0.5; if (tickFn) tickFn();
MUSIC.setMuted(false);
MUSIC.duck(false);
// background-tab stall: clock leaps far ahead, must not burst-schedule
oscCount = 0;
ac.currentTime += 60; if (tickFn) tickFn();
if (oscCount > 40) bad('burst after stall: ' + oscCount + ' notes at once');
console.log('STALL   recovered with %d notes booked', oscCount);
// repeated same-song play() must not restart or stack schedulers
const before = oscCount;
MUSIC.play('volcano'); MUSIC.play('volcano');
if (oscCount !== before) bad('same-song play() scheduled extra notes');
`;
eval(code);

global.setInterval = realSetInterval;
console.log(fail ? 'FAILED (' + fail + ')' : 'OK');
process.exitCode = fail ? 1 : 0;
