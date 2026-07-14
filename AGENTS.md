# BattleStars development guide

This file is the repository-wide working contract for coding agents and contributors.

## Start safely

1. Run `git status --short --branch` before editing and preserve unrelated work.
2. Read the implementation, its tests, and the relevant architecture documentation before changing behavior.
3. Prefer `rg` and targeted reads. Do not rely on remembered file inventories.
4. Never discard, stage, commit, push, or change remote state unless the user explicitly authorizes it.

## Repository map

- `battle/domain/`: pure rules over plain values. No ECS, DOM, renderer, or ambient randomness.
- `battle/core/shipRules.js`: shared headless ship rules used by tactical and strategic play.
- `battle/lifecycle/`: focused tactical lifecycle mutations.
- `battle/systems.js`, `battle/queries.js`: tactical ECS adapters and AI.
- `battle/battleOrchestrator.js`: tactical sequencing and refresh scheduling.
- `battle/controller.js`, `battle/input.js`: player-intent and DOM-input boundaries.
- `battle/render.js`, `battle/panels.js`, `battle/presenter.js`: tactical presentation.
- `map/main.js`: strategic-map composition coordinator and browser integration.
- `map/strategicMovement.js`: pure strategic movement search and route execution vocabulary.
- `map/scene3d.js`: Three.js scene implementation behind the strategic scene interface.
- `test/`: Node unit, integration, characterization, and architecture tests.
- `e2e/`: Playwright smoke tests against the real browser pages.
- `scripts/`: deterministic repository checks.
- `docs/`: architecture, parity, porting, and quality documentation.

## Load-bearing architecture

- Gameplay rules flow inward: browser input -> controller/orchestrator -> lifecycle/ECS adapters -> pure rules.
- `battle/domain/` and other headless gameplay modules must not import DOM or Three.js code.
- Random gameplay outcomes use an injected random source. Do not call `Math.random`, `Date.now`, or `performance.now` in gameplay logic.
- Tactical and strategic play share `battle/core/shipRules.js`; do not fork rule behavior between screens.
- Renderers read state and display outcomes. Presentation effects may use wall-clock time but never decide gameplay.
- The strategic map supports Three.js and a 2D fallback. A map-rendering change must account for both paths.
- `map/main.js` is a coordinator, not the default home for new logic. Put host-agnostic math or decisions in a small tested sibling module.
- Browser delivery goes through the locked Vite build. Keep Three.js local to the bundle, preserve all three HTML entry points, and test the generated `dist/` output rather than raw source files.

`test/architecture.test.js` enforces the most important dependency, host-boundary, and determinism rules.

## Change workflow

- Keep changes focused and avoid unrelated refactors.
- Add or update decisive tests whenever behavior changes.
- Reproduce bugs with a failing test when the relevant logic can be exercised headlessly.
- Prefer pure-core plus thin-browser-adapter designs for new UI or rendering behavior.
- Keep dependencies small and justify new packages with a concrete repository need.
- Use scoped Conventional Commits when a commit is requested, for example `fix(map): align gravity overlays`.

## Verification contract

Use targeted tests while iterating. Before calling an implementation complete, run:

```bash
npm run gate
```

The gate checks diff hygiene, parses every JavaScript module, runs Node tests and architecture guards, builds the production bundle, then runs the real-browser suite on desktop and mobile Chromium profiles. The strategic suite must prove real WebGL startup separately from the intentional 2D fallback. CI runs the same command and deploys that verified bundle.

For player-visible work, also inspect the changed interaction manually. Check desktop and a phone-sized viewport. Strategic rendering changes must consider both the primary 3D scene and the 2D fallback. Record any check that could not be run.
