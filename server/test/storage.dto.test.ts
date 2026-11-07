import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { CompleteCoverUploadDto, PrepareCoverUploadDto } from '../src/storage/storage.dto.js'

describe('storage DTO validation', () => {
  it('accepts and trims a supported project cover', async () => {
    const dto = plainToInstance(PrepareCoverUploadDto, {
      fileName: ' site-cover.webp ',
      mimeType: 'image/webp',
      byteSize: 512_000,
      sha256: 'a'.repeat(64),
    })

    expect(await validate(dto)).toHaveLength(0)
    expect(dto.fileName).toBe('site-cover.webp')
  })

  it('rejects unsupported media and files larger than 10 MiB', async () => {
    const dto = plainToInstance(PrepareCoverUploadDto, {
      fileName: 'cover.svg', mimeType: 'image/svg+xml', byteSize: 10 * 1024 * 1024 + 1,
    })
    const errors = await validate(dto)
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['mimeType', 'byteSize']))
  })

  it('requires a UUID-shaped file id when completing an upload', async () => {
    const valid = plainToInstance(CompleteCoverUploadDto, { fileId: '019d2cfe-0d8b-7a8f-bc14-900ce7a12bc4' })
    const invalid = plainToInstance(CompleteCoverUploadDto, { fileId: 'pending-file' })

    expect(await validate(valid)).toHaveLength(0)
    expect((await validate(invalid)).map((error) => error.property)).toContain('fileId')
  })
})
