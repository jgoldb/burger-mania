'use strict';

(function () {
  // One-time records reset, tied to the sim version. Best times and style
  // scores are only comparable within one physics build, so whenever the sim
  // changes (REPLAY.VERSION bumps on any physics/step/input change) we drop the
  // saved records once and stamp the new version. Reloads on the same version
  // see a matching stamp and leave storage untouched — no manual bump needed.
  // Only the best-/style- record keys are cleared; volume prefs, saved editor
  // maps, and the editor autosave are deliberately left intact.
  const SIM_VER_KEY = 'burger-mania-sim-version';
  try {
    const cur = String(REPLAY.VERSION);
    if (localStorage.getItem(SIM_VER_KEY) !== cur) {
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.indexOf('burger-mania-best-') === 0 ||
                  k.indexOf('burger-mania-style-') === 0)) drop.push(k);
      }
      drop.forEach(k => localStorage.removeItem(k));
      localStorage.setItem(SIM_VER_KEY, cur); // stamp so reloads on this version are untouched
    }
  } catch (e) { /* storage blocked or stubbed (headless tests) — nothing to reset */ }

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;

  // A hidden probe whose padding is set to the safe-area insets lets us read
  // the notch/home-indicator sizes in px (env() can't be read off a custom
  // property reliably, but resolves fine as resolved padding).
  let safeProbe = null;
  function measureInsets() {
    let s = { top: 0, right: 0, bottom: 0, left: 0 };
    try {
      if (!safeProbe && document.body) {
        safeProbe = document.createElement('div');
        safeProbe.style.cssText =
          'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;' +
          'pointer-events:none;' +
          'padding-top:env(safe-area-inset-top);' +
          'padding-right:env(safe-area-inset-right);' +
          'padding-bottom:env(safe-area-inset-bottom);' +
          'padding-left:env(safe-area-inset-left);';
        document.body.appendChild(safeProbe);
      }
      if (safeProbe && typeof getComputedStyle === 'function') {
        const cs = getComputedStyle(safeProbe);
        s = { top: parseFloat(cs.paddingTop) || 0,
              right: parseFloat(cs.paddingRight) || 0,
              bottom: parseFloat(cs.paddingBottom) || 0,
              left: parseFloat(cs.paddingLeft) || 0 };
      }
    } catch (e) { /* stub DOM (headless harnesses) — leave insets at zero */ }
    if (typeof setSafeInsets === 'function') setSafeInsets(s);
  }

  // Size the backing store to the canvas's own laid-out box (it's pinned
  // position:fixed inset:0, so that's the full visual viewport). Measuring the
  // element rather than window.innerWidth/Height keeps the canvas filling the
  // screen and keeps clientX/Y touch coords mapping 1:1 to canvas pixels.
  function resize() {
    const vv = window.visualViewport;
    W = canvas.width = canvas.clientWidth ||
      Math.round((vv && vv.width) || window.innerWidth);
    H = canvas.height = canvas.clientHeight ||
      Math.round((vv && vv.height) || window.innerHeight);
    measureInsets();
  }
  window.addEventListener('resize', resize);
  // iOS often reports stale dimensions during a rotation, so re-measure once
  // the new orientation has settled
  window.addEventListener('orientationchange', () => { resize(); setTimeout(resize, 300); });
  if (window.visualViewport && window.visualViewport.addEventListener) {
    window.visualViewport.addEventListener('resize', resize);
  }
  resize();

  const patterns = makePatterns(ctx);

  // loading -> intro -> menu -> difficulty -> ready -> playing ->
  // dead | finished (dead -> continue once lives run out), with paused
  // overlaying any in-game state. Finishing a track's LAST map goes to
  // victoryFade instead of finished: a slow dissolve into the victory
  // feast ('victory'), which routes back to the menu
  let state = 'loading';
  let bike = null, time = 0, burgers = [], headBody = null;
  let currentTrack = null, levelIndex = 0;
  const MAX_CONTINUES = 2;
  let lives = 3, continues = MAX_CONTINUES, checkpointIndex = 0;
  // this campaign's outcome per map ({ time, style, record flags } by map
  // index) — the victory scorecard; sparse where the skip cheat jumped past
  let runResults = [];
  let currentRaw = LEVELS[0]; // unprepared level data (what a saved replay embeds)
  let level = prepareLevel(LEVELS[0]);
  let bestKey = 'burger-mania-best-' + level.name;
  let best = parseFloat(localStorage.getItem(bestKey) || '');
  if (!isFinite(best)) best = null;
  // style points: airborne tricks pay out on the spot; a finished run
  // banks the per-level best, a second record to chase alongside time
  let styleKey = 'burger-mania-style-' + level.name;
  let styleBest = parseInt(localStorage.getItem(styleKey) || '', 10);
  if (!isFinite(styleBest)) styleBest = null;
  let stylePts = 0;     // this run's total
  let spinAcc = 0;      // net rotation accumulated toward the next full lap
  let wheelieT = 0;     // seconds the current unbroken wheelie has been held
  let stoppieT = 0;     // same, for an unbroken stoppie (front down, rear up)
  let stylePopups = []; // floating "+N" toasts riding above the biker
  let popupSeq = 0;     // cycles spawn lanes so stacked toasts stay legible
  let cam = { x: level.start.x, y: level.start.y };
  const CAM_LEAD = 4.2; // how far the view centers ahead of the bike's facing
  let camLead = CAM_LEAD; // smoothed, so turning around pans rather than snaps
  // wheel-touchdown sound: drop speed (m/s) below which a landing is silent,
  // and the span above it over which the thud ramps to full volume
  const WHEEL_HIT_MIN = 1.3, WHEEL_HIT_SPAN = 5.0;
  // suspension "crank": how hard the springs are working — each grounded wheel's
  // spring deflection away from its resting sag (SUSP_REST) plus how fast that
  // spring is moving, weighted and summed. SUSP_FULL is the load that drives the
  // crank to full drama; the per-sim-frame peak is held in suspLevel and bled off
  // by SUSP_RELEASE each frame, so a slam cranks loud and rings down while a
  // sustained press (climbing a ramp) holds the sound up
  const SUSP_REST = PHYS.frameM * PHYS.g / 2 / PHYS.springK; // static sag
  const SUSP_DEV_W = 1.0, SUSP_VEL_W = 0.12, SUSP_FULL = 1.0, SUSP_RELEASE = 0.88;
  let suspLevel = 0; // smoothed suspension drama, ~0..SUSP_FULL
  let flipQueued = false;
  const keys = { up: false, down: false, left: false, right: false };
  // the input the sim consumed this frame (from keys, or from a replay
  // tape during playback) — the engine sound follows it either way
  let simInput = { throttle: false, brake: false, left: false, right: false };

  // ---------- screens ----------
  let loadFrac = 0, loadDone = false;
  // performance-clock seconds at which the player dismissed the loading
  // overlay. The whole menu world (clouds, drifting burgers, the rising
  // astronaut) is clocked from here rather than from page load, so nothing
  // animates until the player taps in — and the astro gag stays parked for a
  // good while after that. -1 means "still on the loading overlay".
  let menuClock0 = -1;
  let introT = 0, menuT = 0, diffT = 0, contT = 0;
  let introLaunched = 0, introLanded = 0, fanfared = false;
  const menuItems = ['Play', 'Map Editor', 'Replays', 'Records', 'Audio'];
  let menuSel = 0, diffSel = 0, contSel = 0;
  const pauseItems = ['Continue', 'Audio', 'Return to Menu'];
  let pauseSel = 0, pausedFrom = 'playing';
  let hoverIdx = -1;
  const mouse = { x: -1, y: -1 };

  loadAssets((done, total) => { loadFrac = total ? done / total : 1; })
    .then(() => { loadDone = true; });

  function reset() {
    bike = new Bike(level.start.x, level.start.y);
    time = 0;
    // normal burgers plus the upside-down ones (identical to the rider, but
    // collecting one flips gravity). Both count toward the burger total and
    // collect alike, so they share the runtime list; only the `flip` flag and
    // the gravity it toggles tell them apart
    burgers = level.burgers.map(b => ({ x: b[0], y: b[1], got: false, flip: false }));
    if (level.flipBurgers) {
      for (const b of level.flipBurgers) burgers.push({ x: b[0], y: b[1], got: false, flip: true });
    }
    headBody = null;
    suspLevel = 0; // silence any crank still ringing from the last life at once
    stylePts = 0;
    spinAcc = 0;
    wheelieT = 0;
    stoppieT = 0;
    stylePopups = [];
    popupSeq = 0;
    camLead = bike.facing * CAM_LEAD;
    cam.x = level.start.x + camLead;
    cam.y = level.start.y;
    // every run gets a fresh tape (watching a replay isn't a run)
    if (state !== 'replay' && state !== 'replayEnd') REPLAY.begin();
  }
  reset();

  // swaps in a raw level (from a track) along with its best-time record
  function loadLevel(raw) {
    currentRaw = raw;
    level = prepareLevel(raw);
    bestKey = 'burger-mania-best-' + level.name;
    best = parseFloat(localStorage.getItem(bestKey) || '');
    if (!isFinite(best)) best = null;
    styleKey = 'burger-mania-style-' + level.name;
    styleBest = parseInt(localStorage.getItem(styleKey) || '', 10);
    if (!isFinite(styleBest)) styleBest = null;
    reset();
  }

  // ---------- sound ----------
  // the engine drone and one-shot effects feed sfxGain, the soundtrack
  // feeds musicGain, and both meet in masterGain — the three sliders on
  // the audio settings screen
  let AC = null, engineSnd = null, suspSnd = null, muted = false;
  let masterGain = null, musicGain = null, sfxGain = null;

  const VOLUME_KEY = 'burger-mania-volume';
  const volume = { master: 1, music: 1, sfx: 1 };
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY)) || {};
    for (const k of Object.keys(volume)) {
      if (isFinite(saved[k])) volume[k] = Math.min(1, Math.max(0, Number(saved[k])));
    }
  } catch (e) { /* unreadable save: ride at full volume */ }

  // sliders are stored 0..1 and squared into gain so they track
  // perceived loudness rather than raw amplitude
  function applyVolume() {
    if (!AC) return;
    masterGain.gain.setTargetAtTime(volume.master * volume.master, AC.currentTime, 0.03);
    musicGain.gain.setTargetAtTime(volume.music * volume.music, AC.currentTime, 0.03);
    sfxGain.gain.setTargetAtTime(volume.sfx * volume.sfx, AC.currentTime, 0.03);
  }

  function setVolume(key, v) {
    volume[key] = Math.min(1, Math.max(0, v));
    applyVolume();
    localStorage.setItem(VOLUME_KEY, JSON.stringify(volume));
  }

  function ensureAudio() {
    if (AC) return;
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = AC.createGain();
      masterGain.gain.value = volume.master * volume.master;
      masterGain.connect(AC.destination);
      musicGain = AC.createGain();
      musicGain.gain.value = volume.music * volume.music;
      musicGain.connect(masterGain);
      sfxGain = AC.createGain();
      sfxGain.gain.value = volume.sfx * volume.sfx;
      sfxGain.connect(masterGain);
      const osc = AC.createOscillator();
      osc.type = 'sawtooth';
      const filt = AC.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 480;
      const gain = AC.createGain();
      gain.gain.value = 0;
      osc.connect(filt);
      filt.connect(gain);
      gain.connect(sfxGain);
      osc.start();
      engineSnd = { osc, gain };
      // the suspension "crank": a heavy mechanical spring wound under load.
      // A sawtooth rung through a resonant BANDPASS (a metallic formant, not a
      // soft tone), then bitten by a square-wave tremolo so it ratchets like a
      // crank turning. Always on, gated to silence until the springs work; the
      // pitch, brightness and ratchet rate all climb as they load harder
      const sOsc = AC.createOscillator();
      sOsc.type = 'sawtooth';
      sOsc.frequency.value = 40;
      const sFilt = AC.createBiquadFilter();
      sFilt.type = 'bandpass';
      sFilt.frequency.value = 150;
      sFilt.Q.value = 2.6;
      // tremolo: a square LFO chops the signal between 0.38 and 0.98 so the
      // tone reads as a turning ratchet rather than a steady drone
      const sTrem = AC.createGain();
      sTrem.gain.value = 0.68;
      const sLfo = AC.createOscillator();
      sLfo.type = 'square';
      sLfo.frequency.value = 9;
      const sLfoDepth = AC.createGain();
      sLfoDepth.gain.value = 0.30;
      sLfo.connect(sLfoDepth);
      sLfoDepth.connect(sTrem.gain);
      const sGain = AC.createGain();
      sGain.gain.value = 0;
      sOsc.connect(sFilt);
      sFilt.connect(sTrem);
      sTrem.connect(sGain);
      sGain.connect(sfxGain);
      sOsc.start();
      sLfo.start();
      suspSnd = { osc: sOsc, gain: sGain, filt: sFilt, lfo: sLfo };
      MUSIC.init(AC, musicGain);
    } catch (e) { /* no audio available */ }
  }

  // best-effort: ask the browser to keep a phone in landscape (the world,
  // menus, and HUD are all built for a wide view). Works on Android Chrome,
  // usually only in fullscreen / an installed PWA; iOS Safari has no such
  // API, so the CSS "rotate your device" overlay in index.html is the real
  // guarantee. Guarded so an unsupported or rejected call never throws.
  let triedLock = false;
  function lockLandscape() {
    if (triedLock) return;
    triedLock = true;
    try {
      const o = window.screen && window.screen.orientation;
      if (o && o.lock) {
        const r = o.lock('landscape');
        if (r && r.catch) r.catch(() => {});
      }
    } catch (e) { /* orientation lock unsupported */ }
  }

  // picks the soundtrack for the current screen: the menu and difficulty
  // screens share the title theme, the continue screen mourns on its own,
  // and every in-game state plays the current world's song (a name MUSIC
  // doesn't know, like the silent loading/intro screens' null, fades out)
  function updateMusic() {
    let want = null;
    if (state === 'menu' || state === 'difficulty' || state === 'replays' ||
        state === 'recordsDiff' || state === 'records') want = 'menu';
    else if (state === 'continue') want = 'continue';
    // the picker keeps the summoning screen's song: the frozen world's
    // theme mid-game, the menu theme otherwise
    else if (state === 'skip') want = skipOverGame() ? level.theme : 'menu';
    else if (state === 'audio') {
      // keep whatever was playing, full volume even over a pause, so the
      // music slider is tuned against the level it'll actually play at
      want = audioFrom === 'paused' ? level.theme : 'menu';
    }
    // the editor plays the song of the theme being edited, so picking a
    // theme auditions its whole world
    else if (state === 'editor') want = EDITOR.themeName;
    // the win sequence: the world's song dips to silence under the long
    // dissolve, then the victory tune blooms in with the feast
    else if (state === 'victoryFade') want = victoryAlpha() < 0.5 ? null : 'victory';
    else if (state === 'victory') want = 'victory';
    else if (state === 'ready' || state === 'playing' || state === 'dead' ||
             state === 'finished' || state === 'paused' ||
             state === 'replay' || state === 'replayEnd' ||
             state === 'editorTest' || state === 'editorTestEnd') {
      want = level.theme;
    }
    MUSIC.play(want);
    MUSIC.duck(state === 'paused');
  }

  function updateEngineSound() {
    if (!engineSnd) return;
    let g = 0, f = 40;
    if (!muted && (state === 'playing' || state === 'replay' ||
                   state === 'editorTest')) {
      const rear = bike.wheels[bike.rearIndex];
      f = 34 + Math.abs(rear.spin) * 1.25 + (simInput.throttle ? 18 : 0);
      g = simInput.throttle ? 0.085 : 0.045;
    }
    engineSnd.gain.gain.setTargetAtTime(g, AC.currentTime, 0.06);
    engineSnd.osc.frequency.setTargetAtTime(f, AC.currentTime, 0.05);
  }

  // how hard the suspension is working this instant: summed over the wheels in
  // contact (ground OR wall — wheelContacts flags both), each wheel's spring
  // deflection away from its resting sag plus how fast that spring is moving.
  // Airborne wheels contribute nothing, so the crank is a CONTACT sound — it
  // answers landings, wall bangs, hard wheelie drops and a body pressed into a
  // ramp, and stays silent in clean air and at rest. Called every substep so a
  // brief peak compression isn't missed
  function suspLoad() {
    const c = Math.cos(bike.angle), s = Math.sin(bike.angle);
    let load = 0;
    for (let i = 0; i < 2; i++) {
      const w = bike.wheels[i];
      if (!w.onGround) continue;
      const lx = (i === 0 ? -1 : 1) * PHYS.anchorX, ly = PHYS.anchorY;
      const ax = bike.pos.x + lx * c - ly * s;
      const ay = bike.pos.y + lx * s + ly * c;
      let ux = w.pos.x - ax, uy = w.pos.y - ay;
      const d = Math.hypot(ux, uy);
      const dev = Math.abs(d - SUSP_REST); // spring stretch away from rest sag
      if (d > 1e-6) { ux /= d; uy /= d; }
      // wheel velocity relative to its anchor, along the spring axis = how fast
      // the spring is compressing/extending
      const rx = ax - bike.pos.x, ry = ay - bike.pos.y;
      const avx = bike.vel.x - bike.avel * ry, avy = bike.vel.y + bike.avel * rx;
      const vN = Math.abs((w.vel.x - avx) * ux + (w.vel.y - avy) * uy);
      load += SUSP_DEV_W * dev + SUSP_VEL_W * vN;
    }
    return load;
  }

  function updateSuspensionSound() {
    if (!suspSnd) return;
    let g = 0, f = 40, cut = 150, rate = 9;
    // also voices through the crash/finish aftermath so a hard hit that kills
    // the rider rings the crank out naturally instead of cutting dead; reset()
    // zeroes suspLevel so a respawn silences it at once
    if (!muted && (state === 'playing' || state === 'replay' ||
                   state === 'editorTest' || state === 'dead' ||
                   state === 'replayEnd' || state === 'editorTestEnd' ||
                   state === 'finished')) {
      const L = Math.min(1, suspLevel / SUSP_FULL); // 0..1 drama
      g = 0.40 * L;          // bandpass is thinner than a lowpass — push it
      f = 40 + L * 60;       // the heavy spring winds up in pitch as it loads
      cut = 150 + L * 650;   // brighter, harsher metallic ring on a hard hit
      rate = 9 + L * 17;     // and the crank ratchets faster the harder it works
    }
    suspSnd.gain.gain.setTargetAtTime(g, AC.currentTime, 0.02);
    suspSnd.osc.frequency.setTargetAtTime(f, AC.currentTime, 0.02);
    suspSnd.filt.frequency.setTargetAtTime(cut, AC.currentTime, 0.02);
    suspSnd.lfo.frequency.setTargetAtTime(rate, AC.currentTime, 0.05);
  }

  function blip(freq, dur) {
    if (!AC || muted) return;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.value = 0.10;
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
    o.connect(g);
    g.connect(sfxGain);
    o.start();
    o.stop(AC.currentTime + dur);
  }

  // filtered noise burst for the title letters whipping past and the
  // bike whipping around
  function whoosh(dur, freq, gain = 0.35) {
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
    g.gain.value = gain;
    src.connect(f);
    f.connect(g);
    g.connect(sfxGain);
    src.start();
  }

  // a swooping tone for a gravity flip (an upside-down burger): the pitch
  // glides toward the new "down", so an up-flip swoops up and a down-flip
  // swoops down — an audible cue for an otherwise invisible event
  function gravWhoomp(up) {
    if (!AC || muted) return;
    const t0 = AC.currentTime;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(up ? 300 : 760, t0);
    o.frequency.exponentialRampToValueAtTime(up ? 880 : 200, t0 + 0.32);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.36);
    o.connect(g);
    g.connect(sfxGain);
    o.start(t0);
    o.stop(t0 + 0.38);
    whoosh(0.18, up ? 900 : 360, 0.25);
  }

  // the rider's volt: a meaty low "thwup" — the weight-throw that whips the
  // bike around — with a puff of air over it. Punchy but short, so it reads on
  // every volt without the ~2-per-second cadence of held volts turning to mush
  function voltThump() {
    if (!AC || muted) return;
    const t0 = AC.currentTime;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(240, t0);
    o.frequency.exponentialRampToValueAtTime(85, t0 + 0.11);
    g.gain.setValueAtTime(0.0001, t0); // exponential ramps can't leave 0
    g.gain.exponentialRampToValueAtTime(0.20, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    o.connect(g);
    g.connect(sfxGain);
    o.start(t0);
    o.stop(t0 + 0.17);
    whoosh(0.09, 520, 0.22);
  }

  // a wheel touching down: a short earthy thud — a low body thump plus a click
  // of tire-on-ground grit. `power` (0..1) is how hard the wheel was dropping
  // in, so a gentle plant ticks softly and a big slam lands with a real thud
  function wheelHit(power) {
    if (!AC || muted) return;
    const t0 = AC.currentTime;
    const vol = 0.12 + 0.32 * power; // punchy, scales hard with impact speed
    // low thump body
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(190, t0);
    o.frequency.exponentialRampToValueAtTime(50, t0 + 0.10);
    g.gain.setValueAtTime(0.0001, t0); // exponential ramps can't leave 0
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.17);
    o.connect(g);
    g.connect(sfxGain);
    o.start(t0);
    o.stop(t0 + 0.18);
    // a slap of tire-on-ground grit over the thump, much louder on a slam
    whoosh(0.06, 300, 0.14 + 0.30 * power);
  }

  // quick rising arpeggio when style points land, each note sliding up a
  // little as it rings; a big award (full rotation) gets an extra top note
  // so it reads flashier than a turn-around
  function styleSparkle(big) {
    if (!AC || muted) return;
    const notes = big ? [740, 988, 1480, 1976] : [740, 988, 1480];
    notes.forEach((freq, i) => {
      const t0 = AC.currentTime + i * 0.05;
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(freq, t0);
      o.frequency.exponentialRampToValueAtTime(freq * 1.3, t0 + 0.16);
      g.gain.setValueAtTime(0.0001, t0); // exponential ramps can't leave 0
      g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.025);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
      o.connect(g);
      g.connect(sfxGain);
      o.start(t0);
      o.stop(t0 + 0.24);
    });
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
    continues = MAX_CONTINUES;
    checkpointIndex = 0;
    runResults = [];
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

  // ---------- best records ----------
  // 'recordsDiff' picks a track (the same disabled-when-empty selector Play
  // uses); 'records' then shows that track's all-time best time and style per
  // map in the victory-style scorecard. Both read straight from the per-map
  // best-time / best-style localStorage keys, so nothing new is persisted.
  let recDiffSel = 0, recDiffT = 0, recT = 0;
  let recTrack = null, recNames = [], recResults = [];

  function goRecordsDiff() {
    state = 'recordsDiff';
    recDiffT = 0;
    // land on the first track that actually has maps (Beginner, today)
    recDiffSel = Math.max(0, TRACKS.findIndex(t => t.levels.length));
    hoverIdx = -1;
  }

  function activateRecordsDiff(i) {
    const track = TRACKS[i];
    if (!track.levels.length) {
      blip(180, 0.12); // no maps yet, so no records to show
      return;
    }
    blip(880, 0.08);
    showRecords(track);
  }

  // gather a track's stored bests into the scorecard's results shape. A map
  // with no banked time was never cleared (shown as dashes); a cleared map
  // that never scored style reads as 0. No record flags — every figure here
  // already is the all-time best, so the scorecard draws them unstarred.
  function showRecords(track) {
    recTrack = track;
    recNames = track.levels.map(l => l.name);
    recResults = track.levels.map(raw => {
      const t = parseFloat(localStorage.getItem('burger-mania-best-' + raw.name) || '');
      if (!isFinite(t)) return null;
      const s = parseInt(localStorage.getItem('burger-mania-style-' + raw.name) || '', 10);
      return { time: t, style: isFinite(s) ? s : 0 };
    });
    state = 'records';
    recT = 0;
    hoverIdx = -1;
  }

  function openPause() {
    pausedFrom = state;
    state = 'paused';
    pauseSel = 0;
    keys.up = keys.down = keys.left = keys.right = false;
  }

  // ---------- audio settings ----------
  // rows on the audio screen: the volume keys in audioRects order, then Back
  const audioKeys = ['master', 'music', 'sfx'];
  let audioSel = 0, audioT = 0, audioFrom = 'menu';
  let audioDrag = -1;        // slider row being mouse-dragged, -1 when none
  let audioDragged = false;  // eats the click that ends a drag
  let volBlipAt = 0;

  function goAudio() {
    audioFrom = state; // 'menu' or 'paused'
    state = 'audio';
    audioT = 0;
    audioSel = 0;
    audioDrag = -1;
    hoverIdx = -1;
  }

  function closeAudio() {
    if (audioFrom === 'paused') state = 'paused';
    else goMenu();
  }

  // audible level check while a slider moves, throttled so a drag
  // doesn't machine-gun blips
  function volBlip() {
    const now = performance.now();
    if (now - volBlipAt < 90) return;
    volBlipAt = now;
    blip(740, 0.07);
  }

  function nudgeVolume(i, d) {
    // snap to the 5% grid so arrow keys land on round numbers even
    // after a mouse drag left the volume off-grid
    setVolume(audioKeys[i], Math.round((volume[audioKeys[i]] + d * 0.05) * 20) / 20);
    volBlip();
  }

  // maps a click/drag x onto the dragged row's slider track
  function dragVolume(mx) {
    const bar = audioRects(W, H)[audioDrag].bar;
    setVolume(audioKeys[audioDrag], (mx - bar.x) / bar.w);
    volBlip();
  }

  // ---------- replays ----------
  // With the File System Access API (Chromium) recorded runs are .bmr files on
  // disk and the Replays screen lists a folder the player picks once (the
  // handle is remembered in IndexedDB). Browsers without it (notably iOS
  // Safari) can't browse folders or reopen a downloaded .bmr, so there runs
  // are kept in IndexedDB and listed in-app — see REPLAY.dbSave/dbList/dbDelete.
  let repItems = [];   // { label, sub?, act } buttons on the Replays screen
  let repSel = 0, repScroll = 0, repT = 0, repGen = 0;
  let repNote = '';    // status/help line under the list
  let repDeleteMode = false;  // mobile library: rows delete instead of play
  let replayDir = null;       // FileSystemDirectoryHandle once chosen
  let replayData = null, replayCursor = null, replayOutcome = null;
  let saveNote = '', saveBusy = false;

  function goReplays() {
    state = 'replays';
    repT = 0;
    repSel = 0;
    repScroll = 0;
    repDeleteMode = false;
    hoverIdx = -1;
    buildReplayItems();
  }

  // repopulates the Replays screen; async (folder scans, permission
  // checks), so a generation counter drops stale results
  async function buildReplayItems() {
    const gen = ++repGen;
    repSel = 0;
    repScroll = 0;
    repItems = [];
    repNote = '';
    if (!REPLAY.fsSupported) {
      await buildLocalReplayItems(gen);
      return;
    }
    if (!replayDir) {
      repNote = 'Looking for your replays folder...';
      replayDir = await REPLAY.restoreDir();
      if (gen !== repGen) return;
    }
    if (!replayDir) {
      repItems = [{ label: 'Choose Replays Folder...', act: chooseReplayFolder }];
      repNote = 'Point it at the folder your replays are saved in.';
      return;
    }
    const readable = await REPLAY.dirPermission(replayDir, false);
    if (gen !== repGen) return;
    if (!readable) {
      repItems = [
        { label: 'Reopen "' + replayDir.name + '"', sub: 'the browser wants a fresh OK', act: reopenReplayFolder },
        { label: 'Choose a Different Folder...', act: chooseReplayFolder },
      ];
      return;
    }
    repNote = 'Reading "' + replayDir.name + '"...';
    let files, outdated;
    try {
      ({ files, outdated } = await REPLAY.listDir(replayDir));
    } catch (e) {
      if (gen !== repGen) return;
      repItems = [{ label: 'Choose Replays Folder...', act: chooseReplayFolder }];
      repNote = 'Could not read "' + replayDir.name + '": ' + (e.message || e);
      return;
    }
    if (gen !== repGen) return;
    repItems = files.map(f => ({
      label: f.data.label || f.data.level.name,
      sub: replaySub(f),
      act: () => startReplay(f.data),
    }));
    repItems.push({ label: 'Change Folder...', act: chooseReplayFolder });
    repNote = files.length
      ? staleNote(outdated)
      : (staleNote(outdated) || 'No replays in "' + replayDir.name + '" yet - finish a run and ' +
        (TOUCH.active ? 'tap Save Replay!' : 'press S!'));
  }

  // The mobile library: replays kept in IndexedDB, listed in-app (no folder,
  // no re-openable files). repDeleteMode swaps each row's action from "play"
  // to "delete" so old runs can be pruned without leaving the screen.
  async function buildLocalReplayItems(gen) {
    let files, outdated;
    try {
      ({ files, outdated } = await REPLAY.dbList());
    } catch (e) {
      if (gen !== repGen) return;
      repItems = [];
      repNote = 'Could not read your saved replays: ' + (e.message || e);
      return;
    }
    if (gen !== repGen) return;
    if (!files.length) repDeleteMode = false;
    repItems = files.map(f => ({
      label: (repDeleteMode ? 'Delete: ' : '') + (f.data.label || f.data.level.name),
      sub: replaySub(f),
      act: repDeleteMode ? () => removeReplay(f) : () => startReplay(f.data),
    }));
    if (files.length) {
      repItems.push({
        label: repDeleteMode ? 'Done' : 'Delete a Replay...',
        act: toggleReplayDelete,
      });
    }
    repNote = repDeleteMode
      ? 'Pick a replay to delete for good.'
      : (files.length
        ? staleNote(outdated)
        : (staleNote(outdated) || 'No replays saved yet - finish a run and ' +
          (TOUCH.active ? 'tap Save Replay!' : 'press S!')));
  }

  function toggleReplayDelete() {
    repDeleteMode = !repDeleteMode;
    buildReplayItems();
  }

  async function removeReplay(f) {
    try {
      await REPLAY.dbDelete(f.id);
    } catch (e) {
      repNote = 'Could not delete that replay: ' + (e.message || e);
      blip(180, 0.12);
      return;
    }
    buildReplayItems();
  }

  // replays from an older game version can't be played (the physics they
  // recorded against has changed), so both lists hide them — but say so, so
  // the gap isn't a mystery. '' when none were skipped.
  function staleNote(outdated) {
    if (!outdated) return '';
    return outdated + (outdated > 1 ? ' replays are' : ' replay is') +
      ' from an older version and can no longer be played.';
  }

  function replaySub(f) {
    const what = f.data.outcome === 'finished'
      ? 'finished ' + fmt(f.data.time)
      : 'crashed at ' + fmt(f.data.time);
    // replays saved before style points existed carry no total
    const style = f.data.style != null ? f.data.style : 'N/A';
    return f.name + ' - ' + what + ' - style ' + style;
  }

  async function chooseReplayFolder() {
    try {
      replayDir = await REPLAY.pickDir();
    } catch (e) {
      if (!(e && e.name === 'AbortError')) {
        repNote = 'Folder dialog failed: ' + (e.message || e);
      }
      return;
    }
    buildReplayItems();
  }

  async function reopenReplayFolder() {
    if (await REPLAY.dirPermission(replayDir, true)) buildReplayItems();
  }

  function activateReplays(i) {
    const it = repItems[i];
    if (!it || !it.act) return;
    blip(880, 0.08);
    it.act();
  }

  function startReplay(data) {
    replayData = data;
    replayCursor = REPLAY.cursor(data);
    replayOutcome = null;
    state = 'replay'; // before loadLevel, so reset() leaves the tape alone
    loadLevel(data.level);
    blip(880, 0.08);
  }

  function endReplayView() {
    replayData = null;
    replayCursor = null;
    goReplays();
  }

  function replayFileName(outcome) {
    const stamp = fmt(time).replace(':', 'm').replace(',', 's');
    const tag = outcome === 'finished' ? stamp : 'crash ' + stamp;
    return (level.name + ' ' + tag).replace(/[^\w \-.]/g, '') + REPLAY.EXT;
  }

  // S on the crash/finish screen: write the recorded run to disk
  async function saveReplay() {
    if (saveBusy || !REPLAY.hasRun()) return;
    // the victory screens hold the last map's finished tape; only the
    // crash screen saves a crash
    const outcome = state === 'dead' ? 'crashed' : 'finished';
    saveBusy = true;
    saveNote = 'Saving...';
    try {
      const text = REPLAY.serialize({
        level: currentRaw,
        label: mapLabel(),
        outcome,
        time,
        style: stylePts,
        trackId: currentTrack ? currentTrack.id : null,
        levelIndex,
      });
      const name = replayFileName(outcome);
      if (REPLAY.fsSupported) {
        if (!replayDir) replayDir = await REPLAY.restoreDir();
        saveNote = 'Saved ' + await REPLAY.saveAs(text, name, replayDir);
      } else {
        // no folder to save into: stash it in the in-app library instead
        await REPLAY.dbSave(text, name);
        saveNote = 'Saved! See the Replays screen.';
      }
      blip(880, 0.08);
    } catch (e) {
      saveNote = e && e.name === 'AbortError'
        ? 'S: save replay'
        : 'Save failed: ' + (e.message || e);
    }
    saveBusy = false;
  }

  // dev cheat: typing "skip" raises a level-select overlay over whatever
  // screen summoned it, letting any map in the track be jumped to
  const CHEAT_SKIP = 'skip';
  let cheatBuffer = '';
  let skipTrack = null, skipItems = [];
  let skipSel = 0, skipScroll = 0, skipT = 0, skipFrom = 'menu';

  function checkCheat(key) {
    if (key.length !== 1) return false;
    cheatBuffer = (cheatBuffer + key.toLowerCase()).slice(-CHEAT_SKIP.length);
    if (cheatBuffer !== CHEAT_SKIP) return false;
    cheatBuffer = '';
    return openSkip();
  }

  // the overlay floats over a frozen level when summoned mid-game, or over
  // a menu backdrop otherwise — draw() branches on this
  function skipOverGame() {
    return skipFrom === 'ready' || skipFrom === 'playing' || skipFrom === 'dead' ||
           skipFrom === 'finished' || skipFrom === 'paused';
  }

  function openSkip() {
    const track = currentTrack || TRACKS.find(t => t.levels.length);
    if (!track) return false;
    skipTrack = track;
    skipFrom = state;
    skipItems = track.levels.map((raw, i) => ({
      label: raw.name, sub: 'Map ' + (i + 1) + '/' + track.length,
    }));
    // land on the current map when skipping from inside its own track
    skipSel = currentTrack ? levelIndex : 0;
    const maxScroll = Math.max(0, skipItems.length - SKIP_VIS);
    skipScroll = Math.max(0, Math.min(skipSel - SKIP_VIS + 1, maxScroll));
    state = 'skip';
    skipT = 0;
    hoverIdx = -1;
    keys.up = keys.down = keys.left = keys.right = false;
    blip(1320, 0.15);
    return true;
  }

  function closeSkip() {
    state = skipFrom;
    hoverIdx = -1;
    blip(440, 0.08);
  }

  function activateSkip(i) {
    if (!currentTrack) {
      currentTrack = skipTrack;
      lives = 3;
      continues = MAX_CONTINUES;
      runResults = []; // a fresh campaign, even if entered sideways
    }
    // skipping counts as having beaten everything before the target, so a
    // continue restarts from the checkpoint the player would hold having
    // ridden there: the map right after the last cleared 5th map
    checkpointIndex = Math.floor(i / 5) * 5;
    enterLevel(i);
    state = 'ready';
    blip(1320, 0.15);
  }

  // leave the loading overlay for the title sequence. Stamps the menu clock
  // so the backdrop animations start fresh from this moment (and not from
  // whenever the page happened to finish loading).
  function leaveLoading() {
    if (!loadDone) return;
    state = 'intro';
    introT = 0;
    menuClock0 = performance.now() / 1000;
  }

  function skipIntro() {
    introT = TITLE_ANIM.dur;
    introLaunched = introLanded = TITLE_ANIM.count;
    fanfared = true;
    goMenu();
  }

  // ---------- map editor ----------
  // The editor itself lives in js/editor.js; game.js owns the states
  // around it. 'editor' is the editing screen, 'editorTest' rides the
  // working map through the real sim, and 'editorTestEnd' is its
  // crash/finish screen — test rides bank nothing (no best times, no
  // checkpoints), they only answer "does this map ride?".
  let testOutcome = null;

  function goEditor() {
    EDITOR.open(W, H);
    state = 'editor';
    hoverIdx = -1;
  }

  function startEditorTest() {
    loadLevel(EDITOR.exportLevel());
    testOutcome = null;
    state = 'editorTest';
  }

  function endEditorTest() {
    state = 'editor';
    blip(440, 0.08);
  }

  EDITOR.init({
    exit: () => { blip(880, 0.08); goMenu(); },
    test: () => { blip(880, 0.08); startEditorTest(); },
    blip: () => blip(880, 0.06),
  });

  // ---------- victory ----------
  // Clearing a track's last map crossfades from the frozen finish pose
  // into the victory feast: a hold while the fanfare rings, then a long
  // dissolve ('victoryFade'), then the screen itself ('victory')
  const VICTORY_HOLD = 1.4; // s the finish pose lingers before fading
  const VICTORY_FADE = 4.2; // s the dissolve takes
  let victoryT = 0;

  function victoryAlpha() {
    return Math.max(0, Math.min(1, (victoryT - VICTORY_HOLD) / VICTORY_FADE));
  }

  function skipVictoryFade() {
    victoryT = VICTORY_HOLD + VICTORY_FADE;
    state = 'victory';
    hoverIdx = -1;
  }

  // everything drawVictory needs; results may be sparse (the skip cheat)
  function victoryView(rt) {
    return {
      t: rt,
      pat: patterns.meadow, // the celebration basks in meadow sunshine
      label: currentTrack ? currentTrack.label : '',
      names: currentTrack ? currentTrack.levels.map(l => l.name) : [],
      results: runResults,
      sel: 0,
      hover: hoverIdx,
      touch: TOUCH.active,
      saveNote: TOUCH.active && saveNote === 'S: save replay' ? '' : saveNote,
    };
  }

  function activateMenu(i) {
    if (menuItems[i] === 'Play') {
      blip(880, 0.08);
      goDifficulty();
    } else if (menuItems[i] === 'Map Editor') {
      blip(880, 0.08);
      goEditor();
    } else if (menuItems[i] === 'Replays') {
      blip(880, 0.08);
      goReplays();
    } else if (menuItems[i] === 'Records') {
      blip(880, 0.08);
      goRecordsDiff();
    } else if (menuItems[i] === 'Audio') {
      blip(880, 0.08);
      goAudio();
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
    else if (pauseItems[i] === 'Audio') goAudio();
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
    if (state === 'recordsDiff' && recDiffT > 0.15) {
      return menuRects(W, H, TRACKS.length, H * 0.34);
    }
    if (state === 'records') {
      return recordsRects(W, H);
    }
    if (state === 'continue' && contT > 0.15) {
      return menuRects(W, H, 2, H * 0.62);
    }
    if (state === 'replays' && repT > 0.15) {
      const n = Math.min(REPLAY_VIS, repItems.length - repScroll);
      if (n > 0) return replayRects(W, H, n, H * 0.22);
      return null;
    }
    if (state === 'skip' && skipT > 0.15) {
      const n = Math.min(SKIP_VIS, skipItems.length - skipScroll);
      if (n > 0) return replayRects(W, H, n, H * 0.24);
      return null;
    }
    if (state === 'paused') {
      return menuRects(W, H, pauseItems.length, H * 0.46);
    }
    if (state === 'audio' && audioT > 0.15) {
      return audioRects(W, H);
    }
    if (state === 'victory') {
      return victoryRects(W, H);
    }
    return null;
  }

  function updateHover() {
    if (state === 'editor') return; // the editor manages its own cursor
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
    // the editor owns the keyboard while it's up; M still mutes unless
    // the map name is being typed
    if (state === 'editor') {
      if (!EDITOR.naming && (e.key === 'm' || e.key === 'M')) {
        muted = !muted;
        MUSIC.setMuted(muted);
        return;
      }
      EDITOR.key(e);
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      muted = !muted;
      MUSIC.setMuted(muted);
      return;
    }
    // the cheat would clobber the replay tape mid-watch via reset(); while
    // the picker is already open, typing must not re-summon it. A test
    // ride stays out too: jumping tracks would abandon the editor's level
    if (state !== 'loading' && state !== 'replay' && state !== 'replayEnd' &&
        state !== 'skip' && state !== 'editorTest' && state !== 'editorTestEnd' &&
        checkCheat(e.key)) return;

    switch (state) {
      case 'loading':
        leaveLoading();
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
          // step to the next enabled track, skipping any that are disabled;
          // if Beginner is the only one unlocked, this stays put on it
          let next = diffSel;
          for (let k = 0; k < TRACKS.length; k++) {
            next = (next + d + TRACKS.length) % TRACKS.length;
            if (TRACKS[next].levels.length) break;
          }
          if (next !== diffSel) { diffSel = next; blip(520, 0.05); }
        } else if (e.key === 'Enter' || e.key === ' ') {
          activateDifficulty(diffSel);
        }
        return;
      case 'recordsDiff':
        if (e.key === 'Escape') { goMenu(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const d = e.key === 'ArrowUp' ? -1 : 1;
          // step to the next enabled track, skipping disabled ones (same as
          // the Play selector)
          let next = recDiffSel;
          for (let k = 0; k < TRACKS.length; k++) {
            next = (next + d + TRACKS.length) % TRACKS.length;
            if (TRACKS[next].levels.length) break;
          }
          if (next !== recDiffSel) { recDiffSel = next; blip(520, 0.05); }
        } else if (e.key === 'Enter' || e.key === ' ') {
          activateRecordsDiff(recDiffSel);
        }
        return;
      case 'records':
        // a single Back button: any confirm/cancel returns to the track picker
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
          blip(440, 0.08);
          goRecordsDiff();
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
      case 'audio': {
        if (e.key === 'Escape') { closeAudio(); return; }
        const rows = audioKeys.length + 1; // sliders + Back
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const d = e.key === 'ArrowUp' ? -1 : 1;
          audioSel = (audioSel + d + rows) % rows;
          blip(520, 0.05);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          if (audioSel < audioKeys.length) {
            nudgeVolume(audioSel, e.key === 'ArrowLeft' ? -1 : 1);
          }
        } else if (e.key === 'Enter' || e.key === ' ') {
          if (audioSel === audioKeys.length) {
            blip(880, 0.08);
            closeAudio();
          }
        }
        return;
      }
      case 'replays':
        if (e.key === 'Escape') { goMenu(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          if (repItems.length) {
            const d = e.key === 'ArrowUp' ? -1 : 1;
            repSel = (repSel + d + repItems.length) % repItems.length;
            // keep the selection inside the visible window
            if (repSel < repScroll) repScroll = repSel;
            if (repSel >= repScroll + REPLAY_VIS) repScroll = repSel - REPLAY_VIS + 1;
            blip(520, 0.05);
          }
        } else if (e.key === 'Enter' || e.key === ' ') {
          activateReplays(repSel);
        }
        return;
      case 'skip':
        if (e.key === 'Escape') { closeSkip(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          if (skipItems.length) {
            const d = e.key === 'ArrowUp' ? -1 : 1;
            skipSel = (skipSel + d + skipItems.length) % skipItems.length;
            // keep the selection inside the visible window
            if (skipSel < skipScroll) skipScroll = skipSel;
            if (skipSel >= skipScroll + SKIP_VIS) skipScroll = skipSel - SKIP_VIS + 1;
            blip(520, 0.05);
          }
        } else if (e.key === 'Enter' || e.key === ' ') {
          activateSkip(skipSel);
        }
        return;
      case 'replay':
      case 'replayEnd':
        if (e.key === 'Escape' || e.key === 'Enter') endReplayView();
        return;
      case 'finished':
        if (e.key === 's' || e.key === 'S') { saveReplay(); return; }
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
        if (e.key === 's' || e.key === 'S') { saveReplay(); return; }
        if (e.key === 'Enter') {
          if (lives > 0) { reset(); state = 'playing'; }
          else goContinue();
        } else if (e.key === 'Escape') openPause();
        return;
      case 'victoryFade':
        // let the impatient cut to the feast (held-down keys don't count,
        // so a throttle finger still on UP can't blow through the dissolve)
        if (!e.repeat && (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape')) {
          skipVictoryFade();
        }
        return;
      case 'victory':
        if (e.key === 's' || e.key === 'S') { saveReplay(); return; }
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
          blip(880, 0.08);
          goMenu();
        }
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
        break;
      case 'editorTest':
        if (e.key === 'Escape') { endEditorTest(); return; }
        if (e.key === 'Enter') { reset(); return; } // instant retry while iterating
        break;
      case 'editorTestEnd':
        if (e.key === 'Escape') { endEditorTest(); return; }
        if (e.key === 'Enter') { reset(); state = 'editorTest'; }
        return;
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
    if (state === 'editor') EDITOR.mouseUp(); // a drag can't survive alt-tab
  });

  // fire the menu item under the cursor/finger; shared by mouse clicks
  // and touch taps
  function activateHover() {
    if (hoverIdx < 0) return;
    if (state === 'menu') {
      menuSel = hoverIdx;
      activateMenu(hoverIdx);
    } else if (state === 'difficulty') {
      if (TRACKS[hoverIdx].levels.length) diffSel = hoverIdx;
      activateDifficulty(hoverIdx);
    } else if (state === 'recordsDiff') {
      if (TRACKS[hoverIdx].levels.length) recDiffSel = hoverIdx;
      activateRecordsDiff(hoverIdx);
    } else if (state === 'records') {
      blip(440, 0.08);
      goRecordsDiff(); // the screen's one button: Back to the track picker
    } else if (state === 'continue') {
      contSel = hoverIdx;
      activateContinue(hoverIdx);
    } else if (state === 'replays') {
      repSel = repScroll + hoverIdx;
      activateReplays(repSel);
    } else if (state === 'skip') {
      skipSel = skipScroll + hoverIdx;
      activateSkip(skipSel);
    } else if (state === 'paused') {
      pauseSel = hoverIdx;
      activatePause(hoverIdx);
    } else if (state === 'victory') {
      blip(880, 0.08);
      goMenu(); // the screen's one button
    }
  }

  canvas.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (state === 'editor') {
      EDITOR.mouseMove(e.clientX, e.clientY, e.shiftKey);
      canvas.style.cursor = EDITOR.cursor();
      return;
    }
    if (audioDrag >= 0 && state === 'audio') dragVolume(e.clientX);
    updateHover();
  });
  // the audio sliders want press-and-drag, which click alone can't
  // express; the editor wants the same for its handles and panning
  canvas.addEventListener('mousedown', e => {
    if (state === 'editor') {
      ensureAudio();
      if (AC && AC.state === 'suspended') AC.resume();
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (e.button === 0) EDITOR.mouseDown(e.clientX, e.clientY, e);
      return;
    }
    if (state !== 'audio') return;
    ensureAudio();
    if (AC && AC.state === 'suspended') AC.resume();
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    updateHover();
    if (hoverIdx >= 0 && hoverIdx < audioKeys.length) {
      audioDrag = hoverIdx;
      audioSel = hoverIdx;
      audioDragged = true;
      dragVolume(e.clientX);
    }
  });
  window.addEventListener('mouseup', e => {
    if (state === 'editor') EDITOR.mouseUp(e.clientX, e.clientY);
    audioDrag = -1;
  });
  canvas.addEventListener('dblclick', e => {
    if (state !== 'editor') return;
    EDITOR.dblClick(e.clientX, e.clientY);
  });
  canvas.addEventListener('wheel', e => {
    if (state !== 'editor') return;
    e.preventDefault();
    EDITOR.wheel(e);
  }, { passive: false });
  canvas.addEventListener('click', e => {
    if (state === 'editor') return; // mousedown/up already handled it
    ensureAudio();
    if (AC && AC.state === 'suspended') AC.resume();
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    updateHover();
    const wasDrag = audioDragged;
    audioDragged = false;
    if (state === 'loading') {
      leaveLoading();
      return;
    }
    if (state === 'intro') { skipIntro(); return; }
    if (hoverIdx < 0) return;
    if (state === 'audio') {
      // a drag released over Back shouldn't activate it
      if (!wasDrag && hoverIdx === audioKeys.length) {
        blip(880, 0.08);
        closeAudio();
      }
      return;
    }
    activateHover();
  });

  // ---------- touch ----------
  // Taps drive the menus (acting on touchstart, so there is no synthetic
  // click to double-fire); held fingers drive the riding cluster, which
  // TOUCH resolves positionally on every event.
  let tapGuardUntil = 0; // shields the crash/finish screens from mash-taps

  // per-state tap actions beyond what a mouse click can mean
  function touchTap(x, y) {
    const k = TOUCH.layout(W, H);
    switch (state) {
      case 'loading':
        leaveLoading();
        return;
      case 'intro':
        skipIntro();
        return;
      case 'menu':
      case 'continue':
      case 'paused':
        activateHover();
        return;
      case 'difficulty':
        if (TOUCH.hit(k.back, x, y)) { blip(880, 0.08); goMenu(); return; }
        activateHover();
        return;
      case 'recordsDiff':
        if (TOUCH.hit(k.back, x, y)) { blip(880, 0.08); goMenu(); return; }
        activateHover();
        return;
      case 'records':
        activateHover(); // the on-screen Back button
        return;
      case 'replays': {
        if (TOUCH.hit(k.back, x, y)) { blip(880, 0.08); goMenu(); return; }
        // the "- more -" rows above and below the list window scroll it;
        // derive the bottom row from replayRects so the tap zone tracks the
        // responsive row height instead of a fixed pitch
        const y0 = H * 0.22;
        const rs = replayRects(W, H, Math.min(REPLAY_VIS, repItems.length - repScroll), y0);
        const bot = rs.length ? rs[rs.length - 1].y + rs[rs.length - 1].h + 6 : y0;
        const maxScroll = Math.max(0, repItems.length - REPLAY_VIS);
        if (repScroll > 0 && y > y0 - 50 && y < y0) {
          repScroll--;
          blip(520, 0.05);
          return;
        }
        if (repScroll < maxScroll && y > bot && y < bot + 56) {
          repScroll++;
          blip(520, 0.05);
          return;
        }
        activateHover();
        return;
      }
      case 'skip': {
        if (TOUCH.hit(k.back, x, y)) { closeSkip(); return; }
        const y0 = H * 0.24;
        const rs = replayRects(W, H, Math.min(SKIP_VIS, skipItems.length - skipScroll), y0);
        const bot = rs.length ? rs[rs.length - 1].y + rs[rs.length - 1].h + 6 : y0;
        const maxScroll = Math.max(0, skipItems.length - SKIP_VIS);
        if (skipScroll > 0 && y > y0 - 50 && y < y0) {
          skipScroll--;
          blip(520, 0.05);
          return;
        }
        if (skipScroll < maxScroll && y > bot && y < bot + 56) {
          skipScroll++;
          blip(520, 0.05);
          return;
        }
        activateHover();
        return;
      }
      case 'audio':
        if (hoverIdx >= 0 && hoverIdx < audioKeys.length) {
          audioDrag = hoverIdx;
          audioSel = hoverIdx;
          dragVolume(x);
        } else if (hoverIdx === audioKeys.length) {
          blip(880, 0.08);
          closeAudio();
        }
        return;
      case 'ready':
        if (TOUCH.hit(k.pause, x, y)) { openPause(); return; }
        state = 'playing'; // tap to ride; a held gas finger already counts
        return;
      case 'playing':
        if (TOUCH.hit(k.pause, x, y)) { openPause(); return; }
        return;
      case 'dead':
      case 'finished':
        if (TOUCH.hit(k.save, x, y)) { saveReplay(); return; }
        if (TOUCH.hit(k.pause, x, y)) { openPause(); return; }
        if (performance.now() < tapGuardUntil) return;
        if (state === 'dead') {
          if (lives > 0) { reset(); state = 'playing'; }
          else goContinue();
        } else if (hasNextLevel()) {
          enterLevel(levelIndex + 1);
          state = 'ready';
        } else {
          goMenu();
        }
        return;
      case 'victoryFade':
        if (performance.now() < tapGuardUntil) return;
        skipVictoryFade(); // a tap cuts straight to the feast
        return;
      case 'victory':
        activateHover();
        return;
      case 'replay':
      case 'replayEnd':
        endReplayView();
        return;
      case 'editorTest':
        if (TOUCH.hit(k.pause, x, y)) { endEditorTest(); return; }
        if (TOUCH.hit(k.restart, x, y)) { reset(); return; }
        return;
      case 'editorTestEnd':
        if (TOUCH.hit(k.pause, x, y)) { endEditorTest(); return; }
        if (performance.now() < tapGuardUntil) return;
        reset();
        state = 'editorTest';
        return;
    }
  }

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    TOUCH.activate();
    lockLandscape();
    ensureAudio();
    if (AC && AC.state === 'suspended') AC.resume();
    const t = e.changedTouches[0];
    mouse.x = t.clientX;
    mouse.y = t.clientY;
    // the editor reads a finger as a mouse: press, drag, release
    if (state === 'editor') {
      EDITOR.mouseDown(t.clientX, t.clientY, e);
      return;
    }
    updateHover();
    // a fresh finger on the turn-around button queues a flip (one-shot,
    // like the space bar — a held finger doesn't repeat it)
    if (state === 'playing' || state === 'ready' || state === 'editorTest') {
      const L = TOUCH.layout(W, H);
      for (const c of e.changedTouches) {
        if (TOUCH.hit(L.flip, c.clientX, c.clientY)) flipQueued = true;
      }
    }
    TOUCH.sync(e.touches, W, H);
    touchTap(t.clientX, t.clientY);
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    mouse.x = t.clientX;
    mouse.y = t.clientY;
    if (state === 'editor') {
      EDITOR.mouseMove(t.clientX, t.clientY);
      return;
    }
    if (audioDrag >= 0 && state === 'audio') dragVolume(t.clientX);
    updateHover();
    TOUCH.sync(e.touches, W, H);
  }, { passive: false });

  function touchEnd(e) {
    e.preventDefault();
    if (state === 'editor') {
      const t = e.changedTouches[0];
      EDITOR.mouseUp(t ? t.clientX : undefined, t ? t.clientY : undefined);
      return;
    }
    TOUCH.sync(e.touches, W, H);
    if (!e.touches.length) audioDrag = -1;
  }
  canvas.addEventListener('touchend', touchEnd, { passive: false });
  canvas.addEventListener('touchcancel', touchEnd, { passive: false });

  // long-press save-image popups would interrupt play on touch devices
  canvas.addEventListener('contextmenu', e => {
    if (TOUCH.active) e.preventDefault();
  });

  // ---------- gameplay ----------
  // Style points are scored for airborne tricks. The detection only READS
  // sim state (never feeds back into the physics), so live play and replay
  // playback recompute the same totals and old tapes stay in sync.
  const STYLE_FLIP = 100; // turning around (space) while fully airborne
  const STYLE_SPIN = 250; // each full rotation, in the air or on the ground
  const STYLE_WHEELIE = 50;      // full-speed ceiling per interval held in a wheelie
  const STYLE_STOPPIE = 300;     // stoppie ceiling: far harder to hold, so worth more
  const STYLE_TRICK_EVERY = 1;   // seconds of unbroken balance per payout
  const TRICK_SLACK = 0.4;       // gap (m) under a wheel still scored as planted
  const TRICK_FULL_SPEED = 8;    // m/s at/above which a trick pays its full ceiling

  // true only once a physics step has run (onGround starts undefined), so
  // a flip queued on the very first frame of a run can't read as airborne
  function bikeAirborne() {
    return bike.wheels.every(w => w.onGround === false);
  }

  // Whether a wheel is "planted" for trick scoring. The strict onGround flag
  // only trips while the tire is penetrating a segment, but the bike chatters
  // and bounces over terrain constantly, so a hair of daylight under the
  // balancing wheel would flicker the flag off and break a wheelie/stoppie.
  // Instead we measure the gap to the nearest segment and count anything
  // within TRICK_SLACK as still down — a read-only test, like the rest of the
  // style detection, so live play and replay stay in sync.
  function wheelPlanted(w) {
    for (const s of level.segments) {
      const cp = closestOnSeg(w.pos.x, w.pos.y, s);
      if (Math.hypot(w.pos.x - cp.x, w.pos.y - cp.y) < PHYS.wheelR + TRICK_SLACK) {
        return true;
      }
    }
    return false;
  }

  // fraction of a trick's ceiling earned at the current speed: full value at
  // TRICK_FULL_SPEED and above, falling off steeply (squared) toward a crawl,
  // so a fast wheelie banks the ceiling and a near-stationary balance earns
  // almost nothing. read-only on velocity, so replays recompute identically
  function trickSpeedScale() {
    const f = Math.min(1, Math.hypot(bike.vel.x, bike.vel.y) / TRICK_FULL_SPEED);
    return f * f;
  }

  function awardStyle(pts) {
    stylePts += pts;
    // toasts cycle three lanes so back-to-back awards rise side by side
    stylePopups.push({ text: '+' + pts, age: 0, dx: [0, -0.6, 0.6][popupSeq++ % 3] });
    styleSparkle(pts >= STYLE_SPIN);
  }

  function agePopups(dt) {
    for (const p of stylePopups) p.age += dt;
    // appended in age order, so the head is always the oldest
    if (stylePopups.length && stylePopups[0].age >= STYLE_POPUP_DUR) {
      stylePopups = stylePopups.filter(p => p.age < STYLE_POPUP_DUR);
    }
  }

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
          // an upside-down burger reverses gravity as it's eaten; the swoop
          // sound follows the new pull. Deterministic (runs in the shared sim
          // frame), so replays flip at the same instant
          if (b.flip) { bike.grav *= -1; gravWhoomp(bike.grav < 0); }
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
    if (state === 'replay') {
      // a watched run banks nothing: no best time, no checkpoint
      replayOutcome = 'finished';
      state = 'replayEnd';
      blip(660, 0.12);
      setTimeout(() => blip(880, 0.12), 130);
      setTimeout(() => blip(1320, 0.22), 260);
      return;
    }
    if (state === 'editorTest') {
      // a test ride proves the map, it banks nothing
      testOutcome = 'finished';
      state = 'editorTestEnd';
      tapGuardUntil = performance.now() + 600;
      blip(660, 0.12);
      setTimeout(() => blip(880, 0.12), 130);
      setTimeout(() => blip(1320, 0.22), 260);
      return;
    }
    saveNote = 'S: save replay';
    tapGuardUntil = performance.now() + 600;
    // completing every 5th map of a track (1-5, 1-10, ...) banks a
    // checkpoint: a continue used later restarts from the NEXT map, so a
    // cleared checkpoint map never has to be re-beaten
    if (currentTrack && (levelIndex + 1) % 5 === 0) {
      checkpointIndex = Math.min(levelIndex + 1, currentTrack.levels.length - 1);
    }
    const timeRecord = best === null || time < best;
    if (timeRecord) {
      best = time;
      localStorage.setItem(bestKey, String(best));
    }
    const styleRecord = stylePts > 0 && (styleBest === null || stylePts > styleBest);
    if (styleRecord) {
      styleBest = stylePts;
      localStorage.setItem(styleKey, String(styleBest));
    }
    if (currentTrack) {
      // log the run for the victory scorecard; the flags mark scores that
      // just became (and so now are) the all-time records
      runResults[levelIndex] = { time, style: stylePts, timeRecord, styleRecord };
    }
    if (currentTrack && !hasNextLevel()) {
      // the whole track is beaten: no finished screen, the frozen finish
      // pose hangs a beat and then dissolves into the victory feast
      state = 'victoryFade';
      victoryT = 0;
      hoverIdx = -1;
    } else {
      state = 'finished';
    }
    blip(660, 0.12);
    setTimeout(() => blip(880, 0.12), 130);
    setTimeout(() => blip(1320, 0.22), 260);
  }

  function onDeath() {
    if (state === 'replay') {
      replayOutcome = 'crashed';
      state = 'replayEnd';
    } else if (state === 'editorTest') {
      testOutcome = 'crashed';
      state = 'editorTestEnd';
      tapGuardUntil = performance.now() + 600;
    } else {
      state = 'dead';
      lives = Math.max(0, lives - 1);
      saveNote = 'S: save replay';
      tapGuardUntil = performance.now() + 600;
    }
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
    headBody.vy += PHYS.g * bike.grav * dt;
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

  // one 60 Hz sim frame, shared by live play and replay playback: applies
  // a queued turn-around, substeps the physics, then settles the outcome
  function simFrame(input, doFlip) {
    const wasAir = bikeAirborne();
    if (doFlip) {
      bike.flip();
      whoosh(0.14, 950, 0.22);
      if (wasAir) awardStyle(STYLE_FLIP);
    }
    simInput = input;
    const angle0 = bike.angle;
    const voltCd0 = bike.voltCd;
    // wheel touchdowns are caught per substep, not per frame: a hard landing
    // rebounds within a single 60 Hz frame (airborne → planted → airborne), so
    // a frame-boundary check would miss exactly the biggest hits. Track each
    // wheel's contact across substeps and thud the instant it plants, scaled by
    // how fast it was dropping in (speed along gravity, so a flipped bike reads
    // its ceiling as the floor); the WHEEL_HIT_MIN gate keeps rolling chatter
    // and feather-soft plants silent
    const wasGround = bike.wheels.map(w => w.onGround);
    let frameSusp = 0;
    for (let i = 0; i < SUB; i++) {
      const drop = bike.wheels.map(w => w.vel.y * bike.grav);
      bike.step(FDT / SUB, input, level.segments, level.nuts);
      bike.wheels.forEach((w, k) => {
        if (!wasGround[k] && w.onGround && drop[k] > WHEEL_HIT_MIN) {
          wheelHit(Math.min(1, (drop[k] - WHEEL_HIT_MIN) / WHEEL_HIT_SPAN));
        }
        wasGround[k] = w.onGround;
      });
      frameSusp = Math.max(frameSusp, suspLoad()); // peak compression this frame
      if (bike.dead) break;
    }
    // peak-hold the suspension load then bleed it off, so a hard compression
    // cranks the sound up at once and rings down, while a sustained press holds
    suspLevel = Math.max(frameSusp, suspLevel * SUSP_RELEASE);
    if (bike.dead) {
      onDeath();
    } else {
      time += FDT;
      // a volt fired this frame iff the cooldown was just re-armed: it only
      // jumps back up (to voltEvery) at the instant of a volt and otherwise
      // only ticks down. Sound the rider's weight-throw (the arm-pump it
      // animates is driven straight off voltCd over in render.js)
      if (bike.voltCd > voltCd0 + 1e-6) voltThump();
      // net rotation, airborne or not (a ground loop-the-loop is style
      // too): every full lap pays out, wobble cancels itself
      spinAcc += bike.angle - angle0;
      if (Math.abs(spinAcc) >= Math.PI * 2) {
        spinAcc -= Math.sign(spinAcc) * Math.PI * 2;
        awardStyle(STYLE_SPIN);
      }
      // balance tricks trickle style for every STYLE_TRICK_EVERY they're
      // held: a wheelie (rear planted, front lifted) pays a little, a stoppie
      // (front planted, rear lifted) is far harder to hold so it pays a lot.
      // each clock keeps awarding while its pose lasts and zeroes the instant
      // it breaks, so only sustained, unbroken balance scores. "planted" is
      // lenient (see wheelPlanted) so terrain chatter doesn't break the hold
      const rearDown = wheelPlanted(bike.wheels[bike.rearIndex]);
      const frontDown = wheelPlanted(bike.wheels[1 - bike.rearIndex]);
      if (rearDown && !frontDown) {
        wheelieT += FDT;
        if (wheelieT >= STYLE_TRICK_EVERY) {
          wheelieT -= STYLE_TRICK_EVERY;
          const pts = Math.round(STYLE_WHEELIE * trickSpeedScale());
          if (pts > 0) awardStyle(pts); // a crawling wheelie scores nothing
        }
      } else {
        wheelieT = 0;
      }
      if (frontDown && !rearDown) {
        stoppieT += FDT;
        if (stoppieT >= STYLE_TRICK_EVERY) {
          stoppieT -= STYLE_TRICK_EVERY;
          const pts = Math.round(STYLE_STOPPIE * trickSpeedScale());
          if (pts > 0) awardStyle(pts);
        }
      } else {
        stoppieT = 0;
      }
      checkPickups();
    }
  }

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
      } else if (state === 'recordsDiff') {
        recDiffT += FDT;
      } else if (state === 'records') {
        recT += FDT;
      } else if (state === 'continue') {
        contT += FDT;
      } else if (state === 'replays') {
        repT += FDT;
      } else if (state === 'skip') {
        skipT += FDT;
      } else if (state === 'audio') {
        audioT += FDT;
      } else if (state === 'victoryFade' || state === 'victory') {
        victoryT += FDT;
        if (state === 'victoryFade' && victoryAlpha() >= 1) {
          state = 'victory';
          hoverIdx = -1;
        }
      } else if (state === 'playing' || state === 'editorTest') {
        // keyboard and the on-screen touch cluster merge into one mask;
        // the tape gets one mask per frame: exactly what the sim consumes
        const up = keys.up || TOUCH.input.up;
        const down = keys.down || TOUCH.input.down;
        const left = keys.left || TOUCH.input.left;
        const right = keys.right || TOUCH.input.right;
        REPLAY.record(
          (up ? 1 : 0) | (down ? 2 : 0) |
          (left ? 4 : 0) | (right ? 8 : 0), flipQueued);
        simFrame({ throttle: up, brake: down, left, right }, flipQueued);
      } else if (state === 'replay') {
        let f = { mask: 0, flip: false };
        if (replayCursor && !replayCursor.done()) f = replayCursor.next();
        simFrame({
          throttle: !!(f.mask & 1), brake: !!(f.mask & 2),
          left: !!(f.mask & 4), right: !!(f.mask & 8),
        }, f.flip);
        // tape exhausted without the recorded ending: the sim has drifted
        // off it (the game changed since the save) — stop here
        if (state === 'replay' && (!replayCursor || replayCursor.done())) {
          state = 'replayEnd';
        }
      } else if (state === 'dead' || state === 'replayEnd' ||
                 state === 'editorTestEnd') {
        for (let i = 0; i < SUB; i++) stepHead(FDT / SUB);
      }
      flipQueued = false;
      // the bike has stopped being simmed in these aftermath states, so keep
      // bleeding the suspension crank down here (simFrame normally does it) —
      // that's what lets a fatal-hit crank ring out rather than freeze on
      if (state === 'dead' || state === 'replayEnd' ||
          state === 'editorTestEnd' || state === 'finished') {
        suspLevel *= SUSP_RELEASE;
      }
      // victoryFade stays in this list: the frozen finish frame under the
      // dissolve keeps its settling camera and rising toasts
      if (state !== 'loading' && state !== 'intro' && state !== 'menu' &&
          state !== 'difficulty' && state !== 'continue' && state !== 'replays' &&
          state !== 'audio' && state !== 'skip' && state !== 'editor' &&
          state !== 'recordsDiff' && state !== 'records' &&
          state !== 'victory') {
        updateCamera(FDT);
        // toasts keep rising over the crash/finish screens, but a pause
        // freezes them along with everything else
        if (state !== 'paused') agePopups(FDT);
      }
    }
    updateHover();
    draw();
    TOUCH.draw(ctx, W, H, { state, saveBusy });
    updateEngineSound();
    updateSuspensionSound();
    updateMusic();
    requestAnimationFrame(frame);
  }

  function draw() {
    const rt = performance.now() / 1000;
    // menu-world time: zero at the moment the loading overlay is dismissed,
    // so the backdrop's clouds/burgers/astronaut begin their cycles fresh
    // (and the astro gag's 30s delay is measured from the player tapping in).
    const mt = menuClock0 >= 0 ? rt - menuClock0 : 0;
    // The title screen and every sub-screen reached from it (difficulty,
    // records, replays, menu audio) are one continuous scene, so they share
    // the same furniture: the drifting meadow world, the rising-astronaut gag,
    // and the physics build stamp all persist. Only the "BURGER MANIA" title
    // is exclusive to the top menu — stepping into a sub-screen never blanks
    // the rest of the scene out from under the player mid-animation.
    function menuScene() {
      drawMenuBackdrop(ctx, W, H, mt, patterns.meadow, true);
      drawCornerTag(ctx, W, H, 'physics v' + REPLAY.VERSION);
    }
    if (state === 'loading') {
      drawLoading(ctx, W, H, loadFrac, rt, loadDone, TOUCH.active);
      return;
    }
    if (state === 'intro' || state === 'menu') {
      menuScene();
      drawTitleLetters(ctx, W, H, introT);
      if (state === 'menu') {
        drawMenu(ctx, W, H, Math.min(1, menuT / 0.6), menuItems, menuSel, hoverIdx);
      }
      return;
    }
    if (state === 'difficulty') {
      menuScene();
      drawDifficulty(ctx, W, H, Math.min(1, diffT / 0.4), TRACKS, diffSel, hoverIdx,
        TOUCH.active);
      return;
    }
    if (state === 'recordsDiff') {
      menuScene();
      drawDifficulty(ctx, W, H, Math.min(1, recDiffT / 0.4), TRACKS, recDiffSel,
        hoverIdx, TOUCH.active, 'BEST RECORDS');
      return;
    }
    if (state === 'records') {
      menuScene();
      drawRecords(ctx, W, H, Math.min(1, recT / 0.4), {
        label: recTrack ? recTrack.label : '',
        names: recNames, results: recResults, sel: 0, hover: hoverIdx,
        touch: TOUCH.active,
      });
      return;
    }
    if (state === 'continue') {
      // the rider slumps in the world he just lost in (the checkpoint
      // map a continue would restart shares the same world)
      drawMenuBackdrop(ctx, W, H, mt, patterns[level.theme] || patterns.meadow);
      drawContinue(ctx, W, H, Math.min(1, contT / 0.4), rt, continues, contSel, hoverIdx);
      return;
    }
    if (state === 'replays') {
      menuScene();
      drawReplays(ctx, W, H, Math.min(1, repT / 0.4),
        repItems, repSel, repScroll, hoverIdx, repNote, TOUCH.active);
      return;
    }
    if (state === 'audio' && audioFrom !== 'paused') {
      menuScene();
      drawAudio(ctx, W, H, Math.min(1, audioT / 0.4),
        { volume, sel: audioSel, hover: hoverIdx, dim: false, muted,
          touch: TOUCH.active });
      return;
    }
    // the skip picker summoned from a menu gets its own backdrop; summoned
    // mid-game it falls through to float over the frozen level instead
    if (state === 'skip' && !skipOverGame()) {
      drawMenuBackdrop(ctx, W, H, mt, patterns[level.theme] || patterns.meadow);
      drawLevelSelect(ctx, W, H, Math.min(1, skipT / 0.4), {
        items: skipItems, sel: skipSel, scroll: skipScroll, hover: hoverIdx,
        label: skipTrack ? skipTrack.label : '', touch: TOUCH.active,
      });
      return;
    }
    // audio opened from the pause menu falls through: the frozen level
    // stays visible behind it, just like the pause screen itself

    if (state === 'editor') {
      EDITOR.draw(ctx, W, H, patterns, rt);
      return;
    }

    // the feast owns the whole screen; victoryFade instead falls through,
    // so the frozen finish frame can sit under the dissolve
    if (state === 'victory') {
      drawVictory(ctx, W, H, victoryView(rt));
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
      { x0: cam.x - hw, y0: cam.y - hh, x1: cam.x + hw, y1: cam.y + hh }, rt);
    // back-layer doodads sit in the scene behind every actor; front-layer ones
    // (below) ride over the rider so he passes behind the prop
    drawDoodadLayer(ctx, level.doodads, 'back', rt);
    if (level.nuts) for (const n of level.nuts) drawNutMound(ctx, n[0], n[1], rt);
    for (const b of burgers) if (!b.got) drawBurger(ctx, b.x, b.y, rt);
    drawPopcorn(ctx, level.goal[0], level.goal[1], rt);
    drawBike(ctx, bike, !!headBody);
    if (headBody) drawHead(ctx, headBody.x, headBody.y, bike.facing, headBody.rot);
    drawDoodadLayer(ctx, level.doodads, 'front', rt);
    ctx.restore();

    // floating "+N" awards ride above the biker in world coordinates but
    // are lettered in screen space so the text stays crisp
    for (const p of stylePopups) {
      const wx = bike.pos.x + p.dx;
      const wy = bike.pos.y - 1.5 - p.age * 1.1;
      drawStylePopup(ctx, W / 2 + (wx - cam.x) * Z, H / 2 + (wy - cam.y) * Z,
        p.text, p.age, Z);
    }

    drawMinimap(ctx, W, H, level, {
      pos: bike.pos,
      burgers,
      goal: level.goal,
      nuts: level.nuts,
      t: rt,
      theme,
    });

    const watching = state === 'replay' || state === 'replayEnd';
    const testing = state === 'editorTest' || state === 'editorTestEnd';
    drawHUD(ctx, W, H, {
      time,
      t: rt,
      theme,
      got: burgers.filter(b => b.got).length,
      total: burgers.length,
      best,
      style: stylePts,
      styleBest,
      state,
      lives: watching || testing ? null : lives,
      hasNext: hasNextLevel(),
      mapLabel: testing ? level.name : mapLabel(),
      replay: watching ? {
        label: (replayData && replayData.label) || level.name,
        done: state === 'replayEnd',
        outcome: replayOutcome,
      } : null,
      test: testing ? {
        done: state === 'editorTestEnd',
        outcome: testOutcome,
      } : null,
      // the keyboard hint is redundant next to the touch save button;
      // save status messages still show either way
      saveNote: TOUCH.active && saveNote === 'S: save replay' ? '' : saveNote,
      touch: TOUCH.active,
    });

    if (state === 'paused') {
      drawPause(ctx, W, H, pauseItems, pauseSel, hoverIdx);
    }
    if (state === 'audio') {
      drawAudio(ctx, W, H, Math.min(1, audioT / 0.4),
        { volume, sel: audioSel, hover: hoverIdx, dim: true, muted,
          touch: TOUCH.active });
    }
    if (state === 'skip') {
      drawLevelSelect(ctx, W, H, Math.min(1, skipT / 0.4), {
        items: skipItems, sel: skipSel, scroll: skipScroll, hover: hoverIdx,
        label: skipTrack ? skipTrack.label : '', touch: TOUCH.active,
      });
    }
    if (state === 'victoryFade') {
      drawVictoryFade(ctx, W, H, victoryAlpha(), victoryView(rt));
    }
  }

  requestAnimationFrame(frame);
})();
