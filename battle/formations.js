// Formation layouts (pure data) plus the entity factories that turn a
// layout -- or a player's manually-placed ships -- into real ECS entities.
import { range, directionToward } from "./hexmath.js";
import { FORMATION_NAMES, SETUP_ZONE, DEPLOY_ANCHOR, DEPLOY_ROW_CENTER, MoraleState, Side } from "./config.js";
import * as C from "./components.js";

// mirrors battle_sim.py exactly
export function formationLayout(name, size) {
  if (size === 3) {
    if (name === "line") return { u: range(-1, 1).map(l => [0, l, 0]), flag: 1 };
    if (name === "arrow") return { u: [[1, 0, 0], [0, 0, 0], [-1, 0, 0]], flag: 1 };
    if (name === "crescent") return { u: [[1, -1, 0], [0, 0, 0], [1, 1, 0]], flag: 1 };
    if (name === "echelon") return { u: [[1, -1, 0], [0, 0, 0], [-1, 1, 0]], flag: 1 };
    if (name === "sphere") return { u: [[0, 0, 0], [1, 0, 0], [0, -1, 0]], flag: 0 };
    if (name === "column") return { u: range(-1, 1).map(f => [f, 0, 0]), flag: 1 };
  }
  if (size === 5) {
    if (name === "line")    return { u: range(-2,2).map(l => [0,l,0]), flag: 2 };
    if (name === "arrow") return { u: [[1,0,0],[0,-1,0],[0,0,0],[0,1,0],[-1,0,0]], flag: 2 };
    if (name === "crescent")return { u: range(-2,2).map(l => [Math.abs(l)===2?1:0,
                                        l, l<=-2?1:(l>=2?-1:0)]), flag: 2 };
    if (name === "echelon") return { u: range(-2,2).map(l => [-l,l,0]), flag: 2 };
    if (name === "sphere")  return { u: [[0,0,0],[1,0,0],[0,-1,0],[-1,0,0],[0,1,0]], flag: 0 };
    if (name === "column")  return { u: range(-2,2).map(f => [f,0,0]), flag: 2 };
  }
  if (size === 9) {
    if (name === "line")    return { u: range(-4,4).map(l => [0,l,0]), flag: 4 };
    if (name === "arrow") return { u: [[2,0,0],[1,-1,0],[1,1,0],[0,-1,0],[0,0,0],[0,1,0],
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
    if (name === "arrow") return { u: [[3,0,0],[2,-1,0],[2,1,0],
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
  const count = Math.max(0, Math.floor(Number(size) || 0));
  if (count === 0) return { u: [], flag: 0 };
  const center = Math.floor((count - 1) / 2);
  if (name === "line") return { u: range(0, count - 1).map(index => [0, index - center, 0]), flag: center };
  if (name === "column") return { u: range(0, count - 1).map(index => [index - center, 0, 0]), flag: center };
  const positions = [];
  for (let radius = 0; positions.length < count; radius++) {
    for (let fwd = -radius; fwd <= radius && positions.length < count; fwd++) {
      for (let lat = -radius; lat <= radius && positions.length < count; lat++) {
        if (Math.max(Math.abs(fwd), Math.abs(lat), Math.abs(fwd + lat)) !== radius) continue;
        positions.push([fwd, lat, 0]);
      }
    }
  }
  return { u: positions, flag: Math.floor((positions.length - 1) / 2) };
}

export const randomFormationName = random => random.pick(FORMATION_NAMES);
export function inSetupZone(side, c) { const [lo, hi] = SETUP_ZONE[side]; return c >= lo && c <= hi; }

// Creates one entity with the full standard component set and registers it
// on its fleet's roster. Shared by formation deployment and manual setup so
// both paths produce identical entities.
export function spawnUnit(state, {
  side, position, facing, isFlagship = false, captain = null,
  strength = 4,
}) {
  const { world } = state;
  const roster = state.G.fleets[side].roster;
  const i = roster.length;
  const e = world.createEntity();
  world.add(e, C.Position, { c: position[0], r: position[1] });
  world.add(e, C.Facing, { dir: facing });
  world.add(e, C.Side, { value: side });
  world.add(e, C.Strength, { value: strength });
  // A tactical unit is a Fleet.  Its Strength is represented by this
  // compact, visual-only formation of individual Ships in either renderer.
  world.add(e, C.FleetFormation, { name: "sphere" });
  world.add(e, C.Morale, { state: MoraleState.STEADY });
  world.add(e, C.Label, { id: (side === Side.BLUE ? "B" : "R") + (i + 1) });
  world.add(e, C.Alive, true);
  if (isFlagship) world.add(e, C.Flagship, true);
  if (captain) world.add(e, C.Captain, { ...captain });
  roster.push(e);
  return e;
}

export function deployFormation(state, name, side) {
  const { u } = formationLayout(name, state.SIZE);
  const flagshipCount = Math.max(0, Math.min(u.length, state.FLAGSHIP_COUNT ?? 1));
  const flagshipIndices = flagshipCount === 0
    ? []
    : [0, ...Array.from({ length: flagshipCount - 1 }, (_, index) => index + 1)];
  const straight = side === Side.BLUE ? 0 : 3, toPos = side === Side.BLUE ? 5 : 4, toNeg = side === Side.BLUE ? 1 : 2;
  const [blueAnchor, redAnchor] = DEPLOY_ANCHOR;
  const entities = u.map(([fwd, lat, df], i) => spawnUnit(state, {
    side,
    position: [side === Side.BLUE ? blueAnchor + fwd : redAnchor - fwd, DEPLOY_ROW_CENTER + lat],
    facing: df === 0 ? straight : (df > 0 ? toPos : toNeg),
    isFlagship: flagshipIndices.includes(i),
    captain: flagshipIndices.includes(i) ? state.G.fleets[side].captains?.[flagshipIndices.indexOf(i)] : null,
    strength: state.FLEET_STRENGTH ?? 19,
  }));
  if (name === "sphere") {
    const c = state.world.get(entities[0], C.Position);
    for (const e of entities.slice(1)) {
      const p = state.world.get(e, C.Position);
      state.world.get(e, C.Facing).dir = directionToward([c.c, c.r], [p.c, p.r]);
    }
  }
  return entities;
}
