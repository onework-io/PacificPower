import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { WbsCostInput } from '@/lib/cost'
import { defaultCostForStep } from '@/lib/costCatalog'
import { useCostSettingsStore } from './costSettings'

const STORAGE_KEY = 'generator-wbs-labor-hours-v1'

interface PersistedCost {
  inputs: Record<string, Partial<WbsCostInput>>
  actuals: Record<string, number>
}

function storageKey(projectId: string | null): string {
  return projectId ? `${STORAGE_KEY}:${projectId}` : STORAGE_KEY
}

function load(projectId: string | null = null): PersistedCost {
  try {
    const current = localStorage.getItem(storageKey(projectId))
    return current ? JSON.parse(current) as PersistedCost : { inputs: {}, actuals: {} }
  } catch {
    return { inputs: {}, actuals: {} }
  }
}

export const useCostStore = defineStore('cost', () => {
  const settings = useCostSettingsStore()
  const saved = load(null)
  const activeProjectId = ref<string | null>(null)
  const inputs = ref<Record<string, Partial<WbsCostInput>>>(saved.inputs)
  const actuals = ref<Record<string, number>>(saved.actuals)

  function get(stepId: string): WbsCostInput {
    const defaults = defaultCostForStep(stepId, settings)
    const override = inputs.value[stepId] ?? {}
    const result = { ...defaults, ...override }
    if (override.laborCategoryId !== undefined && override.laborDailyRate === undefined) {
      result.laborDailyRate = settings.laborRates.find((rate) => rate.id === result.laborCategoryId)?.price ?? 0
    }
    if (override.machineCategoryId !== undefined && override.machineDailyRate === undefined) {
      result.machineDailyRate = settings.machineRates.find((rate) => rate.id === result.machineCategoryId)?.price ?? 0
    }
    if (override.materialCategoryId !== undefined && override.materialUnitRate === undefined) {
      const material = settings.materialRates.find((rate) => rate.id === result.materialCategoryId)
      result.materialUnitRate = material?.price ?? 0
      if (override.materialUnit === undefined) result.materialUnit = material?.unit ?? '式'
    }
    return result
  }

  function set<K extends keyof WbsCostInput>(stepId: string, field: K, value: WbsCostInput[K]) {
    inputs.value = {
      ...inputs.value,
      [stepId]: { ...inputs.value[stepId], [field]: value },
    }
  }

  function reset(stepId: string) {
    const next = { ...inputs.value }
    delete next[stepId]
    inputs.value = next
  }

  function resetAll() {
    inputs.value = {}
  }

  function getActual(stepId: string): number | null {
    const value = actuals.value[stepId]
    return Number.isFinite(value) ? value : null
  }

  function setActual(stepId: string, value: number | null) {
    const next = { ...actuals.value }
    if (value === null || !Number.isFinite(value)) delete next[stepId]
    else next[stepId] = Math.max(0, value)
    actuals.value = next
  }

  function clearActuals() {
    actuals.value = {}
  }

  function importMany(rows: { stepId: string; input: WbsCostInput }[]) {
    const next = { ...inputs.value }
    for (const row of rows) next[row.stepId] = { ...row.input }
    inputs.value = next
  }

  function selectLabor(stepId: string, categoryId: string) {
    const next = { ...inputs.value[stepId], laborCategoryId: categoryId }
    delete next.laborDailyRate
    inputs.value = { ...inputs.value, [stepId]: next }
  }

  function selectMachine(stepId: string, categoryId: string) {
    const next = { ...inputs.value[stepId], machineCategoryId: categoryId }
    delete next.machineDailyRate
    inputs.value = { ...inputs.value, [stepId]: next }
  }

  function selectMaterial(stepId: string, categoryId: string) {
    const next = { ...inputs.value[stepId], materialCategoryId: categoryId }
    delete next.materialUnitRate
    delete next.materialUnit
    inputs.value = { ...inputs.value, [stepId]: next }
  }

  function save(projectId: string | null = activeProjectId.value) {
    try {
      localStorage.setItem(
        storageKey(projectId),
        JSON.stringify({ inputs: inputs.value, actuals: actuals.value } satisfies PersistedCost),
      )
    } catch {
      // 儲存空間不可用時仍可在本次工作階段計算。
    }
  }

  /** 人工時與實際成本依專案隔離，避免切換專案後沿用上一案資料。 */
  function loadProject(projectId: string) {
    save()
    activeProjectId.value = projectId
    const projectSaved = load(projectId)
    inputs.value = projectSaved.inputs
    actuals.value = projectSaved.actuals
  }

  watch([inputs, actuals], () => {
    save()
  }, { deep: true })

  return {
    inputs,
    actuals,
    activeProjectId,
    get,
    set,
    reset,
    resetAll,
    getActual,
    setActual,
    clearActuals,
    importMany,
    selectLabor,
    selectMachine,
    selectMaterial,
    loadProject,
  }
})
