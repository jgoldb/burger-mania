// Hold full throttle on a long flat and chart the wheelie progression.
// Desired: pitch builds gradually, front lifts, and the bike eventually
// tips all the way over if the rider never compensates.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const code =
  fs.readFileSync(path.join(root, 'js/levels.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'js/physics.js'), 'utf8') + '\n' + `
const dt = 1 / 480;
const flat = [{ ax: -100, ay: 8, bx: 600, by: 8 }];
for (const er of [6.5, 7.0, 7.5, 8.0, 9.0]) {
  PHYS.engineR = er;
  const b = new Bike(2.5, 7.25);
  for (let i = 0; i < 480 * 0.5; i++) b.step(dt, {}, flat); // settle
  let flipAt = null;
  const marks = [];
  for (let i = 0; i < 480 * 12; i++) {
    b.step(dt, { throttle: true }, flat);
    if (i % 480 === 479) marks.push(b.angle.toFixed(2));
    if (b.dead) { flipAt = i * dt; break; }
  }
  console.log('engineR=' + er.toFixed(1) +
    '  angle@1s..=' + marks.join(',').padEnd(38) +
    (flipAt === null ? '  no tip in 12s' : '  tipped at ' + flipAt.toFixed(2) + 's'));
}
`;
eval(code);
