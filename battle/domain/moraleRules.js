import { MoraleState, SupplyState } from "./constants.js";

export function moraleModifier({
  steadyFriendAdjacent = false,
  inCommand = false,
  fromFlankOrRear = false,
  supplyState = SupplyState.NORMAL,
  flagshipLost = false,
} = {}) {
  return (steadyFriendAdjacent ? 1 : 0)
    + (inCommand ? 1 : 0)
    - (fromFlankOrRear ? 1 : 0)
    - (supplyState === SupplyState.NORMAL ? 0 : 1)
    - (flagshipLost ? 1 : 0);
}

export function resolveMorale(options, random) {
  if (!random?.d6) throw new TypeError("resolveMorale requires a random source");
  const roll = random.d6();
  const modifier = moraleModifier(options);
  const total = roll + modifier;
  return {
    roll,
    modifier,
    total,
    passed: total >= 4,
    supportBonus: !!options?.steadyFriendAdjacent,
    commandBonus: !!options?.inCommand,
    flankPenalty: !!options?.fromFlankOrRear,
    supplyPenalty: options?.supplyState !== undefined && options.supplyState !== SupplyState.NORMAL,
    flagshipPenalty: !!options?.flagshipLost,
  };
}

export function moraleStateAfterCheck({ currentState, passed }) {
  if (passed || currentState === MoraleState.ROUTED) return currentState;
  return currentState === MoraleState.STEADY ? MoraleState.SHAKEN : MoraleState.ROUTED;
}

// A destroyed enemy Fleet gives its victorious Armada a deterministic,
// one-step morale recovery; Routed never skips directly to Steady.
export function moraleStateAfterEnemyDestroyed(currentState) {
  if (currentState === MoraleState.ROUTED) return MoraleState.SHAKEN;
  if (currentState === MoraleState.SHAKEN) return MoraleState.STEADY;
  return MoraleState.STEADY;
}

export function resolveRally({ inCommand = false } = {}, random) {
  if (!random?.d6) throw new TypeError("resolveRally requires a random source");
  const roll = random.d6();
  const bonus = inCommand ? 1 : 0;
  return { roll, bonus, passed: roll + bonus >= 4 };
}
