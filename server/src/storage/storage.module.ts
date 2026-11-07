import { Module } from '@nestjs/common'
import { DailyReportPhotosController, ProjectDocumentsController, StorageController } from './storage.controller.js'
import { StorageService } from './storage.service.js'

@Module({ controllers: [StorageController, DailyReportPhotosController, ProjectDocumentsController], providers: [StorageService] })
export class StorageModule {}
