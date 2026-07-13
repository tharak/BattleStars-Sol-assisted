import { makeHexGrid } from "./hexgrid.js";
import {
  layoutOrbitalBoard, drawOrbitalBoard, hitTest,
  layoutSystemWithMoons, worldToScreen, screenToWorld,
} from "./orbitmap.js";
import { createSystemScene } from "./scene3d.js";
import { AU_KM, beltParticles } from "./orbits.js";
import {
  universeLevel, systemLevel, formationBoard,
  FLEET_FORMATIONS, FORMATION_NAMES, FACTIONS, SHIPS_PER_FACTION,
  FLEET_POSITIONS, initFleetPositions, moveFleet,
} from "./levels.js";
import { TURN_HOURS } from "./config.js";
import { movementRangeHexes, HEX_SIZE_PX } from "./movegrid.js";
import { hexDist, DIR_ANGLE, facingArrowPoints } from "../battle/hexmath.js";
import { ACCENT, BOARD_TINT } from "../battle/colors.js";

const capitalize = s => s[0].toUpperCase() + s.slice(1);

const canvas = document.getElementById("cv");
const mapwrap = document.getElementById("mapwrap");
const canvas3d = document.getElementById("cv3d");
const mapwrap3d = document.getElementById("mapwrap3d");
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
let path = [
  { level: "universe", label: "Universe" },
  { level: "system", systemId: "sol", label: "Sol" },
];

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
  mapwrap3d.style.display = "none";
  mapwrap.style.display = "inline-block";
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
  canvas.oncontextmenu = null;
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
// zooming in (scroll / -/= keys, or clicking a planet to focus on it).
//
// Rendered as a real 3D scene (map/scene3d.js, Three.js) by default. Some
// browsers/environments can't create a WebGL context at all (sandboxed
// browsers, disabled GPU acceleration, some remote desktops) -- Three.js
// throws synchronously when that happens, which renderSystem() below
// catches exactly once and permanently falls back to a flat 2D canvas
// version of the same view (same math, same interactions, just no real
// 3D) rather than leaving the page broken.
// ---------------------------------------------------------------------

const LOCAL_MAX_PX = 22;
const MIN_ZOOM = 1, MAX_ZOOM = 60;
const FOCUS_ZOOM = 20;
const KEY_ZOOM_FACTOR = 1.3;
const KEY_PAN_PX = 60;
// How close (in world units -- fixed regardless of the camera's current
// zoom/angle, so the Battle button doesn't flicker on/off just because you
// rotated or scrolled) two different factions' fleets need to be before a
// Battle becomes possible.
const BATTLE_PROXIMITY_PX = 40;
// The asteroid belt is drawn as a scattered particle cloud (real distance
// range, synthetic individual positions -- see beltParticles in orbits.js)
// rather than the single dot every other body gets. BELT_HEIGHT_PX is how
// far the 3D scene's particles jitter off the flat plane (real asteroids
// do have some inclination spread, giving the belt a bit of real
// thickness rather than being a perfectly flat ring); the 2D fallback has
// no such axis and ignores it.
const BELT_PARTICLE_COUNT = 1200;
const BELT_HEIGHT_PX = 5;

// The "rubber sheet" spacetime grid drawn across the System view (see
// addSpacetimeGrid in scene3d.js) -- world-unit cell size and how far past
// the outermost body (Neptune, at ORBIT_MAX_PX) it extends, shared by the
// 3D and 2D paths so both cover the same area at the same density. 20px
// cells (rather than the wider 30px first tried) so a gravity well's dip,
// whose falloff radius can be as tight as ~25 world units for a small
// planet, still gets a few grid points across it instead of being too
// coarse to read as a curve.
const GRID_CELL_PX = 20;
const GRID_EXTENT_PX = ORBIT_MAX_PX + 80;
const GRID_LINE_COLOR = "#39ff14"; // neon green -- matches scene3d.js's GRID_COLOR

// A fleet's world position uses the exact same log-distance scale as every
// real body in this view, so "close" means close in the system,
// consistently regardless of which two planets are involved.
function placeFleets(layout) {
  return Object.entries(FLEET_POSITIONS).map(([faction, pos]) => {
    const distanceKm = Math.hypot(pos.xKm, pos.yKm);
    const angle = Math.atan2(pos.yKm, pos.xKm);
    const r = layout.dist.toPixel(distanceKm);
    return {
      id: `${faction}-fleet`, label: String(SHIPS_PER_FACTION), kind: "fleet",
      faction, x: r * Math.cos(angle), y: r * Math.sin(angle),
    };
  });
}

// Shared between the 3D and 2D click handlers for the hint shown once a
// movement-range hex is actually clicked -- see map/movegrid.js and
// map/config.js for where turns/hours come from.
function moveHint(faction, hex) {
  return `${FACTIONS[faction].label} fleet underway — ${hex.turns} turn${hex.turns === 1 ? "" : "s"} (${hex.hours}h).`;
}

// Shared between the 3D and 2D belt renderers so they can't drift apart --
// real distance range (see beltParticles in orbits.js), positioned on the
// exact same log-compressed scale as every other body via layout.dist.
// `heightFrac` (-1..1) is only meaningful to the 3D path; the 2D fallback
// has no third axis and just ignores it.
function beltScreenPoints(layout, belt) {
  return beltParticles(BELT_PARTICLE_COUNT, belt.beltInnerAU, belt.beltOuterAU).map(p => {
    const r = layout.dist.toPixel(p.distanceKm);
    const rad = p.angleDeg * Math.PI / 180;
    return { x: r * Math.cos(rad), y: r * Math.sin(rad), heightFrac: p.heightJitter };
  });
}

// The bodies that dent the 3D spacetime grid (see addSpacetimeGrid in
// scene3d.js) -- the Sun and planets, whose already-computed rendered
// radius (rPx) stands in for "how heavy this looks". Moons are too small
// to register at this scale and the belt isn't a single point mass, so
// neither gets a well.
function gravityWells(layout) {
  const wells = [];
  if (layout.center) wells.push({ x: 0, z: 0, rPx: layout.center.rPx });
  for (const p of layout.planets) {
    if (p.kind !== "belt") wells.push({ x: p.x, z: p.y, rPx: p.rPx });
  }
  return wells;
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

// --- 3D path (primary) ---------------------------------------------------

let scene3d = null;
let webglFailed = false;
// Left-drag rotates the camera (see scene3d.js's mouseButtons) but a plain
// left click also needs to keep selecting/focusing bodies and fleets --
// OrbitControls' own "start"/"change"/"end" events tell a real rotate-drag
// (a "change" fired somewhere between start and end) apart from a
// stationary click, so the click handler below can ignore the click that
// fires right after a rotate-drag releases.
let sceneDragging = false;
let sceneJustDragged = false;
function ensureScene3D() {
  if (scene3d) return scene3d;
  scene3d = createSystemScene({ canvas: canvas3d, labelContainer: mapwrap3d, sizePx: CANVAS_PX, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM });
  scene3d.controls.addEventListener("start", () => { sceneDragging = true; sceneJustDragged = false; });
  scene3d.controls.addEventListener("change", () => { if (sceneDragging) sceneJustDragged = true; });
  scene3d.controls.addEventListener("end", () => { sceneDragging = false; });
  return scene3d;
}

function renderSystem3D(entry, data) {
  mapwrap.style.display = "none";
  mapwrap3d.style.display = "inline-block";
  const scene = ensureScene3D();

  const layout = layoutSystemWithMoons(data, { maxPixel: ORBIT_MAX_PX, localMaxPixel: LOCAL_MAX_PX });
  const fleets = placeFleets(layout);
  const battleReady = closeEnoughForBattle(fleets);
  const selectedFleetPx = selectedFleet ? fleets.find(f => f.faction === selectedFleet) : null;
  const moveHexes = selectedFleetPx
    ? movementRangeHexes(FLEET_POSITIONS[selectedFleet].xKm, FLEET_POSITIONS[selectedFleet].yKm)
    : null;

  scene.rebuild(({ addBody, addRing, addFleet, addAsteroidBelt, addSpacetimeGrid, addHexOverlay }) => {
    addSpacetimeGrid({
      size: GRID_EXTENT_PX * 2,
      divisions: Math.round((GRID_EXTENT_PX * 2) / GRID_CELL_PX),
      wells: gravityWells(layout),
    });
    if (layout.center) {
      addBody({ x: 0, z: 0, radius: layout.center.rPx, color: colorsFor(layout.center).fill, label: layout.center.label, data: layout.center, emissive: true });
    }
    for (const p of layout.planets) {
      if (p.kind === "belt") {
        const points = beltScreenPoints(layout, p).map(pt => ({ x: pt.x, y: pt.heightFrac * BELT_HEIGHT_PX, z: pt.y }));
        addAsteroidBelt({
          points, colorHex: colorsFor(p).fill, data: p,
          innerPx: layout.dist.toPixel(p.beltInnerAU * AU_KM), outerPx: layout.dist.toPixel(p.beltOuterAU * AU_KM),
        });
        continue;
      }
      addRing(0, 0, Math.hypot(p.x, p.y));
      addBody({ x: p.x, z: p.y, radius: p.rPx, color: colorsFor(p).fill, label: p.label, data: p });
      for (const m of p.moons) {
        addRing(p.x, p.y, m.localRingPx, m.inclinationDeg);
        addBody({ x: m.x, y: m.tiltHeight, z: m.tiltZ, radius: m.rPx, color: colorsFor(m).fill, label: m.label, data: m });
      }
    }
    for (const f of fleets) {
      addFleet({ x: f.x, z: f.y, colorHex: colorsFor(f).fill, label: f.label, data: f, selected: f.faction === selectedFleet });
    }
    if (moveHexes) {
      addHexOverlay({
        centerX: selectedFleetPx.x, centerZ: selectedFleetPx.y, hexes: moveHexes,
        sizePx: HEX_SIZE_PX, colorHex: colorsFor(selectedFleetPx).fill,
      });
    }
  });

  canvas3d.onclick = ev => {
    if (sceneJustDragged) { sceneJustDragged = false; return; }
    const hit = scene.pick(ev.clientX, ev.clientY);

    if (hit?.kind === "fleet") {
      if (selectedFleet === hit.faction) {
        selectedFleet = null;
        zoomIn(
          { level: "formation", faction: hit.faction, formationName: FLEET_FORMATIONS[hit.faction] },
          `${FACTIONS[hit.faction].label} Formation`,
        );
        return;
      }
      selectedFleet = hit.faction;
      setHint(`${FACTIONS[hit.faction].label} fleet selected — click a hex in its movement range to move it, or click it again to set formation.`);
      render();
      return;
    }

    if (hit?.kind === "movehex") {
      moveFleet(selectedFleet, hit.xKm, hit.yKm);
      setHint(moveHint(selectedFleet, hit));
      selectedFleet = null;
      render();
      return;
    }

    if (selectedFleet) {
      setHint("Click a hex in the fleet's movement range to move it.");
      return;
    }

    if (hit?.kind === "star") { scene.resetCamera(); setHint(""); return; }
    if (hit?.kind === "moon") { setHint(`${hit.label} — a moon of ${hit.parentLabel}.`); return; }
    if (hit?.kind === "planet" || hit?.kind === "belt") {
      scene.focusOn(hit.x, hit.y, FOCUS_ZOOM);
      setHint(hit.kind === "belt" ? "Asteroid Belt — no bodies to explore." : "");
      return;
    }
    setHint("Empty space — nothing here.");
  };

  battleControls.style.display = battleReady ? "flex" : "none";
  battleBtn.onclick = () => { window.location.href = "battle.html"; };

  renderFormationControls(entry);
  renderBreadcrumb();
}

function zoomSystemByKey3D(factor) {
  ensureScene3D().zoomBy(factor);
}

// --- 2D path (fallback for browsers without a usable WebGL context) ------

const camera2d = { x: 0, y: 0, zoom: 1 };
const clampZoom2d = z => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
const WHEEL_SENSITIVITY = 0.0015;
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

// Right-button click-and-drag panning, only reachable once the 2D fallback
// is active (mirrors the 3D scene's right-drag pan -- see scene3d.js).
// Left stays click-only, reserved for selecting/focusing bodies and fleets.
// Tracked at module scope (not inside renderSystem2D) since a drag can
// outlive any single render -- mousemove/mouseup listen on window so the
// drag keeps tracking even if the cursor leaves the canvas. justDragged
// suppresses the click that fires right after mouseup releases a drag, so
// releasing a pan doesn't also select/move a fleet or focus a planet.
let dragState = null;
let justDragged = false;
window.addEventListener("mousemove", ev => {
  if (!dragState) return;
  const dx = ev.clientX - dragState.startClientX;
  const dy = ev.clientY - dragState.startClientY;
  if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) dragState.moved = true;
  camera2d.x = dragState.startCameraX - dx / camera2d.zoom;
  camera2d.y = dragState.startCameraY - dy / camera2d.zoom;
  render();
});
window.addEventListener("mouseup", () => {
  if (!dragState) return;
  justDragged = dragState.moved;
  dragState = null;
  canvas.style.cursor = "grab";
});

function renderSystem2D(entry, data) {
  mapwrap3d.style.display = "none";
  mapwrap.style.display = "inline-block";
  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;
  const ctx = canvas.getContext("2d");
  const cx = canvas.width / 2, cy = canvas.height / 2;

  const layout = layoutSystemWithMoons(data, { maxPixel: ORBIT_MAX_PX, localMaxPixel: LOCAL_MAX_PX });
  const fleets = placeFleets(layout);
  const battleReady = closeEnoughForBattle(fleets);
  const selectedFleetPx = selectedFleet ? fleets.find(f => f.faction === selectedFleet) : null;
  const moveHexes = selectedFleetPx
    ? movementRangeHexes(FLEET_POSITIONS[selectedFleet].xKm, FLEET_POSITIONS[selectedFleet].yKm)
    : null;

  const screenRadius = body => {
    const cap = body.kind === "moon" ? MOON_MAX_SCREEN_PX : BODY_MAX_SCREEN_PX;
    return Math.min(Math.max(body.rPx * camera2d.zoom, 1.2), cap);
  };

  ctx.fillStyle = BOARD_TINT.gridCell;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(cx, cy);

  // A flat reference grid -- the 2D fallback has no depth axis to show the
  // 3D scene's gravity-well dips (see addSpacetimeGrid in scene3d.js), so
  // this is just the same-spaced lines, undipped, echoing the battle
  // board's own hex grid.
  ctx.strokeStyle = GRID_LINE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.6;
  for (let x = -GRID_EXTENT_PX; x <= GRID_EXTENT_PX; x += GRID_CELL_PX) {
    const [x1, y1] = worldToScreen(camera2d, x, -GRID_EXTENT_PX);
    const [x2, y2] = worldToScreen(camera2d, x, GRID_EXTENT_PX);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  for (let y = -GRID_EXTENT_PX; y <= GRID_EXTENT_PX; y += GRID_CELL_PX) {
    const [x1, y1] = worldToScreen(camera2d, -GRID_EXTENT_PX, y);
    const [x2, y2] = worldToScreen(camera2d, GRID_EXTENT_PX, y);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const drawRing = (ringCx, ringCy, worldRadiusPx) => {
    const r = worldRadiusPx * camera2d.zoom;
    if (r < 1) return;
    ctx.beginPath();
    ctx.arc(ringCx, ringCy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#1d243855";
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  const drawDot = (body, selected) => {
    const [sx, sy] = worldToScreen(camera2d, body.x, body.y);
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
  const drawFleet = (fleet, selected) => {
    const [sx, sy] = worldToScreen(camera2d, fleet.x, fleet.y);
    const s = Math.min(Math.max(FLEET_SHIP_BASE_PX * camera2d.zoom, 3), 14);
    const colors = colorsFor(fleet);
    const tapRadius = Math.max(s * 1.8, 10);
    // The 3 ship triangles alone are a fiddly click target -- a ring at the
    // actual tap radius (see the `within()` check below) both marks where
    // to click and makes that area visually obvious.
    ctx.beginPath();
    ctx.arc(sx, sy, tapRadius, 0, Math.PI * 2);
    ctx.strokeStyle = selected ? "#ffffff" : colors.stroke;
    ctx.globalAlpha = selected ? 0.9 : 0.55;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
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
    return tapRadius;
  };
  // Scattered dots across the belt's real distance range (see
  // beltScreenPoints/beltParticles), not one dot like every other body --
  // same shared particle math the 3D scene uses, just flat (no height axis).
  const drawBelt = belt => {
    const colors = colorsFor(belt);
    const r = Math.min(Math.max(0.8 * camera2d.zoom, 0.5), 2.5);
    for (const pt of beltScreenPoints(layout, belt)) {
      const [sx, sy] = worldToScreen(camera2d, pt.x, pt.y);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = colors.stroke;
      ctx.fill();
    }
  };
  // The fleet movement-range hex picker (see map/movegrid.js) -- fixed-
  // pixel-size hexes around the selected fleet's screen position, each
  // one its own destination + turn count. Drawn last (on top) so it's
  // never hidden under a body/ring.
  const drawMoveHexes = () => {
    const [cx0, cy0] = worldToScreen(camera2d, selectedFleetPx.x, selectedFleetPx.y);
    const colors = colorsFor(selectedFleetPx);
    for (const h of moveHexes) {
      const hcx = cx0 + h.dx * camera2d.zoom, hcy = cy0 + h.dy * camera2d.zoom;
      const size = HEX_SIZE_PX * camera2d.zoom;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (60 * k - 90) * Math.PI / 180;
        const px = hcx + size * Math.cos(a), py = hcy + size * Math.sin(a);
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = colors.fill;
      ctx.globalAlpha = 0.5 / h.turns;
      ctx.fill();
      ctx.globalAlpha = Math.min(1, 1.1 / h.turns);
      ctx.strokeStyle = colors.fill;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };

  if (layout.center) drawDot(layout.center, false);
  for (const p of layout.planets) {
    if (p.kind === "belt") { drawBelt(p); continue; }
    drawRing(...worldToScreen(camera2d, 0, 0), Math.hypot(p.x, p.y));
    const [px, py] = drawDot(p, false);
    for (const m of p.moons) {
      drawRing(px, py, m.localRingPx);
      drawDot(m, false);
    }
  }
  for (const f of fleets) f.hitRPx = drawFleet(f, f.faction === selectedFleet);
  if (moveHexes) drawMoveHexes();
  ctx.restore();

  canvas.onmousedown = ev => {
    if (ev.button !== 2) return;
    dragState = { startClientX: ev.clientX, startClientY: ev.clientY, startCameraX: camera2d.x, startCameraY: camera2d.y, moved: false };
    canvas.style.cursor = "grabbing";
  };
  canvas.oncontextmenu = ev => ev.preventDefault();
  canvas.style.cursor = "grab";

  canvas.onclick = ev => {
    if (justDragged) { justDragged = false; return; }
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) - cx, y = (ev.clientY - rect.top) - cy;

    const screenPos = b => worldToScreen(camera2d, b.x, b.y);
    const within = b => {
      if (b.kind === "belt") {
        // The belt is a scattered band, not one point -- clicking anywhere
        // across its real inner/outer radius should hit it, not just the
        // single representative point everything else uses for its target.
        const [sunSx, sunSy] = worldToScreen(camera2d, 0, 0);
        const distFromSun = Math.hypot(x - sunSx, y - sunSy);
        const innerR = layout.dist.toPixel(b.beltInnerAU * AU_KM) * camera2d.zoom;
        const outerR = layout.dist.toPixel(b.beltOuterAU * AU_KM) * camera2d.zoom;
        return distFromSun >= innerR - 6 && distFromSun <= outerR + 6;
      }
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
      setHint(`${FACTIONS[hitFleet.faction].label} fleet selected — click a hex in its movement range to move it, or click it again to set formation.`);
      render();
      return;
    }

    if (selectedFleet) {
      const [cx0, cy0] = worldToScreen(camera2d, selectedFleetPx.x, selectedFleetPx.y);
      const hitHex = moveHexes.find(h => {
        const hx = cx0 + h.dx * camera2d.zoom, hy = cy0 + h.dy * camera2d.zoom;
        return Math.hypot(x - hx, y - hy) <= HEX_SIZE_PX * camera2d.zoom;
      });
      if (hitHex) {
        moveFleet(selectedFleet, hitHex.xKm, hitHex.yKm);
        setHint(moveHint(selectedFleet, hitHex));
        selectedFleet = null;
        render();
      } else {
        setHint("Click a hex in the fleet's movement range to move it.");
      }
      return;
    }

    if (layout.center && within(layout.center)) {
      camera2d.x = 0; camera2d.y = 0; camera2d.zoom = 1;
      setHint("");
      render();
      return;
    }
    const hitMoon = layout.planets.flatMap(p => p.moons).find(within);
    if (hitMoon) { setHint(`${hitMoon.label} — a moon of ${hitMoon.parentLabel}.`); return; }
    const hitPlanet = layout.planets.find(within);
    if (hitPlanet) {
      camera2d.x = hitPlanet.x; camera2d.y = hitPlanet.y;
      camera2d.zoom = clampZoom2d(Math.max(camera2d.zoom, FOCUS_ZOOM));
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
    const [wx, wy] = screenToWorld(camera2d, x, y);
    camera2d.zoom = clampZoom2d(camera2d.zoom * Math.exp(-ev.deltaY * WHEEL_SENSITIVITY));
    // Keep the point under the cursor fixed on screen while zooming.
    camera2d.x = wx - x / camera2d.zoom;
    camera2d.y = wy - y / camera2d.zoom;
    render();
  };

  battleControls.style.display = battleReady ? "flex" : "none";
  battleBtn.onclick = () => { window.location.href = "battle.html"; };

  renderFormationControls(entry);
  renderBreadcrumb();
}

function zoomSystemByKey2D(factor) {
  camera2d.zoom = clampZoom2d(camera2d.zoom * factor);
  render();
}

// --- dispatcher ------------------------------------------------------

function renderSystem(entry, data) {
  if (!webglFailed) {
    try {
      renderSystem3D(entry, data);
      return;
    } catch (err) {
      console.warn("3D System map unavailable (WebGL context creation failed) -- falling back to the 2D map:", err);
      webglFailed = true;
      scene3d = null;
      canvas3d.onclick = null;
      setHint("3D view isn't available in this browser (WebGL disabled) — showing the 2D map instead.");
    }
  }
  renderSystem2D(entry, data);
}

// ---------------------------------------------------------------------
// Formation Setup: unchanged, still a small fixed hex board (its ship
// layouts are hex-native -- see battle/formations.js).
// ---------------------------------------------------------------------

function renderHex(entry, data) {
  mapwrap3d.style.display = "none";
  mapwrap.style.display = "inline-block";
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
  canvas.oncontextmenu = null;
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
  if (ev.key === "=" || ev.key === "+") {
    if (webglFailed) zoomSystemByKey2D(KEY_ZOOM_FACTOR); else zoomSystemByKey3D(KEY_ZOOM_FACTOR);
  } else if (ev.key === "-" || ev.key === "_") {
    if (webglFailed) zoomSystemByKey2D(1 / KEY_ZOOM_FACTOR); else zoomSystemByKey3D(1 / KEY_ZOOM_FACTOR);
  } else if (ev.key.startsWith("Arrow")) {
    ev.preventDefault();
    if (webglFailed) {
      const step = KEY_PAN_PX / camera2d.zoom;
      if (ev.key === "ArrowLeft") camera2d.x -= step;
      else if (ev.key === "ArrowRight") camera2d.x += step;
      else if (ev.key === "ArrowUp") camera2d.y -= step;
      else if (ev.key === "ArrowDown") camera2d.y += step;
      render();
    } else {
      const scene = ensureScene3D();
      const step = KEY_PAN_PX / scene.camera.zoom;
      if (ev.key === "ArrowLeft") scene.panCamera(-step, 0);
      else if (ev.key === "ArrowRight") scene.panCamera(step, 0);
      else if (ev.key === "ArrowUp") scene.panCamera(0, step);
      else if (ev.key === "ArrowDown") scene.panCamera(0, -step);
    }
  }
});

render();
