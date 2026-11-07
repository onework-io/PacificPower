import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { GROUP_ORDER, PARTS, type PartDef } from '@/data/parts'

export type PartStatus = 'pending' | 'loading' | 'ready' | 'failed'

export const useViewerStore = defineStore('viewer', () => {
  /**
   * 使用者勾選顯示的構件。
   * 場域參考（site）預設不顯示；目前是施工放樣中心線，
   * 需要核對定位時再由清單開啟。格線本身不受這個集合影響。
   */
  const visible = ref(new Set<string>(PARTS.map((p) => p.id)))
  const isolatedId = ref<string | null>(null)
  /** 從 WBS／甘特／網圖選中的施工步驟所對應之 3D 構件。 */
  const highlightedIds = ref(new Set<string>())
  /** 爆炸係數 0–1 的目標值；實際位移由 render loop 平滑趨近 */
  const explodeFactor = ref(0)
  /** 外牆透視：機房外殼變半透明，與「隱藏外殼」不同——仍看得到牆的位置 */
  const shellGhost = ref(false)
  /** 由甘特圖的進度游標寫入：只顯示已安裝的構件；null 表示不過濾 */
  const progressFilter = ref<Set<string> | null>(null)
  /** 重設視角後維持全構件總覽；重新開始播放時才恢復進度過濾。 */
  const progressFilterSuppressed = ref(false)
  /**
   * 機房地板（貼在地面的實心平板）。
   * 預設關閉，讓格線地坪能透到建物內部；需要看實體地板時再打開。
   */
  const roomFloor = ref(true)
  /** 依參考影片重建的運鏡；有進度游標時才會接管相機 */
  const cameraTourEnabled = ref(true)
  /** 使用者明確要求自由操作時的硬保護，避免隱藏中的排程 watcher 再接管相機。 */
  const freeCameraMode = ref(false)
  /** 0–1 的安裝流程位置；null 表示自由視角 */
  const cameraTourProgress = ref<number | null>(null)
  /** 進度模擬當下要靠近觀看的 3D 構件；null 時沿用全景運鏡 */
  const cameraFocusPartId = ref<string | null>(null)
  /** AI「在 3D 查看」的一次性自由視角定位；serial 讓同一構件可重複定位。 */
  const freeFocusRequest = ref<{ partId: string; serial: number } | null>(null)
  const status = ref<Record<string, PartStatus>>(
    Object.fromEntries(PARTS.map((p) => [p.id, 'pending' as PartStatus])),
  )
  const loadedCount = ref(0)

  const total = PARTS.length
  const allReady = computed(() => loadedCount.value >= total)
  const failed = computed(() => PARTS.filter((p) => status.value[p.id] === 'failed'))

  /** 依 GROUP_ORDER 分組後的清單資料 */
  const groups = computed(() => {
    const byGroup = new Map<string, PartDef[]>()
    for (const p of PARTS) {
      if (!byGroup.has(p.group)) byGroup.set(p.group, [])
      byGroup.get(p.group)!.push(p)
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
      name: g,
      parts: byGroup.get(g)!,
    }))
  })

  function isVisible(id: string): boolean {
    return visible.value.has(id)
  }

  function setVisible(id: string, on: boolean): void {
    const next = new Set(visible.value)
    if (on) next.add(id)
    else next.delete(id)
    visible.value = next
  }

  function toggleVisible(id: string): void {
    setVisible(id, !isVisible(id))
  }

  /** 外牆透視與機房實體地板使用同一個剖視開關，避免兩個狀態互相矛盾。 */
  function setRoomCutaway(on: boolean): void {
    shellGhost.value = on
    roomFloor.value = on
  }

  function requestFreeFocus(partId: string): void {
    unlockCamera()
    freeFocusRequest.value = { partId, serial: (freeFocusRequest.value?.serial ?? 0) + 1 }
  }

  function unlockCamera(): void {
    freeCameraMode.value = true
    cameraTourEnabled.value = false
    cameraTourProgress.value = null
    cameraFocusPartId.value = null
  }

  function setCameraTourEnabled(on: boolean): void {
    cameraTourEnabled.value = on
    freeCameraMode.value = !on
    if (!on) {
      cameraTourProgress.value = null
      cameraFocusPartId.value = null
    }
  }

  function setGroupVisible(group: string, on: boolean): void {
    const next = new Set(visible.value)
    for (const p of PARTS) {
      if (p.group !== group) continue
      if (on) next.add(p.id)
      else next.delete(p.id)
    }
    visible.value = next
  }

  function showAll(): void {
    visible.value = new Set(PARTS.map((p) => p.id))
    isolatedId.value = null
  }

  /** 進入另一個專案時清除前案的選取、剖視、播放與相機狀態。 */
  function resetForProject(): void {
    visible.value = new Set(PARTS.filter((part) => part.kind !== 'site').map((part) => part.id))
    isolatedId.value = null
    highlightedIds.value = new Set()
    explodeFactor.value = 0
    shellGhost.value = false
    roomFloor.value = false
    progressFilter.value = null
    progressFilterSuppressed.value = false
    cameraTourEnabled.value = true
    freeCameraMode.value = false
    cameraTourProgress.value = null
    cameraFocusPartId.value = null
    freeFocusRequest.value = null
  }

  /** 再點一次同一個構件即取消隔離 */
  function toggleIsolate(id: string): void {
    isolatedId.value = isolatedId.value === id ? null : id
  }

  function setStatus(id: string, s: PartStatus): void {
    status.value = { ...status.value, [id]: s }
  }

  return {
    visible,
    isolatedId,
    highlightedIds,
    explodeFactor,
    shellGhost,
    progressFilter,
    progressFilterSuppressed,
    roomFloor,
    cameraTourEnabled,
    freeCameraMode,
    cameraTourProgress,
    cameraFocusPartId,
    freeFocusRequest,
    status,
    loadedCount,
    total,
    allReady,
    failed,
    groups,
    isVisible,
    setVisible,
    toggleVisible,
    setRoomCutaway,
    requestFreeFocus,
    unlockCamera,
    setCameraTourEnabled,
    setGroupVisible,
    showAll,
    resetForProject,
    toggleIsolate,
    setStatus,
  }
})
