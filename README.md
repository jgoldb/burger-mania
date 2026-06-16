# Burger Mania

A browser-based motorbike physics game in the spirit of Elasto Mania: ride a
springy two-wheeler across polygon terrain, collect every **triple
cheeseburger** on the course, then touch the bucket of buttery popcorn to
finish. Your wheels can
hit anything — but if your head touches the ground, you crash.

## Play

Run a local web server from the repo root and open the printed URL:

```
npm start          # serves the repo at http://localhost:8080
```

(`npm start` runs `tools/serve.js`, a tiny zero-dependency static server — any
other static server works too, e.g. `npx serve` or `python -m http.server`.)
There's still no build step. A server is needed because the game loads its
levels from `levels/*.bmm` with `fetch()`, and browsers block `fetch()` of
`file://` URLs — so opening `index.html` straight off disk loads the menus but
not the maps. The live site is served over https, so it just works there.

## Install (PWA)

The deployed site is a Progressive Web App, so it installs to a phone or
desktop and then runs full-screen and offline like a native game. On the
live site:

- **Android / Chrome / Edge:** tap the address-bar **Install** prompt (or
  ⋮ → *Install app* / *Add to Home screen*).
- **iOS / Safari:** Share → **Add to Home Screen**.

A web manifest (`manifest.webmanifest`) supplies the name, icons, landscape
lock, and full-screen display; a service worker (`sw.js`) precaches the app
shell and caches the versioned `js/*.js` at runtime, so after the first visit
the game launches with no network. The level maps (`levels/*.bmm`) are fetched
network-first, so an edited or newly added map shows up on the next reload and
the rest stay available offline. Installability needs HTTPS, so the service
worker registers only over http(s) — opening `index.html` off disk (`file://`)
runs the menus with no worker, but can't fetch its maps (see **Play**). The
home-screen icons live in `assets/`
and are generated from the favicon by `node tools/gen-icons.js` (dependency-free
PNG encoder — re-run it if the favicon's look changes).

## Deploying

The game is a static site published to GitHub Pages by a GitHub Actions
workflow (`.github/workflows/deploy.yml`) on every push to `main` — just push
and the live site updates; there's nothing to run by hand.

Browsers cache JS by URL, so a fresh build could otherwise keep serving the old
`js/*.js` to returning visitors. The workflow prevents that: it stamps a
cache-busting token (the commit SHA) onto every `<script src="js/*.js">` URL in
the published copy, e.g. `js/game.js?v=ad15825e4c`. A changed URL forces the
browser to refetch. The committed source stays query-free; only the deployed
artifact is stamped (`tools/stamp-version.js` does the rewrite — run it by hand
only to preview a stamped build).

`index.html` itself can't be URL-versioned — its address is fixed — but GitHub
Pages serves it with a short cache TTL plus an ETag, so returning visitors
revalidate the HTML within minutes and then pull the freshly stamped `?v=…`
JS URLs. The same step also stamps the commit SHA into the service worker's
`BUILD` constant (`sw.js`), so each deploy ships a byte-different worker — the
browser updates it and its `activate` step purges the previous offline cache,
keeping installed PWAs from pinning to a stale build.

**One-time setup:** in the repo's **Settings → Pages → Build and deployment**,
set **Source** to **GitHub Actions** (instead of "Deploy from a branch") so the
workflow can publish.

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
  is the only fatal terrain collider; nut mounds (`nuts`) additionally kill on
  contact with any part of the bike. Gravity is signed (`bike.grav`), so an
  upside-down burger can flip it and the bike rides ceilings. Runs at 480 Hz
  (8 substeps per 60 fps frame).
- `js/levels.js` — level data: the playable area is the inside of a polygon;
  everything outside is ground. Burger, goal, (optional) nut-mound hazard, and
  (optional) gravity-flipping upside-down-burger positions per level.
- `js/render.js` — canvas renderer: procedural ground/sky texture patterns
  (one themed set per visual world, see `THEMES`), turf fringes on up-facing
  edges, the bike + rider, the animated burgers and popcorn-bucket goal, the
  peanut-butter-soaked nut-mound hazards, HUD.
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
  burgers, upside-down (gravity-flip) burgers, nut-mound hazards, the start
  and goal, painted glass edges, themes, and undo/redo. Saves
  and loads `.bmm` map files; the working map autosaves to localStorage
  between visits.
- `js/game.js` — game loop, input, camera, WebAudio engine sound + effects,
  state machine (title / playing / dead / finished, plus the replay
  browser and playback screens), picks the soundtrack for the current
  screen. Also detects and scores style points (the detection only reads
  sim state, so replays recompute identical totals).

## Tests

```
node test/test_physics.js   # settle, drive, brake, lean, flip sanity checks
node test/music_check.js    # soundtrack data: pitches, loops, theme coverage
node test/music_engine_check.js  # every scheduled note/envelope is valid
node test/game_smoke.js     # full stack under a stub DOM: right song per screen
node test/replay_check.js   # tape encoding + record/save/playback determinism
node test/style_check.js    # style points: airborne flip/rotation awards
node test/editor_check.js   # map editor: tools, undo, .bmm round trip, test ride
node test/mobile_ui_check.js # every screen fits a phone: no text/buttons clip off
node test/pwa_check.js      # PWA wiring: manifest, icons, service worker, deploy
```

## Map editor

Pick **Map Editor** on the main menu to build custom courses with a GUI.
The view is the real renderer, so the terrain, theme, grass, and glass
look exactly as they will in play. Press **H** in the editor for the full
control reference; the short version:

- **Select** (1): drag terrain vertices, whole edges (that's how the map
  bounds move), burgers, the START bike, and the GOAL bucket.
  `Shift+drag` a vertex or edge moves the whole polygon at once. To align a
  single vertex, grab it (no `Shift`), then hold `Shift` mid-drag to snap it
  to the nearest grid line — half-unit when the grid is shown, whole units
  when it is hidden. Double-click an edge to add a vertex, a vertex to remove
  it. `Del` removes the selection — a glassed edge clears its glass
  (`Shift+Del`: its whole polygon).
- **+Poly** (2): click out a new polygon and close it on its first point.
  A polygon inside the playable area is a solid island.
- **+Burger** (3) drops burgers; **+Glass** (4) paints obsidian onto
  edges — click or drag and the one edge nearest the cursor takes the
  brush, so stacked polygons stay distinct. To clear glass, select that
  edge and press `Del`.
- **+Nut** (5) drops nut mounds — lethal hazards (a heap of nuts in oozing
  peanut butter) the rider dies on contact with, this game's take on
  Elasto Mania's spinning spikes. Select one and press `Del` to remove it.
- **+Flip** (6) drops upside-down burgers — collecting one reverses gravity
  (Elasto Mania's gravity apple). They look exactly like normal burgers in
  play and count toward the burger total; a violet badge marks them in the
  editor only. Select one and press `Del` to remove it.
- **T** cycles the theme (the soundtrack follows along), **N** renames
  the map, `Ctrl+Z`/`Ctrl+Y` undo and redo, the wheel zooms, **0** fits
  the whole map.
- `[` and `]` coarsen and refine the placement grid (cycling 1 / 0.5 /
  0.25 / 0.1 world units — the current step shows bottom-right as `snap`).
  The **Grid** button (or `#`) shows or hides the alignment grid (off by
  default; when shown: bold 5-unit majors, with 1-unit and half-unit lines
  fading in as you zoom).
- **Test** (`Ctrl+Enter`) rides the map through the real sim — `Enter`
  retries instantly, `Esc` returns to the editor. Test rides bank no best
  times or checkpoints.
- **Save**/**Load** (`Ctrl+S`/`Ctrl+O`) write and read `.bmm` map files.
  The working map also autosaves to localStorage, so a closed tab picks
  up where it left off. **New** and **Load** discard the current map, so
  with unsaved edits they ask to confirm first (`Enter` discards, `Esc`
  keeps it).

A `.bmm` file is JSON: a format header (`format`, `version`, `savedAt`) plus the
fields of a level (the vertex list, `start`, `burgers`, `goal`, `theme`, and the
optional terrain fields below). The single-player tracks are made of these
files: each lives under `levels/tracks/<trackId>/`, and the game fetches them at
boot.

## Adding levels

Levels live in `levels/tracks/<trackId>/*.bmm` (e.g. `levels/tracks/beginner/`)
and are listed per track in `js/levels.js`. To add one:

1. Build the course in the map editor and **Save** it as a `.bmm` into the track's
   `levels/tracks/<trackId>/` directory (the converter `tools/lev2bmm.js` can also
   turn an Elasto Mania `.lev` into one).
2. Add its filename to the right track's `files` list in the `TRACKS` array in
   `js/levels.js`. The order of that list is the order the maps are played; a
   track shows up disabled until its `files` list has at least one map. (This is
   the pipeline for filling out the Advanced and Expert tracks.)

`game.js` loads maps lazily: entering a track fetches its first map, then
prefetches the next in the background, so only the map you're on and the one
after it are ever held — the other tracks' maps never load unless played. Each
file is parsed with `EDITOR.parse` into a playable level. A level needs a polygon
vertex list (y grows downward), a
`start` position, `burgers` coordinates, a `goal` (the popcorn bucket), and a
`theme` (a key of `THEMES` in `js/render.js` — every 5-map block between
checkpoints shares one). A new theme also wants a song under the same name in
`js/music.js`, or its maps ride in silence (`node test/music_check.js` catches
this).

One optional field marks special terrain: `glassEdges` lists `[poly, edge]`
pairs that are obsidian — volcanic glass the tires barely grip, where the
engine and brakes are passengers and momentum is everything. (`edge` is the
segment from vertex `i` to `i+1`.) Pre-`v2` maps used a `glass` field of
`[x0, x1]` floor x-spans; the editor still loads them, converting each span
to the edges whose midpoint falls inside it.

Two more optional fields place objects. `nuts` is a list of `[x, y]` points,
each a **nut mound** — a lethal "killer" the rider dies on contact with (the
Elasto Mania spinning-spike equivalent). Touching one with any part of the
bike — head, either wheel, or the frame body, within `PHYS.nutR` of the
point — ends the run. `flipBurgers` is a list of `[x, y]` points, each an
**upside-down burger** — a burger that, when collected, reverses gravity (the
Elasto Mania gravity apple). They are graphically identical to normal burgers
in play and count toward the burger total; collecting one toggles `bike.grav`
so the bike falls — and rides — the other way up. Neither field is used by a
built-in track yet, and both are inert when absent, so existing maps and saved
replays are unaffected.
