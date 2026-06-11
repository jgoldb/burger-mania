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
// simple rider: full gas, but counter-lean to keep the wheelie in check,
// the way a player modulates pitch — judged against the direction of
// travel, easing off through landings and at cruising speed (mirrors the
// drive_map rider, minus its burger logic)
let airT = 0, settle = 0;
for (let i = 0; i < 480 * 25; i++) {
  const grounded = b.wheels[0].onGround || b.wheels[1].onGround;
  const sp = Math.hypot(b.vel.x, b.vel.y);
  let travel = b.vel.x > 1 ? Math.atan2(b.vel.y, b.vel.x) : 0;
  travel = Math.max(-0.6, Math.min(0.2, travel));
  const pred = b.angle - travel + 0.3 * b.avel;
  if (!grounded) airT += dt;
  else { if (airT > 0.3) settle = 0.12; airT = 0; }
  if (settle > 0) settle -= dt;
  const input = {
    throttle: (pred > -0.45 || (sp < 3.5 && grounded && pred > -0.85)) &&
      settle <= 0 && sp < 9,
    right: pred < (grounded ? -0.6 : -1.45),
    left: pred > 1.15,
  };
  b.step(dt, input, level.segments);
  if (b.dead) { console.log('died t=' + (i * dt).toFixed(2) + ' x=' + b.pos.x.toFixed(2)); break; }
  if (reached === null && b.pos.x >= 90) reached = i * dt;
}
console.log('final x=' + b.pos.x.toFixed(2) + ' y=' + b.pos.y.toFixed(2) +
  ' reachedFlower=' + (reached === null ? 'no' : reached.toFixed(2) + 's') +
  ' dead=' + b.dead);
`;
eval(code);
