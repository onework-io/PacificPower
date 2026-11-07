import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
export const ROLES = ['太電 PMO','業主決策人','PISG 商務','HPE 顧問','承包商／供應商','品管／試運轉','維運'] as const
export type WorkStatus = '未開始'|'執行中'|'待審查'|'已接受'|'退回修訂'
export interface Work { owner:string; reviewer:string; due:string; criteria:string; evidence:string; status:WorkStatus }
export interface Issue { id:string; title:string; type:string; priority:string; owner:string; due:string; task:string; asset:string; document:string; description:string; response:string; status:'待處理'|'處理中'|'待確認'|'已結案' }
export interface Revision { id:string; code:string; version:string; title:string; url:string; author:string; status:WorkStatus; note:string; createdAt:string }
export interface Audit { id:string; at:string; actor:string; target:string; action:string; note:string }
export interface Comment { id:string; at:string; actor:string; target:string; text:string }
interface State { schema:1; work:Record<string,Work>; issues:Issue[]; revisions:Revision[]; audit:Audit[]; comments:Comment[] }
export const emptyPmis = ():State => ({schema:1,work:{},issues:[],revisions:[],audit:[],comments:[]})
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
  try { const raw=localStorage.getItem(`pacificpower-pmis-v1:${id}`);if(raw){const v=JSON.parse(raw);if(v.schema!==1||!v.work||!Array.isArray(v.issues)||!Array.isArray(v.revisions)||!Array.isArray(v.audit)||!Array.isArray(v.comments))throw new Error('格式不符');state.value=v} }
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
 const pending=computed(()=>state.value.issues.filter(i=>i.status!=='已結案'))
 return {state,role,actor,error,project,pending,load,saveWork,transition,createIssue,moveIssue,addRevision,reviewRevision,comment}
})
