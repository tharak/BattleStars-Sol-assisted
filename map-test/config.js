// Isolated profile for map-test.html. Keep this explicit so experiments can
// change balance, factions, or formations without touching production config.
import { DEFAULT_MAP_CONFIG } from "../map/config.js";

export const MAP_TEST_CONFIG = Object.freeze({
  ...DEFAULT_MAP_CONFIG,
  factions: Object.freeze({ ...DEFAULT_MAP_CONFIG.factions }),
  fleetCount: DEFAULT_MAP_CONFIG.fleetCount,
  fleetFormation: DEFAULT_MAP_CONFIG.fleetFormation,
  initialFleetStrength: DEFAULT_MAP_CONFIG.initialFleetStrength,
});

globalThis.__BATTLESTARS_MAP_CONFIG__ = MAP_TEST_CONFIG;
