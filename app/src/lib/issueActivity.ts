import type { State } from '@/stores/pmis'
export interface IssueActivity { id:string; at:string; actor:string; kind:'留言'|'異動'; title:string; text:string }
export function issueActivity(state:Pick<State,'comments'|'audit'>,issueId:string):IssueActivity[] {
 const target=`issue:${issueId}`
 const comments=state.comments.filter(c=>c.target===target).map(c=>({id:`comment:${c.id}`,at:c.at,actor:c.actor,kind:'留言' as const,title:'議題留言',text:c.text}))
 const audit=state.audit.filter(a=>(a.target===issueId||a.target===target)&&a.action!=='新增留言').map(a=>({id:`audit:${a.id}`,at:a.at,actor:a.actor,kind:'異動' as const,title:a.action,text:a.note}))
 return [...comments,...audit].sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id))
}
