(function (root) {
  "use strict";

  const KEY_NOTES = Object.freeze({
    A: 0, S: 1, D: 2, F: 3, Z: 4, X: 5, C: 6, V: 7,
    G: 8, H: 9, B: 10, N: 11,
    J: 12, K: 13, L: 14, ";": 15, T: 16, Y: 17,
    U: 18, I: 19, O: 20, P: 21, M: 22, "1": 23,
    Q: 24, W: 25, E: 26, R: 27,
    "2": 28, "3": 29, "4": 30, "5": 31
  });
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function noteForKey(key) {
    const upper = key.toUpperCase();
    if (Object.hasOwn(KEY_NOTES, upper)) return KEY_NOTES[upper];
    return /^[0-9]$/.test(upper) ? Number(upper) % 32 : null;
  }

  function groupForNote(note) {
    return note < 8 ? 0 : note < 12 ? 1 : note < 24 ? 2 : 3;
  }

  function gridNote(x, y, width, height) {
    const columns = width >= height ? 8 : 4;
    const rows = 32 / columns;
    return Math.min(rows - 1, Math.floor(clamp(y / height, 0, 1) * rows)) * columns
      + Math.min(columns - 1, Math.floor(clamp(x / width, 0, 1) * columns));
  }

  function hitTime(now, origin, step, quantize) {
    if (!quantize) return now + 0.004;
    const phase = Math.max(0, now - origin) % step;
    const next = step - phase;
    return next <= 0.04 ? now + next : now + 0.004;
  }

  function sceneFrame(width, height) {
    const portrait = width < height;
    const scale = portrait
      ? Math.max(0.01, Math.min(width / 280, (height - 100) / 460))
      : Math.max(0.01, Math.min(Math.max(width / 1280, height / 720), (height - 100) / 460));
    return {
      scale,
      x: portrait ? width / 2 - 840 * scale : clamp(width / 2 - 840 * scale, width - 1280 * scale, 0),
      y: portrait ? height / 2 - 400 * scale : (height - 720 * scale) / 2
    };
  }

  function createPointers() {
    const active = new Map();
    return {
      active,
      begin(id, point, note, now) {
        active.set(id, { ...point, note, distance: 0, lastHit: now });
      },
      move(id, point, note, now) {
        const pointer = active.get(id);
        if (!pointer) return false;
        pointer.distance += Math.hypot(point.x - pointer.x, point.y - pointer.y);
        pointer.x = point.x;
        pointer.y = point.y;
        if ((note !== pointer.note || pointer.distance >= 24) && now - pointer.lastHit >= 65) {
          pointer.note = note;
          pointer.distance = 0;
          pointer.lastHit = now;
          return true;
        }
        return false;
      },
      end(id) { active.delete(id); },
      clear() { active.clear(); }
    };
  }

  function numericSetting(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? clamp(number, min, max) : fallback;
  }

  const api = { KEY_NOTES, clamp, noteForKey, groupForNote, gridNote, hitTime, sceneFrame, createPointers, numericSetting };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KonatapCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
