import {
  layoutOrbitalBoard, drawOrbitalBoard, hitTest,
  layoutSystemWithMoons, worldToScreen, screenToWorld,
} from "./orbitmap.js";
import { createSystemScene } from "./scene3d.js";
import { AU_KM, hashAngleDeg } from "./orbits.js";
import {
  universeLevel, systemLevel,
  FLEET_FORMATIONS, FACTIONS, SHIPS_PER_FACTION,
  FLEET_POSITIONS, initFleetPositions,
} from "./levels.js";
import { DIR_ANGLE, hexEdgeWidths, hexCorners, key as hexKey } from "../battle/hexmath.js";
import { formationLayout } from "../battle/formations.js";
import { BOARD_TINT } from "../battle/colors.js";
import { MP_MAX, STATE_NAME } from "../battle/config.js";
import * as SC from "./shipCombat.js";

const canvas = document.getElementById("starmapCv");
const mapwrap = document.getElementById("mapwrap");
const canvas3d = document.getElementById("cv3d");
const mapwrap3d = document.getElementById("mapwrap3d");
const topbar = document.getElementById("topbar");
const breadcrumb = document.getElementById("breadcrumb");
const zoomOutBtn = document.getElementById("zoomOut");
const hint = document.getElementById("hint");
const infoPanel = document.getElementById("infoPanel");
const infoEmpty = document.getElementById("infoEmpty");
const infoBody = document.getElementById("infoBody");
const infoName = document.getElementById("infoName");
const infoDetail = document.getElementById("infoDetail");
const infoControls = document.getElementById("infoControls");
const infoShipStatus = document.getElementById("infoShipStatus");
const infoTurnL = document.getElementById("infoTurnL");
const infoTurnR = document.getElementById("infoTurnR");
const infoForward = document.getElementById("infoForward");
const infoBack = document.getElementById("infoBack");
const infoFire = document.getElementById("infoFire");
const infoTravel = document.getElementById("infoTravel");
const infoEnd = document.getElementById("infoEnd");
const mapArea = document.getElementById("mapArea");

// Navigation stack: [{level:"universe"}, {level:"system",systemId}]. The
// System map is the merged Star+Body view -- there's no separate "body"
// level anymore; zooming the camera in on a planet (wheel / -/= keys, or
// clicking it) is what reveals its moons, instead of navigating to a new
// screen.
let path = [
  { level: "universe", label: "Universe" },
  { level: "system", systemId: "sol", label: "Sol" },
];

// The one shared ECS world every ship on the map lives in (see
// shipCombat.js) -- spawned once at startup (spawnInitialShips) from each
// faction's formation, then persistent: a ship's position/facing/strength/
// morale only change via player commands (turn/forward/back/fire/Set
// Course) from here on, never recomputed from the formation again.
const world = new SC.World();
const random = new SC.MathRandomSource();
// Whichever single ship (an entity id, or null) is currently selected at
// the System level, plus its in-progress activation -- mirrors
// battle/state.js's `act` shape ({u,mp,moved,fired,fireMode,cmd}) but
// owned here directly rather than through a shared battle State, since
// there's no turn order to hand off to (see shipCombat.js's header for
// why). travelArmed is Set-Course's own "next click is a destination"
// flag, armed by the Travel button and consumed by the next click.
let selectedShip = null;
let activation = null;
let travelArmed = false;
// Fire's own transient shot-line records, derived here from fire results
// and read once by the renderer after a fire command, then
// cleared immediately after, so a tracer shows for exactly one render,
// not battle's own state.effects (this is the map's own, unrelated array).
const effects = [];
// The asteroid field's current occupied hexes (a Set of "c,r" keys, see
// battle/hexmath.js's key()) -- recomputed every render (updateBeltField)
// alongside the belt's own asteroid list, and passed into shipCombat.js's
// movement/fire functions as extraObstacles so the field actually blocks
// both movement and line of sight, not just decoration. Read by the
// command functions below (doForward, doFireAt, ...), which live outside
// any single render, hence module-level rather than a render-local const.
let beltObstacles = new Set();
// The last body (star/planet/moon/belt) clicked at the System level, for
// the info panel -- see infoFor/renderInfoPanel. Superseded by
// selectedShip whenever a ship is selected (checked first in
// renderInfoPanel), so this only ever matters while nothing's selected.
let lastClickedInfo = null;
// Whatever's currently under the cursor at the System level (see
// showHoverInfo) -- takes priority over lastClickedInfo but not over an
// actively-selected ship's own controls (checked first in
// renderInfoPanel), so hovering some other body while mid-command doesn't
// blow away the command panel. hoverId is the last hovered body/ship's
// own `.id` (an entity id for ships, a string id for bodies -- either way
// stable), used purely to skip re-rendering the panel on every single
// mousemove pixel while still hovering the same thing.
let hoverInfo = null;
let hoverId = null;

initFleetPositions();

// Nothing on the map carries a floating label anymore (see addBody/
// addShip in scene3d.js and drawDot/drawShip below) -- this panel is
// where a click's result actually shows up instead. Read every time
// through renderInfoPanel() rather than pushed reactively, so any click
// handler can just update selectedShip/lastClickedInfo and call it,
// the same way setHint(...) already works.
function infoFor(hit) {
  if (!hit) return null;
  if (hit.kind === "star") return { name: hit.label, detail: "The star this system orbits." };
  if (hit.kind === "moon") return { name: hit.label, detail: `Moon of ${hit.parentLabel}.` };
  if (hit.kind === "planet") return { name: hit.label, detail: "Planet." };
  if (hit.kind === "asteroid") return { name: "Asteroid", detail: "Blocks movement and line of sight." };
  if (hit.kind === "ship") {
    return {
      name: `${SC.labelOf(world, hit.id)}${hit.isFlag ? " ★" : ""}`,
      detail: `${FACTIONS[hit.faction].label} — Str ${SC.strengthOf(world, hit.id)}, ${STATE_NAME[SC.moraleOf(world, hit.id)]}.`,
    };
  }
  return null;
}
// Puts whatever was just clicked into the info panel. Shared by both the
// 3D and 2D click handlers' star/moon/planet/belt branches -- each still
// owns its own setHint(...) wording (that genuinely differs per render
// path), but the panel update itself doesn't.
function showBodyInfo(hit) {
  lastClickedInfo = infoFor(hit);
  renderInfoPanel();
}
// Live-updates the panel to whatever's under the cursor, without touching
// lastClickedInfo/selectedShip -- moving off every body reverts the panel
// to whatever a click last put there (or the empty placeholder), the same
// way a click's own result behaves once the cursor stops hovering anything.
// Shared by both the 3D and 2D mousemove handlers.
function showHoverInfo(hit) {
  const id = hit?.id ?? null;
  if (id === hoverId) return;
  hoverId = id;
  hoverInfo = infoFor(hit);
  renderInfoPanel();
}
// Selecting a ship resets its activation fresh (mirrors
// battle/turnEngine.js:selectUnit) -- there's no "un-activated" gating
// like battle's own selectUnit checks (Q.isActivated), since there's no
// turn order here: any living ship, any faction, can be picked up at any
// time (see shipCombat.js's header for why).
function selectShip(e) {
  selectedShip = e;
  activation = { u: e, mp: MP_MAX, moved: false, fired: false, fireMode: false, cmd: SC.inCommand(world, e) };
  travelArmed = false;
  setHint(`${SC.labelOf(world, e)} selected.`);
  renderInfoPanel();
  render();
}
// Deselects without touching the hint -- shared by endActivation (which
// does want to clear it, an explicit "I'm done" action) and doFireAt's
// own auto-end when firing out of command (which must NOT clear it, since
// the hint at that point is the fire result doFireAt just set -- calling
// the old endActivation from there clobbered that message with "" before
// the player ever saw it).
function clearSelection() {
  selectedShip = null;
  activation = null;
  travelArmed = false;
}
// Mirrors battle/turnEngine.js:endActivation, but with no proceed(state)
// hand-off to another unit/side -- there's nothing to hand off to.
function endActivation() {
  clearSelection();
  setHint("");
  renderInfoPanel();
  render();
}
function doTurn(dir) {
  if (!SC.canMove(activation)) return;
  SC.turn(world, activation.u, dir);
  activation.mp--; activation.moved = true; activation.fireMode = false;
  setHint("");
  renderInfoPanel();
  render();
}
function moveResultHint(res) {
  if (res.reason === "shaken") setHint("Shaken — refuses to close the distance.");
  else if (res.reason === "blocked") setHint("Blocked — that hex is occupied.");
}
function doForward() {
  if (!SC.canMove(activation)) return;
  const res = SC.moveForward(world, activation.u, beltObstacles);
  if (!res.ok) { moveResultHint(res); renderInfoPanel(); return; }
  activation.mp--; activation.moved = true; activation.fireMode = false;
  setHint("");
  renderInfoPanel();
  render();
}
function doBackward() {
  if (!SC.canBack(activation)) return;
  const res = SC.moveBackward(world, activation.u, beltObstacles);
  if (!res.ok) { moveResultHint(res); renderInfoPanel(); return; }
  activation.mp = 0; activation.moved = true; activation.fireMode = false;
  setHint("");
  renderInfoPanel();
  render();
}
// Arms the cosmetic "fire mode" hint -- exactly like battle, clicking a
// legal target fires regardless of whether this was pressed first (see
// handleShipOrDestinationClick), so this only exists to show
// "pick a highlighted target" in the panel.
function armFireMode() {
  if (!SC.canFire(world, activation, beltObstacles)) return;
  activation.fireMode = true;
  renderInfoPanel();
}
function doFireAt(tgt) {
  if (!SC.canFire(world, activation, beltObstacles)) return;
  if (!SC.legalTargets(world, activation.u, beltObstacles).includes(tgt)) return;
  const firer = activation.u;
  const result = SC.fire(world, firer, tgt, random);
  effects.push({ from: result.from, to: result.to, hit: result.hits > 0 });
  activation.fired = true; activation.fireMode = false;
  setHint(`${SC.labelOf(world, firer)} fires (${result.arc} arc, ${result.need}+): [${result.rolls.join(" ")}] → ` +
    `${result.hits} hit${result.hits === 1 ? "" : "s"}${result.destroyed ? " — destroyed!" : ""}`);
  if (!activation.cmd) { clearSelection(); renderInfoPanel(); render(); return; } // out of command: fire was the whole activation
  renderInfoPanel();
  render();
}
// Arms Set Course -- the next click anywhere (body, ship, or empty space)
// becomes the selected ship's new position, an instant reposition with
// none of moveForward/moveBackward's neighbor/occupancy/Shaken rules
// (matching the old whole-fleet moveFleet's own instant-move semantics),
// for real interplanetary distances the hex-by-hex MP budget can't cover.
function armTravel() {
  if (!activation) return;
  travelArmed = true;
  setHint("Click a destination to set course.");
  renderInfoPanel();
}
function setCourse(x, y) {
  const [c, r] = pixelToHexIndex(x, y);
  SC.setPosition(world, activation.u, c, r);
  setHint(`${SC.labelOf(world, activation.u)} course set.`);
  travelArmed = false;
  renderInfoPanel();
  render();
}
// Shared by both the 3D and 2D click handlers: handles everything that
// depends on a ship being selected (firing at a legal target, switching
// selection to a different ship, selecting a fresh one, or consuming an
// armed Set Course) before either handler falls through to its own
// star/moon/planet/belt info-panel branches. Returns true if the click
// was fully handled here.
function handleShipOrDestinationClick(hit, worldPoint) {
  if (activation && travelArmed && worldPoint) { setCourse(worldPoint[0], worldPoint[1]); return true; }
  if (hit?.kind === "ship") {
    if (activation && SC.legalTargets(world, activation.u, beltObstacles).includes(hit.id)) { doFireAt(hit.id); return true; }
    if (!activation || activation.u !== hit.id) selectShip(hit.id);
    return true;
  }
  return false;
}
function renderInfoPanel() {
  if (selectedShip != null && !SC.isAlive(world, selectedShip)) { selectedShip = null; activation = null; }
  if (selectedShip != null) {
    const u = selectedShip;
    infoEmpty.style.display = "none";
    infoBody.style.display = "block";
    infoName.textContent = `${SC.labelOf(world, u)}${SC.isFlagship(world, u) ? " ★" : ""}`;
    infoDetail.textContent = `${FACTIONS[SC.factionOf(world, u)].label} — Str ${SC.strengthOf(world, u)}, ${STATE_NAME[SC.moraleOf(world, u)]}`;
    infoControls.style.display = "flex";
    infoShipStatus.innerHTML =
      `${activation.cmd ? "In command (move + fire)" : "Out of command (move OR fire)"}<br>` +
      `MP ${activation.mp}/${MP_MAX}${activation.fired ? " · has fired" : ""}` +
      (activation.fireMode ? `<br><span style="color:var(--red)">Pick a highlighted target.</span>` : "") +
      (travelArmed ? `<br><span style="color:var(--red)">Click a destination.</span>` : "");
    infoTurnL.disabled = infoTurnR.disabled = infoForward.disabled = !SC.canMove(activation);
    infoBack.disabled = !SC.canBack(activation);
    infoFire.disabled = !SC.canFire(world, activation, beltObstacles);
    return;
  }
  const shown = hoverInfo || lastClickedInfo;
  if (shown) {
    infoEmpty.style.display = "none";
    infoBody.style.display = "block";
    infoName.textContent = shown.name;
    infoDetail.textContent = shown.detail;
    infoControls.style.display = "none";
    return;
  }
  infoEmpty.style.display = "block";
  infoBody.style.display = "none";
}
infoTurnL.onclick = () => doTurn(1);
infoTurnR.onclick = () => doTurn(-1);
infoForward.onclick = doForward;
infoBack.onclick = doBackward;
infoFire.onclick = armFireMode;
infoTravel.onclick = armTravel;
infoEnd.onclick = endActivation;

function levelData(entry) {
  return entry.level === "system" ? systemLevel(entry.systemId) : universeLevel();
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

// Real photo textures (solarsystemscope.com, CC BY 4.0), keyed the same
// way ID_COLORS is -- only the 3D scene uses these (see textureFor/
// renderSystem3D); the 2D fallback has no UV-mapped surface to put a
// photo on, so it keeps reading ID_COLORS/colorsFor's flat tint the same
// as every body without an entry here still does in 3D too (every moon
// but Earth's own, the belt). Only bodies solarsystemscope actually
// publishes a real photo for get an entry; there's no "closest guess"
// fallback texture for the rest.
const TEXTURE_DIR = "map/textures/";
const BODY_TEXTURES = {
  sun: TEXTURE_DIR + "2k_sun.jpg",
  mercury: TEXTURE_DIR + "2k_mercury.jpg",
  venus: TEXTURE_DIR + "2k_venus_surface.jpg",
  earth: TEXTURE_DIR + "2k_earth_daymap.jpg",
  mars: TEXTURE_DIR + "2k_mars.jpg",
  jupiter: TEXTURE_DIR + "2k_jupiter.jpg",
  saturn: TEXTURE_DIR + "2k_saturn.jpg",
  uranus: TEXTURE_DIR + "2k_uranus.jpg",
  neptune: TEXTURE_DIR + "2k_neptune.jpg",
  moon: TEXTURE_DIR + "2k_moon.jpg",
};
const textureFor = cell => BODY_TEXTURES[cell.id];

// Faction fleet/ship colors (see FACTIONS in levels.js) -- checked via
// cell.faction rather than cell.id, since a ship's id is its own ECS
// entity number (see shipCombat.js), not a shared small id space like
// planets/moons. Neon rather than the muted tones everything else uses:
// each ship is a single small icon on its own hex cell (see
// shipsSnapshot), and a small icon needs to read as a bright dot from
// across the whole system at a glance, not blend into the rest of the
// palette the way a bigger shape safely could.
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
const KEY_ZOOM_FACTOR = 1.3;
const KEY_PAN_PX = 60;
// The asteroid belt is real terrain, not decoration: every hex cell inside
// its actual 2.1-3.3 AU ring (see beltAsteroidHexes below) either holds a
// single "1-hex asteroid" that blocks movement and line of sight, or is
// empty. Two fixed angular wedges are kept permanently clear -- corridors
// through the field, LOTGH's Iserlohn/Fezzan corridors being the
// reference: the belt is otherwise dense enough to matter, but these two
// lanes are the only reliable way through, so controlling them is the
// actual tactical prize.
const BELT_ASTEROID_FILL = 0.5;
const BELT_CORRIDOR_CENTERS_DEG = [90, 270];
const BELT_CORRIDOR_HALF_WIDTH_DEG = 12;
const BELT_ASTEROID_RADIUS_PX = 2.4;

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

// The nearest actual grid-lattice INDEX (c,r), not pixel position, to an
// arbitrary continuous pixel point -- the inverse of shipHexOffset. Used
// both to convert a fleet's real orbital pixel anchor onto the lattice at
// spawn time (see spawnInitialShips) and to turn a Set Course click's
// world point into the real (c,r) a ship's Position component stores
// (see setCourse) -- a ship's position is always an integer hex index
// from here on, never a raw pixel value.
function pixelToHexIndex(x, y) {
  const size = GRID_HEX_SIZE_PX;
  const r = Math.round(y / (size * 1.5));
  const c = Math.round(x / (size * Math.sqrt(3)) - 0.5 * (r & 1));
  return [c, r];
}
function snapToHexGrid(x, y) {
  return shipHexOffset(...pixelToHexIndex(x, y));
}

// One-time spawn into the shared `world` (see its declaration above) --
// every faction's 12 ships, placed at their formation-derived starting
// hex exactly like the old (now-removed) placeShips computed fresh on
// every render, but done exactly once here: from this point on a ship's
// real Position/Facing components are the only source of truth for where
// it is and which way it faces, never recomputed from
// FLEET_POSITIONS/FLEET_FORMATIONS again. Anchored on each faction's
// single logical FLEET_POSITIONS point (the exact same log-distance scale
// as every real body in this view) using the exact same
// formationLayout()-relative-offset math the old placeShips used, so
// every ship's starting position/formation shape is unchanged from before
// this session's rewrite.
let shipsSpawned = false;
function spawnInitialShips(layout) {
  for (const [faction, pos] of Object.entries(FLEET_POSITIONS)) {
    const distanceKm = Math.hypot(pos.xKm, pos.yKm);
    const angle = Math.atan2(pos.yKm, pos.xKm);
    const r = layout.dist.toPixel(distanceKm);
    const [anchorX, anchorY] = snapToHexGrid(r * Math.cos(angle), r * Math.sin(angle));
    const { u, flag } = formationLayout(FLEET_FORMATIONS[faction], SHIPS_PER_FACTION);
    u.forEach(([fwd, lat, df], i) => {
      const [dx, dy] = shipHexOffset(fwd, lat);
      const [c, rIdx] = pixelToHexIndex(anchorX + dx, anchorY + dy);
      SC.spawnShip(world, {
        faction, c, r: rIdx, dir: df === 0 ? 0 : (df > 0 ? 5 : 1), isFlag: i === flag,
        label: `${faction[0].toUpperCase()}${i + 1}`,
      });
    });
  }
}
function ensureShipsSpawned(layout) {
  if (shipsSpawned) return;
  spawnInitialShips(layout);
  shipsSpawned = true;
}

// Individual ship tokens, not one "12" blob per faction -- each ship sits
// on its own hex cell, read straight from the world's live Position/
// Facing components (not recomputed from a formation formula -- see
// spawnInitialShips) via shipHexOffset, the same conversion the grid
// itself uses, so a ship's hex cell always lines up with the hex cells
// actually drawn on screen. Called fresh every render (World lookups are
// cheap; this is no more expensive than the old formula-driven version).
function shipsSnapshot() {
  return SC.aliveShips(world).map(e => {
    const [c, r] = SC.posOf(world, e);
    const [x, y] = shipHexOffset(c, r);
    return {
      id: e, kind: "ship", faction: SC.factionOf(world, e), isFlag: SC.isFlagship(world, e),
      label: SC.labelOf(world, e), facingDeg: DIR_ANGLE[SC.facingOf(world, e)],
      x, y,
    };
  });
}

function inBeltCorridor(angleDeg) {
  const a = ((angleDeg % 360) + 360) % 360;
  return BELT_CORRIDOR_CENTERS_DEG.some(centerDeg => {
    const diff = Math.abs(((a - centerDeg + 540) % 360) - 180);
    return diff <= BELT_CORRIDOR_HALF_WIDTH_DEG;
  });
}
// Every hex cell whose center (via shipHexOffset, the same conversion the
// grid itself and every ship on it use) falls inside the belt's real
// inner/outer radius, minus the two clear corridors, minus roughly half
// the rest -- deterministic per (c,r) via hashAngleDeg (the same "stable,
// not fabricated" approach the minor moons' synthetic phase already uses
// in orbits.js), so the field itself never visibly reshuffles between
// renders even though it's recomputed fresh every time (cheap: a
// bounding-box scan over a few thousand candidate hexes, almost all
// rejected by the radius check before the hash is even touched). Shared
// between the 3D and 2D renderers, and by updateBeltObstacles below, so
// none of the three can drift apart from each other.
function beltAsteroidHexes(layout, belt) {
  const innerPx = layout.dist.toPixel(belt.beltInnerAU * AU_KM);
  const outerPx = layout.dist.toPixel(belt.beltOuterAU * AU_KM);
  const rMax = Math.ceil(outerPx / (GRID_HEX_SIZE_PX * 1.5)) + 1;
  const asteroids = [];
  for (let r = -rMax; r <= rMax; r++) {
    for (let c = -rMax; c <= rMax; c++) {
      const [x, y] = shipHexOffset(c, r);
      const dist = Math.hypot(x, y);
      if (dist < innerPx || dist > outerPx) continue;
      if (inBeltCorridor(Math.atan2(y, x) * 180 / Math.PI)) continue;
      if (hashAngleDeg(`belt-asteroid-${c},${r}`) / 360 >= BELT_ASTEROID_FILL) continue;
      asteroids.push({ c, r, x, y, kind: "asteroid", id: `asteroid-${c},${r}` });
    }
  }
  return asteroids;
}
// Refreshes the module-level beltObstacles (see its declaration above)
// from the current asteroid list -- called once per render, right after
// computing it, so doForward/doFireAt/etc. (which run outside any single
// render) always check against the field as it actually looks right now.
function updateBeltObstacles(asteroids) {
  beltObstacles = new Set(asteroids.map(a => hexKey(a.c, a.r)));
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
  scene3d = createSystemScene({ canvas: canvas3d, sizePx: CANVAS_PX, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM });
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
  ensureShipsSpawned(layout);
  const ships = shipsSnapshot();

  scene.rebuild(({ addBody, addRing, addShip, addAsteroid, addSpacetimeGrid, addTracer }) => {
    addSpacetimeGrid({ segments: warpedGridLines(gravityWells(layout)) });
    if (layout.center) {
      addBody({ x: 0, z: 0, radius: layout.center.rPx, color: colorsFor(layout.center).fill, data: layout.center, emissive: true, textureUrl: textureFor(layout.center) });
    }
    for (const p of layout.planets) {
      if (p.kind === "belt") {
        const asteroids = beltAsteroidHexes(layout, p);
        updateBeltObstacles(asteroids);
        for (const a of asteroids) {
          addAsteroid({ x: a.x, z: a.y, radius: BELT_ASTEROID_RADIUS_PX, data: a });
        }
        continue;
      }
      addRing(0, 0, Math.hypot(p.x, p.y));
      addBody({ x: p.x, z: p.y, radius: p.rPx, color: colorsFor(p).fill, data: p, textureUrl: textureFor(p) });
      for (const m of p.moons) {
        addRing(p.x, p.y, m.localRingPx, m.inclinationDeg);
        addBody({ x: m.x, y: m.tiltHeight, z: m.tiltZ, radius: m.rPx, color: colorsFor(m).fill, data: m, textureUrl: textureFor(m) });
      }
    }
    for (const s of ships) {
      addShip({
        x: s.x, z: s.y, colorHex: colorsFor(s).fill, data: s,
        selected: s.id === selectedShip, facingDeg: s.facingDeg,
      });
    }
    // A shot's tracer -- read once here and cleared right after (see the
    // `effects` declaration above), so it only ever shows for the one
    // render a fire command triggers.
    for (const eff of effects) addTracer({ from: shipHexOffset(...eff.from), to: shipHexOffset(...eff.to), hit: eff.hit });
  });
  effects.length = 0;

  canvas3d.onclick = ev => {
    if (sceneJustDragged) { sceneJustDragged = false; return; }
    const hit = scene.pick(ev.clientX, ev.clientY);
    if (handleShipOrDestinationClick(hit, scene.groundPoint(ev.clientX, ev.clientY))) return;

    if (hit?.kind === "star") { setHint(""); showBodyInfo(hit); return; }
    if (hit?.kind === "moon") { setHint(`${hit.label} — a moon of ${hit.parentLabel}.`); showBodyInfo(hit); return; }
    if (hit?.kind === "asteroid") { setHint("Asteroid — blocks movement and line of sight."); showBodyInfo(hit); return; }
    if (hit?.kind === "planet") { setHint(""); showBodyInfo(hit); return; }
    setHint("Empty space — nothing here.");
    showBodyInfo(null);
  };

  canvas3d.onmousemove = ev => {
    // Skip during an active rotate/pan drag -- same reasoning as the 2D
    // path's dragState guard, using OrbitControls' own drag flag instead.
    if (sceneDragging) return;
    showHoverInfo(scene.pick(ev.clientX, ev.clientY));
  };
  canvas3d.onmouseleave = () => showHoverInfo(null);

  renderInfoPanel();
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
const SHIP_FILL_ALPHA = 0.5;

// "#rrggbb" -> "rgba(r,g,b,alpha)" -- ship tokens fill at 50% alpha (see
// drawShip) so overlapping/adjacent ships in a tight formation still read
// as individual hexes rather than one solid blob, unlike every other body
// on this map, which is fully opaque.
function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
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
  ensureShipsSpawned(layout);
  const ships = shipsSnapshot();

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
    return [sx, sy, rPx];
  };
  // One ship, one small hex on its own hex cell (see shipsSnapshot) -- filled
  // translucent (SHIP_FILL_ALPHA) in the faction color so a tightly-packed
  // formation still reads as individual ships rather than one solid blob.
  // Facing shows as edge thickness, not a separate arrow: the single edge
  // pointing the ship's real formation-assigned facing is thickest (best-
  // armored side), the opposite edge thinnest (most vulnerable), the 4
  // side edges in between -- see hexEdgeWidths in battle/hexmath.js.
  const drawShip = (ship, selected) => {
    const [sx, sy] = worldToScreen(camera2d, ship.x, ship.y);
    const s = Math.min(Math.max(SHIP_ICON_BASE_PX * camera2d.zoom, 1.5), 10);
    const colors = colorsFor(ship);
    const tapRadius = Math.max(s * 1.8, 6);
    const corners = hexCorners(sx, sy, s);

    ctx.beginPath();
    corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = hexToRgba(colors.fill, SHIP_FILL_ALPHA);
    ctx.fill();

    const widths = hexEdgeWidths(ship.facingDeg);
    ctx.strokeStyle = selected ? "#ffffff" : colors.stroke;
    for (let k = 0; k < 6; k++) {
      const [x1, y1] = corners[k], [x2, y2] = corners[(k + 1) % 6];
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = selected ? widths[k] + 1 : widths[k];
      ctx.stroke();
    }
    return tapRadius;
  };
  // One small hex per asteroid, matching the "1-hex" token language ships
  // already use, but a static muted rock (belt's existing FILL/STROKE
  // colors) with no facing/selection state -- these are terrain, not
  // actors.
  const drawAsteroid = a => {
    const [sx, sy] = worldToScreen(camera2d, a.x, a.y);
    const s = Math.min(Math.max(BELT_ASTEROID_RADIUS_PX * camera2d.zoom, 1.2), 8);
    const corners = hexCorners(sx, sy, s);
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = FILL.belt;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = STROKE.belt;
    ctx.stroke();
    return Math.max(s * 1.4, 6);
  };
  if (layout.center) drawDot(layout.center, false);
  const beltBody = layout.planets.find(p => p.kind === "belt");
  const asteroids = beltBody ? beltAsteroidHexes(layout, beltBody) : [];
  updateBeltObstacles(asteroids);
  for (const a of asteroids) a.hitRPx = drawAsteroid(a);
  for (const p of layout.planets) {
    if (p.kind === "belt") continue;
    drawRing(...worldToScreen(camera2d, 0, 0), Math.hypot(p.x, p.y));
    const [px, py] = drawDot(p, false);
    for (const m of p.moons) {
      drawRing(px, py, m.localRingPx);
      drawDot(m, false);
    }
  }
  for (const s of ships) s.hitRPx = drawShip(s, s.id === selectedShip);
  // A shot's tracer -- read once here and cleared right after (see the
  // `effects` declaration above), so it only ever shows for the one
  // render a fire command triggers.
  ctx.lineWidth = 1.5;
  for (const eff of effects) {
    const [fx, fy] = worldToScreen(camera2d, ...shipHexOffset(...eff.from));
    const [tx, ty] = worldToScreen(camera2d, ...shipHexOffset(...eff.to));
    ctx.strokeStyle = eff.hit ? "#ff3355" : "#8899aa";
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx, ty); ctx.stroke();
  }
  ctx.restore();
  effects.length = 0;

  canvas.onmousedown = ev => {
    if (ev.button !== 2) return;
    dragState = { startClientX: ev.clientX, startClientY: ev.clientY, startCameraX: camera2d.x, startCameraY: camera2d.y, moved: false };
    canvas.style.cursor = "grabbing";
  };
  canvas.oncontextmenu = ev => ev.preventDefault();
  canvas.style.cursor = "grab";

  // Whatever body/ship/asteroid sits under a given screen point, in the
  // same priority a click resolves it in (ship > asteroid > star > moon >
  // planet) -- shared by onclick and onmousemove (hover) so they can't
  // drift apart. The belt's own single synthetic point (kind "belt") is
  // deliberately excluded here -- it's just an orbit/math anchor now (see
  // beltAsteroidHexes), not a click target; the individual asteroid hexes
  // are what's actually clickable across that whole ring.
  function hitAt(x, y) {
    const within = b => {
      const [sx, sy] = worldToScreen(camera2d, b.x, b.y);
      const tap = (b.kind === "ship" || b.kind === "asteroid") ? b.hitRPx : Math.max(screenRadius(b), 10);
      return Math.hypot(x - sx, y - sy) <= tap;
    };
    return ships.find(within)
      || asteroids.find(within)
      || (layout.center && within(layout.center) ? layout.center : null)
      || layout.planets.flatMap(p => p.moons).find(within)
      || layout.planets.filter(p => p.kind !== "belt").find(within)
      || null;
  }

  canvas.onclick = ev => {
    if (justDragged) { justDragged = false; return; }
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) - cx, y = (ev.clientY - rect.top) - cy;
    const hit = hitAt(x, y);
    if (handleShipOrDestinationClick(hit, screenToWorld(camera2d, x, y))) return;

    if (hit?.kind === "star") {
      setHint("");
      showBodyInfo(hit);
      return;
    }
    if (hit?.kind === "moon") {
      setHint(`${hit.label} — a moon of ${hit.parentLabel}.`);
      showBodyInfo(hit);
      return;
    }
    if (hit?.kind === "asteroid") {
      setHint("Asteroid — blocks movement and line of sight.");
      showBodyInfo(hit);
      return;
    }
    if (hit?.kind === "planet") {
      setHint("");
      showBodyInfo(hit);
      return;
    }
    setHint("Empty space — nothing here.");
    showBodyInfo(null);
  };

  canvas.onmousemove = ev => {
    // A right-drag pan already floods window "mousemove" (see the module-
    // scope listener above); skip hover lookups while one's in progress,
    // both because the cursor isn't meaningfully "over" anything mid-pan
    // and to avoid doing a hit-test on every dragged pixel.
    if (dragState) return;
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) - cx, y = (ev.clientY - rect.top) - cy;
    showHoverInfo(hitAt(x, y));
  };
  canvas.onmouseleave = () => showHoverInfo(null);

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

  renderInfoPanel();
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

function render() {
  const entry = path[path.length - 1];
  const data = levelData(entry);
  // The info panel only has anything to show at the System level (bodies
  // and ships) -- Universe reuses the same #mapwrap canvas underneath it,
  // so it has to be hidden explicitly rather than just left empty, or
  // it'd sit there showing stale System-level info over an unrelated
  // screen.
  infoPanel.style.display = entry.level === "system" ? "block" : "none";
  if (entry.level === "system") renderSystem(entry, data);
  else renderUniverse(entry, data);
}

function zoomIn(enter, label) {
  path.push({ ...enter, label });
  selectedShip = null; activation = null; travelArmed = false;
  setHint("");
  render();
}
function zoomTo(index) {
  path = path.slice(0, index + 1);
  selectedShip = null; activation = null; travelArmed = false;
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
  if (ev.key === "Escape") { if (selectedShip != null) endActivation(); else zoomOut(); return; }
  if (path[path.length - 1].level !== "system") return;
  // Same keybinds battle/input.js uses for a selected unit -- Q/E turn,
  // W/S forward/back, F arms fire mode, Space ends the activation.
  if (selectedShip != null) {
    const k = ev.key.toLowerCase();
    if (k === "q") { doTurn(1); return; }
    if (k === "e") { doTurn(-1); return; }
    if (k === "w") { doForward(); return; }
    if (k === "s") { doBackward(); return; }
    if (k === "f") { armFireMode(); return; }
    if (ev.key === " ") { ev.preventDefault(); endActivation(); return; }
  }
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
