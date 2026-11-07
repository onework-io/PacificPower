<script setup lang="ts">
import { computed } from 'vue'
import AssessmentPlanView from './AssessmentPlanView.vue'
import type { ProjectSummary } from '@/data/projects'

type Tab = 'gantt' | 'wbs' | 'mapping' | 'network' | 'field' | 'daily' | 'files' | 'cost' | 'scurve' | 'report' | 'assistant' | 'versions'
const props = defineProps<{ projectId: string; project: ProjectSummary; projectStart?: string; initialTab?: Tab }>()
// Existing project shortcuts now open the corresponding current PISG workspace.
const initialView = computed(() => {
  const views: Record<Tab, string> = {
    gantt: 'gantt', wbs: 'wbs', mapping: 'mapping', network: 'pdm',
    field: 'inspections', daily: 'home', files: 'documents', cost: 'home',
    scurve: 'curves', report: 'delivery', assistant: 'home', versions: 'documents',
  }
  return props.initialTab ? views[props.initialTab] : 'home'
})
</script>

<template>
  <div class="panel">
    <AssessmentPlanView :project-id="projectId" :initial-view="initialView" />
  </div>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--panel-solid); }
</style>
