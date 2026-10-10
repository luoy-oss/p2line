import type { StrokePoint } from './stroke-reconstruction'

/**
 * Reorders, but never alters, the original sampled point cloud.
 * Reconstructed skeleton paths are used only as a spatial ordering guide.
 * Points too far from every path are retained at the end in original order.
 */
export function orderPointCloudByStrokes(
  points: StrokePoint[],
  strokes: StrokePoint[][],
  neighborhoodRadius = 12
): StrokePoint[] {
  if (!points.length || !strokes.length) return points.slice()

  const cellSize = Math.max(4, neighborhoodRadius)
  const cellKey = (x: number, y: number) => `${x},${y}`
  const grid = new Map<string, Array<{ strokeIndex: number; distance: number; point: StrokePoint }>>()

  strokes.forEach((stroke, strokeIndex) => {
    let distance = 0
    stroke.forEach((point, index) => {
      if (index > 0) distance += Math.hypot(point.x - stroke[index - 1].x, point.y - stroke[index - 1].y)
      const key = cellKey(Math.floor(point.x / cellSize), Math.floor(point.y / cellSize))
      const bucket = grid.get(key)
      const item = { strokeIndex, distance, point }
      if (bucket) bucket.push(item)
      else grid.set(key, [item])
    })
  })

  const ordered: Array<{ point: StrokePoint; strokeIndex: number; distance: number; index: number }> = []
  const unmatched: Array<{ point: StrokePoint; index: number }> = []
  const radiusSquared = neighborhoodRadius * neighborhoodRadius

  points.forEach((point, index) => {
    const gx = Math.floor(point.x / cellSize)
    const gy = Math.floor(point.y / cellSize)
    let best: { strokeIndex: number; distance: number; point: StrokePoint } | undefined
    let bestDistanceSquared = radiusSquared
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        for (const candidate of grid.get(cellKey(gx + ox, gy + oy)) ?? []) {
          const dx = point.x - candidate.point.x
          const dy = point.y - candidate.point.y
          const distanceSquared = dx * dx + dy * dy
          if (distanceSquared < bestDistanceSquared) {
            bestDistanceSquared = distanceSquared
            best = candidate
          }
        }
      }
    }
    if (best) ordered.push({ point, strokeIndex: best.strokeIndex, distance: best.distance, index })
    else unmatched.push({ point, index })
  })

  ordered.sort((a, b) => a.strokeIndex - b.strokeIndex || a.distance - b.distance || a.index - b.index)
  unmatched.sort((a, b) => a.index - b.index)
  return ordered.map(item => item.point).concat(unmatched.map(item => item.point))
}
