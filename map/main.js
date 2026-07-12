import { makeHexGrid } from "./hexgrid.js";
import { layoutOrbitalBoard, drawOrbitalBoard, hitTest, pixelToKm, layoutSystemWithMoons } from "./orbitmap.js";
import { createSystemScene } from "./scene3d.js";
import {
  universeLevel, systemLevel, formationBoard,
  FLEET_FORMATIONS, FORMATION_NAMES, FACTIONS, SHIPS_PER_FACTION,
  FLEET_POSITIONS, initFleetPositions, moveFleet,
} from "./levels.js";
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
  battleControls.style.display = "none";
  renderFormationControls(entry);
  renderBreadcrumb();
}

// ---------------------------------------------------------------------
// System: the merged Star+Body view, rendered as a real 3D scene (Three.js
// -- see map/scene3d.js) instead of the flat 2D canvas. Planets sit at
// their real (log-compressed) distance from the Sun; each planet's own
// moons nest inside it at their own small local scale (see
// layoutSystemWithMoons in orbitmap.js) -- invisible at the default zoom,
// the way real moons really are lost next to planet-to-sun distances, and
// revealed by zooming in (scroll / -/= keys, or clicking a planet to focus
// on it). Drag rotates the camera (handled by Three.js's OrbitControls);
// arrow keys pan. Fleets are drawn on top, independent of the orbital
// layout, since they're player-movable rather than real orbiting bodies.
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

let scene3d = null;
function ensureScene3D() {
  if (scene3d) return scene3d;
  scene3d = createSystemScene({ canvas: canvas3d, labelContainer: mapwrap3d, sizePx: CANVAS_PX, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM });
  return scene3d;
}

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
  mapwrap.style.display = "none";
  mapwrap3d.style.display = "inline-block";
  const scene = ensureScene3D();

  const layout = layoutSystemWithMoons(data, { maxPixel: ORBIT_MAX_PX, localMaxPixel: LOCAL_MAX_PX });
  const fleets = placeFleets(layout);
  const battleReady = closeEnoughForBattle(fleets);

  scene.rebuild(({ addBody, addRing, addFleet }) => {
    if (layout.center) {
      addBody({ x: 0, z: 0, radius: layout.center.rPx, color: colorsFor(layout.center).fill, label: layout.center.label, data: layout.center, emissive: true });
    }
    for (const p of layout.planets) {
      addRing(0, 0, Math.hypot(p.x, p.y));
      addBody({ x: p.x, z: p.y, radius: p.rPx, color: colorsFor(p).fill, label: p.label, data: p });
      for (const m of p.moons) {
        addRing(p.x, p.y, m.localRingPx);
        addBody({ x: m.x, z: m.y, radius: m.rPx, color: colorsFor(m).fill, label: m.label, data: m });
      }
    }
    for (const f of fleets) {
      addFleet({ x: f.x, z: f.y, colorHex: colorsFor(f).fill, label: f.label, data: f, selected: f.faction === selectedFleet });
    }
  });

  canvas3d.onclick = ev => {
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
      setHint(`${FACTIONS[hit.faction].label} fleet selected — click a destination to move it, or click it again to set formation.`);
      render();
      return;
    }

    if (selectedFleet) {
      const ground = scene.groundPoint(ev.clientX, ev.clientY);
      if (ground) {
        const [xKm, yKm] = pixelToKm(layout, ground[0], ground[1]);
        moveFleet(selectedFleet, xKm, yKm);
        setHint(`${FACTIONS[selectedFleet].label} fleet moved.`);
        selectedFleet = null;
        render();
      }
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

function zoomSystemByKey(factor) {
  ensureScene3D().zoomBy(factor);
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
    const scene = ensureScene3D();
    const step = KEY_PAN_PX / scene.camera.zoom;
    if (ev.key === "ArrowLeft") scene.panCamera(-step, 0);
    else if (ev.key === "ArrowRight") scene.panCamera(step, 0);
    else if (ev.key === "ArrowUp") scene.panCamera(0, step);
    else if (ev.key === "ArrowDown") scene.panCamera(0, -step);
  }
});

render();
