'use strict';

(function () {
  // One-time records reset, tied to the sim version. Best times and style
  // scores are only comparable within one physics build, so whenever the sim
  // changes (REPLAY.VERSION bumps on any physics/step/input change) we drop the
  // saved records once and stamp the new version. Reloads on the same version
  // see a matching stamp and leave storage untouched — no manual bump needed.
  // Only the best-/style- record keys are cleared; volume prefs, saved editor
  // maps, and the editor autosave are deliberately left intact.
  const SIM_VER_KEY = 'burger-mania-sim-version';
  try {
    const cur = String(REPLAY.VERSION);
    if (localStorage.getItem(SIM_VER_KEY) !== cur) {
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.indexOf('burger-mania-best-') === 0 ||
                  k.indexOf('burger-mania-style-') === 0)) drop.push(k);
      }
      drop.forEach(k => localStorage.removeItem(k));
      localStorage.setItem(SIM_VER_KEY, cur); // stamp so reloads on this version are untouched
    }
  } catch (e) { /* storage blocked or stubbed (headless tests) — nothing to reset */ }

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;

  // A hidden probe whose padding is set to the safe-area insets lets us read
  // the notch/home-indicator sizes in px (env() can't be read off a custom
  // property reliably, but resolves fine as resolved padding).
  let safeProbe = null;
  function measureInsets() {
    let s = { top: 0, right: 0, bottom: 0, left: 0 };
    try {
      if (!safeProbe && document.body) {
        safeProbe = document.createElement('div');
        safeProbe.style.cssText =
          'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;' +
          'pointer-events:none;' +
          'padding-top:env(safe-area-inset-top);' +
          'padding-right:env(safe-area-inset-right);' +
          'padding-bottom:env(safe-area-inset-bottom);' +
          'padding-left:env(safe-area-inset-left);';
        document.body.appendChild(safeProbe);
      }
      if (safeProbe && typeof getComputedStyle === 'function') {
        const cs = getComputedStyle(safeProbe);
        s = { top: parseFloat(cs.paddingTop) || 0,
              right: parseFloat(cs.paddingRight) || 0,
              bottom: parseFloat(cs.paddingBottom) || 0,
              left: parseFloat(cs.paddingLeft) || 0 };
      }
    } catch (e) { /* stub DOM (headless harnesses) — leave insets at zero */ }
    if (typeof setSafeInsets === 'function') setSafeInsets(s);
  }

  // Size the backing store to the canvas's own laid-out box (it's pinned
  // position:fixed inset:0, so that's the full visual viewport). Measuring the
  // element rather than window.innerWidth/Height keeps the canvas filling the
  // screen and keeps clientX/Y touch coords mapping 1:1 to canvas pixels.
  function resize() {
    const vv = window.visualViewport;
    W = canvas.width = canvas.clientWidth ||
      Math.round((vv && vv.width) || window.innerWidth);
    H = canvas.height = canvas.clientHeight ||
      Math.round((vv && vv.height) || window.innerHeight);
    measureInsets();
  }
  window.addEventListener('resize', resize);
  // iOS often reports stale dimensions during a rotation, so re-measure once
  // the new orientation has settled
  window.addEventListener('orientationchange', () => { resize(); setTimeout(resize, 300); });
  if (window.visualViewport && window.visualViewport.addEventListener) {
    window.visualViewport.addEventListener('resize', resize);
  }
  resize();

  const patterns = makePatterns(ctx);

  // loading -> intro -> menu -> difficulty -> ready -> playing ->
  // dead | finished (dead -> continue once lives run out), with paused
  // overlaying any in-game state. Finishing a track's LAST map goes to
  // victoryFade instead of finished: a slow dissolve into the victory
  // feast ('victory'), which routes back to the menu
  let state = 'loading';
  // The service-worker update glue (index.html) asks this before swapping in a
  // freshly deployed build: a reload mid-ride would throw away the player's
  // active attempt, so 'playing'/'paused' are unsafe; everything else (menus,
  // ready, victory, dead) has nothing live to lose. Read lazily via the closure
  // so it always reflects the current state.
  window.__bmSafeToReload = () => state !== 'playing' && state !== 'paused';
  let bike = null, time = 0, burgers = [], headBody = null;
  let currentTrack = null, levelIndex = 0;
  const MAX_CONTINUES = 2;
  let lives = 3, continues = MAX_CONTINUES, checkpointIndex = 0;
  // this campaign's outcome per map ({ time, style, record flags } by map
  // index) — the victory scorecard; sparse where the skip cheat jumped past
  let runResults = [];
  // true while this campaign is still flawless: no life lost and no continue
  // burned. A perfect track clear earns the ghetto victory feast (and its
  // ominous pacing cameo); any death or continue clears it.
  let runPerfect = true;
  // The real maps are fetched from levels/*.bmm at boot (loadTracks below);
  // until they land the engine boots on a throwaway placeholder so the bike and
  // camera have something valid to sit on behind the loading screen.
  let currentRaw = BOOT_LEVEL; // unprepared level data (what a saved replay embeds)
  let level = prepareLevel(BOOT_LEVEL);
  let bestKey = 'burger-mania-best-' + level.name;
  let best = parseFloat(localStorage.getItem(bestKey) || '');
  if (!isFinite(best)) best = null;
  // style points: airborne tricks pay out on the spot; a finished run
  // banks the per-level best, a second record to chase alongside time
  let styleKey = 'burger-mania-style-' + level.name;
  let styleBest = parseInt(localStorage.getItem(styleKey) || '', 10);
  if (!isFinite(styleBest)) styleBest = null;
  let stylePts = 0;     // this run's total
  let spinAcc = 0;      // net rotation accumulated toward the next full lap
  let wheelieT = 0;     // seconds the current unbroken wheelie has been held
  let stoppieT = 0;     // same, for an unbroken stoppie (front down, rear up)
  let stylePopups = []; // floating "+N" toasts riding above the biker
  let popupSeq = 0;     // cycles spawn lanes so stacked toasts stay legible
  // defibrillator one-ups: a runtime list parallel to burgers (own pickup, does
  // NOT count toward the burger/goal total), plus the cosmetic state a grab
  // kicks off — the electrocution zaps over the rider, the "+1 LIFE" toasts, and
  // a timer that animates the freshly-won head into the lives row.
  let defibs = [];      // [{ x, y, got }] for this run
  // a defibrillator is a one-up that exists ONCE PER CONTINUE, not once per map:
  // once grabbed it stays gone for the rest of this set of lives, so dying and
  // respawning never re-floats a life you already banked (it can't be farmed by
  // crashing on purpose). Spending a continue is the reset point — it re-floats
  // every defib. This set remembers the consumed ones by "<levelIndex>:<defibIndex>"
  // until then; reset() reads it when rebuilding the run's defib list. It's cleared
  // when a continue is used and when a fresh world is entered (startGame / a replay
  // / an editor test ride) so those contexts always start with every defib present.
  let consumedDefibs = new Set();
  let zaps = [];        // [{ age }] live electrocution animations (see drawElectrocution)
  let lifePopups = [];  // [{ text, age }] floating "+1 LIFE" combat text
  let lifeAnimT = 99;   // seconds since the last life was banked (99 = settled)
  const LIFE_HEAD_POP = 0.7; // how long the new head's zap-in animation runs
  let exhaust = [];     // live exhaust smoke puffs (cosmetic; see emitExhaust)
  let exhaustAcc = 0;   // fractional puff carried between frames so a low rate
                        // still spits the odd puff instead of rounding to zero
  let dirt = [];        // live kicked-up dirt clods (cosmetic; see emitDirt)
  let dirtAcc = 0;      // fractional clod carried between frames (as exhaustAcc)
  let puffs = [];       // live landing air-puffs (cosmetic; see emitLandingPuff)
  let cam = { x: level.start.x, y: level.start.y };
  const CAM_LEAD = 4.2; // how far the view centers ahead of the bike's facing
  let camLead = CAM_LEAD; // smoothed, so turning around pans rather than snaps
  // wheel-touchdown sound: drop speed (m/s) below which a landing is silent,
  // and the span above it over which the thud ramps to full volume
  const WHEEL_HIT_MIN = 1.3, WHEEL_HIT_SPAN = 5.0;
  // suspension "crank": how hard the springs are working — each grounded wheel's
  // spring deflection away from its resting sag (SUSP_REST) plus how fast that
  // spring is moving, weighted and summed. SUSP_FULL is the load that drives the
  // crank to full drama; the per-sim-frame peak is held in suspLevel and bled off
  // by SUSP_RELEASE each frame, so a slam cranks loud and rings down while a
  // sustained press (climbing a ramp) holds the sound up
  const SUSP_REST = PHYS.frameM * PHYS.g / 2 / PHYS.springK; // static sag
  const SUSP_DEV_W = 1.0, SUSP_VEL_W = 0.12, SUSP_FULL = 1.0, SUSP_RELEASE = 0.88;
  let suspLevel = 0; // smoothed suspension drama, ~0..SUSP_FULL
  let flipQueued = false;
  const keys = { up: false, down: false, left: false, right: false };
  // the input the sim consumed this frame (from keys, or from a replay
  // tape during playback) — the engine sound follows it either way
  let simInput = { throttle: false, brake: false, left: false, right: false };

  // ---------- screens ----------
  let loadFrac = 0, loadDone = false;
  // performance-clock seconds at which the player dismissed the loading
  // overlay. The whole menu world (clouds, drifting burgers, the rising
  // astronaut) is clocked from here rather than from page load, so nothing
  // animates until the player taps in — and the astro gag stays parked for a
  // good while after that. -1 means "still on the loading overlay".
  let menuClock0 = -1;
  let introT = 0, menuT = 0, diffT = 0, contT = 0;
  let introLaunched = 0, introLanded = 0, fanfared = false;
  // dev-only cheats (the level-skip picker) unlock on a local dev host —
  // localhost / 127.0.0.1 / ::1 — so a player on the live site can't reach
  // them. Mirrors the dev-host list index.html uses to disable the SW.
  const cheatsEnabled = (function () {
    try {
      const h = (window.location && window.location.hostname) || '';
      return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' ||
             h === '::1' || h === '0.0.0.0';
    } catch (e) { return false; }
  })();
  // Play is the hero slab; the rest fill the grid beneath it (see drawMainMenu).
  // The Map Editor needs a keyboard/mouse, so it's dropped on touch devices
  // (phones/tablets announce a coarse primary pointer). Every consumer reads
  // this array by index/length, so filtering it keeps them all in lockstep.
  // NOTE: Equipment is appended just before Audio so the headless tests that
  // navigate by counting ArrowDowns (Records=1, Replays=2, Map Editor=3) and the
  // "Audio stays last" assumption all still hold; don't reorder casually.
  const menuItems = ['Play', 'Records', 'Replays', 'Map Editor', 'Equipment', 'Audio']
    .filter(it => it !== 'Map Editor' || !TOUCH.active);
  // the level-skip cheat is dev-only. Rather than a real menu item it shows as
  // a separate, dashed "dev tool" chip just above the version stamp (drawSkipChip),
  // so it can never be mistaken for a player-facing button.
  const devSkip = cheatsEnabled;
  let menuSel = 0, diffSel = 0, contSel = 0, errSel = 0;
  let skipHover = false; // the cursor/finger is over the dev Skip chip
  let backHover = false; // the cursor is over a sub-screen's corner Back button
  let loadErrorIndex = 0; // which map index the 'levelLoadError' screen will retry
  const pauseItems = ['Continue', 'Audio', 'Return to Menu'];
  let pauseSel = 0, pausedFrom = 'playing';
  let hoverIdx = -1;
  const mouse = { x: -1, y: -1 };

  // Only the image assets gate the loading screen. The level maps load lazily
  // from levels/*.bmm — a track fetches its first map when it's entered, then
  // prefetches the next in the background (see ensureLevel / enterLevel) — so
  // nothing is fetched until it's needed, and a track's maps never load unless
  // it's actually played. (fetch() needs http(s); over file:// it throws, which
  // is why the game is served — npm start.)
  loadAssets((done, total) => { loadFrac = total ? done / total : 1; })
    .then(() => { loadDone = true; resumeAfterSwReload(); });

  // ---------- equipment ----------
  // Equipment is a general gear system modelled like an MMO character sheet: the
  // rider has a SLOT for each part of the loadout (Skin, Bike, plus the worn gear
  // — Helmet, Jacket, Gloves, Pants, Boots), and each slot holds one equipped
  // item gated behind an unlock "achievement". Today only Skins are populated
  // (render.js's "Heat & Flames" tier ladder via bikePalette/BIKE_SKIN) and Bikes
  // has a single Standard model; the gear slots are intentionally empty but wired
  // so dropping items into EQUIPMENT lights them up. Cosmetic items just set a
  // look; a future gameplay item (a faster bike model, brake-boosting gloves, a
  // bump-proof helmet) would carry an `effects` block the sim reads. The whole
  // loadout is persisted per slot, so we always know what to equip in-game.
  const CLEARED_KEY = (track) => 'burger-mania-cleared-' + track.id;

  // the character-sheet slots, in display order. `kind` groups them: 'skin'
  // (drives the cosmetic tier), 'bike' (the machine/conveyance), 'gear' (worn
  // pieces that, for now, the skin already provides the look for). Each holds one
  // equipped item at a time.
  const EQUIP_SLOTS = [
    { id: 'skin',   kind: 'skin', label: 'Skins',  blurb: 'Matching livery for your bike and rider.' },
    { id: 'bike',   kind: 'bike', label: 'Bikes',  blurb: 'The machine you ride.' },
    { id: 'helmet', kind: 'gear', label: 'Helmet', blurb: 'Head protection.' },
    { id: 'jacket', kind: 'gear', label: 'Jacket', blurb: 'Riding jacket.' },
    { id: 'gloves', kind: 'gear', label: 'Gloves', blurb: 'Grip and brake feel.' },
    { id: 'pants',  kind: 'gear', label: 'Pants',  blurb: 'Riding trousers.' },
    { id: 'boots',  kind: 'gear', label: 'Boots',  blurb: 'Footwear.' },
  ];

  // the catalog. `id` is the stable localStorage key; `slot` files it under a
  // slot; `tier` (skins) maps to bikePalette. `unlock` is the achievement gate —
  // {kind:'default'} is always owned, {kind:'clearTrack',track} needs that
  // difficulty cleared. `secret` items stay hidden from the sheet until unlocked
  // (the Master skin — granted by the equipMaster() backdoor or the hidden Master
  // track). NOTE: the Master helmet is part of the Master SKIN (drawHead paints
  // it from the skin), NOT a Helmet-slot item — the Helmet slot is empty for now.
  // Future gameplay items add an `effects` block here.
  const EQUIPMENT = [
    { id: 'skin-stock', slot: 'skin', tier: 0, name: 'Stock Blue',
      desc: 'The factory machine. Honest blue paint, nothing to prove.',
      unlock: { kind: 'default' } },
    { id: 'skin-warmed', slot: 'skin', tier: 1, name: 'Warmed Up',
      desc: 'An orange race stripe and twin pipes — the engine is starting to run hot.',
      unlock: { kind: 'clearTrack', track: 'beginner' } },
    { id: 'skin-redhot', slot: 'skin', tier: 2, name: 'Red Hot',
      desc: 'Crimson frame, flame decals and real fire spitting from a fat pipe.',
      unlock: { kind: 'clearTrack', track: 'advanced' } },
    { id: 'skin-afterburner', slot: 'skin', tier: 3, name: 'Afterburner',
      desc: 'Blacked-out frame, blue plasma burners and glowing rims.',
      unlock: { kind: 'clearTrack', track: 'expert' } },
    { id: 'skin-master', slot: 'skin', tier: 4, name: 'Master', secret: true,
      desc: 'The obsidian-and-gold champion machine. Almost no one rides this.',
      unlock: { kind: 'clearTrack', track: 'master' } },
    // Bikes: only the standard two-wheeler for now. Future conveyances (a
    // hoverboard, etc.) take the same skins but carry their own `effects` for
    // different handling.
    { id: 'bike-standard', slot: 'bike', name: 'Standard', desc: 'The classic two-wheeled racer.',
      unlock: { kind: 'default' } },
  ];

  const EQUIP_KEY = (slot) => 'burger-mania-equip-' + slot;
  function trackById(id) { return TRACKS.find(t => t.id === id) || null; }
  function equipById(id) { return EQUIPMENT.find(e => e.id === id) || null; }

  // has the player earned this item's unlock?
  function equipUnlocked(item) {
    const u = item.unlock || { kind: 'default' };
    if (u.kind === 'default') return true;
    if (u.kind === 'clearTrack') return !!localStorage.getItem('burger-mania-cleared-' + u.track);
    return false;
  }

  // one-line requirement shown on a locked item
  function equipRequirement(item) {
    const u = item.unlock || { kind: 'default' };
    if (u.kind === 'clearTrack') {
      const t = trackById(u.track);
      return 'Clear the ' + (t ? t.label : u.track) + ' track';
    }
    return 'Locked';
  }

  // which item id the player has explicitly equipped in a slot (null = none yet)
  function equippedId(slot) {
    try { return localStorage.getItem(EQUIP_KEY(slot)) || null; } catch (e) { return null; }
  }
  function setEquipped(slot, id) {
    try { localStorage.setItem(EQUIP_KEY(slot), id); } catch (e) { /* storage may be off */ }
  }

  // the items a slot shows on the sheet: everything filed under it, minus secret
  // items the player hasn't unlocked yet (those stay hidden entirely)
  function slotItems(slot) {
    return EQUIPMENT.filter(it => it.slot === slot && (!it.secret || equipUnlocked(it)));
  }

  // the item id actually in effect for a slot right now. Skins honor the
  // default-to-best fallback (see bikeSkinTier) so the worn skin is marked even
  // if never picked; other slots fall back to an explicit pick, else the first
  // owned item (so Bikes defaults to Standard), else null (empty gear slots).
  function currentEquipped(slot) {
    if (slot === 'skin') {
      const it = EQUIPMENT.find(e => e.slot === 'skin' && e.tier === bikeSkinTier());
      return it ? it.id : null;
    }
    const id = equippedId(slot);
    if (id) { const it = equipById(id); if (it && it.slot === slot && equipUnlocked(it)) return id; }
    const first = EQUIPMENT.find(e => e.slot === slot && equipUnlocked(e));
    return first ? first.id : null;
  }

  // the display name of whatever's worn in a slot ('—' when the slot is empty)
  function equippedName(slot) {
    const it = equipById(currentEquipped(slot));
    return it ? it.name : '—';
  }

  // the full loadout (slot id -> equipped item id), refreshed into equipState on
  // every world entry so the sim/renderer always know what the rider is wearing.
  // Only Skins drive anything today (the cosmetic tier); bike model + gear are
  // tracked here and ready for when they carry gameplay effects.
  let equipState = {};
  function refreshEquipment() {
    equipState = {};
    for (const s of EQUIP_SLOTS) equipState[s.id] = currentEquipped(s.id);
    setBikeSkin(bikeSkinTier()); // the skin is the only piece with a look today
  }

  // ---------- cosmetic bike skin ----------
  // The bike's skin tier is whichever skin the player has EQUIPPED (and still
  // owns); if they've never picked one, it defaults to the best skin unlocked so
  // far — so a player who ignores the sheet still auto-upgrades on a track clear,
  // exactly as before, while anyone who picks a skin keeps their choice through
  // later unlocks. Purely cosmetic — render.js owns the look (bikePalette/
  // BIKE_SKIN); we just feed it. Re-read on every entry into the game world
  // (loadLevel — covers playing, replays and editor test) rather than once at
  // boot, so a switch (or a hand-edited flag) takes effect on the next level
  // start with no page reload.
  function bestUnlockedSkinTier() {
    let tier = 0;
    TRACKS.forEach((t, i) => {
      if (localStorage.getItem(CLEARED_KEY(t))) tier = Math.max(tier, i + 1);
    });
    return tier;
  }
  function bikeSkinTier() {
    const id = equippedId('skin');
    if (id) {
      const item = equipById(id);
      if (item && item.slot === 'skin' && equipUnlocked(item)) return item.tier; // honor the pick
    }
    return bestUnlockedSkinTier(); // never picked one -> wear the best earned
  }
  // refreshing the whole loadout also sets the live skin tier, so this stays the
  // single call the world-entry points use.
  function refreshBikeSkin() { refreshEquipment(); }

  // Secret console backdoor: grant + wear the hidden Master skin. Sets the Master
  // unlock and equips it, so it then appears on the sheet and the bike wears it on
  // the next level entry. equipSkin(id) forces any owned skin from the console.
  try {
    window.equipMaster = function () {
      localStorage.setItem('burger-mania-cleared-master', '1');
      setEquipped('skin', 'skin-master');
      refreshEquipment();
      return 'Master skin equipped — ride to see it.';
    };
    window.equipSkin = function (id) {
      const item = EQUIPMENT.find(e => e.id === id && e.slot === 'skin');
      if (!item) return 'no such skin: ' + id;
      if (!equipUnlocked(item)) return 'locked: ' + equipRequirement(item);
      setEquipped('skin', id);
      refreshEquipment();
      return id + ' equipped.';
    };
  } catch (e) { /* no window (headless) */ }

  function reset() {
    bike = new Bike(level.start.x, level.start.y);
    time = 0;
    // normal burgers plus the upside-down ones (identical to the rider, but
    // collecting one SETS gravity to its direction). Both count toward the
    // burger total and collect alike, so they share the runtime list; a normal
    // burger carries grav:null, a gravity burger the unit vector it sets. The
    // 3rd entry is the direction ('up'|'down'|'left'|'right'); absent => 'up'
    // (the legacy reverse-gravity burger).
    const GRAV_VECS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    burgers = level.burgers.map(b => ({ x: b[0], y: b[1], got: false, grav: null }));
    if (level.flipBurgers) {
      for (const b of level.flipBurgers) {
        burgers.push({ x: b[0], y: b[1], got: false, grav: GRAV_VECS[b[2]] || GRAV_VECS.up });
      }
    }
    // defibrillators are a separate, optional list (a bonus one-up, not a
    // required pickup), so they never enter the burger/goal count. They're
    // also once-per-continue: one already grabbed since the last continue comes
    // back pre-consumed so a respawn can't re-float it (consumedDefibs, keyed by
    // map+slot; empty outside a real track run, so replays/test rides are fresh)
    defibs = (level.defibs || []).map((d, i) => ({
      x: d[0], y: d[1], got: consumedDefibs.has(levelIndex + ':' + i),
    }));
    zaps = [];
    lifePopups = [];
    lifeAnimT = 99;
    headBody = null;
    suspLevel = 0; // silence any crank still ringing from the last life at once
    stylePts = 0;
    spinAcc = 0;
    wheelieT = 0;
    stoppieT = 0;
    stylePopups = [];
    popupSeq = 0;
    exhaust = [];
    exhaustAcc = 0;
    dirt = [];
    dirtAcc = 0;
    puffs = [];
    camLead = bike.facing * CAM_LEAD;
    cam.x = level.start.x + camLead;
    cam.y = level.start.y;
    // every run gets a fresh tape (watching a replay isn't a run)
    if (state !== 'replay' && state !== 'replayEnd') REPLAY.begin();
  }
  reset();

  // swaps in a raw level (from a track) along with its best-time record
  function loadLevel(raw) {
    currentRaw = raw;
    level = prepareLevel(raw);
    bestKey = 'burger-mania-best-' + level.name;
    best = parseFloat(localStorage.getItem(bestKey) || '');
    if (!isFinite(best)) best = null;
    styleKey = 'burger-mania-style-' + level.name;
    styleBest = parseInt(localStorage.getItem(styleKey) || '', 10);
    if (!isFinite(styleBest)) styleBest = null;
    refreshBikeSkin(); // pick up the earned (or cheated-in) skin on world entry
    reset();
  }

  // ---------- sound ----------
  // the engine drone and one-shot effects feed sfxGain, the soundtrack
  // feeds musicGain, and both meet in masterGain — the three sliders on
  // the audio settings screen
  let AC = null, engineSnd = null, suspSnd = null, muted = false;
  let masterGain = null, musicGain = null, sfxGain = null;
  let dirtNoiseBuf = null; // shared white-noise buffer reused by every dirt grain

  const VOLUME_KEY = 'burger-mania-volume';
  const volume = { master: 1, music: 1, sfx: 1 };
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY)) || {};
    for (const k of Object.keys(volume)) {
      if (isFinite(saved[k])) volume[k] = Math.min(1, Math.max(0, Number(saved[k])));
    }
  } catch (e) { /* unreadable save: ride at full volume */ }

  const MUTE_KEY = 'burger-mania-muted';
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* unreadable: start unmuted */ }
  // H hides the whole riding HUD (metrics, lives, mph, minimap, level label)
  // for a clean view; in-memory only, so a refresh brings the HUD back
  let hudHidden = false;

  function setMuted(m) {
    muted = m;
    MUSIC.setMuted(muted);
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* unwritable: live for this session only */ }
  }

  // sliders are stored 0..1 and squared into gain so they track
  // perceived loudness rather than raw amplitude
  function applyVolume() {
    if (!AC) return;
    masterGain.gain.setTargetAtTime(volume.master * volume.master, AC.currentTime, 0.03);
    musicGain.gain.setTargetAtTime(volume.music * volume.music, AC.currentTime, 0.03);
    sfxGain.gain.setTargetAtTime(volume.sfx * volume.sfx, AC.currentTime, 0.03);
  }

  function setVolume(key, v) {
    volume[key] = Math.min(1, Math.max(0, v));
    applyVolume();
    localStorage.setItem(VOLUME_KEY, JSON.stringify(volume));
  }

  function ensureAudio() {
    if (AC) return;
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = AC.createGain();
      masterGain.gain.value = volume.master * volume.master;
      masterGain.connect(AC.destination);
      musicGain = AC.createGain();
      musicGain.gain.value = volume.music * volume.music;
      musicGain.connect(masterGain);
      sfxGain = AC.createGain();
      sfxGain.gain.value = volume.sfx * volume.sfx;
      sfxGain.connect(masterGain);
      const osc = AC.createOscillator();
      osc.type = 'sawtooth';
      const filt = AC.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 480;
      const gain = AC.createGain();
      gain.gain.value = 0;
      osc.connect(filt);
      filt.connect(gain);
      gain.connect(sfxGain);
      osc.start();
      engineSnd = { osc, gain };
      // the suspension "crank": a heavy mechanical spring wound under load.
      // A sawtooth rung through a resonant BANDPASS (a metallic formant, not a
      // soft tone), then bitten by a square-wave tremolo so it ratchets like a
      // crank turning. Always on, gated to silence until the springs work; the
      // pitch, brightness and ratchet rate all climb as they load harder
      const sOsc = AC.createOscillator();
      sOsc.type = 'sawtooth';
      sOsc.frequency.value = 40;
      const sFilt = AC.createBiquadFilter();
      sFilt.type = 'bandpass';
      sFilt.frequency.value = 150;
      sFilt.Q.value = 2.6;
      // tremolo: a square LFO chops the signal between 0.38 and 0.98 so the
      // tone reads as a turning ratchet rather than a steady drone
      const sTrem = AC.createGain();
      sTrem.gain.value = 0.68;
      const sLfo = AC.createOscillator();
      sLfo.type = 'square';
      sLfo.frequency.value = 9;
      const sLfoDepth = AC.createGain();
      sLfoDepth.gain.value = 0.30;
      sLfo.connect(sLfoDepth);
      sLfoDepth.connect(sTrem.gain);
      const sGain = AC.createGain();
      sGain.gain.value = 0;
      sOsc.connect(sFilt);
      sFilt.connect(sTrem);
      sTrem.connect(sGain);
      sGain.connect(sfxGain);
      sOsc.start();
      sLfo.start();
      suspSnd = { osc: sOsc, gain: sGain, filt: sFilt, lfo: sLfo };
      // half a second of white noise, reused by every dirt grain (dirtTick) so a
      // roost's patter doesn't allocate a fresh buffer per flung clod
      dirtNoiseBuf = AC.createBuffer(1, Math.floor(AC.sampleRate * 0.5), AC.sampleRate);
      const dn = dirtNoiseBuf.getChannelData(0);
      for (let i = 0; i < dn.length; i++) dn[i] = Math.random() * 2 - 1;
      MUSIC.init(AC, musicGain);
      MUSIC.setMuted(muted); // carry a persisted mute into the freshly-built context
    } catch (e) { /* no audio available */ }
  }

  // best-effort: ask the browser to keep a phone in landscape (the world,
  // menus, and HUD are all built for a wide view). Works on Android Chrome,
  // usually only in fullscreen / an installed PWA; iOS Safari has no such
  // API, so the CSS "rotate your device" overlay in index.html is the real
  // guarantee. Guarded so an unsupported or rejected call never throws.
  let triedLock = false;
  function lockLandscape() {
    if (triedLock) return;
    triedLock = true;
    try {
      const o = window.screen && window.screen.orientation;
      if (o && o.lock) {
        const r = o.lock('landscape');
        if (r && r.catch) r.catch(() => {});
      }
    } catch (e) { /* orientation lock unsupported */ }
  }

  // picks the soundtrack for the current screen: the menu and difficulty
  // screens share the title theme, the continue screen mourns on its own,
  // and every in-game state plays the current world's song (a name MUSIC
  // doesn't know, like the silent loading/intro screens' null, fades out)
  function updateMusic() {
    let want = null;
    if (state === 'menu' || state === 'difficulty' || state === 'replays' ||
        state === 'records' || state === 'equipment') want = 'menu';
    else if (state === 'continue') want = 'continue';
    // the picker keeps the summoning screen's song: the frozen world's
    // theme mid-game, the menu theme otherwise
    else if (state === 'skip') want = skipOverGame() ? level.theme : 'menu';
    else if (state === 'audio') {
      // keep whatever was playing, full volume even over a pause, so the
      // music slider is tuned against the level it'll actually play at
      want = audioFrom === 'paused' ? level.theme : 'menu';
    }
    // the editor plays the song of the theme being edited, so picking a
    // theme auditions its whole world
    else if (state === 'editor') want = EDITOR.themeName;
    // the win sequence: the world's song dips to silence under the long
    // dissolve, then the victory tune blooms in with the feast
    else if (state === 'victoryFade') want = victoryAlpha() < 0.5 ? null : 'victory';
    else if (state === 'victory') want = 'victory';
    else if (state === 'ready' || state === 'playing' || state === 'dead' ||
             state === 'finished' || state === 'paused' ||
             state === 'replay' || state === 'replayEnd' ||
             state === 'editorTest' || state === 'editorTestEnd') {
      want = level.theme;
    }
    MUSIC.play(want);
    MUSIC.duck(state === 'paused');
  }

  function updateEngineSound() {
    if (!engineSnd) return;
    let g = 0, f = 40;
    if (!muted && (state === 'playing' || state === 'replay' ||
                   state === 'editorTest')) {
      const rear = bike.wheels[bike.rearIndex];
      f = 34 + Math.abs(rear.spin) * 1.25 + (simInput.throttle ? 18 : 0);
      g = simInput.throttle ? 0.085 : 0.045;
    }
    engineSnd.gain.gain.setTargetAtTime(g, AC.currentTime, 0.06);
    engineSnd.osc.frequency.setTargetAtTime(f, AC.currentTime, 0.05);
  }

  // how hard the suspension is working this instant: summed over the wheels in
  // contact (ground OR wall — wheelContacts flags both), each wheel's spring
  // deflection away from its resting sag plus how fast that spring is moving.
  // Airborne wheels contribute nothing, so the crank is a CONTACT sound — it
  // answers landings, wall bangs, hard wheelie drops and a body pressed into a
  // ramp, and stays silent in clean air and at rest. Called every substep so a
  // brief peak compression isn't missed
  function suspLoad() {
    const c = Math.cos(bike.angle), s = Math.sin(bike.angle);
    let load = 0;
    for (let i = 0; i < 2; i++) {
      const w = bike.wheels[i];
      if (!w.onGround) continue;
      const lx = (i === 0 ? -1 : 1) * PHYS.anchorX, ly = PHYS.anchorY;
      const ax = bike.pos.x + lx * c - ly * s;
      const ay = bike.pos.y + lx * s + ly * c;
      let ux = w.pos.x - ax, uy = w.pos.y - ay;
      const d = Math.hypot(ux, uy);
      const dev = Math.abs(d - SUSP_REST); // spring stretch away from rest sag
      if (d > 1e-6) { ux /= d; uy /= d; }
      // wheel velocity relative to its anchor, along the spring axis = how fast
      // the spring is compressing/extending
      const rx = ax - bike.pos.x, ry = ay - bike.pos.y;
      const avx = bike.vel.x - bike.avel * ry, avy = bike.vel.y + bike.avel * rx;
      const vN = Math.abs((w.vel.x - avx) * ux + (w.vel.y - avy) * uy);
      load += SUSP_DEV_W * dev + SUSP_VEL_W * vN;
    }
    return load;
  }

  function updateSuspensionSound() {
    if (!suspSnd) return;
    let g = 0, f = 40, cut = 150, rate = 9;
    // also voices through the crash/finish aftermath so a hard hit that kills
    // the rider rings the crank out naturally instead of cutting dead; reset()
    // zeroes suspLevel so a respawn silences it at once
    if (!muted && (state === 'playing' || state === 'replay' ||
                   state === 'editorTest' || state === 'dead' ||
                   state === 'replayEnd' || state === 'editorTestEnd' ||
                   state === 'finished')) {
      const L = Math.min(1, suspLevel / SUSP_FULL); // 0..1 drama
      g = 0.40 * L;          // bandpass is thinner than a lowpass — push it
      f = 40 + L * 60;       // the heavy spring winds up in pitch as it loads
      cut = 150 + L * 650;   // brighter, harsher metallic ring on a hard hit
      rate = 9 + L * 17;     // and the crank ratchets faster the harder it works
    }
    suspSnd.gain.gain.setTargetAtTime(g, AC.currentTime, 0.02);
    suspSnd.osc.frequency.setTargetAtTime(f, AC.currentTime, 0.02);
    suspSnd.filt.frequency.setTargetAtTime(cut, AC.currentTime, 0.02);
    suspSnd.lfo.frequency.setTargetAtTime(rate, AC.currentTime, 0.05);
  }

  function blip(freq, dur) {
    if (!AC || muted) return;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.value = 0.10;
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
    o.connect(g);
    g.connect(sfxGain);
    o.start();
    o.stop(AC.currentTime + dur);
  }

  // filtered noise burst for the title letters whipping past and the
  // bike whipping around
  function whoosh(dur, freq, gain = 0.35) {
    if (!AC || muted) return;
    const n = Math.floor(AC.sampleRate * dur);
    const buf = AC.createBuffer(1, n, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = AC.createBufferSource();
    src.buffer = buf;
    const f = AC.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.4;
    const g = AC.createGain();
    g.gain.value = gain;
    src.connect(f);
    f.connect(g);
    g.connect(sfxGain);
    src.start();
  }

  // a swooping tone for a gravity flip (an upside-down burger): the pitch
  // glides toward the new "down", so an up-flip swoops up and a down-flip
  // swoops down — an audible cue for an otherwise invisible event
  function gravWhoomp(up) {
    if (!AC || muted) return;
    const t0 = AC.currentTime;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(up ? 300 : 760, t0);
    o.frequency.exponentialRampToValueAtTime(up ? 880 : 200, t0 + 0.32);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.36);
    o.connect(g);
    g.connect(sfxGain);
    o.start(t0);
    o.stop(t0 + 0.38);
    whoosh(0.18, up ? 900 : 360, 0.25);
  }

  // the rider's volt: a meaty low "thwuup" — the weight-throw that whips the
  // bike around — with a puff of air over it. A ~0.5s drawn-out flourish, fired
  // once on the rising edge of a lean (when the rider engages a volt), so holding
  // the key to rotate doesn't machine-gun the sound
  function voltThump() {
    if (!AC || muted) return;
    const t0 = AC.currentTime;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(240, t0);
    o.frequency.exponentialRampToValueAtTime(85, t0 + 0.22); // slow pitch drop
    g.gain.setValueAtTime(0.0001, t0); // exponential ramps can't leave 0
    g.gain.exponentialRampToValueAtTime(0.20, t0 + 0.015);   // quick onset
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.40);   // long, drawn-out tail
    o.connect(g);
    g.connect(sfxGain);
    o.start(t0);
    o.stop(t0 + 0.42);
    whoosh(0.18, 520, 0.22); // longer air puff to match
  }

  // a wheel touching down: a short earthy thud — a low body thump plus a click
  // of tire-on-ground grit. `power` (0..1) is how hard the wheel was dropping
  // in, so a gentle plant ticks softly and a big slam lands with a real thud
  function wheelHit(power) {
    if (!AC || muted) return;
    const t0 = AC.currentTime;
    const vol = 0.12 + 0.32 * power; // punchy, scales hard with impact speed
    // low thump body
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(190, t0);
    o.frequency.exponentialRampToValueAtTime(50, t0 + 0.10);
    g.gain.setValueAtTime(0.0001, t0); // exponential ramps can't leave 0
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.17);
    o.connect(g);
    g.connect(sfxGain);
    o.start(t0);
    o.stop(t0 + 0.18);
    // a slap of tire-on-ground grit over the thump, much louder on a slam
    whoosh(0.06, 300, 0.14 + 0.30 * power);
  }

  // a single grain of flung grit — a tiny, soft noise tick, one per kicked-up clod
  // (see emitDirt). `size` is the clod's radius (~0.05..0.3 m): a dust fleck barely
  // ticks, high and quiet, while a fat clod lands lower and louder, so the spray's
  // loudness tracks the clods you actually see. Reuses the shared noise buffer and
  // is capped/spread per frame by emitDirt, so a 30-clod landing burst patters
  // instead of walling up the mix. `delay` (s) staggers a burst's grains so they
  // read as a patter, not one fused click.
  function dirtTick(size, delay) {
    if (!AC || muted || !dirtNoiseBuf) return;
    const t0 = AC.currentTime + (delay || 0);
    const sz = Math.min(1, Math.max(0, (size - 0.05) / 0.22)); // clod radius → 0..1
    const dur = 0.025 + sz * 0.05;          // bigger clods ring a touch longer
    const src = AC.createBufferSource();
    src.buffer = dirtNoiseBuf;
    const f = AC.createBiquadFilter();
    f.type = 'bandpass';
    // big clod = lower/duller, dust = brighter; jitter so grains don't all sit on
    // one pitch (varying the centre frequency stands in for per-grain detune)
    f.frequency.value = (1700 - sz * 1150) * (0.85 + Math.random() * 0.3);
    f.Q.value = 0.9;
    const g = AC.createGain();
    const vol = 0.02 + sz * 0.10;           // SIZE sets the loudness
    g.gain.setValueAtTime(0.0001, t0);      // exponential ramps can't leave 0
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004);  // sharp grit onset
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);  // quick decay
    src.connect(f); f.connect(g); g.connect(sfxGain);
    const bufDur = dirtNoiseBuf.duration || 0.5;
    src.start(t0, Math.max(0, Math.random() * (bufDur - 0.12))); // random slice
    src.stop(t0 + dur + 0.05);
  }

  // the perfect-run pacer's posture shot: a sharp broadband crack over a short
  // low boom. Triggered from the victory loop (checkPacerShot) at the apex of
  // his gun-raise, in lockstep with the muzzle flash render.js draws.
  function gunshot() {
    if (!AC || muted) return;
    const t0 = AC.currentTime;
    // the crack: white noise through a fast-closing lowpass
    const dur = 0.22;
    const n = Math.floor(AC.sampleRate * dur);
    const buf = AC.createBuffer(1, n, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
    const src = AC.createBufferSource();
    src.buffer = buf;
    const f = AC.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(5200, t0);
    f.frequency.exponentialRampToValueAtTime(380, t0 + 0.18);
    f.Q.value = 0.7;
    const g = AC.createGain();
    g.gain.setValueAtTime(0.55, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(sfxGain);
    src.start(t0);
    // the boom body: a low sine punched in and dropped
    const o = AC.createOscillator(), bg = AC.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t0);
    o.frequency.exponentialRampToValueAtTime(42, t0 + 0.12);
    bg.gain.setValueAtTime(0.0001, t0); // exponential ramps can't leave 0
    bg.gain.exponentialRampToValueAtTime(0.35, t0 + 0.006);
    bg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
    o.connect(bg); bg.connect(sfxGain);
    o.start(t0); o.stop(t0 + 0.22);
  }

  // quick rising arpeggio when style points land, each note sliding up a
  // little as it rings; a big award (full rotation) gets an extra top note
  // so it reads flashier than a turn-around
  function styleSparkle(big) {
    if (!AC || muted) return;
    const notes = big ? [740, 988, 1480, 1976] : [740, 988, 1480];
    notes.forEach((freq, i) => {
      const t0 = AC.currentTime + i * 0.05;
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(freq, t0);
      o.frequency.exponentialRampToValueAtTime(freq * 1.3, t0 + 0.16);
      g.gain.setValueAtTime(0.0001, t0); // exponential ramps can't leave 0
      g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.025);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
      o.connect(g);
      g.connect(sfxGain);
      o.start(t0);
      o.stop(t0 + 0.24);
    });
  }

  // the defibrillator SHOCK: the paddles discharging into the rider, built to
  // sound violent and electric. Layers — a capacitor charge-whine swooping up,
  // then on the discharge a long gritty BUZZ (bandpassed noise chopped by a
  // ~70 Hz square LFO, the classic mains "BZZZT"), a pair of detuned sawtooth
  // arc-tones screeching down, and a hard low chest thump under it all.
  function defibShock() {
    if (!AC || muted) return;
    const t0 = AC.currentTime;
    // 1) capacitor charge whine, rising fast then cut by the discharge
    const o = AC.createOscillator(), cg = AC.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(300, t0);
    o.frequency.exponentialRampToValueAtTime(1750, t0 + 0.16);
    cg.gain.setValueAtTime(0.0001, t0);
    cg.gain.exponentialRampToValueAtTime(0.08, t0 + 0.12);
    cg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
    o.connect(cg); cg.connect(sfxGain);
    o.start(t0); o.stop(t0 + 0.22);

    // the discharge fires the instant the whine peaks
    const td = t0 + 0.16;

    // 2) the BUZZ: a long crackle of bandpassed noise whose amplitude is chopped
    //    by a square LFO, so it reads as a savage electric buzz, not a soft hiss
    const dur = 0.42;
    const n = Math.floor(AC.sampleRate * dur);
    const buf = AC.createBuffer(1, n, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 0.7);
    const src = AC.createBufferSource();
    src.buffer = buf;
    const f = AC.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(2400, td);
    f.frequency.exponentialRampToValueAtTime(650, td + dur);
    f.Q.value = 6; // high Q = a tight, fizzing electric crackle
    const ng = AC.createGain();
    ng.gain.setValueAtTime(0.5, td);
    ng.gain.exponentialRampToValueAtTime(0.05, td + dur);
    // the chopper: a square LFO summed into the noise gain, dropping in pitch so
    // the buzz "tears" lower as it discharges
    const lfo = AC.createOscillator(), lfoAmt = AC.createGain();
    lfo.type = 'square';
    lfo.frequency.setValueAtTime(72, td);
    lfo.frequency.linearRampToValueAtTime(42, td + dur);
    lfoAmt.gain.value = 0.42;
    lfo.connect(lfoAmt); lfoAmt.connect(ng.gain);
    src.connect(f); f.connect(ng); ng.connect(sfxGain);
    src.start(td); lfo.start(td); lfo.stop(td + dur);

    // 3) two detuned sawtooth arc-tones screeching down over the buzz
    for (const det of [0, 7]) {
      const a = AC.createOscillator(), ag = AC.createGain();
      a.type = 'sawtooth';
      a.frequency.setValueAtTime(440 + det, td);
      a.frequency.exponentialRampToValueAtTime(105 + det, td + 0.32);
      ag.gain.setValueAtTime(0.0001, td);
      ag.gain.exponentialRampToValueAtTime(0.09, td + 0.02);
      ag.gain.exponentialRampToValueAtTime(0.001, td + 0.36);
      a.connect(ag); ag.connect(sfxGain);
      a.start(td); a.stop(td + 0.38);
    }

    // 4) the chest thump under it — a hard low sine punched in and dropped
    const o2 = AC.createOscillator(), bg = AC.createGain();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(155, td);
    o2.frequency.exponentialRampToValueAtTime(44, td + 0.16);
    bg.gain.setValueAtTime(0.0001, td);
    bg.gain.exponentialRampToValueAtTime(0.42, td + 0.006);
    bg.gain.exponentialRampToValueAtTime(0.001, td + 0.24);
    o2.connect(bg); bg.connect(sfxGain);
    o2.start(td); o2.stop(td + 0.26);
  }

  // the ONE-UP: a bright ascending power-up chime when the life lands, riding in
  // just after the shock. A square-wave major arpeggio (the classic 1-up feel),
  // capped with a quick high shimmer — purposely brighter and "happier" than the
  // style-points sparkle so a life gain reads as its own reward.
  function oneUp() {
    if (!AC || muted) return;
    const base = AC.currentTime + 0.34; // rises as the shock buzz tears down and decays
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const t0 = base + i * 0.07;
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(i === 3 ? 0.13 : 0.10, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + (i === 3 ? 0.34 : 0.18));
      o.connect(g); g.connect(sfxGain);
      o.start(t0); o.stop(t0 + 0.36);
    });
    // a sparkle tail over the top note
    const ts = base + 3 * 0.07 + 0.06;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(2093, ts); // C7
    o.frequency.exponentialRampToValueAtTime(3136, ts + 0.18);
    g.gain.setValueAtTime(0.0001, ts);
    g.gain.exponentialRampToValueAtTime(0.07, ts + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ts + 0.24);
    o.connect(g); g.connect(sfxGain);
    o.start(ts); o.stop(ts + 0.26);
  }

  // fires whoosh / thud / fanfare cues as title letters launch and land
  function introSounds() {
    const launched = Math.max(0, Math.min(TITLE_ANIM.count,
      Math.floor((introT - TITLE_ANIM.delay) / TITLE_ANIM.stagger) + 1));
    while (introLaunched < launched) {
      whoosh(0.22, 500 + introLaunched * 90);
      introLaunched++;
    }
    const landed = Math.max(0, Math.min(TITLE_ANIM.count,
      Math.floor((introT - TITLE_ANIM.delay - TITLE_ANIM.fly) / TITLE_ANIM.stagger) + 1));
    while (introLanded < landed) {
      blip(220 + introLanded * 55, 0.10);
      introLanded++;
    }
    if (!fanfared && introLanded >= TITLE_ANIM.count) {
      fanfared = true;
      blip(660, 0.12);
      setTimeout(() => blip(880, 0.12), 130);
      setTimeout(() => blip(1320, 0.22), 260);
    }
  }

  // ---------- screen flow ----------
  // Maps load lazily. A track's `levels` is a sparse cache filled on demand;
  // `files` is the full ordered list, so `files.length` is the track's real
  // size whether or not its maps are loaded.

  // fetch + parse one map into the track's cache (idempotent; dedupes parallel
  // fetches via track._fetching). Resolves to the level, or null if it couldn't
  // be loaded. In the headless tests the cache is pre-filled from disk
  // (js/levels.js), so this returns immediately without fetching.
  function ensureLevel(track, i) {
    if (!track || i < 0 || i >= track.files.length) return Promise.resolve(null);
    if (track.levels[i]) return Promise.resolve(track.levels[i]);
    track._fetching = track._fetching || {};
    if (track._fetching[i]) return track._fetching[i];
    const url = 'levels/tracks/' + track.id + '/' + track.files[i];
    const p = fetch(url)
      .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
      .then(text => {
        const lvl = track.levels[i] = EDITOR.parse(text);
        rememberName(track, i, lvl.name); // so Records can match its records later
        return lvl;
      })
      .catch(err => { console.error('Could not load level ' + url, err); return null; })
      .then(lvl => { delete track._fetching[i]; return lvl; });
    track._fetching[i] = p;
    return p;
  }

  // localStorage hint of a map's real (in-file) name, written the first time it
  // loads. Per-map best-time/style records are keyed by that name, so the
  // screens that list a whole track (Records, the skip picker, the victory
  // scorecard) can match the records without re-fetching every .bmm just to read
  // its name. Keyed by filename so it survives a track reordering its `files`.
  function nameKey(track, i) { return 'burger-mania-name-' + track.id + '-' + track.files[i]; }
  function rememberName(track, i, name) {
    try { localStorage.setItem(nameKey(track, i), name); } catch (e) { /* ignore */ }
  }
  // a map's display name without forcing a load: the loaded name, else the name
  // cached above the last time it loaded, else a title-cased fallback off the
  // filename ("03-onion-underpass.bmm" -> "Onion Underpass") so a list can render
  // before (or despite) a failed fetch. This is also the name records were saved
  // under, so it doubles as the key for reading a map's stored bests.
  function levelName(track, i) {
    if (track.levels[i]) return track.levels[i].name;
    try { const n = localStorage.getItem(nameKey(track, i)); if (n) return n; } catch (e) { /* ignore */ }
    return (track.files[i] || '').replace(/\.bmm$/i, '').replace(/^\d+[-_]?/, '')
      .replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || ('Map ' + (i + 1));
  }

  // enter map i (fetching it first, behind the loading overlay, if it isn't
  // cached yet), then quietly prefetch the next map so the finish-line hand-off
  // is instant. Owns the state transition to 'ready', so callers don't set it.
  async function enterLevel(i) {
    levelIndex = i;
    if (!currentTrack.levels[i]) {
      state = 'levelLoading';
      const raw = await ensureLevel(currentTrack, i);
      // couldn't load — show a recoverable error rather than hang or silently
      // drop to the menu. (A failed *prefetch* of the next map below never gets
      // here: it isn't awaited, so it stays silent until the player actually
      // crosses into that map and this awaited path re-fetches it.)
      if (!raw) { goLevelLoadError(i); return; }
    }
    loadLevel(currentTrack.levels[i]);
    state = 'ready';
    if (i + 1 < currentTrack.files.length) ensureLevel(currentTrack, i + 1);
  }

  // a map fetch/parse failed on entry: stop on a screen offering Retry / Back
  // to Menu instead of bouncing the player to the title with no explanation.
  function goLevelLoadError(i) {
    loadErrorIndex = i;
    errSel = 0;
    hoverIdx = -1;
    state = 'levelLoadError';
    blip(330, 0.16); // a low, flat "nope"
  }

  function activateLoadError(sel) {
    if (sel === 0) { blip(660, 0.08); enterLevel(loadErrorIndex); } // Retry
    else { blip(880, 0.08); goMenu(); }                             // Back to Menu
  }

  function startGame(track) {
    currentTrack = track;
    lives = 3;
    continues = MAX_CONTINUES;
    checkpointIndex = 0;
    runResults = [];
    runPerfect = true;
    consumedDefibs.clear(); // a new campaign re-floats every defib
    enterLevel(0); // sets state ('levelLoading' then 'ready')
  }

  function hasNextLevel() {
    return !!currentTrack && levelIndex + 1 < currentTrack.files.length;
  }

  function mapLabel() {
    if (!currentTrack) return level.name;
    return `${currentTrack.label} ${levelIndex + 1}/${currentTrack.length} - ${level.name}`;
  }

  function goContinue() {
    state = 'continue';
    contT = 0;
    contSel = continues > 0 ? 0 : 1; // land on Back to Menu when tapped out
    hoverIdx = -1;
    blip(392, 0.14); // sad descending tones
    setTimeout(() => blip(311, 0.14), 170);
    setTimeout(() => blip(233, 0.30), 340);
  }

  function useContinue() {
    continues--;
    lives = 3;
    runPerfect = false; // a continue burned — the flawless run is over
    consumedDefibs.clear(); // spending a continue re-floats every defib
    enterLevel(checkpointIndex); // sets state (checkpoint map is already cached)
  }

  function goMenu() {
    state = 'menu';
    menuT = 0;
    menuSel = 0;
    hoverIdx = -1;
  }

  function goDifficulty() {
    state = 'difficulty';
    diffT = 0;
    diffSel = 0;
    hoverIdx = -1;
  }

  // ---------- equipment (character sheet) ----------
  // An MMO-style loadout: the LEFT column lists every slot with what's worn; the
  // RIGHT column shows a (de-emphasised) preview of the rider in the current
  // loadout plus the items available for the SELECTED slot, which can be swapped.
  // equipSlot = highlighted slot row, equipSel = highlighted item in that slot,
  // equipFocus = which column the keyboard drives, equipT = the fade-in timer.
  let equipSlot = 0, equipSel = 0, equipT = 0, equipFocus = 'slots';

  function currentSlotId() { return EQUIP_SLOTS[equipSlot].id; }
  function currentSlotItems() { return slotItems(currentSlotId()); }

  // point the item cursor at whatever's worn in the current slot (else the top)
  function syncEquipSel() {
    const items = currentSlotItems();
    const worn = currentEquipped(currentSlotId());
    const i = items.findIndex(it => it.id === worn);
    equipSel = i < 0 ? 0 : i;
  }

  function goEquipment() {
    state = 'equipment';
    equipT = 0;
    equipSlot = 0;
    equipFocus = 'slots';
    hoverIdx = -1;
    syncEquipSel();
  }

  // highlight slot row i (clamped) and re-point the item cursor at its worn item
  function selectEquipSlot(i) {
    equipSlot = Math.max(0, Math.min(EQUIP_SLOTS.length - 1, i));
    syncEquipSel();
  }

  // equip item i in the current slot: owned items get worn, a locked one buzzes,
  // an already-worn one ticks. refreshEquipment re-reads the whole loadout so the
  // live skin tier (and the preview/parked bike) match immediately.
  function activateEquipment(i) {
    const slot = currentSlotId();
    const item = currentSlotItems()[i];
    if (!item || !equipUnlocked(item)) { blip(180, 0.12); return; }   // none / locked
    if (item.id === currentEquipped(slot)) { blip(520, 0.05); return; } // already on
    setEquipped(slot, item.id);
    refreshEquipment();
    blip(880, 0.08);
  }

  // ---------- best records ----------
  // 'records' shows one track's all-time best time and style per map in the
  // victory-style scorecard, with a ◀/▶ selector to switch tracks (no separate
  // picker step). The figures read straight from the per-map best-time /
  // best-style localStorage keys, so nothing new is persisted; only the chosen
  // track is remembered (RECORDS_TRACK_KEY) so the screen reopens where it was.
  const RECORDS_TRACK_KEY = 'burger-mania-records-track';
  let recSel = 0, recT = 0;
  let recTrack = null, recNames = [], recResults = [];

  // only tracks that actually HAVE maps can hold records, so the selector skips
  // the "coming soon" ones (Advanced/Expert today) entirely. recSel indexes
  // into THIS list, not visibleTracks.
  function recordsTracks() { return visibleTracks().filter(t => t.files.length); }

  function goRecords() {
    recT = 0;
    hoverIdx = -1;
    const list = recordsTracks();
    if (!list.length) { // nothing has records yet — show an empty placeholder
      recTrack = null; recNames = []; recResults = []; recSel = 0;
      state = 'records';
      return;
    }
    let i = -1;
    try {
      const cached = localStorage.getItem(RECORDS_TRACK_KEY);
      if (cached) i = list.findIndex(t => t.id === cached);
    } catch (e) { /* localStorage may be unavailable */ }
    if (i < 0) i = 0; // default to the first track with maps (Beginner)
    selectRecordsTrack(i);
  }

  // switch the records screen to track `i` (an index into recordsTracks),
  // remember the choice, and show its scorecard.
  function selectRecordsTrack(i) {
    const list = recordsTracks();
    if (i < 0 || i >= list.length) return; // off the ends — nothing to select
    recSel = i;
    const track = list[i];
    try { localStorage.setItem(RECORDS_TRACK_KEY, track.id); } catch (e) { /* ignore */ }
    // No fetch: the scorecard only needs each map's name (to read its stored
    // bests) and display title, both resolved by levelName from the loaded map,
    // the persisted name cache, or the filename — never the full .bmm.
    showRecords(track);
  }

  // step the selector one track left/right. It does NOT wrap: at either end the
  // arrow that way is dead (recCanCycle reports this, greying it in the UI).
  function cycleRecordsTrack(d) {
    if (!recCanCycle(d)) { blip(180, 0.12); return; } // no track that way
    blip(520, 0.05);
    selectRecordsTrack(recSel + d);
  }

  // is there a track one step in direction d (-1 prev, +1 next)?
  function recCanCycle(d) {
    const i = recSel + d;
    return i >= 0 && i < recordsTracks().length;
  }

  // gather a track's stored bests into the scorecard's results shape. A map
  // with no banked time was never cleared (shown as dashes); a cleared map
  // that never scored style reads as 0. No record flags — every figure here
  // already is the all-time best, so the scorecard draws them unstarred.
  // recT is left alone so switching tracks doesn't replay the fade-in.
  function showRecords(track) {
    recTrack = track;
    recNames = track.files.map((_, i) => levelName(track, i));
    recResults = track.files.map((_, i) => {
      // levelName is the name a map's records were saved under; a map that was
      // never played simply reads back nothing here and draws as dashes.
      const name = levelName(track, i);
      const t = parseFloat(localStorage.getItem('burger-mania-best-' + name) || '');
      if (!isFinite(t)) return null;
      const s = parseInt(localStorage.getItem('burger-mania-style-' + name) || '', 10);
      return { time: t, style: isFinite(s) ? s : 0 };
    });
    state = 'records';
    hoverIdx = -1;
  }

  function openPause() {
    pausedFrom = state;
    state = 'paused';
    pauseSel = 0;
    keys.up = keys.down = keys.left = keys.right = false;
  }

  // ---------- audio settings ----------
  // the audio screen's three slider rows, in audioRects order (Back is the
  // shared corner button, not a row)
  const audioKeys = ['master', 'music', 'sfx'];
  let audioSel = 0, audioT = 0, audioFrom = 'menu';
  let audioDrag = -1;        // slider row being mouse-dragged, -1 when none
  let audioDragged = false;  // eats the click that ends a drag
  let volBlipAt = 0;

  function goAudio() {
    audioFrom = state; // 'menu' or 'paused'
    state = 'audio';
    audioT = 0;
    audioSel = 0;
    audioDrag = -1;
    hoverIdx = -1;
  }

  function closeAudio() {
    if (audioFrom === 'paused') state = 'paused';
    else goMenu();
  }

  // audible level check while a slider moves, throttled so a drag
  // doesn't machine-gun blips
  function volBlip() {
    const now = performance.now();
    if (now - volBlipAt < 90) return;
    volBlipAt = now;
    blip(740, 0.07);
  }

  function nudgeVolume(i, d) {
    // snap to the 5% grid so arrow keys land on round numbers even
    // after a mouse drag left the volume off-grid
    setVolume(audioKeys[i], Math.round((volume[audioKeys[i]] + d * 0.05) * 20) / 20);
    volBlip();
  }

  // maps a click/drag x onto the dragged row's slider track
  function dragVolume(mx) {
    const bar = audioRects(W, H)[audioDrag].bar;
    setVolume(audioKeys[audioDrag], (mx - bar.x) / bar.w);
    volBlip();
  }

  // ---------- replays ----------
  // With the File System Access API (Chromium) recorded runs are .bmr files on
  // disk and the Replays screen lists a folder the player picks once (the
  // handle is remembered in IndexedDB). Browsers without it (notably iOS
  // Safari) can't browse folders or reopen a downloaded .bmr, so there runs
  // are kept in IndexedDB and listed in-app — see REPLAY.dbSave/dbList/dbDelete.
  let repItems = [];   // { label, sub?, act } buttons on the Replays screen
  let repSel = 0, repScroll = 0, repT = 0, repGen = 0;
  let repNote = '';    // status/help line under the list
  let repDeleteMode = false;  // mobile library: rows delete instead of play
  let replayDir = null;       // FileSystemDirectoryHandle once chosen
  let replayData = null, replayCursor = null, replayOutcome = null;
  let saveNote = '', saveBusy = false;

  function goReplays() {
    state = 'replays';
    repT = 0;
    repSel = 0;
    repScroll = 0;
    repDeleteMode = false;
    hoverIdx = -1;
    buildReplayItems();
  }

  // repopulates the Replays screen; async (folder scans, permission
  // checks), so a generation counter drops stale results
  async function buildReplayItems() {
    const gen = ++repGen;
    repSel = 0;
    repScroll = 0;
    repItems = [];
    repNote = '';
    if (!REPLAY.fsSupported) {
      await buildLocalReplayItems(gen);
      return;
    }
    if (!replayDir) {
      repNote = 'Looking for your replays folder...';
      replayDir = await REPLAY.restoreDir();
      if (gen !== repGen) return;
    }
    if (!replayDir) {
      repItems = [{ label: 'Choose Replays Folder...', act: chooseReplayFolder }];
      repNote = 'Point it at the folder your replays are saved in.';
      return;
    }
    const readable = await REPLAY.dirPermission(replayDir, false);
    if (gen !== repGen) return;
    if (!readable) {
      repItems = [
        { label: 'Reopen "' + replayDir.name + '"', sub: 'the browser wants a fresh OK', act: reopenReplayFolder },
        { label: 'Choose a Different Folder...', act: chooseReplayFolder },
      ];
      return;
    }
    repNote = 'Reading "' + replayDir.name + '"...';
    let files, outdated;
    try {
      ({ files, outdated } = await REPLAY.listDir(replayDir));
    } catch (e) {
      if (gen !== repGen) return;
      repItems = [{ label: 'Choose Replays Folder...', act: chooseReplayFolder }];
      repNote = 'Could not read "' + replayDir.name + '": ' + (e.message || e);
      return;
    }
    if (gen !== repGen) return;
    repItems = files.map(f => ({
      label: f.data.label || f.data.level.name,
      sub: replaySub(f),
      act: () => startReplay(f.data),
    }));
    repItems.push({ label: 'Change Folder...', act: chooseReplayFolder });
    repNote = files.length
      ? staleNote(outdated)
      : (staleNote(outdated) || 'No replays in "' + replayDir.name + '" yet - finish a run and ' +
        (TOUCH.active ? 'tap Save Replay!' : 'press S!'));
  }

  // The mobile library: replays kept in IndexedDB, listed in-app (no folder,
  // no re-openable files). repDeleteMode swaps each row's action from "play"
  // to "delete" so old runs can be pruned without leaving the screen.
  async function buildLocalReplayItems(gen) {
    let files, outdated;
    try {
      ({ files, outdated } = await REPLAY.dbList());
    } catch (e) {
      if (gen !== repGen) return;
      repItems = [];
      repNote = 'Could not read your saved replays: ' + (e.message || e);
      return;
    }
    if (gen !== repGen) return;
    if (!files.length) repDeleteMode = false;
    repItems = files.map(f => ({
      label: (repDeleteMode ? 'Delete: ' : '') + (f.data.label || f.data.level.name),
      sub: replaySub(f),
      act: repDeleteMode ? () => removeReplay(f) : () => startReplay(f.data),
    }));
    if (files.length) {
      repItems.push({
        label: repDeleteMode ? 'Done' : 'Delete a Replay...',
        act: toggleReplayDelete,
      });
    }
    repNote = repDeleteMode
      ? 'Pick a replay to delete for good.'
      : (files.length
        ? staleNote(outdated)
        : (staleNote(outdated) || 'No replays saved yet - finish a run and ' +
          (TOUCH.active ? 'tap Save Replay!' : 'press S!')));
  }

  function toggleReplayDelete() {
    repDeleteMode = !repDeleteMode;
    buildReplayItems();
  }

  async function removeReplay(f) {
    try {
      await REPLAY.dbDelete(f.id);
    } catch (e) {
      repNote = 'Could not delete that replay: ' + (e.message || e);
      blip(180, 0.12);
      return;
    }
    buildReplayItems();
  }

  // replays from an older game version can't be played (the physics they
  // recorded against has changed), so both lists hide them — but say so, so
  // the gap isn't a mystery. '' when none were skipped.
  function staleNote(outdated) {
    if (!outdated) return '';
    return outdated + (outdated > 1 ? ' replays are' : ' replay is') +
      ' from an older version and can no longer be played.';
  }

  function replaySub(f) {
    const what = f.data.outcome === 'finished'
      ? 'finished ' + fmt(f.data.time)
      : 'crashed at ' + fmt(f.data.time);
    // replays saved before style points existed carry no total
    const style = f.data.style != null ? f.data.style : 'N/A';
    return f.name + ' - ' + what + ' - style ' + style;
  }

  async function chooseReplayFolder() {
    try {
      replayDir = await REPLAY.pickDir();
    } catch (e) {
      if (!(e && e.name === 'AbortError')) {
        repNote = 'Folder dialog failed: ' + (e.message || e);
      }
      return;
    }
    buildReplayItems();
  }

  async function reopenReplayFolder() {
    if (await REPLAY.dirPermission(replayDir, true)) buildReplayItems();
  }

  function activateReplays(i) {
    const it = repItems[i];
    if (!it || !it.act) return;
    blip(880, 0.08);
    it.act();
  }

  function startReplay(data) {
    replayData = data;
    replayCursor = REPLAY.cursor(data);
    replayOutcome = null;
    state = 'replay'; // before loadLevel, so reset() leaves the tape alone
    consumedDefibs.clear(); // a watched run shows the map's defibs as recorded
    loadLevel(data.level);
    // loadLevel just dressed the bike in the VIEWER's earned skin; wear the
    // skin the run was actually recorded with instead. Pre-skin tapes carry
    // null (no recorded tier), so they keep the viewer's skin as before.
    if (Number.isFinite(data.skin)) setBikeSkin(data.skin);
    blip(880, 0.08);
  }

  function endReplayView() {
    replayData = null;
    replayCursor = null;
    refreshBikeSkin(); // drop the replay's skin, restore the viewer's earned one
    goReplays();
  }

  function replayFileName(outcome) {
    const stamp = fmt(time).replace(':', 'm').replace(',', 's');
    const tag = outcome === 'finished' ? stamp : 'crash ' + stamp;
    return (level.name + ' ' + tag).replace(/[^\w \-.]/g, '') + REPLAY.EXT;
  }

  // S on the crash/finish screen (and the editor test-ride end screen):
  // write the recorded run to disk
  async function saveReplay() {
    if (saveBusy || !REPLAY.hasRun()) return;
    // the victory screens hold the last map's finished tape; only the
    // crash screen saves a crash. A test ride saves the working map's
    // tape — it belongs to no track, so it banks no track/index metadata.
    const testing = state === 'editorTestEnd';
    const outcome = testing ? testOutcome
      : (state === 'dead' ? 'crashed' : 'finished');
    saveBusy = true;
    saveNote = 'Saving...';
    try {
      const text = REPLAY.serialize({
        level: currentRaw,
        label: testing ? level.name : mapLabel(),
        outcome,
        time,
        style: stylePts,
        skin: BIKE_SKIN, // the cosmetic tier worn for this run
        trackId: testing ? null : (currentTrack ? currentTrack.id : null),
        levelIndex: testing ? 0 : levelIndex,
      });
      const name = replayFileName(outcome);
      if (REPLAY.fsSupported) {
        if (!replayDir) replayDir = await REPLAY.restoreDir();
        saveNote = 'Saved ' + await REPLAY.saveAs(text, name, replayDir);
      } else {
        // no folder to save into: stash it in the in-app library instead
        await REPLAY.dbSave(text, name);
        saveNote = 'Saved! See the Replays screen.';
      }
      blip(880, 0.08);
    } catch (e) {
      saveNote = e && e.name === 'AbortError'
        ? 'S: save replay'
        : 'Save failed: ' + (e.message || e);
    }
    saveBusy = false;
  }

  // dev cheat: a level-select overlay that jumps to any map in the track.
  // It's opened from the dev-only Skip chip on the menu (drawn only when
  // devSkip/cheatsEnabled), so only a local dev host can ever reach it.
  let skipTrack = null, skipItems = [];
  let skipSel = 0, skipScroll = 0, skipT = 0, skipFrom = 'menu';

  // the overlay floats over a frozen level when summoned mid-game, or over
  // a menu backdrop otherwise — draw() branches on this
  function skipOverGame() {
    return skipFrom === 'ready' || skipFrom === 'playing' || skipFrom === 'dead' ||
           skipFrom === 'finished' || skipFrom === 'paused';
  }

  function openSkip() {
    const track = currentTrack || TRACKS.find(t => t.files.length);
    if (!track) return false;
    skipTrack = track;
    skipFrom = state;
    // the picker only needs display names — levelName falls back to the
    // filename — so it fetches nothing. A map is loaded only when one is
    // actually chosen (activateSkip -> enterLevel), exactly like picking a
    // track from Play.
    skipItems = track.files.map((_, i) => ({
      label: levelName(track, i), sub: 'Map ' + (i + 1) + '/' + track.length,
    }));
    // land on the current map when skipping from inside its own track
    skipSel = currentTrack ? levelIndex : 0;
    const maxScroll = Math.max(0, skipItems.length - SKIP_VIS);
    skipScroll = Math.max(0, Math.min(skipSel - SKIP_VIS + 1, maxScroll));
    state = 'skip';
    skipT = 0;
    hoverIdx = -1;
    keys.up = keys.down = keys.left = keys.right = false;
    blip(1320, 0.15);
    return true;
  }

  function closeSkip() {
    state = skipFrom;
    hoverIdx = -1;
    blip(440, 0.08);
  }

  function activateSkip(i) {
    if (!currentTrack) {
      currentTrack = skipTrack;
      lives = 3;
      continues = MAX_CONTINUES;
      runResults = []; // a fresh campaign, even if entered sideways
      runPerfect = true;
    }
    // skipping counts as having beaten everything before the target, so a
    // continue restarts from the checkpoint the player would hold having
    // ridden there: the map right after the last cleared 5th map
    checkpointIndex = Math.floor(i / 5) * 5;
    enterLevel(i); // sets state ('levelLoading' then 'ready'); track is loaded
    blip(1320, 0.15);
  }

  // leave the loading overlay for the title sequence. Stamps the menu clock
  // so the backdrop animations start fresh from this moment (and not from
  // whenever the page happened to finish loading).
  function leaveLoading() {
    if (!loadDone) return;
    state = 'intro';
    introT = 0;
    menuClock0 = performance.now() / 1000;
  }

  function skipIntro() {
    introT = TITLE_ANIM.dur;
    introLaunched = introLanded = TITLE_ANIM.count;
    fanfared = true;
    goMenu();
  }

  // The auto-update reload (index.html) drops a per-tab sessionStorage flag just
  // before it swaps in a new build. Spotting it on boot, we skip the tap-to-start
  // overlay straight back to the menu and try to revive audio without a fresh
  // gesture. The browser only grants that autostart to installed PWAs / high-
  // engagement tabs; where it's refused the AudioContext simply stays suspended
  // and the existing keydown/click/touch resume revives it on the next input.
  // A manual refresh never sets the flag, so it still gets the normal gate.
  function resumeAfterSwReload() {
    let flagged = false;
    try {
      flagged = sessionStorage.getItem('bm-swReload') === '1';
      if (flagged) sessionStorage.removeItem('bm-swReload');
    } catch (e) { /* sessionStorage can be unavailable in locked-down contexts */ }
    if (!flagged) return;
    menuClock0 = performance.now() / 1000; // animate the menu world from now
    goMenu();
    ensureAudio();
    if (AC && AC.state === 'suspended') { const p = AC.resume(); if (p && p.catch) p.catch(() => {}); }
  }

  // ---------- map editor ----------
  // The editor itself lives in js/editor.js; game.js owns the states
  // around it. 'editor' is the editing screen, 'editorTest' rides the
  // working map through the real sim, and 'editorTestEnd' is its
  // crash/finish screen — test rides bank nothing (no best times, no
  // checkpoints), they only answer "does this map ride?".
  let testOutcome = null;

  function goEditor() {
    EDITOR.open(W, H);
    state = 'editor';
    hoverIdx = -1;
  }

  function startEditorTest() {
    // a test ride belongs to no track: clear the once-per-track defib memory so
    // every defib on the working map is present (and stale track keys can't mark
    // one consumed by a levelIndex collision)
    consumedDefibs.clear();
    loadLevel(EDITOR.exportLevel());
    testOutcome = null;
    state = 'editorTest';
  }

  function endEditorTest() {
    state = 'editor';
    blip(440, 0.08);
  }

  EDITOR.init({
    exit: () => { blip(880, 0.08); goMenu(); },
    test: () => { blip(880, 0.08); startEditorTest(); },
    blip: () => blip(880, 0.06),
  });

  // ---------- victory ----------
  // Clearing a track's last map crossfades from the frozen finish pose
  // into the victory feast: a hold while the fanfare rings, then a long
  // dissolve ('victoryFade'), then the screen itself ('victory')
  const VICTORY_HOLD = 1.4; // s the finish pose lingers before fading
  const VICTORY_FADE = 4.2; // s the dissolve takes
  let victoryT = 0;
  let lastPacerShotId = -1; // the last ghetto-pacer shot we've sounded (once each)

  function victoryAlpha() {
    return Math.max(0, Math.min(1, (victoryT - VICTORY_HOLD) / VICTORY_FADE));
  }

  // sound the pacer's gunshot the instant his gun reaches the top, matched to
  // the muzzle flash render.js draws. The cameo only shows on a flawless ghetto
  // clear, and only once the feast has mostly faced in; the shot schedule is a
  // pure function of wall-clock time (pacerBearing, position-independent here),
  // so we re-derive the live shot and fire each id exactly once.
  function checkPacerShot() {
    if (!runPerfect) return;
    if (!(state === 'victory' || (state === 'victoryFade' && victoryAlpha() > 0.5))) return;
    const s = pacerBearing(performance.now() / 1000, 0, 1);
    if (s.shotId !== -1 && s.shotId !== lastPacerShotId && s.shotAge >= 0 && s.shotAge < 0.12) {
      gunshot();
      lastPacerShotId = s.shotId;
    }
  }

  function skipVictoryFade() {
    victoryT = VICTORY_HOLD + VICTORY_FADE;
    state = 'victory';
    hoverIdx = -1;
  }

  // everything drawVictory needs; results may be sparse (the skip cheat)
  function victoryView(rt) {
    return {
      t: rt,
      // a flawless clear (no life lost, no continue) moves the feast to the
      // ghetto at night with its ominous pacing cameo; otherwise the usual
      // meadow sunshine. Only the BACKDROP changes — the victory tune still
      // plays (updateMusic keeps 'victory' regardless of the scene's theme).
      pat: runPerfect ? patterns.ghetto : patterns.meadow,
      perfect: runPerfect,
      label: currentTrack ? currentTrack.label : '',
      names: currentTrack ? currentTrack.files.map((_, i) => levelName(currentTrack, i)) : [],
      results: runResults,
      sel: 0,
      hover: hoverIdx,
      touch: TOUCH.active,
      saveNote: TOUCH.active && saveNote === 'S: save replay' ? '' : saveNote,
    };
  }

  function activateMenu(i) {
    if (menuItems[i] === 'Play') {
      blip(880, 0.08);
      goDifficulty();
    } else if (menuItems[i] === 'Map Editor') {
      blip(880, 0.08);
      goEditor();
    } else if (menuItems[i] === 'Replays') {
      blip(880, 0.08);
      goReplays();
    } else if (menuItems[i] === 'Records') {
      blip(880, 0.08);
      goRecords();
    } else if (menuItems[i] === 'Equipment') {
      blip(880, 0.08);
      goEquipment();
    } else if (menuItems[i] === 'Audio') {
      blip(880, 0.08);
      goAudio();
    }
  }

  function activateDifficulty(i) {
    const track = visibleTracks()[i];
    if (!track.files.length) {
      blip(180, 0.12); // not available yet
      return;
    }
    blip(880, 0.08);
    startGame(track);
  }

  function activateContinue(i) {
    if (i === 0) {
      if (continues <= 0) {
        blip(180, 0.12);
        return;
      }
      blip(880, 0.08);
      useContinue();
    } else {
      goMenu();
    }
  }

  function activatePause(i) {
    if (pauseItems[i] === 'Continue') state = pausedFrom;
    else if (pauseItems[i] === 'Audio') goAudio();
    else goMenu();
  }

  // ---------- input ----------
  function currentRects() {
    if (state === 'menu' && menuT > 0.15) {
      return mainMenuRects(W, H, menuItems.length);
    }
    if (state === 'difficulty' && diffT > 0.15) {
      return menuRects(W, H, visibleTracks().length, H * 0.34);
    }
    if (state === 'records') {
      return recordsRects(W, H); // the ◀ / ▶ track-selector arrows
    }
    if (state === 'equipment' && equipT > 0.15) {
      // slot rows first, then the selected slot's item rows; activateHover /
      // updateHover split the index on EQUIP_SLOTS.length
      return [].concat(
        equipSlotRects(W, H, EQUIP_SLOTS.length),
        equipItemRects(W, H, currentSlotItems().length));
    }
    if (state === 'continue' && contT > 0.15) {
      return menuRects(W, H, 2, H * 0.62);
    }
    if (state === 'levelLoadError') {
      return menuRects(W, H, 2, H * 0.62);
    }
    if (state === 'replays' && repT > 0.15) {
      const n = Math.min(REPLAY_VIS, repItems.length - repScroll);
      if (n > 0) return replayRects(W, H, n, H * 0.22);
      return null;
    }
    if (state === 'skip' && skipT > 0.15) {
      const n = Math.min(SKIP_VIS, skipItems.length - skipScroll);
      if (n > 0) return replayRects(W, H, n, H * 0.24);
      return null;
    }
    if (state === 'paused') {
      return menuRects(W, H, pauseItems.length, H * 0.46);
    }
    if (state === 'audio' && audioT > 0.15) {
      return audioRects(W, H);
    }
    if (state === 'victory') {
      return victoryRects(W, H);
    }
    return null;
  }

  // is (x, y) over the dev-only Skip chip? It shows (and so works) on every
  // menu sub-screen that keeps the version stamp visible — the same screens
  // menuScene draws it on — but never off a dev host.
  function skipChipHit(x, y) {
    if (!devSkip) return false;
    if (!(state === 'menu' || state === 'difficulty' || state === 'records' ||
          state === 'equipment' || state === 'replays' ||
          (state === 'audio' && audioFrom !== 'paused'))) {
      return false;
    }
    const r = skipChipRect(W, H);
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // the corner Back button (drawMenuBack) lives outside the screen's `rects`,
  // so the menu sub-screens that draw it hit-test it on its own
  function backChipActive() {
    return state === 'difficulty' || state === 'records' ||
           state === 'equipment' || state === 'replays' || state === 'audio';
  }
  function backChipHit(x, y) {
    if (!backChipActive()) return false;
    const r = menuBackRect(W, H);
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
  // leave a sub-screen via its corner Back: audio returns to wherever it was
  // opened from (menu or pause), the rest return to the main menu
  function backChipAction() {
    blip(880, 0.08);
    if (state === 'audio') closeAudio();
    else goMenu();
  }

  function updateHover() {
    if (state === 'editor') return; // the editor manages its own cursor
    const rects = currentRects();
    hoverIdx = -1;
    if (rects) {
      rects.forEach((r, i) => {
        if (mouse.x >= r.x && mouse.x <= r.x + r.w &&
            mouse.y >= r.y && mouse.y <= r.y + r.h) hoverIdx = i;
      });
    }
    // the chip and the corner Back both live outside `rects`
    skipHover = skipChipHit(mouse.x, mouse.y);
    backHover = backChipHit(mouse.x, mouse.y);
    canvas.style.cursor = (hoverIdx >= 0 || skipHover || backHover) ? 'pointer' : 'default';
  }

  window.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }
    ensureAudio();
    if (AC && AC.state === 'suspended') AC.resume();
    // the editor owns the keyboard while it's up; M still mutes unless the map
    // name is being typed or the Load browser's search box is taking keystrokes
    if (state === 'editor') {
      if (!EDITOR.naming && !EDITOR.browseOpen && (e.key === 'm' || e.key === 'M')) {
        setMuted(!muted);
        return;
      }
      EDITOR.key(e);
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      setMuted(!muted);
      return;
    }
    // H toggles the riding HUD (all UI frames) off for a clean view
    if (e.key === 'h' || e.key === 'H') {
      hudHidden = !hudHidden;
      return;
    }
    switch (state) {
      case 'loading':
        leaveLoading();
        return;
      case 'intro':
        skipIntro();
        return;
      case 'menu':
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const d = e.key === 'ArrowUp' ? -1 : 1;
          menuSel = (menuSel + d + menuItems.length) % menuItems.length;
          blip(520, 0.05);
        } else if (e.key === 'Enter' || e.key === ' ') {
          activateMenu(menuSel);
        }
        return;
      case 'difficulty':
        if (e.key === 'Escape') { goMenu(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const d = e.key === 'ArrowUp' ? -1 : 1;
          // step to the next enabled track, skipping any that are disabled;
          // if Beginner is the only one unlocked, this stays put on it
          const vt = visibleTracks();
          let next = diffSel;
          for (let k = 0; k < vt.length; k++) {
            next = (next + d + vt.length) % vt.length;
            if (vt[next].files.length) break;
          }
          if (next !== diffSel) { diffSel = next; blip(520, 0.05); }
        } else if (e.key === 'Enter' || e.key === ' ') {
          activateDifficulty(diffSel);
        }
        return;
      case 'records':
        // ◀ / ▶ (or up/down) switch tracks; any confirm/cancel returns to menu
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { cycleRecordsTrack(-1); return; }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { cycleRecordsTrack(1); return; }
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
          blip(440, 0.08);
          goMenu();
        }
        return;
      case 'equipment': {
        if (e.key === 'Escape') { goMenu(); return; }
        // ←/→ move focus between the slot column and the item column; ↑/↓ move
        // within the focused column; Enter opens a slot's items or equips one
        if (e.key === 'ArrowLeft') { equipFocus = 'slots'; blip(520, 0.05); return; }
        if (e.key === 'ArrowRight') {
          if (currentSlotItems().length) { equipFocus = 'items'; blip(520, 0.05); }
          else blip(180, 0.12);
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const d = e.key === 'ArrowUp' ? -1 : 1;
          if (equipFocus === 'slots') {
            const n = EQUIP_SLOTS.length;
            selectEquipSlot((equipSlot + d + n) % n);
            blip(520, 0.05);
          } else {
            const n = currentSlotItems().length;
            if (n) { equipSel = (equipSel + d + n) % n; blip(520, 0.05); }
          }
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          if (equipFocus === 'items') activateEquipment(equipSel);
          else if (currentSlotItems().length) { equipFocus = 'items'; blip(520, 0.05); }
          else blip(180, 0.12);
        }
        return;
      }
      case 'paused':
        if (e.key === 'Escape') { state = pausedFrom; return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const d = e.key === 'ArrowUp' ? -1 : 1;
          pauseSel = (pauseSel + d + pauseItems.length) % pauseItems.length;
          blip(520, 0.05);
        } else if (e.key === 'Enter' || e.key === ' ') {
          blip(880, 0.08);
          activatePause(pauseSel);
        }
        return;
      case 'audio': {
        // Esc (or the corner Back) leaves; the screen is otherwise just the
        // three volume sliders now that Back isn't a focusable row
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { closeAudio(); return; }
        const rows = audioKeys.length; // the three sliders
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const d = e.key === 'ArrowUp' ? -1 : 1;
          audioSel = (audioSel + d + rows) % rows;
          blip(520, 0.05);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          nudgeVolume(audioSel, e.key === 'ArrowLeft' ? -1 : 1);
        }
        return;
      }
      case 'replays':
        if (e.key === 'Escape') { goMenu(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          if (repItems.length) {
            const d = e.key === 'ArrowUp' ? -1 : 1;
            repSel = (repSel + d + repItems.length) % repItems.length;
            // keep the selection inside the visible window
            if (repSel < repScroll) repScroll = repSel;
            if (repSel >= repScroll + REPLAY_VIS) repScroll = repSel - REPLAY_VIS + 1;
            blip(520, 0.05);
          }
        } else if (e.key === 'Enter' || e.key === ' ') {
          activateReplays(repSel);
        }
        return;
      case 'skip':
        if (e.key === 'Escape') { closeSkip(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          if (skipItems.length) {
            const d = e.key === 'ArrowUp' ? -1 : 1;
            skipSel = (skipSel + d + skipItems.length) % skipItems.length;
            // keep the selection inside the visible window
            if (skipSel < skipScroll) skipScroll = skipSel;
            if (skipSel >= skipScroll + SKIP_VIS) skipScroll = skipSel - SKIP_VIS + 1;
            blip(520, 0.05);
          }
        } else if (e.key === 'Enter' || e.key === ' ') {
          activateSkip(skipSel);
        }
        return;
      case 'replay':
      case 'replayEnd':
        if (e.key === 'Escape' || e.key === 'Enter') endReplayView();
        return;
      case 'finished':
        if (e.key === 's' || e.key === 'S') { saveReplay(); return; }
        if (e.key === 'Enter') {
          if (hasNextLevel()) {
            enterLevel(levelIndex + 1); // sets state (next map is prefetched)
          } else {
            goMenu(); // track complete (as far as it exists, anyway)
          }
        } else if (e.key === 'Escape') openPause();
        return;
      case 'dead':
        if (e.key === 's' || e.key === 'S') { saveReplay(); return; }
        if (e.key === 'Enter') {
          if (lives > 0) { reset(); state = 'playing'; }
          else goContinue();
        } else if (e.key === 'Escape') openPause();
        return;
      case 'victoryFade':
        // let the impatient cut to the feast (held-down keys don't count,
        // so a throttle finger still on UP can't blow through the dissolve)
        if (!e.repeat && (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape')) {
          skipVictoryFade();
        }
        return;
      case 'victory':
        if (e.key === 's' || e.key === 'S') { saveReplay(); return; }
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
          blip(880, 0.08);
          goMenu();
        }
        return;
      case 'continue':
        if (e.key === 'Escape') { goMenu(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          if (continues > 0) {
            contSel = 1 - contSel;
            blip(520, 0.05);
          }
        } else if (e.key === 'Enter' || e.key === ' ') {
          activateContinue(contSel);
        }
        return;
      case 'levelLoadError':
        if (e.key === 'Escape') { goMenu(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          errSel = 1 - errSel;
          blip(520, 0.05);
        } else if (e.key === 'Enter' || e.key === ' ') {
          activateLoadError(errSel);
        }
        return;
      case 'ready':
        if (e.key === 'Escape') { goMenu(); return; }
        state = 'playing'; // any other key starts riding, and still applies below
        break;
      case 'playing':
        if (e.key === 'Escape') { openPause(); return; }
        break;
      case 'editorTest':
        if (e.key === 'Escape') { endEditorTest(); return; }
        if (e.key === 'Enter') { reset(); return; } // instant retry while iterating
        break;
      case 'editorTestEnd':
        if (e.key === 's' || e.key === 'S') { saveReplay(); return; }
        if (e.key === 'Escape') { endEditorTest(); return; }
        if (e.key === 'Enter') { reset(); state = 'editorTest'; }
        return;
    }

    switch (e.key) {
      case 'ArrowUp': keys.up = true; break;
      case 'ArrowDown': keys.down = true; break;
      case 'ArrowLeft': keys.left = true; break;
      case 'ArrowRight': keys.right = true; break;
      case ' ': if (!e.repeat) flipQueued = true; break;
    }
  });
  window.addEventListener('keyup', e => {
    switch (e.key) {
      case 'ArrowUp': keys.up = false; break;
      case 'ArrowDown': keys.down = false; break;
      case 'ArrowLeft': keys.left = false; break;
      case 'ArrowRight': keys.right = false; break;
    }
  });
  window.addEventListener('blur', () => {
    keys.up = keys.down = keys.left = keys.right = false;
    if (state === 'playing') openPause();
    if (state === 'editor') EDITOR.mouseUp(); // a drag can't survive alt-tab
  });

  // fire the menu item under the cursor/finger; shared by mouse clicks
  // and touch taps
  function activateHover() {
    if (hoverIdx < 0) return;
    if (state === 'menu') {
      menuSel = hoverIdx;
      activateMenu(hoverIdx);
    } else if (state === 'difficulty') {
      if (visibleTracks()[hoverIdx].files.length) diffSel = hoverIdx;
      activateDifficulty(hoverIdx);
    } else if (state === 'records') {
      // the two ◀ / ▶ selector arrows (the corner Back is hit-tested apart)
      if (hoverIdx === 0) cycleRecordsTrack(-1);
      else if (hoverIdx === 1) cycleRecordsTrack(1);
    } else if (state === 'equipment') {
      const nSlots = EQUIP_SLOTS.length;
      if (hoverIdx < nSlots) {            // a slot row: select it (switch items)
        equipFocus = 'slots';
        selectEquipSlot(hoverIdx);
        blip(520, 0.05);
      } else {                            // an item row: equip it
        equipFocus = 'items';
        equipSel = hoverIdx - nSlots;
        activateEquipment(equipSel);
      }
    } else if (state === 'continue') {
      contSel = hoverIdx;
      activateContinue(hoverIdx);
    } else if (state === 'levelLoadError') {
      errSel = hoverIdx;
      activateLoadError(hoverIdx);
    } else if (state === 'replays') {
      repSel = repScroll + hoverIdx;
      activateReplays(repSel);
    } else if (state === 'skip') {
      skipSel = skipScroll + hoverIdx;
      activateSkip(skipSel);
    } else if (state === 'paused') {
      pauseSel = hoverIdx;
      activatePause(hoverIdx);
    } else if (state === 'victory') {
      blip(880, 0.08);
      goMenu(); // the screen's one button
    }
  }

  canvas.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (state === 'editor') {
      EDITOR.mouseMove(e.clientX, e.clientY, e.shiftKey);
      canvas.style.cursor = EDITOR.cursor();
      return;
    }
    if (audioDrag >= 0 && state === 'audio') dragVolume(e.clientX);
    updateHover();
  });
  // the audio sliders want press-and-drag, which click alone can't
  // express; the editor wants the same for its handles and panning
  canvas.addEventListener('mousedown', e => {
    if (state === 'editor') {
      ensureAudio();
      if (AC && AC.state === 'suspended') AC.resume();
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (e.button === 0) EDITOR.mouseDown(e.clientX, e.clientY, e);
      return;
    }
    if (state !== 'audio') return;
    ensureAudio();
    if (AC && AC.state === 'suspended') AC.resume();
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    updateHover();
    if (hoverIdx >= 0 && hoverIdx < audioKeys.length) {
      audioDrag = hoverIdx;
      audioSel = hoverIdx;
      audioDragged = true;
      dragVolume(e.clientX);
    }
  });
  window.addEventListener('mouseup', e => {
    if (state === 'editor') EDITOR.mouseUp(e.clientX, e.clientY);
    audioDrag = -1;
  });
  canvas.addEventListener('dblclick', e => {
    if (state !== 'editor') return;
    EDITOR.dblClick(e.clientX, e.clientY);
  });
  canvas.addEventListener('wheel', e => {
    if (state !== 'editor') return;
    e.preventDefault();
    EDITOR.wheel(e);
  }, { passive: false });
  canvas.addEventListener('click', e => {
    if (state === 'editor') return; // mousedown/up already handled it
    ensureAudio();
    if (AC && AC.state === 'suspended') AC.resume();
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    updateHover();
    audioDragged = false; // clear the drag-ate-the-click guard each click
    if (state === 'loading') {
      leaveLoading();
      return;
    }
    if (state === 'intro') { skipIntro(); return; }
    // the dev Skip chip and the corner Back both sit outside the button rects,
    // so test them before the hover-based dispatch
    if (skipChipHit(mouse.x, mouse.y)) { openSkip(); return; }
    if (backChipHit(mouse.x, mouse.y)) { backChipAction(); return; }
    if (hoverIdx < 0) return;
    if (state === 'audio') return; // sliders act on drag, not on a plain click
    activateHover();
  });

  // ---------- touch ----------
  // Taps drive the menus (acting on touchstart, so there is no synthetic
  // click to double-fire); held fingers drive the riding cluster, which
  // TOUCH resolves positionally on every event.
  let tapGuardUntil = 0; // shields the crash/finish screens from mash-taps

  // per-state tap actions beyond what a mouse click can mean
  function touchTap(x, y) {
    const k = TOUCH.layout(W, H);
    // the dev Skip chip shows on every menu sub-screen, so test it up front
    if (skipChipHit(x, y)) { openSkip(); return; }
    switch (state) {
      case 'loading':
        leaveLoading();
        return;
      case 'intro':
        skipIntro();
        return;
      case 'menu':
        activateHover();
        return;
      case 'continue':
      case 'levelLoadError':
      case 'paused':
        activateHover();
        return;
      case 'difficulty':
        if (TOUCH.hit(k.back, x, y)) { blip(880, 0.08); goMenu(); return; }
        activateHover();
        return;
      case 'records':
        if (TOUCH.hit(k.back, x, y)) { blip(880, 0.08); goMenu(); return; }
        activateHover(); // the ◀ / ▶ track-selector arrows
        return;
      case 'equipment':
        if (TOUCH.hit(k.back, x, y)) { blip(880, 0.08); goMenu(); return; }
        activateHover(); // tap a card to equip it (locked cards just buzz)
        return;
      case 'replays': {
        if (TOUCH.hit(k.back, x, y)) { blip(880, 0.08); goMenu(); return; }
        // the "- more -" rows above and below the list window scroll it;
        // derive the bottom row from replayRects so the tap zone tracks the
        // responsive row height instead of a fixed pitch
        const y0 = H * 0.22;
        const rs = replayRects(W, H, Math.min(REPLAY_VIS, repItems.length - repScroll), y0);
        const bot = rs.length ? rs[rs.length - 1].y + rs[rs.length - 1].h + 6 : y0;
        const maxScroll = Math.max(0, repItems.length - REPLAY_VIS);
        if (repScroll > 0 && y > y0 - 50 && y < y0) {
          repScroll--;
          blip(520, 0.05);
          return;
        }
        if (repScroll < maxScroll && y > bot && y < bot + 56) {
          repScroll++;
          blip(520, 0.05);
          return;
        }
        activateHover();
        return;
      }
      case 'skip': {
        if (TOUCH.hit(k.back, x, y)) { closeSkip(); return; }
        const y0 = H * 0.24;
        const rs = replayRects(W, H, Math.min(SKIP_VIS, skipItems.length - skipScroll), y0);
        const bot = rs.length ? rs[rs.length - 1].y + rs[rs.length - 1].h + 6 : y0;
        const maxScroll = Math.max(0, skipItems.length - SKIP_VIS);
        if (skipScroll > 0 && y > y0 - 50 && y < y0) {
          skipScroll--;
          blip(520, 0.05);
          return;
        }
        if (skipScroll < maxScroll && y > bot && y < bot + 56) {
          skipScroll++;
          blip(520, 0.05);
          return;
        }
        activateHover();
        return;
      }
      case 'audio':
        if (TOUCH.hit(k.back, x, y)) { blip(880, 0.08); closeAudio(); return; }
        if (hoverIdx >= 0 && hoverIdx < audioKeys.length) {
          audioDrag = hoverIdx;
          audioSel = hoverIdx;
          dragVolume(x);
        }
        return;
      case 'ready':
        if (TOUCH.hit(k.pause, x, y)) { openPause(); return; }
        state = 'playing'; // tap to ride; a held gas finger already counts
        return;
      case 'playing':
        if (TOUCH.hit(k.pause, x, y)) { openPause(); return; }
        return;
      case 'dead':
      case 'finished':
        if (TOUCH.hit(k.save, x, y)) { saveReplay(); return; }
        if (TOUCH.hit(k.pause, x, y)) { openPause(); return; }
        if (performance.now() < tapGuardUntil) return;
        if (state === 'dead') {
          if (lives > 0) { reset(); state = 'playing'; }
          else goContinue();
        } else if (hasNextLevel()) {
          enterLevel(levelIndex + 1); // sets state (next map is prefetched)
        } else {
          goMenu();
        }
        return;
      case 'victoryFade':
        if (performance.now() < tapGuardUntil) return;
        skipVictoryFade(); // a tap cuts straight to the feast
        return;
      case 'victory':
        activateHover();
        return;
      case 'replay':
      case 'replayEnd':
        endReplayView();
        return;
      case 'editorTest':
        if (TOUCH.hit(k.pause, x, y)) { endEditorTest(); return; }
        if (TOUCH.hit(k.restart, x, y)) { reset(); return; }
        return;
      case 'editorTestEnd':
        if (TOUCH.hit(k.save, x, y)) { saveReplay(); return; }
        if (TOUCH.hit(k.pause, x, y)) { endEditorTest(); return; }
        if (performance.now() < tapGuardUntil) return;
        reset();
        state = 'editorTest';
        return;
    }
  }

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    TOUCH.activate();
    lockLandscape();
    ensureAudio();
    if (AC && AC.state === 'suspended') AC.resume();
    const t = e.changedTouches[0];
    mouse.x = t.clientX;
    mouse.y = t.clientY;
    // the editor reads a finger as a mouse: press, drag, release
    if (state === 'editor') {
      EDITOR.mouseDown(t.clientX, t.clientY, e);
      return;
    }
    updateHover();
    // a fresh finger on the turn-around button queues a flip (one-shot,
    // like the space bar — a held finger doesn't repeat it)
    if (state === 'playing' || state === 'ready' || state === 'editorTest') {
      const L = TOUCH.layout(W, H);
      for (const c of e.changedTouches) {
        if (TOUCH.hit(L.flip, c.clientX, c.clientY)) flipQueued = true;
      }
    }
    TOUCH.sync(e.touches, W, H);
    touchTap(t.clientX, t.clientY);
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    mouse.x = t.clientX;
    mouse.y = t.clientY;
    if (state === 'editor') {
      EDITOR.mouseMove(t.clientX, t.clientY);
      return;
    }
    if (audioDrag >= 0 && state === 'audio') dragVolume(t.clientX);
    updateHover();
    TOUCH.sync(e.touches, W, H);
  }, { passive: false });

  function touchEnd(e) {
    e.preventDefault();
    if (state === 'editor') {
      const t = e.changedTouches[0];
      EDITOR.mouseUp(t ? t.clientX : undefined, t ? t.clientY : undefined);
      return;
    }
    TOUCH.sync(e.touches, W, H);
    if (!e.touches.length) audioDrag = -1;
  }
  canvas.addEventListener('touchend', touchEnd, { passive: false });
  canvas.addEventListener('touchcancel', touchEnd, { passive: false });

  // long-press save-image popups would interrupt play on touch devices
  canvas.addEventListener('contextmenu', e => {
    if (TOUCH.active) e.preventDefault();
  });

  // ---------- gameplay ----------
  // Style points are scored for airborne tricks. The detection only READS
  // sim state (never feeds back into the physics), so live play and replay
  // playback recompute the same totals and old tapes stay in sync.
  const STYLE_FLIP = 100; // turning around (space) while fully airborne
  const STYLE_SPIN = 250; // each full rotation, in the air or on the ground
  const STYLE_WHEELIE = 50;      // full-speed ceiling per interval held in a wheelie
  const STYLE_STOPPIE = 300;     // stoppie ceiling: far harder to hold, so worth more
  const STYLE_TRICK_EVERY = 1;   // seconds of unbroken balance per payout
  const TRICK_SLACK = 0.4;       // gap (m) under a wheel still scored as planted
  const TRICK_FULL_SPEED = 8;    // m/s at/above which a trick pays its full ceiling

  // true only once a physics step has run (onGround starts undefined), so
  // a flip queued on the very first frame of a run can't read as airborne
  function bikeAirborne() {
    return bike.wheels.every(w => w.onGround === false);
  }

  // Whether a wheel is "planted" for trick scoring. The strict onGround flag
  // only trips while the tire is penetrating a segment, but the bike chatters
  // and bounces over terrain constantly, so a hair of daylight under the
  // balancing wheel would flicker the flag off and break a wheelie/stoppie.
  // Instead we measure the gap to the nearest segment and count anything
  // within TRICK_SLACK as still down — a read-only test, like the rest of the
  // style detection, so live play and replay stay in sync.
  function wheelPlanted(w) {
    for (const s of level.segments) {
      const cp = closestOnSeg(w.pos.x, w.pos.y, s);
      if (Math.hypot(w.pos.x - cp.x, w.pos.y - cp.y) < PHYS.wheelR + TRICK_SLACK) {
        return true;
      }
    }
    return false;
  }

  // fraction of a trick's ceiling earned at the current speed: full value at
  // TRICK_FULL_SPEED and above, falling off steeply (squared) toward a crawl,
  // so a fast wheelie banks the ceiling and a near-stationary balance earns
  // almost nothing. read-only on velocity, so replays recompute identically
  function trickSpeedScale() {
    const f = Math.min(1, Math.hypot(bike.vel.x, bike.vel.y) / TRICK_FULL_SPEED);
    return f * f;
  }

  function awardStyle(pts) {
    stylePts += pts;
    // toasts cycle three lanes so back-to-back awards rise side by side
    stylePopups.push({ text: '+' + pts, age: 0, dx: [0, -0.6, 0.6][popupSeq++ % 3] });
    styleSparkle(pts >= STYLE_SPIN);
  }

  function agePopups(dt) {
    for (const p of stylePopups) p.age += dt;
    // appended in age order, so the head is always the oldest
    if (stylePopups.length && stylePopups[0].age >= STYLE_POPUP_DUR) {
      stylePopups = stylePopups.filter(p => p.age < STYLE_POPUP_DUR);
    }
    // the defibrillator's cosmetic state ages alongside the style toasts: the
    // electrocution zaps, the "+1 LIFE" toasts, and the lives-row pop-in timer
    for (const z of zaps) z.age += dt;
    if (zaps.length) zaps = zaps.filter(z => z.age < ZAP_DUR);
    for (const p of lifePopups) p.age += dt;
    if (lifePopups.length) lifePopups = lifePopups.filter(p => p.age < LIFE_POPUP_DUR);
    lifeAnimT += dt;
  }

  // ---------- exhaust smoke ----------
  // Purely cosmetic, so it isn't recorded and may use Math.random freely (it
  // never touches the sim, so replays stay deterministic). The harder the
  // engine is pulling, the faster and fatter the puffs: bike.engineLoad is a
  // smoothed 0..1 the sim updates each frame from throttle + how much
  // acceleration the engine still has to give (full off the line, none at top
  // speed — the same accelLeft the wheelie reaction uses). drawBike reads it
  // for the warm tip glow; here it drives the spawn rate.
  const SMOKE_RATE = 30;  // puffs/sec at full engine load
  const SMOKE_MAX = 90;   // hard cap so a long pull can't grow the array forever

  function updateEngineLoad(input) {
    const rear = bike.wheels[bike.rearIndex];
    const accelLeft = Math.max(0, 1 - Math.abs(rear.spin) / PHYS.maxSpin);
    const target = (input.throttle && !bike.dead) ? 0.3 + 0.7 * accelLeft : 0;
    bike.engineLoad = (bike.engineLoad || 0) + (target - (bike.engineLoad || 0)) * 0.12;
  }

  // ---------- rider jostle (cosmetic soft-body) ----------
  // The rider's upper body is a damped spring riding the chassis: it lags the
  // bike's acceleration (engine shove, braking pitch, terrain chatter, the slam
  // of a landing), so the torso heaves, the head bobs and the limbs flex on
  // their joints. Sitting still it settles to the neutral drawn pose; a launch
  // lifts it gently off the seat and a hard landing slams it down. A second
  // little spring lags the bike's ANGULAR acceleration so a sharp pitch
  // (cresting a jump, slamming down) whips the head into a nod.
  //   Purely visual: it READS bike.vel/avel but never writes the sim, so replays
  // reproduce it exactly off the same input tape — nothing here touches the .bmr
  // format or needs a VERSION bump. drawBike applies the offset, graded by how
  // high up the body each point sits, so the seat and pegs stay planted while
  // the head travels most. Lazily-initialised fields (no constructor change),
  // so a fresh Bike starts settled and menu/preview bikes read 0 via `|| 0`.
  const JOSTLE_K = 320, JOSTLE_C = 13;   // body spring: ~2.8 Hz, lightly damped → it bobs
  const JOSTLE_DRIVE = 3.0;              // how hard felt-accel shoves the body
  const JOSTLE_ACAP = 32;                // clamp felt-accel (m/s²): a slam saturates, never explodes
  const JOSTLE_CAP = 0.18;               // max body offset (m) — the silhouette never tears
  const HEADWOB_K = 360, HEADWOB_C = 14; // head-nod spring
  const HEADWOB_DRIVE = 0.05;            // how hard angular-accel whips the head
  const HEADWOB_ACAP = 50, HEADWOB_CAP = 0.16; // clamps (rad/s² in, rad out): a gentle nod

  function updateRiderJostle(dt) {
    // The chassis' actual acceleration this frame (world space, no gravity term):
    // the artist's rest pose ALREADY draws the rider sagged under 1g, so the
    // standing weight is baked in and only the DEVIATION from sitting still
    // should move the body — which works out to pure -acceleration (gravity
    // cancels against the rest pose). So a clean parabola in the air lifts the
    // body gently off the seat, a hard landing slams it down, and a still bike
    // sits neutral — all without caring which way a gravity burger aimed "down".
    let ax = 0, ay = 0;
    if (bike.pjVx != null) {
      ax = (bike.vel.x - bike.pjVx) / dt;
      ay = (bike.vel.y - bike.pjVy) / dt;
    }
    bike.pjVx = bike.vel.x; bike.pjVy = bike.vel.y;
    const am = Math.hypot(ax, ay);
    if (am > JOSTLE_ACAP) { const s = JOSTLE_ACAP / am; ax *= s; ay *= s; }
    // pseudo-force: the body lags OPPOSITE the chassis' acceleration
    let vx = bike.jostleVX || 0, vy = bike.jostleVY || 0;
    let ox = bike.jostleX || 0, oy = bike.jostleY || 0;
    vx += (-JOSTLE_K * ox - JOSTLE_C * vx - JOSTLE_DRIVE * ax) * dt;
    vy += (-JOSTLE_K * oy - JOSTLE_C * vy - JOSTLE_DRIVE * ay) * dt;
    ox += vx * dt; oy += vy * dt;
    // clamp the offset (and bleed off the velocity that drove past the cap) so
    // even the worst slam can only heave the body so far before it springs back
    const om = Math.hypot(ox, oy);
    if (om > JOSTLE_CAP) { const s = JOSTLE_CAP / om; ox *= s; oy *= s; vx *= s; vy *= s; }
    bike.jostleVX = vx; bike.jostleVY = vy; bike.jostleX = ox; bike.jostleY = oy;

    // head nod: a second spring lagging the chassis' angular acceleration
    let aa = 0;
    if (bike.pjAvel != null) aa = (bike.avel - bike.pjAvel) / dt;
    bike.pjAvel = bike.avel;
    if (aa > HEADWOB_ACAP) aa = HEADWOB_ACAP; else if (aa < -HEADWOB_ACAP) aa = -HEADWOB_ACAP;
    let hv = bike.headWobV || 0, hw = bike.headWob || 0;
    hv += (-HEADWOB_K * hw - HEADWOB_C * hv - HEADWOB_DRIVE * aa) * dt;
    hw += hv * dt;
    if (hw > HEADWOB_CAP) { hw = HEADWOB_CAP; hv = 0; }
    else if (hw < -HEADWOB_CAP) { hw = -HEADWOB_CAP; hv = 0; }
    bike.headWobV = hv; bike.headWob = hw;
  }

  // ---------- wheel squash (cosmetic tyre deform) ----------
  // The tyre flattens against whatever it's pressed into. physics.wheelContacts
  // publishes per wheel (all inert): `pinchAmt` + `pinchAxis{X,Y}` (the REAL
  // geometric squeeze between two opposing walls, and its axis) and `contactN{X,Y}`
  // (the support normal for a lone contact). Here we resolve each wheel to a
  // smoothed (amount, axis, pivot) the renderer scales by. Two modes, whichever
  // is bigger:
  //  • PINCH — amount = the geometric gap squeeze (proportional to how tight the
  //    slot is, NOT to momentum), axis straight off the opposing pair (stable
  //    even bottomed out). Pivot rides toward the gravity-ward end of the axis,
  //    so a vertical pinch stays planted on the floor while the top caves in, and
  //    a sideways pinch squashes symmetrically about the centre.
  //  • CONTACT — a small weight-bearing flatten + a springy landing pulse, along
  //    the support normal, pivoted at the contact patch (squash-and-stretch).
  // Reads the sim, never writes it → replays reproduce it, no version bump. Lazy
  // `||0` fields, so preview/menu wheels read perfectly round.
  const SQ_R0 = PHYS.wheelR;    // tyre contact radius (= collider) for pivot maths
  const SQ_BASE = 0.03;         // resting flatten (m of diameter) while grounded
  const SQ_IMPACT_GAIN = 0.18;  // a full-power landing adds this much flatten (m)
  const SQ_IMPACT_DECAY = 0.86; // per-frame bleed of the landing pulse (springy rebound)
  const SQ_EASE = 0.45;         // how fast the flatten chases its target
  const SQ_DIR_EASE = 0.4;      // how fast the axis/pivot swing to a new contact
  const SQ_MAX = 0.55;          // cap on flatten (m); render also clamps the ratio

  function updateWheelSquash(dt) {
    for (const w of bike.wheels) {
      const pinch = w.pinchAmt || 0;
      const contact = (w.onGround ? SQ_BASE : 0) + (w.sqImpact || 0);
      let tFlat, axX, axY, pvX, pvY;
      if (pinch >= contact && pinch > 0) {
        // pinch: stable axis off the opposing pair; pivot toward the support end
        tFlat = pinch;
        axX = w.pinchAxisX || 0; axY = w.pinchAxisY || 0;
        // keep the axis SIGN aligned frame-to-frame so easing can't cancel it
        // (the squash itself is sign-agnostic; only the smoothing cares)
        if (axX * (w.sqAxisX || 0) + axY * (w.sqAxisY || 0) < 0) { axX = -axX; axY = -axY; }
        // pivot offset = axis·gravity along the axis: full radius toward the
        // floor for a vertical slot, ~zero (centre) for a sideways one — and
        // sign-independent, so it never flips with the axis
        const ag = axX * bike.gravDir.x + axY * bike.gravDir.y;
        pvX = axX * ag * SQ_R0; pvY = axY * ag * SQ_R0;
      } else {
        // lone contact: flatten along the support normal, planted at the patch
        tFlat = contact;
        axX = w.contactNX || 0; axY = w.contactNY || 0;
        pvX = -axX * SQ_R0; pvY = -axY * SQ_R0;
      }
      if (tFlat > SQ_MAX) tFlat = SQ_MAX;
      w.sqFlat = (w.sqFlat || 0) + (tFlat - (w.sqFlat || 0)) * SQ_EASE;
      w.sqAxisX = (w.sqAxisX || 0) + (axX - (w.sqAxisX || 0)) * SQ_DIR_EASE;
      w.sqAxisY = (w.sqAxisY || 0) + (axY - (w.sqAxisY || 0)) * SQ_DIR_EASE;
      w.sqPivX = (w.sqPivX || 0) + (pvX - (w.sqPivX || 0)) * SQ_DIR_EASE;
      w.sqPivY = (w.sqPivY || 0) + (pvY - (w.sqPivY || 0)) * SQ_DIR_EASE;
      w.sqImpact = (w.sqImpact || 0) * SQ_IMPACT_DECAY;
    }
  }

  function emitExhaust(dt) {
    const load = bike.engineLoad || 0;
    if (load < 0.05) { exhaustAcc = 0; return; } // coasting: tailpipe is clean
    // the muffler tip and the point just inside it, in world space, so puffs
    // shoot out along the can's axis (back and up) no matter the bike's tilt
    const tip = bike.l2w(EXHAUST_TIP[0], EXHAUST_TIP[1], true);
    const vent = bike.l2w(EXHAUST_VENT[0], EXHAUST_VENT[1], true);
    let dx = tip.x - vent.x, dy = tip.y - vent.y;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    // what the pipe puts out scales with the cosmetic skin: grey smoke (0/1),
    // actual flames (RED HOT) or a plasma heat-haze trail (AFTERBURNER/MASTER —
    // master tints the haze gold and spits bright embers through it)
    const sk = bikePalette(BIKE_SKIN);
    const mode = sk.exhaust;
    // mirage ripples are big and costly (canvas self-sampling), so spawn fewer
    const rate = mode === 'flame' ? SMOKE_RATE * 1.4
               : mode === 'mirage' ? SMOKE_RATE * 0.8 : SMOKE_RATE;
    const cap = mode === 'mirage' ? 22 : SMOKE_MAX;
    exhaustAcc += load * rate * dt;
    while (exhaustAcc >= 1 && exhaust.length < cap) {
      exhaustAcc -= 1;
      const rnd = (a, b) => a + Math.random() * (b - a);
      const cvx = bike.vel.x * 0.3, cvy = bike.vel.y * 0.3; // carry some bike motion
      if (mode === 'flame') {
        // a sooty dark-smoke puff billowing off the fire — pushed FIRST so the
        // fresh flame below draws over it (tip stays bright). It outlives the
        // flame several times over, so it streams out into a long black trail
        // that reaches well PAST where the short, bright fire dies
        if (Math.random() < 0.7) {
          const sout = rnd(0.9, 1.9) * (0.5 + load);
          exhaust.push({
            x: tip.x + rnd(-0.06, 0.06), y: tip.y + rnd(-0.06, 0.06),
            vx: cvx + dx * sout + rnd(-0.35, 0.35), vy: cvy + dy * sout + rnd(-0.35, 0.35),
            age: 0, life: rnd(0.9, 1.6), r0: rnd(0.08, 0.13), r1: rnd(0.45, 0.75),
            alpha: rnd(0.5, 0.75), tint: '24,22,26', // very dark soot
          });
        }
        const out = rnd(1.2, 2.6) * (0.5 + load);
        exhaust.push({
          x: tip.x + rnd(-0.05, 0.05), y: tip.y + rnd(-0.05, 0.05),
          vx: cvx + dx * out + rnd(-0.4, 0.4), vy: cvy + dy * out + rnd(-0.4, 0.4),
          age: 0, life: rnd(0.16, 0.30), r0: rnd(0.07, 0.12), r1: rnd(0.16, 0.28),
          alpha: rnd(0.6, 0.9), flame: true,
          tint: Math.random() < 0.5 ? '255,232,150' : '255,138,40', // white-yellow / orange
        });
      } else if (mode === 'mirage') {
        const out = rnd(0.8, 1.8) * (0.5 + load);
        exhaust.push({
          x: tip.x + rnd(-0.05, 0.05), y: tip.y + rnd(-0.05, 0.05),
          vx: cvx + dx * out + rnd(-0.4, 0.4), vy: cvy + dy * out - rnd(0.3, 0.8),
          age: 0, life: rnd(1.2, 2.0), r0: rnd(0.18, 0.30), r1: rnd(0.8, 1.35),
          alpha: 1, mirage: true, seed: Math.random() * 6.28,
          tint: sk.mirageTint || '150,200,255',
        });
        // MASTER: bright gold embers flickering out through the heat-haze (the
        // additive flame-puff path renders them; doesn't count toward the cap
        // beyond the loop's own length guard)
        if (sk.master && Math.random() < 0.6) {
          const eout = rnd(1.0, 2.2) * (0.5 + load);
          exhaust.push({
            x: tip.x + rnd(-0.05, 0.05), y: tip.y + rnd(-0.05, 0.05),
            vx: cvx + dx * eout + rnd(-0.5, 0.5), vy: cvy + dy * eout - rnd(0.2, 0.7),
            age: 0, life: rnd(0.3, 0.6), r0: rnd(0.03, 0.06), r1: rnd(0.10, 0.18),
            alpha: rnd(0.7, 1), flame: true,
            tint: Math.random() < 0.5 ? '255,240,180' : '255,205,90', // white-gold / amber
          });
        }
      } else { // smoke (tiers 0/1)
        const out = rnd(0.6, 1.6) * (0.5 + load);
        const tint = Math.round(150 - 70 * load); // richer/darker under load
        exhaust.push({
          x: tip.x + rnd(-0.05, 0.05), y: tip.y + rnd(-0.05, 0.05),
          vx: cvx + dx * out + rnd(-0.4, 0.4), vy: cvy + dy * out + rnd(-0.4, 0.4),
          age: 0, life: rnd(0.45, 0.7) + load * 0.4,
          r0: rnd(0.07, 0.12), r1: rnd(0.32, 0.5) + load * 0.25,
          alpha: rnd(0.35, 0.55), tint: `${tint},${tint},${tint + 6}`,
        });
      }
    }
  }

  function ageExhaust(dt) {
    for (const s of exhaust) {
      s.age += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy -= 1.1 * dt;          // hot smoke rises (screen up is -y)
      s.vx *= 1 - 1.6 * dt;      // air drag eases the puff to a drift
      s.vy *= 1 - 1.6 * dt;
    }
    if (exhaust.length) exhaust = exhaust.filter(s => s.age < s.life);
  }

  // ---------- kicked-up dirt ----------
  // A wheel throws dirt when it LOADS the ground — driving it under power, biting
  // it under brakes, slipping (a wheelspin or a spun-up wheel syncing on touchdown)
  // or SLAMMING down hard. It does NOT throw dirt merely by rolling over the ground:
  // a clean coast, freewheeling with no power on, kicks up nothing however fast it's
  // going (just like real life). Cosmetic only (never recorded, free to use
  // Math.random, never touches the sim), so replays stay deterministic. The sim
  // publishes inert per-wheel values: `grindSpeed` (bulk travel over the ground),
  // `grind` (slip), `grindImpact` (the normal slam) and the surface normal + throw
  // direction; the load comes from `bike.engineLoad` (smoothed throttle) and the
  // brake input. The spray amount tracks the physics: a sustained RATE from travel
  // SCALED BY how hard the tyre is loading the ground (plus any slip), and an instant
  // BURST on a hard landing. Colour comes from the theme's ground palette so a clod
  // looks like the track's own dirt.
  const DIRT_MIN = 0.6;   // ground-work speed (m/s) below which the tyre stays clean
                          // — work = loaded travel + slip, so an unloaded coast reads 0
  const DIRT_FULL = 16;   // ground-work speed for a full-strength spray (it saturates
                          // here so a flat-out roost doesn't run away)
  const DIRT_RATE = 55;   // sustained clods/sec per wheel at full strength
  const DIRT_BURST = 30;  // most clods one landing slam can throw at once
  const DIRT_BURST_K = 9; // how readily the slam (impulse) bursts into clods
  const DIRT_MAX = 240;   // hard cap so a long skid can't grow the array forever
  const DIRT_TICK_MAX = 6; // most grit-grain SFX to fire in one frame (a burst spawns
                           // up to 30 clods at once; only this many tick, spread out)

  function emitDirt(dt) {
    const pal = (patterns[level.theme] || patterns.meadow).dirt;
    if (!pal || !pal.length) return;
    const rnd = (a, b) => a + Math.random() * (b - a);
    // how hard the bike is loading the ground right now: the engine driving under
    // power (smoothed throttle, 0 when coasting) or the brake biting. Drive is the
    // REAR wheel's job; both wheels feel the brake. This is the "pressure on the
    // ground" gate — with it at 0 (a freewheeling coast), travel does no work.
    const drive = bike.engineLoad || 0;
    const braking = (simInput && simInput.brake && !bike.dead) ? 1 : 0;
    let ticks = 0; // grit-grain SFX fired this frame, shared across both wheels
    for (const w of bike.wheels) {
      if (!w.onGround) continue;
      const load = Math.max(w === bike.wheels[bike.rearIndex] ? drive : 0, braking);
      // ground work that throws grit: the tyre's bulk travel over the ground, but
      // only counted while it's LOADING the ground (travel * load), plus any outright
      // slip on top (a wheelspin or a spun-up wheel grinding as it lands). A clean
      // coast is travel with load 0 and ~no slip, so it does no work and stays quiet.
      const work = (w.grindSpeed || 0) * load + (w.grind || 0);
      const impact = w.grindImpact || 0;
      const force = Math.min(1, work / DIRT_FULL);
      let n = 0;
      // sustained spray, the rate set by the ground work...
      if (work >= DIRT_MIN) {
        dirtAcc += force * DIRT_RATE * dt;
        while (dirtAcc >= 1) { dirtAcc -= 1; n++; }
      }
      // ...plus a one-shot burst the frame a wheel slams down hard (the weight
      // behind it), strongest when it's also working the ground (a gassed landing).
      // Fires on any hard slam, even a dead-vertical drop onto flat ground.
      if (impact > 0.3) n += Math.round(Math.min(DIRT_BURST, impact * (0.4 + force) * DIRT_BURST_K));
      if (dirt.length + n > DIRT_MAX) n = DIRT_MAX - dirt.length;
      if (n <= 0) { if (dirt.length >= DIRT_MAX) dirtAcc = 0; continue; }
      // spawn at the contact patch: the bottom of the tyre along the support normal
      const cx = w.pos.x - (w.grindNX || 0) * PHYS.wheelR;
      const cy = w.pos.y - (w.grindNY || 0) * PHYS.wheelR;
      for (let i = 0; i < n; i++) {
        // fling along the throw direction (rooster tail), lofted up off the surface
        let ex = (w.grindTX || 0) + (w.grindNX || 0) * rnd(0.6, 1.4);
        let ey = (w.grindTY || 0) + (w.grindNY || 0) * rnd(0.6, 1.4);
        const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
        const ang = rnd(-0.6, 0.6), cs = Math.cos(ang), sn = Math.sin(ang);
        const dx = ex * cs - ey * sn, dy = ex * sn + ey * cs;
        // harder ground work flings grit faster and farther
        const sp = (0.5 + force) * rnd(2, 5) + work * 0.12;
        const c = pal[Math.floor(Math.random() * pal.length)];
        const sh = rnd(0.8, 1.15);   // per-clod brightness jitter
        const tint = Math.min(255, Math.round(c[0] * sh)) + ',' +
                     Math.min(255, Math.round(c[1] * sh)) + ',' +
                     Math.min(255, Math.round(c[2] * sh));
        const r = rnd(0.06, 0.15) * (0.7 + force);
        dirt.push({
          x: cx + rnd(-0.06, 0.06), y: cy + rnd(-0.06, 0.06),
          vx: bike.vel.x * 0.2 + dx * sp + rnd(-0.5, 0.5),
          vy: bike.vel.y * 0.2 + dy * sp + rnd(-0.5, 0.5),
          age: 0, life: rnd(0.4, 0.95), r,
          tint, alpha: rnd(0.75, 1),
        });
        // a tiny grit tick per clod, volume scaled by its size — capped per frame
        // and staggered a few ms apart so a burst patters instead of fusing to a click
        if (ticks < DIRT_TICK_MAX) { dirtTick(r, ticks * 0.005); ticks++; }
      }
    }
  }

  function ageDirt(dt) {
    // clods fall along the bike's gravity (down normally; follows a flip/wall
    // ride), at a fraction of g so light grit hangs a touch before settling
    const gx = PHYS.g * 0.6 * (bike.gravDir ? bike.gravDir.x : 0);
    const gy = PHYS.g * 0.6 * (bike.gravDir ? bike.gravDir.y : 1);
    for (const d of dirt) {
      d.age += dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vx += gx * dt;
      d.vy += gy * dt;
      d.vx *= 1 - 1.5 * dt;        // air drag eases the arc
      d.vy *= 1 - 1.5 * dt;
    }
    if (dirt.length) dirt = dirt.filter(d => d.age < d.life);
  }

  // ---------- landing air-puff ----------
  // A soft burst of dust bloomed from the contact patch the instant a wheel plants
  // after being airborne — air shoved out from under the tyre as it slams home. Fired
  // from the per-substep touchdown catch in simFrame (the same gate as the thud and
  // the squash pulse), so it only fires on a genuine air→ground landing, never while
  // rolling. Tiny plants are skipped (PUFF_MIN); everything above bursts dust scaled
  // to how hard it hit. Cosmetic only (never recorded, free to use Math.random), so
  // replays stay deterministic. `power` is the landing's 0..1 strength (see simFrame).
  const PUFF_MIN = 0.12;  // landing strength below which we skip the puff (soft plant)
  const PUFF_BURST = 5;   // extra puffs at full-power on top of the 2 a landing always gets
  const PUFF_MAX = 60;    // hard cap on live puffs

  function emitLandingPuff(w, power, nx, ny) {
    if (power < PUFF_MIN) return;          // a feather-soft plant raises no dust
    const rnd = (a, b) => a + Math.random() * (b - a);
    // contact patch: the bottom of the tyre along the support normal (points up off
    // the ground); fall back to the floor normal (-gravity) if no contact normal yet
    let sl = Math.hypot(nx, ny);
    if (sl < 1e-3) { nx = -bike.gravDir.x; ny = -bike.gravDir.y; sl = 1; }
    nx /= sl; ny /= sl;
    const cx = w.pos.x - nx * PHYS.wheelR;
    const cy = w.pos.y - ny * PHYS.wheelR;
    const tx = -ny, ty = nx;               // surface tangent (the puff bursts sideways)
    // pale, dusty tint pulled from the theme ground but washed toward white so it
    // reads as airborne dust rather than a solid clod
    const pal = (patterns[level.theme] || patterns.meadow).dirt;
    const base = (pal && pal.length) ? pal[Math.floor(Math.random() * pal.length)]
                                     : [150, 140, 120];
    const tint = Math.round(base[0] * 0.45 + 140) + ',' +
                 Math.round(base[1] * 0.45 + 140) + ',' +
                 Math.round(base[2] * 0.45 + 140);
    const count = 2 + Math.round(power * PUFF_BURST); // harder hit → fatter bloom
    for (let i = 0; i < count && puffs.length < PUFF_MAX; i++) {
      // burst out along the surface (alternating both ways) with a little lift, the
      // spread and size both growing with the impact
      const side = (i % 2 === 0) ? 1 : -1;
      const sp = (0.4 + power) * rnd(1.0, 2.6);
      const lift = rnd(0.2, 0.7);
      const ox = tx * side * rnd(0.5, 1) + nx * lift;
      const oy = ty * side * rnd(0.5, 1) + ny * lift;
      puffs.push({
        x: cx + rnd(-0.05, 0.05), y: cy + rnd(-0.05, 0.05),
        vx: bike.vel.x * 0.15 + ox * sp + rnd(-0.3, 0.3),
        vy: bike.vel.y * 0.15 + oy * sp + rnd(-0.3, 0.3),
        age: 0, life: rnd(0.3, 0.5) + power * 0.25,
        r0: rnd(0.07, 0.12) * (0.6 + power),
        r1: (rnd(0.30, 0.48) + power * 0.3) * (0.7 + power),
        alpha: rnd(0.22, 0.38) * (0.55 + 0.45 * power), // denser dust on a harder slam
        tint,
      });
    }
  }

  function agePuffs(dt) {
    // dust billows out off the impact, then air drag stalls it to a hanging cloud;
    // a faint settle along gravity, far lighter than the dirt clods (it's airborne)
    const gx = PHYS.g * 0.12 * (bike.gravDir ? bike.gravDir.x : 0);
    const gy = PHYS.g * 0.12 * (bike.gravDir ? bike.gravDir.y : 1);
    for (const p of puffs) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx += gx * dt;
      p.vy += gy * dt;
      p.vx *= 1 - 3.2 * dt;        // heavy drag: the burst spreads then hangs
      p.vy *= 1 - 3.2 * dt;
    }
    if (puffs.length) puffs = puffs.filter(p => p.age < p.life);
  }

  // One object radius for every pickup, matching Elasto Mania, where the apple,
  // killer and flower are all the same size. 0.4 = the Elma object radius (= the
  // wheel radius); a part touches an object when their circles overlap, i.e.
  // dist(partCentre, objCentre) < partR + OBJ_R. The nut mound (the killer) uses
  // the same value as PHYS.nutR — keep the three in sync. So a converted .lev
  // collects burgers, reaches the goal and dies on nuts at the same reach a
  // real apple/flower/spike had.
  const OBJ_R = 0.4;

  function checkPickups() {
    const h = bike.headPos();
    // Only the head and the two wheels can touch an object — the body/belly has
    // NO collider of any kind (matching the terrain model: see Bike.step). A
    // burger, defib or the goal is reached the instant a wheel or the head laps
    // it, never by the frame brushing past.
    const pts = [
      { p: h, r: PHYS.headR },
      { p: bike.wheels[0].pos, r: PHYS.wheelR },
      { p: bike.wheels[1].pos, r: PHYS.wheelR },
    ];
    for (const b of burgers) {
      if (b.got) continue;
      for (const o of pts) {
        if (Math.hypot(o.p.x - b.x, o.p.y - b.y) < o.r + OBJ_R) {
          b.got = true;
          blip(740, 0.09);
          setTimeout(() => blip(1180, 0.12), 70);
          // an upside-down burger reverses gravity as it's eaten; the swoop
          // sound follows the new pull. Deterministic (runs in the shared sim
          // frame), so replays flip at the same instant
          if (b.grav) { bike.gravDir = { x: b.grav.x, y: b.grav.y }; gravWhoomp(bike.gravDir.y < 0); }
          break;
        }
      }
    }
    // defibrillators: collected like a burger (same per-part reach), but instead
    // of counting toward the goal they shock the rider and bank a life
    for (let di = 0; di < defibs.length; di++) {
      const d = defibs[di];
      if (d.got) continue;
      for (const o of pts) {
        if (Math.hypot(o.p.x - d.x, o.p.y - d.y) < o.r + OBJ_R) {
          d.got = true;
          collectDefib(di);
          break;
        }
      }
    }
    if (burgers.every(b => b.got)) {
      for (const o of pts) {
        if (Math.hypot(o.p.x - level.goal[0], o.p.y - level.goal[1]) < o.r + OBJ_R) {
          finish();
          break;
        }
      }
    }
  }

  // a defibrillator was just grabbed: kick off the electrocution + "+1 LIFE"
  // toast and play the shock/one-up cues. The cosmetic FX fire on every run
  // (live, replay or test ride) so the jolt always reads, but the life itself is
  // only BANKED in a real run — a replay/test shows the spectacle and scores
  // nothing (lives is hidden on those screens anyway). Cosmetic-only state, so
  // it never desyncs a replay.
  function collectDefib(idx) {
    zaps.push({ age: 0 });
    lifePopups.push({ text: '+1 LIFE', age: 0 });
    defibShock();
    oneUp();
    if (state === 'playing') {
      lives++;
      lifeAnimT = 0; // (re)start the lives-row pop-in for the new head
      // bank it as consumed for the rest of the track: a respawn rebuilds
      // the defib list (reset) and this keeps it from re-floating
      consumedDefibs.add(levelIndex + ':' + idx);
    }
  }

  function finish() {
    if (state === 'replay') {
      // a watched run banks nothing: no best time, no checkpoint
      replayOutcome = 'finished';
      state = 'replayEnd';
      blip(660, 0.12);
      setTimeout(() => blip(880, 0.12), 130);
      setTimeout(() => blip(1320, 0.22), 260);
      return;
    }
    if (state === 'editorTest') {
      // a test ride proves the map, it banks nothing — but its tape can
      // still be saved off the end screen
      testOutcome = 'finished';
      state = 'editorTestEnd';
      saveNote = 'S: save replay';
      tapGuardUntil = performance.now() + 600;
      blip(660, 0.12);
      setTimeout(() => blip(880, 0.12), 130);
      setTimeout(() => blip(1320, 0.22), 260);
      return;
    }
    saveNote = 'S: save replay';
    tapGuardUntil = performance.now() + 600;
    // completing every 5th map of a track (1-5, 1-10, ...) banks a
    // checkpoint: a continue used later restarts from the NEXT map, so a
    // cleared checkpoint map never has to be re-beaten
    if (currentTrack && (levelIndex + 1) % 5 === 0) {
      checkpointIndex = Math.min(levelIndex + 1, currentTrack.files.length - 1);
    }
    const timeRecord = best === null || time < best;
    if (timeRecord) {
      best = time;
      localStorage.setItem(bestKey, String(best));
    }
    const styleRecord = stylePts > 0 && (styleBest === null || stylePts > styleBest);
    if (styleRecord) {
      styleBest = stylePts;
      localStorage.setItem(styleKey, String(styleBest));
    }
    if (currentTrack) {
      // log the run for the victory scorecard; the flags mark scores that
      // just became (and so now are) the all-time records
      runResults[levelIndex] = { time, style: stylePts, timeRecord, styleRecord };
    }
    if (currentTrack && !hasNextLevel()) {
      // the whole track is beaten: bank the cosmetic unlock (so the bike — and
      // the parked bike on the feast that's about to show — wears the upgraded
      // skin), then no finished screen: the frozen finish pose hangs a beat and
      // dissolves into the victory feast
      localStorage.setItem(CLEARED_KEY(currentTrack), '1');
      refreshBikeSkin();
      state = 'victoryFade';
      victoryT = 0;
      hoverIdx = -1;
    } else {
      state = 'finished';
    }
    blip(660, 0.12);
    setTimeout(() => blip(880, 0.12), 130);
    setTimeout(() => blip(1320, 0.22), 260);
  }

  function onDeath() {
    if (state === 'replay') {
      replayOutcome = 'crashed';
      state = 'replayEnd';
    } else if (state === 'editorTest') {
      testOutcome = 'crashed';
      state = 'editorTestEnd';
      saveNote = 'S: save replay';
      tapGuardUntil = performance.now() + 600;
    } else {
      state = 'dead';
      lives = Math.max(0, lives - 1);
      runPerfect = false; // a life lost — no perfect-clear feast this run
      saveNote = 'S: save replay';
      tapGuardUntil = performance.now() + 600;
    }
    const h = bike.headPos();
    headBody = {
      x: h.x, y: h.y,
      vx: bike.vel.x, vy: bike.vel.y - 1.5,
      rot: bike.angle, // tumbles as it rolls away
    };
    blip(95, 0.4);
  }

  // the detached helmet bounces around after a crash
  function stepHead(dt) {
    if (!headBody) return;
    headBody.vx += PHYS.g * bike.gravDir.x * dt;
    headBody.vy += PHYS.g * bike.gravDir.y * dt;
    headBody.x += headBody.vx * dt;
    headBody.y += headBody.vy * dt;
    headBody.rot += (headBody.vx / PHYS.headR) * 0.5 * dt;
    for (const s of level.segments) {
      const cp = closestOnSeg(headBody.x, headBody.y, s);
      let nx = headBody.x - cp.x, ny = headBody.y - cp.y;
      const d = Math.hypot(nx, ny);
      if (d < PHYS.headR && d > 0) {
        nx /= d; ny /= d;
        headBody.x = cp.x + nx * PHYS.headR;
        headBody.y = cp.y + ny * PHYS.headR;
        const vn = headBody.vx * nx + headBody.vy * ny;
        if (vn < 0) {
          headBody.vx -= nx * vn * 1.5;
          headBody.vy -= ny * vn * 1.5;
          headBody.vx *= 0.95;
          headBody.vy *= 0.95;
        }
      }
    }
  }

  function updateCamera(dt) {
    // ease the look-ahead toward the current facing so a flip pans the
    // view across rather than snapping it
    camLead += (bike.facing * CAM_LEAD - camLead) * Math.min(1, 3 * dt);
    // the lead rides the bike's FORWARD direction, which turns with gravity:
    // forward (facing right) is perpendicular to the gravity pull, {g.y,-g.x}.
    // default down {0,1} -> {1,0} (lead ahead horizontally); reversed gravity
    // up {0,-1} -> {-1,0}; side gravity left/right -> {0,±1} (lead vertically,
    // above/below the rider) instead of always shoving the view sideways.
    const g = bike.gravDir || { x: 0, y: 1 };
    const fx = g.y, fy = -g.x;
    // the view is ~26x13.5, so on a wide screen height is the SHORT axis: a
    // full horizontal-sized lead is a small slice sideways but a big chunk
    // vertically, overshooting under side gravity. Scale the vertical share of
    // the lead by the viewport aspect (hh/hw reduces to H/W) so it never shoves
    // the rider off the short edge; 1 on square/tall screens, <1 on wide ones.
    const vScale = W > 0 ? Math.min(1, H / W) : 1;
    const tx = bike.pos.x + camLead * fx + bike.vel.x * 0.12;
    const ty = bike.pos.y + camLead * fy * vScale + bike.vel.y * 0.12 - 0.6;
    const k = Math.min(1, 6 * dt);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
  }

  // ---------- main loop ----------
  const FDT = 1 / 60, SUB = 8;
  let last = performance.now(), acc = 0;

  // one 60 Hz sim frame, shared by live play and replay playback: applies
  // a queued turn-around, substeps the physics, then settles the outcome
  function simFrame(input, doFlip) {
    const wasAir = bikeAirborne();
    if (doFlip) {
      bike.flip();
      whoosh(0.14, 950, 0.22);
      if (wasAir) awardStyle(STYLE_FLIP);
    }
    simInput = input;
    const angle0 = bike.angle;
    const voltPumps0 = bike.voltPumps;
    // wheel touchdowns are caught per substep, not per frame: a hard landing
    // rebounds within a single 60 Hz frame (airborne → planted → airborne), so
    // a frame-boundary check would miss exactly the biggest hits. Track each
    // wheel's contact across substeps and thud the instant it plants, scaled by
    // how fast it was dropping in (speed along gravity, so a flipped bike reads
    // its ceiling as the floor); the WHEEL_HIT_MIN gate keeps rolling chatter
    // and feather-soft plants silent
    const wasGround = bike.wheels.map(w => w.onGround);
    let frameSusp = 0;
    for (let i = 0; i < SUB; i++) {
      const drop = bike.wheels.map(w => w.vel.x * bike.gravDir.x + w.vel.y * bike.gravDir.y);
      bike.step(FDT / SUB, input, level.segments, level.nuts);
      bike.wheels.forEach((w, k) => {
        if (!wasGround[k] && w.onGround && drop[k] > WHEEL_HIT_MIN) {
          const power = Math.min(1, (drop[k] - WHEEL_HIT_MIN) / WHEEL_HIT_SPAN);
          wheelHit(power);
          // same gate as the thud sound: punch a squash pulse into the tyre
          w.sqImpact = Math.max(w.sqImpact || 0, power * SQ_IMPACT_GAIN);
          // and bloom a puff of dust from the contact patch, scaled to the slam
          // (the freshly-resolved contact normal points up off the ground)
          emitLandingPuff(w, power, w.grindNX || w.contactNX || 0,
                                    w.grindNY || w.contactNY || 0);
        }
        wasGround[k] = w.onGround;
      });
      frameSusp = Math.max(frameSusp, suspLoad()); // peak compression this frame
      if (bike.dead) break;
    }
    // peak-hold the suspension load then bleed it off, so a hard compression
    // cranks the sound up at once and rings down, while a sustained press holds
    suspLevel = Math.max(frameSusp, suspLevel * SUSP_RELEASE);
    if (bike.dead) {
      onDeath();
    } else {
      time += FDT;
      // bursty volt: thump once per PUMP — bike.voltPumps ticks up each time a new
      // pump fires (at most one per 60 Hz frame, since voltCadence >> a frame), so
      // holding gives a rhythmic pump-pump-pump. The arm punch it animates is driven
      // off bike.voltReach over in render.js
      if (bike.voltPumps > voltPumps0) voltThump();
      // net rotation, airborne or not (a ground loop-the-loop is style
      // too): every full lap pays out, wobble cancels itself
      spinAcc += bike.angle - angle0;
      if (Math.abs(spinAcc) >= Math.PI * 2) {
        spinAcc -= Math.sign(spinAcc) * Math.PI * 2;
        awardStyle(STYLE_SPIN);
      }
      // balance tricks trickle style for every STYLE_TRICK_EVERY they're
      // held: a wheelie (rear planted, front lifted) pays a little, a stoppie
      // (front planted, rear lifted) is far harder to hold so it pays a lot.
      // each clock keeps awarding while its pose lasts and zeroes the instant
      // it breaks, so only sustained, unbroken balance scores. "planted" is
      // lenient (see wheelPlanted) so terrain chatter doesn't break the hold
      const rearDown = wheelPlanted(bike.wheels[bike.rearIndex]);
      const frontDown = wheelPlanted(bike.wheels[1 - bike.rearIndex]);
      if (rearDown && !frontDown) {
        wheelieT += FDT;
        if (wheelieT >= STYLE_TRICK_EVERY) {
          wheelieT -= STYLE_TRICK_EVERY;
          const pts = Math.round(STYLE_WHEELIE * trickSpeedScale());
          if (pts > 0) awardStyle(pts); // a crawling wheelie scores nothing
        }
      } else {
        wheelieT = 0;
      }
      if (frontDown && !rearDown) {
        stoppieT += FDT;
        if (stoppieT >= STYLE_TRICK_EVERY) {
          stoppieT -= STYLE_TRICK_EVERY;
          const pts = Math.round(STYLE_STOPPIE * trickSpeedScale());
          if (pts > 0) awardStyle(pts);
        }
      } else {
        stoppieT = 0;
      }
      checkPickups();
    }
    // cosmetic engine load + exhaust smoke (after the sim, alive or not, so the
    // tailpipe keeps puffing as the load bleeds off on a crash)
    updateEngineLoad(input);
    updateRiderJostle(FDT);
    updateWheelSquash(FDT);
    emitExhaust(FDT);
    emitDirt(FDT);
  }

  function frame(now) {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= FDT) {
      acc -= FDT;
      if (state === 'intro') {
        introT += FDT;
        introSounds();
        if (introT >= TITLE_ANIM.dur) { state = 'menu'; menuT = 0; }
      } else if (state === 'menu') {
        introT += FDT; // keeps the settled title bobbing
        menuT += FDT;
      } else if (state === 'difficulty') {
        diffT += FDT;
      } else if (state === 'records') {
        recT += FDT;
      } else if (state === 'equipment') {
        equipT += FDT;
      } else if (state === 'continue') {
        contT += FDT;
      } else if (state === 'replays') {
        repT += FDT;
      } else if (state === 'skip') {
        skipT += FDT;
      } else if (state === 'audio') {
        audioT += FDT;
      } else if (state === 'victoryFade' || state === 'victory') {
        victoryT += FDT;
        if (state === 'victoryFade' && victoryAlpha() >= 1) {
          state = 'victory';
          hoverIdx = -1;
        }
      } else if (state === 'playing' || state === 'editorTest') {
        // keyboard and the on-screen touch cluster merge into one mask;
        // the tape gets one mask per frame: exactly what the sim consumes
        const up = keys.up || TOUCH.input.up;
        const down = keys.down || TOUCH.input.down;
        const left = keys.left || TOUCH.input.left;
        const right = keys.right || TOUCH.input.right;
        REPLAY.record(
          (up ? 1 : 0) | (down ? 2 : 0) |
          (left ? 4 : 0) | (right ? 8 : 0), flipQueued);
        simFrame({ throttle: up, brake: down, left, right }, flipQueued);
      } else if (state === 'replay') {
        let f = { mask: 0, flip: false };
        if (replayCursor && !replayCursor.done()) f = replayCursor.next();
        simFrame({
          throttle: !!(f.mask & 1), brake: !!(f.mask & 2),
          left: !!(f.mask & 4), right: !!(f.mask & 8),
        }, f.flip);
        // tape exhausted without the recorded ending: the sim has drifted
        // off it (the game changed since the save) — stop here
        if (state === 'replay' && (!replayCursor || replayCursor.done())) {
          state = 'replayEnd';
        }
      } else if (state === 'dead' || state === 'replayEnd' ||
                 state === 'editorTestEnd') {
        for (let i = 0; i < SUB; i++) stepHead(FDT / SUB);
      }
      flipQueued = false;
      // the bike has stopped being simmed in these aftermath states, so keep
      // bleeding the suspension crank down here (simFrame normally does it) —
      // that's what lets a fatal-hit crank ring out rather than freeze on
      if (state === 'dead' || state === 'replayEnd' ||
          state === 'editorTestEnd' || state === 'finished') {
        suspLevel *= SUSP_RELEASE;
      }
      // victoryFade stays in this list: the frozen finish frame under the
      // dissolve keeps its settling camera and rising toasts
      if (state !== 'loading' && state !== 'intro' && state !== 'menu' &&
          state !== 'difficulty' && state !== 'continue' && state !== 'replays' &&
          state !== 'audio' && state !== 'skip' && state !== 'editor' &&
          state !== 'records' && state !== 'victory') {
        updateCamera(FDT);
        // toasts keep rising over the crash/finish screens, but a pause
        // freezes them along with everything else; the smoke drifts on too
        if (state !== 'paused') { agePopups(FDT); ageExhaust(FDT); ageDirt(FDT); agePuffs(FDT); }
      }
    }
    updateHover();
    checkPacerShot();
    draw();
    TOUCH.draw(ctx, W, H, { state, saveBusy });
    updateEngineSound();
    updateSuspensionSound();
    updateMusic();
    requestAnimationFrame(frame);
  }

  // the brief overlay shown while a map is fetched on the way into it. Maps are
  // tiny, so on a warm connection this barely flashes; it earns its keep on a
  // cold first visit or a slow link.
  function drawLevelLoading(rt) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1a0f06';
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, r = Math.max(14, Math.min(W, H) * 0.06);
    ctx.save();
    ctx.translate(cx, cy - r * 0.4);
    ctx.rotate((rt * 3.2) % (Math.PI * 2));
    ctx.strokeStyle = '#f9c623';
    ctx.lineWidth = Math.max(3, r * 0.18);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 1.45);
    ctx.stroke();
    ctx.restore();
    const label = 'Loading course…';
    ctx.fillStyle = '#f0e8da';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + Math.round(Math.max(16, Math.min(W, H) * 0.045)) + 'px ' +
      '"Consolas","Courier New",monospace';
    ctx.fillText(label, cx, cy + r * 1.6);
  }

  function draw() {
    const rt = performance.now() / 1000;
    // menu-world time: zero at the moment the loading overlay is dismissed,
    // so the backdrop's clouds/burgers/astronaut begin their cycles fresh
    // (and the astro gag's 30s delay is measured from the player tapping in).
    const mt = menuClock0 >= 0 ? rt - menuClock0 : 0;
    // The title screen and every sub-screen reached from it (difficulty,
    // records, replays, menu audio) are one continuous scene, so they share
    // the same furniture: the drifting meadow world, the rising-astronaut gag,
    // and the engine build stamp all persist. Only the "BURGER MANIA" title
    // is exclusive to the top menu — stepping into a sub-screen never blanks
    // the rest of the scene out from under the player mid-animation.
    function menuScene(withTag = true) {
      drawMenuBackdrop(ctx, W, H, mt, patterns.meadow, true);
      // the main menu's wide grid reaches the bottom-left corner, so there it
      // redraws the stamp on top instead (see below); other screens are clear.
      // The dev Skip chip rides with the stamp — visible wherever the version
      // label is, not just on the top menu.
      if (withTag) {
        drawCornerTag(ctx, W, H, 'v' + REPLAY.VERSION);
        if (devSkip) drawSkipChip(ctx, W, H, 1, skipHover);
      }
    }
    if (state === 'loading') {
      drawLoading(ctx, W, H, loadFrac, rt, loadDone, TOUCH.active);
      return;
    }
    if (state === 'levelLoading') {
      drawLevelLoading(rt);
      return;
    }
    if (state === 'levelLoadError') {
      drawLevelLoadError(ctx, W, H, errSel, hoverIdx);
      return;
    }
    if (state === 'intro' || state === 'menu') {
      menuScene(state !== 'menu'); // the menu draws its stamp on top of the grid
      drawTitleLetters(ctx, W, H, introT);
      if (state === 'menu') {
        drawMainMenu(ctx, W, H, Math.min(1, menuT / 0.6), menuItems, menuSel, hoverIdx,
          { show: devSkip, hot: skipHover });
        // keep the build stamp + dev Skip chip above the wide grid, never buried
        drawCornerTag(ctx, W, H, 'v' + REPLAY.VERSION);
      }
      return;
    }
    if (state === 'difficulty') {
      menuScene();
      drawDifficulty(ctx, W, H, Math.min(1, diffT / 0.4), visibleTracks(), diffSel, hoverIdx,
        TOUCH.active, undefined, backHover);
      return;
    }
    if (state === 'records') {
      menuScene();
      drawRecords(ctx, W, H, Math.min(1, recT / 0.4), {
        label: recTrack ? recTrack.label : '',
        color: recTrack ? recTrack.color : '',
        names: recNames, results: recResults, hover: hoverIdx,
        canPrev: recCanCycle(-1), canNext: recCanCycle(1),
        touch: TOUCH.active, backHot: backHover,
      });
      return;
    }
    if (state === 'equipment') {
      menuScene();
      const slot = EQUIP_SLOTS[equipSlot];
      const worn = currentEquipped(slot.id);
      const slots = EQUIP_SLOTS.map((s, i) => ({
        label: s.label, equipped: equippedName(s.id), selected: i === equipSlot,
      }));
      const items = currentSlotItems().map(it => ({
        name: it.name, tier: it.tier, desc: it.desc,
        owned: equipUnlocked(it),
        equipped: it.id === worn,
        requirement: equipUnlocked(it) ? '' : equipRequirement(it),
      }));
      // the preview wears the current loadout; while browsing Skins it
      // live-previews the highlighted owned skin
      let previewTier = bikeSkinTier();
      if (slot.id === 'skin' && items[equipSel] && items[equipSel].owned) {
        previewTier = items[equipSel].tier;
      }
      drawEquipment(ctx, W, H, Math.min(1, equipT / 0.4), {
        slots, slotLabel: slot.label, slotBlurb: slot.blurb, slotKind: slot.kind,
        items, sel: equipSel, hover: hoverIdx, focus: equipFocus,
        previewTier, t: rt, touch: TOUCH.active, backHot: backHover,
      });
      return;
    }
    if (state === 'continue') {
      // the rider slumps in the world he just lost in (the checkpoint
      // map a continue would restart shares the same world)
      drawMenuBackdrop(ctx, W, H, mt, patterns[level.theme] || patterns.meadow);
      drawContinue(ctx, W, H, Math.min(1, contT / 0.4), rt, continues, contSel, hoverIdx);
      return;
    }
    if (state === 'replays') {
      menuScene();
      drawReplays(ctx, W, H, Math.min(1, repT / 0.4),
        repItems, repSel, repScroll, hoverIdx, repNote, TOUCH.active, backHover);
      return;
    }
    if (state === 'audio' && audioFrom !== 'paused') {
      menuScene();
      drawAudio(ctx, W, H, Math.min(1, audioT / 0.4),
        { volume, sel: audioSel, hover: hoverIdx, dim: false, muted,
          touch: TOUCH.active, backHot: backHover });
      return;
    }
    // the skip picker summoned from a menu gets its own backdrop; summoned
    // mid-game it falls through to float over the frozen level instead
    if (state === 'skip' && !skipOverGame()) {
      drawMenuBackdrop(ctx, W, H, mt, patterns[level.theme] || patterns.meadow);
      drawLevelSelect(ctx, W, H, Math.min(1, skipT / 0.4), {
        items: skipItems, sel: skipSel, scroll: skipScroll, hover: hoverIdx,
        label: skipTrack ? skipTrack.label : '', touch: TOUCH.active,
      });
      return;
    }
    // audio opened from the pause menu falls through: the frozen level
    // stays visible behind it, just like the pause screen itself

    if (state === 'editor') {
      EDITOR.draw(ctx, W, H, patterns, rt);
      return;
    }

    // the feast owns the whole screen; victoryFade instead falls through,
    // so the frozen finish frame can sit under the dissolve
    if (state === 'victory') {
      drawVictory(ctx, W, H, victoryView(rt));
      return;
    }

    const theme = patterns[level.theme] || patterns.meadow;
    const Z = Math.min(W / 26, H / 13.5);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(Z, Z);
    ctx.translate(-cam.x, -cam.y);
    const hw = W / 2 / Z + 1, hh = H / 2 / Z + 1;
    const worldView = { x0: cam.x - hw, y0: cam.y - hh, x1: cam.x + hw, y1: cam.y + hh };
    drawWorld(ctx, level, theme, worldView, rt, bike);
    // back-layer doodads sit in the scene behind every actor; front-layer ones
    // (below) ride over the rider so he passes behind the prop
    drawDoodadLayer(ctx, level.doodads, 'back', rt);
    if (level.nuts) for (const n of level.nuts) drawNutMound(ctx, n[0], n[1], rt);
    for (const b of burgers) if (!b.got) drawBurger(ctx, b.x, b.y, rt);
    for (const d of defibs) if (!d.got) drawDefib(ctx, d.x, d.y, rt);
    drawPopcorn(ctx, level.goal[0], level.goal[1], rt);
    // exhaust behind the bike so it trails off the pipe. The tier-3 plasma
    // mirage re-stamps the canvas to distort the background, so it needs the
    // EXACT visible world rect (no padding) that maps the canvas onto itself 1:1
    const exhaustView = { x: cam.x - W / 2 / Z, y: cam.y - H / 2 / Z, w: W / Z, h: H / Z };
    drawExhaust(ctx, exhaust, exhaustView);
    drawPuffs(ctx, puffs);   // landing dust, behind the flung clods
    drawDirt(ctx, dirt);
    drawBike(ctx, bike, !!headBody, false, theme.dark, rt);
    if (headBody) drawHead(ctx, headBody.x, headBody.y, bike.facing, headBody.rot);
    // the defibrillator shock crackles over the rider (lightning + x-ray bones),
    // one per live zap; drawn here so it sits on the bike, under any front props
    for (const z of zaps) drawElectrocution(ctx, bike, z.age, rt);
    drawDoodadLayer(ctx, level.doodads, 'front', rt);
    // foreground terrain: front-layer polygons over the rider AND the doodads,
    // so he disappears behind them (see drawForeground)
    drawForeground(ctx, level, theme, worldView, rt);
    // dark worlds (cave): the rider's screen position before we drop the world
    // transform, for the darkness pass below
    const lightX = W / 2 + (bike.pos.x - cam.x) * Z;
    const lightY = H / 2 + (bike.pos.y - cam.y) * Z;
    ctx.restore();

    // black out the playfield except the rider's headlight and taillight cones
    // (screen space, over the world but under the HUD). Only while playing —
    // the editor's design canvas returns long before this, so editing stays lit.
    if (theme.dark) {
      drawCaveDarkness(ctx, W, H, {
        x: lightX, y: lightY, dir: bike.facing, ang: bike.angle, Z, t: rt,
      });
    }

    // floating "+N" awards ride above the biker in world coordinates but
    // are lettered in screen space so the text stays crisp
    for (const p of stylePopups) {
      const wx = bike.pos.x + p.dx;
      const wy = bike.pos.y - 1.5 - p.age * 1.1;
      drawStylePopup(ctx, W / 2 + (wx - cam.x) * Z, H / 2 + (wy - cam.y) * Z,
        p.text, p.age, Z);
    }
    // the "+1 LIFE" toast rises higher and centred over the rider, in its own
    // electric style so it never blends into the yellow style points
    for (const p of lifePopups) {
      const wx = bike.pos.x;
      const wy = bike.pos.y - 2.0 - p.age * 0.9;
      drawLifePopup(ctx, W / 2 + (wx - cam.x) * Z, H / 2 + (wy - cam.y) * Z,
        p.text, p.age, Z);
    }

    const watching = state === 'replay' || state === 'replayEnd';
    const testing = state === 'editorTest' || state === 'editorTestEnd';
    // H hides every riding UI frame — minimap, metrics, mph, level label — for
    // a clean view; menus/banners drawn after this still show as normal
    if (!hudHidden) {
      drawMinimap(ctx, W, H, level, {
        pos: bike.pos,
        burgers,
        defibs,
        goal: level.goal,
        nuts: level.nuts,
        t: rt,
        theme,
      });

      drawHUD(ctx, W, H, {
        time,
        t: rt,
        theme,
        got: burgers.filter(b => b.got).length,
        total: burgers.length,
        best,
        style: stylePts,
        styleBest,
        state,
        speed: bike && bike.vel ? Math.hypot(bike.vel.x, bike.vel.y) : 0,
        lives: watching || testing ? null : lives,
        // a freshly-banked life zaps into the row: 0..1 entrance progress, ≥1 once settled
        lifeAnim: lifeAnimT < LIFE_HEAD_POP ? lifeAnimT / LIFE_HEAD_POP : 1,
        hasNext: hasNextLevel(),
        mapLabel: testing ? level.name : mapLabel(),
        replay: watching ? {
          label: (replayData && replayData.label) || level.name,
          done: state === 'replayEnd',
          outcome: replayOutcome,
        } : null,
        test: testing ? {
          done: state === 'editorTestEnd',
          outcome: testOutcome,
        } : null,
        // the keyboard hint is redundant next to the touch save button;
        // save status messages still show either way
        saveNote: TOUCH.active && saveNote === 'S: save replay' ? '' : saveNote,
        touch: TOUCH.active,
      });
    }

    if (state === 'paused') {
      drawPause(ctx, W, H, pauseItems, pauseSel, hoverIdx);
    }
    if (state === 'audio') {
      drawAudio(ctx, W, H, Math.min(1, audioT / 0.4),
        { volume, sel: audioSel, hover: hoverIdx, dim: true, muted,
          touch: TOUCH.active, backHot: backHover });
    }
    if (state === 'skip') {
      drawLevelSelect(ctx, W, H, Math.min(1, skipT / 0.4), {
        items: skipItems, sel: skipSel, scroll: skipScroll, hover: hoverIdx,
        label: skipTrack ? skipTrack.label : '', touch: TOUCH.active,
      });
    }
    if (state === 'victoryFade') {
      drawVictoryFade(ctx, W, H, victoryAlpha(), victoryView(rt));
    }
  }

  requestAnimationFrame(frame);
})();
