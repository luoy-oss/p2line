import {
  reconstructStrokePaths,
  serializeStrokePaths,
  type StrokePoint,
  type StrokeDirectionStrategy
} from './stroke-reconstruction'

export interface OrderedStrokeExport {
  strokes: StrokePoint[][]
  pointCount: number
  json: string
}

/**
 * Reconstruct a pen-down sequence from the final binary line-art mask.
 * The result intentionally preserves pen-up boundaries as separate strokes;
 * flattening them into one array would create false connecting segments.
 */
export function buildOrderedStrokeExport(
  edge: Uint8Array,
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number },
  sampleSpacing: number,
  strategy: StrokeDirectionStrategy = 'natural'
): OrderedStrokeExport {
  const result = reconstructStrokePaths(edge, width, height, rect, {
    maxThinningIterations: 100,
    minPathLength: 0,
    simplifyTolerance: 0.35,
    sampleSpacing: Math.max(0.5, sampleSpacing),
    diagonalConnectivity: false,
    directionStrategy: strategy
  })
  const strokes = result.strokes
  return {
    strokes,
    pointCount: strokes.reduce((total, stroke) => total + stroke.length, 0),
    json: serializeStrokePaths(strokes, strategy)
  }
}
