<script setup lang="ts">
import { useCostSettingsStore } from '@/stores/costSettings'
import type { CostFactors, RateItem } from '@/lib/costCatalog'

const settings = useCostSettingsStore()
const money = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 })

function numberValue(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function setFactor(key: keyof CostFactors, event: Event) {
  settings.setFactor(key, numberValue(event))
}

function setRate(kind: 'labor' | 'machine' | 'material', item: RateItem, field: 'name' | 'unit' | 'price', event: Event) {
  const value = field === 'price' ? numberValue(event) : (event.target as HTMLInputElement).value
  settings.updateRate(kind, item.id, field, value)
}
</script>

<template>
  <div class="settings">
    <header>
      <div>
        <h2>成本基準設定</h2>
        <p>內建價格用於初步估算。請依專案地區、報價日期與採購條件調整，變更後所有自動估算立即重算。</p>
      </div>
      <button type="button" @click="settings.resetAll()">恢復內建基準</button>
    </header>

    <section class="factors">
      <h3>物價參數係數</h3>
      <label>人工係數<input type="number" min="0" step="0.01" :value="settings.factors.labor" @input="setFactor('labor', $event)" /><small>調整後 {{ (settings.factors.labor * 100).toFixed(0) }}%</small></label>
      <label>機具係數<input type="number" min="0" step="0.01" :value="settings.factors.machine" @input="setFactor('machine', $event)" /><small>調整後 {{ (settings.factors.machine * 100).toFixed(0) }}%</small></label>
      <label>材料係數<input type="number" min="0" step="0.01" :value="settings.factors.material" @input="setFactor('material', $event)" /><small>調整後 {{ (settings.factors.material * 100).toFixed(0) }}%</small></label>
    </section>

    <div class="catalogs">
      <section class="catalog">
        <h3>工種人工費用</h3>
        <div class="table-head"><span>工種</span><span>單位</span><span>基準日薪</span></div>
        <div v-for="item in settings.laborRates" :key="item.id" class="table-row">
          <input :value="item.name" @input="setRate('labor', item, 'name', $event)" />
          <input class="unit" :value="item.unit" @input="setRate('labor', item, 'unit', $event)" />
          <label><span>$</span><input type="number" min="0" step="100" :value="item.price" @input="setRate('labor', item, 'price', $event)" /></label>
        </div>
      </section>

      <section class="catalog">
        <h3>機具租金</h3>
        <div class="table-head"><span>機具</span><span>單位</span><span>基準日租</span></div>
        <div v-for="item in settings.machineRates" :key="item.id" class="table-row">
          <input :value="item.name" @input="setRate('machine', item, 'name', $event)" />
          <input class="unit" :value="item.unit" @input="setRate('machine', item, 'unit', $event)" />
          <label><span>$</span><input type="number" min="0" step="100" :value="item.price" @input="setRate('machine', item, 'price', $event)" /></label>
        </div>
      </section>

      <section class="catalog material">
        <h3>常用材料價格</h3>
        <div class="table-head"><span>材料</span><span>單位</span><span>基準單價</span></div>
        <div v-for="item in settings.materialRates" :key="item.id" class="table-row">
          <input :value="item.name" @input="setRate('material', item, 'name', $event)" />
          <input class="unit" :value="item.unit" @input="setRate('material', item, 'unit', $event)" />
          <label><span>$</span><input type="number" min="0" step="100" :value="item.price" @input="setRate('material', item, 'price', $event)" /></label>
        </div>
      </section>
    </div>
    <p class="footnote">目前內建 {{ settings.laborRates.length }} 種工種、{{ settings.machineRates.length }} 種機具、{{ settings.materialRates.length }} 種材料。畫面數值單位為新台幣：{{ money.format(1) }} 元起。</p>
  </div>
</template>

<style scoped>
.settings { height: 100%; overflow: auto; padding: 14px; color: var(--text); }
header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 12px; }
h2, h3, p { margin: 0; }
h2 { font-size: 16px; }
header p, .footnote { margin-top: 4px; color: var(--muted); font-size: 10px; }
header button { white-space: nowrap; }
.factors { display: grid; grid-template-columns: 150px repeat(3, minmax(150px, 1fr)); align-items: center; gap: 8px; padding: 10px; border: 1px solid #4cc2ff55; border-radius: 8px; background: #4cc2ff0b; }
.factors h3 { color: var(--accent); font-size: 12px; }
.factors label { display: grid; grid-template-columns: auto 68px; align-items: center; gap: 6px; color: var(--muted); font-size: 10px; }
.factors input { width: 68px; }
.factors small { grid-column: 2; color: var(--accent); font-size: 9px; }
.catalogs { display: grid; grid-template-columns: repeat(2, minmax(330px, 1fr)); gap: 10px; margin-top: 10px; }
.catalog { overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: #0a1321; }
.catalog.material { grid-column: 1 / -1; }
.catalog h3 { padding: 9px 10px; color: var(--accent); font-size: 12px; border-bottom: 1px solid var(--line); }
.table-head, .table-row { display: grid; grid-template-columns: minmax(160px, 1fr) 64px 118px; align-items: center; gap: 7px; padding: 5px 9px; }
.material .table-head, .material .table-row { grid-template-columns: minmax(220px, 1fr) 70px 140px; }
.table-head { color: var(--muted); font-size: 9px; background: #ffffff08; }
.table-row { border-top: 1px solid #ffffff09; }
.table-row input { width: 100%; min-width: 0; padding: 4px 6px; border: 1px solid var(--line); border-radius: 4px; background: #0d1929; color: var(--text); }
.table-row input:focus { border-color: var(--accent); outline: none; }
.table-row label { display: flex; align-items: center; gap: 4px; color: var(--muted); }
.table-row label input { text-align: right; color: #75d7ff; font-variant-numeric: tabular-nums; }
.footnote { padding: 10px 2px 2px; }
@media (max-width: 1050px) {
  .factors { grid-template-columns: 1fr; }
  .catalogs { grid-template-columns: 1fr; }
  .catalog.material { grid-column: auto; }
}
</style>
