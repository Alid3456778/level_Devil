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
