// NEON DRIFT (SPACEMAN) — renovated build.
// One button. Three lanes. Dodge the asteroids, grab the stars.
// Controls: SPACE / ArrowUp / ArrowDown / click / tap to switch lanes.
// ?demo=1 makes the astronaut fly itself (autopilot) — used to record gameplay.
//
// Renovation notes (v3):
// - Performance: NOTHING expensive runs per-frame any more. All glows are
//   baked once into offscreen sprites at init (shadowBlur is never used in
//   the hot loop); the background (gradient + nebula + ringed planet + moon
//   + lane guides) is one pre-rendered layer; the starfield is three
//   scrolling parallax tiles; particles are capped and drawn as rects.
//   DPR is capped at 1.5 so phones stop rendering a 1920-wide backing
//   store for a 390px-wide screen.
// - Collectible is a real 5-point star now (was two crossed bars = looked
//   like a yellow X). Gold star vs grey-pink rock: unmistakable.
// - Background is a real deep-space scene: layered nebula, a ringed planet,
//   a cratered moon, 3-depth parallax starfield, occasional shooting stars,
//   speed lines at high speed. Still dark, so the hero and rocks pop.
// - Mechanics are UNCHANGED: lanes, speed curve, spawn rates, hitbox,
//   collision point, scoring. Only the ?demo=1 autopilot got smarter
//   (it is a recording aid, not gameplay) so long takes are possible.
(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // Logical playfield (16:9). The canvas is scaled to the window.
  const W = 960;
  const H = 540;
  const LANES = [H * 0.30, H * 0.50, H * 0.70];
  const SHIP_X = W * 0.16;
  const DEMO = new URLSearchParams(location.search).get('demo') === '1';

  let state = 'title'; // title | playing | over
  let lane = 1;
  let shipY = LANES[1];
  let score = 0;
  let best = 0;
  let speed = 260;
  let elapsed = 0;
  let spawnTimer = 0;
  let starTimer = 0;
  let titleTimer = 0;
  let overTimer = 0;
  let flash = 0;
  let shootTimer = 6;
  let asteroids = [];
  let stars = [];
  let parts = [];
  let streaks = [];
  let speedLines = [];

  // ---------- touch controls: drag-follow + tap + on-screen buttons ----------
  // The astronaut FOLLOWS the finger 1:1 while dragging — no inversion:
  // screen Y grows downward and so does shipY, so finger up = astronaut up.
  // Release snaps to the nearest lane; a plain tap moves one lane toward
  // the tap point. Buttons and keyboard arrows move one lane at a time.
  let dragging = false;
  let dragPointerId = null;
  let dragStartY = 0;
  let dragStartShipY = 0;
  let dragMoved = false;

  function canvasY(clientY) {
    const r = canvas.getBoundingClientRect();
    return ((clientY - r.top) / r.height) * H;
  }
  function nearestLane(y) {
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < 3; i++) {
      const d = Math.abs(LANES[i] - y);
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    return bestIdx;
  }

  try { best = Number(localStorage.getItem('neon-drift-best') || 0); } catch (e) { best = 0; }

  // ---------- original background music (WebAudio sequencer, no audio files) ----------
  // Chords follow the video bed: Am9 – Fmaj7 – Cmaj7 – G6 at 128 BPM.
  // Everything is synthesized live (oscillators + one tiny noise buffer), so
  // the loop is seamless, needs no network, and costs nothing per frame:
  // the scheduler runs on a 90 ms timer (~20 tiny envelopes a second) and
  // does zero work inside the rAF loop.
  const MUSIC_BPM = 128;
  const SIXTEENTH = 60 / MUSIC_BPM / 4; // 0.1171875 s
  const MUSIC_CHORDS = [
    { bass: 110.00, pad: [220.00, 261.63, 329.63, 493.88], arp: [220.00, 261.63, 329.63, 440.00, 493.88, 659.25] }, // Am9
    { bass: 87.31, pad: [174.61, 220.00, 261.63, 329.63], arp: [174.61, 220.00, 261.63, 349.23, 329.63, 440.00] }, // Fmaj7
    { bass: 130.81, pad: [196.00, 246.94, 261.63, 329.63], arp: [196.00, 261.63, 329.63, 392.00, 493.88, 523.25] }, // Cmaj7
    { bass: 98.00, pad: [196.00, 246.94, 293.66, 329.63], arp: [196.00, 246.94, 293.66, 392.00, 329.63, 493.88] }, // G6
  ];
  const ARP_PATTERN = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 3, 2, 1];

  let audioCtx = null;
  let musicBus = null; // master music gain (mute ramps this to 0)
  let noiseBuf = null;
  let musicStarted = false;
  let musicMuted = false;
  let musicStep = 0; // 16th-step counter, global across bars
  let musicNextTime = 0;
  let musicTimer = null;
  try { musicMuted = localStorage.getItem('neon-drift-muted') === '1'; } catch (e) { musicMuted = false; }

  function unlockAudio() {
    if (!audioCtx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
        musicBus = audioCtx.createGain();
        musicBus.gain.value = musicMuted ? 0 : 0.5;
        musicBus.connect(audioCtx.destination);
        // 0.1 s of white noise, reused by the hats.
        noiseBuf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.1), audioCtx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  }

  function tone(freq, t, dur, type, vol) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function kick(t) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    g.gain.setValueAtTime(0.30, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + 0.16);
  }
  function hat(t) {
    const s = audioCtx.createBufferSource();
    s.buffer = noiseBuf;
    const f = audioCtx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7000;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    s.connect(f); f.connect(g); g.connect(musicBus);
    s.start(t); s.stop(t + 0.06);
  }
  function scheduleStep(step, t) {
    const bar = Math.floor(step / 16) % 4;
    const s16 = step % 16;
    const ch = MUSIC_CHORDS[bar];
    if (s16 === 0) {
      // Pad: whole-bar chord, slow attack, gentle release.
      for (const f of ch.pad) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.045, t + 0.35);
        g.gain.setValueAtTime(0.045, t + 1.5);
        g.gain.linearRampToValueAtTime(0, t + 1.9);
        o.connect(g); g.connect(musicBus);
        o.start(t); o.stop(t + 1.95);
      }
    }
    if (s16 % 4 === 0) {
      // Bass on quarters: root, root, fifth, root — plus a soft kick.
      tone(s16 === 8 ? ch.bass * 1.5 : ch.bass, t, 0.5, 'triangle', 0.28);
      kick(t);
    }
    if (s16 % 4 === 2) hat(t);
    // Arpeggio on every 16th, rising then falling.
    tone(ch.arp[ARP_PATTERN[s16]], t, 0.2, 'triangle', 0.11);
  }
  function musicTick() {
    if (!audioCtx) return;
    while (musicNextTime < audioCtx.currentTime + 0.3) {
      scheduleStep(musicStep, musicNextTime);
      musicNextTime += SIXTEENTH;
      musicStep++;
    }
  }
  function startMusic() {
    if (musicStarted || !audioCtx) return;
    musicStarted = true;
    musicStep = 0;
    musicNextTime = audioCtx.currentTime + 0.08;
    musicTimer = setInterval(musicTick, 90);
  }
  function updateMuteBtn() {
    const b = document.getElementById('muteBtn');
    if (!b) return;
    b.textContent = musicMuted ? '♪ OFF' : '♪ ON';
    b.classList.toggle('off', musicMuted);
    b.setAttribute('aria-pressed', String(!musicMuted));
  }
  function setMuted(m) {
    musicMuted = m;
    try { localStorage.setItem('neon-drift-muted', m ? '1' : '0'); } catch (e) { /* private mode */ }
    if (musicBus && audioCtx) musicBus.gain.setTargetAtTime(m ? 0 : 0.5, audioCtx.currentTime, 0.05);
    updateMuteBtn();
  }
  function toggleMute() {
    unlockAudio();
    if (!musicStarted) startMusic();
    setMuted(!musicMuted);
  }

  // Probe hooks (same style as __perf / __game below).
  window.__music = {
    state: () => (audioCtx ? audioCtx.state : 'none'),
    started: () => musicStarted,
    muted: () => musicMuted,
    steps: () => musicStep,
    ctx: () => audioCtx,
    bus: () => musicBus,
  };

  // ---------- tiny helpers ----------
  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function starPath(g, cx, cy, outer, inner, points) {
    g.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
  }

  // ---------- pre-rendered background layer ----------
  // Gradient + nebula + ringed planet + cratered moon + lane guides.
  // Drawn once per frame as a single drawImage.
  const bgLayer = mk(W, H);
  (function buildBackground() {
    const g = bgLayer.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0b0620');
    grad.addColorStop(0.55, '#12082e');
    grad.addColorStop(1, '#05010f');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    // Nebula: soft radial blobs, baked.
    const neb = (x, y, r, color, a) => {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, color.replace('A', String(a)));
      rg.addColorStop(1, color.replace('A', '0'));
      g.fillStyle = rg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    neb(W * 0.78, H * 0.18, 190, 'rgba(124, 58, 237, A)', 0.20);
    neb(W * 0.14, H * 0.86, 160, 'rgba(219, 39, 119, A)', 0.16);
    neb(W * 0.46, H * 0.58, 210, 'rgba(13, 148, 136, A)', 0.10);
    neb(W * 0.92, H * 0.72, 150, 'rgba(59, 90, 246, A)', 0.12);
    neb(W * 0.30, H * 0.10, 120, 'rgba(168, 85, 247, A)', 0.10);

    // Cratered moon, bottom-left.
    const mx = 108, my = 452, mr = 34;
    const mg = g.createRadialGradient(mx - 12, my - 14, 4, mx, my, mr + 2);
    mg.addColorStop(0, '#f1f5f9');
    mg.addColorStop(0.55, '#cbd5e1');
    mg.addColorStop(1, '#64748b');
    g.fillStyle = mg;
    g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(15, 23, 42, 0.20)';
    g.beginPath(); g.arc(mx - 10, my - 6, 7, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(mx + 8, my + 10, 9, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(mx + 14, my - 12, 5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(mx - 2, my + 16, 4, 0, Math.PI * 2); g.fill();

    // Ringed planet, top-right — kept clear of the HUD (BEST/SPEED live
    // at y<80 on the right), so it sits just below them.
    const px = 838, py = 132, pr = 44;
    g.save();
    g.translate(px, py);
    g.rotate(-0.32);
    g.strokeStyle = 'rgba(216, 180, 254, 0.45)';
    g.lineWidth = 8;
    g.beginPath(); g.ellipse(0, 0, 74, 16, 0, Math.PI, Math.PI * 2); g.stroke();
    g.restore();
    const pg = g.createRadialGradient(px - 18, py - 20, 6, px, py, pr + 4);
    pg.addColorStop(0, '#d6c8ff');
    pg.addColorStop(0.45, '#8b7bc7');
    pg.addColorStop(0.8, '#3f3468');
    pg.addColorStop(1, '#241d40');
    g.fillStyle = pg;
    g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    // Faint bands across the sphere.
    g.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    g.lineWidth = 7;
    g.beginPath(); g.arc(px, py - 6, pr - 8, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    g.beginPath(); g.arc(px, py + 12, pr - 6, Math.PI * 1.2, Math.PI * 1.8); g.stroke();
    g.save();
    g.translate(px, py);
    g.rotate(-0.32);
    g.strokeStyle = 'rgba(216, 180, 254, 0.55)';
    g.lineWidth = 8;
    g.beginPath(); g.ellipse(0, 0, 74, 16, 0, 0, Math.PI); g.stroke();
    g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    g.lineWidth = 2.5;
    g.beginPath(); g.ellipse(0, -2, 74, 16, 0, 0.15, Math.PI - 0.15); g.stroke();
    g.restore();

    // Lane guides (static, so they live in the background).
    g.save();
    g.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    g.setLineDash([8, 14]);
    g.lineWidth = 2;
    for (const y of LANES) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    g.restore();
  })();

  // ---------- parallax starfield (batched fillRects, NOT fullscreen tiles) ----------
  // Lesson from measuring: 3 fullscreen star tiles = 6 fullscreen blits per
  // frame, which is slower than 100 tiny fillRects in software rendering.
  // Stars are drawn grouped by layer (one fillStyle/alpha set per layer).
  const TILE_SPEEDS = [36, 54, 78];
  const fieldLayers = [0, 1, 2].map((layer) => {
    const count = [46, 34, 22][layer];
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: [0.7 + Math.random() * 0.6, 1.1 + Math.random() * 0.8, 1.6 + Math.random() * 1.0][layer],
        // A few stars are tinted cyan / warm instead of white.
        tint: Math.random() < 0.78 ? '' : Math.random() < 0.55 ? '#a5f3fc' : '#fde68a',
        // A few near stars get a cross sparkle.
        spark: layer === 2 && Math.random() < 0.22,
      });
    }
    return arr;
  });

  // ---------- hero sprites: 4 leg-kick phases, glow baked in ----------
  // The figure is the same full-body astronaut as before — same coords,
  // same colors, same chunky details. Only the rendering changed: the
  // cyan glow is baked once here instead of shadowBlur every frame.
  const heroSprites = [-1, -0.33, 0.33, 1].map((kick) => {
    const c = mk(150, 130);
    const g = c.getContext('2d');
    g.translate(75, 65);
    g.scale(1.25, 1.25);
    g.lineJoin = 'round';
    g.lineCap = 'round';

    // Legs: two PARALLEL capsules trailing down-back (swimmer's kick).
    g.strokeStyle = '#f1f5f9';
    g.lineWidth = 6;
    g.shadowColor = '#22d3ee'; g.shadowBlur = 12;
    g.beginPath(); g.moveTo(-12, 8); g.lineTo(-23, 13 + kick * 1.6); g.stroke();
    g.beginPath(); g.moveTo(-11, 12); g.lineTo(-21, 20 - kick * 1.6); g.stroke();
    g.shadowBlur = 0;
    // Boots: light rounded blobs, cyan outline, dark sole dot.
    g.fillStyle = '#e2e8f0';
    g.beginPath(); g.arc(-24, 14 + kick * 1.6, 4.4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(-22, 21 - kick * 1.6, 4.4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#22d3ee'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(-24, 14 + kick * 1.6, 4.4, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(-22, 21 - kick * 1.6, 4.4, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#334155';
    g.beginPath(); g.arc(-24, 16.5 + kick * 1.6, 1.5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(-22, 23.5 - kick * 1.6, 1.5, 0, Math.PI * 2); g.fill();

    // Back arm (tucks behind the torso).
    g.strokeStyle = '#f1f5f9'; g.lineWidth = 6;
    g.shadowColor = '#22d3ee'; g.shadowBlur = 10;
    g.beginPath(); g.moveTo(-6, 2); g.lineTo(-13, 10); g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = '#f8fafc';
    g.beginPath(); g.arc(-14, 11, 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#22d3ee'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(-14, 11, 4, 0, Math.PI * 2); g.stroke();

    // Backpack: rounded rect + cyan stripe + orange dot.
    g.fillStyle = '#cbd5e1';
    g.shadowColor = '#22d3ee'; g.shadowBlur = 12;
    rr(g, -25, -16, 15, 13, 4); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = '#22d3ee'; g.lineWidth = 2;
    rr(g, -25, -16, 15, 13, 4); g.stroke();
    g.fillStyle = '#22d3ee'; g.fillRect(-19, -16, 3, 13);
    g.fillStyle = '#fb923c';
    g.beginPath(); g.arc(-17, -16, 2.2, 0, Math.PI * 2); g.fill();

    // Torso: white capsule, cyan outline, chest panel + belt + patch.
    g.fillStyle = '#f8fafc';
    g.shadowColor = '#22d3ee'; g.shadowBlur = 16;
    rr(g, -14, -4, 22, 17, 8); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = '#22d3ee'; g.lineWidth = 2;
    rr(g, -14, -4, 22, 17, 8); g.stroke();
    g.fillStyle = '#fb923c';
    rr(g, -2, 0, 9, 8, 2); g.fill();
    g.fillStyle = '#22d3ee';
    g.beginPath(); g.arc(1, 4, 1.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f8fafc';
    g.beginPath(); g.arc(5.5, 4, 1.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#64748b'; g.fillRect(-13, 9, 20, 3);
    g.fillStyle = '#22d3ee'; g.fillRect(-1, 9, 3, 3);
    g.fillStyle = '#f472b6';
    g.beginPath(); g.arc(-9, -1, 2.2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#f8fafc'; g.lineWidth = 1;
    g.beginPath(); g.arc(-9, -1, 2.2, 0, Math.PI * 2); g.stroke();

    // Helmet: white ring, dark visor, bright reflection.
    g.fillStyle = '#f8fafc';
    g.shadowColor = '#22d3ee'; g.shadowBlur = 18;
    g.beginPath(); g.arc(9, -9, 12.5, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = '#22d3ee'; g.lineWidth = 2;
    g.beginPath(); g.arc(9, -9, 12.5, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#0b1220';
    g.beginPath(); g.arc(10, -9, 8.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(236, 254, 255, 0.95)'; g.lineWidth = 2.8;
    g.beginPath(); g.moveTo(6, -13); g.lineTo(11, -6); g.stroke();
    g.beginPath(); g.moveTo(11, -14); g.lineTo(15, -9); g.stroke();
    g.fillStyle = '#22d3ee';
    g.beginPath(); g.arc(13, -5, 1.4, 0, Math.PI * 2); g.fill();
    // Antenna.
    g.strokeStyle = '#cbd5e1'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(4, -20); g.lineTo(2, -25); g.stroke();

    // Front arm: reaching forward, kept high off the chest panel.
    g.strokeStyle = '#f1f5f9'; g.lineWidth = 6;
    g.shadowColor = '#22d3ee'; g.shadowBlur = 10;
    g.beginPath(); g.moveTo(0, -1); g.lineTo(12, 3); g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = '#f8fafc';
    g.beginPath(); g.arc(13, 4, 4.2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#22d3ee'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(13, 4, 4.2, 0, Math.PI * 2); g.stroke();
    return c;
  });

  // Thruster flame sprite (orange, glow baked) — scaled per frame to flicker.
  const flameSprite = mk(40, 24);
  (function () {
    const g = flameSprite.getContext('2d');
    g.fillStyle = '#fb923c';
    g.shadowColor = '#fb923c'; g.shadowBlur = 10;
    g.beginPath();
    g.moveTo(36, 5); g.lineTo(6, 12); g.lineTo(36, 19);
    g.closePath(); g.fill();
    g.fillStyle = '#fde68a';
    g.beginPath();
    g.moveTo(36, 8.5); g.lineTo(16, 12); g.lineTo(36, 15.5);
    g.closePath(); g.fill();
  })();

  // Antenna blink dot (orange, glow baked).
  const blinkSprite = mk(16, 16);
  (function () {
    const g = blinkSprite.getContext('2d');
    g.fillStyle = '#fb923c';
    g.shadowColor = '#fb923c'; g.shadowBlur = 8;
    g.beginPath(); g.arc(8, 8, 2.4, 0, Math.PI * 2); g.fill();
  })();

  // ---------- asteroid sprites: 6 variants, glow baked ----------
  const rockSprites = Array.from({ length: 6 }, () => {
    const c = mk(120, 120);
    const g = c.getContext('2d');
    g.translate(60, 60);
    const bumps = Array.from({ length: 7 }, () => 0.75 + Math.random() * 0.45);
    g.beginPath();
    for (let i = 0; i < bumps.length; i++) {
      const ang = (i / bumps.length) * Math.PI * 2;
      const r = 40 * bumps[i];
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = '#3f3f46';
    g.strokeStyle = '#fb7185';
    g.lineWidth = 2.5;
    g.shadowColor = '#fb7185'; g.shadowBlur = 14;
    g.fill(); g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = '#52525b';
    g.beginPath();
    g.arc(-10, -8, 7.2, 0, Math.PI * 2);
    g.arc(12, 10, 5.2, 0, Math.PI * 2);
    g.fill();
    return { c, bumps };
  });

  // ---------- collectible star sprite: a real 5-point star ----------
  const starSprite = mk(72, 72);
  (function () {
    const g = starSprite.getContext('2d');
    g.translate(36, 36);
    starPath(g, 0, 0, 26, 10.5, 5);
    g.fillStyle = '#facc15';
    g.strokeStyle = '#fde68a';
    g.lineWidth = 1.5;
    g.shadowColor = '#facc15'; g.shadowBlur = 16;
    g.fill(); g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = '#fffbeb';
    starPath(g, 0, 0, 9, 3.6, 5);
    g.fill();
  })();

  // ---------- shooting-star streak sprite ----------
  const streakSprite = mk(120, 16);
  (function () {
    const g = streakSprite.getContext('2d');
    const lg = g.createLinearGradient(0, 0, 120, 0);
    lg.addColorStop(0, 'rgba(226, 232, 240, 0)');
    lg.addColorStop(0.8, 'rgba(226, 232, 240, 0.55)');
    lg.addColorStop(1, 'rgba(255, 255, 255, 0.95)');
    g.fillStyle = lg;
    g.fillRect(0, 6, 120, 4);
    g.fillStyle = '#ffffff';
    g.shadowColor = '#e2e8f0'; g.shadowBlur = 8;
    g.beginPath(); g.arc(112, 8, 3, 0, Math.PI * 2); g.fill();
  })();

  // ---------- title / game-over text sprites (glow baked) ----------
  function textSprite(w, h, drawFn) {
    const c = mk(w, h);
    drawFn(c.getContext('2d'));
    return c;
  }
  const titleSprite = textSprite(960, 220, (g) => {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 84px "Segoe UI", system-ui, sans-serif';
    g.shadowColor = '#22d3ee'; g.shadowBlur = 18;
    g.fillStyle = '#22d3ee';
    g.fillText('NEON DRIFT', 480, 78);
    g.shadowBlur = 0;
    g.font = '600 22px "Segoe UI", system-ui, sans-serif';
    g.shadowColor = '#f472b6'; g.shadowBlur = 14;
    g.fillStyle = '#f472b6';
    g.fillText('ONE PROMPT. ONE BUTTON. THREE LANES.', 480, 142);
  });
  const overSprite = textSprite(960, 110, (g) => {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 64px "Segoe UI", system-ui, sans-serif';
    g.shadowColor = '#fb7185'; g.shadowBlur = 18;
    g.fillStyle = '#fb7185';
    g.fillText('GAME OVER', 480, 55);
  });

  // ---------- game logic (mechanics UNCHANGED) ----------
  function resize() {
    // Cap DPR so the backing store never exceeds ~2x the displayed CSS
    // width: on phones the old cap of 2 made a 1920-wide backing for a
    // ~390px screen — pure overdraw. The CSS-width term is what protects
    // phones; the hard cap (2.0) is only for hi-dpi desktops.
    const cssW = canvas.clientWidth || W;
    const dpr = Math.min(window.devicePixelRatio || 1, 2, (cssW * 2) / W);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // Speed lines (recycled, cheap rects).
  for (let i = 0; i < 12; i++) {
    speedLines.push({ x: Math.random() * W, y: Math.random() * H, len: 40 + Math.random() * 80 });
  }

  function burst(x, y, color, n, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (40 + Math.random() * power) * (0.5 + Math.random());
      parts.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0.5 + Math.random() * 0.5,
        max: 1,
        color,
        r: 1.5 + Math.random() * 2.5,
      });
    }
    // Cap: particles are juice, not a memory leak.
    if (parts.length > 120) parts.splice(0, parts.length - 120);
  }

  function spawnWave() {
    // Never block all three lanes at once: pick 1 or 2 lanes, leave one open.
    const order = [0, 1, 2].sort(() => Math.random() - 0.5);
    const count = Math.random() < 0.55 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const r = 16 + Math.random() * 24;
      asteroids.push({
        x: W + r + Math.random() * 60,
        lane: order[i],
        y: LANES[order[i]],
        r,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 2.4,
        variant: Math.floor(Math.random() * rockSprites.length),
      });
    }
  }

  function spawnStar() {
    const laneIdx = Math.floor(Math.random() * 3);
    stars.push({ x: W + 20, y: LANES[laneIdx], r: 12, tw: Math.random() * Math.PI * 2 });
  }

  function reset() {
    lane = 1;
    shipY = LANES[1];
    score = 0;
    speed = 260;
    elapsed = 0;
    spawnTimer = 0.4;
    starTimer = 1.2;
    asteroids = [];
    stars = [];
    parts = [];
    streaks = [];
    flash = 0;
  }

  function startGame() {
    reset();
    state = 'playing';
  }

  function gameOver() {
    state = 'over';
    overTimer = 0;
    flash = 1;
    burst(SHIP_X, shipY, '#22d3ee', 60, 260);
    burst(SHIP_X, shipY, '#f472b6', 40, 180);
    if (score > best) {
      best = Math.floor(score);
      try { localStorage.setItem('neon-drift-best', String(best)); } catch (e) { /* private mode */ }
    }
  }

  function switchLane(dir) {
    const next = Math.max(0, Math.min(2, lane + dir));
    if (next !== lane) {
      lane = next;
      burst(SHIP_X - 14, shipY, '#22d3ee', 8, 90);
    }
  }

  function autopilot(dt) {
    // Demo-only pilot (recording aid — never affects real players).
    // For each lane, the times until its rocks reach the ship, nearest
    // first. Stay while the nearest rock in our lane is > 1.4s away;
    // otherwise take the lane that stays clear longest — nearest-rock
    // time first, second-rock time as the tiebreaker, so the pilot never
    // dodges into a rock train.
    const times = [[], [], []];
    for (const a of asteroids) {
      if (a.x > SHIP_X - 10) times[a.lane].push((a.x - SHIP_X) / speed);
    }
    for (const l of times) l.sort((x, y) => x - y);
    const t1 = times.map((t) => (t.length ? t[0] : 99));
    const combined = times.map((t) => {
      const second = t.length > 1 ? Math.min(t[1], 3) : 3;
      return (t.length ? t[0] : 99) + 0.3 * second;
    });
    if (t1[lane] > 1.4) {
      if (t1[0] > 2.5 && t1[1] > 2.5 && t1[2] > 2.5 && lane !== 1) lane = 1;
      return;
    }
    let bestLane = lane;
    let bestScore = combined[lane];
    for (let l = 0; l < 3; l++) {
      if (l === lane) continue;
      if (combined[l] > bestScore) { bestScore = combined[l]; bestLane = l; }
    }
    if (bestLane !== lane) lane = bestLane;
  }

  function update(dt) {
    // Starfield always drifts (parallax, 3 depths).
    const drift = state === 'playing' ? 1 + speed / 500 : 1;
    for (let i = 0; i < 3; i++) {
      const v = TILE_SPEEDS[i] * drift * dt;
      for (const s of fieldLayers[i]) {
        s.x -= v;
        if (s.x < -4) { s.x = W + 4; s.y = Math.random() * H; }
      }
    }
    // Shooting stars.
    shootTimer -= dt;
    if (shootTimer <= 0) {
      streaks.push({ x: 620 + Math.random() * 340, y: -12, vx: -620, vy: 300, life: 1 });
      shootTimer = 7 + Math.random() * 7;
    }
    for (const s of streaks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt * 0.9;
    }
    streaks = streaks.filter((s) => s.life > 0 && s.y < H + 20);
    // Speed lines only matter at high speed.
    if (speed > 420) {
      for (const l of speedLines) {
        l.x -= speed * 1.7 * dt;
        if (l.x < -l.len) { l.x = W + Math.random() * 120; l.y = Math.random() * H; }
      }
    }
    for (const p of parts) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.life -= dt;
    }
    parts = parts.filter((p) => p.life > 0);
    if (flash > 0) flash = Math.max(0, flash - dt * 2);

    // Smooth lane movement — skipped while the finger drives shipY directly.
    if (!dragging) shipY += (LANES[lane] - shipY) * Math.min(1, dt * 14);

    if (state === 'title') {
      titleTimer += dt;
      if (DEMO && titleTimer > 0.6) startGame();
      return;
    }
    if (state === 'over') {
      overTimer += dt;
      for (const a of asteroids) a.x -= speed * 0.35 * dt;
      asteroids = asteroids.filter((a) => a.x > -80);
      if (DEMO && overTimer > 1.0) startGame();
      return;
    }

    // Playing.
    elapsed += dt;
    score += dt * 10;
    speed = Math.min(620, 260 + elapsed * 7);

    if (DEMO) autopilot(dt);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnWave();
      spawnTimer = Math.max(0.34, 0.62 - elapsed * 0.004);
    }
    starTimer -= dt;
    if (starTimer <= 0) {
      spawnStar();
      starTimer = 0.9 + Math.random() * 1.1;
    }

    for (const a of asteroids) {
      a.x -= speed * dt;
      a.rot += a.vr * dt;
    }
    asteroids = asteroids.filter((a) => a.x > -80);
    for (const s of stars) {
      s.x -= speed * dt;
      s.tw += dt * 6;
    }
    stars = stars.filter((s) => s.x > -30);

    // Collisions: hero is a small circle at the chest/helmet (sx, shipY).
    // Same point and radius as before — difficulty unchanged.
    const sx = SHIP_X + 10;
    for (const a of asteroids) {
      const dx = a.x - sx;
      const dy = a.y - shipY;
      if (dx * dx + dy * dy < (a.r * 0.82) * (a.r * 0.82)) {
        gameOver();
        return;
      }
    }
    for (let i = stars.length - 1; i >= 0; i--) {
      const s = stars[i];
      const dx = s.x - sx;
      const dy = s.y - shipY;
      if (dx * dx + dy * dy < 34 * 34) {
        score += 10;
        burst(s.x, s.y, '#facc15', 14, 140);
        stars.splice(i, 1);
      }
    }
  }

  function drawText(text, x, y, size, color, align, weight) {
    ctx.save();
    ctx.font = `${weight || 700} ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawSpaceman() {
    const t = elapsed; // drives bob + leg kick (0 on the title screen)
    const bob = Math.sin(t * 2.2) * 2.2;
    const kick = Math.sin(t * 5.0);
    const lean = Math.max(-0.10, Math.min(0.10, (LANES[lane] - shipY) * 0.0012));
    // Pick the kick phase nearest the current leg position.
    const phase = kick < -0.66 ? 0 : kick < 0 ? 1 : kick < 0.66 ? 2 : 3;
    ctx.save();
    ctx.translate(SHIP_X, shipY + bob);
    ctx.rotate(lean);
    ctx.drawImage(heroSprites[phase], -75, -65);
    // Thruster flame: horizontal flicker scale, smooth (no per-frame random).
    const fs = 0.55 + 0.25 * Math.sin(t * 21) + 0.12 * Math.sin(t * 37);
    ctx.drawImage(flameSprite, -30 - 40 * fs, -18.25, 40 * fs, 24);
    // Antenna light blinks.
    if (Math.sin(t * 4) > 0) ctx.drawImage(blinkSprite, -5.5, -40.5);
    ctx.restore();
  }

  function draw() {
    // One baked background image.
    ctx.drawImage(bgLayer, 0, 0);
    // Parallax starfield: batched fillRects, one fillStyle/alpha per layer.
    const layerAlpha = [0.55, 0.75, 1];
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = layerAlpha[i];
      ctx.fillStyle = '#e2e8f0';
      for (const s of fieldLayers[i]) {
        if (!s.tint) {
          ctx.fillRect(s.x, s.y, s.r, s.r);
          if (s.spark) {
            ctx.fillRect(s.x - 3, s.y + s.r / 2 - 0.5, 6 + s.r, 1);
            ctx.fillRect(s.x + s.r / 2 - 0.5, s.y - 3, 1, 6 + s.r);
          }
        }
      }
      // Tinted stars: few enough that per-star fillStyle is fine.
      for (const s of fieldLayers[i]) {
        if (s.tint) {
          ctx.fillStyle = s.tint;
          ctx.fillRect(s.x, s.y, s.r, s.r);
          ctx.fillStyle = '#e2e8f0';
        }
      }
    }
    ctx.globalAlpha = 1;
    // Shooting stars.
    for (const s of streaks) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.life) * 0.9;
      ctx.translate(s.x, s.y);
      ctx.rotate(Math.atan2(s.vy, s.vx));
      ctx.drawImage(streakSprite, -112, -8);
      ctx.restore();
    }
    // Speed lines at high speed.
    if (speed > 420) {
      ctx.fillStyle = 'rgba(165, 243, 252, 0.10)';
      for (const l of speedLines) ctx.fillRect(l.x, l.y, l.len, 2);
    }

    // Collectible stars (real 5-point stars, slow spin + twinkle).
    for (const s of stars) {
      const tw = 0.6 + 0.4 * Math.sin(s.tw);
      const k = s.r / 26;
      ctx.save();
      ctx.globalAlpha = tw;
      ctx.translate(s.x, s.y);
      ctx.rotate(s.tw * 0.15);
      ctx.drawImage(starSprite, -36 * k, -36 * k, 72 * k, 72 * k);
      ctx.restore();
    }
    // Asteroids (pre-rendered variants, rotated + scaled).
    for (const a of asteroids) {
      const spr = rockSprites[a.variant].c;
      const k = a.r / 40;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot);
      ctx.drawImage(spr, -60 * k, -60 * k, 120 * k, 120 * k);
      ctx.restore();
    }
    // Particles as cheap rects.
    for (const p of parts) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;

    if (state !== 'over') drawSpaceman();

    // HUD (no glow — plain fillText is fast).
    drawText(`SCORE ${Math.floor(score)}`, 24, 30, 24, '#e2e8f0', 'left', 700);
    drawText(`BEST ${best}`, W - 24, 30, 24, '#94a3b8', 'right', 600);
    drawText(`SPEED ${Math.round(speed / 10)}`, W - 24, 60, 15, '#64748b', 'right', 600);

    if (state === 'title') {
      ctx.fillStyle = 'rgba(5, 1, 15, 0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(titleSprite, 0, H * 0.36 - 78);
      const blink = 0.55 + 0.45 * Math.sin(titleTimer * 5);
      ctx.globalAlpha = blink;
      drawText('SPACE / CLICK / TAP TO SWITCH LANES', W / 2, H * 0.62, 22, '#e2e8f0', 'center', 700);
      ctx.globalAlpha = 1;
      drawText('Dodge the rocks. Grab the stars. How long can you last?', W / 2, H * 0.62 + 38, 17, '#94a3b8', 'center', 500);
      if (DEMO) drawText('AUTOPILOT — THE AGENT IS FLYING', W / 2, H * 0.80, 15, '#facc15', 'center', 700);
    }

    if (state === 'over') {
      ctx.fillStyle = 'rgba(5, 1, 15, 0.62)';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(overSprite, 0, H * 0.38 - 55);
      drawText(`SCORE ${Math.floor(score)}`, W / 2, H * 0.38 + 64, 28, '#e2e8f0', 'center', 700);
      if (Math.floor(score) >= best && score > 0) {
        drawText('NEW BEST!', W / 2, H * 0.38 + 104, 22, '#facc15', 'center', 700);
      }
      const blink = 0.55 + 0.45 * Math.sin(overTimer * 5);
      ctx.globalAlpha = blink;
      drawText('PRESS SPACE TO FLY AGAIN', W / 2, H * 0.66, 20, '#e2e8f0', 'center', 700);
      ctx.globalAlpha = 1;
    }

    if (flash > 0) {
      ctx.fillStyle = `rgba(251, 113, 133, ${flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // Frame-time stats for probes (ring buffer, cheap).
  const perfRing = [];
  window.__perf = { frames: 0, avgMs: 0, p95Ms: 0 };
  window.__game = {
    state: () => state,
    score: () => Math.floor(score),
    speed: () => Math.round(speed),
    elapsed: () => +elapsed.toFixed(1),
    shipY: () => Math.round(shipY),
    lane: () => lane,
    dragging: () => dragging,
  };

  function loop(t) {
    const dt = Math.min(0.05, (t - (loop.last || t)) / 1000 || 0);
    loop.last = t;
    if (dt > 0) {
      perfRing.push(dt * 1000);
      if (perfRing.length > 240) perfRing.shift();
      if (perfRing.length % 60 === 0) {
        const s = [...perfRing].sort((a, b) => a - b);
        window.__perf.frames = perfRing.length;
        window.__perf.avgMs = +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2);
        window.__perf.p95Ms = +s[Math.floor(0.95 * (s.length - 1))].toFixed(2);
      }
    }
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function onPress(e) {
    if (e) e.preventDefault();
    if (state === 'title' || state === 'over') {
      startGame();
      return;
    }
    // One button (SPACE): alternate direction each press, so a single key plays.
    switchLane(lane === 0 ? 1 : lane === 2 ? -1 : (onPress.lastDir = -(onPress.lastDir || 1)));
  }
  onPress.lastDir = 1;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') { toggleMute(); return; }
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      unlockAudio();
      startMusic();
      if (e.code === 'ArrowUp') {
        if (state === 'playing') switchLane(-1);
        else startGame();
      } else if (e.code === 'ArrowDown') {
        if (state === 'playing') switchLane(1);
        else startGame();
      } else {
        onPress();
      }
    }
  });

  // Pointer controls on the canvas: drag-follow (1:1, no inversion) + tap.
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlockAudio();
    startMusic();
    if (state === 'title' || state === 'over') { startGame(); return; }
    dragging = true;
    dragPointerId = e.pointerId;
    dragStartY = canvasY(e.clientY);
    dragStartShipY = shipY;
    dragMoved = false;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* old browser */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragPointerId) return;
    e.preventDefault();
    const y = canvasY(e.clientY);
    const dy = y - dragStartY;
    if (Math.abs(dy) > 6) dragMoved = true;
    // 1:1 follow, clamped to the lane band (never off-screen).
    shipY = Math.max(LANES[0], Math.min(LANES[2], dragStartShipY + dy));
    lane = nearestLane(shipY); // live lane, no burst while dragging
  });
  function endDrag(e) {
    if (!dragging) return;
    if (e.pointerId !== undefined && e.pointerId !== dragPointerId) return;
    dragging = false;
    dragPointerId = null;
    if (!dragMoved && typeof e.clientY === 'number') {
      // Plain tap: one lane toward the tap point (relative to the astronaut).
      const y = canvasY(e.clientY);
      if (y < shipY - 12) switchLane(-1);
      else if (y > shipY + 12) switchLane(1);
    } else {
      lane = nearestLane(shipY); // snap; update() eases shipY onto the lane
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // On-screen lane buttons (big, thumb-friendly, below the stage).
  function bindLaneBtn(el, dir) {
    if (!el) return;
    let lastFire = 0;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      lastFire = performance.now();
      unlockAudio();
      startMusic();
      if (state === 'playing') switchLane(dir);
      else startGame();
    });
    // Keyboard Enter/Space on the focused button fires click; ignore the
    // click that follows a pointerdown so one press never moves two lanes.
    el.addEventListener('click', () => {
      if (performance.now() - lastFire < 600) return;
      unlockAudio();
      startMusic();
      if (state === 'playing') switchLane(dir);
      else startGame();
    });
  }
  bindLaneBtn(document.getElementById('btnUp'), -1);
  bindLaneBtn(document.getElementById('btnDown'), 1);

  // Mute button (corner overlay on the stage — clicks never reach the canvas).
  const muteBtn = document.getElementById('muteBtn');
  if (muteBtn) {
    muteBtn.addEventListener('click', (e) => { e.preventDefault(); toggleMute(); });
    updateMuteBtn();
  }

  requestAnimationFrame(loop);
})();
