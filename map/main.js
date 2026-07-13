import { makeHexGrid } from "./hexgrid.js";
import {
  layoutOrbitalBoard, drawOrbitalBoard, hitTest, pixelToKm,
  layoutSystemWithMoons, worldToScreen, screenToWorld,
} from "./orbitmap.js";
import { createSystemScene } from "./scene3d.js";
import { AU_KM, beltParticles } from "./orbits.js";
import {
  universeLevel, systemLevel, formationBoard,
  FLEET_FORMATIONS, FORMATION_NAMES, FACTIONS, SHIPS_PER_FACTION,
  FLEET_POSITIONS, initFleetPositions, moveFleet,
} from "./levels.js";
import { hexDist, DIR_ANGLE, facingArrowPoints } from "../battle/hexmath.js";
import { formationLayout } from "../battle/formations.js";
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
// (blue-ship-3, ...), not a shared small id space like planets/moons.
// Neon rather than the muted tones everything else uses: each ship is
// now a single small icon on its own hex cell (see placeShips), and a
// small icon needs to read as a bright dot from across the whole system
// at a glance, not blend into the rest of the palette the way a bigger
// shape safely could.
const FACTION_COLORS = {
  blue:  { fill: "#00e5ff", stroke: "#00e5ff" },
  green: { fill: "#00ffb3", stroke: "#00ffb3" },
  red:   { fill: "#ff1053", stroke: "#ff1053" },
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

// The "rubber sheet" spacetime grid drawn across the System view -- hex
// size and how far past the outermost body (Neptune, at ORBIT_MAX_PX) it
// extends, shared by the 3D and 2D paths so both cover the same area at
// the same density.
//
// The hex lattice is one fixed grid, anchored at the origin -- only the
// Sun (which sits exactly at that origin) is guaranteed to land on a
// lattice vertex; every planet's real position is essentially arbitrary
// relative to it, so the *visually* deepest point of that planet's well
// is really whichever lattice vertex happens to fall nearest it, not the
// planet's true position. At the old 20px hex size that quantization
// error could be up to ~half a hex-width, easily bigger than a small
// planet's own rendered sphere -- exactly why a planet's dot and its
// well's apparent center could look offset from each other. A smaller
// hex size shrinks that worst-case error proportionally.
const GRID_HEX_SIZE_PX = 5;
const GRID_EXTENT_PX = ORBIT_MAX_PX + 80;
const GRID_LINE_COLOR = "#39ff14"; // neon green -- matches scene3d.js's GRID_COLOR
const GRID_LINE_OPACITY = 0.1; // down from 0.6, then 0.35 -- still reading as too bright

// Same pointy-top hex pixel math as the spacetime grid's own tiling (see
// warpedGridLines below) -- an offset-coordinate [c,r] pair, exactly what
// battle/formations.js's formationLayout already returns as each ship's
// [fwd,lat] position, converts to a pixel offset the same way, so a
// ship's hex cell lines up with the actual hex cells drawn on screen:
// "each ship occupies 1 hex" is then true by construction, not just a
// label.
function shipHexOffset(c, r) {
  return [(c + 0.5 * (r & 1)) * GRID_HEX_SIZE_PX * Math.sqrt(3), r * GRID_HEX_SIZE_PX * 1.5];
}

// Individual ship tokens, not one "12" blob per faction -- each ship sits
// on its own hex cell (shipHexOffset), arranged in whatever formation
// shape the faction has chosen in Formation Setup (the exact same
// battle/formations.js layout the actual Battle board deploys), anchored
// on the faction's single logical FLEET_POSITIONS point (the exact same
// log-distance scale as every real body in this view, so "close" means
// close in the system, consistently regardless of which two planets are
// involved). Moving/selecting a fleet still operates on that one anchor
// point -- clicking any of a faction's ships selects the whole group,
// same as the old single-icon fleet marker did.
function placeShips(layout) {
  return Object.entries(FLEET_POSITIONS).flatMap(([faction, pos]) => {
    const distanceKm = Math.hypot(pos.xKm, pos.yKm);
    const angle = Math.atan2(pos.yKm, pos.xKm);
    const r = layout.dist.toPixel(distanceKm);
    const anchorX = r * Math.cos(angle), anchorY = r * Math.sin(angle);
    const { u, flag } = formationLayout(FLEET_FORMATIONS[faction], SHIPS_PER_FACTION);
    return u.map(([fwd, lat, df], i) => {
      const [dx, dy] = shipHexOffset(fwd, lat);
      return {
        id: `${faction}-ship-${i}`, kind: "ship", faction, isFlag: i === flag,
        label: i === flag ? "★" : String(i + 1),
        facingDeg: DIR_ANGLE[df === 0 ? 0 : (df > 0 ? 5 : 1)],
        x: anchorX + dx, y: anchorY + dy,
      };
    });
  });
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

// The bodies that warp the spacetime grid below -- the Sun and planets,
// whose already-computed rendered radius (rPx) stands in for "how heavy
// this looks". Moons are too small to register at this scale and the
// belt isn't a single point mass, so neither gets a well.
function gravityWells(layout) {
  const wells = [];
  if (layout.center) wells.push({ x: 0, z: 0, rPx: layout.center.rPx });
  for (const p of layout.planets) {
    if (p.kind !== "belt") wells.push({ x: p.x, z: p.y, rPx: p.rPx });
  }
  return wells;
}

// The "rubber sheet" spacetime grid, flattened: each vertex gets pulled
// toward every nearby well (in the flat XZ/XY plane, not displaced in
// height) so cells visibly compress and converge near a mass -- the
// "space itself curves near mass" picture, as opposed to the "ball
// sitting in a fabric dimple" one a height-displaced grid gives. Being
// genuinely flat (no third axis), this same math draws correctly from
// directly overhead and is shared verbatim by the 3D scene and the 2D
// fallback -- earlier, the 2D path could only ever show an undeformed
// grid since it had no depth axis to dip into; now there's nothing 3D-
// only left about this effect.
//
// Per well: falloff is how far the pull reaches (tightly, ~2x the body's
// own radius, so it reads as a well around that one body rather than a
// citywide tilt) and strength is how hard it pulls at the center --
// exaggerated well past real proportion for legibility, the same call
// already made for planet/moon sizes elsewhere in this view. Each pull is
// capped at 85% of the vertex's own distance to that well so a vertex can
// never overshoot past the mass and fold the grid through itself.
//
// Tiled with pointy-top hexagons (GRID_HEX_SIZE_PX = center-to-corner
// radius) rather than a square lattice -- each hex's 6 corners get
// individually warped, same as a square grid's vertices did, just laid
// out on a honeycomb instead of rows/columns. An interior edge is shared
// by two hexes and so gets emitted (and drawn) twice; harmless for a
// decorative line overlay like this, and simpler than deduping a shared-
// vertex mesh.
function warpedGridLines(wells) {
  const warp = (x, z) => {
    let wx = 0, wz = 0;
    for (const w of wells) {
      const dx = w.x - x, dz = w.z - z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-6) continue;
      const falloff = Math.max(w.rPx * 2, GRID_HEX_SIZE_PX);
      const strength = w.rPx * 9;
      // Gaussian, not the 1/(1+x^2) curve tried first -- that one has a
      // long tail that never really reaches zero, so a heavy well (the
      // Sun, mainly) kept tugging on every other well's own vertices from
      // clear across the system. That visibly dragged each planet's
      // funnel off-center, toward the Sun, so the planet no longer sat at
      // the middle of its own well. Gaussian falls off fast enough past
      // its own falloff radius that wells stay independent of each other.
      const pull = Math.min(strength * Math.exp(-(d * d) / (falloff * falloff)), d * 0.85);
      wx += (dx / d) * pull;
      wz += (dz / d) * pull;
    }
    return [x + wx, z + wz];
  };

  const size = GRID_HEX_SIZE_PX;
  const half = GRID_EXTENT_PX;
  const rMax = Math.ceil(half / (size * 1.5)) + 1;
  const qSpan = half / (size * Math.sqrt(3));
  const segments = [];
  for (let r = -rMax; r <= rMax; r++) {
    const cz = size * 1.5 * r;
    const qMin = Math.floor(-qSpan - r / 2) - 1;
    const qMax = Math.ceil(qSpan - r / 2) + 1;
    for (let q = qMin; q <= qMax; q++) {
      const cx = size * Math.sqrt(3) * (q + r / 2);
      const corners = [];
      for (let k = 0; k < 6; k++) {
        const a = (60 * k - 90) * Math.PI / 180;
        corners.push(warp(cx + size * Math.cos(a), cz + size * Math.sin(a)));
      }
      for (let k = 0; k < 6; k++) segments.push(corners[k], corners[(k + 1) % 6]);
    }
  }
  return segments; // flat pairs of [x,z]; consecutive pairs are one line segment
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
  const ships = placeShips(layout);
  const battleReady = closeEnoughForBattle(ships);

  scene.rebuild(({ addBody, addRing, addShip, addAsteroidBelt, addSpacetimeGrid }) => {
    addSpacetimeGrid({ segments: warpedGridLines(gravityWells(layout)) });
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
    for (const s of ships) {
      addShip({
        x: s.x, z: s.y, colorHex: colorsFor(s).fill, label: s.label, data: s,
        selected: s.faction === selectedFleet, facingDeg: s.facingDeg,
      });
    }
  });

  canvas3d.onclick = ev => {
    if (sceneJustDragged) { sceneJustDragged = false; return; }
    const hit = scene.pick(ev.clientX, ev.clientY);

    if (hit?.kind === "ship") {
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

function zoomSystemByKey3D(factor) {
  ensureScene3D().zoomBy(factor);
}

// --- 2D path (fallback for browsers without a usable WebGL context) ------

const camera2d = { x: 0, y: 0, zoom: 1 };
const clampZoom2d = z => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
const WHEEL_SENSITIVITY = 0.0015;
const DRAG_THRESHOLD_PX = 4;
// A ship's own icon is well inside its hex cell (see shipHexOffset) --
// GRID_HEX_SIZE_PX's flat-to-flat width is its own hard ceiling on how
// big this can get before neighboring ships' icons start touching.
const SHIP_ICON_BASE_PX = 2.2;

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
  const ships = placeShips(layout);
  const battleReady = closeEnoughForBattle(ships);

  // Only a floor, no ceiling -- a real body's on-screen size grows freely
  // with zoom, same as the 3D scene's actual spheres do (there's nothing
  // to clamp there; an orthographic camera's zoom scales the whole
  // projected view uniformly). A shared max here used to clamp the Sun,
  // then every planet in turn, to the same fixed pixel size once zoomed
  // in enough -- by zoom ~10 the Sun and Neptune were rendering at the
  // exact same size, and by max zoom every body (including Mercury) was
  // identical, which 3D never does. The floor stays: it's a different,
  // legitimate concern (keeping a small far-out body from shrinking to
  // sub-pixel/unclickable at low zoom), not one that collapses bodies
  // into each other.
  const screenRadius = body => Math.max(body.rPx * camera2d.zoom, 1.2);

  ctx.fillStyle = BOARD_TINT.gridCell;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(cx, cy);

  // The spacetime grid -- see warpedGridLines above. Being a flat XZ/XY
  // warp rather than a height dip, the exact same math the 3D scene uses
  // draws correctly here too now.
  const gridSegments = warpedGridLines(gravityWells(layout));
  ctx.strokeStyle = GRID_LINE_COLOR;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = GRID_LINE_OPACITY;
  for (let i = 0; i < gridSegments.length; i += 2) {
    const [x1, y1] = worldToScreen(camera2d, gridSegments[i][0], gridSegments[i][1]);
    const [x2, y2] = worldToScreen(camera2d, gridSegments[i + 1][0], gridSegments[i + 1][1]);
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
  // One ship, one small triangle pointing its real formation-assigned
  // facing (see placeShips) -- the old drawFleet drew one stylized 3-cone
  // wedge standing in for a whole "12" fleet; now each of those 12 ships
  // is its own icon on its own hex cell, so this draws exactly one.
  // Labels only past a legibility threshold, same idea as body labels'
  // own zoom gate -- 12 numbers per faction at default zoom is clutter.
  const drawShip = (ship, selected) => {
    const [sx, sy] = worldToScreen(camera2d, ship.x, ship.y);
    const s = Math.min(Math.max(SHIP_ICON_BASE_PX * camera2d.zoom, 1.5), 10);
    const colors = colorsFor(ship);
    const tapRadius = Math.max(s * 1.8, 6);
    const [tip, b1, b2] = shipTriangle(sx, sy, s, ship.facingDeg);
    ctx.beginPath();
    ctx.moveTo(...tip); ctx.lineTo(...b1); ctx.lineTo(...b2);
    ctx.closePath();
    ctx.fillStyle = colors.fill;
    ctx.fill();
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.strokeStyle = selected ? "#ffffff" : colors.stroke;
    ctx.stroke();
    if (s > 4) {
      ctx.font = "bold 9px system-ui";
      ctx.textAlign = "center";
      ctx.fillStyle = "#d7deef";
      ctx.fillText(ship.label, sx, sy + s * 1.4 + 8);
    }
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
  for (const s of ships) s.hitRPx = drawShip(s, s.faction === selectedFleet);
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
      const tap = b.kind === "ship" ? b.hitRPx : Math.max(screenRadius(b), 10);
      return Math.hypot(x - sx, y - sy) <= tap;
    };

    const hitShip = ships.find(within);
    if (hitShip) {
      if (selectedFleet === hitShip.faction) {
        selectedFleet = null;
        zoomIn(
          { level: "formation", faction: hitShip.faction, formationName: FLEET_FORMATIONS[hitShip.faction] },
          `${FACTIONS[hitShip.faction].label} Formation`,
        );
        return;
      }
      selectedFleet = hitShip.faction;
      setHint(`${FACTIONS[hitShip.faction].label} fleet selected — click a destination to move it, or click it again to set formation.`);
      render();
      return;
    }

    if (selectedFleet) {
      const [wx, wy] = screenToWorld(camera2d, x, y);
      const [xKm, yKm] = pixelToKm(layout, wx, wy);
      moveFleet(selectedFleet, xKm, yKm);
      setHint(`${FACTIONS[selectedFleet].label} fleet moved.`);
      selectedFleet = null;
      render();
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
