import { defineStore } from 'pinia'
import { reactive, ref, watch } from 'vue'
import {
  DEFAULT_FACTORS,
  DEFAULT_LABOR_RATES,
  DEFAULT_MACHINE_RATES,
  DEFAULT_MATERIAL_RATES,
  cloneRates,
  type CostFactors,
  type RateItem,
} from '@/lib/costCatalog'

const STORAGE_KEY = 'pacificpower-cost-settings-v1'

interface SavedSettings {
  factors: CostFactors
  laborRates: RateItem[]
  machineRates: RateItem[]
  materialRates: RateItem[]
}

function load(): Partial<SavedSettings> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<SavedSettings>
  } catch {
    return {}
  }
}

const positive = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0

export const useCostSettingsStore = defineStore('costSettings', () => {
  const saved = load()
  const factors = reactive<CostFactors>({ ...DEFAULT_FACTORS, ...saved.factors })
  const laborRates = ref<RateItem[]>(saved.laborRates?.length ? saved.laborRates : cloneRates(DEFAULT_LABOR_RATES))
  const machineRates = ref<RateItem[]>(saved.machineRates?.length ? saved.machineRates : cloneRates(DEFAULT_MACHINE_RATES))
  const materialRates = ref<RateItem[]>(saved.materialRates?.length ? saved.materialRates : cloneRates(DEFAULT_MATERIAL_RATES))

  function setFactor(key: keyof CostFactors, value: number) {
    factors[key] = positive(value)
  }

  function updateRate(kind: 'labor' | 'machine' | 'material', id: string, field: 'name' | 'unit' | 'price', value: string | number) {
    const target = kind === 'labor' ? laborRates : kind === 'machine' ? machineRates : materialRates
    const item = target.value.find((candidate) => candidate.id === id)
    if (!item) return
    if (field === 'price') item.price = positive(Number(value))
    else item[field] = String(value).trim()
  }

  function resetAll() {
    Object.assign(factors, DEFAULT_FACTORS)
    laborRates.value = cloneRates(DEFAULT_LABOR_RATES)
    machineRates.value = cloneRates(DEFAULT_MACHINE_RATES)
    materialRates.value = cloneRates(DEFAULT_MATERIAL_RATES)
  }

  watch([() => ({ ...factors }), laborRates, machineRates, materialRates], () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        factors: { ...factors },
        laborRates: laborRates.value,
        machineRates: machineRates.value,
        materialRates: materialRates.value,
      }))
    } catch {
      // 儲存空間不可用時仍可在本次工作階段使用設定。
    }
  }, { deep: true })

  return { factors, laborRates, machineRates, materialRates, setFactor, updateRate, resetAll }
})
