// Shared game-timing config for the strategic map: how long a turn is,
// and the reference speed a fleet moves through space at, derived from a
// real number (the ISS's actual low-Earth-orbit speed) rather than an
// arbitrary made-up one. See map/movegrid.js for how this turns into the
// fleet movement-range hex overlay.

import { BODY_RADIUS_KM } from "./orbits.js";

// A turn is a fixed real-world duration -- for now, 1 hour. Everything
// that needs "how much real time does N turns represent" (currently just
// the movement-range hex overlay) reads this one value.
export const TURN_HOURS = 1;

// The ISS orbits at roughly this altitude and takes about 90 minutes to
// circle the Earth -- used as this game's baseline "how fast can
// something move through space" figure instead of an arbitrary constant.
// Real ISS numbers (~408km altitude, ~92.7min period) are close enough
// that rounding to 400km/90min here doesn't meaningfully change the
// result.
export const ISS_ALTITUDE_KM = 400;
export const ISS_PERIOD_MIN = 90;

const ISS_ORBIT_RADIUS_KM = BODY_RADIUS_KM.earth + ISS_ALTITUDE_KM;
export const FLEET_SPEED_KM_S = (2 * Math.PI * ISS_ORBIT_RADIUS_KM) / (ISS_PERIOD_MIN * 60);

// How far a fleet can travel in one turn, in a straight line, at that
// reference speed. At interplanetary scale this is tiny -- a fraction of
// the distance between neighboring planets -- which is realistic: real
// low-Earth-orbit speed genuinely would take a very long time to cross
// interplanetary distances. See movegrid.js for how the movement-range
// overlay stays usable despite that.
export const FLEET_RANGE_KM_PER_TURN = FLEET_SPEED_KM_S * TURN_HOURS * 3600;
