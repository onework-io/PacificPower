import plan from '@/data/assessmentPlan.json'
import type { State } from '@/stores/pmis'
import { defaultTaskParts } from './pmisMapping'
export const PACKAGES = [
 {id:'all',name:'完整基本範圍',docs:plan.documents.filter(d=>!d.optional).map(d=>d.code)},
 {id:'commercial',name:'委任前 COMM',docs:plan.documents.filter(d=>d.code.startsWith('COMM')).map(d=>d.code)},
 {id:'d0',name:'D0 階段 A 成果包',docs:['DOC-01','DOC-02','DOC-03','DOC-14','DOC-15','DOC-16']},
 {id:'d1',name:'D1 期中成果包',docs:['DOC-04','DOC-05','DOC-06','DOC-07','DOC-08','DOC-14','DOC-15','DOC-16']},
 {id:'d2',name:'D2 期末成果包',docs:['DOC-09','DOC-10','DOC-11','DOC-12','DOC-13','DOC-14','DOC-15','DOC-16']},
]
export function deliverySummary(state:State,packageId='all',asset='',today=new Date().toLocaleDateString('sv-SE')) {
 const pack=PACKAGES.find(p=>p.id===packageId)??PACKAGES[0]!
 const inStage=(code:string)=>pack.id==='all'||(pack.id==='commercial'?code.startsWith('0.'):pack.id==='d0'?code.startsWith('1.')||code.startsWith('4.'):pack.id==='d1'?code.startsWith('2.')||code.startsWith('3.1.')||code.startsWith('4.'):code.startsWith('3.')||code.startsWith('4.'))
 const tasks=plan.tasks.filter(t=>inStage(t.code)&&(!asset||(state.bindings[t.code]??defaultTaskParts(t.code)).includes(asset))).map(t=>({...t,record:state.work[t.code],status:state.work[t.code]?.status??'未開始',overdue:!!state.work[t.code]?.due&&state.work[t.code]!.due<today&&state.work[t.code]!.status!=='已接受'}))
 const taskIds=new Set(tasks.map(t=>t.code))
 const docIds=pack.docs.filter(code=>!asset||tasks.some(t=>t.documents.includes(code)))
 const documents=plan.documents.filter(d=>docIds.includes(d.code)).map(d=>{
  // Most recently registered version controls this view, not an older accepted version.
  const revisions=state.revisions.filter(r=>r.code===d.code).map((r,index)=>({r,index})).sort((a,b)=>b.r.createdAt.localeCompare(a.r.createdAt)||a.index-b.index)
  const latest=revisions[0]?.r
  return {...d,latest,status:latest?.status??'未登錄',acceptedVersions:revisions.filter(x=>x.r.status==='已接受').length}
 })
 const related=(x:{task:string;asset:string;document:string})=>asset?(x.asset===asset||!!x.task&&taskIds.has(x.task)||!!x.document&&docIds.includes(x.document)):(pack.id==='all'||taskIds.has(x.task)||docIds.includes(x.document))
 const issues=state.issues.filter(related)
 const inspections=state.inspections.filter(related).map(i=>({...i,openDefects:i.items.filter(item=>item.issueId&&state.issues.find(issue=>issue.id===item.issueId)?.status!=='已結案').length}))
 const meetings=state.meetings.filter(m=>pack.id==='all'&&!asset||m.agendaIds.some(id=>issues.some(i=>i.id===id))).map(m=>({...m,openActions:m.agendaIds.filter(id=>state.issues.find(i=>i.id===id)?.status!=='已結案').length}))
 const unclassified=state.issues.filter(i=>!i.task&&!i.asset&&!i.document&&i.status!=='已結案')
 const findings=[...tasks.filter(t=>t.status!=='已接受').map(t=>({kind:'工作',id:t.code,title:t.name,reason:t.overdue?'工作逾期':`工作${t.status}`,owner:t.record?.owner||t.owner})),...documents.filter(d=>d.status!=='已接受').map(d=>({kind:'文件',id:d.code,title:d.name,reason:d.latest?`最新登錄版本 ${d.latest.version} ${d.status}`:'尚未登錄版本',owner:d.owner})),...issues.filter(i=>i.status!=='已結案').map(i=>({kind:'議題',id:i.id,title:i.title,reason:`${i.priority}／${i.status}`,owner:i.owner})),...inspections.filter(i=>i.status!=='已接受'||i.openDefects>0).map(i=>({kind:'查驗',id:i.id,title:i.title,reason:i.openDefects?`${i.openDefects} 項關聯缺失未結`:`查驗${i.status}`,owner:i.reviewer})),...meetings.filter(m=>m.status!=='已確認').map(m=>({kind:'會議',id:m.id,title:m.title,reason:'會議紀錄待確認',owner:m.chair}))]
 return {packageId:pack.id,packageName:pack.name,asset,today,tasks,documents,issues,inspections,meetings,unclassified,findings}
}
