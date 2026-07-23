function clipHalfPlane(polygon, a, b, c) {
  const clipped = [];
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const currentInside = a * current[0] + b * current[1] <= c;
    const previousInside = a * previous[0] + b * previous[1] <= c;
    if (currentInside !== previousInside) {
      const currentValue = a * current[0] + b * current[1];
      const previousValue = a * previous[0] + b * previous[1];
      const t = (c - previousValue) / (currentValue - previousValue);
      clipped.push([
        previous[0] + (current[0] - previous[0]) * t,
        previous[1] + (current[1] - previous[1]) * t,
      ]);
    }
    if (currentInside) clipped.push(current);
  }
  return clipped;
}

function manhattanVoronoiCell(points, siteIndex, bounds) {
  const [minX, minY, maxX, maxY] = bounds;
  const [siteX, siteY] = points[siteIndex];
  const nearest = (x, y) => {
    let winner = 0, best = Infinity;
    for (let index = 0; index < points.length; index++) {
      const distance = Math.abs(x - points[index][0]) + Math.abs(y - points[index][1]);
      if (distance < best) { best = distance; winner = index; }
    }
    return winner;
  };
  const polygon = [];
  for (let step = 0; step < 128; step++) {
    const angle = step * Math.PI * 2 / 128;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let maxT = Infinity;
    if (dx > 0) maxT = Math.min(maxT, (maxX - siteX) / dx);
    if (dx < 0) maxT = Math.min(maxT, (minX - siteX) / dx);
    if (dy > 0) maxT = Math.min(maxT, (maxY - siteY) / dy);
    if (dy < 0) maxT = Math.min(maxT, (minY - siteY) / dy);
    let low = 0, high = Math.max(0, maxT);
    if (nearest(siteX + dx * high, siteY + dy * high) === siteIndex) {
      polygon.push([siteX + dx * high, siteY + dy * high]);
      continue;
    }
    for (let iteration = 0; iteration < 18; iteration++) {
      const middle = (low + high) / 2;
      if (nearest(siteX + dx * middle, siteY + dy * middle) === siteIndex) low = middle;
      else high = middle;
    }
    polygon.push([siteX + dx * low, siteY + dy * low]);
  }
  return polygon;
}

export function voronoiCells(points, bounds, { metric = "euclidean" } = {}) {
  if (metric === "manhattan") return points.map((_point, index) => manhattanVoronoiCell(points, index, bounds));
  const [minX, minY, maxX, maxY] = bounds;
  const cells = [];
  for (let index = 0; index < points.length; index++) {
    const [x, y] = points[index];
    let polygon = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
    for (let other = 0; other < points.length && polygon.length; other++) {
      if (other === index) continue;
      const [ox, oy] = points[other];
      polygon = clipHalfPlane(
        polygon,
        2 * (ox - x),
        2 * (oy - y),
        ox * ox + oy * oy - x * x - y * y,
      );
    }
    cells.push(polygon);
  }
  return cells;
}
