<script setup lang="ts">
import { ref } from 'vue'
import ProgressCurveView from './ProgressCurveView.vue'
import CostCurveView from './CostCurveView.vue'

const mode = ref<'progress' | 'cost'>('progress')
</script>

<template>
  <div class="analysis">
    <nav>
      <button type="button" :class="{ active: mode === 'progress' }" @click="mode = 'progress'">進度 S 曲線</button>
      <button type="button" :class="{ active: mode === 'cost' }" @click="mode = 'cost'">人工時 S 曲線</button>
      <span>{{ mode === 'progress' ? '分析 WBS 計畫與實際進度' : '分析計畫人工時與實際人工時落差' }}</span>
    </nav>
    <div class="body">
      <ProgressCurveView v-if="mode === 'progress'" />
      <CostCurveView v-else />
    </div>
  </div>
</template>

<style scoped>
.analysis { display: flex; flex-direction: column; height: 100%; min-height: 0; }
nav { display: flex; align-items: center; gap: 5px; padding: 6px 14px; border-bottom: 1px solid var(--line); background: #1b2022; }
nav button { padding: 4px 10px; border: 1px solid var(--line); border-radius: 5px; color: var(--muted); }
nav button.active { border-color: #ffad7a88; color: var(--accent); background: #ffad7a14; }
nav span { margin-left: 6px; color: var(--muted); font-size: 10px; }
.body { flex: 1; min-height: 0; }
</style>
