import { MAX_TURNS } from "../config.js";
import * as C from "../components.js";
import * as Q from "../queries.js";
import {
  firstSideForRound, firstSideForTurn, nextActivationSide,
} from "../domain/activationRules.js";
import { evaluateVictory } from "../domain/victoryRules.js";
import { Side, SIDES } from "../domain/constants.js";

export function beginTurn(context) {
  const battle = context.G;
  battle.turn++;
  for (const side of SIDES) {
    for (const entity of Q.unitsOfSide(context, side)) context.world.remove(entity, C.Activated);
  }
  battle.lastActed = context.G.turn % 2;
  battle.roundFirst = firstSideForRound({ turn: battle.turn, controlMode: context.ctrlMode });
  return { turn: battle.turn, firstSide: firstSideForTurn(battle.turn) };
}

export function isRoundComplete(context) {
  return Q.unactivatedOfSide(context, Side.BLUE).length === 0
    && Q.unactivatedOfSide(context, Side.RED).length === 0;
}

export function currentBattleOutcome(context) {
  return evaluateVictory({
    lossesBySide: [Q.losses(context, Side.BLUE), Q.losses(context, Side.RED)],
    survivingStrengthBySide: [
      Q.aliveOfSide(context, Side.BLUE).reduce((sum, entity) => sum + Q.strengthOf(context, entity), 0),
      Q.aliveOfSide(context, Side.RED).reduce((sum, entity) => sum + Q.strengthOf(context, entity), 0),
    ],
    fleetSize: context.SIZE,
    turn: context.G.turn,
    maxTurns: MAX_TURNS,
    roundComplete: isRoundComplete(context),
  });
}

export function nextSide(context) {
  return nextActivationSide({
    activationOrder: context.moveMode,
    unactivatedBySide: [
      Q.unactivatedOfSide(context, Side.BLUE).length,
      Q.unactivatedOfSide(context, Side.RED).length,
    ],
    lastActed: context.G.lastActed,
    roundFirst: context.G.roundFirst,
  });
}

export function prepareHumanActivation(context, side) {
  context.act = { u: null, mp: 0, moved: false, fired: false, fireMode: false, side };
}

export function markActivated(context, entity, side) {
  context.world.add(entity, C.Activated, true);
  context.G.lastActed = side;
}
