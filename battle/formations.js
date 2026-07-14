// Formation layouts (pure data) plus the entity factories that turn a
// layout -- or a player's manually-placed ships -- into real ECS entities.
import { range, argmin, angleBetween, DIR_ANGLE } from "./hexmath.js";
import { FORMATION_NAMES, SETUP_ZONE, DEPLOY_ANCHOR, DEPLOY_ROW_CENTER, MoraleState, Side } from "./config.js";
import * as C from "./components.js";

// mirrors battle_sim.py exactly
export function formationLayout(name, size) {
  if (size === 5) {
    if (name === "line")    return { u: range(-2,2).map(l => [0,l,0]), flag: 2 };
    if (name === "spindle") return { u: [[1,0,0],[0,-1,0],[0,0,0],[0,1,0],[-1,0,0]], flag: 2 };
    if (name === "crescent")return { u: range(-2,2).map(l => [Math.abs(l)===2?1:0,
                                        l, l<=-2?1:(l>=2?-1:0)]), flag: 2 };
    if (name === "echelon") return { u: range(-2,2).map(l => [-l,l,0]), flag: 2 };
    if (name === "sphere")  return { u: [[0,0,0],[1,0,0],[0,-1,0],[-1,0,0],[0,1,0]], flag: 0 };
    if (name === "column")  return { u: range(-2,2).map(f => [f,0,0]), flag: 2 };
  }
  if (size === 9) {
    if (name === "line")    return { u: range(-4,4).map(l => [0,l,0]), flag: 4 };
    if (name === "spindle") return { u: [[2,0,0],[1,-1,0],[1,1,0],[0,-1,0],[0,0,0],[0,1,0],
                                        [-1,-1,0],[-1,1,0],[-2,0,0]], flag: 4 };
    if (name === "crescent")return { u: range(-4,4).map(l => [Math.abs(l)>=3?2:(Math.abs(l)===2?1:0),
                                        l, l<=-2?1:(l>=2?-1:0)]), flag: 4 };
    if (name === "echelon") return { u: range(-4,4).map(l => [-l,l,0]), flag: 4 };
    if (name === "sphere")  return { u: [[0,0,0],[1,0,0],[1,-1,0],[0,-1,0],[-1,-1,0],
                                        [-1,0,0],[-1,1,0],[0,1,0],[1,1,0]], flag: 0 };
    if (name === "column")  return { u: range(-4,4).map(f => [f,0,0]), flag: 4 };
  }
  if (size === 12) {
    if (name === "line")    return { u: range(-6,5).map(l => [0,l,0]), flag: 6 };
    if (name === "spindle") return { u: [[3,0,0],[2,-1,0],[2,1,0],
                                        [1,-1,0],[1,0,0],[1,1,0],
                                        [0,-1,0],[0,0,0],[0,1,0],
                                        [-1,-1,0],[-1,1,0],[-2,0,0]], flag: 7 };
    if (name === "crescent")return { u: range(-6,5).map(l => [Math.abs(l)>=4?2:(Math.abs(l)>=2?1:0),
                                        l, l<=-2?1:(l>=2?-1:0)]), flag: 6 };
    if (name === "echelon") return { u: range(-6,5).map(l => [Math.max(-4,Math.min(4,-l)),l,0]), flag: 6 };
    if (name === "sphere")  return { u: [[0,0,0],[1,0,0],[1,-1,0],[0,-1,0],[-1,-1,0],
                                        [-1,0,0],[-1,1,0],[0,1,0],[1,1,0],
                                        [2,0,0],[0,-2,0],[0,2,0]], flag: 0 };
    if (name === "column")  return { u: range(-2,3).flatMap(f => [[f,0,0],[f,1,0]]), flag: 4 };
  }
}

export const randomFormationName = random => random.pick(FORMATION_NAMES);
export function inSetupZone(side, c) { const [lo, hi] = SETUP_ZONE[side]; return c >= lo && c <= hi; }

// Creates one entity with the full standard component set and registers it
// on its fleet's roster. Shared by formation deployment and manual setup so
// both paths produce identical entities.
export function spawnUnit(state, side, pos, facing, isFlag) {
  const { world } = state;
  const roster = state.G.fleets[side].roster;
  const i = roster.length;
  const e = world.createEntity();
  world.add(e, C.Position, { c: pos[0], r: pos[1] });
  world.add(e, C.Facing, { dir: facing });
  world.add(e, C.Side, { value: side });
  world.add(e, C.Strength, { value: 4 });
  world.add(e, C.Morale, { state: MoraleState.STEADY });
  world.add(e, C.Label, { id: (side === Side.BLUE ? "B" : "R") + (i + 1) });
  world.add(e, C.Alive, true);
  if (isFlag) world.add(e, C.Flagship, true);
  roster.push(e);
  return e;
}

export function deployFormation(state, name, side) {
  const { u, flag } = formationLayout(name, state.SIZE);
  const straight = side === Side.BLUE ? 0 : 3, toPos = side === Side.BLUE ? 5 : 4, toNeg = side === Side.BLUE ? 1 : 2;
  const [blueAnchor, redAnchor] = DEPLOY_ANCHOR;
  const entities = u.map(([fwd, lat, df], i) => spawnUnit(state, side,
    [side === Side.BLUE ? blueAnchor + fwd : redAnchor - fwd, DEPLOY_ROW_CENTER + lat],
    df === 0 ? straight : (df > 0 ? toPos : toNeg),
    i === flag));
  if (name === "sphere") {
    const c = state.world.get(entities[0], C.Position);
    for (const e of entities.slice(1)) {
      const p = state.world.get(e, C.Position);
      const ang = angleBetween([c.c, c.r], [p.c, p.r]);
      state.world.get(e, C.Facing).dir =
        argmin(range(0, 5), d => Math.abs(((DIR_ANGLE[d] - ang + 180) % 360 + 360) % 360 - 180));
    }
  }
  return entities;
}
