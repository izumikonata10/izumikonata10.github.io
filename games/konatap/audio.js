(function (root) {
  "use strict";

  const TEMPO = 140;
  const STEP = 60 / TEMPO / 4;
  const DRAG_STEP = STEP * 2;
  const DRAG_LOOKAHEAD = 0.03;
  const DRAG_POINTER_LIMIT = 16;
  const CHORDS = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]];
  const ARPEGGIO = [0, 2, 1, 2, 0, 1, 2, 1];
  const MAKEUP_GAIN = 2.2;
  const PEAK_CEILING = 0.97;
  const FOREGROUND_LIMIT = 3;
  const TRIAL_NOTES = [0, 1, 12, 13, 14, 24];
  const FULL_VOCAL_NOTES = Array.from({ length: 32 }, (_, note) => note).filter(note => note !== 8 && note !== 9);
  const SYLLABLES = ["pa", "pi", "pu", "pe", "po", "na", "ni", "nu", null, null,
    "a", "i", "na", "ni", "nu", "ne", "no", "ma", "mi", "mu", "me", "mo", "na", "ma",
    "a", "i", "u", "e", "o", "ma", "mi", "mo"];
  const frequency = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  class AudioEngine {
    constructor(core, options = {}) {
      this.core = core;
      this.AudioCtor = options.AudioCtor || root.AudioContext || root.webkitAudioContext;
      this.voices = new Set();
      this.foreground = new Set();
      this.dragPending = new Map();
      this.dragScheduled = new Map();
      this.samples = new Map();
      this.builtins = new Map();
      this.trials = new Map();
      this.vocalBank = options.vocalBank || root.KonatapVocalBank;
      this.trialBank = "trialBank" in options ? options.trialBank : root.KonatapTrialBank;
      this.trialError = null;
      this.bankReady = Promise.resolve();
      this.timer = null;
      this.context = null;
      this.volume = 0.7;
      this.muted = false;
      this.beat = true;
      this.paused = false;
      this.step = 0;
      this.bars = 0;
      this.origin = 0;
      this.activity = 0;
      this.lifecycle = 0;
      this.operation = Promise.resolve();
    }

    init() {
      if (this.context) return;
      if (!this.AudioCtor) throw new Error("Web Audio unavailable");
      const ctx = this.context = new this.AudioCtor({ latencyHint: "interactive" });
      this.mix = ctx.createGain();
      this.backing = ctx.createGain();
      this.master = ctx.createGain();
      this.makeup = ctx.createGain();
      this.highpass = ctx.createBiquadFilter();
      this.highpass.type = "highpass";
      this.highpass.frequency.value = 28;
      this.highpass.Q.value = 0.7;
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 6;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.002;
      this.compressor.release.value = 0.09;
      this.makeup.gain.value = MAKEUP_GAIN;
      // A final bounded soft knee catches overlaps, including echo and imported samples.
      this.ceiling = ctx.createWaveShaper();
      const curve = new Float32Array(4097);
      for (let i = 0; i < curve.length; i += 1) {
        const x = i * 2 / (curve.length - 1) - 1;
        const magnitude = Math.abs(x);
        const y = magnitude <= 0.8 ? magnitude
          : 0.8 + (PEAK_CEILING - 0.8) * (1 - Math.exp(-(magnitude - 0.8) / 0.065));
        curve[i] = Math.sign(x) * y;
      }
      this.ceiling.curve = curve;
      this.ceiling.oversample = "none";
      this.backing.connect(this.mix);
      this.mix.connect(this.highpass);
      this.highpass.connect(this.compressor);
      this.compressor.connect(this.makeup);
      this.makeup.connect(this.master);
      this.master.connect(this.ceiling);
      this.ceiling.connect(ctx.destination);
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.backing.gain.value = this.beat ? 1 : 0;
      this.resetEcho();
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      this.resetClock();
      this.loadVocalBank();
      this.trialReady = this.loadTrialBank();
      this.bankReady = Promise.all([this.bankReady, this.trialReady]);
    }

    async loadTrialBank() {
      if (!this.trialBank) return;
      try {
        const bank = this.trialBank;
        const notes = bank.version === 1 ? TRIAL_NOTES : bank.version === 2 ? FULL_VOCAL_NOTES : null;
        if (!notes || !Array.isArray(bank.pads) || bank.pads.length !== notes.length
          || !Array.isArray(bank.clips) || !bank.clips.length || bank.clips.length > (bank.version === 1 ? 24 : 120)) {
          throw new Error("Invalid trial bank");
        }
        const names = new Set();
        const entries = await Promise.all(bank.clips.map(async clip => {
          if (typeof clip.name !== "string" || !clip.name || names.has(clip.name)
            || typeof clip.wav !== "string" || clip.wav.length > 256 * 1024
            || (clip.midi !== null && (!Number.isInteger(clip.midi) || clip.midi < 60 || clip.midi > 84))) {
            throw new Error("Invalid trial clip");
          }
          names.add(clip.name);
          const binary = root.atob(clip.wav);
          const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
          const buffer = await this.context.decodeAudioData(bytes.buffer);
          if (!Number.isFinite(buffer.duration) || buffer.duration < 0.02 || buffer.duration > 1
            || buffer.numberOfChannels !== 1) throw new Error("Invalid trial audio");
          return [clip.name, { buffer, midi: clip.midi }];
        }));
        const clips = new Map(entries);
        const trials = new Map();
        const used = new Set();
        for (const pad of bank.pads) {
          if (!notes.includes(pad.note) || trials.has(pad.note)
            || typeof pad.label !== "string" || !pad.label
            || !["attack", "melody", "accent"].includes(pad.role)
            || !Array.isArray(pad.variants) || pad.variants.length !== (pad.role === "melody" ? 4 : 1)) {
            throw new Error("Invalid trial pad");
          }
          const variants = pad.variants.map((name, bar) => {
            const clip = clips.get(name);
            if (!clip || (pad.role === "melody"
              ? clip.midi === null || !CHORDS[bar].some(tone => tone % 12 === clip.midi % 12)
              : clip.midi !== null)) throw new Error("Incomplete trial pad");
            used.add(name);
            return clip.buffer;
          });
          trials.set(pad.note, { mode: "trial", variants, label: pad.label, role: pad.role });
        }
        if (used.size !== clips.size) throw new Error("Unused trial audio");
        this.trials = trials;
        this.trialError = null;
      } catch (error) {
        // Commit only a complete bank; every failed pad retains the previous default.
        this.trialError = error;
      }
    }

    loadVocalBank() {
      if (!this.vocalBank) {
        this.bankError = new Error("Missing vocal bank");
        return;
      }
      this.bankReady = Promise.all(this.vocalBank.clips.map(async clip => {
        const binary = root.atob(clip.wav);
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        const buffer = await this.context.decodeAudioData(bytes.buffer);
        if (!Number.isFinite(clip.root) || !Number.isFinite(buffer.duration)
          || buffer.duration <= 0 || buffer.duration > 1) throw new Error("Invalid vocal bank");
        return [clip.name, { mode: "builtin", buffer, root: clip.root }];
      })).then(entries => {
        const clips = new Map(entries);
        const bank = new Map();
        SYLLABLES.forEach((name, note) => {
          if (!name) return;
          if (!clips.has(name)) throw new Error("Incomplete vocal bank");
          bank.set(note, clips.get(name));
        });
        this.builtins = bank;
        this.bankError = null;
      }).catch(error => {
        this.bankError = error;
      });
    }

    resetClock() {
      this.cancelDrags();
      this.origin = this.context.currentTime + 0.025;
      this.nextTime = this.origin;
      this.step = 0;
      this.bars = 0;
      this.activity = 0;
    }

    disconnectEcho() {
      for (const node of [this.delay, this.feedback, this.echo]) {
        if (node) node.disconnect();
      }
    }

    resetEcho() {
      if (!this.context) return;
      this.disconnectEcho();
      this.delay = this.context.createDelay(1);
      this.feedback = this.context.createGain();
      this.echo = this.context.createGain();
      this.delay.delayTime.value = STEP * 3;
      this.feedback.gain.value = 0.18;
      this.echo.gain.value = 0.16;
      this.delay.connect(this.feedback);
      this.feedback.connect(this.delay);
      this.delay.connect(this.echo);
      this.echo.connect(this.mix);
    }

    setVolume(value, muted = this.muted) {
      this.volume = this.core.numericSetting(value, 0.7, 0, 1);
      this.muted = muted;
      if (muted || this.volume === 0) this.cancelDrags();
      if (this.context) this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.context.currentTime, 0.012);
    }

    setBeat(enabled) {
      this.beat = enabled;
      if (this.context) this.backing.gain.setTargetAtTime(enabled ? 1 : 0, this.context.currentTime, 0.015);
    }

    resume() {
      const revision = ++this.lifecycle;
      // Serialize native audio transitions so a late resume cannot undo a pause.
      this.operation = this.operation.catch(() => {}).then(async () => {
        if (revision !== this.lifecycle) return false;
        this.init();
        if (this.context.state !== "running") await this.context.resume();
        await this.bankReady;
        if (revision !== this.lifecycle) return false;
        this.paused = false;
        if (this.timer === null) {
          this.resetClock();
          this.timer = root.setInterval(() => this.tick(), 25);
        }
        return true;
      });
      return this.operation;
    }

    pause() {
      this.lifecycle += 1;
      this.paused = true;
      this.stopTimer();
      this.stopVoices();
      this.resetEcho();
      this.operation = this.operation.catch(() => {}).then(async () => {
        if (this.context && this.context.state === "running") await this.context.suspend();
      });
      return this.operation;
    }

    stopTimer() {
      if (this.timer !== null) root.clearInterval(this.timer);
      this.timer = null;
    }

    stopVoices() {
      this.cancelDrags();
      for (const voice of [...this.voices]) {
        try { voice.source.stop(); } catch (_) {}
        voice.cleanup();
      }
      this.foreground.clear();
    }

    destroy() {
      return this.pause().catch(() => {}).then(() => {
        this.disconnectEcho();
        if (this.context) return this.context.close().catch(() => {});
      });
    }

    attach(source, nodes, duration, when, gainValue, bus, send, shape = {}) {
      // A hard voice ceiling prevents rapid multi-touch from building an unbounded graph.
      if (this.voices.size >= 64) {
        const oldest = this.voices.values().next().value;
        try { oldest.source.stop(); } catch (_) {}
        oldest.cleanup();
      }
      const ctx = this.context;
      const envelope = ctx.createGain();
      const attack = Math.min(shape.attack ?? 0.003, duration / 4);
      const release = Math.min(shape.release ?? 0.025, duration / 4);
      const decay = Math.min(shape.decay ?? duration * 0.45, duration - attack - release);
      if (!bus && this.currentHit) gainValue *= this.currentHit.level;
      const peak = Math.max(0.0002, gainValue);
      const sustain = peak * (shape.sustain ?? 0.22);
      envelope.gain.setValueAtTime(0, when);
      envelope.gain.linearRampToValueAtTime(peak, when + attack);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), when + attack + decay);
      envelope.gain.setValueAtTime(sustain, when + duration - release);
      envelope.gain.linearRampToValueAtTime(0, when + duration);
      let previous = source;
      for (const node of nodes) {
        previous.connect(node);
        previous = node;
      }
      previous.connect(envelope);
      envelope.connect(bus || this.mix);
      const owned = [source, ...nodes, envelope];
      if (send > 0) {
        const wet = ctx.createGain();
        wet.gain.value = send;
        envelope.connect(wet);
        wet.connect(this.delay);
        owned.push(wet);
      }
      const voice = {
        source,
        startAt: when,
        endAt: when + duration,
        fadeAt: time => {
          if (time >= voice.endAt) return;
          const elapsed = Math.max(0, time - when);
          let level = sustain;
          if (elapsed < attack) level = peak * elapsed / attack;
          else if (elapsed < attack + decay && decay > 0) {
            level = peak * Math.pow(Math.max(0.0001, sustain) / peak, (elapsed - attack) / decay);
          } else if (elapsed > duration - release) level = sustain * (duration - elapsed) / release;
          const cut = Math.max(time, when);
          const end = time < when ? when : Math.min(voice.endAt, cut + 0.012);
          envelope.gain.cancelScheduledValues(cut);
          envelope.gain.setValueAtTime(Math.max(0, level), cut);
          envelope.gain.linearRampToValueAtTime(0, end);
          source.stop(end + 0.002);
          voice.endAt = end;
        },
        cleanup: () => {
          for (const node of owned) node.disconnect();
          this.voices.delete(voice);
          if (voice.hit) {
            voice.hit.voices.delete(voice);
            if (!voice.hit.voices.size) this.foreground.delete(voice.hit);
          }
        }
      };
      if (!bus && this.currentHit) {
        voice.hit = this.currentHit;
        voice.hit.voices.add(voice);
        voice.hit.endAt = Math.max(voice.hit.endAt, voice.endAt);
      }
      this.voices.add(voice);
      source.onended = voice.cleanup;
      source.start(when);
      source.stop(when + duration + 0.025);
    }

    tone(midi, duration, volume, when, options = {}) {
      const ctx = this.context;
      const source = ctx.createOscillator();
      source.type = options.type || "triangle";
      const hz = options.hz || frequency(midi);
      source.frequency.setValueAtTime(hz, when);
      if (options.glide) source.frequency.exponentialRampToValueAtTime(options.glide, when + duration);
      const nodes = [];
      if (options.cutoff) {
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = options.cutoff;
        nodes.push(filter);
      }
      this.attach(source, nodes, duration, when, volume, options.bus, options.send || 0, options.shape);
    }

    noiseHit(duration, volume, when, highpass, bus) {
      const source = this.context.createBufferSource();
      source.buffer = this.noise;
      const filter = this.context.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = highpass;
      this.attach(source, [filter], duration, when, volume, bus, 0, { attack: 0.001, sustain: 0.08 });
    }

    drum(index, when, volume = 1, bus) {
      if (index === 0 || index === 6) {
        this.tone(36, 0.22, 0.44 * volume, when, {
          hz: index === 6 ? 175 : 145, glide: 46, type: "sine", bus,
          shape: { attack: 0.001, decay: 0.15, sustain: 0.08, release: 0.02 }
        });
      } else if (index === 1 || index === 5) {
        this.noiseHit(index === 5 ? 0.16 : 0.045, 0.14 * volume, when, 7000, bus);
      } else if (index === 2) {
        this.noiseHit(0.13, 0.23 * volume, when, 1700, bus);
        this.tone(50, 0.09, 0.15 * volume, when, { type: "triangle", bus });
      } else if (index === 3) {
        for (let i = 0; i < 3; i += 1) this.noiseHit(0.045, 0.13 * volume, when + i * 0.018, 1800, bus);
      } else if (index === 4) {
        this.tone(57, 0.14, 0.22 * volume, when, { type: "sine", glide: 90, bus });
      } else {
        this.tone(84, 0.065, 0.12 * volume, when, { type: "square", cutoff: 3400, bus });
        this.tone(79, 0.08, 0.07 * volume, when, { type: "sine", bus });
      }
    }

    beginHit(note, when) {
      const active = [];
      for (const hit of this.foreground) {
        if (hit.endAt <= when) {
          this.foreground.delete(hit);
        } else {
          active.push(hit);
        }
      }
      for (const hit of active.filter(hit => hit.note === note)) {
        for (const voice of hit.voices) voice.fadeAt(when);
        hit.endAt = when;
      }
      const remaining = active.filter(hit => hit.endAt > when);
      while (remaining.length >= FOREGROUND_LIMIT) {
        const oldest = remaining.shift();
        for (const voice of oldest.voices) voice.fadeAt(when);
        oldest.endAt = when;
      }
      const hit = {
        note, startAt: when, endAt: when, voices: new Set(),
        level: 1 / Math.sqrt(remaining.length + 1)
      };
      this.foreground.add(hit);
      return hit;
    }

    vocalPitch(note, when) {
      const chord = this.chordAt(when);
      const step = this.core.vocalStep(note);
      let midi = chord[(step >= 0 ? step : note) % 3] + 12;
      while (midi < 55) midi += 12;
      while (midi > 66) midi -= 12;
      return midi;
    }

    vocalFallback(note, velocity, when) {
      const midi = this.vocalPitch(note, when);
      const formants = [[800, 1200], [350, 2100], [450, 900], [550, 1800], [450, 800]][note % 5];
      for (let i = 0; i < 2; i++) {
        const source = this.context.createOscillator();
        source.type = "sawtooth";
        source.frequency.setValueAtTime(frequency(midi), when);
        const filter = this.context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(formants[i], when);
        filter.Q.value = 3;
        this.attach(source, [filter], STEP * 1.8, when, 0.4 * velocity, null, 0,
          { attack: 0.008, decay: 0.04, sustain: 0.45, release: 0.018 });
      }
    }

    scheduleTime(quantize) {
      return this.core.hitTime(this.context.currentTime, this.origin, STEP, quantize);
    }

    queueDrag(note, velocity, pointerId) {
      if (!this.context || this.context.state !== "running" || this.paused || this.muted || this.volume === 0) return false;
      if (!Number.isInteger(note) || note < 0 || note >= 32 || !Number.isInteger(pointerId)) return false;
      velocity = this.core.numericSetting(velocity, 0.8, 0, 1);
      if (velocity === 0) return false;
      this.flushDrags();
      const pointers = new Set([...this.dragPending.keys(), ...this.dragScheduled.keys()]);
      if (!pointers.has(pointerId) && pointers.size >= DRAG_POINTER_LIMIT) return false;
      const now = this.context.currentTime;
      // Seal each slot shortly before playback; later crossings belong to the next eighth.
      const slot = Math.floor((now + DRAG_LOOKAHEAD - this.origin) / DRAG_STEP + 1e-8) + 1;
      const when = this.origin + slot * DRAG_STEP;
      this.dragPending.set(pointerId, { note, velocity, when });
      return true;
    }

    flushDrags() {
      if (!this.context || this.context.state !== "running" || this.paused || this.muted || this.volume === 0) {
        this.cancelDrags();
        return;
      }
      const now = this.context.currentTime;
      for (const [pointerId, hit] of this.dragScheduled) {
        if (hit.startAt <= now || !hit.voices.size) this.dragScheduled.delete(pointerId);
      }
      for (const [pointerId, pending] of this.dragPending) {
        if (pending.when > now + DRAG_LOOKAHEAD + 1e-9) continue;
        this.dragPending.delete(pointerId);
        // After a stalled timer, discard old inputs instead of playing a catch-up burst.
        if (pending.when < now - DRAG_STEP) continue;
        const hit = this.play(pending.note, pending.velocity, Math.max(pending.when, now + 0.004));
        if (hit?.voices?.size) this.dragScheduled.set(pointerId, hit);
      }
    }

    cancelDrags(pointerId) {
      if (pointerId === undefined) this.dragPending.clear();
      else this.dragPending.delete(pointerId);
      for (const [id, hit] of this.dragScheduled) {
        if (pointerId !== undefined && pointerId !== id) continue;
        if (hit.startAt > this.context.currentTime) {
          for (const voice of [...hit.voices]) {
            try { voice.source.stop(this.context.currentTime); } catch (_) {}
            voice.cleanup();
          }
        }
        this.dragScheduled.delete(id);
      }
    }

    chordAt(when) {
      return CHORDS[this.chordIndex(when)];
    }

    chordIndex(when) {
      const bar = Math.max(0, Math.floor((when - this.origin + 0.00001) / (STEP * 16)));
      return bar % CHORDS.length;
    }

    play(note, velocity, when) {
      if (!this.context || this.paused || this.muted) return;
      if (!Number.isInteger(note) || note < 0 || note >= 32 || !Number.isFinite(when)) return;
      velocity = this.core.numericSetting(velocity, 1, 0, 1);
      if (velocity === 0) return;
      this.activity = Math.min(1, this.activity + 0.15);
      const hit = this.currentHit = this.beginHit(note, when);
      try {
        this.playNote(note, velocity, when);
      } finally {
        if (!hit.voices.size) this.foreground.delete(hit);
        this.currentHit = null;
      }
      return hit;
    }

    playNote(note, velocity, when) {
      const sample = this.samples.get(note) || this.trials.get(note) || this.builtins.get(note);
      if (sample) {
        const source = this.context.createBufferSource();
        if (sample.mode === "trial") {
          source.buffer = sample.variants[sample.variants.length === 1 ? 0 : this.chordIndex(when)];
          source.playbackRate.setValueAtTime(1, when);
          this.attach(source, [], source.buffer.duration, when, 0.38 * velocity, null, 0,
            { attack: 0.003, decay: 0, sustain: 1, release: 0.018 });
          return;
        }
        if (sample.mode === "builtin") {
          source.buffer = sample.buffer;
          const midi = this.vocalPitch(note, when);
          const rate = Math.pow(2, (midi - sample.root) / 12);
          source.playbackRate.setValueAtTime(rate, when);
          const highpass = this.context.createBiquadFilter();
          highpass.type = "highpass";
          highpass.frequency.value = 160;
          const lowpass = this.context.createBiquadFilter();
          lowpass.type = "lowpass";
          lowpass.frequency.value = 6200;
          const duration = Math.min(sample.buffer.duration / rate, STEP * (note < 8 ? 1.6 : 2));
          this.attach(source, [highpass, lowpass], duration, when, 0.8 * velocity, null, 0,
            { attack: 0.003, decay: 0, sustain: 1, release: 0.014 });
          return;
        }
        if (sample.mode === "vocal") {
          source.buffer = sample.buffer;
          const step = Math.max(0, this.core.vocalStep(note));
          const chord = this.chordAt(when);
          let midi = chord[step % 3] + 24;
          // Keep sample transposition within seven semitones of its declared root.
          while (midi > sample.root + 7) midi -= 12;
          while (midi < sample.root - 7) midi += 12;
          const rate = Math.pow(2, (midi - sample.root) / 12);
          source.playbackRate.setValueAtTime(rate, when);
          const highpass = this.context.createBiquadFilter();
          highpass.type = "highpass";
          highpass.frequency.value = 150;
          const lowpass = this.context.createBiquadFilter();
          lowpass.type = "lowpass";
          lowpass.frequency.value = 6800;
          const duration = Math.min(sample.buffer.duration / rate, STEP * 4 * sample.beats);
          this.attach(source, [highpass, lowpass], duration, when, 0.32 * velocity, null, 0,
            { attack: 0.004, decay: 0, sustain: 1, release: 0.018 });
          return;
        }
        source.buffer = sample;
        this.attach(source, [], Math.min(sample.duration, 2), when, 0.38 * velocity, null, 0,
          { attack: 0.003, decay: 0, sustain: 1, release: 0.012 });
        return;
      }
      const group = this.core.groupForNote(note);
      const chord = this.chordAt(when);
      if (group === 1) {
        const midi = [chord[0], chord[2]][note - 8];
        this.tone(midi, STEP * 2, 0.25 * velocity, when, {
          type: "square", cutoff: 3600, shape: { attack: 0.002, decay: 0.04, sustain: 0.42 }
        });
        this.tone(midi + 12, STEP * 1.5, 0.095 * velocity, when, {
          type: "sawtooth", cutoff: 4800, shape: { attack: 0.002, decay: 0.035, sustain: 0.3 }
        });
        this.tone(midi, STEP * 1.6, 0.045 * velocity, when, { type: "sine", shape: { sustain: 0.25 } });
      } else {
        this.vocalFallback(note, velocity, when);
      }
    }

    tick() {
      if (this.paused || this.context.state !== "running") return;
      const now = this.context.currentTime;
      this.flushDrags();
      if (this.nextTime < now - STEP) this.nextTime = now + 0.015;
      let scheduled = 0;
      while (this.nextTime < now + 0.09 && scheduled++ < 8) {
        const when = this.nextTime;
        const step = this.step;
        if (this.beat && !this.muted) {
          if (step % 4 === 0) this.drum(0, when, 0.95, this.backing);
          if (step === 4 || step === 12) this.drum(2, when, 0.9, this.backing);
          this.drum(1, when, step % 4 === 2 ? 0.68 : step % 2 === 0 ? 0.42 : 0.28, this.backing);
          const chord = this.chordAt(when);
          if (step % 4 === 2) {
            this.tone(chord[0] - 12, STEP * 1.8, 0.16, when, {
              type: "sawtooth", cutoff: 1250, bus: this.backing, shape: { decay: 0.045, sustain: 0.45 }
            });
            this.tone(chord[0] - 12, STEP * 1.6, 0.09, when, { type: "sine", bus: this.backing, shape: { sustain: 0.5 } });
          }
          if (step === 0 || step === 8) {
            for (const midi of chord) this.tone(midi + 12, STEP * 6, 0.028, when, {
              type: "triangle", bus: this.backing, shape: { attack: 0.008, sustain: 0.3 }
            });
          }
          if (step % 2 === 0) {
            this.tone(chord[ARPEGGIO[step / 2]] + 24, STEP * 1.6, 0.045, when, {
              type: "square", cutoff: 3200, bus: this.backing, shape: { decay: 0.04, sustain: 0.12 }
            });
          }
        }
        this.activity *= 0.97;
        this.step = (step + 1) % 16;
        if (this.step === 0) this.bars += 1;
        this.nextTime += STEP;
      }
    }

    async importSample(note, bytes, options = {}) {
      if (!Number.isInteger(note) || note < 0 || note >= 32) throw new Error("Invalid note");
      this.init();
      if (bytes.byteLength > 12 * 1024 * 1024) throw new Error("Sample too large");
      let buffer = await this.context.decodeAudioData(bytes);
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 10) throw new Error("Invalid duration");
      const vocal = options.mode === "vocal";
      let beats;
      let root;
      if (vocal) {
        const start = options.start ?? 0;
        beats = options.beats ?? 1;
        root = options.root ?? 72;
        if (!Number.isFinite(start) || start < 0 || start >= buffer.duration
          || ![0.5, 1, 2].includes(beats) || !Number.isInteger(root) || root < 60 || root > 84) {
          throw new Error("Invalid slice");
        }
        const rate = buffer.sampleRate || this.context.sampleRate;
        const offset = Math.floor(start * rate);
        const length = Math.min(buffer.length - offset, Math.round(STEP * 4 * beats * rate));
        if (length < rate * 0.02) throw new Error("Slice too short");
        const trimmed = this.context.createBuffer(buffer.numberOfChannels, length, rate);
        for (let c = 0; c < buffer.numberOfChannels; c += 1) {
          const data = new Float32Array(buffer.length);
          buffer.copyFromChannel(data, c);
          trimmed.copyToChannel(data.subarray(offset, offset + length), c);
        }
        buffer = trimmed;
      }
      // Normalize once on import, never allocate PCM buffers on each key press.
      let peak = 0;
      let power = 0;
      const channels = [];
      for (let c = 0; c < buffer.numberOfChannels; c += 1) {
        const data = new Float32Array(buffer.length);
        buffer.copyFromChannel(data, c);
        channels.push(data);
        for (let i = 0; i < data.length; i += 1) {
          peak = Math.max(peak, Math.abs(data[i]));
          power += data[i] * data[i];
        }
      }
      if (peak > 0) {
        const rms = Math.sqrt(power / (buffer.length * buffer.numberOfChannels));
        const scale = Math.min(4, 0.9 / peak, 0.22 / Math.max(0.00001, rms));
        for (let c = 0; c < buffer.numberOfChannels; c += 1) {
          const data = channels[c];
          for (let i = 0; i < data.length; i += 1) data[i] *= scale;
          buffer.copyToChannel(data, c);
        }
      }
      if (vocal && peak === 0) throw new Error("Silent slice");
      const entry = vocal ? { mode: "vocal", buffer, root, beats } : buffer;
      const notes = vocal && options.bank ? this.core.VOCAL_NOTES : [note];
      for (const target of notes) this.samples.set(target, entry);
    }
  }

  const api = { AudioEngine, TEMPO, STEP, DRAG_STEP, DRAG_LOOKAHEAD, DRAG_POINTER_LIMIT,
    MAKEUP_GAIN, PEAK_CEILING, FOREGROUND_LIMIT, SYLLABLES, TRIAL_NOTES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KonatapAudio = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
