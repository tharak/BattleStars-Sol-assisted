// Data for the three strategic zoom levels. Battle (the fourth level) is
// battle.html/battle/* unchanged -- CelestialBody hexes link out to it.
//
// This is a test fixture, not real astronomy: Sol is the only system in the
// universe for now, and every celestial body opens the same generic
// placeholder view (labeled with its own name) since we don't have
// per-body data yet.

import { hexDist, neighbor } from "../battle/hexmath.js";

export const UNIVERSE = {
  title: "Universe",
  cols: 7, rows: 7, hs: 34,
  cells: [
    { id: "sol", pos: [3, 3], label: "Sol", kind: "system", enter: { level: "system", systemId: "sol" } },
  ],
};

// A system board is a hexagon (radius hexes around center, same inBounds
// mask idea as the Battle board in battle/config.js) with the star at its
// exact middle. Bodies radiate outward in straight rays -- one of 6
// directions each, walked step-by-step with hexmath's neighbor() -- at a
// hex distance from the star equal to their orbital rank, so distance from
// center still reflects real relative position (closer orbit = closer hex)
// even though the hex grid can't hold true-to-scale AU distances.
function systemBoard(center, radius, star, bodies) {
  const walk = (dir, steps) => { let p = center; for (let i = 0; i < steps; i++) p = neighbor(p, dir); return p; };
  const cols = center[0] + radius + 1, rows = center[1] + radius + 1;
  const cells = [{ id: star.id, pos: center, label: star.label, kind: "star" }];
  bodies.forEach((b, i) => {
    const dir = i % 6, dist = i + 1;
    const pos = walk(dir, dist);
    cells.push(b.inert
      ? { id: b.id, pos, label: b.label, kind: "belt" }
      : { id: b.id, pos, label: b.label, kind: "planet", enter: { level: "body", systemId: "sol", bodyId: b.id } });
  });
  return { cols, rows, center, radius, cells };
}

export const SYSTEMS = {
  sol: {
    title: "Sol System",
    hs: 24,
    ...systemBoard([9, 9], 9, { id: "sun", label: "Sun" }, [
      { id: "mercury", label: "Mercury" },
      { id: "venus",   label: "Venus" },
      { id: "earth",   label: "Earth" },
      { id: "mars",    label: "Mars" },
      { id: "belt",    label: "Asteroid Belt", inert: true },
      { id: "jupiter", label: "Jupiter" },
      { id: "saturn",  label: "Saturn" },
      { id: "uranus",  label: "Uranus" },
      { id: "neptune", label: "Neptune" },
    ]),
  },
};

// Same placeholder layout for every body: the body itself in the middle,
// one hex that drops down into the existing Battle prototype.
export function celestialBodyLevel(bodyLabel) {
  return {
    title: bodyLabel,
    cols: 7, rows: 5, hs: 30,
    cells: [
      { id: "body", pos: [3, 2], label: bodyLabel, kind: "body-center" },
      { id: "battle", pos: [5, 2], label: "Enter Battle", kind: "battle-link", href: "battle.html" },
    ],
  };
}

export function bodyLabel(systemId, bodyId) {
  const cell = SYSTEMS[systemId].cells.find(c => c.id === bodyId);
  return cell ? cell.label : bodyId;
}
