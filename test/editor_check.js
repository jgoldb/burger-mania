// Map editor check: loads the full script stack under a stubbed DOM,
// walks menu -> Map Editor, then exercises the editing surface with
// synthetic mouse and key events — placing burgers, dragging vertices and
// walls, painting glass and clearing it by selecting the edge + Delete,
// drawing an island polygon, Shift+dragging a whole polygon, cycling the
// placement grid, the dense-grid toggle and Shift-snapping a lone vertex,
// deleting vertices/polygons, renaming, undo/redo, theme cycling — and
// finally serializes the map, round-trips it through the .bmm parser, and
// takes a test ride.
// Run with: node test/editor_check.js
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

// ---- DOM globals the scripts touch ----
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
// a real store, so the editor's working-map autosave has somewhere to live
const store = new Map();
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
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
function key(k, mods) {
  for (const fn of windowHandlers.keydown || []) {
    fn(Object.assign({ key: k, preventDefault() {}, repeat: false,
      ctrlKey: false, shiftKey: false, metaKey: false }, mods || {}));
  }
}
function mouseDown(x, y, mods) {
  for (const fn of canvasHandlers.mousedown || []) {
    fn(Object.assign({ clientX: x, clientY: y, button: 0, preventDefault() {} }, mods || {}));
  }
}
function mouseMove(x, y, mods) {
  for (const fn of canvasHandlers.mousemove || []) {
    fn(Object.assign({ clientX: x, clientY: y, preventDefault() {} }, mods || {}));
  }
}
function mouseUp(x, y) {
  for (const fn of windowHandlers.mouseup || []) fn({ clientX: x, clientY: y });
}
function dblClick(x, y) {
  for (const fn of canvasHandlers.dblclick || []) {
    fn({ clientX: x, clientY: y, preventDefault() {} });
  }
}

const code = ['js/assets.js', 'js/levels.js', 'js/physics.js', 'js/render.js',
  'js/music.js', 'js/replay.js', 'js/touch.js', 'js/editor.js', 'js/game.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') + `
let playedNow = null;
const origPlay = MUSIC.play;
MUSIC.play = name => { playedNow = MUSIC.songs[name] ? name : null; origPlay(name); };

(async () => {
  await new Promise(r => setImmediate(r));   // let loadAssets settle
  pumpFrames(5, 1 / 60);
  key('Enter');                              // loading -> intro
  pumpFrames(3, 1 / 60);
  key('Enter');                              // intro -> menu
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'menu') bad('menu should play menu, got ' + playedNow);

  // ---- into the editor ----
  key('ArrowDown');                          // Play -> Map Editor
  key('Enter');
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'meadow') bad('editor should play its theme song, got ' + playedNow);
  if (!EDITOR.map) bad('the editor has no working map');
  if (EDITOR.map.polygons.length !== 1) bad('template should start with 1 polygon');
  if (EDITOR.tool !== 'select') bad('editor should open in the select tool');
  const w2s = EDITOR.worldToScreen;

  // ---- burger placement + undo/redo ----
  const burgers0 = EDITOR.map.burgers.length;
  key('3');
  if (EDITOR.tool !== 'burger') bad('key 3 should pick the burger tool');
  mouseDown(400, 300); mouseUp(400, 300);    // the view centre is mid-box
  if (EDITOR.map.burgers.length !== burgers0 + 1) bad('clicking should drop a burger');
  key('z', { ctrlKey: true });
  if (EDITOR.map.burgers.length !== burgers0) bad('Ctrl+Z should undo the burger');
  key('y', { ctrlKey: true });
  if (EDITOR.map.burgers.length !== burgers0 + 1) bad('Ctrl+Y should redo the burger');

  // ---- nut mound placement (the lethal hazard) + undo/redo + draw ----
  const nuts0 = EDITOR.map.nuts.length;
  key('5');
  if (EDITOR.tool !== 'nut') bad('key 5 should pick the nut tool');
  mouseDown(360, 280); mouseUp(360, 280);
  if (EDITOR.map.nuts.length !== nuts0 + 1) bad('clicking should drop a nut mound');
  pumpFrames(2, 1 / 60);                      // draw a frame with the mound (must not throw)
  key('z', { ctrlKey: true });
  if (EDITOR.map.nuts.length !== nuts0) bad('Ctrl+Z should undo the nut mound');
  key('y', { ctrlKey: true });
  if (EDITOR.map.nuts.length !== nuts0 + 1) bad('Ctrl+Y should redo the nut mound');
  key('1');

  // ---- upside-down (gravity-flip) burger placement + undo/redo + draw ----
  const flip0 = EDITOR.map.flipBurgers.length;
  key('6');
  if (EDITOR.tool !== 'flip') bad('key 6 should pick the flip-burger tool');
  mouseDown(440, 320); mouseUp(440, 320);
  if (EDITOR.map.flipBurgers.length !== flip0 + 1) bad('clicking should drop an upside-down burger');
  pumpFrames(2, 1 / 60);                      // draw a frame with the badge (must not throw)
  key('z', { ctrlKey: true });
  if (EDITOR.map.flipBurgers.length !== flip0) bad('Ctrl+Z should undo the upside-down burger');
  key('y', { ctrlKey: true });
  if (EDITOR.map.flipBurgers.length !== flip0 + 1) bad('Ctrl+Y should redo the upside-down burger');
  key('1');

  // ---- glass: paint an edge, then clear it by selecting + Delete ----
  key('4');
  if (EDITOR.tool !== 'glass') bad('key 4 should pick the glass tool');
  let s = w2s(25, 8), s2;                     // a point on the box floor (edge 2)
  mouseDown(s.x, s.y); mouseUp(s.x, s.y);
  if (EDITOR.map.glassEdges.length !== 1) {
    bad('painting should glass one edge, got ' + JSON.stringify(EDITOR.map.glassEdges));
  } else if (EDITOR.map.glassEdges[0][0] !== 0 || EDITOR.map.glassEdges[0][1] !== 2) {
    bad('glass landed on edge ' + JSON.stringify(EDITOR.map.glassEdges[0]) + ', wanted [0,2] (the floor)');
  }
  key('1');                                   // select tool
  if (EDITOR.tool !== 'select') bad('key 1 should pick the select tool');
  s = w2s(25, 8);                             // click the glassed floor edge
  mouseDown(s.x, s.y); mouseUp(s.x, s.y);
  if (!EDITOR.sel || EDITOR.sel.kind !== 'edge') bad('clicking the floor should select its edge');
  key('Delete');                              // Del clears glass off a selected edge
  if (EDITOR.map.glassEdges.length !== 0) bad('Delete on a glassed edge should clear the glass');
  key('z', { ctrlKey: true });                // undo: the glass returns
  if (EDITOR.map.glassEdges.length !== 1) bad('undo should restore the deleted glass');

  // ---- vertex drag: pull the floor-right corner (the map bounds) ----
  key('1');
  s = w2s(60, 8); s2 = w2s(62, 9);
  mouseDown(s.x, s.y); mouseMove(s2.x, s2.y); mouseUp(s2.x, s2.y);
  const corner = EDITOR.map.polygons[0][2];
  if (Math.abs(corner[0] - 62) > 0.2 || Math.abs(corner[1] - 9) > 0.2) {
    bad('vertex drag landed at ' + JSON.stringify(corner) + ', wanted ~[62,9]');
  }

  // ---- double-click an edge to add a vertex ----
  const verts0 = EDITOR.map.polygons[0].length;
  s = w2s(27.5, -8);                         // the ceiling's midpoint
  dblClick(s.x, s.y);
  if (EDITOR.map.polygons[0].length !== verts0 + 1) {
    bad('double-clicking an edge should insert a vertex');
  }

  // ---- island polygon ----
  key('2');
  for (const [px, py] of [[20, 2], [30, 2], [25, 5.5]]) {
    s = w2s(px, py);
    mouseDown(s.x, s.y); mouseUp(s.x, s.y);
  }
  key('Enter');
  if (EDITOR.map.polygons.length !== 2) bad('the poly tool should close an island');
  key('1');
  s = w2s(25, 2);                            // the island's top edge
  mouseDown(s.x, s.y); mouseUp(s.x, s.y);

  // ---- rider preview: a non-destructive collider gauge ----
  if (EDITOR.riderPreview) bad('rider preview should start off');
  const polysBefore = JSON.stringify(EDITOR.map.polygons);
  s = w2s(25, 2);
  mouseMove(s.x, s.y);                        // park the cursor over the world
  key('r');
  if (!EDITOR.riderPreview) bad('R should turn the rider preview on');
  pumpFrames(2, 1 / 60);                      // draw a frame with it on (must not throw)
  key('r');
  if (EDITOR.riderPreview) bad('R should toggle the rider preview back off');
  if (JSON.stringify(EDITOR.map.polygons) !== polysBefore) bad('rider preview must not edit the map');

  // ---- renaming (letters must not trigger tools) ----
  key('n');
  for (let i = 0; i < 20; i++) key('Backspace');
  for (const ch of 'Burger Lab') key(ch);
  if (EDITOR.tool !== 'select') bad('typing a name must not switch tools');
  key('Enter');
  if (EDITOR.map.name !== 'Burger Lab') bad('rename produced "' + EDITOR.map.name + '"');

  // ---- theme cycling reaches the music ----
  key('t');
  if (EDITOR.themeName !== 'volcano') bad('T should cycle the theme to volcano');
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'volcano') bad('editor should follow the theme song, got ' + playedNow);

  // ---- .bmm round trip ----
  const text = EDITOR.serialize();
  const back = EDITOR.parse(text);
  if (back.name !== 'Burger Lab') bad('round trip lost the name');
  if (back.theme !== 'volcano') bad('round trip lost the theme');
  if (back.polygons.length !== 2) bad('round trip lost a polygon');
  if (back.burgers.length !== EDITOR.map.burgers.length) bad('round trip lost burgers');
  if (!back.nuts || back.nuts.length !== EDITOR.map.nuts.length) bad('round trip lost nut mounds');
  if (!back.flipBurgers || back.flipBurgers.length !== EDITOR.map.flipBurgers.length) bad('round trip lost upside-down burgers');
  if (!back.glassEdges || back.glassEdges.length !== 1) bad('round trip lost the glass edge');
  // the ceiling vertex inserted above split edge 0, bumping the floor to edge 3
  else if (back.glassEdges[0][1] !== 3) {
    bad('glass edge should track the vertex insert to [0,3], got ' + JSON.stringify(back.glassEdges[0]));
  }
  if (JSON.stringify(back.goal) !== JSON.stringify(EDITOR.map.goal)) bad('round trip moved the goal');
  for (const junk of ['{"format":"nope"}', '{"format":"burger-mania-map","version":1}']) {
    try { EDITOR.parse(junk); bad('parse accepted junk: ' + junk); }
    catch (e) { /* good */ }
  }

  // ---- the nut mound selects, drags, and deletes like a burger ----
  key('1');
  const n0 = EDITOR.map.nuts[0].slice();
  let ns = w2s(n0[0], n0[1]);
  mouseDown(ns.x, ns.y); mouseUp(ns.x, ns.y);
  if (!EDITOR.sel || EDITOR.sel.kind !== 'nut') bad('clicking a nut mound should select it');
  let nd = w2s(n0[0] + 2, n0[1] + 1);
  mouseDown(ns.x, ns.y); mouseMove(nd.x, nd.y); mouseUp(nd.x, nd.y);
  if (Math.abs(EDITOR.map.nuts[0][0] - (n0[0] + 2)) > 0.2) bad('dragging should move the nut mound');
  key('Delete');
  if (EDITOR.map.nuts.length !== nuts0) bad('Delete should remove a selected nut mound');
  key('z', { ctrlKey: true });               // undo the delete brings it back
  if (EDITOR.map.nuts.length !== nuts0 + 1) bad('undo should restore the deleted nut mound');

  // ---- the upside-down burger selects, drags, and deletes like a burger ----
  const f0 = EDITOR.map.flipBurgers[0].slice();
  let fs2 = w2s(f0[0], f0[1]);
  mouseDown(fs2.x, fs2.y); mouseUp(fs2.x, fs2.y);
  if (!EDITOR.sel || EDITOR.sel.kind !== 'flip') bad('clicking an upside-down burger should select it');
  let fd = w2s(f0[0] + 2, f0[1] + 1);
  mouseDown(fs2.x, fs2.y); mouseMove(fd.x, fd.y); mouseUp(fd.x, fd.y);
  if (Math.abs(EDITOR.map.flipBurgers[0][0] - (f0[0] + 2)) > 0.2) bad('dragging should move the upside-down burger');
  key('Delete');
  if (EDITOR.map.flipBurgers.length !== flip0) bad('Delete should remove a selected upside-down burger');
  key('z', { ctrlKey: true });               // undo the delete brings it back
  if (EDITOR.map.flipBurgers.length !== flip0 + 1) bad('undo should restore the deleted upside-down burger');

  // ---- whole-polygon move: Shift+drag the island translates every vertex ----
  key('1');
  const isle0 = EDITOR.map.polygons[1].map(v => v.slice());
  s = w2s(20, 2); s2 = w2s(23, 4);            // grab a corner, drag by ~(+3,+2)
  mouseDown(s.x, s.y, { shiftKey: true });
  if (!EDITOR.sel || EDITOR.sel.kind !== 'poly') bad('Shift+click should select the whole polygon');
  mouseMove(s2.x, s2.y); mouseUp(s2.x, s2.y);
  const isle1 = EDITOR.map.polygons[1];
  if (!isle1.every((v, i) => Math.abs(v[0] - (isle0[i][0] + 3)) < 0.2 &&
                             Math.abs(v[1] - (isle0[i][1] + 2)) < 0.2)) {
    bad('Shift+drag should translate every island vertex by ~(+3,+2), got ' + JSON.stringify(isle1));
  }
  key('z', { ctrlKey: true });                // undo the move
  if (JSON.stringify(EDITOR.map.polygons[1]) !== JSON.stringify(isle0)) {
    bad('undo should restore the moved polygon');
  }

  // ---- delete: a triangle keeps 3 points; Shift+Del drops the whole polygon ----
  s = w2s(20, 2);
  mouseDown(s.x, s.y); mouseUp(s.x, s.y);     // select an island corner vertex
  if (!EDITOR.sel || EDITOR.sel.kind !== 'vertex') bad('clicking a corner should select a vertex');
  key('Delete');                              // refused: a triangle can't lose a vertex
  if (EDITOR.map.polygons[1].length !== 3) bad('Del must keep a triangle at its 3 points');
  key('Delete', { shiftKey: true });          // Shift+Del removes the whole island
  if (EDITOR.map.polygons.length !== 1) bad('Shift+Del should remove the whole polygon');
  key('z', { ctrlKey: true });                // undo brings it back
  if (EDITOR.map.polygons.length !== 2) bad('undo should restore the deleted polygon');

  // ---- placement grid: [ coarsens the snap step, ] refines it ----
  key('3');                                   // burger tool
  key('['); key('['); key('[');               // 0.1 -> 0.25 -> 0.5 -> 1.0
  let cgp = w2s(33.4, 5.2);
  mouseDown(cgp.x, cgp.y); mouseUp(cgp.x, cgp.y);
  let cgb = EDITOR.map.burgers[EDITOR.map.burgers.length - 1];
  if (Math.abs(cgb[0] - 33) > 0.02 || Math.abs(cgb[1] - 5) > 0.02) {
    bad('the coarsened grid should snap a burger to whole units, got ' + JSON.stringify(cgb));
  }
  key('z', { ctrlKey: true });                // remove the test burger
  key(']'); key(']'); key(']');               // back to the 0.1 fine grid
  mouseDown(cgp.x, cgp.y); mouseUp(cgp.x, cgp.y);
  cgb = EDITOR.map.burgers[EDITOR.map.burgers.length - 1];
  if (Math.abs(cgb[0] - 33.4) > 0.02) {
    bad('the fine grid should keep a ~0.1 burger coordinate, got ' + JSON.stringify(cgb));
  }
  key('z', { ctrlKey: true });                // remove that one too

  // ---- grid toggle + Shift-snap a lone vertex to the visible grid ----
  key('1');
  let gv = w2s(62, 9);                         // the box's dragged corner vertex
  mouseDown(gv.x, gv.y);                       // no Shift at grab = single-vertex drag
  const gvSel = EDITOR.sel;
  if (!gvSel || gvSel.kind !== 'vertex') bad('grabbing a corner should select a vertex');
  // grid is off by default, so Shift snaps to whole units -> (58, 6)
  mouseMove(w2s(58.4, 6.3).x, w2s(58.4, 6.3).y, { shiftKey: true });
  let gvv = EDITOR.map.polygons[gvSel.pi][gvSel.vi];
  if (Math.abs(gvv[0] - 58) > 0.01 || Math.abs(gvv[1] - 6) > 0.01) {
    bad('with the grid off, Shift-drag should snap to whole units, got ' + JSON.stringify(gvv));
  }
  key('#');                                    // show the grid -> Shift snaps to half-units
  mouseMove(w2s(58.4, 6.3).x, w2s(58.4, 6.3).y, { shiftKey: true });
  gvv = EDITOR.map.polygons[gvSel.pi][gvSel.vi];
  if (Math.abs(gvv[0] - 58.5) > 0.01 || Math.abs(gvv[1] - 6.5) > 0.01) {
    bad('with the grid on, Shift-drag should snap to half-units, got ' + JSON.stringify(gvv));
  }
  // releasing Shift mid-drag returns to the fine placement grid
  mouseMove(w2s(58.4, 6.3).x, w2s(58.4, 6.3).y);
  gvv = EDITOR.map.polygons[gvSel.pi][gvSel.vi];
  if (Math.abs(gvv[0] - 58.4) > 0.02) {
    bad('without Shift the drag should use the fine grid, got ' + JSON.stringify(gvv));
  }
  key('#');                                    // restore the grid to its default (off)
  mouseUp(w2s(58.4, 6.3).x, w2s(58.4, 6.3).y);
  key('z', { ctrlKey: true });                // restore the corner to (62, 9)

  // ---- test ride: keys go to the bike, not the tools ----
  key('Enter', { ctrlKey: true });
  key('b');                                  // would switch tools in the editor
  if (EDITOR.tool !== 'select') bad('editor keys leaked into the test ride');
  key('ArrowUp');
  pumpFrames(60, 1 / 60);
  key('ArrowUp');                            // keyup isn't wired here; harmless
  if (playedNow !== 'volcano') bad('test ride should keep the map song, got ' + playedNow);
  key('Escape');                             // back to the editor
  key('b');
  if (EDITOR.tool !== 'burger') bad('Esc should return to the editor');
  key('1');

  // ---- New / Load: discard-changes dialog, and confirming wipes the undo history ----
  key('3');                                    // an unsaved edit -> the map is dirty
  mouseDown(410, 300); mouseUp(410, 300);
  key('1');
  if (EDITOR.confirmOpen) bad('no confirm dialog should be open yet');
  EDITOR.action('new');                        // New with unsaved changes
  if (!EDITOR.confirmOpen) bad('New on a dirty map should raise the discard dialog');
  const polysWas = EDITOR.map.polygons.length;
  key('3');                                    // the modal must swallow other keys
  if (EDITOR.tool !== 'select') bad('the confirm dialog should swallow tool keys');
  pumpFrames(1, 1 / 60);                       // draw the dialog (must not throw)
  key('Escape');                               // cancel keeps the current map
  if (EDITOR.confirmOpen) bad('Escape should close the dialog');
  if (EDITOR.map.polygons.length !== polysWas) bad('cancelling New must not change the map');
  EDITOR.action('load');                       // Load raises it too
  if (!EDITOR.confirmOpen) bad('Load on a dirty map should raise the discard dialog');
  key('Escape');                               // cancel without touching the file picker
  if (EDITOR.confirmOpen) bad('Escape should close the Load dialog');
  if (EDITOR.map.polygons.length !== polysWas) bad('cancelling Load must not change the map');
  EDITOR.action('new');                        // now confirm a New
  key('Enter');                                // Enter = Discard
  if (EDITOR.confirmOpen) bad('Enter should close the dialog');
  if (EDITOR.map.polygons.length !== 1 || EDITOR.map.name !== 'Untitled Map') {
    bad('confirming New should load a fresh template, got ' + EDITOR.map.name);
  }
  key('z', { ctrlKey: true });                 // New wiped the history -> nothing to undo
  if (EDITOR.map.polygons.length !== 1 || EDITOR.map.name !== 'Untitled Map') {
    bad('Undo must not restore a map discarded by New, got ' + EDITOR.map.name);
  }
  EDITOR.action('new');                        // a fresh template is not dirty
  if (EDITOR.confirmOpen) bad('New on a fresh (unedited) template should not re-prompt');

  // ---- out to the menu ----
  key('Escape');                             // clears any selection
  key('Escape');
  key('Escape');
  pumpFrames(3, 1 / 60);
  if (playedNow !== 'menu') bad('Esc from a clean editor should reach the menu, got ' + playedNow);

  console.log(fail ? 'FAILED (' + fail + ')' : 'OK');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL exception:', e); process.exit(1); });
`;
eval(code);
