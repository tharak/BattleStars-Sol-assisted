# BattleStars architecture

## Runtime composition

`map/main.js` is the sole browser composition root. It owns the strategic world and
random source while reusing shared ship rules, formations, geometry, and pure
movement calculations. There is no separate tactical battle screen.

## Dependency direction

```text
browser composition / input / presentation
                 |
                 v
       strategic ECS adapters
                 |
                 v
          pure domain rules
```

Domain modules never import browser globals or Three.js. Strategic presentation
reads state and delegates gameplay decisions to the shared rule modules.

`test/architecture.test.js` enforces both the browser boundary and an acyclic JavaScript import graph.

## Module responsibilities

### Pure domain

- `domain/constants.js`: sides, phases, supply states, firing arcs, morale states, control modes, deployment modes, and activation orders.
- `domain/combatRules.js`: dice count, target number, and injected-RNG hit resolution.
- `domain/moraleRules.js`: modifiers, injected-RNG checks/rallies, and morale transitions.
- `domain/movementRules.js`: activation eligibility, movement costs, and shaken-step validation.
- `domain/activationRules.js`: human-control decisions and activation ordering.
- `domain/victoryRules.js`: break thresholds and victory evaluation.

These modules accept plain values and return plain results. They do not know about ECS stores, events, or the DOM.

### Gameplay adapters

- `core/shipRules.js`: reads the ECS, calls pure rules, applies ship-level mutations, and invokes semantic hooks.
- `formations.js`: formation templates and standard unit creation.

### Strategic rendering

- `map/main.js` dynamically loads `scene3d.js`, coordinates renderer state, and owns the explicit 2D fallback.
- `map/scene3d.js` is the only Three.js importer. It retains static bodies, gravity, and rings separately from dynamic ships and tracers, tracks context loss/restoration, and exposes renderer diagnostics without deciding gameplay.
- `map/gravityField.js` builds deduplicated gravity geometry as pure data.
- `map/strategicEconomy.js` derives planet yield, conquest timing, and safe production placement from plain strategic values; tuning lives in `map/strategicBalance.js`.
- `map/strategicFleetActions.js` owns pure merge/split value calculations and friendly-stacking movement policy; `map/main.js` remains the thin ECS/UI adapter.
- `map/tutorials.js` owns the tutorial catalog and the pure radius-10 Earth training-board fixture; `map/main.js` only anchors and renders that fixture.
- `map/renderQuality.js` chooses the low/high presentation tier from explicit capability signals.
- Vite bundles Three.js and textures locally. The production browser tests require real WebGL startup and separately force the 2D and module-load-failure paths.

## Behavioral safeguards

The test suite covers hex distance and neighbors, firing arcs and LOS edge choice,
movement costs, deterministic combat and morale, flagship loss, strategic turns,
RNG reproducibility, rendering policy, and dependency boundaries.

Numeric and string values used by existing HTML controls and scenario data were retained when introducing named constants. No formation, scenario, balance value, turn limit, or board geometry was intentionally changed.
