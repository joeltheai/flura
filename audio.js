(() => {
  "use strict";

const { clamp, chordNotes, degreeNote, laneIndex, stepTime, barIndex } = window.FluraMusic;

// A short lookahead schedules notes against the audio clock, independent of paint.
class Instrument extends EventTarget {
  constructor(chord, lanes) {
    super();
    this.chord = { ...chord }; this.lanes = lanes;
    this.bpm = 122; this.rate = .25; this.swing = 0; this.volume = 55;
    this.muted = false; this.bypass = false; this.playing = false;
    this.progression = []; this.voices = new Set(); this.events = [];
    this.synth = { ...Instrument.DEFAULTS };
    this.generation = 0; this.starting = false;
  }
  async ready() {
    // iOS otherwise treats Web Audio as ambient sound, which follows Silent Mode.
    // Request music playback during the same tap that starts/resumes audio.
    try {
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') {
        navigator.audioSession.type = 'playback';
      }
    } catch {
      // Older browsers may expose the API without allowing this session type.
    }
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('This browser does not support Web Audio.');
      const ctx = this.context = new AudioContext();
      this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.volume / 100 * .6;
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -18; this.compressor.ratio.value = 5;
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 256;
      this.master.connect(this.compressor).connect(this.analyser).connect(ctx.destination);
      this.delay = ctx.createDelay(1); this.delay.delayTime.value = .23;
      const feedback = ctx.createGain(); feedback.gain.value = .18;
      const wet = ctx.createGain(); wet.gain.value = .17;
      this.delay.connect(feedback).connect(this.delay);
      this.delay.connect(wet).connect(this.master);
      this.vibrato = ctx.createOscillator(); this.vibrato.frequency.value = this.synth.vibratoRate;
      this.vibratoDepth = ctx.createGain(); this.vibratoDepth.gain.value = this.synth.vibratoDepth;
      this.vibrato.connect(this.vibratoDepth); this.vibrato.start();
      this.rebuildWave();
      ctx.addEventListener('statechange', () => {
        if (ctx.state !== 'running' && this.playing) this.stop();
      });
    }
    if (this.context.state !== 'running') await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Audio is paused. Tap play to try again.');
  }
  emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail })); }
  async start() {
    if (this.playing || this.starting) return;
    this.starting = true;
    const generation = ++this.generation;
    try {
      await this.ready();
      if (generation !== this.generation) return;
      this.playing = true;
      this.restart();
      this.timer = window.setInterval(() => this.schedule(), 25);
      this.emit('playback', true);
    } finally { if (generation === this.generation) this.starting = false; }
  }
  stop() {
    this.generation++; this.starting = false; this.playing = false;
    this.auditionGeneration = (this.auditionGeneration || 0) + 1;
    clearInterval(this.timer); this.events.length = 0; this.silence();
    this.emit('playback', false);
  }
  restart() {
    if (!this.playing) return;
    this.silence('arp'); this.events.length = 0;
    this.anchor = this.context.currentTime + .025; this.nextStep = 0;
    this.lastBar = -1;
    this.schedule();
  }
  schedule() {
    if (!this.playing) return;
    const now = this.context.currentTime;
    const time = step => this.anchor + stepTime(step, this.bpm, this.rate, this.swing);
    if (time(this.nextStep) < now - .2) {
      this.nextStep = Math.max(0, Math.ceil((now - this.anchor) / (this.rate * 60 / this.bpm)));
    }
    while (time(this.nextStep) < now + .09) {
      const step = this.nextStep++, when = Math.max(now, time(step));
      const bar = barIndex(step, this.rate);
      const chord = this.progression.length === 4 ? this.progression[bar % 4] : this.chord;
      const notes = chordNotes(chord);
      let midi = null;
      if (this.bypass) {
        if (bar !== this.lastBar) {
          notes.forEach(note => this.note(note, when, 4 * 60 / this.bpm * .92, .65));
          midi = notes[0];
        }
      } else {
        const values = Object.fromEntries(Object.entries(this.lanes).map(([key, lane]) => {
          const index = laneIndex(lane, step);
          return [key, lane.mutes[index] ? null : lane.values[index]];
        }));
        if (Object.values(values).every(v => v !== null)) {
          midi = clamp(degreeNote(values.note, notes) + values.octave * 12, 12, 108);
          const duration = (time(step + 1) - time(step)) * values.gate / 100;
          this.note(midi, when, duration, values.velocity / 100);
        }
      }
      this.lastBar = bar;
      this.events.push({ when, step, bar, chord, midi });
    }
  }
  note(midi, when, duration, velocity, source = 'arp') {
    const ctx = this.context, s = this.synth;
    // Keep long releases and high tempos bounded on mobile devices.
    if (this.voices.size >= 24) {
      const oldest = this.voices.values().next().value;
      oldest.oscillators.forEach(osc => osc.stop(ctx.currentTime));
      this.voices.delete(oldest);
    }
    const count = s.voices;
    const gain = ctx.createGain(), filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = s.cutoff; filter.Q.value = .3 + s.resonance / 10;
    filter.connect(gain); gain.connect(this.master); gain.connect(this.delay);
    const peak = velocity * .2;
    const off = when + Math.max(.005, duration);
    const oscillators = [], mixers = [];
    const voice = {
      gain, filter, oscillators, mixers, source, stopped: false, peak,
      t: when, off, a: s.attack, d: s.decay, s: s.sustain, r: s.release,
    };
    voice.releaseFrom = Instrument.attackDecayLevel(off - when, voice);
    gain.gain.setValueAtTime(0, when);
    // A short gate releases from the actual partial attack/decay level.
    if (off < when + voice.a) {
      gain.gain.linearRampToValueAtTime(peak * voice.releaseFrom, off);
    } else {
      gain.gain.linearRampToValueAtTime(peak, when + voice.a);
      if (off < when + voice.a + voice.d) {
        gain.gain.linearRampToValueAtTime(peak * voice.releaseFrom, off);
      } else {
        gain.gain.linearRampToValueAtTime(peak * voice.s, when + voice.a + voice.d);
        gain.gain.setValueAtTime(peak * voice.s, off);
      }
    }
    gain.gain.linearRampToValueAtTime(0, off + voice.r);
    for (let i = 0; i < count; i++) {
      const osc = ctx.createOscillator(), mix = ctx.createGain();
      const position = count === 1 ? 0 : i * 2 / (count - 1) - 1;
      osc.setPeriodicWave(this.periodicWave);
      osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
      osc.detune.value = position * s.detune;
      osc._position = position;
      mix.gain.value = .65 / Math.sqrt(count);
      this.vibratoDepth.connect(osc.detune);
      osc.connect(mix).connect(filter); osc.start(when); osc.stop(off + voice.r + .03);
      oscillators.push(osc); mixers.push(mix);
    }
    const sub = ctx.createOscillator(), subMix = ctx.createGain();
    sub.type = 'sine'; sub.frequency.value = 440 * 2 ** ((midi - 81) / 12);
    subMix.gain.value = s.sub / 100 * .18;
    sub.connect(subMix).connect(filter); sub.start(when); sub.stop(off + voice.r + .03);
    oscillators.push(sub); mixers.push(subMix);
    this.voices.add(voice);
    sub.onended = () => {
      for (const osc of oscillators) {
        if (osc !== sub) this.vibratoDepth.disconnect(osc.detune);
        osc.disconnect();
      }
      mixers.forEach(mix => mix.disconnect()); gain.disconnect(); filter.disconnect();
      this.voices.delete(voice);
    };
  }
  silence(source) {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      if ((source && voice.source !== source) || voice.stopped) continue;
      voice.stopped = true;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.peak * Instrument.envelopeLevel(voice, now), now);
      voice.gain.gain.linearRampToValueAtTime(0, now + .025);
      voice.oscillators.forEach(osc => osc.stop(now + .045));
    }
  }
  async audition(chord, duration = .65) {
    const generation = this.auditionGeneration = (this.auditionGeneration || 0) + 1;
    await this.ready();
    if (generation !== this.auditionGeneration) return;
    this.silence('audition');
    chordNotes(chord).forEach(midi => this.note(midi, this.context.currentTime + .01, duration, .65, 'audition'));
  }
  rebuildWave() {
    if (!this.context) return;
    const real = new Float32Array(65), imag = new Float32Array(65);
    const { wave, morph } = this.synth, mix = morph / 100;
    for (let n = 1; n < imag.length; n++) {
      let harmonic = 0;
      if (wave === 'sine') harmonic = n === 1 ? 1 : 0;
      if (wave === 'sawtooth') harmonic = (n % 2 ? 1 : -1) / n;
      if (wave === 'square') harmonic = n % 2 ? 1 / n : 0;
      if (wave === 'triangle') harmonic = n % 2 ? (-1) ** ((n - 1) / 2) / (n * n) : 0;
      imag[n] = harmonic * (1 - mix) + (n === 1 ? mix : 0);
    }
    this.periodicWave = this.context.createPeriodicWave(real, imag);
    for (const voice of this.voices) {
      voice.oscillators.forEach(osc => { if (osc._position !== undefined) osc.setPeriodicWave(this.periodicWave); });
    }
  }
  setSynth(patch) {
    Object.assign(this.synth, patch);
    if (this.context) {
      const now = this.context.currentTime, s = this.synth;
      if ('wave' in patch || 'morph' in patch) this.rebuildWave();
      this.vibratoDepth.gain.setTargetAtTime(s.vibratoDepth, now, .04);
      this.vibrato.frequency.setTargetAtTime(s.vibratoRate, now, .04);
      for (const voice of this.voices) {
        voice.filter.frequency.setTargetAtTime(s.cutoff, now, .03);
        voice.filter.Q.setTargetAtTime(.3 + s.resonance / 10, now, .03);
        voice.oscillators.forEach(osc => {
          if (osc._position !== undefined) osc.detune.setTargetAtTime(osc._position * s.detune, now, .02);
        });
        voice.mixers.at(-1).gain.setTargetAtTime(s.sub / 100 * .18, now, .02);
      }
    }
    this.emit('synth', { ...this.synth });
  }
  envelopeActivity() {
    if (!this.context) return null;
    const now = this.context.currentTime;
    let active;
    for (const voice of this.voices) {
      if (!voice.stopped && voice.t <= now && now < voice.off + voice.r) active = voice;
    }
    if (!active) return null;
    const elapsed = now - active.t;
    let phase, progress;
    if (now >= active.off) { phase = 'release'; progress = (now - active.off) / active.r; }
    else if (elapsed < active.a) { phase = 'attack'; progress = elapsed / active.a; }
    else if (elapsed < active.a + active.d) { phase = 'decay'; progress = (elapsed - active.a) / active.d; }
    else { phase = 'sustain'; progress = .5; }
    return { phase, progress, level: Instrument.envelopeLevel(active, now) };
  }
  setVolume() {
    this.master?.gain.setTargetAtTime(this.muted ? 0 : this.volume / 100 * .6, this.context.currentTime, .025);
  }
  updateVisuals() {
    if (!this.context) return;
    let latest;
    while (this.events.length && this.events[0].when <= this.context.currentTime) latest = this.events.shift();
    if (latest) this.emit('step', latest);
  }
}

Instrument.DEFAULTS = Object.freeze({
  wave: 'sawtooth', voices: 7, detune: 4, morph: 20, sub: 12,
  cutoff: 3240, resonance: 12, vibratoDepth: 1.8, vibratoRate: 1.2,
  attack: .005, decay: .24, sustain: .08, release: .42,
});
Instrument.attackDecayLevel = (elapsed, voice) => {
  if (elapsed < 0) return 0;
  if (voice.a > 0 && elapsed < voice.a) return elapsed / voice.a;
  if (voice.d > 0 && elapsed < voice.a + voice.d) return 1 + (voice.s - 1) * (elapsed - voice.a) / voice.d;
  return voice.s;
};
Instrument.envelopeLevel = (voice, time) => {
  if (time >= voice.off) {
    if (voice.r <= 0) return 0;
    return voice.releaseFrom * Math.max(0, 1 - (time - voice.off) / voice.r);
  }
  return Instrument.attackDecayLevel(time - voice.t, voice);
};
window.FluraInstrument = Instrument;
})();
