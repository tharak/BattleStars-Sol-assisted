// Visual-only Ship layouts inside one Fleet hex.  A Fleet remains the one
// rules entity; these offsets turn its current Strength into a grander
// miniature formation without creating independently targetable ships.
export const FLEET_FORMATION_NAMES = Object.freeze([
  "line", "wedge", "sphere", "arrow", "column",
]);
export const SHIPS_PER_3D_FLEET_LAYER = 19;
const LINE_POSITION_ORDER = Object.freeze([0, 2, 5, 9, 16, 4, 6, 11, 17, 1, 3, 8, 14, 15, 13, 18, 10, 7, 12]);
const ARROW_POSITION_ORDER = Object.freeze([10, 1, 3, 2, 5, 11, 17, 0, 4, 6, 13, 18, 15, 7, 12, 8, 14, 9, 16]);
const COLUMN_POSITION_ORDER = Object.freeze([0, 10, 15, 1, 4, 3, 6, 7, 2, 13, 12, 5, 18, 8, 11, 14, 17, 9, 16]);

export function formationPositionOrder(formation = "sphere", count = 57) {
  const positions = Array.from({ length: Math.max(0, count) }, (_, index) => index);
  if (formation !== "line" && formation !== "arrow" && formation !== "column") return positions;
  const order = formation === "line" ? LINE_POSITION_ORDER
    : formation === "arrow" ? ARROW_POSITION_ORDER : COLUMN_POSITION_ORDER;
  return positions.map(index => {
    const layer = Math.floor(index / SHIPS_PER_3D_FLEET_LAYER);
    return layer * SHIPS_PER_3D_FLEET_LAYER + order[index % SHIPS_PER_3D_FLEET_LAYER];
  });
}

const HEX_LAYER_RADIUS = 2;
const HEX_LAYER_SLOTS = (() => {
  const slots = [];
  for (let q = -HEX_LAYER_RADIUS; q <= HEX_LAYER_RADIUS; q++) {
    for (let r = -HEX_LAYER_RADIUS; r <= HEX_LAYER_RADIUS; r++) {
      if (Math.abs(q + r) > HEX_LAYER_RADIUS) continue;
      slots.push({ q, r, distance: Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) });
    }
  }
  return Object.freeze(slots
    .sort((a, b) => a.distance - b.distance || a.r - b.r || a.q - b.q)
    .map(({ q, r }) => Object.freeze([q + r / 2, r * Math.sqrt(3) / 2])));
})();

const LAYOUTS = Object.freeze({
  line: [
    [[0, 0]], [[0, -0.55], [0, 0.55]], [[0, -0.8], [0, 0], [0, 0.8]], [[0, -0.9], [0, -0.3], [0, 0.3], [0, 0.9]],
  ],
  wedge: [
    [[0, 0]], [[0.22, -0.45], [0.22, 0.45]], [[0.5, 0], [-0.18, -0.58], [-0.18, 0.58]], [[0.62, 0], [0.02, -0.48], [0.02, 0.48], [-0.48, 0]],
  ],
  sphere: [
    [[0, 0]], [[0.22, -0.42], [0.22, 0.42]], [[0.42, 0], [-0.28, -0.48], [-0.28, 0.48]], [[0.42, 0], [0, -0.48], [0, 0.48], [-0.42, 0]],
  ],
  arrow: [
    [[0, 0]], [[0.28, -0.28], [-0.28, 0.28]], [[0.38, 0], [0, 0], [-0.38, 0]], [[0.42, 0], [0, -0.42], [0, 0.42], [-0.42, 0]],
  ],
  column: [
    [[0, 0]], [[-0.42, 0], [0.42, 0]], [[-0.52, 0], [0, 0], [0.52, 0]], [[-0.58, 0], [-0.2, 0], [0.2, 0], [0.58, 0]],
  ],
});

export function fleetShipOffsets(formation = "sphere", strength = 4) {
  const layouts = LAYOUTS[formation] || LAYOUTS.sphere;
  const count = Math.max(1, Math.ceil(strength));
  if (count <= 4) return layouts[count - 1].map(offset => [...offset]);

  if (formation === "line") {
    return Array.from({ length: count }, (_, index) => [0, -0.95 + 1.9 * index / (count - 1)]);
  }
  if (formation === "column") {
    return Array.from({ length: count }, (_, index) => [-0.95 + 1.9 * index / (count - 1), 0]);
  }
  if (formation === "arrow") {
    return Array.from({ length: count }, (_, index) => {
      const t = index / (count - 1);
      return [-0.95 + 1.9 * t, (index % 2 ? 0.55 : -0.55) * Math.sin(Math.PI * t)];
    });
  }
  if (formation === "wedge") {
    const rows = Math.ceil((Math.sqrt(8 * count + 1) - 1) / 2);
    const offsets = [];
    for (let row = 0; row < rows && offsets.length < count; row++) {
      const columns = row + 1;
      const forward = 0.9 - 1.8 * row / Math.max(1, rows - 1);
      for (let column = 0; column < columns && offsets.length < count; column++) {
        const lateral = columns === 1 ? 0 : -0.9 + 1.8 * column / (columns - 1);
        offsets.push([forward, lateral]);
      }
    }
    return offsets;
  }

  // A deterministic sunflower packing keeps large spherical Fleets compact
  // without introducing ambient randomness.
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return [0, 0];
    const radius = 0.92 * Math.sqrt(index / (count - 1));
    const angle = index * goldenAngle;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
}

// `forward` follows a Fleet's facing; `lateral` is its perpendicular axis.
export function fleetShipPositions({ x, y, facingDeg, formation, strength, spacing }) {
  const angle = facingDeg * Math.PI / 180;
  const forward = [Math.cos(angle), Math.sin(angle)];
  const lateral = [-forward[1], forward[0]];
  return fleetShipOffsets(formation, strength).map(([f, l]) => [
    x + (forward[0] * f + lateral[0] * l) * spacing,
    y + (forward[1] * f + lateral[1] * l) * spacing,
  ]);
}

// Three.js Fleets use complete 19-position hex patches stacked vertically.
// Each layer is independently collision-free. Strategic rules cap Fleets at
// three layers (57 Ships); further layers remain a defensive rendering path.
export function layeredFleetShipPositions({
  x, z, strength, spacing, firstLayerHeight, layerSpacing, formation,
}) {
  const count = Math.max(1, Math.ceil(strength));
  if (formation) {
    const alignmentAngle = Math.PI / 6;
    const cosAlignment = Math.cos(alignmentAngle);
    const sinAlignment = Math.sin(alignmentAngle);
    const positions = [];
    for (let layer = 0; layer < Math.ceil(count / SHIPS_PER_3D_FLEET_LAYER); layer++) {
      const layerCount = Math.min(SHIPS_PER_3D_FLEET_LAYER, count - layer * SHIPS_PER_3D_FLEET_LAYER);
      const layerSlots = HEX_LAYER_SLOTS.slice(0, layerCount);
      for (const [localForward, localLateral] of layerSlots) {
      const alignedX = localForward * cosAlignment - localLateral * sinAlignment;
      const alignedZ = localForward * sinAlignment + localLateral * cosAlignment;
        positions.push([
        x + alignedX * spacing,
        firstLayerHeight + layer * layerSpacing,
        z + alignedZ * spacing,
        ]);
      }
    }
    return positions;
  }
  const alignmentAngle = Math.PI / 6;
  const cosAlignment = Math.cos(alignmentAngle);
  const sinAlignment = Math.sin(alignmentAngle);
  return Array.from({ length: count }, (_, index) => {
    const [localForward, localLateral] = HEX_LAYER_SLOTS[index % SHIPS_PER_3D_FLEET_LAYER];
    const layer = Math.floor(index / SHIPS_PER_3D_FLEET_LAYER);
    const alignedX = localForward * cosAlignment - localLateral * sinAlignment;
    const alignedZ = localForward * sinAlignment + localLateral * cosAlignment;
    return [
      x + alignedX * spacing,
      firstLayerHeight + layer * layerSpacing,
      z + alignedZ * spacing,
    ];
  });
}
