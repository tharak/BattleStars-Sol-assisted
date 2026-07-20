// Strategic tutorial copy is data, not DOM. Keeping the catalog here makes
// coverage reviewable and lets future guided scenarios reuse the same lessons.
export const STRATEGIC_TUTORIAL_GROUPS = Object.freeze([
  Object.freeze({
    id: "command",
    title: "Command & Turns",
    description: "How a faction turn works and how Fleets spend Action Points.",
    tutorials: Object.freeze([
      Object.freeze({ id: "turn-cycle", title: "Rounds and faction turns", mechanics: Object.freeze([
        "Each participating faction takes one turn during the round.",
        "A Fleet normally activates once during its faction turn.",
        "In games with multiple human players, the one-minute turn clock forfeits AP for Fleets that have not acted when it expires.",
      ]) }),
      Object.freeze({ id: "actions", title: "Selecting and acting", mechanics: Object.freeze([
        "Select a ready Fleet from the map stack or the Armada roster.",
        "Movement spends AP; turning is free but limited to two turns per activation.",
        "Forward movement can be combined with firing, while moving astern spends all remaining AP.",
        "End Activation commits the Fleet and allows another ready Fleet to act.",
      ]) }),
      Object.freeze({ id: "facing", title: "Facing and armored arcs", mechanics: Object.freeze([
        "Every Fleet faces one of the six hex directions.",
        "The thick edge of its base marks its strongest front armor; side and rear arcs are easier to hit.",
      ]) }),
    ]),
  }),
  Object.freeze({
    id: "navigation",
    title: "Navigation & Gravity",
    description: "Manual routes, persistent courses, command groups, and orbital currents.",
    tutorials: Object.freeze([
      Object.freeze({ id: "manual-movement", title: "Manual movement", mechanics: Object.freeze([
        "Highlighted hexes show every destination reachable with the Fleet's remaining AP.",
        "A route turns and moves step by step; Fleets never teleport.",
        "Friendly Fleets may share or pass through a hex, but enemy Fleets block movement.",
        "Shaken Ships refuse movement that closes the distance to the nearest enemy.",
      ]) }),
      Object.freeze({ id: "courses", title: "Set Course", mechanics: Object.freeze([
        "Set Course stores a target hex and draws a straight line to it.",
        "At the start of each owner turn the Fleet spends AP following the best legal route toward that target.",
        "Cancel Course removes the target without moving the Fleet.",
      ]) }),
      Object.freeze({ id: "command-groups", title: "Flagship command groups", mechanics: Object.freeze([
        "An original flagship can move ready friendly Fleets within its command range as a group.",
        "Group routes preserve formation offsets and must be legal for every participating Fleet.",
        "The group pays the most expensive member route and gravity may separate it after movement.",
      ]) }),
      Object.freeze({ id: "gravity", title: "Gravity currents", mechanics: Object.freeze([
        "The Sun and planets pull Fleets inside their colored gravity fields.",
        "Stopping in a gravity hex causes one free automatic drift in the arrow's direction.",
        "Gravity applies after movement and can push a Fleet into a crowded or dangerous hex.",
      ]) }),
    ]),
  }),
  Object.freeze({
    id: "fleets",
    title: "Fleets & Stacking",
    description: "Individual Ships, Fleet organization, shared hexes, and collisions.",
    tutorials: Object.freeze([
      Object.freeze({ id: "ship-members", title: "Ships and Fleet Strength", mechanics: Object.freeze([
        "A Fleet contains individual Ships; each Ship tracks health and morale.",
        "Fleet Strength is the sum of its surviving Ships' effective Strength.",
        "Ready Ships contribute full health, Shaken Ships half health, and Routed Ships no Strength.",
        "A Fleet may contain at most 57 Ships: three formation levels of 19.",
      ]) }),
      Object.freeze({ id: "shared-hexes", title: "Shared Fleet hexes", mechanics: Object.freeze([
        "Friendly Fleets can occupy one hex and mix their Ships across the same 57 visible positions.",
        "Different tones of the faction color identify which Fleet owns each Ship.",
        "Click the shared base repeatedly to cycle through ready friendly Fleets in that hex.",
      ]) }),
      Object.freeze({ id: "split-merge", title: "Split and merge", mechanics: Object.freeze([
        "Split detaches 19 Ships from a Fleet above 19 Ships.",
        "At 19 Ships or fewer, Split divides the Fleet in half; weaker Ships detach first and extra flagships are prioritized.",
        "Co-located friendly Fleets can merge while the resulting Fleet remains at or below 57 Ships.",
        "Splitting or merging spends all remaining AP for every involved Fleet.",
      ]) }),
      Object.freeze({ id: "collisions", title: "Ship collisions", mechanics: Object.freeze([
        "A hex safely holds at most 57 Ships across all Fleets and factions.",
        "Ending movement above that limit destroys Ships round-robin, beginning with the moving Fleets.",
        "A surviving Ship in every affected Fleet makes a morale check after the collision.",
      ]) }),
    ]),
  }),
  Object.freeze({
    id: "combat",
    title: "Combat & Morale",
    description: "Stack attacks, directional damage, morale checks, and routed retreats.",
    tutorials: Object.freeze([
      Object.freeze({ id: "firing", title: "Firing at a hex", mechanics: Object.freeze([
        "A firing Fleet rolls one die for every point of effective Strength, rounded up.",
        "When several enemy Fleets share the target hex, each die chooses a Fleet weighted by its Ship count.",
        "The target number depends on the chosen Fleet's front, flank, or rear arc; misses cause no damage.",
        "Each hit deals 0.1 damage to one Ship.",
      ]) }),
      Object.freeze({ id: "directional-damage", title: "Directional damage", mechanics: Object.freeze([
        "Ships exposed on the formation edge facing the attacker are more likely to take damage.",
        "A damaged surviving Ship makes one morale check after the volley.",
        "Destroyed Ships disappear from formation and produce an explosion at their former slot.",
      ]) }),
      Object.freeze({ id: "morale", title: "Ready, Shaken, and Routed", mechanics: Object.freeze([
        "Failed morale changes Ready to Shaken, then Shaken to Routed on another failure.",
        "Friendly Ready Ships and the original flagship's command range improve morale checks.",
        "Flank and rear damage make morale harder, and failures can test one Ship in every friendly Fleet within two hexes.",
        "Shaken Ships test to rally at the start of their faction turn.",
      ]) }),
      Object.freeze({ id: "routing", title: "Routing and recovery", mechanics: Object.freeze([
        "Routed Ships detach into a separate Routed Fleet and cannot receive normal orders.",
        "At the start of their faction turn, Routed Ships retreat one hex astern and then suffer gravity and collision effects.",
        "They may retest only inside the surviving original flagship's command range.",
        "Recovered Ships become Shaken and rejoin the original flagship when Fleet and hex capacity allow.",
      ]) }),
    ]),
  }),
  Object.freeze({
    id: "economy",
    title: "Planets, Production & Conquest",
    description: "How controlled bodies create Ships and how ownership changes.",
    tutorials: Object.freeze([
      Object.freeze({ id: "resources", title: "Planet resources", mechanics: Object.freeze([
        "Every planet has a resource value based on the same size scale used by its gravity pull, with a minimum of one.",
        "A controlled planet creates one new Fleet every owner turn with Ships equal to that resource value.",
        "New Fleets spawn beyond the planet's gravity field on the side facing the Sun.",
      ]) }),
      Object.freeze({ id: "conquest", title: "Conquering planets", mechanics: Object.freeze([
        "A friendly Fleet adjacent to an uncontrolled or enemy planet may begin conquest.",
        "Conquest immediately commits Ships equal to the planet's resource value, taking weaker non-flagship Ships first.",
        "Control transfers after ten rounds for every point of resource value.",
        "Once control transfers, the planet begins producing Fleets for its new owner.",
      ]) }),
      Object.freeze({ id: "starting-empires", title: "Game setup", mechanics: Object.freeze([
        "A New Game creates the selected number of player and NPC Armadas.",
        "Every participating Armada begins with its established Fleets and one original flagship.",
        "Each participating faction begins with an established starting planet; the first active planet immediately produces its turn's Fleet.",
      ]) }),
    ]),
  }),
]);

import { directionToward, hexDist, neighbor } from "../battle/hexmath.js";
import { hexPatch } from "./strategicMovement.js";

export const PLAYABLE_TUTORIAL_MAP_RADIUS = 10;
export const PLAYABLE_TUTORIAL_FLEET_COUNT = 3;
export const PLAYABLE_TUTORIAL_FLEET_SHIPS = 10;
export const PLAYABLE_TUTORIAL_FLEET_DISTANCE = 3;

function hexAtDistance(origin, direction, distance) {
  let position = [...origin];
  for (let step = 0; step < distance; step++) position = neighbor(position, direction);
  return position;
}

// A compact, host-agnostic training board. The browser adapter supplies
// Earth's current logical hex so the scenario remains centered on the real
// planet in both the Three.js view and the 2D fallback.
export function createPlayableTutorialMap(earthPosition) {
  if (!Array.isArray(earthPosition) || earthPosition.length !== 2) return null;
  const center = [...earthPosition];
  const fleets = Array.from({ length: PLAYABLE_TUTORIAL_FLEET_COUNT }, (_, index) => {
    const position = hexAtDistance(center, index * 2, PLAYABLE_TUTORIAL_FLEET_DISTANCE);
    return Object.freeze({
      position: Object.freeze(position),
      facing: directionToward(position, center),
      shipCount: PLAYABLE_TUTORIAL_FLEET_SHIPS,
      isFlagship: index === 0,
    });
  });
  return Object.freeze({
    center: Object.freeze(center),
    radius: PLAYABLE_TUTORIAL_MAP_RADIUS,
    cells: Object.freeze(hexPatch(center, PLAYABLE_TUTORIAL_MAP_RADIUS).map(cell => Object.freeze(cell))),
    fleets: Object.freeze(fleets),
    contains(position) {
      return hexDist(center, position) <= PLAYABLE_TUTORIAL_MAP_RADIUS;
    },
  });
}

// The playable scenario deliberately reveals one short instruction at a time.
// Its three activations use the three starting Fleets in turn, teaching the
// round rhythm without requiring hidden tutorial-only turn exceptions.
export const PLAYABLE_TUTORIAL_STEPS = Object.freeze([
  Object.freeze({ id: "select-first", event: "fleet-selected", target: "ready-fleet", title: "Select your Fleet", message: "Click a Fleet near Earth." }),
  Object.freeze({ id: "approach-one", event: "forward", target: "forward", title: "Approach Earth", message: "Move Forward toward Earth." }),
  Object.freeze({ id: "approach-two", event: "forward", target: "forward", title: "Close with Earth", message: "Move Forward once more." }),
  Object.freeze({ id: "conquer", event: "conquered", target: "conquer", title: "Conquer Earth", message: "Click Conquer Earth." }),
  Object.freeze({ id: "select-second", event: "fleet-selected", target: "ready-fleet", title: "Select another Fleet", message: "Choose a ready Fleet." }),
  Object.freeze({ id: "turn", event: "turned", target: "turn", title: "Turn the Fleet", message: "Click either Turn button." }),
  Object.freeze({ id: "forward", event: "forward", target: "forward", title: "Move forward", message: "Click Forward." }),
  Object.freeze({ id: "end-second", event: "ended", target: "end", title: "End the activation", message: "Click End Activation." }),
  Object.freeze({ id: "select-third", event: "fleet-selected", target: "ready-fleet", title: "Select the last Fleet", message: "Choose the final ready Fleet." }),
  Object.freeze({ id: "course-arm", event: "course-armed", target: "course", title: "Set a course", message: "Click Set Course." }),
  Object.freeze({ id: "course-target", event: "course-set", title: "Choose a destination", message: "Click any distant hex." }),
  Object.freeze({ id: "end", event: "ended", target: "end", title: "End the final activation", message: "Click End Activation." }),
]);

export function nextPlayableTutorialStep(steps, index, event) {
  return steps[index]?.event === event ? index + 1 : index;
}

export function tutorialMechanicCount(groups = STRATEGIC_TUTORIAL_GROUPS) {
  return groups.reduce((total, group) => total
    + group.tutorials.reduce((groupTotal, tutorial) => groupTotal + tutorial.mechanics.length, 0), 0);
}
