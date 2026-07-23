// Mutable aggregate for one battle plus its explicit runtime dependencies.
// Browser entry points and tests each construct their own context; this module
// deliberately exports no shared instance.
import { World } from "./ecs.js";
import { BattlePhase, ControlMode, ActivationOrder, DeploymentMode } from "./domain/constants.js";
import { PhaseMachine } from "./core/phaseMachine.js";

export class GameContext {
  constructor({ random, events }) {
    if (!random?.d6 || !random?.pick) throw new TypeError("GameContext requires a random source");
    if (!events?.emit || !events?.onAny) throw new TypeError("GameContext requires an event bus");
    this.random = random;
    this.events = events;
    this.phase = new PhaseMachine();
    this.world = new World();
    this.G = null;
    this.scen = null;
    this.ctrlMode = ControlMode.PLAY_BLUE;
    // Match the strategic map's initial armada: three full Fleets, each
    // representing 19 Ships, with one original flagship for the faction.
    this.SIZE = 3;
    this.BREAK_AT = 2;
    this.FLEET_STRENGTH = 19;
    this.FLAGSHIP_COUNT = 1;
    this.moveMode = ActivationOrder.INTERLEAVED;
    this.deployMode = DeploymentMode.MANUAL;
    this.act = null;
    this.setup = null;
    this.setupQueue = [];
    this.captainSeed = 1;
  }

  beginBattle() {
    this.world = new World();
    this.act = null;
    this.setup = null;
    this.setupQueue = [];
  }

  enterMenu() {
    this.phase.transition(BattlePhase.MENU);
    this.G = null;
    this.act = null;
    this.setup = null;
    this.setupQueue = [];
  }
}
