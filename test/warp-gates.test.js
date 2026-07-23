import test from "node:test";
import assert from "node:assert/strict";
import { hexDist, key } from "../battle/hexmath.js";
import { buildWarpGates, warpGateAt, warpGateDestination, MIN_WARP_GATE_SEPARATION, MIN_WARP_LINK_DISTANCE, WARP_GATE_DISTANCE, WARP_GATE_RADIUS } from "../map/warpGates.js";

test("warp gates pair nearby planetary cells six hexes from each planet", () => {
  const network = buildWarpGates([
    { id: "earth", position: [0, 0] },
    { id: "mars", position: [20, 0] },
    { id: "venus", position: [0, 20] },
  ]);
  const bodies = new Map([
    ["earth", [0, 0]], ["mars", [20, 0]], ["venus", [0, 20]],
  ]);
  assert.ok(network.pairs.length >= 2);
  for (const pair of network.pairs) {
    const [first, second] = pair.positions;
    const firstGate = network.gates.get(key(...first));
    const secondGate = network.gates.get(key(...second));
    assert.equal(hexDist(bodies.get(pair.bodies[0]), first), WARP_GATE_DISTANCE);
    assert.equal(hexDist(bodies.get(pair.bodies[1]), second), WARP_GATE_DISTANCE);
    assert.deepEqual(firstGate.destination, second);
    assert.deepEqual(secondGate.destination, first);
  }
  assert.equal(WARP_GATE_DISTANCE, 6);
  assert.equal(WARP_GATE_RADIUS, 1);
  const gatePositions = [...network.gates.values()].map(gate => gate.position);
  for (let index = 0; index < gatePositions.length; index++) {
    for (let other = index + 1; other < gatePositions.length; other++) {
      assert.ok(hexDist(gatePositions[index], gatePositions[other]) > MIN_WARP_GATE_SEPARATION);
    }
  }
  const gate = network.gates.values().next().value;
  assert.equal(warpGateAt(gate.position, network.gates).id, gate.id);
  const offsetPosition = [gate.position[0] + 1, gate.position[1]];
  assert.notDeepEqual(warpGateDestination(offsetPosition, gate), gate.destination);
});

test("warp pairs under six hexes apart are omitted", () => {
  const network = buildWarpGates([
    { id: "a", position: [0, 0] },
    { id: "b", position: [10, 0] },
  ]);
  assert.equal(network.pairs.length, 0);
  assert.equal(MIN_WARP_LINK_DISTANCE, 6);
});
