// Drives a bot across a level to sanity-check traversability.
// Usage: node test/drive_map.js [levelIndex]
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const idx = parseInt(process.argv[2] || '0', 10);
const code =
  fs.readFileSync(path.join(root, 'js/levels.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'js/physics.js'), 'utf8') + '\n' + `
const level = prepareLevel(LEVELS[${idx}]);
const dt = 1 / 480;
let b = new Bike(level.start.x, level.start.y);
const burgers = level.burgers.map(p => ({ x: p[0], y: p[1], got: false }));
let reachedGoal = null;
// simple rider: full gas, but counter-lean to keep the wheelie in check,
// the way a player modulates pitch
for (let i = 0; i < 480 * 40; i++) {
  const input = {
    throttle: b.angle > -0.45,
    right: b.angle < -0.25,
    left: b.angle > 0.3,
  };
  b.step(dt, input, level.segments);
  if (b.dead) { console.log('died t=' + (i * dt).toFixed(2) + ' x=' + b.pos.x.toFixed(2)); break; }
  const h = b.headPos();
  const pts = [
    { p: b.pos, r: 0.6 }, { p: h, r: PHYS.headR },
    { p: b.wheels[0].pos, r: PHYS.wheelR }, { p: b.wheels[1].pos, r: PHYS.wheelR },
  ];
  for (const bg of burgers) {
    if (bg.got) continue;
    for (const o of pts) {
      if (Math.hypot(o.p.x - bg.x, o.p.y - bg.y) < o.r + 0.45) { bg.got = true; break; }
    }
  }
  if (reachedGoal === null &&
      pts.some(o => Math.hypot(o.p.x - level.goal[0], o.p.y - level.goal[1]) < o.r + 0.5)) {
    reachedGoal = i * dt;
  }
}
console.log('level "' + level.name + '"' +
  ' final x=' + b.pos.x.toFixed(2) + ' y=' + b.pos.y.toFixed(2) +
  ' burgers=' + burgers.filter(g => g.got).length + '/' + burgers.length +
  ' goal=' + (reachedGoal === null ? 'no' : reachedGoal.toFixed(2) + 's') +
  ' dead=' + b.dead);
`;
eval(code);
