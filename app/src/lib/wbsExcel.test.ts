import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { buildConstructionTemplate } from './constructionTemplate'
import { INSTALL_STEPS } from '@/data/installSteps'
import { parseWbsXlsx } from './wbsExcel'

const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="影片對應修改資訊" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`

function cell(ref: string, value: string) {
  return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`
}

function xlsx(sheetRows: string): Uint8Array {
  const sheet = `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`
  return zipSync({
    'xl/workbook.xml': strToU8(workbookXml),
    'xl/_rels/workbook.xml.rels': strToU8(relsXml),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  })
}

describe('WBS Excel 匯入', () => {
  it('資料中心範本可往返匯入且不捏造工期與權重', () => {
    const result = parseWbsXlsx(buildConstructionTemplate())
    expect(result.sheetName).toBe('資料中心WBS')
    expect(result.rows.map(row=>row.name)).toEqual(INSTALL_STEPS.map(s=>s.name))
    expect(result.rows.every(row=>row.durationDays===undefined && row.weightPct===undefined)).toBe(true)
  })

  it('讀取目前範本欄位，並替未編號的結尾工項接續編號', () => {
    const data = xlsx([
      `<row r="1">${cell('A1', '項次')}${cell('F1', '施工步驟')}${cell('G1', '進度權重％')}${cell('H1', '工作天')}</row>`,
      `<row r="2">${cell('A2', '1')}${cell('F2', '中心線放樣')}${cell('G2', '0.25')}${cell('H2', '1')}</row>`,
      `<row r="3">${cell('A3', '2')}${cell('F3', '基座製裝')}${cell('G3', '0.75')}${cell('H3', '3.5')}</row>`,
      `<row r="4">${cell('F4', '完工檢查')}${cell('H4', '1')}</row>`,
    ].join(''))

    expect(parseWbsXlsx(data)).toEqual({
      sheetName: '影片對應修改資訊',
      rows: [
        { seq: 1, name: '中心線放樣', durationDays: 1, weightPct: 25 },
        { seq: 2, name: '基座製裝', durationDays: 3.5, weightPct: 75 },
        { seq: 3, name: '完工檢查', durationDays: 1, weightPct: undefined },
      ],
    })
  })

  it('拒絕重複項次', () => {
    const data = xlsx([
      `<row>${cell('A1', '項次')}${cell('B1', '施工步驟')}</row>`,
      `<row>${cell('A2', '1')}${cell('B2', 'A')}</row>`,
      `<row>${cell('A3', '1')}${cell('B3', 'B')}</row>`,
    ].join(''))
    expect(() => parseWbsXlsx(data)).toThrow('項次重複：1')
  })

  it('拒絕總和超過 100% 的權重', () => {
    const data = xlsx([
      `<row>${cell('A1', '項次')}${cell('B1', '施工步驟')}${cell('C1', '進度權重%')}</row>`,
      `<row>${cell('A2', '1')}${cell('B2', 'A')}${cell('C2', '60')}</row>`,
      `<row>${cell('A3', '2')}${cell('B3', 'B')}${cell('C3', '50')}</row>`,
    ].join(''))
    expect(() => parseWbsXlsx(data)).toThrow('不可超過 100%')
  })
})
