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

it('migrates former capacity labels while preserving IDs and user edits',()=>{
 const old={...PROJECTS[0],code:'PP-DC250-CONCEPT',name:'250 MW 資料中心建設',model:'250 MW 園區 · 200 MW IT（假設）',description:'自訂描述'}
 const migrated=parseProjectData(JSON.stringify([old]))[0]!
 expect(migrated.id).toBe(old.id)
 expect(migrated.name).toBe('50 MW 資料中心建設')
 expect(migrated.model).toBe('50 MW 園區總容量 · IT 容量待核定')
 expect(migrated.code).toBe('PP-DC50-CONCEPT')
 expect(migrated.description).toBe('自訂描述')
})
