// Sweep brakeR to find the strongest forward brake-dip that doesn't endo.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const code =
  fs.readFileSync(path.join(root, 'js/levels.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'js/physics.js'), 'utf8') + '\n' + `
const dt = 1 / 480;
const flat = [{ ax: -100, ay: 8, bx: 200, by: 8 }];
for (const r of [1.2, 1.6, 2.0, 2.4]) {
  PHYS.brakeSkid = r;
  for (const v0 of [8, 14, 20]) {
    const b = new Bike(2.5, 7.25);
    for (let i = 0; i < 480 * 0.5; i++) b.step(dt, {}, flat);
    b.vel.x = v0;
    for (const w of b.wheels) { w.vel.x = v0; w.spin = v0 / PHYS.wheelR; }
    let maxFwd = 0;
    for (let i = 0; i < 480 * 1.5 && !b.dead; i++) {
      b.step(dt, { brake: true }, flat);
      maxFwd = Math.max(maxFwd, b.angle);
    }
    console.log('brakeSkid=' + r.toFixed(2) + ' v0=' + String(v0).padStart(2) +
      '  maxFwd=' + maxFwd.toFixed(3) + '  dead=' + b.dead);
  }
}
`;
eval(code);
