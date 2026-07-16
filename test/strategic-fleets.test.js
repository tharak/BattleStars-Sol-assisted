import test from "node:test";
import assert from "node:assert/strict";

import { FACTIONS, FLEET_FORMATIONS, systemLevel } from "../map/levels.js";
import { INITIAL_FLEET_STRENGTH, MAX_FLEET_STRENGTH } from "../map/strategicBalance.js";

test("Sol contains the eight planets without synthetic terrain bodies", () => {
  assert.deepEqual(systemLevel("sol").bodies.map(body => body.id), [
    "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune",
  ]);
});

test("factions start at their designated inner planets", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(FACTIONS).map(([faction, config]) => [faction, config.startAt])),
    { blue: "earth", green: "venus", red: "mars" },
  );
});

test("every faction starts in sphere formation", () => {
  assert.deepEqual(FLEET_FORMATIONS, {
    blue: "sphere",
    green: "sphere",
    red: "sphere",
  });
});

test("strategic Fleets start at one 19-Ship layer and cap at three layers", () => {
  assert.equal(INITIAL_FLEET_STRENGTH, 19);
  assert.equal(MAX_FLEET_STRENGTH, 57);
});
