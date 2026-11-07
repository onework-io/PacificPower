import { describe, expect, it } from 'vitest'
import { deliverySummary } from './delivery'
import { emptyPmis, defaultWork, type Issue, type Revision } from '@/stores/pmis'
import { newInspection } from './inspections'
const issue = (id:string):Issue => ({id,title:id,type:'缺失',priority:'高',owner:'PMO',due:'',task:'',asset:'',document:'',description:'待處理',response:'',status:'待處理'})
describe('delivery readiness aggregation',()=>{
 it('keeps missing records visible and excludes optional documents',()=>{
  const s=deliverySummary(emptyPmis())
  expect(s.tasks).toHaveLength(50);expect(s.documents).toHaveLength(21)
  expect(s.documents.some(d=>d.optional)).toBe(false)
  expect(s.findings).toHaveLength(71);expect(s.inspections).toHaveLength(0)
  expect(deliverySummary(emptyPmis(),'unknown').tasks).toEqual(s.tasks)
 })
 it('uses latest registration rather than an accepted historical version',()=>{
  const state=emptyPmis()
  const r:Revision={id:'a',code:'DOC-01',version:'A',title:'A',url:'https://example.com',author:'PMO',status:'已接受',note:'',createdAt:'2026-11-01T00:00:00Z'}
  state.revisions=[r,{...r,id:'b',version:'B',status:'待審查',createdAt:'2026-11-02T00:00:00Z'}]
  const s=deliverySummary(state)
  expect(s.documents.find(d=>d.code==='DOC-01')).toMatchObject({status:'待審查',acceptedVersions:1,latest:{version:'B'}})
  expect(s.findings.find(f=>f.id==='DOC-01')?.reason).toContain('B')
 })
 it('separates commercial scope and respects explicit empty model bindings',()=>{
  const state=emptyPmis()
  expect(deliverySummary(state,'commercial').documents).toHaveLength(5)
  expect(deliverySummary(state,'d0').tasks.every(t=>!t.code.startsWith('0.'))).toBe(true)
  expect(deliverySummary(state,'all','power').tasks.some(t=>t.code==='2.2.1')).toBe(true)
  state.bindings['2.2.1']=[]
  expect(deliverySummary(state,'all','power').tasks.some(t=>t.code==='2.2.1')).toBe(false)
 })
 it('only flags explicit past due dates for unaccepted work',()=>{
  const state=emptyPmis()
  state.work['2.2.1']={...defaultWork(),due:'2026-11-06'}
  state.work['2.2.2']={...defaultWork(),due:'2026-11-06',status:'已接受'}
  expect(deliverySummary(state,'all','','2026-11-07').tasks.filter(t=>t.overdue).map(t=>t.code)).toEqual(['2.2.1'])
 })
 it('surfaces reopened defects even after inspection acceptance',()=>{
  const state=emptyPmis(), i=newInspection()
  i.id='inspection';i.status='已接受';i.items[0]!.issueId='defect'
  state.inspections=[i];state.issues=[issue('defect')]
  expect(deliverySummary(state).findings.find(f=>f.id===i.id)?.reason).toContain('缺失未結')
  state.issues[0]!.status='已結案'
  expect(deliverySummary(state).findings.some(f=>f.id===i.id)).toBe(false)
 })
 it('retains unclassified issues and open actions in confirmed meetings',()=>{
  const state=emptyPmis();state.issues=[issue('unclassified'),{...issue('action'),task:'2.2.1'}]
  state.meetings=[{id:'meeting',title:'協調',date:'2026-11-07',chair:'PMO',attendees:'團隊',agendaIds:['action'],minutes:'紀錄',decision:'決議',status:'已確認',confirmedBy:'PMO',confirmedAt:'2026-11-07'}]
  const s=deliverySummary(state,'d1')
  expect(s.unclassified.map(i=>i.id)).toEqual(['unclassified'])
  expect(s.issues.map(i=>i.id)).toEqual(['action'])
  expect(s.meetings[0]?.openActions).toBe(1)
  expect(s.findings.some(f=>f.id==='action')).toBe(true)
 })
})
