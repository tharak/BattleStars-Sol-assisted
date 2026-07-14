import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../battle/ecs.js";
import * as C from "../battle/components.js";
import * as FleetShips from "../battle/fleetShips.js";
import * as ShipRules from "../battle/core/shipRules.js";

test("each Fleet formation has one visible Ship per Strength", () => {
  for (const formation of FleetShips.FLEET_FORMATION_NAMES) {
    for (let strength = 1; strength <= 4; strength++) {
      const offsets = FleetShips.fleetShipOffsets(formation, strength);
      assert.equal(offsets.length, strength, `${formation} strength ${strength}`);
      assert.ok(offsets.every(([forward, lateral]) => Math.abs(forward) <= 1 && Math.abs(lateral) <= 1));
    }
  }
});

test("Fleet Ship formations rotate with the Fleet facing", () => {
  const east = FleetShips.fleetShipPositions({
    x: 10, y: 20, facingDeg: 0, formation: "line", strength: 2, spacing: 10,
  });
  const south = FleetShips.fleetShipPositions({
    x: 10, y: 20, facingDeg: 90, formation: "line", strength: 2, spacing: 10,
  });
  assert.deepEqual(east, [[10, 14.5], [10, 25.5]]);
  assert.deepEqual(south.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]), [[15.5, 20], [4.5, 20]]);
});

test("Fleet formation state defaults to sphere and only accepts supported formations", () => {
  const world = new World();
  const fleet = ShipRules.spawnFleet(world, { faction: "blue", c: 0, r: 0, dir: 0, label: "B1" });
  assert.equal(ShipRules.fleetFormationOf(world, fleet), "sphere");
  assert.equal(ShipRules.setFleetFormation(world, fleet, "wedge"), true);
  assert.equal(world.get(fleet, C.FleetFormation).name, "wedge");
  assert.equal(ShipRules.setFleetFormation(world, fleet, "spiral"), false);
  assert.equal(ShipRules.fleetFormationOf(world, fleet), "wedge");
});
