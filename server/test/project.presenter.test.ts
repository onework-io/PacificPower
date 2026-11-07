import { describe, expect, it } from 'vitest'
import { presentProject } from '../src/projects/project.presenter.js'

describe('presentProject', () => {
  it('maps database numerics and timestamps to the API contract', () => {
    const result = presentProject({
      id: 'a5ff6bdb-d3f6-4f9a-8515-090fbbbd3410',
      organizationId: 'f38df911-8cf7-4d96-912d-148f4a8c98c6',
      code: 'AMP-2026-007', name: '測試專案', description: '', clientName: '', location: '',
      latitude: '25.033000', longitude: '121.565400', generatorModel: 'RZ2000', crewName: '',
      contractAmount: '12000000.00', status: 'planning', riskStatus: 'normal',
      startDate: '2026-10-17', endDate: '2027-01-17', managerId: null,
      version: 2, createdBy: null, deletedAt: null, deletedBy: null,
      deletionReason: null, statusBeforeArchive: null,
      createdAt: new Date('2026-10-17T00:00:00Z'), updatedAt: new Date('2026-10-17T01:00:00Z'),
      managerName: null, progressPct: '42.5000',
    })

    expect(result.latitude).toBe(25.033)
    expect(result.contractAmount).toBe(12_000_000)
    expect(result.progressPct).toBe(42.5)
    expect(result.version).toBe(2)
    expect(result.updatedAt).toBe('2026-10-17T01:00:00.000Z')
  })
})
