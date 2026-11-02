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
    this.flower = { bloom: 78, petals: 9, curl: 35, height: 3.5, petalLength: 1.35, leafLength: 1.35, leafCount: 3, sway: 30, spin: 10 };
    this.generation = 0; this.starting = false;
  }
  async ready() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('This browser does not support Web Audio.');
      const ctx = this.context = new AudioContext();
      this.master = ctx.createGain(); this.master.gain.value = this.volume / 100 * .6;
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -18; this.compressor.ratio.value = 5;
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 256;
      this.master.connect(this.compressor).connect(this.analyser).connect(ctx.destination);
      this.delay = ctx.createDelay(1); this.delay.delayTime.value = .23;
      const feedback = ctx.createGain(); feedback.gain.value = .18;
      const wet = ctx.createGain(); wet.gain.value = .17;
      this.delay.connect(feedback).connect(this.delay);
      this.delay.connect(wet).connect(this.master);
      this.vibrato = ctx.createOscillator(); this.vibrato.frequency.value = 2.2;
      this.vibratoDepth = ctx.createGain(); this.vibratoDepth.gain.value = 1.8;
      this.vibrato.connect(this.vibratoDepth); this.vibrato.start();
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
    const ctx = this.context, f = this.flower;
    const count = clamp(Math.round((f.petals - 5) / 4) + 1, 1, 4);
    const gain = ctx.createGain(), filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = this.cutoff(); filter.Q.value = .5 + f.curl / 100 * 1.8;
    gain.connect(filter); filter.connect(this.master); filter.connect(this.delay);
    const attack = .006 + (f.petalLength - .65) * .026;
    const decay = .06 + f.height * .045;
    const release = .13 + f.height * .08;
    const peak = velocity * .2;
    const sustain = peak * (.12 + f.leafLength * .15);
    const off = when + Math.max(attack + .005, duration);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + attack);
    const decayEnd = Math.min(when + attack + decay, off);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0001, sustain), decayEnd);
    gain.gain.setValueAtTime(Math.max(.0001, sustain), off);
    gain.gain.exponentialRampToValueAtTime(.0001, off + release);
    const oscillators = [], mixers = [];
    const voice = { gain, filter, oscillators, mixers, source, stopped: false };
    for (let i = 0; i < count; i++) {
      const osc = ctx.createOscillator(), mix = ctx.createGain();
      const position = count === 1 ? 0 : i * 2 / (count - 1) - 1;
      osc.type = i % 2 ? 'triangle' : 'sawtooth';
      osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
      osc.detune.value = position * f.curl / 100 * 18;
      osc._position = position;
      mix.gain.value = .65 / count;
      this.vibratoDepth.connect(osc.detune);
      osc.connect(mix).connect(gain); osc.start(when); osc.stop(off + release + .03);
      oscillators.push(osc); mixers.push(mix);
    }
    const sub = ctx.createOscillator(), subMix = ctx.createGain();
    sub.type = 'sine'; sub.frequency.value = 440 * 2 ** ((midi - 81) / 12);
    subMix.gain.value = f.leafCount * .018;
    sub.connect(subMix).connect(gain); sub.start(when); sub.stop(off + release + .03);
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
      voice.gain.gain.setTargetAtTime(.0001, now, .008);
      voice.oscillators.forEach(osc => osc.stop(now + .045));
    }
  }
  async audition(chord) {
    const generation = this.auditionGeneration = (this.auditionGeneration || 0) + 1;
    await this.ready();
    if (generation !== this.auditionGeneration) return;
    this.silence('audition');
    chordNotes(chord).forEach(midi => this.note(midi, this.context.currentTime + .01, .65, .65, 'audition'));
  }
  cutoff() { return 180 + (this.flower.bloom / 100) ** 2 * 10000; }
  setFlower(state) {
    Object.assign(this.flower, state);
    if (!this.context) return;
    const now = this.context.currentTime;
    this.vibratoDepth.gain.setTargetAtTime(this.flower.sway / 100 * 6, now, .04);
    this.vibrato.frequency.setTargetAtTime(.7 + this.flower.spin / 100 * 5, now, .04);
    for (const voice of this.voices) {
      voice.filter.frequency.setTargetAtTime(this.cutoff(), now, .03);
      voice.filter.Q.setTargetAtTime(.5 + this.flower.curl / 100 * 1.8, now, .03);
      voice.oscillators.forEach(osc => {
        if (osc._position !== undefined) osc.detune.setTargetAtTime(osc._position * this.flower.curl / 100 * 18, now, .02);
      });
    }
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

window.FluraInstrument = Instrument;
})();
