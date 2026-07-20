import test from "node:test";
import assert from "node:assert/strict";

import { MAX_MOVEMENT_POINTS, MoraleState } from "../battle/domain/constants.js";
import { hexDist, key } from "../battle/hexmath.js";
import * as SC from "../battle/core/shipRules.js";
import {
  compareStrategicRoutes,
  chooseCourseRoute,
  executeStrategicGroupRoute,
  executeStrategicGroupTurn,
  executeStrategicRoute,
  executeStrategicRouteStepwise,
  findGroupReachableDestinations,
  findReachableDestinations,
  hexPatch,
  membersWithinCommand,
  resolveStrategicClick,
  StrategicClickAction,
  StrategicMoveAction,
  translateFormationHex,
} from "../map/strategicMovement.js";

test("course routing chooses the reachable hex closest to a distant target", () => {
  const routes = new Map([
    ["1,0", { position: [1, 0], cost: 1, backwardSteps: 0, turns: 0, actions: [], finalFacing: 0 }],
    ["2,0", { position: [2, 0], cost: 2, backwardSteps: 0, turns: 0, actions: [], finalFacing: 0 }],
    ["0,1", { position: [0, 1], cost: 1, backwardSteps: 0, turns: 0, actions: [], finalFacing: 0 }],
  ]);
  assert.deepEqual(chooseCourseRoute(routes, [0, 0], [10, 0]).position, [2, 0]);
  assert.equal(chooseCourseRoute(routes, [0, 0], [-10, 0]), null);
});

const activation = (overrides = {}) => ({
  u: 1,
  mp: MAX_MOVEMENT_POINTS,
  moved: false,
  fired: false,
  fireMode: false,
  cmd: true,
  ...overrides,
});

test("the two-ring hover patch contains exactly 19 unique cells", () => {
  const center = [7, -3];
  const cells = hexPatch(center);
  assert.equal(cells.length, 19);
  assert.equal(new Set(cells.map(([c, r]) => key(c, r))).size, 19);
  assert.ok(cells.every(cell => hexDist(center, cell) <= 2));
});

test("open-space search includes turns and full forward paths", () => {
  const routes = findReachableDestinations({
    position: [0, 0], facing: 0, activation: activation(),
  });

  assert.deepEqual(routes.get("3,0"), {
    position: [3, 0],
    facing: 0,
    finalFacing: 0,
    remainingMp: 0,
    cost: 3,
    actions: [StrategicMoveAction.FORWARD, StrategicMoveAction.FORWARD, StrategicMoveAction.FORWARD],
    backwardSteps: 0,
    turns: 0,
  });
  assert.deepEqual(routes.get("0,-1").actions, [StrategicMoveAction.TURN_LEFT, StrategicMoveAction.FORWARD]);
  assert.equal(routes.get("0,-1").finalFacing, 1);
  assert.deepEqual(routes.get("0,1").actions, [StrategicMoveAction.TURN_RIGHT, StrategicMoveAction.FORWARD]);
  assert.equal(routes.get("0,1").finalFacing, 5);
});

test("occupied cells cannot be entered or crossed", () => {
  const blocked = new Set(["1,0"]);
  const routes = findReachableDestinations({
    position: [0, 0], facing: 0, activation: activation(),
    // All alternate exits are walls, so the only possible way to [2,0]
    // would be through the occupied [1,0] cell.
    isBlocked: next => blocked.has(key(...next)) || !new Set(["1,0", "2,0"]).has(key(...next)),
  });

  assert.equal(routes.has("1,0"), false, "an occupied destination is unavailable");
  assert.equal(routes.has("2,0"), false, "a route cannot pass through an occupied ship");
});

test("a gravity drift becomes the advertised destination without extra MP", () => {
  const routes = findReachableDestinations({
    position: [0, 0], facing: 0, activation: activation({ mp: 1 }),
    resolveForcedMovement: position => position[0] === 1
      ? { from: position, to: [1, -1], direction: 1, wellId: "earth" }
      : null,
  });
  const route = routes.get("1,-1");
  assert.equal(route.cost, 1);
  assert.equal(route.remainingMp, 0);
  assert.deepEqual(route.forcedSteps, [{ from: [1, 0], to: [1, -1], direction: 1, wellId: "earth", actionIndex: 0 }]);
});

test("route execution applies its advertised forced gravity step", () => {
  const applied = [];
  const route = {
    actions: [StrategicMoveAction.FORWARD], remainingMp: 2,
    forcedSteps: [{ from: [1, 0], to: [1, -1], actionIndex: 0 }],
  };
  const result = executeStrategicRoute(route, {
    activation: activation(), turnLeft: () => {}, turnRight: () => {},
    moveForward: () => ({ ok: true }), moveBackward: () => ({ ok: true }),
    applyForcedStep: step => applied.push(step.to),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(applied, [[1, -1]]);
});

test("stepwise course execution yields after every moved hex", async () => {
  const world = new SC.World();
  const ship = SC.spawnShip(world, { faction: "blue", c: 0, r: 0, dir: 0, label: "Course" });
  const act = activation({ u: ship });
  const route = findReachableDestinations({
    position: SC.posOf(world, ship), facing: SC.facingOf(world, ship), activation: act,
  }).get("3,0");
  const observedPositions = [];
  const waits = [];

  const result = await executeStrategicRouteStepwise(route, {
    activation: act,
    turnLeft: () => SC.turn(world, ship, 1),
    turnRight: () => SC.turn(world, ship, -1),
    moveForward: () => SC.moveForward(world, ship),
    moveBackward: () => SC.moveBackward(world, ship),
    afterMovement: step => observedPositions.push({ ...step, position: SC.posOf(world, ship) }),
    waitForNextMovement: step => waits.push(step.movementIndex),
  });

  assert.deepEqual(observedPositions.map(step => step.position), [[1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(waits, [1, 2, 3]);
  assert.deepEqual(result, { ok: true, movements: 3 });
  assert.equal(act.mp, route.remainingMp);
  assert.equal(act.moved, true);
});

test("a backward hex uses the full allowance once the two-turn cap applies", () => {
  const routes = findReachableDestinations({
    position: [0, 0], facing: 0, activation: activation(),
  });
  const route = routes.get("-1,0");
  assert.equal(route.cost, MAX_MOVEMENT_POINTS);
  assert.equal(route.remainingMp, 0);
  assert.deepEqual(route.actions, [StrategicMoveAction.BACKWARD]);

  const partlySpent = findReachableDestinations({
    position: [0, 0], facing: 0, activation: activation({ mp: MAX_MOVEMENT_POINTS - 1 }),
  });
  assert.equal(partlySpent.has("-1,0"), false);
});

test("variable movement costs admit affordable cells and reject unaffordable cells", () => {
  const expensive = findReachableDestinations({
    position: [0, 0], facing: 0, activation: activation(),
    movementCost: next => key(...next) === "1,0" ? MAX_MOVEMENT_POINTS : 1,
  });
  assert.equal(expensive.get("1,0").cost, MAX_MOVEMENT_POINTS);
  assert.equal(expensive.get("1,0").remainingMp, 0);

  const gravity = findReachableDestinations({
    position: [0, 0], facing: 0, activation: activation(),
    movementCost: next => key(...next) === "1,0" ? 2 : (key(...next) === "2,0" ? 4 : 1),
  });
  assert.equal(gravity.get("1,0").cost, 2);
  assert.equal(gravity.has("2,0"), false);
});

test("depleted MP suppresses movement, but firing does not", () => {
  assert.equal(findReachableDestinations({ position: [0, 0], facing: 0, activation: activation({ mp: 0 }) }).size, 0);
  assert.ok(findReachableDestinations({
    position: [0, 0], facing: 0, activation: activation({ fired: true, cmd: false }),
  }).size > 0);
  assert.ok(findReachableDestinations({
    position: [0, 0], facing: 0, activation: activation({ fired: true, cmd: true }),
  }).size > 0);
});

test("Shaken search recalculates the nearest enemy after each simulated step", () => {
  const common = {
    position: [0, 0], facing: 0, activation: activation({ mp: 4 }), moraleState: MoraleState.SHAKEN,
  };
  const fixedInitialEnemy = findReachableDestinations({ ...common, enemyPositions: [[2, 0]] });
  const changingNearestEnemy = findReachableDestinations({ ...common, enemyPositions: [[2, 0], [1, -2]] });

  assert.ok(fixedInitialEnemy.has("1,-2"));
  assert.equal(changingNearestEnemy.has("1,-2"), false);
});

test("equal-cost route ties are deterministic and preserve final facing", () => {
  const left = {
    cost: 3, backwardSteps: 0, turns: 1, finalFacing: 1,
    actions: [StrategicMoveAction.FORWARD, StrategicMoveAction.TURN_LEFT, StrategicMoveAction.FORWARD],
  };
  const right = {
    ...left, finalFacing: 5,
    actions: [StrategicMoveAction.FORWARD, StrategicMoveAction.TURN_RIGHT, StrategicMoveAction.FORWARD],
  };
  const backward = { ...left, backwardSteps: 1, turns: 0, actions: [StrategicMoveAction.BACKWARD] };
  assert.ok(compareStrategicRoutes(left, right) < 0);
  assert.ok(compareStrategicRoutes(left, backward) < 0);

  const route = findReachableDestinations({
    position: [0, 0], facing: 0, activation: activation({ mp: 4 }),
  }).get("1,-2");
  assert.deepEqual(route.actions, [
    StrategicMoveAction.TURN_LEFT,
    StrategicMoveAction.FORWARD,
    StrategicMoveAction.FORWARD,
  ]);
  assert.equal(route.finalFacing, 1);
});

test("command-group search preserves axial formation offsets and charges the slowest member", () => {
  const act = activation();
  const members = [
    { id: 1, position: [0, 0], facing: 0, moraleState: MoraleState.STEADY },
    { id: 2, position: [0, 1], facing: 5, moraleState: MoraleState.STEADY },
  ];
  const routes = findGroupReachableDestinations({ leaderId: 1, members, activation: act });
  const route = routes.get("1,0");

  assert.ok(route);
  assert.equal(route.cost, 1, "the wing ship turns freely before translating one hex");
  assert.equal(route.remainingMp, 2);
  assert.deepEqual(translateFormationHex([0, 1], [0, 0], route.position), [1, 1]);
  assert.deepEqual(route.memberRoutes.map(plan => [plan.memberId, plan.route.position]), [
    [1, [1, 0]],
    [2, [1, 1]],
  ]);
});

test("command-group membership includes the radius boundary and excludes ships beyond it", () => {
  const members = [
    { id: 1, position: [0, 0] },
    { id: 2, position: [4, 0] },
    { id: 3, position: [4, 1] },
  ];
  assert.deepEqual(membersWithinCommand(1, members, 4).map(member => member.id), [1, 2]);
});

test("command-group destinations are the legal intersection for every member", () => {
  const members = [
    { id: 1, position: [0, 0], facing: 0, moraleState: MoraleState.STEADY },
    { id: 2, position: [0, 1], facing: 0, moraleState: MoraleState.STEADY },
  ];
  const routes = findGroupReachableDestinations({
    leaderId: 1,
    members,
    activation: activation(),
    isBlocked: (member, next) => member.id === 2 && key(...next) === "1,1",
  });

  assert.equal(routes.has("1,0"), false, "a destination is hidden when one commanded ship cannot translate there");
  assert.ok(routes.size > 0, "other legal formation translations remain available");
});

test("a Shaken command-group member vetoes translations toward its nearest enemy", () => {
  const routes = findGroupReachableDestinations({
    leaderId: 1,
    members: [
      { id: 1, position: [0, 0], facing: 0, moraleState: MoraleState.STEADY },
      { id: 2, position: [0, 1], facing: 0, moraleState: MoraleState.SHAKEN },
    ],
    activation: activation(),
    enemyPositions: [[2, 1]],
  });

  assert.equal(routes.has("1,0"), false);
});

test("command-group execution moves every member and commits activation once", () => {
  const world = new SC.World();
  const leader = SC.spawnShip(world, { faction: "blue", c: 0, r: 0, dir: 0, isFlagship: true, label: "Flag" });
  const wing = SC.spawnShip(world, { faction: "blue", c: 0, r: 1, dir: 5, label: "Wing" });
  const act = activation({ u: leader });
  const members = [leader, wing].map(id => ({
    id,
    position: SC.posOf(world, id),
    facing: SC.facingOf(world, id),
    moraleState: SC.moraleOf(world, id),
  }));
  const route = findGroupReachableDestinations({ leaderId: leader, members, activation: act }).get("1,0");
  const result = executeStrategicGroupRoute(route, {
    activation: act,
    actionsFor: id => ({
      turnLeft: () => SC.turn(world, id, 1),
      turnRight: () => SC.turn(world, id, -1),
      moveForward: () => SC.moveForward(world, id),
      moveBackward: () => SC.moveBackward(world, id),
    }),
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(SC.posOf(world, leader), [1, 0]);
  assert.deepEqual(SC.posOf(world, wing), [1, 1]);
  assert.equal(act.mp, route.remainingMp);
  assert.equal(act.moved, true);
});

test("command-group turns rotate every member without spending MP", () => {
  const act = activation({ fireMode: true });
  const turned = [];
  const result = executeStrategicGroupTurn([1, 2, 3], {
    activation: act,
    turn: id => turned.push(id),
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(turned, [1, 2, 3]);
  assert.equal(act.mp, MAX_MOVEMENT_POINTS);
  assert.equal(act.moved, true);
  assert.equal(act.fireMode, false);
});

test("a Fleet cannot turn more than twice in one activation", () => {
  const act = activation({ turns: 2, turnsByShip: { 1: 2 } });
  const routes = findReachableDestinations({ position: [0, 0], facing: 0, activation: act });
  assert.ok([...routes.values()].every(route => !route.actions.some(action =>
    action === StrategicMoveAction.TURN_LEFT || action === StrategicMoveAction.TURN_RIGHT,
  )));
  assert.equal(routes.get("1,0")?.cost, 1, "spent free turns do not hide paid forward movement");
  assert.deepEqual(executeStrategicGroupTurn([1], { activation: act, turn: () => assert.fail("must not turn") }), {
    ok: false, reason: "group_cannot_turn",
  });
});

test("command-group backward hex uses the full movement allowance", () => {
  const routes = findGroupReachableDestinations({
    leaderId: 1,
    members: [
      { id: 1, position: [0, 0], facing: 0, moraleState: MoraleState.STEADY },
      { id: 2, position: [0, 1], facing: 0, moraleState: MoraleState.STEADY },
    ],
    activation: activation(),
  });
  const route = routes.get("-1,0");

  assert.equal(route.cost, MAX_MOVEMENT_POINTS);
  assert.ok(route.memberRoutes.every(plan => plan.route.actions[0] === StrategicMoveAction.BACKWARD));
});

function movementFixture({ inCommand }) {
  const world = new SC.World();
  if (!inCommand) SC.spawnShip(world, { faction: "blue", c: 20, r: 0, dir: 0, isFlagship: true, label: "Flag" });
  const actor = SC.spawnShip(world, {
    faction: "blue", c: 0, r: 0, dir: 0, isFlagship: inCommand, label: "Actor",
  });
  SC.spawnShip(world, { faction: "red", c: 1, r: -3, dir: 3, label: "Target" });
  const act = activation({ u: actor, cmd: inCommand });
  const route = findReachableDestinations({
    position: SC.posOf(world, actor),
    facing: SC.facingOf(world, actor),
    activation: act,
    enemyPositions: SC.enemiesOf(world, "blue").map(e => SC.posOf(world, e)),
  }).get("1,-1");
  return { world, actor, act, route };
}

test("click-route execution applies advertised MP, position, facing, and fire restrictions", () => {
  for (const inCommand of [true, false]) {
    const { world, actor, act, route } = movementFixture({ inCommand });
    const result = executeStrategicRoute(route, {
      activation: act,
      turnLeft: () => SC.turn(world, actor, 1),
      turnRight: () => SC.turn(world, actor, -1),
      moveForward: () => SC.moveForward(world, actor),
      moveBackward: () => SC.moveBackward(world, actor),
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(SC.posOf(world, actor), route.position);
    assert.equal(SC.facingOf(world, actor), route.finalFacing);
    assert.equal(act.mp, route.remainingMp);
    assert.equal(MAX_MOVEMENT_POINTS - act.mp, route.cost);
    assert.equal(act.moved, true);
    assert.equal(SC.canFire(world, act), true);
  }
});

test("Set Course has priority over reachable movement and ship clicks while armed", () => {
  assert.equal(resolveStrategicClick({
    travelArmed: true, hasWorldPoint: true, hitKind: "fleet", reachable: true,
  }), StrategicClickAction.SET_COURSE);
  assert.equal(resolveStrategicClick({
    travelArmed: false, hasWorldPoint: true, hitKind: "fleet", reachable: true,
  }), StrategicClickAction.SHIP);
  assert.equal(resolveStrategicClick({
    travelArmed: false, hasWorldPoint: true, reachable: true,
  }), StrategicClickAction.MOVE);
});

test("armed command-group destinations take priority over ship tokens", () => {
  assert.equal(resolveStrategicClick({
    groupMoveArmed: true, hasWorldPoint: true, hitKind: "fleet", reachable: true,
  }), StrategicClickAction.MOVE);
  assert.equal(resolveStrategicClick({
    travelArmed: true, groupMoveArmed: true, hasWorldPoint: true, hitKind: "fleet", reachable: true,
  }), StrategicClickAction.SET_COURSE);
});
