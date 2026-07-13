// The star map's own per-ship combat/movement engine -- a faction-generic
// sibling to battle/queries.js + battle/systems.js, built the same way
// (pure functions over a battle/ecs.js World + battle/components.js keys),
// rather than an extension of either: those two files are hard-coded to
// exactly 2 sides via `state.G.fleets[0,1]` / `1 - side` arithmetic and a
// fixed alternating-turn activation model, none of which fits the map's 3
// independent factions and lack of any bounded "battle" (ships just live
// or die in an open sandbox, selected and commanded one at a time by
// whoever clicks them -- there's no player-identity concept on the map,
// same as everywhere else here). The bounded battle and open map therefore
// remain separate rule contexts even though they share core primitives.
//
// Reused as-is from battle/: the World class (battle/ecs.js, already
// generic), the component key constants (battle/components.js), the
// RANGE/CMD_R/MP_MAX/MoraleState tunables (battle/config.js), and the pure
// hex geometry (battle/hexmath.js) -- only the *rules code* built on top of
// those (roster/side lookups, fire, morale) is reimplemented here,
// faction-generically.
//
// Deliberately NOT ported (see the plan's scope cuts): AI auto-behavior
// (aiActivate/aiStep/flee/routedActivation -- a ship only ever does
// something when a player selects and commands it), the fleet-wide
// "supply" to-hit/morale modifier (no equivalent concept exists on the
// map), forced rout-facing (battle hard-codes "turn to face
// side===0?3:0", which assumes a fixed 2-sided battlefield orientation
// this open map doesn't have), and the whole round/turn-order/win-
// condition machinery (the map doesn't "end"). Both engines still share
// the same injected random-source contract so tests and replays can control
// every roll.
import { World } from "../battle/ecs.js";
import * as C from "../battle/components.js";
import { RANGE, CMD_R, MP_MAX, MoraleState } from "../battle/config.js";
import { hexDist, neighbor, inFireArc, incomingArc, losClear, key, argmin } from "../battle/hexmath.js";
import { MathRandomSource } from "../battle/core/random.js";

export { World, MP_MAX, MathRandomSource };

// --- component accessors ---------------------------------------------
export const posOf = (world, e) => { const p = world.get(e, C.Position); return [p.c, p.r]; };
export const facingOf = (world, e) => world.get(e, C.Facing).dir;
export const factionOf = (world, e) => world.get(e, C.Side).value;
export const strengthOf = (world, e) => world.get(e, C.Strength).value;
export const moraleOf = (world, e) => world.get(e, C.Morale).state;
export const labelOf = (world, e) => world.get(e, C.Label).id;
export const isFlagship = (world, e) => world.has(e, C.Flagship);
export const isAlive = (world, e) => world.has(e, C.Alive);
const setPos = (world, e, pos) => { const p = world.get(e, C.Position); p.c = pos[0]; p.r = pos[1]; };

// Direct reposition, no neighbor/occupancy/Shaken checks -- this is the
// "Set Course" command's own primitive (an instant long-distance jump,
// same instant-reposition semantics the old whole-fleet moveFleet had),
// deliberately separate from moveForward/moveBackward's ruled single-hex
// steps.
export function setPosition(world, e, c, r) { setPos(world, e, [c, r]); }

export function spawnShip(world, { faction, c, r, dir, isFlag, label }) {
  const e = world.createEntity();
  world.add(e, C.Position, { c, r });
  world.add(e, C.Facing, { dir });
  world.add(e, C.Side, { value: faction });
  world.add(e, C.Strength, { value: 4 });
  world.add(e, C.Morale, { state: MoraleState.STEADY });
  world.add(e, C.Label, { id: label });
  world.add(e, C.Alive, true);
  if (isFlag) world.add(e, C.Flagship, true);
  return e;
}

// --- faction-generic roster queries (replaces battle/queries.js's
// fleets[0,1]-indexed equivalents) -------------------------------------
export const aliveShips = world => world.query(C.Alive);
export const shipsOfFaction = (world, faction) => aliveShips(world).filter(e => factionOf(world, e) === faction);
export const enemiesOf = (world, faction) => aliveShips(world).filter(e => factionOf(world, e) !== faction);
export const friendsOf = (world, e) => shipsOfFaction(world, factionOf(world, e)).filter(v => v !== e);
export const flagshipOf = (world, faction) => shipsOfFaction(world, faction).find(e => isFlagship(world, e)) ?? null;

export function inCommand(world, e) {
  const fl = flagshipOf(world, factionOf(world, e));
  return fl !== null && hexDist(posOf(world, e), posOf(world, fl)) <= CMD_R;
}
// `extraObstacles` (a Set of "c,r" keys, or undefined) folds in terrain
// this engine itself has no concept of -- currently just the star map's
// asteroid field (see beltAsteroidHexes in map/main.js). Kept optional
// and additive rather than teaching this module what an asteroid is, so
// it stays the same faction/terrain-agnostic hex engine described in the
// file header; the caller decides what else blocks a hex.
export function occupiedSet(world, extraObstacles) {
  const s = new Set(extraObstacles || []);
  for (const e of aliveShips(world)) { const [c, r] = posOf(world, e); s.add(key(c, r)); }
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

// --- activation predicates ---------------------------------------------
// Mirror battle/queries.js:71-83, but read a plain {u,mp,moved,fired,cmd}
// object the caller (map/main.js) owns directly, instead of a shared
// `state.act` -- there's no `canSwitchSelection` here (see the file
// header: switching is always allowed on this open map, nothing to
// protect a "commitment" from).
export function canMove(act) {
  return !!(act && act.u != null && act.mp > 0 && (act.cmd || !act.fired));
}
export function canBack(act) {
  return canMove(act) && act.mp >= MP_MAX;
}
export function canFire(world, act, extraObstacles) {
  return !!(act && act.u != null && !act.fired && (act.cmd || !act.moved) && legalTargets(world, act.u, extraObstacles).length > 0);
}

// --- movement ------------------------------------------------------------
export function turn(world, e, dir) {
  const facing = world.get(e, C.Facing);
  facing.dir = (facing.dir + dir + 6) % 6;
}
// Both return {ok:true} or {ok:false, reason:"blocked"|"shaken"} -- the
// caller (map/main.js) turns `reason` into hint text; neither mutates MP,
// that's the caller's own activation bookkeeping (mirroring how
// turnEngine.js's doForward/doBackward, not systems.js, own `act.mp`).
function stepInto(world, e, dir, extraObstacles) {
  const pos = posOf(world, e);
  const nx = neighbor(pos, dir);
  if (occupiedSet(world, extraObstacles).has(key(nx[0], nx[1]))) return { ok: false, reason: "blocked" };
  if (moraleOf(world, e) === MoraleState.SHAKEN) {
    const ne = nearestEnemy(world, e);
    if (ne && hexDist(nx, posOf(world, ne)) < hexDist(pos, posOf(world, ne))) return { ok: false, reason: "shaken" };
  }
  setPos(world, e, nx);
  return { ok: true };
}
export const moveForward = (world, e, extraObstacles) => stepInto(world, e, facingOf(world, e), extraObstacles);
export const moveBackward = (world, e, extraObstacles) => stepInto(world, e, (facingOf(world, e) + 3) % 6, extraObstacles);

// --- morale / destruction (battle/systems.js:17-54, supply/flagLost/
// forced-rout-facing dropped per the file header's scope cuts) -----------
export function moraleCheck(world, e, fromFlankOrRear, random) {
  if (!isAlive(world, e) || moraleOf(world, e) === MoraleState.ROUTED) return;
  const pos = posOf(world, e);
  let mod = 0;
  if (friendsOf(world, e).some(v => moraleOf(world, v) === MoraleState.STEADY && hexDist(pos, posOf(world, v)) === 1)) mod++;
  if (inCommand(world, e)) mod++;
  if (fromFlankOrRear) mod--;
  if (random.d6() + mod >= 4) return;
  const morale = world.get(e, C.Morale);
  if (morale.state === MoraleState.STEADY) morale.state = MoraleState.SHAKEN;
  else { morale.state = MoraleState.ROUTED; contagion(world, e, random); }
}
export function contagion(world, src, random) {
  for (const v of friendsOf(world, src).slice())
    if (isAlive(world, v) && moraleOf(world, v) !== MoraleState.ROUTED && hexDist(posOf(world, v), posOf(world, src)) <= 2)
      moraleCheck(world, v, false, random);
}
export function destroy(world, e, random) {
  world.remove(e, C.Alive);
  const wasFlag = isFlagship(world, e), faction = factionOf(world, e);
  contagion(world, e, random);
  if (wasFlag) for (const v of shipsOfFaction(world, faction)) moraleCheck(world, v, false, random);
}

// --- firing (battle/systems.js:57-78, supply to-hit penalty dropped) ----
// Returns both rule resolution and presentation coordinates. The caller may
// create a tracer, sound, or UI message; this headless module owns none of it.
export function fire(world, e, tgt, random) {
  const strength = strengthOf(world, e);
  const dice = moraleOf(world, e) === MoraleState.STEADY ? strength : Math.ceil(strength / 2);
  const arc = incomingArc(posOf(world, tgt), facingOf(world, tgt), posOf(world, e));
  const need = { front: 5, flank: 4, rear: 3 }[arc];
  let hits = 0; const rolls = [];
  for (let i = 0; i < dice; i++) { const roll = random.d6(); rolls.push(roll); if (roll >= need) hits++; }
  const from = posOf(world, e), to = posOf(world, tgt);
  let destroyed = false;
  if (hits) {
    const tgtStrength = world.get(tgt, C.Strength);
    tgtStrength.value = Math.max(0, tgtStrength.value - hits);
    if (tgtStrength.value === 0) { destroy(world, tgt, random); destroyed = true; }
    else moraleCheck(world, tgt, arc !== "front", random);
  }
  return { hits, rolls, arc, need, destroyed, from, to };
}
