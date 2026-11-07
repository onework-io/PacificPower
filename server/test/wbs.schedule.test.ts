import { describe, expect, it } from 'vitest'
import { calculateWbsSchedule, topologicalOrder } from '../src/wbs/wbs.schedule.js'

describe('WBS schedule calculation', () => {
  it('calculates FS lag and the critical path', () => {
    const result = calculateWbsSchedule([
      { id: 'a', code: '1.1', durationDays: 2, pinnedStartDay: null },
      { id: 'b', code: '1.2', durationDays: 3, pinnedStartDay: null },
      { id: 'c', code: '1.3', durationDays: 1, pinnedStartDay: null },
    ], [
      { predecessorTaskId: 'a', successorTaskId: 'b', lagDays: 2 },
      { predecessorTaskId: 'b', successorTaskId: 'c', lagDays: 0 },
    ])
    expect(result.projectDays).toBe(8)
    expect(result.tasks.map((task) => [task.code, task.earlyStart, task.earlyFinish, task.critical])).toEqual([
      ['1.1', 0, 2, true],
      ['1.2', 4, 7, true],
      ['1.3', 7, 8, true],
    ])
  })

  it('honors a pinned start and reports float on a shorter branch', () => {
    const result = calculateWbsSchedule([
      { id: 'a', code: 'A', durationDays: 5, pinnedStartDay: null },
      { id: 'b', code: 'B', durationDays: 1, pinnedStartDay: 1 },
      { id: 'c', code: 'C', durationDays: 1, pinnedStartDay: null },
    ], [
      { predecessorTaskId: 'a', successorTaskId: 'c', lagDays: 0 },
      { predecessorTaskId: 'b', successorTaskId: 'c', lagDays: 0 },
    ])
    expect(result.projectDays).toBe(6)
    expect(result.tasks.find((task) => task.code === 'B')?.totalFloat).toBe(3)
  })

  it('rejects dependency cycles', () => {
    expect(() => topologicalOrder(['a', 'b'], [['a', 'b'], ['b', 'a']]))
      .toThrow('WBS_DEPENDENCY_CYCLE')
  })
})
