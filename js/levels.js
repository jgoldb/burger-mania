'use strict';

// Level data lives in external .bmm map files under levels/tracks/<trackId>/ —
// the same JSON the Map Editor saves. The game fetches them at boot: js/game.js
// ensureLevel() reads each track's `files` list below and fetches
// levels/tracks/<trackId>/<file>, parsing it with EDITOR.parse into a playable
// level (identical in shape to what this file used to hand-code). To add a custom
// map to a track, save its .bmm into levels/tracks/<trackId>/ and add the
// filename to that track's `files`.
//
// Because browsers block fetch() of file:// URLs, the game must be served over
// http(s) — run `npm start` for the bundled dev server (see README). The live
// site (GitHub Pages) serves it over https, so it just works there.

// A minimal placeholder the engine boots on before the real maps have been
// fetched. It's never shown — the menus draw their own backdrop — it just gives
// the bike something valid to spawn on during the loading screen.
const BOOT_LEVEL = {
  name: 'Loading',
  theme: 'meadow',
  polygons: [[[-5, -8], [40, -8], [40, 8], [0, 8], [-5, 8]]],
  start: { x: 2.5, y: 6.95 },
  burgers: [],
  goal: [36, 6],
};

// Difficulty tracks, Super-Monkey-Ball style: each difficulty is a fixed series
// of maps played in order. `length` is the planned size of the series; `files`
// lists the .bmm maps (under levels/tracks/<id>/) that make it up so far, in order; `levels`
// is filled in at boot from those files (empty until then, and a track with no
// levels shows up disabled on the difficulty screen).
const TRACKS = [
  { id: 'beginner', label: 'Beginner', color: '#9be08a', length: 10, levels: [],
    files: [
      '01-burger-hill.bmm', '02-cheddar-canyon.bmm', '03-onion-underpass.bmm',
      '04-patty-bridge.bmm', '05-skewer-gorge.bmm', '06-habanero-heights.bmm',
      '07-scoville-switchback.bmm', '08-cayenne-coil.bmm', '09-sriracha-spiral.bmm',
      '10-reaper-rim.bmm',
    ] },
  { id: 'advanced', label: 'Advanced', color: '#f9c623', length: 20, levels: [], files: [] },
  { id: 'expert',   label: 'Expert',   color: '#ff6038', length: 30, levels: [], files: [] },
];

// LEVELS is the flat list of every track's maps. In the browser it's filled by
// game.js once the fetch lands; here it starts empty. In Node (the headless
// tests and tools — no fetch) eagerly load each track's listed .bmm files from
// disk, so LEVELS and TRACKS[*].levels mirror what the browser fetches at boot.
// The `require` guard keeps this inert in the browser (no require there); the
// try/catch tolerates a context where the files aren't on disk.
let LEVELS = [];
if (typeof require === 'function') {
  try {
    const _fs = require('fs'), _path = require('path');
    // __dirname is js/ when this file is require()'d, or the test dir when its
    // source is eval'd by a harness; '..'/levels/tracks resolves to the repo's
    // levels/tracks/ in both, since the tests run from the repo root. Each track's
    // maps live in their own levels/tracks/<id>/ folder.
    const _dir = _path.join(__dirname, '..', 'levels', 'tracks');
    for (const _t of TRACKS) {
      _t.levels = (_t.files || []).map(f =>
        JSON.parse(_fs.readFileSync(_path.join(_dir, _t.id, f), 'utf8')));
      LEVELS = LEVELS.concat(_t.levels);
    }
  } catch (e) { /* files not reachable on disk — leave levels empty */ }
}
