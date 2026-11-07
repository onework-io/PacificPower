import { validatePdmLinks, type PdmLink } from './pdmScenario'
export interface ScheduleTask { code:string; start:number; end:number }
/** Inclusive workday coordinates. Baseline start is a not-earlier-than constraint. */
export function scheduleTrial<T extends ScheduleTask>(tasks:T[],links:PdmLink[]) {
 validatePdmLinks(links,tasks.map(t=>t.code))
 const done=new Map<string,T&{baselineStart:number;baselineEnd:number;shift:number}>()
 function solve(code:string):T&{baselineStart:number;baselineEnd:number;shift:number}{
  const cached=done.get(code);if(cached)return cached
  const task=tasks.find(t=>t.code===code)!;const duration=task.end-task.start+1
  if(!Number.isInteger(duration)||duration<1)throw new Error('工作工期不正確')
  let start=task.start
  for(const edge of links.filter(e=>e.target===code)){
   const p=solve(edge.source)
   const lower=edge.relation==='FS'?p.end+1+edge.lag:edge.relation==='SS'?p.start+edge.lag:edge.relation==='FF'?p.end+edge.lag-duration+1:p.start+edge.lag-duration+1
   start=Math.max(start,lower)
  }
  const row={...task,start,end:start+duration-1,baselineStart:task.start,baselineEnd:task.end,shift:start-task.start};done.set(code,row);return row
 }
 return tasks.map(t=>solve(t.code))
}
