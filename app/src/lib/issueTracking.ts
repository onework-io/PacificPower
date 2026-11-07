import type { Issue } from '@/stores/pmis'
export interface IssueFilters { status:string; search:string; owner:string; priority:string; due:string; task:string }
export const emptyIssueFilters=():IssueFilters=>({status:'全部',search:'',owner:'',priority:'全部',due:'全部',task:''})
export function issueDeadline(issue:Issue,today:string) {
 if(issue.status==='已結案')return '已結案'
 if(!issue.due)return '未設定期限'
 if(issue.due<today)return '逾期'
 if(issue.due===today)return '今日到期'
 return '尚未到期'
}
export function filterIssues(issues:Issue[],filters:IssueFilters,today:string) {
 const q=filters.search.trim().toLowerCase()
 return issues.filter(i=>(filters.status==='全部'||i.status===filters.status)&&(!filters.owner||i.owner===filters.owner)&&(filters.priority==='全部'||i.priority===filters.priority)&&(filters.due==='全部'||issueDeadline(i,today)===filters.due)&&(!filters.task||i.task===filters.task)&&`${i.id} ${i.title} ${i.owner} ${i.description} ${i.task} ${i.document}`.toLowerCase().includes(q)).slice().sort((a,b)=>{
  const closed=Number(a.status==='已結案')-Number(b.status==='已結案');if(closed)return closed
  return (a.due||'9999').localeCompare(b.due||'9999')||a.id.localeCompare(b.id)
 })
}
