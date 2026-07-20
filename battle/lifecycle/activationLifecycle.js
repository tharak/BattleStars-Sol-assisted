import { MP_MAX, MoraleState } from "../config.js";
import {
  fire, routedActivation, rotateActivatedUnit,
  moveActivatedUnitForward, moveActivatedUnitBackward,
} from "../systems.js";
import * as C from "../components.js";
import * as Q from "../queries.js";

export function selectUnit(context, entity) {
  const activation = context.act;
  if (!activation || activation.u != null || Q.sideOf(context, entity) !== activation.side
      || Q.isActivated(context, entity) || !Q.isAlive(context, entity)) return { selected: false };
  context.world.add(entity, C.Activated, true);
  context.G.lastActed = Q.sideOf(context, entity);
  if (Q.moraleOf(context, entity) === MoraleState.ROUTED) {
    routedActivation(context, entity);
    context.act = null;
    return { selected: true, activationEnded: true };
  }
  context.world.remove(entity, C.HitSinceAct);
  Object.assign(activation, {
    u: entity,
    mp: MP_MAX + (context.world.get(entity, C.Captain)?.abilityId === "full_throttle" ? 1 : 0), turns: 0,
    maxTurns: context.world.get(entity, C.Captain)?.abilityId === "master_helmsman" ? 3 : undefined,
    backwardCost: context.world.get(entity, C.Captain)?.abilityId === "retro_thrusters" ? 2 : undefined,
    moved: false,
    fired: false,
    fireMode: false,
    cmd: Q.inCommand(context, entity),
  });
  return { selected: true, activationEnded: false };
}

export function switchSelectedUnit(context, entity) {
  if (!Q.canSwitchSelection(context) || entity === context.act.u) return { selected: false };
  context.world.remove(context.act.u, C.Activated);
  context.act.u = null;
  return selectUnit(context, entity);
}

export function turnSelectedUnit(context, { direction }) {
  return rotateActivatedUnit(context, direction);
}

export function moveSelectedUnitForward(context) {
  return moveActivatedUnitForward(context);
}

export function moveSelectedUnitBackward(context) {
  return moveActivatedUnitBackward(context);
}

export function enterFireMode(context) {
  if (!Q.canFire(context)) return false;
  context.act.fireMode = true;
  return true;
}

export function fireSelectedUnit(context, target) {
  if (!Q.canFire(context) || !Q.legalTargets(context, context.act.u).includes(target)) {
    return { fired: false, activationEnded: false };
  }
  fire(context, context.act.u, target);
  context.act.fired = true;
  context.act.fireMode = false;
  return { fired: true, activationEnded: false };
}

export function endSelectedActivation(context) {
  if (!context.act || context.act.u == null) return false;
  context.act = null;
  return true;
}
