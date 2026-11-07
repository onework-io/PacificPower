<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { wbsRepository, type ApiWbsVersion, type WbsVersionStatus } from '@/lib/wbsRepository'
import { usePermission } from '@/lib/permissions'

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ published: [] }>()

const versions = ref<ApiWbsVersion[]>([])
const loading = ref(false)
const busyId = ref<string | null>(null)
const error = ref('')
const newLabel = ref('')
const can = usePermission()

const statusText: Record<WbsVersionStatus, string> = {
  draft: '草稿', in_review: '審核中', published: '已發布', superseded: '已取代', rejected: '已退回',
}

const activeVersion = computed(() => versions.value.find((version) => version.status === 'published'))

async function load() {
  if (!wbsRepository.apiEnabled) return
  loading.value = true
  error.value = ''
  try {
    versions.value = await wbsRepository.listVersions(props.projectId)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '無法讀取版本歷程'
  } finally {
    loading.value = false
  }
}

async function createDraft() {
  if (!can('wbs.edit')) return
  busyId.value = 'new'
  error.value = ''
  try {
    await wbsRepository.createVersion(props.projectId, newLabel.value.trim() || undefined)
    newLabel.value = ''
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '建立草稿失敗'
  } finally {
    busyId.value = null
  }
}

async function transition(version: ApiWbsVersion, action: 'submit' | 'approve' | 'publish') {
  const permission = action === 'submit' ? 'wbs.submit' : action === 'approve' ? 'wbs.approve' : 'wbs.publish'
  if (!can(permission)) return
  busyId.value = version.id
  error.value = ''
  try {
    if (action === 'submit') await wbsRepository.submitVersion(props.projectId, version)
    if (action === 'approve') await wbsRepository.approveVersion(props.projectId, version)
    if (action === 'publish') {
      await wbsRepository.publishVersion(props.projectId, version)
      emit('published')
    }
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '版本操作失敗'
  } finally {
    busyId.value = null
  }
}

async function discard(version: ApiWbsVersion) {
  if (!can('wbs.edit')) return
  if (!window.confirm(`確定刪除「${version.label}」？`)) return
  busyId.value = version.id
  error.value = ''
  try {
    await wbsRepository.deleteVersion(props.projectId, version)
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '刪除版本失敗'
  } finally {
    busyId.value = null
  }
}

async function reject(version: ApiWbsVersion) {
  if (!can('wbs.approve')) return
  const note = window.prompt('請輸入退回原因')?.trim()
  if (!note) return
  busyId.value = version.id
  error.value = ''
  try {
    await wbsRepository.rejectVersion(props.projectId, version, note)
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '退回版本失敗'
  } finally {
    busyId.value = null
  }
}

watch(() => props.projectId, () => { void load() })
onMounted(() => { void load() })
</script>

<template>
  <section class="versions" aria-label="WBS 版本管理">
    <header>
      <div>
        <h3>WBS 版本管理</h3>
        <p v-if="activeVersion">目前使用 V{{ activeVersion.versionNumber }} · {{ activeVersion.label }}</p>
        <p v-else>尚未發布正式版本</p>
      </div>
      <button type="button" :disabled="loading" @click="load">重新整理</button>
    </header>

    <form v-if="can('wbs.edit')" class="new-version" @submit.prevent="createDraft">
      <input v-model="newLabel" maxlength="120" placeholder="版本名稱（選填）" aria-label="版本名稱" />
      <button type="submit" class="primary" :disabled="busyId === 'new'">
        {{ busyId === 'new' ? '建立中…' : '建立目前 WBS 快照' }}
      </button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="empty">讀取版本歷程…</p>
    <p v-else-if="versions.length === 0" class="empty">尚無版本，先建立第一份 WBS 快照。</p>

    <div v-else class="history">
      <article v-for="version in versions" :key="version.id" :class="`is-${version.status}`">
        <div class="version-id">
          <strong>V{{ version.versionNumber }}</strong>
          <span class="status">{{ statusText[version.status] }}</span>
        </div>
        <div class="version-copy">
          <b>{{ version.label }}</b>
          <span>{{ new Date(version.createdAt).toLocaleString('zh-TW') }}</span>
        </div>
        <div class="actions">
          <button
            v-if="can('wbs.submit') && (version.status === 'draft' || version.status === 'rejected')"
            type="button" :disabled="busyId === version.id" @click="transition(version, 'submit')"
          >送審</button>
          <button
            v-if="can('wbs.approve') && version.status === 'in_review' && !version.approvedAt"
            type="button" :disabled="busyId === version.id" @click="transition(version, 'approve')"
          >核准</button>
          <button
            v-if="can('wbs.approve') && version.status === 'in_review'"
            type="button" class="danger" :disabled="busyId === version.id" @click="reject(version)"
          >退回</button>
          <button
            v-if="can('wbs.publish') && version.status === 'in_review' && version.approvedAt"
            type="button" class="primary" :disabled="busyId === version.id" @click="transition(version, 'publish')"
          >發布</button>
          <button
            v-if="can('wbs.edit') && (version.status === 'draft' || version.status === 'rejected')"
            type="button" class="danger" :disabled="busyId === version.id" @click="discard(version)"
          >刪除</button>
        </div>
      </article>
    </div>

    <footer>發布採用單一交易；正式工項、相依關係與作用中版本會同步切換。</footer>
  </section>
</template>

<style scoped>
.versions { height: 100%; overflow: auto; padding: 18px; background: #1c2225; color: var(--text); }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
h3 { margin: 0 0 4px; font-size: 16px; }
p { margin: 0; }
header p, footer, .empty { color: var(--muted); font-size: 12px; }
button, input { border: 1px solid var(--line); border-radius: 6px; background: #252c30; color: var(--text); }
button { padding: 6px 10px; cursor: pointer; }
button:hover:not(:disabled) { border-color: #ffad7a88; }
button:disabled { opacity: .5; cursor: wait; }
button.primary { border-color: #ffad7a88; background: #5c6d77; }
button.danger { color: #ff9a9a; }
.new-version { display: flex; gap: 8px; margin-bottom: 12px; }
.new-version input { width: min(360px, 55vw); padding: 7px 10px; }
.error { margin: 8px 0; padding: 8px 10px; border: 1px solid #ef444455; border-radius: 6px; color: #ff9a9a; background: #ef444412; font-size: 12px; }
.empty { padding: 28px 0; text-align: center; }
.history { display: grid; gap: 7px; }
article { display: grid; grid-template-columns: 115px minmax(180px, 1fr) auto; align-items: center; gap: 14px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 7px; background: #22282c; }
article.is-published { border-color: #22c55e66; }
.version-id { display: flex; align-items: center; gap: 8px; }
.version-id strong { font-variant-numeric: tabular-nums; }
.status { padding: 2px 6px; border-radius: 999px; background: #ffffff0d; color: var(--muted); font-size: 10px; }
.is-published .status { color: #74d5a3; background: #22c55e18; }
.is-in_review .status { color: #fbbf24; background: #f59e0b18; }
.version-copy { display: flex; flex-direction: column; min-width: 0; }
.version-copy b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.version-copy span { color: var(--muted); font-size: 10px; }
.actions { display: flex; gap: 6px; }
footer { margin-top: 14px; }
@media (max-width: 760px) {
  article { grid-template-columns: 90px 1fr; }
  .actions { grid-column: 1 / -1; }
}
</style>
