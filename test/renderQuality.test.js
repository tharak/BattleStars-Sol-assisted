import test from "node:test";
import assert from "node:assert/strict";
import { chooseGraphicsQuality, GraphicsQuality } from "../map/renderQuality.js";

test("graphics quality falls back on software, legacy, mobile, and constrained devices", () => {
  assert.equal(chooseGraphicsQuality({ rendererName: "Google SwiftShader" }), GraphicsQuality.LOW);
  assert.equal(chooseGraphicsQuality({ isWebGL2: false }), GraphicsQuality.LOW);
  assert.equal(chooseGraphicsQuality({ coarsePointer: true }), GraphicsQuality.LOW);
  assert.equal(chooseGraphicsQuality({ deviceMemory: 4 }), GraphicsQuality.LOW);
  assert.equal(chooseGraphicsQuality({ hardwareConcurrency: 4 }), GraphicsQuality.LOW);
});

test("graphics quality keeps capable hardware high and honors explicit preferences", () => {
  const capable = {
    rendererName: "NVIDIA GeForce RTX", isWebGL2: true, maxTextureSize: 16384,
    deviceMemory: 16, hardwareConcurrency: 12, coarsePointer: false,
  };
  assert.equal(chooseGraphicsQuality(capable), GraphicsQuality.HIGH);
  assert.equal(chooseGraphicsQuality(capable, "low"), GraphicsQuality.LOW);
  assert.equal(chooseGraphicsQuality({ rendererName: "SwiftShader" }, "high"), GraphicsQuality.HIGH);
});
