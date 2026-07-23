# JavaScript and Python rule parity

`battle_sim.py` is a standalone Monte Carlo baseline, not a binding implementation for the browser. It intentionally duplicates tactical rules so simulations remain dependency-free and reproducible from Python.

## Duplicated rules

| Rule | JavaScript owner | Python owner | Parity expectation |
|---|---|---|---|
| Odd-r/axial conversion, distance, neighbors | `battle/hexmath.js` | top-level hex helpers | Same |
| Angles, incoming arcs, firing arc, seam handling | `battle/hexmath.js` | top-level geometry helpers | Same |
| Line of sight and shooter-favored edge choice | `battle/hexmath.js` | `los_clear` | Same |
| Morale states and modifiers | `domain/moraleRules.js`, `systems.js` | `Battle.morale_check` | Same |
| Formation layouts and sphere facing | `battle/formations.js` | `formation_layout`, `deploy` | Same relative layouts |
| Combat dice, target numbers, supply effects | `domain/combatRules.js`, `systems.js` | `Battle.fire` | Same |
| Destruction, contagion, and flagship checks | `core/shipRules.js`, `systems.js` | `Battle.destroy`, `contagion` | Same event/rule order |
| Target selection and AI tie-breaking | `queries.js`, `systems.js` | `pick_target`, `activate` | Same |
| Routing, rallying, and fleeing | `systems.js` | `flee`, `activate` | Same |
| Alternating activation opener | `domain/activationRules.js` | `Battle.run` | Same |
| Break threshold | `domain/victoryRules.js` | `Battle.__init__` | Same: `floor(size/2)+1` |
| Strength scoring at the time limit | `domain/victoryRules.js` | `Battle.run` | Same calculation |

## Intentional differences

| Area | Shared JavaScript rules | Python simulator | Reason |
|---|---|---|---|
| Board | Radius-13 hexagon in a 27×27 bounding box | 24×18 rectangle | Web board was changed independently; published simulation baselines retain their original board |
| Deployment anchors | Columns 7/19, row 13 | Columns 5/18, row 9 | Match each board geometry |
| Time limit | 15 turns | 40 turns | Python allows benchmark battles to terminate naturally; paper/browser victory uses 15 |
| Backward movement | Implemented; costs all 3 AP | Not implemented | Baseline AI never retreats, so its outcomes are unaffected |
| RNG algorithm | `MathRandomSource`, Mulberry32 seeded source, or exact sequence | `random.Random` | Deterministic within each runtime, not cross-language identical |
| Extra modes | Manual/fixed deployment, hotseat, spectate, side-at-once | Alternating AI only | Browser playtest features |
| Strategic gravity | Gravity currents on `map.html` | Absent | Strategic-map-only rules |

## Drift policy

- Changes to shared rules require JavaScript tests and a full `python3 battle_sim.py --trials 400 --seed 42` run.
- Intentional differences above should not be “fixed” into parity unless the game design changes explicitly.
- Cross-language tests should compare small rule fixtures or aggregate documented results, not raw seeded streams, because the RNG algorithms differ.
- Formation/scenario data should remain visibly mirrored until a real shared data format is justified; adding a cross-language build step only to remove this small duplication would increase complexity without changing authority.
