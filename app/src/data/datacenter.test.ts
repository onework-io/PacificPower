import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PARTS } from './parts'
import { INSTALL_STEPS } from './installSteps'
import { computeSchedule } from '@/lib/schedule'

describe('data center model and construction schedule', () => {
  it('loads only exported data center groups with mesh content', () => {
    expect(PARTS).toHaveLength(17)
    for (const part of PARTS) {
      const bytes = readFileSync(resolve('public/models', part.file))
      expect(bytes.toString('utf8', 0, 4)).toBe('glTF')
      const jsonLength = bytes.readUInt32LE(12)
      const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength))
      expect(gltf.meshes.length).toBeGreaterThan(0)
      // Export each group only, never include the entire Blender scene again.
      expect(gltf.nodes.every((node: { name: string }) => node.name.startsWith(part.id + '_'))).toBe(true)
    }
  })
  it('instances the detailed rack geometry with 250 transforms per hall', () => {
    for (const part of PARTS.filter(p => p.id.endsWith('-racks'))) {
      const bytes = readFileSync(resolve('public/models', part.file))
      const size = bytes.readUInt32LE(12)
      const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + size))
      expect(gltf.extensionsRequired).toContain('EXT_mesh_gpu_instancing')
      for (const node of gltf.nodes) {
        const index = node.extensions.EXT_mesh_gpu_instancing.attributes.TRANSLATION
        const accessor = gltf.accessors[index]
        expect(accessor.count).toBe(250)
        expect(accessor.type).toBe('VEC3')
        // Blender Z-up positions become glTF Y-up; rack bases remain at 0.3 m.
        expect(accessor.min[1]).toBeCloseTo(0.3)
        expect(accessor.max[1]).toBeCloseTo(0.3)
      }
      expect(bytes.length).toBeLessThan(1_000_000)
    }
  })
  it('retains 2000 unique rack IDs mapped to eight rendered hall groups', () => {
    const assets = JSON.parse(readFileSync(resolve('public/models/assets.json'), 'utf8')) as Array<{assetId:string;partId:string;planningITkW:number}>
    expect(assets).toHaveLength(2000)
    expect(new Set(assets.map(a => a.assetId)).size).toBe(2000)
    expect(assets.reduce((sum,a)=>sum+a.planningITkW,0)).toBe(200000)
    for (let i=1;i<=8;i++) {
      const id = `dc${String(i).padStart(2,'0')}-racks`
      expect(PARTS.some(p=>p.id===id)).toBe(true)
      expect(assets.filter(a=>a.partId===id)).toHaveLength(250)
    }
  })
  it('has a schedulable WBS with valid dependencies and bidirectional model mappings', () => {
    const ids = new Set(INSTALL_STEPS.map(s=>s.id))
    for (const s of INSTALL_STEPS) {
      for (const dep of s.deps) expect(ids.has(dep)).toBe(true)
      if (s.partId) expect(PARTS.some(p=>p.id===s.partId && p.installStepId===s.id)).toBe(true)
    }
    const result = computeSchedule(INSTALL_STEPS)
    expect(result.tasks.size).toBe(INSTALL_STEPS.length)
    expect(result.tasks.get('dc-handover')!.finish).toBe(result.projectDays)
  })
})
