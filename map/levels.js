// Data for the three strategic zoom levels. Battle (the fourth level) is
// battle.html/battle/* unchanged -- CelestialBody hexes link out to it.
//
// Universe/System/Body are a real (to-scale, log-compressed for legibility)
// orbital view: distance from parent, size, and angular position are
// genuine -- not a stylized layout -- computed live at render time (see
// map/orbits.js for the math, map/orbitmap.js for how it's drawn).
//
// This is still a test fixture in the sense that Sol is the only system in
// the universe so far, and only "well-known" moons (the ones with a common
// name) are modeled, not every rock ever catalogued.

export { FORMATION_NAMES } from "../battle/config.js";
import {
  AU_KM, BODY_RADIUS_KM, MAJOR_MOON_RADIUS_KM, PARENT_GM_KM3S2,
  keplerPeriodDays, angleAtDeg, J2000_MS, hashAngleDeg,
  BELT_INNER_AU, BELT_OUTER_AU,
} from "./orbits.js";

// ---------------------------------------------------------------------
// Real solar-system data
// ---------------------------------------------------------------------

// Semi-major axis, AU, for the Sun's 8 planets -- and a representative
// distance for the asteroid belt, which isn't a single real body so it
// doesn't get a "real" orbit the way a planet or moon does.
const PLANET_AXIS_AU = {
  mercury: 0.387, venus: 0.723, earth: 1.000, mars: 1.524,
  jupiter: 5.203, saturn: 9.537, uranus: 19.191, neptune: 30.069,
};
const BELT_AXIS_AU = 2.7;

// Mean longitude at the J2000.0 epoch (degrees) and each planet's real
// orbital period (days) -- the standard "Keplerian elements for
// approximate positions of the major planets" (Standish/JPL,
// ssd.jpl.nasa.gov/planets/approx_pos.html). Projected forward to "now" via
// angleAtDeg (mean motion) every render, not baked to one hardcoded date.
const PLANET_ORBIT = {
  mercury: { refAngleDeg: 252.250324, periodDays: 87.969 },
  venus:   { refAngleDeg: 181.979099, periodDays: 224.701 },
  earth:   { refAngleDeg: 100.464572, periodDays: 365.256 },
  mars:    { refAngleDeg: 355.446568, periodDays: 686.980 },
  jupiter: { refAngleDeg: 34.396441,  periodDays: 4332.817 },
  saturn:  { refAngleDeg: 49.954244,  periodDays: 10755.884 },
  uranus:  { refAngleDeg: 313.238105, periodDays: 30687.401 },
  neptune: { refAngleDeg: 304.87997,  periodDays: 60189.659 },
};
const planetOrbit = id => ({ ...PLANET_ORBIT[id], refEpochMs: J2000_MS });

const SYSTEMS_DEF = {
  sol: {
    title: "Sol System",
    star: { id: "sun", label: "Sun", kind: "star" },
    planets: [
      { id: "mercury", label: "Mercury" },
      { id: "venus",   label: "Venus" },
      { id: "earth",   label: "Earth" },
      { id: "mars",    label: "Mars" },
      { id: "belt",    label: "Asteroid Belt", kind: "belt" },
      { id: "jupiter", label: "Jupiter" },
      { id: "saturn",  label: "Saturn" },
      { id: "uranus",  label: "Uranus" },
      { id: "neptune", label: "Neptune" },
    ],
  },
};

// The universe is otherwise-empty space with Sol as its one system so far
// -- it just sits at the origin, real position not meaningful with only
// one system to place.
export function universeLevel() {
  return {
    title: "Universe",
    center: null,
    bodies: [{
      id: "sol", label: "Sol", kind: "system", radiusKm: BODY_RADIUS_KM.sun,
      distanceKm: 0, orbit: null, enter: { level: "system", systemId: "sol" },
    }],
  };
}

// The System map is the merged Star+Body view: every planet carries its own
// moons nested alongside it (moonsOf's own per-planet moon list, reused
// as-is), so zooming the camera in on a planet is what reveals them --
// there's no separate screen to navigate to anymore (see map/orbitmap.js's
// layoutSystemWithMoons for how a moon's position nests inside its planet's).
export function systemLevel(systemId) {
  const def = SYSTEMS_DEF[systemId];
  const bodies = def.planets.map(p => {
    if (p.kind === "belt") {
      return {
        id: p.id, label: p.label, kind: "belt", radiusKm: 0,
        distanceKm: BELT_AXIS_AU * AU_KM,
        orbit: { refAngleDeg: hashAngleDeg(p.id), refEpochMs: J2000_MS, periodDays: 365.25636 * BELT_AXIS_AU ** 1.5 },
        // Real bounds of the actual main belt -- see beltParticles in
        // orbits.js, which the renderer uses to scatter a decorative
        // particle cloud across this range instead of drawing the belt
        // as the single point above (that point still anchors the click
        // target/camera-focus behavior, unchanged).
        beltInnerAU: BELT_INNER_AU, beltOuterAU: BELT_OUTER_AU,
        moons: [],
      };
    }
    return {
      id: p.id, label: p.label, kind: "planet", radiusKm: BODY_RADIUS_KM[p.id],
      distanceKm: PLANET_AXIS_AU[p.id] * AU_KM, orbit: planetOrbit(p.id),
      moons: moonsOf(p.id),
    };
  });
  return { title: def.title, center: { ...def.star, radiusKm: BODY_RADIUS_KM[def.star.id] }, bodies };
}

// Only the bodies with well-known moons get any -- everyone else just has
// an empty view around them.
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
// an AU-scale outlier around Saturn. Multiplied by the parent's real radius
// (BODY_RADIUS_KM) to get each moon's real distanceKm.
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

// The ~18 moons anyone's actually heard of get a genuine reference angle +
// period + inclination sourced from JPL's "Planetary Satellite Mean
// Elements" (ssd.jpl.nasa.gov/sats/elem, epoch 2000-01-01.5 TDB, mean
// anomaly) -- projected forward to "now" the same way the planets are.
// Triton's period is negative: its orbit is retrograde. inclinationDeg is
// relative to each moon's own local Laplace plane (Uranus's moons: Uranus's
// equator; the Moon: the ecliptic) -- not the planet's orbital plane around
// the Sun, which is what this map otherwise treats as "flat", so it's a
// real but not perfectly apples-to-apples tilt; see layoutSystemWithMoons
// in orbitmap.js for how it's actually applied. Everyone else (the ~150
// minor/irregular moons) gets moonOrbit()'s fallback below: a real period
// (Kepler's third law from their real distance) but a synthetic phase and
// no inclination, since reliable data for that many small, often poorly-
// constrained bodies isn't practically available -- see orbits.js's header.
const MAJOR_MOON_ORBIT = {
  moon:     { refAngleDeg: 135.27, periodDays: 27.322,     inclinationDeg: 5.16 },
  phobos:   { refAngleDeg: 189.7,  periodDays: 0.3187,     inclinationDeg: 1.1 },
  deimos:   { refAngleDeg: 205.0,  periodDays: 1.2625,     inclinationDeg: 1.8 },
  io:       { refAngleDeg: 330.9,  periodDays: 1.762732,   inclinationDeg: 0.0 },
  europa:   { refAngleDeg: 345.4,  periodDays: 3.525463,   inclinationDeg: 0.5 },
  ganymede: { refAngleDeg: 324.8,  periodDays: 7.155588,   inclinationDeg: 0.2 },
  callisto: { refAngleDeg: 87.4,   periodDays: 16.69044,   inclinationDeg: 0.3 },
  tethys:   { refAngleDeg: 0.0,    periodDays: 1.887802,   inclinationDeg: 1.1 },
  dione:    { refAngleDeg: 212.0,  periodDays: 2.736916,   inclinationDeg: 0.0 },
  rhea:     { refAngleDeg: 31.5,   periodDays: 4.517503,   inclinationDeg: 0.3 },
  titan:    { refAngleDeg: 11.7,   periodDays: 15.945448,  inclinationDeg: 0.3 },
  iapetus:  { refAngleDeg: 74.8,   periodDays: 79.331002,  inclinationDeg: 7.6 },
  ariel:    { refAngleDeg: 193.5,  periodDays: 2.520379,   inclinationDeg: 0.0 },
  umbriel:  { refAngleDeg: 253.0,  periodDays: 4.144177,   inclinationDeg: 0.1 },
  titania:  { refAngleDeg: 68.1,   periodDays: 8.705869,   inclinationDeg: 0.1 },
  oberon:   { refAngleDeg: 143.6,  periodDays: 13.463237,  inclinationDeg: 0.1 },
  miranda:  { refAngleDeg: 73.0,   periodDays: 1.413479,   inclinationDeg: 4.4 },
  triton:   { refAngleDeg: 63.0,   periodDays: -5.876994,  inclinationDeg: 157.3 },
};

function moonRadiusKm(id) {
  if (MAJOR_MOON_RADIUS_KM[id] != null) return MAJOR_MOON_RADIUS_KM[id];
  // Minor/irregular moon: real radius isn't reliably known for most of
  // these small captured bodies, so use a small stable synthetic size (2-11
  // km) rather than claim false precision.
  return 2 + (hashAngleDeg(id + "-size") % 10);
}
function moonOrbit(id, parentId, distanceKm) {
  const major = MAJOR_MOON_ORBIT[id];
  if (major) return { ...major, refEpochMs: J2000_MS };
  const periodDays = keplerPeriodDays(distanceKm, PARENT_GM_KM3S2[parentId]);
  return { refAngleDeg: hashAngleDeg(id), refEpochMs: J2000_MS, periodDays };
}

function moonsOf(bodyId) {
  const parentRadiusKm = BODY_RADIUS_KM[bodyId] || 0;
  return (MOONS[bodyId] || []).map(name => {
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const distanceKm = (MOON_DISTANCE_RATIO[id] || 10) * parentRadiusKm;
    return {
      id, label: name, kind: "moon", radiusKm: moonRadiusKm(id), distanceKm,
      orbit: moonOrbit(id, bodyId, distanceKm), inclinationDeg: MAJOR_MOON_ORBIT[id]?.inclinationDeg,
    };
  });
}

// ---------------------------------------------------------------------
// Fleets: each faction's real position in the Sol system (Sun-centered
// xKm,yKm), movable by the player -- in-memory only, like FLEET_FORMATIONS
// below (resets on reload). Rendered at the System level, near whichever
// planet they're currently at; a Battle is triggered from there once two
// different factions' fleets are close enough (see map/main.js).
// ---------------------------------------------------------------------

export const FACTIONS = {
  blue:  { label: "Blue",  startAt: "earth" },
  green: { label: "Green", startAt: "saturn" },
  red:   { label: "Red",   startAt: "jupiter" },
};
export const SHIPS_PER_FACTION = 12;

export const FLEET_POSITIONS = {};

// A fleet starts just off its home planet's real current position (a fixed
// angular nudge, not a literal overlap) so its marker doesn't sit exactly
// on top of the planet's own.
export function initFleetPositions(nowMs = Date.now()) {
  for (const [faction, f] of Object.entries(FACTIONS)) {
    if (FLEET_POSITIONS[faction]) continue;
    const distanceKm = PLANET_AXIS_AU[f.startAt] * AU_KM;
    const angleDeg = angleAtDeg(nowMs, planetOrbit(f.startAt)) + 10;
    const rad = angleDeg * Math.PI / 180;
    FLEET_POSITIONS[faction] = { xKm: distanceKm * Math.cos(rad), yKm: distanceKm * Math.sin(rad) };
  }
}
export function moveFleet(faction, xKm, yKm) {
  FLEET_POSITIONS[faction] = { xKm, yKm };
}

// Each faction's chosen formation, in memory only (resets on reload) --
// set directly from the System map's info panel (main.js), read again
// once a battle actually triggers so deployment isn't just random. "line"
// until chosen.
export const FLEET_FORMATIONS = { blue: "line", green: "line", red: "line" };
