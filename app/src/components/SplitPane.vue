<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue?: number
  rightOpen?: boolean
}>(), {
  modelValue: 0.6,
  rightOpen: true,
})

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const ratio = computed({
  get: () => props.modelValue,
  set: (value: number) => emit('update:modelValue', value),
})
const rootEl = ref<HTMLElement | null>(null)
let dragging = false

function isStacked(): boolean {
  return window.matchMedia('(max-width: 1100px)').matches
}

function clampRatio(value: number, rect: DOMRect): number {
  if (isStacked()) return Math.min(0.7, Math.max(0.38, value))
  // 3D 至少 520px，排程至少 420px；空間不足時仍保留雙方可用範圍。
  const min = Math.min(0.55, 520 / Math.max(rect.width, 1))
  const max = Math.max(min, 1 - Math.min(0.48, 420 / Math.max(rect.width, 1)))
  return Math.min(max, Math.max(min, value))
}

function onDown(e: PointerEvent) {
  dragging = true
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent) {
  if (!dragging || !rootEl.value) return
  const r = rootEl.value.getBoundingClientRect()
  const raw = isStacked() ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width
  ratio.value = clampRatio(raw, r)
}

function onUp() {
  if (!dragging) return
  dragging = false
}

function onKeydown(e: KeyboardEvent) {
  const direction = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
    ? -1
    : e.key === 'ArrowRight' || e.key === 'ArrowDown'
      ? 1
      : 0
  if (!direction || !rootEl.value) return
  e.preventDefault()
  ratio.value = clampRatio(ratio.value + direction * 0.03, rootEl.value.getBoundingClientRect())
}

onBeforeUnmount(onUp)
</script>

<template>
  <div
    ref="rootEl"
    class="split"
    :class="{ 'is-right-closed': !rightOpen }"
    :style="{ '--ratio': ratio }"
  >
    <div class="split__pane"><slot name="left" /></div>
    <div
      class="split__handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="調整 3D 與排程寬度"
      tabindex="0"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @keydown="onKeydown"
    />
    <div class="split__pane"><slot name="right" /></div>
  </div>
</template>

<style scoped>
.split {
  display: grid;
  grid-template-columns: calc(var(--ratio) * 100%) 5px 1fr;
  height: 100%;
  min-height: 0;
}
.split__pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  /* 讓插槽內容（3D 舞台、甘特圖）撐滿整個窗格，否則高度會塌成 0 */
  display: flex;
}
.split__pane > * { flex: 1; min-width: 0; min-height: 0; }
.split__handle {
  cursor: col-resize;
  background: var(--line);
  touch-action: none;
}
.split__handle:hover { background: var(--accent); }
.split.is-right-closed { grid-template-columns: 1fr 0 0; }
.split.is-right-closed .split__handle { display: none; }

@media (max-width: 1100px) {
  .split:not(.is-right-closed) {
    grid-template-columns: 1fr;
    grid-template-rows: calc(var(--ratio) * 100%) 5px 1fr;
  }
  .split:not(.is-right-closed) .split__handle {
    cursor: row-resize;
  }
}
</style>
