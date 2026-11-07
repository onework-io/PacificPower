import { describe, expect, it } from 'vitest'
import plan from './assessmentPlan.json'
describe('PISG Rev1.3-H4 reference baseline',()=>{
 it('keeps separate P and WD timelines and original numbered leaves',()=>{
  expect(plan.tasks).toHaveLength(50)
  expect(new Set(plan.tasks.map(t=>t.code)).size).toBe(50)
  expect(plan.tasks.filter(t=>t.basis==='P')).toHaveLength(10)
  expect(Math.max(...plan.tasks.filter(t=>t.basis==='P').map(t=>t.end))).toBe(35)
  expect(Math.max(...plan.tasks.filter(t=>t.basis==='WD').map(t=>t.end))).toBe(80)
  for(const t of plan.tasks) expect(t.end).toBeGreaterThanOrEqual(t.start)
 })
 it('retains same-day gates and overlapping independent buffer',()=>{
  for(const [code,start,end] of [['1.3',12,12],['3.1.2',43,43],['3.5.4',75,75],['3.6',76,80],['3.7',76,78]] as const){
   expect(plan.tasks.find(t=>t.code===code)).toMatchObject({start,end})
  }
 })
 it('resolves deliverables and preserves the optional boundary',()=>{
  expect(plan.documents).toHaveLength(25)
  expect(plan.documents.filter(d=>d.optional).map(d=>d.code)).toEqual(['DOC-17','DOC-18','DOC-19','DOC-20'])
  for(const t of plan.tasks) for(const code of t.documents){
   expect(plan.documents.find(d=>d.code===code)?.optional).toBe(false)
  }
 })
 it('retains valid explicitly annotated FS and SS relationships',()=>{
  for(const edge of plan.annotatedDependencies){
   const a=plan.tasks.find(t=>t.code===edge.source)!,b=plan.tasks.find(t=>t.code===edge.target)!
   expect(a).toBeDefined();expect(b).toBeDefined()
   expect(a.basis).toBe(b.basis)
   if(edge.relation==='FS') expect(b.start).toBeGreaterThan(a.end)
   else expect(b.start).toBeGreaterThanOrEqual(a.start)
  }
  expect(plan.source.capacityMW).toBe(50)
 })
})
