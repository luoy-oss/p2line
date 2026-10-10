import type { StrokePoint } from './stroke-reconstruction'

export interface OrderedPointCloudResult {
  points: StrokePoint[]
  assignedCount: number
  unassignedCount: number
}

/**
 * Order the existing point cloud using reconstructed skeleton paths as a
 * spatial guide. Coordinates and point multiplicity are preserved exactly.
 * Unmatched points remain at the end in their original relative order.
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
  const key = (x: number, y: number) => `${x},${y}`
  const grid = new Map<string, Array<{ strokeIndex: number; distance: number; point: StrokePoint }>>()

  strokes.forEach((stroke, strokeIndex) => {
    let distance = 0
    stroke.forEach((point, i) => {
      if (i > 0) distance += Math.hypot(point.x - stroke[i - 1].x, point.y - stroke[i - 1].y)
      const item = { strokeIndex, distance, point }
      const gx = Math.floor(point.x / cellSize)
      const gy = Math.floor(point.y / cellSize)
      const cell = key(gx, gy)
      const bucket = grid.get(cell)
      if (bucket) bucket.push(item)
      else grid.set(cell, [item])
    })
  })

  const assigned: Array<{ point: StrokePoint; strokeIndex: number; distance: number; index: number }> = []
  const unmatched: Array<{ point: StrokePoint; index: number }> = []
  const maxDistance2 = neighborhoodRadius * neighborhoodRadius

  points.forEach((point, index) => {
    const gx = Math.floor(point.x / cellSize)
    const gy = Math.floor(point.y / cellSize)
    let best: { strokeIndex: number; distance: number; point: StrokePoint } | undefined
    let bestDistance2 = maxDistance2
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        for (const candidate of grid.get(key(gx + ox, gy + oy)) ?? []) {
          const dx = point.x - candidate.point.x
          const dy = point.y - candidate.point.y
          const d2 = dx * dx + dy * dy
          if (d2 < bestDistance2) {
            bestDistance2 = d2
            best = candidate
          }
        }
      }
    }
    if (best) assigned.push({ point, strokeIndex: best.strokeIndex, distance: best.distance, index })
    else unmatched.push({ point, index })
  })

  assigned.sort((a, b) => a.strokeIndex - b.strokeIndex || a.distance - b.distance || a.index - b.index)
  unmatched.sort((a, b) => a.index - b.index)
  return {
    points: assigned.map(item => item.point).concat(unmatched.map(item => item.point)),
    assignedCount: assigned.length,
    unassignedCount: unmatched.length
  }
}

/** Progressively paint the original point coordinates; no connecting lines. */
export function animateOriginalPointCloud(
  canvas: HTMLCanvasElement,
  points: StrokePoint[],
  rect: { x: number; y: number; w: number; h: number },
  invert: boolean,
  maxSize: number,
  onProgress?: (shown: number) => void
): () => void {
  const scale = Math.min(maxSize / Math.max(1, rect.w), maxSize / Math.max(1, rect.h))
  canvas.width = Math.max(1, Math.round(rect.w * scale))
  canvas.height = Math.max(1, Math.round(rect.h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => undefined
  ctx.fillStyle = invert ? '#111827' : '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const radius = Math.max(1, Math.min(2.8, scale * 0.75))
  const batchSize = Math.max(1, Math.ceil(points.length / 240))
  let shown = 0
  let frame = 0
  let cancelled = false

  const draw = () => {
    if (cancelled) return
    const end = Math.min(points.length, shown + batchSize)
    for (; shown < end; shown++) {
      const point = points[shown]
      const ratio = points.length <= 1 ? 1 : shown / (points.length - 1)
      // A restrained color ramp makes the sequence visible without moving points.
      const hue = Math.round(210 - ratio * 170)
      ctx.fillStyle = `hsl(${hue} 68% 42%)`
      ctx.beginPath()
      ctx.arc(point.x * scale, point.y * scale, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    onProgress?.(shown)
    if (shown < points.length) frame = requestAnimationFrame(draw)
  }
  frame = requestAnimationFrame(draw)
  return () => {
    cancelled = true
    cancelAnimationFrame(frame)
  }
}
