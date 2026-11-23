// NEON DRIFT — a tiny neon arcade dodger, built from one prompt.
// One button. Three lanes. Dodge the asteroids, grab the stars.
// Controls: SPACE / ArrowUp / ArrowDown / click / tap to switch lanes.
// ?demo=1 makes the ship fly itself (autopilot) — used to record gameplay.
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
  let asteroids = [];
  let stars = [];
  let parts = [];
  let field = [];

  try { best = Number(localStorage.getItem('neon-drift-best') || 0); } catch (e) { best = 0; }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // Starfield: three depth layers drifting left.
  for (let i = 0; i < 90; i++) {
    field.push({
      x: Math.random() * W,
      y: Math.random() * H,
      z: 0.3 + Math.random() * 0.7,
      r: 0.6 + Math.random() * 1.4,
    });
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
        bumps: Array.from({ length: 7 }, () => 0.75 + Math.random() * 0.45),
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
    // Look at the nearest asteroid ahead; if it is in our lane and close,
    // move to a lane with no asteroid near that x. Otherwise drift to middle.
    let threat = null;
    for (const a of asteroids) {
      if (a.x > SHIP_X - 20 && a.x < SHIP_X + 320) {
        if (!threat || a.x < threat.x) threat = a;
      }
    }
    if (threat && threat.lane === lane && threat.x - SHIP_X < 300) {
      const free = [0, 1, 2].filter((l) => {
        if (l === lane) return false;
        return !asteroids.some((a) => a.lane === l && Math.abs(a.x - threat.x) < 130);
      });
      if (free.length) {
        // Prefer the lane with the fewest asteroids ahead, then the middle.
        const danger = (l) => asteroids.filter((a) => a.lane === l && a.x > SHIP_X).length;
        free.sort((a, b) => danger(a) - danger(b) || Math.abs(a - 1) - Math.abs(b - 1));
        lane = free[0];
        return;
      }
    }
    // No threat: ease back to the middle lane for a tidy line.
    if (!threat && lane !== 1 && Math.random() < dt * 2) lane = 1;
  }

  function update(dt) {
    // Starfield always drifts.
    for (const s of field) {
      s.x -= (18 + 60 * s.z) * dt * (state === 'playing' ? 1 + speed / 500 : 1);
      if (s.x < -4) { s.x = W + 4; s.y = Math.random() * H; }
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

    // Smooth lane movement.
    shipY += (LANES[lane] - shipY) * Math.min(1, dt * 14);

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

    // Collisions: ship is a small circle at the nose.
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

  function drawShip() {
    ctx.save();
    ctx.translate(SHIP_X, shipY);
    // Engine flame.
    const fl = 14 + Math.random() * 10;
    ctx.beginPath();
    ctx.moveTo(-16, 5);
    ctx.lineTo(-16 - fl, 0);
    ctx.lineTo(-16, -5);
    ctx.closePath();
    ctx.fillStyle = '#fb923c';
    ctx.shadowColor = '#fb923c';
    ctx.shadowBlur = 16;
    ctx.fill();
    // Hull.
    ctx.beginPath();
    ctx.moveTo(26, 0);
    ctx.lineTo(-14, -12);
    ctx.lineTo(-20, 0);
    ctx.lineTo(-14, 12);
    ctx.closePath();
    ctx.fillStyle = '#22d3ee';
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 22;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(6, 0, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ecfeff';
    ctx.fill();
    ctx.restore();
  }

  function drawAsteroid(a) {
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.rot);
    ctx.beginPath();
    for (let i = 0; i < a.bumps.length; i++) {
      const ang = (i / a.bumps.length) * Math.PI * 2;
      const r = a.r * a.bumps[i];
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#3f3f46';
    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#fb7185';
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(-a.r * 0.25, -a.r * 0.2, a.r * 0.18, 0, Math.PI * 2);
    ctx.arc(a.r * 0.3, a.r * 0.25, a.r * 0.13, 0, Math.PI * 2);
    ctx.fillStyle = '#52525b';
    ctx.fill();
    ctx.restore();
  }

  function drawStar(s) {
    const tw = 0.6 + 0.4 * Math.sin(s.tw);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.PI / 4);
    ctx.globalAlpha = tw;
    ctx.fillStyle = '#facc15';
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 16;
    ctx.fillRect(-s.r * 0.32, -s.r, s.r * 0.64, s.r * 2);
    ctx.fillRect(-s.r, -s.r * 0.32, s.r * 2, s.r * 0.64);
    ctx.restore();
  }

  function drawText(text, x, y, size, color, align, weight, glow) {
    ctx.save();
    ctx.font = `${weight || 700} ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = 18;
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b0620');
    g.addColorStop(0.55, '#12082e');
    g.addColorStop(1, '#05010f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Nebula blobs.
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#7c3aed';
    ctx.beginPath(); ctx.arc(W * 0.78, H * 0.2, 150, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#db2777';
    ctx.beginPath(); ctx.arc(W * 0.15, H * 0.85, 120, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Starfield.
    for (const s of field) {
      ctx.globalAlpha = 0.35 + 0.65 * s.z;
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // Lane guides.
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.setLineDash([8, 14]);
    ctx.lineWidth = 2;
    for (const y of LANES) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.restore();

    for (const s of stars) drawStar(s);
    for (const a of asteroids) drawAsteroid(a);
    for (const p of parts) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (state !== 'over') drawShip();

    // HUD.
    drawText(`SCORE ${Math.floor(score)}`, 24, 30, 24, '#e2e8f0', 'left', 700);
    drawText(`BEST ${best}`, W - 24, 30, 24, '#94a3b8', 'right', 600);
    drawText(`SPEED ${Math.round(speed / 10)}`, W - 24, 60, 15, '#64748b', 'right', 600);

    if (state === 'title') {
      ctx.fillStyle = 'rgba(5, 1, 15, 0.55)';
      ctx.fillRect(0, 0, W, H);
      drawText('NEON DRIFT', W / 2, H * 0.36, 84, '#22d3ee', 'center', 800, '#22d3ee');
      drawText('ONE PROMPT. ONE BUTTON. THREE LANES.', W / 2, H * 0.36 + 62, 22, '#f472b6', 'center', 600, '#f472b6');
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
      drawText('GAME OVER', W / 2, H * 0.38, 64, '#fb7185', 'center', 800, '#fb7185');
      drawText(`SCORE ${Math.floor(score)}`, W / 2, H * 0.38 + 64, 28, '#e2e8f0', 'center', 700);
      if (Math.floor(score) >= best && score > 0) {
        drawText('NEW BEST!', W / 2, H * 0.38 + 104, 22, '#facc15', 'center', 700, '#facc15');
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

  function loop(t) {
    const dt = Math.min(0.05, (t - (loop.last || t)) / 1000 || 0);
    loop.last = t;
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
    // One button: alternate direction each press, so a single key plays.
    switchLane(lane === 0 ? 1 : lane === 2 ? -1 : (onPress.lastDir = -(onPress.lastDir || 1)));
  }
  onPress.lastDir = 1;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
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
  canvas.addEventListener('pointerdown', onPress);

  requestAnimationFrame(loop);
})();
