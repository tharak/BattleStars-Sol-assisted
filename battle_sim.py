#!/usr/bin/env python3
"""Monte-Carlo baseline for the paper battle rules (battle-rules.md).

Implements battle-rules v0.2 exactly — arcs, facing, LOS masking, morale ladder,
command radius, two-state supply, fleet sizes 5/9/12 — with deliberately DUMB
handling: every squadron advances toward the nearest enemy and shoots when it can.
No maneuvering cleverness, no formation-keeping. Purpose: measure what the geometry
alone gives us (GDD open questions 1 & 3) before/alongside human play. No
dependencies. Deterministic per seed.

v0.2 changes vs v0.1:
- Supply split: "low" = -1 morale only; "critical" = -1 morale AND +1 to-hit
  (v0.1's "low" was the current "critical"; human play confirmed it as auto-loss).
- formation_layout/deploy/Battle parametrized by fleet size (5/9/12);
  break threshold = size//2 + 1.

Rules v0.2.1 adds a backward move (1 hex astern for all 3 MP, facing kept). The
dumb AI never retreats, so it is NOT modeled here — results are unaffected. It is
implemented in the web prototype (battle.html) for human play.

Usage: python3 battle_sim.py [--trials N] [--seed S]
"""

import argparse
import math
import random

SQRT3_2 = math.sqrt(3) / 2
BOARD_COLS, BOARD_ROWS = 24, 18
CUBE_DIRS = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]  # axial (q, r)
DIR_ANGLE = [0.0, -60.0, -120.0, 180.0, 120.0, 60.0]  # cartesian angle of each dir
RANGE = 3
CMD_RADIUS = 4
MP = 3
MAX_TURNS = 40


# --- hex math (odd-r offset storage, axial for distances) --------------------

def to_axial(col, row):
    return col - (row - (row & 1)) // 2, row


def from_axial(q, r):
    return q + (r - (r & 1)) // 2, r


def hex_dist(a, b):
    aq, ar = to_axial(*a)
    bq, br = to_axial(*b)
    dq, dr = aq - bq, ar - br
    return (abs(dq) + abs(dr) + abs(dq + dr)) // 2


def neighbor(pos, d):
    q, r = to_axial(*pos)
    dq, dr = CUBE_DIRS[d]
    return from_axial(q + dq, r + dr)


def to_cart(pos):
    col, row = pos
    return col + 0.5 * (row & 1), row * SQRT3_2


def angle_between(frm, to):
    fx, fy = to_cart(frm)
    tx, ty = to_cart(to)
    return math.degrees(math.atan2(ty - fy, tx - fx))


def rel_angle(facing, frm, to):
    """Unsigned angle between `frm`'s facing and the direction to `to`."""
    a = angle_between(frm, to) - DIR_ANGLE[facing]
    a = (a + 180.0) % 360.0 - 180.0
    return abs(a)


def incoming_arc(target, firer_pos):
    """Arc of the TARGET the fire comes into. Seams favor the shooter."""
    a = rel_angle(target.facing, target.pos, firer_pos)
    if a < 90.0 - 1e-9:
        return "front"
    if a < 150.0 - 1e-9:
        return "flank"
    return "rear"


def in_fire_arc(firer, target_pos):
    """Shooter's front arc (faced hexside + 2 adjacent = 180 deg, seams favor shooter)."""
    return rel_angle(firer.facing, firer.pos, target_pos) <= 90.0 + 1e-9


def los_clear(a, b, occupied):
    """Beam LOS blocked by any squadron between. Edge cases favor the shooter."""
    n = hex_dist(a, b)
    if n <= 1:
        return True
    for eps in (1e-6, -1e-6):
        clear = True
        for i in range(1, n):
            aq, ar = to_axial(*a)
            bq, br = to_axial(*b)
            t = i / n
            q = aq + (bq - aq) * t + eps
            r = ar + (br - ar) * t + eps / 2
            s = -q - r
            rq, rr, rs = round(q), round(r), round(s)
            dq, dr, ds = abs(rq - q), abs(rr - r), abs(rs - s)
            if dq > dr and dq > ds:
                rq = -rr - rs
            elif dr > ds:
                rr = -rq - rs
            h = from_axial(rq, int(rr))
            if h != a and h != b and h in occupied:
                clear = False
                break
        if clear:
            return True
    return False


# --- units -------------------------------------------------------------------

STEADY, SHAKEN, ROUTED = 0, 1, 2


class Squadron:
    __slots__ = ("side", "pos", "facing", "strength", "state", "flag",
                 "hit_since_act", "alive", "exited")

    def __init__(self, side, pos, facing, flag=False):
        self.side = side
        self.pos = pos
        self.facing = facing
        self.strength = 4
        self.state = STEADY
        self.flag = flag
        self.hit_since_act = False
        self.alive = True
        self.exited = False


class Fleet:
    def __init__(self, name, units, supply="ok"):
        self.name = name
        self.units = units
        self.supply = supply  # "ok" | "low" | "critical"
        self.flag_lost = False

    def losses(self):
        return sum(1 for u in self.units if not u.alive)

    def flagship(self):
        for u in self.units:
            if u.flag and u.alive:
                return u
        return None


# --- formations (fwd, lat, dfacing) ; dfacing: 0 straight, +1 toward +lat ----

def formation_layout(name, size=9):
    """Positions per fleet size. Returns (list of (fwd, lat, dfacing), flag_index)."""
    if size == 5:
        if name == "line":
            return [(0, l, 0) for l in range(-2, 3)], 2
        if name == "spindle":  # diamond 1-3-1
            return [(1, 0, 0), (0, -1, 0), (0, 0, 0), (0, 1, 0), (-1, 0, 0)], 2
        if name == "crescent":
            return [(1 if abs(l) == 2 else 0, l,
                     1 if l <= -2 else (-1 if l >= 2 else 0)) for l in range(-2, 3)], 2
        if name == "echelon":
            return [(-l, l, 0) for l in range(-2, 3)], 2
        if name == "sphere":
            return [(0, 0, 0), (1, 0, 0), (0, -1, 0), (-1, 0, 0), (0, 1, 0)], 0
        if name == "column":
            return [(f, 0, 0) for f in range(-2, 3)], 2
    if size == 9:
        if name == "line":
            return [(0, l, 0) for l in range(-4, 5)], 4
        if name == "spindle":  # diamond 1-2-3-2-1
            return [(2, 0, 0), (1, -1, 0), (1, 1, 0), (0, -1, 0), (0, 0, 0), (0, 1, 0),
                    (-1, -1, 0), (-1, 1, 0), (-2, 0, 0)], 4
        if name == "crescent":
            return [(2 if abs(l) >= 3 else (1 if abs(l) == 2 else 0), l,
                     1 if l <= -2 else (-1 if l >= 2 else 0)) for l in range(-4, 5)], 4
        if name == "echelon":
            return [(-l, l, 0) for l in range(-4, 5)], 4
        if name == "sphere":
            return [(0, 0, 0), (1, 0, 0), (1, -1, 0), (0, -1, 0), (-1, -1, 0),
                    (-1, 0, 0), (-1, 1, 0), (0, 1, 0), (1, 1, 0)], 0
        if name == "column":
            return [(f, 0, 0) for f in range(-4, 5)], 4
    if size == 12:
        if name == "line":
            return [(0, l, 0) for l in range(-6, 6)], 6
        if name == "spindle":  # ranks 1-2-3-3-2-1, deep wedge
            return [(3, 0, 0), (2, -1, 0), (2, 1, 0),
                    (1, -1, 0), (1, 0, 0), (1, 1, 0),
                    (0, -1, 0), (0, 0, 0), (0, 1, 0),
                    (-1, -1, 0), (-1, 1, 0), (-2, 0, 0)], 7
        if name == "crescent":
            return [(2 if abs(l) >= 4 else (1 if abs(l) >= 2 else 0), l,
                     1 if l <= -2 else (-1 if l >= 2 else 0)) for l in range(-6, 6)], 6
        if name == "echelon":  # clamp advance so wing tips don't start in contact
            return [(max(-4, min(4, -l)), l, 0) for l in range(-6, 6)], 6
        if name == "sphere":
            return [(0, 0, 0), (1, 0, 0), (1, -1, 0), (0, -1, 0), (-1, -1, 0),
                    (-1, 0, 0), (-1, 1, 0), (0, 1, 0), (1, 1, 0),
                    (2, 0, 0), (0, -2, 0), (0, 2, 0)], 0
        if name == "column":  # double column (single file of 12 won't fit the board)
            return [(f, l, 0) for f in range(-2, 4) for l in (0, 1)], 4
    raise ValueError(f"{name}@{size}")


HOLD_FORMATIONS = {"sphere"}  # doctrine: stand and receive


def deploy(name, side, size=9):
    layout, flag = formation_layout(name, size)
    straight = 0 if side == 0 else 3
    to_pos = 5 if side == 0 else 4
    to_neg = 1 if side == 0 else 2
    units = []
    for i, (fwd, lat, df) in enumerate(layout):
        col = (5 + fwd) if side == 0 else (18 - fwd)
        row = 9 + lat
        facing = straight if df == 0 else (to_pos if df > 0 else to_neg)
        units.append(Squadron(side, (col, row), facing, flag=(i == flag)))
    if name == "sphere":  # outward ring facings
        center = units[0].pos
        for u in units[1:]:
            ang = angle_between(center, u.pos)
            u.facing = min(range(6), key=lambda d: abs(((DIR_ANGLE[d] - ang + 180) % 360) - 180))
    return units


# --- battle ------------------------------------------------------------------

class Battle:
    def __init__(self, forms, rng, supply=("ok", "ok"), size=9):
        self.rng = rng
        self.forms = forms
        self.size = size
        self.break_at = size // 2 + 1
        self.fleets = [Fleet(forms[0], deploy(forms[0], 0, size), supply[0]),
                       Fleet(forms[1], deploy(forms[1], 1, size), supply[1])]

    def occupied(self):
        return {u.pos: u for f in self.fleets for u in f.units if u.alive}

    def enemies(self, side):
        return [u for u in self.fleets[1 - side].units if u.alive]

    def friends(self, u):
        return [v for v in self.fleets[u.side].units if v.alive and v is not u]

    def in_command(self, u):
        fl = self.fleets[u.side].flagship()
        return fl is not None and hex_dist(u.pos, fl.pos) <= CMD_RADIUS

    # -- morale --
    def morale_check(self, u, from_flank_rear=False):
        if not u.alive or u.state == ROUTED:
            return
        mod = 0
        if any(v.state == STEADY and hex_dist(u.pos, v.pos) == 1 for v in self.friends(u)):
            mod += 1
        if self.in_command(u):
            mod += 1
        if from_flank_rear:
            mod -= 1
        if self.fleets[u.side].supply != "ok":
            mod -= 1
        if self.fleets[u.side].flag_lost:
            mod -= 1
        if self.rng.randint(1, 6) + mod >= 4:
            return
        if u.state == STEADY:
            u.state = SHAKEN
        elif u.state == SHAKEN:
            u.state = ROUTED
            u.facing = 3 if u.side == 0 else 0  # face own edge
            self.contagion(u)

    def contagion(self, source):
        for v in list(self.friends(source)):
            if v.alive and v.state != ROUTED and hex_dist(v.pos, source.pos) <= 2:
                self.morale_check(v)

    def destroy(self, u):
        u.alive = False
        was_flag = u.flag
        self.contagion(u)
        if was_flag:
            self.fleets[u.side].flag_lost = True
            for v in list(self.fleets[u.side].units):
                if v.alive:
                    self.morale_check(v)

    # -- fire --
    def pick_target(self, u):
        occ = self.occupied()
        best = None
        for e in self.enemies(u.side):
            d = hex_dist(u.pos, e.pos)
            if d > RANGE or not in_fire_arc(u, e.pos) or not los_clear(u.pos, e.pos, occ):
                continue
            key = (d, e.strength)
            if best is None or key < best[0]:
                best = (key, e)
        return best[1] if best else None

    def fire(self, u, target):
        dice = u.strength if u.state == STEADY else (u.strength + 1) // 2
        arc = incoming_arc(target, u.pos)
        need = {"front": 5, "flank": 4, "rear": 3}[arc]
        if self.fleets[u.side].supply == "critical":
            need += 1
        hits = sum(1 for _ in range(dice) if self.rng.randint(1, 6) >= need)
        if hits == 0:
            return
        target.strength = max(0, target.strength - hits)
        target.hit_since_act = True
        if target.strength == 0:
            self.destroy(target)
        else:
            self.morale_check(target, from_flank_rear=(arc != "front"))

    # -- movement --
    def turn_toward(self, u, d):
        diff = (d - u.facing) % 6
        u.facing = (u.facing + (1 if diff <= 3 else -1)) % 6

    def desired_dir(self, u, goal):
        ang = angle_between(u.pos, goal)
        return min(range(6), key=lambda d: abs(((DIR_ANGLE[d] - ang + 180) % 360) - 180))

    def step(self, u):
        """One MP spent advancing toward nearest enemy. True if MP was usable."""
        enemies = self.enemies(u.side)
        if not enemies:
            return False
        goal = min(enemies, key=lambda e: hex_dist(u.pos, e.pos)).pos
        d = self.desired_dir(u, goal)
        if u.facing != d:
            self.turn_toward(u, d)
            return True
        nxt = neighbor(u.pos, d)
        occ = self.occupied()
        if (0 <= nxt[0] < BOARD_COLS and 0 <= nxt[1] < BOARD_ROWS
                and nxt not in occ and hex_dist(nxt, goal) < hex_dist(u.pos, goal)):
            u.pos = nxt
            return True
        return False  # blocked: hold

    def flee(self, u):
        d = 3 if u.side == 0 else 0
        for _ in range(MP):
            if u.facing != d:
                self.turn_toward(u, d)
                continue
            nxt = neighbor(u.pos, d)
            if not (0 <= nxt[0] < BOARD_COLS and 0 <= nxt[1] < BOARD_ROWS):
                u.alive = False
                u.exited = True
                return
            if nxt not in self.occupied():
                u.pos = nxt

    # -- activation --
    def activate(self, u):
        if not u.alive:
            return
        if u.state == ROUTED:
            if not u.hit_since_act:
                bonus = 1 if self.in_command(u) else 0
                if self.rng.randint(1, 6) + bonus >= 4:
                    u.state = SHAKEN
                    u.hit_since_act = False
                    return
            u.hit_since_act = False
            self.flee(u)
            return
        u.hit_since_act = False
        cmd = self.in_command(u)
        hold = self.fleets[u.side].name in HOLD_FORMATIONS
        target = self.pick_target(u)
        if u.state == SHAKEN:
            if target is None and not hold:
                en = self.enemies(u.side)
                if en:  # may turn in place, not approach
                    goal = min(en, key=lambda e: hex_dist(u.pos, e.pos)).pos
                    d = self.desired_dir(u, goal)
                    if u.facing != d:
                        self.turn_toward(u, d)
                target = self.pick_target(u) if cmd else None
            if target is not None:
                self.fire(u, target)
            return
        # steady
        if target is not None:
            self.fire(u, target)
            return
        if hold:
            en = self.enemies(u.side)
            if en:
                goal = min(en, key=lambda e: hex_dist(u.pos, e.pos)).pos
                if hex_dist(u.pos, goal) <= RANGE + 1:  # only rotate once threatened
                    d = self.desired_dir(u, goal)
                    if u.facing != d:
                        self.turn_toward(u, d)
            if cmd:
                target = self.pick_target(u)
                if target is not None:
                    self.fire(u, target)
            return
        for _ in range(MP):
            if not self.step(u):
                break
        if cmd:
            target = self.pick_target(u)
            if target is not None:
                self.fire(u, target)

    def broken(self, side):
        return self.fleets[side].losses() >= self.break_at

    def run(self):
        for turn in range(1, MAX_TURNS + 1):
            first = (turn + 1) % 2
            queues = [[u for u in self.fleets[s].units if u.alive] for s in (0, 1)]
            i = [0, 0]
            side = first
            while i[0] < len(queues[0]) or i[1] < len(queues[1]):
                if i[side] < len(queues[side]):
                    self.activate(queues[side][i[side]])
                    i[side] += 1
                    for s in (0, 1):
                        if self.broken(s):
                            return 1 - s, turn
                side = 1 - side
        # draw: score by surviving strength
        s0 = sum(u.strength for u in self.fleets[0].units if u.alive)
        s1 = sum(u.strength for u in self.fleets[1].units if u.alive)
        return (None, MAX_TURNS) if s0 == s1 else (0 if s0 > s1 else 1, MAX_TURNS)


# --- experiments ---------------------------------------------------------------

FORMS = ["spindle", "line", "crescent", "echelon", "sphere", "column"]

WHEEL = [("spindle", "line"), ("line", "crescent"), ("crescent", "spindle"),
         ("echelon", "spindle"), ("sphere", "crescent")]


def run_pair(f1, f2, trials, rng, size=9):
    wins = {f1: 0, f2: 0, "draw": 0}
    turns = 0
    for t in range(trials):
        flip = t % 2 == 1
        forms = (f2, f1) if flip else (f1, f2)
        w, tn = Battle(forms, rng, size=size).run()
        turns += tn
        if w is None:
            wins["draw"] += 1
        else:
            wins[forms[w]] += 1
    return wins, turns / trials


def supply_mirror(state, trials, rng, size=9):
    """Mirror line-vs-line; one side at the given supply state."""
    w_ok = w_bad = dr = 0
    for t in range(trials):
        bad_is_b = t % 2 == 0
        sup = ("ok", state) if bad_is_b else (state, "ok")
        w, _ = Battle(("line", "line"), rng, supply=sup, size=size).run()
        if w is None:
            dr += 1
        elif sup[w] == state:
            w_bad += 1
        else:
            w_ok += 1
    return w_ok, w_bad, dr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=400)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    N = args.trials

    print(f"battle_sim — trials/pair={N}, seed={args.seed}, dumb-advance AI, rules v0.2\n")

    print("## Full matrix, 9v9 (row formation win% vs column; rest are losses or draws)\n")
    header = "| vs | " + " | ".join(FORMS) + " |"
    print(header)
    print("|---" * (len(FORMS) + 1) + "|")
    results = {}
    for f1 in FORMS:
        cells = []
        for f2 in FORMS:
            if f1 == f2:
                cells.append("—")
                continue
            key = tuple(sorted((f1, f2)))
            if key not in results:
                results[key] = run_pair(key[0], key[1], N, rng)
            wins, avg_t = results[key]
            cells.append(f"{100.0 * wins[f1] / N:.0f}%")
        print(f"| **{f1}** | " + " | ".join(cells) + " |")

    print("\n## Counter-wheel legs, 9v9 (predicted winner listed first)\n")
    print("| Leg | predicted winner win% | loser win% | draws | avg turns |")
    print("|---|---|---|---|---|")
    for a, b in WHEEL:
        key = tuple(sorted((a, b)))
        wins, avg_t = results[key]
        d = 100.0 * wins["draw"] / N
        print(f"| {a} vs {b} | {100.0 * wins[a] / N:.0f}% | "
              f"{100.0 * wins[b] / N:.0f}% | {d:.0f}% | {avg_t:.1f} |")

    print("\n## Supply weight v0.2 (mirror line-vs-line, one side degraded)\n")
    for state in ("low", "critical"):
        ok, bad, dr = supply_mirror(state, N, rng)
        print(f"{state:>8}: normal wins {100.0 * ok / N:.0f}% · degraded wins "
              f"{100.0 * bad / N:.0f}% · draws {100.0 * dr / N:.0f}%")

    print("\n## Fleet-size sanity (spindle vs line at 5/9/12; all must terminate)\n")
    for size in (5, 9, 12):
        wins, avg_t = run_pair("spindle", "line", N, rng, size=size)
        print(f"{size:>2}v{size}: spindle {100.0 * wins['spindle'] / N:.0f}% · "
              f"line {100.0 * wins['line'] / N:.0f}% · draws {wins['draw']} · "
              f"avg turns {avg_t:.1f}")


if __name__ == "__main__":
    main()
