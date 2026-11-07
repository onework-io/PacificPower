import { describe, expect, it } from 'vitest'
import { emptyPmis, defaultWork } from '@/stores/pmis'
import { progressCurves } from './progressCurves'
describe('WBS curves',()=>{
 it('separates clocks and excludes buffers',()=>{const s=emptyPmis(),p=progressCurves(s,'P'),wd=progressCurves(s,'WD');expect(p.days).toBe(35);expect(wd.days).toBe(80);expect(p.total+wd.total).toBe(48);expect([...p.tasks,...wd.tasks].some(t=>['0.2','3.6'].includes(t.code))).toBe(false)})
 it('starts at zero and reaches full planned completion with complementary remaining counts',()=>{const c=progressCurves(emptyPmis(),'WD');expect(c.points[0]?.percent).toBe(0);expect(c.points.at(-1)?.percent).toBe(100);for(const p of c.points){expect(p.completed+p.remaining).toBe(c.total);expect(p.percent).toBeGreaterThanOrEqual(0);expect(p.percent).toBeLessThanOrEqual(100)}})
 it('completes each planned task on its end day, not its start',()=>{const c=progressCurves(emptyPmis(),'P');expect(c.points[2]?.completed).toBe(0);expect(c.points[3]?.completed).toBe(1)})
 it('only credits accepted work and includes returned work in remaining counts',()=>{const s=emptyPmis();s.work['2.2.1']={...defaultWork(),status:'已接受'};s.work['2.2.2']={...defaultWork(),status:'待審查'};expect(progressCurves(s,'WD').accepted).toBe(1);s.work['2.2.1']!.status='退回修訂';expect(progressCurves(s,'WD').accepted).toBe(0)})
 it('respects cleared model links and has no completion percentage for empty scopes',()=>{const s=emptyPmis();const before=progressCurves(s,'WD','power');s.bindings['2.2.1']=[];expect(progressCurves(s,'WD','power').total).toBe(before.total-1);const empty=progressCurves(s,'P','power');expect(empty.total).toBe(0);expect(empty.points.every(p=>Number.isFinite(p.percent))).toBe(true)})
})
