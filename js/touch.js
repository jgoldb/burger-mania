'use strict';

// On-screen controls for touch devices. This module owns the button
// geometry, the held-button state, and the overlay drawing; game.js wires
// the canvas touch events into it and reads `TOUCH.input` each sim frame.
// Touch input merges into the same key mask the keyboard feeds, so
// replays record touch runs identically (no format change).
const TOUCH = (() => {
  // a phone or tablet announces itself by its coarse primary pointer; a
  // desktop touchscreen only counts once a finger actually lands
  let active = false;
  try { active = matchMedia('(pointer: coarse)').matches; } catch (e) { /* stub DOM */ }

  // which cluster buttons are currently held (recomputed on every touch
  // event, read by the game every sim frame). `flip` is cosmetic-only: the
  // turn-around is a one-shot fired from game.js (`flipQueued`), so the sim
  // never reads this — it only drives the button's held press animation.
  const input = { up: false, down: false, left: false, right: false, flip: false };

  // animated press feedback: each pressable half swells a little while held so
  // it's obvious which side (or both) a thumb is on. These are cosmetic scale
  // factors that ease toward PRESS_SCALE when the matching input is held and
  // back to 1 when released; advanced once per drawn frame in `animate` off the
  // wall clock (overlay-only, so it never touches the deterministic sim).
  const PRESS_SCALE = 1.13;   // how far a held half swells
  const RISE = 30, FALL = 17; // approach rates (per second): snappy down, softer up
  const scale = { up: 1, down: 1, left: 1, right: 1, flip: 1 };
  let lastT = 0;
  function animate() {
    const t = Date.now() / 1000;
    let dt = lastT ? t - lastT : 0;
    lastT = t;
    if (dt > 0.1) dt = 0.1;   // a tab-out shouldn't snap everything at once
    for (const k in scale) {
      const target = input[k] ? PRESS_SCALE : 1;
      const f = 1 - Math.exp(-(input[k] ? RISE : FALL) * dt);
      scale[k] += (target - scale[k]) * f;
    }
  }

  function activate() { active = true; }

  // Button geometry, derived from the screen's short side: gas/brake
  // under the right thumb, the lean pair under the left with the
  // turn-around button above it, small pause/restart buttons at the top
  // centre (clear of the HUD on the left and the minimap on the right),
  // a save button under the crash/finish panel, and a corner back button
  // for the screens that only Esc leaves on a keyboard.
  function layout(W, H) {
    const u = Math.min(W, H);
    const bs = Math.max(56, Math.min(u * 0.17, 96));
    const gap = bs * 0.18, m = Math.max(10, bs * 0.2);
    // pull the clusters in from the notch / home-indicator cutouts (SAFE is
    // owned by render.js; it's all zeros on desktop and in the harnesses)
    const sl = SAFE.left, sr = SAFE.right, st = SAFE.top, sb = SAFE.bottom;
    const y = H - sb - m - bs;
    const fs = bs * 0.78;
    const ss = Math.max(40, bs * 0.55);
    const lx = sl + m;                 // left cluster x
    const rgx = W - sr - m - bs;       // right (gas) cluster x
    return {
      // the lean pair and the gas/brake pair each butt together with no gap so
      // they read as one capsule; a thumb on the seam trips both halves (the
      // generous hit margins overlap there) while either end presses just its
      // own side. flip stays centred over the (now narrower) left cluster
      left:    { x: lx, y, w: bs, h: bs },
      right:   { x: lx + bs, y, w: bs, h: bs },
      flip:    { x: lx + (2 * bs - fs) / 2, y: y - gap - fs, w: fs, h: fs },
      brake:   { x: rgx - bs, y, w: bs, h: bs },
      gas:     { x: rgx, y, w: bs, h: bs },
      pause:   { x: W / 2 - ss - 8, y: 10 + st, w: ss, h: ss },
      restart: { x: W / 2 + 8, y: 10 + st, w: ss, h: ss },
      save:    saveButtonRect(W, H),
      back:    { x: 12 + sl, y: 12 + st, w: 104, h: 46 },
    };
  }

  // generous hit test: a thumb landing a few px outside still counts
  function hit(r, x, y) {
    const s = 12;
    return x >= r.x - s && x <= r.x + r.w + s &&
           y >= r.y - s && y <= r.y + r.h + s;
  }

  // recompute the held cluster buttons from the full current-touch list;
  // purely positional, so a finger sliding off a button releases it and
  // sliding onto one presses it
  function sync(list, W, H) {
    input.up = input.down = input.left = input.right = input.flip = false;
    if (!list || !list.length) return;
    const L = layout(W, H);
    for (let i = 0; i < list.length; i++) {
      const x = list[i].clientX, y = list[i].clientY;
      // every direction is tested independently (not else-if): each pair's two
      // halves butt together, so the generous hit margins overlap in a fat strip
      // over the seam — a single touch there sets BOTH (alovolt on the lean pair;
      // gas+brake on the right), and two fingers on the ends do the same. Mirrors
      // the keyboard, where left+right is alovolt
      if (hit(L.gas, x, y)) input.up = true;
      if (hit(L.brake, x, y)) input.down = true;
      if (hit(L.left, x, y)) input.left = true;
      if (hit(L.right, x, y)) input.right = true;
      // cosmetic only — lights/swells the turn-around while a finger rests on it
      if (hit(L.flip, x, y)) input.flip = true;
    }
  }

  // ---------- drawing (style matches drawButtons in render.js) ----------

  function btnBox(ctx, r, hot) {
    ctx.fillStyle = hot ? 'rgba(70,34,10,0.92)' : 'rgba(20,12,6,0.55)';
    roundRectPath(ctx, r.x, r.y, r.w, r.h, Math.min(16, r.w * 0.2));
    ctx.fill();
    ctx.lineWidth = hot ? 3 : 2;
    ctx.strokeStyle = hot ? '#f9c623' : 'rgba(249,198,35,0.5)';
    ctx.stroke();
  }

  function ink(hot) { return hot ? '#ffe27a' : 'rgba(240,232,218,0.9)'; }

  // solid triangle pointing along ang (0 = right), tip s from the centre
  function tri(ctx, cx, cy, s, ang, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.62, s * 0.72);
    ctx.lineTo(-s * 0.62, -s * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // a rounded-rect path that rounds only one end's corners: the outer end of a
  // half-tile keeps the capsule's radius while the inner (divider) edge stays
  // square, so two halves butt into one seamless capsule. arcTo with r=0 just
  // draws a sharp corner.
  function halfTilePath(ctx, x, y, w, h, rad, roundLeft) {
    const rl = roundLeft ? rad : 0, rr = roundLeft ? 0 : rad;
    ctx.beginPath();
    ctx.moveTo(x + rl, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rl, y + h);
    ctx.arcTo(x, y + h, x, y + h - rl, rl);
    ctx.lineTo(x, y + rl);
    ctx.arcTo(x, y, x + rl, y, rl);
    ctx.closePath();
  }

  // one half of a pair: at rest only its dim arrow shows (so the capsule reads
  // as a single dark shape); while held it lights up as a raised "key" and the
  // whole key — tile and arrow — swells by `sc` about its own centre, the press
  // animation that makes the active side obvious. `sc` of exactly 1 (released
  // and settled) draws no tile, matching the old quiescent look.
  function half(ctx, r, rad, roundLeft, ang, hot, sc) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const p = (sc - 1) / (PRESS_SCALE - 1);   // 0 at rest, 1 fully pressed
    ctx.save();
    if (sc !== 1) {
      // pin the swell to this half's own side of the seam: clip everything past
      // the shared inner edge so a held half grows only outward (and over the
      // rail top/bottom), never across the divider. without this, both halves
      // held at once each bulge ~6% past the seam and the second-drawn one
      // paints over the first — making it look wider and the pair lopsided.
      const seam = roundLeft ? r.x + r.w : r.x;   // shared edge with the neighbour
      ctx.beginPath();
      ctx.rect(roundLeft ? seam - 2 * r.w : seam, r.y - r.h, 2 * r.w, 3 * r.h);
      ctx.clip();
      ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
    }
    if (p > 0.004) {
      // the lit key fades in/out together with the swell, so a release shrinks
      // and dims off smoothly rather than popping away at the end
      ctx.globalAlpha = Math.min(1, p * 1.5);
      halfTilePath(ctx, r.x, r.y, r.w, r.h, rad, roundLeft);
      ctx.fillStyle = 'rgba(70,34,10,0.92)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#f9c623';
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    tri(ctx, cx, cy, r.w * 0.22, ang, ink(hot));
    ctx.restore();
  }

  // two adjacent buttons drawn as ONE capsule: a single rounded outline around
  // the pair, a faint centre divider so the two sides still read, and each half
  // lighting + swelling when held (pressing the seam lights both). `a` is the
  // left/bottom half, `b` the right/top half; they must butt together with no
  // gap (a.x + a.w === b.x), so the whole span is one continuous rounded rect.
  // `scA`/`scB` are the animated press scales for each half (see `animate`).
  function arrowPair(ctx, a, b, angA, angB, hotA, hotB, scA, scB) {
    const x = a.x, y = a.y, w = a.w + b.w, h = a.h, mid = a.x + a.w;
    const rad = Math.min(16, a.w * 0.2);
    const hot = hotA || hotB;
    // dim capsule body
    ctx.fillStyle = 'rgba(20,12,6,0.55)';
    roundRectPath(ctx, x, y, w, h, rad);
    ctx.fill();
    // faint centre divider
    ctx.strokeStyle = 'rgba(249,198,35,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mid, y + h * 0.2);
    ctx.lineTo(mid, y + h * 0.8);
    ctx.stroke();
    // outer outline; brightens whenever either half is held
    roundRectPath(ctx, x, y, w, h, rad);
    ctx.lineWidth = hot ? 3 : 2;
    ctx.strokeStyle = hot ? '#f9c623' : 'rgba(249,198,35,0.5)';
    ctx.stroke();
    // the lit, swelling halves ride on top so a press visibly rises over the rail
    half(ctx, a, rad, true, angA, hotA, scA);
    half(ctx, b, rad, false, angB, hotB, scB);
  }

  // a standalone button drawn with the same press feedback as the pair halves:
  // a dim base at rest, and while held a lit box that swells about its centre
  // (fading in/out with the swell so a release settles smoothly), `icon` on top.
  function pressBtn(ctx, r, sc, hot, icon) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const p = (sc - 1) / (PRESS_SCALE - 1);   // 0 at rest, 1 fully pressed
    btnBox(ctx, r, false);                     // dim base, always
    ctx.save();
    if (sc !== 1) { ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy); }
    if (p > 0.004) {
      ctx.globalAlpha = Math.min(1, p * 1.5);
      btnBox(ctx, r, true);                    // lit box rises over the base
      ctx.globalAlpha = 1;
    }
    icon(ctx, r, hot);
    ctx.restore();
  }

  // two opposed arrows: the turn-around (rear/front wheel swap) button
  function turnIcon(ctx, r, hot) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const s = r.w * 0.17, dy = r.h * 0.14;
    const col = ink(hot);
    tri(ctx, cx + s * 0.4, cy - dy, s, 0, col);
    tri(ctx, cx - s * 0.4, cy + dy, s, Math.PI, col);
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(3, r.w * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - s * 1.4, cy - dy);
    ctx.lineTo(cx - s * 0.2, cy - dy);
    ctx.moveTo(cx + s * 1.4, cy + dy);
    ctx.lineTo(cx + s * 0.2, cy + dy);
    ctx.stroke();
  }

  // circular arrow: restart
  function loopIcon(ctx, r) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = r.w * 0.24;
    ctx.strokeStyle = ink(false);
    ctx.lineWidth = Math.max(3, r.w * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, rad, -Math.PI * 0.8, Math.PI * 0.6);
    ctx.stroke();
    const a = Math.PI * 0.6;
    tri(ctx, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad,
      r.w * 0.14, a + Math.PI / 2, ink(false));
  }

  function pauseIcon(ctx, r) {
    const bw = r.w * 0.13, bh = r.h * 0.4;
    ctx.fillStyle = ink(false);
    ctx.fillRect(r.x + r.w / 2 - bw * 1.6, r.y + (r.h - bh) / 2, bw, bh);
    ctx.fillRect(r.x + r.w / 2 + bw * 0.6, r.y + (r.h - bh) / 2, bw, bh);
  }

  // overlay for the current screen; drawn last so it sits above the HUD
  function draw(ctx, W, H, o) {
    if (!active) return;
    const s = o.state;
    const L = layout(W, H);
    animate();   // advance the held-button swell toward its rest/pressed targets
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (s === 'ready' || s === 'playing' || s === 'editorTest') {
      arrowPair(ctx, L.left, L.right, Math.PI, 0, input.left, input.right,
        scale.left, scale.right);
      arrowPair(ctx, L.brake, L.gas, Math.PI / 2, -Math.PI / 2, input.down, input.up,
        scale.down, scale.up);
      pressBtn(ctx, L.flip, scale.flip, input.flip, turnIcon);
      btnBox(ctx, L.pause, false);
      pauseIcon(ctx, L.pause);
      // restart belongs to the editor's test ride only; in the real game the
      // pause button (which opens the menu) is the sole top control, matching
      // the ready/dead/finished screens
      if (s === 'editorTest') {
        btnBox(ctx, L.restart, false);
        loopIcon(ctx, L.restart);
      }
    } else if (s === 'editorTestEnd') {
      // the pause button doubles as "back to the editor" here; the SAVE
      // button writes the test ride's tape, just like the crash/finish screens
      btnBox(ctx, L.pause, false);
      pauseIcon(ctx, L.pause);
      ctx.globalAlpha = o.saveBusy ? 0.5 : 1;
      btnBox(ctx, L.save, false);
      ctx.fillStyle = ink(false);
      ctx.font = 'bold 18px "Consolas","Courier New",monospace';
      ctx.fillText('SAVE REPLAY', L.save.x + L.save.w / 2, L.save.y + L.save.h / 2 + 1);
      ctx.globalAlpha = 1;
    } else if (s === 'dead' || s === 'finished') {
      btnBox(ctx, L.pause, false);
      pauseIcon(ctx, L.pause);
      ctx.globalAlpha = o.saveBusy ? 0.5 : 1;
      btnBox(ctx, L.save, false);
      ctx.fillStyle = ink(false);
      ctx.font = 'bold 18px "Consolas","Courier New",monospace';
      ctx.fillText('SAVE REPLAY', L.save.x + L.save.w / 2, L.save.y + L.save.h / 2 + 1);
      ctx.globalAlpha = 1;
    } else if (s === 'skip') {
      // the difficulty / records / replays screens draw their own corner Back
      // (render.js drawMenuBack) on every device; only the dev skip overlay
      // still relies on the touch overlay for its back button.
      btnBox(ctx, L.back, false);
      tri(ctx, L.back.x + 24, L.back.y + L.back.h / 2, 9, Math.PI, ink(false));
      ctx.fillStyle = ink(false);
      ctx.font = 'bold 16px "Consolas","Courier New",monospace';
      ctx.textAlign = 'left';
      ctx.fillText('BACK', L.back.x + 40, L.back.y + L.back.h / 2 + 1);
    }
    ctx.restore();
  }

  return {
    get active() { return active; },
    activate, input, layout, hit, sync, draw,
  };
})();
