/**
 * LEVEL DEVIL — Production Server v3
 * ====================================
 * New in v3:
 *  - MongoDB Atlas: users, scores
 *  - JWT authentication (httpOnly cookie + Bearer)
 *  - bcrypt password hashing
 *  - Leaderboard API with per-level scoring
 *  - Score formula: base(1000) - deaths_penalty - time_penalty
 *    Only saves if new score > previous best for that level
 *
 * Required env vars:
 *   MONGODB_URI       = mongodb+srv://user:pass@cluster.mongodb.net/leveldevil
 *   JWT_SECRET        = any long random string (openssl rand -hex 32)
 *   RENDER_EXTERNAL_URL = https://your-app.onrender.com (for keep-alive ping)
 *
 * Install:
 *   npm install express socket.io cors mongoose bcryptjs jsonwebtoken
 */

require('dotenv').config();
const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const cors        = require('cors');
const path        = require('path');
const mongoose    = require('mongoose');
const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');

// ─── CONFIG ──────────────────────────────────
const PORT           = process.env.PORT        || 3000;
const MONGO_URI      = process.env.MONGODB_URI || '';
const JWT_SECRET     = process.env.JWT_SECRET  || 'level_devil_jwt_secret_change_me';
const JWT_EXPIRES    = '30d';   // stay logged in for 30 days
const MAX_PLAYERS    = 4;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SELF_PING_URL  = process.env.RENDER_EXTERNAL_URL || null;

// ─── SCORING CONSTANTS ────────────────────────
// Score = BASE - death_penalty - time_penalty
// death_penalty: 0 deaths=0, 1=50, 2=100, 3=180, 4=280, 5=400, 6=540, 7+=700
// time_penalty:  0-30s=0, 30-60s=20, 60-120s=60, 120-180s=120, 180-240s=200, >240s=no score
const SCORE_BASE         = 1000;
const DEATH_PENALTIES    = [0, 50, 100, 180, 280, 400, 540, 700];
const MAX_LEVEL_TIME_SEC = 240; // 4 minutes — after this, score = 0

function calcScore(deaths, timeSec) {
  if (timeSec > MAX_LEVEL_TIME_SEC) return 0;
  const dp = DEATH_PENALTIES[Math.min(deaths, DEATH_PENALTIES.length - 1)];
  let tp = 0;
  if      (timeSec <= 30)  tp = 0;
  else if (timeSec <= 60)  tp = 20;
  else if (timeSec <= 120) tp = 60;
  else if (timeSec <= 180) tp = 120;
  else                     tp = 200;
  return Math.max(0, SCORE_BASE - dp - tp);
}

// ─── MONGODB SCHEMAS ─────────────────────────
let dbConnected = false;

const UserSchema = new mongoose.Schema({
  username:     { type: String, required: true, unique: true, trim: true, maxlength: 20 },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  createdAt:    { type: Date,   default: Date.now },
  lastLoginAt:  { type: Date,   default: Date.now },
});
UserSchema.index({ username: 1 });
UserSchema.index({ email: 1 });

// One doc per (user × level) — stores BEST score only.
// When a new run finishes, we compare and only update if it improves.
const ScoreSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username:     { type: String, required: true },   // denormalized for fast leaderboard reads
  levelId:      { type: Number, required: true },
  score:        { type: Number, required: true },
  deaths:       { type: Number, required: true },
  timeSec:      { type: Number, required: true },
  updatedAt:    { type: Date,   default: Date.now },
});
ScoreSchema.index({ levelId: 1, score: -1 });  // leaderboard query
ScoreSchema.index({ userId: 1, levelId: 1 }, { unique: true }); // one record per user/level

let User, Score;
if (MONGO_URI) {
  mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => {
      dbConnected = true;
      User  = mongoose.model('User',  UserSchema);
      Score = mongoose.model('Score', ScoreSchema);
      console.log('[MongoDB] Connected to Atlas ✓');
    })
    .catch(err => {
      console.error('[MongoDB] Connection failed:', err.message);
      console.warn('[MongoDB] Auth and leaderboard disabled — set MONGODB_URI env var');
    });
} else {
  console.warn('[MongoDB] MONGODB_URI not set — auth and leaderboard disabled');
}

// ─── JWT HELPERS ─────────────────────────────
function signToken(userId, username) {
  return jwt.sign({ sub: userId.toString(), username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

function extractToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return req.cookies?.ld_token || null;
}

// Middleware: attach user to req if valid JWT
function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) req.user = verifyToken(token);
  next();
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ ok: false, reason: 'Not authenticated' });
  req.user = payload;
  next();
}

// ─── APP SETUP ───────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors:              { origin: '*', methods: ['GET', 'POST'] },
  transports:        ['websocket'],
  pingInterval:      10000,
  pingTimeout:       30000,
  maxHttpBufferSize: 1e6,
});

app.use(cors());
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, '..')));
app.use(express.static(path.join(__dirname)));

// ════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  if (!dbConnected) return res.json({ ok: false, reason: 'Database not connected' });

  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ ok: false, reason: 'username, email and password required' });

  if (username.length < 2 || username.length > 20)
    return res.status(400).json({ ok: false, reason: 'Username must be 2-20 characters' });

  if (password.length < 6)
    return res.status(400).json({ ok: false, reason: 'Password must be at least 6 characters' });

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email))
    return res.status(400).json({ ok: false, reason: 'Invalid email address' });

  try {
    const existing = await User.findOne({
      $or: [{ username: { $regex: new RegExp(`^${username}$`, 'i') } }, { email }]
    });
    if (existing) {
      const field = existing.username.toLowerCase() === username.toLowerCase() ? 'Username' : 'Email';
      return res.status(409).json({ ok: false, reason: `${field} already taken` });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, email, passwordHash });
    const token = signToken(user._id, user.username);

    console.log(`[Auth] Registered: ${username}`);
    res.json({ ok: true, token, username: user.username, userId: user._id });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    res.status(500).json({ ok: false, reason: 'Registration failed' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  if (!dbConnected) return res.json({ ok: false, reason: 'Database not connected' });

  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ ok: false, reason: 'username and password required' });

  try {
    // Allow login by username OR email
    const user = await User.findOne({
      $or: [
        { username: { $regex: new RegExp(`^${username}$`, 'i') } },
        { email: username.toLowerCase() }
      ]
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res.status(401).json({ ok: false, reason: 'Invalid username or password' });

    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken(user._id, user.username);
    console.log(`[Auth] Login: ${user.username}`);
    res.json({ ok: true, token, username: user.username, userId: user._id });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ ok: false, reason: 'Login failed' });
  }
});

// GET /api/auth/me — verify stored token and return user info
app.get('/api/auth/me', optionalAuth, (req, res) => {
  if (!req.user) return res.json({ ok: false });
  res.json({ ok: true, username: req.user.username, userId: req.user.sub });
});

// ════════════════════════════════════════════════
//  SCORE ROUTES
// ════════════════════════════════════════════════

// POST /api/scores — submit a level completion
// Body: { levelId, deaths, timeSec }
app.post('/api/scores', requireAuth, async (req, res) => {
  if (!dbConnected) return res.json({ ok: false, reason: 'Database not connected' });

  const { levelId, deaths, timeSec } = req.body;
  if (levelId === undefined || deaths === undefined || timeSec === undefined)
    return res.status(400).json({ ok: false, reason: 'levelId, deaths, timeSec required' });

  // Validate ranges to prevent cheating
  if (deaths < 0 || deaths > 999 || timeSec < 1 || timeSec > 3600)
    return res.status(400).json({ ok: false, reason: 'Invalid score data' });

  const newScore = calcScore(deaths, timeSec);
  if (newScore <= 0) return res.json({ ok: true, saved: false, score: 0, reason: 'Score too low to record' });

  try {
    const userId = req.user.sub;
    const existing = await Score.findOne({ userId, levelId });

    if (existing && existing.score >= newScore) {
      // Existing score is better — don't replace
      return res.json({ ok: true, saved: false, score: newScore, best: existing.score, reason: 'Existing score is better' });
    }

    await Score.findOneAndUpdate(
      { userId, levelId },
      { userId, username: req.user.username, levelId, score: newScore, deaths, timeSec, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    const prevBest = existing?.score || 0;
    console.log(`[Score] ${req.user.username} level=${levelId} score=${newScore} (was ${prevBest}) deaths=${deaths} time=${timeSec}s`);
    res.json({ ok: true, saved: true, score: newScore, prevBest, improved: newScore - prevBest });
  } catch (err) {
    console.error('[Score] Submit error:', err);
    res.status(500).json({ ok: false, reason: 'Failed to save score' });
  }
});

// GET /api/leaderboard?limit=10
// Returns ONE row per player: sum of all their best level scores.
// Sorted by total score descending — this is the true global ranking.
// Cached 30s to keep DB load minimal.
const _lbCache    = new Map(); // key → { data, ts }
const LB_CACHE_MS = 30_000;

app.get('/api/leaderboard', async (req, res) => {
  if (!dbConnected) return res.json({ ok: false, reason: 'Database not connected', scores: [] });

  const limit    = Math.min(parseInt(req.query.limit) || 10, 50);
  const cacheKey = `lb:total:${limit}`;

  // Return cached if still fresh
  const cached = _lbCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < LB_CACHE_MS) {
    return res.json({ ok: true, scores: cached.data, cached: true });
  }

  try {
    // Aggregate: group ALL level scores by userId, sum totals
    // Each userId has at most one score doc per level (best score only),
    // so summing gives the true total across the game.
    const scores = await Score.aggregate([
      {
        $group: {
          _id:         '$userId',
          username:    { $first: '$username' },  // all rows for same user have same username
          totalScore:  { $sum:   '$score' },
          totalDeaths: { $sum:   '$deaths' },
          levelsPlayed:{ $sum:   1 },             // how many levels they've completed
        }
      },
      { $sort:  { totalScore: -1 } },            // highest total first
      { $limit: limit },
      {
        $project: {
          _id:          0,
          username:     1,
          totalScore:   1,
          totalDeaths:  1,
          levelsPlayed: 1,
        }
      }
    ]);

    _lbCache.set(cacheKey, { data: scores, ts: Date.now() });
    console.log(`[Leaderboard] Aggregated ${scores.length} players (cached ${LB_CACHE_MS/1000}s)`);
    res.json({ ok: true, scores, cached: false });
  } catch (err) {
    console.error('[Leaderboard] Aggregate error:', err);
    res.status(500).json({ ok: false, scores: [], reason: 'Query failed' });
  }
});

// GET /api/leaderboard/my?level=N — logged-in user's own scores
app.get('/api/leaderboard/my', requireAuth, async (req, res) => {
  if (!dbConnected) return res.json({ ok: false, scores: [] });

  try {
    const query = { userId: req.user.sub };
    if (req.query.level !== undefined) query.levelId = parseInt(req.query.level);

    const scores = await Score.find(query)
      .select('levelId score deaths timeSec updatedAt -_id')
      .sort({ levelId: 1 })
      .lean();

    res.json({ ok: true, scores });
  } catch (err) {
    res.status(500).json({ ok: false, scores: [] });
  }
});

// ─── HEALTH CHECK ────────────────────────────
app.get('/health', (_, res) => {
  res.json({
    ok:        true,
    db:        dbConnected,
    rooms:     rooms.size,
    players:   totalPlayers(),
    uptime:    Math.floor(process.uptime()),
    mem:       Math.floor(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
  });
});

// ─── SELF-PING KEEP-ALIVE ────────────────────
if (SELF_PING_URL) {
  const keepAliveUrl = SELF_PING_URL + '/health';
  setInterval(() => {
    const proto = keepAliveUrl.startsWith('https') ? require('https') : require('http');
    proto.get(keepAliveUrl, () => {}).on('error', () => {});
  }, 13 * 60 * 1000);
  console.log(`[Keep-alive] → ${keepAliveUrl}`);
}

// ════════════════════════════════════════════════
//  MULTIPLAYER ROOMS (unchanged)
// ════════════════════════════════════════════════
const rooms = new Map();

function totalPlayers() {
  let n = 0; rooms.forEach(r => { n += r.players.size; }); return n;
}

function genRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  return rooms.has(code) ? genRoomCode() : code;
}

function getRoomBySocket(socketId) {
  for (const [, room] of rooms) if (room.players.has(socketId)) return room;
  return null;
}

function getNextSlot(room) {
  const used = new Set([...room.players.values()].map(p => p.slot));
  for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
  return -1;
}

function roomSummary(room) {
  return {
    code:    room.code,
    state:   room.state,
    players: [...room.players.values()].map(p => ({ socketId: p.socketId, name: p.name, slot: p.slot, ready: p.ready })),
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.size === 0 || now - room.createdAt > 3 * 60 * 60 * 1000) rooms.delete(code);
  }
}, 5 * 60 * 1000);

io.on('connection', socket => {
  console.log(`[+] ${socket.id} via ${socket.conn.transport.name} | rooms=${rooms.size}`);

  socket.on('room:create', ({ name }, ack) => {
    const code = genRoomCode();
    const room = { code, hostSocketId: socket.id, players: new Map(), state: 'lobby', levelOrder: [], createdAt: Date.now(), _stateSeq: 0 };
    room.players.set(socket.id, { socketId: socket.id, name: name || 'HOST', slot: 0, ready: true, alive: true });
    rooms.set(code, room);
    socket.join(code);
    console.log(`[Room] Created ${code} by ${name}`);
    ack({ ok: true, code, slot: 0, summary: roomSummary(room) });
  });

  socket.on('room:join', ({ code, name }, ack) => {
    const room = rooms.get(code?.toUpperCase());
    if (!room)                            return ack({ ok: false, reason: 'Room not found' });
    if (room.state !== 'lobby')           return ack({ ok: false, reason: 'Game already started' });
    if (room.players.size >= MAX_PLAYERS) return ack({ ok: false, reason: 'Room is full' });
    const slot = getNextSlot(room);
    room.players.set(socket.id, { socketId: socket.id, name: name || 'PLAYER', slot, ready: false, alive: true });
    socket.join(code);
    socket.to(code).emit('room:player_joined', { player: { socketId: socket.id, name: name || 'PLAYER', slot } });
    ack({ ok: true, code, slot, summary: roomSummary(room) });
  });

  socket.on('room:leave',  () => handleLeave(socket));

  socket.on('room:start', ({ levelOrder, mpOnlyMode, ropeEnabled }, ack) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.hostSocketId !== socket.id) return ack && ack({ ok: false });
    room.state = 'playing';
    room.levelOrder = levelOrder || [];
    io.to(room.code).emit('game:start', { levelOrder: room.levelOrder, mpOnlyMode: mpOnlyMode || false, ropeEnabled: ropeEnabled !== false, summary: roomSummary(room) });
    ack && ack({ ok: true });
  });

  socket.on('voice:offer',  ({ to, offer })     => io.to(to).emit('voice:offer',  { from: socket.id, offer }));
  socket.on('voice:answer', ({ to, answer })    => io.to(to).emit('voice:answer', { from: socket.id, answer }));
  socket.on('voice:ice',    ({ to, candidate }) => io.to(to).emit('voice:ice',    { from: socket.id, candidate }));
  socket.on('p2p:offer',   ({ to, offer })      => io.to(to).emit('p2p:offer',   { from: socket.id, offer }));
  socket.on('p2p:answer',  ({ to, answer })     => io.to(to).emit('p2p:answer',  { from: socket.id, answer }));
  socket.on('p2p:ice',     ({ to, candidate })  => io.to(to).emit('p2p:ice',     { from: socket.id, candidate }));

  let _relayCount = 0;
  socket.on('game:state', (payload) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.hostSocketId !== socket.id) return;
    room._stateSeq = (room._stateSeq + 1) & 0xFFFF;
    socket.to(room.code).emit('game:state', { ...payload, _seq: room._stateSeq });
    if (++_relayCount % 150 === 0) console.log(`[Relay] ${room.code} seq=${room._stateSeq}`);
  });

  socket.on('game:input',        (payload) => { const r = getRoomBySocket(socket.id); if (r) io.to(r.hostSocketId).emit('game:input', { ...payload, fromSocketId: socket.id }); });
  socket.on('game:event',        (payload) => { const r = getRoomBySocket(socket.id); if (r) io.to(r.code).emit('game:event', { ...payload, fromSocketId: socket.id }); });
  socket.on('game:request_sync', ()        => { const r = getRoomBySocket(socket.id); if (r) io.to(r.hostSocketId).emit('game:client_needs_sync', { clientId: socket.id }); });
  socket.on('ping:req',          ({ ts })  => socket.emit('ping:res', { ts }));
  socket.on('disconnect',        (reason)  => { console.log(`[-] ${socket.id}: ${reason}`); handleLeave(socket); });
});

function handleLeave(socket) {
  const room = getRoomBySocket(socket.id);
  if (!room) return;
  const player = room.players.get(socket.id);
  if (!player) return;
  room.players.delete(socket.id);
  socket.leave(room.code);
  if (room.players.size === 0) { rooms.delete(room.code); return; }
  if (room.hostSocketId === socket.id) {
    const newHost = [...room.players.values()].sort((a,b) => a.slot - b.slot)[0];
    room.hostSocketId = newHost.socketId;
    io.to(room.code).emit('room:new_host', { socketId: newHost.socketId, slot: newHost.slot });
  }
  io.to(room.code).emit('room:player_left', { socketId: socket.id, slot: player.slot, name: player.name, summary: roomSummary(room) });
}

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   LEVEL DEVIL — Server v3                ║
║   Port:   ${PORT.toString().padEnd(30)}║
║   DB:     ${dbConnected ? 'MongoDB Atlas ✓' : 'Not connected (set MONGODB_URI)'}${' '.repeat(Math.max(0,19-(dbConnected?15:30)))}║
║   Auth:   JWT (30d tokens)               ║
╚══════════════════════════════════════════╝
  `);
});