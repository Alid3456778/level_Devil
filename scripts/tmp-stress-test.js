const { io } = require('socket.io-client');

const SERVER_URL = process.env.STRESS_URL || 'http://127.0.0.1:3014';
const ROOM_COUNT = Number(process.env.STRESS_ROOMS || 4);
const PLAYERS_PER_ROOM = Number(process.env.STRESS_PLAYERS || 4);
const TEST_MS = Number(process.env.STRESS_MS || 10000);
const HOST_STATE_INTERVAL_MS = Number(process.env.STRESS_STATE_MS || 33);
const CLIENT_INPUT_INTERVAL_MS = Number(process.env.STRESS_INPUT_MS || 50);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function average(values) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function createClient(name) {
  const socket = io(SERVER_URL, {
    transports: ['websocket'],
    upgrade: false,
    reconnection: false,
    timeout: 15000,
  });
  socket._name = name;
  socket._stateLatencies = [];
  socket._stateCount = 0;
  socket._inputCount = 0;
  socket._pings = [];
  return socket;
}

function connectClient(socket) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    socket.once('connect', () => resolve(Date.now() - started));
    socket.once('connect_error', reject);
  });
}

function roomCreate(socket, name, mode = 'coop') {
  return new Promise((resolve) => {
    socket.emit('room:create', { name, mode }, resolve);
  });
}

function roomJoin(socket, code, name, mode = 'coop') {
  return new Promise((resolve) => {
    socket.emit('room:join', { code, name, mode }, resolve);
  });
}

function roomStart(socket) {
  return new Promise((resolve) => {
    socket.emit('room:start', { levelOrder: [0, 1, 2], mpOnlyMode: false, ropeEnabled: true }, resolve);
  });
}

async function buildRoom(roomIndex) {
  const clients = [];
  for (let i = 0; i < PLAYERS_PER_ROOM; i++) {
    const socket = createClient(`R${roomIndex + 1}P${i + 1}`);
    socket._connectMs = await connectClient(socket);
    clients.push(socket);
  }

  const host = clients[0];
  const createRes = await roomCreate(host, host._name, 'coop');
  if (!createRes?.ok) {
    throw new Error(`room:create failed for ${host._name}: ${createRes?.reason || 'unknown'}`);
  }

  const code = createRes.code;
  const joinTimes = [];
  for (let i = 1; i < clients.length; i++) {
    const started = Date.now();
    const res = await roomJoin(clients[i], code, clients[i]._name, 'coop');
    joinTimes.push(Date.now() - started);
    if (!res?.ok) {
      throw new Error(`room:join failed for ${clients[i]._name}: ${res?.reason || 'unknown'}`);
    }
  }

  const startRes = await roomStart(host);
  if (!startRes?.ok) {
    throw new Error(`room:start failed for ${host._name}: ${startRes?.reason || 'unknown'}`);
  }

  return { host, clients, code, joinTimes };
}

function attachStateListener(socket) {
  socket.on('game:state', (msg) => {
    socket._stateCount++;
    if (typeof msg?.ts === 'number') {
      socket._stateLatencies.push(Date.now() - msg.ts);
    }
  });
}

function attachPingLoop(socket) {
  const timer = setInterval(() => {
    const ts = Date.now();
    socket.emit('ping:req', { ts });
  }, 2000);
  socket.on('ping:res', ({ ts }) => {
    socket._pings.push(Date.now() - ts);
  });
  return timer;
}

function startHostLoop(host, playersPerRoom) {
  let seq = 0;
  return setInterval(() => {
    host.emit('game:state', {
      ts: Date.now(),
      players: Array.from({ length: playersPerRoom }, (_, idx) => ({
        slot: idx,
        x: 60 + ((seq + idx * 17) % 500),
        y: 300 + (idx % 2) * 12,
        vx: 1.5,
        vy: 0,
        facing: 1,
        gravityFlipped: false,
        alive: true,
        animFrame: seq % 4,
        name: `P${idx + 1}`,
      })),
      traps: [],
      platforms: [],
      key: null,
      door: { open: false },
    });
    seq++;
  }, HOST_STATE_INTERVAL_MS);
}

function startClientInputLoop(socket, idx) {
  let tick = 0;
  return setInterval(() => {
    tick++;
    socket._inputCount++;
    socket.emit('game:input', {
      left: tick % 4 < 2,
      right: tick % 4 >= 2,
      jump: tick % 11 === 0,
      x: 100 + ((tick * 6 + idx * 20) % 600),
      y: 300,
      vx: tick % 4 < 2 ? -4.5 : 4.5,
      vy: tick % 11 === 0 ? -9 : 0,
      alive: true,
      facing: tick % 4 < 2 ? -1 : 1,
      gravityFlipped: false,
      animFrame: tick % 4,
      ts: Date.now(),
    });
  }, CLIENT_INPUT_INTERVAL_MS);
}

async function main() {
  const rooms = [];
  const allTimers = [];
  const roomCreateDurations = [];
  const roomJoinDurations = [];

  try {
    for (let r = 0; r < ROOM_COUNT; r++) {
      const room = await buildRoom(r);
      rooms.push(room);
      roomCreateDurations.push(room.host._connectMs);
      roomJoinDurations.push(...room.joinTimes);

      room.clients.slice(1).forEach(attachStateListener);
      room.clients.forEach((socket) => allTimers.push(attachPingLoop(socket)));
      allTimers.push(startHostLoop(room.host, room.clients.length));
      room.clients.slice(1).forEach((socket, idx) => {
        allTimers.push(startClientInputLoop(socket, idx));
      });
    }

    await sleep(TEST_MS);

    const guestSockets = rooms.flatMap((room) => room.clients.slice(1));
    const stateLatencies = guestSockets.flatMap((socket) => socket._stateLatencies);
    const pings = rooms.flatMap((room) => room.clients.flatMap((socket) => socket._pings));
    const totalStateMsgs = guestSockets.reduce((sum, socket) => sum + socket._stateCount, 0);
    const totalInputs = guestSockets.reduce((sum, socket) => sum + socket._inputCount, 0);

    console.log(JSON.stringify({
      server: SERVER_URL,
      rooms: ROOM_COUNT,
      playersPerRoom: PLAYERS_PER_ROOM,
      durationMs: TEST_MS,
      totalSockets: rooms.reduce((sum, room) => sum + room.clients.length, 0),
      avgConnectMs: Number(average(rooms.flatMap((room) => room.clients.map((socket) => socket._connectMs))).toFixed(2)),
      avgJoinMs: Number(average(roomJoinDurations).toFixed(2)),
      avgPingMs: Number(average(pings).toFixed(2)),
      p95PingMs: Number(percentile(pings, 95).toFixed(2)),
      avgStateLatencyMs: Number(average(stateLatencies).toFixed(2)),
      p95StateLatencyMs: Number(percentile(stateLatencies, 95).toFixed(2)),
      maxStateLatencyMs: Number((stateLatencies.length ? Math.max(...stateLatencies) : 0).toFixed(2)),
      totalStateMessages: totalStateMsgs,
      totalInputMessages: totalInputs,
      notes: [
        'This stresses Socket.io room create/join/start, host game:state relay, and guest game:input traffic.',
        'It does not simulate browser rendering, WebRTC audio, or real WAN/mobile jitter.'
      ]
    }, null, 2));
  } finally {
    allTimers.forEach(clearInterval);
    rooms.forEach((room) => room.clients.forEach((socket) => {
      try { socket.disconnect(); } catch (e) {}
    }));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
