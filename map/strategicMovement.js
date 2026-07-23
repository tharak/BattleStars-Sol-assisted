import { MAX_MOVEMENT_POINTS, MAX_TURNS_PER_ACTIVATION, MoraleState } from "../battle/domain/constants.js";
import {
  canMoveDuringActivation, canTurnDuringActivation,
  forwardMovementCost,
} from "../battle/domain/movementRules.js";
import { fromAxial, hexDist, key, neighbor, toAxial } from "../battle/hexmath.js";

export const StrategicMoveAction = Object.freeze({
  FORWARD: "forward",
  BACKWARD: "backward",
  TURN_LEFT: "turn_left",
  TURN_RIGHT: "turn_right",
  TRANSPORT_JUMP: "transport_jump",
});

export const StrategicClickAction = Object.freeze({
  SET_COURSE: "set_course",
  SHIP: "ship",
  MOVE: "move",
  NONE: "none",
});

export function resolveStrategicClick({
  travelArmed = false,
  groupMoveArmed = false,
  hasWorldPoint = false,
  hitKind = null,
  reachable = false,
}) {
  if (travelArmed && hasWorldPoint) return StrategicClickAction.SET_COURSE;
  if (groupMoveArmed && reachable) return StrategicClickAction.MOVE;
  if (hitKind === "fleet") return StrategicClickAction.SHIP;
  if (reachable) return StrategicClickAction.MOVE;
  return StrategicClickAction.NONE;
}

const ACTION_TIE_ORDER = Object.freeze({
  [StrategicMoveAction.FORWARD]: 0,
  [StrategicMoveAction.TURN_LEFT]: 1,
  [StrategicMoveAction.TURN_RIGHT]: 2,
  [StrategicMoveAction.BACKWARD]: 3,
  [StrategicMoveAction.TRANSPORT_JUMP]: 4,
});

function compareActionSequences(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const delta = ACTION_TIE_ORDER[a[i]] - ACTION_TIE_ORDER[b[i]];
    if (delta) return delta;
  }
  return a.length - b.length;
}

// Lower is better. At the same AP cost, a route that avoids moving astern
// wins, followed by one that spends fewer actions turning. The remaining
// exact tie is stable and favors left before right.
export function compareStrategicRoutes(a, b) {
  return (a.cost - b.cost)
    || (a.backwardSteps - b.backwardSteps)
    || (a.turns - b.turns)
    || compareActionSequences(a.actions, b.actions)
    || (a.finalFacing - b.finalFacing);
}

export function chooseCourseRoute(routes, currentPosition, targetPosition) {
  if (!routes || !currentPosition || !targetPosition) return null;
  const currentDistance = hexDist(currentPosition, targetPosition);
  let best = null;
  let bestDistance = currentDistance;
  for (const route of routes.values()) {
    const distance = hexDist(route.position, targetPosition);
    if (distance > bestDistance) continue;
    if (distance < bestDistance || !best || compareStrategicRoutes(route, best) < 0) {
      best = route;
      bestDistance = distance;
    }
  }
  return bestDistance < currentDistance ? best : null;
}

function nearestEnemyPosition(position, enemyPositions) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const enemy of enemyPositions) {
    const distance = hexDist(position, enemy);
    if (distance < nearestDistance) {
      nearest = enemy;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function canTakeStep({ moraleState, position, nextPosition, enemyPositions, isBlocked }) {
  if (isBlocked(nextPosition)) return false;
  if (moraleState !== MoraleState.SHAKEN) return true;
  const nearest = nearestEnemyPosition(position, enemyPositions);
  return !nearest || hexDist(nextPosition, nearest) >= hexDist(position, nearest);
}

function makeRoute(state, action, cost) {
  return {
    cost: state.cost + cost,
    remainingMp: state.remainingMp - cost,
    finalFacing: state.facing,
    actions: [...state.actions, action],
    backwardSteps: state.backwardSteps + (action === StrategicMoveAction.BACKWARD ? 1 : 0),
    turns: state.turns + (action === StrategicMoveAction.TURN_LEFT || action === StrategicMoveAction.TURN_RIGHT ? 1 : 0),
    ...(state.forcedSteps?.length ? { forcedSteps: [...state.forcedSteps] } : {}),
  };
}

function stateKey(state) {
  return `${key(state.position[0], state.position[1])}|${state.facing}|${state.remainingMp}`;
}

/**
 * Explore every position/facing/remaining-AP state without mutating the
 * supplied activation or any ECS components. `movementCost` receives the
 * destination hex of a forward step; variable terrain pricing can be
 * supplied by the caller while open space defaults to the normal 1 AP.
 */
export function findReachableDestinations({
  position,
  facing,
  activation,
  moraleState = MoraleState.STEADY,
  enemyPositions = [],
  movementAllowance = MAX_MOVEMENT_POINTS,
  movementCost = nextPosition => forwardMovementCost(),
  isBlocked = () => false,
  resolveForcedMovement = () => null,
  resolveTransportMovement = () => [],
}) {
  const destinations = new Map();
  if (!position || facing == null || !canMoveDuringActivation(activation)) return destinations;

  const start = {
    position: [...position],
    facing,
    finalFacing: facing,
    remainingMp: activation.mp,
    cost: 0,
    actions: [],
    backwardSteps: 0,
    turns: activation.turns || 0,
  };
  const frontier = [start];
  const bestStates = new Map([[stateKey(start), start]]);
  const startPositionKey = key(position[0], position[1]);

  while (frontier.length) {
    frontier.sort(compareStrategicRoutes);
    const state = frontier.shift();
    if (bestStates.get(stateKey(state)) !== state) continue;

    const destinationKey = key(state.position[0], state.position[1]);
    if (destinationKey !== startPositionKey) {
      const route = { ...state, position: [...state.position] };
      const previous = destinations.get(destinationKey);
      if (!previous || compareStrategicRoutes(route, previous) < 0) destinations.set(destinationKey, route);
    }

    const candidates = [];
    for (const transport of resolveTransportMovement(state.position) || []) {
      if (!transport?.position || state.remainingMp < 1 || isBlocked(transport.position)) continue;
      const route = makeRoute(state, StrategicMoveAction.TRANSPORT_JUMP, 1);
      candidates.push({
        ...state, ...route, position: [...transport.position],
        transportSteps: [...(state.transportSteps || []), { ...transport, actionIndex: route.actions.length - 1 }],
      });
    }
    // Turning changes only facing, never movement points. Keep it in the
    // route search so every legal forward route can begin from any facing.
    if (state.remainingMp >= 1 && state.turns < MAX_TURNS_PER_ACTIVATION) {
      for (const [action, delta] of [
        [StrategicMoveAction.TURN_LEFT, 1],
        [StrategicMoveAction.TURN_RIGHT, -1],
      ]) {
        const route = makeRoute(state, action, 0);
        const nextFacing = (state.facing + delta + 6) % 6;
        candidates.push({ ...state, ...route, facing: nextFacing, finalFacing: nextFacing, position: [...state.position] });
      }
    }

    // Turning is free but capped. Reaching the cap must not suppress the
    // remaining paid forward movement shown by the destination preview.
    const forwardPosition = neighbor(state.position, state.facing);
    const forwardCost = movementCost(forwardPosition);
    if (Number.isFinite(forwardCost) && forwardCost > 0 && state.remainingMp >= forwardCost
        && canTakeStep({ moraleState, position: state.position, nextPosition: forwardPosition, enemyPositions, isBlocked })) {
      const route = makeRoute(state, StrategicMoveAction.FORWARD, forwardCost);
      const drift = resolveForcedMovement(forwardPosition);
      if (drift) (route.forcedSteps ||= []).push({ ...drift, actionIndex: route.actions.length - 1 });
      candidates.push({ ...state, ...route, position: drift?.to || forwardPosition });
    }

    // Moving astern always consumes a full movement allowance, even when
    // the activation happens to have a larger custom AP pool.
    if (state.remainingMp >= movementAllowance) {
      const backwardPosition = neighbor(state.position, (state.facing + 3) % 6);
      if (canTakeStep({ moraleState, position: state.position, nextPosition: backwardPosition, enemyPositions, isBlocked })) {
        const route = makeRoute(state, StrategicMoveAction.BACKWARD, movementAllowance);
        const drift = resolveForcedMovement(backwardPosition);
        if (drift) (route.forcedSteps ||= []).push({ ...drift, actionIndex: route.actions.length - 1 });
        candidates.push({ ...state, ...route, position: drift?.to || backwardPosition });
      }
    }

    for (const candidate of candidates) {
      const candidateKey = stateKey(candidate);
      const previous = bestStates.get(candidateKey);
      if (previous && compareStrategicRoutes(candidate, previous) >= 0) continue;
      bestStates.set(candidateKey, candidate);
      frontier.push(candidate);
    }
  }

  return destinations;
}

// Translate a formation member by the same axial-grid displacement as its
// leader. Offset coordinates cannot be subtracted directly across odd rows;
// converting to axial first keeps the member's relative hex offset intact.
export function translateFormationHex(position, leaderStart, leaderDestination) {
  const [memberQ, memberR] = toAxial(position[0], position[1]);
  const [startQ, startR] = toAxial(leaderStart[0], leaderStart[1]);
  const [destinationQ, destinationR] = toAxial(leaderDestination[0], leaderDestination[1]);
  return fromAxial(memberQ + destinationQ - startQ, memberR + destinationR - startR);
}

export function membersWithinCommand(leaderId, friendlyMembers, commandRadius) {
  const leader = friendlyMembers.find(member => member.id === leaderId);
  if (!leader || commandRadius < 0) return [];
  return friendlyMembers.filter(member => hexDist(leader.position, member.position) <= commandRadius);
}

/**
 * Find leader destinations that every member can reach while preserving the
 * formation's relative hex offsets. Each member gets its own strategic search,
 * so facing, morale, terrain, and movement rules still apply independently.
 * The formation command costs the most expensive member route.
 */
export function findGroupReachableDestinations({
  leaderId,
  members = [],
  activation,
  enemyPositions = [],
  movementAllowance = MAX_MOVEMENT_POINTS,
  movementCost = (_member, nextPosition) => forwardMovementCost(),
  isBlocked = () => false,
  resolveForcedMovement = (_member, position) => null,
}) {
  const destinations = new Map();
  const leader = members.find(member => member.id === leaderId);
  if (!leader || !activation || !canMoveDuringActivation(activation)) return destinations;

  const routeMaps = new Map();
  for (const member of members) {
    routeMaps.set(member.id, findReachableDestinations({
      position: member.position,
      facing: member.facing,
      activation: { ...activation, u: member.id, cmd: true, turns: member.turns || 0 },
      moraleState: member.moraleState,
      enemyPositions,
      movementAllowance,
      movementCost: nextPosition => movementCost(member, nextPosition),
      isBlocked: nextPosition => isBlocked(member, nextPosition),
      resolveForcedMovement: position => resolveForcedMovement(member, position),
    }));
  }

  const leaderRoutes = routeMaps.get(leaderId);
  for (const [destinationKey, leaderRoute] of leaderRoutes) {
    const memberRoutes = [];
    let groupCost = 0;
    let allReachable = true;
    for (const member of members) {
      const target = member.id === leaderId
        ? leaderRoute.position
        : translateFormationHex(member.position, leader.position, leaderRoute.position);
      const route = member.id === leaderId ? leaderRoute : routeMaps.get(member.id).get(key(target[0], target[1]));
      if (!route) {
        allReachable = false;
        break;
      }
      groupCost = Math.max(groupCost, route.cost);
      memberRoutes.push({ memberId: member.id, route });
    }
    if (!allReachable || groupCost > activation.mp) continue;
    destinations.set(destinationKey, {
      ...leaderRoute,
      cost: groupCost,
      remainingMp: activation.mp - groupCost,
      memberRoutes,
    });
  }
  return destinations;
}

// The center plus rings one and two: 1 + 6 + 12 = 19 unique cells.
export function hexPatch(center, radius = 2) {
  if (!center || radius < 0) return [];
  const cells = [];
  const [centerQ, centerR] = toAxial(center[0], center[1]);
  for (let dc = -radius; dc <= radius; dc++) {
    for (let dr = Math.max(-radius, -dc - radius); dr <= Math.min(radius, -dc + radius); dr++) {
      cells.push(fromAxial(centerQ + dc, centerR + dr));
    }
  }
  return cells;
}

/** Execute a searched route through the caller's existing rule functions. */
export function executeStrategicRoute(route, {
  activation = null,
  turnLeft,
  turnRight,
  moveForward,
  moveBackward,
  applyForcedStep = () => {},
  jumpTransport = () => ({ ok: true }),
}) {
  if (!route) return { ok: false, reason: "missing_route" };
  for (let actionIndex = 0; actionIndex < route.actions.length; actionIndex++) {
    const action = route.actions[actionIndex];
    if (action === StrategicMoveAction.TURN_LEFT) turnLeft();
    else if (action === StrategicMoveAction.TURN_RIGHT) turnRight();
    else if (action === StrategicMoveAction.TRANSPORT_JUMP) {
      const result = jumpTransport(route.transportSteps?.find(step => step.actionIndex === actionIndex));
      if (!result?.ok) return result || { ok: false, reason: "transport_failed" };
    }
    else {
      const result = action === StrategicMoveAction.FORWARD ? moveForward() : moveBackward();
      if (!result?.ok) return result || { ok: false, reason: "step_failed" };
      const drift = route.forcedSteps?.find(step => step.actionIndex === actionIndex);
      if (drift) applyForcedStep(drift);
    }
  }
  if (activation) {
    activation.mp = route.remainingMp;
    activation.turns = route.turns;
    if (activation.turnsByShip) activation.turnsByShip[activation.u] = route.turns;
    activation.moved = true;
    activation.fireMode = false;
  }
  return { ok: true };
}

/**
 * Execute the same validated route while yielding after each visible move.
 * Timing and presentation stay injected so this headless module owns no
 * clocks, DOM, or renderer state.
 */
export async function executeStrategicRouteStepwise(route, {
  activation = null,
  turnLeft,
  turnRight,
  moveForward,
  moveBackward,
  applyForcedStep = () => {},
  jumpTransport = () => ({ ok: true }),
  afterMovement = () => {},
  waitForNextMovement = () => Promise.resolve(),
}) {
  if (!route) return { ok: false, reason: "missing_route" };
  let movementIndex = 0;
  for (let actionIndex = 0; actionIndex < route.actions.length; actionIndex++) {
    const action = route.actions[actionIndex];
    if (action === StrategicMoveAction.TURN_LEFT) {
      turnLeft();
      continue;
    }
    if (action === StrategicMoveAction.TURN_RIGHT) {
      turnRight();
      continue;
    }
    if (action === StrategicMoveAction.TRANSPORT_JUMP) {
      const result = jumpTransport(route.transportSteps?.find(step => step.actionIndex === actionIndex));
      if (!result?.ok) return result || { ok: false, reason: "transport_failed" };
      await afterMovement({ action, actionIndex, movementIndex });
      movementIndex++;
      await waitForNextMovement({ action, actionIndex, movementIndex });
      continue;
    }
    const result = action === StrategicMoveAction.FORWARD ? moveForward() : moveBackward();
    if (!result?.ok) return result || { ok: false, reason: "step_failed" };
    const drift = route.forcedSteps?.find(step => step.actionIndex === actionIndex);
    if (drift) applyForcedStep(drift);
    await afterMovement({ action, actionIndex, movementIndex, drift });
    movementIndex++;
    await waitForNextMovement({ action, actionIndex, movementIndex, drift });
  }
  if (activation) {
    activation.mp = route.remainingMp;
    activation.turns = route.turns;
    if (activation.turnsByShip) activation.turnsByShip[activation.u] = route.turns;
    activation.moved = true;
    activation.fireMode = false;
  }
  return { ok: true, movements: movementIndex };
}

/** Execute every prevalidated member route, then commit activation once. */
export function executeStrategicGroupRoute(groupRoute, { activation = null, actionsFor }) {
  if (!groupRoute?.memberRoutes?.length) return { ok: false, reason: "missing_group_route" };
  for (const { memberId, route } of groupRoute.memberRoutes) {
    const actions = actionsFor(memberId);
    if (!actions) return { ok: false, reason: "missing_member_actions", memberId };
    const result = executeStrategicRoute(route, actions);
    if (!result.ok) return { ...result, memberId };
  }
  if (activation) {
    activation.mp = groupRoute.remainingMp;
    activation.turnsByShip ||= {};
    for (const { memberId, route } of groupRoute.memberRoutes) activation.turnsByShip[memberId] = route.turns;
    activation.turns = activation.turnsByShip[activation.u] || 0;
    activation.moved = true;
    activation.fireMode = false;
  }
  return { ok: true };
}

/** Turn every commanded member in place without spending movement points. */
export function executeStrategicGroupTurn(memberIds, { activation, turn }) {
  if (!memberIds?.length || !canTurnDuringActivation(activation)) {
    return { ok: false, reason: "group_cannot_turn" };
  }
  if (memberIds.some(memberId => (activation.turnsByShip?.[memberId] || 0) >= MAX_TURNS_PER_ACTIVATION)) {
    return { ok: false, reason: "group_turn_limit" };
  }
  for (const memberId of memberIds) turn(memberId);
  activation.turnsByShip ||= {};
  for (const memberId of memberIds) activation.turnsByShip[memberId] = (activation.turnsByShip[memberId] || 0) + 1;
  activation.turns = activation.turnsByShip[activation.u] ?? ((activation.turns || 0) + 1);
  activation.moved = true;
  activation.fireMode = false;
  return { ok: true };
}
