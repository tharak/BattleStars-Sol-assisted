import test from "node:test";
import assert from "node:assert/strict";

import { GameContext } from "../battle/gameContext.js";
import { SequenceRandomSource } from "../battle/core/random.js";
import { BattleEvent, EventBus } from "../battle/core/events.js";
import { MoraleState } from "../battle/config.js";
import { spawnUnit } from "../battle/formations.js";
import { contagion, destroy, fire, moraleCheck } from "../battle/systems.js";
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
  const unit = spawnUnit(state, { side: 0, position: [10, 10], facing: 0 });

  assert.equal(moraleCheck(state, unit), false);
  assert.equal(state.world.get(unit, C.Morale).state, MoraleState.SHAKEN);
  assert.equal(moraleCheck(state, unit), false);
  assert.equal(state.world.get(unit, C.Morale).state, MoraleState.ROUTED);
  assert.equal(state.world.get(unit, C.Facing).dir, 3);
});

test("morale contagion checks eligible friends within two hexes in roster order", () => {
  const state = battleWith([1, 6]);
  const source = spawnUnit(state, { side: 0, position: [10, 10], facing: 0 });
  const near = spawnUnit(state, { side: 0, position: [11, 10], facing: 0 });
  const edge = spawnUnit(state, { side: 0, position: [12, 10], facing: 0 });
  const far = spawnUnit(state, { side: 0, position: [14, 10], facing: 0 });
  state.world.get(source, C.Morale).state = MoraleState.ROUTED;

  contagion(state, source);

  assert.equal(state.world.get(near, C.Morale).state, MoraleState.SHAKEN);
  assert.equal(state.world.get(edge, C.Morale).state, MoraleState.STEADY);
  assert.equal(state.world.get(far, C.Morale).state, MoraleState.STEADY);
});

test("flagship destruction marks the fleet and checks every survivor", () => {
  const state = battleWith([4, 5]);
  const flagship = spawnUnit(state, { side: 0, position: [5, 5], facing: 0, isFlagship: true });
  const first = spawnUnit(state, { side: 0, position: [12, 5], facing: 0 });
  const second = spawnUnit(state, { side: 0, position: [15, 5], facing: 0 });
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

test("destroying an enemy Fleet recovers every friendly Routed and Shaken Fleet", () => {
  const state = battleWith([6, 6, 6, 6]);
  const attacker = spawnUnit(state, { side: 0, position: [10, 10], facing: 0 });
  const routed = spawnUnit(state, { side: 0, position: [8, 10], facing: 0 });
  const shaken = spawnUnit(state, { side: 0, position: [7, 10], facing: 0 });
  const steady = spawnUnit(state, { side: 0, position: [6, 10], facing: 0 });
  const target = spawnUnit(state, { side: 1, position: [11, 10], facing: 3 });
  state.world.get(routed, C.Morale).state = MoraleState.ROUTED;
  state.world.get(shaken, C.Morale).state = MoraleState.SHAKEN;
  state.world.get(target, C.Strength).value = 1;
  const events = [];
  state.events.onAny(event => events.push(event));

  fire(state, attacker, target);

  assert.equal(state.world.has(target, C.Alive), false);
  assert.equal(state.world.get(routed, C.Morale).state, MoraleState.SHAKEN);
  assert.equal(state.world.get(shaken, C.Morale).state, MoraleState.STEADY);
  assert.equal(state.world.get(steady, C.Morale).state, MoraleState.STEADY);
  assert.deepEqual(events.filter(event => event.type === BattleEvent.UNIT_RECOVERED).map(event => [event.unit, event.from, event.to]), [
    [routed, MoraleState.ROUTED, MoraleState.SHAKEN],
    [shaken, MoraleState.SHAKEN, MoraleState.STEADY],
  ]);
});
