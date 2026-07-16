// Board/rule constants and scenario data (rule numbers mirror battle_sim.py;
// the board shape below is web-only -- the Python Monte-Carlo sim still
// plays on its own rectangular grid, so its cited win rates are unaffected).
import { hexDist } from "./hexmath.js";
import { Side, SupplyState, MAX_MOVEMENT_POINTS, MAX_TURNS_PER_ACTIVATION } from "./domain/constants.js";

export {
  MoraleState, SupplyState, FiringArc, Side, SIDES, ControlMode,
  ActivationOrder, DeploymentMode, opposingSide,
} from "./domain/constants.js";

export const RANGE = 3, CMD_R = 4, AP_MAX = MAX_MOVEMENT_POINTS, MP_MAX = AP_MAX, MAX_TURNS = 15;
export { MAX_TURNS_PER_ACTIVATION };

// The playable board is a hexagon (pointy left/right, flat top/bottom):
// all hexes within BOARD_RADIUS of BOARD_CENTER. COLS/ROWS are just the
// bounding box the hexagon is inscribed in -- use inBounds(), not a
// rectangle check, to test whether a hex is actually on the board.
export const COLS = 27, ROWS = 27;
export const BOARD_CENTER = [13, 13], BOARD_RADIUS = 13;
export const inBounds = (c, r) => hexDist(BOARD_CENTER, [c, r]) <= BOARD_RADIUS;

// Anchor columns formationLayout() offsets ("fwd") deploy around, and the
// row ("lat" offsets) they're centered on -- chosen so every existing
// formation at every fleet size stays inside the hexagon on both sides.
export const DEPLOY_ANCHOR = [7, 19], DEPLOY_ROW_CENTER = 13;

export const STATE_NAME = ["Steady", "Shaken", "ROUTED"];

export const HOLD_FORMS = new Set(["sphere"]);

export const sideName = s => s === Side.BLUE ? "Blue" : "Red";
export const sideCls = s => s === Side.BLUE ? "b" : "r"; // matches the #log .b/.r CSS classes in styles.css

export const FORMATION_NAMES = ["line", "spindle", "crescent", "echelon", "sphere", "column"];

// Deployment zones: each side may only place squadrons in its own half,
// leaving a neutral no-man's-land in the middle columns.
export const SETUP_ZONE = [[0, 9], [17, COLS - 1]];

// Hex pixel geometry (canvas rendering).
export const HS = 17;                    // hex size (center -> corner)
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
 {t:"Low-supply mirror", a:"line", b:"line", supB:SupplyState.LOW,
  n:"Red is low on supply (v0.2: −1 morale only, guns unaffected). Sim: 66/34 — a clear but playable handicap. Can you win from behind?"},
 {t:"Main Fleet hunt (mirror)", a:"line", b:"line",
  n:"Mirror match. Destroy the enemy Main Fleet — Armada-wide morale check, permanent −1, command radius gone."},
 {t:"Critical-supply mirror", a:"line", b:"line", supB:SupplyState.CRITICAL,
  n:"Red is at critical supply (−1 morale AND worse to-hit — the old v0.1 'low'). Sim: 96/3. Near-hopeless by design: never fight like this."},
];
