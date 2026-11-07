import { describe, expect, it } from 'vitest'
import { diffWbsSnapshots, normalizeAndValidateSnapshot } from '../src/wbs/wbs.version.js'

const snapshot = {
  schemaVersion: 1,
  tasks: [
    { stableKey: 'a', code: '1', sequence: 1, name: 'A', phase: 'P', durationDays: 1 },
    { stableKey: 'b', code: '2', sequence: 2, name: 'B', phase: 'P', durationDays: 2 },
  ],
  dependencies: [
    { predecessorStableKey: 'a', successorStableKey: 'b', relationType: 'FS', lagDays: 0 },
  ],
}

describe('WBS version snapshots', () => {
  it('normalizes a valid snapshot', () => {
    expect(normalizeAndValidateSnapshot(snapshot).tasks).toHaveLength(2)
  })

  it('rejects duplicate keys and dependency cycles', () => {
    expect(() => normalizeAndValidateSnapshot({
      ...snapshot, tasks: [...snapshot.tasks, { ...snapshot.tasks[0], code: '3', sequence: 3 }],
    })).toThrow('Duplicate stableKey')
    expect(() => normalizeAndValidateSnapshot({
      ...snapshot,
      dependencies: [...snapshot.dependencies, {
        predecessorStableKey: 'b', successorStableKey: 'a', relationType: 'FS', lagDays: 0,
      }],
    })).toThrow('WBS_DEPENDENCY_CYCLE')
  })

  it('reports task and dependency differences', () => {
    const result = diffWbsSnapshots(snapshot, {
      ...snapshot,
      tasks: [
        { ...snapshot.tasks[0], durationDays: 3 },
        { stableKey: 'c', code: '3', sequence: 3, name: 'C', phase: 'P', durationDays: 1 },
      ],
      dependencies: [],
    })
    expect(result.added.map((task) => task.stableKey)).toEqual(['c'])
    expect(result.removed.map((task) => task.stableKey)).toEqual(['b'])
    expect(result.changed[0]?.changedFields).toContain('durationDays')
    expect(result.dependencyChanges.removed).toHaveLength(1)
  })
})
