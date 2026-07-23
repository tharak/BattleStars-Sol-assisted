import { targetNumber } from "../battle/domain/combatRules.js";

export const StrategicShipState = Object.freeze({
  READY: "ready",
  SHAKEN: "shaken",
  ROUTED: "routed",
});

const roundTenth = value => Math.round(value * 10) / 10;

export function createStrategicMembers(count, {
  nextId,
  flagshipCount = 0,
} = {}) {
  if (!Number.isInteger(count) || count < 0 || typeof nextId !== "function") return [];
  return Array.from({ length: count }, (_, index) => ({
    id: nextId(),
    health: 1,
    state: StrategicShipState.READY,
    isOriginalFlagship: index < flagshipCount,
  }));
}

export function memberEffectiveStrength(member) {
  if (!member || member.health <= 0 || member.state === StrategicShipState.ROUTED) return 0;
  return member.health * (member.state === StrategicShipState.SHAKEN ? 0.5 : 1);
}

export function fleetEffectiveStrength(members) {
  return Math.round((members || []).reduce((total, member) => total + memberEffectiveStrength(member), 0) * 1000) / 1000;
}

export function repairStrategicMembers(members, repairPoints = 0) {
  const next = (members || []).map(member => ({ ...member }));
  let remaining = Math.max(0, Math.round(Number(repairPoints) * 10));
  const damaged = next
    .filter(member => member.health > 0 && member.health < 1)
    .sort((a, b) => a.health - b.health || a.id - b.id);
  for (const member of damaged) {
    while (remaining > 0 && member.health < 1) {
      member.health = roundTenth(Math.min(1, member.health + 0.1));
      remaining--;
    }
    if (remaining <= 0) break;
  }
  return { members: next, repaired: Math.round((Number(repairPoints) * 10 - remaining)) / 10 };
}

export function splitStrategicMembers(members) {
  if (!Array.isArray(members) || members.length < 2) return null;
  const detachedCount = members.length <= 19 ? Math.floor(members.length / 2) : 19;
  const effective = member => memberEffectiveStrength(member);
  const ordered = [...members].sort((a, b) => {
    if (a.isOriginalFlagship !== b.isOriginalFlagship) return a.isOriginalFlagship ? 1 : -1;
    return effective(a) - effective(b) || a.health - b.health || a.id - b.id;
  });
  const flagshipCount = members.filter(member => member.isOriginalFlagship).length;
  const detached = [];
  if (flagshipCount > 1) {
    const extraFlagship = ordered.find(member => member.isOriginalFlagship);
    if (extraFlagship) detached.push(extraFlagship);
  }
  for (const member of ordered) {
    if (detached.length >= detachedCount) break;
    if (!detached.includes(member)) detached.push(member);
  }
  const detachedIds = new Set(detached.map(member => member.id));
  return { retained: members.filter(member => !detachedIds.has(member.id)), detached };
}

export function assignMixedFleetSlots(fleets, maxSlots = 57) {
  const ordered = (fleets || []).map(fleet => ({
    fleetId: fleet.fleetId,
    members: [...fleet.members].sort((a, b) => a.id - b.id),
  })).sort((a, b) => a.fleetId - b.fleetId);
  const assignments = [];
  let memberIndex = 0;
  while (assignments.length < maxSlots) {
    let added = false;
    for (const fleet of ordered) {
      const member = fleet.members[memberIndex];
      if (!member) continue;
      const positionIndex = assignments.length;
      assignments.push({ slotIndex: positionIndex, positionIndex, fleetId: fleet.fleetId, member });
      added = true;
      if (assignments.length >= maxSlots) break;
    }
    if (!added) break;
    memberIndex++;
  }
  return assignments;
}

function weightedPick(values, weightOf, random) {
  const weights = values.map(value => Math.max(0, weightOf(value)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!values.length || total <= 0) return null;
  let cursor = random.next() * total;
  for (let index = 0; index < values.length; index++) {
    cursor -= weights[index];
    if (cursor < 0) return values[index];
  }
  return values.at(-1);
}

export function applyDirectionalDamage({ members, positionsByMemberId, incomingVector, damage, random }) {
  const next = members.map(member => ({ ...member }));
  const damagedIds = new Set();
  const destroyedIds = [];
  const increments = Math.max(0, Math.round(damage * 10));
  for (let increment = 0; increment < increments; increment++) {
    const living = next.filter(member => member.health > 0);
    if (!living.length) break;
    const projections = living.map(member => {
      const position = positionsByMemberId.get(member.id) || [0, 0];
      return position[0] * incomingVector[0] + position[1] * incomingVector[1];
    });
    const min = Math.min(...projections), max = Math.max(...projections);
    const target = weightedPick(living, member => {
      const index = living.indexOf(member);
      const exposure = max === min ? 0.5 : (projections[index] - min) / (max - min);
      return 1 + exposure * 2;
    }, random);
    target.health = roundTenth(Math.max(0, target.health - 0.1));
    if (target.health > 0) damagedIds.add(target.id);
    else {
      damagedIds.delete(target.id);
      destroyedIds.push(target.id);
    }
  }
  return {
    members: next.filter(member => member.health > 0),
    damagedIds: [...damagedIds],
    destroyedIds,
  };
}

export function resolveHexVolley({ attackerStrength, targets, random }) {
  const dice = Math.ceil(Math.max(0, attackerStrength));
  const rolls = [];
  const hitsByFleet = new Map();
  for (let die = 0; die < dice; die++) {
    const target = weightedPick(targets, entry => entry.members.length, random);
    if (!target) break;
    const roll = random.d6();
    const need = targetNumber({ targetArc: target.arc, supplyState: target.supplyState });
    const hit = roll >= need;
    rolls.push({ roll, fleetId: target.fleetId, need, hit, arc: target.arc });
    if (hit) hitsByFleet.set(target.fleetId, (hitsByFleet.get(target.fleetId) || 0) + 1);
  }
  return { dice, rolls, hitsByFleet };
}

export function allocateCollisionLosses({ fleets, movingFleetIds = [], maxShips = 57, random }) {
  const copies = fleets.map(fleet => ({ fleetId: fleet.fleetId, members: fleet.members.map(member => ({ ...member })) }));
  const byId = new Map(copies.map(fleet => [fleet.fleetId, fleet]));
  const order = [...new Set([
    ...movingFleetIds.filter(id => byId.has(id)),
    ...copies.map(fleet => fleet.fleetId).sort((a, b) => a - b),
  ])];
  const losses = new Map();
  let cursor = 0;
  let total = copies.reduce((sum, fleet) => sum + fleet.members.length, 0);
  while (total > maxShips && order.length) {
    const fleetId = order[cursor % order.length];
    const fleet = byId.get(fleetId);
    if (fleet?.members.length) {
      const index = Math.min(fleet.members.length - 1, Math.floor(random.next() * fleet.members.length));
      const [lost] = fleet.members.splice(index, 1);
      losses.set(fleetId, [...(losses.get(fleetId) || []), lost]);
      total--;
    }
    cursor++;
    if (cursor > 10000) throw new Error("collision allocation did not converge");
  }
  return { fleets: copies, losses };
}

export function fleetToneIndex(fleetId, toneCount = 7) {
  return Math.abs(Number(fleetId) || 0) % toneCount;
}
