'use strict';

// Tuning constants for the bike. Units: meters, seconds, radians.
const PHYS = {
  g: 7,

  wheelR: 0.4,
  wheelM: 0.22,
  wheelI: 0.018,

  frameM: 1.0,
  frameI: 0.35,

  springK: 100,
  springC: 5.0,
  springCFade: 5,  // relative speed (m/s) where damper force fades to half:
                   // slow squat stays controlled, hard hits stay elastic
  maxStretch: 0.4,
  frameR: 0.45,    // body collider radius: on a slammed landing the faded
                   // damper lets the frame dive between the planted wheels,
                   // and without a belly hit it would carry the head into
                   // the ground and drag the wheels through the floor via
                   // the stretch clamp. Inactive in normal riding (rest
                   // clearance ~0.67)
  spinExt: 0.022,   // anchor extension (m) per (rad/s)^2 of frame spin
  spinExtMax: 0.28, // cap on the spin-driven extension

  engineT: 1.4,    // torque applied to the driven (rear) wheel
  engineLow: 0.25, // extra low-end torque fraction: full extra at zero
                   // wheel spin, gone by engineKnee. Steep-hill starts get
                   // the grunt without raising cruise acceleration
  engineKnee: 12,  // wheel spin (rad/s, ~4.8 m/s) where the extra runs out
  engineR: 8.5,    // reaction torque on the frame while the engine spins up
  wheelieRate: 0.5, // rad/s pitch-back rate the engine reaction saturates at
  maxSpin: 55,     // rad/s cap on driven wheel spin
  brakeRate: 30,   // exponential lock rate for both wheels
  brakeR: 0.32,    // fraction of brake torque reacted onto the frame
  brakeSkid: 2.0,  // skid friction torque multiplier passed to the frame
  brakeCap: 0.4,   // stoppie pitch (rad) the brake torque fades out at;
                   // braking decel is endo-limited, so this IS the brake
                   // strength on flat ground
  parkMu: 1.9,     // static friction once the brake has fully clamped a
                   // stopped wheel: a held brake parks the bike on a hill
                   // instead of creeping, until the grade gets very steep
  parkVt: 0.7,     // contact speed (m/s) below which the clamp grabs; also
                   // sets the break-away grade (~45deg): on steeper slopes
                   // the braked slow-roll never gets slow enough to clamp

  voltT: 28,      // peak torque of one rider thrust ("volt")
  voltDur: 0.2,   // thrust duration: torque follows a half-sine burst
  voltEvery: 0.55, // interval between thrusts while a lean key is held:
                   // short enough that grounded re-volts catch the bike
                   // still tilted from the last one, so holding a lean key
                   // ratchets it past the balance point and all the way
                   // over (~2s from static; >=0.65 never tips)
  voltRate: 4.0,  // rad/s spin rate a thrust saturates toward
  voltStack: 1.0,  // strength gain per consecutive same-direction air volt
  voltStackMax: 3, // air volts stop compounding past this many stacks

  mu: 1.1,         // tire friction coefficient
  rollRes: 9,      // rolling resistance (spin decel, rad/s^2, on contact)
  bounce: 0.3,     // restitution of a belly impact (elastic bar rebound)
  bounceMin: 0.8,  // impact speed (m/s) below which contact is inelastic,
                   // so rolling contact stays planted instead of jittering
  wheelBounce: 0.3,    // tire restitution at full slam speed
  wheelBounceLo: 1.5,  // impact speed (m/s) where tire rebound starts...
  wheelBounceHi: 4.0,  // ...and where it reaches full strength: mild hits
                       // and post-slam chatter land dead, real slams keep
                       // the whole elastic-bar kick

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
    // a polygon nested inside another is a solid island in the playable
    // area (evenodd fill), so its playable side is the inverse
    const island = L.polygons.some(p =>
      p !== poly && pointInPoly(poly[0][0], poly[0][1], p));
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const s = { ax: a[0], ay: a[1], bx: b[0], by: b[1] };
      segments.push(s);
      const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      // grass grows on edges that are not too steep and face the playable side upward
      if (Math.abs(dx) > 0.001 && Math.abs(dy / dx) < 2.0) {
        const up = pointInPoly(mx, my - 0.3, poly);
        const down = pointInPoly(mx, my + 0.3, poly);
        if (island ? (down && !up) : (up && !down)) grass.push(s);
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
    this.turnT = 9;  // seconds since last turn-around (drives the flip animation)
    this.voltCd = 0;  // time until the next volt may start
    this.voltAge = 9; // time since the current volt began (>= voltDur = idle)
    this.voltDir = 0;
    this.voltCombo = 0;     // consecutive same-direction airborne volts
    this.voltWasAir = false; // last volt fired while fully airborne
    this.voltBoost = 1;     // strength multiplier locked in at volt start
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

  flip() {
    this.facing *= -1;
    this.turnT = 0;
  }

  step(dt, input, segs) {
    if (this.dead) return;
    this.turnT += dt;
    const P = PHYS;
    const c = Math.cos(this.angle), s = Math.sin(this.angle);

    let fx = 0, fy = P.frameM * P.g, torque = 0;
    // lean ("volt") control: the rider throws his weight in one big thrust,
    // Elasto Mania style — at most one per voltEvery, same strength on the
    // ground and in the air, re-volting on the interval while a key is held.
    // Torque follows a half-sine burst so the rotation winds up smoothly,
    // and it fades as the spin rate approaches voltRate, so repeated volts
    // top the spin back up to a ceiling instead of winding it up forever
    this.voltCd -= dt;
    const lean = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const air = !this.wheels.some(w => w.onGround);
    if (!air) { this.voltCombo = 0; this.voltWasAir = false; }
    if (lean !== 0 && this.voltCd <= 0) {
      // consecutive same-direction volts in the air compound: each one
      // boosts both the thrust and the spin ceiling it saturates toward,
      // so a few stacked thrusts wind up a fast spin. Ground contact or
      // a direction change resets the stack
      this.voltCombo = air && this.voltWasAir && lean === this.voltDir
        ? Math.min(P.voltStackMax, this.voltCombo + 1) : 0;
      this.voltBoost = 1 + P.voltStack * this.voltCombo;
      this.voltWasAir = air;
      this.voltCd = P.voltEvery;
      this.voltAge = 0;
      this.voltDir = lean;
    }
    if (this.voltAge < P.voltDur) {
      const env = Math.sin(Math.PI * this.voltAge / P.voltDur);
      const sat = Math.min(1, Math.max(0,
        1 - this.voltDir * this.avel / (P.voltRate * this.voltBoost)));
      torque += this.voltDir * P.voltT * this.voltBoost * env * sat;
      this.voltAge += dt;
    }

    // fast spins sling the wheels outward: the spring's rest anchor extends
    // radially with the square of the spin rate, like elastic bars. The
    // maxStretch clamp below still bounds total travel from the raw anchor
    const sling = 1 + Math.min(P.spinExtMax, P.spinExt * this.avel * this.avel) /
      Math.hypot(P.anchorX, P.anchorY);
    for (let i = 0; i < 2; i++) {
      const w = this.wheels[i];
      const lx = (i === 0 ? -1 : 1) * P.anchorX * sling, ly = P.anchorY * sling;
      const ax = this.pos.x + lx * c - ly * s;
      const ay = this.pos.y + lx * s + ly * c;
      const rx = ax - this.pos.x, ry = ay - this.pos.y;
      // velocity of the anchor point on the frame
      const avx = this.vel.x - this.avel * ry;
      const avy = this.vel.y + this.avel * rx;

      // spring + damper between wheel and anchor. The damper is digressive:
      // it fades with relative speed, so slow motion (launch squat, weight
      // shifts) is firmly damped while fast motion (landing impacts) keeps
      // its energy in the spring and bounces back out
      const dx = w.pos.x - ax, dy = w.pos.y - ay;
      const rvx = w.vel.x - avx, rvy = w.vel.y - avy;
      const cf = P.springC /
        (1 + (rvx * rvx + rvy * rvy) / (P.springCFade * P.springCFade));
      const Fx = -P.springK * dx - cf * rvx;
      const Fy = -P.springK * dy - cf * rvy;
      w.vel.x += (Fx / P.wheelM) * dt;
      w.vel.y += (Fy / P.wheelM + P.g) * dt;
      fx -= Fx;
      fy -= Fy;
      torque += rx * (-Fy) - ry * (-Fx);

      if (i === this.rearIndex && input.throttle) {
        const before = w.spin;
        const eT = P.engineT * (1 + P.engineLow *
          Math.max(0, 1 - Math.abs(w.spin) / P.engineKnee));
        w.spin += (eT / P.wheelI) * dt * this.facing;
        if (w.spin > P.maxSpin) w.spin = P.maxSpin;
        if (w.spin < -P.maxSpin) w.spin = -P.maxSpin;
        // engine reaction torque pitches the frame backward (wheelies,
        // and mid-air attitude adjustment) until the wheel maxes out;
        // weaker in the air so gas doesn't overpower the lean controls.
        // the reaction fades as pitch-back rotation builds, so a held
        // wheelie climbs slowly instead of snapping over — until gravity
        // takes it past the balance point
        if (w.spin !== before) {
          const back = this.avel * -this.facing; // current pitch-back rate
          const fade = Math.min(1, Math.max(0, 1 - back / P.wheelieRate));
          torque -= P.engineR * this.facing * (w.onGround ? 1 : 0.4) * fade;
        }
      }
      if (input.brake) {
        const newSpin = w.spin * Math.max(0, 1 - P.brakeRate * dt);
        // the brake is a clutch between wheel and frame: its reaction
        // tips the bike toward the direction of travel, in proportion
        // to how hard the wheel is being slowed; faded near the pitch
        // cap so a stoppie stays controlled
        const tip = P.wheelI * (w.spin - newSpin) / dt;
        const sgn = tip > 0 ? 1 : -1;
        // longer rate lookahead than the static cap needs: the springy
        // front end stores pitch energy the fade can't see, so fast
        // rotation has to be cut well before the cap
        const pred = sgn * (this.angle + this.avel * 0.45);
        torque += P.brakeR * tip *
          Math.min(1, Math.max(0, 1 - pred / P.brakeCap));
        w.spin = newSpin;
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

    for (const w of this.wheels) this.wheelContacts(w, segs, dt, input.brake);

    // the frame body collides with the ground too: on a slammed landing
    // the wheels splay sideways and the frame dives between them, so the
    // belly is what actually meets the ground — and it bounces off (the
    // elastic bars fire the whole bike back up) instead of letting the
    // head carry on through
    for (const seg of segs) {
      const cp = closestOnSeg(this.pos.x, this.pos.y, seg);
      let nx = this.pos.x - cp.x, ny = this.pos.y - cp.y;
      const d = Math.hypot(nx, ny);
      if (d >= P.frameR || d === 0) continue;
      nx /= d; ny /= d;
      this.pos.x += nx * (P.frameR - d);
      this.pos.y += ny * (P.frameR - d);
      const vn = this.vel.x * nx + this.vel.y * ny;
      if (vn < 0) {
        const e = -vn > P.bounceMin ? P.bounce : 0;
        this.vel.x -= nx * vn * (1 + e);
        this.vel.y -= ny * vn * (1 + e);
      }
    }

    // rolling resistance: grounded wheels slowly shed spin, which bleeds
    // bike speed through tire friction and lets it coast to a full stop
    for (const w of this.wheels) {
      if (!w.onGround) continue;
      const dec = (P.rollRes + 0.15 * Math.abs(w.spin)) * dt;
      if (Math.abs(w.spin) <= dec) w.spin = 0;
      else w.spin -= Math.sign(w.spin) * dec;
    }

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

  wheelContacts(w, segs, dt, braking) {
    const P = PHYS;
    w.onGround = false;
    for (const seg of segs) {
      const cp = closestOnSeg(w.pos.x, w.pos.y, seg);
      let nx = w.pos.x - cp.x, ny = w.pos.y - cp.y;
      const d = Math.hypot(nx, ny);
      if (d >= P.wheelR || d === 0) continue;
      w.onGround = true;
      nx /= d; ny /= d;

      // positional correction
      const pen = P.wheelR - d;
      w.pos.x += nx * pen;
      w.pos.y += ny * pen;

      // normal impulse: tire rebound ramps in with impact speed instead
      // of switching on — a real slam keeps the whole elastic-bar kick,
      // while mild hits (and the once-rebounded remnants of a slam) land
      // dead, so touchdowns plant instead of chattering
      const vn = w.vel.x * nx + w.vel.y * ny;
      let jn = 0;
      if (vn < 0) {
        const ramp = (-vn - P.wheelBounceLo) / (P.wheelBounceHi - P.wheelBounceLo);
        const e = P.wheelBounce * Math.min(1, Math.max(0, ramp));
        jn = -(1 + e) * vn * P.wheelM;
        w.vel.x += nx * jn / P.wheelM;
        w.vel.y += ny * jn / P.wheelM;
      }

      const tx = -ny, ty = nx;
      const vg = w.vel.x * tx + w.vel.y * ty; // contact tangential velocity
      // a held brake on a nearly stopped wheel is a parking clamp: the
      // wheel is rigid with the frame, so ANY contact motion is slip —
      // ordinary friction would let the wheel slow-roll down the hill
      // forever (the brake decays spin, friction re-spins it to match
      // the creep). Static grip is also far stronger than sliding grip,
      // so the bike holds until the grade gets very steep
      if (braking && Math.abs(w.spin) * P.wheelR < P.parkVt &&
          Math.abs(vg) < P.parkVt) {
        let jp = -vg * P.wheelM;
        const cap = P.parkMu * jn;
        if (jp > cap) jp = cap;
        if (jp < -cap) jp = -cap;
        w.vel.x += tx * jp / P.wheelM;
        w.vel.y += ty * jp / P.wheelM;
        // contacts run after this frame's integration, so the creep the
        // velocity clamp cancels has already landed in the position —
        // back it out too (by the velocity actually removed, so a capped
        // clamp on a too-steep grade still slides), else the bike inches
        // downhill one a*dt^2 step per frame forever
        w.pos.x += tx * (jp / P.wheelM) * dt;
        w.pos.y += ty * (jp / P.wheelM) * dt;
        w.spin = 0;
        continue;
      }
      // tire friction: drive contact-point tangential slip toward zero,
      // clamped by the Coulomb limit
      const vt = vg - P.wheelR * w.spin;
      const meff = 1 / (1 / P.wheelM + P.wheelR * P.wheelR / P.wheelI);
      let jt = -vt * meff;
      const maxF = P.mu * jn;
      if (jt > maxF) jt = maxF;
      if (jt < -maxF) jt = -maxF;
      w.vel.x += tx * jt / P.wheelM;
      w.vel.y += ty * jt / P.wheelM;
      w.spin += (-P.wheelR * jt) / P.wheelI;
      // with the wheel locked, skid friction torque can't spin it up;
      // the brake clutch passes it to the frame instead, pitching the
      // bike toward the direction of travel in proportion to the decel.
      // the torque fades as pitch builds, so a hard stop gives a
      // controlled stoppie instead of throwing the rider over the bars
      if (braking) {
        const tip = -P.wheelR * jt;
        const sgn = tip > 0 ? 1 : -1;
        // fade on predicted pitch (angle + lookahead on spin rate) so the
        // built-up rotation can't ballistically carry past the cap; the
        // lookahead matches the brake clutch above
        const pred = sgn * (this.angle + this.avel * 0.45);
        const fade = Math.min(1, Math.max(0, 1 - pred / P.brakeCap));
        this.avel += tip * P.brakeSkid * fade / P.frameI;
      }
    }
  }
}
