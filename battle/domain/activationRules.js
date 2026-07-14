import { ActivationOrder, ControlMode, Side, opposingSide } from "./constants.js";

export function isHumanControlled({ controlMode, side }) {
  if (controlMode === ControlMode.HOTSEAT) return true;
  if (controlMode === ControlMode.SPECTATE) return false;
  return side === controlMode;
}

export function firstSideForTurn(turn) {
  return (turn + 1) % 2;
}

export function firstSideForRound({ turn, controlMode }) {
  const blueHuman = isHumanControlled({ controlMode, side: Side.BLUE });
  const redHuman = isHumanControlled({ controlMode, side: Side.RED });
  if (blueHuman !== redHuman) return blueHuman ? Side.BLUE : Side.RED;
  return firstSideForTurn(turn);
}

export function nextActivationSide({
  activationOrder,
  unactivatedBySide,
  lastActed,
  roundFirst,
}) {
  if (activationOrder === ActivationOrder.SIDE_AT_ONCE) {
    if (unactivatedBySide[roundFirst] > 0) return roundFirst;
    const second = opposingSide(roundFirst);
    return unactivatedBySide[second] > 0 ? second : null;
  }
  const other = opposingSide(lastActed);
  if (unactivatedBySide[other] > 0) return other;
  return unactivatedBySide[lastActed] > 0 ? lastActed : null;
}
