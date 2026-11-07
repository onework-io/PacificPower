<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { useCostStore } from '@/stores/cost'
import { calculateLaborHours } from '@/lib/cost'
import { actualCostCurve, amountAt, plannedCostCurve, type AmountPoint } from '@/lib/costCurve'
import { dayToDate } from '@/lib/schedule'

const C_PLAN = '#3b82f6'
const C_ACTUAL = '#d97706'
const PAD = { top: 18, right: 76, bottom: 34, left: 72 }
const schedule = useScheduleStore()
const costs = useCostStore()
const box = ref({ w: 640, h: 320 })
const plotEl = ref<SVGSVGElement | null>(null)
const hoverDay = ref<number | null>(null)
let ro: ResizeObserver | null = null

watch(plotEl, (element) => {
  ro?.disconnect()
  if (!element) return
  ro = new ResizeObserver(([entry]) => {
    const rect = entry.contentRect
    if (rect.width > 0 && rect.height > 0) box.value = { w: rect.width, h: rect.height }
  })
  ro.observe(element)
})
onBeforeUnmount(() => ro?.disconnect())

const rows = computed(() => schedule.rows.map((row) => ({
  start: row.task.start,
  finish: row.task.finish,
  estimate: calculateLaborHours(costs.get(row.step.id).laborPeople, row.duration),
  actual: costs.getActual(row.step.id),
  progress: row.progress,
})))
const maxDay = computed(() => Math.max(Math.ceil(schedule.projectDays), 1))
const planned = computed(() => plannedCostCurve(rows.value, maxDay.value))
const actual = computed(() => actualCostCurve(rows.value, maxDay.value, schedule.dataDay))
const totalEstimate = computed(() => rows.value.reduce((sum, row) => sum + row.estimate, 0))
const actualTotal = computed(() => rows.value.reduce((sum, row) => sum + (row.actual ?? 0), 0))
const actualCount = computed(() => rows.value.filter((row) => row.actual !== null).length)
const plannedNow = computed(() => amountAt(planned.value, schedule.dataDay))
const reportedPlannedNow = computed(() => amountAt(
  plannedCostCurve(rows.value.filter((row) => row.actual !== null), maxDay.value),
  schedule.dataDay,
))
const variance = computed(() => actualTotal.value - reportedPlannedNow.value)
const variancePct = computed(() => reportedPlannedNow.value > 0 ? variance.value / reportedPlannedNow.value * 100 : null)
const maxAmount = computed(() => Math.max(totalEstimate.value, actualTotal.value, 1) * 1.05)
const inner = computed(() => ({ w: Math.max(80, box.value.w - PAD.left - PAD.right), h: Math.max(60, box.value.h - PAD.top - PAD.bottom) }))
const sx = (day: number) => PAD.left + day / maxDay.value * inner.value.w
const sy = (amount: number) => PAD.top + (1 - amount / maxAmount.value) * inner.value.h
const path = (curve: AmountPoint[]) => curve.map((point, index) => `${index ? 'L' : 'M'} ${sx(point.day).toFixed(1)} ${sy(point.amount).toFixed(1)}`).join(' ')
const ticksX = computed(() => {
  const step = Math.max(1, Math.ceil(maxDay.value / 12 / 7) * 7)
  const result: number[] = []
  for (let day = 0; day <= maxDay.value; day += step) result.push(day)
  if (result[result.length - 1] !== maxDay.value) result.push(maxDay.value)
  return result
})
const ticksY = [0, .25, .5, .75, 1]
const number = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 })
const fmt = (value: number) => `${number.format(value)} 小時`
const compact = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(1)}k h` : `${Math.round(value)} h`
const fmtDate = (day: number) => { const date = dayToDate(schedule.projectStartDate, Math.round(day)); return `${date.getMonth() + 1}/${date.getDate()}` }
const hover = computed(() => hoverDay.value === null ? null : {
  day: Math.min(Math.max(hoverDay.value, 0), maxDay.value),
  plan: amountAt(planned.value, hoverDay.value),
  actual: actual.value.length ? amountAt(actual.value, hoverDay.value) : null,
})
function onMove(event: PointerEvent) {
  if (!plotEl.value) return
  const rect = plotEl.value.getBoundingClientRect()
  hoverDay.value = (event.clientX - rect.left - PAD.left) / inner.value.w * maxDay.value
}
</script>

<template>
  <div class="curve">
    <div class="stats">
      <span>專案計畫人工時 <b>{{ fmt(totalEstimate) }}</b></span>
      <span>截至資料日期計畫 <b :style="{ color: C_PLAN }">{{ fmt(plannedNow) }}</b></span>
      <span>實際已填 <b :style="{ color: C_ACTUAL }">{{ fmt(actualTotal) }}</b><em>{{ actualCount }}/{{ rows.length }} 項</em></span>
      <span v-if="actualCount">已填工項同期計畫 <b>{{ fmt(reportedPlannedNow) }}</b></span>
      <span v-if="actualCount" :class="variance > 0 ? 'over' : variance < 0 ? 'under' : ''">
        {{ variance > 0 ? '超出計畫' : variance < 0 ? '低於計畫' : '無差異' }} <b>{{ fmt(Math.abs(variance)) }}</b>
        <em v-if="variancePct !== null">{{ Math.abs(variancePct).toFixed(1) }}%</em>
      </span>
      <span class="spacer" />
      <button v-if="actualCount" @click="costs.clearActuals()">清除實際人工時</button>
    </div>
    <div class="legend"><span><i :style="{ background: C_PLAN }" />計畫人工時累計</span><span><i :style="{ background: C_ACTUAL }" />實際人工時累計</span></div>
    <div class="plot">
      <svg ref="plotEl" :width="box.w" :height="box.h" @pointermove="onMove" @pointerleave="hoverDay = null">
        <g class="grid">
          <line v-for="tick in ticksY" :key="`y${tick}`" :x1="PAD.left" :y1="sy(maxAmount * tick)" :x2="box.w - PAD.right" :y2="sy(maxAmount * tick)" />
          <line v-for="tick in ticksX" :key="`x${tick}`" :x1="sx(tick)" :y1="PAD.top" :x2="sx(tick)" :y2="sy(0)" />
        </g>
        <path :d="path(planned)" class="line" :style="{ stroke: C_PLAN }" />
        <path v-if="actual.length" :d="path(actual)" class="line" :style="{ stroke: C_ACTUAL }" />
        <line class="today" :x1="sx(schedule.dataDay)" :y1="PAD.top" :x2="sx(schedule.dataDay)" :y2="sy(0)" />
        <circle :cx="sx(schedule.dataDay)" :cy="sy(plannedNow)" r="4" :style="{ fill: C_PLAN }" />
        <circle v-if="actual.length" :cx="sx(schedule.dataDay)" :cy="sy(actualTotal)" r="5" :style="{ fill: C_ACTUAL }" />
        <g class="axis">
          <text v-for="tick in ticksY" :key="`ty${tick}`" :x="PAD.left - 8" :y="sy(maxAmount * tick) + 4">{{ compact(maxAmount * tick) }}</text>
          <text v-for="tick in ticksX" :key="`tx${tick}`" class="tx" :x="sx(tick)" :y="sy(0) + 18">{{ fmtDate(tick) }}</text>
        </g>
        <g v-if="hover">
          <line class="crosshair" :x1="sx(hover.day)" :y1="PAD.top" :x2="sx(hover.day)" :y2="sy(0)" />
          <circle :cx="sx(hover.day)" :cy="sy(hover.plan)" r="4" :style="{ fill: C_PLAN }" />
          <circle v-if="hover.actual !== null" :cx="sx(hover.day)" :cy="sy(hover.actual)" r="4" :style="{ fill: C_ACTUAL }" />
        </g>
      </svg>
      <div v-if="hover" class="tip" :style="{ left: `${sx(hover.day)}px` }"><b>{{ fmtDate(hover.day) }}</b><span>計畫 {{ fmt(hover.plan) }}</span><span v-if="hover.actual !== null">實際 {{ fmt(hover.actual) }}</span></div>
    </div>
    <p class="note" v-if="!actualCount">尚未填寫實際人工時。請到「人工時」展開 WBS 工項，輸入截至目前已投入人工時。</p>
    <p class="note" v-else>實際曲線依各 WBS 完成度，把已填實際人工時分配至已執行區間；未填的 {{ rows.length - actualCount }} 項不會當成零。</p>
  </div>
</template>

<style scoped>
.curve { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.stats { display: flex; align-items: center; gap: 14px; padding: 8px 14px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.stats span { color: var(--muted); font-size: 11px; white-space: nowrap; }
.stats b { margin-left: 3px; color: var(--text); font-variant-numeric: tabular-nums; }
.stats em { margin-left: 5px; font-style: normal; opacity: .7; }
.stats .over b { color: var(--danger); }
.stats .under b { color: #22c55e; }
.spacer { flex: 1; }
.legend { display: flex; gap: 16px; padding: 7px 14px 3px; color: var(--muted); font-size: 11px; }
.legend span { display: flex; align-items: center; gap: 6px; }
.legend i { width: 14px; height: 2px; }
.plot { position: relative; flex: 1; min-height: 0; padding: 0 4px 6px; }
.plot svg { display: block; }
.grid line { stroke: #ffffff12; }
.line { fill: none; stroke-width: 2; stroke-linejoin: round; }
.today { stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 3 3; }
.crosshair { stroke: #ffffff40; }
.axis text { fill: var(--muted); font-size: 10px; text-anchor: end; }
.axis .tx { text-anchor: middle; }
.tip { position: absolute; top: 10px; transform: translateX(-50%); display: grid; gap: 2px; padding: 6px 9px; border: 1px solid var(--line); border-radius: 6px; background: #0b1322f2; font-size: 11px; pointer-events: none; white-space: nowrap; }
.tip b { color: var(--muted); }
.note { margin: 0; padding: 8px 14px 10px; color: var(--muted); font-size: 11px; border-top: 1px solid var(--line); }
</style>
