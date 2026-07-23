import test from "node:test";
import assert from "node:assert/strict";

import { FACTIONS, FLEET_FORMATIONS, FLEETS_PER_ARMADA, systemLevel } from "../map/levels.js";
import { INITIAL_FLEET_STRENGTH, MAX_FLEET_STRENGTH } from "../map/strategicBalance.js";
import { formationLayout } from "../battle/formations.js";

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

test("strategic Fleets start at 10 Ships and cap at three layers", () => {
  assert.equal(FLEETS_PER_ARMADA, 3);
  assert.equal(formationLayout("sphere", FLEETS_PER_ARMADA).u.length, FLEETS_PER_ARMADA);
  assert.equal(INITIAL_FLEET_STRENGTH, 10);
  assert.equal(MAX_FLEET_STRENGTH, 57);
});

test("every named formation supports arbitrary fleet counts", () => {
  for (const name of ["line", "spindle", "crescent", "echelon", "sphere", "column"]) {
    for (const size of [1, 2, 4, 7, 13]) {
      const layout = formationLayout(name, size);
      assert.equal(layout.u.length, size);
      assert.equal(new Set(layout.u.map(position => position.slice(0, 2).join(","))).size, size);
    }
  }
});
