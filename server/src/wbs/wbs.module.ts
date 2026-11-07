import { Module } from '@nestjs/common'
import { WbsController } from './wbs.controller.js'
import { WbsService } from './wbs.service.js'

@Module({ controllers: [WbsController], providers: [WbsService] })
export class WbsModule {}
