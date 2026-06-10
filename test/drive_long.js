const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const code =
  fs.readFileSync(path.join(root, 'js/levels.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'js/physics.js'), 'utf8') + '\n' + `
const level = prepareLevel(LEVELS[0]);
const dt = 1 / 480;
let b = new Bike(level.start.x, level.start.y);
let reached = null;
for (let i = 0; i < 480 * 25; i++) {
  b.step(dt, { throttle: true }, level.segments);
  if (b.dead) { console.log('died t=' + (i * dt).toFixed(2) + ' x=' + b.pos.x.toFixed(2)); break; }
  if (reached === null && b.pos.x >= 90) reached = i * dt;
}
console.log('final x=' + b.pos.x.toFixed(2) + ' y=' + b.pos.y.toFixed(2) +
  ' reachedFlower=' + (reached === null ? 'no' : reached.toFixed(2) + 's') +
  ' dead=' + b.dead);
`;
eval(code);
