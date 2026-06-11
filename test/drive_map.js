// Drives a bot across each level to sanity-check traversability.
// Usage: node test/drive_map.js [levelIndex]   (no index = all levels)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const arg = process.argv[2];
const lib =
  fs.readFileSync(path.join(root, 'js/levels.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'js/physics.js'), 'utf8');
const count = (() => {
  let n = 0;
  eval(lib + '\nn = LEVELS.length;');
  return n;
})();
const indices = arg === undefined
  ? Array.from({ length: count }, (_, i) => i)
  : [parseInt(arg, 10)];
let failed = false;
for (const idx of indices) {
  const code = '(function () {\n' + lib + '\n' + `
const level = prepareLevel(LEVELS[${idx}]);
const dt = 1 / 480;
let b = new Bike(level.start.x, level.start.y);
const burgers = level.burgers.map(p => ({ x: p[0], y: p[1], got: false }));
let reachedGoal = null;
// simple rider: full gas, but counter-lean to keep the wheelie in check,
// the way a player modulates pitch. Pitch is judged relative to the
// direction of travel (clamped, so steep falls don't read as slopes):
// on a steep climb the slope itself pitches the bike back, and that is
// not a wheelie. Below walking pace the throttle always stays on.
let airT = 0, settle = 0;
let lastX = -1e9, stuckT = 0, crawl = false;
for (let i = 0; i < 480 * 40; i++) {
  const sp = Math.hypot(b.vel.x, b.vel.y);
  let travel = b.vel.x > 1 ? Math.atan2(b.vel.y, b.vel.x) : 0;
  travel = Math.max(-0.6, Math.min(0.2, travel));
  // predicted pitch: lead with the pitch rate so crest kinks at full
  // throttle don't carry the bike over backward before the cut kicks in
  const pred = b.angle - travel + 0.3 * b.avel;
  // volts are big one-per-second thrusts now, so save them for real
  // trouble and let the throttle cut handle routine wheelie trim. The
  // low-speed throttle override only applies on the ground: gassing in
  // mid-air pitches the bike backward (engine reaction) with no volt
  // available to counter it until the cooldown runs out
  const grounded = b.wheels[0].onGround || b.wheels[1].onGround;
  // gassing through a hard landing snaps the bike into a wheelie (grip
  // spike plus spring rebound), so stay off the throttle for a beat
  // after touching down from real airtime, like a player rolling off
  // the gas to let the suspension settle
  if (!grounded) airT += dt;
  else { if (airT > 0.3) settle = 0.12; airT = 0; }
  if (settle > 0) settle -= dt;
  // the springy bike bounces off steep kinks instead of absorbing into
  // them: when progress stalls (bounced back off a wall), switch to a
  // slow crawl until it grinds over — wheel slip friction climbs grades
  // that a fast bounce never will
  if (b.pos.x > lastX + 0.5) { lastX = b.pos.x; stuckT = 0; crawl = false; }
  else stuckT += dt;
  if (stuckT > 3) crawl = true;
  // coast when an uncollected burger sits below the line just ahead, so a
  // fast approach doesn't sail clean over a dip pickup
  const dipAhead = burgers.some(bg => !bg.got &&
    bg.x - b.pos.x > 0 && bg.x - b.pos.x < 8 && bg.y - b.pos.y > 0.5);
  const input = {
    // the low-speed override never gasses past a deep wheelie: with volts
    // a second apart, engine reaction past the balance point is fatal.
    // The cruise cap reflects that a player doesn't hold flat-out into
    // terrain they can't see landing on
    throttle: (pred > -0.45 || (sp < 3.5 && grounded && pred > -0.85)) &&
      (!dipAhead || sp < 2.5) && settle <= 0 && sp < (crawl ? 2.5 : 9),
    // in the air only volt nose-down for severe pitch: rear-first landings
    // are safe, and a strong volt at mild pitch over-rotates into a
    // momentum-killing nose-dive
    right: pred < (grounded ? -0.6 : -1.45),
    // be reluctant to volt the nose up: suspension absorbs nose-down
    // landings, while an over-rotated nose-up landing is head-first
    left: pred > 1.15,
    // shed speed on the ground before a dip pickup, the way a player
    // brakes into a drop, so the arc falls onto the burger instead of
    // sailing past it
    brake: dipAhead && grounded && sp > 2.5,
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
  // the game ends the run here, so the bot should stop riding too
  if (reachedGoal !== null && burgers.every(g => g.got)) break;
}
const ok = reachedGoal !== null && burgers.every(g => g.got) && !b.dead;
console.log((ok ? 'PASS' : 'FAIL') + ' level "' + level.name + '"' +
  ' final x=' + b.pos.x.toFixed(2) + ' y=' + b.pos.y.toFixed(2) +
  ' burgers=' + burgers.filter(g => g.got).length + '/' + burgers.length +
  ' goal=' + (reachedGoal === null ? 'no' : reachedGoal.toFixed(2) + 's') +
  ' dead=' + b.dead);
if (!ok) failed = true;
` + '\n})();';
  eval(code);
}
process.exitCode = failed ? 1 : 0;
