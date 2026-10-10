/// <reference lib="webworker" />
import { reconstructStrokePaths, serializeStrokePaths, type StrokeDirectionStrategy } from './stroke-reconstruction'

type Request = {
  edge: ArrayBuffer
  width: number
  height: number
  rect: { x: number; y: number; w: number; h: number }
  sampleSpacing: number
  strategy: StrokeDirectionStrategy
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { edge, width, height, rect, sampleSpacing, strategy } = event.data
  try {
    const result = reconstructStrokePaths(
      new Uint8Array(edge),
      width,
      height,
      rect,
      {
        maxThinningIterations: 100,
        minPathLength: 0,
        simplifyTolerance: 0.35,
        sampleSpacing: Math.max(0.5, sampleSpacing),
        diagonalConnectivity: false,
        directionStrategy: strategy,
        onProgress: (progress, stage) => self.postMessage({ type: 'progress', progress, stage })
      }
    )
    const pointCount = result.strokes.reduce((total, stroke) => total + stroke.length, 0)
    self.postMessage({
      type: 'result',
      strokes: result.strokes,
      pointCount,
      json: serializeStrokePaths(result.strokes, strategy),
      diagnostics: result.diagnostics
    })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
