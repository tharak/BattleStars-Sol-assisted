// The production strategic-map profile. The test page supplies a separate
// profile before importing map/main.js; all gameplay tuning reads this shape.
export const DEFAULT_MAP_CONFIG = Object.freeze({
  factions: Object.freeze({
    blue: Object.freeze({ label: "Blue", startAt: "earth" }),
    green: Object.freeze({ label: "Green", startAt: "venus" }),
    red: Object.freeze({ label: "Red", startAt: "mars" }),
  }),
  planetIds: Object.freeze(["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"]),
  planetAxisAu: Object.freeze({
    mercury: 0.387, venus: 0.723, earth: 1, mars: 1.524,
    jupiter: 5.203, saturn: 9.537, uranus: 19.191, neptune: 30.069,
  }),
  planetHexPositions: Object.freeze({}),
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
