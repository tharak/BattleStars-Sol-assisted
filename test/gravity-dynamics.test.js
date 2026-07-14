import test from "node:test";
import assert from "node:assert/strict";
import { gravitySpinDirection, resolveGravityDrift } from "../map/gravityDynamics.js";

const positionToWorld = ([c, r]) => [c * 10, r * 10];

test("gravity currents use real axial spin direction exceptions", () => {
  assert.equal(gravitySpinDirection("earth"), 1);
  assert.equal(gravitySpinDirection("venus"), -1);
  assert.equal(gravitySpinDirection("uranus"), -1);
});

test("inward-biased gravity drift adds one deterministic spiral hex", () => {
  const field = new Map([["1,0", { well: { id: "earth", x: 0, z: 0, spinDirection: 1 } }]]);
  assert.deepEqual(resolveGravityDrift([1, 0], field, positionToWorld), {
    from: [1, 0], to: [0, -1], direction: 2, wellId: "earth",
  });
  field.get("1,0").well.spinDirection = -1;
  assert.deepEqual(resolveGravityDrift([1, 0], field, positionToWorld)?.to, [0, 1]);
});
