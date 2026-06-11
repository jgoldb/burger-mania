'use strict';

// Level coordinates use world units, y grows downward (canvas convention).
// The playable area is the INSIDE of each polygon; everything outside is ground.
// `theme` picks the visual world from THEMES in render.js; every 5-map
// (checkpoint-to-checkpoint) block of a track shares one theme.
const LEVELS = [
  {
    name: 'Burger Hill',
    theme: 'meadow',
    polygons: [
      [
        // ceiling, left to right
        [-5, -8], [100, -8],
        // right wall
        [100, 5.5],
        // floor, right to left
        [95, 5.5], [88, 5.5], [82, 5.5],
        [76, 7], [70, 10.9], [64, 10.9], [58, 7.5],
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
      [70, 10.0],
    ],
    goal: [90, 4.75], // the popcorn bucket
  },
  {
    // Easy #2: introduces a gap jump — clear the canyon with speed, or
    // drop in and ride out the far side — plus slightly steeper hills.
    name: 'Cheddar Canyon',
    theme: 'meadow',
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
        [40, 7], [38.5, 6.5],
        [32.5, 9], [25, 9], // canyon floor
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
      [39, 5.9],   // in the jump's landing zone
      [44, 6.9],
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
    theme: 'meadow',
    polygons: [
      [
        // ceiling, left to right
        [-5, -8], [13, -8],
        // tunnel roof through the cliff (clearance ~2.25 over the floor)
        [16, 5.9], [20, 6.35], [25, 6.35],
        [29, 7.05], [33, 7.05], [37, 6.25], [40, 6.15],
        [44, -8], [110, -8],
        // right wall
        [110, 6.5],
        // floor, right to left
        [105, 6.5], [92, 6.5],            // goal shelf
        [88, 6.1], [84, 6.5], [82, 6.5],  // roller bump before the shelf
        [76, 8.9], [71, 8.9],             // last valley
        [66, 6.2], [61, 6.2],             // crest plateau
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
      [63.5, 5.45],
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
    theme: 'meadow',
    polygons: [
      [
        // ceiling, left to right
        [-5, -8], [110, -8],
        // right wall
        [110, 6.3],
        // floor, right to left
        [105, 6.3], [92, 6.3], [84, 6.3], // goal shelf
        [78, 8.6], [73, 8.6],             // last valley
        [68, 5.5], [64, 5.5],             // crest plateau
        [59, 8], [54, 8],                 // landing flat past the patty
        [48, 11],                         // climb out of the valley
        [36, 11],                         // valley floor under the patty
        [32.4, 9.4],                      // runout slope catches slow droppers
        [33, 7.2],                        // launch lip, undercut like a ski
                                          // jump so fallers tumble clear of it
        [28, 8.7], [20, 8.7],             // run-up flat
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
        [37.4, 7.5], [47, 7.5],
        [47.5, 8.5], [36.6, 8.5],
      ],
    ],
    start: { x: 2.5, y: 7.25 },
    burgers: [
      [14, 6.3],
      [25, 8.0],
      [33, 6.45],  // on the launch lip, in the jump path
      [42, 6.75],  // on top of the patty
      [66, 4.8],
      [75.5, 7.85],
    ],
    goal: [100, 5.55],
  },
  {
    // Easy #5, the first checkpoint map: introduces the speed window — a
    // giant skewer hangs over the gorge jump, and since launch arcs
    // balloon higher with speed, hitting the ramp too fast drives your
    // head into its point while too slow drops you short of the
    // platform. The gorge floor is rideable out if you fall. Stair-step
    // ledges and the steepest climb yet round out the back half.
    name: 'Skewer Gorge',
    theme: 'meadow',
    polygons: [
      [
        // ceiling, left to right
        [-5, -8], [31.4, -8],
        [33.2, 4.2],  // the skewer point, hanging over the jump arc
        [35, -8], [110, -8],
        // right wall
        [110, 6.4],
        // floor, right to left
        [105, 6.4], [86, 6.4],            // goal shelf
        [80.5, 8.7], [77, 8.7],           // lower ledge
        [76.8, 7.3], [72.7, 7.3],         // upper ledge
        [72.5, 5.9], [68.5, 5.9],         // plateau after the big climb
        [63.5, 8.6], [58, 8.6],           // rim flat
        [52, 11.6],                       // climb out of the gorge
        [34, 11.6],                       // gorge floor under the platform
        [29.2, 8.8],                      // runout slope catches fallers
        [30, 7.0],                        // launch lip, undercut ski-jump style
        [26, 9.2], [18, 9.2],             // run-up flat
        [14, 6.9], [11, 6.9],             // warmup roller
        [8, 8], [0, 8],
        // left wall
        [-5, 8],
      ],
      // gorge platform: solid island with a receding left face so
      // undershooters deflect wheels-first into the gorge
      [
        [35, 7.4], [42, 7.4],
        [42.6, 8.4], [34.2, 8.4],
      ],
    ],
    start: { x: 2.5, y: 7.25 },
    burgers: [
      [12.5, 6.2],
      [22, 8.5],
      [30, 6.25],  // on the launch lip
      [38, 6.65],  // on the gorge platform
      [60, 7.9],   // on the rim flat
      [70.5, 5.2], // on the plateau
      [74.5, 6.6], // on the upper ledge
    ],
    goal: [98, 5.65],
  },
  {
    // Easy #6, the volcano world opener and the biggest difficulty spike
    // yet — a three-act gauntlet:
    //  1. dive through the cinder pit to bank speed, then hammer up the
    //     lava tube: a 28-degree momentum climb under a basalt roof
    //     (~2.7 clearance), where a full-gas wheelie puts your head into
    //     the rock — feather the throttle to keep the nose down;
    //  2. the tube exit ramps straight into a jump over the magma gorge
    //     onto a small floating platform, with a lava fang hanging over
    //     the landing: too hot and the ballooning arc spikes your head
    //     on it, too slow and you drop short into the gorge;
    //  3. hop down the two basalt slabs and momentum-climb out to the
    //     goal shelf.
    // The gorge floor is rideable under everything and out the far
    // climb, so fallers can ride on (and Enter-restart for any missed
    // platform burgers, as on Patty Bridge).
    name: 'Habanero Heights',
    theme: 'volcano',
    polygons: [
      [
        // ceiling, left to right
        [-5, -8], [33, -8],
        [34.5, 8.4],                      // lava tube mouth
        [44, 3.5],                        // tube roof tracking the climb
        [46.8, 3.9],                      // ...juts out into a fang over the
        [47.5, -8],                       // gorge: a ballooning arc spikes it
        [84, -8],
        // right wall
        [84, 8.4],
        // floor, right to left
        [79, 8.4], [70.5, 8.4],           // goal shelf
        [63, 12.2],                       // climb out of the gorge, 27 deg
        [48.2, 12.2],                     // magma gorge floor
        [42.8, 8.0],                      // runout slope catches fallers
        [43.5, 6.4],                      // the tube crest IS the launch lip
        [36, 10.4],                       // the tube climb, 28 deg
        [33, 11.4],                       // gentler lead-in onto the slope
        [27, 11.4],                       // cinder pit floor
        [20, 7.6], [17, 7.6],             // rim before the dive
        [14, 6.8], [11, 6.8],             // warmup roller
        [8, 8], [0, 8],
        // left wall
        [-5, 8],
      ],
      // gorge landing platform: receding left face deflects undershooters
      // wheels-first down into the gorge, which is rideable out the right
      [
        [47.4, 8.2], [51.9, 8.2],
        [52.5, 9.2], [46.6, 9.2],
      ],
    ],
    start: { x: 2.5, y: 7.25 },
    burgers: [
      [12.5, 6.1],
      [30, 10.7],   // on the pit floor
      [39.5, 7.85], // inside the lava tube, mid-climb
      [45, 5.0],    // floating in the jump arc, under the fang
      [47.8, 6.3],  // in the descent onto the platform
      [56, 11.5],   // on the gorge floor past the platform drop
      [66.5, 9.7],  // halfway up the climb-out
      [73, 7.7],    // on the goal shelf
    ],
    goal: [76.5, 7.65],
  },
  {
    // Easy #7: introduces the turn-around (Space flips the bike) with a
    // two-storey switchback, Elasto Mania style. Ride right across the
    // rim — rollers, a cinder plateau, the 28-degree climb to the high
    // rim, then stair-steps down to a diving-board lip — and drop into
    // the shaft at the far end. A dished bowl with a quarter-pipe far
    // wall collects every landing speed and rolls it back leftward;
    // flip there and ride back left through the lava gallery bored
    // under the floor you just crossed: a mound pinched under the
    // ceiling (keep the nose down), then a basalt fang over a dip
    // (brake in low), out to the goal shelf directly beneath the start.
    name: 'Scoville Switchback',
    theme: 'volcano',
    polygons: [
      [
        // ceiling: open sky over the upper storey and the drop shaft
        [-5, -8], [81.3, -8],
        // right wall, down to the top of the quarter-pipe
        [81.3, 9.5],
        // floor, right to left: the quarter-pipe sweeps into the bowl
        [80.8, 11.8], [79.8, 14.0], [78, 15.7],
        [75.5, 16.6], [73, 16.6],           // bowl bottom
        // the landing slope: a long 28-degree face under the drop, so a
        // jump at any speed (or a timid roll-off) meets ground that falls
        // away with the arc instead of slamming it flat
        [71, 16.0], [68, 14.5],
        [65, 12.9],                         // sill at the top of the slope
        [61, 12.95], [58, 13.1],            // gallery mouth floor
        [54, 12.3], [51, 12.3],             // mound pinched under the ceiling
        [47, 13.8], [44, 14.2], [41, 13.8], // dip under the basalt fang
        [37, 12.4], [34, 12.4],             // ledge
        [30, 13.9], [26, 13.9],             // low step
        [21, 12.6], [16, 12.7],             // climb to the goal shelf
        [8, 12.6], [0, 12.6],               // goal shelf, under the start
        // gallery left wall, up to the gallery ceiling
        [-5, 12.6], [-5, 9.8],
        // gallery ceiling (the underside of the upper storey), left to right
        [43.5, 9.8],
        [44.6, 11.9], [45.8, 11.9],         // the basalt fang
        [47, 9.8], [60, 9.8],
        [64, 8.2],                          // nose face up to the lip tip
        // upper floor, right to left: the lip kicks up like a diving board
        [60.5, 8.6], [57, 8.6],             // step before the lip
        [53, 7.3], [49.5, 7.3],             // upper step
        [46, 5.9], [42.5, 5.9],             // high rim
        [38.5, 7.8],                        // lead-in onto the rim climb
        [36, 8.6], [32.5, 8.6],             // ash dip
        [29, 6.1], [26, 6.1],               // cinder plateau
        [22.5, 7.5],                        // lead-in onto the climb
        [20, 8.3], [17, 8.3],               // dip
        [13.5, 6.7], [10.5, 6.7],           // warmup roller
        [8, 8], [0, 8],
        // left wall
        [-5, 8],
      ],
    ],
    start: { x: 2.5, y: 7.25 },
    burgers: [
      [12, 6.0],     // warmup roller crest
      [27.5, 5.4],   // cinder plateau
      [44.2, 5.2],   // high rim
      [51.2, 6.6],   // upper step
      [63.5, 7.5],   // on the lip, in everyone's path
      [68, 13.75],   // on the landing slope, under every arc
      [74.5, 15.85], // bowl bottom, crossed swinging through
      [52.5, 11.55], // on the gallery mound
      [44.5, 13.45], // in the fang dip, kept low
      [35.5, 11.65], // on the ledge
      [27.5, 13.2],  // on the low step
    ],
    goal: [3.5, 11.85], // directly beneath the start, one storey down
  },
];

// Difficulty tracks, Super-Monkey-Ball style: each difficulty is a fixed
// series of maps played in order. `length` is the planned size of the
// series; `levels` holds the maps that exist so far. A track with no
// levels yet shows up disabled on the difficulty screen.
const TRACKS = [
  { id: 'easy',   label: 'Easy',   color: '#9be08a', length: 10, levels: [LEVELS[0], LEVELS[1], LEVELS[2], LEVELS[3], LEVELS[4], LEVELS[5], LEVELS[6]] },
  { id: 'medium', label: 'Medium', color: '#f9c623', length: 20, levels: [] },
  { id: 'hard',   label: 'Hard',   color: '#ff6038', length: 30, levels: [] },
];
