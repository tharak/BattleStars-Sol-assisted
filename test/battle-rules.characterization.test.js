import test from "node:test";
import assert from "node:assert/strict";

import { GameContext } from "../battle/gameContext.js";
import { SequenceRandomSource } from "../battle/core/random.js";
import { BattleEvent, EventBus } from "../battle/core/events.js";
import { MoraleState } from "../battle/config.js";
import { spawnUnit } from "../battle/formations.js";
import { contagion, destroy, moraleCheck } from "../battle/systems.js";
import * as C from "../battle/components.js";

function battleWith(rolls) {
  const state = new GameContext({
    random: new SequenceRandomSource(rolls),
    events: new EventBus(),
  });
  state.G = {
    turn: 1,
    over: false,
    winner: null,
    fleets: [
      { name: "test", supply: "ok", flagLost: false, roster: [] },
      { name: "test", supply: "ok", flagLost: false, roster: [] },
    ],
  };
  return state;
}

test("failed morale checks move one step down the morale ladder", () => {
  const state = battleWith([3, 3]);
  const unit = spawnUnit(state, 0, [10, 10], 0, false);

  assert.equal(moraleCheck(state, unit, false), false);
  assert.equal(state.world.get(unit, C.Morale).state, MoraleState.SHAKEN);
  assert.equal(moraleCheck(state, unit, false), false);
  assert.equal(state.world.get(unit, C.Morale).state, MoraleState.ROUTED);
  assert.equal(state.world.get(unit, C.Facing).dir, 3);
});

test("morale contagion checks eligible friends within two hexes in roster order", () => {
  const state = battleWith([1, 6]);
  const source = spawnUnit(state, 0, [10, 10], 0, false);
  const near = spawnUnit(state, 0, [11, 10], 0, false);
  const edge = spawnUnit(state, 0, [12, 10], 0, false);
  const far = spawnUnit(state, 0, [14, 10], 0, false);
  state.world.get(source, C.Morale).state = MoraleState.ROUTED;

  contagion(state, source);

  assert.equal(state.world.get(near, C.Morale).state, MoraleState.SHAKEN);
  assert.equal(state.world.get(edge, C.Morale).state, MoraleState.STEADY);
  assert.equal(state.world.get(far, C.Morale).state, MoraleState.STEADY);
});

test("flagship destruction marks the fleet and checks every survivor", () => {
  const state = battleWith([4, 5]);
  const flagship = spawnUnit(state, 0, [5, 5], 0, true);
  const first = spawnUnit(state, 0, [12, 5], 0, false);
  const second = spawnUnit(state, 0, [15, 5], 0, false);
  const events = [];
  state.events.onAny(event => events.push(event));

  destroy(state, flagship);

  assert.equal(state.G.fleets[0].flagLost, true);
  assert.equal(state.world.has(flagship, C.Alive), false);
  assert.equal(state.world.get(first, C.Morale).state, MoraleState.SHAKEN);
  assert.equal(state.world.get(second, C.Morale).state, MoraleState.STEADY);
  assert.deepEqual(events.map(event => event.type), [
    BattleEvent.UNIT_DESTROYED,
    BattleEvent.FLAGSHIP_LOST,
    BattleEvent.MORALE_CHECKED,
    BattleEvent.MORALE_CHECKED,
  ]);
});
