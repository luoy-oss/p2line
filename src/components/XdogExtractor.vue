<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  createGrayBuffer,
  createXdogStrength,
  buildEdgeMapFromStrength,
  removeIsolated,
  closeGaps,
  dilateEdgeMap,
  buildOutputImage,
  buildSvg,
  buildPointList,
  applyPointMerge,
  clamp,
  dataUrlToBlob,
  type PointOrder
} from '../utils/image-processing'

type OutputFormat = 'png' | 'jpg' | 'svg' | 'json'

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

const lineThickness = ref(1) // 线条粗细
const edgeDarkness = ref(0.9) // 线条暗度
const xdogSigma = ref(1.1) // 高斯模糊标准差
const xdogK = ref(1.6) // 高斯差分倍率
const xdogTau = ref(0.98) // 边缘强度权重
const xdogPhi = ref(12) // 软阈值参数
const xdogEpsilon = ref(0.02) // 阈值偏移量
const xdogThreshold = ref(0.18) // 二值化阈值
const removeSpeckles = ref(false) // 去除杂点
const invertColors = ref(false) // 反色
const bridgeLines = ref(false) // 线条连续性维护
const pointStep = ref(2) // 点集采样间隔
const cropEnabled = ref(false) // 是否启用裁剪
const cropX = ref(0) // 裁剪区域 X
const cropY = ref(0) // 裁剪区域 Y
const cropWidth = ref(100) // 裁剪区域宽度
const cropHeight = ref(100) // 裁剪区域高度
const pointsPreviewCanvas = ref<HTMLCanvasElement | null>(null)
const pointOrder = ref<PointOrder>('scan') // 点集导出顺序
const mergePointsEnabled = ref(false) // 是否合并点集
const mergeDistance = ref(2) // 合并距离

let pendingTimer: number | null = null

const canProcess = computed(() => Boolean(imageElement.value) && !processing.value)

const outputFileName = computed(() => {
  const base = imageName.value ? imageName.value.replace(/\.[^.]+$/, '') : 'outline'
  return `${base}.${outputFormat.value}`
})

const paramsFileName = computed(() => {
  const base = imageName.value ? imageName.value.replace(/\.[^.]+$/, '') : 'outline'
  return `${base}-params.json`
})

const storageKey = 'p2line-params'
const pointOrderOptions: PointOrder[] = ['scan', 'trace', 'contour']
const outputFormatOptions: OutputFormat[] = ['png', 'jpg', 'svg', 'json']

const controlState = computed(() => ({
  lineThickness: lineThickness.value,
  edgeDarkness: edgeDarkness.value,
  xdogSigma: xdogSigma.value,
  xdogK: xdogK.value,
  xdogTau: xdogTau.value,
  xdogPhi: xdogPhi.value,
  xdogEpsilon: xdogEpsilon.value,
  xdogThreshold: xdogThreshold.value,
  removeSpeckles: removeSpeckles.value,
  invertColors: invertColors.value,
  bridgeLines: bridgeLines.value,
  pointStep: pointStep.value,
  cropEnabled: cropEnabled.value,
  cropX: cropX.value,
  cropY: cropY.value,
  cropWidth: cropWidth.value,
  cropHeight: cropHeight.value,
  pointOrder: pointOrder.value,
  mergePointsEnabled: mergePointsEnabled.value,
  mergeDistance: mergeDistance.value
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
    lineThickness: lineThickness.value,
    edgeDarkness: edgeDarkness.value,
    xdogSigma: xdogSigma.value,
    xdogK: xdogK.value,
    xdogTau: xdogTau.value,
    xdogPhi: xdogPhi.value,
    xdogEpsilon: xdogEpsilon.value,
    xdogThreshold: xdogThreshold.value,
    removeSpeckles: removeSpeckles.value,
    invertColors: invertColors.value,
    bridgeLines: bridgeLines.value,
    pointStep: pointStep.value,
    cropEnabled: cropEnabled.value,
    cropX: cropX.value,
    cropY: cropY.value,
    cropWidth: cropWidth.value,
    cropHeight: cropHeight.value,
    pointOrder: pointOrder.value,
    mergePointsEnabled: mergePointsEnabled.value,
    mergeDistance: mergeDistance.value,
    outputFormat: outputFormat.value,
    autoProcess: autoProcess.value
  }
}

function applyParams(data: Record<string, unknown>) {
  lineThickness.value = readNumber(data.lineThickness, lineThickness.value)
  edgeDarkness.value = readNumber(data.edgeDarkness, edgeDarkness.value)
  xdogSigma.value = readNumber(data.xdogSigma, xdogSigma.value)
  xdogK.value = readNumber(data.xdogK, xdogK.value)
  xdogTau.value = readNumber(data.xdogTau, xdogTau.value)
  xdogPhi.value = readNumber(data.xdogPhi, xdogPhi.value)
  xdogEpsilon.value = readNumber(data.xdogEpsilon, xdogEpsilon.value)
  xdogThreshold.value = readNumber(data.xdogThreshold, xdogThreshold.value)
  removeSpeckles.value = readBoolean(data.removeSpeckles, removeSpeckles.value)
  invertColors.value = readBoolean(data.invertColors, invertColors.value)
  bridgeLines.value = readBoolean(data.bridgeLines, bridgeLines.value)
  pointStep.value = readNumber(data.pointStep, pointStep.value)
  cropEnabled.value = readBoolean(data.cropEnabled, cropEnabled.value)
  cropX.value = readNumber(data.cropX, cropX.value)
  cropY.value = readNumber(data.cropY, cropY.value)
  cropWidth.value = readNumber(data.cropWidth, cropWidth.value)
  cropHeight.value = readNumber(data.cropHeight, cropHeight.value)
  pointOrder.value = readPointOrder(data.pointOrder, pointOrder.value)
  mergePointsEnabled.value = readBoolean(data.mergePointsEnabled, mergePointsEnabled.value)
  mergeDistance.value = readNumber(data.mergeDistance, mergeDistance.value)
  outputFormat.value = readOutputFormat(data.outputFormat, outputFormat.value)
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
  if (!pointsPreviewCanvas.value) {
    return
  }
  const maxSize = 280
  const scale = Math.min(maxSize / rect.w, maxSize / rect.h)
  const canvasWidth = Math.max(1, Math.round(rect.w * scale))
  const canvasHeight = Math.max(1, Math.round(rect.h * scale))
  const ctx = pointsPreviewCanvas.value.getContext('2d')
  if (!ctx) {
    return
  }
  pointsPreviewCanvas.value.width = canvasWidth
  pointsPreviewCanvas.value.height = canvasHeight
  ctx.fillStyle = invert ? '#0f172a' : '#ffffff'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)
  ctx.fillStyle = invert ? '#ffffff' : '#0f172a'
  const dot = Math.max(1, Math.round(scale))
  for (const point of points) {
    const px = Math.round(point.x * scale)
    const py = Math.round(point.y * scale)
    ctx.fillRect(px, py, dot, dot)
  }
}

/**
 * 核心图像处理流程
 * 1. 转换为灰度图
 * 2. 生成 XDOG 强度图
 * 3. 根据阈值生成边缘图
 * 4. 可选：去噪、断线修复
 * 5. 膨胀加粗线条
 * 6. 生成输出图像、SVG 和点集
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
    statusText.value = '正在生成线稿...'
    const width = imageElement.value.naturalWidth
    const height = imageElement.value.naturalHeight
    const sourceCtx = sourceCanvas.value.getContext('2d')
    if (!sourceCtx) {
      return
    }
    sourceCanvas.value.width = width
    sourceCanvas.value.height = height
    sourceCtx.clearRect(0, 0, width, height)
    sourceCtx.drawImage(imageElement.value, 0, 0, width, height)
    const imageData = sourceCtx.getImageData(0, 0, width, height)
    const gray = createGrayBuffer(imageData)
    const strength = createXdogStrength(
      gray,
      width,
      height,
      xdogSigma.value,
      xdogK.value,
      xdogTau.value,
      xdogPhi.value,
      xdogEpsilon.value
    )
    let edgeMap = buildEdgeMapFromStrength(strength, xdogThreshold.value) as Uint8Array
    if (removeSpeckles.value) {
      edgeMap = removeIsolated(edgeMap, width, height)
    }
    if (bridgeLines.value) {
      edgeMap = closeGaps(edgeMap, width, height, 1)
    }
    const thickEdgeMap = dilateEdgeMap(edgeMap, width, height, lineThickness.value)
    const outputImage = buildOutputImage(thickEdgeMap, width, height, edgeDarkness.value, invertColors.value)
    const outputCtx = outputCanvas.value.getContext('2d')
    if (!outputCtx) {
      return
    }
    const rect = cropEnabled.value ? getCropRect(width, height) : { x: 0, y: 0, w: width, h: height }
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = width
    tempCanvas.height = height
    const tempCtx = tempCanvas.getContext('2d')
    if (!tempCtx) {
      return
    }
    tempCtx.putImageData(outputImage, 0, 0)
    outputCanvas.value.width = rect.w
    outputCanvas.value.height = rect.h
    outputCtx.clearRect(0, 0, rect.w, rect.h)
    outputCtx.drawImage(tempCanvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
    const pngUrl = outputCanvas.value.toDataURL('image/png')
    const jpgUrl = outputCanvas.value.toDataURL('image/jpeg', 0.92)
    const svgText = buildSvg(
      thickEdgeMap,
      width,
      height,
      Math.max(1, pointStep.value),
      lineThickness.value,
      edgeDarkness.value,
      invertColors.value,
      rect
    )
    const pointList = buildPointList(
      thickEdgeMap,
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
    outputText.value = outputFormat.value === 'json' ? jsonText : outputFormat.value === 'svg' ? svgText : ''
    if (outputFormat.value === 'png') {
      outputUrl.value = pngUrl
    } else if (outputFormat.value === 'jpg') {
      outputUrl.value = jpgUrl
    } else if (outputFormat.value === 'svg') {
      outputUrl.value = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
    } else {
      outputUrl.value = ''
    }
    renderPointsPreview(mergedPoints, rect, invertColors.value)
    statusText.value = '完成：已生成线稿'
  } finally {
    processing.value = false
  }
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
  <div class="extractor-container">
    <div class="actions-bar">
      <button class="primary" type="button" @click="requestFile">上传图片</button>
      <button type="button" @click="saveParams">保存参数</button>
      <button type="button" @click="loadParams">载入参数</button>
      <button type="button" @click="requestParamsFile">导入参数</button>
      <button type="button" :disabled="!canProcess" @click="processImage">重新处理</button>
      <button type="button" :disabled="!outputText && !outputUrl" @click="downloadOutput">下载输出</button>
    </div>

    <section class="workspace">
      <div class="panel">
        <h2>输入</h2>
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
        <h2>控制</h2>
        <div class="controls">
          <label>
            线条粗细：{{ lineThickness }}
            <input v-model.number="lineThickness" type="range" min="1" max="4" step="1" />
          </label>
          <label>
            线条暗度：{{ edgeDarkness.toFixed(3) }}
            <input v-model.number="edgeDarkness" type="range" min="0.4" max="1" step="0.001" />
          </label>
          <label>
            高斯半径：{{ xdogSigma.toFixed(3) }}
            <input v-model.number="xdogSigma" type="range" min="0.6" max="2.6" step="0.001" />
          </label>
          <label>
            模糊倍率：{{ xdogK.toFixed(3) }}
            <input v-model.number="xdogK" type="range" min="1.2" max="2.6" step="0.001" />
          </label>
          <label>
            DoG 权重：{{ xdogTau.toFixed(3) }}
            <input v-model.number="xdogTau" type="range" min="0.5" max="1" step="0.001" />
          </label>
          <label>
            线条强化：{{ xdogPhi.toFixed(3) }}
            <input v-model.number="xdogPhi" type="range" min="0" max="20" step="0.001" />
          </label>
          <label>
            边缘偏移：{{ xdogEpsilon.toFixed(3) }}
            <input v-model.number="xdogEpsilon" type="range" min="-1" max="0.5" step="0.001" />
          </label>
          <label>
            线条阈值：{{ xdogThreshold.toFixed(3) }}
            <input v-model.number="xdogThreshold" type="range" min="0.05" max="1" step="0.001" />
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
          <label class="toggle">
            <input v-model="removeSpeckles" type="checkbox" />
            去除杂点
          </label>
          <label class="toggle">
            <input v-model="invertColors" type="checkbox" />
            反色
          </label>
          <label class="toggle">
            <input v-model="bridgeLines" type="checkbox" />
            线条连续性维护
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
              <option value="json">点集 JSON</option>
            </select>
          </label>
        </div>
      </div>

      <div class="panel">
        <h2>点集预览</h2>
        <div class="preview">
          <canvas ref="pointsPreviewCanvas"></canvas>
        </div>
        <div class="hint">点集以裁剪区域左上角为 (0, 0)</div>
      </div>

      <div class="panel">
        <h2>输出</h2>
        <div class="preview">
          <img v-if="outputUrl" :src="outputUrl" alt="output" />
          <textarea v-else v-model="outputText" readonly></textarea>
        </div>
        <canvas ref="outputCanvas" class="hidden"></canvas>
        <div class="hint">提示：SVG 与点集建议调高采样间隔降低体积</div>
      </div>
    </section>
  </div>
</template>
