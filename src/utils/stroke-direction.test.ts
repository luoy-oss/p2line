import { describe, expect, it } from 'vitest'
import { orderStrokePaths, orientStrokeDirection, type StrokePoint } from './stroke-reconstruction'

const point = (x: number, y: number): StrokePoint => ({ x, y })

describe('natural stroke direction', () => {
  it('reverses a vertical stroke to top-to-bottom', () => {
    const input = [point(4, 18), point(4, 10), point(4, 2)]
    expect(orientStrokeDirection(input)).toEqual([
      point(4, 2), point(4, 10), point(4, 18)
    ])
  })

  it('reverses a horizontal stroke to left-to-right', () => {
    const input = [point(20, 6), point(10, 6), point(2, 6)]
    expect(orientStrokeDirection(input)).toEqual([
      point(2, 6), point(10, 6), point(20, 6)
    ])
  })

  it('starts a diagonal stroke at the upper endpoint', () => {
    const input = [point(14, 18), point(8, 10), point(2, 2)]
    expect(orientStrokeDirection(input)).toEqual([
      point(2, 2), point(8, 10), point(14, 18)
    ])
  })

  it('does not reverse a closed loop merely to reduce pen-up travel', () => {
    const loop = [point(4, 2), point(8, 5), point(4, 8), point(5, 3)]
    expect(orientStrokeDirection(loop)).toEqual(loop)
  })

  it('keeps canonical direction while ordering strokes by their next start', () => {
    const vertical = [point(5, 20), point(5, 2)]
    const horizontal = [point(1, 1), point(3, 1)]
    const ordered = orderStrokePaths([vertical, horizontal])
    expect(ordered[0]).toEqual([point(1, 1), point(3, 1)])
    expect(ordered[1]).toEqual([point(5, 2), point(5, 20)])
  })
})
