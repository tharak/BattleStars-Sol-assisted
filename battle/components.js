// Component key constants. Every module spells a component the same way
// via these instead of raw strings, so a typo is a ReferenceError, not a
// silently-empty query.
export const Position = "Position";           // {c, r}
export const Facing = "Facing";                // {dir}            0..5, see hexmath.DIR_ANGLE
export const Side = "Side";                    // {value}          0 (Blue) | 1 (Red)
export const Strength = "Strength";            // {value}          0..4
export const Morale = "Morale";                // {state}          MoraleState.STEADY|SHAKEN|ROUTED
export const Label = "Label";                  // {id}             display id, e.g. "B3"
export const Flagship = "Flagship";            // tag, presence-only
export const Alive = "Alive";                  // tag, presence-only -- removed on destroy/flee-off-map
export const Activated = "Activated";          // tag, presence-only -- has acted this turn
export const HitSinceAct = "HitSinceAct";      // tag, presence-only -- gates the routed rally-check
