import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStrategicSetup, strategicFactionSetup, strategicTurnUsesTimer,
} from "../map/strategicGameSetup.js";

test("strategic setup caps combined commanders and supports NPC-only games", () => {
  assert.deepEqual(normalizeStrategicSetup({ playerCount: 3, npcCount: 2, maxFactions: 3, changed: "players" }), {
    players: 3, npcs: 0, total: 3, valid: true,
  });
  const npcOnly = strategicFactionSetup(["blue", "green", "red"], { playerCount: 0, npcCount: 2 });
  assert.deepEqual(npcOnly.factions, ["blue", "green"]);
  assert.deepEqual([...npcOnly.controllers.values()], ["npc", "npc"]);
  assert.equal(strategicFactionSetup(["blue", "green", "red"], { playerCount: 0, npcCount: 0 }), null);
});

test("the strategic timer is reserved for games with multiple human players", () => {
  assert.equal(strategicTurnUsesTimer(new Map([["blue", "player"], ["green", "npc"]])), false);
  assert.equal(strategicTurnUsesTimer(new Map([["blue", "npc"], ["green", "npc"]])), false);
  assert.equal(strategicTurnUsesTimer(new Map([["blue", "player"], ["green", "player"]])), true);
});
