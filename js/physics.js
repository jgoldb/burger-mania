'use strict';

// Tuning constants for the bike. Units: meters, seconds, radians.
const PHYS = {
  g: 3.0,          // ONE uniform gravity, air and ground alike (Elasto Mania — no
                   // air/ground split). Was 2.8, lowered to 2.5 for a floatier
                   // Elasto-like arc, nudged back to 2.7 to compensate for the reduced
                   // air drag (drag 0.03->0.022), briefly eased to 2.6, then RAISED to 3.0
                   // per the user for a heavier, more planted feel — it also loads the now-
                   // stiffer suspension (springK 28) harder, which feeds more recoil off
                   // landings and bumps.
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
                   //  - braking no longer touches spin (it's a contact-point pin spring
                   //    now, see brakeSpringK), so wheelI doesn't affect the stop at all.
                   //  - ground accel ∝ engineT*wheelR/(M*wheelR^2 + wheelI) with M the whole
                   //    bike, and wheelI is tiny next to M*wheelR^2, so a lighter wheel moves
                   //    accel only ~+2% — engineT LEFT at 1.1.
                   //  - SIDE EFFECT (intended-ish): airborne free spin-up is ∝ engineT/wheelI,
                   //    so the in-air gas pump winds the wheel up ~1.5x quicker now. Consistent
                   //    with a lighter wheel ("easily goes to full speed"); dial wheelI back up
                   //    if the pump feels too twitchy.

  frameM: 1.15,     // frame mass — the bike's translational "weight" lever (the
                   // rider+chassis bulk; the wheels are wheelM). 1.0->1.3->2.4:
                   // raised ~85% per the user for a SIGNIFICANTLY heavier bike.
                   // Heavier = harder for impacts to toss it around (the original
                   // reason it went 1.0->1.3 — it felt underweight) and more planted
                   // momentum. Gravity is applied as a mass-independent acceleration
                   // (g), so this does NOT change fall SPEED — only inertia, sag and
                   // acceleration. Two coupled side effects, both inherent to a
                   // heavier frame:
                   //  - ACCELERATION drops: ground accel ∝ 1/(M*wheelR^2+wheelI) with
                   //    M the whole bike (frameM+2*wheelM: 1.74->2.84, ~+63%), so
                   //    pickup falls ~40%. That sluggishness IS part of the heaviness;
                   //    bump engineT to claw some back only if it feels dead.
                   //  - FALL-TOUGHNESS drops: the frame hangs on the suspension and
                   //    sags x=frameM*g/springK at rest, so a heavier frame sits lower
                   //    (~0.16->0.30 m at springK 24) — closer to the head-hits-terrain
                   //    death line on a slam. springK was stiffened 24->32 in the same
                   //    pass to pull that back to ~0.22 m; raise springK/springCFade
                   //    further if it still dies from drops it used to survive.
                   // ROTATIONAL heft (harder to flip/volt) is the SEPARATE frameI lever
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

  springK: 32,     // suspension stiffness. 42(stock)->26->20->23->20->18->24->32: softened
                   // down to 18 for a soft/slow ride, then STIFFENED back up (->24->32) for
                   // more RECOIL per the user. The latest 24->32 step ALSO offsets the now-
                   // heavier frame (frameM 1.3->2.4): static sag = frameM*g/springK, so a
                   // stiffer spring pulls the frame back up from ~0.30 m to ~0.22 m, winning
                   // back most of the fall margin the heavy frame cost. A stiffer spring pushes
                   // back harder and faster AND — holding springC fixed — drops the damping
                   // ratio (~0.70->0.60, see springC) so it bounces more; it also bottoms out
                   // less, so more of a hit's energy returns as rebound instead of crashing the
                   // head through. At 32: spring frequency ω=sqrt(K/wheelM) ~12.1 rad/s (period
                   // ~0.52 s) — compresses and springs back quicker/firmer than the soft 18.
                   // CAVEAT it ALSO sets the drop-death line: the body has no collider, so a
                   // hard landing compresses the spring until the rigid head reaches terrain =
                   // death, and that bottom-out depth scales with 1/K — softer dies from lower
                   // drops, so stiffening BUYS fall-toughness back (on top of the raised
                   // springCFade below). Land flat to survive, Elasto-style
  springC: 3.2,    // suspension damping — the recoil/bounce lever, paired with springK.
                   // 3.3->4.0->5 slowed the recoil to a dead overdamped creep, then EASED
                   // 5->3.2 for a little bounce. HELD at 3.2 while springK was stiffened
                   // 18->24->32 for more recoil: the DAMPING RATIO (springC/(2*sqrt(springK*
                   // wheelM))) therefore DROPPED ~0.80->0.60 — stiffening alone makes it
                   // bounce more, because ζ falls as springK rises. At ~0.60 it overshoots
                   // a few % on the way back (more than the ~1.5% at 0.80), and the firmer
                   // springK 32 raises ω so that bounce is also quicker/snappier — more
                   // recoil on both counts. Bounce is a threshold: at/above critical
                   // (here springC >= 2*sqrt(32*0.22) ~= 5.31) there is NO overshoot at all,
                   // so any bounce needs ζ under 1. Lower springC (or higher springK) = more
                   // bounce; higher springC = back toward a dead creep. The hard-LANDING
                   // bounce + fall-toughness specifically is springCFade
  springCFade: 28, // relative speed (m/s) where the suspension damper fades to
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
  springExtSoft: 0.63, // the suspension is ASYMMETRIC: full springK in COMPRESSION
                   // (wheel pushed up toward the body), but this fraction of springK in
                   // EXTENSION (wheel pulled out past its rest radius). This is the
                   // "stretch further when pulled" lever, and it does NOT change the
                   // energy: the extension spring is still a spring — purely elastic, it
                   // gives back everything it stores, just over a longer/gentler stroke
                   // (only the damper dissipates energy, and that is left untouched). A
                   // pulled or flung wheel telescopes ~1/springExtSoft further out for the
                   // same pull, then slings back carrying that same energy. COMPRESSION is
                   // full-stiffness, so rest sag, landings, bump recoil and the drop-death
                   // line are all exactly unchanged — the split is at the anchor radius,
                   // and at rest the loaded wheel sits just INSIDE it (compressed), so
                   // ordinary travel never crosses into the soft zone. Lower = stretches
                   // further still; 1.0 = symmetric (back to a single linear spring)
  // (no maxStretch: there is deliberately NO hard cap on suspension travel — a wheel
  // stretches exactly as far as the springs allow. The progressive extension spring
  // below, force ∝ overshoot², is what halts a violent fling, by physics, not a wall.)
  stretchSoft: 3.3, // wheel distance from the frame CENTRE (m) where the
                    // progressive extension spring starts to bite. Set beyond the
                    // wheel's normal fling reach so ordinary riding and landings
                    // (the wheel sits closer to the centre under compression)
                    // never feel it — only a fast spin flings a wheel out this far.
                    // RAISED 1.8->3.6 for levels/test/fall.bmm: there the bike
                    // straddles two diverging "chopstick" walls hands-off and the
                    // suspension must telescope to ~3.66 m to ride them to the tips
                    // and just drop out the bottom; at 1.8 the progressive rein built
                    // up too fast (force ∝ overshoot², so ~207 N by 3.66 m), and the
                    // near-vertical walls turned that inward pull into enough lift to
                    // halt the descent and bounce the bike back up (it stalled ~2.7 m).
                    // Past 1.8 m only a violent air spin reaches at all, and only out
                    // to ~2.26 m, so moving the onset to 3.6 leaves EVERY normal-play
                    // contact below it: the lone visible effect is a max-spin fling now
                    // slings ~0.33 m further (2.26->2.59 m), reined by the linear
                    // extension spring instead. Beyond 3.6 m the progressive spring is
                    // still full-stiffness (stretchK), so the hard backstop on a truly
                    // pathological fling is intact — the onset just moved out
  stretchK: 60,    // stiffness of the progressive extension spring — the EMERGENT
                    // replacement for the old `maxStretch` hard cap: instead of a wall
                    // that teleported an over-flung wheel back, a force that grows with
                    // overshoot² past stretchSoft reins it in by physics, storing the
                    // energy and slinging the wheel back when the spin drops. Higher =
                    // wheels fling less far and snap back harder; lower = they stretch
                    // further. It is purely radial (adds no torque, so the free air spin
                    // is untouched) and only engages past stretchSoft (now 3.6 m from
                    // centre, far beyond both the ~1.04 m rest reach and the ~2.26 m
                    // max-spin fling), so at rest and through normal travel it is exactly
                    // zero — springK alone sets rest sag and recoil.
                    // Only a fast frame spin flings a wheel out this far (the wheel
                    // co-rotating with the spinning frame), so in gentle play it never
                    // engages and changing it does nothing visible
  // (frameR removed: the body has no collider of any kind — not against terrain,
  // objects, or nut mounds — so only the head and wheels ever touch anything.)
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
                   // quicker" job is done instead by the cap holding full thrust all the
                   // way up (the old high-speed taper was removed), keeping accel ~constant
  engineLow: 0.25, // extra low-end torque fraction: full extra at zero wheel spin, gone
                   // by engineKnee. Back to 0.25 (stock hill-start grunt) with engineT
  engineKnee: 12,  // wheel spin (rad/s, ~4.8 m/s) where the extra runs out
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
                   // The maxSpin cap alone sets the top now (the old engineFade taper that
                   // used to soften the approach was a dead lever at 0 and is gone).
  brakeSpringK: 65, // BRAKE = a stiff spring pinning the wheel to its captured ground-
                   // contact point (Elasto Mania's model), NOT a spin-decay clutch. This is
                   // the pin STIFFNESS: how rigidly a braked wheel is held in place against
                   // the world. The wheel↔frame suspension spring then carries that pinned
                   // wheel's reaction to the frame, so the stoppie pitch, the hill-park hold
                   // and the brake-bounce all EMERGE from geometry — no separate stoppie,
                   // parking-clamp or brake-grip rules. Must be well above springK (23) so
                   // the pin wins over the suspension and the wheel actually stays put;
                   // higher = a more rigid, abrupt stop, lower = a softer, longer one.
                   // Because the pin acts on the wheel's POSITION while the throttle acts on
                   // its SPIN, gas+brake no longer fight over one number (the old bug) — the
                   // engine loads the chassis against the planted wheel, exactly as in Elasto.
  brakeSpringC: 6, // pin DAMPING: bleeds the braked wheel's velocity, so it's the main
                   // "kill the wheel's motion" term — how hard the stop bites. Higher = the
                   // wheel halts more sharply (a more violent stoppie at speed); lower = it
                   // coasts into the pin. Feel lever, paired with brakeSpringK.

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
  voltAcc: 18,    // torque of ONE normal volt pump (the punch). Sets normal-volt
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
  alovoltAcc: 5.5,    // CONTINUOUS torque of the alovolt (both keys) — sustained, not
                    // pulsed, so it clearly out-spins the bursty normal volt while
                    // held. The cadence gates when it can ENGAGE, but the drive itself
                    // is the same on ground and air. Eased 7->5 for a more controllable
                    // supervolt spin-up. The no-flat-ground-flip behaviour no longer
                    // depends on keeping this modest — with no spin-fling sling the
                    // wheels stay planted, so a flat-ground spin drives the head into
                    // the ground rather than pogoing off a slung-out anchor. TOP SPIN
                    // isn't set here either — it's bounded emergently
                    // by air drag on the wheels (lower PHYS.drag for a higher ceiling)
  voltReachRate: 14, // 1/s the rider's arm pumps toward fully-leaned DURING each
                    // torque punch and falls back in the gap, so the arm visibly
                    // punches per pump (render.js reads bike.voltReach). Cosmetic

  // ROCK has effectively INFINITE STATIC tyre friction (Elasto Mania's model — the tyre
  // never wheelspins under drive and climbs steep grades on pure grip; see wheelContacts),
  // so there is no rock friction COEFFICIENT to set: the old `mu` const and the
  // `gripSlip`/`gripBite`/`gripGasResist` landing-slip-bite bandaids are all gone. What is
  // bounded is the RATE the tyre resyncs SLIP, not the force:
  gripUp: 120,     // max contact SLIP (m/s) the tyre sheds per second — a slip-killing
                   // acceleration, so it's substep-rate-independent (the per-step cap is
                   // gripUp*dt). The grip FORCE is still unbounded at the tiny per-step
                   // slips of real rolling/climbing, so static grip stays effectively
                   // infinite (a vertical wall, where the normal force →0, still holds —
                   // a Coulomb mu*N cap could not), and the engine never wheelspins (launch
                   // injects slip at ~46 m/s², well under this). The cap ONLY bites on a
                   // large slip MISMATCH — a wheel that spun up free in the air, or a
                   // forward-rolling wheel whose TOP meets a ceiling (slip ~2x forward
                   // speed). Those used to resolve in ONE step: the uncapped impulse
                   // dumped the whole mismatch as an instant velocity jolt (~25% of the
                   // slip → forward wheel velocity), which the stiff suspension relayed as
                   // a harsh SNAP on the floor and a backward CLIP off a ceiling. Now that
                   // mismatch bleeds over ~0.1–0.2 s, so the wheel grips up SMOOTHLY /
                   // slides along instead of slamming. SIDE EFFECTS, both minor + arguably
                   // truer: a hard-spun wheel skates ~0.1 s on landing instead of syncing
                   // instantly (this REVERSES the old "instant sync, no skate" goal); and a
                   // braked wheel's spin bleeds down over a beat (a brief skid) rather than
                   // snapping to a stop. Lower = a longer, slidier grip-up (more skate);
                   // raise toward instant for the old snappy sync (too high reintroduces
                   // the slam). Must stay above the ~46 m/s² launch slip rate or the engine
                   // wheelspins off the line. Glass keeps its own Coulomb cap (muGlass):
  muGlass: 0.06,   // tire friction on obsidian glass: the engine can barely push, so
                   // glass is crossed on momentum alone. The brake doesn't pin on glass
                   // either (the pin is rock-only, see brakeSpringK / w.onRock) — a braked
                   // wheel locks its spin but keeps sliding across glass
  // Off-throttle COAST BRAKE — a direct VELOCITY brake on the grounded bike that brings a
  // coast to a genuine STOP. A wheel-spin bleed can't do it (the wheel's rotational inertia
  // is tiny, so bleeding spin barely slows the heavy frame and just locks the wheels while
  // the frame coasts on) — there used to be an on-throttle `rollResGas` spin bleed too, but
  // it was tuned to 0 and removed. So the brake scales the frame + wheel velocities together
  // (they decelerate as one body): a firm speed-proportional bite (coastV) plus a constant
  // near-stop floor (coastC). Separate from tyre friction (mu), so climb/brake feel untouched.
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
                   // the head or either wheel (the body/belly has no collider) is
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
// L.blendPolys ([polyIndex, ...]) is the same foreground layer painted to MERGE:
// drawn over the rider with no outline so it blends seamlessly into the terrain
// it covers (stitch one continuous shape from several polys without visible
// seams). Collision is normal like frontPolys, but a seam-hiding fill carries no
// grass/glass top, so blend polys add nothing to either grass list.
// All of these are additive + inert when absent (no shipped level or replay
// carries them), so existing maps and tapes are untouched.
function prepareLevel(L) {
  const segments = [], grass = [], glassTops = [], frontGrass = [], frontGlassTops = [];
  const glassSpans = L.glass || [];
  const glassEdges = new Set((L.glassEdges || []).map(e => e[0] + ':' + e[1]));
  const noColl = new Set((L.noCollide || []).map(e => e[0] + ':' + e[1]));
  const invisible = new Set(L.invisible || []);
  const front = new Set(L.frontPolys || []);
  const blend = new Set(L.blendPolys || []);
  L.polygons.forEach((poly, pi) => {
    // a polygon nested inside another is a solid island in the playable
    // area (evenodd fill), so its playable side is the inverse
    const island = L.polygons.some(p =>
      p !== poly && pointInPoly(poly[0][0], poly[0][1], p));
    // invisible polys and blend polys both draw no grass: invisible draws
    // nothing, blend is a bare seam-hiding fill
    const polyNoGrass = invisible.has(pi) || blend.has(pi);
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
      // side upward; glass gets a sheen instead. Invisible and blend polygons
      // draw no grass/glass top (nothing, and a bare merge fill respectively).
      if (!polyNoGrass && Math.abs(dx) > 0.001 && Math.abs(dy / dx) < 2.0) {
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
        brakeAnchor: null, // world contact point the brake pins the wheel to while
                           // braking; cleared the moment brake or contact is lost
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

    // the wheels' spring anchors sit at a FIXED offset in frame space. Total
    // suspension travel is bounded only by the springs (no hard clamp — see end
    // of step). (There used to be a spin-driven "sling" that extended the anchor
    // outward with avel²; it was disabled, found to be unwanted, and removed.)
    const anchorDist = Math.hypot(P.anchorX, P.anchorY); // rest radius of each wheel
    for (let i = 0; i < 2; i++) {
      const w = this.wheels[i];
      const lx = (i === 0 ? -1 : 1) * P.anchorX, ly = P.anchorY;
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
      // ASYMMETRIC spring stiffness: full springK while the wheel is at/inside its
      // rest radius (compression — rest sag, landings, recoil, drop-death), but
      // softened to springExtSoft*springK once it is pulled OUT past that radius, so
      // it stretches further when pulled. Still a spring (elastic), so it returns the
      // same energy — only the travel grows. The damper (cf) is unchanged.
      const cwx = w.pos.x - this.pos.x, cwy = w.pos.y - this.pos.y;
      const crad = Math.hypot(cwx, cwy);
      const kEff = crad > anchorDist ? P.springK * P.springExtSoft : P.springK;
      const Fx = -kEff * dx - cf * rvx;
      const Fy = -kEff * dy - cf * rvy;
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
      // sits closer to the centre under compression) never feel it. (cwx/cwy/crad
      // computed above for the asymmetric stiffness split.)
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
        // gone by engineKnee) for hill starts. (A high-end taper used to live here —
        // engineFade ∝ (spin/maxSpin)² — but it was tuned to 0 to hold full thrust to
        // the cap, a dead lever, so it's gone; the maxSpin cap alone sets the top.)
        const eT = P.engineT *
          (1 + P.engineLow * Math.max(0, 1 - Math.abs(w.spin) / P.engineKnee));
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
      // BRAKE = a stiff spring pinning the wheel to its captured ground-contact point
      // (Elasto Mania's model), replacing the old spin-decay clutch. While braking and on
      // rock, a stiff spring+damper holds the wheel's POSITION against the captured world
      // point, so the contact can't translate — the wheel rolls to a halt against the pin
      // and then parks. The "locked tyre" look, the stoppie, the hill-park hold and the
      // brake-bounce all EMERGE from this plus the wheel↔frame suspension carrying the
      // pinned wheel's reaction to the frame — no separate rules. With the wheel pinned, the
      // infinite rock friction keeps it rolling-consistent, so its spin falls to 0 on its
      // own as it stops; ON ROCK there is no explicit spin lock (one was tried — `w.spin=0`
      // each step — but it FOUGHT the infinite friction, which re-rolls the wheel, and that
      // tug-of-war bled ~25%/substep of contact speed as a fixed, untunable hammer that made
      // the brake far too strong; dropping it lets brakeSpringK/C BE the strength levers).
      // OFF rock there's no contact to pin and (airborne) no grip to stop the wheel, so the
      // rotation IS locked directly (w.spin=0) — Elasto's "locks both tires" for a wheel in
      // the AIR, and on GLASS the wheel then slides locked (still crossed on momentum, since
      // glass isn't pinned). The pin acts on POSITION while the throttle acts on SPIN, so
      // gas+brake don't fight over one number — the engine loads the chassis against the
      // planted wheel, as in Elasto. The anchor drops the instant the brake releases or rock
      // contact is lost (w.onRock is last step's), so you can't hang from a ceiling.
      if (input.brake) {
        if (w.onRock) {
          if (!w.brakeAnchor) w.brakeAnchor = { x: w.pos.x, y: w.pos.y };
          const bx = -P.brakeSpringK * (w.pos.x - w.brakeAnchor.x) - P.brakeSpringC * w.vel.x;
          const by = -P.brakeSpringK * (w.pos.y - w.brakeAnchor.y) - P.brakeSpringC * w.vel.y;
          w.vel.x += (bx / P.wheelM) * dt;
          w.vel.y += (by / P.wheelM) * dt;
        } else {
          // no rock contact to pin against (airborne or on glass): drop the anchor, but
          // still LOCK the tyre's rotation — Elasto "locks both tires", so a braked wheel
          // stops spinning in the air (and slides locked on glass). Safe off rock: there's
          // no infinite friction here to fight, so it's not the hammer the on-rock lock was.
          w.spin = 0;
          w.brakeAnchor = null;
        }
      } else {
        w.brakeAnchor = null;
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

    for (const w of this.wheels) this.wheelContacts(w, segs, dt);

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

    // off-throttle COAST BRAKE: a direct VELOCITY brake on the grounded bike (coastC +
    // coastV*speed), scaling the frame AND wheels together so they decelerate as one rigid
    // body and roll to a genuine STOP. ROCK only (gated on w.onRock): GLASS has no rolling
    // resistance, so you keep your momentum and slide across it. This coast brake — NOT
    // muGlass — was the real drag on glass (coastV*speed ~2 m/s² at 10 m/s dwarfs the tiny
    // muGlass*N tyre friction), so gating it off glass is what makes glass actually slippery.
    // (On the gas there's no resistance either — the old rollResGas was removed.)
    if (!input.throttle && (this.wheels[0].onRock || this.wheels[1].onRock)) {
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

    // nut mounds — the level's "killers". Like every other contact on the bike,
    // only the head and the two wheels touch them — the body/belly has no
    // collider of any kind, so a mound within partR + nutR of the head or a
    // wheel kills instantly, but the frame can pass through. Inert on maps with
    // no nuts (kills empty/undefined), so existing tracks are untouched
    if (!this.dead && kills) {
      const parts = [
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

  wheelContacts(w, segs, dt) {
    const P = PHYS;
    w.onGround = false;
    w.onRock = false; // contacting non-glass terrain this step — gates the brake pin
                      // (Bike.step); glass stays low-grip so a braked wheel slides on it

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
    // grind tracking (cosmetic): the wheel's dominant "working" rock contact this
    // step — its bulk travel speed over the surface (grindSpeed), its slip speed
    // (grind), the normal slam (grindImpact) and a throw direction — so the renderer
    // can kick dirt off any wheel that's moving on the ground (rolling, skidding,
    // spinning or landing). Inert (the sim never reads it); glass is smooth, excluded.
    let grind = 0, grindSpeed = 0, grindImpact = 0,
        grindNX = 0, grindNY = 0, grindTX = 0, grindTY = 0;
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
      if (!seg.glass) w.onRock = true; // rock support → the brake may pin here
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
      // the hardest normal slam on this wheel this step (the weight bearing down
      // on a landing). Feeds the dirt burst alongside the slip; glass never digs.
      if (!seg.glass && jn > grindImpact) grindImpact = jn;

      const tx = -ny, ty = nx;
      const vg = w.vel.x * tx + w.vel.y * ty; // contact tangential velocity
      // (No parking clamp here any more: a held brake holds the bike on a slope through the
      // contact-point pin spring in Bike.step — and with the wheel's spin locked and the
      // infinite rock friction below, the contact can't slide either, so no clamp is needed.)
      const vt = vg - P.wheelR * w.spin;
      // record the dominant "working" loaded rock contact for the dirt spray: its
      // bulk travel over the ground (|vg|) and its slip (|vt|), plus the surface
      // normal and throw direction. emitDirt (game.js) turns these into clods —
      // gating the travel term on how hard the engine/brake is loading the ground,
      // so a clean coast stays quiet. pen>0 means the tyre is actually pressing in;
      // glass is smooth, so excluded.
      if (!seg.glass && pen > 0 && Math.abs(vg) + Math.abs(vt) > grindSpeed + grind) {
        grind = Math.abs(vt);
        grindSpeed = Math.abs(vg);
        grindNX = nx; grindNY = ny;
        // throw grit tangentially BACKWARD relative to travel (a rooster tail);
        // near a standstill (a burnout) fall back to the wheelspin slip direction
        const tdir = Math.abs(vg) > 0.5 ? -vg : vt;
        const sg = tdir >= 0 ? 1 : -1;
        grindTX = sg * tx; grindTY = sg * ty;
      }
      const meff = 1 / (1 / P.wheelM + P.wheelR * P.wheelR / P.wheelI);
      // tyre friction drives the contact-point slip (vt) toward zero. ROCK has effectively
      // INFINITE STATIC grip (Elasto Mania's model) — engine torque always hooks up and
      // steep grades climb on pure grip — but the slip is resynced at a BOUNDED RATE, not
      // all in one step. The full impulse -vt*meff would zero any slip this step; that is
      // kept while |vt| is within what the tyre can shed this step (gripUp*dt), which covers
      // all real rolling/climbing (tiny per-step slip) so grip there is unchanged and the
      // engine never wheelspins. But a LARGE slip mismatch — a wheel that spun up free in
      // the air, or a forward-rolling wheel whose top meets a ceiling (~2x slip) — is capped
      // to gripUp*dt of slip per step, so instead of dumping the whole mismatch as a
      // one-step velocity jolt (the floor-snap / ceiling-clip slam) the wheel grips up
      // smoothly over a beat. The grip FORCE is never capped (only the rate), so a vertical
      // wall where the normal force →0 still holds — unlike a Coulomb mu*N cap. GLASS keeps
      // that Coulomb cap (muGlass*jn): it stays slippery and is crossed on momentum alone.
      let jt = -vt * meff;
      if (seg.glass) {
        const maxF = P.muGlass * jn;
        if (jt > maxF) jt = maxF;
        if (jt < -maxF) jt = -maxF;
      } else {
        const maxDvt = P.gripUp * dt;            // slip the tyre can shed this step
        if (Math.abs(vt) > maxDvt) jt = -Math.sign(vt) * maxDvt * meff; // bleed, don't slam
      }
      w.vel.x += tx * jt / P.wheelM;
      w.vel.y += ty * jt / P.wheelM;
      w.spin += (-P.wheelR * jt) / P.wheelI;
      // (No brake stoppie-torque rule here any more: the stoppie now EMERGES — a braked
      // wheel is pinned in place by the contact spring (Bike.step) while the body's
      // momentum carries it forward, so the suspension pitches the frame over on its own.)
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
    w.grind = grind;                            // dominant contact slip (m/s), cosmetic
    w.grindSpeed = grindSpeed;                  // bulk travel speed over the ground (m/s)
    w.grindImpact = grindImpact;                // hardest normal slam (impulse) this step
    w.grindNX = grindNX; w.grindNY = grindNY;   // surface normal (points up off the ground)
    w.grindTX = grindTX; w.grindTY = grindTY;   // slip tangent (the dirt-throw direction)
  }
}
