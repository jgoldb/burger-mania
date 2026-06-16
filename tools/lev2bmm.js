#!/usr/bin/env node
'use strict';

// Convert an Elasto Mania level (.lev) into a Burger Mania map (.bmm).
//
//   node tools/lev2bmm.js path/to/level.lev                 # -> path/to/level.bmm
//   node tools/lev2bmm.js level.lev out.bmm                 # explicit output path
//   node tools/lev2bmm.js level.lev --theme volcano --name "My Map"
//   node tools/lev2bmm.js level.lev --scale 1 --doodads --no-objects
//
// This is NOT a 1:1 port — Elasto Mania and Burger Mania are different games.
// What it DOES copy faithfully is the polygon terrain, which is the whole
// point: both engines describe a level as a set of polygons filled even-odd
// (the inside of the outer polygon is rideable air; a polygon nested inside it
// is a solid island), and Burger Mania collides wheels against bare segments
// with a two-sided closest-point push-out, so vertex winding is irrelevant.
// Copying the vertices verbatim therefore reproduces the exact terrain shape.
//
// Coordinates: X and Y are multiplied by --scale (default 1). Both games measure
// in comparable units — the tyre radius is ~0.4 in each — so 1:1 is right unless
// you want a bigger/smaller course. Y is copied straight through (Elma's stored Y
// and Burger Mania's world Y both grow downward); pass --flip-y only if a level
// comes out inverted.
//
// ---------------------------------------------------------------------------
// What maps to what (Elma .lev element -> Burger Mania):
//
//   polygon (terrain)      -> polygon (even-odd fill is identical)
//   polygon (grass flag)   -> IGNORED. Elma grass polygons are decorative fringe
//                             that never collides; Burger Mania grows its own
//                             grass on terrain edges (render.js prepareLevel), so
//                             importing them would just add stray shapes.
//   start object (type 4)  -> start. Elma's start marks the LEFT WHEEL; a BMM
//                             start is the FRAME CENTRE, so it's offset (see
//                             BIKE_ANCHOR_* below) to land the wheel where Elma's
//                             start sat.
//   exit / flower (type 1) -> goal (the popcorn bucket)
//   apple (type 2)         -> burger; an apple's GRAVITY field becomes a
//                             directional gravity burger: up/down/left/right
//                             gravity each map to the matching gravity burger
//                             (no gravity -> plain burger). Collecting one SETS
//                             gravity that way, exactly like Elma.
//   killer (type 3)        -> nut mound (the spike-equivalent hazard)
//   picture (LGR sprite)   -> doodad, ONLY with --doodads (off by default). Burger
//                             Mania has no matching art (its doodads are gym
//                             props), so each picture becomes a deterministically
//                             chosen doodad at the same spot, on the front or back
//                             layer by the picture's depth. Cosmetic only.
//   lgr / ground / sky     -> theme. Not translated (no custom graphics packs);
//                             tagged --theme (default meadow).
//   level name             -> name (override with --name)
//   top10 times, integrity -> ignored
//
// Burger Mania features with NO Elma source (so the converter never emits them):
// invisible polygons, front-layer polygons, per-edge no-collision, obsidian glass.
// ---------------------------------------------------------------------------
//
// Elma .lev binary layout (all little-endian), as implemented by elma-rust /
// elmajs (https://github.com/elmadev):
//   0   5   version string "POT14" (Elma) or "POT06" (Across)
//   5   2   unused
//   7   4   link (u32)
//   11  32  integrity[4] (f64)
//   43  51  level name
//   94  16  lgr name
//   110 10  ground texture name
//   120 10  sky texture name
//   130 8   polygon count as f64, stored as count + 0.4643643
//   ...     per polygon: grass (i32>0), vertexCount (i32), then x,y f64 pairs
//   ...     object count (f64 + 0.4643643), then objects (28 bytes each:
//           x f64, y f64, type i32, gravity i32, animation i32)
//   ...     picture count (f64 + 0.2345672), then pictures (54 bytes each:
//           name[10], texture[10], mask[10], x f64, y f64, distance i32, clip i32)
//   ...     EOD/top10/EOF — ignored

const fs = require('fs');
const path = require('path');

const FORMAT = 'burger-mania-map';
const VERSION = 2;                 // matches js/editor.js (per-edge glassEdges)
const POLY_MAGIC = 0.4643643;      // count obfuscation for polygons and objects
const PICTURE_MAGIC = 0.2345672;   // ...and a different one for pictures
const OBJ_TYPE = { EXIT: 1, APPLE: 2, KILLER: 3, START: 4 };
// Elma apple gravity field -> Burger Mania gravity-burger direction
const APPLE_GRAV_DIR = { 1: 'up', 2: 'down', 3: 'left', 4: 'right' };
// Elma's start object marks the bike's LEFT (rear) WHEEL — per the Across editor,
// "the start object determines the place of the left wheel" — whereas a Burger
// Mania start is the bike's FRAME CENTRE. These are the wheel->centre offsets
// (= js/physics.js PHYS.anchorX / anchorY; keep in sync if the bike is resized):
// the frame centre sits anchorX right of and anchorY above the left wheel, so
// shifting the converted start by (+anchorX, -anchorY) lands the bike's left wheel
// exactly where Elma's start sat — otherwise the taller bike spawns sunk into the
// ground. (BMM y grows downward, so "above the wheel" is -y.)
const BIKE_ANCHOR_X = 0.85;
const BIKE_ANCHOR_Y = 0.60;
// Burger Mania doodad sprite ids (js/render.js DOODADS). Elma pictures have no
// matching art, so --doodads just spreads these gym props across the picture
// positions. Keep in sync with render.js if doodads are added/removed.
const DOODAD_IDS = ['ac', 'rack', 'dumbbell', 'kettlebell', 'bench', 'ball',
  'cooler', 'locker', 'plant', 'cone', 'clock'];
// Elma picture "distance" (1-999): lower = nearer the viewer. Pictures below this
// land on the front layer (over the rider), the rest behind. A rough split — the
// art is unrelated anyway, so the exact threshold is cosmetic.
const FRONT_DISTANCE = 450;
const round2 = v => Math.round(v * 100) / 100;

// ---------- argument parsing ----------

function parseArgs(argv) {
  const opts = { theme: 'meadow', scale: 1, name: null, objects: true, doodads: false, flipY: false };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': opts.help = true; break;
      case '--no-objects': opts.objects = false; break;
      case '--doodads': opts.doodads = true; break;
      case '--flip-y': opts.flipY = true; break;
      case '--theme': opts.theme = argv[++i]; break;
      case '--name': opts.name = argv[++i]; break;
      case '--scale': opts.scale = Number(argv[++i]); break;
      default:
        if (a.startsWith('--')) throw new Error('unknown option ' + a);
        pos.push(a);
    }
  }
  opts.input = pos[0];
  opts.output = pos[1];
  if (!Number.isFinite(opts.scale) || opts.scale === 0) {
    throw new Error('--scale must be a non-zero number');
  }
  return opts;
}

const USAGE = `Convert an Elasto Mania .lev into a Burger Mania .bmm map.

  node tools/lev2bmm.js <input.lev> [output.bmm] [options]

Options:
  --theme <name>   Burger Mania theme to tag the map with (default: meadow)
  --name <text>    Map name (default: the level's own name, else the filename)
  --scale <n>      Multiply all coordinates by n (default: 1)
  --no-objects     Copy terrain only; synthesise a placeholder start/goal
  --doodads        Turn Elma pictures into (random) doodads (default: skip them)
  --flip-y         Negate Y (use only if the map comes out upside down)
  -h, --help       Show this help

Elma grass polygons are always ignored (Burger Mania grows its own grass on
terrain edges). .lgr files are Elma GRAPHICS, not maps — feed a .lev.`;

// ---------- .lev reader ----------

// A tiny cursor over the buffer that bounds-checks every read, so a truncated
// or non-level file fails with a clear message instead of returning garbage.
function reader(buf) {
  let off = 0;
  const need = n => {
    if (off + n > buf.length) {
      throw new Error(`unexpected end of file at byte ${off} (need ${n} more)`);
    }
  };
  return {
    get offset() { return off; },
    skip(n) { need(n); off += n; },
    str(n) { need(n); const s = buf.toString('latin1', off, off + n); off += n; return s; },
    u32() { need(4); const v = buf.readUInt32LE(off); off += 4; return v; },
    i32() { need(4); const v = buf.readInt32LE(off); off += 4; return v; },
    f64() { need(8); const v = buf.readDoubleLE(off); off += 8; return v; },
  };
}

const cstr = s => s.replace(/\0.*$/s, '').trim();   // null-terminated -> clean string
const count = (raw, magic) => Math.round(raw - magic);

function parseLev(buf) {
  const version = buf.slice(0, 5).toString('latin1');
  if (version !== 'POT14' && version !== 'POT06') {
    if (buf.slice(0, 3).toString('latin1') === 'LGR') {
      throw new Error(
        'this is an Elasto Mania .lgr GRAPHICS file (it holds images, not ' +
        'polygons). Polygon terrain lives in the .lev level file — convert that.');
    }
    throw new Error(`not an Elma level: expected "POT14"/"POT06", got "${cstr(version)}"`);
  }

  const r = reader(buf);
  r.skip(5);          // version
  r.skip(2);          // unused
  r.u32();            // link
  r.skip(8 * 4);      // integrity[4]
  const name = cstr(r.str(51));
  r.skip(16);         // lgr name
  r.skip(10);         // ground texture
  r.skip(10);         // sky texture

  const polyCount = count(r.f64(), POLY_MAGIC);
  if (polyCount < 0 || polyCount > 1e6) throw new Error('insane polygon count — file looks corrupt');
  const polygons = [];
  for (let p = 0; p < polyCount; p++) {
    const grass = r.i32() > 0;
    const vcount = r.i32();
    if (vcount < 0 || vcount > 1e6) throw new Error('insane vertex count — file looks corrupt');
    const verts = [];
    for (let v = 0; v < vcount; v++) verts.push([r.f64(), r.f64()]);
    polygons.push({ grass, verts });
  }

  const objects = [];
  const objCount = count(r.f64(), POLY_MAGIC);
  if (objCount < 0 || objCount > 1e6) throw new Error('insane object count — file looks corrupt');
  for (let o = 0; o < objCount; o++) {
    const x = r.f64(), y = r.f64();
    const type = r.i32();
    const gravity = r.i32();
    r.i32();          // animation
    objects.push({ x, y, type, gravity });
  }

  // pictures are decorative and come after the objects; a truncated or quirky
  // picture section must never sink a conversion (terrain + objects are already
  // read), so tolerate any failure and just yield no pictures.
  let pictures = [];
  try {
    const picCount = count(r.f64(), PICTURE_MAGIC);
    if (picCount >= 0 && picCount <= 1e6) {
      for (let p = 0; p < picCount; p++) {
        r.skip(10); r.skip(10); r.skip(10);   // name, texture, mask
        const x = r.f64(), y = r.f64();
        const distance = r.i32();
        r.i32();      // clipping
        pictures.push({ x, y, distance });
      }
    }
  } catch (e) { pictures = []; }

  return { name, polygons, objects, pictures };
}

// ---------- .lev -> .bmm ----------

function convert(lev, opts) {
  const sy = opts.flipY ? -1 : 1;                 // both use canvas Y-down; --flip-y inverts
  const tx = x => round2(x * opts.scale);
  const ty = y => round2(y * opts.scale * sy);
  const warnings = [];

  // terrain: drop decorative grass polygons (Burger Mania grows its own grass)
  // and anything with < 3 vertices (the parser rejects degenerate polygons)
  let dropped = 0, grassDropped = 0;
  const polygons = [];
  for (const poly of lev.polygons) {
    if (poly.grass) { grassDropped++; continue; }
    if (poly.verts.length < 3) { dropped++; continue; }
    polygons.push(poly.verts.map(([x, y]) => [tx(x), ty(y)]));
  }
  if (grassDropped) warnings.push(`ignored ${grassDropped} grass polygon(s) — Burger Mania grows its own grass on terrain edges`);
  if (dropped) warnings.push(`skipped ${dropped} degenerate polygon(s) (< 3 vertices)`);
  if (!polygons.length) throw new Error('no usable polygons after conversion — nothing to write');

  // objects -> Burger Mania equivalents
  const starts = [], exits = [], burgers = [], nuts = [], flipBurgers = [];
  if (opts.objects) {
    for (const obj of lev.objects) {
      const pt = [tx(obj.x), ty(obj.y)];
      if (obj.type === OBJ_TYPE.START) starts.push(pt);
      else if (obj.type === OBJ_TYPE.EXIT) exits.push(pt);
      else if (obj.type === OBJ_TYPE.KILLER) nuts.push(pt);
      else if (obj.type === OBJ_TYPE.APPLE) {
        // gravity 0 none, 1 up, 2 down, 3 left, 4 right -> a directional gravity
        // burger that SETS gravity that way (no gravity -> plain burger)
        const dir = APPLE_GRAV_DIR[obj.gravity];
        if (dir) flipBurgers.push([pt[0], pt[1], dir]);
        else burgers.push(pt);
      }
    }
  }

  // pictures -> doodads (opt-in). No matching art, so spread the gym props
  // deterministically (stride of 7 over 11 ids visits them all) and pick the
  // layer from the picture's depth, so re-converting a level is reproducible.
  const doodads = [];
  if (opts.doodads) {
    lev.pictures.forEach((pic, i) => {
      doodads.push({
        type: DOODAD_IDS[(i * 7 + 3) % DOODAD_IDS.length],
        x: tx(pic.x), y: ty(pic.y),
        layer: pic.distance < FRONT_DISTANCE ? 'front' : 'back',
      });
    });
  }

  // a valid .bmm needs exactly one start and one goal; fall back to the
  // polygon bounding box when the level had no such object
  let xs = [], ys = [];
  for (const poly of polygons) for (const [x, y] of poly) { xs.push(x); ys.push(y); }
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  let start;
  if (starts.length) {
    // Elma start = left-wheel position; shift to the frame centre (see above)
    start = { x: round2(starts[0][0] + BIKE_ANCHOR_X), y: round2(starts[0][1] - BIKE_ANCHOR_Y) };
    if (starts.length > 1) warnings.push(`level had ${starts.length} start objects; using the first`);
  } else {
    start = { x: round2(minX + (maxX - minX) * 0.1), y: round2(minY + (maxY - minY) * 0.1) };
    warnings.push('no start object found — placed a placeholder start (reposition it in the editor)');
  }

  let goal;
  if (exits.length) {
    goal = exits[0];
    if (exits.length > 1) warnings.push(`level had ${exits.length} exit objects; using the first as the goal`);
  } else {
    goal = [round2(maxX - (maxX - minX) * 0.1), round2(minY + (maxY - minY) * 0.1)];
    warnings.push('no exit/flower object found — placed a placeholder goal (reposition it in the editor)');
  }

  // assemble in the same field order js/editor.js writes, so the file is a
  // drop-in .bmm: header first, then the LEVELS-entry body
  const out = {
    format: FORMAT,
    version: VERSION,
    savedAt: new Date().toISOString(),
    name: opts.name || lev.name || 'Converted Level',
    theme: opts.theme,
    polygons,
    start,
    burgers,
    goal,
  };
  if (nuts.length) out.nuts = nuts;
  if (flipBurgers.length) out.flipBurgers = flipBurgers;
  if (doodads.length) out.doodads = doodads;

  return {
    bmm: out, warnings,
    stats: { polygons: polygons.length, burgers: burgers.length, flip: flipBurgers.length, nuts: nuts.length, doodads: doodads.length },
  };
}

// ---------- main ----------

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error('error: ' + e.message + '\n');
    console.error(USAGE);
    process.exit(2);
  }
  if (opts.help || !opts.input) {
    console.log(USAGE);
    process.exit(opts.input ? 0 : 1);
  }

  let buf;
  try {
    buf = fs.readFileSync(opts.input);
  } catch (e) {
    console.error(`error: cannot read ${opts.input}: ${e.message}`);
    process.exit(1);
  }

  let result;
  try {
    result = convert(parseLev(buf), opts);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }

  const outPath = opts.output ||
    path.join(path.dirname(opts.input), path.basename(opts.input).replace(/\.lev$/i, '') + '.bmm');
  fs.writeFileSync(outPath, JSON.stringify(result.bmm));

  for (const w of result.warnings) console.warn('  note: ' + w);
  const s = result.stats;
  console.log(`wrote ${outPath}`);
  console.log(`  ${s.polygons} polygon(s), ${s.burgers} burger(s)` +
    (s.flip ? `, ${s.flip} flip burger(s)` : '') +
    (s.nuts ? `, ${s.nuts} nut mound(s)` : '') +
    (s.doodads ? `, ${s.doodads} doodad(s)` : '') +
    `, theme "${result.bmm.theme}", named "${result.bmm.name}"`);
}

main();
