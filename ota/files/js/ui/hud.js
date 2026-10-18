/* ============ hud.js — interfaz dentro del canvas ============
 * Se dibuja en coordenadas de PANTALLA (sin la transformación de cámara).
 */
G.HUD = (() => {
  const F = (w, s) => `${w} ${s}px Pixelify,"Segoe UI",system-ui,sans-serif`;

  // Sprites de megapiedras (PNG de PokeAPI): caché perezosa para el chip de mega.
  const stoneImgs = {};
  function stoneImg(src) {
    let im = stoneImgs[src];
    if (!im) { im = new Image(); im.src = src; stoneImgs[src] = im; }
    return im.complete && im.naturalWidth ? im : null;
  }

  let tapTip = null;               // táctil: { i, until } hueco de habilidad tocado
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function bar(ctx, x, y, w, h, frac, col, bg = 'rgba(0,0,0,.55)') {
    roundRect(ctx, x, y, w, h, h / 2); ctx.fillStyle = bg; ctx.fill();
    if (frac > 0) {
      ctx.save();
      roundRect(ctx, x, y, w, h, h / 2); ctx.clip();
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w * G.U.clamp(frac, 0, 1), h);
      ctx.restore();
    }
  }

  /** Alcance legible según cómo funcione el movimiento. */
  function rangeText(m) {
    switch (m.kind) {
      case 'melee': return 'Corto alcance · radio ' + Math.round(m.radius);
      case 'projectile': return 'Distancia · alcance ~' + Math.round(m.speed * m.life);
      case 'beam': return 'Rayo que atraviesa · largo ' + Math.round(m.radius);
      case 'nova': return 'Radial · ' + m.count + ' disparos';
      case 'aura': return 'A tu alrededor · radio ' + Math.round(m.radius);
      case 'orbit': return 'Orbes · radio ' + Math.round(m.radius);
      case 'buff': return 'Apoyo · sin daño';
      case 'boomerang': return 'Ida y vuelta · ' + Math.round(m.radius);
      case 'chain': return 'Salta ×' + m.count + ' enemigos';
      case 'mine': return 'Trampa en el suelo · ' + m.count;
      case 'meteor': return 'Desde el cielo · ' + m.count;
      case 'turret': return 'Torreta ' + m.dur + ' s';
      case 'dash': return 'Cruce · ' + Math.round(m.radius);
      case 'trail': return 'Rastro ' + m.dur + ' s';
      case 'cone': return 'Abanico corto';
      default: return '';
    }
  }

  function wrapLines(ctx, text, maxW, maxLines) {
    const lines = [];
    let line = '';
    for (const wd of String(text).split(' ')) {
      const t = line ? line + ' ' + wd : wd;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = wd; }
      else line = t;
      if (lines.length >= maxLines) break;
    }
    if (line && lines.length < maxLines) lines.push(line);
    return lines;
  }

  /** Tooltip de un hueco: icono, nombre, descripción y alcance. g = grupo (vínculo o normal). */
  function drawTip(ctx, w, h, mx, my, g) {
    const m = g[0];
    const col = G.U.TYPE_COLOR[m.type];
    const title = g.length > 1 ? g.map(x => x.name).join(' + ') : m.name + ' Nv.' + m.lvl;
    const desc = m.desc || (G.Moves.BY_ID[m.id] || {}).desc || '';
    const rg = rangeText(m);
    ctx.font = F(800, 12);
    const titleW = ctx.measureText(title).width;
    ctx.font = F(700, 11);
    const lines = wrapLines(ctx, desc, 220, 3);
    const linesW = lines.reduce((a, l) => Math.max(a, ctx.measureText(l).width), 0);
    const rangeW = ctx.measureText(rg).width;
    const bw = Math.min(w - 16, Math.max(titleW, linesW, rangeW) + 52);
    const bh = 48 + lines.length * 14;
    let bx = Math.min(Math.max(8, mx + 14), w - bw - 8);
    let by = my - bh - 12;
    if (by < 8) by = my + 66;
    ctx.save();
    roundRect(ctx, bx, by, bw, bh, 9);
    ctx.fillStyle = 'rgba(8,14,28,.94)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.stroke();
    G.Icons.draw(ctx, 'move:' + m.id, bx + 8, by + 8, 28);
    ctx.textAlign = 'left';
    ctx.font = F(800, 12);
    ctx.fillStyle = '#fff';
    ctx.fillText(title, bx + 42, by + 20);
    ctx.font = F(700, 11);
    ctx.fillStyle = 'rgba(220,232,248,.85)';
    lines.forEach((l, i) => ctx.fillText(l, bx + 42, by + 36 + i * 14));
    ctx.fillStyle = col;
    ctx.fillText(rg, bx + 42, by + 36 + lines.length * 14);
    ctx.restore();
  }

  function draw(ctx, w, h, pl, st) {
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    G.Touch.clearButtons();
    const touch = G.Touch.active;

    // ---------- barra de experiencia (borde superior) ----------
    const xpF = pl.xp / pl.xpNext;
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(0, 0, w, 7);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#4fd1ff'); g.addColorStop(1, '#a98bff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w * G.U.clamp(xpF, 0, 1), 7);

    // ---------- vida + nivel ----------
    const px = 16, py = 20;
    ctx.font = F(800, 13);
    ctx.fillStyle = '#eaf2ff';
    ctx.textAlign = 'left';
    ctx.fillText(pl.mon.name, px, py + 10);

    ctx.font = F(700, 11);
    ctx.fillStyle = '#ffcb3d';
    ctx.fillText('Nv. ' + pl.level, px, py + 26);

    bar(ctx, px + 48, py + 17, 168, 11, pl.hp / pl.maxHp, '#ff5f6d');
    ctx.font = F(700, 10);
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.textAlign = 'center';
    ctx.fillText(Math.ceil(pl.hp) + ' / ' + Math.round(pl.maxHp), px + 48 + 84, py + 26);

    // buffs activos
    const COL = { atk: '#ff6b4d', spd: '#7fe0ff', def: '#b0b8c8', regen: '#5fe08a' };
    const LBL = { atk: 'ATK', spd: 'VEL', def: 'DEF', regen: 'REG' };
    let bx = px;
    ctx.textAlign = 'left';
    for (const k in pl.buffs) {
      const b = pl.buffs[k];
      if (b.n <= 0) continue;
      ctx.font = F(800, 9);
      const txt = LBL[k] + ' ×' + b.n;
      const tw = ctx.measureText(txt).width + 12;
      roundRect(ctx, bx, py + 34, tw, 15, 7);
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fill();
      ctx.fillStyle = COL[k];
      ctx.fillText(txt, bx + 6, py + 45);
      bx += tw + 5;
    }

    // ---------- reloj / bioma / kills ----------
    ctx.textAlign = 'center';
    ctx.font = F(800, 26);
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.fillText(G.U.mmss(st.time), w / 2, 42);
    ctx.font = F(600, 10);
    ctx.fillStyle = '#8fa3c4';
    ctx.fillText(G.World.biomeName().toUpperCase() + '  ·  ' + pl.kills + ' DERROTADOS  ·  ' + pl.coins + ' MONEDAS' + (G.Game.runMode === 'random' ? '  ·  RANDOM' : ''), w / 2, 58);

    // ---------- monedas y tickets de esta run (arriba a la derecha) ----------
    {
      ctx.font = F(800, 12);
      const items = [{ icon: 'coin', txt: pl.coins.toLocaleString('es'), col: '#ffd23f' }];
      if (pl.t1 > 0) items.push({ icon: 'ticket', txt: '×' + pl.t1, col: '#ffd23f' });
      if (pl.t10 > 0) items.push({ icon: 'ticket10', txt: '×' + pl.t10, col: '#d9a6ff' });
      let tw = 22;
      for (const it of items) tw += 22 + ctx.measureText(it.txt).width + 8;
      const x0 = w - tw - 16 - (touch ? 56 : 0), y0 = 12;
      roundRect(ctx, x0, y0, tw, 26, 9);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,210,63,.5)'; ctx.stroke();
      ctx.textAlign = 'left';
      let ix = x0 + 11;
      for (const it of items) {
        G.Icons.draw(ctx, it.icon, ix, y0 + 4, 18);
        ix += 22;
        ctx.fillStyle = it.col;
        ctx.fillText(it.txt, ix, y0 + 17);
        ix += ctx.measureText(it.txt).width + 8;
      }
    }

    // ---------- clima (arriba a la derecha, debajo de las monedas) ----------
    const wx = G.Weather.current;
    if (wx) {
      ctx.font = F(800, 11);
      ctx.textAlign = 'left';
      const txt = wx.name.toUpperCase() + ' · ' + Math.ceil(wx.left) + 's';
      const tw = ctx.measureText(txt).width + 40;
      const x0 = w - tw - 16 - (touch ? 56 : 0), y0 = 42;
      roundRect(ctx, x0, y0, tw, 26, 9);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill();
      G.Icons.draw(ctx, wx.icon, x0 + 6, y0 + 3, 20);
      ctx.fillStyle = wx.color;
      ctx.fillText(txt, x0 + 32, y0 + 17);
    }

    // ---------- minimapa (arriba a la derecha, bajo el clima) ----------
    if (G.Minimap) G.Minimap.draw(ctx, w, h, pl, touch);

    // ---------- barra del jefe ----------
    const boss = G.EnemyMgr.all().find(e => e.boss && !e.dead);
    if (boss) {
      const bw = Math.min(420, w - 80);
      bar(ctx, (w - bw) / 2, 70, bw, 12, boss.hp / boss.maxHp, '#ffcb3d');
      ctx.font = F(800, 10);
      ctx.fillStyle = '#20160a';
      ctx.fillText(boss.name.toUpperCase(), w / 2, 80);
    }

    // ---------- aviso ----------
    // ---------- shinies fuera de pantalla: destello en el borde ----------
    const cam = G.Camera, pulse = 0.6 + Math.sin(performance.now() / 160) * 0.4;
    for (const e of G.EnemyMgr.shinies()) {
      const sx = (e.x - cam.left()) * cam.scale, sy = (e.y - cam.top()) * cam.scale;
      if (sx > 0 && sx < w && sy > 0 && sy < h) continue;
      const M = 34;
      const ex = G.U.clamp(sx, M, w - M), ey = G.U.clamp(sy, M + 60, h - M - 70);
      const a = Math.atan2(sy - ey, sx - ex);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.translate(ex, ey);
      ctx.fillStyle = '#9ae6ff';
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 24, Math.sin(a) * 24);
      ctx.lineTo(Math.cos(a + 2.5) * 12, Math.sin(a + 2.5) * 12);
      ctx.lineTo(Math.cos(a - 2.5) * 12, Math.sin(a - 2.5) * 12);
      ctx.fill();
      ctx.globalAlpha = 1;
      G.Icons.draw(ctx, 'shiny', -12, -12, 24);
      ctx.restore();
    }

    // Élites con aura fuera de pantalla: flecha morada con corona en el borde.
    for (const e of G.EnemyMgr.elites()) {
      const sx = (e.x - cam.left()) * cam.scale, sy = (e.y - cam.top()) * cam.scale;
      if (sx > 0 && sx < w && sy > 0 && sy < h) continue;
      const M = 34;
      const ex = G.U.clamp(sx, M, w - M), ey = G.U.clamp(sy, M + 60, h - M - 70);
      const a = Math.atan2(sy - ey, sx - ex);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.translate(ex, ey);
      ctx.fillStyle = '#c47bff';
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 24, Math.sin(a) * 24);
      ctx.lineTo(Math.cos(a + 2.5) * 12, Math.sin(a + 2.5) * 12);
      ctx.lineTo(Math.cos(a - 2.5) * 12, Math.sin(a - 2.5) * 12);
      ctx.fill();
      ctx.globalAlpha = 1;
      G.Icons.draw(ctx, 'crown', -12, -12, 24);
      ctx.restore();
    }

    // Comerciante Kecleon fuera de pantalla: flecha dorada con moneda.
    const mk = G.Merchant.arrow();
    if (mk) {
      const sx = (mk.x - cam.left()) * cam.scale, sy = (mk.y - cam.top()) * cam.scale;
      if (!(sx > 0 && sx < w && sy > 0 && sy < h)) {
        const M = 34;
        const ex = G.U.clamp(sx, M, w - M), ey = G.U.clamp(sy, M + 60, h - M - 70);
        const a = Math.atan2(sy - ey, sx - ex);
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.translate(ex, ey);
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 24, Math.sin(a) * 24);
        ctx.lineTo(Math.cos(a + 2.5) * 12, Math.sin(a + 2.5) * 12);
        ctx.lineTo(Math.cos(a - 2.5) * 12, Math.sin(a - 2.5) * 12);
        ctx.fill();
        ctx.globalAlpha = 1;
        G.Icons.draw(ctx, 'coin', -12, -12, 24);
        ctx.restore();
      }
    }

    // Poder de altar activo.
    if (pl.power) {
      const pw = pl.power, txt = pw.def.name.toUpperCase() + ' ' + Math.ceil(pw.t) + 's';
      ctx.font = F(800, 9);
      ctx.textAlign = 'left';
      const tw = ctx.measureText(txt).width + 12;
      roundRect(ctx, bx, py + 34, tw, 15, 7);
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fill();
      ctx.fillStyle = pw.def.color;
      ctx.fillText(txt, bx + 6, py + 45);
      bx += tw + 5;
    }

    if (G.Coop.active) drawCoop(ctx, w, h, pl, px, py + (bx > px ? 56 : 40));

    // Grieta: flecha grande que late en el borde si no se ve, y si se ve, una
    // flecha que bota encima; en la arena, cuenta atrás.
    const rift = G.Rift.rift;
    if (rift) {
      const sx = (rift.x - cam.left()) * cam.scale, sy = (rift.y - 40 - cam.top()) * cam.scale;
      const now = performance.now() / 1000, beat = 0.5 + Math.sin(now * 7) * 0.5;
      const label = 'GRIETA · ' + Math.round(G.U.dist(pl.x, pl.y, rift.x, rift.y) / 32) + ' m · ' + Math.ceil(rift.ttl) + ' s';
      const off = sx < 0 || sx > w || sy < 0 || sy > h;
      ctx.save();
      if (off) {
        const M = 52, ex = G.U.clamp(sx, M, w - M), ey = G.U.clamp(sy, M + 70, h - M - 80);
        const a = Math.atan2(sy - ey, sx - ex), ca = Math.cos(a), sa = Math.sin(a);
        ctx.translate(ex, ey);
        // Halo que late.
        ctx.globalAlpha = 0.18 + beat * 0.22;
        ctx.fillStyle = '#b48aff';
        ctx.beginPath(); ctx.arc(0, 0, 30 + beat * 8, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 1;
        const tri = (k) => {
          ctx.beginPath();
          ctx.moveTo(ca * 40 * k, sa * 40 * k);
          ctx.lineTo(Math.cos(a + 2.45) * 20 * k, Math.sin(a + 2.45) * 20 * k);
          ctx.lineTo(Math.cos(a - 2.45) * 20 * k, Math.sin(a - 2.45) * 20 * k);
          ctx.closePath();
        };
        tri(1.12); ctx.fillStyle = '#1a0b33'; ctx.fill();
        tri(1); ctx.fillStyle = beat > 0.5 ? '#e2d0ff' : '#a06bff'; ctx.fill();
        ctx.font = F(800, 12);
        ctx.textAlign = ca > 0.3 ? 'right' : ca < -0.3 ? 'left' : 'center';
        const lx = -ca * 34, ly = -sa * 30 + 4;
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.85)';
        ctx.strokeText(label, lx, ly);
        ctx.fillStyle = '#e2d0ff';
        ctx.fillText(label, lx, ly);
      } else {
        // Encima de la grieta: flecha hacia abajo que bota.
        const by = sy - 46 - Math.abs(Math.sin(now * 4)) * 10;
        ctx.translate(sx, by);
        ctx.beginPath(); ctx.moveTo(-15, -12); ctx.lineTo(15, -12); ctx.lineTo(0, 8); ctx.closePath();
        ctx.lineWidth = 4; ctx.strokeStyle = '#1a0b33'; ctx.stroke();
        ctx.fillStyle = beat > 0.5 ? '#e2d0ff' : '#a06bff'; ctx.fill();
        ctx.font = F(800, 11); ctx.textAlign = 'center';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.85)';
        const l2 = 'GRIETA · ' + Math.ceil(rift.ttl) + ' s';
        ctx.strokeText(l2, 0, -18); ctx.fillStyle = '#e2d0ff'; ctx.fillText(l2, 0, -18);
      }
      ctx.restore();
    }
    if (G.Rift.inArena) {
      ctx.textAlign = 'center';
      ctx.font = F(800, 12);
      ctx.fillStyle = '#d9c2ff';
      ctx.fillText('GRIETA · ' + G.U.mmss(G.Rift.timeLeft), w / 2, boss ? 98 : 76);
    }

    // Eventos: cuenta atrás, flecha al Pokémon perdido / a la marca y a los duendes.
    G.Events.drawHud(ctx, w, h, pl, F);

    // Aviso propio al abrirse una grieta (no lo tapan los otros avisos).
    if (rift && rift.t < 4.5) {
      const a = Math.min(1, rift.t * 4, (4.5 - rift.t) * 2), pop = 1 + Math.max(0, 0.25 - rift.t) * 1.6;
      const y0 = h * 0.2;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(w / 2, y0); ctx.scale(pop, pop);
      ctx.font = F(800, 20);
      const t1 = '¡SE HA ABIERTO UNA GRIETA!', t2 = 'Sigue la flecha morada: dentro te espera un legendario';
      const bw = Math.min(w - 24, Math.max(ctx.measureText(t1).width, (ctx.font = F(700, 11), ctx.measureText(t2).width)) + 36);
      roundRect(ctx, -bw / 2, -26, bw, 52, 10);
      ctx.fillStyle = 'rgba(26,11,51,.88)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#b48aff'; ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = F(800, 20); ctx.fillStyle = '#e2d0ff'; ctx.fillText(t1, 0, -2);
      ctx.font = F(700, 11); ctx.fillStyle = '#c9b0ff'; ctx.fillText(t2, 0, 16);
      ctx.restore();
    }

    // Aviso GRANDE al llegar el Kecleon (no lo tapa ningún otro aviso).
    const mSay = G.Merchant.announce();
    if (mSay > 0) {
      const a = Math.min(1, mSay * 2, (4.5 - mSay) * 1.5), pop = 1 + Math.max(0, 0.3 - (4.5 - mSay)) * 1.2;
      const y0 = h * 0.32;
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.translate(w / 2, y0); ctx.scale(pop, pop);
      ctx.font = F(800, 20);
      const t1 = '¡KECLEON COMERCIANTE!', t2 = 'Sigue la flecha dorada: cura, objetos, poderes y evoluciones';
      const bw = Math.min(w - 24, Math.max(ctx.measureText(t1).width, (ctx.font = F(700, 11), ctx.measureText(t2).width)) + 36);
      roundRect(ctx, -bw / 2, -26, bw, 52, 10);
      ctx.fillStyle = 'rgba(40,26,6,.9)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#ffd23f'; ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = F(800, 20); ctx.fillStyle = '#ffe9a0'; ctx.fillText(t1, 0, -2);
      ctx.font = F(700, 11); ctx.fillStyle = '#e8c86a'; ctx.fillText(t2, 0, 16);
      ctx.restore();
    }

    const ban = G.Spawner.banner();
    if (ban) {
      const a = Math.min(1, ban.t * 1.6);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = F(800, 22);
      ctx.fillStyle = '#ffcb3d';
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 4;
      ctx.strokeText(ban.text, w / 2, h * 0.3);
      ctx.fillText(ban.text, w / 2, h * 0.3);
      ctx.restore();
    }

    // ---------- ranura de movimientos ----------
    const S = 54, GAP = 9;
    const n = Math.max(1, pl.slots.length);
    const totalW = n * S + (n - 1) * GAP;
    let sx = (w - totalW) / 2;
    // Por encima de la barra de inicio del iPhone (allí los toques a veces no llegan).
    const sy = h - S - 18 - (touch ? Math.min(28, G.Touch.safeArea().bottom) : 0);
    const BOND = '#ff8ad8';
    const cdOf = m => m.kind === 'orbit' ? 0 : G.U.clamp(m.t / (m.cd * pl.cdMul), 0, 1);
    const slotRects = [];

    for (let i = 0; i < n; i++) {
      const g = pl.slots[i] || [];
      const m = g[0];
      const fused = g.length > 1;
      const on = i === pl.active;
      const x = sx + i * (S + GAP);
      const y = on ? sy - 6 : sy;
      slotRects.push({ x, y, g });
      // Tocar (o hacer clic en) un icono activa ese movimiento.
      if (m) G.Touch.addButton(x, y, S, S, () => {
        if (G.Game.state !== 'playing') return;
        if (pl.active !== i) { pl.setActive(i); G.Audio.sfx('click'); }
        tapTip = { i, until: performance.now() + 3500 };            // tocar = ver su tooltip
      }, GAP / 2 + 3);
      const col = m ? G.U.TYPE_COLOR[m.type] : '#4a5468';

      // fondo
      roundRect(ctx, x, y, S, S, 12);
      ctx.fillStyle = on ? 'rgba(20,30,50,.95)' : 'rgba(10,16,28,.8)';
      ctx.fill();
      ctx.lineWidth = on ? 2.5 : fused || (m && m.evolved) ? 2 : 1.2;
      // Vínculo: borde rosa. Evolucionado: dorado.
      ctx.strokeStyle = fused ? BOND : m && m.evolved ? '#ffd23f' : on ? col : 'rgba(140,170,210,.22)';
      ctx.stroke();

      if (!m) continue;

      if (fused) {
        // Vínculo: los movimientos en cuadrícula (2×2, o 3×2 con Fusión amplia).
        const cols = g.length > 4 ? 3 : 2;
        const C = cols === 3 ? 15 : 22, P = (S - C * cols) / (cols + 1);
        g.forEach((gm, k) => {
          const cx = x + P + (k % cols) * (C + P), cy = y + P + Math.floor(k / cols) * (C + P);
          G.Icons.draw(ctx, 'move:' + gm.id, cx, cy, C);
          const f = cdOf(gm);
          if (f > 0) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(cx, cy, C, C * f); }
          if (gm.evolved) { ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 1; ctx.strokeRect(cx + 0.5, cy + 0.5, C - 1, C - 1); }
          // Destello al lanzarse.
          const fl = 1 - (performance.now() - (gm.castAt || 0)) / 180;
          if (fl > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (fl * 0.55).toFixed(2) + ')'; ctx.fillRect(cx, cy, C, C); }
        });
      } else {
        // recarga: se vacía de abajo a arriba
        const cdFrac = cdOf(m);
        if (cdFrac > 0) {
          ctx.save();
          roundRect(ctx, x, y, S, S, 12); ctx.clip();
          ctx.fillStyle = 'rgba(0,0,0,.6)';
          ctx.fillRect(x, y, S, S * cdFrac);
          ctx.restore();
        }

        // emblema del tipo + insignia de la familia
        G.Icons.draw(ctx, 'move:' + m.id, x + (S - 32) / 2, y + (S - 32) / 2 - 2, 32);

        // nivel del movimiento (puntitos)
        const dots = m.def.maxLvl;
        const dw = 4, dgap = 2;
        const tw = dots * dw + (dots - 1) * dgap;
        for (let d = 0; d < dots; d++) {
          ctx.fillStyle = d < m.lvl ? col : 'rgba(255,255,255,.18)';
          ctx.fillRect(x + (S - tw) / 2 + d * (dw + dgap), y + S - 9, dw, 3);
        }
      }

      // tecla
      ctx.font = F(800, 9);
      ctx.fillStyle = fused ? BOND : on ? col : 'rgba(180,200,230,.6)';
      ctx.textAlign = 'left';
      ctx.fillText(String(i + 1), x + 3, y + 10);

      // nombre encima del activo (con un vínculo: "Ascuas +2")
      if (on) {
        ctx.font = F(700, 10);
        ctx.textAlign = 'center';
        ctx.fillStyle = fused ? BOND : col;
        ctx.fillText(fused ? m.name + ' +' + (g.length - 1) : m.name, x + S / 2, y - 7);
      }
    }

    // ---------- tooltip de habilidad (ratón sobre un hueco, sólo PC) ----------
    if (touch && G.Game.state === 'playing' && tapTip && performance.now() < tapTip.until) {
      const r = slotRects[tapTip.i];
      if (r && r.g && r.g[0]) drawTip(ctx, w, h, r.x + S / 2, r.y, r.g);
    }
    if (!touch && G.Game.state === 'playing') {
      const ms = G.Input.mouse();
      const hitR = slotRects.find(r => ms.x >= r.x && ms.x <= r.x + S && ms.y >= r.y && ms.y <= r.y + S);
      const hm = hitR && hitR.g && hitR.g[0];
      if (hm) drawTip(ctx, w, h, ms.x, ms.y, hitR.g);
    }

    // ---------- dúo: botón y sus habilidades encima de las tuyas ----------
    {
      const dv = G.Duo.view();
      const R2m = touch ? 26 : 18;
      let rx = sx + totalW + 18;
      if (pl.bonds > 0) rx += 38;
      if (!pl.dead && G.Sprites.hasMega(pl.dex)) rx += R2m * 2 + 12;
      if (dv) {
        const dcx = rx + 12, dcy = sy + S / 2, dr = 12;
        G.Touch.addButton(dcx - dr, dcy - dr, dr * 2, dr * 2, () => { G.Duo.toggleView(); }, 8);
        ctx.save();
        ctx.beginPath(); ctx.arc(dcx, dcy, dr, 0, 6.2832);
        ctx.fillStyle = G.Duo.showView ? 'rgba(20,40,60,.9)' : 'rgba(10,16,28,.6)'; ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = G.Duo.showView ? '#9fd8ff' : 'rgba(140,170,210,.4)'; ctx.stroke();
        G.Icons.draw(ctx, 'friends', dcx - 8, dcy - 8, 16);
        ctx.restore();
      }
      if (dv && G.Duo.showView) {
        const S2 = touch ? 44 : 38, G2 = 6;
        const widths = dv.groups.map(g => 10 + g.length * 24 + 8);
        const totalW2 = widths.reduce((a, b) => a + b, 0) + G2 * (widths.length - 1);
        let gx = (w - totalW2) / 2;
        const gy = sy - 6 - 8 - S2 - 6;
        ctx.save();
        ctx.font = F(700, 10);
        ctx.textAlign = 'center';
        ctx.fillStyle = dv.down ? '#9aa6b5' : '#9fd8ff';
        ctx.fillText(dv.name + ' Nv.' + pl.level + (dv.down ? ' (caído)' : ''), w / 2, gy - 6);
        dv.groups.forEach((g, gi) => {
          const gw = widths[gi];
          const isOn = g === dv.active;
          roundRect(ctx, gx, gy, gw, S2, 8);
          ctx.fillStyle = 'rgba(10,16,28,.8)'; ctx.fill();
          ctx.lineWidth = isOn ? 2 : 1;
          ctx.strokeStyle = isOn ? '#9fd8ff' : 'rgba(140,170,210,.25)'; ctx.stroke();
          g.forEach((gm, k) => {
            const C = 22, cx = gx + 9 + k * 24, cy = gy + 6;
            G.Icons.draw(ctx, 'move:' + gm.id, cx, cy, C);
            const f = gm.kind === 'orbit' ? 0 : G.U.clamp(gm.t / (gm.cd * (dv.cdMul || 1)), 0, 1);
            if (f > 0) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(cx, cy, C, C * f); }
          });
          ctx.font = F(800, 8);
          ctx.fillStyle = 'rgba(180,200,230,.75)';
          ctx.fillText('Nv.' + Math.max.apply(null, g.map(m => m.lvl)), gx + gw / 2, gy + S2 - 4);
          gx += gw + G2;
        });
        ctx.restore();
      }
    }

    // ---------- vínculo guardado (aún no hay dos movimientos sueltos) ----------
    if (pl.bonds > 0) {
      const bx = sx + totalW + 12, by = sy + S / 2 - 12;
      G.Icons.draw(ctx, 'bond', bx, by, 24);
      if (pl.bonds > 1) {
        ctx.font = F(800, 10);
        ctx.textAlign = 'left';
        ctx.fillStyle = BOND;
        ctx.fillText('×' + pl.bonds, bx + 25, by + 20);
      }
    }

    // ---------- objeto equipado (a la izquierda de los movimientos) ----------
    {
      const ix = sx - S - 18, iy = sy;
      roundRect(ctx, ix, iy, S, S, 12);
      ctx.fillStyle = pl.item ? 'rgba(40,30,10,.9)' : 'rgba(10,16,28,.55)';
      ctx.fill();
      ctx.lineWidth = pl.item ? 2 : 1;
      ctx.strokeStyle = pl.item ? '#ffd23f' : 'rgba(140,170,210,.18)';
      ctx.stroke();
      if (pl.item) {
        G.Icons.draw(ctx, pl.item, ix + (S - 36) / 2, iy + (S - 36) / 2, 36);
        ctx.font = F(700, 9);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd23f';
        ctx.fillText(G.Items.BY[pl.item].name, ix + S / 2, iy - 6);
      }
    }

    // ---------- esquive (Shift / Espacio, o botón táctil) ----------
    {
      const DCD = G.Player.DODGE_CD, left = Math.max(0, pl.dodgeCd || 0);
      const ready = left <= 0 && !pl.dead;
      const R2 = touch ? 30 : 20;
      const sa = touch ? G.Touch.safeArea() : null;
      const cx = touch ? w - R2 - 16 - Math.min(44, sa.right)
                       : sx - S - 18 - R2 - 14;
      const cy = touch ? sy - R2 - 14
                       : sy + S / 2;
      if (G.Game.state === 'playing' && !pl.dead)
        G.Touch.addButton(cx - R2, cy - R2, R2 * 2, R2 * 2, () => { pl.tryDodge(); }, 8);
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R2, 0, 6.2832);
      ctx.fillStyle = ready ? 'rgba(20,40,60,.85)' : 'rgba(10,16,28,.7)'; ctx.fill();
      ctx.lineWidth = ready ? 2.5 : 1.5;
      ctx.strokeStyle = ready ? '#7fe0ff' : 'rgba(140,170,210,.35)'; ctx.stroke();
      if (!ready) {
        // Se vacía en el sentido del reloj hasta estar listo.
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R2, -Math.PI / 2, -Math.PI / 2 + 6.2832 * (left / DCD));
        ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill();
        ctx.font = F(800, touch ? 13 : 10);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#cfe6ff';
        ctx.fillText(left.toFixed(1), cx, cy + (touch ? 5 : 4));
      } else {
        ctx.font = F(800, touch ? 22 : 15);
        ctx.textAlign = 'center';
        ctx.fillStyle = pl.dodgeT > 0 ? '#ffffff' : '#7fe0ff';
        ctx.fillText('»', cx, cy + (touch ? 8 : 5));
      }
      if (!touch) {
        ctx.font = F(800, 8);
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(180,200,230,.7)';
        ctx.fillText('SHIFT', cx, cy + R2 + 10);
      }
      ctx.restore();
    }

    // ---------- megaevolución (tecla X: entra/sale guardando el tiempo en banco) ----------
    {
      const has = !pl.dead && G.Sprites.hasMega(pl.dex);
      const active = has && !!pl.megaOn;
      const cd = has ? Math.max(0, pl.megaCd || 0) : 0;
      const stone = has && !!pl.megaStone();
      const can = has && stone && cd <= 0 && !active;
      if (has) {
        const R2 = touch ? 26 : 18;
        const cx = sx + totalW + 18 + R2 + (pl.bonds > 0 ? 38 : 0);
        const cy = sy + S / 2;
        if (G.Game.state === 'playing' && can)
          G.Touch.addButton(cx - R2, cy - R2, R2 * 2, R2 * 2, () => { pl.tryMega(); }, 8);
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R2, 0, 6.2832);
        ctx.fillStyle = active ? 'rgba(60,30,10,.9)' : can ? 'rgba(20,40,60,.85)' : 'rgba(10,16,28,.55)'; ctx.fill();
        ctx.lineWidth = active || can ? 2.5 : 1.5;
        ctx.strokeStyle = active || can ? '#ffd23f' : 'rgba(140,170,210,.35)'; ctx.stroke();
        ctx.textAlign = 'center';
        if (active) {
          ctx.font = F(800, touch ? 14 : 11);
          ctx.fillStyle = '#ffe9a0';
          ctx.fillText(pl.megaT > 59 ? G.U.mmss(pl.megaT) : Math.ceil(pl.megaT) + 's', cx, cy + (touch ? 5 : 4));
        } else if (cd > 0) {
          ctx.font = F(800, touch ? 11 : 9);
          ctx.fillStyle = '#cfe6ff';
          ctx.fillText(G.U.mmss(cd), cx, cy + (touch ? 4 : 3));
        } else {
          ctx.globalAlpha = stone ? 1 : 0.45;
          const src = G.MSTONE_IMG(pl.dex);
          const im = src && stoneImg(src);
          const sz = touch ? 22 : 16;
          if (im) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
          } else G.Icons.draw(ctx, 'trophy', cx - (touch ? 11 : 8), cy - (touch ? 11 : 8), sz);
          ctx.globalAlpha = 1;
        }
        if (!touch) {
          ctx.font = F(800, 8);
          ctx.fillStyle = stone ? 'rgba(180,200,230,.7)' : 'rgba(255,210,63,.75)';
          ctx.fillText(stone ? 'X' : 'PIEDRA', cx, cy + R2 + 10);
        }
        ctx.restore();
      }
    }

    // ---------- botón de pausa (táctil) ----------
    if (touch) {
      const sa = G.Touch.safeArea();
      const bx = w - 52 - Math.min(44, sa.right), by = 12 + Math.min(20, sa.top), bs = 40;
      roundRect(ctx, bx, by, bs, bs, 10);
      ctx.fillStyle = 'rgba(10,16,28,.7)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(244,248,255,.8)'; ctx.stroke();
      ctx.fillStyle = '#f4f8ff';
      ctx.fillRect(bx + 13, by + 11, 5, 18); ctx.fillRect(bx + 22, by + 11, 5, 18);
      G.Touch.addButton(bx, by, bs, bs, () => G.Game.togglePause(), 8);
    }

    // pista de controles
    if (st.time < 14) {
      ctx.font = F(600, 10);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(180,200,230,.55)';
      ctx.fillText(touch ? 'Arrastra el dedo para moverte  ·  toca un ataque para cambiarlo  ·  botón » para esquivar'
                         : 'WASD moverse  ·  1-4 / Q / E o clic en un ataque para cambiarlo  ·  Shift o Espacio para esquivar  ·  Esc pausa', w / 2, h - 4);
    }

    ctx.restore();
  }

  // ---------------- cooperativo ----------------

  /**
   * - Vida de cada compañero debajo de la tuya.
   * - Flecha en el borde de la pantalla hacia los que no se ven, con su nombre
   *   y a cuántos metros están (roja y parpadeando si está caído).
   * - Si has caído tú: aviso y barra de "te están levantando".
   */
  function drawCoop(ctx, w, h, pl, px, top) {
    const cam = G.Camera;
    const t = performance.now() / 1000;
    let y = top;
    ctx.textAlign = 'left';
    for (const m of G.Coop.mates) {
      if (!m.connected) continue;
      const o = m.pl;
      ctx.font = F(800, 10);
      ctx.fillStyle = m.color;
      ctx.fillText(m.name, px, y + 9);
      const lx = px + 78;
      bar(ctx, lx, y + 1, 110, 8, o.dead ? 0 : o.hp / o.maxHp, o.dead ? '#ff5f6d' : '#5fe08a');
      if (o.dead) {
        ctx.font = F(800, 9);
        ctx.fillStyle = Math.sin(t * 8) > 0 ? '#ff8a96' : '#ffd0d5';
        ctx.fillText('CAÍDO', lx + 116, y + 9);
      }
      y += 15;
    }

    // Flechas hacia los compañeros fuera de la vista.
    for (const m of G.Coop.mates) {
      if (!m.connected) continue;
      const o = m.pl;
      const sx = (o.x - cam.left()) * cam.scale, sy = (o.y - o.bodyH * 0.5 - cam.top()) * cam.scale;
      if (sx > 0 && sx < w && sy > 0 && sy < h) continue;
      const M = 42;
      const ex = G.U.clamp(sx, M, w - M), ey = G.U.clamp(sy, M + 70, h - M - 80);
      const a = Math.atan2(sy - ey, sx - ex);
      const metres = Math.round(G.U.dist(pl.x, pl.y, o.x, o.y) / 32);
      const col = o.dead ? (Math.sin(t * 8) > 0 ? '#ff5f6d' : '#ffd0d5') : m.color;
      ctx.save();
      ctx.translate(ex, ey);
      // Flecha
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath(); ctx.arc(0, 0, 17, 0, 6.2832); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 28, Math.sin(a) * 28);
      ctx.lineTo(Math.cos(a + 2.4) * 14, Math.sin(a + 2.4) * 14);
      ctx.lineTo(Math.cos(a - 2.4) * 14, Math.sin(a - 2.4) * 14);
      ctx.closePath(); ctx.fill();
      // Inicial del compañero dentro del círculo
      ctx.font = F(800, 14);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(m.name.charAt(0).toUpperCase(), 0, 5);
      // Nombre y distancia: al lado contrario de la flecha, para que no se salga
      const lx = -Math.cos(a) * 30, ly = -Math.sin(a) * 26 + 4;
      ctx.font = F(800, 12);
      const label = (o.dead ? '¡' + m.name + ' necesita ayuda! ' : m.name + ' ') + '· ' + metres + ' m';
      ctx.textAlign = Math.cos(a) > 0.3 ? 'right' : Math.cos(a) < -0.3 ? 'left' : 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.strokeText(label, lx, ly);
      ctx.fillStyle = col;
      ctx.fillText(label, lx, ly);
      ctx.restore();
    }

    // Tú, caído.
    if (pl.dead) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = F(800, 20);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.75)';
      const msg = G.Coop.players().every(p => p.dead) ? 'Habéis caído todos…' : 'Has caído: un compañero puede levantarte';
      ctx.strokeText(msg, w / 2, h * 0.62);
      ctx.fillStyle = '#ffb0b8';
      ctx.fillText(msg, w / 2, h * 0.62);
      const f = (pl.reviveT || 0) / G.Player.REVIVE_TIME;
      if (f > 0) bar(ctx, w / 2 - 110, h * 0.62 + 12, 220, 10, f, '#5fe08a');
      ctx.restore();
    }
  }

  return { draw, roundRect, bar };
})();
