// The continuous-space counterpart to hexgrid.js's makeHexGrid -- lays out
// a center body plus a list of real (distanceKm, radiusKm, orbit) bodies
// into pixel space (log-compressed distance and size, see orbits.js, so
// everything fits on screen at once with no panning), draws them, and
// hit-tests clicks against them. Used for the Universe/System/Body maps;
// Formation Setup and Battle stay hex-based and keep using hexgrid.js.

import { angleAtDeg, makeDistanceScale, makeSizeScale } from "./orbits.js";

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
    return { ...b, x: r * Math.cos(rad), y: r * Math.sin(rad), rPx: size(b.radiusKm || 0), angleDeg };
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

export function drawOrbitalBoard(ctx, layout, { colorsFor, isSelected, labelMinPx = 0 }) {
  ctx.strokeStyle = "#1d243855";
  ctx.lineWidth = 1;
  for (const b of layout.placed) {
    if (!b.orbit) continue;
    const r = Math.hypot(b.x, b.y);
    if (r < 1) continue;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
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
