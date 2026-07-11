// Board/rule constants and scenario data (mirror battle_sim.py
// exactly). Pure data -- no ECS or DOM coupling.

export const COLS = 24, ROWS = 18, RANGE = 3, CMD_R = 4, MP_MAX = 3, MAX_TURNS = 15;

export const MoraleState = Object.freeze({ STEADY: 0, SHAKEN: 1, ROUTED: 2 });
export const STATE_NAME = ["Steady", "Shaken", "ROUTED"];

export const HOLD_FORMS = new Set(["sphere"]);

export const sideName = s => s === 0 ? "Blue" : "Red";
export const sideCls = s => s === 0 ? "b" : "r"; // matches the #log .b/.r CSS classes in styles.css

export const FORMATION_NAMES = ["line", "spindle", "crescent", "echelon", "sphere", "column"];

// Deployment zones: each side may only place squadrons in its own half,
// leaving a neutral no-man's-land in the middle columns.
export const SETUP_ZONE = [[0, 8], [15, COLS - 1]];

// Hex pixel geometry (canvas rendering).
export const HS = 19;                    // hex size (center -> corner)
export const HW = HS * Math.sqrt(3);     // hex width
export const OX = 26, OY = 26;

export const SCENARIOS = [
 {t:"Spindle vs Wide Line", a:"spindle", b:"line",
  n:"THE key test. The dumb AI loses this 26/74 — it can't exploit a breakthrough. Can you pierce the line and win with maneuver?"},
 {t:"Wide Line vs Crescent", a:"line", b:"crescent",
  n:"The wheel predicts the line's massed arcs win; the sim says crescent 64/36. Settle it."},
 {t:"Crescent vs Spindle", a:"crescent", b:"spindle",
  n:"Wrap the wedge, rake its flanks. Sim: crescent 55/45 with dumb hands."},
 {t:"Echelon vs Spindle", a:"echelon", b:"spindle",
  n:"Refuse a flank, deflect the punch into a flank trade. Sim: echelon 64/36."},
 {t:"Sphere vs Crescent", a:"sphere", b:"crescent",
  n:"Survival formation in the wrong context on purpose. Score = turns survived, not wins."},
 {t:"Wide Line vs Column (sanity)", a:"line", b:"column",
  n:"Travel order should be slaughtered. If Column ever wins, something is broken."},
 {t:"Low-supply mirror", a:"line", b:"line", supB:"low",
  n:"Red is low on supply (v0.2: −1 morale only, guns unaffected). Sim: 66/34 — a clear but playable handicap. Can you win from behind?"},
 {t:"Flagship hunt (mirror)", a:"line", b:"line",
  n:"Mirror match. Try decapitation: kill the enemy flagship — fleet-wide morale check, permanent −1, command radius gone."},
 {t:"Critical-supply mirror", a:"line", b:"line", supB:"critical",
  n:"Red is at critical supply (−1 morale AND worse to-hit — the old v0.1 'low'). Sim: 96/3. Near-hopeless by design: never fight like this."},
];
