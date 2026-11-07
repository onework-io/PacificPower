import { describe, expect, it } from 'vitest'
import { validatePdmLinks, type PdmLink } from './pdmScenario'
const link=(source:string,target:string,relation:PdmLink['relation']='FS',lag=0):PdmLink=>({source,target,relation,lag})
describe('PDM scenario validation',()=>{
 it('accepts acyclic FS SS FF SF with nonnegative lag',()=>{expect(()=>validatePdmLinks([link('a','b'),link('a','c','SS',3),link('b','d','FF'),link('c','d','SF')],['a','b','c','d'])).not.toThrow()})
 it('rejects self dependencies and duplicate pairs',()=>{expect(()=>validatePdmLinks([link('a','a')],['a'])).toThrow('自我');expect(()=>validatePdmLinks([link('a','b'),link('a','b','SS')],['a','b'])).toThrow('重複')})
 it('rejects indirect cycles regardless of relation type',()=>{expect(()=>validatePdmLinks([link('a','b'),link('b','c','SS'),link('c','a','FF')],['a','b','c'])).toThrow('循環')})
 it('rejects cross-clock identifiers and invalid lag',()=>{expect(()=>validatePdmLinks([link('a','outside')],['a','b'])).toThrow('範圍');for(const lag of [-1,0.5,366,NaN])expect(()=>validatePdmLinks([link('a','b','FS',lag)],['a','b'])).toThrow('延遲')})
 it('does not mutate candidate relationships',()=>{const candidate=[link('a','b')];const before=JSON.stringify(candidate);validatePdmLinks(candidate,['a','b']);expect(JSON.stringify(candidate)).toBe(before)})
})
