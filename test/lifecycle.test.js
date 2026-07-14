import test from "node:test";
import assert from "node:assert/strict";

import { BattleOrchestrator } from "../battle/battleOrchestrator.js";
import { GameContext } from "../battle/gameContext.js";
import { EventBus, BattleEvent } from "../battle/core/events.js";
import { BattlePhase } from "../battle/core/phaseMachine.js";
import { ControlMode, Side } from "../battle/domain/constants.js";

function deterministicRandom() {
  return {
    d6: () => 6,
    pick: values => values[0],
  };
}

test("manual deployment flows into combat without presentation dependencies", () => {
  const events = new EventBus();
  const context = new GameContext({ random: deterministicRandom(), events });
  context.scen = { t: "Test", a: "line", b: "line" };
  context.ctrlMode = ControlMode.PLAY_BLUE;
  context.SIZE = 5;
  let refreshes = 0;
  const seen = [];
  events.onAny(event => seen.push(event.type));
  const orchestrator = new BattleOrchestrator(context, {
    refresh: () => refreshes++,
    schedule: callback => callback(),
  });

  orchestrator.newBattle();
  assert.equal(context.phase.current, BattlePhase.DEPLOYMENT);
  assert.equal(context.setup.side, Side.BLUE);

  for (let row = 10; row < 15; row++) orchestrator.selectDeploymentHex([5, row]);
  orchestrator.confirmDeployment();

  assert.equal(context.phase.current, BattlePhase.COMBAT);
  assert.equal(context.G.fleets[Side.BLUE].roster.length, 5);
  assert.equal(context.G.fleets[Side.RED].roster.length, 5);
  assert.equal(context.act.side, Side.BLUE);
  assert.ok(refreshes > 0);
  assert.deepEqual(seen.slice(0, 6), [
    BattleEvent.BATTLE_INITIALIZED,
    BattleEvent.DEPLOYMENT_STARTED,
    BattleEvent.DEPLOYMENT_CONFIRMED,
    BattleEvent.AI_DEPLOYED,
    BattleEvent.COMBAT_STARTED,
    BattleEvent.TURN_STARTED,
  ]);
});

test("the orchestrator uses its injected scheduler for non-spectator AI", () => {
  const context = new GameContext({ random: deterministicRandom(), events: new EventBus() });
  context.scen = { t: "Test", a: "line", b: "line" };
  context.ctrlMode = ControlMode.PLAY_RED;
  context.SIZE = 5;
  context.deployMode = 1;
  const scheduled = [];
  const orchestrator = new BattleOrchestrator(context, {
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
  });

  orchestrator.newBattle();

  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 250);
  assert.equal(context.act, null);
  scheduled[0].callback();
  assert.equal(context.act.side, Side.RED);
});
