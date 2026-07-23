// Compatibility exports for domain modules; values come from the active map
// profile so production and map-test can tune the same mechanics independently.
import { activeMapConfig } from "./config.js";

const config = activeMapConfig();
export const INITIAL_FLEET_STRENGTH = config.initialFleetStrength;
export const MAX_FLEET_STRENGTH = config.maxFleetStrength;
export const MAX_SHIPS_PER_HEX = config.maxShipsPerHex;
export const STRATEGIC_DAMAGE_PER_HIT = config.strategicDamagePerHit;
export const GRAVITY_INFLUENCE_RADIUS_FACTOR = config.gravityInfluenceRadiusFactor;
export const MIN_BODY_RESOURCE_VALUE = config.minBodyResourceValue;
export const CONQUEST_TURNS_PER_RESOURCE = config.conquestTurnsPerResource;
export const PRODUCTION_FLEETS_PER_TURN = config.productionFleetsPerTurn;
export const SPAWN_CLEARANCE_HEXES = config.spawnClearanceHexes;
