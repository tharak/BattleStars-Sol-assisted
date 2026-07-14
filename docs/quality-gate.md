# BattleStars quality gate

BattleStars uses one repository quality contract locally and in CI. Each layer catches a different class of regression at the cheapest useful boundary.

## Layers

| Layer | Command | Purpose |
|---|---|---|
| Targeted feedback | `node --test test/<file>.test.js` | Fast iteration on one behavior |
| Syntax | `npm run check:syntax` | Parse every JavaScript and script module |
| Headless suite | `npm test` | Rules, ECS integration, lifecycle, parity, and architecture guards |
| Production build | `npm run build` | Bundle all three pages, local Three.js, and hashed texture assets into `dist/` |
| Browser suite | `npm run test:browser` | Build and exercise tactical, real WebGL, low-quality, bundle-failure, and 2D fallback paths on desktop/mobile Chromium |
| Full gate | `npm run gate` | Run diff hygiene and every automated layer in sequence |

## Full local gate

Run this before describing an implementation as ready:

```bash
npm run gate
```

The gate stops at the first failure and preserves each command's real exit code. `npm run test:browser` builds before Playwright starts Vite's production preview server. `.github/workflows/ci.yml` installs the same locked dependencies and Chromium, invokes the same gate, and deploys the resulting verified `dist/` artifact to GitHub Pages.

GitHub repository settings must use **Settings → Pages → Build and deployment → Source: GitHub Actions**. Branch-based Pages publishing would expose the unbundled source instead of the verified `dist/` artifact.

## Architecture guards

`test/architecture.test.js` turns repository boundaries into executable rules. It checks:

- the local JavaScript dependency graph stays acyclic;
- gameplay and lifecycle modules remain host-agnostic;
- headless rules do not draw randomness or time from ambient globals;
- Three.js remains isolated behind `map/scene3d.js`.

When an architectural invariant changes, update the documentation and its guard test in the same contribution.

## Visual judgment

Automated browser tests prove that the bundled Three.js renderer—not merely the fallback—boots, handles context events, and loads without runtime CDN requests. They still do not prove visual quality. For player-visible changes, inspect the relevant page manually and attach evidence to the pull request.

Check desktop and phone-sized viewports. For strategic rendering changes, inspect the Three.js path and reason through or force the 2D fallback. Verify that visual quality settings and effects do not hide gameplay information.

## Keep the gate proportional

The prototype remains framework-free, but browser delivery intentionally uses a small Vite build so Three.js is reproducible and GitHub Pages receives a tested artifact. Add tooling only when it protects a concrete risk; prefer small deterministic scripts and existing Node capabilities over a larger application framework.
