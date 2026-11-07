import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { RequestWithIdentity } from '../auth/auth.types.js'
import { identityFromRequest } from '../auth/auth.utils.js'
import { CompleteCoverUploadDto, CompleteProjectDocumentDto, PrepareCoverUploadDto, PrepareProjectDocumentDto, UpdateProjectDocumentDto } from './storage.dto.js'
import { StorageService } from './storage.service.js'

@Controller('projects/:projectId/images/cover')
export class StorageController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Get()
  getCover(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.storage.cover(projectId, identityFromRequest(request)) }

  @Post('upload-url')
  prepareCover(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: PrepareCoverUploadDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.storage.prepareCover(projectId, dto, identityFromRequest(request)) }

  @Post('complete')
  @HttpCode(200)
  completeCover(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: CompleteCoverUploadDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.storage.completeCover(projectId, dto, identityFromRequest(request)) }
}

@Controller('projects/:projectId/daily-reports/:reportId/photos')
export class DailyReportPhotosController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Get()
  list(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('reportId', new ParseUUIDPipe()) reportId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.storage.dailyPhotos(projectId, reportId, identityFromRequest(request)) }

  @Post('upload-url')
  prepare(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('reportId', new ParseUUIDPipe()) reportId: string,
    @Body() dto: PrepareCoverUploadDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.storage.prepareDailyPhoto(projectId, reportId, dto, identityFromRequest(request)) }

  @Post('complete')
  complete(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('reportId', new ParseUUIDPipe()) reportId: string,
    @Body() dto: CompleteCoverUploadDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.storage.completeDailyPhoto(projectId, reportId, dto, identityFromRequest(request)) }
}

@Controller('projects/:projectId/documents')
export class ProjectDocumentsController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Get()
  list(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.storage.listProjectDocuments(projectId, identityFromRequest(request)) }

  @Post('upload-url')
  prepare(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: PrepareProjectDocumentDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.storage.prepareProjectDocument(projectId, dto, identityFromRequest(request)) }

  @Post('complete')
  complete(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: CompleteProjectDocumentDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.storage.completeProjectDocument(projectId, dto, identityFromRequest(request)) }

  @Patch(':documentId')
  update(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Body() dto: UpdateProjectDocumentDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.storage.updateProjectDocument(projectId, documentId, dto, identityFromRequest(request)) }

  @Delete(':documentId')
  @HttpCode(204)
  async remove(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { await this.storage.deleteProjectDocument(projectId, documentId, identityFromRequest(request)) }
}
