import { BattlePhase } from "../domain/constants.js";

export { BattlePhase };

const ALLOWED_TRANSITIONS = Object.freeze({
  [BattlePhase.MENU]: new Set([BattlePhase.DEPLOYMENT, BattlePhase.COMBAT]),
  [BattlePhase.DEPLOYMENT]: new Set([BattlePhase.DEPLOYMENT, BattlePhase.COMBAT, BattlePhase.MENU]),
  [BattlePhase.COMBAT]: new Set([BattlePhase.DEPLOYMENT, BattlePhase.COMBAT, BattlePhase.GAME_OVER, BattlePhase.MENU]),
  [BattlePhase.GAME_OVER]: new Set([BattlePhase.DEPLOYMENT, BattlePhase.COMBAT, BattlePhase.MENU]),
});

// State pattern: lifecycle transitions are validated in one place instead of
// being inferred independently from setup/G/overlay values throughout the UI.
export class PhaseMachine {
  constructor(initial = BattlePhase.MENU) {
    this.current = initial;
  }

  transition(next) {
    if (next === this.current) return;
    if (!ALLOWED_TRANSITIONS[this.current]?.has(next)) {
      throw new Error(`Invalid battle phase transition: ${this.current} -> ${next}`);
    }
    this.current = next;
  }

  is(phase) {
    return this.current === phase;
  }
}
