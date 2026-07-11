// The one piece of shared *mutable* game state, as a single object.
//
// ES modules only let the declaring module reassign an exported `let` --
// every other module that imports it only sees a live *read* binding. Since
// nearly every system needs to reassign things like "the current human
// activation" or "the whole battle state" from wherever the triggering
// event happened, we give every module the same object reference and have
// them all write to its *properties* (`State.G = {...}`) instead.
import { World } from "./ecs.js";

export const State = {
  world: new World(),
  G: null,          // battle state: {turn, lastActed, roundFirst, over, winner, fleets:[{name,supply,flagLost,roster}]}
  scen: null,
  ctrlMode: 0,
  SIZE: 9,
  BREAK_AT: 5,
  moveMode: 0,       // 0=interleaved (one squadron at a time, alternating sides), 1=all-at-once (one side fully activates, then the other)
  deployMode: 0,     // 0=manual placement (human sides place by hand, AI gets a random formation), 1=battle formation (both sides use the scenario's fixed formation, like spectate)
  act: null,         // human activation {u:entity, mp, moved, fired, fireMode, side, cmd}
  autoTimer: null,
  setup: null,       // active manual deployment: {side, placed:[{pos,facing}], selected, flagShip} -- plain staging objects, not yet entities
  setupQueue: [],    // remaining human-controlled sides still needing manual deployment
  effects: [],       // transient visual effects, e.g. {type:"laser", from:[c,r], to:[c,r], side, hit, start, dur} -- pushed by systems.js, drawn+expired by render.js
};
