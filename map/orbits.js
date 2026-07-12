// Real orbital mechanics for the Universe/System/Body maps: bodies sit at
// their true (to-scale, log-compressed for legibility) distance from their
// parent, at the angle they're actually at right now -- computed live from
// mean motion each time render() runs, not baked to one hardcoded date.
//
// Two tiers of "real":
//  - Major bodies (the Sun's 8 planets, plus the ~17 moons everyone's heard
//    of -- Galilean four, Titan/Rhea/Iapetus/Dione/Tethys, the five big
//    Uranian moons, Triton, Phobos/Deimos, the Moon) get a genuine
//    reference angle + epoch sourced from real ephemeris data, projected
//    forward/back via mean motion.
//  - Everyone else (the ~150 minor/irregular moons) gets a real orbital
//    *period*, honestly derived from Kepler's third law using their real
//    semi-major axis and their parent's real GM -- but their phase (where
//    on that circle they start) is a stable synthetic value, not fabricated
//    ephemeris data, since reliable reference angles for that many small
//    bodies aren't practically sourceable.

export const AU_KM = 149597870.7;

// Mean physical radius, km.
export const BODY_RADIUS_KM = {
  sun: 696000,
  mercury: 2440, venus: 6052, earth: 6371, mars: 3390,
  jupiter: 69911, saturn: 58232, uranus: 25362, neptune: 24622,
};

// Real mean radius, km, for the ~17 "major" moons anyone's heard of --
// solid, well-measured values. Minor/irregular moons don't get an entry
// here (see MOONS/minorMoonRadiusKm in levels.js): most are small captured
// bodies whose radius is only known to rough magnitude-based estimates, if
// at all, so we don't claim false precision for ~150 of them.
export const MAJOR_MOON_RADIUS_KM = {
  moon: 1737, phobos: 11, deimos: 6,
  io: 1821, europa: 1560, ganymede: 2634, callisto: 2410,
  titan: 2575, rhea: 764, iapetus: 735, dione: 561, tethys: 531,
  titania: 788, oberon: 761, miranda: 235, ariel: 579, umbriel: 585,
  triton: 1353,
};

// GM (standard gravitational parameter) of each planet, km^3/s^2 -- used to
// derive minor moons' real orbital period from their real semi-major axis
// via Kepler's third law, since a period lookup for ~150 objects isn't
// practical the way a semi-major-axis lookup was.
export const PARENT_GM_KM3S2 = {
  jupiter: 1.26686534e8,
  saturn: 3.7931187e7,
  uranus: 5.793939e6,
  neptune: 6.836529e6,
};

export function keplerPeriodDays(semiMajorAxisKm, gmKm3s2) {
  const periodSeconds = 2 * Math.PI * Math.sqrt(semiMajorAxisKm ** 3 / gmKm3s2);
  return periodSeconds / 86400;
}

// A body's orbital motion: refAngleDeg is where it sits (mean longitude/
// anomaly, doesn't matter which -- we're not modeling eccentricity, just a
// circle) at refEpochMs; periodDays projects that forward to any other time.
// Negative periodDays means retrograde (Triton, notably).
export function angleAtDeg(nowMs, { refAngleDeg, refEpochMs, periodDays }) {
  const days = (nowMs - refEpochMs) / 86400000;
  const deg = refAngleDeg + 360 * (days / periodDays);
  return ((deg % 360) + 360) % 360;
}

export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

// Deterministic "random" angle from a body's id, stable across reloads --
// used as the synthetic reference phase for minor moons instead of
// fabricating a precise ephemeris value we don't actually have.
export function hashAngleDeg(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

// Maps a set of real distances (km) to pixel radii: log-compressed (like
// the old hex-gap scheme, but continuous) so the whole system fits on
// screen at once with no panning, while farther-out bodies still always
// land farther out. d0 anchors where the compression "starts" (roughly the
// center body's own radius); anything at or inside it sits at pixel 0.
// Returns both directions -- toDistance is what lets a click on empty
// space resolve to a real (xKm,yKm), e.g. for fleet movement.
export function makeDistanceScale(maxDistanceKm, maxPixel, d0 = 1) {
  const denom = Math.log10(1 + maxDistanceKm / d0);
  const toPixel = d => denom <= 0 ? 0 : maxPixel * Math.log10(1 + Math.max(0, d) / d0) / denom;
  const toDistance = px => d0 * (10 ** (Math.max(0, px) * denom / maxPixel) - 1);
  return { toPixel, toDistance };
}

// Maps real body radii (km) to pixel radii: sqrt-compressed and clamped so
// the Sun doesn't dwarf a heavy planet into invisibility and a small moon
// stays big enough to read as a shape and to hit-test/click on.
export function makeSizeScale(maxRadiusKm, { min = 3, max = 34 } = {}) {
  const scale = Math.sqrt(maxRadiusKm);
  return r => Math.max(min, Math.min(max, (Math.sqrt(Math.max(0, r)) / scale) * max));
}
