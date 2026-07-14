import { spawnUnit } from "../formations.js";
import { inSetupZone } from "../formations.js";
import { BattlePhase, Side } from "../domain/constants.js";

export function beginDeployment(context, side) {
  context.phase.transition(BattlePhase.DEPLOYMENT);
  context.setup = { side, placed: [], selected: null, flagShip: null };
  context.act = null;
}

export function selectOrPlaceDeploymentHex(context, [column, row]) {
  const setup = context.setup;
  if (!setup) return false;
  const hit = setup.placed.find(unit => unit.pos[0] === column && unit.pos[1] === row);
  if (hit) {
    setup.selected = hit;
    return true;
  }
  if (setup.placed.length >= context.SIZE || !inSetupZone(setup.side, column)) return false;
  const unit = { pos: [column, row], facing: setup.side === Side.BLUE ? 0 : 3 };
  setup.placed.push(unit);
  setup.selected = unit;
  if (!setup.flagShip) setup.flagShip = unit;
  return true;
}

export function rotateDeploymentUnit(context, { direction }) {
  const selected = context.setup?.selected;
  if (!selected) return false;
  selected.facing = (selected.facing + direction + 6) % 6;
  return true;
}

export function setDeploymentFlagship(context) {
  const setup = context.setup;
  if (!setup?.selected) return false;
  setup.flagShip = setup.selected;
  return true;
}

export function removeDeploymentUnit(context) {
  const setup = context.setup;
  if (!setup?.selected) return false;
  const index = setup.placed.indexOf(setup.selected);
  setup.placed.splice(index, 1);
  if (setup.flagShip === setup.selected) setup.flagShip = setup.placed[0] || null;
  setup.selected = setup.placed[Math.min(index, setup.placed.length - 1)] || null;
  return true;
}

export function commitDeployment(context) {
  const setup = context.setup;
  if (!setup || setup.placed.length !== context.SIZE) return null;
  const side = setup.side;
  context.G.fleets[side].name = "custom";
  for (const placed of setup.placed) {
    spawnUnit(context, {
      side,
      position: placed.pos.slice(),
      facing: placed.facing,
      isFlagship: placed === setup.flagShip,
    });
  }
  context.setup = null;
  return { side };
}
