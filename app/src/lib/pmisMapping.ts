import { PARTS } from '@/data/parts'
export function defaultTaskParts(code:string):string[] {
 return PARTS.filter(p=>{
  const codes=['site','shell'].includes(p.id)?['2.1.1','2.1.2']:['power','power-routes'].includes(p.id)?['2.2.1','2.2.2','2.3.1']:['2.3.1','2.3.2']
  return codes.includes(code)
 }).map(p=>p.id)
}
