// Pure hex/geometry math. Operates only on [c,r] pixel-offset coordinate
// pairs and plain numbers -- no ECS or game-state coupling at all.

export const S32 = Math.sqrt(3) / 2;
export const CUBE_DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
export const DIR_ANGLE = [0,-60,-120,180,120,60];

export const key = (c, r) => c + "," + r;

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
  if (a < 90 - 1e-9) return "front";
  if (a < 150 - 1e-9) return "flank";
  return "rear";
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
