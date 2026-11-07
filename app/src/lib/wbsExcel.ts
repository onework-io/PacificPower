import { strFromU8, unzipSync } from 'fflate'

export interface ImportedWbsRow {
  seq: number
  name: string
  durationDays?: number
  weightPct?: number
}

export interface WbsWorkbookImport {
  sheetName: string
  rows: ImportedWbsRow[]
}

const PREFERRED_SHEET = '影片對應修改資訊'

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
  return [...xml.matchAll(/<(?:[\w.-]+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?si>/g)].map(
    (match) => textNodes(match[1]),
  )
}

function parseSheet(xml: string, sharedStrings: string[]): string[][] {
  const result: string[][] = []
  for (const rowMatch of xml.matchAll(/<(?:[\w.-]+:)?row(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?row>/g)) {
    const row: string[] = []
    // 排除 <c .../> 空白儲存格，避免它誤吞到下一個有值儲存格的 </c>。
    for (const cellMatch of rowMatch[1].matchAll(
      /<(?:[\w.-]+:)?c\b(?![^>]*\/>)([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?c>/g,
    )) {
      const cellAttrs = cellMatch[1]
      const body = cellMatch[2]
      const reference = attr(cellAttrs, 'r')
      if (!reference) continue
      const type = attr(cellAttrs, 't')
      const raw = body.match(/<(?:[\w.-]+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?v>/)?.[1] ?? ''
      let value = decodeXml(raw)
      if (type === 's') value = sharedStrings[Number(value)] ?? ''
      else if (type === 'inlineStr') value = textNodes(body)
      row[columnIndex(reference)] = value.trim()
    }
    result.push(row)
  }
  return result
}

function normaliseHeader(value: string): string {
  return value.replace(/[\s　]/g, '').replace(/%/g, '％').toLowerCase()
}

function findHeader(rows: string[][]): { index: number; columns: Map<string, number> } | null {
  for (let index = 0; index < Math.min(rows.length, 30); index += 1) {
    const columns = new Map<string, number>()
    for (let column = 0; column < rows[index].length; column += 1) {
      const header = normaliseHeader(rows[index][column] ?? '')
      if (header) columns.set(header, column)
    }
    if (columns.has('項次') && (columns.has('施工步驟') || columns.has('畫面出現文字'))) {
      return { index, columns }
    }
  }
  return null
}

function optionalNumber(value: string | undefined, label: string, row: number): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value.replace(/,/g, '').replace(/％|%/g, ''))
  if (!Number.isFinite(parsed)) throw new Error(`第 ${row} 列「${label}」必須是數字`)
  return parsed
}

function rowsFromSheet(rows: string[][]): ImportedWbsRow[] {
  const header = findHeader(rows)
  if (!header) throw new Error('找不到「項次」與「施工步驟」欄位')

  const column = (name: string) => header.columns.get(normaliseHeader(name))
  const seqColumn = column('項次')!
  const constructionNameColumn = column('施工步驟')
  const screenNameColumn = column('畫面出現文字')
  const durationColumn = column('工作天')
  const weightColumn = column('進度權重％')
  const imported: ImportedWbsRow[] = []
  let maxSeq = 0

  for (let index = header.index + 1; index < rows.length; index += 1) {
    const source = rows[index]
    const name = (
      (constructionNameColumn === undefined ? '' : source[constructionNameColumn]) ||
      (screenNameColumn === undefined ? '' : source[screenNameColumn]) ||
      ''
    ).trim()
    const seqText = (source[seqColumn] ?? '').trim()
    if (!name && !seqText) continue
    // 範本表格下方可有版本／來源備註；沒有施工步驟且項次不是數字時略過。
    if (!name && !Number.isFinite(Number(seqText))) continue

    let seq: number
    if (seqText) {
      seq = Number(seqText)
      if (!Number.isInteger(seq) || seq <= 0) throw new Error(`第 ${index + 1} 列「項次」必須是正整數`)
      maxSeq = Math.max(maxSeq, seq)
    } else {
      seq = maxSeq + 1
      maxSeq = seq
    }
    if (!name) throw new Error(`第 ${index + 1} 列缺少施工步驟名稱`)

    const durationDays =
      durationColumn === undefined ? undefined : optionalNumber(source[durationColumn], '工作天', index + 1)
    const weightPct =
      weightColumn === undefined ? undefined : optionalNumber(source[weightColumn], '進度權重％', index + 1)
    if (durationDays !== undefined && durationDays <= 0) throw new Error(`第 ${index + 1} 列「工作天」必須大於 0`)
    if (weightPct !== undefined && weightPct < 0) throw new Error(`第 ${index + 1} 列「進度權重％」不可小於 0`)
    imported.push({ seq, name, durationDays, weightPct })
  }

  const duplicates = imported.filter((row, index) => imported.findIndex((other) => other.seq === row.seq) !== index)
  if (duplicates.length) throw new Error(`項次重複：${[...new Set(duplicates.map((row) => row.seq))].join('、')}`)

  const weights = imported.map((row) => row.weightPct).filter((value): value is number => value !== undefined)
  // Excel 百分比格式通常把 5% 儲存為 0.05；整欄合計不超過 1 時視為比例值。
  if (weights.length && weights.reduce((sum, value) => sum + value, 0) <= 1.000001) {
    for (const row of imported) if (row.weightPct !== undefined) row.weightPct *= 100
  }
  const weightTotal = imported.reduce((sum, row) => sum + (row.weightPct ?? 0), 0)
  if (weightTotal > 100.0001) throw new Error(`進度權重合計 ${weightTotal.toFixed(1)}%，不可超過 100%`)
  if (!imported.length) throw new Error('工作表中沒有可匯入的 WBS 工項')
  return imported
}

export function parseWbsXlsx(data: Uint8Array): WbsWorkbookImport {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data)
  } catch {
    throw new Error('無法開啟檔案，請確認它是有效的 .xlsx 活頁簿')
  }

  const read = (path: string) => (files[normalisePath(path)] ? strFromU8(files[normalisePath(path)]) : undefined)
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

  const preferred = candidates.find((sheet) => sheet.name === PREFERRED_SHEET)
  const selected = preferred && findHeader(preferred.rows) ? preferred : candidates.find((sheet) => findHeader(sheet.rows))
  if (!selected) throw new Error('找不到含 WBS 欄位的工作表')
  return { sheetName: selected.name, rows: rowsFromSheet(selected.rows) }
}
