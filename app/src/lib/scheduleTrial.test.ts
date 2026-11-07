import { describe, expect, it } from 'vitest'
import { scheduleTrial } from './scheduleTrial'
import { progressCurves } from './progressCurves'
import { emptyPmis } from '@/stores/pmis'
import type { PdmLink } from './pdmScenario'
const tasks=[{code:'a',start:1,end:5},{code:'b',start:1,end:3},{code:'c',start:1,end:2}]
const edge=(source:string,target:string,relation:PdmLink['relation'],lag=0):PdmLink=>({source,target,relation,lag})
describe('PDM forward trial dates',()=>{
 it('propagates FS lag across chains and preserves durations',()=>{const r=scheduleTrial(tasks,[edge('a','b','FS',2),edge('b','c','FS')]);expect(r.map(t=>[t.start,t.end])).toEqual([[1,5],[8,10],[11,12]]);expect(r[1]?.shift).toBe(7)})
 it('supports SS FF SF with inclusive working days',()=>{expect(scheduleTrial(tasks,[edge('a','b','SS',2)])[1]?.start).toBe(3);expect(scheduleTrial(tasks,[edge('a','b','FF',2)])[1]?.end).toBe(7);expect(scheduleTrial([{code:'a',start:10,end:12},tasks[1]!],[edge('a','b','SF',1)])[1]?.end).toBe(11)})
 it('retains baseline lower bounds and resolves multiple predecessors',()=>{const r=scheduleTrial([...tasks,{code:'d',start:20,end:21}],[edge('a','c','FS'),edge('b','c','FS',10),edge('c','d','FS')]);expect(r[2]?.start).toBe(14);expect(r[3]?.start).toBe(20);expect(tasks[1]?.start).toBe(1)})
 it('rejects cycles instead of trying to schedule them',()=>{expect(()=>scheduleTrial(tasks,[edge('a','b','FS'),edge('b','a','FS')])).toThrow('循環')})
 it('extends curve horizon using trial dates without changing accepted work counts',()=>{const s=emptyPmis();const base=progressCurves(s,'WD');const trial=progressCurves(s,'WD','',[{code:'2.2.1',start:90,end:99}]);expect(trial.days).toBe(99);expect(trial.accepted).toBe(base.accepted);expect(trial.points[80]?.completed).toBe(base.total-1);expect(trial.points[99]?.percent).toBe(100)})
})
