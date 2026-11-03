(() => {
  "use strict";

const { clamp, NOTE_NAMES, MAJORS, MINORS, DEFAULT_CHORD, chordLabel, createLanes, laneIndex } = window.FluraMusic;
const Instrument = window.FluraInstrument;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const announce = text => { $('#announcement').textContent = text; };
const chord = { ...DEFAULT_CHORD };
const lanes = createLanes();
const instrument = new Instrument(chord, lanes);
let selectedLane = 'note', linked = true, currentView = 0;
let progression = [], capturing = false, captureBackup = [], lastStep = -1;
const error = reason => {
  $('#audio-error').textContent = `Couldn't start sound. ${reason.message || 'Tap play to try again.'}`;
  $('#audio-error').hidden = false;
};
const attempt = async action => {
  try { await action(); $('#audio-error').hidden = true; } catch (reason) { error(reason); }
};

// Native scroll snapping preserves momentum, swiping, and independent vertical scroll.
const carousel = $('.carousel');
const viewCount = $$('.view').length;
function syncView(index) {
  currentView = index;
  $$('[data-view]').forEach(button => {
    if (+button.dataset.view === index) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $$('.view').forEach((view, i) => { view.inert = i !== index; });
  $('#previous-view').disabled = index === 0;
  $('#next-view').disabled = index === viewCount - 1;
}
function goTo(index) {
  index = clamp(index, 0, viewCount - 1);
  carousel.scrollTo({ left: index * carousel.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}
$$('[data-view]').forEach(button => button.addEventListener('click', () => goTo(+button.dataset.view)));
$('#previous-view').addEventListener('click', () => goTo(currentView - 1));
$('#next-view').addEventListener('click', () => goTo(currentView + 1));
let scrollFrame;
carousel.addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null;
    const index = Math.round(carousel.scrollLeft / carousel.clientWidth);
    if (index !== currentView) syncView(index);
  });
}, { passive: true });
let previousWidth = carousel.clientWidth;
new ResizeObserver(() => {
  if (previousWidth === carousel.clientWidth) return;
  previousWidth = carousel.clientWidth;
  carousel.scrollTo({ left: currentView * previousWidth, behavior: 'instant' });
}).observe(carousel);
carousel.addEventListener('keydown', event => {
  if (event.target !== carousel) return;
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault(); goTo(currentView + (event.key === 'ArrowRight' ? 1 : -1));
  }
});
$('.view-tabs').addEventListener('keydown', event => {
  const index = +event.target.dataset.view;
  if (!Number.isFinite(index)) return;
  let next;
  if (event.key === 'ArrowRight') next = (index + 1) % viewCount;
  if (event.key === 'ArrowLeft') next = (index + viewCount - 1) % viewCount;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = viewCount - 1;
  if (next !== undefined) { event.preventDefault(); goTo(next); $(`.view-tabs [data-view="${next}"]`).focus(); }
});

const svg = (tag, attrs) => {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
};
function ringPath(inner, outer, start, end) {
  const p = (r, a) => [170 + Math.cos(a) * r, 170 + Math.sin(a) * r];
  return `M${p(outer,start)}A${outer},${outer} 0 0 1 ${p(outer,end)}L${p(inner,end)}A${inner},${inner} 0 0 0 ${p(inner,start)}Z`;
}
[MAJORS, MINORS].forEach((roots, mode) => roots.forEach((root, i) => {
  const angle = -Math.PI / 2 + i * Math.PI / 6;
  const path = svg('path', {
    d: ringPath(mode ? 68 : 116, mode ? 116 : 163, angle - Math.PI / 12, angle + Math.PI / 12),
    'data-root': root, 'data-minor': mode, 'aria-label': `${NOTE_NAMES[root]} ${mode ? 'minor' : 'major'}`,
    'aria-pressed': 'false', role: 'button', tabindex: '0',
  });
  path.addEventListener('click', () => chooseChord(root, !!mode));
  path.addEventListener('keydown', event => {
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); chooseChord(root, !!mode); }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const nextRoot = roots[(i + (event.key === 'ArrowRight' ? 1 : 11)) % 12];
      $(`#wheel path[data-root="${nextRoot}"][data-minor="${mode}"]`).focus();
    }
  });
  const label = svg('text', { x:170 + Math.cos(angle)*(mode ? 92 : 140), y:170 + Math.sin(angle)*(mode ? 92 : 140), class:mode ? 'minor' : 'major', 'data-label': `${root}-${mode}` });
  label.textContent = NOTE_NAMES[root] + (mode ? 'm' : '');
  $('#wheel').append(path, label);
}));
$('#wheel').append(svg('circle', { cx:170, cy:170, r:166, class:'wheel-outline' }));
function renderChord(config = chord) {
  displayedChord = { ...config };
  $$('#wheel path').forEach(path => path.setAttribute('aria-pressed', String(+path.dataset.root === config.root && !!+path.dataset.minor === config.minor)));
  $$('#wheel text').forEach(label => label.classList.toggle('selected', label.dataset.label === `${config.root}-${+config.minor}`));
  $('#chord-name').textContent = NOTE_NAMES[config.root] + (config.minor && config.extension !== 'sus' ? 'm' : '');
  $('#chord-quality').textContent = { triad: config.minor ? 'minor' : 'major', seventh:config.minor ? '7' : 'maj7', ninth:'add9', sus:'sus4' }[config.extension];
  $('#extension').value = config.extension; $('#voicing').value = config.inversion;
  $('#audition').setAttribute('aria-label', `Audition ${chordLabel(config)}`);
}
function chooseChord(root, minor) {
  Object.assign(chord, { root, minor, extension: $('#extension').value, inversion: +$('#voicing').value });
  instrument.chord = { ...chord };
  if (capturing) {
    progression.push({ ...chord });
    if (progression.length === 4) {
      capturing = false; instrument.progression = progression.map(c => ({ ...c }));
      if (instrument.playing) instrument.restart();
      else attempt(() => instrument.start());
      announce('Four chords captured. Progression looping.');
    } else announce(`Chord ${progression.length} captured. Choose ${4 - progression.length} more.`);
  } else {
    instrument.progression = [];
    if (instrument.bypass || instrument.retrigger) instrument.restart();
  }
  renderChord(); renderProgression();
  if (!instrument.playing && !instrument.starting) audition();
}
let auditionTimeout;
function audition() {
  $('#audition').classList.add('auditioning');
  clearTimeout(auditionTimeout);
  auditionTimeout = setTimeout(() => $('#audition').classList.remove('auditioning'), 650);
  return attempt(() => instrument.audition(instrument.playing && instrument.progression.length ? displayedChord : chord));
}
let displayedChord = chord;
$('#audition').addEventListener('click', audition);
['extension', 'voicing'].forEach(id => $(`#${id}`).addEventListener('change', () => {
  Object.assign(chord, displayedChord);
  chord.extension = $('#extension').value; chord.inversion = +$('#voicing').value;
  instrument.chord = { ...chord }; instrument.progression = [];
  renderChord(); renderProgression();
  if (!instrument.playing) audition(); else if (instrument.bypass || instrument.retrigger) instrument.restart();
}));
const loopButton = document.createElement('button');
loopButton.id = 'loop-progression'; loopButton.type = 'button'; loopButton.textContent = '↻'; loopButton.setAttribute('aria-label', 'Loop chord progression'); loopButton.title = 'Loop chord progression'; loopButton.hidden = true;
loopButton.setAttribute('aria-pressed', 'false');
$('#clear-progression').before(loopButton);
loopButton.addEventListener('click', () => {
  if (instrument.progression.length) {
    Object.assign(chord, displayedChord); instrument.chord = { ...chord };
  }
  instrument.progression = instrument.progression.length ? [] : progression.map(c => ({ ...c }));
  if (instrument.playing) instrument.restart();
  else if (instrument.progression.length) attempt(() => instrument.start());
  renderProgression();
});
function renderProgression(active = -1) {
  $('#capture').setAttribute('aria-pressed', String(capturing));
  $('#capture').setAttribute('aria-label', capturing ? `Cancel capture, ${progression.length} of 4 chords recorded` : 'Capture four chords');
  $$('[data-slot]').forEach((slot, i) => {
    const config = progression[i];
    slot.classList.toggle('filled', !!config);
    slot.classList.toggle('active', i === active && instrument.progression.length === 4);
    slot.classList.toggle('record-next', capturing && i === progression.length);
    slot.querySelector('strong').textContent = config ? chordLabel(config) : '·';
    slot.setAttribute('aria-label', config ? `Progression slot ${i + 1}, ${chordLabel(config)}` : `Progression slot ${i + 1}, empty`);
  });
  $('#clear-progression').hidden = !progression.length || capturing;
  loopButton.hidden = progression.length !== 4 || capturing;
  loopButton.setAttribute('aria-pressed', String(instrument.progression.length === 4));
}
function beginCapture() {
  if (capturing) { progression = captureBackup; capturing = false; announce('Recording cancelled.'); }
  else { captureBackup = [...progression]; progression = []; capturing = true; instrument.progression = []; announce('Choose four chords on the wheel.'); }
  renderProgression();
}
$('#capture').addEventListener('click', beginCapture);
$('#clear-progression').addEventListener('click', () => {
  Object.assign(chord, displayedChord); instrument.chord = { ...chord };
  progression = []; instrument.progression = [];
  if (instrument.bypass || instrument.retrigger) instrument.restart();
  renderProgression(); announce('Progression cleared.');
});
$$('[data-slot]').forEach(slot => slot.addEventListener('click', () => {
  const config = progression[+slot.dataset.slot];
  if (!config) { if (!capturing) beginCapture(); return; }
  if (capturing) return;
  Object.assign(chord, config); instrument.chord = { ...config }; instrument.progression = [];
  renderChord(); renderProgression();
  if (instrument.bypass || instrument.retrigger) instrument.restart();
  if (!instrument.playing) audition();
}));

function renderLane() {
  const lane = lanes[selectedLane];
  $$('.lane-tabs button').forEach(button => {
    const selected = button.dataset.lane === selectedLane;
    button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
  });
  $('#lane-panel').setAttribute('aria-labelledby', `tab-${selectedLane}`);
  $('#step-graph').replaceChildren(); $('#step-mutes').replaceChildren();
  for (let i = 0; i < lane.length; i++) {
    const cell = document.createElement('div');
    cell.className = 'step-cell'; cell.tabIndex = 0; cell.dataset.step = i;
    cell.setAttribute('role', 'slider'); cell.setAttribute('aria-orientation', 'vertical');
    cell.setAttribute('aria-label', `${lane.name} step ${i + 1}`);
    cell.setAttribute('aria-valuemin', lane.min); cell.setAttribute('aria-valuemax', lane.max);
    cell.innerHTML = '<div class="step-bar"><span class="step-value"></span></div>';
    cell.addEventListener('keydown', event => {
      let value = lane.values[i];
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') value++;
      else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') value--;
      else if (event.key === 'Home') value = lane.min;
      else if (event.key === 'End') value = lane.max;
      else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault(); lane.mutes[i] = !lane.mutes[i]; syncCell(i); return;
      } else return;
      event.preventDefault(); setStep(i, clamp(value, lane.min, lane.max));
    });
    $('#step-graph').append(cell);
    const mute = document.createElement('button');
    mute.type = 'button'; mute.dataset.step = i; mute.innerHTML = `<i></i><span>${String(i + 1).padStart(2, '0')}</span>`;
    mute.addEventListener('click', () => { lane.mutes[i] = !lane.mutes[i]; syncCell(i); });
    $('#step-mutes').append(mute); syncCell(i);
  }
  $('#lane-length').value = lane.length; $('#length-out').value = lane.length;
  $('#lane-division').value = lane.division;
  $('#lane-length').setAttribute('aria-label', `${lane.name} lane length`);
  updateRange($('#lane-length')); updatePlayhead();
}
function syncCell(i) {
  const lane = lanes[selectedLane], value = lane.values[i];
  const cell = $(`#step-graph [data-step="${i}"]`), mute = $(`#step-mutes [data-step="${i}"]`);
  if (!cell || !mute) return;
  cell.setAttribute('aria-valuenow', value);
  cell.setAttribute('aria-valuetext', `${value}${lane.mutes[i] ? ', muted' : ''}`);
  cell.classList.toggle('muted', lane.mutes[i]);
  cell.querySelector('.step-bar').style.height = `${10 + (value - lane.min) / (lane.max - lane.min) * 84}%`;
  cell.querySelector('.step-value').textContent = value;
  mute.setAttribute('aria-pressed', String(!lane.mutes[i]));
  mute.setAttribute('aria-label', `${lane.mutes[i] ? 'Enable' : 'Mute'} ${lane.name.toLowerCase()} step ${i + 1}`);
}
function setStep(i, value) {
  lanes[selectedLane].values[i] = value;
  if (selectedLane === 'note') { $('#pattern').value = 'custom'; renderChord(displayedChord); }
  syncCell(i);
}
const graph = $('#step-graph'); let drawing = null;
function drawStep(event) {
  const rect = graph.getBoundingClientRect(), lane = lanes[selectedLane];
  const index = clamp(Math.floor((event.clientX - rect.left) / rect.width * lane.length), 0, lane.length - 1);
  const amount = clamp((rect.bottom - event.clientY) / rect.height, 0, 1);
  setStep(index, Math.round(lane.min + amount * (lane.max - lane.min)));
}
graph.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  event.preventDefault(); drawing = event.pointerId; graph.setPointerCapture(event.pointerId); drawStep(event);
});
graph.addEventListener('pointermove', event => { if (event.pointerId === drawing) drawStep(event); });
const endDrawing = () => { drawing = null; };
graph.addEventListener('pointerup', endDrawing); graph.addEventListener('pointercancel', endDrawing); graph.addEventListener('lostpointercapture', endDrawing);
$$('[data-lane]').forEach(button => button.addEventListener('click', () => { selectedLane = button.dataset.lane; renderLane(); }));
$('.lane-tabs').addEventListener('keydown', event => {
  const ids = Object.keys(lanes), index = ids.indexOf(selectedLane); let next;
  if (event.key === 'ArrowRight') next = (index + 1) % 4;
  if (event.key === 'ArrowLeft') next = (index + 3) % 4;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = 3;
  if (next !== undefined) { event.preventDefault(); selectedLane = ids[next]; renderLane(); $(`#tab-${selectedLane}`).focus(); }
});
$('#lane-length').addEventListener('input', event => {
  const length = +event.target.value;
  if (linked) Object.values(lanes).forEach(lane => { lane.length = length; });
  else lanes[selectedLane].length = length;
  renderLane();
});
$('#lane-division').addEventListener('change', event => { lanes[selectedLane].division = +event.target.value; });
$('#link-lengths').addEventListener('click', () => {
  linked = !linked; $('#link-lengths').setAttribute('aria-pressed', String(linked));
  $('#link-lengths').title = linked ? 'Unlink lane lengths' : 'Link lane lengths';
  if (linked) Object.values(lanes).forEach(lane => { lane.length = lanes[selectedLane].length; });
});
$('#randomize-lane').addEventListener('click', () => {
  const lane = lanes[selectedLane];
  for (let i = 0; i < lane.length; i++) lane.values[i] = Math.floor(lane.min + Math.random() * (lane.max - lane.min + 1));
  if (selectedLane === 'note') { $('#pattern').value = 'custom'; renderChord(displayedChord); }
  renderLane(); announce(`${lane.name} lane randomized.`);
});
$('#pattern').addEventListener('change', event => {
  const patterns = { bloom:[1,2,3,5,4,3,2,4], up:[1,2,3,4,5,6,7,8], down:[8,7,6,5,4,3,2,1], drift:[1,4,2,6,3,8,5,2] };
  const pattern = patterns[event.target.value];
  if (pattern) lanes.note.values = Array.from({length:16}, (_, i) => pattern[i % 8]);
  renderLane(); renderChord(displayedChord);
});
$('#rate').addEventListener('change', event => { instrument.rate = +event.target.value; instrument.restart(); });
$('#retrigger').addEventListener('click', () => {
  instrument.retrigger = !instrument.retrigger;
  $('#retrigger').setAttribute('aria-pressed', String(instrument.retrigger));
});
$('#swing').addEventListener('input', event => { instrument.swing = +event.target.value / 100; $('#swing-out').value = `${event.target.value}%`; instrument.restart(); });
$('#arp-bypass').addEventListener('click', () => {
  instrument.bypass = !instrument.bypass;
  $('#arp-bypass').setAttribute('aria-pressed', String(instrument.bypass));
  $('#arp-bypass').setAttribute('aria-label', instrument.bypass ? 'Enable arpeggiator' : 'Bypass arpeggiator');
  instrument.restart(); renderChord(displayedChord);
});

function updateRange(input) { input.style.setProperty('--fill', `${(+input.value - +input.min) / (+input.max - +input.min) * 100}%`); }
$$('input[type=range]').forEach(input => { updateRange(input); input.addEventListener('input', () => updateRange(input)); });
$('#play').addEventListener('click', () => {
  if (instrument.playing || instrument.starting) instrument.stop();
  else attempt(() => instrument.start());
});
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || /INPUT|SELECT|TEXTAREA|BUTTON|A/.test(event.target.tagName) || event.target.getAttribute('role') === 'slider' || event.target.getAttribute('role') === 'button') return;
  event.preventDefault(); $('#play').click();
});
$('#tempo').addEventListener('change', event => {
  const bpm = clamp(Math.round(+event.target.value || 122), 40, 240);
  event.target.value = bpm; instrument.bpm = bpm; instrument.restart();
});
$('#volume').addEventListener('input', event => { instrument.volume = +event.target.value; instrument.setVolume(); });
$('#mute').addEventListener('click', () => {
  instrument.muted = !instrument.muted; instrument.setVolume();
  $('#mute').setAttribute('aria-pressed', String(instrument.muted));
  $('#mute').setAttribute('aria-label', instrument.muted ? 'Unmute' : 'Mute');
});
const synthControls = window.FluraSynthControls(instrument);
$('#audition-envelope').addEventListener('click', () => attempt(() => instrument.audition(displayedChord, Math.max(1.2, instrument.synth.attack + instrument.synth.decay + .5))));
function updatePlayhead() {
  const index = lastStep < 0 || instrument.bypass ? -1 : laneIndex(lanes[selectedLane], lastStep);
  $$('#step-graph .step-cell, #step-mutes button').forEach(cell => cell.classList.toggle('playing', +cell.dataset.step === index));
}
instrument.addEventListener('step', ({ detail }) => {
  lastStep = detail.step; displayedChord = detail.chord;
  updatePlayhead();
  if (instrument.progression.length === 4) { renderChord(detail.chord); renderProgression(detail.bar % 4); }
});
instrument.addEventListener('restart', () => { lastStep = -1; updatePlayhead(); });
instrument.addEventListener('playback', ({ detail: playing }) => {
  $('#play').setAttribute('aria-pressed', String(playing)); $('#play').setAttribute('aria-label', playing ? 'Stop' : 'Play');
  $('#play-icon').setAttribute('d', playing ? 'M7 5h4v14H7ZM14 5h4v14h-4Z' : 'm9 5 11 7-11 7Z');
  if (!playing) { lastStep = -1; updatePlayhead(); renderProgression(); }
});

const scope = $('#scope'), scopeContext = scope.getContext('2d'), samples = new Uint8Array(256);
function frame() {
  instrument.updateVisuals();
  synthControls.updateActivity(currentView === 3);
  scopeContext.clearRect(0, 0, scope.width, scope.height);
  scopeContext.beginPath(); scopeContext.strokeStyle = '#bbb'; scopeContext.lineWidth = 1.5;
  if (instrument.analyser) instrument.analyser.getByteTimeDomainData(samples); else samples.fill(128);
  for (let i = 0; i < samples.length; i++) {
    const x = i / (samples.length - 1) * scope.width, y = scope.height / 2 + (samples[i] - 128) / 128 * scope.height * 3.4;
    if (i === 0) scopeContext.moveTo(x, y); else scopeContext.lineTo(x, y);
  }
  scopeContext.stroke(); requestAnimationFrame(frame);
}
renderChord(); renderLane(); renderProgression(); requestAnimationFrame(frame);
window.fluraSnapshot = () => ({ playing:instrument.playing, audioState:instrument.context?.state ?? 'uninitialized', bpm:instrument.bpm, rate:instrument.rate, swing:instrument.swing, bypass:instrument.bypass, retrigger:instrument.retrigger, muted:instrument.muted, volume:instrument.volume, voices:instrument.voices.size, selectedView:currentView, chord:{...chord}, progression:progression.map(c => ({...c})), looping:instrument.progression.length === 4, capturing, selectedLane, linked, lanes:structuredClone(lanes), lastStep, synth:{...instrument.synth}, envelope:instrument.envelopeActivity(), flower:window.flowerSnapshot?.() });
window.addEventListener('pagehide', () => instrument.stop());
})();
