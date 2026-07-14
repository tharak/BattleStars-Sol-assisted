// Semantic messages produced by the battle domain. In Unreal these map cleanly
// to multicast delegates or Gameplay Message Router channels.
export const BattleEvent = Object.freeze({
  BATTLE_INITIALIZED: "battle.lifecycle.initialized",
  DEPLOYMENT_STARTED: "battle.deployment.started",
  DEPLOYMENT_CONFIRMED: "battle.deployment.confirmed",
  AI_DEPLOYED: "battle.deployment.ai_completed",
  COMBAT_STARTED: "battle.lifecycle.combat_started",
  TURN_STARTED: "battle.lifecycle.turn_started",
  BATTLE_ENDED: "battle.lifecycle.ended",
  MORALE_CHECKED: "battle.morale.checked",
  UNIT_ROUTED: "battle.unit.routed",
  UNIT_DESTROYED: "battle.unit.destroyed",
  FLAGSHIP_LOST: "battle.flagship.lost",
  SHOT_RESOLVED: "battle.shot.resolved",
  UNIT_FLED: "battle.unit.fled",
  UNIT_RALLIED: "battle.unit.rallied",
  RALLY_FAILED: "battle.unit.rally_failed",
  MOVE_REJECTED: "battle.movement.rejected",
});

// Observer pattern with no DOM dependency. Subscribers are presentation,
// audio, telemetry, achievements, or tests; systems only publish facts.
export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(type, listener) {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  onAny(listener) {
    return this.on("*", listener);
  }

  emit(type, payload = {}) {
    const event = Object.freeze({ type, ...payload });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    for (const listener of this.listeners.get("*") ?? []) listener(event);
    return event;
  }

  clear() {
    this.listeners.clear();
  }
}
