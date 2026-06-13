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

## Style points

Tricks score **style points**, a second record to chase alongside best
time: turning around (Space) while fully airborne is worth **+100**, and
every full rotation pays **+250** — mid-air spins and ground loop-the-loops
alike. Awards float up over the rider as they land, with a sparkle to
match. A finished run banks your per-level best style score (a crash
forfeits the banking, not the fun).

On phones and tablets (any touch screen) the game shows on-screen controls
instead: gas/brake pedals under the right thumb, lean buttons under the
left, a turn-around button, and pause/restart buttons at the top. Menus,
sliders, and the replay list all respond to taps, and a **Save Replay**
button appears on the crash/finish screens.

## Replays

When a run ends — crash or course complete — press **S** to save a replay
to disk as a `.bmr` file (JSON). Pick **Replays** on the main menu to watch
them: Chromium browsers point the screen at a folder once (remembered
between visits) and it lists every replay in it; other browsers open one
file at a time. Playback feeds the recorded per-frame inputs back through
the deterministic sim, so it reproduces the run exactly. The level data is
embedded in the file, so later level edits can't bend an old replay — but
physics changes can; a desynced tape just stops where its inputs run out.
Each file also records the run's style points total, shown in the replay
list; files saved before style points existed list it as **N/A** (playback
still re-earns the points live, since the sim recomputes them).

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
- `js/editor.js` — the map editor: a pan/zoom world view rendered through
  the real renderer, with tools for terrain vertices and polygons,
  burgers, the start and goal, painted glass edges, wire polygons, themes,
  and undo/redo. Saves and loads `.bmm` map files; the working map autosaves
  to localStorage between visits.
- `js/game.js` — game loop, input, camera, WebAudio engine sound + effects,
  state machine (title / playing / dead / finished, plus the replay
  browser and playback screens), picks the soundtrack for the current
  screen. Also detects and scores style points (the detection only reads
  sim state, so replays recompute identical totals).

## Tests

```
node test/test_physics.js   # settle, drive, brake, lean, flip sanity checks
node test/drive_long.js     # verifies the course is completable
node test/music_check.js    # soundtrack data: pitches, loops, theme coverage
node test/music_engine_check.js  # every scheduled note/envelope is valid
node test/game_smoke.js     # full stack under a stub DOM: right song per screen
node test/replay_check.js   # tape encoding + record/save/playback determinism
node test/style_check.js    # style points: airborne flip/rotation awards
node test/editor_check.js   # map editor: tools, undo, .bmm round trip, test ride
node test/mobile_ui_check.js # every screen fits a phone: no text/buttons clip off
```

## Map editor

Pick **Map Editor** on the main menu to build custom courses with a GUI.
The view is the real renderer, so the terrain, theme, grass, and glass
look exactly as they will in play. Press **H** in the editor for the full
control reference; the short version:

- **Select** (1): drag terrain vertices, whole edges (that's how the map
  bounds move), burgers, the START bike, and the GOAL bucket.
  `Shift+drag` a vertex or edge moves the whole polygon at once.
  Double-click an edge to add a vertex, a vertex to remove it.
  `Del` removes the selection — a glassed edge clears its glass
  (`Shift+Del`: its whole polygon). `W` flips the selected polygon
  between solid and wire (wheels-only) terrain.
- **+Poly** (2): click out a new polygon and close it on its first point.
  A polygon inside the playable area is a solid island.
- **+Burger** (3) drops burgers; **+Glass** (4) paints obsidian onto
  edges — click or drag and the one edge nearest the cursor takes the
  brush, so stacked polygons stay distinct. To clear glass, select that
  edge and press `Del`.
- **T** cycles the theme (the soundtrack follows along), **N** renames
  the map, `Ctrl+Z`/`Ctrl+Y` undo and redo, the wheel zooms, **0** fits
  the whole map.
- **Test** (`Ctrl+Enter`) rides the map through the real sim — `Enter`
  retries instantly, `Esc` returns to the editor. Test rides bank no best
  times or checkpoints.
- **Save**/**Load** (`Ctrl+S`/`Ctrl+O`) write and read `.bmm` map files.
  The working map also autosaves to localStorage, so a closed tab picks
  up where it left off.

A `.bmm` file is JSON: a format header (`format`, `version`, `savedAt`)
plus exactly the fields of a `LEVELS` entry (below). To put a finished
map into a single-player track, strip the three header fields and paste
the rest into `LEVELS` in `js/levels.js`, then add it to the right
`TRACKS` entry — this is the pipeline for authoring the Advanced and Expert
tracks.

## Adding levels

Append an entry to `LEVELS` in `js/levels.js` (or build one in the map
editor and paste its `.bmm` body): a polygon vertex list
(y grows downward), a `start` position, `burgers` coordinates, a
`goal` position (the popcorn bucket), and a `theme` (a key of `THEMES`
in `js/render.js` — every 5-map block between checkpoints shares one).
A new theme also wants a song under the same name in `js/music.js`, or
its maps ride in silence (`node test/music_check.js` catches this).

Two optional fields mark special terrain: `wires` lists polygon indices
that only the wheels collide with (the body and head thread through —
hang from them, Elasto Mania style), and `glassEdges` lists `[poly, edge]`
pairs that are obsidian — volcanic glass the tires barely grip, where the
engine and brakes are passengers and momentum is everything. (`edge` is the
segment from vertex `i` to `i+1`.) Pre-`v2` maps used a `glass` field of
`[x0, x1]` floor x-spans; the editor still loads them, converting each span
to the edges whose midpoint falls inside it.
