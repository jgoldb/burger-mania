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
  // event, read by the game every sim frame)
  const input = { up: false, down: false, left: false, right: false };

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
      left:    { x: lx, y, w: bs, h: bs },
      right:   { x: lx + bs + gap, y, w: bs, h: bs },
      flip:    { x: lx + (2 * bs + gap - fs) / 2, y: y - gap - fs, w: fs, h: fs },
      brake:   { x: rgx - bs - gap, y, w: bs, h: bs },
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
    input.up = input.down = input.left = input.right = false;
    if (!list || !list.length) return;
    const L = layout(W, H);
    for (let i = 0; i < list.length; i++) {
      const x = list[i].clientX, y = list[i].clientY;
      if (hit(L.gas, x, y)) input.up = true;
      if (hit(L.brake, x, y)) input.down = true;
      // left & right are independent (not else-if): the generous hit margins make
      // the two adjacent buttons overlap in a central strip, so a single touch
      // there sets BOTH → alovolt; two fingers on the separate buttons do the
      // same. Mirrors the keyboard's left+right alovolt
      if (hit(L.left, x, y)) input.left = true;
      if (hit(L.right, x, y)) input.right = true;
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

  function arrowBtn(ctx, r, ang, hot) {
    btnBox(ctx, r, hot);
    tri(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.22, ang, ink(hot));
  }

  // two opposed arrows: the turn-around (rear/front wheel swap) button
  function turnIcon(ctx, r) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const s = r.w * 0.17, dy = r.h * 0.14;
    const col = ink(false);
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
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (s === 'ready' || s === 'playing' || s === 'editorTest') {
      arrowBtn(ctx, L.left, Math.PI, input.left);
      arrowBtn(ctx, L.right, 0, input.right);
      arrowBtn(ctx, L.brake, Math.PI / 2, input.down);
      arrowBtn(ctx, L.gas, -Math.PI / 2, input.up);
      btnBox(ctx, L.flip, false);
      turnIcon(ctx, L.flip);
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
    } else if (s === 'difficulty' || s === 'recordsDiff' ||
               s === 'replays' || s === 'skip') {
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
