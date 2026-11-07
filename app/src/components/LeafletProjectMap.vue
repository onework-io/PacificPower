<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L, { type Map as LeafletMap, type Marker } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { ProjectSummary } from '@/data/projects'

const props = defineProps<{ projects: ProjectSummary[]; selectedId: string }>()
const emit = defineEmits<{ select: [project: ProjectSummary] }>()

const mapElement = ref<HTMLDivElement | null>(null)
let map: LeafletMap | null = null
let markers: Marker[] = []

function markerIcon(project: ProjectSummary) {
  const selected = project.id === props.selectedId
  return L.divIcon({
    className: '',
    iconAnchor: [10, 10],
    html: `<div class="leaflet-project-marker${selected ? ' is-selected' : ''}" style="--marker-color:${project.accent}"><i></i><span>${project.location.replace(/市|科學園區|區/g, '')}</span></div>`,
  })
}

function renderMarkers() {
  if (!map) return
  markers.forEach((marker) => marker.remove())
  markers = props.projects.map((project) => {
    const marker = L.marker([project.lat, project.lng], {
      icon: markerIcon(project),
      title: project.name,
      riseOnHover: true,
    }).addTo(map!)
    marker.bindTooltip(`<strong>${project.name}</strong><br>${project.status} · ${project.progress}%`, {
      direction: 'top', offset: [0, -12], className: 'project-map-tooltip',
    })
    marker.on('click', () => emit('select', project))
    return marker
  })
}

onMounted(() => {
  if (!mapElement.value) return
  map = L.map(mapElement.value, {
    center: [23.72, 120.96],
    zoom: 7,
    minZoom: 6,
    maxZoom: 18,
    zoomControl: false,
    attributionControl: true,
  })
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map)
  renderMarkers()
  requestAnimationFrame(() => map?.invalidateSize())
})

watch(() => [props.projects, props.selectedId] as const, renderMarkers, { deep: true })

onBeforeUnmount(() => {
  map?.remove()
  map = null
  markers = []
})
</script>

<template><div ref="mapElement" class="leaflet-project-map" /></template>

<style>
.leaflet-project-map { position:absolute; inset:0; z-index:0; background:#0c1726; }
.leaflet-project-map .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) saturate(.35) brightness(.58) contrast(1.25); }
.leaflet-project-map .leaflet-control-zoom { margin:0 18px 18px 0; border:1px solid #39516d; box-shadow:0 8px 22px #0008; }
.leaflet-project-map .leaflet-control-zoom a { width:32px;height:32px;line-height:30px;border-color:#30445f;background:#132238;color:#9bdfff; }
.leaflet-project-map .leaflet-control-zoom a:hover { background:#1c3551;color:#fff; }
.leaflet-project-map .leaflet-control-attribution { background:#0a1420cc;color:#71839b;font-size:8px; }
.leaflet-project-map .leaflet-control-attribution a { color:#7dccf2; }
.leaflet-project-marker { position:relative;display:flex;align-items:center;gap:7px;width:max-content;padding:5px 10px 5px 6px;border:1px solid color-mix(in srgb,var(--marker-color) 75%,#31435a);border-radius:99px;background:#0d1929ed;color:#e2edf8;box-shadow:0 7px 18px #000b;white-space:nowrap;font:600 10px/1.2 system-ui,-apple-system,'Noto Sans TC',sans-serif;transition:transform .18s,box-shadow .18s}.leaflet-project-marker i{width:10px;height:10px;border:2px solid white;border-radius:50%;background:var(--marker-color);box-shadow:0 0 0 4px color-mix(in srgb,var(--marker-color) 22%,transparent),0 0 18px var(--marker-color)}.leaflet-project-marker:hover,.leaflet-project-marker.is-selected{z-index:5;transform:scale(1.12);box-shadow:0 8px 24px #000d,0 0 18px color-mix(in srgb,var(--marker-color) 30%,transparent)}.leaflet-project-marker.is-selected::after{content:'';position:absolute;inset:-6px;border:1px solid var(--marker-color);border-radius:99px;animation:leafletPinPulse 1.8s infinite}@keyframes leafletPinPulse{0%{opacity:.9;transform:scale(.9)}80%,100%{opacity:0;transform:scale(1.25)}}.project-map-tooltip{border:1px solid #38516e!important;border-radius:7px!important;background:#101d2eee!important;color:#dbe8f5!important;box-shadow:0 7px 22px #0009!important;font:10px/1.5 system-ui,-apple-system,'Noto Sans TC',sans-serif!important}.project-map-tooltip::before{border-top-color:#38516e!important}
</style>
