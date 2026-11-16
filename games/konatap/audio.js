(function (root) {
  "use strict";

  const TEMPO = 112;
  const STEP = 60 / TEMPO / 4;
  const PENTATONIC = [0, 2, 4, 7, 9];
  const CHORDS = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]];
  const frequency = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  class AudioEngine {
    constructor(core, options = {}) {
      this.core = core;
      this.AudioCtor = options.AudioCtor || root.AudioContext || root.webkitAudioContext;
      this.voices = new Set();
      this.samples = new Map();
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
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.15;
      this.backing.connect(this.mix);
      this.mix.connect(this.compressor);
      this.compressor.connect(this.master);
      this.master.connect(ctx.destination);
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.backing.gain.value = this.beat ? 1 : 0;
      this.resetEcho();
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      this.resetClock();
    }

    resetClock() {
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
      this.feedback.gain.value = 0.22;
      this.echo.gain.value = 0.25;
      this.delay.connect(this.feedback);
      this.feedback.connect(this.delay);
      this.delay.connect(this.echo);
      this.echo.connect(this.mix);
    }

    setVolume(value, muted = this.muted) {
      this.volume = this.core.numericSetting(value, 0.7, 0, 1);
      this.muted = muted;
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
      for (const voice of [...this.voices]) {
        try { voice.source.stop(); } catch (_) {}
        voice.cleanup();
      }
    }

    destroy() {
      return this.pause().catch(() => {}).then(() => {
        this.disconnectEcho();
        if (this.context) return this.context.close().catch(() => {});
      });
    }

    attach(source, nodes, duration, when, gainValue, bus, send) {
      // A hard voice ceiling prevents rapid multi-touch from building an unbounded graph.
      if (this.voices.size >= 64) {
        const oldest = this.voices.values().next().value;
        try { oldest.source.stop(); } catch (_) {}
        oldest.cleanup();
      }
      const ctx = this.context;
      const envelope = ctx.createGain();
      const attack = Math.min(0.01, duration / 4);
      envelope.gain.setValueAtTime(0.0001, when);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), when + attack);
      envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);
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
        cleanup: () => {
          for (const node of owned) node.disconnect();
          this.voices.delete(voice);
        }
      };
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
      this.attach(source, nodes, duration, when, volume, options.bus, options.send || 0);
    }

    noiseHit(duration, volume, when, highpass, bus) {
      const source = this.context.createBufferSource();
      source.buffer = this.noise;
      const filter = this.context.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = highpass;
      this.attach(source, [filter], duration, when, volume, bus, 0);
    }

    drum(index, when, volume = 1, bus) {
      if (index === 0 || index === 6) {
        this.tone(36, 0.2, 0.23 * volume, when, { hz: index === 6 ? 170 : 140, glide: 46, type: "sine", bus });
      } else if (index === 1 || index === 5) {
        this.noiseHit(index === 5 ? 0.19 : 0.045, 0.065 * volume, when, 6800, bus);
      } else if (index === 2) {
        this.noiseHit(0.12, 0.1 * volume, when, 1500, bus);
        this.tone(50, 0.085, 0.06 * volume, when, { type: "triangle", bus });
      } else if (index === 3) {
        for (let i = 0; i < 3; i += 1) this.noiseHit(0.035, 0.06 * volume, when + i * 0.018, 1800, bus);
      } else if (index === 4) {
        this.tone(57, 0.13, 0.1 * volume, when, { type: "sine", glide: 90, bus });
      } else {
        this.tone(84, 0.065, 0.055 * volume, when, { type: "square", cutoff: 3400, bus });
        this.tone(79, 0.08, 0.03 * volume, when, { type: "sine", bus });
      }
    }

    scheduleTime(quantize) {
      return this.core.hitTime(this.context.currentTime, this.origin, STEP, quantize);
    }

    play(note, velocity, when) {
      if (!this.context || this.paused || this.muted) return;
      this.activity = Math.min(1, this.activity + 0.15);
      const sample = this.samples.get(note);
      if (sample) {
        const source = this.context.createBufferSource();
        source.buffer = sample;
        this.attach(source, [], Math.min(sample.duration, 2), when, 0.2 * velocity, null, 0.08);
        return;
      }
      const group = this.core.groupForNote(note);
      if (group === 0) {
        this.drum(note, when, velocity);
      } else if (group === 1) {
        const midi = [36, 43, 45, 41][note - 8];
        this.tone(midi, 0.32, 0.13 * velocity, when, { type: "sawtooth", cutoff: 650 });
        this.tone(midi, 0.25, 0.065 * velocity, when, { type: "sine" });
      } else if (group === 2) {
        const step = note - 12;
        const midi = 60 + PENTATONIC[step % 5] + Math.floor(step / 5) * 12;
        this.tone(midi, 0.43, 0.105 * velocity, when, { type: step % 3 === 0 ? "sine" : "triangle", send: 0.18 });
        this.tone(midi + 12, 0.17, 0.025 * velocity, when, { type: "sine", send: 0.1 });
        if (step >= 8) this.tone(midi - 12, 0.2, 0.03 * velocity, when + STEP, { send: 0.12 });
      } else {
        // Synthetic vowel-like tones, not recordings or an imitation of a voice actor.
        const step = note - 24;
        const midi = 67 + PENTATONIC[step % 5];
        const formants = [[800, 1200], [350, 2100], [450, 900], [550, 1800]][step % 4];
        for (let i = 0; i < 2; i += 1) {
          const source = this.context.createOscillator();
          source.type = "sawtooth";
          source.frequency.setValueAtTime(frequency(midi), when);
          source.frequency.exponentialRampToValueAtTime(frequency(midi + (step % 2 ? -2 : 2)), when + 0.22);
          const filter = this.context.createBiquadFilter();
          filter.type = "bandpass";
          filter.frequency.value = formants[i];
          filter.Q.value = 5;
          this.attach(source, [filter], 0.24, when + (step >= 4 ? i * 0.045 : 0), 0.055 * velocity, null, 0.12);
        }
      }
    }

    tick() {
      if (this.paused || this.context.state !== "running") return;
      const now = this.context.currentTime;
      if (this.nextTime < now - STEP) this.nextTime = now + 0.015;
      let scheduled = 0;
      while (this.nextTime < now + 0.09 && scheduled++ < 8) {
        const when = this.nextTime;
        const step = this.step;
        if (this.beat && !this.muted) {
          if ([0, 6, 8, 14].includes(step)) this.drum(0, when, 0.38, this.backing);
          if (step === 4 || step === 12) this.drum(2, when, 0.4, this.backing);
          if (step % 2 === 0) this.drum(1, when, step % 4 ? 0.42 : 0.26, this.backing);
          const chord = CHORDS[this.bars % CHORDS.length];
          if (step % 4 === 0) {
            this.tone(chord[0] - 12, 0.28, 0.055, when, { type: "triangle", cutoff: 800, bus: this.backing });
          }
          if (step === 0) {
            for (const midi of chord) this.tone(midi + 12, STEP * 14, 0.009, when, { type: "sine", bus: this.backing });
          }
          if (this.activity > 0.5 && step % 4 === 2) {
            this.tone(chord[(step / 2) % 3 | 0] + 12, 0.12, 0.018, when, { bus: this.backing });
          }
        }
        this.activity *= 0.97;
        this.step = (step + 1) % 16;
        if (this.step === 0) this.bars += 1;
        this.nextTime += STEP;
      }
    }

    async importSample(note, bytes) {
      if (!Number.isInteger(note) || note < 0 || note >= 32) throw new Error("Invalid note");
      this.init();
      if (bytes.byteLength > 12 * 1024 * 1024) throw new Error("Sample too large");
      const buffer = await this.context.decodeAudioData(bytes);
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 10) throw new Error("Invalid duration");
      // Normalize once on import, never allocate PCM buffers on each key press.
      let peak = 0;
      for (let c = 0; c < buffer.numberOfChannels; c += 1) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
      }
      if (peak > 0) {
        const scale = Math.min(4, 0.85 / peak);
        for (let c = 0; c < buffer.numberOfChannels; c += 1) {
          const data = buffer.getChannelData(c);
          for (let i = 0; i < data.length; i += 1) data[i] *= scale;
        }
      }
      this.samples.set(note, buffer);
    }
  }

  const api = { AudioEngine, TEMPO, STEP };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KonatapAudio = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
