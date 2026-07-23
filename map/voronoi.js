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

export function voronoiCells(points, bounds) {
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
