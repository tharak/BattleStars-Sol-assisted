import { deployFormation } from "../formations.js";
import { breakThreshold } from "../domain/victoryRules.js";
import { draftCaptains } from "../domain/captainRules.js";
import {
  BattlePhase, DeploymentMode, Side, SupplyState, ControlMode,
} from "../domain/constants.js";

export function initializeBattle(context) {
  context.beginBattle();
  context.BREAK_AT = breakThreshold(context.SIZE);
  const armadas = [
    { name: null, supply: context.scen.supA || SupplyState.NORMAL, flagLost: false, roster: [], captains: draftCaptains("blue", context.captainSeed) },
    { name: null, supply: context.scen.supB || SupplyState.NORMAL, flagLost: false, roster: [], captains: draftCaptains("red", context.captainSeed) },
  ];
  context.G = {
    turn: 0,
    lastActed: Side.RED,
    over: false,
    winner: null,
    armadas,
    // Tactical modules retain this alias while their internal APIs migrate.
    fleets: armadas,
  };
}

export function usesFixedDeployment(context) {
  return context.ctrlMode === ControlMode.SPECTATE
    || context.deployMode === DeploymentMode.FIXED_FORMATION;
}

export function deployScenario(context) {
  context.G.fleets[Side.BLUE].name = context.scen.a;
  deployFormation(context, context.scen.a, Side.BLUE);
  context.G.fleets[Side.RED].name = context.scen.b;
  deployFormation(context, context.scen.b, Side.RED);
}

export function enterCombat(context) {
  context.phase.transition(BattlePhase.COMBAT);
}

export function finishBattle(context, { winner, reason }) {
  context.G.over = true;
  context.G.winner = winner;
  context.G.endReason = reason;
  context.phase.transition(BattlePhase.GAME_OVER);
}
