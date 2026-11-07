import type { GanttRow } from '@/stores/schedule'

export interface SiteAssistantContext {
  dataDay: number
  projectDays: number
  overallProgress: number
  rows: GanttRow[]
}

export interface SiteAssistantAnswer {
  text: string
  focusStepId: string | null
  /** 單張照片推估的全案進度；只供現場快速研判，不取代正式 WBS。 */
  estimatedOverallProgress?: number
}

/**
 * 專案展示用的三張現場照片判讀結果。這是明確標示為推估的範例，避免在尚未
 * 連接影像模型時，把檔名數量誤包裝成真正的視覺辨識。
 */
export function buildDemoPhotoAnswer(_photoName: string): SiteAssistantAnswer {
  return { text: '此資料中心原型尚未接入現場影像辨識；請由工程師依查驗紀錄確認進度。照片不會自動變更正式 WBS。', focusStepId: null }
}

const COMMON = /安裝|製裝|目前|進度|現場|施工|照片|請問|狀況/g

function bigrams(value: string): Set<string> {
  const compact = value.replace(COMMON, '').replace(/[\s＋+()（）/_-]/g, '')
  const result = new Set<string>()
  for (let i = 0; i < compact.length - 1; i += 1) result.add(compact.slice(i, i + 2))
  return result
}

/** 從自然語句找最可能指向的 WBS 工項。 */
export function findRelevantRow(question: string, rows: GanttRow[]): GanttRow | null {
  const q = question.trim()
  if (!q) return null
  let best: { row: GanttRow; score: number } | null = null
  const qPairs = bigrams(q)
  for (const row of rows) {
    const exact = q.includes(row.step.name) || row.step.name.includes(q)
    const score = exact ? 100 : [...bigrams(row.step.name)].filter((p) => qPairs.has(p)).length
    if (score > (best?.score ?? 1)) best = { row, score }
  }
  return best?.row ?? null
}

export function activeRowsAt(rows: GanttRow[], day: number): GanttRow[] {
  return rows.filter((row) => row.task.start < day + 1 && row.task.finish > day)
}

export function buildLocalSiteAnswer(
  question: string,
  context: SiteAssistantContext,
  photoCount = 0,
): SiteAssistantAnswer {
  const { rows, overallProgress, projectDays } = context
  const day = Math.min(Math.max(0, context.dataDay), Math.ceil(projectDays))
  const active = activeRowsAt(rows, day)
  const photoNote = photoCount
    ? `已收到 ${photoCount} 張現場照片。此預覽尚未連接影像判讀端點，我先依 WBS 與進度資料回答；正式連線後會把照片一併交給視覺模型判讀。\n\n`
    : ''
  const relevant = findRelevantRow(question, rows)
  const normalized = question.replace(/\s/g, '')

  if (/延誤|落後|逾期|異常/.test(normalized)) {
    const overdue = rows.filter((row) => row.task.finish <= day && row.progress < 100)
    const focus = overdue.find((row) => row.step.partId) ?? overdue[0] ?? active[0] ?? null
    return {
      text: `${photoNote}截至第 ${day + 1} 天，共有 ${overdue.length} 項已到計畫完成日、但 WBS 完成度尚未達 100%。${overdue.length ? `優先確認：${overdue.slice(0, 3).map((row) => row.step.name).join('、')}。` : '目前沒有逾期未完成工項。'}`,
      focusStepId: focus?.step.id ?? null,
    }
  }

  if (/下一|接下來|後續|未來/.test(normalized)) {
    const next = rows.find((row) => row.task.start > day) ?? null
    return {
      text: `${photoNote}${next ? `下一個計畫工項是「${next.step.name}」，預計第 ${Math.floor(next.task.start) + 1} 天開始、工期 ${next.duration} 天。` : '目前已到排程末端，沒有下一個未開始工項。'}`,
      focusStepId: next?.step.id ?? null,
    }
  }

  if (relevant && !/整體|總進度/.test(normalized)) {
    return {
      text: `${photoNote}「${relevant.step.name}」目前回報完成度 ${relevant.progress}%，計畫第 ${Math.floor(relevant.task.start) + 1}～${Math.ceil(relevant.task.finish)} 天施工，工期 ${relevant.duration} 天${relevant.task.critical ? '，位於要徑上' : `，浮時 ${relevant.task.float} 天`}。${relevant.step.partId ? '已同步定位到對應 3D 構件。' : '此工項目前沒有獨立的 3D 模型。'}`,
      focusStepId: relevant.step.id,
    }
  }

  const plannedDone = rows.filter((row) => row.task.finish <= day).length
  const activeNames = active.length
    ? active.slice(0, 4).map((row) => row.step.name).join('、')
    : '目前沒有排定施工中的工項'
  const focus = active.find((row) => row.step.partId) ?? active[0] ?? null
  return {
    text: `${photoNote}目前模擬在第 ${day + 1} 天，專案總工期 ${Math.ceil(projectDays)} 天；依計畫應完成 ${plannedDone}/${rows.length} 項，WBS 實際回報整體完成度為 ${overallProgress}%。當下工項：${activeNames}。${focus?.step.partId ? '已讓 3D 聚焦目前施工構件。' : ''}`,
    focusStepId: focus?.step.id ?? null,
  }
}
