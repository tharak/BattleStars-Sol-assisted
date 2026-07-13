// The fleet movement-range hex overlay: a small hex grid fixed on a
// selected fleet's current position (map/main.js), replacing the old
// "click anywhere to teleport" movement. Each hex is a direction plus a
// number of turns committed to it (the center ring is 1 turn away, the
// next is 2, ...); the real *distance* one turn covers comes from
// FLEET_RANGE_KM_PER_TURN (map/config.js), computed independently of
// where the fleet's rendered position happens to sit on this map's
// log-compressed distance scale.
//
// That's deliberate, not an oversight: at interplanetary range, one
// turn's real ISS-speed travel is many orders of magnitude smaller than
// a single pixel of this map almost everywhere on it (see config.js's
// comment on FLEET_RANGE_KM_PER_TURN) -- rendering the hexes to that
// same scale would make the overlay invisible everywhere except right up
// against the Sun. So the hex grid is a fixed-pixel-size direction/
// duration picker laid on top of the map, not a to-scale piece of it;
// only the *destination it computes* (xKm/yKm below) is real.

import { FLEET_RANGE_KM_PER_TURN, TURN_HOURS } from "./config.js";

export const HEX_SIZE_PX = 16;
// How many rings (= how many turns' worth of travel) the overlay offers
// at once. A player who wants to go farther in one order than this can
// still get there -- just by moving again once this order resolves.
export const MOVE_RANGE_RINGS = 3;

function axialToPixel(q, r, size = HEX_SIZE_PX) {
  return [size * Math.sqrt(3) * (q + r / 2), size * 1.5 * r];
}
function axialDist(q, r) {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

// Every axial [q,r] within `radius` hex-steps of the center, center
// included.
export function hexDisk(radius) {
  const out = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      out.push([q, r]);
    }
  }
  return out;
}

// The 6 corner points of a pointy-top hex centered at (cx,cy).
export function hexCorners(cx, cy, size = HEX_SIZE_PX) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = (60 * k - 90) * Math.PI / 180;
    pts.push([cx + size * Math.cos(a), cy + size * Math.sin(a)]);
  }
  return pts;
}

// Every clickable hex around a fleet at real position (fleetXKm,
// fleetYKm): its fixed-pixel render offset from the fleet (dx,dy), how
// many turns/hours committing to it costs, and the real destination that
// many turns of straight-line travel in that direction reaches.
export function movementRangeHexes(fleetXKm, fleetYKm) {
  return hexDisk(MOVE_RANGE_RINGS)
    .filter(([q, r]) => q !== 0 || r !== 0)
    .map(([q, r]) => {
      const [dx, dy] = axialToPixel(q, r);
      const turns = axialDist(q, r);
      const mag = Math.hypot(dx, dy);
      const rangeKm = turns * FLEET_RANGE_KM_PER_TURN;
      return {
        q, r, dx, dy, turns, hours: turns * TURN_HOURS,
        xKm: fleetXKm + (dx / mag) * rangeKm,
        yKm: fleetYKm + (dy / mag) * rangeKm,
      };
    });
}
