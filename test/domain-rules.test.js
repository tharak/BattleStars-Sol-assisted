import test from "node:test";
import assert from "node:assert/strict";

import { SequenceRandomSource } from "../battle/core/random.js";
import {
  ActivationOrder, ControlMode, FiringArc, MoraleState, Side, SupplyState,
} from "../battle/domain/constants.js";
import { combatDice, resolveCombat, targetNumber } from "../battle/domain/combatRules.js";
import {
  moraleModifier, moraleStateAfterCheck, moraleStateAfterEnemyDestroyed, resolveMorale, resolveRally,
} from "../battle/domain/moraleRules.js";
import {
  backwardMovementCost, evaluateMovementStep, forwardMovementCost,
} from "../battle/domain/movementRules.js";
import {
  firstSideForRound, firstSideForTurn, isHumanControlled, nextActivationSide,
} from "../battle/domain/activationRules.js";
import { breakThreshold, evaluateVictory } from "../battle/domain/victoryRules.js";

test("combat rules calculate dice and target numbers", () => {
  assert.equal(combatDice({ strength: 4, moraleState: MoraleState.STEADY }), 4);
  assert.equal(combatDice({ strength: 3, moraleState: MoraleState.SHAKEN }), 2);
  assert.equal(targetNumber({ targetArc: FiringArc.FRONT }), 5);
  assert.equal(targetNumber({ targetArc: FiringArc.FLANK }), 4);
  assert.equal(targetNumber({ targetArc: FiringArc.REAR }), 3);
  assert.equal(targetNumber({ targetArc: FiringArc.REAR, supplyState: SupplyState.CRITICAL }), 4);
});

test("combat resolution uses only the injected random source", () => {
  const result = resolveCombat({
    strength: 4,
    moraleState: MoraleState.STEADY,
    targetArc: FiringArc.FLANK,
    supplyState: SupplyState.NORMAL,
  }, new SequenceRandomSource([3, 4, 5, 1]));
  assert.deepEqual(result, { dice: 4, need: 4, rolls: [3, 4, 5, 1], hits: 2 });
});

test("morale rules calculate cumulative modifiers and state transitions", () => {
  assert.equal(moraleModifier({
    steadyFriendAdjacent: true,
    inCommand: true,
    fromFlankOrRear: true,
    supplyState: SupplyState.LOW,
    flagshipLost: true,
  }), -1);

  const result = resolveMorale({
    supplyState: SupplyState.LOW,
    flagshipLost: true,
  }, new SequenceRandomSource([5]));
  assert.equal(result.total, 3);
  assert.equal(result.passed, false);
  assert.equal(moraleStateAfterCheck({ currentState: MoraleState.STEADY, passed: false }), MoraleState.SHAKEN);
  assert.equal(moraleStateAfterCheck({ currentState: MoraleState.SHAKEN, passed: false }), MoraleState.ROUTED);
  assert.equal(moraleStateAfterCheck({ currentState: MoraleState.SHAKEN, passed: true }), MoraleState.SHAKEN);
  assert.equal(moraleStateAfterEnemyDestroyed(MoraleState.ROUTED), MoraleState.SHAKEN);
  assert.equal(moraleStateAfterEnemyDestroyed(MoraleState.SHAKEN), MoraleState.STEADY);
  assert.equal(moraleStateAfterEnemyDestroyed(MoraleState.STEADY), MoraleState.STEADY);
});

test("rally resolution is deterministic and applies command bonus", () => {
  assert.deepEqual(resolveRally({ inCommand: true }, new SequenceRandomSource([3])), {
    roll: 3, bonus: 1, passed: true,
  });
});

test("movement costs preserve open, gravity, and backward rules", () => {
  assert.equal(forwardMovementCost(), 1);
  assert.equal(forwardMovementCost({ gravityCost: 5 }), 5);
  assert.equal(backwardMovementCost(), 3);
});

test("shaken movement rejects only steps that approach the nearest enemy", () => {
  assert.deepEqual(evaluateMovementStep({
    moraleState: MoraleState.SHAKEN,
    currentPosition: [10, 10],
    nextPosition: [11, 10],
    nearestEnemyPosition: [12, 10],
  }), { ok: false, reason: "shaken" });
  assert.deepEqual(evaluateMovementStep({
    moraleState: MoraleState.SHAKEN,
    currentPosition: [10, 10],
    nextPosition: [9, 10],
    nearestEnemyPosition: [12, 10],
  }), { ok: true });
});

test("control modes and turn openers retain existing ordering", () => {
  assert.equal(isHumanControlled({ controlMode: ControlMode.PLAY_BLUE, side: Side.BLUE }), true);
  assert.equal(isHumanControlled({ controlMode: ControlMode.PLAY_BLUE, side: Side.RED }), false);
  assert.equal(isHumanControlled({ controlMode: ControlMode.HOTSEAT, side: Side.RED }), true);
  assert.equal(isHumanControlled({ controlMode: ControlMode.SPECTATE, side: Side.BLUE }), false);
  assert.equal(firstSideForTurn(1), Side.BLUE);
  assert.equal(firstSideForTurn(2), Side.RED);
  assert.equal(firstSideForRound({ turn: 2, controlMode: ControlMode.PLAY_RED }), Side.RED);
});

test("activation ordering alternates and falls back when one side is exhausted", () => {
  assert.equal(nextActivationSide({
    activationOrder: ActivationOrder.INTERLEAVED,
    unactivatedBySide: [2, 2],
    lastActed: Side.RED,
  }), Side.BLUE);
  assert.equal(nextActivationSide({
    activationOrder: ActivationOrder.INTERLEAVED,
    unactivatedBySide: [0, 2],
    lastActed: Side.BLUE,
  }), Side.RED);
  assert.equal(nextActivationSide({
    activationOrder: ActivationOrder.SIDE_AT_ONCE,
    unactivatedBySide: [1, 3],
    roundFirst: Side.RED,
  }), Side.RED);
  assert.equal(nextActivationSide({
    activationOrder: ActivationOrder.SIDE_AT_ONCE,
    unactivatedBySide: [1, 0],
    roundFirst: Side.RED,
  }), Side.BLUE);
});

test("break thresholds generalize to supported fleet sizes", () => {
  assert.equal(breakThreshold(5), 3);
  assert.equal(breakThreshold(9), 5);
  assert.equal(breakThreshold(12), 7);
});

test("victory rules resolve breaks, timed strength wins, and draws", () => {
  assert.deepEqual(evaluateVictory({
    lossesBySide: [5, 2],
    survivingStrengthBySide: [10, 20],
    fleetSize: 9,
    turn: 7,
    maxTurns: 15,
    roundComplete: false,
  }), { winner: Side.RED, reason: "break" });
  assert.deepEqual(evaluateVictory({
    lossesBySide: [2, 2],
    survivingStrengthBySide: [11, 9],
    fleetSize: 9,
    turn: 15,
    maxTurns: 15,
    roundComplete: true,
  }), { winner: Side.BLUE, reason: "time" });
  assert.deepEqual(evaluateVictory({
    lossesBySide: [2, 2],
    survivingStrengthBySide: [9, 9],
    fleetSize: 9,
    turn: 15,
    maxTurns: 15,
    roundComplete: true,
  }), { winner: null, reason: "time" });
  assert.equal(evaluateVictory({
    lossesBySide: [2, 2],
    survivingStrengthBySide: [9, 9],
    fleetSize: 9,
    turn: 14,
    maxTurns: 15,
    roundComplete: true,
  }), null);
});
