// Browser observer for semantic domain events. Replacing this module with UE
// delegate listeners leaves systems.js and all battle rules unchanged.
import { BattleEvent } from "./core/events.js";
import { sideCls, sideName, SupplyState, Side, STATE_NAME } from "./config.js";
import { LASER_DURATION } from "./dimensions.js";
import { clearLog, log } from "./panels.js";
import * as Q from "./queries.js";

function present(state, presentation, event) {
  switch (event.type) {
    case BattleEvent.BATTLE_INITIALIZED:
      presentation.effects = [];
      clearLog();
      log(`Scenario: ${event.scenario.t} — ${event.fleetSize} Fleets per Armada, breaks at ${event.breakThreshold}`, "t");
      break;
    case BattleEvent.DEPLOYMENT_STARTED:
      log(`${sideName(event.side)} Armada: deploy your Fleets — click your shaded zone.`, "t");
      break;
    case BattleEvent.DEPLOYMENT_CONFIRMED:
      log(`${sideName(event.side)} Armada deployment confirmed — ${event.fleetSize} Fleets.`, "t");
      break;
    case BattleEvent.AI_DEPLOYED:
      log(`${sideName(event.side)} (AI) deploys in ${event.formation} formation.`, "t");
      break;
    case BattleEvent.COMBAT_STARTED: {
      const supplyTag = supply => supply === SupplyState.NORMAL ? "" : ` (${supply.toUpperCase()} SUPPLY)`;
      log(`Blue: ${state.G.fleets[Side.BLUE].name}${supplyTag(state.G.fleets[Side.BLUE].supply)} — ` +
        `Red: ${state.G.fleets[Side.RED].name}${supplyTag(state.G.fleets[Side.RED].supply)}`);
      break;
    }
    case BattleEvent.TURN_STARTED:
      log(`— Turn ${event.turn} —`, "t");
      break;
    case BattleEvent.BATTLE_ENDED:
      presentBattleEnd(state, event);
      break;
    case BattleEvent.MORALE_CHECKED:
      log(`  ${event.label} morale: ${event.roll}${event.modifiers.length ? " " + event.modifiers.join(" ") : ""} = ${event.total} -> ${event.passed ? "holds" : "FAILS"}`,
        event.passed ? null : "bad");
      break;
    case BattleEvent.UNIT_ROUTED:
      log(`  ${event.label} ROUTS!`, "bad");
      break;
    case BattleEvent.UNIT_DESTROYED:
      log(`  ${event.label} is DESTROYED`, "bad");
      break;
    case BattleEvent.UNIT_RECOVERED:
      log(`  ${event.label} recovers: ${STATE_NAME[event.from]} → ${STATE_NAME[event.to]}`, "good");
      break;
    case BattleEvent.FLAGSHIP_LOST:
      log(`  ${sideName(event.side)} MAIN FLEET LOST - Armada-wide morale check, command net down`, "bad");
      break;
    case BattleEvent.SHOT_RESOLVED:
      log(`${event.attackerLabel} fires at ${event.targetLabel} (${event.arc} arc, ${event.targetNumber}+): ` +
        `[${event.rolls.join(" ")}] -> ${event.hits} hit${event.hits === 1 ? "" : "s"}`,
        event.hits ? sideCls(event.side) : null);
      presentation.effects.push({
        type: "laser", from: event.from, to: event.to, side: event.side,
        hit: event.hits > 0, start: performance.now(),
        dur: event.hits > 0 ? LASER_DURATION.hit : LASER_DURATION.miss,
      });
      break;
    case BattleEvent.UNIT_FLED:
      log(`  ${event.label} flees off the map`, "bad");
      break;
    case BattleEvent.UNIT_RALLIED:
      log(`${event.label} RALLIES (${event.roll}${event.bonus ? "+1" : ""}) - now Shaken`, "good");
      break;
    case BattleEvent.RALLY_FAILED:
      log(`${event.label} fails to rally (${event.roll}${event.bonus ? "+1" : ""}) and keeps running`);
      break;
    case BattleEvent.MOVE_REJECTED:
      if (event.reason === "shaken_advance") {
        log(`${event.label} is Shaken - it refuses to move toward the enemy`, "bad");
      }
      break;
  }
}

function presentBattleEnd(state, event) {
  const battle = state.G;
  const survivingStrength = side => Q.aliveOfSide(state, side)
    .reduce((sum, entity) => sum + Q.strengthOf(state, entity), 0);
  let title;
  let body;
  if (event.winner === null) {
    title = "Draw";
    body = `Both Armadas stand at turn ${battle.turn}.`;
  } else {
    title = `${sideName(event.winner)} wins`;
    const loser = event.winner === Side.BLUE ? Side.RED : Side.BLUE;
    body = event.reason === "break"
      ? `${sideName(loser)} Armada breaks on turn ${battle.turn} (${Q.losses(state, loser)} Fleets destroyed or fled).`
      : `On time at turn ${battle.turn}: surviving strength ${survivingStrength(Side.BLUE)}–${survivingStrength(Side.RED)}.`;
  }
  const controlName = ["Blue", "Red", "hotseat", "spectate"][state.ctrlMode];
  const result = `${state.scen.t} | ctrl=${controlName} | size=${state.SIZE} | ` +
    `winner=${event.winner === null ? "draw" : sideName(event.winner) + " (" + battle.fleets[event.winner].name + ")"} | ` +
    `turn=${battle.turn} | strength ${survivingStrength(Side.BLUE)}-${survivingStrength(Side.RED)} | ` +
    `losses ${Q.losses(state, Side.BLUE)}-${Q.losses(state, Side.RED)}`;
  log(`BATTLE OVER — ${title}. ${body}`, "t");
  document.getElementById("ovTitle").textContent = title;
  document.getElementById("ovBody").textContent = body +
    (battle.fleets[Side.BLUE].name === "sphere" || battle.fleets[Side.RED].name === "sphere"
      ? ` (Sphere survival score: ${battle.turn} turns.)` : "");
  document.getElementById("ovResult").textContent = result;
  document.getElementById("overlay").style.display = "flex";
}

export function attachBattlePresenter(state, presentation) {
  return state.events.onAny(event => present(state, presentation, event));
}
