<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useScheduleStore } from '@/stores/schedule'
import { useViewerStore } from '@/stores/viewer'
import { buildDemoPhotoAnswer, buildLocalSiteAnswer, type SiteAssistantContext } from '@/lib/siteAssistant'
import { usePermission } from '@/lib/permissions'

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  photoNames?: string[]
  focusStepId?: string | null
  overallProgress?: number
  estimatedOverallProgress?: number
}

interface PhotoItem {
  file: File | null
  name: string
  url: string
  revokeUrl: boolean
}

const MAX_PHOTOS = 1
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const endpoint = (import.meta.env.VITE_AI_ASSISTANT_ENDPOINT as string | undefined)?.trim()
const store = useScheduleStore()
const viewer = useViewerStore()
const can = usePermission()
const DEMO_PHOTOS: PhotoItem[] = [
  { file: null, name: 'A1.jpg', url: `${import.meta.env.BASE_URL}demo-site-photos/A1.jpg`, revokeUrl: false },
  { file: null, name: 'A2.JPG', url: `${import.meta.env.BASE_URL}demo-site-photos/A2.JPG`, revokeUrl: false },
  { file: null, name: 'A3.JPG', url: `${import.meta.env.BASE_URL}demo-site-photos/A3.JPG`, revokeUrl: false },
]
const question = ref('請根據這張現場照片，分析目前的工程進度。')
const photos = ref<PhotoItem[]>([{ ...DEMO_PHOTOS[0] }])
const busy = ref(false)
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const messagesEl = ref<HTMLElement | null>(null)
let nextMessageId = 2

const messages = ref<ChatMessage[]>([
  {
    id: 1,
    role: 'assistant',
    text: '我是 AI 現場助手。可以問我目前進度、延誤工項、下一步施工，或上傳發電機現場照片。回答相關工項時，3D 會同步定位。',
  },
])

const context = computed<SiteAssistantContext>(() => ({
  dataDay: store.dataDay,
  projectDays: store.projectDays,
  overallProgress: store.overallProgress,
  rows: store.rows,
}))

const statusText = computed(() =>
  `第 ${Math.floor(store.dataDay) + 1} 天 · WBS ${store.overallProgress}% · ${store.activeSteps.length} 項施工中`,
)

function addPhotos(event: Event) {
  if (!can('photo.upload')) return
  error.value = ''
  const input = event.target as HTMLInputElement
  const incoming = [...(input.files ?? [])]
  if (incoming.length > MAX_PHOTOS) error.value = '一次只分析一張照片，已選用第一張。'
  for (const photo of photos.value) if (photo.revokeUrl) URL.revokeObjectURL(photo.url)
  photos.value = []
  for (const file of incoming.slice(0, MAX_PHOTOS)) {
    if (!file.type.startsWith('image/')) {
      error.value = '只能上傳 JPG、PNG、HEIC 等圖片檔案'
      continue
    }
    if (file.size > MAX_PHOTO_BYTES) {
      error.value = `${file.name} 超過 10 MB`
      continue
    }
    photos.value.push({ file, name: file.name, url: URL.createObjectURL(file), revokeUrl: true })
  }
  input.value = ''
}

function removePhoto(index: number) {
  const [removed] = photos.value.splice(index, 1)
  if (removed?.revokeUrl) URL.revokeObjectURL(removed.url)
}

function loadDemoPhoto(name: string) {
  if (!can('photo.upload')) return
  for (const photo of photos.value) if (photo.revokeUrl) URL.revokeObjectURL(photo.url)
  const selected = DEMO_PHOTOS.find((photo) => photo.name === name) ?? DEMO_PHOTOS[0]
  photos.value = [{ ...selected }]
  question.value = '請根據這張現場照片，分析目前的工程進度。'
  error.value = ''
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(`無法讀取 ${file.name}`))
    reader.readAsDataURL(file)
  })
}

async function photoPayload(photo: PhotoItem) {
  if (photo.file) return { name: photo.name, type: photo.file.type, dataUrl: await fileToDataUrl(photo.file) }
  const response = await fetch(photo.url)
  if (!response.ok) throw new Error(`無法讀取範例照片 ${photo.name}`)
  const blob = await response.blob()
  const file = new File([blob], photo.name, { type: blob.type || 'image/jpeg' })
  return { name: photo.name, type: file.type, dataUrl: await fileToDataUrl(file) }
}

const demoName = (names: string[]) => DEMO_PHOTOS.find((photo) => names.includes(photo.name))?.name ?? null

function focusStep(stepId: string | null | undefined) {
  if (!stepId) return
  const row = store.rows.find((item) => item.step.id === stepId)
  if (!row) return
  store.selectedId = row.step.id
  store.cursorDay = Math.max(0, Math.floor(row.task.start))
  if (!row.step.partId) return
  viewer.setRoomCutaway(true)
  viewer.unlockCamera()
  viewer.progressFilterSuppressed = true
  viewer.progressFilter = null
  viewer.highlightedIds = new Set([row.step.partId])
  viewer.isolatedId = row.step.partId
  viewer.requestFreeFocus(row.step.partId)
}

async function ask(preset?: string) {
  const text = (preset ?? question.value).trim() || (photos.value.length ? '請分析這些現場照片與目前進度。' : '')
  if (!text || busy.value) return

  const pendingPhotos = photos.value.splice(0)
  const photoNames = pendingPhotos.map((item) => item.name)
  messages.value.push({ id: nextMessageId++, role: 'user', text, photoNames })
  question.value = ''
  busy.value = true
  error.value = ''
  await nextTick()
  messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight, behavior: 'smooth' })

  try {
    let answer: { text: string; focusStepId: string | null; estimatedOverallProgress?: number }
    if (endpoint) {
      const images = await Promise.all(pendingPhotos.map(photoPayload))
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, images, context: context.value }),
      })
      if (!response.ok) throw new Error(`AI 服務回應 ${response.status}`)
      const result = await response.json() as { answer?: string; focusStepId?: string | null; estimatedOverallProgress?: number }
      if (!result.answer) throw new Error('AI 服務沒有回傳回答')
      answer = {
        text: result.answer,
        focusStepId: store.rows.some((row) => row.step.id === result.focusStepId)
          ? result.focusStepId ?? null
          : null,
        estimatedOverallProgress: Number.isFinite(result.estimatedOverallProgress)
          ? Math.min(100, Math.max(0, Number(result.estimatedOverallProgress)))
          : undefined,
      }
    } else {
      answer = demoName(photoNames)
        ? buildDemoPhotoAnswer(demoName(photoNames)!)
        : buildLocalSiteAnswer(text, context.value, photoNames.length)
    }

    messages.value.push({
      id: nextMessageId++,
      role: 'assistant',
      text: answer.text,
      focusStepId: answer.focusStepId,
      overallProgress: store.overallProgress,
      estimatedOverallProgress: answer.estimatedOverallProgress,
    })
    focusStep(answer.focusStepId)
  } catch (cause) {
    const fallback = demoName(photoNames)
      ? buildDemoPhotoAnswer(demoName(photoNames)!)
      : buildLocalSiteAnswer(text, context.value, photoNames.length)
    messages.value.push({
      id: nextMessageId++,
      role: 'assistant',
      text: `AI 影像服務暫時無法使用（${cause instanceof Error ? cause.message : '未知錯誤'}）。\n\n${fallback.text}`,
      focusStepId: fallback.focusStepId,
      overallProgress: store.overallProgress,
      estimatedOverallProgress: fallback.estimatedOverallProgress,
    })
    focusStep(fallback.focusStepId)
  } finally {
    for (const item of pendingPhotos) if (item.revokeUrl) URL.revokeObjectURL(item.url)
    busy.value = false
    await nextTick()
    messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight, behavior: 'smooth' })
  }
}

onBeforeUnmount(() => {
  for (const item of photos.value) if (item.revokeUrl) URL.revokeObjectURL(item.url)
})
</script>

<template>
  <section class="assistant">
    <header class="assistant__head">
      <div>
        <h2>AI 現場助手</h2>
        <p>{{ statusText }}</p>
      </div>
      <span class="mode" :class="{ 'is-live': endpoint }">
        <i />{{ endpoint ? '影像 AI 已連線' : '排程助手模式' }}
      </span>
    </header>

    <div class="quick">
      <button @click="ask('目前工程進度如何？')">目前進度</button>
      <button @click="ask('有哪些延誤或逾期工項？')">延誤檢查</button>
      <button @click="ask('接下來要施工什麼？')">下一步</button>
      <button v-if="can('photo.upload')" @click="loadDemoPhoto('A1.jpg')">範例 A1</button>
      <button v-if="can('photo.upload')" @click="loadDemoPhoto('A2.JPG')">範例 A2</button>
      <button v-if="can('photo.upload')" @click="loadDemoPhoto('A3.JPG')">範例 A3</button>
    </div>

    <div ref="messagesEl" class="messages" aria-live="polite">
      <article v-for="message in messages" :key="message.id" class="message" :class="`is-${message.role}`">
        <strong>{{ message.role === 'assistant' ? 'AI' : '現場人員' }}</strong>
        <div v-if="message.photoNames?.length" class="message__files">
          📷 {{ message.photoNames.join('、') }}
        </div>
        <div v-if="message.role === 'assistant' && message.overallProgress !== undefined" class="message__progress">
          <span>系統 WBS 總體進度 <b>{{ message.overallProgress }}%</b></span>
          <span v-if="message.estimatedOverallProgress !== undefined" class="is-ai">AI 照片推估 <b>{{ message.estimatedOverallProgress }}%</b></span>
        </div>
        <p>{{ message.text }}</p>
        <button
          v-if="message.role === 'assistant' && message.focusStepId"
          class="focus"
          @click="focusStep(message.focusStepId)"
        >在 3D 查看（自由視角）</button>
      </article>
      <article v-if="busy" class="message is-assistant is-thinking"><strong>AI</strong><p>正在比對照片與排程…</p></article>
    </div>

    <div v-if="photos.length" class="photos">
      <figure v-for="(photo, index) in photos" :key="photo.url">
        <img :src="photo.url" :alt="photo.name" />
        <figcaption>{{ photo.name }}</figcaption>
        <button :aria-label="`移除 ${photo.name}`" @click="removePhoto(index)">×</button>
      </figure>
    </div>

    <div v-if="error" class="assistant__error">{{ error }}</div>

    <footer class="composer">
      <input
        v-if="can('photo.upload')"
        ref="fileInput"
        type="file"
        accept="image/*"
        hidden
        @change="addPhotos"
      />
      <button v-if="can('photo.upload')" class="upload" title="一次 1 張，最大 10 MB" @click="fileInput?.click()">＋ 現場照片</button>
      <textarea
        v-model="question"
        rows="2"
        placeholder="詢問目前進度、照片中的設備或下一個工項…"
        @keydown.ctrl.enter.prevent="ask()"
        @keydown.meta.enter.prevent="ask()"
      />
      <button class="send" :disabled="busy || (!question.trim() && !photos.length)" @click="ask()">
        {{ busy ? '分析中' : '送出' }}
      </button>
    </footer>
    <p class="privacy">{{ endpoint ? '照片僅在送出時傳給設定的 AI 端點；API 金鑰不會存放在瀏覽器。' : '目前為照片判讀展示模式；推估結果不會直接覆寫正式 WBS。' }}</p>
  </section>
</template>

<style scoped>
.assistant { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #252b2f; }
.assistant__head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 18px 10px; border-bottom: 1px solid var(--line); }
.assistant__head h2 { margin: 0; font-size: 16px; }
.assistant__head p { margin: 2px 0 0; color: var(--muted); font-size: 11px; }
.mode { display: flex; align-items: center; gap: 6px; padding: 4px 9px; border: 1px solid #f59e0b55; border-radius: 999px; color: #f6c768; font-size: 11px; white-space: nowrap; }
.mode i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.mode.is-live { border-color: #22c55e66; color: #74d5a3; }
.quick { display: flex; gap: 6px; padding: 10px 18px 4px; overflow-x: auto; }
.quick button { border-color: #ffad7a44; color: var(--accent); white-space: nowrap; }
.messages { flex: 1; min-height: 120px; overflow-y: auto; padding: 12px 18px; }
.message { width: min(86%, 620px); margin: 0 0 12px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: #2e363b; }
.message.is-user { margin-left: auto; background: #323b41; border-color: #ffad7a55; }
.message strong { display: block; margin-bottom: 3px; color: var(--accent); font-size: 11px; }
.message.is-user strong { color: #ffad7a; }
.message p { margin: 0; white-space: pre-line; }
.message__files { margin-bottom: 5px; color: var(--muted); font-size: 11px; }
.message__progress { display: flex; flex-wrap: wrap; gap: 6px; margin: 5px 0 8px; }
.message__progress span { padding: 4px 7px; border: 1px solid #ffffff1f; border-radius: 999px; color: var(--muted); font-size: 10px; }
.message__progress b { display: inline; margin-left: 3px; color: var(--text); font-size: 12px; font-variant-numeric: tabular-nums; }
.message__progress .is-ai { border-color: #f59e0b55; color: #f6c768; }
.message__progress .is-ai b { color: #f6c768; }
.message .focus { margin-top: 8px; border-color: #ffad7a66; color: var(--accent); }
.is-thinking { opacity: 0.72; animation: pulse 1.2s ease-in-out infinite alternate; }
@keyframes pulse { to { opacity: 0.42; } }
.photos { display: flex; gap: 8px; padding: 8px 18px 0; overflow-x: auto; }
.photos figure { position: relative; flex: 0 0 94px; margin: 0; }
.photos img { display: block; width: 94px; height: 66px; object-fit: cover; border: 1px solid var(--line); border-radius: 7px; }
.photos figcaption { overflow: hidden; margin-top: 2px; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.photos button { position: absolute; top: -5px; right: -5px; width: 20px; height: 20px; padding: 0; border-radius: 50%; background: #3c474e; }
.assistant__error { margin: 6px 18px 0; color: #ff9a9a; font-size: 11px; }
.composer { display: grid; grid-template-columns: auto minmax(100px, 1fr) auto; gap: 8px; align-items: end; padding: 12px 18px 6px; border-top: 1px solid var(--line); }
.composer textarea { width: 100%; min-height: 54px; resize: vertical; border: 1px solid var(--line); border-radius: 7px; padding: 8px 10px; color: var(--text); background: #21272a; font: inherit; }
.composer textarea:focus { outline: 1px solid var(--accent); border-color: var(--accent); }
.upload { height: 34px; white-space: nowrap; }
.send { height: 34px; border-color: var(--accent); color: var(--accent); }
.send:disabled { opacity: 0.45; cursor: default; }
.privacy { margin: 0; padding: 0 18px 10px; color: var(--muted); font-size: 10px; text-align: right; }
@media (max-width: 700px) {
  .assistant__head { align-items: flex-start; }
  .composer { grid-template-columns: 1fr auto; }
  .upload { grid-column: 1 / -1; justify-self: start; }
}
</style>
