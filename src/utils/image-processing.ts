export type PointOrder = 'scan' | 'trace' | 'contour'

/**
 * 将图像数据转换为灰度缓冲区
 * @param imageData 原始图像数据
 * @returns 灰度值的 Float32Array (0-255)
 */
export function createGrayBuffer(imageData: ImageData) {
  const total = imageData.width * imageData.height
  const gray = new Float32Array(total)
  for (let i = 0; i < total; i += 1) {
    const offset = i * 4
    const r = imageData.data[offset]
    const g = imageData.data[offset + 1]
    const b = imageData.data[offset + 2]
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b
  }
  return gray
}

/**
 * 创建高斯模糊核
 * @param sigma 标准差
 */
export function createGaussianKernel(sigma: number) {
  const radius = Math.max(1, Math.round(sigma * 3))
  const size = radius * 2 + 1
  const kernel = new Float32Array(size)
  let sum = 0
  for (let i = -radius; i <= radius; i += 1) {
    const value = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel[i + radius] = value
    sum += value
  }
  for (let i = 0; i < kernel.length; i += 1) {
    kernel[i] /= sum
  }
  return { kernel, radius }
}

/**
 * 对灰度图像应用高斯模糊
 * @param gray 灰度数据
 * @param sigma 模糊半径
 */
export function gaussianBlur(gray: Float32Array, width: number, height: number, sigma: number) {
  if (sigma <= 0) {
    return gray
  }
  const { kernel, radius } = createGaussianKernel(sigma)
  const temp = new Float32Array(gray.length)
  const output = new Float32Array(gray.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      for (let k = -radius; k <= radius; k += 1) {
        const clamped = Math.min(width - 1, Math.max(0, x + k))
        sum += gray[y * width + clamped] * kernel[k + radius]
      }
      temp[y * width + x] = sum
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let sum = 0
      for (let k = -radius; k <= radius; k += 1) {
        const clamped = Math.min(height - 1, Math.max(0, y + k))
        sum += temp[clamped * width + x] * kernel[k + radius]
      }
      output[y * width + x] = sum
    }
  }
  return output
}

/**
 * 计算 XDOG 强度图
 * @param gray 灰度图
 * @param k 模糊倍率
 * @param tau 边缘强度权重
 * @param phi 软阈值参数
 * @param epsilon 阈值偏移
 */
export function createXdogStrength(
  gray: Float32Array,
  width: number,
  height: number,
  sigma: number,
  k: number,
  tau: number,
  phi: number,
  epsilon: number
) {
  const g1 = gaussianBlur(gray, width, height, sigma)
  const g2 = gaussianBlur(gray, width, height, sigma * k)
  const strength = new Float32Array(gray.length)
  for (let i = 0; i < gray.length; i += 1) {
    const dog = g1[i] - tau * g2[i]
    const edge = dog >= epsilon ? 1 : 1 + Math.tanh(phi * (dog - epsilon))
    const value = 1 - edge
    strength[i] = Math.min(1, Math.max(0, value))
  }
  return strength
}

/**
 * 根据强度图生成二值化边缘图
 * @param strength 强度图
 * @param threshold 阈值
 */
export function buildEdgeMapFromStrength(strength: Float32Array, threshold: number) {
  const edge = new Uint8Array(strength.length)
  for (let i = 0; i < strength.length; i += 1) {
    if (strength[i] >= threshold) {
      edge[i] = 1
    }
  }
  return edge
}

/**
 * 二值图像膨胀操作
 * @param iterations 迭代次数
 */
export function dilateBinary(edge: Uint8Array, width: number, height: number, iterations: number) {
  if (iterations <= 0) {
    return edge
  }
  let current = edge
  for (let iter = 0; iter < iterations; iter += 1) {
    const next = new Uint8Array(current.length)
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const idx = y * width + x
        if (current[idx] === 1) {
          next[idx] = 1
          next[idx - 1] = 1
          next[idx + 1] = 1
          next[idx - width] = 1
          next[idx + width] = 1
          next[idx - width - 1] = 1
          next[idx - width + 1] = 1
          next[idx + width - 1] = 1
          next[idx + width + 1] = 1
        }
      }
    }
    current = next
  }
  return current
}

/**
 * 二值图像腐蚀操作
 * @param iterations 迭代次数
 */
export function erodeBinary(edge: Uint8Array, width: number, height: number, iterations: number) {
  if (iterations <= 0) {
    return edge
  }
  let current = edge
  for (let iter = 0; iter < iterations; iter += 1) {
    const next = new Uint8Array(current.length)
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const idx = y * width + x
        if (current[idx] === 0) {
          continue
        }
        const neighbors =
          current[idx - 1] +
          current[idx + 1] +
          current[idx - width] +
          current[idx + width] +
          current[idx - width - 1] +
          current[idx - width + 1] +
          current[idx + width - 1] +
          current[idx + width + 1]
        if (neighbors === 8) {
          next[idx] = 1
        }
      }
    }
    current = next
  }
  return current
}

/**
 * 移除孤立噪点
 * 保留至少有2个邻居的像素
 */
export function removeIsolated(edge: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(edge.length)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x
      if (edge[idx] === 0) {
        continue
      }
      const neighbors =
        edge[idx - 1] +
        edge[idx + 1] +
        edge[idx - width] +
        edge[idx + width] +
        edge[idx - width - 1] +
        edge[idx - width + 1] +
        edge[idx + width - 1] +
        edge[idx + width + 1]
      if (neighbors >= 2) {
        output[idx] = 1
      }
    }
  }
  return output
}

/**
 * 闭运算（先膨胀后腐蚀），用于连接断线
 */
export function closeGaps(edge: Uint8Array, width: number, height: number, iterations: number) {
  const dilated = dilateBinary(edge, width, height, iterations)
  return erodeBinary(dilated, width, height, iterations)
}

/**
 * 边缘图膨胀，用于加粗线条
 */
export function dilateEdgeMap(edge: Uint8Array, width: number, height: number, iterations: number) {
  if (iterations <= 1) {
    return edge
  }
  let current = edge
  for (let iter = 1; iter < iterations; iter += 1) {
    const next = new Uint8Array(current.length)
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const idx = y * width + x
        if (current[idx] === 1) {
          next[idx] = 1
          next[idx - 1] = 1
          next[idx + 1] = 1
          next[idx - width] = 1
          next[idx + width] = 1
        }
      }
    }
    current = next
  }
  return current
}

/**
 * 生成最终输出图像
 * @param darkness 线条暗度
 * @param invert 是否反色
 */
export function buildOutputImage(
  edge: Uint8Array,
  width: number,
  height: number,
  darkness: number,
  invert: boolean
) {
  const data = new Uint8ClampedArray(width * height * 4)
  const alpha = Math.round(Math.min(1, Math.max(0, darkness)) * 255)
  for (let i = 0; i < edge.length; i += 1) {
    const offset = i * 4
    if (edge[i] === 1) {
      const line = invert ? 255 : 0
      data[offset] = line
      data[offset + 1] = line
      data[offset + 2] = line
      data[offset + 3] = alpha
    } else {
      const background = invert ? 0 : 255
      data[offset] = background
      data[offset + 1] = background
      data[offset + 2] = background
      data[offset + 3] = 255
    }
  }
  return new ImageData(data, width, height)
}

/**
 * 生成 SVG 字符串
 */
export function buildSvg(
  edge: Uint8Array,
  width: number,
  height: number,
  step: number,
  thickness: number,
  darkness: number,
  invert: boolean,
  rect?: { x: number; y: number; w: number; h: number }
) {
  const startX = rect ? rect.x : 0
  const startY = rect ? rect.y : 0
  const endX = rect ? rect.x + rect.w : width
  const endY = rect ? rect.y + rect.h : height
  const outWidth = rect ? rect.w : width
  const outHeight = rect ? rect.h : height
  let pathData = ''
  for (let y = startY; y < endY; y += step) {
    for (let x = startX; x < endX; x += step) {
      const idx = y * width + x
      if (edge[idx] === 1) {
        pathData += `M${x - startX} ${y - startY}h1`
      }
    }
  }
  const stroke = invert ? 'white' : 'black'
  const background = invert ? 'black' : 'white'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${outWidth}" height="${outHeight}" viewBox="0 0 ${outWidth} ${outHeight}"><rect width="100%" height="100%" fill="${background}"/><path d="${pathData}" stroke="${stroke}" stroke-width="${thickness}" stroke-linecap="round" stroke-opacity="${darkness}" fill="none"/></svg>`
}

/**
 * 追踪边缘路径（用于路径化点集生成）
 * 寻找所有连通的线条路径
 */
export function traceEdgePaths(edge: Uint8Array, width: number, height: number, rect: { x: number; y: number; w: number; h: number }) {
  const visited = new Uint8Array(edge.length)
  const paths: Array<Array<{ x: number; y: number }>> = []
  const x0 = rect.x
  const y0 = rect.y
  const x1 = rect.x + rect.w
  const y1 = rect.y + rect.h
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ]
  const getNeighbors = (x: number, y: number) => {
    const list: number[] = []
    for (const [dx, dy] of offsets) {
      const nx = x + dx
      const ny = y + dy
      if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) {
        continue
      }
      const nidx = ny * width + nx
      if (edge[nidx] === 1) {
        list.push(nidx)
      }
    }
    return list
  }
  const walk = (startIdx: number) => {
    const path: Array<{ x: number; y: number }> = []
    let current = startIdx
    let prev = -1
    while (true) {
      if (visited[current] === 1) {
        break
      }
      visited[current] = 1
      const x = current % width
      const y = Math.floor(current / width)
      path.push({ x: x - x0, y: y - y0 })
      const neighbors = getNeighbors(x, y).filter((nidx) => nidx !== prev)
      const next = neighbors.find((nidx) => visited[nidx] === 0)
      if (next === undefined) {
        break
      }
      prev = current
      current = next
    }
    if (path.length > 0) {
      paths.push(path)
    }
  }
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const idx = y * width + x
      if (edge[idx] === 0 || visited[idx] === 1) {
        continue
      }
      const neighbors = getNeighbors(x, y)
      if (neighbors.length <= 1) {
        walk(idx)
      }
    }
  }
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const idx = y * width + x
      if (edge[idx] === 1 && visited[idx] === 0) {
        walk(idx)
      }
    }
  }
  return paths
}

/**
 * 寻找最大的连通边缘组件
 * @returns 最大组件的像素索引数组
 */
export function findLargestEdgeComponent(edge: Uint8Array, width: number, height: number, rect: { x: number; y: number; w: number; h: number }) {
  const visited = new Uint8Array(edge.length)
  const x0 = rect.x
  const y0 = rect.y
  const x1 = rect.x + rect.w
  const y1 = rect.y + rect.h
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ]
  let bestIndices: number[] = []
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const startIdx = y * width + x
      if (edge[startIdx] === 0 || visited[startIdx] === 1) {
        continue
      }
      const stack = [startIdx]
      const indices: number[] = []
      visited[startIdx] = 1
      while (stack.length > 0) {
        const idx = stack.pop() as number
        indices.push(idx)
        const cx = idx % width
        const cy = Math.floor(idx / width)
        for (const [dx, dy] of offsets) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) {
            continue
          }
          const nidx = ny * width + nx
          if (edge[nidx] === 1 && visited[nidx] === 0) {
            visited[nidx] = 1
            stack.push(nidx)
          }
        }
      }
      if (indices.length > bestIndices.length) {
        bestIndices = indices
      }
    }
  }
  return bestIndices
}

/**
 * 构建顺时针外轮廓点集
 * 用于轮廓绘制模式
 */
export function buildClockwiseOuterContourPoints(
  outerMask: Uint8Array,
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number }
) {
  const x0 = rect.x
  const y0 = rect.y
  const x1 = rect.x + rect.w
  const y1 = rect.y + rect.h
  const boundary: Array<{ x: number; y: number }> = []
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const idx = y * width + x
      if (outerMask[idx] === 0) {
        continue
      }
      const up = y > y0 ? outerMask[(y - 1) * width + x] : 0
      const down = y < y1 - 1 ? outerMask[(y + 1) * width + x] : 0
      const left = x > x0 ? outerMask[y * width + (x - 1)] : 0
      const right = x < x1 - 1 ? outerMask[y * width + (x + 1)] : 0
      if (up === 0 || down === 0 || left === 0 || right === 0) {
        boundary.push({ x: x - x0, y: y - y0 })
      }
    }
  }
  if (boundary.length <= 1) {
    return boundary
  }
  let sumX = 0
  let sumY = 0
  for (const point of boundary) {
    sumX += point.x
    sumY += point.y
  }
  const cx = sumX / boundary.length
  const cy = sumY / boundary.length
  const ordered = boundary
    .slice()
    .sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let areaSum = 0
  for (let i = 0; i < ordered.length; i += 1) {
    const current = ordered[i]
    const next = ordered[(i + 1) % ordered.length]
    areaSum += current.x * next.y - next.x * current.y
  }
  if (areaSum < 0) {
    ordered.reverse()
  }
  let startIndex = 0
  let bestX = ordered[0].x
  let bestY = ordered[0].y
  for (let i = 1; i < ordered.length; i += 1) {
    const point = ordered[i]
    if (point.y < bestY || (point.y === bestY && point.x < bestX)) {
      bestX = point.x
      bestY = point.y
      startIndex = i
    }
  }
  return ordered.slice(startIndex).concat(ordered.slice(0, startIndex))
}

/**
 * 构建轮廓排序点集（包含内部路径）
 */
export function buildContourOrderedPoints(
  edge: Uint8Array,
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number }
) {
  const outerIndices = findLargestEdgeComponent(edge, width, height, rect)
  if (outerIndices.length === 0) {
    return []
  }
  const outerMask = new Uint8Array(edge.length)
  for (const idx of outerIndices) {
    outerMask[idx] = 1
  }
  const innerMask = new Uint8Array(edge.length)
  const x0 = rect.x
  const y0 = rect.y
  const x1 = rect.x + rect.w
  const y1 = rect.y + rect.h
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const idx = y * width + x
      if (edge[idx] === 1 && outerMask[idx] === 0) {
        innerMask[idx] = 1
      }
    }
  }
  const ordered: Array<{ x: number; y: number }> = buildClockwiseOuterContourPoints(outerMask, width, height, rect)
  const innerPaths = traceEdgePaths(innerMask, width, height, rect)
  for (const path of innerPaths) {
    for (const point of path) {
      ordered.push(point)
    }
  }
  return ordered
}

/**
 * 合并过近的点，减少点集数量
 * @param distance 合并阈值
 */
export function applyPointMerge(points: Array<{ x: number; y: number }>, distance: number) {
  if (distance <= 0 || points.length <= 1) {
    return points
  }
  const minDistance = Math.max(0.5, distance)
  const minDistanceSq = minDistance * minDistance
  const merged: Array<{ x: number; y: number }> = [points[0]]
  let last = points[0]
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]
    const dx = point.x - last.x
    const dy = point.y - last.y
    if (dx * dx + dy * dy >= minDistanceSq) {
      merged.push(point)
      last = point
    }
  }
  return merged
}

/**
 * 构建最终点集列表
 * @param order 点集排序模式：扫描、路径追踪、轮廓
 */
export function buildPointList(
  edge: Uint8Array,
  width: number,
  height: number,
  step: number,
  rect: { x: number; y: number; w: number; h: number },
  order: PointOrder
) {
  if (order === 'scan') {
    const points: Array<{ x: number; y: number }> = []
    const startX = rect.x
    const startY = rect.y
    const endX = rect.x + rect.w
    const endY = rect.y + rect.h
    for (let y = startY; y < endY; y += step) {
      for (let x = startX; x < endX; x += step) {
        const idx = y * width + x
        if (edge[idx] === 1) {
          points.push({ x: x - startX, y: y - startY })
        }
      }
    }
    return points
  } else if (order === 'contour') {
    return buildContourOrderedPoints(edge, width, height, rect)
  } else {
    // trace
    const paths = traceEdgePaths(edge, width, height, rect)
    const points: Array<{ x: number; y: number }> = []
    for (const path of paths) {
      for (let i = 0; i < path.length; i += step) {
        points.push(path[i])
      }
    }
    return points
  }
}

/**
 * 限制数值范围
 */
export function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val))
}

/**
 * 将 DataURL 转换为 Blob 对象
 */
export function dataUrlToBlob(dataUrl: string) {
  const arr = dataUrl.split(',')
  const match = arr[0].match(/:(.*?);/)
  if (!match) return null
  const mime = match[1]
  const bstr = atob(arr[1])
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }
  return new Blob([u8arr], { type: mime })
}

/**
 * 最小值滤镜
 * 分离为水平和垂直两次遍历，复杂度从 O(R^2) 降低到 O(R)
 */
export function minimumFilter(data: Float32Array, width: number, height: number, radius: number) {
  if (radius <= 0) return data
  
  // 1. 水平方向
  const temp = new Float32Array(data.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minVal = 255
      const start = Math.max(0, x - radius)
      const end = Math.min(width - 1, x + radius)
      for (let k = start; k <= end; k++) {
        const val = data[y * width + k]
        if (val < minVal) minVal = val
      }
      temp[y * width + x] = minVal
    }
  }

  // 2. 垂直方向
  const output = new Float32Array(data.length)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let minVal = 255
      const start = Math.max(0, y - radius)
      const end = Math.min(height - 1, y + radius)
      for (let k = start; k <= end; k++) {
        const val = temp[k * width + x]
        if (val < minVal) minVal = val
      }
      output[y * width + x] = minVal
    }
  }
  return output
}

/**
 * 色阶调整
 * 使用查找表 (LUT) 优化性能
 */
export function applyLevels(data: Uint8ClampedArray, black: number, white: number, gamma: number) {
  if (black === 0 && white === 255 && gamma === 1.0) return

  // 预计算查找表
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    let normalized = (i - black) / (white - black)
    normalized = Math.max(0, Math.min(1, normalized))
    lut[i] = Math.pow(normalized, 1 / gamma) * 255
  }

  // 应用查找表
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]]
    data[i + 1] = lut[data[i + 1]]
    data[i + 2] = lut[data[i + 2]]
    // Alpha 通道保持不变
  }
}
