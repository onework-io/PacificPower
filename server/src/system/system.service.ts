import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import type { AuthenticatedIdentity } from '../auth/auth.types.js'
import { AuthorizationService } from '../authz/authorization.service.js'
import { DATABASE, type Database } from '../database/database.module.js'
import { appUsers, auditLogs, files, organizationMembers, projects } from '../database/schema.js'
import { LiveEventsService } from '../events/live-events.service.js'

@Injectable()
export class SystemService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(LiveEventsService) private readonly liveEvents: LiveEventsService,
  ) {}

  async status(identity: AuthenticatedIdentity) {
    await this.authz.assert(identity, 'audit.view')
    const databaseStarted = performance.now()
    await this.db.execute(sql`select 1`)
    const databaseLatencyMs = Math.max(1, Math.round(performance.now() - databaseStarted))
    const [projectCount, userCount, pendingFileCount, auditCount, latestAudit] = await Promise.all([
      this.db.select({ value: count() }).from(projects).where(and(
        eq(projects.organizationId, identity.organizationId), isNull(projects.deletedAt),
      )),
      this.db.select({ value: count() }).from(organizationMembers)
        .innerJoin(appUsers, eq(appUsers.id, organizationMembers.userId))
        .where(and(eq(organizationMembers.organizationId, identity.organizationId), eq(appUsers.status, 'active'))),
      this.db.select({ value: count() }).from(files).where(and(
        eq(files.organizationId, identity.organizationId), eq(files.scanStatus, 'pending'),
      )),
      this.db.select({ value: count() }).from(auditLogs).where(and(
        eq(auditLogs.organizationId, identity.organizationId),
        sql`${auditLogs.createdAt} >= now() - interval '24 hours'`,
      )),
      this.db.select({ createdAt: auditLogs.createdAt }).from(auditLogs)
        .where(eq(auditLogs.organizationId, identity.organizationId))
        .orderBy(desc(auditLogs.createdAt)).limit(1),
    ])
    const storageConfigured = Boolean(
      (this.config.get('STORAGE_S3_ENDPOINT') || this.config.get('SUPABASE_STORAGE_S3_ENDPOINT'))
      && (this.config.get('STORAGE_S3_REGION') || this.config.get('SUPABASE_STORAGE_S3_REGION'))
      && (this.config.get('STORAGE_S3_ACCESS_KEY_ID') || this.config.get('SUPABASE_STORAGE_S3_ACCESS_KEY_ID'))
      && (this.config.get('STORAGE_S3_SECRET_ACCESS_KEY') || this.config.get('SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY')),
    )
    return {
      status: 'operational',
      checkedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: this.config.get('NODE_ENV', 'development'),
      services: {
        api: { status: 'operational' },
        database: { status: 'operational', latencyMs: databaseLatencyMs, provider: 'Supabase PostgreSQL' },
        authentication: { status: this.config.get('SUPABASE_URL') ? 'operational' : 'not_configured', provider: 'Supabase Auth' },
        realtime: { status: 'operational', connections: this.liveEvents.subscriberCount(identity.organizationId), transport: 'SSE' },
        storage: { status: storageConfigured ? 'configured' : 'not_configured', provider: 'S3 Compatible / MinIO' },
      },
      metrics: {
        activeProjects: Number(projectCount[0]?.value ?? 0),
        activeUsers: Number(userCount[0]?.value ?? 0),
        pendingFiles: Number(pendingFileCount[0]?.value ?? 0),
        auditEvents24h: Number(auditCount[0]?.value ?? 0),
        latestAuditAt: latestAudit[0]?.createdAt?.toISOString() ?? null,
      },
    }
  }
}
