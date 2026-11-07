import { describe, expect, it } from 'vitest'
import { projectReportCsv, summarizeProjectReport, taskPlannedProgress, type ProjectReportTask } from './projectReport'

const tasks: ProjectReportTask[] = [
  { wbs: '1.1', name: '放樣', phase: '基礎', progress: 100, weight: 40, start: 0, finish: 2, critical: true },
  { wbs: '2.1', name: '機組安裝', phase: '設備', progress: 20, weight: 60, start: 2, finish: 6, critical: true },
]

describe('project report', () => {
  it('calculates linear planned progress within a task', () => {
    expect(taskPlannedProgress(tasks[1]!, 2)).toBe(0)
    expect(taskPlannedProgress(tasks[1]!, 4)).toBe(50)
    expect(taskPlannedProgress(tasks[1]!, 7)).toBe(100)
  })

  it('summarizes weighted actual, planned and attention tasks', () => {
    const summary = summarizeProjectReport(tasks, 4)
    expect(summary.actualProgress).toBe(52)
    expect(summary.plannedProgress).toBe(70)
    expect(summary.variance).toBe(-18)
    expect(summary.completedCount).toBe(1)
    expect(summary.delayedCount).toBe(1)
    expect(summary.attentionTasks[0]?.wbs).toBe('2.1')
  })

  it('exports a UTF-8 CSV with report columns', () => {
    const csv = projectReportCsv(tasks, 4)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('計畫進度%')
    expect(csv).toContain('機組安裝')
  })
})
