import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCostXlsx } from './costExcel'

describe('parseCostXlsx', () => {
  it('reads a legacy cost workbook fixture', () => {
    const path = new URL('./fixtures/legacy-cost-template.xlsx', import.meta.url)
    const workbook = parseCostXlsx(new Uint8Array(readFileSync(path)))
    expect(workbook.sheetName).toBe('成本估算')
    expect(workbook.rows).toHaveLength(34)
    expect(workbook.rows[0]).toMatchObject({
      seq: 1,
      wbs: '1.1',
      name: '發電機組中心線放樣',
      laborPeople: 2,
      laborDailyRate: 3600,
      machineDailyRate: 1500,
      materialQty: 1,
      materialUnit: '式',
      materialUnitRate: 2500,
    })
    expect(workbook.rows[33]).toMatchObject({ seq: 34, wbs: '8.3' })
  })
})
