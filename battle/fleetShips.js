// Visual-only Ship layouts inside one Fleet hex.  A Fleet remains the one
// rules entity; these offsets turn its current Strength into a grander
// miniature formation without creating independently targetable ships.
export const FLEET_FORMATION_NAMES = Object.freeze(["line", "wedge", "echelon", "sphere"]);

const LAYOUTS = Object.freeze({
  line: [
    [[0, 0]], [[0, -0.55], [0, 0.55]], [[0, -0.8], [0, 0], [0, 0.8]], [[0, -0.9], [0, -0.3], [0, 0.3], [0, 0.9]],
  ],
  wedge: [
    [[0, 0]], [[0.22, -0.45], [0.22, 0.45]], [[0.5, 0], [-0.18, -0.58], [-0.18, 0.58]], [[0.62, 0], [0.02, -0.48], [0.02, 0.48], [-0.48, 0]],
  ],
  echelon: [
    [[0, 0]], [[0.3, -0.45], [-0.3, 0.45]], [[0.52, -0.62], [0, 0], [-0.52, 0.62]], [[0.7, -0.72], [0.24, -0.24], [-0.24, 0.24], [-0.7, 0.72]],
  ],
  sphere: [
    [[0, 0]], [[0.22, -0.42], [0.22, 0.42]], [[0.42, 0], [-0.28, -0.48], [-0.28, 0.48]], [[0.42, 0], [0, -0.48], [0, 0.48], [-0.42, 0]],
  ],
});

export function fleetShipOffsets(formation = "sphere", strength = 4) {
  const layouts = LAYOUTS[formation] || LAYOUTS.sphere;
  return layouts[Math.max(1, Math.min(4, strength)) - 1].map(offset => [...offset]);
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
