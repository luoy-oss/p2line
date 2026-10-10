<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  createGrayBuffer,
  buildSvg,
  buildPointList,
  applyPointMerge,
  minimumFilter,
  applyLevels,
  clamp,
  dataUrlToBlob,
  type PointOrder
} from '../utils/image-processing'
import { buildOrderedStrokeExport } from '../utils/ordered-stroke-export'
import type { StrokeDirectionStrategy } from '../utils/stroke-reconstruction'

type OutputFormat = 'png' | 'jpg' | 'svg' | 'json' | 'strokes'

const fileInput = ref<HTMLInputElement | null>(null)
const paramsFileInput = ref<HTMLInputElement | null>(null)
const sourceCanvas = ref<HTMLCanvasElement | null>(null)
const outputCanvas = ref<HTMLCanvasElement | null>(null)
const imageElement = ref<HTMLImageElement | null>(null)
const imageName = ref('')
const processing = ref(false)
const statusText = ref('请上传一张图片')
const outputFormat = ref<OutputFormat>('png')
const outputUrl = ref('')
const outputText = ref('')
const autoProcess = ref(true)

// PS 算法参数
const filterRadius = ref(2)   // 最小值滤镜半径
const levelsBlack = ref(0)    // 色阶黑场
const levelsWhite = ref(255)  // 色阶白场
const levelsGamma = ref(1.0)  // 色阶 Gamma
const blendOpacity = ref(1.0) // 混合不透明度

// 通用参数
const pointStep = ref(2)        // 点集采样间隔
const cropEnabled = ref(false)  // 是否启用裁剪
const cropX = ref(0)            // 裁剪区域 X
const cropY = ref(0)            // 裁剪区域 Y
const cropWidth = ref(100)      // 裁剪区域宽度
const cropHeight = ref(100)     // 裁剪区域高度
const pointsPreviewCanvas = ref<HTMLCanvasElement | null>(null)
const pointCount = ref(0)
const showPointOrder = ref(false)
let lastPreviewPoints: Array<{ x: number; y: number }> = []
let lastPreviewRect = { x: 0, y: 0, w: 1, h: 1 }
let lastPreviewInvert = false
const pointOrder = ref<PointOrder>('scan')  // 点集导出顺序
const mergePointsEnabled = ref(false)       // 是否合并点集
const mergeDistance = ref(2)                // 合并距离
const invertOutput = ref(false)             // 最终反色
const threshold = ref(128)                  // 二值化阈值（用于点集提取）

let pendingTimer: number | null = null

const canProcess = computed(() => Boolean(imageElement.value) && !processing.value)

const outputFileName = computed(() => {
  const base = imageName.value ? imageName.value.replace(/\.[^.]+$/, '') : 'outline'
  return outputFormat.value === 'strokes' ? `${base}-ps-ordered-strokes.json` : `${base}-ps.${outputFormat.value}`
})

const paramsFileName = computed(() => {
  const base = imageName.value ? imageName.value.replace(/\.[^.]+$/, '') : 'outline'
  return `${base}-ps-params.json`
})

const storageKey = 'p2line-ps-params'
const pointOrderOptions: PointOrder[] = ['scan', 'trace', 'contour']
const outputFormatOptions: OutputFormat[] = ['png', 'jpg', 'svg', 'json', 'strokes']
const strokeDirectionOptions: Array<{ value: StrokeDirectionStrategy; label: string }> = [
  { value: 'natural', label: '自然方向' },
  { value: 'shortest', label: '最短抬笔距离' },
  { value: 'trace', label: '原始追踪方向' }
]
const strokeDirection = ref<StrokeDirectionStrategy>('natural')

function readStrokeDirection(value: unknown, fallback: StrokeDirectionStrategy): StrokeDirectionStrategy {
  return typeof value === 'string' && strokeDirectionOptions.some(option => option.value === value)
    ? value as StrokeDirectionStrategy
    : fallback
}

const controlState = computed(() => ({
  filterRadius: filterRadius.value,
  levelsBlack: levelsBlack.value,
  levelsWhite: levelsWhite.value,
  levelsGamma: levelsGamma.value,
  blendOpacity: blendOpacity.value,
  pointStep: pointStep.value,
  cropEnabled: cropEnabled.value,
  cropX: cropX.value,
  cropY: cropY.value,
  cropWidth: cropWidth.value,
  cropHeight: cropHeight.value,
  pointOrder: pointOrder.value,
  strokeDirection: strokeDirection.value,
  mergePointsEnabled: mergePointsEnabled.value,
  mergeDistance: mergeDistance.value,
  invertOutput: invertOutput.value,
  threshold: threshold.value
}))

function readNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function readPointOrder(value: unknown, fallback: PointOrder) {
  return typeof value === 'string' && pointOrderOptions.includes(value as PointOrder) ? (value as PointOrder) : fallback
}

function readOutputFormat(value: unknown, fallback: OutputFormat) {
  return typeof value === 'string' && outputFormatOptions.includes(value as OutputFormat)
    ? (value as OutputFormat)
    : fallback
}

function buildParamsPayload() {
  return {
    filterRadius: filterRadius.value,
    levelsBlack: levelsBlack.value,
    levelsWhite: levelsWhite.value,
    levelsGamma: levelsGamma.value,
    blendOpacity: blendOpacity.value,
    pointStep: pointStep.value,
    cropEnabled: cropEnabled.value,
    cropX: cropX.value,
    cropY: cropY.value,
    cropWidth: cropWidth.value,
    cropHeight: cropHeight.value,
    pointOrder: pointOrder.value,
    mergePointsEnabled: mergePointsEnabled.value,
    mergeDistance: mergeDistance.value,
    invertOutput: invertOutput.value,
    threshold: threshold.value,
    outputFormat: outputFormat.value,
  strokeDirection: strokeDirection.value,
    autoProcess: autoProcess.value
  }
}

function applyParams(data: Record<string, unknown>) {
  filterRadius.value = readNumber(data.filterRadius, filterRadius.value)
  levelsBlack.value = readNumber(data.levelsBlack, levelsBlack.value)
  levelsWhite.value = readNumber(data.levelsWhite, levelsWhite.value)
  levelsGamma.value = readNumber(data.levelsGamma, levelsGamma.value)
  blendOpacity.value = readNumber(data.blendOpacity, blendOpacity.value)
  pointStep.value = readNumber(data.pointStep, pointStep.value)
  cropEnabled.value = readBoolean(data.cropEnabled, cropEnabled.value)
  cropX.value = readNumber(data.cropX, cropX.value)
  cropY.value = readNumber(data.cropY, cropY.value)
  cropWidth.value = readNumber(data.cropWidth, cropWidth.value)
  cropHeight.value = readNumber(data.cropHeight, cropHeight.value)
  pointOrder.value = readPointOrder(data.pointOrder, pointOrder.value)
  mergePointsEnabled.value = readBoolean(data.mergePointsEnabled, mergePointsEnabled.value)
  mergeDistance.value = readNumber(data.mergeDistance, mergeDistance.value)
  invertOutput.value = readBoolean(data.invertOutput, invertOutput.value)
  threshold.value = readNumber(data.threshold, threshold.value)
  outputFormat.value = readOutputFormat(data.outputFormat, outputFormat.value)
  strokeDirection.value = readStrokeDirection(data.strokeDirection, strokeDirection.value)
  autoProcess.value = readBoolean(data.autoProcess, autoProcess.value)
}

function saveParams() {
  const payload = buildParamsPayload()
  localStorage.setItem(storageKey, JSON.stringify(payload))
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = paramsFileName.value
  link.click()
  URL.revokeObjectURL(link.href)
  statusText.value = '参数已保存'
}

function loadParams() {
  const raw = localStorage.getItem(storageKey)
  if (!raw) {
    statusText.value = '未找到保存的参数'
    return
  }
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    applyParams(data)
    statusText.value = '参数已载入'
    if (imageElement.value) {
      processImage()
    }
  } catch {
    statusText.value = '参数载入失败'
  }
}

function requestParamsFile() {
  paramsFileInput.value?.click()
}

function handleParamsFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files || input.files.length === 0) {
    return
  }
  const file = input.files[0]
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string) as Record<string, unknown>
      applyParams(data)
      statusText.value = '参数已导入'
      if (imageElement.value) {
        processImage()
      }
    } catch {
      statusText.value = '参数导入失败'
    }
  }
  reader.readAsText(file)
  input.value = ''
}

function requestFile() {
  fileInput.value?.click()
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files || input.files.length === 0) {
    return
  }
  const file = input.files[0]
  const reader = new FileReader()
  reader.onload = () => {
    const image = new Image()
    image.onload = () => {
      imageElement.value = image
      imageName.value = file.name
      processImage()
    }
    image.src = reader.result as string
  }
  reader.readAsDataURL(file)
}


function getCropRect(width: number, height: number) {
  const x = Math.round((clamp(cropX.value, 0, 100) / 100) * width)
  const y = Math.round((clamp(cropY.value, 0, 100) / 100) * height)
  const w = Math.round((clamp(cropWidth.value, 1, 100) / 100) * width)
  const h = Math.round((clamp(cropHeight.value, 1, 100) / 100) * height)
  const maxW = Math.max(1, width - x)
  const maxH = Math.max(1, height - y)
  return {
    x: clamp(x, 0, width - 1),
    y: clamp(y, 0, height - 1),
    w: clamp(w, 1, maxW),
    h: clamp(h, 1, maxH)
  }
}

const cropRect = computed(() => {
  if (!imageElement.value) {
    return { x: 0, y: 0, w: 0, h: 0 }
  }
  return getCropRect(imageElement.value.naturalWidth, imageElement.value.naturalHeight)
})

function renderPointsPreview(
  points: Array<{ x: number; y: number }>,
  rect: { x: number; y: number; w: number; h: number },
  invert: boolean
) {
  lastPreviewPoints = points
  lastPreviewRect = { ...rect }
  lastPreviewInvert = invert
  const canvas = pointsPreviewCanvas.value
  if (!canvas) return
  const maxSize = 1200
  const scale = Math.min(maxSize / Math.max(1, rect.w), maxSize / Math.max(1, rect.h))
  const canvasWidth = Math.max(1, Math.round(rect.w * scale))
  const canvasHeight = Math.max(1, Math.round(rect.h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  canvas.width = canvasWidth
  canvas.height = canvasHeight
  ctx.fillStyle = invert ? '#111827' : '#ffffff'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)

  // Subtle coordinate grid helps judge point density and spacing.
  const gridStep = Math.max(24, Math.round(Math.min(canvasWidth, canvasHeight) / 12 / 8) * 8)
  ctx.strokeStyle = invert ? 'rgba(148,163,184,0.12)' : 'rgba(100,116,139,0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= canvasWidth; x += gridStep) {
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, canvasHeight)
  }
  for (let y = 0; y <= canvasHeight; y += gridStep) {
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(canvasWidth, y + 0.5)
  }
  ctx.stroke()

  // The exported format is a flat point array; it does not preserve path
  // boundaries, so do not connect adjacent points and imply false strokes.

  const radius = Math.max(1.2, Math.min(3.4, scale * 0.7))
  ctx.fillStyle = invert ? '#e2e8f0' : '#172033'
  for (const point of points) {
    ctx.beginPath()
    ctx.arc(point.x * scale, point.y * scale, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  if (showPointOrder.value && points.length > 0) {
    const markerRadius = Math.max(3, Math.min(7, scale * 2))
    const markers = [
      { point: points[0], label: 'START', color: '#16a34a' },
      { point: points[points.length - 1], label: 'END', color: '#dc2626' }
    ]
    ctx.font = '600 11px system-ui, sans-serif'
    for (const marker of markers) {
      const x = marker.point.x * scale, y = marker.point.y * scale
      ctx.fillStyle = marker.color
      ctx.beginPath()
      ctx.arc(x, y, markerRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = marker.color
      ctx.fillText(marker.label, x + markerRadius + 3, y - markerRadius - 2)
    }
  }
  pointCount.value = points.length
}

/**
 * PS 风格线稿提取流程
 * 1. 转灰度
 * 2. 复制图层并反相
 * 3. 对反相图层应用最小值滤镜（扩大暗部，即扩大反相后的亮部，从而在混合时保留边缘）
 * 4. 颜色减淡混合 (Color Dodge)：Base / (1 - Blend)
 * 5. 色阶调整
 * 6. 可选：反色输出
 * 7. 生成点集
 */
async function processImage() {
  if (!imageElement.value || !sourceCanvas.value || !outputCanvas.value) {
    return
  }
  if (processing.value) {
    return
  }
  processing.value = true
  try {
    statusText.value = '正在生成线稿 (PS模式)...'
    const width = imageElement.value.naturalWidth
    const height = imageElement.value.naturalHeight
    
    // 准备源图像
    const sourceCtx = sourceCanvas.value.getContext('2d')
    if (!sourceCtx) return
    sourceCanvas.value.width = width
    sourceCanvas.value.height = height
    sourceCtx.drawImage(imageElement.value, 0, 0, width, height)
    
    const imageData = sourceCtx.getImageData(0, 0, width, height)
    const gray = createGrayBuffer(imageData) // Float32Array 0-255
    
    // 反相层
    const inverted = new Float32Array(gray.length)
    for(let i=0; i<gray.length; i++) {
      inverted[i] = 255 - gray[i]
    }
    
    // 最小值滤镜 (应用于反相层)
    const filteredInverted = minimumFilter(inverted, width, height, filterRadius.value)
    
    // 颜色减淡混合
    // Base: 原始灰度图
    // Blend: 处理后的反相层
    // 公式: Base / (1 - Blend)
    const blended = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      const baseVal = gray[i]
      const blendVal = filteredInverted[i]
      
      let outVal = 0
      if (blendVal >= 255) {
        outVal = 255
      } else {
        const res = (baseVal * 255) / (255 - blendVal)
        outVal = Math.min(255, res)
      }
      
      blended[i * 4] = outVal
      blended[i * 4 + 1] = outVal
      blended[i * 4 + 2] = outVal
      blended[i * 4 + 3] = 255
    }
    
    // 色阶调整
    applyLevels(blended, levelsBlack.value, levelsWhite.value, levelsGamma.value)
    
    // 根据需要反色输出
    if (invertOutput.value) {
       for (let i = 0; i < width * height; i++) {
          const val = 255 - blended[i * 4]
          blended[i * 4] = val
          blended[i * 4 + 1] = val
          blended[i * 4 + 2] = val
       }
    }

    // 输出到 Canvas
    const outputImage = new ImageData(blended, width, height)
    const outputCtx = outputCanvas.value.getContext('2d')
    if (!outputCtx) return
    
    const rect = cropEnabled.value ? getCropRect(width, height) : { x: 0, y: 0, w: width, h: height }
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = width
    tempCanvas.height = height
    const tempCtx = tempCanvas.getContext('2d')
    if (!tempCtx) return
    
    tempCtx.putImageData(outputImage, 0, 0)
    
    outputCanvas.value.width = rect.w
    outputCanvas.value.height = rect.h
    outputCtx.clearRect(0, 0, rect.w, rect.h)
    outputCtx.drawImage(tempCanvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
    
    // 生成点集
    // 根据阈值生成二值化边缘图
    const edgeMap = new Uint8Array(width * height)
    for (let i = 0; i < width * height; i++) {
      const val = blended[i * 4] // 取红色通道作为亮度
      // 默认：白底黑线 (val 小于阈值为线)
      // 反色：黑底白线 (val 大于阈值为线)
      if (invertOutput.value) {
         if (val > threshold.value) edgeMap[i] = 1
      } else {
         if (val < threshold.value) edgeMap[i] = 1
      }
    }
    
    // 生成输出数据
    const pngUrl = outputCanvas.value.toDataURL('image/png')
    const jpgUrl = outputCanvas.value.toDataURL('image/jpeg', 0.92)
    
    const svgText = buildSvg(
      edgeMap,
      width,
      height,
      Math.max(1, pointStep.value),
      1,
      1,
      invertOutput.value,
      rect
    )
    
    const orderedStrokeExport = outputFormat.value === 'strokes' ? buildOrderedStrokeExport(edgeMap, width, height, rect, pointStep.value, strokeDirection.value) : null
    const pointList = buildPointList(
      edgeMap,
      width,
      height,
      Math.max(1, pointStep.value),
      rect,
      pointOrder.value
    )
    
    const mergedPoints = mergePointsEnabled.value
      ? applyPointMerge(pointList, mergeDistance.value)
      : pointList
      
    const jsonText = JSON.stringify(mergedPoints)
    outputText.value = outputFormat.value === 'strokes' ? (orderedStrokeExport?.json ?? '') : outputFormat.value === 'json' ? jsonText : outputFormat.value === 'svg' ? svgText : ''
    
    if (outputFormat.value === 'png') {
      outputUrl.value = pngUrl
    } else if (outputFormat.value === 'jpg') {
      outputUrl.value = jpgUrl
    } else if (outputFormat.value === 'svg') {
      outputUrl.value = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
    } else {
      outputUrl.value = ''
    }
    
    if (outputFormat.value === 'strokes') {
      const strokes = orderedStrokeExport?.strokes ?? []
      renderOrderedStrokesPreview(strokes, rect, invertOutput.value)
      statusText.value = '完成：' + strokes.length + ' 条有序笔画 · ' + (orderedStrokeExport?.pointCount ?? 0) + ' 个轨迹点'
    } else {
      renderPointsPreview(mergedPoints, rect, invertOutput.value)
      statusText.value = '完成：PS 流程线稿提取'
    }

  } finally {
    processing.value = false
  }
}

function renderOrderedStrokesPreview(strokes: Array<Array<{ x: number; y: number }>>, rect: { x: number; y: number; w: number; h: number }, invert: boolean) {
  const canvas = pointsPreviewCanvas.value
  if (!canvas) return
  const scale = Math.min(1200 / Math.max(1, rect.w), 1200 / Math.max(1, rect.h))
  canvas.width = Math.max(1, Math.round(rect.w * scale))
  canvas.height = Math.max(1, Math.round(rect.h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = invert ? '#111827' : '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const gridStep = Math.max(24, Math.round(Math.min(canvas.width, canvas.height) / 12 / 8) * 8)
  ctx.strokeStyle = invert ? 'rgba(148,163,184,0.12)' : 'rgba(100,116,139,0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= canvas.width; x += gridStep) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, canvas.height) }
  for (let y = 0; y <= canvas.height; y += gridStep) { ctx.moveTo(0, y + 0.5); ctx.lineTo(canvas.width, y + 0.5) }
  ctx.stroke()
  const palette = ['#2563eb', '#0d9488', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#ea580c']
  const radius = Math.max(1.2, Math.min(3.5, scale * 0.75))
  strokes.forEach((stroke, index) => {
    if (!stroke.length) return
    const color = palette[index % palette.length]
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = Math.max(1, Math.min(2.5, scale * 0.7))
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(stroke[0].x * scale, stroke[0].y * scale)
    for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x * scale, stroke[i].y * scale)
    ctx.stroke()
    for (const point of stroke) {
      ctx.beginPath()
      ctx.arc(point.x * scale, point.y * scale, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    const start = stroke[0], end = stroke[stroke.length - 1]
    ctx.fillStyle = '#16a34a'
    ctx.beginPath()
    ctx.arc(start.x * scale, start.y * scale, radius * 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#dc2626'
    ctx.beginPath()
    ctx.arc(end.x * scale, end.y * scale, radius * 2, 0, Math.PI * 2)
    ctx.fill()
  })
  pointCount.value = strokes.reduce((sum, stroke) => sum + stroke.length, 0)
}

function downloadOutput() {
  if (!outputCanvas.value) {
    return
  }
  let blob: Blob
  if (outputFormat.value === 'png') {
    const data = outputCanvas.value.toDataURL('image/png')
    blob = dataUrlToBlob(data) as Blob
  } else if (outputFormat.value === 'jpg') {
    const data = outputCanvas.value.toDataURL('image/jpeg', 0.92)
    blob = dataUrlToBlob(data) as Blob
  } else if (outputFormat.value === 'svg') {
    blob = new Blob([outputText.value], { type: 'image/svg+xml' })
  } else {
    blob = new Blob([outputText.value], { type: 'application/json' })
  }
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = outputFileName.value
  link.click()
  URL.revokeObjectURL(link.href)
}


watch(showPointOrder, () => {
  if (outputFormat.value !== 'strokes' && imageElement.value && lastPreviewPoints.length) {
    renderPointsPreview(lastPreviewPoints, lastPreviewRect, lastPreviewInvert)
  }
})

watch(
  () => outputFormat.value,
  () => {
    if (!imageElement.value) {
      return
    }
    processImage()
  }
)

watch(
  () => controlState.value,
  () => {
    if (!autoProcess.value || !imageElement.value) {
      return
    }
    if (pendingTimer) {
      window.clearTimeout(pendingTimer)
    }
    pendingTimer = window.setTimeout(() => {
      processImage()
    }, 300)
  },
  { deep: true }
)
</script>

<template>
  <div class="extractor-container ps-workspace">
    <div class="actions-bar ps-actions-bar">
      <button class="primary" type="button" @click="requestFile">上传图片</button>
      <button type="button" @click="saveParams">保存参数</button>
      <button type="button" @click="loadParams">载入参数</button>
      <button type="button" @click="requestParamsFile">导入参数</button>
      <button type="button" :disabled="!canProcess" @click="processImage">重新处理</button>
      <button type="button" :disabled="!outputText && !outputUrl" @click="downloadOutput">下载输出</button>
    </div>

    <section class="workspace ps-workspace-grid" :class="{ 'is-point-output': outputFormat === 'json' }">
      <div class="panel">
        <div class="panel-heading"><div><p class="eyebrow">SOURCE</p><h2>输入图像</h2></div></div>
        <div class="uploader" @click="requestFile">
          <input ref="fileInput" type="file" accept="image/*" @change="handleFileChange" />
          <div v-if="!imageElement" class="empty">点击或拖拽图片到此处</div>
          <img v-else :src="imageElement?.src" alt="source" />
        </div>
        <input
          ref="paramsFileInput"
          class="hidden-input"
          type="file"
          accept="application/json"
          @change="handleParamsFileChange"
        />
        <div class="status">{{ statusText }}</div>
        <canvas ref="sourceCanvas" class="hidden"></canvas>
      </div>

      <div class="panel">
        <div class="panel-heading"><div><p class="eyebrow">ADJUSTMENTS</p><h2>提取参数</h2></div></div>
        <div class="controls">
          <label>
            最小值滤镜半径：{{ filterRadius }}
            <input v-model.number="filterRadius" type="range" min="0" max="10" step="1" />
          </label>
          <label>
            色阶黑场：{{ levelsBlack }}
            <input v-model.number="levelsBlack" type="range" min="0" max="255" step="1" />
          </label>
          <label>
            色阶白场：{{ levelsWhite }}
            <input v-model.number="levelsWhite" type="range" min="0" max="255" step="1" />
          </label>
          <label>
            色阶中间调 (Gamma)：{{ levelsGamma.toFixed(2) }}
            <input v-model.number="levelsGamma" type="range" min="0.1" max="3.0" step="0.1" />
          </label>
          <label class="toggle">
            <input v-model="invertOutput" type="checkbox" />
            输出反色 (白线黑底)
          </label>
          
          <h3 class="section-label">点集提取设置</h3>
           <label>
            提取阈值：{{ threshold }}
            <input v-model.number="threshold" type="range" min="1" max="254" step="1" />
          </label>
          <label class="toggle">
            <input v-model="cropEnabled" type="checkbox" />
            裁剪导出区域
          </label>
          <label v-if="cropEnabled">
            裁剪 X：{{ cropX.toFixed(1) }}%（{{ cropRect.x }}px）
            <input v-model.number="cropX" type="range" min="0" max="100" step="0.1" />
          </label>
          <label v-if="cropEnabled">
            裁剪 Y：{{ cropY.toFixed(1) }}%（{{ cropRect.y }}px）
            <input v-model.number="cropY" type="range" min="0" max="100" step="0.1" />
          </label>
          <label v-if="cropEnabled">
            裁剪宽：{{ cropWidth.toFixed(1) }}%（{{ cropRect.w }}px）
            <input v-model.number="cropWidth" type="range" min="1" max="100" step="0.1" />
          </label>
          <label v-if="cropEnabled">
            裁剪高：{{ cropHeight.toFixed(1) }}%（{{ cropRect.h }}px）
            <input v-model.number="cropHeight" type="range" min="1" max="100" step="0.1" />
          </label>
          <label>
            点集采样间隔：{{ pointStep }}
            <input v-model.number="pointStep" type="range" min="1" max="6" step="1" />
          </label>
          <label>
            点集导出顺序
            <select v-model="pointOrder">
              <option value="scan">顺序（从 0,0 到末尾）</option>
              <option value="trace">路径化绘制</option>
              <option value="contour">轮廓绘制</option>
            </select>
          </label>
          <label class="toggle">
            <input v-model="mergePointsEnabled" type="checkbox" />
            点集合并
          </label>
          <label v-if="mergePointsEnabled">
            合并距离：{{ mergeDistance.toFixed(1) }}px
            <input v-model.number="mergeDistance" type="range" min="0.5" max="12" step="0.1" />
          </label>
          <label class="toggle">
            <input v-model="autoProcess" type="checkbox" />
            滑块实时更新
          </label>
          <label>
            输出格式
            <select v-model="outputFormat">
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
              <option value="svg">SVG</option>
              <option value="json">点集 / 坐标 JSON（扫描/追踪）</option>
              <option value="strokes">有序笔画点集 JSON</option>
            </select>
          </label>
          <label v-if="outputFormat === 'strokes'">
            笔画方向策略
            <select v-model="strokeDirection">
              <option v-for="option in strokeDirectionOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <small class="hint">{{ strokeDirection === 'natural' ? '竖向上到下、横向左到右；适合常规线稿。' : strokeDirection === 'shortest' ? '允许反转开放笔画以减少空行程；方向可能不符合自然绘画习惯。' : '保留骨架追踪的方向与发现顺序；结果受图像扫描与拓扑影响。' }}</small>
          </label>
        </div>
      </div>

      <div v-show="outputFormat === 'json' || outputFormat === 'strokes'" class="panel point-visual-panel" :class="{ 'point-visual-panel--active': outputFormat === 'json' }">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">POINT CLOUD</p>
            <h2>{{ outputFormat === 'strokes' ? '有序笔画预览' : '点集可视化' }}</h2>
          </div>
          <span class="point-count">{{ pointCount.toLocaleString() }} <small>points</small></span>
        </div>
        <div class="point-stage" :class="{ 'point-stage--dark': invertOutput }">
          <canvas ref="pointsPreviewCanvas"></canvas>
          <div v-if="!imageElement" class="point-empty">上传图片后在此查看点集分布</div>
        </div>
        <div class="point-visual-footer">
          <span>{{ outputFormat === 'strokes' ? '按笔画顺序分色 · 绿起点 / 红终点 · 不跨笔画连线' : '原点 (0, 0) · 裁剪区域坐标' }}</span>
          <label class="inline-toggle"><input v-model="showPointOrder" type="checkbox" /> 标记点集首尾</label>
        </div>
        <p v-if="showPointOrder && pointOrder === 'scan'" class="hint">为避免把扁平点集误画成连续笔画，这里只标记点序列的首尾，不连接采样点。</p>
        <div class="point-legend"><span><i class="legend-dot"></i> 采样点</span><span><i class="legend-start"></i> 序列起点</span><span><i class="legend-end"></i> 序列终点</span></div>
      </div>

      <div class="panel output-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">EXPORT</p>
            <h2>{{ outputFormat === 'json' || outputFormat === 'strokes' ? '点集数据' : '线稿输出' }}</h2>
          </div>
          <span class="format-pill">{{ outputFormat.toUpperCase() }}</span>
        </div>
        <div class="preview output-preview">
          <img v-if="outputUrl" :src="outputUrl" alt="output" />
          <textarea v-else v-model="outputText" readonly :placeholder="outputFormat === 'json' || outputFormat === 'strokes' ? '生成后的坐标点 JSON 将显示在这里' : '当前格式没有文本预览'"></textarea>
        </div>
        <canvas ref="outputCanvas" class="hidden"></canvas>
        <div class="hint">普通点集 JSON 保持旧格式；有序笔画 JSON 按笔画分组保存绘画顺序与抬笔边界。</div>
      </div>
    </section>
  </div>
</template>


<style scoped>
.ps-workspace { --ink: #172033; --muted: #718096; --line: #e5eaf1; --accent: #356df3; color: var(--ink); }
.ps-actions-bar { gap: 9px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 14px; background: rgba(255,255,255,.88); box-shadow: 0 8px 30px rgba(25,42,70,.04); }
.ps-actions-bar button { border-radius: 9px; padding: 9px 14px; font-weight: 600; }
.ps-actions-bar button.primary { background: #285eea; border-color: #285eea; }
.ps-workspace-grid { grid-template-columns: minmax(230px, .9fr) minmax(280px, 1fr); align-items: stretch; gap: 16px; }
.ps-workspace-grid .panel { border: 1px solid var(--line); border-radius: 16px; padding: 18px; box-shadow: 0 8px 28px rgba(25,42,70,.045); min-width: 0; gap: 15px; }
.ps-workspace-grid .panel h2 { border: 0; padding: 0; color: #172033; font-size: 17px; letter-spacing: -.02em; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.eyebrow { margin: 0 0 4px; color: #8b96a9; font-size: 10px; letter-spacing: .14em; font-weight: 800; }
.section-label { margin: 7px 0 0 !important; padding-top: 14px; border-top: 1px solid #edf0f5; font-size: 12px !important; letter-spacing: .06em; text-transform: uppercase; }
.ps-workspace-grid .controls { gap: 13px; max-height: none; overflow: visible; }
.ps-workspace-grid .controls label { font-size: 12px; font-weight: 600; color: #475569; gap: 8px; }
.ps-workspace-grid .controls input[type=range] { accent-color: #356df3; }
.ps-workspace-grid .controls select { border-color: #dce3ed; border-radius: 9px; padding: 10px 11px; color: #253248; }
.ps-workspace-grid .controls .toggle { display: flex; align-items: center; gap: 9px; }
.ps-workspace-grid .uploader { min-height: 300px; border-radius: 12px; border-color: #dbe3ee; background: linear-gradient(145deg,#f8fafc,#f1f5f9); }
.ps-workspace-grid .status { border-radius: 8px; line-height: 1.5; }
.point-visual-panel { grid-column: 1 / -1; }
.point-visual-panel--active { border-color: #cbd8ff !important; box-shadow: 0 10px 34px rgba(53,109,243,.08) !important; }
.point-count { padding: 7px 11px; border-radius: 9px; background: #f1f5ff; color: #285eea; font-weight: 800; font-size: 14px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.point-count small { font-size: 10px; font-weight: 700; letter-spacing: .04em; }
.point-stage { min-height: 280px; max-height: 68vh; overflow: auto; position: relative; display: flex; align-items: center; justify-content: center; padding: 12px; border-radius: 12px; border: 1px solid #e4e9f1; background-color: #fbfcfe; background-image: radial-gradient(#dbe2ed .8px, transparent .8px); background-size: 16px 16px; }
.point-stage--dark { background-color: #111827; background-image: radial-gradient(#334155 .8px, transparent .8px); border-color: #273449; }
.point-stage canvas { display: block; width: 100%; height: auto; max-height: 64vh; object-fit: contain; image-rendering: auto; }
.point-empty { position: absolute; color: #94a3b8; font-size: 13px; pointer-events: none; }
.point-visual-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; color: #8390a3; font-size: 11px; }
.inline-toggle { display: inline-flex; align-items: center; gap: 7px; color: #475569; cursor: pointer; }
.inline-toggle input { accent-color: #356df3; }
.point-legend { display: flex; flex-wrap: wrap; gap: 16px; color: #68758a; font-size: 11px; }
.point-legend span { display: inline-flex; align-items: center; gap: 6px; }
.point-legend i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #172033; }
.point-legend .legend-start { background: #16a34a; }
.point-legend .legend-end { background: #dc2626; }
.point-stage--dark + .point-visual-footer { color: #94a3b8; }
.point-stage--dark ~ .point-legend { color: #cbd5e1; }
.point-stage--dark ~ .point-legend .legend-dot { background: #e2e8f0; }
.format-pill { border: 1px solid #dce5f4; background: #f5f8ff; color: #3561c7; border-radius: 7px; padding: 5px 8px; font-size: 10px; font-weight: 800; letter-spacing: .08em; }
.output-preview { min-height: 280px; border-radius: 10px; border-color: #e3e8f0; background: #f8fafc; }
.output-preview textarea { min-height: 260px; outline: none; font: 12px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace; }
.ps-workspace .hint { color: #8793a6; font-size: 11px; line-height: 1.6; text-align: left; }
@media (min-width: 1100px) {
  .ps-workspace-grid.is-point-output { grid-template-columns: minmax(260px, .72fr) minmax(0, 1.8fr); }
  .ps-workspace-grid.is-point-output .point-visual-panel { grid-column: 2; grid-row: 1 / span 2; }
  .ps-workspace-grid.is-point-output .output-panel { grid-column: 1; }
  .ps-workspace-grid.is-point-output .point-stage { min-height: 440px; }
}
@media (max-width: 760px) {
  .ps-workspace-grid { grid-template-columns: minmax(0,1fr); }
  .ps-workspace-grid .panel { padding: 14px; }
  .ps-workspace-grid .uploader { min-height: 220px; }
  .point-stage { min-height: 220px; }
}
</style>
