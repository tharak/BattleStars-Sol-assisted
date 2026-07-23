import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGravityFieldGroups, gravityHexRadius, hexDiskCells, warpGravityPoint,
} from "../map/gravityField.js";

const HEX_SIZE = 5;
const intensity = cost => cost / 10;

test("gravity radius produces a disk of normal hex cells", () => {
  assert.equal(gravityHexRadius({ bodyRadiusPx: 5, hexSizePx: 5 }), 4);
  for (const radius of [0, 1, 2, 4]) {
    const cells = hexDiskCells([10, 10], radius);
    assert.equal(cells.length, 1 + 3 * radius * (radius + 1));
    assert.ok(cells.every(cell => Math.max(Math.abs(cell[0] - 10), Math.abs(cell[1] - 10)) <= radius));
  }
});

test("off-grid gravity centers snap to one deterministic logical hex", () => {
  const first = hexDiskCells([3, 4], 2);
  const second = hexDiskCells([3, 4], 2);
  assert.deepEqual(first, second);
  assert.ok(first.includes([3, 4]) || first.some(([c, r]) => c === 3 && r === 4));
});

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
