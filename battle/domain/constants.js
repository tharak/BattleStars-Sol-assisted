// Stable domain vocabulary. Values intentionally match the prototype's
// existing serialized/UI values so this refactor does not change behavior.

export const Side = Object.freeze({
  BLUE: 0,
  RED: 1,
});
export const SIDES = Object.freeze([Side.BLUE, Side.RED]);
export const opposingSide = side => side === Side.BLUE ? Side.RED : Side.BLUE;

export const BattlePhase = Object.freeze({
  MENU: "menu",
  DEPLOYMENT: "deployment",
  COMBAT: "combat",
  GAME_OVER: "game_over",
});

export const SupplyState = Object.freeze({
  NORMAL: "ok",
  LOW: "low",
  CRITICAL: "critical",
});

export const FiringArc = Object.freeze({
  FRONT: "front",
  FLANK: "flank",
  REAR: "rear",
});

export const ControlMode = Object.freeze({
  PLAY_BLUE: 0,
  PLAY_RED: 1,
  HOTSEAT: 2,
  SPECTATE: 3,
});

export const ActivationOrder = Object.freeze({
  INTERLEAVED: 0,
  SIDE_AT_ONCE: 1,
});

export const DeploymentMode = Object.freeze({
  MANUAL: 0,
  FIXED_FORMATION: 1,
});

export const MoraleState = Object.freeze({
  STEADY: 0,
  SHAKEN: 1,
  ROUTED: 2,
});

export const MAX_MOVEMENT_POINTS = 3;
