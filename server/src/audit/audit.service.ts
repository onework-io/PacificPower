import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, gte, ilike, lt, lte, or, sql } from 'drizzle-orm'
import type { AuthenticatedIdentity } from '../auth/auth.types.js'
import { AuthorizationService } from '../authz/authorization.service.js'
import { DATABASE, type Database } from '../database/database.module.js'
import { appUsers, auditLogs, projects } from '../database/schema.js'
import type { AuditLogQueryDto } from './audit.dto.js'

@Injectable()
export class AuditService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
  ) {}

  async list(query: AuditLogQueryDto, identity: AuthenticatedIdentity) {
    await this.authz.assert(identity, 'audit.view')
    const conditions = [eq(auditLogs.organizationId, identity.organizationId)]
    if (query.action) conditions.push(ilike(auditLogs.action, `%${query.action}%`))
    if (query.projectId) conditions.push(eq(auditLogs.projectId, query.projectId))
    if (query.actorUserId) conditions.push(eq(auditLogs.actorUserId, query.actorUserId))
    if (query.before) conditions.push(lt(auditLogs.id, query.before))
    if (query.from) conditions.push(gte(auditLogs.createdAt, new Date(`${query.from}T00:00:00+08:00`)))
    if (query.to) conditions.push(lte(auditLogs.createdAt, new Date(`${query.to}T23:59:59.999+08:00`)))
    if (query.q) {
      const pattern = `%${query.q}%`
      conditions.push(or(
        ilike(auditLogs.action, pattern), ilike(auditLogs.resourceType, pattern),
        ilike(auditLogs.resourceId, pattern), ilike(appUsers.displayName, pattern),
        ilike(appUsers.email, pattern), ilike(projects.name, pattern), ilike(projects.code, pattern),
      )!)
    }
    const rows = await this.db.select({
      id: auditLogs.id, projectId: auditLogs.projectId, projectCode: projects.code, projectName: projects.name,
      actorUserId: auditLogs.actorUserId, actorName: appUsers.displayName, actorEmail: appUsers.email,
      action: auditLogs.action, resourceType: auditLogs.resourceType, resourceId: auditLogs.resourceId,
      beforeData: auditLogs.beforeData, afterData: auditLogs.afterData,
      requestId: auditLogs.requestId, ipAddress: auditLogs.ipAddress, createdAt: auditLogs.createdAt,
    }).from(auditLogs)
      .leftJoin(appUsers, eq(appUsers.id, auditLogs.actorUserId))
      .leftJoin(projects, eq(projects.id, auditLogs.projectId))
      .where(and(...conditions)).orderBy(desc(auditLogs.id)).limit(query.limit + 1)
    const hasMore = rows.length > query.limit
    const items = hasMore ? rows.slice(0, query.limit) : rows
    return {
      items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
      nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
      filters: {
        actions: await this.db.selectDistinct({ action: auditLogs.action }).from(auditLogs)
          .where(eq(auditLogs.organizationId, identity.organizationId)).orderBy(auditLogs.action),
        total: Number((await this.db.select({ value: sql<number>`count(*)::int` }).from(auditLogs)
          .where(eq(auditLogs.organizationId, identity.organizationId)))[0]?.value ?? 0),
      },
    }
  }
}
