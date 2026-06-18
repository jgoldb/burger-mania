// Elasto-Mania fidelity suite. Locks in the structural behaviours that make the
// engine play like Elma, as PROPERTIES (with tolerances) rather than brittle exact
// numbers, so they keep passing while the feel is tuned but FAIL if a change breaks
// the Elma model. Each block cites the Elma trait it guards.
// Run with: node test/elma_fidelity.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
// physics.js is a plain script (no module.exports); concatenate + eval so PHYS, Bike
// and the helpers share one scope (the project's headless-harness convention).
const code = fs.readFileSync(path.join(root, 'js/physics.js'), 'utf8') + '\n' + `
const dt = 1 / 480;
let fail = 0, pass = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { console.log('FAIL: ' + msg); fail++; } };
const R = PHYS.wheelR;

// --- fixtures -------------------------------------------------------------
// raw segment arrays fed straight to step() (no prepareLevel needed). glass:true
// marks the one slippery surface; everything else is infinite-grip rock.
const FLOOR = 8;
const rock  = () => [{ ax: -500, ay: FLOOR, bx: 5000, by: FLOOR }];
const glass = () => [{ ax: -500, ay: FLOOR, bx: 5000, by: FLOOR, glass: true }];
// a bike dropped just above the floor and left to settle to rest (deterministic)
const settled = (segs) => {
  const b = new Bike(2.5, FLOOR - 1.2);
  for (let i = 0; i < 720; i++) b.step(dt, {}, segs);
  return b;
};
const ride = (b, input, secs, segs) => {
  for (let i = 0; i < Math.round(480 * secs) && !b.dead; i++) b.step(dt, input, segs);
};

// === 1. UNIFORM GRAVITY (no air/ground split — a jump is a clean constant-g parabola)
{
  const b = new Bike(0, 0);
  const vy0 = b.vel.y;
  b.step(dt, {}, []);                       // one free-flight step (no segments)
  const a = (b.vel.y - vy0) / dt;
  ok(Math.abs(a - PHYS.g) < 0.05, "free-flight vertical accel equals g (" + a.toFixed(3) + " vs " + PHYS.g + ")");
  ok(Math.abs(b.vel.x) < 1e-9, "free flight adds no horizontal accel (vx=" + b.vel.x + ")");
}
{
  const b = new Bike(0, 0);
  let constant = true, prev = b.vel.y;
  for (let i = 0; i < 200; i++) { b.step(dt, {}, []); const a = (b.vel.y - prev) / dt; if (Math.abs(a - PHYS.g) > 0.05) constant = false; prev = b.vel.y; }
  ok(constant, "free-flight accel stays constant at g over a long arc (uniform gravity)");
}

// === 2. GRAVITY DIRECTION (a gravity burger aims gravity any of the 4 ways — ride walls/ceilings)
{
  const b = new Bike(0, 0);
  b.gravDir = { x: 1, y: 0 };               // sideways gravity
  const vx0 = b.vel.x;
  b.step(dt, {}, []);
  const a = (b.vel.x - vx0) / dt;
  ok(Math.abs(a - PHYS.g) < 0.05, "sideways gravity burger accelerates the bike along +x at g (" + a.toFixed(3) + ")");
  ok(Math.abs(b.vel.y) < 1e-9, "sideways gravity adds no vertical accel (vy=" + b.vel.y + ")");
}

// === 3. HEAD IS THE ONLY TERRAIN DEATH (body has no collider; wheels touching is safe)
{
  const b = settled(rock());
  ok(!b.dead, "a bike resting with both wheels on the ground is alive (wheel contact never kills)");
  // a wall through the HEAD kills in one step
  const hb = settled(rock());
  const h = hb.headPos();
  hb.step(dt, {}, [...rock(), { ax: h.x - 1, ay: h.y, bx: h.x + 1, by: h.y }]);
  ok(hb.dead, "terrain touching the HEAD is fatal");
  // a wall through the FRAME BODY (clear of head + wheels) does NOT kill — the body has no collider
  const fb = settled(rock());
  fb.step(dt, {}, [...rock(), { ax: fb.pos.x - 0.1, ay: fb.pos.y, bx: fb.pos.x + 0.1, by: fb.pos.y }]);
  ok(!fb.dead, "terrain touching only the FRAME BODY is NOT fatal (the body has no collider)");
}

// === 4. DROP DEATH EMERGES (gentle landing survives; a hard enough slam sinks the body so the head hits)
{
  const soft = settled(rock());
  soft.vel.y = 2; for (const w of soft.wheels) w.vel.y = 2;
  ride(soft, {}, 0.6, rock());
  ok(!soft.dead, "a gentle downward touch (2 m/s) is survived");
  const hard = settled(rock());
  hard.vel.y = 30; for (const w of hard.wheels) w.vel.y = 30;
  ride(hard, {}, 0.6, rock());
  ok(hard.dead, "a hard slam (30 m/s) sinks the colliderless body so the head hits terrain = death");
}

// === 5. INFINITE GRIP ON ROCK / SLIP ON GLASS (Elma no-slip; glass is the one slippery surface)
{
  const br = settled(rock());
  const rx = br.pos.x;
  // a touch of counter-lean keeps the launch wheelie from looping it
  for (let i = 0; i < 480 * 1.5 && !br.dead; i++) br.step(dt, { throttle: true, left: br.angle < -0.35 }, rock());
  const rockDist = br.pos.x - rx;
  const rw = br.wheels[br.rearIndex];
  const surf = Math.abs(R * rw.spin), ground = Math.abs(rw.vel.x);
  ok(rockDist > 1.5, "engine torque drives the bike forward on rock (dist=" + rockDist.toFixed(2) + " m)");
  ok(ground > 0.5 && Math.abs(surf - ground) / ground < 0.3,
    "rear wheel ROLLS WITHOUT SLIPPING on rock (surface " + surf.toFixed(2) + " approx ground " + ground.toFixed(2) + ")");

  const bg = settled(glass());
  const gx = bg.pos.x;
  for (let i = 0; i < 480 * 1.5 && !bg.dead; i++) bg.step(dt, { throttle: true }, glass());
  const glassDist = bg.pos.x - gx;
  const gw = bg.wheels[bg.rearIndex];
  const gsurf = Math.abs(R * gw.spin), gground = Math.abs(gw.vel.x);
  ok(glassDist < rockDist * 0.5, "on glass the engine can barely push — far less travel (glass " + glassDist.toFixed(2) + " vs rock " + rockDist.toFixed(2) + ")");
  ok(gsurf > gground * 1.8 + 1, "on glass the wheel WHEELSPINS (surface " + gsurf.toFixed(2) + " >> ground " + gground.toFixed(2) + ")");
}

// === 6. TOP SPEED CAPPED (maxSpin cap = the top speed; no slip means bike speed = wheelR*spin)
{
  const b = settled(rock());
  const v0 = 20; b.vel.x = v0; for (const w of b.wheels) { w.vel.x = v0; w.spin = v0 / R; }
  ride(b, { throttle: true }, 8, rock());
  const cap = PHYS.maxSpin * R;
  ok(!b.dead, "top-speed run survives");
  ok(Math.abs(b.vel.x) <= cap * 1.03, "top speed does not exceed the maxSpin cap (" + Math.abs(b.vel.x).toFixed(2) + " <= " + cap.toFixed(2) + ")");
  ok(Math.abs(b.vel.x) >= cap * 0.9, "full throttle reaches near the cap (" + Math.abs(b.vel.x).toFixed(2) + ")");
}

// === 7. WHEELIE (rear-wheel drive + engine reaction pitches the frame back off the line)
{
  const b = settled(rock());
  let minAngle = 0;
  for (let i = 0; i < 480 * 0.6 && !b.dead; i++) { b.step(dt, { throttle: true }, rock()); minAngle = Math.min(minAngle, b.angle); }
  ok(minAngle < -0.05, "throttle from rest pitches the frame back into a wheelie (minAngle=" + minAngle.toFixed(3) + ")");
}

// === 8. BRAKE = CONTACT PIN: stops on rock, slides on glass
{
  const br = settled(rock());
  const v0 = 3; br.vel.x = v0; for (const w of br.wheels) { w.vel.x = v0; w.spin = v0 / R; }
  ride(br, { brake: true }, 4, rock());
  ok(!br.dead && Math.abs(br.vel.x) < 0.5, "braking pins the wheel and stops the bike on rock (final v=" + br.vel.x.toFixed(2) + ")");

  const bg = settled(glass());
  const vg = 8; bg.vel.x = vg; for (const w of bg.wheels) { w.vel.x = vg; w.spin = vg / R; }
  ride(bg, { brake: true }, 2, glass());
  ok(Math.abs(bg.vel.x) > vg * 0.5, "braking does NOT pin on glass — the bike slides on (v=" + bg.vel.x.toFixed(2) + " from " + vg + ")");
}

// === 8b. BRAKE LOCKS THE TYRE EVEN IN THE AIR (Elma "locks both tires" — airborne too)
{
  const b = new Bike(2.5, -50);
  ride(b, { throttle: true }, 0.6, []);      // gas in the air spins the rear wheel up
  const spun = Math.abs(b.wheels[b.rearIndex].spin);
  ride(b, { brake: true }, 0.3, []);          // now brake, still airborne
  ok(spun > 5, "gas in the air spins the wheel up (spin=" + spun.toFixed(1) + ")");
  ok(Math.abs(b.wheels[b.rearIndex].spin) < 0.5, "braking LOCKS the spinning wheel in the air (spin=" + Math.abs(b.wheels[b.rearIndex].spin).toFixed(2) + ")");
}

// === 9. HILL-PARK (a held brake holds position on a slope; coasting slides down) — slope = tilted gravity
{
  const th = 20 * Math.PI / 180, gd = { x: Math.sin(th), y: Math.cos(th) };
  const held = settled(rock()); held.gravDir = gd; const hx = held.pos.x;
  let heldDrift = 0;
  for (let i = 0; i < 480 * 3 && !held.dead; i++) { held.step(dt, { brake: true }, rock()); heldDrift = Math.max(heldDrift, Math.abs(held.pos.x - hx)); }
  const free = settled(rock()); free.gravDir = gd; const fx = free.pos.x;
  let freeDrift = 0;
  for (let i = 0; i < 480 * 3 && !free.dead; i++) { free.step(dt, {}, rock()); freeDrift = Math.max(freeDrift, Math.abs(free.pos.x - fx)); }
  ok(heldDrift < 0.4, "a braked bike HOLDS on a 20-degree slope (drift=" + heldDrift.toFixed(2) + " m)");
  ok(freeDrift > heldDrift * 3, "an unbraked bike slides DOWN the slope (drift=" + freeDrift.toFixed(2) + " vs braked " + heldDrift.toFixed(2) + ")");
}

// === 10. GAS+BRAKE LOADS, does not cancel: the pin holds the bike while gas alone drives away
{
  const gb = settled(rock()); const gx = gb.pos.x; let gbDrift = 0;
  for (let i = 0; i < 480 * 2 && !gb.dead; i++) { gb.step(dt, { throttle: true, brake: true }, rock()); gbDrift = Math.max(gbDrift, Math.abs(gb.pos.x - gx)); }
  const g = settled(rock()); const gx2 = g.pos.x; let gDrift = 0;
  for (let i = 0; i < 480 * 2 && !g.dead; i++) { g.step(dt, { throttle: true, left: g.angle < -0.35 }, rock()); gDrift = Math.max(gDrift, Math.abs(g.pos.x - gx2)); }
  ok(gDrift > gbDrift * 3, "gas+brake HOLDS against the pin while gas alone drives away (gas+brake " + gbDrift.toFixed(2) + " m vs gas " + gDrift.toFixed(2) + " m)");
}

// === 11. VOLT (continuous lean): right and left rotate opposite ways, same rule in the air
{
  const r = new Bike(2.5, -50); ride(r, { right: true }, 0.5, []);
  const l = new Bike(2.5, -50); ride(l, { left: true }, 0.5, []);
  ok(r.angle > 0.05, "holding RIGHT in the air rotates the bike one way (angle=" + r.angle.toFixed(3) + ")");
  ok(l.angle < -0.05, "holding LEFT rotates the other way (angle=" + l.angle.toFixed(3) + ")");
}

// === 12. AIR ROTATION CONSERVES ANGULAR MOMENTUM (no artificial angular damping — Elma)
{
  const b = new Bike(2.5, -50);
  ride(b, { right: true }, 0.5, []);
  const spun = b.avel;
  ride(b, {}, 0.5, []);                      // release, keep coasting in the air
  ok(spun > 0.1, "an air volt builds rotation (avel=" + spun.toFixed(3) + ")");
  ok(b.avel > spun * 0.7, "released in the air, rotation PERSISTS (avel " + b.avel.toFixed(3) + " vs " + spun.toFixed(3) + ") — momentum conserved, not damped");
}

// === 13. ALOVOLT (both keys = a continuous supervolt in the lead direction)
{
  const b = new Bike(2.5, -200);
  b.step(dt, { right: true }, []);           // lead right -> alovolt drives clockwise(+)
  ride(b, { left: true, right: true }, 2, []);
  ok(b.angle > 0.3, "both keys drive a strong continuous alovolt rotation in the lead direction (angle=" + b.angle.toFixed(2) + ")");
}

// === 14. DETERMINISM (fixed-step, no randomness: identical inputs reproduce identical state — replays)
{
  const run = () => {
    const b = settled(rock());
    for (let i = 0; i < 480 * 3; i++) b.step(dt, { throttle: true, left: i % 120 < 30 }, rock());
    return b;
  };
  const a = run(), b = run();
  ok(a.pos.x === b.pos.x && a.pos.y === b.pos.y && a.angle === b.angle && a.vel.x === b.vel.x,
    "identical inputs reproduce a bit-identical trajectory (deterministic sim)");
}

console.log(fail ? ("FAILED (" + fail + " of " + (fail + pass) + ")") : ("OK  all " + pass + " Elma-fidelity checks passed"));
process.exit(fail ? 1 : 0);
`;
eval(code);
