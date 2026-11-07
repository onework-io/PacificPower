<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { API_BASE_URL, apiHeaders, apiRequest } from '@/lib/apiClient'
import { usePermission } from '@/lib/permissions'
import { wbsRepository, type ApiWbsTask } from '@/lib/wbsRepository'
import { useViewerStore } from '@/stores/viewer'
import { PARTS } from '@/data/parts'
import { useScheduleStore } from '@/stores/schedule'

interface ModelPart {
  id: string
  modelVersionId: string
  projectId: string
  taskId: string | null
  partKey: string
  name: string
  groupName: string
  kind: string
  byteSize: number
}

interface ActiveModelResponse {
  projectId: string
  activeVersion: { id: string; versionNumber: number; status: string } | null
  parts: ModelPart[]
}

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ changed: [] }>()
const can = usePermission()
const viewer = useViewerStore()
const schedule = useScheduleStore()
const mappingEditable = computed(() => Boolean(API_BASE_URL) && can('model.mapping.edit'))
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const model = ref<ActiveModelResponse | null>(null)
const tasks = ref<Array<Pick<ApiWbsTask, 'id' | 'code' | 'name'>>>([])
const mapping = ref<Record<string, string | null>>({})
const baseline = ref<Record<string, string | null>>({})
const selected = ref(new Set<string>())
const query = ref('')
const group = ref('all')
const mappingFilter = ref<'all' | 'mapped' | 'unmapped'>('all')
const batchTaskId = ref('')

const groups = computed(() => [...new Set((model.value?.parts ?? []).map((part) => part.groupName || '未分類'))])
const taskById = computed(() => new Map(tasks.value.map((task) => [task.id, task])))
const mappedCount = computed(() => Object.values(mapping.value).filter(Boolean).length)
const dirtyIds = computed(() => (model.value?.parts ?? [])
  .filter((part) => mapping.value[part.id] !== baseline.value[part.id])
  .map((part) => part.id))
const filteredParts = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase('zh-TW')
  return (model.value?.parts ?? []).filter((part) => {
    const isMapped = Boolean(mapping.value[part.id])
    if (group.value !== 'all' && (part.groupName || '未分類') !== group.value) return false
    if (mappingFilter.value === 'mapped' && !isMapped) return false
    if (mappingFilter.value === 'unmapped' && isMapped) return false
    if (!keyword) return true
    const task = mapping.value[part.id] ? taskById.value.get(mapping.value[part.id]!) : undefined
    return `${part.name} ${part.partKey} ${part.groupName} ${task?.code ?? ''} ${task?.name ?? ''}`
      .toLocaleLowerCase('zh-TW').includes(keyword)
  })
})
const allVisibleSelected = computed(() => filteredParts.value.length > 0
  && filteredParts.value.every((part) => selected.value.has(part.id)))

function setSelected(partId: string, checked: boolean) {
  const next = new Set(selected.value)
  if (checked) next.add(partId)
  else next.delete(partId)
  selected.value = next
}

function selectVisible() {
  const next = new Set(selected.value)
  if (allVisibleSelected.value) filteredParts.value.forEach((part) => next.delete(part.id))
  else filteredParts.value.forEach((part) => next.add(part.id))
  selected.value = next
}

function applyBatch(taskId: string | null) {
  if (!selected.value.size || !mappingEditable.value) return
  mapping.value = { ...mapping.value }
  for (const partId of selected.value) mapping.value[partId] = taskId
  message.value = `已調整 ${selected.value.size} 個元件，請按「儲存對應」完成同步。`
}

function focusPart(part: ModelPart) {
  viewer.showAll()
  viewer.highlightedIds = new Set([part.partKey])
  viewer.isolatedId = part.partKey
  viewer.requestFreeFocus(part.partKey)
}

async function load() {
  if (!API_BASE_URL) {
    tasks.value = schedule.rows.map(row => ({ id: row.step.id, code: row.wbs, name: row.step.name }))
    model.value = {
      projectId: props.projectId,
      activeVersion: { id: 'dc250-concept-v1', versionNumber: 1, status: '本機概念模型' },
      parts: PARTS.map(part => ({ id: part.id, modelVersionId: 'dc250-concept-v1', projectId: props.projectId,
        taskId: part.installStepId ?? null, partKey: part.id, name: part.name, groupName: part.group,
        kind: part.kind, byteSize: part.bytes })),
    }
    mapping.value = Object.fromEntries(model.value.parts.map(part => [part.id, part.taskId]))
    baseline.value = { ...mapping.value }
    selected.value = new Set()
    message.value = '本機模型對應：可篩選、檢視與定位 3D。修改並保存對應需設定獨立 PacificPower 後端。'
    return
  }
  loading.value = true
  message.value = ''
  try {
    const [modelData, wbsData] = await Promise.all([
      apiRequest<ActiveModelResponse>(`/projects/${props.projectId}/models/active`, { headers: await apiHeaders() }),
      wbsRepository.load(props.projectId),
    ])
    model.value = modelData
    tasks.value = wbsData?.tasks ?? []
    const next = Object.fromEntries(modelData.parts.map((part) => [part.id, part.taskId]))
    mapping.value = next
    baseline.value = { ...next }
    selected.value = new Set()
  } catch (error) {
    message.value = error instanceof Error ? error.message : '無法載入 3D 對應資料'
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!dirtyIds.value.length || !mappingEditable.value) return
  saving.value = true
  message.value = ''
  try {
    const result = await apiRequest<ActiveModelResponse>(`/projects/${props.projectId}/models/active/part-mappings`, {
      method: 'PUT',
      headers: await apiHeaders(),
      body: JSON.stringify({ mappings: dirtyIds.value.map((partId) => ({ partId, taskId: mapping.value[partId] ?? null })) }),
    })
    model.value = result
    const next = Object.fromEntries(result.parts.map((part) => [part.id, part.taskId]))
    mapping.value = next
    baseline.value = { ...next }
    selected.value = new Set()
    message.value = '3D 元件與 WBS 對應已同步，甘特圖的 3D 亮顯也已更新。'
    emit('changed')
  } catch (error) {
    message.value = error instanceof Error ? error.message : '儲存對應失敗'
  } finally {
    saving.value = false
  }
}

watch(() => props.projectId, () => { void load() })
onMounted(() => { void load() })
</script>

<template>
  <section class="mapping-view">
    <header class="mapping-head">
      <div><small>MODEL × WBS COORDINATION</small><h2>3D 元件對應管理</h2><p>管理目前模型元件與施工工項的關聯，並檢查尚未對應的構件。</p></div>
      <div class="head-actions"><button type="button" :disabled="loading" @click="load">↻ 重新整理</button><button v-if="mappingEditable" class="save" type="button" :disabled="saving || !dirtyIds.length" @click="save">{{ saving ? '儲存中…' : `儲存對應${dirtyIds.length ? ` (${dirtyIds.length})` : ''}` }}</button></div>
    </header>

    <div class="metrics">
      <article><span>模型版本</span><strong>{{ model?.activeVersion ? `V${model.activeVersion.versionNumber}` : '—' }}</strong><small>{{ model?.activeVersion?.status ?? '尚未套用模型' }}</small></article>
      <article><span>3D 元件</span><strong>{{ model?.parts.length ?? 0 }}</strong><small>目前作用中版本</small></article>
      <article><span>已對應</span><strong>{{ mappedCount }}</strong><small>可由 WBS 定位 3D</small></article>
      <article :class="{ warning: (model?.parts.length ?? 0) - mappedCount > 0 }"><span>未對應</span><strong>{{ (model?.parts.length ?? 0) - mappedCount }}</strong><small>建議發布前完成確認</small></article>
    </div>

    <p v-if="message" class="message">{{ message }}</p>
    <div v-if="model?.activeVersion" class="toolbar">
      <input v-model="query" type="search" placeholder="搜尋元件、群組或 WBS…" />
      <select v-model="group"><option value="all">全部群組</option><option v-for="item in groups" :key="item" :value="item">{{ item }}</option></select>
      <select v-model="mappingFilter"><option value="all">全部狀態</option><option value="mapped">已對應</option><option value="unmapped">未對應</option></select>
    </div>

    <div v-if="model?.activeVersion && mappingEditable" class="batch-bar">
      <label><input type="checkbox" :checked="allVisibleSelected" @change="selectVisible" /> 選取目前列表</label>
      <span>已選 {{ selected.size }} 個元件</span>
      <select v-model="batchTaskId" :disabled="!selected.size"><option value="">選擇要批次對應的 WBS</option><option v-for="task in tasks" :key="task.id" :value="task.id">{{ task.code }} · {{ task.name }}</option></select>
      <button type="button" :disabled="!selected.size || !batchTaskId" @click="applyBatch(batchTaskId)">套用工項</button>
      <button class="unlink" type="button" :disabled="!selected.size" @click="applyBatch(null)">解除對應</button>
    </div>

    <div v-if="loading" class="state">正在載入模型與 WBS…</div>
    <div v-else-if="!model?.activeVersion" class="state"><strong>此專案尚未套用 3D 模型</strong><span>請先在專案設定套用 PacificPower 資料中心模型。</span></div>
    <div v-else class="mapping-table">
      <div class="mapping-row mapping-row--head"><span></span><span>3D 元件</span><span>群組</span><span>對應 WBS 工項</span><span>狀態</span><span></span></div>
      <div v-for="part in filteredParts" :key="part.id" class="mapping-row" :class="{ dirty: mapping[part.id] !== baseline[part.id] }">
        <input type="checkbox" :checked="selected.has(part.id)" @change="setSelected(part.id, ($event.target as HTMLInputElement).checked)" />
        <span class="part-name"><strong>{{ part.name }}</strong><small>{{ part.partKey }}</small></span>
        <span>{{ part.groupName || '未分類' }}</span>
        <select :value="mapping[part.id] ?? ''" :disabled="!mappingEditable" @change="mapping = { ...mapping, [part.id]: ($event.target as HTMLSelectElement).value || null }"><option value="">尚未對應</option><option v-for="task in tasks" :key="task.id" :value="task.id">{{ task.code }} · {{ task.name }}</option></select>
        <b :class="mapping[part.id] ? 'mapped' : 'unmapped'">{{ mapping[part.id] ? '已對應' : '未對應' }}</b>
        <button type="button" title="在 3D 中查看" @click="focusPart(part)">3D 查看</button>
      </div>
      <div v-if="!filteredParts.length" class="state">沒有符合篩選條件的元件。</div>
    </div>
  </section>
</template>

<style scoped>
.mapping-view{height:100%;overflow:auto;padding:18px;color:var(--text)}
.mapping-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px}.mapping-head small{color:#ffad7a;font-size:8px;letter-spacing:.16em}.mapping-head h2{margin:3px 0;font-size:20px}.mapping-head p{margin:0;color:#8a9ba5;font-size:9px}.head-actions{display:flex;gap:8px}.head-actions button{padding:7px 10px}.head-actions .save{border-color:#ffad7a;background:#ffad7a;color:#1a1f22;font-weight:700}.head-actions button:disabled{opacity:.45;cursor:not-allowed}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.metrics article{padding:13px 15px;border:1px solid #414d54;border-radius:9px;background:#21272b}.metrics span,.metrics strong,.metrics small{display:block}.metrics span{color:#899aa4;font-size:8px}.metrics strong{margin:4px 0 1px;font-size:20px}.metrics small{color:#687c87;font-size:7px}.metrics .warning strong{color:#fbbf24}
.message{margin:0 0 12px;padding:8px 11px;border-left:2px solid #ffad7a;background:#ffad7a0b;color:#ffad7a;font-size:8px}.toolbar,.batch-bar{display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #414d54;background:#1f2529}.toolbar{border-radius:9px 9px 0 0}.toolbar input{flex:1}.toolbar input,.toolbar select,.batch-bar select,.mapping-row select{padding:7px 8px;border:1px solid #48565e;border-radius:6px;background:#1b2124;color:#dfe9f5;font:inherit}.batch-bar{border-top:0;color:#98a7b0;font-size:8px}.batch-bar label{display:flex;align-items:center;gap:5px}.batch-bar span{white-space:nowrap}.batch-bar select{flex:1}.batch-bar button{padding:6px 9px;border-color:#5a6c75;color:#ffad7a}.batch-bar .unlink{border-color:#70404a;color:#fda4af}.batch-bar button:disabled{opacity:.4}
.mapping-table{border:1px solid #414d54;border-top:0;border-radius:0 0 9px 9px;overflow:auto}.mapping-row{min-width:900px;display:grid;grid-template-columns:24px minmax(180px,1.3fr) .65fr minmax(300px,1.7fr) 65px 72px;align-items:center;gap:10px;padding:9px 12px;border-top:1px solid #3a454b;background:#1e2427;font-size:8px}.mapping-row--head{position:sticky;z-index:2;top:0;border-top:0;background:#293135;color:#798d98;font-size:7px}.mapping-row.dirty{background:#333d42}.part-name strong,.part-name small{display:block}.part-name strong{font-size:9px}.part-name small{margin-top:2px;color:#748894;font-size:7px}.mapping-row>b{width:max-content;padding:3px 6px;border-radius:99px;font-size:7px}.mapping-row>b.mapped{background:#14532d;color:#bbf7d0}.mapping-row>b.unmapped{background:#713f12;color:#fde68a}.mapping-row>button{padding:5px 7px;color:#ffad7a;font-size:7px}.state{min-height:150px;display:grid;place-content:center;justify-items:center;gap:5px;padding:25px;color:#8496a0;font-size:9px;text-align:center}.state strong{color:#d8e4f1;font-size:12px}
@media(max-width:900px){.metrics{grid-template-columns:1fr 1fr}.mapping-head{align-items:flex-start;flex-direction:column}.batch-bar{align-items:stretch;flex-wrap:wrap}.batch-bar select{flex-basis:100%}}
</style>
