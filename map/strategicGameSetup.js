export function normalizeStrategicSetup({ playerCount, npcCount, maxFactions, changed = null }) {
  let players = Math.max(0, Math.floor(Number(playerCount) || 0));
  let npcs = Math.max(0, Math.floor(Number(npcCount) || 0));
  if (players + npcs > maxFactions) {
    if (changed === "players") npcs = Math.max(0, maxFactions - players);
    else players = Math.max(0, maxFactions - npcs);
  }
  const total = players + npcs;
  return { players, npcs, total, valid: total >= 1 && total <= maxFactions };
}

export function strategicFactionSetup(factionIds, { playerCount, npcCount }) {
  const normalized = normalizeStrategicSetup({
    playerCount, npcCount, maxFactions: factionIds.length,
  });
  if (!normalized.valid) return null;
  const factions = factionIds.slice(0, normalized.total);
  return {
    factions,
    controllers: new Map(factions.map((faction, index) => [
      faction, index < normalized.players ? "player" : "npc",
    ])),
  };
}

export function strategicTurnUsesTimer(controllers) {
  return [...controllers.values()].filter(controller => controller === "player").length > 1;
}
