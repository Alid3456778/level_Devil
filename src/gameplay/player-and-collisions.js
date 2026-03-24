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

