// Mobile UI clipping check: renders every menu/HUD/overlay screen across a
// matrix of real phone viewport sizes (portrait and landscape) under a stub
// DOM whose measureText approximates the monospace UI font, and fails if any
// text or button label clips off the screen edges. Catches the fixed-pixel
// regressions that make headings, instructions, and crash/finish messages
// run off a narrow phone. Run with: node test/mobile_ui_check.js
//
// Pairs with the responsive layout in render.js (fitFont/wrapLines and the
// shrink-to-fit menuRects/replayRects/audioRects): the canvas is sized to
// innerWidth x innerHeight with no DPR scaling, so the UI's px fonts live in
// CSS-pixel space and a 360px-wide phone really is 360 units across.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fail = 0;
function bad(msg) { console.log('FAIL', msg); fail++; }

// Consolas (the UI's first font) advances ~0.55em per glyph; Comic Sans (the
// in-world gag bubble, not part of the chrome) a touch tighter.
function ratioFor(font) { return /Comic Sans/.test(font) ? 0.52 : 0.55; }
function pxOf(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? parseFloat(m[1]) : 16;
}

// a 2D context that tracks transform (scale + translate; rotation, which the
// UI only uses for tiny title wobble, is ignored), the font/alignment, and
// records every text draw as a device-pixel box for the clip check
function makeCtx(W, H, sink) {
  let st = { sx: 1, sy: 1, tx: 0, ty: 0, font: '16px monospace',
             align: 'start', baseline: 'alphabetic' };
  const stack = [];
  const rec = (text, x, y) => {
    text = String(text);
    const px = pxOf(st.font), w = text.length * ratioFor(st.font) * px;
    let lx = x;
    if (st.align === 'center') lx = x - w / 2;
    else if (st.align === 'right' || st.align === 'end') lx = x - w;
    let ty;
    if (st.baseline === 'top' || st.baseline === 'hanging') ty = y;
    else if (st.baseline === 'middle') ty = y - px / 2;
    else ty = y - px * 0.8;
    sink.push({ text, left: st.tx + st.sx * lx, right: st.tx + st.sx * (lx + w),
      top: st.ty + st.sy * ty, bottom: st.ty + st.sy * (ty + px) });
  };
  const obj = {
    canvas: { width: W, height: H },
    set font(v) { st.font = v; }, get font() { return st.font; },
    set textAlign(v) { st.align = v; }, get textAlign() { return st.align; },
    set textBaseline(v) { st.baseline = v; }, get textBaseline() { return st.baseline; },
    save() { stack.push(Object.assign({}, st)); },
    restore() { if (stack.length) st = stack.pop(); },
    setTransform(a, b, c, d, e, f) { st.sx = a; st.sy = d; st.tx = e; st.ty = f; },
    translate(x, y) { st.tx += st.sx * x; st.ty += st.sy * y; },
    scale(x, y) { st.sx *= x; st.sy *= y; },
    rotate() {},
    fillText(t, x, y) { rec(t, x, y); },
    strokeText(t, x, y) { rec(t, x, y); },
    measureText(t) { return { width: String(t).length * ratioFor(st.font) * pxOf(st.font) }; },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({ setTransform() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    drawImage() {},
  };
  return new Proxy(obj, {
    get(t, p) { return p in t ? t[p] : (typeof p === 'symbol' ? undefined : (t[p] = () => {})); },
    set(t, p, v) { t[p] = v; return true; },
  });
}

function makeCanvas() {
  return { width: 0, height: 0, style: {},
    getContext() { return makeCtx(this.width, this.height, []); }, addEventListener() {} };
}
global.window = { innerWidth: 800, innerHeight: 600, addEventListener() {},
  matchMedia: () => ({ matches: false }) };
global.document = { getElementById: () => makeCanvas(), createElement: () => makeCanvas() };
global.performance = { now: () => 0 };
global.DOMMatrix = function (m) { this.m = m; };
global.Image = function () { return {}; };
global.matchMedia = () => ({ matches: false });
global.makeCtx = makeCtx;

// const/function declared inside eval don't leak out, so hand the render
// entry points back via global.__R (same pattern as the other harnesses)
const code = ['js/assets.js', 'js/physics.js', 'js/render.js', 'js/touch.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n')
  + '\nglobal.__R = { drawLoading, drawMainMenu, drawDifficulty, drawReady, drawPause,'
  + ' drawAudio, drawContinue, drawLevelLoadError, drawReplays, drawLevelSelect, drawVictory, drawHUD,'
  + ' drawRecords, drawEquipment, drawTitleLetters, makePatterns, TOUCH, setSafeInsets, saveButtonRect,'
  + ' menuRects, audioRects, replayRects, recordsRects, equipSlotRects, equipItemRects, minimapRect,'
  + ' victoryRects, victoryCardBox, victoryLandscape };';
eval(code);

const R = global.__R;
R.TOUCH.activate(); // pretend we're on a touch device for the on-screen controls
const pat = R.makePatterns(makeCtx(800, 600, []));

const TRACKS = [
  { id: 'beginner', label: 'Beginner', color: '#9be08a', length: 10, levels: new Array(10).fill(0) },
  { id: 'advanced', label: 'Advanced', color: '#f9c623', length: 20, levels: [] },
  { id: 'expert', label: 'Expert', color: '#ff6038', length: 30, levels: [] },
];
const NAMES = ['Burger Hill', 'Cheddar Canyon', 'Onion Underpass', 'Patty Bridge',
  'Skewer Gorge', 'Habanero Heights', 'Scoville Switchback', 'Cayenne Coil',
  'Sriracha Spiral', 'Reaper Rim'];
const results = NAMES.map((_, i) => ({ time: 83.45 + i, style: 1200 + i,
  timeRecord: i % 2 === 0, styleRecord: i % 3 === 0 }));

// every screen at its mobile worst case (longest realistic strings, touch on)
const SCENES = {
  loading: (c, W, H) => R.drawLoading(c, W, H, 0.4, 0, false, true),
  'loading-ready': (c, W, H) => R.drawLoading(c, W, H, 1, 0, true, true),
  menu: (c, W, H) => { R.drawTitleLetters(c, W, H, 3);
    R.drawMainMenu(c, W, H, 1, ['Play', 'Records', 'Replays', 'Map Editor', 'Equipment', 'Audio'], 0, -1,
      { show: true, hot: true }); },
  difficulty: (c, W, H) => R.drawDifficulty(c, W, H, 1, TRACKS, 0, -1, true),
  records: (c, W, H) => R.drawRecords(c, W, H, 1, { label: 'Beginner', color: '#9be08a',
    names: NAMES, results, hover: -1, canPrev: false, canNext: true, touch: true }),
  'records-empty': (c, W, H) => R.drawRecords(c, W, H, 1, { label: 'Advanced', color: '#f9c623',
    names: [], results: [], hover: -1, canPrev: true, canNext: false, touch: true }),
  // equipment character sheet: the Skins slot selected, item column focused on a
  // locked item so the detail line shows the unlock requirement (worst-case
  // longest blurb), with the full slot list and an owned/locked item mix
  equipment: (c, W, H) => R.drawEquipment(c, W, H, 1, {
    slots: [
      { label: 'Skins', equipped: 'Afterburner', selected: true },
      { label: 'Bikes', equipped: 'Standard', selected: false },
      { label: 'Helmet', equipped: '—', selected: false },
      { label: 'Jacket', equipped: '—', selected: false },
      { label: 'Gloves', equipped: '—', selected: false },
      { label: 'Pants', equipped: '—', selected: false },
      { label: 'Boots', equipped: '—', selected: false },
    ],
    slotLabel: 'Skins', slotBlurb: 'Matching livery for your bike and rider.', slotKind: 'skin',
    items: [
      { name: 'Stock Blue', tier: 0, owned: true, equipped: false, requirement: '',
        desc: 'The factory machine. Honest blue paint, nothing to prove.' },
      { name: 'Warmed Up', tier: 1, owned: true, equipped: false, requirement: '',
        desc: 'An orange race stripe and twin pipes — the engine is starting to run hot.' },
      { name: 'Red Hot', tier: 2, owned: false, equipped: false, requirement: 'Clear the Advanced track',
        desc: 'Crimson frame, flame decals and real fire spitting from a fat pipe.' },
      { name: 'Afterburner', tier: 3, owned: true, equipped: true, requirement: '',
        desc: 'Blacked-out frame, blue plasma burners and glowing rims.' },
    ],
    sel: 2, hover: -1, focus: 'items', previewTier: 3, t: 0, touch: true, backHot: false }),
  // an empty gear slot selected (Helmet) — the coming-soon placeholder
  'equipment-empty': (c, W, H) => R.drawEquipment(c, W, H, 1, {
    slots: [
      { label: 'Skins', equipped: 'Stock Blue', selected: false },
      { label: 'Bikes', equipped: 'Standard', selected: false },
      { label: 'Helmet', equipped: '—', selected: true },
      { label: 'Jacket', equipped: '—', selected: false },
      { label: 'Gloves', equipped: '—', selected: false },
      { label: 'Pants', equipped: '—', selected: false },
      { label: 'Boots', equipped: '—', selected: false },
    ],
    slotLabel: 'Helmet', slotBlurb: 'Head protection.', slotKind: 'gear',
    items: [], sel: 0, hover: -1, focus: 'slots', previewTier: 0, t: 0, touch: true, backHot: false }),
  ready: (c, W, H) => R.drawReady(c, W, H, '09  Sriracha Spiral', true),
  pause: (c, W, H) => R.drawPause(c, W, H, ['Continue', 'Audio', 'Return to Menu'], 0, -1),
  audio: (c, W, H) => R.drawAudio(c, W, H, 1, { volume: { master: 0.8, music: 0.6, sfx: 1 },
    sel: 0, hover: -1, dim: true, muted: true, touch: true }),
  continue: (c, W, H) => R.drawContinue(c, W, H, 1, 0, 2, 0, -1),
  'continue-lose': (c, W, H) => R.drawContinue(c, W, H, 1, 0, 0, 0, -1),
  loaderror: (c, W, H) => R.drawLevelLoadError(c, W, H, 0, -1),
  replays: (c, W, H) => R.drawReplays(c, W, H, 1,
    [{ label: 'Scoville Switchback', sub: 'style 1234 - 01:23,45' },
     { label: 'Choose a Different Folder...' }], 0, 0, -1,
    'Reopen the folder to load replays', true),
  skip: (c, W, H) => R.drawLevelSelect(c, W, H, 1, { label: 'Beginner', touch: true,
    sel: 0, scroll: 0, hover: -1,
    items: NAMES.map((n, i) => ({ label: (i + 1) + '  ' + n, sub: 'Map ' + (i + 1) + '/10' })) }),
  victory: (c, W, H) => R.drawVictory(c, W, H, { t: 0, pat: pat.meadow, label: 'Beginner',
    names: NAMES, results, sel: 0, hover: -1, touch: true, saveNote: 'Saved reaper-rim.bmr' }),
  'hud-finished': (c, W, H) => R.drawHUD(c, W, H, { time: 83.45, best: 80, style: 1234,
    styleBest: 2000, got: 3, total: 3, lives: 3, theme: pat.meadow, state: 'finished',
    hasNext: true, touch: true, saveNote: 'S: save replay', mapLabel: '09  Sriracha Spiral' }),
  'hud-dead': (c, W, H) => R.drawHUD(c, W, H, { time: 83.45, best: 80, style: 1234,
    styleBest: 2000, got: 1, total: 3, lives: 2, theme: pat.meadow, state: 'dead',
    touch: true, saveNote: 'S: save replay' }),
  'hud-dead-out': (c, W, H) => R.drawHUD(c, W, H, { time: 83.45, best: null, style: 0,
    styleBest: null, got: 0, total: 3, lives: 0, theme: pat.meadow, state: 'dead', touch: true }),
  'hud-replay-finished': (c, W, H) => R.drawHUD(c, W, H, { time: 83.45, best: 80, style: 1234,
    styleBest: 2000, got: 3, total: 3, theme: pat.meadow, state: 'playing', touch: true,
    replay: { label: 'Scoville Switchback', done: true, outcome: 'finished' } }),
  'hud-test-finished': (c, W, H) => R.drawHUD(c, W, H, { time: 83.45, got: 3, total: 3,
    theme: pat.meadow, state: 'playing', touch: true, mapLabel: 'My Custom Map Name',
    test: { done: true, outcome: 'finished' } }),
  'hud-ready': (c, W, H) => R.drawHUD(c, W, H, { time: 0, best: null, style: 0, styleBest: null,
    got: 0, total: 3, lives: 3, theme: pat.meadow, state: 'ready', touch: true,
    mapLabel: '01  Burger Hill' }),
  'touch-finished': (c, W, H) => R.TOUCH.draw(c, W, H, { state: 'finished', saveBusy: false }),
  'touch-skip': (c, W, H) => R.TOUCH.draw(c, W, H, { state: 'skip' }),
};

// portrait + landscape, from an old iPhone SE up to a Pro Max
const SIZES = [
  [320, 568], [375, 667], [360, 640], [390, 844], [430, 932],
  [568, 320], [667, 375], [640, 360], [844, 390], [932, 430],
];

// every drawn label must stay inside the given bounds (the screen, or — with
// safe-area insets — the band clear of the notch / home indicator)
function checkText(tag, sink, bounds) {
  for (const t of sink) {
    if (!t.text.trim()) continue;
    if (t.left < bounds.left - 0.5 || t.right > bounds.right + 0.5) {
      bad(`${tag}: "${t.text}" clips horizontally `
        + `[${t.left.toFixed(0)}..${t.right.toFixed(0)}] vs [${bounds.left}..${bounds.right.toFixed(0)}]`);
    }
    if (t.top < bounds.top - 0.5 || t.bottom > bounds.bottom + 0.5) {
      bad(`${tag}: "${t.text}" clips vertically `
        + `[${t.top.toFixed(0)}..${t.bottom.toFixed(0)}] vs [${bounds.top}..${bounds.bottom.toFixed(0)}]`);
    }
  }
}

function runPass(sizes, inset) {
  R.setSafeInsets(inset);
  const tag = (inset.top || inset.right || inset.bottom || inset.left)
    ? ` [safe ${inset.top}/${inset.right}/${inset.bottom}/${inset.left}]` : '';
  for (const [name, fn] of Object.entries(SCENES)) {
    for (const [W, H] of sizes) {
      const sink = [];
      try { fn(makeCtx(W, H, sink), W, H); }
      catch (e) { bad(`${name} @ ${W}x${H}${tag} threw: ${e.message}`); continue; }
      checkText(`${name} @ ${W}x${H}${tag}`, sink, {
        left: inset.left, right: W - inset.right,
        top: inset.top, bottom: H - inset.bottom });
    }
  }
  R.setSafeInsets({});
}

// pass 1: no insets, every size (portrait + landscape) — desktop / unnotched
runPass(SIZES, { top: 0, right: 0, bottom: 0, left: 0 });

// pass 2: a notched phone held in landscape — side cutouts plus a
// home-indicator strip along the bottom. Every screen's lettering must stay
// inside the safe band, never under a cutout.
const LANDSCAPE = SIZES.filter(([W, H]) => W > H);
const NOTCH = { top: 0, right: 47, bottom: 21, left: 47 };
runPass(LANDSCAPE, NOTCH);

// the on-screen touch controls must sit inside that band too, or a thumb
// would have to reach into the notch / home indicator to press them
R.setSafeInsets(NOTCH);
for (const [W, H] of LANDSCAPE) {
  const L = R.TOUCH.layout(W, H);
  for (const key of ['left', 'right', 'flip', 'brake', 'gas', 'pause', 'save', 'back']) {
    const r = L[key];
    if (r.x < NOTCH.left - 0.5 || r.x + r.w > W - NOTCH.right + 0.5 ||
        r.y < NOTCH.top - 0.5 || r.y + r.h > H - NOTCH.bottom + 0.5) {
      bad(`touch ${key} @ ${W}x${H} outside the safe band: `
        + `[x ${r.x.toFixed(0)}..${(r.x + r.w).toFixed(0)}, `
        + `y ${r.y.toFixed(0)}..${(r.y + r.h).toFixed(0)}] vs `
        + `[${NOTCH.left}..${W - NOTCH.right}, ${NOTCH.top}..${H - NOTCH.bottom}]`);
    }
  }
}
R.setSafeInsets({});

// the victory feast: on a short landscape screen the scorecard docks to the
// right half so the lower-left champion stays in view, with the Back-to-Menu
// button tucked beneath it — never overlapping the card, the rider, or the
// bottom safe edge.
function checkVictoryLayout(inset) {
  R.setSafeInsets(inset);
  const tag = (inset.top || inset.right || inset.bottom || inset.left)
    ? ` [safe ${inset.top}/${inset.right}/${inset.bottom}/${inset.left}]` : '';
  for (const [W, H] of LANDSCAPE) {
    if (!R.victoryLandscape(W, H)) { bad(`victory @ ${W}x${H}${tag}: expected the docked layout`); continue; }
    const card = R.victoryCardBox(W, H);
    const btn = R.victoryRects(W, H)[0];
    const sb = H - inset.bottom;
    if (card.x < inset.left - 0.5 || card.x + card.w > W - inset.right + 0.5 ||
        card.y < inset.top - 0.5 || card.y + card.h > sb + 0.5) {
      bad(`victory card @ ${W}x${H}${tag} outside the safe band`);
    }
    if (btn.x < inset.left - 0.5 || btn.x + btn.w > W - inset.right + 0.5 ||
        btn.y + btn.h > sb + 0.5) {
      bad(`victory button @ ${W}x${H}${tag} off the safe band`);
    }
    if (btn.y < card.y + card.h - 0.5) {
      bad(`victory button @ ${W}x${H}${tag} overlaps the scorecard `
        + `(button y ${btn.y.toFixed(0)} vs card bottom ${(card.y + card.h).toFixed(0)})`);
    }
    // the feasting champion sits lower-left (drawn at x ~0.27W, scale 2.1);
    // the card must clear his right edge so he's never buried
    const Z = Math.min(W / 26, H / 13.5);
    const bikerRight = 0.27 * W + 1.365 * Z;
    if (card.x < bikerRight + 12) {
      bad(`victory card @ ${W}x${H}${tag} buries the champion `
        + `(card x ${card.x.toFixed(0)} vs rider right ${bikerRight.toFixed(0)})`);
    }
  }
  R.setSafeInsets({});
}
checkVictoryLayout({ top: 0, right: 0, bottom: 0, left: 0 });
checkVictoryLayout(NOTCH);

console.log(fail ? `FAILED (${fail})` : 'OK');
process.exit(fail ? 1 : 0);
