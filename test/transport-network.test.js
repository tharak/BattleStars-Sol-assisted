import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTransportNetwork, transportJumpDestination, transportJumpHexes,
} from "../map/transportNetwork.js";

test("transport jump distance scales with gravity radius and stays bounded", () => {
  assert.equal(transportJumpHexes(1), 2);
  assert.equal(transportJumpHexes(8), 4);
  assert.equal(transportJumpHexes(28), 8);
});

test("transport network builds deterministic parent-child lanes and ambush nodes", () => {
  const network = buildTransportNetwork([
    { id: "sun", position: [0, 0], rotation: 1, gravityRadius: 4 },
    { id: "earth", parentId: "sun", position: [12, 0], rotation: 1, gravityRadius: 3 },
    { id: "moon", parentId: "earth", position: [16, 1], rotation: 1, gravityRadius: 2 },
  ]);
  assert.deepEqual(network.lanes.map(lane => lane.id), ["earth-moon", "sun-earth"]);
  assert.equal(network.lanes.length, 2);
  assert.ok(network.lanes.every(lane => lane.endpoints.every(([c, r]) => !((c === 0 && r === 0) || (c === 12 && r === 0) || (c === 16 && r === 1)))));
  assert.ok(network.lanes.every(lane => lane.ambushCells.every(cell => network.cells.get(`${cell[0]},${cell[1]}`).ambush)));
});

test("transport jump follows the directed rotation arc", () => {
  const [lane] = buildTransportNetwork([
    { id: "sun", position: [0, 0], rotation: -1, gravityRadius: 4 },
    { id: "earth", parentId: "sun", position: [12, 0], rotation: 1, gravityRadius: 8 },
  ]).lanes.filter(candidate => candidate.id === "sun-earth");
  assert.equal(lane.direction, -1);
  const first = transportJumpDestination(lane, lane.cells[0]);
  assert.deepEqual(first.position, lane.cells[lane.jumpHexes]);
  assert.equal(transportJumpDestination(lane, lane.cells[lane.cells.length - 1]), null);
  assert.equal(transportJumpDestination(lane, [1, 1]), null);
});
