'use strict';

// The Map Editor: a full-screen scene (the 'editor' state in game.js) for
// building custom courses with a GUI. The working map is the exact level
// shape js/levels.js uses — polygons (the playable area is the inside;
// nested polygons are solid islands), start, burgers, goal, theme, plus the
// optional object/terrain fields: `nuts` [x,y] lethal mounds, `flipBurgers`
// [x,y] gravity-reversing burgers (identical to the rider, marked only in the
// editor), `glassEdges` [poly, edge] pairs (obsidian the tires barely grip,
// painted on per-edge), `noCollide` [poly, edge] pairs (edges the rider rides
// straight through — the wall still draws, but doesn't collide),
// `invisible` [poly] indices (polygons that keep their collision but draw
// nothing — solid yet unseen), `frontPolys` [poly] indices (polygons drawn on
// the foreground layer, over the rider), and `blendPolys` [poly] indices (the
// same foreground layer with no outline + a union fill, so several merge into
// one seamless mass). Maps save to
// .bmm files: JSON whose body IS a level entry plus a format header, so a
// finished map can be saved into levels/tracks/<trackId>/ and added to a track's
// `files` list in js/levels.js (the game fetches and parses it at boot).
//
// The world view renders through the real drawWorld/drawBurger/drawPopcorn
// renderers, so what the editor shows is what the rider gets. game.js owns
// the surrounding state machine and routes input here; the Test button
// hands the exported level back to game.js for a real ride.
const EDITOR = (() => {
  const FORMAT = 'burger-mania-map';
  const VERSION = 2;             // 2 = per-edge glassEdges; 1 = legacy x-spans
  const EXT = '.bmm';
  // passed through REPLAY's file-dialog plumbing (same API, map flavored)
  const PICKER = {
    types: [{ description: 'Burger Mania map', accept: { 'application/json': [EXT] } }],
    id: 'burger-mania-maps',
    accept: EXT + ',application/json',
  };
  const AUTOSAVE_KEY = 'burger-mania-editor-map';
  let SNAP = 0.1;                    // placement grid (world units); [ and ] cycle it
  const SNAP_STEPS = [1, 0.5, 0.25, 0.1];  // coarse -> fine
  const BRUSH_R = 14;                // glass brush reach (screen px)
  const ZOOM_MIN = 4, ZOOM_MAX = 140;
  const UNDO_MAX = 200;
  const FONT = '"Consolas","Courier New",monospace';
  // the Select tool's rotate handle (a fully-selected polygon or a doodad): a
  // grabbable disc floating above the object, in screen px so it stays a
  // constant size at any zoom. Dragging it spins the object about its pivot,
  // snapped to ROT_SNAP unless Shift is held (then free).
  const ROT_SNAP = Math.PI / 12;     // 15-degree rotation detents
  const ROT_GAP = 26;                // handle's lift above the object (screen px)
  const ROT_DISC = 7;                // handle disc radius (screen px)
  const ROT_HIT = 12;                // handle grab radius (screen px)

  // game.js supplies these: leaving to the menu, starting a test ride,
  // and the shared UI blip
  let hooks = { exit() {}, test() {}, blip() {} };

  let map = null;        // the working level (raw levels.js shape)
  let prepared = null;   // prepareLevel(map), rebuilt after every change
  let cam = { x: 0, y: 0 };
  let zoom = 36;         // screen px per world unit
  let tool = 'select';   // select | poly | object | glass | doodad
  // the +Object tool drops a placed object, chosen from its palette: a normal
  // burger, one of four directional gravity burgers (each identical to a normal
  // one in play — collecting it SETS gravity up/down/left/right, Elasto-Mania
  // gravity-apple style), or a lethal nut mound. Burgers and gravity burgers
  // share the map.flipBurgers array (a gravity burger carries its direction as a
  // third entry, [x, y, dir]); nuts live in map.nuts.
  let objectKind = 'burger'; // 'burger' | 'flipUp' | 'flipDown' | 'flipLeft' | 'flipRight' | 'nut'
  // objectKind -> gravity-burger direction (and the directions a burger can set)
  const OBJ_FLIP_DIR = { flipUp: 'up', flipDown: 'down', flipLeft: 'left', flipRight: 'right' };
  const FLIP_DIRS = ['up', 'down', 'left', 'right'];
  const normFlipDir = d => FLIP_DIRS.indexOf(d) >= 0 ? d : 'up';
  // the +Edge tool (tool id stays 'glass') has two brushes, chosen from its
  // palette, both painted onto edges exactly like the glass brush: 'glass'
  // paints obsidian (low grip), 'nocollide' marks an edge the rider passes
  // straight through (the wall still draws — see map.noCollide)
  let glassMode = 'glass';   // 'glass' | 'nocollide'
  // the +Poly tool draws either a normal polygon or an 'invisible' one (full
  // collision, but drawn only here in the editor — see map.invisible)
  let polyMode = 'solid';    // 'solid' | 'invisible'
  // ...and on the back, front, or blend layer (like a doodad). A 'front' polygon
  // keeps normal collision but draws OVER the rider and the doodads (see
  // map.frontPolys / drawForeground), so pairing one with noCollide walls lets
  // the rider slip behind it, out of view. A 'blend' polygon is the same
  // foreground layer with the outline suppressed and a union fill, so several
  // stitch into one seamless mass (map.blendPolys). Defaults to back (terrain).
  let polyLayer = 'back';    // 'back' (behind rider) | 'front' (over him) | 'blend' (over him, merged)
  // the +Doodad tool drops the current sprite onto the current layer, both
  // chosen from the tool's palette panel
  let doodadType = DOODADS[0].id;
  let doodadLayer = 'back';   // 'back' (behind the rider) | 'front' (over him)
  // which toolbar dropdown is open (null = none): 'view' (Rider/Grid/Background
  // toggles) or 'theme' (the theme picker)
  let menu = null;
  let sel = null;        // {kind: vertex|edge|burger|start|goal|doodad, ...}
  let hov = null;        // same shape, under the cursor (select tool only)
  let drag = null;       // active mouse drag: pan | move | paint
  let draft = null;      // poly tool: vertices placed so far
  let naming = false, nameBuf = '';
  let undoStack = [], redoStack = [];
  let nudgeAt = 0;       // coalesces arrow-key nudges into one undo step
  let status = '', statusAt = 0;
  let dirty = false;     // edited since the last save/load
  let busy = false;      // a file dialog is open
  let helpOpen = false;
  let confirmPrompt = null; // { verb, run } while a discard-changes dialog is up
  let confirmRects = [];    // confirm-dialog button hitboxes, rebuilt every draw
  let showRider = false; // overlay the rider's wheel + head colliders, parked
                         // on the surface under the cursor (a clearance gauge)
  let showGrid = false;  // draw the alignment grid; off (default) hides it entirely
  let showBg = true;     // paint the theme's backdrop behind the geometry; off
                         // blackens the play area (the scenery can distract)
  let mx = 0, my = 0;    // last pointer position (screen px)
  let scrW = 800, scrH = 600;
  let uiRects = [];      // toolbar hitboxes, rebuilt every draw
  let toolbarBottom = 0; // y the toolbar ends at, so popups dock below it
  // open popups (tool palette and/or dropdown), each { bounds, rects }, rebuilt
  // every draw. mouseDown/cursor read them; a click inside a popup is swallowed.
  let popups = [];
  let autosaveAt = 0;
  // the Load folder browser (see "Load overlay" below). `mapDir` is the chosen
  // maps folder handle, kept across opens so we only prompt once; `browse` is
  // the modal view state while the overlay is up (null when closed); its hit
  // rects and a generation counter (which drops stale async folder scans) ride
  // alongside.
  let mapDir = null;
  let browse = null;
  let browseRects = [];
  let browseGen = 0;
  let browseDrag = null;   // { grab } while dragging the file-list scrollbar thumb

  // ---------- map data ----------

  // a simple box to sculpt: ceiling, right wall, long flat floor, left
  // wall. Two starter burgers so a fresh map is instantly finishable. The
  // bottom-left corner sits at the world origin (0,0) and groundY:0 pins the
  // theme's backdrop ground to that floor, so a fresh map reads as sitting on
  // the ground (not floating above it) in every theme. Shipped levels carry no
  // groundY and are untouched.
  function template() {
    return {
      name: 'Untitled Map',
      theme: 'meadow',
      groundY: 0,
      polygons: [[[0, -16], [65, -16], [65, 0], [0, 0]]],
      // start is the bike's FRAME CENTRE; -1.05 rests the wheels (which now hang
      // anchorY 0.60 + wheelR 0.40 = 1.00 below the centre) just above this
      // template's floor at y=0. Was -0.75, tuned to the older, smaller bike.
      start: { x: 7.5, y: -1.05 },
      burgers: [[25, -0.7], [45, -0.7]],
      goal: [60, -0.75],
      nuts: [],
      defibs: [],
      flipBurgers: [],
      glassEdges: [],
      noCollide: [],
      invisible: [],
      frontPolys: [],
      blendPolys: [],
      doodads: [],
    };
  }

  const round2 = v => Math.round(v * 100) / 100;
  // rotation is stored in radians; keep four places so detents (multiples of
  // 15 degrees) round-trip cleanly without float dust
  const round4 = v => Math.round(v * 10000) / 10000;
  // fold an angle into (-PI, PI] so saved values stay small after many turns
  function normAngle(a) {
    a = a % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    else if (a <= -Math.PI) a += Math.PI * 2;
    return a;
  }
  // round to the live grid, then trim binary float noise (0.1-style grids
  // aren't exact in floating point, so 0.3 would land as 0.30000000000000004)
  const snap = v => Math.round(Math.round(v / SNAP) * SNAP * 1e6) / 1e6;
  // snap to the nearest drawn grid line for alignment: half-unit when the
  // grid is shown (it draws half-unit subdivisions), whole units when hidden.
  // 0.5 and 1 are exact in floating point, so no noise to trim.
  const gridSnap = v => { const g = showGrid ? 0.5 : 1; return Math.round(v / g) * g; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function exportLevel() {
    const L = {
      name: map.name,
      theme: map.theme,
      polygons: map.polygons.map(poly => poly.map(v => [round2(v[0]), round2(v[1])])),
      start: { x: round2(map.start.x), y: round2(map.start.y) },
      burgers: map.burgers.map(b => [round2(b[0]), round2(b[1])]),
      goal: [round2(map.goal[0]), round2(map.goal[1])],
    };
    // optional render hint: where to pin the theme backdrop's ground line.
    // Inert when absent (older maps, shipped levels), so no version bump.
    if (map.groundY != null) L.groundY = round2(map.groundY);
    if (map.nuts.length) L.nuts = map.nuts.map(n => [round2(n[0]), round2(n[1])]);
    // defibrillator one-ups: additive + inert when absent (like nuts), so a map
    // without any round-trips byte-identical and no replay/map version bumps
    if (map.defibs.length) L.defibs = map.defibs.map(d => [round2(d[0]), round2(d[1])]);
    // a gravity burger keeps its direction as a 3rd entry; 'up' (the legacy
    // reverse-gravity burger) is omitted so old maps round-trip byte-identical
    if (map.flipBurgers.length) L.flipBurgers = map.flipBurgers.map(b =>
      b[2] && b[2] !== 'up' ? [round2(b[0]), round2(b[1]), b[2]] : [round2(b[0]), round2(b[1])]);
    if (map.glassEdges.length) L.glassEdges = map.glassEdges.map(e => [e[0], e[1]]);
    // no-collision edges and invisible polygons: additive + inert when absent,
    // so omitting them keeps older maps and replays byte-identical (like nuts)
    if (map.noCollide.length) L.noCollide = map.noCollide.map(e => [e[0], e[1]]);
    if (map.invisible.length) L.invisible = map.invisible.slice();
    if (map.frontPolys.length) L.frontPolys = map.frontPolys.slice();
    if (map.blendPolys.length) L.blendPolys = map.blendPolys.slice();
    if (map.doodads.length) {
      L.doodads = map.doodads.map(d => {
        const o = { type: d.type, x: round2(d.x), y: round2(d.y), layer: d.layer };
        // angle is optional + inert: omitted on upright props, so older
        // maps (and the renderer's default) are unaffected
        if (d.angle) o.angle = round4(d.angle);
        return o;
      });
    }
    return L;
  }

  function serialize() {
    return JSON.stringify(Object.assign(
      { format: FORMAT, version: VERSION, savedAt: new Date().toISOString() },
      exportLevel()));
  }

  function isPt(p) {
    return Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]);
  }

  function isDoodad(o) {
    return o && typeof o === 'object' && typeof o.type === 'string' &&
      isFinite(o.x) && isFinite(o.y);
  }

  // the footprint box of a placed doodad, for hit-testing and overlays: its
  // sprite footprint from the registry, anchored at the base centre (x, y),
  // with a small skirt below the base so the contact line is grabbable
  function doodadBox(d) {
    const def = DOODAD_BY_ID[d.type] || { w: 1, h: 1 };
    return { x0: d.x - def.w / 2, y0: d.y - def.h, x1: d.x + def.w / 2, y1: d.y + 0.12 };
  }

  // is (wx, wy) inside a doodad's footprint? A tilted doodad rotates about its
  // base anchor, so inverse-rotate the cursor into the prop's upright frame and
  // test it against the axis-aligned footprint box there.
  function doodadHit(d, wx, wy) {
    let px = wx, py = wy;
    const a = d.angle || 0;
    if (a) {
      const dx = wx - d.x, dy = wy - d.y, c = Math.cos(a), s = Math.sin(a);
      px = d.x + dx * c + dy * s;
      py = d.y - dx * s + dy * c;
    }
    const b = doodadBox(d);
    return px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1;
  }

  // validates enough that the renderer, the sim, and a LEVELS entry can't
  // be handed something that blows up mid-ride
  function parse(text) {
    const d = JSON.parse(text);
    if (d.format !== FORMAT) throw new Error('not a Burger Mania map');
    // version 1 maps store glass as x-spans; parseGlass migrates them
    if (d.version !== 1 && d.version !== VERSION) {
      // flag it the way REPLAY.parse does, so the Load folder browser can count
      // these as a known "different version" skip rather than silent corruption
      const e = new Error('unsupported map version ' + d.version);
      e.versionMismatch = true;
      throw e;
    }
    if (!Array.isArray(d.polygons) || !d.polygons.length ||
        !d.polygons.every(p => Array.isArray(p) && p.length >= 3 && p.every(isPt))) {
      throw new Error('map polygons are damaged');
    }
    if (!d.start || !isFinite(d.start.x) || !isFinite(d.start.y)) {
      throw new Error('map start is damaged');
    }
    if (!Array.isArray(d.burgers) || !d.burgers.every(isPt)) {
      throw new Error('map burgers are damaged');
    }
    if (!isPt(d.goal)) throw new Error('map goal is damaged');
    // nut mounds + upside-down burgers are optional (added after v2); absent
    // on older maps, validated as point lists when present
    if (d.nuts != null && (!Array.isArray(d.nuts) || !d.nuts.every(isPt))) {
      throw new Error('map nut mounds are damaged');
    }
    if (d.flipBurgers != null && (!Array.isArray(d.flipBurgers) || !d.flipBurgers.every(isPt))) {
      throw new Error('map upside-down burgers are damaged');
    }
    // defibrillators are optional point lists too (added after v2), validated
    // when present
    if (d.defibs != null && (!Array.isArray(d.defibs) || !d.defibs.every(isPt))) {
      throw new Error('map defibrillators are damaged');
    }
    // doodads are optional inert sprites (added after v2); a record needs a
    // string type and finite x/y. Unknown types are kept and simply skipped
    // when drawn, so a map authored in a newer build still loads.
    if (d.doodads != null && (!Array.isArray(d.doodads) || !d.doodads.every(isDoodad))) {
      throw new Error('map doodads are damaged');
    }
    const polygons = d.polygons.map(p => p.map(v => [Number(v[0]), Number(v[1])]));
    return {
      name: typeof d.name === 'string' && d.name ? d.name : 'Mystery Map',
      theme: typeof d.theme === 'string' ? d.theme : 'meadow',
      // optional backdrop-ground pin; undefined on older maps -> no shift
      groundY: typeof d.groundY === 'number' && isFinite(d.groundY) ? Number(d.groundY) : undefined,
      polygons,
      start: { x: Number(d.start.x), y: Number(d.start.y) },
      burgers: d.burgers.map(b => [Number(b[0]), Number(b[1])]),
      goal: [Number(d.goal[0]), Number(d.goal[1])],
      nuts: Array.isArray(d.nuts) ? d.nuts.map(n => [Number(n[0]), Number(n[1])]) : [],
      defibs: Array.isArray(d.defibs) ? d.defibs.map(d2 => [Number(d2[0]), Number(d2[1])]) : [],
      flipBurgers: Array.isArray(d.flipBurgers) ? d.flipBurgers.map(b => [Number(b[0]), Number(b[1]), normFlipDir(b[2])]) : [],
      glassEdges: parseGlass(d, polygons),
      noCollide: parseNoCollide(d, polygons),
      invisible: parsePolyIndices(d.invisible, polygons, 'invisible polygons'),
      frontPolys: parsePolyIndices(d.frontPolys, polygons, 'foreground polygons'),
      blendPolys: parsePolyIndices(d.blendPolys, polygons, 'blend polygons'),
      doodads: Array.isArray(d.doodads) ? d.doodads.map(o =>
        ({ type: String(o.type), x: Number(o.x), y: Number(o.y),
           layer: o.layer === 'front' ? 'front' : 'back',
           angle: isFinite(o.angle) ? Number(o.angle) : 0 })) : [],
    };
  }

  // glass is per-edge ([poly, edge] pairs). A version-1 map instead carries
  // x-spans in d.glass; convert them with the same midpoint rule prepareLevel
  // uses, so an old map loads to the exact edges it always rendered as glass.
  function parseGlass(d, polygons) {
    if (Array.isArray(d.glassEdges)) {
      const ok = d.glassEdges.every(e =>
        Array.isArray(e) && e.length === 2 &&
        Number.isInteger(e[0]) && e[0] >= 0 && e[0] < polygons.length &&
        Number.isInteger(e[1]) && e[1] >= 0 && e[1] < polygons[e[0]].length);
      if (!ok) throw new Error('map glass edges are damaged');
      return d.glassEdges.map(e => [e[0], e[1]]);
    }
    const spans = Array.isArray(d.glass) ? d.glass : [];
    if (!spans.every(isPt)) throw new Error('map glass spans are damaged');
    return spansToEdges(polygons,
      spans.map(g => [Math.min(g[0], g[1]), Math.max(g[0], g[1])]));
  }

  // no-collision edges: optional [polyIndex, edgeIndex] pairs (added after v2),
  // same shape as glassEdges. Absent on older maps -> none; validated in range
  // (edge i runs poly[i]->poly[i+1], so the index range matches the vertex count).
  function parseNoCollide(d, polygons) {
    if (d.noCollide == null) return [];
    if (!Array.isArray(d.noCollide) || !d.noCollide.every(e =>
        Array.isArray(e) && e.length === 2 &&
        Number.isInteger(e[0]) && e[0] >= 0 && e[0] < polygons.length &&
        Number.isInteger(e[1]) && e[1] >= 0 && e[1] < polygons[e[0]].length)) {
      throw new Error('map no-collision edges are damaged');
    }
    return d.noCollide.map(e => [e[0], e[1]]);
  }

  // a list of polygon indices (added after v2): the invisible flag and the
  // front/blend layer flags all take this shape. Absent on older maps -> none;
  // validated as in-range polygon indices.
  function parsePolyIndices(arr, polygons, label) {
    if (arr == null) return [];
    if (!Array.isArray(arr) || !arr.every(p =>
        Number.isInteger(p) && p >= 0 && p < polygons.length)) {
      throw new Error('map ' + label + ' are damaged');
    }
    return arr.slice();
  }

  // the midpoint rule prepareLevel classifies glass with — kept in step here
  // so legacy x-spans migrate to exactly the edges they used to flag
  function spansToEdges(polygons, spans) {
    if (!spans.length) return [];
    const out = [];
    polygons.forEach((poly, pi) => {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const mx = (a[0] + b[0]) / 2;
        if (spans.some(r => mx >= r[0] && mx <= r[1])) out.push([pi, i]);
      }
    });
    return out;
  }

  function commit(force) {
    prepared = prepareLevel(map);
    dirty = true;
    // the working map autosaves to localStorage so a browser refresh (or
    // an accidental tab close) never loses an unsaved course; throttled
    // because drags commit on every mouse move
    const now = performance.now();
    if (force || now - autosaveAt > 500) {
      autosaveAt = now;
      try { localStorage.setItem(AUTOSAVE_KEY, serialize()); } catch (e) { /* full/blocked: skip */ }
    }
  }

  function pushUndo() {
    undoStack.push(JSON.stringify(map));
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack.length = 0;
  }

  // swapping in a whole new map (New / Load) is a clean break, not an edit:
  // wipe the history so Undo can't drag the discarded map back
  function resetHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
  }

  function undo() {
    if (!undoStack.length) { note('Nothing to undo'); return; }
    redoStack.push(JSON.stringify(map));
    map = JSON.parse(undoStack.pop());
    sel = null; hov = null;
    commit(true);
    note('Undo');
  }

  function redo() {
    if (!redoStack.length) { note('Nothing to redo'); return; }
    undoStack.push(JSON.stringify(map));
    map = JSON.parse(redoStack.pop());
    sel = null; hov = null;
    commit(true);
    note('Redo');
  }

  function note(msg) {
    status = msg;
    statusAt = performance.now();
  }

  // odd containment count = the playable inside (evenodd, like the fill)
  function inPlayable(x, y) {
    let n = 0;
    for (const poly of map.polygons) if (pointInPoly(x, y, poly)) n++;
    return n % 2 === 1;
  }

  // soft sanity checks surfaced on save/test; never blocking, since a
  // half-built map is the normal working state
  function warnings() {
    const out = [];
    if (!inPlayable(map.start.x, map.start.y)) out.push('the start is buried in ground');
    if (!inPlayable(map.goal[0], map.goal[1])) out.push('the goal is buried in ground');
    const buried = map.burgers.filter(b => !inPlayable(b[0], b[1])).length;
    if (buried) out.push(buried + (buried > 1 ? ' burgers are' : ' burger is') + ' buried in ground');
    const buriedNuts = map.nuts.filter(n => !inPlayable(n[0], n[1])).length;
    if (buriedNuts) out.push(buriedNuts + (buriedNuts > 1 ? ' nut mounds are' : ' nut mound is') + ' buried in ground');
    const buriedFlip = map.flipBurgers.filter(b => !inPlayable(b[0], b[1])).length;
    if (buriedFlip) out.push(buriedFlip + (buriedFlip > 1 ? ' upside-down burgers are' : ' upside-down burger is') + ' buried in ground');
    return out;
  }

  function warnText() {
    const w = warnings();
    return w.length ? ' - warning: ' + w.join('; ') : '';
  }

  // ---------- view ----------

  function s2w(sx, sy) {
    return { x: cam.x + (sx - scrW / 2) / zoom, y: cam.y + (sy - scrH / 2) / zoom };
  }

  function w2s(wx, wy) {
    return { x: scrW / 2 + (wx - cam.x) * zoom, y: scrH / 2 + (wy - cam.y) * zoom };
  }

  function fitView() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of map.polygons) {
      for (const [x, y] of poly) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    cam.x = (minX + maxX) / 2;
    cam.y = (minY + maxY) / 2;
    const z = Math.min(scrW / (maxX - minX + 4), scrH / (maxY - minY + 8));
    zoom = isFinite(z) ? clamp(z, ZOOM_MIN, ZOOM_MAX) : 36;
  }

  function zoomAt(sx, sy, f) {
    const before = s2w(sx, sy);
    zoom = clamp(zoom * f, ZOOM_MIN, ZOOM_MAX);
    const after = s2w(sx, sy);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  }

  // ---------- editing operations ----------

  function setTool(t) {
    tool = t;
    draft = null;
    if (t !== 'select') { sel = null; hov = null; }
    // a tool change closes any dropdown and retires popup hitboxes at once, so
    // a later click can't land on a stale popup rect before the next redraw
    closeMenu();
  }

  // ---------- per-edge markers (glass + no-collision) ----------

  // Both glass and no-collision live as [poly, edge] pairs (edge i = segment
  // poly[i]->poly[i+1]); they renumber identically when a polygon's edges
  // change, so one set of helpers keeps either list in step: splitting an edge
  // (inserting a vertex) keeps BOTH halves marked, deleting a vertex drops the
  // two edges it merged, and removing a polygon renumbers the rest. Each returns
  // the new list (callers assign it back), so glass and noCollide reuse them.
  function remapEdgesVertexInsert(list, pi, vi) {
    const out = [];
    for (const e of list) {
      if (e[0] !== pi || e[1] < vi) out.push(e);
      else if (e[1] > vi) out.push([e[0], e[1] + 1]);
      else { out.push([pi, vi]); out.push([pi, vi + 1]); } // the split edge: both halves
    }
    return out;
  }

  function remapEdgesVertexDelete(list, pi, vi, n) {
    const prev = (vi - 1 + n) % n;        // the other edge folded into the merge
    return list
      .filter(e => e[0] !== pi || (e[1] !== vi && e[1] !== prev))
      .map(e => (e[0] === pi && e[1] > vi ? [e[0], e[1] - 1] : e));
  }

  function remapEdgesPolyDelete(list, pi) {
    return list
      .filter(e => e[0] !== pi)
      .map(e => (e[0] > pi ? [e[0] - 1, e[1]] : e));
  }

  // a poly-index list (the invisible flag, the front/blend layer flags) renumbers
  // when a polygon below it is removed; returns the new list (caller assigns it)
  function remapPolyIndexDelete(list, pi) {
    return list
      .filter(p => p !== pi)
      .map(p => (p > pi ? p - 1 : p));
  }

  // the themes offered in the editor's Theme menu / T-cycle: every theme except
  // those flagged `hidden` in THEMES (still fully renders, just not pickable here)
  function editorThemeNames() {
    return Object.keys(THEMES).filter(n => !THEMES[n].hidden);
  }

  function cycleTheme() {
    const names = editorThemeNames();
    pushUndo();
    map.theme = names[(names.indexOf(map.theme) + 1) % names.length] || names[0];
    commit(true);
    note('Theme: ' + map.theme);
  }

  function toggleRider() {
    showRider = !showRider;
    note(showRider
      ? 'Rider preview on - wheels (blue) and head (red) colliders, parked on the surface below the cursor'
      : 'Rider preview off');
  }

  function toggleGrid() {
    showGrid = !showGrid;
    note(showGrid ? 'Grid on' : 'Grid off');
  }

  function toggleBackground() {
    showBg = !showBg;
    note(showBg ? 'Theme background on' : 'Theme background off - play area blacked out');
  }

  // step the placement grid coarser (dir -1) or finer (dir +1) through
  // SNAP_STEPS, clamped at the ends. Affects future placements/drags/nudges
  // only, not existing geometry, so it changes no map data (no undo)
  function cycleSnap(dir) {
    const i = Math.max(0, SNAP_STEPS.indexOf(SNAP));
    SNAP = SNAP_STEPS[Math.min(SNAP_STEPS.length - 1, Math.max(0, i + dir))];
    note('Grid snap: ' + SNAP + (SNAP === 1 ? ' unit' : ' units'));
  }

  function startNaming() {
    naming = true;
    nameBuf = map.name;
  }

  function finishNaming(apply) {
    if (apply) {
      const name = nameBuf.trim() || 'Untitled Map';
      if (name !== map.name) {
        pushUndo();
        map.name = name;
        commit(true);
      }
    }
    naming = false;
  }

  function addBurger(w) {
    pushUndo();
    map.burgers.push([snap(w.x), snap(w.y)]);
    commit(true);
  }

  function addNut(w) {
    pushUndo();
    map.nuts.push([snap(w.x), snap(w.y)]);
    commit(true);
  }

  function addDefib(w) {
    pushUndo();
    map.defibs.push([snap(w.x), snap(w.y)]);
    commit(true);
  }

  function addFlip(w) {
    pushUndo();
    map.flipBurgers.push([snap(w.x), snap(w.y), OBJ_FLIP_DIR[objectKind] || 'up']);
    commit(true);
  }

  function addDoodad(w) {
    pushUndo();
    map.doodads.push({ type: doodadType, x: snap(w.x), y: snap(w.y), layer: doodadLayer, angle: 0 });
    commit(true);
  }

  // the +Doodad tool's two settings (which sprite, which layer), driven by the
  // palette. They only affect the next placement, so they touch no map data and
  // take no undo.
  function setDoodadType(id) {
    if (!DOODAD_BY_ID[id]) return;
    doodadType = id;
    note('Doodad sprite: ' + DOODAD_BY_ID[id].label);
  }

  function setDoodadLayer(layer) {
    doodadLayer = layer === 'front' ? 'front' : 'back';
    note('Doodad layer: ' + (doodadLayer === 'front'
      ? 'front - drawn over the rider' : 'back - drawn behind the rider'));
  }

  // the +Object tool's kind, driven by its palette (placement-only, no undo).
  // Each kind drops into its own map array, so the data model is unchanged.
  function setObjectKind(k) {
    const KINDS = ['burger', 'defib', 'flipUp', 'flipDown', 'flipLeft', 'flipRight', 'nut'];
    objectKind = KINDS.indexOf(k) >= 0 ? k : 'burger';
    const dir = OBJ_FLIP_DIR[objectKind];
    note('Object: ' + (dir
      ? 'gravity burger (' + dir + ') - collecting it sets gravity ' + dir
      : objectKind === 'nut' ? 'nut mound - a lethal hazard'
      : objectKind === 'defib' ? 'defibrillator - collecting it adds a life'
      : 'burger'));
  }

  // drop the armed object at the click (each kind keeps its own undo via its adder)
  function placeObject(w) {
    if (objectKind === 'nut') addNut(w);
    else if (objectKind === 'defib') addDefib(w);
    else if (OBJ_FLIP_DIR[objectKind]) addFlip(w);
    else addBurger(w);
  }

  // the +Edge tool's brush, driven by its palette (no map data, no undo):
  // 'glass' paints obsidian edges, 'nocollide' paints pass-through edges
  function setGlassMode(m) {
    glassMode = m === 'nocollide' ? 'nocollide' : 'glass';
    note(glassMode === 'nocollide'
      ? 'No-Collision brush: paint an edge to let the rider ride through it'
      : 'Glass brush: paint obsidian onto edges');
  }

  // the +Poly tool's mode, driven by its palette (no map data until you draw)
  function setPolyMode(m) {
    polyMode = m === 'invisible' ? 'invisible' : 'solid';
    note(polyMode === 'invisible'
      ? 'Invisible Polygon: solid collision, drawn only in the editor'
      : 'Polygon: a solid shape (one inside the play area is an island)');
  }

  // the +Poly tool's layer, driven by its palette toggles (no map data until you
  // draw). Front draws over the rider as a separate outlined chunk; blend also
  // draws over the rider but with no outline, merging seamlessly into the terrain
  // it covers (stitch one shape from several polys); back is normal terrain.
  function setPolyLayer(layer) {
    polyLayer = layer === 'front' ? 'front' : layer === 'blend' ? 'blend' : 'back';
    note('Polygon layer: ' + (
      polyLayer === 'front' ? 'front - drawn over the rider (collision unchanged)'
      : polyLayer === 'blend' ? 'blend - over the rider, no outline, merged into the terrain it covers'
      : 'back - normal terrain behind the rider'));
  }

  // pick a theme by name from the Theme dropdown (an edit, so it takes undo)
  function setTheme(name) {
    if (!THEMES[name] || name === map.theme) { note('Theme: ' + map.theme); return; }
    pushUndo();
    map.theme = name;
    commit(true);
    note('Theme: ' + name);
  }

  // ---------- toolbar dropdowns ----------

  function toggleMenu(id) { menu = menu === id ? null : id; popups = []; }
  function closeMenu() { menu = null; popups = []; }

  function polyClick(w) {
    if (!draft) draft = [];
    // clicking back on the first vertex closes the loop
    if (draft.length >= 3 &&
        Math.hypot(w.x - draft[0][0], w.y - draft[0][1]) < 14 / zoom) {
      closeDraft();
      return;
    }
    draft.push([snap(w.x), snap(w.y)]);
  }

  function closeDraft() {
    if (!draft || draft.length < 3) {
      note('A polygon needs at least 3 points');
      return;
    }
    pushUndo();
    map.polygons.push(draft);
    const idx = map.polygons.length - 1;
    if (polyMode === 'invisible') map.invisible.push(idx);
    if (polyLayer === 'front') map.frontPolys.push(idx);
    else if (polyLayer === 'blend') map.blendPolys.push(idx);
    draft = null;
    commit(true);
    note(polyMode === 'invisible'
      ? 'Invisible polygon added - solid collision, drawn only here in the editor'
      : polyLayer === 'front'
      ? 'Foreground polygon added - drawn over the rider (collision is normal)'
      : polyLayer === 'blend'
      ? 'Blend polygon added - merged into the terrain it covers, drawn over the rider'
      : 'Polygon added - one inside the playable area is a solid island');
  }

  function deleteVertex(p) {
    if (map.polygons[p.pi].length <= 3) {
      note('Polygons keep at least 3 points - Shift+Del removes the whole polygon');
      return;
    }
    pushUndo();
    const n = map.polygons[p.pi].length;
    map.glassEdges = remapEdgesVertexDelete(map.glassEdges, p.pi, p.vi, n);
    map.noCollide = remapEdgesVertexDelete(map.noCollide, p.pi, p.vi, n);
    map.polygons[p.pi].splice(p.vi, 1);
    sel = null;
    commit(true);
  }

  function deletePolygon(pi) {
    if (map.polygons.length <= 1) {
      note('A map needs at least one polygon');
      return;
    }
    pushUndo();
    map.polygons.splice(pi, 1);
    // glass edges, no-collision edges, the invisible flag and the front/blend
    // layer flags all index by polygon, so they shift down past the removed one
    map.glassEdges = remapEdgesPolyDelete(map.glassEdges, pi);
    map.noCollide = remapEdgesPolyDelete(map.noCollide, pi);
    map.invisible = remapPolyIndexDelete(map.invisible, pi);
    map.frontPolys = remapPolyIndexDelete(map.frontPolys, pi);
    map.blendPolys = remapPolyIndexDelete(map.blendPolys, pi);
    sel = null; hov = null;
    commit(true);
    note('Polygon removed');
  }

  function deleteSel(wholePoly) {
    if (!sel) { note('Nothing selected'); return; }
    switch (sel.kind) {
      case 'vertex':
        if (wholePoly) deletePolygon(sel.pi);
        else deleteVertex(sel);
        return;
      case 'poly':
        deletePolygon(sel.pi);
        return;
      case 'edge': {
        if (wholePoly) { deletePolygon(sel.pi); return; }
        // Del clears an edge's marks: glass (low grip) and/or no-collision
        // (pass-through). A bare edge can't be deleted on its own.
        const gi = map.glassEdges.findIndex(g => g[0] === sel.pi && g[1] === sel.vi);
        const ni = map.noCollide.findIndex(g => g[0] === sel.pi && g[1] === sel.vi);
        if (gi >= 0 || ni >= 0) {
          pushUndo();
          if (gi >= 0) map.glassEdges.splice(gi, 1);
          if (ni >= 0) map.noCollide.splice(ni, 1);
          commit(true);
          note(gi >= 0 && ni >= 0 ? 'Glass and edge collision restored'
            : gi >= 0 ? 'Glass removed' : 'Edge collision restored');
        } else {
          note('That edge has no glass or removed collision - Shift+Del removes the whole polygon');
        }
        return;
      }
      case 'burger':
        pushUndo();
        map.burgers.splice(sel.bi, 1);
        sel = null;
        commit(true);
        return;
      case 'nut':
        pushUndo();
        map.nuts.splice(sel.ni, 1);
        sel = null;
        commit(true);
        return;
      case 'defib':
        pushUndo();
        map.defibs.splice(sel.dfi, 1);
        sel = null;
        commit(true);
        return;
      case 'flip':
        pushUndo();
        map.flipBurgers.splice(sel.fi, 1);
        sel = null;
        commit(true);
        return;
      case 'doodad':
        pushUndo();
        map.doodads.splice(sel.di, 1);
        sel = null;
        commit(true);
        return;
      default:
        note('The start and goal can be moved, not removed');
    }
  }

  // arrows move the selection on the grid; held presses coalesce into a
  // single undo step
  function nudge(dx, dy, big) {
    const step = big ? 1 : SNAP;
    if (!sel || sel.kind === 'edge') {
      cam.x += dx * 60 / zoom;
      cam.y += dy * 60 / zoom;
      return;
    }
    const now = performance.now();
    if (now - nudgeAt > 800) pushUndo();
    nudgeAt = now;
    moveBy(sel, dx * step, dy * step);
    commit(true);
  }

  function moveBy(p, dx, dy) {
    switch (p.kind) {
      case 'vertex': {
        const v = map.polygons[p.pi][p.vi];
        v[0] = round2(v[0] + dx);
        v[1] = round2(v[1] + dy);
        break;
      }
      case 'poly':
        for (const v of map.polygons[p.pi]) {
          v[0] = round2(v[0] + dx);
          v[1] = round2(v[1] + dy);
        }
        break;
      case 'burger': {
        const b = map.burgers[p.bi];
        b[0] = round2(b[0] + dx);
        b[1] = round2(b[1] + dy);
        break;
      }
      case 'nut': {
        const n = map.nuts[p.ni];
        n[0] = round2(n[0] + dx);
        n[1] = round2(n[1] + dy);
        break;
      }
      case 'defib': {
        const d = map.defibs[p.dfi];
        d[0] = round2(d[0] + dx);
        d[1] = round2(d[1] + dy);
        break;
      }
      case 'flip': {
        const b = map.flipBurgers[p.fi];
        b[0] = round2(b[0] + dx);
        b[1] = round2(b[1] + dy);
        break;
      }
      case 'doodad': {
        const d = map.doodads[p.di];
        d.x = round2(d.x + dx);
        d.y = round2(d.y + dy);
        break;
      }
      case 'start':
        map.start.x = round2(map.start.x + dx);
        map.start.y = round2(map.start.y + dy);
        break;
      case 'goal':
        map.goal[0] = round2(map.goal[0] + dx);
        map.goal[1] = round2(map.goal[1] + dy);
        break;
    }
  }

  // New throws away the working map outright, so with unsaved edits it raises a
  // discard-changes dialog first; a clean map runs straight through. (Load defers
  // its own discard prompt until a specific map has actually been chosen - see
  // loadFromBrowser / loadFile - because its browser/picker can still be
  // cancelled, and warning before then would be premature.)
  function confirmIfDirty(verb, fn) {
    if (dirty) confirmPrompt = { verb, run: fn };
    else fn();
  }

  function runConfirm() {
    const p = confirmPrompt;
    confirmPrompt = null;
    if (p) p.run();
  }

  function cancelConfirm() {
    if (!confirmPrompt) return;
    confirmPrompt = null;
    note('Kept the current map');
  }

  function newMap() {
    // a fresh map keeps the theme you were already working in — only the
    // geometry resets, so you don't have to re-pick the world every New
    const keepTheme = map && THEMES[map.theme] ? map.theme : null;
    map = template();
    if (keepTheme) map.theme = keepTheme;
    sel = null; hov = null; draft = null;
    resetHistory();
    commit(true);
    // a pristine template has no edits to lose, so it isn't "unsaved" — clear
    // the flag commit() set (matching loadFile) so New again won't re-prompt
    dirty = false;
    fitView();
    note('Fresh map');
  }

  async function saveFile() {
    if (busy) return;
    busy = true;
    note('Saving...');
    try {
      const fname = (map.name || 'map').replace(/[^\w \-.]/g, '') + EXT;
      const saved = await REPLAY.saveAs(serialize(), fname, null, PICKER);
      dirty = false;
      note('Saved ' + saved + warnText());
    } catch (e) {
      note(e && e.name === 'AbortError' ? '' : 'Save failed: ' + (e.message || e));
    }
    busy = false;
  }

  // swap the working map for a freshly parsed one — the clean break New/Load
  // share: drop the selection, wipe the undo history (so Undo can't drag the
  // old map back), recommit, mark it saved, and frame the whole thing
  function adoptMap(loaded) {
    map = loaded;
    sel = null; hov = null; draft = null;
    resetHistory();
    commit(true);
    dirty = false;
    fitView();
    note('Loaded ' + map.name + (THEMES[map.theme] ? '' : ' - unknown theme "' + map.theme + '" shows as meadow'));
  }

  async function loadFile() {
    if (busy) return;
    busy = true;
    try {
      const loaded = parse(await REPLAY.openFile(PICKER));
      // the native picker is itself cancellable, so only warn about unsaved
      // edits once a real file has come back (mirrors the folder browser)
      if (dirty) confirmPrompt = { verb: 'load this map', run: () => adoptMap(loaded) };
      else adoptMap(loaded);
    } catch (e) {
      if (!(e && e.name === 'AbortError')) note('Load failed: ' + (e.message || e));
    }
    busy = false;
  }

  // ---------- Load overlay (folder browser) ----------
  // Load raises a modal panel instead of a bare file dialog: pick a maps folder
  // once (its handle is remembered in IndexedDB under 'mapDir', kept apart from
  // the replay folder), list every .bmm map in it, preview the highlighted one
  // through the real renderer, and click (or Enter) to load it. Mirrors the
  // game's Replays screen and reuses REPLAY's directory plumbing. Browsers
  // without the File System Access API can't browse a folder, so there Load
  // falls back to the single-file open dialog (loadFile).
  const MAP_DIR = { id: 'burger-mania-maps', key: 'mapDir' };

  function openLoadBrowser() {
    if (!REPLAY.fsSupported) { loadFile(); return; }
    closeMenu();
    naming = false;
    browse = { mode: 'loading', all: [], files: [], sel: 0, scroll: 0, perPage: 1, note: '', query: '' };
    refreshBrowser();
  }

  // (re)scan the chosen folder into browse.files. Async (folder + permission
  // probes), so a generation counter drops a scan superseded by a newer one
  // — e.g. the user changed folders before the first finished.
  async function refreshBrowser() {
    const gen = ++browseGen;
    const stale = () => gen !== browseGen || !browse;
    browse.mode = 'loading';
    browse.note = '';
    if (!mapDir) {
      mapDir = await REPLAY.restoreDir(MAP_DIR.key);
      if (stale()) return;
    }
    if (!mapDir) {
      browse.mode = 'choose';
      browse.note = 'Choose the folder your ' + EXT + ' maps live in.';
      return;
    }
    const readable = await REPLAY.dirPermission(mapDir, false);
    if (stale()) return;
    if (!readable) {
      browse.mode = 'reopen';
      browse.note = 'The browser needs a fresh OK to read "' + mapDir.name + '".';
      return;
    }
    let files, outdated;
    try {
      ({ files, outdated } = await REPLAY.listDir(mapDir, { ext: EXT, parse }));
    } catch (e) {
      if (stale()) return;
      browse.mode = 'error';
      browse.note = 'Could not read "' + mapDir.name + '": ' + (e.message || e);
      return;
    }
    if (stale()) return;
    browse.all = files;          // the full scan; browse.files is filtered from it
    filterBrowser();             // apply any standing search query
    browse.mode = 'list';
    browse.note = files.length
      ? (staleMapNote(outdated) ||
         files.length + (files.length > 1 ? ' maps' : ' map') + ' in "' + mapDir.name + '"')
      : (staleMapNote(outdated) || 'No ' + EXT + ' maps in "' + mapDir.name + '" yet.');
  }

  // maps from a different build can't be opened here (their version is one this
  // editor doesn't know); like the replay browser, hide them but say how many,
  // so the gap isn't a mystery. '' when none were skipped.
  function staleMapNote(n) {
    if (!n) return '';
    return n + (n > 1 ? ' maps are' : ' map is') + ' from a different version and were skipped.';
  }

  // re-derive the visible list (browse.files) from the full scan (browse.all)
  // through the current search query, matching the map's display name OR its
  // filename, case-insensitively. The highlight and scroll snap back to the top
  // so the selection always lands on a visible row.
  function filterBrowser() {
    if (!browse) return;
    const q = (browse.query || '').trim().toLowerCase();
    const all = browse.all || [];
    browse.files = q
      ? all.filter(f => (((f.data && f.data.name) || '') + ' ' + f.name).toLowerCase().includes(q))
      : all.slice();
    browse.sel = 0;
    browse.scroll = 0;
  }

  async function chooseMapFolder() {
    try {
      mapDir = await REPLAY.pickDir(MAP_DIR);
    } catch (e) {
      if (browse && !(e && e.name === 'AbortError')) browse.note = 'Folder dialog failed: ' + (e.message || e);
      return;
    }
    if (browse) refreshBrowser();
  }

  async function reopenMapFolder() {
    if (!mapDir) return;
    if (await REPLAY.dirPermission(mapDir, true)) { if (browse) refreshBrowser(); }
    else if (browse) browse.note = 'Permission denied - try a different folder.';
  }

  function closeBrowser() {
    browse = null;
    browseDrag = null;
    browseGen++;          // abandon any in-flight scan
    browseRects = [];
  }

  // move the highlight (which also drives the preview), keeping it on-screen
  function browseMove(d) {
    if (!browse || browse.mode !== 'list' || !browse.files.length) return;
    browse.sel = clamp(browse.sel + d, 0, browse.files.length - 1);
    if (browse.sel < browse.scroll) browse.scroll = browse.sel;
    else if (browse.sel >= browse.scroll + browse.perPage) browse.scroll = browse.sel - browse.perPage + 1;
  }

  // load the highlighted (or given) map. The file's parsed data is shared with
  // the preview list, so deep-copy it — editing the working map must not mutate
  // the cached preview (and re-opening Load must still show the original).
  // Unsaved edits only raise the discard-changes dialog now (after a map was
  // actually picked), drawn over the still-open browser: confirm loads and
  // closes it, cancel returns to the browser to pick again or back out.
  function loadFromBrowser(i) {
    if (!browse || browse.mode !== 'list') return;
    const f = browse.files[i == null ? browse.sel : i];
    if (!f) return;
    const load = () => { adoptMap(JSON.parse(JSON.stringify(f.data))); closeBrowser(); };
    if (dirty) confirmPrompt = { verb: 'load this map', run: load };
    else load();
  }

  // is the screen point on the file list's scrollbar? (its geometry, browse.bar,
  // is recomputed every draw by drawBrowseBody, and null when the list fits)
  function overBrowseBar(x, y) {
    const b = browse && browse.bar;
    return !!b && hitRect({ x: b.x, y: b.top, w: b.w, h: b.trackH }, x, y);
  }

  // grab the scrollbar: dragging the thumb scrolls; clicking the track jumps the
  // thumb's centre to the pointer (then keeps dragging from there)
  function beginBarDrag(py) {
    const b = browse.bar;
    const onThumb = py >= b.thumbY && py <= b.thumbY + b.thumbH;
    const grab = onThumb ? py - b.thumbY : b.thumbH / 2;
    browseDrag = { grab };
    if (!onThumb) scrollToBar(py);   // a track click jumps straight to it
  }

  // map a pointer y to a scroll position through the live scrollbar geometry
  function scrollToBar(py) {
    const b = browse && browse.bar;
    if (!b || b.maxScroll <= 0 || !browseDrag) return;
    const span = b.trackH - b.thumbH;
    const t = span > 0 ? clamp((py - b.top - browseDrag.grab) / span, 0, 1) : 0;
    browse.scroll = Math.round(t * b.maxScroll);
  }

  // ---------- hit testing ----------

  function pick(wx, wy) {
    const r = 12 / zoom;
    // vertex handles first: they are the densest targets
    let best = null, bestD = r;
    map.polygons.forEach((poly, pi) => poly.forEach((v, vi) => {
      const d = Math.hypot(wx - v[0], wy - v[1]);
      if (d < bestD) { bestD = d; best = { kind: 'vertex', pi, vi }; }
    }));
    if (best) return best;
    for (let bi = 0; bi < map.burgers.length; bi++) {
      const b = map.burgers[bi];
      if (Math.hypot(wx - b[0], wy - b[1]) < Math.max(r, 0.5)) return { kind: 'burger', bi };
    }
    for (let ni = 0; ni < map.nuts.length; ni++) {
      const n = map.nuts[ni];
      if (Math.hypot(wx - n[0], wy - n[1]) < Math.max(r, 0.55)) return { kind: 'nut', ni };
    }
    for (let dfi = 0; dfi < map.defibs.length; dfi++) {
      const d = map.defibs[dfi];
      if (Math.hypot(wx - d[0], wy - d[1]) < Math.max(r, 0.5)) return { kind: 'defib', dfi };
    }
    for (let fi = 0; fi < map.flipBurgers.length; fi++) {
      const b = map.flipBurgers[fi];
      if (Math.hypot(wx - b[0], wy - b[1]) < Math.max(r, 0.5)) return { kind: 'flip', fi };
    }
    if (Math.hypot(wx - map.start.x, wy - map.start.y) < Math.max(r, 0.7)) return { kind: 'start' };
    if (Math.hypot(wx - map.goal[0], wy - map.goal[1]) < Math.max(r, 0.6)) return { kind: 'goal' };
    // doodads after the point handles (so a burger over an A/C unit still wins),
    // topmost first (later in the list draws on top)
    for (let di = map.doodads.length - 1; di >= 0; di--) {
      if (doodadHit(map.doodads[di], wx, wy)) return { kind: 'doodad', di };
    }
    // edges last, so handles win where they overlap
    return pickEdge(wx, wy, 10 / zoom);
  }

  // the nearest polygon edge to (wx, wy) within reach, as {kind, pi, vi, px,
  // py}, or null. Picks in 2D (closest point on the segment, not by x), so a
  // brush hits the one edge under the cursor even where polygons stack at the
  // same x — what the glass tool paints and an edge-select picks.
  function pickEdge(wx, wy, reach) {
    let best = null, bestD = reach;
    map.polygons.forEach((poly, pi) => {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const cp = closestOnSeg(wx, wy, { ax: a[0], ay: a[1], bx: b[0], by: b[1] });
        const d = Math.hypot(wx - cp.x, wy - cp.y);
        if (d < bestD) { bestD = d; best = { kind: 'edge', pi, vi: i, px: cp.x, py: cp.y }; }
      }
    });
    return best;
  }

  function hitRect(r, x, y) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // ---------- rotate handle (Select tool) ----------

  // only a whole-polygon selection or a doodad can be spun; a lone vertex/edge,
  // a burger, the start/goal cannot
  function rotatable(p) {
    return !!p && (p.kind === 'poly' || p.kind === 'doodad');
  }

  // a polygon spins about the average of its vertices: that point is fixed
  // under rotation about itself, so the handle doesn't drift between turns
  function polyCentroid(poly) {
    let sx = 0, sy = 0;
    for (const v of poly) { sx += v[0]; sy += v[1]; }
    return { x: sx / poly.length, y: sy / poly.length };
  }

  // the rotate handle's world geometry for a selection: { pivot, handle }, or
  // null when nothing rotatable is selected. The handle floats ROT_GAP px above
  // the object's top; a doodad's handle rides its tilt (so it stays pinned to
  // the sprite's crown), a polygon's sits straight above its centroid.
  function rotGeom(p) {
    if (!rotatable(p)) return null;
    if (p.kind === 'poly') {
      const poly = map.polygons[p.pi];
      if (!poly) return null;
      const c = polyCentroid(poly);
      let minY = Infinity;
      for (const v of poly) if (v[1] < minY) minY = v[1];
      return { pivot: c, handle: { x: c.x, y: minY - ROT_GAP / zoom } };
    }
    const d = map.doodads[p.di];
    if (!d) return null;
    const def = DOODAD_BY_ID[d.type] || { w: 1, h: 1 };
    const off = def.h + ROT_GAP / zoom;          // anchor-to-handle distance
    const a = d.angle || 0;
    return { pivot: { x: d.x, y: d.y },
             handle: { x: d.x + off * Math.sin(a), y: d.y - off * Math.cos(a) } };
  }

  // is the screen point (sx, sy) on the current selection's rotate handle?
  function rotHandleHit(sx, sy) {
    const g = rotGeom(sel);
    if (!g) return false;
    const h = w2s(g.handle.x, g.handle.y);
    return Math.hypot(sx - h.x, sy - h.y) <= ROT_HIT;
  }

  function overRotateHandle() { return tool === 'select' && rotHandleHit(mx, my); }

  // begin a rotate drag from the handle: freeze the pivot and the starting
  // pointer angle, and snapshot what we'll spin (the polygon's vertices, or the
  // doodad's current angle)
  function beginRotate(w) {
    const g = rotGeom(sel);
    const pivot = g.pivot;
    drag = {
      kind: 'rotate', moved: false, pivot, delta: 0,
      startAng: Math.atan2(w.y - pivot.y, w.x - pivot.x),
      handleVec: { x: g.handle.x - pivot.x, y: g.handle.y - pivot.y },
    };
    if (sel.kind === 'poly') drag.orig = map.polygons[sel.pi].map(v => v.slice());
    else drag.origAngle = map.doodads[sel.di].angle || 0;
  }

  // spin the selection to follow the pointer. Snaps to ROT_SNAP detents unless
  // `free` (Shift) is held. The handle (drawn from drag.delta) tracks along.
  function applyRotate(w, free) {
    const pivot = drag.pivot;
    let delta = Math.atan2(w.y - pivot.y, w.x - pivot.x) - drag.startAng;
    if (!free) delta = Math.round(delta / ROT_SNAP) * ROT_SNAP;
    drag.delta = delta;
    if (sel.kind === 'poly') {
      const poly = map.polygons[sel.pi], cos = Math.cos(delta), sin = Math.sin(delta);
      for (let i = 0; i < poly.length; i++) {
        const ox = drag.orig[i][0] - pivot.x, oy = drag.orig[i][1] - pivot.y;
        poly[i] = [round2(pivot.x + ox * cos - oy * sin),
                   round2(pivot.y + ox * sin + oy * cos)];
      }
    } else {
      map.doodads[sel.di].angle = round4(normAngle(drag.origAngle + delta));
    }
    const deg = Math.round(delta * 180 / Math.PI);
    note('Rotated ' + deg + '°' + (free ? ' (free)' : ''));
  }

  // ---------- input (game.js routes these while state === 'editor') ----------

  function mouseDown(x, y, e) {
    mx = x; my = y;
    // modal discard-changes dialog: only its buttons respond, the rest is inert
    if (confirmPrompt) {
      for (const b of confirmRects) {
        if (hitRect(b, x, y)) {
          hooks.blip();
          if (b.id === 'yes') runConfirm(); else cancelConfirm();
          return;
        }
      }
      return;
    }
    // the Load folder browser is modal too: the scrollbar grabs, a file row
    // loads that map, a footer button acts, everything else is swallowed
    if (browse) {
      if (overBrowseBar(x, y)) { hooks.blip(); beginBarDrag(y); return; }
      for (const b of browseRects) {
        if (hitRect(b, x, y)) {
          hooks.blip();
          if (b.id === 'browseRow') loadFromBrowser(b.idx);
          else if (b.id === 'browseSearchClear') { browse.query = ''; filterBrowser(); }
          else if (b.id === 'browseSearch') { /* always focused: the click just swallows */ }
          else action(b.id);
          return;
        }
      }
      return;
    }
    if (helpOpen) { helpOpen = false; return; }
    for (const b of uiRects) {
      if (hitRect(b, x, y)) {
        if (!b.disabled) {
          hooks.blip();
          // a button with a `menu` toggles its dropdown; the rest act (and
          // close any open dropdown first)
          if (b.menu) toggleMenu(b.menu);
          else { closeMenu(); action(b.id); }
        }
        return;
      }
    }
    // open popups (tool palette / dropdown): a button inside acts; anywhere else
    // inside a panel is swallowed, so a click on it can't reach the world.
    // Topmost (last-drawn) first, so an overlapping dropdown wins over a palette.
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      if (hitRect(p.bounds, x, y)) {
        for (const b of p.rects) {
          if (hitRect(b, x, y)) { hooks.blip(); action(b.id); break; }
        }
        return;
      }
    }
    // a click in open space with a dropdown showing just dismisses it
    if (menu) { closeMenu(); return; }
    if (naming) finishNaming(true); // a click off the name box commits it
    const w = s2w(x, y);
    if (tool === 'poly') { polyClick(w); return; }
    if (tool === 'object') { placeObject(w); return; }
    if (tool === 'doodad') { addDoodad(w); return; }
    if (tool === 'glass') {
      // both brushes paint the same way — a click + drag stroke along edges;
      // glassMode picks which list (glass vs no-collision) the edge lands in
      drag = { kind: 'paint', moved: false };
      paintEdge(w);
      return;
    }
    // select tool. The rotate handle floats over the current selection and is
    // drawn on top, so a grab on it wins over whatever lies beneath.
    if (rotatable(sel) && rotHandleHit(x, y)) { beginRotate(w); return; }
    const p = pick(w.x, w.y);
    // Shift turns a vertex/edge grab into a whole-polygon select + move, so a
    // shape translates as one piece instead of a vertex at a time
    sel = e && e.shiftKey && p && (p.kind === 'vertex' || p.kind === 'edge')
      ? { kind: 'poly', pi: p.pi } : p;
    if (!sel) {
      drag = { kind: 'pan', sx: x, sy: y, cx: cam.x, cy: cam.y };
      return;
    }
    drag = { kind: 'move', moved: false };
    if (sel.kind === 'edge') {
      // dragging an edge moves both of its endpoints together — this is
      // how a whole wall or floor (the map bounds) slides around
      drag.grab = { x: w.x, y: w.y };
      const poly = map.polygons[sel.pi];
      drag.orig = [poly[sel.vi].slice(), poly[(sel.vi + 1) % poly.length].slice()];
    } else if (sel.kind === 'poly') {
      // every vertex shifts by the same cursor delta from where the grab began
      drag.grab = { x: w.x, y: w.y };
      drag.orig = map.polygons[sel.pi].map(v => v.slice());
    }
  }

  function mouseMove(x, y, shift) {
    mx = x; my = y;
    // over the Load browser: a held scrollbar drag flicks the list; otherwise
    // hovering a row highlights it (and so previews it)
    if (browse) {
      if (browseDrag) { scrollToBar(y); return; }
      for (const b of browseRects) {
        if (b.id === 'browseRow' && hitRect(b, x, y)) { browse.sel = b.idx; break; }
      }
      return;
    }
    const w = s2w(x, y);
    if (drag) {
      if (drag.kind === 'pan') {
        cam.x = drag.cx - (x - drag.sx) / zoom;
        cam.y = drag.cy - (y - drag.sy) / zoom;
        return;
      }
      if (drag.kind === 'paint') {
        paintEdge(w);
        return;
      }
      if (drag.kind === 'rotate' && sel) {
        if (!drag.moved) { pushUndo(); drag.moved = true; }
        applyRotate(w, shift);
        commit();
        return;
      }
      if (drag.kind === 'move' && sel) {
        if (!drag.moved) { pushUndo(); drag.moved = true; }
        applyMove(sel, w, shift);
        commit();
      }
      return;
    }
    hov = tool === 'select' ? pick(w.x, w.y) : null;
  }

  // `grid` (Shift held mid-drag) snaps a lone vertex to the nearest grid
  // line instead of the fine placement grid, for quick alignment. It only
  // affects single-vertex drags — a Shift+grab is already a whole-polygon move
  function applyMove(p, w, grid) {
    switch (p.kind) {
      case 'vertex':
        map.polygons[p.pi][p.vi] = grid
          ? [gridSnap(w.x), gridSnap(w.y)]
          : [snap(w.x), snap(w.y)];
        break;
      case 'burger':
        map.burgers[p.bi] = [snap(w.x), snap(w.y)];
        break;
      case 'nut':
        map.nuts[p.ni] = [snap(w.x), snap(w.y)];
        break;
      case 'defib':
        map.defibs[p.dfi] = [snap(w.x), snap(w.y)];
        break;
      case 'flip':
        map.flipBurgers[p.fi] = [snap(w.x), snap(w.y), map.flipBurgers[p.fi][2] || 'up'];
        break;
      case 'doodad': {
        const d = map.doodads[p.di];
        d.x = snap(w.x); d.y = snap(w.y);   // keep type + layer, move the anchor
        break;
      }
      case 'start':
        map.start = { x: snap(w.x), y: snap(w.y) };
        break;
      case 'goal':
        map.goal = [snap(w.x), snap(w.y)];
        break;
      case 'edge': {
        const dx = w.x - drag.grab.x, dy = w.y - drag.grab.y;
        const poly = map.polygons[p.pi];
        poly[p.vi] = [snap(drag.orig[0][0] + dx), snap(drag.orig[0][1] + dy)];
        poly[(p.vi + 1) % poly.length] = [snap(drag.orig[1][0] + dx), snap(drag.orig[1][1] + dy)];
        break;
      }
      case 'poly': {
        const dx = w.x - drag.grab.x, dy = w.y - drag.grab.y;
        const poly = map.polygons[p.pi];
        for (let i = 0; i < poly.length; i++) {
          poly[i] = [snap(drag.orig[i][0] + dx), snap(drag.orig[i][1] + dy)];
        }
        break;
      }
    }
  }

  // the +Edge brush: mark the one edge under the cursor, in whichever list the
  // current mode targets (glass or no-collision). A whole stroke (down + drag)
  // coalesces into a single undo step, and re-touching an already-marked edge is
  // a no-op, so dragging back and forth is safe. To clear, select the edge and
  // press Del (see deleteSel).
  function paintEdge(w) {
    const list = glassMode === 'nocollide' ? map.noCollide : map.glassEdges;
    const e = pickEdge(w.x, w.y, BRUSH_R / zoom);
    if (!e) return;
    if (list.some(g => g[0] === e.pi && g[1] === e.vi)) return;   // already marked
    if (!drag.moved) { pushUndo(); drag.moved = true; }
    list.push([e.pi, e.vi]);
    commit();
  }

  function mouseUp(x, y) {
    if (x != null) { mx = x; my = y; }
    browseDrag = null;   // release a scrollbar drag (browse owns no other drag)
    if (drag && drag.kind === 'paint' && drag.moved) {
      commit(true);
      note(glassMode === 'nocollide'
        ? 'Edge collision removed - the rider rides straight through it'
        : 'Glass painted - the tires barely grip it');
    }
    if (drag && drag.kind === 'move' && drag.moved) commit(true);
    if (drag && drag.kind === 'rotate' && drag.moved) commit(true);
    drag = null;
  }

  function dblClick(x, y) {
    if (tool !== 'select') return;
    const w = s2w(x, y);
    const p = pick(w.x, w.y);
    if (p && p.kind === 'vertex') {
      deleteVertex(p);
    } else if (p && p.kind === 'edge') {
      pushUndo();
      map.glassEdges = remapEdgesVertexInsert(map.glassEdges, p.pi, p.vi);
      map.noCollide = remapEdgesVertexInsert(map.noCollide, p.pi, p.vi);
      map.polygons[p.pi].splice(p.vi + 1, 0, [snap(p.px), snap(p.py)]);
      sel = { kind: 'vertex', pi: p.pi, vi: p.vi + 1 };
      commit(true);
    }
  }

  function wheel(e) {
    // the Load browser owns the wheel while it's up: scroll the file list
    if (browse) {
      if (browse.mode === 'list') {
        const max = Math.max(0, browse.files.length - browse.perPage);
        browse.scroll = clamp(browse.scroll + (e.deltaY > 0 ? 1 : -1), 0, max);
      }
      return;
    }
    zoomAt(e.clientX, e.clientY, Math.pow(1.0015, -e.deltaY));
  }

  function key(e) {
    const k = e.key;
    // the discard-changes dialog is modal: it swallows every key until answered
    if (confirmPrompt) {
      if (k === 'Enter' || k === 'y' || k === 'Y') runConfirm();
      else if (k === 'Escape' || k === 'n' || k === 'N') cancelConfirm();
      return;
    }
    // the Load browser is modal too: arrows walk the list, Enter loads, and the
    // search box is always focused while maps are listed — any other printable
    // key types into it (filtering live). Esc clears a typed query first, then
    // (when empty) shuts the browser.
    if (browse) {
      if (k === 'Escape') { if (browse.query) { browse.query = ''; filterBrowser(); } else closeBrowser(); }
      else if (k === 'ArrowDown') browseMove(1);
      else if (k === 'ArrowUp') browseMove(-1);
      else if (k === 'Enter') loadFromBrowser();
      else if (browse.mode === 'list' && browse.all.length) {
        if (k === 'Backspace') { browse.query = browse.query.slice(0, -1); filterBrowser(); }
        else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { browse.query += k; filterBrowser(); }
      }
      return;
    }
    if (naming) {
      if (k === 'Enter') finishNaming(true);
      else if (k === 'Escape') finishNaming(false);
      else if (k === 'Backspace') nameBuf = nameBuf.slice(0, -1);
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && nameBuf.length < 40) nameBuf += k;
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const lk = k.toLowerCase();
      if (lk === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (lk === 'y') { e.preventDefault(); redo(); }
      else if (lk === 's') { e.preventDefault(); saveFile(); }
      else if (lk === 'o') { e.preventDefault(); openLoadBrowser(); }
      else if (k === 'Enter') hooks.test();
      return;
    }
    switch (k) {
      case 'Escape':
        if (helpOpen) helpOpen = false;
        else if (menu) closeMenu();
        else if (draft) { draft = null; note('Cancelled'); }
        else if (sel) sel = null;
        else hooks.exit();
        return;
      case '1': case 'v': case 'V': setTool('select'); return;
      case '2': case 'p': case 'P': setTool('poly'); return;
      // the +Object tool carries a kind; 3/B arms a burger, 5/K a nut mound,
      // 6/F a gravity burger (press 6/F again to cycle up->down->left->right).
      // Glass (4/G) keeps whichever brush its palette last set.
      case '3': case 'b': case 'B': setTool('object'); setObjectKind('burger'); return;
      case '4': case 'g': case 'G': setTool('glass'); return;
      case '5': case 'k': case 'K': setTool('object'); setObjectKind('nut'); return;
      case '6': case 'f': case 'F': {
        setTool('object');
        const order = ['flipUp', 'flipDown', 'flipLeft', 'flipRight'];
        setObjectKind(order[(order.indexOf(objectKind) + 1) % order.length]);
        return;
      }
      case '7': case 'd': case 'D': setTool('doodad'); return;
      case 't': case 'T': cycleTheme(); return;
      case 'n': case 'N': startNaming(); return;
      case 'r': case 'R': toggleRider(); return;
      case '#': toggleGrid(); return;
      case 'h': case 'H': case '?': helpOpen = !helpOpen; return;
      case 'Enter': if (tool === 'poly' && draft) closeDraft(); return;
      case 'Delete': case 'Backspace': deleteSel(e.shiftKey); return;
      case '+': case '=': zoomAt(scrW / 2, scrH / 2, 1.3); return;
      case '-': case '_': zoomAt(scrW / 2, scrH / 2, 1 / 1.3); return;
      case '0': fitView(); return;
      case '[': case '{': cycleSnap(-1); return;
      case ']': case '}': cycleSnap(1); return;
      case 'ArrowLeft': nudge(-1, 0, e.shiftKey); return;
      case 'ArrowRight': nudge(1, 0, e.shiftKey); return;
      case 'ArrowUp': nudge(0, -1, e.shiftKey); return;
      case 'ArrowDown': nudge(0, 1, e.shiftKey); return;
    }
  }

  function action(id) {
    // palette/dropdown buttons emit prefixed ids (one per sprite / layer / kind
    // / theme); the toolbar tool buttons emit a bare tool id
    if (id.indexOf('doodadPick:') === 0) { setDoodadType(id.slice(11)); return; }
    if (id === 'doodadLayer:back' || id === 'doodadLayer:front') { setDoodadLayer(id.slice(12)); return; }
    if (id.indexOf('objectKind:') === 0) { setObjectKind(id.slice(11)); return; }
    if (id.indexOf('glassMode:') === 0) { setGlassMode(id.slice(10)); return; }
    if (id.indexOf('polyMode:') === 0) { setPolyMode(id.slice(9)); return; }
    if (id.indexOf('polyLayer:') === 0) { setPolyLayer(id.slice(10)); return; }
    if (id.indexOf('theme:') === 0) { setTheme(id.slice(6)); closeMenu(); return; }
    switch (id) {
      case 'select': case 'poly': case 'object': case 'glass': case 'doodad': setTool(id); break;
      case 'rider': toggleRider(); break;
      case 'grid': toggleGrid(); break;
      case 'background': toggleBackground(); break;
      case 'name': startNaming(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'zoomOut': zoomAt(scrW / 2, scrH / 2, 1 / 1.3); break;
      case 'zoomIn': zoomAt(scrW / 2, scrH / 2, 1.3); break;
      case 'fit': fitView(); break;
      case 'help': helpOpen = !helpOpen; break;
      case 'new': confirmIfDirty('start a new map', newMap); break;
      case 'load': openLoadBrowser(); break;   // the discard prompt waits for a chosen map
      case 'save': saveFile(); break;
      case 'test': hooks.test(); break;
      case 'exit': hooks.exit(); break;
      // the Load browser's footer buttons
      case 'browseChoose': chooseMapFolder(); break;
      case 'browseReopen': reopenMapFolder(); break;
      case 'browseCancel': closeBrowser(); break;
    }
  }

  function cursor() {
    if (confirmPrompt) {
      for (const b of confirmRects) if (hitRect(b, mx, my)) return 'pointer';
      return 'default';
    }
    if (browse) {
      if (browseDrag) return 'grabbing';
      if (overBrowseBar(mx, my)) return 'grab';
      for (const b of browseRects) {
        if (hitRect(b, mx, my)) return b.id === 'browseSearch' ? 'text' : 'pointer';
      }
      return 'default';
    }
    if (drag && (drag.kind === 'pan' || drag.kind === 'rotate')) return 'grabbing';
    for (const b of uiRects) if (hitRect(b, mx, my)) return 'pointer';
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      if (hitRect(p.bounds, mx, my)) return p.rects.some(b => hitRect(b, mx, my)) ? 'pointer' : 'default';
    }
    if (tool !== 'select') return 'crosshair';
    if (overRotateHandle()) return 'grab';
    return hov ? 'pointer' : 'default';
  }

  // ---------- lifecycle ----------

  function open(W, H) {
    scrW = W; scrH = H;
    if (!map) {
      // the autosaved working map survives refreshes; a damaged one
      // (or none) starts the template
      try {
        const saved = localStorage.getItem(AUTOSAVE_KEY);
        if (saved) map = parse(saved);
      } catch (e) { map = null; }
      const fresh = !map;
      if (!map) map = template();
      // work restored from the autosave cache was never written to a file, so
      // it counts as unsaved — flag it dirty so New/Load warn before discarding
      if (!fresh) dirty = true;
      prepared = prepareLevel(map);
      fitView();
      note(fresh ? 'Welcome! H shows the controls' : 'Picked up where you left off - H shows the controls');
    }
    sel = null; hov = null; drag = null; draft = null;
    naming = false; confirmPrompt = null; browse = null;
  }

  // ---------- drawing ----------

  function draw(ctx, W, H, patterns, rt) {
    scrW = W; scrH = H;
    const pat = patterns[map.theme] || patterns.meadow;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.x, -cam.y);
    const hw = W / 2 / zoom + 1, hh = H / 2 / zoom + 1;
    const view = { x0: cam.x - hw, y0: cam.y - hh, x1: cam.x + hw, y1: cam.y + hh };
    drawWorld(ctx, prepared, pat, view, rt, null, showBg);
    drawGrid(ctx, view);
    drawDoodadLayer(ctx, map.doodads, 'back', rt);   // scenery behind the actors
    for (const n of map.nuts) drawNutMound(ctx, n[0], n[1], rt);
    for (const d of map.defibs) drawDefib(ctx, d[0], d[1], rt);
    for (const b of map.burgers) drawBurger(ctx, b[0], b[1], rt);
    // gravity burgers draw identically to normal ones in play; here in the editor
    // a directional badge marks them and shows which way they set gravity
    for (const b of map.flipBurgers) {
      drawBurger(ctx, b[0], b[1], rt);
      drawFlipBadge(ctx, b[0], b[1], b[2]);
    }
    drawPopcorn(ctx, map.goal[0], map.goal[1], rt);
    drawStartMarker(ctx);
    drawDoodadLayer(ctx, map.doodads, 'front', rt);  // props that ride over the rider
    // foreground polygons draw over the rider in play; dim them here so the
    // author can still see and edit the scene behind them
    ctx.save();
    ctx.globalAlpha = 0.55;
    drawForeground(ctx, prepared, pat, view, rt);
    ctx.restore();
    drawGlassEdges(ctx);
    drawPolyOverlay(ctx);
    drawNoCollideOverlay(ctx);
    drawDoodadOverlay(ctx);
    if (showRider) drawRiderPreview(ctx);
    drawDrafts(ctx, rt);
    drawSelectionRing(ctx);
    drawRotateHandle(ctx);
    ctx.restore();

    drawWorldLabels(ctx);
    drawToolbar(ctx, W, H, rt);
    // popups dock under the toolbar; rebuilt every frame so their hitboxes never
    // go stale when the tool, the open dropdown, or a modal changes
    popups = [];
    if (!helpOpen && !confirmPrompt && !browse) {
      if (tool === 'object') drawObjectPalette(ctx, W, H, rt);
      else if (tool === 'doodad') drawDoodadPalette(ctx, W, H, rt);
      else if (tool === 'glass') drawGlassPalette(ctx, W, H, rt);
      else if (tool === 'poly') drawPolyPalette(ctx, W, H, rt);
      if (menu === 'view') drawDropdown(ctx, uiRects.find(b => b.id === 'view'), viewItems());
      else if (menu === 'theme') drawDropdown(ctx, uiRects.find(b => b.id === 'theme'), themeItems());
    }
    drawStatus(ctx, W, H);
    if (helpOpen) drawHelp(ctx, W, H);
    // the browser draws first so a deferred discard-changes prompt (raised when a
    // map is picked) lands on top of it, not behind — input already prioritises
    // the confirm dialog over the browser (see mouseDown / key / cursor)
    if (browse) drawBrowser(ctx, W, H, patterns, rt);
    if (confirmPrompt) drawConfirm(ctx, W, H);
  }

  // strokes every line in [from, to] at `step` spacing, skipping any that
  // land on a coarser tier (drawn brighter on its own pass)
  function gridLines(ctx, view, step, skip) {
    ctx.beginPath();
    for (let x = Math.ceil(view.x0 / step) * step; x <= view.x1; x += step) {
      if (skip && Math.abs(x / skip - Math.round(x / skip)) < 1e-6) continue;
      ctx.moveTo(x, view.y0);
      ctx.lineTo(x, view.y1);
    }
    for (let y = Math.ceil(view.y0 / step) * step; y <= view.y1; y += step) {
      if (skip && Math.abs(y / skip - Math.round(y / skip)) < 1e-6) continue;
      ctx.moveTo(view.x0, y);
      ctx.lineTo(view.x1, y);
    }
    ctx.stroke();
  }

  function drawGrid(ctx, view) {
    if (!showGrid) return;            // grid off: no lines at all
    ctx.save();
    ctx.lineWidth = 1 / zoom;
    // three tiers, each fading in as it gets far enough apart to read: the
    // finest first hides when zoomed out, leaving just the bold 5-unit majors
    // half-unit subdivisions — the faintest tier, deep zoom only
    if (zoom >= 26) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      gridLines(ctx, view, 0.5, 1);   // skip whole units (drawn brighter below)
    }
    // 1-unit minor lines
    if (zoom >= 9) {
      ctx.strokeStyle = 'rgba(255,255,255,0.24)';
      gridLines(ctx, view, 1, 5);     // skip the 5-unit majors
    }
    // 5-unit major lines, always on
    ctx.strokeStyle = 'rgba(255,255,255,0.44)';
    gridLines(ctx, view, 5, 0);
    ctx.restore();
  }

  // a ghosted green bike showing where (and which way) the rider spawns
  function drawStartMarker(ctx) {
    ctx.save();
    ctx.translate(map.start.x, map.start.y);
    ctx.strokeStyle = 'rgba(155,224,138,0.95)';
    ctx.fillStyle = 'rgba(155,224,138,0.22)';
    ctx.lineWidth = 0.07;
    ctx.lineCap = 'round';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * PHYS.anchorX, PHYS.anchorY, PHYS.wheelR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-PHYS.anchorX, PHYS.anchorY);
    ctx.lineTo(0, -0.25);
    ctx.lineTo(PHYS.anchorX, PHYS.anchorY);
    ctx.stroke();
    // the rider always spawns facing right
    ctx.beginPath();
    ctx.moveTo(0.1, -0.6);
    ctx.lineTo(0.75, -0.6);
    ctx.moveTo(0.55, -0.8);
    ctx.lineTo(0.75, -0.6);
    ctx.lineTo(0.55, -0.4);
    ctx.stroke();
    ctx.restore();
  }

  // an editor-only badge over a gravity burger: a violet ring around the burger
  // plus a small disc with a single arrow pointing the way the burger sets
  // gravity (up/down/left/right). In play these burgers look exactly like normal
  // ones; this marker exists only so the author can place and tell them apart.
  const FLIP_BADGE_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  function drawFlipBadge(ctx, x, y, dir) {
    const a = FLIP_BADGE_VEC[dir] || FLIP_BADGE_VEC.up;
    const ax = a[0], ay = a[1];
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(178,102,234,0.95)';
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.arc(0, 0, 0.62, 0, Math.PI * 2);
    ctx.stroke();
    const bx = 0.42, by = -0.42;
    ctx.fillStyle = 'rgba(150,70,210,0.92)';
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.arc(bx, by, 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // a single arrow through the disc, pointing the gravity direction
    const tipx = bx + ax * 0.15, tipy = by + ay * 0.15;
    const px = -ay, py = ax;               // perpendicular, for the arrowhead barbs
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(bx - ax * 0.15, by - ay * 0.15); ctx.lineTo(tipx, tipy);           // shaft
    ctx.moveTo(tipx - ax * 0.1 + px * 0.08, tipy - ay * 0.1 + py * 0.08);         // barb
    ctx.lineTo(tipx, tipy);
    ctx.lineTo(tipx - ax * 0.1 - px * 0.08, tipy - ay * 0.1 - py * 0.08);         // barb
    ctx.stroke();
    ctx.restore();
  }

  // y of the nearest standable surface directly below (x, y) — the polygon
  // the rider would come to rest on. Scans the floor/island tops the level
  // prep already classified (grass + glass tops, which include the map
  // bounds' floor). Falls back to y itself when nothing is below, so the
  // preview still parks at the cursor over open space.
  function groundBelow(x, y) {
    let best = Infinity;
    const consider = seg => {
      const lo = Math.min(seg.ax, seg.bx), hi = Math.max(seg.ax, seg.bx);
      if (x < lo || x > hi || hi - lo < 1e-6) return;   // skip vertical edges
      const sy = seg.ay + (x - seg.ax) / (seg.bx - seg.ax) * (seg.by - seg.ay);
      if (sy >= y - 1e-6 && sy < best) best = sy;        // closest one below
    };
    for (const seg of prepared.grass) consider(seg);
    for (const seg of prepared.glassTops) consider(seg);
    return isFinite(best) ? best : y;
  }

  // A static "stamp" of the rider's collision body, dropped onto the surface
  // under the cursor: the two wheel discs and the (fatal) head disc, at the
  // exact PHYS geometry the sim collides with, plus a faint band marking each
  // one's height above the ground. The bike is dynamic in play; this previews
  // it parked upright so a corridor or ceiling can be carved knowing whether
  // the wheels or the head would clip.
  function drawRiderPreview(ctx) {
    if (overChrome()) return;
    const w = s2w(mx, my);
    const cx = snap(w.x), cy = snap(w.y);
    const groundY = groundBelow(cx, cy);
    const fy = groundY - PHYS.anchorY - PHYS.wheelR;    // frame origin: wheels on groundY
    const wyc = fy + PHYS.anchorY;                       // wheel-centre height
    const hx = cx + PHYS.headX, hy = fy + PHYS.headY;    // head centre (spawns facing right)
    const halfW = PHYS.anchorX + PHYS.wheelR;            // rider half-width

    ctx.save();
    // the two height zones, as bands resting above the polygons below
    ctx.fillStyle = 'rgba(120,200,255,0.13)';            // wheels
    ctx.fillRect(cx - halfW, wyc - PHYS.wheelR, halfW * 2, PHYS.wheelR * 2);
    ctx.fillStyle = 'rgba(255,120,90,0.13)';             // head (fatal)
    ctx.fillRect(cx - halfW, hy - PHYS.headR, halfW * 2, PHYS.headR * 2);

    // a faint frame linking the colliders, so the stamp reads as a parked bike
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(cx - PHYS.anchorX, wyc);
    ctx.lineTo(hx, hy);
    ctx.lineTo(cx + PHYS.anchorX, wyc);
    ctx.stroke();

    // the actual collision discs, drawn over their bands
    ctx.lineWidth = 0.045;
    for (const sx of [-1, 1]) {
      ctx.fillStyle = 'rgba(120,200,255,0.28)';
      ctx.strokeStyle = 'rgba(150,210,255,0.95)';
      ctx.beginPath();
      ctx.arc(cx + sx * PHYS.anchorX, wyc, PHYS.wheelR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,120,90,0.30)';
    ctx.strokeStyle = 'rgba(255,150,120,0.98)';
    ctx.beginPath();
    ctx.arc(hx, hy, PHYS.headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function strokePoly(ctx, poly) {
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
    ctx.stroke();
  }

  function drawPolyOverlay(ctx) {
    const hr = 4.5 / zoom;
    map.polygons.forEach((poly, pi) => {
      // a whole-polygon selection lights up the entire outline and every handle
      const polySel = sel && sel.kind === 'poly' && sel.pi === pi;
      const invis = map.invisible.includes(pi);
      const front = map.frontPolys.includes(pi);
      const blend = map.blendPolys.includes(pi);
      ctx.save();
      if (invis && !polySel) {
        // an invisible polygon draws nothing in play — here a dashed violet
        // outline marks the solid-but-unseen region so the author can edit it
        ctx.strokeStyle = 'rgba(206,128,236,0.9)';
        ctx.setLineDash([8 / zoom, 5 / zoom]);
        ctx.lineWidth = 2 / zoom;
      } else if (blend && !polySel) {
        // a blend polygon draws over the rider with no outline, merged into the
        // terrain — a dashed teal outline marks its (otherwise seamless) shape
        ctx.strokeStyle = 'rgba(120,220,200,0.9)';
        ctx.setLineDash([8 / zoom, 5 / zoom]);
        ctx.lineWidth = 2 / zoom;
      } else if (front && !polySel) {
        // a foreground polygon draws over the rider — a dashed amber outline
        // (the doodad front-layer tint) flags it
        ctx.strokeStyle = 'rgba(255,170,90,0.9)';
        ctx.setLineDash([8 / zoom, 5 / zoom]);
        ctx.lineWidth = 2 / zoom;
      } else {
        ctx.strokeStyle = polySel ? '#f9c623' : 'rgba(255,255,255,0.45)';
        ctx.lineWidth = (polySel ? 3 : 1.5) / zoom;
      }
      strokePoly(ctx, poly);
      ctx.restore();
      for (let vi = 0; vi < poly.length; vi++) {
        const isSel = polySel || (sel && sel.kind === 'vertex' && sel.pi === pi && sel.vi === vi);
        const isHov = hov && hov.kind === 'vertex' && hov.pi === pi && hov.vi === vi;
        const r = isSel || isHov ? hr * 1.5 : hr;
        ctx.fillStyle = isSel ? '#f9c623' : isHov ? '#ffe27a' : 'rgba(255,255,255,0.85)';
        ctx.fillRect(poly[vi][0] - r, poly[vi][1] - r, r * 2, r * 2);
        ctx.lineWidth = 1 / zoom;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeRect(poly[vi][0] - r, poly[vi][1] - r, r * 2, r * 2);
      }
    });
    // edge selection/hover highlights
    for (const [p, color, wdt] of [
      [hov && hov.kind === 'edge' ? hov : null, 'rgba(255,226,122,0.55)', 3],
      [sel && sel.kind === 'edge' ? sel : null, '#f9c623', 3.5],
    ]) {
      if (!p || !map.polygons[p.pi]) continue;
      const poly = map.polygons[p.pi];
      const a = poly[p.vi], b = poly[(p.vi + 1) % poly.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = wdt / zoom;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }

  // a glassy overlay tracing each painted edge, so glass shows exactly where
  // it sits (the real obsidian sheen also renders, but only on up-facing
  // tops). In the glass tool the edge under the brush lights up gold, for
  // unambiguous aim where polygons stack.
  function drawGlassEdges(ctx) {
    const stroke = (pi, vi, color, w) => {
      const poly = map.polygons[pi];
      if (!poly) return;
      const a = poly[vi], b = poly[(vi + 1) % poly.length];
      if (!a || !b) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = w / zoom;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    };
    ctx.save();
    ctx.lineCap = 'round';
    for (const [pi, vi] of map.glassEdges) stroke(pi, vi, 'rgba(170,215,235,0.85)', 4);
    if (tool === 'glass' && glassMode === 'glass' && !overChrome()) {
      const w = s2w(mx, my);
      const e = pickEdge(w.x, w.y, BRUSH_R / zoom);
      if (e) stroke(e.pi, e.vi, '#f9c623', 6);
    }
    ctx.restore();
  }

  // no-collision edges (map.noCollide): trace each one in dashed "ghost" cyan so
  // the author sees where the rider rides through (the wall still draws, so the
  // overlay is the only tell). In the no-collision brush the edge under the
  // cursor lights up gold, like the glass brush.
  function drawNoCollideOverlay(ctx) {
    const stroke = (pi, vi, color, w, dash) => {
      const poly = map.polygons[pi];
      if (!poly) return;
      const a = poly[vi], b = poly[(vi + 1) % poly.length];
      if (!a || !b) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = w / zoom;
      ctx.setLineDash(dash ? [7 / zoom, 5 / zoom] : []);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    ctx.save();
    ctx.lineCap = 'round';
    for (const [pi, vi] of map.noCollide) stroke(pi, vi, 'rgba(90,220,235,0.9)', 4, true);
    if (tool === 'glass' && glassMode === 'nocollide' && !overChrome()) {
      const w = s2w(mx, my);
      const e = pickEdge(w.x, w.y, BRUSH_R / zoom);
      if (e) stroke(e.pi, e.vi, '#f9c623', 6, false);
    }
    ctx.restore();
  }

  // a layer-tinted dashed box around every placed doodad so the author can see
  // its footprint and tell back (blue) from front (orange) at a glance; the
  // hovered/selected one brightens (gold when selected). Editor-only chrome —
  // in play the doodad is just its sprite.
  function doodadTint(layer) { return layer === 'front' ? '255,170,90' : '120,200,255'; }

  function drawDoodadOverlay(ctx) {
    ctx.save();
    ctx.lineCap = 'round';
    map.doodads.forEach((d, di) => {
      const def = DOODAD_BY_ID[d.type] || { w: 1, h: 1 };
      const isSel = sel && sel.kind === 'doodad' && sel.di === di;
      const isHov = hov && hov.kind === 'doodad' && hov.di === di;
      const tint = doodadTint(d.layer);
      ctx.strokeStyle = isSel ? '#f9c623'
        : isHov ? 'rgba(' + tint + ',0.95)' : 'rgba(' + tint + ',0.4)';
      ctx.lineWidth = (isSel ? 2.5 : isHov ? 2 : 1.2) / zoom;
      ctx.setLineDash([7 / zoom, 5 / zoom]);
      // the footprint box rides the doodad's tilt about its base anchor
      ctx.save();
      ctx.translate(d.x, d.y);
      if (d.angle) ctx.rotate(d.angle);
      roundRectPath(ctx, -def.w / 2, -def.h, def.w, def.h + 0.12, 6 / zoom);
      ctx.stroke();
      ctx.restore();
    });
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawDrafts(ctx, rt) {
    const w = s2w(mx, my);
    const cx = snap(w.x), cy = snap(w.y);
    if (tool === 'poly') {
      // the draft is tinted to match its editor outline: violet when invisible,
      // amber on the front layer, teal on the blend layer, gold otherwise
      const draftCol = polyMode === 'invisible' ? 'rgba(206,128,236,0.95)'
        : polyLayer === 'front' ? 'rgba(255,170,90,0.95)'
        : polyLayer === 'blend' ? 'rgba(120,220,200,0.95)' : '#ffe27a';
      ctx.strokeStyle = draftCol;
      ctx.lineWidth = 2 / zoom;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      if (draft && draft.length) {
        ctx.beginPath();
        ctx.moveTo(draft[0][0], draft[0][1]);
        for (let i = 1; i < draft.length; i++) ctx.lineTo(draft[i][0], draft[i][1]);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        // ring the first point once the loop can close on it
        if (draft.length >= 3) {
          ctx.beginPath();
          ctx.arc(draft[0][0], draft[0][1], 12 / zoom, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.fillStyle = draftCol;
        const r = 4 / zoom;
        for (const v of draft) ctx.fillRect(v[0] - r, v[1] - r, r * 2, r * 2);
      }
      ctx.setLineDash([]);
    }
    if (tool === 'object' && !overChrome()) {
      // ghost the armed object kind at the snapped cursor; the flip burger wears
      // its editor badge, the nut mound its pile, the defibrillator its unit
      ctx.save();
      ctx.globalAlpha = 0.55;
      if (objectKind === 'nut') {
        drawNutMound(ctx, cx, cy, rt);
      } else if (objectKind === 'defib') {
        drawDefib(ctx, cx, cy, rt);
      } else {
        drawBurger(ctx, cx, cy, rt);
        if (OBJ_FLIP_DIR[objectKind]) drawFlipBadge(ctx, cx, cy, OBJ_FLIP_DIR[objectKind]);
      }
      ctx.restore();
    }
    if (tool === 'doodad' && !overChrome()) {
      // ghost the current sprite at the snapped cursor, with its footprint box
      // in the chosen layer's colour
      ctx.save();
      ctx.globalAlpha = 0.55;
      drawDoodad(ctx, doodadType, cx, cy, rt);
      ctx.restore();
      const def = DOODAD_BY_ID[doodadType];
      if (def) {
        ctx.strokeStyle = 'rgba(' + doodadTint(doodadLayer) + ',0.8)';
        ctx.lineWidth = 1.4 / zoom;
        ctx.setLineDash([7 / zoom, 5 / zoom]);
        roundRectPath(ctx, cx - def.w / 2, cy - def.h, def.w, def.h + 0.12, 6 / zoom);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (tool !== 'select' && !overChrome()) {
      // snapped crosshair under placement tools
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 1.5 / zoom;
      const r = 9 / zoom;
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();
    }
  }

  function drawSelectionRing(ctx) {
    const ring = (x, y, r, hot) => {
      ctx.strokeStyle = hot ? '#f9c623' : 'rgba(255,226,122,0.5)';
      ctx.lineWidth = 2.5 / zoom;
      ctx.setLineDash([7 / zoom, 5 / zoom]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    for (const [p, hot] of [[hov, false], [sel, true]]) {
      if (!p) continue;
      if (p.kind === 'burger' && map.burgers[p.bi]) {
        ring(map.burgers[p.bi][0], map.burgers[p.bi][1], 0.7, hot);
      } else if (p.kind === 'nut' && map.nuts[p.ni]) {
        ring(map.nuts[p.ni][0], map.nuts[p.ni][1], 0.7, hot);
      } else if (p.kind === 'defib' && map.defibs[p.dfi]) {
        ring(map.defibs[p.dfi][0], map.defibs[p.dfi][1], 0.7, hot);
      } else if (p.kind === 'flip' && map.flipBurgers[p.fi]) {
        ring(map.flipBurgers[p.fi][0], map.flipBurgers[p.fi][1], 0.7, hot);
      } else if (p.kind === 'start') {
        ring(map.start.x, map.start.y, 1.0, hot);
      } else if (p.kind === 'goal') {
        ring(map.goal[0], map.goal[1], 0.75, hot);
      }
    }
  }

  // the rotate handle for the current selection (a whole polygon or a doodad):
  // a dashed spoke from the pivot up to a grabbable disc bearing a little
  // curved arrow. Mid-drag the spoke swings with the pointer so the rotation
  // reads directly. Sized in screen px (via /zoom) so it's constant at any zoom.
  function drawRotateHandle(ctx) {
    if (tool !== 'select' || !rotatable(sel)) return;
    let pivot, handle;
    if (drag && drag.kind === 'rotate') {
      pivot = drag.pivot;
      const c = Math.cos(drag.delta), s = Math.sin(drag.delta);
      const vx = drag.handleVec.x, vy = drag.handleVec.y;
      handle = { x: pivot.x + vx * c - vy * s, y: pivot.y + vx * s + vy * c };
    } else {
      const g = rotGeom(sel);
      if (!g) return;
      pivot = g.pivot; handle = g.handle;
    }
    const hot = (drag && drag.kind === 'rotate') || overRotateHandle();
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // spoke from the pivot to the handle
    ctx.strokeStyle = hot ? '#f9c623' : 'rgba(249,198,35,0.75)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([5 / zoom, 4 / zoom]);
    ctx.beginPath();
    ctx.moveTo(pivot.x, pivot.y);
    ctx.lineTo(handle.x, handle.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // pivot pip
    ctx.fillStyle = hot ? '#f9c623' : 'rgba(249,198,35,0.9)';
    ctx.beginPath();
    ctx.arc(pivot.x, pivot.y, 2.6 / zoom, 0, Math.PI * 2);
    ctx.fill();
    // the disc
    const r = ROT_DISC / zoom;
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, r, 0, Math.PI * 2);
    ctx.fillStyle = hot ? 'rgba(120,62,16,0.95)' : 'rgba(20,12,6,0.92)';
    ctx.fill();
    ctx.lineWidth = (hot ? 2.5 : 1.5) / zoom;
    ctx.strokeStyle = hot ? '#f9c623' : 'rgba(249,198,35,0.85)';
    ctx.stroke();
    // a curved arrow glyph inside the disc, hinting "spin me"
    const gr = r * 0.5;
    ctx.strokeStyle = hot ? '#ffe27a' : '#f9c623';
    ctx.lineWidth = 1.3 / zoom;
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, gr, -Math.PI * 0.55, Math.PI * 0.95);
    ctx.stroke();
    // arrowhead on the open end of the arc
    const ah = Math.PI * 0.95, tip = { x: handle.x + gr * Math.cos(ah), y: handle.y + gr * Math.sin(ah) };
    const back = 2.6 / zoom;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - back, tip.y - back * 0.2);
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - back * 0.2, tip.y + back);
    ctx.stroke();
    ctx.restore();
  }

  // screen-space tags so the lettering stays crisp at any zoom
  function drawWorldLabels(ctx) {
    ctx.save();
    ctx.font = 'bold 12px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tag = (wx, wy, text, color) => {
      const s = w2s(wx, wy);
      if (s.x < -60 || s.x > scrW + 60 || s.y < 0 || s.y > scrH) return;
      const w = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(10,6,3,0.75)';
      roundRectPath(ctx, s.x - w / 2 - 5, s.y - 9, w + 10, 18, 5);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillText(text, s.x, s.y);
    };
    tag(map.start.x, map.start.y - 1.4, 'START', '#9be08a');
    tag(map.goal[0], map.goal[1] - 1.3, 'GOAL', '#ff8a5c');
    ctx.restore();
  }

  function overToolbar() {
    for (const b of uiRects) if (hitRect(b, mx, my)) return true;
    return false;
  }

  function overPopups() {
    return popups.some(p => hitRect(p.bounds, mx, my));
  }

  // any editor chrome under the cursor (toolbar or an open popup) — placement
  // tools suppress their world ghost/crosshair while the cursor is over it
  function overChrome() { return overToolbar() || overPopups(); }

  // draw one preview, scaled to fit a `size`-px square at (x, y), clipped so
  // nothing bleeds past the cell. Base-anchored sprites rest on the centred
  // bottom; `centered` items (the burgers, which draw around their middle)
  // centre in the box instead.
  function drawThumb(ctx, item, x, y, size, t) {
    ctx.save();
    roundRectPath(ctx, x, y, size, size, 5);
    ctx.clip();
    const scale = Math.min((size - 12) / item.w, (size - 12) / item.h);
    if (item.centered) {
      ctx.translate(x + size / 2, y + size / 2);
    } else {
      ctx.translate(x + size / 2, y + (size + item.h * scale) / 2);
    }
    ctx.scale(scale, scale);
    item.draw(ctx, t);
    ctx.restore();
  }

  // The generic tool palette: a panel docked under the toolbar with a title, an
  // optional row of segmented toggles (the doodad Back/Front), and a grid of
  // live thumbnails. Click a thumbnail or toggle to arm it (each emits an action
  // id), then click the world to place. Shared by the +Burger and +Doodad
  // tools; the grid columns adapt so it always fits between the toolbar and the
  // status bar. Pushes its panel onto `popups` so clicks on it are handled.
  // one thumbnail cell of a palette: highlight box, thumbnail, label, hit rect.
  // Shared by the flat layout and the sectioned one (drawSectionedPalette).
  function drawPaletteCell(ctx, c, cx, cy, cw, ch, rt, rects) {
    const hot = hitRect({ x: cx, y: cy, w: cw, h: ch }, mx, my);
    ctx.fillStyle = c.on ? 'rgba(120,62,16,0.92)' : hot ? 'rgba(60,30,10,0.9)' : 'rgba(22,14,8,0.85)';
    roundRectPath(ctx, cx, cy, cw, ch, 7);
    ctx.fill();
    ctx.lineWidth = c.on ? 2.5 : hot ? 2 : 1.2;
    ctx.strokeStyle = c.on ? '#f9c623' : hot ? 'rgba(249,198,35,0.6)' : 'rgba(249,198,35,0.28)';
    ctx.stroke();
    const thumb = ch - 22;
    drawThumb(ctx, c, cx + (cw - thumb) / 2, cy + 4, thumb, rt);
    ctx.fillStyle = c.on ? '#ffe27a' : '#e8dcc8';
    ctx.font = '11px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillText(ellipsize(ctx, c.label, cw - 8), cx + cw / 2, cy + ch - 9);
    rects.push({ id: c.id, x: cx, y: cy, w: cw, h: ch });
  }

  function drawPalettePanel(ctx, W, H, rt, opts) {
    if (opts.sections) { drawSectionedPalette(ctx, rt, opts); return; }
    const pad = 10, cellW = 86, cellH = 80, gap = 8;
    const titleH = 22, headerH = titleH + (opts.toggles ? 30 : 0);
    const panelX = 10 + SAFE.left;
    const panelY = toolbarBottom + 8;
    const gridTop = panelY + pad + headerH;
    const bottomLimit = H - SAFE.bottom - 30;          // keep clear of the status bar
    const rowsFit = Math.max(1, Math.floor((bottomLimit - gridTop + gap) / (cellH + gap)));
    const n = opts.cells.length;
    // at least two columns for a small set (so it reads as a row, not a strip),
    // more if the rows wouldn't otherwise fit the height; capped at four
    const cols = Math.min(4, Math.max(Math.min(n, 2), Math.ceil(n / rowsFit)));
    const rows = Math.ceil(n / cols);
    const panelW = cols * cellW + (cols - 1) * gap + pad * 2;
    const panelH = headerH + rows * cellH + (rows - 1) * gap + pad * 2;
    const rects = [];

    ctx.save();
    ctx.fillStyle = 'rgba(10,6,3,0.92)';
    roundRectPath(ctx, panelX, panelY, panelW, panelH, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(249,198,35,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f9c623';
    ctx.font = 'bold 14px ' + FONT;
    ctx.fillText(opts.title, panelX + pad, panelY + pad + titleH / 2);

    // optional segmented toggles, right-aligned in the title row
    if (opts.toggles) {
      const segH = 24, segGap = 6, m = opts.toggles.length;
      const segW = Math.min(62, (panelW - pad * 2 - segGap * (m - 1)) / m);
      const segY = panelY + pad + titleH - 2;
      const segX0 = panelX + panelW - pad - (segW * m + segGap * (m - 1));
      ctx.font = 'bold 12px ' + FONT;
      ctx.textAlign = 'center';
      opts.toggles.forEach((tg, i) => {
        const rx = segX0 + i * (segW + segGap);
        const hot = hitRect({ x: rx, y: segY, w: segW, h: segH }, mx, my);
        ctx.fillStyle = tg.on ? 'rgba(120,62,16,0.95)' : hot ? 'rgba(70,34,10,0.92)' : 'rgba(20,12,6,0.82)';
        roundRectPath(ctx, rx, segY, segW, segH, 6);
        ctx.fill();
        ctx.lineWidth = tg.on || hot ? 2 : 1.2;
        ctx.strokeStyle = tg.on || hot ? '#f9c623' : 'rgba(249,198,35,0.4)';
        ctx.stroke();
        ctx.fillStyle = tg.on || hot ? '#ffe27a' : '#f0e8da';
        ctx.fillText(tg.label, rx + segW / 2, segY + segH / 2 + 1);
        rects.push({ id: tg.id, x: rx, y: segY, w: segW, h: segH });
      });
    }

    // thumbnail cells
    opts.cells.forEach((c, i) => {
      const cx = panelX + pad + (i % cols) * (cellW + gap);
      const cy = gridTop + Math.floor(i / cols) * (cellH + gap);
      drawPaletteCell(ctx, c, cx, cy, cellW, cellH, rt, rects);
    });
    ctx.restore();
    popups.push({ bounds: { x: panelX, y: panelY, w: panelW, h: panelH }, rects });
  }

  // a palette grouped into labelled sections (+ optional sub-groups), stacked
  // vertically with a divider between sections — used by the +Object palette
  // (Help / Harm, with a Gravity sub-group under Help). opts.sections is
  // [{ label, groups: [{ label?, cells }] }]; cells take the same shape as the
  // flat layout's. Cell ids/click routing are unchanged, so the existing popup
  // hit-testing works as-is.
  function drawSectionedPalette(ctx, rt, opts) {
    const pad = 10, cellW = 86, cellH = 80, gap = 8, titleH = 22;
    const secH = 20, grpH = 17, divH = 14;
    const panelX = 10 + SAFE.left;
    const panelY = toolbarBottom + 8;
    let maxCells = 1;
    for (const s of opts.sections) for (const g of s.groups) maxCells = Math.max(maxCells, g.cells.length);
    const cols = Math.min(4, maxCells);
    const panelW = cols * cellW + (cols - 1) * gap + pad * 2;
    const rects = [];

    // walk the structure once, emitting draw ops and measuring the height
    const ops = [];
    let y = panelY + pad + titleH;
    opts.sections.forEach((s, si) => {
      if (si > 0) { y += divH / 2; ops.push({ t: 'div', y }); y += divH / 2; }
      ops.push({ t: 'sec', label: s.label, y });
      y += secH;
      for (const g of s.groups) {
        if (g.label) { ops.push({ t: 'grp', label: g.label, y }); y += grpH; }
        const rows = Math.ceil(g.cells.length / cols);
        g.cells.forEach((c, i) => {
          ops.push({ t: 'cell', c,
            cx: panelX + pad + (i % cols) * (cellW + gap),
            cy: y + Math.floor(i / cols) * (cellH + gap) });
        });
        y += rows * cellH + (rows - 1) * gap + gap;
      }
    });
    const panelH = y - gap - panelY + pad;

    ctx.save();
    ctx.fillStyle = 'rgba(10,6,3,0.92)';
    roundRectPath(ctx, panelX, panelY, panelW, panelH, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(249,198,35,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f9c623';
    ctx.font = 'bold 14px ' + FONT;
    ctx.fillText(opts.title, panelX + pad, panelY + pad + titleH / 2);

    for (const op of ops) {
      if (op.t === 'div') {
        ctx.strokeStyle = 'rgba(249,198,35,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(panelX + pad, op.y);
        ctx.lineTo(panelX + panelW - pad, op.y);
        ctx.stroke();
      } else if (op.t === 'sec') {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#f9c623';
        ctx.font = 'bold 12px ' + FONT;
        ctx.fillText(op.label.toUpperCase(), panelX + pad, op.y + secH / 2);
      } else if (op.t === 'grp') {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(240,232,218,0.72)';
        ctx.font = 'italic 11px ' + FONT;
        ctx.fillText(op.label, panelX + pad + 10, op.y + grpH / 2);
      } else {
        drawPaletteCell(ctx, op.c, op.cx, op.cy, cellW, cellH, rt, rects);
      }
    }
    ctx.restore();
    popups.push({ bounds: { x: panelX, y: panelY, w: panelW, h: panelH }, rects });
  }

  // the placeable objects, shown in the +Object palette grouped into Help / Harm
  // (drawObjectPalette below). Burgers and the four directional gravity burgers
  // look identical in play (a gravity burger SETS gravity up/down/left/right when
  // grabbed — the editor badge's arrow tells them apart); the nut mound is the
  // lethal hazard.
  const OBJECT_KINDS = [
    { id: 'burger', label: 'Burger', draw: (c, t) => drawBurger(c, 0, 0, t) },
    { id: 'defib', label: 'Defibrillator', draw: (c, t) => drawDefib(c, 0, 0, t) },
    { id: 'flipUp', label: 'Grav Up', draw: (c, t) => { drawBurger(c, 0, 0, t); drawFlipBadge(c, 0, 0, 'up'); } },
    { id: 'flipDown', label: 'Grav Down', draw: (c, t) => { drawBurger(c, 0, 0, t); drawFlipBadge(c, 0, 0, 'down'); } },
    { id: 'flipLeft', label: 'Grav Left', draw: (c, t) => { drawBurger(c, 0, 0, t); drawFlipBadge(c, 0, 0, 'left'); } },
    { id: 'flipRight', label: 'Grav Right', draw: (c, t) => { drawBurger(c, 0, 0, t); drawFlipBadge(c, 0, 0, 'right'); } },
    { id: 'nut', label: 'Nut Mound', draw: (c, t) => drawNutMound(c, 0, 0, t) },
  ];

  // Help / Harm sections. The burger and the defibrillator (a one-up that adds a
  // life) sit side by side under Help — both are collected and good for the
  // rider. The four gravity burgers are a "Gravity" sub-group under Help too
  // (required and helpful like a normal burger — you collect them — they just set
  // gravity instead of nudging it).
  function drawObjectPalette(ctx, W, H, rt) {
    const cell = id => {
      const k = OBJECT_KINDS.find(o => o.id === id);
      return { id: 'objectKind:' + k.id, label: k.label, on: k.id === objectKind,
               w: 1.6, h: 1.6, centered: true, draw: k.draw };
    };
    drawPalettePanel(ctx, W, H, rt, {
      title: 'OBJECTS',
      sections: [
        { label: 'Help', groups: [
          { cells: [cell('burger'), cell('defib')] },
          { label: 'Gravity', cells: ['flipUp', 'flipDown', 'flipLeft', 'flipRight'].map(cell) },
        ] },
        { label: 'Harm', groups: [
          { cells: [cell('nut')] },
        ] },
      ],
    });
  }

  // the +Edge tool's two brushes, with simple symbolic thumbnails: a glassy
  // sheen edge, and a dashed "ghost" edge with an arrow riding through it.
  const GLASS_MODES = [
    { id: 'glass', label: 'Glass', draw: drawGlassChip },
    { id: 'nocollide', label: 'No-Collision', draw: drawGhostChip },
  ];

  function drawGlassPalette(ctx, W, H, rt) {
    drawPalettePanel(ctx, W, H, rt, {
      title: 'EDGE',
      cells: GLASS_MODES.map(m => ({
        id: 'glassMode:' + m.id, label: m.label, on: m.id === glassMode,
        w: 1.4, h: 1.4, centered: true, draw: m.draw,
      })),
    });
  }

  // the +Poly tool's two modes: a solid (filled) polygon, or an invisible one
  // (a dashed outline only — solid collision, drawn nowhere in play).
  const POLY_MODES = [
    { id: 'solid', label: 'Polygon', draw: drawSolidPolyChip },
    { id: 'invisible', label: 'Invisible', draw: drawInvisiblePolyChip },
  ];

  function drawPolyPalette(ctx, W, H, rt) {
    drawPalettePanel(ctx, W, H, rt, {
      title: 'POLYGON',
      // a layer toggle like the doodad palette's: front polygons draw over the
      // rider, blend ones merge seamlessly into the terrain they cover (back is
      // the default)
      toggles: [
        { id: 'polyLayer:back', label: 'Back', on: polyLayer === 'back' },
        { id: 'polyLayer:front', label: 'Front', on: polyLayer === 'front' },
        { id: 'polyLayer:blend', label: 'Blend', on: polyLayer === 'blend' },
      ],
      cells: POLY_MODES.map(m => ({
        id: 'polyMode:' + m.id, label: m.label, on: m.id === polyMode,
        w: 1.4, h: 1.4, centered: true, draw: m.draw,
      })),
    });
  }

  // tiny symbolic thumbnails for the glass + poly palettes, drawn around the
  // origin within ~[-0.55, 0.55] so they fit a centred palette cell
  function drawGlassChip(c) {
    c.save();
    c.rotate(-0.16);
    c.fillStyle = 'rgba(34,48,62,0.95)';        // glass body
    roundRectPath(c, -0.55, -0.1, 1.1, 0.32, 0.06);
    c.fill();
    c.strokeStyle = 'rgba(190,225,242,0.95)';   // mirror seam on top
    c.lineWidth = 0.07;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-0.55, -0.1); c.lineTo(0.55, -0.1);
    c.stroke();
    c.strokeStyle = 'rgba(235,250,255,0.9)';    // glints
    c.lineWidth = 0.05;
    c.beginPath();
    c.moveTo(-0.32, -0.1); c.lineTo(-0.12, -0.1);
    c.moveTo(0.14, -0.1); c.lineTo(0.32, -0.1);
    c.stroke();
    c.restore();
  }

  function drawGhostChip(c) {
    c.save();
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(90,220,235,0.95)';    // the passable wall edge, dashed
    c.lineWidth = 0.09;
    c.setLineDash([0.15, 0.12]);
    c.beginPath();
    c.moveTo(0, -0.5); c.lineTo(0, 0.5);
    c.stroke();
    c.setLineDash([]);
    c.strokeStyle = '#ffe27a';                  // an arrow riding straight through
    c.lineWidth = 0.07;
    c.beginPath();
    c.moveTo(-0.5, 0.05); c.lineTo(0.5, 0.05);
    c.moveTo(0.3, -0.12); c.lineTo(0.52, 0.05); c.lineTo(0.3, 0.22);
    c.stroke();
    c.restore();
  }

  function drawSolidPolyChip(c) {
    c.beginPath();
    c.moveTo(0, -0.5); c.lineTo(0.52, 0.42); c.lineTo(-0.52, 0.42); c.closePath();
    c.fillStyle = 'rgba(120,150,90,0.92)';      // a grassy ground green
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 0.06;
    c.lineJoin = 'round';
    c.stroke();
  }

  function drawInvisiblePolyChip(c) {
    c.save();
    c.strokeStyle = 'rgba(206,128,236,0.95)';   // dashed outline only, no fill
    c.lineWidth = 0.07;
    c.lineJoin = 'round';
    c.setLineDash([0.16, 0.12]);
    c.beginPath();
    c.moveTo(0, -0.5); c.lineTo(0.52, 0.42); c.lineTo(-0.52, 0.42); c.closePath();
    c.stroke();
    c.restore();
  }

  function drawDoodadPalette(ctx, W, H, rt) {
    drawPalettePanel(ctx, W, H, rt, {
      title: 'DOODADS',
      toggles: [
        { id: 'doodadLayer:back', label: 'Back', on: doodadLayer === 'back' },
        { id: 'doodadLayer:front', label: 'Front', on: doodadLayer === 'front' },
      ],
      cells: DOODADS.map(d => ({
        id: 'doodadPick:' + d.id, label: d.label, on: d.id === doodadType,
        w: d.w, h: d.h, draw: d.draw,
      })),
    });
  }

  // a toolbar dropdown: a small menu anchored under its owning button. Rows can
  // toggle a setting (Rider/Grid) or pick a value (a theme, with a colour
  // swatch). Pushes its panel onto `popups`. `items`: [{ id, label, on, swatch }].
  function drawDropdown(ctx, owner, items) {
    if (!owner) return;
    ctx.save();
    ctx.font = 'bold 13px ' + FONT;
    const pad = 8, rowH = 28;
    const hasSwatch = items.some(it => it.swatch);
    const swatchW = hasSwatch ? 22 : 0;
    let textW = 0;
    for (const it of items) textW = Math.max(textW, ctx.measureText(it.label).width);
    const panelW = Math.max(owner.w, textW + pad * 2 + (swatchW ? swatchW + 8 : 0));
    const panelH = pad * 2 + items.length * rowH;
    let panelX = owner.x;
    const panelY = owner.y + owner.h + 4;
    panelX = Math.max(6, Math.min(panelX, scrW - 6 - panelW));   // keep on-screen
    ctx.fillStyle = 'rgba(10,6,3,0.95)';
    roundRectPath(ctx, panelX, panelY, panelW, panelH, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(249,198,35,0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    const rects = [];
    items.forEach((it, i) => {
      const ry = panelY + pad + i * rowH;
      const hot = hitRect({ x: panelX + 4, y: ry + 2, w: panelW - 8, h: rowH - 4 }, mx, my);
      if (it.on || hot) {
        ctx.fillStyle = it.on ? 'rgba(120,62,16,0.9)' : 'rgba(70,34,10,0.9)';
        roundRectPath(ctx, panelX + 4, ry + 2, panelW - 8, rowH - 4, 6);
        ctx.fill();
      }
      let tx = panelX + pad;
      if (it.swatch) {
        const th = THEMES[it.swatch];
        ctx.fillStyle = th ? th.miniSky : '#888';
        ctx.fillRect(tx, ry + rowH / 2 - 8, swatchW, 10);
        ctx.fillStyle = th ? th.miniGround : '#555';
        ctx.fillRect(tx, ry + rowH / 2 + 2, swatchW, 6);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx, ry + rowH / 2 - 8, swatchW, 16);
        tx += swatchW + 8;
      }
      ctx.fillStyle = it.on || hot ? '#ffe27a' : '#f0e8da';
      ctx.textAlign = 'left';
      ctx.fillText(it.label, tx, ry + rowH / 2 + 1);
      rects.push({ id: it.id, x: panelX, y: ry, w: panelW, h: rowH });
    });
    ctx.restore();
    popups.push({ bounds: { x: panelX, y: panelY, w: panelW, h: panelH }, rects });
  }

  // the rows for each dropdown, rebuilt every frame so their on-states are live
  function viewItems() {
    return [
      { id: 'rider', label: (showRider ? '[x]' : '[ ]') + ' Rider preview', on: showRider },
      { id: 'grid', label: (showGrid ? '[x]' : '[ ]') + ' Grid', on: showGrid },
      { id: 'background', label: (showBg ? '[x]' : '[ ]') + ' Background', on: showBg },
    ];
  }

  function themeItems() {
    return editorThemeNames().map(name => ({
      id: 'theme:' + name,
      label: name.charAt(0).toUpperCase() + name.slice(1),
      on: map.theme === name,
      swatch: name,
    }));
  }

  function drawToolbar(ctx, W, H, rt) {
    const caret = naming && (rt * 2) % 1 < 0.5 ? '|' : ' ';
    const defs = [
      { id: 'select', label: 'Select', on: tool === 'select' },
      { id: 'poly', label: '+Poly', on: tool === 'poly' },
      { id: 'object', label: '+Object', on: tool === 'object' },
      { id: 'glass', label: '+Edge', on: tool === 'glass' },
      { id: 'doodad', label: '+Doodad', on: tool === 'doodad' },
    ];
    // The +Object (burger/flip/nut), +Edge (glass/no-collision), +Poly
    // (solid/invisible) and +Doodad tools each reveal a palette panel of their
    // options; View and Theme are dropdown menus opened from their button.
    // `menu` marks a button that toggles a dropdown instead of acting.
    defs.push(
      { id: 'view', label: 'View ▾', menu: 'view', on: menu === 'view' },
      { id: 'theme', label: 'Theme: ' + map.theme + ' ▾', menu: 'theme', on: menu === 'theme' },
      { id: 'name', label: (naming ? nameBuf + caret : map.name) + (dirty ? ' *' : ''), on: naming, min: 150 },
      { id: 'undo', label: 'Undo', disabled: !undoStack.length },
      { id: 'redo', label: 'Redo', disabled: !redoStack.length },
      { id: 'zoomOut', label: '-' },
      { id: 'zoomIn', label: '+' },
      { id: 'fit', label: 'Fit' },
      { id: 'help', label: '?' },
      { id: 'new', label: 'New' },
      { id: 'load', label: 'Load' },
      { id: 'save', label: 'Save' },
      { id: 'test', label: 'Test', disabled: busy },
      { id: 'exit', label: 'Menu' },
    );
    ctx.save();
    ctx.font = 'bold 14px ' + FONT;
    // layout pass: flow the buttons, wrapping on narrow screens. Keep the row
    // clear of a landscape phone's side notches / top inset (SAFE is zero on
    // desktop and in the harnesses).
    uiRects = [];
    const x0 = 10 + SAFE.left, xMax = W - 10 - SAFE.right;
    let x = x0, y = 8 + SAFE.top;
    const bh = 30, gap = 6;
    for (const d of defs) {
      const w = Math.max(d.min || 34, ctx.measureText(d.label).width + 18);
      if (x + w > xMax && x > x0) { x = x0; y += bh + gap; }
      uiRects.push(Object.assign({ x, y, w, h: bh }, d));
      x += w + gap;
    }
    toolbarBottom = y + bh + 8;
    ctx.fillStyle = 'rgba(10,6,3,0.72)';
    ctx.fillRect(0, 0, W, toolbarBottom);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of uiRects) {
      const hot = !r.disabled && (r.on || hitRect(r, mx, my));
      ctx.save();
      if (r.disabled) ctx.globalAlpha = 0.45;
      ctx.fillStyle = r.on ? 'rgba(120,62,16,0.95)' : hot ? 'rgba(70,34,10,0.92)' : 'rgba(20,12,6,0.82)';
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 7);
      ctx.fill();
      ctx.lineWidth = hot ? 2.5 : 1.5;
      ctx.strokeStyle = hot ? '#f9c623' : 'rgba(249,198,35,0.4)';
      ctx.stroke();
      ctx.fillStyle = hot ? '#ffe27a' : '#f0e8da';
      ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2 + 1);
      ctx.restore();
    }
    ctx.restore();
  }

  const TOOL_HINTS = {
    select: 'drag vertices, edges, burgers, START, GOAL - Shift+drag moves a whole polygon (or Shift while dragging a lone vertex snaps it to the grid) - a whole polygon or a doodad shows a rotate handle above it (drag to spin, 15° detents unless Shift) - double-click an edge to add a vertex (a vertex to remove it) - Del removes (a glassed edge clears its glass; Shift+Del the whole polygon)',
    poly: 'pick Polygon or Invisible + a Back/Front/Blend layer from the palette, then click to lay vertices - click the first point (or Enter) closes it - invisible keeps collision but draws nothing; a front polygon draws OVER the rider (collision unchanged) so he can hide behind it; a blend polygon also draws over the rider but with no outline, merging seamlessly into the terrain it covers so several stitch into one shape - Esc cancels',
    object: 'pick Burger, one of the four Gravity burgers (Up/Down/Left/Right) or Nut Mound from the palette, then click to drop it - a gravity burger sets gravity that way when collected; a nut mound is a lethal hazard',
    glass: 'Glass brush: click or drag an edge to glass it (the tires barely grip). No-Collision brush: click or drag an edge to let the rider ride straight through it (the wall still shows). Clear either by selecting the edge and pressing Del',
    doodad: 'pick a sprite + layer from the palette, then click to place an inert prop - "back" sits behind the rider, "front" in front of him (it never collides)',
  };

  function drawStatus(ctx, W, H) {
    ctx.save();
    // sit the bar above the home-indicator inset and keep its text clear of
    // the side notches
    const sb = H - SAFE.bottom, ty = sb - 13;
    ctx.fillStyle = 'rgba(10,6,3,0.72)';
    ctx.fillRect(0, sb - 26, W, 26);
    ctx.font = '12px ' + FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const transient = status && performance.now() - statusAt < 5000;
    ctx.fillStyle = transient ? '#ffe27a' : 'rgba(240,232,218,0.8)';
    ctx.fillText(transient ? status : TOOL_HINTS[tool] || '',
      10 + SAFE.left, ty, safeBandW(W) * 0.62);
    const b = levelBounds(prepared);
    const w = s2w(mx, my);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(240,232,218,0.8)';
    ctx.fillText(
      w.x.toFixed(1) + ', ' + w.y.toFixed(1) +
      '  |  bounds ' + Math.round(b.minX) + '..' + Math.round(b.maxX) +
      ' x ' + Math.round(b.minY) + '..' + Math.round(b.maxY) +
      '  |  ' + map.polygons.length + ' poly  ' + map.burgers.length + ' burgers' +
      (map.flipBurgers.length ? '  ' + map.flipBurgers.length + ' flip' : '') +
      (map.defibs.length ? '  ' + map.defibs.length + ' defib' : '') +
      (map.nuts.length ? '  ' + map.nuts.length + ' nuts' : '') +
      (map.invisible.length ? '  ' + map.invisible.length + ' invis' : '') +
      (map.frontPolys.length ? '  ' + map.frontPolys.length + ' front' : '') +
      (map.blendPolys.length ? '  ' + map.blendPolys.length + ' blend' : '') +
      (map.noCollide.length ? '  ' + map.noCollide.length + ' ghost' : '') +
      (map.doodads.length ? '  ' + map.doodads.length + ' doodads' : '') +
      '  |  snap ' + SNAP, W - 10 - SAFE.right, ty);
    ctx.restore();
  }

  const HELP = [
    ['1 / V', 'Select: drag vertices, edges (walls move whole), burgers, START, GOAL'],
    ['Shift+drag', 'move a whole polygon (Shift+grab a vertex/edge); or hold Shift while dragging a lone vertex to snap it to the grid'],
    ['2 / P', 'Polygon: click out a new shape, close on the first point - inside the play area it is a solid island. The palette picks Invisible (keeps collision, draws nothing) and a Back/Front/Blend layer - Front draws OVER the rider so he can hide behind it; Blend also draws over him but seamless (no outline, merged into the terrain it covers) so several stitch into one shape (collision unchanged)'],
    ['3 / B', 'Object: pick Burger, Defibrillator (a one-up that adds a life), a Gravity burger (Up/Down/Left/Right) or Nut Mound in the palette, then click to drop it (3/B arms a burger, 5/K a nut mound, 6/F a gravity burger)'],
    ['4 / G', 'Edge: the Glass brush paints obsidian onto edges (near-zero grip); the No-Collision brush paints an edge the rider rides straight through (the wall still shows). Both clear by selecting the edge + Del'],
    ['5 / K', 'Nut Mound: arms the +Object tool with the lethal nut-mound hazard (Del removes a selected one)'],
    ['6 / F', 'Gravity Burger: arms the +Object tool with a gravity burger; press 6/F again to cycle its direction (up/down/left/right) - collecting it sets gravity that way'],
    ['7 / D', 'Doodad: drop an inert decorative sprite - pick the sprite and its layer (behind or in front of the rider) from the palette panel; it never collides'],
    ['rotate handle', 'a whole-polygon or doodad selection floats a handle above it - drag it to spin the object (snaps to 15°; hold Shift to rotate freely)'],
    ['double-click', 'on an edge adds a vertex; on a vertex removes it'],
    ['Del', 'remove the selection - a glassed edge clears its glass (Shift+Del: its whole polygon)'],
    ['R', 'toggle the rider preview: wheel (blue) + head (red) colliders parked under the cursor (also under the View menu)'],
    ['#', 'show or hide the alignment grid (also under the View menu)'],
    ['arrows', 'nudge the selection (Shift: whole units) - pan when nothing is selected'],
    ['[  /  ]', 'coarsen / refine the placement grid (the snap step shown bottom-right)'],
    ['T  /  N', 'cycle the theme (or pick one from the Theme menu) / rename the map'],
    ['wheel  + - 0', 'zoom (0 fits the whole map)'],
    ['Ctrl+Z / Ctrl+Y', 'undo / redo'],
    ['Ctrl+S', 'save the map to a ' + EXT + ' file'],
    ['Ctrl+O / Load', 'browse a folder of ' + EXT + ' maps - the highlighted one previews; click or Enter loads it (arrows/wheel scroll; just type to filter by name, Esc clears then closes)'],
    ['Ctrl+Enter', 'test ride the map - Esc comes back, Enter retries'],
    ['Esc', 'cancel / deselect; from a clean screen, back to the menu'],
  ];

  function drawHelp(ctx, W, H) {
    ctx.save();
    ctx.fillStyle = 'rgba(8,5,2,0.6)';
    ctx.fillRect(0, 0, W, H);
    const pw = Math.min(W * 0.9, 760);
    const ph = HELP.length * 24 + 64;
    const px = (W - pw) / 2, py = Math.max(50, (H - ph) / 2);
    ctx.fillStyle = 'rgba(20,12,6,0.92)';
    roundRectPath(ctx, px, py, pw, ph, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(249,198,35,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f9c623';
    ctx.font = 'bold 24px ' + FONT;
    ctx.fillText('MAP EDITOR', W / 2, py + 30);
    ctx.font = '13px ' + FONT;
    HELP.forEach(([keys, what], i) => {
      const yy = py + 64 + i * 24;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffe27a';
      ctx.fillText(keys, px + 150, yy);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f0e8da';
      ctx.fillText(what, px + 166, yy, pw - 186);
    });
    ctx.restore();
  }

  function drawConfirm(ctx, W, H) {
    ctx.save();
    ctx.fillStyle = 'rgba(8,5,2,0.72)';
    ctx.fillRect(0, 0, W, H);
    const pw = Math.min(W * 0.9, 440), ph = 172;
    const px = (W - pw) / 2, py = Math.max(50, (H - ph) / 2);
    ctx.fillStyle = 'rgba(20,12,6,0.96)';
    roundRectPath(ctx, px, py, pw, ph, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(249,198,35,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f9c623';
    ctx.font = 'bold 18px ' + FONT;
    ctx.fillText('Unsaved changes', W / 2, py + 36);
    ctx.fillStyle = '#f0e8da';
    ctx.font = '14px ' + FONT;
    ctx.fillText('Discard them and ' + confirmPrompt.verb + '?', W / 2, py + 68, pw - 44);
    // Discard (destructive) on the left, Cancel on the right
    const bw = Math.min(150, (pw - 48) / 2), bh = 40, bgap = 16;
    const by = py + ph - bh - 22;
    confirmRects = [
      { id: 'yes', label: 'Discard', x: W / 2 - bw - bgap / 2, y: by, w: bw, h: bh, danger: true },
      { id: 'no', label: 'Cancel', x: W / 2 + bgap / 2, y: by, w: bw, h: bh },
    ];
    ctx.font = 'bold 14px ' + FONT;
    for (const r of confirmRects) {
      const hot = hitRect(r, mx, my);
      ctx.fillStyle = r.danger
        ? (hot ? 'rgba(150,40,24,0.96)' : 'rgba(96,28,16,0.9)')
        : (hot ? 'rgba(70,34,10,0.92)' : 'rgba(20,12,6,0.82)');
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 8);
      ctx.fill();
      ctx.lineWidth = hot ? 2.5 : 1.5;
      ctx.strokeStyle = hot ? '#f9c623' : 'rgba(249,198,35,0.4)';
      ctx.stroke();
      ctx.fillStyle = hot ? '#ffe27a' : '#f0e8da';
      ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    }
    ctx.restore();
  }

  // ---------- Load overlay drawing ----------

  // one footer/action button of the Load browser, in the shared toolbar style;
  // pushes its hitbox onto browseRects so mouseDown/cursor can find it
  function drawBrowseButton(ctx, r) {
    const hot = hitRect(r, mx, my);
    ctx.save();
    ctx.fillStyle = hot ? 'rgba(70,34,10,0.92)' : 'rgba(20,12,6,0.82)';
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 8);
    ctx.fill();
    ctx.lineWidth = hot ? 2.5 : 1.5;
    ctx.strokeStyle = hot ? '#f9c623' : 'rgba(249,198,35,0.4)';
    ctx.stroke();
    ctx.fillStyle = hot ? '#ffe27a' : '#f0e8da';
    ctx.font = 'bold 13px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.restore();
    browseRects.push(r);
  }

  // a live thumbnail of a map file, rendered through the SAME world/object
  // renderers the editor and the game use (so the preview is faithful), scaled
  // to fit the (x,y,w,h) box and clipped to it. The prepared level is cached on
  // the file record (f._prep) so paging the list doesn't re-prep every frame.
  function drawMapPreview(ctx, f, patterns, x, y, w, h, rt) {
    if (w <= 4 || h <= 4) return;
    if (!f._prep) f._prep = prepareLevel(f.data);
    const prep = f._prep;
    const b = levelBounds(prep);
    const bw = Math.max(1e-3, b.maxX - b.minX), bh = Math.max(1e-3, b.maxY - b.minY);
    const inset = 8;
    const scale = Math.min((w - inset * 2) / bw, (h - inset * 2) / bh);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const pat = patterns[f.data.theme] || patterns.meadow;
    ctx.save();
    roundRectPath(ctx, x, y, w, h, 10);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, h);
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    const hwv = (w / 2) / scale, hhv = (h / 2) / scale;
    const view = { x0: cx - hwv, y0: cy - hhv, x1: cx + hwv, y1: cy + hhv };
    drawWorld(ctx, prep, pat, view, rt, null, true);
    drawDoodadLayer(ctx, f.data.doodads, 'back', rt);
    for (const n of f.data.nuts) drawNutMound(ctx, n[0], n[1], rt);
    for (const bg of f.data.burgers) drawBurger(ctx, bg[0], bg[1], rt);
    for (const fb of f.data.flipBurgers) { drawBurger(ctx, fb[0], fb[1], rt); drawFlipBadge(ctx, fb[0], fb[1], fb[2]); }
    drawPopcorn(ctx, f.data.goal[0], f.data.goal[1], rt);
    drawDoodadLayer(ctx, f.data.doodads, 'front', rt);
    drawForeground(ctx, prep, pat, view, rt);
    // a simple green spawn pip (the full ghost-bike marker is reserved for the
    // live editing canvas)
    ctx.lineWidth = Math.max(0.05, 1.5 / scale);
    ctx.strokeStyle = 'rgba(155,224,138,0.95)';
    ctx.fillStyle = 'rgba(155,224,138,0.3)';
    ctx.beginPath();
    ctx.arc(f.data.start.x, f.data.start.y, 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // frame
    ctx.save();
    roundRectPath(ctx, x, y, w, h, 10);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(249,198,35,0.4)';
    ctx.stroke();
    ctx.restore();
  }

  // the Load browser's search field: a rounded input atop the file list that
  // filters it live. It is always focused while maps are listed (a blinking
  // caret shows it), so typing anywhere narrows the list; a ✕ clears it. Pushes
  // its box — and the clear button (first, so it wins the overlap) — onto
  // browseRects for the pointer handlers.
  function drawBrowseSearch(ctx, r, rt) {
    const hot = hitRect(r, mx, my);
    const pad = 10;
    ctx.save();
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 7);
    ctx.fillStyle = 'rgba(8,5,2,0.6)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hot ? 'rgba(249,198,35,0.6)' : 'rgba(249,198,35,0.32)';
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const midY = r.y + r.h / 2 + 1;
    // magnifier glyph, then the query (or a faint placeholder), with a blinking
    // caret to advertise that the field takes keystrokes without a click
    ctx.font = '13px ' + FONT;
    ctx.fillStyle = 'rgba(240,232,218,0.5)';
    ctx.fillText('⚲', r.x + pad, midY);
    const tx = r.x + pad + 16;
    const caret = (rt * 2) % 1 < 0.5 ? '|' : '';
    if (browse.query) {
      const clearW = 24;
      ctx.fillStyle = '#ffe27a';
      ctx.fillText(ellipsize(ctx, browse.query, Math.max(20, r.x + r.w - pad - clearW - tx)) + caret, tx, midY);
      // clear (✕) button at the right edge
      const cs = 18, cx = r.x + r.w - pad - cs + 4, cy = r.y + (r.h - cs) / 2;
      const ch = hitRect({ x: cx, y: cy, w: cs, h: cs }, mx, my);
      ctx.fillStyle = ch ? '#ffe27a' : 'rgba(240,232,218,0.55)';
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px ' + FONT;
      ctx.fillText('×', cx + cs / 2, midY);
      browseRects.push({ id: 'browseSearchClear', x: cx, y: cy, w: cs, h: cs });
    } else {
      ctx.fillStyle = 'rgba(240,232,218,0.4)';
      ctx.fillText('Search maps' + caret, tx, midY);
    }
    ctx.restore();
    browseRects.push({ id: 'browseSearch', x: r.x, y: r.y, w: r.w, h: r.h });
  }

  // the list + preview half of the browser (only drawn when the folder has
  // maps): a scrollable column of file rows on the left, a live preview of the
  // highlighted map on the right with its name and stats beneath.
  function drawBrowseBody(ctx, patterns, x, y, w, h, rt) {
    const gap = 14;
    const listW = Math.min(360, Math.max(220, w * 0.44));
    // a search field caps the list column; the live preview to its right keeps
    // the full height
    const searchH = 30, searchGap = 10;
    drawBrowseSearch(ctx, { x, y, w: listW, h: searchH }, rt);
    const listX = x, listY = y + searchH + searchGap, listH = h - searchH - searchGap;
    const prevX = listX + listW + gap, prevY = y;
    const prevW = x + w - prevX, prevH = h;

    // ---- file rows ----
    // Scroll is its own state (driven by the wheel, the scrollbar, and keyboard
    // nav), NOT slaved to the selection — a per-draw "keep sel visible" snap
    // would fight a deliberate scrollbar drag. browseMove keeps the highlight on
    // screen when the keyboard moves it; here we only clamp scroll to its range.
    const rowH = 42;
    browse.perPage = Math.max(1, Math.floor(listH / rowH));
    const maxScroll = Math.max(0, browse.files.length - browse.perPage);
    browse.scroll = clamp(browse.scroll, 0, maxScroll);

    // when the list overflows, a wide grabbable scrollbar takes the right
    // gutter and the rows shrink to leave room for it
    const barW = 14;
    const scrollable = maxScroll > 0;
    const rowW = listW - (scrollable ? barW : 0);

    ctx.save();
    roundRectPath(ctx, listX, listY, listW, listH, 8);
    ctx.fillStyle = 'rgba(8,5,2,0.5)';
    ctx.fill();
    ctx.save();
    roundRectPath(ctx, listX, listY, rowW, listH, 8);
    ctx.clip();
    const end = Math.min(browse.files.length, browse.scroll + browse.perPage);
    for (let i = browse.scroll; i < end; i++) {
      const f = browse.files[i];
      const ry = listY + (i - browse.scroll) * rowH;
      const seld = i === browse.sel;
      const hot = hitRect({ x: listX, y: ry, w: rowW, h: rowH }, mx, my);
      if (seld || hot) {
        ctx.fillStyle = seld ? 'rgba(120,62,16,0.9)' : 'rgba(70,34,10,0.85)';
        roundRectPath(ctx, listX + 3, ry + 3, rowW - 6, rowH - 6, 6);
        ctx.fill();
      }
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = seld ? '#ffe27a' : '#f0e8da';
      ctx.font = 'bold 13px ' + FONT;
      ctx.fillText(ellipsize(ctx, f.data.name || '(unnamed)', rowW - 22), listX + 11, ry + 15);
      ctx.fillStyle = 'rgba(240,232,218,0.55)';
      ctx.font = '11px ' + FONT;
      ctx.fillText(ellipsize(ctx, f.name, rowW - 22), listX + 11, ry + 30);
      browseRects.push({ id: 'browseRow', idx: i, x: listX, y: ry, w: rowW, h: rowH });
    }
    // a search that matches nothing: the folder has maps, just none past the
    // filter. Say so in the list area (the preview half stays blank).
    if (!browse.files.length) {
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(240,232,218,0.55)';
      ctx.font = '13px ' + FONT;
      ctx.fillText('No maps match', listX + rowW / 2, listY + Math.min(listH / 2, 46));
    }
    ctx.restore();

    // the scrollbar: a track + a chunky thumb you can drag, or click the track
    // to flick to a spot. Its live geometry is stashed on browse.bar for the
    // pointer handlers (overBrowseBar / beginBarDrag / scrollToBar).
    if (scrollable) {
      const pad = 4;
      const barX = listX + listW - barW;
      const top = listY + pad, trackH = listH - pad * 2;
      const thumbH = Math.max(28, trackH * browse.perPage / browse.files.length);
      const thumbY = top + (trackH - thumbH) * (browse.scroll / maxScroll);
      ctx.fillStyle = 'rgba(0,0,0,0.32)';                          // track
      roundRectPath(ctx, barX + 3, top, barW - 6, trackH, (barW - 6) / 2);
      ctx.fill();
      const hotBar = browseDrag || hitRect({ x: barX, y: top, w: barW, h: trackH }, mx, my);
      ctx.fillStyle = hotBar ? 'rgba(249,198,35,0.95)' : 'rgba(249,198,35,0.62)';   // thumb
      roundRectPath(ctx, barX + 2, thumbY, barW - 4, thumbH, (barW - 4) / 2);
      ctx.fill();
      browse.bar = { x: barX, w: barW, top, trackH, thumbY, thumbH, maxScroll };
    } else {
      browse.bar = null;
    }
    roundRectPath(ctx, listX, listY, listW, listH, 8);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(249,198,35,0.32)';
    ctx.stroke();
    ctx.restore();

    // ---- preview of the highlighted map ----
    if (prevW > 40) {
      const capH = 42, imgH = prevH - capH;
      const f = browse.files[browse.sel];
      if (f) {
        drawMapPreview(ctx, f, patterns, prevX, prevY, prevW, imgH, rt);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ffe27a';
        ctx.font = 'bold 14px ' + FONT;
        ctx.fillText(ellipsize(ctx, f.data.name || '(unnamed)', prevW), prevX, prevY + imgH + 18);
        const themeName = f.data.theme + (THEMES[f.data.theme] ? '' : ' (unknown theme)');
        const extras = [];
        if (f.data.flipBurgers.length) extras.push(f.data.flipBurgers.length + ' gravity');
        if (f.data.nuts.length) extras.push(f.data.nuts.length + ' nuts');
        const meta = themeName + ' · ' + f.data.polygons.length + ' poly · ' +
          f.data.burgers.length + ' burgers' + (extras.length ? ' · ' + extras.join(' · ') : '');
        ctx.fillStyle = 'rgba(240,232,218,0.72)';
        ctx.font = '11px ' + FONT;
        ctx.fillText(ellipsize(ctx, meta, prevW), prevX, prevY + imgH + 36);
      }
    }
  }

  // the Load folder browser: a modal panel with a title, the chosen folder, the
  // list+preview body (or a centred message in the choose/reopen/error/empty
  // states), and a footer of folder-management + Cancel buttons. browseRects is
  // rebuilt here every frame, so its hitboxes never go stale.
  function drawBrowser(ctx, W, H, patterns, rt) {
    browseRects = [];
    browse.bar = null;       // drawBrowseBody re-sets it when a scrollbar is shown
    ctx.save();
    ctx.fillStyle = 'rgba(8,5,2,0.72)';
    ctx.fillRect(0, 0, W, H);
    const pad = 18;
    const pw = Math.min(W * 0.94, 920), ph = Math.min(H * 0.92, 600);
    const px = (W - pw) / 2, py = Math.max(16, (H - ph) / 2);
    ctx.fillStyle = 'rgba(20,12,6,0.97)';
    roundRectPath(ctx, px, py, pw, ph, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(249,198,35,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // header: title, and (if one is chosen) the folder name
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f9c623';
    ctx.font = 'bold 20px ' + FONT;
    ctx.fillText('Load Map', px + pad, py + 26);
    if (mapDir && mapDir.name) {
      ctx.textAlign = 'right';
      ctx.font = '12px ' + FONT;
      ctx.fillStyle = 'rgba(240,232,218,0.7)';
      ctx.fillText(ellipsize(ctx, 'Folder: ' + mapDir.name, pw * 0.5), px + pw - pad, py + 26);
    }

    // footer buttons, laid out right-to-left from the panel's right edge
    const bh = 36, fgap = 10, fy = py + ph - pad - bh;
    ctx.font = 'bold 13px ' + FONT;
    const btns = [{ id: 'browseCancel', label: 'Cancel' }];
    if (browse.mode === 'reopen') btns.push({ id: 'browseReopen', label: 'Reopen Folder' });
    btns.push({ id: 'browseChoose', label: mapDir ? 'Change Folder...' : 'Choose Folder...' });
    let bx = px + pw - pad;
    for (const b of btns) {
      const bw = Math.max(84, ctx.measureText(b.label).width + 26);
      bx -= bw;
      drawBrowseButton(ctx, { id: b.id, label: b.label, x: bx, y: fy, w: bw, h: bh });
      bx -= fgap;
    }

    const bodyTop = py + 50, bodyBot = fy - 12;
    // the search-and-list body shows whenever the folder HAS maps (browse.all),
    // even if the live filter currently matches none — so the search field stays
    // available to widen the query
    if (browse.mode === 'list' && browse.all.length) {
      drawBrowseBody(ctx, patterns, px + pad, bodyTop, pw - pad * 2, bodyBot - bodyTop, rt);
      // the count/stale line sits in the footer, left of the buttons; while a
      // filter is active it reports how many of the folder's maps match instead
      const foot = browse.query
        ? browse.files.length + ' of ' + browse.all.length + ' maps match "' + browse.query + '"'
        : browse.note;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '12px ' + FONT;
      ctx.fillStyle = 'rgba(240,232,218,0.7)';
      ctx.fillText(ellipsize(ctx, foot, Math.max(40, bx - (px + pad))), px + pad, fy + bh / 2);
    } else {
      // choose / reopen / error / loading / empty: a centred message
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '15px ' + FONT;
      ctx.fillStyle = browse.mode === 'error' ? '#ff9a6a' : 'rgba(240,232,218,0.88)';
      ctx.fillText(ellipsize(ctx, browse.note || 'Loading...', pw - pad * 2),
        px + pw / 2, (bodyTop + bodyBot) / 2);
    }
    ctx.restore();
  }

  return {
    init(h) { hooks = Object.assign(hooks, h); },
    open, draw,
    mouseDown, mouseMove, mouseUp, dblClick, wheel, key, cursor,
    exportLevel, serialize, parse,
    get naming() { return naming; },
    get themeName() { return map ? map.theme : 'meadow'; },
    get riderPreview() { return showRider; },
    get background() { return showBg; },
    // exposed for the headless tests
    get map() { return map; },
    get tool() { return tool; },
    get sel() { return sel; },
    get objectKind() { return objectKind; },
    get glassMode() { return glassMode; },
    get polyMode() { return polyMode; },
    get polyLayer() { return polyLayer; },
    get doodadType() { return doodadType; },
    get doodadLayer() { return doodadLayer; },
    get menu() { return menu; },
    get confirmOpen() { return !!confirmPrompt; },
    // the Load folder browser, exposed for the headless tests: whether it's up,
    // its current mode, and the file names it's listing
    get browseOpen() { return !!browse; },
    get browseMode() { return browse ? browse.mode : null; },
    get browseFiles() { return browse ? browse.files.map(f => f.name) : []; },
    get browseSel() { return browse ? browse.sel : -1; },
    get browseScroll() { return browse ? browse.scroll : 0; },
    get browseQuery() { return browse ? browse.query : ''; },
    // the file-list scrollbar's last-drawn geometry (or null when it fits / is
    // closed) — exposed so the headless test can grab and drag it
    browseBar() { return browse ? browse.bar : null; },
    // the current selection's rotate-handle world point (or null when nothing
    // rotatable is selected) — exposed so the headless test can grab it
    get rotateHandle() { const g = rotGeom(sel); return g ? g.handle : null; },
    action,
    // a toolbar button's last-drawn hitbox by id (exposed for the headless tests)
    buttonRect(id) { return uiRects.find(b => b.id === id) || null; },
    worldToScreen: w2s,
    EXT,
  };
})();
