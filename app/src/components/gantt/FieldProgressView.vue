<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { apiHeaders, apiRequest } from '@/lib/apiClient'
import { usePermission } from '@/lib/permissions'

interface Worker { id: string; displayName: string; email: string; crewName: string }
interface FieldTask {
  id: string
  stableKey: string
  code: string
  name: string
  phase: string
  progressPct: number
  assignees: { userId: string; displayName: string }[]
  latestReport: null | {
    id: string
    progressPct: number
    note: string
    reporterName: string | null
    dataDate: string
    createdAt: string
    confirmed: boolean
  }
}
interface FieldWork { workers: Worker[]; tasks: FieldTask[] }
interface Draft { progressPct: number; actualHours: string; note: string }

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ changed: [] }>()
const can = usePermission()
const data = ref<FieldWork>({ workers: [], tasks: [] })
const loading = ref(false)
const busyId = ref<string | null>(null)
const error = ref('')
const message = ref('')
const expandedId = ref<string | null>(null)
const drafts = ref<Record<string, Draft>>({})
const pendingCount = computed(() => data.value.tasks.filter((task) => task.latestReport && !task.latestReport.confirmed).length)

function draft(task: FieldTask) {
  return drafts.value[task.id] ??= { progressPct: task.progressPct, actualHours: '', note: '' }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await apiRequest<FieldWork>(`/projects/${props.projectId}/field-work`, { headers: await apiHeaders() })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '無法讀取現場工項'
  } finally {
    loading.value = false
  }
}

async function assign(task: FieldTask, userId: string) {
  if (!can('labor.dispatch')) return
  busyId.value = task.id
  error.value = ''
  try {
    data.value = await apiRequest<FieldWork>(`/projects/${props.projectId}/tasks/${task.id}/assignments`, {
      method: 'PUT', headers: await apiHeaders(), body: JSON.stringify({ userIds: userId ? [userId] : [] }),
    })
    message.value = userId ? '已更新負責人員' : '已取消工項指派'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '工項指派失敗'
  } finally {
    busyId.value = null
  }
}

async function report(task: FieldTask) {
  if (!can('progress.report')) return
  busyId.value = task.id
  error.value = ''
  const value = draft(task)
  try {
    await apiRequest(`/projects/${props.projectId}/tasks/${task.id}/progress-reports`, {
      method: 'POST', headers: await apiHeaders(), body: JSON.stringify({
        progressPct: Number(value.progressPct),
        note: value.note.trim(),
        ...(can('labor.report') && value.actualHours !== '' ? { actualHours: Number(value.actualHours) } : {}),
      }),
    })
    value.note = ''
    value.actualHours = ''
    message.value = '現場回報已送出，等待 Manager 確認'
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '進度回報失敗'
  } finally {
    busyId.value = null
  }
}

async function confirm(task: FieldTask) {
  const reportId = task.latestReport?.id
  if (!reportId || !can('progress.verify')) return
  busyId.value = task.id
  error.value = ''
  try {
    await apiRequest(`/projects/${props.projectId}/progress-reports/${reportId}/confirm`, {
      method: 'POST', headers: await apiHeaders(),
    })
    message.value = '回報已確認並更新正式 WBS 進度'
    await load()
    emit('changed')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '確認回報失敗'
  } finally {
    busyId.value = null
  }
}

watch(() => props.projectId, () => { drafts.value = {}; void load() })
onMounted(() => { void load() })
</script>

<template>
  <section class="field-work">
    <header>
      <div><h2>工項指派與現場回報</h2><p>Worker 回報後由 Manager 確認，才會更新正式 WBS 與總體進度。</p></div>
      <div class="summary"><span>{{ data.tasks.length }} 項可見工項</span><b v-if="pendingCount">{{ pendingCount }} 項待確認</b></div>
    </header>
    <div v-if="error || message" class="notice" :class="{ error: error }">{{ error || message }}</div>
    <div class="table-head row"><span>WBS</span><span>工項</span><span>正式進度</span><span>負責 Worker</span><span>最新回報</span></div>
    <div v-if="loading" class="empty">讀取現場工作…</div>
    <div v-else-if="!data.tasks.length" class="empty">目前沒有可回報的工項；Worker 必須先被指派工項。</div>
    <div v-else class="task-list">
      <template v-for="task in data.tasks" :key="task.id">
        <button class="task row" :class="{ open: expandedId === task.id }" @click="expandedId = expandedId === task.id ? null : task.id">
          <b>{{ task.code }}</b><strong>{{ task.name }}</strong><span>{{ task.progressPct }}%</span>
          <span @click.stop>
            <select
              v-if="can('labor.dispatch')"
              :value="task.assignees[0]?.userId ?? ''"
              :disabled="busyId === task.id"
              :aria-label="`${task.name} 負責 Worker`"
              @change="assign(task, ($event.target as HTMLSelectElement).value)"
            ><option value="">尚未指派</option><option v-for="worker in data.workers" :key="worker.id" :value="worker.id">{{ worker.displayName }}{{ worker.crewName ? ` · ${worker.crewName}` : '' }}</option></select>
            <template v-else>{{ task.assignees.map((item) => item.displayName).join('、') || '尚未指派' }}</template>
          </span>
          <span v-if="task.latestReport" :class="task.latestReport.confirmed ? 'confirmed' : 'pending'">{{ task.latestReport.progressPct }}% · {{ task.latestReport.confirmed ? '已確認' : '待確認' }}</span><span v-else>尚無回報</span>
        </button>
        <div v-if="expandedId === task.id" class="editor">
          <section v-if="task.latestReport" class="latest">
            <h3>最新回報</h3><b>{{ task.latestReport.reporterName || '現場人員' }} · {{ task.latestReport.dataDate }} · {{ task.latestReport.progressPct }}%</b>
            <p>{{ task.latestReport.note || '未填寫現場說明' }}</p>
            <button v-if="can('progress.verify') && !task.latestReport.confirmed" type="button" :disabled="busyId === task.id" @click="confirm(task)">確認並更新正式進度</button>
          </section>
          <section v-if="can('progress.report')" class="report">
            <h3>新增現場回報</h3>
            <label>完成度 %<input v-model.number="draft(task).progressPct" type="number" min="0" max="100" step="5" /></label>
            <label v-if="can('labor.report')">實際人工時<input v-model="draft(task).actualHours" type="number" min="0" step="0.5" placeholder="選填" /></label>
            <label class="note">現場說明<textarea v-model="draft(task).note" rows="2" maxlength="2000" placeholder="已完成內容、問題或下一步…" /></label>
            <button type="button" :disabled="busyId === task.id" @click="report(task)">送出回報</button>
          </section>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.field-work{display:flex;flex-direction:column;height:100%;min-height:0;background:#1d2225}.field-work>header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:13px 16px;border-bottom:1px solid var(--line)}h2{margin:0;font-size:15px}header p{margin:3px 0 0;color:var(--muted);font-size:10px}.summary{display:flex;gap:7px;align-items:center;color:var(--muted);font-size:10px}.summary b{padding:3px 7px;border-radius:99px;background:#f59e0b22;color:#fbbf24}.notice{padding:6px 14px;border-bottom:1px solid #22c55e44;background:#22c55e10;color:#75e0ae;font-size:10px}.notice.error{border-color:#ef444455;background:#ef444412;color:#ff9a9a}.row{display:grid;grid-template-columns:65px minmax(220px,1fr) 80px minmax(145px,190px) 120px;align-items:center;gap:9px}.table-head{padding:7px 14px;border-bottom:1px solid var(--line);color:var(--muted);font-size:9px}.task-list{min-height:0;overflow:auto}.task{width:100%;padding:8px 14px;border:0;border-bottom:1px solid #ffffff0b;border-radius:0;background:transparent;text-align:left}.task:hover,.task.open{background:#ffad7a0d}.task>b{color:var(--accent);font-size:10px}.task>strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.task>span{color:var(--muted);font-size:10px}.task select{width:100%;padding:4px 5px;border:1px solid var(--line);border-radius:5px;background:#252c30;color:var(--text);font-size:9px}.pending{color:#fbbf24!important}.confirmed{color:#6ee7b7!important}.editor{display:grid;grid-template-columns:minmax(240px,.8fr) minmax(380px,1.2fr);gap:10px;padding:11px 18px 13px 88px;border-bottom:1px solid #516069;background:#1b2022}.editor section{padding:11px;border:1px solid var(--line);border-radius:7px;background:#252b2f}.editor h3{margin:0 0 8px;color:var(--accent);font-size:11px}.latest b{font-size:10px}.latest p{min-height:28px;margin:6px 0 9px;color:var(--muted);font-size:10px;white-space:pre-wrap}.latest button,.report button{border-color:#ffad7a66;color:var(--accent);font-size:10px}.report{display:grid;grid-template-columns:110px 120px 1fr auto;align-items:end;gap:8px}.report h3{grid-column:1/-1}.report label{display:grid;gap:4px;color:var(--muted);font-size:9px}.report input,.report textarea{width:100%;box-sizing:border-box;padding:6px;border:1px solid var(--line);border-radius:5px;background:#1e2326;color:var(--text);font:inherit}.empty{padding:38px;color:var(--muted);text-align:center}@media(max-width:900px){.row{grid-template-columns:55px minmax(180px,1fr) 70px 130px 100px}.editor{grid-template-columns:1fr;padding-left:58px}.report{grid-template-columns:1fr 1fr}.report .note{grid-column:1/-1}}
</style>
