import { MAX_MOVEMENT_POINTS, MoraleState } from "./constants.js";
import { hexDist } from "../hexmath.js";

export const MOVE_BASE_COST = 1;

export function canMoveDuringActivation(activation) {
  return !!(activation && activation.u != null && activation.mp > 0);
}

export function canMoveBackwardDuringActivation(activation) {
  return canMoveDuringActivation(activation) && activation.mp >= MAX_MOVEMENT_POINTS;
}

export function forwardMovementCost({
  baseCost = MOVE_BASE_COST,
  movementAllowance = MAX_MOVEMENT_POINTS,
  hasAsteroid = false,
  gravityCost = baseCost,
} = {}) {
  const asteroidExtra = hasAsteroid ? movementAllowance - baseCost : 0;
  const gravityExtra = Math.max(0, gravityCost - baseCost);
  return baseCost + Math.max(asteroidExtra, gravityExtra);
}

export function backwardMovementCost({ movementAllowance = MAX_MOVEMENT_POINTS } = {}) {
  return movementAllowance;
}

export function evaluateMovementStep({
  moraleState,
  currentPosition,
  nextPosition,
  nearestEnemyPosition = null,
  blocked = false,
}) {
  if (blocked) return { ok: false, reason: "blocked" };
  if (moraleState === MoraleState.SHAKEN && nearestEnemyPosition
      && hexDist(nextPosition, nearestEnemyPosition) < hexDist(currentPosition, nearestEnemyPosition)) {
    return { ok: false, reason: "shaken" };
  }
  return { ok: true };
}
