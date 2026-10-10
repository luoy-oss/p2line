/**
 * Raster skeleton -> stroke paths.
 *
 * This module intentionally works on the thresholded edge mask instead of a
 * down-sampled point list: sampling first can destroy connectivity at junctions.
 * Coordinates returned by reconstructStrokePaths are crop-local.
 */
export interface StrokePoint {
  x: number
  y: number
}

export type StrokeDirectionStrategy = 'natural' | 'shortest' | 'trace'

export interface StrokeReconstructionOptions {
  /** Direction/order policy for reconstructed paths. */
  directionStrategy?: StrokeDirectionStrategy
  /** Zhang-Suen thinning iteration limit. */
  maxThinningIterations?: number
  /** Drop short branches shorter than this many pixels. Set 0 to keep all. */
  minPathLength?: number
  /** Simplification tolerance in pixels. */
  simplifyTolerance?: number
  /** Resampling interval for the animation path. */
  sampleSpacing?: number
  /** Use 8-connected pixels; diagonal shortcuts are suppressed when an
   * orthogonal connection already exists. */
  diagonalConnectivity?: boolean
  /** Progress callback used by workers; values are monotonic in [0, 1]. */
  onProgress?: (progress: number, stage: string) => void
}

export interface StrokeReconstructionResult {
  strokes: StrokePoint[][]
  diagnostics: {
    sourcePixels: number
    skeletonPixels: number
    rawPaths: number
    outputPaths: number
    junctionPixels: number
    endpoints: number
    closedLoops: number
  }
}

type Rect = { x: number; y: number; w: number; h: number }

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],             [1, 0],
  [-1, 1],  [0, 1],   [1, 1]
]

function inRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && y >= rect.y &&
    x < rect.x + rect.w && y < rect.y + rect.h
}

function neighborCount(mask: Uint8Array, width: number, x: number, y: number, rect: Rect): number {
  let count = 0
  for (const [dx, dy] of NEIGHBORS) {
    const nx = x + dx
    const ny = y + dy
    if (inRect(nx, ny, rect) && mask[ny * width + nx]) count++
  }
  return count
}

/** Zhang-Suen thinning. Input is a 0/1 mask; the input array is not mutated. */
export function thinBinaryMask(
  input: Uint8Array,
  width: number,
  height: number,
  rect: Rect,
  maxIterations = 80,
  onIteration?: (iteration: number, maxIterations: number) => void
): Uint8Array {
  if (width <= 0 || height <= 0 || input.length !== width * height) {
    throw new Error('Invalid mask dimensions')
  }
  const mask = input.slice()
  const marks: number[] = []
  const at = (x: number, y: number) => mask[y * width + x]

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let changed = false
    for (let phase = 0; phase < 2; phase++) {
      marks.length = 0
      for (let y = Math.max(1, rect.y); y < Math.min(height - 1, rect.y + rect.h); y++) {
        for (let x = Math.max(1, rect.x); x < Math.min(width - 1, rect.x + rect.w); x++) {
          const idx = y * width + x
          if (!mask[idx]) continue

          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1)
          const p4 = at(x + 1, y), p5 = at(x + 1, y + 1)
          const p6 = at(x, y + 1), p7 = at(x - 1, y + 1)
          const p8 = at(x - 1, y), p9 = at(x - 1, y - 1)
          const ring = [p2, p3, p4, p5, p6, p7, p8, p9]
          const count = ring.reduce((sum, value) => sum + value, 0)
          if (count < 2 || count > 6) continue

          let transitions = 0
          for (let i = 0; i < ring.length; i++) {
            if (ring[i] === 0 && ring[(i + 1) % ring.length] === 1) transitions++
          }
          if (transitions !== 1) continue

          const conditionA = phase === 0
            ? p2 * p4 * p6 === 0
            : p2 * p4 * p8 === 0
          const conditionB = phase === 0
            ? p4 * p6 * p8 === 0
            : p2 * p6 * p8 === 0
          if (conditionA && conditionB) marks.push(idx)
        }
      }
      if (marks.length) {
        changed = true
        for (const idx of marks) mask[idx] = 0
      }
    }
    onIteration?.(iteration + 1, maxIterations)
    if (!changed) break
  }
  return mask
}

function getPixelNeighbors(
  mask: Uint8Array,
  width: number,
  height: number,
  rect: Rect,
  idx: number,
  diagonalConnectivity: boolean
): number[] {
  const x = idx % width
  const y = Math.floor(idx / width)
  const result: number[] = []
  for (const [dx, dy] of NEIGHBORS) {
    const nx = x + dx, ny = y + dy
    if (!inRect(nx, ny, rect) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue
    if (!mask[ny * width + nx]) continue

    // Avoid a diagonal shortcut across a corner when an orthogonal pixel
    // already provides connectivity. This greatly reduces false junctions.
    if (dx !== 0 && dy !== 0 && !diagonalConnectivity) {
      if (mask[y * width + nx] || mask[ny * width + x]) continue
    }
    result.push(ny * width + nx)
  }
  return result
}

function simplifyPath(points: StrokePoint[], tolerance: number): StrokePoint[] {
  if (points.length <= 2 || tolerance <= 0) return points.slice()
  const first = points[0], last = points[points.length - 1]
  let maxDistance = 0, split = 0
  const vx = last.x - first.x, vy = last.y - first.y
  const length2 = vx * vx + vy * vy

  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    const t = length2 === 0 ? 0 : Math.max(0, Math.min(1,
      ((p.x - first.x) * vx + (p.y - first.y) * vy) / length2))
    const dx = p.x - (first.x + t * vx)
    const dy = p.y - (first.y + t * vy)
    const d = Math.hypot(dx, dy)
    if (d > maxDistance) { maxDistance = d; split = i }
  }
  if (maxDistance <= tolerance) return [first, last]
  const left = simplifyPath(points.slice(0, split + 1), tolerance)
  const right = simplifyPath(points.slice(split), tolerance)
  return left.slice(0, -1).concat(right)
}

function resamplePath(points: StrokePoint[], spacing: number): StrokePoint[] {
  if (points.length < 2 || spacing <= 0) return points.slice()
  const output: StrokePoint[] = [{ ...points[0] }]
  let carry = 0
  for (let i = 1; i < points.length; i++) {
    let a = points[i - 1]
    const b = points[i]
    let remaining = Math.hypot(b.x - a.x, b.y - a.y)
    if (!remaining) continue
    while (carry + remaining >= spacing) {
      const needed = spacing - carry
      const t = needed / remaining
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      output.push(p)
      a = p
      remaining = Math.hypot(b.x - a.x, b.y - a.y)
      carry = 0
    }
    carry += remaining
  }
  const last = points[points.length - 1]
  const tail = output[output.length - 1]
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > 1e-6) output.push({ ...last })
  return output
}

function pathLength(path: StrokePoint[]): number {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
  }
  return total
}

/**
 * Pick a conventional direction for an open stroke.
 *
 * Dominantly vertical strokes run top-to-bottom; dominantly horizontal strokes
 * run left-to-right. Diagonal strokes use the top-most endpoint, with x as a
 * tie-breaker. Closed loops have no meaningful start/end, so keep their traced
 * direction rather than introducing an arbitrary reversal.
 */
export function orientStrokeDirection(path: StrokePoint[]): StrokePoint[] {
  if (path.length < 2) return path.slice()
  const first = path[0]
  const last = path[path.length - 1]
  const dx = Math.abs(last.x - first.x)
  const dy = Math.abs(last.y - first.y)

  // A traced loop may end next to its starting pixel without repeating it.
  if (Math.hypot(last.x - first.x, last.y - first.y) <= 1.5) return path.slice()

  let shouldReverse = false
  if (dy > dx * 1.15) {
    shouldReverse = last.y < first.y
  } else if (dx > dy * 1.15) {
    shouldReverse = last.x < first.x
  } else {
    shouldReverse = last.y < first.y ||
      (last.y === first.y && last.x < first.x)
  }

  return shouldReverse ? path.slice().reverse() : path.slice()
}

/**
 * Apply a direction/order policy to reconstructed paths.
 *
 * natural: canonicalize open paths, then choose the nearest canonical start.
 * shortest: greedily choose the nearest endpoint and reverse open paths when
 * that lowers pen-up travel. This is a fast heuristic, not a global optimum.
 * trace: preserve skeleton traversal direction and discovery order.
 */
export function orderStrokePaths(
  paths: StrokePoint[][],
  strategy: StrokeDirectionStrategy = 'natural'
): StrokePoint[][] {
  const remaining = paths.filter(path => path.length >= 2).map(path => path.slice())
  if (!remaining.length) return []
  if (strategy === 'trace') return remaining

  const isClosed = (path: StrokePoint[]) =>
    path.length > 2 &&
    Math.hypot(path[0].x - path[path.length - 1].x, path[0].y - path[path.length - 1].y) <= 1.5

  if (strategy === 'natural') {
    for (let i = 0; i < remaining.length; i++) remaining[i] = orientStrokeDirection(remaining[i])
    remaining.sort((a, b) => a[0].y - b[0].y || a[0].x - b[0].x)
  } else {
    // Seed from the upper-left-most component for repeatable output.
    remaining.sort((a, b) => {
      const pa = a[0], pb = b[0]
      return pa.y - pb.y || pa.x - pb.x
    })
  }

  const ordered: StrokePoint[][] = [remaining.shift()!]
  while (remaining.length) {
    const end = ordered[ordered.length - 1][ordered[ordered.length - 1].length - 1]
    let bestIndex = 0
    let bestReverse = false
    let bestCost = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const path = remaining[i]
      const start = path[0]
      const startCost = (end.x - start.x) ** 2 + (end.y - start.y) ** 2
      if (startCost < bestCost) {
        bestCost = startCost
        bestIndex = i
        bestReverse = false
      }
      if (strategy === 'shortest' && !isClosed(path)) {
        const last = path[path.length - 1]
        const endCost = (end.x - last.x) ** 2 + (end.y - last.y) ** 2
        if (endCost < bestCost) {
          bestCost = endCost
          bestIndex = i
          bestReverse = true
        }
      }
    }
    const [next] = remaining.splice(bestIndex, 1)
    ordered.push(bestReverse ? next.reverse() : next)
  }
  return ordered
}

/**
 * Trace the skeleton as maximal edge-disjoint chains. Junctions deliberately
 * terminate chains instead of arbitrarily consuming one neighbor; this avoids
 * losing branches. A junction can split one conceptual brush stroke into
 * segments, because the original stroke identity is not encoded in a raster.
 */
export function traceSkeletonPaths(
  skeleton: Uint8Array,
  width: number,
  height: number,
  rect: Rect,
  diagonalConnectivity = false,
  onProgress?: (progress: number) => void
): { paths: StrokePoint[][]; endpoints: number; junctionPixels: number; closedLoops: number } {
  const neighbors = new Map<number, number[]>()
  let endpoints = 0, junctionPixels = 0
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const idx = y * width + x
      if (!skeleton[idx]) continue
      const list = getPixelNeighbors(skeleton, width, height, rect, idx, diagonalConnectivity)
      neighbors.set(idx, list)
      if (list.length === 1) endpoints++
      if (list.length >= 3) junctionPixels++
    }
    if ((y - rect.y) % 32 === 0) onProgress?.((y - rect.y) / rect.h)
  }

  const visitedEdges = new Set<string>()
  const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`
  const paths: StrokePoint[][] = []
  const toPoint = (idx: number): StrokePoint => ({ x: idx % width - rect.x, y: Math.floor(idx / width) - rect.y })

  const walk = (start: number, next: number) => {
    const path = [toPoint(start)]
    let previous = start, current = next
    visitedEdges.add(edgeKey(previous, current))
    path.push(toPoint(current))
    while (true) {
      const list = neighbors.get(current) ?? []
      if (list.length !== 2) break
      const candidate = list[0] === previous ? list[1] : list[0]
      const key = edgeKey(current, candidate)
      if (visitedEdges.has(key)) break
      visitedEdges.add(key)
      previous = current
      current = candidate
      path.push(toPoint(current))
    }
    return path
  }

  // Begin at all non-degree-2 pixels (endpoints/junctions).
  for (const [idx, list] of neighbors) {
    if (list.length === 2) continue
    for (const next of list) {
      if (visitedEdges.has(edgeKey(idx, next))) continue
      const path = walk(idx, next)
      if (path.length >= 2) paths.push(path)
    }
  }

  // Remaining edges are closed loops or components without endpoints.
  let closedLoops = 0
  for (const [idx, list] of neighbors) {
    for (const next of list) {
      if (visitedEdges.has(edgeKey(idx, next))) continue
      const path = walk(idx, next)
      if (path.length >= 3) {
        closedLoops++
        paths.push(path)
      }
    }
  }

  return { paths, endpoints, junctionPixels, closedLoops }
}

export function reconstructStrokePaths(
  edge: Uint8Array,
  width: number,
  height: number,
  rect: Rect = { x: 0, y: 0, w: width, h: height },
  options: StrokeReconstructionOptions = {}
): StrokeReconstructionResult {
  if (width <= 0 || height <= 0 || edge.length !== width * height) {
    throw new Error('edge.length must equal width * height')
  }
  if (rect.x < 0 || rect.y < 0 || rect.w <= 0 || rect.h <= 0 ||
      rect.x + rect.w > width || rect.y + rect.h > height) {
    throw new Error('rect is outside the image bounds')
  }

  const sourcePixels = edge.reduce((sum, value) => sum + (value ? 1 : 0), 0)
  if (!sourcePixels) {
    return {
      strokes: [],
      diagnostics: { sourcePixels: 0, skeletonPixels: 0, rawPaths: 0, outputPaths: 0, junctionPixels: 0, endpoints: 0, closedLoops: 0 }
    }
  }

  options.onProgress?.(0.02, '准备骨架')
  const maxIterations = options.maxThinningIterations ?? 80
  const skeleton = thinBinaryMask(edge, width, height, rect, maxIterations, (iteration, total) => {
    options.onProgress?.(0.04 + 0.58 * iteration / total, '骨架细化')
  })
  let skeletonPixels = 0
  for (const value of skeleton) skeletonPixels += value ? 1 : 0

  options.onProgress?.(0.64, '提取路径拓扑')
  const traced = traceSkeletonPaths(skeleton, width, height, rect, options.diagonalConnectivity ?? false, progress => {
    options.onProgress?.(0.64 + 0.16 * progress, '提取路径拓扑')
  })
  options.onProgress?.(0.82, '简化与重采样')
  const minLength = Math.max(0, options.minPathLength ?? 3)
  const simplified = traced.paths
    .filter(path => pathLength(path) >= minLength)
    .map(path => {
      const reduced = simplifyPath(path, options.simplifyTolerance ?? 0.65)
      return resamplePath(reduced, options.sampleSpacing ?? 1.5)
    })
    .filter(path => path.length >= 2)

  options.onProgress?.(0.94, '笔画排序')
  const strokes = orderStrokePaths(simplified, options.directionStrategy ?? 'natural')
  options.onProgress?.(1, '完成')
  return {
    strokes,
    diagnostics: {
      sourcePixels,
      skeletonPixels,
      rawPaths: traced.paths.length,
      outputPaths: strokes.length,
      junctionPixels: traced.junctionPixels,
      endpoints: traced.endpoints,
      closedLoops: traced.closedLoops
    }
  }
}

/** Serialize versioned stroke data; keeps legacy flat point JSON untouched. */
export function serializeStrokePaths(
  strokes: StrokePoint[][],
  strategy: StrokeDirectionStrategy = 'natural'
): string {
  const ordering = strategy === 'natural'
    ? 'natural-direction-nearest-start'
    : strategy === 'shortest'
      ? 'greedy-minimum-pen-up-travel'
      : 'skeleton-trace-order'
  return JSON.stringify({
    version: 2,
    coordinateSystem: 'crop-local',
    strategy,
    ordering,
    strokes
  }, null, 2)
}
