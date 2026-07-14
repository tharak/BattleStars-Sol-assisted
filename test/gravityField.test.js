import test from "node:test";
import assert from "node:assert/strict";
import { buildGravityFieldGroups, warpGravityPoint } from "../map/gravityField.js";

const HEX_SIZE = 5;
const intensity = cost => cost / 10;

test("gravity deformation bends line points into a spinning inward spiral", () => {
  const [x, z] = warpGravityPoint(10, 0, [{ x: 0, z: 0, rPx: 4, spinDirection: 1 }], HEX_SIZE);
  assert.ok(x > 0 && x < 10);
  assert.ok(z < 0);
});

test("same-color neighboring gravity hexes emit their shared thick edge once", () => {
  const cells = new Map([
    ["0,0", { colorHex: "#ff0000", x: 0, y: 0, cost: 2 }],
    ["1,0", { colorHex: "#ff0000", x: Math.sqrt(3) * HEX_SIZE, y: 0, cost: 4 }],
  ]);
  const group = buildGravityFieldGroups(cells, [], HEX_SIZE, intensity).get("#ff0000");

  assert.equal(group.triangles.length, 36);
  assert.equal(group.edgeCount, 11);
  assert.equal(group.lineSegments.length, 22);
  assert.equal(group.lineIntensities.length, 22);
  assert.equal(group.lineIntensities.filter(value => value === 0.4).length, 12);
});

test("different body colors retain independent gravity boundaries", () => {
  const cells = new Map([
    ["0,0", { colorHex: "#ff0000", x: 0, y: 0, cost: 2 }],
    ["1,0", { colorHex: "#0000ff", x: Math.sqrt(3) * HEX_SIZE, y: 0, cost: 2 }],
  ]);
  const groups = buildGravityFieldGroups(cells, [], HEX_SIZE, intensity);

  assert.equal(groups.get("#ff0000").edgeCount, 6);
  assert.equal(groups.get("#0000ff").edgeCount, 6);
});
