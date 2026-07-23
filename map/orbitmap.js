// Lays out a center body plus a list of real (distanceKm, radiusKm,
// orbit) bodies into pixel space (log-compressed distance and size, see
// orbits.js, so everything fits on screen at once with no panning), draws
// them, and hit-tests clicks against them. Used for the Universe/System/
// Body maps; Battle stays hex-based (battle/hexmath.js), unrelated.

import { angleAtDeg, makeDistanceScale, makeSizeScale, hashAngleDeg, orbitEccentricity } from "./orbits.js";

export function layoutOrbitalBoard(data, { maxPixel = 420, nowMs = Date.now(), extraBodies = [] } = {}) {
  const centerRadiusKm = data.center?.radiusKm || 0;
  const allDistances = [...data.bodies, ...extraBodies].map(b => b.distanceKm);
  const maxDistanceKm = Math.max(1, ...allDistances);
  const dist = makeDistanceScale(maxDistanceKm, maxPixel, Math.max(1, centerRadiusKm));
  const maxRadiusKm = Math.max(centerRadiusKm, 1, ...data.bodies.map(b => b.radiusKm || 0));
  const size = makeSizeScale(maxRadiusKm);

  const place = b => {
    const angleDeg = b.orbit ? angleAtDeg(nowMs, b.orbit) : (b.angleDeg || 0);
    const rad = angleDeg * Math.PI / 180;
    const r = dist.toPixel(b.distanceKm);
    const eccentricity = orbitEccentricity(b.id);
    return {
      ...b,
      x: r * Math.cos(rad),
      y: r * Math.sqrt(1 - eccentricity ** 2) * Math.sin(rad),
      rPx: size(b.radiusKm || 0), angleDeg, orbitRadiusPx: r, eccentricity,
    };
  };
  const placed = data.bodies.map(place);
  const center = data.center ? { ...data.center, x: 0, y: 0, rPx: size(centerRadiusKm) } : null;
  return { center, placed, dist, size, maxPixel };
}

// Converts a click's (x,y) -- already relative to the board's own center --
// into a real (xKm,yKm), the inverse of how layoutOrbitalBoard placed
// everything. Used for fleet movement: wherever you click becomes the
// fleet's new real position.
export function pixelToKm(layout, x, y) {
  const pxR = Math.hypot(x, y);
  const angle = Math.atan2(y, x);
  const km = layout.dist.toDistance(pxR);
  return [km * Math.cos(angle), km * Math.sin(angle)];
}

// A faint orbit-path ring -- shared by drawOrbitalBoard's own per-body
// loop below and map/main.js's drawRing (which also needs an arbitrary
// center, for moon-around-planet rings, not just the board origin), so
// the color/width and the "too small to bother drawing" cutoff can't
// drift apart between the two.
export function strokeFaintRing(ctx, cx, cy, r, color = "#1d2438", eccentricity = 0, angleDeg = 0, gapDeg = 10) {
  if (r < 1) return;
  ctx.beginPath();
  const minor = r * Math.sqrt(1 - eccentricity ** 2);
  const start = (angleDeg + gapDeg) * Math.PI / 180;
  const end = angleDeg * Math.PI / 180 + Math.PI * 2;
  const steps = 96;
  for (let index = 0; index <= steps; index++) {
    const angle = start + (end - start) * index / steps;
    const x = cx + r * Math.cos(angle), y = cy + minor * Math.sin(angle);
    if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = previousAlpha * 0.65;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = previousAlpha;
}

export function drawOrbitalBoard(ctx, layout, { colorsFor, isSelected, labelMinPx = 0 }) {
  for (const b of layout.placed) {
    if (!b.orbit) continue;
    strokeFaintRing(ctx, 0, 0, b.orbitRadiusPx, colorsFor(b).fill, b.eccentricity, b.angleDeg);
  }

  const drawDot = b => {
    const colors = colorsFor(b);
    const selected = isSelected?.(b);
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.rPx, 0, Math.PI * 2);
    ctx.fillStyle = colors.fill;
    ctx.fill();
    ctx.lineWidth = selected ? 3 : 2;
    ctx.strokeStyle = selected ? "#ffffff" : colors.stroke;
    ctx.stroke();
  };
  const drawLabel = b => {
    if (b.rPx < labelMinPx) return;
    ctx.font = "bold 11px system-ui";
    ctx.textAlign = "center";
    ctx.fillStyle = "#d7deef";
    ctx.fillText(b.label, b.x, b.y + b.rPx + 13);
  };

  if (layout.center) drawDot(layout.center);
  for (const b of layout.placed) drawDot(b);
  if (layout.center?.label) drawLabel(layout.center);
  for (const b of layout.placed) drawLabel(b);
}

// The merged System+Body view: every planet's moons nest inside it, placed
// with their own small local scale (own distance/size range, not the
// system's) and offset onto the planet's own world position -- so at
// zoom 1 a moon cluster collapses to a few pixels around its planet
// (correctly, since real moon-to-planet distances are tiny next to
// planet-to-sun distances), and zooming the 3D camera in (see
// map/scene3d.js) is what reveals it, the same way zooming a map reveals
// street detail.
export function layoutSystemWithMoons(data, { maxPixel = 420, localMaxPixel = 22, nowMs = Date.now() } = {}) {
  const centerRadiusKm = data.center?.radiusKm || 0;
  const maxDistanceKm = Math.max(1, ...data.bodies.map(b => b.distanceKm));
  const dist = makeDistanceScale(maxDistanceKm, maxPixel, Math.max(1, centerRadiusKm));
  const allRadiiKm = data.bodies.flatMap(b => [b.radiusKm || 0, ...(b.moons || []).map(m => m.radiusKm || 0)]);
  const maxRadiusKm = Math.max(centerRadiusKm, 1, ...allRadiiKm);
  // One shared, Sun-anchored size scale for the Sun, every planet, AND
  // every moon -- a moon's sphere is always drawn to the same physical-
  // size curve as its planet's, just further along it, so "planet clearly
  // bigger than its own moons" holds regardless of which planet or moon.
  // World-space sizes like these are zoom-invariant in the 3D scene (an
  // orthographic camera's zoom scales everything uniformly), so unlike the
  // old flat-canvas version, no extra draw-time clamping is needed to keep
  // that true. A low floor (vs. a higher fixed one) keeps real moons --
  // all far smaller than any planet -- visibly different in size from
  // each other rather than every one flattening to an identical floor dot.
  const size = makeSizeScale(maxRadiusKm, { min: 0.6, max: 34 });

  const planets = data.bodies.map(b => {
    const angleDeg = b.orbit ? angleAtDeg(nowMs, b.orbit) : 0;
    const rad = angleDeg * Math.PI / 180;
    const r = dist.toPixel(b.distanceKm);
    const eccentricity = orbitEccentricity(b.id);
    const x = r * Math.cos(rad), y = r * Math.sqrt(1 - eccentricity ** 2) * Math.sin(rad);
    const rPx = size(b.radiusKm || 0);

    const moons = b.moons || [];
    let placedMoons = [];
    if (moons.length) {
      const localMaxDistanceKm = Math.max(1, ...moons.map(m => m.distanceKm));
      const localDist = makeDistanceScale(localMaxDistanceKm, localMaxPixel, Math.max(1, b.radiusKm || 1));
      // localDist is computed purely from real km ratios, with no idea how
      // big the planet actually renders (rPx, from the Sun-anchored size
      // scale above -- a wholly separate scale). Nothing otherwise stops a
      // real close-orbiting moon (Jupiter's Metis, Saturn's Pan, ...) from
      // landing inside the planet's own sphere once rPx is large enough
      // relative to localMaxPixel, which is exactly what happened for
      // every gas giant's innermost moons. Offsetting every moon's
      // distance by the planet's own radius plus a fixed clearance
      // guarantees a moon can never render inside its planet, regardless
      // of how big that planet is.
      const clearance = rPx + 4;
      placedMoons = moons.map(m => {
        // Real distances genuinely cluster close together for several of a
        // planet's minor moons, and a minor moon's angle is itself a
        // synthetic hash (see levels.js) -- together those can coincidentally
        // put two unrelated moons at nearly the same final spot (checked
        // across the whole system: 27 pairs of moon spheres visibly
        // touching, before this). Small deterministic jitter in both
        // distance and angle, each keyed independently of the real angle
        // hash, spreads most of that apart (down to ~8 pairs) without
        // moving anything far enough to reorder real moons by distance or
        // meaningfully misrepresent a real major moon's position -- pushing
        // the jitter range further starts trading that accuracy for
        // diminishing returns, since a few of the remaining pairs are
        // minor moons that are also genuinely close in real distance.
        const angleJitter = (hashAngleDeg(m.id + "-angle") / 360 - 0.5) * 8;
        const mAngleDeg = (m.orbit ? angleAtDeg(nowMs, m.orbit) : 0) + angleJitter;
        const mRad = mAngleDeg * Math.PI / 180;
        const radialJitter = (hashAngleDeg(m.id + "-radial") / 360 - 0.5) * 8;
        const lr = clearance + localDist.toPixel(m.distanceKm) + radialJitter;
        const localX = lr * Math.cos(mRad), localZ = lr * Math.sin(mRad);

        // Real inclination (the ~18 major moons only -- see MAJOR_MOON_ORBIT
        // in levels.js; minor moons have no reliable inclination data any
        // more than they have a reliable reference angle) tilts a moon's
        // orbital plane relative to the flat plane everything else sits on,
        // rotated around the local X axis -- an arbitrary but fixed
        // "ascending node" simplification, since real per-moon node data is
        // out of scope here. Retrograde motion (only Triton among these) is
        // already handled separately via a negative orbital period, so only
        // the tilt MAGNITUDE (folding >90 degrees back down) feeds the
        // geometry -- 3D and 2D consumers both still get x/y (flat, the 2D
        // fallback's only concept of position); tiltHeight/tiltZ are the
        // additional 3D-only, tilt-corrected height and depth.
        const incDeg = m.inclinationDeg || 0;
        const tiltDeg = incDeg > 90 ? 180 - incDeg : incDeg;
        const tiltRad = tiltDeg * Math.PI / 180;
        return {
          ...m, x: x + localX, y: y + localZ,
          tiltHeight: -localZ * Math.sin(tiltRad), tiltZ: y + localZ * Math.cos(tiltRad),
          rPx: size(m.radiusKm || 0), angleDeg: mAngleDeg, inclinationDeg: tiltDeg,
          parentId: b.id, parentLabel: b.label, localRingPx: lr,
        };
      });
    }
    return { ...b, x, y, rPx, angleDeg, orbitRadiusPx: r, eccentricity, moons: placedMoons };
  });

  const center = data.center ? { ...data.center, x: 0, y: 0, rPx: size(centerRadiusKm) } : null;
  return { center, planets, dist, size };
}

// A 2D pan (x,y, in the same world-px units layoutOrbitalBoard/
// layoutSystemWithMoons use) plus a zoom multiplier -- screen coordinates
// are canvas-center-relative, same convention as everything else here.
// Used by the 2D System-map fallback (map/main.js) for browsers where
// WebGL/map/scene3d.js's real 3D view isn't available.
export function worldToScreen(camera, x, y) {
  return [(x - camera.x) * camera.zoom, (y - camera.y) * camera.zoom];
}
export function screenToWorld(camera, sx, sy) {
  return [camera.x + sx / camera.zoom, camera.y + sy / camera.zoom];
}

// Nearest body (real or extra, e.g. a fleet marker) within its own click
// radius -- or a minimum tap target, since some real bodies render smaller
// than a comfortable click target -- of (x,y). Null if nothing's close
// enough. (x,y) is already relative to the board's own center.
export function hitTest(layout, x, y, extraBodies = [], minTapPx = 10) {
  const all = [...(layout.center ? [layout.center] : []), ...layout.placed, ...extraBodies];
  let best = null, bestD = Infinity;
  for (const b of all) {
    const d = Math.hypot(x - b.x, y - b.y);
    const tap = Math.max(b.rPx ?? 0, minTapPx);
    if (d <= tap && d < bestD) { best = b; bestD = d; }
  }
  return best;
}
