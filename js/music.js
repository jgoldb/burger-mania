'use strict';

// Procedural chiptune soundtrack. Every visual world (a level's `theme`)
// has its own looping song, plus a title theme shared by the menu and
// difficulty screens and a somber theme for the continue screen. game.js
// owns the AudioContext and drives this module: MUSIC.init(AC) once, then
// MUSIC.play(name) with a song name (or null for silence) whenever the
// screen changes — switching songs crossfades.
//
// Songs are step-sequenced patterns, one token per eighth-note step:
// a note name ('C4', 'F#3', 'Bb2') starts a note, '~' sustains the
// previous note one more step, '.' is a rest and '|' is a readability
// bar separator. Drum voices use k(ick), s(nare) and h(at) instead of
// notes. A voice shorter than its song loops on its own length, so a
// one-bar drum groove can ride under an eight-bar melody.
const MUSIC = (function () {
  // ---------- song data ----------
  // adding a world to THEMES in render.js? give it a song here under the
  // same name, or its maps ride in silence
  const DEFS = {
    // title jingle: bouncy oom-pah in C major, burger-stand cheerful
    menu: {
      bpm: 132,
      voices: [
        { wave: 'square', vol: 0.038, pattern: [
          'E5 .  G5 .  C6 ~  G5 .', 'A5 .  C6 .  E6 ~  ~  .',
          'F5 .  A5 .  C6 ~  A5 .', 'G5 .  B5 .  D6 ~  ~  .',
          'E5 G5 C6 .  E6 .  D6 C6', 'A5 .  E6 .  C6 .  A5 .',
          'F5 A5 C6 .  B5 .  G5 .', 'C6 ~  ~  .  G5 .  E5 .',
        ] },
        // offbeat chord stabs, the "pah" of the oom-pah
        { wave: 'square', vol: 0.015, pattern: [
          '. E4 . E4 . E4 . E4', '. C5 . C5 . C5 . C5',
          '. A4 . A4 . A4 . A4', '. B4 . B4 . B4 . B4',
          '. E4 . E4 . E4 . E4', '. C5 . C5 . C5 . C5',
          '. A4 . A4 . B4 . B4', '. E4 . E4 . E4 . E4',
        ] },
        { wave: 'triangle', vol: 0.07, pattern: [
          'C3 . G3 . C3 . G3 .', 'A2 . E3 . A2 . E3 .',
          'F2 . C3 . F2 . C3 .', 'G2 . D3 . G2 . D3 .',
          'C3 . G3 . C3 . G3 .', 'A2 . E3 . A2 . E3 .',
          'F2 . C3 . G2 . D3 .', 'C3 . G3 . C3 G3 C4 .',
        ] },
        { drums: true, vol: 0.09, pattern: [
          'k . h . s . h h', 'k . h . s . h .',
          'k . h . s . h h', 'k . h . s . s s',
        ] },
      ],
    },
    // sunny meadow cruise: easy-rolling G major (Easy 1-5)
    meadow: {
      bpm: 112,
      voices: [
        { wave: 'square', vol: 0.03, pattern: [
          'B4 .  D5 .  G5 ~  D5 B4', 'E5 ~  G5 .  B5 ~  .  .',
          'C5 .  E5 .  G5 ~  E5 C5', 'D5 ~  F#5 . A5 ~  .  .',
          'G5 .  B5 .  D6 ~  B5 G5', 'B5 ~  G5 .  E5 ~  .  .',
          'C5 E5 G5 .  A5 G5 E5 .', 'D5 ~  F#5 A5 D6 ~  ~  .',
        ] },
        // rippling broken-chord accompaniment
        { wave: 'triangle', vol: 0.025, pattern: [
          'G3  B3 D4 B3 G3  B3 D4 B3', 'E3  G3 B3 G3 E3  G3 B3 G3',
          'G3  C4 E4 C4 G3  C4 E4 C4', 'F#3 A3 D4 A3 F#3 A3 D4 A3',
        ] },
        { wave: 'triangle', vol: 0.065, pattern: [
          'G2 ~ ~ ~ D3 ~ ~ ~', 'E2 ~ ~ ~ B2 ~ ~ ~',
          'C3 ~ ~ ~ G2 ~ ~ ~', 'D3 ~ ~ ~ A2 ~ ~ ~',
        ] },
        { drums: true, vol: 0.06, pattern: [
          'k . . h s . . h', 'k . k h s . h .',
        ] },
      ],
    },
    // volcano: galloping E minor under a wailing lead (Easy 6-10)
    volcano: {
      bpm: 138,
      voices: [
        { wave: 'square', vol: 0.04, pattern: [
          'E5 ~  ~  G5 F#5 ~  E5 ~', 'B4 ~  ~  .  E5  ~  G5 ~',
          'C5 ~  ~  E5 D5  ~  C5 ~', 'B4 ~  A4 ~  B4  ~  .  .',
          'E5 ~  ~  G5 A5  ~  B5 ~', 'C6 ~  B5 A5 G5  ~  E5 ~',
          'G5 ~  E5 ~  C5  ~  D5 ~', 'B4 ~  D#5 ~ F#5 ~  ~  .',
        ] },
        // offbeat ember pulse
        { wave: 'square', vol: 0.014, pattern: [
          '. E4 . E4 . E4 . E4', '. E4 . E4 . E4 . E4',
          '. E4 . E4 . E4 . E4', '. F#4 . F#4 . F#4 . F#4',
          '. E4 . E4 . E4 . E4', '. E4 . E4 . E4 . E4',
          '. E4 . E4 . E4 . E4', '. F#4 . F#4 . F#4 . F#4',
        ] },
        // root-fifth gallop
        { wave: 'sawtooth', vol: 0.028, pattern: [
          'E2 E2 B2 E2 E2 B2 E2 B2', 'E2 E2 B2 E2 E2 B2 E2 B2',
          'C3 C3 G3 C3 C3 G3 C3 G3', 'D3 D3 A3 D3 D3 A3 D3 A3',
          'E2 E2 B2 E2 E2 B2 E2 B2', 'E2 E2 B2 E2 E2 B2 E2 B2',
          'C3 C3 G3 C3 C3 G3 C3 G3', 'B2 B2 F#3 B2 B2 F#3 B2 F#3',
        ] },
        { drums: true, vol: 0.1, pattern: [
          'k . h . s . k h', 'k . h . s . h h',
          'k . h . s . k h', 'k . h k s . s s',
        ] },
      ],
    },
    // continue screen: slow G minor lament (it answers the G-minor death
    // sting goContinue() plays), no drums, just a dirge and far-off bells
    continue: {
      bpm: 76,
      voices: [
        { wave: 'triangle', vol: 0.05, pattern: [
          'G4  ~ ~   ~ Bb4 ~ A4 ~', 'G4  ~ Eb4 ~ ~   ~ .  .',
          'Eb4 ~ ~   ~ G4  ~ F4 ~', 'D4  ~ ~   ~ ~   ~ .  .',
          'D5  ~ ~   ~ C5  ~ Bb4 ~', 'Bb4 ~ G4  ~ Eb4 ~ ~  .',
          'C5  ~ Bb4 ~ G4  ~ A4 ~', 'A4  ~ F#4 ~ D4  ~ ~  .',
        ] },
        { wave: 'sine', vol: 0.09, pattern: [
          'G2 ~ ~ ~ ~ ~ ~ ~', 'Eb2 ~ ~ ~ ~ ~ ~ ~',
          'C3 ~ ~ ~ ~ ~ ~ ~', 'D3 ~ ~ ~ ~ ~ ~ ~',
        ] },
        { wave: 'sine', vol: 0.022, pattern: [
          '. . . .  . . . .', '. . . .  Bb5 ~ . .',
          '. . . .  . . . .', '. . D6 ~ . . . .',
          '. . . .  . . . .', '. . . .  G5 ~ . .',
          '. . . .  . . . .', '. . A5 ~ . . . .',
        ] },
      ],
    },
  };

  // ---------- pattern compilation (pure, runs at load) ----------
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function noteHz(tok) {
    const semi = SEMI[tok[0]] + (tok[1] === '#' ? 1 : tok[1] === 'b' ? -1 : 0);
    const oct = parseInt(tok[tok.length - 1], 10);
    return 440 * Math.pow(2, ((oct + 1) * 12 + semi - 69) / 12);
  }

  // bar strings -> per-step event array (null = nothing starts this step)
  function parsePattern(bars, drums) {
    const toks = bars.join(' ').split(/\s+/).filter(t => t && t !== '|');
    const at = new Array(toks.length).fill(null);
    let open = null;
    toks.forEach((tok, i) => {
      if (tok === '.') { open = null; return; }
      if (tok === '~') { if (open) open.len++; return; }
      open = drums ? { kind: tok, len: 1 } : { freq: noteHz(tok), len: 1 };
      at[i] = open;
    });
    return at;
  }

  const SONGS = {};
  for (const name of Object.keys(DEFS)) {
    const voices = DEFS[name].voices.map(v => ({
      wave: v.wave, vol: v.vol, drums: !!v.drums,
      at: parsePattern(v.pattern, !!v.drums),
    }));
    SONGS[name] = {
      bpm: DEFS[name].bpm,
      steps: Math.max(...voices.map(v => v.at.length)),
      voices,
    };
  }

  // ---------- synthesis ----------
  let AC = null, master = null, noiseBuf = null;
  let cur = null;   // { name, song, gain, step, nextT }
  let timer = null;
  let muted = false, ducked = false;

  function init(ac) {
    if (AC) return;
    AC = ac;
    master = AC.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function applyVolume() {
    if (!AC) return;
    master.gain.setTargetAtTime(muted ? 0 : ducked ? 0.35 : 1,
      AC.currentTime, 0.1);
  }
  function setMuted(m) { muted = m; applyVolume(); }
  // paused: keep the song going, just pulled back
  function duck(d) { if (d !== ducked) { ducked = d; applyVolume(); } }

  function note(dest, wave, freq, vol, t, dur) {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = wave;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    // pluck: sag toward 60% over the note, quick release at the end
    g.gain.setTargetAtTime(vol * 0.6, t + 0.012, Math.max(0.06, dur * 0.4));
    g.gain.setTargetAtTime(0, t + dur - 0.04, 0.025);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  function drumHit(dest, kind, vol, t) {
    if (kind === 'k') { // kick: sine drop
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.1);
      g.gain.setValueAtTime(vol * 1.6, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      o.connect(g);
      g.connect(dest);
      o.start(t);
      o.stop(t + 0.15);
      return;
    }
    const src = AC.createBufferSource(); // snare / hat: filtered noise
    src.buffer = noiseBuf;
    const f = AC.createBiquadFilter(), g = AC.createGain();
    if (kind === 's') {
      f.type = 'bandpass';
      f.frequency.value = 1800;
      f.Q.value = 0.8;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    } else { // 'h'
      f.type = 'highpass';
      f.frequency.value = 6200;
      g.gain.setValueAtTime(vol * 0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    }
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, 0, 0.2);
  }

  // ---------- sequencing ----------
  // lookahead scheduler: a coarse timer walks the step counter and books
  // every note due in the next LOOKAHEAD seconds at exact AudioContext time
  const LOOKAHEAD = 0.18, TICK_MS = 45;

  function tick() {
    if (!cur) {
      clearInterval(timer);
      timer = null;
      return;
    }
    const spb = 60 / cur.song.bpm / 2; // step length: an eighth note
    // a throttled background tab can leave us behind; skip ahead silently
    while (cur.nextT < AC.currentTime - 0.02) {
      cur.step = (cur.step + 1) % cur.song.steps;
      cur.nextT += spb;
    }
    while (cur.nextT < AC.currentTime + LOOKAHEAD) {
      for (const v of cur.song.voices) {
        const ev = v.at[cur.step % v.at.length];
        if (!ev) continue;
        if (v.drums) drumHit(cur.gain, ev.kind, v.vol, cur.nextT);
        else note(cur.gain, v.wave, ev.freq, v.vol, cur.nextT, ev.len * spb);
      }
      cur.step = (cur.step + 1) % cur.song.steps;
      cur.nextT += spb;
    }
  }

  // crossfades to the named song; null (or an unknown world) fades to
  // silence. Calling it every frame is fine: same song is a no-op.
  function play(name) {
    if (!AC) return;
    if (!SONGS[name]) name = null;
    if (cur === null && name === null) return;
    if (cur && cur.name === name) return;
    if (cur) {
      const g = cur.gain; // notes already booked ride the fade out
      g.gain.setTargetAtTime(0, AC.currentTime, 0.18);
      setTimeout(() => g.disconnect(), 1200);
      cur = null;
    }
    if (!name) return;
    const gain = AC.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, AC.currentTime, 0.25);
    gain.connect(master);
    cur = { name, song: SONGS[name], gain, step: 0, nextT: AC.currentTime + 0.08 };
    tick();
    if (!timer) timer = setInterval(tick, TICK_MS);
  }

  return { init, play, duck, setMuted, songs: SONGS };
})();
