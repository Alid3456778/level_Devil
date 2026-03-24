//  AUTH SYSTEM â€” JWT + MongoDB via REST API
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const AUTH_TOKEN_KEY = 'ld_auth_token';
let _authToken    = null;
let _authUsername = null;
let _authUserId   = null;
let _authEmail    = null;

function _authSaveToken(token, username, userId, email = null) {
  _authToken    = token;
  _authUsername = username;
  _authUserId   = userId;
  _authEmail    = email || null;
  try { localStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify({ token, username, userId, email: _authEmail })); } catch {}
  refreshModeAccountUI();
}

function _authClearToken() {
  _authToken = _authUsername = _authUserId = _authEmail = null;
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
  const u = (document.getElementById('liUsername')?.value || '').trim() || 'GUEST';
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
  const medals = ['ðŸ¥‡', 'ðŸ¥ˆ', 'ðŸ¥‰'];
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
      <div class="lb-deaths">${s.totalDeaths || 0}ðŸ’€</div>
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
