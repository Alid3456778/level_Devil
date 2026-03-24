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

