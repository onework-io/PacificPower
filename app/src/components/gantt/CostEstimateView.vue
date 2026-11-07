<script setup lang="ts">
import { computed, ref } from 'vue'
import { useScheduleStore, type GanttRow } from '@/stores/schedule'
import { useCostStore } from '@/stores/cost'
import { calculateLaborHours, type WbsCostInput } from '@/lib/cost'
import { DEFAULT_LABOR_RATES } from '@/lib/costCatalog'
import { usePermission } from '@/lib/permissions'

const HOURS_PER_DAY = 8
const schedule = useScheduleStore()
const costs = useCostStore()
const can = usePermission()
const expandedId = ref<string | null>(null)
const number = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 })
const fmtHours = (value: number) => `${number.format(value)} 小時`

function plannedHours(row: GanttRow) {
  return calculateLaborHours(costs.get(row.step.id).laborPeople, row.duration, HOURS_PER_DAY)
}

const totalPlanned = computed(() => schedule.rows.reduce((sum, row) => sum + plannedHours(row), 0))
const totalPersonDays = computed(() => totalPlanned.value / HOURS_PER_DAY)
const actualSummary = computed(() => schedule.rows.reduce((sum, row) => {
  const actual = costs.getActual(row.step.id)
  if (actual !== null) {
    sum.total += actual
    sum.count += 1
    sum.planned += plannedHours(row)
  }
  return sum
}, { total: 0, count: 0, planned: 0 }))
const summaryVariance = computed(() => actualSummary.value.total - actualSummary.value.planned)

function phasePlanned(rows: GanttRow[]) {
  return rows.reduce((sum, row) => sum + plannedHours(row), 0)
}

function numberValue(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function setPeople(stepId: string, event: Event) {
  if (!can('labor.dispatch')) return
  costs.set(stepId, 'laborPeople', numberValue(event) as WbsCostInput['laborPeople'])
}

function setActual(stepId: string, event: Event) {
  if (!can('labor.report')) return
  const raw = (event.target as HTMLInputElement).value.trim()
  costs.setActual(stepId, raw === '' ? null : Math.max(0, Number(raw) || 0))
}

function variance(row: GanttRow) {
  const actual = costs.getActual(row.step.id)
  return actual === null ? null : actual - plannedHours(row)
}

function laborName(categoryId: string) {
  return DEFAULT_LABOR_RATES.find((item) => item.id === categoryId)?.name ?? '一般技工'
}
</script>

<template>
  <div class="labor">
    <header class="labor__summary">
      <div class="is-total"><span>計畫總人工時</span><b>{{ fmtHours(totalPlanned) }}</b></div>
      <div><span>計畫人日（8 小時／日）</span><b>{{ number.format(totalPersonDays) }} 人日</b></div>
      <div><span>實際已填 {{ actualSummary.count }}/{{ schedule.rows.length }} 項</span><b>{{ fmtHours(actualSummary.total) }}</b></div>
      <div v-if="actualSummary.count" :class="summaryVariance > 0 ? 'over' : summaryVariance < 0 ? 'under' : ''">
        <span>已填工項人工時差</span>
        <b>{{ summaryVariance > 0 ? '超出 ' : summaryVariance < 0 ? '低於 ' : '' }}{{ fmtHours(Math.abs(summaryVariance)) }}</b>
      </div>
      <button v-if="can('labor.report') && actualSummary.count" type="button" @click="costs.clearActuals()">清除實際人工時</button>
    </header>

    <p class="labor__formula">計畫人工時＝配置人數 × WBS 工作天 × 每日 8 小時。展開工項可調整人數並填入現場實際人工時。</p>

    <div class="labor__head row-grid">
      <span>WBS</span><span>工作項目</span><span>天數</span><span>人數</span>
      <span>計畫人工時</span><span>實際人工時</span><span>差異</span>
    </div>

    <div class="labor__body">
      <template v-for="group in schedule.wbsGroups" :key="group.phase">
        <div class="phase row-grid">
          <b>{{ group.wbs }}</b><strong>{{ group.phase }}</strong><span>{{ group.work }}</span><span>—</span>
          <b>{{ fmtHours(phasePlanned(group.items)) }}</b><span>—</span><span>—</span>
        </div>

        <template v-for="row in group.items" :key="row.step.id">
          <button
            type="button"
            class="item row-grid"
            :class="{ 'is-open': expandedId === row.step.id }"
            :aria-expanded="expandedId === row.step.id"
            @click="expandedId = expandedId === row.step.id ? null : row.step.id"
          >
            <span>{{ row.wbs }}</span><strong>{{ row.step.name }}</strong><span>{{ row.duration }}</span>
            <span>{{ costs.get(row.step.id).laborPeople }}</span><b>{{ fmtHours(plannedHours(row)) }}</b>
            <span>{{ costs.getActual(row.step.id) === null ? '尚未填寫' : fmtHours(costs.getActual(row.step.id)!) }}</span>
            <span v-if="variance(row) !== null" :class="{ over: variance(row)! > 0, under: variance(row)! < 0 }">
              {{ variance(row)! > 0 ? '+' : '' }}{{ number.format(variance(row)!) }} 小時 <i>▾</i>
            </span>
            <span v-else>— <i>▾</i></span>
          </button>

          <div v-if="expandedId === row.step.id" class="editor">
            <section>
              <h3>計畫人工時</h3>
              <label>工種<select :disabled="!can('labor.dispatch')" :value="costs.get(row.step.id).laborCategoryId" @change="can('labor.dispatch') && costs.selectLabor(row.step.id, ($event.target as HTMLSelectElement).value)"><option v-for="item in DEFAULT_LABOR_RATES" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
              <label>配置人數<input type="number" min="0" step="1" :disabled="!can('labor.dispatch')" :value="costs.get(row.step.id).laborPeople" @input="setPeople(row.step.id, $event)" /></label>
              <p>{{ costs.get(row.step.id).laborPeople }} 人 × {{ row.duration }} 天 × {{ HOURS_PER_DAY }} 小時</p>
              <output>{{ fmtHours(plannedHours(row)) }}</output>
            </section>
            <section>
              <h3>實際人工時</h3>
              <label>截至目前已投入<input type="number" min="0" step="0.5" placeholder="尚未填寫" :disabled="!can('labor.report')" :value="costs.getActual(row.step.id) ?? ''" @input="setActual(row.step.id, $event)" /></label>
              <p>工種：{{ laborName(costs.get(row.step.id).laborCategoryId) }}</p>
              <output v-if="variance(row) !== null" :class="{ over: variance(row)! > 0, under: variance(row)! < 0 }">
                {{ variance(row)! > 0 ? '超出計畫' : variance(row)! < 0 ? '低於計畫' : '符合計畫' }} {{ fmtHours(Math.abs(variance(row)!)) }}
              </output>
              <small v-else>留空表示尚未回報，不計入實際人工時曲線。</small>
            </section>
            <button v-if="can('labor.dispatch') || can('labor.report')" type="button" class="reset" @click="can('labor.dispatch') && costs.reset(row.step.id); can('labor.report') && costs.setActual(row.step.id, null)">恢復可編輯欄位</button>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.labor { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.labor__summary { display: flex; align-items: stretch; gap: 8px; padding: 9px 12px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.labor__summary > div { min-width: 150px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 7px; background: #1e2326; }
.labor__summary span { display: block; color: var(--muted); font-size: 10px; }
.labor__summary b { display: block; margin-top: 2px; font-size: 14px; font-variant-numeric: tabular-nums; }
.labor__summary .is-total { border-color: #ffad7a77; background: #ffad7a10; }
.labor__summary .is-total b { color: var(--accent); }
.labor__summary button { margin-left: auto; white-space: nowrap; }
.over { color: var(--danger) !important; }
.under { color: #22c55e !important; }
.labor__formula { margin: 0; padding: 7px 12px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 11px; }
.row-grid { display: grid; grid-template-columns: 58px minmax(190px, 1fr) 55px 55px repeat(3, minmax(104px, 120px)); align-items: center; gap: 8px; }
.labor__head { padding: 7px 12px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 10px; }
.labor__head span:nth-child(n+3) { text-align: right; }
.labor__body { min-height: 0; overflow: auto; }
.phase { position: sticky; top: 0; z-index: 2; padding: 8px 12px; border-bottom: 1px solid #414d54; background: #2b3337; font-size: 11px; }
.phase span:nth-child(n+3), .phase b:nth-child(n+3) { text-align: right; }
.item { width: 100%; padding: 8px 12px; border: 0; border-bottom: 1px solid #ffffff0b; border-radius: 0; background: transparent; color: var(--text); text-align: left; }
.item:hover, .item.is-open { background: #ffad7a0c; }
.item span:nth-child(n+3), .item b { text-align: right; font-variant-numeric: tabular-nums; }
.item span:first-child { color: var(--accent); font-size: 10px; }
.item i { margin-left: 4px; color: var(--muted); font-style: normal; }
.editor { position: relative; display: grid; grid-template-columns: repeat(2, minmax(240px, 1fr)); gap: 10px; padding: 12px 48px 12px 78px; border-bottom: 1px solid #516069; background: #1e2326; }
.editor section { display: grid; grid-template-columns: minmax(135px, 1fr) minmax(100px, 1fr); gap: 8px 12px; padding: 12px; border: 1px solid var(--line); border-radius: 7px; background: #252c30; }
.editor h3 { grid-column: 1 / -1; margin: 0 0 2px; color: var(--accent); font-size: 12px; }
.editor label { display: grid; gap: 4px; color: var(--muted); font-size: 10px; }
.editor input, .editor select { width: 100%; box-sizing: border-box; }
.editor p, .editor small { margin: 0; align-self: end; color: var(--muted); font-size: 10px; }
.editor output { align-self: end; text-align: right; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
.reset { position: absolute; right: 12px; bottom: 12px; font-size: 10px; }
@media (max-width: 900px) {
  .row-grid { grid-template-columns: 48px minmax(170px, 1fr) 48px 48px repeat(3, 96px); }
  .editor { grid-template-columns: 1fr; padding-left: 58px; }
}
</style>
