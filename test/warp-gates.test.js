import test from "node:test";
import assert from "node:assert/strict";
import { hexDist, key } from "../battle/hexmath.js";
import { buildWarpGates, WARP_GATE_DISTANCE } from "../map/warpGates.js";

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
});
