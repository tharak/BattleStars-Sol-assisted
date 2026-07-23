# BattleStars Prototype

Browser and Monte Carlo prototypes for a fleet tactics game intended for a later Unreal Engine implementation.

## Run

```bash
npm ci
npx playwright install chromium
npm run serve
```

Open `http://localhost:8000/map.html` for the strategic game.

`npm run serve` starts Vite's development server. `npm run build` creates the exact production bundle in `dist/`; `npm run preview` serves that bundle locally.

## Develop

Use targeted Node tests while iterating, then run the repository gate before calling a change ready:

```bash
npm run gate
```

The gate checks JavaScript syntax, the full headless test suite and architecture invariants, builds the production bundle, then exercises the real 3D renderer and 2D fallback in desktop and mobile Chromium profiles. UI/browser failures are reported as warnings by default; syntax, headless, architecture, and build failures still block deployment. CI runs the same command and deploys the `dist/` artifact to GitHub Pages. See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/quality-gate.md](docs/quality-gate.md).

## Architecture

The strategic map is the sole game screen. Shared rules and rendering helpers remain in `battle/` as host-agnostic modules used by the map:

- `battle/domain/`: pure combat, morale, movement, captain, and victory calculations.
- `battle/core/shipRules.js`: shared Fleet and Ship state transitions.
- `battle/formations.js`, `battle/fleetShips.js`, `battle/hexmath.js`: Fleet geometry and deterministic hex helpers.
- `map/scene3d.js`: dynamically loaded Three.js adapter with adaptive quality and context recovery.
- `map/gravityField.js`, `map/renderQuality.js`: pure geometry and renderer-policy helpers.
- `battle/config.js`, `formations.js`: shared data-driven rules and setup templates.

Rules flow inward from the strategic map controller into pure calculations and shared Fleet state transitions. Automated architecture tests prevent circular dependencies, keep headless logic away from browser APIs and ambient randomness, and isolate Three.js behind the strategic scene adapter.

See [docs/architecture.md](docs/architecture.md), [docs/js-python-rule-parity.md](docs/js-python-rule-parity.md), [docs/unreal-porting-guide.md](docs/unreal-porting-guide.md), and [unreal-reference](unreal-reference).
