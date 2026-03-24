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
