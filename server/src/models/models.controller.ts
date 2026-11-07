import {
  BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe,
  Patch, Post, Put, Req, Res,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { RequestWithIdentity } from '../auth/auth.types.js'
import { identityFromRequest } from '../auth/auth.utils.js'
import { ApplyModelTemplateDto, CreatePoiDto, ReplaceModelPartMappingsDto, UpdatePoiDto } from './model.dto.js'
import { ModelsService } from './models.service.js'

@Controller()
export class ModelsController {
  constructor(@Inject(ModelsService) private readonly models: ModelsService) {}

  @Get('model-templates')
  listTemplates(@Req() request: FastifyRequest & RequestWithIdentity) {
    return this.models.listTemplates(identityFromRequest(request))
  }

  @Get('projects/:projectId/models/active')
  getActive(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.models.getProjectModel(projectId, identityFromRequest(request)) }

  @Post('projects/:projectId/models/apply-template')
  @HttpCode(201)
  async applyTemplate(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: ApplyModelTemplateDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 16) {
      throw new BadRequestException('Idempotency-Key must contain at least 16 characters')
    }
    const result = await this.models.applyTemplate(
      projectId, dto, idempotencyKey, identityFromRequest(request),
    )
    reply.status(201)
    return result
  }

  @Put('projects/:projectId/models/active/part-mappings')
  replacePartMappings(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: ReplaceModelPartMappingsDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) {
    return this.models.replacePartMappings(projectId, dto, identityFromRequest(request))
  }

  @Get('projects/:projectId/pois')
  listPois(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.models.listPois(projectId, identityFromRequest(request)) }

  @Post('projects/:projectId/pois')
  @HttpCode(201)
  createPoi(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: CreatePoiDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.models.createPoi(projectId, dto, identityFromRequest(request)) }

  @Patch('projects/:projectId/pois/:poiId')
  updatePoi(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('poiId', new ParseUUIDPipe()) poiId: string,
    @Body() dto: UpdatePoiDto,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { return this.models.updatePoi(projectId, poiId, dto, identityFromRequest(request)) }

  @Delete('projects/:projectId/pois/:poiId')
  @HttpCode(204)
  async deletePoi(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('poiId', new ParseUUIDPipe()) poiId: string,
    @Req() request: FastifyRequest & RequestWithIdentity,
  ) { await this.models.deletePoi(projectId, poiId, identityFromRequest(request)) }
}
