/* ============ input.js — teclado y ratón (el táctil está en touch.js) ============ */
G.Input = (() => {
  const down = new Set();
  const pressed = new Set();   // se limpia cada frame
  let mx = 0, my = 0, mdown = false;

  const MOVE_KEYS = {
    up: ['keyw', 'arrowup'], down: ['keys', 'arrowdown'],
    left: ['keya', 'arrowleft'], right: ['keyd', 'arrowright']
  };

  function code(e) { return (e.code || e.key).toLowerCase(); }

  addEventListener('keydown', e => {
    const c = code(e);
    if (!down.has(c)) pressed.add(c);
    down.add(c);
    // Evita que el navegador haga scroll con flechas/espacio durante el juego.
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'space', 'tab'].includes(c)) e.preventDefault();
  });
  addEventListener('keyup', e => down.delete(code(e)));
  addEventListener('blur', () => { down.clear(); });
  addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
  // Táctil: no hay "pasar el ratón". Un toque corto cuenta como si el ratón se quedara
  // ahí 3,5 s, así los tooltips (hover) también salen al tocar.
  let tapAt = null, dn = null;
  addEventListener('pointerdown', e => { if (e.pointerType === 'touch') dn = { x: e.clientX, y: e.clientY, t: performance.now() }; }, true);
  addEventListener('pointerup', e => {
    if (e.pointerType === 'touch' && dn && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) < 14 && performance.now() - dn.t < 600) {
      tapAt = { x: e.clientX, y: e.clientY, until: performance.now() + 3500 };
    }
    dn = null;
  }, true);
  const tapping = () => !!tapAt && performance.now() < tapAt.until;
  addEventListener('mousedown', () => mdown = true);
  addEventListener('mouseup', () => mdown = false);

  return {
    /** Vector de movimiento del jugador (teclado o joystick táctil). */
    axis() {
      const t = G.Touch && G.Touch.vector();
      if (t && (t[0] || t[1])) return t;
      let x = 0, y = 0;
      if (MOVE_KEYS.left.some(k => down.has(k))) x -= 1;
      if (MOVE_KEYS.right.some(k => down.has(k))) x += 1;
      if (MOVE_KEYS.up.some(k => down.has(k))) y -= 1;
      if (MOVE_KEYS.down.some(k => down.has(k))) y += 1;
      return G.U.norm(x, y);
    },
    held(c) { return down.has(c); },
    /** true sólo en el frame en que se pulsó. */
    tap(c) { return pressed.has(c); },
    mouse() { return tapping() ? { x: tapAt.x, y: tapAt.y, down: false } : { x: mx, y: my, down: mdown }; },
    /** ¿Hay un toque reciente que haga de "ratón encima"? */
    tapHover() { return tapping(); },
    endFrame() { pressed.clear(); }
  };
})();
