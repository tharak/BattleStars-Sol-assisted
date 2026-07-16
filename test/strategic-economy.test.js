import test from "node:test";
import assert from "node:assert/strict";

import {
  bodyResourceValue, canConquerPlanet, conquestCompletionRound,
  conquestDurationTurns, spawnPointTowardSun,
} from "../map/strategicEconomy.js";

test("body resources reuse gravity radius with a minimum of one", () => {
  assert.equal(bodyResourceValue({ radiusPx: 0, hexSizePx: 5 }), 1);
  assert.equal(bodyResourceValue({ radiusPx: 3.25, hexSizePx: 5 }), 3);
  assert.equal(bodyResourceValue({ radiusPx: 10.8, hexSizePx: 5 }), 9);
});

test("conquest requires adjacency and enough Fleet Strength", () => {
  const base = { planetPosition: [1, 0], resourceValue: 3 };
  assert.equal(canConquerPlanet({ ...base, fleetPosition: [0, 0], fleetStrength: 3 }), true);
  assert.equal(canConquerPlanet({ ...base, fleetPosition: [0, 0], fleetStrength: 2.9 }), false);
  assert.equal(canConquerPlanet({ ...base, fleetPosition: [3, 0], fleetStrength: 40 }), false);
});

test("conquest duration is ten turns per resource point", () => {
  assert.equal(conquestDurationTurns(3), 30);
  assert.equal(conquestCompletionRound(7, 3), 37);
});

test("production spawns beyond gravity on the Sun-facing side", () => {
  assert.deepEqual(spawnPointTowardSun({
    planetX: 100, planetY: 0, gravityRadiusPx: 20, hexSizePx: 5,
  }), [75, 0]);
});
