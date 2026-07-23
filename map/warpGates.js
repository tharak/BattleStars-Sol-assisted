import { fromAxial, hexDist, key, toAxial } from "../battle/hexmath.js";

export const WARP_GATE_DISTANCE = 6;
export const WARP_GATE_RADIUS = 1;
export const MIN_WARP_LINK_DISTANCE = 6;

export function warpGateAt(position, gates) {
  return [...(gates?.values() || [])].find(gate => hexDist(position, gate.position) <= WARP_GATE_RADIUS) || null;
}

export function warpGateDestination(position, gate) {
  if (!gate) return null;
  const [positionQ, positionR] = toAxial(position[0], position[1]);
  const [sourceQ, sourceR] = toAxial(gate.position[0], gate.position[1]);
  const [destinationQ, destinationR] = toAxial(gate.destination[0], gate.destination[1]);
  return fromAxial(destinationQ + positionQ - sourceQ, destinationR + positionR - sourceR);
}

function cartesian(position) {
  return [position[0] + 0.5 * (position[1] & 1), position[1] * (Math.sqrt(3) / 2)];
}

function ring(center, distance) {
  const [centerQ, centerR] = toAxial(center[0], center[1]);
  const cells = [];
  for (let q = -distance; q <= distance; q++) {
    for (let r = Math.max(-distance, -q - distance); r <= Math.min(distance, -q + distance); r++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) === distance) {
        cells.push(fromAxial(centerQ + q, centerR + r));
      }
    }
  }
  return cells;
}

function gatePositions(a, b) {
  const aCart = cartesian(a), bCart = cartesian(b);
  const dx = bCart[0] - aCart[0], dy = bCart[1] - aCart[1];
  const length = Math.hypot(dx, dy) || 1;
  const unit = [dx / length, dy / length];
  const targetA = [aCart[0] + unit[0] * WARP_GATE_DISTANCE, aCart[1] + unit[1] * WARP_GATE_DISTANCE];
  const targetB = [bCart[0] - unit[0] * WARP_GATE_DISTANCE, bCart[1] - unit[1] * WARP_GATE_DISTANCE];
  let best = null;
  for (const aPosition of ring(a, WARP_GATE_DISTANCE)) {
    const aPoint = cartesian(aPosition);
    for (const bPosition of ring(b, WARP_GATE_DISTANCE)) {
      const bPoint = cartesian(bPosition);
      const aError = Math.hypot(aPoint[0] - targetA[0], aPoint[1] - targetA[1]);
      const bError = Math.hypot(bPoint[0] - targetB[0], bPoint[1] - targetB[1]);
      const lineError = Math.abs((aPoint[0] - aCart[0]) * dy - (aPoint[1] - aCart[1]) * dx)
        + Math.abs((bPoint[0] - aCart[0]) * dy - (bPoint[1] - aCart[1]) * dx);
      const score = aError + bError + lineError;
      if (!best || score < best.score) best = { aPosition, bPosition, score };
    }
  }
  return [best.aPosition, best.bPosition];
}

function overlapsExistingGate(position, gates) {
  return [...gates.values()].some(gate => hexDist(position, gate.position) <= WARP_GATE_RADIUS * 2);
}

export function buildWarpGates(bodies = []) {
  const pairs = [];
  const gates = new Map();
  const neighbors = new Set();
  const preferredPairs = [["venus", "jupiter"], ["mercury", "mars"]];
  for (const pair of preferredPairs) {
    const indices = pair.map(id => bodies.findIndex(body => body.id === id));
    if (indices.every(index => index >= 0)) neighbors.add([Math.min(...indices), Math.max(...indices)].join(":"));
  }
  for (let index = 0; index < bodies.length; index++) {
    const distances = bodies
      .map((body, other) => ({ body, other, distance: Math.hypot(body.position[0] - bodies[index].position[0], body.position[1] - bodies[index].position[1]) }))
      .filter(entry => entry.other !== index)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);
    for (const entry of distances) neighbors.add([Math.min(index, entry.other), Math.max(index, entry.other)].join(":"));
  }
  const replacedPairs = new Set([["mars", "venus"].sort().join(":"), ["jupiter", "mercury"].sort().join(":")]);
  for (const pairKey of neighbors) {
    const [aIndex, bIndex] = pairKey.split(":").map(Number);
    const a = bodies[aIndex], b = bodies[bIndex];
    if (replacedPairs.has([a.id, b.id].sort().join(":"))) continue;
    const [aPosition, bPosition] = gatePositions(a.position, b.position);
    if (hexDist(aPosition, bPosition) < MIN_WARP_LINK_DISTANCE) continue;
    if (overlapsExistingGate(aPosition, gates) || overlapsExistingGate(bPosition, gates)) continue;
    const id = `${a.id}-${b.id}`;
    pairs.push({ id, bodies: [a.id, b.id], positions: [aPosition, bPosition] });
    gates.set(key(...aPosition), { id, position: aPosition, destination: bPosition, bodyId: a.id });
    gates.set(key(...bPosition), { id, position: bPosition, destination: aPosition, bodyId: b.id });
  }
  return { pairs, gates };
}
