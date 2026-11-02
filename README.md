# flura

Open `index.html` in your browser. No install, build step, or server.

Swipe between Chords, Arp, Flower, and ADSR. Tap play to start sound.

On iPhone, the app requests a music playback audio session when supported. If Safari is silent, turn off Silent Mode, raise media volume, check the Bluetooth/AirPlay output, and tap play again after returning from another app or a phone call.

The outline flower follows the synth controls: waveform, voices, detune, position, sub, cutoff, resonance, and vibrato. Attack, decay, sustain, and release have their own slide with sliders and a draggable envelope graph. The play button beneath the graph auditions a held chord through the full envelope.

JavaScript lives in `app.js` (interface), `music.js` (chords and lanes), `audio.js` (sound), `synth.js` (synth controls and envelope), and `flower.js` (3D outline flower). The local Three.js library and its license are in `vendor/`.
