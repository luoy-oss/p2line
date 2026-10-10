import { describe, expect, it } from 'vitest'
import { orderStrokePaths, orientStrokeDirection, type StrokePoint } from './stroke-reconstruction'

const p = (x: number, y: number): StrokePoint => ({ x, y })

describe('stroke direction strategies', () => {
  it('natural mode canonicalizes vertical and horizontal directions', () => {
    const ordered = orderStrokePaths([
      [p(4, 20), p(4, 2)],
      [p(20, 10), p(2, 10)]
    ], 'natural')
    expect(ordered[0][0]).toEqual(p(2, 10))
    expect(ordered[0][ordered[0].length - 1]).toEqual(p(20, 10))
    expect(ordered[1][0]).toEqual(p(4, 2))
    expect(ordered[1][ordered[1].length - 1]).toEqual(p(4, 20))
  })

  it('shortest mode may reverse an open stroke to reduce pen-up distance', () => {
    const first = [p(0, 0), p(0, 1)]
    const candidate = [p(100, 0), p(1, 1)]
    const ordered = orderStrokePaths([first, candidate], 'shortest')
    expect(ordered[1][0]).toEqual(p(1, 1))
    expect(ordered[1][ordered[1].length - 1]).toEqual(p(100, 0))
  })

  it('trace mode preserves path directions and discovery order', () => {
    const paths = [
      [p(9, 9), p(2, 2)],
      [p(5, 8), p(5, 1)]
    ]
    expect(orderStrokePaths(paths, 'trace')).toEqual(paths)
  })

  it('does not mutate input paths while ordering', () => {
    const input = [[p(5, 20), p(5, 2)], [p(1, 1), p(3, 1)]]
    const snapshot = input.map(path => path.map(point => ({ ...point })))
    orderStrokePaths(input, 'shortest')
    expect(input).toEqual(snapshot)
  })
})
