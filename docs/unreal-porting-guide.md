# Unreal Porting Guide

## Class mapping

| Prototype | Unreal destination | Responsibility |
|---|---|---|
| `GameContext` | `ABattleGameMode` + replicated `ABattleGameState` | Authoritative match lifecycle, dependencies, and replicated public state |
| `PhaseMachine` | `EBattlePhase` on `ABattleGameState` | Explicit deployment/combat/game-over transitions |
| `BattleController` | `ABattlePlayerController` | Translate Enhanced Input actions into validated server commands |
| ECS unit components | `ASquadronActor` and `UActorComponent`s | Position, facing, strength, morale, flagship state |
| `domain/*Rules.js` + `systems.js` | `UBattleRulesSubsystem` or focused components | Calculate and apply movement, fire, morale, command, and destruction |
| `EventBus` | multicast delegates or Gameplay Message Router | Decouple VFX, audio, UI, telemetry, and rules |
| Injected `RandomSource` | seeded `FRandomStream` owned by authority | Deterministic dice, replays, and multiplayer consistency |
| `config.js` | `UPrimaryDataAsset` / Data Tables | Tunable rule values, formations, scenarios, and balance data |
| `queries.js` | subsystem queries / actor interfaces | Read-only derived state and target selection |
| `BattleOrchestrator` + lifecycle modules | `ABattleGameMode` | Sequence deployment, turns, activations, and victory checks |
| `presenter.js` | HUD/ViewModels/Niagara/audio listeners | Turn semantic events into presentation |

## Recommended ownership

Keep rule resolution server-authoritative. `ABattlePlayerController` sends intent such as move, rotate, or fire; `ABattleGameMode` validates turn ownership; `UBattleRulesSubsystem` resolves the rule with its `FRandomStream`; `ABattleGameState` and squadron actors replicate results. Clients create VFX and UI from replicated state or gameplay messages, never by deciding hits locally.

Do not port the JavaScript ECS mechanically unless profiling justifies it. Unreal already provides actor/component composition. Preserve the component boundaries and semantic events, while representing a squadron as an actor with focused components such as `UHealthComponent`, `UMoraleComponent`, and `UCommandLinkComponent`.

## Port order

1. Copy `unreal-reference/BattleTypes.h` and `BattleRulesSubsystem.*` into the Unreal module and adjust the API macro if the project name changes.
2. Move numeric constants and scenario definitions into Primary Data Assets.
3. Implement `ASquadronActor` with replicated unit state and a stable unit ID.
4. Port pure hex functions from `battle/hexmath.js` and cover them with Unreal Automation Tests.
5. Port fire and morale resolution first; compare seeded outcomes against the JavaScript tests.
6. Add the turn GameMode and PlayerController command RPCs.
7. Bind HUD, Niagara, and audio to semantic result delegates.

`FRandomStream` and the JavaScript seeded generator do not produce identical streams. For replay files that must cross engines, record resolved commands and die values, or implement one documented cross-language generator in both projects.
