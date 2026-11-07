<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { apiRequest } from '@/lib/apiClient'

interface AuditItem {
  id: number
  projectId: string | null
  projectCode: string | null
  projectName: string | null
  actorUserId: string | null
  actorName: string | null
  actorEmail: string | null
  action: string
  resourceType: string
  resourceId: string | null
  beforeData: unknown
  afterData: unknown
  requestId: string | null
  ipAddress: string | null
  createdAt: string
}
interface AuditResponse {
  items: AuditItem[]
  nextCursor: number | null
  filters: { actions: { action: string }[]; total: number }
}

const items = ref<AuditItem[]>([])
const actions = ref<string[]>([])
const total = ref(0)
const nextCursor = ref<number | null>(null)
const loading = ref(false)
const error = ref('')
const selected = ref<AuditItem | null>(null)
const filters = ref({ q: '', action: '', from: '', to: '' })
const visibleProjects = computed(() => [...new Map(items.value.filter((item) => item.projectId).map((item) => [item.projectId, { id: item.projectId!, label: `${item.projectCode ?? ''} ${item.projectName ?? ''}`.trim() }])).values()])
const projectId = ref('')

const actionLabel = (action: string) => ({
  'project.created': '建立專案', 'project.updated': '更新專案', 'project.archived': '封存專案',
  'project.restored': '還原專案', 'account.created': '建立帳號', 'account.updated': '更新帳號',
  'account.permissions.updated': '更新權限', 'wbs.created': '建立 WBS', 'wbs.updated': '更新 WBS',
  'progress.reported': '回報進度', 'progress.confirmed': '確認進度', 'labor.entry.reported': '回報人工時',
  'daily_report.created': '建立施工日報', 'daily_report.approved': '核准施工日報',
  'daily_report.rejected': '退回施工日報', 'crew.dispatch.created': '建立派工',
  'crew.dispatch.updated': '更新派工', 'model.template.applied': '套用 3D 範本',
}[action] ?? action)

function queryString(cursor?: number | null) {
  const params = new URLSearchParams({ limit: '30' })
  if (filters.value.q.trim()) params.set('q', filters.value.q.trim())
  if (filters.value.action) params.set('action', filters.value.action)
  if (filters.value.from) params.set('from', filters.value.from)
  if (filters.value.to) params.set('to', filters.value.to)
  if (projectId.value) params.set('projectId', projectId.value)
  if (cursor) params.set('before', String(cursor))
  return params.toString()
}

async function load(append = false) {
  loading.value = true
  error.value = ''
  try {
    const result = await apiRequest<AuditResponse>(`/audit-logs?${queryString(append ? nextCursor.value : null)}`)
    items.value = append ? [...items.value, ...result.items] : result.items
    nextCursor.value = result.nextCursor
    total.value = result.filters.total
    actions.value = result.filters.actions.map((item) => item.action)
    if (!append) selected.value = result.items[0] ?? null
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '無法讀取操作紀錄'
  } finally {
    loading.value = false
  }
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function exportCsv() {
  const rows = [['時間', '操作者', 'Email', '專案', '動作', '資源類型', '資源 ID', 'Request ID'], ...items.value.map((item) => [
    new Date(item.createdAt).toLocaleString('zh-TW'), item.actorName ?? '', item.actorEmail ?? '',
    item.projectCode ?? '', actionLabel(item.action), item.resourceType, item.resourceId ?? '', item.requestId ?? '',
  ])]
  const blob = new Blob([`\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `PacificPower操作紀錄_${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

onMounted(() => load())
</script>

<template>
  <section class="audit-view">
    <header class="audit-view__head"><div><span>AUDIT TRAIL</span><h2>操作稽核中心</h2><p>追蹤帳號、專案、WBS、人工時、日報、派工與模型異動。</p></div><div><small>共 {{ total }} 筆紀錄</small><button type="button" :disabled="!items.length" @click="exportCsv">匯出 CSV</button></div></header>
    <form class="audit-filters" @submit.prevent="load(false)"><input v-model="filters.q" placeholder="搜尋操作者、專案、動作或資源 ID" /><select v-model="filters.action"><option value="">全部動作</option><option v-for="action in actions" :key="action" :value="action">{{ actionLabel(action) }}</option></select><select v-model="projectId"><option value="">全部專案</option><option v-for="project in visibleProjects" :key="project.id" :value="project.id">{{ project.label }}</option></select><input v-model="filters.from" type="date" aria-label="開始日期" /><input v-model="filters.to" type="date" aria-label="結束日期" /><button type="submit" :disabled="loading">{{ loading ? '查詢中…' : '查詢' }}</button></form>
    <p v-if="error" class="audit-error">{{ error }}</p>
    <div class="audit-workspace">
      <div class="audit-list"><button v-for="item in items" :key="item.id" type="button" :class="{ active: selected?.id === item.id }" @click="selected = item"><time>{{ new Date(item.createdAt).toLocaleString('zh-TW') }}</time><strong>{{ actionLabel(item.action) }}</strong><span>{{ item.actorName || item.actorEmail || '系統' }} · {{ item.projectCode || '組織層級' }}</span><small>{{ item.resourceType }} · {{ item.resourceId || '—' }}</small></button><div v-if="!loading && !items.length" class="empty">查無符合條件的操作紀錄</div><button v-if="nextCursor" class="more" type="button" :disabled="loading" @click="load(true)">載入更多</button></div>
      <article v-if="selected" class="audit-detail"><header><span>{{ selected.action }}</span><h3>{{ actionLabel(selected.action) }}</h3><time>{{ new Date(selected.createdAt).toLocaleString('zh-TW') }}</time></header><dl><div><dt>操作者</dt><dd>{{ selected.actorName || '系統' }}<small>{{ selected.actorEmail }}</small></dd></div><div><dt>專案</dt><dd>{{ selected.projectCode || '組織層級' }}<small>{{ selected.projectName }}</small></dd></div><div><dt>資源</dt><dd>{{ selected.resourceType }}<small>{{ selected.resourceId }}</small></dd></div><div><dt>追蹤編號</dt><dd>{{ selected.requestId || '—' }}<small>{{ selected.ipAddress || '' }}</small></dd></div></dl><section><h4>異動前</h4><pre>{{ selected.beforeData ? JSON.stringify(selected.beforeData, null, 2) : '無前置資料' }}</pre></section><section><h4>異動後</h4><pre>{{ selected.afterData ? JSON.stringify(selected.afterData, null, 2) : '無異動資料' }}</pre></section></article>
      <div v-else class="audit-detail empty">請選擇一筆紀錄查看詳細差異</div>
    </div>
  </section>
</template>

<style scoped>
.audit-view{margin-top:25px}.audit-view__head{display:flex;align-items:flex-end;justify-content:space-between;padding:18px 20px;border:1px solid #414e55;border-radius:12px 12px 0 0;background:#272e32}.audit-view__head span{color:#ffad7a;font-size:8px;letter-spacing:.16em}.audit-view__head h2{margin:4px 0;font-size:20px}.audit-view__head p{margin:0;color:#9aa9b2;font-size:10px}.audit-view__head>div:last-child{display:flex;align-items:center;gap:10px}.audit-view__head small{color:#95a4ad}.audit-view__head button{border-color:#5e6f79;color:#ffad7a}.audit-filters{display:grid;grid-template-columns:minmax(220px,1.4fr) 190px 180px 135px 135px 72px;gap:7px;padding:12px;border:1px solid #414e55;border-top:0;background:#21282b}.audit-filters input,.audit-filters select{min-width:0;height:36px;padding:0 9px;border:1px solid #48555d;border-radius:6px;background:#1c2124;color:#dfe9f5}.audit-filters button{background:#ffad7a;color:#1b2022;font-weight:700}.audit-error{margin:0;padding:10px 14px;background:#53202c;color:#fca5a5}.audit-workspace{display:grid;grid-template-columns:minmax(330px,.85fr) minmax(420px,1.15fr);min-height:540px;border:1px solid #414e55;border-top:0;border-radius:0 0 12px 12px;overflow:hidden}.audit-list{max-height:650px;overflow:auto;border-right:1px solid #414e55;background:#1e2428}.audit-list>button{width:100%;display:grid;gap:3px;padding:12px 14px;border:0;border-bottom:1px solid #384349;border-radius:0;background:transparent;text-align:left}.audit-list>button:hover,.audit-list>button.active{background:#2f373c;color:inherit}.audit-list>button.active{box-shadow:inset 3px 0 #ffad7a}.audit-list time{color:#8798a2;font-size:8px}.audit-list strong{font-size:10px}.audit-list span{color:#b5c0c6;font-size:8px}.audit-list small{color:#738894;font-size:7px}.audit-list .more{padding:12px;text-align:center;color:#ffad7a}.empty{padding:40px;color:#8597a1;text-align:center}.audit-detail{padding:20px;overflow:auto;background:#21282b}.audit-detail header{position:relative;padding-bottom:13px;border-bottom:1px solid #435057}.audit-detail header span{color:#ffad7a;font-size:8px}.audit-detail h3{margin:4px 0;font-size:18px}.audit-detail header time{position:absolute;right:0;top:4px;color:#8597a1;font-size:8px}.audit-detail dl{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.audit-detail dl div{padding:9px;border:1px solid #3e4a51;border-radius:6px}.audit-detail dt{color:#80939e;font-size:7px}.audit-detail dd{margin:3px 0 0;font-size:9px}.audit-detail dd small{display:block;margin-top:2px;color:#8597a1;font-size:7px}.audit-detail section{margin-top:10px}.audit-detail h4{margin:0 0 5px;color:#ffad7a;font-size:8px}.audit-detail pre{max-height:230px;margin:0;padding:10px;overflow:auto;border:1px solid #3c474e;border-radius:7px;background:#1a1e21;color:#b9c8d7;font:8px/1.55 ui-monospace,monospace;white-space:pre-wrap}@media(max-width:1100px){.audit-filters{grid-template-columns:1fr 1fr 1fr}.audit-workspace{grid-template-columns:1fr}.audit-list{max-height:340px;border-right:0;border-bottom:1px solid #414e55}}@media(max-width:700px){.audit-view__head{align-items:flex-start;flex-direction:column;gap:12px}.audit-filters{grid-template-columns:1fr}.audit-detail dl{grid-template-columns:1fr}}
</style>
