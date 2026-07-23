# Contributing to BattleStars

BattleStars is a browser-based strategic fleet-game prototype, backed by a headless rules engine and a Monte Carlo simulator. Focused fixes, tests, documentation, playtesting reports, and gameplay proposals are welcome.

## Set up the project

You need Node.js 22 or newer, npm, and a Chromium build for Playwright. Python 3 is optional unless you are running the standalone Monte Carlo simulator.

```bash
npm ci
npx playwright install chromium
npm run serve
```

Open `http://localhost:8000/map.html` for the strategic map.

## Make a change

1. Create a focused `feature/<slug>` or `fix/<slug>` branch.
2. Read [the architecture guide](docs/architecture.md) and the tests around the code you will change.
3. Keep gameplay decisions in pure modules and browser work in thin adapters.
4. Add or update tests for changed behavior.
5. Use targeted tests while iterating, then run the complete gate:

```bash
npm run gate
```

The local gate is the same quality contract used by CI: diff hygiene, JavaScript syntax, unit and architecture tests, a production Vite build, and desktop/mobile browser tests for real WebGL and the 2D fallback.

## Architecture rules

- `battle/domain/` contains pure calculations over plain values.
- Random gameplay results use injected random sources.
- Tactical and strategic screens share the same ship-rule engine.
- Renderers present state and effects; they do not decide outcomes.
- Strategic visual changes must preserve both the Three.js and 2D fallback paths.
- Three.js is an npm dependency bundled by Vite; do not reintroduce runtime CDN imports.
- New logic should be a small tested module rather than another responsibility added to a coordinator.

See [docs/architecture.md](docs/architecture.md) for the complete dependency model and [docs/quality-gate.md](docs/quality-gate.md) for verification guidance.

## Player-visible changes

For controls, layout, canvas, or WebGL work:

- test a desktop viewport;
- test a phone-sized viewport;
- verify keyboard interaction where applicable;
- consider both strategic renderers;
- include before/after screenshots or a short recording in the pull request.

## Pull requests

Keep pull requests small enough to review. Explain what changed and why, list exact commands and manual checks, and call out any verification you could not run. Use the pull request checklist and link the motivating issue when one exists.

Commit messages and pull request titles should use scoped Conventional Commits, such as:

```text
feat(map): add reachable movement overlays
fix(battle): preserve out-of-command fire restrictions
test(rules): cover shaken movement ties
```
