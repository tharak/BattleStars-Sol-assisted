// Command boundary between input devices and game orchestration. Keyboard,
// buttons, AI orders, replays, and Unreal Enhanced Input can all issue the same
// small vocabulary of player intent.
import { draw } from "./render.js";
import { updatePanels } from "./panels.js";
import * as Q from "./queries.js";
import {
  doTurn, doForward, doBackward, doFireAt, endActivation,
  selectUnit, switchSelection, newBattle, proceed,
} from "./turnEngine.js";
import {
  handleSetupClick, setupTurn, setupToggleFlag, setupRemove, confirmSetup,
} from "./deployment.js";
import { ControlMode, Side } from "./domain/constants.js";

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
  constructor(state) {
    this.state = state;
  }

  execute(command) {
    const state = this.state;
    switch (command) {
      case BattleCommand.TURN_LEFT:
        return state.setup ? setupTurn(state, 1) : doTurn(state, 1);
      case BattleCommand.TURN_RIGHT:
        return state.setup ? setupTurn(state, -1) : doTurn(state, -1);
      case BattleCommand.MOVE_FORWARD:
        return doForward(state);
      case BattleCommand.MOVE_BACKWARD:
        return doBackward(state);
      case BattleCommand.ENTER_FIRE_MODE:
        if (Q.canFire(state)) {
          state.act.fireMode = true;
          updatePanels(state);
          draw(state);
        }
        return;
      case BattleCommand.END_ACTIVATION:
        return endActivation(state);
      case BattleCommand.SET_FLAGSHIP:
        return setupToggleFlag(state);
      case BattleCommand.REMOVE_DEPLOYED_UNIT:
        return setupRemove(state);
      case BattleCommand.CONFIRM_DEPLOYMENT:
        return confirmSetup(state);
      case BattleCommand.RESTART:
        return newBattle(state);
      case BattleCommand.STEP_AI:
        if (state.ctrlMode === ControlMode.SPECTATE && !state.G?.over) return proceed(state);
        return;
      default:
        throw new Error(`Unknown battle command: ${command}`);
    }
  }

  selectHex(hex) {
    const state = this.state;
    if (state.setup) return handleSetupClick(state, hex);
    if (!state.G || state.G.over || !state.act) return;
    const entity = [...Q.aliveOfSide(state, Side.BLUE), ...Q.aliveOfSide(state, Side.RED)]
      .find(candidate => {
        const [c, r] = Q.posOf(state, candidate);
        return c === hex[0] && r === hex[1];
      });
    if (!entity) return;
    if (state.act.u == null) return selectUnit(state, entity);
    if (Q.sideOf(state, entity) === state.act.side &&
        entity !== state.act.u && !Q.isActivated(state, entity)) {
      return switchSelection(state, entity);
    }
    if (Q.sideOf(state, entity) !== state.act.side) return doFireAt(state, entity);
  }
}
