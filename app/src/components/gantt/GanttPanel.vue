<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { PLAY_SPEEDS, useScheduleStore } from '@/stores/schedule'
import { useViewerStore } from '@/stores/viewer'
import { dayToDate, isWeekend } from '@/lib/schedule'
import { PARTS } from '@/data/parts'
import GanttBar from './GanttBar.vue'
import { usePermission } from '@/lib/permissions'

const DAY_WIDTH = 22
const TASKLIST_WIDTH = 340
/** 1 倍速時每一天停留的毫秒數 */
const PLAY_INTERVAL = 420

const props = defineProps<{ jumpToStepId?: string | null }>()

const store = useScheduleStore()
const viewer = useViewerStore()
const can = usePermission()
const gridEl = ref<HTMLElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
const jumpHighlightId = ref<string | null>(null)
let jumpHighlightTimer: number | undefined

watch(
  () => props.jumpToStepId,
  async (id) => {
    if (!id) return
    await nextTick()
    const scroll = scrollEl.value
    const task = scroll
      ? [...scroll.querySelectorAll<HTMLElement>('.task')].find((el) => el.dataset.stepId === id)
      : null
    if (!scroll || !task) return

    scroll.scrollTo({
      top: Math.max(0, task.offsetTop - scroll.clientHeight / 2 + task.offsetHeight / 2),
      behavior: 'smooth',
    })
    jumpHighlightId.value = id
    if (jumpHighlightTimer !== undefined) window.clearTimeout(jumpHighlightTimer)
    jumpHighlightTimer = window.setTimeout(() => {
      jumpHighlightId.value = null
      jumpHighlightTimer = undefined
    }, 2200)
  },
)

/** 時間軸留 3 天餘裕，拖長條往後移時不會馬上撞到邊界 */
const totalDays = computed(() => Math.max(Math.ceil(store.projectDays) + 3, 10))

const days = computed(() =>
  Array.from({ length: totalDays.value }, (_, i) => {
    const date = dayToDate(store.projectStartDate, i)
    return {
      i,
      date,
      weekend: isWeekend(date),
      label: String(date.getDate()),
      firstOfMonth: date.getDate() === 1 || i === 0,
      monthLabel: `${date.getMonth() + 1}月`,
    }
  }),
)

const cursorEnabled = computed({
  get: () => store.cursorDay !== null,
  set: (on: boolean) => {
    if (!on) {
      stop()
      store.cursorDay = null
      return
    }
    viewer.setCameraTourEnabled(true)
    viewer.progressFilterSuppressed = false
    store.cursorDay = 0
    // 設備都在機房裡，外牆不透視就看不出進度變化
    viewer.setRoomCutaway(true)
  },
})

const cameraTourToggle = computed({
  get: () => viewer.cameraTourEnabled && !viewer.freeCameraMode,
  set: (on: boolean) => viewer.setCameraTourEnabled(on),
})

const playing = ref(false)
let timer: number | undefined

function clearTimer() {
  if (timer !== undefined) {
    clearInterval(timer)
    timer = undefined
  }
}

function stop() {
  playing.value = false
  clearTimer()
}

/** 播放動畫時回到進度視圖：設備維持原始不透明材質，只有建築外殼透視。 */
function clearTaskHighlightForPlayback() {
  store.selectedId = null
  viewer.isolatedId = null
  viewer.highlightedIds = new Set()
}

/** 依目前倍速重新起算計時器；改倍速時立即生效，不必等當前這一天走完 */
function startTimer() {
  clearTimer()
  timer = window.setInterval(() => {
    if (store.cursorDay === null || store.cursorDay >= store.projectDays) {
      stop()
      return
    }
    store.cursorDay += 1
  }, PLAY_INTERVAL / store.playSpeed)
}

/** 從頭播放一次安裝過程；播到最後一天自動停下 */
function play() {
  if (playing.value) {
    stop()
    return
  }
  viewer.progressFilterSuppressed = false
  viewer.setCameraTourEnabled(true)
  if (store.cursorDay === null || store.cursorDay >= store.projectDays) {
    cursorEnabled.value = true
    store.cursorDay = 0
  }
  clearTaskHighlightForPlayback()
  // 設備在機房內，播放時外殼保留透視；設備本身則由上方清除隔離後恢復不透明。
  viewer.setRoomCutaway(true)
  playing.value = true
  startTimer()
}

watch(
  () => store.playSpeed,
  () => {
    if (playing.value) startTimer()
  },
)

onBeforeUnmount(() => {
  stop()
  if (jumpHighlightTimer !== undefined) window.clearTimeout(jumpHighlightTimer)
})

/** 游標移動時把時間軸捲到看得見游標的位置 */
watch(
  [() => store.cursorDay, () => store.projectDays],
  async ([day, projectDays]) => {
    viewer.cameraTourProgress =
      day === null || projectDays <= 0 ? null : Math.min(1, Math.max(0, day / projectDays))
    if (day === null || !scrollEl.value) return
    await nextTick()
    const el = scrollEl.value
    const x = TASKLIST_WIDTH + day * DAY_WIDTH // 游標在捲動內容中的位置
    // 任務清單是 sticky 的，會蓋住左邊 TASKLIST_WIDTH，那段不算看得見
    const visibleLeft = el.scrollLeft + TASKLIST_WIDTH
    const visibleRight = el.scrollLeft + el.clientWidth - 40
    if (x < visibleLeft || x > visibleRight) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 2)
    }
  },
  { immediate: true },
)

const cursorDate = computed(() =>
  store.cursorDay === null ? null : dayToDate(store.projectStartDate, store.cursorDay),
)

const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`

/**
 * 進度游標 → 3D：顯示已完工及當天施工中的設備，並讓影片運鏡靠近
 * 當下最新開始、且有對應模型的工項。
 */
watch(
  [() => store.installedPartIds, () => store.activeSteps, () => viewer.progressFilterSuppressed],
  ([installedIds, activeRows, filterSuppressed]) => {
    if (filterSuppressed) {
      viewer.progressFilter = null
      viewer.cameraFocusPartId = null
      return
    }
    if (installedIds === null) {
      viewer.progressFilter = null
      viewer.cameraFocusPartId = null
      return
    }

    const visibleIds = new Set(installedIds)
    const focusRows = activeRows
      .filter((row) => row.step.partId)
      .sort((a, b) => b.task.start - a.task.start || a.step.seq - b.step.seq)
    for (const row of focusRows) visibleIds.add(row.step.partId!)

    viewer.progressFilter = visibleIds
    viewer.cameraFocusPartId = focusRows[0]?.step.partId ?? null
  },
  { immediate: true },
)

/** 點任務 → 亮顯所有對應 3D 構件，並隔離主要構件。 */
watch(
  () => store.selectedId,
  (id) => {
    if (playing.value) {
      viewer.highlightedIds = new Set()
      viewer.isolatedId = null
      return
    }
    const step = store.rows.find((r) => r.step.id === id)?.step
    const partIds = step
      ? PARTS.filter((part) => part.installStepId === step.id).map((part) => part.id)
      : []
    if (step?.partId && !partIds.includes(step.partId)) partIds.push(step.partId)
    viewer.highlightedIds = new Set(partIds)
    viewer.isolatedId = partIds[0] ?? null
  },
  { immediate: true },
)

let cursorDrag = false
function cursorDown(e: PointerEvent) {
  stop()
  cursorDrag = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  cursorMove(e)
}
function cursorMove(e: PointerEvent) {
  if (!cursorDrag || !gridEl.value) return
  const x = e.clientX - gridEl.value.getBoundingClientRect().left - TASKLIST_WIDTH
  store.cursorDay = Math.min(totalDays.value, Math.max(0, Math.round(x / DAY_WIDTH)))
}
function cursorUp() {
  cursorDrag = false
}
</script>

<template>
  <div class="gantt">
    <header class="gantt__bar">
      <label class="field">
        開工日
        <input type="date" v-model="store.projectStart" :disabled="!can('wbs.edit')" />
      </label>

      <span class="stat" title="依工作天、前置關係與等待時間計算">
        總工期 <b>{{ store.projectDays }}</b> 天
      </span>
      <span class="stat">完成度 <b>{{ store.overallProgress }}%</b></span>

      <span class="spacer" />

      <label class="field field--toggle" :class="{ 'is-on': cursorEnabled }">
        <input type="checkbox" v-model="cursorEnabled" />
        進度模擬
        <b v-if="cursorDate">{{ fmt(cursorDate) }}（第 {{ store.cursorDay! + 1 }} 天）</b>
      </label>

      <span class="playgroup">
        <button class="play" :class="{ 'is-on': playing }" @click="play()">
          {{ playing ? '暫停' : '播放安裝過程' }}
        </button>
        <select
          class="speed"
          aria-label="播放倍速"
          title="播放倍速"
          :value="store.playSpeed"
          @change="store.playSpeed = Number(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="sp in PLAY_SPEEDS" :key="sp" :value="sp">{{ sp }}×</option>
        </select>
      </span>

      <label class="field field--toggle" :class="{ 'is-on': cameraTourToggle }">
        <input type="checkbox" v-model="cameraTourToggle" />
        影片運鏡
      </label>

      <button v-if="can('wbs.edit')" @click="store.resetAll()">重設排程</button>
    </header>

    <div ref="scrollEl" class="gantt__scroll">
      <div
        ref="gridEl"
        class="grid"
        :style="{ '--dayw': `${DAY_WIDTH}px`, '--taskw': `${TASKLIST_WIDTH}px`, '--cols': totalDays }"
      >
        <!-- 表頭 -->
        <div class="head head--task">
          <span>項次</span>
          <span>施工步驟</span>
          <span>工作天</span>
          <span>進度%</span>
        </div>
        <div class="head head--days" @pointerdown="cursorDown" @pointermove="cursorMove" @pointerup="cursorUp">
          <div
            v-for="d in days"
            :key="d.i"
            class="day"
            :class="{ 'is-weekend': d.weekend, 'is-month': d.firstOfMonth }"
          >
            <em v-if="d.firstOfMonth" class="day__month">{{ d.monthLabel }}</em>
            {{ d.label }}
          </div>
        </div>

        <!-- 每個步驟一列 -->
        <template v-for="row in store.rows" :key="row.step.id">
          <div
            class="task"
            :class="{
              'is-selected': store.selectedId === row.step.id,
              'is-jump-highlight': jumpHighlightId === row.step.id,
              'has-no-model': !row.step.partId,
            }"
            :data-step-id="row.step.id"
            @click="store.selectedId = row.step.id"
          >
            <span class="task__seq">{{ row.step.seq }}</span>
            <span class="task__name" :title="row.step.partId ? '點擊在 3D 中隔離' : '此步驟沒有 3D 模型'">
              {{ row.step.name }}
            </span>
            <input
              class="task__dur"
              type="number"
              min="0.1"
              step="0.5"
              :value="row.duration"
              aria-label="工期（天）"
              :disabled="!can('wbs.edit')"
              @click.stop
              @change="store.setDuration(row.step.id, Number(($event.target as HTMLInputElement).value))"
            />
            <input
              class="task__prog"
              type="number"
              min="0"
              max="100"
              step="10"
              :value="row.progress"
              aria-label="完成度（%）"
              :disabled="!can('progress.verify')"
              @click.stop
              @change="store.setProgress(row.step.id, Number(($event.target as HTMLInputElement).value))"
            />
          </div>
          <div
            class="track"
            :class="{
              'is-selected': store.selectedId === row.step.id,
              'is-jump-highlight': jumpHighlightId === row.step.id,
            }"
          >
            <span
              v-for="d in days"
              :key="d.i"
              class="track__cell"
              :class="{ 'is-weekend': d.weekend }"
            />
            <GanttBar :row="row" :day-width="DAY_WIDTH" />
          </div>
        </template>

        <!-- 進度游標 -->
        <div
          v-if="store.cursorDay !== null"
          class="cursor"
          :style="{ left: `calc(var(--taskw) + ${store.cursorDay} * var(--dayw))` }"
          @pointerdown="cursorDown"
          @pointermove="cursorMove"
          @pointerup="cursorUp"
        >
          <span class="cursor__grip" />
        </div>
      </div>
    </div>

    <p v-if="store.schedule.cycle" class="gantt__error">
      相依關係成環，無法排程：{{ store.schedule.cycle.join('、') }}
    </p>
  </div>
</template>

<style scoped>
.gantt { display: flex; flex-direction: column; height: 100%; min-height: 0; }

.gantt__bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--line);
  flex: none;
}
.spacer { flex: 1; }
.field { display: flex; align-items: center; gap: 6px; color: var(--muted); white-space: nowrap; }
.field input[type='date'] {
  background: #1e2326;
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--text);
  padding: 3px 6px;
  font: inherit;
}
.field--toggle { cursor: pointer; }
.field--toggle.is-on { color: var(--accent); }
.field--toggle b { color: var(--text); font-variant-numeric: tabular-nums; }
.stat { color: var(--muted); white-space: nowrap; }
.stat b { color: var(--text); font-variant-numeric: tabular-nums; }

.gantt__scroll { flex: 1; overflow: auto; min-height: 0; }

.grid {
  position: relative;
  display: grid;
  grid-template-columns: var(--taskw) calc(var(--cols) * var(--dayw));
  align-content: start;
  width: max-content;
  min-width: 100%;
}

.head {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #242a2e;
  border-bottom: 1px solid var(--line);
  height: 34px;
}
.head--task {
  left: 0;
  z-index: 3;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 46px 48px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-right: 1px solid var(--line);
  color: var(--muted);
  font-size: 11px;
}
.head--days { display: flex; }

.day {
  width: var(--dayw);
  flex: none;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 4px;
  font-size: 10px;
  color: var(--muted);
  position: relative;
  border-left: 1px solid #ffffff0d;
}
.day.is-weekend { background: #ffffff08; }
.day.is-month { border-left-color: var(--line); }
.day__month {
  position: absolute;
  top: 3px;
  left: 3px;
  font-style: normal;
  font-size: 9px;
  color: var(--accent);
  white-space: nowrap;
}

.task {
  position: sticky;
  left: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 46px 48px;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px 0 10px;
  background: var(--panel-solid);
  border-right: 1px solid var(--line);
  border-bottom: 1px solid #ffffff08;
  cursor: pointer;
}
.task:hover { background: #ffffff0a; }
.task.is-selected { background: #ffad7a1f; }
.task.is-jump-highlight { animation: jump-task 700ms ease-in-out 3; }
.task.has-no-model .task__name { color: var(--muted); }

.task__seq {
  text-align: right;
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.task__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task__dur, .task__prog {
  width: 100%;
  background: #1e2326;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--text);
  font: inherit;
  font-size: 11px;
  padding: 1px 3px;
  text-align: right;
}

.track {
  position: relative;
  height: 28px;
  border-bottom: 1px solid #ffffff08;
  display: flex;
}
.track.is-selected { background: #ffad7a0a; }
.track.is-jump-highlight { animation: jump-track 700ms ease-in-out 3; }
@keyframes jump-task {
  0%, 100% { background: #ffad7a1f; box-shadow: inset 3px 0 0 var(--accent); }
  50% { background: #ffad7a55; box-shadow: inset 5px 0 0 #ffad7a; }
}
@keyframes jump-track {
  0%, 100% { background: #ffad7a0a; }
  50% { background: #ffad7a24; }
}
.track__cell { width: var(--dayw); flex: none; border-left: 1px solid #ffffff0a; }
.track__cell.is-weekend { background: #ffffff06; }

.cursor {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent);
  z-index: 4;
  cursor: col-resize;
  touch-action: none;
}
.cursor__grip {
  position: absolute;
  top: 34px;
  left: -5px;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: var(--accent);
}

.playgroup { display: flex; }
.play {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right-width: 0;
}
.play.is-on { border-color: var(--accent); color: var(--accent); }

.speed {
  font: inherit;
  color: var(--text);
  background: #1e2326;
  border: 1px solid var(--line);
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  border-radius: 6px;
  padding: 4px 4px 4px 6px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.speed:hover { border-color: var(--accent); color: var(--accent); }

.gantt__error {
  margin: 0;
  padding: 8px 14px;
  color: var(--danger);
  border-top: 1px solid var(--line);
}
</style>
