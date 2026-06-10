'use strict';

// the rider's head photo; the drawn helmet is the fallback while it loads
const headImg = new Image();
headImg.src = 'assets/biker.png';

// deterministic pseudo-random for grass blades (stable frame to frame)
function srand(n) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function makePatterns(ctx) {
  // blobs are stamped at wrapped offsets so the tiles repeat seamlessly
  const wraps = [[0, 0], [128, 0], [-128, 0], [0, 128], [0, -128]];

  const g = document.createElement('canvas');
  g.width = g.height = 128;
  const gc = g.getContext('2d');
  gc.fillStyle = '#8c5e35';
  gc.fillRect(0, 0, 128, 128);
  const dirt = ['rgba(60,38,18,0.25)', 'rgba(140,100,55,0.30)',
                'rgba(172,126,70,0.22)', 'rgba(80,50,25,0.28)'];
  for (let i = 0; i < 240; i++) {
    const x = Math.random() * 128, y = Math.random() * 128;
    const r = 2 + Math.random() * 7;
    gc.fillStyle = dirt[i % 4];
    for (const [ox, oy] of wraps) {
      gc.beginPath();
      gc.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      gc.fill();
    }
  }

  const s = document.createElement('canvas');
  s.width = s.height = 128;
  const sc = s.getContext('2d');
  sc.fillStyle = '#aecbe6';
  sc.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 128, y = Math.random() * 128;
    const r = 8 + Math.random() * 18;
    sc.fillStyle = i % 3 ? 'rgba(255,255,255,0.10)' : 'rgba(150,185,220,0.18)';
    for (const [ox, oy] of wraps) {
      sc.beginPath();
      sc.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      sc.fill();
    }
  }

  const ground = ctx.createPattern(g, 'repeat');
  ground.setTransform(new DOMMatrix([3.6 / 128, 0, 0, 3.6 / 128, 0, 0]));
  const sky = ctx.createPattern(s, 'repeat');
  sky.setTransform(new DOMMatrix([7 / 128, 0, 0, 7 / 128, 0, 0]));
  return { ground, sky };
}

function drawWorld(ctx, level, pat, view) {
  ctx.fillStyle = pat.ground;
  ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);

  ctx.beginPath();
  for (const poly of level.polygons) {
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
  }
  ctx.fillStyle = pat.sky;
  ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(40,20,5,0.5)';
  ctx.lineWidth = 0.07;
  ctx.stroke();

  for (const e of level.grass) drawGrassEdge(ctx, e);
}

function drawGrassEdge(ctx, s) {
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  let nx = uy, ny = -ux;            // normal pointing up into the playable area
  if (ny > 0) { nx = -nx; ny = -ny; }

  ctx.fillStyle = '#3f8d27';
  ctx.beginPath();
  ctx.moveTo(s.ax - nx * 0.02, s.ay - ny * 0.02);
  ctx.lineTo(s.bx - nx * 0.02, s.by - ny * 0.02);
  ctx.lineTo(s.bx + nx * 0.16, s.by + ny * 0.16);
  ctx.lineTo(s.ax + nx * 0.16, s.ay + ny * 0.16);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#2f7a1d';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  const n = Math.max(1, Math.floor(len / 0.22));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r1 = srand(s.ax * 7.13 + s.ay * 2.1 + i * 3.7);
    const r2 = srand(s.ay * 5.7 + s.ax * 1.9 + i * 1.3);
    const bx = s.ax + dx * t, by = s.ay + dy * t;
    const h = 0.14 + r1 * 0.20, lean = (r2 - 0.5) * 0.16;
    ctx.moveTo(bx + nx * 0.10, by + ny * 0.10);
    ctx.lineTo(bx + nx * (0.10 + h) + ux * lean, by + ny * (0.10 + h) + uy * lean);
  }
  ctx.stroke();
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

    g = ctx.createLinearGradient(-0.78, 0, 0.78, 0);
    g.addColorStop(0, '#c79212');
    g.addColorStop(0.42, '#ffd84d');
    g.addColorStop(1, '#b8860d');
    ctx.fillStyle = g;
    ctx.fillRect(-0.76, base, 1.52, 0.09);
    // cheese drips slowly stretch and relax
    const drip = 0.24 + Math.sin(t * 1.8 + i * 2.1 + phase) * 0.04;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 0.76, base + 0.09);
      ctx.lineTo(side * 0.58, base + 0.09);
      ctx.lineTo(side * 0.69, base + drip);
      ctx.closePath();
      ctx.fill();
    }
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

  // mound of popcorn, back rows first, every puff gently jiggling
  const K = [
    [-0.07, -0.42, 0.10], [0.12, -0.38, 0.09],
    [-0.20, -0.26, 0.10], [0.02, -0.30, 0.115], [0.22, -0.24, 0.095],
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
    drawKernel(ctx, 0.05 + cyc * 0.15, -0.45 - h * 0.45, 0.07, 3.3);
  }

  // front rim overlaps the base of the mound
  ctx.strokeStyle = '#f3eee2';
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.ellipse(0, topY, topW, 0.09, 0, 0, Math.PI);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.ellipse(0, topY + 0.05, topW, 0.09, 0, 0, Math.PI);
  ctx.stroke();

  // butter glint sweeping across the mound
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.beginPath();
  ctx.ellipse(Math.sin(t * 0.8) * 0.22, -0.27, 0.10, 0.05, -0.4, 0, Math.PI * 2);
  ctx.fill();

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
  if (headImg.complete && headImg.naturalWidth > 0) {
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

function drawTitle(ctx, W, H) {
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
  ctx.fillText('BURGER MANIA', W / 2 + 3, py + 58 + 3);
  ctx.fillStyle = '#f9c623';
  ctx.fillText('BURGER MANIA', W / 2, py + 58);

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
    'SPACE turn around   ENTER restart   M sound on/off',
  ];
  lines.forEach((t, i) => ctx.fillText(t, W / 2, py + 192 + i * 26));

  ctx.fillStyle = '#9be08a';
  ctx.font = 'bold 19px "Consolas","Courier New",monospace';
  ctx.fillText('Press any key to ride', W / 2, py + ph - 24);
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

  if (o.state === 'dead') {
    centerMsg(ctx, W, H, 'You crashed!', 'Press Enter to try again');
  } else if (o.state === 'finished') {
    centerMsg(ctx, W, H, 'Course completed!',
      `Time ${fmt(o.time)} - press Enter to ride again`);
  } else if (o.state === 'title') {
    drawTitle(ctx, W, H);
  }
}
