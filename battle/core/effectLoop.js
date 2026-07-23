// Shared requestAnimationFrame driver for timed strategic visual effects.
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
