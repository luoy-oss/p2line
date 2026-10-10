import type { StrokePoint } from './stroke-reconstruction'

export interface OrderedPointCloudResult {
  points: StrokePoint[]
  assignedCount: number
  unassignedCount: number
}

/**
 * Reorder an existing point cloud by reconstructed stroke paths without
 * replacing, smoothing, rounding, or otherwise modifying any source point.
 *
 * Each original point is associated with its nearest nearby reconstructed
 * skeleton vertex, then sorted by stroke discovery order and arc length.
 * Points that cannot be associated locally are preserved at the end in their
 * original relative order. This is a drawing-order heuristic, not recovery of
 * the source artist's actual pen order.
 */
export function orderPointCloudByStrokes(
  points: StrokePoint[],
  strokes: StrokePoint[][],
  neighborhoodRadius = 12
): OrderedPointCloudResult {
  if (points.length === 0 || strokes.length === 0) {
    return { points: points.slice(), assignedCount: 0, unassignedCount: points.length }
  }

  const cellSize = Math.max(4, neighborhoodRadius)
  const cellKey = (x: number, y: number) => `${x},${y}`
  const grid = new Map<string, Array<{ strokeIndex: number; distance: number; point: StrokePoint; distance2: number }>>()
  const radiusCells = Math.ceil(neighborhoodRadius / cellSize)
  const pathLengths: number[][] = []

  strokes.forEach((stroke, strokeIndex) => {
    const lengths: number[] = [0]
    for (let i = 1; i < stroke.length; i++) {
      lengths.push(lengths[i - 1] + Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y))
    }
    pathLengths.push(lengths)

    stroke.forEach((point, pointIndex) => {
      const gx = Math.floor(point.x / cellSize)
      const gy = Math.floor(point.y / cellSize)
      const item = { strokeIndex, distance: lengths[pointIndex], point, distance2: 0 }
      for (let oy = -radiusCells; oy <= radiusCells; oy++) {
        for (let ox = -radiusCells; ox <= radiusCells; ox++) {
          const key = cellKey(gx + ox, gy + oy)
          const bucket = grid.get(key)
          if (bucket) bucket.push(item)
          else grid.set(key, [item])
        }
      }
    })
  })

  const assigned: Array<{ point: StrokePoint; strokeIndex: number; distance: number; originalIndex: number }> = []
  const unassigned: Array<{ point: StrokePoint; originalIndex: number }> = []

  points.forEach((point, originalIndex) => {
    const gx = Math.floor(point.x / cellSize)
    const gy = Math.floor(point.y / cellSize)
    let best: { strokeIndex: number; distance: number; point: StrokePoint } | undefined
    let bestDistance2 = neighborhoodRadius * neighborhoodRadius
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const bucket = grid.get(cellKey(gx + ox, gy + oy))
        if (!bucket) continue
        for (const candidate of bucket) {
          const dx = point.x - candidate.point.x
          const dy = point.y - candidate.point.y
          const distance2 = dx * dx + dy * dy
          if (distance2 < bestDistance2) {
            bestDistance2 = distance2
            best = candidate
          }
        }
      }
    }
    if (best) assigned.push({ point, strokeIndex: best.strokeIndex, distance: best.distance, originalIndex })
    else unassigned.push({ point, originalIndex })
  })

  assigned.sort((a, b) =>
    a.strokeIndex - b.strokeIndex ||
    a.distance - b.distance ||
    a.originalIndex - b.originalIndex
  )
  unassigned.sort((a, b) => a.originalIndex - b.originalIndex)

  return {
    points: assigned.map(item => item.point).concat(unassigned.map(item => item.point)),
    assignedCount: assigned.length,
    unassignedCount: unassigned.length
  }
}
