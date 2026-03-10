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
const pointOrder = ref<PointOrder>('scan')  // 点集导出顺序
const mergePointsEnabled = ref(false)       // 是否合并点集
const mergeDistance = ref(2)                // 合并距离
const invertOutput = ref(false)             // 最终反色
const threshold = ref(128)                  // 二值化阈值（用于点集提取）

let pendingTimer: number | null = null

const canProcess = computed(() => Boolean(imageElement.value) && !processing.value)

const outputFileName = computed(() => {
  const base = imageName.value ? imageName.value.replace(/\.[^.]+$/, '') : 'outline'
  return `${base}-ps.${outputFormat.value}`
})

const paramsFileName = computed(() => {
  const base = imageName.value ? imageName.value.replace(/\.[^.]+$/, '') : 'outline'
  return `${base}-ps-params.json`
})

const storageKey = 'p2line-ps-params'
const pointOrderOptions: PointOrder[] = ['scan', 'trace', 'contour']
const outputFormatOptions: OutputFormat[] = ['png', 'jpg', 'svg', 'json']

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
    
    renderPointsPreview(mergedPoints, rect, invertOutput.value)
    statusText.value = '完成：PS 流程线稿提取'

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
        <h2>PS 流程控制</h2>
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
          
          <h3>点集提取设置</h3>
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
