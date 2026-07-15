// The actual ship ruleset: movement, firing, morale/destruction, legal-
// target arcs/LOS -- pure functions over a battle/ecs.js World +
// battle/components.js keys, with no idea what "side 0/1", "a fleet
// roster", "turn order", or "AI" are. This is the ONE real
// implementation; both battle/queries.js+battle/systems.js (the 2-side,
// turn-based tactical screen) and map/main.js (the open, turn-less,
// N-faction star map) run on it directly, each supplying only the bits
// that are genuinely different about their own context via the optional
// hooks below (onHit/onRouted/onFlagshipLost,
// isBlocked) -- not by reimplementing the dice/arc/morale logic a second
// time. Roster bookkeeping, turn order, AI behavior, supply, and forced
// rout-facing are battle-only concerns and stay in battle/*.js.
import { World } from "../ecs.js";
import * as C from "../components.js";
import { RANGE, CMD_R, MP_MAX } from "../config.js";
import { FLEET_FORMATION_NAMES } from "../fleetShips.js";
import { FiringArc, MoraleState, SupplyState } from "../domain/constants.js";
import { resolveCombat } from "../domain/combatRules.js";
import { moraleStateAfterCheck, moraleStateAfterEnemyDestroyed, resolveMorale } from "../domain/moraleRules.js";
import {
  canMoveDuringActivation, canTurnDuringActivation, canMoveBackwardDuringActivation, evaluateMovementStep,
} from "../domain/movementRules.js";
import { hexDist, neighbor, inFireArc, incomingArc, losClear, key, argmin } from "../hexmath.js";

export { World, MP_MAX };

// --- component accessors ---------------------------------------------
export const posOf = (world, e) => { const p = world.get(e, C.Position); return [p.c, p.r]; };
export const facingOf = (world, e) => world.get(e, C.Facing).dir;
export const factionOf = (world, e) => world.get(e, C.Side).value;
export const strengthOf = (world, e) => world.get(e, C.Strength).value;
export const fleetFormationOf = (world, e) => world.get(e, C.FleetFormation)?.name || "sphere";
export const setFleetFormation = (world, e, name) => {
  if (!FLEET_FORMATION_NAMES.includes(name)) return false;
  const current = world.get(e, C.FleetFormation);
  if (current) current.name = name;
  else world.add(e, C.FleetFormation, { name });
  return true;
};
export const moraleOf = (world, e) => world.get(e, C.Morale).state;
export const labelOf = (world, e) => world.get(e, C.Label).id;
export const isFlagship = (world, e) => world.has(e, C.Flagship);
export const isMainFleet = isFlagship;
export const isAlive = (world, e) => world.has(e, C.Alive);
const setPos = (world, e, pos) => { const p = world.get(e, C.Position); p.c = pos[0]; p.r = pos[1]; };

// Direct reposition, no neighbor/occupancy/Shaken checks -- the star
// map's own "Set Course" primitive (an instant long-distance jump);
// battle has no equivalent (its board is small enough hex-by-hex
// movement covers it), but this is cheap enough to live here rather
// than force map/main.js to reach into World internals itself.
export function setPosition(world, e, c, r) { setPos(world, e, [c, r]); }

export function spawnFleet(world, { faction, c, r, dir, isFlagship = false, isMainFleet = isFlagship, label, formation = "sphere" }) {
  const e = world.createEntity();
  world.add(e, C.Position, { c, r });
  world.add(e, C.Facing, { dir });
  world.add(e, C.Side, { value: faction });
  world.add(e, C.Strength, { value: 4 });
  world.add(e, C.FleetFormation, { name: formation });
  world.add(e, C.Morale, { state: MoraleState.STEADY });
  world.add(e, C.Label, { id: label });
  world.add(e, C.Alive, true);
  if (isMainFleet) world.add(e, C.Flagship, true);
  return e;
}
// Compatibility alias for headless callers while the game-wide Armada/Fleet
// vocabulary migrates. New production code should call spawnFleet.
export const spawnShip = spawnFleet;

// --- faction-generic roster queries -------------------------------------
export const aliveFleets = world => world.query(C.Alive);
export const fleetsOfFaction = (world, faction) => aliveFleets(world).filter(e => factionOf(world, e) === faction);
export const enemiesOf = (world, faction) => aliveFleets(world).filter(e => factionOf(world, e) !== faction);
export const friendsOf = (world, e) => fleetsOfFaction(world, factionOf(world, e)).filter(v => v !== e);
export const flagshipOf = (world, faction) => fleetsOfFaction(world, faction).find(e => isFlagship(world, e)) ?? null;
export const mainFleetOf = flagshipOf;
// Compatibility aliases for callers still using the old singular Ship model.
export const aliveShips = aliveFleets;
export const shipsOfFaction = fleetsOfFaction;

// Returns only the living Fleets whose morale actually improved, so callers
// can present the faction-wide reward without re-deriving state changes.
export function recoverMoraleAfterEnemyDestroyed(world, faction) {
  const recovered = [];
  for (const fleet of fleetsOfFaction(world, faction)) {
    const morale = world.get(fleet, C.Morale);
    const from = morale.state;
    const to = moraleStateAfterEnemyDestroyed(from);
    if (to === from) continue;
    morale.state = to;
    recovered.push({ fleet, from, to });
  }
  return recovered;
}

export function inCommand(world, e) {
  const fl = flagshipOf(world, factionOf(world, e));
  return fl !== null && hexDist(posOf(world, e), posOf(world, fl)) <= CMD_R;
}
// `extraObstacles` (a Set of "c,r" keys, or undefined) folds in terrain
// this module has no concept of -- currently just the star map's
// asteroid field. Kept optional and additive rather than teaching this
// module what an asteroid is; the caller decides what else blocks a hex.
export function occupiedSet(world, extraObstacles) {
  const s = new Set(extraObstacles || []);
  for (const e of aliveFleets(world)) { const [c, r] = posOf(world, e); s.add(key(c, r)); }
  return s;
}
export function nearestEnemy(world, e) {
  const en = enemiesOf(world, factionOf(world, e));
  return en.length ? argmin(en, x => hexDist(posOf(world, e), posOf(world, x))) : null;
}
export function legalTargets(world, e, extraObstacles) {
  const occ = occupiedSet(world, extraObstacles);
  const pos = posOf(world, e), facing = facingOf(world, e);
  return enemiesOf(world, factionOf(world, e)).filter(x => {
    const xp = posOf(world, x);
    return hexDist(pos, xp) <= RANGE && inFireArc(facing, pos, xp) && losClear(pos, xp, occ);
  });
}

// --- activation predicates -----------------------------------------------
// Read a plain {u,mp,moved,fired,cmd} object -- battle's own state.act has
// this shape as a subset (plus turn-order fields this module doesn't
// care about), so battle/queries.js just passes state.act straight
// through.
export function canMove(act) {
  return canMoveDuringActivation(act);
}
export function canTurn(act) {
  return canTurnDuringActivation(act);
}
export function canBack(act) {
  return canMoveBackwardDuringActivation(act);
}
export function canFire(world, act, extraObstacles) {
  return !!(act && act.u != null && !act.fired && legalTargets(world, act.u, extraObstacles).length > 0);
}

// --- movement --------------------------------------------------------------
export function turn(world, e, dir) {
  const facing = world.get(e, C.Facing);
  facing.dir = (facing.dir + dir + 6) % 6;
}
// The hex a forward/backward step would land on, without moving anything.
export const forwardHex = (world, e) => neighbor(posOf(world, e), facingOf(world, e));
export const backwardHex = (world, e) => neighbor(posOf(world, e), (facingOf(world, e) + 3) % 6);

// `isBlocked(nextPos)`, if given, is checked before the universal Shaken-
// refusal rule -- battle passes board-bounds + ship-occupancy; the star
// map passes ship occupancy while terrain only costs MP, a concern
// map/main.js owns entirely outside this module. Returns
// {ok:true} or {ok:false, reason:"blocked"|"shaken"}; never mutates MP,
// that bookkeeping belongs to each caller's own activation object.
export function stepInto(world, e, dir, { isBlocked } = {}) {
  const pos = posOf(world, e);
  const nx = neighbor(pos, dir);
  const nearest = nearestEnemy(world, e);
  const result = evaluateMovementStep({
    moraleState: moraleOf(world, e),
    currentPosition: pos,
    nextPosition: nx,
    nearestEnemyPosition: nearest === null ? null : posOf(world, nearest),
    blocked: !!isBlocked?.(nx),
  });
  if (!result.ok) return result;
  setPos(world, e, nx);
  return { ok: true };
}
export const moveForward = (world, e, opts) => stepInto(world, e, facingOf(world, e), opts);
export const moveBackward = (world, e, opts) => stepInto(world, e, (facingOf(world, e) + 3) % 6, opts);

// --- morale / destruction ------------------------------------------------
// Supply and flagship state arrive as named options from the owning game
// context. `onChecked(e, result)` fires for
// EVERY completed check (pass or fail), right after the roll -- before
// any state mutation -- which is what battle uses to emit its
// MORALE_CHECKED log line for each check, including cascade checks
// triggered below; `onRouted(e)` fires once, right when a unit newly
// transitions to ROUTED (state already mutated, but before the cascade),
// which battle uses for its forced rout-facing + UNIT_ROUTED event. The
// star map leaves both undefined. Returns null if no check actually
// happened (dead, or already routed), else the roll and each individual
// modifier flag so a caller can rebuild its own human-readable "why"
// breakdown (battle's MORALE_CHECKED log line) including whatever extra
// modifiers it added on top.
export function moraleCheck(world, e, random, {
  fromFlankOrRear = false,
  supplyState = SupplyState.NORMAL,
  flagshipLost = false,
  onRouted,
  onChecked,
} = {}) {
  if (!isAlive(world, e) || moraleOf(world, e) === MoraleState.ROUTED) return null;
  const pos = posOf(world, e);
  const supportBonus = friendsOf(world, e).some(v => moraleOf(world, v) === MoraleState.STEADY && hexDist(pos, posOf(world, v)) === 1);
  const commandBonus = inCommand(world, e);
  const result = resolveMorale({
    steadyFriendAdjacent: supportBonus,
    inCommand: commandBonus,
    fromFlankOrRear,
    supplyState,
    flagshipLost,
  }, random);
  onChecked?.(e, result);
  if (!result.passed) {
    const morale = world.get(e, C.Morale);
    morale.state = moraleStateAfterCheck({ currentState: morale.state, passed: result.passed });
    if (morale.state === MoraleState.ROUTED) {
      onRouted?.(e);
      contagion(world, e, random, {
        supplyState, flagshipLost, onRouted, onChecked,
      });
    }
  }
  return result;
}
export function contagion(world, src, random, moraleCheckOpts) {
  for (const v of friendsOf(world, src).slice())
    if (isAlive(world, v) && moraleOf(world, v) !== MoraleState.ROUTED && hexDist(posOf(world, v), posOf(world, src)) <= 2)
      moraleCheck(world, v, random, moraleCheckOpts);
}
// `onDestroyed(e, wasFlagship, faction)` fires right when the kill is
// applied, before the contagion cascade -- battle uses it to emit
// UNIT_DESTROYED at the right point in the event stream.
// `onFlagshipLost(faction)`, if the destroyed ship was a flagship, is the
// caller's cue to do whatever fleet-wide bookkeeping/morale sweep its own
// context needs (battle sets flagLost + emits FLAGSHIP_LOST + morale-
// checks the whole side, using its own roster -- this module has no
// roster to iterate); the star map leaves both undefined.
export function destroy(world, e, random, { onDestroyed, onFlagshipLost, moraleCheckOpts } = {}) {
  world.remove(e, C.Alive);
  const wasFlag = isFlagship(world, e), faction = factionOf(world, e);
  onDestroyed?.(e, wasFlag, faction);
  contagion(world, e, random, moraleCheckOpts);
  if (wasFlag) onFlagshipLost?.(faction);
}

// --- firing ----------------------------------------------------------------
// Returns rule resolution + presentation coordinates; the caller may
// create a tracer, sound, log line, or UI message -- this headless
// function owns none of it. Supply is explicit so the pure combat
// calculation can apply the critical-supply target-number rule. `onResolved(result)`
// fires right after the dice are rolled, before any strength/morale/
// destroy consequence is applied -- battle uses it to emit SHOT_RESOLVED
// at the correct point in the sequence, ahead of anything the shot
// triggers. `onHit(tgt)` fires once if hits > 0, right after that
// (battle marks C.HitSinceAct for its AI rally logic). `onDestroyed`/
// `onFlagshipLost`/`moraleCheckOpts` thread straight through to the
// moraleCheck/destroy this can trigger, so those events keep firing in
// the same relative order as everything above them. `onEnemyDestroyed`
// runs after the defender's destruction, contagion, and flagship effects.
export function fire(world, e, tgt, random, {
  supplyState = SupplyState.NORMAL,
  onResolved,
  onHit,
  onDestroyed,
  onEnemyDestroyed,
  moraleCheckOpts,
  onFlagshipLost,
} = {}) {
  const strength = strengthOf(world, e);
  const arc = incomingArc(posOf(world, tgt), facingOf(world, tgt), posOf(world, e));
  const { hits, rolls, need } = resolveCombat({
    strength,
    moraleState: moraleOf(world, e),
    targetArc: arc,
    supplyState,
  }, random);
  const from = posOf(world, e), to = posOf(world, tgt);
  onResolved?.({ hits, rolls, arc, need, from, to });
  let destroyed = false;
  if (hits) {
    onHit?.(tgt);
    const tgtStrength = world.get(tgt, C.Strength);
    tgtStrength.value = Math.max(0, tgtStrength.value - hits);
    if (tgtStrength.value === 0) {
      const destroyedFaction = factionOf(world, tgt);
      destroy(world, tgt, random, { onDestroyed, onFlagshipLost, moraleCheckOpts });
      destroyed = true;
      onEnemyDestroyed?.({ attacker: e, destroyed: tgt, attackerFaction: factionOf(world, e), destroyedFaction });
    }
    else moraleCheck(world, tgt, random, { ...moraleCheckOpts, fromFlankOrRear: arc !== FiringArc.FRONT });
  }
  return { hits, rolls, arc, need, destroyed, from, to };
}
