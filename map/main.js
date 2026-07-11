import { makeHexGrid } from "./hexgrid.js";
import { UNIVERSE, SYSTEMS, celestialBodyLevel, bodyLabel } from "./levels.js";

const canvas = document.getElementById("cv");
const breadcrumb = document.getElementById("breadcrumb");
const zoomOutBtn = document.getElementById("zoomOut");
const hint = document.getElementById("hint");

// Navigation stack: [{level:"universe"}, {level:"system",systemId}, {level:"body",systemId,bodyId}]
let path = [{ level: "universe", label: "Universe" }];

function levelData(entry) {
  if (entry.level === "universe") return UNIVERSE;
  if (entry.level === "system") return SYSTEMS[entry.systemId];
  return celestialBodyLevel(bodyLabel(entry.systemId, entry.bodyId));
}

const FILL = {
  system: "#3a2f6a", star: "#5a4a1a", planet: "#1a3a5c", belt: "#2a2a2a",
  "body-center": "#5a4a1a", "battle-link": "#5c1a2a",
};
const STROKE = {
  system: "#a78bfa", star: "#ffd166", planet: "#4a9eff", belt: "#666",
  "body-center": "#ffd166", "battle-link": "#ff5a5a",
};

function render() {
  const entry = path[path.length - 1];
  const data = levelData(entry);
  const grid = makeHexGrid(canvas, { cols: data.cols, rows: data.rows, hs: data.hs });
  const byPos = new Map(data.cells.map(c => [c.pos[0] + "," + c.pos[1], c]));

  grid.ctx.fillStyle = "#0b0e14";
  grid.ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Two passes: every hex fill/stroke first, then labels on top -- otherwise
  // a later row's opaque hex fill paints over an earlier row's label text.
  for (let r = 0; r < data.rows; r++) for (let c = 0; c < data.cols; c++) {
    const [x, y] = grid.hexCenter(c, r);
    const cell = byPos.get(c + "," + r);
    grid.hexPath(x, y, grid.hs - 1.5);
    grid.ctx.fillStyle = cell ? FILL[cell.kind] || "#1a2133" : "#131826";
    grid.ctx.fill();
    grid.ctx.strokeStyle = cell ? STROKE[cell.kind] || "#2a3350" : "#2a3350";
    grid.ctx.lineWidth = cell ? 2 : 1;
    grid.ctx.stroke();
  }
  for (const cell of data.cells) {
    const [x, y] = grid.hexCenter(cell.pos[0], cell.pos[1]);
    grid.ctx.fillStyle = "#d7deef";
    grid.ctx.font = "bold 11px system-ui";
    grid.ctx.textAlign = "center";
    grid.ctx.fillText(cell.label, x, y + grid.hs + 13);
  }

  canvas.onclick = ev => {
    const rect = canvas.getBoundingClientRect();
    const h = grid.pixelToHex(ev.clientX - rect.left, ev.clientY - rect.top);
    if (!h) return;
    const cell = byPos.get(h[0] + "," + h[1]);
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
