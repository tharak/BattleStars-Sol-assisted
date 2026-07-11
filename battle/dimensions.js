// Stroke widths and effect timings used by render.js/systems.js. Kept
// separate from colors.js so line thicknesses and durations can be retuned
// without hunting for magic numbers inline in the drawing code.

export const LINE_WIDTH = {
  grid: 1,
  stateBorder: 1.5,          // per-squadron state ring (steady/shaken/routed/activated)
  selectionOutline: 2,
  targetOutline: 2.5,
  setupShipBorder: 1.5,      // manual-deployment placed-ship border (non-flagship)
  setupFlagshipBorder: 2.5,
  setupSelectionOutline: 2,
  laserMiss: 1.6,
  laserHit: 3,
  laserHitHalo: 7,
};

export const LASER_DURATION = { hit: 420, miss: 320 }; // ms, how long a beam takes to fade
export const LASER_HALO_ALPHA = 0.5; // multiplier on the fading alpha for the hit "glow" stroke
