import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { INSTALL_STEPS, PHASES, PHASE_WBS, type InstallStep } from '@/data/installSteps'
import { PARTS } from '@/data/parts'
import { completedAt, computeSchedule, type ScheduledTask, type TaskInput } from '@/lib/schedule'
import { earnedPct, plannedCurve, type CurveRow } from '@/lib/scurve'
import type { ImportedWbsRow } from '@/lib/wbsExcel'
import { wbsRepository, type ApiWbsTask, type WbsTaskPatch } from '@/lib/wbsRepository'

const STORAGE_KEY = 'pacificpower-schedule-v2'

/** 使用者對單一步驟的調整；未調整的欄位不存，之後改資料檔仍會生效 */
export interface StepOverride {
  pinnedStart?: number
  /** 從 Excel 匯入或在 WBS 編輯的施工步驟名稱 */
  name?: string
  /** 工作天 */
  durationDays?: number
  /** Excel 指定的進度權重 0–100；未指定時依工作天分配剩餘權重 */
  weightPct?: number
  /** 完成度 0–100 */
  progress?: number
}

export interface GanttRow {
  step: InstallStep
  task: ScheduledTask
  /** 工作天 */
  duration: number
  /** 依工作天換算的進度權重 */
  weight: number
  /** WBS 代號，例如 2.1 */
  wbs: string
  progress: number
  /** 使用者是否調整過這一列 */
  edited: boolean
}

/** 進度歷程的一筆快照 */
export interface ProgressSnapshot {
  /** 記錄當下的資料日期（距開工日的天數） */
  day: number
  /** 當下的實獲值百分比 */
  pct: number
}

interface Persisted {
  projectStart: string
  overrides: Record<string, StepOverride>
  cursorDay: number | null
  playSpeed: number
  progressLog: ProgressSnapshot[]
}

/** 進度模擬的播放倍速選項 */
export const PLAY_SPEEDS = [0.3, 0.5, 1, 2, 4, 8] as const

function storageKey(projectId: string | null): string {
  return projectId ? `${STORAGE_KEY}:${projectId}` : STORAGE_KEY
}

function loadPersisted(projectId: string | null = null): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(storageKey(projectId))
    return raw ? (JSON.parse(raw) as Persisted) : {}
  } catch {
    // 隱私模式或損毀的資料：忽略，用預設值
    return {}
  }
}

export const useScheduleStore = defineStore('schedule', () => {
  const saved = loadPersisted(null)
  const sourceSteps = ref<InstallStep[]>([...INSTALL_STEPS])
  const remoteTasks = ref<Record<string, ApiWbsTask>>({})
  const activeProjectId = ref<string | null>(null)
  const syncState = ref<'local' | 'loading' | 'synced' | 'saving' | 'error'>('local')
  const syncMessage = ref('本機 WBS')
  const syncTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /** 開工日（ISO yyyy-mm-dd），時間軸的第 0 天 */
  const projectStart = ref(saved.projectStart ?? '2026-11-07')
  const overrides = ref<Record<string, StepOverride>>(saved.overrides ?? {})
  const selectedId = ref<string | null>(null)
  /** 進度模擬游標的天數；null 表示關閉模擬、3D 顯示全部構件 */
  const cursorDay = ref<number | null>(saved.cursorDay ?? null)
  /** 播放倍速；1 為每天 420 毫秒 */
  const playSpeed = ref(
    PLAY_SPEEDS.includes(saved.playSpeed as (typeof PLAY_SPEEDS)[number]) ? saved.playSpeed! : 1,
  )
  /**
   * 進度歷程。每次調整完成度時記錄一筆，用來畫真正的實際曲線——
   * 單一時間點的完成度回推不出過去的進度走勢。
   */
  const progressLog = ref<ProgressSnapshot[]>(saved.progressLog ?? [])

  function savePersisted(projectId: string | null = activeProjectId.value): void {
    try {
      localStorage.setItem(
        storageKey(projectId),
        JSON.stringify({
          projectStart: projectStart.value,
          overrides: overrides.value,
          cursorDay: cursorDay.value,
          playSpeed: playSpeed.value,
          progressLog: progressLog.value,
        } satisfies Persisted),
      )
    } catch {
      // 儲存空間不足或被封鎖：不影響操作，只是重整後不保留
    }
  }

  /** 來源工作表尚未填工作天，先採用資料檔草案；使用者可在 WBS／甘特直接覆寫。 */
  const durations = computed(
    () => new Map(sourceSteps.value.map((s) => [s.id, overrides.value[s.id]?.durationDays ?? s.durationDays])),
  )

  const inputs = computed<TaskInput[]>(() =>
    sourceSteps.value.map((s) => ({
      id: s.id,
      durationDays: durations.value.get(s.id)!,
      deps: s.deps,
      lagDays: s.lagDays,
      pinnedStart: overrides.value[s.id]?.pinnedStart,
    })),
  )

  const schedule = computed(() => computeSchedule(inputs.value))
  const projectDays = computed(() => schedule.value.projectDays)
  const plannedWorkDays = computed(() =>
    Array.from(durations.value.values()).reduce((sum, days) => sum + days, 0),
  )

  /** 依來源工作表項次排序，WBS、甘特與施工影片使用同一順序。 */
  /** WBS 代號：階段序號 . 該階段內的排序 */
  const wbsCodes = computed(() => {
    const counters = new Map<string, number>()
    const codes = new Map<string, string>()
    const ordered = [...sourceSteps.value].sort(
      (a, b) => PHASES.indexOf(a.phase as never) - PHASES.indexOf(b.phase as never) || a.seq - b.seq,
    )
    for (const s of ordered) {
      const n = (counters.get(s.phase) ?? 0) + 1
      counters.set(s.phase, n)
      codes.set(s.id, s.wbsCode ?? `${PHASE_WBS.get(s.phase) ?? '?'}.${n}`)
    }
    return codes
  })

  const rows = computed<GanttRow[]>(() => {
    const s = schedule.value
    const explicitWeight = sourceSteps.value.reduce(
      (sum, step) => sum + (overrides.value[step.id]?.weightPct ?? 0),
      0,
    )
    const unweightedWork = sourceSteps.value.reduce(
      (sum, step) => sum + (overrides.value[step.id]?.weightPct === undefined ? durations.value.get(step.id)! : 0),
      0,
    )
    const remainingWeight = Math.max(0, 100 - explicitWeight)
    return sourceSteps.value.filter((step) => s.tasks.has(step.id))
      .map((step) => {
        const o = overrides.value[step.id]
        const duration = durations.value.get(step.id)!
        const effectiveStep = o?.name ? { ...step, name: o.name } : step
        return {
          step: effectiveStep,
          task: s.tasks.get(step.id)!,
          duration,
          weight:
            o?.weightPct ?? (unweightedWork ? (duration / unweightedWork) * remainingWeight : 0),
          wbs: wbsCodes.value.get(step.id) ?? '',
          progress: o?.progress ?? 0,
          edited:
            o?.pinnedStart !== undefined ||
            o?.durationDays !== undefined ||
            o?.weightPct !== undefined ||
            o?.name !== undefined,
        }
      })
      .sort((a, b) => a.step.seq - b.step.seq)
  })

  /** 依 WBS 第一層分組，含各階段的彙整 */
  const wbsGroups = computed(() => {
    const byPhase = new Map<string, GanttRow[]>()
    for (const r of rows.value) {
      if (!byPhase.has(r.step.phase)) byPhase.set(r.step.phase, [])
      byPhase.get(r.step.phase)!.push(r)
    }
    const orderedPhases = [
      ...PHASES.filter((phase) => byPhase.has(phase)),
      ...[...byPhase.keys()].filter((phase) => !PHASES.includes(phase as never)),
    ]
    return orderedPhases.map((phase) => {
      const items = byPhase
        .get(phase)!
        .sort((a, b) => a.wbs.localeCompare(b.wbs, undefined, { numeric: true }))
      const start = Math.min(...items.map((i) => i.task.start))
      const finish = Math.max(...items.map((i) => i.task.finish))
      const work = items.reduce((s, i) => s + i.duration, 0)
      const weight = items.reduce((s, i) => s + i.weight, 0)
      const done = items.reduce((s, i) => s + (i.weight * i.progress) / 100, 0)
      return {
        phase,
        wbs: PHASE_WBS.get(phase) ?? '?',
        items,
        start,
        finish,
        /** 階段跨距（含等待），與各步驟工期總和不同 */
        span: finish - start,
        work,
        weight,
        progress: weight ? Math.round((done / weight) * 100) : 0,
        critical: items.some((i) => i.task.critical),
      }
    })
  })

  const curveRows = computed<CurveRow[]>(() =>
    rows.value.map((r) => ({
      duration: r.duration,
      weight: r.weight,
      start: r.task.start,
      finish: r.task.finish,
      lateStart: r.task.lateStart,
      lateFinish: r.task.lateFinish,
      progress: r.progress,
    })),
  )

  /** 計畫值曲線：最早開始與最晚開始各一條，兩者之間即香蕉包絡 */
  const plannedEarly = computed(() => plannedCurve(curveRows.value, projectDays.value, 'early'))
  const plannedLate = computed(() => plannedCurve(curveRows.value, projectDays.value, 'late'))
  const currentEarned = computed(() => earnedPct(curveRows.value))

  /**
   * 資料日期：進度模擬開著就用游標，否則用今天。
   * 今天早於開工日時取 0，晚於完工日時取完工日。
   */
  const dataDay = computed(() => {
    if (cursorDay.value !== null) return cursorDay.value
    const days = Math.floor(
      (Date.now() - projectStartDate.value.getTime()) / 86_400_000,
    )
    return Math.min(Math.max(days, 0), Math.ceil(projectDays.value))
  })

  /** 記錄一筆進度快照；同一天只保留最後一次 */
  function logProgress(): void {
    const day = dataDay.value
    const pct = currentEarned.value
    const rest = progressLog.value.filter((s) => s.day !== day)
    progressLog.value = [...rest, { day, pct }].sort((a, b) => a.day - b.day)
  }

  function clearProgressLog(): void {
    progressLog.value = []
  }

  const projectStartDate = computed(() => {
    const [y, m, d] = projectStart.value.split('-').map(Number)
    return new Date(y, (m ?? 1) - 1, d ?? 1)
  })

  /**
   * 游標當天正在施作的步驟。
   *
   * 判定用「工期區間與當天 [D, D+1) 有重疊」而非 start <= D < finish——
   * 判定採區間重疊，可正確處理後續若加入半天工期的情況。
   */
  const activeSteps = computed<GanttRow[]>(() => {
    const d = cursorDay.value
    if (d === null) return []
    return rows.value.filter((r) => r.task.start < d + 1 && r.task.finish > d)
  })

  /** 游標當下已完工的步驟 id；模擬關閉時為 null */
  const completedStepIds = computed(() =>
    cursorDay.value === null ? null : completedAt(schedule.value, cursorDay.value),
  )

  /** 供 3D 過濾用的構件 id；模擬關閉時為 null（顯示全部） */
  const installedPartIds = computed(() => {
    const done = completedStepIds.value
    if (!done) return null
    const ids = new Set<string>()
    for (const part of PARTS) {
      if (part.installStepId && done.has(part.installStepId)) ids.add(part.id)
    }
    return ids
  })

  const overallProgress = computed(() => {
    const total = rows.value.reduce((s, r) => s + r.weight, 0)
    if (!total) return 0
    const done = rows.value.reduce((s, r) => s + (r.weight * r.progress) / 100, 0)
    return Math.round((done / total) * 100)
  })

  function patch(id: string, p: StepOverride): void {
    overrides.value = { ...overrides.value, [id]: { ...overrides.value[id], ...p } }
    queueRemotePatch(id, p)
  }

  function setPinnedStart(id: string, day: number): void {
    patch(id, { pinnedStart: Math.max(0, Math.round(day)) })
  }

  function setDuration(id: string, days: number): void {
    if (!Number.isFinite(days)) return
    patch(id, { durationDays: Math.max(0.1, Math.round(days * 10) / 10) })
  }

  function setWeight(id: string, pct: number): void {
    if (!Number.isFinite(pct)) return
    const otherWeights = sourceSteps.value.reduce(
      (sum, step) => sum + (step.id === id ? 0 : (overrides.value[step.id]?.weightPct ?? 0)),
      0,
    )
    const available = Math.max(0, 100 - otherWeights)
    patch(id, { weightPct: Math.min(available, Math.max(0, Math.round(pct * 10) / 10)) })
  }

  function setProgress(id: string, pct: number): void {
    patch(id, { progress: Math.min(100, Math.max(0, Math.round(pct))) })
    logProgress()
  }

  /** 清掉單一步驟的拖曳調整，回到資料檔的排程（保留完成度） */
  function resetStep(id: string): void {
    const {
      pinnedStart: _p,
      durationDays: _d,
      weightPct: _w,
      name: _n,
      ...rest
    } = overrides.value[id] ?? {}
    overrides.value = { ...overrides.value, [id]: rest }
  }

  /** 將已驗證的 Excel 工項以項次套用，保留既有完成度與手動開工日。 */
  function importWbsRows(imported: ImportedWbsRow[]): number {
    const stepBySeq = new Map(sourceSteps.value.map((step) => [step.seq, step]))
    const unknown = imported.filter((row) => !stepBySeq.has(row.seq)).map((row) => row.seq)
    if (unknown.length) throw new Error(`Excel 含有未支援的項次：${unknown.join('、')}`)

    const next = { ...overrides.value }
    for (const row of imported) {
      const step = stepBySeq.get(row.seq)!
      next[step.id] = {
        ...next[step.id],
        name: row.name,
        ...(row.durationDays === undefined ? {} : { durationDays: row.durationDays }),
        ...(row.weightPct === undefined ? {} : { weightPct: row.weightPct }),
      }
    }
    overrides.value = next
    for (const row of imported) {
      const step = stepBySeq.get(row.seq)!
      queueRemotePatch(step.id, next[step.id] ?? {})
    }
    return imported.length
  }

  async function loadProject(projectId: string, startDate?: string) {
    for (const timer of syncTimers.values()) clearTimeout(timer)
    syncTimers.clear()
    savePersisted()
    activeProjectId.value = projectId
    const projectSaved = loadPersisted(projectId)
    projectStart.value = startDate?.replaceAll('/', '-') ?? projectSaved.projectStart ?? '2026-11-07'
    overrides.value = projectSaved.overrides ?? {}
    cursorDay.value = projectSaved.cursorDay ?? null
    playSpeed.value = PLAY_SPEEDS.includes(projectSaved.playSpeed as (typeof PLAY_SPEEDS)[number])
      ? projectSaved.playSpeed!
      : 1
    progressLog.value = projectSaved.progressLog ?? []
    selectedId.value = null
    remoteTasks.value = {}
    sourceSteps.value = [...INSTALL_STEPS]
    if (!wbsRepository.apiEnabled) {
      syncState.value = 'local'
      syncMessage.value = '本機 WBS'
      return
    }
    syncState.value = 'loading'
    syncMessage.value = '載入 WBS…'
    try {
      const data = await wbsRepository.load(projectId)
      if (!data || activeProjectId.value !== projectId) return
      const stableById = new Map(data.tasks.map((task) => [task.id, task.stableKey]))
      const lagByPredecessor = new Map<string, number>()
      for (const dependency of data.dependencies) {
        lagByPredecessor.set(
          dependency.predecessorTaskId,
          Math.max(lagByPredecessor.get(dependency.predecessorTaskId) ?? 0, dependency.lagDays),
        )
      }
      sourceSteps.value = data.tasks.map((task) => ({
        id: task.stableKey,
        seq: task.sequence,
        wbsCode: task.code,
        name: task.name,
        partId: task.modelPartKey,
        phase: task.phase,
        durationDays: task.durationDays,
        deps: data.dependencies
          .filter((dependency) => dependency.successorTaskId === task.id)
          .map((dependency) => stableById.get(dependency.predecessorTaskId))
          .filter((id): id is string => Boolean(id)),
        lagDays: lagByPredecessor.get(task.id) ?? task.lagDays,
      }))
      remoteTasks.value = Object.fromEntries(data.tasks.map((task) => [task.stableKey, task]))
      overrides.value = Object.fromEntries(data.tasks.map((task) => [task.stableKey, {
        ...(task.weightPct === null ? {} : { weightPct: task.weightPct }),
        progress: task.progressPct,
        ...(task.pinnedStartDay === null ? {} : { pinnedStart: task.pinnedStartDay }),
      }]))
      cursorDay.value = null
      syncState.value = 'synced'
      syncMessage.value = `已同步 ${data.tasks.length} 項 WBS`
    } catch (error) {
      if (activeProjectId.value !== projectId) return
      syncState.value = 'error'
      syncMessage.value = error instanceof Error ? `WBS 同步失敗：${error.message}` : 'WBS 同步失敗'
    }
  }

  function queueRemotePatch(id: string, override: StepOverride) {
    const projectId = activeProjectId.value
    const task = remoteTasks.value[id]
    if (!projectId || !task || !wbsRepository.apiEnabled) return
    const patch: WbsTaskPatch = {}
    if (override.name !== undefined) patch.name = override.name
    if (override.durationDays !== undefined) patch.durationDays = override.durationDays
    if (override.weightPct !== undefined) patch.weightPct = override.weightPct
    if (override.progress !== undefined) patch.progressPct = override.progress
    if (override.pinnedStart !== undefined) patch.pinnedStartDay = override.pinnedStart
    if (!Object.keys(patch).length) return
    const previous = syncTimers.get(id)
    if (previous) clearTimeout(previous)
    syncState.value = 'saving'
    syncMessage.value = '儲存 WBS…'
    syncTimers.set(id, setTimeout(async () => {
      try {
        const current = remoteTasks.value[id]
        if (!current || activeProjectId.value !== projectId) return
        const savedTask = await wbsRepository.update(projectId, current, patch)
        if (activeProjectId.value !== projectId) return
        remoteTasks.value = { ...remoteTasks.value, [id]: savedTask }
        syncState.value = 'synced'
        syncMessage.value = 'WBS 已同步'
      } catch (error) {
        syncState.value = 'error'
        syncMessage.value = error instanceof Error ? `WBS 儲存失敗：${error.message}` : 'WBS 儲存失敗'
      } finally {
        syncTimers.delete(id)
      }
    }, 450))
  }

  function resetAll(): void {
    overrides.value = {}
    selectedId.value = null
  }

  watch(
    [projectStart, overrides, cursorDay, playSpeed, progressLog],
    () => savePersisted(),
    { deep: true },
  )

  return {
    projectStart,
    projectStartDate,
    overrides,
    selectedId,
    cursorDay,
    playSpeed,
    schedule,
    projectDays,
    plannedWorkDays,
    rows,
    activeSteps,
    wbsGroups,
    plannedEarly,
    plannedLate,
    currentEarned,
    dataDay,
    progressLog,
    logProgress,
    clearProgressLog,
    completedStepIds,
    installedPartIds,
    overallProgress,
    syncState,
    syncMessage,
    activeProjectId,
    loadProject,
    setPinnedStart,
    setDuration,
    setWeight,
    setProgress,
    importWbsRows,
    resetStep,
    resetAll,
  }
})
