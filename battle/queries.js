// Every read-only, derived lookup over the ECS world -- nothing here
// mutates a component.
import { hexDist, losClear, inFireArc, key as hexKey, argmin } from "./hexmath.js";
import { RANGE, CMD_R, MP_MAX } from "./config.js";
import * as C from "./components.js";

// --- component accessors --------------------------------------------------
export const posOf = (state, e) => { const p = state.world.get(e, C.Position); return [p.c, p.r]; };
export const facingOf = (state, e) => state.world.get(e, C.Facing).dir;
export const sideOf = (state, e) => state.world.get(e, C.Side).value;
export const strengthOf = (state, e) => state.world.get(e, C.Strength).value;
export const moraleOf = (state, e) => state.world.get(e, C.Morale).state;
export const labelOf = (state, e) => state.world.get(e, C.Label).id;
export const isFlagship = (state, e) => state.world.has(e, C.Flagship);
export const isAlive = (state, e) => state.world.has(e, C.Alive);
export const isActivated = (state, e) => state.world.has(e, C.Activated);
export const hasHitSinceAct = (state, e) => state.world.has(e, C.HitSinceAct);

// --- roster / fleet queries ------------------------------------------------
export const unitsOfSide = (state, side) => state.G.fleets[side].roster;
export const aliveOfSide = (state, side) => unitsOfSide(state, side).filter(e => isAlive(state, e));
export const losses = (state, side) => unitsOfSide(state, side).filter(e => !isAlive(state, e)).length;
export const unactivatedOfSide = (state, side) => aliveOfSide(state, side).filter(e => !isActivated(state, e));

export function occupiedSet(state) {
  const s = new Set();
  for (const side of [0, 1]) for (const e of aliveOfSide(state, side)) {
    const [c, r] = posOf(state, e);
    s.add(hexKey(c, r));
  }
  return s;
}
export function flagshipOf(state, side) {
  return aliveOfSide(state, side).find(e => isFlagship(state, e)) ?? null;
}
export function inCommand(state, e) {
  const fl = flagshipOf(state, sideOf(state, e));
  return fl !== null && hexDist(posOf(state, e), posOf(state, fl)) <= CMD_R;
}
export const enemiesOf = (state, side) => aliveOfSide(state, 1 - side);
export const friendsOf = (state, e) => aliveOfSide(state, sideOf(state, e)).filter(v => v !== e);

export function nearestEnemy(state, e) {
  const en = enemiesOf(state, sideOf(state, e));
  return en.length ? argmin(en, x => hexDist(posOf(state, e), posOf(state, x))) : null;
}

export function legalTargets(state, e) {
  const occ = occupiedSet(state);
  const pos = posOf(state, e), facing = facingOf(state, e);
  return enemiesOf(state, sideOf(state, e)).filter(x => {
    const xp = posOf(state, x);
    return hexDist(pos, xp) <= RANGE && inFireArc(facing, pos, xp) && losClear(pos, xp, occ);
  });
}

export function pickTarget(state, e) { // AI: nearest, tiebreak lowest strength
  const ts = legalTargets(state, e);
  if (!ts.length) return null;
  const pos = posOf(state, e);
  return ts.reduce((b, x) => {
    const kb = [hexDist(pos, posOf(state, b)), strengthOf(state, b)];
    const kx = [hexDist(pos, posOf(state, x)), strengthOf(state, x)];
    return (kx[0] < kb[0] || (kx[0] === kb[0] && kx[1] < kb[1])) ? x : b;
  });
}

// --- current-activation predicates -----------------------------------------
// Pure reads of `state.act`; live here (not in turnEngine.js) so both
// turnEngine.js and panels.js can depend on them without a module cycle.
export function canSwitchSelection(state) {
  return !!(state.act && state.act.u != null && !state.act.moved && !state.act.fired);
}
export function canMove(state) {
  return !!(state.act && state.act.u != null && state.act.mp > 0 && (state.act.cmd || !state.act.fired));
}
export function canBack(state) {
  return canMove(state) && state.act.mp >= MP_MAX; // backward = the whole move
}
export function canFire(state) {
  return !!(state.act && state.act.u != null && !state.act.fired && (state.act.cmd || !state.act.moved)
    && legalTargets(state, state.act.u).length > 0);
}
