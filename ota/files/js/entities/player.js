/* ============ player.js — el Pokémon que controlas ============
 * (x, y) son los PIES. Sólo UN movimiento está activo a la vez: se dispara
 * solo y se cambia con 1-4 / Q / E. Cada disparo reproduce la animación de
 * ataque de Mundo Misterioso que le toca (Attack, Shoot o Charge).
 */
G.Player = class Player {
  /**
   * @param mon   entrada de G.DEX
   * @param perks mejoras permanentes ya resueltas (ver data/upgrades.js)
   */
  constructor(mon, perks = {}, shiny = false) {
    this.mon = mon;
    this.dex = mon.dex;
    this.shiny = shiny && G.Sprites.hasShiny(mon.dex);
    // Los grandes, algo más pequeños y con el choque de uno normal (ver sprites.js).
    this.scale = G.Sprites.playerScale(mon.dex);
    this.anim = new G.Sprites.Animator(mon.dex, this.scale, this.shiny);
    this.x = 0; this.y = 0;
    this.r = G.Sprites.playerRadius(mon.dex);
    this.bodyH = G.Sprites.bodyHeight(mon.dex, this.scale);

    this.atkMul = perks.atkMul || 1;
    this.spdMul = perks.spdMul || 1;
    this.cdMul = perks.cdMul || 1;
    this.dmgReduce = perks.dmgReduce || 0;
    this.regenFlat = perks.regen || 0;
    this.magnet = 78 * (perks.magnetMul || 1);
    this.xpMul = perks.xpMul || 1;
    this.coinMul = perks.coinMul || 1;

    this.maxHp = mon.hp + (perks.hp || 0);
    this.hp = this.maxHp;
    this.baseSpd = mon.spd;
    this.baseAtk = mon.atk;

    this.moves = [];           // todos los movimientos aprendidos
    this.slots = [];           // huecos: cada uno, una lista de movimientos que se lanzan a la vez
    this.active = 0;           // hueco activo
    this.maxMoves = 4;         // huecos
    this.bonds = 0;            // vínculos por usar (premio de los legendarios)
    this.bondMax = 4;          // movimientos por vínculo (la carta Fusión lo sube hasta 6)

    // patk / satk: Danza Espada y Danza Dragón (físico) y Maquinación (especial).
    this.buffs = {
      atk: { n: 0, t: 0, amount: 0 },
      patk: { n: 0, t: 0, amount: 0 },
      satk: { n: 0, t: 0, amount: 0 },
      spd: { n: 0, t: 0, amount: 0 },
      def: { n: 0, t: 0, amount: 0 },
      regen: { n: 0, t: 0, amount: 0 }
    };

    this.level = 1;
    this.xp = 0;
    this.xpNext = Player.xpFor(1);
    this.kills = 0;
    this.bosses = 0;
    this.rerolls = 0;          // veces que ha cambiado las cartas de nivel en esta run
    this.rerollBonus = perks.rerolls || 0;   // cambios comprados en Mejoras (más el gratis)
    this.critChance = perks.crit || 0;       // probabilidad de golpe crítico (Mejoras)
    this.banned = new Set();                 // movimientos vetados (Mejoras → Veto): no salen en las cartas
    this.bind = {};                          // movimiento -> hueco fijo (0-3), elegido en Mejoras
    this.coins = 0;            // monedas recogidas en esta run
    this.t1 = 0; this.t10 = 0; // tickets del gacha recogidos en esta run
    this.evoStage = 0;         // evoluciones de especie en esta run (0-2)
    this.secondWind = perks.revive || 0;   // cargas de Renacer (mejora): revivir 1 vez
    this.megaT = 0;            // tiempo de megaevolución en banco (s)
    this.megaOn = false;       // forma mega activa ahora mismo
    this.megaCd = 0;           // recarga para volver a megaevolucionar (s)
    this.megaUsed = false;     // si ya la usó en la run (esas runs no rankean)
    this.megaAtk = 1; this.megaSpd = 1;    // bonus mientras dura la mega
    this.dmgDealt = 0;

    this.invuln = 0;
    this.flash = 0;
    this.dodgeCd = 0;          // recarga restante del esquive (s)
    this.dodgeT = 0;           // tiempo de dash restante (s)
    this.dodgeDx = 1; this.dodgeDy = 0;   // dirección del dash
    this.dodgeFxT = 0;
    this.aim = Math.PI / 2;
    this.moveAngle = Math.PI / 2;
    this.walking = false;
    this.inLiquid = false;
    this.lavaTick = 0;
    this.attackFace = 0;       // tiempo que sigue mirando al objetivo tras atacar
    this.dead = false;
    this.power = null;         // poder de altar activo: { def, t, dur }
    this.slowT = 0;            // pegado por una trampa
    this.item = null;          // objeto equipado (data/items.js), uno por run
    this.sashT = -999;         // última vez que salvó la Banda Focus
    this.bellHeal = 0;         // curación pendiente del Cascabel Concha
    this.statsTaken = {};      // mejoras de stat cogidas (condición de evolución)
  }

  /** Segundos que hay que estar junto a un compañero caído para levantarlo. */
  static get REVIVE_TIME() { return 3; }

  // ---------------- megaevolución ----------------
  // Con su megapiedra equipada (tecla X): 30 s con la forma mega y mejores
  // stats (+20 % de vida; la X pega más y la Y corre más). Al terminar,
  // 4 min de recarga para volver a usarla.
  static get MEGA_TIME() { return 90; }
  static get MEGA_CD() { return 150; }

  /** Variante de megapiedra equipada para este Pokémon ('X'/'Y'/'M'), o null. */
  megaStone() {
    const s = G.DB.save;
    if (!s) return null;
    const v = (s.mstoneOn || {})[this.dex];
    return (v && (s.mstones || {})[this.dex + ':' + v]) ? v : null;
  }

  canMega() {
    const v = this.megaStone();
    // OJO: sin exigir megaT<=0, que el tiempo en banco es para reutilizarlo.
    return !this.dead && !this.frozen && this.megaCd <= 0 && !!v &&
           !!G.Sprites.hasMega(this.dex, G.mstoneForm(v));
  }

  /** Intenta megaevolucionar... o volver a normal si ya estás (X hace de interruptor).
   *  Al volver a normal el tiempo que quedaba se guarda en banco: puedes volver
   *  a entrar hasta consumirlo. La recarga de 4 min sólo entra al agotarlo. */
  tryMega() {
    if (this.dead || this.frozen) return false;
    // ¿Volver a normal guardando lo que queda?
    if (this.megaOn) { this.endMega(true, false); return true; }
    const v = this.megaStone();
    if (!v || !this.canMega()) return false;
    const form = G.mstoneForm(v), st = G.MSTONE_STATS[v] || G.MSTONE_STATS.M;
    const fresh = this.megaT <= 0;
    if (fresh) { this.megaT = Player.MEGA_TIME; this.megaUsed = true; G.Audio.megaRestart(); }
    this.megaOn = true;
    const prevAnim = this.anim, prevH = this.bodyH;
    this.applyMegaForm(form, st);
    this.megaFx = { t: 0, dur: 1.4, swap: 0.7, prev: prevAnim, prevH, done: false };
    G.FX.ring(this.x, this.y, 8, 90, '#ffd23f', 0.7, 4);
    G.Audio.sfx('legend');
    const megaName = 'Mega-' + this.mon.name + (v === 'M' ? '' : ' ' + v);
    G.Spawner.say(fresh
      ? '¡' + megaName + '! +' + Math.round((st.atk - 1) * 100) + '% ataque, +' +
        Math.round((st.spd - 1) * 100) + '% velocidad, +20% vida 1:30 min (X para salir y guardar, recarga 2:30 al agotarlo)'
      : '¡' + megaName + ' de nuevo! Te quedan ' + G.U.mmss(this.megaT), 4);
    return true;
  }

  /** Animación de megaevolución: carga (sprite viejo parpadeando en blanco, chispas hacia dentro),
   *  destello a mitad y forma mega con la piedra encima de la cabeza. */
  tickMegaFx(dt) {
    const f = this.megaFx;
    f.t += dt;
    if (f.prev) f.prev.update(dt);
    const cy = this.y - (f.t < f.swap ? f.prevH : this.bodyH) * 0.5;
    if (f.t < f.swap) {
      // Chispas que se meten hacia el cuerpo, cada vez más rápido.
      const k = f.t / f.swap;
      if (Math.random() < dt * (20 + 60 * k)) {
        const a = Math.random() * 6.2832, d = G.U.lerp(70, 22, k) * G.U.rand(0.8, 1.2);
        G.FX.twinkle(this.x + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8);
      }
      if (!f.r2 && k > 0.35) { f.r2 = true; G.FX.ring(this.x, this.y, 70, 14, '#ff8ad8', 0.45, 3); }
    } else if (!f.done) {
      f.done = true;                          // el momento del destello
      G.FX.ring(this.x, this.y, 8, 150, '#ffffff', 0.7, 6);
      G.FX.ring(this.x, this.y, 8, 105, '#ffd23f', 0.9, 4);
      G.FX.burst(this.x, cy, '#ffe14d', 46, 280);
      G.FX.burst(this.x, cy, '#ffffff', 22, 180);
      G.Audio.sfx('shiny');
    }
    if (f.t >= f.dur) this.megaFx = null;
  }

  /** Dibuja la sprite durante la transformación (en vez de la normal) y la columna de luz. */
  drawMegaFx(ctx, alpha) {
    const f = this.megaFx, t = f.t;
    const H = f.t < f.swap ? f.prevH : this.bodyH;
    // Columna de luz: sube hasta el destello y se desvanece.
    const beam = t < f.swap ? (t / f.swap) * 0.45 : Math.max(0, 1 - (t - f.swap) / 0.5) * 0.85;
    if (beam > 0.02) {
      const w = (this.r * 2.4) * (t < f.swap ? 0.5 + t / f.swap * 0.5 : 1 + (t - f.swap) * 1.5);
      const g = ctx.createLinearGradient(0, this.y - 220, 0, this.y + 6);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.6, 'rgba(255,240,170,' + beam + ')'); g.addColorStop(1, 'rgba(255,255,255,' + beam + ')');
      ctx.save(); ctx.fillStyle = g; ctx.fillRect(this.x - w / 2, this.y - 220, w, 226); ctx.restore();
    }
    if (t < f.swap) {
      // Forma vieja: silueta blanca que parpadea cada vez más rápido.
      const blink = Math.floor(t * (10 + 26 * (t / f.swap))) % 2 === 0;
      f.prev.draw(ctx, this.x, this.y, { flash: blink, alpha });
    } else {
      // Forma mega: nace blanca y recupera su color.
      const k = (t - f.swap) / (f.dur - f.swap);
      this.anim.draw(ctx, this.x, this.y, { flash: k < 0.5 && Math.floor(t * 30) % 2 === 0, softFlash: k >= 0.2, alpha });
    }
    return H;
  }

  /** Imagen de la megapiedra equipada (la misma del chip de mega), o null si aún carga. */
  megaStoneImage() {
    let v = this.megaStone();
    if (!v && this.megaForm) v = this.megaForm === 'megay' ? 'Y' : (G.MSTONE_OF[this.dex + ':X'] ? 'X' : 'M');   // compañero en LAN/coop
    const st = v && G.MSTONE_OF[this.dex + ':' + v];
    if (!st) return null;
    const src = 'assets/items/stones/' + st.img + '.png';
    const c = (Player._stoneImgs = Player._stoneImgs || {});
    let im = c[src];
    if (!im) { im = new Image(); im.src = src; c[src] = im; }
    return im.complete && im.naturalWidth ? im : null;
  }

  /** Piedra de megaevolución flotando sobre la cabeza mientras dura la mega
   *  (en la transformación aparece grande y se asienta). */
  drawMegaStone(ctx) {
    const im = this.megaStoneImage();
    if (!im) return;
    const f = this.megaFx;
    let sc = 1, a = 1;
    if (f) {
      const t = f.t;
      if (t < f.swap) { sc = 0.4 + 1.3 * (t / f.swap); a = Math.min(1, t / 0.25); }      // sube y crece
      else sc = 1.7 - 0.7 * Math.min(1, (t - f.swap) / 0.5);                              // se asienta
    }
    const bob = Math.sin(performance.now() / 260) * 2.5;
    const size = 26 * sc;
    const cx = this.x, cy = this.y - this.bodyH - 18 + bob;
    ctx.save();
    ctx.globalAlpha = a;
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, size);
    g.addColorStop(0, 'rgba(255,230,120,.55)'); g.addColorStop(1, 'rgba(255,230,120,0)');
    ctx.fillStyle = g; ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, Math.round(cx - size / 2), Math.round(cy - size / 2), Math.round(size), Math.round(size));
    ctx.restore();
  }

  /** Stats y sprite de la forma mega (para entrar o re-entrar). */
  applyMegaForm(form, st) {
    this.megaForm = form;
    this.megaAtk = st.atk;
    this.megaSpd = st.spd;
    this.megaHpB = Math.round(this.maxHp * G.MSTONE_HP);
    this.maxHp += this.megaHpB;
    this.hp = Math.min(this.maxHp, this.hp + this.megaHpB);
    this.anim = new G.Sprites.Animator(this.dex, 1, this.shiny, form);
    this.r = G.Sprites.bodyRadius(this.dex, 1, form);
    this.bodyH = G.Sprites.bodyHeight(this.dex, 1, form);
  }

  /** Compañero en LAN/cooperativo: pone o quita su forma mega (sólo lo que se ve; sus stats ya llegan por la red). */
  setRemoteMega(form) {
    if ((form || null) === (this.megaForm || null)) return;
    const prevAnim = this.anim, prevH = this.bodyH;
    this.megaForm = form || null;
    this.megaOn = !!form;
    this.anim = new G.Sprites.Animator(this.dex, 1, this.shiny, form || undefined);
    this.r = G.Sprites.bodyRadius(this.dex, 1, form || undefined);
    this.bodyH = G.Sprites.bodyHeight(this.dex, 1, form || undefined);
    if (form) {
      this.megaFx = { t: 0, dur: 1.4, swap: 0.7, prev: prevAnim, prevH, done: false };       // la misma transformación que ve el dueño
      G.FX.ring(this.x, this.y, 8, 90, '#ffd23f', 0.7, 4);
    } else this.megaFx = null;
  }

  /** Vuelve a la forma normal. charge=false = guardas el tiempo en banco (tecla X o evolución). */
  endMega(quiet = false, charge = true) {
    if (!this.megaOn && this.megaAtk === 1) return;
    this.megaOn = false;
    this.megaFx = null;
    if (charge) this.megaCd = Player.MEGA_CD;
    this.megaAtk = 1; this.megaSpd = 1;
    if (this.megaHpB) { this.maxHp -= this.megaHpB; this.hp = Math.min(this.hp, this.maxHp); this.megaHpB = 0; }
    this.megaForm = null;
    if (!this.dead) {
      this.anim = new G.Sprites.Animator(this.dex, 1, this.shiny);
      this.r = G.Sprites.bodyRadius(this.dex, 1);
      this.bodyH = G.Sprites.bodyHeight(this.dex, 1);
      if (!quiet) {
        G.FX.burst(this.x, this.y - this.bodyH * 0.5, '#c9b0ff', 16, 140);
        G.Spawner.say('Vuelves a la normalidad', 2.2);
      }
    }
  }

  // ---------------- esquive ----------------
  // Mini-dash en la dirección en que te mueves (o miras, si estás quieto):
  // 0,22 s a ×3,1 de velocidad + 0,45 s sin daño, con 1,5 s de recarga.
  static get DODGE_CD() { return 1.5; }
  static get DODGE_TIME() { return 0.22; }
  static get DODGE_MULT() { return 3.1; }
  static get DODGE_IFRAME() { return 0.45; }

  /** Intenta esquivar. Devuelve false si estás muerto, parado por la pausa o sin recarga. */
  tryDodge() {
    if (this.dead || this.frozen || this.dodgeCd > 0) return false;
    let [ax, ay] = G.Input.axis();
    if (ax === 0 && ay === 0) { ax = Math.cos(this.moveAngle); ay = Math.sin(this.moveAngle); }
    const [nx, ny] = G.U.norm(ax, ay);
    this.dodgeDx = nx; this.dodgeDy = ny;
    this.dodgeT = Player.DODGE_TIME;
    this.dodgeCd = Player.DODGE_CD;
    this.invuln = Math.max(this.invuln, Player.DODGE_IFRAME);
    this.dodgeFxT = 0;
    G.Audio.sfx('dodge');
    G.FX.ring(this.x, this.y - G.LIFT * 0.5, 6, this.r * 3.2, '#7fe0ff', 0.3, 3);
    return true;
  }

  // (×2 y luego ×4 el 2026-10-10: se subía de nivel demasiado rápido.)
  static xpFor(level) {
    return Math.floor((8 + level * 6 + Math.pow(level, 1.75) * 1.6) * 4);
  }

  cy() { return this.y; }

  // ---------------- stats efectivos ----------------
  get atk() { return this.baseAtk * this.atkMul * this.megaAtk * (1 + this.buffs.atk.n * this.buffs.atk.amount); }
  /**
   * Ataque con un movimiento: el físico o el especial de tu Pokémon (ver
   * G.Stats), con las danzas que sean de su lado (las de mejora, sin ninguna).
   */
  atkFor(m) {
    const cat = m && m.cat, b = cat === 'physical' ? this.buffs.patk : cat === 'special' ? this.buffs.satk : null;
    return this.atk * G.Stats.fit(this.mon, cat) * (b ? 1 + b.n * b.amount : 1) * (m && this.monoType(m.type) ? Player.MONO_K : 1);
  }
  /** Monotipo (19-10-2026): los de un solo tipo pegan un +20 % con los ataques de su tipo (tienen menos variedad). */
  static get MONO_K() { return 1.2; }
  monoType(type) { return this.mon.types.length === 1 && type === this.mon.types[0]; }
  get spd() {
    const s = this.baseSpd * this.spdMul * this.megaSpd * (1 + this.buffs.spd.n * this.buffs.spd.amount) * (this.slowT > 0 ? 0.5 : 1);
    const w = G.Weather.speedFor(this.mon.types);
    const slow = this.inLiquid ? G.World.liquidEffect(this.mon.types).slow || 1 : 1;
    return G.Judgment && G.Judgment.active ? G.Judgment.capSpd(s * slow * w) : s * slow * w;
  }
  get reduction() { return Math.min(0.8, this.dmgReduce + this.buffs.def.n * this.buffs.def.amount); }
  get regen() { return this.regenFlat + this.buffs.regen.n * this.buffs.regen.amount; }

  // ---------------- movimientos ----------------
  addMove(id) {
    if (this.slots.length >= this.maxMoves || this.hasMove(id)) return false;
    const m = G.Moves.instance(id, 1);
    m.since = G.Game.st.time;          // desde cuándo lo tienes (daño por segundo en el resumen)
    this.moves.push(m);
    const group = [m];
    this.slots.push(group);
    this.arrange();
    // Te quedas con el que llevabas (18-10-2026: antes se cambiaba solo al nuevo
    // y te quitaba el ataque que estabas usando). Sólo si no tenías ninguno, el nuevo.
    if (!this.slots[this.active]) this.active = this.slots.indexOf(group);
    return true;
  }

  /**
   * Huecos fijos (Mejoras → Atajos): cada movimiento con hueco elegido se pone
   * en ese número para la memoria muscular (Confusión siempre en el 1...).
   * Mientras no tengas tantos movimientos, va al más cercano; los demás
   * rellenan los huecos libres en el orden en que los aprendiste.
   */
  arrange() {
    const n = this.slots.length;
    if (n < 2 || !this.bind) return;
    const want = g => { let k = Infinity; for (const m of g) if (this.bind[m.id] != null) k = Math.min(k, this.bind[m.id]); return k; };
    const cur = this.slots[this.active];
    const out = new Array(n).fill(null);
    const bound = this.slots.filter(g => want(g) < Infinity).sort((a, b) => want(a) - want(b));
    for (const g of bound) {
      let p = Math.min(want(g), n - 1);
      while (p >= 0 && out[p]) p--;                          // ocupado: el de antes
      if (p < 0) { p = 0; while (out[p]) p++; }              // o el primero libre
      out[p] = g;
    }
    for (const g of this.slots) if (!out.includes(g)) out[out.indexOf(null)] = g;
    this.slots = out;
    if (cur) this.active = out.indexOf(cur);
  }

  hasMove(id) { return this.moves.some(m => m.id === id); }

  setActive(i) {
    if (i < 0 || i >= this.slots.length || i === this.active) return;
    // Cinta Elección: no se puede cambiar de movimiento.
    if (this.hasItem('choiceband') && this.slots[this.active]) {
      G.FX.dmgText(this.x, this.y - this.bodyH - 8, 'Cinta Elección', '#ff8ad8');
      return;
    }
    this.active = i;
    G.Projectiles.clearOrbs(this);
    G.Audio.sfx('select');
    for (const m of this.slots[i]) m.t = Math.min(m.t, m.cd * 0.35);
    const m = this.slots[i][0];
    G.FX.ring(this.x, this.y - G.LIFT * 0.5, 6, this.r * 3.4, G.U.TYPE_COLOR[m.type], 0.3, 3);
  }

  cycle(dir) {
    if (!this.slots.length) return;
    this.setActive((this.active + dir + this.slots.length) % this.slots.length);
  }

  // ---------------- vínculos (fusiones) ----------------
  // Cada legendario vencido da un vínculo. Con él se juntan movimientos en un
  // solo hueco y se lanzan a la vez. Sólo crece un grupo (hasta bondMax, 4 de
  // base y 6 con la carta Fusión); si no hay ninguno a medias, el vínculo une
  // dos movimientos sueltos.
  static get BOND_MAX() { return 4; }

  /** Lo que se puede hacer ahora con un vínculo: añadir a un grupo o unir dos sueltos. */
  bondOptions() {
    const loose = this.slots.filter(s => s.length === 1).map(s => s[0]);
    const grow = this.slots.find(s => s.length > 1 && s.length < (this.bondMax || 4));
    if (grow) return loose.length ? { mode: 'add', group: grow, loose } : null;
    return loose.length >= 2 ? { mode: 'pair', group: null, loose } : null;
  }

  /** Junta `moves` (sueltos) en el grupo `group` (o en uno nuevo) y gasta un vínculo. */
  fuse(moves, group = null) {
    const target = group || this.slots.find(s => s[0] === moves[0]);
    const cur = this.slots[this.active];
    for (const m of moves) {
      if (target.includes(m)) continue;
      const i = this.slots.findIndex(s => s.length === 1 && s[0] === m);
      if (i < 0) continue;
      this.slots.splice(i, 1);
      target.push(m);
    }
    this.arrange();
    // Se pasa al grupo, salvo con la Cinta Elección (sigues en el hueco que tenías, si queda).
    const a = this.slots.indexOf(cur);
    this.active = this.hasItem('choiceband') && a >= 0 ? a : this.slots.indexOf(target);
    this.bonds = Math.max(0, this.bonds - 1);
    G.Projectiles.clearOrbs(this);
    return target;
  }

  /**
   * Evolución de especie en la run (Charmander -> Charmeleon...): cambian sus
   * stats base, sus tipos (¡cuidado con las nuevas debilidades!), su sprite y
   * aprende el movimiento inicial de su forma nueva si hay hueco. Es SÓLO de
   * la run; tu compañero no cambia, pero la forma SÍ se apunta en tu Pokédex.
   */
  evolveTo(dex) {
    const mon = G.DEX_BY[dex];
    if (!mon || this.dead) return false;
    if (this.megaOn) this.endMega(true, false);   // la mega no viaja a la evolución (se guarda el tiempo)
    const from = this.mon.name, prevDex = this.dex;
    const dhp = mon.hp - this.mon.hp;
    this.mon = mon;
    this.dex = mon.dex;
    this.evoStage = (this.evoStage || 0) + 1;
    if (dhp !== 0) this.addMaxHp(dhp);
    this.baseSpd = mon.spd;
    this.baseAtk = mon.atk;
    if (this.shiny && !G.Sprites.hasShiny(mon.dex)) this.shiny = false;
    this.anim = new G.Sprites.Animator(mon.dex, 1, this.shiny);
    this.r = G.Sprites.bodyRadius(mon.dex, 1);
    this.bodyH = G.Sprites.bodyHeight(mon.dex, 1);
    if (G.DB.save) {
      const s = G.DB.save;
      // Las mejoras permanentes viajan con la evolución (se queda el mayor
      // nivel): en ESTA run ya llevabas sus bonus desde el inicio y no pierdes
      // nada; y en las próximas runs con esta forma los tienes puestos.
      s.pupg[mon.dex] = s.pupg[mon.dex] || {};
      const mine = s.pupg[mon.dex], prev = s.pupg[prevDex] || {};
      for (const k in prev) mine[k] = Math.max(mine[k] || 0, prev[k]);
      // Atajos y vetos también viajan.
      if (s.pbind && s.pbind[prevDex] && !s.pbind[mon.dex]) s.pbind[mon.dex] = s.pbind[prevDex].slice();
      if (s.pban && s.pban[prevDex] && !(s.pban[mon.dex] || []).length) s.pban[mon.dex] = s.pban[prevDex].slice();
      if (!G.DB.owns(mon.dex)) G.DB.grant(mon.dex, 'evolve');
      G.DB.commit();
    }
    const st = G.startMoveOf(mon.dex);
    if (this.slots.length < this.maxMoves && !this.hasMove(st)) this.addMove(st);
    // Al evolucionar te da una habilidad aleatoria de sus tipos nuevos; si ya
    // las tienes todas (o no hay hueco), mejora una que lleves de esos tipos.
    let upTxt = '';
    const had = this.moves.map(m => m.id);
    const pick = G.evoTypeMove(mon.types, had);
    const freshId = pick.fresh && !this.hasMove(pick.fresh) ? pick.fresh : null;
    if (freshId && this.slots.length < this.maxMoves) {
      this.addMove(freshId);
      upTxt = ' ¡Aprende ' + G.Moves.BY_ID[freshId].name + '!';
    } else {
      const ups = this.moves.filter(m => mon.types.includes(m.type) && m.lvl < m.def.maxLvl);
      const pool2 = ups.length ? ups : this.moves.filter(m => m.lvl < m.def.maxLvl);
      if (pool2.length) {
        const um = G.U.pick(pool2);
        if (G.Moves.levelUp(um)) upTxt = ' ¡' + um.name + ' sube a Nv.' + um.lvl + '!';
      }
    }
    G.FX.ring(this.x, this.y, 8, 120, '#ffd23f', 0.8, 6);
    G.FX.burst(this.x, this.y - this.bodyH * 0.5, '#ffe14d', 40, 240);
    G.Audio.sfx('legend');
    G.Spawner.say('¡' + from + ' evoluciona en ' + mon.name + '!' + upTxt, 3.5);
    return true;
  }

  /** Movimientos que se lanzan ahora (el grupo del hueco activo). */
  activeGroup() { return this.slots[this.active] || []; }
  activeMove() { return this.activeGroup()[0]; }

  /**
   * Lo llama combat.js al lanzar un movimiento. Elige la animación de PMD y la
   * acelera si la recarga es más corta que la animación, para que encadene.
   */
  cast(m) {
    // Vidasfera: cada ataque cuesta un poco de vida (nunca te deja KO).
    if (this.hasItem('lifeorb') && m.kind !== 'orbit' && m.kind !== 'trail' && !this.remote) {
      this.hp = Math.max(1, this.hp - Math.max(1, this.maxHp * 0.01));
    }
    const anim = { melee: 'Attack', beam: 'Shoot', projectile: 'Shoot', nova: 'Attack',
                   aura: 'Charge', buff: 'Charge', orbit: 'Charge', boomerang: 'Shoot', chain: 'Shoot',
                   mine: 'Charge', meteor: 'Charge', turret: 'Charge', dash: 'Attack', trail: 'Walk', cone: 'Shoot' }[m.kind] || 'Attack';
    // Las familias nuevas suenan como la parecida de las de siempre.
    const SND = { boomerang: 'projectile', chain: 'beam', mine: 'nova', meteor: 'nova', turret: 'buff', dash: 'melee', trail: 'aura', cone: 'projectile' };
    // El rastro no suena a cada charco (sería un zumbido constante).
    if (m.kind !== 'trail') G.Audio.sfx('shot', { kind: SND[m.kind] || m.kind, type: m.type });
    if (m.kind === 'trail') return;
    // No reinicies una animación que va por la mitad: se vería a tirones.
    if (this.anim.busy() && this.anim.progress() < 0.65) return;
    const meta = G.Sprites.animMeta(this.dex, anim);
    const len = meta ? meta.d.reduce((a, b) => a + b, 0) / 60 : 0.4;
    const cd = Math.max(0.12, m.cd * this.cdMul);
    this.anim.play(anim, { speed: Math.max(1, len / (cd * 0.9)) });
    this.attackFace = 0.35;
  }

  // ---------------- daño y curación ----------------
  /**
   * @param type  tipo del ataque (tabla de tipos y clima); sin tipo, daño tal cual
   * @param pure  daño que no baja con la defensa ni el cuerpo a cuerpo (Arceus)
   */
  /** @param cat  'physical' | 'special': con qué defensa tuya se para (la del enemigo que pega). */
  hurt(amount, type = null, pure = false, cat = null) {
    if (this.invuln > 0 || this.dead) return;
    if (!pure) amount *= G.Stats.taken(this.mon, cat);
    let eff = null;
    if (type) {
      const k = G.Types.mult(type, this.mon.types);
      eff = G.Types.label(k);
      amount *= k * G.Weather.mult(type);
    }
    // Con un ataque cuerpo a cuerpo activo se recibe un 25 % menos: hay que
    // estar encima de los enemigos para pegar (iban muy por detrás).
    const close = this.activeGroup().some(m => m.kind === 'melee') ? 0.75 : 1;
    const d = pure ? Math.max(1, amount) : Math.max(1, amount * (1 - this.reduction) * close);
    this.hp -= d;
    this.invuln = 0.45;
    this.flash = 0.14;
    G.Audio.sfx('hurt');
    G.Camera.kick(0.28);
    if (!this.remote) G.Pad.rumble(0.25 + Math.min(0.75, d / this.maxHp * 3), 140);
    G.FX.dmgText(this.x, this.y - this.bodyH - 4, '-' + Math.round(d), eff === 'super' ? '#ff3048' : eff === 'weak' ? '#c9a0a8' : '#ff6b7a', eff === 'super');
    G.FX.burst(this.x, this.y - this.bodyH * 0.5, '#ff5f6d', 6, 90);
    // Banda Focus: aguanta el golpe con 1 de vida (una vez cada 60 s).
    if (this.hp <= 0 && this.hasItem('focussash') && performance.now() - this.sashT > 60000) {
      this.sashT = performance.now();
      this.hp = 1; this.invuln = 1.2;
      G.FX.dmgText(this.x, this.y - this.bodyH - 16, '¡Banda Focus!', '#ff9a3d', true);
      G.FX.ring(this.x, this.y, 6, 70, '#ff9a3d', 0.5, 4);
    }
    if (this.hp <= 0) {
      // Renacer (mejora): la primera vez no caes: apareces con la mitad de la
      // vida en un sitio despejado, con 2 s sin daño.
      if (this.secondWind > 0) {
        this.secondWind--;
        const [sx, sy] = this.reviveSpot();
        this.x = sx; this.y = sy;
        this.svx = 0; this.svy = 0;
        this.hp = Math.max(1, Math.round(this.maxHp * 0.5));
        this.invuln = 2;
        this.flash = 0.3;
        G.FX.ring(this.x, this.y, 8, 110, '#ffe14d', 0.7, 5);
        G.FX.burst(this.x, this.y - this.bodyH * 0.5, '#ffe14d', 30, 220);
        G.Audio.sfx('legend');
        G.Camera.kick(0.5);
        G.Spawner.say('¡Renaces con la mitad de la vida en un lugar seguro!', 3.2);
        return;
      }
      this.hp = 0; this.dead = true;
      this.anim.play('Faint', { hold: true });
      G.Projectiles.clearOrbs(this);
      this.reviveT = 0;
    }
  }

  /** Punto libre para Renacer: 10 intentos, el que tenga menos enemigos cerca. */
  reviveSpot() {
    let bx = this.x, by = this.y, best = Infinity;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * 6.2832, d = G.U.rand(280, 460);
      const x = this.x + Math.cos(a) * d, y = this.y + Math.sin(a) * d * 0.85;
      if (!G.World.isFree(x, y, 14)) continue;
      const n = G.EnemyMgr.queryCircle(x, y, 160).filter(e => !e.dead).length;
      if (n < best) { best = n; bx = x; by = y; if (n === 0) break; }
    }
    return [bx, by];
  }
  heal(amount) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    const got = Math.round(this.hp - before);
    if (got >= 1) G.FX.dmgText(this.x, this.y - this.bodyH - 6, '+' + got, '#5fe08a');
    // El dúo recibe la mitad de la curación NOMINAL: aunque a ti te sobre vida,
    // la baya/carta también le vale a él.
    if (G.Duo && amount >= 1) G.Duo.shareHeal(Math.round(amount));
  }

  addMaxHp(amount) { this.maxHp += amount; this.hp += amount; }

  /** Devuelve cuántos niveles ha subido (pueden ser varios de golpe). */
  gainXp(amount) {
    this.xp += amount * this.xpMul;
    let leveled = 0;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = Player.xpFor(this.level);
      leveled++;
    }
    return leveled;
  }

  // ---------------- objeto equipado ----------------
  hasItem(id) { return this.item === id; }

  /** Se pone un objeto (y se quita el que llevara). */
  equip(id) {
    if (this.item) G.Items.BY[this.item].off(this);
    this.item = id;
    if (id) G.Items.BY[id].on(this);
  }

  /** Cascabel Concha: un poco de vida por el daño que haces (tope 4/s). */
  onDealt(dmg) {
    if (this.item === 'shellbell') this.bellHeal = Math.min(4, this.bellHeal + dmg * 0.04);
  }

  /** Poder de un altar (ver systems/interact.js): se aplica y se quita solo. */
  addPower(def, dur) {
    if (this.power) this.power.def.off(this);
    def.on(this);
    this.power = { def, t: dur, dur };
  }

  addBuff(stat, amount, dur, maxStacks) {
    const b = this.buffs[stat];
    if (!b) return;
    b.amount = amount;
    b.n = Math.min(maxStacks, b.n + 1);
    b.t = dur;
  }

  // ---------------- ciclo ----------------
  update(dt) {
    this.anim.update(dt);
    if (this.megaFx) this.tickMegaFx(dt);
    if (this.dead) return;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.dodgeCd > 0) this.dodgeCd -= dt;
    // Megaevolución: cuenta atrás sólo mientras está activa (en banco no gasta).
    if (this.megaOn && this.megaT > 0) {
      this.megaT -= dt;
      if (Math.random() < dt * 10) G.FX.twinkle(this.x + G.U.rand(-this.r, this.r), this.y - G.U.rand(4, this.bodyH));
      if (this.megaT <= 0) this.endMega();
    }
    if (this.megaCd > 0) this.megaCd -= dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.attackFace > 0) this.attackFace -= dt;

    for (const k in this.buffs) {
      const b = this.buffs[k];
      if (b.n > 0) { b.t -= dt; if (b.t <= 0) b.n = 0; }
    }
    if (this.slowT > 0) this.slowT -= dt;
    if (this.bellHeal > 0) { const h = Math.min(this.bellHeal, 4 * dt); this.hp = Math.min(this.maxHp, this.hp + h); this.bellHeal -= h; }
    if (this.power && (this.power.t -= dt) <= 0) { this.power.def.off(this); this.power = null; }
    if (this.regen > 0) this.hp = Math.min(this.maxHp, this.hp + this.regen * dt);

    // --- movimiento con colisiones ---
    // (En cooperativo la pausa no para el juego: sólo te quedas quieto.)
    const [ax, ay] = this.frozen ? [0, 0] : G.Input.axis();
    const s = this.spd;
    if (this.dodgeT > 0 && !this.frozen) {
      // Esquive: dash recto, sin resbalar ni obedecer al joystick a mitad.
      this.dodgeT -= dt;
      const ds = s * Player.DODGE_MULT;
      this.svx = this.dodgeDx * ds;
      this.svy = this.dodgeDy * ds;
      this.x += this.svx * dt;
      this.y += this.svy * dt;
      G.World.collide(this);
      this.walking = true;
      this.moveAngle = Math.atan2(this.dodgeDy, this.dodgeDx);
      this.dodgeFxT -= dt;
      if (this.dodgeFxT <= 0) {
        this.dodgeFxT = 0.04;
        G.FX.burst(this.x, this.y - this.bodyH * 0.5, '#7fe0ff', 2, 50);
      }
    } else {
    // Hielo: resbalas (la velocidad cambia despacio).
    const slide = this.inLiquid && G.World.liquidEffect(this.mon.types).slide;
    this.svx = slide ? G.U.damp(this.svx || 0, ax * s * 1.15, 1.6, dt) : ax * s;
    this.svy = slide ? G.U.damp(this.svy || 0, ay * s * 1.15, 1.6, dt) : ay * s;
    this.x += this.svx * dt;
    this.y += this.svy * dt;
    G.World.collide(this);
    this.walking = ax !== 0 || ay !== 0;
    }
    if (this.walking && this.dodgeT <= 0) this.moveAngle = Math.atan2(ay, ax);

    // --- terreno líquido ---
    this.inLiquid = G.World.isLiquid(this.x, this.y);
    if (this.inLiquid) {
      const le = G.World.liquidEffect(this.mon.types);
      if (le.dmg) {
        this.lavaTick -= dt;
        if (this.lavaTick <= 0) {
          this.lavaTick = le.every; this.invuln = 0;
          this.hurt(Math.max(le.flat, this.maxHp * le.dmg * 0.5));
          G.FX.burst(this.x, this.y - 4, le.color, 5, 70);
        }
      } else if (this.walking && Math.random() < dt * 8) {
        G.FX.burst(this.x, this.y, le.slide ? '#ffffff' : '#b3defa', 2, 40);
      }
    }

    // --- apuntado: enemigo más cercano; si no hay, hacia donde caminas ---
    // Prioridad de blanco según el ataque activo:
    //   a distancia (proyectil, rayo): el jefe si está a tiro > lo que te toca > el más cercano
    //   cuerpo a cuerpo y el resto:   lo que te toca > el jefe > el más cercano
    // Con una horda encima casi siempre te toca algo; si eso ganara siempre,
    // los ataques a distancia no le darían nunca al jefe.
    // Sin enemigos, apunta a la roca o cofre más cercano.
    const all = G.EnemyMgr.all();
    const m = this.activeMove();
    const ranged = !!m && (m.kind === 'projectile' || m.kind === 'beam');
    const threat = G.Projectiles.nearest(all, this.x, this.y, this.r + 24);
    const boss = all.find(e => e.boss && !e.dead && G.U.dist(this.x, this.y, e.x, e.y) < 330);
    const tg = (ranged ? boss || threat : threat || boss)
            || G.Projectiles.nearest(all, this.x, this.y, 520)
            || G.World.nearestBreakable(this.x, this.y, 200);
    // Apuntar a mano (Ajustes > Accesibilidad): hacia el ratón o el stick derecho.
    // El blanco (para la cadena) es el enemigo que hay en esa dirección; si no
    // hay ninguno, el de siempre.
    const hand = this.handAim();
    this.manualAim = hand != null;
    if (hand != null) {
      this.aim = hand;
      this.target = this.enemyAlong(all, hand) || tg;
    } else {
      this.target = tg;
      if (tg) this.aim = Math.atan2(tg.y - this.y, tg.x - this.x);
      else if (this.walking) this.aim = this.moveAngle;
    }

    // --- animación: mira al objetivo al atacar, si no a donde camina ---
    const face = this.attackFace > 0 || !this.walking ? this.aim : this.moveAngle;
    this.anim.dir = G.Sprites.dirFromAngle(face);
    this.anim.loop(this.walking ? 'Walk' : 'Idle', this.walking ? s / 110 : 1);
  }

  /**
   * Ángulo de "Apuntar a mano", o null si toca apuntar solo. Manda lo último
   * que se haya usado: el stick derecho mientras se empuja; si no, el ratón si
   * se ha movido después (en PC). Soltar el stick sin tocar el ratón = solo.
   */
  handAim() {
    if (this.remote || !G.Settings.get('aimManual')) return null;
    const st = G.Pad.aim();
    if (st) return Math.atan2(st[1], st[0]);
    if (G.Touch.active || !G.Input.mouseMovedAt || G.Input.mouseMovedAt < G.Pad.aimAt) return null;
    const w = G.Input.mouseWorld();
    const dx = w.x - this.x, dy = w.y - (this.y - G.LIFT * 0.5);
    return Math.hypot(dx, dy) < 4 ? null : Math.atan2(dy, dx);
  }

  /** El enemigo más cercano dentro de ±25° de la dirección a (a menos de 520). */
  enemyAlong(all, a) {
    let best = null, bd = 520 * 520;
    const ca = Math.cos(a), sa = Math.sin(a), cosMax = Math.cos(0.44);
    for (const e of all) {
      if (e.dead) continue;
      const dx = e.x - this.x, dy = e.y - this.y, d2 = dx * dx + dy * dy;
      if (d2 >= bd || d2 < 1) continue;
      if ((dx * ca + dy * sa) / Math.sqrt(d2) < cosMax) continue;
      bd = d2; best = e;
    }
    return best;
  }

  /** Vuelve a levantarse (lo revive un compañero en cooperativo). */
  revive(frac = 0.5) {
    this.dead = false;
    this.hp = Math.max(1, this.maxHp * frac);
    this.invuln = 2;
    this.reviveT = 0;
    this.anim._start('Idle', false);
    G.FX.ring(this.x, this.y, 6, 70, '#5fe08a', 0.5, 4);
    G.FX.burst(this.x, this.y - this.bodyH * 0.5, '#9dffb8', 18, 150);
    G.Audio.sfx('heal');
  }

  // ---------------- compañero (cooperativo) ----------------

  /**
   * Un compañero en otro ordenador: su dueño manda su estado (posición, vida,
   * movimiento activo...) y aquí se sigue con suavidad.
   * n = { x, y, ang, walk, hp, maxHp, dead, mv, ml, mag, aim, rev }
   */
  netUpdate(dt) {
    this.anim.update(dt);
    if (this.megaFx) this.tickMegaFx(dt);            // la transformación mega también avanza en los compañeros
    const n = this.net;
    if (!n) return;
    if (this.flash > 0) this.flash -= dt;
    if (this.attackFace > 0) this.attackFace -= dt;
    if (G.U.dist2(this.x, this.y, n.x, n.y) > 300 * 300) { this.x = n.x; this.y = n.y; }
    else { this.x = G.U.damp(this.x, n.x, 14, dt); this.y = G.U.damp(this.y, n.y, 14, dt); }
    if (n.hp < this.hp - 0.5 && !n.dead) this.flash = 0.14;
    this.hp = n.hp; this.maxHp = n.maxHp;
    if (n.mf !== undefined) this.setRemoteMega(n.mf === 2 ? 'megay' : n.mf === 1 ? 'mega' : null);
    this.magnet = n.mag || this.magnet;
    this.reviveT = n.rev || 0;
    if (n.dead && !this.dead) { this.dead = true; this.anim.play('Faint', { hold: true }); G.Projectiles.clearOrbs(this); }
    else if (!n.dead && this.dead) this.revive(n.hp / (n.maxHp || 1));
    // Movimiento activo (para el halo, el HUD y los orbes).
    if (n.mv && (!this.moves[0] || this.moves[0].id !== n.mv || this.moves[0].lvl !== n.ml) && G.Moves.BY_ID[n.mv]) {
      this.moves = [G.Moves.instance(n.mv, n.ml || 1)];
      this.slots = [this.moves.slice()];
      this.active = 0;
      G.Projectiles.clearOrbs(this);
    }
    if (this.dead) return;
    this.walking = !!n.walk;
    this.moveAngle = n.ang;
    this.aim = n.aim;
    const face = this.attackFace > 0 || !this.walking ? this.aim : this.moveAngle;
    this.anim.dir = G.Sprites.dirFromAngle(face);
    this.anim.loop(this.walking ? 'Walk' : 'Idle', this.walking ? this.baseSpd / 110 : 1);
  }

  draw(ctx) {
    // Halo del tipo del movimiento activo, en el suelo.
    const m = this.activeMove();
    if (m && !this.dead) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = G.U.TYPE_COLOR[m.type];
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(this.x, this.y, this.r * 1.5, this.r * 0.6, 0, 0, 6.2832); ctx.stroke();
      ctx.restore();
    }
    G.Sprites.drawShadow(ctx, this.dex, this.x, this.y, this.scale);
    // Megaevolución: aro arcoíris latiendo bajo los pies (sólo activa).
    if (this.megaOn && !this.dead) {
      const cols = ['#ffd23f', '#ff8ad8', '#7fe0ff', '#5fe08a'];
      ctx.save();
      ctx.globalAlpha = 0.55 + Math.sin(performance.now() / 110) * 0.2;
      ctx.strokeStyle = cols[Math.floor(performance.now() / 220) % cols.length];
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(this.x, this.y, this.r * 2.3, this.r * 0.95, 0, 0, 6.2832); ctx.stroke();
      ctx.restore();
    }
    // Poder de altar: aro de su color latiendo bajo los pies.
    if (this.power && !this.dead) {
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(performance.now() / 120) * 0.15;
      ctx.strokeStyle = this.power.def.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(this.x, this.y, this.r * 2.1, this.r * 0.85, 0, 0, 6.2832); ctx.stroke();
      ctx.restore();
    }

    const alpha = this.invuln > 0 && !this.dead ? (Math.floor(this.invuln * 18) % 2 ? 0.45 : 1) : 1;
    if (this.megaFx) this.drawMegaFx(ctx, alpha);
    else this.anim.draw(ctx, this.x, this.y, { flash: this.flash > 0, softFlash: true, alpha, color: '#ffcb3d' });
    if (this.megaOn && !this.dead) this.drawMegaStone(ctx);

    // Arcos de buff alrededor de los pies.
    const COL = { atk: '#ff6b4d', patk: '#ff6b4d', satk: '#c47bff', spd: '#7fe0ff', def: '#b0b8c8', regen: '#5fe08a' };
    let i = 0;
    for (const k in this.buffs) {
      const b = this.buffs[k];
      if (b.n <= 0) continue;
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = COL[k];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, this.r * 1.8 + i * 5, (this.r * 1.8 + i * 5) * 0.42, 0, 0, 6.2832 * (b.n / 5));
      ctx.stroke();
      ctx.restore();
      i++;
    }

    // Cooperativo: anillo de "reviviendo" y nombre encima.
    if (this.dead && this.reviveT > 0) {
      ctx.save();
      ctx.strokeStyle = '#5fe08a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, this.r * 2.4, this.r * 1.0, 0, -Math.PI / 2, -Math.PI / 2 + 6.2832 * Math.min(1, this.reviveT / G.Player.REVIVE_TIME));
      ctx.stroke();
      ctx.restore();
    }
    if (this.tag) {
      ctx.save();
      ctx.font = '700 7px Pixelify,"Segoe UI",sans-serif';
      ctx.textAlign = 'center';
      const y = this.y - this.bodyH - 8;
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,.75)';
      G.I18n.rawCanvas(ctx, 'strokeText', this.tag, this.x, y);
      ctx.fillStyle = this.dead ? '#ff8a96' : this.tagColor || '#fff';
      G.I18n.rawCanvas(ctx, 'fillText', this.tag, this.x, y);
      if (this.dead) {
        ctx.font = '700 6px Pixelify,"Segoe UI",sans-serif';
        ctx.strokeText(this.revLabel || '', this.x, y - 8);
        ctx.fillText(this.revLabel || '', this.x, y - 8);
      }
      ctx.restore();
    }
  }
};
