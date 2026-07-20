import test from "node:test";
import assert from "node:assert/strict";
import {
  createPlayableTutorialMap, nextPlayableTutorialStep,
  PLAYABLE_TUTORIAL_FLEET_DISTANCE, PLAYABLE_TUTORIAL_FLEET_SHIPS,
  PLAYABLE_TUTORIAL_MAP_RADIUS, PLAYABLE_TUTORIAL_STEPS,
  STRATEGIC_TUTORIAL_GROUPS, tutorialMechanicCount,
} from "../map/tutorials.js";
import { hexDist } from "../battle/hexmath.js";

test("strategic tutorials group a complete, uniquely-addressable mechanic catalog", () => {
  assert.deepEqual(STRATEGIC_TUTORIAL_GROUPS.map(group => group.id), [
    "command", "navigation", "fleets", "combat", "economy",
  ]);
  const tutorialIds = STRATEGIC_TUTORIAL_GROUPS.flatMap(group => group.tutorials.map(tutorial => tutorial.id));
  assert.equal(new Set(tutorialIds).size, tutorialIds.length);
  assert.ok(tutorialMechanicCount() >= 50);
  assert.ok(STRATEGIC_TUTORIAL_GROUPS.every(group => group.tutorials.length >= 3));
});

test("playable tutorial is a short, ordered sequence of player actions", () => {
  assert.equal(PLAYABLE_TUTORIAL_STEPS[0].event, "fleet-selected");
  assert.equal(PLAYABLE_TUTORIAL_STEPS.at(-1).event, "ended");
  assert.equal(new Set(PLAYABLE_TUTORIAL_STEPS.map(step => step.id)).size, PLAYABLE_TUTORIAL_STEPS.length);
  assert.ok(PLAYABLE_TUTORIAL_STEPS.every(step => step.message.length <= 32));
  assert.ok(PLAYABLE_TUTORIAL_STEPS.every(step => step.event === "course-set" || step.target));
  assert.deepEqual(PLAYABLE_TUTORIAL_STEPS.filter(step => step.event === "turned").map(step => step.target), ["turn"]);
});

test("playable tutorial advances only when the requested action succeeds", () => {
  assert.equal(nextPlayableTutorialStep(PLAYABLE_TUTORIAL_STEPS, 0, "forward"), 0);
  assert.equal(nextPlayableTutorialStep(PLAYABLE_TUTORIAL_STEPS, 0, "fleet-selected"), 1);
  assert.equal(nextPlayableTutorialStep(PLAYABLE_TUTORIAL_STEPS, 1, "fleet-selected"), 1);
  assert.equal(nextPlayableTutorialStep(PLAYABLE_TUTORIAL_STEPS, 1, "forward"), 2);
  assert.equal(nextPlayableTutorialStep(PLAYABLE_TUTORIAL_STEPS, PLAYABLE_TUTORIAL_STEPS.length, "ended"), PLAYABLE_TUTORIAL_STEPS.length);
});

test("playable tutorial map centers a radius-10 board on Earth", () => {
  const earth = [12, -7];
  const map = createPlayableTutorialMap(earth);

  assert.deepEqual(map.center, earth);
  assert.equal(map.radius, PLAYABLE_TUTORIAL_MAP_RADIUS);
  assert.equal(map.cells.length, 1 + 3 * PLAYABLE_TUTORIAL_MAP_RADIUS * (PLAYABLE_TUTORIAL_MAP_RADIUS + 1));
  assert.ok(map.cells.every(cell => map.contains(cell)));
  assert.ok(map.cells.some(cell => hexDist(earth, cell) === PLAYABLE_TUTORIAL_MAP_RADIUS));
  assert.equal(map.contains([earth[0] + 20, earth[1]]), false);
});

test("playable tutorial places three 10-ship Fleets three hexes from Earth", () => {
  const earth = [0, 0];
  const map = createPlayableTutorialMap(earth);

  assert.equal(map.fleets.length, 3);
  assert.equal(map.fleets.filter(fleet => fleet.isFlagship).length, 1);
  assert.ok(map.fleets.every(fleet => fleet.shipCount === PLAYABLE_TUTORIAL_FLEET_SHIPS));
  assert.ok(map.fleets.every(fleet => hexDist(earth, fleet.position) === PLAYABLE_TUTORIAL_FLEET_DISTANCE));
  assert.equal(new Set(map.fleets.map(fleet => fleet.position.join(","))).size, 3);
});
