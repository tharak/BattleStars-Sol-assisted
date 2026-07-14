import test from "node:test";
import assert from "node:assert/strict";

import {
  activeStrategicFaction,
  canStrategicShipAct,
  completeStrategicActivations,
  createStrategicTurnState,
  expireStrategicTurn,
  hasStrategicShipActed,
  strategicTurnRemainingMs,
} from "../map/strategicTurns.js";

const living = {
  blue: [1, 2],
  green: [3, 4],
  red: [5],
};

test("strategic turns start with Blue and a one-minute deadline", () => {
  const state = createStrategicTurnState({ startedAtMs: 1_000 });
  assert.equal(activeStrategicFaction(state), "blue");
  assert.equal(state.round, 1);
  assert.equal(strategicTurnRemainingMs(state, 1_000), 60_000);
  assert.equal(canStrategicShipAct(state, { shipId: 1, faction: "blue" }), true);
  assert.equal(canStrategicShipAct(state, { shipId: 3, faction: "green" }), false);
});

test("completing every living faction ship starts the next faction turn", () => {
  let state = createStrategicTurnState({ startedAtMs: 0 });
  state = completeStrategicActivations(state, { shipIds: [1], livingShipIdsByFaction: living, nowMs: 5_000 });
  assert.equal(activeStrategicFaction(state), "blue");
  assert.equal(hasStrategicShipActed(state, 1), true);
  assert.equal(canStrategicShipAct(state, { shipId: 2, faction: "blue" }), true);

  state = completeStrategicActivations(state, { shipIds: [2], livingShipIdsByFaction: living, nowMs: 10_000 });
  assert.equal(activeStrategicFaction(state), "green");
  assert.equal(state.deadlineMs, 70_000);
  assert.equal(canStrategicShipAct(state, { shipId: 1, faction: "blue" }), false);
});

test("group activations spend every participating ship together", () => {
  const state = completeStrategicActivations(createStrategicTurnState(), {
    shipIds: [1, 2], livingShipIdsByFaction: living, nowMs: 2_000,
  });
  assert.equal(activeStrategicFaction(state), "green");
  assert.equal(hasStrategicShipActed(state, 1), true);
  assert.equal(hasStrategicShipActed(state, 2), true);
});

test("wrapping from Red starts a new round and refreshes ship actions", () => {
  let state = createStrategicTurnState();
  state = completeStrategicActivations(state, { shipIds: [1, 2], livingShipIdsByFaction: living, nowMs: 1 });
  state = completeStrategicActivations(state, { shipIds: [3, 4], livingShipIdsByFaction: living, nowMs: 2 });
  state = completeStrategicActivations(state, { shipIds: [5], livingShipIdsByFaction: living, nowMs: 3 });
  assert.equal(activeStrategicFaction(state), "blue");
  assert.equal(state.round, 2);
  assert.deepEqual(state.actedShipIds, []);
});

test("an expired clock forfeits every remaining ship and advances", () => {
  const partial = completeStrategicActivations(createStrategicTurnState(), {
    shipIds: [1], livingShipIdsByFaction: living, nowMs: 10_000,
  });
  const early = expireStrategicTurn(partial, { livingShipIdsByFaction: living, nowMs: 59_999 });
  assert.equal(early.expired, false);

  const result = expireStrategicTurn(partial, { livingShipIdsByFaction: living, nowMs: 60_000 });
  assert.equal(result.expired, true);
  assert.deepEqual(result.expiredShipIds, [2]);
  assert.deepEqual(result.state.forfeitedShipIds, [2]);
  assert.equal(activeStrategicFaction(result.state), "green");
});

test("turn advancement skips a faction with no living ships", () => {
  const withoutGreen = { ...living, green: [] };
  const state = completeStrategicActivations(createStrategicTurnState(), {
    shipIds: [1, 2], livingShipIdsByFaction: withoutGreen, nowMs: 4_000,
  });
  assert.equal(activeStrategicFaction(state), "red");
});
