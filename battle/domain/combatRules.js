import { FiringArc, MoraleState, SupplyState } from "./constants.js";

const BASE_TARGET_NUMBER = Object.freeze({
  [FiringArc.FRONT]: 5,
  [FiringArc.FLANK]: 4,
  [FiringArc.REAR]: 3,
});

export function combatDice({ strength, moraleState, extraDice = 0 }) {
  const availableStrength = Math.max(0, strength);
  const base = moraleState === MoraleState.STEADY
    ? availableStrength
    : Math.ceil(availableStrength / 2);
  return base + Math.max(0, extraDice);
}

export function targetNumber({ targetArc, supplyState = SupplyState.NORMAL, ignoreCriticalSupply = false }) {
  const base = BASE_TARGET_NUMBER[targetArc];
  if (base == null) throw new RangeError(`Unknown firing arc: ${targetArc}`);
  return base + (supplyState === SupplyState.CRITICAL && !ignoreCriticalSupply ? 1 : 0);
}

export function resolveCombat(options, random) {
  if (!random?.d6) throw new TypeError("resolveCombat requires a random source");
  const dice = combatDice(options);
  const need = targetNumber(options);
  const rolls = [];
  let hits = 0;
  for (let index = 0; index < dice; index++) {
    const roll = random.d6();
    rolls.push(roll);
    if (roll >= need) hits++;
  }
  return { dice, need, rolls, hits };
}
