// Pure hex/geometry math. Operates only on [c,r] pixel-offset coordinate
// pairs and plain numbers -- no ECS or game-state coupling at all.
import { FiringArc } from "./domain/constants.js";

export const S32 = Math.sqrt(3) / 2;
export const CUBE_DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
export const DIR_ANGLE = [0,-60,-120,180,120,60];

export const key = (c, r) => c + "," + r;

// The 3 points of a facing-arrow triangle for a directional token (a
// squadron, a formation-preview ship): tip pointing at angleDeg, base
// swept back at +-149 degrees. Shared by every canvas that draws one
// (battle/render.js's units, map/main.js's formation preview) so this
// trig only exists once; each caller still does its own beginPath/fill
// since drawing is DOM-coupled and this module deliberately isn't.
export function facingArrowPoints(x, y, hs, angleDeg) {
  const a = angleDeg * Math.PI / 180;
  return [
    [x + Math.cos(a) * (hs - 4), y + Math.sin(a) * (hs - 4)],
    [x + Math.cos(a + 2.6) * (hs - 11), y + Math.sin(a + 2.6) * (hs - 11)],
    [x + Math.cos(a - 2.6) * (hs - 11), y + Math.sin(a - 2.6) * (hs - 11)],
  ];
}

// A ship token's own hex reads its facing off the token's shape itself,
// no separate arrow needed: the single edge pointing exactly toward
// facingDeg is drawn thickest (front, best-armored side), the opposite
// edge thinnest (rear, most vulnerable), and the 4 side edges in between
// (flank). A pointy-top hex's *edges* (not its vertices) point along
// exactly the same 6 directions DIR_ANGLE already uses -- corner k sits
// at angle (60k-90), so the edge between corner k and k+1 has an outward
// normal at 60k-60 -- so this needs no separate direction table, and the
// same edges line up with the hex-grid cells ships already sit on (see
// map/main.js's warpedGridLines, which tiles corners the same way).
export const HEX_EDGE_FRONT_PX = 3, HEX_EDGE_FLANK_PX = 2, HEX_EDGE_REAR_PX = 1;
export function hexEdgeWidths(facingDeg) {
  const widths = [];
  for (let k = 0; k < 6; k++) {
    const edgeAngle = 60 * k - 60;
    let diff = Math.round((((edgeAngle - facingDeg) % 360) + 360) % 360);
    if (diff > 180) diff = 360 - diff;
    widths.push(diff === 0 ? HEX_EDGE_FRONT_PX : diff === 180 ? HEX_EDGE_REAR_PX : HEX_EDGE_FLANK_PX);
  }
  return widths;
}
// The 6 corners of that same pointy-top hex, in order, around (cx,cy) at
// radius s -- shared by the 2D and 3D ship-token renderers so a token's
// fill/edges can't drift out of sync with each other.
export function hexCorners(cx, cy, s) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = (60 * k - 90) * Math.PI / 180;
    pts.push([cx + Math.cos(a) * s, cy + Math.sin(a) * s]);
  }
  return pts;
}

export function toAxial(c, r) { return [c - ((r - (r & 1)) >> 1), r]; }
export function fromAxial(q, r) { return [q + ((r - (r & 1)) >> 1), r]; }

export function hexDist(a, b) {
  const [aq, ar] = toAxial(a[0], a[1]), [bq, br] = toAxial(b[0], b[1]);
  const dq = aq - bq, dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
export function neighbor(p, d) {
  const [q, r] = toAxial(p[0], p[1]);
  return fromAxial(q + CUBE_DIRS[d][0], r + CUBE_DIRS[d][1]);
}
const toCart = p => [p[0] + 0.5 * (p[1] & 1), p[1] * S32];
export function angleBetween(a, b) {
  const [ax, ay] = toCart(a), [bx, by] = toCart(b);
  return Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
}
export function relAngle(facing, frm, to) {
  let a = angleBetween(frm, to) - DIR_ANGLE[facing];
  a = ((a + 180) % 360 + 360) % 360 - 180;
  return Math.abs(a);
}
export function incomingArc(tgtPos, tgtFacing, firerPos) {
  const a = relAngle(tgtFacing, tgtPos, firerPos);
  if (a < 90 - 1e-9) return FiringArc.FRONT;
  if (a < 150 - 1e-9) return FiringArc.FLANK;
  return FiringArc.REAR;
}
export const inFireArc = (facing, frm, tp) => relAngle(facing, frm, tp) <= 90 + 1e-9;

export function losClear(a, b, occ) {
  const n = hexDist(a, b);
  if (n <= 1) return true;
  const [aq, ar] = toAxial(a[0], a[1]), [bq, br] = toAxial(b[0], b[1]);
  const ka = key(a[0], a[1]), kb = key(b[0], b[1]);
  for (const eps of [1e-6, -1e-6]) {
    let clear = true;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      let q = aq + (bq - aq) * t + eps, r = ar + (br - ar) * t + eps / 2, s = -q - r;
      let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
      const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
      if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
      const h = fromAxial(rq, rr), kh = key(h[0], h[1]);
      if (kh !== ka && kh !== kb && occ.has(kh)) { clear = false; break; }
    }
    if (clear) return true;
  }
  return false;
}

export const range = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; };
export const argmin = (arr, f) => arr.reduce((b, x) => f(x) < f(b) ? x : b);
