// Every *mutating* system: movement, firing, morale/destruction, and the AI
// activation orchestration built out of them. No UI/turn-flow knowledge
// lives here (no `act`, no draw()/updatePanels() calls) -- callers handle
// rendering and activation bookkeeping after invoking a system.
import { log } from "./panels.js";
import { hexDist, neighbor, angleBetween, argmin, range, DIR_ANGLE, key, incomingArc } from "./hexmath.js";
import { COLS, ROWS, RANGE, MP_MAX, HOLD_FORMS, MoraleState, sideName, sideCls } from "./config.js";
import { LASER_DURATION } from "./dimensions.js";
import * as C from "./components.js";
import * as Q from "./queries.js";

const { STEADY, SHAKEN, ROUTED } = MoraleState;
const d6 = () => 1 + Math.floor(Math.random() * 6);
const setPos = (state, e, pos) => { const p = state.world.get(e, C.Position); p.c = pos[0]; p.r = pos[1]; };

/* ---- morale ---- */
export function moraleCheck(state, e, fromFR) {
  if (!Q.isAlive(state, e) || Q.moraleOf(state, e) === ROUTED) return;
  const pos = Q.posOf(state, e), side = Q.sideOf(state, e);
  let mod = 0, why = [];
  if (Q.friendsOf(state, e).some(v => Q.moraleOf(state, v) === STEADY && hexDist(pos, Q.posOf(state, v)) === 1)) { mod++; why.push("+1 support"); }
  if (Q.inCommand(state, e)) { mod++; why.push("+1 command"); }
  if (fromFR) { mod--; why.push("−1 flanked"); }
  if (state.G.fleets[side].supply !== "ok") { mod--; why.push("−1 supply"); }
  if (state.G.fleets[side].flagLost) { mod--; why.push("−1 flagship"); }
  const roll = d6(), tot = roll + mod, pass = tot >= 4;
  log(`  ${Q.labelOf(state, e)} morale: ${roll}${why.length ? " " + why.join(" ") : ""} = ${tot} → ${pass ? "holds" : "FAILS"}`,
      pass ? null : "bad");
  if (pass) return;
  const morale = state.world.get(e, C.Morale);
  if (morale.state === STEADY) { morale.state = SHAKEN; }
  else {
    morale.state = ROUTED;
    state.world.get(e, C.Facing).dir = side === 0 ? 3 : 0;
    log(`  ${Q.labelOf(state, e)} ROUTS!`, "bad");
    contagion(state, e);
  }
}
export function contagion(state, src) {
  for (const v of Q.friendsOf(state, src).slice())
    if (Q.isAlive(state, v) && Q.moraleOf(state, v) !== ROUTED && hexDist(Q.posOf(state, v), Q.posOf(state, src)) <= 2)
      moraleCheck(state, v, false);
}
export function destroy(state, e) {
  state.world.remove(e, C.Alive);
  log(`  ${Q.labelOf(state, e)} is DESTROYED`, "bad");
  const wasFlag = Q.isFlagship(state, e), side = Q.sideOf(state, e);
  contagion(state, e);
  if (wasFlag) {
    state.G.fleets[side].flagLost = true;
    log(`  ${sideName(side)} FLAGSHIP LOST — fleet-wide morale check, command net down`, "bad");
    for (const v of Q.aliveOfSide(state, side)) moraleCheck(state, v, false);
  }
}

/* ---- firing ---- */
export function fire(state, e, tgt) {
  const strength = Q.strengthOf(state, e);
  const dice = Q.moraleOf(state, e) === STEADY ? strength : Math.ceil(strength / 2);
  const arc = incomingArc(Q.posOf(state, tgt), Q.facingOf(state, tgt), Q.posOf(state, e));
  let need = { front: 5, flank: 4, rear: 3 }[arc];
  if (state.G.fleets[Q.sideOf(state, e)].supply === "critical") need++;
  let hits = 0; const rolls = [];
  for (let i = 0; i < dice; i++) { const r = d6(); rolls.push(r); if (r >= need) hits++; }
  log(`${Q.labelOf(state, e)} fires at ${Q.labelOf(state, tgt)} (${arc} arc, ${need}+): [${rolls.join(" ")}] → ${hits} hit${hits === 1 ? "" : "s"}`,
      hits ? sideCls(Q.sideOf(state, e)) : null);
  state.effects.push({
    type: "laser", from: Q.posOf(state, e), to: Q.posOf(state, tgt),
    side: Q.sideOf(state, e), hit: hits > 0,
    start: performance.now(), dur: hits > 0 ? LASER_DURATION.hit : LASER_DURATION.miss,
  });
  if (!hits) return;
  const tgtStrength = state.world.get(tgt, C.Strength);
  tgtStrength.value = Math.max(0, tgtStrength.value - hits);
  state.world.add(tgt, C.HitSinceAct, true);
  if (tgtStrength.value === 0) destroy(state, tgt);
  else moraleCheck(state, tgt, arc !== "front");
}

/* ---- movement ---- */
export function turnToward(state, e, d) {
  const facing = state.world.get(e, C.Facing);
  const diff = ((d - facing.dir) % 6 + 6) % 6;
  facing.dir = (facing.dir + (diff <= 3 ? 1 : 5)) % 6;
}
export function desiredDir(fromPos, goal) {
  const ang = angleBetween(fromPos, goal);
  return argmin(range(0, 5), d => Math.abs(((DIR_ANGLE[d] - ang + 180) % 360 + 360) % 360 - 180));
}
export function aiStep(state, e) { // one MP toward nearest enemy; false if unusable
  const ne = Q.nearestEnemy(state, e);
  if (!ne) return false;
  const pos = Q.posOf(state, e), nePos = Q.posOf(state, ne);
  const d = desiredDir(pos, nePos);
  if (Q.facingOf(state, e) !== d) { turnToward(state, e, d); return true; }
  const nx = neighbor(pos, d);
  if (nx[0] >= 0 && nx[0] < COLS && nx[1] >= 0 && nx[1] < ROWS
      && !Q.occupiedSet(state).has(key(nx[0], nx[1]))
      && hexDist(nx, nePos) < hexDist(pos, nePos)) { setPos(state, e, nx); return true; }
  return false;
}
export function flee(state, e) {
  const side = Q.sideOf(state, e);
  const d = side === 0 ? 3 : 0;
  for (let i = 0; i < MP_MAX; i++) {
    if (Q.facingOf(state, e) !== d) { turnToward(state, e, d); continue; }
    const nx = neighbor(Q.posOf(state, e), d);
    if (nx[0] < 0 || nx[0] >= COLS || nx[1] < 0 || nx[1] >= ROWS) {
      state.world.remove(e, C.Alive);
      log(`  ${Q.labelOf(state, e)} flees off the map`, "bad");
      return;
    }
    if (!Q.occupiedSet(state).has(key(nx[0], nx[1]))) setPos(state, e, nx);
  }
}
export function routedActivation(state, e) { // shared by AI and human routed units
  if (!Q.hasHitSinceAct(state, e)) {
    const bonus = Q.inCommand(state, e) ? 1 : 0, r = d6();
    if (r + bonus >= 4) {
      state.world.get(e, C.Morale).state = SHAKEN;
      state.world.remove(e, C.HitSinceAct);
      log(`${Q.labelOf(state, e)} RALLIES (${r}${bonus ? "+1" : ""}) — now Shaken`, "good");
      return;
    }
    log(`${Q.labelOf(state, e)} fails to rally (${r}${bonus ? "+1" : ""}) and keeps running`);
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
