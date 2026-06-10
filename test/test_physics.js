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

// 2. drive test: hold throttle for 14 s, should travel far without dying
b = new Bike(level.start.x, level.start.y);
let maxX = 0, diedAt = null;
for (let i = 0; i < 480 * 14; i++) {
  b.step(dt, { throttle: true }, level.segments);
  if (b.pos.x > maxX) maxX = b.pos.x;
  if (b.dead) { diedAt = i * dt; break; }
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

// 5. flip test: facing toggles and driven wheel swaps
b = new Bike(level.start.x, level.start.y);
const r0 = b.rearIndex;
b.flip();
console.log('FLIP    facing=%s rearIndex %s -> %s', b.facing, r0, b.rearIndex);
`;
eval(code);
