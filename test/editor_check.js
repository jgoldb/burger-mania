// Map editor check: loads the full script stack under a stubbed DOM,
// walks menu -> Map Editor, then exercises the editing surface with
// synthetic mouse and key events — placing burgers, nut mounds, upside-down
// burgers and doodads (inert sprites: picking sprite + layer), dragging
// vertices and walls, painting glass and clearing it by selecting the edge + Delete,
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

  // ---- burger placement (the +Burger tool, normal kind) + undo/redo ----
  const burgers0 = EDITOR.map.burgers.length;
  key('3');
  if (EDITOR.tool !== 'burger') bad('key 3 should pick the burger tool');
  if (EDITOR.burgerKind !== 'normal') bad('key 3 should arm the normal burger kind');
  pumpFrames(1, 1 / 60);                      // draw the +Burger palette (must not throw)
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

  // ---- flip-burger placement: the +Burger tool's gravity-flip kind ----
  const flip0 = EDITOR.map.flipBurgers.length;
  key('6');
  if (EDITOR.tool !== 'burger') bad('key 6 should pick the burger tool');
  if (EDITOR.burgerKind !== 'flip') bad('key 6 should arm the flip burger kind');
  // the palette's kind buttons emit these ids
  EDITOR.action('burgerKind:normal');
  if (EDITOR.burgerKind !== 'normal') bad('the burger palette should arm the normal kind');
  EDITOR.action('burgerKind:flip');
  if (EDITOR.burgerKind !== 'flip') bad('the burger palette should arm the flip kind');
  mouseDown(440, 320); mouseUp(440, 320);
  if (EDITOR.map.flipBurgers.length !== flip0 + 1) bad('clicking should drop an upside-down burger');
  pumpFrames(2, 1 / 60);                      // draw the palette + flip ghost (must not throw)
  key('z', { ctrlKey: true });
  if (EDITOR.map.flipBurgers.length !== flip0) bad('Ctrl+Z should undo the upside-down burger');
  key('y', { ctrlKey: true });
  if (EDITOR.map.flipBurgers.length !== flip0 + 1) bad('Ctrl+Y should redo the upside-down burger');
  key('1');

  // ---- doodad placement: arm a sprite + layer from the palette, drop it ----
  const dood0 = EDITOR.map.doodads.length;
  key('7');
  if (EDITOR.tool !== 'doodad') bad('key 7 should pick the doodad tool');
  mouseDown(520, 360); mouseUp(520, 360);
  if (EDITOR.map.doodads.length !== dood0 + 1) bad('clicking should drop a doodad');
  let dd = EDITOR.map.doodads[dood0];
  if (dd.type !== 'ac') bad('first doodad should be the default A/C sprite, got ' + dd.type);
  if (dd.layer !== 'back') bad('a doodad should default to the back layer, got ' + dd.layer);
  pumpFrames(2, 1 / 60);                      // draw the palette panel + every sprite thumbnail (must not throw)
  key('z', { ctrlKey: true });
  if (EDITOR.map.doodads.length !== dood0) bad('Ctrl+Z should undo the doodad');
  key('y', { ctrlKey: true });
  if (EDITOR.map.doodads.length !== dood0 + 1) bad('Ctrl+Y should redo the doodad');

  // the palette arms a specific sprite + layer (the ids its buttons emit)
  EDITOR.action('doodadPick:rack');
  EDITOR.action('doodadLayer:front');
  if (EDITOR.doodadType !== 'rack') bad('the palette should arm the squat rack, got ' + EDITOR.doodadType);
  if (EDITOR.doodadLayer !== 'front') bad('the palette should arm the front layer, got ' + EDITOR.doodadLayer);
  mouseDown(600, 300); mouseUp(600, 300);
  const dd2 = EDITOR.map.doodads[EDITOR.map.doodads.length - 1];
  if (dd2.type !== 'rack') bad('placing should use the armed squat rack, got ' + dd2.type);
  if (dd2.layer !== 'front') bad('placing should use the armed front layer, got ' + dd2.layer);
  EDITOR.action('doodadLayer:back');           // restore for the rest of the run
  key('z', { ctrlKey: true });                 // remove the front rack
  if (EDITOR.map.doodads.length !== dood0 + 1) bad('undo should remove the second doodad');

  // a click on the palette panel itself (its padding, on no button) must be
  // swallowed, not dropped as a doodad behind the panel
  pumpFrames(1, 1 / 60);                        // refresh the palette hitboxes
  const stray0 = EDITOR.map.doodads.length;
  mouseDown(15, 300); mouseUp(15, 300);
  if (EDITOR.map.doodads.length !== stray0) bad('clicking the palette panel must not place a doodad');

  // ---- the doodad selects, drags, and deletes like the other objects ----
  key('1');
  const ox = EDITOR.map.doodads[dood0].x, oy = EDITOR.map.doodads[dood0].y;
  let dsel = w2s(ox, oy);
  mouseDown(dsel.x, dsel.y); mouseUp(dsel.x, dsel.y);
  if (!EDITOR.sel || EDITOR.sel.kind !== 'doodad') bad('clicking a doodad should select it');
  let ddrag = w2s(ox + 2, oy - 1);
  mouseDown(dsel.x, dsel.y); mouseMove(ddrag.x, ddrag.y); mouseUp(ddrag.x, ddrag.y);
  if (Math.abs(EDITOR.map.doodads[dood0].x - (ox + 2)) > 0.2) bad('dragging should move the doodad');
  key('Delete');
  if (EDITOR.map.doodads.length !== dood0) bad('Delete should remove a selected doodad');
  key('z', { ctrlKey: true });                 // undo brings it back
  if (EDITOR.map.doodads.length !== dood0 + 1) bad('undo should restore the deleted doodad');
  key('1');

  // ---- glass: paint an edge, then clear it by selecting + Delete ----
  key('4');
  if (EDITOR.tool !== 'glass') bad('key 4 should pick the glass tool');
  let s = w2s(30, 0), s2;                     // a point on the box floor (edge 2)
  mouseDown(s.x, s.y); mouseUp(s.x, s.y);
  if (EDITOR.map.glassEdges.length !== 1) {
    bad('painting should glass one edge, got ' + JSON.stringify(EDITOR.map.glassEdges));
  } else if (EDITOR.map.glassEdges[0][0] !== 0 || EDITOR.map.glassEdges[0][1] !== 2) {
    bad('glass landed on edge ' + JSON.stringify(EDITOR.map.glassEdges[0]) + ', wanted [0,2] (the floor)');
  }
  key('1');                                   // select tool
  if (EDITOR.tool !== 'select') bad('key 1 should pick the select tool');
  s = w2s(30, 0);                             // click the glassed floor edge
  mouseDown(s.x, s.y); mouseUp(s.x, s.y);
  if (!EDITOR.sel || EDITOR.sel.kind !== 'edge') bad('clicking the floor should select its edge');
  key('Delete');                              // Del clears glass off a selected edge
  if (EDITOR.map.glassEdges.length !== 0) bad('Delete on a glassed edge should clear the glass');
  key('z', { ctrlKey: true });                // undo: the glass returns
  if (EDITOR.map.glassEdges.length !== 1) bad('undo should restore the deleted glass');

  // ---- vertex drag: pull the floor-right corner (the map bounds) ----
  key('1');
  s = w2s(65, 0); s2 = w2s(67, 1);
  mouseDown(s.x, s.y); mouseMove(s2.x, s2.y); mouseUp(s2.x, s2.y);
  const corner = EDITOR.map.polygons[0][2];
  if (Math.abs(corner[0] - 67) > 0.2 || Math.abs(corner[1] - 1) > 0.2) {
    bad('vertex drag landed at ' + JSON.stringify(corner) + ', wanted ~[67,1]');
  }

  // ---- double-click an edge to add a vertex ----
  const verts0 = EDITOR.map.polygons[0].length;
  s = w2s(32.5, -16);                        // the ceiling's midpoint
  dblClick(s.x, s.y);
  if (EDITOR.map.polygons[0].length !== verts0 + 1) {
    bad('double-clicking an edge should insert a vertex');
  }

  // ---- island polygon ----
  key('2');
  for (const [px, py] of [[25, -6], [35, -6], [30, -2.5]]) {
    s = w2s(px, py);
    mouseDown(s.x, s.y); mouseUp(s.x, s.y);
  }
  key('Enter');
  if (EDITOR.map.polygons.length !== 2) bad('the poly tool should close an island');
  key('1');
  s = w2s(30, -6);                            // the island's top edge
  mouseDown(s.x, s.y); mouseUp(s.x, s.y);

  // ---- rider preview: a non-destructive collider gauge ----
  if (EDITOR.riderPreview) bad('rider preview should start off');
  const polysBefore = JSON.stringify(EDITOR.map.polygons);
  s = w2s(30, -6);
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
  if (!back.doodads || back.doodads.length !== EDITOR.map.doodads.length) bad('round trip lost doodads');
  else if (back.doodads[0].type !== EDITOR.map.doodads[0].type ||
           back.doodads[0].layer !== EDITOR.map.doodads[0].layer) {
    bad('round trip mangled a doodad, got ' + JSON.stringify(back.doodads[0]));
  }
  if (!back.glassEdges || back.glassEdges.length !== 1) bad('round trip lost the glass edge');
  // the ceiling vertex inserted above split edge 0, bumping the floor to edge 3
  else if (back.glassEdges[0][1] !== 3) {
    bad('glass edge should track the vertex insert to [0,3], got ' + JSON.stringify(back.glassEdges[0]));
  }
  if (JSON.stringify(back.goal) !== JSON.stringify(EDITOR.map.goal)) bad('round trip moved the goal');
  if (back.groundY !== 0) bad('round trip lost the backdrop ground pin (groundY:0), got ' + back.groundY);
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
  s = w2s(25, -6); s2 = w2s(28, -4);           // grab a corner, drag by ~(+3,+2)
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

  // ---- rotate handle: spin a doodad about its anchor and a whole polygon
  //      about its centroid; both snap to 15° detents and undo cleanly ----
  key('1');
  // a selected doodad floats a handle straight above its base anchor
  const rdx = EDITOR.map.doodads[dood0].x, rdy = EDITOR.map.doodads[dood0].y;
  let rsel = w2s(rdx, rdy);
  mouseDown(rsel.x, rsel.y); mouseUp(rsel.x, rsel.y);
  if (!EDITOR.sel || EDITOR.sel.kind !== 'doodad') bad('clicking a doodad should select it for rotation');
  const rh = EDITOR.rotateHandle;
  if (!rh) bad('a selected doodad should expose a rotate handle');
  else {
    const rhs = w2s(rh.x, rh.y);
    const rtgt = w2s(rdx + 3, rdy);            // drag the handle due-right of the anchor: a +90° turn
    mouseDown(rhs.x, rhs.y); mouseMove(rtgt.x, rtgt.y); mouseUp(rtgt.x, rtgt.y);
    if (Math.abs(EDITOR.map.doodads[dood0].angle - Math.PI / 2) > 0.02) {
      bad('dragging the rotate handle should spin the doodad ~90°, got ' + EDITOR.map.doodads[dood0].angle);
    }
    // the angle survives a .bmm round trip
    const rtrip = EDITOR.parse(EDITOR.serialize());
    if (!rtrip.doodads[dood0] || Math.abs(rtrip.doodads[dood0].angle - Math.PI / 2) > 0.02) {
      bad('round trip should preserve the doodad angle, got ' + JSON.stringify(rtrip.doodads[dood0]));
    }
    key('z', { ctrlKey: true });               // undo the spin -> upright again
    if (Math.abs(EDITOR.map.doodads[dood0].angle || 0) > 1e-6) bad('undo should restore the doodad upright');
  }
  // a whole-polygon selection spins about its vertex centroid
  key('1');
  const poly0 = EDITOR.map.polygons[1].map(v => v.slice());
  const pcx = (poly0[0][0] + poly0[1][0] + poly0[2][0]) / 3;
  const pcy = (poly0[0][1] + poly0[1][1] + poly0[2][1]) / 3;
  let pgrab = w2s(poly0[0][0], poly0[0][1]);
  mouseDown(pgrab.x, pgrab.y, { shiftKey: true }); mouseUp(pgrab.x, pgrab.y);
  if (!EDITOR.sel || EDITOR.sel.kind !== 'poly') bad('Shift+click should select the whole polygon for rotation');
  const prh = EDITOR.rotateHandle;
  if (!prh) bad('a polygon selection should expose a rotate handle');
  else {
    const prhs = w2s(prh.x, prh.y);
    const ptgt = w2s(pcx + 3, pcy);            // drag the handle due-right of the centroid: a +90° turn
    mouseDown(prhs.x, prhs.y); mouseMove(ptgt.x, ptgt.y); mouseUp(ptgt.x, ptgt.y);
    const exp = poly0.map(([x, y]) => [pcx - (y - pcy), pcy + (x - pcx)]);
    const got = EDITOR.map.polygons[1];
    if (!got.every((v, i) => Math.abs(v[0] - exp[i][0]) < 0.1 && Math.abs(v[1] - exp[i][1]) < 0.1)) {
      bad('rotating a polygon +90° should land vertices at ' + JSON.stringify(exp) + ', got ' + JSON.stringify(got));
    }
    key('z', { ctrlKey: true });               // undo the spin -> back to the unrotated triangle
    if (JSON.stringify(EDITOR.map.polygons[1]) !== JSON.stringify(poly0)) bad('undo should restore the rotated polygon');
  }
  key('1');

  // ---- delete: a triangle keeps 3 points; Shift+Del drops the whole polygon ----
  s = w2s(25, -6);
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
  let cgp = w2s(38.4, -2.8);
  mouseDown(cgp.x, cgp.y); mouseUp(cgp.x, cgp.y);
  let cgb = EDITOR.map.burgers[EDITOR.map.burgers.length - 1];
  if (Math.abs(cgb[0] - 38) > 0.02 || Math.abs(cgb[1] + 3) > 0.02) {
    bad('the coarsened grid should snap a burger to whole units, got ' + JSON.stringify(cgb));
  }
  key('z', { ctrlKey: true });                // remove the test burger
  key(']'); key(']'); key(']');               // back to the 0.1 fine grid
  mouseDown(cgp.x, cgp.y); mouseUp(cgp.x, cgp.y);
  cgb = EDITOR.map.burgers[EDITOR.map.burgers.length - 1];
  if (Math.abs(cgb[0] - 38.4) > 0.02) {
    bad('the fine grid should keep a ~0.1 burger coordinate, got ' + JSON.stringify(cgb));
  }
  key('z', { ctrlKey: true });                // remove that one too

  // ---- grid toggle + Shift-snap a lone vertex to the visible grid ----
  key('1');
  let gv = w2s(67, 1);                         // the box's dragged corner vertex
  mouseDown(gv.x, gv.y);                       // no Shift at grab = single-vertex drag
  const gvSel = EDITOR.sel;
  if (!gvSel || gvSel.kind !== 'vertex') bad('grabbing a corner should select a vertex');
  // grid is off by default, so Shift snaps to whole units -> (63, -2)
  mouseMove(w2s(63.4, -1.7).x, w2s(63.4, -1.7).y, { shiftKey: true });
  let gvv = EDITOR.map.polygons[gvSel.pi][gvSel.vi];
  if (Math.abs(gvv[0] - 63) > 0.01 || Math.abs(gvv[1] + 2) > 0.01) {
    bad('with the grid off, Shift-drag should snap to whole units, got ' + JSON.stringify(gvv));
  }
  key('#');                                    // show the grid -> Shift snaps to half-units
  mouseMove(w2s(63.4, -1.7).x, w2s(63.4, -1.7).y, { shiftKey: true });
  gvv = EDITOR.map.polygons[gvSel.pi][gvSel.vi];
  if (Math.abs(gvv[0] - 63.5) > 0.01 || Math.abs(gvv[1] + 1.5) > 0.01) {
    bad('with the grid on, Shift-drag should snap to half-units, got ' + JSON.stringify(gvv));
  }
  // releasing Shift mid-drag returns to the fine placement grid
  mouseMove(w2s(63.4, -1.7).x, w2s(63.4, -1.7).y);
  gvv = EDITOR.map.polygons[gvSel.pi][gvSel.vi];
  if (Math.abs(gvv[0] - 63.4) > 0.02) {
    bad('without Shift the drag should use the fine grid, got ' + JSON.stringify(gvv));
  }
  key('#');                                    // restore the grid to its default (off)
  mouseUp(w2s(63.4, -1.7).x, w2s(63.4, -1.7).y);
  key('z', { ctrlKey: true });                // restore the corner to (67, 1)

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

  // ---- refresh recovery: a map restored from the autosave cache is dirty ----
  // Spin up a second editor instance (as if the page had reloaded) sharing the
  // same localStorage. It recovers the autosaved working map — which was never
  // written to a .bmm — so it must come up dirty, or New/Load would silently
  // throw the recovered work away instead of warning first.
  if (!store.has('burger-mania-editor-map')) bad('the editing session should have autosaved a working map');
  const editorSrc = fs.readFileSync(path.join(root, 'js/editor.js'), 'utf8')
    .replace('const EDITOR = (() => {', 'globalThis.EDITOR2 = (() => {');
  if (!/EDITOR2/.test(editorSrc)) bad('editor.js wrapper changed - the reload test can no longer rebind it');
  eval(editorSrc);                             // direct eval: sees prepareLevel/REPLAY/etc. from this scope
  EDITOR2.open(800, 600);
  if (!EDITOR2.map) bad('a reloaded editor should recover the autosaved working map');
  EDITOR2.action('new');
  if (!EDITOR2.confirmOpen) bad('a map recovered from the autosave cache must be dirty, so New warns first');

  // ---- toolbar dropdowns: View (toggles) + Theme (picker) ----
  key('1');                                    // select tool: no tool palette open
  pumpFrames(1, 1 / 60);                        // populate the toolbar hitboxes
  const viewBtn = EDITOR.buttonRect('view');
  const themeBtn = EDITOR.buttonRect('theme');
  if (!viewBtn) bad('the toolbar should have a View menu button');
  if (!themeBtn) bad('the toolbar should have a Theme menu button');
  const clickBtn = b => { mouseDown(b.x + b.w / 2, b.y + b.h / 2); mouseUp(b.x + b.w / 2, b.y + b.h / 2); };
  // open the View dropdown, draw it, toggle a setting through its row action
  clickBtn(viewBtn);
  if (EDITOR.menu !== 'view') bad('clicking View should open its dropdown');
  pumpFrames(1, 1 / 60);                        // draw the dropdown (must not throw)
  const rider0 = EDITOR.riderPreview;
  EDITOR.action('rider');                       // the Rider row emits this
  if (EDITOR.riderPreview === rider0) bad('the View menu Rider row should toggle the preview');
  EDITOR.action('rider');                       // toggle it back
  // the Background row blacks out the theme backdrop (view state, not map data)
  if (!EDITOR.background) bad('the theme background should start on');
  const polysBg = JSON.stringify(EDITOR.map.polygons);
  EDITOR.action('background');                   // the Background row emits this
  if (EDITOR.background) bad('the View menu Background row should toggle the backdrop off');
  pumpFrames(1, 1 / 60);                         // draw with the backdrop off (must not throw)
  if (JSON.stringify(EDITOR.map.polygons) !== polysBg) bad('toggling the background must not edit the map');
  EDITOR.action('background');                   // restore the backdrop
  if (!EDITOR.background) bad('the Background row should toggle the backdrop back on');
  clickBtn(viewBtn);                            // clicking View again closes it
  if (EDITOR.menu !== null) bad('clicking View again should close its dropdown');
  // open the Theme dropdown and pick a theme through a row action (closes it)
  clickBtn(themeBtn);
  if (EDITOR.menu !== 'theme') bad('clicking Theme should open its dropdown');
  pumpFrames(1, 1 / 60);
  EDITOR.action('theme:volcano');
  if (EDITOR.themeName !== 'volcano') bad('the Theme menu should set the picked theme, got ' + EDITOR.themeName);
  if (EDITOR.menu !== null) bad('picking a theme should close the dropdown');
  EDITOR.action('theme:meadow');                // restore the meadow theme
  // a click in open space dismisses an open dropdown
  clickBtn(themeBtn);
  if (EDITOR.menu !== 'theme') bad('Theme should reopen');
  pumpFrames(1, 1 / 60);
  mouseDown(700, 500); mouseUp(700, 500);       // empty world, away from all chrome
  if (EDITOR.menu !== null) bad('a click in open space should dismiss the dropdown');
  key('1');

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
