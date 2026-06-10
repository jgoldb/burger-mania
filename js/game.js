'use strict';

(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  const level = prepareLevel(LEVELS[0]);
  const patterns = makePatterns(ctx);
  const BEST_KEY = 'burger-mania-best-' + level.name;

  let state = 'title';
  let bike = null, time = 0, burgers = [], headBody = null;
  let best = parseFloat(localStorage.getItem(BEST_KEY) || '');
  if (!isFinite(best)) best = null;
  let cam = { x: level.start.x, y: level.start.y };
  let flipQueued = false;
  const keys = { up: false, down: false, left: false, right: false };

  function reset() {
    bike = new Bike(level.start.x, level.start.y);
    time = 0;
    burgers = level.burgers.map(b => ({ x: b[0], y: b[1], got: false }));
    headBody = null;
  }
  reset();

  // ---------- sound ----------
  let AC = null, engineSnd = null, muted = false;

  function ensureAudio() {
    if (AC) return;
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      const osc = AC.createOscillator();
      osc.type = 'sawtooth';
      const filt = AC.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 480;
      const gain = AC.createGain();
      gain.gain.value = 0;
      osc.connect(filt);
      filt.connect(gain);
      gain.connect(AC.destination);
      osc.start();
      engineSnd = { osc, gain };
    } catch (e) { /* no audio available */ }
  }

  function updateEngineSound() {
    if (!engineSnd) return;
    let g = 0, f = 40;
    if (!muted && state === 'playing') {
      const rear = bike.wheels[bike.rearIndex];
      f = 34 + Math.abs(rear.spin) * 1.25 + (keys.up ? 18 : 0);
      g = keys.up ? 0.085 : 0.045;
    }
    engineSnd.gain.gain.setTargetAtTime(g, AC.currentTime, 0.06);
    engineSnd.osc.frequency.setTargetAtTime(f, AC.currentTime, 0.05);
  }

  function blip(freq, dur) {
    if (!AC || muted) return;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.value = 0.10;
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
    o.connect(g);
    g.connect(AC.destination);
    o.start();
    o.stop(AC.currentTime + dur);
  }

  // ---------- input ----------
  window.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }
    ensureAudio();
    if (AC && AC.state === 'suspended') AC.resume();
    if (state === 'title' && e.key.toLowerCase() !== 'm') {
      reset();
      state = 'playing';
    }
    switch (e.key) {
      case 'ArrowUp': keys.up = true; break;
      case 'ArrowDown': keys.down = true; break;
      case 'ArrowLeft': keys.left = true; break;
      case 'ArrowRight': keys.right = true; break;
      case ' ': if (!e.repeat) flipQueued = true; break;
      case 'Enter':
      case 'Escape':
        reset();
        state = 'playing';
        break;
      case 'm':
      case 'M':
        muted = !muted;
        break;
    }
  });
  window.addEventListener('keyup', e => {
    switch (e.key) {
      case 'ArrowUp': keys.up = false; break;
      case 'ArrowDown': keys.down = false; break;
      case 'ArrowLeft': keys.left = false; break;
      case 'ArrowRight': keys.right = false; break;
    }
  });
  window.addEventListener('blur', () => {
    keys.up = keys.down = keys.left = keys.right = false;
  });

  // ---------- gameplay ----------
  function checkPickups() {
    const h = bike.headPos();
    const pts = [
      { p: bike.pos, r: 0.6 },
      { p: h, r: PHYS.headR },
      { p: bike.wheels[0].pos, r: PHYS.wheelR },
      { p: bike.wheels[1].pos, r: PHYS.wheelR },
    ];
    for (const b of burgers) {
      if (b.got) continue;
      for (const o of pts) {
        if (Math.hypot(o.p.x - b.x, o.p.y - b.y) < o.r + 0.45) {
          b.got = true;
          blip(740, 0.09);
          setTimeout(() => blip(1180, 0.12), 70);
          break;
        }
      }
    }
    if (burgers.every(b => b.got)) {
      for (const o of pts) {
        if (Math.hypot(o.p.x - level.goal[0], o.p.y - level.goal[1]) < o.r + 0.5) {
          finish();
          break;
        }
      }
    }
  }

  function finish() {
    state = 'finished';
    if (best === null || time < best) {
      best = time;
      localStorage.setItem(BEST_KEY, String(best));
    }
    blip(660, 0.12);
    setTimeout(() => blip(880, 0.12), 130);
    setTimeout(() => blip(1320, 0.22), 260);
  }

  function onDeath() {
    state = 'dead';
    const h = bike.headPos();
    headBody = {
      x: h.x, y: h.y,
      vx: bike.vel.x, vy: bike.vel.y - 1.5,
      rot: bike.angle, // tumbles as it rolls away
    };
    blip(95, 0.4);
  }

  // the detached helmet bounces around after a crash
  function stepHead(dt) {
    if (!headBody) return;
    headBody.vy += PHYS.g * dt;
    headBody.x += headBody.vx * dt;
    headBody.y += headBody.vy * dt;
    headBody.rot += (headBody.vx / PHYS.headR) * 0.5 * dt;
    for (const s of level.segments) {
      const cp = closestOnSeg(headBody.x, headBody.y, s);
      let nx = headBody.x - cp.x, ny = headBody.y - cp.y;
      const d = Math.hypot(nx, ny);
      if (d < PHYS.headR && d > 0) {
        nx /= d; ny /= d;
        headBody.x = cp.x + nx * PHYS.headR;
        headBody.y = cp.y + ny * PHYS.headR;
        const vn = headBody.vx * nx + headBody.vy * ny;
        if (vn < 0) {
          headBody.vx -= nx * vn * 1.5;
          headBody.vy -= ny * vn * 1.5;
          headBody.vx *= 0.95;
          headBody.vy *= 0.95;
        }
      }
    }
  }

  function updateCamera(dt) {
    const tx = bike.pos.x + bike.vel.x * 0.30;
    const ty = bike.pos.y + bike.vel.y * 0.12 - 0.6;
    const k = Math.min(1, 6 * dt);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
  }

  // ---------- main loop ----------
  const FDT = 1 / 60, SUB = 8;
  let last = performance.now(), acc = 0;

  function frame(now) {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= FDT) {
      acc -= FDT;
      if (state === 'playing') {
        if (flipQueued) bike.flip();
        const input = {
          throttle: keys.up, brake: keys.down,
          left: keys.left, right: keys.right,
        };
        for (let i = 0; i < SUB; i++) {
          bike.step(FDT / SUB, input, level.segments);
          if (bike.dead) break;
        }
        if (bike.dead) {
          onDeath();
        } else {
          time += FDT;
          checkPickups();
        }
      } else if (state === 'dead') {
        for (let i = 0; i < SUB; i++) stepHead(FDT / SUB);
      }
      flipQueued = false;
      updateCamera(FDT);
    }
    draw();
    updateEngineSound();
    requestAnimationFrame(frame);
  }

  function draw() {
    const Z = Math.min(W / 26, H / 13.5);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(Z, Z);
    ctx.translate(-cam.x, -cam.y);
    const hw = W / 2 / Z + 1, hh = H / 2 / Z + 1;
    drawWorld(ctx, level, patterns,
      { x0: cam.x - hw, y0: cam.y - hh, x1: cam.x + hw, y1: cam.y + hh });
    const rt = performance.now() / 1000;
    for (const b of burgers) if (!b.got) drawBurger(ctx, b.x, b.y, rt);
    drawPopcorn(ctx, level.goal[0], level.goal[1], rt);
    drawBike(ctx, bike, !!headBody);
    if (headBody) drawHead(ctx, headBody.x, headBody.y, bike.facing, headBody.rot);
    ctx.restore();

    drawHUD(ctx, W, H, {
      time,
      got: burgers.filter(b => b.got).length,
      total: burgers.length,
      best,
      state,
    });
  }

  requestAnimationFrame(frame);
})();
