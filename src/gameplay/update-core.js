//  UPDATE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function update() {
  const realIdx = levelOrder.length > 0 ? levelOrder[currentLevelIndex] : currentLevelIndex;
  const lvl = LEVELS[realIdx];
  if (!lvl) return;
  const now  = Date.now();
  const elapsed = now - levelStartTime;
  const prevPlayerX = player.x;
  const prevPlayerY = player.y;

  // â”€â”€ Camera (follow local player or centroid in MP) â”€â”€
  updateCamera(lvl);

  // â”€â”€ Platform dynamics â”€â”€
  if (!multiMode || isHost) updatePlatforms(elapsed);

  // â”€â”€ Traps â”€â”€
  // All clients run trap PHYSICS locally (movement, animation) for smooth visuals.
  // Only host runs trap TRIGGERS (player-proximity checks) authoritatively.
  // Host broadcasts trap state 30x/sec and clients apply it â€” so any local drift
  // is corrected within 33ms. This gives local responsiveness with host authority.
  updateTraps();       // Everyone runs physics (triggers use all-player checks)
  lerpTrapPositions(); // Clients smooth toward host-authoritative positions

  // â”€â”€ Events â”€â”€
  if (!multiMode || isHost) processEvents(elapsed);

  // â”€â”€ Player â”€â”€
  if (player.alive) {
    updatePlayer();
    checkPlayerCollisions(lvl);
    checkTrapCollisions();
    checkDoor(lvl);
    checkKey();
    reportLocalEventTriggers(prevPlayerX, prevPlayerY);
  }

  // â”€â”€ Player stacking (players as platforms for each other) â”€â”€
  resolvePlayerStacking();

  // â”€â”€ Cooperative button checks â”€â”€
  if (multiMode) _checkBuddyButtons();

  // â”€â”€ Multiplayer rope â”€â”€
  updateMultiRopes();

  // â”€â”€ Net sync â”€â”€
  if (multiMode) {
    sendInputToHost();
    // (state broadcast handled by loop's fixed-step timer)
  }

  // â”€â”€ Particles â”€â”€
  updateParticles();
  if (!multiMode) updateRope();

  // â”€â”€ Screen shake â”€â”€
  if (shakeTimer > 0) shakeTimer--;
}

// â”€â”€â”€ CAMERA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updateCamera(lvl) {
  // Horizontal: center on player
  const cx = player.x - canvas.width / 2 + PLAYER_W / 2;
  const maxX = Math.max(0, lvl.width - canvas.width);
  cam.x += (Math.max(0, Math.min(maxX, cx)) - cam.x) * 0.12;

  // Vertical: keep player in the LOWER 40% of screen
  // This ensures floor, spikes and player feet are always visible
  // Target: player should sit at 70% down the screen height
  const targetY = player.y - canvas.height * 0.60;
  const maxCamY = Math.max(0, (lvl.height || 480) - canvas.height);
  const clampedY = Math.max(0, Math.min(maxCamY, targetY));
  // Smooth follow with faster response on mobile (smaller screens need quicker adjustment)
  const followSpeed = canvas.height < 450 ? 0.18 : 0.10;
  cam.y += (clampedY - cam.y) * followSpeed;
  cam.y = Math.round(cam.y * 10) / 10; // prevent sub-pixel jitter
}

// â”€â”€â”€ PLATFORMS DYNAMICS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updatePlatforms(elapsed) {
  platforms.forEach(p => {
    if (p.type === 'falling') {
      if (p.state === 'waiting' && elapsed > p.delay) {
        p.state = 'falling';
        p.vy    = 0;
      }
      if (p.state === 'falling') {
        p.vy += GRAVITY * 0.8;
        p.y  += p.vy;
        if (p.y > 600) p.state = 'gone';
      }
    }
    if ((p.type === 'crumble' || p.type === 'fake_floor') && p.state === 'crumbling') {
      p.crumbleTimer++;
      if (p.crumbleTimer > 30) { p.state = 'gone'; }
    }
    if (p.type === 'disappearing_ground') {
      if (!p.state) p.state = 'waiting';
      if (p.state === 'waiting' && elapsed >= (p.delay || p.startDelay || 1000)) {
        p.state = 'crumbling';
        p.crumbleTimer = 0;
      } else if (p.state === 'crumbling') {
        p.crumbleTimer = (p.crumbleTimer || 0) + 1;
        if (p.crumbleTimer > (p.crumbleFrames || 24)) {
          if (p.fallAfterDisappear) {
            p.state = 'falling';
            p.vy = 0;
          } else {
            p.state = 'gone';
          }
        }
      } else if (p.state === 'falling') {
        p.vy = (p.vy || 0) + GRAVITY * 0.8;
        p.y += p.vy;
        if (p.y > 700) p.state = 'gone';
      }
    }
    if (p.type === 'moving_platform') {
      p._prevX = p.x;
      if (p.active === false || p.state === 'idle') return;
      if (p.dir === undefined) p.dir = 1;
      p.x += (p.dx || 2) * p.dir;
      if (p.x >= p.maxX) { p.x = p.maxX; p.dir = -1; }
      if (p.x <= p.minX) { p.x = p.minX; p.dir =  1; }
    }
  });
}

// â”€â”€â”€ TRAPS DYNAMICS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â”€â”€â”€ MULTI-PLAYER TRAP AWARENESS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns the player state (local or remote) nearest to (cx, cy).
// Used so every trap reacts to ALL players, not just the host's local player.
function getNearestPlayer(cx, cy) {
  let best = null, bestDist = Infinity;
  // Always check local player
  if (player.alive) {
    const d = Math.abs(player.x + PLAYER_W/2 - cx) + Math.abs(player.y + PLAYER_H/2 - cy);
    if (d < bestDist) { bestDist = d; best = player; }
  }
  // Check all remote players
  remotePlayers.forEach(rp => {
    if (!rp.alive) return;
    const d = Math.abs(rp.x + PLAYER_W/2 - cx) + Math.abs(rp.y + PLAYER_H/2 - cy);
    if (d < bestDist) { bestDist = d; best = { ...rp, onGround: rp.onGround ?? true }; }
  });
  return best;
}

// Returns true if ANY player (local or remote) is alive
function anyPlayerAlive() {
  if (player.alive) return true;
  for (const rp of remotePlayers.values()) { if (rp.alive) return true; }
  return false;
}

// Returns true if ANY player is inside the given rect
function anyPlayerInRect(rx, ry, rw, rh) {
  const check = (px, py) =>
    px + PLAYER_W > rx && px < rx + rw &&
    py + PLAYER_H > ry && py < ry + rh;
  if (player.alive && check(player.x, player.y)) return true;
  for (const rp of remotePlayers.values()) {
    if (rp.alive && check(rp.x, rp.y)) return true;
  }
  return false;
}

// Returns any player moving (vx > threshold) â€” for ceiling triggers etc.
function anyPlayerMoving(threshold = 0.5) {
  if (player.alive && Math.abs(player.vx) > threshold) return true;
  for (const rp of remotePlayers.values()) {
    if (rp.alive && Math.abs(rp.vx || 0) > threshold) return true;
  }
  return false;
}

