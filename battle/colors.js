// All canvas/board color config lives here, in one place, so retuning the
// palette never means hunting for inline hex strings inside render.js.
// Mirrors (but does not read from) the CSS custom properties in styles.css.

// Side 1 ("Red" in every menu label/status text/log line -- that naming is
// unrelated to this hex fill color) renders green on the board.
export const SIDE_COLORS = { 0: "#4a9eff", 1: "#4cd97b" };

const DARK = "#0b0e14"; // also used for label text/arrows below -- the board's near-black

// A squadron's hex fill is always its faction's SIDE_COLORS -- state is
// shown entirely via the border color, one explicit entry per state here.
// Steady gets its own dark accent (not the side color) so its border is
// always visibly distinct from the fill -- a same-color border would be
// invisible no matter how thick it's drawn. Precedence when more than one
// applies (e.g. a Shaken squadron that already acted this turn): routed >
// shaken > activated > steady, applied in render.js.
export const STATE_COLORS = {
  steady:    DARK,
  shaken:    "#ffd166", // yellow
  routed:    "#ff3333", // red
  activated: "#8892ab", // grey
};

export const ACCENT = {
  flagshipArrow: "#ffd166",
  selectionOutline: "#ffffff",
  targetOutline: "#ff3333",
  labelText: DARK,   // squadron id / flagship star / non-flagship arrow fill
  pipFilled: "#ffffff",
  pipEmpty: "#ffffff33",
};

export const BOARD_TINT = {
  bg: "#0b0e14",
  gridCell: "#111624",
  gridLine: "#1d2438",
  fireZone: "#26203a",
  commandReach: side => side === 0 ? "#4a9eff1c" : "#4cd97b1c",
  setupZone:    side => side === 0 ? "#4a9eff14" : "#4cd97b14",
};
