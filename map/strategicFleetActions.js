import { MAX_FLEET_STRENGTH } from "./strategicBalance.js";

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

export function blocksFleetMovement(movingFaction, occupantFaction) {
  return movingFaction !== occupantFaction;
}

export function mergedFleetValues(fleets) {
  if (!Array.isArray(fleets) || fleets.length < 2) return null;
  const strength = rounded(fleets.reduce((total, fleet) => total + fleet.strength, 0));
  if (strength > MAX_FLEET_STRENGTH) return null;
  return {
    strength,
    flagshipCount: fleets.reduce((total, fleet) => total + (fleet.flagshipCount || 0), 0),
  };
}

export function mergeSurvivorId(fleets) {
  if (!Array.isArray(fleets) || !fleets.length) return null;
  return fleets.reduce((survivor, fleet) => (
    (fleet.flagshipCount || 0) > (survivor.flagshipCount || 0) ? fleet : survivor
  )).id;
}

export function splitFleetValues({ strength, flagshipCount = 0 }) {
  if (!Number.isFinite(strength) || strength < 2) return null;
  const detachedStrength = rounded(strength / 2);
  const retainedStrength = rounded(strength - detachedStrength);
  const normalizedFlagships = Math.max(0, Math.floor(flagshipCount));
  const detachedFlagships = normalizedFlagships > 1 ? Math.floor(normalizedFlagships / 2) : 0;
  return {
    retained: {
      strength: retainedStrength,
      flagshipCount: normalizedFlagships - detachedFlagships,
    },
    detached: {
      strength: detachedStrength,
      flagshipCount: detachedFlagships,
    },
  };
}
