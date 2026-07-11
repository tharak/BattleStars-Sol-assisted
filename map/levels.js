// Data for the three strategic zoom levels. Battle (the fourth level) is
// battle.html/battle/* unchanged -- CelestialBody hexes link out to it.
//
// This is a test fixture, not real astronomy: Sol is the only system in the
// universe for now, and every celestial body opens the same generic
// placeholder view (labeled with its own name) since we don't have
// per-body data yet.

export const UNIVERSE = {
  title: "Universe",
  cols: 7, rows: 7, hs: 34,
  cells: [
    { id: "sol", pos: [3, 3], label: "Sol", kind: "system", enter: { level: "system", systemId: "sol" } },
  ],
};

// Bodies are laid out in a line outward from the Sun purely for legibility
// (a real orbital layout doesn't matter for a hex strategy map).
export const SYSTEMS = {
  sol: {
    title: "Sol System",
    cols: 21, rows: 3, hs: 20,
    cells: [
      { id: "sun",     pos: [1, 1],  label: "Sun",     kind: "star" },
      { id: "mercury", pos: [3, 1],  label: "Mercury", kind: "planet", enter: { level: "body", systemId: "sol", bodyId: "mercury" } },
      { id: "venus",   pos: [5, 1],  label: "Venus",   kind: "planet", enter: { level: "body", systemId: "sol", bodyId: "venus" } },
      { id: "earth",   pos: [7, 1],  label: "Earth",   kind: "planet", enter: { level: "body", systemId: "sol", bodyId: "earth" } },
      { id: "mars",    pos: [9, 1],  label: "Mars",    kind: "planet", enter: { level: "body", systemId: "sol", bodyId: "mars" } },
      { id: "belt",    pos: [11, 1], label: "Asteroid Belt", kind: "belt" },
      { id: "jupiter", pos: [13, 1], label: "Jupiter", kind: "planet", enter: { level: "body", systemId: "sol", bodyId: "jupiter" } },
      { id: "saturn",  pos: [15, 1], label: "Saturn",  kind: "planet", enter: { level: "body", systemId: "sol", bodyId: "saturn" } },
      { id: "uranus",  pos: [17, 1], label: "Uranus",  kind: "planet", enter: { level: "body", systemId: "sol", bodyId: "uranus" } },
      { id: "neptune", pos: [19, 1], label: "Neptune", kind: "planet", enter: { level: "body", systemId: "sol", bodyId: "neptune" } },
    ],
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
