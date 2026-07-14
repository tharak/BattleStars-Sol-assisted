// Every mutating gameplay system. This module is deliberately headless: it
// changes domain state and emits semantic events, but never touches the DOM,
// visual effects, audio, or clocks.
//
// The actual movement/fire/morale *rules* now live in
// battle/core/shipRules.js (shared with the star map, see that file's
// header) -- everything below is this screen's own adapter layer: it
// supplies the 2-side/roster/supply/turn-order state shipRules.js has no
// concept of (via the hooks each shipRules function takes), and translates
// results into this screen's BattleEvent stream. AI behavior
// (aiActivate/aiStep/flee/routedActivation) and pure facing helpers
// (turnToward/desiredDir) have no star-map equivalent (it has no AI), so
// they remain here as the battle-specific adapter over shared hex math.
import { hexDist, neighbor, directionToward, key } from "./hexmath.js";
import { RANGE, MP_MAX, HOLD_FORMS, MoraleState, inBounds, Side } from "./config.js";
import { BattleEvent } from "./core/events.js";
import { resolveRally } from "./domain/moraleRules.js";
import * as C from "./components.js";
import * as Q from "./queries.js";
import * as SR from "./core/shipRules.js";

const { SHAKEN, ROUTED } = MoraleState;
const setPos = (state, e, pos) => { const p = state.world.get(e, C.Position); p.c = pos[0]; p.r = pos[1]; };

const fleetMoraleOptions = (state, side) => ({
  supplyState: state.G.fleets[side].supply,
  flagshipLost: state.G.fleets[side].flagLost,
});

// {onChecked, onRouted} for shipRules.js's moraleCheck/contagion/destroy/
// fire -- entity-derived (via Q.sideOf(state, e/v)), so one instance
// covers every unit a cascade touches regardless of whose morale started
// it. Emits BattleEvent.MORALE_CHECKED for every check performed
// (matching shipRules' onChecked firing right after each roll, before
// any state mutation) and BattleEvent.UNIT_ROUTED + forces facing the
// moment a unit newly routs (matching onRouted firing before that unit's
// own contagion cascade) -- both in the same relative order the
// pre-extraction code emitted them in.
function moraleHooks(state) {
  return {
    onChecked: (e, r) => {
      const side = Q.sideOf(state, e);
      const why = [
        r.supportBonus && "+1 support", r.commandBonus && "+1 command", r.flankPenalty && "−1 flanked",
        r.supplyPenalty && "−1 supply", r.flagshipPenalty && "−1 flagship",
      ].filter(Boolean);
      state.events.emit(BattleEvent.MORALE_CHECKED, {
        unit: e, label: Q.labelOf(state, e), roll: r.roll, modifier: r.total - r.roll,
        modifiers: why, total: r.total, passed: r.passed,
      });
    },
    onRouted: e => {
      const side = Q.sideOf(state, e);
      state.world.get(e, C.Facing).dir = side === Side.BLUE ? 3 : 0;
      state.events.emit(BattleEvent.UNIT_ROUTED, { unit: e, label: Q.labelOf(state, e), side });
    },
  };
}
// `onFlagshipLost` for shipRules.js's destroy/fire -- shared shape, but
// needs the destroyed entity itself for the event payload (shipRules
// only passes the faction), so each call site closes over its own `e`/
// `tgt`. Iterates this side's own roster (which shipRules.js has no
// access to) to morale-check every survivor, exactly as the
// pre-extraction code's flagship-loss loop did.
function flagshipLostHook(state, destroyedEntity) {
  return flagSide => {
    state.G.fleets[flagSide].flagLost = true;
    state.events.emit(BattleEvent.FLAGSHIP_LOST, { unit: destroyedEntity, side: flagSide });
    for (const v of Q.aliveOfSide(state, flagSide)) moraleCheck(state, v);
  };
}

/* ---- morale ---- */
export function moraleCheck(state, e, { fromFlankOrRear = false } = {}) {
  const fleetOptions = fleetMoraleOptions(state, Q.sideOf(state, e));
  const r = SR.moraleCheck(state.world, e, state.random, {
    fromFlankOrRear, ...fleetOptions, ...moraleHooks(state),
  });
  return r ? r.passed : false; // null: dead or already routed, shipRules did nothing
}
export function contagion(state, src) {
  SR.contagion(state.world, src, state.random, {
    ...fleetMoraleOptions(state, Q.sideOf(state, src)), ...moraleHooks(state),
  });
}
export function destroy(state, e) {
  const side = Q.sideOf(state, e);
  SR.destroy(state.world, e, state.random, {
    onDestroyed: (v, wasFlag) => state.events.emit(BattleEvent.UNIT_DESTROYED,
      { unit: v, label: Q.labelOf(state, v), side: Q.sideOf(state, v), wasFlagship: wasFlag }),
    moraleCheckOpts: { ...fleetMoraleOptions(state, side), ...moraleHooks(state) },
    onFlagshipLost: flagshipLostHook(state, e),
  });
}

/* ---- firing ---- */
export function fire(state, e, tgt) {
  const side = Q.sideOf(state, e), tgtSide = Q.sideOf(state, tgt);
  const result = SR.fire(state.world, e, tgt, state.random, {
    supplyState: state.G.fleets[side].supply,
    onResolved: r => state.events.emit(BattleEvent.SHOT_RESOLVED, {
      attacker: e, attackerLabel: Q.labelOf(state, e), target: tgt, targetLabel: Q.labelOf(state, tgt),
      arc: r.arc, targetNumber: r.need, rolls: r.rolls, hits: r.hits, from: r.from, to: r.to, side,
    }),
    onHit: () => state.world.add(tgt, C.HitSinceAct, true),
    onDestroyed: (v, wasFlag) => state.events.emit(BattleEvent.UNIT_DESTROYED,
      { unit: v, label: Q.labelOf(state, v), side: Q.sideOf(state, v), wasFlagship: wasFlag }),
    moraleCheckOpts: { ...fleetMoraleOptions(state, tgtSide), ...moraleHooks(state) },
    onFlagshipLost: flagshipLostHook(state, tgt),
  });
  return { rolls: result.rolls, hits: result.hits, arc: result.arc, targetNumber: result.need };
}

/* ---- movement ---- */
export function turnToward(state, e, d) {
  const facing = state.world.get(e, C.Facing);
  const diff = ((d - facing.dir) % 6 + 6) % 6;
  facing.dir = (facing.dir + (diff <= 3 ? 1 : 5)) % 6;
}

export function rotateActivatedUnit(state, direction) {
  if (!Q.canMove(state)) return false;
  SR.turn(state.world, state.act.u, direction);
  state.act.mp--;
  state.act.moved = true;
  state.act.fireMode = false;
  return true;
}

function tryMoveActivatedUnit(state, { direction, movementPointCost }) {
  if (movementPointCost === MP_MAX ? !Q.canBack(state) : !Q.canMove(state)) return false;
  const entity = state.act.u;
  const res = SR.stepInto(state.world, entity, direction, {
    isBlocked: next => !inBounds(next[0], next[1]) || Q.occupiedSet(state).has(key(next[0], next[1])),
  });
  if (!res.ok) {
    if (res.reason === "shaken") {
      state.events.emit(BattleEvent.MOVE_REJECTED, {
        unit: entity, label: Q.labelOf(state, entity), reason: "shaken_advance",
      });
    }
    return false;
  }
  state.act.mp -= movementPointCost;
  state.act.moved = true;
  state.act.fireMode = false;
  return true;
}

export function moveActivatedUnitForward(state) {
  if (!state.act?.u) return false;
  return tryMoveActivatedUnit(state, {
    direction: Q.facingOf(state, state.act.u),
    movementPointCost: 1,
  });
}

export function moveActivatedUnitBackward(state) {
  if (!state.act?.u) return false;
  return tryMoveActivatedUnit(state, {
    direction: (Q.facingOf(state, state.act.u) + 3) % 6,
    movementPointCost: MP_MAX,
  });
}

export function desiredDir(fromPos, goal) {
  return directionToward(fromPos, goal);
}
export function aiStep(state, e) { // one MP toward nearest enemy; false if unusable
  const ne = Q.nearestEnemy(state, e);
  if (!ne) return false;
  const pos = Q.posOf(state, e), nePos = Q.posOf(state, ne);
  const d = desiredDir(pos, nePos);
  if (Q.facingOf(state, e) !== d) { turnToward(state, e, d); return true; }
  const nx = neighbor(pos, d);
  if (inBounds(nx[0], nx[1])
      && !Q.occupiedSet(state).has(key(nx[0], nx[1]))
      && hexDist(nx, nePos) < hexDist(pos, nePos)) { setPos(state, e, nx); return true; }
  return false;
}
export function flee(state, e) {
  const side = Q.sideOf(state, e);
  const d = side === Side.BLUE ? 3 : 0;
  for (let i = 0; i < MP_MAX; i++) {
    if (Q.facingOf(state, e) !== d) { turnToward(state, e, d); continue; }
    const nx = neighbor(Q.posOf(state, e), d);
    if (!inBounds(nx[0], nx[1])) {
      state.world.remove(e, C.Alive);
      state.events.emit(BattleEvent.UNIT_FLED, { unit: e, label: Q.labelOf(state, e), side });
      return;
    }
    if (!Q.occupiedSet(state).has(key(nx[0], nx[1]))) setPos(state, e, nx);
  }
}
export function routedActivation(state, e) { // shared by AI and human routed units
  if (!Q.hasHitSinceAct(state, e)) {
    const rally = resolveRally({ inCommand: Q.inCommand(state, e) }, state.random);
    if (rally.passed) {
      state.world.get(e, C.Morale).state = SHAKEN;
      state.world.remove(e, C.HitSinceAct);
      state.events.emit(BattleEvent.UNIT_RALLIED, {
        unit: e, label: Q.labelOf(state, e), roll: rally.roll, bonus: rally.bonus,
      });
      return;
    }
    state.events.emit(BattleEvent.RALLY_FAILED, {
      unit: e, label: Q.labelOf(state, e), roll: rally.roll, bonus: rally.bonus,
    });
  }
  state.world.remove(e, C.HitSinceAct);
  flee(state, e);
}
export function aiActivate(state, e) {
  if (!Q.isAlive(state, e)) return;
  if (Q.moraleOf(state, e) === ROUTED) { routedActivation(state, e); return; }
  state.world.remove(e, C.HitSinceAct);
  const side = Q.sideOf(state, e);
  const cmd = Q.inCommand(state, e), hold = HOLD_FORMS.has(state.G.fleets[side].name);
  let tgt = Q.pickTarget(state, e);
  if (Q.moraleOf(state, e) === SHAKEN) {
    if (!tgt && !hold) {
      const ne = Q.nearestEnemy(state, e);
      if (ne) { const d = desiredDir(Q.posOf(state, e), Q.posOf(state, ne)); if (Q.facingOf(state, e) !== d) turnToward(state, e, d); }
      tgt = cmd ? Q.pickTarget(state, e) : null;
    }
    if (tgt) fire(state, e, tgt);
    return;
  }
  if (tgt) { fire(state, e, tgt); return; }
  if (hold) {
    const ne = Q.nearestEnemy(state, e);
    if (ne && hexDist(Q.posOf(state, e), Q.posOf(state, ne)) <= RANGE + 1) {
      const d = desiredDir(Q.posOf(state, e), Q.posOf(state, ne)); if (Q.facingOf(state, e) !== d) turnToward(state, e, d);
    }
    if (cmd) { tgt = Q.pickTarget(state, e); if (tgt) fire(state, e, tgt); }
    return;
  }
  for (let i = 0; i < MP_MAX; i++) if (!aiStep(state, e)) break;
  if (cmd) { tgt = Q.pickTarget(state, e); if (tgt) fire(state, e, tgt); }
}
