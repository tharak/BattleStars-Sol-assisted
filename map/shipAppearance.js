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

export function strategicLaserColor(faction) {
  return STRATEGIC_FACTION_COLORS[faction]?.fill || "#ffffff";
}

const FLEET_TONE_FACTORS = Object.freeze([-0.24, -0.16, -0.08, 0, 0.08, 0.16, 0.24]);
export function strategicFleetTone(faction, fleetId, hasActed = false) {
  const base = strategicShipColor(faction, hasActed);
  const amount = FLEET_TONE_FACTORS[Math.abs(Number(fleetId) || 0) % FLEET_TONE_FACTORS.length];
  const value = parseInt(base.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(channel => (
    Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount))
  ));
  return `#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function scaledStrategicShipIconRadius(zoom) {
  return Math.max(STRATEGIC_SHIP_ICON_RADIUS * zoom, 1.5);
}
