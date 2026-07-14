import test from "node:test";
import assert from "node:assert/strict";

import { FACTIONS, FLEET_FORMATIONS } from "../map/levels.js";

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
