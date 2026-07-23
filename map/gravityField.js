import { hexCorners, hexDist } from "../battle/hexmath.js";

export function gravityHexRadius({ bodyRadiusPx, hexSizePx, factor = 4 }) {
  if (!Number.isFinite(bodyRadiusPx) || !Number.isFinite(hexSizePx) || hexSizePx <= 0) return 0;
  return Math.max(1, Math.ceil(Math.max(0, bodyRadiusPx) * factor / hexSizePx));
}

export function hexDiskCells([centerC, centerR], radius) {
  const normalizedRadius = Math.max(0, Math.floor(Number(radius) || 0));
  const cells = [];
  for (let row = centerR - normalizedRadius; row <= centerR + normalizedRadius; row++) {
    for (let column = centerC - normalizedRadius; column <= centerC + normalizedRadius; column++) {
      if (hexDist([centerC, centerR], [column, row]) <= normalizedRadius) cells.push([column, row]);
    }
  }
  return cells;
}

const pointKey = ([x, z]) => `${x.toFixed(6)},${z.toFixed(6)}`;

function edgeKey(a, b) {
  const ka = pointKey(a), kb = pointKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

export function warpGravityPoint(x, z, wells, hexSize) {
  let warpedX = x, warpedZ = z;
  for (const well of wells) {
    const dx = well.x - x, dz = well.z - z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-6) continue;
    const falloff = Math.max(well.rPx * 2, hexSize);
    // This is a screen-space explanation of the current, not a coordinate
    // transform for physics.  Bound it below half a hex so deformed cells
    // remain individually legible and pointer inversion stays unambiguous.
    const strength = Math.min(well.rPx * 9, hexSize * 0.42);
    const pull = Math.min(
      strength * Math.exp(-(distance * distance) / (falloff * falloff)),
      distance * 0.85,
    );
    const inwardX = dx / distance, inwardZ = dz / distance;
    const spin = well.spinDirection ?? 1;
    // Match the gameplay current: a small inward tug plus a stronger
    // tangential sweep bends the field into readable spiral arms.
    warpedX += inwardX * pull * 0.35 - inwardZ * pull * spin * 0.7;
    warpedZ += inwardZ * pull * 0.35 + inwardX * pull * spin * 0.7;
  }
  return [warpedX, warpedZ];
}

// Builds one fill and line batch per body color. Adjacent same-color hexes
// share an edge, so emit that edge once with the stronger of its two cost
// intensities. LineSegments2 expands every segment into screen-facing quads;
// removing duplicates therefore saves both CPU-side data and GPU vertices.
export function buildGravityFieldGroups(cells, wells, hexSize, intensityForCost) {
  const groups = new Map();
  const warpedPoints = new Map();

  function warped(point) {
    const key = pointKey(point);
    if (!warpedPoints.has(key)) {
      warpedPoints.set(key, warpGravityPoint(point[0], point[1], wells, hexSize));
    }
    return warpedPoints.get(key);
  }

  for (const { colorHex, x, y, cost } of cells.values()) {
    const corners = hexCorners(x, y, hexSize);
    let group = groups.get(colorHex);
    if (!group) {
      group = { triangles: [], intensities: [], edges: new Map() };
      groups.set(colorHex, group);
    }
    const intensity = intensityForCost(cost);
    for (let k = 0; k < 6; k++) {
      const from = corners[k], to = corners[(k + 1) % 6];
      // Fills and thick edges must share the same warped geometry.  Keeping
      // only the lines warped was the source of the misleading preview.
      group.triangles.push(warped([x, y]), warped(from), warped(to));
      group.intensities.push(intensity, intensity, intensity);
      const key = edgeKey(from, to);
      const existing = group.edges.get(key);
      if (!existing || intensity > existing.intensity) {
        group.edges.set(key, { from: warped(from), to: warped(to), intensity });
      }
    }
  }

  for (const group of groups.values()) {
    group.lineSegments = [];
    group.lineIntensities = [];
    for (const { from, to, intensity } of group.edges.values()) {
      group.lineSegments.push(from, to);
      group.lineIntensities.push(intensity, intensity);
    }
    group.edgeCount = group.edges.size;
    delete group.edges;
  }
  return groups;
}
