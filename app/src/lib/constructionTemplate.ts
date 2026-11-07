import { strToU8, zipSync } from 'fflate'
import { INSTALL_STEPS } from '@/data/installSteps'

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** Generate the import template from the same WBS source as the viewer. */
export function buildConstructionTemplate(): Uint8Array {
  const rows: Array<Array<string | number>> = [
    ['項次', '施工步驟', '工作天', '進度權重％'],
    ...INSTALL_STEPS.map(step => [step.seq, step.name, '', '']),
  ]
  const sheet = rows.map((row, i) => `<row r="${i+1}">${row.map((v, j) => `<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t>${escapeXml(String(v))}</t></is></c>`).join('')}</row>`).join('')
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="資料中心WBS" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="58" customWidth="1"/><col min="3" max="4" width="18" customWidth="1"/></cols><sheetData>${sheet}</sheetData></worksheet>`),
  })
}
export function downloadConstructionTemplate(): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(buildConstructionTemplate())], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a'); a.href = url; a.download = 'PacificPower_資料中心_WBS範本.xlsx'; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
