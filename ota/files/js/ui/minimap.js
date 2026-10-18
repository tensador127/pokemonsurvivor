/* ============ minimap.js — minimapa (arriba a la derecha, bajo monedas y clima) ============
 * Dibuja el terreno real del mundo (suelo, paredes, agua/lava, árboles y rocas con los
 * colores del bioma) y encima, con los mismos sprites del juego:
 *   tú (aro amarillo) · tu compañero/dúo (aro rosa) · jugadores del grupo (aro de su color)
 *   élites (corona) · jefes (aro rojo) · shinies · duende del tesoro (moneda)
 *   mercader Kecleon (tienda, con los segundos que le quedan) · grieta · cofres con candado,
 *   altares y manantiales.
 * Lo importante que queda fuera del alcance se pega al borde con una flecha.
 * Tocar / clic sobre el minimapa cambia el alcance. Se apaga en Ajustes > Gráficos.
 */
G.Minimap = (() => {
  const RANGES = [520, 800, 1250];
  let zi = 1;
  const CELL = 3;                                   // píxeles de pantalla por celda del terreno
  const cache = { t: 0, list: [] };
  let terr = null, tctx = null, tN = 0, tOx = 0, tOy = 0, tAt = 0, tKey = '';

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function specials(pl, R) {
    const now = performance.now();
    if (now - cache.t > 500) {
      cache.t = now;
      try { cache.list = G.World.specialsNear(pl.x, pl.y, R + 60).filter(p => p.type !== 'trap' && !p.used); }
      catch (e) { cache.list = []; }
    }
    return cache.list;
  }

  /** Terreno en un canvas aparte: se rehace al moverte un poco (y se desplaza suave entre medias). */
  function paintTerrain(pl, S, R) {
    const n = Math.ceil((S + 2 * CELL * 2) / CELL);               // con margen para el desplazamiento
    if (!terr || tN !== n) { terr = document.createElement('canvas'); terr.width = terr.height = n; tctx = terr.getContext('2d'); tN = n; tAt = 0; }
    const B = G.World.biomeData ? G.World.biomeData() : null;
    if (!B) return;
    const key = B.name + '|' + R + '|' + (G.World.arenaKey ? G.World.arenaKey() : '');
    const moved = Math.hypot(pl.x - tOx, pl.y - tOy);
    const now = performance.now();
    const minGap = G.Settings.perf ? 450 : 160;
    if (key === tKey && moved < 14 && now - tAt < 1500) return;
    if (key === tKey && now - tAt < minGap) return;
    tKey = key; tAt = now; tOx = pl.x; tOy = pl.y;
    const w = (2 * R) / (S / CELL) * 1;                            // mundo por celda
    const half = tN / 2;
    const floor = B.floor[0], wallC = B.wallTop[0], wallL = B.wallLight, liq = B.liq, tree = B.leaf[1], rock = B.rock[1];
    const dirt = B.dirt[0];
    for (let j = 0; j < tN; j++) for (let i = 0; i < tN; i++) {
      const x = pl.x + (i - half + 0.5) * w, y = pl.y + (j - half + 0.5) * w;
      const k = G.World.kindAt(x, y);
      let c;
      if (k === 'wall') c = wallC;
      else if (k === 'liquid') c = liq;
      else {
        c = floor;
        const t = G.World.propTypeAt ? G.World.propTypeAt(x, y) : null;
        if (t === 'tree' || t === 'crystal' || t === 'dead') c = tree;
        else if (t === 'rock') c = rock;
        else if (((Math.floor(x / 24) * 7 + Math.floor(y / 24) * 13) & 7) === 0) c = dirt;
      }
      tctx.fillStyle = c; tctx.fillRect(i, j, 1, 1);
    }
  }

  /** Sprite del juego en pequeño: pies en (x, y + h/2); h = alto en píxeles de minimapa. */
  function portrait(ctx, anim, bodyH, x, y, h) {
    if (!anim) return false;
    const s = Math.max(0.1, Math.min(1.2, h / Math.max(14, bodyH || 40)));
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y + h / 2));
    ctx.scale(s, s);
    ctx.imageSmoothingEnabled = false;
    try { anim.draw(ctx, 0, 0, {}); } catch (e) { /* sprite aún cargando */ }
    ctx.restore();
    return true;
  }

  function draw(ctx, w, h, pl, touch) {
    if (G.Settings.get('minimap') === false) return;
    const S = Math.round(Math.max(96, Math.min(140, h * 0.23)));
    const x0 = w - S - 16 - (touch ? 56 : 0), y0 = 72;
    const R = RANGES[zi], half = S / 2, k = (S / 2) / R, cx = x0 + half, cy = y0 + half;

    ctx.save();
    rr(ctx, x0, y0, S, S, 10);
    ctx.fillStyle = 'rgba(8,14,28,.8)'; ctx.fill();
    ctx.save();
    ctx.clip();

    // ---- terreno ----
    paintTerrain(pl, S, R);
    if (terr) {
      ctx.imageSmoothingEnabled = false;
      const ts = tN * CELL;
      ctx.globalAlpha = 0.95;
      ctx.drawImage(terr, Math.round(cx - ts / 2 + (tOx - pl.x) * k), Math.round(cy - ts / 2 + (tOy - pl.y) * k), ts, ts);
      ctx.globalAlpha = 1;
    }
    // Viñeta suave en los bordes.
    const vg = ctx.createRadialGradient(cx, cy, S * 0.32, cx, cy, S * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.38)');
    ctx.fillStyle = vg; ctx.fillRect(x0, y0, S, S);

    const m = half - 11;
    /** Posición en el minimapa; si queda fuera y 'edge', se pega al borde. */
    const pt = (x, y, edge) => {
      let dx = (x - pl.x) * k, dy = (y - pl.y) * k;
      const out = Math.abs(dx) > m || Math.abs(dy) > m;
      if (out) {
        if (!edge) return null;
        const f = m / Math.max(Math.abs(dx), Math.abs(dy));
        dx *= f; dy *= f;
      }
      return { x: cx + dx, y: cy + dy, out, a: Math.atan2(dy, dx) };
    };
    const ring = (p, col, r) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 7, r, r * 0.42, 0, 0, 6.2832); ctx.stroke();
    };
    const TSZ = (G.World.TS || 48);
    const label = (txt, x, y, col) => {
      ctx.font = '800 8px Pixelify,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.fillStyle = col || '#fff';
      ctx.strokeText(txt, x, y); ctx.fillText(txt, x, y);
      ctx.textBaseline = 'alphabetic';
    };
    const arrow = (p, col, ent) => {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-3, -5); ctx.lineTo(-3, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (ent) {                                           // a cuántos tiles queda
        const d = Math.round(Math.hypot(ent.x - pl.x, ent.y - pl.y) / TSZ);
        label(String(d), p.x - Math.cos(p.a) * 9, p.y - Math.sin(p.a) * 9, col);
      }
    };
    /** Sprite + aro (y arco de aviso si queda fuera) + insignia opcional. */
    const who = (p, anim, bodyH, hgt, col, badge, ent) => {
      if (!p) return;
      if (p.out) {
        ctx.globalAlpha = 0.9; ring(p, col, hgt * 0.45);
        portrait(ctx, anim, bodyH, p.x, p.y - hgt / 2 + 2, hgt * 0.8);
        ctx.globalAlpha = 1;
        arrow({ x: p.x + Math.cos(p.a) * 9, y: p.y + Math.sin(p.a) * 9, a: p.a }, col, ent);
        return;
      }
      ring(p, col, hgt * 0.5);
      if (!portrait(ctx, anim, bodyH, p.x, p.y - hgt / 2 + 2, hgt)) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 6.2832); ctx.fill(); }
      if (badge) G.Icons.draw(ctx, badge, Math.round(p.x + hgt * 0.25), Math.round(p.y - hgt - 1), 10);
    };

    // ---- lo que ves en pantalla (rectángulo) ----
    {
      const cw = (G.Camera.w || 0) * k, ch = (G.Camera.h || 0) * k;
      if (cw > 4 && ch > 4) {
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.strokeRect(Math.round(cx - cw / 2) + 0.5, Math.round(cy - ch / 2) + 0.5, Math.round(cw), Math.round(ch));
        ctx.setLineDash([]);
      }
    }

    // ---- peligro: el resto de enemigos, como puntitos rojos ----
    if (!G.Settings.perf) {
      ctx.fillStyle = 'rgba(255,70,70,.9)';
      for (const e of G.EnemyMgr.all()) {
        if (e.dead || e.boss || e.elite || e.shiny) continue;
        const dx = (e.x - pl.x) * k, dy = (e.y - pl.y) * k;
        if (Math.abs(dx) > m || Math.abs(dy) > m) continue;
        ctx.fillRect(Math.round(cx + dx) - 1, Math.round(cy + dy) - 1, 2, 2);
      }
    }

    // ---- objetos fijos ----
    for (const s of specials(pl, R)) {
      const p = pt(s.x, s.y, false);
      if (!p) continue;
      if (s.type === 'bigchest') {                       // cofre con candado: cajita marrón con broche
        ctx.fillStyle = '#7a4a22'; ctx.fillRect(p.x - 4, p.y - 3, 8, 6);
        ctx.fillStyle = '#ffcb3d'; ctx.fillRect(p.x - 4, p.y - 3, 8, 1.5); ctx.fillRect(p.x - 1, p.y - 1, 2, 3);
        ctx.strokeStyle = '#1a1208'; ctx.lineWidth = 1; ctx.strokeRect(p.x - 4.5, p.y - 3.5, 9, 7);
      } else if (s.type === 'altar') G.Icons.draw(ctx, 'star', Math.round(p.x - 5), Math.round(p.y - 5), 10);
      else if (s.type === 'spring') {                    // manantial: gota
        ctx.fillStyle = '#5fe6e0'; ctx.strokeStyle = '#0d3b46'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - 5); ctx.quadraticCurveTo(p.x + 5, p.y + 1, p.x, p.y + 4); ctx.quadraticCurveTo(p.x - 5, p.y + 1, p.x, p.y - 5);
        ctx.fill(); ctx.stroke();
      }
    }

    // ---- grieta ----
    const rift = G.Rift && G.Rift.rift;
    if (rift) {
      const p = pt(rift.x, rift.y, true);
      const pulse = 0.5 + Math.sin(performance.now() / 180) * 0.5;
      if (p.out) arrow(p, '#c9a4ff', rift);
      else {
        ctx.strokeStyle = 'rgba(200,160,255,' + (0.25 + pulse * 0.3) + ')'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 11 + pulse * 4, 0, 6.2832); ctx.stroke();      // aviso que late
        ctx.fillStyle = 'rgba(40,10,80,.85)';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 4.5, 7, 0, 0, 6.2832); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(200,160,255,' + (0.55 + pulse * 0.45) + ')';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 5 + pulse * 1.5, 8 + pulse * 1.5, 0, 0, 6.2832); ctx.stroke();
        ctx.fillStyle = '#e8d6ff'; ctx.fillRect(p.x - 0.8, p.y - 3, 1.6, 6);
      }
    }

    // ---- mercader (tienda) ----
    const mc = G.Merchant && G.Merchant.current && G.Merchant.current();
    if (mc && !mc.done) {
      const p = pt(mc.x, mc.y, true);
      who(p, mc.anim, mc.bodyH, 20, '#ffd23f', null, mc);
      if (!p.out) {
        const pl2 = 0.5 + Math.sin(performance.now() / 220) * 0.5;
        ctx.strokeStyle = 'rgba(255,210,63,' + (0.25 + pl2 * 0.35) + ')'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 13 + pl2 * 3, 0, 6.2832); ctx.stroke();
      }
      if (!p.out) {
        G.Icons.draw(ctx, 'coin', Math.round(p.x - 14), Math.round(p.y - 19), 10);
        ctx.font = '800 9px Pixelify,system-ui,sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.fillStyle = '#ffe68a';
        const tt = Math.max(0, Math.ceil(mc.ttl)) + 's';
        ctx.strokeText(tt, p.x, p.y + 17); ctx.fillText(tt, p.x, p.y + 17);
      }
    }

    // ---- enemigos que importan (se pintan de menos a más importante) ----
    const picks = [];
    for (const e of G.EnemyMgr.all()) {
      if (e.dead) continue;
      let kind = null;
      if (e.boss) kind = 4;
      else if (e.elite) kind = 2;
      else if (e.behavior === 'thief' || (e.def && e.def.behavior === 'thief')) kind = 3;
      else if (e.shiny) kind = 1;
      if (kind) picks.push([kind, e]);
    }
    picks.sort((a, b) => a[0] - b[0]);
    for (const [kind, e] of picks) {
      const p = pt(e.x, e.y, kind !== 1);
      if (!p) continue;
      if (kind === 4) who(p, e.anim, e.bodyH, 22, '#ff4a4a', null, e);
      else if (kind === 2) who(p, e.anim, e.bodyH, 16, '#c47bff', 'crown', e);
      else if (kind === 3) who(p, e.anim, e.bodyH, 15, '#ffd23f', 'coin', e);
      else who(p, e.anim, e.bodyH, 14, '#9ae6ff', 'shiny', e);
    }

    // ---- compañero y grupo ----
    const duo = G.Duo && G.Duo.view && G.Duo.view() && G.Duo.pos && G.Duo.pos();
    if (duo) who(pt(duo.x, duo.y, true), duo.anim, duo.bodyH, 16, duo.down ? '#8a6a78' : '#ff8ad8', 'heart', duo);
    if (G.Coop && G.Coop.active) {
      for (const o of G.Game.everyone()) {
        if (o === pl || o.dead) continue;
        who(pt(o.x, o.y, true), o.anim, o.bodyH, 16, o.tagColor || '#7ee07a', null, o);
      }
    }

    // ---- tú (con flecha hacia donde miras / caminas) ----
    {
      const a = pl.walking ? pl.moveAngle : (pl.aim != null ? pl.aim : 0);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
      ctx.fillStyle = '#ffcb3d'; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(19, 0); ctx.lineTo(12, -4); ctx.lineTo(12, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    who({ x: cx, y: cy, out: false }, pl.anim, pl.bodyH, 18, '#ffcb3d', null);
    ctx.restore();

    // ---- brújula y alcance ----
    label('N', cx, y0 + 8, '#ffb0b0');
    {
      const tiles = Math.round(R / TSZ);
      label(tiles + ' ↔', x0 + S - 16, y0 + S - 6, '#9fb6dd');
    }

    rr(ctx, x0, y0, S, S, 10);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(160,190,240,.65)'; ctx.stroke();
    ctx.restore();

    // Botón táctil / clic: cambia el alcance.
    G.Touch.addButton(x0, y0, S, S, () => { zi = (zi + 1) % RANGES.length; tAt = 0; cache.t = 0; G.Audio.sfx('click'); }, 2);
  }

  return { draw };
})();
