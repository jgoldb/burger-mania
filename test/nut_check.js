// Nut-mound hazard check: loads the level + physics and verifies the new
// "killer" obstacle. A nut mound is fatal on contact with the head or either
// wheel (the body/belly has no collider), it kills whether the bike is rolling
// into it or parked on it, and a map with no nuts behaves exactly as before
// (the field is optional and inert when absent).
// Run with: node test/nut_check.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const code =
  fs.readFileSync(path.join(root, 'js/levels.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'js/physics.js'), 'utf8') + '\n' + `
const dt = 1 / 480;
let fail = 0;
const bad = m => { console.log('FAIL', m); fail++; };

// a plain flat box; the nut field is filled in per-case
const makeLevel = nuts => prepareLevel({
  name: 'Nut Test', theme: 'meadow',
  polygons: [[[-5, -8], [60, -8], [60, 8], [-5, 8]]],
  start: { x: 2.5, y: 7.25 }, burgers: [], goal: [55, 7.25], nuts,
});

// a bike rested on the flat floor (deterministic, so every case starts alike)
function settled(level) {
  const b = new Bike(level.start.x, level.start.y);
  for (let i = 0; i < 480; i++) b.step(dt, {}, level.segments, level.nuts);
  return b;
}

// 1. a clear floor (no nuts) must never kill, and must tolerate an absent field
const clear = makeLevel([]);
let b = settled(clear);
for (let i = 0; i < 480 * 3 && !b.dead; i++) b.step(dt, { throttle: false }, clear.segments);
if (b.dead) bad('a parked bike died on bare floor with no nuts');

// 2. each COLLIDER (head + both wheels) is independently lethal: drop a nut
//    exactly on a resting part and one step must kill. The frame body has no
//    collider of any kind, so a nut on the bare body centre — clear of head and
//    wheels (~0.85 m from each wheel, past the wheelR+nutR reach) — must pass
//    straight through without killing.
const probe = settled(clear);
const parts = {
  head: [probe.headPos().x, probe.headPos().y],
  wheelL: [probe.wheels[0].pos.x, probe.wheels[0].pos.y],
  wheelR: [probe.wheels[1].pos.x, probe.wheels[1].pos.y],
};
for (const [name, p] of Object.entries(parts)) {
  const lvl = makeLevel([p]);
  const t = settled(clear);                 // a fresh, identical resting bike
  t.step(dt, {}, lvl.segments, lvl.nuts);
  if (!t.dead) bad('a nut mound on the ' + name + ' should be fatal');
}
const bellyLvl = makeLevel([[probe.pos.x, probe.pos.y]]);
const belly = settled(clear);
belly.step(dt, {}, bellyLvl.segments, bellyLvl.nuts);
if (belly.dead) bad('a nut mound on the bare body/belly centre should NOT kill — the body has no collider');

// 3. a nut just clear of every part (2 m away) must NOT kill
const farLvl = makeLevel([[probe.pos.x + 2, probe.pos.y]]);
b = settled(clear);
for (let i = 0; i < 480 && !b.dead; i++) b.step(dt, {}, farLvl.segments, farLvl.nuts);
if (b.dead) bad('a nut mound 2 m away should not kill a parked bike');

// 4. rolling into a nut ahead on the floor is fatal (the front wheel reaches
//    it first, so the bike body is still short of the mound when it dies)
const aheadLvl = makeLevel([[5, 7.6]]);
b = settled(aheadLvl);
let i = 0;
for (; i < 480 * 4 && !b.dead; i++) b.step(dt, { throttle: true }, aheadLvl.segments, aheadLvl.nuts);
if (!b.dead) bad('rolling into a nut mound ahead should kill the rider');
if (i >= 480 * 4) bad('took implausibly long to reach a nut 2.5 m ahead');
const deathX = b.pos.x;

// 5. the SAME inputs for the SAME duration over a clear floor survive and trace
//    the identical path (the nut changes only the death flag, never the motion)
const passLvl = makeLevel([]);
b = settled(passLvl);
for (let j = 0; j < i; j++) b.step(dt, { throttle: true }, passLvl.segments, passLvl.nuts);
if (b.dead) bad('the clear-floor drive should not have crashed');
else if (Math.abs(b.pos.x - deathX) > 0.05) {
  bad('the nut perturbed the trajectory (clear x=' + b.pos.x.toFixed(2) +
    ' vs nut x=' + deathX.toFixed(2) + ')');
}

console.log(fail ? 'FAILED (' + fail + ')' : 'OK  nut hazard: contact kills, clear floor is safe');
process.exit(fail ? 1 : 0);
`;
eval(code);
