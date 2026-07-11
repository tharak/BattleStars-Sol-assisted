import { makeHexGrid } from "./hexgrid.js";
import { UNIVERSE, SYSTEMS, celestialBodyLevel } from "./levels.js";
import { hexDist, neighbor } from "../battle/hexmath.js";

// hexPath's corner k is at angle (60k - 90); the edge from corner k to
// corner k+1 faces the neighbor in this direction (see hexmath's CUBE_DIRS/
// DIR_ANGLE) -- used to skip the internal edges of a multi-hex blob so it
// reads as one merged shape instead of a cluster of individually-outlined
// tiles.
const EDGE_TO_DIR = [1, 0, 5, 4, 3, 2];

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
    const s = grid.hs - 1.5;
    grid.hexPath(x, y, s);
    grid.ctx.fillStyle = cell ? FILL[cell.kind] || "#1a2133" : "#131826";
    grid.ctx.fill();
    if (!cell) {
      // A blob's boundary edge is already stroked once, in its own accent
      // color, from the populated side below -- skip it here so it isn't
      // doubled up with this grey line underneath it.
      grid.ctx.strokeStyle = "#2a3350";
      grid.ctx.lineWidth = 1;
      for (let k = 0; k < 6; k++) {
        const n = neighbor([c, r], EDGE_TO_DIR[k]);
        if (cellAt(n[0], n[1])) continue;
        grid.edgePath(x, y, s, k);
        grid.ctx.stroke();
      }
      continue;
    }
    // Same-owner blob: only stroke edges that border a different cell (or
    // empty space), so adjacent same-owner hexes merge into one shape.
    grid.ctx.strokeStyle = STROKE[cell.kind] || "#2a3350";
    grid.ctx.lineWidth = 2;
    for (let k = 0; k < 6; k++) {
      const n = neighbor([c, r], EDGE_TO_DIR[k]);
      if (cellAt(n[0], n[1]) === cell) continue;
      grid.edgePath(x, y, s, k);
      grid.ctx.stroke();
    }
  }
  for (const cell of data.cells) {
    const [x, y] = grid.hexCenter(cell.pos[0], cell.pos[1]);
    grid.ctx.fillStyle = "#d7deef";
    grid.ctx.font = "bold 11px system-ui";
    grid.ctx.textAlign = "center";
    grid.ctx.fillText(cell.label, x, y + (cell.size || 0) * grid.hs * 1.5 + grid.hs + 13);
  }

  canvas.onclick = ev => {
    const rect = canvas.getBoundingClientRect();
    const h = grid.pixelToHex(ev.clientX - rect.left, ev.clientY - rect.top);
    if (!h) return;
    const cell = cellAt(h[0], h[1]);
    if (!cell) { setHint("Empty space — nothing here."); return; }
    if (cell.href) { window.location.href = cell.href; return; }
    if (cell.enter) { zoomIn(cell.enter, cell.label); return; }
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
