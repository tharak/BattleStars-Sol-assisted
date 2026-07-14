import {
  layoutOrbitalBoard, drawOrbitalBoard, hitTest,
  layoutSystemWithMoons, worldToScreen, screenToWorld, strokeFaintRing,
} from "./orbitmap.js";
import { AU_KM, hashAngleDeg } from "./orbits.js";
import {
  universeLevel, systemLevel,
  FLEET_FORMATIONS, FACTIONS, SHIPS_PER_FACTION,
  FLEET_POSITIONS, initFleetPositions,
} from "./levels.js";
import { DIR_ANGLE, directionToward, hexCorners, key as hexKey } from "../battle/hexmath.js";
import { formationLayout } from "../battle/formations.js";
import { BOARD_TINT, ACCENT } from "../battle/colors.js";
import { LINE_WIDTH, LASER_DURATION, LASER_HALO_ALPHA } from "../battle/dimensions.js";
import { CMD_R, MP_MAX, STATE_NAME } from "../battle/config.js";
import * as SC from "../battle/core/shipRules.js";
import { MathRandomSource } from "../battle/core/random.js";
import { forwardMovementCost } from "../battle/domain/movementRules.js";
import { makeEffectLoop } from "../battle/core/effectLoop.js";
import {
  executeStrategicGroupRoute, executeStrategicGroupTurn, executeStrategicRoute, findGroupReachableDestinations,
  findReachableDestinations, hexPatch, membersWithinCommand, resolveStrategicClick, StrategicClickAction,
} from "./strategicMovement.js";
import {
  activeStrategicFaction, canStrategicShipAct, completeStrategicActivations,
  createStrategicTurnState, expireStrategicTurn, hasStrategicShipActed,
  isStrategicActivationExhausted, strategicTurnRemainingMs,
} from "./strategicTurns.js";
import { buildGravityFieldGroups, warpGravityPoint } from "./gravityField.js";
import { gravitySpinDirection, resolveGravityDrift } from "./gravityDynamics.js";
import {
  scaledStrategicShipIconRadius, strategicShipColor, STRATEGIC_FACTION_COLORS,
} from "./shipAppearance.js";

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
const infoGroupMove = document.getElementById("infoGroupMove");
const infoEnd = document.getElementById("infoEnd");
const mapArea = document.getElementById("mapArea");
const turnPanel = document.getElementById("turnPanel");
const turnHeading = document.getElementById("turnHeading");
const turnClock = document.getElementById("turnClock");
const turnFactions = document.getElementById("turnFactions");
const urlParams = new URLSearchParams(window.location.search);
const forcedRenderer = urlParams.get("renderer");
const requestedQuality = ["low", "high"].includes(urlParams.get("quality"))
  ? urlParams.get("quality")
  : "auto";
const RENDERER_LOADING_HINT = "Loading the bundled 3D renderer…";
let createSystemScene = null;
let sceneModuleStatus = forcedRenderer === "2d" ? "skipped" : "loading";
let sceneModuleError = null;
if (sceneModuleStatus === "loading") {
  import("./scene3d.js").then(module => {
    createSystemScene = module.createSystemScene;
    sceneModuleStatus = "ready";
    if (persistentHint === RENDERER_LOADING_HINT) setHint("");
    render();
  }).catch(error => {
    sceneModuleError = error;
    sceneModuleStatus = "failed";
    render();
  });
}

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
// shipRules.js) -- spawned once at startup (spawnInitialShips) from each
// faction's formation, then persistent: a ship's position/facing/strength/
// morale only change via player commands (turn/forward/back/fire/Set
// Course) from here on, never recomputed from the formation again.
const world = new SC.World();
const random = new MathRandomSource();
const fleetRoster = new Map(Object.keys(FACTIONS).map(faction => [faction, []]));
let strategicTurn = createStrategicTurnState({ startedAtMs: performance.now() });
let lastRenderedTimerSecond = null;
let lastTurnRosterSignature = null;
// Whichever single ship (an entity id, or null) is currently selected at
// the System level, plus its in-progress activation -- mirrors
// the tactical GameContext's `act` shape ({u,mp,moved,fired,fireMode,cmd})
// but owned here directly rather than through a tactical context, since
// there's no turn order to hand off to (see shipRules.js's header for
// why). travelArmed is Set-Course's own "next click is a destination"
// flag, armed by the Travel button and consumed by the next click.
let selectedShip = null;
let activation = null;
let travelArmed = false;
let groupMoveArmed = false;
const groupMovePreferences = new Set();
// Fire's own transient shot-line records, derived here from fire results
// -- a parallel, map-local array to battle's own presentation effects (not
// shared with it), each with a start timestamp/duration so ensureEffectLoop
// can fade it out over subsequent frames exactly like battle/render.js's
// own laser effect, instead of a static line that only ever repaints when
// something else happens to trigger a render.
const effects = [];
// The RAF-loop mechanics for fading `effects` out -- see render()'s use
// of this below, and battle/core/effectLoop.js for why this is shared
// with battle/render.js's own laser-fade loop instead of a second
// hand-rolled copy of the same "keep repainting while anything's still
// fading" bookkeeping.
const ensureEffectLoop = makeEffectLoop();
// The asteroid field's current hexes (a Set of "c,r" keys, see
// battle/hexmath.js's key()) -- refreshed from the retained system-layout
// cache whenever the System renderer paints. Passed into shipRules.js's
// legalTargets/canFire as extraObstacles (asteroids still block line of
// sight); movement cost is this file's own concern (see hexMoveCost), not
// shipRules.js's. Read by the command functions below (doForward,
// doFireAt, ...), which live outside any single render, hence
// module-level rather than a render-local const.
let beltObstacles = new Set();
// Every hex under a body's gravity (a Map of "c,r" -> {cost,colorHex,x,y},
// see gravityHexes) -- same lifecycle as beltObstacles, read by hexMoveCost
// from outside any single render.
let gravityHexCosts = new Map();
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
// Sparse map overlays are driven by hex identity, not raw pointer pixels.
// `pointerHex` also powers map-level destination hit testing; the neutral
// orientation patch is only present when the pointer is over empty space.
let pointerHex = null;
let hoverPatchCenter = null;
let reachableMoves = new Map();
let hoverMoveHint = null;
let persistentHint = "";

initFleetPositions();

// Nothing on the map carries a floating label anymore (see addBody/
// addShip in scene3d.js and drawDot/drawShip below) -- this panel is
// where a click's result actually shows up instead. Read every time
// through renderInfoPanel() rather than pushed reactively, so any click
// handler can just update selectedShip/lastClickedInfo and call it,
// the same way setHint(...) already works.
function infoFor(hit) {
  if (!hit) return null;
  if (hit.kind === "star") return { name: hit.label, detail: `The star this system orbits. Gravity current: ${gravitySpinDirection(hit.id) > 0 ? "clockwise" : "counter-clockwise"}.` };
  if (hit.kind === "moon") return { name: hit.label, detail: `Moon of ${hit.parentLabel}.` };
  if (hit.kind === "planet") return { name: hit.label, detail: `Planet. Gravity current: ${gravitySpinDirection(hit.id) > 0 ? "clockwise" : "counter-clockwise"}.` };
  if (hit.kind === "asteroid") return { name: "Asteroid", detail: `Costs a full ${MP_MAX} MP to push through; still blocks line of sight.` };
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

function livingShipIdsByFaction() {
  return Object.fromEntries([...fleetRoster].map(([faction, ships]) => [
    faction,
    ships.filter(ship => SC.isAlive(world, ship)),
  ]));
}

function shipCanActThisTurn(ship) {
  return canStrategicShipAct(strategicTurn, {
    shipId: ship,
    faction: SC.factionOf(world, ship),
    alive: SC.isAlive(world, ship),
  });
}

function activationParticipants() {
  return activation?.participantShipIds || (activation ? [activation.u] : []);
}

function recordActivationParticipants(ships) {
  if (!activation) return;
  activation.participantShipIds = [...new Set([...activationParticipants(), ...ships])];
}

function activationCommitted() {
  return !!(activation && (activation.moved || activation.fired || activation.courseSet || activationParticipants().length > 1));
}

// Selecting a ship resets its activation fresh (mirrors
// battle/lifecycle/activationLifecycle.js:selectUnit). Strategic turns add
// the active-faction and already-acted gates around the shared ship rules.
function selectShip(e) {
  if (!SC.isAlive(world, e) || !shipCanActThisTurn(e)) {
    const faction = FACTIONS[activeStrategicFaction(strategicTurn)].label;
    setHint(`${SC.labelOf(world, e)} cannot act now — it is ${faction}'s turn or this ship has already acted.`);
    renderTurnPanel();
    return false;
  }
  if (activation?.u === e) return true;
  if (activation && activationCommitted()) {
    setHint(`End ${SC.labelOf(world, activation.u)}'s activation before selecting another ship.`);
    return false;
  }
  selectedShip = e;
  activation = {
    u: e, mp: MP_MAX, moved: false, fired: false, fireMode: false,
    cmd: SC.inCommand(world, e), participantShipIds: [e],
  };
  travelArmed = false;
  groupMoveArmed = SC.isFlagship(world, e)
    && groupMovePreferences.has(e)
    && commandGroupShips().length >= 2;
  setHint(groupMoveArmed
    ? `${SC.labelOf(world, e)} selected — command-group move restored.`
    : `${SC.labelOf(world, e)} selected.`);
  renderInfoPanel();
  render();
  return true;
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
  groupMoveArmed = false;
}
// Mirrors the tactical activation lifecycle, then hands control to the next
// faction once every living ship in the active faction has acted.
function completeCurrentActivation({ preserveHint = false } = {}) {
  if (!activation) return;
  const resultHint = persistentHint;
  const previousFaction = activeStrategicFaction(strategicTurn);
  const previousRound = strategicTurn.round;
  strategicTurn = completeStrategicActivations(strategicTurn, {
    shipIds: activationParticipants(),
    livingShipIdsByFaction: livingShipIdsByFaction(),
    nowMs: performance.now(),
  });
  lastRenderedTimerSecond = null;
  clearSelection();
  if (strategicTurn.round !== previousRound || activeStrategicFaction(strategicTurn) !== previousFaction) {
    const nextTurn = `${FACTIONS[activeStrategicFaction(strategicTurn)].label} turn begins.`;
    setHint(preserveHint ? `${resultHint} ${nextTurn}` : nextTurn);
  } else if (!preserveHint) {
    setHint("");
  }
  renderInfoPanel();
  render();
}
function endActivation() {
  completeCurrentActivation();
}

function completeExhaustedActivation() {
  if (!activation || !isStrategicActivationExhausted({
    canMove: SC.canMove(activation),
    canFire: SC.canFire(world, activation, beltObstacles),
  })) return false;
  const label = SC.labelOf(world, activation.u);
  setHint(persistentHint
    ? `${persistentHint} Activation complete.`
    : `${label} has no actions remaining. Activation complete.`);
  completeCurrentActivation({ preserveHint: true });
  return true;
}

function finishActionRender() {
  if (completeExhaustedActivation()) return;
  renderInfoPanel();
  render();
}

function doTurn(dir) {
  if (groupMoveArmed) {
    const ships = commandGroupShips();
    const result = executeStrategicGroupTurn(ships, {
      activation,
      turn: ship => SC.turn(world, ship, dir),
    });
    if (!result.ok) return;
    recordActivationParticipants(ships);
    setHint(`${ships.length} ships turned ${dir > 0 ? "left" : "right"} together for 1 MP.`);
    finishActionRender();
    return;
  }
  if (!SC.canMove(activation)) return;
  SC.turn(world, activation.u, dir);
  activation.mp--; activation.moved = true; activation.fireMode = false;
  setHint("");
  finishActionRender();
}
function moveResultHint(res) {
  if (res.reason === "shaken") setHint("Shaken — refuses to close the distance.");
  else if (res.reason === "blocked") setHint("Another ship blocks that hex.");
}
// A plain, terrain-free hex step's own MP price -- the baseline every
// ship pays before any obstacle is factored in. Kept as its own named
// constant (rather than a bare 1 sprinkled through the cost math below)
// so a future per-ship move cost (e.g. a heavier hull that costs more
// than 1 MP/hex even in open space) is a one-line swap to a lookup here,
// with hexExtraCost's terrain math untouched either way.
// Neither the asteroid field nor a gravity well blocks movement outright;
// they just add to a ship's MP budget to push through -- an
// asteroid hex demands the rest of a full tank, a gravity well an
// uncapped extra that grows the closer/deeper in a hex sits (see
// gravityHexCost). Expressed as *extra* MP on top of MOVE_BASE_COST,
// not an absolute replacement, so a future ship with its own non-1 base
// move cost still gets the right total (base + extra) without this
// function changing. Where both obstacles apply to the same hex,
// whichever demands more extra wins (Math.max), not their sum. Only
// doForward reads this -- doBackward mirrors battle/queries.js's own
// canBack ("backward = the whole move"): a real battle rule that
// backward always costs a ship's entire MP tank, terrain or not, kept
// as-is rather than metered like forward to match the same ship
// config the tactical battle screen uses.
function hexMoveCost(hex) {
  const k = hexKey(hex[0], hex[1]);
  return forwardMovementCost({
    hasAsteroid: beltObstacles.has(k),
    gravityCost: gravityHexCosts.get(k)?.cost,
  });
}

function movementBlocker(movingShips) {
  const moving = new Set(movingShips);
  const occupied = new Set();
  for (const ship of SC.aliveShips(world)) {
    if (moving.has(ship)) continue;
    const [c, r] = SC.posOf(world, ship);
    occupied.add(hexKey(c, r));
  }
  return nextPosition => occupied.has(hexKey(nextPosition[0], nextPosition[1]));
}

function commandGroupShips() {
  if (!activation || !SC.isAlive(world, activation.u) || !SC.isFlagship(world, activation.u)) return [];
  const friendlyMembers = SC.shipsOfFaction(world, SC.factionOf(world, activation.u))
    .filter(ship => shipCanActThisTurn(ship))
    .map(id => ({ id, position: SC.posOf(world, id) }));
  return membersWithinCommand(activation.u, friendlyMembers, CMD_R).map(member => member.id);
}

function commandGroupMembers() {
  return commandGroupShips().map(id => ({
    id,
    position: SC.posOf(world, id),
    facing: SC.facingOf(world, id),
    moraleState: SC.moraleOf(world, id),
  }));
}

function groupMoveText(route) {
  return `${route.memberRoutes.length} ships move together · ${route.cost} MP`;
}

function groupRouteTo(destination) {
  return destination ? reachableMoves.get(hexKey(destination[0], destination[1])) : null;
}

function recomputeReachableMoves() {
  if (!activation || !SC.isAlive(world, activation.u)) {
    reachableMoves = new Map();
  } else if (groupMoveArmed) {
    const members = commandGroupMembers();
    const groupIsBlocked = movementBlocker(members.map(member => member.id));
    reachableMoves = findGroupReachableDestinations({
      leaderId: activation.u,
      members,
      activation,
      enemyPositions: SC.enemiesOf(world, SC.factionOf(world, activation.u)).map(e => SC.posOf(world, e)),
      movementAllowance: MP_MAX,
      movementCost: (_member, nextPosition) => hexMoveCost(nextPosition),
      isBlocked: (_member, nextPosition) => groupIsBlocked(nextPosition),
      resolveForcedMovement: (_member, position) => gravityDrift(position),
    });
  } else {
    reachableMoves = findReachableDestinations({
      position: SC.posOf(world, activation.u),
      facing: SC.facingOf(world, activation.u),
      activation,
      moraleState: SC.moraleOf(world, activation.u),
      enemyPositions: SC.enemiesOf(world, SC.factionOf(world, activation.u)).map(e => SC.posOf(world, e)),
      movementAllowance: MP_MAX,
      movementCost: hexMoveCost,
      isBlocked: movementBlocker([activation.u]),
      resolveForcedMovement: gravityDrift,
    });
  }
  const hoveredRoute = pointerHex ? reachableMoves.get(hexKey(pointerHex[0], pointerHex[1])) : null;
  hoverMoveHint = hoveredRoute
    ? (groupMoveArmed ? groupMoveText(hoveredRoute) : `Move here · ${hoveredRoute.cost} MP`)
    : null;
  renderHint();
}

function executeReachableMove(route) {
  if (!activation || route.cost > activation.mp) return false;
  const movingAsGroup = !!(groupMoveArmed && route.memberRoutes);
  const movingShips = movingAsGroup
    ? route.memberRoutes.map(plan => plan.memberId)
    : [activation.u];
  const isBlocked = movementBlocker(movingShips);
  const result = movingAsGroup
    ? executeStrategicGroupRoute(route, {
      activation,
      actionsFor: ship => ({
        turnLeft: () => SC.turn(world, ship, 1),
        turnRight: () => SC.turn(world, ship, -1),
        moveForward: () => SC.moveForward(world, ship, { isBlocked }),
        moveBackward: () => SC.moveBackward(world, ship, { isBlocked }),
        applyForcedStep: drift => SC.setPosition(world, ship, ...drift.to),
      }),
    })
    : executeStrategicRoute(route, {
      activation,
      turnLeft: () => SC.turn(world, activation.u, 1),
      turnRight: () => SC.turn(world, activation.u, -1),
      moveForward: () => SC.moveForward(world, activation.u, { isBlocked }),
      moveBackward: () => SC.moveBackward(world, activation.u, { isBlocked }),
      applyForcedStep: drift => SC.setPosition(world, activation.u, ...drift.to),
    });
  if (!result.ok) {
    moveResultHint(result);
    renderInfoPanel();
    render();
    return false;
  }
  if (movingAsGroup) recordActivationParticipants(route.memberRoutes.map(plan => plan.memberId));
  // The route's individual rule calls mutate only position/facing. The
  // activation bookkeeping is committed once after the complete route.
  hoverPatchCenter = null;
  setHint(movingAsGroup
    ? `${route.memberRoutes.length} ships moved together for ${route.cost} MP; gravity may have separated the formation.`
    : `${SC.labelOf(world, activation.u)} moved ${route.cost} MP${route.forcedSteps?.length ? " and drifted with the current" : ""}.`);
  finishActionRender();
  return true;
}
function doForward() {
  if (groupMoveArmed) {
    const route = groupRouteTo(SC.forwardHex(world, activation.u));
    if (!route) {
      setHint("The command group cannot move forward together from here.");
      renderInfoPanel();
      return;
    }
    executeReachableMove(route);
    return;
  }
  if (!SC.canMove(activation)) return;
  const cost = hexMoveCost(SC.forwardHex(world, activation.u));
  if (activation.mp < cost) { setHint(`Not enough MP -- that hex costs ${cost}.`); renderInfoPanel(); return; }
  const res = SC.moveForward(world, activation.u, { isBlocked: movementBlocker([activation.u]) });
  if (!res.ok) { moveResultHint(res); renderInfoPanel(); return; }
  activation.mp -= cost; activation.moved = true; activation.fireMode = false;
  const drift = gravityDrift(SC.posOf(world, activation.u));
  if (drift) SC.setPosition(world, activation.u, ...drift.to);
  setHint(drift ? `Gravity current pulls ${SC.labelOf(world, activation.u)} one hex ${drift.wellId === "sun" ? "around the Sun" : `around ${drift.wellId}`}.` : "");
  finishActionRender();
}
function doBackward() {
  if (groupMoveArmed) {
    const route = groupRouteTo(SC.backwardHex(world, activation.u));
    if (!route) {
      setHint("The command group cannot move back together from here.");
      renderInfoPanel();
      return;
    }
    executeReachableMove(route);
    return;
  }
  if (!SC.canBack(activation)) return;
  const res = SC.moveBackward(world, activation.u, { isBlocked: movementBlocker([activation.u]) });
  if (!res.ok) { moveResultHint(res); renderInfoPanel(); return; }
  activation.mp = 0; activation.moved = true; activation.fireMode = false;
  const drift = gravityDrift(SC.posOf(world, activation.u));
  if (drift) SC.setPosition(world, activation.u, ...drift.to);
  setHint(drift ? `Gravity current pulls ${SC.labelOf(world, activation.u)} one hex.` : "");
  finishActionRender();
}
// Arms the cosmetic "fire mode" hint -- exactly like battle, clicking a
// legal target fires regardless of whether this was pressed first (see
// handleShipOrDestinationClick), so this only exists to show
// "pick a highlighted target" in the panel.
function armFireMode() {
  if (!SC.canFire(world, activation, beltObstacles)) return;
  groupMoveArmed = false;
  activation.fireMode = true;
  render();
}
function doFireAt(tgt) {
  if (!SC.canFire(world, activation, beltObstacles)) return;
  if (!SC.legalTargets(world, activation.u, beltObstacles).includes(tgt)) return;
  const firer = activation.u;
  groupMoveArmed = false;
  const result = SC.fire(world, firer, tgt, random);
  effects.push({
    from: result.from, to: result.to, hit: result.hits > 0, start: performance.now(),
    dur: result.hits > 0 ? LASER_DURATION.hit : LASER_DURATION.miss,
  });
  activation.fired = true; activation.fireMode = false;
  setHint(`${SC.labelOf(world, firer)} fires (${result.arc} arc, ${result.need}+): [${result.rolls.join(" ")}] → ` +
    `${result.hits} hit${result.hits === 1 ? "" : "s"}${result.destroyed ? " — destroyed!" : ""}`);
  if (!activation.cmd) { completeCurrentActivation({ preserveHint: true }); return; } // out of command: fire was the whole activation
  finishActionRender();
}
// Arms Set Course -- the next click anywhere (body, ship, or empty space)
// becomes the selected ship's new position, an instant reposition with
// none of moveForward/moveBackward's neighbor/Shaken rules. Its endpoint
// still cannot overlap another ship.
// (matching the old whole-fleet moveFleet's own instant-move semantics),
// for real interplanetary distances the hex-by-hex MP budget can't cover.
function armTravel() {
  if (!activation) return;
  groupMoveArmed = false;
  travelArmed = true;
  setHint("Click a destination to set course.");
  render();
}
function toggleGroupMove() {
  const ships = commandGroupShips();
  if (!activation) return;
  if (groupMoveArmed || groupMovePreferences.has(activation.u)) {
    groupMoveArmed = false;
    groupMovePreferences.delete(activation.u);
  } else {
    if (!SC.canMove(activation) || ships.length < 2) return;
    groupMoveArmed = true;
    groupMovePreferences.add(activation.u);
  }
  travelArmed = false;
  activation.fireMode = false;
  setHint(groupMoveArmed
    ? `Command-group move armed for ${ships.length} ships. Use Turn/Forward/Back or pick a highlighted destination.`
    : "Command-group move cancelled.");
  renderInfoPanel();
  render();
}
function setCourse(x, y) {
  const [c, r] = pixelToHexIndex(x, y);
  if (movementBlocker([activation.u])([c, r])) {
    setHint("Another ship already occupies that destination.");
    renderInfoPanel();
    return;
  }
  SC.setPosition(world, activation.u, c, r);
  const drift = gravityDrift([c, r]);
  if (drift) SC.setPosition(world, activation.u, ...drift.to);
  activation.courseSet = true;
  setHint(`${SC.labelOf(world, activation.u)} course set${drift ? " — captured by the gravity current" : ""}.`);
  travelArmed = false;
  hoverPatchCenter = null;
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
  const destination = worldPoint ? pixelToHexIndex(worldPoint[0], worldPoint[1]) : null;
  const route = activation && destination ? reachableMoves.get(hexKey(destination[0], destination[1])) : null;
  const clickAction = resolveStrategicClick({
    travelArmed: !!(activation && travelArmed),
    groupMoveArmed: !!(activation && groupMoveArmed),
    hasWorldPoint: !!worldPoint,
    hitKind: hit?.kind,
    reachable: !!route,
  });
  if (clickAction === StrategicClickAction.SET_COURSE) { setCourse(worldPoint[0], worldPoint[1]); return true; }
  if (clickAction === StrategicClickAction.SHIP) {
    if (activation && SC.legalTargets(world, activation.u, beltObstacles).includes(hit.id)) { doFireAt(hit.id); return true; }
    if (!activation || activation.u !== hit.id) selectShip(hit.id);
    return true;
  }
  if (clickAction === StrategicClickAction.MOVE) { executeReachableMove(route); return true; }
  return false;
}
// Shared by both click handlers' fallthrough (once
// handleShipOrDestinationClick has returned false): the star/moon/
// asteroid/planet info-panel branches, identical in both the 3D and 2D
// views since neither renderer has anything hit-kind-specific left to say
// once a ship/travel click has been ruled out.
function dispatchBodyClick(hit) {
  if (hit?.kind === "star") { setHint(""); showBodyInfo(hit); return; }
  if (hit?.kind === "moon") { setHint(`${hit.label} — a moon of ${hit.parentLabel}.`); showBodyInfo(hit); return; }
  if (hit?.kind === "asteroid") { setHint(`Asteroid — costs ${MP_MAX} MP to push through, blocks line of sight.`); showBodyInfo(hit); return; }
  if (hit?.kind === "planet") { setHint(""); showBodyInfo(hit); return; }
  setHint("Empty space — nothing here.");
  showBodyInfo(null);
}
function renderInfoPanel() {
  if (selectedShip != null && !SC.isAlive(world, selectedShip)) {
    selectedShip = null;
    activation = null;
    groupMoveArmed = false;
  }
  if (selectedShip != null) {
    const u = selectedShip;
    infoEmpty.style.display = "none";
    infoBody.style.display = "block";
    infoName.textContent = `${SC.labelOf(world, u)}${SC.isFlagship(world, u) ? " ★" : ""}`;
    infoDetail.textContent = `${FACTIONS[SC.factionOf(world, u)].label} — Str ${SC.strengthOf(world, u)}, ${STATE_NAME[SC.moraleOf(world, u)]}`;
    infoControls.style.display = "flex";
    const commandedShips = commandGroupShips();
    const groupMoveSaved = SC.isFlagship(world, u) && groupMovePreferences.has(u);
    const groupMoveEnabled = groupMoveArmed || groupMoveSaved;
    const groupForwardRoute = groupMoveArmed ? groupRouteTo(SC.forwardHex(world, u)) : null;
    const groupBackwardRoute = groupMoveArmed ? groupRouteTo(SC.backwardHex(world, u)) : null;
    infoShipStatus.innerHTML =
      `${activation.cmd ? "In command (move + fire)" : "Out of command (move OR fire)"}<br>` +
      `MP ${activation.mp}/${MP_MAX}${activation.fired ? " · has fired" : ""}` +
      (activation.fireMode ? `<br><span style="color:var(--red)">Pick a highlighted target.</span>` : "") +
      (travelArmed ? `<br><span style="color:var(--red)">Click a destination.</span>` : "") +
      (groupMoveArmed ? `<br><span style="color:var(--gold)">${commandedShips.length} ships moving together. Use the movement controls or pick a destination.</span>` : "");
    infoTurnL.disabled = infoTurnR.disabled = !SC.canMove(activation);
    infoForward.disabled = groupMoveArmed ? !groupForwardRoute : !SC.canMove(activation);
    infoBack.disabled = groupMoveArmed ? !groupBackwardRoute : !SC.canBack(activation);
    infoTurnL.title = infoTurnR.title = groupMoveArmed ? `Turn all ${commandedShips.length} ships · 1 MP` : "";
    infoForward.title = groupMoveArmed && groupForwardRoute
      ? `Move all ${commandedShips.length} ships forward · ${groupForwardRoute.cost} MP`
      : "";
    infoBack.title = groupMoveArmed && groupBackwardRoute
      ? `Move all ${commandedShips.length} ships back · ${groupBackwardRoute.cost} MP`
      : "1 hex astern, keeps facing — costs all remaining MP";
    infoFire.disabled = !SC.canFire(world, activation, beltObstacles);
    infoGroupMove.style.display = SC.isFlagship(world, u) ? "" : "none";
    infoGroupMove.textContent = groupMoveEnabled
      ? "Cancel group move"
      : `Move command group (${commandedShips.length})`;
    infoGroupMove.disabled = !groupMoveEnabled && (!SC.canMove(activation) || commandedShips.length < 2);
    infoGroupMove.setAttribute("aria-pressed", String(groupMoveEnabled));
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
infoGroupMove.onclick = toggleGroupMove;
infoEnd.onclick = endActivation;

function strategicShipDisplayState(ship, faction, participantSet) {
  if (!SC.isAlive(world, ship)) return { label: "Destroyed", className: "destroyed" };
  if (participantSet.has(ship)) return { label: "Acting", className: "acting" };
  if (strategicTurn.forfeitedShipIds.includes(ship)) return { label: "Timed out", className: "spent" };
  if (hasStrategicShipActed(strategicTurn, ship)) return { label: "Acted", className: "spent" };
  if (faction === activeStrategicFaction(strategicTurn)) return { label: "Ready", className: "ready" };
  return { label: "Waiting", className: "waiting" };
}

function focusStrategicShip(ship) {
  const [x, z] = shipHexOffset(...SC.posOf(world, ship));
  if (mapArea.dataset.renderer === "3d" && scene3d) {
    scene3d.panTo(x, z);
  } else {
    camera2d.x = x;
    camera2d.y = z;
    render();
  }
}

function selectShipFromRoster(ship) {
  focusStrategicShip(ship);
  if (shipCanActThisTurn(ship)) {
    selectShip(ship);
    return;
  }
  const faction = SC.factionOf(world, ship);
  const state = strategicShipDisplayState(ship, faction, new Set(activationParticipants()));
  setHint(`${SC.labelOf(world, ship)} focused — ${state.label.toLowerCase()}.`);
  renderTurnPanel();
}

function renderTurnClock(nowMs = performance.now()) {
  const remainingSeconds = Math.ceil(strategicTurnRemainingMs(strategicTurn, nowMs) / 1000);
  lastRenderedTimerSecond = remainingSeconds;
  turnClock.textContent = `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")} remaining`;
}

function renderTurnPanel(nowMs = performance.now()) {
  if (!shipsSpawned) return;
  const activeFaction = activeStrategicFaction(strategicTurn);
  turnHeading.textContent = `Round ${strategicTurn.round} · ${FACTIONS[activeFaction].label} turn`;
  renderTurnClock(nowMs);
  const participantSet = new Set(activationParticipants());
  const rosterSignature = JSON.stringify({
    round: strategicTurn.round,
    activeFaction,
    acted: strategicTurn.actedShipIds,
    forfeited: strategicTurn.forfeitedShipIds,
    selectedShip,
    participants: [...participantSet],
    alive: [...fleetRoster.values()].flat().map(ship => SC.isAlive(world, ship)),
  });
  if (rosterSignature === lastTurnRosterSignature) return;
  lastTurnRosterSignature = rosterSignature;
  turnFactions.replaceChildren();

  for (const [faction, ships] of fleetRoster) {
    const section = document.createElement("section");
    section.className = `turnFaction${faction === activeFaction ? " active" : ""}`;
    const header = document.createElement("div");
    header.className = "turnFactionHeader";
    const name = document.createElement("span");
    name.textContent = FACTIONS[faction].label;
    name.style.color = colorsFor({ faction }).fill;
    const ready = ships.filter(ship => shipCanActThisTurn(ship) && !participantSet.has(ship)).length;
    const livingShips = ships.filter(ship => SC.isAlive(world, ship));
    const factionState = document.createElement("span");
    factionState.className = "turnFactionState";
    factionState.textContent = faction === activeFaction
      ? `${ready} ready`
      : (livingShips.length && livingShips.every(ship => hasStrategicShipActed(strategicTurn, ship)) ? "complete" : "waiting");
    header.append(name, factionState);
    section.appendChild(header);

    const shipList = document.createElement("div");
    shipList.className = "turnShips";
    for (const ship of ships) {
      const displayState = strategicShipDisplayState(ship, faction, participantSet);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `turnShip ${displayState.className}`;
      button.title = `${SC.labelOf(world, ship)} — ${displayState.label}. Focus this ship.`;
      button.setAttribute("aria-pressed", String(selectedShip === ship));
      const label = document.createElement("span");
      label.textContent = `${SC.labelOf(world, ship)}${SC.isFlagship(world, ship) ? " ★" : ""}`;
      const status = document.createElement("span");
      status.className = "turnShipState";
      status.textContent = displayState.label;
      button.append(label, status);
      button.onclick = () => selectShipFromRoster(ship);
      shipList.appendChild(button);
    }
    section.appendChild(shipList);
    turnFactions.appendChild(section);
  }
}

function tickStrategicTurn(nowMs = performance.now()) {
  if (!shipsSpawned) return;
  const expiringFaction = activeStrategicFaction(strategicTurn);
  const result = expireStrategicTurn(strategicTurn, {
    livingShipIdsByFaction: livingShipIdsByFaction(),
    nowMs,
  });
  if (result.expired) {
    if (activation && SC.factionOf(world, activation.u) === expiringFaction) activation.mp = 0;
    strategicTurn = result.state;
    clearSelection();
    lastRenderedTimerSecond = null;
    setHint(`${FACTIONS[expiringFaction].label} ran out of time — ${result.expiredShipIds.length} remaining ships lost their MP. ${FACTIONS[activeStrategicFaction(strategicTurn)].label} turn begins.`);
    render();
    return;
  }
  const remainingSeconds = Math.ceil(strategicTurnRemainingMs(strategicTurn, nowMs) / 1000);
  if (remainingSeconds !== lastRenderedTimerSecond) renderTurnClock(nowMs);
}

function levelData(entry) {
  return entry.level === "system" ? systemLevel(entry.systemId) : universeLevel();
}

const FILL = {
  system: "#3a2f6a", star: "#5a4a1a", planet: "#1a3a5c", belt: "#b58a5c",
  "body-center": "#5a4a1a", moon: "#2e3644",
};
const STROKE = {
  system: "#a78bfa", star: "#ffd166", planet: "#4a9eff", belt: "#e0b98a",
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
const BODY_TEXTURES = {
  sun: new URL("./textures/2k_sun.jpg", import.meta.url).href,
  mercury: new URL("./textures/2k_mercury.jpg", import.meta.url).href,
  venus: new URL("./textures/2k_venus_surface.jpg", import.meta.url).href,
  earth: new URL("./textures/2k_earth_daymap.jpg", import.meta.url).href,
  mars: new URL("./textures/2k_mars.jpg", import.meta.url).href,
  jupiter: new URL("./textures/2k_jupiter.jpg", import.meta.url).href,
  saturn: new URL("./textures/2k_saturn.jpg", import.meta.url).href,
  uranus: new URL("./textures/2k_uranus.jpg", import.meta.url).href,
  neptune: new URL("./textures/2k_neptune.jpg", import.meta.url).href,
  moon: new URL("./textures/2k_moon.jpg", import.meta.url).href,
};
const textureFor = cell => BODY_TEXTURES[cell.id];

// Faction fleet/ship colors (see FACTIONS in levels.js) -- checked via
// cell.faction rather than cell.id, since a ship's id is its own ECS
// entity number (see shipRules.js), not a shared small id space like
// planets/moons. Neon rather than the muted tones everything else uses:
// each ship is a single small icon on its own hex cell (see
// shipsSnapshot), and a small icon needs to read as a bright dot from
// across the whole system at a glance, not blend into the rest of the
// palette the way a bigger shape safely could.
const FACTION_COLORS = STRATEGIC_FACTION_COLORS;

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
// single "1-hex asteroid" -- costs a ship's whole MP budget to push into
// (see hexMoveCost) and still blocks line of sight, but doesn't block
// movement outright the way another ship does -- or is empty. Two fixed
// angular wedges are kept permanently clear -- corridors through the
// field, LOTGH's Iserlohn/Fezzan corridors being the reference: the belt
// is otherwise dense enough to matter, but these two
// lanes are the only reliable way through, so controlling them is the
// actual tactical prize.
const BELT_ASTEROID_FILL = 0.5;
const BELT_CORRIDOR_CENTERS_DEG = [90, 270];
const BELT_CORRIDOR_HALF_WIDTH_DEG = 12;
const BELT_ASTEROID_RADIUS_PX = 2.4;

// Shared pointy-top strategic hex size. The lattice itself is intentionally
// sparse: gravity, reachable destinations, occupied tokens, and the hover
// orientation patch are the only features that reveal cells.
const GRID_HEX_SIZE_PX = 5;

// Pointy-top pixel math for an offset-coordinate [c,r] pair, exactly what
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
  const wells = systemStaticCache?.wells || [];
  if (!wells.length) return [c, r];
  // Invert the bounded visual warp by finding the nearest projected cell in
  // a small local patch.  Logical positions remain regular axial hexes.
  let best = [c, r], bestDistance = Infinity;
  for (let rr = r - 2; rr <= r + 2; rr++) {
    for (let cc = c - 2; cc <= c + 2; cc++) {
      const [gx, gy] = shipHexOffset(cc, rr);
      const [wx, wy] = warpedGravityPoint(gx, gy, wells);
      const distance = (wx - x) ** 2 + (wy - y) ** 2;
      if (distance < bestDistance) { best = [cc, rr]; bestDistance = distance; }
    }
  }
  return best;
}
function snapToHexGrid(x, y) {
  return shipHexOffset(...pixelToHexIndex(x, y));
}

function sparseOverlaySnapshot() {
  const toCell = ([c, r]) => {
    const [x, z] = shipHexOffset(c, r);
    return { c, r, x, z, key: hexKey(c, r) };
  };
  const commandCenter = selectedShip != null && SC.isAlive(world, selectedShip) && SC.isFlagship(world, selectedShip)
    ? SC.posOf(world, selectedShip)
    : null;
  return {
    commandCells: commandCenter ? hexPatch(commandCenter, CMD_R).map(toCell) : [],
    hoverCells: hoverPatchCenter ? hexPatch(hoverPatchCenter).map(toCell) : [],
    reachableCells: [...reachableMoves.values()].map(route => ({ ...toCell(route.position), cost: route.cost })),
    hoveredKey: pointerHex ? hexKey(pointerHex[0], pointerHex[1]) : null,
    colorHex: activation ? colorsFor({ faction: SC.factionOf(world, activation.u) }).fill : null,
    hexSize: GRID_HEX_SIZE_PX,
    projectPoint: (x, z) => warpedGravityPoint(x, z, systemStaticCache?.wells || []),
  };
}

function updateSystemHover(hit, worldPoint, refreshOverlay) {
  showHoverInfo(hit);
  const nextPointer = worldPoint ? pixelToHexIndex(worldPoint[0], worldPoint[1]) : null;
  const nextPatch = !hit && nextPointer ? nextPointer : null;
  const oldPointerKey = pointerHex ? hexKey(pointerHex[0], pointerHex[1]) : null;
  const nextPointerKey = nextPointer ? hexKey(nextPointer[0], nextPointer[1]) : null;
  const oldPatchKey = hoverPatchCenter ? hexKey(hoverPatchCenter[0], hoverPatchCenter[1]) : null;
  const nextPatchKey = nextPatch ? hexKey(nextPatch[0], nextPatch[1]) : null;
  if (oldPointerKey === nextPointerKey && oldPatchKey === nextPatchKey) return;
  pointerHex = nextPointer;
  hoverPatchCenter = nextPatch;
  const route = nextPointerKey ? reachableMoves.get(nextPointerKey) : null;
  hoverMoveHint = route
    ? (groupMoveArmed ? groupMoveText(route) : `Move here · ${route.cost} MP`)
    : null;
  renderHint();
  refreshOverlay();
}

function clearSystemHover(refreshOverlay) {
  showHoverInfo(null);
  if (!pointerHex && !hoverPatchCenter && !hoverMoveHint) return;
  pointerHex = null;
  hoverPatchCenter = null;
  hoverMoveHint = null;
  renderHint();
  refreshOverlay();
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
// formationLayout()-relative-offset math the old placeShips used. Every
// ship receives its own six-direction facing toward the Sun at hex [0,0].
let shipsSpawned = false;
function spawnInitialShips(layout) {
  for (const [faction, pos] of Object.entries(FLEET_POSITIONS)) {
    const distanceKm = Math.hypot(pos.xKm, pos.yKm);
    const angle = Math.atan2(pos.yKm, pos.xKm);
    const r = layout.dist.toPixel(distanceKm);
    const [anchorX, anchorY] = snapToHexGrid(r * Math.cos(angle), r * Math.sin(angle));
    const { u, flag } = formationLayout(FLEET_FORMATIONS[faction], SHIPS_PER_FACTION);
    u.forEach(([fwd, lat], i) => {
      const [dx, dy] = shipHexOffset(fwd, lat);
      const [c, rIdx] = pixelToHexIndex(anchorX + dx, anchorY + dy);
      const ship = SC.spawnShip(world, {
        faction, c, r: rIdx, dir: directionToward([c, rIdx], [0, 0]), isFlagship: i === flag,
        label: `${faction[0].toUpperCase()}${i + 1}`,
      });
      fleetRoster.get(faction).push(ship);
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
// spawnInitialShips) via shipHexOffset, the same conversion every sparse
// overlay uses, so a ship's token always lines up with its strategic cell.
// Called fresh every render (World lookups are
// cheap; this is no more expensive than the old formula-driven version).
function shipsSnapshot(wells = []) {
  // Mirrors battle/render.js's own `tgts = Q.canFire(state) ? Q.legalTargets(...) : []`
  // -- only highlight targets while the selected ship could actually still
  // fire this activation (not, say, after it's already fired). The
  // outline uses the *attacker's* own faction color, not a fixed accent
  // -- a fixed red would nearly vanish against a Red-faction target's
  // own red fill/stroke, and the attacker's color reads as "who can hit
  // this" at a glance.
  const targets = activation && SC.canFire(world, activation, beltObstacles)
    ? new Set(SC.legalTargets(world, activation.u, beltObstacles)) : null;
  const groupMembers = groupMoveArmed ? new Set(commandGroupShips()) : null;
  const targetColor = targets ? colorsFor({ faction: SC.factionOf(world, activation.u) }).fill : null;
  return SC.aliveShips(world).map(e => {
    const [c, r] = SC.posOf(world, e);
    const [gridX, gridY] = shipHexOffset(c, r);
    const [x, y] = warpedGravityPoint(gridX, gridY, wells);
    const hasActed = hasStrategicShipActed(strategicTurn, e);
    return {
      id: e, kind: "ship", faction: SC.factionOf(world, e), isFlag: SC.isFlagship(world, e),
      label: SC.labelOf(world, e), facingDeg: DIR_ANGLE[SC.facingOf(world, e)],
      isTarget: !!targets?.has(e), targetColor, isGroupMember: !!groupMembers?.has(e),
      hasActed, colorHex: strategicShipColor(SC.factionOf(world, e), hasActed),
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
// strategic lattice and every ship use) falls inside the belt's real
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

// Gravity wells are the Sun and planets. Moons remain visual bodies only,
// and the asteroid belt is terrain rather than a single point mass.
function gravityWells(layout) {
  const wells = [];
  if (layout.center) wells.push({ id: layout.center.id, x: 0, z: 0, rPx: layout.center.rPx, colorHex: colorsFor(layout.center).fill, spinDirection: gravitySpinDirection(layout.center.id) });
  for (const p of layout.planets) {
    if (p.kind !== "belt") wells.push({ id: p.id, x: p.x, z: p.y, rPx: p.rPx, colorHex: colorsFor(p).fill, spinDirection: gravitySpinDirection(p.id) });
  }
  return wells;
}

// Gravity influence radius scales with a body's own rendered size --
// bigger bodies (the Sun, gas giants) reach further and pull harder than
// small ones (Mercury). A well
// too small to reach even one hex (radius < GRID_HEX_SIZE_PX) is skipped
// entirely -- gravityWells already excludes moons, but a very small/
// close-in planet could still round to nothing.
const GRAVITY_INFLUENCE_RADIUS_FACTOR = 4;
// The 2D fallback's own opacity ceiling (see the gravity-hex drawing loop
// in renderSystem2D) -- scaled down per hex by gravityHexIntensity, so
// only the deepest hexes ever actually reach this value.
const GRAVITY_HEX_MAX_OPACITY = 0.3;
// Cost is a real, unbounded falloff, not a flat 3-tier scale -- inversely
// proportional to distance in units of the body's own radius, scaled so
// it lands on exactly 1 MP (the same as open space) right at the edge of
// GRAVITY_INFLUENCE_RADIUS_FACTOR: a hex FACTOR radii out costs
// FACTOR/FACTOR = 1; one body-radius out (a planet's own "surface")
// costs FACTOR; deep inside costs more still, with no ceiling -- next to
// something as massive as the Sun this can run well past the old fixed
// cap of 3, which is the point (the pull really is that dominant that
// close in, not an arbitrary game-balance number). distRadii is floored
// well short of 0 to avoid a divide-by-near-zero singularity exactly at
// a well's own center.
function gravityHexCost(distPx, well) {
  const distRadii = Math.max(distPx / well.rPx, 0.25);
  return Math.max(1, Math.ceil(GRAVITY_INFLUENCE_RADIUS_FACTOR / distRadii));
}
// A 0..1 read of the same cost value, for painting: the cheapest hexes
// (cost 1, the outer edge of a well's reach) paint at
// GRAVITY_HEX_MIN_INTENSITY, climbing toward full intensity as cost
// grows -- so the color itself visibly deepens/brightens the closer (and
// more expensive) a hex is, the same falloff the MP cost already uses,
// just read as a gradient instead of a number. Cost is unbounded
// (gravityHexCost has no ceiling right next to a massive body), so this
// clamps at 1 rather than trying to normalize against some cost that
// might not exist.
const GRAVITY_HEX_MIN_INTENSITY = 0.25;
const GRAVITY_HEX_INTENSITY_PER_COST = 0.05;
function gravityHexIntensity(cost) {
  return Math.min(1, GRAVITY_HEX_MIN_INTENSITY + cost * GRAVITY_HEX_INTENSITY_PER_COST);
}

// Every hex within reach of the Sun or a planet's gravity, painted that
// body's own color. Where two wells' reach overlaps, a hex takes
// whichever well demands the *most* MP (worst case); a tie keeps
// whichever well was found first (arbitrary but stable within one
// render). Bounded per-well -- only hexes within that one well's own
// radius are ever considered, the same "local scan, not the whole grid"
// approach beltAsteroidHexes uses -- so this stays cheap even though the
// Sun's own field alone can cover a thousand-plus hexes.
function gravityHexes(layout) {
  const cells = new Map(); // "c,r" -> {cost, colorHex, x, y}
  for (const well of gravityWells(layout)) {
    const radius = well.rPx * GRAVITY_INFLUENCE_RADIUS_FACTOR;
    if (radius < GRID_HEX_SIZE_PX) continue;
    const rMax = Math.ceil(radius / (GRID_HEX_SIZE_PX * 1.5)) + 1;
    const [centerC, centerR] = pixelToHexIndex(well.x, well.z);
    for (let r = centerR - rMax; r <= centerR + rMax; r++) {
      for (let c = centerC - rMax; c <= centerC + rMax; c++) {
        const [x, y] = shipHexOffset(c, r);
        const dist = Math.hypot(x - well.x, y - well.z);
        if (dist > radius) continue;
        const cost = gravityHexCost(dist, well);
        const k = hexKey(c, r);
        const existing = cells.get(k);
        if (!existing || cost > existing.cost) cells.set(k, { c, r, cost, colorHex: well.colorHex, x, y, well });
      }
    }
  }
  return cells;
}
// Refreshes the module-level gravityHexCosts (see its declaration above)
// from the current gravity-hex map -- called once per render, right
// after computing it, mirroring updateBeltObstacles above.
function updateGravityHexes(cells) {
  gravityHexCosts = cells;
}

function gravityDrift(position) {
  return resolveGravityDrift(position, gravityHexCosts, hex => shipHexOffset(hex[0], hex[1]));
}

function warpedGravityPoint(x, y, wells) {
  // The deformation is visual, but it is now used consistently by every
  // tactical marker.  The existing falloff remains bounded away from a
  // body's center so the discrete logical grid stays readable.
  return warpGravityPoint(x, y, wells, GRID_HEX_SIZE_PX);
}

function gravityHexCorners(x, y, wells, size = GRID_HEX_SIZE_PX) {
  return hexCorners(x, y, size).map(([px, py]) => warpedGravityPoint(px, py, wells));
}

// One in-cell arrow per gravity hex says exactly what will happen if a ship
// stops there: one free drift in this direction.  Its length stays inside
// the cell, so it communicates force without pretending to be a route.
function gravityPullArrows(cells, wells) {
  const arrows = [];
  for (const cell of cells.values()) {
    const drift = resolveGravityDrift([cell.c, cell.r], cells, hex => shipHexOffset(hex[0], hex[1]));
    if (!drift) continue;
    const [fromX, fromY] = warpedGravityPoint(cell.x, cell.y, wells);
    const [nextX, nextY] = warpedGravityPoint(...shipHexOffset(...drift.to), wells);
    const dx = nextX - fromX, dy = nextY - fromY;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length, uy = dy / length;
    const start = [fromX - ux * GRID_HEX_SIZE_PX * 0.2, fromY - uy * GRID_HEX_SIZE_PX * 0.2];
    const tip = [fromX + ux * GRID_HEX_SIZE_PX * 0.38, fromY + uy * GRID_HEX_SIZE_PX * 0.38];
    const side = [-uy, ux];
    const head = GRID_HEX_SIZE_PX * 0.16;
    arrows.push({
      colorHex: cell.colorHex, intensity: gravityHexIntensity(cell.cost),
      segments: [
        start, tip,
        tip, [tip[0] - ux * head + side[0] * head, tip[1] - uy * head + side[1] * head],
        tip, [tip[0] - ux * head - side[0] * head, tip[1] - uy * head - side[1] * head],
      ],
    });
  }
  return arrows;
}
// --- 3D path (primary) ---------------------------------------------------

let scene3d = null;
let scene3dStaticSource = null;
let webglFailed = forcedRenderer === "2d";
// Left-drag rotates the camera (see scene3d.js's mouseButtons) but a plain
// left click also needs to keep selecting/focusing bodies and fleets --
// OrbitControls' own "start"/"change"/"end" events tell a real rotate-drag
// (a "change" fired somewhere between start and end) apart from a
// stationary click, so the click handler below can ignore the click that
// fires right after a rotate-drag releases.
let sceneDragging = false;
let sceneJustDragged = false;
let gravityAnimationFrame = null;
let lastGravityAnimationRenderMs = 0;
function ensureGravityAnimation() {
  if (gravityAnimationFrame != null) return;
  const tick = now => {
    gravityAnimationFrame = null;
    if (path[path.length - 1]?.level === "system" && mapArea.dataset.renderer === "3d" && scene3d) {
      // Cosmetic body spin must not monopolize a constrained browser's main
      // thread while players click movement controls.  Eight FPS is ample
      // for this directional cue and keeps tactical input responsive.
      // Never redraw for cosmetic spin during an activation.  The command
      // panel is deliberately stable while a player is issuing orders.
      if (!activation && now - lastGravityAnimationRenderMs >= 125) {
        lastGravityAnimationRenderMs = now;
        scene3d.animateBodies(now);
      }
      gravityAnimationFrame = requestAnimationFrame(tick);
    }
  };
  gravityAnimationFrame = requestAnimationFrame(tick);
}
function ensureScene3D() {
  if (scene3d) return scene3d;
  scene3d = createSystemScene({
    canvas: canvas3d,
    sizePx: CANVAS_PX,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    qualityPreference: requestedQuality,
    onContextStatus(status) {
      if (status.type === "lost") {
        mapArea.dataset.rendererState = "lost";
        setHint("3D graphics context was lost. Waiting for the browser to restore it…");
      } else if (status.type === "restored") {
        mapArea.dataset.rendererState = "active";
        scene3dStaticSource = null;
        setHint(`3D graphics restored (${status.quality} quality).`);
        requestAnimationFrame(() => render());
      } else if (status.type === "asset-error") {
        console.warn(`3D texture failed to load: ${status.url}`, status.error);
      }
    },
  });
  mapArea.dataset.rendererState = "active";
  mapArea.dataset.graphicsQuality = scene3d.diagnostics().quality;
  scene3d.controls.addEventListener("start", () => {
    sceneDragging = true;
    sceneJustDragged = false;
    clearSystemHover(() => scene3d.updateSparseOverlays(sparseOverlaySnapshot()));
  });
  scene3d.controls.addEventListener("change", () => { if (sceneDragging) sceneJustDragged = true; });
  scene3d.controls.addEventListener("end", () => { sceneDragging = false; });
  return scene3d;
}

let systemStaticCache = null;
function systemStaticData(data, sourceKey) {
  if (systemStaticCache?.sourceKey === sourceKey) return systemStaticCache;
  const layout = layoutSystemWithMoons(data, { maxPixel: ORBIT_MAX_PX, localMaxPixel: LOCAL_MAX_PX });
  ensureShipsSpawned(layout);
  const wells = gravityWells(layout);
  const gravityCells = gravityHexes(layout);
  const beltBody = layout.planets.find(p => p.kind === "belt");
  const asteroids = beltBody ? beltAsteroidHexes(layout, beltBody) : [];
  systemStaticCache = { sourceKey, layout, wells, gravityCells, asteroids };
  return systemStaticCache;
}

function renderSystem3D(entry, data) {
  mapwrap.style.display = "none";
  mapwrap3d.style.display = "inline-block";
  mapArea.dataset.renderer = "3d";
  const scene = ensureScene3D();
  mapArea.dataset.rendererState = canvas3d.dataset.rendererState;
  const { layout, wells, gravityCells, asteroids } = systemStaticData(data, entry.systemId);
  updateGravityHexes(gravityCells);
  updateBeltObstacles(asteroids);
  recomputeReachableMoves();
  const ships = shipsSnapshot(wells);

  if (scene3dStaticSource !== entry.systemId) {
    scene.rebuildStatic(({ addBody, addRing, addAsteroid, addGravityField }) => {
      const arrowsByColor = new Map();
      for (const arrow of gravityPullArrows(gravityCells, wells)) {
        if (!arrowsByColor.has(arrow.colorHex)) arrowsByColor.set(arrow.colorHex, []);
        arrowsByColor.get(arrow.colorHex).push(...arrow.segments);
      }
      for (const [colorHex, group] of buildGravityFieldGroups(
        gravityCells, wells, GRID_HEX_SIZE_PX, gravityHexIntensity,
      )) {
        addGravityField({ ...group, colorHex, arrowSegments: arrowsByColor.get(colorHex) || [] });
      }
      if (layout.center) {
        addBody({ x: 0, z: 0, radius: layout.center.rPx, color: colorsFor(layout.center).fill, data: layout.center, emissive: true, textureUrl: textureFor(layout.center), spinDirection: gravitySpinDirection(layout.center.id) });
      }
      for (const p of layout.planets) {
        if (p.kind === "belt") {
          for (const a of asteroids) {
            addAsteroid({ x: a.x, z: a.y, radius: BELT_ASTEROID_RADIUS_PX, colorHex: FILL.belt, data: a });
          }
          continue;
        }
        addRing(0, 0, Math.hypot(p.x, p.y));
        addBody({ x: p.x, z: p.y, radius: p.rPx, color: colorsFor(p).fill, data: p, textureUrl: textureFor(p), spinDirection: gravitySpinDirection(p.id) });
        for (const m of p.moons) {
          addRing(p.x, p.y, m.localRingPx, m.inclinationDeg);
          addBody({ x: m.x, y: m.tiltHeight, z: m.tiltZ, radius: m.rPx, color: colorsFor(m).fill, data: m, textureUrl: textureFor(m) });
        }
      }
    });
    scene3dStaticSource = entry.systemId;
  }

  scene.rebuildDynamic(({ addShip, addTracer }) => {
    for (const s of ships) {
      addShip({
        x: s.x, z: s.y, colorHex: s.colorHex, data: s,
        selected: s.id === selectedShip, facingDeg: s.facingDeg, isFlag: s.isFlag,
        isTarget: s.isTarget, targetColor: s.targetColor, isGroupMember: s.isGroupMember,
        hasActed: s.hasActed,
      });
    }
    // A shot's tracer, fading over time -- see ensureEffectLoop, which owns
    // expiring `effects` and repainting while any are still fading.
    const now = performance.now();
    for (const eff of effects) {
      const alpha = 1 - (now - eff.start) / eff.dur;
      addTracer({ from: shipHexOffset(...eff.from), to: shipHexOffset(...eff.to), hit: eff.hit, alpha });
    }
  });
  scene.updateSparseOverlays(sparseOverlaySnapshot());
  ensureGravityAnimation();

  canvas3d.onclick = ev => {
    if (sceneJustDragged) { sceneJustDragged = false; return; }
    const hit = scene.pick(ev.clientX, ev.clientY);
    if (handleShipOrDestinationClick(hit, scene.groundPoint(ev.clientX, ev.clientY))) return;
    dispatchBodyClick(hit);
  };

  canvas3d.onmousemove = ev => {
    // Skip during an active rotate/pan drag -- same reasoning as the 2D
    // path's dragState guard, using OrbitControls' own drag flag instead.
    if (sceneDragging) return;
    const hit = scene.pick(ev.clientX, ev.clientY);
    updateSystemHover(hit, scene.groundPoint(ev.clientX, ev.clientY),
      () => scene.updateSparseOverlays(sparseOverlaySnapshot()));
  };
  canvas3d.onmouseleave = () => clearSystemHover(() => scene.updateSparseOverlays(sparseOverlaySnapshot()));

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
  mapArea.dataset.renderer = "2d";
  mapArea.dataset.rendererState = "active";
  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;
  const ctx = canvas.getContext("2d");
  const cx = canvas.width / 2, cy = canvas.height / 2;

  const { layout, wells, gravityCells, asteroids } = systemStaticData(data, entry.systemId);
  updateGravityHexes(gravityCells);
  updateBeltObstacles(asteroids);
  recomputeReachableMoves();
  const ships = shipsSnapshot(wells);

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

  // Every hex under a body's gravity, tinted that body's own color and
  // faded by how strong the pull is there (gravityHexIntensity) -- the
  // closer/costlier a hex, the more solid its color reads. Drawn before
  // any real body/ship, so everything else
  // still reads clearly on top of it.
  for (const { colorHex, x, y, cost } of gravityCells.values()) {
    const corners = gravityHexCorners(x, y, wells)
      .map(([px, py]) => worldToScreen(camera2d, px, py));
    ctx.beginPath();
    corners.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = hexToRgba(colorHex, GRAVITY_HEX_MAX_OPACITY * gravityHexIntensity(cost));
    ctx.fill();
  }

  // A local, body-colored deformation lattice only where gravity exists.
  // Both opacity and stroke weight climb with the same MP-cost gradient as
  // the fill, making the deepest pull around a body read most strongly.
  for (const { colorHex, x, y, cost } of gravityCells.values()) {
    const intensity = gravityHexIntensity(cost);
    const corners = gravityHexCorners(x, y, wells)
      .map(([px, pz]) => worldToScreen(camera2d, px, pz));
    ctx.beginPath();
    corners.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.strokeStyle = hexToRgba(colorHex, 0.3 + intensity * 0.65);
    ctx.lineWidth = 1.5 + intensity * 2;
    ctx.stroke();
  }

  const drawOverlayHex = (cell, { fill = null, stroke, lineWidth = 1 }) => {
    const corners = gravityHexCorners(cell.x, cell.z, wells)
      .map(([px, py]) => worldToScreen(camera2d, px, py));
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  };
  const sparseOverlay = sparseOverlaySnapshot();
  for (const cell of sparseOverlay.commandCells) {
    drawOverlayHex(cell, { fill: hexToRgba(sparseOverlay.colorHex, 0.035), stroke: hexToRgba(sparseOverlay.colorHex, 0.2) });
  }
  for (const cell of sparseOverlay.hoverCells) {
    drawOverlayHex(cell, { stroke: "rgba(136,146,171,0.55)" });
  }
  if (sparseOverlay.colorHex) {
    for (const cell of sparseOverlay.reachableCells) {
      const hovered = cell.key === sparseOverlay.hoveredKey;
      drawOverlayHex(cell, {
        fill: hexToRgba(sparseOverlay.colorHex, hovered ? 0.42 : 0.18),
        stroke: sparseOverlay.colorHex,
        lineWidth: hovered ? 3 : 1.5,
      });
    }
  }
  for (const arrow of gravityPullArrows(gravityCells, wells)) {
    const points = arrow.segments.map(([x, y]) => worldToScreen(camera2d, x, y));
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 2) {
      ctx.moveTo(...points[i]); ctx.lineTo(...points[i + 1]);
    }
    ctx.strokeStyle = hexToRgba(arrow.colorHex, 0.45 + arrow.intensity * 0.5);
    ctx.lineWidth = 1 + arrow.intensity * 1.5;
    ctx.stroke();
  }

  const drawRing = (ringCx, ringCy, worldRadiusPx) => strokeFaintRing(ctx, ringCx, ringCy, worldRadiusPx * camera2d.zoom);
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
  const drawCurrentCue = well => {
    const [sx, sy] = worldToScreen(camera2d, well.x, well.z);
    const radius = Math.max((well.rPx + 5) * camera2d.zoom, 8);
    const start = -Math.PI * 0.75;
    const end = start + Math.PI * 1.35 * well.spinDirection;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, start, end, well.spinDirection < 0);
    ctx.strokeStyle = hexToRgba(well.colorHex, 0.85);
    ctx.lineWidth = 2;
    ctx.stroke();
    const tipX = sx + Math.cos(end) * radius, tipY = sy + Math.sin(end) * radius;
    const tangent = end + (well.spinDirection > 0 ? Math.PI / 2 : -Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.cos(tangent - 0.55) * 5, tipY - Math.sin(tangent - 0.55) * 5);
    ctx.lineTo(tipX - Math.cos(tangent + 0.55) * 5, tipY - Math.sin(tangent + 0.55) * 5);
    ctx.closePath(); ctx.fillStyle = well.colorHex; ctx.fill();
  };
  // battle/hexmath.js's facingArrowPoints is tuned for battle's fixed
  // HS=17 board (fixed -4/-11px offsets, not proportional to hs) --
  // wrong at the map's much smaller, zoom-varying ship icon sizes
  // (s as low as 1.5px would invert the arrow). Same triangle shape,
  // scaled proportionally to s instead: ratios match facingArrowPoints'
  // own proportions at HS=17 ((17-4)/17 tip, (17-11)/17 base).
  const shipArrowPoints = (x, y, s, angleDeg) => {
    const a = angleDeg * Math.PI / 180;
    return [
      [x + Math.cos(a) * s * 0.765, y + Math.sin(a) * s * 0.765],
      [x + Math.cos(a + 2.6) * s * 0.353, y + Math.sin(a + 2.6) * s * 0.353],
      [x + Math.cos(a - 2.6) * s * 0.353, y + Math.sin(a - 2.6) * s * 0.353],
    ];
  };
  // One ship, one small hex on its own hex cell (see shipsSnapshot) -- filled
  // translucent (SHIP_FILL_ALPHA) in the faction color so a tightly-packed
  // formation still reads as individual ships rather than one solid blob.
  // Facing is a filled arrow and the flagship gets a "★", same glyph
  // language as battle/render.js's own unit drawing (ACCENT.flagshipArrow)
  // -- labels/strength pips aren't duplicated here, that detail already
  // lives in the info panel.
  const drawShip = (ship, selected) => {
    const [sx, sy] = worldToScreen(camera2d, ship.x, ship.y);
    const s = scaledStrategicShipIconRadius(camera2d.zoom);
    const colorHex = ship.colorHex;
    const tapRadius = Math.max(s * 1.8, 6);
    const corners = hexCorners(sx, sy, s);

    ctx.beginPath();
    corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = hexToRgba(colorHex, SHIP_FILL_ALPHA);
    ctx.fill();
    ctx.lineWidth = selected || ship.isGroupMember ? 2 : 1;
    ctx.strokeStyle = selected ? "#ffffff" : (ship.isGroupMember ? ACCENT.flagshipArrow : colorHex);
    ctx.stroke();

    const [tip, base1, base2] = shipArrowPoints(sx, sy, s, ship.facingDeg);
    ctx.beginPath();
    ctx.moveTo(...tip); ctx.lineTo(...base1); ctx.lineTo(...base2);
    ctx.closePath();
    ctx.fillStyle = ship.isFlag && !ship.hasActed ? ACCENT.flagshipArrow : colorHex;
    ctx.fill();
    if (ship.isFlag && s >= 4) {
      ctx.fillStyle = ACCENT.labelText;
      ctx.font = "bold 9px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("★", sx, sy + 3);
    }
    // A legal fire target for the currently-selected ship (see
    // shipsSnapshot) -- outlined in the *attacker's* own color (not
    // battle/render.js's fixed ACCENT.targetOutline red), so it reads as
    // "who can hit this" and doesn't vanish against a same-colored hull.
    if (ship.isTarget) {
      ctx.beginPath();
      corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.lineWidth = LINE_WIDTH.targetOutline;
      ctx.strokeStyle = ship.targetColor;
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
  for (const well of wells) drawCurrentCue(well);
  for (const s of ships) s.hitRPx = drawShip(s, s.id === selectedShip);
  // A shot's tracer, fading over time -- see ensureEffectLoop, which owns
  // expiring `effects` and repainting while any are still fading. Same
  // width/halo/duration parity as battle/render.js's own laser effect
  // (LINE_WIDTH/LASER_HALO_ALPHA), keeping the hit/miss color scheme this
  // file already used rather than battle's per-faction color, since a
  // tracer here has no single "side" to key off of the way battle's
  // fixed 2-side board does.
  const effNow = performance.now();
  for (const eff of effects) {
    const [fx, fy] = worldToScreen(camera2d, ...shipHexOffset(...eff.from));
    const [tx, ty] = worldToScreen(camera2d, ...shipHexOffset(...eff.to));
    const alpha = Math.max(0, 1 - (effNow - eff.start) / eff.dur);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = eff.hit ? "#ff3355" : "#8899aa";
    ctx.lineWidth = eff.hit ? LINE_WIDTH.laserHit : LINE_WIDTH.laserMiss;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx, ty); ctx.stroke();
    if (eff.hit) {
      ctx.globalAlpha = alpha * LASER_HALO_ALPHA;
      ctx.lineWidth = LINE_WIDTH.laserHitHalo;
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();

  canvas.onmousedown = ev => {
    if (ev.button !== 2) return;
    dragState = { startClientX: ev.clientX, startClientY: ev.clientY, startCameraX: camera2d.x, startCameraY: camera2d.y, moved: false };
    canvas.style.cursor = "grabbing";
    clearSystemHover(() => render());
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
    dispatchBodyClick(hit);
  };

  canvas.onmousemove = ev => {
    // A right-drag pan already floods window "mousemove" (see the module-
    // scope listener above); skip hover lookups while one's in progress,
    // both because the cursor isn't meaningfully "over" anything mid-pan
    // and to avoid doing a hit-test on every dragged pixel.
    if (dragState) return;
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) - cx, y = (ev.clientY - rect.top) - cy;
    const hit = hitAt(x, y);
    updateSystemHover(hit, screenToWorld(camera2d, x, y), () => render());
  };
  canvas.onmouseleave = () => clearSystemHover(() => render());

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

function rendererFailure(error) {
  const detail = error instanceof Error ? error.message : String(error);
  const contextFailure = /webgl|graphics context|context creation|gpu/i.test(detail);
  return {
    detail,
    contextFailure,
    hint: contextFailure
      ? `3D graphics unavailable (${detail}). Showing the 2D map.`
      : `3D renderer error: ${detail}. Showing the 2D map.`,
  };
}

function activate2DFallback(error) {
  const failure = rendererFailure(error);
  if (failure.contextFailure) console.warn("3D graphics unavailable; using 2D fallback:", error);
  else console.error("3D renderer failed; using 2D fallback:", error);
  webglFailed = true;
  const failedScene = scene3d;
  scene3d = null;
  scene3dStaticSource = null;
  try { failedScene?.dispose(); } catch (disposeError) {
    console.warn("3D renderer cleanup also failed:", disposeError);
  }
  canvas3d.onclick = null;
  canvas3d.onmousemove = null;
  canvas3d.onmouseleave = null;
  mapArea.dataset.rendererError = failure.detail;
  setHint(failure.hint);
}

function renderSystem(entry, data) {
  if (!webglFailed && sceneModuleStatus === "loading") {
    renderSystem2D(entry, data);
    mapArea.dataset.renderer = "loading";
    mapArea.dataset.rendererState = "loading";
    if (!persistentHint) setHint(RENDERER_LOADING_HINT);
    return;
  }
  if (!webglFailed && sceneModuleStatus === "failed") activate2DFallback(sceneModuleError);
  if (!webglFailed) {
    try {
      renderSystem3D(entry, data);
      return;
    } catch (err) {
      activate2DFallback(err);
    }
  } else if (forcedRenderer === "2d" && mapArea.dataset.renderer !== "2d") {
    setHint("2D renderer forced by the URL for fallback testing.");
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
  turnPanel.style.display = entry.level === "system" ? "block" : "none";
  if (entry.level === "system") {
    renderSystem(entry, data);
    renderTurnPanel();
  } else renderUniverse(entry, data);
  // Mirrors battle/render.js's own draw()/ensureEffectLoop split: render()
  // paints one frame (reading whatever's left in `effects`, each already
  // carrying its own alpha-implying start/dur), and whenever a laser is
  // still fading this also keeps a requestAnimationFrame loop alive to
  // repaint on subsequent frames, stopping itself once every effect has
  // expired -- callers everywhere else just call render() once per action,
  // same as always, and get the fade animation for free. The loop
  // mechanics themselves are shared with battle/render.js's own laser-fade
  // loop -- see battle/core/effectLoop.js.
  ensureEffectLoop({
    pruneExpired: now => { for (let i = effects.length - 1; i >= 0; i--) if (now - effects[i].start >= effects[i].dur) effects.splice(i, 1); },
    hasEffects: () => effects.length > 0,
    repaint: () => render(),
  });
}

function zoomIn(enter, label) {
  path.push({ ...enter, label });
  selectedShip = null; activation = null; travelArmed = false;
  pointerHex = null; hoverPatchCenter = null; hoverMoveHint = null;
  setHint("");
  render();
}
function zoomTo(index) {
  path = path.slice(0, index + 1);
  selectedShip = null; activation = null; travelArmed = false;
  pointerHex = null; hoverPatchCenter = null; hoverMoveHint = null;
  setHint("");
  render();
}
function zoomOut() {
  if (path.length > 1) zoomTo(path.length - 2);
}
function renderHint() { hint.textContent = hoverMoveHint || persistentHint; }
function setHint(text) { persistentHint = text; renderHint(); }

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
setInterval(() => tickStrategicTurn(), 250);
