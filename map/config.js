// The production strategic-map profile. The test page supplies a separate
// profile before importing map/main.js; all gameplay tuning reads this shape.
export const DEFAULT_MAP_CONFIG = Object.freeze({
  factions: Object.freeze({
    blue: Object.freeze({ label: "Blue", startAt: "earth" }),
    green: Object.freeze({ label: "Green", startAt: "venus" }),
    red: Object.freeze({ label: "Red", startAt: "mars" }),
  }),
  planetIds: Object.freeze(["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"]),
  fleetCount: 3,
  fleetFormation: "sphere",
  initialFleetStrength: 19,
  maxFleetStrength: 57,
  maxShipsPerHex: 57,
  strategicDamagePerHit: 0.1,
  gravityInfluenceRadiusFactor: 4,
  minBodyResourceValue: 1,
  conquestTurnsPerResource: 10,
  productionFleetsPerTurn: 1,
  spawnClearanceHexes: 1,
});

export const activeMapConfig = () => globalThis.__BATTLESTARS_MAP_CONFIG__ || DEFAULT_MAP_CONFIG;
