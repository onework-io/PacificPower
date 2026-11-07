import { describe, expect, it } from 'vitest'
import { PROJECTS } from '@/data/projects'
import { parseProjectData, serializeProjectData } from './projectRepository'

describe('projectRepository JSON', () => {
  it('可將專案序列化成有版本的 JSON 文件並讀回', () => {
    const json = serializeProjectData(PROJECTS)
    const document = JSON.parse(json) as { schemaVersion: number; projects: unknown[] }

    expect(document.schemaVersion).toBe(1)
    expect(document.projects).toHaveLength(PROJECTS.length)
    expect(parseProjectData(json)[0].name).toBe(PROJECTS[0].name)
  })

  it('可讀取舊版陣列 JSON 並補齊預設欄位', () => {
    const projects = parseProjectData(JSON.stringify([{ id: PROJECTS[0].id, description: '更新後描述' }]))
    expect(projects[0].description).toBe('更新後描述')
    expect(projects[0].code).toBe(PROJECTS[0].code)
  })
})
