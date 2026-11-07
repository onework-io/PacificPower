<script setup lang="ts">
import { downloadConstructionTemplate } from '@/lib/constructionTemplate'
import { computed, nextTick, ref, watch } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { parseWbsXlsx } from '@/lib/wbsExcel'
import AssessmentPlanView from './AssessmentPlanView.vue'
import GanttPanel from './GanttPanel.vue'
import WbsView from './WbsView.vue'
import NetworkView from './NetworkView.vue'
import SCurveView from './SCurveView.vue'
import AiAssistantView from './AiAssistantView.vue'
import CostEstimateView from './CostEstimateView.vue'
import WbsVersionManager from './WbsVersionManager.vue'
import FieldProgressView from './FieldProgressView.vue'
import DailyReportView from './DailyReportView.vue'
import ProjectFilesView from './ProjectFilesView.vue'
import ModelMappingView from './ModelMappingView.vue'
import ProjectReportView from './ProjectReportView.vue'
import { usePermission } from '@/lib/permissions'
import type { ProjectSummary } from '@/data/projects'

type Tab = 'gantt' | 'wbs' | 'mapping' | 'network' | 'field' | 'daily' | 'files' | 'cost' | 'scurve' | 'report' | 'assistant' | 'versions'
const props = defineProps<{ projectId: string; project: ProjectSummary; projectStart?: string; initialTab?: Tab }>()
const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'gantt', label: '甘特圖', hint: '時間軸與進度模擬' },
  { key: 'wbs', label: 'WBS', hint: '工作分解結構、工作天與進度權重' },
  { key: 'mapping', label: '3D 對應', hint: '模型元件與 WBS 工項綁定、未對應檢查' },
  { key: 'network', label: '網圖', hint: 'PDM 前導圖，含要徑' },
  { key: 'field', label: '現場', hint: '工項指派、進度與人工時回報' },
  { key: 'daily', label: '日報', hint: '施工內容、照片、人工時與審核' },
  { key: 'files', label: '文件', hint: '圖說、合約、檢驗文件與專案附件' },
  { key: 'cost', label: '人工時', hint: '依 WBS 工作天與配置人數估算人工時' },
  { key: 'scurve', label: 'S 曲線', hint: '計畫值與實獲值累計進度' },
  { key: 'report', label: '總覽報表', hint: '業主與管理者唯讀進度摘要、PDF／CSV 輸出' },
  { key: 'assistant', label: 'AI 問答', hint: '上傳現場照片、詢問進度並同步 3D' },
  { key: 'versions', label: '版本', hint: 'WBS 草稿、送審、核准與發布歷程' },
]
const can = usePermission()
const visibleTabs = computed(() => TABS.filter(({ key }) => {
  if (key === 'cost') return can('labor.view') || can('labor.report')
  if (key === 'field' || key === 'daily') return can('progress.view') || can('progress.report')
  if (key === 'files') return can('project.view')
  if (key === 'mapping') return can('model.view')
  if (key === 'scurve' || key === 'report') return can('report.project.view')
  if (key === 'assistant') return can('ai.assistant.use')
  return can('wbs.view')
}))

const referenceMode = ref(true)
const tab = ref<Tab>('gantt')
const store = useScheduleStore()
const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const importStatus = ref<{ kind: 'success' | 'error'; text: string } | null>(null)
const ganttJumpId = ref<string | null>(null)

watch(visibleTabs, (tabs) => {
  if (!tabs.some((item) => item.key === tab.value) && tabs[0]) tab.value = tabs[0].key
}, { immediate: true })

watch(() => props.initialTab, (target) => {
  if (target && visibleTabs.value.some((item) => item.key === target)) tab.value = target
}, { immediate: true })

watch(
  () => [props.projectId, props.projectStart] as const,
  ([projectId, projectStart]) => { void store.loadProject(projectId, projectStart) },
  { immediate: true },
)

async function openGanttStep(stepId: string) {
  // 先清空，讓連續兩次點同一節點也能重新觸發捲動與亮顯。
  ganttJumpId.value = null
  tab.value = 'gantt'
  await nextTick()
  ganttJumpId.value = stepId
}

async function importExcel(event: Event) {
  if (!can('wbs.import')) return
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  importing.value = true
  importStatus.value = null
  try {
    if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('目前支援 .xlsx 格式，請先另存為 Excel 活頁簿')
    if (file.size > 30 * 1024 * 1024) throw new Error('Excel 檔案不可超過 30 MB')
    const workbook = parseWbsXlsx(new Uint8Array(await file.arrayBuffer()))
    const count = store.importWbsRows(workbook.rows)
    importStatus.value = {
      kind: 'success',
      text: `已從「${workbook.sheetName}」匯入 ${count} 項 WBS`,
    }
    tab.value = 'wbs'
  } catch (error) {
    importStatus.value = {
      kind: 'error',
      text: error instanceof Error ? error.message : 'Excel 匯入失敗',
    }
  } finally {
    importing.value = false
    input.value = ''
  }
}

async function reloadPublishedWbs() {
  await store.loadProject(props.projectId, props.projectStart)
}
</script>

<template>
  <div class="panel">
    <div class="source-switch"><button @click="referenceMode = !referenceMode">{{ referenceMode ? '查看舊施工假設沙盒（非文件範圍）' : '返回 PISG 文件工作範圍' }}</button><span v-if="!referenceMode">舊版未核定假設，不屬 Rev1.3-H4；不得作為正式工期或進度。</span></div>
    <AssessmentPlanView v-if="referenceMode" :project-id="projectId" />
    <template v-else>
    <nav class="panel__tabs">
      <button
        v-for="t in visibleTabs"
        :key="t.key"
        class="tab"
        :class="{ 'is-on': tab === t.key }"
        :title="t.hint"
        @click="tab = t.key"
      >
        {{ t.label }}
      </button>

      <a
        v-if="can('wbs.import')"
        class="template"
        href="#" @click.prevent="downloadConstructionTemplate"

        title="下載資料中心 WBS 範本（工期與權重待核定）"
      >
        下載範本
      </a>
      <button
        v-if="can('wbs.import')"
        class="import"
        type="button"
        title="匯入項次、施工步驟、工作天與進度權重％"
        :disabled="importing"
        @click="fileInput?.click()"
      >
        {{ importing ? '讀取中…' : '匯入 Excel' }}
      </button>
      <input
        v-if="can('wbs.import')"
        ref="fileInput"
        class="file-input"
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        @change="importExcel"
      />

      <span class="panel__spacer" />

      <span class="summary">{{ store.rows.length }} 項工項</span>
      <span class="summary">工作天 <b>{{ store.plannedWorkDays }}</b></span>
      <span class="summary">專案工期 <b>{{ store.projectDays }}</b> 天</span>
      <span class="summary sync-state" :class="`is-${store.syncState}`">{{ store.syncMessage }}</span>
    </nav>

    <div v-if="importStatus" class="import-status" :class="`is-${importStatus.kind}`">
      <span>{{ importStatus.text }}</span>
      <button type="button" aria-label="關閉匯入訊息" @click="importStatus = null">×</button>
    </div>

    <div class="panel__body">
      <GanttPanel v-show="tab === 'gantt'" :jump-to-step-id="ganttJumpId" />
      <WbsView v-if="tab === 'wbs'" />
      <ModelMappingView v-if="tab === 'mapping'" :project-id="projectId" @changed="reloadPublishedWbs" />
      <NetworkView v-if="tab === 'network'" @open-gantt="openGanttStep" />
      <FieldProgressView v-if="tab === 'field'" :project-id="projectId" @changed="reloadPublishedWbs" />
      <DailyReportView v-if="tab === 'daily'" :project-id="projectId" />
      <ProjectFilesView v-if="tab === 'files'" :project-id="projectId" />
      <CostEstimateView v-if="tab === 'cost'" />
      <SCurveView v-if="tab === 'scurve'" />
      <ProjectReportView v-if="tab === 'report'" :project="project" />
      <AiAssistantView v-if="tab === 'assistant'" />
      <WbsVersionManager
        v-if="tab === 'versions'"
        :project-id="projectId"
        @published="reloadPublishedWbs"
      />
    </div>
    </template>
  </div>
</template>

<style scoped>
.source-switch { padding: 6px 14px; font-size: 11px; color: var(--muted); border-bottom: 1px solid var(--line); }
.source-switch button { color: var(--accent); cursor: pointer; margin-right: 12px; }
.panel { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--panel-solid); }

.panel__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px 0;
  border-bottom: 1px solid var(--line);
  flex: none;
  overflow-x: auto;
  scrollbar-width: thin;
}
.panel__spacer { flex: 1; }
.file-input { display: none; }

.import,
.template {
  margin: 0 4px 6px 8px;
  padding: 4px 9px;
  border: 1px solid #4cc2ff66;
  border-radius: 5px;
  color: var(--accent);
  white-space: nowrap;
  text-decoration: none;
}
.import:hover,
.template:hover { background: #4cc2ff16; }
.import:disabled { opacity: 0.55; cursor: wait; }

.import-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 11px;
}
.import-status.is-success { color: #74d5a3; background: #22c55e12; }
.import-status.is-error { color: #ff9a9a; background: #ef444417; }
.import-status button { padding: 0 4px; color: inherit; font-size: 16px; }

.tab {
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 6px 6px 0 0;
  padding: 5px 14px;
  color: var(--muted);
  margin-bottom: -1px;
  white-space: nowrap;
}
.tab:hover { color: var(--text); background: #ffffff0a; }
.tab.is-on {
  color: var(--text);
  background: var(--panel-solid);
  border-color: var(--line);
  border-bottom: 1px solid var(--panel-solid);
  font-weight: 600;
}

.summary {
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
  margin-bottom: 6px;
  margin-left: 10px;
}
.summary b { color: var(--text); font-variant-numeric: tabular-nums; }
.sync-state.is-synced { color: #74d5a3; }
.sync-state.is-saving,
.sync-state.is-loading { color: #fbbf24; }
.sync-state.is-error { color: #ff9a9a; }

.panel__body { flex: 1; min-height: 0; display: flex; }
.panel__body > * { flex: 1; min-width: 0; min-height: 0; }
</style>
