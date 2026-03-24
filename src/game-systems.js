//  LEVEL DEFINITIONS (JSON-driven)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  LEVEL LOADER â€” fetches from /levels/levelN.json
//  Falls back to LEVELS_BUILTIN if fetch fails
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Total number of levels (must match files in /levels/)
const LEVEL_COUNT = 28; // level 28 = "THE DOUBLE-CROSS" (fake fake-out + sliding island)

// Runtime level cache â€” populated by loadLevelData()
const LEVELS = new Array(LEVEL_COUNT).fill(null);

// Track which levels have been fetched
const _levelFetching = new Map(); // idx â†’ Promise

/**
 * Fetch a level JSON by index (0-based).
 * Returns the level object. Uses cache after first load.
 */
async function fetchLevel(idx) {
  if (LEVELS[idx]) return LEVELS[idx];
  if (_levelFetching.has(idx)) return _levelFetching.get(idx);

  const promise = fetch(`levels/level${idx + 1}.json`)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      // Normalise: convert JSON null â†’ JS null, booleans etc. already correct
      LEVELS[idx] = data;
      return data;
    })
    .catch(err => {
      console.warn(`[LevelLoader] Failed to load level${idx+1}.json:`, err.message);
      // Fall back to built-in if available
      if (LEVELS_BUILTIN[idx]) {
        LEVELS[idx] = LEVELS_BUILTIN[idx];
        return LEVELS[idx];
      }
      return null;
    });

  _levelFetching.set(idx, promise);
  return promise;
}

/**
 * Preload all levels in background (non-blocking).
 * Call once on init so levels are ready when needed.
 */
function preloadAllLevels() {
  for (let i = 0; i < LEVEL_COUNT; i++) {
    fetchLevel(i); // fire and forget
  }
}

/**
 * Get current level data synchronously (from cache).
 * Always use after awaiting fetchLevel(idx) or preload.
 */
function getLevelSync(idx) {
  const realIdx = levelOrder.length > 0 ? levelOrder[idx] : idx;
  return LEVELS[realIdx] || null;
}

function normalizePlatformDef(p) {
  const out = { ...p };

  if (!out.type) out.type = 'solid';

  if (out.type === 'fake_platform') {
    out.type = 'fake_floor';
  }

  if (out.type === 'disappearing_ground') {
    out.type = 'disappearing_ground';
    out.state = out.state || 'waiting';
  }

  if (out.type === 'moving_platform') {
    out.state = out.state || (out.active === false ? 'idle' : 'moving');
  }

  return out;
}

function normalizeTrapDef(t) {
  const out = { ...t };

  if (out.type === 'fake_floor_trap' || out.type === 'fake_platform') {
    out.type = 'fake_floor';
    out.state = out.state || 'solid';
  }

  return out;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  PHASE 2: LEVEL RANDOMIZER + LOBBY OPTIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let levelOrder    = [];
let randomizeMode = false;
let mpOnlyMode    = false; // only show multiplayer-designed levels

// Levels where rope physics is active (0-based indices)
const ROPE_LEVELS    = new Set([3, 4, 6, 7, 10, 11, 13, 14, 15, 16, 17, 18, 19, 21, 24]);
// Levels designed for 2+ players
const MP_ONLY_LEVELS = new Set([3, 4, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);

// Is rope active for the CURRENT level?
function isRopeLevelActive() {
  const realIdx = levelOrder.length > 0 ? levelOrder[currentLevelIndex] : currentLevelIndex;
  const chkRope = document.getElementById('chkRope');
  if (!chkRope || !chkRope.checked) return false;
  return ROPE_LEVELS.has(realIdx);
}

function buildLevelOrder() {
  let candidates = Array.from({length: LEVEL_COUNT}, (_, i) => i);
  // Multiplayer-only filter
  if (mpOnlyMode && multiMode) {
    const filtered = candidates.filter(i => MP_ONLY_LEVELS.has(i));
    if (filtered.length > 0) candidates = filtered;
  }
  // Shuffle if randomize mode
  if (randomizeMode) {
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
  }
  levelOrder = candidates;
}

function onRopeToggle() {
  const chk  = document.getElementById('chkRope');
  const hint = document.getElementById('ropeLevelsHint');
  if (hint) hint.style.color = (chk && chk.checked) ? '#ffaa00' : '#555';
}

function onMPOnlyToggle() {
  const chk = document.getElementById('chkMPOnly');
  mpOnlyMode = !!(chk && chk.checked);
  const hint = document.getElementById('mpOnlyHint');
  if (hint) hint.style.display = mpOnlyMode ? 'block' : 'none';
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  PLAYER STACKING PHYSICS
//  Players act as solid platforms for each other.
//  - Standing on top: fully solid (can stack for height)
//  - Side collision: no push â€” players pass through
//    horizontally so they don't block each other walking
//  - Stacked player gets +PLAYER_H bonus jump height
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Extra jump boost when standing on another player
const STACK_JUMP_BONUS = -5; // added to normal JUMP_FORCE

// How many frames the "standing on player" state lasts
// after the supporting player moves away (coyote buffer)
const STACK_COYOTE_FRAMES = 6;

function resolvePlayerStacking() {
  if (!multiMode) return;

  const others = [];
  remotePlayers.forEach((rp, slot) => { if (rp.alive) others.push(rp); });
  if (others.length === 0) {
    player._stackCount = 0;
    if (player._beingStoodOn > 0) player._beingStoodOn--;
    return;
  }

  // Reset per-frame stacking state
  player._onPlayer      = false;
  player._stackCoyote   = Math.max(0, (player._stackCoyote || 0) - 1);
  player._stackBoostAvail = player._stackBoostAvail || false;
  player._stackCount    = player._stackCount || 0;
  // Count how many players are above us this frame
  let playersAbove = 0;

  for (const other of others) {
    const myLeft = player.x,   myRight = player.x + PLAYER_W;
    const myTop  = player.y,   myBot   = player.y + PLAYER_H;
    const otLeft = other.x,    otRight = other.x + PLAYER_W;
    const otTop  = other.y,    otBot   = other.y + PLAYER_H;

    const xOverlap = Math.min(myRight, otRight) - Math.max(myLeft, otLeft);
    if (xOverlap < PLAYER_W * 0.4) continue;

    // â”€â”€ Landing ON TOP of other player â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const prevBot    = myBot - player.vy;
    const landingOnTop = (
      prevBot <= otTop + 4 &&
      myBot   >= otTop - 2 &&
      myBot   <= otTop + 14 &&
      player.vy >= 0
    );

    if (landingOnTop && !player.gravityFlipped) {
      player.y  = otTop - PLAYER_H;
      player.vy = 0;
      player.onGround      = true;
      player._onPlayer     = true;
      player._stackCoyote  = STACK_COYOTE_FRAMES;
      player._stackBoostAvail = true;
      other._headIndicator = 8;

      // â”€â”€ CARRY: when standing on someone, inherit their horizontal movement â”€â”€
      // The upper player moves WITH the lower player automatically
      if (other.vx !== undefined) {
        // Only apply carry if the upper player isn't actively moving themselves
        const lKey = player.controlsFlipped ? (keys.right || touchRight) : (keys.left  || touchLeft);
        const rKey = player.controlsFlipped ? (keys.left  || touchLeft)  : (keys.right || touchRight);
        if (!lKey && !rKey) {
          // Passively ride the bottom player
          player.x += (other.vx || 0);
        }
      }
    }

    // â”€â”€ Remote player standing ON US â†’ track weight â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const remoteOnUs = (
      other.vy !== undefined && other.vy >= 0 &&
      Math.abs(other.y + PLAYER_H - player.y) < 12 &&
      xOverlap >= PLAYER_W * 0.4
    );
    if (remoteOnUs) {
      player._beingStoodOn = 4;
      playersAbove++;
    }
  }

  // â”€â”€ Speed penalty for bottom player based on stack weight â”€â”€â”€â”€â”€
  // Each extra player reduces move speed by 15%, max 60% reduction
  player._stackCount = playersAbove;
  if (playersAbove > 0) {
    const speedMult = Math.max(0.4, 1 - playersAbove * 0.15);
    player._stackSpeedMult = speedMult;
  } else {
    player._stackSpeedMult = 1;
  }

  if (player._beingStoodOn > 0) player._beingStoodOn--;
}

// Called from updatePlayer â€” enhances jump when stacked
function getStackJumpForce() {
  // If the player just left a stack (coyote frames) or is on one,
  // give a bonus jump height proportional to how many players are above them.
  // Simple version: +5 velocity units when jumping off another player.
  if ((player._onPlayer || player._stackCoyote > 0) && player._stackBoostAvail) {
    player._stackBoostAvail = false;
    return STACK_JUMP_BONUS; // negative = extra upward force
  }
  return 0;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  PHASE 3 â€” MULTIPLAYER ROPE SYSTEM
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function updateMultiRopes() {
  if (!multiMode) return;
  // Rope only activates on levels that are designed for it
  if (!isRopeLevelActive()) return;

  // Build list of all live players (local + remote)
  const allPlayers = getRopePlayerStates();
  if (allPlayers.length < 2) return;

  // Rope connects consecutive players if within ROPE_MAX_LEN
  // Snap if > ROPE_SNAP_LEN
  for (let i = 0; i < allPlayers.length - 1; i++) {
    const a = allPlayers[i];
    const b = allPlayers[i+1];
    if (!a.alive || !b.alive) continue;

    const ax = a.x + PLAYER_W/2, ay = a.y + PLAYER_H/2;
    const bx = b.x + PLAYER_W/2, by = b.y + PLAYER_H/2;
    const dx = bx - ax, dy = by - ay;
    const dist = Math.sqrt(dx*dx + dy*dy);

    if (dist > ROPE_SNAP_LEN) {
      // Snap â€” kill the farther player
      const snapMsg = `ROPE SNAPPED! ${b.name} WAS PULLED TO THEIR DEATH.`;
      if (b.slot === myPlayerIdx) killPlayer(snapMsg);
      if (isHost && socket) {
        socket.emit('game:event', { type: 'player_died', slot: b.slot, msg: snapMsg });
      }
    } else if (dist > ROPE_MAX_LEN) {
      // Pull constraint â€” push players toward each other
      const factor = (dist - ROPE_MAX_LEN) / dist * 0.3;
      if (a.slot === myPlayerIdx) {
        player.vx +=  dx * factor;
        player.vy +=  dy * factor;
      }
      if (b.slot === myPlayerIdx) {
        player.vx -= dx * factor;
        player.vy -= dy * factor;
      }
    }
  }
}

function drawMultiRopes() {
  if (!multiMode) return;
  if (!isRopeLevelActive()) return;

  const allPlayers = getRopePlayerStates();
  if (allPlayers.length < 2) return;

  for (let i = 0; i < allPlayers.length - 1; i++) {
    const a = allPlayers[i];
    const b = allPlayers[i+1];
    if (!a.alive || !b.alive) continue;

    const ax = a.x + PLAYER_W/2, ay = a.y + PLAYER_H/2;
    const bx = b.x + PLAYER_W/2, by = b.y + PLAYER_H/2;
    const dx = bx - ax, dy = by - ay;
    const dist = Math.sqrt(dx*dx + dy*dy);

    const taut = dist > ROPE_MAX_LEN * 0.9;
    const danger = dist > ROPE_MAX_LEN * 1.2;

    // Catenary sag
    const segs = 12;
    const pts = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const x = ax + dx * t;
      // Add sag using parabola unless taut
      const sag = taut ? 0 : Math.sin(t * Math.PI) * Math.min(40, (ROPE_MAX_LEN - dist) * 0.4);
      const y = ay + dy * t + sag;
      pts.push([x, y]);
    }

    ctx.save();
    ctx.strokeStyle = danger ? '#ff2222' : taut ? '#ffaa00' : '#c8a060';
    ctx.lineWidth = 3;
    ctx.shadowColor = danger ? '#ff2222' : '#c8a060';
    ctx.shadowBlur  = taut ? 10 : 4;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let s = 1; s <= segs; s++) ctx.lineTo(pts[s][0], pts[s][1]);
    ctx.stroke();

    // Attachment rings
    ctx.beginPath();
    ctx.arc(ax, ay, 5, 0, Math.PI*2);
    ctx.fillStyle = PLAYER_COLORS[a.slot] || '#c8a060';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx, by, 5, 0, Math.PI*2);
    ctx.fillStyle = PLAYER_COLORS[b.slot] || '#c8a060';
    ctx.fill();

    // Distance label
    if (dist > ROPE_MAX_LEN * 0.7) {
      const mx = (ax+bx)/2, my = (ay+by)/2 - 14;
      ctx.font = '8px monospace';
      ctx.fillStyle = danger ? '#ff2222' : '#ffaa00';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(dist)}px`, mx, my);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }
}

function getRopePlayerStates() {
  const all = [{
    slot: myPlayerIdx,
    x: player.x,
    y: player.y,
    alive: player.alive,
    name: playerName,
  }];

  remotePlayers.forEach((rp, slot) => {
    let x = rp.logicX ?? rp.x;
    let y = rp.logicY ?? rp.y;

    if (!isHost) {
      const interp = getInterpolatedRemote(slot);
      if (interp) {
        x = interp.x ?? x;
        y = interp.y ?? y;
      }
    }

    all.push({
      ...rp,
      slot,
      x,
      y,
    });
  });

  all.sort((a, b) => a.slot - b.slot);
  return all;
}

function applyRopeUpdate(msg) {
  // Future: sync rope anchor positions
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  PHASE 3 â€” DRAW REMOTE PLAYERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function drawRemotePlayers() {
  remotePlayers.forEach((rp, slot) => {
    const interp = getInterpolatedRemote(slot);
    if (interp && interp !== rp) {
      rp = { ...rp, x: interp.x, y: interp.y };
    }
    if (!rp.alive) return;
    // BAD ping: ghost mode â€” semi-transparent to show position is approximate
    if (_lagTier === 3) ctx.globalAlpha = 0.60;
    const colorIdx = slot % PLAYER_COLORS.length;
    drawRemotePlayer(rp, colorIdx, slot);
    if (_lagTier === 3) ctx.globalAlpha = 1;
  });
}

function drawRemotePlayer(rp, colorIdx, slot) {
  const x = rp.x, y = rp.y;
  const speaking = isSpeaking(slot);

  ctx.save();
  ctx.translate(x + PLAYER_W/2, y + PLAYER_H/2);
  if (rp.facing === -1) ctx.scale(-1, 1);
  if (rp.gravityFlipped)  ctx.scale(1, -1);

  const hw = PLAYER_W/2, hh = PLAYER_H/2;

  // Speaking glow
  if (speaking) {
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur  = 16;
  }

  // "Being stood on" glow â€” green crown on top
  if (rp._headIndicator > 0) {
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur  = 14;
    rp._headIndicator--;
  }

  // Body
  ctx.fillStyle = PLAYER_COLORS[colorIdx];
  ctx.fillRect(-hw, -hh, PLAYER_W, PLAYER_H);

  // Highlight stripe
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(-hw, -hh, PLAYER_W, 6);

  // Face
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#000';
  const eyeY = -hh + 8;
  ctx.fillRect(-hw + 6, eyeY, 5, 5);
  ctx.fillRect(hw - 11,  eyeY, 5, 5);
  if (!rp.onGround) {
    ctx.beginPath(); ctx.arc(0, eyeY+12, 4, 0, Math.PI*2); ctx.fill();
  } else {
    ctx.fillRect(-6, eyeY+12, 12, 3);
  }

  ctx.restore();

  // Name tag
  ctx.save();
  ctx.font = '7px monospace';
  ctx.fillStyle = PLAYER_COLORS[colorIdx];
  ctx.textAlign = 'center';

  // Stack indicator: show "â†‘" above name if being stood on
  if (rp._headIndicator > 0) {
    ctx.fillStyle = '#ffd700';
    ctx.fillText('ðŸ‘‘', x + PLAYER_W/2, y - 28);
    ctx.fillStyle = PLAYER_COLORS[colorIdx];
  }

  ctx.fillText(rp.name, x + PLAYER_W/2, y - 6);

  if (speaking) {
    ctx.fillStyle = '#00ff88';
    ctx.fillText('🎙️', x + PLAYER_W/2, y - 18);
  }

  ctx.textAlign = 'left';
  ctx.restore();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
