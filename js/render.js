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
  // (Easy 1-5)
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
    turfFill: '#3f8d27', turfBlade: '#2f7a1d',
    outline: 'rgba(40,20,5,0.5)',
    miniGround: '#6b4a24', miniSky: '#a7c4de',
  },
  // volcano: basalt flecked with embers, a lava-lit sky over erupting
  // cones, molten crust with fire instead of grass (Easy 6-10)
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
    outline: 'rgba(255,120,40,0.45)',
    miniGround: '#352529', miniSky: '#c75a2a',
  },
};

function makeTile(spec) {
  // blobs are stamped at wrapped offsets so the tiles repeat seamlessly
  const wraps = [[0, 0], [128, 0], [-128, 0], [0, 128], [0, -128]];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const cc = c.getContext('2d');
  if (spec.base) {
    cc.fillStyle = spec.base;
    cc.fillRect(0, 0, 128, 128);
  }
  for (const layer of spec.layers) {
    for (let i = 0; i < layer.n; i++) {
      const x = Math.random() * 128, y = Math.random() * 128;
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

// builds one pattern set per theme; callers pick by level theme name
function makePatterns(ctx) {
  const out = {};
  for (const name of Object.keys(THEMES)) {
    const t = THEMES[name];
    const ground = ctx.createPattern(makeTile(t.ground), 'repeat');
    ground.setTransform(new DOMMatrix([3.6 / 128, 0, 0, 3.6 / 128, 0, 0]));
    const sky = ctx.createPattern(makeTile(t.skyTile), 'repeat');
    sky.setTransform(new DOMMatrix([7 / 128, 0, 0, 7 / 128, 0, 0]));
    out[name] = Object.assign({}, t, { ground, sky });
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

// meadow backdrop: a soft sun and two ranks of rolling hills
function drawMeadowBack(ctx, view, t) {
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
  hillLayer(ctx, view, 0.22, 10.0, 3.0, 0.42, 'rgba(158,196,164,0.65)');
  hillLayer(ctx, view, 0.42, 10.9, 2.0, 0.66, 'rgba(118,168,116,0.72)');
}

// volcano backdrop: a far jagged ridge, then a rank of cones with
// pulsing crater glows and lava streaks down their flanks
function drawVolcanoBack(ctx, view, t) {
  ridgeLayer(ctx, view, 0.16, 11.0, 5.2, 21, 'rgba(54,26,30,0.60)');
  const p = 0.36, spacing = 30;
  const u = (view.x0 + view.x1) / 2 * (1 - p);
  const first = Math.floor((view.x0 - u - 9) / spacing) * spacing;
  for (let s = first; s <= view.x1 - u + 9; s += spacing) {
    const x = s + u;
    const r = srand(s * 0.013 + 3.7);
    const h = 5.5 + r * 2.5, half = 4.6 + r * 1.8;
    const capW = 0.9 + r * 0.5;
    const baseY = 11.8, py = baseY - h;
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

function drawWorld(ctx, level, pat, view, t) {
  t = t || 0;
  const vw = view.x1 - view.x0, vh = view.y1 - view.y0;
  ctx.fillStyle = pat.ground;
  ctx.fillRect(view.x0, view.y0, vw, vh);

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
  ctx.fillStyle = skyGradient(ctx, pat, -8, 12);
  ctx.fillRect(view.x0, view.y0, vw, vh);
  pat.background(ctx, view, t);
  const drift = (t * 0.4) % 7; // haze tile repeats every 7 world units
  ctx.translate(-drift, 0);
  ctx.fillStyle = pat.sky;
  ctx.fillRect(view.x0, view.y0, vw + 7, vh);
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

function drawHead(ctx, x, y, facing, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle || 0);
  // the rider's head photo; the drawn helmet is the fallback if it failed
  const headImg = IMAGES.biker;
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

function drawBike(ctx, bike, headless) {
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
  strokeSeg(ctx, shoulder, handle, 0.08, '#15151a');

  if (!headless) {
    const head = L(PHYS.headX, PHYS.headY);
    drawHead(ctx, head.x, head.y, m, bike.angle);
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

function centerMsg(ctx, W, H, title, sub) {
  ctx.save();
  const pw = Math.min(W * 0.8, 640), ph = 110;
  const px = (W - pw) / 2, py = H * 0.36;
  ctx.fillStyle = 'rgba(20,12,6,0.78)';
  roundRectPath(ctx, px, py, pw, ph, 12);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f9c623';
  ctx.font = 'bold 30px "Consolas","Courier New",monospace';
  ctx.fillText(title, W / 2, py + 38);
  ctx.fillStyle = '#f0e8da';
  ctx.font = '17px "Consolas","Courier New",monospace';
  ctx.fillText(sub, W / 2, py + 76);
  ctx.restore();
}

function drawReady(ctx, W, H, mapLabel) {
  ctx.save();
  const pw = Math.min(W * 0.86, 720), ph = 330;
  const px = (W - pw) / 2, py = H * 0.18;
  ctx.fillStyle = 'rgba(20,12,6,0.82)';
  roundRectPath(ctx, px, py, pw, ph, 16);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5d2f17';
  ctx.font = 'bold 52px "Consolas","Courier New",monospace';
  ctx.fillText('GET READY!', W / 2 + 3, py + 58 + 3);
  ctx.fillStyle = '#f9c623';
  ctx.fillText('GET READY!', W / 2, py + 58);

  if (mapLabel) {
    ctx.fillStyle = '#9be08a';
    ctx.font = 'bold 18px "Consolas","Courier New",monospace';
    ctx.fillText(mapLabel, W / 2, py + 96);
  }

  // burger icon beside the title
  ctx.save();
  ctx.translate(W / 2, py + 130);
  ctx.scale(42, 42);
  drawBurger(ctx, 0, 0.4, performance.now() / 1000);
  ctx.restore();

  ctx.fillStyle = '#f0e8da';
  ctx.font = '17px "Consolas","Courier New",monospace';
  const lines = [
    'Collect every triple cheeseburger, then ride to the popcorn.',
    '',
    'UP gas   DOWN brake   LEFT / RIGHT rotate',
    'SPACE turn around   ENTER restart   ESC pause   M sound',
  ];
  lines.forEach((t, i) => ctx.fillText(t, W / 2, py + 192 + i * 26));

  ctx.fillStyle = '#9be08a';
  ctx.font = 'bold 19px "Consolas","Courier New",monospace';
  ctx.fillText('Press any key to ride', W / 2, py + ph - 24);
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

// animated scene behind the intro and menu: drifting clouds, tumbling
// burgers, a grassy floor, and the popcorn bucket waiting on the right
function drawMenuBackdrop(ctx, W, H, t, pat) {
  const Z = Math.min(W / 26, H / 13.5);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.scale(Z, Z);
  const w = W / Z, h = H / Z;

  const gy = h * 0.84;
  ctx.fillStyle = skyGradient(ctx, pat, 0, gy);
  ctx.fillRect(0, 0, w, h);

  // distant hills panning slowly past, then the drifting cloud layer
  const pan = t * 1.2;
  ctx.save();
  ctx.translate(-pan, 0);
  pat.background(ctx, { x0: pan, x1: pan + w, y0: 0, y1: gy }, t);
  ctx.restore();
  const drift = (t * 0.4) % 7; // sky pattern repeats every 7 world units
  ctx.save();
  ctx.translate(-drift, 0);
  ctx.fillStyle = pat.sky;
  ctx.fillRect(0, 0, w + 7, h);
  ctx.restore();

  ctx.fillStyle = pat.ground;
  ctx.fillRect(0, gy, w, h - gy);
  pat.edge(ctx, { ax: 0, ay: gy, bx: w, by: gy }, pat, t);

  ctx.save();
  ctx.translate(w * 0.86, gy - 1.05);
  ctx.scale(1.8, 1.8);
  drawPopcorn(ctx, 0, 0, t);
  ctx.restore();

  for (let i = 0; i < 6; i++) {
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
  ctx.restore();
}

// button hitboxes, shared by rendering (here) and hit-testing (game.js)
function menuRects(W, H, n, y0) {
  const bw = Math.min(300, W * 0.7), bh = 56, gap = 18;
  const x = (W - bw) / 2;
  const rects = [];
  for (let i = 0; i < n; i++) rects.push({ x, y: y0 + i * (bh + gap), w: bw, h: bh });
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
    ctx.fillStyle = hot ? '#ffe27a' : (it.color || '#f0e8da');
    if (it.sub) {
      ctx.font = 'bold 22px "Consolas","Courier New",monospace';
      ctx.fillText(it.label, cx, cy - 8);
      ctx.fillStyle = hot ? '#f0e8da' : 'rgba(240,232,218,0.7)';
      ctx.font = '13px "Consolas","Courier New",monospace';
      ctx.fillText(it.sub, cx, cy + 15);
    } else {
      ctx.font = 'bold 24px "Consolas","Courier New",monospace';
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
  const last = rects[rects.length - 1];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(40,20,8,0.85)';
  ctx.font = '15px "Consolas","Courier New",monospace';
  ctx.fillText('Arrow keys + Enter, or click', W / 2, last.y + last.h + 34);
  ctx.restore();
}

function drawDifficulty(ctx, W, H, alpha, tracks, sel, hover) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 44px "Consolas","Courier New",monospace';
  ctx.fillStyle = 'rgba(40,16,4,0.85)';
  ctx.fillText('CHOOSE DIFFICULTY', W / 2 + 3, H * 0.20 + 3);
  ctx.fillStyle = '#f9c623';
  ctx.fillText('CHOOSE DIFFICULTY', W / 2, H * 0.20);
  ctx.restore();

  const items = tracks.map(t => ({
    label: t.label,
    sub: t.levels.length ? t.length + ' maps' : 'Coming soon',
    color: t.color,
    disabled: !t.levels.length,
  }));
  const rects = menuRects(W, H, tracks.length, H * 0.34);
  drawButtons(ctx, rects, items, sel, hover, alpha);

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

function drawPause(ctx, W, H, items, sel, hover) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(8,5,2,0.55)';
  ctx.fillRect(0, 0, W, H);

  const rects = menuRects(W, H, items.length, H * 0.46);
  const last = rects[rects.length - 1];
  const pw = Math.min(W * 0.7, 460);
  const py = H * 0.32, ph = last.y + last.h + 30 - py;
  ctx.fillStyle = 'rgba(20,12,6,0.85)';
  roundRectPath(ctx, (W - pw) / 2, py, pw, ph, 16);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f9c623';
  ctx.font = 'bold 36px "Consolas","Courier New",monospace';
  ctx.fillText('PAUSED', W / 2, py + 44);
  drawButtons(ctx, rects, items, sel, hover, 1);
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

function drawMinimap(ctx, W, H, level, o) {
  const b = levelBounds(level);
  const pad = 1; // world units of breathing room at the level edges
  const s = Math.min(Math.min(W * 0.32, 320) / MAP_VIEW.w,
                     Math.min(H * 0.26, 150) / MAP_VIEW.h);
  const mw = MAP_VIEW.w * s, mh = MAP_VIEW.h * s;
  const mx = W - mw - 14, my = 12;

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
  dot(tx(o.goal[0]), ty(o.goal[1]), 2.6, '#c8202a');

  // rider: white dot with a soft pulse so it reads at a glance
  const px = tx(o.pos.x), py = ty(o.pos.y);
  const pulse = 2.6 + Math.sin(o.t * 6) * 0.5;
  dot(px, py, pulse + 1.4, 'rgba(255,255,255,0.35)');
  dot(px, py, pulse, '#ffffff');

  ctx.restore();
}

function drawHUD(ctx, W, H, o) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const fs = Math.max(14, Math.round(H / 34));
  ctx.font = `bold ${fs}px "Consolas","Courier New",monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(58,26,10,0.9)';
  ctx.fillText(`time    ${fmt(o.time)}`, 14, 12);
  ctx.fillText(`best    ${o.best != null ? fmt(o.best) : '--:--,--'}`, 14, 12 + fs * 1.3);
  ctx.fillText(`burgers ${o.got}/${o.total}`, 14, 12 + fs * 2.6);
  if (o.lives != null) {
    // one biker head per remaining life, behind a "lives" label that lines
    // up with the value column of the rows above
    const img = IMAGES.biker;
    const ih = fs * 1.5, iy = 12 + fs * 3.9;
    // value column matches "time", "best", "burgers" (all 8 monospace chars)
    const hx = 14 + ctx.measureText('burgers ').width;
    ctx.fillText('lives', 14, iy + (ih - fs) / 2);
    for (let i = 0; i < o.lives; i++) {
      if (img && img.complete && img.naturalWidth > 0) {
        const iw = ih * img.naturalWidth / img.naturalHeight;
        ctx.drawImage(img, hx + i * (iw + 8), iy, iw, ih);
      } else {
        ctx.beginPath();
        ctx.arc(hx + i * (ih * 0.8 + 8) + ih * 0.4, iy + ih / 2, ih * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (o.state === 'dead') {
    const sub = o.lives > 0
      ? `Press Enter to try again - ${o.lives} ${o.lives === 1 ? 'life' : 'lives'} left`
      : 'Out of lives... press Enter';
    centerMsg(ctx, W, H, 'You crashed!', sub);
  } else if (o.state === 'finished') {
    centerMsg(ctx, W, H, 'Course completed!',
      `Time ${fmt(o.time)} - press Enter for ${o.hasNext ? 'the next map' : 'the menu'}`);
  } else if (o.state === 'ready') {
    drawReady(ctx, W, H, o.mapLabel);
  }
}

// boot screen: progress bar while assets stream in; once ready it becomes
// the "press to start" gate (the gesture also unlocks the audio context)
function drawLoading(ctx, W, H, frac, t, ready) {
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
    ctx.fillText('Press any key or click to start', W / 2, H * 0.62);
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
