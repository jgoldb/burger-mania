'use strict';

// Replay recording, (de)serialization, and the file-system plumbing for
// saving and browsing replays. A replay is the per-frame input stream of
// one run: the physics is deterministic (fixed 60 Hz step, no randomness),
// so feeding the recorded inputs back through the same sim reproduces the
// run exactly. The raw level data rides along in the file, so a replay
// stays faithful even if the level is later retuned (physics changes can
// still desync old replays; playback then just ends where the tape does).
const REPLAY = (() => {
  const FORMAT = 'burger-mania-replay';
  const VERSION = 1;
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
      throw new Error('unsupported replay version ' + d.version);
    }
    const L = d.level;
    if (!L || !Array.isArray(L.polygons) || !L.polygons.length ||
        !L.polygons.every(p => Array.isArray(p) && p.length >= 3 && p.every(isPt)) ||
        !L.start || !isFinite(L.start.x) || !isFinite(L.start.y) ||
        !Array.isArray(L.burgers) || !L.burgers.every(isPt) ||
        !isPt(L.goal)) {
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

  async function saveAs(text, suggestedName, startIn) {
    if (fsSupported) {
      const opts = {
        suggestedName,
        types: PICKER_TYPES,
        id: 'burger-mania-replays',
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

  async function openFile() {
    if (typeof window !== 'undefined' &&
        typeof window.showOpenFilePicker === 'function') {
      const [h] = await window.showOpenFilePicker({
        types: PICKER_TYPES,
        id: 'burger-mania-replays',
      });
      return (await h.getFile()).text();
    }
    return new Promise((resolve, reject) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = EXT + ',application/json';
      inp.onchange = () => {
        if (inp.files && inp.files[0]) inp.files[0].text().then(resolve, reject);
        else reject(new Error('no file chosen'));
      };
      inp.click();
    });
  }

  async function pickDir() {
    const h = await window.showDirectoryPicker({ id: 'burger-mania-replays' });
    idbSet('replayDir', h).catch(() => {});
    return h;
  }

  async function restoreDir() {
    try { return (await idbGet('replayDir')) || null; }
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

  // every parseable EXT file in the folder, newest first
  async function listDir(h) {
    const out = [];
    for await (const entry of h.values()) {
      if (entry.kind !== 'file' || !entry.name.endsWith(EXT)) continue;
      try {
        const f = await entry.getFile();
        out.push({ name: entry.name, mtime: f.lastModified, data: parse(await f.text()) });
      } catch (e) { /* not a replay (or a broken one): leave it out */ }
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  }

  // ---------- tiny IndexedDB key-value store (remembers the folder) ----------
  function idb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('no idb'));
      const r = indexedDB.open('burger-mania', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
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

  return {
    EXT, fsSupported,
    begin, record, hasRun, serialize,
    parse, cursor,
    saveAs, openFile, pickDir, restoreDir, dirPermission, listDir,
  };
})();
