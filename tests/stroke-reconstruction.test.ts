import { describe, expect, it } from 'vitest'
import {
  reconstructStrokePaths,
  serializeStrokePaths,
  thinBinaryMask
} from '../src/utils/stroke-reconstruction'

describe('stroke reconstruction', () => {
  it('returns a valid empty result for an empty mask', () => {
    const result = reconstructStrokePaths(new Uint8Array(25), 5, 5)
    expect(result.strokes).toEqual([])
    expect(result.diagnostics.sourcePixels).toBe(0)
  })

  it('keeps a straight skeleton as a continuous path with crop-local coordinates', () => {
    const width = 9
    const height = 7
    const mask = new Uint8Array(width * height)
    for (let x = 1; x <= 7; x++) mask[3 * width + x] = 1

    const result = reconstructStrokePaths(mask, width, height, { x: 1, y: 1, w: 7, h: 5 }, {
      minPathLength: 0,
      simplifyTolerance: 0,
      sampleSpacing: 1
    })

    expect(result.strokes).toHaveLength(1)
    expect(result.strokes[0].length).toBeGreaterThanOrEqual(2)
    expect(result.strokes[0][0].y).toBe(2)
    expect(result.strokes[0][result.strokes[0].length - 1].y).toBe(2)
    expect(result.diagnostics.endpoints).toBe(2)
  })

  it('does not mutate the source mask while thinning', () => {
    const mask = new Uint8Array(25)
    for (let y = 1; y < 4; y++) {
      for (let x = 1; x < 4; x++) mask[y * 5 + x] = 1
    }
    const original = mask.slice()
    thinBinaryMask(mask, 5, 5, { x: 0, y: 0, w: 5, h: 5 })
    expect(mask).toEqual(original)
  })

  it('exports a versioned stroke document', () => {
    const json = JSON.parse(serializeStrokePaths([[{ x: 1, y: 2 }, { x: 3, y: 4 }]]))
    expect(json.version).toBe(2)
    expect(json.coordinateSystem).toBe('crop-local')
    expect(json.strokes[0]).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }])
  })

  it('rejects mismatched mask dimensions', () => {
    expect(() => reconstructStrokePaths(new Uint8Array(3), 2, 2)).toThrow(/width \* height/)
  })
})
