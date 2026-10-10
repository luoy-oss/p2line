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
const viewMode = ref<'lines' | 'points' | 'combined'>('combined')
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
const pointModeLabel = computed(() => viewMode.value === 'lines' ? '线条' : viewMode.value === 'points' ? '点集' : '线条 + 点集')
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

  const dark = invert.value
  const foreground = dark ? '#f1f5f9' : '#172033'
  ctx.fillStyle = dark ? '#111827' : '#ffffff'
  ctx.fillRect(0, 0, width, height)

  // A quiet coordinate grid makes point spacing and local geometry easier to inspect.
  const gridStep = Math.max(24, Math.round(Math.min(width, height) / 12 / 8) * 8)
  ctx.strokeStyle = dark ? 'rgba(148,163,184,0.12)' : 'rgba(100,116,139,0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= width; x += gridStep) {
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, height)
  }
  for (let y = 0; y <= height; y += gridStep) {
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(width, y + 0.5)
  }
  ctx.stroke()

  const lengths = paths.map(path => {
    let length = 0
    for (let i = 1; i < path.length; i++) {
      length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
    }
    return length
  })
  let budget = lengths.reduce((sum, n) => sum + n, 0) * Math.max(0, Math.min(1, progress))
  const totalBudget = budget
  const palette = ['#2563eb', '#0d9488', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#ea580c']
  const showLines = viewMode.value !== 'points'
  const showPoints = viewMode.value !== 'lines'
  const baseLineWidth = Math.max(0.8, Math.min(width, height) / 700)
  const pointRadius = Math.max(1.3, Math.min(3.2, Math.min(width, height) / 360))
  let consumed = 0

  for (let s = 0; s < paths.length; s++) {
    const path = paths[s]
    if (!path.length) continue
    const strokeLength = lengths[s]
    const strokeBudget = Math.max(0, Math.min(strokeLength, budget))
    const color = palette[s % palette.length]
    const visiblePoints: StrokePoint[] = [path[0]]
    let localConsumed = 0

    if (path.length === 1) {
      if (showPoints && consumed <= totalBudget) {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(path[0].x, path[0].y, pointRadius, 0, Math.PI * 2)
        ctx.fill()
      }
      continue
    }

    if (showLines && strokeBudget > 0) {
      ctx.strokeStyle = foreground
      ctx.lineWidth = baseLineWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(path[0].x, path[0].y)
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i]
        const segment = Math.hypot(b.x - a.x, b.y - a.y)
        if (localConsumed + segment <= strokeBudget) {
          ctx.lineTo(b.x, b.y)
          localConsumed += segment
          visiblePoints.push(b)
        } else {
          const remaining = strokeBudget - localConsumed
          if (remaining > 0 && segment > 0) {
            const t = remaining / segment
            ctx.lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
            visiblePoints.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
          }
          break
        }
      }
      ctx.stroke()
    } else {
      let pathLength = 0
      for (let i = 1; i < path.length; i++) {
        const segment = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
        pathLength += segment
        if (pathLength <= strokeBudget || progress >= 1) visiblePoints.push(path[i])
      }
    }

    if (showPoints && (strokeBudget > 0 || progress >= 1)) {
      ctx.fillStyle = color
      for (const point of visiblePoints) {
        ctx.beginPath()
        ctx.arc(point.x, point.y, pointRadius, 0, Math.PI * 2)
        ctx.fill()
      }
      // Distinct start/end markers help inspect path direction without connecting separate strokes.
      if (visiblePoints.length) {
        const first = visiblePoints[0]
        ctx.fillStyle = '#16a34a'
        ctx.beginPath()
        ctx.arc(first.x, first.y, pointRadius * 2.1, 0, Math.PI * 2)
        ctx.fill()
        if (progress >= 1 && visiblePoints.length === path.length) {
          const last = path[path.length - 1]
          ctx.fillStyle = '#dc2626'
          ctx.beginPath()
          ctx.arc(last.x, last.y, pointRadius * 2.1, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    budget -= strokeBudget
    consumed += strokeLength
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

watch(viewMode, () => {\n  if (result.value) drawPaths(result.value.strokes, isDrawing.value ? animationProgress.value : 1)\n})\n\nwatch([threshold, invert, thinningIterations, minPathLength, simplifyTolerance, sampleSpacing, diagonalConnectivity], () => {
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
        <div class="stroke-preview-heading">
          <div>
            <p class="stroke-eyebrow">STROKE INSPECTOR</p>
            <h2>笔画轨迹可视化</h2>
            <p class="stroke-subtitle">检查轨迹连贯性、采样点分布与每条笔画的起收方向</p>
          </div>
          <div class="stroke-view-switch" role="group" aria-label="渲染模式">
            <button type="button" :class="{ active: viewMode === 'lines' }" @click="viewMode = 'lines'">线条</button>
            <button type="button" :class="{ active: viewMode === 'points' }" @click="viewMode = 'points'">点集</button>
            <button type="button" :class="{ active: viewMode === 'combined' }" @click="viewMode = 'combined'">叠加</button>
          </div>
        </div>
        <div class="stroke-canvas-wrap" :class="{ 'stroke-canvas-wrap--dark': invert }">
          <canvas ref="canvas"></canvas>
          <div v-if="!sourceImage" class="stroke-empty">上传图片开始重建</div>
        </div>
        <div class="stroke-preview-legend">
          <span><i class="legend-sample"></i> 轨迹点</span>
          <span><i class="legend-start"></i> 笔画起点</span>
          <span><i class="legend-end"></i> 笔画终点</span>
          <span class="legend-mode">{{ pointModeLabel }}</span>
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
.stroke-page { display: flex; flex-direction: column; gap: 18px; color: #172033; }
.stroke-toolbar { display: flex; gap: 9px; flex-wrap: wrap; padding: 14px 16px; background: rgba(255,255,255,.92); border: 1px solid #e5eaf1; border-radius: 14px; box-shadow: 0 8px 28px rgba(25,42,70,.04); }
.stroke-toolbar button { border-radius: 9px; padding: 9px 14px; font-weight: 600; }
.stroke-toolbar button.primary { background: #285eea; border-color: #285eea; color: #fff; }
.stroke-toolbar button:disabled { opacity: .45; cursor: not-allowed; }
.hidden-input { display: none; }
.stroke-layout { display: grid; grid-template-columns: minmax(250px, 300px) minmax(0, 1fr); gap: 16px; align-items: start; }
.stroke-panel { background: #fff; border: 1px solid #e5eaf1; border-radius: 16px; padding: 18px; display: flex; flex-direction: column; gap: 16px; min-width: 0; box-shadow: 0 8px 28px rgba(25,42,70,.045); }
.stroke-panel h2 { margin: 0; font-size: 17px; color: #172033; letter-spacing: -.02em; }
.stroke-preview-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
.stroke-eyebrow { margin: 0 0 4px; color: #8b96a9; font-size: 10px; font-weight: 800; letter-spacing: .14em; }
.stroke-subtitle { margin: 7px 0 0; font-size: 12px; line-height: 1.5; color: #8490a3; }
.stroke-view-switch { display: inline-flex; gap: 3px; padding: 4px; background: #f1f5f9; border: 1px solid #e5eaf1; border-radius: 10px; }
.stroke-view-switch button { border: 0; border-radius: 7px; padding: 7px 10px; color: #64748b; background: transparent; font-size: 12px; cursor: pointer; white-space: nowrap; }
.stroke-view-switch button.active { color: #2455d6; background: #fff; box-shadow: 0 1px 4px rgba(15,23,42,.1); }
.stroke-panel label { display: flex; flex-direction: column; gap: 7px; font-size: 12px; font-weight: 600; color: #475569; }
.stroke-panel input[type="range"] { width: 100%; accent-color: #356df3; }
.stroke-check { flex-direction: row !important; align-items: center; }
.stroke-note { margin: 0; padding: 11px 12px; border-radius: 9px; background: #f8fafc; color: #7b879a; font-size: 11px; line-height: 1.7; }
.stroke-preview-panel { min-height: 540px; }
.stroke-canvas-wrap { min-height: 420px; flex: 1; position: relative; display: flex; justify-content: center; align-items: center; padding: 12px; overflow: auto; border: 1px solid #e4e9f1; border-radius: 12px; background-color: #fbfcfe; background-image: radial-gradient(#dbe2ed .8px, transparent .8px); background-size: 16px 16px; }
.stroke-canvas-wrap--dark { background-color: #111827; background-image: radial-gradient(#334155 .8px, transparent .8px); border-color: #273449; }
.stroke-canvas-wrap canvas { display: block; max-width: 100%; max-height: 65vh; object-fit: contain; }
.stroke-empty { position: absolute; color: #94a3b8; font-size: 14px; pointer-events: none; }
.stroke-preview-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; color: #738096; font-size: 11px; }
.stroke-preview-legend span { display: inline-flex; align-items: center; gap: 7px; }
.stroke-preview-legend i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #2563eb; }\n.stroke-preview-legend .legend-sample { background: #2563eb; }
.stroke-preview-legend .legend-start { background: #16a34a; }
.stroke-preview-legend .legend-end { background: #dc2626; }
.stroke-preview-legend .legend-mode { margin-left: auto; color: #285eea; font-weight: 700; }
.stroke-status { margin: 0; color: #2563eb; font-size: 12px; line-height: 1.5; }
.stroke-stats { display: flex; flex-wrap: wrap; gap: 8px; }
.stroke-stats span { padding: 7px 9px; border: 1px solid #e9edf4; border-radius: 8px; background: #fafbfd; color: #7a879a; font-size: 11px; }
.stroke-stats b { color: #172033; font-variant-numeric: tabular-nums; margin-left: 3px; }
@media (max-width: 760px) {
  .stroke-layout { grid-template-columns: minmax(0, 1fr); }
  .stroke-preview-panel { min-height: 360px; }
  .stroke-canvas-wrap { min-height: 280px; }
  .stroke-panel { padding: 14px; }
  .stroke-view-switch { width: 100%; }
  .stroke-view-switch button { flex: 1; }
}
</style>
