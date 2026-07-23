import { fromAxial, hexDist, key, toAxial } from "../battle/hexmath.js";

export const TRANSPORT_JUMP_ACTION = "transport_jump";

const MIN_JUMP_HEXES = 2;
const MAX_JUMP_HEXES = 8;

export function transportJumpHexes(gravityRadius) {
  const radius = Number.isFinite(gravityRadius) ? gravityRadius : 0;
  return Math.max(MIN_JUMP_HEXES, Math.min(MAX_JUMP_HEXES, Math.floor(radius / 2)));
}

function axialPoint(center, radius, angle) {
  const [q, r] = toAxial(center[0], center[1]);
  return fromAxial(Math.round(q + Math.cos(angle) * radius), Math.round(r + Math.sin(angle) * radius));
}

function arcCells(center, radius, startAngle, endAngle, direction) {
  const span = direction > 0
    ? (endAngle - startAngle + Math.PI * 2) % (Math.PI * 2)
    : (startAngle - endAngle + Math.PI * 2) % (Math.PI * 2);
  const count = Math.max(1, Math.ceil(span * Math.max(1, radius)));
  const cells = [];
  for (let index = 0; index <= count; index++) {
    const angle = startAngle + direction * span * index / count;
    const cell = axialPoint(center, radius, angle);
    if (!cells.some(existing => key(...existing) === key(...cell))) cells.push(cell);
  }
  return cells;
}

function lineCells(start, end) {
  const [startQ, startR] = toAxial(start[0], start[1]);
  const [endQ, endR] = toAxial(end[0], end[1]);
  const distance = Math.max(
    Math.abs(endQ - startQ),
    Math.abs(endR - startR),
    Math.abs((endQ + endR) - (startQ + startR)),
  );
  if (!distance) return [[...start]];
  const cells = [];
  for (let index = 0; index <= distance; index++) {
    const t = index / distance;
    const cell = fromAxial(
      Math.round(startQ + (endQ - startQ) * t),
      Math.round(startR + (endR - startR) * t),
    );
    if (!cells.some(existing => key(...existing) === key(...cell))) cells.push(cell);
  }
  return cells;
}

function appendCells(target, cells) {
  for (const cell of cells) {
    if (!target.length || key(...target[target.length - 1]) !== key(...cell)) target.push([...cell]);
  }
}

function tangentArc(parent, child) {
  const [parentQ, parentR] = toAxial(parent.position[0], parent.position[1]);
  const [childQ, childR] = toAxial(child.position[0], child.position[1]);
  const theta = Math.atan2(childR - parentR, childQ - parentQ);
  const direction = parent.rotation >= 0 ? 1 : -1;
  const side = direction > 0 ? 1 : -1;
  const parentRadius = Math.max(1, parent.gravityRadius || 1);
  const childRadius = Math.max(1, child.gravityRadius || 1);
  const parentSide = theta + side * Math.PI / 2;
  const childSide = theta + side * Math.PI / 2;
  const parentForward = theta;
  const childBackward = theta + Math.PI;
  const cells = [];
  appendCells(cells, arcCells(parent.position, parentRadius, parentSide, parentForward, direction));
  appendCells(cells, lineCells(axialPoint(parent.position, parentRadius, parentForward), axialPoint(child.position, childRadius, childBackward)));
  appendCells(cells, arcCells(child.position, childRadius, childBackward, childSide, direction));
  return { cells, direction };
}

export function buildTransportNetwork(bodyCells = [], { jumpHexes = transportJumpHexes } = {}) {
  const byId = new Map(bodyCells.filter(body => body?.id).map(body => [body.id, body]));
  const lanes = [];
  for (const child of bodyCells) {
    if (!child?.parentId || !byId.has(child.parentId)) continue;
    const parent = byId.get(child.parentId);
    const arc = tangentArc(parent, child);
    const cells = arc.cells;
    const lane = {
      id: `${parent.id}-${child.id}`,
      parentId: parent.id,
      childId: child.id,
      direction: arc.direction,
      cells,
      endpoints: [ [...cells[0]], [...cells[cells.length - 1]] ],
      ambushCells: [ [...cells[0]], [...cells[Math.floor((cells.length - 1) / 2)]], [...cells[cells.length - 1]] ],
      jumpHexes: jumpHexes(child.gravityRadius),
    };
    lanes.push(lane);
  }
  lanes.sort((a, b) => a.id.localeCompare(b.id));

  const cells = new Map();
  for (const lane of lanes) {
    lane.cells.forEach((position, index) => {
      const cellKey = key(...position);
      const existing = cells.get(cellKey);
      cells.set(cellKey, {
        position: [...position],
        laneIds: [...(existing?.laneIds || []), lane.id],
        ambush: !!existing?.ambush || lane.ambushCells.some(node => key(...node) === cellKey),
        direction: lane.direction,
      });
      if (index === lane.cells.length - 1) cells.get(cellKey).exit = true;
    });
  }
  return { lanes, cells };
}

export function transportJumpDestination(lane, position) {
  if (!lane?.cells?.length || !position) return null;
  const index = lane.cells.findIndex(cell => key(...cell) === key(...position));
  if (index < 0) return null;
  const nextIndex = Math.min(lane.cells.length - 1, index + lane.jumpHexes);
  if (nextIndex === index) return null;
  return {
    position: [...lane.cells[nextIndex]],
    laneId: lane.id,
    direction: lane.direction,
    jumpHexes: nextIndex - index,
    ambush: lane.ambushCells.some(cell => key(...cell) === key(...lane.cells[nextIndex])),
  };
}

export function transportLanesAt(position, network) {
  const cell = network?.cells?.get(key(...position));
  if (!cell) return [];
  return cell.laneIds.map(id => network.lanes.find(lane => lane.id === id)).filter(Boolean);
}

export function mergeTransportCells(gravityCells, network, hexToWorld, colorHex = "#38d9ff") {
  const merged = new Map(gravityCells);
  for (const entry of network?.cells?.values() || []) {
    const [c, r] = entry.position;
    const existing = merged.get(key(c, r));
    merged.set(key(c, r), {
      ...(existing || { c, r, cost: 1, colorHex, x: hexToWorld(c, r)[0], y: hexToWorld(c, r)[1], well: null }),
      transport: true,
      transportLaneIds: entry.laneIds,
      transportAmbush: entry.ambush,
    });
  }
  return merged;
}

export function transportNetworkDistance(lane) {
  return lane?.cells?.length ? hexDist(lane.cells[0], lane.cells[lane.cells.length - 1]) : 0;
}
