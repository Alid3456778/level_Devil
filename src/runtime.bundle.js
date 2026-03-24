/* ===== src/audio.js ===== */
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  AUDIO SYSTEM
//  Files live in: assets/music/
//  Expects: bg_game.mp3, bg_menu.mp3, sfx_death.mp3,
//           sfx_win.mp3, sfx_key.mp3, sfx_door.mp3,
//           sfx_jump.mp3, sfx_fall.mp3, sfx_spike.mp3
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const AUDIO = {
  _ctx:    null,
  _bgNode: null,
  _bgGain: null,
  _sfxGain: null,
  _muted:  false,
  _bgFile: null,

  // â”€â”€ Init AudioContext on first user gesture â”€â”€
  _ensureCtx() {
    if (this._ctx) return;
    try {
      this._ctx    = new (window.AudioContext || window.webkitAudioContext)();
      this._bgGain = this._ctx.createGain();
      this._bgGain.gain.value = 0.35;
      this._bgGain.connect(this._ctx.destination);
      this._sfxGain = this._ctx.createGain();
      this._sfxGain.gain.value = 0.7;
      this._sfxGain.connect(this._ctx.destination);
    } catch(e) { console.warn('[Audio] init failed:', e); }
  },

  // â”€â”€ Load a file and decode into AudioBuffer â”€â”€
  async _load(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      const buf = await res.arrayBuffer();
      return await this._ctx.decodeAudioData(buf);
    } catch(e) {
      console.warn('[Audio] load failed:', url, e.message);
      return null;
    }
  },

  // â”€â”€ Play background music (loops) â”€â”€
  async playBg(file) {
    this._ensureCtx();
    if (!this._ctx) return;
    if (this._bgFile === file) return; // already playing
    this.stopBg();
    this._bgFile = file;
    const buf = await this._load('assets/music/' + file);
    if (!buf || this._bgFile !== file) return; // superseded
    this._bgNode = this._ctx.createBufferSource();
    this._bgNode.buffer = buf;
    this._bgNode.loop   = true;
    this._bgNode.connect(this._bgGain);
    if (!this._muted) this._bgNode.start(0);
  },

  // â”€â”€ Stop background music â”€â”€
  stopBg() {
    if (this._bgNode) {
      try { this._bgNode.stop(); } catch(e) {}
      this._bgNode = null;
    }
    this._bgFile = null;
  },

  // â”€â”€ Play a one-shot sound effect â”€â”€
  async playSfx(file) {
    this._ensureCtx();
    if (!this._ctx || this._muted) return;
    const buf = await this._load('assets/music/' + file);
    if (!buf) return;
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this._sfxGain);
    src.start(0);
  },

  // â”€â”€ Toggle global mute â”€â”€
  toggleMute() {
    this._muted = !this._muted;
    if (this._bgGain)  this._bgGain.gain.value  = this._muted ? 0 : 0.35;
    if (this._sfxGain) this._sfxGain.gain.value  = this._muted ? 0 : 0.7;
    return this._muted;
  },

  setVolume(bgVol, sfxVol) {
    this._ensureCtx();
    if (this._bgGain  && bgVol  !== undefined) this._bgGain.gain.value  = bgVol;
    if (this._sfxGain && sfxVol !== undefined) this._sfxGain.gain.value = sfxVol;
  },
};

// Unlock AudioContext on first touch/click (required on iOS)
['touchstart','mousedown','keydown'].forEach(ev => {
  document.addEventListener(ev, function _unlock() {
    AUDIO._ensureCtx();
    if (AUDIO._ctx && AUDIO._ctx.state === 'suspended') {
      AUDIO._ctx.resume().catch(() => {});
    }
    document.removeEventListener(ev, _unlock);
  }, { once: true });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/* ===== src/multiplayer-core.js ===== */
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
let currentRoomMode = 'coop';
let pendingRoomMode = 'coop';
let myTeam = 'team1';

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
      auth: { token: _authToken || '' },
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
  socket.on('room:summary', (summary) => {
    _applyRoomSummary(summary);
    updateLobbyUI();
    updateLobbyVoiceTiles();
  });

  socket.on('room:player_joined', ({ player }) => {
    players.set(player.socketId, player);
    _resetRemoteStateBuffers(player.slot);
    remotePlayers.set(player.slot, {
      x: 60 + player.slot * 40, y: 380,
      vx: 0, vy: 0, facing: 1,
      gravityFlipped: false, alive: true,
      name: player.name, animFrame: 0, team: player.team || 'team1',
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
    updateLobbyUI();
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

  socket.on('friends:request', (payload) => {
    if (typeof handleFriendSocketRequest === 'function') handleFriendSocketRequest(payload);
  });
  socket.on('friends:response', (payload) => {
    if (typeof handleFriendSocketResponse === 'function') handleFriendSocketResponse(payload);
  });
  socket.on('friends:invite', (payload) => {
    if (typeof handleFriendSocketInvite === 'function') handleFriendSocketInvite(payload);
  });
  socket.on('friends:presence', (payload) => {
    if (typeof handleFriendSocketPresence === 'function') handleFriendSocketPresence(payload);
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
  pendingRoomMode = 'coop';
  showScreen('modeScreen');
}

function startSoloGame() {
  multiMode = false;
  isHost    = false;
  startGame();
}

function goToRoomScreen() {
  pendingRoomMode = 'coop';
  updateRoomScreenModeUI();
  showScreen('roomScreen');
  // Pre-connect socket in background so joining is instant
  if (!socket || !socket.connected) connectSocket();
}

function goToPvpRoomScreen() {
  pendingRoomMode = 'pvp';
  updateRoomScreenModeUI();
  showScreen('roomScreen');
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
    socket.emit('room:create', { name: playerName, mode: pendingRoomMode }, (res) => {
      btn.disabled = false;
      if (!res.ok) {
        setStatus('createStatus', 'Error: ' + (res.reason || 'unknown'), 'err');
        return;
      }
      roomCode    = res.code;
      isHost      = true;
      currentRoomMode = pendingRoomMode;
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
    socket.emit('room:join', { code, name: playerName, mode: pendingRoomMode }, (res) => {
      hideConnecting();
      if (!res.ok) {
        setStatus('joinStatus', res.reason || 'Could not join', 'err');
        return;
      }
      roomCode    = res.code;
      isHost      = false;
      currentRoomMode = res.summary?.mode || pendingRoomMode;
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

function joinRoomByCode(code, mode = 'coop') {
  const input = document.getElementById('joinCodeInput');
  if (input) input.value = String(code || '').trim().toUpperCase();
  pendingRoomMode = mode === 'pvp' ? 'pvp' : 'coop';
  updateRoomScreenModeUI();
  showScreen('roomScreen');
  joinRoom();
}

function _applyRoomSummary(summary) {
  currentRoomMode = summary?.mode === 'pvp' ? 'pvp' : 'coop';
  const prevRemote = new Map(remotePlayers);
  players.clear();
  remotePlayers.clear();
  _resetRemoteStateBuffers();
  summary.players.forEach(p => {
    players.set(p.socketId, p);
    if (p.socketId === mySocketId) myTeam = p.team || 'team1';
    if (p.socketId !== mySocketId) {
      const prev = prevRemote.get(p.slot);
      remotePlayers.set(p.slot, {
        x: prev?.x ?? (60 + p.slot*40), y: prev?.y ?? 380,
        vx: prev?.vx ?? 0, vy: prev?.vy ?? 0, facing: prev?.facing ?? 1,
        gravityFlipped: prev?.gravityFlipped ?? false, alive: prev?.alive ?? true,
        name: p.name, animFrame: 0, team: p.team || 'team1',
      });
    }
  });
  updateRoomScreenModeUI();
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
  return { players: [...players.values()], levelOrder, randomizeMode, mode: currentRoomMode };
}

function updateLobbyUI() {
  const list = document.getElementById('playerList');
  if (!list) return;
  const pvpWrap = document.getElementById('pvpTeamsWrap');
  const pvpPicker = document.getElementById('pvpTeamPicker');
  const pvpNote = document.getElementById('pvpTeamNote');
  const isPvp = currentRoomMode === 'pvp';
  if (pvpWrap) pvpWrap.style.display = isPvp ? 'grid' : 'none';
  if (pvpPicker) pvpPicker.style.display = isPvp ? 'grid' : 'none';
  if (pvpNote) pvpNote.style.display = isPvp ? 'block' : 'none';
  list.style.display = isPvp ? 'none' : 'flex';
  list.innerHTML = '';

  // Build slot map â€” self + remote players
  const slotMap = new Map();
  slotMap.set(myPlayerIdx, { slot: myPlayerIdx, name: playerName, isMe: true, team: myTeam });
  players.forEach(p => {
    if (p.socketId !== mySocketId && !slotMap.has(p.slot)) {
      slotMap.set(p.slot, { slot: p.slot, name: p.name, isMe: false, team: p.team || 'team1' });
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
        ${p.team ? `<div class="p-team">${p.team === 'team2' ? 'T2' : 'T1'}</div>` : ''}
        ${p.slot === 0 ? '<div class="p-host">👑 HOST</div>' : ''}
        <div class="p-ready" style="color:#00ff88;">●</div>
      `;
    } else {
      div.innerHTML = `<div class="p-color" style="background:#333"></div><div class="p-name" style="color:#444;">WAITING...</div>`;
    }
    list.appendChild(div);
  }
  if (isPvp) renderPvpTeams();
}

function getPvpTeamCounts() {
  const counts = { team1: 0, team2: 0 };
  const allPlayers = [{ socketId: mySocketId, slot: myPlayerIdx, name: playerName, team: myTeam }, ...players.values()];
  const seen = new Set();
  allPlayers.forEach((p) => {
    if (!p || seen.has(p.socketId)) return;
    seen.add(p.socketId);
    counts[p.team === 'team2' ? 'team2' : 'team1']++;
  });
  return counts;
}

function renderPvpTeams() {
  const team1List = document.getElementById('team1List');
  const team2List = document.getElementById('team2List');
  const team1Count = document.getElementById('team1Count');
  const team2Count = document.getElementById('team2Count');
  const btn1 = document.getElementById('pvpTeamBtn1');
  const btn2 = document.getElementById('pvpTeamBtn2');
  if (!team1List || !team2List || !team1Count || !team2Count) return;
  team1List.innerHTML = '';
  team2List.innerHTML = '';
  const allPlayers = [{ socketId: mySocketId, slot: myPlayerIdx, name: playerName, team: myTeam, isMe: true }, ...players.values()]
    .filter((p, idx, arr) => arr.findIndex(x => x.socketId === p.socketId) === idx);
  let t1 = 0;
  let t2 = 0;
  allPlayers.sort((a, b) => a.slot - b.slot).forEach((p) => {
    const card = document.createElement('div');
    card.className = 'player-slot';
    card.innerHTML = `
      <div class="p-color" style="background:${PLAYER_COLORS[p.slot % PLAYER_COLORS.length]}"></div>
      <div class="p-name">${p.name}${p.isMe ? ' (YOU)' : ''}</div>
      ${p.slot === 0 ? '<div class="p-host">👑 HOST</div>' : ''}
    `;
    if (p.team === 'team2') {
      t2++;
      team2List.appendChild(card);
    } else {
      t1++;
      team1List.appendChild(card);
    }
  });
  team1Count.textContent = `${t1}`;
  team2Count.textContent = `${t2}`;
  if (btn1) btn1.classList.toggle('active', myTeam !== 'team2');
  if (btn2) btn2.classList.toggle('active', myTeam === 'team2');
}

function setPvpTeam(team) {
  if (currentRoomMode !== 'pvp' || !socket) return;
  const normalized = team === 'team2' ? 'team2' : 'team1';
  socket.emit('room:team', { team: normalized }, (res) => {
    if (!res?.ok) {
      _setConnStatus('⚠ ' + (res?.reason || 'Could not switch team'));
      return;
    }
    myTeam = normalized;
    if (res.summary) _applyRoomSummary(res.summary);
    updateLobbyUI();
  });
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
  if (currentRoomMode === 'pvp') {
    const counts = getPvpTeamCounts();
    if (!counts.team1 || !counts.team2) {
      _setConnStatus('⚠ Need at least one player on each team');
      return;
    }
  }
  buildLevelOrder();
  const chkRope = document.getElementById('chkRope');
  const ropeEnabled = !!(chkRope && chkRope.checked);
  console.log(`[Host] Starting game — levelOrder=${JSON.stringify(levelOrder.slice(0,5))}...`);

  socket.emit('room:start', { levelOrder, mpOnlyMode, ropeEnabled }, (res) => {
    if (!res || !res.ok) {
      console.error('[Host] room:start failed:', res);
      _setConnStatus('⚠ ' + (res?.reason || 'Could not start room'));
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
  roomCode = null;
  currentRoomMode = pendingRoomMode;
  myTeam = 'team1';
  showScreen('roomScreen');
}

function leaveToModeSelect() {
  // Stop game loop and music, return to mode select screen
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  AUDIO.stopBg();
  AUDIO._bgFile = null;
  gameState = 'idle';
  multiMode = false;
  roomCode = null;
  currentRoomMode = 'coop';
  myTeam = 'team1';
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
  roomCode = null;
  currentRoomMode = 'coop';
  myTeam = 'team1';
  if (animFrame) cancelAnimationFrame(animFrame);
  document.getElementById('pingDisplay').style.display = 'none';
  ['inGameMicBtn','inGameLeaveBtn'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  document.getElementById('voicePanel').innerHTML = '';
  showScreen('modeScreen');
}

function updateRoomScreenModeUI() {
  const title = document.getElementById('roomScreenTitle');
  const badge = document.getElementById('roomModeBadge');
  const createBtn = document.getElementById('createRoomBtn');
  const joinBtn = document.querySelector('#roomScreen .room-input-row .btn');
  const createStatus = document.getElementById('createStatus');
  const joinStatus = document.getElementById('joinStatus');
  const isPvp = pendingRoomMode === 'pvp';
  if (title) title.textContent = isPvp ? 'PVP BATTLE' : 'MULTIPLAYER';
  if (badge) badge.textContent = isPvp ? 'PVP ROOM · PICK A SIDE' : 'CO-OP ROOM';
  if (createBtn) createBtn.textContent = isPvp ? 'CREATE PVP ROOM' : 'CREATE ROOM';
  if (joinBtn) joinBtn.textContent = isPvp ? 'JOIN PVP' : 'JOIN';
  if (createStatus) createStatus.textContent = isPvp ? 'Create a code for a PvP team room' : 'Ready to create a room';
  if (joinStatus) joinStatus.textContent = isPvp ? 'Enter a PvP room code to join' : 'Enter a room code to join';
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

/* ===== src/voice.js ===== */
//  PHASE 3 â€” VOICE (WebRTC audio, server-signaled)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ICE servers â€” includes free STUN + open TURN relays
// For production, replace with your own Coturn/Twilio TURN
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  // Open TURN relay (public, rate-limited â€” replace for production)
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
];

async function requestMedia() {
  // Fix: navigator.mediaDevices can be undefined on mobile HTTP (needs HTTPS)
  // or in certain browsers. Guard carefully.
  const mediaDevices = navigator.mediaDevices ||
    (navigator.getUserMedia && {
      getUserMedia: (c) => new Promise((res, rej) =>
        navigator.getUserMedia(c, res, rej))
    });

  if (!mediaDevices || !mediaDevices.getUserMedia) {
    _setConnStatus('âš  Mic unavailable (needs HTTPS or browser support)');
    console.warn('[Media] getUserMedia not supported on this device/context');
    return false;
  }

  try {
    const stream = await mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
      },
      video: false,
    });
    localStream = stream;
    micEnabled  = true;
    setupAudioAnalyser(myPlayerIdx, stream);
    updateVoiceButtons();
    updateLobbyVoiceTiles();
    buildVoicePanel();
    // Call all existing peers
    players.forEach((p) => {
      if (p.socketId !== mySocketId) _voiceCallPeer(p.socketId, p.slot);
    });
    _setConnStatus('🎙️ Mic active — others can hear you');
    return true;
  } catch(e) {
    const msg = e.name === 'NotAllowedError'  ? 'Mic blocked —  allow mic in browser settings' :
                e.name === 'NotFoundError'     ? 'No microphone found on this device' :
                e.name === 'NotSupportedError' ? 'Mic not supported (need HTTPS)' :
                'Mic error: ' + e.message;
    _setConnStatus('✗ ' + msg);
    console.warn('[Media]', e.name, e.message);
    return false;
  }
}

async function toggleMic() {
  if (!localStream) {
    const ok = await requestMedia();
    if (!ok) return;  // don't update buttons if permission denied
  } else {
    micEnabled = !micEnabled;
    localStream.getAudioTracks().forEach(t => { t.enabled = micEnabled; });
    _setConnStatus(micEnabled ? '🎙️ Mic active' : '🔇 Mic muted');
  }
  updateVoiceButtons();
  updateLobbyVoiceTiles();
  buildVoicePanel();
}

function toggleCam() { /* camera removed */ }

function updateVoiceButtons() {
  ['lobbyMicBtn','inGameMicBtn','inGameMicBtn2'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.className   = 'vc-btn' + (micEnabled ? ' active' : ' muted');
    btn.textContent = micEnabled ? '🎙️ MIC ON' : '🔇 MIC OFF';
  });
}

// Create a WebRTC peer connection for voice with a remote socket
async function _voiceCallPeer(remoteSocketId, remoteSlot) {
  if (!localStream || peerConns.has(remoteSocketId)) return;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peerConns.set(remoteSocketId, pc);

  // Add local audio tracks
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  // ICE candidates â†’ server â†’ remote
  pc.onicecandidate = ({ candidate }) => {
    if (candidate && socket) {
      socket.emit('voice:ice', { to: remoteSocketId, candidate });
    }
  };

  // Remote audio track â†’ attach
  pc.ontrack = ({ streams }) => {
    if (streams[0]) {
      remoteStreams.set(remoteSlot, streams[0]);
      setupAudioAnalyser(remoteSlot, streams[0]);
      _playRemoteAudio(streams[0]);
      updateLobbyVoiceTiles();
      buildVoicePanel();
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[Voice] ${remoteSocketId} state:`, pc.connectionState);
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      peerConns.delete(remoteSocketId);
    }
  };

  // Create and send offer
  const offer = await pc.createOffer({ offerToReceiveAudio: true });
  await pc.setLocalDescription(offer);
  if (socket) socket.emit('voice:offer', { to: remoteSocketId, offer });
}

async function _handleVoiceOffer(fromSocketId, offer) {
  if (peerConns.has(fromSocketId)) return; // already connected

  const remotePlayer = [...players.values()].find(p => p.socketId === fromSocketId);
  const remoteSlot   = remotePlayer ? remotePlayer.slot : -1;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peerConns.set(fromSocketId, pc);

  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  pc.onicecandidate = ({ candidate }) => {
    if (candidate && socket) {
      socket.emit('voice:ice', { to: fromSocketId, candidate });
    }
  };

  pc.ontrack = ({ streams }) => {
    if (streams[0] && remoteSlot >= 0) {
      remoteStreams.set(remoteSlot, streams[0]);
      setupAudioAnalyser(remoteSlot, streams[0]);
      _playRemoteAudio(streams[0]);
      updateLobbyVoiceTiles();
      buildVoicePanel();
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      peerConns.delete(fromSocketId);
    }
  };

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  if (socket) socket.emit('voice:answer', { to: fromSocketId, answer });
}

function _playRemoteAudio(stream) {
  // Auto-play incoming audio via hidden element
  const existing = document.querySelector(`audio[data-stream-id="${stream.id}"]`);
  if (existing) return;
  const audio      = document.createElement('audio');
  audio.srcObject  = stream;
  audio.autoplay   = true;
  audio.volume     = 1;
  audio.dataset.streamId = stream.id;
  audio.style.display    = 'none';
  document.body.appendChild(audio);
}

function _closePeerConn(socketId) {
  const pc = peerConns.get(socketId);
  if (pc) { try { pc.close(); } catch(e) {} peerConns.delete(socketId); }
}

function _closeAllPeerConns() {
  peerConns.forEach((pc, sid) => { try { pc.close(); } catch(e) {} });
  peerConns.clear();
  remoteStreams.clear();
  audioAnalysers.clear();
}

function setupAudioAnalyser(slot, stream) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // iOS requires resume after user gesture
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const source   = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    audioAnalysers.set(slot, analyser);
  } catch(e) { console.warn('[Audio]', e); }
}

function isSpeaking(slot) {
  const analyser = audioAnalysers.get(slot);
  if (!analyser) return false;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  const avg = data.reduce((a,b) => a+b, 0) / data.length;
  return avg > 12;
}

// â”€â”€ Voice UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildVoicePanel() {
  const panel = document.getElementById('voicePanel');
  if (!panel) return;
  panel.innerHTML = '';
  panel.appendChild(createVoiceTile(myPlayerIdx, playerName, localStream, true));
  remotePlayers.forEach((rp, slot) => {
    panel.appendChild(createVoiceTile(slot, rp.name, remoteStreams.get(slot), false));
  });
}

function createVoiceTile(slot, name, stream, isMe) {
  const tile   = document.createElement('div');
  tile.className = 'voice-tile';
  tile.id        = `vt-${slot}`;

  const avatar   = document.createElement('div');
  avatar.className = 'vt-avatar';
  avatar.style.background = PLAYER_COLORS[slot] || '#888';
  avatar.style.color      = '#000';
  avatar.style.fontFamily = 'monospace';
  avatar.id               = `vt-avatar-${slot}`;
  avatar.textContent      = name.substring(0, 2).toUpperCase();

  const nameEl   = document.createElement('div');
  nameEl.className = 'vt-name';
  nameEl.textContent = isMe ? `${name} (YOU)` : name;

  const micEl    = document.createElement('div');
  micEl.className = 'vt-mic';
  micEl.id = `vt-mic-${slot}`;
  if (isMe) {
    micEl.textContent = micEnabled ? '🎙️' : '🔇';
    micEl.classList.add(micEnabled ? 'live' : 'off');
    micEl.onclick  = toggleMic;
    micEl.style.cursor = 'pointer';
  } else {
    micEl.textContent = stream ? '🎧' : '🔇';
    micEl.classList.add(stream ? 'idle' : 'off');
  }

  tile.appendChild(avatar);
  tile.appendChild(nameEl);
  tile.appendChild(micEl);
  return tile;
}

function updateLobbyVoiceTiles() {
  const container = document.getElementById('lobbyVoiceTiles');
  if (!container) return;
  container.innerHTML = '';
  container.appendChild(createVoiceTile(myPlayerIdx, playerName, localStream, true));
  remotePlayers.forEach((rp, slot) => {
    container.appendChild(createVoiceTile(slot, rp.name, remoteStreams.get(slot), false));
  });
}

function removeVoiceTile(slot) {
  const el = document.getElementById(`vt-${slot}`);
  if (el) el.remove();
  remoteStreams.delete(slot);
  audioAnalysers.delete(slot);
}

function updateSpeakingIndicators() {
  [myPlayerIdx, ...remotePlayers.keys()].forEach(slot => {
    const av = document.getElementById(`vt-avatar-${slot}`);
    const mic = document.getElementById(`vt-mic-${slot}`);
    if (!av) return;
    const speaking = isSpeaking(slot);
    av.classList.toggle('speaking', speaking);
    if (!mic) return;
    mic.classList.remove('live', 'idle', 'off');
    if (slot === myPlayerIdx) {
      mic.textContent = micEnabled ? (speaking ? '🗣️' : '🎙️') : '🔇';
      mic.classList.add(micEnabled ? (speaking ? 'live' : 'idle') : 'off');
      return;
    }
    const hasStream = remoteStreams.has(slot);
    mic.textContent = !hasStream ? '🔇' : (speaking ? '🗣️' : '🎧');
    mic.classList.add(!hasStream ? 'off' : (speaking ? 'live' : 'idle'));
  });
}

// â”€â”€â”€ STATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let canvas, ctx;
let gameState = 'idle'; // idle | playing | dead | clear
let currentLevelIndex = 0;
let deathCount = 0;
let levelDeaths = 0;
let playerName = 'PLAYER';
let animFrame;
let levelStartTime = 0;

// â”€â”€â”€ PLAYER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const player = {
  x: 60, y: 0,
  vx: 0, vy: 0,
  onGround: false,
  alive: true,
  spawnX: 60, spawnY: 0,
  // Flash on damage
  invincible: false,
  invTimer: 0,
  // Animation
  facing: 1,
  animFrame: 0,
  animTimer: 0,
  // Special states
  gravityFlipped: false,
  controlsFlipped: false,
};

// â”€â”€â”€ INPUT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const keys = { left: false, right: false, jump: false, jumpPressed: false };
let touchLeft = false, touchRight = false, touchJump = false;
let jumpConsumed = false;

// â”€â”€â”€ CAMERA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const cam = { x: 0, y: 0 };

// â”€â”€â”€ WORLD OBJECTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let platforms   = [];  // { x, y, w, h, type, state, ... }
let traps       = [];  // { type, x, y, w, h, state, ... }
let events      = [];  // { trigger, triggered, action, ... }
let door        = { x: 0, y: 0, w: TILE, h: TILE*2, open: false };
let key         = null; // { x, y, w, h, collected }
let particles   = [];
let shakeTimer  = 0;
let _reportedEventTriggers = new Set();

// â”€â”€â”€ DEATH MESSAGES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DEATH_MSGS = [
  "THE FLOOR IS A LIE.",
  "TRUST NOTHING.",
  "GRAVITY SAYS GOODBYE.",
  "SPIKE SAYS HELLO.",
  "MAYBE WALK SLOWER?",
  "THE DEVIL LAUGHS.",
  "LOOK BEFORE YOU LEAP.",
  "CLASSIC MISTAKE.",
  "THE CEILING HATES YOU.",
  "YOU WERE DOING SO WELL...",
  "WALLS HAVE FEELINGS TOO.",
  "BOOM. GONE. BYE.",
  "WAS THAT A TRAP? YES.",
];

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/* ===== src/game-systems.js ===== */
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
    ctx.fillText('👑', x + PLAYER_W/2, y - 28);
    ctx.fillStyle = PLAYER_COLORS[colorIdx];
  }

  const teamLabel = currentRoomMode === 'pvp' ? (rp.team === 'team2' ? 'T2 ' : 'T1 ') : '';
  ctx.fillText(teamLabel + rp.name, x + PLAYER_W/2, y - 6);

  if (currentRoomMode === 'pvp') {
    ctx.fillStyle = rp.team === 'team2' ? '#ff9b6b' : '#6bc5ff';
    ctx.fillText(rp.team === 'team2' ? 'T2' : 'T1', x + PLAYER_W/2, y - 18);
    ctx.fillStyle = PLAYER_COLORS[colorIdx];
  }

  if (speaking) {
    ctx.fillStyle = '#00ff88';
    ctx.fillText('🎙️', x + PLAYER_W/2, y - (currentRoomMode === 'pvp' ? 30 : 18));
  }

  ctx.textAlign = 'left';
  ctx.restore();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/* ===== src/ui-tools.js ===== */
//  INIT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  LEVEL SELECT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let _levelSelectMode = 'solo'; // 'solo' or 'mp'

function openLevelSelect(mode) {
  _levelSelectMode = mode || 'solo';
  const grid = document.getElementById('levelSelectGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const btn = document.createElement('button');
    btn.textContent = i + 1;
    btn.title = `Level ${i + 1}`;
    const isMPOnly = MP_ONLY_LEVELS.has(i);
    btn.style.cssText = `
      width:100%; aspect-ratio:1; background:${isMPOnly ? '#3a2a6a' : '#c87820'};
      border:3px solid ${isMPOnly ? '#7755cc' : '#f0a830'};
      color:${isMPOnly ? '#bb99ff' : '#fff8e8'};
      font-family:inherit; font-size:clamp(9px,2vw,12px); cursor:pointer;
      border-radius:4px; position:relative;
      font-weight:bold; transition:transform 0.1s;
    `;
    btn.addEventListener('click', () => jumpToLevel(i));
    btn.addEventListener('mouseenter', () => btn.style.transform = 'scale(1.1)');
    btn.addEventListener('mouseleave', () => btn.style.transform = 'scale(1)');
    // MP label
    if (isMPOnly) {
      const lbl = document.createElement('div');
      lbl.textContent = '2P';
      lbl.style.cssText = 'position:absolute;top:1px;right:2px;font-size:6px;color:#bb99ff;';
      btn.appendChild(lbl);
    }
    grid.appendChild(btn);
  }
  const ov = document.getElementById('levelSelectOverlay');
  if (ov) ov.style.display = 'flex';
}

function closeLevelSelect() {
  const ov = document.getElementById('levelSelectOverlay');
  if (ov) ov.style.display = 'none';
}

function jumpToLevel(levelIdx) {
  closeLevelSelect();
  // Set up level order starting from chosen level
  buildLevelOrder();
  currentLevelIndex = levelOrder.indexOf(levelIdx);
  if (currentLevelIndex < 0) {
    // Level not in current order â€” add it
    levelOrder.unshift(levelIdx);
    currentLevelIndex = 0;
  }
  if (_levelSelectMode === 'solo') {
    deathCount = 0;
    multiMode  = false;
    gameState  = 'playing';
    showScreen('gameScreen');
    resize();
    setTimeout(resize, 50);
    document.getElementById('pingDisplay').style.display = 'none';
    ['inGameMicBtn','inGameLeaveBtn'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    document.getElementById('voicePanel').innerHTML = '';
    loadLevel(currentLevelIndex).then(() => {
      if (animFrame) cancelAnimationFrame(animFrame);
      animFrame = requestAnimationFrame(loop);
    });
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  ADMIN LEVEL VALIDATOR
//  Access via: ?admin=leveldevil or URL hash #admin
//  Hidden from all normal users
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
(function initAdminValidator() {
  const isAdmin = location.search.includes('admin=leveldevil') ||
                  location.hash.includes('admin');
  if (!isAdmin) return;

  // Build admin panel HTML
  const panel = document.createElement('div');
  panel.id = 'adminPanel';
  panel.style.cssText = `
    position:fixed; top:10px; right:10px; z-index:9999;
    background:#111; border:2px solid #ff8800; color:#f0f0f0;
    font-family:monospace; font-size:11px;
    padding:12px; width:320px; max-height:80vh; overflow-y:auto;
    border-radius:4px; box-shadow:0 4px 20px rgba(0,0,0,0.8);
  `;
  panel.innerHTML = `
    <div style="color:#ff8800;font-size:13px;font-weight:bold;margin-bottom:8px;">
      ðŸ”§ ADMIN â€” LEVEL VALIDATOR
    </div>
    <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
      <select id="adminLvlSelect" style="flex:1;background:#222;color:#fff;border:1px solid #555;padding:4px;">
        ${Array.from({length:LEVEL_COUNT},(_,i)=>`<option value="${i}">Level ${i+1}</option>`).join('')}
      </select>
      <button onclick="adminValidateLevel()" style="background:#ff8800;border:none;color:#000;padding:4px 10px;cursor:pointer;font-family:monospace;">
        VALIDATE
      </button>
      <button onclick="adminPreviewLevel()" style="background:#2266aa;border:none;color:#fff;padding:4px 10px;cursor:pointer;font-family:monospace;">
        PREVIEW
      </button>
    </div>
    <div id="adminOutput" style="background:#000;padding:8px;min-height:60px;white-space:pre-wrap;font-size:10px;line-height:1.6;color:#00ff88;"></div>
    <button onclick="document.getElementById('adminPanel').style.display='none'"
            style="margin-top:8px;background:#333;border:none;color:#aaa;padding:4px 8px;cursor:pointer;font-family:monospace;font-size:10px;">
      CLOSE
    </button>
  `;
  document.body.appendChild(panel);

  window.adminValidateLevel = async function() {
    const idx   = parseInt(document.getElementById('adminLvlSelect').value);
    const out   = document.getElementById('adminOutput');
    out.style.color = '#ffff00';
    out.textContent = `Validating level ${idx + 1}...
`;

    const lvl = await fetchLevel(idx);
    if (!lvl) { out.textContent += '✗ FAILED — JSON not found or invalid '; return; }

    out.textContent += `Name: ${lvl.name}
`;
    out.textContent += `Size: ${lvl.width}×${lvl.height}
`;
    out.textContent += `Platforms: ${lvl.platforms?.length || 0}
`;
    out.textContent += `Traps: ${lvl.traps?.length || 0}
`;
    out.textContent += `Door: (${lvl.door?.x},${lvl.door?.y})
`;
    out.textContent += `Key required: ${lvl.door?.locked ? 'YES' : 'no'}
`;

    const issues = [];

    // Check spawn point on solid floor
    const spawnX = lvl.spawnX, spawnY = lvl.spawnY;
    const spawnFloor = lvl.platforms.find(p =>
      p.type === 'solid' &&
      spawnX >= p.x && spawnX <= p.x + p.w &&
      spawnY + 36 >= p.y && spawnY + 36 <= p.y + p.h + 40
    );
    if (!spawnFloor) issues.push('⚠ Spawn may not have solid floor beneath it');

    // Check door is reachable (not buried inside solid platform)
    const doorX = lvl.door.x, doorY = lvl.door.y;
    const doorBlocked = lvl.platforms.some(p =>
      p.type === 'solid' &&
      doorX >= p.x && doorX + 32 <= p.x + p.w &&
      doorY >= p.y && doorY + 64 <= p.y + p.h
    );
    if (doorBlocked) issues.push('✗ DOOR IS INSIDE A SOLID PLATFORM — unreachable!');

    // Check if door is inside floor hole (unreachable via hole)
    const doorInHole = (lvl.traps||[]).some(t =>
      t.type === 'floor_hole' &&
      doorX >= t.x && doorX < t.x + t.w
    );
    if (doorInHole) issues.push('⚠ Door is above an open floor hole — player may fall past it');

    // Check key placement if required
    if (lvl.door?.locked && lvl.key) {
      const kx = lvl.key.x, ky = lvl.key.y;
      const keyAccessible = lvl.platforms.some(p =>
        kx >= p.x - 100 && kx <= p.x + p.w + 100 &&
        ky >= p.y - 200 && ky <= p.y + p.h + 200
      );
      if (!keyAccessible) issues.push('⚠ Key may be inaccessible (no nearby platform)');
    }

    // Check for impossible floor hole (entire floor is a hole)
    const totalFloorW = lvl.platforms
      .filter(p => p.type === 'solid' && p.y >= lvl.height - 80)
      .reduce((s, p) => s + p.w, 0);
    if (totalFloorW < 80) issues.push('⚠ Very little floor — verify player can land somewhere');

    // Check for too-high platforms (unreachable with normal jump ~200px)
    lvl.platforms.forEach(p => {
      if (p.type === 'solid' && p.y < lvl.spawnY - 250) {
        const hasSteppingStone = lvl.platforms.some(q =>
          q.type === 'solid' && q.y > p.y && q.y < lvl.spawnY &&
          Math.abs(q.x - p.x) < 300
        );
        if (!hasSteppingStone) {
          issues.push(`⚠ Platform at y=${p.y} may be too high to reach (needs stepping stones)`);
        }
      }
    });

    // Report
    if (issues.length === 0) {
      out.style.color = '#00ff88';
      out.textContent += ' ✓ LEVEL LOOKS COMPLETABLE No structural issues found. ';
    } else {
      out.style.color = '#ff8800';
      out.textContent += ' ISSUES FOUND: ' + issues.join(' ') + ' ';
      out.textContent += ' → Check these issues before shipping.';
    }
  };

  window.adminPreviewLevel = async function() {
    const idx = parseInt(document.getElementById('adminLvlSelect').value);
    buildLevelOrder();
    currentLevelIndex = levelOrder.indexOf(idx);
    if (currentLevelIndex < 0) { levelOrder.unshift(idx); currentLevelIndex = 0; }
    multiMode = false; deathCount = 0;
    gameState = 'playing';
    showScreen('gameScreen');
    resize();
    loadLevel(currentLevelIndex).then(() => {
      if (animFrame) cancelAnimationFrame(animFrame);
      animFrame = requestAnimationFrame(loop);
      document.getElementById('adminOutput').textContent = `Previewing level ${idx+1}. Press ESC or reload to return.`;
    });
  };
})();

function init() {
  canvas = document.getElementById('gameCanvas');
  ctx    = canvas.getContext('2d');
  setupInput();
  setupMobileControls();
  resize();
  window.addEventListener('resize', resize);
  // Also handle mobile orientation changes
  window.addEventListener('orientationchange', () => {
    setTimeout(() => { resize(); _checkMobileControls(); }, 300);
  });
  if (screen.orientation) {
    screen.orientation.addEventListener('change', () => {
      setTimeout(() => { resize(); _checkMobileControls(); }, 300);
    });
  }
  // visualViewport resize â€” critical for mobile: fires when browser toolbar hides/shows
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize',  resize);
    window.visualViewport.addEventListener('scroll',  resize);
  }
  // Initial resize after fonts/layout settle
  setTimeout(resize, 100);
  setTimeout(resize, 500);
  // Start rotating logo taglines
  startLogoTaglines();
  refreshModeAccountUI();
  // Try to restore previous session automatically
  authAutoLogin();
  buildLevelOrder();
}

function _checkMobileControls() {
  // Show mobile controls if touch device or small screen
  const mc = document.getElementById('mobileControls');
  if (!mc) return;
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  mc.style.display = isTouch ? 'block' : '';
}

function resize() {
  // visualViewport gives the ACTUAL visible area on mobile
  // (excludes browser toolbar, keyboard, etc.)
  // Fall back to innerWidth/Height if not available
  const vp = window.visualViewport;
  const w  = Math.round(vp ? vp.width  : window.innerWidth);
  const h  = Math.round(vp ? vp.height : window.innerHeight);
  canvas.width  = w;
  canvas.height = h;
  // CSS must match exactly so no scaling distortion
  canvas.style.width  = w + 'px';
  canvas.style.height = h + 'px';
  // Also reposition gameScreen to match visualViewport offset
  // (on mobile the toolbar can shift the viewport origin)
  if (vp) {
    const gs = document.getElementById('gameScreen');
    if (gs) {
      gs.style.top    = Math.round(vp.offsetTop)  + 'px';
      gs.style.left   = Math.round(vp.offsetLeft) + 'px';
      gs.style.width  = w + 'px';
      gs.style.height = h + 'px';
    }
    const mc = document.getElementById('mobileControls');
    if (mc) mc.style.height = Math.round(h * 0.22) + 'px';
  }
}

function toggleGameMute() {
  const muted = AUDIO.toggleMute();
  const btn = document.getElementById('btnMute');
  if (btn) btn.textContent = muted ? '🔇' : '🎙️';
}

// â”€â”€ Name screen fullscreen + tooltip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/* ===== src/auth-and-ui.js ===== */
//  AUTH SYSTEM â€” JWT + MongoDB via REST API
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const AUTH_TOKEN_KEY = 'ld_auth_token';
let _authToken    = null;
let _authUsername = null;
let _authUserId   = null;
let _authEmail    = null;
let _friendsState = { friends: [], incoming: [], outgoing: [], invites: [] };

function _authSaveToken(token, username, userId, email = null) {
  _authToken    = token;
  _authUsername = username;
  _authUserId   = userId;
  _authEmail    = email || null;
  if (typeof socket !== 'undefined' && socket) {
    socket.auth = { token: _authToken || '' };
    if (socket.connected) {
      try { socket.disconnect().connect(); } catch {}
    }
  }
  try { localStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify({ token, username, userId, email: _authEmail })); } catch {}
  refreshModeAccountUI();
}

function _authClearToken() {
  _authToken = _authUsername = _authUserId = _authEmail = null;
  _friendsState = { friends: [], incoming: [], outgoing: [], invites: [] };
  if (typeof socket !== 'undefined' && socket) {
    socket.auth = { token: '' };
    if (socket.connected) {
      try { socket.disconnect().connect(); } catch {}
    }
  }
  try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch {}
  refreshModeAccountUI();
}

function _authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (_authToken) h['Authorization'] = 'Bearer ' + _authToken;
  return h;
}

function _authSetFetchingUser(show) {
  const panel = document.getElementById('authFetchPanel');
  if (!panel) return;
  panel.classList.toggle('open', !!show);
  panel.setAttribute('aria-hidden', show ? 'false' : 'true');
}

// Called on page load â€” restore session from localStorage
async function authAutoLogin() {
  try {
    const stored = JSON.parse(localStorage.getItem(AUTH_TOKEN_KEY) || 'null');
    if (!stored?.token) return;
    if (stored.email) _authEmail = stored.email;
    _authSetFetchingUser(true);
    // Verify token is still valid with server
    const res = await fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + stored.token } });
    const data = await res.json();
    if (data.ok) {
      _authSaveToken(stored.token, data.username, data.userId, data.email || stored.email || null);
      // Pre-fill the login username field with the stored name
      const inp = document.getElementById('liUsername');
      if (inp) inp.value = data.username;
      playerName = data.username;
      console.log('[Auth] Auto-login:', data.username);
      // Show welcome back message then auto-continue
      const liMsg = document.getElementById('liMsg');
      if (liMsg) { liMsg.className = 'auth-msg ok'; liMsg.textContent = 'WELCOME BACK, ' + data.username.toUpperCase() + '!'; }
      setTimeout(() => { _dismissNsTooltip(); goToModeSelect(); }, 1200);
    } else {
      _authClearToken();
    }
    _authSetFetchingUser(false);
  } catch (e) {
    _authSetFetchingUser(false);
    console.log('[Auth] Auto-login failed:', e.message);
  }
}

async function authLogin() {
  const username = (document.getElementById('liUsername')?.value || '').trim();
  const password = (document.getElementById('liPassword')?.value || '').trim();
  const msg = document.getElementById('liMsg');
  if (!username || !password) { _authMsg(msg, 'ENTER USERNAME AND PASSWORD', 'err'); return; }
  _authMsg(msg, 'LOGGING IN...', 'info');
  try {
    const res  = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (data.ok) {
      _authSaveToken(data.token, data.username, data.userId, data.email || null);
      playerName = data.username;
      _authMsg(msg, 'WELCOME BACK, ' + data.username.toUpperCase() + '!', 'ok');
      setTimeout(() => { _dismissNsTooltip(); goToModeSelect(); }, 800);
    } else {
      _authMsg(msg, data.reason || 'LOGIN FAILED', 'err');
    }
  } catch { _authMsg(msg, 'SERVER UNREACHABLE', 'err'); }
}

async function authRegister() {
  const username = (document.getElementById('regUsername')?.value || '').trim();
  const email    = (document.getElementById('regEmail')?.value    || '').trim();
  const password = (document.getElementById('regPassword')?.value || '').trim();
  const msg = document.getElementById('regMsg');
  if (!username || !email || !password) { _authMsg(msg, 'ALL FIELDS REQUIRED', 'err'); return; }
  _authMsg(msg, 'CREATING ACCOUNT...', 'info');
  try {
    const res  = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email, password }) });
    const data = await res.json();
    if (data.ok) {
      _authSaveToken(data.token, data.username, data.userId, data.email || email || null);
      playerName = data.username;
      _authMsg(msg, 'ACCOUNT CREATED! WELCOME, ' + data.username.toUpperCase() + '!', 'ok');
      setTimeout(() => { _dismissNsTooltip(); goToModeSelect(); }, 900);
    } else {
      _authMsg(msg, data.reason || 'REGISTRATION FAILED', 'err');
    }
  } catch { _authMsg(msg, 'SERVER UNREACHABLE', 'err'); }
}

function authSkipToGuest() {
  const loginName = (document.getElementById('liUsername')?.value || '').trim();
  const registerName = (document.getElementById('regUsername')?.value || '').trim();
  const u = loginName || registerName;
  const activeMsg = document.getElementById(
    document.getElementById('authLogin')?.style.display === 'none' ? 'regMsg' : 'liMsg'
  );
  if (!u) {
    _authMsg(activeMsg, 'ENTER YOUR NAME TO PLAY AS GUEST', 'err');
    return;
  }
  playerName = u;
  refreshModeAccountUI();
  _dismissNsTooltip();
  goToModeSelect();
}

function authShowTab(tab) {
  document.getElementById('authLogin').style.display    = tab === 'login'    ? 'flex' : 'none';
  document.getElementById('authRegister').style.display = tab === 'register' ? 'flex' : 'none';
  document.getElementById('tabLogin').classList.toggle('active',    tab === 'login');
  document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
}

async function authLogout() {
  const logoutBtn = document.getElementById('modeLogoutBtn');
  if (logoutBtn) logoutBtn.disabled = true;
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: _authHeaders() });
  } catch {}
  _authClearToken();
  playerName = 'PLAYER';
  const liPassword = document.getElementById('liPassword');
  const regPassword = document.getElementById('regPassword');
  if (liPassword) liPassword.value = '';
  if (regPassword) regPassword.value = '';
  _authMsg(document.getElementById('liMsg'), 'LOGGED OUT. LOGIN WITH ANOTHER ACCOUNT.', 'info');
  authShowTab('login');
  closeFeedback();
  closeFriendsOverlay();
  showScreen('nameScreen');
  if (logoutBtn) logoutBtn.disabled = false;
}

function _authMsg(el, text, cls) {
  if (!el) return;
  el.textContent = text;
  el.className   = 'auth-msg ' + cls;
}

function refreshModeAccountUI() {
  const kicker = document.getElementById('modeAccountKicker');
  const nameEl = document.getElementById('modeAccountName');
  const hintEl = document.getElementById('modeGuestHint');
  const logoutBtn = document.getElementById('modeLogoutBtn');
  if (!kicker || !nameEl || !hintEl || !logoutBtn) return;
  if (_authToken && _authUsername) {
    kicker.textContent = 'SIGNED IN';
    nameEl.textContent = _authEmail ? `${_authUsername} / ${_authEmail}` : _authUsername;
    hintEl.textContent = 'Your scores sync to the leaderboard and feedback includes your account details.';
    logoutBtn.style.display = '';
  } else {
    kicker.textContent = 'GUEST SESSION';
    nameEl.textContent = playerName && playerName !== 'PLAYER' ? playerName : 'GUEST MODE';
    hintEl.textContent = 'Guests can play, but scores and feedback contact details are not saved.';
    logoutBtn.style.display = 'none';
  }
}

function _feedbackMsg(text, cls = 'info') {
  const el = document.getElementById('feedbackMsg');
  if (!el) return;
  el.textContent = text;
  el.className = 'feedback-msg ' + cls;
}

function _friendsMsg(text, cls = 'info') {
  const el = document.getElementById('friendsMsg');
  if (!el) return;
  el.textContent = text;
  el.className = 'friends-msg ' + cls;
}

function openFriendsOverlay() {
  const overlay = document.getElementById('friendsOverlay');
  if (!overlay) return;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  if (!_authToken) {
    _friendsMsg('LOGIN IS REQUIRED TO USE FRIENDS, INVITES, AND ONLINE STATUS.', 'err');
    renderFriendsUI();
    return;
  }
  _friendsMsg('Loading friends...', 'info');
  if (!socket || !socket.connected) {
    connectSocket(() => loadFriendsData());
  } else {
    loadFriendsData();
  }
}

function closeFriendsOverlay() {
  const overlay = document.getElementById('friendsOverlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

async function loadFriendsData() {
  if (!_authToken) {
    renderFriendsUI();
    return;
  }
  try {
    const res = await fetch('/api/friends', { headers: _authHeaders() });
    const data = await res.json();
    if (!data.ok) {
      _friendsMsg(data.reason || 'FAILED TO LOAD FRIENDS.', 'err');
      return;
    }
    _friendsState.friends = data.friends || [];
    _friendsState.incoming = data.incoming || [];
    _friendsState.outgoing = data.outgoing || [];
    _friendsState.invites = _friendsState.invites || [];
    renderFriendsUI();
    _friendsMsg(roomCode ? `Room ${roomCode} is ready for friend invites.` : 'Friends loaded.', 'ok');
  } catch {
    _friendsMsg('SERVER UNREACHABLE. COULD NOT LOAD FRIENDS.', 'err');
  }
}

function renderFriendsUI() {
  const friendsList = document.getElementById('friendsList');
  const incomingList = document.getElementById('friendsIncomingList');
  const outgoingList = document.getElementById('friendsOutgoingList');
  if (!friendsList || !incomingList || !outgoingList) return;
  if (!_authToken) {
    friendsList.innerHTML = '<div class="friend-card"><div class="friend-top">LOGIN NEEDED</div><div class="friend-status offline">Sign in to add friends, see who is online, and invite them straight into your lobby.</div></div>';
    incomingList.innerHTML = '';
    outgoingList.innerHTML = '';
    return;
  }

  friendsList.innerHTML = _friendsState.friends.length ? _friendsState.friends.map((f) => `
    <div class="friend-card">
      <div class="friend-top">
        <span>${escHtml(f.username)}</span>
        <span class="friend-status ${f.online ? 'online' : 'offline'}">${f.online ? 'ONLINE' : 'OFFLINE'}</span>
      </div>
      <div class="friend-actions">
        ${roomCode ? `<button class="friend-mini" onclick="inviteFriendToRoom('${escHtml(f.userId)}')">INVITE</button>` : ''}
      </div>
    </div>
  `).join('') : '<div class="friend-card"><div class="friend-top">NO FRIENDS YET</div><div class="friend-status offline">Send a request by username to build your friends list.</div></div>';

  const inviteCards = (_friendsState.invites || []).map((inv) => `
    <div class="friend-card">
      <div class="friend-top"><span>${escHtml(inv.fromUsername)} INVITED YOU</span><span class="friend-status online">${escHtml((inv.roomMode || 'coop').toUpperCase())}</span></div>
      <div class="friend-actions">
        <button class="friend-mini accept" onclick="acceptFriendInvite('${escHtml(inv.roomCode)}','${escHtml(inv.roomMode || 'coop')}')">JOIN ${escHtml(inv.roomCode)}</button>
      </div>
    </div>
  `).join('');

  incomingList.innerHTML = inviteCards + (_friendsState.incoming.length ? _friendsState.incoming.map((req) => `
    <div class="friend-card">
      <div class="friend-top"><span>${escHtml(req.fromUsername)}</span><span class="friend-status online">REQUEST</span></div>
      <div class="friend-actions">
        <button class="friend-mini accept" onclick="respondToFriendRequest('${escHtml(req.requestId)}', true)">ACCEPT</button>
        <button class="friend-mini reject" onclick="respondToFriendRequest('${escHtml(req.requestId)}', false)">REJECT</button>
      </div>
    </div>
  `).join('') : '<div class="friend-card"><div class="friend-top">NO REQUESTS</div></div>');

  outgoingList.innerHTML = _friendsState.outgoing.length ? _friendsState.outgoing.map((req) => `
    <div class="friend-card">
      <div class="friend-top"><span>TO ${escHtml(req.toUsername)}</span><span class="friend-status offline">PENDING</span></div>
    </div>
  `).join('') : '<div class="friend-card"><div class="friend-top">NO OUTGOING REQUESTS</div></div>';
}

async function sendFriendRequest() {
  if (!_authToken) {
    _friendsMsg('LOGIN IS REQUIRED TO ADD FRIENDS.', 'err');
    return;
  }
  const input = document.getElementById('friendUsernameInput');
  const username = (input?.value || '').trim();
  if (!username) {
    _friendsMsg('ENTER A USERNAME FIRST.', 'err');
    return;
  }
  _friendsMsg('Sending friend request...', 'info');
  try {
    const res = await fetch('/api/friends/request', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ username }),
    });
    const data = await res.json();
    if (!data.ok) {
      _friendsMsg(data.reason || 'FAILED TO SEND REQUEST.', 'err');
      return;
    }
    if (input) input.value = '';
    _friendsMsg(`Friend request sent to ${data.toUsername}.`, 'ok');
    loadFriendsData();
  } catch {
    _friendsMsg('SERVER UNREACHABLE. REQUEST NOT SENT.', 'err');
  }
}

async function respondToFriendRequest(requestId, accept) {
  if (!_authToken) return;
  _friendsMsg(accept ? 'Accepting request...' : 'Rejecting request...', 'info');
  try {
    const res = await fetch('/api/friends/respond', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ requestId, accept }),
    });
    const data = await res.json();
    if (!data.ok) {
      _friendsMsg(data.reason || 'FAILED TO UPDATE REQUEST.', 'err');
      return;
    }
    _friendsMsg(accept ? 'Friend added.' : 'Request rejected.', 'ok');
    loadFriendsData();
  } catch {
    _friendsMsg('SERVER UNREACHABLE. REQUEST NOT UPDATED.', 'err');
  }
}

async function inviteFriendToRoom(friendUserId) {
  if (!_authToken) {
    _friendsMsg('LOGIN IS REQUIRED TO INVITE FRIENDS.', 'err');
    return;
  }
  if (!roomCode) {
    _friendsMsg('CREATE OR JOIN A ROOM FIRST.', 'err');
    return;
  }
  try {
    const res = await fetch('/api/friends/invite', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ friendUserId, roomCode, roomMode: currentRoomMode }),
    });
    const data = await res.json();
    if (!data.ok) {
      _friendsMsg(data.reason || 'FAILED TO SEND INVITE.', 'err');
      return;
    }
    _friendsMsg(`Invite sent for room ${roomCode}.`, 'ok');
  } catch {
    _friendsMsg('SERVER UNREACHABLE. INVITE NOT SENT.', 'err');
  }
}

function acceptFriendInvite(code, mode) {
  closeFriendsOverlay();
  if (gameState === 'playing') leaveGame();
  else if (roomCode) leaveLobby();
  setTimeout(() => joinRoomByCode(code, mode || 'coop'), 120);
}

function handleFriendSocketRequest(payload) {
  _friendsMsg(`${payload.fromUsername} sent you a friend request.`, 'ok');
  loadFriendsData();
}

function handleFriendSocketResponse(payload) {
  _friendsMsg(payload.accepted ? `${payload.username} accepted your request.` : `${payload.username} rejected your request.`, payload.accepted ? 'ok' : 'info');
  loadFriendsData();
}

function handleFriendSocketInvite(payload) {
  _friendsState.invites = _friendsState.invites || [];
  _friendsState.invites = [
    payload,
    ..._friendsState.invites.filter((inv) => !(inv.roomCode === payload.roomCode && inv.fromUserId === payload.fromUserId))
  ].slice(0, 8);
  renderFriendsUI();
  _friendsMsg(`${payload.fromUsername} invited you to room ${payload.roomCode}.`, 'ok');
}

function handleFriendSocketPresence(payload) {
  _friendsState.friends = (_friendsState.friends || []).map((friend) =>
    String(friend.userId) === String(payload.userId) ? { ...friend, online: !!payload.online } : friend
  );
  renderFriendsUI();
}

function openFeedback() {
  const overlay = document.getElementById('feedbackOverlay');
  const guestInput = document.getElementById('feedbackGuestName');
  const authCard = document.getElementById('feedbackAuthCard');
  const authName = document.getElementById('feedbackAuthName');
  const authEmail = document.getElementById('feedbackAuthEmail');
  if (!overlay || !guestInput || !authCard || !authName || !authEmail) return;
  if (_authToken && _authUsername) {
    authCard.style.display = 'grid';
    authName.textContent = _authUsername;
    authEmail.textContent = _authEmail || 'ACCOUNT EMAIL UNAVAILABLE';
    guestInput.style.display = 'none';
    guestInput.value = '';
  } else {
    authCard.style.display = 'none';
    guestInput.style.display = 'block';
    guestInput.value = (playerName && playerName !== 'PLAYER') ? playerName : '';
  }
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  _feedbackMsg('Tell me what feels broken, unfair, fun, or missing.', 'info');
  setTimeout(() => {
    const focusTarget = (_authToken && _authUsername) ? document.getElementById('feedbackMessage') : guestInput;
    focusTarget?.focus();
  }, 0);
}

function closeFeedback() {
  const overlay = document.getElementById('feedbackOverlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

async function submitFeedback() {
  const guestInput = document.getElementById('feedbackGuestName');
  const messageEl = document.getElementById('feedbackMessage');
  const sendBtn = document.querySelector('#feedbackOverlay .btn');
  const message = (messageEl?.value || '').trim();
  const guestName = (guestInput?.value || '').trim();
  if (!message) {
    _feedbackMsg('WRITE YOUR FEEDBACK MESSAGE FIRST.', 'err');
    return;
  }
  if (!_authToken && !guestName) {
    _feedbackMsg('ENTER YOUR NAME SO I KNOW WHO SENT THIS.', 'err');
    return;
  }
  if (sendBtn) sendBtn.disabled = true;
  _feedbackMsg('SENDING FEEDBACK...', 'info');
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({
        message,
        name: _authToken ? undefined : guestName,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      _feedbackMsg(data.reason || 'FAILED TO SEND FEEDBACK.', 'err');
      return;
    }
    if (messageEl) messageEl.value = '';
    if (!_authToken && guestInput) guestInput.value = guestName;
    _feedbackMsg('THANK YOU. FEEDBACK SENT.', 'ok');
    setTimeout(closeFeedback, 900);
  } catch {
    _feedbackMsg('SERVER UNREACHABLE. FEEDBACK NOT SENT.', 'err');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SCORE SUBMISSION â€” called at level clear
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function submitLevelScore(levelId, deaths, timeSec) {
  if (!_authToken) return; // guests don't submit
  try {
    const res = await fetch('/api/scores', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ levelId, deaths, timeSec }),
    });
    const data = await res.json();
    if (data.ok && data.saved) {
      console.log(`[Score] Saved level ${levelId}: ${data.score} pts (improved by ${data.improved})`);
      // Invalidate leaderboard cache so next open shows fresh data
      _lbCurrentData = null;
    }
  } catch (e) { console.warn('[Score] Submit failed:', e.message); }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  LOGO TAGLINES â€” Minecraft-style rotating witty lines
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const LOGO_TAGLINES = [
  'NOT A TROLL GAME!!!',
  'THE FLOOR IS YOUR ENEMY.',
  'TRUST NOTHING.',
  '100% SKILL BASED!',
  'THE HOLE FOLLOWS YOU.',
  'SPIKE? WHAT SPIKE?',
  'DEFINITELY NOT A TRAP.',
  'SKILL ISSUE.',
  'RAGE-QUIT CERTIFIED.',
  'TOUCHING GRASS IS FORBIDDEN.',
  'THE DOOR LOVES YOU. THE FLOOR DOESN\'T.',
  'MORE DEATHS = MORE FUN!',
  'PLEASE DO NOT THROW YOUR PHONE.',
  'ACTUALLY A GREAT GAME!',
  'PRE-INSTALLED FRUSTRATION.',
  'THE CEILING MEANS WELL.',
  'JUMP. FALL. REPEAT.',
  'TROLL SIMULATOR 3000.',
  'YOUR FAULT, NOT OURS.',
  'BUT WAIT, THERE\'S MORE!',
  'FRIENDS DON\'T LET FRIENDS PLAY ALONE.',
  'WE\'RE SORRY. NO WE\'RE NOT.',
];

let _taglineInterval = null;
function startLogoTaglines() {
  const el = document.getElementById('logoTagline');
  if (!el) return;
  let idx = Math.floor(Math.random() * LOGO_TAGLINES.length);
  function rotate() {
    el.style.animation = 'none';
    el.offsetHeight; // reflow to restart animation
    el.style.animation = '';
    el.textContent = LOGO_TAGLINES[idx % LOGO_TAGLINES.length];
    idx++;
  }
  rotate();
  _taglineInterval = setInterval(rotate, 3500);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  LEADERBOARD
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let _lbCurrentData  = null;
let _lbLoading      = false;

function openLeaderboard() {
  const ov = document.getElementById('leaderboardOverlay');
  if (ov) ov.classList.add('open');
  _lbFetch();
}

function closeLeaderboard() {
  const ov = document.getElementById('leaderboardOverlay');
  if (ov) ov.classList.remove('open');
}

async function _lbFetch() {
  if (_lbLoading) return;
  _lbLoading = true;
  const body = document.getElementById('lbBody');
  if (body) body.innerHTML = '<div class="lb-loading">LOADING SCORES...</div>';

  try {
    const res  = await fetch('/api/leaderboard?limit=10');
    const data = await res.json();
    if (data.ok) {
      _renderLb(data.scores, body);
    } else {
      if (body) body.innerHTML = '<div class="lb-empty">DATABASE NOT CONNECTED.<br>SET MONGODB_URI ON SERVER.</div>';
    }
  } catch {
    if (body) body.innerHTML = '<div class="lb-empty">COULD NOT REACH SERVER.</div>';
  }
  _lbLoading = false;
}

function _renderLb(scores, body) {
  if (!body) return;
  if (!scores || scores.length === 0) {
    body.innerHTML = '<div class="lb-empty">NO SCORES YET.<br>BE THE FIRST TO FINISH A LEVEL!</div>';
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  let html = '';
  scores.forEach((s, i) => {
    const rank  = i + 1;
    const cls   = rank <= 3 ? `rank-${rank}` : '';
    const badge = rank <= 3 ? medals[rank - 1] : rank;
    // server returns: { username, score (total), deaths (total), levelsPlayed }
    html += `<div class="lb-row ${cls}">
      <div class="lb-rank">${badge}</div>
      <div class="lb-name">${escHtml(s.username)}</div>
      <div class="lb-score">${(s.totalScore || 0).toLocaleString()}</div>
      <div class="lb-deaths">${s.totalDeaths || 0}💀</div>
      <div class="lb-time">${s.levelsPlayed || 0} LVL</div>
    </div>`;
  });
  body.innerHTML = html;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function nsToggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
    if (req) req.call(el).catch(() => {});
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
    const btn = document.getElementById('nsFullscreenBtn');
    if (btn) btn.textContent = '✕';
    _dismissNsTooltip();
  } else {
    const ex = document.exitFullscreen || document.webkitExitFullscreen;
    if (ex) ex.call(document).catch(() => {});
    const btn = document.getElementById('nsFullscreenBtn');
    if (btn) btn.textContent = '⛶';
  }
}

function _dismissNsTooltip() {
  const tip = document.getElementById('nsTooltip');
  if (tip) {
    tip.style.transition = 'opacity 0.3s';
    tip.style.opacity = '0';
    setTimeout(() => { if (tip) tip.style.display = 'none'; }, 300);
  }
}

// Dismiss tooltip when user interacts with any auth input
document.addEventListener('DOMContentLoaded', () => {
  ['liUsername','liPassword','regUsername','regEmail','regPassword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('focus', _dismissNsTooltip); }
  });
  // Auto-dismiss after 6 seconds
  setTimeout(_dismissNsTooltip, 6000);
});

function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement &&
      !document.webkitFullscreenElement &&
      !document.mozFullScreenElement) {
    // Enter fullscreen
    const req = el.requestFullscreen       ||
                el.webkitRequestFullscreen ||
                el.mozRequestFullScreen;
    if (req) {
      req.call(el).catch(() => {});
      // Also lock orientation to landscape on mobile
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    }
    document.getElementById('btnFullscreen').textContent = '✕';
  } else {
    // Exit fullscreen
    const ex = document.exitFullscreen       ||
               document.webkitExitFullscreen ||
               document.mozCancelFullScreen;
    if (ex) ex.call(document).catch(() => {});
    document.getElementById('btnFullscreen').textContent = '⛶';
  }
  // Resize after orientation settles
  setTimeout(resize, 300);
}

// Auto-resize when fullscreen changes
document.addEventListener('fullscreenchange',       resize);
document.addEventListener('webkitfullscreenchange', resize);
document.addEventListener('mozfullscreenchange',    resize);

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/* ===== src/gameplay/start-and-loop.js ===== */
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

/* ===== src/gameplay/update-core.js ===== */
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

/* ===== src/traps/update.js ===== */
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

/* ===== src/gameplay/player-and-collisions.js ===== */
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

/* ===== src/gameplay/progression.js ===== */
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
    el.textContent = `🚪 WAITING FOR ${waiting} PLAYER${waiting > 1 ? 'S' : ''}...`;
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
      document.getElementById('levelStats').innerHTML += '<br><br><span style="color:#ffcc00">⏳ WAITING FOR HOST TO ADVANCE...</span>';
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

/* ===== src/render/core.js ===== */
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

/* ===== src/traps/render.js ===== */
function drawTraps() {
  traps.forEach(t => {
    if (t.state === 'gone') return;

    switch (t.type) {
      case 'spike_up':
        drawSpike(t.x, t.y, t.w, t.h, false);
        break;
      case 'spike_down':
        drawSpike(t.x, t.y, t.w, t.h, true);
        break;
      case 'spike_moving_h':
        drawSpike(t.x, t.y, t.w, t.h, false);
        break;
      case 'spike_moving_v':
        drawSpike(t.x, t.y, t.w, t.h, false);
        break;

      case 'floor_hole':
        if (t.state === 'open' || (t._openProgress || 0) > 0) {
          const progress = t._openProgress ?? 0;
          const slabDrop = t._slabDrop ?? 0;
          const rimH = Math.max(5, Math.round((t.h || 64) * 0.18));
          const innerPad = 4 + (1 - progress) * 6;
          const pitX = t.x + innerPad;
          const pitY = t.y + rimH * 0.35;
          const pitW = Math.max(0, t.w - innerPad * 2);
          const pitH = Math.max(0, t.h - rimH * 0.55);

          if (pitW > 0 && pitH > 0) {
            ctx.clearRect(pitX, pitY, pitW, pitH);
            ctx.fillStyle = 'rgba(90, 60, 20, 0.12)';
            ctx.fillRect(pitX, pitY, pitW, 3);
          }

          // Broken floor rim
          ctx.fillStyle = '#7b652f';
          ctx.fillRect(t.x, t.y, t.w, rimH);
          ctx.fillStyle = '#5d4a22';
          ctx.fillRect(t.x, t.y + rimH - 2, t.w, 4);
          ctx.fillStyle = '#a88a43';
          for (let xi = t.x + 8; xi < t.x + t.w - 4; xi += 14) {
            const bite = 2 + Math.floor(((xi - t.x) / 14) % 3);
            ctx.fillRect(xi, t.y + rimH - 1, 8, bite);
          }

          // Falling slab animation
          if (progress < 1 || slabDrop > 0) {
            const slabInset = 2 + progress * 6;
            const slabX = t.x + slabInset;
            const slabY = t.y + slabDrop;
            const slabW = Math.max(0, t.w - slabInset * 2);
            const slabH = Math.max(8, (t._origH || t.h) - 6);
            const slabAlpha = Math.max(0, 1 - progress * 0.9);

            ctx.save();
            ctx.globalAlpha = slabAlpha;
            ctx.fillStyle = '#b99133';
            ctx.fillRect(slabX, slabY, slabW, slabH);
            ctx.fillStyle = '#f0cf63';
            ctx.fillRect(slabX, slabY, slabW, Math.min(8, slabH * 0.3));
            ctx.fillStyle = '#8a651c';
            ctx.fillRect(slabX, slabY + slabH - 6, slabW, 6);
            ctx.strokeStyle = 'rgba(70,40,10,0.45)';
            ctx.lineWidth = 2;
            ctx.strokeRect(slabX, slabY, slabW, slabH);
            ctx.restore();
          }
        }
        break;

      case 'smart_hole': {
        if (t.invisible) break; // truly invisible â€” no draw at all

        const isOpen = t.state === 'open';
        if (!isOpen) break;

        if (t.fake) {
          // Fake hole â€” looks like a hole but lighter, slightly translucent
          ctx.fillStyle   = 'rgba(0,0,0,0.35)';
          ctx.fillRect(t.x, t.y, t.w, t.h);
          ctx.strokeStyle = 'rgba(255,100,0,0.4)';
          ctx.lineWidth   = 1;
          ctx.setLineDash([4,4]);
          ctx.strokeRect(t.x, t.y, t.w, t.h);
          ctx.setLineDash([]);
        } else {
          // Real smart hole â€” deep black with animated pulsing edge
          const pulse = 0.6 + 0.4 * Math.sin(Date.now() * 0.006);
          ctx.fillStyle = '#000';
          ctx.fillRect(t.x, t.y, t.w, t.h);
          // Animated void shimmer inside
          ctx.fillStyle = `rgba(80,0,0,${0.2 + pulse * 0.1})`;
          ctx.fillRect(t.x + 4, t.y + 4, t.w - 8, t.h - 8);
          ctx.shadowColor = `rgba(255,60,0,${pulse})`;
          ctx.shadowBlur  = 16;
          ctx.strokeStyle = `rgba(255,80,0,${pulse})`;
          ctx.lineWidth   = 2;
          ctx.strokeRect(t.x, t.y, t.w, t.h);
          ctx.shadowBlur  = 0;
          // Chase indicator arrow
          if (t.chase) {
            ctx.fillStyle = `rgba(255,150,50,${0.5 + pulse * 0.3})`;
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('▼', t.x + t.w/2, t.y - 4);
            ctx.textAlign = 'left';
          }
        }
        break;
      }

      case 'chasing_spike': {
        // Spike with motion trail
        const trailLen = 3;
        const vDir = (player.x + PLAYER_W/2) > (t.x + (t.w||32)/2) ? 1 : -1;
        for (let i = trailLen; i > 0; i--) {
          ctx.globalAlpha = 0.15 * (trailLen - i + 1) / trailLen;
          drawSpike(t.x - vDir * i * 6, t.y, t.w||32, t.h||32, false);
        }
        ctx.globalAlpha = 1;
        // Main spike with red glow
        ctx.shadowColor = '#ff2222';
        ctx.shadowBlur  = 8;
        drawSpike(t.x, t.y, t.w||32, t.h||32, false);
        ctx.shadowBlur  = 0;
        break;
      }

      case 'pillar': {
        if (t._curH <= 0) break;
        const px = t.x, py = t.y, pw = t.w, ph = t.h;

        if (t.fake) {
          // Fake pillar â€” drawn translucent, doesn't actually push
          ctx.globalAlpha = 0.35;
        }

        // Pillar body â€” brick style matching Level Devil palette
        const brickH2 = 24;
        for (let by = py; by < py + ph; by += brickH2) {
          const bh = Math.min(brickH2, py + ph - by);
          ctx.fillStyle = (Math.floor((by - py) / brickH2) % 2 === 0) ? '#c87010' : '#b05808';
          ctx.fillRect(px + 1, by + 1, pw - 2, bh - 2);
        }
        // Top cap â€” lighter
        ctx.fillStyle = '#f0a030';
        ctx.fillRect(px, py, pw, 6);
        // Outline
        ctx.strokeStyle = t._phase === 'rising' || t._phase === 'extended' ? '#ffaa00' : '#884400';
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, pw, ph);
        // Top spike row â€” danger indicator
        if (!t.fake && (t._phase === 'extended' || t._phase === 'rising')) {
          ctx.shadowColor = '#ff6600';
          ctx.shadowBlur  = 6;
          drawSpike(px, py - 14, pw, 14, false);
          ctx.shadowBlur  = 0;
        }
        ctx.globalAlpha = 1;
        break;
      }

      case 'slant': {
        if (!t._angle && t._angle !== 0) break;
        const sx = t.x, sy = t.y;
        const sw2 = t.w || 200, sh2 = t.h || 24;
        const ang  = t._angle || 0;

        ctx.save();
        ctx.translate(sx + sw2/2, sy + sh2/2);
        ctx.rotate(ang);

        // Slant platform â€” same style as normal platforms
        ctx.fillStyle = '#d4a520';
        ctx.fillRect(-sw2/2, -sh2/2, sw2, sh2);
        // Top highlight
        ctx.fillStyle = '#f5c842';
        ctx.fillRect(-sw2/2, -sh2/2, sw2, Math.min(6, sh2/3));
        // Shadow edge
        ctx.strokeStyle = '#a07010';
        ctx.lineWidth = 2;
        ctx.strokeRect(-sw2/2, -sh2/2, sw2, sh2);
        // Angle indicator arrows
        if (Math.abs(ang) > 0.05) {
          ctx.fillStyle = 'rgba(255,200,0,0.7)';
          ctx.font = '11px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(ang > 0 ? '→' : '←', 0, sh2/2 + 14);
          ctx.textAlign = 'left';
        }
        ctx.restore();
        break;
      }

      case 'ceiling_spike':
        if (t.state !== 'gone') {
          drawSpike(t.x, t.y, t.w, t.h, true);
        }
        break;

      case 'spike_wheel':
        drawSpikeWheel(t);
        break;

      case 'wall_moving':
        ctx.fillStyle = '#2a1a1a';
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.strokeStyle = '#ff4400';
        ctx.lineWidth = 2;
        ctx.strokeRect(t.x, t.y, t.w, t.h);
        for (let sy = t.y; sy < t.y + t.h - 20; sy += 28) {
          drawSpike(t.x - 16, sy, 16, 16, false, true);
        }
        break;

      // â”€â”€ PHASE 2 TRAPS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

      case 'saw_blade':
        drawSawBlade(t);
        break;

      case 'lava_pool':
        drawLavaPool(t);
        break;

      case 'laser':
        drawLaser(t);
        break;

      case 'piston':
        drawPiston(t);
        break;

      case 'boulder':
        drawBoulder(t);
        break;

      case 'ice_floor':
        ctx.fillStyle = '#aaddff';
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.strokeStyle = '#88ccff';
        ctx.lineWidth = 2;
        ctx.strokeRect(t.x, t.y, t.w, t.h);
        // Shine
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(t.x + 4, t.y + 4, t.w - 8, 4);
        break;

      case 'conveyor': {
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.strokeStyle = '#ff8800';
        ctx.lineWidth = 2;
        ctx.strokeRect(t.x, t.y, t.w, t.h);
        // Moving arrows
        const ao = t.animOffset || 0;
        ctx.fillStyle = '#ff8800';
        const arrowDir = t.speed > 0 ? 1 : -1;
        for (let ax = t.x + (ao % 32); ax < t.x + t.w; ax += 32) {
          ctx.beginPath();
          if (arrowDir > 0) {
            ctx.moveTo(ax, t.y + 4);
            ctx.lineTo(ax + 12, t.y + t.h/2);
            ctx.lineTo(ax, t.y + t.h - 4);
          } else {
            ctx.moveTo(ax + 12, t.y + 4);
            ctx.lineTo(ax, t.y + t.h/2);
            ctx.lineTo(ax + 12, t.y + t.h - 4);
          }
          ctx.closePath();
          ctx.fill();
        }
        break;
      }

      case 'acid_drip':
        // Ceiling source
        ctx.fillStyle = '#00aa22';
        ctx.fillRect(t.x, t.y, t.w, t.h);
        // Drops
        if (t.drops) {
          t.drops.forEach(d => {
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
            ctx.fillStyle = '#00ff44';
            ctx.shadowColor = '#00ff44';
            ctx.shadowBlur = 8;
            ctx.fill();
            ctx.shadowBlur = 0;
          });
        }
        break;

      case 'fake_wall': {
        // Semi-transparent wall that looks solid but isn't
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#2a2a3a';
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.strokeStyle = '#4a4a6a';
        ctx.lineWidth = 2;
        ctx.strokeRect(t.x+1, t.y+1, t.w-2, t.h-2);
        ctx.globalAlpha = 1;
        // "?" indicator
        ctx.fillStyle = '#ffffff33';
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('?', t.x + t.w/2, t.y + t.h/2 + 5);
        break;
      }

      case 'fake_floor':
        if (t.state === 'solid' || t.state === 'crumbling') {
          const alpha = t.state === 'crumbling' ? 0.4 : 0.7;
          ctx.globalAlpha = alpha;
          ctx.fillStyle = '#2a2a3a';
          ctx.fillRect(t.x, t.y, t.w, t.h);
          ctx.strokeStyle = t.state === 'crumbling' ? '#ff6622' : '#4a4a6a';
          ctx.lineWidth = 2;
          ctx.strokeRect(t.x+1, t.y+1, t.w-2, t.h-2);
          ctx.globalAlpha = 1;
        }
        break;

      case 'electro_fence': {
        if (!t.on) {
          ctx.strokeStyle = '#334';
          ctx.lineWidth = 3;
          ctx.setLineDash([8,8]);
          ctx.beginPath();
          ctx.moveTo(t.x + t.w/2, t.y);
          ctx.lineTo(t.x + t.w/2, t.y + t.h);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        // ON â€” glowing electric fence
        const ao2 = t.animOffset || 0;
        ctx.strokeStyle = '#ffff00';
        ctx.shadowColor = '#ffff00';
        ctx.shadowBlur = 16;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(t.x + t.w/2, t.y);
        for (let ey = t.y; ey < t.y + t.h; ey += 8) {
          const jitter = Math.sin(ao2 + ey * 0.2) * 6;
          ctx.lineTo(t.x + t.w/2 + jitter, ey + 8);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Posts
        ctx.fillStyle = '#888';
        ctx.fillRect(t.x, t.y, t.w, 8);
        ctx.fillRect(t.x, t.y + t.h - 8, t.w, 8);
        break;
      }

      case 'bounce_pad': {
        const compress = t.visualCompress || 0;
        const bh = t.h * (1 - compress * 0.4);
        ctx.fillStyle = '#00ffaa';
        ctx.shadowColor = '#00ffaa';
        ctx.shadowBlur = 12;
        ctx.fillRect(t.x, t.y + (t.h - bh), t.w, bh);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#00cc88';
        ctx.lineWidth = 2;
        ctx.strokeRect(t.x, t.y + (t.h - bh), t.w, bh);
        ctx.fillStyle = '#000';
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('▲', t.x + t.w/2, t.y + bh/2 + 6);
        break;
      }

      // â”€â”€ NEW PHASE 3 DRAW â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

      case 'delayed_spike': {
        if (t.hidden) {
          // Completely invisible â€” no hints shown to player
          // (ctx.globalAlpha stays at 1, nothing drawn)
        } else {
          const sc = t._scale || 0;
          ctx.save();
          ctx.translate(t.x + (t.w||32)/2, t.y + (t.h||32)/2);
          ctx.scale(sc, sc);
          drawSpike(-(t.w||32)/2, -(t.h||32)/2, t.w||32, t.h||32, false);
          ctx.restore();
        }
        break;
      }

      case 'gravity_spike':
        if (t.state !== 'gone') {
          drawSpike(t.x, t.y, t.w||32, t.h||32, true);
          if (t.state === 'waiting') {
            // Warning indicator
            ctx.fillStyle = '#ff4400';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('▼', t.x + (t.w||32)/2, t.y - 4);
          }
        }
        break;

      case 'magnetic_spike': {
        ctx.save();
        ctx.translate(t.x + (t.w||32)/2, t.y + (t.h||32)/2);
        ctx.rotate(t.angle || 0);
        ctx.shadowColor = '#ff2222';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#cc2222';
        ctx.fillRect(-(t.w||32)/2, -(t.h||32)/2, t.w||32, t.h||32);
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 2;
        ctx.strokeRect(-(t.w||32)/2, -(t.h||32)/2, t.w||32, t.h||32);
        ctx.shadowBlur = 0;
        ctx.restore();
        // Target line to player
        ctx.strokeStyle = 'rgba(255,34,34,0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4,4]);
        ctx.beginPath();
        ctx.moveTo(t.x + (t.w||32)/2, t.y + (t.h||32)/2);
        ctx.lineTo(player.x + PLAYER_W/2, player.y + PLAYER_H/2);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }

      case 'boomerang_arrow': {
        ctx.save();
        ctx.translate(t.x + (t.w||24)/2, t.y + (t.h||12)/2);
        if (t.dir < 0) ctx.scale(-1,1);
        ctx.fillStyle = t.state === 'returning' ? '#ff4400' : '#cc8800';
        ctx.shadowColor = t.state === 'returning' ? '#ff4400' : '#cc8800';
        ctx.shadowBlur = 8;
        // Arrow shape
        ctx.beginPath();
        ctx.moveTo(-(t.w||24)/2, -(t.h||12)/2);
        ctx.lineTo((t.w||24)/2, 0);
        ctx.lineTo(-(t.w||24)/2, (t.h||12)/2);
        ctx.lineTo(-(t.w||24)/4, 0);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
        // Trail
        ctx.strokeStyle = t.state === 'returning' ? 'rgba(255,68,0,0.3)' : 'rgba(200,136,0,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y + (t.h||12)/2);
        ctx.lineTo(t.x - (t.dir||1)*30, t.y + (t.h||12)/2);
        ctx.stroke();
        break;
      }

      case 'expanding_spike': {
        const sc = t._scale || 1;
        const ew = (t.w||16) * sc;
        const eh = (t.h||16) * sc;
        const ex = t.x - (ew - (t.w||16))/2;
        const ey = t.y - (eh - (t.h||16))/2;
        ctx.shadowColor = sc > 2 ? '#ff0000' : '#cc2222';
        ctx.shadowBlur = sc > 2 ? 20 : 6;
        drawSpike(ex, ey, ew, eh, false);
        ctx.shadowBlur = 0;
        if (sc > 1.5) {
          ctx.fillStyle = `rgba(255,0,0,${(sc-1)/3*0.3})`;
          ctx.fillRect(ex-4, ey-4, ew+8, eh+8);
        }
        break;
      }

      case 'input_inversion_zone': {
        // Subtle zone indicator
        ctx.fillStyle = 'rgba(200,0,200,0.06)';
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.strokeStyle = 'rgba(200,0,200,0.25)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8,8]);
        ctx.strokeRect(t.x, t.y, t.w, t.h);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(200,0,200,0.5)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('↔ CONTROLS FLIPPED', t.x + t.w/2, t.y + 20);
        break;
      }

      case 'leap_of_faith_platform': {
        // Draw as moving platform with warning
        ctx.fillStyle = '#2a1a3a';
        ctx.strokeStyle = '#aa44aa';
        ctx.lineWidth = 2;
        ctx.fillRect(t.x, t.y, t.w||120, t.h||32);
        ctx.strokeRect(t.x, t.y, t.w||120, t.h||32);
        ctx.fillStyle = '#aa44aa44';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('→', t.x + (t.w||120)/2, t.y + (t.h||32)/2 + 4);
        break;
      }

      case 'shrinking_wall': {
        if (!t._origH) break;
        const alpha = Math.max(0.1, t.h / t._origH);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#3a1a1a';
        ctx.strokeStyle = '#ff2222';
        ctx.lineWidth = 2;
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.strokeRect(t.x, t.y, t.w, t.h);
        // Warning cracks
        ctx.strokeStyle = '#ff6622';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(t.x + t.w*0.3, t.y);
        ctx.lineTo(t.x + t.w*0.5, t.y + t.h);
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }

      case 'sike_goal':
      case 'fake_exit': {
        // Draw fake door at its own tracked position (never real door coords)
        const fx = t._fakeX !== undefined ? t._fakeX : t.x;
        const fy = t._fakeY !== undefined ? t._fakeY : t.y;
        ctx.fillStyle = '#1a3a1a';
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 3;
        ctx.fillRect(fx, fy, TILE, TILE*2);
        ctx.shadowColor = '#00ff88';
        ctx.shadowBlur = 16;
        ctx.strokeRect(fx, fy, TILE, TILE*2);
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(fx + TILE - 8, fy + TILE, 4, 0, Math.PI*2);
        ctx.fillStyle = '#00ff88';
        ctx.fill();
        break;
      }

      case 'fake_loading_screen':
        // Visual handled by HTML overlay
        break;

      case 'expanding_hole': {
        // Draw void hole with pulsing edge
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.005);
        ctx.fillStyle = '#000';
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.shadowColor = `rgba(255,${Math.floor(pulse*100)},0,1)`;
        ctx.shadowBlur  = 16;
        ctx.strokeStyle = `rgba(255,${Math.floor(pulse*100)},0,1)`;
        ctx.lineWidth   = 3;
        ctx.strokeRect(t.x, t.y, t.w, t.h);
        ctx.shadowBlur  = 0;
        // "FLOOR EXPANDING" warning text
        if (t._phase === 'expanding') {
          ctx.fillStyle = 'rgba(255,60,0,0.7)';
          ctx.font = '9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('⚠', t.x + t.w/2, t.y - 6);
          ctx.textAlign = 'left';
        }
        break;
      }

      case 'jumpscare_spike_platform': {
        // Draw platform
        ctx.fillStyle = t.spikesActive ? '#2a0a0a' : '#2a2a3a';
        ctx.strokeStyle = t.spikesActive ? '#ff2222' : '#4a4a6a';
        ctx.lineWidth = 2;
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.strokeRect(t.x, t.y, t.w, t.h);
        // Draw spikes on top if active
        if (t.spikesActive) {
          ctx.shadowColor = '#ff2222';
          ctx.shadowBlur  = 8;
          drawSpike(t.x, t.y - 18, t.w, 18, false);
          ctx.shadowBlur  = 0;
        } else {
          // Looks totally normal â€” top highlight
          ctx.fillStyle = 'rgba(255,255,255,0.06)';
          ctx.fillRect(t.x + 2, t.y + 2, t.w - 4, 3);
        }
        break;
      }

      case 'ceiling_crusher': {
        const isActive = t._phase === 'dropping' || t._phase === 'resting';
        ctx.fillStyle = isActive ? '#3a0a0a' : '#2a1a2a';
        ctx.strokeStyle = isActive ? '#ff2222' : '#882288';
        ctx.lineWidth = 3;
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.strokeRect(t.x, t.y, t.w, t.h);
        drawSpike(t.x, t.y + t.h - 2, t.w, 18, false);
        if (t.safeNotchX !== undefined) {
          ctx.fillStyle = 'rgba(0,255,136,0.15)';
          ctx.fillRect(t.safeNotchX, t.y, t.safeNotchW || 40, t.h);
          ctx.strokeStyle = 'rgba(0,255,136,0.4)';
          ctx.lineWidth = 1;
          ctx.strokeRect(t.safeNotchX, t.y, t.safeNotchW || 40, t.h);
        }
        if (t._phase === 'idle') {
          ctx.fillStyle = 'rgba(255,100,0,0.6)';
          ctx.font = '14px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('▼', t.x + t.w/2, t.y + t.h + 18);
          ctx.textAlign = 'left';
        }
        break;
      }

      case 'whole_ceiling': {
        // The entire ceiling slab descending â€” drawn brick by brick for visual effect
        const phase = t._phase || 'idle';
        const slab_x = t.x, slab_y = t.y;
        const slab_w = t.w, slab_h = t.h;

        // Main slab â€” Level Devil brick style
        const brickW = 64, brickH = Math.min(32, slab_h);
        for (let bx = slab_x; bx < slab_x + slab_w; bx += brickW) {
          const bw = Math.min(brickW, slab_x + slab_w - bx);
          const row = Math.floor((bx - slab_x) / brickW);
          // Alternating brick offset every other row
          const yOff = (row % 2) * (brickH / 2);

          // Brick body
          ctx.fillStyle = phase === 'dropping' ? '#6a3010' :
                          phase === 'warning'  ? '#8a4010' : '#5a2808';
          ctx.fillRect(bx + 1, slab_y + 1, bw - 2, slab_h - 2);

          // Brick mortar lines
          ctx.strokeStyle = phase === 'dropping' ? '#3a1a04' : '#2a0e02';
          ctx.lineWidth = 2;
          // Horizontal mortar
          for (let my = slab_y + brickH; my < slab_y + slab_h; my += brickH) {
            ctx.beginPath();
            ctx.moveTo(bx, my); ctx.lineTo(bx + bw, my);
            ctx.stroke();
          }
          // Vertical mortar (staggered)
          for (let vx = bx + brickW/2; vx < bx + bw; vx += brickW) {
            ctx.beginPath();
            ctx.moveTo(vx, slab_y); ctx.lineTo(vx, slab_y + slab_h);
            ctx.stroke();
          }
        }

        // Outer border
        ctx.strokeStyle = phase === 'dropping' ? '#ff6622' :
                          phase === 'warning'  ? '#ff8844' :
                          phase === 'crushed'  ? '#ff2222' : '#c87020';
        ctx.lineWidth = 3;
        ctx.strokeRect(slab_x, slab_y, slab_w, slab_h);

        // Bottom spikes â€” spikes point down toward player
        ctx.shadowColor = '#ff2222';
        ctx.shadowBlur  = phase === 'dropping' ? 10 : 4;
        drawSpike(slab_x, slab_y + slab_h - 2, slab_w, 20, false);
        ctx.shadowBlur = 0;

        // Warning state â€” pulsing red glow and warning text
        if (phase === 'warning') {
          const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.01);
          ctx.fillStyle = `rgba(255,80,0,${0.15 + pulse * 0.2})`;
          ctx.fillRect(slab_x, slab_y, slab_w, slab_h);
          ctx.fillStyle = `rgba(255,150,50,${0.7 + pulse * 0.3})`;
          ctx.font = 'bold 14px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('⚠ CEILING DROPPING ⚠', slab_x + slab_w/2, slab_y + slab_h + 24);
          ctx.textAlign = 'left';
        }

        // Speed/progress indicator â€” gap between ceiling bottom and floor
        if (phase === 'dropping') {
          const floorY  = t.floorY || 416;
          const totalGap = floorY - t._origY - slab_h;
          const curGap   = floorY - slab_y - slab_h;
          const pct = Math.max(0, curGap / totalGap);
          // Danger bar â€” red progress bar at top of screen
          const barH = 6;
          ctx.fillStyle = '#330000';
          ctx.fillRect(slab_x, slab_y - barH - 4, slab_w, barH);
          ctx.fillStyle = pct > 0.5 ? '#00ff44' : pct > 0.25 ? '#ffaa00' : '#ff2222';
          ctx.fillRect(slab_x, slab_y - barH - 4, slab_w * pct, barH);
          ctx.strokeStyle = '#555';
          ctx.lineWidth = 1;
          ctx.strokeRect(slab_x, slab_y - barH - 4, slab_w, barH);
        }
        break;
      }

      case 'shrinking_gap_platform': {
        const origX = t._origX ?? t.x;
        const gapX = Math.min(origX, t.x);
        const gapW = Math.abs(t.x - origX);

        if (gapW > 1) {
          // Carve out the opened floor gap so it blends into the platform
          ctx.clearRect(gapX, t.y, gapW, t.h);
          ctx.fillStyle = 'rgba(90, 60, 20, 0.10)';
          ctx.fillRect(gapX, t.y, gapW, 3);
          ctx.fillStyle = '#6f5a29';
          for (let xi = gapX + 6; xi < gapX + gapW - 4; xi += 14) {
            const bite = 2 + Math.floor(((xi - gapX) / 14) % 3);
            ctx.fillRect(xi, t.y, 8, bite);
          }
        }

        // Moving slab styled to match the normal floor platform
        ctx.fillStyle = '#8a651c';
        ctx.fillRect(t.x, t.y + 4, t.w, t.h - 4);
        ctx.fillStyle = '#b99133';
        ctx.fillRect(t.x, t.y + 2, t.w, t.h - 6);
        ctx.fillStyle = '#f0cf63';
        ctx.fillRect(t.x, t.y, t.w, Math.min(8, t.h * 0.35));
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.beginPath(); ctx.moveTo(t.x, t.y + t.h); ctx.lineTo(t.x, t.y); ctx.lineTo(t.x + t.w, t.y); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath(); ctx.moveTo(t.x + t.w, t.y); ctx.lineTo(t.x + t.w, t.y + t.h); ctx.lineTo(t.x, t.y + t.h); ctx.stroke();
        ctx.strokeStyle = '#d3a13d';
        ctx.lineWidth = 1;
        ctx.strokeRect(t.x, t.y, t.w, t.h);

        if (t.w > 64) {
          ctx.fillStyle = 'rgba(0,0,0,0.08)';
          for (let xi = t.x + 16; xi < t.x + t.w - 8; xi += 32) {
            ctx.fillRect(xi, t.y + 2, 4, 3);
          }
        }
        break;
      }

      // â•â•â•â• COOPERATIVE TRAP DRAW â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

      case 'pressure_button': {
        const pressed = !!t._pressed;
        const btnH = pressed ? 8 : 16;
        const btnY = t.y + (t.h - btnH);
        // Base plate
        ctx.fillStyle = '#333';
        ctx.fillRect(t.x, t.y + t.h - 6, t.w, 6);
        // Button cap
        ctx.fillStyle = pressed ? '#00ff88' : '#ff4400';
        ctx.shadowColor = pressed ? '#00ff88' : '#ff4400';
        ctx.shadowBlur  = pressed ? 12 : 4;
        ctx.fillRect(t.x + 4, btnY, t.w - 8, btnH);
        ctx.shadowBlur = 0;
        // Who is pressing
        if (t._pressedBy && t._pressedBy.size > 0) {
          ctx.fillStyle = '#00ff88';
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('✓', t.x + t.w/2, t.y - 4);
          ctx.textAlign = 'left';
        }
        // Group label
        if (t.group) {
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.font = '7px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(t.group, t.x + t.w/2, t.y + t.h/2 + 3);
          ctx.textAlign = 'left';
        }
        break;
      }

      case 'buddy_door': {
        const open = !!t._open;
        ctx.fillStyle = open ? '#1a3a1a' : '#3a1a1a';
        ctx.strokeStyle = open ? '#00ff88' : '#ff8800';
        ctx.lineWidth = 3;
        ctx.fillRect(t.x, t.y, t.w || TILE, t.h || TILE*2);
        ctx.shadowColor = open ? '#00ff88' : '#ff8800';
        ctx.shadowBlur  = 12;
        ctx.strokeRect(t.x, t.y, t.w || TILE, t.h || TILE*2);
        ctx.shadowBlur  = 0;
        if (!open) {
          ctx.fillStyle = '#ff8800';
          ctx.font = '14px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('🔒', t.x + (t.w||TILE)/2, t.y + (t.h||TILE*2)/2 + 6);
          ctx.textAlign = 'left';
        }
        break;
      }

      case 'buddy_floor': {
        if (t._phase === 'gone') break;
        const ratio = t._phase === 'collapse_pending' && t._timer
          ? t._timer / (t.collapseDelay || 120) : 1;
        ctx.fillStyle = t._phase === 'spiked' ? '#3a0000' :
                        t._phase === 'collapse_pending' ? `rgba(42,42,58,${ratio})` : '#2a2a3a';
        ctx.strokeStyle = t._phase === 'spiked' ? '#ff2222' :
                          t._phase === 'collapse_pending' ? '#ff6600' : '#4a4a6a';
        ctx.lineWidth = 2;
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.strokeRect(t.x, t.y, t.w, t.h);
        if (t._phase === 'spiked') {
          drawSpike(t.x, t.y - 18, t.w, 18, false);
        } else if (t._phase === 'collapse_pending') {
          // Countdown crack effect
          const cracks = Math.floor((1 - ratio) * 5);
          ctx.strokeStyle = '#ff6600';
          ctx.lineWidth = 1;
          for (let c = 0; c < cracks; c++) {
            ctx.beginPath();
            ctx.moveTo(t.x + t.w * (0.2 + c * 0.15), t.y);
            ctx.lineTo(t.x + t.w * (0.3 + c * 0.15), t.y + t.h);
            ctx.stroke();
          }
          // Timer bar above
          ctx.fillStyle = `rgba(255,${Math.floor(ratio*200)},0,0.8)`;
          ctx.fillRect(t.x, t.y - 6, t.w * ratio, 4);
        }
        break;
      }

      case 'seesaw': {
        if (!t._origCX) break;
        const angle = t._angle || 0;
        const hw = t.w / 2;
        ctx.save();
        ctx.translate(t._origCX, t._origCY);
        ctx.rotate(angle);

        if (t._phase !== 'broken') {
          // Draw full seesaw beam
          ctx.fillStyle = '#4a3a2a';
          ctx.strokeStyle = '#aa8844';
          ctx.lineWidth = 3;
          ctx.fillRect(-hw, -8, t.w, 16);
          ctx.strokeRect(-hw, -8, t.w, 16);
          // Center pivot
          ctx.beginPath();
          ctx.arc(0, 0, 10, 0, Math.PI * 2);
          ctx.fillStyle = '#888';
          ctx.fill();
          ctx.strokeStyle = '#aaa';
          ctx.stroke();
        } else {
          // Draw broken halves separately
          const rf = t._rightFly || 0;
          const ld = t._leftDrop || 0;
          // Left half
          ctx.save();
          ctx.translate(0, ld * 3);
          ctx.fillStyle = '#3a2a1a';
          ctx.strokeStyle = '#884422';
          ctx.fillRect(-hw, -8, hw, 16);
          ctx.strokeRect(-hw, -8, hw, 16);
          ctx.restore();
          // Right half (flying up)
          ctx.save();
          ctx.translate(0, rf * 3);
          ctx.rotate(0.3);
          ctx.fillStyle = '#3a2a1a';
          ctx.strokeStyle = '#884422';
          ctx.fillRect(0, -8, hw, 16);
          ctx.strokeRect(0, -8, hw, 16);
          ctx.restore();

          // Emergency ledges appear
          if (t._ledgesVisible) {
            ctx.restore(); // back to world space
            ctx.fillStyle = '#2a4a2a';
            ctx.strokeStyle = '#00ff88';
            ctx.lineWidth = 2;
            // Left wall ledge
            ctx.fillRect(t.x - 80, t._origCY - 60, 60, 12);
            ctx.strokeRect(t.x - 80, t._origCY - 60, 60, 12);
            // Right wall ledge
            ctx.fillRect(t.x + t.w + 20, t._origCY - 60, 60, 12);
            ctx.strokeRect(t.x + t.w + 20, t._origCY - 60, 60, 12);
            return; // already restored
          }
        }
        ctx.restore();
        break;
      }

      case 'split_wall': {
        const alpha = t._phase === 'waiting' ? 0.25 : 0.9;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#1a0a1a';
        ctx.strokeStyle = t._phase === 'moving' ? '#ff44ff' : '#882288';
        ctx.lineWidth = 3;
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.strokeRect(t.x, t.y, t.w, t.h);
        ctx.globalAlpha = 1;
        // Moving indicator
        if (t._phase === 'waiting') {
          ctx.fillStyle = 'rgba(255,68,255,0.3)';
          ctx.font = '9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('◀', t.x + t.w/2, t.y + t.h/2 + 4);
          ctx.textAlign = 'left';
        }
        break;
      }

      case 'void_portal': {
        const a = t._animAngle || 0;
        const cx2 = t.x + t.w/2, cy2 = t.y + t.h/2;
        const r = Math.min(t.w, t.h) / 2;
        ctx.save();
        ctx.translate(cx2, cy2);
        // Outer ring
        for (let i = 0; i < 8; i++) {
          const ang = a + (Math.PI * 2 / 8) * i;
          ctx.beginPath();
          ctx.arc(Math.cos(ang) * r * 0.7, Math.sin(ang) * r * 0.7, 4, 0, Math.PI * 2);
          ctx.fillStyle = `hsl(${280 + i * 10}, 100%, 70%)`;
          ctx.fill();
        }
        // Center void
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = '#000';
        ctx.shadowColor = '#aa44ff';
        ctx.shadowBlur = 20;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
        // Label
        ctx.fillStyle = '#aa44ff';
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('PORTAL', cx2, t.y - 4);
        ctx.textAlign = 'left';
        break;
      }

      case 'switcheroo_lever': {
        const pulled = !!t._pulled;
        // Post
        ctx.fillStyle = '#666';
        ctx.fillRect(t.x + t.w/2 - 3, t.y, 6, t.h);
        // Handle
        const hx = pulled ? t.x + t.w - 8 : t.x + 4;
        ctx.fillStyle = pulled ? '#ff4400' : '#00aaff';
        ctx.shadowColor = pulled ? '#ff4400' : '#00aaff';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(hx, t.y + t.h/2, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // Label
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SWAP', t.x + t.w/2, t.y - 4);
        ctx.textAlign = 'left';
        break;
      }

      case 'tug_rope_anchor': {
        // Anchor point drawn as a hook
        ctx.fillStyle = '#888';
        ctx.strokeStyle = '#aaa';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(t.x + t.w/2, t.y + t.h/2, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(200,160,96,0.6)';
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('TUG', t.x + t.w/2, t.y - 4);
        ctx.textAlign = 'left';
        break;
      }

      case 'shared_oxygen_zone': {
        // Draw oxygen zone as a faint circle around each player
        const oxyPct = (t._oxygenLevel || 100) / 100;
        const zoneR  = t.oxygenRadius || 300;
        // Draw zone center around local player
        ctx.beginPath();
        ctx.arc(player.x + PLAYER_W/2, player.y + PLAYER_H/2, zoneR, 0, Math.PI * 2);
        ctx.strokeStyle = t._warning > 0
          ? `rgba(255,60,0,${0.3 + Math.sin(Date.now()*0.015)*0.2})`
          : `rgba(0,200,255,0.12)`;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.stroke();
        ctx.setLineDash([]);
        // Oxygen bar above player
        const barW = 40, barH = 5;
        const bx = player.x + PLAYER_W/2 - barW/2;
        const by = player.y - 30;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(bx, by, barW, barH);
        ctx.fillStyle = oxyPct > 0.5 ? '#00aaff' : oxyPct > 0.25 ? '#ff8800' : '#ff2222';
        ctx.fillRect(bx, by, barW * oxyPct, barH);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, barW, barH);
        // Label
        ctx.fillStyle = oxyPct > 0.5 ? '#00aaff' : '#ff4400';
        ctx.font = '6px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`O₂ ${Math.round(oxyPct*100)}%`, player.x + PLAYER_W/2, by - 2);
        ctx.textAlign = 'left';
        break;
      }
    }
  });
}

// â”€â”€â”€ PHASE 2 DRAW HELPERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function drawSawBlade(t) {
  const cx = t.x + t.r, cy = t.y + t.r;
  const teeth = 12;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t.angle || 0);

  // Outer teeth
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a1 = (Math.PI * 2 / teeth) * i;
    const a2 = (Math.PI * 2 / teeth) * (i + 0.5);
    const a3 = (Math.PI * 2 / teeth) * (i + 1);
    ctx.lineTo(Math.cos(a1) * t.r, Math.sin(a1) * t.r);
    ctx.lineTo(Math.cos(a2) * (t.r * 0.7), Math.sin(a2) * (t.r * 0.7));
    ctx.lineTo(Math.cos(a3) * t.r, Math.sin(a3) * t.r);
  }
  ctx.closePath();
  ctx.fillStyle = '#888';
  ctx.strokeStyle = '#cc2222';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#ff2222';
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Center hub
  ctx.beginPath();
  ctx.arc(0, 0, t.r * 0.25, 0, Math.PI*2);
  ctx.fillStyle = '#cc2222';
  ctx.fill();

  ctx.restore();
}

function drawLavaPool(t) {
  // Base lava
  ctx.fillStyle = '#cc3300';
  ctx.fillRect(t.x, t.y, t.w, t.h);

  // Animated surface bubbles
  const wave = t.animOffset || 0;
  ctx.fillStyle = '#ff5500';
  for (let i = 0; i < Math.floor(t.w / 20); i++) {
    const bx = t.x + i * 20 + Math.sin(wave + i) * 4;
    const by = t.y + Math.sin(wave * 1.3 + i * 0.7) * 3;
    ctx.beginPath();
    ctx.arc(bx, by, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Glow
  ctx.shadowColor = '#ff4400';
  ctx.shadowBlur = 20;
  ctx.strokeStyle = '#ff6600';
  ctx.lineWidth = 2;
  ctx.strokeRect(t.x, t.y, t.w, t.h);
  ctx.shadowBlur = 0;
}

function drawLaser(t) {
  if (t.axis === 'h') {
    // Source emitter
    ctx.fillStyle = '#330000';
    ctx.fillRect(t.x - 8, t.y - 6, 12, 12);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(t.x - 6, t.y - 4, 8, 8);

    if (t.on) {
      // Laser beam
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 18;
      ctx.strokeStyle = 'rgba(255,0,0,0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x + t.w, t.y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,150,150,0.5)';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x + t.w, t.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      // Warning: dim line
      ctx.strokeStyle = 'rgba(100,0,0,0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x + t.w, t.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else {
    // Vertical laser
    ctx.fillStyle = '#330000';
    ctx.fillRect(t.x - 6, t.y - 8, 12, 12);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(t.x - 4, t.y - 6, 8, 8);

    if (t.on) {
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 18;
      ctx.strokeStyle = 'rgba(255,0,0,0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x, t.y + t.h);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,150,150,0.5)';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x, t.y + t.h);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = 'rgba(100,0,0,0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x, t.y + t.h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawPiston(t) {
  const ext = t.extended || 0;
  ctx.fillStyle = '#333';
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 2;

  if (t.dir === 'down') {
    // Base (ceiling mount)
    ctx.fillStyle = '#444';
    ctx.fillRect(t.x, t.baseY, t.w, 20);
    ctx.strokeRect(t.x, t.baseY, t.w, 20);
    // Shaft
    const shaftLen = ext * t.reach;
    ctx.fillStyle = '#888';
    ctx.fillRect(t.x + t.w*0.3, t.baseY + 20, t.w*0.4, shaftLen);
    // Head (deadly part)
    if (ext > 0.05) {
      ctx.fillStyle = '#cc2222';
      ctx.shadowColor = '#ff2222';
      ctx.shadowBlur = ext > 0.8 ? 16 : 4;
      ctx.fillRect(t.x, t.baseY + 20 + shaftLen, t.w, t.h);
      ctx.strokeStyle = '#ff4444';
      ctx.strokeRect(t.x, t.baseY + 20 + shaftLen, t.w, t.h);
      // Spikes on head
      drawSpike(t.x, t.baseY + 20 + shaftLen + t.h - 16, t.w, 16, false);
      ctx.shadowBlur = 0;
    }
  } else if (t.dir === 'right') {
    ctx.fillStyle = '#444';
    ctx.fillRect(t.baseX, t.y, 20, t.h);
    ctx.strokeRect(t.baseX, t.y, 20, t.h);
    const shaftLen = ext * t.reach;
    ctx.fillStyle = '#888';
    ctx.fillRect(t.baseX + 20, t.y + t.h*0.3, shaftLen, t.h*0.4);
    if (ext > 0.05) {
      ctx.fillStyle = '#cc2222';
      ctx.shadowColor = '#ff2222';
      ctx.shadowBlur = ext > 0.8 ? 16 : 4;
      ctx.fillRect(t.baseX + 20 + shaftLen, t.y, t.w, t.h);
      ctx.strokeStyle = '#ff4444';
      ctx.strokeRect(t.baseX + 20 + shaftLen, t.y, t.w, t.h);
      ctx.shadowBlur = 0;
    }
  }
}

function drawBoulder(t) {
  if (t.state === 'gone') return;
  const cx = t.x + t.r, cy = t.y;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t.angle || 0);

  // Boulder body
  ctx.beginPath();
  ctx.arc(0, 0, t.r, 0, Math.PI*2);
  ctx.fillStyle = '#6a5a4a';
  ctx.strokeStyle = '#8a7a6a';
  ctx.lineWidth = 3;
  ctx.fill();
  ctx.stroke();

  // Cracks
  ctx.strokeStyle = '#3a2a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-t.r*0.3, -t.r*0.2);
  ctx.lineTo(t.r*0.2, t.r*0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(t.r*0.1, -t.r*0.4);
  ctx.lineTo(-t.r*0.3, t.r*0.1);
  ctx.stroke();

  ctx.restore();
}

function drawSpike(x, y, w, h, flipped, sideways=false) {
  const count = Math.max(1, Math.floor(w / 16));
  const sw = w / count;

  for (let i = 0; i < count; i++) {
    ctx.beginPath();
    if (!sideways) {
      if (!flipped) {
        // Spike pointing UP â€” base at bottom, tip at top
        const bx = x + i * sw, by = y + h, tx = x + i * sw + sw/2, ty = y;
        ctx.moveTo(bx,     by);
        ctx.lineTo(tx,     ty);
        ctx.lineTo(bx+sw,  by);
        ctx.closePath();
        // Gradient: tip brighter
        const grad = ctx.createLinearGradient(tx, ty, bx, by);
        grad.addColorStop(0, '#ff6666');
        grad.addColorStop(1, '#880000');
        ctx.fillStyle = grad;
      } else {
        // Spike pointing DOWN â€” base at top, tip at bottom
        const bx = x + i * sw, by = y, tx = x + i * sw + sw/2, ty = y + h;
        ctx.moveTo(bx,    by);
        ctx.lineTo(tx,    ty);
        ctx.lineTo(bx+sw, by);
        ctx.closePath();
        const grad = ctx.createLinearGradient(tx, ty, bx, by);
        grad.addColorStop(0, '#ff6666');
        grad.addColorStop(1, '#880000');
        ctx.fillStyle = grad;
      }
    } else {
      ctx.moveTo(x,   y + i * sw);
      ctx.lineTo(x+w, y + i * sw + sw/2);
      ctx.lineTo(x,   y + i * sw + sw);
      ctx.closePath();
      ctx.fillStyle = '#cc2222';
    }
    ctx.fill();
    // Pixel-art outline
    ctx.strokeStyle = 'rgba(255,100,100,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Highlight on left edge for 3D look
    if (!sideways) {
      const lx = x + i * sw;
      const mid = x + i * sw + sw/2;
      ctx.strokeStyle = 'rgba(255,180,180,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lx, y + (flipped ? 0 : h));
      ctx.lineTo(mid, y + (flipped ? h : 0));
      ctx.stroke();
    }
  }
}

function drawSpikeWheel(t) {
  const blades = 8;
  ctx.save();
  ctx.translate(t.cx, t.cy);
  ctx.rotate(t.angle);

  // Hub
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fillStyle   = '#3a1a1a';
  ctx.strokeStyle = '#ff2222';
  ctx.lineWidth   = 2;
  ctx.fill();
  ctx.stroke();

  // Blades
  for (let i = 0; i < blades; i++) {
    const a = (Math.PI * 2 / blades) * i;
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(t.r, 0);
    ctx.lineTo(0, 6);
    ctx.closePath();
    ctx.fillStyle   = '#cc2222';
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth   = 1;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

/* ===== src/render/entities.js ===== */
function drawDoor(lvl) {
  const locked = lvl.door.locked && key && !key.collected;
  const dx = door.x, dy = door.y;
  const dw = door.w, dh = door.h;
  const pulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.004);

  // â”€â”€ Pixel-art Level Devil door â”€â”€
  // Background fill
  ctx.fillStyle = locked ? '#3a1a00' : '#0a2a0a';
  ctx.fillRect(dx, dy, dw, dh);

  // Arch shape (rounded top)
  const archR = dw / 2;
  const archTopY = dy + archR;
  ctx.beginPath();
  ctx.arc(dx + dw/2, archTopY, archR, Math.PI, 0, false);
  ctx.lineTo(dx + dw, dy + dh);
  ctx.lineTo(dx, dy + dh);
  ctx.closePath();
  ctx.fillStyle = locked ? '#5a2800' : '#145014';
  ctx.fill();

  // Door panels (pixel art detail)
  if (!locked) {
    ctx.fillStyle = '#1a6a1a';
    const pw = dw * 0.35, ph = dh * 0.25;
    ctx.fillRect(dx + 4,      dy + dh*0.4, pw, ph);
    ctx.fillRect(dx + dw - pw - 4, dy + dh*0.4, pw, ph);
    ctx.fillRect(dx + 4,      dy + dh*0.7, dw-8, ph * 0.6);
  }

  // Outer frame â€” pixel thick border
  const frameColor = locked ? '#ff8800' : `rgba(80,255,120,${pulse})`;
  ctx.strokeStyle = frameColor;
  ctx.lineWidth = 3;
  // Arch border
  ctx.beginPath();
  ctx.arc(dx + dw/2, archTopY, archR - 1, Math.PI, 0, false);
  ctx.lineTo(dx + dw - 1, dy + dh);
  ctx.moveTo(dx + 1, dy + dh);
  ctx.lineTo(dx + 1, archTopY);
  ctx.stroke();
  // Bottom line
  ctx.strokeStyle = locked ? '#cc6600' : '#40cc60';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(dx, dy + dh);
  ctx.lineTo(dx + dw, dy + dh);
  ctx.stroke();

  // Glow
  ctx.shadowColor = locked ? '#ff8800' : '#40ff60';
  ctx.shadowBlur = 12 * pulse;
  ctx.strokeStyle = locked ? '#ff8800' : '#40ff60';
  ctx.lineWidth = 1;
  ctx.strokeRect(dx, dy, dw, dh);
  ctx.shadowBlur = 0;

  // Knob
  const knobX = dx + dw/2, knobY = dy + dh * 0.72;
  ctx.beginPath();
  ctx.arc(knobX, knobY, 5, 0, Math.PI * 2);
  ctx.fillStyle = locked ? '#ff8800' : '#90ff90';
  ctx.fill();
  ctx.strokeStyle = locked ? '#cc5500' : '#40cc40';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Lock overlay
  if (locked) {
    ctx.fillStyle = '#ff8800';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🔒', dx + dw/2, dy + dh*0.55);
    ctx.textAlign = 'left';
  } else {
    // Animated arrow pointing into door
    const arrowPulse = Math.floor(Date.now() / 300) % 3;
    ctx.fillStyle = `rgba(180,255,180,${0.3 + arrowPulse * 0.2})`;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('▶', dx + dw/2, dy + dh*0.85);
    ctx.textAlign = 'left';
  }
}

function drawKey() {
  if (!key || key.collected) return;
  const t = Date.now() / 400;
  const bobY = Math.sin(t) * 4;

  ctx.save();
  ctx.translate(key.x + key.w/2, key.y + key.h/2 + bobY);

  // Glow
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur  = 16;

  // Key body
  ctx.beginPath();
  ctx.arc(0, -4, 8, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth   = 3;
  ctx.stroke();

  ctx.fillStyle = '#ffd700';
  ctx.fillRect(-2, 0, 4, 12);
  ctx.fillRect(-2, 4, 8, 3);
  ctx.fillRect(-2, 8, 6, 3);

  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawParticles() {
  particles.forEach(p => {
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = p.color;
    ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
  });
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  const x = player.x, y = player.y;
  const flip = player.gravityFlipped;

  if (player.invincible && Math.floor(Date.now() / 80) % 2 === 0) return;

  ctx.save();
  ctx.translate(x + PLAYER_W/2, y + PLAYER_H/2);
  if (player.facing === -1) ctx.scale(-1, 1);
  if (flip) ctx.scale(1, -1);

  const hw = PLAYER_W / 2, hh = PLAYER_H / 2;

  // Speaking glow in multiplayer
  if (multiMode && isSpeaking(myPlayerIdx)) {
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur  = 14;
  }

  // "Being stood on" golden glow â€” another player is on your head
  if (multiMode && player._beingStoodOn > 0) {
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur  = 16;
  }

  // Body â€” colored by player slot in MP, white in solo
  ctx.fillStyle = multiMode ? PLAYER_COLORS[myPlayerIdx] : '#e8e8e8';
  ctx.fillRect(-hw, -hh, PLAYER_W, PLAYER_H);

  // Highlight stripe
  if (multiMode) {
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(-hw, -hh, PLAYER_W, 5);
  }

  ctx.shadowBlur = 0;

  // Face
  ctx.fillStyle = '#000';
  const eyeY = -hh + 8;
  ctx.fillRect(-hw + 6, eyeY, 5, 5);
  ctx.fillRect(hw - 11, eyeY, 5, 5);

  if (!player.onGround) {
    ctx.beginPath();
    ctx.arc(0, eyeY + 12, 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillRect(-6, eyeY + 12, 12, 3);
  }

  // Walking legs
  if (player.onGround && Math.abs(player.vx) > 0.5) {
    const legSwing = Math.sin(player.animFrame * Math.PI / 2) * 5;
    ctx.fillStyle = multiMode ? PLAYER_DARK[myPlayerIdx] : '#888';
    ctx.fillRect(-hw, hh - 8, 10, 8 + legSwing);
    ctx.fillRect(hw - 10, hh - 8, 10, 8 - legSwing);
  }

  ctx.restore();

  // Name tag in multiplayer
  if (multiMode) {
    ctx.save();
    ctx.font = '7px monospace';
    ctx.fillStyle = PLAYER_COLORS[myPlayerIdx];
    ctx.textAlign = 'center';
    const localTag = currentRoomMode === 'pvp' ? (myTeam === 'team2' ? 'T2 ' : 'T1 ') : '';
    ctx.fillText(localTag + playerName + ' (YOU)', x + PLAYER_W/2, y - 6);
    if (currentRoomMode === 'pvp') {
      ctx.fillStyle = myTeam === 'team2' ? '#ff9b6b' : '#6bc5ff';
      ctx.fillText(myTeam === 'team2' ? 'T2' : 'T1', x + PLAYER_W/2, y - 18);
    }
    ctx.textAlign = 'left';
    ctx.restore();
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/* ===== src/input-and-boot.js ===== */
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
