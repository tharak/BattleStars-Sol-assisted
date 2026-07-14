export const STRATEGIC_FACTION_COLORS = Object.freeze({
  blue:  Object.freeze({ fill: "#00e5ff", stroke: "#00e5ff", acted: "#007985" }),
  green: Object.freeze({ fill: "#00ffb3", stroke: "#00ffb3", acted: "#00845d" }),
  red:   Object.freeze({ fill: "#ff1053", stroke: "#ff1053", acted: "#8f1238" }),
});

export const STRATEGIC_SHIP_ICON_RADIUS = 2.2;

export function strategicShipColor(faction, hasActed = false) {
  const colors = STRATEGIC_FACTION_COLORS[faction];
  if (!colors) return "#1a2133";
  return hasActed ? colors.acted : colors.fill;
}

export function scaledStrategicShipIconRadius(zoom) {
  return Math.max(STRATEGIC_SHIP_ICON_RADIUS * zoom, 1.5);
}
