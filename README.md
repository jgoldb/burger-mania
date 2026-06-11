# Burger Mania

A browser-based motorbike physics game in the spirit of Elasto Mania: ride a
springy two-wheeler across polygon terrain, collect every **triple
cheeseburger** on the course, then touch the bucket of buttery popcorn to
finish. Your wheels can
hit anything — but if your head touches the ground, you crash.

## Play

Open `index.html` in any modern browser (no build step, no server needed).

## Controls

| Key         | Action                                  |
| ----------- | --------------------------------------- |
| Up arrow    | Gas (spins the rear wheel)              |
| Down arrow  | Brake (locks both wheels)               |
| Left/Right  | Rotate the bike (counter/clockwise)     |
| Space       | Turn around (rear and front wheel swap) |
| Enter / Esc | Restart the course                      |
| M           | Toggle sound                            |
| S           | Save a replay (on the crash/finish screen) |

Your best time is saved locally per level.

## Replays

When a run ends — crash or course complete — press **S** to save a replay
to disk as a `.bmr` file (JSON). Pick **Replays** on the main menu to watch
them: Chromium browsers point the screen at a folder once (remembered
between visits) and it lists every replay in it; other browsers open one
file at a time. Playback feeds the recorded per-frame inputs back through
the deterministic sim, so it reproduces the run exactly. The level data is
embedded in the file, so later level edits can't bend an old replay — but
physics changes can; a desynced tape just stops where its inputs run out.

## How it works

- `js/physics.js` — rigid-body simulation: the frame and two wheels are
  separate bodies joined by stiff spring-dampers (the suspension). The rear
  wheel is torque-driven; tire grip is a Coulomb-clamped friction impulse at
  the contact point, so the wheel can spin out, climb, and wheelie. The head
  is the only fatal collider. Runs at 480 Hz (8 substeps per 60 fps frame).
- `js/levels.js` — level data: the playable area is the inside of a polygon;
  everything outside is ground. Burger and goal positions per level.
- `js/render.js` — canvas renderer: procedural ground/sky texture patterns
  (one themed set per visual world, see `THEMES`), turf fringes on up-facing
  edges, the bike + rider, the animated burgers and popcorn-bucket goal, HUD.
- `js/music.js` — procedural chiptune soundtrack: step-sequenced pattern
  strings played on the shared AudioContext. One looping song per visual
  world, plus a title theme (menu + difficulty screens) and a continue-screen
  theme; screen changes crossfade.
- `js/replay.js` — replay recording and playback: a run-length-encoded
  per-frame input tape plus the raw level data, saved as `.bmr` JSON via
  the File System Access API (download/open dialogs where unsupported);
  the replays folder handle persists in IndexedDB.
- `js/game.js` — game loop, input, camera, WebAudio engine sound + effects,
  state machine (title / playing / dead / finished, plus the replay
  browser and playback screens), picks the soundtrack for the current
  screen.

## Tests

```
node test/test_physics.js   # settle, drive, brake, lean, flip sanity checks
node test/drive_long.js     # verifies the course is completable
node test/music_check.js    # soundtrack data: pitches, loops, theme coverage
node test/music_engine_check.js  # every scheduled note/envelope is valid
node test/game_smoke.js     # full stack under a stub DOM: right song per screen
node test/replay_check.js   # tape encoding + record/save/playback determinism
```

## Adding levels

Append an entry to `LEVELS` in `js/levels.js`: a polygon vertex list
(y grows downward), a `start` position, `burgers` coordinates, a
`goal` position (the popcorn bucket), and a `theme` (a key of `THEMES`
in `js/render.js` — every 5-map block between checkpoints shares one).
A new theme also wants a song under the same name in `js/music.js`, or
its maps ride in silence (`node test/music_check.js` catches this).
