'use strict';

// Procedural chiptune soundtrack. Every visual world (a level's `theme`)
// has its own looping song, plus a title theme shared by the menu and
// difficulty screens and a somber theme for the continue screen. game.js
// owns the AudioContext and drives this module: MUSIC.init(AC, dest) once
// (dest is the gain the music slider controls; defaults to the speakers), then
// MUSIC.play(name) with a song name (or null for silence) whenever the
// screen changes — switching songs crossfades.
//
// Songs are step-sequenced patterns, one token per eighth-note step:
// a note name ('C4', 'F#3', 'Bb2') starts a note, '~' sustains the
// previous note one more step, '.' is a rest and '|' is a readability
// bar separator. Drum voices use k(ick), s(nare) and h(at) instead of
// notes. A voice shorter than its song loops on its own length, so a
// one-bar drum groove can ride under an eight-bar melody.
//
// The in-world level songs (meadow, volcano) run 32 bars. First a 16-bar
// arc: theme (1-8) -> variation (9-12) -> breakdown that thins out and a
// snare-roll build (13-14) -> a hard DROP (15-16) where the kick goes
// four-on-the-floor and a gritty sub-bass slams in. Then a long 16-bar
// synthwave coda (17-32): the energy settles into a hypnotic octave-pulse
// bass, sustained pad chords, a shimmering arpeggio and a dreamy lead
// floating over a laid-back backbeat, cruising a while before it all loops
// back to the theme. (The menu jingle keeps just the 16-bar arc; the
// continue dirge stays drumless and only deepens harmonically — a death
// screen shouldn't bang; the victory jingle is its own 16-bar fanfare
// for the track-cleared feast.) Voices that change between sections span the
// whole song so they don't just repeat; a couple stay silent until their
// section and bloom in.
const MUSIC = (function () {
  // ---------- song data ----------
  // adding a world to THEMES in render.js? give it a song here under the
  // same name, or its maps ride in silence
  const DEFS = {
    // title jingle: bouncy oom-pah in C major, burger-stand cheerful,
    // that breaks into a four-on-the-floor drop before looping
    menu: {
      bpm: 132,
      voices: [
        { wave: 'square', vol: 0.038, pattern: [
          // theme
          'E5 .  G5 .  C6 ~  G5 .', 'A5 .  C6 .  E6 ~  ~  .',
          'F5 .  A5 .  C6 ~  A5 .', 'G5 .  B5 .  D6 ~  ~  .',
          'E5 G5 C6 .  E6 .  D6 C6', 'A5 .  E6 .  C6 .  A5 .',
          'F5 A5 C6 .  B5 .  G5 .', 'C6 ~  ~  .  G5 .  E5 .',
          // variation: brighter, climbing
          'G5 .  C6 D6 E6 ~  D6 C6', 'F5 .  A5 C6 F6 ~  E6 D6',
          'E6 .  C6 .  G5 .  E5 .', 'D6 ~  G5 .  B5 D6 G6 ~',
          // breakdown + rising run
          'C6 ~  ~  ~  .  .  .  .', '.  .  G5 A5 B5 C6 D6 E6',
          // drop: melody slams in octave hits
          'C6 ~  C6 ~  E6 ~  G6 ~', 'E6 ~  C6 ~  G5 ~  C6 ~',
        ] },
        // offbeat chord stabs, the "pah" of the oom-pah; goes silent in
        // the breakdown and pounds on the beat through the drop
        { wave: 'square', vol: 0.015, pattern: [
          '. E4 . E4 . E4 . E4', '. C5 . C5 . C5 . C5',
          '. A4 . A4 . A4 . A4', '. B4 . B4 . B4 . B4',
          '. E4 . E4 . E4 . E4', '. C5 . C5 . C5 . C5',
          '. A4 . A4 . B4 . B4', '. E4 . E4 . E4 . E4',
          '. G4 . G4 . G4 . G4', '. A4 . A4 . C5 . C5',
          '. G4 . G4 . E4 . E4', '. D5 . D5 . B4 . G4',
          '. . . . . . . .', '. . . . . . . .',
          'C5 C5 C5 C5 C5 C5 C5 C5', 'G4 G4 G4 G4 C5 C5 C5 C5',
        ] },
        { wave: 'triangle', vol: 0.07, pattern: [
          'C3 . G3 . C3 . G3 .', 'A2 . E3 . A2 . E3 .',
          'F2 . C3 . F2 . C3 .', 'G2 . D3 . G2 . D3 .',
          'C3 . G3 . C3 . G3 .', 'A2 . E3 . A2 . E3 .',
          'F2 . C3 . G2 . D3 .', 'C3 . G3 . C3 G3 C4 .',
          'C3 . G3 . E3 . C3 .', 'F2 . C3 . A3 . F3 .',
          'C3 . G3 . E3 . G3 .', 'G2 . D3 . G3 . D3 .',
          // breakdown: held root, then a pulsing pickup into the drop
          'C3 ~ ~ ~ ~ ~ ~ ~', 'G2 ~ ~ ~ G2 ~ G2 G2',
          // drop: pounding root-fifth eighths
          'C3 C3 C3 C3 G3 G3 G3 G3', 'C3 C3 G2 G2 C3 C3 G3 C4',
        ] },
        { drums: true, vol: 0.09, pattern: [
          'k . h . s . h h', 'k . h . s . h .',
          'k . h . s . h h', 'k . h . s . s s',
          'k . h . s . h h', 'k . h . s . h .',
          'k . h . s . h h', 'k . h . s . s s',
          // variation: busier
          'k . h k s . h h', 'k . h . s . h .',
          'k . h k s . h h', 'k k h . s . s s',
          // breakdown (sparse hats) then a snare-roll build
          '. . h . . . h .', 's . s s s s s s',
          // drop: four-on-the-floor with a fill back to the top
          'k . k . k . k .', 'k . k . k k s s',
        ] },
        // sub-bass that's silent until the drop, then slams the root
        { wave: 'sawtooth', vol: 0.045, pattern: [
          ...Array(14).fill('. . . . . . . .'),
          'C2 ~ ~ ~ ~ ~ ~ ~', 'C2 ~ ~ ~ G2 ~ ~ ~',
        ] },
      ],
    },
    // sunny meadow cruise: easy-rolling G major (Beginner 1-5) that lifts into
    // a soaring variation, an anthemic drop, then a long dreamy synthwave
    // coda that cruises a while before looping back to the top
    meadow: {
      bpm: 112,
      voices: [
        { wave: 'square', vol: 0.03, pattern: [
          // theme
          'B4 .  D5 .  G5 ~  D5 B4', 'E5 ~  G5 .  B5 ~  .  .',
          'C5 .  E5 .  G5 ~  E5 C5', 'D5 ~  F#5 . A5 ~  .  .',
          'G5 .  B5 .  D6 ~  B5 G5', 'B5 ~  G5 .  E5 ~  .  .',
          'C5 E5 G5 .  A5 G5 E5 .', 'D5 ~  F#5 A5 D6 ~  ~  .',
          // variation: soaring B section
          'E5 .  G5 .  B5 ~  G5 E5', 'A5 ~  B5 .  D6 ~  B5 .',
          'C6 .  B5 .  A5 ~  G5 .', 'F#5 . A5 .  D6 ~  C6 A5',
          // breakdown + rising run
          'G5 ~  ~  ~  D5 ~  ~  .', '.  D5 E5 F#5 G5 A5 B5 C6',
          // drop: anthemic sustained hits
          'D6 ~  ~  B5 G5 ~  ~  D5', 'G5 ~  D6 ~  B5 ~  G5 ~',
          // synthwave coda: a dreamy lead floating over the cruise
          'D5 ~ ~ ~ B4 ~ ~ ~', 'A4 ~ ~ ~ F#5 ~ ~ ~',
          'G5 ~ ~ ~ E5 ~ ~ ~', 'E5 ~ ~ ~ G5 ~ ~ ~',
          'B5 ~ ~ A5 G5 ~ ~ D5', 'F#5 ~ ~ ~ A5 ~ ~ ~',
          'B5 ~ ~ G5 E5 ~ ~ ~', 'C6 ~ ~ ~ B5 ~ G5 ~',
          'E6 ~ ~ ~ D6 ~ B5 ~', 'C6 ~ ~ ~ G5 ~ ~ ~',
          'D6 ~ ~ B5 G5 ~ ~ ~', 'A5 ~ ~ ~ F#5 ~ A5 ~',
          'G5 ~ ~ ~ B5 ~ ~ ~', 'E5 ~ ~ ~ G5 ~ ~ ~',
          'D5 ~ ~ ~ B4 ~ D5 ~', 'A4 ~ ~ ~ D5 ~ ~ .',
        ] },
        // rippling broken-chord accompaniment; drops out in the breakdown
        // and drives hard under the drop
        { wave: 'triangle', vol: 0.025, pattern: [
          'G3  B3 D4 B3 G3  B3 D4 B3', 'E3  G3 B3 G3 E3  G3 B3 G3',
          'G3  C4 E4 C4 G3  C4 E4 C4', 'F#3 A3 D4 A3 F#3 A3 D4 A3',
          'G3  B3 D4 B3 G3  B3 D4 B3', 'E3  G3 B3 G3 E3  G3 B3 G3',
          'G3  C4 E4 C4 G3  C4 E4 C4', 'F#3 A3 D4 A3 F#3 A3 D4 A3',
          'E3  G3 B3 G3 E3  G3 B3 G3', 'D3  F#3 A3 F#3 D3 F#3 A3 F#3',
          'C3  E3 G3 E3 C3  E3 G3 E3', 'D3  F#3 A3 F#3 D3 F#3 A3 C4',
          '. . . . . . . .', '. . . . . . . .',
          'G3 B3 D4 G4 D4 B3 G3 B3', 'G3 B3 D4 G4 B4 G4 D4 B3',
          // synthwave coda: long sustained pad chords (the wash)
          'D5 ~ ~ ~ ~ ~ ~ ~', 'A4 ~ ~ ~ ~ ~ ~ ~',
          'B4 ~ ~ ~ ~ ~ ~ ~', 'G4 ~ ~ ~ ~ ~ ~ ~',
          'D5 ~ ~ ~ ~ ~ ~ ~', 'A4 ~ ~ ~ ~ ~ ~ ~',
          'B4 ~ ~ ~ ~ ~ ~ ~', 'G4 ~ ~ ~ ~ ~ ~ ~',
          'E5 ~ ~ ~ ~ ~ ~ ~', 'G4 ~ ~ ~ ~ ~ ~ ~',
          'D5 ~ ~ ~ ~ ~ ~ ~', 'A4 ~ ~ ~ ~ ~ ~ ~',
          'B4 ~ ~ ~ ~ ~ ~ ~', 'G4 ~ ~ ~ ~ ~ ~ ~',
          'D5 ~ ~ ~ ~ ~ ~ ~', 'F#5 ~ ~ ~ ~ ~ ~ ~',
        ] },
        { wave: 'triangle', vol: 0.065, pattern: [
          'G2 ~ ~ ~ D3 ~ ~ ~', 'E2 ~ ~ ~ B2 ~ ~ ~',
          'C3 ~ ~ ~ G2 ~ ~ ~', 'D3 ~ ~ ~ A2 ~ ~ ~',
          'G2 ~ ~ ~ D3 ~ ~ ~', 'E2 ~ ~ ~ B2 ~ ~ ~',
          'C3 ~ ~ ~ G2 ~ ~ ~', 'D3 ~ ~ ~ A2 ~ ~ ~',
          'E2 ~ ~ ~ B2 ~ ~ ~', 'D3 ~ ~ ~ A2 ~ ~ ~',
          'C3 ~ ~ ~ G2 ~ ~ ~', 'D3 ~ ~ ~ A2 ~ C3 ~',
          // breakdown: held root, then pulse into the drop
          'G2 ~ ~ ~ ~ ~ ~ ~', 'D3 ~ ~ ~ D3 ~ D3 D3',
          // drop: driving eighths
          'G2 G2 G2 G2 D3 D3 D3 D3', 'G2 G2 D3 D3 G2 G2 D3 G3',
          // synthwave coda: hypnotic octave-pulse bass
          'G2 ~ G3 ~ G2 ~ G3 ~', 'D2 ~ D3 ~ D2 ~ D3 ~',
          'E2 ~ E3 ~ E2 ~ E3 ~', 'C2 ~ C3 ~ C2 ~ C3 ~',
          'G2 ~ G3 ~ G2 ~ G3 ~', 'D2 ~ D3 ~ D2 ~ D3 ~',
          'E2 ~ E3 ~ E2 ~ E3 ~', 'C2 ~ C3 ~ C2 ~ C3 ~',
          'E2 ~ E3 ~ E2 ~ E3 ~', 'C2 ~ C3 ~ C2 ~ C3 ~',
          'G2 ~ G3 ~ G2 ~ G3 ~', 'D2 ~ D3 ~ D2 ~ D3 ~',
          'E2 ~ E3 ~ E2 ~ E3 ~', 'C2 ~ C3 ~ C2 ~ C3 ~',
          'G2 ~ G3 ~ G2 ~ G3 ~', 'D2 ~ D3 ~ D2 ~ A2 ~',
        ] },
        { drums: true, vol: 0.06, pattern: [
          'k . . h s . . h', 'k . k h s . h .',
          'k . . h s . . h', 'k . k h s . h .',
          'k . . h s . . h', 'k . k h s . h .',
          'k . . h s . . h', 'k . k h s . h .',
          // variation: busier
          'k . . h s . k h', 'k . k h s . h h',
          'k . . h s . k h', 'k . k h s . s s',
          // breakdown (sparse) then a snare-roll build
          '. . h . . . h .', 's . s . s s s s',
          // drop: four-on-the-floor with a fill back to the top
          'k . k . k . k .', 'k . k . k k s s',
          // synthwave coda: laid-back backbeat (opens up, then settles)
          'k . . . s . . .', 'k h s h k h s h',
          'k h s h k h s h', 'k h s h k h s s',
          'k h s h k h s h', 'k h s h k h s h',
          'k h s h k h s h', 'k h s h k h s s',
          'k h s h k h s h', 'k h s h k h s h',
          'k h s h k h s h', 'k h s h k h s s',
          'k h s h k h s h', 'k h s h k h s h',
          'k h s h k h s h', 'k h s h s s s s',
        ] },
        // gritty sub-bass: slams the drop, then holds warm sub-roots under
        // the synthwave coda
        { wave: 'sawtooth', vol: 0.04, pattern: [
          ...Array(14).fill('. . . . . . . .'),
          'G2 ~ ~ ~ ~ ~ ~ ~', 'G2 ~ ~ ~ D3 ~ ~ ~',
          // synthwave coda: warm whole-bar sub roots
          'G1 ~ ~ ~ ~ ~ ~ ~', 'D2 ~ ~ ~ ~ ~ ~ ~',
          'E1 ~ ~ ~ ~ ~ ~ ~', 'C2 ~ ~ ~ ~ ~ ~ ~',
          'G1 ~ ~ ~ ~ ~ ~ ~', 'D2 ~ ~ ~ ~ ~ ~ ~',
          'E1 ~ ~ ~ ~ ~ ~ ~', 'C2 ~ ~ ~ ~ ~ ~ ~',
          'E1 ~ ~ ~ ~ ~ ~ ~', 'C2 ~ ~ ~ ~ ~ ~ ~',
          'G1 ~ ~ ~ ~ ~ ~ ~', 'D2 ~ ~ ~ ~ ~ ~ ~',
          'E1 ~ ~ ~ ~ ~ ~ ~', 'C2 ~ ~ ~ ~ ~ ~ ~',
          'G1 ~ ~ ~ ~ ~ ~ ~', 'D2 ~ ~ ~ ~ ~ ~ ~',
        ] },
        // shimmering arpeggio: silent until the synthwave coda, then runs
        // up-and-down through each chord — the coda's signature synth
        { wave: 'sawtooth', vol: 0.02, pattern: [
          ...Array(16).fill('. . . . . . . .'),
          'G4 B4 D5 G5 D5 B4 G4 B4', 'D4 F#4 A4 D5 A4 F#4 D4 F#4',
          'E4 G4 B4 E5 B4 G4 E4 G4', 'C4 E4 G4 C5 G4 E4 C4 E4',
          'G4 B4 D5 G5 D5 B4 G4 B4', 'D4 F#4 A4 D5 A4 F#4 D4 F#4',
          'E4 G4 B4 E5 B4 G4 E4 G4', 'C4 E4 G4 C5 G4 E4 C4 E4',
          'E4 G4 B4 E5 B4 G4 E4 G4', 'C4 E4 G4 C5 G4 E4 C4 E4',
          'G4 B4 D5 G5 D5 B4 G4 B4', 'D4 F#4 A4 D5 A4 F#4 D4 F#4',
          'E4 G4 B4 E5 B4 G4 E4 G4', 'C4 E4 G4 C5 G4 E4 C4 E4',
          'G4 B4 D5 G5 D5 B4 G4 B4', 'D4 F#4 A4 D5 A4 F#4 D4 F#4',
        ] },
      ],
    },
    // volcano: galloping E minor under a wailing lead (Beginner 6-10); the
    // gallop cuts out for a breakdown, then the heaviest drop in the game,
    // and finally a long midnight-outrun synthwave coda before it loops
    volcano: {
      bpm: 138,
      voices: [
        { wave: 'square', vol: 0.04, pattern: [
          // theme
          'E5 ~  ~  G5 F#5 ~  E5 ~', 'B4 ~  ~  .  E5  ~  G5 ~',
          'C5 ~  ~  E5 D5  ~  C5 ~', 'B4 ~  A4 ~  B4  ~  .  .',
          'E5 ~  ~  G5 A5  ~  B5 ~', 'C6 ~  B5 A5 G5  ~  E5 ~',
          'G5 ~  E5 ~  C5  ~  D5 ~', 'B4 ~  D#5 ~ F#5 ~  ~  .',
          // variation: frenzied wail, higher
          'B5 ~  A5 G5 A5 ~  B5 ~', 'E6 ~  ~  D6 B5 ~  G5 ~',
          'C6 ~  B5 ~  A5 ~  G5 ~', 'F#5 ~ G5 A5 B5 ~  D6 ~',
          // breakdown: lone wail, space, then a fast rising run
          'E5 ~  ~  ~  B4 ~  ~  .', 'B4 ~  D5 E5 G5 A5 B5 D6',
          // drop: screaming lead over the pounding
          'E6 ~  ~  ~  D6 ~  B5 ~', 'E6 ~  D6 B5 G5 ~  E5 ~',
          // synthwave coda: a longing lead drifting over the night-cruise
          'B5 ~ ~ ~ G5 ~ ~ ~', 'E5 ~ ~ ~ G5 ~ ~ ~',
          'D5 ~ ~ ~ B4 ~ ~ ~', 'F#5 ~ ~ ~ A5 ~ ~ ~',
          'E5 ~ ~ G5 B5 ~ ~ ~', 'G5 ~ ~ ~ E5 ~ ~ ~',
          'D5 ~ ~ ~ G5 ~ B5 ~', 'A5 ~ ~ F#5 D5 ~ ~ ~',
          'C6 ~ ~ ~ A5 ~ ~ ~', 'B5 ~ ~ ~ G5 ~ ~ ~',
          'E6 ~ ~ D6 B5 ~ ~ ~', 'F#5 ~ ~ ~ D#5 ~ ~ ~',
          'A5 ~ ~ ~ C6 ~ ~ ~', 'G5 ~ ~ ~ E5 ~ ~ ~',
          'F#5 ~ ~ ~ A5 ~ ~ ~', 'D#5 ~ ~ ~ F#5 ~ ~ .',
        ] },
        // offbeat ember pulse; cuts in the breakdown, hammers in the drop
        { wave: 'square', vol: 0.014, pattern: [
          '. E4 . E4 . E4 . E4', '. E4 . E4 . E4 . E4',
          '. E4 . E4 . E4 . E4', '. F#4 . F#4 . F#4 . F#4',
          '. E4 . E4 . E4 . E4', '. E4 . E4 . E4 . E4',
          '. E4 . E4 . E4 . E4', '. F#4 . F#4 . F#4 . F#4',
          '. G4 . G4 . G4 . G4', '. E4 . E4 . E4 . E4',
          '. A4 . A4 . A4 . A4', '. B4 . B4 . B4 . B4',
          '. . . . . . . .', '. . . . . . . .',
          'E4 E4 E4 E4 E4 E4 E4 E4', 'E4 E4 E4 E4 B4 B4 B4 B4',
          // synthwave coda: sustained pad chords glowing under the lead
          'B4 ~ ~ ~ ~ ~ ~ ~', 'G4 ~ ~ ~ ~ ~ ~ ~',
          'D5 ~ ~ ~ ~ ~ ~ ~', 'A4 ~ ~ ~ ~ ~ ~ ~',
          'B4 ~ ~ ~ ~ ~ ~ ~', 'G4 ~ ~ ~ ~ ~ ~ ~',
          'D5 ~ ~ ~ ~ ~ ~ ~', 'A4 ~ ~ ~ ~ ~ ~ ~',
          'E5 ~ ~ ~ ~ ~ ~ ~', 'G4 ~ ~ ~ ~ ~ ~ ~',
          'B4 ~ ~ ~ ~ ~ ~ ~', 'F#5 ~ ~ ~ ~ ~ ~ ~',
          'E5 ~ ~ ~ ~ ~ ~ ~', 'G4 ~ ~ ~ ~ ~ ~ ~',
          'A4 ~ ~ ~ ~ ~ ~ ~', 'F#5 ~ ~ ~ ~ ~ ~ ~',
        ] },
        // root-fifth gallop; it stops dead for the breakdown then revs up
        { wave: 'sawtooth', vol: 0.028, pattern: [
          'E2 E2 B2 E2 E2 B2 E2 B2', 'E2 E2 B2 E2 E2 B2 E2 B2',
          'C3 C3 G3 C3 C3 G3 C3 G3', 'D3 D3 A3 D3 D3 A3 D3 A3',
          'E2 E2 B2 E2 E2 B2 E2 B2', 'E2 E2 B2 E2 E2 B2 E2 B2',
          'C3 C3 G3 C3 C3 G3 C3 G3', 'B2 B2 F#3 B2 B2 F#3 B2 F#3',
          'A2 A2 E3 A2 A2 E3 A2 E3', 'E2 E2 B2 E2 E2 B2 E2 B2',
          'C3 C3 G3 C3 C3 G3 C3 G3', 'B2 B2 F#3 B2 B2 F#3 B2 F#3',
          // breakdown: gallop drops to a held root, then revs back up
          'E2 ~ ~ ~ ~ ~ ~ ~', 'E2 ~ ~ ~ E2 E2 E2 E2',
          // drop: relentless, heavier straight eighths
          'E2 E2 E2 E2 B2 B2 B2 B2', 'E2 E2 B2 E2 G2 G2 D3 D3',
          // synthwave coda: the gallop becomes a hypnotic octave pulse
          'E2 ~ E3 ~ E2 ~ E3 ~', 'C2 ~ C3 ~ C2 ~ C3 ~',
          'G2 ~ G3 ~ G2 ~ G3 ~', 'D2 ~ D3 ~ D2 ~ D3 ~',
          'E2 ~ E3 ~ E2 ~ E3 ~', 'C2 ~ C3 ~ C2 ~ C3 ~',
          'G2 ~ G3 ~ G2 ~ G3 ~', 'D2 ~ D3 ~ D2 ~ D3 ~',
          'A2 ~ A3 ~ A2 ~ A3 ~', 'C2 ~ C3 ~ C2 ~ C3 ~',
          'E2 ~ E3 ~ E2 ~ E3 ~', 'B1 ~ B2 ~ B1 ~ B2 ~',
          'A2 ~ A3 ~ A2 ~ A3 ~', 'C2 ~ C3 ~ C2 ~ C3 ~',
          'D2 ~ D3 ~ D2 ~ D3 ~', 'B1 ~ B2 ~ F#2 ~ F#2 ~',
        ] },
        { drums: true, vol: 0.1, pattern: [
          'k . h . s . k h', 'k . h . s . h h',
          'k . h . s . k h', 'k . h k s . s s',
          'k . h . s . k h', 'k . h . s . h h',
          'k . h . s . k h', 'k . h k s . s s',
          // variation: double kicks
          'k k h . s . k h', 'k . h . s k h h',
          'k k h . s . k h', 'k . k k s . s s',
          // breakdown: lone kick in vast space, then a snare roll
          'k . . . . . . .', 's . s . s s s s',
          // drop: pounding double-kick groove with a huge fill
          'k . k k k . k k', 'k k k k s s s s',
          // synthwave coda: laid-back backbeat (opens up, then settles)
          'k . . . s . . .', 'k h s h k h s h',
          'k h s h k h s h', 'k h s h k h s s',
          'k h s h k h s h', 'k h s h k h s h',
          'k h s h k h s h', 'k h s h k h s s',
          'k h s h k h s h', 'k h s h k h s h',
          'k h s h k h s h', 'k h s h k h s s',
          'k h s h k h s h', 'k h s h k h s h',
          'k h s h k h s h', 'k h s h s s s s',
        ] },
        // deep sub-bass (E1, ~41Hz): slams the drop, then holds warm
        // sub-roots under the synthwave coda
        { wave: 'sawtooth', vol: 0.06, pattern: [
          ...Array(14).fill('. . . . . . . .'),
          'E1 ~ ~ ~ ~ ~ ~ ~', 'E1 ~ ~ ~ B1 ~ ~ ~',
          // synthwave coda: warm whole-bar sub roots
          'E1 ~ ~ ~ ~ ~ ~ ~', 'C2 ~ ~ ~ ~ ~ ~ ~',
          'G1 ~ ~ ~ ~ ~ ~ ~', 'D2 ~ ~ ~ ~ ~ ~ ~',
          'E1 ~ ~ ~ ~ ~ ~ ~', 'C2 ~ ~ ~ ~ ~ ~ ~',
          'G1 ~ ~ ~ ~ ~ ~ ~', 'D2 ~ ~ ~ ~ ~ ~ ~',
          'A1 ~ ~ ~ ~ ~ ~ ~', 'C2 ~ ~ ~ ~ ~ ~ ~',
          'E1 ~ ~ ~ ~ ~ ~ ~', 'B1 ~ ~ ~ ~ ~ ~ ~',
          'A1 ~ ~ ~ ~ ~ ~ ~', 'C2 ~ ~ ~ ~ ~ ~ ~',
          'D2 ~ ~ ~ ~ ~ ~ ~', 'B1 ~ ~ ~ ~ ~ ~ ~',
        ] },
        // shimmering arpeggio: silent until the synthwave coda, then runs
        // up-and-down through each chord — the coda's signature synth
        { wave: 'sawtooth', vol: 0.02, pattern: [
          ...Array(16).fill('. . . . . . . .'),
          'E4 G4 B4 E5 B4 G4 E4 G4', 'C4 E4 G4 C5 G4 E4 C4 E4',
          'G4 B4 D5 G5 D5 B4 G4 B4', 'D4 F#4 A4 D5 A4 F#4 D4 F#4',
          'E4 G4 B4 E5 B4 G4 E4 G4', 'C4 E4 G4 C5 G4 E4 C4 E4',
          'G4 B4 D5 G5 D5 B4 G4 B4', 'D4 F#4 A4 D5 A4 F#4 D4 F#4',
          'A3 C4 E4 A4 E4 C4 A3 C4', 'C4 E4 G4 C5 G4 E4 C4 E4',
          'E4 G4 B4 E5 B4 G4 E4 G4', 'B3 D#4 F#4 B4 F#4 D#4 B3 D#4',
          'A3 C4 E4 A4 E4 C4 A3 C4', 'C4 E4 G4 C5 G4 E4 C4 E4',
          'D4 F#4 A4 D5 A4 F#4 D4 F#4', 'B3 D#4 F#4 B4 F#4 D#4 B3 D#4',
        ] },
      ],
    },
    // gym: a pumped-up A-minor house anthem (Map-Editor world). Driving
    // four-on-the-floor with a clap backbeat under a bright pluck lead and
    // an uplifting Am-F-C-G loop; same 32-bar arc as the cruise songs —
    // theme -> soaring variation -> snare-build breakdown -> a hands-up DROP
    // -> a long euphoric coda that pumps an octave-pulse bass under a
    // shimmering arp before looping. Two drum voices (four-on-floor kick+hat
    // and a clap backbeat) make the groove thump harder than the field songs.
    gym: {
      bpm: 128,
      voices: [
        // bright pluck lead
        { wave: 'square', vol: 0.034, pattern: [
          // theme: Am F C G x2
          'A4 .  C5 .  E5 ~  C5 A4', 'F4 .  A4 .  C5 ~  A4 .',
          'G4 .  C5 .  E5 ~  C5 G4', 'G4 .  B4 .  D5 ~  B4 .',
          'A4 C5 E5 .  A5 .  G5 E5', 'F5 .  C5 .  A4 ~  F4 .',
          'E5 G5 C5 .  G4 .  E4 .', 'D5 ~  B4 G4 D5 ~  ~  .',
          // variation: soaring, higher
          'D5 .  F5 .  A5 ~  F5 D5', 'C5 .  A4 .  F5 ~  C5 .',
          'E5 .  G5 .  C6 ~  G5 E5', 'D5 .  G5 .  B5 ~  D6 ~',
          // breakdown + rising run
          'A5 ~  ~  ~  E5 ~  ~  .', '.  E5 F5 G5 A5 B5 C6 D6',
          // drop: hands-up anthem hits
          'A5 ~  ~  E5 C5 ~  ~  A4', 'E5 ~  A5 ~  C6 ~  A5 ~',
          // euphoric coda: a floating lead over the pump
          'E5 ~ ~ ~ C5 ~ ~ ~', 'A4 ~ ~ ~ F5 ~ ~ ~',
          'G4 ~ ~ ~ E5 ~ ~ ~', 'D5 ~ ~ ~ B4 ~ ~ ~',
          'C5 ~ ~ A4 E5 ~ ~ ~', 'A4 ~ ~ ~ C5 ~ ~ ~',
          'E5 ~ ~ C5 G5 ~ ~ ~', 'D5 ~ ~ ~ B4 ~ D5 ~',
          'A5 ~ ~ ~ E5 ~ C5 ~', 'F5 ~ ~ ~ A5 ~ ~ ~',
          'G5 ~ ~ E5 C5 ~ ~ ~', 'B4 ~ ~ ~ D5 ~ G5 ~',
          'E5 ~ ~ ~ A4 ~ ~ ~', 'F5 ~ ~ ~ C5 ~ ~ ~',
          'E5 ~ ~ ~ G5 ~ ~ ~', 'D5 ~ ~ ~ G4 ~ ~ .',
        ] },
        // offbeat house chord stabs; silent in the breakdown, on-beat power
        // stabs in the drop, sustained pad chords in the coda
        { wave: 'square', vol: 0.015, pattern: [
          '. A4 . C5 . E4 . A4', '. A4 . C5 . F4 . A4',
          '. G4 . C5 . E4 . G4', '. B4 . D5 . G4 . B4',
          '. A4 . C5 . E4 . A4', '. A4 . C5 . F4 . A4',
          '. G4 . C5 . E4 . G4', '. B4 . D5 . G4 . D5',
          '. A4 . D5 . F4 . A4', '. A4 . C5 . F4 . A4',
          '. G4 . E5 . C5 . G4', '. B4 . D5 . G4 . D5',
          '. . . . . . . .', '. . . . . . . .',
          'A4 ~ A4 ~ E4 ~ A4 ~', 'E4 ~ A4 ~ C5 ~ E5 ~',
          // coda pad chords
          'C5 ~ ~ ~ ~ ~ ~ ~', 'A4 ~ ~ ~ ~ ~ ~ ~',
          'E5 ~ ~ ~ ~ ~ ~ ~', 'D5 ~ ~ ~ ~ ~ ~ ~',
          'C5 ~ ~ ~ ~ ~ ~ ~', 'A4 ~ ~ ~ ~ ~ ~ ~',
          'E5 ~ ~ ~ ~ ~ ~ ~', 'D5 ~ ~ ~ ~ ~ ~ ~',
          'C5 ~ ~ ~ ~ ~ ~ ~', 'A4 ~ ~ ~ ~ ~ ~ ~',
          'E5 ~ ~ ~ ~ ~ ~ ~', 'D5 ~ ~ ~ ~ ~ ~ ~',
          'C5 ~ ~ ~ ~ ~ ~ ~', 'A4 ~ ~ ~ ~ ~ ~ ~',
          'E5 ~ ~ ~ ~ ~ ~ ~', 'D5 ~ ~ ~ ~ ~ ~ ~',
        ] },
        // pumping octave-pulse bass — house from the very first bar
        { wave: 'triangle', vol: 0.062, pattern: [
          'A1 ~ A2 ~ A1 ~ A2 ~', 'F1 ~ F2 ~ F1 ~ F2 ~',
          'C2 ~ C3 ~ C2 ~ C3 ~', 'G1 ~ G2 ~ G1 ~ G2 ~',
          'A1 ~ A2 ~ A1 ~ A2 ~', 'F1 ~ F2 ~ F1 ~ F2 ~',
          'C2 ~ C3 ~ C2 ~ C3 ~', 'G1 ~ G2 ~ G1 ~ G2 ~',
          'D2 ~ D3 ~ D2 ~ D3 ~', 'F1 ~ F2 ~ F1 ~ F2 ~',
          'C2 ~ C3 ~ C2 ~ C3 ~', 'G1 ~ G2 ~ G1 ~ G2 ~',
          // breakdown: held root, then a pulse into the drop
          'A1 ~ ~ ~ ~ ~ ~ ~', 'E2 ~ ~ ~ E2 ~ E2 E2',
          // drop: relentless straight eighths
          'A1 A1 A1 A1 E2 E2 E2 E2', 'A1 A1 E2 E2 A1 A1 C2 E2',
          // coda: the hypnotic octave pulse
          'A1 ~ A2 ~ A1 ~ A2 ~', 'F1 ~ F2 ~ F1 ~ F2 ~',
          'C2 ~ C3 ~ C2 ~ C3 ~', 'G1 ~ G2 ~ G1 ~ G2 ~',
          'A1 ~ A2 ~ A1 ~ A2 ~', 'F1 ~ F2 ~ F1 ~ F2 ~',
          'C2 ~ C3 ~ C2 ~ C3 ~', 'G1 ~ G2 ~ G1 ~ G2 ~',
          'A1 ~ A2 ~ A1 ~ A2 ~', 'F1 ~ F2 ~ F1 ~ F2 ~',
          'C2 ~ C3 ~ C2 ~ C3 ~', 'G1 ~ G2 ~ G1 ~ G2 ~',
          'A1 ~ A2 ~ A1 ~ A2 ~', 'F1 ~ F2 ~ F1 ~ F2 ~',
          'C2 ~ C3 ~ C2 ~ C3 ~', 'G1 ~ G2 ~ G1 ~ E2 ~',
        ] },
        // four-on-the-floor kick with offbeat hats
        { drums: true, vol: 0.085, pattern: [
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k k k k',
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k k k k',
          // breakdown then a kick build into the drop
          '. . h . . . h .', '. . . . k . k .',
          // drop: pounding four-on-the-floor with a fill
          'k . k . k . k .', 'k . k . k k k k',
          // coda: steady house thump, a small fill every 4 bars
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k h k k',
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k h k k',
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k h k k',
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k k k k',
        ] },
        // clap backbeat on 2 and 4 (a second drum voice layered over the
        // kick) — the gym groove's snap
        { drums: true, vol: 0.07, pattern: [
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          // breakdown: a snare roll build
          '. . . . . . . .', 's . s . s s s s',
          '. . s . . . s .', '. . s . s s s s',
          // coda backbeat, a fill every 4 bars
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . s s s s',
        ] },
        // gritty sub-bass: slams the drop, then holds warm sub-roots under
        // the coda
        { wave: 'sawtooth', vol: 0.045, pattern: [
          ...Array(14).fill('. . . . . . . .'),
          'A1 ~ ~ ~ ~ ~ ~ ~', 'A1 ~ ~ ~ E2 ~ ~ ~',
          'A1 ~ ~ ~ ~ ~ ~ ~', 'F1 ~ ~ ~ ~ ~ ~ ~',
          'C2 ~ ~ ~ ~ ~ ~ ~', 'G1 ~ ~ ~ ~ ~ ~ ~',
          'A1 ~ ~ ~ ~ ~ ~ ~', 'F1 ~ ~ ~ ~ ~ ~ ~',
          'C2 ~ ~ ~ ~ ~ ~ ~', 'G1 ~ ~ ~ ~ ~ ~ ~',
          'A1 ~ ~ ~ ~ ~ ~ ~', 'F1 ~ ~ ~ ~ ~ ~ ~',
          'C2 ~ ~ ~ ~ ~ ~ ~', 'G1 ~ ~ ~ ~ ~ ~ ~',
          'A1 ~ ~ ~ ~ ~ ~ ~', 'F1 ~ ~ ~ ~ ~ ~ ~',
          'C2 ~ ~ ~ ~ ~ ~ ~', 'G1 ~ ~ ~ ~ ~ ~ ~',
        ] },
        // shimmering arpeggio: silent until the coda, then runs up-and-down
        // through each chord — the coda's signature synth
        { wave: 'sawtooth', vol: 0.02, pattern: [
          ...Array(16).fill('. . . . . . . .'),
          'A3 C4 E4 A4 E4 C4 A3 C4', 'F3 A3 C4 F4 C4 A3 F3 A3',
          'C4 E4 G4 C5 G4 E4 C4 E4', 'G3 B3 D4 G4 D4 B3 G3 B3',
          'A3 C4 E4 A4 E4 C4 A3 C4', 'F3 A3 C4 F4 C4 A3 F3 A3',
          'C4 E4 G4 C5 G4 E4 C4 E4', 'G3 B3 D4 G4 D4 B3 G3 B3',
          'A3 C4 E4 A4 E4 C4 A3 C4', 'F3 A3 C4 F4 C4 A3 F3 A3',
          'C4 E4 G4 C5 G4 E4 C4 E4', 'G3 B3 D4 G4 D4 B3 G3 B3',
          'A3 C4 E4 A4 E4 C4 A3 C4', 'F3 A3 C4 F4 C4 A3 F3 A3',
          'C4 E4 G4 C5 G4 E4 C4 E4', 'G3 B3 D4 G4 D4 B3 G3 B3',
        ] },
      ],
    },
    // desert: a swaying caravan groove in E Phrygian-dominant (Hijaz) — the
    // augmented-second scale that gives the "Egyptian" mystique (Map-Editor
    // world). A snake-charmer lead winds over a doum-tek hand-drum groove and
    // an E-pedal drone; same 32-bar arc as the cruise songs — theme -> frenzied
    // variation -> a lone-charmer breakdown -> a heavy DROP -> a long hypnotic
    // desert-night coda with an oud-like arpeggio before it loops. Two drum
    // voices (doums+hats and a tek/clap backbeat) thicken the groove.
    desert: {
      bpm: 104,
      voices: [
        // snake-charmer lead (the Hijaz colour: E F G# A ...)
        { wave: 'square', vol: 0.034, pattern: [
          // theme
          'E4 .  F4 G#4 A4 ~  G#4 F4', 'E4 ~  .  G#4 A4 ~  B4 ~',
          'A4 .  B4 C5 B4 ~  A4 G#4', 'F4 ~  E4 ~  .  ~  .  .',
          'B4 .  C5 B4 A4 ~  G#4 A4', 'B4 ~  D5 ~  C5 ~  B4 ~',
          'A4 G#4 A4 B4 C5 ~  B4 A4', 'G#4 ~ F4 ~  E4 ~  ~  .',
          // variation: higher, frenzied
          'E5 .  F5 E5 D5 ~  C5 B4', 'C5 .  B4 A4 G#4 ~ A4 B4',
          'A4 .  B4 C5 D5 ~  C5 B4', 'B4 ~  A4 G#4 F4 ~  G#4 ~',
          // breakdown: lone charmer, then a rising run
          'E5 ~  ~  ~  B4 ~  ~  .', '.  E4 F4 G#4 A4 B4 C5 D5',
          // drop: big Hijaz hits
          'E5 ~  ~  D5 C5 ~  ~  B4', 'E5 ~  B4 ~  G#4 ~  E4 ~',
          // desert-night coda: a hypnotic lead floating over the drone
          'B4 ~ ~ ~ G#4 ~ ~ ~', 'A4 ~ ~ ~ E4 ~ ~ ~',
          'F4 ~ ~ ~ A4 ~ ~ ~', 'E4 ~ ~ ~ B3 ~ ~ ~',
          'G#4 ~ ~ A4 B4 ~ ~ ~', 'A4 ~ ~ ~ C5 ~ ~ ~',
          'B4 ~ ~ G#4 E4 ~ ~ ~', 'F4 ~ ~ ~ E4 ~ G#4 ~',
          'C5 ~ ~ ~ B4 ~ ~ ~', 'A4 ~ ~ ~ G#4 ~ ~ ~',
          'B4 ~ ~ A4 F4 ~ ~ ~', 'E4 ~ ~ ~ G#4 ~ B4 ~',
          'A4 ~ ~ ~ E4 ~ ~ ~', 'F4 ~ ~ ~ A4 ~ ~ ~',
          'G#4 ~ ~ ~ B4 ~ ~ ~', 'E4 ~ ~ ~ E4 ~ ~ .',
        ] },
        // offbeat drone stabs (E major / bII F colour); silent in the
        // breakdown, on-beat in the drop, sustained pad in the coda
        { wave: 'square', vol: 0.015, pattern: [
          '. E4 . B4 . E4 . G#4', '. E4 . B4 . E4 . B4',
          '. A4 . E4 . A4 . C5', '. F4 . A4 . F4 . C5',
          '. E4 . B4 . E4 . G#4', '. E4 . B4 . E4 . B4',
          '. A4 . C5 . A4 . E4', '. F4 . A4 . E4 . B4',
          '. E4 . B4 . E4 . G#4', '. A4 . C5 . A4 . E4',
          '. A4 . D5 . A4 . F4', '. F4 . A4 . F4 . B4',
          '. . . . . . . .', '. . . . . . . .',
          'E4 ~ E4 ~ B4 ~ E4 ~', 'B4 ~ E4 ~ G#4 ~ B4 ~',
          // coda pad chords
          'G#4 ~ ~ ~ ~ ~ ~ ~', 'E4 ~ ~ ~ ~ ~ ~ ~',
          'A4 ~ ~ ~ ~ ~ ~ ~', 'B3 ~ ~ ~ ~ ~ ~ ~',
          'G#4 ~ ~ ~ ~ ~ ~ ~', 'E4 ~ ~ ~ ~ ~ ~ ~',
          'A4 ~ ~ ~ ~ ~ ~ ~', 'B3 ~ ~ ~ ~ ~ ~ ~',
          'G#4 ~ ~ ~ ~ ~ ~ ~', 'E4 ~ ~ ~ ~ ~ ~ ~',
          'A4 ~ ~ ~ ~ ~ ~ ~', 'B3 ~ ~ ~ ~ ~ ~ ~',
          'G#4 ~ ~ ~ ~ ~ ~ ~', 'E4 ~ ~ ~ ~ ~ ~ ~',
          'A4 ~ ~ ~ ~ ~ ~ ~', 'B3 ~ ~ ~ ~ ~ ~ ~',
        ] },
        // E-pedal drone bass with octave movement and the bII lean
        { wave: 'triangle', vol: 0.062, pattern: [
          'E2 ~ E3 ~ E2 ~ E3 ~', 'E2 ~ E3 ~ E2 ~ B2 ~',
          'A2 ~ A3 ~ A2 ~ A3 ~', 'F2 ~ F3 ~ F2 ~ C3 ~',
          'E2 ~ E3 ~ E2 ~ E3 ~', 'E2 ~ E3 ~ E2 ~ B2 ~',
          'A2 ~ A3 ~ A2 ~ E3 ~', 'F2 ~ F3 ~ E2 ~ B2 ~',
          'E2 ~ E3 ~ E2 ~ E3 ~', 'A2 ~ A3 ~ A2 ~ A3 ~',
          'A2 ~ A3 ~ D3 ~ D2 ~', 'F2 ~ F3 ~ F2 ~ B2 ~',
          // breakdown: held root, then a pulse into the drop
          'E2 ~ ~ ~ ~ ~ ~ ~', 'B2 ~ ~ ~ B2 ~ B2 B2',
          // drop: relentless straight eighths
          'E2 E2 E2 E2 B2 B2 B2 B2', 'E2 E2 B2 B2 E2 E2 G#2 B2',
          // coda octave pulse
          'E2 ~ E3 ~ E2 ~ E3 ~', 'A2 ~ A3 ~ A2 ~ A3 ~',
          'F2 ~ F3 ~ F2 ~ F3 ~', 'E2 ~ E3 ~ E2 ~ B2 ~',
          'E2 ~ E3 ~ E2 ~ E3 ~', 'A2 ~ A3 ~ A2 ~ A3 ~',
          'F2 ~ F3 ~ F2 ~ F3 ~', 'E2 ~ E3 ~ E2 ~ B2 ~',
          'E2 ~ E3 ~ E2 ~ E3 ~', 'A2 ~ A3 ~ A2 ~ A3 ~',
          'F2 ~ F3 ~ F2 ~ F3 ~', 'E2 ~ E3 ~ E2 ~ B2 ~',
          'E2 ~ E3 ~ E2 ~ E3 ~', 'A2 ~ A3 ~ A2 ~ A3 ~',
          'F2 ~ F3 ~ F2 ~ F3 ~', 'E2 ~ E3 ~ E2 ~ B2 ~',
        ] },
        // doumbek groove: doums (kick) with running hats
        { drums: true, vol: 0.085, pattern: [
          'k h . h k h . h', 'k h . h k h . h',
          'k h . h k h . h', 'k h k h k k k h',
          'k h . h k h . h', 'k h . h k h . h',
          'k h . h k h . h', 'k h k h k k k h',
          'k h . h k h k h', 'k h . h k h k h',
          'k h . h k h k h', 'k h k h k k k k',
          // breakdown then a kick build into the drop
          '. . h . . . h .', '. . . . k . k .',
          // drop: pounding doums with a fill
          'k . k . k . k .', 'k . k . k k k k',
          // coda: steady doum-tek sway, a small fill every 4 bars
          'k h . h k h . h', 'k h . h k h . h',
          'k h . h k h . h', 'k h . h k h k k',
          'k h . h k h . h', 'k h . h k h . h',
          'k h . h k h . h', 'k h . h k h k k',
          'k h . h k h . h', 'k h . h k h . h',
          'k h . h k h . h', 'k h . h k h k k',
          'k h . h k h . h', 'k h . h k h . h',
          'k h . h k h . h', 'k h k h k k k k',
        ] },
        // tek/clap backbeat on 2 and 4 (a second drum voice over the doums)
        { drums: true, vol: 0.07, pattern: [
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          // breakdown: a snare roll build
          '. . . . . . . .', 's . s . s s s s',
          '. . s . . . s .', '. . s . s s s s',
          // coda backbeat, fills every 4 bars
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . s s s s',
        ] },
        // deep sub-bass (E1, ~41Hz): slams the drop, then holds warm sub-roots
        // under the coda
        { wave: 'sawtooth', vol: 0.045, pattern: [
          ...Array(14).fill('. . . . . . . .'),
          'E1 ~ ~ ~ ~ ~ ~ ~', 'E1 ~ ~ ~ B1 ~ ~ ~',
          'E1 ~ ~ ~ ~ ~ ~ ~', 'A1 ~ ~ ~ ~ ~ ~ ~',
          'F1 ~ ~ ~ ~ ~ ~ ~', 'E1 ~ ~ ~ ~ ~ ~ ~',
          'E1 ~ ~ ~ ~ ~ ~ ~', 'A1 ~ ~ ~ ~ ~ ~ ~',
          'F1 ~ ~ ~ ~ ~ ~ ~', 'E1 ~ ~ ~ ~ ~ ~ ~',
          'E1 ~ ~ ~ ~ ~ ~ ~', 'A1 ~ ~ ~ ~ ~ ~ ~',
          'F1 ~ ~ ~ ~ ~ ~ ~', 'E1 ~ ~ ~ ~ ~ ~ ~',
          'E1 ~ ~ ~ ~ ~ ~ ~', 'A1 ~ ~ ~ ~ ~ ~ ~',
          'F1 ~ ~ ~ ~ ~ ~ ~', 'E1 ~ ~ ~ ~ ~ ~ ~',
        ] },
        // oud-like arpeggio: silent until the coda, then runs up-and-down
        // through each chord — the coda's signature synth
        { wave: 'sawtooth', vol: 0.02, pattern: [
          ...Array(16).fill('. . . . . . . .'),
          'E3 G#3 B3 E4 B3 G#3 E3 G#3', 'A3 C4 E4 A4 E4 C4 A3 C4',
          'F3 A3 C4 F4 C4 A3 F3 A3', 'E3 G#3 B3 E4 B3 G#3 E3 G#3',
          'E3 G#3 B3 E4 B3 G#3 E3 G#3', 'A3 C4 E4 A4 E4 C4 A3 C4',
          'F3 A3 C4 F4 C4 A3 F3 A3', 'E3 G#3 B3 E4 B3 G#3 E3 G#3',
          'E3 G#3 B3 E4 B3 G#3 E3 G#3', 'A3 C4 E4 A4 E4 C4 A3 C4',
          'F3 A3 C4 F4 C4 A3 F3 A3', 'E3 G#3 B3 E4 B3 G#3 E3 G#3',
          'E3 G#3 B3 E4 B3 G#3 E3 G#3', 'A3 C4 E4 A4 E4 C4 A3 C4',
          'F3 A3 C4 F4 C4 A3 F3 A3', 'E3 G#3 B3 E4 B3 G#3 E3 G#3',
        ] },
      ],
    },
    // space: euphoric A-major synthwave for the Rainbow-Road cosmos (Map-Editor
    // world) — a soaring lead over a four-on-the-floor pulse and a shimmering
    // arp, the bright I-V-vi-IV lift. Same 32-bar arc as the cruise songs:
    // theme -> soaring variation -> a starlit breakdown -> a hands-up DROP ->
    // a long weightless coda that glides through the stars before it loops.
    // Two drum voices (four-on-floor kick+hat + a clap backbeat).
    space: {
      bpm: 124,
      voices: [
        // soaring lead over A E F#m D
        { wave: 'square', vol: 0.034, pattern: [
          // theme
          'A4 .  C#5 . E5 ~  C#5 A4', 'B4 .  E5 .  G#5 ~ E5 B4',
          'F#4 . A4 .  C#5 ~ A4 F#4', 'D5 ~  A4 .  F#4 ~ .  .',
          'A4 C#5 E5 . A5 .  G#5 E5', 'G#5 . E5 .  B4 ~  G#4 .',
          'A5 .  F#5 . C#5 ~ A4 .', 'D5 ~  F#5 A5 D6 ~  ~  .',
          // variation: higher, soaring
          'E5 .  A5 .  C#6 ~ A5 E5', 'B5 .  G#5 . E5 ~  B4 .',
          'C#6 . A5 .  F#5 ~ A5 C#6', 'D6 ~  A5 .  F#5 ~ E5 ~',
          // breakdown + rising run
          'A5 ~  ~  ~  E5 ~  ~  .', '.  E5 F#5 G#5 A5 B5 C#6 D6',
          // drop: hands-up hits
          'A5 ~  ~  E5 C#5 ~  ~  A4', 'E5 ~  A5 ~  C#6 ~  A5 ~',
          // weightless coda: a lead gliding through the stars
          'C#5 ~ ~ ~ A4 ~ ~ ~', 'B4 ~ ~ ~ G#4 ~ ~ ~',
          'A4 ~ ~ ~ F#4 ~ ~ ~', 'F#4 ~ ~ ~ A4 ~ ~ ~',
          'E5 ~ ~ C#5 A4 ~ ~ ~', 'B4 ~ ~ ~ G#4 ~ ~ ~',
          'C#5 ~ ~ A4 F#4 ~ ~ ~', 'D5 ~ ~ ~ A4 ~ D5 ~',
          'E5 ~ ~ ~ C#5 ~ A4 ~', 'G#5 ~ ~ ~ B4 ~ ~ ~',
          'A5 ~ ~ F#5 C#5 ~ ~ ~', 'D5 ~ ~ ~ A4 ~ F#5 ~',
          'C#5 ~ ~ ~ E5 ~ ~ ~', 'B4 ~ ~ ~ G#4 ~ ~ ~',
          'A4 ~ ~ ~ C#5 ~ ~ ~', 'E5 ~ ~ ~ A4 ~ ~ .',
        ] },
        // offbeat chord stabs; silent in the breakdown, on-beat in the drop,
        // sustained pad in the coda
        { wave: 'square', vol: 0.015, pattern: [
          '. A4 . C#5 . E4 . A4', '. B4 . E5 . G#4 . B4',
          '. F#4 . A4 . C#5 . F#4', '. D4 . F#4 . A4 . D5',
          '. A4 . C#5 . E4 . A4', '. B4 . E5 . G#4 . B4',
          '. F#4 . A4 . C#5 . F#4', '. D4 . F#4 . A4 . E5',
          '. A4 . E5 . C#5 . A4', '. B4 . G#4 . E5 . B4',
          '. F#4 . C#5 . A4 . F#4', '. D4 . A4 . F#4 . A4',
          '. . . . . . . .', '. . . . . . . .',
          'A4 ~ A4 ~ E4 ~ A4 ~', 'E4 ~ A4 ~ C#5 ~ E5 ~',
          // coda pad chords
          'C#5 ~ ~ ~ ~ ~ ~ ~', 'G#4 ~ ~ ~ ~ ~ ~ ~',
          'A4 ~ ~ ~ ~ ~ ~ ~', 'F#4 ~ ~ ~ ~ ~ ~ ~',
          'C#5 ~ ~ ~ ~ ~ ~ ~', 'G#4 ~ ~ ~ ~ ~ ~ ~',
          'A4 ~ ~ ~ ~ ~ ~ ~', 'F#4 ~ ~ ~ ~ ~ ~ ~',
          'C#5 ~ ~ ~ ~ ~ ~ ~', 'G#4 ~ ~ ~ ~ ~ ~ ~',
          'A4 ~ ~ ~ ~ ~ ~ ~', 'F#4 ~ ~ ~ ~ ~ ~ ~',
          'C#5 ~ ~ ~ ~ ~ ~ ~', 'G#4 ~ ~ ~ ~ ~ ~ ~',
          'A4 ~ ~ ~ ~ ~ ~ ~', 'F#4 ~ ~ ~ ~ ~ ~ ~',
        ] },
        // pulsing octave-pulse bass over A E F# D
        { wave: 'triangle', vol: 0.062, pattern: [
          'A1 ~ A2 ~ A1 ~ A2 ~', 'E2 ~ E3 ~ E2 ~ E3 ~',
          'F#1 ~ F#2 ~ F#1 ~ F#2 ~', 'D2 ~ D3 ~ D2 ~ D3 ~',
          'A1 ~ A2 ~ A1 ~ A2 ~', 'E2 ~ E3 ~ E2 ~ E3 ~',
          'F#1 ~ F#2 ~ F#1 ~ F#2 ~', 'D2 ~ D3 ~ D2 ~ A2 ~',
          'A1 ~ A2 ~ A1 ~ A2 ~', 'E2 ~ E3 ~ E2 ~ E3 ~',
          'F#1 ~ F#2 ~ F#1 ~ F#2 ~', 'D2 ~ D3 ~ A1 ~ A2 ~',
          // breakdown then a pulse into the drop
          'A1 ~ ~ ~ ~ ~ ~ ~', 'E2 ~ ~ ~ E2 ~ E2 E2',
          // drop: driving eighths
          'A1 A1 A1 A1 E2 E2 E2 E2', 'A1 A1 E2 E2 A1 A1 F#1 E2',
          // coda octave pulse
          'A1 ~ A2 ~ A1 ~ A2 ~', 'E2 ~ E3 ~ E2 ~ E3 ~',
          'F#1 ~ F#2 ~ F#1 ~ F#2 ~', 'D2 ~ D3 ~ D2 ~ D3 ~',
          'A1 ~ A2 ~ A1 ~ A2 ~', 'E2 ~ E3 ~ E2 ~ E3 ~',
          'F#1 ~ F#2 ~ F#1 ~ F#2 ~', 'D2 ~ D3 ~ D2 ~ D3 ~',
          'A1 ~ A2 ~ A1 ~ A2 ~', 'E2 ~ E3 ~ E2 ~ E3 ~',
          'F#1 ~ F#2 ~ F#1 ~ F#2 ~', 'D2 ~ D3 ~ D2 ~ D3 ~',
          'A1 ~ A2 ~ A1 ~ A2 ~', 'E2 ~ E3 ~ E2 ~ E3 ~',
          'F#1 ~ F#2 ~ F#1 ~ F#2 ~', 'D2 ~ D3 ~ D2 ~ A2 ~',
        ] },
        // four-on-the-floor kick with offbeat hats
        { drums: true, vol: 0.085, pattern: [
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k h k k',
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k k k k',
          '. . h . . . h .', '. . . . k . k .',
          'k . k . k . k .', 'k . k . k k k k',
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k h k k',
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k h k k',
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k h k k',
          'k h k h k h k h', 'k h k h k h k h',
          'k h k h k h k h', 'k h k h k k k k',
        ] },
        // clap backbeat on 2 and 4
        { drums: true, vol: 0.07, pattern: [
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          '. . . . . . . .', 's . s . s s s s',
          '. . s . . . s .', '. . s . s s s s',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . . s s s',
          '. . s . . . s .', '. . s . . . s .',
          '. . s . . . s .', '. . s . s s s s',
        ] },
        // deep sub-bass: slams the drop, then holds warm sub-roots under the coda
        { wave: 'sawtooth', vol: 0.045, pattern: [
          ...Array(14).fill('. . . . . . . .'),
          'A1 ~ ~ ~ ~ ~ ~ ~', 'A1 ~ ~ ~ E2 ~ ~ ~',
          'A1 ~ ~ ~ ~ ~ ~ ~', 'E2 ~ ~ ~ ~ ~ ~ ~',
          'F#1 ~ ~ ~ ~ ~ ~ ~', 'D2 ~ ~ ~ ~ ~ ~ ~',
          'A1 ~ ~ ~ ~ ~ ~ ~', 'E2 ~ ~ ~ ~ ~ ~ ~',
          'F#1 ~ ~ ~ ~ ~ ~ ~', 'D2 ~ ~ ~ ~ ~ ~ ~',
          'A1 ~ ~ ~ ~ ~ ~ ~', 'E2 ~ ~ ~ ~ ~ ~ ~',
          'F#1 ~ ~ ~ ~ ~ ~ ~', 'D2 ~ ~ ~ ~ ~ ~ ~',
          'A1 ~ ~ ~ ~ ~ ~ ~', 'E2 ~ ~ ~ ~ ~ ~ ~',
          'F#1 ~ ~ ~ ~ ~ ~ ~', 'D2 ~ ~ ~ ~ ~ ~ ~',
        ] },
        // shimmering arpeggio: silent until the coda, then runs up-and-down
        // through each chord — the coda's signature synth
        { wave: 'sawtooth', vol: 0.02, pattern: [
          ...Array(16).fill('. . . . . . . .'),
          'A4 C#5 E5 A5 E5 C#5 A4 C#5', 'E4 G#4 B4 E5 B4 G#4 E4 G#4',
          'F#4 A4 C#5 F#5 C#5 A4 F#4 A4', 'D4 F#4 A4 D5 A4 F#4 D4 F#4',
          'A4 C#5 E5 A5 E5 C#5 A4 C#5', 'E4 G#4 B4 E5 B4 G#4 E4 G#4',
          'F#4 A4 C#5 F#5 C#5 A4 F#4 A4', 'D4 F#4 A4 D5 A4 F#4 D4 F#4',
          'A4 C#5 E5 A5 E5 C#5 A4 C#5', 'E4 G#4 B4 E5 B4 G#4 E4 G#4',
          'F#4 A4 C#5 F#5 C#5 A4 F#4 A4', 'D4 F#4 A4 D5 A4 F#4 D4 F#4',
          'A4 C#5 E5 A5 E5 C#5 A4 C#5', 'E4 G#4 B4 E5 B4 G#4 E4 G#4',
          'F#4 A4 C#5 F#5 C#5 A4 F#4 A4', 'D4 F#4 A4 D5 A4 F#4 D4 F#4',
        ] },
      ],
    },
    // cave: a dark, echoing D harmonic-minor descent (Map-Editor world) — a
    // haunting lead and dripping percussion over a deep drone, the raised 7th
    // (C#) giving it the underground chill. Same 32-bar arc: theme -> a rising
    // tension variation -> a hollow breakdown -> a driving DROP -> an eerie
    // ambient coda where crystalline sine-bells glint before it loops. Two drum
    // voices (a cavernous tom heartbeat + irregular water drips).
    cave: {
      bpm: 92,
      voices: [
        // haunting, sparse lead (D harmonic minor: D E F G A Bb C#)
        { wave: 'square', vol: 0.03, pattern: [
          // theme
          'D4 ~  F4 ~  A4 ~  F4 ~', 'E4 ~  ~  ~  G4 ~  ~  .',
          'F4 ~  A4 ~  D5 ~  A4 ~', 'C#5 ~ ~  ~  A4 ~  ~  .',
          'D5 ~  C#5 ~ Bb4 ~ A4 ~', 'G4 ~  ~  F4 E4 ~  ~  .',
          'F4 ~  G4 ~  A4 ~  Bb4 ~', 'A4 ~  ~  ~  ~  ~  .  .',
          // variation: rising tension
          'A4 ~  D5 ~  F5 ~  D5 ~', 'E5 ~  ~  ~  C#5 ~ ~  .',
          'D5 ~  F5 ~  A5 ~  F5 ~', 'C#5 ~ E5 ~  G5 ~  ~  .',
          // breakdown + rising run
          'A5 ~  ~  ~  ~  ~  ~  .', '.  A4 Bb4 C#5 D5 E5 F5 G5',
          // drop: darker, driving
          'D5 ~  ~  A4 F4 ~  ~  D4', 'A4 ~  D5 ~  F5 ~  D5 ~',
          // eerie ambient coda
          'A4 ~ ~ ~ F4 ~ ~ ~', 'D4 ~ ~ ~ A4 ~ ~ ~',
          'Bb4 ~ ~ ~ F4 ~ ~ ~', 'A4 ~ ~ ~ D5 ~ ~ ~',
          'F4 ~ ~ A4 D5 ~ ~ ~', 'C#5 ~ ~ ~ A4 ~ ~ ~',
          'D5 ~ ~ Bb4 F4 ~ ~ ~', 'E4 ~ ~ ~ G4 ~ A4 ~',
          'F4 ~ ~ ~ D4 ~ ~ ~', 'A4 ~ ~ ~ F4 ~ ~ ~',
          'Bb4 ~ ~ A4 G4 ~ ~ ~', 'A4 ~ ~ ~ E4 ~ C#4 ~',
          'D4 ~ ~ ~ F4 ~ ~ ~', 'A4 ~ ~ ~ G4 ~ ~ ~',
          'F4 ~ ~ ~ E4 ~ ~ ~', 'D4 ~ ~ ~ A3 ~ ~ .',
        ] },
        // dark offbeat fifths; silent in the breakdown, on-beat in the drop,
        // sustained pad in the coda
        { wave: 'square', vol: 0.013, pattern: [
          '. D4 . A4 . D4 . F4', '. D4 . A4 . E4 . A4',
          '. F4 . C5 . A4 . F4', '. A4 . C#5 . E4 . A4',
          '. D4 . A4 . D4 . F4', '. D4 . A4 . E4 . A4',
          '. Bb3 . F4 . D4 . Bb3', '. A3 . E4 . A4 . C#5',
          '. D4 . A4 . F4 . D5', '. A4 . C#5 . E4 . A4',
          '. D4 . F4 . A4 . D5', '. A4 . E4 . C#5 . E5',
          '. . . . . . . .', '. . . . . . . .',
          'D4 ~ D4 ~ A4 ~ D4 ~', 'A4 ~ D4 ~ F4 ~ A4 ~',
          // coda pad
          'F4 ~ ~ ~ ~ ~ ~ ~', 'A4 ~ ~ ~ ~ ~ ~ ~',
          'D4 ~ ~ ~ ~ ~ ~ ~', 'C#5 ~ ~ ~ ~ ~ ~ ~',
          'F4 ~ ~ ~ ~ ~ ~ ~', 'A4 ~ ~ ~ ~ ~ ~ ~',
          'D4 ~ ~ ~ ~ ~ ~ ~', 'C#5 ~ ~ ~ ~ ~ ~ ~',
          'F4 ~ ~ ~ ~ ~ ~ ~', 'A4 ~ ~ ~ ~ ~ ~ ~',
          'D4 ~ ~ ~ ~ ~ ~ ~', 'C#5 ~ ~ ~ ~ ~ ~ ~',
          'F4 ~ ~ ~ ~ ~ ~ ~', 'A4 ~ ~ ~ ~ ~ ~ ~',
          'D4 ~ ~ ~ ~ ~ ~ ~', 'C#5 ~ ~ ~ ~ ~ ~ ~',
        ] },
        // deep drone bass
        { wave: 'triangle', vol: 0.06, pattern: [
          'D2 ~ ~ ~ D2 ~ A2 ~', 'D2 ~ ~ ~ D2 ~ A2 ~',
          'F2 ~ ~ ~ F2 ~ C3 ~', 'A1 ~ ~ ~ A1 ~ E2 ~',
          'D2 ~ ~ ~ D2 ~ A2 ~', 'D2 ~ ~ ~ D2 ~ A2 ~',
          'Bb1 ~ ~ ~ Bb1 ~ F2 ~', 'A1 ~ ~ ~ A1 ~ E2 ~',
          'D2 ~ ~ ~ D2 ~ A2 ~', 'A1 ~ ~ ~ A1 ~ E2 ~',
          'D2 ~ ~ ~ F2 ~ A2 ~', 'A1 ~ ~ ~ E2 ~ A2 ~',
          'D2 ~ ~ ~ ~ ~ ~ ~', 'A1 ~ ~ ~ A1 ~ A1 A1',
          'D2 D2 D2 D2 A1 A1 A1 A1', 'D2 D2 A1 A1 D2 D2 F2 A2',
          // coda octave pulse (Dm Dm Bb A)
          'D2 ~ D3 ~ D2 ~ A2 ~', 'F2 ~ F3 ~ F2 ~ C3 ~',
          'Bb1 ~ Bb2 ~ Bb1 ~ F2 ~', 'A1 ~ A2 ~ A1 ~ E2 ~',
          'D2 ~ D3 ~ D2 ~ A2 ~', 'F2 ~ F3 ~ F2 ~ C3 ~',
          'Bb1 ~ Bb2 ~ Bb1 ~ F2 ~', 'A1 ~ A2 ~ A1 ~ E2 ~',
          'D2 ~ D3 ~ D2 ~ A2 ~', 'F2 ~ F3 ~ F2 ~ C3 ~',
          'Bb1 ~ Bb2 ~ Bb1 ~ F2 ~', 'A1 ~ A2 ~ A1 ~ E2 ~',
          'D2 ~ D3 ~ D2 ~ A2 ~', 'F2 ~ F3 ~ F2 ~ C3 ~',
          'Bb1 ~ Bb2 ~ Bb1 ~ F2 ~', 'A1 ~ A2 ~ D2 ~ A1 ~',
        ] },
        // cavernous tom heartbeat (deep kick) with a sparse snare crack
        { drums: true, vol: 0.075, pattern: [
          'k . . . s . . .', 'k . . . s . . k',
          'k . . . s . . .', 'k . . k s . . .',
          'k . . . s . . .', 'k . . . s . . k',
          'k . . . s . . .', 'k . . k s . s s',
          'k . k . s . . k', 'k . . . s . k .',
          'k . k . s . . k', 'k . k . s k s s',
          // breakdown then a snare-roll build
          '. . . . . . . .', 's . s . s s s s',
          // drop: driving
          'k . . k k . . k', 'k . k . k k s s',
          // coda heartbeat with a fill every 4 bars
          'k . . . s . . .', 'k . . . s . . .',
          'k . . . s . . .', 'k . . k s . s s',
          'k . . . s . . .', 'k . . . s . . .',
          'k . . . s . . .', 'k . . k s . s s',
          'k . . . s . . .', 'k . . . s . . .',
          'k . . . s . . .', 'k . . k s . s s',
          'k . . . s . . .', 'k . . . s . . .',
          'k . . . s . . .', 'k . . k s . s s',
        ] },
        // irregular water drips (hats) echoing off-grid
        { drums: true, vol: 0.045, pattern: [
          '. . h . . . . h', '. h . . . . h .',
          '. . . h . . . .', '. . h . . h . .',
          '. h . . . . . h', '. . h . . . h .',
          '. . . . h . . .', '. . h . . . h h',
          '. h . h . . h .', '. . h . . h . h',
          '. h . . h . . h', '. h h . h . h h',
          '. . h . . . h .', '. . . . . . . .',
          '. h . h . h . h', '. h . h . h h h',
          '. . h . . . . h', '. h . . . . h .',
          '. . . h . . . .', '. . h . . h . .',
          '. h . . . . . h', '. . h . . . h .',
          '. . . . h . . .', '. . h . . . h h',
          '. . h . . . . h', '. h . . . . h .',
          '. . . h . . . .', '. . h . . h . .',
          '. h . . . . . h', '. . h . . . h .',
          '. . . . h . . .', '. . h . . . h h',
        ] },
        // deep sub: slams the drop, then holds the cave's low drone in the coda
        { wave: 'sawtooth', vol: 0.04, pattern: [
          ...Array(14).fill('. . . . . . . .'),
          'D1 ~ ~ ~ ~ ~ ~ ~', 'D1 ~ ~ ~ A1 ~ ~ ~',
          'D1 ~ ~ ~ ~ ~ ~ ~', 'F1 ~ ~ ~ ~ ~ ~ ~',
          'Bb1 ~ ~ ~ ~ ~ ~ ~', 'A1 ~ ~ ~ ~ ~ ~ ~',
          'D1 ~ ~ ~ ~ ~ ~ ~', 'F1 ~ ~ ~ ~ ~ ~ ~',
          'Bb1 ~ ~ ~ ~ ~ ~ ~', 'A1 ~ ~ ~ ~ ~ ~ ~',
          'D1 ~ ~ ~ ~ ~ ~ ~', 'F1 ~ ~ ~ ~ ~ ~ ~',
          'Bb1 ~ ~ ~ ~ ~ ~ ~', 'A1 ~ ~ ~ ~ ~ ~ ~',
          'D1 ~ ~ ~ ~ ~ ~ ~', 'F1 ~ ~ ~ ~ ~ ~ ~',
          'Bb1 ~ ~ ~ ~ ~ ~ ~', 'A1 ~ ~ ~ ~ ~ ~ ~',
        ] },
        // crystalline sine bells: silent until the coda, then glinting arps
        // through each chord — the glowing-crystal shimmer
        { wave: 'sine', vol: 0.024, pattern: [
          ...Array(16).fill('. . . . . . . .'),
          'D5 F5 A5 D6 A5 F5 D5 F5', 'F5 A5 D6 F6 D6 A5 F5 A5',
          'Bb4 D5 F5 Bb5 F5 D5 Bb4 D5', 'A4 C#5 E5 A5 E5 C#5 A4 C#5',
          'D5 F5 A5 D6 A5 F5 D5 F5', 'F5 A5 D6 F6 D6 A5 F5 A5',
          'Bb4 D5 F5 Bb5 F5 D5 Bb4 D5', 'A4 C#5 E5 A5 E5 C#5 A4 C#5',
          'D5 F5 A5 D6 A5 F5 D5 F5', 'F5 A5 D6 F6 D6 A5 F5 A5',
          'Bb4 D5 F5 Bb5 F5 D5 Bb4 D5', 'A4 C#5 E5 A5 E5 C#5 A4 C#5',
          'D5 F5 A5 D6 A5 F5 D5 F5', 'F5 A5 D6 F6 D6 A5 F5 A5',
          'Bb4 D5 F5 Bb5 F5 D5 Bb4 D5', 'A4 C#5 E5 A5 E5 C#5 A4 C#5',
        ] },
      ],
    },
    // victory lap: the whole-track-cleared feast, C major at full grin —
    // a rising-triad fanfare, a warmer answering strain, then a scale run
    // that vaults into the final cadence. Loops gently while the champion
    // shovels popcorn; far-off bells glint over the top
    victory: {
      bpm: 140,
      voices: [
        { wave: 'square', vol: 0.04, pattern: [
          // fanfare theme
          'C5 E5 G5 .  C6 ~  G5 .', 'E6 ~  C6 ~  G5 ~  .  .',
          'A5 .  C6 .  F6 ~  C6 .', 'B5 .  D6 .  G5 ~  .  .',
          'E5 G5 C6 .  E6 .  D6 C6', 'A5 .  C6 .  F5 ~  A5 .',
          'G5 .  B5 .  D6 ~  B5 G5', 'C6 ~  ~  .  E5 G5 C6 .',
          // answer: warmer, swaying
          'F5 A5 C6 ~  A5 .  F5 .', 'E5 G5 C6 ~  G5 .  E5 .',
          'F5 A5 C6 E6 F6 ~  E6 C6', 'D6 ~  B5 G5 D5 ~  .  .',
          'A5 C6 E6 ~  C6 .  A5 .', 'F5 A5 C6 .  B5 .  D6 .',
          // the run up and the big finish
          'C5 D5 E5 F5 G5 A5 B5 C6', 'E6 ~  D6 ~  C6 ~  ~  .',
        ] },
        // offbeat oom-pah stabs that turn on-beat for the final chord
        { wave: 'square', vol: 0.016, pattern: [
          '. E4 . E4 . E4 . E4', '. E4 . E4 . E4 . E4',
          '. F4 . F4 . F4 . F4', '. G4 . G4 . G4 . G4',
          '. E4 . E4 . E4 . E4', '. F4 . F4 . F4 . F4',
          '. G4 . G4 . G4 . G4', '. E4 . E4 . G4 . G4',
          '. F4 . F4 . F4 . F4', '. E4 . E4 . E4 . E4',
          '. F4 . F4 . A4 . A4', '. G4 . G4 . B4 . B4',
          '. A4 . A4 . A4 . A4', '. F4 . F4 . G4 . G4',
          '. C5 . C5 . D5 . D5', 'C5 ~  E5 ~  G5 ~  C6 ~',
        ] },
        { wave: 'triangle', vol: 0.07, pattern: [
          'C3 . G3 . C3 . G3 .', 'C3 . G3 . E3 . G3 .',
          'F2 . C3 . F2 . C3 .', 'G2 . D3 . G2 . D3 .',
          'C3 . G3 . C3 . G3 .', 'F2 . C3 . F2 . C3 .',
          'G2 . D3 . G2 . B2 .', 'C3 . G3 . C3 . G3 .',
          'F2 . C3 . F2 . C3 .', 'C3 . G3 . C3 . G3 .',
          'F2 . C3 . F2 . A2 .', 'G2 . D3 . G2 . D3 .',
          'A2 . E3 . A2 . E3 .', 'F2 . C3 . G2 . D3 .',
          // walking up under the run, then the cadence
          'C3 C3 E3 E3 G3 G3 A3 B3', 'C3 . G3 . C3 G3 C4 .',
        ] },
        { drums: true, vol: 0.09, pattern: [
          'k . h . s . h .', 'k . h . s . h h',
          'k . h . s . h .', 'k . h k s . h h',
          'k . h . s . h .', 'k . h . s . h h',
          'k . h . s . h .', 'k . h k s . s s',
          'k . h k s . h h', 'k . h . s . h .',
          'k . h k s . h h', 'k . h . s . s s',
          'k . h . s . h .', 'k . h k s . h h',
          // a little build under the run, a fill back to the top
          'k . s . s s s s', 'k . k . s . s s',
        ] },
        // celebration bells, sparse and high (loops on its own 8 bars)
        { wave: 'sine', vol: 0.025, pattern: [
          '. . . .  G6 ~ . .', '. . . .  . . . .',
          '. . C7 ~ . . . .', '. . . .  . . . .',
          '. . . .  E6 ~ . .', '. . . .  . . . .',
          '. . D6 ~ . . . .', '. . . .  G6 ~ . .',
        ] },
      ],
    },
    // continue screen: slow G minor lament (it answers the G-minor death
    // sting goContinue() plays), no drums, just a dirge and far-off bells.
    // The second half rises to an anguished peak, then sinks back — more
    // movement before it loops, but it never bangs: this is a death screen
    continue: {
      bpm: 76,
      voices: [
        { wave: 'triangle', vol: 0.05, pattern: [
          'G4  ~ ~   ~ Bb4 ~ A4 ~', 'G4  ~ Eb4 ~ ~   ~ .  .',
          'Eb4 ~ ~   ~ G4  ~ F4 ~', 'D4  ~ ~   ~ ~   ~ .  .',
          'D5  ~ ~   ~ C5  ~ Bb4 ~', 'Bb4 ~ G4  ~ Eb4 ~ ~  .',
          'C5  ~ Bb4 ~ G4  ~ A4 ~', 'A4  ~ F#4 ~ D4  ~ ~  .',
          // variation: rising lament toward an anguished peak, then sinking
          'D5  ~ ~   ~ Eb5 ~ D5 ~', 'C5  ~ ~   ~ Bb4 ~ C5 ~',
          'D5  ~ Eb5 ~ F5  ~ G5 ~', 'F5  ~ ~   ~ D5  ~ Eb5 ~',
          'D5  ~ C5  ~ Bb4 ~ A4 ~', 'G4  ~ ~   ~ Bb4 ~ G4 ~',
          'Eb4 ~ ~   ~ D4  ~ ~  .', 'D4  ~ ~   ~ G3  ~ ~  .',
        ] },
        { wave: 'sine', vol: 0.09, pattern: [
          'G2 ~ ~ ~ ~ ~ ~ ~', 'Eb2 ~ ~ ~ ~ ~ ~ ~',
          'C3 ~ ~ ~ ~ ~ ~ ~', 'D3 ~ ~ ~ ~ ~ ~ ~',
          'G2 ~ ~ ~ ~ ~ ~ ~', 'Eb2 ~ ~ ~ ~ ~ ~ ~',
          'C3 ~ ~ ~ ~ ~ ~ ~', 'D3 ~ ~ ~ ~ ~ ~ ~',
          // the rise: harmony climbs under the peak, then settles deep
          'Bb2 ~ ~ ~ ~ ~ ~ ~', 'C3 ~ ~ ~ ~ ~ ~ ~',
          'Eb3 ~ ~ ~ ~ ~ ~ ~', 'D3 ~ ~ ~ ~ ~ ~ ~',
          'G2 ~ ~ ~ ~ ~ ~ ~', 'Eb2 ~ ~ ~ ~ ~ ~ ~',
          'C3 ~ ~ ~ D3 ~ ~ ~', 'D3 ~ ~ ~ D2 ~ ~ ~',
        ] },
        { wave: 'sine', vol: 0.022, pattern: [
          '. . . .  . . . .', '. . . .  Bb5 ~ . .',
          '. . . .  . . . .', '. . D6 ~ . . . .',
          '. . . .  . . . .', '. . . .  G5 ~ . .',
          '. . . .  . . . .', '. . A5 ~ . . . .',
          // bells answer the rise, two tolling at the peak
          '. . . .  D6 ~ . .', '. . Eb6 ~ . . . .',
          '. . . .  G6 ~ . .', '. . F6 ~ . . D6 ~',
          '. . . .  Bb5 ~ . .', '. . G5 ~ . . . .',
          '. . . .  Eb5 ~ . .', '. . D5 ~ . . . .',
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

  function init(ac, dest) {
    if (AC) return;
    AC = ac;
    master = AC.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(dest || AC.destination);
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
