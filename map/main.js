import { makeHexGrid } from "./hexgrid.js";
import { UNIVERSE, SYSTEMS, celestialBodyLevel } from "./levels.js";
import { hexDist } from "../battle/hexmath.js";

const canvas = document.getElementById("cv");
const breadcrumb = document.getElementById("breadcrumb");
const zoomOutBtn = document.getElementById("zoomOut");
const hint = document.getElementById("hint");

// Navigation stack: [{level:"universe"}, {level:"system",systemId}, {level:"body",systemId,bodyId}]
let path = [{ level: "universe", label: "Universe" }];

function levelData(entry) {
  if (entry.level === "universe") return UNIVERSE;
  if (entry.level === "system") return SYSTEMS[entry.systemId];
  return celestialBodyLevel(entry.systemId, entry.bodyId);
}

const FILL = {
  system: "#3a2f6a", star: "#5a4a1a", planet: "#1a3a5c", belt: "#2a2a2a",
  "body-center": "#5a4a1a", "battle-link": "#5c1a2a", moon: "#2e3644",
};
const STROKE = {
  system: "#a78bfa", star: "#ffd166", planet: "#4a9eff", belt: "#666",
  "body-center": "#ffd166", "battle-link": "#ff5a5a", moon: "#9fb3c8",
};

// Per-planet colors (loosely evocative of the real thing) override the
// generic "planet"/"body-center" kind colors above -- Jupiter still reads
// as Jupiter whether it's a tile on the Star Map or the centerpiece of its
// own CelestialBody view.
const PLANET_COLORS = {
  mercury: { fill: "#3a3a3a", stroke: "#9e9e9e" },
  venus:   { fill: "#5c5030", stroke: "#f0d9a0" },
  earth:   { fill: "#1a3a5c", stroke: "#4a9eff" },
  mars:    { fill: "#5c2a1a", stroke: "#ff6b4a" },
  jupiter: { fill: "#5c4020", stroke: "#e0a050" },
  saturn:  { fill: "#5c4a20", stroke: "#e0c070" },
  uranus:  { fill: "#1a4a4a", stroke: "#7de8e8" },
  neptune: { fill: "#1a2a5c", stroke: "#5a7dff" },
};

// Same idea, per moon (id = its name lowercased -- see celestialBodyLevel
// in levels.js). Most moons don't have a strongly "iconic" real color the
// way planets do, so these are mainly picked to stay distinguishable from
// each other and from their parent planet's own color, with a nod to the
// few that do have a real look (sulfurous Io, hazy orange Titan, etc).
const MOON_COLORS = {
  moon:     { fill: "#4a4a4a", stroke: "#c8c8c8" },
  phobos:   { fill: "#4a3a2a", stroke: "#c9a678" },
  deimos:   { fill: "#3a2e28", stroke: "#a68968" },
  io:       { fill: "#5c4010", stroke: "#f0c040" },
  europa:   { fill: "#4a4838", stroke: "#e8dcc0" },
  ganymede: { fill: "#3a3428", stroke: "#a89878" },
  callisto: { fill: "#2e2a24", stroke: "#8a7d68" },
  titan:    { fill: "#5c4520", stroke: "#e8b060" },
  rhea:     { fill: "#404040", stroke: "#d8d8d8" },
  iapetus:  { fill: "#3a3a3a", stroke: "#b8b0a0" },
  dione:    { fill: "#3e3e3e", stroke: "#c8c8d0" },
  tethys:   { fill: "#383838", stroke: "#c0c8c8" },
  titania:  { fill: "#2e3a3a", stroke: "#88b8b8" },
  oberon:   { fill: "#2a3438", stroke: "#7898a0" },
  miranda:  { fill: "#343030", stroke: "#a89898" },
  ariel:    { fill: "#303838", stroke: "#90a8a8" },
  umbriel:  { fill: "#242424", stroke: "#686868" },
  triton:   { fill: "#2a3050", stroke: "#8098d8" },
};

// Faction fleet colors (see FACTIONS in levels.js) -- a ship cell carries
// its faction on `cell.faction`, checked before the id-based lookups since
// ship ids are per-ship (blue-ship-1, ...), not shared like planets/moons.
const FACTION_COLORS = {
  blue:  { fill: "#1a3a6e", stroke: "#4a9eff" },
  green: { fill: "#1a5c2a", stroke: "#4ade80" },
  red:   { fill: "#5c1a1a", stroke: "#ff4a4a" },
};

function colorsFor(cell) {
  const f = cell.faction && FACTION_COLORS[cell.faction];
  const p = f || PLANET_COLORS[cell.id] || MOON_COLORS[cell.id];
  return p || { fill: FILL[cell.kind] || "#1a2133", stroke: STROKE[cell.kind] || "#2a3350" };
}

// Pixel position of a hex, relative to nothing but its own (c,r) -- same
// formula as hexgrid.js's hexCenter with ox=oy=0, so subtracting two of
// these gives a correct offset between two positions (parity and all)
// without needing a whole separate grid.
const localPx = (pos, hs) => [(pos[0] + 0.5 * (pos[1] & 1)) * hs * Math.sqrt(3), pos[1] * hs * 1.5];

// How far a board's own content reaches from its center, in pixels at a
// given hex size -- used both to measure Sol's tile (at the Universe
// board's real hs) and the target system's full layout (at hs=1, then
// solved for the hs that makes it fit).
function footprintPx(board, hs) {
  const [ccx, ccy] = localPx(board.center, hs);
  let max = 0;
  for (const cell of board.cells) {
    const [x, y] = localPx(cell.pos, hs);
    max = Math.max(max, Math.hypot(x - ccx, y - ccy) + (cell.size || 0) * hs * 1.5);
  }
  return max;
}

// The board one zoom level down from this cell, if it has one -- a system
// (Sol's planets), a body (a planet's moons), or null for cells that don't
// lead anywhere further down this chain (a moon, the Enter Battle link).
function subBoardFor(enter) {
  if (enter?.level === "system") return SYSTEMS[enter.systemId];
  if (enter?.level === "body") return celestialBodyLevel(enter.systemId, enter.bodyId);
  return null;
}

// A live miniature of what's really inside a cell -- Sol's Sun/planets, or
// a planet's moons -- drawn as small dots at their real relative positions
// and sizes, scaled to fit inside this cell's own tile. A preview of real
// content, not a decorative pattern.
function drawSubBoardPreview(grid, cell, subBoard) {
  const [tx, ty] = grid.hexCenter(cell.pos[0], cell.pos[1]);
  const tileRadiusPx = (cell.size || 0) * grid.hs * 1.5 + grid.hs;
  const miniHs = tileRadiusPx / (footprintPx(subBoard, 1) * 1.15);
  const [ccx, ccy] = localPx(subBoard.center, miniHs);
  for (const sc of subBoard.cells) {
    const [x, y] = localPx(sc.pos, miniHs);
    grid.ctx.beginPath();
    grid.ctx.arc(tx + (x - ccx), ty + (y - ccy), Math.max(1.5, miniHs * (0.6 + (sc.size || 0) * 0.5)), 0, 7);
    grid.ctx.fillStyle = colorsFor(sc).stroke;
    grid.ctx.fill();
  }
}

function render() {
  const entry = path[path.length - 1];
  const data = levelData(entry);
  // data.radius counts rings including the center (see map/levels.js), one
  // more than the hexDist value the mask actually needs.
  const inBounds = data.center && data.radius != null
    ? (c, r) => hexDist(data.center, [c, r]) <= data.radius - 1
    : undefined;
  const grid = makeHexGrid(canvas, { cols: data.cols, rows: data.rows, hs: data.hs, ...(inBounds && { inBounds }) });
  // A cell can be a multi-hex blob (cell.size = hexDist radius, not just a
  // single hex), so "what's at (c,r)" is a distance test against every
  // cell rather than an exact-position lookup. Blobs are placed (see
  // radialBoard in levels.js) so they never overlap, so at most one matches.
  const cellAt = (c, r) => data.cells.find(cell => hexDist(cell.pos, [c, r]) <= (cell.size || 0));

  grid.ctx.fillStyle = "#0b0e14";
  grid.ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Two passes: every hex fill/stroke first, then labels on top -- otherwise
  // a later row's opaque hex fill paints over an earlier row's label text.
  for (let r = 0; r < data.rows; r++) for (let c = 0; c < data.cols; c++) {
    if (!grid.inBounds(c, r)) continue;
    const [x, y] = grid.hexCenter(c, r);
    const cell = cellAt(c, r);
    grid.hexPath(x, y, grid.hs - 1.5);
    grid.ctx.fillStyle = cell ? colorsFor(cell).fill : "#131826";
    grid.ctx.fill();
    grid.ctx.strokeStyle = cell ? colorsFor(cell).stroke : "#2a3350";
    grid.ctx.lineWidth = cell ? 2 : 1;
    grid.ctx.stroke();
  }
  for (const cell of data.cells) {
    const subBoard = subBoardFor(cell.enter);
    if (subBoard) drawSubBoardPreview(grid, cell, subBoard);
    const [x, y] = grid.hexCenter(cell.pos[0], cell.pos[1]);
    grid.ctx.fillStyle = "#d7deef";
    grid.ctx.font = "bold 11px system-ui";
    grid.ctx.textAlign = "center";
    // A cell with a preview has its center busy with the mini graphic --
    // put its label below instead of overlapping it.
    grid.ctx.fillText(cell.label, x, subBoard ? y + (cell.size || 0) * grid.hs * 1.5 + grid.hs + 13 : y + 4);
  }

  canvas.onclick = ev => {
    const rect = canvas.getBoundingClientRect();
    const h = grid.pixelToHex(ev.clientX - rect.left, ev.clientY - rect.top);
    if (!h) return;
    const cell = cellAt(h[0], h[1]);
    if (!cell) { setHint("Empty space — nothing here."); return; }
    if (cell.href) { window.location.href = cell.href; return; }
    if (cell.enter) { zoomIn(cell.enter, cell.label); return; }
    if (cell.kind === "ship") { setHint(`${cell.label} — a ${cell.faction} squadron.`); return; }
    setHint(cell.kind === "belt" ? "Asteroid Belt — no bodies to explore." : `${cell.label} — nothing to zoom into yet.`);
  };

  renderBreadcrumb();
}

function zoomIn(enter, label) {
  path.push({ ...enter, label });
  setHint("");
  render();
}
function zoomTo(index) {
  path = path.slice(0, index + 1);
  setHint("");
  render();
}
function zoomOut() {
  if (path.length > 1) zoomTo(path.length - 2);
}
function setHint(text) { hint.textContent = text; }

function renderBreadcrumb() {
  breadcrumb.innerHTML = "";
  path.forEach((entry, i) => {
    if (i > 0) breadcrumb.appendChild(document.createTextNode(" / "));
    const btn = document.createElement(i === path.length - 1 ? "span" : "a");
    btn.textContent = entry.label;
    if (i !== path.length - 1) {
      btn.href = "#";
      btn.onclick = ev => { ev.preventDefault(); zoomTo(i); };
    }
    breadcrumb.appendChild(btn);
  });
  zoomOutBtn.disabled = path.length <= 1;
}

zoomOutBtn.onclick = zoomOut;
document.addEventListener("keydown", ev => { if (ev.key === "Escape") zoomOut(); });

render();
