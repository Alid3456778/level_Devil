//  GAME START / LEVEL LOAD
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function startGame() {
  // Solo only â€” multiplayer uses launchMultiplayerGame()
  multiMode = false;
  deathCount = 0;
  currentLevelIndex = 0;
  buildLevelOrder();
  gameState = 'playing';
  showScreen('gameScreen');
  resize();
  document.getElementById('pingDisplay').style.display = 'none';
  ['inGameMicBtn','inGameLeaveBtn'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  document.getElementById('voicePanel').innerHTML = '';
  loadLevel(currentLevelIndex).then(() => {
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = requestAnimationFrame(loop);
  });
}

async function loadLevel(idx, opts = {}) {
  const preserveLevelDeaths = !!opts.preserveLevelDeaths;
  const realIdx = levelOrder.length > 0 ? levelOrder[idx] : idx;
  const lvl = await fetchLevel(realIdx);
  if (!lvl) { showWin(); return; }

  // Deep clone level data
  platforms = lvl.platforms.map(p => normalizePlatformDef(p));
  traps     = lvl.traps.map(t => normalizeTrapDef(t));
  events    = lvl.events.map(e => ({...e}));
  door      = { ...lvl.door, w: TILE, h: TILE*2, open: false };
  key       = lvl.key ? { ...lvl.key, collected: false } : null;
  particles = [];
  _reportedEventTriggers.clear();
  rope.active = false;
  rope.segments = [];

  // Reset player
  player.x    = lvl.spawnX;
  player.y    = lvl.spawnY;
  player.vx   = 0;
  player.vy   = 0;
  player.alive = true;
  player.spawnX = lvl.spawnX;
  player.spawnY = lvl.spawnY;
  player.gravityFlipped = false;
  player.controlsFlipped = false;
  player.facing = 1;
  player.invincible = false;
  player.onIce = false;
  player.onConveyor = 0;

  // Reset remote player logic state for the new level/respawn so the host
  // never evaluates triggers against stale dead positions from the last run.
  remotePlayers.forEach((rp, slot) => {
    const spawnX = lvl.spawnX + slot * 34;
    const spawnY = lvl.spawnY;
    remotePlayers.set(slot, {
      ...rp,
      x: spawnX,
      y: spawnY,
      logicX: spawnX,
      logicY: spawnY,
      prevLogicX: spawnX,
      prevLogicY: spawnY,
      vx: 0,
      vy: 0,
      logicVx: 0,
      logicVy: 0,
      alive: true,
    });
  });

  // Init piston hitboxes
  traps.forEach(t => {
    if (t.type === 'floor_hole') {
      t._origY = t._origY ?? t.y;
      t._origH = t._origH ?? t.h;
      t._openProgress = t.state === 'open' ? 1 : 0;
      t._slabDrop = 0;
      t._openingStarted = false;
    }
    if (t.type === 'piston') {
      t.hitX = t.baseX !== undefined ? t.baseX : t.x;
      t.hitY = t.baseY !== undefined ? t.baseY : t.y;
      t.hitW = t.w;
      t.hitH = t.h;
      t.extended = 0;
    }
    if (t.type === 'boulder' && t.state === undefined) {
      t.state = 'waiting';
      t.triggerDist = t.triggerDist || 200;
      t.vx = 0;
      t.angle = 0;
    }
  });

  if (!preserveLevelDeaths) levelDeaths = 0;
  levelStartTime = Date.now();
  shakeTimer = 0;
  cam.x = 0; cam.y = 0;

  document.getElementById('hudLevel').textContent = `L${lvl.id}: ${lvl.name}`;
  document.getElementById('hudPlayer').textContent = playerName;
  document.getElementById('hudDeaths').textContent = `💀 ${deathCount}`;

  hideOverlay('deathOverlay');
  hideOverlay('levelClearOverlay');
  hideOverlay('winOverlay');

  // Reset per-level multiplayer tracking
  _doorReached.clear();
  // Clear interpolation buffers â€” old positions must not bleed into new level
  _remoteSnapshots.clear();
  _lastBroadcast     = null;
  _lastStateSeq      = -1;
  _missedPackets     = 0;
  _fullSyncRequested = false;
  const hudTrap = document.getElementById('hudTrap');
  if (hudTrap) { hudTrap.style.color = '#ff8800'; }

  // Update trap icons in HUD
  updateTrapHintHUD();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  MAIN LOOP
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let _lastFrameTime = 0;
const _FIXED_STEP = 1000 / 60; // 16.67ms
let   _accumulator = 0;

function loop(timestamp) {
  // Guard: rAF always provides timestamp, but direct calls pass undefined
  // Use performance.now() as fallback so delta is never NaN
  if (!timestamp) timestamp = performance.now();
  const delta = Math.min(timestamp - (_lastFrameTime || (timestamp - 16)), 50); // cap 50ms
  _lastFrameTime = timestamp;

  if (gameState === 'playing') {
    _accumulator += delta;
    // Fixed-step physics â€” run as many ticks as time allows (max 3)
    let steps = 0;
    while (_accumulator >= _FIXED_STEP && steps < 3) {
      update();
      _accumulator -= _FIXED_STEP;
      steps++;
    }
    // Host broadcasts at adaptive rate based on measured ping tier.
    // GREAT(<80ms)=60Hz  GOOD(<150ms)=45Hz  HIGH(<280ms)=30Hz  BAD(>280ms)=20Hz
    if (multiMode && isHost) {
      stateTickAccum += delta;
      const adaptiveTick = [16, 22, 33, 50][_lagTier] || STATE_TICK_MS;
      if (stateTickAccum >= adaptiveTick) {
        stateTickAccum = 0;
        _broadcastCount++;
        broadcastGameState();
      }
    }
  }

  render();
  if (multiMode) updateSpeakingIndicators();
  animFrame = requestAnimationFrame(loop);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

function updateTraps() {
  const now = Date.now();
  // â”€â”€ Build nearest-player context â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Every trap that reacts to a player must check ALL players, not just the host.
  // getNearestPlayer() returns whichever player (local or remote) is closest to a point.
  traps.forEach(t => {
    switch (t.type) {
      case 'floor_hole': {
        if (t.state === 'open' && !t._openingStarted) {
          t._openingStarted = true;
          t._openProgress = t._openProgress ?? 0;
          t._slabDrop = 0;
        }

        if (t.state === 'open' && (t._openProgress ?? 0) < 1) {
          t._openProgress = Math.min(1, (t._openProgress ?? 0) + 0.12);
          const ease = 1 - Math.pow(1 - t._openProgress, 3);
          t._slabDrop = ease * ((t.dropDistance || (t._origH || t.h) + 18));
        } else if (t.state !== 'open') {
          t._openProgress = Math.max(0, (t._openProgress ?? 0) - 0.15);
          t._slabDrop = (t._openProgress || 0) * ((t.dropDistance || (t._origH || t.h) + 18));
          if (t._openProgress === 0) t._openingStarted = false;
        }
        break;
      }

      case 'spike_moving_h':
        t.x += t.dx * t.dir;
        if (t.x >= t.maxX || t.x <= t.minX) t.dir *= -1;
        break;

      case 'spike_moving_v':
        t.y += t.dy * t.dir;
        if (t.y >= t.maxY || t.y <= t.minY) t.dir *= -1;
        break;

      case 'spike_wheel':
        t.angle += t.speed;
        break;

      case 'ceiling_spike':
        if (t.state === 'dropping') {
          t.y += 14; // fast drop
          if (t.y > 450) t.state = 'gone';
        }
        break;

      case 'wall_moving':
        if (t.state === 'moving') {
          t.x += t.dx;
          if (t.dx < 0 && t.x <= t.minX) { t.x = t.minX; t.dx *= -1; }
          if (t.dx > 0 && t.x >= t.maxX) { t.x = t.maxX; t.dx *= -1; }
        }
        break;

      case 'saw_blade':
        t.angle = (t.angle || 0) + (t.speed || 0.08);
        if (t.moveX) {
          t.x += t.dx * t.dir;
          if (t.x >= t.maxX || t.x <= t.minX) t.dir *= -1;
        }
        if (t.moveY) {
          t.y += t.dy * t.dir;
          if (t.y >= t.maxY || t.y <= t.minY) t.dir *= -1;
        }
        break;

      case 'lava_pool':
        // Lava rises and falls
        if (t.rising !== undefined) {
          if (t.rising) {
            t.y -= 0.4;
            t.h += 0.4;
            if (t.h >= t.maxH) t.rising = false;
          } else {
            t.y += 0.4;
            t.h -= 0.4;
            if (t.h <= t.minH) t.rising = true;
          }
        }
        t.animOffset = (t.animOffset || 0) + 0.05;
        break;

      case 'laser':
        // Laser blinks on/off
        if (!t.period) t.period = 2000;
        t.on = ((now % t.period) < t.period * 0.6);
        break;

      case 'piston':
        // Piston extends and retracts
        if (!t.period) t.period = 1800;
        const pistonPhase = (now % t.period) / t.period;
        if (pistonPhase < 0.4) {
          // Extending
          t.extended = Math.min(1, pistonPhase / 0.4);
        } else if (pistonPhase < 0.6) {
          t.extended = 1;
        } else {
          t.extended = Math.max(0, 1 - (pistonPhase - 0.6) / 0.4);
        }
        // Update effective collision box
        if (t.dir === 'down') {
          t.hitY = t.baseY + t.extended * t.reach;
          t.hitH = t.h;
        } else if (t.dir === 'up') {
          t.hitY = t.baseY - t.extended * t.reach;
          t.hitH = t.h;
        } else if (t.dir === 'right') {
          t.hitX = t.baseX + t.extended * t.reach;
          t.hitW = t.w;
        } else {
          t.hitX = t.baseX - t.extended * t.reach;
          t.hitW = t.w;
        }
        break;

      case 'boulder':
        if (t.state === 'rolling') {
          t.vx = (t.vx || 0) + (t.dx > 0 ? 0.3 : -0.3);
          t.vx = Math.max(-8, Math.min(8, t.vx));
          t.x += t.vx;
          t.angle = (t.angle || 0) + t.vx * 0.05;
          if (t.x > t.maxX || t.x < t.minX) {
            t.vx *= -0.7;
            if (Math.abs(t.vx) < 0.5) t.vx = t.dx > 0 ? 0.5 : -0.5;
          }
        } else if (t.state === 'waiting') {
          const _np = getNearestPlayer(t.x + t.r, t.y);
          if (_np && Math.abs(_np.x + PLAYER_W/2 - (t.x + t.r)) < (t.triggerDist || 120)) {
            t.state = 'rolling';
            t.vx = t.dx;
          }
        }
        break;

      case 'ice_floor':
        // No movement, handled in player physics
        break;

      case 'conveyor':
        t.animOffset = ((t.animOffset || 0) + t.speed * 0.5) % 32;
        break;

      case 'acid_drip':
        // Acid drip falls from ceiling
        if (!t.drops) t.drops = [];
        if (now - (t.lastDrop || 0) > (t.interval || 1200)) {
          t.lastDrop = now;
          t.drops.push({ x: t.x + t.w/2 + (Math.random()-0.5)*t.w*0.6, y: t.y + t.h, vy: 2, size: 4 + Math.random()*4 });
        }
        for (let i = t.drops.length - 1; i >= 0; i--) {
          t.drops[i].y += t.drops[i].vy;
          t.drops[i].vy += 0.25;
          if (t.drops[i].y > 600) t.drops.splice(i, 1);
        }
        break;

      case 'fake_wall':
      case 'fake_floor':
        // Revealed on touch â€” handled in collision
        break;

      case 'electro_fence':
        // Pulses on and off
        if (!t.period) t.period = 800;
        t.on = ((now % t.period) < t.period * 0.5);
        t.animOffset = (t.animOffset || 0) + 0.15;
        break;

      case 'bounce_pad':
        t.visualCompress = Math.max(0, (t.visualCompress || 0) - 0.08);
        break;

      // â”€â”€ NEW PHASE 3 TRAPS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

      case 'delayed_spike':
        if (t.hidden && t.popDelay) {
          const _np = getNearestPlayer(t.x, t.y);
          if (_np && Math.abs(_np.x - t.x) < 60 && _np.x > t.x - 80) {
            t.hidden = false;
            t._popTimer = t.popDelay;
          }
        }
        if (!t.hidden && t._popTimer > 0) {
          t._popTimer -= 16;
          t._scale = 1 - (t._popTimer / (t.popDelay || 300));
        } else if (!t.hidden) {
          t._scale = 1;
        }
        break;

      case 'gravity_spike': {
        if (t.state === 'waiting') {
          const _np = getNearestPlayer(t.x + (t.w||32)/2, t.y);
          if (_np && Math.abs(_np.x + PLAYER_W/2 - (t.x + (t.w||32)/2)) < 20) {
            t.state = 'falling';
            t.vy = 0;
          }
        }
        if (t.state === 'falling') {
          t.vy = Math.min((t.vy || 0) + GRAVITY * 2.5, 22);
          t.y += t.vy;
          if (t.y > 600) t.state = 'gone';
        }
        break;
      }

      case 'magnetic_spike': {
        if (t._origX === undefined) {
          t._origX = t.x;
          t._origY = t.y;
        }

        if (t._awakened !== true) {
          if (t.triggerX !== undefined || t.triggerY !== undefined || t.triggerW !== undefined || t.triggerH !== undefined) {
            const tx = t.triggerX ?? t.x - 48;
            const ty = t.triggerY ?? 0;
            const tw = t.triggerW ?? ((t.w || 32) + 96);
            const th = t.triggerH ?? 480;
            if (anyPlayerInRect(tx, ty, tw, th)) {
              t._awakened = true;
            }
          } else {
            t._awakened = true;
          }
        }

        if (!t._awakened) {
          t.x += (t._origX - t.x) * 0.12;
          t.y += (t._origY - t.y) * 0.12;
          t.angle = t.angle || 0;
          break;
        }

        const _np = getNearestPlayer(t.x + (t.w||32)/2, t.y + (t.h||32)/2);
        if (_np) {
          const dx = (_np.x + PLAYER_W/2) - (t.x + (t.w||32)/2);
          const dy = (_np.y + PLAYER_H/2) - (t.y + (t.h||32)/2);
          const len = Math.sqrt(dx*dx + dy*dy) || 1;
          const spd = t.speed || 5;
          const maxRange = t.range || 300;
          if (len < maxRange) {
            t.x += (dx / len) * spd;
            t.y += (dy / len) * spd;
          } else {
            // Return to origin slowly when no one in range
            if (t._origX !== undefined) {
              t.x += (t._origX - t.x) * 0.04;
              t.y += (t._origY - t.y) * 0.04;
            }
          }
          t.angle = Math.atan2(dy, dx);
        }
        break;
      }

      case 'boomerang_arrow':
        if (!t.state) t.state = 'forward';
        if (t.state === 'forward') {
          t.x += (t.speed || 5) * (t.dir || 1);
          if (t.x > t._startX + 400 || t.x < t._startX - 400 || !t._startX) {
            if (!t._startX) t._startX = t.x;
            t.x += (t.speed || 5) * (t.dir || 1);
          }
          // After traveling 400px, reverse at double speed
          if (t._startX && Math.abs(t.x - t._startX) >= 400) {
            t.state = 'returning';
            t.dir *= -1;
            t.speed = (t.speed || 5) * 2.5;
          }
        } else if (t.state === 'returning') {
          t.x += (t.speed || 10) * (t.dir || 1);
          // Despawn if it returns past start
          if (t._startX && Math.abs(t.x - t._startX) >= 50 && t.state === 'returning') {
            // Reset
            t.x = t._startX;
            t.state = 'forward';
            t.dir = t.dir * -1; // flip again
            t.speed = (t.speed || 10) / 2; // restore original speed
            t._startX = null;
          }
        }
        break;

      case 'expanding_spike': {
        const _np = getNearestPlayer(t.x, t.y);
        const _airborne = _np && !_np.onGround && Math.abs(_np.x - t.x) < 200 && (_np.vy||0) > 0;
        if (_airborne) {
          t._scale = Math.min(4, (t._scale || 1) + 0.25);
        } else {
          t._scale = Math.max(1, (t._scale || 1) - 0.1);
        }
        break;
      }

      case 'input_inversion_zone':
        // Flip local player controls when inside zone
        player.controlsFlipped = player.alive && rectOverlap(
          player.x, player.y, PLAYER_W, PLAYER_H, t.x, t.y, t.w, t.h
        );
        // Note: remote players get their controls flipped on their own client
        // (they run this same code with their local player reference)
        break;

      case 'leap_of_faith_platform': {
        if (!t.state) t.state = 'alive';
        const _np = getNearestPlayer(t.x, t.y);
        if (_np && !_np.onGround && (_np.vx||0) > 1) {
          const now2 = Date.now();
          if (!t._lastShift || now2 - t._lastShift > 200) {
            t.x += (t.shiftPerJump || 15);
            t._lastShift = now2;
          }
        }
        break;
      }

      case 'shrinking_wall': {
        if (!t._origH) { t._origH = t.h; t._origY = t.y; }
        const _np = getNearestPlayer(t.x + t.w/2, t.y);
        if (_np && Math.abs(_np.x - (t.x + t.w/2)) < 200) {
          t.h = Math.max(0, t.h - 1.5);
          t.y = t._origY + (t._origH - t.h);
        }
        break;
      }

      case 'sike_goal':
      case 'fake_exit': {
        if (t._fakeX === undefined) { t._fakeX = t.x; t._fakeY = t.y; }
        const gx = t._fakeX + 16, gy = t._fakeY + 32;
        // React to nearest player â€” any player approaching triggers the troll
        const _np = getNearestPlayer(gx, gy);
        if (_np && !t._triggered) {
          const pdist = Math.sqrt((_np.x - gx) ** 2 + (_np.y - gy) ** 2);
          if (pdist < 50) {
            t._triggered = true;
            // Move fake door far away â€” use local player spawn as reference
            t._fakeX = player.spawnX + 30;
            t._fakeY = player.spawnY - TILE * 2;
            shakeTimer = 20;
            spawnParticles(gx, gy, '#ff2a2a', 30);
            setTimeout(() => { t._triggered = false; }, 3000);
          }
        }
        break;
      }

      case 'fake_loading_screen': {
        if (t.triggerX && !t._active) {
          // Any player crossing triggerX activates the fake screen
          const _anyOver = (player.alive && player.x >= t.triggerX) ||
            [...remotePlayers.values()].some(rp => rp.alive && rp.x >= t.triggerX);
          if (_anyOver) {
            t._active = true;
            t._shownAt = Date.now();
            const fakeEl = document.getElementById('fakeLoadOverlay');
            if (fakeEl) fakeEl.style.display = 'flex';
          }
        }
        if (t._active) {
          const age = Date.now() - (t._shownAt || 0);
          if (age > 2500) {
            t._active = false;
            const fakeEl = document.getElementById('fakeLoadOverlay');
            if (fakeEl) fakeEl.style.display = 'none';
          }
          // Kill local player if they stop moving
          if (player.alive && Math.abs(player.vx) < 0.5 && age > 500 && age < 2500) {
            killPlayer("KEEP MOVING NEXT TIME.");
          }
        }
        break;
      }

      case 'moving_platform':
        if (t.dir === undefined) t.dir = 1;
        t.x += (t.dx || 2) * t.dir;
        if (t.x >= t.maxX) { t.x = t.maxX; t.dir = -1; }
        if (t.x <= t.minX) { t.x = t.minX; t.dir =  1; }
        break;

      // â•â•â•â• NEW LEVEL-DESIGN TRAPS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

      case 'expanding_hole':
        // Hole starts small then expands to full floor width, then fills back in
        if (!t._phase) t._phase = 'waiting';
        if (t._phase === 'expanding') {
          // Expand outward from center
          const expandSpeed = t.expandSpeed || 2.0;
          t.x     -= expandSpeed;
          t.w     += expandSpeed * 2;
          t.x      = Math.max(t._minX !== undefined ? t._minX : 32, t.x);
          t.w      = Math.min(t._maxW || 1500, t.w);
          t.expanding = true;
          if (t.w >= (t._maxW || 1500)) {
            t._phase = 'full';
            t._fullTimer = t.fullDuration || 120; // frames at full size
          }
        } else if (t._phase === 'full') {
          t._fullTimer--;
          t.expanding = true;
          if (t._fullTimer <= 0) t._phase = 'filling';
        } else if (t._phase === 'filling') {
          // Fill back in from edges
          const fillSpeed = t.fillSpeed || 0.8;
          t.x += fillSpeed;
          t.w -= fillSpeed * 2;
          t.expanding = true;
          if (t.w <= (t._origW || 64)) {
            t.w = t._origW || 64;
            t.x = t._origX || t.x;
            t._phase = 'waiting';
            t.expanding = false;
            t._waitTimer = t.waitDuration || 180;
          }
        } else if (t._phase === 'waiting') {
          t.expanding = false;
          t._waitTimer = (t._waitTimer || 180) - 1;
          if (t._waitTimer <= 0) t._phase = 'expanding';
        }
        break;

      case 'shrinking_gap_platform': {
        if (!t._origX) t._origX = t.x;
        const _np = getNearestPlayer(t.x, t.y);
        if (_np && !_np.onGround && (_np.vx||0) > 0 &&
            _np.x > t.x - 200 && _np.x < t.x + 50) {
          t.x += t.shiftSpeed || 8;
          t.x = Math.min(t._origX + (t.maxShift || 300), t.x);
        }
        if (!_np || _np.onGround || (_np.vx||0) <= 0) {
          t.x = Math.max(t._origX, t.x - 1);
        }
        break;
      }

      case 'jumpscare_spike_platform': {
        if (!t.spikesActive) t.spikesActive = false;
        if (!t.decoyActive)  t.decoyActive  = true;
        // Check ALL players falling toward this platform
        const _allP = getAllPlayerStates();
        for (const _p of _allP) {
          if (!_p.alive) continue;
          if ((_p.vy||0) > 2) {
            const distY = t.y - (_p.y + PLAYER_H);
            if (distY > 0 && distY < 40 &&
                _p.x + PLAYER_W > t.x && _p.x < t.x + t.w) {
              t.spikesActive = true;
            }
          }
        }
        const _np = getNearestPlayer(t.x + t.w/2, t.y);
        if (t.variant === 'slide_drop' && _np) {
          if (!t._state) t._state = 'waiting';
          if (t._state === 'waiting' && (_np.vy||0) < -2 &&
              Math.abs(_np.x - t.x) < 300) {
            t._state = 'sliding';
          }
          if (t._state === 'sliding') {
            const dx = (_np.x + PLAYER_W/2) - (t.x + t.w/2);
            t.x += Math.sign(dx) * 3;
            if (Math.abs(dx) < 30) { t._state = 'dropping'; t._vy = 0; }
          }
          if (t._state === 'dropping') {
            t._vy = (t._vy || 0) + GRAVITY;
            t.y += t._vy;
            if (t.y > 700) { t.y = t._origY || t.y; t._state = 'waiting'; t._vy = 0; }
          }
        }
        if (!t._origY) t._origY = t.y;
        break;
      }

      case 'ceiling_crusher':
        if (!t._phase) t._phase = 'idle';
        if (t._phase === 'idle') {
          // Trigger when ANY player moves â€” not just the host
          if (anyPlayerMoving(0.5)) {
            t._phase = 'dropping';
            t._vy = 0;
            t._origY = t._origY || t.y;
          }
        }
        if (t._phase === 'dropping') {
          t._vy = Math.min((t._vy || 0) + 1.2, t.dropSpeed || 16);
          t.y   += t._vy;
          if (t.y + t.h >= (t.floorY || 416)) {
            t.y = (t.floorY || 416) - t.h;
            t._phase = 'resting';
            t._restTimer = 60;
          }
        }
        if (t._phase === 'resting') {
          t._restTimer--;
          if (t._restTimer <= 0) t._phase = 'rising';
        }
        if (t._phase === 'rising') {
          t.y -= t.riseSpeed || 1.5;
          if (t.y <= t._origY) {
            t.y = t._origY;
            t._phase = 'idle';
            t._vy = 0;
          }
        }
        break;

      case 'whole_ceiling':
        // Entire ceiling moves down as one solid slab â€” kills if reaches player
        // Phases: idle â†’ warning (shake) â†’ dropping â†’ crushing
        if (!t._phase)  t._phase  = 'idle';
        if (!t._origY)  t._origY  = t.y;
        if (!t._speed)  t._speed  = 0;

        if (t._phase === 'idle') {
          const triggerOnMove  = t.triggerOnMove !== false;
          const triggerOnTimer = t.triggerDelay && (Date.now() - levelStartTime) >= t.triggerDelay;
          // ANY player moving triggers the ceiling â€” not just the host
          if ((triggerOnMove && anyPlayerMoving(0.5)) || triggerOnTimer) {
            t._phase   = 'warning';
            t._warnTimer = t.warnDuration || 90;
            shakeTimer = 8;
          }
        }

        if (t._phase === 'warning') {
          // Shake camera to warn player
          t._warnTimer--;
          if (t._warnTimer % 10 === 0) shakeTimer = 6;
          if (t._warnTimer <= 0) {
            t._phase = 'dropping';
            t._speed = 0;
          }
        }

        if (t._phase === 'dropping') {
          // Accelerate downward â€” constant pressure, no stopping
          const maxSpeed = t.maxSpeed || 3.5;
          const accel    = t.accel    || 0.08;
          t._speed = Math.min(t._speed + accel, maxSpeed);
          t.y += t._speed;

          // Shrink visible floor gap â€” player must stay ahead of ceiling
          const floorY  = t.floorY  || 416;
          const playerClearance = (floorY - PLAYER_H - 8) - t.y - t.h;

          // Kill ANY player the ceiling reaches
          if (player.alive && t.y + t.h >= player.y + 4) {
            killPlayer("THE CEILING CRUSHED YOU.");
          }
          // Also emit kill event for remote players (host only)
          if (isHost || !multiMode) {
            remotePlayers.forEach((rp, slot) => {
              if (rp.alive && t.y + t.h >= rp.y + 4 && socket) {
                socket.emit('game:event', { type: 'remote_trap_kill', slot, msg: 'CEILING CRUSHED THEM.' });
              }
            });
          }

          if (t.y + t.h >= floorY) {
            t.y = floorY - t.h;
            t._phase = 'crushed';
            shakeTimer = 30;
            if (player.alive) killPlayer("RAN OUT OF TIME.");
          }
        }

        // 'crushed' is terminal â€” level cannot be completed, stays crushed
        break;

      // â•â•â•â• FEATURE 2: ADVANCED HOLES â•â•â•â•â•â•â•â•â•â•â•â•â•

      case 'smart_hole':
        // 4 sub-modes: expand/contract, chase, fake, invisible
        if (!t._origX) { t._origX = t.x; t._origW = t.w; }

        // A) Expand/contract as per JSON cycle
        if (t.expandCycle) {
          const period = t.expandCycle * 60;
          const phase  = (Date.now() / 1000 * 60) % period;
          const ratio  = Math.sin((phase / period) * Math.PI * 2) * 0.5 + 0.5;
          t.w = t._origW + (t.maxExpand || 64) * ratio;
          t.x = t._origX - (t.w - t._origW) * 0.5; // expand from center
          t.state = 'open';
        }

        // B) Chase nearest player â€” works for ALL players in multiplayer
        if (t.chase) {
          const np = getNearestPlayer(t.x + t.w/2, t.y);
          if (np) {
            const hCX = t.x + t.w / 2;
            const pCX = np.x + PLAYER_W / 2;
            const above = np.y + PLAYER_H <= t.y + 8;
            if (above && Math.abs(pCX - hCX) < 300) {
              const speed = t.chaseSpeed || 2;
              t.x += Math.sign(pCX - hCX) * speed;
              t.x = Math.max(33, Math.min(2000, t.x));
            }
          }
          t.state = 'open';
        }

        // C) Invisible hole â€” no visual, but still kills
        // (draw function checks t.invisible flag)

        // D) Fake hole â€” visible but harmless (draw shows it, collision skips)
        // (collision checks t.fake flag)
        break;

      // â•â•â•â• FEATURE 3: INTERACTIVE SPIKES â•â•â•â•â•â•â•â•â•â•

      case 'chasing_spike':
        // Chase nearest player (any player, not just host)
        if (!t._origX) t._origX = t.x;
        {
          const np = getNearestPlayer(t.x + (t.w||32)/2, t.y);
          if (np && !np.onGround && (np.vy || 0) > -4) {
            const pCX = np.x + PLAYER_W / 2;
            const sCX = t.x + (t.w || 32) / 2;
            const dist = Math.abs(pCX - sCX);
            if (dist < (t.triggerRange || 200)) {
              const speed = t.slideSpeed || 3;
              t.x += Math.sign(pCX - sCX) * speed;
              t.x = Math.max(t.minX || 33, Math.min(t.maxX || 2000, t.x));
            }
          } else if (!np || np.onGround) {
            if (t._origX !== undefined) t.x += (t._origX - t.x) * 0.04;
          }
        }
        break;

      // â•â•â•â• FEATURE 4: PILLARS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

      case 'pillar':
        if (!t._phase) t._phase = 'hidden';
        if (!t._origH) { t._origH = t.h; t._origY = t.y; }
        if (!t._curH)  t._curH = 0;

        // Trigger on nearest player â€” any player triggers the pillar
        {
          const npX = getNearestPlayer(t.x + t.w/2, t._origY || t.y);
          const pDist = npX ? Math.abs((npX.x + PLAYER_W/2) - (t.x + t.w/2)) : Infinity;
          const tRange = t.triggerRange || 180;

          if (t._phase === 'hidden') {
            t._curH = 0;
            t.y     = t._origY + t._origH;
            if (npX && pDist < tRange) {
              t._phase = 'rising';
              t._speed = 0;
            }
          }
        }
        if (t._phase === 'rising') {
          const riseSpeed = t.riseSpeed || 4;
          t._curH = Math.min(t._origH, t._curH + riseSpeed);
          t.y     = t._origY + (t._origH - t._curH);
          t.h     = t._curH;
          if (t._curH >= t._origH) {
            t._phase     = 'extended';
            t._holdTimer = t.holdTime || 120;
          }
        }
        if (t._phase === 'extended') {
          // Optionally move sideways â€” push player toward a trap
          if (t.pushDir) {
            t.x += (t.pushSpeed || 1.5) * t.pushDir;
            const bounded = (t.pushDir > 0) ? t.x >= (t.maxX || t._origX + 200)
                                             : t.x <= (t.minX || t._origX - 200);
            if (bounded) t._phase = 'retracting';
          } else {
            t._holdTimer--;
            if (t._holdTimer <= 0) t._phase = 'retracting';
          }
        }
        if (t._phase === 'retracting') {
          const retractSpeed = t.retractSpeed || 3;
          t._curH = Math.max(0, t._curH - retractSpeed);
          t.y     = t._origY + (t._origH - t._curH);
          t.h     = t._curH;
          if (t._curH <= 0) {
            t._phase = 'hidden';
            t.x      = t._origX || t.x; // reset position
          }
        }
        // Shrink/expand variant
        if (t.shrinkCycle) {
          const sp = (Date.now() / 1000 * 60) % (t.shrinkCycle * 60);
          t.w = (t._origW || t.w) * (0.5 + 0.5 * Math.abs(Math.sin(sp / (t.shrinkCycle * 60) * Math.PI)));
        }
        break;

      // â•â•â•â• FEATURE 6: SLANT GROUND â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

      case 'slant':
        // Tilt angle animates between 0 and maxAngle
        if (!t._angle)   t._angle   = 0;
        if (!t._origX)   t._origX   = t.x;
        if (!t._origY)   t._origY   = t.y;
        // Oscillate tilt
        if (t.oscillate) {
          const sp2 = Date.now() * (t.oscillateSpeed || 0.001);
          t._angle  = (t.maxAngle || 0.35) * Math.sin(sp2);
        }
        // Trigger-based tilt: ramps up when ANY player steps on it
        if (t.triggerTilt) {
          const onSlant = anyPlayerInRect(t.x, t.y - 12, t.w || 200, 20);
          if (onSlant) {
            t._angle = Math.min(t.maxAngle || 0.4, (t._angle || 0) + (t.tiltSpeed || 0.01));
          } else {
            t._angle = Math.max(0, (t._angle || 0) - (t.tiltSpeed || 0.005));
          }
        }
        break;

      case 'pressure_button':
        // Requires a player to stand on it â€” tracks who is pressing
        if (!t._pressed) t._pressed = false;
        if (!t._pressedBy) t._pressedBy = new Set();
        t._pressed = false;
        t._pressedBy.clear();
        // Check local player
        if (player.alive && player.onGround &&
            rectOverlap(player.x, player.y + PLAYER_H - 4, PLAYER_W, 8, t.x, t.y, t.w, t.h)) {
          t._pressed = true;
          t._pressedBy.add(myPlayerIdx);
        }
        // Check remote players
        remotePlayers.forEach((rp, slot) => {
          if (rp.alive &&
              rectOverlap(rp.x, rp.y + PLAYER_H - 4, PLAYER_W, 8, t.x, t.y, t.w, t.h)) {
            t._pressed = true;
            t._pressedBy.add(slot);
          }
        });
        // Broadcast press state if changed
        if (t._pressed !== t._wasPressed) {
          t._wasPressed = t._pressed;
          if (multiMode && socket) {
            socket.emit('game:event', {
              type: 'button_state',
              buttonId: t.id || t.x,
              pressed: t._pressed,
            });
          }
        }
        break;

      case 'buddy_floor':
        // Floor that collapses 2s after both buttons in same group are pressed
        if (!t._phase) t._phase = 'solid';
        if (t._phase === 'collapse_pending') {
          t._timer = (t._timer || 0) - 1;
          if (t._timer <= 0) {
            t._phase = t.collapseType === 'spike' ? 'spiked' : 'gone';
          }
        }
        break;

      case 'seesaw': {
        // Seesaw tilts based on player weight distribution
        if (!t._angle)    t._angle  = 0;
        if (!t._phase)    t._phase  = 'normal';
        if (!t._origCX)   t._origCX = t.x + t.w / 2;
        if (!t._origCY)   t._origCY = t.y;

        // Count weight on each side
        let leftWeight = 0, rightWeight = 0;
        const cx = t._origCX;
        const allP = getAllPlayerStates();
        allP.forEach(p => {
          if (!p.alive) return;
          const px = p.x + PLAYER_W / 2;
          const onSeesaw = p.y + PLAYER_H >= t.y - 8 &&
                           p.y + PLAYER_H <= t.y + 20 &&
                           p.x + PLAYER_W > t.x && p.x < t.x + t.w;
          if (!onSeesaw) return;
          if (px < cx) leftWeight++;
          else rightWeight++;
        });

        if (t._phase === 'normal') {
          // Tilt toward heavier side
          const targetAngle = (rightWeight - leftWeight) * 0.25;
          t._angle += (targetAngle - t._angle) * 0.08;
          t._angle  = Math.max(-0.6, Math.min(0.6, t._angle));

          // Break condition: angle > 30Â° AND right side has weight
          if (Math.abs(t._angle) > 0.52 && rightWeight > 0) {
            t._phase = 'breaking';
            t._breakTimer = 18; // ~0.3s at 60fps
          }
        }

        if (t._phase === 'breaking') {
          t._breakTimer--;
          if (t._breakTimer <= 0) {
            t._phase = 'broken';
            t._rightFly  = 0;   // right half flies up
            t._leftDrop  = 0;   // left half drops
            shakeTimer = 20;
            // Eject players on right half upward â†’ into ceiling spikes
            // Eject players on left half downward â†’ into pit
            allP.forEach(p => {
              const px = p.x + PLAYER_W / 2;
              if (p.slot === myPlayerIdx) {
                if (px >= cx) player.vy = -20; // fly up into ceiling spikes
                else          player.vy =  12; // drop into pit
              }
            });
            // Spawn side-ledges for escape
            t._ledgesVisible = true;
            spawnParticles(cx, t._origCY, '#ff8800', 30);
          }
        }

        if (t._phase === 'broken') {
          t._rightFly  = (t._rightFly  || 0) - 0.8;  // right half moves up
          t._leftDrop  = (t._leftDrop  || 0) + 0.8;  // left half falls down
        }
        break;
      }

      case 'split_wall':
        // Moving wall between two halves â€” starts moving at t._triggerTime
        if (!t._phase) t._phase = 'waiting';
        if (!t._origX) t._origX = t.x;
        if (t._phase === 'waiting') {
          const elapsed2 = Date.now() - levelStartTime;
          if (elapsed2 > (t.triggerMs || 4000)) {
            t._phase = 'moving';
          }
        }
        if (t._phase === 'moving') {
          t.x -= t.moveSpeed || 2.5;
          if (t.x < (t._origX - (t.maxMove || 400))) {
            t.x = t._origX - (t.maxMove || 400);
            t._phase = 'stopped';
          }
        }
        break;

      case 'void_portal':
        // Teleports player to linked portal position
        if (!t._cooldown) t._cooldown = 0;
        t._cooldown = Math.max(0, t._cooldown - 1);
        // Animate
        t._animAngle = ((t._animAngle || 0) + 0.05) % (Math.PI * 2);
        break;

      case 'switcheroo_lever':
        // Lever that teleports Aâ†”B when pulled
        if (!t._pulled) t._pulled = false;
        if (!t._cooldown) t._cooldown = 0;
        t._cooldown = Math.max(0, t._cooldown - 1);
        // Check if player activates it (walk into + up press)
        if (!t._pulled && t._cooldown === 0 &&
            rectOverlap(player.x, player.y, PLAYER_W, PLAYER_H, t.x, t.y, t.w, t.h) &&
            (keys.jump || touchJump) && !jumpConsumed) {
          t._pulled = true;
          t._cooldown = 120;
          // Swap local player to remote player position and vice versa
          if (multiMode) {
            remotePlayers.forEach((rp, slot) => {
              const oldX = player.x, oldY = player.y;
              player.x = rp.x; player.y = rp.y;
              player.vx = 0;   player.vy = 0;
              // Broadcast teleport
              if (socket) socket.emit('game:event', {
                type: 'switcheroo',
                fromSlot: myPlayerIdx,
                toSlot: slot,
                fromX: oldX, fromY: oldY,
                toX: rp.x,  toY: rp.y,
              });
            });
          }
          setTimeout(() => { if (t) t._pulled = false; }, 3000);
          spawnParticles(player.x, player.y, '#aa44ff', 20);
        }
        break;

      case 'tug_rope_anchor':
        // Rope anchor â€” if one player jumps, yanks the other
        // Physics handled by updateMultiRopes; this just tracks jump events
        if (!t._watching) t._watching = true;
        if (player.alive && !player.onGround && player.vy < -8) {
          // Player just jumped hard â€” send yank event
          if (multiMode && socket && !t._yanking) {
            t._yanking = true;
            socket.emit('game:event', { type: 'rope_yank', slot: myPlayerIdx, force: -15 });
            setTimeout(() => { if (t) t._yanking = false; }, 500);
          }
        }
        break;

      case 'shared_oxygen_zone':
        // Players must stay within oxygenRadius of each other
        if (!t._warning) t._warning = 0;
        t._warning = Math.max(0, t._warning - 1);
        if (multiMode && player.alive) {
          let minDist = Infinity;
          remotePlayers.forEach(rp => {
            if (!rp.alive) return;
            const dx = (player.x + PLAYER_W/2) - (rp.x + PLAYER_W/2);
            const dy = (player.y + PLAYER_H/2) - (rp.y + PLAYER_H/2);
            minDist = Math.min(minDist, Math.sqrt(dx*dx + dy*dy));
          });
          const maxDist = t.oxygenRadius || 300;
          const minRepel = t.repelRadius || 40;
          if (minDist !== Infinity) {
            if (minDist > maxDist) {
              // Too far â€” oxygen depleting
              t._oxygenLevel = Math.max(0, (t._oxygenLevel || 100) - 0.5);
              t._warning = 10;
              if (t._oxygenLevel <= 0) killPlayer("NO OXYGEN â€” STAY TOGETHER!");
            } else {
              t._oxygenLevel = Math.min(100, (t._oxygenLevel || 100) + 0.3);
            }
            if (minDist < minRepel) {
              // Too close â€” magnetic repel
              remotePlayers.forEach(rp => {
                const dx = player.x - rp.x;
                const dy = player.y - rp.y;
                const d  = Math.sqrt(dx*dx + dy*dy) || 1;
                player.vx += (dx / d) * 4;
                player.vy += (dy / d) * 4;
              });
            }
          }
        }
        break;
    }
  });
}

// â”€â”€â”€ EVENT PROCESSING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function processEvents(elapsed) {
  // Build a list of all active players (local + remote) for position checks
  // This fixes traps that require crossing a position trigger (player_x, player_y)
  // â€” previously only the host's local player position was checked, so non-host
  // players walking over trigger zones would not activate holes/spikes/events.
  const allPlayers = getAllPlayerStates().map(p => ({
    ...p,
    prevX: p.prevLogicX ?? p.x,
    prevY: p.prevLogicY ?? p.y,
  }));

  events.forEach(ev => {
    if (ev.triggered) return;
    let fired = false;

    if (ev.trigger === 'time' && elapsed >= ev.value) {
      fired = true; // time triggers are always global
    }

    if (ev.trigger === 'player_x') {
      // Fire if ANY player's body crosses this X threshold between snapshots.
      fired = allPlayers.some(p => p.alive !== false && _didCrossEventThreshold(ev, p.prevX, p.prevY, p.x, p.y));
    }

    if (ev.trigger === 'player_y') {
      // Fire if ANY player has crossed this Y threshold between snapshots.
      fired = allPlayers.some(p => p.alive !== false && _didCrossEventThreshold(ev, p.prevX, p.prevY, p.x, p.y));
    }

    if (fired) {
      ev.triggered = true;
      executeAction(ev);
    }
  });
}

function _didCrossEventThreshold(ev, prevX, prevY, curX, curY) {
  if (ev.trigger === 'player_x') {
    const prevFront = Math.max(prevX, prevX + PLAYER_W);
    const curFront  = Math.max(curX, curX + PLAYER_W);
    return Math.max(prevFront, curFront) >= ev.value;
  }

  if (ev.trigger === 'player_y') {
    const prevTop = Math.min(prevY, prevY + PLAYER_H);
    const curTop  = Math.min(curY, curY + PLAYER_H);
    return Math.min(prevTop, curTop) <= ev.value;
  }

  return false;
}

function reportLocalEventTriggers(prevX, prevY) {
  if (!multiMode || isHost || !socket || !player.alive) return;

  const curX = player.x;
  const curY = player.y;

  events.forEach((ev, idx) => {
    if (ev.triggered) return;
    if (ev.trigger !== 'player_x' && ev.trigger !== 'player_y') return;

    const key = `${currentLevelIndex}:${idx}`;
    if (_reportedEventTriggers.has(key)) return;
    if (!_didCrossEventThreshold(ev, prevX, prevY, curX, curY)) return;

    _reportedEventTriggers.add(key);
    console.log(`[Client] reporting event ${idx} (${ev.trigger}=${ev.value}) prev=(${prevX.toFixed(1)},${prevY.toFixed(1)}) cur=(${curX.toFixed(1)},${curY.toFixed(1)})`);
    socket.emit('game:event', {
      type: 'client_event_trigger',
      eventIndex: idx,
      trigger: ev.trigger,
      value: ev.value,
      levelIndex: currentLevelIndex,
      prevX: Math.round(prevX * 10) / 10,
      prevY: Math.round(prevY * 10) / 10,
      x: Math.round(curX * 10) / 10,
      y: Math.round(curY * 10) / 10,
    });
  });
}

function hostAcceptClientEventTrigger(slot, data) {
  if (!isHost) return false;
  if (typeof data?.eventIndex !== 'number') {
    console.warn('[Host] client_event_trigger rejected: invalid eventIndex', data);
    return false;
  }
  if (data.levelIndex !== currentLevelIndex) {
    console.warn(`[Host] client_event_trigger rejected: level mismatch eventLevel=${data.levelIndex} currentLevel=${currentLevelIndex}`);
    return false;
  }

  const ev = events[data.eventIndex];
  if (!ev) {
    console.warn(`[Host] client_event_trigger rejected: missing event ${data.eventIndex}`);
    return false;
  }
  if (ev.triggered) {
    console.log(`[Host] client_event_trigger ignored: event ${data.eventIndex} already triggered`);
    return false;
  }
  if (ev.trigger !== data.trigger) {
    console.warn(`[Host] client_event_trigger rejected: trigger mismatch ${data.trigger} !== ${ev.trigger}`);
    return false;
  }
  if (ev.value !== data.value) {
    console.warn(`[Host] client_event_trigger rejected: value mismatch ${data.value} !== ${ev.value}`);
    return false;
  }

  const rp = remotePlayers.get(slot);
  if (!rp) {
    console.warn(`[Host] client_event_trigger rejected: missing remote player for slot ${slot}`);
    return false;
  }
  if (rp.alive === false) {
    console.warn(`[Host] client_event_trigger rejected: slot ${slot} is dead`);
    return false;
  }

  const prevX = Number.isFinite(data.prevX) ? data.prevX : (rp.prevLogicX ?? rp.logicX ?? rp.x);
  const prevY = Number.isFinite(data.prevY) ? data.prevY : (rp.prevLogicY ?? rp.logicY ?? rp.y);
  const curX  = Number.isFinite(data.x) ? data.x : (rp.logicX ?? rp.x);
  const curY  = Number.isFinite(data.y) ? data.y : (rp.logicY ?? rp.y);

  if (!_didCrossEventThreshold(ev, prevX, prevY, curX, curY)) {
    console.warn(`[Host] client_event_trigger rejected: threshold not crossed for slot=${slot} event=${data.eventIndex}`, { prevX, prevY, curX, curY, trigger: ev.trigger, value: ev.value });
    return false;
  }

  ev.triggered = true;
  executeAction(ev);
  _fullSyncRequested = true;
  _lastBroadcast = null;
  console.log(`[Host] client_event_trigger accepted slot=${slot} event=${data.eventIndex} trigger=${ev.trigger}`);
  return true;
}

function executeAction(ev) {
  if (ev.delayMs && !ev._delayConsumed) {
    const delayedEv = { ...ev, _delayConsumed: true };
    setTimeout(() => executeAction(delayedEv), ev.delayMs);
    return;
  }

  switch (ev.action) {
    case 'open_hole':
      if (traps[ev.trapIndex]) {
        traps[ev.trapIndex].state = 'open';
        traps[ev.trapIndex]._openingStarted = false;
        traps[ev.trapIndex]._openProgress = 0;
        traps[ev.trapIndex]._slabDrop = 0;
        spawnParticles(traps[ev.trapIndex].x, traps[ev.trapIndex].y, '#ff4400', 12);
        shakeTimer = 8;
        console.log(`[Event] open_hole trap[${ev.trapIndex}] â€” triggered by all-player check`);
      }
      break;

    case 'drop_ceiling_spike':
      if (traps[ev.trapIndex]) {
        traps[ev.trapIndex].state = 'dropping';
        console.log(`[Event] drop_ceiling_spike trap[${ev.trapIndex}]`);
      }
      break;

    case 'start_falling_ceiling':
      platforms.forEach(p => {
        if (p.type === 'falling' && p.state === 'waiting') {
          p.state = 'falling';
          p.vy = 0;
        }
      });
      shakeTimer = 20;
      break;

    case 'flip_gravity':
      // Flip local player gravity
      player.gravityFlipped = true;
      shakeTimer = 12;
      spawnParticles(player.x, player.y, '#8888ff', 20);
      break;

    case 'unflip_gravity':
      player.gravityFlipped = false;
      shakeTimer = 8;
      break;

    case 'flip_controls':
      player.controlsFlipped = !player.controlsFlipped;
      break;

    case 'activate_platform_motion':
      if (platforms[ev.platformIndex] && platforms[ev.platformIndex].type === 'moving_platform') {
        platforms[ev.platformIndex].active = true;
        platforms[ev.platformIndex].state = 'moving';
      }
      break;
  }
}

// â”€â”€â”€ PLAYER UPDATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updatePlayer() {
  const g  = player.gravityFlipped ? -GRAVITY : GRAVITY;

  // Reset per-frame flags
  player.onIce = false;
  player.onConveyor = 0;

  // Horizontal
  const lKey = player.controlsFlipped ? (keys.right || touchRight) : (keys.left || touchLeft);
  const rKey = player.controlsFlipped ? (keys.left  || touchLeft)  : (keys.right || touchRight);
  const jKey = keys.jump || touchJump;

  // Apply stack speed penalty â€” bottom player slows when carrying others
  const stackMult = (multiMode && player._stackSpeedMult) ? player._stackSpeedMult : 1;
  const effectiveSpeed = MOVE_SPEED * stackMult;

  if (player.onIce) {
    if (lKey) player.vx -= 0.6 * stackMult;
    else if (rKey) player.vx += 0.6 * stackMult;
    else player.vx *= 0.98;
    player.vx = Math.max(-effectiveSpeed * 1.5, Math.min(effectiveSpeed * 1.5, player.vx));
  } else {
    if (lKey) { player.vx = -effectiveSpeed; player.facing = -1; }
    else if (rKey) { player.vx = effectiveSpeed; player.facing = 1; }
    else { player.vx *= 0.75; }
  }

  // Conveyor push
  if (player.onConveyor !== 0) {
    player.vx += player.onConveyor * 0.3;
  }

  // Face direction
  if (player.vx < -0.5) player.facing = -1;
  if (player.vx >  0.5) player.facing  = 1;

  // Jump â€” bonus height when jumping off another player's head
  if (jKey && !jumpConsumed && player.onGround) {
    const stackBonus = multiMode ? getStackJumpForce() : 0;
    player.vy = (player.gravityFlipped ? Math.abs(JUMP_FORCE) : JUMP_FORCE) + stackBonus;
    jumpConsumed = true;
    player.onGround = false;
    AUDIO.playSfx('sfx_jump.mp3');
  }
  if (!jKey) jumpConsumed = false;

  // Gravity
  player.vy += g;
  if (Math.abs(player.vy) > 20) player.vy = Math.sign(player.vy) * 20;

  player.x += player.vx;
  player.y += player.vy;
  player.onGround = false;

  // Animation
  player.animTimer++;
  if (Math.abs(player.vx) > 0.5 && player.animTimer > 8) {
    player.animFrame = (player.animFrame + 1) % 4;
    player.animTimer = 0;
  }

  // Invincibility frames
  if (player.invincible) {
    player.invTimer--;
    if (player.invTimer <= 0) player.invincible = false;
  }

  // Fall into void
  if (player.y > 600 || player.y < -200) {
    killPlayer("YOU FELL INTO THE VOID.");
  }
}

// â”€â”€â”€ PLAYER VS PLATFORMS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function checkPlayerCollisions(lvl) {
  const lvlW = lvl.width;
  player.x = Math.max(32, Math.min(lvlW - 32 - PLAYER_W, player.x));

  // Collect open holes â€” these punch through solid floor collision
  const openHoles = traps.filter(t =>
    (t.type === 'floor_hole'    && t.state === 'open') ||
    (t.type === 'expanding_hole' && t.expanding)       ||
    (t.type === 'smart_hole'    && t.state === 'open' && !t.fake)
  );

  platforms.forEach(p => {
    if (p.state === 'gone' || p.state === 'crumbling') return;

    // Moving platforms carry the player
    if (p.type === 'moving_platform' && p._prevX !== undefined) {
      const carriedX = p.x - p._prevX;
      const feetOnTop = Math.abs(player.y + PLAYER_H - p.y) < 6;
      const overlapsPlatform = player.x + PLAYER_W > p.x && player.x < p.x + p.w;
      const fallingOrSettled = player.vy >= -0.5;
      if (feetOnTop && overlapsPlatform && fallingOrSettled) {
        player.x += carriedX;
      }
    }
    if (p.type === 'moving_platform') p._prevX = p.x;

    if (!rectOverlap(player.x, player.y, PLAYER_W, PLAYER_H, p.x, p.y, p.w, p.h)) return;

    if (p.type === 'solid' || p.type === 'ice' || p.type === 'moving_platform' || p.type === 'fake_floor' || p.type === 'disappearing_ground') {
      for (const hole of openHoles) {
        const playerCenterX = player.x + PLAYER_W / 2;
        const platformIsAtFloor = Math.abs(p.y - hole.y) < 8;
        if (platformIsAtFloor &&
            playerCenterX > hole.x && playerCenterX < hole.x + hole.w &&
            hole.x < p.x + p.w && hole.x + hole.w > p.x) {
          return; // fall through â€” hole swallows player
        }
      }
    }

    const overlapX = Math.min(player.x + PLAYER_W, p.x + p.w) - Math.max(player.x, p.x);
    const overlapY = Math.min(player.y + PLAYER_H, p.y + p.h) - Math.max(player.y, p.y);

    if (overlapX < overlapY) {
      if (player.x < p.x) player.x = p.x - PLAYER_W;
      else                 player.x = p.x + p.w;
      player.vx = 0;
    } else {
      if (player.y < p.y) {
        player.y = p.y - PLAYER_H;
        player.vy = 0;
        if (!player.gravityFlipped) {
          player.onGround = true;
          if (p.type === 'ice') player.onIce = true;
          if ((p.type === 'crumble' || p.type === 'fake_floor') && p.state === 'solid') {
            p.state = 'crumbling';
            p.crumbleTimer = 0;
          }
        }
      } else {
        player.y = p.y + p.h;
        player.vy = 0;
        if (player.gravityFlipped) {
          player.onGround = true;
          if (p.type === 'ice') player.onIce = true;
          if ((p.type === 'crumble' || p.type === 'fake_floor') && p.state === 'solid') {
            p.state = 'crumbling';
            p.crumbleTimer = 0;
          }
        }
      }
    }
  });
}

// â”€â”€â”€ TRAP COLLISIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function checkTrapCollisions() {
  if (player.invincible) return;

  // â”€â”€ Host also checks collisions for remote players â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // This means ALL players trigger and die from traps, not just the host player.
  if ((isHost || !multiMode) && multiMode) {
    remotePlayers.forEach((rp, slot) => {
      if (!rp.alive) return;
      traps.forEach(t => {
        if (t.state === 'gone') return;
        let hit = false;
        let msg = 'A TRAP GOT THEM.';
        const rx=rp.x, ry=rp.y;

        // â”€â”€ All spike variants â”€â”€
        if ((t.type==='spike_up'||t.type==='spike_down'||t.type==='spike_moving_h'||
             t.type==='spike_moving_v'||t.type==='chasing_spike'||t.type==='delayed_spike') &&
             rectOverlap(rx+4,ry+4,PLAYER_W-8,PLAYER_H-8, t.x,t.y, t.w||32,t.h||32))
          { hit=true; msg='SPIKE.'; }

        // â”€â”€ Holes (floor_hole, expanding_hole, smart_hole) â”€â”€
        if ((t.type==='floor_hole'||t.type==='expanding_hole') && t.state==='open' &&
            (t.type !== 'floor_hole' || (t._openProgress ?? 1) >= 0.65) &&
            rx+PLAYER_W > t.x && rx < t.x+t.w && ry+PLAYER_H > t.y && ry < t.y+t.h)
          { hit=true; msg='FELL IN THE HOLE.'; }
        if (t.type==='smart_hole' && !t.fake && t.state==='open' &&
            rx+PLAYER_W > t.x && rx < t.x+t.w && ry+PLAYER_H > t.y && ry < t.y+t.h)
          { hit=true; msg='SURPRISE HOLE.'; }

        // â”€â”€ Rotating / circular â”€â”€
        if (t.type==='saw_blade') {
          const cx=t.x+t.r,cy=t.y+t.r;
          if(Math.sqrt((cx-rx-PLAYER_W/2)**2+(cy-ry-PLAYER_H/2)**2)<t.r+8){hit=true;msg='SAW BLADE.';}
        }
        if (t.type==='spike_wheel') {
          const blades=8;
          for(let bi=0;bi<blades;bi++){
            const a=(t.angle||0)+(Math.PI*2/blades)*bi;
            const tx=t.cx+Math.cos(a)*t.r,ty=t.cy+Math.sin(a)*t.r;
            if(tx>rx&&tx<rx+PLAYER_W&&ty>ry&&ty<ry+PLAYER_H){hit=true;msg='SPIKE WHEEL.';break;}
          }
        }
        if (t.type==='boulder' && t.state==='rolling') {
          const cx=t.x+t.r;
          if(Math.sqrt((cx-rx-PLAYER_W/2)**2+(t.y-ry-PLAYER_H/2)**2)<t.r+10){hit=true;msg='BOULDER.';}
        }

        // â”€â”€ Environment â”€â”€
        if (t.type==='lava_pool' && rectOverlap(rx+2,ry+2,PLAYER_W-4,PLAYER_H-4,t.x,t.y,t.w,t.h))
          { hit=true; msg='LAVA.'; }
        if (t.type==='wall_moving' && rectOverlap(rx,ry,PLAYER_W,PLAYER_H,t.x,t.y,t.w,t.h))
          { hit=true; msg='CRUSHED BY WALL.'; }
        if (t.type==='acid_drip' && t.drops) {
          t.drops.forEach(d=>{
            if(Math.sqrt((d.x-rx-PLAYER_W/2)**2+(d.y-ry-PLAYER_H/2)**2)<d.size+8) hit=true;
          });
          if(hit) msg='ACID.';
        }
        if (t.type==='electro_fence' && t.on &&
            rectOverlap(rx+2,ry+2,PLAYER_W-4,PLAYER_H-4,t.x,t.y,t.w,t.h))
          { hit=true; msg='ELECTROCUTED.'; }
        if (t.type==='laser' && t.on) {
          if(t.axis==='h' && rx+PLAYER_W>t.x && rx<t.x+t.w && ry+PLAYER_H>t.y-4 && ry<t.y+4)
            { hit=true; msg='LASER.'; }
          else if(t.axis!=='h' && rx+PLAYER_W>t.x-4 && rx<t.x+4 && ry+PLAYER_H>t.y && ry<t.y+t.h)
            { hit=true; msg='LASER.'; }
        }
        if (t.type==='piston' && (t.extended||0)>0.1) {
          const hx=t.hitX??t.x,hy=t.hitY??t.y,hw=t.hitW??t.w,hh=t.hitH??t.h;
          if(rectOverlap(rx,ry,PLAYER_W,PLAYER_H,hx,hy,hw,hh)){hit=true;msg='PISTON.';}
        }

        // â”€â”€ Ceilings â”€â”€
        if (t.type==='ceiling_crusher' && (t._phase==='dropping'||t._phase==='resting') &&
            rectOverlap(rx,ry,PLAYER_W,PLAYER_H,t.x,t.y,t.w,t.h))
          { hit=true; msg='CEILING CRUSHER.'; }
        if (t.type==='whole_ceiling' && t._phase==='dropping' &&
            t.y+t.h >= ry+4 && rx+PLAYER_W>t.x && rx<t.x+t.w)
          { hit=true; msg='CEILING CRUSHED THEM.'; }

        // â”€â”€ Phase 2 special spikes â”€â”€
        if (t.type==='gravity_spike' && t.state==='falling' &&
            rectOverlap(rx+4,ry+4,PLAYER_W-8,PLAYER_H-8,t.x,t.y,t.w||32,t.h||32))
          { hit=true; msg='GRAVITY SPIKE.'; }
        if (t.type==='magnetic_spike' &&
            rectOverlap(rx+4,ry+4,PLAYER_W-8,PLAYER_H-8,t.x,t.y,t.w||32,t.h||32))
          { hit=true; msg='MAGNETIC SPIKE.'; }
        if (t.type==='expanding_spike') {
          const sc=t._scale||1,ew=(t.w||16)*sc,eh=(t.h||16)*sc;
          const ex=t.x-(ew-(t.w||16))/2,ey=t.y-(eh-(t.h||16))/2;
          if(rectOverlap(rx+4,ry+4,PLAYER_W-8,PLAYER_H-8,ex,ey,ew,eh)){hit=true;msg='EXPANDING SPIKE.';}
        }
        if (t.type==='boomerang_arrow' &&
            rectOverlap(rx+4,ry+4,PLAYER_W-8,PLAYER_H-8,t.x,t.y,t.w||24,t.h||12))
          { hit=true; msg='BOOMERANG.'; }
        if (t.type==='jumpscare_spike_platform' && t.spikesActive &&
            rectOverlap(rx+4,ry+4,PLAYER_W-8,PLAYER_H-8,t.x,t.y-20,t.w,24))
          { hit=true; msg='SURPRISE SPIKES.'; }

        // â”€â”€ Void fall â”€â”€
        if (ry > 600 || ry < -200) { hit=true; msg='FELL INTO THE VOID.'; }

        if (hit && socket) {
          socket.emit('game:event', { type: 'remote_trap_kill', slot, msg });
          rp.alive = false; // optimistic local mark â€” prevents double-fire
        }
      });
    });
  }

  traps.forEach(t => {
    if (t.state === 'gone') return;

    switch (t.type) {
      case 'floor_hole':
        if (t.state !== 'open') return;
        if ((t._openProgress ?? 1) < 0.65) return;
        if (player.x + PLAYER_W > t.x && player.x < t.x + t.w &&
            player.y + PLAYER_H > t.y && player.y < t.y + t.h) {
          killPlayer("THE FLOOR WAS A LIE.");
        }
        break;

      case 'smart_hole':
        if (t.fake) break; // fake hole â€” no collision
        if (t.state !== 'open') break;
        if (player.x + PLAYER_W > t.x && player.x < t.x + t.w &&
            player.y + PLAYER_H > t.y && player.y < t.y + t.h) {
          killPlayer("SURPRISE HOLE.");
        }
        break;

      case 'chasing_spike':
        if (rectOverlap(player.x+4, player.y+4, PLAYER_W-8, PLAYER_H-8,
                        t.x, t.y, t.w||32, t.h||32)) {
          killPlayer("THE SPIKE FOLLOWED YOU.");
        }
        break;

      case 'pillar':
        if (t._phase === 'extended' || t._phase === 'rising') {
          if (!t.fake && rectOverlap(player.x, player.y, PLAYER_W, PLAYER_H,
                                     t.x, t.y, t.w, t.h)) {
            // Push player away from pillar
            const px = player.x + PLAYER_W/2;
            const tx = t.x + t.w/2;
            player.x += (px > tx ? 4 : -4);
            player.vx = (px > tx ? 5 : -5);
            // If pushed off a ledge into a trap, it's the player's problem :)
          }
        }
        break;

      case 'slant':
        // Apply slide force when player stands on slant
        if (t._angle && Math.abs(t._angle) > 0.02 && player.alive && player.onGround) {
          const onSlant = player.x + PLAYER_W > t.x && player.x < t.x + (t.w||200) &&
                          Math.abs(player.y + PLAYER_H - t.y) < 20;
          if (onSlant) {
            player.vx += Math.sin(t._angle) * 2.5; // slide down the slope
          }
        }
        break;

      case 'spike_up':
      case 'spike_down':
      case 'spike_moving_h':
      case 'spike_moving_v':
        if (rectOverlap(player.x+4, player.y+4, PLAYER_W-8, PLAYER_H-8, t.x, t.y, t.w, t.h)) {
          killPlayer(DEATH_MSGS[Math.floor(Math.random() * DEATH_MSGS.length)]);
        }
        break;

      case 'ceiling_spike':
        if (t.state !== 'dropping' && t.state !== 'dropped') return;
        if (rectOverlap(player.x+4, player.y+4, PLAYER_W-8, PLAYER_H-8, t.x, t.y, t.w, t.h)) {
          killPlayer("CEILING SAYS NO.");
        }
        break;

      case 'spike_wheel': {
        const blades = 8;
        for (let i = 0; i < blades; i++) {
          const angle = t.angle + (Math.PI * 2 / blades) * i;
          const tipX  = t.cx + Math.cos(angle) * t.r;
          const tipY  = t.cy + Math.sin(angle) * t.r;
          if (tipX > player.x && tipX < player.x + PLAYER_W &&
              tipY > player.y && tipY < player.y + PLAYER_H) {
            killPlayer("THE WHEEL WINS.");
            return;
          }
        }
        break;
      }

      case 'saw_blade': {
        const cx = t.x + t.r, cy = t.y + t.r;
        const px = player.x + PLAYER_W/2, py = player.y + PLAYER_H/2;
        const dist = Math.sqrt((cx-px)**2 + (cy-py)**2);
        if (dist < t.r + 8) {
          killPlayer("SAW SAYS NO.");
        }
        break;
      }

      case 'wall_moving':
        if (rectOverlap(player.x, player.y, PLAYER_W, PLAYER_H, t.x, t.y, t.w, t.h)) {
          killPlayer("CRUSHED BY A WALL.");
        }
        break;

      case 'lava_pool':
        if (rectOverlap(player.x+2, player.y+2, PLAYER_W-4, PLAYER_H-4, t.x, t.y, t.w, t.h)) {
          killPlayer("LAVA IS NOT A POOL.");
        }
        break;

      case 'laser':
        if (!t.on) return;
        // Horizontal laser
        if (t.axis === 'h') {
          if (player.x + PLAYER_W > t.x && player.x < t.x + t.w &&
              player.y + PLAYER_H > t.y - 4 && player.y < t.y + 4) {
            killPlayer("LASER PRECISION.");
          }
        } else {
          // Vertical laser
          if (player.x + PLAYER_W > t.x - 4 && player.x < t.x + 4 &&
              player.y + PLAYER_H > t.y && player.y < t.y + t.h) {
            killPlayer("ZAP.");
          }
        }
        break;

      case 'piston': {
        const hx = t.hitX !== undefined ? t.hitX : t.x;
        const hy = t.hitY !== undefined ? t.hitY : t.y;
        const hw = t.hitW !== undefined ? t.hitW : t.w;
        const hh = t.hitH !== undefined ? t.hitH : t.h;
        if (t.extended > 0.1 && rectOverlap(player.x, player.y, PLAYER_W, PLAYER_H, hx, hy, hw, hh)) {
          killPlayer("PISTON TO THE FACE.");
        }
        break;
      }

      case 'boulder':
        if (t.state === 'rolling') {
          const cx = t.x + t.r, cy = t.y;
          const px = player.x + PLAYER_W/2, py = player.y + PLAYER_H/2;
          if (Math.sqrt((cx-px)**2 + (cy-py)**2) < t.r + 10) {
            killPlayer("BOULDER WINS.");
          }
        }
        break;

      case 'ice_floor':
        // Apply ice physics - handled in updatePlayer via flag
        if (rectOverlap(player.x, player.y + PLAYER_H - 2, PLAYER_W, 4, t.x, t.y, t.w, t.h)) {
          player.onIce = true;
        }
        break;

      case 'conveyor':
        if (rectOverlap(player.x, player.y + PLAYER_H - 2, PLAYER_W, 4, t.x, t.y, t.w, t.h)) {
          player.onConveyor = t.speed;
        }
        break;

      case 'acid_drip':
        // Check drops
        if (t.drops) {
          t.drops.forEach(d => {
            const dx = d.x - (player.x + PLAYER_W/2);
            const dy = d.y - (player.y + PLAYER_H/2);
            if (Math.sqrt(dx*dx + dy*dy) < d.size + 8) {
              killPlayer("DISSOLVED.");
            }
          });
        }
        break;

      case 'fake_wall':
        // Player passes through â€” no collision
        break;

      case 'fake_floor':
        // Collapses when stepped on
        if (t.state !== 'solid') return;
        if (rectOverlap(player.x, player.y + PLAYER_H - 4, PLAYER_W, 4, t.x, t.y, t.w, t.h)) {
          t.state = 'crumbling';
          t.crumbleTimer = 0;
          setTimeout(() => { t.state = 'gone'; }, 400);
        }
        break;

      case 'electro_fence':
        if (!t.on) return;
        if (rectOverlap(player.x+2, player.y+2, PLAYER_W-4, PLAYER_H-4, t.x, t.y, t.w, t.h)) {
          killPlayer("ELECTROCUTED.");
        }
        break;

      case 'bounce_pad':
        if (rectOverlap(player.x, player.y + PLAYER_H - 4, PLAYER_W, 8, t.x, t.y, t.w, t.h)) {
          player.vy = t.force || -18;
          t.visualCompress = 1;
          spawnParticles(t.x + t.w/2, t.y, '#00ffaa', 10);
        }
        break;

      // â”€â”€ NEW PHASE 3 TRAP COLLISIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

      case 'delayed_spike':
        if (!t.hidden && t._scale >= 0.9) {
          const sw = (t.w || 32) * (t._scale || 1);
          const sh = (t.h || 32) * (t._scale || 1);
          if (rectOverlap(player.x+4, player.y+4, PLAYER_W-8, PLAYER_H-8, t.x, t.y, sw, sh)) {
            killPlayer("SURPRISE!");
          }
        }
        break;

      case 'gravity_spike':
        if (t.state === 'falling') {
          if (rectOverlap(player.x+4, player.y+4, PLAYER_W-8, PLAYER_H-8, t.x, t.y, t.w||32, t.h||32)) {
            killPlayer("GRAVITY SPIKE.");
          }
        }
        break;

      case 'magnetic_spike':
        if (rectOverlap(player.x+4, player.y+4, PLAYER_W-8, PLAYER_H-8, t.x, t.y, t.w||32, t.h||32)) {
          killPlayer("ATTRACTED TO DEATH.");
        }
        break;

      case 'boomerang_arrow':
        if (rectOverlap(player.x+4, player.y+4, PLAYER_W-8, PLAYER_H-8, t.x, t.y, t.w||24, t.h||12)) {
          killPlayer("DIDN'T SEE THAT COMING.");
        }
        break;

      case 'expanding_spike': {
        const sc = t._scale || 1;
        const ew = (t.w || 16) * sc;
        const eh = (t.h || 16) * sc;
        const ex = t.x - (ew - (t.w||16)) / 2;
        const ey = t.y - (eh - (t.h||16)) / 2;
        if (rectOverlap(player.x+4, player.y+4, PLAYER_W-8, PLAYER_H-8, ex, ey, ew, eh)) {
          killPlayer("IT GREW.");
        }
        break;
      }

      case 'leap_of_faith_platform':
        // Collision as a solid platform â€” handled in checkPlayerCollisions via platforms array
        // (these are in platforms[], not traps[] in well-formed levels)
        break;

      case 'shrinking_wall':
        // If player is on the shrinking wall, crush them
        if (t.h < 10 && player.alive) {
          const inX = player.x + PLAYER_W > t.x && player.x < t.x + t.w;
          const inY = player.y + PLAYER_H > t.y && player.y < t._origY + (t._origH || t.h);
          if (inX && inY) killPlayer("CRUSHED BY SHRINKING WALL.");
        }
        break;

      case 'fake_loading_screen':
        // Collision handled in updateTraps
        break;

      case 'moving_platform':
        // Solid â€” handled via platforms[], not traps[]
        break;

      case 'expanding_hole':
        // Kill player who falls into the hole (already handled by checkPlayerCollisions bypass)
        // But also kill if player y goes below floor during hole
        if (t.expanding && player.y > 450) {
          killPlayer("THE FLOOR DISAPPEARED.");
        }
        break;

      case 'jumpscare_spike_platform':
        if (t.spikesActive) {
          // Spike hitbox covers top of platform
          if (rectOverlap(player.x+4, player.y+4, PLAYER_W-8, PLAYER_H-8,
              t.x, t.y - 20, t.w, 24)) {
            killPlayer("THOSE WEREN'T THERE BEFORE.");
          }
        }
        // Falling platform C variant
        if (t.variant === 'slide_drop' && t._state === 'dropping') {
          if (rectOverlap(player.x, player.y, PLAYER_W, PLAYER_H, t.x, t.y, t.w, t.h)) {
            killPlayer("IT DROPPED.");
          }
        }
        break;

      case 'ceiling_crusher':
        if (t._phase === 'dropping' || t._phase === 'resting') {
          const inSafeNotch = t.safeNotchX !== undefined &&
            player.x + PLAYER_W > t.safeNotchX &&
            player.x < t.safeNotchX + (t.safeNotchW || 40);
          if (!inSafeNotch &&
              rectOverlap(player.x, player.y, PLAYER_W, PLAYER_H, t.x, t.y, t.w, t.h)) {
            killPlayer("SQUISHED BY THE CEILING.");
          }
        }
        break;

      case 'whole_ceiling':
        // Collision handled inside updateTraps (kills on contact)
        // But also block upward movement (player can't jump into ceiling)
        if (t._phase === 'dropping' || t._phase === 'crushed') {
          if (player.alive && player.y < t.y + t.h + 4 &&
              player.y + PLAYER_H > t.y &&
              player.x + PLAYER_W > t.x && player.x < t.x + t.w) {
            // Push player down â€” ceiling is solid from above
            player.y = t.y + t.h + 2;
            if (player.vy < 0) player.vy = 0;
          }
        }
        break;

      case 'shrinking_gap_platform':
        // Falls into pit eventually
        if (t.x > (t._origX || t.x) + (t.maxShift || 300) - 20) {
          if (player.onGround &&
              rectOverlap(player.x, player.y, PLAYER_W, PLAYER_H, t.x, t.y, t.w, t.h)) {
            killPlayer("THE PLATFORM ESCAPED.");
          }
        }
        break;

      case 'buddy_floor':
        if (t._phase === 'spiked') {
          if (rectOverlap(player.x, player.y, PLAYER_W, PLAYER_H, t.x, t.y, t.w, t.h)) {
            killPlayer("THE FLOOR SPIKED UP.");
          }
        }
        break;

      case 'seesaw':
        if (t._phase === 'broken') {
          // Kill players who didn't escape â€” if they're still near the seesaw
          const nearSeesaw = player.x + PLAYER_W > t.x - 20 && player.x < t.x + t.w + 20 &&
                             player.y + PLAYER_H > t.y - 20;
          if (nearSeesaw && player.vy > 8) {
            killPlayer("THE SEESAW DROPPED YOU.");
          }
        }
        break;

      case 'split_wall':
        if (t._phase === 'moving' || t._phase === 'stopped') {
          if (rectOverlap(player.x, player.y, PLAYER_W, PLAYER_H, t.x, t.y, t.w, t.h)) {
            // Push player â€” if pushed into spike wall, kill
            player.x = t.x - PLAYER_W - 2;
            player.vx = -3;
            if (player.x <= 34) killPlayer("CRUSHED BY THE WALL.");
          }
        }
        break;

      case 'void_portal':
        if (t._cooldown === 0 &&
            rectOverlap(player.x, player.y, PLAYER_W, PLAYER_H, t.x, t.y, t.w, t.h)) {
          // Teleport to linked portal
          if (t.linkX !== undefined) {
            player.x = t.linkX;
            player.y = t.linkY;
            player.vx = 0; player.vy = 0;
            t._cooldown = 90;
            spawnParticles(t.x + t.w/2, t.y + t.h/2, '#aa44ff', 16);
          }
        }
        break;

      case 'pressure_button':
      case 'switcheroo_lever':
      case 'tug_rope_anchor':
      case 'shared_oxygen_zone':
        // Handled in updateTraps
        break;
    }
  });

  // Falling platforms
  platforms.forEach(p => {
    if (p.type !== 'falling' || p.state !== 'falling') return;
    if (rectOverlap(player.x, player.y, PLAYER_W, PLAYER_H, p.x, p.y, p.w, p.h)) {
      killPlayer("SQUISHED.");
    }
  });
}

// â”€â”€â”€ DOOR & KEY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Track which slots have reached the door this level
const _doorReached = new Set();

function checkDoor(lvl) {
  const locked = lvl.door.locked && key && !key.collected;
  if (locked) return;
  if (!rectOverlap(player.x, player.y, PLAYER_W, PLAYER_H, door.x, door.y, door.w, door.h)) return;

  if (!multiMode) {
    levelClear();
    return;
  }

  // Multiplayer â€” each player reports reaching door exactly once
  if (_doorReached.has(myPlayerIdx)) return; // already reported
  _doorReached.add(myPlayerIdx);
  console.log(`[MP] Local player ${myPlayerIdx} reached door â€” broadcasting player_at_door`);

  // Broadcast to room (server relays to everyone including host)
  if (socket) socket.emit('game:event', {
    type: 'player_at_door',
    slot: myPlayerIdx,
    name: playerName,
  });

  const totalPlayers = 1 + remotePlayers.size;
  if (isHost) {
    // Host also processes their own door arrival
    if (_doorReached.size >= totalPlayers) {
      console.log('[Host] All players at door (including self) â€” clearing level');
      levelClear();
    } else {
      _showDoorWait(totalPlayers - _doorReached.size);
    }
  } else {
    // Non-host: just show waiting indicator, host will trigger level clear
    _showDoorWait(totalPlayers - _doorReached.size);
  }
}

function _checkBuddyButtons() {
  // Find all button groups â€” if every button in a group is pressed, trigger linked buddy_floors
  const buttonsByGroup = new Map();
  traps.forEach(t => {
    if (t.type !== 'pressure_button') return;
    const g = t.group || 'default';
    if (!buttonsByGroup.has(g)) buttonsByGroup.set(g, []);
    buttonsByGroup.get(g).push(t);
  });

  buttonsByGroup.forEach((btns, group) => {
    const allPressed = btns.every(b => b._pressed);
    if (!allPressed) return;
    // Mark start of collapse sequence for all buddy_floors in this group
    traps.forEach(t => {
      if (t.type === 'buddy_floor' && (t.group || 'default') === group) {
        if (t._phase === 'solid') {
          t._phase = 'collapse_pending';
          t._timer = t.collapseDelay || 120; // 2 seconds at 60fps
        }
      }
    });
    // Also open doors tagged with this group
    traps.forEach(t => {
      if (t.type === 'buddy_door' && (t.group || 'default') === group) {
        t._open = true;
      }
    });
  });
}

function _showDoorWait(waiting) {
  // Flash a non-blocking status above the HUD
  const el = document.getElementById('hudTrap');
  if (el) {
    el.textContent = `ðŸšª WAITING FOR ${waiting} PLAYER${waiting > 1 ? 'S' : ''}...`;
    el.style.color = '#00ff88';
  }
}

function checkKey() {
  if (!key || key.collected) return;
  if (rectOverlap(player.x, player.y, PLAYER_W, PLAYER_H, key.x, key.y, key.w, key.h)) {
    key.collected = true;
    door.open = true;
    spawnParticles(key.x, key.y, '#ffd700', 20);
    shakeTimer = 8;
    AUDIO.playSfx('sfx_key.mp3');

    // In multiplayer: broadcast key pickup so door opens for everyone instantly
    if (multiMode && socket) {
      socket.emit('game:event', {
        type:       'key_collected',
        slot:       myPlayerIdx,
        collectorName: playerName,
      });
    }
  }
}

// â”€â”€â”€ KILL / RESPAWN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function killPlayer(msg) {
  if (!player.alive) return;
  player.alive = false;
  deathCount++;
  levelDeaths++;
  document.getElementById('hudDeaths').textContent = `💀 ${deathCount}`;

  spawnParticles(player.x + PLAYER_W/2, player.y + PLAYER_H/2,
    PLAYER_COLORS[myPlayerIdx] || '#ff2a2a', 24);
  shakeTimer = 16;
  gameState = 'dead';
  // Stop bg music immediately â€” restart fresh on respawn
  AUDIO.stopBg();
  // Play contextual death SFX
  if (msg && (msg.includes('VOID') || msg.includes('FLOOR') || msg.includes('FELL'))) {
    AUDIO.playSfx('sfx_fall.mp3');
  } else if (msg && (msg.includes('SPIKE') || msg.includes('SAW') || msg.includes('LASER') || msg.includes('PISTON'))) {
    AUDIO.playSfx('sfx_spike.mp3');
  } else {
    AUDIO.playSfx('sfx_death.mp3');
  }

  if (multiMode && socket) {
    const deathMsg = playerName + ' DIED!';
    console.log(`[MP] Local player died â€” broadcasting player_died slot=${myPlayerIdx}`);
    socket.emit('game:event', {
      type: 'player_died',
      slot: myPlayerIdx,
      msg:  deathMsg,
    });
  }

  setTimeout(() => {
    document.getElementById('deathMsg').textContent = msg;
    document.getElementById('deathCountDisplay').textContent = deathCount;
    showOverlay('deathOverlay');
  }, 400);
}

function respawnPlayer() {
  hideOverlay('deathOverlay');
  console.log(`[MP] respawnPlayer â€” isHost=${isHost}, level=${currentLevelIndex}`);

  if (multiMode && socket) {
    if (isHost) {
      // Host broadcasts level_load â€” ALL clients (including host) will reload
      console.log(`[Host] Broadcasting level_load for respawn â€” index=${currentLevelIndex}`);
      socket.emit('game:event', { type: 'level_load', levelIndex: currentLevelIndex });
    } else {
      // Non-host: wait for host to broadcast level_load.
      // If host doesn't respond in 3s, request it.
      console.log('[Client] Waiting for host to broadcast level_load for respawn');
      setTimeout(() => {
        if (gameState === 'dead') {
          console.warn('[Client] Host did not restart â€” requesting via socket');
          socket.emit('game:event', { type: 'request_restart' });
        }
      }, 3000);
      return; // Do NOT load level locally â€” wait for host broadcast
    }
  }

  // Solo mode or host loading locally (host also gets level_load from itself via server echo)
  if (!multiMode) {
    AUDIO._bgFile = null;
    AUDIO.playBg('bg_game.mp3');
    loadLevel(currentLevelIndex, { preserveLevelDeaths: true }).then(() => { gameState = 'playing'; });
  }
  // In multiMode as host, the level_load event broadcast will trigger our own reload
  // via the socket.on('game:event', level_load) handler â€” no need to load here
}

function levelClear() {
  gameState = 'clear';
  spawnParticles(door.x + 16, door.y + 32, '#ffd700', 40);
  _doorReached.clear();
  AUDIO.stopBg();
  AUDIO.playSfx('sfx_door.mp3');

  // Submit score to leaderboard
  const realIdx  = levelOrder.length > 0 ? levelOrder[currentLevelIndex] : currentLevelIndex;
  const timeSec  = Math.round((Date.now() - levelStartTime) / 1000);
  submitLevelScore(realIdx + 1, levelDeaths, timeSec); // levelId is 1-based

  const elapsed = (timeSec).toFixed(0) + 's';
  const elapsedDisp = Math.floor(timeSec/60) + ':' + String(timeSec%60).padStart(2,'0');
  document.getElementById('levelStats').innerHTML =
    `TIME: ${elapsedDisp}<br>DEATHS THIS LEVEL: ${levelDeaths}`;

  if (multiMode) {
    // Show who made it through
    let extra = `<br>─────<br>${playerName}: ✓  AT DOOR`;
    remotePlayers.forEach((rp) => {
      extra += `<br>${rp.name}: ${rp.alive ? '✓  AT DOOR' : '💀 DEAD'}`;
    });
    document.getElementById('levelStats').innerHTML += extra;

    const btn = document.getElementById('nextLevelBtn');
    if (btn) {
      btn.style.display = isHost ? 'block' : 'none';
      btn.textContent = 'NEXT LEVEL ▶';
    }
    if (!isHost) {
      document.getElementById('levelStats').innerHTML += '<br><br><span style="color:#ffcc00">â³ WAITING FOR HOST TO ADVANCE...</span>';
      console.log('[Client] Level clear â€” waiting for host level_load event');
    } else {
      console.log('[Host] Level clear ▶ showing NEXT button');
    }
    // Host triggers advance; non-host just waits for level_load event
    if (isHost) {
      // Host auto-advances after a brief moment so everyone sees the clear screen
      // nextLevel() is called manually by host clicking the button
    }
  }

  setTimeout(() => showOverlay('levelClearOverlay'), 300);
}

function nextLevel() {
  hideOverlay('levelClearOverlay');
  if (multiMode) {
    // In multiplayer, only host can advance â€” non-hosts just wait for level_load event
    if (!isHost) {
      console.log('[Client] nextLevel called but not host â€” ignoring (waiting for host level_load)');
      return;
    }
    hostAdvanceLevel();
    return;
  }
  // Solo mode
  currentLevelIndex++;
  if (currentLevelIndex >= levelOrder.length) {
    showWin();
  } else {
    AUDIO._bgFile = null;
    AUDIO.playBg('bg_game.mp3');
    loadLevel(currentLevelIndex).then(() => { gameState = 'playing'; });
  }
}

function showWin() {
  gameState = 'won';
  AUDIO.stopBg();
  AUDIO.playSfx('sfx_win.mp3');
  const el = document.getElementById('winStats');
  if (el) {
    if (multiMode) {
      let txt = `You and your team conquered all levels!<br>Total deaths: ${deathCount}`;
      remotePlayers.forEach(rp => { txt += `<br>${rp.name}: teammate`; });
      el.innerHTML = txt;
    } else {
      el.textContent = `You conquered all levels! Deaths: ${deathCount}`;
    }
  }
  showOverlay('winOverlay');
}

function restartGame() {
  hideOverlay('winOverlay');
  if (multiMode) {
    buildVoicePanel();
    showScreen('lobbyScreen'); // showScreen will start bg_menu.mp3
    return;
  }
  deathCount = 0;
  currentLevelIndex = 0;
  buildLevelOrder();
  // Full audio reset â€” start game music fresh
  AUDIO.stopBg();
  AUDIO._bgFile = null;
  AUDIO.playBg('bg_game.mp3');
  loadLevel(0).then(() => { gameState = 'playing'; });
}

// â”€â”€â”€ PARTICLES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 5;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 30 + Math.random() * 30,
      maxLife: 60,
      color,
      size: 2 + Math.random() * 4,
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x  += p.vx;
    p.y  += p.vy;
    p.vy += 0.2;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// â”€â”€â”€ COLLISION HELPER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
