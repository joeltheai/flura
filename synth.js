(() => {
  'use strict';
  const { clamp } = window.FluraMusic;
  const svg = (tag, attrs) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  };
  const seconds = value => value < 1 ? `${Math.round(value * 1000)}ms` : `${value.toFixed(2)}s`;
  const specs = {
    voices: { label: 'voices', min: 1, max: 7, step: 1, format: String },
    detune: { label: 'detune', min: 0, max: 50, step: .1, format: value => `${Number(value.toFixed(1))}ct` },
    morph: { label: 'position', min: 0, max: 100, step: 1, format: value => `${value}%` },
    sub: { label: 'sub', min: 0, max: 100, step: 1, format: value => `${value}%` },
    cutoff: { label: 'cutoff', min: 70, max: 18000, step: 1, log: true, format: value => value < 1000 ? `${value}Hz` : `${(value / 1000).toFixed(2)}kHz` },
    resonance: { label: 'resonance', min: 0, max: 100, step: 1, format: value => `${value}%` },
    vibratoDepth: { label: 'vibrato depth', min: 0, max: 20, step: .1, format: value => `${Number(value.toFixed(1))}ct` },
    vibratoRate: { label: 'vibrato rate', min: .1, max: 12, step: .1, format: value => `${Number(value.toFixed(1))}Hz` },
    attack: { label: 'attack', min: .001, max: 2, step: .001, log: true, format: seconds },
    decay: { label: 'decay', min: .001, max: 2, step: .001, log: true, format: seconds },
    sustain: { label: 'sustain', min: 0, max: 1, step: .01, format: value => `${Math.round(value * 100)}%` },
    release: { label: 'release', min: .005, max: 3, step: .001, log: true, format: seconds },
  };
  const envelopeKeys = ['attack', 'decay', 'sustain', 'release'];
  const synthKeys = Object.keys(specs).filter(key => !envelopeKeys.includes(key));
  const span = (value, max) => 30 + 60 * (value / max) ** .35;
  const timeFromSpan = (value, max) => max * clamp((value - 30) / 60, 0, 1) ** (1 / .35);

  window.FluraSynthControls = instrument => {
    const inputs = new Map(), outputs = new Map();
    const envelope = document.querySelector('#envelope');
    let points = [];
    function setParam(key, value) {
      const spec = specs[key];
      const rounded = Number((Math.round(value / spec.step) * spec.step).toFixed(4));
      instrument.setSynth({ [key]: clamp(rounded, spec.min, spec.max) });
    }
    function buildGroup(container, keys, name) {
      const group = document.createElement('div');
      group.className = 'control-section';
      group.setAttribute('role', 'group'); group.setAttribute('aria-label', name);
      keys.forEach(key => {
        const spec = specs[key], row = document.createElement('div');
        row.className = 'control';
        row.innerHTML = `<label for="${key}">${spec.label}</label><output for="${key}"></output><input id="${key}" type="range" aria-label="${spec.label}" />`;
        const input = row.querySelector('input');
        input.min = spec.log ? 0 : spec.min; input.max = spec.log ? 1000 : spec.max;
        input.step = spec.log ? 1 : spec.step;
        input.addEventListener('input', () => {
          const value = spec.log ? spec.min * (spec.max / spec.min) ** (+input.value / 1000) : +input.value;
          setParam(key, value);
        });
        input.addEventListener('dblclick', () => setParam(key, instrument.constructor.DEFAULTS[key]));
        inputs.set(key, input); outputs.set(key, row.querySelector('output'));
        group.append(row);
      });
      container.append(group);
    }
    const synthContainer = document.querySelector('#synth-controls');
    buildGroup(synthContainer, ['voices', 'detune', 'morph', 'sub'], 'Oscillator');
    buildGroup(synthContainer, ['cutoff', 'resonance'], 'Filter');
    buildGroup(synthContainer, ['vibratoDepth', 'vibratoRate'], 'Vibrato');
    buildGroup(document.querySelector('#envelope-controls'), envelopeKeys, 'ADSR envelope');

    envelopeKeys.forEach(key => {
      const point = svg('g', { id: `env-${key}`, class: 'env-point', 'data-param': key, role: 'slider', tabindex: 0, 'aria-label': `${specs[key].label} envelope point`, 'aria-orientation': key === 'sustain' ? 'vertical' : 'horizontal' });
      point.append(svg('circle', { class: 'env-hit', r: 30 }), svg('circle', { class: 'env-dot', r: 3 }));
      document.querySelector('#env-handles').append(point);
      const label = svg('text', { id: `env-label-${key}`, y: 198 });
      label.textContent = key[0].toUpperCase();
      document.querySelector('#env-labels').append(label);
    });
    function drawEnvelope() {
      const s = instrument.synth;
      const a = 20 + span(s.attack, 2), d = a + span(s.decay, 2), hold = d + 55, r = hold + span(s.release, 3);
      const y = 172 - s.sustain * 144;
      points = [
        { key: 'attack', x: a, y: 28 }, { key: 'decay', x: d, y },
        { key: 'sustain', x: hold, y }, { key: 'release', x: r, y: 172 },
      ];
      const path = `M20 172L${a} 28L${d} ${y}L${hold} ${y}L${r} 172`;
      document.querySelector('#env-line').setAttribute('d', path);
      document.querySelector('#env-area').setAttribute('d', path + 'H20Z');
      document.querySelector('#env-guides').replaceChildren(...points.map(point => svg('path', { d: `M${point.x} ${point.y}V172` })));
      points.forEach((point, index) => {
        const handle = document.querySelector(`#env-${point.key}`), spec = specs[point.key];
        handle.setAttribute('transform', `translate(${point.x} ${point.y})`);
        handle.setAttribute('aria-valuemin', spec.min); handle.setAttribute('aria-valuemax', spec.max);
        handle.setAttribute('aria-valuenow', s[point.key]); handle.setAttribute('aria-valuetext', spec.format(s[point.key]));
        document.querySelector(`#env-label-${point.key}`).setAttribute('x', ((index ? points[index - 1].x : 20) + point.x) / 2);
      });
    }
    function sync() {
      const s = instrument.synth;
      for (const [key, input] of inputs) {
        const spec = specs[key], value = s[key];
        input.value = spec.log ? Math.log(value / spec.min) / Math.log(spec.max / spec.min) * 1000 : value;
        input.setAttribute('aria-valuetext', spec.format(value));
        outputs.get(key).value = spec.format(value);
      }
      document.querySelectorAll('[data-wave]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.wave === s.wave)));
      drawEnvelope();
      window.dispatchEvent(new CustomEvent('flura:synth', { detail: { ...s } }));
    }
    instrument.addEventListener('synth', sync);
    document.querySelectorAll('[data-wave]').forEach(button => button.addEventListener('click', () => instrument.setSynth({ wave: button.dataset.wave })));
    document.querySelector('#reset').addEventListener('click', () => {
      const defaults = instrument.constructor.DEFAULTS;
      instrument.setSynth(Object.fromEntries(['wave', ...synthKeys].map(key => [key, defaults[key]])));
    });
    document.querySelector('#reset-envelope').addEventListener('click', () => {
      const defaults = instrument.constructor.DEFAULTS;
      instrument.setSynth(Object.fromEntries(envelopeKeys.map(key => [key, defaults[key]])));
    });
    document.querySelector('#randomize').addEventListener('click', () => {
      const ranges = { voices: [1, 7], detune: [0, 18], morph: [0, 80], sub: [0, 45], cutoff: [500, 12000], resonance: [0, 40], vibratoDepth: [0, 5], vibratoRate: [.3, 6] };
      const patch = {};
      for (const key of synthKeys) {
        const [low, high] = ranges[key], spec = specs[key];
        patch[key] = Number((Math.round((low + Math.random() * (high - low)) / spec.step) * spec.step).toFixed(4));
      }
      instrument.setSynth(patch);
    });

    let drag;
    envelope.addEventListener('pointerdown', event => {
      if (!event.target.closest('[data-param]') || event.button !== 0 || !event.isPrimary) return;
      const rect = envelope.getBoundingClientRect();
      const x = (event.clientX - rect.left) * 360 / rect.width, y = (event.clientY - rect.top) * 210 / rect.height;
      const point = points.reduce((closest, item) => Math.hypot(item.x - x, item.y - y) < Math.hypot(closest.x - x, closest.y - y) ? item : closest);
      drag = { key: point.key, pointer: event.pointerId, x: event.clientX, y: event.clientY, value: instrument.synth[point.key], sustain: instrument.synth.sustain };
      envelope.setPointerCapture(event.pointerId); event.preventDefault();
    });
    envelope.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointer) return;
      const rect = envelope.getBoundingClientRect();
      const dx = (event.clientX - drag.x) * 360 / rect.width, dy = (event.clientY - drag.y) * 210 / rect.height;
      if (drag.key === 'sustain') setParam('sustain', drag.value - dy / 144);
      else {
        const max = drag.key === 'release' ? 3 : 2;
        setParam(drag.key, timeFromSpan(span(drag.value, max) + dx, max));
        if (drag.key === 'decay') setParam('sustain', drag.sustain - dy / 144);
      }
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => envelope.addEventListener(type, () => { drag = null; }));
    document.querySelector('#env-handles').addEventListener('keydown', event => {
      const key = event.target.dataset.param;
      if (!key || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const spec = specs[key];
      setParam(key, event.key === 'Home' ? spec.min : event.key === 'End' ? spec.max : instrument.synth[key] + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1) * spec.step * (event.shiftKey ? 10 : 1));
    });
    sync();
    return {
      updateActivity(visible) {
        if (!visible) return;
        const activity = instrument.envelopeActivity();
        const marker = document.querySelector('#env-activity'), playhead = document.querySelector('#env-playhead');
        marker.toggleAttribute('hidden', !activity); playhead.toggleAttribute('hidden', !activity);
        if (!activity) return;
        const index = envelopeKeys.indexOf(activity.phase), from = index ? points[index - 1].x : 20;
        const x = from + (points[index].x - from) * clamp(activity.progress, 0, 1);
        marker.setAttribute('cx', x); marker.setAttribute('cy', 172 - activity.level * 144);
        playhead.setAttribute('d', `M${x} 28V172`);
      },
    };
  };
})();
