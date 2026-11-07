<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { apiHeaders, apiRequest } from '@/lib/apiClient'

type ServiceStatus = 'operational' | 'configured' | 'not_configured' | 'degraded'
interface SystemStatus {
  status: string
  checkedAt: string
  uptimeSeconds: number
  environment: string
  services: {
    api: { status: ServiceStatus }
    database: { status: ServiceStatus; latencyMs: number; provider: string }
    authentication: { status: ServiceStatus; provider: string }
    realtime: { status: ServiceStatus; connections: number; transport: string }
    storage: { status: ServiceStatus; provider: string }
  }
  metrics: {
    activeProjects: number
    activeUsers: number
    pendingFiles: number
    auditEvents24h: number
    latestAuditAt: string | null
  }
}

const status = ref<SystemStatus | null>(null)
const loading = ref(false)
const error = ref('')
let refreshTimer: ReturnType<typeof setInterval> | undefined

const serviceCards = computed(() => status.value ? [
  { key: 'api', label: '後端 API', state: status.value.services.api.status, detail: 'REST API 正常回應' },
  { key: 'database', label: 'Supabase 資料庫', state: status.value.services.database.status, detail: `${status.value.services.database.latencyMs} ms · ${status.value.services.database.provider}` },
  { key: 'authentication', label: '帳號驗證', state: status.value.services.authentication.status, detail: status.value.services.authentication.provider },
  { key: 'realtime', label: '即時事件', state: status.value.services.realtime.status, detail: `${status.value.services.realtime.connections} 個連線 · ${status.value.services.realtime.transport}` },
  { key: 'storage', label: '檔案儲存', state: status.value.services.storage.status, detail: status.value.services.storage.provider },
] : [])

const warnings = computed(() => {
  if (!status.value) return []
  const result: string[] = []
  if (status.value.services.storage.status === 'not_configured') result.push('物件儲存尚未設定；3D、照片與文件上傳目前不可使用正式儲存。')
  if (status.value.metrics.pendingFiles > 0) result.push(`有 ${status.value.metrics.pendingFiles} 個檔案等待安全掃描或處理。`)
  if (status.value.services.database.latencyMs > 1500) result.push('資料庫回應超過 1.5 秒，建議檢查網路或 Supabase 狀態。')
  return result
})

const formatDuration = (seconds: number) => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days ? `${days} 天 ${hours} 小時` : hours ? `${hours} 小時 ${minutes} 分` : `${minutes} 分鐘`
}
const formatTime = (value: string | null) => value ? new Date(value).toLocaleString('zh-TW') : '尚無紀錄'
const statusLabel = (value: ServiceStatus) => ({ operational: '正常', configured: '已設定', not_configured: '未設定', degraded: '需注意' }[value])

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    status.value = await apiRequest<SystemStatus>('/system/status', { headers: await apiHeaders() })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '無法取得系統狀態'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
  refreshTimer = setInterval(() => void refresh(), 30_000)
})
onBeforeUnmount(() => refreshTimer && clearInterval(refreshTimer))
</script>

<template>
  <section class="system-status-view">
    <div class="status-toolbar">
      <div>
        <strong>平台營運監控</strong>
        <span>每 30 秒自動更新；只顯示服務狀態，不顯示連線密碼或金鑰。</span>
      </div>
      <button type="button" :disabled="loading" @click="refresh">{{ loading ? '檢查中…' : '重新檢查' }}</button>
    </div>

    <div v-if="error" class="status-error">無法取得系統狀態：{{ error }}</div>
    <template v-else-if="status">
      <div class="status-summary">
        <article><span>整體狀態</span><strong class="healthy"><i />運作正常</strong></article>
        <article><span>API 運行時間</span><strong>{{ formatDuration(status.uptimeSeconds) }}</strong></article>
        <article><span>資料庫延遲</span><strong>{{ status.services.database.latencyMs }} ms</strong></article>
        <article><span>即時連線</span><strong>{{ status.services.realtime.connections }}</strong></article>
      </div>

      <div class="service-grid">
        <article v-for="service in serviceCards" :key="service.key">
          <div><b>{{ service.label }}</b><span>{{ service.detail }}</span></div>
          <em :data-status="service.state"><i />{{ statusLabel(service.state) }}</em>
        </article>
      </div>

      <section class="platform-metrics">
        <div class="section-title"><div><strong>平台資料概況</strong><span>目前組織的即時統計</span></div><small>檢查時間 {{ formatTime(status.checkedAt) }}</small></div>
        <div class="metric-grid">
          <article><span>進行中專案</span><strong>{{ status.metrics.activeProjects }}</strong></article>
          <article><span>啟用帳號</span><strong>{{ status.metrics.activeUsers }}</strong></article>
          <article><span>24 小時操作紀錄</span><strong>{{ status.metrics.auditEvents24h }}</strong></article>
          <article><span>待處理檔案</span><strong>{{ status.metrics.pendingFiles }}</strong></article>
        </div>
        <p>最近操作紀錄：{{ formatTime(status.metrics.latestAuditAt) }} · 環境：{{ status.environment }}</p>
      </section>

      <section class="warning-panel" :class="{ clear: !warnings.length }">
        <strong>{{ warnings.length ? '需要注意' : '目前沒有異常項目' }}</strong>
        <ul v-if="warnings.length"><li v-for="warning in warnings" :key="warning">{{ warning }}</li></ul>
        <span v-else>API、資料庫、驗證與即時事件服務皆可使用。</span>
      </section>
    </template>
    <div v-else class="status-loading">正在檢查平台服務…</div>
  </section>
</template>

<style scoped>
.system-status-view{margin-top:25px}.status-toolbar,.section-title{display:flex;align-items:center;justify-content:space-between;gap:20px}.status-toolbar{padding:17px 19px;border:1px solid #445159;border-radius:12px;background:#262d31}.status-toolbar strong,.status-toolbar span,.section-title strong,.section-title span{display:block}.status-toolbar span,.section-title span{margin-top:4px;color:#97a6af;font-size:10px}.status-toolbar button{border-color:#ffad7a;color:#ffad7a}.status-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:13px;margin:15px 0}.status-summary article,.metric-grid article{padding:16px 18px;border:1px solid #3f4c52;border-radius:10px;background:#262d31}.status-summary span,.metric-grid span{display:block;color:#96a6af;font-size:10px}.status-summary strong,.metric-grid strong{display:block;margin-top:6px;font-size:21px}.status-summary .healthy{color:#6ee7b7;font-size:15px}.healthy i,.service-grid em i{display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}.service-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.service-grid article{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px 18px;border:1px solid #3f4c52;border-radius:10px;background:#22282c}.service-grid b,.service-grid span{display:block}.service-grid span{margin-top:4px;color:#96a6af;font-size:9px}.service-grid em{white-space:nowrap;color:#6ee7b7;font-size:10px;font-style:normal}.service-grid em[data-status=not_configured],.service-grid em[data-status=degraded]{color:#fbbf24}.platform-metrics{margin-top:15px;padding:19px;border:1px solid #435057;border-radius:12px;background:#22282c}.section-title small{color:#8496a1;font-size:9px}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:15px}.metric-grid article{background:#2c3439}.platform-metrics>p{margin:13px 2px 0;color:#8496a1;font-size:9px}.warning-panel{margin-top:15px;padding:15px 18px;border:1px solid #74461c;border-radius:10px;color:#fcd77d;background:#3d2a172e}.warning-panel.clear{border-color:#235b4a;color:#75dfb3;background:#173a302e}.warning-panel strong,.warning-panel span{display:block}.warning-panel span{margin-top:5px;font-size:10px}.warning-panel ul{margin:7px 0 0;padding-left:18px;font-size:10px}.status-error,.status-loading{margin-top:15px;padding:30px;border:1px solid #505f68;border-radius:11px;text-align:center;color:#aab6bd;background:#262d31}.status-error{border-color:#713448;color:#fda4af}@media(max-width:900px){.status-summary,.metric-grid{grid-template-columns:1fr 1fr}}@media(max-width:650px){.service-grid{grid-template-columns:1fr}.status-toolbar,.section-title{align-items:flex-start;flex-direction:column}.status-summary{grid-template-columns:1fr 1fr}}
</style>
