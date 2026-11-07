import plan from '@/data/assessmentPlan.json'
import type { State } from '@/stores/pmis'
import { defaultTaskParts } from './pmisMapping'
export function progressCurves(state:State,basis:'P'|'WD',asset=''){
 const tasks=plan.tasks.filter(t=>t.basis===basis&&!['0.2','3.6'].includes(t.code)&&(!asset||(state.bindings[t.code]??defaultTaskParts(t.code)).includes(asset)))
 const days=basis==='P'?35:80,total=tasks.length
 const points=Array.from({length:days+1},(_,day)=>{const completed=tasks.filter(t=>t.end<=day).length;return {day,completed,remaining:total-completed,percent:total?completed/total*100:0}})
 const accepted=tasks.filter(t=>state.work[t.code]?.status==='已接受').length
 return {tasks,days,total,points,accepted,remaining:total-accepted,percent:total?accepted/total*100:0}
}
