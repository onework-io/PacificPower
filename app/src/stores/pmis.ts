import { computed, ref, watch } from 'vue'
import plan from '@/data/assessmentPlan.json'
import { PARTS } from '@/data/parts'
import { defaultTaskParts } from '@/lib/pmisMapping'
import { defineStore } from 'pinia'
export const ROLES = ['太電 PMO','業主決策人','PISG 商務','HPE 顧問','承包商／供應商','品管／試運轉','維運'] as const
export type WorkStatus = '未開始'|'執行中'|'待審查'|'已接受'|'退回修訂'
export interface Work { owner:string; reviewer:string; due:string; criteria:string; evidence:string; status:WorkStatus }
export interface Issue { id:string; title:string; type:string; priority:string; owner:string; due:string; task:string; asset:string; document:string; description:string; response:string; status:'待處理'|'處理中'|'待確認'|'已結案' }
export interface Revision { id:string; code:string; version:string; title:string; url:string; author:string; status:WorkStatus; note:string; createdAt:string }
export interface Meeting { id:string; title:string; date:string; chair:string; attendees:string; agendaIds:string[]; minutes:string; decision:string; status:'草稿'|'已確認'; confirmedBy:string; confirmedAt:string }
export interface Audit { id:string; at:string; actor:string; target:string; action:string; note:string }
export interface Comment { id:string; at:string; actor:string; target:string; text:string }
export interface State { meetings:Meeting[]; bindings:Record<string,string[]>; schema:1; work:Record<string,Work>; issues:Issue[]; revisions:Revision[]; audit:Audit[]; comments:Comment[] }
export const emptyPmis = ():State => ({schema:1,meetings:[],bindings:{},work:{},issues:[],revisions:[],audit:[],comments:[]})
export const defaultWork = ():Work => ({owner:'',reviewer:'',due:'',criteria:'',evidence:'',status:'未開始'})
const transitions:Record<WorkStatus,WorkStatus[]> = {'未開始':['執行中'],'執行中':['待審查'],'待審查':['已接受','退回修訂'],'退回修訂':['執行中'],'已接受':['退回修訂']}
export function checkReview(current:WorkStatus,next:WorkStatus,note:string) {
 if(!transitions[current]?.includes(next)) throw new Error('狀態轉換不允許，請依工作流程操作。')
 if(['已接受','退回修訂'].includes(next)&&!note.trim()) throw new Error('接受或退回必須填寫審查說明。')
}
export function safeReference(url:string) { try { return ['http:','https:'].includes(new URL(url).protocol) } catch { return false } }
export const usePmisStore=defineStore('pmis',()=>{
 const project=ref(''), state=ref<State>(emptyPmis()), role=ref<string>(ROLES[0]), actor=ref(''), error=ref('')
 let readOnly=false
 const key=()=>`pacificpower-pmis-v1:${project.value}`
 function load(id:string) {
  project.value='';state.value=emptyPmis();error.value='';readOnly=false
  try { const raw=localStorage.getItem(`pacificpower-pmis-v1:${id}`);if(raw){const v=JSON.parse(raw);if(v.schema!==1||!v.work||!Array.isArray(v.issues)||!Array.isArray(v.revisions)||!Array.isArray(v.audit)||!Array.isArray(v.comments))throw new Error('格式不符');state.value={...v,bindings:v.bindings??{},meetings:v.meetings??[]}} }
  catch {error.value='本機資料無法讀取；已停止寫入以保留原資料。請先備份並聯絡管理者。';readOnly=true}
  project.value=id
 }
 watch(state,()=>{if(!project.value||readOnly)return;try{localStorage.setItem(key(),JSON.stringify(state.value));error.value=''}catch{error.value='儲存失敗：本次變更僅在記憶體中，請立即匯出備份。'}},{deep:true,flush:'sync'})
 function identity(){if(readOnly)throw new Error(error.value);if(!actor.value.trim())throw new Error('請先填寫操作人姓名。');return `${actor.value.trim()}（${role.value}）`}
 function log(target:string,action:string,note=''){state.value.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),actor:identity(),target,action,note})}
 function saveWork(code:string,data:Work){identity();if(['待審查','已接受'].includes(state.value.work[code]?.status??''))throw new Error('待審查或已接受的工作需先退回修訂，才能變更設定。');state.value.work[code]={...data,status:state.value.work[code]?.status??'未開始'};log(code,'更新工作分工與完成條件')}
 function transition(code:string,next:WorkStatus,note:string){identity();const w=state.value.work[code]??defaultWork();checkReview(w.status,next,note);if(next==='待審查'&&(!w.owner.trim()||!w.reviewer.trim()||!w.criteria.trim()||!w.evidence.trim()))throw new Error('送審前請填妥主責、審查人、完成條件及成果證據。');state.value.work[code]={...w,status:next};log(code,`工作 → ${next}`,note)}
 function createIssue(data:Omit<Issue,'id'|'status'|'response'>){identity();if(!data.title.trim()||!data.owner.trim()||!data.description.trim())throw new Error('請填寫議題標題、責任窗口與說明。');const id=`ISS-${crypto.randomUUID().slice(0,8)}`;state.value.issues.unshift({...data,id,status:'待處理',response:''});log(id,'建立議題',data.title);return id}
 function moveIssue(id:string,next:Issue['status'],response:string){identity();const issue=state.value.issues.find(x=>x.id===id);if(!issue)throw new Error('找不到議題');const allowed:Record<Issue['status'],Issue['status'][]>={'待處理':['處理中'],'處理中':['待確認'],'待確認':['已結案','處理中'],'已結案':['處理中']};if(!allowed[issue.status].includes(next))throw new Error('議題狀態轉換不允許');if(!response.trim())throw new Error('請填寫處理或確認說明');issue.status=next;issue.response=response;log(id,`議題 → ${next}`,response)}
 function addRevision(data:Pick<Revision,'code'|'version'|'title'|'url'>){const author=identity();if(!data.version.trim()||!data.title.trim()||!safeReference(data.url))throw new Error('請填寫版本、修訂說明及有效的 HTTPS／HTTP 文件連結。');if(state.value.revisions.some(r=>r.code===data.code&&r.version===data.version.trim()))throw new Error('此文件版本已存在，請使用新的版本號');const r:Revision={...data,version:data.version.trim(),id:crypto.randomUUID(),author,status:'執行中',note:'',createdAt:new Date().toISOString()};state.value.revisions.unshift(r);log(data.code,`登錄文件 ${r.version}`,r.title)}
 function reviewRevision(id:string,next:WorkStatus,note:string){identity();const r=state.value.revisions.find(x=>x.id===id);if(!r)throw new Error('找不到文件版本');checkReview(r.status,next,note);r.status=next;r.note=note;log(r.code,`${r.version} → ${next}`,note)}
 function comment(target:string,text:string){const who=identity();if(!text.trim())throw new Error('留言不可空白');state.value.comments.push({id:crypto.randomUUID(),target,text:text.trim(),actor:who,at:new Date().toISOString()});log(target,'新增留言')}
 function saveMeeting(input:Meeting){identity();if(!input.title.trim()||!input.date||!input.chair.trim())throw new Error('請填寫會議名稱、日期及主持人');if(input.agendaIds.some(id=>!state.value.issues.some(i=>i.id===id)))throw new Error('議題不存在');const existing=state.value.meetings.find(m=>m.id===input.id);if(existing?.status==='已確認')throw new Error('已確認紀錄需先重新開啟才能修改');const value:Meeting={...input,id:existing?.id??crypto.randomUUID(),agendaIds:[...new Set(input.agendaIds)],status:'草稿',confirmedBy:'',confirmedAt:''};if(existing)Object.assign(existing,value);else state.value.meetings.unshift(value);log(value.id,'儲存會議草稿',value.title);return value.id}
 function confirmMeeting(id:string){const who=identity();const m=state.value.meetings.find(x=>x.id===id);if(!m||m.status!=='草稿')throw new Error('找不到可確認的草稿');if(!m.attendees.trim()||!m.minutes.trim()||!m.decision.trim())throw new Error('確認前請填寫出席者、討論紀錄與決議');m.status='已確認';m.confirmedBy=who;m.confirmedAt=new Date().toISOString();log(id,'確認會議紀錄',m.decision)}
 function reopenMeeting(id:string,reason:string){identity();const m=state.value.meetings.find(x=>x.id===id);if(!m||m.status!=='已確認'||!reason.trim())throw new Error('重新開啟須選擇已確認會議並填寫原因');log(id,'重新開啟會議紀錄',`${reason}；原確認：${m.confirmedBy} ${m.confirmedAt}；原紀錄：${m.minutes}；原決議：${m.decision}`);m.status='草稿';m.confirmedAt='';m.confirmedBy=''}
 function addMeetingAction(id:string,data:Omit<Issue,'id'|'status'|'response'>){identity();const m=state.value.meetings.find(x=>x.id===id);if(!m||m.status!=='草稿')throw new Error('請先儲存會議草稿；已確認紀錄請先重新開啟');const issueId=createIssue(data);m.agendaIds.push(issueId);log(id,'建立會議行動項目',issueId);return issueId}
 function taskParts(code:string):string[] { return state.value.bindings[code]??defaultTaskParts(code) }
 function setBinding(code:string,ids:string[],reason:string){identity();if(!plan.tasks.some(t=>t.code===code)||ids.some(id=>!PARTS.some(p=>p.id===id)))throw new Error('工項或元件不存在');if(!reason.trim())throw new Error('請填寫關聯調整原因');state.value.bindings[code]=[...new Set(ids)];log(code,'更新 3D 評估關聯',reason)}
 function resetBinding(code:string,reason:string){identity();if(!reason.trim())throw new Error('請填寫恢復原因');delete state.value.bindings[code];log(code,'恢復預設 3D 評估關聯',reason)}
 function mergeBackup(backup:State){identity();const next=mergePmis(state.value,backup);next.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),actor:identity(),target:'project',action:'合併還原備份',note:'只新增未存在紀錄，未覆寫現有資料'});state.value=next}
 const pending=computed(()=>state.value.issues.filter(i=>i.status!=='已結案'))
 return {saveMeeting,confirmMeeting,reopenMeeting,addMeetingAction,taskParts,setBinding,resetBinding,mergeBackup,state,role,actor,error,project,pending,load,saveWork,transition,createIssue,moveIssue,addRevision,reviewRevision,comment}
})

// Validate imported backups before preview or mutation. Only known fields survive.
export function parsePmisBackup(raw:string,project:string):State {
 if(raw.length>5_000_000)throw new Error('備份不可超過 5 MB')
 const v=JSON.parse(raw)
 if(!v||v.schema!==1||v.project!==project)throw new Error('備份版本或專案不符')
 const text=(x:unknown)=>{if(typeof x!=='string')throw new Error('備份欄位格式不符');return x}
 const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw new Error('備份物件格式不符');return x as Record<string,unknown>}
 const array=(x:unknown):Record<string,unknown>[]=>{if(!Array.isArray(x))throw new Error('備份清單格式不符');return x.map(obj)}
 const fields=(x:Record<string,unknown>,keys:string[])=>Object.fromEntries(keys.map(k=>[k,text(x[k])]))
 const taskCodes=new Set(plan.tasks.map(t=>t.code)), docCodes=new Set(plan.documents.map(d=>d.code)), assetIds=new Set(PARTS.map(p=>p.id))
 const result=emptyPmis()
 for(const [code,value] of Object.entries(obj(v.work))){if(!taskCodes.has(code))throw new Error('備份包含未知 WBS');const w=fields(obj(value),['owner','reviewer','due','criteria','evidence','status']) as unknown as Work;if(!Object.hasOwn(transitions,w.status))throw new Error('工作狀態不符');result.work[code]=w}
 for(const [code,ids] of Object.entries(obj(v.bindings??{}))){if(!taskCodes.has(code)||!Array.isArray(ids)||ids.some(x=>typeof x!=='string'||!assetIds.has(x)))throw new Error('模型關聯格式不符');result.bindings[code]=[...new Set(ids)] as string[]}
 result.issues=array(v.issues).map(x=>{const i=fields(x,['id','title','type','priority','owner','due','task','asset','document','description','response','status']) as unknown as Issue;if(!['待處理','處理中','待確認','已結案'].includes(i.status)||i.task&&!taskCodes.has(i.task)||i.asset&&!assetIds.has(i.asset)||i.document&&!docCodes.has(i.document))throw new Error('議題狀態或關聯不符');return i})
 result.revisions=array(v.revisions).map(x=>{const r=fields(x,['id','code','version','title','url','author','status','note','createdAt']) as unknown as Revision;if(!docCodes.has(r.code)||!safeReference(r.url)||!Object.hasOwn(transitions,r.status))throw new Error('文件版本資料不符');return r})
 result.audit=array(v.audit).map(x=>fields(x,['id','at','actor','target','action','note']) as unknown as Audit)
 result.comments=array(v.comments).map(x=>fields(x,['id','at','actor','target','text']) as unknown as Comment)
 result.meetings=array(v.meetings??[]).map(x=>{const m=fields(x,['id','title','date','chair','attendees','minutes','decision','status','confirmedBy','confirmedAt']) as unknown as Meeting;if(!['草稿','已確認'].includes(m.status)||!Array.isArray(x.agendaIds)||x.agendaIds.some(id=>typeof id!=='string'||!result.issues.some(i=>i.id===id)))throw new Error('會議資料或關聯不符');m.agendaIds=[...new Set(x.agendaIds)] as string[];return m})
 for(const list of [result.meetings,result.issues,result.revisions,result.audit,result.comments])if(new Set(list.map(x=>x.id)).size!==list.length)throw new Error('備份含重複紀錄 ID')
 if(new Set(result.revisions.map(x=>`${x.code}:${x.version}`)).size!==result.revisions.length)throw new Error('備份含重複文件版本')
 return result
}
function same(a:unknown,b:unknown):boolean {if(a===b)return true;if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>same(v,b[i]));if(a&&b&&typeof a==='object'&&typeof b==='object'){const x=a as Record<string,unknown>,y=b as Record<string,unknown>;return Object.keys(x).length===Object.keys(y).length&&Object.keys(x).every(k=>Object.hasOwn(y,k)&&same(x[k],y[k]))}return false}
export function mergePmis(current:State,incoming:State):State {
 const result=JSON.parse(JSON.stringify(current)) as State
 for(const key of ['work','bindings'] as const){for(const [id,value] of Object.entries(incoming[key])){if(Object.hasOwn(result[key],id)&&!same(result[key][id],value))throw new Error(`既有 ${key} ${id} 與備份衝突，未匯入任何資料`);Object.assign(result[key],{[id]:value})}}
 for(const key of ['issues','revisions','audit','comments','meetings'] as const){for(const record of incoming[key]){const existing=result[key].find(x=>x.id===record.id);if(existing&&!same(existing,record))throw new Error(`紀錄 ${record.id} 衝突，未匯入任何資料`);if(!existing)(result[key] as Array<{id:string}>).push(record)}}
 if(new Set(result.revisions.map(r=>`${r.code}:${r.version}`)).size!==result.revisions.length)throw new Error('文件版本號衝突，未匯入任何資料')
 return result
}
