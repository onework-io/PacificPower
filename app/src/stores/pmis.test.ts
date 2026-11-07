import { beforeEach, describe, expect, it, vi } from 'vitest'
import { newInspection } from '@/lib/inspections'
import { createPinia, setActivePinia } from 'pinia'
import { usePmisStore, defaultWork, safeReference, emptyPmis, parsePmisBackup, mergePmis } from './pmis'
const values=new Map<string,string>()
beforeEach(()=>{values.clear();vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)});setActivePinia(createPinia())})
function setup(){const s=usePmisStore();s.load('a');s.actor='測試人員';return s}
describe('PMIS local collaboration',()=>{
 it('requires identity before mutations',()=>{const s=setup();s.actor='';expect(()=>s.saveWork('1.1.1',defaultWork())).toThrow('姓名');expect(s.state.audit).toHaveLength(0);expect(s.state.work).toEqual({})})
 it('gates review on evidence and preserves review reasons',()=>{const s=setup();s.transition('1.1.1','執行中','');expect(()=>s.transition('1.1.1','待審查','')).toThrow('送審前');s.saveWork('1.1.1',{...defaultWork(),owner:'作者',reviewer:'複核人',criteria:'完整性檢查',evidence:'DOC-01 Rev A'});expect(s.state.work['1.1.1']!.status).toBe('執行中');s.transition('1.1.1','待審查','');expect(()=>s.transition('1.1.1','已接受','')).toThrow('說明');s.transition('1.1.1','退回修訂','缺少附件');expect(s.state.audit[0]?.note).toBe('缺少附件');expect(()=>s.transition('1.1.1','已接受','接受')).toThrow('不允許')})
 it('persists and isolates project records',()=>{const s=setup();s.saveWork('1.1.1',{...defaultWork(),owner:'A'});s.load('b');expect(s.state.work).toEqual({});s.saveWork('1.1.1',{...defaultWork(),owner:'B'});s.load('a');expect(s.state.work['1.1.1']?.owner).toBe('A')})
 it('protects unreadable stored data',()=>{values.set('pacificpower-pmis-v1:a','broken');const s=setup();expect(s.error).toContain('停止寫入');expect(()=>s.comment('task:1','abc')).toThrow();expect(values.get('pacificpower-pmis-v1:a')).toBe('broken')})
 it('requires response and confirmation before closing issues',()=>{const s=setup();const id=s.createIssue({title:'容量口徑確認',type:'RFI',priority:'高',owner:'PMO',due:'',task:'2.2.2',asset:'power',document:'DOC-06',description:'確認50／250MW差異'});expect(()=>s.moveIssue(id,'已結案','結案')).toThrow();s.moveIssue(id,'處理中','開始調查');expect(()=>s.moveIssue(id,'待確認','')).toThrow();s.moveIssue(id,'待確認','已提供資料');s.moveIssue(id,'已結案','確認回覆充分');expect(s.pending).toHaveLength(0);s.moveIssue(id,'處理中','新資料需再確認');expect(s.pending).toHaveLength(1)})
 it('rejects unsafe URLs and duplicate revision labels',()=>{const s=setup();expect(safeReference('javascript:alert(1)')).toBe(false);expect(safeReference('https://example.com/doc')).toBe(true);const r={code:'DOC-01',version:'A',title:'初稿',url:'https://example.com/a'};s.addRevision(r);expect(()=>s.addRevision(r)).toThrow('已存在');const id=s.state.revisions[0]!.id;expect(()=>s.reviewRevision(id,'已接受','ok')).toThrow('不允許');s.reviewRevision(id,'待審查','送審');s.reviewRevision(id,'已接受','同意此版本');s.addRevision({...r,version:'B'});expect(s.state.revisions.find(x=>x.version==='A')?.status).toBe('已接受');expect(s.state.revisions[0]?.status).toBe('執行中')})
 it('surfaces storage failure instead of claiming persistence',()=>{const s=setup();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{throw new Error('quota')}});s.comment('task:1','test');expect(s.error).toContain('儲存失敗')})
})

describe('PMIS mappings and safe backup merge',()=>{
 it('allows explicit empty mappings and restores defaults',()=>{const s=setup();expect(s.taskParts('2.2.1')).toContain('power');expect(()=>s.setBinding('2.2.1',[],'')).toThrow('原因');s.setBinding('2.2.1',[],'此工作改為文件檢查');expect(s.taskParts('2.2.1')).toEqual([]);s.load('a');expect(s.taskParts('2.2.1')).toEqual([]);s.resetBinding('2.2.1','回復原評估範圍');expect(s.taskParts('2.2.1')).toContain('power')})
 it('rejects unknown model identifiers and WBS',()=>{const s=setup();expect(()=>s.setBinding('bad',['power'],'why')).toThrow('不存在');expect(()=>s.setBinding('2.2.1',['bad'],'why')).toThrow('不存在')})
 it('migrates existing v1 state without bindings',()=>{values.set('pacificpower-pmis-v1:a',JSON.stringify({schema:1,work:{},issues:[],revisions:[],audit:[],comments:[]}));const s=setup();expect(s.state.bindings).toEqual({});expect(s.taskParts('2.2.1')).toContain('power')})
})

describe('PMIS backup validation',()=>{
 it('checks project identity, shape, safe references and duplicate IDs',()=>{
  const b={...emptyPmis(),project:'a'}
  expect(parsePmisBackup(JSON.stringify(b),'a')).toEqual(emptyPmis())
  expect(()=>parsePmisBackup(JSON.stringify(b),'b')).toThrow('專案')
  expect(()=>parsePmisBackup(JSON.stringify({...b,work:{bad:defaultWork()}}),'a')).toThrow('未知')
  expect(()=>parsePmisBackup(JSON.stringify({...b,issues:[{}]}),'a')).toThrow('欄位')
  const r={id:'r1',code:'DOC-01',version:'A',title:'title',url:'javascript:alert(1)',author:'a',status:'執行中',note:'',createdAt:'today'}
  expect(()=>parsePmisBackup(JSON.stringify({...b,revisions:[r]}),'a')).toThrow('版本資料')
  r.url='https://example.com'
  expect(()=>parsePmisBackup(JSON.stringify({...b,revisions:[r,r]}),'a')).toThrow('重複')
 })
 it('merges additively, treats repeated imports as idempotent and rejects conflicts atomically',()=>{
  const current=emptyPmis(), incoming=emptyPmis();current.work['1.1.1']={...defaultWork(),owner:'A'};incoming.work['1.1.1']={...defaultWork(),owner:'A'};incoming.work['1.1.2']=defaultWork()
  const merged=mergePmis(current,incoming);expect(Object.keys(merged.work)).toHaveLength(2);expect(mergePmis(merged,incoming)).toEqual(merged);expect(Object.keys(current.work)).toHaveLength(1)
  incoming.work['1.1.1']!.owner='B';expect(()=>mergePmis(current,incoming)).toThrow('衝突');expect(current.work['1.1.2']).toBeUndefined()
 })
 it('restores a validated backup through the store with audit record',()=>{const s=setup();const b=emptyPmis();b.bindings['1.1.1']=['site'];s.mergeBackup(parsePmisBackup(JSON.stringify({...b,project:'a'}),'a'));expect(s.taskParts('1.1.1')).toEqual(['site']);expect(s.state.audit[0]?.action).toBe('合併還原備份')})
})

describe('PMIS meeting coordination',()=>{
 const meeting=()=>({id:'',title:'跨專業協調會',date:'2026-11-07',chair:'主持人',attendees:'PMO / HPE',agendaIds:[] as string[],minutes:'確認資料缺口',decision:'請補交資料',status:'草稿' as const,confirmedBy:'',confirmedAt:''})
 it('saves agenda, creates linked actions and does not close issues on confirmation',()=>{const s=setup();const id=s.saveMeeting(meeting());const issueId=s.addMeetingAction(id,{title:'補充資料',type:'會議行動',priority:'一般',owner:'作者',due:'2026-11-10',task:'2.2.1',asset:'power',document:'DOC-06',description:'補充容量依據'});expect(s.state.meetings[0]?.agendaIds).toEqual([issueId]);s.confirmMeeting(id);expect(s.state.meetings[0]?.status).toBe('已確認');expect(s.pending).toHaveLength(1);expect(()=>s.saveMeeting({...meeting(),id})).toThrow('重新開啟');expect(()=>s.reopenMeeting(id,'')).toThrow('原因');s.reopenMeeting(id,'更正討論紀錄');expect(s.state.meetings[0]?.status).toBe('草稿');expect(s.state.audit[0]?.note).toContain('原紀錄：確認資料缺口')})
 it('validates required inputs and preserves meetings through project reload',()=>{const s=setup();expect(()=>s.saveMeeting({...meeting(),chair:''})).toThrow('主持人');expect(()=>s.saveMeeting({...meeting(),agendaIds:['unknown']})).toThrow('不存在');const id=s.saveMeeting({...meeting(),minutes:''});expect(()=>s.confirmMeeting(id)).toThrow('討論紀錄');s.load('b');expect(s.state.meetings).toEqual([]);s.load('a');expect(s.state.meetings[0]?.id).toBe(id)})
 it('includes meetings in validated backups and rejects unknown agenda references',()=>{const s=setup();s.saveMeeting(meeting());const backup=parsePmisBackup(JSON.stringify({...s.state,project:'a'}),'a');expect(backup.meetings).toHaveLength(1);expect(mergePmis(emptyPmis(),backup).meetings).toHaveLength(1);backup.meetings[0]!.agendaIds=['missing'];expect(()=>parsePmisBackup(JSON.stringify({...backup,project:'a'}),'a')).toThrow('會議')})
})

describe('Inspection workflow',()=>{
 function record(){const i=newInspection();return {...i,title:'設備查驗',date:'2026-11-07',inspector:'查驗人',reviewer:'複核人',basis:'核准程序 A',evidence:'現場紀錄 A',asset:'power'}}
 it('requires all results and explanations before submission and locks submitted data',()=>{const s=setup();const i=record();const id=s.saveInspection(i);expect(()=>s.submitInspection(id)).toThrow('未查驗');i.id=id;i.items.forEach(x=>x.result='合格');i.items[0]!.result='不適用';s.saveInspection(i);expect(()=>s.submitInspection(id)).toThrow('說明');i.items[0]!.note='本批次不適用';s.saveInspection(i);s.submitInspection(id);expect(()=>s.saveInspection(i)).toThrow('退回');expect(()=>s.reviewInspection(id,true,'')).toThrow('說明');s.reviewInspection(id,true,'文件完整');expect(s.state.inspections[0]?.status).toBe('已接受');s.reviewInspection(id,false,'補充現場資訊');expect(s.state.audit[0]?.note).toContain('結果快照')})
 it('creates a defect once and blocks acceptance until correction and issue closure',()=>{const s=setup();const i=record();i.items.forEach(x=>x.result='合格');i.items[0]!.result='不合格';i.items[0]!.note='標識缺漏';const id=s.saveInspection(i);const defect=s.inspectionDefect(id,i.items[0]!.id,'改善人','2026-11-10');expect(()=>s.inspectionDefect(id,i.items[0]!.id,'改善人','')).toThrow('已有');s.submitInspection(id);expect(()=>s.reviewInspection(id,true,'同意')).toThrow('不合格');s.reviewInspection(id,false,'補標識');const updated=JSON.parse(JSON.stringify(s.state.inspections[0]!));updated.items[0].result='合格';s.saveInspection(updated);s.submitInspection(id);expect(()=>s.reviewInspection(id,true,'同意')).toThrow('尚未結案');s.moveIssue(defect,'處理中','補標識');s.moveIssue(defect,'待確認','完成');s.moveIssue(defect,'已結案','查證完成');s.reviewInspection(id,true,'複核通過');expect(s.state.inspections[0]?.status).toBe('已接受')})
 it('retains defect links and validates backups',()=>{const s=setup();const i=record();i.items[0]!.result='不合格';i.items[0]!.note='缺漏';const id=s.saveInspection(i);s.inspectionDefect(id,i.items[0]!.id,'A','');const saved=s.state.inspections[0]!;expect(()=>s.saveInspection({...saved,items:saved.items.slice(1)})).toThrow('不可移除');const backup=parsePmisBackup(JSON.stringify({...s.state,project:'a'}),'a');expect(backup.inspections).toHaveLength(1);expect(mergePmis(emptyPmis(),backup).inspections).toHaveLength(1);s.load('b');expect(s.state.inspections).toHaveLength(0);s.load('a');expect(s.state.inspections[0]?.items[0]?.issueId).toBeTruthy()})
})

describe('Issue responsibility handover',()=>{
 function make(){const s=setup();const id=s.createIssue({title:'資料補充',type:'RFI',priority:'一般',owner:'原窗口',due:'2026-11-08',task:'2.2.1',asset:'power',document:'DOC-06',description:'補資料'});return {s,id}}
 it('records before and after while retaining status, response and relations',()=>{const {s,id}=make();s.moveIssue(id,'處理中','調查中');s.updateIssueAssignment(id,{owner:' 新窗口 ',due:'2026-11-10',priority:'高'},'跨專業移交');expect(s.state.issues[0]).toMatchObject({owner:'新窗口',due:'2026-11-10',priority:'高',status:'處理中',response:'調查中',task:'2.2.1',asset:'power',document:'DOC-06'});expect(s.state.audit[0]?.note).toContain('原窗口');expect(s.state.audit[0]?.note).toContain('新窗口');s.load('a');expect(s.state.issues[0]?.owner).toBe('新窗口')})
 it('rejects invalid or unreasoned changes without mutation',()=>{const {s,id}=make();const before=JSON.stringify(s.state);const data={owner:'新窗口',due:'2026-11-10',priority:'高'};expect(()=>s.updateIssueAssignment(id,data,'')).toThrow('原因');expect(()=>s.updateIssueAssignment(id,{...data,due:'2026-02-30'},'調整')).toThrow('日期');expect(()=>s.updateIssueAssignment(id,{...data,priority:'bad'},'調整')).toThrow('優先級');expect(()=>s.updateIssueAssignment(id,{...data,owner:' '},'調整')).toThrow('窗口');expect(JSON.stringify(s.state)).toBe(before);s.actor='';expect(()=>s.updateIssueAssignment(id,data,'調整')).toThrow('姓名')})
 it('requires reopening closed issues and a reason for clearing dates',()=>{const {s,id}=make();s.moveIssue(id,'處理中','開始');s.moveIssue(id,'待確認','完成');s.moveIssue(id,'已結案','確認');const data={owner:'新窗口',due:'',priority:'一般'};expect(()=>s.updateIssueAssignment(id,data,'清除期限')).toThrow('重新處理');s.moveIssue(id,'處理中','補資料');s.updateIssueAssignment(id,data,'等待業主確認新日期');expect(s.state.issues[0]?.due).toBe('');expect(s.state.audit[0]?.note).toContain('2026-11-08');expect(()=>s.updateIssueAssignment(id,data,'重複')).toThrow('尚未變更')})
})

describe('Issue discussion persistence',()=>{
 it('keeps comments separate from workflow status and restores them in backups',()=>{const s=setup();const id=s.createIssue({title:'協調',type:'RFI',priority:'一般',owner:'窗口',due:'',task:'',asset:'',document:'',description:'確認'});s.comment(`issue:${id}`,' 補充資料依據 ');expect(s.state.issues[0]?.status).toBe('待處理');expect(s.state.issues[0]?.response).toBe('');expect(s.state.comments[0]?.text).toBe('補充資料依據');const backup=parsePmisBackup(JSON.stringify({...s.state,project:'a'}),'a');expect(backup.comments[0]?.target).toBe(`issue:${id}`);s.load('a');expect(s.state.comments).toHaveLength(1);expect(()=>s.comment(`issue:${id}`,' ')).toThrow('空白')})
})
