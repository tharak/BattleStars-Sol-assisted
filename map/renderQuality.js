export const GraphicsQuality = Object.freeze({ LOW: "low", HIGH: "high" });

export function chooseGraphicsQuality(signals, preference = "auto") {
  if (preference === GraphicsQuality.LOW || preference === GraphicsQuality.HIGH) return preference;
  const name = String(signals.rendererName || "");
  const constrained = /swiftshader|llvmpipe|software/i.test(name)
    || signals.isWebGL2 === false
    || (signals.maxTextureSize || Infinity) < 4096
    || (signals.deviceMemory || Infinity) <= 4
    || (signals.hardwareConcurrency || Infinity) <= 4
    || signals.coarsePointer === true;
  return constrained ? GraphicsQuality.LOW : GraphicsQuality.HIGH;
}
