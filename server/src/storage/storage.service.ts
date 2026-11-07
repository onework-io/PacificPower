import { randomUUID } from 'node:crypto'
import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { AuthenticatedIdentity } from '../auth/auth.types.js'
import { AuthorizationService } from '../authz/authorization.service.js'
import { DATABASE, type Database } from '../database/database.module.js'
import { appUsers, auditLogs, dailyReports, files, projectDocuments, projectImages, projects } from '../database/schema.js'
import type { CompleteCoverUploadDto, CompleteProjectDocumentDto, PrepareCoverUploadDto, PrepareProjectDocumentDto, UpdateProjectDocumentDto } from './storage.dto.js'

const COVER_BUCKET = 'project-images'

@Injectable()
export class StorageService {
  private client?: S3Client

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async prepareCover(projectId: string, dto: PrepareCoverUploadDto, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'project.edit')
    const client = this.s3()
    const safeName = dto.fileName.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-100) || 'cover'
    const objectKey = `${identity.organizationId}/${projectId}/covers/${randomUUID()}-${safeName}`
    const [file] = await this.db.insert(files).values({
      organizationId: identity.organizationId, bucket: COVER_BUCKET, objectKey,
      originalName: dto.fileName, mimeType: dto.mimeType, byteSize: dto.byteSize,
      sha256: dto.sha256, createdBy: identity.userId, scanStatus: 'pending',
    }).returning()
    if (!file) throw new Error('File metadata insert returned no row')
    const uploadUrl = await getSignedUrl(client, new PutObjectCommand({
      Bucket: COVER_BUCKET, Key: objectKey, ContentType: dto.mimeType,
    }), { expiresIn: 10 * 60 })
    return { fileId: file.id, uploadUrl, method: 'PUT', expiresIn: 600, headers: { 'Content-Type': dto.mimeType } }
  }

  async completeCover(projectId: string, dto: CompleteCoverUploadDto, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'project.edit')
    const [file] = await this.db.select().from(files).where(and(
      eq(files.id, dto.fileId), eq(files.organizationId, identity.organizationId), eq(files.bucket, COVER_BUCKET),
    )).limit(1)
    if (!file || !file.objectKey.includes(`/${projectId}/`)) throw new NotFoundException('Cover upload was not found')
    const object = await this.s3().send(new HeadObjectCommand({ Bucket: file.bucket, Key: file.objectKey }))
    if (Number(object.ContentLength ?? -1) !== file.byteSize) {
      throw new NotFoundException('Uploaded cover size does not match the prepared file')
    }
    await this.db.transaction(async (tx) => {
      await tx.update(files).set({ scanStatus: 'clean' }).where(eq(files.id, file.id))
      await tx.delete(projectImages).where(and(
        eq(projectImages.projectId, projectId), eq(projectImages.kind, 'cover'),
      ))
      await tx.insert(projectImages).values({ projectId, fileId: file.id, kind: 'cover' })
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: 'project.cover.updated', resourceType: 'file', resourceId: file.id,
        afterData: { mimeType: file.mimeType, byteSize: file.byteSize }, requestId: identity.requestId,
      })
    })
    return this.cover(projectId, identity)
  }

  async cover(projectId: string, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'project.view')
    const [row] = await this.db.select({ file: files }).from(projectImages)
      .innerJoin(files, eq(files.id, projectImages.fileId)).where(and(
        eq(projectImages.projectId, projectId), eq(projectImages.kind, 'cover'), eq(files.scanStatus, 'clean'),
      )).orderBy(desc(projectImages.createdAt)).limit(1)
    if (!row) return { projectId, cover: null }
    const url = await getSignedUrl(this.s3(), new GetObjectCommand({
      Bucket: row.file.bucket, Key: row.file.objectKey,
    }), { expiresIn: 15 * 60 })
    return {
      projectId,
      cover: { fileId: row.file.id, url, mimeType: row.file.mimeType, byteSize: row.file.byteSize, expiresIn: 900 },
    }
  }

  async prepareDailyPhoto(projectId: string, reportId: string, dto: PrepareCoverUploadDto, identity: AuthenticatedIdentity) {
    await this.assertDailyReport(projectId, reportId, identity, 'photo.upload')
    const safeName = dto.fileName.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-100) || 'site-photo'
    const objectKey = `${identity.organizationId}/${projectId}/daily-reports/${reportId}/${randomUUID()}-${safeName}`
    const [file] = await this.db.insert(files).values({
      organizationId: identity.organizationId, bucket: COVER_BUCKET, objectKey,
      originalName: dto.fileName, mimeType: dto.mimeType, byteSize: dto.byteSize,
      sha256: dto.sha256, createdBy: identity.userId, scanStatus: 'pending',
    }).returning()
    if (!file) throw new Error('File metadata insert returned no row')
    const uploadUrl = await getSignedUrl(this.s3(), new PutObjectCommand({
      Bucket: COVER_BUCKET, Key: objectKey, ContentType: dto.mimeType,
    }), { expiresIn: 10 * 60 })
    return { fileId: file.id, uploadUrl, method: 'PUT', expiresIn: 600, headers: { 'Content-Type': dto.mimeType } }
  }

  async completeDailyPhoto(projectId: string, reportId: string, dto: CompleteCoverUploadDto, identity: AuthenticatedIdentity) {
    await this.assertDailyReport(projectId, reportId, identity, 'photo.upload')
    const [file] = await this.db.select().from(files).where(and(
      eq(files.id, dto.fileId), eq(files.organizationId, identity.organizationId), eq(files.bucket, COVER_BUCKET),
    )).limit(1)
    if (!file || !file.objectKey.includes(`/${projectId}/daily-reports/${reportId}/`)) throw new NotFoundException('Daily report photo upload was not found')
    const object = await this.s3().send(new HeadObjectCommand({ Bucket: file.bucket, Key: file.objectKey }))
    if (Number(object.ContentLength ?? -1) !== file.byteSize) throw new NotFoundException('Uploaded photo size does not match the prepared file')
    await this.db.transaction(async (tx) => {
      await tx.update(files).set({ scanStatus: 'clean' }).where(eq(files.id, file.id))
      await tx.insert(projectImages).values({ projectId, fileId: file.id, kind: 'daily_report', dailyReportId: reportId })
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: 'daily_report.photo_added', resourceType: 'file', resourceId: file.id,
        afterData: { reportId, mimeType: file.mimeType, byteSize: file.byteSize }, requestId: identity.requestId,
      })
    })
    return { fileId: file.id, completed: true }
  }

  async dailyPhotos(projectId: string, reportId: string, identity: AuthenticatedIdentity) {
    await this.assertDailyReport(projectId, reportId, identity, 'progress.view')
    const rows = await this.db.select({ file: files, caption: projectImages.caption }).from(projectImages)
      .innerJoin(files, eq(files.id, projectImages.fileId)).where(and(
        eq(projectImages.projectId, projectId), eq(projectImages.dailyReportId, reportId),
        eq(projectImages.kind, 'daily_report'), eq(files.scanStatus, 'clean'),
      )).orderBy(projectImages.sortOrder, projectImages.createdAt)
    const photos = await Promise.all(rows.map(async ({ file, caption }) => ({
      fileId: file.id, name: file.originalName, caption, mimeType: file.mimeType, byteSize: file.byteSize,
      url: await getSignedUrl(this.s3(), new GetObjectCommand({ Bucket: file.bucket, Key: file.objectKey }), { expiresIn: 15 * 60 }),
    })))
    return { reportId, photos }
  }

  async listProjectDocuments(projectId: string, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'project.view')
    const rows = await this.db.select({
      document: projectDocuments, file: files, uploaderName: appUsers.displayName,
    }).from(projectDocuments)
      .innerJoin(files, eq(files.id, projectDocuments.fileId))
      .leftJoin(appUsers, eq(appUsers.id, projectDocuments.uploadedBy))
      .where(and(eq(projectDocuments.projectId, projectId), eq(files.scanStatus, 'clean')))
      .orderBy(desc(projectDocuments.createdAt))
    const bucket = this.documentBucket()
    return { documents: await Promise.all(rows.map(async ({ document, file, uploaderName }) => ({
      ...document, uploaderName, name: file.originalName, mimeType: file.mimeType, byteSize: file.byteSize,
      url: await getSignedUrl(this.s3(), new GetObjectCommand({ Bucket: bucket, Key: file.objectKey }), { expiresIn: 15 * 60 }),
    }))) }
  }

  async prepareProjectDocument(projectId: string, dto: PrepareProjectDocumentDto, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'project.edit')
    const safeName = dto.fileName.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-140) || 'document'
    const objectKey = `${identity.organizationId}/${projectId}/documents/${randomUUID()}-${safeName}`
    const [file] = await this.db.insert(files).values({
      organizationId: identity.organizationId, bucket: 'documents', objectKey,
      originalName: dto.fileName, mimeType: dto.mimeType, byteSize: dto.byteSize,
      sha256: dto.sha256, createdBy: identity.userId, scanStatus: 'pending',
    }).returning()
    if (!file) throw new Error('File metadata insert returned no row')
    const uploadUrl = await getSignedUrl(this.s3(), new PutObjectCommand({
      Bucket: this.documentBucket(), Key: objectKey, ContentType: dto.mimeType,
    }), { expiresIn: 10 * 60 })
    return { fileId: file.id, uploadUrl, method: 'PUT', expiresIn: 600, headers: { 'Content-Type': dto.mimeType } }
  }

  async completeProjectDocument(projectId: string, dto: CompleteProjectDocumentDto, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'project.edit')
    const [file] = await this.db.select().from(files).where(and(
      eq(files.id, dto.fileId), eq(files.organizationId, identity.organizationId), eq(files.bucket, 'documents'),
    )).limit(1)
    if (!file || !file.objectKey.includes(`/${projectId}/documents/`)) throw new NotFoundException('Document upload was not found')
    const object = await this.s3().send(new HeadObjectCommand({ Bucket: this.documentBucket(), Key: file.objectKey }))
    if (Number(object.ContentLength ?? -1) !== file.byteSize) throw new NotFoundException('Uploaded document size does not match the prepared file')
    const [document] = await this.db.transaction(async (tx) => {
      await tx.update(files).set({ scanStatus: 'clean' }).where(eq(files.id, file.id))
      const rows = await tx.insert(projectDocuments).values({
        projectId, fileId: file.id, title: dto.title, category: dto.category,
        description: dto.description ?? '', uploadedBy: identity.userId,
      }).returning()
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: 'project.document.created', resourceType: 'project_document', resourceId: rows[0]!.id,
        afterData: { title: dto.title, category: dto.category, fileName: file.originalName, byteSize: file.byteSize },
        requestId: identity.requestId,
      })
      return rows
    })
    return document!
  }

  async updateProjectDocument(projectId: string, documentId: string, dto: UpdateProjectDocumentDto, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'project.edit')
    const [current] = await this.db.select().from(projectDocuments).where(and(
      eq(projectDocuments.id, documentId), eq(projectDocuments.projectId, projectId),
    )).limit(1)
    if (!current) throw new NotFoundException('Project document not found')
    const [updated] = await this.db.update(projectDocuments).set({ ...dto, updatedAt: new Date() })
      .where(eq(projectDocuments.id, documentId)).returning()
    await this.db.insert(auditLogs).values({
      organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
      action: 'project.document.updated', resourceType: 'project_document', resourceId: documentId,
      beforeData: current, afterData: updated, requestId: identity.requestId,
    })
    return updated!
  }

  async deleteProjectDocument(projectId: string, documentId: string, identity: AuthenticatedIdentity) {
    await this.assertProject(projectId, identity, 'project.edit')
    const [row] = await this.db.select({ document: projectDocuments, file: files }).from(projectDocuments)
      .innerJoin(files, eq(files.id, projectDocuments.fileId)).where(and(
        eq(projectDocuments.id, documentId), eq(projectDocuments.projectId, projectId),
      )).limit(1)
    if (!row) throw new NotFoundException('Project document not found')
    await this.s3().send(new DeleteObjectCommand({ Bucket: this.documentBucket(), Key: row.file.objectKey }))
    await this.db.transaction(async (tx) => {
      await tx.delete(projectDocuments).where(eq(projectDocuments.id, documentId))
      await tx.delete(files).where(eq(files.id, row.file.id))
      await tx.insert(auditLogs).values({
        organizationId: identity.organizationId, projectId, actorUserId: identity.userId,
        action: 'project.document.deleted', resourceType: 'project_document', resourceId: documentId,
        beforeData: { ...row.document, fileName: row.file.originalName }, requestId: identity.requestId,
      })
    })
  }

  private documentBucket() {
    return this.config.get<string>('STORAGE_DOCUMENTS_BUCKET') || 'documents'
  }

  private s3() {
    if (this.client) return this.client
    const endpoint = this.config.get<string>('STORAGE_S3_ENDPOINT') || this.config.get<string>('SUPABASE_STORAGE_S3_ENDPOINT')
    const region = this.config.get<string>('STORAGE_S3_REGION') || this.config.get<string>('SUPABASE_STORAGE_S3_REGION')
    const accessKeyId = this.config.get<string>('STORAGE_S3_ACCESS_KEY_ID') || this.config.get<string>('SUPABASE_STORAGE_S3_ACCESS_KEY_ID')
    const secretAccessKey = this.config.get<string>('STORAGE_S3_SECRET_ACCESS_KEY') || this.config.get<string>('SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY')
    if (!endpoint || !region || !accessKeyId || !secretAccessKey) {
      throw new ServiceUnavailableException('Storage S3 credentials are not configured')
    }
    this.client = new S3Client({
      endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey },
    })
    return this.client
  }

  private async assertProject(projectId: string, identity: AuthenticatedIdentity, permission: string) {
    await this.authz.assert(identity, permission, projectId)
    const [project] = await this.db.select({ id: projects.id }).from(projects).where(and(
      eq(projects.id, projectId), eq(projects.organizationId, identity.organizationId), isNull(projects.deletedAt),
    )).limit(1)
    if (!project) throw new NotFoundException('Project not found')
  }

  private async assertDailyReport(projectId: string, reportId: string, identity: AuthenticatedIdentity, permission: string) {
    await this.assertProject(projectId, identity, permission)
    const [report] = await this.db.select({ id: dailyReports.id }).from(dailyReports).where(and(
      eq(dailyReports.id, reportId), eq(dailyReports.projectId, projectId),
    )).limit(1)
    if (!report) throw new NotFoundException('Daily report not found')
  }
}
