import type { StrokeDirectionStrategy, StrokePoint, StrokeReconstructionResult } from './stroke-reconstruction'

export interface OrderedStrokeWorkerResult {
  strokes: StrokePoint[][]
  pointCount: number
  json: string
  diagnostics: StrokeReconstructionResult['diagnostics']
}

export interface StrokeProgress {
  progress: number
  stage: string
}

/**
 * Run CPU-heavy skeletonization/path reconstruction off the UI thread.
 * The edge buffer is transferred (not copied), so the caller must not reuse it.
 */
export function buildOrderedStrokeExportInWorker(
  edge: Uint8Array,
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number },
  sampleSpacing: number,
  strategy: StrokeDirectionStrategy,
  onProgress: (progress: StrokeProgress) => void
): Promise<OrderedStrokeWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./stroke-reconstruction.worker.ts', import.meta.url), { type: 'module' })
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      worker.terminate()
    }
    worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      const message = event.data
      if (message.type === 'progress') {
        onProgress({
          progress: Math.max(0, Math.min(1, Number(message.progress) || 0)),
          stage: String(message.stage || '正在计算')
        })
      } else if (message.type === 'result') {
        finish()
        resolve(message as unknown as OrderedStrokeWorkerResult)
      } else if (message.type === 'error') {
        finish()
        reject(new Error(String(message.message || '笔画重建失败')))
      }
    }
    worker.onerror = event => {
      finish()
      reject(new Error(event.message || '笔画计算 Worker 异常'))
    }
    worker.postMessage({
      edge: edge.buffer,
      width,
      height,
      rect,
      sampleSpacing,
      strategy
    }, [edge.buffer])
  })
}
