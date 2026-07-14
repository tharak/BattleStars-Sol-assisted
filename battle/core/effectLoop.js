// The "requestAnimationFrame while any timed effect hasn't expired" driver
// -- battle/render.js's own laser-fade loop and the star map's own shot-
// tracer fade loop are the same algorithm (an effect list, each entry
// carrying a start timestamp + duration, needing a repaint every frame
// until the last one expires) implemented independently, previously
// coding the same expiry boundary two different ways. One shared
// implementation now backs both; each caller supplies its own effect-list
// access and repaint function since each owns a differently-shaped effect
// list (battle's lives in browser presentation state, the map's is a module
// array) -- this module only owns the RAF bookkeeping.
//
// makeEffectLoop() returns a fresh ensureEffectLoop(...) with its own
// closed-over "is a loop already running" flag, so unrelated call sites
// (battle vs map) never share that flag -- call it once per call site,
// not once per effect.
export function makeEffectLoop() {
  let running = false;
  return function ensureEffectLoop({ pruneExpired, hasEffects, repaint }) {
    if (running || !hasEffects()) return;
    running = true;
    const tick = () => {
      pruneExpired(performance.now());
      repaint();
      if (hasEffects()) requestAnimationFrame(tick);
      else running = false;
    };
    requestAnimationFrame(tick);
  };
}
