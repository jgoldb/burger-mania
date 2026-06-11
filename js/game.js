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
  const MAX_CONTINUES = 2;
  let lives = 3, continues = MAX_CONTINUES, checkpointIndex = 0;
  let currentRaw = LEVELS[0]; // unprepared level data (what a saved replay embeds)
  let level = prepareLevel(LEVELS[0]);
  let bestKey = 'burger-mania-best-' + level.name;
  let best = parseFloat(localStorage.getItem(bestKey) || '');
  if (!isFinite(best)) best = null;
  let cam = { x: level.start.x, y: level.start.y };
  const CAM_LEAD = 4.2; // how far the view centers ahead of the bike's facing
  let camLead = CAM_LEAD; // smoothed, so turning around pans rather than snaps
  let flipQueued = false;
  const keys = { up: false, down: false, left: false, right: false };
  // the input the sim consumed this frame (from keys, or from a replay
  // tape during playback) — the engine sound follows it either way
  let simInput = { throttle: false, brake: false, left: false, right: false };

  // ---------- screens ----------
  let loadFrac = 0, loadDone = false;
  let introT = 0, menuT = 0, diffT = 0, contT = 0;
  let introLaunched = 0, introLanded = 0, fanfared = false;
  const menuItems = ['Play', 'Replays', 'Audio'];
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
    burgers = level.burgers.map(b => ({ x: b[0], y: b[1], got: false }));
    headBody = null;
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
    reset();
  }

  // ---------- sound ----------
  // the engine drone and one-shot effects feed sfxGain, the soundtrack
  // feeds musicGain, and both meet in masterGain — the three sliders on
  // the audio settings screen
  let AC = null, engineSnd = null, muted = false;
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
      MUSIC.init(AC, musicGain);
    } catch (e) { /* no audio available */ }
  }

  // picks the soundtrack for the current screen: the menu and difficulty
  // screens share the title theme, the continue screen mourns on its own,
  // and every in-game state plays the current world's song (a name MUSIC
  // doesn't know, like the silent loading/intro screens' null, fades out)
  function updateMusic() {
    let want = null;
    if (state === 'menu' || state === 'difficulty' || state === 'replays') want = 'menu';
    else if (state === 'continue') want = 'continue';
    else if (state === 'audio') {
      // keep whatever was playing, full volume even over a pause, so the
      // music slider is tuned against the level it'll actually play at
      want = audioFrom === 'paused' ? level.theme : 'menu';
    }
    else if (state === 'ready' || state === 'playing' || state === 'dead' ||
             state === 'finished' || state === 'paused' ||
             state === 'replay' || state === 'replayEnd') {
      want = level.theme;
    }
    MUSIC.play(want);
    MUSIC.duck(state === 'paused');
  }

  function updateEngineSound() {
    if (!engineSnd) return;
    let g = 0, f = 40;
    if (!muted && (state === 'playing' || state === 'replay')) {
      const rear = bike.wheels[bike.rearIndex];
      f = 34 + Math.abs(rear.spin) * 1.25 + (simInput.throttle ? 18 : 0);
      g = simInput.throttle ? 0.085 : 0.045;
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
  // Recorded runs live in .bmr files on the player's disk. With the File
  // System Access API (Chromium) the Replays screen lists a folder the
  // player picks once (the handle is remembered in IndexedDB); elsewhere
  // it falls back to opening one file at a time.
  let repItems = [];   // { label, sub?, act } buttons on the Replays screen
  let repSel = 0, repScroll = 0, repT = 0, repGen = 0;
  let repNote = '';    // status/help line under the list
  let replayDir = null;       // FileSystemDirectoryHandle once chosen
  let replayData = null, replayCursor = null, replayOutcome = null;
  let saveNote = '', saveBusy = false;

  function goReplays() {
    state = 'replays';
    repT = 0;
    repSel = 0;
    repScroll = 0;
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
      repItems = [{ label: 'Open Replay File...', act: openReplayFile }];
      repNote = 'This browser cannot browse folders - open replays one at a time.';
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
    let files;
    try {
      files = await REPLAY.listDir(replayDir);
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
    repNote = files.length ? ''
      : 'No replays in "' + replayDir.name + '" yet - finish a run and press S!';
  }

  function replaySub(f) {
    const what = f.data.outcome === 'finished'
      ? 'finished ' + fmt(f.data.time)
      : 'crashed at ' + fmt(f.data.time);
    return f.name + ' - ' + what;
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

  async function openReplayFile() {
    try {
      startReplay(REPLAY.parse(await REPLAY.openFile()));
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      repNote = 'Could not load that replay: ' + (e.message || e);
      blip(180, 0.12);
    }
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
    const outcome = state === 'finished' ? 'finished' : 'crashed';
    saveBusy = true;
    saveNote = 'Saving...';
    try {
      const text = REPLAY.serialize({
        level: currentRaw,
        label: mapLabel(),
        outcome,
        time,
        trackId: currentTrack ? currentTrack.id : null,
        levelIndex,
      });
      if (!replayDir) replayDir = await REPLAY.restoreDir();
      const saved = await REPLAY.saveAs(text, replayFileName(outcome), replayDir);
      saveNote = 'Saved ' + saved;
      blip(880, 0.08);
    } catch (e) {
      saveNote = e && e.name === 'AbortError'
        ? 'S: save replay'
        : 'Save failed: ' + (e.message || e);
    }
    saveBusy = false;
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
      continues = MAX_CONTINUES;
    }
    const target = track.levels.length - 1;
    // skipping counts as having beaten everything before the target, so a
    // continue restarts from the checkpoint the player would hold having
    // ridden there: the map right after the last cleared 5th map
    checkpointIndex = Math.floor(target / 5) * 5;
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
    } else if (menuItems[i] === 'Replays') {
      blip(880, 0.08);
      goReplays();
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
    if (state === 'continue' && contT > 0.15) {
      return menuRects(W, H, 2, H * 0.62);
    }
    if (state === 'replays' && repT > 0.15) {
      const n = Math.min(REPLAY_VIS, repItems.length - repScroll);
      if (n > 0) return replayRects(W, H, n, H * 0.22);
      return null;
    }
    if (state === 'paused') {
      return menuRects(W, H, pauseItems.length, H * 0.46);
    }
    if (state === 'audio' && audioT > 0.15) {
      return audioRects(W, H);
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
      MUSIC.setMuted(muted);
      return;
    }
    // the cheat would clobber the replay tape mid-watch via reset()
    if (state !== 'loading' && state !== 'replay' && state !== 'replayEnd' &&
        checkCheat(e.key)) return;

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
          // step to the next enabled track, skipping any that are disabled;
          // if Easy is the only one unlocked, this stays put on it
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
    if (audioDrag >= 0 && state === 'audio') dragVolume(e.clientX);
    updateHover();
  });
  // the audio sliders want press-and-drag, which click alone can't express
  canvas.addEventListener('mousedown', e => {
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
  window.addEventListener('mouseup', () => { audioDrag = -1; });
  canvas.addEventListener('click', e => {
    ensureAudio();
    if (AC && AC.state === 'suspended') AC.resume();
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    updateHover();
    const wasDrag = audioDragged;
    audioDragged = false;
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
      if (TRACKS[hoverIdx].levels.length) diffSel = hoverIdx;
      activateDifficulty(hoverIdx);
    } else if (state === 'continue') {
      contSel = hoverIdx;
      activateContinue(hoverIdx);
    } else if (state === 'replays') {
      repSel = repScroll + hoverIdx;
      activateReplays(repSel);
    } else if (state === 'paused') {
      pauseSel = hoverIdx;
      activatePause(hoverIdx);
    } else if (state === 'audio') {
      // a drag released over Back shouldn't activate it
      if (!wasDrag && hoverIdx === audioKeys.length) {
        blip(880, 0.08);
        closeAudio();
      }
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
    if (state === 'replay') {
      // a watched run banks nothing: no best time, no checkpoint
      replayOutcome = 'finished';
      state = 'replayEnd';
      blip(660, 0.12);
      setTimeout(() => blip(880, 0.12), 130);
      setTimeout(() => blip(1320, 0.22), 260);
      return;
    }
    state = 'finished';
    saveNote = 'S: save replay';
    // completing every 5th map of a track (1-5, 1-10, ...) banks a
    // checkpoint: a continue used later restarts from the NEXT map, so a
    // cleared checkpoint map never has to be re-beaten
    if (currentTrack && (levelIndex + 1) % 5 === 0) {
      checkpointIndex = Math.min(levelIndex + 1, currentTrack.levels.length - 1);
    }
    if (best === null || time < best) {
      best = time;
      localStorage.setItem(bestKey, String(best));
    }
    blip(660, 0.12);
    setTimeout(() => blip(880, 0.12), 130);
    setTimeout(() => blip(1320, 0.22), 260);
  }

  function onDeath() {
    if (state === 'replay') {
      replayOutcome = 'crashed';
      state = 'replayEnd';
    } else {
      state = 'dead';
      lives = Math.max(0, lives - 1);
      saveNote = 'S: save replay';
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

  // one 60 Hz sim frame, shared by live play and replay playback: applies
  // a queued turn-around, substeps the physics, then settles the outcome
  function simFrame(input, doFlip) {
    if (doFlip) {
      bike.flip();
      whoosh(0.14, 950, 0.22);
    }
    simInput = input;
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
      } else if (state === 'continue') {
        contT += FDT;
      } else if (state === 'replays') {
        repT += FDT;
      } else if (state === 'audio') {
        audioT += FDT;
      } else if (state === 'playing') {
        // the tape gets one mask per frame: exactly what the sim consumes
        REPLAY.record(
          (keys.up ? 1 : 0) | (keys.down ? 2 : 0) |
          (keys.left ? 4 : 0) | (keys.right ? 8 : 0), flipQueued);
        simFrame({
          throttle: keys.up, brake: keys.down,
          left: keys.left, right: keys.right,
        }, flipQueued);
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
      } else if (state === 'dead' || state === 'replayEnd') {
        for (let i = 0; i < SUB; i++) stepHead(FDT / SUB);
      }
      flipQueued = false;
      if (state !== 'loading' && state !== 'intro' && state !== 'menu' &&
          state !== 'difficulty' && state !== 'continue' && state !== 'replays' &&
          state !== 'audio') {
        updateCamera(FDT);
      }
    }
    updateHover();
    draw();
    updateEngineSound();
    updateMusic();
    requestAnimationFrame(frame);
  }

  function draw() {
    const rt = performance.now() / 1000;
    if (state === 'loading') {
      drawLoading(ctx, W, H, loadFrac, rt, loadDone);
      return;
    }
    if (state === 'intro' || state === 'menu') {
      drawMenuBackdrop(ctx, W, H, rt, patterns.meadow, true);
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
      // the rider slumps in the world he just lost in (the checkpoint
      // map a continue would restart shares the same world)
      drawMenuBackdrop(ctx, W, H, rt, patterns[level.theme] || patterns.meadow);
      drawContinue(ctx, W, H, Math.min(1, contT / 0.4), rt, continues, contSel, hoverIdx);
      return;
    }
    if (state === 'replays') {
      drawMenuBackdrop(ctx, W, H, rt, patterns.meadow);
      drawReplays(ctx, W, H, Math.min(1, repT / 0.4),
        repItems, repSel, repScroll, hoverIdx, repNote);
      return;
    }
    if (state === 'audio' && audioFrom !== 'paused') {
      drawMenuBackdrop(ctx, W, H, rt, patterns.meadow);
      drawAudio(ctx, W, H, Math.min(1, audioT / 0.4),
        { volume, sel: audioSel, hover: hoverIdx, dim: false, muted });
      return;
    }
    // audio opened from the pause menu falls through: the frozen level
    // stays visible behind it, just like the pause screen itself

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

    const watching = state === 'replay' || state === 'replayEnd';
    drawHUD(ctx, W, H, {
      time,
      t: rt,
      got: burgers.filter(b => b.got).length,
      total: burgers.length,
      best,
      state,
      lives: watching ? null : lives,
      hasNext: hasNextLevel(),
      mapLabel: mapLabel(),
      replay: watching ? {
        label: (replayData && replayData.label) || level.name,
        done: state === 'replayEnd',
        outcome: replayOutcome,
      } : null,
      saveNote,
    });

    if (state === 'paused') {
      drawPause(ctx, W, H, pauseItems, pauseSel, hoverIdx);
    }
    if (state === 'audio') {
      drawAudio(ctx, W, H, Math.min(1, audioT / 0.4),
        { volume, sel: audioSel, hover: hoverIdx, dim: true, muted });
    }
  }

  requestAnimationFrame(frame);
})();
