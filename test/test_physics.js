// Headless sanity test: loads the level + physics and simulates the bike.
// Run with: node test/test_physics.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const code =
  fs.readFileSync(path.join(root, 'js/levels.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'js/physics.js'), 'utf8') + '\n' + `
const level = prepareLevel(LEVELS[0]);
const dt = 1 / 480;

// 1. settle test: bike should come to rest near the start without crashing
let b = new Bike(level.start.x, level.start.y);
for (let i = 0; i < 480 * 2; i++) b.step(dt, {}, level.segments);
console.log('SETTLE  x=%s y=%s angle=%s dead=%s',
  b.pos.x.toFixed(2), b.pos.y.toFixed(2), b.angle.toFixed(3), b.dead);

// 2. drive test: gas with player-style counter-leaning for 14 s, should
//    travel far without dying (blind full throttle loops out on purpose)
b = new Bike(level.start.x, level.start.y);
let maxX = 0, diedAt = null;
{
let airT = 0, settle = 0;
for (let i = 0; i < 480 * 14; i++) {
  const grounded = b.wheels[0].onGround || b.wheels[1].onGround;
  const sp = Math.hypot(b.vel.x, b.vel.y);
  let travel = b.vel.x > 1 ? Math.atan2(b.vel.y, b.vel.x) : 0;
  travel = Math.max(-0.6, Math.min(0.2, travel));
  const pred = b.angle - travel + 0.3 * b.avel;
  if (!grounded) airT += dt;
  else { if (airT > 0.3) settle = 0.12; airT = 0; }
  if (settle > 0) settle -= dt;
  b.step(dt, {
    throttle: (pred > -0.45 || (sp < 3.5 && grounded && pred > -0.85)) &&
      settle <= 0 && sp < 9,
    right: pred < (grounded ? -0.6 : -1.3),
    left: pred > 1.15,
  }, level.segments);
  if (b.pos.x > maxX) maxX = b.pos.x;
  if (b.dead) { diedAt = i * dt; break; }
}
}
console.log('DRIVE   x=%s maxX=%s dead=%s diedAt=%s',
  b.pos.x.toFixed(2), maxX.toFixed(2), b.dead, diedAt && diedAt.toFixed(2));

// 3. brake test: accelerate 3 s then brake 3 s, speed should drop near zero
b = new Bike(level.start.x, level.start.y);
for (let i = 0; i < 480 * 3; i++) b.step(dt, { throttle: true }, level.segments);
const vAfterGas = Math.hypot(b.vel.x, b.vel.y);
for (let i = 0; i < 480 * 3 && !b.dead; i++) b.step(dt, { brake: true }, level.segments);
const vAfterBrake = Math.hypot(b.vel.x, b.vel.y);
console.log('BRAKE   v(gas 3s)=%s v(brake 3s)=%s dead=%s',
  vAfterGas.toFixed(2), vAfterBrake.toFixed(2), b.dead);

// 4. lean test: in the air-ish start, holding left should rotate CCW (angle decreases)
b = new Bike(level.start.x, level.start.y - 3);
for (let i = 0; i < 480 * 0.5; i++) b.step(dt, { left: true }, level.segments);
console.log('LEAN    angle after 0.5s left =', b.angle.toFixed(3), '(expect < 0)');

// 5. wheelie test: hard acceleration from rest should pitch the bike
//    backward (angle goes negative) and lift the front wheel
b = new Bike(level.start.x, level.start.y);
for (let i = 0; i < 480 * 0.5; i++) b.step(dt, {}, level.segments); // settle
let minAngle = 0, maxLift = 0;
for (let i = 0; i < 480 * 1.5 && !b.dead; i++) {
  b.step(dt, { throttle: true }, level.segments);
  minAngle = Math.min(minAngle, b.angle);
  // ground is at y=8 here; lift = clearance under the front wheel
  maxLift = Math.max(maxLift, 8 - PHYS.wheelR - b.wheels[1].pos.y);
}
console.log('WHEELIE minAngle=%s frontLift=%s dead=%s',
  minAngle.toFixed(3), maxLift.toFixed(3), b.dead);

// 6. coast test: a slow-rolling bike on flat ground must come to a full stop
//    (uses a dedicated long flat floor; the level's start flat is short)
const flat = [{ ax: -100, ay: 8, bx: 200, by: 8 }];
b = new Bike(level.start.x, level.start.y);
for (let i = 0; i < 480 * 0.5; i++) b.step(dt, {}, flat); // settle
b.vel.x = 1.2;
for (const w of b.wheels) { w.vel.x = 1.2; w.spin = 1.2 / PHYS.wheelR; }
let stoppedAt = null;
for (let i = 0; i < 480 * 6; i++) {
  b.step(dt, {}, flat);
  if (stoppedAt === null && Math.abs(b.vel.x) < 0.01) { stoppedAt = i * dt; break; }
}
console.log('COAST   stoppedAt=%s finalV=%s',
  stoppedAt === null ? 'never' : stoppedAt.toFixed(2) + 's', b.vel.x.toFixed(3));

// 7. brake-tilt test: slamming the brakes at speed should pitch the bike
//    forward (angle goes positive when travelling right)
b = new Bike(level.start.x, level.start.y);
for (let i = 0; i < 480 * 0.5; i++) b.step(dt, {}, flat); // settle
const v0 = 14;
b.vel.x = v0;
for (const w of b.wheels) { w.vel.x = v0; w.spin = v0 / PHYS.wheelR; }
let maxFwd = 0;
for (let i = 0; i < 480 * 1.5 && !b.dead; i++) {
  b.step(dt, { brake: true }, flat);
  maxFwd = Math.max(maxFwd, b.angle);
}
console.log('BRAKE-T maxFwdAngle=%s dead=%s (expect > 0.1)',
  maxFwd.toFixed(3), b.dead);

// 8. flip test: facing toggles and driven wheel swaps
b = new Bike(level.start.x, level.start.y);
const r0 = b.rearIndex;
b.flip();
console.log('FLIP    facing=%s rearIndex %s -> %s', b.facing, r0, b.rearIndex);
`;
eval(code);
