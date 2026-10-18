/* ============ tft.js — modo auto-battler ============
 * Cada partida toma 2 generaciones al azar. Compra Pokémon en la tienda,
 * colócalos en tu mitad, sube estrellas (3 iguales) y sinergias por tipo,
 * y aguanta rondas PvE y contra la IA rival. Fuera de combate todo se para;
 * en combate tus unidades pelean solas con sus movimientos de verdad.
 *
 * Reutiliza: DEX, tipos, movimientos+combate (proveedor de objetivos),
 * sprites/animaciones, FX, iconos y monedas de la cuenta (premio al ganar).
 */
G.Tft = (() => {
  const COLS = 7, ROWS = 4, CELL = 56;   // tu mitad (la rival es espejo)
  const BENCH = 9, SHOPN = 5;
  const PREP_T = 25, FIGHT_T = 30;
  // Probabilidades de tienda oficiales del TFT (1-5 estrellas por nivel).
  const ODDS = { 1: [100, 0, 0, 0, 0], 2: [100, 0, 0, 0, 0], 3: [75, 25, 0, 0, 0],
                 4: [55, 30, 15, 0, 0], 5: [45, 33, 20, 2, 0], 6: [30, 40, 25, 5, 0],
                 7: [16, 30, 43, 10, 1], 8: [15, 20, 32, 30, 3], 9: [10, 17, 25, 33, 15] };
  const XP_NEED = [0, 2, 6, 10, 20, 36, 56, 80, 100];
  const GEN_NAMES = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Teselia', 'Kalos', 'Alola', 'Galar', 'Paldea'];
  /* Sinergias estilo TFT: cada tipo tiene sus umbrales (de mayor a menor).
     "solo" = sólo con 1 en tablero (al poner 2 se apaga, como los Ninja). */
  const SY_DEF = {
    normal: [{ n: 2, b: 0.18 }],
    fire: [{ n: 6, b: 0.45 }, { n: 4, b: 0.25 }, { n: 2, b: 0.12 }],
    water: [{ n: 6, b: 0.45 }, { n: 4, b: 0.25 }, { n: 2, b: 0.12 }],
    electric: [{ n: 4, b: 0.28 }, { n: 2, b: 0.12 }],
    grass: [{ n: 6, b: 0.45 }, { n: 4, b: 0.25 }, { n: 2, b: 0.12 }],
    ice: [{ n: 2, b: 0.20 }],
    fighting: [{ n: 5, b: 0.40 }, { n: 3, b: 0.20 }],
    poison: [{ n: 3, b: 0.25 }],
    ground: [{ n: 4, b: 0.30 }, { n: 2, b: 0.15 }],
    flying: [{ n: 4, b: 0.30 }, { n: 2, b: 0.15 }],
    psychic: [{ n: 4, b: 0.30 }, { n: 2, b: 0.15 }],
    bug: [{ n: 5, b: 0.40 }, { n: 3, b: 0.20 }],
    rock: [{ n: 4, b: 0.30 }, { n: 2, b: 0.15 }],
    ghost: [{ n: 1, b: 0.35, solo: true }],
    dragon: [{ n: 1, b: 0.45, solo: true }],
    dark: [{ n: 3, b: 0.25 }],
    steel: [{ n: 4, b: 0.30 }, { n: 2, b: 0.15 }],
    fairy: [{ n: 4, b: 0.30 }, { n: 2, b: 0.15 }]
  };
  const SY_STD = [{ n: 6, b: 0.45 }, { n: 4, b: 0.25 }, { n: 2, b: 0.12 }];

  /* Rasgos especiales (no son tipos): cada unidad suma, sin umbrales. Vapor 1 = +8%, Vapor 2 = +16%...
     eff: atk = +% ataque · mana = +maná inicial (tope) · def = -% daño (tope). */
  const SY_PSEUDO = [
    { id: 'vapor', name: 'Vapor', eff: 'atk', per: 0.08, icon: 'wrain',
      test: mon => (mon.types || []).includes('fire') || (mon.types || []).includes('water') },
    { id: 'titan', name: 'Titán', eff: 'atk', per: 0.06, icon: 'crown',
      test: mon => (mon.bst || 0) >= 500 },
    { id: 'inicial', name: 'Inicial', eff: 'atk', per: 0.10, icon: 'medal1',
      test: mon => !!mon.starter },
    { id: 'bebe', name: 'Bebé', eff: 'mana', per: 10, cap: 30, icon: 'sprout',
      test: mon => (mon.bst || 999) <= 320 },
    { id: 'coraza', name: 'Acorazado', eff: 'def', per: 0.03, cap: 0.15, icon: 'shield',
      test: mon => (mon.types || []).includes('steel') || (mon.types || []).includes('rock') }
  ];
  const syName = t => ((SY_PSEUDO.find(p => p.id === t) || {}).name || (G.U.TYPE_NAME || {})[t] || t);
  const syIcon = t => ((SY_PSEUDO.find(p => p.id === t) || {}).icon || ('type:' + t));
  function syTest(type) {
    const ps = SY_PSEUDO.find(p => p.id === type);
    if (ps) return mon => ps.test(mon);
    return mon => (mon.types || []).includes(type);
  }

  let M = null;              // partida: ver newMatch()
  let portraits = {};        // dex -> <canvas> para tienda/banca
  let drag = null;           // { from: {zone, i} | {zone:'board', c, r}, dex, star, x, y }
  let camBak = null;
  let cv = null;
  let synRects = [];         // zonas del panel de sinergias (para su tooltip)
  let synIconRects = [];       // iconos de la sinergia fijada (para su mini-tip)

  const F = (w, s) => `${w} ${s}px Pixelify,"Segoe UI",system-ui,sans-serif`;

  // ---------------- utilidades ----------------

  function boardCount() { return M ? M.board.size : 0; }
  function cap() { return M ? M.level + (M.capBonus || 0) : 0; }

  /** Bonus de sinergias de una lista de unidades: CADA unidad cuenta (como en TFT). */
  function synergy(list) {
    const count = {};
    for (const u of list) {
      const types = u.types || (G.DEX_BY[u.dex] || {}).types || [];
      for (const t of types) count[t] = (count[t] || 0) + 1;
    }
    let bonus = 0;
    const act = [];
    for (const t in count) {
      const tiers = SY_DEF[t] || SY_STD;
      for (const tr of tiers) {
        if (tr.solo) {
          if (count[t] === 1) { bonus += tr.b; act.push({ type: t, n: 1, bonus: tr.b, solo: true }); }
          break;
        }
        if (count[t] >= tr.n) { bonus += tr.b; act.push({ type: t, n: tr.n, bonus: tr.b }); break; }
      }
    }
    // Rasgos especiales: cada unidad suma su efecto (siempre activos con 1+).
    let synMana = 0, synDef = 0;
    for (const ps of SY_PSEUDO) {
      let n = 0;
      for (const u of list) {
        const mon = (u.dex && G.DEX_BY[u.dex]) || u;
        if (ps.test(mon)) n++;
      }
      if (n > 0) {
        const eff = ps.eff || 'atk';
        if (eff === 'mana') {
          const v = Math.min(ps.cap || 99, n * ps.per);
          synMana += v;
          count[ps.id] = n;
          act.push({ type: ps.id, n, bonus: v, per: ps.per, linear: true, eff });
        } else if (eff === 'def') {
          const v = Math.min(ps.cap || 0.3, n * ps.per);
          synDef += v;
          count[ps.id] = n;
          act.push({ type: ps.id, n, bonus: v, per: ps.per, linear: true, eff });
        } else {
          const b = n * ps.per;
          bonus += b;
          count[ps.id] = n;
          act.push({ type: ps.id, n, bonus: b, per: ps.per, linear: true, eff });
        }
      }
    }
    return { bonus: Math.min(0.6, bonus), mana: synMana, def: Math.min(0.3, synDef), act: act.slice(0, 6), counts: count };
  }

  function cellXY(c, r) { return [M.ox + c * CELL + CELL / 2, M.oy + (r - 4) * CELL + CELL - 14]; }
  function foeCellXY(c, r) { return [M.ox + (COLS - 1 - c) * CELL + CELL / 2, M.oy + (r - 4) * CELL + CELL - 14]; }

  const artSeen = {};
  function ensureArt(dex, shiny) {
    if (!artSeen[dex]) { artSeen[dex] = true; G.Sprites.preload([dex]); }
    const k = shiny ? dex + 's' : null;
    if (k && !artSeen[k]) { artSeen[k] = true; G.Sprites.preload([dex], 8000, true); }
  }

  /** Retrato directo de la hoja: los canvas off-DOM nunca los pinta UI.tick (quedaban en blanco).
      star>=3 usa la versión shiny si existe (si no, el llamador pinta aro dorado). */
  function drawPortrait(ctx, dex, x, y, w, h, animate, star) {
    const shiny = star >= 3 && G.Sprites.hasShiny(dex);
    ensureArt(dex, shiny);
    const m = G.Sprites.animMeta(dex, 'Idle', shiny);
    const s = G.Sprites.sheet(dex, 'Idle', shiny);
    if (!m || !s || !s.ready) {
      ctx.fillStyle = 'rgba(140,170,210,.12)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(140,170,210,.5)';
      ctx.font = F(700, 16);
      ctx.textAlign = 'center';
      ctx.fillText('?', x + w / 2, y + h / 2 + 6);
      return;
    }
    // En el tablero en espera, Idle animado (cada uno a su ritmo).
    let frame = 0;
    if (animate && m.n > 1) {
      const total = m.d.reduce((a, b) => a + b, 0) || 1;
      let t = ((performance.now() / 1000 * 60) + (dex % 7) * 13) % total;
      for (let i = 0; i < m.n; i++) { t -= m.d[i]; if (t < 0) { frame = i; break; } frame = i; }
    }
    const k = Math.min(w / m.w, (h * 0.85) / m.h);
    const dw = m.w * k, dh = m.h * k;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(s.img, frame * m.w, 0, m.w, m.h, x + (w - dw) / 2, y + h * 0.9 - m.ay * k, dw, dh);
    ctx.restore();
  }

  // ---------------- partida ----------------

  /** Pool de 60 por FAMILIAS (misma raíz = mismo tier): 15×T4 + 13×T3 + 13×T2
   *  + 14×T1 = 55 familias por BST máxima en juego, +5 legendarios (T5, Nv.7+).
   *  Sólo formas base en tienda; las evos comparten tier aunque no se vendan. */
  let evoPar = null;
  /** Mapa hijo -> padre evolutivo (para agrupar familias). */
  function evoParent() {
    if (!evoPar) {
      evoPar = {};
      const add = map => {
        for (const k in (map || {})) {
          const v = map[k];
          if (Array.isArray(v)) { for (const o of v) if (!evoPar[o]) evoPar[o] = +k; }
          else if (!evoPar[v]) evoPar[v] = +k;
        }
      };
      add(G.EVOCHAIN); add(G.EVOCHOICE); add(G.EVOCHAIN_ALL); add(G.EVOCHOICE_ALL);
    }
    return evoPar;
  }
  function famRoot(dex) { const rev = evoParent(); let d = +dex, g = 0; while (rev[d] && g++ < 8) d = rev[d]; return d; }

  function buildPool() {
    const isEvo = d => !!(G.EVO_FORM || {})[d];
    const fams = {};
    for (const p of G.DEX) {
      if (p.leg) continue;
      const r = famRoot(p.dex);
      const f = fams[r] || (fams[r] = { maxBst: 0, hasBase: false });
      f.maxBst = Math.max(f.maxBst, p.bst || 0);
      if (!isEvo(p.dex)) f.hasBase = true;
    }
    const ranked = Object.keys(fams).filter(r => fams[r].hasBase)
      .sort((a, b) => fams[b].maxBst - fams[a].maxBst);
    // Mi tanda (lore): ACE a T4, iniciales a T2/T3 (nunca T1), Ditto a T1.
    const ACE = [658, 448, 445, 149, 248, 376, 373, 282, 94, 65, 68, 130, 143, 131, 257, 254, 260, 392, 394, 389];
    const aceRoots = [];
    for (const d of ACE) {
      const r = String(famRoot(d));
      if (fams[r] && fams[r].hasBase && ranked.includes(r) && !aceRoots.includes(r)) aceRoots.push(r);
    }
    const starterRoots = [];
    for (const r of ranked) {
      let isSt = false;
      for (const p of G.DEX) {
        if (p.starter && !p.leg && String(famRoot(p.dex)) === r) { isSt = true; break; }
      }
      if (isSt) starterRoots.push(r);
    }
    const dittoRoot = String(famRoot(132));
    const anchored = new Set([...aceRoots, ...starterRoots, dittoRoot]);
    const rest = ranked.filter(r => !anchored.has(r) && r !== dittoRoot);
    // Rellena N al azar de la banda [lo, hi) del ranking (varía cada partida).
    const chosen = {};
    const takeBand = (lo, hi, n) => {
      const out = [];
      const band = rest.filter((r, i) => i >= lo && i < hi && chosen[r] == null);
      band.sort(() => Math.random() - 0.5);
      for (const r of band) {
        if (out.length >= n) break;
        out.push(r);
      }
      // Si la banda no llega, se sigue hacia abajo.
      if (out.length < n) {
        for (let i = hi; i < rest.length && out.length < n; i++) {
          if (chosen[rest[i]] == null) out.push(rest[i]);
        }
      }
      return out;
    };
    // Iniciales: 10 a T3 y el resto a T2 (mezclados cada partida, nunca T1).
    const stShuf = starterRoots.slice().sort(() => Math.random() - 0.5);
    for (const r of stShuf.slice(0, 10)) chosen[r] = 3;
    for (const r of stShuf.slice(10)) chosen[r] = 2;
    // ACE después (pisan si coinciden: el T4 manda por lore).
    for (const r of aceRoots.slice(0, 18)) chosen[r] = 4;
    for (const r of aceRoots.slice(18, 20)) if (chosen[r] == null) chosen[r] = 3;
    const need4 = 18 - Object.keys(chosen).filter(r => chosen[r] === 4).length;
    for (const r of takeBand(0, 60, Math.max(0, need4))) chosen[r] = 4;
    const need3 = 20 - Object.keys(chosen).filter(r => chosen[r] === 3).length;
    for (const r of takeBand(15, 90, Math.max(0, need3))) chosen[r] = 3;
    const need2 = 22 - Object.keys(chosen).filter(r => chosen[r] === 2).length;
    for (const r of takeBand(60, 180, Math.max(0, need2))) chosen[r] = 2;
    const need1 = 25 - Object.keys(chosen).filter(r => chosen[r] === 1).length;
    for (const r of takeBand(150, 400, Math.max(0, need1))) chosen[r] = 1;
    // Ditto siempre entra a T1 (cambia una T1 cualquiera si hace falta).
    if (fams[dittoRoot] && fams[dittoRoot].hasBase && chosen[dittoRoot] == null) {
      const evict = Object.keys(chosen).find(r => chosen[r] === 1);
      if (evict) delete chosen[evict];
      chosen[dittoRoot] = 1;
    }
    const tiers = {}, pool = [];
    for (const p of G.DEX) {
      if (p.leg) continue;
      const t = chosen[famRoot(p.dex)];
      if (!t) continue;
      tiers[p.dex] = t;
      if (!isEvo(p.dex)) pool.push(p.dex);
    }
    // Legendarios: 15 de todas las generaciones (sólo Nv.7+ por ODDS).
    const legs = G.DEX.filter(p => p.leg && !isEvo(p.dex));
    legs.sort(() => Math.random() - 0.5);
    for (const p of legs.slice(0, 15)) { tiers[p.dex] = 5; pool.push(p.dex); }
    return { pool, tiers };
  }

  function newMatch() {
    // La pool es global (las 9 generaciones); el tinte es de postureo.
    const g = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const tint = 1 + Math.floor(Math.random() * 9);
    const { pool, tiers } = buildPool();
    M = {
      gens: g, pool, tiers, tint,
      ox: -(COLS * CELL) / 2, oy: 0,
      gold: 12, level: 1, xp: 0, hp: 100, round: 0, streak: 0,
      shop: [null, null, null, null, null], shopLock: false,
      items: [],   // objetos sueltos (máx. 7): arrastra a una unidad para equipar
      armory: null, armRects: null,   // armería: 3 objetos a elegir 1 gratis
      augDraft: null, augRects: null,   // aumentos: 1 de 3 cada 5 rondas
      freeRolls: 0, capBonus: 0, manaBoost: 0,   // de aumentos: tiradas, hueco y maná
      plan: [], planOpen: false, planFilter: 0, planBtn: null, planRects: null, planPage: 0, planUndo: [],   // planificador
      shopFx: 0, buyFx: null,   // animaciones de tienda: entrada y vuelo a banca
      synSel: null, synTip: null,
      bench: new Array(BENCH).fill(null),
      board: new Map(),          // "c,r" -> { dex, star }
      phase: 'prep', phaseT: PREP_T, result: null,
      units: [], foes: [], foeData: [],
      ai: { hp: 100, level: 1, xp: 0, gold: 12, team: [], favored: [], streak: 0 },
      over: null, flash: null, flashT: 0,
      avatarT: 0, avatarWon: false,   // salto del avatar al ganar la ronda
      avCast: null,   // habilidad del avatar ganador al perdedor (PvP, visual)
      sideMsg: null   // avisos junto al avatar (en vez de toast abajo)
    };
    // La IA prefiere 2 tipos de la pool.
    const types = [...new Set(pool.map(d => G.DEX_BY[d].types[0]))];
    M.ai.favored = types.sort(() => Math.random() - 0.5).slice(0, 2);
    G.TftTier = tiers;   // tiers TFT por familia (los lee TactUnit)
    portraits = {};
    rollShop();
    planWilds();   // la ronda 1 es PvE: se enseña en preparación
  }

  function income(m, foe) {
    const base = 5;
    const intB = Math.min(5, Math.floor(m.gold / 10));
    const streakB = Math.abs(m.streak) >= 4 ? 2 : Math.abs(m.streak) >= 2 ? 1 : 0;
    const pveB = foe ? 0 : 2;   // PvE paga un poco más (sin daño al rival)
    const total = base + intB + streakB + pveB;
    m.gold += total;
    return { total, base, intB, streakB, pveB };
  }

  // ---------------- tienda ----------------

  function rollCost() {
    const w = ODDS[Math.min(9, M.level)], r = Math.random() * 100;
    let acc = 0;
    for (let i = 0; i < 5; i++) { acc += w[i]; if (r < acc) return i + 1; }
    return 1;
  }

  function rollOne() {
    const cost = rollCost();
    // Si ya tienes un ★3 de esa familia, sus bases no vuelven a salir.
    const maxed = new Set();
    for (const u of [...M.bench.filter(Boolean), ...M.board.values()]) {
      if (u.star >= 3) maxed.add(famRoot(u.dex));
    }
    let cands = M.pool.filter(d => costOf(d) === cost && !maxed.has(famRoot(d)));
    if (!cands.length) cands = M.pool.filter(d => costOf(d) === cost);
    if (!cands.length) cands = M.pool;
    return G.U.pick(cands);
  }

  function rollShop() {
    for (let i = 0; i < SHOPN; i++) M.shop[i] = rollOne();
    M.shopFx = 0.35;   // las cartas entran deslizándose
  }

  /** Tier TFT de la partida (por familia): si no está, rareza base. */
  function costOf(dex) { return (M && M.tiers && M.tiers[dex]) || Math.min(5, G.DEX_BY[dex].rarity); }
  function sellValue(dex, star) { return costOf(dex) * [0, 1, 3, 9][star]; }

  function buy(i) {
    const dex = M.shop[i];
    if (dex == null || (M.phase !== 'prep' && M.phase !== 'fight')) return;
    const cost = costOf(dex);
    const bi = M.bench.indexOf(null);
    if (bi < 0) { G.Audio.sfx('error'); G.UI.toast('Banca llena'); return; }
    if (M.gold < cost) { G.Audio.sfx('error'); G.UI.toast('Te faltan ' + (cost - M.gold)); return; }
    M.gold -= cost;
    M.bench[bi] = { dex, star: 1, items: [] };
    M.shop[i] = null;
    // Vuela de la carta a la banca.
    {
      const [sx, sy] = shopXY(i);
      const [bx, by] = benchXY(bi);
      M.buyFx = { dex, bi, x0: sx + 50, y0: sy + 48, x1: bx + 19, y1: by + 19, t: 0.55, t0: 0.55 };
    }
    G.Audio.sfx('buy');
    starCheck();
  }

  function buyXp() {
    if ((M.phase !== 'prep' && M.phase !== 'fight') || M.level >= 9) return;
    if (M.gold < 4) { G.Audio.sfx('error'); return; }
    M.gold -= 4;
    G.Audio.sfx('buy');
    gainXp(4);
  }

  /** Experiencia (compra o +2 por ronda), con subidas de nivel. */
  function gainXp(n) {
    if (M.level >= 9) return;
    M.xp += n;
    while (M.level < 9 && M.xp >= XP_NEED[M.level]) { M.xp -= XP_NEED[M.level]; M.level++; G.Audio.sfx('levelup'); }
  }

  /** 3 idénticos (banca+tablero) -> 1 estrella más (y evoluciona si puede). */
  function starCheck() {
    const all = [];
    M.bench.forEach((u, i) => { if (u) all.push({ u, put: v => { M.bench[i] = v; } }); });
    for (const [k, u] of M.board) all.push({ u, put: v => { if (v) M.board.set(k, v); else M.board.delete(k); } });
    for (let star = 1; star <= 2; star++) {
      const byDex = {};
      for (const a of all) {
        if (!a.u || a.u.star !== star) continue;
        // Sólo idénticos fusionan (las preevos no cuentan para otras etapas).
        (byDex[a.u.dex] = byDex[a.u.dex] || []).push(a);
      }
      for (const dex in byDex) {
        const g = byDex[dex];
        while (g.length >= 3) {
          const three = g.splice(0, 3);
          // Se queda en el tablero si puede.
          three.sort((a, b) => (M.board.has(keyOf(a)) ? 0 : 1) - (M.board.has(keyOf(b)) ? 0 : 1));
          const keep = three[0];
          for (const o of three.slice(1)) {
            o.put(null);
            // Sus objetos vuelven a la tira (o +2 de oro si no caben).
            for (const id of (o.u.items || [])) {
              if (M.items.length < 7) M.items.push(id);
              else M.gold += 2;
            }
          }
          keep.u.star++;
          keep.u.items = keep.u.items || [];
          // Evoluciona de sprite (y de stats base): a su evolución si tiene,
          // si no se queda como está. Los stats suben por la estrella igualmente.
          const ev = tftEvoNext(keep.u.dex);
          if (ev) keep.u.dex = ev;
          keep.put(keep.u);
          G.Audio.sfx('legend');
          flash(G.DEX_BY[keep.u.dex].name + ' ★' + keep.u.star + '!');
          // Escenita de evolución (como la referencia): flash + diálogo.
          M.evoFx = { dex: keep.u.dex, t: 2.6 };
        }
      }
    }
  }

  function keyOf(a) {
    for (const [k, u] of M.board) if (u === a.u) return k;
    return null;
  }

  /** Evolución al subir estrellas: sólo si toca su generación y hay sprite. */
  function tftEvoNext(dex) {
    if (!G.evoNext) return null;
    const ev = G.evoNext(dex);
    if (!ev || !G.DEX_BY[ev]) return null;
    if (M.gens && !M.gens.includes(G.DEX_BY[ev].gen)) return null;
    if (!G.Sprites.animMeta(ev, 'Idle')) return null;
    return ev;
  }

  /** ¿Cuántas copias tienes de ese dex (banca+tablero, sin contar ★3)? */
  function ownedCount(dex) {
    let n = 0;
    for (const u of M.bench) if (u && u.dex === dex && u.star < 3) n++;
    for (const u of M.board.values()) if (u.dex === dex && u.star < 3) n++;
    return n;
  }

  /** ¿Cuántas copias idénticas tienes de ese dex (banca+tablero, sin ★3)? */
  function pairCount(dex) {
    let n = 0;
    const all = [...M.bench.filter(Boolean), ...M.board.values()];
    for (const u of all) {
      if (u.star >= 3) continue;
      if (u.dex === dex) n++;
    }
    return n;
  }

  function flash(text) { M.flash = text; M.flashT = 2.2; }

  // ---------------- rondas ----------------

  function kindOf(r) {
    return r <= 3 || r % 2 === 1 ? 'pve' : 'pvp';
  }

  function roundKind() {
    return kindOf(M.round + 1);
  }

  /** Cuántas rondas PvE hay hasta la r (incluida si lo es). */
  function pveCountUpTo(r) {
    return r <= 3 ? r : 3 + Math.floor((r - 3) / 2);
  }

  /** Cuántas rondas PvE llevamos (incluida la actual si lo es). */
  function pveCount() {
    return pveCountUpTo(M.round + 1);
  }

  /** Jefe salvaje: rondas PvE 7, 17, 27... (cada 5 PvE). Botín doble asegurado. */
  function isBossR(r) {
    return r > 3 && r % 2 === 1 && pveCountUpTo(r) % 5 === 0;
  }

  function isBossRound() {
    return isBossR(M.round + 1);
  }

  /** Pre-genera los salvajes de la próxima ronda (para enseñarlos en preparación). */
  function planWilds() {
    M.foeData = [];
    if (roundKind() !== 'pve') return;
    const boss = isBossRound();
    const n = (M.round < 3 ? M.round + 1 : Math.min(7, 3 + Math.floor((M.round - 2) / 2))) + (boss ? 2 : 0);
    const star = M.round + 1 >= 9 ? 2 : 1;
    const maxCost = Math.min(5, 1 + Math.floor(M.round / 2));
      const wildPool = M.pool.filter(d => costOf(d) <= maxCost);
    for (let i = 0; i < n; i++) {
      M.foeData.push({
        dex: G.U.pick(wildPool.length ? wildPool : M.pool),
        star: star + (boss && i === 0 ? 1 : 0),
        c: Math.floor(Math.random() * COLS), r: Math.floor(Math.random() * 3)
      });
    }
  }

  /** Si el tablero está vacío al empezar: sube lo más barato de la banca (o uno gratis). */
  function ensureFighter() {
    if (boardCount() > 0) return;
    let bi = -1, best = Infinity;
    M.bench.forEach((u, i) => {
      if (u && costOf(u.dex) < best) { best = costOf(u.dex); bi = i; }
    });
    if (bi >= 0) {
      M.board.set('3,6', M.bench[bi]);
      M.bench[bi] = null;
    } else {
      const cheap = M.pool.filter(d => costOf(d) === 1);
      M.board.set('3,6', { dex: cheap.length ? G.U.pick(cheap) : G.U.pick(M.pool), star: 1, items: [] });
    }
  }

  /** Al combatir: rellena el tablero con la banca (en orden) hasta el tope. */
  function autoDeploy() {
    outer:
    for (let r = 4; r < 8; r++) {
      for (let c = 0; c < COLS; c++) {
        if (boardCount() >= cap()) break outer;
        const bi = M.bench.findIndex(u => u);
        if (bi < 0) break outer;
        const k = c + ',' + r;
        if (M.board.has(k)) continue;
        M.board.set(k, M.bench[bi]);
        M.bench[bi] = null;
      }
    }
    starCheck();
  }

  /** Ditto (132) copia la apariencia del aliado más cercano (visual + tipos). */
  function dittoPass(cells) {
    for (const a of cells) {
      if (!a.u || a.u.dex !== 132) continue;
      let best = null, bd = Infinity;
      for (const b of cells) {
        if (b === a || !b.u) continue;
        const d = Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
        if (d < bd) { bd = d; best = b.u; }
      }
      a.u.copied = best ? { dex: best.dex } : null;
    }
  }

  function startFight() {
    const kind = roundKind();
    // Si arrastrabas algo al empezar, se devuelve a su sitio (nada se pierde).
    if (drag && drag.u && drag.from) { putBack(drag.from, drag.u); drag = null; }
    M.armory = null; M.armRects = null;   // la armería caduca al pelear
    M.augDraft = null; M.augRects = null; M.augRefresh = null;   // y los aumentos también
    M.avCast = null;
    ensureFighter();
    autoDeploy();
    M.phase = 'fight'; M.phaseT = FIGHT_T;
    M.units = [];
    M.foes = [];
    // Sinergias: las tuyas y las de la IA (Ditto ya va disfrazado).
    const cellsOf = board => [...board].map(([k, u]) => {
      const [c, r] = String(k).split(',').map(Number);
      return { u, c, r };
    });
    const aiCells = M.ai.team.map(u => ({ u, c: u.c || 0, r: u.r || 0 }));
    dittoPass(cellsOf(M.board));
    dittoPass(aiCells);
    const synList = cells => cells.map(o => {
      const m = G.DEX_BY[o.u.dex];
      const cp = o.u.copied && G.DEX_BY[o.u.copied.dex];
      return cp ? Object.assign({}, m, { types: cp.types }) : m;
    });
    const syn = synergy(synList(cellsOf(M.board)));
    const aiSyn = synergy(synList(aiCells));
    for (const [k, u] of M.board) {
      const [x, y] = cellXY(+k.split(',')[0], +k.split(',')[1]);
      const e = new G.TactUnit(u.dex, u.star, 0, x, y, u.items, u.copied && u.copied.dex);
      e.cost = costOf(u.dex);   // una sola fuente de tier (igual que el tooltip)
      e.cell = k;   // para aplicar objetos en plena pelea
      // Terreno conocido: en rondas salvajes pegas +15% (los salvajes son duros).
      e.syAtk = 1 + syn.bonus + (kind === 'pve' ? 0.15 : 0);
      // Rasgos de maná/defensa + aumento de maná (se gastan al empezar).
      e.mana = Math.min(100, e.mana + (syn.mana || 0) + (M.manaBoost || 0));
      if (syn.def) e.dmgReduce = Math.min(0.75, (e.dmgReduce || 0) + syn.def);
      e.move.t = Math.random() * 0.5;
      M.units.push(e);
    }
    M.manaBoost = 0;
    if (kind === 'pve') {
      const boss = isBossRound();
      M.boss = boss;
      // Usa el plan enseñado en preparación (si no hay, genera de reserva).
      if (!M.foeData || !M.foeData.length) planWilds();
      for (const w of M.foeData) {
        const [x, y] = foeCellXY(w.c, w.r);
        const e = new G.TactUnit(w.dex, w.star, 1, x + G.U.rand(-8, 8), y + G.U.rand(-8, 8));
        e.cost = costOf(w.dex);
        e.syAtk = 1 + Math.min(0.2, M.round * 0.015) + (boss ? 0.10 : 0);
        e.move.t = Math.random() * 0.5;
        M.foes.push(e);
      }
    } else {
      M.boss = false;
      aiToBoard();
      for (const u of M.ai.team) {
        const [x, y] = foeCellXY(u.c, u.r);
        const e = new G.TactUnit(u.dex, u.star, 1, x, y, u.items, u.copied && u.copied.dex);
        e.cost = costOf(u.dex);
        e.syAtk = 1 + aiSyn.bonus;
        e.mana = Math.min(100, e.mana + (aiSyn.mana || 0));
        if (aiSyn.def) e.dmgReduce = Math.min(0.75, (e.dmgReduce || 0) + aiSyn.def);
        e.move.t = Math.random() * 0.5;
        M.foes.push(e);
      }
    }
    M.syn = syn; M.aiSyn = aiSyn;
    G.Combat.setFoeProvider(
      (owner, x, y, r) => (owner.team === 0 ? M.foes : M.units).filter(e => !e.dead && G.U.dist2(x, y, e.x, e.y) <= (r + e.r) * (r + e.r)),
      owner => (owner.team === 0 ? M.foes : M.units).filter(e => !e.dead)
    );
    G.Audio.sfx('boss');
  }

  /** Tipo dominante de un equipo (para el cast del avatar ganador). */
  function domType(cells) {
    const c = {};
    for (const o of cells) for (const t of (((o.u && G.DEX_BY[o.u.dex]) || {}).types || [])) c[t] = (c[t] || 0) + 1;
    let best = 'normal', bn = 0;
    for (const t in c) if (c[t] > bn) { bn = c[t]; best = t; }
    return best;
  }

  function endFight() {
    const alive = M.units.filter(e => !e.dead), foeAlive = M.foes.filter(e => !e.dead);
    const kind = M.lastKind;
    const myPow = alive.reduce((a, e) => a + e.hp, 0), foPow = foeAlive.reduce((a, e) => a + e.hp, 0);
    const win = foeAlive.length === 0 || (alive.length > 0 && myPow >= foPow);
    M.round++;
    // Protección inicial estilo TFT: hasta la ronda 10 nadie cae a 0.
    const hurtProt = (hp, dmg) => Math.max(M.round < 10 ? 1 : 0, hp - dmg);
    // Partidas largas: daño suave con subida tardía (tras la 20 aprieta para cerrar).
    const late = Math.max(0, M.round - 20);
    const econ = g => {
      M.lastEcon = g;
      return '+' + g.total + ' oro (5' + (g.streakB ? ' +' + g.streakB + ' racha' : '') +
        (g.intB ? ' +' + g.intB + ' interés' : '') + (g.pveB ? ' +2 PvE' : '') + ')';
    };
    // Botín por supervivientes: +1 oro por cada 2 vivos al ganar.
    const bountyTxt = () => {
      const b = Math.floor(alive.length / 2);
      if (win && b > 0) { M.gold += b; return ' · +' + b + ' (supervivientes)'; }
      return '';
    };
    // Renta de objetos: amuleto (+2 oro por portador vivo) y huevo (+2 XP si hay portador).
    const rentBonus = () => {
      let t = '', coins = 0, egg = false;
      for (const e of alive) for (const id of (e.items || [])) {
        const parts = String(id).split('+');
        if (parts.includes('coin')) coins += 2;
        if (parts.includes('egg')) egg = true;
      }
      if (coins > 0) { M.gold += coins; t += ' · +' + coins + ' oro (amuleto)'; }
      if (egg) { gainXp(2); t += ' · +2 XP (huevo)'; }
      return t;
    };
    if (kind === 'pvp') {
      if (win) {
        const dmg = 1 + Math.floor(M.round * 0.35) + alive.length + late;
        M.ai.hp = hurtProt(M.ai.hp, dmg);
        M.streak = M.streak >= 0 ? M.streak + 1 : 1;
        const g = income(M, false);
        flash('¡Victoria! -' + dmg + ' al rival · ' + econ(g) + rentBonus() + bountyTxt());
      } else {
        const dmg = 1 + Math.floor(M.round * 0.35) + foeAlive.length + late;
        M.hp = hurtProt(M.hp, dmg);
        M.streak = M.streak <= 0 ? M.streak - 1 : -1;
        const g = income(M, false);
        flash('Derrota... -' + dmg + ' · ' + econ(g));
      }
      M.ai.streak = -M.streak;
    } else {
      if (win) { M.streak = M.streak >= 0 ? M.streak + 1 : 1; }
      else {
        const dmg = 1 + Math.floor(M.round * 0.35) + Math.ceil(foeAlive.length / 2) + late;
        M.hp = hurtProt(M.hp, dmg);
        M.streak = M.streak <= 0 ? M.streak - 1 : -1;
      }
      const g = income(M, true);
      // Botín salvaje: componentes (a veces 2 desde la ronda 8; el jefe da 2 sí o sí).
      let lootTxt = '';
      if (win) {
        const drops = [];
        if (M.boss) { drops.push(G.U.pick(COMP_IDS), G.U.pick(COMP_IDS)); }
        else {
          if (Math.random() < 0.75) drops.push(G.U.pick(COMP_IDS));
          if (M.round >= 8 && Math.random() < 0.35) drops.push(G.U.pick(COMP_IDS));
        }
        for (const id of drops) {
          if (M.items.length < 7) M.items.push(id);
          else M.gold += 3;
        }
        if (drops.length) lootTxt = ' · Botín: ' + drops.map(d => COMPONENTS[d].name).join(' + ');
      }
      flash((win ? '¡Ronda superada! ' : 'Te quitan ' + (1 + Math.floor(M.round * 0.35) + Math.ceil(foeAlive.length / 2) + late) + '. ') + econ(g) + lootTxt + (win ? rentBonus() + bountyTxt() : ''));
    }
    M.units = []; M.foes = [];
    M.avatarT = 1.4; M.avatarWon = win;   // el avatar salta de alegría
    // En PvP, el ganador le lanza su habilidad al otro avatar (sólo visual).
    if (M.lastKind === 'pvp') {
      const [ax, ay, bx, by] = avatarXY();
      const mine = [...M.board].map(([k, u]) => ({ u }));
      const theirs = M.ai.team.map(u => ({ u }));
      const wType = win ? domType(mine) : domType(theirs);
      const col = ((G.U.TYPE_COLOR || {})[wType]) || '#ffd23f';
      M.avCast = win
        ? { x0: ax, y0: ay - 20, x1: bx, y1: by - 20, t: 1.6, t0: 1.6, col, hit: false }
        : { x0: bx, y0: by - 20, x1: ax, y1: ay - 20, t: 1.6, t0: 1.6, col, hit: false };
    } else M.avCast = null;
    G.Projectiles.clear();
    G.Combat.clearFields();
    G.Combat.clearFoeProvider();
    G.Audio.sfx(win ? 'bossDown' : 'gameover');
    if (M.hp <= 0 || M.ai.hp <= 0) return gameOver(M.ai.hp <= 0 && M.hp > 0);
    M.phase = 'prep'; M.phaseT = PREP_T;
    gainXp(2);   // cada ronda da 2 de experiencia, como en el TFT
    // El fijado dura una ronda (como en el TFT): se conserva esta vez y se libera.
    const wasLocked = M.shopLock;
    if (wasLocked) M.shopLock = false;
    else rollShop();
    aiAct();
    planWilds();   // salvajes de la próxima ronda (para el scout)
    // Armería cada 4 rondas (4, 8, 12...): 3 objetos a elegir 1 gratis.
    if ((M.round + 1) % 4 === 0) {
      const pool = COMP_IDS.slice();
      M.armory = [];
      for (let i = 0; i < 3 && pool.length; i++) M.armory.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      G.UI.toast('¡Armería! Elige 1 objeto gratis');
      G.Audio.sfx('legend');
    } else { M.armory = null; M.armRects = null; }
    // Aumentos cada 5 rondas (5, 10, 15...): 3 cartas a elegir 1 efecto.
    if ((M.round + 1) % 5 === 0) {
      draftAugs();
      G.UI.toast('¡Aumento! Elige 1 de 3');
      G.Audio.sfx('legend');
    } else { M.augDraft = null; M.augRects = null; M.augRefresh = null; }
    // Remontada: con 3+ derrotas seguidas, otra tienda gratis (salvo fijada).
    if (M.streak <= -3 && !wasLocked && M.phase === 'prep') {
      rollShop();
      G.UI.toast('¡Remontada! Tienda gratis');
    }
    // Racha de victorias: con 3+ ganadas, +1 tienda gratis.
    if (M.streak >= 3 && M.phase === 'prep') {
      M.freeRolls = (M.freeRolls || 0) + 1;
      G.UI.toast('¡Racha! +1 tienda gratis');
    }
  }

  /** Catálogo de aumentos (se elige 1 de 3). */
  const AUGMENTS = {
    star3: { name: '¡Estrella fugaz!', desc: 'Una unidad aleatoria del tablero sube a ★3', icon: 'star' },
    rare3: { name: 'Refuerzos raros', desc: '3 unidades de tier Raro gratis a la banca', icon: 'medal2' },
    gold15: { name: 'Lluvia de oro', desc: '+15 de oro al instante', icon: 'coin' },
    heal25: { name: 'Centro Pokémon', desc: 'Recuperas 25 de vida', icon: 'berry' },
    cache2: { name: 'Almacén', desc: '2 objetos aleatorios a la tira', icon: 'ball' },
    xp12: { name: 'Caramelo raro', desc: '+12 de XP al instante', icon: 'ticket' },
    rolls3: { name: 'Ojeador', desc: '3 tiendas gratis (tecla D)', icon: 'cards' },
    slot1: { name: 'Banquillo extra', desc: '+1 hueco en tu equipo', icon: 'crown' },
    full1: { name: 'Tesoro', desc: '1 objeto completo aleatorio', icon: 'trophy' },
    clone1: { name: 'Ditto', desc: 'Clona lo más barato de tu banca', icon: 'friends' },
    mana30: { name: 'Energía total', desc: 'Tu equipo sale con +30 de maná', icon: 'shiny' }
  };

  /** Reparte 3 aumentos distintos (evita los que ya se enseñan). */
  function draftAugs(exclude) {
    const pool = Object.keys(AUGMENTS).filter(k => !(exclude || []).includes(k));
    const src = pool.length >= 3 ? pool : Object.keys(AUGMENTS);
    M.augDraft = src.sort(() => Math.random() - 0.5).slice(0, 3);
  }

  /** Aplica el aumento elegido. */
  function applyAugment(key) {
    if (key === 'star3') {
      const cands = [...M.board.values()].filter(u => u.star < 3);
      if (!cands.length) { M.gold += 12; G.UI.toast('Todo al máximo: +12 oro'); }
      else {
        const u = cands[Math.floor(Math.random() * cands.length)];
        u.star = 3;
        // Intenta llegar a la forma final (dos pasos por si es de 3 fases).
        const ev = tftEvoNext(u.dex);
        if (ev) { u.dex = ev; const ev2 = tftEvoNext(u.dex); if (ev2) u.dex = ev2; }
        u.items = u.items || [];
        flash('¡' + G.DEX_BY[u.dex].name + ' ★3!');
        M.evoFx = { dex: u.dex, t: 2.6 };
        G.Audio.sfx('legend');
      }
    } else if (key === 'rare3') {
      const cands = M.pool.filter(d => costOf(d) === 3);
      for (let i = 0; i < 3; i++) {
        const dex = G.U.pick(cands.length ? cands : M.pool);
        const bi = M.bench.findIndex(u => !u);
        if (bi >= 0) M.bench[bi] = { dex, star: 1, items: [] };
        else M.gold += sellValue(dex, 1);
      }
      starCheck();
      G.UI.toast('¡Refuerzos raros en la banca!');
    } else if (key === 'gold15') {
      M.gold += 15;
      G.UI.toast('+15 de oro');
    } else if (key === 'heal25') {
      M.hp = Math.min(100, M.hp + 25);
      G.UI.toast('+25 de vida');
    } else if (key === 'cache2') {
      for (let i = 0; i < 2; i++) {
        const id = G.U.pick(COMP_IDS);
        if (M.items.length < 7) M.items.push(id);
        else M.gold += 3;
      }
      G.UI.toast('+2 objetos a la tira');
    } else if (key === 'xp12') {
      gainXp(12);
      G.UI.toast('+12 XP');
    } else if (key === 'rolls3') {
      M.freeRolls = (M.freeRolls || 0) + 3;
      G.UI.toast('+3 tiendas gratis (D)');
    } else if (key === 'slot1') {
      M.capBonus = (M.capBonus || 0) + 1;
      G.UI.toast('+1 hueco en tu equipo');
    } else if (key === 'full1') {
      const a = G.U.pick(COMP_IDS);
      let b = G.U.pick(COMP_IDS);
      if (b === a) b = COMP_IDS[(COMP_IDS.indexOf(a) + 3) % COMP_IDS.length];
      const id = FULL_OF(a, b);
      if (M.items.length < 7) M.items.push(id);
      else M.gold += 6;
      G.UI.toast('¡' + itemDef(id).name + '!');
    } else if (key === 'clone1') {
      const owned = M.bench.map((u, i) => ({ u, i })).filter(o => o.u);
      if (!owned.length) { M.gold += 8; G.UI.toast('Banca vacía: +8 oro'); }
      else {
        owned.sort((a, b) => costOf(a.u.dex) - costOf(b.u.dex));
        const src = owned[0].u;
        const bi = M.bench.findIndex(u => !u);
        if (bi >= 0) {
          M.bench[bi] = { dex: src.dex, star: 1, items: [] };
          starCheck();
          G.UI.toast('¡Clonado: ' + G.DEX_BY[src.dex].name + '!');
        } else { M.gold += sellValue(src.dex, 1); G.UI.toast('Sin hueco: +' + sellValue(src.dex, 1) + ' oro'); }
      }
    } else if (key === 'mana30') {
      M.manaBoost = 30;
      G.UI.toast('Tu equipo saldrá con +30 de maná');
    }
    G.Audio.sfx('buy');
  }

  function gameOver(win) {
    M.phase = 'over'; M.over = win ? 'win' : 'lose';
    M.avCast = null;
    const s = G.DB.save;
    const coins = win ? 100 + 15 * M.round : 20 + 2 * M.round;
    M.overText = (win ? 'Rival vencido en la ronda ' + M.round + '  ·  +' + coins + ' monedas'
                      : 'Caíste en la ronda ' + M.round + '  ·  +' + coins + ' monedas') +
                 '  ·  Pool global de ' + M.pool.length;
    if (s && !G.DB.guest) {
      s.coins += coins;
      s.stats.tftWins = (s.stats.tftWins || 0) + (win ? 1 : 0);
      G.DB.commit();
    }
    G.Audio.sfx(win ? 'legend' : 'gameover');
  }

  // ---------------- IA rival ----------------

  function aiAct() {
    const A = M.ai;
    if (A.hp <= 0) return;
    income(A, false);
    // +2 de XP por ronda, como tú.
    if (A.level < 9) {
      A.xp += 2;
      while (A.level < 9 && A.xp >= XP_NEED[A.level]) { A.xp -= XP_NEED[A.level]; A.level++; }
    }
    // Sube de nivel si puede permitírselo.
    while (A.level < 9 && A.gold >= 24 && Math.random() < 0.6) {
      A.gold -= 4; A.xp += 4;
      while (A.level < 9 && A.xp >= XP_NEED[A.level]) { A.xp -= XP_NEED[A.level]; A.level++; }
      if (A.gold < 12) break;
    }
    // Compra hasta quedarse con ~10 de oro, prefiriendo sus tipos.
    let guard = 30;
    while (A.gold > 12 && A.team.length + aiBenchCount() < 14 && guard-- > 0) {
      const cost = aiRollCost();
      const pool = M.pool.filter(d => costOf(d) === cost &&
        (Math.random() < 0.7 ? A.favored.includes(G.DEX_BY[d].types[0]) || A.favored.includes(G.DEX_BY[d].types[1]) : true));
      const cands = pool.length ? pool : M.pool.filter(d => costOf(d) === cost);
      if (!cands.length || A.gold < cost) break;
      A.gold -= cost;
      aiAdd({ dex: G.U.pick(cands.length ? cands : M.pool), star: 1, items: [] });
    }
    aiStar();
    aiToBoard();
  }

  function aiBenchCount() { return A_bench().length; }
  function A_bench() { return M.ai.bench || (M.ai.bench = []); }

  function aiAdd(u) {
    const cap = M.ai.level;
    const onBoard = M.ai.team.length;
    if (onBoard < cap) M.ai.team.push(Object.assign({ c: 0, r: 0 }, u));
    else if (A_bench().length < 9) A_bench().push(u);
  }

  function aiStar() {
    const all = [...M.ai.team.map(u => ({ u, from: 't' })), ...A_bench().map(u => ({ u, from: 'b' }))];
    for (let star = 1; star <= 2; star++) {
      const byDex = {};
      for (const a of all) {
        if (!a.u || a.u.star !== star) continue;
        (byDex[a.u.dex] = byDex[a.u.dex] || []).push(a);
      }
      for (const dex in byDex) {
        const g = byDex[dex];
        while (g.length >= 3) {
          const three = g.splice(0, 3);
          for (const o of three) {
            if (o.from === 't') M.ai.team.splice(M.ai.team.indexOf(o.u), 1);
            else A_bench().splice(A_bench().indexOf(o.u), 1);
            const i = all.indexOf(o);
            if (i >= 0) all.splice(i, 1);
          }
          const nu = { dex: +dex, star: star + 1, c: 0, r: 0 };
          M.ai.team.push(nu);
          all.push({ u: nu, from: 't' });
        }
      }
    }
    // Al tablero hasta el tope (cuerpo a cuerpo delante).
    const cap = M.ai.level;
    const bench = A_bench();
    while (M.ai.team.length < cap && bench.length) M.ai.team.push(bench.shift());
    aiToBoard();
  }

  function aiToBoard() {
    const melee = [], back = [];
    for (const u of M.ai.team) {
      const k = (G.Moves.BY_ID[G.startMoveOf(u.dex)] || {}).kind;
      (k === 'melee' || k === 'dash' ? melee : back).push(u);
    }
    // Espía tu tablero: poder por columna (delante/detrás) para contra-posicionar.
    // Los tanques van a por tus carries; los rangos, donde menos melé tengas.
    const frontPow = new Array(COLS).fill(0), backPow = new Array(COLS).fill(0);
    for (const [k, u] of M.board) {
      const [c, r] = k.split(',').map(Number);
      const mon = G.DEX_BY[u.dex];
      const pw = (mon.atk || 1) * [1, 1.6, 2.5][u.star - 1] + (u.items ? u.items.length : 0);
      if (r >= 6) frontPow[c] += pw; else backPow[c] += pw;
    }
    const desc = (pc) => COLS - 1 - pc;   // tu columna -> columna espejo rival
    const dive = [...Array(COLS).keys()].sort((a, b) => backPow[b] - backPow[a]).map(desc);
    const safe = [...Array(COLS).keys()].sort((a, b) => frontPow[a] - frontPow[b]).map(desc);
    const order = [...melee, ...back];
    const cap = M.ai.level;
    const meleePool = dive.slice(0, Math.max(2, Math.ceil(COLS / 2)));
    order.forEach((u, i) => {
      const pool = i < melee.length ? meleePool : safe;
      const front = i < Math.ceil(Math.min(order.length, cap) / 2);
      u.c = pool[i % pool.length];
      u.r = front ? 2 + (i % 2) : 0 + (i % 2);
    });
    // Los que sobran del tope, a la banca (y si no caben, se venden).
    while (M.ai.team.length > cap) {
      const u = M.ai.team.pop();
      if (A_bench().length < 9) A_bench().push(u);
      else A.gold += sellValue(u.dex, u.star);
    }
  }

  function aiRollCost() {
    const w = ODDS[Math.min(9, M.ai.level)], r = Math.random() * 100;
    let acc = 0;
    for (let i = 0; i < 5; i++) { acc += w[i]; if (r < acc) return i + 1; }
    return 1;
  }

  // ---------------- update ----------------

  function update(dt) {
    // Cámara clavada al tablero (pase lo que pase fuera).
    fitCamera();
    if (M) M.lastTick = performance.now();
    // El mundo crece alrededor (si no, quedan zonas negras sin generar).
    G.World.update(dt, G.Camera);
    // Los FX siempre corren (si no, rayos y números se quedan congelados).
    G.FX.update(dt);
    M.phaseT -= dt;
    if (M.flashT > 0) M.flashT -= dt;
    if (M.shopFx > 0) M.shopFx -= dt;
    if (M.buyFx && (M.buyFx.t -= dt) <= 0) M.buyFx = null;
    if (M.avatarT > 0) M.avatarT -= dt;
    if (M.sideMsg && (M.sideMsg.t -= dt) <= 0) M.sideMsg = null;
    if (M.planTip && (M.planTip.t -= dt) <= 0) M.planTip = null;
    if (M.avCast && (M.avCast.t -= dt) <= 0) M.avCast = null;
    if (M.synTip && (M.synTip.t -= dt) <= 0) M.synTip = null;
    if (M.evoFx && (M.evoFx.t -= dt) <= 0) M.evoFx = null;
    if (M.phase === 'prep') {
      if (M.phaseT <= 0) { M.lastKind = roundKind(); startFight(); }
    } else if (M.phase === 'fight') {
      const now = performance.now() / 1000;
      const alive = () => M.units.some(e => !e.dead);
      const foeAlive = () => M.foes.some(e => !e.dead);
      const all = [...M.units, ...M.foes].filter(e => !e.dead);
      for (const u of [...M.units, ...M.foes]) u.update(dt, u.team === 0 ? M.foes : M.units, now);
      separate(all, dt);
      G.Projectiles.update(dt, null, all);
      G.Combat.updateFields(dt);
      unitResolve();
      if (!alive() || !foeAlive() || M.phaseT <= 0) endFight();
    } else if (M.phase === 'over') {
      // (FX ya corre arriba)
    }
  }

  /** Separación: que no se apelotonen encima (se ve cada unidad). */
  function separate(all, dt) {
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        const min = (a.r + b.r) * 1.3;
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-4) continue;
        const d = Math.sqrt(d2), f = (min - d) / min * 110 * dt;
        const nx = dx / d, ny = dy / d;
        a.x += nx * f; a.y += ny * f;
        b.x -= nx * f; b.y -= ny * f;
      }
    }
  }

  /** Proyectiles de unidades contra unidades enemigas (orbes incluidos). */  function unitResolve() {
    const list = G.Projectiles.all();
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      const o = p.owner;
      if (!o || !o.tact) continue;
      const targets = o.team === 0 ? M.foes : M.units;
      if (p.orb) {
        // Orbes: golpean con rehit a lo que tocan, sin gastarse.
        for (const e of targets) {
          if (e.dead) continue;
          if (G.U.dist2(p.x, p.y, e.x, e.y) > (p.r + e.r) * (p.r + e.r)) continue;
          const last = p.hitLog.get(e.id) || -99;
          if (performance.now() / 1000 - last < p.rehit) continue;
          p.hitLog.set(e.id, performance.now() / 1000);
          const k = p.mtype ? G.Types.mult(p.mtype, e.types) : 1;
          e.hurt(p.dmg * k, p.color, 0, 0, 0, null);
        }
        continue;
      }
      const foes = o.team === 0 ? M.foes : M.units;
      let hitSomething = false;
      for (const e of foes) {
        if (e.dead) continue;
        const rr = (p.r + e.r) * (p.r + e.r);
        if (G.U.dist2(p.x, p.y, e.x, e.y) > rr && G.U.dist2(p.px == null ? p.x : p.px, p.py == null ? p.y : p.py, e.x, e.y) > rr) continue;
        if (p.hits && p.hits.has(e.id)) continue;
        if (p.hits) p.hits.add(e.id);
        const k = p.mtype ? G.Types.mult(p.mtype, e.types) * G.Weather.mult(p.mtype) : 1;
        e.hurt(p.dmg * k, p.color, p.vx, p.vy, p.knock || 0, p.mtype ? G.Types.label(G.Types.mult(p.mtype, e.types)) : null);
        G.FX.burst(p.x, p.y - G.LIFT, p.color, 5, 80);
        hitSomething = true;
        if ((p.pierce | 0) > 0) p.pierce--;
        else break;
      }
      if (hitSomething && (p.pierce | 0) <= 0) list.splice(i, 1);
    }
  }

  // ---------------- geometría y cámara ----------------
  // Tablero 7×8 en el mundo (rival arriba r0-3, tú abajo r4-7), banca y tienda
  // debajo, botones y barra arriba. La cámara se ajusta a la pantalla.

  function screen() {
    const c = document.getElementById('game');
    return [c.clientWidth || 800, c.clientHeight || 600];
  }

  /** Posición de los avatares (sujetos a cámara). */
  function avatarXY() {
    const vw = screen()[0] / G.Camera.scale;
    const ax = Math.max(G.Camera.left() + 44, Math.min(M.ox - 58, G.Camera.left() + vw - 44));
    const bx = Math.max(G.Camera.left() + 44, Math.min(M.ox + COLS * CELL + 58, G.Camera.left() + vw - 44));
    return [ax, M.oy + 2 * CELL, bx, M.oy - 2 * CELL];
  }

  function fitCamera() {
    const [w, h] = screen();
    const s = Math.max(0.5, Math.min(1.75, w / 520, h / 800));
    // OJO: hay que fijar w/h a mano (normalmente lo hace Camera.resize);
    // si no, left()/top() descentran todo (fue el bug del tablero a la izquierda).
    G.Camera.scale = s;
    G.Camera.w = w / s;
    G.Camera.h = h / s;
    G.Camera.x = 0; G.Camera.y = 50;
  }

  function toWorld(e) {
    const r = cv.getBoundingClientRect();
    return [G.Camera.left() + (e.clientX - r.left) / G.Camera.scale,
            G.Camera.top() + (e.clientY - r.top) / G.Camera.scale];
  }

  /** Equipa un objeto a una unidad (banca o tablero); combina si hay pareja. */
  function equipItem(u, id) {
    u.items = u.items || [];
    if (u.items.length >= 3) { G.UI.toast('Ya lleva 3 objetos'); return { ok: false }; }
    u.items.push(id);
    // Dos componentes DISTINTOS se combinan solos en uno completo (×1,5).
    const comps = u.items.filter(x => !String(x).includes('+'));
    for (let i = 0; i < comps.length; i++) {
      for (let j = i + 1; j < comps.length; j++) {
        if (comps[i] === comps[j]) continue;
        u.items.splice(u.items.indexOf(comps[i]), 1);
        u.items.splice(u.items.indexOf(comps[j]), 1);
        const full = FULL_OF(comps[i], comps[j]);
        u.items.push(full);
        G.Audio.sfx('legend');
        G.UI.toast('¡Objeto completo: ' + itemDef(full).name + '!');
        return { ok: true, added: full, removed: [comps[i], comps[j]] };
      }
    }
    return { ok: true, added: id, removed: [] };
  }

  function benchXY(i) { return [-187 + i * 42, 250]; }       // 9 huecos de 38
  function itemXY(i) {
    // Columna vertical al borde izquierdo, siempre visible (vacía o no).
    // En pantallas estrechas va arriba (la tienda tapa abajo); si no, abajo.
    const y0 = screen()[0] < 700 ? -140 : 272;
    return [G.Camera.left() + 4, y0 + i * 25];
  }
  function shopXY(i) { return [-262 + i * 106, 300]; }       // 5 cartas de 100×96
  function btnRect(i) { return [-235 + i * 160, 404, 150, 32]; }  // actualizar, XP, combatir
  function lockRect() { return [-271, 404, 28, 32]; }             // fijar tienda

  function ptrToCell(wx, wy) {
    const c = Math.floor((wx - M.ox) / CELL), r = Math.floor((wy - M.oy) / CELL) + 4;
    if (c < 0 || c >= COLS || r < 0 || r >= 8) return null;
    return { c, r, own: r >= 4 };
  }

  // ---------------- dibujo ----------------

  const COST_COL = { 1: '#9aa6b5', 2: '#5fe08a', 3: '#4b9bff', 4: '#c47bff', 5: '#ffd23f' };
  const TIER_ES = { 1: 'Común', 2: 'Poco común', 3: 'Raro', 4: 'Épico', 5: 'Legendario' };

  /* Objetos TFT: 8 objetos equipables (sprites reales del juego). Dos DISTINTOS
     en la misma unidad se combinan solos en uno completo (ambos efectos ×1,5).
     Máx. 3 objetos por unidad. La IA no lleva (ya mira sus tipos). */
  const COMPONENTS = {
    fang:   { name: 'Cinta Elección',  icon: 'choiceband',  desc: '+15% de ataque', fx: { atk: 0.15 } },
    wing:   { name: 'Pañuelo Elección', icon: 'choicescarf', desc: '+12% de velocidad', fx: { spd: 0.12 } },
    orb:    { name: 'Vidasfera',       icon: 'lifeorb',     desc: '+30 de maná inicial', fx: { mana: 30 } },
    plate:  { name: 'Chaleco Asalto',  icon: 'assaultvest', desc: '+12% menos daño', fx: { def: 0.12 } },
    heart:  { name: 'Restos',          icon: 'leftovers',   desc: '+120 de vida', fx: { hp: 120 } },
    glove:  { name: 'Garra Rápida',    icon: 'quickclaw',   desc: '+15% de críticos (×1,5 de daño)', fx: { crit: 0.15 } },
    coin:   { name: 'Moneda Amuleto',  icon: 'amuletcoin',  desc: '+2 de oro por ronda ganada', fx: { gold: 2 } },
    egg:    { name: 'Huevo Suerte',    icon: 'luckyegg',    desc: '+2 de XP por ronda ganada', fx: { xp: 2 } },
    helmet: { name: 'Casco Dentado',   icon: 'rockyhelmet', desc: '+10% menos daño y +60 de vida', fx: { def: 0.10, hp: 60 } },
    bell:   { name: 'Campana Concha',  icon: 'shellbell',   desc: '+8% velocidad y +20 de maná', fx: { spd: 0.08, mana: 20 } }
  };
  const COMP_IDS = Object.keys(COMPONENTS);
  const FULL_OF = (a, b) => [a, b].sort().join('+');
  G.TftItemFx = {};
  for (const id in COMPONENTS) G.TftItemFx[id] = COMPONENTS[id].fx;

  /** Def legible de un objeto (componente o completo). */
  function itemDef(id) {
    if (COMPONENTS[id]) return { name: COMPONENTS[id].name, icon: COMPONENTS[id].icon, full: false };
    const [a, b] = String(id).split('+');
    const A = COMPONENTS[a], B = COMPONENTS[b];
    if (!A || !B) return { name: '?', icon: 'ball', full: true };
    return { name: A.name + ' + ' + B.name, icon: A.icon, full: true };
  }
  G.TftItemDef = itemDef;

  /** Descripción de lo que hace (para tooltips). */
  function itemDesc(id) {
    if (COMPONENTS[id]) return COMPONENTS[id].desc;
    const [a, b] = String(id).split('+');
    const A = COMPONENTS[a], B = COMPONENTS[b];
    if (!A || !B) return '';
    const f = v => (typeof v === 'number' && v < 1 ? '×' + (v * 1.5) : '+' + Math.round(v * 1.5));
    const parts = [];
    for (const [def, key] of [[A, a], [B, b]]) {
      for (const k in def.fx) {
        const v = def.fx[k] * 1.5;
        parts.push(k === 'atk' ? '+' + Math.round(v * 100) + '% ataque'
          : k === 'spd' ? '+' + Math.round(v * 100) + '% velocidad'
          : k === 'mana' ? '+' + Math.round(v) + ' maná inicial'
          : k === 'def' ? '+' + Math.round(v * 100) + '% menos daño'
          : k === 'hp' ? '+' + Math.round(v) + ' vida'
          : k === 'gold' ? '+' + Math.round(v) + ' oro por ronda'
          : k === 'xp' ? '+' + Math.round(v) + ' XP por ronda'
          : '+' + Math.round(v * 100) + '% críticos');
      }
    }
    return parts.join(' · ') + ' (completo)';
  }
  G.TftItemDesc = itemDesc;

  /** Cajita de tooltip en coords de mundo, centrada en (cx, topY): N líneas, nunca corta texto. */
  function tipBox(ctx, lines, cx, topY, color) {
    ctx.save();
    ctx.font = F(700, 11);
    const bw = Math.min(420, Math.max(...lines.map(t => ctx.measureText(t).width)) + 22);
    const vw = screen()[0] / G.Camera.scale;
    const bx = Math.max(G.Camera.left() + 4, Math.min(cx - bw / 2, G.Camera.left() + vw - bw - 4));
    const bh = 10 + lines.length * 14;
    ctx.fillStyle = 'rgba(8,14,28,.93)';
    ctx.fillRect(bx, topY, bw, bh);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.strokeRect(bx + 0.5, topY + 0.5, bw - 1, bh - 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    lines.forEach((t, i) => ctx.fillText(t, bx + bw / 2, topY + 16 + i * 14));
    ctx.restore();
  }

  /** Retrato grande de espera (como en pelea): 64px animado + estrellas.
      En ★3 usa shiny si hay; si no, elipse dorada pegada al sprite. */
  function prepSprite(ctx, dex, pcx, pbot, star) {
    const shiny = star >= 3 && G.Sprites.hasShiny(dex);
    if (star >= 3 && !shiny) {
      // Elipse pegada al sprite (no cuadrada).
      ctx.save();
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.ellipse(pcx, pbot - 30, 25, 31, 0, 0, 6.2832); ctx.stroke();
      ctx.restore();
    }
    drawPortrait(ctx, dex, pcx - 32, pbot - 64, 64, 64, true, star);
    if (star > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.65)';
      ctx.fillRect(pcx - 15, pbot - 2, 30, 14);
      ctx.font = F(800, 11);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('★'.repeat(star), pcx, pbot + 9);
      ctx.restore();
    }
  }

  function drawWorld(ctx) {
    // Base oscura por si algún chunk aún no se generó, y encima el mapa actual.
    ctx.save();
    ctx.fillStyle = '#101a30';
    ctx.fillRect(G.Camera.left() - 40, G.Camera.top() - 40,
                 screen()[0] / G.Camera.scale + 80, screen()[1] / G.Camera.scale + 80);
    ctx.restore();
    G.World.drawGround(ctx, G.Camera);
    // Tinte según la primera generación en juego (cada partida se siente distinta).
    {
      const TINT = { 1: '#3fae5a', 2: '#c9a13b', 3: '#2f7fc9', 4: '#7a6fc9', 5: '#c96a2f', 6: '#c93b8f', 7: '#2fc9b0', 8: '#c92f2f', 9: '#8fc92f' };
      const col = TINT[M.tint] || '#3fae5a';
      ctx.save();
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = col;
      ctx.fillRect(G.Camera.left() - 40, G.Camera.top() - 40,
                   screen()[0] / G.Camera.scale + 80, screen()[1] / G.Camera.scale + 80);
      ctx.restore();
    }
    // Celdas redondeadas sobre el mapa: verdes las tuyas, rojizas las del rival.
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = M.ox + c * CELL, y = M.oy + (r - 4) * CELL;
        ctx.save();
        ctx.globalAlpha = 0.66;
        ctx.fillStyle = r < 4 ? ((c + r) % 2 ? '#5a3038' : '#6b3a44') : ((c + r) % 2 ? '#2e5a33' : '#3a6b3f');
        rr(ctx, x + 1, y + 1, CELL - 2, CELL - 2, 7);
        ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = r < 4 ? 'rgba(255,95,109,.55)' : 'rgba(95,224,138,.5)';
        ctx.lineWidth = 1.5;
        rr(ctx, x + 1, y + 1, CELL - 2, CELL - 2, 7);
        ctx.stroke();
        // Brillo arriba para relieve.
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 6, y + 3, CELL - 12, 3);
        ctx.restore();
      }
    }
    // Línea central en pelea (se ve de qué mitad es cada uno).
    if (M.phase === 'fight') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#f4f8ff';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(M.ox - 6, M.oy);
      ctx.lineTo(M.ox + COLS * CELL + 6, M.oy);
      ctx.stroke();
      ctx.restore();
    }
    // Resalte de celda bajo el arrastre.
    if (drag && drag.cell) {
      const [cx, cy] = [M.ox + drag.cell.c * CELL, M.oy + (drag.cell.r - 4) * CELL];
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = drag.cell.own ? '#5fe08a' : '#ff5f6d';
      ctx.fillRect(cx + 1, cy + 1, CELL - 2, CELL - 2);
      ctx.restore();
    }
    // Unidades ordenadas por Y.
    const items = [...M.units, ...M.foes].sort((a, b) => a.y - b.y);
    for (const u of items) u.draw(ctx);
    // Tooltip en pelea: vida y maná en vivo de la unidad bajo el ratón (sólo PC).
    if (M.phase === 'fight' && G.Touch.hovering()) {
      const ms = G.Input.mouse();
      const rr = cv.getBoundingClientRect();
      const mwx = G.Camera.left() + (ms.x - rr.left) / G.Camera.scale;
      const mwy = G.Camera.top() + (ms.y - rr.top) / G.Camera.scale;
      let hov = null;
      for (const u of items) {
        if (u.dead) continue;
        if (Math.abs(mwx - u.x) < u.r + 14 && mwy < u.y + 6 && mwy > u.y - u.bodyH - 30) { hov = u; break; }
      }
      if (hov) {
        // ¿Sobre uno de sus objetos? Mini-tip del objeto; si no, ficha en vivo.
        let itemTip = null;
        if (hov._itemRects) {
          for (const r of hov._itemRects) {
            if (mwx >= r.x && mwx <= r.x + r.w && mwy >= r.y && mwy <= r.y + r.h) { itemTip = r.id; break; }
          }
        }
        if (itemTip) {
          const def = itemDef(itemTip);
          tipBox(ctx, [def.name, itemDesc(itemTip)], hov.x, hov.y - hov.bodyH - 62, '#ffd23f');
        } else {
          const mon = G.DEX_BY[hov.dex];
          const tier = hov.cost || Math.min(5, mon.rarity || 1);
          const disf = hov.lookDex && hov.lookDex !== hov.dex && G.DEX_BY[hov.lookDex];
          const linesTip = [
            mon.name + ' ' + '★'.repeat(hov.star) + '  ·  T' + tier + ' ' + TIER_ES[tier],
            mon.types.map(t => G.U.TYPE_NAME[t]).join('/') + '  ·  Vida ' + Math.ceil(hov.hp) + '/' + hov.maxHp + '  ·  Maná ' + Math.floor(hov.mana)
          ];
          if (disf) linesTip.push('Disfrazado de ' + G.DEX_BY[hov.lookDex].name);
          tipBox(ctx, linesTip, hov.x, hov.y - hov.bodyH - 58, hov.team === 0 ? '#5fd4ff' : '#ff5f6d');
        }
      }
    }
    // En preparación no hay luchadores: se enseña lo colocado en el tablero (Idle animado).
    if (M.phase === 'prep') {
      for (const [k, u] of M.board) {
        const [cc, rr] = k.split(',').map(Number);
        const cx = M.ox + cc * CELL, cy = M.oy + (rr - 4) * CELL;
        prepSprite(ctx, u.dex, cx + CELL / 2, cy + CELL - 2, u.star);
        // Objetos equipados, en chiquito (arriba a la derecha).
        (u.items || []).forEach((id, i) => {
          G.Icons.draw(ctx, itemDef(id).icon, cx + CELL - 14 - ((u.items.length - 1 - i) * 14), cy + 2, 12);
        });
      }
      // Scout: en rondas PvP se ve el tablero del rival (traslúcido).
      if (roundKind() === 'pvp' && M.ai && M.ai.team && M.ai.team.length) {
        ctx.save();
        ctx.globalAlpha = 0.7;
        for (const u of M.ai.team) {
          if (u.c == null || u.r == null) continue;
          const [fx, fy] = foeCellXY(u.c, u.r);
          drawPortrait(ctx, u.dex, fx - 32, fy - 32, 64, 64, true, u.star);
        }
        ctx.restore();
        for (const u of M.ai.team) {
          if (u.c == null || u.r == null) continue;
          const [fx, fy] = foeCellXY(u.c, u.r);
          ctx.save();
          ctx.fillStyle = 'rgba(0,0,0,.65)';
          ctx.fillRect(fx - 15, fy + 30, 30, 14);
          ctx.font = F(800, 11);
          ctx.textAlign = 'center';
          ctx.fillStyle = '#ffd23f';
          ctx.fillText('★'.repeat(u.star), fx, fy + 41);
          ctx.restore();
        }
        ctx.save();
        ctx.font = F(800, 12);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#c47bff';
        ctx.fillText('— RIVAL Nv.' + M.ai.level + ' (' + M.ai.team.length + ') —', M.ox + (COLS * CELL) / 2, M.oy - 4 * CELL - 12);
        ctx.restore();
      }
      // Scout salvaje: lo que viene (el jefe, en rojo).
      else if (roundKind() === 'pve' && M.foeData && M.foeData.length) {
        const boss = isBossRound();
        ctx.save();
        ctx.globalAlpha = 0.75;
        for (const w of M.foeData) {
          const [fx, fy] = foeCellXY(w.c, w.r);
          drawPortrait(ctx, w.dex, fx - 32, fy - 32, 64, 64, true, w.star);
        }
        ctx.restore();
        for (const w of M.foeData) {
          const [fx, fy] = foeCellXY(w.c, w.r);
          ctx.save();
          ctx.fillStyle = 'rgba(0,0,0,.65)';
          ctx.fillRect(fx - 15, fy + 30, 30, 14);
          ctx.font = F(800, 11);
          ctx.textAlign = 'center';
          ctx.fillStyle = '#ffd23f';
          ctx.fillText('★'.repeat(w.star), fx, fy + 41);
          ctx.restore();
        }
        ctx.save();
        ctx.font = F(800, 12);
        ctx.textAlign = 'center';
        ctx.fillStyle = boss ? '#ff5f6d' : '#5fe08a';
        ctx.fillText(boss ? '— ¡JEFE! (' + M.foeData.length + ') —' : '— SALVAJES (' + M.foeData.length + ') —',
          M.ox + (COLS * CELL) / 2, M.oy - 4 * CELL - 12);
        ctx.restore();
      }
    }
    // Avatares tácticos: el tuyo siempre; el rival sólo cuando luchas contra él.
    // El ganador le lanza su habilidad al otro (área, del color de su tipo).
    {
      // El rival sale en PvP... y se queda mientras vuela su cast de celebración.
      const showRival = (M.phase === 'fight' ? M.lastKind === 'pvp' : roundKind() === 'pvp') || (M.avCast && M.avCast.t > 0);
      const t = performance.now() / 1000;
      const idle = Math.sin(t * 2.2) * 3;
      const bounce = M.avatarT > 0 ? Math.abs(Math.sin(M.avatarT * 6)) * 18 : 0;
      const [ax, ay, bx, by] = avatarXY();
      const S = 72;
      const aWon = M.avatarT > 0 && M.avatarWon, bWon = M.avatarT > 0 && !M.avatarWon && showRival;
      const figs = [[ax, ay, '#5fd4ff', aWon, 25, 'TÚ', M.hp, '#ff6b7a']];
      if (showRival) figs.push([bx, by, '#c47bff', bWon, 52, 'RIVAL', M.ai.hp, '#c47bff']);
      for (const [cx, cy, col, won, dex, label, hp, hpCol] of figs) {
        const lift = idle * 0.4 + (won ? bounce : 0);
        // Aro del equipo en el suelo.
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = col;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(cx, cy + S / 2 - 4, S * 0.55, S * 0.22, 0, 0, 6.2832); ctx.stroke();
        ctx.restore();
        // Sombra + retrato grande animado.
        G.Sprites.drawShadow(ctx, dex, cx, cy + S / 2 - 4, 1);
        drawPortrait(ctx, dex, cx - S / 2, cy - S / 2 - lift, S, S, true);
      }
      ctx.save();
      ctx.font = F(800, 13);
      ctx.textAlign = 'center';
      for (const [cx, cy, , , , label, hp, hpCol] of figs) {
        ctx.fillStyle = label === 'TÚ' ? '#5fd4ff' : '#c47bff';
        ctx.fillText(label, cx, cy + S / 2 + 16);
        // Vida encima de cada avatar (siempre a la vista).
        const ht = '❤ ' + Math.max(0, Math.ceil(hp));
        ctx.font = F(800, 12);
        const tw = ctx.measureText(ht).width + 18;
        const px = cx - tw / 2, py = cy - S / 2 - 34;
        ctx.fillStyle = 'rgba(6,10,20,.85)';
        ctx.fillRect(px, py, tw, 20);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = hpCol;
        ctx.strokeRect(px + 0.5, py + 0.5, tw - 1, 19);
        ctx.fillStyle = 'rgba(0,0,0,.6)';
        ctx.fillRect(px + 4, py + 15, tw - 8, 2);
        ctx.fillStyle = hpCol;
        ctx.fillRect(px + 4, py + 15, (tw - 8) * Math.max(0, Math.min(1, hp / 100)), 2);
        ctx.fillStyle = '#fff';
        ctx.fillText(ht, cx, py + 13);
        ctx.font = F(800, 13);
      }
      ctx.restore();
      // Habilidad del ganador al perdedor (sólo PvP, cosmética).
      if (M.avCast && M.avCast.t > 0) {
        const c = M.avCast, k = 1 - c.t / c.t0;
        const px = c.x0 + (c.x1 - c.x0) * k, py = c.y0 + (c.y1 - c.y0) * k - Math.sin(k * Math.PI) * 60;
        if (k < 0.85) {
          ctx.save();
          ctx.fillStyle = c.col;
          ctx.shadowColor = c.col;
          ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.arc(px, py, 7, 0, 6.2832); ctx.fill();
          ctx.restore();
          if (((k * 60) | 0) % 3 === 0) G.FX.spark(px, py, c.col, 0, 0, 1);
        } else {
          if (!c.hit) { c.hit = true; G.Audio.sfx('hit'); }
          G.FX.ring(c.x1, c.y1, 8, 90, c.col, 0.4, 4);
          G.FX.burst(c.x1, c.y1, c.col, 6, 110);
        }
      }
      // Avisos junto al avatar (izquierda, sin tapar tienda): 1-2 líneas.
      if (M.sideMsg && M.sideMsg.t > 0) {
        const [sax, say2] = avatarXY();
        let lines = [M.sideMsg.text];
        if (M.sideMsg.text.length > 46) {
          const mid = Math.floor(M.sideMsg.text.length / 2);
          let cut = M.sideMsg.text.lastIndexOf(' ', mid + 6);
          if (cut < 10) cut = mid;
          lines = [M.sideMsg.text.slice(0, cut), M.sideMsg.text.slice(cut + 1)];
        }
        // Anclada a la izquierda del avatar.
        ctx.save();
        ctx.font = F(700, 11);
        const bw = Math.min(300, Math.max(...lines.map(t => ctx.measureText(t).width)) + 22);
        const bh = 10 + lines.length * 14;
        const bx = Math.max(G.Camera.left() + 4, sax - 60 - bw);
        const by = say2 - bh / 2;
        ctx.fillStyle = 'rgba(8,14,28,.93)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffd23f';
        ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        lines.forEach((t, i) => ctx.fillText(t, bx + bw / 2, by + 16 + i * 14));
        ctx.restore();
      }
    }
    G.Combat.drawGroundFields(ctx);
    G.Projectiles.draw(ctx);
    G.Combat.drawAirFields(ctx);
    G.FX.draw(ctx);
    drawStandby(ctx);
  }

  /** Banca, tienda y botones (coords de mundo, debajo del tablero). */
  function drawStandby(ctx) {
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    // Tira de objetos vertical al borde izquierdo: siempre visible, arrastra para equipar.
    {
      const [lx, ly] = itemXY(0);
      ctx.textAlign = 'left';
      ctx.font = F(700, 10);
      ctx.fillStyle = '#8fa3c4';
      ctx.fillText('OBJETOS', lx - 2, ly - 6);
      for (let i = 0; i < 7; i++) {
        const [x, y] = itemXY(i);
        const id = M.items[i];
        if (!id) {
          ctx.fillStyle = 'rgba(0,0,0,.35)';
          ctx.fillRect(x, y, 26, 26);
          continue;
        }
        const def = itemDef(id);
        ctx.fillStyle = 'rgba(16,26,48,.92)';
        ctx.fillRect(x, y, 26, 26);
        ctx.lineWidth = id.includes('+') ? 2 : 1;
        ctx.strokeStyle = id.includes('+') ? '#ffd23f' : 'rgba(140,170,210,.4)';
        ctx.strokeRect(x + 0.5, y + 0.5, 25, 25);
        G.Icons.draw(ctx, def.icon, x + 4, y + 4, 18);
      }
      // Tooltip de objeto (PC, tira de objetos).
      if (G.Touch.hovering()) {
        const ms = G.Input.mouse();
        const rr = cv.getBoundingClientRect();
        const mwx = G.Camera.left() + (ms.x - rr.left) / G.Camera.scale;
        const mwy = G.Camera.top() + (ms.y - rr.top) / G.Camera.scale;
        for (let i = 0; i < M.items.length; i++) {
          const [x, y] = itemXY(i);
          if (mwx >= x && mwx <= x + 26 && mwy >= y && mwy <= y + 26) {
            const id = M.items[i];
            const def = itemDef(id);
            tipBox(ctx, [def.name, itemDesc(id), 'arrastra a una unidad para equipar'],
              x + 13, y - 56, id.includes('+') ? '#ffd23f' : 'rgba(140,170,210,.9)');
            break;
          }
        }
      }
    }
    // Banca.
    ctx.textAlign = 'left';
    ctx.font = F(700, 11);
    ctx.fillStyle = '#8fa3c4';
    ctx.fillText('BANCA ' + boardCount() + '/' + cap(), -187, 242);
    for (let i = 0; i < BENCH; i++) {
      const [x, y] = benchXY(i);
      const bu = M.bench[i];
      ctx.fillStyle = bu ? 'rgba(16,26,48,.92)' : 'rgba(0,0,0,.5)';
      rr(ctx, x, y, 38, 38, 7); ctx.fill();
      // ★3: elipse dorada pegada al retrato (salvo shiny); si no, marco de coste.
      if (bu && bu.star >= 3 && !G.Sprites.hasShiny(bu.dex)) {
        ctx.save();
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#ffd23f';
        ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.ellipse(x + 19, y + 18, 16, 17, 0, 0, 6.2832); ctx.stroke();
        ctx.restore();
      } else {
        ctx.lineWidth = bu ? 2 : 1;
        ctx.strokeStyle = bu ? COST_COL[costOf(bu.dex)] : 'rgba(140,170,210,.3)';
        rr(ctx, x, y, 38, 38, 7); ctx.stroke();
      }
      const u = bu;
      if (u && !(drag && drag.from.zone === 'bench' && drag.from.i === i) && !(M.buyFx && M.buyFx.t > 0 && M.buyFx.bi === i)) {
        drawPortrait(ctx, u.dex, x + 2, y + 2, 34, 34, true, u.star);
        ctx.fillStyle = '#ffd23f';
        ctx.font = F(800, 9);
        ctx.textAlign = 'center';
        ctx.fillText('★'.repeat(u.star), x + 19, y + 36);
        ctx.textAlign = 'left';
      }
    }
    // Tienda: SIEMPRE visible (en pelea atenuada y sin comprar).
    const shopHov = (G.Touch.hovering() && M.phase === 'prep') ? (() => {
      const ms = G.Input.mouse();
      const r0 = cv.getBoundingClientRect();
      return [G.Camera.left() + (ms.x - r0.left) / G.Camera.scale, G.Camera.top() + (ms.y - r0.top) / G.Camera.scale];
    })() : null;
    for (let i = 0; i < SHOPN; i++) {
      const [x, y0] = shopXY(i);
      const dex = M.shop[i];
      // Entrada en cascada al actualizar + salto al pasar el ratón.
      const pop = M.shopFx > 0 ? Math.max(0, Math.min(1, (M.shopFx - i * 0.05) / 0.3)) : 0;
      const hov = dex != null && shopHov && shopHov[0] >= x && shopHov[0] <= x + 100 && shopHov[1] >= y0 && shopHov[1] <= y0 + 96;
      const y = y0 - (hov ? 3 : 0) - pop * 26;
      ctx.save();
      if (M.phase !== 'prep') ctx.globalAlpha = 0.55;
      else if (pop > 0) ctx.globalAlpha = 1 - 0.6 * pop;
      ctx.fillStyle = dex == null ? 'rgba(0,0,0,.3)' : 'rgba(16,26,48,.92)';
      ctx.fillRect(x, y, 100, 96);
      ctx.lineWidth = hov ? 3 : 2;
      ctx.strokeStyle = dex == null ? 'rgba(140,170,210,.15)' : hov ? '#ffffff' : COST_COL[costOf(dex)];
      if (hov) { ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 14; }
      ctx.strokeRect(x + 1, y + 1, 98, 94);
      ctx.shadowBlur = 0;
      // Planificado: marco blanco + estrella (además del color de tier).
      const planned = dex != null && M.plan.includes(dex);
      if (planned) {
        ctx.save();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = 0.65 + 0.35 * Math.sin(performance.now() / 240);
        ctx.strokeRect(x + 4, y + 4, 92, 88);
        ctx.restore();
        ctx.fillStyle = '#fff';
        ctx.font = F(800, 13);
        ctx.textAlign = 'right';
        ctx.fillText('★', x + 94, y + 30);
        ctx.textAlign = 'center';
      }
      if (dex != null) {
        const mon = G.DEX_BY[dex];
        // Pareja: el retrato salta y el marco dorado palpita.
        const pair = M.phase === 'prep' && pairCount(dex) > 0;
        const jump = pair ? Math.abs(Math.sin(performance.now() / 300 + i * 1.3)) * 5 : 0;
        drawPortrait(ctx, dex, x + 8, y + 2 - jump, 84, 58, true);
        if (pair) {
          ctx.save();
          ctx.globalAlpha = 0.55 + 0.4 * Math.sin(performance.now() / 180);
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#ffd23f';
          ctx.strokeRect(x + 1, y + 1, 98, 94);
          ctx.restore();
        }
        // Tag de tier (izq) + tecla de compra (der).
        ctx.fillStyle = 'rgba(0,0,0,.65)';
        ctx.fillRect(x + 4, y + 4, 26, 15);
        ctx.fillStyle = COST_COL[costOf(dex)];
        ctx.font = F(800, 10);
        ctx.textAlign = 'left';
        ctx.fillText('T' + costOf(dex), x + 8, y + 15);
        ctx.fillStyle = 'rgba(0,0,0,.65)';
        ctx.fillRect(x + 78, y + 4, 18, 15);
        ctx.fillStyle = '#8fa3c4';
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), x + 87, y + 15);
        ctx.font = F(800, 11);
        ctx.fillStyle = pair ? '#ffd23f' : '#fff';
        ctx.fillText((pair ? '★ ' : '') + mon.name.slice(0, 14), x + 50, y + 72);
        // Tipos a la izq + coste en píldora a la der.
        mon.types.slice(0, 2).forEach((t, ti) => G.Icons.draw(ctx, 'type:' + t, x + 6 + ti * 18, y + 76, 16));
        const afford = M.gold >= costOf(dex);
        ctx.fillStyle = afford ? 'rgba(60,44,10,.95)' : 'rgba(0,0,0,.55)';
        ctx.fillRect(x + 44, y + 76, 50, 17);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = afford ? '#ffd23f' : 'rgba(140,170,210,.3)';
        ctx.strokeRect(x + 44.5, y + 76.5, 49, 16);
        ctx.font = F(800, 12);
        ctx.fillStyle = afford ? '#ffd23f' : '#8a7a5a';
        ctx.fillText('◉' + costOf(dex), x + 69, y + 89);
      }
      ctx.restore();
    }
    // Tienda y botones: valen en preparación Y en pelea (el tablero, sólo en preparación).
    if (M.phase === 'prep' || M.phase === 'fight') {
      const inPrep = M.phase === 'prep';
      // Ratón en coords de mundo para hovers (sólo PC).
      let mwx = -9999, mwy = -9999;
      if (G.Touch.hovering()) {
        const ms = G.Input.mouse();
        const r0 = cv.getBoundingClientRect();
        mwx = G.Camera.left() + (ms.x - r0.left) / G.Camera.scale;
        mwy = G.Camera.top() + (ms.y - r0.top) / G.Camera.scale;
      }
      const hovBtn = (x, y, w2, h2) => mwx >= x && mwx <= x + w2 && mwy >= y && mwy <= y + h2;
      for (let i = 0; i < SHOPN; i++) {
        const [x, y] = shopXY(i);
        const dex = M.shop[i];
        if (dex == null) continue;
        // Hover: borde blanco (el parpadeo de pareja ya salió arriba).
        ctx.lineWidth = hovBtn(x, y, 100, 96) ? 3.5 : 2;
        ctx.strokeStyle = hovBtn(x, y, 100, 96) ? '#ffffff' : COST_COL[costOf(dex)];
        ctx.strokeRect(x + 1, y + 1, 98, 94);
      }
      // Botones (en pelea, sin ¡Combatir!).
      const updLbl = (M.freeRolls || 0) > 0 ? 'Actualizar ¡GRATIS! (D)' : 'Actualizar · 2 (D)';
      const updOk = (M.freeRolls || 0) > 0 || M.gold >= 2;
      const labels = inPrep
        ? [[updLbl, updOk], ['XP · 4 (F) Nv.' + M.level, M.gold >= 4 && M.level < 9],
           [M.phaseT > 9 ? '¡Combatir! (' + Math.ceil(M.phaseT) + ')' : '¡Combatir!', true]]
        : [[updLbl, updOk], ['XP · 4 (F) Nv.' + M.level, M.gold >= 4 && M.level < 9]];
      {
        const [lx, ly, lw, lh] = lockRect();
        const hov = hovBtn(lx, ly, lw, lh);
        ctx.fillStyle = M.shopLock ? 'rgba(60,44,10,.95)' : hov ? 'rgba(30,42,66,.95)' : 'rgba(10,16,28,.6)';
        rr(ctx, lx, ly, lw, lh, 7); ctx.fill();
        ctx.lineWidth = hov ? 3 : 2;
        ctx.strokeStyle = M.shopLock ? '#ffd23f' : hov ? '#eaf2ff' : 'rgba(140,170,210,.25)';
        rr(ctx, lx, ly, lw, lh, 7); ctx.stroke();
        // Candadito: arco + cuerpo (dorado si fija, gris si no).
        const col = M.shopLock ? '#ffd23f' : hov ? '#eaf2ff' : '#8fa3c4';
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(lx + lw / 2, ly + 13, 6, Math.PI, 0);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.fillRect(lx + lw / 2 - 7, ly + 13, 14, 10);
      }
      labels.forEach((L, i) => {
        const [x, y, w2, h2] = btnRect(i);
        const hov = hovBtn(x, y, w2, h2);
        const base = i === 2 ? [200, 40, 70] : [20, 32, 56];
        const hi = hov && L[1] ? 22 : 0;
        ctx.fillStyle = L[1] ? `rgba(${base[0] + hi},${base[1] + hi},${base[2] + hi},.95)` : 'rgba(10,16,28,.6)';
        rr(ctx, x, y, w2, h2, 8); ctx.fill();
        ctx.lineWidth = hov && L[1] ? 3 : 2;
        ctx.strokeStyle = L[1] ? (i === 2 ? '#ff8a96' : '#ffd23f') : 'rgba(140,170,210,.25)';
        if (hov && L[1]) { ctx.save(); ctx.shadowColor = L[1] ? '#ffd23f' : '#fff'; ctx.shadowBlur = 12; rr(ctx, x, y, w2, h2, 8); ctx.stroke(); ctx.restore(); }
        else { rr(ctx, x, y, w2, h2, 8); ctx.stroke(); }
        ctx.textAlign = 'center';
        ctx.font = F(800, 13);
        ctx.fillStyle = L[1] ? '#fff' : '#8fa3c4';
        ctx.fillText(L[0], x + w2 / 2, y + 21);
      });
      // Anillo de experiencia junto al avatar (siempre visible): grande, color por nivel.
      {
        const LVL_COL = { 1: '#9aa6b5', 2: '#5fe08a', 3: '#4b9bff', 4: '#4b9bff', 5: '#c47bff', 6: '#c47bff', 7: '#ff9a4d', 8: '#ff5f6d', 9: '#ffd23f' };
        const need = XP_NEED[M.level] || 1, frac = M.level >= 9 ? 1 : Math.min(1, M.xp / need);
        const lc = LVL_COL[Math.min(9, M.level)];
        const [avx, avy] = avatarXY();
        const cx = avx, cy = avy + 102, cr = 23;
        M.xpRing = { x: cx - cr, y: cy - cr, w: cr * 2, h: cr * 2 };
        ctx.beginPath(); ctx.arc(cx, cy, cr, 0, 6.2832);
        ctx.fillStyle = 'rgba(10,16,28,.88)'; ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(140,170,210,.25)';
        ctx.stroke();
        if (frac > 0) {
          ctx.save();
          if (frac >= 0.75 && M.level < 9) { ctx.shadowColor = lc; ctx.shadowBlur = 14; }
          ctx.beginPath();
          ctx.arc(cx, cy, cr - 3, -Math.PI / 2, -Math.PI / 2 + 6.2832 * frac);
          ctx.lineWidth = 6;
          ctx.strokeStyle = lc;
          ctx.stroke();
          ctx.restore();
        }
        ctx.textAlign = 'center';
        ctx.font = F(800, 13);
        ctx.fillStyle = '#fff';
        ctx.fillText('Nv.' + M.level, cx, cy + 1);
        // XP actual bien legible: pastilla oscura + texto grande en color de nivel.
        {
          const txt = M.level >= 9 ? 'MÁX' : M.xp + '/' + need + ' XP';
          ctx.font = F(800, 12);
          const tw = ctx.measureText(txt).width + 18;
          ctx.fillStyle = 'rgba(6,10,20,.88)';
          const bx = cx - tw / 2, by = cy + 24;
          ctx.fillRect(bx, by, tw, 20);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = lc;
          ctx.strokeRect(bx + 0.5, by + 0.5, tw - 1, 19);
          ctx.fillStyle = lc;
          ctx.fillText(txt, cx, by + 14);
        }
      }
      // Tooltip del anillo (sólo PC): progreso + odds del siguiente nivel.
      if (G.Touch.hovering() && M.xpRing) {
        const ms = G.Input.mouse();
        const r0 = cv.getBoundingClientRect();
        const mwx = G.Camera.left() + (ms.x - r0.left) / G.Camera.scale;
        const mwy = G.Camera.top() + (ms.y - r0.top) / G.Camera.scale;
        const z = M.xpRing;
        if (mwx >= z.x && mwx <= z.x + z.w && mwy >= z.y && mwy <= z.y + z.h) {
          const need = XP_NEED[M.level] || 0;
          const lines = [M.level >= 9 ? 'Nivel máximo (9)'
            : 'Nv.' + M.level + ': ' + M.xp + '/' + need + ' XP · faltan ' + (need - M.xp) + ' para Nv.' + (M.level + 1)];
          if (M.level < 9) {
            const nx = ODDS[Math.min(9, M.level + 1)];
            lines.push('Nv.' + (M.level + 1) + ': ' + nx.map((p, i) => p > 0 ? 'T' + (i + 1) + ' ' + p + '%' : null).filter(Boolean).join(' · '));
          }
          const [avx2, avy2] = avatarXY();
          tipBox(ctx, lines, avx2, avy2 + 102 - 23 - (10 + lines.length * 14) - 10, '#ffd23f');
        }
      }
      // Tooltip de tienda con el ratón (sólo PC).
      if (G.Touch.hovering()) {
        const ms = G.Input.mouse();
        const r = cv.getBoundingClientRect();
        const mwx = G.Camera.left() + (ms.x - r.left) / G.Camera.scale;
        const mwy = G.Camera.top() + (ms.y - r.top) / G.Camera.scale;
        const si = hitShop(mwx, mwy);
        if (si >= 0 && M.shop[si] != null) drawShopTip(ctx, M.shop[si], -262 + si * 106 + 50);
        else {
          // ... y también sobre tablero y banca.
          let hov = null;
          const bc = ptrToCell(mwx, mwy);
          if (bc && bc.own) {
            const u = M.board.get(bc.c + ',' + bc.r);
            if (u) hov = { dex: u.dex, star: u.star, items: u.items, x: M.ox + bc.c * CELL + CELL / 2, y: M.oy + (bc.r - 4) * CELL };
          }
          if (!hov) {
            const bi = hitBench(mwx, mwy);
            if (bi >= 0 && M.bench[bi]) {
              const [bx2, by2] = benchXY(bi);
              hov = { dex: M.bench[bi].dex, star: M.bench[bi].star, items: M.bench[bi].items, x: bx2 + 19, y: by2 };
            }
          }
          if (hov) drawUnitTip(ctx, hov.dex, hov.star, hov.x, hov.y - 8, hov.items);
        }
      }
    } else {
      // En pelea: pastilla arriba del tablero con vivos y tiempo (ya no abajo).
      const alive = M.units.filter(e => !e.dead).length, fo = M.foes.filter(e => !e.dead).length;
      const txt = alive + ' — ' + fo + '   ·   ' + Math.ceil(M.phaseT) + 's';
      ctx.font = F(800, 14);
      const tw = ctx.measureText(txt).width + 36;
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      rr(ctx, -tw / 2, -296, tw, 26, 13);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = alive >= fo ? 'rgba(95,224,138,.7)' : 'rgba(255,95,109,.7)';
      rr(ctx, -tw / 2, -296, tw, 26, 13);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(txt, 0, -278);
    }
    // Fantasma arrastrado (unidad u objeto).
    if (drag) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      if (drag.kind === 'item') {
        const def = itemDef(drag.id);
        ctx.fillStyle = 'rgba(16,26,48,.92)';
        ctx.fillRect(drag.x - 20, drag.y - 20, 40, 40);
        ctx.lineWidth = 2;
        ctx.strokeStyle = drag.id.includes('+') ? '#ffd23f' : 'rgba(140,170,210,.5)';
        ctx.strokeRect(drag.x - 19, drag.y - 19, 38, 38);
        G.Icons.draw(ctx, def.icon, drag.x - 13, drag.y - 13, 26);
      } else if (drag.u) {
        drawPortrait(ctx, drag.u.dex, drag.x - 24, drag.y - 24, 48, 48, false, drag.u.star);
      }
      ctx.restore();
    }
    // Vuelo de compra: de la carta a la banca en arco.
    if (M.buyFx && M.buyFx.t > 0) {
      const f = M.buyFx;
      const k = 1 - f.t / f.t0;
      const x = f.x0 + (f.x1 - f.x0) * k;
      const y = f.y0 + (f.y1 - f.y0) * k - Math.sin(k * Math.PI) * 46;
      ctx.save();
      ctx.globalAlpha = 1 - k * 0.15;
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 12;
      drawPortrait(ctx, f.dex, x - 17, y - 17, 34, 34);
      ctx.restore();
      G.FX.spark(x, y, '#ffd23f', 0, 0, 1);
    }
    ctx.restore();
  }

  function drawScreen(ctx, w, h) {
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    G.World.drawVignette(ctx, w, h);
    // En peleas de jefe, marco rojo pulsante.
    if (M.phase === 'fight' && M.boss) {
      const a = 0.35 + 0.2 * Math.sin(performance.now() / 300);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#ff2f4d';
      ctx.strokeRect(5, 5, w - 10, h - 10);
      ctx.restore();
    }
    // Botón salir (a elegir modo): siempre visible menos en la pantalla final.
    if (M.phase !== 'over') {
      ctx.beginPath();
      ctx.arc(w - 26, 72, 13, 0, 6.2832);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(244,248,255,.7)';
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = F(800, 13);
      ctx.fillStyle = '#f4f8ff';
      ctx.fillText('✕', w - 26, 77);
    }
    // Barra superior en pastillas: tu vida, rival, ronda y oro.
    ctx.font = F(800, 15);
    const hpT = '❤ ' + Math.max(0, Math.ceil(M.hp));    const rvT = 'Rival ' + Math.max(0, Math.ceil(M.ai.hp)) + ' Nv.' + M.ai.level;
    const kindPre = M.phase === 'fight'
      ? (M.lastKind === 'pvp' ? ' · ¡LUCHA vs RIVAL!' : (M.boss ? ' · ¡JEFE! (+15%)' : ' · ¡SALVAJES! (+15%)'))
      : ' · (' + (roundKind() === 'pvp' ? 'Rival' : (isBossRound() ? '¡JEFE! (+15%)' : 'Salvajes +15%')) + ')';
    const midT = 'RONDA ' + (M.round + 1) + kindPre + ((M.phase !== 'over' && M.round + 1 <= 9) ? ' 🛡' : '');
    ctx.textAlign = 'left';
    const hw = ctx.measureText(hpT).width + 24, rw = ctx.measureText(rvT).width + 24;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    rr(ctx, 8, 8, hw, 30, 9); ctx.fill();
    rr(ctx, 12 + hw, 8, rw, 30, 9); ctx.fill();
    ctx.textAlign = 'center';
    const midW = ctx.measureText(midT).width + 36;
    ctx.fillStyle = M.phase === 'fight' ? 'rgba(60,12,20,.7)' : 'rgba(0,0,0,.55)';
    rr(ctx, w / 2 - midW / 2, 8, midW, 30, 9); ctx.fill();
    ctx.fillStyle = '#ff6b7a';
    ctx.textAlign = 'left';
    // Con poca vida, la píldora parpadea en rojo.
    const danger = M.hp > 0 && M.hp <= 15 && Math.floor(performance.now() / 400) % 2 === 0;
    if (danger) {
      ctx.fillStyle = 'rgba(120,10,20,.7)';
      rr(ctx, 8, 8, hw, 30, 9); ctx.fill();
    }
    ctx.fillText(hpT + (M.hp > 0 && M.hp <= 15 ? ' ¡PELIGRO!' : ''), 20, 29);
    ctx.fillStyle = '#c47bff';
    ctx.fillText(rvT, 24 + hw, 29);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(midT, w / 2, 29);
    // Barras de vida bajo cada pastilla.
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(20, 32, hw - 24, 3);
    ctx.fillStyle = '#ff5f6d';
    ctx.fillRect(20, 32, (hw - 24) * Math.max(0, M.hp / 100), 3);
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(24 + hw, 32, rw - 24, 3);
    ctx.fillStyle = '#c47bff';
    ctx.fillRect(24 + hw, 32, (rw - 24) * Math.max(0, M.ai.hp / 100), 3);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd23f';
    const stk = M.streak > 1 ? '   W' + M.streak : M.streak < -1 ? '   L' + (-M.streak) : '';
    ctx.fillText('◉ ' + M.gold + '   Nv.' + M.level + ' ' + M.xp + '/' + (XP_NEED[M.level] || '—') + stk, w - 12, 29);
    // Barra de rondas (ventana deslizante de 20): verde salvajes, morado rival, ★ jefe.
    {
      const N = 20, cur = M.round + 1;
      const start = Math.max(1, cur - 9);
      const bw = Math.min(w - 24, N * 22);
      const x0 = w / 2 - bw / 2, y0 = 50;
      ctx.font = F(700, 9);
      ctx.textAlign = 'center';
      for (let k = 0; k < N; k++) {
        const r = start + k;
        const cx = x0 + (k + 0.5) * (bw / N);
        const boss = isBossR(r), pvp = kindOf(r) === 'pvp';
        ctx.globalAlpha = r < cur ? 0.35 : 1;
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.beginPath(); ctx.arc(cx, y0, 8, 0, 6.2832); ctx.fill();
        if (r === cur) { ctx.lineWidth = 2; ctx.strokeStyle = '#ffd23f'; ctx.stroke(); }
        ctx.fillStyle = boss ? '#ff5f6d' : pvp ? '#c47bff' : '#5fe08a';
        ctx.fillText(boss ? '★' : String(r), cx, y0 + 3);
      }
      ctx.globalAlpha = 1;
    }
    // Tooltip de la barra (PC): qué trae cada ronda.
    if (G.Touch.hovering()) {
      const ms = G.Input.mouse();
      const r0 = cv.getBoundingClientRect();
      const mx = ms.x - r0.left, my = ms.y - r0.top;
      const N = 20, cur = M.round + 1;
      const start = Math.max(1, cur - 9);
      const bw = Math.min(w - 24, N * 22);
      const x0 = w / 2 - bw / 2, y0 = 50;
      for (let k = 0; k < N; k++) {
        const r = start + k;
        const cx = x0 + (k + 0.5) * (bw / N);
        if (Math.abs(mx - cx) < 11 && Math.abs(my - y0) < 11) {
          const boss = isBossR(r), pvp = kindOf(r) === 'pvp';
          const t = 'Ronda ' + r + ': ' + (boss ? '¡JEFE! Salvajes' : pvp ? 'Rival' : 'Salvajes') +
            (r === cur ? ' (actual)' : r < cur ? ' (lista)' : '');
          ctx.save();
          ctx.font = F(700, 11);
          const tw = Math.min(280, ctx.measureText(t).width + 20);
          const bx = Math.max(8, Math.min(cx - tw / 2, w - tw - 8));
          ctx.fillStyle = 'rgba(8,14,28,.95)';
          ctx.fillRect(bx, y0 + 12, tw, 22);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = boss ? '#ff5f6d' : pvp ? '#c47bff' : '#5fe08a';
          ctx.strokeRect(bx + 0.5, y0 + 12.5, tw - 1, 21);
          ctx.textAlign = 'center';
          ctx.fillStyle = '#fff';
          ctx.fillText(t, bx + tw / 2, y0 + 27);
          ctx.restore();
          break;
        }
      }
    }
    // Tooltip de economía (PC): desglose del último ingreso.
    if (G.Touch.hovering() && M.lastEcon) {
      const ms = G.Input.mouse();
      const r0 = cv.getBoundingClientRect();
      const mx = ms.x - r0.left, my = ms.y - r0.top;
      if (mx >= w - 300 && mx <= w - 8 && my >= 6 && my <= 42) {
        const g = M.lastEcon;
        const t = '+' + g.total + ' = 5 base' + (g.streakB ? ' + ' + g.streakB + ' racha' : '') +
          (g.intB ? ' + ' + g.intB + ' interés' : '') + (g.pveB ? ' + 2 PvE' : '');
        ctx.save();
        ctx.font = F(700, 11);
        const bw = Math.min(320, ctx.measureText(t).width + 20);
        const bx = Math.max(8, w - bw - 8), by = 44;
        ctx.fillStyle = 'rgba(8,14,28,.95)';
        ctx.fillRect(bx, by, bw, 22);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffd23f';
        ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, 21);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText(t, bx + bw / 2, by + 15);
        ctx.restore();
      }
    }
    // Botón salir (a elegir modo): siempre visible menos en la pantalla final.
    if (M.phase !== 'over') {
      ctx.beginPath();
      ctx.arc(w - 26, 72, 13, 0, 6.2832);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(244,248,255,.7)';
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = F(800, 13);
      ctx.fillStyle = '#f4f8ff';
      ctx.fillText('✕', w - 26, 77);
    }
    // Tabla de tiers por nivel, arriba a la derecha DEBAJO del botón salir (antes lo tapaba).
    {
      const w8 = ODDS[Math.min(9, M.level)];
      const segs = w8.map((p, i) => ({ t: 'T' + (i + 1), p, col: COST_COL[i + 1] }));
      ctx.font = F(700, 11);
      const tw = segs.reduce((a, s) => a + ctx.measureText(s.t + ' ' + s.p + '%').width + 18, 0) + 16;
      const tx = w - 12 - tw, ty = 94;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(tx, ty, tw, 24);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(140,170,210,.3)';
      ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, 23);
      let ix = tx + 12;
      ctx.textAlign = 'left';
      for (const s of segs) {
        // Los tiers bloqueados (0 %) se ven apagados.
        ctx.globalAlpha = s.p > 0 ? 1 : 0.35;
        ctx.fillStyle = s.col;
        ctx.fillText(s.t + ' ' + s.p + '%', ix, ty + 16);
        ix += ctx.measureText(s.t + ' ' + s.p + '%').width + 18;
      }
      ctx.globalAlpha = 1;
    }
    // Botón del planificador, bajo la tabla de tiers.
    {
      const bw = 150, bh = 28;
      const bx = w - 12 - bw, by = 124;
      M.planBtn = { x: bx, y: by, w: bw, h: bh };
      ctx.fillStyle = M.planOpen ? 'rgba(60,44,10,.95)' : 'rgba(10,16,28,.75)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.lineWidth = 2;
      ctx.strokeStyle = M.planOpen ? '#ffd23f' : 'rgba(140,170,210,.4)';
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      ctx.textAlign = 'center';
      ctx.font = F(800, 13);
      ctx.fillStyle = '#fff';
      ctx.fillText('PLAN (' + M.plan.length + ')', bx + bw / 2, by + 19);
    }
    // Sinergias: panel a la izquierda, debajo de tu vida.
    const syn = synergy([...M.board.values()].map(u => G.DEX_BY[u.dex]));
    const rows = Object.keys(syn.counts).map(t => ({ t, n: syn.counts[t] }))
      .sort((a, b) => b.n - a.n).slice(0, 5);
    synRects = [];
    if (!rows.length) {
      ctx.textAlign = 'left';
      ctx.font = F(700, 11);
      ctx.fillStyle = '#9fd8ff';
      ctx.fillText('Sin sinergias: junta tipos iguales', 12, 64);
    }
    if (rows.length && w > 560) {
      ctx.textAlign = 'left';
      ctx.font = F(800, 10);
      ctx.fillStyle = '#8fa3c4';
      ctx.fillText('SINERGIAS', 12, 46);
    }
    rows.forEach((r, i) => {
      const y = 52 + i * 30, bw = 196;
      const act = syn.act.find(a => a.type === r.t);
      const linear = act && act.linear;
      const tiers = (SY_DEF[r.t] || SY_STD).map(tr => tr.n).sort((a, b) => a - b);
      const solo = !linear && tiers.length === 1 && ((SY_DEF[r.t] || [])[0] || {}).solo;
      const next = tiers.find(n => n > r.n) || tiers[tiers.length - 1];
      const sel = M.synSel === r.t;
      synRects.push({ x: 12, y, w: bw, h: 26, type: r.t, count: r.n, act: act || null });
      ctx.fillStyle = act ? 'rgba(40,30,8,.9)' : 'rgba(0,0,0,.78)';
      ctx.fillRect(12, y, bw, 26);
      ctx.lineWidth = sel ? 3 : act ? 2 : 1;
      ctx.strokeStyle = sel ? '#fff' : act ? '#ffd23f' : 'rgba(140,170,210,.3)';
      ctx.strokeRect(12.5, y + 0.5, bw - 1, 25);
      G.Icons.draw(ctx, syIcon(r.t), 18, y + 4, 18);
      ctx.textAlign = 'left';
      ctx.font = F(800, 12);
      ctx.fillStyle = act ? '#ffd23f' : '#eaf2ff';
      ctx.fillText(syName(r.t), 42, y + 17);
      ctx.textAlign = 'right';
      ctx.font = F(700, 11);
      const effCol = act && act.eff === 'mana' ? '#4b9bff' : act && act.eff === 'def' ? '#5fe08a' : '#ffd23f';
      ctx.fillStyle = act ? effCol : '#8fa3c4';
      const right = linear
        ? r.n + ' × +' + (act.eff === 'mana' ? Math.round(act.bonus) + ' maná' : Math.round(act.bonus * 100) + (act.eff === 'def' ? '% menos daño' : '%'))
        : solo
          ? (act ? '1 ¡SOLO!  +' + Math.round(act.bonus * 100) + '%' : r.n + '/1 apagada')
          : r.n + '/' + next + (act ? '  +' + Math.round(act.bonus * 100) + '%' : '');
      ctx.fillText(right, 12 + bw - 8, y + 17);
    });
    // Sinergia fijada: tira de iconos debajo del panel; al pasar el ratón (o tocar)
    // sale mini-tip con nombre, coste y tier de cada uno.
    synIconRects = [];
    if (M.synSel) {
      const { inPool, onBoard, extra } = synMembers(M.synSel);
      // Primero los evolucionados del tablero (con su ★), luego la pool.
      const show = [...(extra || []).slice(0, 3).map(e => ({ dex: e.dex, star: e.star, evo: true })),
        ...inPool.slice(0, 10).map(dex => ({ dex, star: 0, evo: false }))].slice(0, 10);
      const y0 = 52 + Math.min(5, rows.length) * 30 + 8;
      ctx.font = F(700, 10);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8fa3c4';
      ctx.fillText('Toca un icono para verlo · toca la fila para soltar', 12, y0 - 4);
      show.forEach((s, i) => {
        const ix = 12 + i * 34, iy = y0;
        synIconRects.push({ x: ix, y: iy, w: 30, h: 30, dex: s.dex });
        const lit = s.evo || onBoard[s.dex];
        ctx.save();
        if (!lit) ctx.globalAlpha = 0.45;
        drawPortrait(ctx, s.dex, ix + 1, iy + 1, 28, 28);
        ctx.restore();
        ctx.lineWidth = lit ? 2 : 1;
        ctx.strokeStyle = lit ? '#ffd23f' : 'rgba(140,170,210,.3)';
        ctx.strokeRect(ix + 0.5, iy + 0.5, 29, 29);
        if (s.evo) {
          ctx.fillStyle = '#ffd23f';
          ctx.font = F(800, 10);
          ctx.textAlign = 'right';
          ctx.fillText('★' + s.star, ix + 29, iy + 11);
        }
      });
      // Con el ratón, el mini-tip sigue al icono (en táctil vale el toque de 3 s).
      if (G.Touch.hovering()) {
        const ms = G.Input.mouse();
        const hitI = synIconRects.find(s => ms.x >= s.x && ms.x <= s.x + s.w && ms.y >= s.y && ms.y <= s.y + s.h);
        if (hitI) M.synTip = { dex: hitI.dex, x: hitI.x + 15, y: hitI.y, t: 0.3 };
      }
      const hov = M.synTip && M.synTip.t > 0 ? M.synTip : null;
      if (hov) {
        const mon = G.DEX_BY[hov.dex];
        const txt = mon.name + ' · T' + Math.min(5, mon.rarity || 1) + ' · ◉' + Math.min(5, mon.rarity || 1);
        ctx.font = F(800, 12);
        const tw = Math.min(260, ctx.measureText(txt).width + 20);
        let bx = Math.max(12, Math.min(hov.x - tw / 2, w - tw - 8));
        const by = hov.y - 34;
        ctx.fillStyle = 'rgba(8,14,28,.95)';
        ctx.fillRect(bx, by, tw, 24);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = COST_COL[Math.min(5, mon.rarity || 1)];
        ctx.strokeRect(bx + 0.5, by + 0.5, tw - 1, 23);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText(txt, bx + tw / 2, by + 16);
      }
    }
    // Tooltip de sinergia (ratón, sólo PC): qué hace y quién la forma (en color si está activa).
    if (G.Touch.hovering() && rows.length) {
      const ms = G.Input.mouse();
      const hit = synRects.find(s => ms.x >= s.x && ms.x <= s.x + s.w && ms.y >= s.y && ms.y <= s.y + s.h);
      if (hit) drawSynTip(ctx, w, h, hit);
    }
    // Zona de venta (al arrastrar).
    if (drag) {
      ctx.fillStyle = 'rgba(255,210,63,.15)';
      ctx.fillRect(0, 0, w, 60);
      ctx.font = F(800, 13);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(drag.kind === 'item' ? 'Suelta sobre una unidad para equipar' : 'Suelta arriba o en la tienda para vender +' + sellValue(drag.u.dex, drag.u.star) + ' oro', w / 2, 36);
    }
    if (M.phase === 'over') {
      ctx.fillStyle = 'rgba(0,0,0,.7)';
      ctx.fillRect(0, 0, w, h);
      ctx.textAlign = 'center';
      ctx.font = F(800, 34);
      ctx.fillStyle = M.over === 'win' ? '#ffd23f' : '#ff8a96';
      ctx.fillText(M.over === 'win' ? '¡VICTORIA!' : 'Derrota... 2.º puesto', w / 2, h / 2 - 40);
      ctx.font = F(700, 14);
      ctx.fillStyle = '#fff';
      ctx.fillText(M.overText || '', w / 2, h / 2 - 12);
      const [bx, by, bw2, bh2] = overRect(w, h);
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(bx, by, bw2, bh2);
      ctx.fillStyle = '#20160a';
      ctx.font = F(800, 16);
      ctx.fillText('Volver al menú', w / 2, by + 27);
    } else if (M.flashT > 0 && M.flash) {
      ctx.textAlign = 'center';
      ctx.font = F(800, 22);
      ctx.fillStyle = '#ffcb3d';
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 4;
      ctx.strokeText(M.flash, w / 2, h * 0.3);
      ctx.fillText(M.flash, w / 2, h * 0.3);
    }
    // Escena de subida de estrella: fogonazo + diálogo de evolución.
    if (M.evoFx) {
      const k = M.evoFx.t / 2.6;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.55 * Math.max(0, Math.min(1, k * 1.6))).toFixed(2) + ')';
      ctx.fillRect(0, 0, w, h);
      const mon = G.DEX_BY[M.evoFx.dex];
      const txt = '¡¿Qué?! ¡' + mon.name + ' está evolucionando! ▶';
      ctx.font = F(800, 15);
      const tw = Math.min(w - 32, ctx.measureText(txt).width + 36);
      const bx = w / 2 - tw / 2, by = h * 0.66;
      ctx.fillStyle = 'rgba(248,250,255,.95)';
      ctx.strokeStyle = '#4b9bff'; ctx.lineWidth = 3;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, tw, 40, 10);
      else ctx.rect(bx, by, tw, 40);
      ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#1b2f78';
      ctx.fillText(txt, w / 2, by + 26);
    }
    // Armería: elige 1 de 3 gratis (modal encima de todo en preparación).
    if (M.armory && M.armory.length && M.phase === 'prep') {
      ctx.save();
      ctx.fillStyle = 'rgba(4,8,16,.74)';
      ctx.fillRect(0, 0, w, h);
      ctx.textAlign = 'center';
      ctx.font = F(800, 18);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('¡ARMERÍA! Elige un objeto', w / 2, h / 2 - 116);
      M.armRects = [];
      const cw = 108, ch = 148, gap = 16;
      const x0 = w / 2 - (3 * cw + 2 * gap) / 2, y0 = h / 2 - 94;
      let hov = -1;
      if (G.Touch.hovering()) {
        const ms = G.Input.mouse();
        const r0 = cv.getBoundingClientRect();
        const mx = ms.x - r0.left, my = ms.y - r0.top;
        M.armory.forEach((id, i) => {
          const x = x0 + i * (cw + gap);
          if (mx >= x && mx <= x + cw && my >= y0 && my <= y0 + ch) hov = i;
        });
      }
      M.armory.forEach((id, i) => {
        const x = x0 + i * (cw + gap), y = y0;
        M.armRects.push({ x, y, w: cw, h: ch, id });
        const def = itemDef(id);
        ctx.fillStyle = i === hov ? 'rgba(40,52,92,.98)' : 'rgba(16,26,48,.96)';
        ctx.fillRect(x, y, cw, ch);
        ctx.lineWidth = i === hov ? 3 : 2;
        ctx.strokeStyle = i === hov ? '#ffffff' : '#ffd23f';
        ctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
        G.Icons.draw(ctx, def.icon, x + cw / 2 - 24, y + 12, 48);
        // Nombre en 1-2 líneas y efecto.
        ctx.fillStyle = '#fff';
        ctx.font = F(800, 12);
        const words = def.name.split(' ');
        const lines = [''];
        for (const wd of words) {
          const t = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + wd : wd;
          if (ctx.measureText(t).width > cw - 16 && lines[lines.length - 1]) lines.push(wd);
          else lines[lines.length - 1] = t;
        }
        lines.slice(0, 2).forEach((t, li) => ctx.fillText(t, x + cw / 2, y + 78 + li * 14));
        ctx.fillStyle = '#8fa3c4';
        ctx.font = F(700, 10);
        ctx.fillText(itemDesc(id), x + cw / 2, y + ch - 12, cw - 12);
      });
      ctx.restore();
    }
    // Aumentos: 1 de 3 (morado, tras la armería).
    if (M.augDraft && M.augDraft.length && M.phase === 'prep') {
      ctx.save();
      ctx.fillStyle = 'rgba(10,6,24,.74)';
      ctx.fillRect(0, 0, w, h);
      ctx.textAlign = 'center';
      ctx.font = F(800, 18);
      ctx.fillStyle = '#c47bff';
      ctx.fillText('¡AUMENTO! Elige un efecto', w / 2, h / 2 - 116);
      M.augRects = [];
      const cw = 118, ch = 150, gap = 16;
      const x0 = w / 2 - (3 * cw + 2 * gap) / 2, y0 = h / 2 - 92;
      let hov = -1;
      if (G.Touch.hovering()) {
        const ms = G.Input.mouse();
        const r0 = cv.getBoundingClientRect();
        const mx = ms.x - r0.left, my = ms.y - r0.top;
        M.augDraft.forEach((key, i) => {
          const x = x0 + i * (cw + gap);
          if (mx >= x && mx <= x + cw && my >= y0 && my <= y0 + ch) hov = i;
        });
      }
      M.augDraft.forEach((key, i) => {
        const a = AUGMENTS[key];
        if (!a) return;
        const x = x0 + i * (cw + gap), y = y0;
        M.augRects.push({ x, y, w: cw, h: ch, key });
        ctx.fillStyle = i === hov ? 'rgba(64,36,120,.98)' : 'rgba(28,18,60,.96)';
        ctx.fillRect(x, y, cw, ch);
        ctx.lineWidth = i === hov ? 3 : 2;
        ctx.strokeStyle = i === hov ? '#ffffff' : '#c47bff';
        ctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
        G.Icons.draw(ctx, a.icon, x + cw / 2 - 22, y + 10, 44);
        ctx.fillStyle = '#fff';
        ctx.font = F(800, 12);
        const words = a.name.split(' ');
        const lines = [''];
        for (const wd of words) {
          const t = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + wd : wd;
          if (ctx.measureText(t).width > cw - 16 && lines[lines.length - 1]) lines.push(wd);
          else lines[lines.length - 1] = t;
        }
        lines.slice(0, 2).forEach((t, li) => ctx.fillText(t, x + cw / 2, y + 68 + li * 14));
        ctx.fillStyle = '#cdbcf5';
        ctx.font = F(700, 10);
        // Descripción envuelta a 3 líneas (nada se corta).
        const ws = a.desc.split(' ');
        const dl = [''];
        for (const wd of ws) {
          const t = dl[dl.length - 1] ? dl[dl.length - 1] + ' ' + wd : wd;
          if (ctx.measureText(t).width > cw - 14 && dl[dl.length - 1]) dl.push(wd);
          else dl[dl.length - 1] = t;
        }
        dl.slice(0, 3).forEach((t, li) => ctx.fillText(t, x + cw / 2, y + ch - 46 + li * 12, cw - 10));
      });
      // Botón para cambiar las 3 cartas (2 de oro).
      {
        const bw = 170, bh = 30;
        const bx = w / 2 - bw / 2, by = y0 + ch + 14;
        M.augRefresh = { x: bx, y: by, w: bw, h: bh };
        const ok = M.gold >= 2;
        ctx.fillStyle = ok ? 'rgba(46,28,96,.96)' : 'rgba(20,20,30,.8)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.lineWidth = 2;
        ctx.strokeStyle = ok ? '#c47bff' : 'rgba(140,170,210,.3)';
        ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
        ctx.fillStyle = ok ? '#e6d6ff' : '#66707f';
        ctx.font = F(800, 13);
        ctx.textAlign = 'center';
        ctx.fillText('Cambiar · 2 oro', w / 2, by + 20);
      }
      ctx.restore();
    }
    // Planificador estilo TFT: pool con nombres + rasgos del plan + equipo 3×3.
    if (M.planOpen && (M.phase === 'prep' || M.phase === 'fight')) {
      ctx.save();
      ctx.fillStyle = 'rgba(4,8,16,.82)';
      ctx.fillRect(0, 0, w, h);
      const k = Math.min(1, (w - 24) / 836);
      const cell = Math.max(30, Math.round(62 * k));
      const cellH = cell + Math.max(12, Math.round(16 * k));
      const tcell = Math.max(40, Math.round(80 * k));
      const poolCols = 6, perPage = 24;
      const poolW = poolCols * cell;
      const traitW = Math.max(110, Math.round(180 * k));
      const teamW = 3 * tcell;
      const gap = Math.max(8, Math.round(20 * k));
      const totalW = poolW + gap + traitW + gap + teamW;
      const x0 = w / 2 - totalW / 2;
      const y0 = 104;
      ctx.textAlign = 'center';
      ctx.font = F(800, 18);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('PLANIFICADOR (' + M.plan.length + '/9)', w / 2, 52);
      // Cerrar (X).
      M.planClose = { x: x0 + totalW - 28, y: 22, w: 26, h: 26 };
      {
        const cb = M.planClose;
        ctx.fillStyle = 'rgba(10,16,28,.9)';
        ctx.fillRect(cb.x, cb.y, cb.w, cb.h);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(140,170,210,.5)';
        ctx.strokeRect(cb.x + 0.5, cb.y + 0.5, cb.w - 1, cb.h - 1);
        ctx.fillStyle = '#fff';
        ctx.font = F(800, 14);
        ctx.fillText('X', cb.x + cb.w / 2, cb.y + 18);
      }
      const filters = [0, 1, 2, 3, 4, 5];
      const fw = Math.max(34, Math.round(52 * k)), fh = 24, fx0 = x0, fy0 = 66;
      M.planFilterRects = [];
      filters.forEach((f, i) => {
        const x = fx0 + i * (fw + 8);
        M.planFilterRects.push({ x, y: fy0, w: fw, h: fh, f });
        const on = (M.planFilter || 0) === f;
        ctx.fillStyle = on ? 'rgba(60,44,10,.95)' : 'rgba(10,16,28,.85)';
        ctx.fillRect(x, fy0, fw, fh);
        ctx.lineWidth = on ? 2.5 : 1.5;
        ctx.strokeStyle = on ? '#ffd23f' : 'rgba(140,170,210,.4)';
        ctx.strokeRect(x + 0.5, fy0 + 0.5, fw - 1, fh - 1);
        ctx.fillStyle = on ? '#ffd23f' : '#eaf2ff';
        ctx.font = F(800, 12);
        ctx.fillText(f === 0 ? 'Todos' : 'T' + f, x + fw / 2, fy0 + 17);
      });
      const list = M.pool.filter(d => !(M.planFilter || 0) || costOf(d) === M.planFilter)
        .sort((a, b) => costOf(a) - costOf(b) || a - b);
      const pages = Math.max(1, Math.ceil(list.length / perPage));
      if ((M.planPage || 0) >= pages) M.planPage = 0;
      const pg = M.planPage || 0;
      M.planPageRects = [
        { x: fx0 + filters.length * (fw + 8) + 4, y: fy0, w: 30, h: fh, d: -1 },
        { x: fx0 + filters.length * (fw + 8) + 38, y: fy0, w: 30, h: fh, d: 1 }
      ];
      ctx.font = F(800, 12);
      ctx.fillStyle = '#8fa3c4';
      ctx.fillText((pg + 1) + '/' + pages, fx0 + filters.length * (fw + 8) + 4 + 79, fy0 + 17);
      M.planPageRects.forEach(r => {
        ctx.fillStyle = 'rgba(10,16,28,.85)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(140,170,210,.4)';
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        ctx.fillStyle = '#eaf2ff';
        ctx.fillText(r.d < 0 ? '<' : '>', r.x + r.w / 2, r.y + 17);
      });
      const page = list.slice(pg * perPage, pg * perPage + perPage);
      M.planRects = [];
      // Hover (PC) o último toque (táctil) para la ficha.
      let hovDex = -1, hovX = 0, hovY = 0;
      if (G.Touch.hovering()) {
        const ms = G.Input.mouse();
        const r0 = cv.getBoundingClientRect();
        hovX = ms.x - r0.left; hovY = ms.y - r0.top;
      } else if (M.planTip && M.planTip.t > 0) {
        hovDex = M.planTip.dex;
      }
      const nameFs = Math.max(8, Math.round(10 * k) || 9);
      page.forEach((dex, i) => {
        const cx = x0 + (i % poolCols) * cell, cy = y0 + Math.floor(i / poolCols) * cellH;
        const planned = M.plan.includes(dex);
        const cost = costOf(dex);
        const owned = [...M.bench.filter(Boolean), ...M.board.values()].some(u => u.dex === dex);
        M.planRects.push({ x: cx + 2, y: cy + 2, w: cell - 4, h: cellH - 4, dex });
        // Fondo teñido del tier + retrato estático con nombre + borde.
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = COST_COL[cost];
        ctx.fillRect(cx + 2, cy + 2, cell - 4, cellH - 4);
        ctx.restore();
        drawPortrait(ctx, dex, cx + 6, cy + 4, cell - 12, cell - 12, false);
        ctx.font = F(800, nameFs);
        ctx.textAlign = 'center';
        ctx.fillStyle = planned ? '#ffd23f' : '#eaf2ff';
        ctx.fillText(G.DEX_BY[dex].name.slice(0, 10), cx + cell / 2, cy + cell + 1);
        ctx.lineWidth = planned ? 3 : owned ? 2 : 1.5;
        ctx.strokeStyle = planned ? '#ffd23f' : owned ? '#ffffff' : COST_COL[cost];
        ctx.strokeRect(cx + 2.5, cy + 2.5, cell - 5, cellH - 5);
        // Pips de coste + ★ de marcado.
        ctx.font = F(800, 10);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffd23f';
        ctx.fillText('◉'.repeat(Math.min(5, cost)), cx + 6, cy + cellH - 6);
        if (planned) {
          ctx.fillStyle = '#ffd23f';
          ctx.font = F(800, 13);
          ctx.textAlign = 'right';
          ctx.fillText('★', cx + cell - 5, cy + 17);
        }
        if (G.Touch.hovering() && hovX >= cx + 2 && hovX <= cx + cell - 2 && hovY >= cy + 2 && hovY <= cy + cellH - 2) hovDex = dex;
      });
      // Columna de rasgos del plan.
      const tx = x0 + poolW + gap;
      const pMons = M.plan.map(d => G.DEX_BY[d]).filter(Boolean);
      const psyn = synergy(pMons);
      const trows = Object.keys(psyn.counts).map(t => ({ t, n: psyn.counts[t] }))
        .sort((a, b) => b.n - a.n).slice(0, 9);
      ctx.textAlign = 'left';
      ctx.font = F(800, Math.max(9, Math.round(11 * k) || 10));
      ctx.fillStyle = '#8fa3c4';
      ctx.fillText('RASGOS', tx, y0 - 6);
      trows.forEach((r, i) => {
        const ry = y0 + 8 + i * Math.max(22, Math.round(28 * k));
        const act = psyn.act.find(a => a.type === r.t);
        G.Icons.draw(ctx, syIcon(r.t), tx, ry, 20);
        ctx.fillStyle = act ? '#ffd23f' : '#eaf2ff';
        ctx.fillText(syName(r.t), tx + 24, ry + 15);
        let right = '';
        if (act && act.linear) right = r.n + '×';
        else if (act && act.solo) right = '1 ¡SOLO!';
        else {
          const tiers = (SY_DEF[r.t] || SY_STD).map(tr => tr.n).sort((x, y) => x - y);
          const next = tiers.find(n => n > r.n) || tiers[tiers.length - 1];
          right = r.n + '/' + next;
        }
        ctx.textAlign = 'right';
        ctx.fillText(right, tx + traitW, ry + 15);
        ctx.textAlign = 'left';
      });
      if (!trows.length) {
        ctx.fillStyle = '#66707f';
        ctx.fillText('Marca unidades', tx, y0 + 22);
      }
      // Tablero del plan 3×3.
      const bx = tx + traitW + gap;
      ctx.textAlign = 'left';
      ctx.font = F(800, Math.max(9, Math.round(11 * k) || 10));
      ctx.fillStyle = '#8fa3c4';
      ctx.fillText('EQUIPO', bx, y0 - 6);
      for (let i = 0; i < 9; i++) {
        const cx = bx + (i % 3) * tcell, cy = y0 + Math.floor(i / 3) * (tcell + 14);
        const dex = M.plan[i];
        if (dex) {
          const cost = costOf(dex);
          ctx.save();
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = COST_COL[cost];
          ctx.fillRect(cx, cy, tcell, tcell);
          ctx.restore();
          drawPortrait(ctx, dex, cx + 6, cy + 4, tcell - 12, tcell - 12, false);
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = COST_COL[cost];
          ctx.strokeRect(cx + 1, cy + 1, tcell - 2, tcell - 2);
          ctx.fillStyle = '#eaf2ff';
          ctx.font = F(800, Math.max(8, Math.round(10 * k) || 9));
          ctx.textAlign = 'center';
          ctx.fillText(G.DEX_BY[dex].name.slice(0, 10), cx + tcell / 2, cy + tcell + 12);
        } else {
          ctx.fillStyle = 'rgba(0,0,0,.5)';
          ctx.fillRect(cx, cy, tcell, tcell);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = 'rgba(140,170,210,.25)';
          ctx.strokeRect(cx + 0.5, cy + 0.5, tcell - 1, tcell - 1);
          ctx.fillStyle = 'rgba(140,170,210,.35)';
          ctx.font = F(800, 20);
          ctx.textAlign = 'center';
          ctx.fillText('+', cx + tcell / 2, cy + tcell / 2 + 7);
        }
      }
      // Ficha de la unidad: qué sinergias daría y su estado.
      if (hovDex >= 0) {
        const mon = G.DEX_BY[hovDex];
        const cost = costOf(hovDex);
        const lines = [
          mon.name + '  ·  T' + cost + ' ' + TIER_ES[cost] + '  ·  ◉' + cost,
          'Da: ' + mon.types.map(t => G.U.TYPE_NAME[t]).join(' + '),
          'Vida ' + mon.hp + '  ·  Ataque ×' + mon.atk.toFixed(2) + '  ·  Vel ' + mon.spd
        ];
        const st = [];
        if (M.plan.includes(hovDex)) st.push('★ marcado');
        if ([...M.bench.filter(Boolean), ...M.board.values()].some(u => u.dex === hovDex)) st.push('lo tienes');
        if (st.length) lines.push(st.join(' · '));
        ctx.save();
        ctx.font = F(700, 11);
        const bw = Math.min(300, Math.max(...lines.map(t => ctx.measureText(t).width)) + 22);
        const bh = 10 + lines.length * 14;
        let bxp, byp;
        if (G.Touch.hovering()) {
          bxp = Math.max(8, Math.min(hovX + 16, w - bw - 8));
          byp = Math.max(8, Math.min(hovY - 10, h - bh - 8));
        } else {
          bxp = w / 2 - bw / 2; byp = 150;
        }
        ctx.fillStyle = 'rgba(8,14,28,.96)';
        ctx.fillRect(bxp, byp, bw, bh);
        ctx.lineWidth = 2;
        ctx.strokeStyle = COST_COL[cost];
        ctx.strokeRect(bxp + 0.5, byp + 0.5, bw - 1, bh - 1);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        lines.forEach((t, li) => ctx.fillText(t, bxp + bw / 2, byp + 16 + li * 14));
        ctx.restore();
      }
      ctx.font = F(700, 11);
      ctx.fillStyle = '#8fa3c4';
      ctx.textAlign = 'center';
      ctx.fillText('Toca para marcar o soltar (máx. 9)', w / 2, y0 + 4 * cellH + 18);
      // Botones: BORRAR | CAPTURA | DESHACER.
      const bbw = 130, bbh = 30, bgap = 12;
      const btot = 3 * bbw + 2 * bgap;
      const byy = y0 + 4 * cellH + 28;
      M.planBtns = [
        { x: w / 2 - btot / 2, y: byy, w: bbw, h: bbh, k: 'clear' },
        { x: w / 2 - btot / 2 + bbw + bgap, y: byy, w: bbw, h: bbh, k: 'shot' },
        { x: w / 2 - btot / 2 + 2 * (bbw + bgap), y: byy, w: bbw, h: bbh, k: 'undo' }
      ];
      const blbl = { clear: 'BORRAR', shot: 'CAPTURA', undo: 'DESHACER' };
      ctx.font = F(800, 13);
      for (const b of M.planBtns) {
        const dis = b.k === 'undo' && !(M.planUndo || []).length;
        ctx.fillStyle = dis ? 'rgba(20,20,30,.8)' : 'rgba(10,16,28,.9)';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.lineWidth = 2;
        ctx.strokeStyle = dis ? 'rgba(140,170,210,.25)' : '#ffd23f';
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
        ctx.fillStyle = dis ? '#66707f' : '#fff';
        ctx.fillText(blbl[b.k], b.x + b.w / 2, b.y + 20);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function overRect(w, h) { return [w / 2 - 110, h / 2 + 10, 220, 40]; }

  /** Miembros de una sinergia: toda la pool del tipo, tablero primero.
      Más los evolucionados del tablero (no están en pool pero sí cuentan). */
  function synMembers(type) {
    const t = syTest(type);
    const inPool = M.pool.filter(dex => t(G.DEX_BY[dex]));
    const onBoard = {};
    const owned = {};
    for (const u of M.board.values()) {
      if (t(G.DEX_BY[u.dex])) { onBoard[u.dex] = true; owned[u.dex] = 2; }
    }
    // Lo de la banca también cuenta como "posible" (antes se cortaba fuera de los 16).
    for (const u of M.bench) {
      if (u && t(G.DEX_BY[u.dex]) && !owned[u.dex]) owned[u.dex] = 1;
    }
    inPool.sort((a, b) => ((owned[b] || 0) - (owned[a] || 0)) || a - b);
    // Evolucionados en tablero fuera de pool (p. ej. Bayleef): van primero, con su ★.
    const extra = [];
    for (const u of M.board.values()) {
      if (!inPool.includes(u.dex) && t(G.DEX_BY[u.dex]) && !extra.some(e => e.dex === u.dex)) {
        extra.push({ dex: u.dex, star: u.star });
      }
    }
    return { inPool, onBoard, extra };
  }

  /** Tooltip de sinergia: qué da y retratos de quienes la forman (en color si está activa). */
  function drawSynTip(ctx, w, h, s) {
    // Toda la pool de ese tipo (para saber qué comprar): en color los del tablero.
    // Más los evolucionados del tablero, que cuentan aunque no salgan en tienda.
    const { inPool, onBoard, extra } = synMembers(s.type);
    const showExtra = (extra || []).slice(0, 4);
    const show = inPool.slice(0, 16 - showExtra.length);
    ctx.font = F(700, 11);
    const ps = SY_PSEUDO.find(p => p.id === s.type);
    const tiers = SY_DEF[s.type] || SY_STD;
    const ttxt = ps
      ? 'Cada unidad ' + ps.name + ': +' + (ps.eff === 'mana' ? Math.round(ps.per) + ' maná' : Math.round(ps.per * 100) + (ps.eff === 'def' ? '% menos daño' : '% ataque')) +
        (ps.cap ? ' (tope ' + (ps.eff === 'mana' ? Math.round(ps.cap) : Math.round(ps.cap * 100) + '%') + ')' : '')
      : tiers[0].solo
        ? '1 en tablero (¡solo!): +' + Math.round(tiers[0].b * 100) + '%; con 2+ se apaga'
        : tiers.slice().reverse().map(tr => tr.n + ': +' + Math.round(tr.b * 100) + '%').join(' / ') + ' al equipo';
    // Envuelve el texto (nada se corta).
    const tlines = [];
    {
      const seps = ttxt.includes(' / ') ? ttxt.split(' / ') : ttxt.split(' ');
      const joiner = ttxt.includes(' / ') ? ' / ' : ' ';
      let cur = '';
      for (const wd of seps) {
        const cand = cur ? cur + joiner + wd : wd;
        if (ctx.measureText(cand).width > 228 && cur) { tlines.push(cur); cur = wd; }
        else cur = cand;
      }
      if (cur) tlines.push(cur);
    }
    const perRow = 8, rowsN = Math.max(1, Math.ceil((showExtra.length + show.length) / perRow));
    const topH = 30 + tlines.length * 14;
    const bw = 280, bh = topH + 26 + rowsN * 34;
    const bx = Math.min(216, w - bw - 8);
    const by = Math.max(52, Math.min(s.y - 20, h - bh - 8));
    ctx.save();
    ctx.fillStyle = 'rgba(8,14,28,.95)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.lineWidth = 2;
    ctx.strokeStyle = s.act ? '#ffd23f' : 'rgba(140,170,210,.4)';
    ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
    G.Icons.draw(ctx, syIcon(s.type), bx + 8, by + 8, 22);
    ctx.beginPath();
    ctx.rect(bx + 4, by + 4, bw - 8, bh - 8);
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.font = F(800, 13);
    ctx.fillStyle = s.act ? '#ffd23f' : '#fff';
    ctx.fillText(syName(s.type) + ' · ' + s.count + ' en tablero', bx + 36, by + 24);
    ctx.font = F(700, 11);
    ctx.fillStyle = 'rgba(220,232,248,.9)';
    tlines.forEach((t, i) => ctx.fillText(t, bx + 36, by + 40 + i * 14));
    const poolY = by + 40 + (tlines.length - 1) * 14 + 16;
    ctx.fillStyle = '#8fa3c4';
    ctx.fillText('En esta pool (' + inPool.length + ')' + (showExtra.length ? ' + ' + showExtra.length + ' evo' : '') + ':', bx + 8, poolY);
    const py0 = poolY + 6;
    showExtra.forEach((e, i) => {
      const ix = bx + 8 + (i % perRow) * 30, iy = py0 + Math.floor(i / perRow) * 34;
      drawPortrait(ctx, e.dex, ix, iy, 28, 28);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffd23f';
      ctx.strokeRect(ix + 0.5, iy + 0.5, 27, 27);
      ctx.fillStyle = '#ffd23f';
      ctx.font = F(800, 10);
      ctx.textAlign = 'center';
      ctx.fillText('★' + e.star, ix + 14, iy + 38);
    });
    show.forEach((dex, i) => {
      const k = i + showExtra.length;
      const ix = bx + 8 + (k % perRow) * 30, iy = py0 + Math.floor(k / perRow) * 34;
      ctx.save();
      if (!onBoard[dex]) ctx.globalAlpha = 0.4;
      drawPortrait(ctx, dex, ix, iy, 28, 28);
      ctx.restore();
    });
    if (inPool.length > show.length) {
      ctx.fillStyle = '#8fa3c4';
      ctx.font = F(700, 10);
      ctx.fillText('+' + (inPool.length - show.length) + ' más…', bx + 8, py0 + rowsN * 34);
    }
    ctx.restore();
  }

  /** Bonus sumados de una lista de objetos (para tooltips). */
  function itemStats(items) {
    const st = { atk: 0, spd: 0, def: 0, hp: 0, mana: 0, crit: 0 };
    for (const id of (items || [])) {
      const parts = String(id).split('+');
      const k = parts.length > 1 ? 1.5 : 1;
      for (const key of parts) {
        const fx = (G.TftItemFx || {})[key];
        if (!fx) continue;
        for (const s in st) if (fx[s]) st[s] += fx[s] * k;
      }
    }
    return st;
  }

  /** Tooltip de unidad (tablero/banca): como el de tienda + estrellas. */
  function drawUnitTip(ctx, dex, star, cx, cyTop, items) {
    const mon = G.DEX_BY[dex];
    const mv = G.Moves.BY_ID[G.startMoveOf(dex)] || { name: '?', desc: '' };
    const title = mon.name + ' ' + '★'.repeat(star) + '  ◉' + costOf(dex);
    // Stats escalados por estrella (como pelean de verdad) + bonus de objetos.
    const smHp = [1, 2, 3.5][star - 1] || 1, smAtk = [1, 1.6, 2.5][star - 1] || 1;
    const ist = itemStats(items);
    const effSpd = mon.spd * (1 + ist.spd);
    const basicT = (1.1 * Math.pow(100 / Math.max(30, effSpd), 0.5)).toFixed(2);
    const body = [
      { t: 'Tier ' + costOf(dex) + ' (' + TIER_ES[costOf(dex)] + ')  ·  se vende por ◉' + sellValue(dex, star), c: COST_COL[costOf(dex)] },
      { t: mon.types.map(t => G.U.TYPE_NAME[t]).join(' / ') + '  ·  Vida ' + Math.round(mon.hp * smHp) + ' (★' + star + ')  ·  Ataque ×' + (mon.atk * smAtk * (1 + ist.atk)).toFixed(2), c: '#9fd8ff' },
      { t: 'Velocidad ' + Math.round(effSpd) + ' (básico cada ' + basicT + ' s)  ·  Defensa -' + Math.min(60, Math.round(ist.def * 100)) + '%  ·  Críticos ' + Math.round(ist.crit * 100) + '%', c: '#cdbcf5' },
      { t: mv.name + ': ' + mv.desc, c: 'rgba(220,232,248,.9)' },
      { t: 'Maná: 100 (los básicos lo cargan, al lleno tira la habilidad)', c: '#4b9bff' }
    ];
    ctx.font = F(700, 11);
    const lines = [];
    for (const b of body) {
      let cur = '';
      for (const wd of String(b.t).split(' ')) {
        const t = cur ? cur + ' ' + wd : wd;
        if (ctx.measureText(t).width > 210 && cur) { lines.push({ t: cur, c: b.c }); cur = wd; }
        else cur = t;
      }
      if (cur) lines.push({ t: cur, c: b.c });
    }
    ctx.font = F(800, 13);
    const titleW = ctx.measureText(title).width;
    ctx.font = F(700, 11);
    const bodyW = lines.reduce((a, l) => Math.max(a, ctx.measureText(l.t).width), 0);
    const bw = Math.min(296, Math.max(titleW, bodyW) + 76);
    const bh = 52 + lines.length * 14;
    const vw = screen()[0] / G.Camera.scale;
    const bx = Math.max(G.Camera.left() + 4, Math.min(cx - bw / 2, G.Camera.left() + vw - bw - 4));
    const by = cyTop - bh - 8;
    ctx.save();
    ctx.fillStyle = 'rgba(8,14,28,.95)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.lineWidth = 2;
    ctx.strokeStyle = COST_COL[costOf(dex)];
    ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
    drawPortrait(ctx, dex, bx + 8, by + 8, 52, 52, true, star);
    ctx.beginPath();
    ctx.rect(bx + 4, by + 4, bw - 8, bh - 8);
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.font = F(800, 13);
    ctx.fillStyle = '#fff';
    ctx.fillText(title, bx + 66, by + 20);
    ctx.font = F(700, 11);
    lines.forEach((l, i) => { ctx.fillStyle = l.c; ctx.fillText(l.t, bx + 66, by + 36 + i * 14); });
    ctx.restore();
  }

  /** Tooltip de la tienda: info del Pokémon, su habilidad y el maná. */
  function drawShopTip(ctx, dex, cx) {
    const mon = G.DEX_BY[dex];
    const mv = G.Moves.BY_ID[G.startMoveOf(dex)] || { name: '?', desc: '' };
    const title = mon.name + '  ◉' + costOf(dex);
    // Todo el cuerpo envuelto a 210 px y recortado al pintar: nada sale de la caja.
    const body = [
      { t: 'Tier ' + costOf(dex) + ' (' + TIER_ES[costOf(dex)] + ')', c: COST_COL[costOf(dex)] },
      { t: mon.types.map(t => G.U.TYPE_NAME[t]).join(' / ') + '  ·  Vida ' + mon.hp + '  ·  Ataque ×' + mon.atk.toFixed(2), c: '#9fd8ff' },
      { t: mv.name + ': ' + mv.desc, c: 'rgba(220,232,248,.9)' },
      { t: 'Maná: 100 (los básicos lo cargan, al lleno tira la habilidad)', c: '#4b9bff' }
    ];
    ctx.font = F(700, 11);
    const lines = [];
    for (const b of body) {
      let cur = '';
      for (const wd of String(b.t).split(' ')) {
        const t = cur ? cur + ' ' + wd : wd;
        if (ctx.measureText(t).width > 210 && cur) { lines.push({ t: cur, c: b.c }); cur = wd; }
        else cur = t;
      }
      if (cur) lines.push({ t: cur, c: b.c });
    }
    ctx.font = F(800, 13);
    const titleW = ctx.measureText(title).width;
    ctx.font = F(700, 11);
    const bodyW = lines.reduce((a, l) => Math.max(a, ctx.measureText(l.t).width), 0);
    const bw = Math.min(296, Math.max(titleW, bodyW) + 76);
    const bh = 52 + lines.length * 14;
    const vw = screen()[0] / G.Camera.scale;
    const bx = Math.max(G.Camera.left() + 4, Math.min(cx - bw / 2, G.Camera.left() + vw - bw - 4));
    const by = 300 - bh - 10;
    ctx.save();
    ctx.fillStyle = 'rgba(8,14,28,.95)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.lineWidth = 2;
    ctx.strokeStyle = COST_COL[costOf(dex)];
    ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
    drawPortrait(ctx, dex, bx + 8, by + 8, 52, 52);
    ctx.beginPath();
    ctx.rect(bx + 64, by + 4, bw - 68, bh - 8);
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.font = F(800, 13);
    ctx.fillStyle = '#fff';
    ctx.fillText(title, bx + 66, by + 20);
    ctx.font = F(700, 11);
    lines.forEach((l, i) => { ctx.fillStyle = l.c; ctx.fillText(l.t, bx + 66, by + 36 + i * 14); });
    ctx.restore();
  }

  // ---------------- entrada (ratón y táctil) ----------------

  function hitItem(wx, wy) {
    for (let i = 0; i < 7; i++) {
      const [x, y] = itemXY(i);
      if (wx >= x && wx <= x + 26 && wy >= y && wy <= y + 26) return i;
    }
    return -1;
  }

  function hitBench(wx, wy) {
    for (let i = 0; i < BENCH; i++) {
      const [x, y] = benchXY(i);
      if (wx >= x && wx <= x + 38 && wy >= y && wy <= y + 38) return i;
    }
    return -1;
  }

  function hitShop(wx, wy) {
    for (let i = 0; i < SHOPN; i++) {
      const [x, y] = shopXY(i);
      if (wx >= x && wx <= x + 100 && wy >= y && wy <= y + 96) return i;
    }
    return -1;
  }

  function hitBtn(wx, wy) {
    for (let i = 0; i < 3; i++) {
      const [x, y, w2, h2] = btnRect(i);
      if (wx >= x && wx <= x + w2 && wy >= y && wy <= y + h2) return i;
    }
    return -1;
  }

  function hitLock(wx, wy) {
    const [x, y, w2, h2] = lockRect();
    return wx >= x && wx <= x + w2 && wy >= y && wy <= y + h2;
  }

  function putBack(src, u) {
    if (!u) return;
    if (src.zone === 'bench') M.bench[src.i] = u;
    else M.board.set(src.c + ',' + src.r, u);
  }

  function onDown(e) {
    if (!M) return;
    if (e.cancelable) e.preventDefault();
    // Botón salir (pantalla, no mundo).
    if (M.phase !== 'over') {
      const r0 = cv.getBoundingClientRect();
      if (Math.hypot(e.clientX - r0.left - (r0.width - 26), e.clientY - r0.top - 76) < 16) { askQuit(); return; }
      const sx0 = e.clientX - r0.left, sy0 = e.clientY - r0.top;
      // Planificador abierto: filtros, páginas, cuadrícula y botones (lo demás no pasa).
      if (M.planOpen) {
        const fr = (M.planFilterRects || []).find(r => sx0 >= r.x && sx0 <= r.x + r.w && sy0 >= r.y && sy0 <= r.y + r.h);
        if (fr) { M.planFilter = fr.f; M.planPage = 0; G.Audio.sfx('click'); return; }
        const ppg = (M.planPageRects || []).find(r => sx0 >= r.x && sx0 <= r.x + r.w && sy0 >= r.y && sy0 <= r.y + r.h);
        if (ppg) {
          const pages = Math.max(1, Math.ceil(M.pool.filter(d => !(M.planFilter || 0) || costOf(d) === M.planFilter).length / 24));
          M.planPage = ((M.planPage || 0) + ppg.d + pages) % pages;
          G.Audio.sfx('click');
          return;
        }
        const undoPush = () => {
          M.planUndo = M.planUndo || [];
          M.planUndo.push(M.plan.slice());
          if (M.planUndo.length > 20) M.planUndo.shift();
        };
        const hit = (M.planRects || []).find(r => sx0 >= r.x && sx0 <= r.x + r.w && sy0 >= r.y && sy0 <= r.y + r.h);
        if (hit) {
          const ix = M.plan.indexOf(hit.dex);
          if (ix >= 0) { undoPush(); M.plan.splice(ix, 1); G.Audio.sfx('click'); }
          else if (M.plan.length >= 9) { G.Audio.sfx('error'); }
          else { undoPush(); M.plan.push(hit.dex); G.Audio.sfx('select'); }
          // En táctil se enseña su ficha unos segundos.
          if (G.Touch.active) M.planTip = { dex: hit.dex, t: 2.5 };
          return;
        }
        const bb = (M.planBtns || []).find(r => sx0 >= r.x && sx0 <= r.x + r.w && sy0 >= r.y && sy0 <= r.y + r.h);
        if (bb) {
          if (bb.k === 'clear') {
            if (M.plan.length) { undoPush(); M.plan = []; G.Audio.sfx('click'); }
            else G.Audio.sfx('error');
          } else if (bb.k === 'shot') {
            try {
              const a = document.createElement('a');
              a.href = cv.toDataURL('image/png');
              a.download = 'plan-tft.png';
              a.click();
              G.Audio.sfx('buy');
            } catch (e) { G.Audio.sfx('error'); }
          } else if (bb.k === 'undo') {
            const prev = (M.planUndo || []).pop();
            if (prev) { M.plan = prev; G.Audio.sfx('click'); }
            else G.Audio.sfx('error');
          }
          return;
        }
        const cb = M.planClose;
        if (cb && sx0 >= cb.x && sx0 <= cb.x + cb.w && sy0 >= cb.y && sy0 <= cb.y + cb.h) {
          M.planOpen = false;
          G.Audio.sfx('click');
          return;
        }
        const pb = M.planBtn;
        if (pb && sx0 >= pb.x && sx0 <= pb.x + pb.w && sy0 >= pb.y && sy0 <= pb.y + pb.h) {
          M.planOpen = false;
          G.Audio.sfx('click');
          return;
        }
        return;
      }
      const pb0 = M.planBtn;
      if (pb0) {
        const sxp = e.clientX - r0.left, syp = e.clientY - r0.top;
        if (sxp >= pb0.x && sxp <= pb0.x + pb0.w && syp >= pb0.y && syp <= pb0.y + pb0.h) {
          M.planOpen = !M.planOpen;
          if (M.planOpen) M.planPage = 0;
          G.Audio.sfx('click');
          return;
        }
      }
      // Fila de sinergia: fijar/soltar. Icono fijado: mini-tip 3 s (táctil).
      const sx = e.clientX - r0.left, sy = e.clientY - r0.top;
      const hitI = synIconRects.find(s => sx >= s.x && sx <= s.x + s.w && sy >= s.y && sy <= s.y + s.h);
      if (hitI) {
        const r1 = cv.getBoundingClientRect();
        M.synTip = { dex: hitI.dex, x: sx, y: sy, t: 3 };
        G.Audio.sfx('click');
        return;
      }
      const hitR = synRects.find(s => sx >= s.x && sx <= s.x + s.w && sy >= s.y && sy <= s.y + s.h);
      if (hitR) {
        M.synSel = M.synSel === hitR.type ? null : hitR.type;
        M.synTip = null;
        G.Audio.sfx('click');
        return;
      }
    }
    if (M.phase === 'over') {
      const [w, h] = screen();
      const [bx, by, bw2, bh2] = overRect(w, h);
      const sx = e.clientX - cv.getBoundingClientRect().left, sy = e.clientY - cv.getBoundingClientRect().top;
      if (sx >= bx && sx <= bx + bw2 && sy >= by && sy <= by + bh2) quitToMenu();
      return;
    }
    // Armería: sólo pasa la carta tocada; lo demás sigue su curso.
    if (M.armory && M.armory.length && M.phase === 'prep' && M.armRects) {
      const r0 = cv.getBoundingClientRect();
      const sx = e.clientX - r0.left, sy = e.clientY - r0.top;
      const hit = M.armRects.find(r => sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h);
      if (hit) {
        if (M.items.length < 7) { M.items.push(hit.id); G.UI.toast(itemDef(hit.id).name + ' a la tira'); }
        else { M.gold += 3; G.UI.toast(itemDef(hit.id).name + ' → +3 oro (tira llena)'); }
        M.armory = null; M.armRects = null;
        G.Audio.sfx('buy');
        return;
      }
    }
    // Aumentos: sólo pasa la carta tocada (o el botón de cambiar).
    if (M.augDraft && M.augDraft.length && M.phase === 'prep') {
      const r0 = cv.getBoundingClientRect();
      const sx = e.clientX - r0.left, sy = e.clientY - r0.top;
      const rf = M.augRefresh;
      if (rf && sx >= rf.x && sx <= rf.x + rf.w && sy >= rf.y && sy <= rf.y + rf.h) {
        if (M.gold >= 2) {
          M.gold -= 2;
          draftAugs(M.augDraft);
          G.Audio.sfx('buy');
        } else G.Audio.sfx('error');
        return;
      }
      if (M.augRects) {
        const hit = M.augRects.find(r => sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h);
        if (hit) {
          M.augDraft = null; M.augRects = null; M.augRefresh = null;
          applyAugment(hit.key);
          return;
        }
      }
    }
    const [wx, wy] = toWorld(e);
    // Anillo de XP: en táctil lo toca para ver el detalle.
    if (M.xpRing) {
      const z = M.xpRing;
      if (wx >= z.x && wx <= z.x + z.w && wy >= z.y && wy <= z.y + z.h) {
        const need = XP_NEED[M.level] || 0;
        G.UI.toast(M.level >= 9 ? 'Nivel máximo (9)' : 'Nv.' + M.level + ': ' + M.xp + '/' + need + ' XP · faltan ' + (need - M.xp));
        G.Audio.sfx('click');
        return;
      }
    }
    // Tienda, fijar, actualizar y XP valen en preparación Y en pelea (como en TFT);
    // mover unidades y el ¡Combatir!, sólo en preparación.
    const shopping = M.phase === 'prep' || M.phase === 'fight';
    if (!shopping) return;
    if (hitLock(wx, wy)) {
      M.shopLock = !M.shopLock;
      G.Audio.sfx(M.shopLock ? 'buy' : 'click');
      G.UI.toast(M.shopLock ? 'Tienda fijada: se conserva' : 'Tienda libre');
      return;
    }
    const si = hitShop(wx, wy);
    if (si >= 0) { buy(si); return; }
    const bi = hitBtn(wx, wy);
    if (bi === 0) {
      if ((M.freeRolls || 0) > 0) { M.freeRolls--; rollShop(); G.Audio.sfx('buy'); }
      else if (M.gold >= 2) { M.gold -= 2; rollShop(); G.Audio.sfx('buy'); }
      else G.Audio.sfx('error');
      return;
    }
    if (bi === 1) { buyXp(); return; }
    if (bi === 2) {
      if (M.phase !== 'prep') return;
      M.phaseT = Math.min(M.phaseT, 1); G.Audio.sfx('confirm'); return;
    }
    // Objetos: se cogen en preparación Y en pelea (como la tienda).
    if (M.phase === 'prep' || M.phase === 'fight') {
      const ii = hitItem(wx, wy);
      if (ii >= 0 && M.items[ii]) {
        const id = M.items[ii];
        M.items.splice(ii, 1);
        drag = { kind: 'item', id, from: {}, x: wx, y: wy, cell: null };
        G.Audio.sfx('click');
        return;
      }
    }
    // La banca se mueve también en pelea (para vender); el tablero, no.
    const bbi = hitBench(wx, wy);
    if (bbi >= 0 && M.bench[bbi]) {
      const u = M.bench[bbi];
      u.items = u.items || [];
      M.bench[bbi] = null;
      drag = { kind: 'unit', u, from: { zone: 'bench', i: bbi }, x: wx, y: wy, cell: null };
      return;
    }
    if (M.phase !== 'prep') return;
    const cell = ptrToCell(wx, wy);
    if (cell && cell.own) {
      const k = cell.c + ',' + cell.r;
      const u = M.board.get(k);
      if (u) {
        u.items = u.items || [];
        M.board.delete(k);
        drag = { kind: 'unit', u, from: { zone: 'board', c: cell.c, r: cell.r }, x: wx, y: wy, cell };
      }
    }
  }

  function onMove(e) {
    if (!drag) return;
    if (e.cancelable) e.preventDefault();
    const [wx, wy] = toWorld(e);
    drag.x = wx; drag.y = wy;
    drag.cell = ptrToCell(wx, wy);
  }

  function onUp(e) {
    if (!drag) return;
    const [wx, wy] = toWorld(e);
    // Objeto: soltarlo sobre una unidad (tablero o banca) lo equipa.
    if (drag.kind === 'item') {
      const id = drag.id;
      drag = null;
      let target = null;
      const cell = ptrToCell(wx, wy);
      if (cell && cell.own && (M.phase === 'prep' || M.phase === 'fight')) {
        const bu = M.board.get(cell.c + ',' + cell.r);
        if (bu) target = bu;
      }
      if (!target) {
        const bi = hitBench(wx, wy);
        if (bi >= 0 && M.bench[bi]) target = M.bench[bi];
      }
      if (target) {
        const key = cell && cell.own ? cell.c + ',' + cell.r : null;
        const res = equipItem(target, id);
        if (res.ok) {
          G.Audio.sfx('buy');
          starCheck();
          // En pelea, el luchador vivo lo nota al instante (iconos incluidos).
          if (key && M.phase === 'fight') {
            const live = M.units.find(e => e.cell === key && !e.dead);
            if (live && live.applyItemFx && live.unapplyItemFx) {
              for (const rid of (res.removed || [])) {
                const ix = (live.items || []).indexOf(rid);
                if (ix >= 0) { live.items.splice(ix, 1); live.unapplyItemFx(rid); }
              }
              live.items = live.items || [];
              live.items.push(res.added);
              live.applyItemFx(res.added);
            }
          }
        }
        else M.items.push(id);
      } else M.items.push(id);
      return;
    }
    const u = drag.u;
    u.items = u.items || [];
    const from = drag.from;
    drag = null;
    // Arriba del todo o en la tienda = vender.
    if (wy < -300 || (wx >= -262 && wx <= 268 && wy >= 300 && wy <= 396)) {
      const v = sellValue(u.dex, u.star);
      M.gold += v;
      // Sus objetos vuelven a la tira (o +2 de oro por cada uno si no caben).
      for (const id of (u.items || [])) {
        if (M.items.length < 7) M.items.push(id);
        else M.gold += 2;
      }
      G.Audio.sfx('coin');
      G.UI.toast('Vendido +' + v + ' oro');
      starCheck();
      return;
    }
    const cell = ptrToCell(wx, wy);
    // En pelea, de la banca no se puede subir al tablero (sólo vender o reordenar).
    if (cell && cell.own && M.phase === 'prep') {
      const k = cell.c + ',' + cell.r;
      const other = M.board.get(k);
      // Ocupada: se intercambian (venga de donde venga).
      if (!other && boardCount() < cap()) { M.board.set(k, u); G.Audio.sfx('select'); }
      else if (other) { M.board.set(k, u); putBack(from, other); G.Audio.sfx('select'); }
      else putBack(from, u);
    } else {
      const bi = hitBench(wx, wy);
      if (bi >= 0) {
        const other = M.bench[bi];
        M.bench[bi] = u;
        if (other) putBack(from, other);
        G.Audio.sfx('select');
      } else putBack(from, u);
    }
    starCheck();
  }

  function onKey(i) { if (M && (M.phase === 'prep' || M.phase === 'fight')) buy(i); }

  // ---------------- entrar / salir ----------------

  let toastBak = null;
  /** Mensaje lateral (izquierda del avatar): sustituye al toast abajo en TFT. */
  function say(text) {
    if (M) M.sideMsg = { text: String(text), t: 2.8 };
    else if (toastBak) toastBak(text);
  }

  /** Al volver de otra ventana: el juego siguió (consume fases enteras sin sonido). */
  function catchUp(elapsed) {
    const sfxBak = G.Audio.sfx;
    G.Audio.sfx = () => {};
    try {
      let budget = elapsed, guard = 60;
      while (budget > 0 && guard-- > 0 && M && (M.phase === 'prep' || M.phase === 'fight')) {
        if (M.phaseT > budget) { M.phaseT -= budget; budget = 0; }
        else {
          budget -= M.phaseT;
          if (M.phase === 'prep') { M.lastKind = roundKind(); startFight(); }
          else endFight();
          if (!M || (M.phase !== 'prep' && M.phase !== 'fight')) break;
        }
      }
    } finally {
      G.Audio.sfx = sfxBak;
    }
    if (M) M.lastTick = performance.now();
  }

  function onVis() {
    if (!document.hidden && M && (M.phase === 'prep' || M.phase === 'fight')) {
      const now = performance.now();
      const elapsed = (now - (M.lastTick || now)) / 1000;
      M.lastTick = now;
      if (elapsed > 4) {
        catchUp(elapsed);
        say('Fuera ' + Math.round(elapsed) + ' s: la partida siguió');
      }
    }
  }

  function start() {
    if (M) quitToMenu();
    if (G.Social.room) { G.UI.toast('Sal de la sala para jugar la TFT (es en solitario)'); return; }
    cv = document.getElementById('game');
    camBak = { x: G.Camera.x, y: G.Camera.y, scale: G.Camera.scale, w: G.Camera.w, h: G.Camera.h };
    // Reutiliza el mapa actual de fondo (con otro seed cada partida) y limpia
    // props del tablero para que los rayos no choquen con rocas invisibles.
    G.World.reset(Math.floor(Math.random() * 1e6));
    for (let tx = -8; tx <= 8; tx++) for (let ty = -9; ty <= 16; ty++) {
      try { G.World.breakAt(tx, ty); } catch (e) { /* nada */ }
    }
    newMatch();
    G.Game.enterTft();
    fitCamera();
    // En TFT los avisos salen junto al avatar, no abajo tapando la tienda.
    if (!toastBak) toastBak = G.UI.toast;
    G.UI.toast = msg => say(msg);
    flash('¡Todas las generaciones en juego!');
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    document.addEventListener('visibilitychange', onVis);
    G.Audio.sfx('confirm');
  }

  function detach() {
    if (!cv) return;
    cv.style.touchAction = '';
    cv.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    document.removeEventListener('visibilitychange', onVis);
    if (toastBak) { G.UI.toast = toastBak; toastBak = null; }
    cv = null;
  }

  function quitToMenu() {
    detach();
    G.Projectiles.clear();
    G.Combat.clearFields();
    G.Combat.clearFoeProvider();
    if (camBak) { G.Camera.x = camBak.x; G.Camera.y = camBak.y; G.Camera.scale = camBak.scale; G.Camera.w = camBak.w; G.Camera.h = camBak.h; }
    portraits = {};
    drag = null;
    M = null;
    G.Game.exitTft();
    G.Flow.goMenu();
  }

  function askQuit() {
    if (!M || M.phase === 'over') { quitToMenu(); return; }
    if (confirm('¿Abandonar la TFT? Cuenta como derrota.')) quitToMenu();
  }

  return { start, quitToMenu, askQuit, update, drawWorld, drawScreen, buy: onKey,
           refresh() { if (M && (M.phase === 'prep' || M.phase === 'fight')) { if (M.gold >= 2) { M.gold -= 2; rollShop(); G.Audio.sfx('buy'); } else G.Audio.sfx('error'); } },
           xp() { if (M) buyXp(); },
           get active() { return !!M; } };
})();

