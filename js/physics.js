'use strict';

// Tuning constants for the bike. Units: meters, seconds, radians.
const PHYS = {
  g: 2.5,          // ONE uniform gravity, air and ground alike (Elasto Mania — no
                   // air/ground split). Lowered 2.8->2.5 for a floatier, more
                   // Elasto-like arc (gentler falls, hangier air). NOTE: a lighter
                   // bike recoils off the suspension more readily — to stop the
                   // extra hop, springC was raised in step (see below).
                   // The ground feeling too light at this value
                   // was NOT a gravity problem: it was the volt being too strong for
                   // the ledge and the engine wheelie too strong for the volt to
                   // hold down. Those are fixed at their own sources now — voltAcc
                   // (ledge/air rotation) and engineR (wheelie) are independent
                   // levers — instead of papering over both with a heavy-ground
                   // split. gx/gy are scaled by this.gravDir, so a gravity burger
                   // can aim it down/up/left/right (Elasto gravity-apple style)

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

  springK: 42,     // suspension stiffness — UNCHANGED. Sets the drop-death line:
                   // a hard landing must compress the suspension far enough that
                   // the rigidly-attached head reaches terrain (the body has no
                   // collider), and that bottom-out depth scales with K. At 42 the
                   // line sits at ~12.5 m/s / ~28m flat (a touch lower at an angle —
                   // land flat to survive, Elasto-style), where the fall-toughness
                   // was tuned. The springy FEEL comes from the light damping
                   // (springC) below, NOT from changing this
  springC: 4.0,    // suspension damping — THE bounce lever. The old dead value was
                   // 5.0 (damping ratio ~0.82, just absorbs). 2.8 (~0.46) still
                   // recoiled too much, so it's now 4.0 (~0.66) — heavily damped but
                   // still under 1.0, so the suspension RECOILS a little instead of
                   // soaking dead, just with much less bounce-back. Stepped up
                   // alongside the gravity cut too: less gravity to hold the wheels
                   // down means the same recoil hops the lighter bike off the ground
                   // more, so the damper has to soak more to keep it planted.
                   // (2.0 / ~0.33 read as "too bouncy / bike too light".) Barely
                   // touches the spring SPEED — that's springK — so the snappy
                   // expand/collapse is preserved. Lower = bouncier, higher = more
                   // planted; the hard-LANDING bounce specifically is springCFade
  springCFade: 12, // relative speed (m/s) where the suspension damper fades to
                   // half, so a fast compression rides mostly on the spring (and
                   // bounces) instead of being soaked dead. The body has no terrain
                   // collider, so a big enough slam sinks the frame through until
                   // the head hits terrain = death; how far the frame bottoms out
                   // sets that fatal drop height. With springC now lighter the frame
                   // compresses a little more (dies a touch lower) — this is the
                   // fall-toughness fine-tune: higher fade = damper bites deeper into
                   // a slam = tougher falls. Re-tune by playtest with springC
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
  engineR: 4.5,    // reaction torque on the frame while the engine spins up — the
                   // WHEELIE-strength lever, independent of gravity/volt. Lowered
                   // 6.5->4.5: at uniform low gravity the front popped up faster than
                   // a volt could hold it down; a gentler reaction lets the volt
                   // counter the gas wheelie. Higher = stronger wheelie/stoppie
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

  // Volt = the rider's lean. NORMAL volting (one key) is BURSTY — discrete torque
  // PUMPS (Elasto's tap-volting): a pump fires for voltBurstDur every voltCadence,
  // and the gaps between pumps let gravity act (a dangling body sags back, so a
  // ledge recovery is a pump-and-time skill). The ALOVOLT (both keys) is CONTINUOUS
  // instead — a sustained strong clockwise drive while held, the supervolt for big
  // air rotations and recoveries. NEITHER has a hard spin cap: the top rate is
  // EMERGENT, set by the drive torque balancing avelDamp (angular drag) below — the
  // physics decides the ceiling, not a clamp. A fresh normal press pumps at once.
  voltAcc: 21,      // torque of ONE normal volt pump (the punch). Sets normal-volt
                    // rotation (fine control / balance) AND how easily you can pump
                    // off a ledge — keep it modest so a DANGLING body (gravity
                    // resisting) can't be pumped up, while a body whose CoM is still
                    // OVER the ledge (gravity not resisting) rotates back easily.
                    // Raised 17->21 for a harder, snappier punch; burst/cadence were
                    // trimmed in step (below) so the AVERAGE only edged up slightly
  voltBurstDur: 0.125, // seconds each pump applies torque — the length of one punch.
                    // Trimmed 0.133->0.125 (shorter punch). With voltAcc up to 21 and
                    // voltCadence out to 0.66, the AVERAGE torque
                    // (voltAcc*voltBurstDur/voltCadence) goes ~3.77 -> ~3.98: only a
                    // touch stronger overall, delivered in fewer, harder, shorter pumps
  voltCadence: 0.66, // seconds between pump starts while held (~1.5 pumps/s) — fewer,
                    // more distinct pumps (0.45->0.6->0.66). The GAP is where
                    // gravity/damping act on a hang, so a longer gap also makes a
                    // ledge recovery more of a pump-and-time skill
  alovoltAcc: 8,    // CONTINUOUS torque of the alovolt (both keys) — sustained, not
                    // pulsed, so it clearly out-spins the bursty normal volt (emergent
                    // air terminal ≈ alovoltAcc/(frameI*avelDamp) ≈ 6 rad/s). ONE rule,
                    // ground and air — no gate. Kept modest ON PURPOSE: a stronger
                    // sustained torque VAULTS the bike off flat ground (you'd pogo into
                    // flips); at 8 a ground spin reaches only ~0.5 of a turn before the
                    // head hits and crashes — past ~10-11 it starts completing flips. So
                    // the no-flat-ground-flip behaviour falls out of the physics, no gate
  voltReachRate: 14, // 1/s the rider's arm pumps toward fully-leaned DURING each
                    // torque punch and falls back in the gap, so the arm visibly
                    // punches per pump (render.js reads bike.voltReach). Cosmetic
  avelDamp: 2.0,   // angular drag bled off avel per second, ground AND air — settles
                   // rotation between pumps and on release (a volt STOPS instead of
                   // free-spinning) and lets gravity drag a hanging body back in the
                   // pump gaps. Higher = tighter/quicker to settle; lower = floatier

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
  wheelBounce: 0.18,   // tire restitution — kept LOW (0.18). The lively recoil now
                       // comes from the underdamped spring (springC), not a
                       // superball tyre; a HIGH restitution here actually fights
                       // drop-death (it kicks the wheel back up before the head can
                       // bottom out), so it deliberately stays modest
  wheelBounceLo: 1.5,  // impact speed (m/s) where tire rebound starts...
  wheelBounceHi: 4.0,  // ...and where it reaches full strength: mild hits and
                       // post-slam chatter land dead, real slams keep the kick
  wheelMeetDamp: 0.6,  // fraction of the wheels' SEPARATING relative velocity
                       // bled off per step while they overlap (centres within
                       // 2*wheelR). Soaks up the suspension-spring rebound after
                       // the two wheels are smashed together so they spring back
                       // softly instead of pinging apart; 0 disables, 1 fully
                       // cancels the rebound. Only damps separation (never adds
                       // a push), so wheels can still overlap almost completely

  wheelSquish: 0.08,   // how far (m) the tire may DEFORM when it is PINCHED. A
                       // wheel stuck in a narrow slot touches two near-opposing
                       // walls at once; only then does its effective contact
                       // radius shrink by up to this much (scaled by how head-on
                       // the pinch is) for the POSITIONAL push-out, so the two
                       // walls stop shoving it back and forth and its own
                       // momentum can carry it through a gap a little under the
                       // full 2*wheelR. A single-sided contact — all normal
                       // riding and EVERY landing — has no opposing pair, so
                       // squish is 0 there and the tire is rigid: grip, climbing,
                       // bounce and the drop-death line are untouched. At 0.08
                       // the effective width drops 0.80 -> ~0.64, so the marginal
                       // gaps where one wheel squeaked through and the other
                       // wedged now pass both. 0 = rigid tire (old behaviour)

  // (Crash-trip removed: Elasto doesn't throw the rider over the bars on a hard
  // wheel impact — a hard landing either plants or, if the drop is high enough,
  // sinks the colliderless body through until the head hits terrain and dies.
  // That fall-from-too-high death is unchanged; only the impact "throw" is gone.)

  headR: 0.238,    // head collider radius — Elma/Across "Fejsugar" (ADATOK.CPP)
  headX: -0.102,   // head offset in frame space (x is mirrored by facing). Elma's
                   // Kor12Fejr() (LEPTET.CPP) hangs the head 1.02 out from the body
                   // at angle pi/2 - 0.1 rad = (0.102 toward the rear, 1.015 up).
  headY: -1.015,   // Was -0.18 / -0.90 (a more compact, smaller-feeling bike)

  nutR: 0.4,       // lethal radius of a nut mound — this world's "killer", the
                   // Elasto Mania spinning-spike equivalent. Touching one with
                   // ANY bike part (head, either wheel, or the frame body) is
                   // instantly fatal. 0.4 = the Elma object radius (apple/killer/
                   // flower all share it, = the wheel radius), so a converted .lev
                   // kills at the same distance a spike did. Burger pickup and the
                   // goal use the same 0.4 (see OBJ_R in js/game.js) — one object
                   // size for all three, exactly as Elma has one

  anchorX: 0.85,   // wheel anchor offsets in frame space — Elma/Across bike geometry
  anchorY: 0.60,   // (ADATOK.CPP): the wheels (Kor2/Kor4) sit ±0.85 from the body
                   // (Kor1) in x — wheelbase 1.70 — and 0.60 below it. Was ±0.55 /
                   // 0.30, a 65%-scale wheelbase that made the bike feel small
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
// L.noCollide ([[polyIndex, edgeIndex], ...]) flags edges the rider rides
// straight through: a flagged edge (same [poly, edge] keying as glassEdges) is
// dropped from the collision set, opening a gap there. The edge still RENDERS
// (it is part of the polygon fill/grass), so the wall looks solid but is
// passable — a hidden passage. L.invisible ([polyIndex, ...]) flags whole polygons that
// keep full collision but draw NOTHING (no fill, outline or grass): a normal
// nested polygon cuts a visible island out of the ground, an invisible one is
// solid but unseen. L.frontPolys ([polyIndex, ...]) flags whole polygons drawn
// on the FOREGROUND layer — over the rider and the doodads, instead of behind
// them as terrain is (drawForeground in render.js). Their collision is normal
// (so pairing one with noCollide walls lets the rider slip behind it, out of
// view); only their draw order moves. So their grass/glass tops are gathered
// into separate frontGrass/frontGlassTops lists the foreground pass draws.
// All of these are additive + inert when absent (no shipped level or replay
// carries them), so existing maps and tapes are untouched.
function prepareLevel(L) {
  const segments = [], grass = [], glassTops = [], frontGrass = [], frontGlassTops = [];
  const glassSpans = L.glass || [];
  const glassEdges = new Set((L.glassEdges || []).map(e => e[0] + ':' + e[1]));
  const noColl = new Set((L.noCollide || []).map(e => e[0] + ':' + e[1]));
  const invisible = new Set(L.invisible || []);
  const front = new Set(L.frontPolys || []);
  L.polygons.forEach((poly, pi) => {
    // a polygon nested inside another is a solid island in the playable
    // area (evenodd fill), so its playable side is the inverse
    const island = L.polygons.some(p =>
      p !== poly && pointInPoly(poly[0][0], poly[0][1], p));
    const polyInvisible = invisible.has(pi);
    // foreground polygons route their grass/glass to the front lists, drawn over
    // the rider instead of behind him
    const gList = front.has(pi) ? frontGrass : grass;
    const glList = front.has(pi) ? frontGlassTops : glassTops;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const s = { ax: a[0], ay: a[1], bx: b[0], by: b[1] };
      const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
      s.glass = glassEdges.has(pi + ':' + i) ||
        glassSpans.some(r => mx >= r[0] && mx <= r[1]);
      // an edge flagged "no collision" is passable: it never enters the
      // collision set, so the rider rides straight through it. It still gets
      // grass/visuals below, so in play it looks like ordinary solid ground.
      const ghost = noColl.has(pi + ':' + i);
      if (!ghost) segments.push(s);
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      // grass grows on edges that are not too steep and face the playable
      // side upward; glass gets a sheen instead. Invisible polygons draw
      // nothing at all, so they get no grass/glass top either.
      if (!polyInvisible && Math.abs(dx) > 0.001 && Math.abs(dy / dx) < 2.0) {
        const up = pointInPoly(mx, my - 0.3, poly);
        const down = pointInPoly(mx, my + 0.3, poly);
        if (island ? (down && !up) : (up && !down)) {
          (s.glass ? glList : gList).push(s);
        }
      }
    }
  });
  return Object.assign({}, L, { segments, grass, glassTops, frontGrass, frontGlassTops });
}

class Bike {
  constructor(x, y) {
    this.pos = { x, y };
    this.vel = { x: 0, y: 0 };
    this.angle = 0;
    this.avel = 0;
    this.facing = 1; // 1 = right, -1 = left
    this.turnT = 9;  // seconds since last turn-around (drives the flip animation)
    this.voltDir = 0;   // current lean: -1 left, +1 right, +2 alovolt (drives the
                        // arm-flick direction in render.js)
    this.voltReach = 0; // 0..1 arm-flick engagement: pumps toward 1 during each volt
                        // punch, falls back between (cosmetic; read by render.js)
    this.voltPhase = PHYS.voltCadence; // timer within the bursty volt cycle; parked
                        // at voltCadence when idle so the next press pumps at once
    this.voltPumps = 0; // count of volt pumps fired (game.js thumps on each new one)
    this.voltLead = 1;  // the lean direction the rider last committed to with a SINGLE
                        // key (-1 left / +1 right). A both-key alovolt drives THIS way,
                        // so you can supervolt either direction by leading with that key
    // gravity direction as a unit vector: down {0,1} (normal), up {0,-1}, or
    // sideways {±1,0}. A gravity burger SETS it (Elasto-Mania gravity-apple
    // style — up/down ride ceilings, left/right ride walls); the whole bike
    // (frame and both wheels) shares the one direction.
    this.gravDir = { x: 0, y: 1 };
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
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    // gravity acceleration as a vector, so a gravity burger can aim it any of the
    // four ways (the whole bike — frame and both wheels — shares it). ONE uniform
    // value (Elasto Mania — no air/ground split): the bike weighs the same airborne
    // and grounded, so a jump is a clean constant-g parabola.
    const gx = P.g * this.gravDir.x;
    const gy = P.g * this.gravDir.y;

    let fx = P.frameM * gx, fy = P.frameM * gy, torque = 0;
    // lean ("volt") — ONE rule, ground and air, no gates. NORMAL volt (one key) is
    // BURSTY: a discrete torque pump for voltBurstDur every voltCadence, the gaps
    // letting gravity act (Elasto tap-volting; can't winch a hanging body up). The
    // ALOVOLT (both keys) is the CONTINUOUS supervolt — a sustained clockwise drive.
    // No hard spin cap (the air top-rate is emergent, where the drive balances
    // avelDamp), and no air/ground branch: that a hard spin crashes you on flat
    // ground but rotates you in the air EMERGES from the contact + the modest torque
    // (alovoltAcc is small enough it can't vault the bike off the ground — see there).
    const L = !!input.left, R = !!input.right;
    // remember the direction the rider commits to with a SINGLE key, so a follow-up
    // both-key alovolt supercharges THAT way (lead with left = CCW, right = CW) —
    // bidirectional, unlike Elasto's clockwise-only quirk. Both/neither keep the last.
    if (L !== R) this.voltLead = L ? -1 : 1;
    const alovolt = L && R;
    // voltPhase = time since the last pump fired, advanced EVERY step (held, idle, OR
    // between taps) and capped at voltCadence. A pump can only fire once it reaches
    // voltCadence (`ready`), so the throttle holds however you input it — hammering
    // left/right can't sneak extra volts in inside the cadence window. Capped (not
    // re-armed on release), so a fresh press after a real gap still pumps at once.
    this.voltPhase = Math.min(this.voltPhase + dt, P.voltCadence);
    const ready = this.voltPhase >= P.voltCadence;
    if (alovolt) {
      const dir = this.voltLead;       // ±1: which way the lead key pointed
      torque += dir * P.alovoltAcc;    // CONTINUOUS supervolt, either direction
      if (ready) { this.voltPhase = 0; this.voltPumps++; } // (just paces the sound)
      this.voltDir = dir * 2;          // ±2 -> arm flicks the right way (render.js)
      this.voltReach += (1 - this.voltReach) * Math.min(1, P.voltReachRate * dt); // arm held
    } else {
      const lean = (R ? 1 : 0) - (L ? 1 : 0);
      // fire a pump only when the cadence is ready AND a lean is pressed, and LATCH its
      // direction. The arm-flick then plays out over voltBurstDur on its own — driven by
      // the burst window, NOT live input — so hammering the key during the cooldown is
      // ignored: it can't fire a new pump (throttle) and it can't twitch the arm either.
      if (ready && lean !== 0) { this.voltPhase = 0; this.voltPumps++; this.voltDir = lean; }
      const inBurst = this.voltPhase < P.voltBurstDur;
      if (inBurst && lean !== 0) torque += lean * P.voltAcc; // pump torque (while held)
      this.voltReach += ((inBurst ? 1 : 0) - this.voltReach) * Math.min(1, P.voltReachRate * dt);
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
      w.vel.x += (Fx / P.wheelM + gx) * dt;
      w.vel.y += (Fy / P.wheelM + gy) * dt;
      fx -= Fx;
      fy -= Fy;
      // wheel-spring reaction torque on the frame — applied in the air too now, so
      // the bike is one consistent springy body in flight and on the ground
      // (Elasto-faithful). A steady co-rotating spin leaves the spring at rest, so
      // it produces ~no reaction and the continuous volt drive holds the spin; only
      // spin-up / wobble creates a transient, which the sustained drive overcomes.
      torque += rx * (-Fy) - ry * (-Fx);

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
        // mid-air attitude adjustment) — ONE rule, ground and air (the old 0.4×
        // air-weakening gate is gone). Two fades stack:
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
          torque -= P.engineR * this.facing * fade * accelLeft;
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
    // angular drag, ground AND air: a held volt sustains the spin against it, and
    // releasing lets it settle the angle (Elasto-style controllable rotation)
    this.avel *= 1 - P.avelDamp * dt;

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

    // Squishy tire (pinch only). A wheel caught in a narrow gap touches two
    // near-opposing walls in the same step. Find the most head-on such pair and
    // let the tire compress along that pinch: the effective contact radius used
    // for the positional push-out below shrinks by up to wheelSquish, scaled by
    // how opposed the two normals are (1 = dead head-on, 0 = 90deg or convex).
    // This stops the two walls from shoving the wheel back and forth so its own
    // momentum carries it through a slot a touch under 2*wheelR. A single-sided
    // contact (all normal riding, every landing) has no opposing pair, so squish
    // stays 0 and the tire resolves exactly as before — grip, climbing, bounce
    // and the drop-death line are all untouched. Convex corners (hill apex,
    // ledge edge) have DIVERGING normals (opp < 0), so they don't trigger it.
    let squish = 0;
    if (P.wheelSquish > 0) {
      const ns = [];
      for (const seg of segs) {
        const cp = closestOnSeg(w.pos.x, w.pos.y, seg);
        const nx = w.pos.x - cp.x, ny = w.pos.y - cp.y;
        const d = Math.hypot(nx, ny);
        if (d >= P.wheelR || d === 0) continue;
        ns.push([nx / d, ny / d]);
      }
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const opp = -(ns[i][0] * ns[j][0] + ns[i][1] * ns[j][1]);
          if (opp > 0) squish = Math.max(squish, P.wheelSquish * opp);
        }
      }
    }

    for (const seg of segs) {
      const cp = closestOnSeg(w.pos.x, w.pos.y, seg);
      let nx = w.pos.x - cp.x, ny = w.pos.y - cp.y;
      const d = Math.hypot(nx, ny);
      if (d >= P.wheelR || d === 0) continue;
      w.onGround = true;
      nx /= d; ny /= d;

      // positional correction — push out to the contact radius, reduced by any
      // squish so a pinched tire sits compressed in the slot instead of being
      // shoved into the far wall. With squish 0 (single contact, or the feature
      // off) pen == wheelR - d and this is bit-identical to a rigid tire.
      const pen = (P.wheelR - squish) - d;
      if (pen > 0) {
        w.pos.x += nx * pen;
        w.pos.y += ny * pen;
      }

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
