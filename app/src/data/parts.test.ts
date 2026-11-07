import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INSTALL_STEPS } from './installSteps'
import { PARTS } from './parts'

describe('updated GLB catalog', () => {
  it('lists each id and file exactly once', () => {
    expect(new Set(PARTS.map((p) => p.id)).size).toBe(PARTS.length)
    expect(new Set(PARTS.map((p) => p.file)).size).toBe(PARTS.length)
  })

  it('has a compressed model for every catalog entry', () => {
    for (const part of PARTS) {
      const file = resolve(process.cwd(), 'public/models', part.file)
      expect(existsSync(file), `${part.file} 應存在於 public/models`).toBe(true)
      expect(statSync(file).size, `${part.file} 的 bytes 應與壓縮檔一致`).toBe(part.bytes)
    }
  })

  it('maps every equipment model to an existing installation step', () => {
    const stepIds = new Set(INSTALL_STEPS.map((step) => step.id))
    for (const part of PARTS.filter((p) => p.kind === 'equipment')) {
      expect(part.installStepId, `${part.name} 應對應甘特步驟`).toBeTruthy()
      expect(stepIds.has(part.installStepId!), `${part.name} 的甘特步驟應存在`).toBe(true)
    }
  })
})
