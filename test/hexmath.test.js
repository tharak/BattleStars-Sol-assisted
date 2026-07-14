import test from "node:test";
import assert from "node:assert/strict";

import {
  hexDist, neighbor, directionToward, incomingArc, inFireArc, losClear, key,
} from "../battle/hexmath.js";

test("hex distance is symmetric across odd-r rows", () => {
  const cases = [
    [[10, 10], [10, 10], 0],
    [[10, 10], [11, 10], 1],
    [[10, 10], [10, 8], 2],
    [[3, 5], [12, 11], 12],
  ];
  for (const [a, b, expected] of cases) {
    assert.equal(hexDist(a, b), expected);
    assert.equal(hexDist(b, a), expected);
  }
});

test("neighbor returns the six adjacent odd-r hexes", () => {
  const origin = [10, 10];
  assert.deepEqual(
    Array.from({ length: 6 }, (_, direction) => neighbor(origin, direction)),
    [[11, 10], [10, 9], [9, 9], [9, 10], [9, 11], [10, 11]],
  );
  for (let direction = 0; direction < 6; direction++) {
    assert.equal(hexDist(origin, neighbor(origin, direction)), 1);
  }
});

test("direction toward a target selects the nearest of six hex facings", () => {
  const origin = [10, 10];
  for (let direction = 0; direction < 6; direction++) {
    assert.equal(directionToward(origin, neighbor(origin, direction)), direction);
  }
  assert.equal(directionToward([10, 10], [0, 10]), 3);
  assert.equal(directionToward([0, 10], [10, 10]), 0);
});

test("fire arcs classify front, flank, and rear without changing seam rules", () => {
  const target = [10, 10];
  assert.equal(incomingArc(target, 0, [11, 10]), "front");
  assert.equal(incomingArc(target, 0, [9, 9]), "flank");
  assert.equal(incomingArc(target, 0, [9, 10]), "rear");

  assert.equal(inFireArc(0, target, [10, 9]), true);
  assert.equal(inFireArc(0, target, [10, 11]), true);
  assert.equal(inFireArc(0, target, [9, 9]), false);
});

test("line of sight is blocked by intermediate ships", () => {
  const from = [10, 10];
  const to = [13, 10];
  assert.equal(losClear(from, to, new Set()), true);
  assert.equal(losClear(from, to, new Set([key(11, 10)])), false);
  assert.equal(losClear(from, to, new Set([key(12, 10)])), false);
});

test("line of sight along a hex edge lets the shooter choose the clear side", () => {
  const from = [10, 10];
  const to = [11, 11];
  assert.equal(losClear(from, to, new Set([key(11, 10)])), true);
  assert.equal(losClear(from, to, new Set([key(10, 11)])), true);
  assert.equal(losClear(from, to, new Set([key(11, 10), key(10, 11)])), false);
});
