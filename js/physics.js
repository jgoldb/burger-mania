'use strict';

// Tuning constants for the bike. Units: meters, seconds, radians.
const PHYS = {
  g: 10,

  wheelR: 0.4,
  wheelM: 0.22,
  wheelI: 0.018,

  frameM: 1.0,
  frameI: 0.35,

  springK: 110,
  springC: 6.0,
  maxStretch: 0.4,

  engineT: 0.75,   // torque applied to the driven (rear) wheel
  maxSpin: 55,     // rad/s cap on driven wheel spin
  brakeRate: 20,   // exponential lock rate for both wheels

  leanT: 3.2,      // "volt" torque applied to the frame

  mu: 1.1,         // tire friction coefficient

  headR: 0.24,
  headX: -0.18,    // head offset in frame space (x is mirrored by facing)
  headY: -0.90,

  anchorX: 0.55,   // wheel anchor offsets in frame space
  anchorY: 0.30,
};

function closestOnSeg(px, py, s) {
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - s.ax) * dx + (py - s.ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: s.ax + dx * t, y: s.ay + dy * t };
}

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// Builds collision segments and the list of grass-topped edges from raw level data.
function prepareLevel(L) {
  const segments = [], grass = [];
  for (const poly of L.polygons) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const s = { ax: a[0], ay: a[1], bx: b[0], by: b[1] };
      segments.push(s);
      const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      // grass grows on edges that are not too steep and face the playable side upward
      if (Math.abs(dx) > 0.001 && Math.abs(dy / dx) < 2.0 &&
          pointInPoly(mx, my - 0.3, poly) && !pointInPoly(mx, my + 0.3, poly)) {
        grass.push(s);
      }
    }
  }
  return Object.assign({}, L, { segments, grass });
}

class Bike {
  constructor(x, y) {
    this.pos = { x, y };
    this.vel = { x: 0, y: 0 };
    this.angle = 0;
    this.avel = 0;
    this.facing = 1; // 1 = right, -1 = left
    this.dead = false;
    this.wheels = [];
    for (const sx of [-1, 1]) {
      this.wheels.push({
        pos: { x: x + sx * PHYS.anchorX, y: y + PHYS.anchorY },
        vel: { x: 0, y: 0 },
        spin: 0,  // angular velocity
        rot: 0,   // accumulated angle, for drawing spokes
      });
    }
  }

  // wheel 0 hangs from the left anchor, wheel 1 from the right;
  // whichever is behind (relative to facing) is the driven wheel
  get rearIndex() { return this.facing === 1 ? 0 : 1; }

  l2w(lx, ly, mirror) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    const x = mirror ? lx * this.facing : lx;
    return { x: this.pos.x + x * c - ly * s, y: this.pos.y + x * s + ly * c };
  }

  headPos() { return this.l2w(PHYS.headX, PHYS.headY, true); }

  flip() { this.facing *= -1; }

  step(dt, input, segs) {
    if (this.dead) return;
    const P = PHYS;
    const c = Math.cos(this.angle), s = Math.sin(this.angle);

    let fx = 0, fy = P.frameM * P.g, torque = 0;
    if (input.left) torque -= P.leanT;
    if (input.right) torque += P.leanT;

    for (let i = 0; i < 2; i++) {
      const w = this.wheels[i];
      const lx = (i === 0 ? -1 : 1) * P.anchorX, ly = P.anchorY;
      const ax = this.pos.x + lx * c - ly * s;
      const ay = this.pos.y + lx * s + ly * c;
      const rx = ax - this.pos.x, ry = ay - this.pos.y;
      // velocity of the anchor point on the frame
      const avx = this.vel.x - this.avel * ry;
      const avy = this.vel.y + this.avel * rx;

      // spring + damper between wheel and anchor
      const dx = w.pos.x - ax, dy = w.pos.y - ay;
      const rvx = w.vel.x - avx, rvy = w.vel.y - avy;
      const Fx = -P.springK * dx - P.springC * rvx;
      const Fy = -P.springK * dy - P.springC * rvy;
      w.vel.x += (Fx / P.wheelM) * dt;
      w.vel.y += (Fy / P.wheelM + P.g) * dt;
      fx -= Fx;
      fy -= Fy;
      torque += rx * (-Fy) - ry * (-Fx);

      if (i === this.rearIndex && input.throttle) {
        w.spin += (P.engineT / P.wheelI) * dt * this.facing;
        if (w.spin > P.maxSpin) w.spin = P.maxSpin;
        if (w.spin < -P.maxSpin) w.spin = -P.maxSpin;
      }
      if (input.brake) {
        w.spin *= Math.max(0, 1 - P.brakeRate * dt);
      }
    }

    this.vel.x += (fx / P.frameM) * dt;
    this.vel.y += (fy / P.frameM) * dt;
    this.avel += (torque / P.frameI) * dt;
    this.avel *= 1 - 0.12 * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.angle += this.avel * dt;
    for (const w of this.wheels) {
      w.pos.x += w.vel.x * dt;
      w.pos.y += w.vel.y * dt;
      w.rot += w.spin * dt;
    }

    // hard limit on suspension travel so the wheels can never escape
    const c2 = Math.cos(this.angle), s2 = Math.sin(this.angle);
    for (let i = 0; i < 2; i++) {
      const w = this.wheels[i];
      const lx = (i === 0 ? -1 : 1) * P.anchorX, ly = P.anchorY;
      const ax = this.pos.x + lx * c2 - ly * s2;
      const ay = this.pos.y + lx * s2 + ly * c2;
      const dx = w.pos.x - ax, dy = w.pos.y - ay;
      const d = Math.hypot(dx, dy);
      if (d > P.maxStretch) {
        const ux = dx / d, uy = dy / d;
        w.pos.x = ax + ux * P.maxStretch;
        w.pos.y = ay + uy * P.maxStretch;
        const rvx = w.vel.x - this.vel.x, rvy = w.vel.y - this.vel.y;
        const vr = rvx * ux + rvy * uy;
        if (vr > 0) { w.vel.x -= ux * vr; w.vel.y -= uy * vr; }
      }
    }

    for (const w of this.wheels) this.wheelContacts(w, segs, dt);

    // the head is the only fatal collider
    const h = this.headPos();
    for (const seg of segs) {
      const cp = closestOnSeg(h.x, h.y, seg);
      if (Math.hypot(h.x - cp.x, h.y - cp.y) < P.headR) {
        this.dead = true;
        break;
      }
    }
  }

  wheelContacts(w, segs, dt) {
    const P = PHYS;
    for (const seg of segs) {
      const cp = closestOnSeg(w.pos.x, w.pos.y, seg);
      let nx = w.pos.x - cp.x, ny = w.pos.y - cp.y;
      const d = Math.hypot(nx, ny);
      if (d >= P.wheelR || d === 0) continue;
      nx /= d; ny /= d;

      // positional correction
      const pen = P.wheelR - d;
      w.pos.x += nx * pen;
      w.pos.y += ny * pen;

      // inelastic normal impulse
      const vn = w.vel.x * nx + w.vel.y * ny;
      let jn = 0;
      if (vn < 0) {
        jn = -vn * P.wheelM;
        w.vel.x += nx * jn / P.wheelM;
        w.vel.y += ny * jn / P.wheelM;
      }

      // tire friction: drive contact-point tangential slip toward zero,
      // clamped by the Coulomb limit
      const tx = -ny, ty = nx;
      const vt = w.vel.x * tx + w.vel.y * ty - P.wheelR * w.spin;
      const meff = 1 / (1 / P.wheelM + P.wheelR * P.wheelR / P.wheelI);
      let jt = -vt * meff;
      const maxF = P.mu * Math.max(jn, P.wheelM * P.g * dt * 1.5);
      if (jt > maxF) jt = maxF;
      if (jt < -maxF) jt = -maxF;
      w.vel.x += tx * jt / P.wheelM;
      w.vel.y += ty * jt / P.wheelM;
      w.spin += (-P.wheelR * jt) / P.wheelI;
    }
  }
}
