// Every read-only, derived lookup over the ECS world -- nothing here
// mutates a component. Thin adapters over battle/core/shipRules.js (the
// actual ship-rules engine, shared with the star map) that translate this
// screen's `state`/`state.act` shape into shipRules' plain `world`/`act`
// arguments; every exported name and (state, ...) signature here is
// unchanged from before that extraction, so nothing elsewhere in
// battle/*.js needs to know this delegates anywhere. shipRules' derived
// queries (enemiesOf, friendsOf, ...) scan the World's own Alive store,
// whose Map-insertion order exactly matches this file's roster-array
// order (both are built by the same sequential spawnUnit/deployFormation
// loop, and neither ever reorders) -- so this delegation changes nothing
// observable, including AI tie-break behavior or event/dice-roll
// sequencing.
import { hexDist } from "./hexmath.js";
import * as C from "./components.js";
import * as SR from "./core/shipRules.js";

// --- component accessors --------------------------------------------------
export const posOf = (state, e) => SR.posOf(state.world, e);
export const facingOf = (state, e) => SR.facingOf(state.world, e);
export const sideOf = (state, e) => SR.factionOf(state.world, e);
export const strengthOf = (state, e) => SR.strengthOf(state.world, e);
export const moraleOf = (state, e) => SR.moraleOf(state.world, e);
export const labelOf = (state, e) => SR.labelOf(state.world, e);
export const isFlagship = (state, e) => SR.isFlagship(state.world, e);
export const isMainFleet = (state, e) => SR.isMainFleet(state.world, e);
export const isAlive = (state, e) => SR.isAlive(state.world, e);
export const isActivated = (state, e) => state.world.has(e, C.Activated);
export const hasHitSinceAct = (state, e) => state.world.has(e, C.HitSinceAct);

// --- roster / fleet queries ------------------------------------------------
// Turn-engine bookkeeping, not ship rules -- stays roster-array-based
// (there's no equivalent concept in shipRules.js, which has no notion of
// a fixed activation order to iterate).
export const unitsOfSide = (state, side) => state.G.fleets[side].roster;
export const aliveOfSide = (state, side) => unitsOfSide(state, side).filter(e => isAlive(state, e));
export const losses = (state, side) => unitsOfSide(state, side).filter(e => !isAlive(state, e)).length;
export const unactivatedOfSide = (state, side) => aliveOfSide(state, side).filter(e => !isActivated(state, e));

export const occupiedSet = state => SR.occupiedSet(state.world);
export const flagshipOf = (state, side) => SR.flagshipOf(state.world, side);
export const mainFleetOf = (state, side) => SR.mainFleetOf(state.world, side);
export const inCommand = (state, e) => SR.inCommand(state.world, e);
export const enemiesOf = (state, side) => SR.enemiesOf(state.world, side);
export const friendsOf = (state, e) => SR.friendsOf(state.world, e);
export const nearestEnemy = (state, e) => SR.nearestEnemy(state.world, e);
export const legalTargets = (state, e) => SR.legalTargets(state.world, e);

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
// Pure reads of `state.act`; shared by lifecycle and presentation code.
export function canSwitchSelection(state) {
  return !!(state.act && state.act.u != null && !state.act.moved && !state.act.fired);
}
export const canMove = state => SR.canMove(state.act);
export const canTurn = state => SR.canTurn(state.act);
export const canBack = state => SR.canBack(state.act); // backward = the whole move
export const canFire = state => SR.canFire(state.world, state.act);
