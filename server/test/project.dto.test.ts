import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { CreateProjectDto, ListProjectsQuery } from '../src/projects/project.dto.js'

describe('project DTO validation', () => {
  it('trims a valid project and accepts PacificPower project codes', async () => {
    const dto = plainToInstance(CreateProjectDto, {
      code: ' AMP-2026-007 ',
      name: ' 新建發電機工程 ',
      status: 'planning',
      contractAmount: 12_000_000,
    })

    expect(await validate(dto)).toHaveLength(0)
    expect(dto.code).toBe('AMP-2026-007')
    expect(dto.name).toBe('新建發電機工程')
  })

  it('rejects malformed codes and invalid coordinates', async () => {
    const dto = plainToInstance(CreateProjectDto, {
      code: 'bad code', name: '', latitude: 100,
    })
    const errors = await validate(dto)
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['code', 'name', 'latitude']))
  })

  it('transforms list query primitives', async () => {
    const query = plainToInstance(ListProjectsQuery, { includeArchived: 'true', limit: '50' })
    expect(await validate(query)).toHaveLength(0)
    expect(query.includeArchived).toBe(true)
    expect(query.limit).toBe(50)
  })
})
