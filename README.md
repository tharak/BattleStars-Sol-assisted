# BattleStars Prototype

Browser and Monte Carlo prototypes for a fleet tactics game intended for a later Unreal Engine implementation.

## Run

```bash
npm ci
npx playwright install chromium
npm run serve
```

Open `http://localhost:8000/battle.html` for the tactical battle or `http://localhost:8000/map.html` for the strategic map.

`npm run serve` starts Vite's development server. `npm run build` creates the exact production bundle in `dist/`; `npm run preview` serves that bundle locally.

## Develop

Use targeted Node tests while iterating, then run the repository gate before calling a change ready:

```bash
npm run gate
```

The gate checks JavaScript syntax, the full headless test suite and architecture invariants, builds the production bundle, then exercises the real 3D renderer and 2D fallback in desktop and mobile Chromium profiles. UI/browser failures are reported as warnings by default; syntax, headless, architecture, and build failures still block deployment. CI runs the same command and deploys the `dist/` artifact to GitHub Pages. See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/quality-gate.md](docs/quality-gate.md).

## Architecture

The tactical prototype has an explicit composition root and one-way dependency flow:

- `battle/main.js`: browser composition root; constructs the context, RNG, events, orchestrator, and presentation.
- `battle/gameContext.js`: mutable aggregate for one match; exports no singleton.
- `battle/domain/`: named constants and pure combat, morale, movement, activation-order, and victory calculations.
- `battle/lifecycle/`: focused ECS/lifecycle mutations for battle setup, deployment, turns, and activations.
- `battle/battleOrchestrator.js`: sequences lifecycle operations and receives scheduling/render invalidation as dependencies.
- `battle/core/phaseMachine.js`: explicit menu/deployment/combat/game-over state machine.
- `battle/controller.js`: command boundary for player intent.
- `battle/ecs.js`, `components.js`: entity/component data model.
- `battle/systems.js`, `core/shipRules.js`: headless ECS mutation adapters and AI systems.
- `battle/core/events.js`: observer/event bus for semantic gameplay events.
- `battle/core/random.js`: injected random strategy for deterministic tests and replays.
- `battle/presenter.js`, `render.js`, `panels.js`: browser-only presentation.
- `map/scene3d.js`: dynamically loaded Three.js adapter with adaptive quality and context recovery.
- `map/gravityField.js`, `map/renderQuality.js`: pure geometry and renderer-policy helpers.
- `battle/config.js`, `formations.js`: data-driven rules and setup templates.

Rules flow inward: browser input issues commands, the orchestrator invokes lifecycle/system functions, pure rules calculate outcomes, ECS adapters apply them, and presentation observes semantic events. Automated architecture tests prevent circular dependencies, keep headless logic away from browser APIs and ambient randomness, and isolate Three.js behind the strategic scene adapter.

See [docs/architecture.md](docs/architecture.md), [docs/js-python-rule-parity.md](docs/js-python-rule-parity.md), [docs/unreal-porting-guide.md](docs/unreal-porting-guide.md), and [unreal-reference](unreal-reference).
