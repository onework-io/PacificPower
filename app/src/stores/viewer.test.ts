import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useViewerStore } from './viewer'

describe('3D 自由視角狀態', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('解鎖後影片運鏡與相機目標都會清除', () => {
    const store = useViewerStore()
    store.cameraTourEnabled = true
    store.cameraTourProgress = 0.5
    store.cameraFocusPartId = 'p09'

    store.unlockCamera()

    expect(store.freeCameraMode).toBe(true)
    expect(store.cameraTourEnabled).toBe(false)
    expect(store.cameraTourProgress).toBeNull()
    expect(store.cameraFocusPartId).toBeNull()
  })

  it('同一構件可重複要求自由視角定位', () => {
    const store = useViewerStore()
    store.requestFreeFocus('p09')
    const first = store.freeFocusRequest?.serial
    store.requestFreeFocus('p09')

    expect(store.freeCameraMode).toBe(true)
    expect(store.freeFocusRequest?.partId).toBe('p09')
    expect(store.freeFocusRequest?.serial).toBe((first ?? 0) + 1)
  })

  it('切換專案會清除前一個專案的 3D 暫態', () => {
    const store = useViewerStore()
    store.isolatedId = 'p09'
    store.highlightedIds = new Set(['p09'])
    store.explodeFactor = 0.8
    store.setRoomCutaway(true)
    store.unlockCamera()
    store.resetForProject()
    expect(store.isolatedId).toBeNull()
    expect(store.highlightedIds.size).toBe(0)
    expect(store.explodeFactor).toBe(0)
    expect(store.shellGhost).toBe(false)
    expect(store.roomFloor).toBe(false)
    expect(store.cameraTourEnabled).toBe(true)
    expect(store.freeCameraMode).toBe(false)
  })
})
