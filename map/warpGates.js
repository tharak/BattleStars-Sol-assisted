import { directionToward, fromAxial, hexDist, key, neighbor, toAxial } from "../battle/hexmath.js";

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

function offset(position, direction, distance) {
  let result = [...position];
  for (let step = 0; step < distance; step++) result = neighbor(result, direction);
  return result;
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
    const aDirection = directionToward(a.position, b.position);
    const bDirection = directionToward(b.position, a.position);
    const aPosition = offset(a.position, aDirection, WARP_GATE_DISTANCE);
    const bPosition = offset(b.position, bDirection, WARP_GATE_DISTANCE);
    if (hexDist(aPosition, bPosition) < MIN_WARP_LINK_DISTANCE) continue;
    if (gates.has(key(...aPosition)) || gates.has(key(...bPosition))) continue;
    const id = `${a.id}-${b.id}`;
    pairs.push({ id, bodies: [a.id, b.id], positions: [aPosition, bPosition] });
    gates.set(key(...aPosition), { id, position: aPosition, destination: bPosition, bodyId: a.id });
    gates.set(key(...bPosition), { id, position: bPosition, destination: aPosition, bodyId: b.id });
  }
  return { pairs, gates };
}
