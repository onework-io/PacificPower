import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { AppModule } from './app.module.js'

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: true }))
  const config = app.get(ConfigService)
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  app.enableCors({
    origin: config.get('CORS_ORIGIN', 'http://127.0.0.1:5173').split(','),
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'If-Match', 'Idempotency-Key', 'X-Organization-Id', 'X-User-Id', 'X-Request-Id'],
    exposedHeaders: ['ETag', 'X-Request-Id'],
  })
  app.use((request: { headers: Record<string, unknown> }, response: { setHeader(name: string, value: string): void }, next: () => void) => {
    response.setHeader('X-Request-Id', String(request.headers['x-request-id'] ?? randomUUID()))
    next()
  })
  await app.listen({ host: config.get('HOST', '127.0.0.1'), port: Number(config.get('PORT', 3000)) })
}

void bootstrap()
