import { describe, expect, it } from 'vitest'
import { INSTALL_STEPS } from '@/data/installSteps'
import { calculateWbsCost } from './cost'
import {
  DEFAULT_LABOR_RATES,
  DEFAULT_MACHINE_RATES,
  DEFAULT_MATERIAL_RATES,
  defaultCostForStep,
} from './costCatalog'

describe('成本基準目錄', () => {
  const catalogs = {
    laborRates: DEFAULT_LABOR_RATES,
    machineRates: DEFAULT_MACHINE_RATES,
    materialRates: DEFAULT_MATERIAL_RATES,
  }

  it('資料中心工項不沿用舊發電機估價', () => {
    for (const step of INSTALL_STEPS) {
      const input = defaultCostForStep(step.id, catalogs)
      expect(input.laborCategoryId, step.id).toBe('')
      expect(input.materialCategoryId, step.id).toBe('')
      expect(calculateWbsCost(input, step.durationDays).total, step.id).toBe(0)
    }
  })

  it('基準價格更新會反映在預設資料', () => {
    const laborRates = DEFAULT_LABOR_RATES.map((item) => item.id === 'survey' ? { ...item, price: 5000 } : item)
    expect(defaultCostForStep('s01', { ...catalogs, laborRates }).laborDailyRate).toBe(5000)
  })
})
