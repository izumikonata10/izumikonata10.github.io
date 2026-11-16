(() => {
  "use strict";

  const core = window.KonatapCore;
  const audio = new window.KonatapAudio.AudioEngine(core);
  const $ = (id) => document.getElementById(id);
  const app = $("app");
  const sceneCanvas = $("scene-canvas");
  const effectCanvas = $("effect-canvas");
  const sceneCtx = sceneCanvas.getContext("2d", { alpha: false });
  const effectCtx = effectCanvas.getContext("2d");
  const startButton = $("start-button");
  const comboNode = $("combo");
  const bestNode = $("best");
  const moyuValue = $("moyu-value");
  const moyuTrack = $("moyu-track");
  const moyuFill = $("moyu-fill");
  const soundToggle = $("sound-toggle");
  const beatToggle = $("beat-toggle");
  const settingsToggle = $("settings-toggle");
  const fullscreenToggle = $("fullscreen-toggle");
  const helpToggle = $("help-toggle");
  const helpPanel = $("help-panel");
  const settingsPanel = $("settings-panel");
  const volumeRange = $("volume-range");
  const volumeOutput = $("volume-output");
  const quantizeToggle = $("quantize-toggle");
  const motionToggle = $("motion-toggle");
  const restartButton = $("restart-button");
  const pauseToggle = $("pause-toggle");
  const resumeButton = $("resume-button");
  const gameStats = $("game-stats");
  const padsToggle = $("pads-toggle");
  const statsToggle = $("stats-toggle");
  const sampleNote = $("sample-note");
  const sampleFile = $("sample-file");
  const sampleStatus = $("sample-status");
  const sampleClear = $("sample-clear");
  const toast = $("toast");
  const touchPads = [...document.querySelectorAll("[data-note]")];
  const closeButtons = [...document.querySelectorAll("[data-close-panel]")];

  const STORAGE_PREFIX = "konatap-v2-";
  const COLORS = ["#d85289", "#dda12f", "#419e70", "#249dac", "#736cc0", "#ed795c"];
  const BACKGROUNDS = ["#f0f6f3", "#fce8ed", "#e0f1ed", "#f8efce", "#e9e8f5", "#e3f1f6"];
  const KINDS = ["ring", "tiles", "ribbon", "spiral", "burst", "bars", "polygon", "disc",
    "cross", "orbit", "zigzag", "curtain", "fan", "brackets", "slash", "speech"];
  const effects = [];
  const pendingPoses = [];
  const pointers = core.createPointers();
  const keyTrail = [];
  const backgroundCanvas = document.createElement("canvas");
  const backgroundCtx = backgroundCanvas.getContext("2d", { alpha: false });

  function readStored(key, fallback) {
    try {
      const value = localStorage.getItem(STORAGE_PREFIX + key);
      return value === null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function writeStored(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, String(value));
    } catch (_) {
      // Local files can run in privacy modes where storage is unavailable.
    }
  }

  const state = {
    started: false,
    paused: false,
    muted: false,
    beat: true,
    quantize: readStored("quantize", "true") !== "false",
    reduceMotion: readStored("reduce-motion", "false") === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    volume: core.numericSetting(readStored("volume", "0.7"), 0.7, 0, 1),
    scene: readStored("scene", "stage") === "room" ? "room" : "stage",
    pads: readStored("pads", "false") === "true",
    stats: readStored("stats", "false") === "true",
    combo: 0,
    best: core.numericSetting(readStored("best", "0"), 0, 0, Number.MAX_SAFE_INTEGER),
    moyu: 0,
    lastHit: 0,
    totalHits: 0,
    characterPose: 0,
    expression: 0,
    expressionUntil: 0,
    poseUntil: 0,
    feverUntil: 0,
    otakuUntil: 0,
    cornetClicks: 0,
    scenePulse: 0,
    background: 0,
    backgroundFrom: 0,
    backgroundAt: 0
  };

  let toastTimer = null;
  let cssWidth = 0;
  let cssHeight = 0;
  let dpr = 1;
  let sceneScale = 1;
  let sceneOffsetX = 0;
  let sceneOffsetY = 0;
  let lastFrame = performance.now();
  let pausedAt = 0;
  let pausedDuration = 0;
  let animationId = null;
  let resumeInFlight = false;
  let panelReturnFocus = null;
  let autoPaused = false;
  let pauseTask = Promise.resolve();
  let startRevision = 0;

  const playNow = () => (state.paused ? pausedAt : performance.now()) - pausedDuration;

  bestNode.textContent = state.best;
  volumeRange.value = String(Math.round(state.volume * 100));
  volumeOutput.value = `${Math.round(state.volume * 100)}%`;
  quantizeToggle.checked = state.quantize;
  motionToggle.checked = state.reduceMotion;
  padsToggle.checked = state.pads;
  statsToggle.checked = state.stats;
  app.dataset.scene = state.scene;
  app.dataset.pads = String(state.pads);
  gameStats.hidden = !state.stats;
  document.querySelector(`input[name="scene"][value="${state.scene}"]`).checked = true;
  app.classList.toggle("reduce-motion", state.reduceMotion);
  audio.setVolume(state.volume);

  function resizeCanvas(canvas, context) {
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.imageSmoothingEnabled = false;
  }

  function resize() {
    const rect = app.getBoundingClientRect();
    cssWidth = Math.max(1, Math.round(rect.width));
    cssHeight = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const framing = core.sceneFrame(cssWidth, cssHeight);
    sceneScale = framing.scale;
    sceneOffsetX = framing.x;
    sceneOffsetY = framing.y;
    resizeCanvas(sceneCanvas, sceneCtx);
    resizeCanvas(effectCanvas, effectCtx);
    drawScene(playNow());
    drawEffects(playNow());
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1800);
  }

  function setCharacter(group, index) {
    state.characterPose = group + 1;
    state.expression = index % 4;
    const now = playNow();
    state.poseUntil = now + 420 + group * 80;
    state.expressionUntil = now + 520 + group * 90;
  }

  function groupForNote(index) {
    return core.groupForNote(index);
  }

  function addEffect(index, x, y, strength = 1, startAt = playNow()) {
    if (effects.length >= 32) effects.shift();
    effects.push({
      kind: KINDS[index % KINDS.length], index, x, y, startAt,
      color: COLORS[index % COLORS.length],
      duration: state.reduceMotion ? 360 : 700 + (index % 4) * 120,
      size: Math.min(cssWidth, cssHeight) * (0.28 + index % 3 * 0.055) * strength,
      rotation: (index % 8) * Math.PI / 4,
      label: ["!", "GAME", "?", "ZZZ"][index % 4]
    });
  }

  function updateCombo(now) {
    state.combo = now - state.lastHit < 760 ? state.combo + 1 : 1;
    state.lastHit = now;
    if (state.combo > state.best) {
      state.best = state.combo;
      bestNode.textContent = state.best;
      writeStored("best", state.best);
    }
    comboNode.textContent = state.combo;
  }

  function updateMeterDisplay() {
    const value = Math.round(Math.max(0, Math.min(100, state.moyu)));
    moyuValue.textContent = `${value}%`;
    moyuFill.style.width = `${value}%`;
    moyuTrack.setAttribute("aria-valuenow", String(value));
  }

  function triggerFever(message = "摸鱼过载！深夜高能状态") {
    if (playNow() < state.feverUntil) return;
    state.feverUntil = playNow() + 12000;
    state.moyu = 100;
    app.dataset.fever = "true";
    updateMeterDisplay();
    showToast(message);
    const burstCount = state.reduceMotion ? 2 : 5;
    for (let i = 0; i < burstCount; i += 1) {
      addEffect(12 + i, cssWidth / 2, cssHeight / 2, 1.1);
    }
  }

  function addMoyu(index) {
    if (playNow() < state.feverUntil) return;
    const gains = [2.3, 4.2, 6.4, 8.5];
    state.moyu = Math.min(100, state.moyu + gains[groupForNote(index)]);
    updateMeterDisplay();
    if (state.moyu >= 100) triggerFever();
  }

  function checkNameSecret(key) {
    if (!/^[A-Z]$/.test(key)) return;
    keyTrail.push(key);
    if (keyTrail.length > 6) keyTrail.shift();
    if (keyTrail.join("") === "KONATA") {
      state.otakuUntil = playNow() + 14000;
      triggerFever("OTAKU MODE 解锁");
      keyTrail.length = 0;
    }
  }

  function hit(index, x = cssWidth * 0.5, y = cssHeight * 0.5, velocity = 1, options = {}) {
    if (!state.started || state.paused || !audio.context || audio.context.state !== "running") return;
    const when = audio.scheduleTime(state.quantize);
    const visualAt = playNow() + (when - audio.context.currentTime) * 1000;
    audio.play(index, velocity, when);
    addEffect(index, x, y, velocity, visualAt);
    if (pendingPoses.length >= 32) pendingPoses.shift();
    pendingPoses.push({ index, at: visualAt });
    pendingPoses.sort((a, b) => a.at - b.at);
    state.totalHits += 1;
    if (state.totalHits % 8 === 0 && !state.reduceMotion) {
      state.backgroundFrom = state.background;
      state.background = (state.background + 1) % BACKGROUNDS.length;
      state.backgroundAt = visualAt;
    }
    if (options.combo !== false) updateCombo(playNow());
    if (state.stats && options.meter !== false) addMoyu(index);
  }

  async function startGame() {
    if (resumeInFlight) return;
    resumeInFlight = true;
    const revision = ++startRevision;
    startButton.disabled = true;
    try {
      await pauseTask;
      const resumed = await audio.resume();
      if (!resumed || revision !== startRevision) return;
      if (document.hidden) {
        await pauseGame("auto");
        return;
      }
      if (state.paused) pausedDuration += performance.now() - pausedAt;
      state.paused = false;
      state.started = true;
      autoPaused = false;
      app.dataset.started = "true";
      app.dataset.paused = "false";
      resumeButton.hidden = true;
      pauseToggle.setAttribute("aria-pressed", "false");
      setIcon(pauseToggle, "pause", "暂停");
      startButton.blur();
      resumeButton.blur();
      lastFrame = performance.now();
      if (animationId === null) animationId = requestAnimationFrame(frame);
    } catch (_) {
      showToast("声音未能启动，请再次点击开始或继续");
    } finally {
      resumeInFlight = false;
      startButton.disabled = false;
    }
  }

  function pauseGame(reason = "manual") {
    if (reason === "manual") autoPaused = false;
    else if ((state.started && !state.paused) || resumeInFlight) autoPaused = true;
    if ((!state.started && !resumeInFlight) || (state.paused && !resumeInFlight)) return pauseTask;
    startRevision += 1;
    if (!state.paused) pausedAt = performance.now();
    state.paused = true;
    pointers.clear();
    pendingPoses.length = 0;
    for (let i = effects.length - 1; i >= 0; i -= 1) {
      if (effects[i].startAt > playNow()) effects.splice(i, 1);
    }
    app.dataset.paused = "true";
    resumeButton.hidden = !state.started;
    pauseToggle.setAttribute("aria-pressed", "true");
    setIcon(pauseToggle, "play", "继续");
    pauseTask = audio.pause().catch(() => {});
    return pauseTask;
  }

  function setIcon(button, icon, label) {
    button.querySelector("img").src = `assets/icons/${icon}.svg`;
    button.setAttribute("aria-label", label);
    button.title = label;
  }

  function restartRound() {
    state.combo = 0;
    state.moyu = 0;
    state.totalHits = 0;
    state.feverUntil = 0;
    state.otakuUntil = 0;
    state.cornetClicks = 0;
    state.characterPose = 0;
    state.expression = 0;
    state.lastHit = 0;
    state.poseUntil = 0;
    state.expressionUntil = 0;
    effects.length = 0;
    pendingPoses.length = 0;
    keyTrail.length = 0;
    pointers.clear();
    audio.stopVoices();
    if (audio.context) {
      audio.resetEcho();
      audio.resetClock();
    }
    app.dataset.fever = "false";
    comboNode.textContent = "0";
    updateMeterDisplay();
    closePanels();
    drawScene(playNow());
    drawEffects(playNow());
    showToast("本轮已经重新开始");
  }

  function openPanel(panel) {
    panelReturnFocus = document.activeElement;
    pointers.clear();
    helpPanel.hidden = true;
    settingsPanel.hidden = true;
    panel.hidden = false;
    panel.querySelector(".close-button").focus();
  }

  function closePanels() {
    helpPanel.hidden = true;
    settingsPanel.hidden = true;
    if (panelReturnFocus) panelReturnFocus.focus();
    panelReturnFocus = null;
  }

  function panelsOpen() {
    return !helpPanel.hidden || !settingsPanel.hidden;
  }

  function pointerPosition(event) {
    const rect = effectCanvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(cssWidth, event.clientX - rect.left)),
      y: Math.max(0, Math.min(cssHeight, event.clientY - rect.top))
    };
  }

  function pointerToNote(x, y) {
    return core.gridNote(x, y, cssWidth, cssHeight);
  }

  function toScenePoint(x, y) {
    return {
      x: (x - sceneOffsetX) / sceneScale,
      y: (y - sceneOffsetY) / sceneScale
    };
  }

  function isCornetHit(x, y) {
    if (state.scene !== "room") return false;
    const point = toScenePoint(x, y);
    return point.x > 815 && point.x < 960 && point.y > 395 && point.y < 520;
  }

  startButton.addEventListener("click", startGame);
  resumeButton.addEventListener("click", startGame);
  pauseToggle.addEventListener("click", () => {
    if (state.paused) startGame();
    else pauseGame();
  });

  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "Escape" && panelsOpen()) {
      closePanels();
      return;
    }
    if (event.key === "Tab" && panelsOpen()) {
      const panel = helpPanel.hidden ? settingsPanel : helpPanel;
      const focusable = [...panel.querySelectorAll("button, input, select, a[href]")].filter((node) => !node.disabled);
      const current = focusable.indexOf(document.activeElement);
      const next = event.shiftKey ? (current - 1 + focusable.length) % focusable.length : (current + 1) % focusable.length;
      event.preventDefault();
      focusable[next].focus();
      return;
    }
    if (panelsOpen() || event.target?.matches("input, select, textarea, [contenteditable='true']")) return;
    if (!state.started) {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); startGame(); }
      return;
    }
    if (event.key === "Escape" || event.key === " ") {
      event.preventDefault();
      if (state.paused) startGame();
      else pauseGame();
      return;
    }
    if (state.paused) {
      if (event.key === "Enter") { event.preventDefault(); startGame(); }
      return;
    }

    const key = event.key === ";" ? ";" : event.key.toUpperCase();
    if (!/^[A-Z0-9;]$/.test(key)) return;
    event.preventDefault();
    checkNameSecret(key);
    const index = core.noteForKey(key);
    if (index === null) return;
    hit(index, cssWidth * (0.25 + (index % 4) * 0.16), cssHeight * (0.3 + (index % 3) * 0.16));
  });

  effectCanvas.addEventListener("pointerdown", (event) => {
    if (!state.started || state.paused || panelsOpen() || event.button > 0) return;
    event.preventDefault();
    effectCanvas.setPointerCapture(event.pointerId);
    const point = pointerPosition(event);
    pointers.begin(event.pointerId, point, pointerToNote(point.x, point.y), playNow());
    if (isCornetHit(point.x, point.y)) {
      state.cornetClicks += 1;
      if (state.cornetClicks === 5) {
        state.moyu = Math.min(100, state.moyu + 25);
        updateMeterDisplay();
        showToast("到底从哪边开始吃？");
        if (state.moyu >= 100) triggerFever("巧克力螺旋面包加成！");
      }
    }
    hit(pointerToNote(point.x, point.y), point.x, point.y);
  });

  effectCanvas.addEventListener("pointermove", (event) => {
    if (state.paused || panelsOpen()) return;
    const now = playNow();
    const point = pointerPosition(event);
    const note = pointerToNote(point.x, point.y);
    if (pointers.move(event.pointerId, point, note, now)) {
      hit(note, point.x, point.y, 0.8, { combo: false });
    }
  });

  ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) => {
    effectCanvas.addEventListener(type, (event) => pointers.end(event.pointerId));
  });
  window.addEventListener("blur", () => {
    pointers.clear();
    pauseGame("auto");
  });
  window.addEventListener("focus", () => {
    if (!document.hidden && autoPaused) startGame();
  });

  touchPads.forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      event.preventDefault();
      const rect = button.getBoundingClientRect();
      const appRect = app.getBoundingClientRect();
      hit(Number(button.dataset.note), rect.left - appRect.left + rect.width / 2, rect.top - appRect.top + rect.height / 2);
    });
    button.addEventListener("click", (event) => {
      if (event.detail === 0) hit(Number(button.dataset.note));
    });
  });

  soundToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    state.muted = !state.muted;
    audio.setVolume(state.volume, state.muted);
    soundToggle.setAttribute("aria-pressed", String(!state.muted));
    setIcon(soundToggle, state.muted ? "volume-x" : "volume-2", state.muted ? "取消静音" : "静音");
  });

  beatToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    state.beat = !state.beat;
    audio.setBeat(state.beat);
    beatToggle.setAttribute("aria-pressed", String(state.beat));
    beatToggle.setAttribute("aria-label", state.beat ? "关闭伴奏" : "开启伴奏");
  });

  settingsToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    openPanel(settingsPanel);
  });

  helpToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    openPanel(helpPanel);
  });

  fullscreenToggle.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      if (!document.fullscreenElement) await app.requestFullscreen();
      else await document.exitFullscreen();
    } catch (_) {
      showToast("当前浏览器不支持全屏");
    }
  });

  closeButtons.forEach((button) => button.addEventListener("click", closePanels));
  [helpPanel, settingsPanel].forEach((panel) => {
    panel.addEventListener("click", (event) => {
      if (event.target === panel) closePanels();
    });
  });

  volumeRange.addEventListener("input", () => {
    state.volume = Number(volumeRange.value) / 100;
    volumeOutput.value = `${volumeRange.value}%`;
    writeStored("volume", state.volume);
    audio.setVolume(state.volume, state.muted);
  });

  quantizeToggle.addEventListener("change", () => {
    state.quantize = quantizeToggle.checked;
    writeStored("quantize", state.quantize);
  });

  motionToggle.addEventListener("change", () => {
    state.reduceMotion = motionToggle.checked;
    writeStored("reduce-motion", state.reduceMotion);
    app.classList.toggle("reduce-motion", state.reduceMotion);
    effects.length = 0;
    state.background = 0;
    state.backgroundFrom = 0;
    drawScene(playNow());
    drawEffects(playNow());
  });

  restartButton.addEventListener("click", restartRound);
  padsToggle.addEventListener("change", () => {
    state.pads = padsToggle.checked;
    app.dataset.pads = String(state.pads);
    writeStored("pads", state.pads);
  });
  statsToggle.addEventListener("change", () => {
    state.stats = statsToggle.checked;
    gameStats.hidden = !state.stats;
    writeStored("stats", state.stats);
    if (!state.stats) {
      state.moyu = 0;
      state.feverUntil = 0;
      app.dataset.fever = "false";
      updateMeterDisplay();
    }
  });
  document.querySelectorAll('input[name="scene"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.scene = input.value;
      app.dataset.scene = state.scene;
      writeStored("scene", state.scene);
      resize();
    });
  });
  document.addEventListener("fullscreenchange", () => {
    const full = Boolean(document.fullscreenElement);
    setIcon(fullscreenToggle, full ? "minimize" : "maximize", full ? "退出全屏" : "全屏");
    resize();
  });

  const noteKeys = Object.entries(core.KEY_NOTES).sort((a, b) => a[1] - b[1]);
  for (const [key, note] of noteKeys) {
    const option = document.createElement("option");
    option.value = String(note);
    option.textContent = `${String(note + 1).padStart(2, "0")} · ${key} · ${["鼓组", "低音", "旋律", "合成元音"][groupForNote(note)]}`;
    sampleNote.appendChild(option);
  }
  sampleFile.addEventListener("change", async () => {
    const file = sampleFile.files[0];
    if (!file) return;
    const note = Number(sampleNote.value);
    sampleFile.disabled = true;
    sampleNote.disabled = true;
    sampleClear.disabled = true;
    sampleStatus.textContent = "正在解码…";
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error("Too large");
      await audio.importSample(note, await file.arrayBuffer());
      sampleStatus.textContent = `${audio.samples.size} / 32 已替换 · ${file.name}`;
    } catch (_) {
      sampleStatus.textContent = "导入失败：需要浏览器支持的音频，最大 12 MB / 10 秒";
    } finally {
      sampleFile.disabled = false;
      sampleNote.disabled = false;
      sampleClear.disabled = false;
      sampleFile.value = "";
    }
  });
  sampleClear.addEventListener("click", () => {
    audio.samples.clear();
    sampleStatus.textContent = "内置合成音色 · 0 / 32 已替换";
  });

  function rect(context, x, y, width, height, color) {
    context.fillStyle = color;
    context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
  }

  function pixelStar(context, x, y, size, color, alpha = 1) {
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.translate(Math.round(x), Math.round(y));
    context.rotate(Math.PI / 4);
    context.fillRect(-size / 2, -size / 2, size, size);
    context.rotate(Math.PI / 4);
    context.fillRect(-size / 5, -size, size / 2.5, size * 2);
    context.fillRect(-size, -size / 5, size * 2, size / 2.5);
    context.restore();
  }

  function buildBackground() {
    backgroundCanvas.width = 1280;
    backgroundCanvas.height = 720;
    backgroundCtx.imageSmoothingEnabled = false;
    rect(backgroundCtx, 0, 0, 1280, 720, "#273a52");
    rect(backgroundCtx, 0, 510, 1280, 210, "#26323a");
    for (let x = 0; x < 1280; x += 80) rect(backgroundCtx, x, 510, 4, 210, "#202a31");

    // Window and night city.
    rect(backgroundCtx, 55, 62, 350, 242, "#121c32");
    rect(backgroundCtx, 69, 76, 322, 214, "#162d4b");
    rect(backgroundCtx, 225, 76, 8, 214, "#8da3ad");
    rect(backgroundCtx, 69, 181, 322, 7, "#8da3ad");
    for (let i = 0; i < 18; i += 1) {
      const x = 88 + (i * 71) % 280;
      const y = 96 + (i * 43) % 166;
      rect(backgroundCtx, x, y, 6, 6, i % 3 === 0 ? "#f3bd58" : "#7fbfd0");
    }
    pixelStar(backgroundCtx, 125, 110, 6, "#f7f0d7", 0.8);
    pixelStar(backgroundCtx, 326, 142, 4, "#f7f0d7", 0.65);

    // Manga shelf.
    rect(backgroundCtx, 448, 64, 245, 302, "#4a3845");
    rect(backgroundCtx, 462, 79, 217, 272, "#211f31");
    rect(backgroundCtx, 462, 164, 217, 8, "#654c52");
    rect(backgroundCtx, 462, 253, 217, 8, "#654c52");
    const books = ["#e86aa3", "#39b8d6", "#f3bd58", "#8fcf62", "#f7f0d7"];
    for (let row = 0; row < 3; row += 1) {
      for (let i = 0; i < 9; i += 1) {
        const width = 13 + i % 3 * 3;
        rect(backgroundCtx, 472 + i * 21, 91 + row * 89, width, 62, books[(i + row * 2) % books.length]);
        rect(backgroundCtx, 476 + i * 21, 98 + row * 89, 3, 46, "rgba(31,35,48,.32)");
      }
    }

    // Generic poster.
    rect(backgroundCtx, 724, 63, 180, 222, "#e9dfc6");
    rect(backgroundCtx, 736, 75, 156, 198, "#6cb5bd");
    rect(backgroundCtx, 755, 96, 118, 80, "#20405a");
    rect(backgroundCtx, 777, 121, 76, 126, "#e86aa3");
    rect(backgroundCtx, 802, 102, 30, 32, "#f7d9c0");

    // Desk, monitor and keyboard.
    rect(backgroundCtx, 704, 413, 512, 34, "#76534b");
    rect(backgroundCtx, 732, 447, 38, 218, "#493c3c");
    rect(backgroundCtx, 1148, 447, 38, 218, "#493c3c");
    rect(backgroundCtx, 945, 250, 238, 151, "#17202f");
    rect(backgroundCtx, 958, 263, 212, 124, "#173e4e");
    rect(backgroundCtx, 972, 276, 184, 96, "#39b8d6");
    rect(backgroundCtx, 986, 290, 156, 68, "#19283c");
    for (let i = 0; i < 7; i += 1) rect(backgroundCtx, 998 + i * 20, 305 + i % 3 * 12, 12, 6, books[i % books.length]);
    rect(backgroundCtx, 1047, 401, 34, 16, "#30394b");
    rect(backgroundCtx, 1018, 416, 92, 9, "#30394b");
    rect(backgroundCtx, 1000, 452, 173, 39, "#293143");
    for (let i = 0; i < 12; i += 1) rect(backgroundCtx, 1012 + i % 6 * 25, 461 + Math.floor(i / 6) * 15, 16, 7, i % 4 === 0 ? "#8fcf62" : "#69778a");

    // Chair and controller.
    rect(backgroundCtx, 788, 425, 100, 146, "#334058");
    rect(backgroundCtx, 806, 555, 62, 28, "#202a3c");
    rect(backgroundCtx, 833, 578, 8, 67, "#202a3c");
    rect(backgroundCtx, 791, 639, 92, 10, "#202a3c");
    rect(backgroundCtx, 785, 646, 18, 18, "#131b29");
    rect(backgroundCtx, 871, 646, 18, 18, "#131b29");
    rect(backgroundCtx, 575, 570, 142, 70, "#1b2637");
    rect(backgroundCtx, 598, 586, 96, 35, "#5c6a79");
    rect(backgroundCtx, 611, 598, 28, 8, "#202a3a");
    rect(backgroundCtx, 621, 588, 8, 28, "#202a3a");
    rect(backgroundCtx, 665, 594, 10, 10, "#e86aa3");
    rect(backgroundCtx, 679, 603, 10, 10, "#8fcf62");
  }

  function drawKonata(context, time) {
    const activePose = time < state.poseUntil ? state.characterPose : 0;
    const expression = time < state.expressionUntil ? state.expression : 0;
    const fever = time < state.feverUntil;
    const reduced = state.reduceMotion;
    const bob = reduced ? 0 : Math.sin(time * 0.008) * (2 + state.scenePulse * 4);
    const lean = activePose === 2 ? -6 : activePose === 3 ? 4 : 0;
    const blink = Math.floor(time / 2600) % 9 === 0;
    const hair = fever ? "#59d4e7" : "#438ebd";
    const hairDark = fever ? "#287e9d" : "#2b5f8c";
    const skin = "#f2cfb5";
    const x = 742 + lean;
    const y = 230 + bob;

    rect(context, x + 18, y + 46, 124, 285, hairDark);
    rect(context, x + 6, y + 75, 32, 236, hairDark);
    rect(context, x + 128, y + 87, 31, 228, hairDark);
    rect(context, x + 23, y + 309, 26, 42, hairDark);
    rect(context, x + 119, y + 309, 26, 42, hairDark);
    rect(context, x + 87, y - 27, 8, 34, hairDark);
    rect(context, x + 94, y - 34, 26, 8, hairDark);
    rect(context, x + 113, y - 27, 8, 19, hairDark);

    rect(context, x + 34, y + 6, 97, 31, hairDark);
    rect(context, x + 20, y + 28, 126, 75, hair);
    rect(context, x + 32, y + 51, 102, 78, skin);
    rect(context, x + 20, y + 55, 24, 126, hair);
    rect(context, x + 124, y + 50, 24, 137, hair);
    rect(context, x + 45, y + 38, 18, 22, hair);
    rect(context, x + 68, y + 34, 18, 27, hair);
    rect(context, x + 94, y + 37, 19, 22, hair);

    if (blink || expression === 3) {
      rect(context, x + 53, y + 84, 22, 4, "#413541");
      rect(context, x + 98, y + 84, 22, 4, "#413541");
    } else {
      rect(context, x + 54, y + 77, 19, 21, "#f8f4df");
      rect(context, x + 99, y + 77, 19, 21, "#f8f4df");
      rect(context, x + 61, y + 81, 8, 15, "#6eae62");
      rect(context, x + 102, y + 81, 8, 15, "#6eae62");
    }

    if (expression === 1 || activePose === 4) {
      rect(context, x + 78, y + 111, 22, 7, "#a75e68");
      rect(context, x + 84, y + 118, 10, 5, "#6f3f4d");
    } else if (expression === 2) {
      rect(context, x + 79, y + 111, 20, 4, "#79535a");
      rect(context, x + 87, y + 108, 4, 9, "#79535a");
    } else {
      rect(context, x + 78, y + 110, 24, 5, "#79535a");
      rect(context, x + 95, y + 106, 5, 5, "#79535a");
    }

    rect(context, x + 46, y + 133, 83, 119, "#e8e3cf");
    rect(context, x + 48, y + 136, 79, 24, "#36588b");
    rect(context, x + 76, y + 153, 24, 52, "#cf4b59");
    rect(context, x + 52, y + 223, 72, 37, "#36588b");

    if (activePose === 1) {
      rect(context, x + 31, y + 143, 22, 72, "#e8e3cf");
      rect(context, x + 20, y + 205, 35, 18, skin);
      rect(context, x + 120, y + 139, 22, 78, "#e8e3cf");
      rect(context, x + 125, y + 207, 35, 18, skin);
    } else if (activePose === 3) {
      rect(context, x + 28, y + 143, 22, 86, "#e8e3cf");
      rect(context, x + 18, y + 221, 36, 18, skin);
      rect(context, x + 121, y + 128, 22, 72, "#e8e3cf");
      rect(context, x + 128, y + 113, 18, 35, skin);
    } else if (activePose === 4) {
      rect(context, x + 38, y + 141, 22, 84, "#e8e3cf");
      rect(context, x + 28, y + 217, 34, 18, skin);
      rect(context, x + 118, y + 142, 22, 82, "#e8e3cf");
      rect(context, x + 131, y + 128, 17, 43, skin);
    } else {
      rect(context, x + 40, y + 142, 22, 86, "#e8e3cf");
      rect(context, x + 116, y + 142, 22, 87, "#e8e3cf");
      rect(context, x + 42, y + 229, 23, 18, skin);
      rect(context, x + 119, y + 225, 49, 19, skin);
      rect(context, x + 160, y + 219, 16, 26, skin);
    }

    rect(context, x + 63, y + 252, 30, 104, skin);
    rect(context, x + 99, y + 252, 30, 90, skin);
    rect(context, x + 59, y + 341, 38, 20, "#654f69");
    rect(context, x + 96, y + 329, 38, 20, "#654f69");
  }

  function drawCornet(context) {
    rect(context, 881, 450, 69, 6, "#d8c8ae");
    context.fillStyle = "#ba8650";
    context.beginPath();
    context.moveTo(883, 448);
    context.lineTo(943, 448);
    context.lineTo(917, 405);
    context.closePath();
    context.fill();
    for (let i = 0; i < 4; i += 1) rect(context, 910 - i * 5, 411 + i * 10, 15 + i * 8, 4, "#86512f");
    rect(context, 910, 403, 13, 7, "#3a251e");
  }

  function drawScene(time) {
    sceneCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state.scene === "stage") {
      const transition = state.reduceMotion ? 1 : core.clamp((time - state.backgroundAt) / 600, 0, 1);
      sceneCtx.fillStyle = BACKGROUNDS[state.backgroundFrom];
      sceneCtx.fillRect(0, 0, cssWidth, cssHeight);
      sceneCtx.globalAlpha = transition;
      sceneCtx.fillStyle = BACKGROUNDS[state.background];
      sceneCtx.fillRect(0, 0, cssWidth, cssHeight);
      sceneCtx.globalAlpha = 1;
      // Keep the character as a small signature, leaving the entire stage to the performance.
      const scale = Math.min(0.48, cssWidth / 700, Math.max(0.1, (cssHeight - 130) / 440));
      const baseline = cssHeight - (state.pads && state.started ? 130 : 22);
      sceneCtx.save();
      sceneCtx.translate(cssWidth - 20 - 918 * scale, baseline - 600 * scale);
      sceneCtx.scale(scale, scale);
      drawKonata(sceneCtx, time);
      sceneCtx.restore();
      return;
    }
    sceneCtx.fillStyle = "#273a52";
    sceneCtx.fillRect(0, 0, cssWidth, cssHeight);
    sceneCtx.drawImage(backgroundCanvas, sceneOffsetX, sceneOffsetY, 1280 * sceneScale, 720 * sceneScale);

    sceneCtx.save();
    sceneCtx.translate(sceneOffsetX, sceneOffsetY);
    sceneCtx.scale(sceneScale, sceneScale);

    const fever = time < state.feverUntil;
    const otaku = time < state.otakuUntil;
    if (fever) {
      sceneCtx.fillStyle = "rgba(232,106,163,0.09)";
      sceneCtx.fillRect(0, 0, 1280, 720);
      rect(sceneCtx, 972, 276, 184, 96, "#39b8d6");
    }

    drawKonata(sceneCtx, time);
    drawCornet(sceneCtx);

    if (otaku || fever) {
      const count = state.reduceMotion ? 4 : 9;
      for (let i = 0; i < count; i += 1) {
        const angle = (state.reduceMotion ? 0 : time * 0.001) + i * 0.7;
        pixelStar(sceneCtx, 770 + Math.cos(angle) * (160 + i * 5), 310 + Math.sin(angle) * 95, 5 + i % 3 * 3, COLORS[i % COLORS.length], 0.8);
      }
    }
    sceneCtx.restore();
  }

  function drawEffects(now) {
    effectCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    effectCtx.clearRect(0, 0, cssWidth, cssHeight);

    for (let i = effects.length - 1; i >= 0; i -= 1) {
      const effect = effects[i];
      const p = (now - effect.startAt) / effect.duration;
      if (p < 0) continue;
      if (p >= 1) {
        effects.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - p, 3);
      const release = p < 0.55 ? 1 : Math.pow((1 - p) / 0.45, 2);
      const size = effect.size;
      effectCtx.save();
      effectCtx.globalAlpha = Math.min(1, p / 0.045) * release * (state.scene === "room" ? 0.85 : 1);
      effectCtx.translate(effect.x, effect.y);
      effectCtx.strokeStyle = effect.color;
      effectCtx.fillStyle = effect.color;
      effectCtx.lineWidth = Math.max(3, size * 0.025);
      effectCtx.lineCap = "round";
      if (state.reduceMotion) {
        effectCtx.globalAlpha = (1 - p) * 0.65;
        effectCtx.beginPath();
        effectCtx.arc(0, 0, Math.min(44, size * 0.3), 0, Math.PI * 2);
        effectCtx.stroke();
        effectCtx.restore();
        continue;
      }
      const turn = effect.rotation;
      if (effect.kind === "ring" || effect.kind === "disc") {
        const radius = size * (0.15 + e * 1.35);
        effectCtx.lineWidth = Math.max(3, size * 0.09 * (1 - e));
        effectCtx.beginPath();
        effectCtx.arc(0, 0, radius, 0, Math.PI * 2);
        if (effect.kind === "disc") effectCtx.fill();
        else effectCtx.stroke();
        effectCtx.globalAlpha *= 0.4;
        effectCtx.beginPath();
        effectCtx.arc(0, 0, radius * 0.72, 0, Math.PI * 2);
        effectCtx.stroke();
      } else if (effect.kind === "tiles" || effect.kind === "burst") {
        for (let n = 0; n < 16; n += 1) {
          const a = n * Math.PI / 8 + turn;
          const spread = size * e * (n % 2 ? 1.35 : 0.7);
          const s = size * 0.085 * Math.sin(Math.PI * p);
          effectCtx.save();
          effectCtx.translate(Math.cos(a) * spread, Math.sin(a) * spread);
          effectCtx.rotate(a + e * 1.4);
          if (effect.kind === "tiles") effectCtx.fillRect(-s, -s, s * 2, s * 2);
          else {
            effectCtx.beginPath();
            for (let point = 0; point < 8; point += 1) {
              const angle = point * Math.PI / 4;
              const r = point % 2 ? s * 0.35 : s;
              effectCtx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
            }
            effectCtx.closePath();
            effectCtx.fill();
          }
          effectCtx.restore();
        }
      } else if (effect.kind === "ribbon" || effect.kind === "zigzag") {
        effectCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const span = cssWidth * e;
        for (let line = 0; line < 3; line += 1) {
          effectCtx.beginPath();
          for (let n = 0; n <= 32; n += 1) {
            const x = n / 32 * span;
            const wave = effect.kind === "ribbon" ? Math.sin(n / 32 * Math.PI * 4 + turn) : (n % 4 < 2 ? -1 : 1);
            const y = cssHeight / 2 + wave * size * 0.42 + (line - 1) * size * 0.12;
            if (n === 0) effectCtx.moveTo(x, y);
            else effectCtx.lineTo(x, y);
          }
          effectCtx.stroke();
        }
      } else if (effect.kind === "spiral" || effect.kind === "orbit") {
        const count = effect.kind === "spiral" ? 28 : 8;
        for (let n = 0; n < count; n += 1) {
          const a = n * Math.PI * 2 / count + e * 2.8 + turn;
          const r = size * e * (effect.kind === "spiral" ? n / count : 0.85);
          effectCtx.beginPath();
          effectCtx.arc(Math.cos(a) * r, Math.sin(a) * r, size * (0.015 + n / count * 0.055) * release, 0, Math.PI * 2);
          effectCtx.fill();
        }
      } else if (effect.kind === "bars" || effect.kind === "curtain") {
        effectCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const vertical = effect.kind === "curtain";
        const count = 7;
        for (let n = 0; n < count; n += 1) {
          const phase = core.clamp((p - n * 0.025) * 2.8, 0, 1);
          const reach = Math.sin(Math.PI * phase);
          if (vertical) effectCtx.fillRect(n * cssWidth / count, 0, cssWidth / count * 0.44, cssHeight * reach);
          else effectCtx.fillRect(0, n * cssHeight / count, cssWidth * reach, cssHeight / count * 0.36);
        }
      } else if (effect.kind === "polygon") {
        effectCtx.rotate(turn + e * 1.3);
        effectCtx.beginPath();
        const points = 3 + effect.index % 5;
        for (let point = 0; point <= points; point += 1) {
          const a = point * Math.PI * 2 / points;
          const r = size * (0.15 + e) * (1 + 0.18 * Math.sin(point * 2 + p * 5));
          if (point === 0) effectCtx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          else effectCtx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        effectCtx.closePath();
        effectCtx.stroke();
      } else if (effect.kind === "cross" || effect.kind === "slash") {
        effectCtx.rotate(turn + (effect.kind === "cross" ? e * 2 : Math.PI / 4));
        const length = size * e * 2.2;
        const width = size * 0.08 * release;
        effectCtx.fillRect(-length / 2, -width / 2, length, width);
        if (effect.kind === "cross") effectCtx.fillRect(-width / 2, -length / 2, width, length);
      } else if (effect.kind === "fan") {
        effectCtx.rotate(turn + e * 1.5);
        for (let n = 0; n < 6; n += 1) {
          const start = n * Math.PI / 3;
          effectCtx.beginPath();
          effectCtx.moveTo(0, 0);
          effectCtx.arc(0, 0, size * e, start, start + Math.PI / 7);
          effectCtx.closePath();
          effectCtx.fill();
        }
      } else if (effect.kind === "brackets") {
        const r = size * (0.3 + e * 0.7);
        for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          effectCtx.beginPath();
          effectCtx.moveTo(dx * (r - size * 0.2), dy * r);
          effectCtx.lineTo(dx * r, dy * r);
          effectCtx.lineTo(dx * r, dy * (r - size * 0.2));
          effectCtx.stroke();
        }
      } else if (effect.kind === "speech") {
        effectCtx.rotate(Math.sin(p * Math.PI) * 0.06);
        const scale = 0.65 + Math.sin(Math.min(1, p * 2) * Math.PI / 2) * 0.35;
        effectCtx.scale(scale, scale);
        const width = Math.min(size * 1.8, cssWidth * 0.75);
        const height = size * 0.8;
        effectCtx.fillStyle = "#ffffff";
        effectCtx.fillRect(-width / 2, -height / 2, width, height);
        effectCtx.strokeRect(-width / 2, -height / 2, width, height);
        effectCtx.fillStyle = effect.color;
        effectCtx.font = `700 ${Math.min(width / 3, height * 0.65)}px Consolas, monospace`;
        effectCtx.textAlign = "center";
        effectCtx.textBaseline = "middle";
        effectCtx.fillText(effect.label, 0, 0);
      }
      effectCtx.restore();
    }
  }

  function frame(now) {
    animationId = null;
    if (document.hidden) return;
    const delta = Math.min(34, now - lastFrame);
    lastFrame = now;
    now = playNow();
    if (state.paused) {
      drawScene(now);
      drawEffects(now);
      return;
    }
    while (pendingPoses.length && pendingPoses[0].at <= now) {
      const pose = pendingPoses.shift();
      setCharacter(groupForNote(pose.index), pose.index);
      state.scenePulse = Math.min(1, state.scenePulse + 0.15);
    }

    if (state.combo && now - state.lastHit > 1100) {
      state.combo = 0;
      comboNode.textContent = "0";
    }

    if (state.started && now > state.feverUntil && state.moyu > 0) {
      if (app.dataset.fever === "true") {
        app.dataset.fever = "false";
        state.moyu = 26;
        showToast("高能结束，继续摸鱼");
      } else if (now - state.lastHit > 1300) {
        state.moyu = Math.max(0, state.moyu - delta * 0.0011);
      }
      updateMeterDisplay();
    }

    state.scenePulse *= Math.pow(0.005, delta / 1000);
    drawScene(now);
    drawEffects(now);
    animationId = requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pauseGame("auto");
      if (animationId !== null) cancelAnimationFrame(animationId);
      animationId = null;
    } else {
      if (autoPaused) {
        startGame();
      } else if (animationId === null) animationId = requestAnimationFrame(frame);
    }
  });
  window.addEventListener("pagehide", (event) => {
    pointers.clear();
    pauseGame("auto");
    if (animationId !== null) cancelAnimationFrame(animationId);
    animationId = null;
    if (!event.persisted) audio.destroy();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      if (autoPaused) startGame();
      else if (animationId === null) animationId = requestAnimationFrame(frame);
    }
  });

  buildBackground();
  resize();
  updateMeterDisplay();
  animationId = requestAnimationFrame(frame);
})();
