# BattleStars Prototype

Browser and Monte Carlo prototypes for a fleet tactics game intended for a later Unreal Engine implementation.

## Run

```bash
npm test
npm run serve
```

Open `http://localhost:8000/battle.html` for the tactical battle or `http://localhost:8000/map.html` for the strategic map.

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
- `battle/config.js`, `formations.js`: data-driven rules and setup templates.

Rules flow inward: browser input issues commands, the orchestrator invokes lifecycle/system functions, pure rules calculate outcomes, ECS adapters apply them, and presentation observes semantic events. Automated architecture tests prevent circular dependencies and imports from domain/lifecycle code into DOM-facing modules.

See [docs/architecture.md](docs/architecture.md), [docs/js-python-rule-parity.md](docs/js-python-rule-parity.md), [docs/unreal-porting-guide.md](docs/unreal-porting-guide.md), and [unreal-reference](unreal-reference).
