(function (root) {
  "use strict";

  const createCanvas = () => document.createElement("canvas");

  function project(quad, u, v) {
    const [p0, p1, p2, p3] = quad;
    const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0];
    const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1];
    const dx3 = p0[0] - p1[0] + p2[0] - p3[0];
    const dy3 = p0[1] - p1[1] + p2[1] - p3[1];
    const determinant = dx1 * dy2 - dx2 * dy1;
    const g = (dx3 * dy2 - dx2 * dy3) / determinant;
    const h = (dx1 * dy3 - dx3 * dy1) / determinant;
    const divisor = g * u + h * v + 1;
    return [
      ((p1[0] - p0[0] + g * p1[0]) * u + (p3[0] - p0[0] + h * p3[0]) * v + p0[0]) / divisor,
      ((p1[1] - p0[1] + g * p1[1]) * u + (p3[1] - p0[1] + h * p3[1]) * v + p0[1]) / divisor
    ];
  }

  function triangle(context, image, source, destination) {
    const [[x0, y0], [x1, y1], [x2, y2]] = source;
    const [[u0, v0], [u1, v1], [u2, v2]] = destination;
    const determinant = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
    const affine = values => [
      (values[0] * (y1 - y2) + values[1] * (y2 - y0) + values[2] * (y0 - y1)) / determinant,
      (values[0] * (x2 - x1) + values[1] * (x0 - x2) + values[2] * (x1 - x0)) / determinant,
      (values[0] * (x1 * y2 - x2 * y1) + values[1] * (x2 * y0 - x0 * y2) + values[2] * (x0 * y1 - x1 * y0)) / determinant
    ];
    const [a, c, e] = affine([u0, u1, u2]), [b, d, f] = affine([v0, v1, v2]);
    const center = [(u0 + u1 + u2) / 3, (v0 + v1 + v2) / 3];
    context.save();
    context.beginPath();
    destination.forEach(([x, y], index) => {
      const distance = Math.hypot(x - center[0], y - center[1]);
      const overlap = 1.8 / Math.max(1, distance);
      context[index ? "lineTo" : "moveTo"](x + (x - center[0]) * overlap, y + (y - center[1]) * overlap);
    });
    context.closePath();
    context.clip();
    context.transform(a, b, c, d, e, f);
    context.drawImage(image, 0, 0);
    context.restore();
  }

  class RoomScene {
    constructor(core, audio, onLoad) {
      this.core = core;
      this.audio = audio;
      this.art = root.KonatapRoomArt || {};
      this.images = new Map();
      this.seen = new WeakSet();
      this.sources = new WeakMap();
      this.noteSources = new Map();
      this.tapAt = -Infinity;
      this.control = "keyboard";
      this.screen = createCanvas();
      this.composite = createCanvas();
      this.light = createCanvas();
      this.screenContext = this.screen.getContext("2d");
      this.compositeContext = this.composite.getContext("2d");
      this.lightContext = this.light.getContext("2d");
      if (!root.Image) return;
      const paths = new Map();
      for (const spec of Object.values(this.art)) {
        paths.set(spec.image, spec.size);
        paths.set(spec.screenMask, spec.size);
        for (const key of ["keyboard", "mouse", "blink", "light"]) {
          const patch = spec[key], [left, top, right, bottom] = patch.box;
          paths.set(patch.image, [right - left, bottom - top]);
        }
      }
      for (const [path, size] of paths) {
        const image = new root.Image();
        image.onload = () => {
          if (image.naturalWidth !== size[0] || image.naturalHeight !== size[1]) return;
          this.images.set(path, image);
          onLoad();
        };
        image.src = path;
      }
    }

    layout(width, height, state) {
      const portrait = width < height;
      const name = portrait ? "portrait" : "landscape";
      const spec = this.art[name];
      if (!spec) return null;
      const [left, top, right, bottom] = spec.safe;
      const safeTop = 66;
      const safeBottom = state.pads && state.started ? height < 450 ? 106 : portrait ? 130 : 76 : 18;
      const available = Math.max(40, height - safeTop - safeBottom);
      const cover = Math.max(width / spec.size[0], height / spec.size[1]);
      const scale = Math.max(0.01, Math.min(cover, width / (right - left), available / (bottom - top)));
      let x = (width - (left + right) * scale) / 2;
      let y = safeTop + Math.max(0, available - (bottom - top) * scale) * 0.44 - top * scale;
      const imageWidth = spec.size[0] * scale, imageHeight = spec.size[1] * scale;
      const xMin = Math.max(width - imageWidth, -left * scale);
      const xMax = Math.min(0, width - right * scale);
      if (xMin <= xMax) x = this.core.clamp(x, xMin, xMax);
      const yMin = Math.max(height - imageHeight, safeTop - top * scale);
      const yMax = Math.min(0, height - safeBottom - bottom * scale);
      y = yMin <= yMax ? this.core.clamp(y, yMin, yMax) : Math.max(0, safeTop - top * scale);
      return { name, spec, scale, x, y, width, height };
    }

    ready(layout) {
      return Boolean(layout && this.images.has(layout.spec.image) && this.images.has(layout.spec.screenMask));
    }

    noteInput(note, control, hit) {
      this.noteSources.set(note, control);
      if (hit && typeof hit === "object") this.sources.set(hit, control);
    }

    reset() {
      this.tapAt = -Infinity;
      for (const hit of this.audio.foreground || []) this.seen.add(hit);
    }

    update(state, now) {
      const audio = this.audio;
      if (!state.started || state.paused || state.muted || state.volume === 0 || audio.context?.state !== "running") return;
      let latest = null;
      for (const hit of audio.foreground || []) {
        if (!hit.voices.size || hit.startAt > audio.context.currentTime || this.seen.has(hit)) continue;
        this.seen.add(hit);
        if (hit.endAt > audio.context.currentTime && (!latest || hit.startAt >= latest.startAt)) latest = hit;
      }
      if (!latest || state.reduceMotion || now - this.tapAt < 90) return;
      this.tapAt = now - Math.max(0, audio.context.currentTime - latest.startAt) * 1000;
      this.control = this.sources.get(latest) || this.noteSources.get(latest.note) || "keyboard";
    }

    tapOpacity(now) {
      const progress = (now - this.tapAt) / 180;
      return progress < 0 || progress >= 1 ? 0 : Math.sin(progress * Math.PI);
    }

    beatPulse(state) {
      if (!state.started || state.paused || state.muted || state.volume === 0 || !state.beat || state.reduceMotion
        || this.audio.context?.state !== "running") return 0;
      const beat = Math.max(0, this.audio.context.currentTime - this.audio.origin) / (root.KonatapAudio.STEP * 4);
      return Math.pow(1 - beat % 1, 4);
    }

    drawPatch(context, layout, patch, opacity) {
      const image = this.images.get(patch.image);
      if (!image || opacity <= 0) return;
      const [left, top, right, bottom] = patch.box;
      context.save();
      context.globalAlpha = opacity;
      context.drawImage(image, layout.x + left * layout.scale, layout.y + top * layout.scale,
        (right - left) * layout.scale, (bottom - top) * layout.scale);
      context.restore();
    }

    drawBase(context, layout, state, now) {
      const image = this.images.get(layout.spec.image);
      context.save();
      context.imageSmoothingEnabled = true;
      const width = layout.spec.size[0] * layout.scale, height = layout.spec.size[1] * layout.scale;
      // Horizontal edge padding stays at native scale; vertical gaps remain quiet control bands.
      for (let column = -1; column <= 1; column++) {
        const left = layout.x + column * width;
        if (left >= layout.width || left + width <= 0) continue;
        context.save();
        context.translate(layout.x + (column === 1 ? width * 2 : 0), layout.y);
        context.scale(column ? -1 : 1, 1);
        context.drawImage(image, 0, 0, width, height);
        context.restore();
      }
      if (layout.height < 450) {
        context.fillStyle = "#535168";
        context.fillRect(0, 0, layout.width, 66);
      }
      const tap = state.reduceMotion || state.paused || state.muted ? 0 : this.tapOpacity(now);
      this.drawPatch(context, layout, layout.spec[this.control], tap);
      if (!state.reduceMotion && !state.paused && now % 4200 < 140) {
        this.drawPatch(context, layout, layout.spec.blink, Math.sin(now % 4200 / 140 * Math.PI));
      }
      context.restore();
    }

    drawOverlay(context, layout, state, now, backgrounds, paintEffects) {
      const { spec } = layout;
      if (this.screen.width !== spec.screenSize[0] || this.screen.height !== spec.screenSize[1]) {
        [this.screen.width, this.screen.height] = spec.screenSize;
      }
      const screen = this.screenContext;
      screen.setTransform(1, 0, 0, 1, 0, 0);
      screen.globalAlpha = 1;
      screen.fillStyle = backgrounds[state.backgroundFrom];
      screen.fillRect(0, 0, this.screen.width, this.screen.height);
      screen.globalAlpha = state.reduceMotion ? 1 : this.core.clamp((now - state.backgroundAt) / 600, 0, 1);
      screen.fillStyle = backgrounds[state.background];
      screen.fillRect(0, 0, this.screen.width, this.screen.height);
      screen.globalAlpha = 1;
      paintEffects(screen, this.screen.width, this.screen.height);
      if (this.composite.width !== spec.size[0] || this.composite.height !== spec.size[1]) {
        [this.composite.width, this.composite.height] = spec.size;
      }
      const composite = this.compositeContext;
      composite.setTransform(1, 0, 0, 1, 0, 0);
      composite.clearRect(0, 0, this.composite.width, this.composite.height);
      composite.beginPath();
      spec.screen.forEach(([x, y], index) => composite[index ? "lineTo" : "moveTo"](x, y));
      composite.closePath();
      composite.fillStyle = backgrounds[state.backgroundFrom];
      composite.fill();
      composite.globalAlpha = state.reduceMotion ? 1 : this.core.clamp((now - state.backgroundAt) / 600, 0, 1);
      composite.fillStyle = backgrounds[state.background];
      composite.fill();
      composite.globalAlpha = 1;
      const segments = 4;
      for (let row = 0; row < segments; row++) for (let column = 0; column < segments; column++) {
        const uv = [[column, row], [column + 1, row], [column + 1, row + 1], [column, row + 1]]
          .map(([u, v]) => [u / segments, v / segments]);
        const source = uv.map(([u, v]) => [u * this.screen.width, v * this.screen.height]);
        const destination = uv.map(([u, v]) => project(spec.screen, u, v));
        triangle(composite, this.screen, [source[0], source[1], source[2]], [destination[0], destination[1], destination[2]]);
        triangle(composite, this.screen, [source[0], source[2], source[3]], [destination[0], destination[2], destination[3]]);
      }
      composite.globalCompositeOperation = "destination-in";
      composite.drawImage(this.images.get(spec.screenMask), 0, 0);
      composite.globalCompositeOperation = "source-over";
      context.save();
      context.imageSmoothingEnabled = true;
      context.drawImage(this.composite, layout.x, layout.y, this.composite.width * layout.scale, this.composite.height * layout.scale);

      const patch = spec.light, mask = this.images.get(patch.image);
      if (mask) {
        const [left, top, right, bottom] = patch.box;
        if (this.light.width !== right - left || this.light.height !== bottom - top) {
          this.light.width = right - left;
          this.light.height = bottom - top;
        }
        const light = this.lightContext;
        light.clearRect(0, 0, this.light.width, this.light.height);
        light.drawImage(mask, 0, 0);
        light.globalCompositeOperation = "source-in";
        light.fillStyle = backgrounds[state.background];
        light.fillRect(0, 0, this.light.width, this.light.height);
        light.globalCompositeOperation = "source-over";
        context.globalCompositeOperation = "screen";
        context.globalAlpha = state.reduceMotion ? 0.045
          : 0.045 + this.beatPulse(state) * 0.025 + (state.paused || state.muted ? 0 : this.tapOpacity(now)) * 0.055;
        context.drawImage(this.light, layout.x + left * layout.scale, layout.y + top * layout.scale,
          this.light.width * layout.scale, this.light.height * layout.scale);
      }
      context.restore();
    }

    center(layout) {
      const [x, y] = project(layout.spec.screen, 0.5, 0.5);
      return { x: layout.x + x * layout.scale, y: layout.y + y * layout.scale };
    }

    cornetHit(layout, x, y) {
      const [left, top, right, bottom] = layout.spec.cornet;
      const sx = (x - layout.x) / layout.scale, sy = (y - layout.y) / layout.scale;
      return sx > left && sx < right && sy > top && sy < bottom;
    }
  }

  root.KonatapRoom = { RoomScene, project };
})(window);
