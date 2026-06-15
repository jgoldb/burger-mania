'use strict';

// Tuning constants for the bike. Units: meters, seconds, radians.
const PHYS = {
  g: 4,
  airGrav: 0.7,   // gravity multiplier while BOTH wheels are off the ground.
                   // The AIR-TIME lever: lowering it floats jumps higher and
                   // longer (peak height & hang time both scale 1/airGrav, so
                   // 0.75 ~ +33%) WITHOUT touching the ground hold — on contact
                   // the bike still gets full g, so a volt can't tip it off as
                   // easily as globally lowering g did. Both frame and wheels
                   // share the one value, so the airborne bike floats as a rigid
                   // projectile (the suspension spring is internal/relative, so
                   // its shape is unchanged). Side effect: a given drop lands a
                   // touch softer (impact speed = sqrt(2*airGrav*g*h)), i.e.
                   // slightly more forgiving falls. 1 = no float (old behaviour)

  wheelR: 0.4,
  wheelM: 0.22,
  wheelI: 0.018,

  frameM: 1.3,     // frame mass. Raised 1.0->1.3 over the feel passes to give
                   // the bike more heft — it was getting tossed around by
                   // impacts too easily and felt underweight
  frameI: 0.55,    // frame rotational inertia. Raised 0.35->0.55: the SAME volt
                   // torque now spins the bike up more slowly, so a lean feels
                   // like shifting real weight instead of flicking a light
                   // frame. This is the main "harder to volt / heavier" lever
                   // (engine wheelie and brake stoppie get a touch heavier too)

  springK: 42,     // soft suspension: low rate so the bike gives a lot per
                   // bump. Softened 60->42 — the ride felt too stiff. A lower
                   // rate also lengthens the spring period (slower recoil) and
                   // raises the damping ratio (less bouncy). Static sag is still
                   // small (frameM*g/2K ~ 6cm)
  springC: 5.0,
  springCFade: 12, // relative speed (m/s) where the suspension damper fades to
                   // half. Raised 5->12 to make the bike take a harder hit: the
                   // body has no terrain collider (it sinks through on a big
                   // enough slam, dragging the head to its death), so how far the
                   // frame bottoms out — and thus the fatal fall height — is set
                   // by how much of the impact the suspension soaks up. A higher
                   // fade keeps the damper biting deep into a fast compression,
                   // so the rider SURVIVES BIGGER DROPS (flat-slam death ~12->15
                   // m/s, ~19m->28m of fall) and hard landings plant instead of
                   // springing back. The spring RATE (plushness/give-per-bump)
                   // is untouched — this is the fall-toughness lever: higher =
                   // tougher + more planted, lower = bouncier and dies lower
  maxStretch: 5.0,  // FAR safety backstop on suspension travel from the raw
                    // anchor — the wheels can never escape past this, but it's
                    // set way out so normal play never reaches it. The real
                    // limiter on the spin-fling is now the progressive extension
                    // spring (stretchSoft/stretchK below), which resists more and
                    // more the further the wheel flings instead of hard-capping.
                    // Raised 1.2->4.0 so that progressive spring, not this wall,
                    // shapes the fling
  stretchSoft: 1.8, // wheel distance from the frame CENTRE (m) where the
                    // progressive extension spring starts to bite. Set beyond the
                    // wheel's normal fling reach so ordinary riding and landings
                    // (the wheel sits closer to the centre under compression)
                    // never feel it — only a fast spin flings a wheel out this far
  stretchK: 200,    // stiffness of the progressive extension spring (force grows
                    // with overshoot² past stretchSoft). Higher = wheels fling
                    // less far and snap back harder; lower = they stretch further.
                    // At 200 a wheel reaches ~2.4 from centre at 15 rad/s spin,
                    // ~3.4 at 30 (vs the old flat 1.83 cap), and keeps growing
  frameR: 0.45,    // frame body radius — used ONLY as the body's lethal contact
                   // radius against nut mounds now (see Bike.step). The body has
                   // no terrain collider, so this never touches rock
  spinExt: 0.022,   // anchor extension (m) per (rad/s)^2 of frame spin
  spinExtMax: 0.28, // cap on the spin-driven REST extension. Kept modest: this
                    // is how far the slung anchor sits out during *sustained*
                    // rotation, so raising it pushes the wheels into the wall
                    // riding a loop. The dramatic stretch comes from momentum
                    // flinging the wheel past the rest, out to maxStretch

  engineT: 1.1,    // torque applied to the driven (rear) wheel
  engineLow: 0.25, // extra low-end torque fraction: full extra at zero
                   // wheel spin, gone by engineKnee. Steep-hill starts get
                   // the grunt without raising cruise acceleration
  engineKnee: 12,  // wheel spin (rad/s, ~4.8 m/s) where the extra runs out
  engineR: 6.5,    // reaction torque on the frame while the engine spins up
  wheelieRate: 0.5, // rad/s pitch-back rate the engine reaction saturates at
  maxSpin: 55,     // rad/s cap on driven wheel spin
  brakeRate: 30,   // exponential lock rate for both wheels
  brakeR: 0.32,    // fraction of brake torque reacted onto the frame
  brakeSkid: 1.0,  // skid friction torque multiplier passed to the frame.
                   // Halved alongside the brakeGrip boost below: the stronger
                   // brakes shed a lot more momentum, and the skid torque
                   // scales with that braking force, so without this cut a
                   // hard stop would just throw the rider over the bars
  brakeGrip: 2.2,  // the locked tire bites the rock this many times harder
                   // than rolling traction (P.mu) while the brake is held —
                   // a brake-only grip boost, so the bike STOPS hard without
                   // changing how it accelerates or climbs (engine traction
                   // still uses plain P.mu, so the tuned maps are untouched).
                   // Glass is exempt (still crossed on momentum alone), and
                   // braking stays endo-limited, so slamming the brakes at
                   // speed still pitches you over — this just raises the
                   // deceleration the front end can deliver before that
  brakeCap: 0.5,   // stoppie pitch (rad) the brake torque fades out at
  parkMu: 1.9,     // static friction once the brake has fully clamped a
                   // stopped wheel: a held brake parks the bike on a hill
                   // instead of creeping, until the grade gets very steep
  parkVt: 0.7,     // contact speed (m/s) below which the clamp grabs; also
                   // sets the break-away grade (~45deg): on steeper slopes
                   // the braked slow-roll never gets slow enough to clamp

  // Volt = the rider's lean: a DISCRETE thrust throttled to one per voltEvery,
  // so holding a key can't spam rotation (Elasto Mania volting). GROUND and AIR
  // use different models (see Bike.step): GROUNDED it's a smooth voltT torque
  // burst (a weight shift for balance / wheelie / tip), faded toward voltGroundCap.
  // MID-AIR it's a fixed instantaneous voltKick boost to the spin, clamped at
  // voltMaxSpin — and airborne the frame spins freely (no spring/avelDamp bleed),
  // so volts wind the spin cleanly up to voltMaxSpin and hold it there.
  voltT: 26.75,       // GROUND volt torque (applied for voltDur). Tuned so 3 held
                   // volts just barely tip the parked bike over (either way) and
                   // a forward volt cancels the gas wheelie-pitch + a touch. Only
                   // affects the GROUND volt — the air volt uses voltKick
  voltDur: 0.1,    // how long one GROUND volt's torque burst lasts — the actual
                   // physics "boost". Kept SHORT/snappy; the arm-flick (render.js
                   // VOLT_PUMP) and volt sound run longer (0.5s) as a cosmetic
                   // flourish, deliberately NOT matched to this. (Air volts are
                   // instant; this only sets the grounded thrust length)
  voltEvery: 1.0,  // throttle: minimum seconds between volts even while a key is
                   // held (~1 volt/sec). Also paces the arm-flick + volt sound
  voltMaxSpin: 15, // rad/s — THE max air-volt spin (genuinely reached now that
                   // airborne spin doesn't bleed; see `grounded` in step()). This
                   // is your top rotation rate: set it to the spin you want. Air
                   // volts wind up to exactly this and hold there
  voltKick: 1.5,    // rad/s a single AIR volt adds to the spin, INSTANTLY (fixed).
                   // Purely the WIND-UP SPEED now: how fast you climb to
                   // voltMaxSpin (reached in ~voltMaxSpin/voltKick volts), NOT the
                   // ceiling. Bigger = punchier per volt + fewer volts to top out.
                   // Ground volts ignore this — they use the voltT torque burst
  voltGroundCap: 12, // GROUND volt's own spin-fade reference (rad/s): the ground
                   // torque burst eases off as the bike spins toward this. Pinned
                   // separate from voltMaxSpin so the air cap can't change ground
                   // feel — voltT alone sets grounded lean strength
  avelDamp: 0.12,  // angular "drag" bled off avel per second. Keeps rotation
                   // from feeling floaty — a higher value settles spins faster

  mu: 1.1,         // tire friction coefficient
  muGlass: 0.06,   // tire friction on obsidian glass: the engine can barely
                   // push and the brakes barely bite, so glass is crossed on
                   // momentum alone (the parking clamp never engages on it)
  gripSlip: 2,     // contact slip (m/s, tyre-surface speed vs ground) past which
                   // the tyre BITES harder on rock — below this, normal traction
                   // (cruising/accel slip is only ~0.1-0.4) is untouched
  gripBite: 4,     // how much harder the tyre grips at high slip (× mu). Lands a
                   // spun-up wheel HARD: instead of skating ~0.2s while a fast-
                   // spinning wheel syncs to the ground, the slip hooks it up fast
                   // — the weight slams it toward a halt. Glass & braking exempt
  gripGasResist: 0.5, // fraction of the extra grip-bite the DRIVEN wheel keeps
                   // while the THROTTLE is held (1 = full bite, 0 = no bite/base
                   // grip). The engine fights the grip's deceleration, so a
                   // powered wheel keeps spinning a bit longer (more wheelspin)
                   // before it hooks up, vs a freewheeling wheel that grips clean.
                   // A subtle but noticeable on-power-vs-coasting landing difference
  rollRes: 9,      // rolling resistance (spin decel, rad/s^2, on contact)
  dragV0: 19,      // speed (m/s) below which there is no air drag at all:
                   // the tuned maps top out ~17 m/s (Sriracha's spiral dive),
                   // so leaving the normal range drag-free keeps every map's
                   // ballistics bit-identical. Drag only bites past this
  drag: 0.03,      // quadratic air drag (1/m) on the speed ABOVE dragV0: a
                   // mass-independent decel of drag*(|v|-dragV0)^2 that sets
                   // the top speed. Free-fall terminal is dragV0+sqrt(g/drag)
                   // ~ 34 m/s, and it's the SAME on the gas or coasting, so a
                   // long descent can't be out-run by idling. The engine tops
                   // out at maxSpin*wheelR (~22) on the flat, so the gas is
                   // always the faster choice up to there and never slower
                   // past it (it just stops adding once drag has the lead)
  // The body has no terrain collider at all (see Bike.step): nothing holds the
  // frame off a surface, so a hard enough slam sinks it straight through and the
  // head is dragged down to its death. This is what makes a big drop fatal — the
  // survive/die line falls out of impact force vs. suspension stiffness, with no
  // belly spring, no speed cutoff and no special-casing.
  wheelBounce: 0.18,   // tire restitution at full slam speed (0.3->0.18:
                       // less dramatic rebound off surfaces)
  wheelBounceLo: 1.5,  // impact speed (m/s) where tire rebound starts...
  wheelBounceHi: 4.0,  // ...and where it reaches full strength: mild hits
                       // and post-slam chatter land dead, real slams keep
                       // the whole elastic-bar kick
  wheelMeetDamp: 0.6,  // fraction of the wheels' SEPARATING relative velocity
                       // bled off per step while they overlap (centres within
                       // 2*wheelR). Soaks up the suspension-spring rebound after
                       // the two wheels are smashed together so they spring back
                       // softly instead of pinging apart; 0 disables, 1 fully
                       // cancels the rebound. Only damps separation (never adds
                       // a push), so wheels can still overlap almost completely

  // Crash trip. A motorcycle that slams the ground doesn't politely bounce off
  // a tyre — its momentum carries it OVER the planted wheel (face-first if it
  // came in nose-down, over the tail on the rear wheel). These constants turn a
  // hard wheel impact into that throw. (The fall-from-too-high death is handled
  // separately, by the body having no collider — the frame just sinks through.)
  tripMin: 6,      // closing speed (m/s) a wheel impact must exceed before it
                   // trips the frame at all. Below this — rolling contact,
                   // gentle landings, post-bounce chatter — nothing trips, so
                   // ordinary riding is untouched
  tripFull: 16,    // closing speed where the trip reaches full strength
  tripGain: 0.6,   // how hard a full slam pivots the frame toward rotating
                   // about the planted wheel (1 = the frame instantly takes
                   // that pivot's angular velocity, i.e. goes fully over the
                   // bars). A steep one-wheel slam trips hard and drives the
                   // head down; a FLAT two-wheel slam cancels — the wheels
                   // pivot opposite ways — so clean both-wheel landings, even
                   // fast ones, don't trip (they only pick up a mild forward
                   // nod from forward speed). This is the "thrown forward /
                   // backward on a crash" lever

  headR: 0.24,
  headX: -0.18,    // head offset in frame space (x is mirrored by facing)
  headY: -0.90,

  nutR: 0.45,      // lethal radius of a nut mound — this world's "killer", the
                   // Elasto Mania spinning-spike equivalent. Touching one with
                   // ANY bike part (head, either wheel, or the frame body) is
                   // instantly fatal. A touch tighter than the drawn pile so
                   // death only fires once a part is clearly buried in it

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
// Edges listed in L.glassEdges ([[polyIndex, edgeIndex], ...]) are obsidian
// glass: solid like rock, but the tires get almost no grip on them, so glass
// is ridden on banked momentum. The edge index is the segment from poly[i] to
// poly[i+1] — painted per-edge so stacked polygons at the same x stay
// distinct. L.glass ([[x0, x1], ...], glass wherever a segment's midpoint x
// falls in a span) is the legacy form, still honoured so old maps and replays
// play unchanged.
// L.nuts ([[x, y], ...]) are nut mounds — lethal "killer" hazards the rider
// dies on contact with (see PHYS.nutR / Bike.step). They pass straight through
// here untouched; the sim reads L.nuts directly.
function prepareLevel(L) {
  const segments = [], grass = [], glassTops = [];
  const glassSpans = L.glass || [];
  const glassEdges = new Set((L.glassEdges || []).map(e => e[0] + ':' + e[1]));
  L.polygons.forEach((poly, pi) => {
    // a polygon nested inside another is a solid island in the playable
    // area (evenodd fill), so its playable side is the inverse
    const island = L.polygons.some(p =>
      p !== poly && pointInPoly(poly[0][0], poly[0][1], p));
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const s = { ax: a[0], ay: a[1], bx: b[0], by: b[1] };
      const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
      s.glass = glassEdges.has(pi + ':' + i) ||
        glassSpans.some(r => mx >= r[0] && mx <= r[1]);
      segments.push(s);
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      // grass grows on edges that are not too steep and face the playable
      // side upward; glass gets a sheen instead
      if (Math.abs(dx) > 0.001 && Math.abs(dy / dx) < 2.0) {
        const up = pointInPoly(mx, my - 0.3, poly);
        const down = pointInPoly(mx, my + 0.3, poly);
        if (island ? (down && !up) : (up && !down)) {
          (s.glass ? glassTops : grass).push(s);
        }
      }
    }
  });
  return Object.assign({}, L, { segments, grass, glassTops });
}

class Bike {
  constructor(x, y) {
    this.pos = { x, y };
    this.vel = { x: 0, y: 0 };
    this.angle = 0;
    this.avel = 0;
    this.facing = 1; // 1 = right, -1 = left
    this.turnT = 9;  // seconds since last turn-around (drives the flip animation)
    this.voltCd = 0;  // throttle timer: time until the next volt may fire (also
                      // drives the rider's arm-flick in render.js + volt sound)
    this.voltAge = 9; // time since the current volt thrust began (>=voltDur=idle)
    this.voltDir = 0; // direction (-1/+1) of the current volt thrust
    this.grav = 1;          // gravity direction: +1 pulls down (normal), -1 up.
                            // An upside-down burger flips it, Elasto-Mania
                            // gravity-apple style, so the bike rides ceilings
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

  // `kills` is the level's nut mounds as [x, y] points (omitted on maps that
  // have none); touching any of them is fatal. Optional so the headless
  // harnesses and old call sites that pass only segments keep working.
  step(dt, input, segs, kills) {
    if (this.dead) return;
    this.turnT += dt;
    const P = PHYS;
    // grounded = at least one wheel touched last step (contacts run later, so
    // this is the previous step's state — a 1-frame lag that doesn't matter).
    // Airborne, the frame rotates FREELY (volt-driven): the wheel-spring torque
    // and avelDamp are both skipped, so an air spin holds and air volts wind it
    // up cleanly to voltMaxSpin instead of the suspension bleeding it back down.
    const grounded = this.wheels.some(w => w.onGround);
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    // gravity acceleration, signed by this.grav so an upside-down burger can
    // invert it (the whole bike — frame and both wheels — shares the one sign,
    // so flipping it just changes which way everything falls), and scaled by
    // airGrav once airborne so jumps float without weakening the ground hold
    const gy = P.g * this.grav * (grounded ? 1 : P.airGrav);

    let fx = 0, fy = P.frameM * gy, torque = 0;
    // lean ("volt"): a DISCRETE rider thrust throttled to one per voltEvery, so
    // holding a key can't spam rotation (Elasto Mania volting).
    //  - GROUNDED (either wheel touching): a smooth torque burst over voltDur —
    //    a weight shift for balance / wheelie / tip-over.
    //  - MID-AIR (both wheels off): an INSTANTANEOUS boost instead — each volt
    //    adds a FIXED voltKick to the spin (same size at any voltMaxSpin), so it
    //    reads as a discrete thrust rather than a smooth ramp. voltMaxSpin is a
    //    plain ceiling that clamps the total; it does NOT scale the per-volt
    //    boost. Only adds toward the lean, never pulls down spin already past the
    //    cap (e.g. from a crash). Co-rotating the wheels makes the boost stick.
    this.voltCd -= dt;
    const lean = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (lean !== 0 && this.voltCd <= 0) {
      this.voltCd = P.voltEvery;  // throttle: no next volt until this elapses
      this.voltDir = lean;        // remember the lean (drives the arm-flick dir,
                                   // both grounded and air; sim-inert in the air)
      if (grounded) {
        this.voltAge = 0;         // grounded: start a smooth torque burst
      } else {
        // mid-air: a FIXED instantaneous boost (voltKick) per volt — the SAME
        // size at ANY voltMaxSpin, so the cap is purely a ceiling, not a volt-
        // strength knob (raising it just takes more volts to reach the top, it
        // doesn't make each volt punchier). Hard-clamped at voltMaxSpin in the
        // lean direction; never pulls down spin already past the cap (e.g. from
        // a crash). Reads as a discrete thrust per volt.
        const before = this.avel;
        this.avel += lean * P.voltKick;
        if (lean > 0) this.avel = Math.min(this.avel, Math.max(P.voltMaxSpin, before));
        else          this.avel = Math.max(this.avel, Math.min(-P.voltMaxSpin, before));
        // co-rotate the wheels by the boost actually applied (v += dav × r) so
        // the suspension doesn't drag the jump straight back down — it sticks
        // instead of sagging. (The spin still tops out where voltKick can no
        // longer overcome the wheels' rising centripetal-sling cost; that ceiling
        // scales with voltKick, and voltMaxSpin caps below it.)
        const dav = this.avel - before;
        for (const w of this.wheels) {
          w.vel.x -= dav * (w.pos.y - this.pos.y);
          w.vel.y += dav * (w.pos.x - this.pos.x);
        }
        this.voltAge = P.voltDur; // no ground-style burst for an air volt
      }
    }
    if (this.voltAge < P.voltDur) {
      const spinDir = this.voltDir * this.avel; // current spin toward the lean
      // ground burst eases off toward voltGroundCap (its OWN reference, not the
      // air voltMaxSpin) so the air cap can't secretly change ground strength
      const room = Math.min(1, Math.max(0, 1 - spinDir / P.voltGroundCap));
      torque += this.voltDir * P.voltT * room;
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

      // spring + damper between wheel and anchor. The damper measures the
      // wheel's velocity against RIGID co-rotation at the wheel's OWN position —
      // not the anchor's velocity. A wheel slung out past its anchor co-rotates
      // faster than the anchor does, so referencing the anchor baked in a fake
      // steady velocity difference: damping it dragged the wheel around its
      // centre (orbit), and fading the damper on it left the radial spring free
      // to wobble in and out. Against the wheel's own rigid velocity that
      // difference vanishes, so a clean spin produces no damper force at all and
      // the wheel settles into a steady outward sling; only true wobble/orbit is
      // damped. The digressive fade still lets a real radial slam bounce elastic.
      const dx = w.pos.x - ax, dy = w.pos.y - ay;
      const rbx = this.vel.x - this.avel * (w.pos.y - this.pos.y);
      const rby = this.vel.y + this.avel * (w.pos.x - this.pos.x);
      const rvx = w.vel.x - rbx, rvy = w.vel.y - rby;
      const cf = P.springC /
        (1 + (rvx * rvx + rvy * rvy) / (P.springCFade * P.springCFade));
      const Fx = -P.springK * dx - cf * rvx;
      const Fy = -P.springK * dy - cf * rvy;
      w.vel.x += (Fx / P.wheelM) * dt;
      w.vel.y += (Fy / P.wheelM + gy) * dt;
      fx -= Fx;
      fy -= Fy;
      // wheel-spring reaction torque on the frame — only while grounded. In the
      // air this is the transient that bled an air volt's boost straight back
      // down (boost to 20 → sag to ~15), which is what made voltMaxSpin unable
      // to bind; skipping it lets the spin hold and reach the cap. The spring
      // FORCE on the wheel (Fx/Fy) still applies, so the wheels still sling out.
      if (grounded) torque += rx * (-Fy) - ry * (-Fx);

      // progressive extension spring: as a wheel is flung far from the frame
      // CENTRE (fast spin), a steeply rising force resists it — the further out,
      // the exponentially harder it is to pull (force ∝ overshoot², a stiffening
      // spring), so there's no hard travel cap, just mounting resistance that
      // stores the energy and slings the wheel back when the spin drops. It's
      // purely RADIAL (toward the centre), so it adds NO torque — the free air
      // spin is untouched. Only engages past stretchSoft, which is well beyond
      // the wheel's normal travel, so ordinary riding and landings (the wheel
      // sits closer to the centre under compression) never feel it.
      const cwx = w.pos.x - this.pos.x, cwy = w.pos.y - this.pos.y;
      const crad = Math.hypot(cwx, cwy);
      if (crad > P.stretchSoft) {
        const over = crad - P.stretchSoft;
        const fProg = P.stretchK * over * over;     // stiffening (progressive)
        const ux = cwx / crad, uy = cwy / crad;     // outward radial unit
        w.vel.x -= (ux * fProg / P.wheelM) * dt;    // pull the wheel inward
        w.vel.y -= (uy * fProg / P.wheelM) * dt;
        fx += ux * fProg;                            // equal/opposite on frame
        fy += uy * fProg;                            // (radial → no torque)
      }

      // the engine only winds the wheel UP to maxSpin; it never reaches in
      // to slow a wheel that traction has already spun past the cap on a
      // fast descent. (The old unconditional clamp braked that overspin,
      // which made holding the gas downhill SLOWER than coasting — the
      // drag terminal below is what actually limits top speed now.)
      if (i === this.rearIndex && input.throttle &&
          w.spin * this.facing < P.maxSpin) {
        const before = w.spin;
        const eT = P.engineT * (1 + P.engineLow *
          Math.max(0, 1 - Math.abs(w.spin) / P.engineKnee));
        w.spin += (eT / P.wheelI) * dt * this.facing;
        // cap the engine's own wind-up without clawing back the extra
        if (w.spin * this.facing > P.maxSpin) w.spin = P.maxSpin * this.facing;
        // engine reaction torque pitches the frame backward (wheelies, and
        // mid-air attitude adjustment); weaker in the air so gas doesn't
        // overpower the lean controls. Two fades stack:
        //  - `fade` on pitch-back rate, so a held wheelie climbs slowly
        //    instead of snapping over — until gravity takes it past balance.
        //  - `accelLeft` on remaining engine headroom (1 at a standstill,
        //    0 as the wheel nears maxSpin): the front lift tracks how much
        //    acceleration the engine can still deliver, so the wheelie is
        //    strong off the line and levels out as you reach speed, with none
        //    left at top speed — Elasto Mania style. This scales only the
        //    REACTION (the lift), never eT (forward thrust), so acceleration,
        //    hill-climb and the tuned maps are all unchanged.
        if (w.spin !== before) {
          const back = this.avel * -this.facing; // current pitch-back rate
          const fade = Math.min(1, Math.max(0, 1 - back / P.wheelieRate));
          const accelLeft = Math.max(0, 1 - Math.abs(w.spin) / P.maxSpin);
          torque -= P.engineR * this.facing * (w.onGround ? 1 : 0.4) * fade * accelLeft;
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
    // angular drag only while grounded (settles ground rotation, tames floaty
    // leans). Airborne there's no drag, so a spin holds (Elasto free air spin).
    if (grounded) this.avel *= 1 - P.avelDamp * dt;

    // quadratic linear drag on the speed above dragV0: a mass-independent
    // deceleration applied to the frame and both wheels so the whole bike
    // shares one terminal velocity. This is the real top-speed limit, it
    // doesn't care about throttle (so coasting can never out-run the gas
    // down a long slope), and it's zero in the normal riding range so the
    // tuned maps are untouched. (v-v0)^2 ramps in with zero slope at v0, so
    // there's no kick as it engages
    const dragDecel = (vx, vy) => {
      const sp = Math.hypot(vx, vy);
      if (sp <= P.dragV0) return 0;
      const ex = sp - P.dragV0;
      return P.drag * ex * ex / sp * dt; // fraction of velocity shed this step
    };
    const fDrag = dragDecel(this.vel.x, this.vel.y);
    this.vel.x -= this.vel.x * fDrag;
    this.vel.y -= this.vel.y * fDrag;
    for (const w of this.wheels) {
      const wDrag = dragDecel(w.vel.x, w.vel.y);
      w.vel.x -= w.vel.x * wDrag;
      w.vel.y -= w.vel.y * wDrag;
    }

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

    // Soft wheel-meet. The two wheels have no collider against each other, so
    // on a high-speed smash they pass right through — but each is tethered to
    // its own frame anchor by a suspension spring, and once they're forced
    // together those springs would fling them back apart elastically (the
    // digressive damper has faded out at smash speed), which reads as a harsh
    // bounce. Absorb that rebound: while the wheels actually overlap, bleed off
    // only the SEPARATING part of their relative velocity. There's no push, so
    // they can still smash together and overlap almost completely; the springs
    // just reform the bike gently instead of snapping it back. Confined to real
    // overlap (centres within 2*wheelR), which never happens in normal riding,
    // so the tuned maps and replays are bit-identical away from a crash.
    {
      const w0 = this.wheels[0], w1 = this.wheels[1];
      let nx = w1.pos.x - w0.pos.x, ny = w1.pos.y - w0.pos.y;
      const sep = Math.hypot(nx, ny);
      if (sep > 0 && sep < 2 * P.wheelR) {
        nx /= sep; ny /= sep;
        const rvN = (w1.vel.x - w0.vel.x) * nx + (w1.vel.y - w0.vel.y) * ny;
        if (rvN > 0) { // separating: this is the rebound, damp it
          const depth = (2 * P.wheelR - sep) / (2 * P.wheelR); // 0..1, deeper = stronger
          const j = P.wheelMeetDamp * depth * rvN * 0.5;
          w0.vel.x += nx * j; w0.vel.y += ny * j;
          w1.vel.x -= nx * j; w1.vel.y -= ny * j;
        }
      }
    }

    for (const w of this.wheels) this.wheelContacts(w, segs, dt, input.brake, input.throttle);

    // The body has NO terrain collider — only the wheels and the head touch
    // rock. This is what makes a hard slam fatal: nothing holds the frame off
    // the ground, so once an impact beats the suspension the frame sinks
    // straight through the surface, dragging the head (rigidly above it) down
    // until the head collider below registers the hit and the rider dies. A
    // gentle landing never sinks that far — the planted wheels and the soft
    // suspension carry the frame and the head stays well clear — so it's purely
    // the impact force vs. the suspension that decides survival, no speed cutoff
    // and no special-casing. (The frame is still lethal against nut mounds; that
    // is a separate hazard, handled below.)

    // rolling resistance: grounded wheels slowly shed spin, which bleeds
    // bike speed through tire friction and lets it coast to a full stop
    for (const w of this.wheels) {
      if (!w.onGround) continue;
      const dec = (P.rollRes + 0.15 * Math.abs(w.spin)) * dt;
      if (Math.abs(w.spin) <= dec) w.spin = 0;
      else w.spin -= Math.sign(w.spin) * dec;
    }

    // the head is the only fatal terrain collider
    const h = this.headPos();
    for (const seg of segs) {
      const cp = closestOnSeg(h.x, h.y, seg);
      if (Math.hypot(h.x - cp.x, h.y - cp.y) < P.headR) {
        this.dead = true;
        break;
      }
    }

    // nut mounds — the level's "killers". Unlike terrain, the whole rider is
    // lethal against them: head, either wheel, or the frame body within
    // partR + nutR of a mound's centre kills instantly. Inert on maps with no
    // nuts (kills empty/undefined), so existing tracks and replays are untouched
    if (!this.dead && kills) {
      const parts = [
        [this.pos.x, this.pos.y, P.frameR],
        [h.x, h.y, P.headR],
        [this.wheels[0].pos.x, this.wheels[0].pos.y, P.wheelR],
        [this.wheels[1].pos.x, this.wheels[1].pos.y, P.wheelR],
      ];
      for (const k of kills) {
        for (const part of parts) {
          if (Math.hypot(part[0] - k[0], part[1] - k[1]) < part[2] + P.nutR) {
            this.dead = true;
            break;
          }
        }
        if (this.dead) break;
      }
    }
  }

  wheelContacts(w, segs, dt, braking, throttle) {
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

      // crash trip — over the bars / over the tail. A hard slam doesn't just
      // bounce the tyre: the frame's fall momentum keeps going and pivots the
      // whole bike about the planted wheel. Add a slice of that pivot rate,
      // omega = (r x v) / |r|^2 with r from the wheel to the frame centre,
      // scaled by how hard the wheel drove into the ground. A nose-down slam
      // pivots the head into the floor (face-plant); landing pitched back on
      // the rear wheel throws it over backward. The kick is ADDED (not blended
      // toward), so on a flat both-wheel landing the two wheels contribute
      // exactly opposite omegas that cancel — a clean landing never trips
      // itself over, it just picks up a mild forward nod from forward speed.
      const closing = -vn; // frame/wheel speed driving into the surface
      if (closing > P.tripMin) {
        const rx = this.pos.x - w.pos.x, ry = this.pos.y - w.pos.y;
        const r2 = rx * rx + ry * ry;
        if (r2 > 1e-4) {
          const omega = (rx * this.vel.y - ry * this.vel.x) / r2;
          const hard = Math.min(1, (closing - P.tripMin) / (P.tripFull - P.tripMin));
          this.avel += omega * P.tripGain * hard;
        }
      }

      const tx = -ny, ty = nx;
      const vg = w.vel.x * tx + w.vel.y * ty; // contact tangential velocity
      // a held brake on a nearly stopped wheel is a parking clamp: the
      // wheel is rigid with the frame, so ANY contact motion is slip —
      // ordinary friction would let the wheel slow-roll down the hill
      // forever (the brake decays spin, friction re-spins it to match
      // the creep). Static grip is also far stronger than sliding grip,
      // so the bike holds until the grade gets very steep. Glass has no
      // static grip to speak of: the clamp never engages there
      if (braking && !seg.glass && Math.abs(w.spin) * P.wheelR < P.parkVt &&
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
      // clamped by the Coulomb limit (a sliver of a limit on glass)
      const vt = vg - P.wheelR * w.spin;
      const meff = 1 / (1 / P.wheelM + P.wheelR * P.wheelR / P.wheelI);
      let jt = -vt * meff;
      // a held brake bites far harder than rolling traction (brakeGrip), so
      // the bike stops in a much shorter distance — but only on rock, and
      // only while braking, so acceleration/climbing and glass are unchanged
      let grip = (braking && !seg.glass) ? P.mu * P.brakeGrip
                                         : (seg.glass ? P.muGlass : P.mu);
      // landing/over-spin bite: on rock and off the brake, a wheel slipping hard
      // (tyre surface far off the ground speed — e.g. a spun-up wheel slamming
      // down) grabs much harder so it syncs to the ground FAST instead of skating
      // for ~0.2s. Ramps in only past gripSlip, so normal traction (slip ~0.1-0.4
      // m/s) is unchanged; glass never bites, the brake has its own grip already
      if (!seg.glass && !braking) {
        // the driven wheel under throttle resists the grip's decel (the engine
        // fights it), so it keeps spinning a touch longer — a weaker bite than a
        // freewheeling wheel, which hooks up clean
        const driven = throttle && w === this.wheels[this.rearIndex];
        const biteMax = driven ? 1 + (P.gripBite - 1) * P.gripGasResist : P.gripBite;
        grip *= Math.min(biteMax, Math.max(1, Math.abs(vt) / P.gripSlip));
      }
      const maxF = grip * jn;
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
