<script setup lang="ts">
import { ref } from 'vue'
import { useViewer } from '@/composables/useViewer'
import { useViewerStore } from '@/stores/viewer'
import { usePoiStore } from '@/stores/poi'
import ExplodeSlider from './ExplodeSlider.vue'
import LoadProgress from './LoadProgress.vue'
import PoiCard from './PoiCard.vue'
import StepSubtitle from './StepSubtitle.vue'
import { usePermission } from '@/lib/permissions'

const host = ref<HTMLDivElement | null>(null)
const { fatal, placePoiAt, activePoiScreen } = useViewer(host)
const store = useViewerStore()
const poi = usePoiStore()
const can = usePermission()

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
