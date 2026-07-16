import test from "node:test";
import assert from "node:assert/strict";

import {
  blocksFleetMovement, mergedFleetValues, mergeSurvivorId, splitFleetValues,
} from "../map/strategicFleetActions.js";

test("friendly Fleets do not block movement but enemies do", () => {
  assert.equal(blocksFleetMovement("blue", "blue"), false);
  assert.equal(blocksFleetMovement("blue", "red"), true);
});

test("merging combines Strength and preserves every flagship", () => {
  assert.deepEqual(mergedFleetValues([
    { strength: 20, flagshipCount: 1 },
    { strength: 19.8, flagshipCount: 2 },
  ]), { strength: 39.8, flagshipCount: 3 });
  assert.equal(mergedFleetValues([
    { strength: 40, flagshipCount: 1 },
    { strength: 18, flagshipCount: 0 },
  ]), null);
});

test("a flagship Fleet survives regardless of which Fleet initiates the merge", () => {
  assert.equal(mergeSurvivorId([
    { id: 8, flagshipCount: 0 },
    { id: 3, flagshipCount: 1 },
  ]), 3);
  assert.equal(mergeSurvivorId([
    { id: 8, flagshipCount: 0 },
    { id: 3, flagshipCount: 2 },
    { id: 5, flagshipCount: 1 },
  ]), 3);
  assert.equal(mergeSurvivorId([{ id: 8, flagshipCount: 0 }, { id: 3, flagshipCount: 0 }]), 8);
});

test("splitting divides Strength and puts flagships in both halves when possible", () => {
  assert.deepEqual(splitFleetValues({ strength: 39.8, flagshipCount: 3 }), {
    retained: { strength: 19.9, flagshipCount: 2 },
    detached: { strength: 19.9, flagshipCount: 1 },
  });
  assert.deepEqual(splitFleetValues({ strength: 40, flagshipCount: 1 }), {
    retained: { strength: 20, flagshipCount: 1 },
    detached: { strength: 20, flagshipCount: 0 },
  });
  assert.equal(splitFleetValues({ strength: 1.9, flagshipCount: 2 }), null);
});
