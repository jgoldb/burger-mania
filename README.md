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

Your best time is saved locally per level.

## How it works

- `js/physics.js` — rigid-body simulation: the frame and two wheels are
  separate bodies joined by stiff spring-dampers (the suspension). The rear
  wheel is torque-driven; tire grip is a Coulomb-clamped friction impulse at
  the contact point, so the wheel can spin out, climb, and wheelie. The head
  is the only fatal collider. Runs at 480 Hz (8 substeps per 60 fps frame).
- `js/levels.js` — level data: the playable area is the inside of a polygon;
  everything outside is ground. Burger and goal positions per level.
- `js/render.js` — canvas renderer: procedural ground/sky texture patterns,
  grass fringes on up-facing edges, the bike + rider, the animated burgers
  and popcorn-bucket goal, HUD.
- `js/game.js` — game loop, input, camera, WebAudio engine sound, state
  machine (title / playing / dead / finished).

## Tests

```
node test/test_physics.js   # settle, drive, brake, lean, flip sanity checks
node test/drive_long.js     # verifies the course is completable
```

## Adding levels

Append an entry to `LEVELS` in `js/levels.js`: a polygon vertex list
(y grows downward), a `start` position, `burgers` coordinates, and a
`goal` position (the popcorn bucket).
