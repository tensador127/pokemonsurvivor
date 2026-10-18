/* ============ settings.js — ajustes de este dispositivo ============
 * Se guardan en el navegador (no en la cuenta): cada PC o móvil tiene los
 * suyos. El volumen lo guarda audio.js aparte.
 *
 *   quality     'auto' | 'high' | 'mid' | 'low'   efectos y partículas
 *   dmgNumbers  true/false                        números de daño
 *   calm        true/false                        menos sacudidas y destellos
 *   fps         true/false                        contador de FPS
 *   stick       0.8 | 1 | 1.25                    tamaño del joystick táctil
 *
 *   perf        true/false                        modo rendimiento (menos resolución y efectos)
 *   fpsCap      'auto' | 30 | 45 | 60 | 0         tope de FPS (auto: 60 en móvil; muchos móviles van a 120 Hz y gastan el doble)
 *   res         'auto' | 1 | 0.75 | 0.6           resolución del dibujo (auto: baja sola si va a tirones)
 *   G.Settings.get('quality')  ·  G.Settings.set('fps', true)  ·  G.Settings.on(fn)
 *   G.Settings.fx   nivel efectivo 0 (bajo) .. 2 (alto), ya resuelto el 'auto'
 */
G.Settings = (() => {
  const KEY = 'ps.settings';
  const DEF = { quality: 'auto', perf: false, fpsCap: 'auto', res: 'auto', minimap: true, dmgNumbers: true, calm: false, fps: false, stick: 1 };
  let s = Object.assign({}, DEF);
  try { Object.assign(s, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* nada */ }
  const fns = new Set();

  // Calidad automática: empieza alta (media en móvil) y baja si va a tirones.
  const touchy = matchMedia('(pointer: coarse)').matches;
  let autoLevel = touchy ? 1 : 2;
  let autoRes = 1;                    // escala de resolución automática (0.6 .. 1)
  let acc = 0, frames = 0, slowT = 0, fastT = 0;

  function save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* nada */ } }
  function get(k) { return s[k]; }
  function set(k, v) { s[k] = v; save(); fns.forEach(fn => { try { fn(k, v); } catch (e) { /* nada */ } }); }

  /** Lo llama el bucle del juego en cada fotograma (sólo durante la partida). */
  function sample(dt) {
    if (dt <= 0 || (s.quality !== 'auto' && s.res !== 'auto')) return;
    acc += dt; frames++;
    if (acc < 1) return;
    const fps = frames / acc;
    acc = 0; frames = 0;
    // Referencia: el tope de FPS (60 por defecto). 3 s seguidos por debajo del 75 %: se baja un
    // escalón (primero efectos, luego resolución); 8 s por encima del 95 %: se sube.
    const target = cap() || 60;
    if (fps < target * 0.75) { slowT++; fastT = 0; } else if (fps > target * 0.95) { fastT++; slowT = 0; } else { slowT = fastT = 0; }
    if (slowT >= 3) {
      slowT = 0;
      if (s.quality === 'auto' && autoLevel > 0) autoLevel--;
      else if (s.res === 'auto' && autoRes > 0.6) { autoRes = Math.max(0.6, +(autoRes - 0.13).toFixed(2)); fns.forEach(fn => { try { fn('res', autoRes); } catch (e) { /* nada */ } }); }
    }
    if (fastT >= 8) {
      fastT = 0;
      if (s.res === 'auto' && autoRes < 1) { autoRes = Math.min(1, +(autoRes + 0.1).toFixed(2)); fns.forEach(fn => { try { fn('res', autoRes); } catch (e) { /* nada */ } }); }
      else if (s.quality === 'auto' && autoLevel < (touchy ? 1 : 2)) autoLevel++;
    }
  }
  /** Tope de FPS efectivo (0 = sin tope). */
  function cap() { return s.fpsCap === 'auto' ? (touchy ? 60 : 0) : (+s.fpsCap || 0); }

  return {
    get, set, sample, DEF,
    on(fn) { fns.add(fn); },
    get all() { return Object.assign({}, s); },
    get fpsCap() { return cap(); },
    /** Escala de la resolución del dibujo (1 = la normal del juego). */
    get resScale() { return Math.max(0.5, (s.res === 'auto' ? autoRes : +s.res || 1) * (s.perf ? 0.8 : 1)); },
    get perf() { return !!s.perf; },
    get fx() { if (s.perf) return 0; return s.quality === 'auto' ? autoLevel : s.quality === 'high' ? 2 : s.quality === 'mid' ? 1 : 0; },
    get autoLevel() { return autoLevel; },
    get touch() { return touchy; }
  };
})();
