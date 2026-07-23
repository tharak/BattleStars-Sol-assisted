// Canvas rendering. Reads component data via queries.js and colors via
// colors.js -- never mutates game state.
import { COLS, ROWS, RANGE, CMD_R, HS, HW, OX, OY, BATTLE_PLANETS, MoraleState, inBounds } from "./config.js";
import { DIR_ANGLE, hexDist, losClear, inFireArc, key, facingArrowPoints, hexCorners } from "./hexmath.js";
import { inSetupZone } from "./formations.js";
import { SIDE_COLORS, STATE_COLORS, ACCENT, BOARD_TINT } from "./colors.js";
import { LINE_WIDTH, LASER_HALO_ALPHA } from "./dimensions.js";
import { makeEffectLoop } from "./core/effectLoop.js";
import * as Q from "./queries.js";

const { SHAKEN, ROUTED } = MoraleState;

const cv = document.getElementById("cv"), cx2 = cv.getContext("2d");

export function hexCenter(c, r) { return [OX + (c + 0.5 * (r & 1)) * HW, OY + r * HS * 1.5]; }
export function pixelToHex(x, y) {
  let best = null, bd = 1e9;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!inBounds(c, r)) continue;
    const [hx, hy] = hexCenter(c, r), d = (hx - x) ** 2 + (hy - y) ** 2;
    if (d < bd) { bd = d; best = [c, r]; }
  }
  return bd <= (HS * 1.05) ** 2 ? best : null;
}
function hexPath(x, y, s) {
  cx2.beginPath();
  hexCorners(x, y, s).forEach(([px, py], k) => (k ? cx2.lineTo(px, py) : cx2.moveTo(px, py)));
  cx2.closePath();
}

// draw() is a thin wrapper: renderFrame() paints one frame, and whenever
// there's an active transient effect (currently just laser beams, pushed by
// systems.fire()) it also keeps a requestAnimationFrame loop alive to fade
// them out over subsequent frames -- callers everywhere else just call
// draw() once per action exactly as before and get the animation for free.
// The loop mechanics themselves are shared with the star map's own
// tracer-fade loop -- see core/effectLoop.js.
const ensureEffectLoop = makeEffectLoop();
export function draw(state, presentation) {
  renderFrame(state, presentation);
  ensureEffectLoop({
    pruneExpired: now => { presentation.effects = presentation.effects.filter(e => now - e.start < e.dur); },
    hasEffects: () => presentation.effects.length > 0,
    repaint: () => renderFrame(state, presentation),
  });
}

function renderFrame(state, presentation) {
  cv.width = OX * 2 + HW * (COLS + 0.5); cv.height = OY * 2 + HS * 1.5 * (ROWS - 1) + HS * 2;
  cx2.fillStyle = BOARD_TINT.bg; cx2.fillRect(0, 0, cv.width, cv.height);

  // Keep the tactical board visually connected to the strategic map without
  // making planets selectable or changing any combat occupancy rules.
  for (const planet of BATTLE_PLANETS) {
    const [x, y] = hexCenter(...planet.position);
    const glow = cx2.createRadialGradient(x, y, planet.radius * 0.2, x, y, planet.radius * 1.8);
    glow.addColorStop(0, `${planet.color}aa`);
    glow.addColorStop(0.55, `${planet.color}33`);
    glow.addColorStop(1, `${planet.color}00`);
    cx2.fillStyle = glow;
    cx2.beginPath(); cx2.arc(x, y, planet.radius * 1.8, 0, Math.PI * 2); cx2.fill();
    cx2.fillStyle = planet.color;
    cx2.beginPath(); cx2.arc(x, y, planet.radius, 0, Math.PI * 2); cx2.fill();
    cx2.strokeStyle = `${planet.color}cc`; cx2.lineWidth = 1.5; cx2.stroke();
    cx2.fillStyle = "#e9efff"; cx2.font = "11px system-ui"; cx2.textAlign = "center";
    cx2.fillText(planet.name, x, y + planet.radius + 15);
  }

  // fire-zone shading for selected human unit
  let zone = new Set(), tgts = [];
  const act = state.act;
  if (act && act.u != null) {
    tgts = Q.canFire(state) ? Q.legalTargets(state, act.u) : [];
    const occ = Q.occupiedSet(state);
    const pos = Q.posOf(state, act.u), facing = Q.facingOf(state, act.u);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const p = [c, r];
      if (inBounds(c, r) && hexDist(pos, p) <= RANGE && hexDist(pos, p) > 0
          && inFireArc(facing, pos, p) && losClear(pos, p, occ)) zone.add(key(c, r));
    }
  }
  // grid
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!inBounds(c, r)) continue;
    const [x, y] = hexCenter(c, r);
    hexPath(x, y, HS - 0.6);
    cx2.fillStyle = zone.has(key(c, r)) ? BOARD_TINT.fireZone : BOARD_TINT.gridCell;
    cx2.fill();
    cx2.strokeStyle = BOARD_TINT.gridLine; cx2.lineWidth = LINE_WIDTH.grid; cx2.stroke();
  }
  if (!state.G) return;

  // manual deployment overlay: zone tint + placed ships (drawn in addition to
  // the normal unit loop below, so an already-confirmed side's real units
  // still show up while the other side is still placing, in hotseat).
  const setup = state.setup;
  if (setup) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!inBounds(c, r) || !inSetupZone(setup.side, c)) continue;
      const [x, y] = hexCenter(c, r);
      hexPath(x, y, HS - 0.6);
      cx2.fillStyle = BOARD_TINT.setupZone(setup.side);
      cx2.fill();
    }
    for (const p of setup.placed) {
      const [x, y] = hexCenter(p.pos[0], p.pos[1]);
      hexPath(x, y, HS - 3.5);
      cx2.fillStyle = SIDE_COLORS[setup.side]; cx2.fill();
      cx2.strokeStyle = p === setup.flagShip ? ACCENT.flagshipArrow : ACCENT.labelText;
      cx2.lineWidth = p === setup.flagShip ? LINE_WIDTH.setupFlagshipBorder : LINE_WIDTH.setupShipBorder;
      cx2.stroke();
      if (p === setup.selected) { hexPath(x, y, HS - 1); cx2.strokeStyle = ACCENT.selectionOutline; cx2.lineWidth = LINE_WIDTH.setupSelectionOutline; cx2.stroke(); }
      const [tip, base1, base2] = facingArrowPoints(x, y, HS, DIR_ANGLE[p.facing]);
      cx2.beginPath();
      cx2.moveTo(...tip); cx2.lineTo(...base1); cx2.lineTo(...base2);
      cx2.closePath(); cx2.fillStyle = p === setup.flagShip ? ACCENT.flagshipArrow : ACCENT.labelText; cx2.fill();
      if (p === setup.flagShip) {
        cx2.fillStyle = ACCENT.labelText; cx2.font = "bold 9px system-ui"; cx2.textAlign = "center";
        cx2.fillText("★", x, y + 3);
      }
    }
  }

  // command reach: painted hexes (hex-accurate), not a circle -- a circle at
  // radius CMD_R over-includes/under-includes corner hexes vs the actual
  // hexDist<=CMD_R test everything else (inCommand()) uses.
  for (const s of [0, 1]) {
    const fl = Q.flagshipOf(state, s);
    if (fl === null) continue;
    const flPos = Q.posOf(state, fl);
    const tint = BOARD_TINT.commandReach(s);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!inBounds(c, r) || hexDist(flPos, [c, r]) > CMD_R) continue;
      const [x, y] = hexCenter(c, r);
      hexPath(x, y, HS - 0.6);
      cx2.fillStyle = tint; cx2.fill();
    }
  }

  // units
  for (const side of [0, 1]) for (const e of Q.aliveOfSide(state, side)) {
    const [x, y] = hexCenter(...Q.posOf(state, e));
    const morale = Q.moraleOf(state, e), activated = Q.isActivated(state, e);
    hexPath(x, y, HS - 3.5);
    // Fill is always the squadron's faction color -- state is shown purely
    // via the border. Precedence when more than one applies: routed >
    // shaken > activated > steady (see colors.js).
    cx2.fillStyle = SIDE_COLORS[side];
    cx2.fill();
    const stateKey = morale === ROUTED ? "routed" : (morale === SHAKEN ? "shaken" : (activated ? "activated" : "steady"));
    cx2.strokeStyle = STATE_COLORS[stateKey];
    cx2.lineWidth = LINE_WIDTH.stateBorder;
    cx2.stroke();
    if (act && act.u === e) { hexPath(x, y, HS - 1); cx2.strokeStyle = ACCENT.selectionOutline; cx2.lineWidth = LINE_WIDTH.selectionOutline; cx2.stroke(); }
    if (tgts.includes(e)) { hexPath(x, y, HS - 1); cx2.strokeStyle = ACCENT.targetOutline; cx2.lineWidth = LINE_WIDTH.targetOutline; cx2.stroke(); }
    // facing arrow -- gold for the flagship (also keeps it from blending
    // into the ★ label, which is drawn in the same dark color as a plain
    // arrow would be) so it doubles as an at-a-glance flagship marker.
    const isFlag = Q.isFlagship(state, e);
    const [tip, base1, base2] = facingArrowPoints(x, y, HS, DIR_ANGLE[Q.facingOf(state, e)]);
    cx2.beginPath();
    cx2.moveTo(...tip); cx2.lineTo(...base1); cx2.lineTo(...base2);
    cx2.closePath(); cx2.fillStyle = isFlag ? ACCENT.flagshipArrow : ACCENT.labelText; cx2.fill();
    // label + flagship star
    cx2.fillStyle = ACCENT.labelText; cx2.font = "bold 9px system-ui"; cx2.textAlign = "center";
    cx2.fillText(isFlag ? "★" : Q.labelOf(state, e).slice(1), x, y + 3);
    // strength pips
    const strength = Q.strengthOf(state, e);
    for (let i = 0; i < 4; i++) {
      cx2.beginPath(); cx2.arc(x - 9 + i * 6, y + HS - 8, 2, 0, 7);
      cx2.fillStyle = i < strength ? ACCENT.pipFilled : ACCENT.pipEmpty; cx2.fill();
    }
  }

  // Fire effects are created by the event presenter and faded here, so
  // gameplay systems never own animation state -- see ensureEffectLoop.
  const now = performance.now();
  for (const eff of presentation.effects) {
    if (eff.type !== "laser") continue;
    const t = (now - eff.start) / eff.dur;
    if (t >= 1) continue;
    const [x1, y1] = hexCenter(eff.from[0], eff.from[1]);
    const [x2, y2] = hexCenter(eff.to[0], eff.to[1]);
    cx2.save();
    cx2.globalAlpha = 1 - t;
    cx2.strokeStyle = SIDE_COLORS[eff.side];
    cx2.lineWidth = eff.hit ? LINE_WIDTH.laserHit : LINE_WIDTH.laserMiss;
    cx2.beginPath(); cx2.moveTo(x1, y1); cx2.lineTo(x2, y2); cx2.stroke();
    if (eff.hit) { cx2.globalAlpha = (1 - t) * LASER_HALO_ALPHA; cx2.lineWidth = LINE_WIDTH.laserHitHalo; cx2.stroke(); }
    cx2.restore();
  }
}
