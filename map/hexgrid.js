// Generic hex-grid canvas renderer shared by the three strategic zoom levels
// (Universe, System, CelestialBody). Each level is just a rectangular grid
// of pointy-top hexes at its own scale -- unlike the Battle board (see
// battle/config.js) these don't need a hexagonal board mask, so this stays
// decoupled from battle/hexmath.js entirely.

export function makeHexGrid(canvas, { cols, rows, hs, ox = 40, oy = 40 }) {
  const ctx = canvas.getContext("2d");
  const hw = hs * Math.sqrt(3);

  const hexCenter = (c, r) => [ox + (c + 0.5 * (r & 1)) * hw, oy + r * hs * 1.5];

  canvas.width = ox * 2 + hw * (cols + 0.5);
  canvas.height = oy * 2 + hs * 1.5 * (rows - 1) + hs * 2;

  function hexPath(x, y, s) {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (60 * k - 90) * Math.PI / 180;
      const px = x + s * Math.cos(a), py = y + s * Math.sin(a);
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  function pixelToHex(x, y) {
    let best = null, bd = 1e9;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const [hx, hy] = hexCenter(c, r), d = (hx - x) ** 2 + (hy - y) ** 2;
      if (d < bd) { bd = d; best = [c, r]; }
    }
    return bd <= (hs * 1.05) ** 2 ? best : null;
  }

  return { ctx, hs, hexCenter, hexPath, pixelToHex, cols, rows };
}
