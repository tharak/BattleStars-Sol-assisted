export const STRATEGIC_FACTION_ORDER = Object.freeze(["blue", "green", "red"]);
export const STRATEGIC_TURN_DURATION_MS = 60_000;

export function createStrategicTurnState({
  factionOrder = STRATEGIC_FACTION_ORDER,
  startedAtMs = 0,
  durationMs = STRATEGIC_TURN_DURATION_MS,
} = {}) {
  return {
    factionOrder: [...factionOrder],
    factionIndex: 0,
    round: 1,
    actedShipIds: [],
    forfeitedShipIds: [],
    durationMs,
    deadlineMs: startedAtMs + durationMs,
  };
}

export const activeStrategicFaction = state => state.factionOrder[state.factionIndex];
export const strategicTurnRemainingMs = (state, nowMs) => Math.max(0, state.deadlineMs - nowMs);
export const hasStrategicShipActed = (state, shipId) => state.actedShipIds.includes(shipId);

export function isStrategicActivationExhausted({ canMove = false, canFire = false } = {}) {
  return !canMove && !canFire;
}

export function canStrategicShipAct(state, { shipId, faction, alive = true }) {
  return !!alive && faction === activeStrategicFaction(state) && !hasStrategicShipActed(state, shipId);
}

function livingIds(livingShipIdsByFaction, faction) {
  return livingShipIdsByFaction[faction] || [];
}

function advanceFaction(state, livingShipIdsByFaction, nowMs, eligibleFactionIds = []) {
  const eligible = new Set(eligibleFactionIds);
  let factionIndex = state.factionIndex;
  let round = state.round;
  let actedShipIds = [...state.actedShipIds];
  let forfeitedShipIds = [...state.forfeitedShipIds];
  for (let step = 0; step < state.factionOrder.length; step++) {
    factionIndex = (factionIndex + 1) % state.factionOrder.length;
    if (factionIndex === 0) {
      round += 1;
      actedShipIds = [];
      forfeitedShipIds = [];
    }
    const faction = state.factionOrder[factionIndex];
    if (livingIds(livingShipIdsByFaction, faction).length || eligible.has(faction)) break;
  }
  return {
    ...state,
    factionIndex,
    round,
    actedShipIds,
    forfeitedShipIds,
    deadlineMs: nowMs + state.durationMs,
  };
}

export function completeStrategicActivations(state, {
  shipIds,
  livingShipIdsByFaction,
  nowMs,
  eligibleFactionIds,
}) {
  const activeFaction = activeStrategicFaction(state);
  const activeLiving = livingIds(livingShipIdsByFaction, activeFaction);
  const activeLivingSet = new Set(activeLiving);
  const acted = new Set(state.actedShipIds);
  for (const shipId of shipIds) if (activeLivingSet.has(shipId)) acted.add(shipId);
  const completed = { ...state, actedShipIds: [...acted] };
  return activeLiving.every(shipId => acted.has(shipId))
    ? advanceFaction(completed, livingShipIdsByFaction, nowMs, eligibleFactionIds)
    : completed;
}

export function expireStrategicTurn(state, { livingShipIdsByFaction, nowMs, eligibleFactionIds }) {
  if (nowMs < state.deadlineMs) return { expired: false, state, expiredShipIds: [] };
  const faction = activeStrategicFaction(state);
  const expiredShipIds = livingIds(livingShipIdsByFaction, faction)
    .filter(shipId => !hasStrategicShipActed(state, shipId));
  const completed = {
    ...state,
    actedShipIds: [...new Set([...state.actedShipIds, ...expiredShipIds])],
    forfeitedShipIds: [...new Set([...state.forfeitedShipIds, ...expiredShipIds])],
  };
  return {
    expired: true,
    expiredShipIds,
    state: advanceFaction(completed, livingShipIdsByFaction, nowMs, eligibleFactionIds),
  };
}
