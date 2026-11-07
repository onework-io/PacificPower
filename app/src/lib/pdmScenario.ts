export interface PdmLink { source:string; target:string; relation:'FS'|'SS'|'FF'|'SF'; lag:number }
export function validatePdmLinks(links:PdmLink[],ids:string[]) {
 const known=new Set(ids),pairs=new Set<string>(),next=new Map<string,string[]>()
 for(const e of links){
  if(!known.has(e.source)||!known.has(e.target))throw new Error('工作不在目前計時範圍')
  if(e.source===e.target)throw new Error('不可自我相依')
  if(!['FS','SS','FF','SF'].includes(e.relation)||!Number.isInteger(e.lag)||e.lag<0||e.lag>365)throw new Error('關係或延遲量不正確；延遲須為 0～365 工作日整數')
  const key=`${e.source}:${e.target}`;if(pairs.has(key))throw new Error('同一前後工作不可重複建立關係');pairs.add(key)
  next.set(e.source,[...(next.get(e.source)??[]),e.target])
 }
 const visiting=new Set<string>(),done=new Set<string>()
 function visit(id:string){if(visiting.has(id))throw new Error('關係形成循環，請調整前後順序');if(done.has(id))return;visiting.add(id);for(const target of next.get(id)??[])visit(target);visiting.delete(id);done.add(id)}
 ids.forEach(visit)
}
