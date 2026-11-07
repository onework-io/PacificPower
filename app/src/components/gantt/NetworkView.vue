<script setup lang="ts">
import { computed, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { useViewerStore } from '@/stores/viewer'
import { DEFAULT_LAYOUT, edgePath, layoutNetwork, traceCriticalPath } from '@/lib/network'
import { STEP_BY_ID } from '@/data/installSteps'

const store = useScheduleStore()
const viewer = useViewerStore()
const emit = defineEmits<{ openGantt: [stepId: string] }>()
const L = DEFAULT_LAYOUT

const layout = computed(() =>
  layoutNetwork(store.rows.map((r) => ({ id: r.step.id, deps: r.step.deps }))),
)

const rowById = computed(() => new Map(store.rows.map((r) => [r.step.id, r])))
const scrollEl = ref<HTMLElement | null>(null)
const panning = ref(false)
let panStart: { x: number; y: number; left: number; top: number } | null = null
let suppressClick = false

const n1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1)

/** 箭線：兩端都在要徑上且確實相鄰時才算要徑箭線 */
const edges = computed(() =>
  layout.value.edges.map((e) => {
    const from = layout.value.nodes.get(e.from)!
    const to = layout.value.nodes.get(e.to)!
    const rf = rowById.value.get(e.from)
    const rt = rowById.value.get(e.to)
    const lag = STEP_BY_ID.get(e.from)?.lagDays ?? 0
    // 前置完工 + lag 恰好等於後續開工，代表這條相依正在驅動排程
    const driving =
      !!rf && !!rt && Math.abs(rf.task.finish + lag - rt.task.start) < 0.001
    return {
      key: `${e.from}->${e.to}`,
      d: edgePath(from, to, L),
      critical: !!rf?.task.critical && !!rt?.task.critical && driving,
      lag,
      labelX: from.x + L.nodeWidth + 14,
      labelY: from.y + L.nodeHeight / 2 - 6,
    }
  }),
)

const nodes = computed(() =>
  [...layout.value.nodes.values()].map((n) => ({ ...n, row: rowById.value.get(n.id)! })),
)

const criticalPathRows = computed(() => {
  const ids = traceCriticalPath(
    store.rows.map((row) => ({
      id: row.step.id,
      deps: row.step.deps,
      start: row.task.start,
      finish: row.task.finish,
      critical: row.task.critical,
      lagAfter: STEP_BY_ID.get(row.step.id)?.lagDays ?? 0,
    })),
    store.projectDays,
  )
  return ids.map((id) => rowById.value.get(id)!).filter(Boolean)
})

const criticalActivityDays = computed(() =>
  criticalPathRows.value.reduce((sum, row) => sum + row.duration, 0),
)

const criticalWaitDays = computed(() =>
  criticalPathRows.value.slice(0, -1).reduce((sum, row, index) => {
    const next = criticalPathRows.value[index + 1]
    return sum + Math.max(0, next.task.start - row.task.finish)
  }, 0),
)

function select(id: string) {
  store.selectedId = id
  const partId = STEP_BY_ID.get(id)?.partId
  if (partId) viewer.isolatedId = partId
  emit('openGantt', id)
}

function panDown(event: PointerEvent) {
  if (event.button !== 0 || !scrollEl.value) return
  const scroll = scrollEl.value
  panStart = {
    x: event.clientX,
    y: event.clientY,
    left: scroll.scrollLeft,
    top: scroll.scrollTop,
  }
  suppressClick = false
}

function panMove(event: PointerEvent) {
  if (!panStart || !scrollEl.value) return
  const dx = event.clientX - panStart.x
  const dy = event.clientY - panStart.y
  if (!panning.value && Math.hypot(dx, dy) < 5) return
  if (!scrollEl.value.hasPointerCapture(event.pointerId)) {
    // 確認是拖曳後才 capture；短按節點時保留原始 click target，才能可靠跳轉。
    scrollEl.value.setPointerCapture(event.pointerId)
  }
  panning.value = true
  suppressClick = true
  scrollEl.value.scrollLeft = panStart.left - dx
  scrollEl.value.scrollTop = panStart.top - dy
  event.preventDefault()
}

function panEnd(event: PointerEvent) {
  if (scrollEl.value?.hasPointerCapture(event.pointerId)) {
    scrollEl.value.releasePointerCapture(event.pointerId)
  }
  panStart = null
  panning.value = false
  if (suppressClick) window.setTimeout(() => { suppressClick = false }, 0)
}

/** 拖曳結束後瀏覽器仍會派送 click；在 capture 階段擋掉，避免誤跳甘特圖。 */
function blockClickAfterPan(event: MouseEvent) {
  if (!suppressClick) return
  event.preventDefault()
  event.stopPropagation()
  suppressClick = false
}
</script>

<template>
  <div class="net">
    <div class="net__legend">
      <span class="key key--critical" />要徑
      <span class="key key--normal" />非要徑
      <span class="net__gap" />
      <span class="net__note">拖曳畫布平移 ｜ 點節點跳到甘特圖 ｜ 格內：ES / 工期 / EF、LS / 浮時 / LF</span>
    </div>

    <p v-if="layout.cycle" class="net__error">
      相依關係成環，無法繪製網圖：{{ layout.cycle.join('、') }}
    </p>

    <div
      v-else
      ref="scrollEl"
      class="net__scroll"
      :class="{ 'is-panning': panning }"
      @pointerdown="panDown"
      @pointermove="panMove"
      @pointerup="panEnd"
      @pointercancel="panEnd"
      @click.capture="blockClickAfterPan"
    >
      <svg :width="layout.width" :height="layout.height" class="net__svg">
        <defs>
          <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#5b6b86" />
          </marker>
          <marker id="arrow-c" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#e11d48" />
          </marker>
        </defs>

        <g class="edges">
          <path
            v-for="e in edges"
            :key="e.key"
            :d="e.d"
            :class="{ 'is-critical': e.critical }"
            :marker-end="e.critical ? 'url(#arrow-c)' : 'url(#arrow)'"
          />
          <text v-for="e in edges.filter((x) => x.lag > 0)" :key="`lag-${e.key}`" :x="e.labelX" :y="e.labelY" class="lag">
            +{{ e.lag }}d 養護
          </text>
        </g>

        <g
          v-for="n in nodes"
          :key="n.id"
          class="node"
          :class="{
            'is-critical': n.row.task.critical,
            'is-selected': store.selectedId === n.id,
            'has-no-model': !n.row.step.partId,
          }"
          :transform="`translate(${n.x}, ${n.y})`"
          role="button"
          tabindex="0"
          :aria-label="`前往甘特圖工項 ${n.row.step.name}`"
          @click="select(n.id)"
          @keydown.enter.prevent="select(n.id)"
          @keydown.space.prevent="select(n.id)"
        >
          <rect :width="L.nodeWidth" :height="L.nodeHeight" rx="6" />

          <line :x1="0" :y1="20" :x2="L.nodeWidth" :y2="20" class="sep" />
          <line :x1="0" :y1="56" :x2="L.nodeWidth" :y2="56" class="sep" />

          <text class="es" x="8" y="14">{{ n1(n.row.task.start) }}</text>
          <text class="dur" :x="L.nodeWidth / 2" y="14">{{ n1(n.row.duration) }}</text>
          <text class="ef" :x="L.nodeWidth - 8" y="14">{{ n1(n.row.task.finish) }}</text>

          <text class="seq" x="8" y="36">{{ n.row.wbs }}</text>
          <text class="name" x="8" y="50">{{ n.row.step.name }}</text>

          <text class="ls" x="8" y="71">{{ n1(n.row.task.lateStart) }}</text>
          <text class="float" :x="L.nodeWidth / 2" y="71">{{ n1(n.row.task.float) }}</text>
          <text class="lf" :x="L.nodeWidth - 8" y="71">{{ n1(n.row.task.lateFinish) }}</text>
        </g>
      </svg>
    </div>

    <section v-if="!layout.cycle" class="calculation" aria-label="PERT 計算路徑說明">
      <div class="calculation__summary">
        <div>
          <strong>PERT／CPM 計算路徑</strong>
          <span>主控制路徑 {{ criticalPathRows.length }} 項</span>
        </div>
        <b>{{ criticalActivityDays }} 天活動＋{{ criticalWaitDays }} 天等待＝{{ store.projectDays }} 天總工期</b>
      </div>

      <div class="path" aria-label="主控制路徑工項順序">
        <template v-for="(row, index) in criticalPathRows" :key="row.step.id">
          <button title="跳到甘特圖查看" @click="select(row.step.id)">
            <em>{{ row.wbs }}</em>{{ row.step.name }}<small>{{ row.duration }}d</small>
          </button>
          <span v-if="index < criticalPathRows.length - 1" class="path__arrow">
            <i v-if="criticalPathRows[index + 1].task.start > row.task.finish">
              ＋{{ criticalPathRows[index + 1].task.start - row.task.finish }}d 等待
            </i>
            →
          </span>
        </template>
      </div>

      <div class="formula">
        <span><b>前推</b> ES＝前置活動 EF＋等待；EF＝ES＋工期</span>
        <span><b>後推</b> LF＝後續活動 LS－等待；LS＝LF－工期</span>
        <span><b>浮時</b> LS－ES；浮時＝0 即要徑</span>
        <span><b>PERT</b> te＝(O＋4M＋P)÷6；目前 M 採 WBS 工作天</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.net { display: flex; flex-direction: column; height: 100%; min-height: 0; }

.net__legend {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 11px;
  flex: none;
}
.key { width: 16px; height: 2px; display: inline-block; }
.key--critical { background: #e11d48; }
.key--normal { background: #6c808c; margin-left: 10px; }
.net__gap { flex: 1; }
.net__note { font-variant-numeric: tabular-nums; }

.net__scroll {
  flex: 1;
  overflow: auto;
  min-height: 0;
  cursor: grab;
  touch-action: none;
  overscroll-behavior: contain;
}
.net__scroll.is-panning { cursor: grabbing; user-select: none; }
.net__svg { display: block; }

.calculation {
  flex: none;
  max-height: 210px;
  padding: 10px 14px 12px;
  border-top: 1px solid var(--line);
  background: #242a2e;
  overflow: auto;
}
.calculation__summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.calculation__summary > div { display: flex; align-items: baseline; gap: 9px; }
.calculation__summary strong { color: var(--text); }
.calculation__summary span { color: var(--muted); font-size: 10px; }
.calculation__summary > b { color: #ff8098; font-size: 11px; white-space: nowrap; }
.path { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding-bottom: 5px; overflow-x: auto; }
.path button { display: flex; align-items: center; gap: 5px; flex: none; padding: 4px 7px; border-color: #e11d4866; background: #26192a; font-size: 10px; white-space: nowrap; }
.path button:hover { border-color: #ff6b8a; color: #ff9caf; }
.path em { color: #ff6b8a; font-style: normal; font-weight: 700; }
.path small { color: var(--muted); }
.path__arrow { display: flex; align-items: center; gap: 4px; flex: none; color: #ff6b8a; }
.path__arrow i { color: #f6c768; font-size: 9px; font-style: normal; }
.formula { display: grid; grid-template-columns: repeat(2, minmax(240px, 1fr)); gap: 3px 18px; margin-top: 4px; color: var(--muted); font-size: 10px; }
.formula b { color: var(--accent); }

.edges path { fill: none; stroke: #6c808c; stroke-width: 1.4; }
.edges path.is-critical { stroke: #e11d48; stroke-width: 2; }
.lag { fill: var(--muted); font-size: 9px; }

.node { cursor: pointer; }
.node rect { fill: #2d353a; stroke: #49575f; stroke-width: 1.2; }
.node:hover rect { stroke: var(--accent); }
.node.is-critical rect { stroke: #e11d48; fill: #26192a; }
.node.is-selected rect { stroke: var(--accent); stroke-width: 2.2; }

.node .sep { stroke: #ffffff14; stroke-width: 1; }

.node text { fill: var(--muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.node .dur, .node .float { text-anchor: middle; }
.node .ef, .node .lf { text-anchor: end; }
.node .dur { fill: var(--text); font-weight: 600; }
.node .seq { fill: var(--accent); font-size: 10px; font-weight: 600; }
.node .name { fill: var(--text); font-size: 11px; }
.node.has-no-model .name { fill: var(--muted); }
.node.is-critical .seq { fill: #ff6b8a; }
</style>
