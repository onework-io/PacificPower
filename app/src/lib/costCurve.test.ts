import { describe, expect, it } from 'vitest'
import { actualCostCurve, amountAt, plannedCostCurve, type CostCurveRow } from './costCurve'

const rows: CostCurveRow[] = [
  { start: 0, finish: 2, estimate: 200, actual: 240, progress: 100 },
  { start: 2, finish: 6, estimate: 800, actual: 300, progress: 50 },
]

describe('成本 S 曲線', () => {
  it('預估成本依 WBS 排程累計', () => {
    const curve = plannedCostCurve(rows, 6)
    expect(amountAt(curve, 2)).toBeCloseTo(200)
    expect(amountAt(curve, 4)).toBeCloseTo(600)
    expect(amountAt(curve, 6)).toBeCloseTo(1000)
  })

  it('實際成本只計算已提供的 WBS', () => {
    const curve = actualCostCurve([{ ...rows[0] }, { ...rows[1], actual: null }], 6, 4)
    expect(amountAt(curve, 6)).toBeCloseTo(240)
  })

  it('實際成本依完成度分配到已執行區間', () => {
    const curve = actualCostCurve(rows, 6, 4)
    expect(amountAt(curve, 2)).toBeCloseTo(240)
    expect(amountAt(curve, 3)).toBeCloseTo(390)
    expect(amountAt(curve, 4)).toBeCloseTo(540)
  })

  it('沒有實際成本時不產生誤導曲線', () => {
    expect(actualCostCurve(rows.map((row) => ({ ...row, actual: null })), 6, 4)).toEqual([])
  })
})
