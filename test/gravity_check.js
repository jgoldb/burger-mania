// Directional gravity check: a gravity burger SETS the bike's gravity direction
// (the Elasto Mania gravity apple — up/down/left/right). The collection lives in
// game.js, but the engine effect is the bike's `gravDir` unit vector, tested here
// directly: down {0,1} falls +y, up {0,-1} falls -y, left {-1,0} falls -x, right
// {1,0} falls +x; opposite pairs mirror exactly, all four share one magnitude,
// and a bike that never changes gravity is bit-identical to before (gravDir
// defaults to down).
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
function drop(dir) {
  const b = new Bike(0, 0);
  b.gravDir = dir;
  for (let i = 0; i < 120; i++) b.step(dt, {}, []);
  return b;
}

// a fresh bike falls straight down by default
const fresh = new Bike(0, 0);
if (fresh.gravDir.x !== 0 || fresh.gravDir.y !== 1) bad('a fresh bike should start with gravDir {0,1} (down)');

const down = drop({ x: 0, y: 1 });
if (!(down.pos.y > 0.05 && down.vel.y > 0)) bad('down gravity should pull +y (got y=' + down.pos.y.toFixed(3) + ')');

const up = drop({ x: 0, y: -1 });
if (!(up.pos.y < -0.05 && up.vel.y < 0)) bad('up gravity should pull -y (got y=' + up.pos.y.toFixed(3) + ')');

const left = drop({ x: -1, y: 0 });
if (!(left.pos.x < -0.05 && left.vel.x < 0)) bad('left gravity should pull -x (got x=' + left.pos.x.toFixed(3) + ')');

const right = drop({ x: 1, y: 0 });
if (!(right.pos.x > 0.05 && right.vel.x > 0)) bad('right gravity should pull +x (got x=' + right.pos.x.toFixed(3) + ')');

// opposite directions mirror exactly: same magnitude, opposite sign
if (Math.abs(down.pos.y + up.pos.y) > 1e-9) bad('up/down falls should mirror');
if (Math.abs(left.pos.x + right.pos.x) > 1e-9) bad('left/right falls should mirror');
// all four are the same fall, just rotated: equal magnitude (uniform g, no contact)
if (Math.abs(down.pos.y - right.pos.x) > 1e-9) bad('vertical and horizontal falls should be equal in magnitude');

// inert when never changed: a default fall is bit-identical to explicit down
const plain = new Bike(0, 0);
for (let i = 0; i < 120; i++) plain.step(dt, {}, []);
if (plain.pos.y !== down.pos.y || plain.vel.y !== down.vel.y) {
  bad('default-gravity fall changed vs explicit down — gravDir is not inert at default');
}

console.log(fail ? 'FAILED (' + fail + ')' : 'OK  directional gravity: down/up/left/right pull correctly, opposite pairs mirror, inert at default');
process.exit(fail ? 1 : 0);
`;
eval(code);
