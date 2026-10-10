<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  reconstructStrokePaths,
  serializeStrokePaths,
  type StrokePoint,
  type StrokeReconstructionResult
} from '../utils/stroke-reconstruction'

const fileInput = ref<HTMLInputElement | null>(null)
const sourceImage = ref<HTMLImageElement | null>(null)
const sourceName = ref('image')
const canvas = ref<HTMLCanvasElement | null>(null)
const threshold = ref(150)
const invert = ref(false)
const thinningIterations = ref(80)
const minPathLength = ref(3)
const simplifyTolerance = ref(0.65)
const sampleSpacing = ref(1.5)
const diagonalConnectivity = ref(false)
const animate = ref(false)
const status = ref('上传线稿图片，调整阈值后重建笔画')
const result = ref<StrokeReconstructionResult | null>(null)
const isDrawing = ref(false)
const animationProgress = ref(0)
let animationFrame = 0
let animationStart = 0
let pathsForAnimation: StrokePoint[][] = []

const canExport = computed(() => Boolean(result.value?.strokes.length))
const totalPoints = computed(() => result.value?.strokes.reduce((n, p) => n + p.length, 0) ?? 0)

function openFile() {
  fileInput.value?.click()
}

function handleFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.onload = () => {
    if (sourceImage.value?.src.startsWith('blob:')) URL.revokeObjectURL(sourceImage.value.src)
    sourceImage.value = image
    sourceName.value = file.name.replace(/\.[^.]+$/, '') || 'image'
    status.value = `已载入 ${file.name}（${image.naturalWidth} × ${image.naturalHeight}）`
    rebuild()
    URL.revokeObjectURL(url)
  }
  image.onerror = () => {
    URL.revokeObjectURL(url)
    status.value = '图片读取失败，请尝试 PNG、JPG 或 WebP'
  }
  image.src = url
  input.value = ''
}

function drawPaths(paths: StrokePoint[][], progress = 1) {
  const target = canvas.value
  const image = sourceImage.value
  if (!target || !image) return
  const width = image.naturalWidth
  const height = image.naturalHeight
  target.width = width
  target.height = height
  const ctx = target.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = invert.value ? '#101318' : '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = invert.value ? '#f8fafc' : '#171923'
  ctx.fillStyle = ctx.strokeStyle
  ctx.lineWidth = Math.max(0.8, Math.min(width, height) / 700)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const lengths = paths.map(path => {
    let length = 0
    for (let i = 1; i < path.length; i++) length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
    return length
  })
  const totalLength = lengths.reduce((sum, n) => sum + n, 0)
  let budget = totalLength * Math.max(0, Math.min(1, progress))
  for (let s = 0; s < paths.length && budget > 0; s++) {
    const path = paths[s]
    if (!path.length) continue
    ctx.beginPath()
    ctx.moveTo(path[0].x, path[0].y)
    if (path.length === 1) {
      ctx.arc(path[0].x, path[0].y, ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i]
      const segment = Math.hypot(b.x - a.x, b.y - a.y)
      if (budget >= segment) {
        ctx.lineTo(b.x, b.y)
        budget -= segment
      } else {
        const t = segment === 0 ? 0 : budget / segment
        ctx.lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
        budget = 0
        break
      }
    }
    ctx.stroke()
  }
}

function rebuild() {
  stopAnimation()
  const image = sourceImage.value
  if (!image || !canvas.value) return
  const width = image.naturalWidth, height = image.naturalHeight
  const source = document.createElement('canvas')
  source.width = width
  source.height = height
  const ctx = source.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    status.value = '无法初始化 Canvas'
    return
  }
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, width, height).data
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) {
    const gray = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2]
    mask[i] = (invert.value ? gray >= threshold.value : gray < threshold.value) ? 1 : 0
  }
  try {
    result.value = reconstructStrokePaths(mask, width, height, undefined, {
      maxThinningIterations: thinningIterations.value,
      minPathLength: minPathLength.value,
      simplifyTolerance: simplifyTolerance.value,
      sampleSpacing: sampleSpacing.value,
      diagonalConnectivity: diagonalConnectivity.value
    })
    drawPaths(result.value.strokes)
    const d = result.value.diagnostics
    status.value = `完成：${d.outputPaths} 条路径 · ${totalPoints.value} 个轨迹点 · ${d.junctionPixels} 个交汇像素`
  } catch (error) {
    result.value = null
    status.value = error instanceof Error ? `重建失败：${error.message}` : '重建失败'
  }
}

function stopAnimation() {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  animationFrame = 0
  isDrawing.value = false
  animationProgress.value = 0
}

function playAnimation() {
  if (!result.value?.strokes.length) return
  stopAnimation()
  pathsForAnimation = result.value.strokes
  isDrawing.value = true
  animationStart = performance.now()
  const duration = Math.max(1200, totalPoints.value * 8)
  const tick = (now: number) => {
    const progress = Math.min(1, (now - animationStart) / duration)
    animationProgress.value = progress
    drawPaths(pathsForAnimation, progress)
    if (progress < 1) animationFrame = requestAnimationFrame(tick)
    else {
      animationFrame = 0
      isDrawing.value = false
      status.value = '笔画播放完成（起收笔为视觉模拟，并非物理压力模型）'
    }
  }
  animationFrame = requestAnimationFrame(tick)
}

function exportJson() {
  if (!result.value) return
  downloadText(serializeStrokePaths(result.value.strokes), `${sourceName.value}-strokes.json`, 'application/json')
}

function exportSvg() {
  if (!result.value || !sourceImage.value) return
  const image = sourceImage.value
  const paths = result.value.strokes.map(path =>
    path.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')
  ).join('')
  const color = invert.value ? '#f8fafc' : '#171923'
  const background = invert.value ? '#101318' : '#ffffff'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${image.naturalWidth}" height="${image.naturalHeight}" viewBox="0 0 ${image.naturalWidth} ${image.naturalHeight}"><rect width="100%" height="100%" fill="${background}"/><path d="${paths}" fill="none" stroke="${color}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  downloadText(svg, `${sourceName.value}-strokes.svg`, 'image/svg+xml')
}

function downloadText(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

watch([threshold, invert, thinningIterations, minPathLength, simplifyTolerance, sampleSpacing, diagonalConnectivity], () => {
  if (sourceImage.value) rebuild()
})
onBeforeUnmount(stopAnimation)
</script>

<template>
  <section class="stroke-page">
    <div class="stroke-toolbar">
      <button class="primary" type="button" @click="openFile">上传线稿</button>
      <button type="button" :disabled="!canExport" @click="rebuild">重建路径</button>
      <button type="button" :disabled="!canExport || isDrawing" @click="playAnimation">播放落笔</button>
      <button type="button" :disabled="!canExport" @click="exportJson">导出笔画 JSON</button>
      <button type="button" :disabled="!canExport" @click="exportSvg">导出 SVG</button>
      <input ref="fileInput" class="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/bmp" @change="handleFile" />
    </div>
    <div class="stroke-layout">
      <section class="stroke-panel">
        <h2>重建参数</h2>
        <label>二值化阈值：{{ threshold }}
          <input v-model.number="threshold" type="range" min="1" max="254" />
        </label>
        <label>细化迭代上限：{{ thinningIterations }}
          <input v-model.number="thinningIterations" type="range" min="1" max="200" />
        </label>
        <label>忽略短路径：{{ minPathLength.toFixed(1) }} px
          <input v-model.number="minPathLength" type="range" min="0" max="20" step="0.5" />
        </label>
        <label>曲线简化容差：{{ simplifyTolerance.toFixed(2) }} px
          <input v-model.number="simplifyTolerance" type="range" min="0" max="3" step="0.05" />
        </label>
        <label>轨迹采样间隔：{{ sampleSpacing.toFixed(1) }} px
          <input v-model.number="sampleSpacing" type="range" min="0.5" max="5" step="0.1" />
        </label>
        <label class="stroke-check"><input v-model="invert" type="checkbox" /> 提取亮线（黑底白线）</label>
        <label class="stroke-check"><input v-model="diagonalConnectivity" type="checkbox" /> 保留所有对角连接（可能增加误连接）</label>
        <p class="stroke-note">路径顺序采用减少抬笔距离的启发式排序，不代表原作者真实书写顺序。交叉点处会拆成多段，避免随意吞并分支。</p>
      </section>
      <section class="stroke-panel stroke-preview-panel">
        <h2>轨迹预览</h2>
        <div class="stroke-canvas-wrap">
          <canvas ref="canvas"></canvas>
          <div v-if="!sourceImage" class="stroke-empty">上传图片开始重建</div>
        </div>
        <p class="stroke-status">{{ status }}</p>
        <div v-if="result" class="stroke-stats">
          <span>原始像素 <b>{{ result.diagnostics.sourcePixels }}</b></span>
          <span>骨架像素 <b>{{ result.diagnostics.skeletonPixels }}</b></span>
          <span>端点 <b>{{ result.diagnostics.endpoints }}</b></span>
          <span>闭环 <b>{{ result.diagnostics.closedLoops }}</b></span>
          <span>路径 <b>{{ result.diagnostics.outputPaths }}</b></span>
          <span>播放进度 <b>{{ Math.round(animationProgress * 100) }}%</b></span>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.stroke-page { display: flex; flex-direction: column; gap: 18px; }
.stroke-toolbar { display: flex; gap: 10px; flex-wrap: wrap; padding: 14px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; }
.stroke-layout { display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); gap: 18px; align-items: start; }
.stroke-panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.stroke-panel h2 { margin: 0; font-size: 16px; color: #1e293b; }
.stroke-panel label { display: flex; flex-direction: column; gap: 7px; font-size: 13px; color: #334155; }
.stroke-panel input[type="range"] { width: 100%; accent-color: #2563eb; }
.stroke-check { flex-direction: row !important; align-items: center; }
.stroke-note { margin: 0; color: #64748b; font-size: 12px; line-height: 1.65; }
.stroke-preview-panel { min-height: 540px; }
.stroke-canvas-wrap { min-height: 420px; flex: 1; position: relative; display: flex; justify-content: center; align-items: center; padding: 10px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
.stroke-canvas-wrap canvas { display: block; max-width: 100%; max-height: 65vh; object-fit: contain; }
.stroke-empty { position: absolute; color: #94a3b8; font-size: 14px; pointer-events: none; }
.stroke-status { margin: 0; color: #2563eb; font-size: 13px; }
.stroke-stats { display: flex; flex-wrap: wrap; gap: 8px 18px; color: #64748b; font-size: 12px; }
.stroke-stats b { color: #0f172a; font-variant-numeric: tabular-nums; }
@media (max-width: 760px) { .stroke-layout { grid-template-columns: 1fr; } .stroke-preview-panel { min-height: 360px; } .stroke-canvas-wrap { min-height: 280px; } }
</style>
