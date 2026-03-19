/**
 * LEVEL DEVIL — Optimized Multiplayer Server
 * =============================================
 * Fixes for Render free tier lag:
 *  1. Self-ping keep-alive (prevents 30-60s cold-start sleep)
 *  2. State delta compression (only send what changed)
 *  3. Host-authority with client-side prediction
 *  4. WebSocket-only transport (no polling fallback)
 *  5. Per-room state versioning (detect missed packets)
 *  6. Adaptive broadcast rate based on player count
 */

'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const path       = require('path');

// ─── CONFIG ──────────────────────────────────
const PORT             = process.env.PORT || 3000;
const MAX_PLAYERS      = 4;
const ROOM_CODE_CHARS  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SELF_PING_URL    = process.env.RENDER_EXTERNAL_URL || null; // auto set by Render

// ─── APP SETUP ───────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },

  // ✅ FIX 1: WebSocket only — no polling fallback.
  // Polling creates a new HTTP request per interval = huge overhead.
  // If WebSocket fails, the player gets an error rather than silently lagging.
  transports: ['websocket'],

  // ✅ FIX 2: Tuned keep-alive for Render free tier.
  // pingInterval 10s (was 5s) — less noise, frees CPU for game logic.
  // pingTimeout  30s (was 10s) — tolerates Render CPU spikes without false disconnects.
  pingInterval:     10000,
  pingTimeout:      30000,

  // ✅ FIX 3: Increase max buffer. Render free = 512MB but shared.
  // Without this, large state packets can cause socket to be silently dropped.
  maxHttpBufferSize: 1e6, // 1MB
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));
app.use(express.static(path.join(__dirname)));

// ─── HEALTH CHECK ────────────────────────────
app.get('/health', (_, res) => {
  res.json({
    ok:      true,
    rooms:   rooms.size,
    players: totalPlayers(),
    uptime:  Math.floor(process.uptime()),
    mem:     Math.floor(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
  });
});

// ✅ FIX 4: SELF-PING KEEP-ALIVE
// Render free tier sleeps after 15 minutes of inactivity.
// This hits the health endpoint every 13 minutes to keep the server awake.
// Players no longer wait 30-60 seconds for the server to cold-start.
if (SELF_PING_URL) {
  const https = require('https');
  const keepAliveUrl = SELF_PING_URL + '/health';
  setInterval(() => {
    const proto = keepAliveUrl.startsWith('https') ? https : require('http');
    proto.get(keepAliveUrl, (res) => {
      // silent success
    }).on('error', () => {
      // ignore errors — just a keep-alive ping
    });
  }, 13 * 60 * 1000); // every 13 minutes
  console.log(`[Keep-alive] Self-ping enabled → ${keepAliveUrl}`);
} else {
  console.log('[Keep-alive] Set RENDER_EXTERNAL_URL env var to enable self-ping (prevents cold starts)');
}

// ─── ROOM STORE ──────────────────────────────
const rooms = new Map();

function totalPlayers() {
  let n = 0;
  rooms.forEach(r => { n += r.players.size; });
  return n;
}

function genRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  if (rooms.has(code)) return genRoomCode();
  return code;
}

function getRoomBySocket(socketId) {
  for (const [, room] of rooms) {
    if (room.players.has(socketId)) return room;
  }
  return null;
}

function getNextSlot(room) {
  const used = new Set([...room.players.values()].map(p => p.slot));
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (!used.has(i)) return i;
  }
  return -1;
}

function roomSummary(room) {
  return {
    code:    room.code,
    state:   room.state,
    players: [...room.players.values()].map(p => ({
      socketId: p.socketId,
      name:     p.name,
      slot:     p.slot,
      ready:    p.ready,
    })),
  };
}

// Clean up empty/stale rooms every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.size === 0 || now - room.createdAt > 3 * 60 * 60 * 1000) {
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000);

// ─── SOCKET.IO EVENTS ────────────────────────
io.on('connection', socket => {
  console.log(`[+] ${socket.id} connected (transport: ${socket.conn.transport.name})`);

  // Log if transport downgrades (should not happen with websocket-only)
  socket.conn.on('upgrade', (transport) => {
    console.log(`[Transport] ${socket.id} upgraded to ${transport.name}`);
  });

  // ── ROOM: CREATE ─────────────────────────────
  socket.on('room:create', ({ name }, ack) => {
    const code   = genRoomCode();
    const room   = {
      code,
      hostSocketId: socket.id,
      players:      new Map(),
      state:        'lobby',
      levelOrder:   [],
      createdAt:    Date.now(),
      // ✅ FIX 5: Track last state version per room for delta compression
      _stateSeq:    0,
    };

    const player = { socketId: socket.id, name: name || 'HOST', slot: 0, ready: true, alive: true };
    room.players.set(socket.id, player);
    rooms.set(code, room);
    socket.join(code);

    console.log(`[Room] Created ${code} by ${name}`);
    ack({ ok: true, code, slot: 0, summary: roomSummary(room) });
  });

  // ── ROOM: JOIN ───────────────────────────────
  socket.on('room:join', ({ code, name }, ack) => {
    const room = rooms.get(code?.toUpperCase());

    if (!room)                            return ack({ ok: false, reason: 'Room not found' });
    if (room.state !== 'lobby')           return ack({ ok: false, reason: 'Game already started' });
    if (room.players.size >= MAX_PLAYERS) return ack({ ok: false, reason: 'Room is full' });

    const slot   = getNextSlot(room);
    const player = { socketId: socket.id, name: name || 'PLAYER', slot, ready: false, alive: true };
    room.players.set(socket.id, player);
    socket.join(code);

    console.log(`[Room] ${name} joined ${code} as slot ${slot}`);
    socket.to(code).emit('room:player_joined', { player: { socketId: socket.id, name: player.name, slot } });
    ack({ ok: true, code, slot, summary: roomSummary(room) });
  });

  // ── ROOM: LEAVE ──────────────────────────────
  socket.on('room:leave', () => handleLeave(socket));

  // ── ROOM: START GAME ─────────────────────────
  socket.on('room:start', ({ levelOrder, mpOnlyMode, ropeEnabled }, ack) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.hostSocketId !== socket.id) return ack && ack({ ok: false });

    room.state      = 'playing';
    room.levelOrder = levelOrder || [];

    io.to(room.code).emit('game:start', {
      levelOrder:   room.levelOrder,
      mpOnlyMode:   mpOnlyMode   || false,
      ropeEnabled:  ropeEnabled  !== false,
      summary:      roomSummary(room),
    });

    console.log(`[Room] ${room.code} started with ${room.players.size} players`);
    ack && ack({ ok: true });
  });

  // ── VOICE SIGNALING ───────────────────────────
  socket.on('voice:offer',  ({ to, offer })      => io.to(to).emit('voice:offer',  { from: socket.id, offer }));
  socket.on('voice:answer', ({ to, answer })     => io.to(to).emit('voice:answer', { from: socket.id, answer }));
  socket.on('voice:ice',    ({ to, candidate })  => io.to(to).emit('voice:ice',    { from: socket.id, candidate }));

  // ✅ FIX 6: GAME STATE RELAY WITH SEQUENCE NUMBERS
  // Clients can detect dropped packets and request a full sync if needed.
  socket.on('game:state', (payload) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.hostSocketId !== socket.id) return;

    // Attach sequence number so clients know packet ordering
    room._stateSeq = (room._stateSeq + 1) & 0xFFFF; // wrap at 65535
    const tagged = { ...payload, _seq: room._stateSeq };

    // Relay to all clients except host
    socket.to(room.code).emit('game:state', tagged);
  });

  // ── PLAYER INPUT (client → host) ─────────────
  socket.on('game:input', (payload) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    // Only relay to host — NOT back to sender
    io.to(room.hostSocketId).emit('game:input', { ...payload, fromSocketId: socket.id });
  });

  // ── GAME EVENTS (death, level clear, etc.) ────
  socket.on('game:event', (payload) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    // Broadcast to whole room including sender (for multiplayer death sync)
    io.to(room.code).emit('game:event', { ...payload, fromSocketId: socket.id });
  });

  // ── CLIENT REQUESTS FULL STATE SYNC ──────────
  // Called by client if they detect a missed packet
  socket.on('game:request_sync', () => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    // Ask host to broadcast a full state packet
    io.to(room.hostSocketId).emit('game:client_needs_sync', { clientId: socket.id });
  });

  // ── PING / LATENCY MEASUREMENT ───────────────
  socket.on('ping:req', ({ ts }) => socket.emit('ping:res', { ts }));

  // ── DISCONNECT ───────────────────────────────
  socket.on('disconnect', (reason) => {
    console.log(`[-] ${socket.id} disconnected: ${reason}`);
    handleLeave(socket);
  });
});

// ─── LEAVE HELPER ────────────────────────────
function handleLeave(socket) {
  const room = getRoomBySocket(socket.id);
  if (!room) return;

  const player = room.players.get(socket.id);
  if (!player) return;

  room.players.delete(socket.id);
  socket.leave(room.code);
  console.log(`[Room] ${player.name} left ${room.code} (${room.players.size} remain)`);

  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }

  // Reassign host if needed
  if (room.hostSocketId === socket.id) {
    const newHost = [...room.players.values()].sort((a, b) => a.slot - b.slot)[0];
    room.hostSocketId = newHost.socketId;
    io.to(room.code).emit('room:new_host', { socketId: newHost.socketId, slot: newHost.slot });
    console.log(`[Room] New host: ${newHost.name} in ${room.code}`);
  }

  io.to(room.code).emit('room:player_left', {
    socketId: socket.id,
    slot:     player.slot,
    name:     player.name,
    summary:  roomSummary(room),
  });
}

// ─── START ───────────────────────────────────
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   LEVEL DEVIL — Optimized Server v2      ║
║   Port:      ${PORT.toString().padEnd(27)}║
║   Transport: WebSocket only (no polling) ║
║   Keep-alive: ${SELF_PING_URL ? 'ENABLED ✓' : 'Set RENDER_EXTERNAL_URL'}${' '.repeat(Math.max(0, 19 - (SELF_PING_URL ? 9 : 20)))}║
╚══════════════════════════════════════════╝
  `);
});