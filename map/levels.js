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
    // An item can specify its own gap (e.g. a moon placed by real relative
    // distance), overriding the board's default for everyone else.
    const dist = (frontier[dir] ?? centerRadius) + r + (item.gap ?? gap);
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
  jupiter: [
    "Metis", "Adrastea", "Amalthea", "Thebe", "Io", "Europa",
    "Ganymede", "Callisto", "Themisto", "Leda", "Ersa", "Himalia",
    "Pandia", "Lysithea", "Elara", "Dia", "Carpo", "Valetudo",
    "Euporie", "Eupheme", "Mneme", "Euanthe", "Harpalyke", "Orthosie",
    "Helike", "Praxidike", "Thelxinoe", "Thyone", "Ananke", "Iocaste",
    "Hermippe", "Philophrosyne", "Pasithee", "Eurydome", "Chaldene", "Isonoe",
    "Kallichore", "Erinome", "Kale", "Eirene", "Aitne", "Eukelade",
    "Arche", "Taygete", "Carme", "Herse", "Kalyke", "Hegemone",
    "Pasiphae", "Sponde", "Megaclite", "Cyllene", "Sinope", "Aoede",
    "Autonoe", "Callirrhoe", "Kore",
  ],
  saturn: [
    "Pan", "Daphnis", "Atlas", "Prometheus", "Pandora", "Epimetheus",
    "Janus", "Aegaeon", "Mimas", "Methone", "Anthe", "Pallene",
    "Enceladus", "Tethys", "Telesto", "Calypso", "Helene", "Polydeuces",
    "Dione", "Rhea", "Titan", "Hyperion", "Iapetus", "Kiviuq",
    "Ijiraq", "Phoebe", "Paaliaq", "Skathi", "Albiorix", "Bebhionn",
    "Erriapus", "Skoll", "Tarqeq", "Siarnaq", "Tarvos", "Hyrrokkin",
    "Greip", "Mundilfari", "Gridr", "Bergelmir", "Jarnsaxa", "Narvi",
    "Suttungr", "Hati", "Eggther", "Farbauti", "Thrymr", "Bestla",
    "Angrboda", "Aegir", "Beli", "Gerd", "Gunnlod", "Skrymir",
    "Alvaldi", "Kari", "Geirrod", "Fenrir", "Surtur", "Loge",
    "Ymir", "Thiazzi", "Fornjot",
  ],
  uranus: [
    "Cordelia", "Ophelia", "Bianca", "Cressida", "Desdemona", "Juliet",
    "Portia", "Rosalind", "Cupid", "Belinda", "Perdita", "Puck",
    "Mab", "Miranda", "Ariel", "Umbriel", "Titania", "Oberon",
    "Francisco", "Caliban", "Stephano", "Trinculo", "Sycorax", "Margaret",
    "Prospero", "Setebos", "Ferdinand",
  ],
  neptune: [
    "Naiad", "Thalassa", "Despina", "Galatea", "Larissa", "Hippocamp", "Proteus",
    "Triton", "Nereid", "Halimede", "Sao", "Laomedeia", "Psamathe", "Neso",
  ],
};

// Real orbital distance from the parent, in parent-radii (semi-major axis
// / parent radius) -- Phobos orbits barely above Mars, Iapetus is nearly
// a AU-scale outlier around Saturn. Used only to rank/scale hex spacing
// (gapForRatio below), not as a literal to-scale distance.
const MOON_DISTANCE_RATIO = {
  moon: 60.3, phobos: 2.76, deimos: 6.92,
  naiad: 1.96, thalassa: 2.03, despina: 2.13, galatea: 2.52, larissa: 2.99,
  hippocamp: 4.28, proteus: 4.78, triton: 14.4, nereid: 223.97,
  halimede: 674.7, sao: 918.7, laomedeia: 959.0, psamathe: 1896.6, neso: 1965.3,
  // Jupiter (57 officially named moons -- all currently-known moons minus
  // ~58 with only a provisional S/year designation; see Wikipedia "Moons of
  // Jupiter" semi-major-axis table, cross-checked Galilean four against NASA/JPL).
  metis: 1.83, adrastea: 1.85, amalthea: 2.59, thebe: 3.17, io: 6.03,
  europa: 9.6, ganymede: 15.3, callisto: 26.9, themisto: 106, leda: 159,
  ersa: 163, himalia: 164, pandia: 164, lysithea: 167, elara: 168,
  dia: 175, carpo: 244, valetudo: 267, euporie: 276, eupheme: 297,
  mneme: 298, euanthe: 298, harpalyke: 299, orthosie: 299, helike: 299,
  praxidike: 299, thelxinoe: 300, thyone: 300, ananke: 301, iocaste: 301,
  hermippe: 302, philophrosyne: 323, pasithee: 327, eurydome: 327, chaldene: 328,
  isonoe: 329, kallichore: 329, erinome: 329, kale: 330, eirene: 330,
  aitne: 330, eukelade: 330, arche: 330, taygete: 330, carme: 331,
  herse: 331, kalyke: 333, hegemone: 334, pasiphae: 336, sponde: 337,
  megaclite: 338, cyllene: 338, sinope: 339, aoede: 340, autonoe: 340,
  callirrhoe: 340, kore: 346,
  // Saturn (63 officially named moons -- all currently-known moons minus
  // ~230 with only a provisional S/year designation, mostly the small
  // irregular satellites announced in 2019-2023 batches; see Wikipedia
  // "Moons of Saturn", sourced from JPL Solar System Dynamics "Planetary
  // Satellite Mean Elements", cross-checked Titan/Iapetus against NASA NSSDC).
  pan: 2.29, daphnis: 2.34, atlas: 2.36, prometheus: 2.39, pandora: 2.43,
  epimetheus: 2.6, janus: 2.6, aegaeon: 2.88, mimas: 3.19, methone: 3.34,
  anthe: 3.4, pallene: 3.65, enceladus: 4.09, tethys: 5.07, telesto: 5.07,
  calypso: 5.07, helene: 6.48, polydeuces: 6.48, dione: 6.49, rhea: 9.05,
  titan: 21, hyperion: 25.4, iapetus: 61.2, kiviuq: 194, ijiraq: 195,
  phoebe: 222, paaliaq: 258, skathi: 267, albiorix: 280, bebhionn: 292,
  erriapus: 301, skoll: 303, tarqeq: 305, siarnaq: 307, tarvos: 313,
  hyrrokkin: 315, greip: 316, mundilfari: 319, gridr: 331, bergelmir: 331,
  jarnsaxa: 331, narvi: 331, suttungr: 333, hati: 338, eggther: 341,
  farbauti: 348, thrymr: 349, bestla: 349, angrboda: 354, aegir: 355,
  beli: 356, gerd: 360, gunnlod: 363, skrymir: 368, alvaldi: 378,
  kari: 378, geirrod: 382, fenrir: 383, surtur: 391, loge: 394,
  ymir: 394, thiazzi: 405, fornjot: 428,
  // Uranus (27 officially named moons; S/2023 U1 and S/2025 U1 -- the
  // latter a JWST discovery -- are still provisional and excluded here.
  // See Wikipedia "Moons of Uranus", cross-checked the five major moons
  // against NASA NSSDCA's fact sheet).
  cordelia: 1.96, ophelia: 2.12, bianca: 2.33, cressida: 2.44, desdemona: 2.47,
  juliet: 2.54, portia: 2.61, rosalind: 2.76, cupid: 2.93, belinda: 2.97,
  perdita: 3.01, puck: 3.39, mab: 3.85, miranda: 5.12, ariel: 7.53,
  umbriel: 10.5, titania: 17.2, oberon: 23, francisco: 169, caliban: 283,
  stephano: 314, trinculo: 335, sycorax: 481, margaret: 569, prospero: 640,
  setebos: 691, ferdinand: 805,
};
// Log-compressed so the ~22x real spread (Phobos to Iapetus) becomes a
// manageable ~2-5 hex gap while still ordering/spacing moons the same way
// their real distances do.
const gapForRatio = ratio => Math.max(1, Math.round(1 + 2 * Math.log10(ratio)));

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
  return [{ id: `${faction}-fleet`, label: String(SHIPS_PER_FACTION), kind: "fleet", faction }];
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
// Same facing convention deployFormation (battle/formations.js) uses for
// side 0: df===0 faces straight ahead, df>0/df<0 angle toward the flank.
// There's no real "attacker" here (just one fleet previewed on its own),
// so this is an arbitrary but fixed orientation, not tied to any faction.
const FACING = { straight: 0, toPos: 5, toNeg: 1 };
export function formationBoard(faction, formationName) {
  const { u, flag } = formationLayout(formationName, SHIPS_PER_FACTION);
  const hexRadius = rings(FORMATION_BOARD_RINGS);
  const center = [hexRadius, hexRadius];
  const cells = u.map(([fwd, lat, df], i) => ({
    id: `ship${i}`, label: i === flag ? "★" : String(i + 1),
    kind: "ownship", faction, isFlag: i === flag,
    facing: df === 0 ? FACING.straight : (df > 0 ? FACING.toPos : FACING.toNeg),
    pos: [center[0] + fwd, center[1] + lat],
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
    ...moons.map(name => {
      const id = name.toLowerCase();
      return { id, label: name, kind: "moon", gap: gapForRatio(MOON_DISTANCE_RATIO[id] || 10) };
    }),
    ...fleetAt(bodyId),
  ];
  const board = radialBoard({ id: bodyId, label, kind: "body-center", size: SIZE[bodyId] || 0 }, items);
  return { title: label, hs: hsForRadius(board.radius), ...board };
}

export function bodyLabel(systemId, bodyId) {
  const cell = SYSTEMS[systemId].cells.find(c => c.id === bodyId);
  return cell ? cell.label : bodyId;
}
