(() => {
  "use strict";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MAJORS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const MINORS = [9, 4, 11, 6, 1, 8, 3, 10, 5, 0, 7, 2];
const DEFAULT_CHORD = { root: 0, minor: false, extension: 'ninth', inversion: 0 };
function chordNotes({ root, minor, extension, inversion }) {
  let intervals = [0, minor ? 3 : 4, 7];
  if (extension === 'seventh') intervals.push(minor ? 10 : 11);
  if (extension === 'ninth') intervals.push(14);
  if (extension === 'sus') intervals = [0, 5, 7];
  const notes = intervals.map(n => 48 + root + n);
  for (let i = 0; i < inversion; i++) notes.push(notes.shift() + 12);
  return notes.sort((a, b) => a - b);
}
function chordLabel(chord) {
  const suffix = { triad: '', seventh: chord.minor ? '7' : 'maj7', ninth: ' add9', sus: ' sus4' }[chord.extension];
  return NOTE_NAMES[chord.root] + (chord.minor && chord.extension !== 'sus' ? 'm' : '') + suffix;
}
function degreeNote(degree, notes) {
  const index = Math.max(0, degree - 1);
  return notes[index % notes.length] + Math.floor(index / notes.length) * 12;
}
const laneIndex = (lane, step) => Math.floor(step / lane.division) % lane.length;
const stepTime = (step, bpm, rate, swing) => (step + (step % 2 ? swing : 0)) * rate * 60 / bpm;
const barIndex = (step, rate) => Math.floor((step * rate + 1e-8) / 4);
const LANE_SPECS = {
  note: { name: 'Note', description: 'Chord degree', min: 1, max: 8, values: [1, 2, 3, 5, 4, 3, 2, 4] },
  gate: { name: 'Gate', description: 'Note length · %', min: 10, max: 100, values: [72, 36, 90, 52, 64, 72, 36, 90] },
  velocity: { name: 'Velocity', description: 'Touch · %', min: 10, max: 100, values: [90, 50, 68, 44, 78, 55, 65, 90] },
  octave: { name: 'Octave', description: 'Octave offset', min: -2, max: 2, values: [0, 0, 1, 0, 0, 0, 1, 0] },
};
function createLanes() {
  return Object.fromEntries(Object.entries(LANE_SPECS).map(([key, spec]) => [key, {
    ...spec, length: 8, division: 1,
    values: Array.from({ length: 16 }, (_, i) => spec.values[i % spec.values.length]),
    mutes: Array(16).fill(false),
  }]));
}

window.FluraMusic = Object.freeze({ clamp, NOTE_NAMES, MAJORS, MINORS, DEFAULT_CHORD, chordNotes, chordLabel, degreeNote, laneIndex, stepTime, barIndex, LANE_SPECS, createLanes });
})();
