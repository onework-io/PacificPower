import { describe, expect, it } from 'vitest'
import { issueActivity } from './issueActivity'
import { emptyPmis } from '@/stores/pmis'
describe('issue activity',()=>{
 it('combines only the specified issue comments and mutations without duplicate comment logs',()=>{
  const s=emptyPmis()
  s.comments=[{id:'c',at:'2026-11-07T10:00:00Z',actor:'A',target:'issue:ISS-1',text:'協調紀錄'},{id:'other',at:'2026-11-07T10:00:00Z',actor:'B',target:'issue:ISS-2',text:'其他議題'}]
  s.audit=[{id:'a',at:'2026-11-07T09:00:00Z',actor:'A',target:'ISS-1',action:'建立議題',note:'資料確認'},{id:'b',at:'2026-11-07T10:00:00Z',actor:'A',target:'issue:ISS-1',action:'新增留言',note:''},{id:'x',at:'2026-11-07T10:00:00Z',actor:'B',target:'ISS-2',action:'建立議題',note:''}]
  expect(issueActivity(s,'ISS-1').map(a=>a.id)).toEqual(['comment:c','audit:a'])
  expect(s.audit).toHaveLength(3)
 })
 it('uses distinct event keys even when source ids match and keeps same-time ordering stable',()=>{
  const s=emptyPmis(), at='2026-11-07T10:00:00Z'
  s.comments=[{id:'same',at,actor:'A',target:'issue:ISS-1',text:'留言'}]
  s.audit=[{id:'same',at,actor:'A',target:'ISS-1',action:'責任調整',note:'移交'}]
  const result=issueActivity(s,'ISS-1')
  expect(new Set(result.map(x=>x.id)).size).toBe(2)
  expect(result.map(x=>x.kind)).toEqual(['異動','留言'])
 })
 it('returns an empty activity for an unrelated issue',()=>{expect(issueActivity(emptyPmis(),'missing')).toEqual([])})
})
