import { strFromU8, unzipSync } from 'fflate'
export interface ImportedCostRow {
  seq?: number
  wbs?: string
  name?: string
  laborPeople: number
  laborDailyRate: number
  machineUnits: number
  machineDailyRate: number
  materialQty: number
  materialUnitRate: number
  materialUnit: string
}

export interface CostWorkbookImport {
  sheetName: string
  rows: ImportedCostRow[]
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function attr(source: string, name: string): string | null {
  const match = source.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))
  return match ? decodeXml(match[1]) : null
}

function textNodes(xml: string): string {
  return [...xml.matchAll(/<(?:[\w.-]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?t>/g)]
    .map((match) => decodeXml(match[1]))
    .join('')
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? ''
  let result = 0
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64
  return result - 1
}

function normalisePath(path: string): string {
  const pieces: string[] = []
  for (const piece of path.replace(/^\//, '').split('/')) {
    if (!piece || piece === '.') continue
    if (piece === '..') pieces.pop()
    else pieces.push(piece)
  }
  return pieces.join('/')
}

function parseSharedStrings(xml?: string): string[] {
  if (!xml) return []
  return [...xml.matchAll(/<(?:[\w.-]+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?si>/g)]
    .map((match) => textNodes(match[1]))
}

function parseSheet(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = []
  for (const rowMatch of xml.matchAll(/<(?:[\w.-]+:)?row(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?row>/g)) {
    const row: string[] = []
    for (const cellMatch of rowMatch[1].matchAll(/<(?:[\w.-]+:)?c\b(?![^>]*\/>)([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?c>/g)) {
      const reference = attr(cellMatch[1], 'r')
      if (!reference) continue
      const type = attr(cellMatch[1], 't')
      const body = cellMatch[2]
      const raw = body.match(/<(?:[\w.-]+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?v>/)?.[1] ?? ''
      let value = decodeXml(raw)
      if (type === 's') value = sharedStrings[Number(value)] ?? ''
      else if (type === 'inlineStr') value = textNodes(body)
      row[columnIndex(reference)] = value.trim()
    }
    rows.push(row)
  }
  return rows
}

function normaliseHeader(value: string): string {
  return value.replace(/[\s　()（）／/]/g, '').toLowerCase()
}

const HEADER_ALIASES = {
  seq: ['項次', '序號'],
  wbs: ['wbs', 'wbs編碼', 'wbs代號'],
  name: ['工作項目', '工項', '施工步驟'],
  laborPeople: ['人工人數', '人數'],
  laborDailyRate: ['每人日薪', '人工日薪', '日薪', '基準日薪'],
  machineUnits: ['機具台數', '台數'],
  machineDailyRate: ['每台日租', '機具日租', '日租', '基準日租'],
  materialQty: ['物料數量', '材料數量', '數量'],
  materialUnit: ['物料單位', '材料單位', '單位'],
  materialUnitRate: ['物料單價', '材料單價', '單價', '基準單價'],
} as const

type ColumnKey = keyof typeof HEADER_ALIASES

function findHeader(rows: string[][]): { index: number; columns: Partial<Record<ColumnKey, number>> } | null {
  for (let index = 0; index < Math.min(rows.length, 30); index += 1) {
    const normalised = rows[index].map(normaliseHeader)
    const columns: Partial<Record<ColumnKey, number>> = {}
    for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [ColumnKey, readonly string[]][]) {
      const column = normalised.findIndex((header) => aliases.map(normaliseHeader).includes(header))
      if (column >= 0) columns[key] = column
    }
    if ((columns.wbs !== undefined || columns.seq !== undefined) && columns.name !== undefined &&
      columns.laborPeople !== undefined && columns.materialUnitRate !== undefined) {
      return { index, columns }
    }
  }
  return null
}

function cell(row: string[], column: number | undefined): string {
  return column === undefined ? '' : (row[column] ?? '').trim()
}

function nonNegativeNumber(value: string, label: string, rowNumber: number): number {
  if (!value) return 0
  const parsed = Number(value.replace(/,/g, ''))
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`第 ${rowNumber} 列「${label}」必須是大於或等於 0 的數字`)
  return parsed
}

function rowsFromSheet(rows: string[][]): ImportedCostRow[] {
  const header = findHeader(rows)
  if (!header) throw new Error('找不到成本欄位；請使用「成本估算匯入範本」填寫')
  const imported: ImportedCostRow[] = []

  for (let index = header.index + 1; index < rows.length; index += 1) {
    const source = rows[index]
    const wbs = cell(source, header.columns.wbs)
    const seqText = cell(source, header.columns.seq)
    const name = cell(source, header.columns.name)
    if (!wbs && !seqText && !name) continue
    if (!name && !wbs && !Number.isFinite(Number(seqText))) continue

    let seq: number | undefined
    if (seqText) {
      seq = Number(seqText)
      if (!Number.isInteger(seq) || seq <= 0) throw new Error(`第 ${index + 1} 列「項次」必須是正整數`)
    }

    imported.push({
      seq,
      wbs: wbs || undefined,
      name: name || undefined,
      laborPeople: nonNegativeNumber(cell(source, header.columns.laborPeople), '人工人數', index + 1),
      laborDailyRate: nonNegativeNumber(cell(source, header.columns.laborDailyRate), '每人日薪', index + 1),
      machineUnits: nonNegativeNumber(cell(source, header.columns.machineUnits), '機具台數', index + 1),
      machineDailyRate: nonNegativeNumber(cell(source, header.columns.machineDailyRate), '每台日租', index + 1),
      materialQty: nonNegativeNumber(cell(source, header.columns.materialQty), '物料數量', index + 1),
      materialUnit: cell(source, header.columns.materialUnit).slice(0, 8),
      materialUnitRate: nonNegativeNumber(cell(source, header.columns.materialUnitRate), '物料單價', index + 1),
    })
  }

  if (!imported.length) throw new Error('工作表中沒有可匯入的成本資料')
  const wbsValues = imported.map((row) => row.wbs).filter((value): value is string => Boolean(value))
  const duplicate = wbsValues.find((value, index) => wbsValues.indexOf(value) !== index)
  if (duplicate) throw new Error(`WBS 編碼重複：${duplicate}`)
  return imported
}

export function parseCostXlsx(data: Uint8Array): CostWorkbookImport {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data)
  } catch {
    throw new Error('無法開啟檔案，請確認它是有效的 .xlsx 活頁簿')
  }
  const read = (path: string) => files[normalisePath(path)] ? strFromU8(files[normalisePath(path)]) : undefined
  const workbookXml = read('xl/workbook.xml')
  const relsXml = read('xl/_rels/workbook.xml.rels')
  if (!workbookXml || !relsXml) throw new Error('檔案缺少 Excel 活頁簿結構')

  const relationships = new Map<string, string>()
  for (const match of relsXml.matchAll(/<(?:[\w.-]+:)?Relationship([^>]*)\/?\s*>/g)) {
    const id = attr(match[1], 'Id')
    const target = attr(match[1], 'Target')
    if (id && target) relationships.set(id, normalisePath(target.startsWith('/') ? target : `xl/${target}`))
  }
  const sharedStrings = parseSharedStrings(read('xl/sharedStrings.xml'))
  const candidates: { name: string; rows: string[][] }[] = []
  for (const match of workbookXml.matchAll(/<(?:[\w.-]+:)?sheet\b([^>]*)\/?\s*>/g)) {
    const name = attr(match[1], 'name')
    const relationshipId = attr(match[1], 'r:id')
    const sheetPath = relationshipId ? relationships.get(relationshipId) : undefined
    const sheetXml = sheetPath ? read(sheetPath) : undefined
    if (name && sheetXml) candidates.push({ name, rows: parseSheet(sheetXml, sharedStrings) })
  }
  const preferred = candidates.find((sheet) => sheet.name === '成本估算')
  const selected = preferred && findHeader(preferred.rows) ? preferred : candidates.find((sheet) => findHeader(sheet.rows))
  if (!selected) throw new Error('找不到含成本欄位的工作表')
  return { sheetName: selected.name, rows: rowsFromSheet(selected.rows) }
}
