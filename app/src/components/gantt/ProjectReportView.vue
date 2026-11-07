<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { ProjectSummary } from '@/data/projects'
import { useScheduleStore } from '@/stores/schedule'
import { projectReportCsv, summarizeProjectReport, type ProjectReportTask } from '@/lib/projectReport'
import { apiHeaders, apiRequest } from '@/lib/apiClient'
import { usePermission } from '@/lib/permissions'

const props = defineProps<{ project: ProjectSummary }>()
const store = useScheduleStore()
const can = usePermission()
interface ReportActivity {
  id: number
  action: 'report.exported.csv' | 'report.exported.pdf' | 'report.acknowledged'
  actorName: string
  data: { format?: string; dataDate?: string | null; note?: string } | null
  createdAt: string
}
const activity = ref<ReportActivity[]>([])
const activityLoading = ref(false)
const acknowledgeNote = ref('')
const acknowledging = ref(false)
const activityMessage = ref('')

const tasks = computed<ProjectReportTask[]>(() => store.rows.map((row) => ({
  wbs: row.wbs,
  name: row.step.name,
  phase: row.step.phase,
  progress: row.progress,
  weight: row.weight,
  start: row.task.start,
  finish: row.task.finish,
  critical: row.task.critical,
})))
const report = computed(() => summarizeProjectReport(tasks.value, store.dataDay))
const dataDate = computed(() => {
  const date = new Date(store.projectStartDate)
  date.setDate(date.getDate() + store.dataDay)
  return date.toLocaleDateString('zh-TW')
})
const varianceTone = computed(() => report.value.variance < -5 ? 'danger' : report.value.variance < 0 ? 'warning' : 'good')

function fmtMoney(value: number) {
  return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(value)
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

async function recordExport(format: 'csv' | 'pdf') {
  try {
    await apiRequest(`/projects/${props.project.id}/report-exports`, {
      method: 'POST', headers: await apiHeaders(),
      body: JSON.stringify({ format, dataDate: dataDate.value.replaceAll('/', '-') }),
    })
    await loadActivity()
  } catch {
    // 匯出仍可完成；後端離線時不阻擋使用者取得報表。
  }
}

async function loadActivity() {
  activityLoading.value = true
  try {
    const result = await apiRequest<{ items: ReportActivity[] }>(`/projects/${props.project.id}/report-activity`, {
      headers: await apiHeaders(),
    })
    activity.value = result.items
  } catch {
    activity.value = []
  } finally {
    activityLoading.value = false
  }
}

async function acknowledge() {
  acknowledging.value = true
  activityMessage.value = ''
  try {
    await apiRequest(`/projects/${props.project.id}/report-acknowledgements`, {
      method: 'POST', headers: await apiHeaders(),
      body: JSON.stringify({ note: acknowledgeNote.value.trim(), dataDate: dataDate.value.replaceAll('/', '-') }),
    })
    acknowledgeNote.value = ''
    activityMessage.value = '已記錄本次查閱'
    await loadActivity()
  } catch (error) {
    activityMessage.value = error instanceof Error ? error.message : '查閱確認失敗'
  } finally {
    acknowledging.value = false
  }
}

function activityLabel(item: ReportActivity) {
  if (item.action === 'report.acknowledged') return '確認已查閱'
  return item.action.endsWith('.csv') ? '下載 CSV' : '列印／輸出 PDF'
}

function activityTime(value: string) {
  return new Date(value).toLocaleString('zh-TW', { hour12: false })
}

watch(() => props.project.id, () => { void loadActivity() })
onMounted(() => { void loadActivity() })

async function downloadCsv() {
  if (!can('report.export')) return
  await recordExport('csv')
  const blob = new Blob([projectReportCsv(tasks.value, store.dataDay)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${props.project.code}_${dataDate.value.replaceAll('/', '-')}_專案進度報表.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function printReport() {
  if (!can('report.export')) return
  const popup = window.open('', '_blank', 'width=1100,height=800')
  if (!popup) return
  popup.opener = null
  popup.document.write('<!doctype html><title>正在產生報表…</title><p style="font-family:sans-serif;padding:24px">正在產生 PacificPower 專案報表…</p>')
  popup.document.close()
  await recordExport('pdf')
  const phaseRows = report.value.phases.map((phase) => `<tr><td>${escapeHtml(phase.phase)}</td><td>${phase.taskCount}</td><td>${phase.planned}%</td><td>${phase.progress}%</td><td class="${phase.variance < -5 ? 'late' : ''}">${phase.variance > 0 ? '+' : ''}${phase.variance}%</td><td>${phase.critical ? '要徑進行中' : '—'}</td></tr>`).join('')
  const attentionRows = report.value.attentionTasks.map((task) => `<tr><td>${escapeHtml(task.wbs)}</td><td>${escapeHtml(task.name)}</td><td>${task.planned}%</td><td>${task.progress}%</td><td class="late">${task.variance}%</td></tr>`).join('') || '<tr><td colspan="5">目前沒有需特別關注的工項</td></tr>'
  const contractAmount = can('report.contract_amount.view') ? fmtMoney(props.project.budget) : '權限未開放'
  popup.document.open()
  popup.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${escapeHtml(props.project.code)} 專案進度報表</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC",sans-serif;color:#2a3237;margin:0}header{display:flex;justify-content:space-between;border-bottom:3px solid #6c808c;padding-bottom:14px}header small{color:#687c88;letter-spacing:.12em}h1{margin:5px 0 0;font-size:25px}.meta{text-align:right;font-size:12px;color:#728793}.meta b{display:block;color:#2a3237;font-size:14px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:18px 0}.summary div{padding:12px;border:1px solid #dce4ed;border-radius:8px}.summary small{display:block;color:#778b97}.summary strong{display:block;margin-top:5px;font-size:22px}.late{color:#d43b4d;font-weight:700}h2{margin:20px 0 8px;font-size:15px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{padding:7px;border:1px solid #dce4ed;text-align:left}th{background:#eef6fa}.project{margin-top:10px;color:#62747f;font-size:12px}.footer{margin-top:18px;color:#95a5ae;font-size:9px;text-align:right}@media print{button{display:none}}</style></head><body><header><div><small>PACIFICPOWER · OWNER REPORT</small><h1>${escapeHtml(props.project.name)}</h1><div class="project">${escapeHtml(props.project.code)}　${escapeHtml(props.project.client)}　${escapeHtml(props.project.location)}</div></div><div class="meta">資料日期<b>${escapeHtml(dataDate.value)}</b>列印日期 ${new Date().toLocaleDateString('zh-TW')}</div></header><section class="summary"><div><small>實際進度</small><strong>${report.value.actualProgress}%</strong></div><div><small>計畫進度</small><strong>${report.value.plannedProgress}%</strong></div><div><small>進度落差</small><strong class="${report.value.variance < -5 ? 'late' : ''}">${report.value.variance > 0 ? '+' : ''}${report.value.variance}%</strong></div><div><small>承攬金額</small><strong>${escapeHtml(contractAmount)}</strong></div></section><h2>階段執行摘要</h2><table><thead><tr><th>階段</th><th>工項</th><th>計畫</th><th>實際</th><th>落差</th><th>要徑</th></tr></thead><tbody>${phaseRows}</tbody></table><h2>需關注工項</h2><table><thead><tr><th>WBS</th><th>工項</th><th>計畫</th><th>實際</th><th>落差</th></tr></thead><tbody>${attentionRows}</tbody></table><div class="footer">本報表由 PacificPower 工程數位管理平台依目前核准資料產生。</div><script>window.onload=()=>window.print()<\/script></body></html>`)
  popup.document.close()
}
</script>

<template>
  <div class="report-view">
    <header class="report-head">
      <div>
        <small>OWNER / MANAGEMENT REPORT</small>
        <h2>專案進度總覽</h2>
        <p>{{ project.code }} · {{ project.client }} · 資料日期 {{ dataDate }}</p>
      </div>
      <div class="actions">
        <button v-if="can('report.export')" type="button" @click="downloadCsv">下載 CSV</button>
        <button v-if="can('report.export')" type="button" class="primary" @click="printReport">列印／另存 PDF</button>
        <span v-else class="readonly-badge">唯讀檢視</span>
      </div>
    </header>

    <main class="report-scroll">
      <section class="kpis">
        <article><span>實際進度</span><strong>{{ report.actualProgress }}%</strong><small>{{ report.completedCount }} / {{ tasks.length }} 工項完成</small></article>
        <article><span>計畫進度</span><strong>{{ report.plannedProgress }}%</strong><small>第 {{ store.dataDay + 1 }} 天／共 {{ Math.ceil(store.projectDays) }} 天</small></article>
        <article :class="`tone--${varianceTone}`"><span>計畫落差</span><strong>{{ report.variance > 0 ? '+' : '' }}{{ report.variance }}%</strong><small>{{ report.variance < 0 ? '低於計畫進度' : '符合或超前計畫' }}</small></article>
        <article><span>待關注</span><strong>{{ report.delayedCount }}</strong><small>要徑未完成 {{ report.criticalRemainingCount }} 項</small></article>
      </section>

      <section class="project-strip">
        <div><span>專案期間</span><b>{{ project.startDate }} ～ {{ project.endDate }}</b></div>
        <div><span>專案經理</span><b>{{ project.manager || '尚未指派' }}</b></div>
        <div><span>負責工班</span><b>{{ project.crew || '尚未指派' }}</b></div>
        <div><span>承攬金額</span><b>{{ can('report.contract_amount.view') ? fmtMoney(project.budget) : '權限未開放' }}</b></div>
        <div><span>風險狀態</span><b :class="{ risk: project.risk !== '正常' }">{{ project.risk }}</b></div>
      </section>

      <div class="report-grid">
        <section class="card phases">
          <header><div><small>PHASE STATUS</small><h3>階段執行摘要</h3></div><span>實際／計畫</span></header>
          <div v-for="phase in report.phases" :key="phase.phase" class="phase-row">
            <div class="phase-name"><b>{{ phase.phase }}</b><small>{{ phase.taskCount }} 項<span v-if="phase.critical"> · 要徑</span></small></div>
            <div class="bars"><i class="planned" :style="{ width: `${phase.planned}%` }" /><i class="actual" :class="{ delayed: phase.variance < -5 }" :style="{ width: `${phase.progress}%` }" /></div>
            <b>{{ phase.progress }}%</b>
            <em :class="{ delayed: phase.variance < -5 }">{{ phase.variance > 0 ? '+' : '' }}{{ phase.variance }}%</em>
          </div>
        </section>

        <section class="card attention">
          <header><div><small>ATTENTION ITEMS</small><h3>需關注工項</h3></div><span>{{ report.attentionTasks.length }} 項</span></header>
          <div v-if="!report.attentionTasks.length" class="empty"><b>目前進度正常</b><span>沒有落後超過 5% 的工項</span></div>
          <div v-for="task in report.attentionTasks" :key="task.wbs" class="task-row">
            <span>{{ task.wbs }}</span>
            <div><b>{{ task.name }}</b><small>{{ task.phase }}<i v-if="task.critical">要徑</i></small></div>
            <div class="task-progress"><b>{{ task.progress }}%</b><small>計畫 {{ task.planned }}%</small></div>
            <em>{{ task.variance }}%</em>
          </div>
        </section>

        <section class="card activity-card">
          <header><div><small>REPORT VERIFICATION</small><h3>報表查驗紀錄</h3></div><span>最近 {{ activity.length }} 筆</span></header>
          <div class="acknowledge-box">
            <div><b>確認本次報表已查閱</b><small>資料日期 {{ dataDate }}，確認後會留下使用者與時間紀錄。</small></div>
            <input v-model="acknowledgeNote" maxlength="500" placeholder="備註（選填，例如：無異議）" />
            <button type="button" :disabled="acknowledging" @click="acknowledge">{{ acknowledging ? '記錄中…' : '確認已查閱' }}</button>
          </div>
          <p v-if="activityMessage" class="activity-message">{{ activityMessage }}</p>
          <div v-if="activityLoading" class="activity-state">讀取查驗紀錄…</div>
          <div v-else-if="!activity.length" class="activity-state">尚無報表查閱或輸出紀錄</div>
          <div v-else class="activity-list">
            <article v-for="item in activity" :key="item.id">
              <i :class="{ acknowledged: item.action === 'report.acknowledged' }">{{ item.action === 'report.acknowledged' ? '✓' : '⇩' }}</i>
              <div><b>{{ activityLabel(item) }}</b><small>{{ item.actorName }} · {{ activityTime(item.createdAt) }}</small><p v-if="item.data?.note">{{ item.data.note }}</p></div>
              <span>{{ item.data?.dataDate || '—' }}</span>
            </article>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.report-view{display:flex;flex-direction:column;min-height:0;height:100%;background:#1a1f22;color:#dce8f4}.report-head{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px 20px;border-bottom:1px solid #39444b;background:linear-gradient(135deg,#252b2f,#1e2428)}.report-head small,.card header small{color:#ffad7a;font-size:8px;letter-spacing:.14em}.report-head h2{margin:3px 0 0;font-size:19px}.report-head p{margin:5px 0 0;color:#93a3ac;font-size:10px}.actions{display:flex;gap:7px}.actions button{padding:7px 11px;border:1px solid #506068;border-radius:6px;color:#a7bdd2}.actions button.primary{border-color:#ff681b;background:#5f717b;color:#fff}.report-scroll{min-height:0;overflow:auto;padding:16px 20px 28px}.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.kpis article{padding:14px;border:1px solid #435058;border-radius:10px;background:linear-gradient(145deg,#2b3337,#21272b)}.kpis span,.project-strip span{display:block;color:#8f9fa8;font-size:9px}.kpis strong{display:block;margin:5px 0 2px;font-size:25px}.kpis small{color:#81939e;font-size:8px}.kpis .tone--danger strong{color:#fb7185}.kpis .tone--warning strong{color:#fbbf24}.kpis .tone--good strong{color:#64d89b}.project-strip{display:grid;grid-template-columns:1.4fr repeat(4,1fr);margin:12px 0;padding:10px 14px;border:1px solid #39444a;border-radius:9px;background:#202629}.project-strip div+div{padding-left:14px;border-left:1px solid #39444a}.project-strip b{display:block;margin-top:4px;font-size:10px}.project-strip b.risk{color:#fbbf24}.report-grid{display:grid;grid-template-columns:minmax(460px,1.25fr) minmax(350px,.75fr);gap:12px}.card{min-width:0;border:1px solid #435058;border-radius:10px;overflow:hidden;background:#21272a}.card>header{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;border-bottom:1px solid #3b464d;background:#293136}.card h3{margin:3px 0 0;font-size:13px}.card>header>span{color:#8f9fa8;font-size:8px}.phase-row{display:grid;grid-template-columns:115px minmax(100px,1fr) 38px 42px;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid #313a40}.phase-name b,.phase-name small{display:block}.phase-name b{font-size:10px}.phase-name small{margin-top:3px;color:#788c97;font-size:8px}.phase-name small span{color:#fbbf24}.bars{position:relative;height:10px;border-radius:99px;background:#313a40;overflow:hidden}.bars i{position:absolute;left:0;border-radius:99px}.bars .planned{top:1px;height:8px;background:#73879366}.bars .actual{top:2px;height:6px;background:#ff681b}.bars .actual.delayed{background:#f59e0b}.phase-row>b{font-size:10px;text-align:right}.phase-row>em{color:#64d89b;font-size:9px;font-style:normal;text-align:right}.phase-row>em.delayed{color:#fb7185}.task-row{display:grid;grid-template-columns:34px minmax(0,1fr) 55px 40px;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #313a40}.task-row>span{display:grid;place-items:center;padding:5px 2px;border-radius:5px;background:#333d43;color:#ffad7a;font-size:8px}.task-row b,.task-row small{display:block}.task-row>div>b{overflow:hidden;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.task-row small{margin-top:3px;color:#778b96;font-size:7px}.task-row small i{margin-left:5px;padding:1px 4px;border-radius:3px;background:#f59e0b20;color:#fbbf24;font-style:normal}.task-progress{text-align:right}.task-progress>b{font-size:10px!important}.task-row>em{color:#fb7185;font-size:9px;font-style:normal;text-align:right}.empty{min-height:190px;display:grid;place-content:center;justify-items:center;gap:4px;color:#82949e;font-size:9px}.empty b{color:#75d9a4;font-size:11px}@media(max-width:1000px){.kpis{grid-template-columns:repeat(2,1fr)}.project-strip{grid-template-columns:repeat(2,1fr);gap:10px}.project-strip div+div{padding-left:0;border-left:0}.report-grid{grid-template-columns:1fr}}@media(max-width:650px){.report-head{align-items:flex-start;flex-direction:column}.kpis{grid-template-columns:1fr}.phase-row{grid-template-columns:90px 1fr 34px}.phase-row>em{display:none}}
.readonly-badge{align-self:center;padding:6px 10px;border:1px solid #516069;border-radius:6px;color:#a5b2ba;font-size:9px}
.activity-card{grid-column:1/-1}.acknowledge-box{display:grid;grid-template-columns:minmax(220px,1fr) minmax(180px,1fr) auto;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #394349;background:#242b2f}.acknowledge-box b,.acknowledge-box small{display:block}.acknowledge-box b{font-size:10px}.acknowledge-box small{margin-top:3px;color:#8597a1;font-size:8px}.acknowledge-box input{min-width:0;padding:7px 9px;border:1px solid #505f68;border-radius:6px;background:#1d2225;color:#dce8f4;font-size:9px}.acknowledge-box button{padding:7px 10px;border:1px solid #ff681b66;border-radius:6px;background:#586973;color:#fff;font-size:9px}.acknowledge-box button:disabled{opacity:.55}.activity-message{margin:0;padding:7px 14px;border-bottom:1px solid #394349;color:#72d9a5;font-size:8px}.activity-state{padding:22px;color:#8395a0;font-size:9px;text-align:center}.activity-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0}.activity-list article{display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:9px;padding:10px 14px;border-bottom:1px solid #313a40}.activity-list article:nth-child(odd){border-right:1px solid #313a40}.activity-list i{width:26px;height:26px;display:grid;place-items:center;border-radius:7px;background:#ffad7a18;color:#ffad7a;font-style:normal}.activity-list i.acknowledged{background:#22c55e18;color:#72d9a5}.activity-list b,.activity-list small{display:block}.activity-list b{font-size:9px}.activity-list small{margin-top:3px;color:#7b8f9a;font-size:7px}.activity-list p{margin:4px 0 0;color:#b0bbc2;font-size:8px}.activity-list>article>span{color:#95a4ad;font-size:8px}@media(max-width:760px){.acknowledge-box{grid-template-columns:1fr}.activity-list{grid-template-columns:1fr}.activity-list article:nth-child(odd){border-right:0}}
</style>
