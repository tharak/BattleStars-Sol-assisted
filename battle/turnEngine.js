// Battle lifecycle/orchestration: whose turn is it, activation flow, human
// command handlers, and win/draw detection. Delegates actual rule
// resolution to systems.js and reads via queries.js.
import { COLS, ROWS, MP_MAX, MAX_TURNS, MoraleState, sideName } from "./config.js";
import { neighbor, hexDist, key } from "./hexmath.js";
import { deployFormation } from "./formations.js";
import { fire, aiActivate, routedActivation } from "./systems.js";
import { log, clearLog, updatePanels } from "./panels.js";
import { draw } from "./render.js";
import * as C from "./components.js";
import * as Q from "./queries.js";

// deployment.js also imports {humanControls, startCombat} from this module
// (newBattle here calls into deployment.beginSetupFor) -- a deliberate
// two-way reference between "setup phase" and "combat phase" as two states
// of one lifecycle machine; safe in ES modules since neither side is used
// until a later DOM event, well after both modules finish loading.
import { beginSetupFor } from "./deployment.js";

const { SHAKEN, ROUTED } = MoraleState;

export function newBattle(state) {
  state.BREAK_AT = (state.SIZE >> 1) + 1;
  state.act = null; state.setup = null; state.setupQueue = []; state.effects = [];
  clearLog();
  log(`Scenario: ${state.scen.t} — ${state.SIZE} squadrons a side, breaks at ${state.BREAK_AT}`, "t");
  state.G = {
    turn: 0, lastActed: 1, over: false, winner: null,
    fleets: [
      { name: null, supply: state.scen.supA || "ok", flagLost: false, roster: [] },
      { name: null, supply: state.scen.supB || "ok", flagLost: false, roster: [] },
    ],
  };
  // Spectate always uses the scenario's exact fixed formation (no manual
  // setup to spectate); "battle formation" deployment mode does the same
  // for any control mode, so a human can take over one of the exact
  // benchmarked matchups instead of freely placing their own squadrons.
  if (state.ctrlMode === 3 || state.deployMode === 1) {
    state.G.fleets[0].name = state.scen.a; deployFormation(state, state.scen.a, 0);
    state.G.fleets[1].name = state.scen.b; deployFormation(state, state.scen.b, 1);
    startCombat(state);
    return;
  }
  // Any side you control deploys itself by hand; AI side(s) get a random
  // formation once every human side has confirmed (deployment.confirmSetup).
  const humanSides = [0, 1].filter(s => humanControls(state, s));
  state.setupQueue = humanSides.slice(1);
  beginSetupFor(state, humanSides[0]);
}
export function startCombat(state) {
  const supTag = s => s === "ok" ? "" : ` (${s.toUpperCase()} SUPPLY)`;
  log(`Blue: ${state.G.fleets[0].name}${supTag(state.G.fleets[0].supply)} — Red: ${state.G.fleets[1].name}${supTag(state.G.fleets[1].supply)}`);
  newTurn(state); proceed(state);
}

export function newTurn(state) {
  const G = state.G;
  G.turn++;
  for (const side of [0, 1]) for (const e of Q.unitsOfSide(state, side)) state.world.remove(e, C.Activated);
  G.lastActed = G.turn % 2; // side (turn+1)%2 acts first, mirroring the sim
  if (state.moveMode === 1) {
    // All-at-once: one side fully activates before the other gets a turn.
    // A single human-controlled side always goes first; otherwise (hotseat,
    // spectate) alternate who opens each turn, same as interleaved mode does.
    const humanSides = [0, 1].filter(s => humanControls(state, s));
    G.roundFirst = humanSides.length === 1 ? humanSides[0] : (G.turn + 1) % 2;
  }
  log(`— Turn ${G.turn} —`, "t");
}
export function checkEnd(state) {
  const G = state.G;
  if (G.over) return true;
  for (const s of [0, 1]) if (Q.losses(state, s) >= state.BREAK_AT) return gameOver(state, 1 - s, "break");
  if (Q.unactivatedOfSide(state, 0).length === 0 && Q.unactivatedOfSide(state, 1).length === 0) {
    if (G.turn >= MAX_TURNS) {
      const s0 = Q.aliveOfSide(state, 0).reduce((a, e) => a + Q.strengthOf(state, e), 0);
      const s1 = Q.aliveOfSide(state, 1).reduce((a, e) => a + Q.strengthOf(state, e), 0);
      return gameOver(state, s0 === s1 ? null : (s0 > s1 ? 0 : 1), "time");
    }
    newTurn(state);
  }
  return false;
}
export function nextSide(state) {
  const G = state.G;
  if (state.moveMode === 1) { // exhaust the round's first side entirely before the other side moves at all
    if (Q.unactivatedOfSide(state, G.roundFirst).length) return G.roundFirst;
    if (Q.unactivatedOfSide(state, 1 - G.roundFirst).length) return 1 - G.roundFirst;
    return null;
  }
  const other = 1 - G.lastActed;
  if (Q.unactivatedOfSide(state, other).length) return other;
  if (Q.unactivatedOfSide(state, G.lastActed).length) return G.lastActed;
  return null;
}
export const humanControls = (state, side) =>
  state.ctrlMode === 2 ? true : (state.ctrlMode === 3 ? false : side === state.ctrlMode);

export function proceed(state) {
  const G = state.G;
  if (G.over) return;
  if (checkEnd(state)) return;
  const side = nextSide(state);
  if (side === null) { proceed(state); return; }
  if (humanControls(state, side)) {
    state.act = { u: null, mp: 0, moved: false, fired: false, fireMode: false, side };
    draw(state); updatePanels(state);
    return;
  }
  // AI slot
  const go = () => {
    const u = Q.unactivatedOfSide(state, side)[0];
    if (!u) { proceed(state); return; }
    state.world.add(u, C.Activated, true); G.lastActed = side;
    aiActivate(state, u);
    draw(state); updatePanels(state);
    if (state.ctrlMode === 3) { checkEnd(state); draw(state); updatePanels(state); } // one activation per step/tick
    else proceed(state);
  };
  if (state.ctrlMode === 3) { go(); }
  else setTimeout(go, 250);
}

/* human actions */
export function selectUnit(state, e) {
  const act = state.act;
  if (!act || act.u != null || Q.sideOf(state, e) !== act.side || Q.isActivated(state, e) || !Q.isAlive(state, e)) return;
  state.world.add(e, C.Activated, true); state.G.lastActed = Q.sideOf(state, e);
  if (Q.moraleOf(state, e) === ROUTED) {
    routedActivation(state, e);
    state.act = null; draw(state); updatePanels(state);
    proceed(state); return;
  }
  state.world.remove(e, C.HitSinceAct);
  act.u = e; act.mp = MP_MAX; act.moved = false; act.fired = false; act.fireMode = false;
  act.cmd = Q.inCommand(state, e);
  draw(state); updatePanels(state);
}
// A selection with no move/fire committed yet isn't "spent" -- let the
// player pick a different un-activated squadron instead of being stuck
// with an accidental click. Once ANY MP has been spent or it has fired,
// the choice is locked in (matches "activation" being the real commitment).
export function switchSelection(state, e) {
  if (!Q.canSwitchSelection(state) || e === state.act.u) return;
  state.world.remove(state.act.u, C.Activated);
  state.act.u = null;
  selectUnit(state, e);
}
export function doTurn(state, dir) { // dir: +1 left(ccw in dir index terms)… use explicit
  if (!Q.canMove(state)) return;
  const facing = state.world.get(state.act.u, C.Facing);
  facing.dir = (facing.dir + dir + 6) % 6;
  state.act.mp--; state.act.moved = true; state.act.fireMode = false;
  draw(state); updatePanels(state);
}
export function doForward(state) {
  if (!Q.canMove(state)) return;
  const e = state.act.u, pos = Q.posOf(state, e), facing = Q.facingOf(state, e);
  const nx = neighbor(pos, facing);
  if (nx[0] < 0 || nx[0] >= COLS || nx[1] < 0 || nx[1] >= ROWS) return;
  if (Q.occupiedSet(state).has(key(nx[0], nx[1]))) return;
  if (Q.moraleOf(state, e) === SHAKEN) { // may not end closer to nearest enemy
    const ne = Q.nearestEnemy(state, e);
    if (ne && hexDist(nx, Q.posOf(state, ne)) < hexDist(pos, Q.posOf(state, ne))) {
      log(`${Q.labelOf(state, e)} is Shaken — it refuses to advance`, "bad"); return;
    }
  }
  const p = state.world.get(e, C.Position); p.c = nx[0]; p.r = nx[1];
  state.act.mp--; state.act.moved = true; state.act.fireMode = false;
  draw(state); updatePanels(state);
}
export function doBackward(state) {
  if (!Q.canBack(state)) return;
  const e = state.act.u, pos = Q.posOf(state, e), facing = Q.facingOf(state, e);
  const nx = neighbor(pos, (facing + 3) % 6);
  if (nx[0] < 0 || nx[0] >= COLS || nx[1] < 0 || nx[1] >= ROWS) return;
  if (Q.occupiedSet(state).has(key(nx[0], nx[1]))) return;
  if (Q.moraleOf(state, e) === SHAKEN) { // may not end a move closer to nearest enemy
    const ne = Q.nearestEnemy(state, e);
    if (ne && hexDist(nx, Q.posOf(state, ne)) < hexDist(pos, Q.posOf(state, ne))) {
      log(`${Q.labelOf(state, e)} is Shaken — it refuses to move toward the enemy`, "bad"); return;
    }
  }
  const p = state.world.get(e, C.Position); p.c = nx[0]; p.r = nx[1];
  state.act.mp = 0; state.act.moved = true; state.act.fireMode = false;
  draw(state); updatePanels(state);
}
export function doFireAt(state, tgt) {
  if (!Q.canFire(state)) return;
  if (!Q.legalTargets(state, state.act.u).includes(tgt)) return;
  fire(state, state.act.u, tgt);
  state.act.fired = true; state.act.fireMode = false;
  draw(state); updatePanels(state);
  if (checkEnd(state)) return;
  if (!state.act.cmd) endActivation(state); // out of command: fire was the whole activation
}
export function endActivation(state) {
  if (!state.act || state.act.u == null) return;
  state.act = null; draw(state); updatePanels(state);
  proceed(state);
}
export function gameOver(state, winner, how) {
  const G = state.G;
  G.over = true; G.winner = winner;
  const surv = s => Q.aliveOfSide(state, s).reduce((a, e) => a + Q.strengthOf(state, e), 0);
  let title, body;
  if (winner === null) { title = "Draw"; body = `Both fleets stand at turn ${G.turn}.`; }
  else {
    title = `${sideName(winner)} wins`;
    body = how === "break"
      ? `${sideName(1 - winner)}'s fleet breaks on turn ${G.turn} (${Q.losses(state, 1 - winner)} squadrons destroyed or fled).`
      : `On time at turn ${G.turn}: surviving strength ${surv(0)}–${surv(1)}.`;
  }
  const result = `${state.scen.t} | ctrl=${["Blue", "Red", "hotseat", "spectate"][state.ctrlMode]} | ` +
    `size=${state.SIZE} | winner=${winner === null ? "draw" : sideName(winner) + " (" + G.fleets[winner].name + ")"} | ` +
    `turn=${G.turn} | strength ${surv(0)}-${surv(1)} | losses ${Q.losses(state, 0)}-${Q.losses(state, 1)}`;
  log(`BATTLE OVER — ${title}. ${body}`, "t");
  document.getElementById("ovTitle").textContent = title;
  document.getElementById("ovBody").textContent = body +
    (G.fleets[0].name === "sphere" || G.fleets[1].name === "sphere" ? ` (Sphere survival score: ${G.turn} turns.)` : "");
  document.getElementById("ovResult").textContent = result;
  document.getElementById("overlay").style.display = "flex";
  draw(state); updatePanels(state);
  return true;
}
