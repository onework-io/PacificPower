import { expect, it } from 'vitest'
import { DEMO_PROJECT_ID, makeMockDemo, mockScenario } from './mockDemo'
import { parsePmisBackup } from '@/stores/pmis'
import { validatePdmLinks } from '@/lib/pdmScenario'
import plan from './assessmentPlan.json'
it('provides complete, valid linked demo data without touching project identity',()=>{const state=makeMockDemo();const restored=parsePmisBackup(JSON.stringify({...state,project:DEMO_PROJECT_ID}),DEMO_PROJECT_ID);expect(Object.keys(restored.work)).toHaveLength(50);expect(restored.revisions).toHaveLength(26);expect(restored.issues).toHaveLength(8);expect(restored.meetings).toHaveLength(3);expect(restored.inspections).toHaveLength(4);expect(restored.issues.every(i=>i.title.startsWith('示範'))).toBe(true)})
it('provides valid independent P and WD scenarios',()=>{for(const basis of ['P','WD'])expect(()=>validatePdmLinks(mockScenario(basis),plan.tasks.filter(t=>t.basis===basis).map(t=>t.code))).not.toThrow()})

it('keeps demo documents under the deployed project subpath',()=>{
 const state=makeMockDemo('https://onework-io.github.io/PacificPower/')
 expect(state.revisions.every(r=>r.url.startsWith('https://onework-io.github.io/PacificPower/demo/document.html?'))).toBe(true)
})
