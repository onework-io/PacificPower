import { describe, expect, it } from 'vitest'
import { calculateLaborHours, calculateWbsCost, EMPTY_WBS_COST } from './cost'

describe('WBS 人工時計算', () => {
  it('依人數、工作天與每日工時計算', () => {
    expect(calculateLaborHours(3, 2)).toBe(48)
    expect(calculateLaborHours(2, 1.5, 7)).toBe(21)
  })

  it('空白與負數不會產生負人工時', () => {
    expect(calculateLaborHours(-2, 3)).toBe(0)
    expect(calculateLaborHours(2, Number.NaN)).toBe(0)
  })
})

describe('WBS 成本計算', () => {
  it('分別計算人、機、料並加總', () => {
    expect(calculateWbsCost({
      laborCategoryId: 'survey',
      laborPeople: 3,
      laborDailyRate: 3200,
      machineCategoryId: 'crane',
      machineUnits: 1,
      machineDailyRate: 8000,
      materialCategoryId: 'material',
      materialQty: 12,
      materialUnitRate: 450,
      materialUnit: '組',
    }, 2)).toEqual({ labor: 19200, machine: 16000, material: 5400, total: 40600 })
  })

  it('空白與負數不會產生負成本', () => {
    expect(calculateWbsCost({ ...EMPTY_WBS_COST, laborPeople: -2 }, 3).total).toBe(0)
  })

  it('套用物價參數係數', () => {
    const input = { ...EMPTY_WBS_COST, laborPeople: 2, laborDailyRate: 3000, materialQty: 10, materialUnitRate: 100 }
    const result = calculateWbsCost(input, 2, { labor: 1.1, machine: 1, material: 1.2 })
    expect(result.labor).toBeCloseTo(13200)
    expect(result.machine).toBe(0)
    expect(result.material).toBeCloseTo(1200)
    expect(result.total).toBeCloseTo(14400)
  })
})
