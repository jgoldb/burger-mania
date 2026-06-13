'use strict';

// The Map Editor: a full-screen scene (the 'editor' state in game.js) for
// building custom courses with a GUI. The working map is the exact level
// shape js/levels.js uses — polygons (the playable area is the inside;
// nested polygons are solid islands), start, burgers, goal, theme, plus
// the special-terrain fields: `glassEdges` [poly, edge] pairs (obsidian the
// tires barely grip, painted on per-edge) and `wires` polygon indices
// (wheels-only terrain). Maps save to
// .bmm files: JSON whose body IS a LEVELS entry plus a format header, so
// a finished map can be pasted straight into a track.
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
  const SNAP = 0.1;                  // placement grid (world units)
  const BRUSH_R = 14;                // glass brush reach (screen px)
  const ZOOM_MIN = 4, ZOOM_MAX = 140;
  const UNDO_MAX = 200;
  const FONT = '"Consolas","Courier New",monospace';

  // game.js supplies these: leaving to the menu, starting a test ride,
  // and the shared UI blip
  let hooks = { exit() {}, test() {}, blip() {} };

  let map = null;        // the working level (raw levels.js shape)
  let prepared = null;   // prepareLevel(map), rebuilt after every change
  let cam = { x: 0, y: 0 };
  let zoom = 36;         // screen px per world unit
  let tool = 'select';   // select | poly | burger | glass
  let sel = null;        // {kind: vertex|edge|burger|start|goal, ...}
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
  let showRider = false; // overlay the rider's wheel + head colliders, parked
                         // on the surface under the cursor (a clearance gauge)
  let mx = 0, my = 0;    // last pointer position (screen px)
  let scrW = 800, scrH = 600;
  let uiRects = [];      // toolbar hitboxes, rebuilt every draw
  let autosaveAt = 0;

  // ---------- map data ----------

  // a simple box to sculpt: ceiling, right wall, long flat floor, left
  // wall. Two starter burgers so a fresh map is instantly finishable.
  function template() {
    return {
      name: 'Untitled Map',
      theme: 'meadow',
      polygons: [[[-5, -8], [60, -8], [60, 8], [-5, 8]]],
      start: { x: 2.5, y: 7.25 },
      burgers: [[20, 7.3], [40, 7.3]],
      goal: [55, 7.25],
      glassEdges: [],
      wires: [],
    };
  }

  const round2 = v => Math.round(v * 100) / 100;
  const snap = v => Math.round(v * 10) / 10;
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
    if (map.glassEdges.length) L.glassEdges = map.glassEdges.map(e => [e[0], e[1]]);
    if (map.wires.length) L.wires = map.wires.slice();
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

  // validates enough that the renderer, the sim, and a LEVELS entry can't
  // be handed something that blows up mid-ride
  function parse(text) {
    const d = JSON.parse(text);
    if (d.format !== FORMAT) throw new Error('not a Burger Mania map');
    // version 1 maps store glass as x-spans; parseGlass migrates them
    if (d.version !== 1 && d.version !== VERSION) throw new Error('unsupported map version ' + d.version);
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
    const wires = Array.isArray(d.wires) ? d.wires : [];
    if (!wires.every(i => Number.isInteger(i) && i >= 0 && i < d.polygons.length)) {
      throw new Error('map wire indices are damaged');
    }
    const polygons = d.polygons.map(p => p.map(v => [Number(v[0]), Number(v[1])]));
    return {
      name: typeof d.name === 'string' && d.name ? d.name : 'Mystery Map',
      theme: typeof d.theme === 'string' ? d.theme : 'meadow',
      polygons,
      start: { x: Number(d.start.x), y: Number(d.start.y) },
      burgers: d.burgers.map(b => [Number(b[0]), Number(b[1])]),
      goal: [Number(d.goal[0]), Number(d.goal[1])],
      glassEdges: parseGlass(d, polygons, wires),
      wires: wires.slice(),
    };
  }

  // glass is per-edge ([poly, edge] pairs). A version-1 map instead carries
  // x-spans in d.glass; convert them with the same midpoint rule prepareLevel
  // uses, so an old map loads to the exact edges it always rendered as glass.
  function parseGlass(d, polygons, wires) {
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
    return spansToEdges(polygons, wires,
      spans.map(g => [Math.min(g[0], g[1]), Math.max(g[0], g[1])]));
  }

  // the midpoint rule prepareLevel classifies glass with — kept in step here
  // so legacy x-spans migrate to exactly the edges they used to flag
  function spansToEdges(polygons, wires, spans) {
    if (!spans.length) return [];
    const wire = new Set(wires);
    const out = [];
    polygons.forEach((poly, pi) => {
      if (wire.has(pi)) return;
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
  }

  // ---------- glass edges ----------

  // glass lives as [poly, edge] pairs. The three ops that renumber a
  // polygon's edges keep these in step so a painted edge stays painted (and
  // never points at the wrong segment): splitting an edge (inserting a
  // vertex) glasses both halves, deleting a vertex drops glass from the two
  // edges it merged, and removing a polygon renumbers the rest.
  function remapGlassVertexInsert(pi, vi) {
    const out = [];
    for (const e of map.glassEdges) {
      if (e[0] !== pi || e[1] < vi) out.push(e);
      else if (e[1] > vi) out.push([e[0], e[1] + 1]);
      else { out.push([pi, vi]); out.push([pi, vi + 1]); } // the split edge: both halves
    }
    map.glassEdges = out;
  }

  function remapGlassVertexDelete(pi, vi, n) {
    const prev = (vi - 1 + n) % n;        // the other edge folded into the merge
    map.glassEdges = map.glassEdges
      .filter(e => e[0] !== pi || (e[1] !== vi && e[1] !== prev))
      .map(e => (e[0] === pi && e[1] > vi ? [e[0], e[1] - 1] : e));
  }

  function remapGlassPolyDelete(pi) {
    map.glassEdges = map.glassEdges
      .filter(e => e[0] !== pi)
      .map(e => (e[0] > pi ? [e[0] - 1, e[1]] : e));
  }

  function cycleTheme() {
    const names = Object.keys(THEMES);
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
    draft = null;
    commit(true);
    note('Polygon added - one inside the playable area is a solid island');
  }

  function deleteVertex(p) {
    if (map.polygons[p.pi].length <= 3) {
      note('Polygons keep at least 3 points - Shift+Del removes the whole polygon');
      return;
    }
    pushUndo();
    remapGlassVertexDelete(p.pi, p.vi, map.polygons[p.pi].length);
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
    // wire and glass indices shift down past the removed polygon
    map.wires = map.wires.filter(i => i !== pi).map(i => (i > pi ? i - 1 : i));
    remapGlassPolyDelete(pi);
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
        // a glassed edge clears its glass; a bare edge can't be deleted alone
        const gi = map.glassEdges.findIndex(g => g[0] === sel.pi && g[1] === sel.vi);
        if (gi >= 0) {
          pushUndo();
          map.glassEdges.splice(gi, 1);
          commit(true);
          note('Glass removed');
        } else {
          note('That edge has no glass - Shift+Del removes the whole polygon');
        }
        return;
      }
      case 'burger':
        pushUndo();
        map.burgers.splice(sel.bi, 1);
        sel = null;
        commit(true);
        return;
      default:
        note('The start and goal can be moved, not removed');
    }
  }

  function toggleWire() {
    const pi = sel && (sel.kind === 'vertex' || sel.kind === 'edge' || sel.kind === 'poly') ? sel.pi : null;
    if (pi === null) {
      note('Select a polygon first (click a vertex or edge)');
      return;
    }
    pushUndo();
    const at = map.wires.indexOf(pi);
    if (at >= 0) map.wires.splice(at, 1);
    else map.wires.push(pi);
    commit(true);
    note('Polygon ' + pi + (at >= 0 ? ' is solid again' : ' is now a wire (wheels-only)'));
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

  function newMap() {
    pushUndo();
    map = template();
    sel = null; hov = null; draft = null;
    commit(true);
    fitView();
    note('Fresh map - Ctrl+Z brings the old one back');
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

  async function loadFile() {
    if (busy) return;
    busy = true;
    try {
      const loaded = parse(await REPLAY.openFile(PICKER));
      pushUndo();
      map = loaded;
      sel = null; hov = null; draft = null;
      commit(true);
      dirty = false;
      fitView();
      note('Loaded ' + map.name + (THEMES[map.theme] ? '' : ' - unknown theme "' + map.theme + '" shows as meadow'));
    } catch (e) {
      if (!(e && e.name === 'AbortError')) note('Load failed: ' + (e.message || e));
    }
    busy = false;
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
    if (Math.hypot(wx - map.start.x, wy - map.start.y) < Math.max(r, 0.7)) return { kind: 'start' };
    if (Math.hypot(wx - map.goal[0], wy - map.goal[1]) < Math.max(r, 0.6)) return { kind: 'goal' };
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

  // ---------- input (game.js routes these while state === 'editor') ----------

  function mouseDown(x, y, e) {
    mx = x; my = y;
    if (helpOpen) { helpOpen = false; return; }
    for (const b of uiRects) {
      if (hitRect(b, x, y)) {
        if (!b.disabled) { hooks.blip(); action(b.id); }
        return;
      }
    }
    if (naming) finishNaming(true); // a click off the name box commits it
    const w = s2w(x, y);
    if (tool === 'poly') { polyClick(w); return; }
    if (tool === 'burger') { addBurger(w); return; }
    if (tool === 'glass') {
      drag = { kind: 'paint', moved: false };
      paintGlassAt(w);
      return;
    }
    // select tool
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

  function mouseMove(x, y) {
    mx = x; my = y;
    const w = s2w(x, y);
    if (drag) {
      if (drag.kind === 'pan') {
        cam.x = drag.cx - (x - drag.sx) / zoom;
        cam.y = drag.cy - (y - drag.sy) / zoom;
        return;
      }
      if (drag.kind === 'paint') {
        paintGlassAt(w);
        return;
      }
      if (drag.kind === 'move' && sel) {
        if (!drag.moved) { pushUndo(); drag.moved = true; }
        applyMove(sel, w);
        commit();
      }
      return;
    }
    hov = tool === 'select' ? pick(w.x, w.y) : null;
  }

  function applyMove(p, w) {
    switch (p.kind) {
      case 'vertex':
        map.polygons[p.pi][p.vi] = [snap(w.x), snap(w.y)];
        break;
      case 'burger':
        map.burgers[p.bi] = [snap(w.x), snap(w.y)];
        break;
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

  // glass brush: glass the one edge under the cursor. A whole stroke (down +
  // drag) coalesces into a single undo step, and re-touching an already-glassed
  // edge is a no-op, so dragging back and forth is safe. To clear glass, select
  // the edge and press Del (see deleteSel).
  function paintGlassAt(w) {
    const e = pickEdge(w.x, w.y, BRUSH_R / zoom);
    if (!e) return;
    if (map.glassEdges.some(g => g[0] === e.pi && g[1] === e.vi)) return;   // already glass
    if (!drag.moved) { pushUndo(); drag.moved = true; }
    map.glassEdges.push([e.pi, e.vi]);
    commit();
  }

  function mouseUp(x, y) {
    if (x != null) { mx = x; my = y; }
    if (drag && drag.kind === 'paint' && drag.moved) {
      commit(true);
      note('Glass painted - the tires barely grip it');
    }
    if (drag && drag.kind === 'move' && drag.moved) commit(true);
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
      remapGlassVertexInsert(p.pi, p.vi);
      map.polygons[p.pi].splice(p.vi + 1, 0, [snap(p.px), snap(p.py)]);
      sel = { kind: 'vertex', pi: p.pi, vi: p.vi + 1 };
      commit(true);
    }
  }

  function wheel(e) {
    zoomAt(e.clientX, e.clientY, Math.pow(1.0015, -e.deltaY));
  }

  function key(e) {
    const k = e.key;
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
      else if (lk === 'o') { e.preventDefault(); loadFile(); }
      else if (k === 'Enter') hooks.test();
      return;
    }
    switch (k) {
      case 'Escape':
        if (helpOpen) helpOpen = false;
        else if (draft) { draft = null; note('Cancelled'); }
        else if (sel) sel = null;
        else hooks.exit();
        return;
      case '1': case 'v': case 'V': setTool('select'); return;
      case '2': case 'p': case 'P': setTool('poly'); return;
      case '3': case 'b': case 'B': setTool('burger'); return;
      case '4': case 'g': case 'G': setTool('glass'); return;
      case 't': case 'T': cycleTheme(); return;
      case 'n': case 'N': startNaming(); return;
      case 'w': case 'W': toggleWire(); return;
      case 'r': case 'R': toggleRider(); return;
      case 'h': case 'H': case '?': helpOpen = !helpOpen; return;
      case 'Enter': if (tool === 'poly' && draft) closeDraft(); return;
      case 'Delete': case 'Backspace': deleteSel(e.shiftKey); return;
      case '+': case '=': zoomAt(scrW / 2, scrH / 2, 1.3); return;
      case '-': case '_': zoomAt(scrW / 2, scrH / 2, 1 / 1.3); return;
      case '0': fitView(); return;
      case 'ArrowLeft': nudge(-1, 0, e.shiftKey); return;
      case 'ArrowRight': nudge(1, 0, e.shiftKey); return;
      case 'ArrowUp': nudge(0, -1, e.shiftKey); return;
      case 'ArrowDown': nudge(0, 1, e.shiftKey); return;
    }
  }

  function action(id) {
    switch (id) {
      case 'select': case 'poly': case 'burger': case 'glass': setTool(id); break;
      case 'rider': toggleRider(); break;
      case 'theme': cycleTheme(); break;
      case 'name': startNaming(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'zoomOut': zoomAt(scrW / 2, scrH / 2, 1 / 1.3); break;
      case 'zoomIn': zoomAt(scrW / 2, scrH / 2, 1.3); break;
      case 'fit': fitView(); break;
      case 'help': helpOpen = !helpOpen; break;
      case 'new': newMap(); break;
      case 'load': loadFile(); break;
      case 'save': saveFile(); break;
      case 'test': hooks.test(); break;
      case 'exit': hooks.exit(); break;
    }
  }

  function cursor() {
    if (drag && drag.kind === 'pan') return 'grabbing';
    for (const b of uiRects) if (hitRect(b, mx, my)) return 'pointer';
    if (tool !== 'select') return 'crosshair';
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
      prepared = prepareLevel(map);
      fitView();
      note(fresh ? 'Welcome! H shows the controls' : 'Picked up where you left off - H shows the controls');
    }
    sel = null; hov = null; drag = null; draft = null;
    naming = false;
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
    drawWorld(ctx, prepared, pat, view, rt);
    drawGrid(ctx, view);
    for (const b of map.burgers) drawBurger(ctx, b[0], b[1], rt);
    drawPopcorn(ctx, map.goal[0], map.goal[1], rt);
    drawStartMarker(ctx);
    drawGlassEdges(ctx);
    drawPolyOverlay(ctx);
    if (showRider) drawRiderPreview(ctx);
    drawDrafts(ctx, rt);
    drawSelectionRing(ctx);
    ctx.restore();

    drawWorldLabels(ctx);
    drawToolbar(ctx, W, H, rt);
    drawStatus(ctx, W, H);
    if (helpOpen) drawHelp(ctx, W, H);
  }

  function drawGrid(ctx, view) {
    ctx.save();
    ctx.lineWidth = 1 / zoom;
    // minor lines fade out when they would be closer than ~14 px apart
    if (zoom >= 14) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      for (let x = Math.ceil(view.x0); x <= view.x1; x++) {
        if (x % 5 === 0) continue;
        ctx.moveTo(x, view.y0);
        ctx.lineTo(x, view.y1);
      }
      for (let y = Math.ceil(view.y0); y <= view.y1; y++) {
        if (y % 5 === 0) continue;
        ctx.moveTo(view.x0, y);
        ctx.lineTo(view.x1, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    for (let x = Math.ceil(view.x0 / 5) * 5; x <= view.x1; x += 5) {
      ctx.moveTo(x, view.y0);
      ctx.lineTo(x, view.y1);
    }
    for (let y = Math.ceil(view.y0 / 5) * 5; y <= view.y1; y += 5) {
      ctx.moveTo(view.x0, y);
      ctx.lineTo(view.x1, y);
    }
    ctx.stroke();
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
    if (overToolbar()) return;
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
      const wire = map.wires.includes(pi);
      // a whole-polygon selection lights up the entire outline and every handle
      const polySel = sel && sel.kind === 'poly' && sel.pi === pi;
      ctx.strokeStyle = polySel ? '#f9c623'
        : wire ? 'rgba(120,220,255,0.9)' : 'rgba(255,255,255,0.45)';
      ctx.lineWidth = (polySel ? 3 : wire ? 2.5 : 1.5) / zoom;
      ctx.setLineDash(wire ? [8 / zoom, 5 / zoom] : []);
      strokePoly(ctx, poly);
      ctx.setLineDash([]);
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
    if (tool === 'glass' && !overToolbar()) {
      const w = s2w(mx, my);
      const e = pickEdge(w.x, w.y, BRUSH_R / zoom);
      if (e) stroke(e.pi, e.vi, '#f9c623', 6);
    }
    ctx.restore();
  }

  function drawDrafts(ctx, rt) {
    const w = s2w(mx, my);
    const cx = snap(w.x), cy = snap(w.y);
    if (tool === 'poly') {
      ctx.strokeStyle = '#ffe27a';
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
        ctx.fillStyle = '#ffe27a';
        const r = 4 / zoom;
        for (const v of draft) ctx.fillRect(v[0] - r, v[1] - r, r * 2, r * 2);
      }
      ctx.setLineDash([]);
    }
    if (tool === 'burger' && !overToolbar()) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      drawBurger(ctx, cx, cy, rt);
      ctx.restore();
    }
    if (tool !== 'select' && !overToolbar()) {
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
      } else if (p.kind === 'start') {
        ring(map.start.x, map.start.y, 1.0, hot);
      } else if (p.kind === 'goal') {
        ring(map.goal[0], map.goal[1], 0.75, hot);
      }
    }
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
    map.wires.forEach(pi => {
      const v = map.polygons[pi] && map.polygons[pi][0];
      if (v) tag(v[0], v[1] - 14 / zoom, 'wire', 'rgba(120,220,255,0.95)');
    });
    ctx.restore();
  }

  function overToolbar() {
    for (const b of uiRects) if (hitRect(b, mx, my)) return true;
    return false;
  }

  function drawToolbar(ctx, W, H, rt) {
    const caret = naming && (rt * 2) % 1 < 0.5 ? '|' : ' ';
    const defs = [
      { id: 'select', label: 'Select', on: tool === 'select' },
      { id: 'poly', label: '+Poly', on: tool === 'poly' },
      { id: 'burger', label: '+Burger', on: tool === 'burger' },
      { id: 'glass', label: '+Glass', on: tool === 'glass' },
      { id: 'rider', label: (showRider ? '[x]' : '[ ]') + ' Rider', on: showRider },
      { id: 'theme', label: 'Theme:' + map.theme },
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
    ];
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
    ctx.fillStyle = 'rgba(10,6,3,0.72)';
    ctx.fillRect(0, 0, W, y + bh + 8);
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
    select: 'drag vertices, edges, burgers, START, GOAL - Shift+drag moves a whole polygon - double-click an edge to add a vertex (a vertex to remove it) - Del removes (a glassed edge clears its glass; Shift+Del the whole polygon) - W wires a polygon',
    poly: 'click to lay vertices - click the first one (or Enter) closes the polygon - Esc cancels',
    burger: 'click to drop a triple cheeseburger',
    glass: 'click or drag along an edge to glass it (obsidian the tires barely grip) - paints the one edge nearest the cursor - clear it by selecting the edge and pressing Del',
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
      '  |  snap ' + SNAP, W - 10 - SAFE.right, ty);
    ctx.restore();
  }

  const HELP = [
    ['1 / V', 'Select: drag vertices, edges (walls move whole), burgers, START, GOAL'],
    ['Shift+drag', 'move a whole polygon at once (Shift+click a vertex/edge selects it)'],
    ['2 / P', 'Polygon: click out a new shape, close on the first point - inside the play area it is a solid island'],
    ['3 / B', 'Burger: click to drop burgers'],
    ['4 / G', 'Glass: paint obsidian onto edges (near-zero tire grip) - click or drag the nearest edge; clear it by selecting the edge and pressing Del'],
    ['double-click', 'on an edge adds a vertex; on a vertex removes it'],
    ['Del', 'remove the selection - a glassed edge clears its glass (Shift+Del: its whole polygon)'],
    ['W', 'toggle the selected polygon solid <-> wire (only wheels collide)'],
    ['R', 'toggle the rider preview: wheel (blue) + head (red) colliders parked under the cursor'],
    ['arrows', 'nudge the selection (Shift: whole units) - pan when nothing is selected'],
    ['T  /  N', 'cycle the theme / rename the map'],
    ['wheel  + - 0', 'zoom (0 fits the whole map)'],
    ['Ctrl+Z / Ctrl+Y', 'undo / redo'],
    ['Ctrl+S / Ctrl+O', 'save / open a ' + EXT + ' map file'],
    ['Ctrl+Enter', 'test ride the map - Esc comes back, Enter retries'],
    ['Esc', 'cancel / deselect; from a clean screen, back to the menu'],
  ];

  function drawHelp(ctx, W, H) {
    ctx.save();
    ctx.fillStyle = 'rgba(8,5,2,0.6)';
    ctx.fillRect(0, 0, W, H);
    const pw = Math.min(W * 0.9, 760);
    const ph = HELP.length * 24 + 86;
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
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9be08a';
    ctx.font = 'bold 13px ' + FONT;
    ctx.fillText('Saved ' + EXT + ' files are LEVELS entries - see the README to put them in a track', W / 2, py + ph - 18);
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
    // exposed for the headless tests
    get map() { return map; },
    get tool() { return tool; },
    get sel() { return sel; },
    worldToScreen: w2s,
    EXT,
  };
})();
