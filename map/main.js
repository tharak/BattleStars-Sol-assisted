import {
  layoutOrbitalBoard, drawOrbitalBoard, hitTest,
  layoutSystemWithMoons, worldToScreen, screenToWorld, strokeFaintRing,
} from "./orbitmap.js";
import {
  universeLevel, systemLevel,
  ARMADA_DEPLOYMENT_FORMATIONS, FACTIONS, FLEETS_PER_ARMADA,
  FLEET_POSITIONS, initFleetPositions,
} from "./levels.js";
import { DIR_ANGLE, directionToward, hexCorners, hexDist, incomingArc, key as hexKey, neighbor } from "../battle/hexmath.js";
import { formationLayout } from "../battle/formations.js";
import { BOARD_TINT, ACCENT } from "../battle/colors.js";
import { LINE_WIDTH, LASER_DURATION, LASER_HALO_ALPHA } from "../battle/dimensions.js";
import { CMD_R, MP_MAX, MAX_TURNS_PER_ACTIVATION } from "../battle/config.js";
import * as SC from "../battle/core/shipRules.js";
import { fleetShipPositions } from "../battle/fleetShips.js";
import { MathRandomSource } from "../battle/core/random.js";
import { captainAbility, draftCaptains } from "../battle/domain/captainRules.js";
import { resolveMorale, resolveRally } from "../battle/domain/moraleRules.js";
import { FiringArc } from "../battle/domain/constants.js";
import { forwardMovementCost } from "../battle/domain/movementRules.js";
import { makeEffectLoop } from "../battle/core/effectLoop.js";
import {
  chooseCourseRoute, executeStrategicGroupRoute, executeStrategicGroupTurn,
  executeStrategicRoute, executeStrategicRouteStepwise, findGroupReachableDestinations,
  findReachableDestinations, hexPatch, membersWithinCommand, resolveStrategicClick, StrategicClickAction,
} from "./strategicMovement.js";
import {
  activeStrategicFaction, canStrategicShipAct, completeStrategicActivations,
  createStrategicTurnState, expireStrategicTurn, hasStrategicShipActed,
  isStrategicActivationExhausted, strategicTurnRemainingMs,
} from "./strategicTurns.js";
import { buildGravityFieldGroups, gravityHexRadius, hexDiskCells, warpGravityPoint } from "./gravityField.js";
import { gravitySpinDirection, resolveGravityDrift } from "./gravityDynamics.js";
import { buildTransportNetwork, mergeTransportCells, transportJumpDestination, transportLanesAt } from "./transportNetwork.js";
import {
  scaledStrategicShipIconRadius, strategicFleetTone, strategicLaserColor, STRATEGIC_FACTION_COLORS,
} from "./shipAppearance.js";
import {
  GRAVITY_INFLUENCE_RADIUS_FACTOR, INITIAL_FLEET_STRENGTH,
  MAX_FLEET_STRENGTH, MAX_SHIPS_PER_HEX, PRODUCTION_FLEETS_PER_TURN, STRATEGIC_DAMAGE_PER_HIT,
} from "./strategicBalance.js";
import {
  bodyResourceValue, canConquerPlanet, conquestCompletionRound,
  conquestDurationTurns, spawnPointTowardSun,
} from "./strategicEconomy.js";
import { blocksFleetMovement, mergeSurvivorId } from "./strategicFleetActions.js";
import {
  StrategicShipState, allocateCollisionLosses, applyDirectionalDamage,
  assignMixedFleetSlots, createStrategicMembers, fleetEffectiveStrength,
  resolveHexVolley, splitStrategicMembers,
} from "./strategicShipMembers.js";
import {
  createPlayableTutorialMap, nextPlayableTutorialStep,
  PLAYABLE_TUTORIAL_STEPS, STRATEGIC_TUTORIAL_GROUPS, tutorialMechanicCount,
} from "./tutorials.js";
import { normalizeStrategicSetup, strategicFactionSetup, strategicTurnUsesTimer } from "./strategicGameSetup.js";

const canvas = document.getElementById("starmapCv");
const mapwrap = document.getElementById("mapwrap");
const canvas3d = document.getElementById("cv3d");
const mapwrap3d = document.getElementById("mapwrap3d");
const topbar = document.getElementById("topbar");
const breadcrumb = document.getElementById("breadcrumb");
const zoomOutBtn = document.getElementById("zoomOut");
const hint = document.getElementById("hint");
const infoPanel = document.getElementById("infoPanel");
const infoTurnL = document.getElementById("infoTurnL");
const infoTurnR = document.getElementById("infoTurnR");
const infoForward = document.getElementById("infoForward");
const infoBack = document.getElementById("infoBack");
const infoFire = document.getElementById("infoFire");
const infoTravel = document.getElementById("infoTravel");
const infoGroupMove = document.getElementById("infoGroupMove");
const infoMerge = document.getElementById("infoMerge");
const infoSplit = document.getElementById("infoSplit");
const infoConquer = document.getElementById("infoConquer");
const infoEnd = document.getElementById("infoEnd");
const mapArea = document.getElementById("mapArea");
const turnPanel = document.getElementById("turnPanel");
const turnHeading = document.getElementById("turnHeading");
const turnPanelToggle = document.getElementById("turnPanelToggle");
const turnClock = document.getElementById("turnClock");
const turnFactions = document.getElementById("turnFactions");
const startOverlay = document.getElementById("startOverlay");
const startMenu = document.getElementById("startMenu");
const newGameBtn = document.getElementById("newGameBtn");
const tutorialBtn = document.getElementById("tutorialBtn");
const tutorialMenu = document.getElementById("tutorialMenu");
const tutorialBackBtn = document.getElementById("tutorialBackBtn");
const tutorialGroups = document.getElementById("tutorialGroups");
const tutorialDetail = document.getElementById("tutorialDetail");
const tutorialListBtn = document.getElementById("tutorialListBtn");
const tutorialGroupTitle = document.getElementById("tutorialGroupTitle");
const tutorialLessonTitle = document.getElementById("tutorialLessonTitle");
const tutorialMechanics = document.getElementById("tutorialMechanics");
const playerCountSelect = document.getElementById("playerCount");
const npcCountSelect = document.getElementById("npcCount");
const captainSeedInput = document.getElementById("captainSeed");
const setupSummary = document.getElementById("setupSummary");
const tutorialGuide = document.getElementById("tutorialGuide");
const tutorialLibraryBtn = document.getElementById("tutorialLibraryBtn");
const tutorialExitBtn = document.getElementById("tutorialExitBtn");
const tutorialLibraryExitBtn = document.getElementById("tutorialLibraryExitBtn");
const tutorialStep = document.getElementById("tutorialStep");
const tutorialActionTitle = document.getElementById("tutorialActionTitle");
const tutorialActionMessage = document.getElementById("tutorialActionMessage");
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
const armadaRoster = new Map(Object.keys(FACTIONS).map(faction => [faction, []]));
const strategicMembers = new Map();
const originalFlagshipByFaction = new Map();
let nextStrategicMemberId = 1;
// The title-state map is deliberately neutral. New Game assigns the three
// established starting planets immediately before spawning the Armadas.
const planetEconomy = new Map();
const configuredFactions = [];
const factionControllers = new Map();
const captainsByFaction = new Map();
let npcTurnTimer = null;
let tutorialMode = false;
let tutorialMap = null;
let tutorialLibraryReturnToGame = false;
let tutorialStepIndex = 0;
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
const shipCourses = new Map();
const shipTurnMp = new Map();
const shipTurnTurns = new Map();
const COURSE_MOVEMENT_DELAY_MS = 260;
let courseAnimationActive = false;
let courseAnimationPromise = null;
let courseAnimationStep = 0;
mapArea.dataset.courseAnimation = "idle";
mapArea.dataset.courseStep = "0";
// Fire's own transient shot-line records, derived here from fire results
// -- a parallel, map-local array to battle's own presentation effects (not
// shared with it), each with a start timestamp/duration so ensureEffectLoop
// can fade it out over subsequent frames exactly like battle/render.js's
// own laser effect, instead of a static line that only ever repaints when
// something else happens to trigger a render.
const effects = [];
const STRATEGIC_EXPLOSION_DURATION = 720;
// The RAF-loop mechanics for fading `effects` out -- see render()'s use
// of this below, and battle/core/effectLoop.js for why this is shared
// with battle/render.js's own laser-fade loop instead of a second
// hand-rolled copy of the same "keep repainting while anything's still
// fading" bookkeeping.
const ensureEffectLoop = makeEffectLoop();
// Every hex under a body's gravity (a Map of "c,r" -> {cost,colorHex,x,y},
// see gravityHexes). `cost` now expresses visual/current strength only;
// gravity moves ships automatically but no longer consumes extra AP.
let gravityHexCosts = new Map();
// The last body (star/planet/moon) clicked at the System level, for
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

const membersOf = fleet => strategicMembers.get(fleet) || [];
const memberCount = fleet => membersOf(fleet).length;
const fleetStrength = fleet => fleetEffectiveStrength(membersOf(fleet));
const isRoutedFleet = fleet => memberCount(fleet) > 0
  && membersOf(fleet).every(member => member.state === StrategicShipState.ROUTED);
function syncStrategicFleet(fleet) {
  const members = membersOf(fleet);
  // The shared ECS uses Strength > 0 as its alive marker. Routed members
  // contribute zero effective Strength but remain physical targets on the
  // strategic map, so retain a tiny adapter sentinel until the last member
  // is actually removed.
  SC.setStrength(world, fleet, members.length ? Math.max(0.001, fleetEffectiveStrength(members)) : 0);
  SC.setFlagshipCount(world, fleet, members.filter(member => member.isOriginalFlagship).length);
  if (!members.length) {
    shipCourses.delete(fleet);
    shipTurnMp.delete(fleet);
    shipTurnTurns.delete(fleet);
    groupMovePreferences.delete(fleet);
  }
}
function attachFreshMembers(fleet, count, flagshipCount = 0) {
  const members = createStrategicMembers(count, {
    nextId: () => nextStrategicMemberId++, flagshipCount,
  });
  strategicMembers.set(fleet, members);
  const faction = SC.factionOf(world, fleet);
  const original = members.find(member => member.isOriginalFlagship);
  if (original && !originalFlagshipByFaction.has(faction)) originalFlagshipByFaction.set(faction, original.id);
  syncStrategicFleet(fleet);
  return members;
}
function stateCounts(fleet) {
  const counts = { ready: 0, shaken: 0, routed: 0 };
  for (const member of membersOf(fleet)) counts[member.state]++;
  return counts;
}

function queueShipExplosion(position, slotIndex, memberId) {
  effects.push({
    kind: "explosion",
    position: [...position],
    slotIndex: Math.max(0, slotIndex) % MAX_SHIPS_PER_HEX,
    seed: memberId,
    start: performance.now(),
    dur: STRATEGIC_EXPLOSION_DURATION,
  });
}

initFleetPositions();

function showStartMenu() {
  startMenu.hidden = false;
  tutorialMenu.hidden = true;
  tutorialDetail.hidden = true;
}

function closeTutorialLibrary() {
  if (!tutorialLibraryReturnToGame) {
    showStartMenu();
    return;
  }
  startOverlay.hidden = true;
  tutorialLibraryReturnToGame = false;
  tutorialGuide.hidden = false;
}

function exitPlayableTutorial() {
  if (!tutorialMode) return;
  window.location.reload();
}

function showTutorialMenu() {
  startMenu.hidden = true;
  tutorialMenu.hidden = false;
  tutorialDetail.hidden = true;
}

function showTutorial(group, tutorial) {
  startMenu.hidden = true;
  tutorialMenu.hidden = true;
  tutorialDetail.hidden = false;
  tutorialGroupTitle.textContent = group.title;
  tutorialLessonTitle.textContent = tutorial.title;
  tutorialMechanics.replaceChildren(...tutorial.mechanics.map(mechanic => {
    const item = document.createElement("li");
    item.textContent = mechanic;
    return item;
  }));
}

function buildTutorialMenu() {
  tutorialBtn.title = `${tutorialMechanicCount()} mechanics in ${STRATEGIC_TUTORIAL_GROUPS.length} groups`;
  tutorialGroups.replaceChildren(...STRATEGIC_TUTORIAL_GROUPS.map(group => {
    const section = document.createElement("section");
    section.className = "tutorialGroup";
    const heading = document.createElement("h3");
    heading.textContent = group.title;
    const description = document.createElement("p");
    description.textContent = group.description;
    const lessons = document.createElement("div");
    lessons.className = "tutorialLessons";
    for (const tutorial of group.tutorials) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = tutorial.title;
      button.onclick = () => showTutorial(group, tutorial);
      lessons.appendChild(button);
    }
    section.append(heading, description, lessons);
    return section;
  }));
}

function renderPlayableTutorialStep() {
  const current = PLAYABLE_TUTORIAL_STEPS[tutorialStepIndex];
  if (!current) {
    tutorialStep.textContent = "Complete";
    tutorialActionTitle.textContent = "Flight school complete";
    tutorialActionMessage.textContent = "Continue commanding the Fleet.";
    return;
  }
  tutorialStep.textContent = `Step ${tutorialStepIndex + 1} of ${PLAYABLE_TUTORIAL_STEPS.length}`;
  tutorialActionTitle.textContent = current.title;
  tutorialActionMessage.textContent = current.message;
}

const TUTORIAL_TARGET_SELECTORS = Object.freeze({
  "ready-fleet": ".turnShip.ready",
  forward: "#infoForward",
  conquer: "#infoConquer",
  turn: "#infoTurnL, #infoTurnR",
  end: "#infoEnd",
  course: "#infoTravel",
});

function updateTutorialActionHighlight() {
  for (const button of document.querySelectorAll('[data-tutorial-target="true"]')) {
    button.removeAttribute("data-tutorial-target");
    button.removeAttribute("aria-describedby");
  }
  if (!tutorialMode || tutorialGuide.hidden) return;
  const target = PLAYABLE_TUTORIAL_STEPS[tutorialStepIndex]?.target;
  const selector = TUTORIAL_TARGET_SELECTORS[target];
  if (!selector) return;
  const buttons = [...document.querySelectorAll(selector)];
  for (const button of buttons) {
    button.dataset.tutorialTarget = "true";
    button.setAttribute("aria-describedby", "tutorialActionMessage");
  }
  buttons.find(button => button.offsetParent !== null)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function advancePlayableTutorial(event) {
  if (!tutorialMode) return;
  const nextIndex = nextPlayableTutorialStep(PLAYABLE_TUTORIAL_STEPS, tutorialStepIndex, event);
  if (nextIndex === tutorialStepIndex) return;
  tutorialStepIndex = nextIndex;
  renderPlayableTutorialStep();
  updateTutorialActionHighlight();
}

function updateSetupCounts(changed = null) {
  const { players, npcs, total, valid } = normalizeStrategicSetup({
    playerCount: playerCountSelect.value,
    npcCount: npcCountSelect.value,
    maxFactions: Object.keys(FACTIONS).length,
    changed: changed === playerCountSelect ? "players" : "npcs",
  });
  playerCountSelect.value = String(players);
  npcCountSelect.value = String(npcs);
  newGameBtn.disabled = !valid;
  setupSummary.classList.toggle("invalid", !valid);
  setupSummary.textContent = valid
    ? `${players} local player${players === 1 ? "" : "s"} · ${npcs} NPC commander${npcs === 1 ? "" : "s"} · ${total} Armada${total === 1 ? "" : "s"}`
    : "Choose at least one local player or NPC commander.";
}

buildTutorialMenu();
updateSetupCounts();
playerCountSelect.onchange = () => updateSetupCounts(playerCountSelect);
npcCountSelect.onchange = () => updateSetupCounts(npcCountSelect);
tutorialBtn.onclick = startPlayableTutorial;
tutorialBackBtn.onclick = closeTutorialLibrary;
tutorialListBtn.onclick = showTutorialMenu;
newGameBtn.onclick = startNewGame;
tutorialLibraryBtn.onclick = () => {
  tutorialLibraryReturnToGame = true;
  tutorialGuide.hidden = true;
  tutorialLibraryExitBtn.hidden = false;
  startOverlay.hidden = false;
  showTutorialMenu();
  updateTutorialActionHighlight();
};
tutorialExitBtn.onclick = exitPlayableTutorial;
tutorialLibraryExitBtn.onclick = exitPlayableTutorial;

// Nothing on the map carries a floating label anymore (see addBody/
// addShip in scene3d.js and drawDot/drawShip below) -- this panel is
// where a click's result actually shows up instead. Read every time
// through renderInfoPanel() rather than pushed reactively, so any click
// handler can just update selectedShip/lastClickedInfo and call it,
// the same way setHint(...) already works.
function infoFor(hit) {
  if (!hit) return null;
  if (hit.kind === "star") return { name: hit.label, detail: "The star this system orbits. Transport corridors use planetary rotation for direction." };
  if (hit.kind === "moon") return { name: hit.label, detail: `Moon of ${hit.parentLabel}.` };
  if (hit.kind === "planet") {
    const economy = planetEconomy.get(hit.id);
    const owner = economy?.owner ? `${FACTIONS[economy.owner].label} controlled` : "Uncontrolled";
    const conquest = economy?.conquest
      ? ` Conquest by ${FACTIONS[economy.conquest.faction].label} completes in round ${economy.conquest.completesRound}.`
      : "";
    return {
      name: hit.label,
      detail: `${owner}; produces one Strength-${hit.resourceValue || 1} Fleet each owner turn.${conquest}`,
    };
  }
  if (hit.kind === "fleet" || hit.kind === "fleet-stack") {
    const course = shipCourses.get(hit.id);
    const flagshipCount = SC.flagshipCountOf(world, hit.id);
    const states = stateCounts(hit.id);
    const captain = SC.captainOf(world, hit.id);
    return {
      name: `Fleet ${SC.labelOf(world, hit.id)}${flagshipCount ? ` ★${flagshipCount > 1 ? `×${flagshipCount}` : ""}` : ""}`,
      detail: `${FACTIONS[hit.faction].label} Armada — ${memberCount(hit.id)} Ships, Strength ${fleetStrength(hit.id).toFixed(1)} (${states.ready} Ready, ${states.shaken} Shaken, ${states.routed} Routed).${captain ? ` ${captain.name}: ${captainAbility(captain.abilityId)?.description}.` : ""}${course ? ` Course: ${course.join(",")}.` : ""}`,
    };
  }
  return null;
}
// Puts whatever was just clicked into the info panel. Shared by both the
// 3D and 2D click handlers' star/moon/planet branches -- each still
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
  return Object.fromEntries([...armadaRoster].map(([faction, ships]) => [
    faction,
    ships.filter(ship => SC.isAlive(world, ship)),
  ]));
}

function economicallyEligibleFactions() {
  return [...new Set([...planetEconomy.values()].map(economy => economy.owner).filter(Boolean))];
}

const controllerOfFaction = faction => factionControllers.get(faction) || "player";
const isNpcFaction = faction => controllerOfFaction(faction) === "npc";

function shipCanActThisTurn(ship) {
  if (isRoutedFleet(ship)) return false;
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
function selectShip(e, { npc = false } = {}) {
  if (courseAnimationActive) {
    setHint("Fleets are advancing along their plotted courses.");
    return false;
  }
  const shipFaction = SC.factionOf(world, e);
  if (isNpcFaction(shipFaction) && !npc) {
    setHint(`${FACTIONS[shipFaction].label} Armada is controlled by an NPC commander.`);
    return false;
  }
  if (!SC.isAlive(world, e) || isRoutedFleet(e) || !shipCanActThisTurn(e)) {
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
  const turns = shipTurnTurns.get(e) ?? 0;
  const captain = SC.captainOf(world, e);
  activation = {
    u: e, mp: shipTurnMp.get(e) ?? MP_MAX + (captain?.abilityId === "full_throttle" ? 1 : 0), turns,
    maxTurns: captain?.abilityId === "master_helmsman" ? 3 : undefined,
    backwardCost: captain?.abilityId === "retro_thrusters" ? 2 : undefined,
    turnsByShip: { [e]: turns }, moved: false, fired: false, fireMode: false,
    cmd: SC.inCommand(world, e), participantShipIds: [e],
  };
  travelArmed = false;
  groupMoveArmed = SC.isFlagship(world, e)
    && groupMovePreferences.has(e)
    && commandGroupShips().length >= 2;
  setHint(groupMoveArmed
    ? `${SC.labelOf(world, e)} selected — command-group move restored.`
    : `${SC.labelOf(world, e)} selected.${shipCourses.has(e) ? ` Course target: ${shipCourses.get(e).join(",")}.` : ""}`);
  advancePlayableTutorial("fleet-selected");
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
  const previousTurn = strategicTurn;
  strategicTurn = completeStrategicActivations(strategicTurn, {
    shipIds: activationParticipants(),
    livingShipIdsByFaction: livingShipIdsByFaction(),
    nowMs: performance.now(),
    eligibleFactionIds: economicallyEligibleFactions(),
  });
  const economyHint = processStrategicTurnTransition(previousTurn, strategicTurn);
  lastRenderedTimerSecond = null;
  clearSelection();
  if (strategicTurn.round !== previousRound || activeStrategicFaction(strategicTurn) !== previousFaction) {
    const nextTurn = `${FACTIONS[activeStrategicFaction(strategicTurn)].label} turn begins.`;
    const transitionHint = economyHint ? `${nextTurn} ${economyHint}.` : nextTurn;
    setHint(preserveHint ? `${resultHint} ${transitionHint}` : transitionHint);
  } else if (!preserveHint) {
    setHint("");
  }
  renderInfoPanel();
  render();
  scheduleNpcTurn();
}
function endActivation() {
  if (!activation) return;
  advancePlayableTutorial("ended");
  completeCurrentActivation();
}

function completeExhaustedActivation() {
  if (!activation || !isStrategicActivationExhausted({
    canMove: SC.canMove(activation),
    canFire: SC.canFire(world, activation),
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

function scheduleNpcTurn() {
  if (npcTurnTimer != null) window.clearTimeout(npcTurnTimer);
  npcTurnTimer = null;
  if (courseAnimationActive && courseAnimationPromise) {
    courseAnimationPromise.then(() => scheduleNpcTurn());
    return;
  }
  if (!shipsSpawned || !isNpcFaction(activeStrategicFaction(strategicTurn))) return;
  npcTurnTimer = window.setTimeout(runNpcActivation, 320);
}

function runNpcActivation() {
  npcTurnTimer = null;
  const faction = activeStrategicFaction(strategicTurn);
  if (!shipsSpawned || !isNpcFaction(faction)) return;
  const fleet = SC.shipsOfFaction(world, faction).find(ship => shipCanActThisTurn(ship));
  if (!fleet || !selectShip(fleet, { npc: true })) return;
  const target = SC.legalTargets(world, fleet)
    .sort((a, b) => hexDist(SC.posOf(world, fleet), SC.posOf(world, a))
      - hexDist(SC.posOf(world, fleet), SC.posOf(world, b)))[0];
  if (target != null) {
    doFireAt(target);
  } else {
    const enemy = SC.enemiesOf(world, faction)
      .sort((a, b) => hexDist(SC.posOf(world, fleet), SC.posOf(world, a))
        - hexDist(SC.posOf(world, fleet), SC.posOf(world, b)))[0];
    if (enemy != null) {
      shipCourses.set(fleet, [...SC.posOf(world, enemy)]);
      activation.courseSet = true;
      setHint(`${FACTIONS[faction].label} NPC sets ${SC.labelOf(world, fleet)} on an intercept course.`);
    } else {
      setHint(`${FACTIONS[faction].label} NPC completes ${SC.labelOf(world, fleet)}'s activation.`);
    }
  }
  if (activation) completeCurrentActivation({ preserveHint: true });
  else scheduleNpcTurn();
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
    rememberActivationMp(ships);
    setHint(`${ships.length} Fleets turned ${dir > 0 ? "left" : "right"}.`);
    advancePlayableTutorial("turned");
    finishActionRender();
    return;
  }
  if (!SC.canTurn(activation)) return;
  SC.turn(world, activation.u, dir);
  activation.turns += 1;
  activation.turnsByShip[activation.u] = activation.turns;
  activation.moved = true; activation.fireMode = false;
  rememberActivationMp();
  setHint("");
  advancePlayableTutorial("turned");
  finishActionRender();
}
function moveResultHint(res) {
  if (res.reason === "shaken") setHint("Shaken — refuses to close the distance.");
  else if (res.reason === "blocked") setHint("Another ship blocks that hex.");
}
// A forward hex step's own AP price. Kept as its own named
// constant (rather than a bare 1 sprinkled through the cost math below)
// so a future per-ship move cost (e.g. a heavier hull that costs more
// than 1 AP/hex even in open space) is a one-line swap to a lookup here.
// Open-space movement remains a one-AP forward step. Transport corridors add
// their own directed jump after a fleet enters a network cell.
function hexMoveCost() {
  const cost = forwardMovementCost();
  return SC.captainOf(world, activation?.u)?.abilityId === "gravity_navigator" ? Math.max(1, cost - 1) : cost;
}

function movementBlocker(movingShips) {
  const moving = new Set(movingShips);
  const movingFactions = new Set(movingShips.map(ship => SC.factionOf(world, ship)));
  const occupied = new Set();
  for (const ship of SC.aliveShips(world)) {
    if (moving.has(ship)) continue;
    if ([...movingFactions].some(faction => !blocksFleetMovement(faction, SC.factionOf(world, ship)))) continue;
    const [c, r] = SC.posOf(world, ship);
    occupied.add(hexKey(c, r));
  }
  return nextPosition => (tutorialMap && !tutorialMap.contains(nextPosition))
    || occupied.has(hexKey(nextPosition[0], nextPosition[1]));
}

function rememberActivationMp(ships = activationParticipants()) {
  if (!activation) return;
  for (const ship of ships) {
    shipTurnMp.set(ship, activation.mp);
    shipTurnTurns.set(ship, activation.turnsByShip?.[ship] ?? (ship === activation.u ? activation.turns : 0));
  }
}

function fleetContainingMember(memberId) {
  return SC.aliveFleets(world).find(fleet => membersOf(fleet).some(member => member.id === memberId)) ?? null;
}

function originalFlagshipFleet(faction) {
  const memberId = originalFlagshipByFaction.get(faction);
  return memberId == null ? null : fleetContainingMember(memberId);
}

function inOriginalFlagshipCommand(fleet) {
  return SC.inCommand(world, fleet);
}

function spawnMemberFleet(sourceFleet, members, { state = null } = {}) {
  if (!members.length) return null;
  const faction = SC.factionOf(world, sourceFleet);
  const roster = armadaRoster.get(faction);
  const [c, r] = SC.posOf(world, sourceFleet);
  const fleet = SC.spawnFleet(world, {
    faction, c, r, dir: SC.facingOf(world, sourceFleet),
    label: `${faction[0].toUpperCase()}${roster.length + 1}`,
    formation: SC.fleetFormationOf(world, sourceFleet),
    strength: 1,
  });
  if (state) for (const member of members) member.state = state;
  strategicMembers.set(fleet, members);
  roster.push(fleet);
  shipTurnMp.set(fleet, 0);
  shipTurnTurns.set(fleet, 0);
  syncStrategicFleet(fleet);
  return fleet;
}

function extractRoutedMembers(fleet) {
  const members = membersOf(fleet);
  const routed = members.filter(member => member.state === StrategicShipState.ROUTED);
  if (!routed.length || routed.length === members.length) {
    syncStrategicFleet(fleet);
    return routed.length ? fleet : null;
  }
  strategicMembers.set(fleet, members.filter(member => member.state !== StrategicShipState.ROUTED));
  syncStrategicFleet(fleet);
  return spawnMemberFleet(fleet, routed);
}

function moraleCheckMember(fleet, member, { fromFlankOrRear = false } = {}) {
  if (!member || member.state === StrategicShipState.ROUTED) return false;
  const friendlySupport = SC.shipsOfFaction(world, SC.factionOf(world, fleet)).some(other => (
    other !== fleet && hexDist(SC.posOf(world, fleet), SC.posOf(world, other)) <= 1
    && membersOf(other).some(ship => ship.state === StrategicShipState.READY)
  ));
  const result = resolveMorale({
    steadyFriendAdjacent: friendlySupport,
    inCommand: inOriginalFlagshipCommand(fleet),
    fromFlankOrRear,
  }, random);
  if (!result.passed) member.state = member.state === StrategicShipState.READY
    ? StrategicShipState.SHAKEN : StrategicShipState.ROUTED;
  return !result.passed;
}

function applyMoraleAndContagion(fleet, memberIds, options = {}) {
  let failures = 0;
  for (const id of new Set(memberIds)) {
    const member = membersOf(fleet).find(candidate => candidate.id === id);
    if (moraleCheckMember(fleet, member, options)) failures++;
  }
  syncStrategicFleet(fleet);
  extractRoutedMembers(fleet);
  if (!failures) return;
  for (const nearby of SC.shipsOfFaction(world, SC.factionOf(world, fleet))) {
    if (nearby === fleet || hexDist(SC.posOf(world, fleet), SC.posOf(world, nearby)) > 2) continue;
    const candidates = membersOf(nearby).filter(member => member.state !== StrategicShipState.ROUTED);
    if (!candidates.length) continue;
    const member = candidates[Math.floor(random.next() * candidates.length)];
    moraleCheckMember(nearby, member);
    syncStrategicFleet(nearby);
    extractRoutedMembers(nearby);
  }
}

function resolveHexCollisionAt(position, movingFleetIds = []) {
  const fleets = SC.aliveFleets(world).filter(fleet => hexKey(...SC.posOf(world, fleet)) === hexKey(...position));
  const total = fleets.reduce((sum, fleet) => sum + memberCount(fleet), 0);
  if (total <= MAX_SHIPS_PER_HEX) return 0;
  const result = allocateCollisionLosses({
    fleets: fleets.map(fleet => ({ fleetId: fleet, members: membersOf(fleet) })),
    movingFleetIds, maxShips: MAX_SHIPS_PER_HEX, random,
  });
  const visibleAssignments = assignMixedFleetSlots(
    fleets.map(fleet => ({ fleetId: fleet, members: membersOf(fleet) })),
    total,
  );
  const slotByMember = new Map(visibleAssignments.map(assignment => [assignment.member.id, assignment.slotIndex]));
  for (const losses of result.losses.values()) {
    for (const member of losses) queueShipExplosion(position, slotByMember.get(member.id) ?? member.id, member.id);
  }
  for (const entry of result.fleets) {
    strategicMembers.set(entry.fleetId, entry.members);
    syncStrategicFleet(entry.fleetId);
  }
  for (const [fleet, losses] of result.losses) {
    const survivors = membersOf(fleet);
    if (survivors.length) {
      const shaken = survivors[Math.floor(random.next() * survivors.length)];
      applyMoraleAndContagion(fleet, [shaken.id]);
    }
    if (losses.length) shipCourses.delete(fleet);
  }
  return total - MAX_SHIPS_PER_HEX;
}

function processMemberTurnStart(faction) {
  let rallied = 0, retreated = 0;
  const fleets = [...SC.shipsOfFaction(world, faction)];
  for (const fleet of fleets) {
    if (!SC.isAlive(world, fleet)) continue;
    if (!isRoutedFleet(fleet)) {
      for (const member of membersOf(fleet)) {
        if (member.state !== StrategicShipState.SHAKEN) continue;
        if (resolveRally({ inCommand: inOriginalFlagshipCommand(fleet) }, random).passed) {
          member.state = StrategicShipState.READY;
          rallied++;
        }
      }
      syncStrategicFleet(fleet);
      continue;
    }
    const flagship = originalFlagshipFleet(faction);
    const successes = [], failures = [];
    for (const member of membersOf(fleet)) {
      if (inOriginalFlagshipCommand(fleet) && resolveRally({ inCommand: true }, random).passed) successes.push(member);
      else failures.push(member);
    }
    if (successes.length) {
      for (const member of successes) member.state = StrategicShipState.SHAKEN;
      const receiver = flagship && flagship !== fleet ? flagship : null;
      const receiverHexCount = receiver ? SC.aliveFleets(world)
        .filter(other => hexKey(...SC.posOf(world, other)) === hexKey(...SC.posOf(world, receiver)))
        .reduce((sum, other) => sum + memberCount(other), 0) : MAX_SHIPS_PER_HEX;
      const receiverRoom = receiver ? Math.max(0, Math.min(
        MAX_FLEET_STRENGTH - memberCount(receiver),
        MAX_SHIPS_PER_HEX - receiverHexCount,
      )) : 0;
      const joined = successes.slice(0, receiverRoom);
      if (joined.length) {
        strategicMembers.set(receiver, [...membersOf(receiver), ...joined]);
        syncStrategicFleet(receiver);
      }
      const recovered = successes.slice(joined.length);
      if (recovered.length) spawnMemberFleet(fleet, recovered, { state: StrategicShipState.SHAKEN });
      rallied += successes.length;
    }
    strategicMembers.set(fleet, failures);
    syncStrategicFleet(fleet);
    if (!failures.length) continue;
    const target = SC.backwardHex(world, fleet);
    if (!movementBlocker([fleet])(target)) {
      SC.setPosition(world, fleet, ...target);
      resolveHexCollisionAt(SC.posOf(world, fleet), [fleet]);
      retreated++;
    }
    shipTurnMp.set(fleet, 0);
    strategicTurn.actedShipIds = [...new Set([...strategicTurn.actedShipIds, fleet])];
  }
  return { rallied, retreated };
}

function resetFactionMovement(faction) {
  const living = SC.shipsOfFaction(world, faction);
  for (const ship of living) {
    if (isRoutedFleet(ship)) continue;
    shipTurnMp.set(ship, MP_MAX);
    shipTurnTurns.set(ship, 0);
  }
  return living;
}

async function advanceFactionCourses(faction) {
  const living = SC.shipsOfFaction(world, faction);
  let moved = 0;
  let arrived = 0;
  for (const ship of living) {
    const target = shipCourses.get(ship);
    if (!target) continue;
    const position = SC.posOf(world, ship);
    if (hexKey(position[0], position[1]) === hexKey(target[0], target[1])) {
      shipCourses.delete(ship);
      arrived++;
      continue;
    }
    const courseActivation = { u: ship, mp: MP_MAX, turns: 0, moved: false, fired: false, cmd: SC.inCommand(world, ship) };
    const routes = findReachableDestinations({
      position,
      facing: SC.facingOf(world, ship),
      activation: courseActivation,
      moraleState: SC.moraleOf(world, ship),
      enemyPositions: SC.enemiesOf(world, faction).map(enemy => SC.posOf(world, enemy)),
      movementAllowance: MP_MAX,
      movementCost: hexMoveCost,
      isBlocked: movementBlocker([ship]),
      resolveForcedMovement: () => null,
      resolveTransportMovement: transportMoves,
    });
    const route = chooseCourseRoute(routes, position, target);
    if (!route) continue;
    const result = await executeStrategicRouteStepwise(route, {
      activation: courseActivation,
      turnLeft: () => SC.turn(world, ship, 1),
      turnRight: () => SC.turn(world, ship, -1),
      moveForward: () => SC.moveForward(world, ship, { isBlocked: movementBlocker([ship]) }),
      moveBackward: () => SC.moveBackward(world, ship, { isBlocked: movementBlocker([ship]) }),
      applyForcedStep: drift => SC.setPosition(world, ship, ...drift.to),
      jumpTransport: step => {
        if (!step?.position || movementBlocker([ship])(step.position)) return { ok: false, reason: "blocked" };
        SC.setPosition(world, ship, ...step.position);
        return { ok: true };
      },
      afterMovement: () => {
        courseAnimationStep++;
        mapArea.dataset.courseStep = String(courseAnimationStep);
        render();
      },
      waitForNextMovement: () => new Promise(resolve => window.setTimeout(resolve, COURSE_MOVEMENT_DELAY_MS)),
    });
    if (!result.ok) continue;
    shipTurnMp.set(ship, courseActivation.mp);
    shipTurnTurns.set(ship, courseActivation.turns);
    moved++;
    resolveHexCollisionAt(SC.posOf(world, ship), [ship]);
    const nextPosition = SC.posOf(world, ship);
    if (hexKey(nextPosition[0], nextPosition[1]) === hexKey(target[0], target[1])) {
      shipCourses.delete(ship);
      arrived++;
    }
  }
  return { moved, arrived };
}

function courseAdvanceSummary(courses) {
  return courses.moved
    ? `${courses.moved} Fleet${courses.moved === 1 ? "" : "s"} advance on course${courses.arrived ? `; ${courses.arrived} arrived` : ""}`
    : "";
}

function beginFactionCourseAnimation(faction) {
  if (!SC.shipsOfFaction(world, faction).some(ship => !isRoutedFleet(ship) && shipCourses.has(ship))) return null;
  courseAnimationActive = true;
  courseAnimationStep = 0;
  mapArea.dataset.courseAnimation = "active";
  mapArea.dataset.courseStep = "0";
  const pending = Promise.resolve()
    .then(() => advanceFactionCourses(faction))
    .then(courses => {
      const summary = courseAdvanceSummary(courses);
      if (summary) setHint(persistentHint ? `${persistentHint} ${summary}.` : `${summary}.`);
      return courses;
    })
    .catch(error => {
      console.error("Automatic course movement failed:", error);
      setHint("Automatic course movement stopped after an unexpected error.");
      return { moved: 0, arrived: 0 };
    })
    .finally(() => {
      if (courseAnimationPromise !== pending) return;
      courseAnimationActive = false;
      courseAnimationPromise = null;
      mapArea.dataset.courseAnimation = "idle";
      render();
    });
  courseAnimationPromise = pending;
  return pending;
}

function syncPlanetEconomy(layout) {
  for (const planet of layout.planets) {
    if (!planetEconomy.has(planet.id)) {
      planetEconomy.set(planet.id, { owner: null, conquest: null, lastProducedTurn: null });
    }
    planet.resourceValue = bodyResourceValue({ radiusPx: planet.rPx, hexSizePx: GRID_HEX_SIZE_PX });
    planet.ownerFaction = planetEconomy.get(planet.id).owner;
  }
}

function planetHex(planet) {
  return pixelToHexIndex(planet.x, planet.y);
}

function mergeCandidates(ship = activation?.u) {
  if (ship == null || !SC.isAlive(world, ship)) return [];
  const faction = SC.factionOf(world, ship);
  const positionKey = hexKey(...SC.posOf(world, ship));
  const coLocated = SC.shipsOfFaction(world, faction).filter(other => (
    other !== ship
    && SC.isAlive(world, other)
    && memberCount(other) > 0
    && hexKey(...SC.posOf(world, other)) === positionKey
  ));
  let combinedStrength = memberCount(ship);
  return coLocated.filter(other => {
    if (SC.captainOf(world, ship) && SC.captainOf(world, other)) return false;
    if (isRoutedFleet(other)) return false;
    const nextStrength = combinedStrength + memberCount(other);
    if (nextStrength > MAX_FLEET_STRENGTH) return false;
    combinedStrength = nextStrength;
    return true;
  });
}

function mergeFleets() {
  if (!activation || !SC.canMove(activation)) return;
  const candidates = mergeCandidates();
  if (!candidates.length) return;
  const mergingFleets = [activation.u, ...candidates];
  const survivor = mergeSurvivorId(mergingFleets.map(fleet => ({
    id: fleet, flagshipCount: SC.flagshipCountOf(world, fleet),
  })));
  const absorbed = mergingFleets.filter(fleet => fleet !== survivor);
  const mergedMembers = mergingFleets.flatMap(fleet => membersOf(fleet));
  if (mergedMembers.length > MAX_FLEET_STRENGTH) return;

  recordActivationParticipants(mergingFleets);
  strategicMembers.set(survivor, mergedMembers);
  syncStrategicFleet(survivor);
  for (const fleet of absorbed) {
    strategicMembers.set(fleet, []);
    syncStrategicFleet(fleet);
    shipCourses.delete(fleet);
    shipTurnMp.delete(fleet);
    shipTurnTurns.delete(fleet);
    groupMovePreferences.delete(fleet);
  }
  activation.mp = 0;
  activation.u = survivor;
  activation.moved = true;
  activation.fireMode = false;
  activation.cmd = SC.inCommand(world, survivor);
  selectedShip = survivor;
  groupMoveArmed = false;
  rememberActivationMp([survivor]);
  setHint(`${SC.labelOf(world, survivor)} absorbed ${absorbed.length} Fleet${absorbed.length === 1 ? "" : "s"} and now has ${mergedMembers.length} Ships. All AP spent.`);
  advancePlayableTutorial("merged");
  finishActionRender();
}

function splitFleet() {
  if (!activation || !SC.canMove(activation)) return;
  const source = activation.u;
  const split = splitStrategicMembers(membersOf(source));
  if (!split) return;
  const faction = SC.factionOf(world, source);
  const roster = armadaRoster.get(faction);
  const [c, r] = SC.posOf(world, source);
  strategicMembers.set(source, split.retained);
  syncStrategicFleet(source);
  const detached = SC.spawnFleet(world, {
    faction, c, r, dir: SC.facingOf(world, source),
    flagshipCount: split.detached.filter(member => member.isOriginalFlagship).length,
    label: `${faction[0].toUpperCase()}${roster.length + 1}`,
    formation: SC.fleetFormationOf(world, source),
    strength: fleetEffectiveStrength(split.detached),
  });
  strategicMembers.set(detached, split.detached);
  syncStrategicFleet(detached);
  roster.push(detached);
  shipTurnMp.set(source, 0);
  shipTurnMp.set(detached, 0);
  shipTurnTurns.set(detached, 0);
  activation.mp = 0;
  activation.turnsByShip[detached] = 0;
  activation.moved = true;
  activation.fireMode = false;
  recordActivationParticipants([detached]);
  setHint(`${SC.labelOf(world, source)} split into ${split.retained.length}- and ${split.detached.length}-Ship Fleets. All AP spent.`);
  advancePlayableTutorial("split");
  finishActionRender();
}

function adjacentConquestTarget(ship = activation?.u) {
  const layout = systemStaticCache?.layout;
  if (!layout || ship == null || !SC.isAlive(world, ship)) return null;
  const faction = SC.factionOf(world, ship);
  return layout.planets.find(planet => {
    const economy = planetEconomy.get(planet.id);
    return economy?.owner !== faction && !economy?.conquest && canConquerPlanet({
      fleetPosition: SC.posOf(world, ship),
      planetPosition: planetHex(planet),
      fleetStrength: memberCount(ship),
      resourceValue: planet.resourceValue,
    });
  }) || null;
}

function beginConquest() {
  const planet = adjacentConquestTarget();
  if (!planet || !activation) return;
  const faction = SC.factionOf(world, activation.u);
  const economy = planetEconomy.get(planet.id);
  const sourceMembers = membersOf(activation.u);
  if (sourceMembers.length < planet.resourceValue) return;
  const committed = [...sourceMembers].sort((a, b) => (
    Number(a.isOriginalFlagship) - Number(b.isOriginalFlagship)
    || fleetEffectiveStrength([a]) - fleetEffectiveStrength([b])
    || a.id - b.id
  )).slice(0, planet.resourceValue);
  const committedIds = new Set(committed.map(member => member.id));
  strategicMembers.set(activation.u, sourceMembers.filter(member => !committedIds.has(member.id)));
  syncStrategicFleet(activation.u);
  economy.conquest = {
    faction,
    startedRound: strategicTurn.round,
    completesRound: conquestCompletionRound(strategicTurn.round, planet.resourceValue),
  };
  activation.mp = 0;
  rememberActivationMp();
  activation.fired = true;
  activation.moved = true;
  setHint(`${FACTIONS[faction].label} begins conquering ${planet.label}: ${planet.resourceValue} Ships committed; control transfers in ${conquestDurationTurns(planet.resourceValue)} rounds.`);
  advancePlayableTutorial("conquered");
  completeCurrentActivation({ preserveHint: true });
}

function openProductionHex(planet) {
  const gravityRadiusPx = planet.rPx * GRAVITY_INFLUENCE_RADIUS_FACTOR;
  const desiredPoint = spawnPointTowardSun({
    planetX: planet.x, planetY: planet.y, gravityRadiusPx, hexSizePx: GRID_HEX_SIZE_PX,
  });
  const desired = pixelToHexIndex(...desiredPoint);
  const occupied = SC.occupiedSet(world);
  const candidates = hexPatch(desired, 4).sort((a, b) => {
    const [ax, ay] = shipHexOffset(a[0], a[1]);
    const [bx, by] = shipHexOffset(b[0], b[1]);
    return Math.hypot(ax - desiredPoint[0], ay - desiredPoint[1])
      - Math.hypot(bx - desiredPoint[0], by - desiredPoint[1]);
  });
  return candidates.find(hex => {
    if (occupied.has(hexKey(hex[0], hex[1]))) return false;
    const [x, y] = shipHexOffset(hex[0], hex[1]);
    return Math.hypot(x - planet.x, y - planet.y) > gravityRadiusPx;
  }) || null;
}

function produceFleet(planet, faction) {
  const position = openProductionHex(planet);
  if (!position) return null;
  const roster = armadaRoster.get(faction);
  const ship = SC.spawnFleet(world, {
    faction, c: position[0], r: position[1], dir: directionToward(position, [0, 0]),
    label: `${faction[0].toUpperCase()}${roster.length + 1}`,
    strength: planet.resourceValue,
  });
  roster.push(ship);
  attachFreshMembers(ship, planet.resourceValue);
  shipTurnMp.set(ship, MP_MAX);
  shipTurnTurns.set(ship, 0);
  return ship;
}

function startFactionEconomyTurn(layout, faction, round) {
  syncPlanetEconomy(layout);
  resetFactionMovement(faction);
  const morale = processMemberTurnStart(faction);
  const completed = [];
  for (const planet of layout.planets) {
    const economy = planetEconomy.get(planet.id);
    if (economy.conquest && round >= economy.conquest.completesRound) {
      economy.owner = economy.conquest.faction;
      economy.conquest = null;
      planet.ownerFaction = economy.owner;
      completed.push(`${planet.label} joins ${FACTIONS[economy.owner].label}`);
      scene3dStaticSource = null;
    }
  }

  let produced = 0;
  for (const planet of layout.planets) {
    const economy = planetEconomy.get(planet.id);
    const turnKey = `${round}:${faction}`;
    if (economy.owner !== faction || economy.lastProducedTurn === turnKey) continue;
    for (let index = 0; index < PRODUCTION_FLEETS_PER_TURN; index++) {
      if (produceFleet(planet, faction) != null) produced++;
    }
    economy.lastProducedTurn = turnKey;
  }
  beginFactionCourseAnimation(faction);
  return [
    ...completed,
    morale.rallied ? `${morale.rallied} Ship${morale.rallied === 1 ? "" : "s"} rallied` : "",
    morale.retreated ? `${morale.retreated} routed Fleet${morale.retreated === 1 ? "" : "s"} retreated` : "",
    produced ? `${FACTIONS[faction].label} produces ${produced} Fleet${produced === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean).join(". ");
}

function processStrategicTurnTransition(previousTurn, nextTurn) {
  if (previousTurn.round === nextTurn.round
      && activeStrategicFaction(previousTurn) === activeStrategicFaction(nextTurn)) return "";
  const layout = systemStaticCache?.layout;
  return layout ? startFactionEconomyTurn(layout, activeStrategicFaction(nextTurn), nextTurn.round) : "";
}

function commandGroupShips() {
  if (!activation || !SC.isAlive(world, activation.u) || !SC.isFlagship(world, activation.u)) return [];
  const friendlyMembers = SC.shipsOfFaction(world, SC.factionOf(world, activation.u))
    .filter(ship => shipCanActThisTurn(ship) && !isRoutedFleet(ship))
    .map(id => ({ id, position: SC.posOf(world, id) }));
  return membersWithinCommand(activation.u, friendlyMembers, CMD_R).map(member => member.id);
}

function commandGroupMembers() {
  return commandGroupShips().map(id => ({
    id,
    position: SC.posOf(world, id),
    facing: SC.facingOf(world, id),
    moraleState: SC.moraleOf(world, id),
    turns: activation?.turnsByShip?.[id] || 0,
  }));
}

function groupMoveText(route) {
  return `${route.memberRoutes.length} ships move together · ${route.cost} AP`;
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
      resolveForcedMovement: () => null,
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
      resolveForcedMovement: () => null,
      resolveTransportMovement: transportMoves,
    });
  }
  const hoveredRoute = pointerHex ? reachableMoves.get(hexKey(pointerHex[0], pointerHex[1])) : null;
  hoverMoveHint = hoveredRoute
    ? (groupMoveArmed ? groupMoveText(hoveredRoute) : `Move here · ${hoveredRoute.cost} AP`)
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
      jumpTransport: step => {
        if (!step?.position || isBlocked(step.position)) return { ok: false, reason: "blocked" };
        SC.setPosition(world, activation.u, ...step.position);
        return { ok: true };
      },
    });
  if (!result.ok) {
    moveResultHint(result);
    renderInfoPanel();
    render();
    return false;
  }
  if (movingAsGroup) recordActivationParticipants(route.memberRoutes.map(plan => plan.memberId));
  for (const ship of movingShips) resolveHexCollisionAt(SC.posOf(world, ship), movingShips);
  rememberActivationMp(movingShips);
  // The route's individual rule calls mutate only position/facing. The
  // activation bookkeeping is committed once after the complete route.
  hoverPatchCenter = null;
  setHint(movingAsGroup
    ? `${route.memberRoutes.length} ships moved together for ${route.cost} AP; gravity may have separated the formation.`
    : `${SC.labelOf(world, activation.u)} moved ${route.cost} AP${route.forcedSteps?.length ? " and drifted with the current" : ""}.`);
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
  if (activation.mp < cost) { setHint(`Not enough AP — that hex costs ${cost}.`); renderInfoPanel(); return; }
  const res = SC.moveForward(world, activation.u, { isBlocked: movementBlocker([activation.u]) });
  if (!res.ok) { moveResultHint(res); renderInfoPanel(); return; }
  activation.mp -= cost; activation.moved = true; activation.fireMode = false;
  rememberActivationMp();
  const collisions = resolveHexCollisionAt(SC.posOf(world, activation.u), [activation.u]);
  setHint(`${collisions ? `Collision destroys ${collisions} Ship${collisions === 1 ? "" : "s"}.` : ""}`.trim());
  advancePlayableTutorial("forward");
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
  activation.mp -= activation.backwardCost || MP_MAX; activation.moved = true; activation.fireMode = false;
  rememberActivationMp();
  const collisions = resolveHexCollisionAt(SC.posOf(world, activation.u), [activation.u]);
  setHint(`${collisions ? `Collision destroys ${collisions} Ship${collisions === 1 ? "" : "s"}.` : ""}`.trim());
  advancePlayableTutorial("back");
  finishActionRender();
}
// Arms the cosmetic "fire mode" hint -- exactly like battle, clicking a
// legal target fires regardless of whether this was pressed first (see
// handleShipOrDestinationClick), so this only exists to show
// "pick a highlighted target" in the panel.
function armFireMode() {
  if (!SC.canFire(world, activation)) return;
  groupMoveArmed = false;
  activation.fireMode = true;
  render();
}
function doFireAt(tgt) {
  if (!SC.canFire(world, activation)) return;
  if (!SC.legalTargets(world, activation.u).includes(tgt)) return;
  const firer = activation.u;
  const targetPosition = SC.posOf(world, tgt);
  const targetKey = hexKey(...targetPosition);
  const targetFaction = SC.factionOf(world, tgt);
  const targetFleets = SC.shipsOfFaction(world, targetFaction).filter(fleet => (
    hexKey(...SC.posOf(world, fleet)) === targetKey && memberCount(fleet) > 0
  ));
  groupMoveArmed = false;
  const volley = resolveHexVolley({
    attackerStrength: fleetStrength(firer),
    targets: targetFleets.map(fleet => ({
      fleetId: fleet,
      members: membersOf(fleet),
      arc: incomingArc(SC.posOf(world, fleet), SC.facingOf(world, fleet), SC.posOf(world, firer)),
    })),
    random,
  });
  const slotAssignments = assignMixedFleetSlots(targetFleets.map(fleet => ({ fleetId: fleet, members: membersOf(fleet) })));
  const slotPositions = fleetShipPositions({
    x: 0, y: 0, facingDeg: 0, formation: "sphere",
    strength: slotAssignments.length, spacing: 1,
  });
  const positionsByMemberId = new Map(slotAssignments.map((slot, index) => [slot.member.id, slotPositions[index] || [0, 0]]));
  const towardFirer = directionToward(targetPosition, SC.posOf(world, firer));
  const incomingAngle = DIR_ANGLE[towardFirer] * Math.PI / 180;
  let damage = 0, destroyed = 0;
  for (const fleet of targetFleets) {
    const hits = volley.hitsByFleet.get(fleet) || 0;
    if (!hits) continue;
    const arc = incomingArc(SC.posOf(world, fleet), SC.facingOf(world, fleet), SC.posOf(world, firer));
    const outcome = applyDirectionalDamage({
      members: membersOf(fleet), positionsByMemberId,
      incomingVector: [Math.cos(incomingAngle), Math.sin(incomingAngle)],
      damage: hits * STRATEGIC_DAMAGE_PER_HIT, random,
    });
    strategicMembers.set(fleet, outcome.members);
    syncStrategicFleet(fleet);
    damage += hits * STRATEGIC_DAMAGE_PER_HIT;
    destroyed += outcome.destroyedIds.length;
    for (const memberId of outcome.destroyedIds) {
      const slot = slotAssignments.find(assignment => assignment.member.id === memberId);
      queueShipExplosion(targetPosition, slot?.slotIndex ?? memberId, memberId);
    }
    applyMoraleAndContagion(fleet, outcome.damagedIds, { fromFlankOrRear: arc !== FiringArc.FRONT });
  }
  effects.push({
    kind: "tracer",
    from: SC.posOf(world, firer), to: targetPosition, hit: damage > 0, start: performance.now(),
    colorHex: strategicLaserColor(SC.factionOf(world, firer)),
    dur: damage > 0 ? LASER_DURATION.hit : LASER_DURATION.miss,
  });
  activation.fired = true; activation.fireMode = false;
  const hits = [...volley.hitsByFleet.values()].reduce((sum, value) => sum + value, 0);
  setHint(`${SC.labelOf(world, firer)} fires ${volley.dice} dice at the stack: [${volley.rolls.map(result => result.roll).join(" ")}] → `
    + `${hits} hit${hits === 1 ? "" : "s"} · ${damage.toFixed(1)} damage${destroyed ? ` · ${destroyed} Ship${destroyed === 1 ? "" : "s"} destroyed` : ""}.`);
  finishActionRender();
}
// Arms Set Course -- the next click stores a persistent destination. At the
// start of each owner turn the Fleet spends its real AP following the best
// legal route toward that hex; it never teleports.
function armTravel() {
  if (!activation) return;
  groupMoveArmed = false;
  travelArmed = true;
  setHint("Click a destination to set course.");
  advancePlayableTutorial("course-armed");
  render();
}
function toggleCourse() {
  if (!activation) return;
  if (!shipCourses.has(activation.u)) {
    armTravel();
    return;
  }
  shipCourses.delete(activation.u);
  travelArmed = false;
  activation.courseSet = true;
  setHint(`${SC.labelOf(world, activation.u)} course cancelled.`);
  renderInfoPanel();
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
  if (groupMoveArmed) advancePlayableTutorial("group-armed");
  renderInfoPanel();
  render();
}
function setCourse(x, y) {
  const [c, r] = pixelToHexIndex(x, y);
  shipCourses.set(activation.u, [c, r]);
  activation.courseSet = true;
  setHint(`${SC.labelOf(world, activation.u)} course set for hex ${c},${r}. Movement begins at the start of its next turn.`);
  travelArmed = false;
  hoverPatchCenter = null;
  advancePlayableTutorial("course-set");
  renderInfoPanel();
  render();
}
// Shared by both the 3D and 2D click handlers: handles everything that
// depends on a ship being selected (firing at a legal target, switching
// selection to a different ship, selecting a fresh one, or consuming an
// armed Set Course) before either handler falls through to its own
// star/moon/planet info-panel branches. Returns true if the click
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
  if (hit?.kind === "fleet-stack") {
    const fleets = hit.fleetIds.filter(fleet => SC.isAlive(world, fleet));
    if (activation) {
      const target = fleets.find(fleet => SC.legalTargets(world, activation.u).includes(fleet));
      if (target) { doFireAt(target); return true; }
    }
    const selectable = fleets.filter(fleet => shipCanActThisTurn(fleet));
    if (selectable.length) {
      const current = selectable.indexOf(selectedShip);
      selectShip(selectable[(current + 1) % selectable.length]);
    }
    return true;
  }
  if (clickAction === StrategicClickAction.SHIP) {
    if (activation && SC.legalTargets(world, activation.u).includes(hit.id)) { doFireAt(hit.id); return true; }
    if (!activation || activation.u !== hit.id) selectShip(hit.id);
    return true;
  }
  if (clickAction === StrategicClickAction.MOVE) { executeReachableMove(route); return true; }
  return false;
}
// Shared by both click handlers' fallthrough (once
// handleShipOrDestinationClick has returned false): the star/moon/
// planet info-panel branches, identical in both the 3D and 2D
// views since neither renderer has anything hit-kind-specific left to say
// once a ship/travel click has been ruled out.
function dispatchBodyClick(hit) {
  if (hit?.kind === "star") { setHint(""); showBodyInfo(hit); return; }
  if (hit?.kind === "moon") { setHint(`${hit.label} — a moon of ${hit.parentLabel}.`); showBodyInfo(hit); return; }
  if (hit?.kind === "planet") {
    const info = infoFor(hit);
    setHint(`${info.name} — ${info.detail}`);
    showBodyInfo(hit);
    return;
  }
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
    const captain = SC.captainOf(world, u);
    infoPanel.style.display = "block";
    infoPanel.dataset.captain = captain ? `${captain.name}: ${captainAbility(captain.abilityId)?.description || captain.abilityId}` : "";
    const commandedShips = commandGroupShips();
    const groupMoveSaved = SC.isFlagship(world, u) && groupMovePreferences.has(u);
    const groupMoveEnabled = groupMoveArmed || groupMoveSaved;
    const groupForwardRoute = groupMoveArmed ? groupRouteTo(SC.forwardHex(world, u)) : null;
    const groupBackwardRoute = groupMoveArmed ? groupRouteTo(SC.backwardHex(world, u)) : null;
    const groupCanTurn = !groupMoveArmed || commandedShips.every(ship => (activation.turnsByShip?.[ship] || 0) < MAX_TURNS_PER_ACTIVATION);
    infoTurnL.disabled = infoTurnR.disabled = !SC.canTurn(activation) || !groupCanTurn;
    infoForward.disabled = groupMoveArmed ? !groupForwardRoute : !SC.canMove(activation);
    infoBack.disabled = groupMoveArmed ? !groupBackwardRoute : !SC.canBack(activation);
    infoTurnL.title = infoTurnR.title = groupMoveArmed ? `Turn all ${commandedShips.length} Fleets (free, 2 maximum)` : "Turn (free, 2 maximum)";
    infoForward.title = groupMoveArmed && groupForwardRoute
      ? `Move all ${commandedShips.length} ships forward · ${groupForwardRoute.cost} AP`
      : "";
    infoBack.title = groupMoveArmed && groupBackwardRoute
      ? `Move all ${commandedShips.length} ships back · ${groupBackwardRoute.cost} AP`
      : "1 hex astern, keeps facing — costs all remaining AP";
    infoFire.disabled = !SC.canFire(world, activation);
    const course = shipCourses.get(u);
    infoTravel.textContent = course ? "Cancel Course" : "Set Course";
    infoTravel.title = course ? `Cancel target ${course.join(",")}` : "Choose a target hex for next-turn movement";
    infoGroupMove.style.display = SC.isFlagship(world, u) ? "" : "none";
    infoGroupMove.textContent = groupMoveEnabled
      ? "Cancel group move"
      : `Move command group (${commandedShips.length})`;
    infoGroupMove.disabled = !groupMoveEnabled && (!SC.canMove(activation) || commandedShips.length < 2);
    infoGroupMove.setAttribute("aria-pressed", String(groupMoveEnabled));
    const mergeable = mergeCandidates(u);
    infoMerge.style.display = mergeable.length ? "" : "none";
    infoMerge.textContent = `Merge Fleets (${mergeable.length + 1})`;
    infoMerge.disabled = !SC.canMove(activation);
    infoMerge.title = `Combine ready friendly Fleets in this hex up to ${MAX_FLEET_STRENGTH} Ships; costs all remaining AP`;
    const canSplit = memberCount(u) >= 2;
    infoSplit.style.display = canSplit ? "" : "none";
    infoSplit.disabled = !SC.canMove(activation);
    infoSplit.title = memberCount(u) > 19
      ? "Detach 19 Ships; costs all remaining AP"
      : "Split this Fleet in half; costs all remaining AP";
    const conquerTarget = adjacentConquestTarget(u);
    infoConquer.style.display = conquerTarget ? "" : "none";
    if (conquerTarget) {
      const x = conquerTarget.resourceValue;
      infoConquer.textContent = `Conquer ${conquerTarget.label} (${x} Ships · ${conquestDurationTurns(x)} rounds)`;
    }
    return;
  }
  infoMerge.style.display = "none";
  infoSplit.style.display = "none";
  infoConquer.style.display = "none";
  infoPanel.style.display = "none";
}
infoTurnL.onclick = () => doTurn(1);
infoTurnR.onclick = () => doTurn(-1);
infoForward.onclick = doForward;
infoBack.onclick = doBackward;
infoFire.onclick = armFireMode;
infoTravel.onclick = toggleCourse;
infoGroupMove.onclick = toggleGroupMove;
infoMerge.onclick = mergeFleets;
infoSplit.onclick = splitFleet;
infoConquer.onclick = beginConquest;
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
  if (!strategicTurnUsesTimer(factionControllers)) {
    turnClock.hidden = true;
    lastRenderedTimerSecond = null;
    return;
  }
  turnClock.hidden = false;
  const remainingSeconds = Math.ceil(strategicTurnRemainingMs(strategicTurn, nowMs) / 1000);
  lastRenderedTimerSecond = remainingSeconds;
  turnClock.textContent = `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")} remaining`;
}

function setTurnPanelMinimized(minimized) {
  turnPanel.classList.toggle("minimized", minimized);
  turnPanelToggle.textContent = minimized ? "+" : "−";
  turnPanelToggle.title = minimized ? "Expand Fleet roster" : "Minimize Fleet roster";
  turnPanelToggle.setAttribute("aria-label", turnPanelToggle.title);
  turnPanelToggle.setAttribute("aria-expanded", String(!minimized));
}

turnPanelToggle.onclick = () => setTurnPanelMinimized(!turnPanel.classList.contains("minimized"));
setTurnPanelMinimized(false);

function renderTurnPanel(nowMs = performance.now()) {
  if (!shipsSpawned) return;
  const activeFaction = activeStrategicFaction(strategicTurn);
  turnHeading.textContent = `Round ${strategicTurn.round} · ${FACTIONS[activeFaction].label} Armada turn`;
  renderTurnClock(nowMs);
  const participantSet = new Set(activationParticipants());
  const rosterSignature = JSON.stringify({
    round: strategicTurn.round,
    activeFaction,
    acted: strategicTurn.actedShipIds,
    forfeited: strategicTurn.forfeitedShipIds,
    selectedShip,
    courseAnimationActive,
    participants: [...participantSet],
    alive: [...armadaRoster.values()].flat().map(ship => SC.isAlive(world, ship)),
    members: [...armadaRoster.values()].flat().map(ship => memberCount(ship)),
    controllers: [...factionControllers],
  });
  if (rosterSignature === lastTurnRosterSignature) return;
  lastTurnRosterSignature = rosterSignature;
  turnFactions.replaceChildren();

  for (const [faction, ships] of armadaRoster) {
    if (!configuredFactions.includes(faction)) continue;
    const section = document.createElement("section");
    section.className = `turnFaction${faction === activeFaction ? " active" : ""}`;
    const header = document.createElement("div");
    header.className = "turnFactionHeader";
    const name = document.createElement("span");
    name.textContent = `${FACTIONS[faction].label} Armada · ${isNpcFaction(faction) ? "NPC" : "Player"}`;
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
      const shipCount = memberCount(ship);
      button.title = `Fleet ${SC.labelOf(world, ship)} — ${shipCount} Ships, ${displayState.label}. Pan to this Fleet.`;
      button.setAttribute("aria-label", `Fleet ${SC.labelOf(world, ship)} ${displayState.label}, ${shipCount} Ships`);
      button.setAttribute("aria-pressed", String(selectedShip === ship));
      button.disabled = courseAnimationActive;
      const label = document.createElement("span");
      const flagshipCount = SC.flagshipCountOf(world, ship);
      label.textContent = `Fleet ${SC.labelOf(world, ship)}${flagshipCount ? ` ★${flagshipCount > 1 ? `×${flagshipCount}` : ""}` : ""}`;
      const status = document.createElement("span");
      status.className = "turnShipState";
      status.textContent = `${shipCount} Ships`;
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
  if (courseAnimationActive) return;
  if (!strategicTurnUsesTimer(factionControllers)) {
    if (!turnClock.hidden) renderTurnClock(nowMs);
    return;
  }
  const expiringFaction = activeStrategicFaction(strategicTurn);
  const previousTurn = strategicTurn;
  const result = expireStrategicTurn(strategicTurn, {
    livingShipIdsByFaction: livingShipIdsByFaction(),
    nowMs,
    eligibleFactionIds: economicallyEligibleFactions(),
  });
  if (result.expired) {
    if (activation && SC.factionOf(world, activation.u) === expiringFaction) activation.mp = 0;
    strategicTurn = result.state;
    const economyHint = processStrategicTurnTransition(previousTurn, strategicTurn);
    clearSelection();
    lastRenderedTimerSecond = null;
    setHint(`${FACTIONS[expiringFaction].label} ran out of time — ${result.expiredShipIds.length} remaining ships lost their AP. ${FACTIONS[activeStrategicFaction(strategicTurn)].label} turn begins.${economyHint ? ` ${economyHint}.` : ""}`);
    render();
    scheduleNpcTurn();
    return;
  }
  const remainingSeconds = Math.ceil(strategicTurnRemainingMs(strategicTurn, nowMs) / 1000);
  if (remainingSeconds !== lastRenderedTimerSecond) renderTurnClock(nowMs);
}

function levelData(entry) {
  return entry.level === "system" ? systemLevel(entry.systemId) : universeLevel();
}

const FILL = {
  system: "#3a2f6a", star: "#5a4a1a", planet: "#1a3a5c",
  "body-center": "#5a4a1a", moon: "#2e3644",
};
const STROKE = {
  system: "#a78bfa", star: "#ffd166", planet: "#4a9eff",
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
// but Earth's own). Only bodies solarsystemscope actually
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
const EARTH_DAY_MS = 86400000;
let orbitAnimationSimMs = Date.now();

function renderUniverse(entry, data, nowMs = Date.now()) {
  mapwrap3d.style.display = "none";
  mapwrap.style.display = "inline-block";
  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;
  const ctx = canvas.getContext("2d");
  const cx = canvas.width / 2, cy = canvas.height / 2;

  const layout = layoutOrbitalBoard(data, { maxPixel: ORBIT_MAX_PX, nowMs });
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

// Gravity is discrete, so every planet that generates a well needs to sit
// exactly on a cell center.  Moving its moons by the same tiny correction
// keeps their local rings and cluster visually attached to the planet.
function snapGravityBodiesToHexGrid(layout) {
  for (const planet of layout.planets) {
    const [x, y] = snapToHexGrid(planet.x, planet.y);
    const dx = x - planet.x, dy = y - planet.y;
    planet.x = x; planet.y = y;
    for (const moon of planet.moons) {
      moon.x += dx;
      moon.y += dy;
      moon.tiltZ += dy;
    }
  }
  return layout;
}

function sparseOverlaySnapshot() {
  const toCell = ([c, r]) => {
    const [x, z] = shipHexOffset(c, r);
    return { c, r, x, z, key: hexKey(c, r) };
  };
  const transportCells = [];
  for (const lane of systemStaticCache?.transportNetwork?.lanes || []) {
    const stride = Math.max(1, Math.ceil(lane.cells.length / 12));
    const sampled = lane.cells.filter((_cell, index) => index % stride === 0 || index === lane.cells.length - 1);
    for (const position of sampled) {
      const cell = systemStaticCache.transportNetwork.cells.get(hexKey(...position));
      const [x, z] = shipHexOffset(...position);
      transportCells.push({ ...toCell(position), x, z, laneIds: cell?.laneIds || [lane.id], ambush: !!cell?.ambush });
    }
  }
  const commandCenter = selectedShip != null && SC.isAlive(world, selectedShip) && SC.isFlagship(world, selectedShip)
    ? SC.posOf(world, selectedShip)
    : null;
  const courseTarget = selectedShip != null ? shipCourses.get(selectedShip) : null;
  const courseLines = [...shipCourses].flatMap(([ship, target]) => {
    if (!SC.isAlive(world, ship)) return [];
    return [{
      from: toCell(SC.posOf(world, ship)),
      to: toCell(target),
      colorHex: colorsFor({ faction: SC.factionOf(world, ship) }).fill,
    }];
  });
  return {
    boardCells: (tutorialMap?.cells || []).map(toCell),
    transportCells: mapArea.dataset.renderer === "3d" ? [] : transportCells,
    commandCells: commandCenter ? hexPatch(commandCenter, CMD_R).map(toCell) : [],
    hoverCells: hoverPatchCenter ? hexPatch(hoverPatchCenter).map(toCell) : [],
    reachableCells: [...reachableMoves.values()].map(route => ({ ...toCell(route.position), cost: route.cost })),
    courseCells: courseTarget ? [toCell(courseTarget)] : [],
    courseLines,
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
    ? (groupMoveArmed ? groupMoveText(route) : `Move here · ${route.cost} AP`)
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
// every faction's initial Fleets, placed at their formation-derived starting
// hex exactly like the old (now-removed) placeShips computed fresh on
// every render, but done exactly once here: from this point on a ship's
// real Position/Facing components are the only source of truth for where
// it is and which way it faces, never recomputed from
// FLEET_POSITIONS/ARMADA_DEPLOYMENT_FORMATIONS again. Anchored on each faction's
// single logical FLEET_POSITIONS point (the exact same log-distance scale
// as every real body in this view) using the exact same
// formationLayout()-relative-offset math the old placeShips used. Every
// ship receives its own six-direction facing toward the Sun at hex [0,0].
let shipsSpawned = false;
function spawnInitialShips(layout) {
  for (const [faction, pos] of Object.entries(FLEET_POSITIONS)) {
    if (!configuredFactions.includes(faction)) continue;
    const distanceKm = Math.hypot(pos.xKm, pos.yKm);
    const angle = Math.atan2(pos.yKm, pos.xKm);
    const r = layout.dist.toPixel(distanceKm);
    const [anchorX, anchorY] = snapToHexGrid(r * Math.cos(angle), r * Math.sin(angle));
    const { u } = formationLayout(ARMADA_DEPLOYMENT_FORMATIONS[faction], FLEETS_PER_ARMADA);
    const flagshipIndices = [0, Math.floor((u.length - 1) / 2), u.length - 1];
    u.forEach(([fwd, lat], i) => {
      const [dx, dy] = shipHexOffset(fwd, lat);
      const [c, rIdx] = pixelToHexIndex(anchorX + dx, anchorY + dy);
      const captain = flagshipIndices.includes(i) ? captainsByFaction.get(faction)?.[flagshipIndices.indexOf(i)] : null;
      const ship = SC.spawnFleet(world, {
        faction, c, r: rIdx, dir: directionToward([c, rIdx], [0, 0]), isFlagship: !!captain, captain,
        label: `${faction[0].toUpperCase()}${i + 1}`, strength: INITIAL_FLEET_STRENGTH,
      });
      armadaRoster.get(faction).push(ship);
      attachFreshMembers(ship, INITIAL_FLEET_STRENGTH, captain ? 1 : 0);
      shipTurnMp.set(ship, MP_MAX);
      shipTurnTurns.set(ship, 0);
    });
  }
}

function startPlayableTutorial() {
  if (shipsSpawned) return;
  const layout = systemStaticCache?.layout;
  const earth = layout?.planets.find(planet => planet.id === "earth");
  if (!layout || !earth) {
    setHint("The system map is still loading. Try Tutorial again in a moment.");
    return;
  }
  const faction = Object.keys(FACTIONS)[0];
  configuredFactions.splice(0, configuredFactions.length, faction);
  factionControllers.clear();
  factionControllers.set(faction, "player");
  for (const economy of planetEconomy.values()) {
    economy.owner = null;
    economy.conquest = null;
    economy.lastProducedTurn = null;
  }
  syncPlanetEconomy(layout);
  strategicTurn = createStrategicTurnState({ factionOrder: [faction], startedAtMs: performance.now() });
  const earthPosition = planetHex(earth);
  tutorialMap = createPlayableTutorialMap(earthPosition);
  const fleets = tutorialMap.fleets.map((trainingFleet, index) => {
    const fleet = SC.spawnFleet(world, {
      faction,
      c: trainingFleet.position[0],
      r: trainingFleet.position[1],
      dir: trainingFleet.facing,
      flagshipCount: trainingFleet.isFlagship ? 1 : 0,
      label: `${faction[0].toUpperCase()}${index + 1}`,
      strength: trainingFleet.shipCount,
    });
    armadaRoster.get(faction).push(fleet);
    attachFreshMembers(fleet, trainingFleet.shipCount, trainingFleet.isFlagship ? 1 : 0);
    shipTurnMp.set(fleet, MP_MAX);
    shipTurnTurns.set(fleet, 0);
    return fleet;
  });
  shipsSpawned = true;
  tutorialMode = true;
  tutorialStepIndex = 0;
  tutorialLibraryReturnToGame = false;
  startOverlay.hidden = true;
  tutorialGuide.hidden = false;
  scene3dStaticSource = null;
  lastTurnRosterSignature = null;
  renderPlayableTutorialStep();
  setHint("Playable tutorial started — command three 10-Ship Fleets on the training board.");
  render();
  requestAnimationFrame(() => {
    const [x, z] = warpedGravityPoint(...shipHexOffset(...tutorialMap.center), systemStaticCache?.wells || []);
    if (mapArea.dataset.renderer === "3d" && scene3d) {
      scene3d.panTo(x, z);
      scene3d.zoomBy(4);
    } else {
      camera2d.x = x;
      camera2d.y = z;
      camera2d.zoom = 4;
      render();
    }
  });
}

function startNewGame() {
  if (shipsSpawned) return;
  const layout = systemStaticCache?.layout;
  if (!layout) {
    setHint("The system map is still loading. Try New Game again in a moment.");
    return;
  }
  const playerCount = Number(playerCountSelect.value);
  const npcCount = Number(npcCountSelect.value);
  const setup = strategicFactionSetup(Object.keys(FACTIONS), { playerCount, npcCount });
  if (!setup) return;
  configuredFactions.splice(0, configuredFactions.length, ...setup.factions);
  const seed = Number(captainSeedInput.value) || 1;
  captainsByFaction.clear();
  for (const faction of setup.factions) captainsByFaction.set(faction, draftCaptains(faction, seed));
  factionControllers.clear();
  for (const [faction, controller] of setup.controllers) factionControllers.set(faction, controller);
  for (const [faction, config] of Object.entries(FACTIONS)) {
    if (!configuredFactions.includes(faction)) continue;
    planetEconomy.set(config.startAt, { owner: faction, conquest: null, lastProducedTurn: null });
  }
  strategicTurn = createStrategicTurnState({ factionOrder: configuredFactions, startedAtMs: performance.now() });
  spawnInitialShips(layout);
  shipsSpawned = true;
  tutorialMode = false;
  tutorialGuide.hidden = true;
  startFactionEconomyTurn(layout, activeStrategicFaction(strategicTurn), strategicTurn.round);
  startOverlay.hidden = true;
  scene3dStaticSource = null;
  lastTurnRosterSignature = null;
  setHint(`New Game started — ${FACTIONS[activeStrategicFaction(strategicTurn)].label} Armada acts first.`);
  render();
  scheduleNpcTurn();
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
  const targets = activation && SC.canFire(world, activation)
    ? new Set(SC.legalTargets(world, activation.u)) : null;
  const groupMembers = groupMoveArmed ? new Set(commandGroupShips()) : null;
  const targetColor = targets ? colorsFor({ faction: SC.factionOf(world, activation.u) }).fill : null;
  const alive = SC.aliveFleets(world).filter(fleet => memberCount(fleet));
  const stacks = new Map();
  for (const fleet of alive) {
    const stackKey = hexKey(...SC.posOf(world, fleet));
    if (!stacks.has(stackKey)) stacks.set(stackKey, []);
    stacks.get(stackKey).push(fleet);
  }
  const stackInfo = new Map();
  for (const fleets of stacks.values()) {
    const assignments = assignMixedFleetSlots(fleets.map(fleet => ({ fleetId: fleet, members: membersOf(fleet) })));
    const byFleet = new Map(fleets.map(fleet => [fleet, []]));
    for (const assignment of assignments) byFleet.get(assignment.fleetId).push(assignment);
    fleets.forEach((fleet, index) => stackInfo.set(fleet, {
      fleetIds: fleets, memberSlots: byFleet.get(fleet), showBase: index === 0,
    }));
  }
  return alive.map(e => {
    const [c, r] = SC.posOf(world, e);
    const [gridX, gridY] = shipHexOffset(c, r);
    const [x, y] = warpedGravityPoint(gridX, gridY, wells);
    const hasActed = hasStrategicShipActed(strategicTurn, e);
    const stack = stackInfo.get(e);
    return {
      id: e, kind: stack.showBase ? "fleet-stack" : "fleet", fleetIds: stack.fleetIds,
      showBase: stack.showBase, memberSlots: stack.memberSlots,
      faction: SC.factionOf(world, e), isFlag: SC.isFlagship(world, e),
      label: SC.labelOf(world, e), facingDeg: DIR_ANGLE[SC.facingOf(world, e)],
      strength: memberCount(e), effectiveStrength: fleetStrength(e), formation: SC.fleetFormationOf(world, e),
      isTarget: stack.fleetIds.some(fleet => targets?.has(fleet)), targetColor,
      isGroupMember: stack.fleetIds.some(fleet => groupMembers?.has(fleet)),
      hasActed, colorHex: strategicFleetTone(SC.factionOf(world, e), e, hasActed),
      x, y,
    };
  });
}

// Gravity wells are the Sun and planets. Moons remain visual bodies only.
function gravityWells(layout) {
  return [];
}

// Gravity influence radius scales with a body's own rendered size --
// bigger bodies (the Sun, gas giants) reach further and pull harder than
// small ones (Mercury). A well
// too small to reach even one hex (radius < GRID_HEX_SIZE_PX) is skipped
// entirely -- gravityWells already excludes moons, but a very small/
// close-in planet could still round to nothing.
// The 2D fallback's own opacity ceiling (see the gravity-hex drawing loop
// in renderSystem2D) -- scaled down per hex by gravityHexIntensity, so
// only the deepest hexes ever actually reach this value.
const GRAVITY_HEX_MAX_OPACITY = 0.3;
// Strength is a real, unbounded falloff, not a flat 3-tier scale -- inversely
// proportional to distance in units of the body's own radius, scaled so
// it lands on exactly 1 AP (the same as open space) right at the edge of
// GRAVITY_INFLUENCE_RADIUS_FACTOR: a hex FACTOR radii out has strength 1;
// one body-radius out has strength FACTOR; deep inside grows without a
// ceiling. This strength controls color, line weight, and arrow emphasis,
// not movement points. distRadii is floored
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
// more expensive) a hex is, the same falloff the AP cost already uses,
// just read as a gradient instead of a number. Cost is unbounded
// (gravityHexCost has no ceiling right next to a massive body), so this
// clamps at 1 rather than trying to normalize against some cost that
// might not exist.
const GRAVITY_HEX_MIN_INTENSITY = 0.25;
const GRAVITY_HEX_INTENSITY_PER_COST = 0.05;
function gravityHexIntensity(cost) {
  return Math.min(1, GRAVITY_HEX_MIN_INTENSITY + cost * GRAVITY_HEX_INTENSITY_PER_COST);
}

// Every normal hex within the hexagonal reach of the Sun or a planet's gravity, painted that
// body's own color. Where two wells' reach overlaps, a hex takes
// whichever well demands the *most* AP (worst case); a tie keeps
// whichever well was found first (arbitrary but stable within one
// render). Bounded per-well -- only hexes within that one well's own
// radius are ever considered, so this stays cheap even though the Sun's
// own field alone can cover a thousand-plus hexes.
function gravityHexes(layout) {
  return new Map();
}
function gravityRenderCells(cells) {
  return new Map([...cells].filter(([, cell]) => !cell.transport));
}
// Refreshes the module-level gravityHexCosts (see its declaration above)
// from the current gravity-hex map -- called once per render, right after
// computing it.
function updateGravityHexes(cells) {
  gravityHexCosts = cells;
}

function gravityDrift(position) {
  return resolveGravityDrift(position, gravityHexCosts, hex => shipHexOffset(hex[0], hex[1]));
}

function transportMoves(position) {
  const network = systemStaticCache?.transportNetwork;
  return transportLanesAt(position, network).map(lane => transportJumpDestination(lane, position)).filter(Boolean);
}

function transportFieldGeometry(network) {
  const segments = [];
  const nodes = [];
  for (const lane of network?.lanes || []) {
    const stride = Math.max(1, Math.ceil(lane.cells.length / 24));
    const sampled = lane.cells.filter((_cell, index) => index % stride === 0 || index === lane.cells.length - 1);
    for (let index = 1; index < sampled.length; index++) {
      const [x1, z1] = shipHexOffset(...sampled[index - 1]);
      const [x2, z2] = shipHexOffset(...sampled[index]);
      segments.push([x1, z1, x2, z2]);
    }
    for (const position of lane.ambushCells) {
      const [x, z] = shipHexOffset(...position);
      nodes.push({ ...sparseOverlayCell(position), x, z });
    }
  }
  return { segments, nodes };
}

function sparseOverlayCell(position) {
  const [c, r] = position;
  const [x, z] = shipHexOffset(c, r);
  return { c, r, x, z, key: hexKey(c, r) };
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
  return [];
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
let orbitAnimationFrame = null;
let lastOrbitAnimationRenderMs = 0;
function ensureOrbitAnimation() {
  if (orbitAnimationFrame != null) return;
  const tick = now => {
    orbitAnimationFrame = null;
    const level = path[path.length - 1]?.level;
    const overlayOpen = !startOverlay.hidden || !tutorialGuide.hidden;
    if ((level === "universe" || level === "system") && !tutorialMode && !overlayOpen) {
      if (now - lastOrbitAnimationRenderMs >= 125) {
        lastOrbitAnimationRenderMs = now;
        orbitAnimationSimMs += EARTH_DAY_MS;
        const entry = path[path.length - 1];
        const data = levelData(entry);
        const simulatedNowMs = orbitAnimationSimMs;
        if (entry.level === "universe") renderUniverse(entry, data, simulatedNowMs);
        else if (mapArea.dataset.renderer === "3d" && scene3d) {
          scene3d.updateOrbitalBodies(layoutSystemWithMoons(data, {
            maxPixel: ORBIT_MAX_PX,
            localMaxPixel: LOCAL_MAX_PX,
            nowMs: simulatedNowMs,
          }));
        }
      }
      orbitAnimationFrame = requestAnimationFrame(tick);
    }
  };
  orbitAnimationFrame = requestAnimationFrame(tick);
}
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
  const layout = snapGravityBodiesToHexGrid(
    layoutSystemWithMoons(data, { maxPixel: ORBIT_MAX_PX, localMaxPixel: LOCAL_MAX_PX }),
  );
  syncPlanetEconomy(layout);
  const wells = gravityWells(layout);
  const gravityCells = gravityHexes(layout);
  const bodyCells = [];
  if (layout.center) bodyCells.push({ id: layout.center.id, position: [0, 0], rotation: gravitySpinDirection(layout.center.id), gravityRadius: gravityHexRadius({ bodyRadiusPx: layout.center.rPx, hexSizePx: GRID_HEX_SIZE_PX, factor: GRAVITY_INFLUENCE_RADIUS_FACTOR }) });
  for (const planet of layout.planets) {
    bodyCells.push({ id: planet.id, parentId: layout.center?.id, position: planetHex(planet), rotation: gravitySpinDirection(planet.id), gravityRadius: gravityHexRadius({ bodyRadiusPx: planet.rPx, hexSizePx: GRID_HEX_SIZE_PX, factor: GRAVITY_INFLUENCE_RADIUS_FACTOR }) });
  }
  const transportNetwork = buildTransportNetwork(bodyCells);
  const mergedGravityCells = mergeTransportCells(gravityCells, transportNetwork, (c, r) => shipHexOffset(c, r));
  systemStaticCache = { sourceKey, layout, wells, gravityCells: mergedGravityCells, transportNetwork };
  return systemStaticCache;
}

function renderSystem3D(entry, data, refreshUi = true) {
  mapwrap.style.display = "none";
  mapwrap3d.style.display = "inline-block";
  mapArea.dataset.renderer = "3d";
  const scene = ensureScene3D();
  mapArea.dataset.rendererState = canvas3d.dataset.rendererState;
  const { layout, wells, gravityCells, transportNetwork } = systemStaticData(data, entry.systemId);
  updateGravityHexes(gravityCells);
  recomputeReachableMoves();
  const ships = shipsSnapshot(wells);

  if (scene3dStaticSource !== entry.systemId) {
    scene.rebuildStatic(({ addBody, addRing, addGravityField, addTransportField }) => {
      const arrowsByColor = new Map();
      for (const arrow of gravityPullArrows(gravityCells, wells)) {
        if (!arrowsByColor.has(arrow.colorHex)) arrowsByColor.set(arrow.colorHex, []);
        arrowsByColor.get(arrow.colorHex).push(...arrow.segments);
      }
      for (const [colorHex, group] of buildGravityFieldGroups(
        gravityRenderCells(gravityCells), wells, GRID_HEX_SIZE_PX, gravityHexIntensity,
      )) {
        addGravityField({ ...group, colorHex, arrowSegments: arrowsByColor.get(colorHex) || [] });
      }
      addTransportField(transportFieldGeometry(transportNetwork));
      if (layout.center) {
        addBody({ x: 0, z: 0, radius: layout.center.rPx, color: colorsFor(layout.center).fill, data: layout.center, emissive: true, textureUrl: textureFor(layout.center), spinDirection: gravitySpinDirection(layout.center.id) });
      }
      for (const p of layout.planets) {
        addRing(0, 0, p.orbitRadiusPx, 0, colorsFor(p).fill, p.eccentricity, p.id);
        addBody({
          x: p.x, z: p.y, radius: p.rPx, color: colorsFor(p).fill, data: p,
          textureUrl: textureFor(p), spinDirection: gravitySpinDirection(p.id),
          ownerColorHex: p.ownerFaction ? colorsFor({ faction: p.ownerFaction }).fill : null,
        });
        for (const m of p.moons) {
          addRing(p.x, p.y, m.localRingPx, m.inclinationDeg, colorsFor(m).fill, 0, m.id);
          addBody({ x: m.x, y: m.tiltHeight, z: m.tiltZ, radius: m.rPx, color: colorsFor(m).fill, data: m, textureUrl: textureFor(m) });
        }
      }
    });
    scene3dStaticSource = entry.systemId;
  }

  scene.rebuildDynamic(({ addShip, addTracer, addExplosion }) => {
    for (const s of ships) {
      addShip({
        x: s.x, z: s.y, colorHex: s.colorHex, data: s,
        selected: s.fleetIds.includes(selectedShip), facingDeg: s.facingDeg, isFlag: s.isFlag,
        strength: s.strength, formation: s.formation,
        memberSlots: s.memberSlots, showBase: s.showBase,
        isTarget: s.isTarget, targetColor: s.targetColor, isGroupMember: s.isGroupMember,
        hasActed: s.hasActed,
      });
    }
    // A shot's tracer, fading over time -- see ensureEffectLoop, which owns
    // expiring `effects` and repainting while any are still fading.
    const now = performance.now();
    for (const eff of effects) {
      if (eff.kind === "explosion") {
        const [gridX, gridY] = shipHexOffset(...eff.position);
        const [x, z] = warpedGravityPoint(gridX, gridY, wells);
        addExplosion({ x, z, slotIndex: eff.slotIndex, seed: eff.seed, progress: (now - eff.start) / eff.dur });
        continue;
      }
      const alpha = 1 - (now - eff.start) / eff.dur;
      addTracer({
        from: shipHexOffset(...eff.from), to: shipHexOffset(...eff.to),
        hit: eff.hit, colorHex: eff.colorHex, alpha,
      });
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

  if (refreshUi) {
    renderInfoPanel();
    renderBreadcrumb();
  }
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
  const dx = (ev.clientX - dragState.startClientX) * dragState.scaleX;
  const dy = (ev.clientY - dragState.startClientY) * dragState.scaleY;
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

function renderSystem2D(entry, data, refreshUi = true) {
  mapwrap3d.style.display = "none";
  mapwrap.style.display = "inline-block";
  mapArea.dataset.renderer = "2d";
  mapArea.dataset.rendererState = "active";
  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;
  const ctx = canvas.getContext("2d");
  const cx = canvas.width / 2, cy = canvas.height / 2;

  const { layout, wells, gravityCells } = systemStaticData(data, entry.systemId);
  updateGravityHexes(gravityCells);
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
  for (const { colorHex, x, y, cost } of gravityRenderCells(gravityCells).values()) {
    const corners = gravityHexCorners(x, y, wells)
      .map(([px, py]) => worldToScreen(camera2d, px, py));
    ctx.beginPath();
    corners.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = hexToRgba(colorHex, GRAVITY_HEX_MAX_OPACITY * gravityHexIntensity(cost));
    ctx.fill();
  }

  // A local, body-colored deformation lattice only where gravity exists.
  // Both opacity and stroke weight climb with the same AP-cost gradient as
  // the fill, making the deepest pull around a body read most strongly.
  for (const { colorHex, x, y, cost } of gravityRenderCells(gravityCells).values()) {
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
  for (const cell of sparseOverlay.boardCells) {
    drawOverlayHex(cell, { stroke: "rgba(83,97,124,0.34)" });
  }
  for (const cell of sparseOverlay.transportCells) {
    drawOverlayHex(cell, {
      fill: cell.ambush ? "rgba(255,176,46,0.2)" : "rgba(56,217,255,0.08)",
      stroke: cell.ambush ? "#ffb02e" : "rgba(56,217,255,0.8)",
      lineWidth: cell.ambush ? 2.5 : 1.5,
    });
  }
  for (const line of sparseOverlay.courseLines) {
    const [fromX, fromY] = warpedGravityPoint(line.from.x, line.from.z, wells);
    const [toX, toY] = warpedGravityPoint(line.to.x, line.to.z, wells);
    ctx.beginPath();
    ctx.moveTo(...worldToScreen(camera2d, fromX, fromY));
    ctx.lineTo(...worldToScreen(camera2d, toX, toY));
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = hexToRgba(line.colorHex, 0.8);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const cell of sparseOverlay.commandCells) {
    drawOverlayHex(cell, { fill: hexToRgba(sparseOverlay.colorHex, 0.035), stroke: hexToRgba(sparseOverlay.colorHex, 0.2) });
  }
  for (const cell of sparseOverlay.hoverCells) {
    drawOverlayHex(cell, { stroke: "rgba(136,146,171,0.55)" });
  }
  for (const cell of sparseOverlay.courseCells) {
    drawOverlayHex(cell, { fill: hexToRgba(ACCENT.flagshipArrow, 0.2), stroke: ACCENT.flagshipArrow, lineWidth: 3 });
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

  const drawRing = (ringCx, ringCy, worldRadiusPx, colorHex, eccentricity = 0) => strokeFaintRing(ctx, ringCx, ringCy, worldRadiusPx * camera2d.zoom, colorHex, eccentricity);
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
    if (body.ownerFaction) {
      ctx.beginPath();
      ctx.arc(sx, sy, rPx * 1.45, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1.5, camera2d.zoom);
      ctx.strokeStyle = colorsFor({ faction: body.ownerFaction }).fill;
      ctx.stroke();
    }
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
  // One Fleet occupies one strategic hex. Its Strength is rendered as that
  // many compact, facing-aligned Ships inside the Fleet token; the token
  // remains the single selectable rules entity and click target.
  const drawFleet = (ship, selected) => {
    const [sx, sy] = worldToScreen(camera2d, ship.x, ship.y);
    const s = scaledStrategicShipIconRadius(camera2d.zoom);
    const colorHex = ship.colorHex;
    const tapRadius = Math.max(s * 1.8, 6);
    const corners = hexCorners(sx, sy, s);

    if (ship.showBase) {
      ctx.beginPath();
      corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = hexToRgba(colorHex, SHIP_FILL_ALPHA);
      ctx.fill();
      ctx.lineWidth = selected || ship.isGroupMember ? 2 : 1;
      ctx.strokeStyle = selected ? "#ffffff" : (ship.isGroupMember ? ACCENT.flagshipArrow : colorHex);
      ctx.stroke();
    }

    const miniSize = Math.max(s * 0.3, 1.1);
    const miniSpacing = Math.max(s * 1.05, 3);
    const allSlots = fleetShipPositions({
      x: sx, y: sy, facingDeg: 0, formation: "sphere",
      strength: 57, spacing: miniSpacing,
    });
    for (let i = 0; i < ship.memberSlots.length; i++) {
      const slot = ship.memberSlots[i];
      const [mx, my] = allSlots[slot.slotIndex];
      const [tip, base1, base2] = shipArrowPoints(mx, my, miniSize, ship.facingDeg);
      ctx.beginPath();
      ctx.moveTo(...tip); ctx.lineTo(...base1); ctx.lineTo(...base2);
      ctx.closePath();
      ctx.fillStyle = slot.member.isOriginalFlagship ? ACCENT.flagshipArrow
        : slot.member.state === StrategicShipState.ROUTED ? "#ff3355"
          : slot.member.state === StrategicShipState.SHAKEN ? "#ffd166" : colorHex;
      ctx.fill();
      ctx.strokeStyle = hexToRgba("#ffffff", 0.35);
      ctx.lineWidth = Math.max(0.6, miniSize * 0.2);
      ctx.stroke();
    }
    // A legal fire target for the currently-selected ship (see
    // shipsSnapshot) -- outlined in the *attacker's* own color (not
    // battle/render.js's fixed ACCENT.targetOutline red), so it reads as
    // "who can hit this" and doesn't vanish against a same-colored hull.
    if (ship.showBase && ship.isTarget) {
      ctx.beginPath();
      corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.lineWidth = LINE_WIDTH.targetOutline;
      ctx.strokeStyle = ship.targetColor;
      ctx.stroke();
    }
    return tapRadius;
  };
  if (layout.center) drawDot(layout.center, false);
  for (const p of layout.planets) {
    drawRing(...worldToScreen(camera2d, 0, 0), p.orbitRadiusPx, colorsFor(p).fill, p.eccentricity);
    const [px, py] = drawDot(p, false);
    for (const m of p.moons) {
      drawRing(px, py, m.localRingPx, colorsFor(m).fill);
      drawDot(m, false);
    }
  }
  for (const well of wells) drawCurrentCue(well);
  for (const s of ships) s.hitRPx = drawFleet(s, s.fleetIds.includes(selectedShip));
  // A shot's tracer, fading over time -- see ensureEffectLoop, which owns
  // expiring `effects` and repainting while any are still fading. Same
  // width/halo/duration parity as battle/render.js's own laser effect
  // (LINE_WIDTH/LASER_HALO_ALPHA). The firing faction's color is captured
  // when the effect is created, so the beam remains stable throughout its fade.
  const effNow = performance.now();
  for (const eff of effects) {
    if (eff.kind === "explosion") {
      const progress = Math.max(0, Math.min(1, (effNow - eff.start) / eff.dur));
      const fade = 1 - progress;
      const [gridX, gridY] = shipHexOffset(...eff.position);
      const [worldX, worldY] = warpedGravityPoint(gridX, gridY, wells);
      const [centerX, centerY] = worldToScreen(camera2d, worldX, worldY);
      const s = scaledStrategicShipIconRadius(camera2d.zoom);
      const miniSpacing = Math.max(s * 1.05, 3);
      const slot = fleetShipPositions({
        x: centerX, y: centerY, facingDeg: 0, formation: "sphere",
        strength: 57, spacing: miniSpacing,
      })[eff.slotIndex];
      const radius = 2 + 13 * Math.sin(Math.PI * Math.min(1, progress * 1.15));
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const glow = ctx.createRadialGradient(slot[0], slot[1], 0, slot[0], slot[1], radius);
      glow.addColorStop(0, `rgba(255,245,180,${fade})`);
      glow.addColorStop(0.35, `rgba(255,150,35,${fade * 0.9})`);
      glow.addColorStop(1, "rgba(255,45,20,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(slot[0], slot[1], radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(255,185,55,${fade})`;
      ctx.lineWidth = 1.5;
      for (let index = 0; index < 7; index++) {
        const angle = ((eff.seed * 0.61803398875 + index / 7) % 1) * Math.PI * 2;
        const inner = radius * 0.35;
        const outer = radius * (0.75 + progress * 0.65);
        ctx.beginPath();
        ctx.moveTo(slot[0] + Math.cos(angle) * inner, slot[1] + Math.sin(angle) * inner);
        ctx.lineTo(slot[0] + Math.cos(angle) * outer, slot[1] + Math.sin(angle) * outer);
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    const [fx, fy] = worldToScreen(camera2d, ...shipHexOffset(...eff.from));
    const [tx, ty] = worldToScreen(camera2d, ...shipHexOffset(...eff.to));
    const alpha = Math.max(0, 1 - (effNow - eff.start) / eff.dur);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = eff.colorHex;
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
    const rect = canvas.getBoundingClientRect();
    dragState = {
      startClientX: ev.clientX, startClientY: ev.clientY,
      startCameraX: camera2d.x, startCameraY: camera2d.y,
      scaleX: CANVAS_PX / rect.width, scaleY: CANVAS_PX / rect.height, moved: false,
    };
    canvas.style.cursor = "grabbing";
    clearSystemHover(() => render());
  };
  canvas.oncontextmenu = ev => ev.preventDefault();
  canvas.style.cursor = "grab";

  // Whatever body or ship sits under a given screen point, in the same
  // priority a click resolves it in (ship > star > moon > planet) -- shared
  // by onclick and onmousemove (hover) so they can't drift apart.
  function hitAt(x, y) {
    const within = b => {
      const [sx, sy] = worldToScreen(camera2d, b.x, b.y);
      const tap = b.kind === "fleet-stack" ? b.hitRPx : Math.max(screenRadius(b), 10);
      return Math.hypot(x - sx, y - sy) <= tap;
    };
    return ships.filter(ship => ship.showBase).find(within)
      || (layout.center && within(layout.center) ? layout.center : null)
      || layout.planets.flatMap(p => p.moons).find(within)
      || layout.planets.find(within)
      || null;
  }

  // The map canvas is deliberately displayed as a responsive square while
  // its drawing buffer remains at CANVAS_PX for visual fidelity. Convert
  // pointer coordinates back into that buffer's coordinate space before
  // hit testing, panning, or finding a movement hex.
  const canvasPoint = ev => {
    const rect = canvas.getBoundingClientRect();
    return [
      (ev.clientX - rect.left) * CANVAS_PX / rect.width - cx,
      (ev.clientY - rect.top) * CANVAS_PX / rect.height - cy,
    ];
  };

  canvas.onclick = ev => {
    if (justDragged) { justDragged = false; return; }
    const [x, y] = canvasPoint(ev);
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
    const [x, y] = canvasPoint(ev);
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

  if (refreshUi) {
    renderInfoPanel();
    renderBreadcrumb();
  }
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

function renderSystem(entry, data, refreshUi = true) {
  if (!webglFailed && sceneModuleStatus === "loading") {
    renderSystem2D(entry, data, refreshUi);
    mapArea.dataset.renderer = "loading";
    mapArea.dataset.rendererState = "loading";
    if (!persistentHint) setHint(RENDERER_LOADING_HINT);
    return;
  }
  if (!webglFailed && sceneModuleStatus === "failed") activate2DFallback(sceneModuleError);
  if (!webglFailed) {
    try {
      renderSystem3D(entry, data, refreshUi);
      return;
    } catch (err) {
      activate2DFallback(err);
    }
  } else if (forcedRenderer === "2d" && mapArea.dataset.renderer !== "2d") {
    setHint("2D renderer forced by the URL for fallback testing.");
  }
  renderSystem2D(entry, data, refreshUi);
}

function render() {
  const entry = path[path.length - 1];
  const data = levelData(entry);
  // Fleet controls belong to the System level only. renderInfoPanel()
  // decides whether they are visible for the currently selected Fleet.
  if (entry.level !== "system") infoPanel.style.display = "none";
  turnPanel.style.display = entry.level === "system" && shipsSpawned ? "block" : "none";
  if (entry.level === "system") {
    renderSystem(entry, data);
    renderTurnPanel();
  } else renderUniverse(entry, data);
  updateTutorialActionHighlight();
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
  ensureOrbitAnimation();
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
