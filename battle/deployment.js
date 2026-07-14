// Manual deployment (setup phase): human-controlled sides place their own
// squadrons one at a time before combat starts; AI sides get a random
// formation once every human side has confirmed.
import { spawnUnit, deployFormation, randomFormationName, inSetupZone } from "./formations.js";
import { sideName, Side, SIDES } from "./config.js";
import { log, updatePanels } from "./panels.js";
import { draw } from "./render.js";
import { humanControls, startCombat } from "./turnEngine.js";
import { BattlePhase } from "./core/phaseMachine.js";

export function beginSetupFor(state, side) {
  state.phase.transition(BattlePhase.DEPLOYMENT);
  state.setup = { side, placed: [], selected: null, flagShip: null };
  state.act = null;
  log(`${sideName(side)}: deploy your squadrons — click your shaded zone.`, "t");
  draw(state); updatePanels(state);
}
export function handleSetupClick(state, h) {
  const [c, r] = h;
  const setup = state.setup;
  const hit = setup.placed.find(p => p.pos[0] === c && p.pos[1] === r);
  if (hit) { setup.selected = hit; draw(state); updatePanels(state); return; }
  if (setup.placed.length >= state.SIZE || !inSetupZone(setup.side, c)) return;
  const ship = { pos: [c, r], facing: setup.side === Side.BLUE ? 0 : 3 };
  setup.placed.push(ship);
  setup.selected = ship;
  if (!setup.flagShip) setup.flagShip = ship;
  draw(state); updatePanels(state);
}
export function setupTurn(state, dir) {
  const setup = state.setup;
  if (!setup || !setup.selected) return;
  setup.selected.facing = (setup.selected.facing + dir + 6) % 6;
  draw(state); updatePanels(state);
}
export function setupToggleFlag(state) {
  const setup = state.setup;
  if (!setup || !setup.selected) return;
  setup.flagShip = setup.selected;
  draw(state); updatePanels(state);
}
export function setupRemove(state) {
  const setup = state.setup;
  if (!setup || !setup.selected) return;
  const i = setup.placed.indexOf(setup.selected);
  setup.placed.splice(i, 1);
  if (setup.flagShip === setup.selected) setup.flagShip = setup.placed[0] || null;
  setup.selected = setup.placed[Math.min(i, setup.placed.length - 1)] || null;
  draw(state); updatePanels(state);
}
export function confirmSetup(state) {
  const setup = state.setup;
  if (!setup || setup.placed.length !== state.SIZE) return;
  const side = setup.side;
  state.G.fleets[side].name = "custom";
  for (const p of setup.placed) spawnUnit(state, side, p.pos.slice(), p.facing, p === setup.flagShip);
  log(`${sideName(side)} deployment confirmed — ${state.SIZE} squadrons.`, "t");
  state.setup = null;
  if (state.setupQueue.length) { beginSetupFor(state, state.setupQueue.shift()); return; }
  for (const s of SIDES) if (!humanControls(state, s)) {
    const name = randomFormationName(state.random);
    state.G.fleets[s].name = name;
    deployFormation(state, name, s);
    log(`${sideName(s)} (AI) deploys in ${name} formation.`, "t");
  }
  startCombat(state);
}
