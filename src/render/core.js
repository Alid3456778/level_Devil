//  RENDER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function render() {
  if (gameState === 'idle') return;
  const realIdx = levelOrder.length > 0 ? levelOrder[currentLevelIndex] : currentLevelIndex;
  const lvl = LEVELS[realIdx];
  if (!lvl) return;

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Background â€” warm brown base (Level Devil look)
  ctx.fillStyle = '#8B6914';
  ctx.fillRect(0, 0, W, H);
  // Optional per-level tint overlay
  if (lvl.bgColor && lvl.bgColor !== '#8B6914') {
    ctx.fillStyle = lvl.bgColor + '44'; // 27% overlay tint
    ctx.fillRect(0, 0, W, H);
  }
  drawBgGrid(lvl);

  // Camera + shake
  ctx.save();
  if (shakeTimer > 0) {
    ctx.translate(
      (Math.random() - 0.5) * shakeTimer * 0.8,
      (Math.random() - 0.5) * shakeTimer * 0.8
    );
  }
  ctx.translate(-Math.round(cam.x), -Math.round(cam.y));

  // Draw world
  drawPlatforms();
  drawTraps();
  if (!multiMode) drawRope();
  if (multiMode) {
    drawRemotePlayers();
    drawMultiRopes();
  }
  drawDoor(lvl);
  drawKey();
  drawParticles();
  if (player.alive) drawPlayer();

  ctx.restore();
}

function drawBgGrid(lvl) {
  // Level Devil warm brown background â€” no grid lines, just texture
  const W = canvas.width, H = canvas.height;
  // Subtle darker horizontal bands every 64px (sand layer look)
  ctx.fillStyle = 'rgba(0,0,0,0.04)';
  for (let y = 0; y < H; y += 32) {
    ctx.fillRect(0, y, W, 16);
  }
  // Tiny squiggle lines (desert sand texture)
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  const offsetY = Math.floor(cam.y / 40) * 40;
  for (let row = -1; row < Math.ceil(H/40) + 1; row++) {
    const ry = row * 40 - offsetY;
    ctx.beginPath();
    ctx.moveTo(0, ry + 20);
    for (let xi = 0; xi < W + 20; xi += 20) {
      ctx.quadraticCurveTo(xi + 5, ry + 15, xi + 10, ry + 20);
      ctx.quadraticCurveTo(xi + 15, ry + 25, xi + 20, ry + 20);
    }
    ctx.stroke();
  }
}

function drawPlatforms() {
  platforms.forEach(p => {
    if (p.state === 'gone') return;

    // Keep all platform-family pieces visually unified so traps are not obvious by color.
    let topColor  = '#f5c842';
    let midColor  = '#d4a520';
    let botColor  = '#a07010';
    let edgeColor = '#c87818';

    // Only show an obvious visual change once a platform is already breaking/active.
    if (
      (p.type === 'crumble' || p.type === 'fake_floor' || p.type === 'disappearing_ground') &&
      p.state === 'crumbling'
    ) {
      const ratio = Math.min(1, (p.crumbleTimer || 0) / 30);
      topColor  = `rgb(${Math.floor(245 - ratio * 22)},${Math.floor(200 - ratio * 58)},${Math.floor(66 - ratio * 28)})`;
      midColor  = '#b97a22';
      botColor  = '#845112';
      edgeColor = '#d07c24';
    }

    const x = p.x, y = p.y, w = p.w, h = p.h;

    // Bottom shadow layer
    ctx.fillStyle = botColor;
    ctx.fillRect(x, y + 4, w, h - 4);

    // Main body
    ctx.fillStyle = midColor;
    ctx.fillRect(x, y + 2, w, h - 6);

    // Top face (brightest)
    ctx.fillStyle = topColor;
    ctx.fillRect(x, y, w, Math.min(8, h * 0.35));

    // Pixel-art border â€” left and top lighter, right and bottom darker
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.moveTo(x, y+h); ctx.lineTo(x, y); ctx.lineTo(x+w, y); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.moveTo(x+w, y); ctx.lineTo(x+w, y+h); ctx.lineTo(x, y+h); ctx.stroke();

    // Edge accent
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    // Pixel texture dots on wide platforms
    if (w > 64) {
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      for (let xi = x + 16; xi < x + w - 8; xi += 32) {
        ctx.fillRect(xi, y + 2, 4, 3);
      }
    }

    // Crumble cracks
    if ((p.type === 'crumble' || p.type === 'fake_floor' || p.type === 'disappearing_ground') && p.state === 'crumbling') {
      ctx.strokeStyle = '#ff6622';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x + w*(0.2+i*0.25), y);
        ctx.lineTo(x + w*(0.3+i*0.25), y + h);
        ctx.stroke();
      }
    }

  });
}

