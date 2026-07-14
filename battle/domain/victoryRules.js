import { Side, SIDES, opposingSide } from "./constants.js";

export const breakThreshold = fleetSize => Math.floor(fleetSize / 2) + 1;

export function evaluateVictory({
  lossesBySide,
  survivingStrengthBySide,
  fleetSize,
  turn,
  maxTurns,
  roundComplete,
}) {
  for (const side of SIDES) {
    if (lossesBySide[side] >= breakThreshold(fleetSize)) {
      return { winner: opposingSide(side), reason: "break" };
    }
  }
  if (!roundComplete || turn < maxTurns) return null;
  const blue = survivingStrengthBySide[Side.BLUE];
  const red = survivingStrengthBySide[Side.RED];
  return {
    winner: blue === red ? null : (blue > red ? Side.BLUE : Side.RED),
    reason: "time",
  };
}
