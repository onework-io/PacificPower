import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCostStore } from './cost'
import { usePoiStore } from './poi'
import { useScheduleStore } from './schedule'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}

describe('專案資料隔離', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    setActivePinia(createPinia())
  })

  it('不同專案保留各自的 WBS 調整', async () => {
    const store = useScheduleStore()
    await store.loadProject('project-a')
    store.setDuration('dc-survey', 8)
    await store.loadProject('project-b')
    expect(store.rows.find((row) => row.step.id === 'dc-survey')?.duration).toBe(10)
    await store.loadProject('project-a')
    expect(store.rows.find((row) => row.step.id === 'dc-survey')?.duration).toBe(8)
  })

  it('不同專案不會共用 3D 現場標記', () => {
    const store = usePoiStore()
    store.loadProject('project-a')
    const added = store.add('p09', [1, 2, 3])
    store.loadProject('project-b')
    expect(store.byId.has(added.id)).toBe(false)
    store.loadProject('project-a')
    expect(store.byId.has(added.id)).toBe(true)
  })

  it('不同專案不會共用人工與實際成本輸入', () => {
    const store = useCostStore()
    store.loadProject('project-a')
    store.set('s01', 'laborPeople', 6)
    store.setActual('s01', 12000)
    store.loadProject('project-b')
    expect(store.inputs.s01).toBeUndefined()
    expect(store.getActual('s01')).toBeNull()
    store.loadProject('project-a')
    expect(store.inputs.s01?.laborPeople).toBe(6)
    expect(store.getActual('s01')).toBe(12000)
  })
})
