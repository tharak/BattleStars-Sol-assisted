// Isolated profile for map-test.html. Keep this explicit so experiments can
// change balance, factions, or formations without touching production config.
export const MAP_TEST_CONFIG = Object.freeze({
  factions: Object.freeze({
    blue: Object.freeze({ label: "Blue", startAt: "earth" }),
    red: Object.freeze({ label: "Red", startAt: "venus" }),
  }),
  factionColors: Object.freeze({
    blue: Object.freeze({ fill: "#b86bff", stroke: "#b86bff", acted: "#6d3f9f" }),
    red: Object.freeze({ fill: "#00e5ff", stroke: "#00e5ff", acted: "#007985" }),
  }),
  planetIds: Object.freeze(["earth", "venus"]),
  planetAxisAu: Object.freeze({
    mercury: 0.387, venus: 0.58, earth: 0.42, mars: 1.524,
    jupiter: 5.203, saturn: 9.537, uranus: 19.191, neptune: 30.069,
  }),
  planetHexPositions: Object.freeze({ earth: Object.freeze([4, 8]), venus: Object.freeze([14, 8]) }),
  fleetCount: 6,
  fleetFormation: "sphere",
  fleetFormations: Object.freeze(["sphere", "line", "spindle", "crescent", "echelon", "column"]),
  initialFleetStrength: 10,
  maxFleetStrength: 57,
  maxShipsPerHex: 57,
  strategicDamagePerHit: 0.1,
  gravityInfluenceRadiusFactor: 4,
  minBodyResourceValue: 1,
  conquestTurnsPerResource: 10,
  productionFleetsPerTurn: 1,
  spawnClearanceHexes: 1,
});
