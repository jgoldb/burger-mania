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

  const patterns = makePatterns(ctx);

  // loading -> intro -> menu -> difficulty -> ready -> playing ->
  // dead | finished (dead -> continue once lives run out), with paused
  // overlaying any in-game state
  let state = 'loading';
  let bike = null, time = 0, burgers = [], headBody = null;
  let currentTrack = null, levelIndex = 0;
  let lives = 3, continues = 3, checkpointIndex = 0;
  let level = prepareLevel(LEVELS[0]);
  let bestKey = 'burger-mania-best-' + level.name;
  let best = parseFloat(localStorage.getItem(bestKey) || '');
  if (!isFinite(best)) best = null;
  let cam = { x: level.start.x, y: level.start.y };
  const CAM_LEAD = 4.2; // how far the view centers ahead of the bike's facing
  let camLead = CAM_LEAD; // smoothed, so turning around pans rather than snaps
  let flipQueued = false;
  const keys = { up: false, down: false, left: false, right: false };

  // ---------- screens ----------
  let loadFrac = 0, loadDone = false;
  let introT = 0, menuT = 0, diffT = 0, contT = 0;
  let introLaunched = 0, introLanded = 0, fanfared = false;
  const menuItems = ['Play'];
  let menuSel = 0, diffSel = 0, contSel = 0;
  const pauseItems = ['Continue', 'Return to Menu'];
  let pauseSel = 0, pausedFrom = 'playing';
  let hoverIdx = -1;
  const mouse = { x: -1, y: -1 };

  loadAssets((done, total) => { loadFrac = total ? done / total : 1; })
    .then(() => { loadDone = true; });

  function reset() {
    bike = new Bike(level.start.x, level.start.y);
    time = 0;
    burgers = level.burgers.map(b => ({ x: b[0], y: b[1], got: false }));
    headBody = null;
    camLead = bike.facing * CAM_LEAD;
    cam.x = level.start.x + camLead;
    cam.y = level.start.y;
  }
  reset();

  // swaps in a raw level (from a track) along with its best-time record
  function loadLevel(raw) {
    level = prepareLevel(raw);
    bestKey = 'burger-mania-best-' + level.name;
    best = parseFloat(localStorage.getItem(bestKey) || '');
    if (!isFinite(best)) best = null;
    reset();
  }

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

  // filtered noise burst for the title letters whipping past
  function whoosh(dur, freq) {
    if (!AC || muted) return;
    const n = Math.floor(AC.sampleRate * dur);
    const buf = AC.createBuffer(1, n, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = AC.createBufferSource();
    src.buffer = buf;
    const f = AC.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.4;
    const g = AC.createGain();
    g.gain.value = 0.35;
    src.connect(f);
    f.connect(g);
    g.connect(AC.destination);
    src.start();
  }

  // fires whoosh / thud / fanfare cues as title letters launch and land
  function introSounds() {
    const launched = Math.max(0, Math.min(TITLE_ANIM.count,
      Math.floor((introT - TITLE_ANIM.delay) / TITLE_ANIM.stagger) + 1));
    while (introLaunched < launched) {
      whoosh(0.22, 500 + introLaunched * 90);
      introLaunched++;
    }
    const landed = Math.max(0, Math.min(TITLE_ANIM.count,
      Math.floor((introT - TITLE_ANIM.delay - TITLE_ANIM.fly) / TITLE_ANIM.stagger) + 1));
    while (introLanded < landed) {
      blip(220 + introLanded * 55, 0.10);
      introLanded++;
    }
    if (!fanfared && introLanded >= TITLE_ANIM.count) {
      fanfared = true;
      blip(660, 0.12);
      setTimeout(() => blip(880, 0.12), 130);
      setTimeout(() => blip(1320, 0.22), 260);
    }
  }

  // ---------- screen flow ----------
  function enterLevel(i) {
    levelIndex = i;
    loadLevel(currentTrack.levels[i]);
  }

  function startGame(track) {
    currentTrack = track;
    lives = 3;
    continues = 3;
    checkpointIndex = 0;
    enterLevel(0);
    state = 'ready';
  }

  function hasNextLevel() {
    return !!currentTrack && levelIndex + 1 < currentTrack.levels.length;
  }

  function mapLabel() {
    if (!currentTrack) return level.name;
    return `${currentTrack.label} ${levelIndex + 1}/${currentTrack.length} - ${level.name}`;
  }

  function goContinue() {
    state = 'continue';
    contT = 0;
    contSel = continues > 0 ? 0 : 1; // land on Back to Menu when tapped out
    hoverIdx = -1;
    blip(392, 0.14); // sad descending tones
    setTimeout(() => blip(311, 0.14), 170);
    setTimeout(() => blip(233, 0.30), 340);
  }

  function useContinue() {
    continues--;
    lives = 3;
    enterLevel(checkpointIndex);
    state = 'ready';
  }

  function goMenu() {
    state = 'menu';
    menuT = 0;
    menuSel = 0;
    hoverIdx = -1;
  }

  function goDifficulty() {
    state = 'difficulty';
    diffT = 0;
    diffSel = 0;
    hoverIdx = -1;
  }

  function openPause() {
    pausedFrom = state;
    state = 'paused';
    pauseSel = 0;
    keys.up = keys.down = keys.left = keys.right = false;
  }

  // dev cheat: typing "skip" jumps to the latest level in the track,
  // starting the first playable track if none is active
  const CHEAT_SKIP = 'skip';
  let cheatBuffer = '';
  function checkCheat(key) {
    if (key.length !== 1) return false;
    cheatBuffer = (cheatBuffer + key.toLowerCase()).slice(-CHEAT_SKIP.length);
    if (cheatBuffer !== CHEAT_SKIP) return false;
    cheatBuffer = '';
    const track = currentTrack || TRACKS.find(t => t.levels.length);
    if (!track) return false;
    if (!currentTrack) {
      currentTrack = track;
      lives = 3;
      continues = 3;
    }
    const target = track.levels.length - 1;
    // skipping counts as having beaten everything before the target, so a
    // continue restarts from the latest checkpoint map (every 5th) cleared
    // along the way, exactly as if the player had ridden there
    checkpointIndex = Math.max(0, Math.floor(target / 5) * 5 - 1);
    enterLevel(target);
    state = 'ready';
    blip(1320, 0.15);
    return true;
  }

  function skipIntro() {
    introT = TITLE_ANIM.dur;
    introLaunched = introLanded = TITLE_ANIM.count;
    fanfared = true;
    goMenu();
  }

  function activateMenu(i) {
    if (menuItems[i] === 'Play') {
      blip(880, 0.08);
      goDifficulty();
    }
  }

  function activateDifficulty(i) {
    const track = TRACKS[i];
    if (!track.levels.length) {
      blip(180, 0.12); // not available yet
      return;
    }
    blip(880, 0.08);
    startGame(track);
  }

  function activateContinue(i) {
    if (i === 0) {
      if (continues <= 0) {
        blip(180, 0.12);
        return;
      }
      blip(880, 0.08);
      useContinue();
    } else {
      goMenu();
    }
  }

  function activatePause(i) {
    if (pauseItems[i] === 'Continue') state = pausedFrom;
    else goMenu();
  }

  // ---------- input ----------
  function currentRects() {
    if (state === 'menu' && menuT > 0.15) {
      return menuRects(W, H, menuItems.length, H * 0.58);
    }
    if (state === 'difficulty' && diffT > 0.15) {
      return menuRects(W, H, TRACKS.length, H * 0.34);
    }
    if (state === 'continue' && contT > 0.15) {
      return menuRects(W, H, 2, H * 0.62);
    }
    if (state === 'paused') {
      return menuRects(W, H, pauseItems.length, H * 0.46);
    }
    return null;
  }

  function updateHover() {
    const rects = currentRects();
    hoverIdx = -1;
    if (rects) {
      rects.forEach((r, i) => {
        if (mouse.x >= r.x && mouse.x <= r.x + r.w &&
            mouse.y >= r.y && mouse.y <= r.y + r.h) hoverIdx = i;
      });
    }
    canvas.style.cursor = hoverIdx >= 0 ? 'pointer' : 'default';
  }

  window.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }
    ensureAudio();
    if (AC && AC.state === 'suspended') AC.resume();
    if (e.key === 'm' || e.key === 'M') {
      muted = !muted;
      return;
    }
    if (state !== 'loading' && checkCheat(e.key)) return;

    switch (state) {
      case 'loading':
        if (loadDone) { state = 'intro'; introT = 0; }
        return;
      case 'intro':
        skipIntro();
        return;
      case 'menu':
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const d = e.key === 'ArrowUp' ? -1 : 1;
          menuSel = (menuSel + d + menuItems.length) % menuItems.length;
          blip(520, 0.05);
        } else if (e.key === 'Enter' || e.key === ' ') {
          activateMenu(menuSel);
        }
        return;
      case 'difficulty':
        if (e.key === 'Escape') { goMenu(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const d = e.key === 'ArrowUp' ? -1 : 1;
          diffSel = (diffSel + d + TRACKS.length) % TRACKS.length;
          blip(520, 0.05);
        } else if (e.key === 'Enter' || e.key === ' ') {
          activateDifficulty(diffSel);
        }
        return;
      case 'paused':
        if (e.key === 'Escape') { state = pausedFrom; return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const d = e.key === 'ArrowUp' ? -1 : 1;
          pauseSel = (pauseSel + d + pauseItems.length) % pauseItems.length;
          blip(520, 0.05);
        } else if (e.key === 'Enter' || e.key === ' ') {
          blip(880, 0.08);
          activatePause(pauseSel);
        }
        return;
      case 'finished':
        if (e.key === 'Enter') {
          if (hasNextLevel()) {
            enterLevel(levelIndex + 1);
            state = 'ready';
          } else {
            goMenu(); // track complete (as far as it exists, anyway)
          }
        } else if (e.key === 'Escape') openPause();
        return;
      case 'dead':
        if (e.key === 'Enter') {
          if (lives > 0) { reset(); state = 'playing'; }
          else goContinue();
        } else if (e.key === 'Escape') openPause();
        return;
      case 'continue':
        if (e.key === 'Escape') { goMenu(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          if (continues > 0) {
            contSel = 1 - contSel;
            blip(520, 0.05);
          }
        } else if (e.key === 'Enter' || e.key === ' ') {
          activateContinue(contSel);
        }
        return;
      case 'ready':
        if (e.key === 'Escape') { goMenu(); return; }
        state = 'playing'; // any other key starts riding, and still applies below
        break;
      case 'playing':
        if (e.key === 'Escape') { openPause(); return; }
        if (e.key === 'Enter') { reset(); return; }
        break;
    }

    switch (e.key) {
      case 'ArrowUp': keys.up = true; break;
      case 'ArrowDown': keys.down = true; break;
      case 'ArrowLeft': keys.left = true; break;
      case 'ArrowRight': keys.right = true; break;
      case ' ': if (!e.repeat) flipQueued = true; break;
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
    if (state === 'playing') openPause();
  });

  canvas.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    updateHover();
  });
  canvas.addEventListener('click', e => {
    ensureAudio();
    if (AC && AC.state === 'suspended') AC.resume();
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    updateHover();
    if (state === 'loading') {
      if (loadDone) { state = 'intro'; introT = 0; }
      return;
    }
    if (state === 'intro') { skipIntro(); return; }
    if (hoverIdx < 0) return;
    if (state === 'menu') {
      menuSel = hoverIdx;
      activateMenu(hoverIdx);
    } else if (state === 'difficulty') {
      diffSel = hoverIdx;
      activateDifficulty(hoverIdx);
    } else if (state === 'continue') {
      contSel = hoverIdx;
      activateContinue(hoverIdx);
    } else if (state === 'paused') {
      pauseSel = hoverIdx;
      activatePause(hoverIdx);
    }
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
    // completing every 5th map of a track (1-5, 1-10, ...) makes it the
    // checkpoint: a continue used later restarts from that map
    if (currentTrack && (levelIndex + 1) % 5 === 0) checkpointIndex = levelIndex;
    if (best === null || time < best) {
      best = time;
      localStorage.setItem(bestKey, String(best));
    }
    blip(660, 0.12);
    setTimeout(() => blip(880, 0.12), 130);
    setTimeout(() => blip(1320, 0.22), 260);
  }

  function onDeath() {
    state = 'dead';
    lives = Math.max(0, lives - 1);
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
    // ease the look-ahead toward the current facing so a flip pans the
    // view across rather than snapping it
    camLead += (bike.facing * CAM_LEAD - camLead) * Math.min(1, 3 * dt);
    const tx = bike.pos.x + camLead + bike.vel.x * 0.12;
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
      if (state === 'intro') {
        introT += FDT;
        introSounds();
        if (introT >= TITLE_ANIM.dur) { state = 'menu'; menuT = 0; }
      } else if (state === 'menu') {
        introT += FDT; // keeps the settled title bobbing
        menuT += FDT;
      } else if (state === 'difficulty') {
        diffT += FDT;
      } else if (state === 'continue') {
        contT += FDT;
      } else if (state === 'playing') {
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
      if (state !== 'loading' && state !== 'intro' && state !== 'menu' &&
          state !== 'difficulty' && state !== 'continue') {
        updateCamera(FDT);
      }
    }
    updateHover();
    draw();
    updateEngineSound();
    requestAnimationFrame(frame);
  }

  function draw() {
    const rt = performance.now() / 1000;
    if (state === 'loading') {
      drawLoading(ctx, W, H, loadFrac, rt, loadDone);
      return;
    }
    if (state === 'intro' || state === 'menu') {
      drawMenuBackdrop(ctx, W, H, rt, patterns.meadow);
      drawTitleLetters(ctx, W, H, introT);
      if (state === 'menu') {
        drawMenu(ctx, W, H, Math.min(1, menuT / 0.6), menuItems, menuSel, hoverIdx);
      }
      return;
    }
    if (state === 'difficulty') {
      drawMenuBackdrop(ctx, W, H, rt, patterns.meadow);
      drawDifficulty(ctx, W, H, Math.min(1, diffT / 0.4), TRACKS, diffSel, hoverIdx);
      return;
    }
    if (state === 'continue') {
      drawMenuBackdrop(ctx, W, H, rt, patterns.meadow);
      drawContinue(ctx, W, H, Math.min(1, contT / 0.4), rt, continues, contSel, hoverIdx);
      return;
    }

    const theme = patterns[level.theme] || patterns.meadow;
    const Z = Math.min(W / 26, H / 13.5);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(Z, Z);
    ctx.translate(-cam.x, -cam.y);
    const hw = W / 2 / Z + 1, hh = H / 2 / Z + 1;
    drawWorld(ctx, level, theme,
      { x0: cam.x - hw, y0: cam.y - hh, x1: cam.x + hw, y1: cam.y + hh });
    for (const b of burgers) if (!b.got) drawBurger(ctx, b.x, b.y, rt);
    drawPopcorn(ctx, level.goal[0], level.goal[1], rt);
    drawBike(ctx, bike, !!headBody);
    if (headBody) drawHead(ctx, headBody.x, headBody.y, bike.facing, headBody.rot);
    ctx.restore();

    drawMinimap(ctx, W, H, level, {
      pos: bike.pos,
      burgers,
      goal: level.goal,
      t: rt,
      theme,
    });

    drawHUD(ctx, W, H, {
      time,
      got: burgers.filter(b => b.got).length,
      total: burgers.length,
      best,
      state,
      lives,
      hasNext: hasNextLevel(),
      mapLabel: mapLabel(),
    });

    if (state === 'paused') {
      drawPause(ctx, W, H, pauseItems, pauseSel, hoverIdx);
    }
  }

  requestAnimationFrame(frame);
})();
