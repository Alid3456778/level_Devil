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
