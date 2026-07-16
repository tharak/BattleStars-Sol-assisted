import { hexDist } from "../battle/hexmath.js";
import {
  CONQUEST_TURNS_PER_RESOURCE,
  GRAVITY_INFLUENCE_RADIUS_FACTOR,
  MIN_BODY_RESOURCE_VALUE,
  SPAWN_CLEARANCE_HEXES,
} from "./strategicBalance.js";

export function bodyResourceValue({ radiusPx, hexSizePx }) {
  const gravityRadiusPx = Math.max(0, radiusPx) * GRAVITY_INFLUENCE_RADIUS_FACTOR;
  return Math.max(MIN_BODY_RESOURCE_VALUE, Math.ceil(gravityRadiusPx / hexSizePx));
}

export function conquestDurationTurns(resourceValue) {
  return Math.max(MIN_BODY_RESOURCE_VALUE, resourceValue) * CONQUEST_TURNS_PER_RESOURCE;
}

export function canConquerPlanet({ fleetPosition, planetPosition, fleetStrength, resourceValue }) {
  return Array.isArray(fleetPosition)
    && Array.isArray(planetPosition)
    && hexDist(fleetPosition, planetPosition) === 1
    && fleetStrength >= resourceValue;
}

export function conquestCompletionRound(startRound, resourceValue) {
  return startRound + conquestDurationTurns(resourceValue);
}

export function spawnPointTowardSun({ planetX, planetY, gravityRadiusPx, hexSizePx }) {
  const distance = Math.hypot(planetX, planetY);
  const inwardX = distance ? -planetX / distance : 1;
  const inwardY = distance ? -planetY / distance : 0;
  const offset = gravityRadiusPx + SPAWN_CLEARANCE_HEXES * hexSizePx;
  return [planetX + inwardX * offset, planetY + inwardY * offset];
}
