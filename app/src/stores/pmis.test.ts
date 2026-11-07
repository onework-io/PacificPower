import { beforeEach, describe, expect, it, vi } from 'vitest'
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
