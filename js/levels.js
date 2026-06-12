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
        [66, 13.43],                        // crest blend: the 28-degree
        [64, 12.9],                         // face rounds off through ~15
                                            // degrees onto the sill, so a
                                            // climb back out of the bowl
                                            // crests instead of bucking
                                            // off a single sharp kink
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
  {
    name: 'Cayenne Coil',
    theme: 'volcano',
    polygons: [
      [
        // ceiling: open sky over the whole massif
        [-5, -16], [134, -16],
        // right wall
        [134, 29.3],
        // floor, right to left
        [128, 29.3], [120, 29.3], [116, 30.7], [113, 30.7], [110.8, 29.97],
        [97.8, 31.8], [91.4, 31.8], [90, 31.3], [89.1, 29.6], [89.2, 28.5],
        [89.6, 27], [90.1, 25.5], [90.8, 24], [88.9, 22.3], [87.3, 22.3],
        [86.05, 22.24], [84.81, 22.06], [83.6, 21.75], [82.42, 21.33],
        [81.28, 20.8], [70, 14.8], [67, 14.8], [64.3, 15.73], [50.3, 17.7],
        [43.9, 17.7], [42.5, 17.2], [41.6, 15.5], [41.7, 14.4], [42.1, 12.9],
        [42.6, 11.4], [43.3, 9.9], [41.4, 8.2], [39.8, 8.2], [38.13, 8.12],
        [36.48, 7.87], [34.86, 7.47], [33.29, 6.91], [31.78, 6.2], [22, 1],
        [20, 0.6], [17.5, 0.2], [14, -1.3], [11, -1.3], [8, 0], [0, 0],
        // left wall
        [-5, 0],
      ],
      // mountain heart 1: the first coil. Generated by _scratch_gen_1_8.js
      [
        [31, 1.5], [38.6, 3.1], [44.51, 4.29], [44.51, 4.29], [46.31, 3.74],
        [46.4, 3.62], [46.49, 3.5], [46.59, 3.38], [46.69, 3.28],
        [46.79, 3.17], [46.96, 3.02], [47.13, 2.88], [47.31, 2.75],
        [47.49, 2.63], [47.68, 2.53], [47.87, 2.44], [48.06, 2.36],
        [48.26, 2.29], [48.45, 2.24], [48.65, 2.19], [48.84, 2.15],
        [49.04, 2.13], [49.23, 2.11], [49.43, 2.1], [49.62, 2.1],
        [49.82, 2.11], [50.01, 2.13], [50.21, 2.16], [50.4, 2.2],
        [50.6, 2.25], [50.79, 2.31], [50.98, 2.38], [51.18, 2.46],
        [51.36, 2.56], [51.55, 2.66], [51.73, 2.78], [51.91, 2.91],
        [52.09, 3.05], [52.25, 3.21], [52.41, 3.38], [52.51, 3.5],
        [52.6, 3.62], [52.69, 3.74], [52.77, 3.87], [52.85, 4],
        [52.92, 4.14], [52.99, 4.28], [53.05, 4.43], [53.11, 4.58],
        [53.16, 4.74], [53.2, 4.9], [53.24, 5.06], [53.26, 5.23],
        [53.28, 5.4], [53.3, 5.57], [53.3, 5.74], [53.3, 5.92],
        [53.29, 6.09], [53.27, 6.27], [53.24, 6.45], [53.2, 6.62],
        [53.15, 6.8], [53.09, 6.98], [53.03, 7.15], [52.95, 7.32],
        [52.87, 7.49], [52.78, 7.65], [52.68, 7.81], [52.57, 7.97],
        [52.45, 8.12], [52.32, 8.26], [52.19, 8.4], [52.05, 8.53],
        [51.9, 8.66], [51.74, 8.78], [51.58, 8.89], [51.41, 8.99],
        [51.23, 9.09], [51.05, 9.17], [50.87, 9.25], [50.68, 9.31],
        [50.49, 9.37], [50.3, 9.42], [50.1, 9.45], [49.9, 9.48],
        [49.7, 9.49], [49.5, 9.5], [49.3, 9.49], [49.1, 9.48], [48.9, 9.45],
        [48.7, 9.42], [48.51, 9.37], [48.39, 9.34], [48.81, 11.46],
        [49.5, 11.5], [50.19, 11.46], [50.87, 11.34], [51.53, 11.14],
        [52.15, 10.86], [52.74, 10.51], [67.19, 8.21], [64.5, 0.2],
        [58, -6.2], [50, -8], [42, -6.6], [34.5, -3.5],
      ],
      // mountain heart 2: the second coil
      [
        [80.5, 16.8], [86.5, 17.7], [92.01, 18.39], [92.01, 18.39],
        [93.81, 17.84], [93.9, 17.72], [93.99, 17.6], [94.09, 17.48],
        [94.19, 17.38], [94.29, 17.27], [94.46, 17.12], [94.63, 16.98],
        [94.81, 16.85], [94.99, 16.73], [95.18, 16.63], [95.37, 16.54],
        [95.56, 16.46], [95.76, 16.39], [95.95, 16.34], [96.15, 16.29],
        [96.34, 16.25], [96.54, 16.23], [96.73, 16.21], [96.93, 16.2],
        [97.12, 16.2], [97.32, 16.21], [97.51, 16.23], [97.71, 16.26],
        [97.9, 16.3], [98.1, 16.35], [98.29, 16.41], [98.48, 16.48],
        [98.68, 16.56], [98.86, 16.66], [99.05, 16.76], [99.23, 16.88],
        [99.41, 17.01], [99.59, 17.15], [99.75, 17.31], [99.91, 17.48],
        [100.01, 17.6], [100.1, 17.72], [100.19, 17.84], [100.27, 17.97],
        [100.35, 18.1], [100.42, 18.24], [100.49, 18.38], [100.55, 18.53],
        [100.61, 18.68], [100.66, 18.84], [100.7, 19], [100.74, 19.16],
        [100.76, 19.33], [100.78, 19.5], [100.8, 19.67], [100.8, 19.84],
        [100.8, 20.02], [100.79, 20.19], [100.77, 20.37], [100.74, 20.55],
        [100.7, 20.72], [100.65, 20.9], [100.59, 21.08], [100.53, 21.25],
        [100.45, 21.42], [100.37, 21.59], [100.28, 21.75], [100.18, 21.91],
        [100.07, 22.07], [99.95, 22.22], [99.82, 22.36], [99.69, 22.5],
        [99.55, 22.63], [99.4, 22.76], [99.24, 22.88], [99.08, 22.99],
        [98.91, 23.09], [98.73, 23.19], [98.55, 23.27], [98.37, 23.35],
        [98.18, 23.41], [97.99, 23.47], [97.8, 23.52], [97.6, 23.55],
        [97.4, 23.58], [97.2, 23.59], [97, 23.6], [96.8, 23.59],
        [96.6, 23.58], [96.4, 23.55], [96.2, 23.52], [96.01, 23.47],
        [95.89, 23.44], [96.31, 25.56], [97, 25.6], [97.69, 25.56],
        [98.37, 25.44], [99.03, 25.24], [99.65, 24.96], [100.24, 24.61],
        [113.69, 22.45], [111, 15.6], [106, 7.7], [98, 5.9], [90, 7.5],
        [83, 10.6],
      ],
    ],
    start: { x: 2.5, y: -0.75 },
    burgers: [
      [12.5, -2.05],  // warmup roller crest
      [19, -0.3],     // on the crest of the first big dive
      [52.6, 4.9],    // on coil 1's right wall, swept up in the climb
      [49.5, 2.85],   // coil 1 apex: collected riding upside down
      [60, 15.6],     // chamber 1 exit slope, on the sweep out (kept well
                      // right of the basin so it never tempts a brake)
      [70, 14.05],    // the ravine crest between the coils
      [100.0, 19.0],  // coil 2's right wall
      [97, 16.95],    // coil 2 apex, inverted again
      [107.5, 29.7],  // chamber 2 exit slope
      [114.5, 29.95], // the dip before the goal shelf
      [121.5, 28.6],  // on the goal shelf
    ],
    goal: [124, 28.55],
  },
  {
    name: 'Paprika Powerline',
    theme: 'volcano',
    // A wire - terrain only the WHEELS touch - runs chest-high through
    // the rider along the plateau, then the ground rolls away beneath it.
    // Roll off slowly (a burger on the wire below baits the brake): the
    // bike noses over the edge, tumbles, and the wire below catches the
    // wheels mid-flip. You hang upside down, head dangling over the
    // lava, drive reversed - flip, gas along the sagging powerline, then
    // off its end volt upright onto the dismount slope. Too fast off the
    // ledge sails past the wire into the chasm.
    polygons: [
      [
        // ceiling: open sky
        [-5, -8], [90, -8],
        // right wall
        [90, 20.6],
        // floor, right to left
        [88, 21.4], [80, 21.4],             // goal shelf
        [76, 22.3], [73, 22.3],             // dip before the shelf
        [67, 21.0], [62, 19.3],             // dismount slope, falling away
        [56, 17.6], [50, 16.5], [45, 15.7], // chasm floor, tracking the
                                            // wire: the hanging head keeps
                                            // ~1.6-2.2 of clearance
        [41.4, 10.4],                       // the cliff: terrain curling
        [41.85, 9.3], [41.95, 8.5],         // under and back, clear of the
                                            // tumbling bike
        [41.5, 7.95],
        [27, 7.95],                         // the wire plateau
        [24.5, 8.4], [22, 8.4],             // dip into the plateau
        [17, 8.1],
        [14, 6.7], [11, 6.7],               // warmup roller
        [8, 8], [0, 8],
        // left wall
        [-5, 8],
      ],
      // the powerline arm: threads the rider chest-high (wheels and head
      // clear; only wheels can touch wire terrain)
      [
        [28.5, 6.2], [36.5, 6.2], [38, 5.95],
        [38, 6.35], [36.5, 6.6], [28.5, 6.6],
      ],
      // the powerline's catch span: sags into the chasm at 9 degrees and
      // catches the wheels of a bike tumbling off the ledge
      [
        [41.9, 12.24], [42.3, 12.3], [46, 12.88], [50, 13.52], [54, 14.15], [58, 14.78],
        [61, 15.26], [63.5, 15.66],
        [63.5, 16.76],
        [61, 16.36], [58, 15.88], [54, 15.25], [50, 14.62], [46, 13.98],
        [42.3, 13.4], [41.9, 13.34],
      ],
    ],
    wires: [1, 2],
    start: { x: 2.5, y: 7.25 },
    burgers: [
      [12.5, 6.0],    // warmup roller crest
      [20, 7.4],      // on the build flat
      [31, 6.85],     // on the powerline, taken through the chest
      [37.5, 6.85],   // on the powerline
      [45.5, 12.25],  // on the catch span below the ledge: bait that
                      // brakes the bot into the slow roll-off
      [50, 15.0],     // under the sagging line: caught with the dangling
                      // head while hanging upside down
      [57, 16.3],     // under the line, same trick
      [64.5, 19.3],   // on the dismount slope
      [82, 20.7],     // on the goal shelf
    ],
    goal: [85, 20.65],
  },
  {
    // Easy #10, the volcano finale: one ride over the whole mountain,
    // and the block's mechanics on the way to a new one. Warmup rollers,
    // then the flank: two 28-degree pitches, the second bored under a
    // basalt roof (feather the throttle or wheelie into the rock), onto
    // the high rim. The rim launches you across the crater mouth onto a
    // floating slab — a fang hangs from the sky over the landing, so a
    // ballooning arc spikes it; undershooters deflect into the gorge,
    // which drains under the slab into the basin and onward. Then the
    // novelty: the caldera is floored with OBSIDIAN — volcanic glass the
    // tires barely grip (`glass` spans below). Engine and brakes are
    // passengers there: dive in committed, carry the speed through two
    // glass waves, and ride the long glass wall up to the far plateau.
    // Stall on the glass and you slide back into a trough, where bare
    // basalt crowns poke through the flow — grip islands to pump back
    // and forth on, halfpipe style, until you can swing out. Grip (and
    // the flame-licked crust) returns on the plateau; rollers to the
    // bucket.
    name: 'Reaper Rim',
    theme: 'volcano',
    polygons: [
      [
        // ceiling: open sky high over the massif
        [-5, -20], [59.5, -20],
        [61.5, -1.5],                       // basalt roof over pitch B
        [70.5, -6.2], [72.5, -6.5],         // tracking the climb, ~2.8 clear
        [74.5, -12], [88.2, -12],
        [89.6, -3.9],                       // the sky fang over the crater
        [91, -12],                          // jump: ballooning arcs spike it
        [93.5, -20], [231, -20],
        // right wall
        [231, 7.8],
        // floor, right to left
        [225, 7.8],                         // goal shelf
        [222, 7.4], [219.5, 7.4],           // last crest
        [216, 8.6], [213.5, 8.6],           // dip
        [211, 7.8],                         // exit plateau: grip returns
        // the glass wall's convex top blend, eased so the climb crests
        // instead of bucking off one kink
        [208.4, 7.85], [206.8, 7.9], [205.2, 8.05], [203.6, 8.35],
        [202, 8.77],
        [190.8, 12.73],                     // the glass wall, 19.5 degrees
        // concave bottom blend onto crown 3
        [189.9, 13.05], [188.9, 13.35], [187.8, 13.58],
        [186.5, 13.7], [183, 13.7],         // crown 3: bare basalt
        // wave 2 (right to left), generated by _scratch_gen_1_10.js:
        // sin^2 bump, rise 4.2, max slope 27.8 deg, kinks <= 2.4 deg
        [182.8, 13.69], [182.5, 13.68], [182.2, 13.65], [181.88, 13.6],
        [181.56, 13.55], [181.22, 13.47], [180.86, 13.38], [180.48, 13.26],
        [180.04, 13.11], [179.54, 12.91], [178.94, 12.65], [178.08, 12.23],
        [176.68, 11.49], [175.28, 10.75], [174.48, 10.36], [173.9, 10.11],
        [173.42, 9.93], [173, 9.78], [172.62, 9.67], [172.26, 9.57],
        [171.92, 9.5], [171.6, 9.44], [171.28, 9.4], [170.98, 9.37],
        [170.68, 9.35], [170.38, 9.35], [170.08, 9.36], [169.78, 9.38],
        [169.48, 9.41], [169.16, 9.45], [168.82, 9.51], [168.46, 9.6],
        [168.08, 9.7], [167.66, 9.83], [167.2, 9.99], [166.64, 10.22],
        [165.92, 10.54], [164.52, 11.24], [163.12, 11.95], [162.2, 12.39],
        [161.58, 12.65], [161.08, 12.84], [160.64, 12.99], [160.24, 13.1],
        [159.88, 13.19], [159.54, 13.26], [159.22, 13.32], [158.9, 13.36],
        [158.6, 13.38], [158.3, 13.4],
        [158, 13.4], [155, 13.4],           // crown 2: bare basalt
        // wave 1 (right to left): rise 3.4, max slope 27 deg
        [154.82, 13.39], [154.56, 13.38], [154.3, 13.35], [154.02, 13.31],
        [153.74, 13.26], [153.44, 13.2], [153.12, 13.11], [152.78, 13.01],
        [152.4, 12.87], [151.94, 12.69], [151.36, 12.44], [150.4, 11.96],
        [149, 11.24], [148.1, 10.8], [147.54, 10.55], [147.1, 10.38],
        [146.72, 10.24], [146.38, 10.14], [146.06, 10.05], [145.76, 9.99],
        [145.48, 9.94], [145.2, 9.9], [144.94, 9.87], [144.68, 9.86],
        [144.42, 9.85], [144.16, 9.85], [143.9, 9.87], [143.62, 9.9],
        [143.34, 9.93], [143.04, 9.99], [142.72, 10.06], [142.38, 10.15],
        [142.02, 10.26], [141.6, 10.41], [141.1, 10.61], [140.4, 10.92],
        [139, 11.6], [137.78, 12.18], [137.18, 12.43], [136.72, 12.61],
        [136.32, 12.74], [135.96, 12.84], [135.64, 12.92], [135.34, 12.98],
        [135.06, 13.03], [134.78, 13.07], [134.52, 13.09], [134.26, 13.1],
        [134, 13.1], [131.16, 13.09],       // crown 1: bare basalt
        // the dive's circular pull-out (right to left), 2.5 deg steps
        [131.07, 13.09], [130.59, 13.07], [130.11, 13.04], [129.63, 12.98],
        [129.16, 12.9], [128.69, 12.81], [128.22, 12.69], [127.77, 12.55],
        [127.31, 12.39], [126.87, 12.21], [126.43, 12.02],
        [126, 11.8],                        // the glass dive, 28 degrees
        // eased crest into the dive, for riders who roll in slow
        [116, 6.2], [115.1, 5.72], [114.2, 5.32], [113.2, 4.93], [112.2, 4.64],
        [111, 4.4],                         // dive crest: the last grip
        [101.5, 4.38], [100.4, 4.3], [99.3, 4.12], [98, 3.8], // settle slope
        [96, 3.1], [89.3, 3.1],             // basin floor, under the slab
        [82.3, -2.1],                       // runout face catches fallers
        [83, -3.7],                         // jump lip, undercut ski-style
        [72.5, -3.7], [70.5, -3.3],         // high rim crest blend
        [63, 0.7],                          // pitch B, 28 deg, under the roof
        [60, 1.7], [55, 1.7],               // cinder pit floor
        [49, -1.4],                         // dive into the pit banks speed
        [45, -1.4],                         // plateau between the pitches
        [43.3, -1.0],                       // crest blend
        [24, 7.0],                          // pitch A: a 22.5-degree grind
        [20, 8.3], [17, 8.2],               // dip before the climb
        [14, 6.7], [11, 6.7],               // warmup roller
        [8, 8], [0, 8],
        // left wall
        [-5, 8],
      ],
      // the crater landing slab: a floating island whose left end is a
      // raked prow — undershooters deflect off it down into the gorge,
      // and the chamfered underside keeps headroom over the runout face
      // for fallers riding out beneath the slab
      [
        [88.6, -1.5], [97, -1.5],
        [97.5, -0.3], [89.5, -0.3],
        [87.3, -1.2],
      ],
    ],
    // obsidian spans of the floor (x ranges): the dive and pull-out, the
    // two waves, and the wall — the crowns between them keep their grip
    glass: [[116.3, 131.5], [139, 155], [163, 183], [191.5, 208.5]],
    start: { x: 2.5, y: 7.25 },
    burgers: [
      [12.5, 6.0],    // warmup roller crest
      [33, 2.6],      // mid-grind on pitch A
      [47, -2.05],    // plateau between the pitches
      [67, -2.1],     // under the basalt roof, mid-climb
      [75.5, -4.35],  // on the high rim
      [86, -4.1],     // floating in the crater-jump arc
      [91.5, -2.15],  // on the landing slab
      [100.5, 3.65],  // below the slab's edge: brakes the bot into a
                      // slow roll-off down to the settle slope
      [106, 3.75],    // on the run-up, at body height
      [121, 8.4],     // on the glass dive face
      [132.5, 12.45], // on crown 1
      [170.5, 8.7],   // wave 2 crest, in the skim
      [184.5, 13.05], // on crown 3, before the wall
      [196, 10.25],   // halfway up the glass wall
      [220.5, 6.75],  // the last crest before the shelf
    ],
    goal: [227.5, 7.05],
  },
];

// Difficulty tracks, Super-Monkey-Ball style: each difficulty is a fixed
// series of maps played in order. `length` is the planned size of the
// series; `levels` holds the maps that exist so far. A track with no
// levels yet shows up disabled on the difficulty screen.
const TRACKS = [
  { id: 'easy',   label: 'Easy',   color: '#9be08a', length: 10, levels: [LEVELS[0], LEVELS[1], LEVELS[2], LEVELS[3], LEVELS[4], LEVELS[5], LEVELS[6], LEVELS[7], LEVELS[8], LEVELS[9]] },
  { id: 'medium', label: 'Medium', color: '#f9c623', length: 20, levels: [] },
  { id: 'hard',   label: 'Hard',   color: '#ff6038', length: 30, levels: [] },
];
