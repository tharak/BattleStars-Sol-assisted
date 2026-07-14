import test from "node:test";
import assert from "node:assert/strict";

import {
  scaledStrategicShipIconRadius,
  strategicShipColor,
} from "../map/shipAppearance.js";

test("strategic ship tokens scale proportionally with 2D camera zoom", () => {
  assert.equal(scaledStrategicShipIconRadius(1), 2.2);
  assert.equal(scaledStrategicShipIconRadius(8), 17.6);
  assert.ok(scaledStrategicShipIconRadius(16) > scaledStrategicShipIconRadius(8));
});

test("acted strategic ships use a darker version of their faction color", () => {
  assert.equal(strategicShipColor("blue"), "#00e5ff");
  assert.equal(strategicShipColor("blue", true), "#007985");
  assert.equal(strategicShipColor("green", true), "#00845d");
  assert.equal(strategicShipColor("red", true), "#8f1238");
});
