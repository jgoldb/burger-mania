'use strict';

// deterministic pseudo-random for grass blades (stable frame to frame)
function srand(n) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

// Visual worlds: every 5-map (checkpoint-to-checkpoint) block of a track
// gets its own world — ground tile, gradient sky with drifting haze,
// parallax background silhouettes, surface decoration (grass, flames,
// ...), outline and minimap palette. Levels pick one via their `theme`
// field. Tile layers are blob passes: n blobs, radius in [rMin, rMax],
// cycling through `colors`; sky tiles have no base so they overlay the
// gradient.
const THEMES = {
  // sunny meadow: dirt, blue sky over rolling green hills, grass
  // (Beginner 1-5)
  meadow: {
    ground: { base: '#8c5e35', layers: [
      { n: 240, rMin: 2, rMax: 9, colors: ['rgba(60,38,18,0.25)',
        'rgba(140,100,55,0.30)', 'rgba(172,126,70,0.22)', 'rgba(80,50,25,0.28)'] },
    ] },
    skyStops: [[0, '#8fc0e8'], [1, '#ddeff8']],
    skyTile: { layers: [
      { n: 22, rMin: 8, rMax: 26, colors: ['rgba(150,185,220,0.16)',
        'rgba(255,255,255,0.13)', 'rgba(255,255,255,0.10)'] },
    ] },
    background: drawMeadowBack,
    edge: drawGrassEdge,
    // world height of the backdrop's ground line (here the near hills' feet).
    // A level may ask drawWorld to render the backdrop ground at a different
    // height (see level.groundY); the editor's fresh maps put it on the floor.
    groundY: 9.9,
    turfFill: '#3f8d27', turfBlade: '#2f7a1d',
    outline: 'rgba(40,20,5,0.5)',
    miniGround: '#6b4a24', miniSky: '#a7c4de',
  },
  // volcano: basalt flecked with embers, a lava-lit sky over erupting
  // cones, molten crust with fire instead of grass (Beginner 6-10)
  volcano: {
    ground: { base: '#3a3034', layers: [
      { n: 240, rMin: 2, rMax: 9, colors: ['rgba(16,10,14,0.35)',
        'rgba(86,68,74,0.28)', 'rgba(24,14,18,0.30)', 'rgba(110,92,96,0.18)'] },
      // embers glowing in the rock
      { n: 50, rMin: 0.8, rMax: 2.4, colors: ['rgba(255,120,30,0.50)',
        'rgba(255,190,70,0.38)', 'rgba(235,70,20,0.45)'] },
    ] },
    skyStops: [[0, '#241318'], [0.55, '#7e3122'], [1, '#e8823a']],
    skyTile: { layers: [
      { n: 20, rMin: 10, rMax: 26, colors: ['rgba(30,16,18,0.22)',
        'rgba(255,160,80,0.08)', 'rgba(30,16,18,0.16)'] },
    ] },
    background: drawVolcanoBack,
    edge: drawLavaEdge,
    groundY: 10.8,                          // the erupting cones' bases
    outline: 'rgba(255,120,40,0.45)',
    miniGround: '#352529', miniSky: '#c75a2a',
  },
  // Planet-Fitness-style gym: a speckled rubber floor under a lit purple
  // wall. The "sky" is the back wall; drawGymBack dresses the room into a
  // full indoor scene — ceiling lights, a yellow accent stripe with
  // motivational signage, and two depth ranks of machines worked by curling,
  // pressing, squatting meatheads. A Map-Editor world; no shipped track uses
  // it yet.
  gym: {
    ground: { base: '#44474d', layers: [
      { n: 230, rMin: 1.6, rMax: 5.5, colors: ['rgba(26,28,32,0.34)',
        'rgba(92,96,103,0.28)', 'rgba(18,19,22,0.30)', 'rgba(116,120,128,0.20)'] },
      // stray flecks of colour in the rubber matting
      { n: 26, rMin: 0.6, rMax: 1.5, colors: ['rgba(150,110,200,0.30)',
        'rgba(245,205,40,0.24)', 'rgba(220,80,70,0.20)'] },
    ] },
    skyStops: [[0, '#4a3072'], [0.45, '#5d3f86'], [0.8, '#6f4f98'], [1, '#7a5aa3']],
    // no drifting haze indoors — the back wall stays clear (haze:false skips the
    // whole drifting-tile pass, so the sky tile below is built but never drawn)
    skyTile: { layers: [] },
    haze: false,
    background: drawGymBack,
    edge: drawGymEdge,
    groundY: 11.5,                          // ground line sits a touch above the rider's floor, so the box bottom tucks under the gym floor
    outline: 'rgba(16,14,22,0.5)',
    miniGround: '#3c3f45', miniSky: '#5d3f86',
  },
  // Egyptian desert: rippled gold sand under a hot hazy sky. drawDesertBack
  // dresses the horizon with a rank of casing-stone pyramids (polished
  // limestone faces, gilded gold caps) past soft dunes and a sphinx, then a
  // foreground of standing sarcophagi, shambling mummies and tomb treasure.
  // An outdoor world, so it keeps the drifting dust haze. A Map-Editor world.
  desert: {
    ground: { base: '#d9bd86', layers: [
      { n: 220, rMin: 1.6, rMax: 5.5, colors: ['rgba(150,120,70,0.22)',
        'rgba(225,205,160,0.28)', 'rgba(120,92,52,0.18)', 'rgba(245,230,190,0.20)'] },
      // scattered pebbles and grit
      { n: 30, rMin: 0.5, rMax: 1.3, colors: ['rgba(110,84,50,0.30)',
        'rgba(80,60,36,0.26)', 'rgba(250,240,205,0.30)'] },
    ] },
    skyStops: [[0, '#5a9bd0'], [0.5, '#9fc3dd'], [0.82, '#e9d9b3'], [1, '#f3e6c5']],
    skyTile: { layers: [
      // thin high haze / dust drifting on the wind
      { n: 14, rMin: 12, rMax: 30, colors: ['rgba(245,235,205,0.10)',
        'rgba(255,250,235,0.09)', 'rgba(220,205,170,0.08)'] },
    ] },
    background: drawDesertBack,
    edge: drawDesertEdge,
    groundY: 11.0,                          // the sand line the monuments stand on (DESERT_FLOOR)
    outline: 'rgba(70,50,24,0.5)',
    miniGround: '#c2a567', miniSky: '#9fc3dd',
  },
  // Rainbow Road in space: the track body is dark cosmos flecked with rainbow
  // stardust, its driving surface a glowing rainbow band edged by a twinkling
  // star railing (drawSpaceEdge). drawSpaceBack fills the void with twinkling
  // starfields, spiral galaxies, ringed planets, nebulae and asteroids that
  // fly through. Like the gym it has no drifting haze tile. A Map-Editor world.
  space: {
    ground: { base: '#141233', layers: [
      // rainbow stardust glowing in the translucent track body
      { n: 70, rMin: 1.2, rMax: 4.5, colors: ['rgba(255,70,110,0.12)',
        'rgba(70,200,255,0.12)', 'rgba(150,90,255,0.12)', 'rgba(70,224,120,0.10)',
        'rgba(255,226,60,0.10)', 'rgba(255,120,220,0.10)'] },
      // bright pinpoint stars in the surface
      { n: 42, rMin: 0.3, rMax: 0.9, colors: ['rgba(255,255,255,0.85)',
        'rgba(255,233,168,0.7)', 'rgba(180,220,255,0.7)'] },
    ] },
    skyStops: [[0, '#05030f'], [0.5, '#0a0820'], [1, '#150b2e']],
    skyTile: { layers: [] },
    haze: false,
    background: drawSpaceBack,
    edge: drawSpaceEdge,
    outline: 'rgba(150,200,255,0.6)',     // neon track edge
    miniGround: '#241b4a', miniSky: '#070414',
  },
  // Cave: a dark underground world (Map-Editor only). drawCaveBack fills it
  // with stalactites, stalagmites, columns, glowing crystals, glowworm patches,
  // still pools and flitting bats. The `dark` flag makes game.js black out the
  // playfield except for the rider's headlight/taillight cones WHILE PLAYING
  // (the editor's design canvas returns before that code, so editing — and the
  // whole picture — stays fully lit). Haze off.
  cave: {
    ground: { base: '#2a2420', layers: [
      { n: 230, rMin: 1.6, rMax: 5.5, colors: ['rgba(12,9,7,0.40)',
        'rgba(64,54,44,0.30)', 'rgba(20,15,11,0.34)', 'rgba(84,72,58,0.20)'] },
      // damp mineral flecks in the rock
      { n: 24, rMin: 0.5, rMax: 1.3, colors: ['rgba(150,180,200,0.25)',
        'rgba(180,150,210,0.22)', 'rgba(140,200,180,0.20)'] },
    ] },
    skyStops: [[0, '#171109'], [0.5, '#241a12'], [1, '#15110d']],
    skyTile: { layers: [] },
    haze: false,
    dark: true,
    groundY: 11,                           // pin the floor formations to the map's ground (= CAVE_GROUND)
    background: drawCaveBack,
    edge: drawCaveEdge,
    outline: 'rgba(8,6,4,0.6)',
    miniGround: '#241d16', miniSky: '#1a130c',
  },
};

// Builds one seamless texture tile. `px` is the canvas size; a bigger tile
// repeats over a longer world distance (its world-per-pixel scale is fixed in
// makePatterns), so fewer copies show across a screen and the eye stops
// reading it as "the same tile over and over". Blob radii are in tile pixels
// (a fixed world size whatever px is); per-layer `n` is a density per 128², so
// a larger tile gets proportionally more blobs instead of looking sparse.
function makeTile(spec, px) {
  px = px || 128;
  // blobs are stamped at wrapped offsets so the tiles repeat seamlessly
  const wraps = [[0, 0], [px, 0], [-px, 0], [0, px], [0, -px]];
  const dens = (px / 128) * (px / 128);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const cc = c.getContext('2d');
  if (spec.base) {
    cc.fillStyle = spec.base;
    cc.fillRect(0, 0, px, px);
  }
  for (const layer of spec.layers) {
    const n = Math.round(layer.n * dens);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * px, y = Math.random() * px;
      const r = layer.rMin + Math.random() * (layer.rMax - layer.rMin);
      cc.fillStyle = layer.colors[i % layer.colors.length];
      for (const [ox, oy] of wraps) {
        cc.beginPath();
        cc.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        cc.fill();
      }
    }
  }
  return c;
}

// A coarse, low-frequency luminance noise tile: soft light/dark blots on a
// neutral grey (rgb 128 is the soft-light no-op). Laid over the ground in
// makePatterns at a large, incommensurate period and blended soft-light, it
// mottles the terrain in big patches so the fine ground tile no longer lines
// up into a visible grid. It only lightens/darkens, so every theme shares one.
function makeMottle(px) {
  const wraps = [[0, 0], [px, 0], [-px, 0], [0, px], [0, -px],
    [px, px], [-px, -px], [px, -px], [-px, px]];
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const cc = c.getContext('2d');
  cc.fillStyle = '#808080';
  cc.fillRect(0, 0, px, px);
  // few, large, soft blots so distinct patches emerge instead of averaging
  // back to flat grey under all the overlap
  const n = Math.round(px * px / 4500);
  for (let i = 0; i < n; i++) {
    const x = Math.random() * px, y = Math.random() * px;
    const r = px * (0.14 + Math.random() * 0.26);
    const tone = Math.random() < 0.5 ? '0,0,0' : '255,255,255';
    const a = 0.14 + Math.random() * 0.16;
    for (const [ox, oy] of wraps) {
      const g = cc.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, 'rgba(' + tone + ',' + a + ')');
      g.addColorStop(1, 'rgba(' + tone + ',0)');
      cc.fillStyle = g;
      cc.beginPath();
      cc.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      cc.fill();
    }
  }
  return c;
}

// HUD lettering comes in two inks: dark over bright skies, warm light
// over dark ones. Each pairs with a halo in the opposite shade, drawn as
// a soft glow behind the glyphs, so the text stays readable even where
// the backdrop drifts toward the ink's own shade (ground, ceilings, the
// bright band of a gradient).
const HUD_INK_DARK = { text: 'rgba(58,26,10,0.9)', halo: 'rgba(255,247,230,0.9)' };
const HUD_INK_LIGHT = { text: 'rgba(255,241,222,0.92)', halo: 'rgba(30,14,9,0.9)' };

// picks a theme's HUD ink from its sky-gradient luminance (the sky is
// what usually sits behind the corner text), weighting the zenith stop
// since the HUD lives at the top of the screen. Derived rather than
// hand-picked so each new world gets a readable HUD for free. Expects
// #rrggbb stops, which is what every theme uses.
function hudInk(theme) {
  let lum = 0, wsum = 0;
  theme.skyStops.forEach(([, c], i) => {
    const n = parseInt(c.slice(1), 16);
    const w = i === 0 ? 2 : 1;
    lum += w * (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255)
      + 0.0722 * (n & 255)) / 255;
    wsum += w;
  });
  return lum / wsum > 0.5 ? HUD_INK_DARK : HUD_INK_LIGHT;
}

// builds one pattern set per theme; callers pick by level theme name
function makePatterns(ctx) {
  const out = {};
  // one shared, theme-agnostic mottle (see makeMottle). Its period (31 world
  // units) is large and incommensurate with the ground tile (14.4), so the
  // two never repeat in step — together they read as endless variation rather
  // than a grid, even though each on its own is a small repeating tile.
  const mottle = ctx.createPattern(makeMottle(256), 'repeat');
  mottle.setTransform(new DOMMatrix([31 / 256, 0, 0, 31 / 256, 0, 0]));
  for (const name of Object.keys(THEMES)) {
    const t = THEMES[name];
    // The world-per-pixel scale is unchanged (3.6/128, 7/128); the bigger
    // canvases just push the repeat out — ground every 3.6·(512/128)=14.4
    // units, haze every 7·(384/128)=21, vs the ~26-unit-wide screen, so at
    // most a repeat or two is ever on screen instead of seven.
    const ground = ctx.createPattern(makeTile(t.ground, 512), 'repeat');
    ground.setTransform(new DOMMatrix([3.6 / 128, 0, 0, 3.6 / 128, 0, 0]));
    const sky = ctx.createPattern(makeTile(t.skyTile, 384), 'repeat');
    sky.setTransform(new DOMMatrix([7 / 128, 0, 0, 7 / 128, 0, 0]));
    out[name] = Object.assign({}, t, {
      ground, sky, mottle, skyPeriod: 7 * 384 / 128, hud: hudInk(t),
    });
  }
  return out;
}

// vertical sky gradient between world heights y0 (zenith) and y1 (horizon)
function skyGradient(ctx, theme, y0, y1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [p, c] of theme.skyStops) g.addColorStop(p, c);
  return g;
}

// one smooth parallax layer of background hills: p is how slowly it
// tracks the camera (smaller = farther away), baseY the world height of
// its foot, the silhouette a sum of two sines sampled across the view
function hillLayer(ctx, view, p, baseY, amp, k, color) {
  const u = (view.x0 + view.x1) / 2 * (1 - p);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(view.x0 - 1, view.y1);
  for (let x = view.x0 - 1; x <= view.x1 + 1; x += 0.8) {
    const s = (x - u) * k;
    const y = baseY - amp * (0.52 + 0.34 * Math.sin(s) + 0.14 * Math.sin(s * 2.6 + 1.7));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(view.x1 + 1, view.y1);
  ctx.closePath();
  ctx.fill();
}

// jagged parallax ridge: two triangle waves stacked into sawtooth peaks
function ridgeLayer(ctx, view, p, baseY, amp, period, color) {
  const u = (view.x0 + view.x1) / 2 * (1 - p);
  const tri = (s, per) => Math.abs((((s / per) % 1) + 1) % 1 - 0.5) * 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(view.x0 - 1, view.y1);
  for (let x = view.x0 - 1; x <= view.x1 + 1; x += 0.8) {
    const s = x - u;
    const h = 0.62 * tri(s, period) + 0.38 * tri(s, period * 0.43);
    ctx.lineTo(x, baseY - amp * h);
  }
  ctx.lineTo(view.x1 + 1, view.y1);
  ctx.closePath();
  ctx.fill();
}

// meadow backdrop: a soft sun and two ranks of rolling hills. gdy shifts the
// ground-anchored hills when a map pins its backdrop ground (see drawWorld);
// the sun tracks the camera ("at infinity"), so it is left unshifted.
function drawMeadowBack(ctx, view, t, actor, gdy) {
  gdy = gdy || 0;
  const w = view.x1 - view.x0;
  const sx = view.x0 + w * 0.78, sy = view.y0 + 2.6;
  const g = ctx.createRadialGradient(sx, sy, 0.2, sx, sy, 3.4);
  g.addColorStop(0, 'rgba(255,246,200,0.95)');
  g.addColorStop(0.25, 'rgba(255,240,180,0.55)');
  g.addColorStop(1, 'rgba(255,240,180,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(sx, sy, 3.4, 0, Math.PI * 2);
  ctx.fill();
  hillLayer(ctx, view, 0.22, 9.0 + gdy, 3.0, 0.42, 'rgba(158,196,164,0.65)');
  hillLayer(ctx, view, 0.42, 9.9 + gdy, 2.0, 0.66, 'rgba(118,168,116,0.72)');
}

// volcano backdrop: a far jagged ridge, then a rank of cones with
// pulsing crater glows and lava streaks down their flanks
function drawVolcanoBack(ctx, view, t, actor, gdy) {
  gdy = gdy || 0;
  ridgeLayer(ctx, view, 0.16, 10.0 + gdy, 5.2, 21, 'rgba(54,26,30,0.60)');
  const p = 0.36, spacing = 30;
  const u = (view.x0 + view.x1) / 2 * (1 - p);
  const first = Math.floor((view.x0 - u - 9) / spacing) * spacing;
  for (let s = first; s <= view.x1 - u + 9; s += spacing) {
    const x = s + u;
    const r = srand(s * 0.013 + 3.7);
    const h = 5.5 + r * 2.5, half = 4.6 + r * 1.8;
    const capW = 0.9 + r * 0.5;
    const baseY = 10.8 + gdy, py = baseY - h;
    ctx.fillStyle = 'rgba(46,22,26,0.88)';
    ctx.beginPath();
    ctx.moveTo(x - half, baseY);
    ctx.lineTo(x - capW, py);
    ctx.lineTo(x + capW, py);
    ctx.lineTo(x + half, baseY);
    ctx.closePath();
    ctx.fill();
    // crater glow breathes slowly; a lava streak runs down the flank
    const pulse = 0.6 + 0.25 * Math.sin(t * 1.7 + s);
    const g = ctx.createRadialGradient(x, py, 0.1, x, py, capW * 2.6);
    g.addColorStop(0, 'rgba(255,170,70,' + 0.8 * pulse + ')');
    g.addColorStop(0.4, 'rgba(255,100,30,' + 0.38 * pulse + ')');
    g.addColorStop(1, 'rgba(255,90,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, py, capW * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,130,45,' + 0.55 * pulse + ')';
    ctx.lineWidth = 0.16;
    ctx.beginPath();
    ctx.moveTo(x + capW * 0.35, py + 0.1);
    ctx.lineTo(x + capW * 0.35 + (half - capW) * 0.5, py + h * 0.58);
    ctx.stroke();
  }
}

// ---------- gym world (the indoor Planet-Fitness backdrop) ----------
//
// The wall gradient (skyStops) paints the lit purple room; everything below
// is fixed in world space and laid back-to-front so panning and climbing
// reveal more of the gym, exactly like the meadow's hills. The floor line
// (where the back wall meets the rubber floor and the machines stand) sits at
// floorY, matching the hill convention so it lines up with the menu/victory
// floor too.
const GYM = {
  yellow: '#f4cb27', purpleDk: '#3a2658',
  metal: '#c6cbd2', metalDk: '#7f868f', frame: '#2b2f36', frameLo: '#1d2025',
  pad: '#23262c', chrome: '#d8dde3', screen: '#2bd0e0',
  // skin tones and tank-top colours, picked per gym-goer so a row isn't all
  // the same guy
  skin: ['#caa07a', '#b9895f', '#9c7550', '#e0b48f', '#8a6a4a'],
  tank: ['#e7533b', '#3f8fd0', '#46b06a', '#e8a93a', '#cf4fa0', '#d8dde3'],
};
const GYM_FLOOR = 11.0;
// how much the gym furniture and gym-goers are shrunk in place, so the room
// reads bigger and the props recede into the background
const GYM_DETAIL = 0.6;

// stable per-slot pick from an array (srand keyed on the slot lattice coord,
// so the choice never flickers as the camera pans)
function gymPick(arr, key) { return arr[Math.floor(srand(key) * arr.length) % arr.length]; }

// walk the repeating slots of one parallax layer across the view, calling
// draw(worldX, slotKey) for each. slotKey is the lattice coordinate (stable
// regardless of camera), so callers seed their per-item variety on it.
function gymRow(ctx, view, p, spacing, draw) {
  const u = (view.x0 + view.x1) / 2 * (1 - p);
  const lo = view.x0 - u - spacing, hi = view.x1 - u + spacing;
  const first = Math.floor(lo / spacing) * spacing;
  const count = Math.floor((hi - first) / spacing) + 1;
  for (let i = 0, s = first; i < count; i++, s += spacing) draw(s + u, s);
}

// draw one gym prop shrunk by GYM_DETAIL about its own footing (ax, ay), so it
// stays grounded/wall-anchored while reading smaller
function gymItem(ctx, ax, ay, draw) {
  ctx.save();
  ctx.translate(ax, ay);
  ctx.scale(GYM_DETAIL, GYM_DETAIL);
  ctx.translate(-ax, -ay);
  draw();
  ctx.restore();
}

// crisp text in the scaled world context: rasterise the glyphs near their
// real on-screen size (a sane font px) and scale into place, rather than
// setting a sub-pixel font that would rasterise tiny and then blur up
function gymText(ctx, str, x, y, worldH, color, weight) {
  ctx.save();
  ctx.translate(x, y);
  const k = worldH / 14;
  ctx.scale(k, k);
  ctx.fillStyle = color;
  ctx.font = (weight || '700') + ' 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(str, 0, 0);
  ctx.restore();
}

// a small dumbbell in a lifter's hand
function drawDumbbellSmall(ctx, cx, cy) {
  ctx.fillStyle = '#23262c';
  ctx.beginPath(); ctx.arc(cx - 0.10, cy, 0.075, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 0.10, cy, 0.075, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#4a4f57'; ctx.lineWidth = 0.05; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - 0.08, cy); ctx.lineTo(cx + 0.08, cy); ctx.stroke();
}

// a stylised dumbbell glyph for wall signs
function drawDumbbellIcon(ctx, cx, cy, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 0.1; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - 0.36, cy); ctx.lineTo(cx + 0.36, cy); ctx.stroke();
  for (const sx of [-1, 1]) {
    ctx.fillRect(cx + sx * 0.36 - 0.05, cy - 0.2, 0.1, 0.4);
    ctx.fillRect(cx + sx * 0.5 - 0.05, cy - 0.13, 0.1, 0.26);
  }
  ctx.restore();
}

// a chrome barbell loaded with plates, centred at (cx, cy)
function drawBarbell(ctx, cx, cy, half) {
  ctx.fillStyle = GYM.chrome;
  ctx.fillRect(cx - half, cy - 0.035, half * 2, 0.07);
  for (const sx of [-1, 1]) {
    ctx.fillStyle = GYM.frameLo;
    ctx.fillRect(cx + sx * (half - 0.14) - 0.03, cy - 0.05, 0.06, 0.1);
    ctx.fillStyle = '#33373e';
    roundRectPath(ctx, cx + sx * (half - 0.02) - 0.07, cy - 0.3, 0.13, 0.6, 0.03); ctx.fill();
    ctx.fillStyle = GYM.yellow;
    roundRectPath(ctx, cx + sx * (half - 0.02) - 0.07, cy - 0.3, 0.13, 0.12, 0.03); ctx.fill();
  }
}

// a barbell seen end-on — looking straight down the bar, so we only see the
// round plate stack with the bar's chrome end poking through. Used by the
// side-on bench press, where the bar runs into the screen and just rises/falls.
function drawBarbellEnd(ctx, cx, cy) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#33373e';                               // plate disc
  ctx.beginPath(); ctx.arc(0, 0, 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = GYM.frameLo; ctx.lineWidth = 0.04;     // plate rim
  ctx.beginPath(); ctx.arc(0, 0, 0.2, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = GYM.yellow; ctx.lineWidth = 0.05;      // weight-class ring
  ctx.beginPath(); ctx.arc(0, 0, 0.13, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = GYM.chrome;                              // bar end / collar hub
  ctx.beginPath(); ctx.arc(0, 0, 0.06, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// one arm of a meathead, posed by the lift. side is +1 (near) / -1 (far);
// the far arm is dimmed so it reads behind the torso. Returns nothing.
function drawMeatArm(ctx, pose, cyc, t, ph, side, sw, shY, skin, far) {
  const shx = side * sw, shy = shY + 0.02;
  let hx, hy, weight = null;
  if (pose === 'curl') {
    const lx = shx * 0.7, ly = shY + 0.55, ux = shx * 0.5, uy = shY + 0.04;
    hx = lx + (ux - lx) * cyc; hy = ly + (uy - ly) * cyc; weight = 'db';
  } else if (pose === 'press') {
    const lx = shx * 0.85, ly = shY - 0.02, ux = shx * 0.55, uy = shY - 0.62;
    hx = lx + (ux - lx) * cyc; hy = ly + (uy - ly) * cyc; weight = 'db';
  } else if (pose === 'pull') {
    hx = shx * 1.15; hy = (shY - 0.64) + 0.54 * cyc;
  } else if (pose === 'squat') {
    hx = shx * 1.2; hy = shY - 0.04;
  } else if (pose === 'ellip') { // hands reach up to the swinging handle grips
    const g = ellipGrip(side, ellipStride(t, ph));
    hx = g.x; hy = g.y;
  } else { // run: arms pump out of phase with the legs
    const s = t * 8.5 + ph + (side < 0 ? Math.PI : 0);
    hx = shx * 0.6 + side * 0.05; hy = shY + 0.34 - 0.14 * Math.sin(s);
  }
  ctx.save();
  if (far) ctx.globalAlpha = 0.8;
  ctx.strokeStyle = skin; ctx.lineWidth = far ? 0.12 : 0.135;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const mx = (shx + hx) / 2, my = (shy + hy) / 2;
  const ddx = hx - shx, ddy = hy - shy, L = Math.hypot(ddx, ddy) || 1;
  // the elbow bows out of the shoulder-hand line. Pressers (hand overhead),
  // runners (hand swinging below) and pulldowns (elbows flaring as the bar comes
  // down) must throw the elbow OUT/forward; tucking it in reads as a
  // backward-bending, hyperextended joint. Curl/squat/ellip tuck in.
  let bend;
  if (pose === 'press') bend = 0.1 * side;
  else if (pose === 'run') bend = -0.12 * side;
  else if (pose === 'pull') bend = 0.1 * side;
  else bend = 0.12 * side;                                  // curl, squat, ellip
  const ex = mx + (-ddy / L) * bend - 0.04 * side, ey = my + (ddx / L) * bend;
  ctx.beginPath(); ctx.moveTo(shx, shy); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
  if (weight === 'db') { ctx.globalAlpha = far ? 0.8 : 1; drawDumbbellSmall(ctx, hx, hy); }
  ctx.restore();
}

// one buff gym-goer, feet at the origin, ~1.5 tall, facing right. pose drives
// the working limbs through a slow effort loop (curl / press / run / squat /
// pull); ph offsets the loop so a rank of them isn't in lockstep. Flat tone
// shapes so they still read at background scale. (The bench presser is drawn
// inline by its station — he's lying down.)
function drawMeathead(ctx, pose, t, ph, skin, tank) {
  const fast = pose === 'run';
  const cyc = 0.5 - 0.5 * Math.cos(t * (fast ? 8.5 : 3.0) + ph); // 0..1 effort
  const sw = 0.23, shY = -1.16, hipY = -0.62, headR = 0.135, neckY = -1.2;
  const leg = '#2b2e35', legHi = '#3a3e46';
  let dy = 0;
  if (pose === 'squat') dy = 0.24 * cyc;            // squat dips the frame
  if (fast) dy = 0.05 * Math.abs(Math.sin(t * 8.5 + ph)); // run bobs it
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.16)';               // floor shadow (not lifted)
  ctx.beginPath(); ctx.ellipse(0, 0.02, 0.3, 0.055, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(0, dy);

  // legs
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (fast) {
    const s = t * 8.5 + ph;
    for (const sg of [1, -1]) {
      const a = Math.sin(s + (sg < 0 ? Math.PI : 0));
      const footx = 0.22 * a, footy = -Math.max(0, a) * 0.14;
      ctx.strokeStyle = sg < 0 ? leg : legHi; ctx.lineWidth = 0.16;
      ctx.beginPath();
      ctx.moveTo(0, hipY); ctx.lineTo(footx * 0.5, -0.3); ctx.lineTo(footx, footy);
      ctx.stroke();
    }
  } else if (pose === 'squat') {
    const knee = 0.18 + 0.16 * cyc, ky = -0.3 + 0.05 * cyc;
    for (const sg of [1, -1]) {
      ctx.strokeStyle = sg < 0 ? leg : legHi; ctx.lineWidth = 0.17;
      ctx.beginPath();
      ctx.moveTo(sg * 0.05, hipY); ctx.lineTo(sg * knee, ky); ctx.lineTo(sg * 0.2, 0);
      ctx.stroke();
    }
  } else if (pose === 'ellip') {            // feet planted on the gliding pedals
    const s = ellipStride(t, ph);
    for (const sg of [1, -1]) {
      const f = ellipPedal(sg, s);
      const kx = f.x * 0.5 + 0.12, ky = (hipY + f.y) / 2;   // knee juts toward the machine
      ctx.strokeStyle = sg < 0 ? leg : legHi; ctx.lineWidth = 0.16;
      ctx.beginPath();
      ctx.moveTo(0, hipY); ctx.lineTo(kx, ky); ctx.lineTo(f.x, f.y);
      ctx.stroke();
    }
  } else {
    for (const sg of [1, -1]) {
      ctx.strokeStyle = sg < 0 ? leg : legHi; ctx.lineWidth = 0.16;
      ctx.beginPath();
      ctx.moveTo(sg * 0.05, hipY); ctx.lineTo(sg * 0.11, -0.3); ctx.lineTo(sg * 0.14, 0);
      ctx.stroke();
    }
  }

  drawMeatArm(ctx, pose, cyc, t, ph, -1, sw, shY, skin, true);  // far arm

  // torso: broad shoulders tapering to the waist (the meathead V)
  ctx.fillStyle = tank;
  ctx.beginPath();
  ctx.moveTo(-sw - 0.05, shY + 0.04);
  ctx.quadraticCurveTo(-0.205, (shY + hipY) / 2, -0.13, hipY + 0.02);
  ctx.lineTo(0.13, hipY + 0.02);
  ctx.quadraticCurveTo(0.205, (shY + hipY) / 2, sw + 0.05, shY + 0.04);
  ctx.quadraticCurveTo(0, shY - 0.1, -sw - 0.05, shY + 0.04);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.025;
  ctx.beginPath(); ctx.moveTo(0, shY + 0.02); ctx.lineTo(0, hipY); ctx.stroke();

  // neck + head
  ctx.strokeStyle = skin; ctx.lineWidth = 0.14; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, shY + 0.02); ctx.lineTo(0, neckY); ctx.stroke();
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(0, neckY - headR * 0.7, headR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';               // hair cap
  ctx.beginPath(); ctx.arc(0, neckY - headR * 0.95, headR, Math.PI * 1.05, Math.PI * 2.05); ctx.fill();

  drawMeatArm(ctx, pose, cyc, t, ph, 1, sw, shY, skin, false); // near arm
  ctx.restore();
}

// ceiling: a dark soffit with a row of recessed light panels and their soft
// downward glow. Mostly seen only when the camera climbs.
function drawGymCeiling(ctx, view, t) {
  const ceilY = 3.5;            // lowered with the rest of the wall so the lights ride lower
  const g = ctx.createLinearGradient(0, ceilY - 2.4, 0, ceilY + 0.4);
  g.addColorStop(0, 'rgba(20,14,30,0.55)');
  g.addColorStop(1, 'rgba(20,14,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(view.x0, ceilY - 2.4, view.x1 - view.x0, 2.8);
  gymRow(ctx, view, 0.07, 3.0, (x) => {
    const lg = ctx.createLinearGradient(0, ceilY - 0.42, 0, ceilY + 0.08);
    lg.addColorStop(0, 'rgba(255,252,236,0.9)');
    lg.addColorStop(1, 'rgba(255,246,210,0.3)');
    ctx.fillStyle = lg;
    roundRectPath(ctx, x - 1.0, ceilY - 0.42, 2.0, 0.5, 0.06); ctx.fill();
    const gl = ctx.createLinearGradient(0, ceilY + 0.08, 0, ceilY + 1.9);
    gl.addColorStop(0, 'rgba(255,250,225,0.16)');
    gl.addColorStop(1, 'rgba(255,250,225,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(x - 1.0, ceilY + 0.08, 2.0, 1.8);
  });
}

// the bold yellow accent stripe banding the wall, with the gym's repeated
// wordmark riding it
function drawAccentStripe(ctx, view, p, y) {
  const h = 0.5, w = view.x1 - view.x0;
  ctx.fillStyle = GYM.yellow;
  ctx.fillRect(view.x0, y, w, h);
  ctx.fillStyle = 'rgba(58,38,88,0.85)';
  ctx.fillRect(view.x0, y - 0.04, w, 0.04);
  ctx.fillRect(view.x0, y + h, w, 0.04);
  gymRow(ctx, view, p, 7.0, (x) => {
    gymText(ctx, 'JUDGEMENT  FREE  ZONE', x, y + h / 2 + 0.02, 0.32, GYM.purpleDk, '800');
  });
}

// a framed wall mirror with cool glass. When `actor` (the live bike) rolls in
// front of this pane, a dim copy of him is rendered into the glass — from
// BEHIND, since the mirror is on the back wall and catches the back of his
// head — tracked to his position and clipped to the frame, so the reflection
// slides past as he goes by. With no actor (editor/menus) the glass just shows
// its gradient and sheen. `gdy` is drawGymBack's ground-pin shift, used to put
// his world height into this backdrop's shifted frame.
function drawMirror(ctx, x, yTop, w, h, t, key, actor, gdy) {
  gdy = gdy || 0;
  const gx = x - w / 2;
  ctx.fillStyle = GYM.frameLo;                          // frame
  roundRectPath(ctx, gx - 0.06, yTop - 0.06, w + 0.12, h + 0.12, 0.05); ctx.fill();
  const g = ctx.createLinearGradient(0, yTop, 0, yTop + h); // glass base
  g.addColorStop(0, '#b9c6d6'); g.addColorStop(0.5, '#94a6b9'); g.addColorStop(1, '#7e93a8');
  ctx.fillStyle = g;
  ctx.fillRect(gx, yTop, w, h);

  // only render the reflection when the rider is roughly in front of this pane
  // (keeps it to ~one mirror, so the per-frame drawBike cost is bounded). His
  // real y lives in the world frame; subtract gdy to put it in this backdrop's
  // shifted frame, then measure how far he floats above the glass floor so the
  // reflection rises as he jumps.
  if (actor && actor.pos && Math.abs(actor.pos.x - x) < w / 2 + 1.5) {
    const rs = 0.7;                                      // reflection a touch smaller than life
    const air = Math.max(0, (yTop + h) - (actor.pos.y - gdy));
    const refCy = yTop + h * 0.7 - air * 0.5;
    ctx.save();
    ctx.beginPath(); ctx.rect(gx, yTop, w, h); ctx.clip();
    ctx.translate(actor.pos.x, refCy);                   // tracks him 1:1 horizontally
    // a wall mirror runs parallel to his travel, so the reflection faces the
    // same way he rides (no left/right flip); the head is the back-of-head image
    ctx.scale(rs, rs);
    ctx.translate(-actor.pos.x, -actor.pos.y);
    ctx.globalAlpha = 0.5;
    drawBike(ctx, actor, false, true);
    ctx.restore();
    // a cool wash so the reflection reads as sitting behind the glass
    ctx.save();
    ctx.beginPath(); ctx.rect(gx, yTop, w, h); ctx.clip();
    const wash = ctx.createLinearGradient(0, yTop, 0, yTop + h);
    wash.addColorStop(0, 'rgba(170,186,205,0.34)');
    wash.addColorStop(1, 'rgba(120,140,162,0.46)');
    ctx.fillStyle = wash;
    ctx.fillRect(gx, yTop, w, h);
    ctx.restore();
  }

  ctx.save();                                            // diagonal sheen streaks
  ctx.beginPath(); ctx.rect(gx, yTop, w, h); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.06; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(gx + 0.12, yTop + h); ctx.lineTo(gx + 0.6, yTop);
  ctx.moveTo(gx + 0.4, yTop + h); ctx.lineTo(gx + 0.88, yTop);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = GYM.frame; ctx.lineWidth = 0.05;     // frame outline
  roundRectPath(ctx, gx, yTop, w, h, 0.02); ctx.stroke();
}

// a motivational wall plaque (purple-on-yellow or the reverse), some with a
// dumbbell crest
function drawWallSign(ctx, x, y, key) {
  const w = 2.6, h = 1.5, r = srand(key * 0.3 + 0.1), invert = r < 0.5;
  const bg = invert ? GYM.purpleDk : GYM.yellow;
  const ink = invert ? GYM.yellow : GYM.purpleDk;
  ctx.fillStyle = bg;
  roundRectPath(ctx, x - w / 2, y, w, h, 0.1); ctx.fill();
  ctx.strokeStyle = ink; ctx.lineWidth = 0.07;
  roundRectPath(ctx, x - w / 2, y, w, h, 0.1); ctx.stroke();
  if (r < 0.33) {
    gymText(ctx, 'NO LUNKS', x, y + 0.42, 0.34, ink, '800');
    gymText(ctx, 'ALLOWED', x, y + 0.92, 0.34, ink, '800');
  } else if (r < 0.66) {
    drawDumbbellIcon(ctx, x, y + 0.5, ink);
    gymText(ctx, 'PLANET BURGER', x, y + 1.06, 0.3, ink, '800');
  } else {
    gymText(ctx, 'YOU GOT', x, y + 0.42, 0.34, ink, '800');
    gymText(ctx, 'THIS!', x, y + 0.92, 0.4, ink, '800');
  }
}

// far cardio rank: a treadmill with a running meathead
function drawTreadmill(ctx, x, baseY, t, key) {
  ctx.save();
  ctx.translate(x, baseY);
  ctx.scale(srand(key) < 0.5 ? -1 : 1, 1);
  ctx.fillStyle = GYM.frame;
  roundRectPath(ctx, -0.7, -0.18, 1.4, 0.18, 0.05); ctx.fill();
  ctx.fillStyle = '#15171b';
  roundRectPath(ctx, -0.62, -0.3, 1.05, 0.16, 0.04); ctx.fill();   // belt
  ctx.fillStyle = GYM.metalDk;
  roundRectPath(ctx, 0.3, -0.34, 0.34, 0.34, 0.05); ctx.fill();    // motor cowl
  ctx.fillStyle = GYM.frame;
  ctx.fillRect(-0.66, -1.5, 0.1, 1.32);                            // upright
  ctx.fillRect(-0.6, -1.5, 0.52, 0.08);                            // handle
  ctx.fillStyle = GYM.metalDk;
  roundRectPath(ctx, -0.76, -1.8, 0.52, 0.34, 0.05); ctx.fill();   // console
  ctx.fillStyle = GYM.screen;
  roundRectPath(ctx, -0.72, -1.76, 0.44, 0.22, 0.03); ctx.fill();
  ctx.save();
  ctx.translate(-0.06, -0.3); ctx.scale(0.92, 0.92);
  drawMeathead(ctx, 'run', t, key, gymPick(GYM.skin, key), gymPick(GYM.tank, key + 1));
  ctx.restore();
  ctx.restore();
}

// elliptical kinematics, machine-local. One shared stride `s` drives both the
// machine (pedals + swing handles) and the rider (feet + hands), so they move as
// one unit. `sg` = +1 near / -1 far; the two sides glide in opposition.
function ellipStride(t, key) { return Math.sin(t * 5 + key); }
function ellipPedal(sg, s) { return { x: -0.1 + 0.34 * s * sg, y: -0.04 - 0.05 * Math.max(0, s * sg) }; }
function ellipGrip(sg, s) {
  const tx = -0.1 - 0.2 * s * sg;                       // top of this side's swing pole
  return { x: 0.52 + 0.6 * (tx - 0.52), y: -1.29 };     // hand rides 60% up the pole
}

// far cardio rank: an elliptical with a striding meathead. Feet ride the pedals
// and hands ride the swing handles — all keyed off the same stride, so the rider
// and machine move in lockstep.
function drawElliptical(ctx, x, baseY, t, key) {
  ctx.save();
  ctx.translate(x, baseY);
  ctx.scale(srand(key + 3) < 0.5 ? -1 : 1, 1);
  const s = ellipStride(t, key);
  ctx.fillStyle = GYM.frame;
  roundRectPath(ctx, 0.34, -0.95, 0.5, 0.95, 0.08); ctx.fill();    // flywheel housing
  ctx.fillStyle = GYM.metalDk;
  ctx.beginPath(); ctx.arc(0.59, -0.5, 0.26, 0, Math.PI * 2); ctx.fill();
  // foot pedals on their crank arms
  ctx.lineCap = 'round';
  for (const sg of [1, -1]) {
    const p = ellipPedal(sg, s);
    ctx.strokeStyle = GYM.metal; ctx.lineWidth = 0.07;
    ctx.beginPath(); ctx.moveTo(0.5, -0.55); ctx.lineTo(p.x, p.y); ctx.stroke();
    ctx.fillStyle = GYM.frameLo; ctx.fillRect(p.x - 0.12, p.y, 0.26, 0.06);
  }
  // swing handles: one pole per side, with a foam grip where the rider holds on
  for (const sg of [1, -1]) {
    const tx = -0.1 - 0.2 * s * sg;
    ctx.strokeStyle = GYM.frame; ctx.lineWidth = 0.08;
    ctx.beginPath(); ctx.moveTo(0.52, -0.9); ctx.lineTo(tx, -1.55); ctx.stroke();
    ctx.strokeStyle = GYM.frameLo; ctx.lineWidth = 0.13;     // foam grip straddling the hold
    ctx.beginPath();
    ctx.moveTo(0.52 + 0.5 * (tx - 0.52), -0.9 + 0.5 * -0.65);
    ctx.lineTo(0.52 + 0.72 * (tx - 0.52), -0.9 + 0.72 * -0.65);
    ctx.stroke();
  }
  ctx.fillStyle = GYM.metalDk;
  roundRectPath(ctx, 0.36, -1.5, 0.4, 0.3, 0.05); ctx.fill();
  ctx.fillStyle = GYM.screen;
  roundRectPath(ctx, 0.4, -1.46, 0.32, 0.2, 0.03); ctx.fill();
  drawMeathead(ctx, 'ellip', t, key, gymPick(GYM.skin, key), gymPick(GYM.tank, key + 2));
  ctx.restore();
}

// near strength rank: a power rack with a meathead squatting under the bar
function drawSquatStation(ctx, x, baseY, t, key) {
  ctx.save();
  ctx.translate(x, baseY);
  const cyc = 0.5 - 0.5 * Math.cos(t * 3 + key);
  ctx.fillStyle = GYM.frame;
  ctx.fillRect(-0.92, -2.4, 0.16, 2.4); ctx.fillRect(0.76, -2.4, 0.16, 2.4);
  ctx.fillRect(-0.92, -2.4, 1.84, 0.16);                 // top tie
  ctx.fillStyle = GYM.yellow;
  ctx.fillRect(-0.92, -1.2, 0.22, 0.07); ctx.fillRect(0.7, -1.2, 0.22, 0.07); // J-hooks
  drawMeathead(ctx, 'squat', t, key, gymPick(GYM.skin, key), gymPick(GYM.tank, key + 1));
  drawBarbell(ctx, 0, -1.16 + 0.24 * cyc, 0.86);         // bar across the shoulders
  ctx.restore();
}

// near strength rank: a cable tower; a meathead does a standing pulldown and
// the selected plates ride up as he pulls
function drawCableStack(ctx, x, baseY, t, key) {
  ctx.save();
  ctx.translate(x, baseY);
  const cyc = 0.5 - 0.5 * Math.cos(t * 3 + key);         // 1 = pulled down
  ctx.fillStyle = GYM.frame;
  ctx.fillRect(0.5, -2.5, 0.18, 2.5); ctx.fillRect(0.42, -2.5, 0.6, 0.16);
  ctx.fillStyle = GYM.frameLo;
  roundRectPath(ctx, 0.46, -2.1, 0.5, 1.65, 0.04); ctx.fill();    // stack housing
  const lift = 0.42 * cyc;
  for (let i = 0; i < 7; i++) {
    const py = -0.55 - i * 0.18 - (i < 3 ? lift : 0);
    ctx.fillStyle = i < 3 ? '#6b7280' : '#3a3e45';
    roundRectPath(ctx, 0.52, py, 0.4, 0.13, 0.02); ctx.fill();
  }
  ctx.strokeStyle = GYM.metal; ctx.lineWidth = 0.05;
  ctx.beginPath(); ctx.arc(0.72, -2.4, 0.09, 0, Math.PI * 2); ctx.stroke();  // pulley
  const barY = -1.82 + 0.54 * cyc;
  ctx.strokeStyle = '#cfd5db'; ctx.lineWidth = 0.03;
  ctx.beginPath(); ctx.moveTo(0.72, -2.38); ctx.lineTo(0, barY - 0.02); ctx.stroke();
  ctx.fillStyle = GYM.chrome; ctx.fillRect(-0.28, barY - 0.03, 0.56, 0.06);  // lat bar
  drawMeathead(ctx, 'pull', t, key, gymPick(GYM.skin, key), gymPick(GYM.tank, key + 1));
  ctx.restore();
}

// near strength rank: a flat bench with a meathead pressing a barbell. He's
// lying down, so he's drawn inline rather than via drawMeathead.
function drawBenchStation(ctx, x, baseY, t, key) {
  ctx.save();
  ctx.translate(x, baseY);
  ctx.scale(srand(key + 5) < 0.5 ? -1 : 1, 1);
  const cyc = 0.5 - 0.5 * Math.cos(t * 3 + key);         // 1 = locked out
  const skin = gymPick(GYM.skin, key), tank = gymPick(GYM.tank, key + 1);
  ctx.fillStyle = GYM.frame;
  ctx.fillRect(-0.66, -1.15, 0.1, 1.15); ctx.fillRect(0.56, -1.15, 0.1, 1.15); // uprights
  ctx.fillStyle = GYM.pad;
  roundRectPath(ctx, -0.55, -0.52, 1.1, 0.16, 0.05); ctx.fill();   // bench top
  ctx.fillStyle = GYM.frame;
  ctx.fillRect(-0.5, -0.4, 0.07, 0.4); ctx.fillRect(0.43, -0.4, 0.07, 0.4); // legs
  ctx.fillStyle = tank;
  roundRectPath(ctx, -0.34, -0.66, 0.62, 0.18, 0.07); ctx.fill();  // torso
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(-0.42, -0.6, 0.12, 0, Math.PI * 2); ctx.fill(); // head
  ctx.strokeStyle = '#2c2f36'; ctx.lineWidth = 0.12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(0.24, -0.5); ctx.lineTo(0.5, -0.3); ctx.lineTo(0.62, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0.2, -0.5); ctx.lineTo(0.42, -0.28); ctx.lineTo(0.5, 0); ctx.stroke();
  const handY = -0.7 - 0.55 * cyc;
  ctx.strokeStyle = skin; ctx.lineWidth = 0.11;
  ctx.beginPath(); ctx.moveTo(0.0, -0.62); ctx.lineTo(0.06, handY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-0.08, -0.62); ctx.lineTo(0.0, handY); ctx.stroke();
  drawBarbellEnd(ctx, 0.03, handY);                                // bar runs into the screen
  ctx.restore();
}

// near strength rank: a free-weight guy curling or pressing dumbbells beside
// a small dumbbell rack
function drawFreeWeightGuy(ctx, x, baseY, t, key) {
  ctx.save();
  ctx.translate(x, baseY);
  ctx.save();
  ctx.translate(1.0, 0);                                  // rack to his side
  ctx.fillStyle = GYM.frame;
  roundRectPath(ctx, -0.5, -0.72, 1.0, 0.72, 0.06); ctx.fill();
  ctx.fillStyle = GYM.frameLo;
  ctx.fillRect(-0.5, -0.46, 1.0, 0.05);
  for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) drawDumbbellSmall(ctx, -0.32 + i * 0.21, -0.5 + r * 0.3);
  ctx.restore();
  const pose = srand(key + 7) < 0.5 ? 'curl' : 'press';
  drawMeathead(ctx, pose, t, key, gymPick(GYM.skin, key), gymPick(GYM.tank, key + 1));
  ctx.restore();
}

// the whole indoor gym scene, painted over the purple wall gradient. `actor`
// (optional) is the live bike, reflected in the wall mirrors.
function drawGymBack(ctx, view, t, actor, gdy) {
  gdy = gdy || 0;
  // the indoor scene is one rigid room (ceiling, wall, mirrors, floor all at
  // fixed world heights), so a ground pin shifts the whole thing as a unit
  ctx.save();
  if (gdy) ctx.translate(0, gdy);
  const floorY = GYM_FLOOR;
  drawGymCeiling(ctx, view, t);
  // back wall (one depth, parallax 0.12): the accent stripe, then a row that
  // alternates motivational signage with mirrors that reflect the rider. The
  // wall sits low — the mirrors' feet end just above the floor (their 2.8 tall
  // panes start at 7.9, so bottoms land at 10.7, a touch over the 11.0 ground).
  drawAccentStripe(ctx, view, 0.12, 7.15);
  gymRow(ctx, view, 0.12, 4.6, (x, key) => {
    if (srand(key * 0.07 + 1.3) < 0.5) gymItem(ctx, x, 8.0, () => drawWallSign(ctx, x, 8.0, key));
    else drawMirror(ctx, x, 7.9, 2.0, 2.8, t, key, actor, gdy);
  });
  // far cardio rank
  gymRow(ctx, view, 0.3, 5.4, (x, key) => gymItem(ctx, x, floorY, () => {
    if (srand(key * 0.05 + 4.1) < 0.5) drawTreadmill(ctx, x, floorY, t, key);
    else drawElliptical(ctx, x, floorY, t, key);
  }));
  // near strength rank (bigger, faster parallax, a touch lower so it reads
  // as the foreground row)
  gymRow(ctx, view, 0.46, 8.8, (x, key) => gymItem(ctx, x, floorY + 0.25, () => {
    const r = srand(key * 0.09 + 2.7);
    if (r < 0.25) drawSquatStation(ctx, x, floorY + 0.25, t, key);
    else if (r < 0.5) drawCableStack(ctx, x, floorY + 0.25, t, key);
    else if (r < 0.75) drawBenchStation(ctx, x, floorY + 0.25, t, key);
    else drawFreeWeightGuy(ctx, x, floorY + 0.25, t, key);
  }));
  ctx.restore();
}

// the lip of the rubber gym floor: a dark mat edge with a worn safety stripe
// and a faint sheen — the gym world's answer to grass/lava
function drawGymEdge(ctx, s, theme, t) {
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return;
  const ux = dx / len, uy = dy / len;
  let nx = uy, ny = -ux;            // normal pointing up into the playable area
  if (ny > 0) { nx = -nx; ny = -ny; }
  ctx.fillStyle = '#2b2e34';
  ctx.beginPath();
  ctx.moveTo(s.ax - nx * 0.015, s.ay - ny * 0.015);
  ctx.lineTo(s.bx - nx * 0.015, s.by - ny * 0.015);
  ctx.lineTo(s.bx + nx * 0.12, s.by + ny * 0.12);
  ctx.lineTo(s.ax + nx * 0.12, s.ay + ny * 0.12);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(233,196,42,0.5)'; ctx.lineWidth = 0.04;
  ctx.beginPath();
  ctx.moveTo(s.ax + nx * 0.05, s.ay + ny * 0.05);
  ctx.lineTo(s.bx + nx * 0.05, s.by + ny * 0.05);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(200,210,222,0.28)'; ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.moveTo(s.ax + nx * 0.005, s.ay + ny * 0.005);
  ctx.lineTo(s.bx + nx * 0.005, s.by + ny * 0.005);
  ctx.stroke();
}

// ---------- desert world (the Egyptian-pyramids backdrop) ----------
//
// Like the other backdrops, everything is fixed in world space and laid
// back-to-front so panning/climbing reveals more of the scene. The sand
// horizon (where dunes, monuments and props stand) sits at sandY, matching the
// hill convention. Reuses the gymRow/gymText/gymPick helpers (generic parallax
// row / world-text / stable per-slot pick, first written for the gym world).
const DESERT = {
  limeLit: '#efe4c4', limeSh: '#cdbb8e', limeEdge: '#fff7de',  // polished casing stone
  gold: '#f2cf3e', goldHi: '#ffe98a', goldSh: '#b5860f',       // gilded caps / treasure
  stone: '#caa86e', stoneSh: '#9c7f4c',                        // weathered sandstone
  granite: '#7c5a52', graniteSh: '#583e39',                    // obelisk granite
  wrapLt: '#e8dec5', wrapSh: '#c9bc98', wrapLine: '#a99c78',    // mummy bandages
  nemesBlue: '#2f6fa8', kohl: '#23324a',                       // headdress / eye paint
  sandDrift: 'rgba(214,190,140,0.55)',
};
const DESERT_FLOOR = 11.0;

// the hot sun high over the dunes, plus a warm dusty heat-haze band low on the
// horizon. The sun tracks the camera (it sits "at infinity"), like the meadow's.
function drawDesertSun(ctx, view, t, gdy) {
  gdy = gdy || 0;
  const w = view.x1 - view.x0;
  const sx = view.x0 + w * 0.72, sy = view.y0 + 2.2;
  const g = ctx.createRadialGradient(sx, sy, 0.2, sx, sy, 6.5);
  g.addColorStop(0, 'rgba(255,247,214,0.92)');
  g.addColorStop(0.16, 'rgba(255,238,182,0.5)');
  g.addColorStop(1, 'rgba(255,235,170,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(sx, sy, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,250,228,0.95)';
  ctx.beginPath(); ctx.arc(sx, sy, 1.45, 0, Math.PI * 2); ctx.fill();
  // warm haze pooling on the horizon (over the dunes/monuments), ground-anchored
  const hy = 9.7 + gdy;
  const hg = ctx.createLinearGradient(0, hy, 0, 11.3 + gdy);
  hg.addColorStop(0, 'rgba(244,231,197,0)');
  hg.addColorStop(1, 'rgba(244,231,197,0.34)');
  ctx.fillStyle = hg;
  ctx.fillRect(view.x0, hy, w, 1.6);
}

// one pyramid: two casing faces (sunlit / shadowed) of polished limestone, a
// soft specular sheen, bright sunlit corner edges, and a gilded gold
// pyramidion that twinkles. base centred at (px, baseY).
function drawPyramid(ctx, px, baseY, hw, h, t, glintKey) {
  const apexX = px, apexY = baseY - h;
  const nearX = px + hw * 0.16;              // foot of the near vertical edge
  // shadowed (right) face
  ctx.fillStyle = DESERT.limeSh;
  ctx.beginPath();
  ctx.moveTo(apexX, apexY); ctx.lineTo(nearX, baseY); ctx.lineTo(px + hw, baseY);
  ctx.closePath(); ctx.fill();
  // sunlit (left) face
  ctx.fillStyle = DESERT.limeLit;
  ctx.beginPath();
  ctx.moveTo(apexX, apexY); ctx.lineTo(px - hw, baseY); ctx.lineTo(nearX, baseY);
  ctx.closePath(); ctx.fill();
  // polished sheen sweeping across the lit face
  const sg = ctx.createLinearGradient(px - hw, 0, nearX, 0);
  sg.addColorStop(0, 'rgba(255,255,255,0)');
  sg.addColorStop(0.6, 'rgba(255,253,238,0.26)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.moveTo(apexX, apexY); ctx.lineTo(px - hw, baseY); ctx.lineTo(nearX, baseY);
  ctx.closePath(); ctx.fill();
  // bright sunlit casing edges
  ctx.strokeStyle = DESERT.limeEdge; ctx.lineWidth = 0.04; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(px - hw, baseY); ctx.lineTo(apexX, apexY); ctx.lineTo(nearX, baseY);
  ctx.stroke();
  // gilded pyramidion (top cf of the height)
  const cf = 0.14, cy = apexY + h * cf;
  const cl = px - hw * cf, cr = px + hw * cf, cn = px + hw * 0.16 * cf;
  ctx.fillStyle = DESERT.goldSh;
  ctx.beginPath(); ctx.moveTo(apexX, apexY); ctx.lineTo(cn, cy); ctx.lineTo(cr, cy);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = DESERT.gold;
  ctx.beginPath(); ctx.moveTo(apexX, apexY); ctx.lineTo(cl, cy); ctx.lineTo(cn, cy);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(120,90,20,0.5)'; ctx.lineWidth = 0.03;
  ctx.beginPath(); ctx.moveTo(cl, cy); ctx.lineTo(cr, cy); ctx.stroke();
  // a sun-glint twinkle on the cap
  const tw = 0.55 + 0.45 * Math.sin(t * 2 + glintKey * 1.7);
  if (tw > 0.2) {
    ctx.strokeStyle = 'rgba(255,253,235,' + (0.8 * tw).toFixed(3) + ')'; ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.moveTo(apexX - 0.2 * tw, apexY + 0.05); ctx.lineTo(apexX + 0.2 * tw, apexY + 0.05);
    ctx.moveTo(apexX, apexY - 0.16 * tw); ctx.lineTo(apexX, apexY + 0.26 * tw);
    ctx.stroke();
  }
  // sand drift banked against the base
  ctx.fillStyle = DESERT.sandDrift;
  ctx.beginPath();
  ctx.moveTo(px - hw - 0.5, baseY);
  ctx.quadraticCurveTo(px - hw, baseY - 0.2, px - hw + 0.6, baseY);
  ctx.closePath(); ctx.fill();
}

// a Giza-style cluster: a great pyramid flanked by a smaller one behind and a
// little queen's pyramid in front
function drawPyramidGroup(ctx, x, baseY, t, key) {
  const r = srand(key * 0.013 + 0.5);
  const big = 4.8 + r * 1.6;
  drawPyramid(ctx, x - 4.3 - r, baseY, big * 0.66, big * 0.72, t, key + 2);
  drawPyramid(ctx, x, baseY, big * 0.92, big, t, key);
  drawPyramid(ctx, x + 3.1 + r * 0.6, baseY, 1.1, 1.7, t, key + 5);
}

// the Great Sphinx, a weathered sandstone silhouette: reclining lion body,
// outstretched forepaws and a nemes-crowned pharaoh head (nose long gone)
function drawSphinx(ctx, x, baseY, t, key) {
  ctx.save();
  ctx.translate(x, baseY);
  ctx.scale(srand(key + 1) < 0.5 ? -1 : 1, 1);
  ctx.fillStyle = DESERT.stone;
  ctx.beginPath();
  ctx.moveTo(-1.5, 0);
  ctx.lineTo(-1.5, -0.5);
  ctx.quadraticCurveTo(-1.4, -0.95, -0.85, -1.0);   // haunch
  ctx.lineTo(0.7, -1.0);
  ctx.lineTo(0.92, -1.5);                           // chest up to the neck
  ctx.lineTo(1.28, -1.5);
  ctx.lineTo(1.34, -1.0);
  ctx.lineTo(1.78, -0.95);                          // forepaws reaching out
  ctx.lineTo(1.78, 0);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = DESERT.stoneSh; ctx.lineWidth = 0.04; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(1.34, -0.5); ctx.lineTo(1.74, -0.5); ctx.stroke(); // paw split
  // head + nemes headdress
  ctx.fillStyle = DESERT.stone;
  ctx.beginPath();
  ctx.moveTo(0.84, -1.5); ctx.lineTo(0.82, -2.02);
  ctx.lineTo(0.98, -2.2); ctx.lineTo(1.32, -2.2); ctx.lineTo(1.48, -2.02);
  ctx.lineTo(1.46, -1.5); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = DESERT.stoneSh; ctx.lineWidth = 0.03;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(0.9, -2.0 + i * 0.15); ctx.lineTo(1.42, -2.0 + i * 0.15); ctx.stroke();
  }
  ctx.fillStyle = DESERT.stoneSh;                   // worn face shadow
  ctx.fillRect(1.16, -1.96, 0.28, 0.42);
  ctx.restore();
}

// a granite obelisk: a tapering shaft with a gilded pyramidion tip and a
// column of carved glyph ticks
function drawObelisk(ctx, x, baseY, t, key) {
  ctx.save();
  ctx.translate(x, baseY);
  const h = 3.4, wB = 0.3, wT = 0.15, ty = -h + 0.36;
  ctx.fillStyle = DESERT.granite;
  ctx.beginPath();
  ctx.moveTo(-wB, 0); ctx.lineTo(-wT, ty); ctx.lineTo(0, ty); ctx.lineTo(0, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = DESERT.graniteSh;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, ty); ctx.lineTo(wT, ty); ctx.lineTo(wB, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = DESERT.gold;
  ctx.beginPath(); ctx.moveTo(-wT, ty); ctx.lineTo(0, -h); ctx.lineTo(0, ty); ctx.closePath(); ctx.fill();
  ctx.fillStyle = DESERT.goldSh;
  ctx.beginPath(); ctx.moveTo(0, -h); ctx.lineTo(wT, ty); ctx.lineTo(0, ty); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(40,28,22,0.4)'; ctx.lineWidth = 0.025;
  for (let i = 0; i < 7; i++) {
    const yy = -0.5 - i * 0.4;
    ctx.beginPath(); ctx.moveTo(-0.06, yy); ctx.lineTo(0.06, yy); ctx.stroke();
  }
  ctx.restore();
}

// a date palm with a curved trunk and drooping fronds that sway on the wind
function drawPalm(ctx, x, baseY, t, key) {
  ctx.save();
  ctx.translate(x, baseY);
  ctx.scale(srand(key + 4) < 0.5 ? -1 : 1, 1);
  const h = 2.6, sway = 0.14 * Math.sin(t * 0.9 + key);
  const cx = 0.45 + sway, cy = -h;
  ctx.strokeStyle = '#9c7b4c'; ctx.lineWidth = 0.17; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(0.22, -h * 0.55, cx, cy); ctx.stroke();
  ctx.strokeStyle = 'rgba(80,60,36,0.5)'; ctx.lineWidth = 0.04;
  for (let i = 1; i < 6; i++) {
    const f = i / 6, tx = 0.22 * 2 * f * (1 - f) + cx * f, tyy = -h * f;
    ctx.beginPath(); ctx.moveTo(tx - 0.08, tyy); ctx.lineTo(tx + 0.08, tyy); ctx.stroke();
  }
  // date cluster
  ctx.fillStyle = '#b5862f';
  ctx.beginPath(); ctx.arc(cx, cy + 0.06, 0.1, 0, Math.PI * 2); ctx.fill();
  // fronds fanning from the crown, drooping at the tips
  ctx.strokeStyle = '#4f7a3a'; ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * (0.12 + i / 6 * 0.76) + sway * 0.4; // from right-up over to left-up
    const ex = cx + Math.cos(a) * 1.25, ey = cy + Math.sin(a) * 1.25 + 0.5;
    const mxp = cx + Math.cos(a) * 0.7, myp = cy + Math.sin(a) * 0.7 - 0.1;
    ctx.lineWidth = 0.08;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.quadraticCurveTo(mxp, myp, ex, ey); ctx.stroke();
  }
  ctx.restore();
}

// a round-topped stela with a winged-disc lunette and rows of carved glyphs
function drawStela(ctx, x, baseY, t, key) {
  ctx.save();
  ctx.translate(x, baseY);
  const w = 1.0, h = 2.0;
  ctx.fillStyle = DESERT.stone;
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -h + w / 2);
  ctx.arc(0, -h + w / 2, w / 2, Math.PI, 0); ctx.lineTo(w / 2, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = DESERT.stoneSh; ctx.lineWidth = 0.04; ctx.stroke();
  // winged sun disc near the top
  ctx.fillStyle = DESERT.gold;
  ctx.beginPath(); ctx.arc(0, -h + 0.42, 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = DESERT.goldSh; ctx.lineWidth = 0.04;
  ctx.beginPath(); ctx.moveTo(-0.34, -h + 0.42); ctx.lineTo(0.34, -h + 0.42); ctx.stroke();
  // glyph rows
  ctx.strokeStyle = 'rgba(60,44,28,0.45)'; ctx.lineWidth = 0.03;
  for (let i = 0; i < 6; i++) {
    const yy = -h + 0.78 + i * 0.22;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 0.16, yy); ctx.lineTo(w / 2 - 0.16, yy); ctx.stroke();
  }
  ctx.restore();
}

// a standing anthropoid sarcophagus: a gilded mummiform coffin with a
// nemes-striped golden mask, a false beard, a crook-and-flail and a glyph band
function drawSarcophagus(ctx, x, baseY, t, key) {
  ctx.save();
  ctx.translate(x, baseY);
  const H = 1.9, W = 0.58;
  // gold coffin body
  ctx.fillStyle = DESERT.gold;
  ctx.beginPath();
  ctx.moveTo(-W * 0.5, 0);
  ctx.lineTo(-W * 0.62, -H * 0.5);
  ctx.quadraticCurveTo(-W * 0.72, -H * 0.78, -W * 0.36, -H * 0.86);
  ctx.quadraticCurveTo(0, -H * 0.97, W * 0.36, -H * 0.86);
  ctx.quadraticCurveTo(W * 0.72, -H * 0.78, W * 0.62, -H * 0.5);
  ctx.lineTo(W * 0.5, 0);
  ctx.closePath(); ctx.fill();
  // shadowed right half for volume
  ctx.fillStyle = 'rgba(120,90,20,0.2)';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, -H * 0.86); ctx.lineTo(W * 0.36, -H * 0.86);
  ctx.quadraticCurveTo(W * 0.72, -H * 0.78, W * 0.62, -H * 0.5); ctx.lineTo(W * 0.5, 0);
  ctx.closePath(); ctx.fill();
  // nemes headdress
  const fy = -H * 0.86;
  ctx.fillStyle = DESERT.gold;
  ctx.beginPath();
  ctx.moveTo(-W * 0.42, fy + 0.06);
  ctx.quadraticCurveTo(0, -H * 0.99, W * 0.42, fy + 0.06);
  ctx.lineTo(W * 0.42, fy + 0.4); ctx.lineTo(-W * 0.42, fy + 0.4);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = DESERT.nemesBlue; ctx.lineWidth = 0.035;
  for (let i = 0; i < 4; i++) {
    const yy = fy + 0.12 + i * 0.09;
    ctx.beginPath(); ctx.moveTo(-W * 0.4, yy); ctx.lineTo(W * 0.4, yy); ctx.stroke();
  }
  // golden face
  ctx.fillStyle = DESERT.goldHi;
  ctx.beginPath(); ctx.ellipse(0, fy + 0.3, W * 0.24, 0.25, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = DESERT.kohl;
  ctx.fillRect(-0.12, fy + 0.26, 0.08, 0.035); ctx.fillRect(0.04, fy + 0.26, 0.08, 0.035);
  // broad collar + false beard
  ctx.fillStyle = DESERT.nemesBlue;
  ctx.beginPath(); ctx.ellipse(0, fy + 0.5, W * 0.3, 0.1, 0, 0, Math.PI); ctx.fill();
  ctx.fillStyle = DESERT.gold;
  ctx.fillRect(-0.04, fy + 0.46, 0.08, 0.22);
  // crook & flail crossed on the chest
  ctx.strokeStyle = DESERT.goldSh; ctx.lineWidth = 0.05; ctx.lineCap = 'round';
  const chY = -H * 0.52;
  ctx.beginPath();
  ctx.moveTo(-0.15, chY - 0.16); ctx.lineTo(0.15, chY + 0.16);
  ctx.moveTo(0.15, chY - 0.16); ctx.lineTo(-0.15, chY + 0.16);
  ctx.stroke();
  // central glyph band down the lower body
  ctx.fillStyle = 'rgba(60,44,20,0.45)';
  ctx.fillRect(-0.1, -H * 0.4, 0.2, H * 0.32);
  ctx.strokeStyle = 'rgba(255,240,200,0.4)'; ctx.lineWidth = 0.02;
  for (let i = 0; i < 5; i++) {
    const yy = -H * 0.38 + i * 0.12;
    ctx.beginPath(); ctx.moveTo(-0.07, yy); ctx.lineTo(0.07, yy); ctx.stroke();
  }
  ctx.restore();
}

// a wrapped mummy that shambles forward, arms outstretched, a loose bandage
// trailing — slow lean + bob driven by t
function drawMummy(ctx, x, baseY, t, key) {
  const sway = 0.07 * Math.sin(t * 1.6 + key);
  const bob = 0.035 * Math.abs(Math.sin(t * 1.6 + key));
  const face = srand(key + 2) < 0.5 ? -1 : 1;
  ctx.save();
  ctx.translate(x, baseY);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';                 // ground shadow (stays put)
  ctx.beginPath(); ctx.ellipse(0, 0.02, 0.28, 0.05, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(sway);                                   // lean as it shuffles
  ctx.translate(0, -bob);
  const wrap = DESERT.wrapLt, line = DESERT.wrapLine;
  // bound lower body and tapering torso
  ctx.fillStyle = wrap;
  roundRectPath(ctx, -0.16, -0.86, 0.32, 0.86, 0.1); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.2, -0.8); ctx.lineTo(-0.22, -1.3);
  ctx.quadraticCurveTo(-0.22, -1.46, -0.1, -1.49);
  ctx.lineTo(0.1, -1.49);
  ctx.quadraticCurveTo(0.22, -1.46, 0.22, -1.3);
  ctx.lineTo(0.2, -0.8); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -1.59, 0.16, 0, Math.PI * 2); ctx.fill(); // head
  // shadow side
  ctx.fillStyle = 'rgba(120,108,80,0.16)';
  ctx.fillRect(0.02, -1.49, 0.2, 1.46);
  // diagonal bandage wraps
  ctx.strokeStyle = line; ctx.lineWidth = 0.03;
  for (let i = 0; i < 9; i++) {
    const yy = -0.05 - i * 0.18;
    ctx.beginPath(); ctx.moveTo(-0.22, yy); ctx.lineTo(0.22, yy + 0.1); ctx.stroke();
  }
  // dark eye sockets
  ctx.fillStyle = 'rgba(20,16,10,0.7)';
  ctx.fillRect(-0.09, -1.62, 0.06, 0.04); ctx.fillRect(0.03, -1.62, 0.06, 0.04);
  // arms outstretched to the facing side, bobbing
  const af = 0.05 * Math.sin(t * 1.6 + key + 1);
  ctx.save();
  ctx.scale(face, 1);
  ctx.strokeStyle = wrap; ctx.lineWidth = 0.13; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0.08, -1.3); ctx.lineTo(0.52, -1.14 + af); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0.08, -1.22); ctx.lineTo(0.5, -1.04 - af); ctx.stroke();
  ctx.strokeStyle = line; ctx.lineWidth = 0.025;
  ctx.beginPath(); ctx.moveTo(0.3, -1.22); ctx.lineTo(0.34, -1.1); ctx.stroke();
  ctx.restore();
  // a loose bandage end fluttering off the hip
  ctx.strokeStyle = DESERT.wrapSh; ctx.lineWidth = 0.04;
  ctx.beginPath();
  ctx.moveTo(-0.2, -0.5);
  ctx.quadraticCurveTo(-0.42, -0.28 + 0.1 * Math.sin(t * 2 + key), -0.32, 0);
  ctx.stroke();
  ctx.restore();
}

// a small canopic jar: a pale stone body with a striped pharaoh-head lid
function drawCanopicJar(ctx, cx, cy, key) {
  ctx.fillStyle = '#dcc79a';
  roundRectPath(ctx, cx - 0.17, cy - 0.4, 0.34, 0.4, 0.08); ctx.fill();
  ctx.strokeStyle = 'rgba(90,68,38,0.4)'; ctx.lineWidth = 0.02;
  ctx.beginPath(); ctx.moveTo(cx - 0.13, cy - 0.18); ctx.lineTo(cx + 0.13, cy - 0.18); ctx.stroke();
  // head lid
  ctx.fillStyle = DESERT.gold;
  ctx.beginPath(); ctx.arc(cx, cy - 0.46, 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = DESERT.nemesBlue; ctx.lineWidth = 0.025;
  ctx.beginPath(); ctx.moveTo(cx - 0.13, cy - 0.5); ctx.lineTo(cx + 0.13, cy - 0.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 0.13, cy - 0.44); ctx.lineTo(cx + 0.13, cy - 0.44); ctx.stroke();
}

// a two-handled terracotta amphora
function drawAmphora(ctx, cx, cy, key) {
  ctx.fillStyle = '#b5703e';
  ctx.beginPath();
  ctx.moveTo(cx - 0.02, cy);
  ctx.ellipse(cx, cy - 0.42, 0.22, 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9c5e32';
  ctx.fillRect(cx - 0.06, cy - 0.92, 0.12, 0.22);     // neck
  ctx.strokeStyle = '#7d4a28'; ctx.lineWidth = 0.04; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - 0.18, cy - 0.62); ctx.quadraticCurveTo(cx - 0.3, cy - 0.78, cx - 0.06, cy - 0.84); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 0.18, cy - 0.62); ctx.quadraticCurveTo(cx + 0.3, cy - 0.78, cx + 0.06, cy - 0.84); ctx.stroke();
}

// a foreground pile of tomb treasure: gold coins, an amphora and canopic jars
function drawTombHoard(ctx, x, baseY, t, key) {
  ctx.save();
  ctx.translate(x, baseY);
  drawAmphora(ctx, 0.5, 0, key);
  drawCanopicJar(ctx, -0.72, 0, key);
  drawCanopicJar(ctx, -0.98, 0, key + 3);
  // spilled gold coins with little glints
  ctx.fillStyle = DESERT.goldSh;
  ctx.beginPath(); ctx.ellipse(-0.05, -0.08, 0.55, 0.14, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 7; i++) {
    const cx = -0.42 + srand(key + i) * 0.78, cyc = -0.06 - srand(key + i * 2) * 0.12;
    ctx.fillStyle = DESERT.goldHi;
    ctx.beginPath(); ctx.arc(cx, cyc, 0.07, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = DESERT.goldSh; ctx.lineWidth = 0.015; ctx.stroke();
  }
  const tw = 0.5 + 0.5 * Math.sin(t * 3 + key);
  ctx.fillStyle = 'rgba(255,252,230,' + (0.7 * tw).toFixed(3) + ')';
  ctx.beginPath(); ctx.arc(0.1, -0.16, 0.03, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// the whole Egyptian-desert scene, painted over the hazy sky gradient
function drawDesertBack(ctx, view, t, actor, gdy) {
  gdy = gdy || 0;
  const sandY = DESERT_FLOOR + gdy;
  drawDesertSun(ctx, view, t, gdy);
  // soft far dunes rolling along the horizon
  hillLayer(ctx, view, 0.08, 10.7 + gdy, 1.7, 0.45, 'rgba(216,193,143,0.55)');
  hillLayer(ctx, view, 0.13, 11.0 + gdy, 1.2, 0.72, 'rgba(199,171,118,0.7)');
  // pyramid clusters on the horizon
  gymRow(ctx, view, 0.18, 24, (x, key) => drawPyramidGroup(ctx, x, sandY, t, key));
  // mid rank: a sphinx, palms, obelisks and stelae
  gymRow(ctx, view, 0.32, 9.5, (x, key) => {
    const r = srand(key * 0.05 + 3.2);
    if (r < 0.22) drawSphinx(ctx, x, sandY, t, key);
    else if (r < 0.5) drawPalm(ctx, x, sandY, t, key);
    else if (r < 0.75) drawObelisk(ctx, x, sandY, t, key);
    else drawStela(ctx, x, sandY, t, key);
  });
  // near rank: standing sarcophagi, shambling mummies and tomb treasure
  gymRow(ctx, view, 0.48, 6.8, (x, key) => {
    const r = srand(key * 0.09 + 1.7);
    if (r < 0.38) drawMummy(ctx, x, sandY + 0.2, t, key);
    else if (r < 0.7) drawSarcophagus(ctx, x, sandY + 0.2, t, key);
    else drawTombHoard(ctx, x, sandY + 0.2, t, key);
  });
}

// the crest of the sand where it meets open air: a lit lip, a soft shadow
// just under it, and a few wind-blown sand wisps — the desert's grass/lava
function drawDesertEdge(ctx, s, theme, t) {
  t = t || 0;
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return;
  const ux = dx / len, uy = dy / len;
  let nx = uy, ny = -ux;            // normal pointing up into the playable area
  if (ny > 0) { nx = -nx; ny = -ny; }
  // soft shadow band just under the crest
  ctx.fillStyle = 'rgba(120,92,52,0.4)';
  ctx.beginPath();
  ctx.moveTo(s.ax + nx * 0.02, s.ay + ny * 0.02);
  ctx.lineTo(s.bx + nx * 0.02, s.by + ny * 0.02);
  ctx.lineTo(s.bx - nx * 0.13, s.by - ny * 0.13);
  ctx.lineTo(s.ax - nx * 0.13, s.ay - ny * 0.13);
  ctx.closePath(); ctx.fill();
  // bright sunlit crest lip
  ctx.strokeStyle = 'rgba(247,236,205,0.85)'; ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(s.ax + nx * 0.04, s.ay + ny * 0.04);
  ctx.lineTo(s.bx + nx * 0.04, s.by + ny * 0.04);
  ctx.stroke();
  // wind-blown sand wisps drifting off the crest, with gaps
  ctx.strokeStyle = 'rgba(230,212,170,0.45)'; ctx.lineWidth = 0.025; ctx.lineCap = 'round';
  const n = Math.max(1, Math.floor(len / 0.9));
  for (let i = 0; i <= n; i++) {
    const r1 = srand(s.ax * 4.7 + s.ay * 2.3 + i * 6.1);
    if (r1 < 0.5) continue;
    const f = i / n;
    const bx = s.ax + dx * f, by = s.ay + dy * f;
    const drift = (0.18 + r1 * 0.22) * (0.7 + 0.4 * Math.sin(t * 2.5 + r1 * 17));
    ctx.beginPath();
    ctx.moveTo(bx + nx * 0.05, by + ny * 0.05);
    ctx.quadraticCurveTo(bx + ux * drift + nx * 0.14, by + uy * drift + ny * 0.14,
      bx + ux * drift * 2 + nx * 0.1, by + uy * drift * 2 + ny * 0.1);
    ctx.stroke();
  }
}

// ---------- space world (Rainbow Road in the cosmos) ----------
//
// The track surface is a Rainbow-Road rainbow band with a glowing star railing
// (drawSpaceEdge, drawn along the level's surface segments). drawSpaceBack
// fills the open void behind the track with twinkling starfields, slowly
// turning spiral galaxies, ringed planets, soft nebulae and asteroids that fly
// through. Stars sit at fixed world positions (slow parallax) while asteroids
// and shooting stars are screen-relative, so they sweep past whatever the
// camera is doing.
const SPACE = {
  rail: ['#ff3b6b', '#ff9b2f', '#ffe23b', '#46e06a', '#3bc6ff', '#7a6bff', '#e06bff'],
  rock: '#6b6470', rockHi: '#a39cae', rockSh: '#3e3946',
  nebula: ['120,70,210', '40,110,210', '210,60,150', '40,170,170'],
};

// a filled 5-point star centred at (cx, cy), outer radius r, spun by rot
function drawStar(ctx, cx, cy, r, rot, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = rot + i * (2 * Math.PI / 5) - Math.PI / 2;
    const x1 = cx + Math.cos(a) * r, y1 = cy + Math.sin(a) * r;
    if (i) ctx.lineTo(x1, y1); else ctx.moveTo(x1, y1);
    const a2 = a + Math.PI / 5;
    ctx.lineTo(cx + Math.cos(a2) * r * 0.42, cy + Math.sin(a2) * r * 0.42);
  }
  ctx.closePath(); ctx.fill();
}

// a soft radial nebula cloud (rgb is an "r,g,b" string)
function drawNebula(ctx, cx, cy, R, rgb, a) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
  g.addColorStop(0.55, 'rgba(' + rgb + ',' + (a * 0.4).toFixed(3) + ')');
  g.addColorStop(1, 'rgba(' + rgb + ',0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
}

// a field of twinkling stars on a jittered lattice across the view. p is the
// horizontal parallax; cell the lattice spacing; skip the fraction of empty
// cells; maxR the largest star radius; warm tints the brightest ones gold.
function drawSpaceStarfield(ctx, view, t, p, cell, skip, maxR, warm) {
  const u = (view.x0 + view.x1) / 2 * (1 - p);
  const gx0 = Math.floor((view.x0 - u) / cell) - 1, gx1 = Math.ceil((view.x1 - u) / cell) + 1;
  const gy0 = Math.floor(view.y0 / cell) - 1, gy1 = Math.ceil(view.y1 / cell) + 1;
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gy = gy0; gy <= gy1; gy++) {
      const r0 = srand(gx * 12.9 + gy * 78.2 + p * 31.7);
      if (r0 < skip) continue;
      const sx = (gx + srand(gx * 3.1 + gy * 1.7)) * cell + u;
      const sy = (gy + srand(gx * 7.3 + gy * 2.9)) * cell;
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (1.4 + r0 * 3) + r0 * 30));
      const rr = (0.04 + r0 * maxR) * tw;
      ctx.fillStyle = (warm && r0 > 0.72) ? 'rgba(255,233,168,' + tw.toFixed(2) + ')'
        : 'rgba(253,249,230,' + tw.toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// a tilted spiral galaxy: a bright core and two arms of fading dots, turning
// slowly with t
function drawGalaxy(ctx, cx, cy, R, t, key) {
  const rot = t * 0.04 + key * 1.3;
  drawNebula(ctx, cx, cy, R * 1.15, '170,150,255', 0.1);
  const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.36);
  cg.addColorStop(0, 'rgba(255,250,236,0.95)');
  cg.addColorStop(0.5, 'rgba(255,226,172,0.5)');
  cg.addColorStop(1, 'rgba(255,212,150,0)');
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.36, 0, Math.PI * 2); ctx.fill();
  const per = 44, cols = ['rgba(180,210,255,', 'rgba(255,182,230,', 'rgba(210,182,255,'];
  for (let a = 0; a < 2; a++) {
    for (let k = 4; k < per; k++) {
      const f = k / per, ang = rot + a * Math.PI + f * 4.2, rr = R * f;
      const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr * 0.45;
      ctx.fillStyle = cols[(a + k) % cols.length] + ((1 - f) * 0.6).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(px, py, 0.05 + (1 - f) * 0.07, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// a ringed gas-giant: back ring half, lit planet disc, front ring half
function drawRingedPlanet(ctx, cx, cy, R, key) {
  const tilt = -0.32;
  const hue = ['#5b8fd6', '#d68f5b', '#8f6fd0', '#5bc7b0'][Math.floor(srand(key * 1.7) * 4) % 4];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.strokeStyle = 'rgba(220,205,255,0.55)'; ctx.lineWidth = R * 0.13;
  ctx.beginPath(); ctx.ellipse(0, 0, R * 1.9, R * 0.6, 0, Math.PI, 2 * Math.PI); ctx.stroke();
  const g = ctx.createRadialGradient(-R * 0.35, -R * 0.35, R * 0.1, 0, 0, R);
  g.addColorStop(0, hue);
  g.addColorStop(1, 'rgba(10,8,26,0.95)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(220,205,255,0.75)'; ctx.lineWidth = R * 0.13;
  ctx.beginPath(); ctx.ellipse(0, 0, R * 1.9, R * 0.6, 0, 0, Math.PI); ctx.stroke();
  ctx.restore();
}

// a tumbling asteroid with a faint motion trail (dir = travel direction)
function drawAsteroid(ctx, cx, cy, sz, rot, key, dir) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = 'rgba(170,180,205,0.1)';
  ctx.beginPath(); ctx.ellipse(-dir * sz * 2.0, 0, sz * 2.0, sz * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(rot);
  ctx.fillStyle = SPACE.rock;
  ctx.beginPath();
  const m = 9;
  for (let i = 0; i < m; i++) {
    const a = i / m * Math.PI * 2, rr = sz * (0.68 + 0.34 * srand(key * 3.1 + i));
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = SPACE.rockHi; ctx.lineWidth = sz * 0.12; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, 0, sz * 0.72, Math.PI * 0.8, Math.PI * 1.5); ctx.stroke();
  ctx.fillStyle = SPACE.rockSh;
  for (let i = 0; i < 3; i++) {
    const a = srand(key + i) * 6.28, rr = srand(key * 2 + i) * sz * 0.5;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, sz * (0.1 + srand(key + i * 3) * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// a shooting-star streak from (x, y), fading by a (0..1)
function drawShootingStar(ctx, x, y, len, a) {
  if (a <= 0) return;
  const ang = Math.PI * 0.16;
  const tx = x - Math.cos(ang) * len, ty = y - Math.sin(ang) * len;
  const g = ctx.createLinearGradient(x, y, tx, ty);
  g.addColorStop(0, 'rgba(255,255,255,' + (0.9 * a).toFixed(3) + ')');
  g.addColorStop(1, 'rgba(180,210,255,0)');
  ctx.strokeStyle = g; ctx.lineWidth = 0.06; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * a).toFixed(3) + ')';
  ctx.beginPath(); ctx.arc(x, y, 0.07, 0, Math.PI * 2); ctx.fill();
}

// the whole cosmic scene behind the rainbow track
function drawSpaceBack(ctx, view, t) {
  const vw = view.x1 - view.x0, vh = view.y1 - view.y0;
  // far nebula clouds
  gymRow(ctx, view, 0.05, 18, (x, key) => {
    const r = srand(key * 0.07 + 2.1);
    const cy = view.y0 + (0.14 + srand(key * 0.3 + 0.5) * 0.5) * vh;
    drawNebula(ctx, x, cy, 5 + r * 3, SPACE.nebula[Math.floor(r * 4) % 4], 0.13);
  });
  // two twinkling star layers
  drawSpaceStarfield(ctx, view, t, 0.03, 1.7, 0.5, 0.1, false);
  drawSpaceStarfield(ctx, view, t, 0.08, 2.6, 0.62, 0.16, true);
  // spiral galaxies and the occasional ringed planet
  gymRow(ctx, view, 0.06, 22, (x, key) => {
    const r = srand(key * 0.05 + 5.3);
    const cy = view.y0 + (0.16 + srand(key * 0.6 + 0.2) * 0.4) * vh;
    if (r < 0.55) drawGalaxy(ctx, x, cy, 2.4 + r, t, key);
    else drawRingedPlanet(ctx, x, cy, 1.0 + r * 0.6, key);
  });
  // asteroids flying through (screen-relative, a fresh pass each cycle at a
  // new height/size/direction so they read as "occasional")
  for (let i = 0; i < 4; i++) {
    const speed = 0.07 + srand(i * 5 + 1) * 0.06;
    const cyc = t * speed + srand(i * 3 + 0.5);
    const pass = Math.floor(cyc), prog = cyc - pass;
    const span = vw + 12, dir = (pass + i) % 2 ? -1 : 1;
    const ax = dir > 0 ? view.x0 - 6 + prog * span : view.x1 + 6 - prog * span;
    const ay = view.y0 + (0.1 + srand(i * 7 + pass * 1.7) * 0.55) * vh;
    const sz = 0.28 + srand(i * 9 + pass) * 0.5;
    drawAsteroid(ctx, ax, ay, sz, t * (0.5 + srand(i * 2)), i * 3 + pass, dir);
  }
  // rare shooting stars (only briefly visible per cycle)
  for (let i = 0; i < 2; i++) {
    const cyc = t * (0.13 + srand(i * 11) * 0.1) + srand(i * 4);
    const prog = cyc - Math.floor(cyc);
    if (prog > 0.16) continue;
    const pass = Math.floor(cyc), f = prog / 0.16;
    const sx = view.x0 + (0.12 + f * 0.85) * vw;
    const sy = view.y0 + (0.08 + srand(i * 7 + pass) * 0.38) * vh + f * vh * 0.12;
    drawShootingStar(ctx, sx, sy, 1.5, Math.sin(f * Math.PI));
  }
}

// the Rainbow-Road track surface: a glowing rainbow band laid into the lip, a
// bright moving sheen, and a twinkling star railing posted along it — the
// space world's grass/lava
function drawSpaceEdge(ctx, s, theme, t) {
  t = t || 0;
  const dx = s.bx - s.ax, dy = s.by - s.ay, len = Math.hypot(dx, dy);
  if (len < 1e-4) return;
  const ux = dx / len, uy = dy / len;
  let nx = uy, ny = -ux;            // normal pointing up into the playable area
  if (ny > 0) { nx = -nx; ny = -ny; }
  const cols = SPACE.rail, top = 0.05, band = 0.4, strip = band / cols.length;
  // soft underglow below the band
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(s.ax - nx * 0.12, s.ay - ny * 0.12);
  ctx.lineTo(s.bx - nx * 0.12, s.by - ny * 0.12);
  ctx.stroke();
  // rainbow strips stacked from just under the lip down into the track
  for (let i = 0; i < cols.length; i++) {
    const o0 = top - i * strip, o1 = top - (i + 1) * strip;
    ctx.fillStyle = cols[i];
    ctx.beginPath();
    ctx.moveTo(s.ax + nx * o0, s.ay + ny * o0);
    ctx.lineTo(s.bx + nx * o0, s.by + ny * o0);
    ctx.lineTo(s.bx + nx * o1, s.by + ny * o1);
    ctx.lineTo(s.ax + nx * o1, s.ay + ny * o1);
    ctx.closePath(); ctx.fill();
  }
  // bright lip line
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(s.ax + nx * top, s.ay + ny * top);
  ctx.lineTo(s.bx + nx * top, s.by + ny * top);
  ctx.stroke();
  // a sheen dash sliding along the lip
  const slide = ((t * 0.3) % 1) * len, gl = Math.min(0.8, len);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.06; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s.ax + ux * slide + nx * top, s.ay + uy * slide + ny * top);
  ctx.lineTo(s.ax + ux * Math.min(len, slide + gl) + nx * top,
    s.ay + uy * Math.min(len, slide + gl) + ny * top);
  ctx.stroke();
  // star railing: glowing twinkling stars posted along the lip
  const n = Math.max(1, Math.floor(len / 1.3));
  for (let i = 0; i <= n; i++) {
    const r1 = srand(s.ax * 5.3 + s.ay * 2.7 + i * 9.1);
    if (r1 < 0.35) continue;
    const f = i / n, bx = s.ax + dx * f, by = s.ay + dy * f;
    const px = bx + nx * 0.16, py = by + ny * 0.16;
    const tw = 0.5 + 0.5 * Math.sin(t * 4 + r1 * 25);
    ctx.fillStyle = 'rgba(255,240,180,' + (0.18 * tw).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(px, py, 0.16, 0, Math.PI * 2); ctx.fill();
    drawStar(ctx, px, py, 0.1 + 0.03 * tw, t * 0.6 + r1 * 6, '#fff3c0');
  }
}

// ---------- cave world (dark, lit only by the rider's lamps in play) ----------
//
// drawCaveBack paints the underground scene at full brightness (so the editor
// shows everything); in play, game.js lays drawCaveDarkness over the whole
// playfield, blacking it out except for feathered headlight/taillight cones
// around the rider. The formations are placed relative to the VIEW (ceiling
// along the top, floor along the bottom — see drawCaveBack) so the cave frames
// whatever's on screen, with glowing crystals and glowworms for cold light and
// bats flitting through the middle. Reuses gymRow/srand like the other worlds.
const CAVE = {
  rock: '#3b3127', rockLit: '#54473a', rockDk: '#241c15',
  crystal: ['150,90,230', '90,200,235', '90,235,160', '235,170,90', '230,90,170'],
};
// the cave's natural floor line (matches the theme's groundY); drawCaveBack
// shifts it by gdy so the floor formations land on the map's actual ground
// instead of floating. The ceiling stays view-relative so it frames the top.
const CAVE_GROUND = 11;

// faint layered rock strata across the far wall
function drawCaveStrata(ctx, view, ceilY, floorY) {
  const p = 0.05, u = (view.x0 + view.x1) / 2 * (1 - p);
  for (let i = 0; i < 8; i++) {
    ctx.strokeStyle = i % 2 ? 'rgba(70,58,46,0.22)' : 'rgba(0,0,0,0.22)';
    ctx.lineWidth = i % 2 ? 0.05 : 0.09;
    const y = ceilY + (floorY - ceilY) * (0.06 + i * 0.12);
    ctx.beginPath();
    for (let x = view.x0; x <= view.x1; x += 1.4) {
      const yy = y + 0.3 * Math.sin((x - u) * 0.22 + i * 1.3);
      if (x === view.x0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
}

// a stalactite hanging down from topY (a tapering, ringed spike with a wet tip
// and an occasional slow drip)
function drawStalactite(ctx, x, topY, len, w, key, t) {
  const tipY = topY + len;
  ctx.fillStyle = CAVE.rock;
  ctx.beginPath();
  ctx.moveTo(x - w, topY);
  ctx.quadraticCurveTo(x - w * 0.3, topY + len * 0.5, x, tipY);
  ctx.quadraticCurveTo(x + w * 0.3, topY + len * 0.5, x + w, topY);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(120,104,84,0.5)'; ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(x - w, topY); ctx.quadraticCurveTo(x - w * 0.3, topY + len * 0.5, x, tipY);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.03;
  for (let i = 1; i < 4; i++) {
    const f = i / 4, yy = topY + len * f, ww = w * (1 - f);
    ctx.beginPath(); ctx.moveTo(x - ww, yy); ctx.quadraticCurveTo(x, yy + 0.06, x + ww, yy); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(150,180,190,0.4)';
  ctx.beginPath(); ctx.arc(x, tipY - 0.04, 0.04, 0, Math.PI * 2); ctx.fill();
  const dr = (t * 0.4 + srand(key * 3.3)) % 3;            // a drip every ~ few sec
  if (dr < 0.6) {
    const dy = dr / 0.6;
    ctx.fillStyle = 'rgba(150,185,195,' + (0.5 * (1 - dy)).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(x, tipY + 0.1 + dy * 0.8, 0.045, 0, Math.PI * 2); ctx.fill();
  }
}

// a stalagmite rising from baseY (a stalactite flipped)
function drawStalagmite(ctx, x, baseY, h, w, key) {
  const tipY = baseY - h;
  ctx.fillStyle = CAVE.rock;
  ctx.beginPath();
  ctx.moveTo(x - w, baseY);
  ctx.quadraticCurveTo(x - w * 0.3, baseY - h * 0.5, x, tipY);
  ctx.quadraticCurveTo(x + w * 0.3, baseY - h * 0.5, x + w, baseY);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(120,104,84,0.5)'; ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(x - w, baseY); ctx.quadraticCurveTo(x - w * 0.3, baseY - h * 0.5, x, tipY);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.03;
  for (let i = 1; i < 4; i++) {
    const f = i / 4, yy = baseY - h * f, ww = w * (1 - f);
    ctx.beginPath(); ctx.moveTo(x - ww, yy); ctx.quadraticCurveTo(x, yy - 0.06, x + ww, yy); ctx.stroke();
  }
}

// a full column joining ceiling to floor (a slightly barrelled pillar)
function drawColumn(ctx, x, ceilY, baseY, key) {
  const w = 0.34 + srand(key) * 0.22, mid = (ceilY + baseY) / 2;
  ctx.fillStyle = CAVE.rock;
  ctx.beginPath();
  ctx.moveTo(x - w, ceilY);
  ctx.bezierCurveTo(x - w * 1.5, mid, x - w * 1.5, mid, x - w, baseY);
  ctx.lineTo(x + w, baseY);
  ctx.bezierCurveTo(x + w * 1.5, mid, x + w * 1.5, mid, x + w, ceilY);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(120,104,84,0.4)'; ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(x - w, ceilY); ctx.bezierCurveTo(x - w * 1.5, mid, x - w * 1.5, mid, x - w, baseY);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 0.03;
  for (let i = 1; i < 9; i++) {
    const yy = ceilY + (baseY - ceilY) * i / 9, ww = w * (1 + 0.5 * Math.sin(Math.PI * i / 9));
    ctx.beginPath(); ctx.moveTo(x - ww, yy); ctx.lineTo(x + ww, yy); ctx.stroke();
  }
}

// a glowing crystal cluster: an emissive halo and a few angular prisms
function drawCrystalCluster(ctx, x, y, key, t) {
  const rgb = CAVE.crystal[Math.floor(srand(key * 1.7) * CAVE.crystal.length) % CAVE.crystal.length];
  const tw = 0.6 + 0.4 * Math.sin(t * 2 + key * 3);
  const g = ctx.createRadialGradient(x, y - 0.4, 0, x, y - 0.4, 1.5);
  g.addColorStop(0, 'rgba(' + rgb + ',' + (0.22 * tw).toFixed(3) + ')');
  g.addColorStop(1, 'rgba(' + rgb + ',0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y - 0.4, 1.5, 0, Math.PI * 2); ctx.fill();
  const n = 3 + Math.floor(srand(key) * 3);
  for (let i = 0; i < n; i++) {
    const bx = x + (srand(key + i) - 0.5) * 0.9, by = y;
    const ln = 0.5 + srand(key + i * 2) * 0.8, lean = (srand(key + i * 3) - 0.5) * 0.4;
    const tx = bx + lean, ty = by - ln, ww = 0.07 + srand(key + i * 5) * 0.06;
    ctx.fillStyle = 'rgba(' + rgb + ',0.85)';
    ctx.beginPath();
    ctx.moveTo(bx - ww, by); ctx.lineTo(tx - ww * 0.4, ty + 0.05); ctx.lineTo(tx, ty);
    ctx.lineTo(tx + ww * 0.4, ty + 0.05); ctx.lineTo(bx + ww, by);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 * tw).toFixed(2) + ')'; ctx.lineWidth = 0.02;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
  }
}

// a patch of glowworms on the ceiling: tiny twinkling blue-green lights on
// fine threads
function drawGlowworms(ctx, x, ceilY, key, t) {
  const n = 10 + Math.floor(srand(key) * 8);
  for (let i = 0; i < n; i++) {
    const px = x + (srand(key + i * 1.3) - 0.5) * 2.2, py = ceilY + srand(key + i * 2.7) * 0.7;
    const tw = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * (2 + srand(key + i) * 3) + i * 2));
    ctx.strokeStyle = 'rgba(150,200,180,0.08)'; ctx.lineWidth = 0.012;
    ctx.beginPath(); ctx.moveTo(px, ceilY); ctx.lineTo(px, py); ctx.stroke();
    ctx.fillStyle = 'rgba(150,240,205,' + (0.15 * tw).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(px, py, 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(190,255,225,' + tw.toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(px, py, 0.03, 0, Math.PI * 2); ctx.fill();
  }
}

// a still underground pool with wobbling ripple sheens and a faint glow
function drawCavePool(ctx, x, baseY, w, t, key) {
  ctx.fillStyle = 'rgba(18,38,52,0.9)';
  ctx.beginPath(); ctx.ellipse(x, baseY, w / 2, 0.22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(60,90,100,0.5)'; ctx.lineWidth = 0.04;
  ctx.beginPath(); ctx.ellipse(x, baseY, w / 2, 0.22, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(130,190,210,0.3)'; ctx.lineWidth = 0.03;
  for (let i = 0; i < 2; i++) {
    const rw = w * 0.3 * (1 - i * 0.4), yy = baseY - 0.02 + 0.04 * Math.sin(t * 1.5 + i + key);
    ctx.beginPath(); ctx.ellipse(x, yy, rw, 0.06, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(80,170,190,0.12)';
  ctx.beginPath(); ctx.ellipse(x, baseY + 0.05, w * 0.28, 0.1, 0, 0, Math.PI * 2); ctx.fill();
}

// a flitting bat silhouette, wings flapping
function drawBat(ctx, x, y, t, key) {
  const flap = Math.sin(t * 12 + key * 2);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(12,8,12,0.9)';
  ctx.beginPath(); ctx.ellipse(0, 0, 0.06, 0.1, 0, 0, Math.PI * 2); ctx.fill();
  for (const sg of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(0, -0.02);
    ctx.lineTo(sg * 0.32, -0.06 - flap * 0.12);
    ctx.lineTo(sg * 0.28, 0.02 - flap * 0.06);
    ctx.lineTo(sg * 0.14, 0.04);
    ctx.closePath(); ctx.fill();
  }
  ctx.beginPath(); ctx.moveTo(-0.03, -0.09); ctx.lineTo(-0.05, -0.16); ctx.lineTo(0, -0.1); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0.03, -0.09); ctx.lineTo(0.05, -0.16); ctx.lineTo(0, -0.1); ctx.fill();
  ctx.restore();
}

// a few bats flitting through the open cave, between the ceiling and floor
// formations (time-driven, screen-relative, with a bob)
function drawCaveBats(ctx, view, t, top, bot) {
  const vw = view.x1 - view.x0;
  for (let i = 0; i < 4; i++) {
    const speed = 0.05 + srand(i * 5 + 1) * 0.05;
    const cyc = t * speed + srand(i * 3 + 0.2), pass = Math.floor(cyc), prog = cyc - pass;
    const dir = (pass + i) % 2 ? -1 : 1, span = vw + 6;
    const bx = dir > 0 ? view.x0 - 3 + prog * span : view.x1 + 3 - prog * span;
    const by = top + (0.1 + srand(i * 7 + pass) * 0.8) * (bot - top) + Math.sin(t * 3 + i) * 0.4;
    drawBat(ctx, bx, by, t, i * 2 + pass);
  }
}

// glinting mineral veins meandering across the far wall, with twinkling specks
function drawMineralVeins(ctx, view, t, ceilY, span) {
  const p = 0.06, u = (view.x0 + view.x1) / 2 * (1 - p);
  const sp = 7, first = Math.floor((view.x0 - u - sp) / sp) * sp;
  for (let s = first; s <= view.x1 - u + sp; s += sp) {
    const x = s + u, r = srand(s * 0.7 + 1.3);
    const rgb = CAVE.crystal[Math.floor(r * CAVE.crystal.length) % CAVE.crystal.length];
    const y0 = ceilY + span * (0.12 + r * 0.35), len = span * (0.22 + r * 0.2);
    ctx.strokeStyle = 'rgba(' + rgb + ',0.16)'; ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    for (let i = 1; i <= 6; i++) ctx.lineTo(x + Math.sin(i * 1.3 + s) * 0.8, y0 + len * i / 6);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const f = srand(s + i * 3.1), gx = x + Math.sin(f * 8 + s) * 0.8, gy = y0 + len * f;
      const tw = 0.4 + 0.6 * Math.sin(t * 3 + f * 20 + s);
      ctx.fillStyle = 'rgba(' + rgb + ',' + (0.5 * tw).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(gx, gy, 0.05, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// flowstone draperies: a wavy mineral curtain in horizontal bands hanging from
// topY, its thin lower edge backlit amber
function drawDraperies(ctx, x, topY, len, key, t) {
  const w = 0.7 + srand(key) * 0.5, seg = 7, bottomY = topY + len;
  const bands = ['#5a4630', '#6e5638', '#826647', '#4d3b28'];
  const top = [], bot = [];
  for (let i = 0; i <= seg; i++) {
    const f = i / seg, bx = x - w + 2 * w * f;
    top.push([bx, topY + 0.1 * Math.sin(f * 5 + key)]);
    bot.push([bx, bottomY + 0.25 * Math.sin(f * 6 + key * 2) - 0.1]);
  }
  const nb = 5;
  for (let b = 0; b < nb; b++) {
    ctx.fillStyle = bands[b % bands.length];
    const f0 = b / nb, f1 = (b + 1) / nb;
    ctx.beginPath();
    for (let i = 0; i <= seg; i++) {
      const y = top[i][1] + (bot[i][1] - top[i][1]) * f0;
      if (i) ctx.lineTo(top[i][0], y); else ctx.moveTo(top[i][0], y);
    }
    for (let i = seg; i >= 0; i--) ctx.lineTo(top[i][0], top[i][1] + (bot[i][1] - top[i][1]) * f1);
    ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(230,180,110,0.3)'; ctx.lineWidth = 0.05;
  ctx.beginPath();
  for (let i = 0; i <= seg; i++) { if (i) ctx.lineTo(bot[i][0], bot[i][1]); else ctx.moveTo(bot[i][0], bot[i][1]); }
  ctx.stroke();
}

// a geode: a lumpy rock shell cracked open to a glowing, crystal-lined hollow
function drawGeode(ctx, x, y, r, key, t) {
  const rgb = CAVE.crystal[Math.floor(srand(key * 2.3) * CAVE.crystal.length) % CAVE.crystal.length];
  const tw = 0.6 + 0.4 * Math.sin(t * 2 + key * 2);
  ctx.fillStyle = '#362c22';
  ctx.beginPath();
  const m = 10;
  for (let i = 0; i < m; i++) {
    const a = i / m * Math.PI * 2, rr = r * (0.9 + 0.18 * srand(key + i));
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#241c14'; ctx.lineWidth = 0.05; ctx.stroke();
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 0.8);
  g.addColorStop(0, 'rgba(' + rgb + ',' + (0.5 * tw).toFixed(2) + ')');
  g.addColorStop(1, 'rgba(' + rgb + ',0.05)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, Math.PI * 2); ctx.fill();
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, pa = a + Math.PI / 2, ww = r * 0.08;
    const ox = x + Math.cos(a) * r * 0.6, oy = y + Math.sin(a) * r * 0.6;
    const ix = x + Math.cos(a) * r * 0.32, iy = y + Math.sin(a) * r * 0.32;
    ctx.fillStyle = 'rgba(' + rgb + ',0.8)';
    ctx.beginPath();
    ctx.moveTo(ox + Math.cos(pa) * ww, oy + Math.sin(pa) * ww);
    ctx.lineTo(ix, iy);
    ctx.lineTo(ox - Math.cos(pa) * ww, oy - Math.sin(pa) * ww);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,' + (0.6 * tw).toFixed(2) + ')';
  ctx.beginPath(); ctx.arc(x, y, r * 0.08, 0, Math.PI * 2); ctx.fill();
}

// the whole underground scene (full brightness; the darkness overlay is a
// separate pass applied only in play). Everything is anchored to the VIEW so
// the cave frames the visible area — ceiling formations along the top, floor
// formations along the bottom, bats between — wherever the map sits in world
// space and wherever the camera is (fixed world-Y would leave the ceiling in
// mid-air and bury the floor, since a level's open span is tall, ~y -8..11).
function drawCaveBack(ctx, view, t, actor, gdy) {
  gdy = gdy || 0;
  const vh = view.y1 - view.y0;
  const floorY = CAVE_GROUND + gdy;      // floor formations sit on the map's ground
  // ceiling frames the top of the visible area, but never closer than a small
  // gap to the floor (keeps the cave from collapsing in a short view)
  const ceilY = Math.min(view.y0 + vh * 0.03, floorY - 2.5);
  const span = floorY - ceilY;
  drawCaveStrata(ctx, view, ceilY, floorY);
  drawMineralVeins(ctx, view, t, ceilY, span);
  // geodes embedded in the wall (upper-mid)
  gymRow(ctx, view, 0.1, 13, (x, key) => {
    if (srand(key * 0.08 + 0.3) < 0.45)
      drawGeode(ctx, x, ceilY + span * (0.2 + srand(key) * 0.5), 0.7 + srand(key * 2) * 0.5, key, t);
  });
  gymRow(ctx, view, 0.1, 9, (x, key) => drawGlowworms(ctx, x, ceilY + 0.1, key, t));
  hillLayer(ctx, view, 0.12, floorY + 0.3, 1.0, 0.6, 'rgba(30,24,20,0.6)');
  gymRow(ctx, view, 0.16, 4.5, (x, key) =>
    drawStalactite(ctx, x, ceilY, span * (0.18 + srand(key) * 0.22), 0.3 + srand(key * 2) * 0.2, key, t));
  // flowstone draperies hanging from the upper wall
  gymRow(ctx, view, 0.22, 9.5, (x, key) => {
    if (srand(key * 0.07 + 0.6) < 0.5) drawDraperies(ctx, x, ceilY + 0.05, span * (0.22 + srand(key) * 0.18), key, t);
  });
  gymRow(ctx, view, 0.28, 6.0, (x, key) =>
    drawStalactite(ctx, x, ceilY + span * 0.04, span * (0.24 + srand(key + 1) * 0.28), 0.4 + srand(key * 3) * 0.25, key + 7, t));
  gymRow(ctx, view, 0.32, 8.5, (x, key) => {
    if (srand(key * 0.07 + 1.1) < 0.6) drawCrystalCluster(ctx, x, floorY - 0.1, key, t);
  });
  gymRow(ctx, view, 0.42, 5.5, (x, key) => {
    const r = srand(key * 0.05 + 2.3);
    if (r < 0.4) drawStalagmite(ctx, x, floorY + 0.15, span * (0.16 + srand(key) * 0.22), 0.35 + srand(key * 2) * 0.3, key);
    else if (r < 0.58) drawCavePool(ctx, x, floorY + 0.15, 1.6 + srand(key) * 1.2, t, key);
    else if (r < 0.72) drawColumn(ctx, x, ceilY, floorY + 0.15, key);
    else if (r < 0.86) drawGeode(ctx, x, floorY - 0.35, 0.55 + srand(key) * 0.4, key + 9, t);
    else drawCrystalCluster(ctx, x, floorY + 0.1, key + 3, t);
  });
  drawCaveBats(ctx, view, t, ceilY + 0.2, floorY - 0.3);
}

// the cave floor rim: a dark damp lip with a cool sheen and the odd glinting
// mineral speck — the cave world's grass/lava
function drawCaveEdge(ctx, s, theme, t) {
  const dx = s.bx - s.ax, dy = s.by - s.ay, len = Math.hypot(dx, dy);
  if (len < 1e-4) return;
  const ux = dx / len, uy = dy / len;
  let nx = uy, ny = -ux;            // normal pointing up into the playable area
  if (ny > 0) { nx = -nx; ny = -ny; }
  ctx.fillStyle = '#221b14';
  ctx.beginPath();
  ctx.moveTo(s.ax - nx * 0.015, s.ay - ny * 0.015);
  ctx.lineTo(s.bx - nx * 0.015, s.by - ny * 0.015);
  ctx.lineTo(s.bx + nx * 0.12, s.by + ny * 0.12);
  ctx.lineTo(s.ax + nx * 0.12, s.ay + ny * 0.12);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(120,150,160,0.22)'; ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.moveTo(s.ax + nx * 0.04, s.ay + ny * 0.04);
  ctx.lineTo(s.bx + nx * 0.04, s.by + ny * 0.04);
  ctx.stroke();
  const n = Math.max(1, Math.floor(len / 1.1));
  for (let i = 0; i <= n; i++) {
    const r1 = srand(s.ax * 4.1 + s.ay * 3.7 + i * 8.3);
    if (r1 < 0.7) continue;
    const f = i / n, bx = s.ax + dx * f, by = s.ay + dy * f;
    ctx.fillStyle = 'rgba(160,210,220,' + (0.3 + 0.3 * Math.sin(t * 3 + r1 * 20)).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(bx + nx * 0.06, by + ny * 0.06, 0.03, 0, Math.PI * 2); ctx.fill();
  }
}

// One elliptical, feathered glow centred ahead of (sx, sy) along screen angle
// `ang`, length L, perpendicular squash, the gradient offset `fwd` forward.
// Used both to carve light out of the dark fog (black stops, destination-out)
// and to wash warm/red light over the scene (colour stops, 'lighter').
function caveGlow(c, sx, sy, ang, L, squash, fwd, c0, c1, c2) {
  c.save();
  c.translate(sx, sy);
  c.rotate(ang);
  c.scale(1, squash);
  const g = c.createRadialGradient(fwd, 0, 0, fwd, 0, L);
  // bright core out to 0.4, then a long gradual feather to nothing at the edge
  g.addColorStop(0, c0); g.addColorStop(0.4, c1); g.addColorStop(1, c2);
  c.fillStyle = g;
  c.beginPath(); c.arc(fwd, 0, L, 0, Math.PI * 2); c.fill();
  c.restore();
}

// the cave darkness pass: a near-black fog over the whole playfield with the
// rider's headlight (long, forward) and taillight (short, behind) cones carved
// out and tinted. Drawn in SCREEN space over the world, before the HUD. p =
// { x, y, dir, ang, Z, t } — rider screen pos, facing(±1), body angle, world
// scale, time. An offscreen fog canvas lets destination-out punch feathered
// holes without erasing the real scene.
let _caveFog = null, _caveFogCtx = null;
function drawCaveDarkness(ctx, W, H, p) {
  if (!_caveFog) { _caveFog = document.createElement('canvas'); _caveFogCtx = _caveFog.getContext('2d'); }
  if (_caveFog.width !== W || _caveFog.height !== H) { _caveFog.width = W; _caveFog.height = H; }
  const Z = p.Z, dn = 0.12;                 // a touch of downward aim at the road
  const fwdAng = (p.dir > 0 ? 0 : Math.PI) + dn;
  const backAng = (p.dir > 0 ? Math.PI : 0) + dn;
  const f = _caveFogCtx;
  f.setTransform(1, 0, 0, 1, 0, 0);
  f.clearRect(0, 0, W, H);
  f.fillStyle = 'rgba(4,5,12,0.93)';
  f.fillRect(0, 0, W, H);
  // carve the lit cones (and an ambient pool on the rider) out of the fog
  f.globalCompositeOperation = 'destination-out';
  const blk0 = 'rgba(0,0,0,1)', blk1 = 'rgba(0,0,0,0.82)', blk2 = 'rgba(0,0,0,0)';
  // longer reach so the cones feather out gradually over a greater distance
  caveGlow(f, p.x, p.y, fwdAng, Z * 9.0, 0.5, Z * 3.2, blk0, blk1, blk2);   // headlight
  caveGlow(f, p.x, p.y, backAng, Z * 5.6, 0.55, Z * 1.7, blk0, blk1, blk2); // taillight
  caveGlow(f, p.x, p.y, 0, Z * 1.9, 1, 0, blk0, 'rgba(0,0,0,0.7)', blk2);   // ambient pool
  f.globalCompositeOperation = 'source-over';
  ctx.drawImage(_caveFog, 0, 0);
  // warm headlight + red taillight colour washes over the revealed scene
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  caveGlow(ctx, p.x, p.y, fwdAng, Z * 8.4, 0.5, Z * 3.0,
    'rgba(255,240,200,0.18)', 'rgba(255,238,196,0.07)', 'rgba(255,238,196,0)');
  caveGlow(ctx, p.x, p.y, backAng, Z * 5.0, 0.55, Z * 1.6,
    'rgba(255,80,66,0.20)', 'rgba(255,70,60,0.08)', 'rgba(255,70,60,0)');
  ctx.restore();
}

// Paints a rect of ground: the repeating terrain tile, then a soft-light
// mottle pass that breaks up its grid (see makeMottle / makePatterns). Shared
// by the in-level terrain and the menu/victory floor so they match.
function fillGround(ctx, pat, x, y, w, h) {
  ctx.fillStyle = pat.ground;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = pat.mottle;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// `actor` (optional) is the live bike; the gym world reflects it in its wall
// mirrors. Other worlds ignore it, and the editor/menus pass nothing.
// `bg` (default true) paints the theme's backdrop — sky gradient, distant
// scenery/mirrors, drifting haze — inside the play area. The Map Editor can
// pass false to blacken it: the themed backdrop is distracting while laying
// out geometry, so this leaves only the terrain fill, outlines and edges.
function drawWorld(ctx, level, pat, view, t, actor, bg) {
  t = t || 0;
  if (bg === undefined) bg = true;
  const vw = view.x1 - view.x0, vh = view.y1 - view.y0;
  fillGround(ctx, pat, view.x0, view.y0, vw, vh);

  // a map may pin its theme's backdrop ground line (hills/dunes/floor) to a
  // chosen world height via level.groundY; the shift is how far that is from
  // the theme's natural ground (pat.groundY). The editor's fresh maps set
  // groundY:0 so the backdrop lands on the y=0 floor and the box corner can be
  // (0,0). Absent on every shipped level and the menu (which never sets it, and
  // for space, which has no ground line) -> 0 -> the backdrop draws untouched.
  const gdy = (level.groundY != null && pat.groundY != null)
    ? level.groundY - pat.groundY : 0;

  // the playable inside: gradient sky, distant silhouettes behind the
  // terrain, then a slowly drifting haze/cloud layer over both
  ctx.save();
  ctx.beginPath();
  for (const poly of level.polygons) {
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
  }
  ctx.clip('evenodd');
  if (bg) {
    ctx.fillStyle = skyGradient(ctx, pat, -8 + gdy, 12 + gdy);
    ctx.fillRect(view.x0, view.y0, vw, vh);
    pat.background(ctx, view, t, actor, gdy);
    if (pat.haze !== false) {     // indoor worlds (gym) skip the drifting haze
      const sp = pat.skyPeriod;   // haze tile repeats every skyPeriod world units
      const drift = (t * 0.4) % sp;
      ctx.translate(-drift, 0);
      ctx.fillStyle = pat.sky;
      ctx.fillRect(view.x0, view.y0, vw + sp, vh);
    }
  } else {
    ctx.fillStyle = '#000';       // backdrop toggled off: a plain black play area
    ctx.fillRect(view.x0, view.y0, vw, vh);
  }
  ctx.restore();

  ctx.beginPath();
  for (const poly of level.polygons) {
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
  }
  ctx.strokeStyle = pat.outline;
  ctx.lineWidth = 0.07;
  ctx.stroke();

  for (const e of level.grass) pat.edge(ctx, e, pat, t);
  for (const e of level.glassTops || []) drawObsidianEdge(ctx, e, t);
}

// obsidian glass: where the volcano world grows molten crust, a frozen
// flow gets a deep glassy band, a cold specular seam along the surface,
// and slow glints sliding over it — the visual promise of zero grip
function drawObsidianEdge(ctx, s, t) {
  t = t || 0;
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  let nx = uy, ny = -ux;            // normal pointing up into the playable area
  if (ny > 0) { nx = -nx; ny = -ny; }

  // deep glass body fading down into the rock
  const g = ctx.createLinearGradient(s.ax + nx * 0.05, s.ay + ny * 0.05,
    s.ax - nx * 1.1, s.ay - ny * 1.1);
  g.addColorStop(0, 'rgba(38,52,66,0.92)');
  g.addColorStop(0.45, 'rgba(22,30,40,0.78)');
  g.addColorStop(1, 'rgba(14,18,26,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(s.ax + nx * 0.06, s.ay + ny * 0.06);
  ctx.lineTo(s.bx + nx * 0.06, s.by + ny * 0.06);
  ctx.lineTo(s.bx - nx * 1.1, s.by - ny * 1.1);
  ctx.lineTo(s.ax - nx * 1.1, s.ay - ny * 1.1);
  ctx.closePath();
  ctx.fill();

  // cold mirror seam right at the surface
  ctx.strokeStyle = 'rgba(170,215,235,0.55)';
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  ctx.moveTo(s.ax + nx * 0.03, s.ay + ny * 0.03);
  ctx.lineTo(s.bx + nx * 0.03, s.by + ny * 0.03);
  ctx.stroke();

  // glints: short bright dashes drifting slowly along the seam
  ctx.strokeStyle = 'rgba(235,250,255,0.85)';
  ctx.lineWidth = 0.09;
  ctx.beginPath();
  const n = Math.max(1, Math.floor(len / 2.4));
  for (let i = 0; i < n; i++) {
    const r = srand(s.ax * 3.7 + s.ay * 9.1 + i * 5.3);
    const f = ((r + t * 0.06) % 1) * len;
    const gl = Math.min(0.5 + r * 0.5, len - f);
    if (gl <= 0) continue;
    ctx.moveTo(s.ax + ux * f + nx * 0.03, s.ay + uy * f + ny * 0.03);
    ctx.lineTo(s.ax + ux * (f + gl) + nx * 0.03, s.ay + uy * (f + gl) + ny * 0.03);
  }
  ctx.stroke();
}

function drawGrassEdge(ctx, s, theme, t) {
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  let nx = uy, ny = -ux;            // normal pointing up into the playable area
  if (ny > 0) { nx = -nx; ny = -ny; }

  ctx.fillStyle = theme.turfFill;
  ctx.beginPath();
  ctx.moveTo(s.ax - nx * 0.02, s.ay - ny * 0.02);
  ctx.lineTo(s.bx - nx * 0.02, s.by - ny * 0.02);
  ctx.lineTo(s.bx + nx * 0.16, s.by + ny * 0.16);
  ctx.lineTo(s.ax + nx * 0.16, s.ay + ny * 0.16);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = theme.turfBlade;
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  const n = Math.max(1, Math.floor(len / 0.22));
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const r1 = srand(s.ax * 7.13 + s.ay * 2.1 + i * 3.7);
    const r2 = srand(s.ay * 5.7 + s.ax * 1.9 + i * 1.3);
    const bx = s.ax + dx * f, by = s.ay + dy * f;
    const h = 0.14 + r1 * 0.20, lean = (r2 - 0.5) * 0.16;
    ctx.moveTo(bx + nx * 0.10, by + ny * 0.10);
    ctx.lineTo(bx + nx * (0.10 + h) + ux * lean, by + ny * (0.10 + h) + uy * lean);
  }
  ctx.stroke();
}

// molten crust along the surface: a glowing seam with flickering flame
// licks where the meadow would grow grass
function drawLavaEdge(ctx, s, theme, t) {
  t = t || 0;
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  let nx = uy, ny = -ux;            // normal pointing up into the playable area
  if (ny > 0) { nx = -nx; ny = -ny; }

  // cooled crust band with a bright molten seam on top
  ctx.fillStyle = '#8e2408';
  ctx.beginPath();
  ctx.moveTo(s.ax - nx * 0.02, s.ay - ny * 0.02);
  ctx.lineTo(s.bx - nx * 0.02, s.by - ny * 0.02);
  ctx.lineTo(s.bx + nx * 0.15, s.by + ny * 0.15);
  ctx.lineTo(s.ax + nx * 0.15, s.ay + ny * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ff8c2c';
  ctx.beginPath();
  ctx.moveTo(s.ax + nx * 0.09, s.ay + ny * 0.09);
  ctx.lineTo(s.bx + nx * 0.09, s.by + ny * 0.09);
  ctx.lineTo(s.bx + nx * 0.15, s.by + ny * 0.15);
  ctx.lineTo(s.ax + nx * 0.15, s.ay + ny * 0.15);
  ctx.closePath();
  ctx.fill();

  // flame licks, flickering and leaning, with gaps in the fire line
  const n = Math.max(1, Math.floor(len / 0.5));
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const r1 = srand(s.ax * 5.1 + s.ay * 3.3 + i * 7.7);
    const r2 = srand(s.ay * 2.9 + s.ax * 1.7 + i * 4.1);
    if (r1 < 0.25) continue;
    const bx = s.ax + dx * f, by = s.ay + dy * f;
    const flick = 0.78 + 0.30 * Math.sin(t * 6 + r2 * 31.4);
    const h = (0.16 + r1 * 0.34) * flick;
    const wHalf = 0.06 + r2 * 0.05;
    const lean = (r2 - 0.5) * 0.22;
    const tipX = bx + nx * (0.12 + h) + ux * lean;
    const tipY = by + ny * (0.12 + h) + uy * lean;
    ctx.fillStyle = 'rgba(255,116,28,0.85)';
    ctx.beginPath();
    ctx.moveTo(bx - ux * wHalf + nx * 0.10, by - uy * wHalf + ny * 0.10);
    ctx.lineTo(bx + ux * wHalf + nx * 0.10, by + uy * wHalf + ny * 0.10);
    ctx.lineTo(tipX, tipY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,210,61,0.9)';
    ctx.beginPath();
    ctx.moveTo(bx - ux * wHalf * 0.5 + nx * 0.10, by - uy * wHalf * 0.5 + ny * 0.10);
    ctx.lineTo(bx + ux * wHalf * 0.5 + nx * 0.10, by + uy * wHalf * 0.5 + ny * 0.10);
    ctx.lineTo(bx + nx * (0.11 + h * 0.55) + ux * lean * 0.6,
               by + ny * (0.11 + h * 0.55) + uy * lean * 0.6);
    ctx.closePath();
    ctx.fill();
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ---------- safe-area insets (notch / home indicator) ----------

// The canvas covers the whole screen, including under a phone's notch and
// home indicator in landscape. game.js measures those cutout sizes from
// env(safe-area-inset-*) and pushes them here; the chrome (HUD, minimap,
// touch buttons, menus) insets itself by them so nothing important hides in
// a cutout. Defaults to zero, so desktop and the headless harnesses (which
// never call setSafeInsets) lay out exactly as before.
let SAFE = { top: 0, right: 0, bottom: 0, left: 0 };
function setSafeInsets(s) {
  s = s || {};
  SAFE = { top: s.top || 0, right: s.right || 0,
           bottom: s.bottom || 0, left: s.left || 0 };
}
// width of the screen band clear of the left/right cutouts
function safeBandW(W) { return W - SAFE.left - SAFE.right; }
// left edge that centers a `bw`-wide element within that clear band
function safeCenterX(W, bw) { return SAFE.left + (safeBandW(W) - bw) / 2; }

// The touch SAVE REPLAY button (crash/finish screens): pinned to the bottom
// centre, just above the home-indicator inset, so it can't run off a short
// landscape screen. Shared by render.js (which anchors the result panel above
// it) and touch.js (which draws and hit-tests it) so the two always agree.
function saveButtonRect(W, H) {
  const w = Math.min(240, safeBandW(W) * 0.72);
  const h = 48;
  return { x: safeCenterX(W, w), y: H - SAFE.bottom - 12 - h, w, h };
}

// ---------- text fitting (so nothing clips on a narrow phone) ----------

// All HUD/menu lettering is monospace, so a string's width scales linearly
// with the font size: shrink the size until `text` fits in maxW, down to a
// floor, and set it on the context. `weight` is '' for normal, 'bold' for
// bold. Returns the chosen px so callers can lay out around it.
function fitFont(ctx, text, maxW, px, weight, floor) {
  const pre = weight ? weight + ' ' : '';
  const fam = 'px "Consolas","Courier New",monospace';
  ctx.font = pre + px + fam;
  const w = ctx.measureText(text).width;
  if (w > maxW) px = Math.max(floor || 9, Math.floor(px * maxW / w));
  ctx.font = pre + px + fam;
  return px;
}

// Greedy word-wrap to lines no wider than maxW at the *current* font; a lone
// word wider than maxW is kept whole (callers size the font to fit first).
function wrapLines(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? cur + ' ' + word : word;
    if (cur && ctx.measureText(next).width > maxW) { lines.push(cur); cur = word; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

// trim `text` with a trailing ellipsis so it fits maxW at the current font
function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

function drawBurger(ctx, x, y, t) {
  t = t || 0;
  const phase = x * 1.7;
  const spin = t * 1.1 + phase;
  ctx.save();
  // hover-bob and a gentle rocking sway
  ctx.translate(x, y + Math.sin(t * 2 + phase) * 0.045);
  ctx.rotate(Math.sin(t * 1.4 + phase) * 0.05);
  ctx.scale(0.55, 0.55);
  ctx.lineJoin = 'round';

  // bottom bun: horizontal gradient gives it a cylindrical body
  let g = ctx.createLinearGradient(-0.78, 0, 0.78, 0);
  g.addColorStop(0, '#a9742f');
  g.addColorStop(0.42, '#f0bd6b');
  g.addColorStop(1, '#8e5f24');
  ctx.fillStyle = g;
  roundRectPath(ctx, -0.72, 0.32, 1.44, 0.34, 0.16);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,235,190,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 0.33, 0.70, 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  // three patties, each draped with melting cheese
  for (let i = 0; i < 3; i++) {
    const base = 0.32 - (i + 1) * 0.30;
    g = ctx.createLinearGradient(-0.78, 0, 0.78, 0);
    g.addColorStop(0, '#3a1d0c');
    g.addColorStop(0.42, '#7a4423');
    g.addColorStop(1, '#33180a');
    ctx.fillStyle = g;
    roundRectPath(ctx, -0.78, base + 0.04, 1.56, 0.26, 0.10);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.ellipse(0, base + 0.06, 0.74, 0.045, 0, 0, Math.PI * 2);
    ctx.fill();

    // charred flecks ride the patty around (same fake-3D spin as the seeds)
    for (let f = 0; f < 5; f++) {
      const a = f * (Math.PI * 2 / 5) + spin + i * 1.7;
      const c = Math.cos(a);
      if (c < 0.12) continue;
      ctx.fillStyle = f % 2 ? 'rgba(25,10,3,0.45)' : 'rgba(255,205,140,0.16)';
      ctx.beginPath();
      ctx.ellipse(Math.sin(a) * 0.70, base + 0.13 + (f % 3) * 0.05,
        0.05 * (0.4 + 0.6 * c), 0.02, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    g = ctx.createLinearGradient(-0.78, 0, 0.78, 0);
    g.addColorStop(0, '#c79212');
    g.addColorStop(0.42, '#ffd84d');
    g.addColorStop(1, '#b8860d');
    ctx.fillStyle = g;
    ctx.fillRect(-0.76, base, 1.52, 0.09);
    // cheese drips orbit with the burger, foreshortening at the edges,
    // while each one slowly stretches and relaxes
    for (let d = 0; d < 4; d++) {
      const a = d * (Math.PI / 2) + spin + i * 0.9;
      const c = Math.cos(a);
      if (c < 0.12) continue;
      const dx = Math.sin(a) * 0.66;
      const hw = 0.09 * (0.35 + 0.65 * c);
      const drip = 0.20 + Math.sin(t * 1.8 + d * 2.0 + i * 2.1 + phase) * 0.05;
      ctx.beginPath();
      ctx.moveTo(dx - hw, base + 0.09);
      ctx.lineTo(dx + hw, base + 0.09);
      ctx.lineTo(dx, base + drip);
      ctx.closePath();
      ctx.fill();
    }
  }

  // crust flecks carry the spin across the bottom bun too
  for (let f = 0; f < 4; f++) {
    const a = f * (Math.PI / 2) + spin + 0.7;
    const c = Math.cos(a);
    if (c < 0.12) continue;
    ctx.fillStyle = 'rgba(255,235,190,0.30)';
    ctx.beginPath();
    ctx.ellipse(Math.sin(a) * 0.62, 0.46 + (f % 2) * 0.07,
      0.04 * (0.4 + 0.6 * c), 0.018, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // top bun: radial gradient dome lit from the upper left
  g = ctx.createRadialGradient(-0.22, -0.64, 0.06, 0, -0.5, 0.95);
  g.addColorStop(0, '#ffd98f');
  g.addColorStop(0.5, '#e8a953');
  g.addColorStop(1, '#9a6526');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, -0.46, 0.74, 0.40, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-0.70, -0.50, 1.40, 0.05);

  // sesame seeds orbit the dome (fake-3D spin: foreshorten and fade
  // as they swing around the back)
  const rows = [[-0.57, 0.62], [-0.66, 0.50], [-0.74, 0.30]];
  for (let sI = 0; sI < 7; sI++) {
    const a = sI * (Math.PI * 2 / 7) + spin;
    const c = Math.cos(a);
    if (c < 0.12) continue;
    const row = rows[sI % rows.length];
    ctx.globalAlpha = 0.45 + 0.55 * c;
    ctx.fillStyle = '#fdf3d3';
    ctx.beginPath();
    ctx.ellipse(Math.sin(a) * row[1], row[0], 0.055 * (0.5 + 0.5 * c), 0.032,
      Math.sin(a) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // sweeping glint on the dome
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.beginPath();
  ctx.ellipse(Math.sin(spin * 0.9) * 0.3 - 0.1, -0.67, 0.09, 0.045, -0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// a single puff of popcorn: three overlapping lobes with buttery shading
function drawKernel(ctx, cx, cy, s, seed) {
  const g = ctx.createRadialGradient(cx - s * 0.4, cy - s * 0.5, s * 0.1,
    cx, cy, s * 1.5);
  g.addColorStop(0, '#fffdf0');
  g.addColorStop(0.5, '#f8e3a0');
  g.addColorStop(1, '#cf9f3e');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let l = 0; l < 3; l++) {
    const a = seed * 2.3 + l * (Math.PI * 2 / 3);
    const lx = cx + Math.cos(a) * s * 0.45, ly = cy + Math.sin(a) * s * 0.4;
    ctx.moveTo(lx + s * 0.6, ly);
    ctx.arc(lx, ly, s * 0.6, 0, Math.PI * 2);
  }
  ctx.moveTo(cx + s * 0.75, cy);
  ctx.arc(cx, cy, s * 0.75, 0, Math.PI * 2);
  ctx.fill();
}

// the goal: a striped bucket of buttery popcorn (fake-3D, animated)
function drawPopcorn(ctx, x, y, t) {
  t = t || 0;
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 1.6) * 0.03);
  ctx.rotate(Math.sin(t * 1.1) * 0.04);

  const topW = 0.40, botW = 0.28, topY = -0.02, botY = 0.55;
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(-topW, topY);
    ctx.lineTo(topW, topY);
    ctx.lineTo(botW, botY);
    ctx.lineTo(-botW, botY);
    ctx.closePath();
  };

  // ground-contact shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, botY + 0.04, botW * 1.15, 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  body();
  ctx.fillStyle = '#f6f2ea';
  ctx.fill();

  // red stripes orbit the bucket (fake-3D cylinder rotation)
  ctx.save();
  body();
  ctx.clip();
  for (let k = 0; k < 7; k++) {
    const ph = k * (Math.PI * 2 / 7) + t * 0.9;
    const c = Math.cos(ph);
    if (c <= 0.05) continue; // back side of the bucket
    const sx = Math.sin(ph), w = 0.16 * c;
    ctx.fillStyle = '#c8202a';
    ctx.beginPath();
    ctx.moveTo(sx * topW - w, topY);
    ctx.lineTo(sx * topW + w, topY);
    ctx.lineTo(sx * botW + w * 0.7, botY);
    ctx.lineTo(sx * botW - w * 0.7, botY);
    ctx.closePath();
    ctx.fill();
  }
  // cylindrical shading over the stripes
  const sh = ctx.createLinearGradient(-topW, 0, topW, 0);
  sh.addColorStop(0, 'rgba(0,0,0,0.30)');
  sh.addColorStop(0.25, 'rgba(0,0,0,0)');
  sh.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  sh.addColorStop(0.7, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = sh;
  ctx.fillRect(-topW, topY, topW * 2, botY - topY);
  ctx.restore();
  body();
  ctx.strokeStyle = 'rgba(60,20,10,0.35)';
  ctx.lineWidth = 0.025;
  ctx.stroke();

  // butter pooling on the ground where it has run down the side
  ctx.fillStyle = 'rgba(247,191,49,0.85)';
  ctx.beginPath();
  ctx.ellipse(0.20, botY + 0.035, 0.11 + Math.sin(t * 0.5) * 0.01, 0.028,
    0, 0, Math.PI * 2);
  ctx.fill();

  // heaping mound of popcorn, back rows first, every puff gently jiggling
  const K = [
    [0.02, -0.50, 0.085],
    [-0.16, -0.44, 0.09], [0.18, -0.45, 0.085],
    [-0.07, -0.42, 0.10], [0.12, -0.38, 0.09],
    [-0.28, -0.31, 0.09], [0.30, -0.33, 0.085],
    [-0.20, -0.26, 0.10], [0.02, -0.30, 0.115], [0.22, -0.24, 0.095],
    [-0.36, -0.12, 0.085], [0.36, -0.10, 0.08],
    [-0.30, -0.10, 0.10], [-0.10, -0.16, 0.115], [0.12, -0.13, 0.105],
    [0.30, -0.08, 0.095],
  ];
  for (let i = 0; i < K.length; i++) {
    const j = Math.sin(t * 2.8 + i * 1.9) * 0.012;
    drawKernel(ctx, K[i][0], K[i][1] + j, K[i][2], i);
  }

  // every few seconds one kernel pops up out of the bucket
  const cyc = (t % 2.8) / 0.8;
  if (cyc < 1) {
    const h = 4 * cyc * (1 - cyc);
    drawKernel(ctx, 0.05 + cyc * 0.15, -0.55 - h * 0.45, 0.07, 3.3);
  }

  // front rim overlaps the base of the mound; a shallow arc so it traces
  // the true near edge of the bucket opening
  ctx.strokeStyle = '#f3eee2';
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.ellipse(0, topY, topW, 0.045, 0, 0, Math.PI);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.ellipse(0, topY + 0.03, topW, 0.045, 0, 0, Math.PI);
  ctx.stroke();

  // butter leaking over the rim, the streaks orbiting with the stripes
  for (let b = 0; b < 3; b++) {
    const ph = b * (Math.PI * 2 / 3) + t * 0.9 + 0.8;
    const c = Math.cos(ph);
    if (c <= 0.02) continue;
    // fade and thin out near the silhouette instead of popping
    const edge = Math.min(1, (c - 0.02) / 0.33);
    ctx.globalAlpha = edge * edge * (3 - 2 * edge);
    const len = 0.24 + b * 0.05 + Math.sin(t * 0.6 + b * 2.1) * 0.05;
    const bw = 0.034 * (0.15 + 0.85 * c);
    // streaks slant inward with the bucket wall as they run down
    const bx = Math.sin(ph) * topW;
    const tipX = Math.sin(ph) * (topW + (botW - topW) * len / (botY - topY));
    ctx.fillStyle = '#f0b428';
    ctx.beginPath();
    ctx.moveTo(bx - bw, topY - 0.02);
    ctx.quadraticCurveTo((bx + tipX) / 2 - bw, topY + len * 0.55,
      tipX - bw * 0.7, topY + len);
    ctx.arc(tipX, topY + len, bw * 1.25, Math.PI, 0, true);
    ctx.quadraticCurveTo((bx + tipX) / 2 + bw, topY + len * 0.55,
      bx + bw, topY - 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,240,170,0.55)';
    ctx.beginPath();
    ctx.ellipse(tipX, topY + len, bw * 0.5, bw * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // a couple of dropped puffs beside the bucket
  drawKernel(ctx, -0.36, 0.52, 0.06, 7.1);
  drawKernel(ctx, 0.30, 0.53, 0.055, 8.4);

  // butter glint sweeping across the mound
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.beginPath();
  ctx.ellipse(Math.sin(t * 0.8) * 0.22, -0.32, 0.10, 0.05, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // steam curling off the top, each wisp rising, swaying, and thinning out
  ctx.lineCap = 'round';
  for (let s = 0; s < 3; s++) {
    const cycle = (t * 0.35 + s * 0.37) % 1;
    const fade = 0.32 * (1 - cycle) * Math.min(1, cycle * 4);
    const sx = -0.16 + s * 0.16 + Math.sin(t * 1.3 + s * 2.6) * 0.03;
    const sy = -0.56 - cycle * 0.36;
    ctx.strokeStyle = `rgba(255,255,255,${fade.toFixed(3)})`;
    ctx.lineWidth = 0.035 + cycle * 0.03;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(sx + 0.06, sy - 0.07, sx - 0.06, sy - 0.13,
      sx + 0.02, sy - 0.20);
    ctx.stroke();
  }

  ctx.restore();
}

// one nut in the heap. `type` picks the kind so a mound looks like assorted
// nuts: 0 peanut (twin-lobe shell), 1 almond (pointed teardrop), 2 round nut
// (hazelnut). `s` is the overall size, `ang` the resting tilt.
function drawNut(ctx, cx, cy, s, ang, type) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  if (type === 0) {
    const g = ctx.createLinearGradient(-s * 0.6, -s * 0.5, s * 0.6, s * 0.5);
    g.addColorStop(0, '#e7c98e');
    g.addColorStop(0.5, '#c8a059');
    g.addColorStop(1, '#9a7335');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(-s * 0.4, 0.02, s * 0.5, s * 0.42, 0, 0, Math.PI * 2);
    ctx.ellipse(s * 0.4, -0.02, s * 0.56, s * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
    // shell crosshatch ridges + the pinch between the two halves
    ctx.strokeStyle = 'rgba(120,84,38,0.45)';
    ctx.lineWidth = s * 0.05;
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
      ctx.moveTo(s * (0.18 + i * 0.18), -s * 0.34);
      ctx.lineTo(s * (0.32 + i * 0.18), s * 0.34);
    }
    ctx.stroke();
  } else if (type === 1) {
    const g = ctx.createLinearGradient(-s * 0.5, -s * 0.6, s * 0.5, s * 0.6);
    g.addColorStop(0, '#dcb681');
    g.addColorStop(0.5, '#b27d43');
    g.addColorStop(1, '#7c5125');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.62);
    ctx.quadraticCurveTo(s * 0.58, -s * 0.12, 0, s * 0.62);
    ctx.quadraticCurveTo(-s * 0.58, -s * 0.12, 0, -s * 0.62);
    ctx.fill();
    ctx.strokeStyle = 'rgba(92,60,28,0.4)';
    ctx.lineWidth = s * 0.045;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.42);
    ctx.lineTo(0, s * 0.42);
    ctx.stroke();
  } else {
    const g = ctx.createRadialGradient(-s * 0.22, -s * 0.28, s * 0.08, 0, 0, s * 0.7);
    g.addColorStop(0, '#c58f52');
    g.addColorStop(0.6, '#9a6731');
    g.addColorStop(1, '#5e3c1c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.58, 0, Math.PI * 2);
    ctx.fill();
    // the fibrous little cap where it joined the branch
    ctx.fillStyle = 'rgba(74,48,24,0.65)';
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.4, s * 0.24, s * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// a nut mound: this world's "killer" hazard (the spinning-spike equivalent) —
// a heap of assorted nuts smothered in a glossy coat of oozing peanut butter.
// Touching it with any part of the bike is fatal (see PHYS.nutR / Bike.step).
// Drawn centred on (x, y), the lethal point, sized to roughly the kill radius.
// Planted on the terrain, so unlike the hovering burger/popcorn it doesn't bob;
// only the peanut-butter drips and surface glints move, so it reads as oozing.
function drawNutMound(ctx, x, y, t) {
  t = t || 0;
  const phase = x * 1.3;          // each mound oozes on its own clock
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // ground-contact shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0.5, 0.6, 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // the heaped nuts, back rows first so the front ones overlap
  const NUTS = [
    [-0.14, -0.34, 0.36, 0.3, 2], [0.12, -0.36, 0.34, -0.4, 0],
    [-0.33, -0.12, 0.40, 0.8, 1], [0.30, -0.16, 0.40, -0.6, 2],
    [-0.02, -0.14, 0.46, 0.1, 0],
    [0.04, 0.06, 0.42, 1.2, 1], [-0.30, 0.10, 0.40, -0.3, 0],
    [0.34, 0.08, 0.38, 0.5, 1],
    [-0.12, 0.26, 0.42, 0.2, 2], [0.18, 0.28, 0.40, -0.9, 0],
    [-0.40, 0.28, 0.34, 0.6, 1], [0.42, 0.26, 0.34, -0.2, 2],
  ];
  for (const [nx, ny, s, a, ty] of NUTS) drawNut(ctx, nx, ny, s, a, ty);

  // the peanut-butter coat: a glossy lumpy dome draped over the upper pile,
  // smooth low-frequency lobes so it reads gooey, lit from the upper left
  const lobe = a => 1 + 0.06 * Math.sin(a * 3 + 0.7) + 0.04 * Math.sin(a * 5 - 1.1);
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const k = lobe(a);
    const px = Math.cos(a) * 0.54 * k;
    const py = -0.07 + Math.sin(a) * 0.47 * k;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  let g = ctx.createRadialGradient(-0.18, -0.28, 0.05, 0, -0.05, 0.72);
  g.addColorStop(0, '#ecc074');
  g.addColorStop(0.55, '#c89344');
  g.addColorStop(1, '#9a6c28');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,80,28,0.5)';
  ctx.lineWidth = 0.035;
  ctx.stroke();

  // thick tongues of peanut butter oozing down off the rim; each slowly
  // stretches and relaxes so the mound looks like it's perpetually dripping
  const DRIPS = [[-0.30, 0.28, 1.0], [-0.05, 0.34, 1.7], [0.20, 0.30, 2.6], [0.40, 0.18, 3.4]];
  for (const [dx, dyTop, ph] of DRIPS) {
    const len = 0.18 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.3 + ph + phase));
    const w = 0.09;
    const tipY = dyTop + len;
    ctx.fillStyle = '#bd8a36';
    ctx.beginPath();
    ctx.moveTo(dx - w, dyTop - 0.04);
    ctx.quadraticCurveTo(dx - w * 0.9, dyTop + len * 0.6, dx - w * 0.6, tipY);
    ctx.arc(dx, tipY, w * 0.6, Math.PI, 0, true);
    ctx.quadraticCurveTo(dx + w * 0.9, dyTop + len * 0.6, dx + w, dyTop - 0.04);
    ctx.closePath();
    ctx.fill();
    // a wet seam of light running down each drip
    ctx.strokeStyle = 'rgba(255,232,160,0.5)';
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.moveTo(dx - w * 0.2, dyTop);
    ctx.lineTo(dx - w * 0.2, tipY - w * 0.4);
    ctx.stroke();
  }

  // a couple of whole nuts perched in the butter, so it reads as nuts AND
  // peanut butter rather than a plain blob
  drawNut(ctx, -0.16, -0.18, 0.34, 0.5, 1);
  drawNut(ctx, 0.16, -0.12, 0.36, -0.5, 0);

  // glossy highlight pooled near the crown
  ctx.fillStyle = 'rgba(255,240,200,0.32)';
  ctx.beginPath();
  ctx.ellipse(-0.13, -0.27, 0.17, 0.09, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // small wet glints sliding slowly across the coat
  for (let i = 0; i < 3; i++) {
    const f = ((srand(x * 5.1 + i * 3.3) + t * 0.05) % 1);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(-0.34 + f * 0.7, -0.18 + Math.sin(f * 6.0 + i) * 0.12,
      0.035, 0.02, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// ---------- doodads: inert decorative sprites ----------
//
// Doodads are purely cosmetic props an author drops onto a map in the editor.
// They never touch the simulation — the bike can't collide with them and the
// physics never reads them — they only dress the scene, so adding them needs
// no replay/.bmm version bump. Each map carries an optional `doodads` list of
// { type, x, y, layer } records; `layer` is 'back' (drawn behind the rider, as
// scenery) or 'front' (drawn over the rider, so he passes behind the prop).
// Absent on a map with none, so older maps and the headless harnesses are
// unaffected. Every sprite draws in world units anchored at its base centre
// (x, y) — drop one on the floor and it stands on it — extending up into
// negative y. The DOODADS registry lists them in editor-picker order with a
// label and an approximate footprint (w, h) used for the editor's hit box and
// ghost preview.

// window/condenser air-conditioning unit: a brushed-metal box with side vent
// louvers and a slowly turning guarded fan (the spin is visual only)
function drawAcUnit(ctx, t) {
  const W = 0.75, top = -1.04;
  ctx.lineJoin = 'round';
  // ground-contact shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0.02, W * 1.05, 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  // mounting feet
  ctx.fillStyle = '#3a3f44';
  ctx.fillRect(-W * 0.82, -0.12, 0.16, 0.12);
  ctx.fillRect(W * 0.82 - 0.16, -0.12, 0.16, 0.12);
  // body: brushed-metal box, lit from the left
  let g = ctx.createLinearGradient(-W, 0, W, 0);
  g.addColorStop(0, '#9aa3aa');
  g.addColorStop(0.5, '#ced5da');
  g.addColorStop(1, '#828b92');
  ctx.fillStyle = g;
  roundRectPath(ctx, -W, top + 0.08, W * 2, -top - 0.16, 0.1);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,46,52,0.55)';
  ctx.lineWidth = 0.03;
  ctx.stroke();
  // top lid lip
  ctx.fillStyle = '#aeb6bc';
  roundRectPath(ctx, -W - 0.04, top, W * 2 + 0.08, 0.14, 0.06);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,46,52,0.45)';
  ctx.stroke();
  // intake louvers across the left half
  ctx.strokeStyle = 'rgba(60,66,72,0.5)';
  ctx.lineWidth = 0.025;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const ly = top + 0.3 + i * 0.15;
    ctx.moveTo(-W + 0.1, ly);
    ctx.lineTo(-0.08, ly);
  }
  ctx.stroke();
  // fan housing on the right
  const fcx = W * 0.42, fcy = top / 2 - 0.02, fr = 0.34;
  ctx.fillStyle = '#5b636a';
  ctx.beginPath();
  ctx.arc(fcx, fcy, fr + 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#23272b';
  ctx.beginPath();
  ctx.arc(fcx, fcy, fr, 0, Math.PI * 2);
  ctx.fill();
  // blades (slow spin, purely decorative)
  ctx.save();
  ctx.translate(fcx, fcy);
  ctx.rotate(t * 0.6);
  ctx.fillStyle = 'rgba(150,160,168,0.85)';
  for (let b = 0; b < 4; b++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(fr * 0.7, -fr * 0.18, fr * 0.92, fr * 0.14);
    ctx.quadraticCurveTo(fr * 0.5, fr * 0.22, 0, 0);
    ctx.fill();
  }
  ctx.fillStyle = '#828b92';
  ctx.beginPath();
  ctx.arc(0, 0, fr * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // guard: radial bars and two rings
  ctx.strokeStyle = 'rgba(186,194,200,0.7)';
  ctx.lineWidth = 0.028;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    ctx.moveTo(fcx, fcy);
    ctx.lineTo(fcx + Math.cos(a) * fr, fcy + Math.sin(a) * fr);
  }
  ctx.moveTo(fcx + fr, fcy);
  ctx.arc(fcx, fcy, fr, 0, Math.PI * 2);
  ctx.moveTo(fcx + fr * 0.58, fcy);
  ctx.arc(fcx, fcy, fr * 0.58, 0, Math.PI * 2);
  ctx.stroke();
}

// a power/squat rack: two drilled steel uprights on a top crossmember and
// base feet, J-hooks cradling a barbell loaded with weight plates each side
function drawSquatRack(ctx, t) {
  const px = 0.66, top = -2.18, postW = 0.13;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0.02, 1.0, 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  // base stabiliser feet
  ctx.fillStyle = '#2c3138';
  for (const sx of [-1, 1]) {
    roundRectPath(ctx, sx * px - 0.34, -0.13, 0.68, 0.13, 0.05);
    ctx.fill();
  }
  // two uprights, drilled with adjustment holes
  const post = cx => {
    const g = ctx.createLinearGradient(cx - postW, 0, cx + postW, 0);
    g.addColorStop(0, '#454c54');
    g.addColorStop(0.5, '#2a2f35');
    g.addColorStop(1, '#171b1f');
    ctx.fillStyle = g;
    roundRectPath(ctx, cx - postW, top, postW * 2, -top, 0.04);
    ctx.fill();
    ctx.fillStyle = 'rgba(8,10,12,0.85)';
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(cx, top + 0.24 + i * 0.2, 0.032, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  post(-px); post(px);
  // top crossmember tying the posts together
  let g = ctx.createLinearGradient(0, top, 0, top + 0.16);
  g.addColorStop(0, '#3a4047');
  g.addColorStop(1, '#20252a');
  ctx.fillStyle = g;
  roundRectPath(ctx, -px - postW, top, (px + postW) * 2, 0.16, 0.05);
  ctx.fill();
  // J-hooks
  const barY = -1.44;
  ctx.fillStyle = '#b3272b';
  for (const sx of [-1, 1]) {
    roundRectPath(ctx, sx * px - 0.05, barY - 0.02, 0.1, 0.22, 0.03);
    ctx.fill();
  }
  // barbell shaft
  const bg = ctx.createLinearGradient(0, barY - 0.05, 0, barY + 0.05);
  bg.addColorStop(0, '#e3e7ea');
  bg.addColorStop(0.5, '#b6bcc1');
  bg.addColorStop(1, '#7d848a');
  ctx.fillStyle = bg;
  roundRectPath(ctx, -0.98, barY - 0.045, 1.96, 0.09, 0.04);
  ctx.fill();
  // loaded plates + inner collar, each end
  for (const sx of [-1, 1]) {
    for (let p = 0; p < 2; p++) {
      const plx = sx * (0.74 + p * 0.13);
      const rw = 0.1 - p * 0.018, rh = 0.34 - p * 0.06;
      const pg = ctx.createLinearGradient(plx - rw, 0, plx + rw, 0);
      pg.addColorStop(0, '#16191c');
      pg.addColorStop(0.5, '#3a4045');
      pg.addColorStop(1, '#0e1012');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.ellipse(plx, barY, rw, rh, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,128,134,0.4)';
      ctx.lineWidth = 0.02;
      ctx.stroke();
    }
    ctx.fillStyle = '#9aa1a7';
    ctx.beginPath();
    ctx.ellipse(sx * 0.62, barY, 0.05, 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// a pair of heavy dumbbells resting on the floor: a knurled steel handle
// between two chunky heads, drawn as a smaller one set behind a larger one
function drawDumbbells(ctx, t) {
  ctx.lineJoin = 'round';
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0.0, 0.9, 0.11, 0, 0, Math.PI * 2);
  ctx.fill();

  const bell = (cx, cy, scale, dark) => {
    const hw = 0.34 * scale;      // half handle length, to the inner head
    const hr = 0.26 * scale;      // head half-height
    const headW = 0.16 * scale;   // head half-thickness
    // handle
    const g = ctx.createLinearGradient(0, cy - 0.06 * scale, 0, cy + 0.06 * scale);
    g.addColorStop(0, '#d7dbde');
    g.addColorStop(0.5, '#a7adb2');
    g.addColorStop(1, '#6f767c');
    ctx.fillStyle = g;
    roundRectPath(ctx, cx - hw, cy - 0.055 * scale, hw * 2, 0.11 * scale, 0.04 * scale);
    ctx.fill();
    // knurling
    ctx.strokeStyle = 'rgba(60,66,72,0.4)';
    ctx.lineWidth = 0.012 * scale;
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      ctx.moveTo(cx + i * 0.05 * scale, cy - 0.045 * scale);
      ctx.lineTo(cx + i * 0.05 * scale, cy + 0.045 * scale);
    }
    ctx.stroke();
    // two heads
    for (const sx of [-1, 1]) {
      const ex = cx + sx * (hw + headW);
      const hg = ctx.createLinearGradient(ex - headW, cy - hr, ex + headW, cy + hr);
      hg.addColorStop(0, dark ? '#23272b' : '#3b4146');
      hg.addColorStop(0.5, dark ? '#41474d' : '#5a6168');
      hg.addColorStop(1, dark ? '#15181b' : '#23272b');
      ctx.fillStyle = hg;
      roundRectPath(ctx, ex - headW, cy - hr, headW * 2, hr * 2, 0.08 * scale);
      ctx.fill();
      ctx.strokeStyle = 'rgba(12,14,16,0.6)';
      ctx.lineWidth = 0.02 * scale;
      ctx.stroke();
      // a soft vertical rim highlight
      ctx.strokeStyle = 'rgba(172,180,186,0.4)';
      ctx.lineWidth = 0.018 * scale;
      ctx.beginPath();
      ctx.moveTo(ex - headW * 0.4, cy - hr * 0.75);
      ctx.lineTo(ex - headW * 0.4, cy + hr * 0.75);
      ctx.stroke();
    }
  };

  bell(-0.28, -0.2, 0.82, true);    // the one tucked behind
  bell(0.12, -0.26, 1.0, false);    // the bigger one in front
}

// a kettlebell: a cast-iron bell with an arched handle
function drawKettlebell(ctx, t) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0.02, 0.4, 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  // handle (drawn first, behind the bell)
  ctx.strokeStyle = '#3b4147';
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.moveTo(-0.17, -0.58);
  ctx.quadraticCurveTo(-0.2, -0.88, 0, -0.88);
  ctx.quadraticCurveTo(0.2, -0.88, 0.17, -0.58);
  ctx.stroke();
  // bell body
  const g = ctx.createRadialGradient(-0.12, -0.46, 0.05, 0, -0.36, 0.62);
  g.addColorStop(0, '#5a626a');
  g.addColorStop(0.6, '#33393f');
  g.addColorStop(1, '#171b1f');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, -0.34, 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#171b1f';
  ctx.beginPath();
  ctx.ellipse(0, -0.02, 0.28, 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(185,193,199,0.32)';
  ctx.beginPath();
  ctx.ellipse(-0.13, -0.44, 0.08, 0.12, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

// a flat weight bench: a red vinyl pad on a steel frame
function drawBench(ctx, t) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0.02, 0.72, 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  // splayed legs at each end
  ctx.strokeStyle = '#2c3138';
  ctx.lineWidth = 0.08;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sx * 0.5, -0.3);
    ctx.lineTo(sx * 0.62, 0);
    ctx.moveTo(sx * 0.5, -0.3);
    ctx.lineTo(sx * 0.36, 0);
    ctx.stroke();
  }
  // frame rail under the pad
  ctx.fillStyle = '#23272b';
  roundRectPath(ctx, -0.6, -0.36, 1.2, 0.08, 0.03);
  ctx.fill();
  // padded top
  const g = ctx.createLinearGradient(0, -0.52, 0, -0.32);
  g.addColorStop(0, '#c43a3a');
  g.addColorStop(1, '#7e2020');
  ctx.fillStyle = g;
  roundRectPath(ctx, -0.66, -0.52, 1.32, 0.2, 0.08);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,180,180,0.4)';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.moveTo(-0.58, -0.45);
  ctx.lineTo(0.58, -0.45);
  ctx.stroke();
}

// an inflatable exercise ball
function drawExerciseBall(ctx, t) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0.02, 0.46, 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  const r = 0.46, cy = -0.46;
  const g = ctx.createRadialGradient(-0.16, cy - 0.16, 0.06, 0, cy, r * 1.25);
  g.addColorStop(0, '#7fd0e8');
  g.addColorStop(0.55, '#3aa0c8');
  g.addColorStop(1, '#1f6f96');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,70,95,0.4)';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.ellipse(0, cy, r * 0.5, r, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, cy, r, r * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(-0.16, cy - 0.16, 0.1, 0.07, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

// a water cooler: a white cabinet under an inverted blue jug
function drawWaterCooler(ctx, t) {
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0.02, 0.34, 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  // cabinet
  let g = ctx.createLinearGradient(-0.3, 0, 0.3, 0);
  g.addColorStop(0, '#cfd6db');
  g.addColorStop(0.5, '#eef2f4');
  g.addColorStop(1, '#b8c0c6');
  ctx.fillStyle = g;
  roundRectPath(ctx, -0.3, -0.86, 0.6, 0.86, 0.06);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,66,72,0.4)';
  ctx.lineWidth = 0.02;
  ctx.stroke();
  // taps + drip tray
  ctx.fillStyle = '#3b4147';
  ctx.fillRect(-0.13, -0.6, 0.07, 0.1);
  ctx.fillRect(0.06, -0.6, 0.07, 0.1);
  ctx.fillStyle = '#9aa1a7';
  ctx.fillRect(-0.2, -0.46, 0.4, 0.04);
  // jug of water
  g = ctx.createLinearGradient(0, -1.28, 0, -0.86);
  g.addColorStop(0, 'rgba(120,190,230,0.9)');
  g.addColorStop(1, 'rgba(70,150,205,0.95)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-0.24, -0.88);
  ctx.lineTo(0.24, -0.88);
  ctx.lineTo(0.18, -1.16);
  ctx.quadraticCurveTo(0.16, -1.3, 0, -1.3);
  ctx.quadraticCurveTo(-0.16, -1.3, -0.18, -1.16);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.ellipse(-0.08, -1.06, 0.04, 0.12, 0.2, 0, Math.PI * 2);
  ctx.fill();
}

// a tall gym locker with two doors, vents and handles
function drawLocker(ctx, t) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0.02, 0.46, 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createLinearGradient(-0.4, 0, 0.4, 0);
  g.addColorStop(0, '#356391');
  g.addColorStop(0.5, '#5a93c8');
  g.addColorStop(1, '#2c557d');
  ctx.fillStyle = g;
  roundRectPath(ctx, -0.4, -1.84, 0.8, 1.84, 0.04);
  ctx.fill();
  ctx.strokeStyle = 'rgba(18,36,54,0.55)';
  ctx.lineWidth = 0.025;
  ctx.stroke();
  ctx.beginPath();                  // split between the two doors
  ctx.moveTo(-0.4, -0.92);
  ctx.lineTo(0.4, -0.92);
  ctx.stroke();
  ctx.lineWidth = 0.018;
  for (const top of [-1.78, -0.86]) {
    ctx.strokeStyle = 'rgba(225,235,245,0.4)';
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const vy = top + 0.08 + i * 0.07;
      ctx.moveTo(-0.2, vy);
      ctx.lineTo(0.2, vy);
    }
    ctx.stroke();
    ctx.fillStyle = '#1c344c';
    ctx.fillRect(0.24, top + 0.46, 0.05, 0.16);
  }
}

// a potted plant, leaves swaying gently
function drawPlant(ctx, t) {
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0.02, 0.34, 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  // terracotta pot
  let g = ctx.createLinearGradient(-0.28, 0, 0.28, 0);
  g.addColorStop(0, '#a85a32');
  g.addColorStop(0.5, '#d2864f');
  g.addColorStop(1, '#8a4523');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-0.28, -0.42);
  ctx.lineTo(0.28, -0.42);
  ctx.lineTo(0.2, 0);
  ctx.lineTo(-0.2, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#b9703f';
  roundRectPath(ctx, -0.31, -0.48, 0.62, 0.09, 0.03);
  ctx.fill();
  // fronds
  const sway = Math.sin(t * 0.8) * 0.04;
  const leaves = [[-0.18, -0.5, -0.55], [0.18, -0.5, 0.55], [-0.1, -0.72, -0.22],
    [0.1, -0.74, 0.26], [0, -0.92, 0.0], [-0.22, -0.62, -0.95], [0.22, -0.64, 0.95]];
  for (const [lx, ly, ang] of leaves) {
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(ang + sway);
    g = ctx.createLinearGradient(0, -0.34, 0, 0.06);
    g.addColorStop(0, '#5fb84a');
    g.addColorStop(1, '#2f7d27');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0.06);
    ctx.quadraticCurveTo(0.12, -0.18, 0, -0.36);
    ctx.quadraticCurveTo(-0.12, -0.18, 0, 0.06);
    ctx.fill();
    ctx.restore();
  }
}

// a traffic cone with a reflective band
function drawCone(ctx, t) {
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0.02, 0.36, 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d85a18';
  roundRectPath(ctx, -0.34, -0.1, 0.68, 0.1, 0.03);
  ctx.fill();
  const g = ctx.createLinearGradient(-0.2, 0, 0.2, 0);
  g.addColorStop(0, '#c44e10');
  g.addColorStop(0.5, '#ff7a2a');
  g.addColorStop(1, '#b8460c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-0.26, -0.1);
  ctx.lineTo(-0.06, -0.82);
  ctx.quadraticCurveTo(0, -0.9, 0.06, -0.82);
  ctx.lineTo(0.26, -0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(245,245,245,0.9)';
  ctx.beginPath();
  ctx.moveTo(-0.2, -0.32);
  ctx.lineTo(0.2, -0.32);
  ctx.lineTo(0.16, -0.46);
  ctx.lineTo(-0.16, -0.46);
  ctx.closePath();
  ctx.fill();
}

// a round wall clock; the hands creep so it reads as running
function drawClock(ctx, t) {
  ctx.lineCap = 'round';
  const r = 0.4, cy = -0.4;
  ctx.fillStyle = '#2c3138';
  ctx.beginPath();
  ctx.arc(0, cy, r + 0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f3efe4';
  ctx.beginPath();
  ctx.arc(0, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a3f44';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    ctx.moveTo(Math.sin(a) * r * 0.82, cy - Math.cos(a) * r * 0.82);
    ctx.lineTo(Math.sin(a) * r * 0.94, cy - Math.cos(a) * r * 0.94);
  }
  ctx.stroke();
  const hh = t * 0.0167, mm = t * 0.2;
  ctx.strokeStyle = '#23272b';
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(Math.sin(hh) * r * 0.4, cy - Math.cos(hh) * r * 0.4);
  ctx.stroke();
  ctx.lineWidth = 0.022;
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(Math.sin(mm) * r * 0.7, cy - Math.cos(mm) * r * 0.7);
  ctx.stroke();
  ctx.fillStyle = '#b3272b';
  ctx.beginPath();
  ctx.arc(0, cy, 0.03, 0, Math.PI * 2);
  ctx.fill();
}

// editor-picker order; w/h is the footprint used for hit-testing + previews
const DOODADS = [
  { id: 'ac', label: 'A/C Unit', w: 1.5, h: 1.12, draw: drawAcUnit },
  { id: 'rack', label: 'Squat Rack', w: 1.86, h: 2.36, draw: drawSquatRack },
  { id: 'dumbbell', label: 'Dumbbells', w: 1.74, h: 0.66, draw: drawDumbbells },
  { id: 'kettlebell', label: 'Kettlebell', w: 0.95, h: 1.0, draw: drawKettlebell },
  { id: 'bench', label: 'Weight Bench', w: 1.5, h: 0.72, draw: drawBench },
  { id: 'ball', label: 'Exercise Ball', w: 1.02, h: 1.0, draw: drawExerciseBall },
  { id: 'cooler', label: 'Water Cooler', w: 0.62, h: 1.38, draw: drawWaterCooler },
  { id: 'locker', label: 'Locker', w: 0.92, h: 1.92, draw: drawLocker },
  { id: 'plant', label: 'Potted Plant', w: 0.92, h: 1.26, draw: drawPlant },
  { id: 'cone', label: 'Traffic Cone', w: 0.72, h: 0.96, draw: drawCone },
  { id: 'clock', label: 'Wall Clock', w: 0.9, h: 0.9, draw: drawClock },
];
const DOODAD_BY_ID = {};
for (const d of DOODADS) DOODAD_BY_ID[d.id] = d;

// draw one doodad sprite centred at its base on (x, y), optionally tilted by
// `angle` radians about that base anchor (0/absent = upright). Editor-placed
// props may carry a rotation; baked-in level doodads omit it and draw upright.
function drawDoodad(ctx, type, x, y, t, angle) {
  const d = DOODAD_BY_ID[type];
  if (!d) return;                   // unknown id (e.g. a sprite from a newer build): skip
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  d.draw(ctx, t || 0);
  ctx.restore();
}

// draw a level/map's doodads on one layer ('back' | 'front'), in author order
function drawDoodadLayer(ctx, doodads, layer, t) {
  if (!doodads) return;
  for (const d of doodads) {
    if ((d.layer === 'front' ? 'front' : 'back') === layer) drawDoodad(ctx, d.type, d.x, d.y, t, d.angle);
  }
}

function strokeSeg(ctx, a, b, w, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawWheel(ctx, w) {
  ctx.save();
  ctx.translate(w.pos.x, w.pos.y);
  // tire
  ctx.strokeStyle = '#181818';
  ctx.lineWidth = 0.13;
  ctx.beginPath();
  ctx.arc(0, 0, 0.335, 0, Math.PI * 2);
  ctx.stroke();
  // rim
  ctx.strokeStyle = '#cfcfcf';
  ctx.lineWidth = 0.045;
  ctx.beginPath();
  ctx.arc(0, 0, 0.23, 0, Math.PI * 2);
  ctx.stroke();
  // spokes
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = w.rot + k * Math.PI * 2 / 3;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 0.23, Math.sin(a) * 0.23);
  }
  ctx.stroke();
  // hub
  ctx.fillStyle = '#999';
  ctx.beginPath();
  ctx.arc(0, 0, 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// `back` draws the back of the head (for the gym-mirror reflection, where the
// rider faces away from the glass) — falls back to the front photo if the
// back image hasn't loaded.
function drawHead(ctx, x, y, facing, angle, back) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle || 0);
  // the rider's head photo; the drawn helmet is the fallback if it failed
  const backImg = IMAGES.bikerBack;
  const headImg = (back && backImg && backImg.complete && backImg.naturalWidth > 0)
    ? backImg : IMAGES.biker;
  if (headImg && headImg.complete && headImg.naturalWidth > 0) {
    // facing is continuous during the turn animation, so the face
    // squashes through edge-on as the rider swings around
    ctx.scale(Math.abs(facing) < 0.04 ? 0.04 : facing, 1);
    const h = 0.62;
    const w = h * headImg.naturalWidth / headImg.naturalHeight;
    ctx.drawImage(headImg, -w / 2, -h / 2, w, h);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, PHYS.headR, 0, Math.PI * 2);
    ctx.fillStyle = '#e9e9e9';
    ctx.fill();
    ctx.strokeStyle = '#7a7a7a';
    ctx.lineWidth = 0.03;
    ctx.stroke();
    // visor
    ctx.beginPath();
    ctx.arc(0.13 * facing, -0.02, 0.075, 0, Math.PI * 2);
    ctx.fillStyle = '#23232a';
    ctx.fill();
  }
  ctx.restore();
}

// `back` (used by the mirror reflection) draws the rider's head from behind
function drawBike(ctx, bike, headless, back, lamps) {
  // turn-around animation: the rider and frame mirror smoothly through a
  // flat squash (with a little hop) over the 0.28 s after a flip
  const p = Math.min(1, (bike.turnT == null ? 1 : bike.turnT) / 0.28);
  const m = bike.facing * Math.sin((p - 0.5) * Math.PI);
  const hop = Math.sin(p * Math.PI) * 0.14;
  const cos = Math.cos(bike.angle), sin = Math.sin(bike.angle);
  const L = (lx, ly) => {
    lx *= m;
    ly -= hop;
    return {
      x: bike.pos.x + lx * cos - ly * sin,
      y: bike.pos.y + lx * sin + ly * cos,
    };
  };
  const rw = bike.wheels[bike.rearIndex];
  const fw = bike.wheels[1 - bike.rearIndex];

  for (const w of bike.wheels) drawWheel(ctx, w);

  ctx.lineCap = 'round';
  const pedal = L(0.02, 0.06);
  const seatB = L(-0.45, -0.45);
  const seatF = L(-0.02, -0.43);
  const handle = L(0.46, -0.44);
  const engine = L(0.06, -0.12);

  // frame
  strokeSeg(ctx, pedal, rw.pos, 0.09, '#b9b9b9');
  strokeSeg(ctx, handle, fw.pos, 0.07, '#b9b9b9');
  strokeSeg(ctx, pedal, seatF, 0.07, '#b9b9b9');
  strokeSeg(ctx, pedal, handle, 0.06, '#a5a5a5');
  strokeSeg(ctx, seatB, seatF, 0.13, '#d9d9d9');
  ctx.fillStyle = '#8d8d8d';
  ctx.beginPath();
  ctx.arc(engine.x, engine.y, 0.14, 0, Math.PI * 2);
  ctx.fill();

  // rider
  const hip = L(-0.30, -0.46);
  const shoulder = L(-0.11, -0.76);
  const knee = L(0.14, -0.30);
  const foot = L(0.03, 0.02);
  strokeSeg(ctx, hip, knee, 0.11, '#15151a');
  strokeSeg(ctx, knee, foot, 0.09, '#15151a');
  strokeSeg(ctx, hip, shoulder, 0.14, '#15151a');

  // The arm is two bones hinged at the elbow: an upper arm (shoulder→elbow) and
  // a forearm (elbow→hand). At rest the hand grips the bar; on a volt it flicks
  // and returns within one volt interval (the whole arc inside the window), the
  // direction set by which way the rider is volting — see the two branches below.
  // voltCd is re-armed to voltEvery the instant a volt fires and only ticks down
  // after, so voltEvery - voltCd is the time since that volt.
  const VOLT_PUMP = 0.5;  // arm-flick duration (cosmetic flourish, longer than
                          // the snappy PHYS.voltDur boost — they're decoupled)
  const cd = bike.voltCd == null ? PHYS.voltEvery + 9 : bike.voltCd;
  const sinceVolt = PHYS.voltEvery - cd;
  const reach = sinceVolt >= 0 && sinceVolt < VOLT_PUMP
    ? Math.sin(Math.PI * sinceVolt / VOLT_PUMP) : 0;
  const restElbow = L(0.16, -0.56);
  const restHand = handle;  // at rest the hand grips the bar
  const foreLen = Math.hypot(restHand.x - restElbow.x, restHand.y - restElbow.y);
  // the flick depends on the volt direction. Everything below is built from L()
  // world points, so the swing follows the bike's tilt and mirrors with facing.
  let elbow, hand;
  if ((bike.voltDir || 0) >= 0) {
    // CLOCKWISE volt: the upper arm stays put and only the FOREARM swings UP —
    // a rigid bone rotated about the fixed elbow toward the helmet and back
    // (it keeps its length, so the hand swings on an arc, not a stretch). The
    // bar never moves; only the rider's hand leaves it.
    elbow = restElbow;
    const restA = Math.atan2(restHand.y - elbow.y, restHand.x - elbow.x);
    const headPt = L(PHYS.headX + 0.14, PHYS.headY + 0.08); // front of the helmet
    let dA = Math.atan2(headPt.y - elbow.y, headPt.x - elbow.x) - restA;
    dA -= Math.PI * 2 * Math.floor((dA + Math.PI) / (Math.PI * 2)); // shortest turn
    // a little less than the full elbow→helmet turn so it stops shy of the head
    const a = restA + dA * 0.85 * reach;
    hand = { x: elbow.x + Math.cos(a) * foreLen, y: elbow.y + Math.sin(a) * foreLen };
  } else {
    // COUNTER-CLOCKWISE volt: the WHOLE arm swings off the bar, down and back
    // toward the rider's seat — a "slap the butt" flick — then returns. Both
    // bones rotate rigidly about the shoulder (keeping their shape and length),
    // aimed from the bar toward the butt.
    const butt = L(-0.42, -0.40);  // slap target (rear of the seat)
    const restArmA = Math.atan2(restHand.y - shoulder.y, restHand.x - shoulder.x);
    let dArm = Math.atan2(butt.y - shoulder.y, butt.x - shoulder.x) - restArmA;
    dArm -= Math.PI * 2 * Math.floor((dArm + Math.PI) / (Math.PI * 2)); // shortest turn
    const rot = dArm * 0.95 * reach;  // rigid swing of the whole arm
    const c = Math.cos(rot), s = Math.sin(rot);
    const swing = (pt) => ({
      x: shoulder.x + (pt.x - shoulder.x) * c - (pt.y - shoulder.y) * s,
      y: shoulder.y + (pt.x - shoulder.x) * s + (pt.y - shoulder.y) * c,
    });
    elbow = swing(restElbow);
    hand = swing(restHand);
  }
  strokeSeg(ctx, shoulder, elbow, 0.10, '#15151a'); // upper arm

  if (!headless) {
    const head = L(PHYS.headX, PHYS.headY);
    drawHead(ctx, head.x, head.y, m, bike.angle, back);
  }
  // forearm is drawn last, OVER the helmet, so the raised volt hand passes
  // in front of the head instead of disappearing behind it
  strokeSeg(ctx, elbow, hand, 0.08, '#15151a');     // forearm

  // headlight (front) and taillight (rear) — the cave world equips the bike
  // with lamps; the big illuminating beams are the darkness pass, here we draw
  // the physical lamps and their close glow. Anchored in local frame coords via
  // L() so they ride the bike's tilt and flip with its facing.
  if (lamps) {
    const hl = L(0.56, -0.26), tl = L(-0.5, -0.42);
    const hg = ctx.createRadialGradient(hl.x, hl.y, 0, hl.x, hl.y, 0.34);
    hg.addColorStop(0, 'rgba(255,246,206,0.75)');
    hg.addColorStop(1, 'rgba(255,246,206,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(hl.x, hl.y, 0.34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a2a30';
    ctx.beginPath(); ctx.arc(hl.x, hl.y, 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff6cf';
    ctx.beginPath(); ctx.arc(hl.x, hl.y, 0.06, 0, Math.PI * 2); ctx.fill();
    const tg = ctx.createRadialGradient(tl.x, tl.y, 0, tl.x, tl.y, 0.22);
    tg.addColorStop(0, 'rgba(255,72,60,0.6)');
    tg.addColorStop(1, 'rgba(255,72,60,0)');
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.arc(tl.x, tl.y, 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a2a30';
    ctx.beginPath(); ctx.arc(tl.x, tl.y, 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff5347';
    ctx.beginPath(); ctx.arc(tl.x, tl.y, 0.05, 0, Math.PI * 2); ctx.fill();
  }
}

function fmt(t) {
  const cs = Math.floor(t * 100 + 1e-6);
  const m = Math.floor(cs / 6000);
  const s = Math.floor(cs / 100) % 60;
  const h = cs % 100;
  return String(m).padStart(2, '0') + ':' +
         String(s).padStart(2, '0') + ',' +
         String(h).padStart(2, '0');
}

// rising "+N" toast for a style award: pops in with a little overshoot,
// then fades out at the end of its ride (the caller moves it upward).
// `zoom` is the world scale, so the lettering tracks the window size
const STYLE_POPUP_DUR = 0.9;

function drawStylePopup(ctx, x, y, text, age, zoom) {
  if (age >= STYLE_POPUP_DUR) return;
  const pop = easeOutBack(Math.min(1, age / 0.14));
  const fade = Math.min(1, (STYLE_POPUP_DUR - age) / 0.25);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pop, pop);
  ctx.globalAlpha = Math.max(0, fade);
  ctx.font = `bold ${Math.max(16, Math.round(zoom * 0.62))}px "Consolas","Courier New",monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, zoom * 0.12);
  ctx.strokeStyle = 'rgba(40,16,4,0.85)';
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = '#ffd84d';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// the floating crash/finish panel. The sub line carries time/style and a
// what-to-do hint, which is long, so it wraps to as many lines as it needs
// and the panel grows upward from a fixed bottom — keeping the touch SAVE
// REPLAY button (anchored just below) clear no matter how tall it gets.
// `bottomY` overrides that bottom anchor (the touch crash/finish screens pass
// the top of the SAVE REPLAY button so the panel always sits just above it).
function centerMsg(ctx, W, H, title, sub, sub2, bottomY) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const mono = 'px "Consolas","Courier New",monospace';
  const pw = Math.min(safeBandW(W) * 0.9, 560), innerW = pw - 40;

  const titlePx = fitFont(ctx, title, innerW, 30, 'bold', 16);
  ctx.font = '16' + mono;
  const subLines = sub ? wrapLines(ctx, sub, innerW) : [];
  const sub2Px = sub2 ? fitFont(ctx, sub2, innerW, 15, 'bold', 11) : 0;

  const rows = [{ text: title, font: 'bold ' + titlePx + mono, fill: '#f9c623', h: titlePx + 14 }];
  for (const line of subLines) rows.push({ text: line, font: '16' + mono, fill: '#f0e8da', h: 24 });
  if (sub2) rows.push({ text: sub2, font: 'bold ' + sub2Px + mono, fill: '#9be08a', h: sub2Px + 12 });

  const ph = rows.reduce((s, r) => s + r.h, 0) + 28;
  const bottom = bottomY != null ? bottomY : H * 0.36 + 142;
  const py = Math.max(8 + SAFE.top, bottom - ph);
  const px = safeCenterX(W, pw), cx = px + pw / 2;
  ctx.fillStyle = 'rgba(20,12,6,0.78)';
  roundRectPath(ctx, px, py, pw, ph, 12);
  ctx.fill();

  let y = py + 14;
  for (const r of rows) {
    ctx.fillStyle = r.fill;
    ctx.font = r.font;
    ctx.fillText(r.text, cx, y + r.h / 2);
    y += r.h;
  }
  ctx.restore();
}

// The pre-ride briefing. Title, map name, a hovering burger, the controls,
// and the go hint — all measured first so the panel is sized to its contents
// and the long instruction sentences wrap (instead of clipping) on a narrow
// phone, with the whole panel kept on-screen even in short landscape.
function drawReady(ctx, W, H, mapLabel, touch) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const mono = 'px "Consolas","Courier New",monospace';
  const pw = Math.min(safeBandW(W) * 0.92, 600), innerW = pw - 48;
  const cx = safeCenterX(W, pw) + pw / 2;          // panel centre (clear of cutouts)

  const titlePx = fitFont(ctx, 'GET READY!', innerW, Math.min(52, W * 0.14), 'bold', 26);
  const mapPx = mapLabel ? fitFont(ctx, mapLabel, innerW, 18, 'bold', 12) : 0;
  const goText = touch ? 'Tap anywhere to ride' : 'Press any key to ride';
  const footPx = fitFont(ctx, goText, innerW, 19, 'bold', 13);
  const raw = touch ? [
    'Collect every triple cheeseburger, then ride to the popcorn.', '',
    'Right thumb: gas and brake - left thumb: lean',
    'Double arrow turns around - top buttons pause and restart',
  ] : [
    'Collect every triple cheeseburger, then ride to the popcorn.', '',
    'UP gas   DOWN brake   LEFT / RIGHT rotate',
    'SPACE turn around   ESC pause   M sound',
  ];
  let instrPx = 16, lineH = 23;
  ctx.font = instrPx + mono;
  const lines = [];
  for (const t of raw) {
    if (!t) { lines.push(''); continue; }
    for (const w of wrapLines(ctx, t, innerW)) lines.push(w);
  }
  let iconS = Math.max(18, Math.min(42, W * 0.1, H * 0.07));

  // usable height between the top notch and bottom home-indicator insets
  const availH = H - SAFE.top - SAFE.bottom;

  // vertical stack: title, [map], burger, instructions, footer. Sized to
  // its contents; if even that overruns a short screen, the blank spacer
  // and then the (decorative) burger are dropped, and finally the instruction
  // type itself shrinks, so nothing clips on a short landscape phone.
  const padTop = 20, padBot = 20, g = 12;
  let blankH = 10, iconH = iconS * 1.5;
  const measure = () => {
    const instrH = lines.reduce((s, t) => s + (t ? lineH : blankH), 0);
    const hs = [titlePx, mapLabel ? mapPx + 4 : 0, iconH, instrH, footPx + 6];
    const n = hs.filter(h => h > 0).length;
    return padTop + padBot + g * (n - 1) + hs.reduce((a, b) => a + b, 0);
  };
  let ph = measure();
  if (ph > availH - 16) { blankH = 2; ph = measure(); }
  if (ph > availH - 16) { iconH = 0; ph = measure(); }
  if (ph > availH - 16) {
    // last resort: scale the instruction lines down to claw back the overflow
    const instrH = lines.reduce((s, t) => s + (t ? lineH : blankH), 0);
    const k = Math.max(0.6, (instrH - (ph - (availH - 16))) / instrH);
    lineH = Math.max(15, lineH * k);
    instrPx = Math.max(12, Math.round(instrPx * k));
    ph = measure();
  }

  let py = SAFE.top + Math.min(availH * 0.16, (availH - ph) / 2);
  py = Math.max(SAFE.top + 8, Math.min(py, H - SAFE.bottom - ph - 8));
  ctx.fillStyle = 'rgba(20,12,6,0.82)';
  roundRectPath(ctx, safeCenterX(W, pw), py, pw, ph, 16);
  ctx.fill();

  let y = py + padTop;
  const block = h => { const cy = y + h / 2; y += h + g; return cy; };

  let cy = block(titlePx);
  ctx.font = 'bold ' + titlePx + mono;
  ctx.fillStyle = '#5d2f17';
  ctx.fillText('GET READY!', cx + 3, cy + 3);
  ctx.fillStyle = '#f9c623';
  ctx.fillText('GET READY!', cx, cy);

  if (mapLabel) {
    cy = block(mapPx + 4);
    ctx.font = 'bold ' + mapPx + mono;
    ctx.fillStyle = '#9be08a';
    ctx.fillText(mapLabel, cx, cy);
  }

  if (iconH > 0) {
    cy = block(iconH);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(iconS, iconS);
    drawBurger(ctx, 0, 0.1, performance.now() / 1000);
    ctx.restore();
  }

  const instrH = lines.reduce((s, t) => s + (t ? lineH : blankH), 0);
  const instrTop = y;
  block(instrH);
  ctx.font = instrPx + mono;
  ctx.fillStyle = '#f0e8da';
  let ly = instrTop;
  for (const t of lines) {
    if (t) ctx.fillText(t, cx, ly + lineH / 2);
    ly += t ? lineH : blankH;
  }

  cy = block(footPx + 6);
  ctx.font = 'bold ' + footPx + mono;
  ctx.fillStyle = '#9be08a';
  ctx.fillText(goText, cx, cy);
  ctx.restore();
}

// ---------- intro animation, game menu, pause overlay ----------

// timing constants for the title fly-in; game.js uses these to cue sounds
const TITLE_ANIM = {
  lines: ['BURGER', 'MANIA'],
  count: 11,     // total letters
  delay: 0.4,    // s before the first letter launches
  stagger: 0.14, // s between letter launches
  fly: 0.55,     // s a letter spends in flight
  dur: 3.0,      // s until the menu fades in
};

function easeOutBack(p) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}

function titleLayout(W, H) {
  const fs = Math.min(W / 8.5, H / 5.2);
  const letters = [];
  TITLE_ANIM.lines.forEach((line, li) => {
    const cw = fs * 0.68;
    const y = H * 0.22 + li * fs * 1.05;
    const x0 = W / 2 - (line.length - 1) * cw / 2;
    for (let c = 0; c < line.length; c++) {
      letters.push({ ch: line[c], x: x0 + c * cw, y, li });
    }
  });
  return { letters, fs };
}

function drawTitleLetters(ctx, W, H, t) {
  const { letters, fs } = titleLayout(W, H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(fs)}px "Consolas","Courier New",monospace`;
  letters.forEach((L, i) => {
    const p = (t - TITLE_ANIM.delay - i * TITLE_ANIM.stagger) / TITLE_ANIM.fly;
    if (p <= 0) return;
    let x = L.x, y = L.y, rot = 0, sc = 1;
    if (p < 1) {
      // dive in spinning from a per-letter off-screen point, with overshoot
      const e = easeOutBack(p);
      const ang = srand(i * 3.1 + 7) * Math.PI * 2;
      const sx = W / 2 + Math.cos(ang) * W * 0.75;
      const sy = H / 2 + Math.sin(ang) * H * 0.9 - H * 0.2;
      x = sx + (L.x - sx) * e;
      y = sy + (L.y - sy) * e;
      rot = (srand(i * 5.7 + 2) - 0.5) * 9 * (1 - e);
      sc = 2.4 + (1 - 2.4) * e;
    } else {
      // settled: gentle bob and sway
      y += Math.sin(t * 2.3 + i * 0.8) * fs * 0.02;
      rot = Math.sin(t * 1.6 + i * 1.3) * 0.05;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(sc, sc);
    ctx.fillStyle = 'rgba(40,16,4,0.85)';
    ctx.fillText(L.ch, fs * 0.05, fs * 0.06);
    ctx.fillStyle = L.li === 0 ? '#f9c623' : '#ff6038';
    ctx.fillText(L.ch, 0, 0);
    ctx.lineWidth = Math.max(1, fs * 0.025);
    ctx.strokeStyle = 'rgba(60,24,6,0.9)';
    ctx.strokeText(L.ch, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

// 0..1 openness of the homage bubble along the ascent (q is 0..1 progress):
// it pops open a little before the midpoint, holds for ~2s, then tucks
// closed again well before the sprite slips off the top of the screen
function astroBubbleOpenness(q) {
  const o0 = 0.34, o1 = 0.43, c0 = 0.62, c1 = 0.70;
  if (q <= o0 || q >= c1) return 0;
  if (q < o1) return easeOutBack((q - o0) / (o1 - o0));
  if (q < c0) return 1;
  return 1 - (q - c0) / (c1 - c0);
}

// the little comic speech bubble the astronaut blurts out; it grows open
// from anchorY (the top of the sprite, in the sprite's local frame) by
// openness op (0..1), staying upright while the sprite itself tumbles
function astroBubble(ctx, anchorY, op, unit) {
  const text = "It's an homage";
  const fs = unit * 0.42;
  ctx.save();
  ctx.font = `700 ${fs}px "Comic Sans MS","Trebuchet MS",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  const padX = fs * 0.6, padY = fs * 0.45;
  const bw = tw + padX * 2, bh = fs + padY * 2;
  const tail = unit * 0.5, baseW = unit * 0.28, gap = unit * 0.12;

  // grow out of the sprite's top: scale the whole bubble up from the tail tip
  ctx.translate(0, anchorY - gap);
  ctx.scale(op, op);
  const boxBottom = -tail, by = -(tail + bh), bx = -bw / 2;

  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(fs * 0.09, 0.02);
  ctx.strokeStyle = 'rgba(40,28,16,0.9)';
  ctx.fillStyle = 'rgba(255,255,255,0.96)';

  // tail first, then the rounded box laid over its base for a clean join
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-baseW / 2, boxBottom);
  ctx.lineTo(baseW / 2, boxBottom);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  roundRectPath(ctx, bx, by, bw, bh, fs * 0.55);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(35,25,15,0.96)';
  ctx.fillText(text, 0, by + bh / 2);
  ctx.restore();
}

// Every so often a tiny astronaut drifts up from behind the hills, tumbling
// as it climbs into the sky and off the top of the screen. Halfway up it
// pops a little speech bubble — "It's an homage" — then tucks it away again
// before it leaves. Drawn deep in the backdrop (behind the hills and haze)
// so it reads as far off in the distance. Menu only — not the continue
// screen, which shares this same world.
function drawMenuAstro(ctx, w, h, t) {
  // Hold the gag back for a while after the menu first opens (t is clocked
  // from when the player dismissed the loading overlay), so the very first
  // thing on screen is the calm scene, not the astronaut popping straight up.
  const DELAY = 30;
  const at = t - DELAY;  // astro-local time; nothing flies before it turns positive
  if (at < 0) return;
  const P = 26;          // one ascent roughly every P seconds
  const FLY = 11;        // seconds a single ascent lasts
  const lt = at % P;
  if (lt > FLY) return;  // resting between ascents
  const q = lt / FLY;    // 0..1 progress along the path
  const cyc = Math.floor(at / P);

  // per-ascent randomness, stable across frames within one ascent
  const r1 = srand(cyc * 1.7 + 0.3);
  const r2 = srand(cyc * 2.9 + 1.1);
  const r3 = srand(cyc * 4.3 + 2.7);
  const r4 = srand(cyc * 6.7 + 4.5);

  // path: climb from the horizon up past the top of the screen, with a slow
  // sideways drift and a gentle wander so no two ascents trace the same line
  const gy = h * 0.84;
  const x = w * (0.18 + r1 * 0.64) + (r2 - 0.5) * w * 0.6 * q
            + Math.sin(q * 3.2 + r3 * 6.283) * w * 0.05;
  const y = gy - (gy + h * 0.22) * Math.pow(q, 0.9);

  // small and shrinking as it recedes; spins either way by a random amount
  const size = (0.65 + r4 * 0.4) * (1 - 0.3 * q);
  const spin = (0.25 + r3 * 1.1) * (r2 < 0.5 ? -1 : 1);

  ctx.save();
  ctx.translate(x, y);

  ctx.save();
  ctx.rotate(spin * lt);
  const img = IMAGES.astro;
  if (img && img.complete && img.naturalWidth > 0) {
    const ih = size, iw = ih * img.naturalWidth / img.naturalHeight;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
  } else {
    ctx.fillStyle = 'rgba(232,238,248,0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const op = astroBubbleOpenness(q);
  if (op > 0.001) astroBubble(ctx, -size * 0.5, op, Math.max(size, h * 0.05));
  ctx.restore();
}

// shared stage for the full-screen scene screens (the menu family and the
// victory feast): sky gradient, panning parallax scenery, drifting haze,
// and the grassy floor. Painted in world units onto an already-scaled
// context (w by h, ground top at gy); callers stage their own props over
// it. showAstro adds the rising-astronaut gag (menu scene only, never the
// in-level / continue backdrops)
function drawBackdropStage(ctx, w, h, gy, t, pat, showAstro) {
  ctx.fillStyle = skyGradient(ctx, pat, 0, gy);
  ctx.fillRect(0, 0, w, h);

  // far in the distance, behind the hills, the occasional rising astronaut
  if (showAstro) drawMenuAstro(ctx, w, h, t);

  // distant hills panning slowly past, then the drifting cloud layer
  const pan = t * 1.2;
  ctx.save();
  ctx.translate(-pan, 0);
  pat.background(ctx, { x0: pan, x1: pan + w, y0: 0, y1: gy }, t);
  ctx.restore();
  const sp = pat.skyPeriod; // sky pattern repeats every skyPeriod world units
  const drift = (t * 0.4) % sp;
  ctx.save();
  ctx.translate(-drift, 0);
  ctx.fillStyle = pat.sky;
  ctx.fillRect(0, 0, w + sp, h);
  ctx.restore();

  fillGround(ctx, pat, 0, gy, w, h - gy);
  pat.edge(ctx, { ax: 0, ay: gy, bx: w, by: gy }, pat, t);
}

// tumbling burgers drifting across the sky — the scene screens' confetti
function drawDriftingBurgers(ctx, w, h, t, n) {
  for (let i = 0; i < n; i++) {
    const sp = 1.2 + srand(i * 9.7) * 1.8;
    const span = w + 4;
    const x = ((t * sp + srand(i * 3.3) * span) % span) - 2;
    const y = h * (0.12 + srand(i * 6.1) * 0.55);
    const s = 0.5 + srand(i * 4.9) * 0.8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * (0.6 + srand(i) * 1.5) * (i % 2 ? 1 : -1));
    ctx.scale(s, s);
    drawBurger(ctx, 0, 0, t + i);
    ctx.restore();
  }
}

// animated scene behind the title, menu, and its sub-screens: drifting
// clouds, tumbling burgers, a grassy floor, and the popcorn bucket waiting on
// the right. showAstro adds the rising-astronaut gag (menu scene only, never
// the continue / in-level backdrops)
function drawMenuBackdrop(ctx, W, H, t, pat, showAstro) {
  const Z = Math.min(W / 26, H / 13.5);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.scale(Z, Z);
  const w = W / Z, h = H / Z;

  const gy = h * 0.84;
  drawBackdropStage(ctx, w, h, gy, t, pat, showAstro);

  ctx.save();
  ctx.translate(w * 0.86, gy - 1.05);
  ctx.scale(1.8, 1.8);
  drawPopcorn(ctx, 0, 0, t);
  ctx.restore();

  drawDriftingBurgers(ctx, w, h, t, 6);
  ctx.restore();
}

// button hitboxes, shared by rendering (here) and hit-testing (game.js).
// Rows are 56 tall with an 18 gap where there's room, but shrink to fit so
// a tall stack (e.g. the 4-item menu) never runs off a short phone; only if
// even the floor height overruns do we slide the stack up to avoid a clip.
function menuRects(W, H, n, y0) {
  const bw = Math.min(300, safeBandW(W) * 0.7);
  const x = safeCenterX(W, bw);
  const m = Math.max(12, H * 0.04) + SAFE.bottom;
  const avail = H - y0 - m;                       // room below the start
  let bh = Math.max(28, Math.min(56, avail / (n + (n - 1) * 0.32)));
  const gap = bh * 0.32;
  const total = n * bh + (n - 1) * gap;
  const top = total > avail ? Math.max(m, H - m - total) : y0;
  const rects = [];
  for (let i = 0; i < n; i++) rects.push({ x, y: top + i * (bh + gap), w: bw, h: bh });
  return rects;
}

// items are strings, or objects { label, sub?, color?, disabled? }
function drawButtons(ctx, rects, items, sel, hover, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  rects.forEach((r, i) => {
    const it = typeof items[i] === 'string' ? { label: items[i] } : items[i];
    const hot = !it.disabled && (i === sel || i === hover);
    ctx.save();
    if (it.disabled) ctx.globalAlpha = alpha * 0.45;
    if (hot) {
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.scale(1.06, 1.06);
      ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
    }
    ctx.fillStyle = hot ? 'rgba(70,34,10,0.92)' : 'rgba(20,12,6,0.82)';
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 12);
    ctx.fill();
    ctx.lineWidth = hot ? 3 : 2;
    ctx.strokeStyle = hot ? '#f9c623' : 'rgba(249,198,35,0.45)';
    ctx.stroke();
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const innerW = r.w - 24; // keep the lettering off the rounded corners
    ctx.fillStyle = hot ? '#ffe27a' : (it.color || '#f0e8da');
    if (it.sub) {
      // size and stack label/sub relative to the row so two-line buttons
      // stay inside even when the row is shrunk on a short screen
      fitFont(ctx, it.label, innerW, Math.min(22, r.h * 0.42), 'bold', 11);
      ctx.fillText(it.label, cx, cy - r.h * 0.16);
      ctx.fillStyle = hot ? '#f0e8da' : 'rgba(240,232,218,0.7)';
      fitFont(ctx, it.sub, innerW, Math.min(13, r.h * 0.28), '', 9);
      ctx.fillText(it.sub, cx, cy + r.h * 0.22);
    } else {
      fitFont(ctx, it.label, innerW, Math.min(24, r.h * 0.5), 'bold', 12);
      ctx.fillText(it.label, cx, cy + 1);
    }
    ctx.restore();
  });
  ctx.restore();
}

function drawMenu(ctx, W, H, alpha, items, sel, hover) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const rects = menuRects(W, H, items.length, H * 0.58);
  drawButtons(ctx, rects, items, sel, hover, alpha);
}

// small build stamp tucked into the bottom-left corner of the menu so the
// running physics version is always visible (records and replays are only
// comparable within one sim build). Insets by the safe area so a phone
// cutout never hides it.
function drawCornerTag(ctx, W, H, text) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '13px "Consolas","Courier New",monospace';
  const x = SAFE.left + 12, y = H - SAFE.bottom - 12;
  ctx.fillStyle = 'rgba(20,12,6,0.6)';
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = 'rgba(240,232,218,0.55)';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// the same track picker drives "Play" (title 'CHOOSE DIFFICULTY') and the
// Best Records screen (title 'BEST RECORDS'); tracks with no maps yet show
// disabled either way
function drawDifficulty(ctx, W, H, alpha, tracks, sel, hover, touch, title) {
  title = title || 'CHOOSE DIFFICULTY';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, title, safeBandW(W) * 0.9, 44, 'bold', 18);
  ctx.fillStyle = 'rgba(40,16,4,0.85)';
  ctx.fillText(title, W / 2 + 3, H * 0.20 + 3);
  ctx.fillStyle = '#f9c623';
  ctx.fillText(title, W / 2, H * 0.20);
  ctx.restore();

  const items = tracks.map(t => ({
    label: t.label,
    sub: t.levels.length ? t.length + ' maps' : 'Coming soon',
    color: t.color,
    disabled: !t.levels.length,
  }));
  const rects = menuRects(W, H, tracks.length, H * 0.34);
  drawButtons(ctx, rects, items, sel, hover, alpha);

  // touch devices get an on-screen back button instead of the Esc hint
  if (!touch) {
    const last = rects[rects.length - 1];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(40,20,8,0.85)';
    ctx.font = '15px "Consolas","Courier New",monospace';
    ctx.fillText('Esc to go back', W / 2, last.y + last.h + 34);
    ctx.restore();
  }
}

// the rider slumped over his bike, head hanging low — shown on the
// Continue? screen. (x, y) is where the wheels meet the ground.
function drawDejectedBiker(ctx, x, y, scale, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.translate(0, -PHYS.wheelR);

  const wheels = [
    { pos: { x: -0.62, y: 0 }, rot: 0.4 },
    { pos: { x: 0.62, y: 0 }, rot: 1.3 },
  ];
  for (const w of wheels) drawWheel(ctx, w);

  const br = Math.sin(t * 1.7) * 0.015; // slow, heavy breathing
  const P = (lx, ly) => ({ x: lx, y: ly - 0.40 });
  const pedal = P(0.02, 0.06), seatB = P(-0.45, -0.45), seatF = P(-0.02, -0.43);
  const handle = P(0.46, -0.44), engine = P(0.06, -0.12);

  ctx.lineCap = 'round';
  strokeSeg(ctx, pedal, wheels[0].pos, 0.09, '#b9b9b9');
  strokeSeg(ctx, handle, wheels[1].pos, 0.07, '#b9b9b9');
  strokeSeg(ctx, pedal, seatF, 0.07, '#b9b9b9');
  strokeSeg(ctx, pedal, handle, 0.06, '#a5a5a5');
  strokeSeg(ctx, seatB, seatF, 0.13, '#d9d9d9');
  ctx.fillStyle = '#8d8d8d';
  ctx.beginPath();
  ctx.arc(engine.x, engine.y, 0.14, 0, Math.PI * 2);
  ctx.fill();

  // slumped rider: hunched back, shoulders dropped over the bars
  const hip = P(-0.32, -0.42 + br);
  const shoulder = P(-0.04, -0.64 + br * 1.6);
  const knee = P(0.14, -0.28);
  const foot = P(0.03, 0.02);
  strokeSeg(ctx, hip, knee, 0.11, '#15151a');
  strokeSeg(ctx, knee, foot, 0.09, '#15151a');
  strokeSeg(ctx, hip, shoulder, 0.14, '#15151a');
  strokeSeg(ctx, shoulder, handle, 0.08, '#15151a');

  // head hanging below the shoulders, almost on the bars, swaying
  // with a slow, sorry little shake
  const head = P(0.20, -0.8 + br * 1.6);
  drawHead(ctx, head.x, head.y, 1, 1.05 + Math.sin(t * 0.9) * 0.07);
  ctx.restore();
}

function drawContinue(ctx, W, H, alpha, t, continuesLeft, sel, hover) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // somber dimming over the backdrop
  ctx.fillStyle = 'rgba(12,8,20,0.45)';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const heading = continuesLeft > 0 ? 'CONTINUE?' : 'YOU LOSE!';
  ctx.font = 'bold 52px "Consolas","Courier New",monospace';
  ctx.fillStyle = 'rgba(40,16,4,0.85)';
  ctx.fillText(heading, W / 2 + 3, H * 0.09 + 3);
  ctx.fillStyle = '#f9c623';
  ctx.fillText(heading, W / 2, H * 0.09);

  drawDejectedBiker(ctx, W / 2, H * 0.55, Math.min(W, H) / 5, t);
  ctx.restore();

  const items = [
    {
      label: 'Continue',
      sub: continuesLeft > 0 ? continuesLeft + ' left' : 'none left',
      disabled: !continuesLeft,
    },
    { label: 'Back to Menu' },
  ];
  drawButtons(ctx, menuRects(W, H, 2, H * 0.62), items, sel, hover, alpha);
}

// ---------- victory screen ----------

// the trusty bike parked beside the feast, leaning on its stand — the
// same frame the dejected pose uses, minus the rider
function drawParkedBike(ctx, x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.rotate(-0.05);
  ctx.translate(0, -PHYS.wheelR);

  const wheels = [
    { pos: { x: -0.62, y: 0 }, rot: 2.1 },
    { pos: { x: 0.62, y: 0 }, rot: 0.6 },
  ];
  const P = (lx, ly) => ({ x: lx, y: ly - 0.40 });
  const pedal = P(0.02, 0.06), seatB = P(-0.45, -0.45), seatF = P(-0.02, -0.43);
  const handle = P(0.46, -0.44), engine = P(0.06, -0.12);

  ctx.lineCap = 'round';
  // kickstand first so it tucks behind the frame
  strokeSeg(ctx, pedal, { x: 0.20, y: PHYS.wheelR }, 0.05, '#7d7d7d');
  for (const w of wheels) drawWheel(ctx, w);
  strokeSeg(ctx, pedal, wheels[0].pos, 0.09, '#b9b9b9');
  strokeSeg(ctx, handle, wheels[1].pos, 0.07, '#b9b9b9');
  strokeSeg(ctx, pedal, seatF, 0.07, '#b9b9b9');
  strokeSeg(ctx, pedal, handle, 0.06, '#a5a5a5');
  strokeSeg(ctx, seatB, seatF, 0.13, '#d9d9d9');
  ctx.fillStyle = '#8d8d8d';
  ctx.beginPath();
  ctx.arc(engine.x, engine.y, 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// The champion: sat low on the ground among the spoils, contently
// shoveling fistful after fistful of popcorn into his mouth, forever.
// (x, y) is the ground under his seat; he faces right, feast bucket over
// his ankles.
function drawVictoryBiker(ctx, x, y, scale, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // soft seat shadow
  ctx.fillStyle = 'rgba(40,20,8,0.20)';
  ctx.beginPath();
  ctx.ellipse(0.12, 0.01, 0.78, 0.085, 0, 0, Math.PI * 2);
  ctx.fill();

  const breathe = Math.sin(t * 1.9) * 0.012; // full and happy
  ctx.lineCap = 'round';

  // seated low on the ground: hips by the dirt, legs stretched out with
  // the knees easing up and apart, feet resting on the ground ahead
  const hip = { x: -0.12, y: -0.10 };
  for (const [kx, ky, fx, fy] of [[0.22, -0.24, 0.54, -0.05],
                                  [0.16, -0.18, 0.48, -0.02]]) {
    strokeSeg(ctx, hip, { x: kx, y: ky }, 0.11, '#15151a');
    strokeSeg(ctx, { x: kx, y: ky }, { x: fx, y: fy }, 0.09, '#15151a');
  }

  // the feast bucket, planted on the ground over his ankles
  ctx.save();
  ctx.translate(0.60, -0.44);
  ctx.scale(0.9, 0.9);
  drawPopcorn(ctx, 0, 0, t + 4.2);
  ctx.restore();

  // torso leaning back at ease, with a well-earned belly
  const shoulder = { x: -0.24, y: -0.50 + breathe };
  strokeSeg(ctx, hip, shoulder, 0.14, '#15151a');
  ctx.fillStyle = '#15151a';
  ctx.beginPath();
  ctx.arc(-0.02, -0.26 + breathe * 0.5, 0.17, 0, Math.PI * 2);
  ctx.fill();

  // the off arm, short and bent, props him up on the ground behind
  const propEl = { x: -0.42, y: -0.30 };
  strokeSeg(ctx, shoulder, propEl, 0.08, '#15151a');
  strokeSeg(ctx, propEl, { x: -0.50, y: -0.04 }, 0.08, '#15151a');

  // the shovel cycle: scoop off the rim, swing up, stuff, swing back —
  // a fistful and a half every second, continuously
  const p = (t * 1.4) % 1;
  const scoop = { x: 0.38, y: -0.42 };
  const mouth = { x: -0.02, y: -0.64 + breathe };
  const ease = q => q * q * (3 - 2 * q);
  let f; // 0 with the hand in the bucket, 1 at the mouth
  if (p < 0.4) f = ease(p / 0.4);                       // rise
  else if (p < 0.6) f = 1;                              // stuff it in
  else f = 1 - ease(Math.min(1, (p - 0.6) / 0.32));     // back for more
  // the forearm swings through an arc that bows outward
  const hand = {
    x: scoop.x + (mouth.x - scoop.x) * f + Math.sin(f * Math.PI) * 0.10,
    y: scoop.y + (mouth.y - scoop.y) * f - Math.sin(f * Math.PI) * 0.06,
  };
  const elbow = {
    x: (shoulder.x + hand.x) / 2 + 0.12,
    y: (shoulder.y + hand.y) / 2 + 0.16,
  };

  // the head goes down before the feeding arm, so the arm, the glove and
  // the fistful it carries all pass in FRONT of the face to the mouth
  const chew = f > 0.7 ? Math.sin(t * 26) * 0.05 : 0;
  drawHead(ctx, -0.15, -0.74 + breathe, 1, -0.14 + chew);

  strokeSeg(ctx, shoulder, elbow, 0.09, '#15151a');
  strokeSeg(ctx, elbow, hand, 0.08, '#15151a');

  // the fistful rides the hand up, then shrinks away as it's eaten
  const sz = p < 0.4 ? 0.075 : 0.075 * (0.55 - p) / 0.15;
  if (sz > 0.012) {
    drawKernel(ctx, hand.x + 0.02, hand.y - 0.06, sz, 3.1);
    drawKernel(ctx, hand.x - 0.05, hand.y - 0.02, sz * 0.8, 5.7);
  }
  // glove over the popcorn
  ctx.fillStyle = '#15151a';
  ctx.beginPath();
  ctx.arc(hand.x, hand.y, 0.065, 0, Math.PI * 2);
  ctx.fill();

  // a stray puff tumbles from the mouthful back into the grass
  if (p >= 0.42 && p < 0.92) {
    const q = (p - 0.42) / 0.5;
    drawKernel(ctx, mouth.x + 0.10 + q * 0.12, mouth.y + q * q * 0.85, 0.035, 9.3);
  }

  ctx.restore();
}

// A short landscape screen can't hold the centred scorecard: it would
// blanket the feast, bury the lower-left champion and run under the button.
// (Every phone in play is landscape — portrait shows the rotate prompt — so
// this is the live case on mobile; a small desktop window hits it too.) There
// we dock a slim card to the right half with the button beneath it; taller
// screens keep the roomy centred layout.
function victoryLandscape(W, H) { return W > H && H < 520; }

// Geometry of that right-docked card — a slim panel in the right half, clear
// of the rider, leaving a strip beneath for the button. Fixed to W/H/insets
// (not the row count) so victoryRects can place the button under it without
// knowing the scorecard's contents.
function victoryCardBox(W, H) {
  const x = SAFE.left + safeBandW(W) * 0.42;
  const w = safeBandW(W) * 0.56;
  const top = Math.max(H * 0.2, H * 0.08 + 62);     // below the title block
  const bottom = H - SAFE.bottom - 8 - 66;          // reserve a button band
  return { x, y: top, w, h: Math.max(60, bottom - top) };
}

// the victory screen's single button, shared with game.js for hit-testing
function victoryRects(W, H) {
  if (victoryLandscape(W, H)) {
    const card = victoryCardBox(W, H);
    const bw = Math.min(card.w, 280);
    const y = card.y + card.h + 10;
    const h = Math.min(52, Math.max(40, H - SAFE.bottom - 8 - y));
    return [{ x: card.x + (card.w - bw) / 2, y, w: bw, h }];
  }
  return menuRects(W, H, 1, H * 0.68);
}

// The per-map time/style table shared by the victory screen and the Best
// Records screen: a bordered panel `box`, a header row, one row per map
// (time/style right-aligned, the name clipped to its column), a summed total
// row once every map has a result, and the star legend when any score carries
// a record star. results[i] is { time, style, timeRecord?, styleRecord? } or
// null for a map with no score yet (shown as dashes). The caller sizes the box
// and picks rowH/fs so the same table fits the feast or a plain menu screen.
function drawScorecard(ctx, box, rowH, fs, names, results) {
  const complete = names.length > 0 && names.every((_, i) => results[i]);
  ctx.fillStyle = 'rgba(20,12,6,0.82)';
  roundRectPath(ctx, box.x, box.y, box.w, box.h, 12);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(249,198,35,0.45)';
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.font = `bold ${fs}px "Consolas","Courier New",monospace`;
  const nameX = box.x + 18;
  const styleR = box.x + box.w - 18;     // right edge of the style column
  const timeR = styleR - fs * 4.6;       // right edge of the time column
  let y = box.y + 12 + rowH / 2;

  ctx.fillStyle = 'rgba(240,232,218,0.55)';
  ctx.textAlign = 'left';
  ctx.fillText('map', nameX, y);
  ctx.textAlign = 'right';
  ctx.fillText('time', timeR, y);
  ctx.fillText('style', styleR, y);

  let sumT = 0, sumS = 0;
  for (let i = 0; i < names.length; i++) {
    y += rowH;
    const r = results[i];
    ctx.textAlign = 'left';
    ctx.fillStyle = r ? '#f0e8da' : 'rgba(240,232,218,0.4)';
    // clip the name to its column so a long map title can't run into the
    // time/star figures on a narrow phone
    ctx.fillText(ellipsize(ctx, `${String(i + 1).padStart(2)}  ${names[i]}`,
      timeR - fs * 6.3 - nameX), nameX, y);
    ctx.textAlign = 'right';
    if (!r) {
      // never cleared (skipped past, or a map without a record yet)
      ctx.fillText('--:--,--', timeR, y);
      ctx.fillText('---', styleR, y);
      continue;
    }
    sumT += r.time;
    sumS += r.style;
    // all-time records ride in starred gold; ordinary scores in parchment
    ctx.fillStyle = r.timeRecord ? '#f9c623' : '#f0e8da';
    ctx.fillText((r.timeRecord ? '★ ' : '') + fmt(r.time), timeR, y);
    ctx.fillStyle = r.styleRecord ? '#f9c623' : '#f0e8da';
    ctx.fillText((r.styleRecord ? '★ ' : '') + r.style, styleR, y);
  }

  if (complete) {
    y += rowH;
    ctx.strokeStyle = 'rgba(240,232,218,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(nameX, y - rowH / 2);
    ctx.lineTo(styleR, y - rowH / 2);
    ctx.stroke();
    ctx.fillStyle = '#ffe27a';
    ctx.textAlign = 'left';
    ctx.fillText('total', nameX, y);
    ctx.textAlign = 'right';
    ctx.fillText(fmt(sumT), timeR, y);
    ctx.fillText(String(sumS), styleR, y);
  }

  // legend, only when there's a star on the board to explain
  if (results.some(r => r && (r.timeRecord || r.styleRecord))) {
    y += rowH * 0.9;
    ctx.fillStyle = 'rgba(249,198,35,0.75)';
    ctx.font = `${Math.max(9, fs - 3)}px "Consolas","Courier New",monospace`;
    ctx.textAlign = 'right';
    ctx.fillText('★ all-time best', styleR, y);
  }
}

// The big one: every map of a difficulty track cleared. A sunny feast —
// the champion sat among buckets of popcorn, working through them — under
// the track scorecard (this run's time and style per map, with all-time
// records starred) and the way back to the menu.
// o: { t, pat, label, names, results, sel, hover, touch, saveNote }
function drawVictory(ctx, W, H, o) {
  const t = o.t || 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // ---------- the feast ----------
  const Z = Math.min(W / 26, H / 13.5);
  ctx.save();
  ctx.scale(Z, Z);
  const w = W / Z, h = H / Z, gy = h * 0.84;
  drawBackdropStage(ctx, w, h, gy, t, o.pat);
  drawDriftingBurgers(ctx, w, h, t, 4);

  // popcorn strewn across the whole meadow floor
  for (let i = 0; i < 70; i++) {
    const kx = srand(i * 3.17 + 0.7) * w;
    const ky = gy + 0.12 + srand(i * 7.31 + 2.1) * (h - gy - 0.3);
    drawKernel(ctx, kx, ky, 0.04 + srand(i * 5.7 + 1.3) * 0.05, i * 1.3);
  }

  // the bike parked off to the side, done for the season
  drawParkedBike(ctx, w * 0.86, gy, 1.5);

  // buckets surrounding the champion (x fraction, scale)
  const buckets = [[0.05, 1.5], [0.13, 1.9], [0.40, 1.55],
                   [0.56, 1.35], [0.67, 1.8], [0.95, 1.65]];
  for (let i = 0; i < buckets.length; i++) {
    const [fx, s] = buckets[i];
    ctx.save();
    ctx.translate(w * fx, gy - 0.59 * s);
    ctx.scale(s, s);
    drawPopcorn(ctx, 0, 0, t + i * 2.6);
    ctx.restore();
  }

  // one bucket tipped over mid-binge, its spill trailing toward the rider
  ctx.save();
  ctx.translate(w * 0.47, gy - 0.30);
  ctx.rotate(1.9);
  ctx.scale(1.3, 1.3);
  drawPopcorn(ctx, 0, -0.28, 2.0); // frozen: a downed bucket lies dead still
  ctx.restore();
  for (let i = 0; i < 8; i++) {
    drawKernel(ctx, w * 0.45 - i * 0.30 - srand(i * 8.1) * 0.2,
      gy + 0.10 + srand(i * 6.3) * 0.10, 0.05 + srand(i * 2.9) * 0.035, i * 7.7);
  }

  // the champion himself
  drawVictoryBiker(ctx, w * 0.27, gy + 0.02, 2.1, t);
  ctx.restore();

  // ---------- lettering ----------
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  const beat = 1 + Math.sin(t * 2.6) * 0.018; // swells with the song
  ctx.translate(W / 2, H * 0.08);
  ctx.scale(beat, beat);
  ctx.font = 'bold 52px "Consolas","Courier New",monospace';
  ctx.fillStyle = 'rgba(40,16,4,0.85)';
  ctx.fillText('VICTORY!', 3, 3);
  ctx.fillStyle = '#f9c623';
  ctx.fillText('VICTORY!', 0, 0);
  ctx.restore();

  // the green subtitle washes out against the bright sky, so lay it over a
  // dark outline halo for contrast before the green fill on top
  const sub = `Every ${o.label} map cleared!`;
  const subY = H * 0.08 + 42;
  fitFont(ctx, sub, safeBandW(W) * 0.9, 19, 'bold', 12);
  ctx.fillStyle = 'rgba(22,11,3,0.92)';
  for (const [dx, dy] of [[1.6, 1.6], [-1.6, 1.6], [1.6, -1.6], [-1.6, -1.6]]) {
    ctx.fillText(sub, W / 2 + dx, subY + dy);
  }
  ctx.fillStyle = '#caf0a2';
  ctx.fillText(sub, W / 2, subY);

  // ---------- the scorecard ----------
  const names = o.names || [], results = o.results || [];
  const complete = names.length > 0 && names.every((_, i) => results[i]);
  const rows = names.length + 1 + (complete ? 1 : 0); // + header (+ total)
  const rects = victoryRects(W, H);

  // short landscape: a slim card docked right, clear of the rider, button
  // beneath it. otherwise a centred card under the title, its bottom held
  // above the button so the two never collide.
  const side = victoryLandscape(W, H);
  let top, px, pw, availH, rowFloor;
  if (side) {
    const card = victoryCardBox(W, H);
    top = card.y; px = card.x; pw = card.w; availH = card.h; rowFloor = 9;
  } else {
    top = Math.max(H * 0.155, H * 0.08 + 56);
    pw = Math.min(safeBandW(W) * 0.88, 600);
    px = safeCenterX(W, pw);
    availH = Math.min(H * 0.645, rects[0].y - 14) - top; // above the button
    rowFloor = 13;
  }
  const rowH = Math.max(rowFloor, Math.min(27, (availH - 24) / (rows + 1.1)));
  const fs = Math.max(side ? 9 : 10, Math.round(rowH * 0.62));
  // the docked card fills its reserved box; the centred one hugs its rows
  const ph = side ? availH : rowH * (rows + 1.1) + 24;
  drawScorecard(ctx, { x: px, y: top, w: pw, h: ph }, rowH, fs, names, results);

  // ---------- the way home ----------
  drawButtons(ctx, rects, ['Back to Menu'], o.sel, o.hover, 1);

  const hint = o.touch
    ? (o.saveNote || '')
    : 'Enter for the menu' + (o.saveNote ? ' - ' + o.saveNote : '');
  if (hint) {
    ctx.fillStyle = 'rgba(40,20,8,0.85)';
    ctx.font = '15px "Consolas","Courier New",monospace';
    ctx.textAlign = 'center';
    ctx.fillText(hint, W / 2,
      Math.min(rects[0].y + rects[0].h + 26, H - SAFE.bottom - 10));
  }
  ctx.textAlign = 'left';
}

// The slow, dramatic crossfade from the frozen final frame of the last
// map into the victory feast. The scene renders into an offscreen buffer
// and blits at the fade alpha — pieces like drawPopcorn reset
// globalAlpha internally, so painting it directly would pop to opaque.
let _victoryBuf = null;
function drawVictoryFade(ctx, W, H, alpha, o) {
  if (alpha <= 0) return;
  if (!_victoryBuf) _victoryBuf = document.createElement('canvas');
  if (_victoryBuf.width !== W || _victoryBuf.height !== H) {
    _victoryBuf.width = W;
    _victoryBuf.height = H;
  }
  drawVictory(_victoryBuf.getContext('2d'), W, H, o);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(_victoryBuf, 0, 0);
  ctx.restore();
}

// ---------- best records screen ----------

// The Best Records scorecard's single Back button, pinned low so the table
// above it has room. Shared with game.js for hit-testing.
function recordsRects(W, H) {
  const bw = Math.min(300, safeBandW(W) * 0.7);
  const x = safeCenterX(W, bw);
  const m = Math.max(12, H * 0.04) + SAFE.bottom;
  const h = Math.max(34, Math.min(48, H * 0.1));
  return [{ x, y: H - m - h, w: bw, h }];
}

// The Best Records screen for one track: the player's all-time best time and
// style for every map, in the same scorecard the victory feast shows (no stars
// here — every figure already IS the all-time best). The backdrop is drawn by
// the caller, like the difficulty screen.
// o: { label, names, results, sel, hover, touch }
function drawRecords(ctx, W, H, alpha, o) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, 'BEST RECORDS', safeBandW(W) * 0.9, 44, 'bold', 18);
  ctx.fillStyle = 'rgba(40,16,4,0.85)';
  ctx.fillText('BEST RECORDS', W / 2 + 3, H * 0.12 + 3);
  ctx.fillStyle = '#f9c623';
  ctx.fillText('BEST RECORDS', W / 2, H * 0.12);
  if (o.label) {
    fitFont(ctx, o.label + ' track', safeBandW(W) * 0.9, 18, 'bold', 11);
    ctx.fillStyle = '#f0e8da';
    ctx.fillText(o.label + ' track', W / 2, H * 0.12 + 38);
  }
  ctx.restore();

  const names = o.names || [], results = o.results || [];
  const complete = names.length > 0 && names.every((_, i) => results[i]);
  const rows = names.length + 1 + (complete ? 1 : 0); // + header (+ total)
  const rects = recordsRects(W, H);

  // a centred card between the title and the Back button. Sizing mirrors the
  // victory scorecard: rows shrink to fit, with a smaller floor on a short
  // landscape phone so a full 12-row track still fits above the button.
  const short = W > H && H < 520;
  const top = Math.max(H * 0.24, H * 0.12 + 56);
  const pw = Math.min(safeBandW(W) * 0.88, 600);
  const px = safeCenterX(W, pw);
  const availH = (rects[0].y - 14) - top;
  const rowH = Math.max(short ? 9 : 13, Math.min(27, (availH - 24) / (rows + 1.1)));
  const fs = Math.max(short ? 9 : 10, Math.round(rowH * 0.62));
  const ph = Math.min(availH, rowH * (rows + 1.1) + 24);
  ctx.save();
  ctx.globalAlpha = alpha;
  drawScorecard(ctx, { x: px, y: top, w: pw, h: ph }, rowH, fs, names, results);
  ctx.restore();

  drawButtons(ctx, rects, ['Back'], o.sel, o.hover, alpha);
  if (!o.touch) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(40,20,8,0.85)';
    ctx.font = '15px "Consolas","Courier New",monospace';
    ctx.fillText('Esc to go back', W / 2,
      Math.min(rects[0].y + rects[0].h + 24, H - SAFE.bottom - 8));
    ctx.restore();
  }
}

function drawPause(ctx, W, H, items, sel, hover) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(8,5,2,0.55)';
  ctx.fillRect(0, 0, W, H);

  // the panel wraps the title and the button stack, which menuRects may
  // have shrunk or slid up on a short screen — so derive it from the rects
  // rather than a fixed fraction, keeping the title clear of the buttons
  const rects = menuRects(W, H, items.length, H * 0.46);
  const first = rects[0], last = rects[rects.length - 1];
  const pw = Math.min(W * 0.7, 460);
  const top = Math.max(8, first.y - 66);
  const bottom = Math.min(H - 8, last.y + last.h + 22);
  ctx.fillStyle = 'rgba(20,12,6,0.85)';
  roundRectPath(ctx, (W - pw) / 2, top, pw, bottom - top, 16);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f9c623';
  fitFont(ctx, 'PAUSED', pw - 40, 36, 'bold', 20);
  ctx.fillText('PAUSED', W / 2, first.y - 24);
  drawButtons(ctx, rects, items, sel, hover, 1);
}

// ---------- audio settings screen ----------

// shared by drawing and hit-testing (like menuRects): three slider rows
// plus a Back button. Each row rect is the hover/click target and its
// `bar` is the slider track inside it.
function audioRects(W, H) {
  const bw = Math.min(520, safeBandW(W) * 0.86);
  const x = safeCenterX(W, bw);
  const m = Math.max(12, H * 0.04) + SAFE.bottom;
  const top = SAFE.top + H * (H < 360 ? 0.20 : H < 430 ? 0.24 : 0.30); // higher on short screens
  const backH = Math.min(56, Math.max(44, H * 0.1));
  const reserve = backH + 46;              // gap to Back + the hint line below
  // shrink the three slider rows so they plus the Back button and hint fit
  const bh = Math.max(46, Math.min(68, (H - top - m - reserve - 2 * 12) / 3));
  const gap = Math.max(10, Math.min(16, bh * 0.2));
  let y = top;
  const rects = [];
  for (let i = 0; i < 3; i++) {
    rects.push({ x, y, w: bw, h: bh,
      bar: { x: x + 24, y: y + bh - 15, w: bw - 48, h: 8 } });
    y += bh + gap;
  }
  const backW = Math.min(240, safeBandW(W) * 0.7);
  rects.push({ x: safeCenterX(W, backW), y: y + 6, w: backW, h: backH }); // Back
  return rects;
}

const AUDIO_LABELS = ['Master', 'Music', 'Sound Effects'];

// o: { volume: {master, music, sfx}, sel, hover, dim, muted } — `dim`
// darkens the screen first, for when this sits over frozen gameplay
// like the pause menu
function drawAudio(ctx, W, H, alpha, o) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (o.dim) {
    ctx.fillStyle = 'rgba(8,5,2,0.55)';
    ctx.fillRect(0, 0, W, H);
  }
  const rects = audioRects(W, H);
  const back = rects[rects.length - 1];

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, 'AUDIO', safeBandW(W) * 0.9, 44, 'bold', 18);
  ctx.fillStyle = 'rgba(40,16,4,0.85)';
  ctx.fillText('AUDIO', W / 2 + 3, H * 0.16 + 3);
  ctx.fillStyle = '#f9c623';
  ctx.fillText('AUDIO', W / 2, H * 0.16);
  if (o.muted) {
    ctx.fillStyle = '#ff8a5c';
    ctx.font = 'bold 16px "Consolas","Courier New",monospace';
    ctx.fillText('muted - press M to unmute', W / 2, H * 0.16 + 38);
  }

  const vols = [o.volume.master, o.volume.music, o.volume.sfx];
  rects.slice(0, 3).forEach((r, i) => {
    const hot = i === o.sel || i === o.hover;
    ctx.fillStyle = hot ? 'rgba(70,34,10,0.92)' : 'rgba(20,12,6,0.82)';
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 12);
    ctx.fill();
    ctx.lineWidth = hot ? 3 : 2;
    ctx.strokeStyle = hot ? '#f9c623' : 'rgba(249,198,35,0.45)';
    ctx.stroke();

    ctx.font = 'bold 18px "Consolas","Courier New",monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = hot ? '#ffe27a' : '#f0e8da';
    ctx.fillText(AUDIO_LABELS[i], r.bar.x, r.y + 19);
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(vols[i] * 100) + '%', r.bar.x + r.bar.w, r.y + 19);

    const b = r.bar; // track, filled to the volume, with a knob on top
    ctx.fillStyle = 'rgba(240,232,218,0.25)';
    roundRectPath(ctx, b.x, b.y, b.w, b.h, b.h / 2);
    ctx.fill();
    if (vols[i] > 0) {
      ctx.fillStyle = hot ? '#f9c623' : 'rgba(249,198,35,0.8)';
      roundRectPath(ctx, b.x, b.y, Math.max(b.h, b.w * vols[i]), b.h, b.h / 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(b.x + b.w * vols[i], b.y + b.h / 2, 9, 0, Math.PI * 2);
    ctx.fillStyle = hot ? '#ffe27a' : '#f0e8da';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(40,16,4,0.8)';
    ctx.stroke();
  });
  ctx.restore();

  drawButtons(ctx, [back], ['Back'],
    o.sel === 3 ? 0 : -1, o.hover === 3 ? 0 : -1, alpha);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = o.dim ? 'rgba(240,232,218,0.75)' : 'rgba(40,20,8,0.85)';
  const hint = o.touch ? 'Drag the sliders - tap Back when done'
    : 'Arrows adjust - M mutes - Esc to go back';
  fitFont(ctx, hint, safeBandW(W) * 0.92, 15, '', 11);
  ctx.fillText(hint, W / 2, Math.min(back.y + back.h + 22, H - SAFE.bottom - 10));
  ctx.restore();
}

// ---------- replays screen ----------

const REPLAY_VIS = 6; // list rows visible at once
const SKIP_VIS = 6;   // skip-cheat level-picker rows visible at once

function replayRects(W, H, n, y0) {
  const bw = Math.min(560, safeBandW(W) * 0.86);
  const x = safeCenterX(W, bw);
  const m = Math.max(12, H * 0.1) + SAFE.bottom;  // room below for the bottom hints / back
  // rows are 52 tall where there's room, shrinking so the window fits a
  // short (landscape) screen instead of running its last rows off the edge
  const bh = Math.max(30, Math.min(52, (H - y0 - m) / (n + (n - 1) * 0.23)));
  const gap = bh * 0.23;
  const rects = [];
  for (let i = 0; i < n; i++) rects.push({ x, y: y0 + i * (bh + gap), w: bw, h: bh });
  return rects;
}

// items render through drawButtons; the list shows a REPLAY_VIS-row
// window and `scroll` is the index of the first visible item
function drawReplays(ctx, W, H, alpha, items, sel, scroll, hover, note, touch) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, 'REPLAYS', safeBandW(W) * 0.9, 44, 'bold', 18);
  ctx.fillStyle = 'rgba(40,16,4,0.85)';
  ctx.fillText('REPLAYS', W / 2 + 3, H * 0.13 + 3);
  ctx.fillStyle = '#f9c623';
  ctx.fillText('REPLAYS', W / 2, H * 0.13);
  ctx.restore();

  const y0 = H * 0.22;
  const vis = items.slice(scroll, scroll + REPLAY_VIS);
  const rects = replayRects(W, H, vis.length, y0);
  drawButtons(ctx, rects, vis, sel - scroll, hover, alpha);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(249,198,35,0.8)';
  ctx.font = 'bold 16px "Consolas","Courier New",monospace';
  if (scroll > 0) ctx.fillText('- more -', W / 2, y0 - 16);
  if (scroll + REPLAY_VIS < items.length && rects.length) {
    const last = rects[rects.length - 1];
    ctx.fillText('- more -', W / 2, Math.min(last.y + last.h + 14, H - SAFE.bottom - 8));
  }
  if (note) {
    ctx.fillStyle = '#f0e8da';
    ctx.font = '15px "Consolas","Courier New",monospace';
    ctx.fillText(note, W / 2, H * 0.90);
  }
  if (!touch) {
    ctx.fillStyle = 'rgba(40,20,8,0.85)';
    ctx.font = '15px "Consolas","Courier New",monospace';
    ctx.fillText('Esc to go back', W / 2, H * 0.95);
  }
  ctx.restore();
}

// ---------- skip-cheat level picker ----------

// The "skip" dev cheat's overlay: a windowed list of a track's maps drawn
// over a dimmed copy of whatever screen summoned it (the menu, or a frozen
// level). Shares replayRects/drawButtons with the Replays list; SKIP_VIS
// rows show at once and `scroll` is the index of the first visible map.
// o: { items, sel, scroll, hover, label, touch }
function drawLevelSelect(ctx, W, H, alpha, o) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // darken the summoning screen so the picker reads as an overlay
  ctx.fillStyle = 'rgba(8,5,2,0.62)';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, 'SKIP TO MAP', safeBandW(W) * 0.9, 44, 'bold', 18);
  ctx.fillStyle = 'rgba(40,16,4,0.85)';
  ctx.fillText('SKIP TO MAP', W / 2 + 3, H * 0.13 + 3);
  ctx.fillStyle = '#f9c623';
  ctx.fillText('SKIP TO MAP', W / 2, H * 0.13);
  if (o.label) {
    fitFont(ctx, o.label + ' track', safeBandW(W) * 0.9, 18, 'bold', 11);
    ctx.fillStyle = '#f0e8da';
    ctx.fillText(o.label + ' track', W / 2, H * 0.13 + 40);
  }
  ctx.restore();

  const y0 = H * 0.24;
  const vis = o.items.slice(o.scroll, o.scroll + SKIP_VIS);
  const rects = replayRects(W, H, vis.length, y0);
  drawButtons(ctx, rects, vis, o.sel - o.scroll, o.hover, alpha);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(249,198,35,0.8)';
  ctx.font = 'bold 16px "Consolas","Courier New",monospace';
  if (o.scroll > 0) ctx.fillText('- more -', W / 2, y0 - 16);
  if (o.scroll + SKIP_VIS < o.items.length && rects.length) {
    const last = rects[rects.length - 1];
    ctx.fillText('- more -', W / 2, Math.min(last.y + last.h + 14, H - SAFE.bottom - 8));
  }
  if (!o.touch) {
    ctx.fillStyle = 'rgba(240,232,218,0.85)';
    ctx.font = '15px "Consolas","Courier New",monospace';
    ctx.fillText('Esc to go back', W / 2, H * 0.95);
  }
  ctx.restore();
}

// ---------- minimap ----------

function levelBounds(level) {
  if (level._bounds) return level._bounds;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of level.polygons) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  level._bounds = { minX, minY, maxX, maxY };
  return level._bounds;
}

// Corner map in the top-right: a fixed-size window of world space that
// follows the rider, so the scale stays readable no matter how large the
// map is. Shows the terrain silhouette with dots for pickups, the goal,
// and the rider.
const MAP_VIEW = { w: 64, h: 30 }; // world units the window always covers

// the minimap's screen box, shared so the HUD can tuck the level label
// directly beneath it without overlapping the panel
function minimapRect(W, H) {
  const s = Math.min(Math.min(W * 0.32, 320) / MAP_VIEW.w,
                     Math.min(H * 0.26, 150) / MAP_VIEW.h);
  const mw = MAP_VIEW.w * s, mh = MAP_VIEW.h * s;
  return { s, mw, mh, mx: W - mw - 14 - SAFE.right, my: 12 + SAFE.top };
}

function drawMinimap(ctx, W, H, level, o) {
  const b = levelBounds(level);
  const pad = 1; // world units of breathing room at the level edges
  const { s, mw, mh, mx, my } = minimapRect(W, H);

  // window origin: centered on the rider, clamped to the level bounds;
  // a level smaller than the window sits centered inside it instead
  const win = (c, lo, hi, span) => hi - lo <= span
    ? (lo + hi - span) / 2
    : Math.max(lo, Math.min(hi - span, c - span / 2));
  const wx = win(o.pos.x, b.minX - pad, b.maxX + pad, MAP_VIEW.w);
  const wy = win(o.pos.y, b.minY - pad, b.maxY + pad, MAP_VIEW.h);
  const tx = x => mx + (x - wx) * s;
  const ty = y => my + (y - wy) * s;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.88;

  roundRectPath(ctx, mx - 3, my - 3, mw + 6, mh + 6, 6);
  ctx.fillStyle = 'rgba(20,12,6,0.82)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(249,198,35,0.45)';
  ctx.stroke();

  roundRectPath(ctx, mx, my, mw, mh, 4);
  ctx.clip();

  // ground everywhere, then carve out the playable sky
  ctx.fillStyle = o.theme.miniGround;
  ctx.fillRect(mx, my, mw, mh);
  ctx.beginPath();
  for (const poly of level.polygons) {
    ctx.moveTo(tx(poly[0][0]), ty(poly[0][1]));
    for (let i = 1; i < poly.length; i++) ctx.lineTo(tx(poly[i][0]), ty(poly[i][1]));
    ctx.closePath();
  }
  ctx.fillStyle = o.theme.miniSky;
  ctx.fill('evenodd');

  const dot = (x, y, r, fill) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };

  for (const bu of o.burgers) {
    if (!bu.got) dot(tx(bu.x), ty(bu.y), 2.2, '#f9c623');
  }
  for (const n of o.nuts || []) dot(tx(n[0]), ty(n[1]), 2.4, '#b07a32');
  dot(tx(o.goal[0]), ty(o.goal[1]), 2.6, '#c8202a');

  // rider: white dot with a soft pulse so it reads at a glance
  const px = tx(o.pos.x), py = ty(o.pos.y);
  const pulse = 2.6 + Math.sin(o.t * 6) * 0.5;
  dot(px, py, pulse + 1.4, 'rgba(255,255,255,0.35)');
  dot(px, py, pulse, '#ffffff');

  ctx.restore();
}

// one reusable offscreen buffer for the life heads: we draw the head, then
// paint the shimmer/shading onto it with 'source-atop' so the light only
// lands on the head's pixels (not the transparent surround) before blitting
let _headBuf = null;
function lifeHeadBuffer(w, h) {
  if (!_headBuf) _headBuf = document.createElement('canvas');
  if (_headBuf.width !== w || _headBuf.height !== h) {
    _headBuf.width = w;
    _headBuf.height = h;
  }
  return _headBuf;
}

// a single "remaining life" head: bobs/sways/tilts slowly, casts a soft
// ground shadow that breathes with the bob, and catches a shine that sweeps
// across every few seconds. `i` phase-offsets each head so a row of them
// drifts out of lockstep.
function drawLifeHead(ctx, img, x, y, w, h, t, i) {
  const ph = i * 1.7;
  const bob = Math.sin(t * 1.5 + ph) * h * 0.10;     // vertical drift
  const sway = Math.sin(t * 0.9 + ph * 1.3) * w * 0.04;
  const tilt = Math.sin(t * 1.1 + ph) * 0.05;        // gentle head nod (rad)
  const cx = x + w / 2 + sway, cy = y + h / 2 + bob;

  // ground shadow on the resting baseline: bigger/darker when the head dips
  // toward it, smaller/fainter as it lifts away
  const dip = bob / (h * 0.10);                       // -1 (up) .. 1 (down)
  const ss = 1 + dip * 0.18;
  ctx.save();
  ctx.fillStyle = `rgba(40,20,8,${0.22 + dip * 0.06})`;
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h * 0.99, w * 0.40 * ss, h * 0.10 * ss, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const buf = lifeHeadBuffer(Math.ceil(w), Math.ceil(h));
  const bc = buf.getContext('2d');
  bc.clearRect(0, 0, buf.width, buf.height);
  bc.drawImage(img, 0, 0, w, h);
  bc.globalCompositeOperation = 'source-atop';

  // static modelling light: lit crown, shaded jaw, for a touch of volume
  const sh = bc.createLinearGradient(0, 0, 0, h);
  sh.addColorStop(0, 'rgba(255,250,235,0.16)');
  sh.addColorStop(0.5, 'rgba(255,255,255,0)');
  sh.addColorStop(1, 'rgba(20,10,4,0.20)');
  bc.fillStyle = sh;
  bc.fillRect(0, 0, w, h);

  // shine: a diagonal highlight band sweeps left-to-right over ~half the
  // cycle, then rests, so it glints rather than strobes
  const cyc = (t * 0.16 + i * 0.37) % 1;
  if (cyc < 0.5) {
    const s = cyc * 2;                                // 0..1 across the head
    const gx = -w * 0.4 + s * (w * 1.8);
    const gl = bc.createLinearGradient(gx - w * 0.45, 0, gx + w * 0.45, h);
    const a = Math.sin(s * Math.PI) * 0.38;           // fade in/out at edges
    gl.addColorStop(0, 'rgba(255,255,255,0)');
    gl.addColorStop(0.42, 'rgba(255,255,255,0)');
    gl.addColorStop(0.5, `rgba(255,255,255,${a})`);
    gl.addColorStop(0.58, 'rgba(255,255,255,0)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    bc.fillStyle = gl;
    bc.fillRect(0, 0, w, h);
  }
  bc.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.drawImage(buf, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function drawHUD(ctx, W, H, o) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const fs = Math.max(14, Math.round(H / 34));
  ctx.font = `bold ${fs}px "Consolas","Courier New",monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const ink = (o.theme && o.theme.hud) || HUD_INK_DARK;
  ctx.fillStyle = ink.text;
  ctx.shadowColor = ink.halo;
  ctx.shadowBlur = Math.max(3, Math.round(fs * 0.3));
  // metrics stack as label/value rows; each record-bearing metric (time,
  // style) is followed by an indented "best" row so both records read the
  // same way. Harnesses that pass no style keep the time-only layout
  const hasStyle = o.style != null;
  // keep the metrics clear of a left-side notch / top inset
  const hudX = 14 + SAFE.left;
  const rowY = i => 12 + SAFE.top + fs * 1.3 * i;
  let row = 0;
  ctx.fillText(`time    ${fmt(o.time)}`, hudX, rowY(row++));
  ctx.fillText(`  best  ${o.best != null ? fmt(o.best) : '--:--,--'}`, hudX, rowY(row++));
  if (hasStyle) {
    ctx.fillText(`style   ${o.style}`, hudX, rowY(row++));
    ctx.fillText(`  best  ${o.styleBest != null ? o.styleBest : '---'}`, hudX, rowY(row++));
  }
  ctx.fillText(`burgers ${o.got}/${o.total}`, hudX, rowY(row++));
  if (o.lives != null) {
    // one biker head per remaining life, behind a "lives" label that lines
    // up with the value column of the rows above
    const img = IMAGES.biker;
    const ih = fs * 1.5, iy = rowY(row);
    // value column matches "time", "best", "burgers" (all 8 monospace chars)
    const hx = hudX + ctx.measureText('burgers ').width;
    ctx.fillText('lives', hudX, iy + (ih - fs) / 2);
    // the heads paint their own shadow and shine; no halo on the sprites
    ctx.shadowBlur = 0;
    const t = o.t || 0;
    for (let i = 0; i < o.lives; i++) {
      if (img && img.complete && img.naturalWidth > 0) {
        const iw = ih * img.naturalWidth / img.naturalHeight;
        drawLifeHead(ctx, img, hx + i * (iw + 8), iy, iw, ih, t, i);
      } else {
        const bob = Math.sin(t * 1.5 + i * 1.7) * ih * 0.10;
        ctx.beginPath();
        ctx.arc(hx + i * (ih * 0.8 + 8) + ih * 0.4, iy + ih / 2 + bob, ih * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.shadowBlur = 0;

  // level name and number tucked under the minimap, right-aligned to its
  // edge so it never crowds the left metrics; the replay and test-ride
  // banners own this role on their screens, so it only shows for live
  // riding. Small type keeps it clear of the HUD even on a narrow phone
  if (o.mapLabel && !o.replay && !o.test) {
    const m = minimapRect(W, H);
    const lf = Math.max(10, Math.round(H / 56));
    ctx.font = `bold ${lf}px "Consolas","Courier New",monospace`;
    ctx.textAlign = 'right';
    ctx.fillStyle = ink.text;
    ctx.shadowColor = ink.halo;
    ctx.shadowBlur = Math.max(2, Math.round(lf * 0.3));
    ctx.fillText(o.mapLabel, m.mx + m.mw, m.my + m.mh + 6);
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';
  }

  if (o.test) {
    // banner so an editor test ride can't be mistaken for a real run
    const bf = Math.max(13, Math.round(fs * 0.8));
    ctx.textAlign = 'center';
    ctx.font = `bold ${bf}px "Consolas","Courier New",monospace`;
    const text = 'TEST RIDE - ' + (o.mapLabel || 'untitled');
    const tw = ctx.measureText(text).width;
    // the touch pause/restart buttons own the top centre, so the banner
    // ducks under them on touch screens
    const by = o.touch ? 76 : 10;
    ctx.fillStyle = 'rgba(20,12,6,0.78)';
    roundRectPath(ctx, W / 2 - tw / 2 - 14, by, tw + 28, bf * 1.9, 9);
    ctx.fill();
    ctx.fillStyle = '#9be08a';
    ctx.fillText(text, W / 2, by + bf * 0.45);
    ctx.textAlign = 'left';
    if (o.test.done) {
      const back = o.touch ? 'tap to retry - pause button for the editor'
        : 'Enter retries - Esc back to the editor';
      if (o.test.outcome === 'finished') {
        centerMsg(ctx, W, H, 'Course completed!', `Time ${fmt(o.time)} - ` + back);
      } else {
        centerMsg(ctx, W, H, 'The rider crashed!', back);
      }
    }
  } else if (o.replay) {
    // banner so a playback can't be mistaken for live riding
    const bf = Math.max(13, Math.round(fs * 0.8));
    ctx.textAlign = 'center';
    ctx.font = `bold ${bf}px "Consolas","Courier New",monospace`;
    const text = 'REPLAY - ' + o.replay.label;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(20,12,6,0.78)';
    roundRectPath(ctx, W / 2 - tw / 2 - 14, 10, tw + 28, bf * 1.9, 9);
    ctx.fill();
    ctx.fillStyle = '#f9c623';
    ctx.fillText(text, W / 2, 10 + bf * 0.45);
    ctx.textAlign = 'left';
    const goBack = o.touch ? 'Tap to go back' : 'Press Enter to go back';
    if (o.replay.done) {
      if (o.replay.outcome === 'finished') {
        centerMsg(ctx, W, H, 'Course completed!',
          `Time ${fmt(o.time)}${hasStyle ? ' - Style ' + o.style : ''} - ` +
            `${o.touch ? 'tap' : 'press Enter'} to go back`);
      } else if (o.replay.outcome === 'crashed') {
        centerMsg(ctx, W, H, 'The rider crashed!', goBack);
      } else {
        // the inputs ran out before the recorded ending (the game has
        // changed since this was saved): stop the tape gracefully
        centerMsg(ctx, W, H, 'End of the tape!', goBack);
      }
    }
  } else if (o.state === 'dead') {
    const again = o.touch ? 'Tap' : 'Press Enter';
    const sub = o.lives > 0
      ? `${again} to try again - ${o.lives} ${o.lives === 1 ? 'life' : 'lives'} left`
      : `Out of lives... ${o.touch ? 'tap to continue' : 'press Enter'}`;
    // on touch the panel rides just above the bottom SAVE REPLAY button
    const anchor = o.touch ? saveButtonRect(W, H).y - 12 : undefined;
    centerMsg(ctx, W, H, 'You crashed!', sub, o.saveNote, anchor);
  } else if (o.state === 'finished') {
    const anchor = o.touch ? saveButtonRect(W, H).y - 12 : undefined;
    centerMsg(ctx, W, H, 'Course completed!',
      `Time ${fmt(o.time)}${hasStyle ? ' - Style ' + o.style : ''} - ` +
        `${o.touch ? 'tap' : 'press Enter'} for ` +
        (o.hasNext ? 'the next map' : 'the menu'),
      o.saveNote, anchor);
  } else if (o.state === 'ready') {
    drawReady(ctx, W, H, o.mapLabel, o.touch);
  }
}

// boot screen: progress bar while assets stream in; once ready it becomes
// the "press to start" gate (the gesture also unlocks the audio context)
function drawLoading(ctx, W, H, frac, t, ready, touch) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1a0f06';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H * 0.40);
  ctx.scale(60, 60);
  drawBurger(ctx, 0, 0, t * 3);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (ready) {
    ctx.globalAlpha = 0.65 + Math.sin(t * 4) * 0.35;
    ctx.fillStyle = '#9be08a';
    ctx.font = 'bold 24px "Consolas","Courier New",monospace';
    ctx.fillText(touch ? 'Tap to start' : 'Press any key or click to start',
      W / 2, H * 0.62);
    ctx.globalAlpha = 1;
    return;
  }

  ctx.fillStyle = '#f0e8da';
  ctx.font = 'bold 22px "Consolas","Courier New",monospace';
  ctx.fillText('LOADING' + '.'.repeat(1 + Math.floor(t * 2.5) % 3), W / 2, H * 0.60);

  const bw = Math.min(W * 0.5, 360), bh = 14;
  const bx = (W - bw) / 2, by = H * 0.66;
  ctx.strokeStyle = 'rgba(249,198,35,0.5)';
  ctx.lineWidth = 2;
  roundRectPath(ctx, bx, by, bw, bh, 7);
  ctx.stroke();
  ctx.fillStyle = '#f9c623';
  roundRectPath(ctx, bx + 2, by + 2, Math.max(8, (bw - 4) * frac), bh - 4, 5);
  ctx.fill();
}
