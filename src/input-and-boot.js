//  INPUT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function setupInput() {
  document.addEventListener('keydown', e => {
    // Never block input when typing in a text field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.repeat) return;
    switch(e.code) {
      case 'ArrowLeft':  case 'KeyA': keys.left  = true;  e.preventDefault(); break;
      case 'ArrowRight': case 'KeyD': keys.right = true;  e.preventDefault(); break;
      case 'ArrowUp': case 'KeyW': case 'Space':
        keys.jump = true;
        keys.jumpPressed = true;
        e.preventDefault();
        break;
    }
  });
  document.addEventListener('keyup', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch(e.code) {
      case 'ArrowLeft':  case 'KeyA': keys.left  = false; break;
      case 'ArrowRight': case 'KeyD': keys.right = false; break;
      case 'ArrowUp': case 'KeyW': case 'Space':
        keys.jump = false;
        keys.jumpPressed = false;
        break;
    }
  });

  // Auth inputs: Enter key handling (playerNameInput no longer exists â€” replaced by auth form)
  const liPass = document.getElementById('liPassword');
  if (liPass) liPass.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') authLogin(); });
  const liUser = document.getElementById('liUsername');
  if (liUser) liUser.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') authLogin(); });
  const regPass = document.getElementById('regPassword');
  if (regPass) regPass.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') authRegister(); });
}

// â”€â”€â”€ MOBILE TOUCH CONTROLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function setupMobileControls() {
  const btnL = document.getElementById('btnLeft');
  const btnR = document.getElementById('btnRight');
  const btnJ = document.getElementById('btnJump');

  function addTouch(btn, onStart, onEnd) {
    btn.addEventListener('touchstart', e => { e.preventDefault(); onStart(); btn.classList.add('pressed'); }, { passive: false });
    btn.addEventListener('touchend',   e => { e.preventDefault(); onEnd();   btn.classList.remove('pressed'); }, { passive: false });
    btn.addEventListener('touchcancel',e => { e.preventDefault(); onEnd();   btn.classList.remove('pressed'); }, { passive: false });
  }

  addTouch(btnL,
    () => { touchLeft = true; },
    () => { touchLeft = false; }
  );
  addTouch(btnR,
    () => { touchRight = true; },
    () => { touchRight = false; }
  );
  addTouch(btnJ,
    () => { touchJump = true; },
    () => { touchJump = false; }
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SCREEN / OVERLAY HELPERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  // Rotate-to-landscape overlay: only show during gameplay, never on menus
  const rm = document.getElementById('rotateMsg');
  if (rm) rm.classList.toggle('game-active', id === 'gameScreen');
  // Background music per screen
  if (id === 'nameScreen' || id === 'modeScreen' || id === 'lobbyScreen' || id === 'roomScreen') {
    AUDIO.playBg('bg_menu.mp3');
  } else if (id === 'gameScreen') {
    AUDIO.playBg('bg_game.mp3');
  }
}

function showOverlay(id) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  el.classList.add('fade-in');
}

function hideOverlay(id) {
  document.getElementById(id).classList.add('hidden');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  RANDOMIZER TOGGLE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function toggleRandomizer() {
  randomizeMode = !randomizeMode;
  const btn = document.getElementById('randBtn');
  if (btn) {
    btn.textContent = `🎲  RANDOM ORDER: ${randomizeMode ? 'ON' : 'OFF'}`;
    btn.style.borderColor = randomizeMode ? '#ffd700' : '';
    btn.style.color       = randomizeMode ? '#ffd700' : '';
  }
  const chk = document.getElementById('chkRandomize');
  if (chk) chk.checked = randomizeMode;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  TRAP HINT HUD (shows current level's traps)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const TRAP_ICONS = {
  spike_up: '▲', spike_down: '▼', spike_moving_h: '↔▲',
  spike_moving_v: '↕▲', spike_wheel: '⚙', floor_hole: '⬛',
  ceiling_spike: '▼↓', wall_moving: '▐', saw_blade: '🔪',
  lava_pool: '🔥', laser: '💥', piston: '⬇', boulder: '🪨',
  ice_floor: '🧊', conveyor: '→', acid_drip: '💧',
  fake_wall: '?', fake_floor: '?', electro_fence: '⚡', bounce_pad: '⬆',
};

function updateTrapHintHUD() {
  const seen = new Set(traps.map(t => t.type));
  const icons = [...seen].map(t => TRAP_ICONS[t] || t).join(' ');
  const el = document.getElementById('hudTrap');
  if (el) el.textContent = icons;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  PHASE 2: ROPE SYSTEM (single-player preview)
//  Full multiplayer rope in Phase 3 â€” this builds
//  the physics foundation used in Phase 3.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const rope = {
  active: false,
  anchorX: 0, anchorY: 0,  // fixed anchor (wall/ceiling)
  length: 150,
  snapLength: 220,          // snap if stretched beyond this
  segments: [],             // for visual only in phase 2
};

function initRopeSegments(x1, y1, x2, y2, count) {
  rope.segments = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    rope.segments.push({ x: x1 + (x2-x1)*t, y: y1 + (y2-y1)*t });
  }
}

function updateRope() {
  if (!rope.active) return;
  // Catenary relaxation â€” pull player back if rope is taut
  const px = player.x + PLAYER_W/2;
  const py = player.y + PLAYER_H/2;
  const dx = px - rope.anchorX;
  const dy = py - rope.anchorY;
  const dist = Math.sqrt(dx*dx + dy*dy);

  if (dist > rope.snapLength) {
    // SNAP
    rope.active = false;
    spawnParticles(px, py, '#ffaa00', 16);
    killPlayer("THE ROPE SNAPPED.");
    return;
  }

  if (dist > rope.length) {
    // Constrain
    const factor = (dist - rope.length) / dist;
    player.x -= dx * factor * 0.5;
    player.y -= dy * factor * 0.5;
    player.vx -= dx * factor * 0.08;
    player.vy -= dy * factor * 0.08;
  }

  // Update visual segments (simple catenary approximation)
  const segs = rope.segments;
  const n = segs.length;
  if (n < 2) return;
  segs[0].x = rope.anchorX;
  segs[0].y = rope.anchorY;
  segs[n-1].x = px;
  segs[n-1].y = py;
  // Gravity-sag relaxation
  for (let iter = 0; iter < 5; iter++) {
    for (let i = 1; i < n - 1; i++) {
      segs[i].x = (segs[i-1].x + segs[i+1].x) / 2;
      segs[i].y = (segs[i-1].y + segs[i+1].y) / 2 + 2; // gravity sag
    }
  }
}

function drawRope() {
  if (!rope.active || rope.segments.length < 2) return;
  ctx.save();
  ctx.strokeStyle = '#c8a060';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#c8a060';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(rope.segments[0].x, rope.segments[0].y);
  for (let i = 1; i < rope.segments.length; i++) {
    ctx.lineTo(rope.segments[i].x, rope.segments[i].y);
  }
  ctx.stroke();
  // Anchor point
  ctx.beginPath();
  ctx.arc(rope.anchorX, rope.anchorY, 5, 0, Math.PI*2);
  ctx.fillStyle = '#c8a060';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  BOOT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
window.addEventListener('load', init);
