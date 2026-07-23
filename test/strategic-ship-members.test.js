import test from "node:test";
import assert from "node:assert/strict";
import { FiringArc } from "../battle/domain/constants.js";
import { SequenceRandomSource } from "../battle/core/random.js";
import {
  StrategicShipState, allocateCollisionLosses, applyDirectionalDamage,
  assignMixedFleetSlots, fleetEffectiveStrength, repairStrategicMembers, resolveHexVolley,
  splitStrategicMembers,
} from "../map/strategicShipMembers.js";

const member = (id, overrides = {}) => ({ id, health: 1, state: StrategicShipState.READY, isOriginalFlagship: false, ...overrides });

test("Fleet Strength sums member health and halves Shaken members", () => {
  assert.equal(fleetEffectiveStrength([
    member(1), member(2, { health: 0.6 }), member(3, { state: StrategicShipState.SHAKEN }),
    member(4, { state: StrategicShipState.ROUTED }),
  ]), 2.1);
});

test("planets repair the most damaged living Ships without reviving losses", () => {
  const result = repairStrategicMembers([
    member(1, { health: 0.4 }), member(2, { health: 0.8 }), member(3, { health: 0 }),
  ], 0.5);
  assert.deepEqual(result.members.map(ship => ship.health), [0.9, 0.8, 0]);
  assert.equal(result.repaired, 0.5);
});

test("split detaches 19 above the layer size and halves smaller Fleets weakest-first", () => {
  const large = Array.from({ length: 38 }, (_, index) => member(index + 1));
  assert.equal(splitStrategicMembers(large).detached.length, 19);
  const small = Array.from({ length: 19 }, (_, index) => member(index + 1));
  small[5].health = 0.4;
  small[6].state = StrategicShipState.SHAKEN;
  const split = splitStrategicMembers(small);
  assert.equal(split.detached.length, 9);
  assert.ok(split.detached.some(ship => ship.id === 6));
  assert.ok(split.detached.some(ship => ship.id === 7));
});

test("mixed slots alternate Fleet ownership", () => {
  const slots = assignMixedFleetSlots([
    { fleetId: 1, members: [member(1), member(2)] },
    { fleetId: 2, members: [member(3), member(4)] },
  ]);
  assert.deepEqual(slots.map(slot => slot.fleetId), [1, 2, 1, 2]);
});

test("directional damage uses injected exposure weighting and persists tenths", () => {
  const members = [member(1), member(2)];
  const result = applyDirectionalDamage({
    members,
    positionsByMemberId: new Map([[1, [-1, 0]], [2, [1, 0]]]),
    incomingVector: [1, 0], damage: 0.2,
    random: { next: () => 0.99 },
  });
  assert.equal(result.members.find(ship => ship.id === 2).health, 0.8);
  assert.deepEqual(result.damagedIds, [2]);
});

test("stack volleys weight target Fleets by members and misses do nothing", () => {
  const random = new SequenceRandomSource([6, 1]);
  random.next = () => 0;
  const result = resolveHexVolley({
    attackerStrength: 2,
    targets: [{ fleetId: 4, members: [member(1)], arc: FiringArc.FRONT }],
    random,
  });
  assert.equal(result.hitsByFleet.get(4), 1);
  assert.equal(result.rolls[1].hit, false);
});

test("collision losses start with movers and stop at hex capacity", () => {
  const result = allocateCollisionLosses({
    fleets: [
      { fleetId: 1, members: Array.from({ length: 30 }, (_, i) => member(i + 1)) },
      { fleetId: 2, members: Array.from({ length: 30 }, (_, i) => member(i + 31)) },
    ],
    movingFleetIds: [2], maxShips: 57, random: { next: () => 0 },
  });
  assert.equal(result.losses.get(2).length, 2);
  assert.equal(result.losses.get(1).length, 1);
  assert.equal(result.fleets.reduce((sum, fleet) => sum + fleet.members.length, 0), 57);
});
