import type { InferSelectModel } from 'drizzle-orm'
import type { projects } from '../database/schema.js'

type ProjectRow = InferSelectModel<typeof projects> & {
  managerName?: string | null
  progressPct?: string | null
}

export function presentProject(row: ProjectRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    description: row.description,
    clientName: row.clientName,
    location: row.location,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    generatorModel: row.generatorModel,
    crewName: row.crewName,
    contractAmount: row.contractAmount === null ? null : Number(row.contractAmount),
    status: row.status,
    riskStatus: row.riskStatus,
    startDate: row.startDate,
    endDate: row.endDate,
    managerId: row.managerId,
    managerName: row.managerName ?? null,
    activeModelVersionId: row.activeModelVersionId,
    activeWbsVersionId: row.activeWbsVersionId,
    progressPct: Number(row.progressPct ?? 0),
    version: row.version,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
