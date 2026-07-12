import { makeHexGrid } from "./hexgrid.js";
import {
  layoutOrbitalBoard, drawOrbitalBoard, hitTest, pixelToKm,
  layoutSystemWithMoons, worldToScreen, screenToWorld,
} from "./orbitmap.js";
import {
  universeLevel, systemLevel, formationBoard,
  FLEET_FORMATIONS, FORMATION_NAMES, FACTIONS, SHIPS_PER_FACTION,
  FLEET_POSITIONS, initFleetPositions, moveFleet,
} from "./levels.js";
import { hexDist, DIR_ANGLE, facingArrowPoints } from "../battle/hexmath.js";
import { ACCENT, BOARD_TINT } from "../battle/colors.js";

const capitalize = s => s[0].toUpperCase() + s.slice(1);

const canvas = document.getElementById("cv");
const breadcrumb = document.getElementById("breadcrumb");
const zoomOutBtn = document.getElementById("zoomOut");
const hint = document.getElementById("hint");
const formationControls = document.getElementById("formationControls");
const formationButtons = document.getElementById("formationButtons");
const saveFormationBtn = document.getElementById("saveFormation");
const battleControls = document.getElementById("battleControls");
const battleBtn = document.getElementById("battleBtn");

// Navigation stack: [{level:"universe"}, {level:"system",systemId},
// {level:"formation",faction,formationName}]. The System map is the merged
// Star+Body view -- there's no separate "body" level anymore; zooming the
// camera in on a planet (wheel / -/= keys, or clicking it) is what reveals
// its moons, instead of navigating to a new screen.
let path = [{ level: "universe", label: "Universe" }];

// Fleets only render/move at the System level -- this is which one (if
// any) is currently picked up, waiting for a destination click.
let selectedFleet = null;

initFleetPositions();

function levelData(entry) {
  if (entry.level === "universe") return universeLevel();
  if (entry.level === "system") return systemLevel(entry.systemId);
  return formationBoard(entry.faction, entry.formationName);
}

const FILL = {
  system: "#3a2f6a", star: "#5a4a1a", planet: "#1a3a5c", belt: "#2a2a2a",
  "body-center": "#5a4a1a", moon: "#2e3644",
};
const STROKE = {
  system: "#a78bfa", star: "#ffd166", planet: "#4a9eff", belt: "#666",
  "body-center": "#ffd166", moon: "#9fb3c8",
};

// Per-planet colors (loosely evocative of the real thing) override the
// generic "planet"/"body-center" kind colors above -- Jupiter still reads
// as Jupiter whether it's zoomed all the way out or you've zoomed in on it.
// Merged with MOON_COLORS below into one id-keyed table (ID_COLORS) since
// both are looked up the same way, by cell.id.
const PLANET_COLORS = {
  mercury: { fill: "#3a3a3a", stroke: "#9e9e9e" },
  venus:   { fill: "#5c5030", stroke: "#f0d9a0" },
  earth:   { fill: "#1a3a5c", stroke: "#4a9eff" },
  mars:    { fill: "#5c2a1a", stroke: "#ff6b4a" },
  jupiter: { fill: "#5c4020", stroke: "#e0a050" },
  saturn:  { fill: "#5c4a20", stroke: "#e0c070" },
  uranus:  { fill: "#1a4a4a", stroke: "#7de8e8" },
  neptune: { fill: "#1a2a5c", stroke: "#5a7dff" },
};

// Same idea, per moon (id = its name lowercased -- see MOONS in levels.js).
// Most moons don't have a strongly "iconic" real color the way planets do,
// so these are mainly picked to stay distinguishable from each other and
// from their parent planet's own color, with a nod to the few that do have
// a real look (sulfurous Io, hazy orange Titan, etc). Only the well-known
// moons get an entry -- everyone else falls back to the generic "moon"
// kind color.
const MOON_COLORS = {
  moon:     { fill: "#4a4a4a", stroke: "#c8c8c8" },
  phobos:   { fill: "#4a3a2a", stroke: "#c9a678" },
  deimos:   { fill: "#3a2e28", stroke: "#a68968" },
  io:       { fill: "#5c4010", stroke: "#f0c040" },
  europa:   { fill: "#4a4838", stroke: "#e8dcc0" },
  ganymede: { fill: "#3a3428", stroke: "#a89878" },
  callisto: { fill: "#2e2a24", stroke: "#8a7d68" },
  titan:    { fill: "#5c4520", stroke: "#e8b060" },
  rhea:     { fill: "#404040", stroke: "#d8d8d8" },
  iapetus:  { fill: "#3a3a3a", stroke: "#b8b0a0" },
  dione:    { fill: "#3e3e3e", stroke: "#c8c8d0" },
  tethys:   { fill: "#383838", stroke: "#c0c8c8" },
  titania:  { fill: "#2e3a3a", stroke: "#88b8b8" },
  oberon:   { fill: "#2a3438", stroke: "#7898a0" },
  miranda:  { fill: "#343030", stroke: "#a89898" },
  ariel:    { fill: "#303838", stroke: "#90a8a8" },
  umbriel:  { fill: "#242424", stroke: "#686868" },
  triton:   { fill: "#2a3050", stroke: "#8098d8" },
};
const ID_COLORS = { ...PLANET_COLORS, ...MOON_COLORS };

// Faction fleet/ship colors (see FACTIONS in levels.js) -- checked via
// cell.faction rather than cell.id, since fleet/ship ids are per-instance
// (blue-fleet, blue-ship-3, ...), not a shared small id space like
// planets/moons.
const FACTION_COLORS = {
  blue:  { fill: "#1a3a6e", stroke: "#4a9eff" },
  green: { fill: "#1a5c2a", stroke: "#4ade80" },
  red:   { fill: "#5c1a1a", stroke: "#ff4a4a" },
};

function colorsFor(cell) {
  const p = (cell.faction && FACTION_COLORS[cell.faction]) || ID_COLORS[cell.id];
  return p || { fill: FILL[cell.kind] || "#1a2133", stroke: STROKE[cell.kind] || "#2a3350" };
}

// ---------------------------------------------------------------------
// Universe: just Sol, alone -- see map/orbits.js and map/orbitmap.js.
// ---------------------------------------------------------------------

const ORBIT_MAX_PX = 420;
const ORBIT_MARGIN = 55;
const CANVAS_PX = ORBIT_MAX_PX * 2 + ORBIT_MARGIN * 2;

function renderUniverse(entry, data) {
  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;
  const ctx = canvas.getContext("2d");
  const cx = canvas.width / 2, cy = canvas.height / 2;

  const layout = layoutOrbitalBoard(data, { maxPixel: ORBIT_MAX_PX });
  ctx.fillStyle = BOARD_TINT.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(cx, cy);
  drawOrbitalBoard(ctx, layout, { colorsFor });
  ctx.restore();

  canvas.onclick = ev => {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) - cx, y = (ev.clientY - rect.top) - cy;
    const hitBody = hitTest(layout, x, y);
    if (!hitBody) { setHint("Empty space — nothing here."); return; }
    if (hitBody.enter) { zoomIn(hitBody.enter, hitBody.label); return; }
    setHint(`${hitBody.label} — nothing to zoom into yet.`);
  };
  canvas.onwheel = null;
  canvas.onmousedown = null;
  canvas.style.cursor = "";

  battleControls.style.display = "none";
  renderFormationControls(entry);
  renderBreadcrumb();
}

// ---------------------------------------------------------------------
// System: the merged Star+Body view. Planets sit at their real (log-
// compressed) distance from the Sun; each planet's own moons nest inside
// it at their own small local scale (see layoutSystemWithMoons in
// orbitmap.js) -- invisible at the default zoom, the way real moons
// really are lost next to planet-to-sun distances, and revealed by
// zooming the camera in (wheel, -/= keys, or clicking a planet to focus
// on it). Fleets are drawn on top, independent of the orbital layout,
// since they're player-movable rather than real orbiting bodies.
// ---------------------------------------------------------------------

const LOCAL_MAX_PX = 22;
const MIN_ZOOM = 1, MAX_ZOOM = 60;
const FOCUS_ZOOM = 20;
const WHEEL_SENSITIVITY = 0.0015;
const KEY_ZOOM_FACTOR = 1.3;
const KEY_PAN_PX = 60;
const DRAG_THRESHOLD_PX = 4;
// A planet and a moon share one physical size curve (see
// layoutSystemWithMoons), but their on-screen ceilings differ so a moon
// dot can never grow to rival its planet's even at max zoom.
const BODY_MAX_SCREEN_PX = 46;
const MOON_MAX_SCREEN_PX = 20;
const FLEET_SHIP_BASE_PX = 5;

// A small ship-arrow triangle, proportionally scaled from its own size `s`
// (unlike battle/hexmath.js's facingArrowPoints, whose fixed hs-4/hs-11
// offsets go negative -- and the triangle inverts -- below hs~11, too big
// for these small fleet icons).
function shipTriangle(x, y, s, angleDeg) {
  const a = angleDeg * Math.PI / 180;
  return [
    [x + Math.cos(a) * s, y + Math.sin(a) * s],
    [x + Math.cos(a + 2.6) * s * 0.6, y + Math.sin(a + 2.6) * s * 0.6],
    [x + Math.cos(a - 2.6) * s * 0.6, y + Math.sin(a - 2.6) * s * 0.6],
  ];
}
// How close (in on-screen pixels, at the System view's base zoom -- fixed
// regardless of the camera's current zoom, so the Battle button doesn't
// flicker on/off just because you scrolled) two different factions' fleets
// need to be before a Battle becomes possible.
const BATTLE_PROXIMITY_PX = 40;

// Persists across visits to the System view (e.g. going to Formation Setup
// and back) so you don't lose your spot -- reset only by explicitly
// clicking the Sun.
const camera = { x: 0, y: 0, zoom: 1 };
const clampZoom = z => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

// Click-and-drag panning. Tracked at module scope (not inside renderSystem)
// since a drag can outlive any single render -- mousemove/mouseup listen on
// window so the drag keeps tracking even if the cursor leaves the canvas.
// justDragged suppresses the click that fires right after mouseup releases
// a drag, so releasing a pan doesn't also select/move a fleet or focus a
// planet underneath the cursor.
let dragState = null;
let justDragged = false;
window.addEventListener("mousemove", ev => {
  if (!dragState) return;
  const dx = ev.clientX - dragState.startClientX;
  const dy = ev.clientY - dragState.startClientY;
  if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) dragState.moved = true;
  camera.x = dragState.startCameraX - dx / camera.zoom;
  camera.y = dragState.startCameraY - dy / camera.zoom;
  render();
});
window.addEventListener("mouseup", () => {
  if (!dragState) return;
  justDragged = dragState.moved;
  dragState = null;
  canvas.style.cursor = "grab";
});

// A fleet's pixel position uses the exact same log-distance scale as every
// real body in this view, so "close" on screen means close in the system,
// consistently regardless of which two planets are involved.
function placeFleets(layout) {
  return Object.entries(FLEET_POSITIONS).map(([faction, pos]) => {
    const distanceKm = Math.hypot(pos.xKm, pos.yKm);
    const angle = Math.atan2(pos.yKm, pos.xKm);
    const r = layout.dist.toPixel(distanceKm);
    return {
      id: `${faction}-fleet`, label: String(SHIPS_PER_FACTION), kind: "fleet",
      faction, x: r * Math.cos(angle), y: r * Math.sin(angle), rPx: 9,
    };
  });
}

function closeEnoughForBattle(fleets) {
  for (let i = 0; i < fleets.length; i++) {
    for (let j = i + 1; j < fleets.length; j++) {
      if (fleets[i].faction === fleets[j].faction) continue;
      if (Math.hypot(fleets[i].x - fleets[j].x, fleets[i].y - fleets[j].y) <= BATTLE_PROXIMITY_PX) return true;
    }
  }
  return false;
}

function renderSystem(entry, data) {
  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;
  const ctx = canvas.getContext("2d");
  const cx = canvas.width / 2, cy = canvas.height / 2;

  const layout = layoutSystemWithMoons(data, { maxPixel: ORBIT_MAX_PX, localMaxPixel: LOCAL_MAX_PX });
  const fleets = placeFleets(layout);
  const battleReady = closeEnoughForBattle(fleets);

  // A moon's screen size is capped well below a planet's (both start from
  // the same physical size curve -- see layoutSystemWithMoons -- but a
  // moon can never grow past this even at max zoom), so "planet clearly
  // bigger than its own moons" holds regardless of zoom level.
  const screenRadius = body => {
    const cap = body.kind === "moon" ? MOON_MAX_SCREEN_PX : BODY_MAX_SCREEN_PX;
    return Math.min(Math.max(body.rPx * camera.zoom, 1.2), cap);
  };

  ctx.fillStyle = BOARD_TINT.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(cx, cy);

  const drawRing = (ringCx, ringCy, worldRadiusPx) => {
    const r = worldRadiusPx * camera.zoom;
    if (r < 1) return;
    ctx.beginPath();
    ctx.arc(ringCx, ringCy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#1d243855";
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  const drawDot = (body, selected) => {
    const [sx, sy] = worldToScreen(camera, body.x, body.y);
    const rPx = screenRadius(body);
    const colors = colorsFor(body);
    ctx.beginPath();
    ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
    ctx.fillStyle = colors.fill;
    ctx.fill();
    ctx.lineWidth = selected ? 3 : 2;
    ctx.strokeStyle = selected ? "#ffffff" : colors.stroke;
    ctx.stroke();
    if (rPx > 3) {
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "center";
      ctx.fillStyle = "#d7deef";
      ctx.fillText(body.label, sx, sy + rPx + 13);
    }
    return [sx, sy, rPx];
  };

  // A fleet isn't a real orbiting body, so it's drawn as its own thing: 3
  // small ship-arrow triangles (reusing the same wedge shape Formation
  // Setup/Battle use for a ship's facing) arranged in a "<" wedge, all
  // pointing left. Returns the wedge's rough footprint radius, used as its
  // click target.
  const drawFleet = (fleet, selected) => {
    const [sx, sy] = worldToScreen(camera, fleet.x, fleet.y);
    const s = Math.min(Math.max(FLEET_SHIP_BASE_PX * camera.zoom, 3), 14);
    const colors = colorsFor(fleet);
    const offsets = [[-s * 1.1, 0], [s * 0.55, -s * 1.05], [s * 0.55, s * 1.05]];
    for (const [dx, dy] of offsets) {
      const [tip, b1, b2] = shipTriangle(sx + dx, sy + dy, s, 180);
      ctx.beginPath();
      ctx.moveTo(...tip); ctx.lineTo(...b1); ctx.lineTo(...b2);
      ctx.closePath();
      ctx.fillStyle = colors.fill;
      ctx.fill();
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.strokeStyle = selected ? "#ffffff" : colors.stroke;
      ctx.stroke();
    }
    ctx.font = "bold 11px system-ui";
    ctx.textAlign = "center";
    ctx.fillStyle = "#d7deef";
    ctx.fillText(fleet.label, sx, sy + s * 1.05 + 15);
    return Math.max(s * 1.8, 10);
  };

  if (layout.center) drawDot(layout.center, false);
  for (const p of layout.planets) {
    drawRing(...worldToScreen(camera, 0, 0), Math.hypot(p.x, p.y));
    const [px, py] = drawDot(p, false);
    for (const m of p.moons) {
      drawRing(px, py, m.localRingPx);
      drawDot(m, false);
    }
  }
  for (const f of fleets) f.hitRPx = drawFleet(f, f.faction === selectedFleet);
  ctx.restore();

  canvas.onmousedown = ev => {
    if (ev.button !== 0) return;
    dragState = { startClientX: ev.clientX, startClientY: ev.clientY, startCameraX: camera.x, startCameraY: camera.y, moved: false };
    canvas.style.cursor = "grabbing";
  };
  canvas.style.cursor = "grab";

  canvas.onclick = ev => {
    if (justDragged) { justDragged = false; return; }
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) - cx, y = (ev.clientY - rect.top) - cy;

    const screenPos = b => worldToScreen(camera, b.x, b.y);
    const within = b => {
      const [sx, sy] = screenPos(b);
      const tap = b.kind === "fleet" ? b.hitRPx : Math.max(screenRadius(b), 10);
      return Math.hypot(x - sx, y - sy) <= tap;
    };

    const hitFleet = fleets.find(within);
    if (hitFleet) {
      if (selectedFleet === hitFleet.faction) {
        selectedFleet = null;
        zoomIn(
          { level: "formation", faction: hitFleet.faction, formationName: FLEET_FORMATIONS[hitFleet.faction] },
          `${FACTIONS[hitFleet.faction].label} Formation`,
        );
        return;
      }
      selectedFleet = hitFleet.faction;
      setHint(`${FACTIONS[hitFleet.faction].label} fleet selected — click a destination to move it, or click it again to set formation.`);
      render();
      return;
    }

    if (selectedFleet) {
      const [wx, wy] = screenToWorld(camera, x, y);
      const [xKm, yKm] = pixelToKm(layout, wx, wy);
      moveFleet(selectedFleet, xKm, yKm);
      setHint(`${FACTIONS[selectedFleet].label} fleet moved.`);
      selectedFleet = null;
      render();
      return;
    }

    if (layout.center && within(layout.center)) {
      camera.x = 0; camera.y = 0; camera.zoom = 1;
      setHint("");
      render();
      return;
    }
    const hitMoon = layout.planets.flatMap(p => p.moons).find(within);
    if (hitMoon) { setHint(`${hitMoon.label} — a moon of ${hitMoon.parentLabel}.`); return; }
    const hitPlanet = layout.planets.find(within);
    if (hitPlanet) {
      camera.x = hitPlanet.x; camera.y = hitPlanet.y;
      camera.zoom = clampZoom(Math.max(camera.zoom, FOCUS_ZOOM));
      setHint(hitPlanet.kind === "belt" ? "Asteroid Belt — no bodies to explore." : "");
      render();
      return;
    }
    setHint("Empty space — nothing here.");
  };

  canvas.onwheel = ev => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) - cx, y = (ev.clientY - rect.top) - cy;
    const [wx, wy] = screenToWorld(camera, x, y);
    camera.zoom = clampZoom(camera.zoom * Math.exp(-ev.deltaY * WHEEL_SENSITIVITY));
    // Keep the point under the cursor fixed on screen while zooming.
    camera.x = wx - x / camera.zoom;
    camera.y = wy - y / camera.zoom;
    render();
  };

  battleControls.style.display = battleReady ? "flex" : "none";
  battleBtn.onclick = () => { window.location.href = "battle.html"; };

  renderFormationControls(entry);
  renderBreadcrumb();
}

function zoomSystemByKey(factor) {
  camera.zoom = clampZoom(camera.zoom * factor);
  render();
}

// ---------------------------------------------------------------------
// Formation Setup: unchanged, still a small fixed hex board (its ship
// layouts are hex-native -- see battle/formations.js).
// ---------------------------------------------------------------------

function renderHex(entry, data) {
  const inBounds = data.center && data.radius != null
    ? (c, r) => hexDist(data.center, [c, r]) <= data.radius - 1
    : undefined;
  const grid = makeHexGrid(canvas, { cols: data.cols, rows: data.rows, hs: data.hs, ...(inBounds && { inBounds }) });
  const cellsAt = (c, r) => data.cells.filter(cell => hexDist(cell.pos, [c, r]) <= (cell.size || 0));
  const cellAt = (c, r) => cellsAt(c, r)[0];

  grid.ctx.fillStyle = BOARD_TINT.bg;
  grid.ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let r = 0; r < data.rows; r++) for (let c = 0; c < data.cols; c++) {
    if (!grid.inBounds(c, r)) continue;
    const [x, y] = grid.hexCenter(c, r);
    const cell = cellAt(c, r);
    const colors = cell && colorsFor(cell);
    grid.hexPath(x, y, grid.hs - 1.5);
    grid.ctx.fillStyle = colors ? colors.fill : "#131826";
    grid.ctx.fill();
    grid.ctx.strokeStyle = colors ? colors.stroke : "#2a3350";
    grid.ctx.lineWidth = colors ? 2 : 1;
    grid.ctx.stroke();
    if (cell?.kind === "ownship") {
      const [tip, base1, base2] = facingArrowPoints(x, y, grid.hs, DIR_ANGLE[cell.facing]);
      grid.ctx.beginPath();
      grid.ctx.moveTo(...tip); grid.ctx.lineTo(...base1); grid.ctx.lineTo(...base2);
      grid.ctx.closePath();
      grid.ctx.fillStyle = cell.isFlag ? ACCENT.flagshipArrow : "#d7deef";
      grid.ctx.fill();
    }
  }
  for (const cell of data.cells) {
    const [x, y] = grid.hexCenter(cell.pos[0], cell.pos[1]);
    grid.ctx.font = "bold 11px system-ui";
    grid.ctx.textAlign = "center";
    grid.ctx.fillStyle = cell.kind === "ownship" ? ACCENT.labelText : "#d7deef";
    grid.ctx.fillText(cell.label, x, y + 4);
  }

  canvas.onclick = ev => {
    const rect = canvas.getBoundingClientRect();
    const h = grid.pixelToHex(ev.clientX - rect.left, ev.clientY - rect.top);
    if (!h) return;
    const cell = cellAt(h[0], h[1]);
    if (!cell) { setHint("Empty space — nothing here."); return; }
    setHint(cell.isFlag ? "Flagship" : `Ship ${cell.label}`);
  };
  canvas.onwheel = null;
  canvas.onmousedown = null;
  canvas.style.cursor = "";

  battleControls.style.display = "none";
  renderFormationControls(entry);
  renderBreadcrumb();
}

function render() {
  const entry = path[path.length - 1];
  const data = levelData(entry);
  if (entry.level === "formation") renderHex(entry, data);
  else if (entry.level === "system") renderSystem(entry, data);
  else renderUniverse(entry, data);
}

// The Formation Setup screen's controls (pick a formation, save it) live
// outside the canvas -- shown only while the top of the nav stack is a
// "formation" level, hidden otherwise.
function renderFormationControls(entry) {
  const active = entry.level === "formation";
  formationControls.style.display = active ? "flex" : "none";
  if (!active) return;
  formationButtons.innerHTML = "";
  for (const name of FORMATION_NAMES) {
    const btn = document.createElement("button");
    btn.textContent = capitalize(name);
    if (name === entry.formationName) btn.className = "primary";
    btn.onclick = () => { entry.formationName = name; render(); };
    formationButtons.appendChild(btn);
  }
  saveFormationBtn.onclick = () => {
    FLEET_FORMATIONS[entry.faction] = entry.formationName;
    zoomOut();
  };
}

function zoomIn(enter, label) {
  path.push({ ...enter, label });
  selectedFleet = null;
  setHint("");
  render();
}
function zoomTo(index) {
  path = path.slice(0, index + 1);
  selectedFleet = null;
  setHint("");
  render();
}
function zoomOut() {
  if (path.length > 1) zoomTo(path.length - 2);
}
function setHint(text) { hint.textContent = text; }

function renderBreadcrumb() {
  breadcrumb.innerHTML = "";
  path.forEach((entry, i) => {
    if (i > 0) breadcrumb.appendChild(document.createTextNode(" / "));
    const btn = document.createElement(i === path.length - 1 ? "span" : "a");
    btn.textContent = entry.label;
    if (i !== path.length - 1) {
      btn.href = "#";
      btn.onclick = ev => { ev.preventDefault(); zoomTo(i); };
    }
    breadcrumb.appendChild(btn);
  });
  zoomOutBtn.disabled = path.length <= 1;
}

zoomOutBtn.onclick = zoomOut;
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape") { zoomOut(); return; }
  if (path[path.length - 1].level !== "system") return;
  if (ev.key === "=" || ev.key === "+") { zoomSystemByKey(KEY_ZOOM_FACTOR); }
  else if (ev.key === "-" || ev.key === "_") { zoomSystemByKey(1 / KEY_ZOOM_FACTOR); }
  else if (ev.key.startsWith("Arrow")) {
    ev.preventDefault();
    const step = KEY_PAN_PX / camera.zoom;
    if (ev.key === "ArrowLeft") camera.x -= step;
    else if (ev.key === "ArrowRight") camera.x += step;
    else if (ev.key === "ArrowUp") camera.y -= step;
    else if (ev.key === "ArrowDown") camera.y += step;
    render();
  }
});

render();
