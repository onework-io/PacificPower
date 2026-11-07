import { describe, expect, it } from 'vitest'
import type { GanttRow } from '@/stores/schedule'
import { activeRowsAt, buildDemoPhotoAnswer, buildLocalSiteAnswer, findRelevantRow } from './siteAssistant'

function row(id: string, name: string, start: number, finish: number, partId: string | null): GanttRow {
  return {
    step: { id, seq: Number(id.slice(1)), name, partId, phase: '測試', durationDays: finish - start, deps: [] },
    task: { id, start, finish, lateStart: start, lateFinish: finish, float: 0, critical: true },
    duration: finish - start,
    weight: 50,
    wbs: id,
    progress: 0,
    edited: false,
  }
}

const rows = [
  row('s1', '發電機組本體安裝', 0, 2, 'p09'),
  row('s2', '日用油槽安裝', 2, 3, 'p14'),
]

describe('AI 現場助手本機排程回答', () => {
  it('能從自然語句找到對應工項', () => {
    expect(findRelevantRow('請問發電機本體進度', rows)?.step.id).toBe('s1')
  })

  it('能找出指定日期的施工中工項', () => {
    expect(activeRowsAt(rows, 2).map((r) => r.step.id)).toEqual(['s2'])
  })

  it('回答目前進度並回傳 3D 聚焦工項', () => {
    const answer = buildLocalSiteAnswer('目前進度如何？', {
      dataDay: 0,
      projectDays: 3,
      overallProgress: 12,
      rows,
    })
    expect(answer.text).toContain('整體完成度為 12%')
    expect(answer.focusStepId).toBe('s1')
  })

  it('設備名稱優先於「目前」等時間字眼', () => {
    const answer = buildLocalSiteAnswer('發電機本體目前進度如何？', {
      dataDay: 2,
      projectDays: 3,
      overallProgress: 12,
      rows,
    })
    expect(answer.text).toContain('發電機組本體安裝')
    expect(answer.focusStepId).toBe('s1')
  })

  it.each(['A1.jpg', 'A2.JPG', 'A3.JPG'])('does not fabricate progress from %s', (name) => {
    const answer = buildDemoPhotoAnswer(name)
    expect(answer.text).toContain('尚未接入')
    expect(answer.focusStepId).toBeNull()
    expect(answer.estimatedOverallProgress).toBeUndefined()
  })
})
