import { createHash } from 'node:crypto'
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import type { AuthenticatedIdentity } from '../auth/auth.types.js'
import { AuthorizationService } from '../authz/authorization.service.js'
import { DATABASE, type Database } from '../database/database.module.js'
import {
  auditLogs, idempotencyKeys, modelParts, modelSets, modelTemplateParts, modelTemplates,
  modelVersions, pois, projects, wbsTasks,
} from '../database/schema.js'
import type { ApplyModelTemplateDto, CreatePoiDto, ReplaceModelPartMappingsDto, UpdatePoiDto } from './model.dto.js'

@Injectable()
export class ModelsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
  ) {}

  async listTemplates(identity: AuthenticatedIdentity) {
    await this.authz.assert(identity, 'model.view')
    const templates = await this.db.select().from(modelTemplates).where(and(
      eq(modelTemplates.organizationId, identity.organizationId), eq(modelTemplates.status, 'active'),
    )).orderBy(asc(modelTemplates.name))
    const result = []
    for (const template of templates) {
      const [countRow] = await this.db.select({ count: sql<number>`count(*)::int` })
        .from(modelTemplateParts).where(eq(modelTemplateParts.templateId, template.id))
      result.push({ ...template, partCount: Number(countRow?.count ?? 0) })
    }
    return result
  }

  async getProjectModel(projectId: string, identity: AuthenticatedIdentity) {
    const project = await this.assertProject(projectId, identity, 'model.view')
    if (!project.activeModelVersionId) return { projectId, activeVersion: null, parts: [] }
    const [version] = await this.db.select().from(modelVersions).where(and(
      eq(modelVersions.id, project.activeModelVersionId), eq(modelVersions.projectId, projectId),
    )).limit(1)
    if (!version) return { projectId, activeVersion: null, parts: [] }
    const parts = await this.db.select().from(modelParts)
      .where(eq(modelParts.modelVersionId, version.id)).orderBy(asc(modelParts.groupName), asc(modelParts.name))
    return { projectId, activeVersion: version, parts }
  }

  async applyTemplate(
    projectId: string, dto: ApplyModelTemplateDto, idempotencyKey: string,
    identity: AuthenticatedIdentity,
  ) {
    await this.assertProject(projectId, identity, 'model.upload')
    const operation = `apply-model-template:${projectId}`
    const requestHash = createHash('sha256').update(JSON.stringify(dto)).digest('hex')
    const [existingRequest] = await this.db.select().from(idempotencyKeys).where(and(
      eq(idempotencyKeys.organizationId, identity.organizationId),
      eq(idempotencyKeys.operation, operation), eq(idempotencyKeys.key, idempotencyKey),
    )).limit(1)
    if (existingRequest) {
      if (existingRequest.requestHash !== requestHash) throw new ConflictException('Idempotency key was already used')
      if (existingRequest.responseBody) return existingRequest.responseBody
    }

    const [template] = await this.db.select().from(modelTemplates).where(and(
      eq(modelTemplates.organizationId, identity.organizationId),
      eq(modelTemplates.code, dto.templateCode), eq(modelTemplates.status, 'active'),
    )).limit(1)
    if (!template) throw new NotFoundException('Active model template not found')
    const templateParts = await this.db.select().from(modelTemplateParts)
      .where(eq(modelTemplateParts.templateId, template.id))

    return this.db.transaction(async (tx) => {
      let [modelSet] = await tx.select().from(modelSets).where(eq(modelSets.projectId, projectId)).limit(1)
      if (!modelSet) [modelSet] = await tx.insert(modelSets).values({ projectId, name: '主模型' }).returning()
      if (!modelSet) throw new Error('Model set could not be created')
      const [numberRow] = await tx.select({ value: max(modelVersions.versionNumber) }).from(modelVersions)
        .where(eq(modelVersions.modelSetId, modelSet.id))
      const versionNumber = Number(numberRow?.value ?? 0) + 1
      await tx.update(modelVersions).set({ status: 'archived' }).where(and(
        eq(modelVersions.projectId, projectId), eq(modelVersions.status, 'published'),
      ))
      const now = new Date()
      const [version] = await tx.insert(modelVersions).values({
        modelSetId: modelSet.id, projectId, versionNumber, status: 'published',
        sourceTemplateId: template.id, manifest: template.manifest as Record<string, unknown>,
        uploadedBy: identity.userId, publishedAt: now,
      }).returning()
      if (!version) throw new Error('Model version insert returned no row')

      const tasks = await tx.select({ id: wbsTasks.id, stableKey: wbsTasks.stableKey }).from(wbsTasks)
        .where(and(eq(wbsTasks.projectId, projectId), isNull(wbsTasks.archivedAt)))
      const taskIdByStableKey = new Map(tasks.map((task) => [task.stableKey, task.id]))
      if (templateParts.length) await tx.insert(modelParts).values(templateParts.map((part) => ({
        modelVersionId: version.id, projectId,
        taskId: part.defaultWbsStableKey ? (taskIdByStableKey.get(part.defaultWbsStableKey) ?? null) : null,
        partKey: part.partKey, name: part.name, groupName: part.groupName, kind: part.kind,
        fileId: part.fileId, byteSize: part.byteSize,
        metadata: {
          ...(part.metadata as Record<string, unknown>),
          defaultWbsStableKey: part.defaultWbsStableKey,
        },
      })))
      const [updatedProject] = await tx.update(projects).set({
        activeModelVersionId: version.id, version: sql`${projects.version} + 1`, updatedAt: now,
      }).where(and(eq(projects.id, projectId), eq(projects.organizationId, identity.organizationId)))
        .returning({ version: projects.version })
      if (!updatedProject) throw new ConflictException('Project was changed while applying the model template')
      const response = {
        projectId, templateId: template.id, templateCode: template.code,
        modelVersionId: version.id, versionNumber, status: version.status,
        partCount: templateParts.length, projectVersion: updatedProject.version,
      }
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: 'model.template.applied', resourceType: 'model_version', resourceId: version.id,
        afterData: response, requestId: identity.requestId,
      })
      await tx.insert(idempotencyKeys).values({
        organizationId: identity.organizationId, operation, key: idempotencyKey, requestHash,
        responseStatus: 201, responseBody: response, expiresAt: new Date(Date.now() + 86_400_000),
      })
      return response
    })
  }

  async replacePartMappings(
    projectId: string,
    dto: ReplaceModelPartMappingsDto,
    identity: AuthenticatedIdentity,
  ) {
    const project = await this.assertProject(projectId, identity, 'model.mapping.edit')
    if (!project.activeModelVersionId) throw new ConflictException('Project has no active model version')

    const duplicatePartIds = dto.mappings
      .map((mapping) => mapping.partId)
      .filter((partId, index, values) => values.indexOf(partId) !== index)
    if (duplicatePartIds.length) throw new BadRequestException('Each model part can only appear once')

    const partIds = dto.mappings.map((mapping) => mapping.partId)
    const parts = await this.db.select({
      id: modelParts.id, taskId: modelParts.taskId, partKey: modelParts.partKey,
    }).from(modelParts).where(and(
      eq(modelParts.projectId, projectId),
      eq(modelParts.modelVersionId, project.activeModelVersionId),
      inArray(modelParts.id, partIds),
    ))
    if (parts.length !== partIds.length) {
      throw new BadRequestException('One or more model parts are not in the active project model')
    }

    const requestedTaskIds = [...new Set(dto.mappings.map((mapping) => mapping.taskId).filter((id): id is string => Boolean(id)))]
    if (requestedTaskIds.length) {
      const tasks = await this.db.select({ id: wbsTasks.id }).from(wbsTasks).where(and(
        eq(wbsTasks.projectId, projectId), isNull(wbsTasks.archivedAt), inArray(wbsTasks.id, requestedTaskIds),
      ))
      if (tasks.length !== requestedTaskIds.length) {
        throw new BadRequestException('One or more WBS tasks do not belong to this project')
      }
    }

    const before = parts.map((part) => ({ partId: part.id, partKey: part.partKey, taskId: part.taskId }))
    await this.db.transaction(async (tx) => {
      for (const mapping of dto.mappings) {
        await tx.update(modelParts).set({ taskId: mapping.taskId }).where(and(
          eq(modelParts.id, mapping.partId), eq(modelParts.projectId, projectId),
          eq(modelParts.modelVersionId, project.activeModelVersionId!),
        ))
      }

      // The current viewer consumes one primary part key per WBS task. Keep it in sync
      // while the mapping table remains the source of truth for one-to-many mappings.
      const allTasks = await tx.select({ id: wbsTasks.id }).from(wbsTasks).where(and(
        eq(wbsTasks.projectId, projectId), isNull(wbsTasks.archivedAt),
      ))
      if (allTasks.length) await tx.update(wbsTasks).set({ modelPartKey: null }).where(and(
        eq(wbsTasks.projectId, projectId), isNull(wbsTasks.archivedAt),
      ))
      const activeMappings = await tx.select({
        taskId: modelParts.taskId, partKey: modelParts.partKey,
      }).from(modelParts).where(and(
        eq(modelParts.projectId, projectId), eq(modelParts.modelVersionId, project.activeModelVersionId!),
      )).orderBy(asc(modelParts.groupName), asc(modelParts.name))
      const firstPartByTask = new Map<string, string>()
      for (const mapping of activeMappings) {
        if (mapping.taskId && !firstPartByTask.has(mapping.taskId)) firstPartByTask.set(mapping.taskId, mapping.partKey)
      }
      for (const [taskId, partKey] of firstPartByTask) {
        await tx.update(wbsTasks).set({ modelPartKey: partKey }).where(and(
          eq(wbsTasks.id, taskId), eq(wbsTasks.projectId, projectId),
        ))
      }

      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: 'model.part_mappings.updated', resourceType: 'model_version',
        resourceId: project.activeModelVersionId,
        beforeData: { mappings: before }, afterData: { mappings: dto.mappings },
        requestId: identity.requestId,
      })
    })

    return this.getProjectModel(projectId, identity)
  }

  async listPois(projectId: string, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'model.view')
    const rows = await this.db.select({
      poi: pois,
      partKey: modelParts.partKey,
    }).from(pois).leftJoin(modelParts, eq(pois.modelPartId, modelParts.id))
      .where(eq(pois.projectId, projectId)).orderBy(asc(pois.createdAt))
    return rows.flatMap(({ poi, partKey }) => partKey ? [this.presentPoi(poi, partKey)] : [])
  }

  async createPoi(projectId: string, dto: CreatePoiDto, identity: AuthenticatedIdentity) {
    const project = await this.assertProject(projectId, identity, 'model.mapping.edit')
    this.assertPoiRange(dto.startSec, dto.endSec)
    const part = await this.resolveActivePart(projectId, project.activeModelVersionId, dto.partKey)
    const metadata = this.poiMetadata(dto.startSec, dto.endSec, dto.note)
    const [row] = await this.db.insert(pois).values({
      projectId, modelVersionId: project.activeModelVersionId, modelPartId: part.id,
      positionX: dto.position[0], positionY: dto.position[1], positionZ: dto.position[2],
      title: dto.title, url: dto.url, metadata, createdBy: identity.userId,
    }).returning()
    if (!row) throw new Error('POI insert returned no row')
    const response = this.presentPoi(row, part.partKey)
    await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
      action: 'poi.created', resourceType: 'poi', resourceId: row.id,
      afterData: response, requestId: identity.requestId,
    })
    return response
  }

  async updatePoi(
    projectId: string, poiId: string, dto: UpdatePoiDto, identity: AuthenticatedIdentity,
  ) {
    const project = await this.assertProject(projectId, identity, 'model.mapping.edit')
    const [existing] = await this.db.select().from(pois).where(and(
      eq(pois.id, poiId), eq(pois.projectId, projectId),
    )).limit(1)
    if (!existing) throw new NotFoundException('POI not found')
    const currentMetadata = existing.metadata as Record<string, unknown>
    const startSec = dto.startSec === undefined ? this.optionalNumber(currentMetadata.startSec) : (dto.startSec ?? undefined)
    const endSec = dto.endSec === undefined ? this.optionalNumber(currentMetadata.endSec) : (dto.endSec ?? undefined)
    this.assertPoiRange(startSec, endSec)
    const part = dto.partKey
      ? await this.resolveActivePart(projectId, project.activeModelVersionId, dto.partKey)
      : await this.resolvePartById(projectId, existing.modelPartId)
    const [row] = await this.db.update(pois).set({
      modelVersionId: dto.partKey ? project.activeModelVersionId : undefined,
      modelPartId: dto.partKey ? part.id : undefined,
      positionX: dto.position?.[0], positionY: dto.position?.[1], positionZ: dto.position?.[2],
      title: dto.title, url: dto.url,
      metadata: this.poiMetadata(
        startSec,
        endSec,
        dto.note === undefined ? (typeof currentMetadata.note === 'string' ? currentMetadata.note : undefined) : dto.note,
      ),
      updatedAt: new Date(),
    }).where(and(eq(pois.id, poiId), eq(pois.projectId, projectId))).returning()
    if (!row) throw new ConflictException('POI was changed or removed')
    const response = this.presentPoi(row, part.partKey)
    await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
      action: 'poi.updated', resourceType: 'poi', resourceId: poiId,
      beforeData: this.presentPoi(existing, part.partKey), afterData: response, requestId: identity.requestId,
    })
    return response
  }

  async deletePoi(projectId: string, poiId: string, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'model.mapping.edit')
    const [row] = await this.db.delete(pois).where(and(
      eq(pois.id, poiId), eq(pois.projectId, projectId),
    )).returning()
    if (!row) throw new NotFoundException('POI not found')
    await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
      action: 'poi.deleted', resourceType: 'poi', resourceId: poiId,
      beforeData: row, requestId: identity.requestId,
    })
  }

  private async resolveActivePart(projectId: string, activeVersionId: string | null, partKey: string) {
    if (!activeVersionId) throw new ConflictException('Project has no active model version')
    const [part] = await this.db.select({ id: modelParts.id, partKey: modelParts.partKey })
      .from(modelParts).where(and(
        eq(modelParts.projectId, projectId), eq(modelParts.modelVersionId, activeVersionId),
        eq(modelParts.partKey, partKey),
      )).limit(1)
    if (!part) throw new BadRequestException('Model part is not in the active project model')
    return part
  }

  private async resolvePartById(projectId: string, partId: string | null) {
    if (!partId) throw new ConflictException('POI is not linked to a model part')
    const [part] = await this.db.select({ id: modelParts.id, partKey: modelParts.partKey })
      .from(modelParts).where(and(eq(modelParts.id, partId), eq(modelParts.projectId, projectId))).limit(1)
    if (!part) throw new ConflictException('POI model part no longer exists')
    return part
  }

  private assertPoiRange(startSec?: number, endSec?: number) {
    if (startSec !== undefined && endSec !== undefined && endSec <= startSec) {
      throw new BadRequestException('POI endSec must be later than startSec')
    }
  }

  private optionalNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }

  private poiMetadata(startSec?: number, endSec?: number, note?: string) {
    return {
      ...(startSec === undefined ? {} : { startSec }),
      ...(endSec === undefined ? {} : { endSec }),
      ...(note ? { note } : {}),
    }
  }

  private presentPoi(row: typeof pois.$inferSelect, partKey: string) {
    const metadata = row.metadata as Record<string, unknown>
    return {
      id: row.id,
      projectId: row.projectId,
      partId: partKey,
      position: [row.positionX, row.positionY, row.positionZ] as [number, number, number],
      title: row.title,
      url: row.url,
      ...(this.optionalNumber(metadata.startSec) === undefined ? {} : { startSec: this.optionalNumber(metadata.startSec) }),
      ...(this.optionalNumber(metadata.endSec) === undefined ? {} : { endSec: this.optionalNumber(metadata.endSec) }),
      ...(typeof metadata.note === 'string' && metadata.note ? { note: metadata.note } : {}),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  private async assertProject(projectId: string, identity: AuthenticatedIdentity, permission: string) {
    await this.authz.assert(identity, permission, projectId)
    const [project] = await this.db.select({
      id: projects.id, activeModelVersionId: projects.activeModelVersionId,
    }).from(projects).where(and(
      eq(projects.id, projectId), eq(projects.organizationId, identity.organizationId), isNull(projects.deletedAt),
    )).limit(1)
    if (!project) throw new NotFoundException('Project not found')
    return project
  }
}
