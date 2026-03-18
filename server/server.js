/**
 * LEVEL DEVIL — Production Multiplayer Server
 * ============================================
 * Stack : Node.js + Express + Socket.io + WebRTC signaling
 * Deploy: Render / Railway / Fly.io (free tier works)
 *
 * What this server does:
 *  1. Serves the game's index.html (optional, can be separate CDN)
 *  2. Socket.io signaling — room creation, join, WebRTC offer/answer/ICE relay
 *  3. Game state relay for players who can't do direct P2P (fallback)
 *  4. Voice signaling relay (WebRTC audio peer connections)
 *  5. Room management — up to 4 players, lobby, ready-up, start
 *
 * Install:
 *   npm install express socket.io cors
 *
 * Run locally:
 *   node server.js
 *
 * Deploy to Render (free):
 *   1. Push this repo to GitHub
 *   2. New Web Service → connect repo → Build: npm install → Start: node server.js
 *   3. Copy the https://xxxx.onrender.com URL into index.html SERVER_URL constant
 */

'use strict';

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const cors      = require('cors');
const path      = require('path');

// ─── CONFIG ──────────────────────────────────
const PORT        = process.env.PORT || 3000;
const MAX_PLAYERS = 4;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ─── APP SETUP ───────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  // Prefer WebSocket, fall back to polling
  transports: ['websocket', 'polling'],
  // Keep alive settings for low latency
  pingInterval: 5000,
  pingTimeout:  10000,
});

app.use(cors());
app.use(express.json());
// Serve the game files from /leveldevil folder (or current dir)
app.use(express.static(path.join(__dirname, '..')));
app.use(express.static(path.join(__dirname)));

// Health check endpoint (Render needs this)
app.get('/health', (_, res) => res.json({ ok: true, rooms: rooms.size, players: totalPlayers() }));

// ─── ROOM STORE ──────────────────────────────
/**
 * rooms: Map<roomCode, Room>
 * Room = {
 *   code: string,
 *   hostSocketId: string,
 *   players: Map<socketId, Player>,
 *   state: 'lobby' | 'playing' | 'ended',
 *   levelOrder: number[],
 *   createdAt: number,
 * }
 * Player = {
 *   socketId: string,
 *   name: string,
 *   slot: number,       // 0-3
 *   ready: boolean,
 *   alive: boolean,
 * }
 */
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
  // Make sure it's unique
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
  return -1; // full
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
      console.log(`[Cleanup] Removed stale room ${code}`);
    }
  }
}, 5 * 60 * 1000);

// ═══════════════════════════════════════════════
//  SOCKET.IO EVENTS
// ═══════════════════════════════════════════════
io.on('connection', socket => {
  console.log(`[+] Socket connected: ${socket.id}`);

  // ── ROOM: CREATE ─────────────────────────────
  socket.on('room:create', ({ name }, ack) => {
    const code = genRoomCode();
    const room = {
      code,
      hostSocketId: socket.id,
      players: new Map(),
      state: 'lobby',
      levelOrder: [],
      createdAt: Date.now(),
    };

    const player = { socketId: socket.id, name: name || 'HOST', slot: 0, ready: true, alive: true };
    room.players.set(socket.id, player);
    rooms.set(code, room);

    socket.join(code);
    console.log(`[Room] Created ${code} by ${name} (${socket.id})`);

    ack({ ok: true, code, slot: 0, summary: roomSummary(room) });
  });

  // ── ROOM: JOIN ───────────────────────────────
  socket.on('room:join', ({ code, name }, ack) => {
    const room = rooms.get(code);

    if (!room)                          return ack({ ok: false, reason: 'Room not found' });
    if (room.state !== 'lobby')         return ack({ ok: false, reason: 'Game already started' });
    if (room.players.size >= MAX_PLAYERS) return ack({ ok: false, reason: 'Room is full' });

    const slot   = getNextSlot(room);
    const player = { socketId: socket.id, name: name || 'PLAYER', slot, ready: false, alive: true };
    room.players.set(socket.id, player);

    socket.join(code);
    console.log(`[Room] ${name} joined ${code} as slot ${slot}`);

    // Tell everyone else a new player joined
    socket.to(code).emit('room:player_joined', { player: { socketId: socket.id, name: player.name, slot } });

    ack({ ok: true, code, slot, summary: roomSummary(room) });
  });

  // ── ROOM: LEAVE ──────────────────────────────
  socket.on('room:leave', () => handleLeave(socket));

  // ── ROOM: START GAME (host only) ─────────────
  socket.on('room:start', ({ levelOrder }, ack) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.hostSocketId !== socket.id) return ack && ack({ ok: false });

    room.state      = 'playing';
    room.levelOrder = levelOrder || [];

    io.to(room.code).emit('game:start', { levelOrder: room.levelOrder, summary: roomSummary(room) });
    console.log(`[Room] ${room.code} game started`);
    ack && ack({ ok: true });
  });

  // ── WEBRTC SIGNALING ─────────────────────────
  // Relay WebRTC offer/answer/ICE between specific sockets
  // This is what makes direct P2P possible across the internet

  socket.on('rtc:offer', ({ to, offer, fromSlot }) => {
    io.to(to).emit('rtc:offer', { from: socket.id, fromSlot, offer });
  });

  socket.on('rtc:answer', ({ to, answer, fromSlot }) => {
    io.to(to).emit('rtc:answer', { from: socket.id, fromSlot, answer });
  });

  socket.on('rtc:ice', ({ to, candidate }) => {
    io.to(to).emit('rtc:ice', { from: socket.id, candidate });
  });

  // ── VOICE SIGNALING (separate WebRTC connection for audio) ──
  socket.on('voice:offer', ({ to, offer }) => {
    io.to(to).emit('voice:offer', { from: socket.id, offer });
  });

  socket.on('voice:answer', ({ to, answer }) => {
    io.to(to).emit('voice:answer', { from: socket.id, answer });
  });

  socket.on('voice:ice', ({ to, candidate }) => {
    io.to(to).emit('voice:ice', { from: socket.id, candidate });
  });

  // ── GAME STATE RELAY (host → all clients) ────
  // Host broadcasts authoritative state; server just relays to the room
  socket.on('game:state', (payload) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.hostSocketId !== socket.id) return;
    // Relay to everyone except sender
    socket.to(room.code).emit('game:state', payload);
  });

  // ── PLAYER INPUT (client → host) ─────────────
  socket.on('game:input', (payload) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    // Relay only to host
    io.to(room.hostSocketId).emit('game:input', {
      ...payload,
      fromSocketId: socket.id,
    });
  });

  // ── PLAYER EVENTS (death, respawn, level clear) ──
  socket.on('game:event', (payload) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    // Broadcast to whole room (host + clients)
    socket.to(room.code).emit('game:event', { ...payload, fromSocketId: socket.id });
  });

  // ── PING / LATENCY ───────────────────────────
  socket.on('ping:req', ({ ts }) => {
    socket.emit('ping:res', { ts });
  });

  // ── DISCONNECT ───────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[-] Socket disconnected: ${socket.id}`);
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

  console.log(`[Room] ${player.name} left ${room.code}`);

  if (room.players.size === 0) {
    rooms.delete(room.code);
    console.log(`[Room] ${room.code} closed (empty)`);
    return;
  }

  // If host left, assign new host (lowest slot)
  if (room.hostSocketId === socket.id) {
    const newHost = [...room.players.values()].sort((a,b) => a.slot - b.slot)[0];
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
╔══════════════════════════════════════╗
║   LEVEL DEVIL — Multiplayer Server   ║
║   Port: ${PORT.toString().padEnd(29)}║
║   Rooms: active room management      ║
║   WebRTC signaling: Socket.io relay  ║
╚══════════════════════════════════════╝
  `);
});