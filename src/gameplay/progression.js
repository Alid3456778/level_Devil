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
