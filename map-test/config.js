// Isolated profile for map-test.html. Keep this explicit so experiments can
// change balance, factions, or formations without touching production config.
import { DEFAULT_MAP_CONFIG } from "../map/config.js";

export const MAP_TEST_CONFIG = Object.freeze({
  ...DEFAULT_MAP_CONFIG,
  factions: Object.freeze({
    blue: Object.freeze({ label: "Blue", startAt: "earth" }),
    red: Object.freeze({ label: "Red", startAt: "venus" }),
  }),
  factionColors: Object.freeze({
    blue: Object.freeze({ fill: "#00e5ff", stroke: "#00e5ff", acted: "#007985" }),
    red: Object.freeze({ fill: "#00e5ff", stroke: "#00e5ff", acted: "#007985" }),
  }),
  planetIds: Object.freeze(["earth", "venus"]),
  planetAxisAu: Object.freeze({
    ...DEFAULT_MAP_CONFIG.planetAxisAu,
    earth: 0.42,
    venus: 0.58,
  }),
  planetHexPositions: Object.freeze({ earth: Object.freeze([4, 8]), venus: Object.freeze([14, 8]) }),
  fleetCount: DEFAULT_MAP_CONFIG.fleetCount,
  fleetFormation: DEFAULT_MAP_CONFIG.fleetFormation,
  initialFleetStrength: DEFAULT_MAP_CONFIG.initialFleetStrength,
});

globalThis.__BATTLESTARS_MAP_CONFIG__ = MAP_TEST_CONFIG;
