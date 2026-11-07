<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { apiRequest } from '@/lib/apiClient'
import { usePermission } from '@/lib/permissions'

interface DailyReport {
  id: string
  reportDate: string
  crewName: string
  weather: string
  workSummary: string
  issues: string
  safetyNotes: string
  nextPlan: string
  status: 'pending' | 'approved' | 'rejected'
  reporterName: string | null
  reviewerName: string | null
  rejectionReason: string
  photoCount: number
  progressCount: number
  laborHours: number
  createdAt: string
  tasks: ReportTask[]
  laborEntries: LaborEntry[]
}
interface ReportTask { id: string; code: string; name: string; progressPct: number }
interface LaborEntry { id: string; taskId: string; taskCode: string; taskName: string; crewName: string; people: number; hours: number; totalHours: number; note: string }
interface TaskOption { id: string; code: string; name: string; progressPct: number }
interface ReportPhoto { fileId: string; name: string; url: string; mimeType: string; byteSize: number }
interface PendingPhoto { file: File; url: string }

const props = defineProps<{ projectId: string }>()
const can = usePermission()
const reports = ref<DailyReport[]>([])
const loading = ref(true)
const saving = ref(false)
const message = ref('')
const selectedId = ref<string | null>(null)
const photosByReport = ref<Record<string, ReportPhoto[]>>({})
const photoInput = ref<HTMLInputElement | null>(null)
const pendingPhotos = ref<PendingPhoto[]>([])
const taskOptions = ref<TaskOption[]>([])
const laborOptions = ref<LaborEntry[]>([])
const loadingLinks = ref(false)
const draft = ref({
  reportDate: new Date().toISOString().slice(0, 10), crewName: '', weather: '晴',
  workSummary: '', issues: '', safetyNotes: '', nextPlan: '', taskIds: [] as string[], laborEntryIds: [] as string[],
})

const summary = computed(() => ({
  pending: reports.value.filter((item) => item.status === 'pending').length,
  approved: reports.value.filter((item) => item.status === 'approved').length,
  photos: reports.value.reduce((sum, item) => sum + item.photoCount, 0),
  hours: reports.value.reduce((sum, item) => sum + item.laborHours, 0),
}))

async function load() {
  loading.value = true
  message.value = ''
  try {
    const [result, wbs] = await Promise.all([
      apiRequest<{ reports: DailyReport[] }>(`/projects/${props.projectId}/daily-reports`),
      apiRequest<{ tasks: TaskOption[] }>(`/projects/${props.projectId}/tasks`),
    ])
    reports.value = result.reports
    taskOptions.value = wbs.tasks
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : '無法載入施工日報'
  } finally {
    loading.value = false
  }
}

async function loadLaborOptions() {
  loadingLinks.value = true
  try {
    const query = new URLSearchParams({
      projectId: props.projectId, from: draft.value.reportDate, to: draft.value.reportDate, status: 'approved',
    })
    const result = await apiRequest<{ entries: LaborEntry[] }>(`/labor-entries?${query}`)
    laborOptions.value = result.entries
    const validIds = new Set(result.entries.map((entry) => entry.id))
    draft.value.laborEntryIds = draft.value.laborEntryIds.filter((id) => validIds.has(id))
  } catch {
    laborOptions.value = []
  } finally {
    loadingLinks.value = false
  }
}

function selectPhotos(event: Event) {
  const input = event.target as HTMLInputElement
  for (const file of Array.from(input.files ?? [])) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) continue
    pendingPhotos.value.push({ file, url: URL.createObjectURL(file) })
  }
  input.value = ''
}

function removePhoto(index: number) {
  const [photo] = pendingPhotos.value.splice(index, 1)
  if (photo) URL.revokeObjectURL(photo.url)
}

async function uploadPhoto(reportId: string, file: File) {
  const prepared = await apiRequest<{ fileId: string; uploadUrl: string; headers: Record<string, string> }>(
    `/projects/${props.projectId}/daily-reports/${reportId}/photos/upload-url`,
    { method: 'POST', body: JSON.stringify({ fileName: file.name, mimeType: file.type, byteSize: file.size }) },
  )
  const response = await fetch(prepared.uploadUrl, { method: 'PUT', headers: prepared.headers, body: file })
  if (!response.ok) throw new Error(`照片 ${file.name} 上傳失敗`)
  await apiRequest(`/projects/${props.projectId}/daily-reports/${reportId}/photos/complete`, {
    method: 'POST', body: JSON.stringify({ fileId: prepared.fileId }),
  })
}

async function submit() {
  if (!can('progress.report') || !draft.value.workSummary.trim() || saving.value) return
  saving.value = true
  message.value = ''
  try {
    const created = await apiRequest<{ id: string }>(`/projects/${props.projectId}/daily-reports`, {
      method: 'POST', body: JSON.stringify(draft.value),
    })
    if (can('photo.upload')) for (const photo of pendingPhotos.value) await uploadPhoto(created.id, photo.file)
    for (const photo of pendingPhotos.value) URL.revokeObjectURL(photo.url)
    pendingPhotos.value = []
    draft.value.workSummary = ''
    draft.value.issues = ''
    draft.value.safetyNotes = ''
    draft.value.nextPlan = ''
    draft.value.taskIds = []
    draft.value.laborEntryIds = []
    message.value = '施工日報已送出，等待 Manager 審核'
    await load()
  } catch (cause) {
    message.value = cause instanceof Error ? `送出失敗：${cause.message}` : '施工日報送出失敗'
  } finally {
    saving.value = false
  }
}

async function review(report: DailyReport, status: 'approved' | 'rejected') {
  const reason = status === 'rejected' ? window.prompt('請輸入退回原因') : ''
  if (status === 'rejected' && !reason?.trim()) return
  saving.value = true
  try {
    await apiRequest(`/projects/${props.projectId}/daily-reports/${report.id}/${status === 'approved' ? 'approve' : 'reject'}`, {
      method: 'POST', body: status === 'rejected' ? JSON.stringify({ reason: reason!.trim() }) : undefined,
    })
    message.value = status === 'approved' ? '施工日報已核准' : '施工日報已退回'
    await load()
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : '審核失敗'
  } finally {
    saving.value = false
  }
}

async function toggleDetail(report: DailyReport) {
  selectedId.value = selectedId.value === report.id ? null : report.id
  if (selectedId.value && report.photoCount && !photosByReport.value[report.id]) {
    const result = await apiRequest<{ photos: ReportPhoto[] }>(`/projects/${props.projectId}/daily-reports/${report.id}/photos`)
    photosByReport.value[report.id] = result.photos
  }
}

function escapeHtml(value: string | null | undefined) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character]!)
}

async function printReport(report: DailyReport) {
  const printWindow = window.open('', '_blank', 'width=920,height=760')
  if (!printWindow) {
    message.value = '瀏覽器已封鎖列印視窗，請允許彈出視窗後再試一次。'
    return
  }
  printWindow.document.write('<p style="font-family:sans-serif;padding:24px">正在準備施工日報…</p>')
  try {
    if (report.photoCount && !photosByReport.value[report.id]) {
      const result = await apiRequest<{ photos: ReportPhoto[] }>(`/projects/${props.projectId}/daily-reports/${report.id}/photos`)
      photosByReport.value[report.id] = result.photos
    }
    const photos = photosByReport.value[report.id] ?? []
    const status = report.status === 'approved' ? '已核准' : report.status === 'rejected' ? '已退回' : '待審核'
    const field = (label: string, value: string | null | undefined) => `<section><h3>${label}</h3><p>${escapeHtml(value || '無')}</p></section>`
    const taskSummary = report.tasks.length ? report.tasks.map((task) => `${task.code} ${task.name}（${task.progressPct}%）`).join('\n') : '未關聯 WBS 工項'
    const laborSummary = report.laborEntries.length ? report.laborEntries.map((entry) => `${entry.taskCode} ${entry.taskName}｜${entry.crewName || '未指定工班'}｜${entry.people} 人 × ${entry.hours} 小時 = ${entry.totalHours} 人時`).join('\n') : '未關聯核准人工時'
    const photoMarkup = photos.length
      ? `<div class="photos">${photos.map((photo) => `<figure><img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.name)}"><figcaption>${escapeHtml(photo.name)}</figcaption></figure>`).join('')}</div>`
      : '<p class="muted">本日報無照片附件</p>'
    printWindow.document.open()
    printWindow.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>施工日報 ${escapeHtml(report.reportDate)}</title><style>
      @page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#2a3237;font:12px/1.65 Arial,"Noto Sans TC",sans-serif}header{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:12px;border-bottom:3px solid #48565e}h1{margin:0;font-size:24px;letter-spacing:.08em}.brand{color:#48565e;font-size:11px;font-weight:700}.meta{display:grid;grid-template-columns:repeat(4,1fr);margin:14px 0;border:1px solid #adb9c0}.meta div{padding:8px 10px;border-right:1px solid #adb9c0}.meta div:last-child{border:0}.meta small{display:block;color:#728793;font-size:9px}.meta strong{display:block;margin-top:2px;font-size:12px}.content{display:grid;grid-template-columns:1fr 1fr;gap:10px}.content section{min-height:92px;padding:10px;border:1px solid #b9c5ce}.content section:first-child{grid-column:1/-1;min-height:120px}.content h3{margin:0 0 5px;color:#48565e;font-size:10px;letter-spacing:.08em}.content p{margin:0;white-space:pre-wrap}.photos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.photos figure{margin:0}.photos img{width:100%;height:130px;object-fit:cover;border:1px solid #b9c5ce}.photos figcaption{overflow:hidden;color:#728793;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.approval{display:flex;justify-content:space-between;margin-top:14px;padding:10px;border-top:1px solid #adb9c0}.muted{color:#80939e}.hint{position:fixed;right:18px;bottom:18px;padding:8px 12px;border:1px solid #b8c2c8;border-radius:6px;background:#fff;color:#5d6f79;font-size:10px}@media print{.hint{display:none}}
    </style></head><body><header><div><div class="brand">PACIFICPOWER · DIGITAL CONSTRUCTION</div><h1>資料中心施工日報</h1></div><strong>${escapeHtml(report.reportDate)}</strong></header><div class="meta"><div><small>工班</small><strong>${escapeHtml(report.crewName || '未指定')}</strong></div><div><small>天氣</small><strong>${escapeHtml(report.weather || '未填寫')}</strong></div><div><small>填報人</small><strong>${escapeHtml(report.reporterName || '平台使用者')}</strong></div><div><small>狀態</small><strong>${status}</strong></div></div><main class="content">${field('今日施工內容', report.workSummary)}${field('關聯 WBS 工項', taskSummary)}${field('關聯核准人工時', laborSummary)}${field('異常／阻礙事項', report.issues)}${field('工安紀錄', report.safetyNotes)}${field('明日／下一步計畫', report.nextPlan)}</main>${photoMarkup}${report.rejectionReason ? `<p class="muted">退回原因：${escapeHtml(report.rejectionReason)}</p>` : ''}<div class="approval"><span>WBS 工項：${report.progressCount} 項　核准人工時：${report.laborHours} 人時</span><span>審核人：${escapeHtml(report.reviewerName || '尚未審核')}</span></div><div class="hint">請在列印視窗選擇「另存為 PDF」</div></body></html>`)
    printWindow.document.close()
    window.setTimeout(() => {
      printWindow.focus()
      printWindow.print()
    }, 700)
  } catch (cause) {
    printWindow.close()
    message.value = cause instanceof Error ? `列印準備失敗：${cause.message}` : '列印準備失敗'
  }
}

onMounted(load)
watch(() => draft.value.reportDate, loadLaborOptions, { immediate: true })
onBeforeUnmount(() => pendingPhotos.value.forEach((photo) => URL.revokeObjectURL(photo.url)))
</script>

<template>
  <section class="daily-report">
    <header class="daily-report__head">
      <div><small>DAILY SITE REPORT</small><h2>施工日報</h2><p>整合當日施工內容、WBS 進度、核准人工時、現場照片與異常事項。</p></div>
      <button type="button" @click="load">↻ 重新整理</button>
    </header>

    <div class="metrics">
      <article><span>待審日報</span><strong>{{ summary.pending }}</strong><small>等待 Manager 確認</small></article>
      <article><span>已核准</span><strong>{{ summary.approved }}</strong><small>正式施工紀錄</small></article>
      <article><span>現場照片</span><strong>{{ summary.photos }}</strong><small>日報附件</small></article>
      <article><span>核准人工時</span><strong>{{ summary.hours }}</strong><small>人時</small></article>
    </div>

    <p v-if="message" class="message" :class="{ error: message.includes('失敗') || message.includes('無法') }">{{ message }}</p>

    <form v-if="can('progress.report')" class="report-form" @submit.prevent="submit">
      <div class="report-form__title"><div><small>NEW REPORT</small><strong>填寫當日施工紀錄</strong></div><span>送出後不可直接修改，退回後可重新填報。</span></div>
      <label><span>日期</span><input v-model="draft.reportDate" type="date" required /></label>
      <label><span>工班</span><input v-model="draft.crewName" maxlength="120" placeholder="例如：發電機安裝 A 班" /></label>
      <label><span>天氣</span><select v-model="draft.weather"><option>晴</option><option>陰</option><option>雨</option><option>高溫</option><option>強風</option></select></label>
      <label class="wide"><span>今日施工內容 *</span><textarea v-model="draft.workSummary" rows="3" required maxlength="4000" placeholder="完成的 WBS 工項、施工位置與成果" /></label>
      <label class="wide half"><span>異常／阻礙事項</span><textarea v-model="draft.issues" rows="2" maxlength="4000" placeholder="材料延誤、介面衝突、待確認事項" /></label>
      <label class="wide half"><span>工安紀錄</span><textarea v-model="draft.safetyNotes" rows="2" maxlength="4000" placeholder="工具箱會議、巡檢或改善事項" /></label>
      <label class="wide"><span>明日／下一步計畫</span><textarea v-model="draft.nextPlan" rows="2" maxlength="4000" placeholder="預定工項、人力與需求" /></label>
      <div class="link-picker wide">
        <header><div><strong>關聯 WBS 工項</strong><small>選擇本日報實際涵蓋的施工工項</small></div><span>{{ draft.taskIds.length }} 項已選</span></header>
        <div v-if="taskOptions.length" class="link-options"><label v-for="task in taskOptions" :key="task.id"><input v-model="draft.taskIds" type="checkbox" :value="task.id" /><span><b>{{ task.code }}</b>{{ task.name }}<em>{{ task.progressPct }}%</em></span></label></div>
        <p v-else>目前沒有可選擇的 WBS 工項。</p>
      </div>
      <div class="link-picker wide">
        <header><div><strong>關聯核准人工時</strong><small>僅顯示日報日期當天、已核准的人工時</small></div><span>{{ draft.laborEntryIds.length }} 筆已選</span></header>
        <div v-if="laborOptions.length" class="link-options"><label v-for="entry in laborOptions" :key="entry.id"><input v-model="draft.laborEntryIds" type="checkbox" :value="entry.id" /><span><b>{{ entry.taskCode }}</b>{{ entry.crewName || entry.taskName }}<em>{{ entry.totalHours }} 人時</em></span></label></div>
        <p v-else>{{ loadingLinks ? '正在讀取核准人工時…' : '此日期尚無已核准的人工時。' }}</p>
      </div>
      <div v-if="can('photo.upload')" class="photo-picker wide">
        <header><span>現場照片（每張最大 10 MB）</span><button type="button" @click="photoInput?.click()">＋ 加入照片</button></header>
        <input ref="photoInput" type="file" accept="image/jpeg,image/png,image/webp" multiple @change="selectPhotos" />
        <div v-if="pendingPhotos.length"><figure v-for="(photo, index) in pendingPhotos" :key="photo.url"><img :src="photo.url" :alt="photo.file.name" /><figcaption>{{ photo.file.name }}</figcaption><button type="button" @click="removePhoto(index)">×</button></figure></div>
      </div>
      <button class="submit-report" type="submit" :disabled="saving || !draft.workSummary.trim()">{{ saving ? '送出中…' : '送出施工日報' }}</button>
    </form>

    <div v-if="loading" class="state">正在載入施工日報…</div>
    <div v-else class="report-list">
      <article v-for="report in reports" :key="report.id" class="report-card" :data-status="report.status">
        <button class="report-card__summary" type="button" @click="toggleDetail(report)">
          <span class="date"><small>{{ report.reportDate }}</small><strong>{{ report.crewName || '未指定工班' }}</strong></span>
          <span><small>施工內容</small><strong>{{ report.workSummary }}</strong></span>
          <span class="stats"><b>WBS {{ report.progressCount }}</b><b>人工時 {{ report.laborHours }}</b><b>照片 {{ report.photoCount }}</b></span>
          <span class="status">{{ report.status === 'pending' ? '待審' : report.status === 'approved' ? '已核准' : '已退回' }}</span><em>{{ selectedId === report.id ? '⌃' : '⌄' }}</em>
        </button>
        <div v-if="selectedId === report.id" class="report-card__detail">
          <div class="detail-grid"><section><small>回報人／天氣</small><p>{{ report.reporterName || '平台使用者' }} · {{ report.weather || '未填寫' }}</p></section><section><small>異常事項</small><p>{{ report.issues || '無' }}</p></section><section><small>工安紀錄</small><p>{{ report.safetyNotes || '無' }}</p></section><section><small>下一步計畫</small><p>{{ report.nextPlan || '未填寫' }}</p></section></div>
          <div class="linked-records"><section><small>關聯 WBS 工項</small><div v-if="report.tasks.length"><span v-for="task in report.tasks" :key="task.id"><b>{{ task.code }}</b>{{ task.name }}<em>{{ task.progressPct }}%</em></span></div><p v-else>未關聯工項</p></section><section><small>關聯核准人工時</small><div v-if="report.laborEntries.length"><span v-for="entry in report.laborEntries" :key="entry.id"><b>{{ entry.taskCode }}</b>{{ entry.crewName || entry.taskName }}<em>{{ entry.totalHours }} 人時</em></span></div><p v-else>未關聯人工時</p></section></div>
          <div v-if="photosByReport[report.id]?.length" class="report-photos"><a v-for="photo in photosByReport[report.id]" :key="photo.fileId" :href="photo.url" target="_blank"><img :src="photo.url" :alt="photo.name" /><span>{{ photo.name }}</span></a></div>
          <p v-if="report.rejectionReason" class="reject-reason">退回原因：{{ report.rejectionReason }}</p>
          <footer><span>{{ report.reviewerName ? `審核人：${report.reviewerName}` : '尚未審核' }}</span><button type="button" class="print" @click="printReport(report)">列印／PDF</button><template v-if="report.status === 'pending' && can('progress.verify')"><button type="button" class="reject" :disabled="saving" @click="review(report, 'rejected')">退回</button><button type="button" class="approve" :disabled="saving" @click="review(report, 'approved')">核准日報</button></template></footer>
        </div>
      </article>
      <div v-if="!reports.length" class="state">目前尚無施工日報。</div>
    </div>
  </section>
</template>

<style scoped>
.daily-report{min-height:100%;padding:18px;background:#1c2225;color:#e7eef8}.daily-report__head{display:flex;align-items:flex-end;justify-content:space-between;padding:18px 20px;border:1px solid #435058;border-radius:12px 12px 0 0;background:linear-gradient(120deg,#2f383d,#22282c)}.daily-report__head small,.report-form__title small{color:#ffad7a;font-size:8px;letter-spacing:.15em}.daily-report__head h2{margin:4px 0;font-size:20px}.daily-report__head p{margin:0;color:#8597a1;font-size:9px}.daily-report__head button{padding:7px 10px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;border:1px solid #435058;border-top:0;background:#435058}.metrics article{padding:13px 16px;background:#20262a}.metrics span,.metrics strong,.metrics small{display:block}.metrics span{color:#8b9ca5;font-size:8px}.metrics strong{margin:4px 0;font-size:19px}.metrics small{color:#687c87;font-size:7px}.message{margin:0;padding:9px 16px;border:1px solid #4a5861;border-top:0;background:#313a3f;color:#ffad7a;font-size:8px}.message.error{color:#fb7185}.report-form{display:grid;grid-template-columns:1fr 1fr 1fr;gap:11px;margin-top:14px;padding:16px;border:1px solid #455259;border-radius:10px;background:#22292d}.report-form__title{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between}.report-form__title strong{display:block;margin-top:3px;font-size:12px}.report-form__title>span{color:#7a8e99;font-size:8px}.report-form label>span{display:block;margin-bottom:5px;color:#a9b6bd;font-size:8px}.report-form input,.report-form select,.report-form textarea{width:100%;padding:8px 9px;border:1px solid #49565e;border-radius:6px;background:#1b2124;color:#e7eef8;font:inherit}.report-form textarea{resize:vertical}.report-form .wide{grid-column:1/-1}.report-form .half{grid-column:span 1}.photo-picker{padding-top:10px;border-top:1px solid #3f4b52}.photo-picker>header{display:flex;align-items:center;justify-content:space-between}.photo-picker>header span{color:#a7b4bb;font-size:8px}.photo-picker>header button{padding:5px 8px;font-size:7px}.photo-picker>input{display:none}.photo-picker>div{display:flex;gap:8px;margin-top:9px;overflow:auto}.photo-picker figure{position:relative;flex:0 0 100px;margin:0}.photo-picker img{width:100px;height:68px;object-fit:cover;border:1px solid #4f5e67;border-radius:7px}.photo-picker figcaption{overflow:hidden;margin-top:3px;color:#8496a1;font-size:7px;text-overflow:ellipsis;white-space:nowrap}.photo-picker figure button{position:absolute;right:-4px;top:-4px;width:20px;height:20px;padding:0;border-radius:50%;background:#52202a;color:#fda4af}.submit-report{grid-column:1/-1;justify-self:end;padding:9px 15px;border-color:#ffad7a;background:#ffad7a;color:#1a1f22;font-weight:700}.submit-report:disabled{opacity:.45}.report-list{display:grid;gap:8px;margin-top:14px}.report-card{border:1px solid #424f56;border-left:3px solid #f59e0b;border-radius:9px;overflow:hidden;background:#21272b}.report-card[data-status='approved']{border-left-color:#22c55e}.report-card[data-status='rejected']{border-left-color:#ef4444}.report-card__summary{width:100%;display:grid;grid-template-columns:130px minmax(220px,1fr) auto 62px 18px;align-items:center;gap:12px;padding:12px;border:0;border-radius:0;background:transparent;text-align:left}.report-card__summary:hover{background:#2a3237;color:inherit}.report-card__summary small,.report-card__summary strong{display:block}.report-card__summary small{color:#7c8f9a;font-size:7px}.report-card__summary strong{margin-top:3px;overflow:hidden;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.stats{display:flex;gap:5px}.stats b{padding:4px 6px;border-radius:99px;background:#30393e;color:#ffad7a;font-size:7px}.status{padding:4px 7px;border-radius:99px;background:#713f12;color:#fde68a;font-size:7px;text-align:center}.report-card[data-status='approved'] .status{background:#14532d;color:#bbf7d0}.report-card[data-status='rejected'] .status{background:#7f1d1d;color:#fecaca}.report-card__summary em{color:#7c8f9a;font-style:normal}.report-card__detail{padding:14px 16px;border-top:1px solid #424f56;background:#1d2225}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.detail-grid section{padding:10px;border:1px solid #3b464c;border-radius:7px}.detail-grid small{color:#ffad7a;font-size:7px}.detail-grid p{margin:5px 0 0;color:#c4d0df;font-size:8px;line-height:1.55;white-space:pre-wrap}.report-photos{display:flex;gap:8px;margin-top:11px;overflow:auto}.report-photos a{flex:0 0 120px;color:#8f9fa8;font-size:7px;text-decoration:none}.report-photos img{width:120px;height:80px;object-fit:cover;border:1px solid #4b5962;border-radius:7px}.report-photos span{display:block;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.reject-reason{padding:8px 10px;border-left:2px solid #ef4444;background:#7f1d1d22;color:#fca5a5;font-size:8px}.report-card__detail footer{display:flex;align-items:center;gap:7px;margin-top:12px;padding-top:10px;border-top:1px solid #3c484f}.report-card__detail footer span{flex:1;color:#788c97;font-size:7px}.report-card__detail footer button{padding:6px 9px;font-size:7px}.report-card__detail .reject{border-color:#7f2837;color:#fda4af}.report-card__detail .approve{border-color:#22c55e;background:#14532d;color:#bbf7d0}.state{padding:35px;color:#8597a1;text-align:center;font-size:9px}@media(max-width:800px){.metrics{grid-template-columns:1fr 1fr}.report-form{grid-template-columns:1fr}.report-form .wide,.report-form .half{grid-column:1}.report-card__summary{grid-template-columns:100px 1fr 55px 18px}.stats{display:none}}@media(max-width:520px){.daily-report{padding:10px}.daily-report__head{align-items:flex-start;flex-direction:column;gap:10px}.report-card__summary{grid-template-columns:1fr 55px 18px}.report-card__summary>span:nth-child(2){grid-column:1/-1}.date{grid-row:1}.detail-grid{grid-template-columns:1fr}}
.report-card__detail .print{border-color:#586872;color:#ffad7a}
.link-picker{padding:11px;border:1px solid #445158;border-radius:7px;background:#1e2326}.link-picker>header{display:flex;align-items:center;justify-content:space-between}.link-picker>header strong,.link-picker>header small{display:block}.link-picker>header strong{font-size:9px}.link-picker>header small,.link-picker>header span,.link-picker>p{color:#8496a0;font-size:7px}.link-picker>p{margin:10px 0 0}.link-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-top:9px;max-height:142px;overflow:auto}.link-options label{display:flex;align-items:center;gap:7px;padding:7px;border:1px solid #3d484f;border-radius:5px;background:#1a1f22;cursor:pointer}.link-options input{width:auto}.link-options label>span{display:flex;align-items:center;gap:6px;min-width:0;color:#adbbca;font-size:8px}.link-options b{color:#ffad7a}.link-options em{margin-left:auto;color:#8f9fa9;font-size:7px;font-style:normal;white-space:nowrap}.linked-records{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}.linked-records section{padding:10px;border:1px solid #3b464c;border-radius:7px}.linked-records small{color:#ffad7a;font-size:7px}.linked-records section>div{display:grid;gap:4px;margin-top:7px}.linked-records span{display:flex;gap:6px;color:#b9c8d8;font-size:8px}.linked-records b{color:#ffad7a}.linked-records em{margin-left:auto;color:#8f9fa9;font-size:7px;font-style:normal}.linked-records p{margin:7px 0 0;color:#768a96;font-size:8px}
</style>
