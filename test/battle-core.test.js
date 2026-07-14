import test from "node:test";
import assert from "node:assert/strict";

import { BattleEvent } from "../battle/core/events.js";
import { BattlePhase, PhaseMachine } from "../battle/core/phaseMachine.js";
import { SeededRandomSource, SequenceRandomSource } from "../battle/core/random.js";
import { GameContext } from "../battle/gameContext.js";
import { EventBus } from "../battle/core/events.js";
import { deployFormation, spawnUnit } from "../battle/formations.js";
import { aiActivate, fire, moveActivatedUnitForward } from "../battle/systems.js";
import { MoraleState, MP_MAX } from "../battle/config.js";
import * as C from "../battle/components.js";
import * as Q from "../battle/queries.js";
import * as ShipRules from "../battle/core/shipRules.js";

function battleWith(random) {
  const state = new GameContext({ random, events: new EventBus() });
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

test("seeded random sources reproduce the same battle stream", () => {
  const first = new SeededRandomSource(42);
  const second = new SeededRandomSource(42);
  assert.deepEqual(
    Array.from({ length: 12 }, () => first.d6()),
    Array.from({ length: 12 }, () => second.d6()),
  );
});

test("phase machine rejects invalid lifecycle changes", () => {
  const phase = new PhaseMachine();
  phase.transition(BattlePhase.DEPLOYMENT);
  phase.transition(BattlePhase.COMBAT);
  phase.transition(BattlePhase.GAME_OVER);
  assert.equal(phase.current, BattlePhase.GAME_OVER);
  assert.throws(() => phase.transition(BattlePhase.DEPLOYMENT + "_invalid"));
});

test("beginBattle resets the ECS world between matches", () => {
  const state = battleWith(new SeededRandomSource(1));
  const oldWorld = state.world;
  oldWorld.createEntity();
  state.beginBattle();
  assert.notEqual(state.world, oldWorld);
  assert.equal(state.world.createEntity(), 1);
});

test("fire resolves through injected dice and emits domain events", () => {
  const state = battleWith(new SequenceRandomSource([6, 1, 1, 1, 6]));
  const attacker = spawnUnit(state, 0, [10, 13], 0, false);
  const target = spawnUnit(state, 1, [11, 13], 3, false);
  const events = [];
  state.events.onAny(event => events.push(event));

  const result = fire(state, attacker, target);

  assert.deepEqual(result.rolls, [6, 1, 1, 1]);
  assert.equal(result.hits, 1);
  assert.equal(state.world.get(target, C.Strength).value, 3);
  assert.equal(events[0].type, BattleEvent.SHOT_RESOLVED);
  assert.equal(events[1].type, BattleEvent.MORALE_CHECKED);
});

test("a shaken unit cannot use movement to approach the enemy", () => {
  const state = battleWith(new SeededRandomSource(1));
  const unit = spawnUnit(state, 0, [10, 13], 0, false);
  spawnUnit(state, 1, [12, 13], 3, false);
  state.world.get(unit, C.Morale).state = MoraleState.SHAKEN;
  state.act = { u: unit, mp: MP_MAX, moved: false, fired: false, fireMode: false, cmd: true };
  const events = [];
  state.events.onAny(event => events.push(event));

  assert.equal(moveActivatedUnitForward(state), false);
  assert.deepEqual([state.world.get(unit, C.Position).c, state.world.get(unit, C.Position).r], [10, 13]);
  assert.equal(events[0].type, BattleEvent.MOVE_REJECTED);
});

test("AI systems can finish a deterministic battle without a browser presenter", () => {
  const state = battleWith(new SeededRandomSource(42));
  state.SIZE = 9;
  state.BREAK_AT = 5;
  state.G.fleets[0].name = "spindle";
  state.G.fleets[1].name = "line";
  deployFormation(state, "spindle", 0);
  deployFormation(state, "line", 1);
  let eventCount = 0;
  state.events.onAny(() => eventCount++);

  for (let turn = 1; turn <= 40 && Q.losses(state, 0) < 5 && Q.losses(state, 1) < 5; turn++) {
    state.G.turn = turn;
    for (let index = 0; index < state.SIZE; index++) {
      for (const side of [turn % 2, 1 - turn % 2]) {
        const unit = state.G.fleets[side].roster[index];
        if (Q.isAlive(state, unit)) aiActivate(state, unit);
      }
    }
  }

  assert.ok(Q.losses(state, 0) >= 5 || Q.losses(state, 1) >= 5);
  assert.ok(eventCount > 0);
});

test("strategic-map combat returns presentation data without owning effects", () => {
  const world = new ShipRules.World();
  const attacker = ShipRules.spawnShip(world, {
    faction: 0, c: 10, r: 13, dir: 0, isFlag: false, label: "A1",
  });
  const target = ShipRules.spawnShip(world, {
    faction: 1, c: 11, r: 13, dir: 3, isFlag: false, label: "T1",
  });
  const random = new SequenceRandomSource([6, 1, 1, 1, 6]);

  const result = ShipRules.fire(world, attacker, target, random);

  assert.equal(result.hits, 1);
  assert.deepEqual(result.from, [10, 13]);
  assert.deepEqual(result.to, [11, 13]);
});
