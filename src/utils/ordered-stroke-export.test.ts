import { describe, expect, it } from 'vitest'
import { buildOrderedStrokeExport } from './ordered-stroke-export'

describe('buildOrderedStrokeExport', () => {
  it('exports a versioned sequence with explicit stroke boundaries', () => {
    const width = 9
    const height = 9
    const mask = new Uint8Array(width * height)
    for (let x = 2; x <= 6; x++) mask[4 * width + x] = 1

    const result = buildOrderedStrokeExport(
      mask,
      width,
      height,
      { x: 0, y: 0, w: width, h: height },
      1
    )

    const parsed = JSON.parse(result.json)
    expect(parsed.version).toBe(2)
    expect(parsed.coordinateSystem).toBe('crop-local')
    expect(parsed.ordering).toBe('heuristic-minimum-pen-up-travel')
    expect(Array.isArray(parsed.strokes)).toBe(true)
    expect(result.pointCount).toBe(parsed.strokes.reduce(
      (sum: number, stroke: Array<{ x: number; y: number }>) => sum + stroke.length,
      0
    ))
    expect(result.pointCount).toBeGreaterThan(1)
    for (const stroke of parsed.strokes as Array<Array<{ x: number; y: number }>>) {
      expect(stroke.length).toBeGreaterThanOrEqual(2)
      for (const point of stroke) {
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.y).toBeGreaterThanOrEqual(0)
      }
    }
  })


  it('keeps disconnected line components as separate pen-down strokes', () => {
    const width = 12
    const height = 8
    const mask = new Uint8Array(width * height)
    for (let x = 1; x <= 4; x++) mask[2 * width + x] = 1
    for (let x = 7; x <= 10; x++) mask[5 * width + x] = 1

    const result = buildOrderedStrokeExport(
      mask,
      width,
      height,
      { x: 0, y: 0, w: width, h: height },
      1
    )
    const parsed = JSON.parse(result.json)
    expect(parsed.strokes.length).toBe(2)
    expect(parsed.strokes[0].length).toBeGreaterThanOrEqual(2)
    expect(parsed.strokes[1].length).toBeGreaterThanOrEqual(2)
  })

  it('returns an empty, valid stroke collection for an empty mask', () => {
    const result = buildOrderedStrokeExport(
      new Uint8Array(25),
      5,
      5,
      { x: 0, y: 0, w: 5, h: 5 },
      1
    )
    expect(JSON.parse(result.json).strokes).toEqual([])
    expect(result.pointCount).toBe(0)
  })
})
