'use strict';

// Replay recording, (de)serialization, and the file-system plumbing for
// saving and browsing replays. A replay is the per-frame input stream of
// one run: the physics is deterministic (fixed 60 Hz step, no randomness),
// so feeding the recorded inputs back through the same sim reproduces the
// run exactly. The raw level data rides along in the file, so a replay
// stays faithful even if the level is later retuned.
//
// But a replay is only the INPUTS, not the trajectory, so any change to the
// sim (physics constants, step logic, or a new input bit) desyncs every tape
// saved before it: the recorded inputs replay against the new physics and the
// rider drifts off course. Those replays are useless, so VERSION is bumped on
// any such change and parse() rejects the older files outright — a clean "from
// an older version" failure instead of a silent, wrong-looking playback.
const REPLAY = (() => {
  const FORMAT = 'burger-mania-replay';
  const VERSION = 11; // bumped 2026-06-17: tire + volt + suspension feel passes (all
                     // batched into the still-undeployed v11, so no new version number).
                     // Suspension: softened (springK 23->20->18) then STIFFENED back up
                     // (->24) for more recoil, and the recoil retuned (springC 3.3->4.0->5
                     // ->3.2) — first slowed to a dead overdamped creep, then eased back
                     // under critical. With springC held at 3.2, stiffening to 24 drops the
                     // damping ratio ~0.80->0.70, so it bounces more and firmer (and bottoms
                     // out less). Gravity raised (g 2.7->3.0) for a heavier, more planted feel.
                     // Wheel-inertia pass: the driven wheel was lightened (wheelI
                     // 0.018->0.012) so a free-spinning (gas-off) wheel no longer dumps a
                     // big forward lurch when it lands — its stored angular momentum, and
                     // thus the landing kick, is ∝ wheelI. brakeRate 60->90 holds braking
                     // (force ∝ wheelI*brakeRate); engineT stays 1.1 (ground accel barely
                     // moves). Side effect: the in-air gas pump spins up ~1.5x quicker.
                     // Tire + volt pass: tires are squishier
                     // in a pinch and now squeeze FURTHER the more momentum the biker
                     // carries (wheelSquish 0.08->0.12, new momentum-scaled wheelSquish
                     // Max/V) — and the squish actually works now: it softens the
                     // squeezed-against wall (gravity-aware, floor keeps grip) so the
                     // contact forces don't grip the tire to a halt. Base grip raised
                     // (mu 1.1->1.25) and the driven-wheel landing slip softened
                     // (gripGasResist 0.5->0.75) so a rear-wheel touchdown under gas
                     // hooks up instead of skating like ice. The airborne volt was
                     // over-rotating: fixed at the ROOT — frame rotational inertia was
                     // too low (frameI 0.55->1.5, voltAcc 14.5->17.3 to re-match the
                     // grounded lean), NOT an air/ground branch. Grounded volt/wheelie/
                     // stoppie are gravity+contact balances so they're inertia-robust
                     // and stay the same; the free-air flick (purely inertia-driven)
                     // calms ~38%. These change the contact/rotation forces, so pre-v11
                     // tapes desync — rejected cleanly.
                     // Prior, v10 (2026-06-16): physics feel pass (emergent cleanup).
                     // Rolling resistance: the constant at-rest term was the "sticky
                     // at rest" culprit (a rigid wheel has no true rolling resistance)
                     // — removed (rollRes 9->0->gone), leaving only a gentle speed-
                     // proportional bleed; the bike now rolls free / carries momentum
                     // like Elma. That constant drag was also quietly propping up the
                     // brakes, so brakeRate was raised 30->60 to put the stopping
                     // power at its real source — the spin-bleed (brakeGrip is a
                     // non-binding Coulomb ceiling, no effect). The artificial angular
                     // damper avelDamp was likewise removed: rotation now conserves
                     // angular momentum, and the alovolt's air-spin ceiling is bounded
                     // emergently by air drag, not the damper. Air drag eased
                     // 0.03->0.022 (higher ceiling / more carried speed) with gravity
                     // nudged 2.5->2.7 to keep jumps and bounces planted. The spin-
                     // fling sling was turned off (spinExtMax 0.28->0) so a standstill
                     // alovolt no longer pogo-somersaults on flat ground — it plants
                     // the head and dies, as it should. The normal volt pump was also
                     // softened (voltAcc 21->14.5) and slowed (voltCadence 0.66->0.8,
                     // voltBurstDur 0.125->0.152 to hold the average), and the alovolt
                     // eased (alovoltAcc 7->4). The tuned maps top out below dragV0 so
                     // their ballistics are untouched,
                     // but the new gravity/spin/brake forces desync the integration,
                     // so pre-v10 tapes drift.
                     // v9 (2026-06-16): alovolt now obeys the volt cadence — it can
                     // only ENGAGE when ready and RELEASING it spends a cooldown (no
                     // more sneaking a supervolt in mid-cooldown); alovoltAcc 8.0->7.0.
                     // so the both-keys spin tops out a touch lower. A different
                     // air-righting torque desyncs the integration, so every pre-v8
                     // tape drifts.
                     // v7 (2026-06-16): physics feel pass — gravity 2.8->2.5,
                     // suspension damping springC 2.8->4.0 (less recoil), and the
                     // normal volt re-tuned (voltAcc 17->21, voltBurstDur 0.133->
                     // 0.125, voltCadence 0.6->0.66). Different gravity/spring/volt
                     // forces desync the integration, so every pre-v7 tape drifts.
                     // v6 (2026-06-16): pickup radii unified to the Elma object
                     // size (0.4) — the nut mound's kill radius (PHYS.nutR) shrank
                     // 0.45->0.4 and the goal's reach 0.5->0.4, so a tape that
                     // grazed a nut or clipped the goal now ends at a different
                     // instant. Desyncs every pre-v6 tape.
                     // v5 (2026-06-15, Elasto-fidelity pass phase 1): volting
                     // reworked from a discrete ~1/sec throttle to a CONTINUOUS
                     // hold-to-rotate drive + alovolt (both keys), with ground and
                     // air rotation unified (avelDamp and the wheel-spring reaction
                     // torque now apply in the air too). (Subsumed the unbumped v4
                     // crash-model work.)
  const EXT = '.bmr';
  const PICKER_TYPES = [{
    description: 'Burger Mania replay',
    accept: { 'application/json': [EXT] },
  }];

  // ---------- recording ----------
  // input masks: 1 gas, 2 brake, 4 left, 8 right. Turn-arounds are stored
  // apart as the frame numbers they fired on (one-shot events, not holds)
  let cur = null;

  function begin() {
    cur = { pairs: [], flips: [], frames: 0 };
  }

  // appends one 60 Hz frame; the mask stream is run-length encoded as
  // flat [mask, count, mask, count, ...] pairs
  function record(mask, flip) {
    if (!cur) return;
    if (flip) cur.flips.push(cur.frames);
    const p = cur.pairs;
    if (p.length && p[p.length - 2] === mask) p[p.length - 1]++;
    else p.push(mask, 1);
    cur.frames++;
  }

  function hasRun() { return !!cur && cur.frames > 0; }

  function serialize(meta) {
    // the level's cache fields (_bounds etc.) are render-side clutter
    const level = JSON.parse(JSON.stringify(meta.level,
      (k, v) => (k && k[0] === '_' ? undefined : v)));
    return JSON.stringify({
      format: FORMAT,
      version: VERSION,
      savedAt: new Date().toISOString(),
      label: meta.label,
      outcome: meta.outcome,
      time: meta.time,
      style: Number.isFinite(meta.style) ? meta.style : null,
      // the bike skin (cosmetic upgrade tier) worn during the run, so playback
      // reproduces the look the run was recorded with rather than the viewer's
      // own earned skin. Purely cosmetic — it never feeds the sim, so it rides
      // along without a VERSION bump and pre-skin tapes simply omit it.
      skin: Number.isFinite(meta.skin) ? meta.skin : null,
      trackId: meta.trackId || null,
      levelIndex: meta.levelIndex,
      level,
      frames: cur.frames,
      inputs: cur.pairs,
      flips: cur.flips,
    });
  }

  // ---------- loading ----------
  function isPt(p) {
    return Array.isArray(p) && p.length >= 2 &&
      isFinite(p[0]) && isFinite(p[1]);
  }

  // validates enough that playback can't blow up mid-run
  function parse(text) {
    const d = JSON.parse(text);
    if (d.format !== FORMAT) throw new Error('not a Burger Mania replay');
    if (d.version !== VERSION) {
      // a version mismatch means the sim has changed since the save, so the
      // tape can't reproduce its run. Flag it so the folder browser can tell
      // these apart from genuinely corrupt files and explain why they're gone
      const e = new Error(d.version < VERSION
        ? 'this replay is from an older version of Burger Mania'
        : 'this replay is from a newer version of Burger Mania');
      e.versionMismatch = true;
      throw e;
    }
    const L = d.level;
    if (!L || !Array.isArray(L.polygons) || !L.polygons.length ||
        !L.polygons.every(p => Array.isArray(p) && p.length >= 3 && p.every(isPt)) ||
        !L.start || !isFinite(L.start.x) || !isFinite(L.start.y) ||
        !Array.isArray(L.burgers) || !L.burgers.every(isPt) ||
        !isPt(L.goal) ||
        // nut mounds are optional; if present they must be valid points, since
        // the sim reads them straight back as kill positions during playback
        (L.nuts != null && (!Array.isArray(L.nuts) || !L.nuts.every(isPt))) ||
        // upside-down (gravity-flip) burgers are optional too, same shape
        (L.flipBurgers != null && (!Array.isArray(L.flipBurgers) || !L.flipBurgers.every(isPt)))) {
      throw new Error('replay level data is damaged');
    }
    if (typeof L.name !== 'string') L.name = 'Mystery Map';
    if (!Array.isArray(d.inputs) || d.inputs.length % 2 !== 0 ||
        !d.inputs.every(n => Number.isInteger(n) && n >= 0)) {
      throw new Error('replay input stream is damaged');
    }
    let total = 0;
    for (let i = 0; i < d.inputs.length; i += 2) {
      if (d.inputs[i] > 15 || d.inputs[i + 1] < 1) {
        throw new Error('replay input stream is damaged');
      }
      total += d.inputs[i + 1];
    }
    if (total !== d.frames) throw new Error('replay frame count mismatch');
    if (!Array.isArray(d.flips)) d.flips = [];
    // style points arrived after the format shipped: older files (and
    // hand-damaged values) read as null, which the UI shows as N/A
    if (!Number.isFinite(d.style)) d.style = null;
    // the bike skin tier likewise post-dates the format: pre-skin tapes (and
    // damaged values) read as null, which playback treats as "use the viewer's
    // own earned skin" (the old behaviour); a recorded tier overrides it
    if (!Number.isFinite(d.skin)) d.skin = null;
    return d;
  }

  // sequential reader over the RLE input stream: next() returns the mask
  // and whether a turn-around fired, one 60 Hz frame at a time
  function cursor(d) {
    let pi = 0, used = 0, fi = 0, frame = 0;
    return {
      done() { return frame >= d.frames; },
      next() {
        const mask = pi < d.inputs.length ? d.inputs[pi] : 0;
        const flip = fi < d.flips.length && d.flips[fi] === frame;
        if (flip) fi++;
        if (pi < d.inputs.length && ++used >= d.inputs[pi + 1]) {
          pi += 2;
          used = 0;
        }
        frame++;
        return { mask, flip };
      },
    };
  }

  // ---------- file system ----------
  // Chromium exposes the File System Access API (even on file:// pages),
  // so the Replays screen can point at a real folder; everywhere else
  // saving falls back to a download and loading to a file-open dialog
  const fsSupported = typeof window !== 'undefined' &&
    typeof window.showSaveFilePicker === 'function' &&
    typeof window.showDirectoryPicker === 'function';

  // `picker` overrides the dialog flavor ({types, id, accept}); the map
  // editor saves its .bmm files through here with its own types
  async function saveAs(text, suggestedName, startIn, picker) {
    if (fsSupported) {
      const opts = {
        suggestedName,
        types: (picker && picker.types) || PICKER_TYPES,
        id: (picker && picker.id) || 'burger-mania-replays',
      };
      if (startIn) opts.startIn = startIn;
      const h = await window.showSaveFilePicker(opts);
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
      return h.name;
    }
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return suggestedName + ' (check your downloads)';
  }

  async function openFile(picker) {
    if (typeof window !== 'undefined' &&
        typeof window.showOpenFilePicker === 'function') {
      const [h] = await window.showOpenFilePicker({
        types: (picker && picker.types) || PICKER_TYPES,
        id: (picker && picker.id) || 'burger-mania-replays',
      });
      return (await h.getFile()).text();
    }
    return new Promise((resolve, reject) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = (picker && picker.accept) || EXT + ',application/json';
      inp.onchange = () => {
        if (inp.files && inp.files[0]) inp.files[0].text().then(resolve, reject);
        else reject(new Error('no file chosen'));
      };
      inp.click();
    });
  }

  // Pick a folder and remember its handle. `opts` overrides where it's filed:
  // the dialog id (so the browser reopens the right place) and the IndexedDB
  // key the handle is cached under. Defaults to the replay folder; the map
  // editor passes its own { id, key } so maps and replays remember separately.
  async function pickDir(opts) {
    opts = opts || {};
    const h = await window.showDirectoryPicker({ id: opts.id || 'burger-mania-replays' });
    idbSet(opts.key || 'replayDir', h).catch(() => {});
    return h;
  }

  async function restoreDir(key) {
    try { return (await idbGet(key || 'replayDir')) || null; }
    catch (e) { return null; }
  }

  // true once the handle is readable; ask=true may show the browser's
  // permission prompt, so only pass it from a click or keypress
  async function dirPermission(h, ask) {
    try {
      if ((await h.queryPermission({ mode: 'read' })) === 'granted') return true;
      if (ask) return (await h.requestPermission({ mode: 'read' })) === 'granted';
    } catch (e) { /* treat as no permission */ }
    return false;
  }

  // every parseable file in the folder, newest first, plus a count of
  // files skipped because they're from another game version (so the UI can
  // explain the gap rather than just dropping them silently). `opts` overrides
  // the extension to match and the parser to validate with — the map editor
  // passes its own (.bmm + map parser) so this lists maps as well as replays.
  async function listDir(h, opts) {
    opts = opts || {};
    const ext = opts.ext || EXT;
    const parseFn = opts.parse || parse;
    const out = [];
    let outdated = 0;
    for await (const entry of h.values()) {
      if (entry.kind !== 'file' || !entry.name.endsWith(ext)) continue;
      try {
        const f = await entry.getFile();
        out.push({ name: entry.name, mtime: f.lastModified, data: parseFn(await f.text()) });
      } catch (e) {
        // a version mismatch is a known, explainable skip; anything else is a
        // damaged or non-replay file and is left out without comment
        if (e && e.versionMismatch) outdated++;
      }
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return { files: out, outdated };
  }

  // ---------- tiny IndexedDB store (folder handle + the mobile replay library) ----------
  function idb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('no idb'));
      const r = indexedDB.open('burger-mania', 2);
      r.onupgradeneeded = () => {
        // v1 held only `kv` (the remembered folder handle); v2 adds `replays`
        // so browsers without the File System Access API (iOS Safari) can keep
        // a library of runs in the browser instead of orphaned downloads
        const db = r.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('replays')) {
          db.createObjectStore('replays', { keyPath: 'id' });
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  function idbGet(key) {
    return idb().then(db => new Promise((resolve, reject) => {
      const rq = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    }));
  }
  function idbSet(key, val) {
    return idb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  // ---------- in-browser replay library (the mobile path) ----------
  // Without the File System Access API there's no folder to list and a saved
  // .bmr can't be reopened (iOS greys the unknown extension out of the Files
  // picker), so on those browsers replays live in IndexedDB and the Replays
  // screen lists them from here. dbList mirrors listDir's {files, outdated}
  // shape so the UI treats both alike; each file also carries an `id` for
  // deletion. The filename doubles as the key, so re-saving an identical run
  // (e.g. a double-tap on Save) overwrites it rather than piling up duplicates.
  function dbSave(text, name) {
    return idb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('replays', 'readwrite');
      tx.objectStore('replays').put({
        id: name, name, savedAt: new Date().toISOString(), text,
      });
      tx.oncomplete = () => resolve(name);
      tx.onerror = () => reject(tx.error);
    }));
  }

  function dbList() {
    return idb().then(db => new Promise((resolve, reject) => {
      const rq = db.transaction('replays', 'readonly').objectStore('replays').getAll();
      rq.onsuccess = () => {
        const out = [];
        let outdated = 0;
        for (const rec of rq.result || []) {
          try {
            out.push({
              id: rec.id, name: rec.name,
              mtime: Date.parse(rec.savedAt) || 0,
              data: parse(rec.text),
            });
          } catch (e) {
            // same rule as listDir: a version mismatch is a known skip, any
            // other parse failure is a corrupt record and is dropped silently
            if (e && e.versionMismatch) outdated++;
          }
        }
        out.sort((a, b) => b.mtime - a.mtime);
        resolve({ files: out, outdated });
      };
      rq.onerror = () => reject(rq.error);
    }));
  }

  function dbDelete(id) {
    return idb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('replays', 'readwrite');
      tx.objectStore('replays').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  return {
    VERSION,
    EXT, fsSupported,
    begin, record, hasRun, serialize,
    parse, cursor,
    saveAs, openFile, pickDir, restoreDir, dirPermission, listDir,
    dbSave, dbList, dbDelete,
  };
})();
