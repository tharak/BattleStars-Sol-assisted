// Command boundary between input devices and game orchestration. Keyboard,
// buttons, AI orders, replays, and Unreal Enhanced Input can all issue the same
// small vocabulary of player intent.
import * as Q from "./queries.js";
import { Side } from "./domain/constants.js";

export const BattleCommand = Object.freeze({
  TURN_LEFT: "turn_left",
  TURN_RIGHT: "turn_right",
  MOVE_FORWARD: "move_forward",
  MOVE_BACKWARD: "move_backward",
  ENTER_FIRE_MODE: "enter_fire_mode",
  END_ACTIVATION: "end_activation",
  SET_FLAGSHIP: "set_flagship",
  REMOVE_DEPLOYED_UNIT: "remove_deployed_unit",
  CONFIRM_DEPLOYMENT: "confirm_deployment",
  RESTART: "restart",
  STEP_AI: "step_ai",
});

export class BattleController {
  constructor(state, orchestrator) {
    this.state = state;
    this.orchestrator = orchestrator;
  }

  execute(command) {
    const orchestrator = this.orchestrator;
    switch (command) {
      case BattleCommand.TURN_LEFT:
        return this.state.setup ? orchestrator.turnDeploymentUnit(1) : orchestrator.turnSelectedUnit(1);
      case BattleCommand.TURN_RIGHT:
        return this.state.setup ? orchestrator.turnDeploymentUnit(-1) : orchestrator.turnSelectedUnit(-1);
      case BattleCommand.MOVE_FORWARD:
        return orchestrator.moveSelectedUnitForward();
      case BattleCommand.MOVE_BACKWARD:
        return orchestrator.moveSelectedUnitBackward();
      case BattleCommand.ENTER_FIRE_MODE:
        return orchestrator.enterFireMode();
      case BattleCommand.END_ACTIVATION:
        return orchestrator.endSelectedActivation();
      case BattleCommand.SET_FLAGSHIP:
        return orchestrator.setDeploymentFlagship();
      case BattleCommand.REMOVE_DEPLOYED_UNIT:
        return orchestrator.removeDeploymentUnit();
      case BattleCommand.CONFIRM_DEPLOYMENT:
        return orchestrator.confirmDeployment();
      case BattleCommand.RESTART:
        return orchestrator.newBattle();
      case BattleCommand.STEP_AI:
        return orchestrator.stepAi();
      default:
        throw new Error(`Unknown battle command: ${command}`);
    }
  }

  selectHex(hex) {
    const state = this.state;
    if (state.setup) return this.orchestrator.selectDeploymentHex(hex);
    if (!state.G || state.G.over || !state.act) return;
    const entity = [...Q.aliveOfSide(state, Side.BLUE), ...Q.aliveOfSide(state, Side.RED)]
      .find(candidate => {
        const [c, r] = Q.posOf(state, candidate);
        return c === hex[0] && r === hex[1];
      });
    if (!entity) return;
    if (state.act.u == null) return this.orchestrator.selectUnit(entity);
    if (Q.sideOf(state, entity) === state.act.side &&
        entity !== state.act.u && !Q.isActivated(state, entity)) {
      return this.orchestrator.switchSelectedUnit(entity);
    }
    if (Q.sideOf(state, entity) !== state.act.side) return this.orchestrator.fireSelectedUnit(entity);
  }
}
