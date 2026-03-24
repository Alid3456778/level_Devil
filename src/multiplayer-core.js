//  LEVEL DEVIL â€” Phase 3: Multiplayer + Voice
//  Architecture:
//    Signaling : Socket.io (your own server)
//    Game data : Socket.io relay (host â†’ server â†’ clients)
//    Voice     : WebRTC audio (server-signaled, direct P2P audio)
//    Host      : authoritative â€” simulates all physics
//    Clients   : send input, receive & render state
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€â”€ CONSTANTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GRAVITY       = 0.55;
const JUMP_FORCE    = -13;
const MOVE_SPEED    = 4.5;
const PLAYER_W      = 28;
const PLAYER_H      = 36;
const TILE          = 32;
const GROUND_H      = TILE;

// â”€â”€â”€ PLAYER COLORS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PLAYER_COLORS = ['#e8e8e8','#ff8844','#44aaff','#88ff44'];
const PLAYER_DARK   = ['#888','#994422','#225588','#448822'];

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  PHASE 3 â€” MULTIPLAYER STATE (Socket.io)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let multiMode   = false;   // true when in multiplayer
let isHost      = false;   // true for room creator
let myPlayerIdx = 0;       // slot 0-3
let roomCode    = null;    // 6-char room code
let socket      = null;    // Socket.io socket
let mySocketId  = null;

// socketId â†’ { socketId, name, slot }
const players = new Map();

// Remote players state: slot â†’ { x, y, vx, vy, facing, gravityFlipped, alive, name, animFrame }
const remotePlayers = new Map();

// Ping tracking
let pingInterval = null;
let myPing = 0;
let _pingSentAt = 0;

// â”€â”€â”€ MEDIA (Voice â€” WebRTC audio only) â”€â”€â”€â”€â”€â”€â”€
let localStream      = null;
let micEnabled       = false;
// peerConnections: socketId â†’ RTCPeerConnection (for voice)
const peerConns      = new Map();
const remoteStreams   = new Map(); // slot â†’ MediaStream
const audioAnalysers  = new Map(); // slot â†’ AnalyserNode
let audioCtx         = null;

// â”€â”€â”€ ROPE MULTIPLAYER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ROPE_MAX_LEN  = 200;
const ROPE_SNAP_LEN = 280;

// â”€â”€â”€ GAME STATE BROADCAST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let stateTickAccum  = 0;
const STATE_TICK_MS = 22; // ~45 Hz â€” more frequent = less client drift
let lastInputSent   = 0;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  ADAPTIVE LAG COMPENSATION SYSTEM
//  Automatically tunes ALL sync parameters based on measured ping.
//  At >200ms the game auto-adjusts so it stays smooth and playable.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// These are mutable â€” _applyLagSettings() changes them based on ping tier
let INTERP_DELAY_MS = 80;  // how far behind we render remote players
let _MAX_SNAPSHOTS  = 12;  // snapshot buffer depth

const _remoteSnapshots = new Map();

// â”€â”€ PING HISTORY â€” smooth out single spikes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _pingHistory       = [];
const _PING_HISTORY_SIZE = 8;
let   _smoothPing        = 0;
let   _lagTier           = 0; // 0=GREAT 1=GOOD 2=HIGH 3=BAD
const _LAG_NAMES         = ['GREAT','GOOD','HIGH','BAD'];

function _updateLagTier(rawPing) {
  _pingHistory.push(rawPing);
  if (_pingHistory.length > _PING_HISTORY_SIZE) _pingHistory.shift();
  // Trim top 25% spikes â€” use stable average
  const sorted   = [..._pingHistory].sort((a,b) => a-b);
  const trimmed  = sorted.slice(0, Math.ceil(sorted.length * 0.75));
  _smoothPing    = Math.round(trimmed.reduce((s,v) => s+v, 0) / trimmed.length);

  const prev = _lagTier;
  if      (_smoothPing < 80)  _lagTier = 0; // GREAT
  else if (_smoothPing < 150) _lagTier = 1; // GOOD
  else if (_smoothPing < 280) _lagTier = 2; // HIGH
  else                        _lagTier = 3; // BAD

  if (_lagTier !== prev) {
    _applyLagSettings();
    console.log(`[Lag] ${_LAG_NAMES[prev]} â†’ ${_LAG_NAMES[_lagTier]} (${_smoothPing}ms avg)`);
  }
}

function _applyLagSettings() {
  // Each tier tunes the interpolation window so we always have
  // enough snapshots to interpolate smoothly, regardless of latency.
  switch (_lagTier) {
    case 0: INTERP_DELAY_MS = 50;  _MAX_SNAPSHOTS = 8;  break; // <80ms  â€” near-instant
    case 1: INTERP_DELAY_MS = 120; _MAX_SNAPSHOTS = 12; break; // <150ms â€” comfortable
    case 2: INTERP_DELAY_MS = 220; _MAX_SNAPSHOTS = 18; break; // <280ms â€” full comp
    case 3: INTERP_DELAY_MS = 350; _MAX_SNAPSHOTS = 24; break; // >280ms â€” heavy comp
  }
}

// â”€â”€ TRAP INTERPOLATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Clients run trap physics locally at 60fps for smooth animation.
// Host corrections arrive at 45Hz â€” we DON'T hard-snap, we blend.
// This eliminates the stutter on moving traps (spikes, saws, walls).
const _trapTargets       = new Map(); // trapIdx â†’ {x, y, angle, extended} from host
const TRAP_CORRECT_SPEED = 0.25;      // blend 25% toward host per frame = ~8 frame convergence

// â”€â”€ MISSED PACKET DETECTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _lastStateSeq = -1;
let _missedPackets = 0;
let _nextStateSeq = 0;

function _stateSeqDelta(prev, next) {
  return (next - prev + 65536) % 65536;
}

function _resetRemoteStateBuffers(slot = null) {
  if (slot === null) {
    _remoteSnapshots.clear();
    _lastStateSeq = -1;
    _missedPackets = 0;
    _nextStateSeq = 0;
    return;
  }
  _remoteSnapshots.delete(slot);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SOCKET.IO â€” INIT & CONNECT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function connectSocket(cb) {
  if (socket && socket.connected) { cb && cb(); return; }

  try {
    socket = io(window.SERVER_URL, {
      // WebSocket only â€” polling adds 200-400ms latency per packet
      // If WebSocket fails, we show an error rather than silently lag
      transports: ['websocket'],
      upgrade: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 8000,
      // Longer timeout â€” Render free tier can take 3-5s to wake on first connect
      timeout: 15000,
    });
  } catch(e) {
    console.warn('[Socket] io() failed â€” server offline?', e.message);
    _setConnStatus('⚠ Server unreachable. Check SERVER_URL.');
    return;
  }

  socket.on('connect', () => {
    mySocketId = socket.id;
    const transport = socket.io.engine.transport.name;
    console.log(`[Socket] ✓ Connected â€” id=${mySocketId} transport=${transport}`);
    cb && cb();
  });

  socket.on('connect_error', (err) => {
    console.error('[Socket] ✗  Connect error:', err.message, err.type || '');
    _setConnStatus('⚠  Cannot reach server: ' + err.message);
  });

  socket.on('reconnect', (attempt) => {
    console.log(`[Socket] Reconnected after ${attempt} attempts — id=${socket.id}`);
    mySocketId = socket.id;
  });

  socket.on('reconnect_attempt', (n) => {
    console.log(`[Socket] Reconnect attempt #${n}`);
  });

  socket.on('disconnect', (reason) => {
    console.warn(`[Socket] Disconnected: ${reason} — multiMode=${multiMode}`);
    if (multiMode) _setConnStatus('⚠ Disconnected: ' + reason);
  });

  // â”€â”€ Room events â”€â”€
  socket.on('room:player_joined', ({ player }) => {
    players.set(player.socketId, player);
    _resetRemoteStateBuffers(player.slot);
    remotePlayers.set(player.slot, {
      x: 60 + player.slot * 40, y: 380,
      vx: 0, vy: 0, facing: 1,
      gravityFlipped: false, alive: true,
      name: player.name, animFrame: 0,
    });
    updateLobbyUI();
    updateLobbyVoiceTiles();
    _setConnStatus(`» ${player.name} joined`);
    // Voice: call the new player
    _voiceCallPeer(player.socketId, player.slot);
    // P2P game data channel: host opens offer to new player
    if (isHost) setTimeout(() => _p2pCreateOffer(player.socketId), 600);
  });

  socket.on('room:player_left', ({ socketId, slot, name }) => {
    players.delete(socketId);
    remotePlayers.delete(slot);
    _resetRemoteStateBuffers(slot);
    removeVoiceTile(slot);
    _closePeerConn(socketId);
    _p2pClose(socketId); // close game data channel
    updateLobbyUI();
    updateLobbyVoiceTiles();
    _setConnStatus(`» ${name} left`);
  });

  socket.on('room:new_host', ({ socketId }) => {
    if (socketId === mySocketId) {
      isHost = true;
      const btn = document.getElementById('startGameBtn');
      if (btn) btn.style.display = 'block';
      const wait = document.getElementById('waitingForHost');
      if (wait) wait.style.display = 'none';
      _setConnStatus('You are now the host');
    }
  });

  // â”€â”€ WebRTC voice signaling â”€â”€
  socket.on('voice:offer', async ({ from, offer }) => {
    await _handleVoiceOffer(from, offer);
  });

  socket.on('voice:answer', async ({ from, answer }) => {
    const pc = peerConns.get(from);
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on('voice:ice', async ({ from, candidate }) => {
    const pc = peerConns.get(from);
    if (pc && candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e) {}
    }
  });

  // â”€â”€ P2P GAME DATA CHANNEL SIGNALING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // These are tiny control messages (< 1KB each) â€” game state goes direct P2P
  socket.on('p2p:offer',  async ({ from, offer })     => _p2pHandleOffer(from, offer));
  socket.on('p2p:answer', async ({ from, answer })    => _p2pHandleAnswer(from, answer));
  socket.on('p2p:ice',    async ({ from, candidate }) => _p2pAddIce(from, candidate));

  // â”€â”€ Game start â€” CLIENTS ONLY (host launches itself in hostStartGame) â”€â”€
  socket.on('game:start', ({ levelOrder, mpOnlyMode: mpo, ropeEnabled, summary }) => {
    // Host already launched via hostStartGame() callback â€” skip to avoid double launch
    if (isHost) {
      console.log('[MP] game:start received but I am host â€” skipping (already launched)');
      return;
    }
    console.log('[MP] game:start received as client â€” launching game');
    _applyRoomSummary(summary);
    // Sync lobby settings from host
    if (mpo !== undefined) {
      mpOnlyMode = mpo;
      const chkMP = document.getElementById('chkMPOnly');
      if (chkMP) chkMP.checked = mpOnlyMode;
    }
    if (ropeEnabled !== undefined) {
      const chkRope = document.getElementById('chkRope');
      if (chkRope) chkRope.checked = ropeEnabled;
    }
    launchMultiplayerGame(levelOrder);
  });

  socket.on('game:state', (payload) => {
    if (isHost) return;
    // If direct P2P state is live, ignore the slower socket relay copy.
    if (_p2pReadyCount() > 0) return;
    applyGameState(payload);
  });

  // Client missed packets â€” force full sync next broadcast
  socket.on('game:client_needs_sync', () => {
    if (isHost) {
      _fullSyncRequested = true;
      _lastBroadcast = null;
    }
  });

  socket.on('game:input', (payload) => {
    if (isHost) {
      const p = [...players.values()].find(x => x.socketId === payload.fromSocketId);
      if (p) applyRemoteInput(p.slot, payload);
    }
  });

  socket.on('game:event', ({ type, fromSocketId, ...data }) => {
    const p = [...players.values()].find(x => x.socketId === fromSocketId);
    switch (type) {
      case 'remote_trap_kill': {
        // Host killed a remote player â€” that remote player dies on all clients
        const rpKill = remotePlayers.get(data.slot ?? slot);
        if (rpKill) {
          rpKill.alive = false;
          spawnParticles(rpKill.x + PLAYER_W/2, rpKill.y + PLAYER_H/2, '#ff4444', 20);
        }
        break;
      }

      case 'player_died': {
        if (!p) return;
        console.log(`[MP] player_died received â€” slot=${p.slot}, mySlot=${myPlayerIdx}`);

        // Mark remote player as dead + particles
        const rp = remotePlayers.get(p.slot);
        if (rp) {
          rp.alive = false;
          spawnParticles(rp.x + PLAYER_W/2, rp.y + PLAYER_H/2, PLAYER_COLORS[p.slot]||'#ff2a2a', 20);
        }

        // Skip if this is MY OWN death echoed back â€” killPlayer() already handled it
        if (p.slot === myPlayerIdx) break;

        // A DIFFERENT player died â€” show their death and die with them (squad restart)
        if (gameState === 'playing') {
          const msg = data.msg || (p.name ? `${p.name} DIED!` : 'TEAMMATE DIED!');
          deathCount++;
          levelDeaths++;
          document.getElementById('hudDeaths').textContent = `💀 ${deathCount}`;
          shakeTimer = 20;
          gameState = 'dead';
          setTimeout(() => {
            document.getElementById('deathMsg').textContent = msg;
            document.getElementById('deathCountDisplay').textContent = deathCount;
            showOverlay('deathOverlay');
          }, 500);
        }
        break;
      }
      case 'player_respawn': {
        if (!p) return;
        const rp2 = remotePlayers.get(p.slot);
        if (rp2) { rp2.alive = true; rp2.x = data.x; rp2.y = data.y; }
        break;
      }
      case 'level_complete':
        // Only host decides to advance â€” non-hosts just wait for level_load
        if (isHost) {
          console.log('[Host] All players at door â€” advancing level');
          hostAdvanceLevel();
        }
        break;

      case 'level_load': {
        // Authoritative level load from host â€” ALL clients use this exact index
        const newIdx = data.levelIndex;
        const preserveLevelDeaths = newIdx === currentLevelIndex;
        console.log(`[MP] level_load received — index=${newIdx}, isHost=${isHost}`);
        currentLevelIndex = newIdx;
        _doorReached.clear();
        hideOverlay('deathOverlay');
        hideOverlay('levelClearOverlay');
        gameState = 'loading';
        AUDIO._bgFile = null;
        AUDIO.playBg('bg_game.mp3');
        loadLevel(currentLevelIndex, { preserveLevelDeaths }).then(() => {
          gameState = 'playing';
          console.log(`[MP] Level ${newIdx} loaded and playing`);
          if (!isHost && socket) {
            socket.emit('game:event', { type: 'client_ready', levelIndex: newIdx });
          }
        }).catch(err => {
          console.error('[MP] level_load failed:', err);
          gameState = 'idle';
        });
        break;
      }

      case 'client_event_trigger': {
        if (!isHost || !p) break;
        hostAcceptClientEventTrigger(p.slot, data);
        break;
      }

      case 'key_collected': {
        // Another player picked up the key â€” unlock door for everyone
        if (key) {
          key.collected = true;
          door.open = true;
          spawnParticles(key.x, key.y, '#ffd700', 20);
        }
        // Show message
        const el = document.getElementById('hudTrap');
        if (el) {
          el.textContent = `🔑 ${data.collectorName || 'PLAYER'} GOT THE KEY!`;
          el.style.color = '#ffd700';
          setTimeout(() => { el.style.color = '#ff8800'; updateTrapHintHUD(); }, 3000);
        }
        break;
      }

      case 'player_at_door': {
        // A remote player reached the door â€” add to tally
        if (p) {
          _doorReached.add(p.slot);
          console.log(`[MP] player_at_door slot=${p.slot}, doorReached=${_doorReached.size}`);
        }
        const totalMP = 1 + remotePlayers.size;
        if (isHost) {
          // Only HOST checks if everyone is done and triggers level advance
          if (_doorReached.size >= totalMP && gameState === 'playing') {
            console.log('[Host] All players at door — clearing level');
            levelClear();
          } else {
            _showDoorWait(totalMP - _doorReached.size);
          }
        } else {
          // Non-host clients just show the wait indicator
          if (_doorReached.size < totalMP) {
            _showDoorWait(totalMP - _doorReached.size);
          }
        }
        break;
      }

      case 'button_state': {
        // Sync a pressure button state from another player
        traps.forEach(t => {
          if (t.type === 'pressure_button' && (t.id || t.x) === data.buttonId) {
            if (data.pressed) t._pressedBy = t._pressedBy || new Set();
            if (data.pressed && p) t._pressedBy.add(p.slot);
            // Check if both buttons in same group are now pressed
            _checkBuddyButtons();
          }
        });
        break;
      }

      case 'switcheroo': {
        // Remote player swapped positions â€” update our remote position
        if (p && p.slot !== myPlayerIdx) {
          const rp = remotePlayers.get(p.slot);
          if (rp) { rp.x = data.fromX; rp.y = data.fromY; }
          // If we are the target, teleport us
          if (data.toSlot === myPlayerIdx) {
            player.x = data.toX;
            player.y = data.toY;
            player.vx = 0; player.vy = 0;
            spawnParticles(player.x, player.y, '#aa44ff', 20);
          }
        }
        break;
      }

      case 'rope_yank': {
        if (isRopeLevelActive() && player.alive && data.slot !== myPlayerIdx) {
          player.vy = data.force || -15;
          player.onGround = false;
          spawnParticles(player.x, player.y, '#c8a060', 10);
        }
        break;
      }

      case 'client_ready': {
        // A client finished loading â€” useful for debugging sync issues
        console.log(`[Host] Client slot=${p?.slot} ready for level ${data.levelIndex}`);
        // Force a full state sync to newly-ready client
        _fullSyncRequested = true;
        _lastBroadcast = null;
        break;
      }

      case 'pillar_push': {
        // Host pushed a remote player away from a pillar â€” apply to local if it's us
        if (p && p.slot === myPlayerIdx) {
          player.x  = data.newX;
          player.vx = data.newX > player.x ? 5 : -5;
        } else if (p) {
          const rp = remotePlayers.get(p.slot);
          if (rp) rp.x = data.newX;
        }
        break;
      }

      case 'request_restart': {
        // A client is asking to restart (their respawn timed out waiting for host)
        if (isHost && gameState !== 'playing') {
          console.log('[Host] Client requested restart — broadcasting level_load');
          socket.emit('game:event', { type: 'level_load', levelIndex: currentLevelIndex });
          gameState = 'loading';
          AUDIO._bgFile = null;
          AUDIO.playBg('bg_game.mp3');
          loadLevel(currentLevelIndex, { preserveLevelDeaths: true }).then(() => { gameState = 'playing'; });
        }
        break;
      }
    }
  });

  // â”€â”€ Ping â”€â”€
  socket.on('ping:res', ({ ts }) => {
    myPing = Date.now() - ts;
    _updateLagTier(myPing); // adaptive compensation update
    updatePingDisplay();
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  PHASE 3 â€” NAVIGATION & MODE FLOW
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function goToModeSelect() {
  // Read name from whichever auth input is visible, or use already-set playerName
  if (!playerName || playerName === 'PLAYER') {
    const inp = document.getElementById('liUsername') || document.getElementById('regUsername');
    const val = (inp?.value || '').trim().toUpperCase();
    playerName = val || _authUsername || 'PLAYER';
  }
  refreshModeAccountUI();
  showScreen('modeScreen');
}

function startSoloGame() {
  multiMode = false;
  isHost    = false;
  startGame();
}

function goToRoomScreen() {
  showScreen('roomScreen');
  // Pre-connect socket in background so joining is instant
  if (!socket || !socket.connected) connectSocket();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  PHASE 3 â€” CREATE / JOIN ROOM
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createRoom() {
  const btn = document.getElementById('createRoomBtn');
  btn.disabled = true;
  setStatus('createStatus', 'Connecting to server...', '');

  const doCreate = () => {
    socket.emit('room:create', { name: playerName }, (res) => {
      btn.disabled = false;
      if (!res.ok) {
        setStatus('createStatus', 'Error: ' + (res.reason || 'unknown'), 'err');
        return;
      }
      roomCode    = res.code;
      isHost      = true;
      myPlayerIdx = res.slot; // always 0 for host
      mySocketId  = socket.id;

      _applyRoomSummary(res.summary);

      document.getElementById('myRoomCode').textContent = roomCode;
      setStatus('createStatus', '✓ Room ready!', 'ok');

      // Enter lobby immediately
      enterLobby();
    });
  };

  if (socket && socket.connected) {
    doCreate();
  } else {
    connectSocket(doCreate);
  }
}

function joinRoom() {
  const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
  if (code.length < 4) { setStatus('joinStatus', 'Enter a valid code', 'err'); return; }

  setStatus('joinStatus', 'Connecting...', '');
  showConnecting('JOINING ROOM...', 'Looking for ' + code);

  const doJoin = () => {
    socket.emit('room:join', { code, name: playerName }, (res) => {
      hideConnecting();
      if (!res.ok) {
        setStatus('joinStatus', res.reason || 'Could not join', 'err');
        return;
      }
      roomCode    = res.code;
      isHost      = false;
      myPlayerIdx = res.slot;
      mySocketId  = socket.id;

      _applyRoomSummary(res.summary);
      setStatus('joinStatus', '✓ Joined!', 'ok');
      enterLobby();
    });
  };

  if (socket && socket.connected) {
    doJoin();
  } else {
    connectSocket(doJoin);
  }
}

function _applyRoomSummary(summary) {
  players.clear();
  remotePlayers.clear();
  _resetRemoteStateBuffers();
  summary.players.forEach(p => {
    players.set(p.socketId, p);
    if (p.socketId !== mySocketId) {
      remotePlayers.set(p.slot, {
        x: 60 + p.slot*40, y: 380,
        vx: 0, vy: 0, facing: 1,
        gravityFlipped: false, alive: true,
        name: p.name, animFrame: 0,
      });
    }
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  PHASE 3 â€” LOBBY
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function enterLobby() {
  document.getElementById('lobbyRoomCode').textContent = roomCode;
  document.getElementById('startGameBtn').style.display = isHost ? 'block' : 'none';
  document.getElementById('waitingForHost').style.display = isHost ? 'none' : 'block';

  updateLobbyUI();
  updateLobbyVoiceTiles();
  showScreen('lobbyScreen');

  // Auto-start mic
  if (!localStream) {
    setTimeout(() => requestMedia(), 400);
  }

  // Ping interval
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = setInterval(() => {
    if (socket && socket.connected) {
      _pingSentAt = Date.now();
      socket.emit('ping:req', { ts: _pingSentAt });
    }
  }, 2000);
}

function buildLobbyState() {
  return { players: [...players.values()], levelOrder, randomizeMode };
}

function updateLobbyUI() {
  const list = document.getElementById('playerList');
  if (!list) return;
  list.innerHTML = '';

  // Build slot map â€” self + remote players
  const slotMap = new Map();
  slotMap.set(myPlayerIdx, { slot: myPlayerIdx, name: playerName, isMe: true });
  players.forEach(p => {
    if (p.socketId !== mySocketId && !slotMap.has(p.slot)) {
      slotMap.set(p.slot, { slot: p.slot, name: p.name, isMe: false });
    }
  });

  for (let i = 0; i < 4; i++) {
    const p = slotMap.get(i);
    const div = document.createElement('div');
    div.className = 'player-slot' + (p ? '' : ' empty');
    if (p) {
      div.innerHTML = `
        <div class="p-color" style="background:${PLAYER_COLORS[i]}"></div>
        <div class="p-name">${p.name}${p.isMe ? ' (YOU)' : ''}</div>
        ${p.slot === 0 ? '<div class="p-host">👑 HOST</div>' : ''}
        <div class="p-ready" style="color:#00ff88;">●</div>
      `;
    } else {
      div.innerHTML = `<div class="p-color" style="background:#333"></div><div class="p-name" style="color:#444;">WAITING...</div>`;
    }
    list.appendChild(div);
  }
}

function addLobbyChat(sender, text, isSystem) {
  if (isSystem) {
    const statusEl = document.getElementById('voiceStatusMsg');
    if (statusEl) {
      statusEl.textContent = 'Â» ' + text;
      clearTimeout(statusEl._clearTimer);
      statusEl._clearTimer = setTimeout(() => {
        if (statusEl.textContent.startsWith('Â» ')) statusEl.textContent = '';
      }, 4000);
    }
  }
}

function sendLobbyChat() { /* chat removed â€” use voice */ }

function hostStartGame() {
  if (!isHost || !socket) return;
  buildLevelOrder();
  const chkRope = document.getElementById('chkRope');
  const ropeEnabled = !!(chkRope && chkRope.checked);
  console.log(`[Host] Starting game — levelOrder=${JSON.stringify(levelOrder.slice(0,5))}...`);

  socket.emit('room:start', { levelOrder, mpOnlyMode, ropeEnabled }, (res) => {
    if (!res || !res.ok) {
      console.error('[Host] room:start failed:', res);
      return;
    }
    console.log('[Host] room:start acknowledged — launching game');
    // Host launches itself here. Clients launch via socket.on('game:start').
    launchMultiplayerGame(levelOrder);
  });
}

function launchMultiplayerGame(lvlOrder) {
  // Guard: if already launched (host double-call protection), skip
  if (multiMode && gameState === 'playing') {
    console.warn('[MP] launchMultiplayerGame called but already playing — skipping');
    return;
  }

  console.log(`[MP] launchMultiplayerGame — isHost=${isHost}, levels=${lvlOrder?.length}`);
  if (lvlOrder) levelOrder = lvlOrder;
  _resetRemoteStateBuffers();
  multiMode  = true;
  deathCount = 0;
  currentLevelIndex = 0;
  gameState  = 'loading'; // Use 'loading' state during level fetch â€” NOT 'playing'

  showScreen('gameScreen');
  resize();
  setTimeout(resize, 80);

  loadLevel(currentLevelIndex).then(() => {
    gameState = 'playing'; // Set AFTER level is fully loaded
    console.log(`[MP] Level 0 loaded — game running. isHost=${isHost}`);
    // Tell host we are fully loaded and ready
    if (!isHost && socket) {
      socket.emit('game:event', { type: 'client_ready', levelIndex: currentLevelIndex });
    }

    document.getElementById('pingDisplay').style.display = 'block';
    ['inGameMicBtn','inGameLeaveBtn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    buildVoicePanel();

    // Cancel any existing loop before starting new one
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    animFrame = requestAnimationFrame(loop);
  }).catch(err => {
    console.error('[MP] Failed to load first level:', err);
    gameState = 'idle';
  });
}

function leaveLobby() {
  if (socket) socket.emit('room:leave');
  players.clear();
  remotePlayers.clear();
  _resetRemoteStateBuffers();
  _closeAllPeerConns();
  if (pingInterval) clearInterval(pingInterval);
  multiMode = false;
  showScreen('roomScreen');
}

function leaveToModeSelect() {
  // Stop game loop and music, return to mode select screen
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  AUDIO.stopBg();
  AUDIO._bgFile = null;
  gameState = 'idle';
  multiMode = false;
  _resetRemoteStateBuffers();
  showScreen('modeScreen');
}

function leaveGame() {
  if (socket) socket.emit('room:leave');
  players.clear();
  remotePlayers.clear();
  _resetRemoteStateBuffers();
  _closeAllPeerConns();
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  micEnabled = false;
  if (pingInterval) clearInterval(pingInterval);
  multiMode = false;
  if (animFrame) cancelAnimationFrame(animFrame);
  document.getElementById('pingDisplay').style.display = 'none';
  ['inGameMicBtn','inGameLeaveBtn'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  document.getElementById('voicePanel').innerHTML = '';
  showScreen('modeScreen');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  PHASE 3 â€” GAME STATE SYNC
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Cache of last broadcast for delta comparison
let _lastBroadcast = null;
let _fullSyncRequested = false;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  WEBRTC P2P DATA CHANNELS
//  Game state travels Hostâ†’Client directly.
//  Server is only used for WebRTC signaling (tiny messages).
//  This eliminates server relay latency completely.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const _rtcPeers   = new Map(); // socketId â†’ RTCPeerConnection
const _rtcChannels= new Map(); // socketId â†’ RTCDataChannel (send side, host only)
const _rtcReady   = new Map(); // socketId â†’ boolean (channel open)

const _RTC_CONFIG = {
  iceServers: [
    // Free public STUN servers â€” no account needed, no cost
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    // Free TURN fallback (open-relay.metered.ca â€” 0.5GB/month free)
    // Only used when direct P2P fails (e.g. symmetric NAT, mobile carrier)
    {
      urls:       'turn:openrelay.metered.ca:80',
      username:   'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls:       'turn:openrelay.metered.ca:443',
      username:   'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceTransportPolicy: 'all', // try direct first, fall back to TURN automatically
};

// How many P2P channels are open and ready
function _p2pReadyCount() {
  let n = 0;
  _rtcReady.forEach(v => { if (v) n++; });
  return n;
}

// Send a message to one peer via DataChannel (hostâ†’client)
function _p2pSend(socketId, data) {
  const ch = _rtcChannels.get(socketId);
  if (ch && ch.readyState === 'open') {
    try { ch.send(typeof data === 'string' ? data : JSON.stringify(data)); return true; }
    catch(e) {}
  }
  return false; // fell through â€” caller uses socket relay instead
}

// Send game state to ALL clients â€” P2P first, socket relay as fallback
function _p2pBroadcast(data) {
  if (_rtcChannels.size === 0) return false; // No P2P clients â€” use socket
  const json = JSON.stringify(data);
  let allP2P = true;
  let sentCount = 0;
  _rtcChannels.forEach((ch, sid) => {
    if (ch && ch.readyState === 'open') {
      try { ch.send(json); sentCount++; }
      catch(e) {
        console.warn('[P2P] send error to', sid, e.message);
        allP2P = false;
      }
    } else {
      allP2P = false; // This client not yet P2P â€” will need socket relay
    }
  });
  if (sentCount === 0) return false; // Nothing sent via P2P
  return allP2P; // True only if ALL clients received via P2P
}

// Host creates P2P offer for a new client
async function _p2pCreateOffer(clientSocketId) {
  if (!isHost || _rtcPeers.has(clientSocketId)) return;
  const pc = new RTCPeerConnection(_RTC_CONFIG);
  _rtcPeers.set(clientSocketId, pc);

  // Create data channel for game state (unreliable = UDP-like, ordered = false)
  // For game state we want speed over reliability â€” interpolation handles gaps
  const ch = pc.createDataChannel('game', {
    ordered:           false, // don't wait for retransmit
    maxRetransmits:    0,     // drop stale packets
  });
  _rtcChannels.set(clientSocketId, ch);

  ch.onopen  = () => {
    _rtcReady.set(clientSocketId, true);
    console.log(`[P2P] ✓ DataChannel OPEN → ${clientSocketId} | total P2P=${_p2pReadyCount()}`);
    _fullSyncRequested = true;
    _lastBroadcast = null;
  };
  ch.onclose = () => {
    _rtcReady.set(clientSocketId, false);
    console.warn(`[P2P] DataChannel CLOSED for ${clientSocketId}`);
  };
  ch.onerror = (e) => console.error(`[P2P] DataChannel ERROR for ${clientSocketId}:`, e);

  pc.onconnectionstatechange = () => {
    console.log(`[P2P] Connection state → ${clientSocketId}: ${pc.connectionState}`);
  };
  pc.oniceconnectionstatechange = () => {
    console.log(`[P2P] ICE state → ${clientSocketId}: ${pc.iceConnectionState}`);
  };

  // ICE candidates go through signaling server (tiny messages, not game data)
  pc.onicecandidate = ({ candidate }) => {
    if (candidate && socket) {
      socket.emit('p2p:ice', { to: clientSocketId, candidate });
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  if (socket) socket.emit('p2p:offer', { to: clientSocketId, offer });
  console.log('[P2P] Offer sent to', clientSocketId);
}

// Client receives offer and sends answer
async function _p2pHandleOffer(fromSocketId, offer) {
  if (isHost) return; // hosts don't receive offers
  const pc = new RTCPeerConnection(_RTC_CONFIG);
  _rtcPeers.set(fromSocketId, pc);

  // Client receives data on this channel
  pc.ondatachannel = ({ channel }) => {
    channel.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);
        // Route message type â€” same as socket handlers
        if (msg._type === 'game:state') {
          applyGameState(msg);
        } else if (msg._type === 'game:event') {
          _handleGameEvent(msg);
        }
      } catch(e) {}
    };
    channel.onopen  = () => {
      _rtcReady.set(fromSocketId, true);
      console.log(`[P2P] ✓ DataChannel OPEN ← from host ${fromSocketId}`);
      _resetRemoteStateBuffers();
      if (socket) socket.emit('game:request_sync');
    };
    channel.onclose = () => {
      _rtcReady.set(fromSocketId, false);
      console.warn(`[P2P] DataChannel CLOSED from host ${fromSocketId}`);
    };
    channel.onerror = (e) => console.error('[P2P] Client channel error:', e);
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate && socket) {
      socket.emit('p2p:ice', { to: fromSocketId, candidate });
    }
  };

  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  if (socket) socket.emit('p2p:answer', { to: fromSocketId, answer });
}

// Host receives answer from client
async function _p2pHandleAnswer(fromSocketId, answer) {
  const pc = _rtcPeers.get(fromSocketId);
  if (pc) await pc.setRemoteDescription(answer);
}

// Both sides add ICE candidates
async function _p2pAddIce(fromSocketId, candidate) {
  const pc = _rtcPeers.get(fromSocketId);
  if (pc) {
    try { await pc.addIceCandidate(candidate); } catch(e) {}
  }
}

// Clean up a peer connection
function _p2pClose(socketId) {
  const pc = _rtcPeers.get(socketId);
  if (pc) { try { pc.close(); } catch(e) {} }
  _rtcPeers.delete(socketId);
  _rtcChannels.delete(socketId);
  _rtcReady.delete(socketId);
}

// Extract game event handling into a standalone function so P2P can call it
function _handleGameEvent({ type, fromSocketId, slot, ...data }) {
  // This mirrors the socket.on('game:event') handler
  const p = [...(players?.values?.() || [])].find(x => x.socketId === fromSocketId);
  _dispatchGameEvent(type, slot ?? p?.slot, data, fromSocketId);
}

// How many clients are fully connected via P2P vs socket relay
function _getConnectionMode() {
  const total = remotePlayers.size;
  const p2p   = _p2pReadyCount();
  if (total === 0) return 'solo';
  if (p2p >= total) return 'p2p';
  if (p2p > 0) return 'hybrid';
  return 'relay';
}



// Called by game:client_needs_sync â€” send a full fat packet next tick
socket && socket.on && (function() {
  // This is set up in connectSocket, but also guard here
})();

function broadcastGameState() {
  if (!isHost || !multiMode || !socket) return;

  // Build player states (always send â€” small and critical)
  const players = buildAllPlayerStates();

  // â”€â”€ DELTA TRAPS: only send traps that changed since last broadcast â”€â”€
  // A trap "changed" if any of its key fields differ from last tick.
  // This cuts packet size by 70-90% on most frames.
  const changedTraps = [];
  traps.forEach((t, i) => {
    const last = _lastBroadcast?.trapCache?.[i];
    const cur = {
      state:    t.state,
      x:        Math.round(t.x * 10) / 10,
      y:        Math.round(t.y * 10) / 10,
      // Include velocity so clients can extrapolate between packets
      vx:       t.vx !== undefined ? Math.round(t.vx * 10) / 10 : undefined,
      vy:       t.vy !== undefined ? Math.round(t.vy * 10) / 10 : undefined,
      angle:    t.angle    !== undefined ? Math.round(t.angle * 1000) / 1000 : undefined,
      extended: t.extended !== undefined ? Math.round(t.extended * 100) / 100 : undefined,
      on:       t.on,
      _phase:   t._phase,
      _curH:    t._curH !== undefined ? Math.round(t._curH * 10) / 10 : undefined,
      _speed:   t._speed !== undefined ? Math.round(t._speed * 100) / 100 : undefined,
      drops:    t.drops ? t.drops.map(d => ({
        x: Math.round(d.x), y: Math.round(d.y)
      })) : undefined,
    };
    let changed = !last || _fullSyncRequested;
    if (!changed) {
      changed = cur.state !== last.state || cur.on !== last.on ||
                Math.abs((cur.x||0) - (last.x||0)) > 0.3 ||
                Math.abs((cur.y||0) - (last.y||0)) > 0.3 ||
                Math.abs((cur.angle||0) - (last.angle||0)) > 0.01 ||
                cur._phase !== last._phase ||
                cur.extended !== last.extended;
    }
    if (changed) changedTraps.push({ i, ...cur });
    _lastBroadcast = _lastBroadcast || {};
    if (!_lastBroadcast.trapCache) _lastBroadcast.trapCache = {};
    _lastBroadcast.trapCache[i] = cur;
  });

  // â”€â”€ DELTA PLATFORMS: only changed ones â”€â”€
  const changedPlatforms = [];
  platforms.forEach((p, i) => {
    const last = _lastBroadcast?.platCache?.[i];
    if (!last || last.state !== p.state || Math.abs(last.y - p.y) > 0.5 || _fullSyncRequested) {
      changedPlatforms.push({ i, state: p.state, y: Math.round(p.y * 10) / 10 });
    }
    if (!_lastBroadcast.platCache) _lastBroadcast.platCache = {};
    _lastBroadcast.platCache[i] = { state: p.state, y: p.y };
  });

  _fullSyncRequested = false;

  const state = {
    _seq:      _nextStateSeq,
    ts:        Date.now(),
    players,
    traps:     changedTraps,
    platforms: changedPlatforms,
    key:       key  ? { collected: key.collected }  : null,
    door:      door ? { open: door.open }            : null,
  };
  _nextStateSeq = (_nextStateSeq + 1) & 0xFFFF;

  // Dual-path broadcast: P2P (fast, direct) + socket relay (reliable fallback)
  // Always send via socket so clients without P2P still get state.
  // P2P clients also receive via socket but deduplicate by _seq.
  _p2pBroadcast({ ...state, _type: 'game:state' });
  socket.emit('game:state', state);
  _broadcastCount++;

  // Periodic connection log (~every 5s at 30Hz)
  if (_broadcastCount % 150 === 0) {
    const mode = _getConnectionMode();
    console.log(`[Host] Broadcast #${_broadcastCount} mode=${mode} p2p=${_p2pReadyCount()}/${remotePlayers.size} trapsChanged=${state.traps.length}`);
  }
}
let _broadcastCount = 0;

// â”€â”€â”€ CLIENT TRAP POSITION SMOOTHING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Called every frame on non-host clients.
// Smoothly moves each trap toward the host-authoritative target position.
// Lerp speed is tuned so traps look smooth at 100ms network latency.
function lerpTrapPositions() {
  if (!multiMode || isHost) return;

  // Lerp speed scales with ping tier:
  // HIGH ping = faster lerp so traps catch up before next packet arrives.
  // LOW ping  = slower lerp for smooth gentle correction.
  const baseLerp  = [0.20, 0.28, 0.40, 0.55][_lagTier]; // per lag tier
  const snapDist  = [80,   90,  120,  200 ][_lagTier]; // snap if further than this

  traps.forEach(t => {
    if (t._targetX !== undefined) {
      const d = t._targetX - t.x;
      if (Math.abs(d) > snapDist) { t.x = t._targetX; }
      else { t.x += d * (Math.abs(d) > 20 ? baseLerp * 1.4 : baseLerp); }
      if (Math.abs(t._targetX - t.x) < 0.05) t.x = t._targetX;
    }
    if (t._targetY !== undefined) {
      const d = t._targetY - t.y;
      if (Math.abs(d) > snapDist) { t.y = t._targetY; }
      else { t.y += d * (Math.abs(d) > 20 ? baseLerp * 1.4 : baseLerp); }
      if (Math.abs(t._targetY - t.y) < 0.05) t.y = t._targetY;
    }
    if (t._targetAngle !== undefined) {
      t.angle = (t.angle||0) + (t._targetAngle - (t.angle||0)) * baseLerp;
    }
    if (t._targetCurH !== undefined) {
      const d = t._targetCurH - (t._curH||0);
      t._curH = (t._curH||0) + d * (baseLerp * 1.2);
      t.h = t._curH;
      if (t._origY !== undefined) t.y = t._origY + (t._origH||0) - t._curH;
      if (Math.abs(d) < 0.05) t._curH = t._targetCurH;
    }
  });
}

function buildAllPlayerStates() {
  const states = [{
    slot: myPlayerIdx,
    x: player.x, y: player.y,
    vx: player.vx, vy: player.vy,
    facing: player.facing,
    gravityFlipped: player.gravityFlipped,
    alive: player.alive,
    animFrame: player.animFrame,
    name: playerName,
  }];
  remotePlayers.forEach((rp, slot) => states.push({
    slot,
    ...rp,
    x:  rp.logicX  ?? rp.x,
    y:  rp.logicY  ?? rp.y,
    vx: rp.logicVx ?? rp.vx,
    vy: rp.logicVy ?? rp.vy,
  }));
  return states;
}

function applyGameState(msg) {
  const now = Date.now();

  // â”€â”€ Deduplication: same _seq from both P2P and socket relay â”€â”€
  if (msg._seq !== undefined) {
    if (_lastStateSeq !== -1) {
      const delta = _stateSeqDelta(_lastStateSeq, msg._seq);
      if (delta === 0) {
        return; // Duplicate packet (received via both P2P and socket) â€” discard
      }
      if (delta > 32768) {
        return; // Older packet arrived late â€” ignore completely
      }
      if (delta !== 1) {
        _missedPackets++;
        if (_missedPackets >= 5) {
          _missedPackets = 0;
          if (socket) socket.emit('game:request_sync');
          console.log('[Client] 5 missed packets â€” requesting full sync');
        }
      } else {
        _missedPackets = 0;
      }
    }
    _lastStateSeq = msg._seq;
  }

  // â”€â”€ Player snapshots â†’ interpolation buffer â”€â”€
  // Store the snapshot with its server timestamp.
  // The draw function will interpolate between the last two snapshots
  // at (now - INTERP_DELAY_MS) to smooth out network jitter.
  msg.players.forEach(ps => {
    if (ps.slot === myPlayerIdx) return; // local player is authoritative â€” never overwrite
    if (!_remoteSnapshots.has(ps.slot)) _remoteSnapshots.set(ps.slot, []);
    const buf = _remoteSnapshots.get(ps.slot);
    // Stamp with local receive time for interpolation
    buf.push({ ts: now, ...ps, _recvTs: now });
    if (buf.length > _MAX_SNAPSHOTS) buf.shift();
    // Update game logic state immediately (collisions, stacking, etc.)
    const existing = remotePlayers.get(ps.slot) || {};
    remotePlayers.set(ps.slot, { ...existing, ...ps });
  });

  // â”€â”€ Traps: set TARGET positions for smooth interpolation â”€â”€
  // Non-host clients do NOT teleport traps to host values.
  // Instead we store _targetX/_targetY and lerp toward them every frame.
  // This eliminates the 33ms snap/jitter seen on client screens.
  if (msg.traps) {
    msg.traps.forEach(ts => {
      if (!traps[ts.i]) return;
      const t = traps[ts.i];
      // State/phase changes apply immediately (no visual for these)
      if (ts.state    !== undefined) t.state    = ts.state;
      if (ts.on       !== undefined) t.on       = ts.on;
      if (ts._phase   !== undefined) t._phase   = ts._phase;
      if (ts.drops    !== undefined) t.drops    = ts.drops;
      if (ts.extended !== undefined) t.extended = ts.extended;
      // Position/angle: store as targets for smooth lerp in updateTraps
      if (ts.x        !== undefined) t._targetX     = ts.x;
      if (ts.y        !== undefined) t._targetY     = ts.y;
      if (ts.angle    !== undefined) t._targetAngle = ts.angle;
      if (ts._curH    !== undefined) t._targetCurH  = ts._curH;
      if (ts._speed   !== undefined) t._speed       = ts._speed;
      if (ts.vx       !== undefined) t.vx           = ts.vx;
      if (ts.vy       !== undefined) t.vy           = ts.vy;
      // If target is far from current (>80px), snap instead of lerp (level load / teleport)
      if (t._targetX !== undefined && Math.abs(t.x - t._targetX) > 80) t.x = t._targetX;
      if (t._targetY !== undefined && Math.abs(t.y - t._targetY) > 80) t.y = t._targetY;
    });
  }

  // â”€â”€ Platforms â”€â”€
  if (msg.platforms) {
    msg.platforms.forEach(ps => {
      if (!platforms[ps.i]) return;
      if (ps.state !== undefined) platforms[ps.i].state = ps.state;
      if (ps.y     !== undefined) platforms[ps.i].y     = ps.y;
    });
  }

  if (msg.key  && key)  key.collected = msg.key.collected;
  if (msg.door && door) door.open     = msg.door.open;
}

// â”€â”€ Get interpolated position for a remote player â”€â”€
// Called every render frame. Returns smoothed x,y between snapshots.
function getInterpolatedRemote(slot) {
  const buf = _remoteSnapshots.get(slot);
  const base = remotePlayers.get(slot);
  if (!buf || buf.length < 2 || !base) return base;

  const renderTime = Date.now() - INTERP_DELAY_MS;

  // Find the two snapshots that straddle renderTime
  let prev = buf[0], next = buf[1];
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i].ts <= renderTime && buf[i+1].ts >= renderTime) {
      prev = buf[i];
      next = buf[i+1];
      break;
    }
  }
  // If renderTime is beyond all snapshots, extrapolate from latest
  if (renderTime > buf[buf.length - 1].ts) {
    const latest = buf[buf.length - 1];
    const dtFrames = (Date.now() - latest.ts) / (1000 / 60);
    // Keep extrapolation conservative so remote players do not lunge
    // forward when one packet arrives late or out of order.
    const maxExtrapFrames = [1.5, 2.5, 4, 6][_lagTier];
    const cap = Math.min(dtFrames, maxExtrapFrames);
    const velDamp = [0.85, 0.75, 0.6, 0.45][_lagTier];
    const extraX = Math.max(-18, Math.min(18, (latest.vx || 0) * cap * velDamp));
    const extraY = Math.max(-24, Math.min(24, (latest.vy || 0) * cap * velDamp));
    return {
      ...latest,
      x: latest.x + extraX,
      y: latest.y + extraY,
    };
  }

  // Linear interpolation between prev and next
  const t = prev.ts === next.ts ? 0 : (renderTime - prev.ts) / (next.ts - prev.ts);
  return {
    ...next,
    x: prev.x + (next.x - prev.x) * t,
    y: prev.y + (next.y - prev.y) * t,
  };
}

let _lastInputState = null;
function sendInputToHost() {
  if (!multiMode || isHost || !socket) return;
  const now = Date.now();
  if (now - lastInputSent < 16) return; // 60Hz cap

  const left  = !!(keys.left  || touchLeft);
  const right = !!(keys.right || touchRight);
  const jump  = !!(keys.jump  || touchJump);

  // Always send position/velocity at 20Hz regardless of input change
  // Send input changes immediately (zero delay on press/release)
  const inputChanged = !_lastInputState ||
    _lastInputState.left !== left ||
    _lastInputState.right !== right ||
    _lastInputState.jump !== jump;

  const timeSinceLastSend = now - lastInputSent;
  if (!inputChanged && timeSinceLastSend < 50) return; // throttle unchanged input to 20Hz

  lastInputSent = now;
  _lastInputState = { left, right, jump };

  socket.emit('game:input', {
    left, right, jump,
    x:  Math.round(player.x * 10) / 10,
    y:  Math.round(player.y * 10) / 10,
    vx: Math.round(player.vx * 100) / 100,
    vy: Math.round(player.vy * 100) / 100,
    alive: player.alive,
    facing: player.facing,
    gravityFlipped: player.gravityFlipped,
    animFrame: player.animFrame,
    ts: now, // for host-side latency compensation
  });
}

function applyRemoteInput(slot, msg) {
  const existing = remotePlayers.get(slot) || {};
  const prevLogicX = existing.logicX ?? existing.x ?? msg.x;
  const prevLogicY = existing.logicY ?? existing.y ?? msg.y;
  // If we have a recent position, blend rather than snap (prevents teleport)
  // Only hard-set if position diverged significantly (> 64px off)
  const dx = Math.abs((existing.x || 0) - msg.x);
  const dy = Math.abs((existing.y || 0) - msg.y);
  const hardSnap = dx > 64 || dy > 64 || !existing.x;
  remotePlayers.set(slot, {
    ...existing,
    x:  hardSnap ? msg.x : existing.x + (msg.x - existing.x) * 0.4,
    y:  hardSnap ? msg.y : existing.y + (msg.y - existing.y) * 0.4,
    prevLogicX,
    prevLogicY,
    logicX: msg.x,
    logicY: msg.y,
    logicVx: msg.vx,
    logicVy: msg.vy,
    vx: msg.vx, vy: msg.vy,
    facing: msg.facing,
    gravityFlipped: msg.gravityFlipped,
    alive: msg.alive,
    animFrame: msg.animFrame,
    name: remotePlayers.get(slot)?.name || '?',
  });

  if (isHost && multiMode) {
    let firedAny = false;
    events.forEach((ev, idx) => {
      if (ev.triggered) return;
      if (ev.trigger !== 'player_x' && ev.trigger !== 'player_y') return;
      if (!_didCrossEventThreshold(ev, prevLogicX, prevLogicY, msg.x, msg.y)) return;

      ev.triggered = true;
      executeAction(ev);
      firedAny = true;
      console.log(`[Host] remote input triggered event ${idx} from slot=${slot} (${ev.trigger}=${ev.value})`);
    });

    if (firedAny) {
      _fullSyncRequested = true;
      _lastBroadcast = null;
    }
  }
}

function hostAdvanceLevel() {
  currentLevelIndex++;
  const idx = currentLevelIndex;
  console.log(`[Host] hostAdvanceLevel — new index=${idx}, total levels=${levelOrder.length}`);

  if (idx >= levelOrder.length) {
    // Broadcast win to all clients then show locally
    if (socket) socket.emit('game:event', { type: 'level_load', levelIndex: idx });
    showWin();
    return;
  }

  // Broadcast the exact level index to ALL clients (including self via level_load handler)
  // This ensures everyone loads the same level at the same time
  if (socket) {
    socket.emit('game:event', { type: 'level_load', levelIndex: idx });
    console.log(`[Host] Emitted level_load index=${idx}`);
  }
  // Host also loads the level (same as clients will via the event they receive)
  gameState = 'loading';
  _doorReached.clear();
  AUDIO._bgFile = null;
  AUDIO.playBg('bg_game.mp3');
  loadLevel(idx).then(() => {
    gameState = 'playing';
    console.log(`[Host] Advanced to level ${idx}`);
  });
}

function broadcastAll(msg) {
  // Legacy shim â€” all events now go via socket directly
  if (!socket) return;
  switch (msg.type) {
    case 'PLAYER_DIED':
      socket.emit('game:event', { type:'player_died', slot: msg.slot, msg: msg.msg || '' });
      break;
    case 'PLAYER_RESPAWN':
      socket.emit('game:event', { type:'player_respawn', slot: msg.slot, x: msg.x, y: msg.y });
      break;
    case 'LEVEL_LOAD':
      socket.emit('game:event', { type:'level_load', levelIndex: msg.levelIndex });
      break;
    case 'PLAYER_LEFT':
      socket.emit('room:leave');
      break;
  }
}

function updatePingDisplay() {
  const el = document.getElementById('pingDisplay');
  if (!el) return;

  const color  = ['#00ff88','#ffcc00','#ff8800','#ff3333'][_lagTier] || '#ff2222';
  const label  = _LAG_NAMES[_lagTier] || '?';
  const cMode  = _getConnectionMode();
  const mIcon  = cMode === 'p2p' ? '⚡' : cMode === 'hybrid' ? '◑' : '●';
  const tipPfx = cMode === 'p2p' ? 'Direct P2P' : cMode === 'hybrid' ? 'Mixed' : 'Relay';
  const tip    = `${tipPfx} — ${Math.round(_smoothPing)}ms avg (${label})`;

  el.innerHTML = `<span style="color:${color}" title="${tip}">${mIcon}</span> ${myPing}ms`;
  el.title = tip;
  _updateLagBanner();
}

function _updateLagBanner() {
  let banner = document.getElementById('_lagBanner');
  if (_lagTier < 2) {
    if (banner) banner.style.display = 'none';
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = '_lagBanner';
    banner.style.cssText = [
      'position:absolute','top:0','left:0','right:0','z-index:50',
      'text-align:center','font-family:inherit','font-size:clamp(6px,1.5vw,8px)',
      'padding:2px 8px','pointer-events:none','letter-spacing:1px'
    ].join(';');
    const gs = document.getElementById('gameScreen');
    if (gs) gs.appendChild(banner);
  }
  if (_lagTier === 2) {
    banner.style.background = 'rgba(255,140,0,0.85)';
    banner.style.color = '#000';
    banner.textContent = `⚠ HIGH LATENCY ${Math.round(_smoothPing)}ms — COMPENSATING`;
  } else {
    banner.style.background = 'rgba(180,0,0,0.9)';
    banner.style.color = '#fff';
    banner.textContent = `⛔  POOR CONNECTION ${Math.round(_smoothPing)}ms -- GAME MAY FEEL DELAYED`;
  }
  banner.style.display = 'block';
}

function setStatus(id, msg, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className   = 'room-status' + (cls ? ' ' + cls : '');
}

function _setConnStatus(msg) {
  const el = document.getElementById('voiceStatusMsg');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, 5000);
}

function showConnecting(title, sub) {
  document.getElementById('connTitle').textContent = title;
  document.getElementById('connSub').textContent   = sub;
  document.getElementById('connectingOverlay').classList.remove('hidden');
}

function hideConnecting() {
  document.getElementById('connectingOverlay').classList.add('hidden');
}

function getAllPlayerStates() {
  const all = [{ slot: myPlayerIdx, x: player.x, y: player.y, alive: player.alive, name: playerName }];
  remotePlayers.forEach((rp, slot) => all.push({
    slot,
    ...rp,
    x: rp.logicX ?? rp.x,
    y: rp.logicY ?? rp.y,
    vx: rp.logicVx ?? rp.vx,
    vy: rp.logicVy ?? rp.vy,
  }));
  all.sort((a,b) => a.slot - b.slot);
  return all;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
