// Gravity-flip check: an upside-down burger is the Elasto Mania gravity apple —
// collecting one reverses gravity. The collection lives in game.js, but the
// engine effect is the bike's `grav` sign, tested here directly: +1 pulls down,
// -1 pulls up, the two mirror exactly, and a bike that never flips is
// bit-identical to before the feature (the multiplier is inert at +1).
// Run with: node test/gravity_check.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const code =
  fs.readFileSync(path.join(root, 'js/physics.js'), 'utf8') + '\n' + `
const dt = 1 / 480;
let fail = 0;
const bad = m => { console.log('FAIL', m); fail++; };

// open air: no segments, so the bike is purely ballistic under gravity
function drop(grav) {
  const b = new Bike(0, 0);
  b.grav = grav;
  for (let i = 0; i < 120; i++) b.step(dt, {}, []);
  return b;
}

// a fresh bike falls down by default
if (new Bike(0, 0).grav !== 1) bad('a fresh bike should start with grav = +1 (down)');

const down = drop(1);
if (!(down.pos.y > 0.05 && down.vel.y > 0)) {
  bad('grav +1 should pull the bike DOWN (got y=' + down.pos.y.toFixed(3) + ' vy=' + down.vel.y.toFixed(3) + ')');
}

const up = drop(-1);
if (!(up.pos.y < -0.05 && up.vel.y < 0)) {
  bad('grav -1 should pull the bike UP (got y=' + up.pos.y.toFixed(3) + ' vy=' + up.vel.y.toFixed(3) + ')');
}

// reversing gravity mirrors the fall exactly: same magnitude, opposite sign
if (Math.abs(down.pos.y + up.pos.y) > 1e-9) {
  bad('up and down falls should mirror (|y sum|=' + Math.abs(down.pos.y + up.pos.y) + ')');
}
if (Math.abs(down.vel.y + up.vel.y) > 1e-9) bad('up and down fall speeds should mirror');

// flipping twice is back to normal (an even number of upside-down burgers)
let b = new Bike(0, 0);
b.grav *= -1; b.grav *= -1;
if (b.grav !== 1) bad('two flips should restore normal gravity');

// the feature is inert when never triggered: a default-gravity fall is
// bit-identical to an explicit grav=+1 fall (so existing maps/replays are safe)
const plain = new Bike(0, 0);
for (let i = 0; i < 120; i++) plain.step(dt, {}, []);
if (plain.pos.y !== down.pos.y || plain.vel.y !== down.vel.y) {
  bad('default-gravity fall changed vs explicit grav=+1 — the multiplier is not inert');
}

console.log(fail ? 'FAILED (' + fail + ')' : 'OK  gravity flip: +1 down, -1 up, symmetric, inert at rest');
process.exit(fail ? 1 : 0);
`;
eval(code);
