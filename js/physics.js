'use strict';

// Tuning constants for the bike. Units: meters, seconds, radians.
const PHYS = {
  g: 2.7,          // ONE uniform gravity, air and ground alike (Elasto Mania — no
                   // air/ground split). Was 2.8, lowered to 2.5 for a floatier
                   // Elasto-like arc, then nudged back to 2.7 to compensate for the
                   // reduced air drag (drag 0.03->0.022): less drag lets jumps and
                   // bounces carry more energy, so a touch more gravity keeps them
                   // planted and controlled. NOTE: a lighter bike recoils off the
                   // suspension more readily — to stop the extra hop, springC was
                   // raised in step (see below).
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
  wheelI: 0.012,   // driven-wheel rotational inertia. LOWERED 0.018->0.012 (a third lighter)
                   // so a free-spinning wheel carries less angular momentum. The problem:
                   // pump the gas in the air, release, and the wheel keeps spinning (good) —
                   // but landing that overspun wheel dumped its stored angular momentum
                   // (L = wheelI*spin) into a forward LURCH as the contact synced it to the
                   // ground, so a coasting (gas-off) touchdown felt powered/hard to settle.
                   // The forward kick on landing is ∝ wheelI, so a lighter wheel "stops"
                   // (syncs) against the ground far more easily, as a freewheel should.
                   // COUPLING:
                   //  - braking works by bleeding spin, so brake force ∝ wheelI*brakeRate —
                   //    brakeRate was raised inversely (60->90) to hold the stop AND the
                   //    stoppie reaction (tip ∝ wheelI*brakeRate) exactly.
                   //  - ground accel ∝ engineT*wheelR/(M*wheelR^2 + wheelI) with M the whole
                   //    bike, and wheelI is tiny next to M*wheelR^2, so a lighter wheel moves
                   //    accel only ~+2% — engineT LEFT at 1.1.
                   //  - SIDE EFFECT (intended-ish): airborne free spin-up is ∝ engineT/wheelI,
                   //    so the in-air gas pump winds the wheel up ~1.5x quicker now. Consistent
                   //    with a lighter wheel ("easily goes to full speed"); dial wheelI back up
                   //    if the pump feels too twitchy.

  frameM: 1.3,     // frame mass. Raised 1.0->1.3 over the feel passes to give
                   // the bike more heft — it was getting tossed around by
                   // impacts too easily and felt underweight
  frameI: 1.5,     // frame rotational inertia. Raised over the feel passes
                   // (0.35->0.55->1.1->1.5) — the SAME volt torque spins the bike up more
                   // slowly, so a lean shifts real weight instead of flicking a light
                   // frame. This is the main "harder to volt / heavier" lever, and it
                   // is ALSO what tames the airborne volt without any air/ground
                   // special-case: on the GROUND the volt-lean, wheelie and stoppie
                   // are torque BALANCES (the lean torque settles against gravity +
                   // the contact reaction), so they're nearly inertia-independent and
                   // barely move when this rises — only a small voltAcc bump restores
                   // them. In the AIR there's no balance: rotation is purely
                   // inertia-driven (torque*t/frameI, conserved), so more inertia cuts
                   // it directly. So raising frameI (and nudging voltAcc to hold the
                   // ground lean) leaves grounded volting/wheelies/stoppies feeling the
                   // same while the free-air flick stops over-rotating. 0.55->1.5 took
                   // a 0.5 s air pump from ~0.93 rad down to ~0.57 rad (~-38%); grounded
                   // lean, wheelie and stoppie unchanged. Raise further (and bump
                   // voltAcc to hold the lean) for a weaker air flick still

  springK: 18,     // suspension stiffness. 42(stock)->26->20->23->20->18: softened twice for a
                   // SOFTER/STRETCHIER/SLOWER suspension, nudged back up to 23 ("a drop less
                   // soft"), then softened back down (20, then a further drop to 18) per the
                   // user. At 18: travel ~42/18 = 2.3x stock under the same load, spring
                   // frequency ω=sqrt(K/wheelM) ~35% below stock (period ~0.45->0.69 s) so it
                   // takes even longer to compress and spring back. CAVEAT it ALSO sets
                   // the drop-death line: the body has no collider, so a hard landing
                   // compresses the spring until the rigid head reaches terrain = death,
                   // and that bottom-out depth scales with 1/K — softer dies from lower
                   // drops (mostly held by the raised springCFade below; firming back to
                   // 23 actually buys a little fall-toughness back). Land flat to survive,
                   // Elasto-style
  springC: 5,      // suspension damping — THE recoil/bounce lever. RAISED 3.3->4.0->5 to slow
                   // the spring-back recoil SIGNIFICANTLY per the user. The DAMPING RATIO
                   // (springC/(2*sqrt(springK*wheelM))) tracks the stiffness too: ~0.66 at
                   // stock 42; with the softer springK 18 below, 5 puts it at ~1.26 — now
                   // OVERDAMPED (past critical 1.0), so the spring no longer overshoots/recoils
                   // at all: it eases back to rest slowly without a bounce — the slowest,
                   // deadest spring-back yet (the user pushed it past my ~0.95 target). Lower
                   // = bouncier (snaps back faster, recoils once under 1.0), higher = even
                   // more planted / slower creep back; the hard-LANDING bounce + fall-
                   // toughness specifically is springCFade
  springCFade: 36, // relative speed (m/s) where the suspension damper fades to
                   // half, so a fast compression rides mostly on the spring (and
                   // bounces) instead of being soaked dead. The body has no terrain
                   // collider, so a big enough slam sinks the frame through until
                   // the head hits terrain = death; how far the frame bottoms out
                   // sets that fatal drop height. RAISED 12->26->36 to offset the softer
                   // springK: the soft spring bottoms out deeper on a slam, so the
                   // damper has to bite harder/longer into the slam to keep the fatal
                   // drop height up (probed: recovers flat-slam survival ~15.5->~16.0
                   // m/s at springK 20; diminishing returns past here, so the soft setup
                   // just dies a touch lower than stock). Higher = tougher falls but
                   // moderate bumps damp a touch more too; re-tune by playtest
  // (no maxStretch: there is deliberately NO hard cap on suspension travel — a wheel
  // stretches exactly as far as the springs allow. The progressive extension spring
  // below, force ∝ overshoot², is what halts a violent fling, by physics, not a wall.)
  stretchSoft: 1.8, // wheel distance from the frame CENTRE (m) where the
                    // progressive extension spring starts to bite. Set beyond the
                    // wheel's normal fling reach so ordinary riding and landings
                    // (the wheel sits closer to the centre under compression)
                    // never feel it — only a fast spin flings a wheel out this far
  stretchK: 60,    // stiffness of the progressive extension spring (force grows
                    // with overshoot² past stretchSoft). Higher = wheels fling
                    // less far and snap back harder; lower = they stretch further.
                    // At 200 a wheel reaches ~2.4 from centre at 15 rad/s spin,
                    // ~3.4 at 30 (vs the old flat 1.83 cap), and keeps growing
  frameR: 0.45,    // frame body radius — used ONLY as the body's lethal contact
                   // radius against nut mounds now (see Bike.step). The body has
                   // no terrain collider, so this never touches rock
  spinExt: 0.022,   // anchor extension (m) per (rad/s)^2 of frame spin — the spin-
                    // driven outward sling of the wheels' spring anchor. INERT while
                    // spinExtMax is 0 (the cap below clamps min(0, spinExt*avel^2)=0)
  spinExtMax: 0,    // cap (m) on that spin-driven REST extension. At 0 the sling is
                    // OFF: sling = 1 + min(0, spinExt*avel^2)/anchorDist = 1 always,
                    // so the wheels' spring anchor never extends outward no matter how
                    // fast the frame spins — they stay at their fixed rest radius. Was
                    // 0.28, which flung the wheels out far enough that a standstill-
                    // alovolt slam recoiled the frame up ~1.5 m and pogo-somersaulted
                    // on flat ground; at 0 the head plants and the rider dies in half a
                    // turn (Elasto no-flat-ground-flip). Only ever acted while spinning
                    // (avel^2), so drop-death, landings and the air-spin ceiling are
                    // untouched. Cost: no outward sling to help wheels reach an outer
                    // wall riding a loop. The dramatic momentary wheel-stretch is
                    // unaffected (that's momentum vs the progressive spring, not this). NOTE: at 0,
                    // spinExt above is dead — if 0 sticks, remove the sling outright
                    // (spinExt, spinExtMax, and the `sling` factor in step)

  engineT: 1.1,    // torque applied to the driven (rear) wheel. LEFT at 1.1 despite the
                   // lighter wheelI above: steady ground accel ∝ engineT*wheelR/(M*wheelR^2
                   // + wheelI) where M is the WHOLE bike (the contact drags the frame in
                   // through the stiff suspension), and wheelI (0.012) is tiny next to
                   // M*wheelR^2 (~0.28), so the lighter wheel only nudges accel ~+2% — not
                   // worth trimming. (Only the FREE-AIR spin-up, ∝ engineT/wheelI, feels the
                   // lighter wheel.) This sets the WHOLE accel curve's level, so it's deliberately
                   // modest: the bike reaches its 60 mph cap in ~18 s, which is fine now
                   // that the cap (maxSpin) removed the old 40 s asymptotic crawl. Don't
                   // raise this for "quicker to top" — it quickens the LAUNCH too (the same
                   // lever), which is exactly what the user didn't want. The "reach top
                   // quicker" job is done instead by the cap + flattening the high-speed
                   // taper (engineFade 0), which keeps accel near-constant to the top
  engineLow: 0.25, // extra low-end torque fraction: full extra at zero wheel spin, gone
                   // by engineKnee. Back to 0.25 (stock hill-start grunt) with engineT
  engineKnee: 12,  // wheel spin (rad/s, ~4.8 m/s) where the extra runs out
  engineFade: 0,   // HIGH-END torque taper, ∝ (spin/maxSpin)^2. Set to 0 ("FLATTEN the
                    // drop-off"): the user wanted the engine to keep pulling at full thrust
                    // all the way up instead of tapering off near the top, so the bike holds
                    // a near-constant acceleration to the 60 mph cap and reaches it sooner
                    // rather than petering out. At 0 there's no engine-side taper at all —
                    // the only easing into the cap is the natural slip as the wheel nears
                    // maxSpin, which is gentle enough that it's not a dead wall. Raise it
                    // for a softer, more "running out of breath" top (slower final approach)
  engineR: 4.5,    // reaction torque on the frame while the engine spins up — the
                   // WHEELIE-strength lever, independent of gravity/volt. Lowered
                   // 6.5->4.5: at uniform low gravity the front popped up faster than
                   // a volt could hold it down; a gentler reaction lets the volt
                   // counter the gas wheelie. Higher = stronger wheelie/stoppie
  wheelieRate: 0.5, // rad/s pitch-back rate the engine reaction saturates at
  wheelieFadeSpin: 45, // wheel spin (rad/s, ~18 m/s) where the GAS wheelie up-pitch
                   // fades to zero — the reaction lift scales by accelLeft =
                   // max(0, 1 - |spin|/wheelieFadeSpin), full off the line and gone by
                   // here. DELIBERATELY decoupled from maxSpin (it used to divide by
                   // maxSpin): tying it to the cap meant raising maxSpin for top speed
                   // also made the front-lift persist to a higher speed — the opposite
                   // of wanted. As its own knob the wheelie plants out at its own
                   // (lower) speed while the bike still pulls to a much higher top.
                   // Lower = the front comes down sooner / wheelie only at low speed;
                   // raise toward maxSpin to keep lifting the front further up the range
  maxSpin: 67,     // rad/s HARD cap on driven wheel spin — and now it IS the top speed
                   // setter: 67*wheelR = 26.8 m/s = 60 mph. Set back down (95->67) to put
                   // the cap right at the wanted top, and the engine (engineT 1.9) is now
                   // strong enough to drive the wheel up to it and HOLD it, so the bike
                   // reaches a clear, definite 60 mph in ~12-13 s instead of asymptoting
                   // toward some fuzzy far number over ~40 s. THIS is the top-speed dial
                   // now: maxSpin = top_mph / 0.894 in rad/s (e.g. 50 mph -> 56, 70 -> 78).
                   // engineFade softens the last bit of the approach so it's not a dead
                   // wall. Also the reference for engineFade (spin/maxSpin)
  brakeRate: 90,   // how hard the brake grabs the WHEEL: the exponential rate
                   // (per second) it bleeds wheel spin. RAISED 60->90 to hold braking against
                   // the lighter wheelI above — the brake works by bleeding spin and friction
                   // converts that to decel, so brake force ∝ wheelI*brakeRate; scaling
                   // brakeRate inversely to the wheelI cut keeps the stop (and the stoppie
                   // reaction tip ∝ wheelI*brakeRate) unchanged. THIS is the real
                   // braking-force lever, not brakeGrip. While the tyre stays
                   // rolling-synced to the ground (which it does at normal grip),
                   // the contact friction sits well below its Coulomb ceiling, so
                   // brakeGrip is non-binding and raising it does nothing — the
                   // stop is paced entirely by how fast this bleeds the spin, which
                   // friction then turns into linear deceleration as it re-syncs
                   // the wheel. Raised 30->90 to put back (and exceed) the stopping
                   // power the old rollRes spin-bleed was quietly supplying, then
                   // eased 90->55 (90 read a tad strong). Push higher for a harder
                   // grab; once it bleeds faster than friction
                   // can re-sync each substep the wheel locks into a skid and
                   // brakeGrip becomes the ceiling. (Capped stable below ~480, the
                   // substep rate, where the per-step factor would hit zero.)
  brakeR: 0.32,    // fraction of brake torque reacted onto the frame
  brakeSkid: 1.0,  // skid friction torque multiplier passed to the frame.
                   // Halved alongside the brakeGrip boost below: the stronger
                   // brakes shed a lot more momentum, and the skid torque
                   // scales with that braking force, so without this cut a
                   // hard stop would just throw the rider over the bars
  brakeGrip: 4.0,  // Coulomb friction CEILING while braking (× P.mu) — the most a
                   // braked tyre can grip IF it breaks loose and SLIDES. Big
                   // caveat: at normal settings the wheel does NOT slide under
                   // braking — the contact friction keeps it rolling-synced well
                   // below this ceiling — so this knob is non-binding and raising
                   // it (even to 200) changes the stop not at all. Braking force is
                   // set by brakeRate (the spin-bleed), not here. This only starts
                   // to bite once brakeRate is high enough to lock the wheel into a
                   // skid; then it caps that skid's grip. Kept at 4.0 as a generous
                   // ceiling so a lock-up still bites hard. Engine traction uses
                   // plain P.mu (accel/climb and the tuned maps untouched); glass
                   // is exempt (crossed on momentum alone)
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
  // air rotations and recoveries. NEITHER has a hard spin cap: there's no angular
  // drag term, so rotation conserves angular momentum — the alovolt's top spin is
  // bounded EMERGENTLY by air drag on the fast, flung-out wheels (and lower the
  // faster you're also falling, as fall speed stacks onto the wheels). A fresh
  // normal press pumps at once.
  voltAcc: 17.3,    // torque of ONE normal volt pump (the punch). Sets normal-volt
                    // rotation (fine control / balance) AND how easily you can pump
                    // off a ledge — keep it modest so a DANGLING body (gravity
                    // resisting) can't be pumped up, while a body whose CoM is still
                    // OVER the ledge (gravity not resisting) rotates back easily.
                    // (17->21->16->14.5->16.1->17.3; the last bumps just re-match the
                    // grounded lean after frameI rose 0.55->1.5 — together they tame
                    // the air volt while keeping the ground feel, see frameI.)
                    // Average torque voltAcc*voltBurstDur/voltCadence ~ 3.3
  voltBurstDur: 0.114, // seconds each pump applies torque — the length of one punch.
                    // Moved in lockstep with voltCadence (0.125@0.66 -> 0.152@0.8 ->
                    // 0.114@0.6) to hold the duty cycle (voltBurstDur/voltCadence =
                    // 0.19) — and so the AVERAGE torque (voltAcc*voltBurstDur/
                    // voltCadence) — constant: change the rhythm, keep the total push
  voltCadence: 0.6, // seconds between pump starts while held (~1.67 pumps/s) — faster,
                    // tighter pumps (0.45->0.6->0.66->0.8->0.6). The GAP is where
                    // gravity/damping act on a hang, so a shorter gap makes a ledge
                    // recovery less of a wait (voltBurstDur was shortened to match, so
                    // the average torque is unchanged)
  alovoltAcc: 5,    // CONTINUOUS torque of the alovolt (both keys) — sustained, not
                    // pulsed, so it clearly out-spins the bursty normal volt while
                    // held. The cadence gates when it can ENGAGE, but the drive itself
                    // is the same on ground and air. Eased 7->5 for a more controllable
                    // supervolt spin-up. The no-flat-ground-flip behaviour no longer
                    // depends on keeping this modest — it's now held by the spin-fling
                    // sling being OFF (spinExtMax=0): the wheels stay planted, so a
                    // flat-ground spin drives the head into the ground rather than
                    // pogoing. TOP SPIN isn't set here either — it's bounded emergently
                    // by air drag on the wheels (lower PHYS.drag for a higher ceiling)
  voltReachRate: 14, // 1/s the rider's arm pumps toward fully-leaned DURING each
                    // torque punch and falls back in the gap, so the arm visibly
                    // punches per pump (render.js reads bike.voltReach). Cosmetic

  mu: 1.25,        // tire friction coefficient — raised 1.1->1.25 for a bit more
                   // grip overall (holds slopes better, hooks up quicker). Engine
                   // traction, the landing bite (gripBite is ×mu) and the braking
                   // ceiling (brakeGrip is ×mu) all scale with this; glass rides on
                   // muGlass instead, so glass crossings are unchanged
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
  gripGasResist: 0.75, // fraction of the extra grip-bite the DRIVEN wheel keeps
                   // while the THROTTLE is held (1 = full bite, 0 = no bite/base
                   // grip). The engine fights the grip's deceleration, so a
                   // powered wheel keeps spinning a bit longer (more wheelspin)
                   // before it hooks up, vs a freewheeling wheel that grips clean.
                   // Raised 0.5->0.75: at 0.5 a rear-wheel landing under gas at a
                   // glancing angle barely bit (biteMax 1+(gripBite-1)*0.5 = 2.5) and
                   // skated like ice — too dramatic. 0.75 (biteMax 3.25) keeps most of
                   // the bite so it hooks up far sooner, while still leaving a clear
                   // on-power-vs-coasting landing difference
  // Rolling resistance — THROTTLE-GATED, and the on-gas and off-gas halves use DIFFERENT
  // mechanisms because they need different things:
  //  - ON the gas (rollResGas): a light SPIN bleed on the wheels. rollResGas*spin is ~0
  //    at a standstill, so it leaves the launch/low-end acceleration identical to stock
  //    and only settles the top speed (~21 m/s). The engine dominates here; this just
  //    keeps the top from drifting up forever.
  //  - OFF the gas (coastC/coastV): a direct VELOCITY brake on the whole grounded bike.
  //    A spin bleed CANNOT stop the bike — the wheel's rotational inertia is tiny, so
  //    bleeding spin barely decelerates the heavy frame, and cranking it just LOCKS the
  //    wheels while the frame coasts on, disconnected (measured: bigger spin-bleed made
  //    the 21 m/s coast stop LATER, not sooner). So the coast brake scales the frame +
  //    wheel velocities directly: a firm speed-proportional bite (coastV) plus a constant
  //    floor (coastC) that doesn't fade at low speed, so the bike rolls to a genuine STOP
  //    instead of crawling forever. Separate from tyre friction (mu) / braking grip, so
  //    climb and braking feel are untouched.
  rollResGas: 0,   // ON-THROTTLE spin bleed (spin decel per rad/s of spin). Set to 0 as
                   // part of flattening the drop-off — any on-gas speed resistance grows
                   // with speed and would sap acceleration up top, the opposite of wanted.
                   // The top is set purely by the maxSpin cap (= 60 mph) now. (~0 at low
                   // spin anyway, so it never touched the launch.)
  coastC: 0.3,  // OFF-THROTTLE constant brake (m/s^2) — the "actually comes to a STOP"
                   // term. The speed brake (coastV) alone fades as the bike slows, so it
                   // would crawl toward zero forever; this constant floor doesn't fade,
                   // so it kills the final crawl and parks the bike in finite distance.
                   // RAMPED IN ONLY BELOW coastStopV so it acts as a stopping assist near
                   // zero, NOT a force at cruising speed — otherwise a constant decel this
                   // size would hold the bike on any slope gentler than ~asin(coastC/g)
                   // and you couldn't coast downhill. So at speed only coastV acts (a
                   // hill still freewheels to a terminal); near a stop this fades in and
                   // parks it. Raise for a firmer, shorter final stop
  coastV: 0.2,  // OFF-THROTTLE speed brake (1/s): decel = coastV*speed. THE lever for how
                   // quickly a coast slows — it does the bulk of the slow-down from cruising
                   // speed (coastC only handles the last few m/s). Eased 0.35->0.2 so the
                   // bike coasts longer / doesn't halt so abruptly off the gas (from 16 m/s:
                   // ~7 s/40 m -> ~12 s/71 m, still a finite stop). On the FRAME, so it
                   // actually decelerates the bike (not the old spin-bleed that just spun the
                   // wheels down and never stopped it). Also sets the downhill coasting
                   // terminal (gravity vs coastV*speed): higher = stops sooner on the flat
                   // but coasts slower downhill; lower = longer flat coast / faster downhill
  coastStopV: 3.5, // speed (m/s) below which the constant coast brake (coastC) ramps in
                   // (linearly, full at rest). Above it, coasting is coastV-only so a
                   // downhill still builds speed to its terminal; below it the bike is in
                   // its final roll-up-to-a-stop and coastC parks it. Lower = the bike
                   // freewheels closer to a standstill before the stop-assist grabs
  dragV0: 28,      // speed (m/s) below which there is no air drag at all:
                   // the tuned maps top out ~17 m/s (Sriracha's spiral dive),
                   // so leaving the normal range drag-free keeps every map's
                   // ballistics bit-identical. Drag only bites past this. Set to 28, just
                   // ABOVE the 60 mph (26.8 m/s) flat cap, so on the flat the maxSpin cap
                   // (not drag) cleanly sets the top — drag stays out of the way there and
                   // only catches a fast DESCENT. Still well above the maps' ~17 m/s
                   // ceiling, so every map stays drag-free and bit-identical. Free-fall
                   // terminal = dragV0 + sqrt(g/drag) ~ 39
  drag: 0.022,     // quadratic air drag (1/m) on the speed ABOVE dragV0: a
                   // mass-independent decel of drag*(|v|-dragV0)^2. Free-fall terminal
                   // is dragV0+sqrt(g/drag) ~ 39 m/s, and it's the SAME on the gas or
                   // coasting, so a long descent can't be out-run by idling. On the FLAT
                   // the top is the maxSpin cap (60 mph), reached below dragV0, so drag
                   // doesn't shape it — drag only catches a fast DESCENT past 28 m/s.
                   // This ALSO bounds the alovolt air-spin: drag on the fast
                   // flung-out wheels is what caps rotation, so lowering it raises
                   // that ceiling. Eased 0.03->0.022 for a higher ceiling and a bit
                   // more carried speed (the tuned maps top out below dragV0, so
                   // they're untouched; gravity was nudged up to compensate)
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

  wheelSquish: 0.16,   // how far (m) the tire's contact radius may COMPRESS when it
                       // is PINCHED at low speed — the at-rest FLOOR of the squish. A
                       // wheel caught between two near-opposing surfaces (a ceiling
                       // pressing down onto the wheel riding the floor, or two walls)
                       // deforms: the contact it is squeezed UP against goes soft —
                       // it applies no push-out and (via jn) no friction until the
                       // tire bottoms out reC=wheelR-squish past it — so the wheel's
                       // throttle + momentum carry it through a gap tighter than the
                       // rigid 2*wheelR. Only the squeezed-against side softens; the
                       // SUPPORTING floor keeps full radius/grip/drive (see sqScale in
                       // wheelContacts), and a single-sided contact (all normal riding,
                       // EVERY landing) has no opposing pair so squish is 0 — grip,
                       // climbing, bounce and the drop-death line are untouched. The
                       // tightest floor-to-ceiling gap a wheel rides through is roughly
                       // 2*wheelR - squish. 0.08->0.10->0.12 over the feel passes
  wheelSquishMax: 0.32,// the squish CEILING at full momentum. The compression ramps
                       // from wheelSquish (at rest) up to this as the biker's FRAME
                       // speed climbs to wheelSquishV, then saturates — so a bike
                       // carrying momentum squeezes a tighter gap than a crawling one,
                       // but only up to here ("more momentum = more squeeze, to a
                       // limit"). At 0.28 a wheel at speed rides a floor-to-ceiling gap
                       // down to ~0.52 m (vs ~0.68 at the at-rest floor, ~0.80 rigid).
                       // Must be >= wheelSquish; set EQUAL to disable the momentum
                       // scaling (constant squish), BOTH 0 for a rigid tire. Keep well
                       // below wheelR (0.4) so the tire keeps substance when pinched
  wheelSquishV: 12,    // FRAME speed (m/s) at which the pinch squish reaches
                       // wheelSquishMax. Lower = the full squeeze is available at a
                       // gentler pace; higher = you must really be moving to get it.
                       // The momentum measure is the frame speed (this.vel), so both
                       // wheels share the one value

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
    this.voltPhase = PHYS.voltCadence; // cadence timer: time since the last volt EVENT
                        // (a normal pump, or an alovolt engage/release), capped at
                        // voltCadence; gates both the next pump and the next alovolt
                        // engage. Parked at voltCadence when idle so the next press pumps at once
    this.voltBurst = 0; // countdown (s) of the current normal-pump torque punch; >0 means
                        // the pump is still applying torque. Decoupled from voltPhase so an
                        // alovolt-release cooldown reset can't fire a phantom pump
    this.voltPumps = 0; // count of volt pumps fired (game.js thumps on each new one)
    this.voltLead = 1;  // the lean direction the rider last committed to with a SINGLE
                        // key (-1 left / +1 right). A both-key alovolt drives THIS way,
                        // so you can supervolt either direction by leading with that key
    this.alovolting = false; // whether the both-key alovolt was engaged last step, so the
                        // thump fires ONCE on the rising edge — the alovolt is a sustained
                        // drive, not a series of pumps, so its sound shouldn't loop
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
    // ALOVOLT (both keys) is the CONTINUOUS supervolt — a sustained clockwise drive,
    // but it can only ENGAGE when the cadence is ready (a cooldown blocks it, same as
    // a pump) and RELEASING it spends a cooldown of its own. No hard spin cap (the air
    // top-rate is emergent — rotation conserves angular momentum and is bounded by
    // air drag on the flung-out wheels), and no air/ground branch:
    // that a hard spin crashes you on flat ground but rotates you in the air EMERGES
    // from the contact + the modest torque (alovoltAcc can't vault the bike off the ground).
    const L = !!input.left, R = !!input.right;
    // remember the direction the rider commits to with a SINGLE key, so a follow-up
    // both-key alovolt supercharges THAT way (lead with left = CCW, right = CW) —
    // bidirectional, unlike Elasto's clockwise-only quirk. Both/neither keep the last.
    if (L !== R) this.voltLead = L ? -1 : 1;
    const alovolt = L && R;
    // voltPhase = time since the last volt EVENT (a normal pump, OR an alovolt
    // engaging/releasing), advanced EVERY step (held, idle, or between taps) and
    // capped at voltCadence. The cadence (`ready`) gates BOTH the normal pump AND
    // the alovolt engage, so neither can sneak in during the cooldown window —
    // hammering keys can't fire a new pump, and tapping into an alovolt mid-cooldown
    // does nothing. Capped (not re-armed on release), so a fresh press after a real
    // gap still pumps at once. voltBurst is a SEPARATE countdown for the torque punch
    // (decoupled from voltPhase so a release-cooldown reset can't trigger a phantom pump).
    this.voltPhase = Math.min(this.voltPhase + dt, P.voltCadence);
    this.voltBurst = Math.max(0, this.voltBurst - dt);
    const ready = this.voltPhase >= P.voltCadence;
    if (alovolt) {
      const dir = this.voltLead;       // ±1: which way the lead key pointed
      // ENGAGE only when the cadence is ready: a cooldown (from a prior pump OR a
      // just-ended alovolt) blocks the supervolt from STARTING, exactly as it blocks
      // a normal pump. Once engaged (`alovolting`) it runs CONTINUOUSLY until release
      // — the cooldown gates the engage, not the sustained drive.
      if (this.alovolting || ready) {
        torque += dir * P.alovoltAcc;  // CONTINUOUS supervolt, either direction
        // thump ONCE when the alovolt engages — it's a sustained drive, not a string
        // of pumps, so the sound shouldn't loop while both keys are held (rising edge)
        if (!this.alovolting) this.voltPumps++;
        this.alovolting = true;
        this.voltDir = dir * 2;        // ±2 -> arm flicks the right way (render.js)
        this.voltReach += (1 - this.voltReach) * Math.min(1, P.voltReachRate * dt); // arm held
        this.voltPhase = P.voltCadence; // park at the cap so `ready` stays true while held;
                                        // RELEASING is what spends the cooldown (below)
      }
    } else {
      const lean = (R ? 1 : 0) - (L ? 1 : 0);
      if (this.alovolting) {
        // RELEASING the alovolt spends a cooldown: reset the cadence so neither a
        // normal pump nor a fresh alovolt can fire until a full voltCadence elapses.
        // No burst is started, so the release itself can't sneak a pump out.
        this.alovolting = false;
        this.voltPhase = 0;
      } else if (ready && lean !== 0) {
        // fire a normal pump: spend the cooldown and start a torque punch. The
        // arm-flick then plays out over voltBurst on its own — driven by the burst
        // timer, NOT live input — so hammering the key during the cooldown is
        // ignored: it can't fire a new pump and it can't twitch the arm either.
        this.voltPhase = 0; this.voltBurst = P.voltBurstDur; this.voltPumps++; this.voltDir = lean;
      }
      const inBurst = this.voltBurst > 0;
      if (inBurst && lean !== 0) torque += lean * P.voltAcc; // pump torque (while held)
      this.voltReach += ((inBurst ? 1 : 0) - this.voltReach) * Math.min(1, P.voltReachRate * dt);
    }

    // fast spins sling the wheels outward: the spring's rest anchor extends
    // radially with the square of the spin rate, like elastic bars. Total travel
    // is bounded only by the springs now (no hard clamp — see end of step)
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
        // engine torque shaped by wheel spin: a low-end grunt boost (engineLow,
        // gone by engineKnee) for hill starts, MINUS a high-end taper (engineFade,
        // ∝ (spin/maxSpin)^2) so the pull fades as the wheel nears the cap. The
        // taper is what makes acceleration fall off the faster you go — a real
        // engine running out of breath in top gear — so the bike eases up to its
        // top speed instead of pulling flat-out into the maxSpin wall.
        const spinFrac = Math.abs(w.spin) / P.maxSpin;
        const eT = P.engineT *
          (1 + P.engineLow * Math.max(0, 1 - Math.abs(w.spin) / P.engineKnee)) *
          (1 - P.engineFade * Math.min(1, spinFrac * spinFrac));
        w.spin += (eT / P.wheelI) * dt * this.facing;
        // cap the engine's own wind-up without clawing back the extra
        if (w.spin * this.facing > P.maxSpin) w.spin = P.maxSpin * this.facing;
        // engine reaction torque pitches the frame backward (wheelies, and
        // mid-air attitude adjustment) — ONE rule, ground and air (the old 0.4×
        // air-weakening gate is gone). Two fades stack:
        //  - `fade` on pitch-back rate, so a held wheelie climbs slowly
        //    instead of snapping over — until gravity takes it past balance.
        //  - `accelLeft` on remaining wheelie headroom (1 at a standstill, 0 once
        //    the wheel reaches wheelieFadeSpin): the front lift tracks how much
        //    grunt is left to pop it, so the wheelie is strong off the line and
        //    levels out as you gain speed, with none left past wheelieFadeSpin —
        //    Elasto Mania style. Faded against wheelieFadeSpin (NOT maxSpin) so the
        //    front plants out at its own, lower speed independent of how high the
        //    top-speed cap is set. This scales only the REACTION (the lift), never
        //    eT (forward thrust), so acceleration and hill-climb are unchanged.
        if (w.spin !== before) {
          const back = this.avel * -this.facing; // current pitch-back rate
          const fade = Math.min(1, Math.max(0, 1 - back / P.wheelieRate));
          const accelLeft = Math.max(0, 1 - Math.abs(w.spin) / P.wheelieFadeSpin);
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
    // NO angular drag term: rotation conserves angular momentum (Elasto-faithful).
    // The air-spin ceiling isn't lost — it emerges from air drag on the fast,
    // flung-out wheels (the linear drag below); on the ground the suspension and
    // contacts settle the angle. An artificial damper here only duplicated that
    // bound while deadening the controllable feel, so it was removed.

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

    // NO hard cap on suspension travel — a wheel stretches exactly as far as the
    // physics carries it: the linear suspension spring (springK) plus the progressive
    // extension spring (stretchSoft/stretchK), whose force rises with overshoot² and
    // halts even a violent fling by storing its energy, are the only things reining the
    // wheels in. (There used to be a `maxStretch` positional clamp here that teleported
    // a wheel back + killed its outward velocity past a fixed distance; it was a feel
    // wall that capped the stretch behind the springs, so it's gone.)

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

    // rolling resistance — THROTTLE-SPLIT (see the consts for the full why):
    //  - ON the gas: a light spin bleed (rollResGas). ~0 at low spin so the launch is
    //    untouched; it only settles the top speed. Clamped to spin 0 so it can't flip sign.
    //  - OFF the gas: a direct VELOCITY brake on the grounded bike (coastC + coastV*speed),
    //    scaling the frame AND wheels together so they decelerate as one rigid body (and
    //    the wheels don't keep spinning). This is what actually brings the coast to a STOP
    //    — a spin bleed can't (the wheel's inertia is too small to slow the frame).
    if (input.throttle) {
      for (const w of this.wheels) {
        if (!w.onGround) continue;
        const dec = P.rollResGas * Math.abs(w.spin) * dt;
        if (Math.abs(w.spin) <= dec) w.spin = 0;
        else w.spin -= Math.sign(w.spin) * dec;
      }
    } else if (this.wheels[0].onGround || this.wheels[1].onGround) {
      const sp = Math.hypot(this.vel.x, this.vel.y);
      if (sp > 1e-6) {
        // constant brake ramps in only below coastStopV (a near-stop assist), so a
        // downhill still freewheels at speed instead of being held by it
        const cC = P.coastC * Math.max(0, 1 - sp / P.coastStopV);
        const drop = (cC + P.coastV * sp) * dt;         // m/s shed this step
        const f = drop >= sp ? 0 : 1 - drop / sp;       // clamp to a full stop
        this.vel.x *= f; this.vel.y *= f;
        for (const w of this.wheels) { w.vel.x *= f; w.vel.y *= f; w.spin *= f; }
      }
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
    let squish = 0, pinchAmt = 0, pinchAxX = 0, pinchAxY = 0;
    if (P.wheelSquishMax > 0) {
      // the biker's MOMENTUM lets a pinched tyre deform further: the squish
      // ceiling ramps from wheelSquish (at rest) up to wheelSquishMax as the
      // frame speed climbs to wheelSquishV, then saturates — so a bike carrying
      // speed squeezes a tighter slot than a crawling one, to a limit. Frame
      // velocity is the momentum measure, so both wheels share the one value.
      const mom = Math.hypot(this.vel.x, this.vel.y);
      const give = P.wheelSquish + (P.wheelSquishMax - P.wheelSquish) *
        Math.min(1, mom / P.wheelSquishV);
      const ns = [];
      for (const seg of segs) {
        const cp = closestOnSeg(w.pos.x, w.pos.y, seg);
        const nx = w.pos.x - cp.x, ny = w.pos.y - cp.y;
        const d = Math.hypot(nx, ny);
        // gather pinch candidates out to wheelR + give, NOT the strict wheelR the
        // rigid push-out uses. A wheel wedged in a slot only ~2*wheelR wide is held
        // by the SUPPORTING wall at d ~= wheelR, which parks the OPPOSING wall at
        // d ~= wheelR as well — a hair past a strict `d < wheelR` test, so the pair
        // never registered and squish stayed 0 no matter how the consts were tuned.
        // (Only a slot whose far wall actively descends PAST wheelR onto the tire —
        // e.g. a thin downward sliver — ever tripped the strict test; a constant-
        // width ~2*wheelR slot, the common case in a tight tunnel, never did.) The
        // tire can compress by up to `give`, so an opposing wall within wheelR + give
        // is already deforming it: detect the pinch out to that envelope and the
        // squish engages as the wheel meets the throat instead of jamming rigidly at
        // the 2*wheelR boundary. This widens DETECTION only — the resolution loop
        // below still uses strict wheelR, so only genuinely penetrating contacts ever
        // push out, and a lone contact (no opposing pair) still yields squish 0.
        if (d >= P.wheelR + give || d === 0) continue;
        ns.push([nx / d, ny / d, d]);
      }
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const opp = -(ns[i][0] * ns[j][0] + ns[i][1] * ns[j][1]);
          if (opp <= 0) continue;
          squish = Math.max(squish, give * opp);
          // VISUAL squash (cosmetic, inert): the REAL geometric squeeze — how far
          // inside a rigid 2*wheelR tyre the two opposing walls actually sit — so
          // the drawn deform tracks the slot width (proportional to the press),
          // not the momentum-driven `give` ceiling. The compression axis comes off
          // the pair's anti-parallel normals, so it stays put even when BOTH walls
          // bottom out and push (where a summed contact normal cancels and spins).
          const amt = (2 * P.wheelR - (ns[i][2] + ns[j][2])) * opp;
          if (amt > pinchAmt) {
            pinchAmt = amt;
            const axX = ns[i][0] - ns[j][0], axY = ns[i][1] - ns[j][1];
            const al = Math.hypot(axX, axY) || 1;
            pinchAxX = axX / al; pinchAxY = axY / al;
          }
        }
      }
    }

    // cosmetic tyre-squash inputs (inert to the sim — read by updateWheelSquash
    // in game.js + drawWheel, never written back here). Accumulate a push-out-
    // weighted average contact normal so the renderer knows WHICH way the tyre
    // is pressed: weighting by the rigid push-out depth `pen` lets the SUPPORTING
    // wall dominate while a pinch's soft opposing wall (which earns no push-out)
    // barely tugs it, so the squash axis stays true even wedged in a slot.
    let cnx = 0, cny = 0, cnw = 0;

    for (const seg of segs) {
      const cp = closestOnSeg(w.pos.x, w.pos.y, seg);
      let nx = w.pos.x - cp.x, ny = w.pos.y - cp.y;
      const d = Math.hypot(nx, ny);
      if (d >= P.wheelR || d === 0) continue;
      w.onGround = true;
      nx /= d; ny /= d;

      // positional correction — push out to the contact radius, reduced by any
      // squish so a pinched tire sits compressed in the slot instead of being
      // shoved into the far wall. The squish only softens the contact the tire is
      // squeezed UP against — a ceiling or a wall — never the SUPPORTING ground:
      // gAlign is +1 for a ceiling (normal points along gravity), 0 for a vertical
      // wall, -1 for the floor (normal opposes gravity). sqScale ramps the squish
      // in from 0 at the straight-down support to full for anything horizontal or
      // overhead, so a pinched wheel keeps its full radius (and full grip/drive)
      // on the floor while its TOP deforms into the obstruction — the throttle and
      // its own momentum then carry it through the gap. With squish 0 (single
      // contact, or the feature off) reC == wheelR and this is a rigid tire.
      const gAlign = nx * this.gravDir.x + ny * this.gravDir.y;
      const sqScale = Math.min(1, Math.max(0, gAlign + 1));
      const reC = P.wheelR - squish * sqScale;
      const pen = reC - d;
      if (pen > 0) {
        w.pos.x += nx * pen;
        w.pos.y += ny * pen;
        cnx += nx * pen; cny += ny * pen; cnw += pen; // tyre-squash axis (cosmetic)
      }

      // normal impulse: tire rebound ramps in with impact speed instead
      // of switching on — a real slam keeps the whole elastic-bar kick,
      // while mild hits (and the once-rebounded remnants of a slam) land
      // dead, so touchdowns plant instead of chattering.
      //   Gated on `pen > 0` (the per-contact COMPRESSED radius reC): the soft
      // outer `squish` of a tire squeezed against a ceiling/wall it hasn't bottomed
      // out against yet (reC < d < wheelR) applies NO normal force and — since
      // friction is clamped by jn below — NO friction either, so the tire just
      // deforms and the wheel's momentum/throttle carry it through the gap instead
      // of the wall gripping it to a halt. The floor keeps reC == wheelR (see
      // sqScale), so support and drive are untouched; without squish (single
      // contact / feature off) every contact is rigid (reC == wheelR).
      const vn = w.vel.x * nx + w.vel.y * ny;
      let jn = 0;
      if (vn < 0 && pen > 0) {
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

    // publish this step's cosmetic squash inputs: the unit contact normal (the
    // direction the tyre is supported FROM, so the renderer flattens toward its
    // opposite) and the pinch compression. Both inert — the sim never reads them.
    if (cnw > 1e-9) {
      const il = 1 / Math.hypot(cnx, cny);
      w.contactNX = cnx * il; w.contactNY = cny * il;
    }
    w.pinchAmt = pinchAmt > 0 ? pinchAmt : 0;   // geometric pinch squeeze (m), cosmetic
    w.pinchAxisX = pinchAxX; w.pinchAxisY = pinchAxY;
  }
}
