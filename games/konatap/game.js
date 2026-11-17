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
  const sampleMode = $("sample-mode");
  const sampleVocal = $("sample-vocal");
  const sampleSliceSettings = $("sample-slice-settings");
  const sampleStart = $("sample-start");
  const sampleBeats = $("sample-beats");
  const sampleRoot = $("sample-root");
  const sampleBank = $("sample-bank");
  const samplePreview = $("sample-preview");
  const toast = $("toast");
  const touchPads = [...document.querySelectorAll("[data-note]")];
  const closeButtons = [...document.querySelectorAll("[data-close-panel]")];

  const STORAGE_PREFIX = "konatap-v2-";
  const COLORS = ["#d85289", "#dda12f", "#419e70", "#249dac", "#736cc0", "#ed795c"];
  const BACKGROUNDS = ["#81cab1", "#e794b2", "#78bdb8", "#e3c26c", "#aba2d5", "#86b8d7"];
  const KINDS = ["ring", "tiles", "aperture", "spiral", "burst", "bars", "polygon", "disc",
    "cross", "orbit", "facets", "curtain", "fan", "brackets", "slash", "speech"];
  const EFFECT_TAIL = 90;
  const effects = [];
  const effectHistory = new Map();
  const cellFlashes = new Map();
  const pendingPoses = [];
  const pointers = core.createPointers();
  const keyTrail = [];
  const characterFrames = new Map();
  const CHARACTER_POSES = ["idle", "drum", "bass", "melody", "vocal", "blink"];

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
  let lastFrame = performance.now();
  let pausedAt = 0;
  let pausedDuration = 0;
  let animationId = null;
  let resumeInFlight = false;
  let panelReturnFocus = null;
  let autoPaused = false;
  let pauseTask = Promise.resolve();
  let startRevision = 0;
  let roomLayout = null;

  const playNow = () => (state.paused ? pausedAt : performance.now()) - pausedDuration;
  const roomScene = window.KonatapRoom ? new window.KonatapRoom.RoomScene(core, audio, () => {
    if (cssWidth > 0) resize();
  }) : null;

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
    resizeCanvas(sceneCanvas, sceneCtx);
    resizeCanvas(effectCanvas, effectCtx);
    roomLayout = roomScene?.layout(cssWidth, cssHeight, state) || null;
    app.dataset.roomReady = String(Boolean(roomScene?.ready(roomLayout)));
    if (roomLayout) {
      const center = roomScene.center(roomLayout);
      app.style.setProperty?.("--room-screen-x", `${center.x}px`);
      app.style.setProperty?.("--room-screen-y", `${center.y}px`);
    }
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
    const now = playNow();
    const kind = KINDS[index % KINDS.length];
    const isAccent = kind === "aperture" || kind === "facets";
    let retained = false;
    for (let i = effects.length - 1; i >= 0; i -= 1) {
      const old = effects[i];
      if (now >= old.startAt + old.duration || now >= (old.retireAt ?? Infinity) + EFFECT_TAIL) {
        effects.splice(i, 1);
      } else if (state.reduceMotion || old.index === index || isAccent && (old.kind === "aperture" || old.kind === "facets")) {
        // The bold replacements share one visual lane, with one short outgoing tail.
        if (!retained && !state.reduceMotion && old.startAt <= now && old.startAt < startAt) {
          old.retireAt = Math.min(old.retireAt ?? Infinity, startAt);
          retained = true;
        } else effects.splice(i, 1);
      }
    }
    if (effects.length >= 32) effects.shift();
    const last = effectHistory.get(index);
    const variant = last === undefined ? Math.floor(Math.random() * 3)
      : (last + 1 + Math.floor(Math.random() * 2)) % 3;
    effectHistory.set(index, variant);
    const count = 7 + variant * 4 + Math.floor(Math.random() * 4);
    effects.push({
      kind, index, variant, startAt,
      xRatio: 0.5, yRatio: 0.5,
      color: COLORS[index % COLORS.length],
      duration: state.reduceMotion ? 360 : 620 + Math.random() * (isAccent ? 200 : 330),
      sizeRatio: (0.28 + index % 3 * 0.055) * strength * (0.86 + Math.random() * 0.28),
      rotation: isAccent ? Math.floor(Math.random() * 8) * Math.PI / 4 : Math.random() * Math.PI * 2,
      direction: Math.random() < 0.5 ? -1 : 1,
      phase: Math.random() * Math.PI * 2,
      thickness: 0.7 + Math.random() * 0.6,
      stripes: 4 + Math.floor(Math.random() * 5),
      points: 3 + Math.floor(Math.random() * 5),
      count,
      particles: Array.from({ length: count }, (_, n) => ({
        angle: n * Math.PI * 2 / count + (Math.random() - 0.5) * 0.3,
        reach: 0.55 + Math.random() * 0.9,
        scale: 0.65 + Math.random() * 0.8
      })),
      label: ["!", "GAME", "?", "ZZZ"][(index + variant) % 4]
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
    if (!Number.isInteger(index) || index < 0 || index >= 32) return;
    if (!state.started || state.paused || !audio.context || audio.context.state !== "running") return;
    const dragging = options.pointerId !== undefined;
    const control = dragging || options.control === "mouse" ? "mouse" : "keyboard";
    roomScene?.noteInput(index, control);
    let visualAt = playNow();
    if (dragging) {
      audio.queueDrag(index, velocity, options.pointerId);
    } else {
      const when = audio.scheduleTime(state.quantize);
      visualAt += (when - audio.context.currentTime) * 1000;
      const scheduled = audio.play(index, velocity, when);
      roomScene?.noteInput(index, control, scheduled);
    }
    cellFlashes.set(index, { startAt: visualAt, duration: state.reduceMotion ? 250 : 500,
      opacity: state.reduceMotion ? 0.25 : 0.7 });
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
      refreshSampleLabels();
      if (!audio.samples.size) resetSampleStatus();
      if (audio.bankError) {
        showToast("音节采样未载入，已使用备用元音");
      } else if (audio.trialError) {
        showToast("原声采样库未载入，已保留原内置音色");
      }
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
    roomScene?.reset();
    for (const [note, flash] of cellFlashes) {
      if (flash.startAt > playNow()) cellFlashes.delete(note);
    }
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
    effectHistory.clear();
    cellFlashes.clear();
    pendingPoses.length = 0;
    roomScene?.reset();
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
    audio.cancelDrags();
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

  function isCornetHit(x, y) {
    return state.scene === "room" && roomScene?.ready(roomLayout)
      && roomScene.cornetHit(roomLayout, x, y);
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
    const note = pointerToNote(point.x, point.y);
    audio.cancelDrags(event.pointerId);
    pointers.begin(event.pointerId, note);
    if (isCornetHit(point.x, point.y)) {
      state.cornetClicks += 1;
      if (state.cornetClicks === 5) {
        state.moyu = Math.min(100, state.moyu + 25);
        updateMeterDisplay();
        showToast("到底从哪边开始吃？");
        if (state.moyu >= 100) triggerFever("巧克力螺旋面包加成！");
      }
    }
    hit(note, point.x, point.y, 1, { control: "mouse" });
  });

  effectCanvas.addEventListener("pointermove", (event) => {
    if (state.paused || panelsOpen()) return;
    const point = pointerPosition(event);
    const note = pointerToNote(point.x, point.y);
    if (pointers.move(event.pointerId, note)) {
      hit(note, point.x, point.y, 0.8, { combo: false, pointerId: event.pointerId });
    }
  });

  effectCanvas.addEventListener("pointerup", (event) => pointers.end(event.pointerId));
  ["pointercancel", "lostpointercapture"].forEach((type) => {
    effectCanvas.addEventListener(type, (event) => {
      // Normal release also loses capture; keep its last queued note.
      if (pointers.active.has(event.pointerId)) audio.cancelDrags(event.pointerId);
      pointers.end(event.pointerId);
    });
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
    if (state.muted) roomScene?.reset();
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
    cellFlashes.clear();
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
    resize();
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
      roomScene?.reset();
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
  const noteOptions = new Map();
  function defaultNoteLabel(note) {
    return ["短音节", "低音", "音节旋律", "元音"][groupForNote(note)];
  }
  function refreshSampleLabels() {
    for (const [key, note] of noteKeys) {
      const label = audio.trials.get(note)?.label || defaultNoteLabel(note);
      noteOptions.get(note).textContent = `${String(note + 1).padStart(2, "0")} · ${key} · ${label}`;
    }
    document.querySelectorAll("[data-note]").forEach(pad => {
      const note = Number(pad.dataset.note);
      pad.setAttribute("aria-label", audio.trials.get(note)?.label || defaultNoteLabel(note));
    });
  }
  function resetSampleStatus() {
    const fallback = audio.bankError ? "元音备用音色" : "日语合成女声";
    const label = audio.trials.size ? `${audio.trials.size} 位原声采样${audio.bankError && audio.trials.size < 30 ? " · 其余备用元音" : ""}` : fallback;
    sampleStatus.textContent = `${label} · ${audio.samples.size} / 32 本地替换`;
  }
  for (const [key, note] of noteKeys) {
    const option = document.createElement("option");
    option.value = String(note);
    option.textContent = `${String(note + 1).padStart(2, "0")} · ${key} · ${defaultNoteLabel(note)}`;
    sampleNote.appendChild(option);
    noteOptions.set(note, option);
  }
  sampleMode.addEventListener("change", () => {
    sampleSliceSettings.hidden = !sampleVocal.checked;
  });
  const pitchNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  for (let midi = 60; midi <= 84; midi += 1) {
    const option = document.createElement("option");
    option.value = String(midi);
    option.textContent = `${pitchNames[midi % 12]}${Math.floor(midi / 12) - 1}`;
    option.selected = midi === 72;
    sampleRoot.appendChild(option);
  }
  samplePreview.addEventListener("click", async () => {
    await startGame();
    hit(Number(sampleNote.value), undefined, undefined, 1, { combo: false, meter: false });
  });
  sampleFile.addEventListener("change", async () => {
    const file = sampleFile.files[0];
    if (!file) return;
    const note = Number(sampleNote.value);
    sampleFile.disabled = true;
    sampleNote.disabled = true;
    sampleClear.disabled = true;
    samplePreview.disabled = true;
    sampleMode.disabled = true;
    for (const control of [sampleStart, sampleBeats, sampleRoot, sampleBank]) control.disabled = true;
    sampleStatus.textContent = "正在解码…";
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error("Too large");
      const options = sampleVocal.checked ? {
        mode: "vocal", start: Number(sampleStart.value), beats: Number(sampleBeats.value),
        root: Number(sampleRoot.value), bank: sampleBank.checked
      } : {};
      await audio.importSample(note, await file.arrayBuffer(), options);
      const mode = options.mode === "vocal" ? "节拍人声" : "原样";
      if (options.bank) sampleNote.value = String(core.VOCAL_NOTES[0]);
      sampleStatus.textContent = `${audio.samples.size} / 32 已替换 · ${mode} · ${file.name}`;
    } catch (_) {
      sampleStatus.textContent = "导入失败：检查片段起点与音频格式，最大 12 MB / 10 秒";
    } finally {
      sampleFile.disabled = false;
      sampleNote.disabled = false;
      sampleClear.disabled = false;
      samplePreview.disabled = false;
      sampleMode.disabled = false;
      for (const control of [sampleStart, sampleBeats, sampleRoot, sampleBank]) control.disabled = false;
      sampleFile.value = "";
    }
  });
  sampleClear.addEventListener("click", () => {
    audio.samples.clear();
    resetSampleStatus();
  });

  function rect(context, x, y, width, height, color) {
    context.fillStyle = color;
    context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
  }

  function loadCharacter() {
    if (!window.Image) return;
    for (const name of CHARACTER_POSES) {
      const image = new window.Image();
      image.onload = () => {
        if (image.naturalWidth !== 512 || image.naturalHeight !== 512) return;
        characterFrames.set(name, image);
        if (cssWidth > 0) drawScene(playNow());
      };
      image.src = `assets/character/konata-${name}.webp`;
    }
  }

  function drawKonata(context, time) {
    const pose = time < state.poseUntil ? state.characterPose : 0;
    const blink = !pose && time % 3600 < 120;
    const name = CHARACTER_POSES[blink ? 5 : pose];
    const image = characterFrames.get(name) || characterFrames.get("idle");
    if (!image) {
      drawPixelKonata(context, time);
      return;
    }
    const beat = audio.context && state.started && state.beat && !state.reduceMotion
      ? Math.max(0, audio.context.currentTime - audio.origin) / (window.KonatapAudio.STEP * 4) : 0;
    const pulse = state.reduceMotion || !state.started || !state.beat ? 0 : Math.pow(1 - beat % 1, 3);
    const bob = state.reduceMotion ? 0 : -pulse * 5 - state.scenePulse * 3 + Math.sin(time * 0.004) * 1.5;
    const size = 420;
    const baseline = 600;
    context.save();
    context.imageSmoothingEnabled = true;
    context.translate(840, baseline + bob);
    context.scale(1 + pulse * 0.018, 1 - pulse * 0.014);
    context.drawImage(image, -size / 2, -470 / 512 * size, size, size);
    context.restore();
  }

  function drawPixelKonata(context, time) {
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

  function drawScene(time) {
    sceneCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state.scene === "room" && roomScene?.ready(roomLayout)) {
      sceneCtx.fillStyle = "#535168";
      sceneCtx.fillRect(0, 0, cssWidth, cssHeight);
      roomScene.drawBase(sceneCtx, roomLayout, state, time);
      return;
    }
    {
      const transition = state.reduceMotion ? 1 : core.clamp((time - state.backgroundAt) / 600, 0, 1);
      sceneCtx.fillStyle = BACKGROUNDS[state.backgroundFrom];
      sceneCtx.fillRect(0, 0, cssWidth, cssHeight);
      sceneCtx.globalAlpha = transition;
      sceneCtx.fillStyle = BACKGROUNDS[state.background];
      sceneCtx.fillRect(0, 0, cssWidth, cssHeight);
      sceneCtx.globalAlpha = 1;
      // Keep the character as a small signature, leaving the entire stage to the performance.
      const scale = Math.min(state.started ? 0.48 : 0.62, cssWidth / 700, Math.max(0.1, (cssHeight - 130) / 440));
      const baseline = cssHeight - (state.pads && state.started ? 130 : 22);
      sceneCtx.save();
      sceneCtx.translate(cssWidth - 20 - 980 * scale, baseline - 600 * scale);
      sceneCtx.scale(scale, scale);
      drawKonata(sceneCtx, time);
      sceneCtx.restore();
      return;
    }
  }

  function drawEffects(now) {
    effectCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    effectCtx.clearRect(0, 0, cssWidth, cssHeight);
    if (state.scene === "room" && roomScene?.ready(roomLayout)) {
      roomScene.drawOverlay(effectCtx, roomLayout, state, now, BACKGROUNDS,
        (context, width, height) => paintEffects(now, context, width, height));
    } else {
      paintEffects(now, effectCtx, cssWidth, cssHeight);
    }
  }

  function paintEffects(now, effectCtx, width, height) {
    effectCtx.save();
    effectCtx.fillStyle = "#ffffff";
    for (const [note, flash] of cellFlashes) {
      const progress = (now - flash.startAt) / flash.duration;
      if (progress < 0) continue;
      if (progress >= 1) {
        cellFlashes.delete(note);
        continue;
      }
      const cell = core.gridRect(note, cssWidth, cssHeight);
      effectCtx.globalAlpha = flash.opacity * (1 - progress);
      if (width === cssWidth && height === cssHeight) {
        effectCtx.fillRect(cell.x, cell.y, cell.width, cell.height);
      } else {
        effectCtx.fillRect(cell.x / cssWidth * width, cell.y / cssHeight * height,
          cell.width / cssWidth * width, cell.height / cssHeight * height);
      }
    }
    effectCtx.restore();

    for (let i = effects.length - 1; i >= 0; i -= 1) {
      const effect = effects[i];
      if (now >= effect.startAt + effect.duration || now >= (effect.retireAt ?? Infinity) + EFFECT_TAIL) {
        effects.splice(i, 1);
      }
    }
    // Older tails stay behind the newest shape instead of painting over it.
    for (const effect of effects) {
      const p = (now - effect.startAt) / effect.duration;
      if (p < 0) continue;
      const tail = 1 - core.clamp((now - (effect.retireAt ?? now)) / EFFECT_TAIL, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      const release = p < 0.55 ? 1 : Math.pow((1 - p) / 0.45, 2);
      const size = Math.min(width, height) * effect.sizeRatio;
      const variant = effect.variant;
      const direction = effect.direction;
      effectCtx.save();
      effectCtx.globalAlpha = Math.min(1, p / 0.045) * release * tail;
      effectCtx.translate(width / 2, height / 2);
      effectCtx.strokeStyle = effect.color;
      effectCtx.fillStyle = effect.color;
      effectCtx.lineWidth = Math.max(3, size * 0.025 * effect.thickness);
      effectCtx.lineCap = "round";
      if (state.reduceMotion) {
        effectCtx.globalAlpha = (1 - p) * 0.65 * tail;
        effectCtx.beginPath();
        effectCtx.arc(0, 0, Math.min(44, size * 0.3), 0, Math.PI * 2);
        effectCtx.stroke();
        effectCtx.restore();
        continue;
      }
      const turn = effect.rotation;
      if (effect.kind === "ring" || effect.kind === "disc") {
        const radius = size * (0.15 + e * 1.35);
        effectCtx.lineWidth = Math.max(3, size * 0.09 * effect.thickness * (1 - e));
        if (effect.kind === "disc") {
          if (variant === 1) {
            effectCtx.lineWidth = radius * 0.3;
            effectCtx.beginPath();
            effectCtx.arc(0, 0, radius * 0.85, 0, Math.PI * 2);
            effectCtx.stroke();
          } else {
            effectCtx.beginPath();
            effectCtx.arc(0, 0, radius * (variant === 2 ? 0.6 : 1), 0, Math.PI * 2);
            effectCtx.fill();
            if (variant === 2) {
              for (let n = 0; n < effect.points; n++) {
                const a = turn + n * Math.PI * 2 / effect.points;
                effectCtx.beginPath();
                effectCtx.arc(Math.cos(a) * radius, Math.sin(a) * radius, radius * 0.12, 0, Math.PI * 2);
                effectCtx.fill();
              }
            }
          }
        } else {
          const rings = variant === 1 ? 3 : 1;
          for (let n = 0; n < rings; n++) {
            const r = radius * (1 - n * 0.22);
            if (variant === 2) {
              const segment = Math.PI * 2 / effect.points;
              for (let part = 0; part < effect.points; part++) {
                const a = turn + part * segment + direction * e;
                effectCtx.beginPath();
                effectCtx.arc(0, 0, r, a, a + segment * 0.65);
                effectCtx.stroke();
              }
            } else {
              effectCtx.beginPath();
              effectCtx.arc(0, 0, r, 0, Math.PI * 2);
              effectCtx.stroke();
            }
          }
        }
      } else if (effect.kind === "tiles" || effect.kind === "burst") {
        for (const particle of effect.particles) {
          const a = particle.angle + turn;
          const spread = size * e * particle.reach * (variant === 1 ? 1.3 : 1);
          const s = size * 0.075 * particle.scale * Math.sin(Math.PI * p);
          effectCtx.save();
          effectCtx.translate(Math.cos(a) * spread, Math.sin(a) * spread);
          effectCtx.rotate(a + direction * e * (variant + 1));
          if (effect.kind === "tiles") {
            if (variant === 0) effectCtx.fillRect(-s, -s, s * 2, s * 2);
            else if (variant === 1) effectCtx.strokeRect(-s, -s, s * 2, s * 2);
            else effectCtx.fillRect(-s * 1.5, -s * 0.4, s * 3, s * 0.8);
          } else {
            effectCtx.beginPath();
            const points = variant === 1 ? 6 : variant === 2 ? 10 : 8;
            for (let point = 0; point < points; point += 1) {
              const angle = point * Math.PI * 2 / points;
              const r = point % 2 ? s * (variant === 2 ? 0.6 : 0.35) : s;
              effectCtx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
            }
            effectCtx.closePath();
            effectCtx.fill();
          }
          effectCtx.restore();
        }
      } else if (effect.kind === "aperture") {
        const entrance = 1 - Math.pow(1 - core.clamp(p / 0.28, 0, 1), 3);
        const exit = Math.pow(core.clamp((p - 0.46) / 0.54, 0, 1), 2);
        const radius = size * (0.68 + entrance * 0.34 - exit * 0.08);
        const pieces = variant + 1;
        const segment = Math.PI * 2 / pieces;
        const span = segment * (variant === 0 ? 0.82 : variant === 1 ? 0.8 : 0.7);
        const band = radius * (variant === 2 ? 0.38 : 0.26) * effect.thickness;
        effectCtx.rotate(turn + direction * entrance * 0.24);
        for (let part = 0; part < pieces; part++) {
          const a = part * segment + exit * span;
          const b = part * segment + entrance * span;
          if (b <= a) continue;
          effectCtx.fillStyle = part % 2 === 0 ? "#ffffff" : effect.color;
          effectCtx.beginPath();
          effectCtx.arc(0, 0, radius, a, b);
          effectCtx.arc(0, 0, radius - band, b, a, true);
          effectCtx.closePath();
          effectCtx.fill();
        }
      } else if (effect.kind === "facets") {
        const exit = Math.pow(core.clamp((p - 0.55) / 0.45, 0, 1), 3);
        effectCtx.rotate(turn + (variant === 2 ? Math.PI / 4 : 0));
        for (let part = 0; part < 4; part++) {
          const q = core.clamp((p - part * 0.025) / 0.3, 0, 1);
          const entrance = 1 + 2.4 * Math.pow(q - 1, 3) + 1.4 * Math.pow(q - 1, 2);
          const radius = size * 1.05;
          effectCtx.save();
          effectCtx.rotate(part * Math.PI / 2);
          const offset = radius * (0.26 * (1 - entrance) + exit * 0.38);
          effectCtx.translate(offset, variant === 1 ? 0 : offset);
          const scale = Math.max(0, entrance) * (1 - exit * 0.9);
          effectCtx.scale(scale, scale);
          effectCtx.fillStyle = part % 2 === 0 ? effect.color : "#ffffff";
          const gap = radius * 0.045;
          if (variant === 2) {
            effectCtx.fillRect(gap, gap, radius * 0.61, radius * 0.61);
          } else {
            effectCtx.beginPath();
            if (variant === 0) {
              effectCtx.moveTo(gap, gap);
              effectCtx.lineTo(radius, gap);
              effectCtx.lineTo(gap, radius);
            } else {
              effectCtx.moveTo(gap, 0);
              effectCtx.lineTo(radius * 0.55, -radius * 0.28);
              effectCtx.lineTo(radius, 0);
              effectCtx.lineTo(radius * 0.55, radius * 0.28);
            }
            effectCtx.closePath();
            effectCtx.fill();
          }
          effectCtx.restore();
        }
      } else if (effect.kind === "spiral" || effect.kind === "orbit") {
        for (let n = 0; n < effect.count; n += 1) {
          const particle = effect.particles[n];
          const a = particle.angle * (effect.kind === "spiral" ? 2 : 1) + direction * e * 2.8 + turn;
          const r = size * e * (effect.kind === "spiral" ? (n + 1) / effect.count
            : variant === 2 ? particle.reach : 0.85);
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r * (variant === 1 ? 0.55 : 1);
          const dot = size * (0.02 + n / effect.count * 0.045) * particle.scale * release;
          effectCtx.beginPath();
          effectCtx.arc(px, py, dot, 0, Math.PI * 2);
          if (variant === 2) effectCtx.stroke();
          else effectCtx.fill();
        }
      } else if (effect.kind === "bars" || effect.kind === "curtain") {
        const vertical = effect.kind === "curtain";
        const count = effect.stripes;
        const span = Math.min(width, height) * 0.84;
        const track = span / count;
        for (let n = 0; n < count; n += 1) {
          const order = direction > 0 ? n : count - n - 1;
          const delay = order * 0.022;
          const phase = core.clamp((p - delay) / (1 - delay), 0, 1);
          const reach = Math.sin(Math.PI * phase);
          const extent = span * reach;
          const start = -extent / 2 + (variant === 1 ? (n % 2 ? 1 : -1) * (span - extent) * 0.2 : 0);
          const width = (variant === 1 ? 0.24 : 0.42) * effect.thickness;
          const across = (n + 0.5) * track - span / 2 - track * width / 2;
          if (variant === 2) {
            const gap = span * 0.025;
            const half = Math.max(0, extent / 2 - gap);
            if (vertical) {
              effectCtx.fillRect(across, -half - gap, track * width, half);
              effectCtx.fillRect(across, gap, track * width, half);
            } else {
              effectCtx.fillRect(-half - gap, across, half, track * width);
              effectCtx.fillRect(gap, across, half, track * width);
            }
          } else if (vertical) effectCtx.fillRect(across, start, track * width, extent);
          else effectCtx.fillRect(start, across, extent, track * width);
        }
      } else if (effect.kind === "polygon") {
        effectCtx.rotate(turn + direction * e * 1.3);
        for (let layer = 0; layer < (variant === 2 ? 2 : 1); layer++) {
          effectCtx.beginPath();
          for (let point = 0; point <= effect.points; point += 1) {
            const a = point * Math.PI * 2 / effect.points;
            const r = size * (0.15 + e) * (layer ? 0.65 : 1)
              * (1 + 0.12 * Math.sin(a * 2 + p * 5 + effect.phase));
            if (point === 0) effectCtx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
            else effectCtx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          effectCtx.closePath();
          if (variant === 1) effectCtx.fill();
          else effectCtx.stroke();
        }
      } else if (effect.kind === "cross" || effect.kind === "slash") {
        effectCtx.rotate(turn + direction * e * (effect.kind === "cross" ? 2 : 0.4));
        const length = size * e * 2.2;
        const width = size * 0.08 * release * effect.thickness / (variant + 1);
        for (let line = 0; line <= variant; line++) {
          const offset = (line - variant / 2) * size * 0.1;
          effectCtx.fillRect(-length / 2, offset - width / 2, length, width);
          if (effect.kind === "cross") effectCtx.fillRect(offset - width / 2, -length / 2, width, length);
        }
      } else if (effect.kind === "fan") {
        effectCtx.rotate(turn + direction * e * 1.5);
        for (let n = 0; n < effect.points; n += 1) {
          const segment = Math.PI * 2 / effect.points;
          const start = n * segment;
          const radius = size * e * (variant === 2 && n % 2 ? 0.65 : 1);
          effectCtx.beginPath();
          effectCtx.moveTo(0, 0);
          effectCtx.arc(0, 0, radius, start, start + segment * (variant === 1 ? 0.65 : 0.42));
          effectCtx.closePath();
          if (variant === 1) effectCtx.stroke();
          else effectCtx.fill();
        }
      } else if (effect.kind === "brackets") {
        const r = size * (0.3 + e * 0.7);
        effectCtx.rotate(turn + direction * e * 0.25);
        const corners = variant === 1 ? [[-1, -1], [1, 1]] : [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (const [dx, dy] of corners) {
          effectCtx.beginPath();
          effectCtx.moveTo(dx * (r - size * 0.2), dy * r);
          effectCtx.lineTo(dx * r, dy * r);
          effectCtx.lineTo(dx * r, dy * (r - size * 0.2));
          effectCtx.stroke();
          if (variant === 2) {
            effectCtx.beginPath();
            effectCtx.moveTo(dx * r * 0.7, dy * r * 0.7);
            effectCtx.lineTo(dx * r * 0.7, dy * (r * 0.7 - size * 0.15));
            effectCtx.stroke();
          }
        }
      } else if (effect.kind === "speech") {
        effectCtx.rotate(direction * Math.sin(p * Math.PI) * 0.06);
        const scale = 0.65 + Math.sin(Math.min(1, p * 2) * Math.PI / 2) * 0.35;
        effectCtx.scale(scale, scale);
        const bubbleWidth = Math.min(size * 1.8, width * 0.75);
        const height = size * 0.8;
        effectCtx.fillStyle = "#ffffff";
        effectCtx.fillRect(-bubbleWidth / 2, -height / 2, bubbleWidth, height);
        if (variant === 1) {
          effectCtx.beginPath();
          effectCtx.moveTo(-bubbleWidth * 0.2, height / 2);
          effectCtx.lineTo(-bubbleWidth * 0.3, height * 0.65);
          effectCtx.lineTo(0, height / 2);
          effectCtx.fill();
        }
        effectCtx.strokeRect(-bubbleWidth / 2, -height / 2, bubbleWidth, height);
        if (variant === 2) effectCtx.strokeRect(-bubbleWidth / 2 + 8, -height / 2 + 8, bubbleWidth - 16, height - 16);
        effectCtx.fillStyle = effect.color;
        effectCtx.font = `700 ${Math.min(bubbleWidth / (effect.label.length * 0.75 + 1), height * 0.58)}px Consolas, monospace`;
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
    roomScene?.update(state, now);
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

  resize();
  loadCharacter();
  updateMeterDisplay();
  animationId = requestAnimationFrame(frame);
})();
