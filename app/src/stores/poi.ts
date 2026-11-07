import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { DEFAULT_POIS, type Poi } from '@/data/pois'
import { poiRepository } from '@/lib/poiRepository'

const STORAGE_KEY = 'pacificpower-pois-v1'

interface Persisted {
  /** 使用者新增的，以及對預設項目的修改（以完整內容覆寫） */
  custom: Record<string, Poi>
  /** 被刪掉的預設項目 id */
  removed: string[]
}

function storageKey(projectId: string | null): string {
  return projectId ? `${STORAGE_KEY}:${projectId}` : STORAGE_KEY
}

function load(projectId: string | null = null): Persisted {
  try {
    const raw = localStorage.getItem(storageKey(projectId))
    const p = raw ? (JSON.parse(raw) as Persisted) : null
    return { custom: p?.custom ?? {}, removed: p?.removed ?? [] }
  } catch {
    return { custom: {}, removed: [] }
  }
}

export const usePoiStore = defineStore('poi', () => {
  const saved = load(null)
  const activeProjectId = ref<string | null>(null)
  const custom = ref<Record<string, Poi>>(saved.custom)
  const removed = ref<string[]>(saved.removed)
  const syncState = ref<'local' | 'loading' | 'synced' | 'saving' | 'error'>('local')
  const syncMessage = ref('本機標記')
  const updateTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const deletedTemporaryIds = new Set<string>()
  let loadGeneration = 0

  /** 編輯模式：點模型表面即新增 POI */
  const editMode = ref(false)
  /** 目前展開卡片的 POI */
  const activeId = ref<string | null>(null)
  /** 正在編輯欄位的 POI（新增後直接進入編輯） */
  const editingId = ref<string | null>(null)

  const pois = computed<Poi[]>(() => {
    const out: Poi[] = []
    for (const d of DEFAULT_POIS) {
      if (removed.value.includes(d.id)) continue
      out.push(custom.value[d.id] ?? d)
    }
    const defaultIds = new Set(DEFAULT_POIS.map((d) => d.id))
    for (const [id, p] of Object.entries(custom.value)) {
      if (!defaultIds.has(id)) out.push(p)
    }
    return out
  })

  const byId = computed(() => new Map(pois.value.map((p) => [p.id, p])))

  const countByPart = computed(() => {
    const m = new Map<string, number>()
    for (const p of pois.value) m.set(p.partId, (m.get(p.partId) ?? 0) + 1)
    return m
  })

  function add(partId: string, position: [number, number, number]): Poi {
    const poi: Poi = {
      id: `poi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      partId,
      position,
      title: '新標記',
      url: '',
    }
    custom.value = { ...custom.value, [poi.id]: poi }
    activeId.value = poi.id
    editingId.value = poi.id
    const projectId = activeProjectId.value
    if (projectId && poiRepository.apiEnabled) void createRemote(projectId, poi)
    return poi
  }

  function update(id: string, patch: Partial<Poi>): void {
    const base = byId.value.get(id)
    if (!base) return
    custom.value = { ...custom.value, [id]: { ...base, ...patch, id } }
    scheduleRemoteUpdate(id)
  }

  function remove(id: string): void {
    const { [id]: _dropped, ...rest } = custom.value
    custom.value = rest
    if (DEFAULT_POIS.some((d) => d.id === id) && !removed.value.includes(id)) {
      removed.value = [...removed.value, id]
    }
    if (activeId.value === id) activeId.value = null
    if (editingId.value === id) editingId.value = null
    const projectId = activeProjectId.value
    if (projectId && poiRepository.apiEnabled) {
      if (id.startsWith('poi-')) deletedTemporaryIds.add(id)
      else void poiRepository.remove(projectId, id).catch((error) => setSyncError(error))
    }
  }

  /** 清掉所有使用者變更，回到資料檔的預設清單 */
  function resetAll(): void {
    const projectId = activeProjectId.value
    const remoteIds = Object.keys(custom.value).filter((id) => !id.startsWith('poi-'))
    custom.value = {}
    removed.value = []
    activeId.value = null
    editingId.value = null
    if (projectId && poiRepository.apiEnabled && remoteIds.length) {
      syncState.value = 'saving'
      syncMessage.value = '正在清除專案標記…'
      void Promise.all(remoteIds.map((id) => poiRepository.remove(projectId, id)))
        .then(() => { syncState.value = 'synced'; syncMessage.value = '專案標記已清除' })
        .catch((error) => setSyncError(error))
    }
  }

  function save(projectId: string | null = activeProjectId.value): void {
    try {
      localStorage.setItem(
        storageKey(projectId),
        JSON.stringify({ custom: custom.value, removed: removed.value } satisfies Persisted),
      )
    } catch {
      // 存不了不影響操作，只是重整後不保留
    }
  }

  /** 切換專案時載入該專案自己的 3D 標記，並關閉前一個專案的編輯狀態。 */
  function loadProject(projectId: string): void {
    save()
    activeProjectId.value = projectId
    const projectSaved = load(projectId)
    custom.value = projectSaved.custom
    removed.value = projectSaved.removed
    editMode.value = false
    activeId.value = null
    editingId.value = null
    const generation = ++loadGeneration
    if (poiRepository.apiEnabled) void loadRemote(projectId, generation)
    else {
      syncState.value = 'local'
      syncMessage.value = '本機標記'
    }
  }

  async function loadRemote(projectId: string, generation: number) {
    syncState.value = 'loading'
    syncMessage.value = '載入專案標記…'
    try {
      let remote = await poiRepository.list(projectId)
      if (generation !== loadGeneration || activeProjectId.value !== projectId) return
      const localPois = Object.values(custom.value)
      if (!remote.length && localPois.length) {
        syncMessage.value = `正在移轉 ${localPois.length} 個本機標記…`
        remote = await Promise.all(localPois.map(({ id: _id, ...poi }) => poiRepository.create(projectId, poi)))
        if (generation !== loadGeneration || activeProjectId.value !== projectId) return
      }
      custom.value = Object.fromEntries(remote.map((poi) => [poi.id, poi]))
      removed.value = []
      syncState.value = 'synced'
      syncMessage.value = `已同步 ${remote.length} 個標記`
    } catch (error) {
      if (generation === loadGeneration && activeProjectId.value === projectId) setSyncError(error)
    }
  }

  async function createRemote(projectId: string, temporary: Poi) {
    syncState.value = 'saving'
    syncMessage.value = '新增標記同步中…'
    try {
      const { id: temporaryId, ...payload } = temporary
      const created = await poiRepository.create(projectId, payload)
      if (deletedTemporaryIds.delete(temporaryId)) {
        await poiRepository.remove(projectId, created.id)
        return
      }
      if (activeProjectId.value !== projectId) return
      const latest = custom.value[temporaryId]
      if (!latest) return
      const { [temporaryId]: _removed, ...rest } = custom.value
      const merged: Poi = { ...created, ...latest, id: created.id }
      custom.value = { ...rest, [created.id]: merged }
      if (activeId.value === temporaryId) activeId.value = created.id
      if (editingId.value === temporaryId) editingId.value = created.id
      await poiRepository.update(projectId, created.id, merged)
      syncState.value = 'synced'
      syncMessage.value = `已同步 ${pois.value.length} 個標記`
    } catch (error) {
      setSyncError(error)
    }
  }

  function scheduleRemoteUpdate(id: string) {
    const projectId = activeProjectId.value
    if (!projectId || !poiRepository.apiEnabled || id.startsWith('poi-')) return
    const previous = updateTimers.get(id)
    if (previous) clearTimeout(previous)
    syncState.value = 'saving'
    syncMessage.value = '儲存標記…'
    updateTimers.set(id, setTimeout(() => {
      updateTimers.delete(id)
      const poi = custom.value[id]
      if (!poi || activeProjectId.value !== projectId) return
      void poiRepository.update(projectId, id, poi)
        .then((updated) => {
          if (activeProjectId.value !== projectId || !custom.value[id]) return
          custom.value = { ...custom.value, [id]: updated }
          syncState.value = 'synced'
          syncMessage.value = `已同步 ${pois.value.length} 個標記`
        })
        .catch((error) => setSyncError(error))
    }, 500))
  }

  function setSyncError(error: unknown) {
    syncState.value = 'error'
    syncMessage.value = error instanceof Error ? `標記同步失敗：${error.message}` : '標記同步失敗'
  }

  watch(
    [custom, removed],
    () => {
      save()
    },
    { deep: true },
  )

  return {
    pois,
    byId,
    countByPart,
    editMode,
    activeId,
    editingId,
    activeProjectId,
    syncState,
    syncMessage,
    add,
    update,
    remove,
    resetAll,
    loadProject,
  }
})
