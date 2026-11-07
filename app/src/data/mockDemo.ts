import plan from './assessmentPlan.json'
import type { State, WorkStatus } from '@/stores/pmis'
import type { PdmLink } from '@/lib/pdmScenario'
export const DEMO_PROJECT_ID='pisg-50mw-demo-v1'
export function makeMockDemo(origin='http://127.0.0.1:5173'):State {
 const state:State={schema:1,work:{},issues:[],revisions:[],meetings:[],inspections:[],bindings:{},audit:[],comments:[]}
 const now='2026-11-07T09:00:00+08:00'
 plan.tasks.forEach((t,i)=>{
  const status:WorkStatus=t.basis==='P'||t.end<=22?'已接受':t.code==='2.2.2'?'退回修訂':t.end<=35?'待審查':t.end<=53?'執行中':'未開始'
  state.work[t.code]={owner:`示範｜${t.owner}`,reviewer:'示範｜PMO 複核窗口',due:`2026-11-${String(Math.min(28,4+Math.floor(i/2))).padStart(2,'0')}`,criteria:'完成資料來源、容量口徑與介面核對；僅供操作示範。',evidence:status==='未開始'?'':`示範成果 ${t.documents.join('、')||t.code}，非正式簽認`,status}
  state.audit.push({id:`demo-work-${i}`,at:now,actor:'示範｜專案管理員',target:t.code,action:`工作 → ${status}`,note:'預載模擬紀錄，非真實工程進度'})
 })
 const titles=['受電容量佐證補件','冷卻主幹介面確認','機櫃密度假設核對','光纖路徑維護空間','設備標識複驗','期中報告業主回覆','消防介面資料需求','維運交接清單確認']
 const tasks=['2.2.2','2.3.1','2.3.2','2.3.2','2.2.1','2.5.2','2.3.1','4.2.4']
 const assets=['power','fws','dc01-racks','fiber','power','site','shell','cooling']
 const docs=['DOC-06','DOC-07','DOC-07','DOC-07','DOC-06','DOC-08','DOC-07','DOC-16']
 const statuses=['處理中','待確認','待處理','待處理','已結案','待確認','處理中','待處理'] as const
 titles.forEach((title,i)=>{const id=`DEMO-ISS-${i+1}`;state.issues.push({id,title:`示範｜${title}`,type:i===4?'缺失':i===2?'風險':'RFI',priority:i<2?'高':'一般',owner:`示範｜${['電力顧問','冷卻顧問','IT 規劃','網路顧問','品管窗口','業主 PMO','消防顧問','維運窗口'][i]}`,due:i<2?'2026-11-06':'2026-11-12',task:tasks[i]!,asset:assets[i]!,document:docs[i]!,description:`模擬情境：${title}，請核對資料版本、責任介面與後續處理期限。`,response:i===4?'示範複驗完成；非真實驗收':i===1?'已提供示範介面資料，待確認':'',status:statuses[i]!});state.comments.push({id:`demo-comment-${i}`,at:now,actor:'示範｜PMO',target:`issue:${id}`,text:'本筆為模擬資料，可測試留言、移交與狀態流程。'});state.audit.push({id:`demo-issue-${i}`,at:now,actor:'示範｜PMO',target:id,action:'建立議題',note:'預載模擬議題'})})
 plan.documents.forEach((d,i)=>{state.revisions.push({id:`demo-doc-${i}`,code:d.code,version:'Rev A',title:`示範｜${d.name}`,url:`${origin}/demo/document.html?code=${encodeURIComponent(d.code)}`,author:'示範｜文件管理員',status:i<10||d.code==='DOC-06'?'已接受':i<18?'待審查':'執行中',note:'模擬文件，非正式交付成果',createdAt:'2026-11-05T09:00:00+08:00'})})
 state.revisions.unshift({id:'demo-doc-new',code:'DOC-06',version:'Rev B',title:'示範｜容量佐證補充版',url:`${origin}/demo/document.html?code=DOC-06&version=B`,author:'示範｜電力顧問',status:'待審查',note:'新版待審不抵銷舊版接受紀錄',createdAt:now})
 for(let i=0;i<3;i++)state.meetings.push({id:`DEMO-MTG-${i+1}`,title:`示範｜${['電力與冷卻跨專業協調','期中成果審查','維運介面工作會議'][i]}`,date:`2026-11-0${5+i}`,chair:'示範｜PMO',attendees:'示範｜業主、顧問、承包商、維運',agendaIds:[`DEMO-ISS-${i+1}`,`DEMO-ISS-${i+6}`],minutes:'彙整容量依據、文件版本及跨專業介面，列出責任窗口與追蹤期限。',decision:'模擬決議：各責任窗口補件後由 PMO 合併確認。',status:i===0?'已確認':'草稿',confirmedBy:i===0?'示範｜主持人':'',confirmedAt:i===0?now:''})
 for(let i=0;i<4;i++)state.inspections.push({id:`DEMO-INSP-${i+1}`,title:`示範｜${['電力資料完整性查驗','冷卻介面資料查驗','設備標識複驗','機櫃配置資料查驗'][i]}`,date:'2026-11-07',inspector:'示範｜查驗工程師',reviewer:'示範｜品管複核',asset:assets[i]!,task:tasks[i]!,document:docs[i]!,basis:'示範查驗表 Rev A；須以核准程序取代',evidence:'示範紀錄頁，非現場照片或真實證據',items:['資料來源與版本','容量及介面核對','責任窗口確認','成果完整性'].map((label,j)=>({id:`check-${j+1}`,label,result:i===0&&j===1?'不合格':'合格',note:i===0&&j===1?'模擬：缺少受電佐證':'示範核對紀錄',issueId:i===0&&j===1?'DEMO-ISS-1':''})),status:i===2?'已接受':i===0?'退回':'待複核',reviewNote:i===0?'示範退回補件':i===2?'示範複驗接受':'',submittedBy:'示範｜查驗工程師',reviewedBy:i===2?'示範｜品管複核':''})
 return state
}
export function mockScenario(basis:string):PdmLink[]{const ids=new Set(plan.tasks.filter(t=>t.basis===basis).map(t=>t.code));return plan.annotatedDependencies.filter(e=>ids.has(e.source)&&ids.has(e.target)).map(e=>({...e,relation:e.relation as PdmLink['relation'],lag:e.source==='2.2.1'&&e.target==='2.4.2'?4:0}))}
export function installMockDemo(origin:string,reset=false){
 const key=`pacificpower-pmis-v1:${DEMO_PROJECT_ID}`
 if(reset&&localStorage.getItem(key))localStorage.setItem(`${key}:before-reset`,localStorage.getItem(key)!)
 if(reset||!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(makeMockDemo(origin)))
 for(const basis of ['P','WD']){const k=`pacificpower-pdm-scenario-v1:${DEMO_PROJECT_ID}:${basis}`;if(reset&&localStorage.getItem(k))localStorage.setItem(`${k}:before-reset`,localStorage.getItem(k)!);if(reset||!localStorage.getItem(k))localStorage.setItem(k,JSON.stringify({schema:1,links:mockScenario(basis),history:[]}))}
}
