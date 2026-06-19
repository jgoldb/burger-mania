// Equipment character-sheet flow test: drives menu -> Equipment and checks the
// loadout lists every slot (Skins/Bikes + the empty gear slots), the selected
// slot's items show with EQUIPPED/LOCKED state, a locked item reveals its unlock
// requirement in the detail line and refuses to equip, an owned one equips
// (updating storage + the live BIKE_SKIN), a hand-picked lower skin survives a
// higher unlock (respect-the-pick), switching slots shows Bikes' Standard model
// and an empty gear slot's coming-soon placeholder, the secret Master skin stays
// hidden until the equipMaster() backdoor grants it, and Escape returns to the
// menu. Run with: node test/equipment_check.js
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
function has(texts, s) { return texts.some(t => t.includes(s)); }

const code = ['js/assets.js', 'js/levels.js', 'js/physics.js', 'js/render.js',
  'js/music.js', 'js/replay.js', 'js/touch.js', 'js/editor.js', 'js/game.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') + `
(async () => {
  await new Promise(r => setImmediate(r));
  pumpFrames(5, 1 / 60);
  key('Enter');            // loading -> intro
  pumpFrames(3, 1 / 60);
  key('Enter');            // intro -> menu
  pumpFrames(3, 1 / 60);
  let texts = frameTexts(3);
  if (!has(texts, 'Equipment')) bad('menu missing the Equipment option: ' + texts.join('|'));

  // Equipment is the 4th grid item after the hero (Records, Replays, Map Editor, Equipment)
  key('ArrowDown'); key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
  key('Enter');            // -> the equipment character sheet (focus starts on the slots)
  pumpFrames(6, 1 / 60);
  texts = frameTexts(3);
  if (!has(texts, 'EQUIPMENT')) bad('sheet missing heading: ' + texts.join('|'));
  if (!has(texts, 'LOADOUT')) bad('sheet missing the loadout column');
  // the slot column lists every slot, including the empty gear ones
  for (const slot of ['Skins', 'Bikes', 'Helmet', 'Jacket', 'Gloves', 'Pants', 'Boots']) {
    if (!has(texts, slot)) bad('loadout missing the ' + slot + ' slot');
  }
  if (!has(texts, 'SKINS')) bad('Skins should be the selected slot (section header)');
  if (!has(texts, 'Standard')) bad('the Bikes slot should show the Standard bike equipped');
  if (!has(texts, '\\u2014')) bad('empty gear slots should read as a dash');
  if (!has(texts, 'Stock Blue')) bad('the Skins slot should list the Stock Blue skin');
  if (!has(texts, 'EQUIPPED')) bad('the worn skin should show an EQUIPPED badge');
  if (!has(texts, 'LOCKED')) bad('an unearned skin should show LOCKED');
  if (has(texts, 'Master')) bad('the secret Master skin must not appear while locked');
  if (!has(texts, 'Back')) bad('sheet should offer a Back button');

  // move focus to the item column and highlight the locked Warmed Up skin -> the
  // detail line reveals its unlock requirement
  key('ArrowRight');       // focus the items
  key('ArrowDown');        // Stock Blue -> Warmed Up (index 1)
  pumpFrames(3, 1 / 60);
  texts = frameTexts(3);
  if (!has(texts, 'Warmed Up')) bad('item list should show the Warmed Up skin');
  if (!has(texts, 'Locked \\u00b7 Clear the Beginner track')) {
    bad('a locked item should reveal its unlock requirement, got: ' + texts.join('|'));
  }

  // equipping a LOCKED item is refused (no storage written)
  key('Enter');
  pumpFrames(2, 1 / 60);
  if ('burger-mania-equip-skin' in store) bad('a locked item must not be equippable');

  // unlock Beginner -> Warmed Up becomes owned and (with no explicit pick) worn
  store['burger-mania-cleared-beginner'] = '1';
  texts = frameTexts(3);
  if (!has(texts, 'EQUIPPED')) bad('Warmed Up should auto-equip once Beginner is cleared');

  // pick the LOWER Stock Blue on purpose: it equips and the live skin drops to 0
  key('ArrowUp');          // Warmed Up -> Stock Blue (index 0)
  key('Enter');
  pumpFrames(3, 1 / 60);
  if (store['burger-mania-equip-skin'] !== 'skin-stock') {
    bad('equipping Stock Blue should persist the choice, got ' + store['burger-mania-equip-skin']);
  }
  if (BIKE_SKIN !== 0) bad('equipping Stock Blue should set the live skin tier to 0, got ' + BIKE_SKIN);

  // respect-the-pick: clearing a HIGHER track must not override the manual choice
  store['burger-mania-cleared-advanced'] = '1';
  window.equipSkin('skin-stock');   // re-applies + refreshes the live tier
  if (BIKE_SKIN !== 0) bad('a hand-picked skin should survive a higher unlock, got ' + BIKE_SKIN);

  // switch slots: focus the loadout column and step down to Bikes, then Helmet
  key('ArrowLeft');        // focus the slots
  key('ArrowDown');        // Skins -> Bikes
  pumpFrames(3, 1 / 60);
  texts = frameTexts(3);
  if (!has(texts, 'BIKES')) bad('the Bikes slot should become selected');
  if (!has(texts, 'Standard')) bad('the Bikes slot should list the Standard bike');

  key('ArrowDown');        // Bikes -> Helmet (an empty gear slot)
  pumpFrames(3, 1 / 60);
  texts = frameTexts(3);
  if (!has(texts, 'HELMET')) bad('the Helmet slot should become selected');
  if (!has(texts, 'Coming soon')) bad('an empty gear slot should show a coming-soon placeholder');

  // secret backdoor: grant + wear Master, then it shows up in the Skins slot
  window.equipMaster();
  if (store['burger-mania-cleared-master'] !== '1') bad('equipMaster should unlock the Master tier');
  if (store['burger-mania-equip-skin'] !== 'skin-master') bad('equipMaster should equip the Master skin');
  if (BIKE_SKIN !== 4) bad('equipMaster should set the live skin tier to 4, got ' + BIKE_SKIN);
  key('ArrowUp'); key('ArrowUp');  // Helmet -> Bikes -> Skins
  pumpFrames(3, 1 / 60);
  texts = frameTexts(3);
  if (!has(texts, 'Master')) bad('Master should appear in the Skins slot once unlocked');

  key('Escape');           // back to the menu
  pumpFrames(3, 1 / 60);
  texts = frameTexts(3);
  if (!has(texts, 'PLAY')) bad('Escape from the sheet should return to the menu');

  console.log(fail ? 'FAILED (' + fail + ')' : 'OK');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL exception:', e); process.exit(1); });
`;
eval(code);
