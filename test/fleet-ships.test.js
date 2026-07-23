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

test("large strategic Fleets render every Ship in a compact formation", () => {
  for (const formation of FleetShips.FLEET_FORMATION_NAMES) {
    const offsets = FleetShips.fleetShipOffsets(formation, 40);
    assert.equal(offsets.length, 40);
    assert.ok(offsets.every(([forward, lateral]) => Math.abs(forward) <= 1 && Math.abs(lateral) <= 1));
  }
});

test("3D Fleets stack 57 Ships as three collision-free layers of 19", () => {
  const positions = FleetShips.layeredFleetShipPositions({
    x: 0, z: 0, strength: 57,
    spacing: 1.7, firstLayerHeight: 1.3, layerSpacing: 1,
  });
  assert.equal(positions.length, 57);
  assert.deepEqual([...new Set(positions.map(([, y]) => y))], [1.3, 2.3, 3.3]);
  assert.ok(positions.some(([x, y, z]) => y === 1.3 && Math.abs(x) < 1e-9 && Math.abs(z - 3.4) < 1e-9));
  for (const height of [1.3, 2.3, 3.3]) {
    const layer = positions.filter(([, y]) => y === height);
    assert.equal(layer.length, 19);
    for (let i = 0; i < layer.length; i++) {
      for (let j = i + 1; j < layer.length; j++) {
        assert.ok(Math.hypot(layer[i][0] - layer[j][0], layer[i][2] - layer[j][2]) >= 1.7 - 1e-9);
      }
    }
  }
});

test("3D Fleet layers use the same indexed hex positions for every formation", () => {
  const line = FleetShips.layeredFleetShipPositions({
    x: 0, z: 0, strength: 4, spacing: 1.7, firstLayerHeight: 1.3, layerSpacing: 1,
    formation: "line",
  });
  const column = FleetShips.layeredFleetShipPositions({
    x: 0, z: 0, strength: 4, spacing: 1.7, firstLayerHeight: 1.3, layerSpacing: 1,
    formation: "column",
  });
  assert.deepEqual(line.map(([x, , z]) => [x, z]), column.map(([x, , z]) => [x, z]));
  assert.equal(new Set(line.map(([, y]) => y)).size, 1);
});

test("3D Fleet formation slots never overlap", () => {
  for (const formation of FleetShips.FLEET_FORMATION_NAMES) {
    const positions = FleetShips.layeredFleetShipPositions({
      x: 0, z: 0, strength: 57, spacing: 1.7, firstLayerHeight: 1.3, layerSpacing: 1,
      formation,
    });
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const [x1, y1, z1] = positions[i];
        const [x2, y2, z2] = positions[j];
        if (y1 !== y2) continue;
        assert.ok(Math.hypot(x1 - x2, z1 - z2) >= 1.7 - 1e-9, `${formation} slots overlap`);
      }
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

test("line formation fills the requested indexed positions per layer", () => {
  assert.deepEqual(FleetShips.formationPositionOrder("line", 19), [
    0, 2, 5, 9, 16, 4, 6, 11, 17, 1, 3, 8, 14, 15, 13, 18, 10, 7, 12,
  ]);
  assert.equal(FleetShips.formationPositionOrder("line", 57)[19], 19);
  assert.equal(FleetShips.formationPositionOrder("line", 57)[38], 38);
});

test("sphere formation fills positions sequentially", () => {
  assert.deepEqual(FleetShips.formationPositionOrder("sphere", 6), [0, 1, 2, 3, 4, 5]);
});

test("arrow formation fills the requested indexed positions per layer", () => {
  assert.deepEqual(FleetShips.formationPositionOrder("arrow", 19), [
    10, 1, 3, 2, 5, 11, 17, 0, 4, 6, 13, 18, 15, 7, 12, 8, 14, 9, 16,
  ]);
  assert.equal(FleetShips.formationPositionOrder("arrow", 57)[19], 29);
  assert.equal(FleetShips.formationPositionOrder("arrow", 57)[38], 48);
});

test("column formation fills the corrected indexed positions per layer", () => {
  assert.deepEqual(FleetShips.formationPositionOrder("column", 19), [
    0, 10, 5, 1, 4, 3, 6, 7, 2, 13, 12, 15, 18, 8, 11, 14, 17, 9, 16,
  ]);
  assert.equal(FleetShips.formationPositionOrder("column", 57)[19], 19);
  assert.equal(FleetShips.formationPositionOrder("column", 57)[38], 38);
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

test("Fleet flagship counts retain merged command ships and legacy tags", () => {
  const world = new World();
  const fleet = ShipRules.spawnFleet(world, {
    faction: "blue", c: 0, r: 0, dir: 0, label: "B1", flagshipCount: 3,
  });
  assert.equal(ShipRules.flagshipCountOf(world, fleet), 3);
  assert.equal(ShipRules.isFlagship(world, fleet), true);
  assert.equal(ShipRules.setFlagshipCount(world, fleet, 0), 0);
  assert.equal(ShipRules.isFlagship(world, fleet), false);
  world.add(fleet, C.Flagship, true);
  assert.equal(ShipRules.flagshipCountOf(world, fleet), 1);
});
