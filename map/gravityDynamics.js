import { key, neighbor } from "../battle/hexmath.js";

// A tactical current is deliberately a readable game abstraction, rather
// than a claim that surface spin alone produces orbital mechanics.  The two
// retrograde planets are still useful exceptions players can learn.
export function gravitySpinDirection(bodyId) {
  return bodyId === "venus" || bodyId === "uranus" ? -1 : 1;
}

export function gravityDriftDirection(position, gravityCells, positionToWorld) {
  const cell = gravityCells.get(key(position[0], position[1]));
  if (!cell?.well) return null;
  const [x, y] = positionToWorld(position);
  const dx = cell.well.x - x, dy = cell.well.z - y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-6) return null;
  const inwardX = dx / distance, inwardY = dy / distance;
  const spin = cell.well.spinDirection ?? 1;
  // A 2:1 inward/tangential blend makes a visible spiral.  It is strong
  // enough to plan around without turning every approach into an orbit.
  const flowX = inwardX * 2 - inwardY * spin;
  const flowY = inwardY * 2 + inwardX * spin;
  let bestDirection = 0, bestDot = -Infinity;
  for (let direction = 0; direction < 6; direction++) {
    const next = neighbor(position, direction);
    const [nextX, nextY] = positionToWorld(next);
    const stepX = nextX - x, stepY = nextY - y;
    const stepLength = Math.hypot(stepX, stepY) || 1;
    const dot = (stepX * flowX + stepY * flowY) / stepLength;
    if (dot > bestDot) { bestDot = dot; bestDirection = direction; }
  }
  return bestDirection;
}

// Forced drift is intentionally not given an occupancy or morale predicate:
// gravity wins this iteration.  Ship collision resolution comes later.
export function resolveGravityDrift(position, gravityCells, positionToWorld) {
  const direction = gravityDriftDirection(position, gravityCells, positionToWorld);
  if (direction == null) return null;
  const cell = gravityCells.get(key(position[0], position[1]));
  return {
    from: [...position],
    to: neighbor(position, direction),
    direction,
    wellId: cell.well.id,
  };
}
