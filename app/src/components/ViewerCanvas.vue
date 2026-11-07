<script setup lang="ts">
import { computed, ref } from 'vue'
import { useViewer } from '@/composables/useViewer'
import { useViewerStore } from '@/stores/viewer'
import { usePoiStore } from '@/stores/poi'
import { SHELL_PART_ID } from '@/data/parts'
import ExplodeSlider from './ExplodeSlider.vue'
import LoadProgress from './LoadProgress.vue'
import PoiCard from './PoiCard.vue'
import StepSubtitle from './StepSubtitle.vue'
import { usePermission } from '@/lib/permissions'

const host = ref<HTMLDivElement | null>(null)
const { fatal, resetView, placePoiAt, activePoiScreen } = useViewer(host)
const store = useViewerStore()
const poi = usePoiStore()
const can = usePermission()

/** 外牆隱藏與側欄「機房外殼」勾選框是同一個狀態，兩邊操作會互相反映 */
const shellHidden = computed(() => !store.isVisible(SHELL_PART_ID))
const roomCutaway = computed(() => store.shellGhost && store.roomFloor)

function toggleShellHidden() {
  store.setVisible(SHELL_PART_ID, shellHidden.value)
}

function toggleRoomCutaway() {
  store.setRoomCutaway(!roomCutaway.value)
}

function toggleCameraTour() {
  store.setCameraTourEnabled(!(store.cameraTourEnabled && !store.freeCameraMode))
}

// 拖曳轉動視角時不應該放下標記，因此比對按下與放開的位移量
let down: { x: number; y: number } | null = null
const DRAG_SLOP = 4

function onPointerDown(e: PointerEvent) {
  down = { x: e.clientX, y: e.clientY }
}

/** 在 capture 階段先解鎖，OrbitControls 才能從同一次 pointerdown 開始拖曳。 */
function unlockCameraForInteraction() {
  if (store.cameraTourEnabled || !store.freeCameraMode) store.unlockCamera()
}

function onPointerUp(e: PointerEvent) {
  const start = down
  down = null
  if (!can('model.mapping.edit') || !poi.editMode || !start) return
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_SLOP) return
  placePoiAt(e.clientX, e.clientY)
}
</script>

<template>
  <div class="stage" :class="{ 'is-placing': poi.editMode }">
    <div
      ref="host"
      class="stage__canvas"
      @pointerdown.capture="unlockCameraForInteraction"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
    />
    <div v-if="fatal" class="fatal">{{ fatal }}</div>
    <template v-else>
      <div class="overlay toolbar">
        <button
          v-if="can('model.mapping.edit')"
          class="toolbar__btn"
          :class="{ 'is-on': poi.editMode }"
          :aria-pressed="poi.editMode"
          title="開啟後，點模型表面即可新增標記"
          @click="poi.editMode = !poi.editMode"
        >
          標記 <span v-if="poi.pois.length" class="toolbar__badge">{{ poi.pois.length }}</span>
        </button>
        <span
          v-if="poi.syncState !== 'local'"
          class="toolbar__sync"
          :class="`is-${poi.syncState}`"
          :title="poi.syncMessage"
        >{{ poi.syncState === 'error' ? '同步失敗' : poi.syncState === 'synced' ? '已同步' : '同步中…' }}</span>
        <span class="toolbar__sep" />
        <button
          class="toolbar__btn"
          :class="{ 'is-on': shellHidden }"
          :aria-pressed="shellHidden"
          title="機房外牆整個隱藏"
          @click="toggleShellHidden()"
        >
          隱藏外牆
        </button>
        <button
          class="toolbar__btn"
          :class="{ 'is-on': roomCutaway }"
          :aria-pressed="roomCutaway"
          :disabled="shellHidden"
          title="同時切換外牆透視與機房實體地板"
          @click="toggleRoomCutaway()"
        >
          機房剖視
        </button>
        <span class="toolbar__sep" />
        <button
          class="toolbar__btn"
          :class="{ 'is-on': store.cameraTourEnabled && !store.freeCameraMode }"
          :aria-pressed="store.cameraTourEnabled && !store.freeCameraMode"
          title="依照安裝進度啟用或解除影片運鏡"
          @click="toggleCameraTour()"
        >影片運鏡</button>
        <button
          class="toolbar__btn"
          title="顯示全部構件、回到預設視角並解除影片運鏡鎖定"
          @click="resetView()"
        >重設視角</button>
      </div>

      <p v-if="poi.editMode" class="overlay hint">點模型表面新增標記 · 拖曳仍可轉動視角</p>

      <aside class="campus-summary" aria-label="園區容量與模型來源">
        <strong>250 MW <small>園區總用電容量</small></strong>
        <span>8 個機房區 · 2,000 機櫃位置 · 200 MW IT 規劃值</span>
        <span>250 MW 概念模型｜評估文件為 50 MW，容量差異待確認</span>
        <nav><a href="downloads/Campus_250MW.blend" download>園區 Blender</a><a href="downloads/Rack_CDU_Detailed.blend" download>機櫃／CDU 細節</a><a href="models/assets.json" download>設備位置表</a></nav>
      </aside>
      <StepSubtitle />
      <PoiCard :screen="activePoiScreen" />
      <ExplodeSlider />
      <LoadProgress />
    </template>
  </div>
</template>

<style scoped>
.campus-summary { position:absolute; left:16px; top:68px; display:grid; gap:6px; max-width:calc(100% - 32px); padding:12px 16px; border:1px solid #39546b; border-radius:10px; background:#101d2bde; color:#b5cddd; font-size:11px; pointer-events:auto; }
.campus-summary strong { font-size:22px; color:#63d9fa; }
.campus-summary small { font-size:11px; font-weight:400; }
.campus-summary nav { display:flex; flex-wrap:wrap; gap:14px; }
.campus-summary a { color:#88e3ff; }
@media(max-width:700px) { .campus-summary { top:104px; font-size:10px; } }

.stage.is-placing .stage__canvas { cursor: crosshair; }
.toolbar__sync { color: #fbbf24; font-size: 9px; white-space: nowrap; }
.toolbar__sync.is-synced { color: #6ee7b7; }
.toolbar__sync.is-error { color: #fb7185; }

.toolbar {
  right: 16px;
  top: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
}
.toolbar__btn { border: 0; padding: 4px 10px; border-radius: 5px; }
.toolbar__btn:hover { background: #ffffff12; }
.toolbar__btn:disabled { opacity: 0.35; cursor: default; }
.toolbar__btn:disabled:hover { background: transparent; color: inherit; }
.toolbar__sep { width: 1px; align-self: stretch; background: var(--line); margin: 0 2px; }

.toolbar__badge {
  display: inline-block;
  min-width: 16px;
  padding: 0 4px;
  margin-left: 2px;
  border-radius: 8px;
  background: #ffffff1f;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.toolbar__btn.is-on {
  background: var(--accent);
  color: #06121d;
  font-weight: 600;
}
.toolbar__btn.is-on:hover { background: var(--accent); }
.toolbar__btn.is-on .toolbar__badge { background: #06121d29; }

.hint {
  left: 50%;
  top: 16px;
  transform: translateX(-50%);
  margin: 0;
  padding: 5px 12px;
  color: var(--muted);
  white-space: nowrap;
}
</style>
