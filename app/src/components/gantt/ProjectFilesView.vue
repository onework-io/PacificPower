<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { apiRequest } from '@/lib/apiClient'
import { usePermission } from '@/lib/permissions'

type Category = 'drawing' | 'contract' | 'inspection' | 'manual' | 'photo' | 'model' | 'other'
interface ProjectDocument {
  id: string; projectId: string; fileId: string; category: Category; title: string; description: string
  status: 'active' | 'archived'; uploaderName: string | null; name: string; mimeType: string; byteSize: number
  url: string; createdAt: string; updatedAt: string
}

const props = defineProps<{ projectId: string }>()
const can = usePermission()
const documents = ref<ProjectDocument[]>([])
const loading = ref(false)
const uploading = ref(false)
const message = ref('')
const query = ref('')
const category = ref<'all' | Category>('all')
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const draft = ref({ title: '', category: 'drawing' as Category, description: '' })
const editing = ref<ProjectDocument | null>(null)
const categoryLabels: Record<Category, string> = { drawing: '圖說', contract: '合約', inspection: '檢驗', manual: '操作手冊', photo: '照片', model: '3D 模型', other: '其他' }
const filtered = computed(() => documents.value.filter((document) => {
  const keyword = query.value.trim().toLowerCase()
  return (category.value === 'all' || document.category === category.value)
    && (!keyword || `${document.title} ${document.name} ${document.description} ${document.uploaderName ?? ''}`.toLowerCase().includes(keyword))
}))
const totalSize = computed(() => documents.value.reduce((sum, item) => sum + item.byteSize, 0))

function sizeLabel(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

async function load() {
  loading.value = true
  message.value = ''
  try {
    const result = await apiRequest<{ documents: ProjectDocument[] }>(`/projects/${props.projectId}/documents`)
    documents.value = result.documents
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : '無法讀取專案檔案'
  } finally { loading.value = false }
}

function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  selectedFile.value = file
  if (file && !draft.value.title) draft.value.title = file.name.replace(/\.[^.]+$/, '')
}

async function upload() {
  const file = selectedFile.value
  if (!file || !draft.value.title.trim() || uploading.value) return
  if (file.size > 200 * 1024 * 1024) { message.value = '檔案不可超過 200 MB'; return }
  uploading.value = true
  message.value = ''
  try {
    const prepared = await apiRequest<{ fileId: string; uploadUrl: string; headers: Record<string, string> }>(`/projects/${props.projectId}/documents/upload-url`, {
      method: 'POST', body: JSON.stringify({ fileName: file.name, mimeType: file.type || 'application/octet-stream', byteSize: file.size }),
    })
    const uploaded = await fetch(prepared.uploadUrl, { method: 'PUT', headers: prepared.headers, body: file })
    if (!uploaded.ok) throw new Error(`物件儲存上傳失敗（${uploaded.status}）`)
    await apiRequest(`/projects/${props.projectId}/documents/complete`, {
      method: 'POST', body: JSON.stringify({ fileId: prepared.fileId, ...draft.value, title: draft.value.title.trim() }),
    })
    message.value = '檔案已上傳並加入專案檔案庫'
    selectedFile.value = null
    draft.value = { title: '', category: 'drawing', description: '' }
    if (fileInput.value) fileInput.value.value = ''
    await load()
  } catch (cause) {
    message.value = cause instanceof Error ? `上傳失敗：${cause.message}` : '上傳失敗'
  } finally { uploading.value = false }
}

function edit(document: ProjectDocument) {
  editing.value = { ...document }
}

async function saveEdit() {
  if (!editing.value) return
  try {
    await apiRequest(`/projects/${props.projectId}/documents/${editing.value.id}`, {
      method: 'PATCH', body: JSON.stringify({
        title: editing.value.title, category: editing.value.category,
        description: editing.value.description, status: editing.value.status,
      }),
    })
    editing.value = null
    message.value = '檔案資料已更新'
    await load()
  } catch (cause) { message.value = cause instanceof Error ? cause.message : '更新失敗' }
}

async function remove(document: ProjectDocument) {
  if (!window.confirm(`確定刪除「${document.title}」？物件儲存中的檔案也會一併移除。`)) return
  try {
    await apiRequest(`/projects/${props.projectId}/documents/${document.id}`, { method: 'DELETE' })
    message.value = '檔案已刪除'
    await load()
  } catch (cause) { message.value = cause instanceof Error ? cause.message : '刪除失敗' }
}

onMounted(load)
</script>

<template>
  <section class="files-view">
    <header class="files-head"><div><small>PROJECT DOCUMENT CONTROL</small><h2>專案檔案庫</h2><p>集中管理圖說、合約、檢驗資料、操作手冊、照片與 3D 模型附件。</p></div><button type="button" @click="load">↻ 重新整理</button></header>
    <div class="metrics"><article><span>檔案數</span><strong>{{ documents.length }}</strong></article><article><span>總容量</span><strong>{{ sizeLabel(totalSize) }}</strong></article><article><span>圖說／檢驗</span><strong>{{ documents.filter((item) => ['drawing','inspection'].includes(item.category)).length }}</strong></article><article><span>已歸檔</span><strong>{{ documents.filter((item) => item.status === 'archived').length }}</strong></article></div>
    <p v-if="message" class="message">{{ message }}</p>
    <form v-if="can('project.edit')" class="upload-card" @submit.prevent="upload"><div><small>UPLOAD NEW FILE</small><strong>新增專案文件</strong></div><label class="file-select"><input ref="fileInput" type="file" @change="chooseFile" /><span>{{ selectedFile ? `${selectedFile.name} · ${sizeLabel(selectedFile.size)}` : '選擇檔案（最大 200 MB）' }}</span></label><input v-model="draft.title" required maxlength="180" placeholder="文件名稱" /><select v-model="draft.category"><option v-for="(label, key) in categoryLabels" :key="key" :value="key">{{ label }}</option></select><input v-model="draft.description" maxlength="2000" placeholder="說明（選填）" /><button type="submit" :disabled="!selectedFile || !draft.title.trim() || uploading">{{ uploading ? '上傳中…' : '上傳檔案' }}</button></form>
    <div class="tools"><input v-model="query" placeholder="搜尋文件名稱、檔名或上傳者" /><select v-model="category"><option value="all">全部分類</option><option v-for="(label, key) in categoryLabels" :key="key" :value="key">{{ label }}</option></select></div>
    <div v-if="loading" class="state">正在載入專案檔案…</div>
    <div v-else class="file-list"><article v-for="document in filtered" :key="document.id" :data-status="document.status"><i>{{ document.name.split('.').pop()?.toUpperCase().slice(0,4) || 'FILE' }}</i><span><strong>{{ document.title }}</strong><small>{{ document.name }} · {{ sizeLabel(document.byteSize) }}</small></span><b>{{ categoryLabels[document.category] }}</b><span class="owner"><strong>{{ document.uploaderName || '平台使用者' }}</strong><small>{{ new Date(document.createdAt).toLocaleString('zh-TW') }}</small></span><em>{{ document.status === 'active' ? '使用中' : '已歸檔' }}</em><a :href="document.url" target="_blank" rel="noopener">下載</a><button v-if="can('project.edit')" type="button" @click="edit(document)">編輯</button><button v-if="can('project.edit')" class="danger" type="button" @click="remove(document)">刪除</button></article><div v-if="!filtered.length" class="state">目前沒有符合條件的專案檔案。</div></div>
    <div v-if="editing" class="modal" @click.self="editing = null"><form @submit.prevent="saveEdit"><header><div><small>DOCUMENT SETTINGS</small><h3>編輯文件資料</h3></div><button type="button" @click="editing = null">×</button></header><label><span>名稱</span><input v-model="editing.title" required maxlength="180" /></label><label><span>分類</span><select v-model="editing.category"><option v-for="(label, key) in categoryLabels" :key="key" :value="key">{{ label }}</option></select></label><label><span>狀態</span><select v-model="editing.status"><option value="active">使用中</option><option value="archived">已歸檔</option></select></label><label><span>說明</span><textarea v-model="editing.description" rows="4" maxlength="2000" /></label><footer><button type="button" @click="editing = null">取消</button><button class="primary" type="submit">儲存</button></footer></form></div>
  </section>
</template>

<style scoped>
.files-view{min-height:100%;padding:18px;background:#091321;color:#e7eef8}.files-head{display:flex;align-items:flex-end;justify-content:space-between;padding:18px 20px;border:1px solid #2b4059;border-radius:12px 12px 0 0;background:linear-gradient(120deg,#152740,#0d192a)}.files-head small,.upload-card small,.modal small{color:#4cc2ff;font-size:8px;letter-spacing:.15em}.files-head h2{margin:4px 0;font-size:20px}.files-head p{margin:0;color:#71869f;font-size:9px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;border:1px solid #2b4059;border-top:0;background:#2b4059}.metrics article{padding:12px 16px;background:#0c1727}.metrics span{display:block;color:#778ba2;font-size:8px}.metrics strong{display:block;margin-top:4px;font-size:17px}.message{margin:0;padding:9px 16px;border:1px solid #29506b;border-top:0;background:#123047;color:#81dcff;font-size:8px}.upload-card{display:grid;grid-template-columns:160px 1fr 1fr 130px 1.2fr auto;align-items:end;gap:8px;margin-top:14px;padding:13px;border:1px solid #2b4059;border-radius:9px;background:#0d1a2b}.upload-card>div strong{display:block;margin-top:4px;font-size:10px}.upload-card input,.upload-card select,.tools input,.tools select,.modal input,.modal select,.modal textarea{width:100%;padding:8px;border:1px solid #304760;border-radius:6px;background:#071321;color:#e7eef8}.file-select input{display:none}.file-select span{display:block;padding:8px;border:1px dashed #3c5c77;border-radius:6px;color:#8ba5bc;font-size:8px;cursor:pointer}.upload-card button{padding:8px 11px;background:#4cc2ff;color:#071321;font-weight:700}.tools{display:flex;gap:8px;margin:12px 0}.tools input{max-width:380px}.tools select{width:140px}.file-list{display:grid;gap:6px}.file-list article{display:grid;grid-template-columns:44px minmax(180px,1.4fr) 70px minmax(130px,1fr) 60px 46px 46px 46px;align-items:center;gap:9px;padding:10px 12px;border:1px solid #293f58;border-left:3px solid #4cc2ff;border-radius:7px;background:#0c1829}.file-list article[data-status=archived]{opacity:.65;border-left-color:#64748b}.file-list i{width:38px;height:38px;display:grid;place-items:center;border-radius:7px;background:#19344a;color:#7bd5ff;font-size:7px;font-style:normal}.file-list span>*{display:block}.file-list strong{font-size:9px}.file-list small{margin-top:3px;color:#71869e;font-size:7px}.file-list b,.file-list em{padding:4px 6px;border-radius:99px;background:#172a40;color:#86cfee;font-size:7px;font-style:normal;text-align:center}.file-list a,.file-list button{padding:5px;color:#8fdcff;font-size:7px;text-align:center;text-decoration:none}.file-list .danger{color:#fda4af}.state{padding:35px;color:#71869e;text-align:center;font-size:9px}.modal{position:fixed;z-index:100;inset:0;display:grid;place-items:center;padding:20px;background:#020813bb}.modal form{width:min(520px,100%);padding:18px;border:1px solid #38526c;border-radius:11px;background:#0d1a2b}.modal header{display:flex;justify-content:space-between}.modal h3{margin:4px 0 15px}.modal label{display:block;margin-top:10px}.modal label span{display:block;margin-bottom:5px;color:#91a5ba;font-size:8px}.modal footer{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.modal .primary{background:#4cc2ff;color:#071321}@media(max-width:1100px){.upload-card{grid-template-columns:1fr 1fr 1fr}.upload-card>div{grid-column:1/-1}.file-list article{grid-template-columns:40px 1fr 70px 60px 46px 46px 46px}.owner{display:none}}@media(max-width:700px){.metrics{grid-template-columns:1fr 1fr}.upload-card{grid-template-columns:1fr}.file-list article{grid-template-columns:40px 1fr 60px}.file-list article>*:nth-child(n+4){display:none}}
</style>
