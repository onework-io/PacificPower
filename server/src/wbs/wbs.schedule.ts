export interface ScheduleTask {
  id: string
  code: string
  durationDays: number
  pinnedStartDay: number | null
}

export interface ScheduleDependency {
  predecessorTaskId: string
  successorTaskId: string
  lagDays: number
}

export interface CalculatedSchedule {
  projectDays: number
  tasks: Array<{
    taskId: string
    code: string
    earlyStart: number
    earlyFinish: number
    lateStart: number
    lateFinish: number
    totalFloat: number
    critical: boolean
  }>
}

export function topologicalOrder(nodes: string[], edges: ReadonlyArray<readonly [string, string]>) {
  const indegree = new Map(nodes.map((node) => [node, 0]))
  const outgoing = new Map(nodes.map((node) => [node, [] as string[]]))
  for (const [from, to] of edges) {
    indegree.set(to, (indegree.get(to) ?? 0) + 1)
    outgoing.get(from)?.push(to)
  }
  const queue = nodes.filter((node) => indegree.get(node) === 0)
  const order: string[] = []
  while (queue.length) {
    const node = queue.shift()!
    order.push(node)
    for (const next of outgoing.get(node) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1)
      if (indegree.get(next) === 0) queue.push(next)
    }
  }
  if (order.length !== nodes.length) throw new Error('WBS_DEPENDENCY_CYCLE')
  return order
}

export function calculateWbsSchedule(
  tasks: ScheduleTask[], dependencies: ScheduleDependency[],
): CalculatedSchedule {
  const taskIds = tasks.map((task) => task.id)
  const edges = dependencies.map((edge) => [edge.predecessorTaskId, edge.successorTaskId] as const)
  const order = topologicalOrder(taskIds, edges)
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const incoming = new Map(taskIds.map((id) => [id, dependencies.filter((edge) => edge.successorTaskId === id)]))
  const outgoing = new Map(taskIds.map((id) => [id, dependencies.filter((edge) => edge.predecessorTaskId === id)]))
  const early = new Map<string, { start: number; finish: number }>()
  for (const id of order) {
    const task = byId.get(id)!
    const calculated = Math.max(0, ...(incoming.get(id) ?? []).map((edge) => {
      const predecessor = early.get(edge.predecessorTaskId)
      return (predecessor?.finish ?? 0) + edge.lagDays
    }))
    const start = Math.max(calculated, task.pinnedStartDay ?? 0)
    early.set(id, { start, finish: start + task.durationDays })
  }
  const projectDays = Math.max(0, ...[...early.values()].map((value) => value.finish))
  const late = new Map<string, { start: number; finish: number }>()
  for (const id of [...order].reverse()) {
    const task = byId.get(id)!
    const successors = outgoing.get(id) ?? []
    const finish = successors.length
      ? Math.min(...successors.map((edge) => (late.get(edge.successorTaskId)?.start ?? projectDays) - edge.lagDays))
      : projectDays
    late.set(id, { finish, start: finish - task.durationDays })
  }
  return {
    projectDays,
    tasks: tasks.map((task) => {
      const e = early.get(task.id)!
      const l = late.get(task.id)!
      const totalFloat = Math.max(0, l.start - e.start)
      return {
        taskId: task.id, code: task.code, earlyStart: e.start, earlyFinish: e.finish,
        lateStart: l.start, lateFinish: l.finish, totalFloat, critical: totalFloat < 0.0001,
      }
    }),
  }
}
