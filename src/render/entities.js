function drawDoor(lvl) {
  const locked = lvl.door.locked && key && !key.collected;
  const dx = door.x, dy = door.y;
  const dw = door.w, dh = door.h;
  const pulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.004);

  // â”€â”€ Pixel-art Level Devil door â”€â”€
  // Background fill
  ctx.fillStyle = locked ? '#3a1a00' : '#0a2a0a';
  ctx.fillRect(dx, dy, dw, dh);

  // Arch shape (rounded top)
  const archR = dw / 2;
  const archTopY = dy + archR;
  ctx.beginPath();
  ctx.arc(dx + dw/2, archTopY, archR, Math.PI, 0, false);
  ctx.lineTo(dx + dw, dy + dh);
  ctx.lineTo(dx, dy + dh);
  ctx.closePath();
  ctx.fillStyle = locked ? '#5a2800' : '#145014';
  ctx.fill();

  // Door panels (pixel art detail)
  if (!locked) {
    ctx.fillStyle = '#1a6a1a';
    const pw = dw * 0.35, ph = dh * 0.25;
    ctx.fillRect(dx + 4,      dy + dh*0.4, pw, ph);
    ctx.fillRect(dx + dw - pw - 4, dy + dh*0.4, pw, ph);
    ctx.fillRect(dx + 4,      dy + dh*0.7, dw-8, ph * 0.6);
  }

  // Outer frame â€” pixel thick border
  const frameColor = locked ? '#ff8800' : `rgba(80,255,120,${pulse})`;
  ctx.strokeStyle = frameColor;
  ctx.lineWidth = 3;
  // Arch border
  ctx.beginPath();
  ctx.arc(dx + dw/2, archTopY, archR - 1, Math.PI, 0, false);
  ctx.lineTo(dx + dw - 1, dy + dh);
  ctx.moveTo(dx + 1, dy + dh);
  ctx.lineTo(dx + 1, archTopY);
  ctx.stroke();
  // Bottom line
  ctx.strokeStyle = locked ? '#cc6600' : '#40cc60';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(dx, dy + dh);
  ctx.lineTo(dx + dw, dy + dh);
  ctx.stroke();

  // Glow
  ctx.shadowColor = locked ? '#ff8800' : '#40ff60';
  ctx.shadowBlur = 12 * pulse;
  ctx.strokeStyle = locked ? '#ff8800' : '#40ff60';
  ctx.lineWidth = 1;
  ctx.strokeRect(dx, dy, dw, dh);
  ctx.shadowBlur = 0;

  // Knob
  const knobX = dx + dw/2, knobY = dy + dh * 0.72;
  ctx.beginPath();
  ctx.arc(knobX, knobY, 5, 0, Math.PI * 2);
  ctx.fillStyle = locked ? '#ff8800' : '#90ff90';
  ctx.fill();
  ctx.strokeStyle = locked ? '#cc5500' : '#40cc40';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Lock overlay
  if (locked) {
    ctx.fillStyle = '#ff8800';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🔒', dx + dw/2, dy + dh*0.55);
    ctx.textAlign = 'left';
  } else {
    // Animated arrow pointing into door
    const arrowPulse = Math.floor(Date.now() / 300) % 3;
    ctx.fillStyle = `rgba(180,255,180,${0.3 + arrowPulse * 0.2})`;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('▶', dx + dw/2, dy + dh*0.85);
    ctx.textAlign = 'left';
  }
}

function drawKey() {
  if (!key || key.collected) return;
  const t = Date.now() / 400;
  const bobY = Math.sin(t) * 4;

  ctx.save();
  ctx.translate(key.x + key.w/2, key.y + key.h/2 + bobY);

  // Glow
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur  = 16;

  // Key body
  ctx.beginPath();
  ctx.arc(0, -4, 8, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth   = 3;
  ctx.stroke();

  ctx.fillStyle = '#ffd700';
  ctx.fillRect(-2, 0, 4, 12);
  ctx.fillRect(-2, 4, 8, 3);
  ctx.fillRect(-2, 8, 6, 3);

  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawParticles() {
  particles.forEach(p => {
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = p.color;
    ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
  });
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  const x = player.x, y = player.y;
  const flip = player.gravityFlipped;

  if (player.invincible && Math.floor(Date.now() / 80) % 2 === 0) return;

  ctx.save();
  ctx.translate(x + PLAYER_W/2, y + PLAYER_H/2);
  if (player.facing === -1) ctx.scale(-1, 1);
  if (flip) ctx.scale(1, -1);

  const hw = PLAYER_W / 2, hh = PLAYER_H / 2;

  // Speaking glow in multiplayer
  if (multiMode && isSpeaking(myPlayerIdx)) {
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur  = 14;
  }

  // "Being stood on" golden glow â€” another player is on your head
  if (multiMode && player._beingStoodOn > 0) {
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur  = 16;
  }

  // Body â€” colored by player slot in MP, white in solo
  ctx.fillStyle = multiMode ? PLAYER_COLORS[myPlayerIdx] : '#e8e8e8';
  ctx.fillRect(-hw, -hh, PLAYER_W, PLAYER_H);

  // Highlight stripe
  if (multiMode) {
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(-hw, -hh, PLAYER_W, 5);
  }

  ctx.shadowBlur = 0;

  // Face
  ctx.fillStyle = '#000';
  const eyeY = -hh + 8;
  ctx.fillRect(-hw + 6, eyeY, 5, 5);
  ctx.fillRect(hw - 11, eyeY, 5, 5);

  if (!player.onGround) {
    ctx.beginPath();
    ctx.arc(0, eyeY + 12, 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillRect(-6, eyeY + 12, 12, 3);
  }

  // Walking legs
  if (player.onGround && Math.abs(player.vx) > 0.5) {
    const legSwing = Math.sin(player.animFrame * Math.PI / 2) * 5;
    ctx.fillStyle = multiMode ? PLAYER_DARK[myPlayerIdx] : '#888';
    ctx.fillRect(-hw, hh - 8, 10, 8 + legSwing);
    ctx.fillRect(hw - 10, hh - 8, 10, 8 - legSwing);
  }

  ctx.restore();

  // Name tag in multiplayer
  if (multiMode) {
    ctx.save();
    ctx.font = '7px monospace';
    ctx.fillStyle = PLAYER_COLORS[myPlayerIdx];
    ctx.textAlign = 'center';
    const localTag = currentRoomMode === 'pvp' ? (myTeam === 'team2' ? 'T2 ' : 'T1 ') : '';
    ctx.fillText(localTag + playerName + ' (YOU)', x + PLAYER_W/2, y - 6);
    if (currentRoomMode === 'pvp') {
      ctx.fillStyle = myTeam === 'team2' ? '#ff9b6b' : '#6bc5ff';
      ctx.fillText(myTeam === 'team2' ? 'T2' : 'T1', x + PLAYER_W/2, y - 18);
    }
    ctx.textAlign = 'left';
    ctx.restore();
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
