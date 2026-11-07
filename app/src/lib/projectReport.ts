export interface ProjectReportTask {
  wbs: string
  name: string
  phase: string
  progress: number
  weight: number
  start: number
  finish: number
  critical: boolean
}

export interface ProjectReportPhase {
  phase: string
  taskCount: number
  progress: number
  planned: number
  variance: number
  delayedCount: number
  critical: boolean
}

export interface ProjectReportSummary {
  actualProgress: number
  plannedProgress: number
  variance: number
  completedCount: number
  delayedCount: number
  criticalRemainingCount: number
  phases: ProjectReportPhase[]
  attentionTasks: Array<ProjectReportTask & { planned: number; variance: number }>
}

export function taskPlannedProgress(task: Pick<ProjectReportTask, 'start' | 'finish'>, dataDay: number) {
  if (dataDay <= task.start) return 0
  if (dataDay >= task.finish) return 100
  const duration = Math.max(0.1, task.finish - task.start)
  return Math.round(((dataDay - task.start) / duration) * 1000) / 10
}

function weightedProgress<T extends ProjectReportTask>(tasks: T[], selector: (task: T) => number) {
  const weight = tasks.reduce((sum, task) => sum + task.weight, 0)
  if (!weight) return 0
  return Math.round(tasks.reduce((sum, task) => sum + task.weight * selector(task), 0) / weight)
}

export function summarizeProjectReport(tasks: ProjectReportTask[], dataDay: number): ProjectReportSummary {
  const enriched = tasks.map((task) => {
    const planned = taskPlannedProgress(task, dataDay)
    return { ...task, planned, variance: Math.round((task.progress - planned) * 10) / 10 }
  })
  const phaseNames = [...new Set(tasks.map((task) => task.phase))]
  const phases = phaseNames.map((phase) => {
    const phaseTasks = enriched.filter((task) => task.phase === phase)
    const actual = weightedProgress(phaseTasks, (task) => task.progress)
    const planned = weightedProgress(phaseTasks, (task) => task.planned)
    return {
      phase,
      taskCount: phaseTasks.length,
      progress: actual,
      planned,
      variance: actual - planned,
      delayedCount: phaseTasks.filter((task) => task.variance < -5).length,
      critical: phaseTasks.some((task) => task.critical && task.progress < 100),
    }
  })
  const actualProgress = weightedProgress(tasks, (task) => task.progress)
  const plannedProgress = weightedProgress(tasks, (task) => taskPlannedProgress(task, dataDay))
  return {
    actualProgress,
    plannedProgress,
    variance: actualProgress - plannedProgress,
    completedCount: tasks.filter((task) => task.progress >= 100).length,
    delayedCount: enriched.filter((task) => task.variance < -5).length,
    criticalRemainingCount: tasks.filter((task) => task.critical && task.progress < 100).length,
    phases,
    attentionTasks: enriched
      .filter((task) => task.variance < -5 || (task.critical && task.progress < 100))
      .sort((a, b) => Number(b.critical) - Number(a.critical) || a.variance - b.variance)
      .slice(0, 10),
  }
}

function csvCell(value: string | number | boolean) {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function projectReportCsv(tasks: ProjectReportTask[], dataDay: number) {
  const header = ['WBS', '階段', '工項', '計畫進度%', '實際進度%', '落差%', '要徑']
  const rows = tasks.map((task) => {
    const planned = taskPlannedProgress(task, dataDay)
    return [task.wbs, task.phase, task.name, planned, task.progress, Math.round((task.progress - planned) * 10) / 10, task.critical ? '是' : '否']
  })
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}`
}
