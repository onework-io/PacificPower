import { describe, expect, it } from 'vitest'
import { emptyIssueFilters, filterIssues, issueDeadline } from './issueTracking'
import type { Issue } from '@/stores/pmis'
const record=(id:string,changes:Partial<Issue>={}):Issue=>({id,title:'電力資料',type:'RFI',priority:'高',owner:'王工',due:'',task:'2.2.1',asset:'power',document:'DOC-06',description:'確認容量',response:'',status:'待處理',...changes})
const today='2026-11-07'
describe('issue tracking',()=>{
 it('separates overdue, today, future, missing and closed dates',()=>{
  expect(issueDeadline(record('1',{due:'2026-11-06'}),today)).toBe('逾期')
  expect(issueDeadline(record('1',{due:today}),today)).toBe('今日到期')
  expect(issueDeadline(record('1',{due:'2026-11-08'}),today)).toBe('尚未到期')
  expect(issueDeadline(record('1'),today)).toBe('未設定期限')
  expect(issueDeadline(record('1',{due:'2026-11-06',status:'已結案'}),today)).toBe('已結案')
 })
 it('combines exact owner, priority, work and deadline filters',()=>{
  const records=[record('1',{due:'2026-11-06'}),record('2',{owner:'王工程師',due:'2026-11-06'}),record('3',{priority:'一般'}),record('4',{task:'2.2.2'})]
  const filters={...emptyIssueFilters(),owner:'王工',priority:'高',task:'2.2.1',due:'逾期'}
  expect(filterIssues(records,filters,today).map(i=>i.id)).toEqual(['1'])
 })
 it('searches references and descriptions without case or surrounding space sensitivity',()=>{
  expect(filterIssues([record('1')],{...emptyIssueFilters(),search:' doc-06 '},today)).toHaveLength(1)
  expect(filterIssues([record('1')],{...emptyIssueFilters(),search:'容量'},today)).toHaveLength(1)
 })
 it('sorts open items by deadline without mutating the source',()=>{
  const records=[record('none'),record('closed',{due:'2020-01-01',status:'已結案'}),record('later',{due:'2026-11-09'}),record('early',{due:'2026-11-01'})]
  expect(filterIssues(records,emptyIssueFilters(),today).map(i=>i.id)).toEqual(['early','later','none','closed'])
  expect(records[0]?.id).toBe('none')
 })
})
