<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L, { type Map as LeafletMap, type Marker } from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps<{ lat: number; lng: number }>()
const emit = defineEmits<{ change: [lat: number, lng: number] }>()

const mapElement = ref<HTMLDivElement | null>(null)
let map: LeafletMap | null = null
let marker: Marker | null = null

function updateMarker(lat: number, lng: number, center = false) {
  if (!map) return
  if (!marker) {
    marker = L.marker([lat, lng], { draggable: true, title: '專案位置' }).addTo(map)
    marker.on('dragend', () => {
      const position = marker?.getLatLng()
      if (position) emit('change', position.lat, position.lng)
    })
  } else {
    marker.setLatLng([lat, lng])
  }
  if (center) map.setView([lat, lng], 16)
}

onMounted(() => {
  if (!mapElement.value) return
  map = L.map(mapElement.value, {
    center: [props.lat, props.lng], zoom: 14, minZoom: 6, maxZoom: 19,
    zoomControl: false, attributionControl: true,
  })
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map)
  map.on('click', (event) => emit('change', event.latlng.lat, event.latlng.lng))
  updateMarker(props.lat, props.lng)
  requestAnimationFrame(() => map?.invalidateSize())
})

watch(() => [props.lat, props.lng] as const, ([lat, lng], previous) => {
  updateMarker(lat, lng, Boolean(previous && (lat !== previous[0] || lng !== previous[1])))
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
  marker = null
})
</script>

<template><div ref="mapElement" class="address-location-picker" aria-label="施工地址地圖位置" /></template>

<style>
.address-location-picker{height:180px;border:1px solid #48565e;border-radius:9px;overflow:hidden;background:#202629}
.address-location-picker .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) saturate(.35) brightness(.62) contrast(1.2)}
.address-location-picker .leaflet-control-zoom{margin:0 10px 10px 0;border:1px solid #52626b;box-shadow:0 5px 16px #0008}
.address-location-picker .leaflet-control-zoom a{border-color:#48565e;background:#2b3337;color:#ffad7a}
.address-location-picker .leaflet-control-attribution{background:#1c2225cc;color:#8395a0;font-size:7px}
.address-location-picker .leaflet-control-attribution a{color:#ffad7a}
</style>
