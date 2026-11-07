import { topologicalOrder } from './wbs.schedule.js'

export interface WbsSnapshotTask {
  stableKey: string
  code: string
  sequence: number
  name: string
  phase: string
  durationDays: number
  weightPct?: number | null
  modelPartKey?: string | null
}

export interface WbsSnapshotDependency {
  predecessorStableKey: string
  successorStableKey: string
  relationType: 'FS'
  lagDays: number
}

export interface WbsSnapshot {
  schemaVersion: number
  projectStart?: string | null
  tasks: WbsSnapshotTask[]
  dependencies: WbsSnapshotDependency[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredText = (value: unknown, field: string, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`${field} must be a non-empty string up to ${max} characters`)
  }
  return value.trim()
}

const finiteNumber = (value: unknown, field: string, minimum = 0) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${field} must be a number greater than or equal to ${minimum}`)
  }
  return value
}

export function normalizeAndValidateSnapshot(value: unknown): WbsSnapshot {
  if (!isRecord(value)) throw new Error('WBS snapshot must be an object')
  if (!Number.isInteger(value.schemaVersion) || Number(value.schemaVersion) < 1) {
    throw new Error('schemaVersion must be a positive integer')
  }
  if (!Array.isArray(value.tasks) || !Array.isArray(value.dependencies)) {
    throw new Error('WBS snapshot tasks and dependencies must be arrays')
  }

  const stableKeys = new Set<string>()
  const codes = new Set<string>()
  const sequences = new Set<number>()
  const tasks = value.tasks.map((raw, index): WbsSnapshotTask => {
    if (!isRecord(raw)) throw new Error(`tasks[${index}] must be an object`)
    const stableKey = requiredText(raw.stableKey, `tasks[${index}].stableKey`, 120)
    const code = requiredText(raw.code, `tasks[${index}].code`, 40)
    const sequence = finiteNumber(raw.sequence, `tasks[${index}].sequence`, 1)
    if (!Number.isInteger(sequence)) throw new Error(`tasks[${index}].sequence must be an integer`)
    if (stableKeys.has(stableKey)) throw new Error(`Duplicate stableKey: ${stableKey}`)
    if (codes.has(code)) throw new Error(`Duplicate code: ${code}`)
    if (sequences.has(sequence)) throw new Error(`Duplicate sequence: ${sequence}`)
    stableKeys.add(stableKey)
    codes.add(code)
    sequences.add(sequence)
    const weightPct = raw.weightPct == null ? null : finiteNumber(raw.weightPct, `tasks[${index}].weightPct`)
    if (weightPct !== null && weightPct > 100) throw new Error(`tasks[${index}].weightPct must not exceed 100`)
    return {
      stableKey,
      code,
      sequence,
      name: requiredText(raw.name, `tasks[${index}].name`, 200),
      phase: requiredText(raw.phase, `tasks[${index}].phase`, 120),
      durationDays: finiteNumber(raw.durationDays, `tasks[${index}].durationDays`, 0.01),
      weightPct,
      modelPartKey: raw.modelPartKey == null ? null : requiredText(raw.modelPartKey, `tasks[${index}].modelPartKey`, 160),
    }
  })

  const edgeKeys = new Set<string>()
  const dependencies = value.dependencies.map((raw, index): WbsSnapshotDependency => {
    if (!isRecord(raw)) throw new Error(`dependencies[${index}] must be an object`)
    const predecessorStableKey = requiredText(
      raw.predecessorStableKey, `dependencies[${index}].predecessorStableKey`, 120,
    )
    const successorStableKey = requiredText(
      raw.successorStableKey, `dependencies[${index}].successorStableKey`, 120,
    )
    if (!stableKeys.has(predecessorStableKey) || !stableKeys.has(successorStableKey)) {
      throw new Error(`Dependency ${predecessorStableKey} -> ${successorStableKey} references a missing task`)
    }
    if (predecessorStableKey === successorStableKey) throw new Error('A task cannot depend on itself')
    if (raw.relationType !== 'FS') throw new Error('Only FS dependencies are supported')
    const edgeKey = `${predecessorStableKey}\u0000${successorStableKey}`
    if (edgeKeys.has(edgeKey)) throw new Error(`Duplicate dependency: ${predecessorStableKey} -> ${successorStableKey}`)
    edgeKeys.add(edgeKey)
    return {
      predecessorStableKey,
      successorStableKey,
      relationType: 'FS',
      lagDays: raw.lagDays == null ? 0 : finiteNumber(raw.lagDays, `dependencies[${index}].lagDays`),
    }
  })
  topologicalOrder(
    tasks.map((task) => task.stableKey),
    dependencies.map((edge) => [edge.predecessorStableKey, edge.successorStableKey]),
  )

  return {
    schemaVersion: Number(value.schemaVersion),
    projectStart: value.projectStart == null ? null : requiredText(value.projectStart, 'projectStart', 40),
    tasks,
    dependencies,
  }
}

export function diffWbsSnapshots(fromValue: unknown, toValue: unknown) {
  const from = normalizeAndValidateSnapshot(fromValue)
  const to = normalizeAndValidateSnapshot(toValue)
  const fromTasks = new Map(from.tasks.map((task) => [task.stableKey, task]))
  const toTasks = new Map(to.tasks.map((task) => [task.stableKey, task]))
  const added = to.tasks.filter((task) => !fromTasks.has(task.stableKey))
  const removed = from.tasks.filter((task) => !toTasks.has(task.stableKey))
  const changed = to.tasks.flatMap((task) => {
    const before = fromTasks.get(task.stableKey)
    if (!before) return []
    const changedFields = (Object.keys(task) as Array<keyof WbsSnapshotTask>)
      .filter((field) => before[field] !== task[field])
    return changedFields.length ? [{ stableKey: task.stableKey, changedFields, before, after: task }] : []
  })
  const edgeKey = (edge: WbsSnapshotDependency) =>
    `${edge.predecessorStableKey}\u0000${edge.successorStableKey}\u0000${edge.relationType}\u0000${edge.lagDays}`
  const fromEdges = new Set(from.dependencies.map(edgeKey))
  const toEdges = new Set(to.dependencies.map(edgeKey))
  return {
    added,
    removed,
    changed,
    dependencyChanges: {
      added: to.dependencies.filter((edge) => !fromEdges.has(edgeKey(edge))),
      removed: from.dependencies.filter((edge) => !toEdges.has(edgeKey(edge))),
    },
  }
}
