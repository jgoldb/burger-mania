'use strict';

// Level coordinates use world units, y grows downward (canvas convention).
// The playable area is the INSIDE of each polygon; everything outside is ground.
const LEVELS = [
  {
    name: 'Burger Hill',
    polygons: [
      [
        // ceiling, left to right
        [-5, -8], [100, -8],
        // right wall
        [100, 5.5],
        // floor, right to left
        [95, 5.5], [88, 5.5], [82, 5.5],
        [76, 7], [70, 10.5], [64, 10.5], [58, 7.5],
        [55, 5.5], [52, 6], [46, 9], [40, 9],
        [34, 8.5], [30, 6.5], [26, 7],
        [20, 9.5], [14, 9.5], [8, 8], [0, 8],
        // left wall
        [-5, 8],
      ],
    ],
    start: { x: 2.5, y: 7.25 },
    burgers: [
      [17, 8.7],
      [30, 5.7],
      [44, 8.2],
      [55, 4.6],
      [70, 9.6],
    ],
    goal: [90, 4.75], // the popcorn bucket
  },
  {
    // Easy #2: introduces a gap jump — clear the canyon with speed, or
    // drop in and ride out the far side — plus slightly steeper hills.
    name: 'Cheddar Canyon',
    polygons: [
      [
        // ceiling, left to right
        [-5, -8], [110, -8],
        // right wall
        [110, 6.5],
        // floor, right to left
        [105, 6.5], [92, 6.5], [86, 5.5],
        [80, 8], [74, 8], [69, 5.5],
        [64, 8.2], [61, 8.2], [57, 6.5], [52, 9.5], [46, 9.5],
        [40, 7], [37, 6.5],
        [31, 9], [25, 9], // canyon floor
        [20, 6.5],        // jump lip
        [17, 7.5], [13, 9], [8, 8], [0, 8],
        // left wall
        [-5, 8],
      ],
    ],
    start: { x: 2.5, y: 7.25 },
    burgers: [
      [10, 7.6],
      [20, 5.75],  // on the jump lip, in everyone's path
      [37.5, 5.9], // in the jump's landing zone
      [44, 7.9],
      [57, 5.7],
      [69, 4.7],
    ],
    goal: [100, 5.75],
  },
  {
    // Easy #3: introduces the ceiling as a hazard — a low tunnel bored
    // through a cliff. Stay low and keep the front wheel down; a wheelie
    // (or a bounced landing) puts your head into the rock. The hills
    // after the tunnel are a notch steeper than Cheddar Canyon's.
    name: 'Onion Underpass',
    polygons: [
      [
        // ceiling, left to right
        [-5, -8], [13, -8],
        // tunnel roof through the cliff (clearance ~2.4 over the floor)
        [16, 5.9], [20, 6.2], [25, 6.2],
        [29, 6.9], [33, 6.9], [37, 6.1], [40, 6.0],
        [44, -8], [110, -8],
        // right wall
        [110, 6.5],
        // floor, right to left
        [105, 6.5], [92, 6.5],            // goal shelf
        [88, 6.1], [84, 6.5], [82, 6.5],  // roller bump before the shelf
        [76, 8.9], [71, 8.9],             // last valley
        [66, 6.5], [61, 6.5],             // crest plateau
        [55, 9.6], [50, 9.6],             // deep valley
        [45, 7.2],                        // launch crest after the tunnel
        [40, 8.4], [37, 8.5],             // tunnel exit
        [33, 9.3], [29, 9.3],             // tunnel dip
        [25, 8.6], [21, 8.6], [17, 8.6],  // tunnel floor
        [13, 8.4], [9, 8], [0, 8],
        // left wall
        [-5, 8],
      ],
    ],
    start: { x: 2.5, y: 7.25 },
    burgers: [
      [10, 7.3],
      [23, 7.85],  // inside the tunnel, kept low
      [31, 8.55],  // in the tunnel dip
      [45, 6.45],  // on the launch crest
      [63.5, 5.75],
      [73.5, 8.15],
    ],
    goal: [100, 5.75],
  },
  {
    // Easy #4: introduces a solid island — a giant patty floating over a
    // valley. Hit the launch ramp with speed to land on top (a burger
    // waits there); undershooting drops you into the valley, which is
    // rideable under the patty and out the far side. Restart with Enter
    // if you miss the burger up top.
    name: 'Patty Bridge',
    polygons: [
      [
        // ceiling, left to right
        [-5, -8], [110, -8],
        // right wall
        [110, 6.3],
        // floor, right to left
        [105, 6.3], [92, 6.3], [84, 6.3], // goal shelf
        [78, 8.6], [73, 8.6],             // last valley
        [68, 5.8], [64, 5.8],             // crest plateau
        [59, 8], [54, 8],                 // landing flat past the mesa
        [48, 11],                         // climb out of the valley
        [36, 11],                         // valley floor under the patty
        [32.4, 9.4],                      // runout slope catches slow droppers
        [33, 7.2],                        // launch lip, undercut like a ski
                                          // jump so fallers tumble clear of it
        [28, 9.5], [20, 9.5],             // run-up flat
        [16, 7], [12, 7],                 // warmup hill plateau
        [8, 8], [0, 8],
        // left wall
        [-5, 8],
      ],
      // the patty itself: solid island, grass grows on its top. The left
      // face recedes as it rises so an undershooting jumper hits it
      // wheels-first and deflects down into the valley instead of
      // head-first into an overhang.
      [
        [36.6, 7.6], [48, 7.6],
        [48.5, 8.6], [35.8, 8.6],
      ],
    ],
    start: { x: 2.5, y: 7.25 },
    burgers: [
      [14, 6.3],
      [25, 8.8],
      [33, 6.45],  // on the launch lip, in the jump path
      [42, 6.85],  // on top of the patty
      [66, 5.1],
      [75.5, 7.85],
    ],
    goal: [100, 5.55],
  },
];

// Difficulty tracks, Super-Monkey-Ball style: each difficulty is a fixed
// series of maps played in order. `length` is the planned size of the
// series; `levels` holds the maps that exist so far. A track with no
// levels yet shows up disabled on the difficulty screen.
const TRACKS = [
  { id: 'easy',   label: 'Easy',   color: '#9be08a', length: 10, levels: [LEVELS[0], LEVELS[1], LEVELS[2], LEVELS[3]] },
  { id: 'medium', label: 'Medium', color: '#f9c623', length: 20, levels: [] },
  { id: 'hard',   label: 'Hard',   color: '#ff6038', length: 30, levels: [] },
];
