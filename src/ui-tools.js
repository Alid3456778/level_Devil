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
