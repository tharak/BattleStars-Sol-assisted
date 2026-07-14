import { deployFormation, randomFormationName } from "./formations.js";
import { aiActivate } from "./systems.js";
import * as Q from "./queries.js";
import { ControlMode, Side, SIDES } from "./domain/constants.js";
import { isHumanControlled } from "./domain/activationRules.js";
import { BattleEvent } from "./core/events.js";
import {
  deployScenario, enterCombat, finishBattle, initializeBattle, usesFixedDeployment,
} from "./lifecycle/battleLifecycle.js";
import {
  beginDeployment, commitDeployment, removeDeploymentUnit, rotateDeploymentUnit,
  selectOrPlaceDeploymentHex, setDeploymentFlagship,
} from "./lifecycle/deploymentLifecycle.js";
import {
  beginTurn, currentBattleOutcome, markActivated, nextSide, prepareHumanActivation,
} from "./lifecycle/turnLifecycle.js";
import {
  endSelectedActivation, enterFireMode, fireSelectedUnit, moveSelectedUnitBackward,
  moveSelectedUnitForward, selectUnit, switchSelectedUnit, turnSelectedUnit,
} from "./lifecycle/activationLifecycle.js";

export class BattleOrchestrator {
  constructor(context, {
    refresh = () => {},
    schedule = (callback, delay) => setTimeout(callback, delay),
  } = {}) {
    this.context = context;
    this.refresh = refresh;
    this.schedule = schedule;
  }

  newBattle() {
    const context = this.context;
    initializeBattle(context);
    context.events.emit(BattleEvent.BATTLE_INITIALIZED, {
      scenario: context.scen,
      fleetSize: context.SIZE,
      breakThreshold: context.BREAK_AT,
    });
    if (usesFixedDeployment(context)) {
      deployScenario(context);
      this.startCombat();
      return;
    }
    const humanSides = SIDES.filter(side => isHumanControlled({
      controlMode: context.ctrlMode,
      side,
    }));
    context.setupQueue = humanSides.slice(1);
    this.beginDeployment(humanSides[0]);
  }

  beginDeployment(side) {
    beginDeployment(this.context, side);
    this.context.events.emit(BattleEvent.DEPLOYMENT_STARTED, { side });
    this.refresh();
  }

  selectDeploymentHex(hex) {
    if (selectOrPlaceDeploymentHex(this.context, hex)) this.refresh();
  }

  turnDeploymentUnit(direction) {
    if (rotateDeploymentUnit(this.context, { direction })) this.refresh();
  }

  setDeploymentFlagship() {
    if (setDeploymentFlagship(this.context)) this.refresh();
  }

  removeDeploymentUnit() {
    if (removeDeploymentUnit(this.context)) this.refresh();
  }

  confirmDeployment() {
    const result = commitDeployment(this.context);
    if (!result) return;
    this.context.events.emit(BattleEvent.DEPLOYMENT_CONFIRMED, {
      side: result.side,
      fleetSize: this.context.SIZE,
    });
    if (this.context.setupQueue.length) {
      this.beginDeployment(this.context.setupQueue.shift());
      return;
    }
    for (const side of SIDES) {
      if (isHumanControlled({ controlMode: this.context.ctrlMode, side })) continue;
      const formation = randomFormationName(this.context.random);
      this.context.G.fleets[side].name = formation;
      deployFormation(this.context, formation, side);
      this.context.events.emit(BattleEvent.AI_DEPLOYED, { side, formation });
    }
    this.startCombat();
  }

  startCombat() {
    enterCombat(this.context);
    this.context.events.emit(BattleEvent.COMBAT_STARTED);
    this.startTurn();
    this.proceed();
  }

  startTurn() {
    const turn = beginTurn(this.context);
    this.context.events.emit(BattleEvent.TURN_STARTED, turn);
  }

  checkEnd() {
    if (this.context.G.over) return true;
    const outcome = currentBattleOutcome(this.context);
    if (outcome) {
      finishBattle(this.context, outcome);
      this.context.events.emit(BattleEvent.BATTLE_ENDED, outcome);
      this.refresh();
      return true;
    }
    if (Q.unactivatedOfSide(this.context, Side.BLUE).length === 0
        && Q.unactivatedOfSide(this.context, Side.RED).length === 0) this.startTurn();
    return false;
  }

  proceed() {
    const context = this.context;
    if (context.G.over || this.checkEnd()) return;
    const side = nextSide(context);
    if (side === null) {
      this.startTurn();
      return this.proceed();
    }
    if (isHumanControlled({ controlMode: context.ctrlMode, side })) {
      prepareHumanActivation(context, side);
      this.refresh();
      return;
    }
    const activate = () => {
      const entity = Q.unactivatedOfSide(context, side)[0];
      if (!entity) {
        this.proceed();
        return;
      }
      markActivated(context, entity, side);
      aiActivate(context, entity);
      this.refresh();
      if (context.ctrlMode === ControlMode.SPECTATE) {
        this.checkEnd();
        this.refresh();
      } else {
        this.proceed();
      }
    };
    if (context.ctrlMode === ControlMode.SPECTATE) activate();
    else this.schedule(activate, 250);
  }

  selectUnit(entity) {
    const result = selectUnit(this.context, entity);
    if (!result.selected) return;
    this.refresh();
    if (result.activationEnded) this.proceed();
  }

  switchSelectedUnit(entity) {
    const result = switchSelectedUnit(this.context, entity);
    if (result.selected) this.refresh();
  }

  turnSelectedUnit(direction) {
    if (turnSelectedUnit(this.context, { direction })) this.refresh();
  }

  moveSelectedUnitForward() {
    if (moveSelectedUnitForward(this.context)) this.refresh();
  }

  moveSelectedUnitBackward() {
    if (moveSelectedUnitBackward(this.context)) this.refresh();
  }

  enterFireMode() {
    if (enterFireMode(this.context)) this.refresh();
  }

  fireSelectedUnit(target) {
    const result = fireSelectedUnit(this.context, target);
    if (!result.fired) return;
    this.refresh();
    if (this.checkEnd()) return;
    if (result.activationEnded) {
      endSelectedActivation(this.context);
      this.refresh();
      this.proceed();
    }
  }

  endSelectedActivation() {
    if (!endSelectedActivation(this.context)) return;
    this.refresh();
    this.proceed();
  }

  stepAi() {
    if (this.context.ctrlMode === ControlMode.SPECTATE && !this.context.G?.over) this.proceed();
  }

  enterMenu() {
    this.context.enterMenu();
    this.refresh();
  }
}
