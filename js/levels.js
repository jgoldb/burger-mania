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
];

// Difficulty tracks, Super-Monkey-Ball style: each difficulty is a fixed
// series of maps played in order. `length` is the planned size of the
// series; `levels` holds the maps that exist so far. A track with no
// levels yet shows up disabled on the difficulty screen.
const TRACKS = [
  { id: 'easy',   label: 'Easy',   color: '#9be08a', length: 10, levels: [LEVELS[0], LEVELS[1]] },
  { id: 'medium', label: 'Medium', color: '#f9c623', length: 20, levels: [] },
  { id: 'hard',   label: 'Hard',   color: '#ff6038', length: 30, levels: [] },
];
