// Data for the three strategic zoom levels. Battle (the fourth level) is
// battle.html/battle/* unchanged -- CelestialBody hexes link out to it.
//
// This is a test fixture, not real astronomy: Sol is the only system in the
// universe for now, and we only have moon data for the bodies with notable
// moons -- others just get an empty ring around them.

import { neighbor } from "../battle/hexmath.js";
import { formationLayout } from "../battle/formations.js";
export { FORMATION_NAMES } from "../battle/config.js";

// "Radius" as specified counts hex rings *including* the center ring, so
// radius 1 = just the center hex, radius 2 = center + one ring = 7 hexes,
// radius 13 = center + 12 rings = 469 hexes. hexDist() (and every other
// hex-math helper here) instead counts rings *around* the center, so the
// conversion is always ringRadius - 1. Every board's exposed `radius` field
// (and cell `size`s that describe a board, not a body -- see below) uses
// this ring convention throughout; only radialBoard's internals convert to
// hexDist for the actual hex math (masking, walking).
const rings = n => n - 1;
const toRings = hexRadius => hexRadius + 1;

// Every map -- Universe, System, or CelestialBody -- is at least this big,
// regardless of how little it has in it (a moonless body still gets a full
// board, just mostly empty space around it). A board only grows past this
// if its own content doesn't fit -- see radialBoard().
const MIN_BOARD_RINGS = 13;

// Relative body sizes, in hex-blob radius (0 = a single hex). Not to
// scale -- just per spec: Mars/Mercury radius 1 (a bare single hex read as
// "missing" next to the bigger planets), Earth/Venus radius 2,
// Uranus/Neptune radius 1, Jupiter/Saturn radius 2, Sun radius 2.
export const SIZE = {
  sun: 2, mercury: 1, venus: 2, earth: 2, mars: 1, belt: 0,
  jupiter: 2, saturn: 2, uranus: 1, neptune: 1,
};

// A radial board is a hexagon (same inBounds hex-radius mask idea as the
// Battle board in battle/config.js) with one object -- a star or a body --
// at its exact middle, and satellites radiating outward from it: each one
// walks straight out in one of 6 directions (round-robin, via hexmath's
// neighbor()) far enough that its own hex-blob (cell.size, a hexDist<=size
// disc, not just a single hex) never touches the previous blob on the same
// ray, the center's blob, or its own gap. Board radius (in rings) is
// whichever is bigger: MIN_BOARD_RINGS, or wherever that packing ends up.
function radialBoard(centerCell, items, gap = 1) {
  const centerRadius = centerCell.size || 0;
  const frontier = {}; // dir -> outer edge (hex distance from center) claimed so far
  const placements = items.map((item, i) => {
    const dir = i % 6, r = item.size || 0;
    const dist = (frontier[dir] ?? centerRadius) + r + gap;
    frontier[dir] = dist + r;
    return { item, dir, dist };
  });
  const hexRadius = Math.max(centerRadius, rings(MIN_BOARD_RINGS), ...Object.values(frontier), 0);
  const center = [hexRadius, hexRadius];
  const walk = (dir, steps) => { let p = center; for (let i = 0; i < steps; i++) p = neighbor(p, dir); return p; };
  const cells = [{ ...centerCell, pos: center }];
  for (const { item, dir, dist } of placements) cells.push({ ...item, pos: walk(dir, dist) });
  return { cols: hexRadius * 2 + 1, rows: hexRadius * 2 + 1, center, radius: toRings(hexRadius), cells };
}

const hsForRadius = ringRadius => Math.max(16, Math.round(216 / rings(ringRadius)));

// The universe is otherwise-empty space with Sol as its one system so far,
// drawn at ring-radius 2 (7 hexes: the center plus one ring) -- reuse
// radialBoard with Sol itself as the "center object" and no satellites.
export const UNIVERSE = (() => {
  const board = radialBoard(
    { id: "sol", label: "Sol", kind: "system", size: rings(2), enter: { level: "system", systemId: "sol" } },
    [],
  );
  return { title: "Universe", hs: hsForRadius(board.radius), ...board };
})();

export const SYSTEMS = {
  sol: {
    title: "Sol System",
    ...(() => {
      const board = radialBoard({ id: "sun", label: "Sun", kind: "star", size: SIZE.sun }, [
        { id: "mercury", label: "Mercury", kind: "planet", size: SIZE.mercury, enter: { level: "body", systemId: "sol", bodyId: "mercury" } },
        { id: "venus",   label: "Venus",   kind: "planet", size: SIZE.venus,   enter: { level: "body", systemId: "sol", bodyId: "venus" } },
        { id: "earth",   label: "Earth",   kind: "planet", size: SIZE.earth,   enter: { level: "body", systemId: "sol", bodyId: "earth" } },
        { id: "mars",    label: "Mars",    kind: "planet", size: SIZE.mars,    enter: { level: "body", systemId: "sol", bodyId: "mars" } },
        { id: "belt",    label: "Asteroid Belt", kind: "belt", size: SIZE.belt },
        { id: "jupiter", label: "Jupiter", kind: "planet", size: SIZE.jupiter, enter: { level: "body", systemId: "sol", bodyId: "jupiter" } },
        { id: "saturn",  label: "Saturn",  kind: "planet", size: SIZE.saturn,  enter: { level: "body", systemId: "sol", bodyId: "saturn" } },
        { id: "uranus",  label: "Uranus",  kind: "planet", size: SIZE.uranus,  enter: { level: "body", systemId: "sol", bodyId: "uranus" } },
        { id: "neptune", label: "Neptune", kind: "planet", size: SIZE.neptune, enter: { level: "body", systemId: "sol", bodyId: "neptune" } },
      ], 3);
      return { ...board, hs: hsForRadius(board.radius) };
    })(),
  },
};

// Only the bodies with well-known moons get any -- everyone else just has
// an empty ring around them (still hexagonal, still centered on the body).
const MOONS = {
  earth:   ["Moon"],
  mars:    ["Phobos", "Deimos"],
  jupiter: ["Io", "Europa", "Ganymede", "Callisto"],
  saturn:  ["Titan", "Rhea", "Iapetus", "Dione", "Tethys"],
  uranus:  ["Titania", "Oberon", "Miranda", "Ariel", "Umbriel"],
  neptune: ["Triton"],
};

// Starting fleets: each faction's ships are placed as a single hex on
// their home body's own CelestialBody map (not the Star Map -- the planet
// itself is the tile there; fleets live one level down, "at" that planet).
// A fleet is one hex regardless of ship count -- there's no "Enter Battle"
// hex anymore; landing two different factions' fleets on the same hex is
// what triggers a battle (see main.js's click handling), once fleets can
// move there.
export const FACTIONS = {
  blue:  { label: "Blue",  startAt: "earth" },
  green: { label: "Green", startAt: "saturn" },
  red:   { label: "Red",   startAt: "jupiter" },
};
const SHIPS_PER_FACTION = 12;

function fleetAt(bodyId) {
  const entry = Object.entries(FACTIONS).find(([, f]) => f.startAt === bodyId);
  if (!entry) return [];
  const [faction] = entry;
  return [{
    id: `${faction}-fleet`, label: String(SHIPS_PER_FACTION), kind: "fleet", faction, count: SHIPS_PER_FACTION,
  }];
}

// Each faction's chosen formation, in memory only (resets on reload) --
// set from the Formation Setup screen (main.js), read again once a battle
// actually triggers so deployment isn't just random. "line" until chosen.
export const FLEET_FORMATIONS = { blue: "line", green: "line", red: "line" };

// Formation Setup is a hex board too, but a small fixed one -- not packed
// via radialBoard, since battle/formations.js's layouts (fwd/lat offsets
// from a 12-ship formation, same math the actual Battle board uses) are
// already designed not to self-overlap. Radius 9 comfortably fits every
// formation's fwd (-4..4) / lat (-6..5) range.
const FORMATION_BOARD_RINGS = toRings(9);
export function formationBoard(faction, formationName) {
  const { u, flag } = formationLayout(formationName, SHIPS_PER_FACTION);
  const hexRadius = rings(FORMATION_BOARD_RINGS);
  const center = [hexRadius, hexRadius];
  const cells = u.map(([fwd, lat], i) => ({
    id: `ship${i}`, label: i === flag ? "★" : String(i + 1),
    kind: "ownship", faction, pos: [center[0] + fwd, center[1] + lat],
  }));
  return {
    cols: hexRadius * 2 + 1, rows: hexRadius * 2 + 1, center, radius: FORMATION_BOARD_RINGS,
    hs: hsForRadius(FORMATION_BOARD_RINGS), cells,
  };
}

export function celestialBodyLevel(systemId, bodyId) {
  const label = bodyLabel(systemId, bodyId);
  const moons = MOONS[bodyId] || [];
  const items = [
    ...moons.map(name => ({ id: name.toLowerCase(), label: name, kind: "moon" })),
    ...fleetAt(bodyId),
  ];
  const board = radialBoard({ id: bodyId, label, kind: "body-center", size: SIZE[bodyId] || 0 }, items);
  return { title: label, hs: hsForRadius(board.radius), ...board };
}

export function bodyLabel(systemId, bodyId) {
  const cell = SYSTEMS[systemId].cells.find(c => c.id === bodyId);
  return cell ? cell.label : bodyId;
}
