import test from "node:test";
import assert from "node:assert/strict";

import { CAPTAIN_ABILITIES, draftCaptains } from "../battle/domain/captainRules.js";
import { SequenceRandomSource } from "../battle/core/random.js";
import * as ShipRules from "../battle/core/shipRules.js";
import { MoraleState } from "../battle/domain/constants.js";

test("captain drafts are seeded, distinct, and stable per faction", () => {
  const first = draftCaptains("blue", 42);
  assert.deepEqual(first, draftCaptains("blue", 42));
  assert.equal(new Set(first.map(captain => captain.abilityId)).size, 3);
  assert.notDeepEqual(first.map(captain => captain.abilityId), draftCaptains("red", 42).map(captain => captain.abilityId));
  assert.equal(CAPTAIN_ABILITIES.length, 18);
});

test("captain gunnery and morale bonuses apply only to its flagship", () => {
  const world = new ShipRules.World();
  const attacker = ShipRules.spawnFleet(world, {
    faction: "blue", c: 0, r: 0, dir: 0, label: "B1", strength: 1,
    captain: { id: "blue-1", abilityId: "front_gunnery", name: "Blue Captain 1" },
  });
  const target = ShipRules.spawnFleet(world, { faction: "red", c: 1, r: 0, dir: 3, label: "R1", strength: 4 });
  const result = ShipRules.fire(world, attacker, target, new SequenceRandomSource([6, 6, 6]));
  assert.equal(result.rolls.length, 2);

  const steady = ShipRules.spawnFleet(world, {
    faction: "blue", c: 5, r: 0, dir: 0, label: "B2", strength: 1,
    captain: { id: "blue-2", abilityId: "steadfast", name: "Blue Captain 2" },
  });
  const morale = ShipRules.moraleCheck(world, steady, new SequenceRandomSource([3]));
  assert.equal(morale.passed, true);
  assert.equal(ShipRules.moraleOf(world, steady), MoraleState.STEADY);
});
