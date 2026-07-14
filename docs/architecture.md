# BattleStars architecture

## Runtime composition

`battle/main.js` is the tactical browser composition root. It explicitly creates:

- a `GameContext` for mutable match state;
- a `MathRandomSource` and `EventBus`;
- presentation-only effect state;
- a `BattleOrchestrator` with injected refresh and scheduling functions;
- the controller, DOM input adapter, presenter, panels, and canvas renderer.

No module exports a shared game-state instance. Tests create isolated contexts with seeded or exact-sequence random sources and no DOM.

The strategic map has its own composition root in `map/main.js`. It owns a separate ECS world and random source while reusing ship rules, formations, geometry, and pure movement-cost calculations.

## Dependency direction

```text
browser composition / input / presentation
                 |
                 v
        BattleOrchestrator
                 |
                 v
       lifecycle + ECS systems
                 |
                 v
          pure domain rules
```

Domain and lifecycle modules never import `render.js`, `panels.js`, or browser globals. Systems emit semantic events; `presenter.js` translates those events into log entries, overlays, and transient visual effects. The orchestrator only knows a generic `refresh` callback and scheduler.

`test/architecture.test.js` enforces both the browser boundary and an acyclic JavaScript import graph.

## State ownership

`GameContext` owns authoritative tactical state:

- the ECS `World`;
- match configuration and selected scenario;
- fleets, turn state, activation state, and deployment state;
- phase machine;
- injected RNG and event bus.

Presentation state such as laser effects and the auto-step interval is browser-owned and is not stored in `GameContext`.

## Module responsibilities

### Pure domain

- `domain/constants.js`: sides, phases, supply states, firing arcs, morale states, control modes, deployment modes, and activation orders.
- `domain/combatRules.js`: dice count, target number, and injected-RNG hit resolution.
- `domain/moraleRules.js`: modifiers, injected-RNG checks/rallies, and morale transitions.
- `domain/movementRules.js`: activation eligibility, movement costs, and shaken-step validation.
- `domain/activationRules.js`: human-control decisions and activation ordering.
- `domain/victoryRules.js`: break thresholds and victory evaluation.

These modules accept plain values and return plain results. They do not know about ECS stores, events, or the DOM.

### ECS and gameplay adapters

- `core/shipRules.js`: reads the ECS, calls pure rules, applies ship-level mutations, and invokes semantic hooks.
- `systems.js`: adds tactical-fleet concerns such as supply, flagship loss, forced rout facing, AI, events, and activation bookkeeping.
- `queries.js`: read-only ECS and roster adapters.
- `formations.js`: formation templates and standard unit creation.

### Lifecycle and orchestration

- `lifecycle/battleLifecycle.js`: match initialization, fixed deployment, combat entry, and completion.
- `lifecycle/deploymentLifecycle.js`: manual deployment mutations.
- `lifecycle/turnLifecycle.js`: turn resets, side selection, outcome queries, and activation marking.
- `lifecycle/activationLifecycle.js`: player unit selection and action execution.
- `battleOrchestrator.js`: sequences those modules, AI scheduling, phase handoffs, and refresh requests.

### Presentation

- `controller.js` translates a small command vocabulary to orchestrator calls.
- `input.js` translates browser events into controller commands.
- `presenter.js` observes semantic game events.
- `render.js` and `panels.js` read current state and update the browser.

## Behavioral safeguards

The test suite covers hex distance and neighbors, firing arcs and LOS edge choice, movement costs, deterministic combat and morale, contagion, flagship loss, activation ordering, break thresholds, victory conditions, lifecycle integration, RNG reproducibility, and dependency boundaries.

Numeric and string values used by existing HTML controls and scenario data were retained when introducing named constants. No formation, scenario, balance value, turn limit, or board geometry was intentionally changed.
